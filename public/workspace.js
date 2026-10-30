(() => {
  const $ = id => document.getElementById(id);
  const current = location.pathname === '/' ? 'home' : location.pathname.slice(1);
  let detailId = new URLSearchParams(location.search).get('event');
  const pages = { home: ['หน้าแรก', 'ภาพรวมอุปกรณ์และเหตุการณ์ที่ต้องตรวจสอบ'], alarms: [detailId ? 'รายละเอียดเหตุการณ์' : 'แจ้งเตือน', 'ตรวจสอบเหตุการณ์วิกฤตและข้อมูลจากอุปกรณ์'], dashboards: ['แดชบอร์ด', 'เลือกเครื่องเพื่อดูค่าปัจจุบันและประวัติการวัด'], notifications: ['ศูนย์การแจ้งเตือน', 'กำหนดผู้รับและเหตุการณ์สำหรับการแจ้งเตือนผ่าน LINE'] };
  const [title, description] = pages[current] || pages.home;
  document.title = 'AACC IceMaker · ' + title; $('breadcrumb').textContent = $('page-title').textContent = title; $('page-description').textContent = description; $(current + '-view').hidden = false;
  let alarms = [], alarmMachines = [], refreshing = false, dirty = false, alarmPage = 0, alarmPageSize = 10, initialLoading = false;
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const notice = text => { $('notice').hidden = !text; $('notice').textContent = text; };
  const skeletonLine = width => { const line = node('span', undefined, 'skeleton-line'); line.style.width = width; line.setAttribute('aria-hidden', 'true'); return line; };
  function skeletonRows(target, columns, count = 4) {
    const body = $(target), labels = [...body.closest('table').querySelectorAll('thead th')].map(th => th.textContent.trim()); body.setAttribute('aria-busy', 'true');
    body.replaceChildren(...Array.from({ length: count }, () => {
      const row = node('tr', undefined, 'skeleton-row'); row.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < columns; i++) { const cell = node('td'); cell.dataset.label = labels[i] || ''; cell.append(skeletonLine([58, 76, 64, 84, 52, 70][i % 6] + '%')); row.append(cell); }
      return row;
    }));
  }
  function showInitialSkeleton() {
    initialLoading = true;
    if (current === 'alarms') { skeletonRows('alarm-rows', 6); return; }
    if (current === 'dashboards') { skeletonRows('dashboard-rows', 6); return; }
    if (current !== 'home') return;
    const summary = $('summary'); summary.setAttribute('aria-busy', 'true');
    summary.replaceChildren(...Array.from({ length: 4 }, () => { const card = node('article', undefined, 'skeleton-card'); card.setAttribute('aria-hidden', 'true'); card.append(skeletonLine('48%'), skeletonLine('28%'), skeletonLine('66%')); return card; }));
    skeletonRows('home-rows', 6, 3);
    const activity = $('home-activity-list'); activity.setAttribute('aria-busy', 'true');
    activity.replaceChildren(...Array.from({ length: 2 }, () => { const row = node('div', undefined, 'skeleton-activity'); row.setAttribute('aria-hidden', 'true'); row.append(skeletonLine('42%'), skeletonLine('72%')); return row; }));
  }
  function finishInitialSkeleton(clear = false) {
    if (!initialLoading) return;
    if (clear) document.querySelectorAll('.skeleton-row, .skeleton-card, .skeleton-activity').forEach(el => el.remove());
    document.querySelectorAll('[aria-busy="true"]').forEach(el => el.setAttribute('aria-busy', 'false'));
    initialLoading = false;
  }
  const date = ts => new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
  const metrics = { waterTemperature: 'อุณหภูมิน้ำ', acLineVoltage: 'แรงดันไฟฟ้า AC', compressorCurrent: 'กระแสไฟคอมเพรสเซอร์', compressorPower: 'กำลังไฟคอมเพรสเซอร์' };
  const severity = a => a.severity || (a.rule === 'tank' ? 'info' : 'critical');
  const ruleLabel = a => ({ offline: 'การเชื่อมต่อ', sensor: 'เซนเซอร์', tank: 'ระดับถัง', waterTemperature: 'อุณหภูมิน้ำ', acLineVoltage: 'แรงดันไฟฟ้า AC', compressorCurrent: 'กระแสคอมเพรสเซอร์', compressorPower: 'กำลังไฟคอมเพรสเซอร์' }[a.rule] || a.rule || 'ระบบ');
  const alarmSummary = node('div', undefined, 'alarm-summary'); alarmSummary.id = 'alarm-summary'; alarmSummary.setAttribute('aria-label', 'สรุปเหตุการณ์'); alarmSummary.setAttribute('aria-live', 'polite');
  $('alarms-view').insertBefore(alarmSummary, $('alarms-view').firstElementChild);
  const severityLabel = node('label', 'ระดับ '), severityFilter = node('select'); severityFilter.id = 'severity-filter';
  for (const [value, text] of [['critical', 'วิกฤต'], ['all', 'ทุกระดับ'], ['info', 'ข้อมูลทั่วไป']]) { const option = node('option', text); option.value = value; severityFilter.append(option); }
  severityFilter.value = 'all'; severityFilter.setAttribute('aria-label', 'กรองตามระดับเหตุการณ์'); severityLabel.append(severityFilter);
  const searchLabel = node('label', undefined, 'alarm-search-label'), alarmIcon = node('span', undefined, 'alarm-search-icon'), alarmSearch = node('input'); alarmSearch.type = 'search'; alarmSearch.id = 'alarm-search'; alarmSearch.placeholder = 'ค้นหาอุปกรณ์หรือเหตุการณ์'; alarmSearch.setAttribute('aria-label', 'ค้นหาอุปกรณ์หรือเหตุการณ์'); alarmIcon.setAttribute('aria-hidden', 'true'); searchLabel.append(alarmIcon, alarmSearch);
  const alarmPanel = $('alarms-view').querySelector('.panel'), panelHeading = alarmPanel.querySelector('.panel-heading');
  const alarmToolbar = node('div', undefined, 'alarm-toolbar'), alarmFilters = node('div', undefined, 'alarm-filters');
  alarmFilters.append(severityLabel, searchLabel); alarmToolbar.append(alarmFilters); panelHeading.after(alarmToolbar);
  const headingRow = $('alarms-view').querySelector('thead tr');
  headingRow.replaceChildren(...['รายละเอียดเหตุการณ์', 'อุปกรณ์ / แหล่งที่มา', 'เวลา (กรุงเทพฯ)', 'ระดับ', 'สถานะ', 'จัดการ'].map(label => node('th', label)));
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
    const body = $(target), labels = [...body.closest('table').querySelectorAll('thead th')].map(th => th.textContent.trim());
    body.setAttribute('aria-busy', 'false');
    $(target).replaceChildren(...machines.map(machine => {
      const row = node('tr'), name = node('td'), link = node('a', machine.name, 'machine-name-link');
      const href = '/dashboard?machine=' + encodeURIComponent(machine.id); link.href = href; name.append(link);
      const status = node('td'); status.append(node('span', machine.online ? 'กำลังรับข้อมูล' : 'ออฟไลน์ / รอข้อมูล', 'badge' + (machine.online ? ' online' : '')));
      const action = node('td'), open = node('a', 'เปิดแดชบอร์ด →', 'table-dashboard-link'); open.href = href; open.setAttribute('aria-label', 'เปิดแดชบอร์ด ' + machine.name); action.append(open);
      row.append(name, node('td', machine.location || '—'), node('td', machine.connection === 'usb' ? 'USB' : 'Wi-Fi / MQTT'), status, node('td', machine.lastSeen ? date(machine.lastSeen) : 'ยังไม่ได้รับข้อมูล', 'date-cell'), action);
      row.querySelectorAll('td').forEach((cell, index) => { cell.dataset.label = labels[index] || ''; });
      return row;
    }));
    if (!machines.length) { const row = node('tr', undefined, 'empty-row'), cell = node('td', 'ยังไม่มีอุปกรณ์ เพิ่มเครื่องที่หน้าอุปกรณ์เพื่อเริ่มใช้งาน', 'workspace-empty'); cell.colSpan = 6; row.append(cell); $(target).append(row); }
  }
  function renderAlarms() {
    if (detailId) renderDetail();
    const active = alarms.filter(a => !a.resolvedAt), critical = active.filter(a => severity(a) === 'critical').length, info = active.length - critical, resolved = alarms.length - active.length;
    alarmSummary.replaceChildren(...[
      ['เหตุการณ์ทั้งหมด', alarms.length, 'active'],
      ['วิกฤต', critical, 'critical'],
      ['ข้อมูลทั่วไป', info, 'info'],
      ['สิ้นสุดแล้ว', resolved, 'resolved']
    ].map(([label, count, tone]) => { const card = node('article', undefined, 'alarm-stat alarm-stat-' + tone); card.append(node('span', label), node('strong', String(count))); return card; }));
    const noDataDevices = alarmMachines.filter(m => !m.online && !m.lastSeen).length, offlineDevices = alarmMachines.filter(m => !m.online && m.lastSeen).length;
    const deviceHint = noDataDevices ? `ยังไม่เคยได้รับข้อมูลจาก ${noDataDevices} เครื่อง` : offlineDevices ? `${offlineDevices} เครื่องขาดการเชื่อมต่อ` : '';
    $('alarms-view').querySelector('.panel-heading p').textContent = `${alarms.length} เหตุการณ์${deviceHint ? ' · ' + deviceHint : ''} · รายการที่กำลังเกิดแสดงก่อน · อัปเดตทุก 5 วินาที`;
    const query = alarmSearch.value.trim().toLocaleLowerCase('th-TH');
    const filtered = alarms.filter(a => (severityFilter.value === 'all' || severity(a) === severityFilter.value) && (!query || `${a.machineName || ''} ${a.message || ''} ${a.rule || ''}`.toLocaleLowerCase('th-TH').includes(query))).sort((a, b) => Number(Boolean(a.resolvedAt)) - Number(Boolean(b.resolvedAt)) || (!a.resolvedAt ? (severity(a) === 'critical' ? 0 : 1) - (severity(b) === 'critical' ? 0 : 1) : 0) || b.createdAt - a.createdAt);
    const lastPage = Math.max(0, Math.ceil(filtered.length / alarmPageSize) - 1); alarmPage = Math.min(alarmPage, lastPage);
    const start = alarmPage * alarmPageSize;
    pageCount.textContent = `${filtered.length ? start + 1 : 0}–${Math.min(start + alarmPageSize, filtered.length)} จาก ${filtered.length}`;
    buttons[0].disabled = buttons[1].disabled = alarmPage === 0; buttons[2].disabled = buttons[3].disabled = alarmPage === lastPage;
    buttons[0].onclick = () => { alarmPage = 0; renderAlarms(); }; buttons[1].onclick = () => { alarmPage--; renderAlarms(); }; buttons[2].onclick = () => { alarmPage++; renderAlarms(); }; buttons[3].onclick = () => { alarmPage = lastPage; renderAlarms(); };
    $('alarm-rows').setAttribute('aria-busy', 'false');
    $('alarm-rows').replaceChildren(...filtered.slice(start, start + alarmPageSize).map(a => {
      const row = node('tr'), detail = node('td'), link = node('a', a.message || 'เหตุการณ์จากอุปกรณ์', 'alarm-detail-link'); link.href = '/alarms?event=' + encodeURIComponent(a.id); detail.append(link);
      link.onclick = event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); detailId = a.id; history.replaceState(null, '', link.href); renderDetail(); };
      if (a.metric) detail.append(node('small', 'ค่าล่าสุด ' + a.currentValue + ' · เกณฑ์ ' + a.comparison + ' ' + a.limit, 'alarm-reading'));
      row.classList.toggle('critical-alarm', severity(a) === 'critical' && !a.resolvedAt);
      const source = node('td', undefined, 'alarm-source'); source.append(node('strong', a.machineName || '—'), node('small', ruleLabel(a)));
      const level = node('td'), status = node('td'), action = node('td');
      level.append(node('span', severity(a) === 'critical' ? '● วิกฤต' : '● ทั่วไป', 'severity-badge severity-' + severity(a)));
      status.append(node('span', a.resolvedAt ? 'สิ้นสุดแล้ว' : 'กำลังเกิดขึ้น', 'alarm-state' + (a.resolvedAt ? ' alarm-state-resolved' : ' alarm-state-active')));
      const open = node('button', 'ดูรายละเอียด', 'alarm-action'); open.type = 'button'; open.onclick = () => { detailId = a.id; history.replaceState(null, '', '/alarms?event=' + encodeURIComponent(a.id)); renderDetail(); }; action.append(open);
      row.append(detail, source, node('td', date(a.createdAt), 'alarm-time'), level, status, action);
      const labels = [...$('alarm-rows').closest('table').querySelectorAll('thead th')].map(th => th.textContent.trim());
      row.querySelectorAll('td').forEach((cell, index) => { cell.dataset.label = labels[index] || ''; });
      return row;
    }));
    if (!filtered.length) {
      const row = node('tr', undefined, 'empty-row'), cell = node('td', undefined, 'workspace-empty'); cell.colSpan = 6;
      cell.append(node('strong', alarms.length ? 'ไม่พบเหตุการณ์ที่ตรงกับตัวกรอง' : 'ยังไม่มีเหตุการณ์'), node('span', alarms.length ? 'ลองเปลี่ยนระดับหรือคำค้นหา' : deviceHint || 'เมื่ออุปกรณ์รายงานเหตุการณ์ รายการจะแสดงตรงนี้'));
      if (!alarms.length && (noDataDevices || offlineDevices)) { const link = node('a', 'ตรวจสอบอุปกรณ์ →', 'alarm-empty-link'); link.href = '/devices'; cell.append(link); }
      row.append(cell); $('alarm-rows').append(row);
    }
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
  function renderHomeActivity(active) {
    const list = $('home-activity-list');
    if (!list) return;
    $('home-activity-title').textContent = '\u0e40\u0e2b\u0e15\u0e38\u0e01\u0e32\u0e23\u0e13\u0e4c\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14';
    $('home-activity-summary').textContent = active.length ? '\u0e21\u0e35 ' + active.length + ' \u0e40\u0e2b\u0e15\u0e38\u0e01\u0e32\u0e23\u0e13\u0e4c\u0e17\u0e35\u0e48\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49\u0e41\u0e01\u0e49\u0e44\u0e02' : '\u0e2a\u0e23\u0e38\u0e1b\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e02\u0e2d\u0e07\u0e40\u0e2b\u0e15\u0e38\u0e01\u0e32\u0e23\u0e13\u0e1b\u0e31\u0e08\u0e08\u0e38\u0e1a\u0e31\u0e19';
    list.replaceChildren();
    if (!active.length) {
      const empty = node('div', undefined, 'home-activity-empty');
      empty.append(node('span', '\u2713', 'home-activity-check'), node('strong', '\u0e44\u0e21\u0e48\u0e21\u0e35\u0e40\u0e2b\u0e15\u0e38\u0e01\u0e32\u0e23\u0e13\u0e17\u0e35\u0e48\u0e15\u0e49\u0e2d\u0e07\u0e14\u0e33\u0e40\u0e19\u0e34\u0e19\u0e01\u0e32\u0e23'), node('p', '\u0e23\u0e30\u0e1a\u0e1a\u0e01\u0e25\u0e31\u0e1a\u0e21\u0e32\u0e41\u0e2a\u0e14\u0e07\u0e17\u0e35\u0e48\u0e19\u0e35\u0e48\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e1e\u0e1a\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e1c\u0e34\u0e14\u0e1b\u0e01\u0e15\u0e34'));
      list.append(empty);
      return;
    }
    for (const alarm of active.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4)) {
      const row = node('article', undefined, 'home-activity-item');
      const detail = node('div'); detail.append(node('strong', alarm.machineName || alarm.machineId || '\u0e2d\u0e38\u0e1b\u0e01\u0e23\u0e13\u0e4c'), node('p', alarm.message || alarm.rule || ''));
      const meta = node('div', undefined, 'home-activity-meta');
      const level = severity(alarm);
      meta.append(node('span', level === 'critical' ? '\u0e27\u0e34\u0e01\u0e24\u0e15' : '\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25', 'severity-badge severity-' + level), node('time', date(alarm.createdAt)));
      const link = node('a', '\u0e14\u0e39\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14', 'home-activity-open'); link.href = '/alarms?event=' + encodeURIComponent(alarm.id);
      row.append(detail, meta, link); list.append(row);
    }
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
      if (current === 'notifications') { if (!dirty) fillSettings(await api('/api/notifications')); finishInitialSkeleton(); return; }
      if (current === 'alarms') { [alarms, alarmMachines] = await Promise.all([api('/api/alarms'), api('/api/machines')]); renderAlarms(); finishInitialSkeleton(); return; }
      const machines = await api('/api/machines');
      if (current === 'dashboards') dashboardTable(machines);
      else { alarms = await api('/api/alarms'); const active = alarms.filter(a => !a.resolvedAt); $('summary').replaceChildren(...[['อุปกรณ์ทั้งหมด', machines.length], ['กำลังรับข้อมูล', machines.filter(m => m.online).length], ['ออฟไลน์ / รอข้อมูล', machines.filter(m => !m.online).length], ['เหตุการณ์ที่กำลังเกิดขึ้น', active.length]].map(([label, count]) => { const a = node('article'); a.append(node('span', label), node('strong', String(count))); return a; })); dashboardTable(machines, 'home-rows'); renderHomeActivity(active); }
      finishInitialSkeleton();
    } catch (e) { finishInitialSkeleton(true); notice(e.message); } finally { refreshing = false; }
  }
  $('reload').onclick = refresh; severityFilter.onchange = alarmSearch.oninput = () => { alarmPage = 0; renderAlarms(); }; pageSize.onchange = () => { alarmPageSize = Number(pageSize.value); alarmPage = 0; renderAlarms(); };
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
  (async () => { try { const session = await api('/api/auth/session'); if (!session.authenticated) return location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search)); $('logout').hidden = !session.enabled; showInitialSkeleton(); await refresh(); if (current !== 'notifications') setInterval(refresh, 5000); } catch (e) { finishInitialSkeleton(true); notice(e.message); } })();
})();
