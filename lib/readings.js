const TOPICS = new Set(['v1/devices/me/telemetry', 'v1/devices/me/attributes']);
const FIELDS = new Set(['acLineVoltage', 'compressorCurrent', 'compressorPower', 'waterTemperature', 'deviceName', 'temperatureSensorStatus', 'compressorStatus', 'machineTankFull', 'machineCycleCount', 'machineInterCycleTime', 'compressorRunTime', 'wifiSignalStrength', 'wifiIp']);
function serialMessage(line) {
  const match = line.match(/\[TB\] Sending data to server over topic \(([^)]+)\) with data \((\{.*\})\)/);
  if (!match || !TOPICS.has(match[1])) return null;
  try { return { topic: match[1], payload: JSON.parse(match[2]) }; } catch { return null; }
}
function values(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Expected a JSON object');
  const data = payload.values && typeof payload.values === 'object' ? payload.values : payload;
  return Object.fromEntries(Object.entries(data).filter(([key, value]) => FIELDS.has(key) && (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 256))));
}
function isFalse(value) { return value === false || value === 'false'; }
module.exports = { TOPICS, serialMessage, values, isFalse };
