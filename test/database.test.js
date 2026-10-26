const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const mqtt = require('mqtt');
const { openDatabase, secretCodec } = require('../lib/database');
const { start } = require('../server');

test('encrypted database secrets require the original key and detect tampering', () => {
  const key = 'a'.repeat(64), codec = secretCodec(key), encrypted = codec.encrypt('test-secret');
  assert.notEqual(encrypted, codec.encrypt('test-secret'));
  assert.equal(codec.decrypt(encrypted), 'test-secret');
  assert.throws(() => secretCodec('short'));
  assert.throws(() => secretCodec('b'.repeat(64)).decrypt(encrypted));
  const changedByte = (parseInt(encrypted.slice(-2), 16) ^ 1).toString(16).padStart(2, '0');
  assert.throws(() => codec.decrypt(encrypted.slice(0, -2) + changedByte));
});

async function fixture(t) {
  const schema = 'icemaker_test_' + crypto.randomBytes(8).toString('hex');
  const config = { host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD };
  const root = new Pool(config);
  await root.query('CREATE SCHEMA "' + schema + '"');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icemaker-db-test-'));
  const repositories = new Set();
  t.after(async () => {
    for (const repository of repositories) await repository.close().catch(() => {});
    assert.match(schema, /^icemaker_test_[a-f0-9]{16}$/);
    await root.query('DROP SCHEMA "' + schema + '" CASCADE'); await root.end();
    assert.ok(path.resolve(dataDir).startsWith(path.join(os.tmpdir(), 'icemaker-db-test-')));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const options = { pool: { ...config, options: '-c search_path=' + schema, connectionTimeoutMillis: 3000 }, dataDir, encryptionKey: 'a'.repeat(64), token: 'device-test-token', bridgeToken: 'bridge-test-token', adminUser: 'db-test-admin', adminPassword: 'db-test-password-long' };
  const open = async () => { const repository = await openDatabase(options); repositories.add(repository); return repository; };
  return { dataDir, open, options, root, schema };
}

test('PostgreSQL imports once, persists API/MQTT changes, protects secrets and survives restart', { skip: process.env.TEST_POSTGRES !== '1' }, async t => {
  const f = await fixture(t), now = Date.now();
  const machine = { id: 'cloudmeter-1', name: 'Original machine', location: 'Bangkok', connection: 'usb', createdAt: now - 10000, token: 'device-test-token', bridgeToken: 'bridge-test-token' };
  fs.writeFileSync(path.join(f.dataDir, 'machines.json'), JSON.stringify([machine]));
  const legacyReadings = [{ ts: now - 1000, source: 'usb', values: { compressorCurrent: 1 } }, { ts: now - 500, machineId: machine.id, source: 'wifi', values: { acLineVoltage: 2 } }];
  fs.writeFileSync(path.join(f.dataDir, 'readings.ndjson'), legacyReadings.map(r => JSON.stringify(r)).join('\n') + '\n');
  const oldAlarm = { id: 'existing-alarm-id', machineId: machine.id, machineName: machine.name, rule: 'sensor', message: 'Sensor unavailable', createdAt: now - 500, resolvedAt: null, delivery: 'pending' };
  fs.writeFileSync(path.join(f.dataDir, 'notifications.json'), JSON.stringify({ settings: { enabled: false, recipient: 'U' + 'a'.repeat(32), token: 'legacy-line-secret', rules: { offline: true, sensor: true, tank: false } }, alarms: [oldAlarm] }));
  const originals = Object.fromEntries(fs.readdirSync(f.dataDir).map(name => [name, fs.readFileSync(path.join(f.dataDir, name), 'utf8')]));
  let db = await f.open();
  assert.equal(db.machines[0].name, machine.name);
  assert.equal((await db.history(machine.id, 'usb', 0)).length, 1);
  assert.equal(db.notificationState.alarms[0].id, oldAlarm.id);
  const secrets = (await db.pool.query('SELECT device_token,bridge_token FROM devices')).rows[0];
  assert.ok(!JSON.stringify(secrets).includes(machine.token));
  assert.match(secrets.device_token, /^v1:/);
  assert.match((await db.pool.query('SELECT token_encrypted FROM notification_channels')).rows[0].token_encrypted, /^v1:/);
  assert.notEqual(db.admin.password_hash, f.options.adminPassword);
  let app = start({ database: db, dataDir: f.dataDir, token: machine.token, bridgeToken: machine.bridgeToken, usbMode: 'bridge', httpPort: 0, mqttPort: 0, httpHost: '127.0.0.1', mqttHost: '127.0.0.1', quiet: true, auth: { enabled: true }, lineFetch: async () => ({ ok: true }) });
  let client;
  t.after(async () => { if (client) await client.endAsync(true); if (app) await app.close(); });
  await Promise.all([once(app.server, 'listening'), once(app.mqttServer, 'listening')]);
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (url, body, cookie = '') => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/api/machines')).status, 401);
  const login = await post('/api/auth/login', { username: f.options.adminUser, password: f.options.adminPassword }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0], get = url => fetch(base + url, { headers: { cookie } });
  assert.equal((await (await get('/api/health')).json()).storage, 'postgresql');
  const healthy = db.healthy; db.healthy = async () => false;
  assert.equal((await get('/api/health')).status, 503);
  db.healthy = healthy;
  const created = await post('/api/machines', { name: 'Second machine', location: 'Test', connection: 'wifi' }, cookie); assert.equal(created.status, 201); const second = await created.json();
  assert.equal((await post('/api/machines/' + second.id, { name: 'Renamed machine', location: 'Test', connection: 'wifi' }, cookie)).status, 200);
  assert.equal((await post('/api/alarms/acknowledge', { id: oldAlarm.id }, cookie)).status, 200);
  let settings = await (await get('/api/notifications')).json();
  assert.equal(settings.hasToken, true); assert.equal(settings.token, undefined);
  settings.thresholds.waterTemperature = { enabled: true, min: null, max: 20, holdSeconds: 30 };
  assert.equal((await post('/api/notifications', settings, cookie)).status, 200);
  // A failed multi-table write must roll back channel and rule changes as well.
  await assert.rejects(db.saveNotifications({ ...db.notificationState.settings, recipient: 'must-not-commit' }, [{ ...oldAlarm, id: 'invalid-new-alarm', machineId: 'missing-device' }]));
  assert.notEqual((await db.pool.query("SELECT recipient FROM notification_channels WHERE id='line'")).rows[0].recipient, 'must-not-commit');
  client = await mqtt.connectAsync('mqtt://127.0.0.1:' + app.mqttServer.address().port, { username: machine.token, reconnectPeriod: 0 });
  await client.publishAsync('v1/devices/me/telemetry', JSON.stringify({ compressorCurrent: 3.25 }), { qos: 1 });
  let readings;
  for (let i = 0; i < 100; i++) { readings = await (await get('/api/history?source=wifi&hours=1')).json(); if (readings.some(r => r.values.compressorCurrent === 3.25)) break; await new Promise(r => setTimeout(r, 20)); }
  assert.ok(readings.some(r => r.values.compressorCurrent === 3.25));
  assert.equal((await post('/api/machines/' + second.id + '/delete', { confirmName: 'Renamed machine' })).status, 401);
  assert.equal((await post('/api/machines/' + second.id + '/delete', { confirmName: 'wrong name' }, cookie)).status, 400);
  assert.equal((await post('/api/machines/' + second.id + '/delete', { confirmName: 'Renamed machine' }, cookie)).status, 200);
  assert.equal((await post('/api/machines/' + second.id + '/delete', { confirmName: 'Renamed machine' }, cookie)).status, 404);
  assert.equal((await get('/api/setup?machine=' + second.id)).status, 404);
  assert.equal((await post('/api/machines/' + machine.id + '/delete', { confirmName: machine.name }, cookie)).status, 200);
  assert.deepEqual(await (await get('/api/machines')).json(), []);
  assert.equal((await get('/api/health')).status, 200);
  await assert.rejects(mqtt.connectAsync('mqtt://127.0.0.1:' + app.mqttServer.address().port, { username: machine.token, reconnectPeriod: 0, connectTimeout: 1000 }));
  const replacement = await (await post('/api/machines', { name: 'Replacement', location: '', connection: 'wifi' }, cookie)).json();
  const replacementSetup = await (await get('/api/setup?machine=' + replacement.id)).json();
  assert.notEqual(replacementSetup.token, machine.token);
  assert.notEqual(replacementSetup.bridgeToken, machine.bridgeToken);
  await client.endAsync(true); client = undefined; await app.close(); app = undefined;
  db = await f.open();
  assert.equal(db.machines.length, 1);
  assert.equal(db.machines[0].id, replacement.id);
  assert.equal(db.machines[0].token, replacementSetup.token);
  assert.equal(db.originalId, machine.id);
  const retired = (await db.pool.query('SELECT name,deleted_at FROM devices WHERE id=$1', [second.id])).rows[0];
  assert.equal(retired.name, 'Renamed machine'); assert.ok(retired.deleted_at);
  assert.ok(db.notificationState.alarms.find(a => a.id === oldAlarm.id).acknowledgedAt);
  assert.equal(db.notificationState.settings.thresholds.waterTemperature.max, 20);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM readings')).rows[0].n, 3);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, 1);
  for (const [name, content] of Object.entries(originals)) assert.equal(fs.readFileSync(path.join(f.dataDir, name), 'utf8'), content);
  await assert.rejects(openDatabase({ ...f.options, encryptionKey: 'b'.repeat(64) }));
});

test('malformed legacy import rolls back completely and can be safely retried', { skip: process.env.TEST_POSTGRES !== '1' }, async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.dataDir, 'readings.ndjson'), 'bad-record\n');
  await assert.rejects(f.open(), /Invalid legacy reading/);
  const result = await f.root.query('SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1', [f.schema]); assert.equal(result.rows[0].n, 0);
  fs.writeFileSync(path.join(f.dataDir, 'readings.ndjson'), '');
  const db = await f.open(); assert.equal(db.machines.length, 1);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, 1);
});
