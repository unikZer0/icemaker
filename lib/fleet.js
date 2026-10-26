const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function newState() {
  return { usb: { connected: false, path: '', error: '', lastSeen: 0, started: 0, bytesReceived: 0, reportsReceived: 0, bootloader: false }, wifi: { connected: false, clients: 0, error: '', lastSeen: 0, started: 0 }, latest: { usb: {}, wifi: {} }, events: [] };
}
function fleetStore(dataDir, token, bridgeToken, database) {
  const file = path.join(dataDir, 'machines.json');
  const records = database ? structuredClone(database.machines) : fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [{ id: 'cloudmeter-1', name: 'CloudMeter-1', location: '', connection: 'usb', createdAt: Date.now(), token, bridgeToken: bridgeToken || crypto.randomBytes(24).toString('hex') }];
  const machines = records.filter(m => !m.deletedAt);
  // Preserve the original device identity and its environment-managed credentials.
  if (!database && records.length) { records[0].token = token; if (bridgeToken) records[0].bridgeToken = bridgeToken; }
  const states = new Map(machines.map(machine => [machine.id, newState()]));
  function save() { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(records, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
  function fields(input) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw new Error('กรุณาระบุชื่อเครื่องยาว 1–80 ตัวอักษร');
    if (typeof input.location !== 'string' || input.location.length > 120) throw new Error('สถานที่ติดตั้งต้องยาวไม่เกิน 120 ตัวอักษร');
    if (/[\x00-\x1f]/.test(input.name + input.location)) throw new Error('ชื่อเครื่องและสถานที่ติดตั้งต้องอยู่ในบรรทัดเดียว');
    if (!['usb', 'wifi'].includes(input.connection)) throw new Error('กรุณาเลือก USB หรือ Wi-Fi');
    return { name: input.name.trim(), location: input.location.trim(), connection: input.connection };
  }
  async function create(input) {
    if (machines.length >= 100) throw new Error('ระบบนี้รองรับเครื่องได้สูงสุด 100 เครื่อง');
    const machine = { ...fields(input), id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('hex'), bridgeToken: crypto.randomBytes(24).toString('hex'), createdAt: Date.now() };
    if (database) await database.saveMachine(machine, machines.length);
    machines.push(machine);
    records.push(machine);
    if (!database) try { save(); } catch (error) { machines.pop(); records.pop(); throw error; }
    states.set(machine.id, newState()); return machine;
  }
  async function update(id, input) {
    const machine = machines.find(m => m.id === id);
    if (!machine) throw new Error('ไม่พบเครื่องที่ระบุ');
    const previous = { ...machine }, next = { ...machine, ...fields(input) };
    if (database) await database.saveMachine(next, machines.indexOf(machine));
    Object.assign(machine, next);
    if (!database) try { save(); } catch (error) { Object.assign(machine, previous); throw error; }
    return machine;
  }
  if (!database) save();
  async function remove(id) {
    const machine = machines.find(m => m.id === id);
    if (!machine) throw Object.assign(new Error('ไม่พบอุปกรณ์'), { status: 404 });
    if (database) await database.removeMachine(id);
    machine.deletedAt = Date.now();
    if (!database) try { save(); } catch (error) { delete machine.deletedAt; throw error; }
    machines.splice(machines.indexOf(machine), 1);
  }
  let work = Promise.resolve();
  const serialize = fn => (...args) => { const next = work.then(() => fn(...args)); work = next.catch(() => {}); return next; };
  return { machines, states, create: serialize(create), update: serialize(update), remove: serialize(remove), originalId: database?.originalId || records[0]?.id, get defaultId() { return machines[0]?.id; } };
}
module.exports = { fleetStore, newState };
