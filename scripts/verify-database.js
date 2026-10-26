// Run inside the app container (with its PostgreSQL environment), never prints secrets.
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const pool = new Pool();
  try {
    const tables = ['devices', 'readings', 'alarms', 'alert_rules', 'notification_channels', 'users'];
    const counts = {};
    for (const table of tables) counts[table] = (await pool.query('SELECT count(*)::int AS count FROM ' + table)).rows[0].count;
    const migration = (await pool.query("SELECT details FROM schema_migrations WHERE version='001-import-files'")).rows[0]?.details;
    if (!migration) throw new Error('Migration marker missing');
    const dataDir = process.env.DATA_DIR || '/app/data';
    const file = path.join(dataDir, 'machines.json');
    if (fs.existsSync(file)) {
      const devices = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const device of devices) {
        const row = (await pool.query('SELECT id,name,location FROM devices WHERE id=$1', [device.id])).rows[0];
        if (!row || row.name !== device.name || row.location !== device.location) throw new Error('Legacy device mismatch');
      }
    }
    const secrets = await pool.query("SELECT device_token AS secret FROM devices UNION ALL SELECT bridge_token FROM devices UNION ALL SELECT token_encrypted FROM notification_channels WHERE token_encrypted<>''");
    if (!secrets.rows.every(r => r.secret.startsWith('v1:'))) throw new Error('Unencrypted token found');
    const retainedSchemas = await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'icemaker_test_%'");
    console.log(JSON.stringify({ counts, migration, encryptedTokens: true, temporaryTestSchemas: retainedSchemas.rowCount }, null, 2));
  } finally { await pool.end(); }
})().catch(error => { console.error('Verification failed:', error.code || error.message); process.exitCode = 1; });
