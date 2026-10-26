// Passive diagnostics only: never sends serial commands, resets, or raw log output.
const { SerialPort } = require('serialport');
const { serialMessage, values } = require('../lib/readings');
const summary = { bytes: 0, lines: 0, reports: 0, device: {}, destinations: [], connectionCodes: [], signals: [] };
const port = new SerialPort({ path: process.env.SERIAL_PORT || 'COM11', baudRate: Number(process.env.SERIAL_BAUD || 115200), autoOpen: false });
let buffer = '', finished = false;
const add = (key, value) => { if (!summary[key].includes(value)) summary[key].push(value); };
port.on('open', () => {
  console.log('USB open; observing without reset or commands.');
  port.set({ dtr: false, rts: false }, error => { if (error) console.log('Could not release serial control lines.'); });
});
port.on('data', chunk => {
  summary.bytes += chunk.length; buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); summary.lines++;
    const message = serialMessage(line);
    if (message) {
      summary.reports++;
      try { const data = values(message.payload); for (const key of ['deviceName', 'wifiIp', 'wifiSignalStrength']) if (key in data) summary.device[key] = data[key]; } catch {}
      continue;
    }
    if (/waiting for download/i.test(line)) add('signals', 'bootloader-waiting-for-download');
    if (/wifi.*config.*ap|config.*portal|access.point/i.test(line)) add('signals', 'wifi-configuration-mode');
    if (/wifi.*connected|connected.*wifi/i.test(line)) add('signals', 'wifi-connected-message');
    if (/mqtt.*connected|connected.*mqtt/i.test(line) && !/disconnected|not connected|failed/i.test(line)) add('signals', 'mqtt-connected-message');
    if (/mqtt|server|broker|connect/i.test(line)) {
      if (/failed|error|disconnect/i.test(line)) add('signals', 'network-or-mqtt-error-message');
      const code = line.match(/(?:rc|state|error code)\s*[:=]\s*(-?\d+)/i);
      if (code) add('connectionCodes', Number(code[1]));
      // Skip credential-related lines entirely; print only isolated endpoints.
      if (!/password|passwd|secret|token|ssid|credential|provision|username/i.test(line)) {
        for (const endpoint of line.matchAll(/\b(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.(?:com|org|net|io|cloud|local|th))(?::\d{2,5})?\b/gi)) add('destinations', endpoint[0]);
      }
    }
  }
  if (buffer.length > 65536) buffer = '';
});
function finish() {
  if (finished) return; finished = true; clearInterval(progress); clearTimeout(timer);
  console.log(JSON.stringify(summary));
  if (port.isOpen) port.close();
}
port.on('error', error => { console.log('Serial unavailable:', error.message.replace(/\r|\n/g, ' ').slice(0, 180)); process.exitCode = 1; finish(); });
const progress = setInterval(() => console.log(JSON.stringify({ bytes: summary.bytes, lines: summary.lines, reports: summary.reports, signals: summary.signals })), 10000);
const timer = setTimeout(finish, 45000);
process.once('SIGINT', finish);
port.open(() => {});
