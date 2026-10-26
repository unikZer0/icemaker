const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { notificationService } = require('../lib/notifications');
const { start } = require('../server');
const { once } = require('node:events');

function setup(t, send) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icemaker-line-'));
  t.after(() => { assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), 'icemaker-line-'))); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, service: notificationService(dir, { fetch: send }) };
}
const input = { enabled: true, token: 'private-test-token', recipient: 'U' + 'a'.repeat(32), rules: { sensor: true, offline: true, tank: false } };
function state(now, status = false) { return { usb: { connected: true, lastSeen: now }, wifi: { connected: false, lastSeen: 0 }, latest: { usb: { temperatureSensorStatus: { value: status, ts: now }, machineTankFull: { value: true, ts: now } }, wifi: {} } }; }

test('LINE settings hide secrets, validate recipients, and persist token replacement/removal', t => {
  const { dir, service } = setup(t);
  assert.throws(() => service.update({ ...input, recipient: 'my-line-name' }), /ID/);
  service.update(input);
  assert.equal(service.publicSettings().token, undefined);
  assert.equal(service.publicSettings().hasToken, true);
  service.update({ ...input, token: '', enabled: false });
  const restored = notificationService(dir);
  assert.equal(restored.publicSettings().hasToken, true);
  restored.update({ ...input, enabled: false, clearToken: true });
  assert.equal(restored.publicSettings().hasToken, false);
});

test('real condition transitions deduplicate messages, preserve unknown sensor state, recover and recur', async t => {
  const sent = [];
  const { dir, service } = setup(t, async (url, options) => { sent.push({ url, ...options }); return { ok: true }; });
  service.update(input);
  const now = Date.now(), machines = [{ id: 'one', name: 'Ice machine' }], states = new Map([['one', state(now)]]);
  await service.evaluate(machines, states, now);
  assert.equal(service.list().length, 2); // sensor + tank, only sensor selected for LINE
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(JSON.parse(sent[0].body).to, input.recipient);
  await service.evaluate(machines, states, now + 5000);
  assert.equal(sent.length, 1);
  const sensor = service.list().find(a => a.rule === 'sensor');
  service.acknowledge(sensor.id);
  assert.ok(service.list().find(a => a.id === sensor.id).acknowledgedAt);
  assert.equal(notificationService(dir).list().find(a => a.id === sensor.id).delivery, 'sent');
  states.get('one').usb.connected = false;
  await service.evaluate(machines, states, now + 10000);
  assert.equal(sent.length, 2); // offline
  assert.equal(service.list().find(a => a.id === sensor.id).resolvedAt, null);
  states.set('one', state(now + 15000, true));
  await service.evaluate(machines, states, now + 15000);
  assert.ok(service.list().find(a => a.id === sensor.id).resolvedAt);
  states.set('one', state(now + 20000));
  await service.evaluate(machines, states, now + 20000);
  assert.equal(sent.length, 3);
});

test('LINE failure is visible, rate limited and retried with the same idempotency key', async t => {
  const calls = [];
  const { service } = setup(t, async (url, options) => { calls.push(options); return { ok: calls.length > 1, status: 429 }; });
  service.update(input);
  const now = Date.now(), machines = [{ id: 'one', name: 'Test' }], states = new Map([['one', state(now)]]);
  await service.evaluate(machines, states, now);
  assert.equal(service.list().find(a => a.rule === 'sensor').delivery, 'failed');
  await service.evaluate(machines, states, now + 5000);
  assert.equal(calls.length, 1);
  states.set('one', state(now + 61000));
  await service.evaluate(machines, states, now + 61000);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['X-Line-Retry-Key'], calls[1].headers['X-Line-Retry-Key']);
  assert.equal(service.list().find(a => a.rule === 'sensor').delivery, 'sent');
});

test('no offline alarm for never-seen machines and no external messages while disabled', async t => {
  let sends = 0;
  const { service } = setup(t, async () => { sends++; return { ok: true }; });
  const s = state(Date.now()); s.usb.connected = false; s.usb.lastSeen = 0;
  await service.evaluate([{ id: 'one', name: 'Test' }], new Map([['one', s]]));
  assert.deepEqual(service.list(), []);
  s.usb.connected = true; s.usb.lastSeen = Date.now();
  await service.evaluate([{ id: 'one', name: 'Test' }], new Map([['one', s]]));
  assert.equal(sends, 0);
  await assert.rejects(service.test(), /โทเคน/);
});

