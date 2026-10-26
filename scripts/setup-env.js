const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target)) {
  const existing = fs.readFileSync(target, 'utf8');
  const port = existing.match(/^PORT=(\d+)$/m)?.[1] || '3100';
  const defaults = { AUTH_ENABLED: 'true', ADMIN_USER: 'admin', ADMIN_PASSWORD: crypto.randomBytes(24).toString('hex'), APP_ORIGIN: 'http://localhost:' + port, APP_DOMAIN: '', MQTT_TLS: 'false', MQTT_TLS_CERT: '', MQTT_TLS_KEY: '', BRIDGE_TLS_CA: '', STORAGE_BACKEND: 'postgres', POSTGRES_DB: 'icemaker', POSTGRES_USER: 'icemaker', POSTGRES_PASSWORD: crypto.randomBytes(32).toString('hex'), DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  const additions = Object.entries(defaults).filter(([key]) => !new RegExp('^' + key + '=', 'm').test(existing));
  if (additions.length) fs.appendFileSync(target, '\n# Fleet login and cloud settings\n' + additions.map(([key, value]) => key + '=' + value).join('\n') + '\n');
  console.log(additions.length ? 'Added missing login/cloud/database settings to .env. Existing settings, device tokens and encryption key are unchanged.' : '.env is up to date.');
  process.exit(0);
}
const oldFile = path.join(root, 'data', 'config.json');
const oldToken = fs.existsSync(oldFile) ? JSON.parse(fs.readFileSync(oldFile, 'utf8')).token : null;
const addresses = Object.entries(os.networkInterfaces()).filter(([name]) => !/vethernet|wsl|docker|loopback/i.test(name)).flatMap(([, list]) => list).filter(a => a.family === 'IPv4' && !a.internal);
const host = addresses.find(a => a.address.startsWith('192.168.'))?.address || addresses[0]?.address || '';
const template = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
  .replace('replace-with-a-random-device-token', oldToken || crypto.randomBytes(24).toString('hex'))
  .replace('replace-with-a-different-random-bridge-token', crypto.randomBytes(24).toString('hex'))
  .replace('replace-with-a-random-admin-password', crypto.randomBytes(24).toString('hex'))
  .replace('replace-with-a-random-database-password', crypto.randomBytes(32).toString('hex'))
  .replace('replace-with-a-64-hex-encryption-key', crypto.randomBytes(32).toString('hex'))
  .replace('192.168.1.125', host);
fs.writeFileSync(target, template, { mode: 0o600, flag: 'wx' });
console.log('Created .env with separate device/USB tokens. Check MQTT_ADVERTISED_HOST for your Wi-Fi network.');
