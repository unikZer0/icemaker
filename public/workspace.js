(() => {
  const $ = id => document.getElementById(id);
  const current = location.pathname === '/' ? 'home' : location.pathname.slice(1);
  let detailId = new URLSearchParams(location.search).get('event');
  const pages = { home: ['หน้าแรก', 'ภาพรวมอุปกรณ์และเหตุการณ์ที่ต้องตรวจสอบ'], alarms: [detailId ? 'รายละเอียดเหตุการณ์' : 'แจ้งเตือน', 'ตรวจสอบเหตุการณ์วิกฤตและข้อมูลจากอุปกรณ์'], dashboards: ['แดชบอร์ด', 'เลือกเครื่องเพื่อดูค่าปัจจุบันและประวัติการวัด'], notifications: ['ศูนย์การแจ้งเตือน', 'กำหนดผู้รับและเหตุการณ์สำหรับการแจ้งเตือนผ่าน LINE'] };
  const [title, description] = pages[current] || pages.home;
  document.title = 'IceMaker · ' + title; $('breadcrumb').textContent = $('page-title').textContent = title; $('page-description').textContent = description; $(current + '-view').hidden = false;
  let alarms = [], refreshing = false, dirty = false, alarmPage = 0, alarmPageSize = 10;
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const notice = text => { $('notice').hidden = !text; $('notice').textContent = text; };
  const date = ts => new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
  const metrics = { waterTemperature: 'อุณหภูมิน้ำ', acLineVoltage: 'แรงดันไฟฟ้า AC', compressorCurrent: 'กระแสไฟคอมเพรสเซอร์', compressorPower: 'กำลังไฟคอมเพรสเซอร์' };
  const severity = a => a.severity || (a.rule === 'tank' ? 'info' : 'critical');
  const severityLabel = node('label', 'ระดับ '), severityFilter = node('select'); severityFilter.id = 'severity-filter';
  for (const [value, text] of [['critical', 'วิกฤต'], ['all', 'ทุกระดับ'], ['info', 'ข้อมูลทั่วไป']]) { const option = node('option', text); option.value = value; severityFilter.append(option); }
  severityLabel.append(severityFilter); $('alarms-view').querySelector('.panel-heading').append(severityLabel);
  const headingRow = $('alarms-view').querySelector('thead tr'); headingRow.insertBefore(node('th', 'ระดับ'), headingRow.children[2]);
  while (headingRow.children.length > 4) headingRow.lastElementChild.remove();
  const listPanel = $('alarms-view').querySelector('.panel');
  const pagination = node('div', undefined, 'fleet-pagination'), pageSizeLabel = node('label', 'รายการต่อหน้า: '), pageSize = node('select'), pageCount = node('span'); pageCount.setAttribute('aria-live', 'polite');
  for (const size of [5, 10, 25, 50]) { const option = node('option', String(size)); option.value = size; pageSize.append(option); } pageSize.value = String(alarmPageSize); pageSizeLabel.append(pageSize);
  const controls = node('div', undefined, 'pagination-controls');
  const buttons = [['«', 'หน้าแรก'], ['‹', 'หน้าก่อนหน้า'], ['›', 'หน้าถัดไป'], ['»', 'หน้าสุดท้าย']].map(([text, label]) => { const button = node('button', text, 'icon-button'); button.setAttribute('aria-label', label); return button; });
  controls.append(pageSizeLabel, pageCount, ...buttons); pagination.append(node('span', 'คลิกชื่อเหตุการณ์เพื่อดูรายละเอียด'), controls); listPanel.append(pagination);
  const detailDialog = node('dialog', undefined, 'alarm-dialog'); detailDialog.setAttribute('aria-labelledby', 'alarm-dialog-title');
  const closeDetail = node('button', '✕ ปิด', 'alarm-dialog-close'); closeDetail.type = 'button';
  const detailPanel = node('section', undefined, 'panel alarm-detail'); detailDialog.append(closeDetail, detailPanel); document.body.append(detailDialog);
  function closePopup() { detailDialog.close(); detailId = null; history.replaceState(null, '', '/alarms'); }
  closeDetail.onclick = closePopup;
  detailDialog.addEventListener('cancel', event => { event.preventDefault(); closePopup(); });
  detailDialog.addEventListener('click', event => { if (event.target === detailDialog) { const bounds = detailDialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closePopup(); } });
  const thresholdsPanel = node('fieldset'); thresholdsPanel.append(node('legend', 'เกณฑ์ค่าวิกฤต · ใช้กับทุกอุปกรณ์'), node('p', 'เปิดเฉพาะค่าที่ทราบหน่วยและช่วงปกติของเครื่องแล้ว เว้นช่องต่ำสุดหรือสูงสุดว่างได้ ระบบจะแจ้งเมื่อค่าผิดเกณฑ์ต่อเนื่องตามเวลายืนยัน อุณหภูมิใช้ได้เมื่อเซนเซอร์รายงานปกติ', 'help'));
  for (const [key, title] of Object.entries(metrics)) {
    const row = node('div', undefined, 'threshold-rule');
    const toggle = node('input'); toggle.type = 'checkbox'; toggle.id = 'threshold-' + key + '-enabled';
    const label = node('label', undefined, 'check-label'); label.append(toggle, document.createTextNode(title)); row.append(label);
    const grid = node('div', undefined, 'threshold-grid');
    for (const [suffix, text] of [['min', 'ต่ำกว่า'], ['max', 'สูงกว่า'], ['holdSeconds', 'ยืนยัน (วินาที)']]) {
      const field = node('label', text, 'field-label'), input = node('input'); input.id = 'threshold-' + key + '-' + suffix; input.type = 'number'; input.step = suffix === 'holdSeconds' ? '1' : 'any';
      if (suffix === 'holdSeconds') { input.min = '0'; input.max = '3600'; input.required = true; } else input.placeholder = 'ไม่กำหนด';
      field.append(input); grid.append(field);
    }
    row.append(grid); thresholdsPanel.append(row);
  }
  const criticalLabel = node('label', undefined, 'check-label'), criticalInput = node('input'); criticalInput.id = 'rule-critical'; criticalInput.type = 'checkbox'; criticalLabel.append(criticalInput, document.createTextNode('ส่ง LINE เมื่อค่าเกินเกณฑ์วิกฤตที่เปิดไว้'));
  thresholdsPanel.append(criticalLabel); $('line-form').insertBefore(thresholdsPanel, $('line-form').querySelector('.buttons'));
  async function api(url, data) {
    const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (response.status === 401) { location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search)); throw Error('กรุณาเข้าสู่ระบบ'); }
    if (!response.ok) throw Error(result.error || 'ไม่สามารถดำเนินการได้');
    return result;
  }
  function dashboardTable(machines, target = 'dashboard-rows') {
    $('dashboard-summary').textContent = `ทั้งหมด ${machines.length} อุปกรณ์ · กำลังรับข้อมูล ${machines.filter(m => m.online).length} อุปกรณ์`;
    $(target).replaceChildren(...machines.map(machine => {
      const row = node('tr'), name = node('td'), link = node('a', machine.name, 'machine-name-link');
      const href = '/dashboard?machine=' + encodeURIComponent(machine.id); link.href = href; name.append(link);
      const status = node('td'); status.append(node('span', machine.online ? 'กำลังรับข้อมูล' : 'ออฟไลน์ / รอข้อมูล', 'badge' + (machine.online ? ' online' : '')));
      const action = node('td'), open = node('a', 'เปิดแดชบอร์ด →', 'table-dashboard-link'); open.href = href; open.setAttribute('aria-label', 'เปิดแดชบอร์ด ' + machine.name); action.append(open);
      row.append(name, node('td', machine.location || '—'), node('td', machine.connection === 'usb' ? 'USB' : 'Wi-Fi / MQTT'), status, node('td', machine.lastSeen ? date(machine.lastSeen) : 'ยังไม่ได้รับข้อมูล', 'date-cell'), action); return row;
    }));
    if (!machines.length) { const row = node('tr'), cell = node('td', 'ยังไม่มีอุปกรณ์ เพิ่มเครื่องที่หน้าอุปกรณ์เพื่อเริ่มใช้งาน', 'workspace-empty'); cell.colSpan = 6; row.append(cell); $(target).append(row); }
  }
  function renderAlarms() {
    if (detailId) renderDetail();
    $('alarms-view').querySelector('.panel-heading p').textContent = 'วิกฤตที่กำลังเกิดขึ้น ' + alarms.filter(a => !a.resolvedAt && severity(a) === 'critical').length + ' รายการ · ตรวจสอบทุก 5 วินาที · ดูถังเต็มได้ที่ระดับข้อมูลทั่วไป';
    const filtered = alarms.filter(a => ($('alarm-filter').value === 'all' || ($('alarm-filter').value === 'active' ? !a.resolvedAt : a.resolvedAt)) && (severityFilter.value === 'all' || severity(a) === severityFilter.value)).sort((a, b) => (severity(a) === 'critical' ? 0 : 1) - (severity(b) === 'critical' ? 0 : 1) || b.createdAt - a.createdAt);
    const lastPage = Math.max(0, Math.ceil(filtered.length / alarmPageSize) - 1); alarmPage = Math.min(alarmPage, lastPage);
    const start = alarmPage * alarmPageSize;
    pageCount.textContent = `${filtered.length ? start + 1 : 0}–${Math.min(start + alarmPageSize, filtered.length)} จาก ${filtered.length}`;
    buttons[0].disabled = buttons[1].disabled = alarmPage === 0; buttons[2].disabled = buttons[3].disabled = alarmPage === lastPage;
    buttons[0].onclick = () => { alarmPage = 0; renderAlarms(); }; buttons[1].onclick = () => { alarmPage--; renderAlarms(); }; buttons[2].onclick = () => { alarmPage++; renderAlarms(); }; buttons[3].onclick = () => { alarmPage = lastPage; renderAlarms(); };
    $('alarm-rows').replaceChildren(...filtered.slice(start, start + alarmPageSize).map(a => {
      const row = node('tr'), level = node('td'), message = node('td'), link = node('a', a.message, 'alarm-detail-link'); link.href = '/alarms?event=' + encodeURIComponent(a.id); message.append(link); level.append(node('span', severity(a) === 'critical' ? '● วิกฤต' : 'ข้อมูลทั่วไป', 'severity-badge severity-' + severity(a)));
      link.onclick = event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); detailId = a.id; history.replaceState(null, '', link.href); renderDetail(); };
      if (a.metric) message.append(node('small', 'ค่าล่าสุดที่ตรวจพบ ' + a.currentValue + ' · เกณฑ์ ' + a.comparison + ' ' + a.limit + ' · ยืนยัน ' + a.holdSeconds + ' วินาที', 'alarm-reading'));
      row.classList.toggle('critical-alarm', severity(a) === 'critical' && !a.resolvedAt);
      row.append(node('td', date(a.createdAt)), node('td', a.machineName), level, message); return row;
    }));
    if (!filtered.length) { const row = node('tr'), cell = node('td', 'ไม่มีเหตุการณ์ในรายการนี้', 'workspace-empty'); cell.colSpan = 4; row.append(cell); $('alarm-rows').append(row); }
  }
  function renderDetail() {
    detailPanel.replaceChildren();
    if (!detailDialog.open) detailDialog.showModal();
    const a = alarms.find(item => item.id === detailId);
    const detailTitle = node('h2', a ? a.message : 'ไม่พบเหตุการณ์'); detailTitle.id = 'alarm-dialog-title'; detailPanel.append(detailTitle);
    if (!a) { detailPanel.append(node('p', 'รายการนี้อาจถูกลบตามระยะเวลาเก็บประวัติ หรือรหัสเหตุการณ์ไม่ถูกต้อง')); return; }
    detailPanel.append(node('span', severity(a) === 'critical' ? '● วิกฤต' : 'ข้อมูลทั่วไป', 'severity-badge severity-' + severity(a)));
    const fields = [['อุปกรณ์', a.machineName], ['เริ่มตรวจพบ', date(a.createdAt)], ['สถานะเหตุการณ์', a.resolvedAt ? 'สิ้นสุดแล้ว' : 'กำลังเกิดขึ้น'], ['เวลาสิ้นสุด', a.resolvedAt ? date(a.resolvedAt) : 'ยังไม่สิ้นสุด']];
    if (a.metric) fields.push(['ค่าที่ทำให้เกิดเหตุการณ์', String(a.triggerValue)], ['ค่าล่าสุดที่ตรวจพบ', String(a.currentValue)], ['เกณฑ์ตอนเกิดเหตุการณ์', a.comparison + ' ' + a.limit], ['เวลายืนยันก่อนแจ้งเตือน', a.holdSeconds + ' วินาที']);
    else fields.push(['เงื่อนไขที่ตรวจพบ', a.rule === 'sensor' ? 'อุปกรณ์รายงาน temperatureSensorStatus = false' : a.rule === 'offline' ? 'ไม่พบช่องทางเชื่อมต่อที่มีข้อมูลสดจากอุปกรณ์ที่เคยส่งข้อมูลแล้ว' : a.rule === 'tank' ? 'อุปกรณ์รายงาน machineTankFull = true' : a.message]);
    if (a.resolution) fields.push(['เหตุผลที่สิ้นสุด', a.resolution]);
    const dl = node('dl', undefined, 'alarm-detail-fields');
    for (const [label, value] of fields) { const row = node('div'); row.append(node('dt', label), node('dd', value)); dl.append(row); } detailPanel.append(dl);
    const guidance = node('section', undefined, 'alarm-guidance'); guidance.append(node('h3', 'สิ่งที่ควรตรวจสอบ'), node('p', a.rule === 'sensor' ? 'ตรวจสอบหัววัดและการเชื่อมต่อเซนเซอร์ตามคู่มือเครื่อง ค่าอุณหภูมิที่ส่งมาระหว่างเซนเซอร์ผิดปกติไม่ควรใช้ตัดสินสภาวะของเครื่อง' : a.rule === 'offline' ? 'ตรวจสอบไฟเลี้ยง สาย USB หรือเครือข่าย Wi-Fi และการทำงานของเกตเวย์ การขาดข้อมูลไม่ได้ยืนยันว่าเครื่องหยุดทำงาน' : a.metric ? 'เปรียบเทียบค่ากับข้อกำหนดของเครื่องและหน่วยที่อุปกรณ์ส่งมา ตรวจสอบเครื่องและเซนเซอร์ เหตุการณ์จะสิ้นสุดเมื่อได้รับค่าปกติ หรือเมื่อปิดหรือเปลี่ยนเกณฑ์' : 'ตรวจสอบสถานะที่ตัวเครื่องและเทียบกับคู่มือการใช้งาน')); detailPanel.append(guidance);
    detailPanel.append(node('p', 'รายละเอียดอัปเดตทุก 5 วินาที ค่าล่าสุดที่ตรวจพบอาจเป็นข้อมูลก่อนการเชื่อมต่อขาดหาย ไม่ใช่การยืนยันค่าปัจจุบัน', 'help'));
    const dashboard = node('a', 'เปิดแดชบอร์ดอุปกรณ์ →', 'button-link'); dashboard.href = '/dashboard?machine=' + encodeURIComponent(a.machineId); detailPanel.append(dashboard);
  }
  function fillSettings(s) {
    $('line-enabled').checked = s.enabled; $('line-recipient').value = s.recipient; $('line-token').value = ''; $('clear-token').checked = false;
    $('token-help').textContent = s.hasToken ? 'บันทึกโทเคนไว้แล้ว เว้นว่างเพื่อใช้โทเคนเดิม' : 'ยังไม่ได้ตั้งค่าโทเคน';
    for (const rule of ['offline', 'sensor', 'tank']) $('rule-' + rule).checked = s.rules[rule];
    $('rule-critical').checked = s.rules.critical !== false;
    for (const key of Object.keys(metrics)) { const t = s.thresholds[key]; $('threshold-' + key + '-enabled').checked = t.enabled; for (const suffix of ['min', 'max', 'holdSeconds']) $('threshold-' + key + '-' + suffix).value = t[suffix] ?? ''; }
    dirty = false;
  }
  async function refresh() {
    if (refreshing) return; refreshing = true;
    try {
      if (current === 'notifications') { if (!dirty) fillSettings(await api('/api/notifications')); return; }
      if (current === 'alarms') { alarms = await api('/api/alarms'); renderAlarms(); return; }
      const machines = await api('/api/machines');
      if (current === 'dashboards') dashboardTable(machines);
      else { alarms = await api('/api/alarms'); const active = alarms.filter(a => !a.resolvedAt); $('summary').replaceChildren(...[['อุปกรณ์ทั้งหมด', machines.length], ['กำลังรับข้อมูล', machines.filter(m => m.online).length], ['ออฟไลน์ / รอข้อมูล', machines.filter(m => !m.online).length], ['เหตุการณ์ที่กำลังเกิดขึ้น', active.length]].map(([label, count]) => { const a = node('article'); a.append(node('span', label), node('strong', String(count))); return a; })); dashboardTable(machines, 'home-rows'); }
    } catch (e) { notice(e.message); } finally { refreshing = false; }
  }
  $('reload').onclick = refresh; $('alarm-filter').onchange = severityFilter.onchange = () => { alarmPage = 0; renderAlarms(); }; pageSize.onchange = () => { alarmPageSize = Number(pageSize.value); alarmPage = 0; renderAlarms(); };
  $('logout').onclick = async () => { try { await api('/api/auth/logout', {}); location.assign('/login'); } catch (e) { notice(e.message); } };
  $('line-form').oninput = () => { dirty = true; };
  $('line-form').onsubmit = async event => {
    event.preventDefault(); $('save-line').disabled = $('test-line').disabled = true;
    try {
      const rules = Object.fromEntries(['offline', 'sensor', 'tank', 'critical'].map(k => [k, $('rule-' + k).checked]));
      const thresholds = Object.fromEntries(Object.keys(metrics).map(key => { const number = suffix => { const v = $('threshold-' + key + '-' + suffix).value; return v === '' ? null : Number(v); }; return [key, { enabled: $('threshold-' + key + '-enabled').checked, min: number('min'), max: number('max'), holdSeconds: number('holdSeconds') }]; }));
      fillSettings(await api('/api/notifications', { enabled: $('line-enabled').checked, recipient: $('line-recipient').value, token: $('line-token').value.trim(), clearToken: $('clear-token').checked, rules, thresholds })); notice('บันทึกการตั้งค่าแล้ว');
    }
    catch (e) { notice(e.message); } finally { $('save-line').disabled = $('test-line').disabled = false; }
  };
  $('test-line').onclick = async () => { if (dirty) return notice('กรุณาบันทึกการตั้งค่าก่อนส่งข้อความทดสอบ'); $('test-line').disabled = $('save-line').disabled = true; try { await api('/api/notifications/test', {}); notice('LINE รับคำขอส่งข้อความทดสอบแล้ว กรุณาตรวจสอบที่ผู้รับ'); } catch (e) { notice(e.message); } finally { $('test-line').disabled = $('save-line').disabled = false; } };
  (async () => { try { const session = await api('/api/auth/session'); if (!session.authenticated) return location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search)); $('logout').hidden = !session.enabled; await refresh(); if (current !== 'notifications') setInterval(refresh, 5000); } catch (e) { notice(e.message); } })();
})();
