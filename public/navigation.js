(() => {
  const links = [['⌂', 'หน้าแรก', '/home'], ['△', 'แจ้งเตือน', '/alarms'], ['▦', 'แดชบอร์ด', '/dashboards'], ['▣', 'อุปกรณ์', '/devices'], ['☷', 'ศูนย์การแจ้งเตือน', '/notifications']];
  const aside = document.querySelector('aside');
  if (!aside) return;
  aside.querySelectorAll('.nav').forEach(el => el.remove());
  const marker = aside.querySelector('.sidebar-foot');
  const navigation = document.createElement('nav'); navigation.className = 'workspace-navigation'; navigation.setAttribute('aria-label', 'เมนูหลัก'); aside.insertBefore(navigation, marker);
  for (const [icon, text, href] of links) {
    const a = document.createElement('a'); a.href = href; a.className = 'nav'; a.textContent = icon + '　' + text;
    if (location.pathname === href || (href === '/home' && location.pathname === '/') || (href === '/devices' && location.pathname === '/machines') || (href === '/dashboards' && location.pathname === '/dashboard')) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
    navigation.append(a);
  }
  aside.querySelector('.brand').href = '/home';
  // Retain the dashboard's machine-specific setup link for its existing controller.
  const setup = document.createElement('a'); setup.id = 'setup-link'; setup.hidden = true; aside.append(setup);
})();
