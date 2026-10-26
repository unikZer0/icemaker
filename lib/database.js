const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function secretCodec(key) {
  if (!/^[a-fA-F0-9]{64}$/.test(key || '')) throw new Error('DATA_ENCRYPTION_KEY must contain 64 hexadecimal characters.');
  const bytes = Buffer.from(key, 'hex');
  return {
    encrypt(value) {
      if (!value) return '';
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', bytes, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(':');
    },
    decrypt(value) {
      if (!value) return '';
      const [version, iv, tag, ciphertext] = value.split(':');
      if (version !== 'v1') throw new Error('Unsupported encrypted secret');
      const decipher = crypto.createDecipheriv('aes-256-gcm', bytes, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
    },
  };
}

async function openDatabase(options = {}) {
  const codec = secretCodec(options.encryptionKey || process.env.DATA_ENCRYPTION_KEY);
  const pool = new Pool(options.pool || { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'icemaker', user: process.env.PGUSER || process.env.POSTGRES_USER || 'icemaker', password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 15000 });
  // An idle connection failure must not crash the process or expose connection credentials.
  pool.on('error', () => {});
  async function transaction(work) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function putMachine(client, machine, ordinal) {
    await client.query(`INSERT INTO devices(id,name,location,connection,created_at,ordinal,device_token,bridge_token)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,location=EXCLUDED.location,
      connection=EXCLUDED.connection,device_token=EXCLUDED.device_token,bridge_token=EXCLUDED.bridge_token`,
    [machine.id, machine.name, machine.location, machine.connection, machine.createdAt, ordinal, codec.encrypt(machine.token), codec.encrypt(machine.bridgeToken)]);
  }
  async function putNotifications(client, settings, alarms) {
    const rows = alarms.map(a => ({ id: a.id, device_id: a.machineId, machine_name: a.machineName, rule: a.rule, severity: a.severity || (a.rule === 'tank' ? 'info' : 'critical'), message: a.message, created_at: a.createdAt, resolved_at: a.resolvedAt || null, details: a }));
    await client.query(`INSERT INTO notification_channels(id,enabled,recipient,token_encrypted) VALUES('line',$1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET enabled=EXCLUDED.enabled,recipient=EXCLUDED.recipient,token_encrypted=EXCLUDED.token_encrypted`, [Boolean(settings.enabled), settings.recipient || '', codec.encrypt(settings.token)]);
    await client.query(`INSERT INTO alert_rules(name,config) VALUES('events',$1),('thresholds',$2)
      ON CONFLICT(name) DO UPDATE SET config=EXCLUDED.config`, [JSON.stringify(settings.rules || {}), JSON.stringify(settings.thresholds || {})]);
    if (rows.length) await client.query(`INSERT INTO alarms(id,device_id,machine_name,rule,severity,message,created_at,resolved_at,details)
      SELECT id,device_id,machine_name,rule,severity,message,created_at,resolved_at,details FROM jsonb_to_recordset($1::jsonb)
      AS x(id text,device_id text,machine_name text,rule text,severity text,message text,created_at bigint,resolved_at bigint,details jsonb)
      ON CONFLICT(id) DO UPDATE SET resolved_at=EXCLUDED.resolved_at,details=EXCLUDED.details`, [JSON.stringify(rows)]);
    await client.query('DELETE FROM alarms WHERE NOT (id = ANY($1::text[]))', [rows.map(a => a.id)]);
  }
  try {
    await transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(712441901)');
      await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
      const migration = await client.query("SELECT version FROM schema_migrations WHERE version='001-import-files'");
      if (!migration.rowCount) {
        const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
        const read = (name, fallback) => { const file = path.join(dataDir, name); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; };
        const config = read('config.json', {});
        const token = options.token || process.env.MQTT_TOKEN || config.token || crypto.randomBytes(24).toString('hex');
        const bridgeToken = options.bridgeToken || process.env.USB_BRIDGE_TOKEN;
        const machines = read('machines.json', [{ id: 'cloudmeter-1', name: 'CloudMeter-1', location: '', connection: 'usb', createdAt: Date.now(), token, bridgeToken: bridgeToken || crypto.randomBytes(24).toString('hex') }]);
        if (!Array.isArray(machines) || !machines.length) throw new Error('Legacy machines.json must contain at least one device');
        machines[0].token = token; if (bridgeToken) machines[0].bridgeToken = bridgeToken;
        for (let i = 0; i < machines.length; i++) { await putMachine(client, machines[i], i); if (machines[i].deletedAt) await client.query('UPDATE devices SET deleted_at=$2 WHERE id=$1', [machines[i].id, machines[i].deletedAt]); }
        const notifications = read('notifications.json', {});
        await putNotifications(client, notifications.settings || {}, notifications.alarms || []);
        let count = 0;
        const readingsFile = path.join(dataDir, 'readings.ndjson');
        if (fs.existsSync(readingsFile)) {
          const lines = fs.readFileSync(readingsFile, 'utf8').split('\n'), records = [];
          for (let i = 0; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            let record;
            try { record = JSON.parse(lines[i]); } catch { if (i === lines.length - 1) continue; throw new Error('Invalid legacy reading at line ' + (i + 1)); }
            records.push({ device_id: record.machineId || machines[0].id, ts: record.ts, source: record.source, payload: record.values });
          }
          for (let i = 0; i < records.length; i += 1000) await client.query(`INSERT INTO readings(device_id,ts,source,payload)
            SELECT device_id,ts,source,payload FROM jsonb_to_recordset($1::jsonb) AS x(device_id text,ts bigint,source text,payload jsonb)`, [JSON.stringify(records.slice(i, i + 1000))]);
          count = records.length;
        }
        await client.query("INSERT INTO schema_migrations(version,details) VALUES('001-import-files',$1)", [JSON.stringify({ devices: machines.length, readings: count, alarms: (notifications.alarms || []).length })]);
      }
      const username = options.adminUser || process.env.ADMIN_USER || 'admin', password = options.adminPassword || process.env.ADMIN_PASSWORD;
      if (password) {
        if (password.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
        const salt = crypto.randomBytes(16).toString('hex'), hash = crypto.scryptSync(password, salt, 64).toString('hex');
        await client.query('INSERT INTO users(username,password_hash,password_salt) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING', [username, hash, salt]);
      }
    });
    const machineRows = await pool.query('SELECT * FROM devices ORDER BY ordinal,created_at,id');
    const allMachines = machineRows.rows.map(m => ({ id: m.id, name: m.name, location: m.location, connection: m.connection, createdAt: Number(m.created_at), deletedAt: m.deleted_at === null ? null : Number(m.deleted_at), token: codec.decrypt(m.device_token), bridgeToken: codec.decrypt(m.bridge_token) }));
    // Keep the original environment-managed gateway credentials valid after migration.
    if (options.token || process.env.MQTT_TOKEN) allMachines[0].token = options.token || process.env.MQTT_TOKEN;
    if (options.bridgeToken || process.env.USB_BRIDGE_TOKEN) allMachines[0].bridgeToken = options.bridgeToken || process.env.USB_BRIDGE_TOKEN;
    await transaction(async client => { await putMachine(client, allMachines[0], 0); });
    const machines = allMachines.filter(m => !m.deletedAt);
    const channel = (await pool.query("SELECT * FROM notification_channels WHERE id='line'")).rows[0];
    const rules = Object.fromEntries((await pool.query('SELECT * FROM alert_rules')).rows.map(r => [r.name, r.config]));
    const alarms = (await pool.query('SELECT * FROM alarms ORDER BY created_at DESC,id')).rows.map(a => ({ ...a.details, id: a.id, machineId: a.device_id, machineName: a.machine_name, rule: a.rule, severity: a.severity, message: a.message, createdAt: Number(a.created_at), resolvedAt: a.resolved_at === null ? null : Number(a.resolved_at) }));
    const admin = (await pool.query('SELECT username,password_hash,password_salt FROM users WHERE username=$1', [options.adminUser || process.env.ADMIN_USER || 'admin'])).rows[0];
    const notificationState = { settings: { enabled: channel?.enabled || false, recipient: channel?.recipient || '', token: codec.decrypt(channel?.token_encrypted || ''), rules: { offline: true, sensor: true, tank: false, ...rules.events }, thresholds: rules.thresholds || {} }, alarms };
    return {
      pool, machines, notificationState, admin, originalId: allMachines[0].id,
      saveMachine: machine => transaction(async client => { const rank = (await client.query('SELECT coalesce(max(ordinal),-1)+1 AS ordinal FROM devices')).rows[0].ordinal; await putMachine(client, machine, rank); }),
      removeMachine: id => pool.query('UPDATE devices SET deleted_at=$2 WHERE id=$1 AND deleted_at IS NULL', [id, Date.now()]),
      saveNotifications: (settings, nextAlarms) => transaction(client => putNotifications(client, settings, nextAlarms)),
      appendReading: record => pool.query('INSERT INTO readings(device_id,ts,source,payload) VALUES($1,$2,$3,$4)', [record.machineId, record.ts, record.source, JSON.stringify(record.values)]),
      async history(machineId, source, since) {
        const result = await pool.query('SELECT ts,device_id,source,payload FROM readings WHERE device_id=$1 AND source=$2 AND ts>$3 ORDER BY ts,id', [machineId, source, since]);
        return result.rows.map(r => ({ ts: Number(r.ts), machineId: r.device_id, source: r.source, values: r.payload }));
      },
      async lastSeen() { return new Map((await pool.query('SELECT device_id,max(ts) AS ts FROM readings GROUP BY device_id')).rows.map(r => [r.device_id, Number(r.ts)])); },
      async prune() { await pool.query('DELETE FROM readings WHERE ts<$1 OR id IN (SELECT id FROM readings ORDER BY ts DESC,id DESC OFFSET 100000)', [Date.now() - 86400000]); },
      async healthy() { try { await pool.query('SELECT 1'); return true; } catch { return false; } },
      close: () => pool.end(),
    };
  } catch (error) { await pool.end(); throw error; }
}
module.exports = { openDatabase, secretCodec };
