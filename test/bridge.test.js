const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const mqtt = require('mqtt');
const { start } = require('../server');
test('Windows bridge keeps USB separate from Wi-Fi and hides readings on disconnect', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'icemaker-bridge-test-'));
  const app = start({ dataDir, token: 'test-device-only', bridgeToken: 'test-usb-only', usbMode: 'bridge', httpPort: 0, mqttPort: 0, mqttHost: '127.0.0.1', quiet: true });
  let bridge;
  t.after(async () => {
    if (bridge) await bridge.endAsync(true);
    await app.close();
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'icemaker-bridge-test-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  await Promise.all([once(app.server, 'listening'), once(app.mqttServer, 'listening')]);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  bridge = await mqtt.connectAsync(`mqtt://127.0.0.1:${app.mqttServer.address().port}`, { username: 'test-usb-only', reconnectPeriod: 0 });
  const status = { connected: true, path: 'COM11', session: 'session-one', bytesReceived: 100, reportsReceived: 1 };
  await bridge.publishAsync('icemaker/usb/status', JSON.stringify(status), { qos: 1 });
  await bridge.publishAsync('v1/devices/me/telemetry', JSON.stringify({ compressorCurrent: 4.24 }), { qos: 1 });
  let state;
  for (let i = 0; i < 100; i++) {
    state = await (await fetch(base + '/api/state')).json();
    if (state.latest.usb.compressorCurrent) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(state.usb.connected, true); assert.equal(state.usb.path, 'COM11');
  assert.equal(state.latest.usb.compressorCurrent.value, 4.24);
  assert.equal(state.wifi.connected, false); assert.deepEqual(state.latest.wifi, {});
  assert.equal((await fetch(base + '/api/usb/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 409);
  assert.deepEqual(await (await fetch(base + '/api/ports')).json(), []);
  await bridge.publishAsync('icemaker/usb/status', JSON.stringify({ ...status, connected: false }), { qos: 1 });
  state = await (await fetch(base + '/api/state')).json(); assert.equal(state.usb.connected, false);
  await bridge.publishAsync('icemaker/usb/status', JSON.stringify({ ...status, session: 'session-two' }), { qos: 1 });
  state = await (await fetch(base + '/api/state')).json(); assert.deepEqual(state.latest.usb, {});
  assert.equal((await (await fetch(base + '/api/history?source=usb&hours=1')).json()).length, 1);
});
