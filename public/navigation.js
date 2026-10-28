(() => {
  const ns = 'http://www.w3.org/2000/svg';
  const links = [
    ['หน้าแรก', '/home', ['M3.5 10.5 12 3.5l8.5 7', 'M5.5 9v11h13V9', 'M9.5 20v-6.5h5V20']],
    ['แจ้งเตือน', '/alarms', ['M12 3 2.8 19h18.4L12 3Z', 'M12 9v4', 'M12 16.5h.01']],
    ['แดชบอร์ด', '/dashboards', ['M4 4.5h6v6H4z', 'M14 4.5h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z']],
    ['อุปกรณ์', '/devices', ['M6 3.5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z', 'M4 8.5h16', 'M8 6h.01', 'M8 12v7']],
    ['ศูนย์การแจ้งเตือน', '/notifications', ['M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4']],
  ];
  const aside = document.querySelector('aside');
  if (!aside) return;
  aside.querySelectorAll('.nav').forEach(el => el.remove());
  const marker = aside.querySelector('.sidebar-foot');
  const navigation = document.createElement('nav');
  navigation.className = 'workspace-navigation';
  navigation.id = 'workspace-navigation';
  navigation.setAttribute('aria-label', 'เมนูหลัก');
  aside.insertBefore(navigation, marker);

  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'mobile-menu-toggle';
  menuButton.setAttribute('aria-controls', navigation.id);
  const menuIcon = document.createElementNS(ns, 'svg');
  menuIcon.setAttribute('viewBox', '0 0 24 24');
  menuIcon.setAttribute('class', 'menu-icon');
  menuIcon.setAttribute('aria-hidden', 'true');
  menuIcon.setAttribute('focusable', 'false');
  for (const d of ['M4 7h16', 'M4 12h16', 'M4 17h16']) {
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); menuIcon.append(path);
  }
  const menuLabel = document.createElement('span'); menuLabel.textContent = 'เมนู';
  menuButton.append(menuIcon, menuLabel);
  aside.querySelector('.brand').after(menuButton);

  const mobileMenu = matchMedia('(max-width: 800px)');
  function syncMobileMenu() {
    const isMobile = mobileMenu.matches;
    const isOpen = isMobile && aside.classList.contains('mobile-menu-open');
    menuButton.hidden = !isMobile;
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'ปิดเมนู' : 'เปิดเมนู');
    menuLabel.textContent = isOpen ? 'ปิด' : 'เมนู';
    navigation.setAttribute('aria-hidden', String(isMobile && !isOpen));
    navigation.inert = isMobile && !isOpen;
    if (!isMobile) aside.classList.remove('mobile-menu-open');
  }
  menuButton.addEventListener('click', () => {
    const open = !aside.classList.contains('mobile-menu-open');
    aside.classList.toggle('mobile-menu-open', open);
    syncMobileMenu();
    if (open) navigation.querySelector('.nav')?.focus();
    else menuButton.focus();
  });
  navigation.addEventListener('click', event => { if (event.target.closest('a')) aside.classList.remove('mobile-menu-open'); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && aside.classList.contains('mobile-menu-open')) {
      aside.classList.remove('mobile-menu-open'); syncMobileMenu(); menuButton.focus();
    }
  });
  mobileMenu.addEventListener('change', () => { aside.classList.remove('mobile-menu-open'); syncMobileMenu(); });
  syncMobileMenu();

  for (const [text, href, paths] of links) {
    const a = document.createElement('a');
    a.href = href;
    a.className = 'nav';
    const icon = document.createElementNS(ns, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('class', 'nav-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    for (const d of paths) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      icon.append(path);
    }
    const label = document.createElement('span');
    label.className = 'nav-text';
    label.textContent = text;
    a.append(icon, label);
    if (location.pathname === href || (href === '/home' && location.pathname === '/') || (href === '/devices' && location.pathname === '/machines') || (href === '/dashboards' && location.pathname === '/dashboard')) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    }
    navigation.append(a);
  }
  aside.querySelector('.brand').href = '/home';
  // Retain the dashboard's machine-specific setup link for its existing controller.
  const setup = document.createElement('a');
  setup.id = 'setup-link';
  setup.hidden = true;
  aside.append(setup);
})();
