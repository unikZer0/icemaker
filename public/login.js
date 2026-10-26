const form = document.getElementById('login-form');
const target = new URLSearchParams(location.search).get('next');
const destination = target && /^\/(dashboard|machines|home|alarms|dashboards|devices|notifications)(\?|$)/.test(target) ? target : '/home';
form.addEventListener('submit', async event => {
  event.preventDefault(); document.getElementById('submit').disabled = true;
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); location.assign(destination);
  } catch (error) { document.getElementById('error').textContent = error.message; } finally { document.getElementById('submit').disabled = false; }
});
fetch('/api/auth/session').then(r => r.json()).then(session => { if (session.authenticated) location.replace(destination); }).catch(() => {});
