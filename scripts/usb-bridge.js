// Windows host adapter: COM ports stay on Windows while the service runs in Docker.
const { SerialPort } = require('serialport');
const mqtt = require('mqtt');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { serialMessage, values } = require('../lib/readings');

function startBridge(options = {}) {
  const token = options.token || process.env.USB_BRIDGE_TOKEN;
  if (!token) throw new Error('Set USB_BRIDGE_TOKEN in .env before starting USB.');
  const devicePath = options.path || process.env.SERIAL_PORT || 'COM11';
  const baudRate = Number(options.baudRate || process.env.SERIAL_BAUD || 115200);
  if (![9600, 19200, 38400, 57600, 115200].includes(baudRate)) throw new Error('Unsupported SERIAL_BAUD');
  const statusTopic = 'icemaker/usb/status';
  let closing = false, buffer = '';
  const status = { connected: false, path: devicePath, session: crypto.randomUUID(), bytesReceived: 0, reportsReceived: 0, bootloader: false };
  const protocol = process.env.MQTT_TLS === 'true' ? 'mqtts' : 'mqtt';
  const client = mqtt.connect(options.url || `${protocol}://${process.env.BRIDGE_MQTT_HOST || '127.0.0.1'}:${process.env.MQTT_PORT || 1884}`, {
    username: token, clientId: 'icemaker2-usb-' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 16), reconnectPeriod: 3000,
    ...(process.env.BRIDGE_TLS_CA ? { ca: fs.readFileSync(process.env.BRIDGE_TLS_CA) } : {}),
    will: { topic: statusTopic, payload: JSON.stringify(status), qos: 1, retain: false },
  });
  const port = new SerialPort({ path: devicePath, baudRate, autoOpen: false });
  function report() { if (client.connected && !closing) client.publish(statusTopic, JSON.stringify(status), { qos: 1 }); }
  client.on('connect', () => { console.log('USB agent connected to IceMaker MQTT.'); report(); });
  client.on('error', () => console.error('MQTT connection failed. Check the Docker service, host, port and USB_BRIDGE_TOKEN.'));
  port.on('open', () => {
    buffer = ''; status.connected = true; status.session = crypto.randomUUID(); status.bytesReceived = 0; status.reportsReceived = 0; status.bootloader = false;
    port.set({ dtr: false, rts: false }, error => { if (error) console.error('Could not release USB control lines.'); });
    report(); console.log(`USB opened: ${devicePath} at ${baudRate} baud.`);
  });
  port.on('data', chunk => {
    status.bytesReceived += chunk.length; buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (/waiting for download/i.test(line)) status.bootloader = true;
      const message = serialMessage(line);
      if (!message) continue;
      status.bootloader = false; status.reportsReceived++;
      if (client.connected) {
        report();
        // Filter before forwarding; raw serial output and credentials never leave the adapter.
        const payload = values(message.payload);
        if (Object.keys(payload).length) client.publish(message.topic, JSON.stringify(payload), { qos: 1 });
      }
    }
    if (buffer.length > 65536) buffer = '';
  });
  port.on('error', () => { status.connected = false; report(); console.error(`USB unavailable: ${devicePath}. Close other serial monitors and check the cable. Retrying.`); });
  port.on('close', () => { status.connected = false; report(); if (!closing) console.log('USB cable disconnected. Retrying.'); });
  function open() { if (!closing && !port.isOpen && !port.opening) port.open(() => {}); }
  open();
  const timer = setInterval(() => { open(); report(); }, 5000);
  async function close() {
    clearInterval(timer); status.connected = false;
    if (client.connected) await new Promise(resolve => client.publish(statusTopic, JSON.stringify(status), { qos: 1 }, resolve));
    closing = true;
    if (port.opening) await new Promise(resolve => { port.once('open', resolve); port.once('error', resolve); });
    if (port.isOpen) await new Promise(resolve => port.close(resolve));
    await client.endAsync(true);
  }
  return { close };
}
if (require.main === module) {
  const bridge = startBridge();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => bridge.close().then(() => process.exit()));
}
module.exports = { startBridge };
