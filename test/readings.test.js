const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serialMessage, values } = require('../lib/readings');
test('accepts the existing CloudMeter serial protocol with CRLF', () => {
  const message = serialMessage('[TB] Sending data to server over topic (v1/devices/me/telemetry) with data ({"acLineVoltage":23.5,"compressorCurrent":4.24})\r');
  assert.equal(message.payload.acLineVoltage, 23.5);
  assert.equal(message.payload.compressorCurrent, 4.24);
});
test('ignores provisioning, secrets, malformed payloads, and boot logs', () => {
  assert.equal(serialMessage('waiting for download'), null);
  assert.equal(serialMessage('[TB] Sending data to server over topic (/provision) with data ({"token":"private"})'), null);
  assert.equal(serialMessage('[TB] Sending data to server over topic (v1/devices/me/telemetry) with data ({broken})'), null);
  assert.deepEqual(values({ token: 'secret', ssid: 'private', temperatureSensorStatus: false, waterTemperature: 0 }), { temperatureSensorStatus: false, waterTemperature: 0 });
  assert.throws(() => values([]));
  assert.deepEqual(values({ ts: 10, values: { compressorCurrent: 1.2 } }), { compressorCurrent: 1.2 });
});
