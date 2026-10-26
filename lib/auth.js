const crypto = require('node:crypto');
function authManager(options = {}) {
  const enabled = options.enabled ?? process.env.AUTH_ENABLED === 'true';
  const username = options.username || process.env.ADMIN_USER || 'admin';
  const password = options.password || process.env.ADMIN_PASSWORD;
  const origin = options.origin || process.env.APP_ORIGIN || '';
  if (enabled && !options.passwordHash && (!password || password.length < 12)) throw new Error('Set ADMIN_PASSWORD to at least 12 characters.');
  if (origin && !/^https?:\/\/[^/]+$/.test(origin)) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path or trailing slash.');
  if (origin && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname) && (!enabled || !origin.startsWith('https://'))) throw new Error('Cloud access requires AUTH_ENABLED=true and an HTTPS APP_ORIGIN.');
  const sessions = new Map(), attempts = new Map();
  const digest = value => crypto.createHash('sha256').update(value).digest();
  const equal = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
  function authorized(req) {
    if (!enabled) return true;
    const token = (req.headers.cookie || '').split(';').map(p => p.trim()).find(p => p.startsWith('icemaker_session='))?.slice(17);
    const expires = sessions.get(token);
    if (!expires || expires < Date.now()) { sessions.delete(token); return false; }
    return true;
  }
  function login(req, input) {
    if (!enabled) return { ok: true };
    const now = Date.now(), ip = req.socket.remoteAddress;
    // Bounded rate-limit/session maps; do not trust a caller-supplied forwarded IP.
    for (const [key, item] of attempts) if (item.until < now) attempts.delete(key);
    for (const [key, expiry] of sessions) if (expiry < now) sessions.delete(key);
    if (attempts.size > 10000 || sessions.size > 1000) return { status: 429, error: 'มีคำขอเข้าสู่ระบบมากเกินไป กรุณาลองใหม่ภายหลัง' };
    const attempt = attempts.get(ip) || { count: 0, until: now + 15 * 60000 };
    if (attempt.count >= 10) return { status: 429, error: 'เข้าสู่ระบบไม่สำเร็จหลายครั้ง กรุณาลองใหม่ในอีก 15 นาที' };
    attempt.count++; attempts.set(ip, attempt);
    if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.password.length > 1024 || !equal(input.username, username) || !(options.passwordHash ? equal(crypto.scryptSync(input.password, options.passwordSalt, 64).toString('hex'), options.passwordHash) : equal(input.password, password))) return { status: 401, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, now + 12 * 3600000);
    return { ok: true, cookie: `icemaker_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${origin.startsWith('https://') ? '; Secure' : ''}` };
  }
  function logout(req) {
    const token = (req.headers.cookie || '').split(';').map(p => p.trim()).find(p => p.startsWith('icemaker_session='))?.slice(17);
    sessions.delete(token);
    return `icemaker_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${origin.startsWith('https://') ? '; Secure' : ''}`;
  }
  return { enabled, username, origin, authorized, login, logout };
}
module.exports = { authManager };
