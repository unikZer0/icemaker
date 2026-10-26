const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { SerialPort } = require('serialport');
const createBroker = require('aedes');
const { TOPICS, serialMessage, values } = require('./lib/readings');
const { fleetStore, newState } = require('./lib/fleet');
const { authManager } = require('./lib/auth');
const { notificationService } = require('./lib/notifications');

function start(options = {}) {
  const database = options.database;
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const configFile = path.join(dataDir, 'config.json');
  const config = { token: options.token || process.env.MQTT_TOKEN || database?.machines[0]?.token || (fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')).token : crypto.randomBytes(24).toString('hex')) };
  const bridgeToken = options.bridgeToken || process.env.USB_BRIDGE_TOKEN || database?.machines[0]?.bridgeToken;
  const usbMode = options.usbMode || process.env.USB_MODE || 'local';
  if (bridgeToken === config.token) throw new Error('USB_BRIDGE_TOKEN and MQTT_TOKEN must be different');
  if (usbMode === 'bridge' && !bridgeToken) throw new Error('USB_BRIDGE_TOKEN is required in bridge mode');
  if (!config.token) throw new Error('Missing MQTT token in local config');
  if (!database && !options.token && !process.env.MQTT_TOKEN && !fs.existsSync(configFile)) fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
  const fleet = fleetStore(dataDir, config.token, bridgeToken, database);
  const auth = authManager(database?.admin ? { ...options.auth, username: database.admin.username, passwordHash: database.admin.password_hash, passwordSalt: database.admin.password_salt } : options.auth);
  const notifications = notificationService(dataDir, { fetch: options.lineFetch, database });
  const historyFile = path.join(dataDir, 'readings.ndjson');
  const retention = 24 * 3600000;
  let history = [];
  if (!database && fs.existsSync(historyFile)) {
    for (const line of fs.readFileSync(historyFile, 'utf8').split('\n')) {
      try { const record = JSON.parse(line); record.machineId ||= fleet.defaultId; if (record.ts > Date.now() - retention) history.push(record); } catch { /* Ignore interrupted final write. */ }
    }
    fs.writeFileSync(historyFile, history.map(r => JSON.stringify(r) + '\n').join(''));
  }
  const state = fleet.states.get(fleet.originalId) || newState();
  let port, retry, stopping = false;
  let writeQueue = Promise.resolve();
  function event(message, machineId = fleet.defaultId) { const state = fleet.states.get(machineId); if (!state) return; state.events.unshift({ ts: Date.now(), message }); state.events = state.events.slice(0, 20); }
  function ingest(source, payload, machineId = fleet.defaultId) {
    const state = fleet.states.get(machineId);
    const data = values(payload);
    if (!Object.keys(data).length) return;
    const ts = Date.now();
    const record = { ts, machineId, source, values: data };
    // Persist before advertising a new reading. Chain writes to preserve arrival order.
    writeQueue = writeQueue.then(() => database ? database.appendReading(record) : fs.promises.appendFile(historyFile, JSON.stringify(record) + '\n')).then(() => {
      state[source].lastSeen = ts;
      for (const [key, value] of Object.entries(data)) state.latest[source][key] = { value, ts };
      if (!database) { history.push(record); history = history.filter(r => r.ts > ts - retention).slice(-100000); }
    }).catch(() => event('ไม่สามารถบันทึกข้อมูลได้ กรุณาตรวจสอบพื้นที่ดิสก์และสิทธิ์โฟลเดอร์ข้อมูล', machineId));
  }
  async function disconnectUsb() {
    clearInterval(retry); retry = undefined;
    const previous = port; port = undefined;
    state.usb.connected = false;
    if (previous) {
      if (previous.opening) await new Promise(resolve => { previous.once('open', resolve); previous.once('error', resolve); });
      if (previous.isOpen) await new Promise(resolve => previous.close(resolve));
    }
  }
  async function connectUsb(devicePath, baudRate) {
    await disconnectUsb();
    state.usb = { connected: false, path: devicePath, error: '', lastSeen: 0, started: 0, bytesReceived: 0, reportsReceived: 0, bootloader: false };
    state.latest.usb = {};
    const current = new SerialPort({ path: devicePath, baudRate, autoOpen: false });
    port = current;
    let buffer = '';
    current.on('open', () => {
      if (port !== current) return;
      state.usb.connected = true; state.usb.started = Date.now(); state.usb.error = ''; state.latest.usb = {}; buffer = '';
      state.usb.bytesReceived = 0; state.usb.reportsReceived = 0; state.usb.bootloader = false;
      current.set({ dtr: false, rts: false }, error => { if (error) event('ไม่สามารถปล่อยสัญญาณควบคุม USB ได้'); });
      event('เชื่อมต่อ USB แล้ว: ' + devicePath);
    });
    current.on('data', chunk => {
      if (port !== current) return;
      state.usb.bytesReceived += chunk.length;
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (/waiting for download/i.test(line)) state.usb.bootloader = true;
        const message = serialMessage(line);
        if (message) { state.usb.bootloader = false; state.usb.reportsReceived++; try { ingest('usb', message.payload, fleet.originalId); } catch { event('ไม่รู้จักรูปแบบข้อมูล USB ที่ได้รับ'); } }
      }
      if (buffer.length > 65536) buffer = '';
    });
    current.on('error', () => { if (port === current) { state.usb.connected = false; state.usb.error = 'ไม่สามารถเปิดหรืออ่านพอร์ตนี้ได้ กรุณาตรวจสอบสายและปิดโปรแกรมอ่านพอร์ตอื่น'; } });
    current.on('close', () => { if (port === current) { state.usb.connected = false; event('USB ถูกตัดการเชื่อมต่อ กำลังรอเชื่อมต่อใหม่'); } });
    const open = () => { if (!stopping && port === current && !current.isOpen && !current.opening) current.open(() => {}); };
    open(); retry = setInterval(open, 5000);
  }

  const broker = createBroker({ connectTimeout: 10000 });
  const clients = new Set();
  const bridgeClients = new Set();
  const runtimes = new Map();
  function runtime(id) { if (!runtimes.has(id)) runtimes.set(id, { heartbeat: 0, session: '' }); return runtimes.get(id); }
  const machineClients = (set, id) => [...set].filter(c => c.machineId === id);
  const statusTopic = 'icemaker/usb/status';
  broker.authenticate = (client, username, password, done) => {
    const input = Buffer.from(username || '');
    const matches = token => { const expected = Buffer.from(token || ''); return expected.length > 0 && input.length === expected.length && crypto.timingSafeEqual(input, expected); };
    const machine = fleet.machines.find(m => matches(m.bridgeToken) || matches(m.token));
    client.machineId = machine?.id;
    client.source = machine ? (matches(machine.bridgeToken) ? 'usb' : 'wifi') : null;
    if (client.source === 'usb' && machineClients(bridgeClients, machine.id).some(c => c.id !== client.id)) return done(null, false);
    done(null, Boolean(client.source));
  };
  broker.authorizePublish = (client, packet, done) => {
    if (!fleet.machines.some(m => m.id === client?.machineId)) return done(new Error('Device removed'));
    if (client?.source === 'usb' && packet.topic === statusTopic && packet.payload.length <= 2048) {
      try {
        const status = JSON.parse(packet.payload.toString());
        if (typeof status.connected !== 'boolean' || typeof status.path !== 'string' || status.path.length > 256 || typeof status.session !== 'string' || status.session.length > 128) throw new Error();
        return done(null);
      } catch { return done(new Error('Invalid USB status')); }
    }
    if (!TOPICS.has(packet.topic) || packet.payload.length > 65536) return done(new Error('Unsupported topic or payload size'));
    try { values(JSON.parse(packet.payload.toString())); done(null); } catch { done(new Error('Invalid device JSON')); }
  };
  // Device credentials never grant access to other devices' data.
  broker.authorizeSubscribe = (client, subscription, done) => done(null, null);
  broker.on('clientReady', client => {
    if (!fleet.machines.some(m => m.id === client.machineId)) { client.close(); return; }
    const state = fleet.states.get(client.machineId);
    if (client.source === 'usb') { bridgeClients.add(client); event('โปรแกรมตัวเชื่อมต่อ USB บน Windows เชื่อมต่อแล้ว', client.machineId); return; }
    if (!machineClients(clients, client.machineId).length) { state.wifi.started = Date.now(); state.latest.wifi = {}; }
    clients.add(client); state.wifi.clients = machineClients(clients, client.machineId).length; state.wifi.connected = true;
    event('อุปกรณ์ MQTT ผ่าน Wi-Fi เชื่อมต่อแล้ว', client.machineId);
  });
  broker.on('clientDisconnect', client => {
    const state = fleet.states.get(client.machineId);
    if (!state) return;
    if (client.source === 'usb') { bridgeClients.delete(client); if (!machineClients(bridgeClients, client.machineId).length) state.usb.connected = false; return; }
    clients.delete(client); state.wifi.clients = machineClients(clients, client.machineId).length; state.wifi.connected = state.wifi.clients > 0;
  });
  broker.on('publish', (packet, client) => {
    if (!client || packet.retain) return;
    const state = fleet.states.get(client.machineId), connection = runtime(client.machineId);
    if (!state) return;
    if (client.source === 'usb' && packet.topic === statusTopic) {
      try {
        const status = JSON.parse(packet.payload.toString());
        if (status.session !== connection.session) { connection.session = status.session; state.usb.started = Date.now(); state.latest.usb = {}; }
        connection.heartbeat = Date.now(); state.usb.connected = status.connected; state.usb.path = status.path;
        state.usb.bytesReceived = Number(status.bytesReceived) || 0; state.usb.reportsReceived = Number(status.reportsReceived) || 0;
        state.usb.bootloader = status.bootloader === true;
      } catch { event('ไม่รู้จักรูปแบบสถานะจากตัวเชื่อมต่อ USB'); }
      return;
    }
    if (!TOPICS.has(packet.topic)) return;
    if (client.source === 'usb' && (!state.usb.connected || Date.now() - connection.heartbeat > 15000)) return;
    try { ingest(client.source, JSON.parse(packet.payload.toString()), client.machineId); } catch { event('ไม่รู้จักรูปแบบข้อมูลจากอุปกรณ์', client.machineId); }
  });
  broker.on('clientError', () => event('อุปกรณ์ MQTT หลุดจากการเชื่อมต่อเนื่องจากข้อผิดพลาดของโปรโตคอลหรือข้อมูลยืนยันตัวตน'));
  broker.on('connectionError', () => {});
  const mqttTls = options.mqttTls ?? process.env.MQTT_TLS === 'true';
  const mqttServer = mqttTls ? tls.createServer({ key: fs.readFileSync(process.env.MQTT_TLS_KEY), cert: fs.readFileSync(process.env.MQTT_TLS_CERT), minVersion: 'TLSv1.2' }, broker.handle) : net.createServer(broker.handle);
  mqttServer.on('error', error => { state.wifi.error = error.code === 'EADDRINUSE' ? 'พอร์ต MQTT ถูกใช้งานอยู่ กรุณาเปลี่ยน MQTT_PORT เป็นพอร์ตว่างแล้วเริ่มระบบใหม่' : 'เซิร์ฟเวอร์ MQTT ไม่พร้อมใช้งาน: ' + error.code; event(state.wifi.error); });
  const mqttPort = options.mqttPort ?? Number(process.env.MQTT_PORT || 1884);
  mqttServer.listen(mqttPort, options.mqttHost || process.env.MQTT_HOST || '0.0.0.0');
  const addresses = () => process.env.MQTT_ADVERTISED_HOST ? [process.env.MQTT_ADVERTISED_HOST] : Object.values(os.networkInterfaces()).flat().filter(a => a.family === 'IPv4' && !a.internal).map(a => a.address);
  const publicDir = path.join(__dirname, 'public');
  function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  async function body(req) {
    if (req.headers['content-type'] !== 'application/json') throw Object.assign(new Error('ต้องส่งข้อมูลในรูปแบบ JSON'), { status: 415 });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) throw Object.assign(new Error('ข้อมูลคำขอมีขนาดใหญ่เกินไป'), { status: 413 }); }
    try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('รูปแบบ JSON ไม่ถูกต้อง'), { status: 400 }); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
    if (auth.origin) allowedHosts.add(new URL(auth.origin).hostname);
    if (!allowedHosts.has((req.headers.host || '').replace(/:\d+$/, ''))) return json(res, 403, { error: 'กรุณาเปิดแดชบอร์ดผ่าน localhost' });
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'POST' && req.headers.origin && req.headers.origin !== (auth.origin || 'http://' + req.headers.host)) return json(res, 403, { error: 'ระบบปฏิเสธคำขอจากเว็บไซต์อื่น' });
      if (req.method === 'GET' && url.pathname === '/api/health') { const ok = mqttServer.listening && (!database || await database.healthy()); return json(res, ok ? 200 : 503, { ok, storage: database ? 'postgresql' : 'files' }); }
      if (req.method === 'GET' && url.pathname === '/api/auth/session') return json(res, 200, { enabled: auth.enabled, authenticated: auth.authorized(req), username: auth.authorized(req) ? auth.username : null });
      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const result = auth.login(req, await body(req));
        if (result.cookie) res.setHeader('Set-Cookie', result.cookie);
        return json(res, result.status || 200, { ok: Boolean(result.ok), error: result.error });
      }
      if (url.pathname.startsWith('/api/') && !auth.authorized(req)) return json(res, 401, { error: 'กรุณาเข้าสู่ระบบเพื่อดูเครื่องของคุณ' });
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') { res.setHeader('Set-Cookie', auth.logout(req)); return json(res, 200, { ok: true }); }
      if (req.method === 'GET' && url.pathname === '/api/notifications') return json(res, 200, notifications.publicSettings());
      if (req.method === 'POST' && url.pathname === '/api/notifications') return json(res, 200, await notifications.update(await body(req)));
      if (req.method === 'POST' && url.pathname === '/api/notifications/test') { await body(req); return json(res, 200, await notifications.test()); }
      if (req.method === 'GET' && url.pathname === '/api/alarms') return json(res, 200, notifications.list());
      if (req.method === 'POST' && url.pathname === '/api/alarms/acknowledge') { await notifications.acknowledge((await body(req)).id); return json(res, 200, { ok: true }); }
      if (req.method === 'GET' && url.pathname === '/api/machines') {
        const savedLastSeen = database ? await database.lastSeen() : null;
        return json(res, 200, fleet.machines.map(machine => {
          const state = fleet.states.get(machine.id);
          const lastSeen = Math.max(state.usb.lastSeen, state.wifi.lastSeen, savedLastSeen?.get(machine.id) || history.findLast(r => r.machineId === machine.id)?.ts || 0);
          const online = ['usb', 'wifi'].some(source => state[source].connected && Date.now() - state[source].lastSeen < 90000);
          return { id: machine.id, name: machine.name, location: machine.location, connection: machine.connection, createdAt: machine.createdAt, lastSeen, online };
        }));
      }
      if (req.method === 'POST' && url.pathname === '/api/machines') {
        const input = await body(req);
        try { const machine = await fleet.create(input); return json(res, 201, { id: machine.id }); }
        catch (error) { return json(res, error.code ? 503 : 400, { error: error.code ? 'ไม่สามารถบันทึกอุปกรณ์ลงฐานข้อมูลได้' : error.message }); }
      }
      const editMatch = url.pathname.match(/^\/api\/machines\/([a-zA-Z0-9-]+)$/);
      const removeMatch = url.pathname.match(/^\/api\/machines\/([a-zA-Z0-9-]+)\/delete$/);
      if (req.method === 'POST' && removeMatch) {
        const input = await body(req), machine = fleet.machines.find(m => m.id === removeMatch[1]);
        if (!machine) return json(res, 404, { error: 'ไม่พบอุปกรณ์' });
        if (input.confirmName !== machine.name) return json(res, 400, { error: 'ชื่ออุปกรณ์ที่ยืนยันไม่ตรงกัน' });
        await fleet.remove(machine.id);
        for (const client of [...clients, ...bridgeClients]) if (client.machineId === machine.id) client.close();
        if (machine.id === fleet.originalId) await disconnectUsb();
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && editMatch) {
        if (!fleet.machines.some(m => m.id === editMatch[1])) return json(res, 404, { error: 'ไม่พบเครื่องที่ระบุ' });
        const input = await body(req);
        try { await fleet.update(editMatch[1], input); return json(res, 200, { ok: true }); }
        catch (error) { return json(res, error.code ? 503 : 400, { error: error.code ? 'ไม่สามารถบันทึกอุปกรณ์ลงฐานข้อมูลได้' : error.message }); }
      }
      const machineId = url.searchParams.get('machine') || fleet.defaultId;
      const machine = fleet.machines.find(m => m.id === machineId);
      if (url.pathname.startsWith('/api/') && !machine) return json(res, 404, { error: 'ไม่พบเครื่องที่ระบุ' });
      const machineState = fleet.states.get(machineId);
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { ...machineState, machine: { id: machine.id, name: machine.name, location: machine.location, connection: machine.connection }, usbMode, now: Date.now(), freshnessMs: 90000 });
      if (req.method === 'GET' && url.pathname === '/api/setup') return json(res, 200, { id: machine.id, name: machine.name, location: machine.location, connection: machine.connection, addresses: addresses(), mqttPort: Number(process.env.MQTT_ADVERTISED_PORT) || mqttServer.address()?.port || mqttPort, protocol: mqttTls ? 'mqtts' : 'mqtt', token: machine.token, bridgeToken: machine.bridgeToken, topics: [...TOPICS] });
      if (req.method === 'GET' && url.pathname === '/api/ports') return json(res, 200, usbMode === 'bridge' ? [] : await SerialPort.list());
      if (req.method === 'GET' && url.pathname === '/api/history') {
        const hours = Number(url.searchParams.get('hours') || 1);
        if (![1, 6, 24].includes(hours)) return json(res, 400, { error: 'กรุณาเลือกช่วงเวลา 1, 6 หรือ 24 ชั่วโมง' });
        const source = url.searchParams.get('source');
        if (!['usb', 'wifi'].includes(source)) return json(res, 400, { error: 'กรุณาเลือก USB หรือ Wi-Fi' });
        return json(res, 200, database ? await database.history(machineId, source, Date.now() - hours * 3600000) : history.filter(r => r.machineId === machineId && r.ts > Date.now() - hours * 3600000 && r.source === source));
      }
      if (req.method === 'POST') {
        const input = await body(req);
        if (url.pathname.startsWith('/api/usb/') && usbMode === 'bridge') return json(res, 409, { error: 'USB จัดการผ่านตัวเชื่อมต่อบน Windows กรุณาเรียกใช้ npm run usb บน Windows' });
        if (url.pathname.startsWith('/api/usb/') && machineId !== fleet.originalId) return json(res, 409, { error: 'ใช้เกตเวย์ USB กับโทเคนของเครื่องนี้ ปุ่มควบคุม USB โดยตรงใช้ได้เฉพาะเครื่องแรกบนคอมพิวเตอร์นี้' });
        if (url.pathname === '/api/usb/connect') {
          const ports = await SerialPort.list();
          if (!ports.some(p => p.path === input.path) || ![9600, 19200, 38400, 57600, 115200].includes(input.baudRate)) return json(res, 400, { error: 'กรุณาเลือกพอร์ตที่ตรวจพบและอัตราบอดที่รองรับ' });
          await connectUsb(input.path, input.baudRate); return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/usb/disconnect') { await disconnectUsb(); return json(res, 200, { ok: true }); }
      }
      if (req.method !== 'GET') return json(res, 404, { error: 'ไม่พบเส้นทางที่ร้องขอ' });
      const files = { '/': 'workspace.html', '/home': 'workspace.html', '/alarms': 'workspace.html', '/dashboards': 'workspace.html', '/notifications': 'workspace.html', '/devices': 'machines.html', '/machines': 'machines.html', '/dashboard': 'index.html', '/login': 'login.html', '/login.js': 'login.js', '/machines.js': 'machines.js', '/app.js': 'app.js', '/style.css': 'style.css', '/navigation.js': 'navigation.js', '/workspace.js': 'workspace.js', '/workspace.css': 'workspace.css' };
      const file = files[url.pathname];
      if (!file) return json(res, 404, { error: 'ไม่พบข้อมูล' });
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
      fs.createReadStream(path.join(publicDir, file)).pipe(res);
    } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : 'ไม่สามารถดำเนินการได้ กรุณาตรวจสอบการเชื่อมต่ออุปกรณ์แล้วลองอีกครั้ง' }); }
  });
  const httpPort = options.httpPort ?? Number(process.env.PORT || 3100);
  server.listen(httpPort, options.httpHost || process.env.HTTP_HOST || '127.0.0.1', () => { if (!options.quiet) console.log(`IceMaker: http://localhost:${server.address().port}\nWi-Fi MQTT port: ${mqttPort} (setup in dashboard)`); });
  server.on('error', error => { console.error('Dashboard listener:', error.code); });
  // Compact the on-disk log every hour; all file operations share the write queue.
  const compact = setInterval(() => {
    writeQueue = writeQueue.then(async () => {
      if (database) { await database.prune(); return; }
      history = history.filter(r => r.ts > Date.now() - retention).slice(-100000);
      const tmp = historyFile + '.tmp';
      await fs.promises.writeFile(tmp, history.map(r => JSON.stringify(r) + '\n').join(''));
      await fs.promises.rename(tmp, historyFile);
    }).catch(() => event('ไม่สามารถจัดระเบียบพื้นที่เก็บประวัติได้'));
  }, 3600000);
  const bridgeWatchdog = setInterval(() => { for (const [id, connection] of runtimes) if (Date.now() - connection.heartbeat > 15000 && machineClients(bridgeClients, id).length) fleet.states.get(id).usb.connected = false; }, 1000);
  let notificationWork = Promise.resolve();
  const notificationTimer = setInterval(() => { notificationWork = notificationWork.then(() => notifications.evaluate(fleet.machines, fleet.states)).catch(() => event('ไม่สามารถบันทึกการแจ้งเตือนได้')); }, 5000);
  async function close() {
    stopping = true; clearInterval(compact); clearInterval(bridgeWatchdog); clearInterval(notificationTimer); await notificationWork; await disconnectUsb();
    for (const client of [...clients, ...bridgeClients]) client.close();
    await new Promise(resolve => broker.close(resolve));
    if (mqttServer.listening) await new Promise(resolve => mqttServer.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await writeQueue;
    if (database) await database.close();
  }
  return { server, mqttServer, close };
}
if (require.main === module) {
  (async () => {
    const backend = process.env.STORAGE_BACKEND || (process.env.PGHOST ? 'postgres' : 'files');
    if (!['postgres', 'files'].includes(backend)) throw new Error('Unsupported STORAGE_BACKEND');
    const database = backend === 'postgres' ? await require('./lib/database').openDatabase() : undefined;
    let app;
    try { app = start({ database }); } catch (error) { if (database) await database.close(); throw error; }
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit()));
  })().catch(error => { console.error('Startup failed:', error.code || 'Check database configuration, migration data and encryption key.'); process.exitCode = 1; });
}
module.exports = { start };
