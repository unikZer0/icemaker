const $ = id => document.getElementById(id);
let machines = [], editing = null, credentials = null, busy = false;
let page = 0, pageSize = 10, sortKey = 'createdAt', sortDirection = -1;
function filteredMachines() {
  const query = $('machine-search').value.trim().toLocaleLowerCase();
  return machines.filter(machine => [machine.name, machine.location, machine.connection === 'usb' ? 'เกตเวย์ USB' : 'Wi-Fi MQTT', machine.online ? 'กำลังรับข้อมูล ออนไลน์' : 'ออฟไลน์ รอข้อมูล'].join(' ').toLocaleLowerCase().includes(query)).sort((a, b) => {
    const compared = sortKey === 'createdAt' ? a.createdAt - b.createdAt : a.name.localeCompare(b.name, 'th', { sensitivity: 'base', numeric: true });
    return sortDirection * compared || a.id.localeCompare(b.id);
  });
}
function date(ts) { return new Date(ts).toLocaleString('th-TH-u-ca-gregory', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
async function api(url, data) {
  const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (response.status === 401) { location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search)); throw new Error('กรุณาเข้าสู่ระบบ'); }
  if (!response.ok) throw new Error(result.error || 'ไม่สามารถดำเนินการได้');
  return result;
}
function notice(message) { $('notice').hidden = !message; $('notice').textContent = message || ''; const local = $('setup-notice'); if (local) { local.hidden = !message; local.textContent = message || ''; } }
function node(tag, text, cls) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (cls) element.className = cls; return element; }
function showInitialSkeleton() {
  const body = $('machine-rows'); body.setAttribute('aria-busy', 'true');
  const labels = [...document.querySelectorAll('.machines-page .fleet-table thead th')].map(th => th.textContent.replace(/[↓↑]/g, '').trim());
  body.replaceChildren(...Array.from({ length: 4 }, () => {
    const row = node('tr', undefined, 'machine-row skeleton-row'); row.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 7; i++) {
      const cell = node('td', undefined, i === 0 ? 'created-cell' : i === 6 ? 'row-actions' : '');
      cell.dataset.label = labels[i] || '';
      const line = node('span', undefined, 'skeleton-line'); line.style.width = [54, 66, 72, 48, 62, 76, 58][i] + '%';
      cell.append(line); row.append(cell);
    }
    return row;
  }));
}
function dashboard(id) { return '/dashboard?machine=' + encodeURIComponent(id); }
const setupDialog = node('dialog', undefined, 'device-setup-dialog'); setupDialog.setAttribute('aria-labelledby', 'setup-title');
const setupPanel = $('setup-panel'); setupDialog.append(setupPanel); document.body.append(setupDialog);
const setupNotice = node('div'); setupNotice.id = 'setup-notice'; setupNotice.hidden = true; setupNotice.setAttribute('role', 'status'); setupPanel.querySelector('.panel-heading').after(setupNotice);
let setupOpener = null;
function closeSetup() {
  if (busy) return;
  setupDialog.close(); setupPanel.hidden = true;
  for (const [field, button] of [['device-token', 'show-device'], ['bridge-token', 'show-bridge']]) { $(field).type = 'password'; $(button).textContent = 'แสดง'; }
  history.replaceState(null, '', location.pathname);
  (setupOpener?.isConnected ? setupOpener : $('add')).focus();
}
setupDialog.addEventListener('cancel', event => { event.preventDefault(); closeSetup(); });
setupDialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeSetup(); } });
setupDialog.addEventListener('click', event => { if (event.target === setupDialog) { const rect = setupDialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSetup(); } });
let deleting = null, removing = false;
const deleteDialog = node('dialog', undefined, 'device-delete-dialog'); deleteDialog.setAttribute('aria-labelledby', 'delete-device-title');
const deleteTitle = node('h2', 'ลบอุปกรณ์'); deleteTitle.id = 'delete-device-title';
const deleteDescription = node('p'), deleteLabel = node('label', 'พิมพ์ชื่ออุปกรณ์เพื่อยืนยัน', 'delete-device-label'), deleteInput = node('input'); deleteInput.autocomplete = 'off'; deleteLabel.append(deleteInput);
const deleteError = node('p', '', 'delete-device-error'); deleteError.setAttribute('role', 'alert');
const deleteActions = node('div', undefined, 'buttons'), cancelDelete = node('button', 'ยกเลิก'), confirmDelete = node('button', 'ยืนยันลบอุปกรณ์', 'danger-button');
deleteActions.append(cancelDelete, confirmDelete); deleteDialog.append(deleteTitle, deleteDescription, deleteLabel, deleteError, deleteActions); document.body.append(deleteDialog);
function askDelete(machine) { deleting = machine; deleteInput.value = ''; deleteError.textContent = ''; confirmDelete.disabled = true; deleteDescription.textContent = `นำ “${machine.name}” ออกจากรายการและยกเลิกการเชื่อมต่อด้วยโทเคนเดิม ประวัติการวัดและเหตุการณ์จะยังเก็บไว้ในฐานข้อมูล`; deleteDialog.showModal(); deleteInput.focus(); }
deleteInput.oninput = () => { confirmDelete.disabled = removing || deleteInput.value !== deleting?.name; };
cancelDelete.onclick = () => deleteDialog.close();
confirmDelete.onclick = async () => {
  if (removing || !deleting || deleteInput.value !== deleting.name) return;
  removing = true; confirmDelete.disabled = cancelDelete.disabled = true;
  try {
    await api('/api/machines/' + encodeURIComponent(deleting.id) + '/delete', { confirmName: deleteInput.value });
    if (editing === deleting.id) { editing = null; credentials = null; closeSetup(); $('device-token').value = $('bridge-token').value = ''; history.replaceState(null, '', '/devices'); }
    deleteDialog.close(); await refresh(); notice('ลบอุปกรณ์ออกจากรายการแล้ว ประวัติเดิมยังอยู่ในฐานข้อมูล');
  } catch (error) { deleteError.textContent = error.message; }
  finally { removing = false; cancelDelete.disabled = false; confirmDelete.disabled = deleteInput.value !== deleting?.name; }
};
function render() {
  $('machine-rows').setAttribute('aria-busy', 'false');
  $('fleet-summary').textContent = `ทั้งหมด ${machines.length} เครื่อง · กำลังรับข้อมูล ${machines.filter(m => m.online).length} เครื่อง`;
  const filtered = filteredMachines();
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  page = Math.min(page, lastPage);
  const start = page * pageSize;
  $('machine-rows').replaceChildren(...filtered.slice(start, start + pageSize).map(machine => {
    const row = node('tr', undefined, 'machine-row');
    const created = node('td', date(machine.createdAt), 'date-cell created-cell'); created.title = 'วันที่สร้างตามเวลากรุงเทพฯ';
    const name = node('td'); const link = node('a', machine.name, 'machine-name-link'); link.href = dashboard(machine.id); name.append(link);
    const locationText = node('td', machine.location || '—', 'location-cell');
    const connection = node('td', machine.connection === 'usb' ? 'เกตเวย์ USB' : 'Wi-Fi / MQTT');
    const status = node('td'); status.append(node('span', machine.online ? 'กำลังรับข้อมูล' : 'ออฟไลน์ / รอข้อมูล', 'badge' + (machine.online ? ' online' : '')));
    const last = node('td', machine.lastSeen ? date(machine.lastSeen) : 'ยังไม่มีข้อมูล', 'date-cell');
    const actions = node('td', undefined, 'row-actions'); const open = node('a', 'เปิดแดชบอร์ด ↗', 'table-dashboard-link'); open.href = dashboard(machine.id); open.setAttribute('aria-label', 'เปิดแดชบอร์ดของ ' + machine.name);
    const setup = node('button', 'ตั้งค่า', 'table-setup-button'); setup.setAttribute('aria-label', 'ตั้งค่า ' + machine.name); setup.addEventListener('click', () => edit(machine.id).catch(error => notice(error.message))); actions.append(open, setup);
    const remove = node('button', 'ลบ', 'table-delete-button'); remove.setAttribute('aria-label', 'ลบอุปกรณ์ ' + machine.name); remove.onclick = () => askDelete(machine); actions.append(remove);
    row.append(created, name, locationText, connection, status, last, actions);
    const labels = [...document.querySelectorAll('.machines-page .fleet-table thead th')].map(th => th.textContent.replace(/[↓↑]/g, '').trim());
    row.querySelectorAll('td').forEach((cell, index) => { if (labels[index]) cell.dataset.label = labels[index]; });
    return row;
  }));
  if (!filtered.length) { const row = node('tr'); const cell = node('td', machines.length ? 'ไม่พบเครื่องที่ตรงกับคำค้นหา' : 'ยังไม่มีเครื่อง กรุณาเพิ่มเครื่องแรกเพื่อเริ่มใช้งาน', 'table-empty'); cell.colSpan = 7; row.append(cell); $('machine-rows').append(row); }
  $('filter-count').textContent = $('machine-search').value.trim() ? `พบ ${filtered.length} เครื่อง` : '';
  $('page-count').textContent = `${filtered.length ? start + 1 : 0}–${Math.min(start + pageSize, filtered.length)} จาก ${filtered.length}`;
  $('first-page').disabled = $('previous-page').disabled = page === 0;
  $('next-page').disabled = $('last-page').disabled = page === lastPage;
  for (const [key, name] of [['createdAt', 'created'], ['name', 'name']]) { $(name + '-heading').setAttribute('aria-sort', sortKey === key ? sortDirection === 1 ? 'ascending' : 'descending' : 'none'); $(name + '-arrow').textContent = sortKey === key ? sortDirection === 1 ? '↑' : '↓' : ''; }
}
$('machine-search').addEventListener('input', () => { page = 0; render(); });
$('page-size').addEventListener('change', () => { pageSize = Number($('page-size').value); page = 0; render(); });
$('machine-sort').addEventListener('change', () => {
  const [key, direction] = $('machine-sort').value.split('-');
  sortKey = key === 'created' ? 'createdAt' : 'name';
  sortDirection = direction === 'desc' ? -1 : 1;
  page = 0;
  render();
});
for (const [id, key] of [['sort-created', 'createdAt'], ['sort-name', 'name']]) $(id).addEventListener('click', () => { sortDirection = sortKey === key ? -sortDirection : key === 'name' ? 1 : -1; sortKey = key; page = 0; render(); });
$('first-page').addEventListener('click', () => { page = 0; render(); });
$('previous-page').addEventListener('click', () => { page = Math.max(0, page - 1); render(); });
$('next-page').addEventListener('click', () => { page++; render(); });
$('last-page').addEventListener('click', () => { page = Math.max(0, Math.ceil(filteredMachines().length / pageSize) - 1); render(); });
$('refresh-machines').addEventListener('click', async () => { $('refresh-machines').disabled = true; try { await refresh(); notice(''); } catch (error) { notice(error.message); } finally { $('refresh-machines').disabled = false; } });
async function refresh() { machines = await api('/api/machines'); render(); }
function showPanel() { setupPanel.hidden = false; if (!setupDialog.open) { setupOpener = document.activeElement; setupDialog.showModal(); setupDialog.scrollTop = 0; $('machine-name').focus(); } }
function add() {
  editing = null; credentials = null; $('machine-form').reset(); $('credentials').hidden = true; $('open-dashboard').hidden = true;
  $('setup-title').textContent = 'เพิ่มเครื่อง'; $('save').textContent = 'บันทึกเครื่องใหม่'; history.replaceState(null, '', '/machines'); notice(''); showPanel(); $('machine-name').focus();
}
function connectionHelp() {
  $('method-help').textContent = $('machine-connection').value === 'usb' ? 'ใช้โทเคนเกตเวย์ USB ของเครื่องนี้บนคอมพิวเตอร์ที่เชื่อมต่ออยู่ เกตเวย์จะส่งข้อมูลเข้าระบบนี้' : 'ใช้โทเคนอุปกรณ์ของเครื่องนี้ในการตั้งค่า MQTT ของ CloudMeter แต่ละเครื่องต้องใช้โทเคนของตัวเอง';
}
async function edit(id) {
  const setup = await api('/api/setup?machine=' + encodeURIComponent(id));
  editing = id; credentials = setup;
  $('machine-name').value = setup.name; $('machine-location').value = setup.location; $('machine-connection').value = setup.connection;
  $('setup-title').textContent = 'ตั้งค่า ' + setup.name; $('save').textContent = 'บันทึกการเปลี่ยนแปลง';
  $('credentials').hidden = false; $('open-dashboard').hidden = false; $('open-dashboard').href = dashboard(id);
  $('setup-id').textContent = setup.id; $('setup-broker').textContent = `${setup.protocol}://${setup.addresses[0] || 'ระบุ MQTT_ADVERTISED_HOST ในไฟล์ .env'}:${setup.mqttPort}`;
  $('device-token').value = setup.token; $('bridge-token').value = setup.bridgeToken;
  for (const [field, button] of [['device-token', 'show-device'], ['bridge-token', 'show-bridge']]) { $(field).type = 'password'; $(button).textContent = 'แสดง'; }
  connectionHelp(); history.replaceState(null, '', '/machines?setup=' + encodeURIComponent(id)); showPanel();
}
$('machine-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; $('save').disabled = true;
  try {
    const result = await api(editing ? '/api/machines/' + editing : '/api/machines', { name: $('machine-name').value, location: $('machine-location').value, connection: $('machine-connection').value });
    const id = editing || result.id; await refresh(); await edit(id); notice('บันทึกเครื่องแล้ว ใช้รายละเอียดด้านล่างเพื่อตั้งค่าการเชื่อมต่ออุปกรณ์');
  } catch (error) { notice(error.message); } finally { busy = false; $('save').disabled = false; }
});
$('add').addEventListener('click', add);
$('close-setup').addEventListener('click', closeSetup);
$('machine-connection').addEventListener('change', connectionHelp);
for (const [id, field] of [['show-device', 'device-token'], ['show-bridge', 'bridge-token']]) $(id).addEventListener('click', () => { $(field).type = $(field).type === 'password' ? 'text' : 'password'; $(id).textContent = $(field).type === 'password' ? 'แสดง' : 'ซ่อน'; });
for (const [id, field] of [['copy-device', 'device-token'], ['copy-bridge', 'bridge-token']]) $(id).addEventListener('click', async () => { try { await navigator.clipboard.writeText($(field).value); $(id).textContent = 'คัดลอกแล้ว'; setTimeout(() => $(id).textContent = 'คัดลอก', 2000); } catch { notice('ไม่สามารถคัดลอกอัตโนมัติได้ กดแสดงแล้วคัดลอกโทเคนด้วยตนเอง'); } });
$('download-env').addEventListener('click', () => {
  if (!credentials?.addresses.length) return notice('กรุณาระบุ MQTT_ADVERTISED_HOST บนเซิร์ฟเวอร์ก่อนดาวน์โหลดไฟล์ตั้งค่าเกตเวย์');
  const data = [`# Gateway for machine ${credentials.id}`, `BRIDGE_MQTT_HOST=${credentials.addresses[0]}`, `MQTT_PORT=${credentials.mqttPort}`, `MQTT_TLS=${credentials.protocol === 'mqtts'}`, `USB_BRIDGE_TOKEN=${credentials.bridgeToken}`, 'SERIAL_PORT=COM11', 'SERIAL_BAUD=115200', ''].join('\n');
  const url = URL.createObjectURL(new Blob([data], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = 'machine.env'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('logout').addEventListener('click', async () => { try { await api('/api/auth/logout', {}); location.assign('/login'); } catch (error) { notice(error.message); } });
async function init() {
  try { const session = await api('/api/auth/session'); if (!session.authenticated) return location.assign('/login'); $('logout').hidden = !session.enabled; showInitialSkeleton(); await refresh(); const id = new URLSearchParams(location.search).get('setup'); if (id) await edit(id); }
  catch (error) { $('machine-rows').replaceChildren(); $('machine-rows').setAttribute('aria-busy', 'false'); notice(error.message); }
  setInterval(() => refresh().catch(error => notice(error.message)), 5000);
}
init();
