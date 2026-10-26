const $ = id => document.getElementById(id);
const fmtTime = ts => new Date(ts).toLocaleString('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const machineId = new URLSearchParams(location.search).get('machine');
const sourceKey = 'source:' + (machineId || 'cloudmeter-1');
let state, selected = localStorage.getItem(sourceKey) || 'auto', refreshing = false;
let historyReports = [], historySource = 'usb';
const forMachine = url => machineId ? url + (url.includes('?') ? '&' : '?') + 'machine=' + encodeURIComponent(machineId) : url;
if (!['auto', 'usb', 'wifi'].includes(selected)) selected = 'auto';
$('source').value = selected;
async function api(url, data) {
  const response = await fetch(forMachine(url), data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const body = await response.json();
  if (response.status === 401) { location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search)); throw new Error('กรุณาเข้าสู่ระบบ'); }
  if (!response.ok) throw new Error(body.error || 'ไม่สามารถดำเนินการได้');
  return body;
}
function notice(message) { $('notice').hidden = !message; $('notice').textContent = message || ''; }
function source() {
  if (selected !== 'auto') return selected;
  const fresh = name => state[name].connected && state.now - state[name].lastSeen < state.freshnessMs;
  if (fresh('wifi')) return 'wifi';
  if (fresh('usb')) return 'usb';
  return state.wifi.connected ? 'wifi' : 'usb';
}
function value(key, src) {
  const point = state.latest[src][key];
  return state[src].connected && point && point.ts >= state[src].started && state.now - point.ts < state.freshnessMs ? point.value : undefined;
}
function textValue(value) { return value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString('th-TH-u-ca-gregory', { maximumFractionDigits: 2 }) : String(value); }
function falseValue(value) { return value === false || value === 'false'; }
function booleanValue(value, yes, no) { return value === undefined ? '—' : value === true || value === 'true' ? yes : falseValue(value) ? no : String(value); }
function render() {
  $('machine-title').textContent = state.machine.name;
  $('breadcrumb-machine').textContent = state.machine.name;
  $('machine-subtitle').textContent = state.machine.location || 'ค่าที่วัดได้จาก LEAFTECH CloudMeter ของคุณ';
  $('setup-link').href = '/machines?setup=' + encodeURIComponent(state.machine.id);
  const src = source(), connection = state[src];
  const fresh = connection.connected && state.now - connection.lastSeen < state.freshnessMs;
  $('live-dot').classList.toggle('live', fresh);
  $('live-status').textContent = fresh ? `กำลังรับข้อมูลผ่าน ${src === 'usb' ? 'USB' : 'Wi-Fi'}` : connection.connected ? 'เชื่อมต่อแล้ว · กำลังรอข้อมูลใหม่' : 'ไม่ได้เชื่อมต่ออุปกรณ์';
  $('last-seen').textContent = connection.lastSeen ? `ข้อมูลล่าสุด ${fmtTime(connection.lastSeen)} · กรุงเทพฯ` : 'ยังไม่ได้รับข้อมูลในการเชื่อมต่อครั้งนี้';
  ['waterTemperature', 'acLineVoltage', 'compressorCurrent', 'compressorPower', 'wifiSignalStrength', 'machineCycleCount', 'machineInterCycleTime'].forEach(key => { $(key).textContent = textValue(value(key, src)); });
  const sensor = value('temperatureSensorStatus', src);
  if (falseValue(sensor)) $('waterTemperature').textContent = 'ไม่พร้อมใช้งาน';
  $('temperature-note').textContent = falseValue(sensor) ? 'อุปกรณ์รายงานว่าเซนเซอร์ไม่พร้อมใช้งาน (false)' : sensor === undefined ? 'ยังไม่มีข้อมูลสถานะเซนเซอร์' : 'ค่าที่อุปกรณ์รายงาน';
  $('device-name').textContent = textValue(value('deviceName', src)) === '—' ? 'CloudMeter-1' : textValue(value('deviceName', src));
  const rows = [ ['คอมเพรสเซอร์', booleanValue(value('compressorStatus', src), 'กำลังทำงาน', 'หยุดทำงาน')], ['สถานะถังน้ำแข็ง', booleanValue(value('machineTankFull', src), 'เต็ม', 'ปกติ')], ['จำนวนรอบการทำงาน', textValue(value('machineCycleCount', src))], ['เวลาทำงานคอมเพรสเซอร์', textValue(value('compressorRunTime', src))], ['ระยะเวลาระหว่างรอบ', textValue(value('machineInterCycleTime', src))], ['เซนเซอร์อุณหภูมิ', booleanValue(sensor, 'ปกติ', 'ไม่พร้อมใช้งาน')], ['ที่อยู่ IP ของอุปกรณ์', textValue(value('wifiIp', src))] ];
  $('machine-values').replaceChildren(...rows.map(([label, reading]) => { const row = document.createElement('div'); const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = reading; row.append(dt, dd); return row; }));
  $('events').replaceChildren(...state.events.map(event => { const li = document.createElement('li'), time = document.createElement('time'); time.textContent = fmtTime(event.ts); li.append(time, document.createTextNode(event.message)); return li; }));
  if (!state.events.length) { const li = document.createElement('li'); li.textContent = 'ยังไม่มีประวัติการเชื่อมต่อ'; $('events').append(li); }
}
function svgNode(tag, attrs, text) { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); if (text !== undefined) node.textContent = text; return node; }
function drawHistory(key, prefix) {
  const reports = historyReports, src = historySource;
  const field = suffix => $(prefix + '-' + suffix);
  const label = key === 'waterTemperature' ? 'อุณหภูมิน้ำ' : 'กระแสไฟคอมเพรสเซอร์';
  const container = field('chart'); container.replaceChildren();
  for (const suffix of ['latest', 'min', 'average', 'max']) field(suffix).textContent = '—';
  function empty(message) {
    const el = document.createElement('div'); el.className = 'empty'; el.textContent = message; container.append(el);
    field('time').textContent = 'ยังไม่มีค่าที่แสดงได้';
    field('note').textContent = 'เวลาประเทศไทย · ค่าตามที่อุปกรณ์รายงาน';
  }
  if (key === 'waterTemperature' && falseValue(value('temperatureSensorStatus', src))) {
    empty('เซนเซอร์อุณหภูมิไม่พร้อมใช้งาน อุปกรณ์ยังไม่ส่งค่าที่เชื่อถือได้'); return;
  }
  // Carry sensor status only within each recorded stream, with the same freshness limit as live values.
  let sensor, sensorTs = 0;
  const points = [];
  for (const report of reports) {
    if ('temperatureSensorStatus' in report.values) { sensor = report.values.temperatureSensorStatus; sensorTs = report.ts; }
    const reading = report.values[key];
    const badSensor = key === 'waterTemperature' && (falseValue(sensor) && report.ts - sensorTs < state.freshnessMs);
    if (typeof reading === 'number' && !badSensor) points.push({ ts: report.ts, value: reading });
    else if (badSensor) points.push({ ts: report.ts, value: null });
  }
  const numeric = points.filter(p => p.value !== null);
  if (!numeric.length) { empty('ยังไม่มีข้อมูลในช่วงเวลานี้ เมื่ออุปกรณ์ส่งข้อมูล กราฟจะแสดงที่นี่'); return; }
  let lo = Infinity, hi = -Infinity, sum = 0;
  for (const p of numeric) { lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); sum += p.value; }
  const latest = numeric[numeric.length - 1];
  field('latest').textContent = textValue(latest.value);
  field('min').textContent = textValue(lo); field('average').textContent = textValue(sum / numeric.length); field('max').textContent = textValue(hi);
  field('time').textContent = 'บันทึกเมื่อ ' + fmtTime(latest.ts);
  // Fit the time axis to available reports; do not fill most of the chart with missing time.
  const first = numeric[0].ts, last = latest.ts, span = Math.max(last - first, 60000);
  const start = first === last ? first - 30000 : first - span * .025;
  const end = first === last ? last + 30000 : last + span * .025;
  const pad = (hi - lo || Math.max(Math.abs(hi) * .05, .1)) * .15;
  const allNonnegative = lo >= 0;
  lo = allNonnegative ? Math.max(0, lo - pad) : lo - pad; hi += pad;
  const interval = Math.max(1000, Math.ceil(span / 60000) * 1000);
  const buckets = [];
  let segment = 0, previousTime = null;
  for (const point of points) {
    if (point.value === null) { segment++; previousTime = null; continue; }
    if (previousTime !== null && point.ts - previousTime >= state.freshnessMs) segment++;
    const slot = Math.floor((point.ts - first) / interval), previous = buckets[buckets.length - 1];
    if (previous && previous.slot === slot && previous.segment === segment) { previous.sum += point.value; previous.timeSum += point.ts; previous.count++; }
    else buckets.push({ slot, segment, sum: point.value, timeSum: point.ts, count: 1 });
    previousTime = point.ts;
  }
  const color = key === 'waterTemperature' ? '#3189bd' : '#15917a';
  const svg = svgNode('svg', { viewBox: '0 0 720 260', role: 'img', 'aria-label': `${label} แสดงค่าเฉลี่ย ${buckets.length} จุด จากข้อมูล ${numeric.length} รายการ` });
  for (let i = 0; i <= 3; i++) {
    const y = 24 + i * 62;
    svg.append(svgNode('line', { x1: 62, y1: y, x2: 700, y2: y, stroke: '#e8eeeb' }));
    svg.append(svgNode('text', { x: 0, y: y + 5, fill: '#647d73', 'font-size': 13 }, textValue(hi - (hi - lo) * i / 3)));
    svg.append(svgNode('text', { x: 62 + i * 638 / 3, y: 246, 'text-anchor': i === 0 ? 'start' : i === 3 ? 'end' : 'middle', fill: '#647d73', 'font-size': 13 }, new Date(start + (end - start) * i / 3).toLocaleTimeString('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })));
  }
  let d = '', prev = null;
  for (const p of buckets) {
    const ts = p.timeSum / p.count, average = p.sum / p.count;
    const x = 62 + (ts - start) / (end - start) * 638, y = 210 - (average - lo) / (hi - lo) * 186;
    d += `${prev && prev.segment === p.segment ? 'L' : 'M'}${x},${y} `;
    const dot = svgNode('circle', { cx: x, cy: y, r: buckets.length === 1 ? 5 : 6, fill: color, class: buckets.length === 1 ? 'single-reading' : 'history-hit', tabindex: 0, 'aria-label': `${label} เฉลี่ย ${textValue(average)} จาก ${p.count} รายการ เวลา ${fmtTime(ts)}` });
    dot.append(svgNode('title', {}, `${label} เฉลี่ย ${textValue(average)} · ${fmtTime(ts)} · ${p.count} รายการ`)); svg.append(dot); prev = p;
  }
  svg.insertBefore(svgNode('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }), svg.firstChild); container.append(svg);
  field('note').textContent = numeric.length === 1 ? 'มีข้อมูล 1 รายการ จึงแสดงเป็นจุดเดียว · เวลาประเทศไทย' : `เส้นกราฟแสดงค่าเฉลี่ยทุก ${interval / 1000} วินาที · ค่าต่ำสุด/เฉลี่ย/สูงสุดคำนวณจากข้อมูลจริง ${numeric.length} รายการ · เวลาประเทศไทย`;
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await api('/api/state'); render();
    const src = source(); const reports = await api(`/api/history?hours=${$('range').value}&source=${src}`);
    historyReports = reports; historySource = src; drawHistory('compressorCurrent', 'current'); drawHistory('waterTemperature', 'temperature');
    notice('');
  } catch (error) { notice('ไม่สามารถอัปเดตแดชบอร์ดได้: ' + error.message); $('live-status').textContent = 'การเชื่อมต่อแดชบอร์ดขัดข้อง'; $('live-dot').classList.remove('live'); for (const key of ['waterTemperature', 'acLineVoltage', 'compressorCurrent', 'compressorPower', 'wifiSignalStrength', 'machineCycleCount', 'machineInterCycleTime']) $(key).textContent = '—'; $('machine-values').replaceChildren(); }
  finally { refreshing = false; }
}
function action(id, fn) { $(id).addEventListener('click', async () => { $(id).disabled = true; try { await fn(); } catch (error) { notice(error.message); } finally { $(id).disabled = false; } }); }
action('refresh', refresh);
$('source').addEventListener('change', () => { selected = $('source').value; localStorage.setItem(sourceKey, selected); refresh(); });
$('range').addEventListener('change', refresh);
async function init() {
  try {
    const session = await api('/api/auth/session');
    if (!session.authenticated) return location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search));
    $('logout').hidden = !session.enabled;
    const machines = await api('/api/machines');
    for (const machine of machines) { const option = document.createElement('option'); option.value = machine.id; option.textContent = machine.name; $('machine-picker').append(option); }
    if (machineId) $('machine-picker').value = machineId;
    $('machine-picker').addEventListener('change', () => location.assign('/dashboard?machine=' + encodeURIComponent($('machine-picker').value)));
  } catch (error) { notice(error.message); return; }
  await refresh(); setInterval(refresh, 3000);
}
action('logout', async () => { await api('/api/auth/logout', {}); location.assign('/login'); });
init();
