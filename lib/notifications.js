const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RULES = { offline: 'อุปกรณ์ขาดการเชื่อมต่อ', sensor: 'เซนเซอร์อุณหภูมิไม่พร้อมใช้งาน', tank: 'ถังน้ำแข็งเต็ม' };
const METRICS = { waterTemperature: 'อุณหภูมิน้ำ', acLineVoltage: 'แรงดันไฟฟ้า AC', compressorCurrent: 'กระแสไฟคอมเพรสเซอร์', compressorPower: 'กำลังไฟคอมเพรสเซอร์' };
const defaultThresholds = () => Object.fromEntries(Object.keys(METRICS).map(key => [key, { enabled: false, min: null, max: null, holdSeconds: 30 }]));
function notificationService(dataDir, options = {}) {
  const file = path.join(dataDir, 'notifications.json');
  let stored = options.database ? structuredClone(options.database.notificationState) : fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  let settings = { enabled: false, token: '', recipient: '', rules: { offline: true, sensor: true, tank: false }, ...stored.settings };
  settings.rules = { critical: true, ...settings.rules };
  settings.thresholds = { ...defaultThresholds(), ...settings.thresholds };
  let alarms = stored.alarms || [];
  const observed = new Map(), attempts = new Map(), pending = new Map();
  let busy = false;
  const send = options.fetch || fetch;
  function persist(nextSettings = settings, nextAlarms = alarms) {
    if (options.database) return options.database.saveNotifications(nextSettings, nextAlarms).then(() => { settings = nextSettings; alarms = nextAlarms; });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ settings: nextSettings, alarms: nextAlarms }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    settings = nextSettings; alarms = nextAlarms;
  }
  function publicSettings() { const { token, ...safe } = settings; return { ...structuredClone(safe), hasToken: Boolean(token) }; }
  function update(input) {
    const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
    if (!input || typeof input.enabled !== 'boolean' || typeof input.recipient !== 'string' || !input.rules || Object.keys(RULES).some(k => typeof input.rules[k] !== 'boolean')) invalid('กรุณาระบุการตั้งค่าให้ครบถ้วน');
    const recipient = input.recipient.trim();
    if (recipient && !/^[UCR][a-fA-F0-9]{32}$/.test(recipient)) invalid('User ID / Group ID / Room ID ของ LINE ไม่ถูกต้อง');
    if (input.token !== undefined && (typeof input.token !== 'string' || input.token.length > 2048 || /\s/.test(input.token))) invalid('Channel access token ไม่ถูกต้อง');
    const token = input.clearToken ? '' : input.token || settings.token;
    if (input.enabled && (!token || !recipient)) invalid('กรุณาระบุโทเคนและผู้รับก่อนเปิดใช้งาน');
    const thresholds = input.thresholds === undefined ? settings.thresholds : input.thresholds;
    if (!thresholds || typeof thresholds !== 'object' || Object.keys(METRICS).some(key => {
      const t = thresholds[key];
      return !t || typeof t.enabled !== 'boolean' || !Number.isInteger(t.holdSeconds) || t.holdSeconds < 0 || t.holdSeconds > 3600 || [t.min, t.max].some(v => v !== null && (typeof v !== 'number' || !Number.isFinite(v))) || (t.min !== null && t.max !== null && t.min >= t.max) || (t.enabled && t.min === null && t.max === null);
    })) invalid('เกณฑ์วิกฤตไม่ถูกต้อง: ระบุค่าต่ำสุด/สูงสุดอย่างน้อยหนึ่งค่า ค่าต่ำสุดต้องน้อยกว่าสูงสุด และเวลายืนยัน 0–3600 วินาที');
    if (input.rules.critical !== undefined && typeof input.rules.critical !== 'boolean') invalid('การตั้งค่าส่งเหตุการณ์วิกฤตไม่ถูกต้อง');
    const cleanThresholds = Object.fromEntries(Object.keys(METRICS).map(key => { const { enabled, min, max, holdSeconds } = thresholds[key]; return [key, { enabled, min, max, holdSeconds }]; }));
    const saved = persist({ enabled: input.enabled, recipient, token, rules: { ...Object.fromEntries(Object.keys(RULES).map(k => [k, input.rules[k]])), critical: input.rules.critical ?? settings.rules.critical }, thresholds: cleanThresholds });
    pending.clear();
    return saved ? saved.then(publicSettings) : publicSettings();
  }
  async function push(text, retryKey) {
    if (!settings.token || !settings.recipient) throw Object.assign(new Error('กรุณาบันทึกโทเคนและผู้รับ LINE ก่อนทดสอบ'), { status: 400 });
    let response;
    try {
      response = await send('https://api.line.me/v2/bot/message/push', {
        method: 'POST', headers: { Authorization: 'Bearer ' + settings.token, 'Content-Type': 'application/json', 'X-Line-Retry-Key': retryKey },
        body: JSON.stringify({ to: settings.recipient, messages: [{ type: 'text', text }] }), signal: AbortSignal.timeout(10000),
      });
    } catch { throw Object.assign(new Error('เชื่อมต่อ LINE ไม่สำเร็จ กรุณาลองใหม่'), { status: 502 }); }
    if (!response.ok && !(response.status === 409 && response.headers?.get('x-line-accepted-request-id'))) throw Object.assign(new Error('LINE ปฏิเสธคำขอ (HTTP ' + response.status + ') กรุณาตรวจสอบโทเคน ผู้รับ และโควตาข้อความ'), { status: 502 });
  }
  async function test() { await push('AACC IceMaker: ทดสอบการแจ้งเตือน LINE สำเร็จ', crypto.randomUUID()); return { ok: true }; }
  function list() { return alarms.map(a => ({ ...a, severity: a.severity || (a.rule === 'tank' ? 'info' : 'critical') })); }
  function acknowledge(id) {
    if (!alarms.some(a => a.id === id)) throw Object.assign(new Error('ไม่พบการแจ้งเตือน'), { status: 404 });
    return persist(settings, alarms.map(a => a.id === id ? { ...a, acknowledgedAt: Date.now() } : a));
  }
  async function evaluate(machines, states, now = Date.now()) {
    if (busy) return;
    busy = true;
    try {
      let next = alarms.map(a => ({ ...a }));
      const activeIds = new Set(machines.map(m => m.id));
      for (const alarm of next) if (!activeIds.has(alarm.machineId) && !alarm.resolvedAt) { alarm.resolvedAt = now; alarm.resolution = 'อุปกรณ์ถูกลบออกจากระบบ'; }
      for (const machine of machines) {
        const state = states.get(machine.id);
        const sources = ['wifi', 'usb'].filter(source => state[source].connected && state[source].lastSeen > 0 && now - state[source].lastSeen < 90000);
        const lastSeen = Math.max(state.usb.lastSeen, state.wifi.lastSeen);
        if (lastSeen) observed.set(machine.id, true);
        const field = key => {
          for (const source of sources) { const v = state.latest[source][key]; if (v && v.ts >= (state[source].started || 0) && now - v.ts < 90000) return v.value; }
        };
        const conditions = { offline: !sources.length && observed.has(machine.id), sensor: [false, 'false'].includes(field('temperatureSensorStatus')), tank: [true, 'true'].includes(field('machineTankFull')) };
        for (const [rule, active] of Object.entries(conditions)) {
          const current = next.find(a => a.machineId === machine.id && a.rule === rule && !a.resolvedAt);
          if (active && !current) next.unshift({ id: crypto.randomUUID(), machineId: machine.id, machineName: machine.name, rule, message: RULES[rule], severity: rule === 'tank' ? 'info' : 'critical', createdAt: now, resolvedAt: null, acknowledgedAt: null, delivery: 'pending' });
          // Missing/stale sensor values are unknown, not proof of recovery.
          else if (!active && current && (rule === 'offline' || field(rule === 'sensor' ? 'temperatureSensorStatus' : 'machineTankFull') !== undefined)) current.resolvedAt = now;
        }
        for (const [metric, label] of Object.entries(METRICS)) {
          const config = settings.thresholds[metric];
          const reading = field(metric);
          const valid = typeof reading === 'number' && Number.isFinite(reading) && !(metric === 'waterTemperature' && ![true, 'true'].includes(field('temperatureSensorStatus')));
          for (const side of ['min', 'max']) {
            const rule = metric + ':' + side, key = machine.id + ':' + rule;
            let current = next.find(a => a.machineId === machine.id && a.rule === rule && !a.resolvedAt);
            const limit = config[side];
            if (!config.enabled || limit === null) { pending.delete(key); if (current) { current.resolvedAt = now; current.resolution = 'ปิดใช้งานเกณฑ์'; } continue; }
            if (current && (current.limit !== limit || current.holdSeconds !== config.holdSeconds)) { current.resolvedAt = now; current.resolution = 'เปลี่ยนเกณฑ์'; current = undefined; pending.delete(key); }
            if (!valid) { pending.delete(key); continue; }
            const outside = side === 'min' ? reading < limit : reading > limit;
            if (!outside) { pending.delete(key); if (current) { current.resolvedAt = now; current.resolution = 'ค่ากลับเข้าสู่เกณฑ์'; } continue; }
            if (current) { current.currentValue = reading; continue; }
            if (!pending.has(key)) pending.set(key, now);
            if (now - pending.get(key) < config.holdSeconds * 1000) continue;
            next.unshift({ id: crypto.randomUUID(), machineId: machine.id, machineName: machine.name, rule, metric, severity: 'critical', message: label + (side === 'min' ? 'ต่ำกว่าเกณฑ์วิกฤต' : 'สูงกว่าเกณฑ์วิกฤต'), currentValue: reading, triggerValue: reading, limit, comparison: side === 'min' ? '<' : '>', holdSeconds: config.holdSeconds, createdAt: now, resolvedAt: null, acknowledgedAt: null, delivery: 'pending' });
            pending.delete(key);
          }
        }
      }
      next = next.filter(a => !a.resolvedAt).concat(next.filter(a => a.resolvedAt).slice(0, 500));
      if (JSON.stringify(next) !== JSON.stringify(alarms)) await persist(settings, next);
      for (const alarm of alarms.filter(a => activeIds.has(a.machineId) && !a.resolvedAt && !a.sentAt && settings.enabled && (a.metric ? settings.rules.critical : settings.rules[a.rule]))) {
        if (now - (attempts.get(alarm.id) || 0) < 60000) continue;
        attempts.set(alarm.id, now);
        try { await push('AACC IceMaker · ' + alarm.machineName + '\n' + (alarm.severity === 'info' || alarm.rule === 'tank' ? '[ข้อมูล] ' : '[วิกฤต] ') + alarm.message + (alarm.metric ? '\nค่าที่พบ ' + alarm.currentValue + ' · เกณฑ์ ' + alarm.comparison + ' ' + alarm.limit : ''), alarm.id); alarm.sentAt = Date.now(); alarm.delivery = 'sent'; delete alarm.deliveryError; }
        catch (error) { alarm.delivery = 'failed'; alarm.deliveryError = error.message; }
        await persist();
      }
    } finally { busy = false; }
  }
  let work = Promise.resolve();
  const serialize = fn => (...args) => { const next = work.then(() => fn(...args)); work = next.catch(() => {}); return next; };
  return { publicSettings, update: options.database ? serialize(update) : update, test, list, acknowledge: options.database ? serialize(acknowledge) : acknowledge, evaluate: options.database ? serialize(evaluate) : evaluate };
}
module.exports = { notificationService, RULES };