test('notification APIs require login, reject cross-origin writes and never return channel tokens', async t => {
  const { dir } = setup(t);
  let sends = 0;
  const app = start({ dataDir: dir, token: 'test-device', bridgeToken: 'test-bridge', usbMode: 'bridge', httpPort: 0, mqttPort: 0, mqttHost: '127.0.0.1', quiet: true, auth: { enabled: true, username: 'test-admin', password: 'test-password-long' }, lineFetch: async () => { sends++; return { ok: true }; } });
  t.after(() => app.close());
  await Promise.all([once(app.server, 'listening'), once(app.mqttServer, 'listening')]);
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (url, data, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  for (const route of ['/api/notifications', '/api/alarms']) assert.equal((await fetch(base + route)).status, 401);
  assert.equal((await post('/api/notifications/test', {})).status, 401);
  const login = await post('/api/auth/login', { username: 'test-admin', password: 'test-password-long' });
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
  assert.equal((await post('/api/notifications', input, { ...headers, Origin: 'https://other.example' })).status, 403);
  const saved = await post('/api/notifications', input, headers);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).hasToken, true);
  const settings = await (await fetch(base + '/api/notifications', { headers })).text();
  assert.ok(!settings.includes(input.token));
  assert.equal(sends, 0);
  assert.equal((await post('/api/notifications/test', {}, headers)).status, 200);
  assert.equal(sends, 1);
  for (const route of ['/home', '/alarms', '/dashboards', '/devices', '/notifications']) assert.equal((await fetch(base + route)).status, 200);
});

test('critical limits require sustained fresh violations, deduplicate, resolve and recur with LINE details', async t => {
  const messages = [];
  const { service } = setup(t, async (url, options) => { messages.push(JSON.parse(options.body)); return { ok: true }; });
  const thresholds = service.publicSettings().thresholds;
  thresholds.compressorCurrent = { enabled: true, min: 1, max: 5, holdSeconds: 10 };
  service.update({ ...input, rules: { ...input.rules, sensor: false, critical: true }, thresholds });
  const now = Date.now(), machines = [{ id: 'one', name: 'Test' }], states = new Map();
  async function reading(seconds, value) { const ts = now + seconds * 1000, s = state(ts, true); s.latest.usb.compressorCurrent = { value, ts }; states.set('one', s); await service.evaluate(machines, states, ts); }
  await reading(0, 6); await reading(5, 3); await reading(10, 6); await reading(15, 7);
  assert.equal(service.list().filter(a => a.metric).length, 0);
  await reading(20, 8);
  let event = service.list().find(a => a.metric);
  assert.equal(event.severity, 'critical'); assert.equal(event.limit, 5); assert.equal(event.triggerValue, 8);
  assert.equal(messages.length, 1); assert.match(messages[0].messages[0].text, /\[วิกฤต\]/); assert.match(messages[0].messages[0].text, /> 5/);
  await reading(25, 9); assert.equal(messages.length, 1);
  assert.equal(service.list().find(a => a.id === event.id).currentValue, 9);
  await reading(30, 5); assert.ok(service.list().find(a => a.id === event.id).resolvedAt);
  await reading(35, 0); await reading(45, 0);
  assert.equal(service.list().find(a => a.metric && !a.resolvedAt).comparison, '<');
  assert.equal(messages.length, 2);
});

test('critical temperature ignores failed sensors and missing data never implies recovery', async t => {
  const { service } = setup(t);
  const thresholds = service.publicSettings().thresholds;
  thresholds.waterTemperature = { enabled: true, min: null, max: 10, holdSeconds: 0 };
  service.update({ ...input, enabled: false, thresholds });
  const now = Date.now(), machines = [{ id: 'one', name: 'Test' }], s = state(now, false), states = new Map([['one', s]]);
  s.latest.usb.waterTemperature = { value: 99, ts: now };
  await service.evaluate(machines, states, now);
  assert.equal(service.list().filter(a => a.metric).length, 0);
  s.latest.usb.temperatureSensorStatus.value = true;
  await service.evaluate(machines, states, now + 1000);
  const alarm = service.list().find(a => a.metric);
  assert.ok(alarm);
  s.usb.connected = false;
  await service.evaluate(machines, states, now + 2000);
  assert.equal(service.list().find(a => a.id === alarm.id).resolvedAt, null);
  service.update({ ...input, enabled: false, thresholds: { ...thresholds, waterTemperature: { ...thresholds.waterTemperature, enabled: false } } });
  await service.evaluate(machines, states, now + 3000);
  assert.equal(service.list().find(a => a.id === alarm.id).resolution, 'ปิดใช้งานเกณฑ์');
});

test('thresholds validate numeric bounds and migrate stored settings without inventing limits', t => {
  const { dir, service } = setup(t);
  const thresholds = service.publicSettings().thresholds;
  assert.ok(Object.values(thresholds).every(t => !t.enabled && t.min === null && t.max === null));
  for (const invalid of [{ enabled: true, min: null, max: null, holdSeconds: 30 }, { enabled: true, min: 5, max: 2, holdSeconds: 30 }, { enabled: true, min: null, max: 10, holdSeconds: -1 }, { enabled: true, min: null, max: '10', holdSeconds: 30 }]) {
    assert.throws(() => service.update({ ...input, thresholds: { ...thresholds, waterTemperature: invalid } }), /เกณฑ์วิกฤต/);
  }
  fs.writeFileSync(path.join(dir, 'notifications.json'), JSON.stringify({ settings: { enabled: false, token: '', recipient: '', rules: input.rules }, alarms: [{ id: 'old', rule: 'tank' }, { id: 'old-sensor', rule: 'sensor' }] }));
  const restored = notificationService(dir);
  assert.equal(restored.list()[0].severity, 'info'); assert.equal(restored.list()[1].severity, 'critical');
  assert.equal(restored.publicSettings().thresholds.compressorPower.enabled, false);
});
