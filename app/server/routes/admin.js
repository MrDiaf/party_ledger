import { Router } from 'express';
import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db.js';
import { HttpError, h, str, hashPassword, parseCookies, PUBLIC_USER } from '../core.js';

// ---- LAN-only gate for the admin port -------------------------------------------------
// Tailscale hands out 100.64.0.0/10 (IPv4) and fd7a:115c:a1e0::/48 (IPv6). These are ALWAYS
// rejected, even if someone widens ADMIN_ALLOWED_CIDRS, so the back door never opens over Tailscale.
const DEFAULT_CIDRS = '127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16';
const ALWAYS_DENY = ['100.64.0.0/10'];

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inCidr(ipInt, cidr) {
  const [base, bitsStr] = cidr.trim().split('/');
  const baseInt = ipv4ToInt(base);
  const bits = Number(bitsStr ?? 32);
  if (baseInt == null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

export function isTrustedAdminRequest(remoteAddress, headers = {}, cidrs = process.env.ADMIN_ALLOWED_CIDRS || DEFAULT_CIDRS) {
  if (Object.keys(headers).some((k) => k.toLowerCase().startsWith('tailscale-'))) return false;
  let ip = String(remoteAddress || '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') return true;
  const n = ipv4ToInt(ip);
  if (n == null) return false; // other IPv6 (incl. Tailscale fd7a:…) not trusted
  if (ALWAYS_DENY.some((c) => inCidr(n, c))) return false;
  return cidrs.split(',').filter(Boolean).some((c) => inCidr(n, c));
}

export function adminNetworkGate(req, res, next) {
  if (isTrustedAdminRequest(req.socket.remoteAddress, req.headers)) return next();
  res.status(403).type('text').send('Admin access is only available from the home network.');
}

// ---- optional ADMIN_PASSWORD on top of the network gate --------------------------------
const ADMIN_COOKIE = 'dnd_admin';
const adminToken = () => crypto.createHmac('sha256', process.env.ADMIN_PASSWORD).update('dnd-admin').digest('hex');

/**
 * The admin API is mounted only on the LAN admin port (behind adminNetworkGate). App accounts —
 * DMs included — never get admin powers; admin belongs to whoever runs the server.
 */
export function adminAuth() {
  return (req, _res, next) => {
    if (!process.env.ADMIN_PASSWORD || req.path === '/unlock' || req.path === '/whoami') return next();
    if (parseCookies(req.headers.cookie)[ADMIN_COOKIE] === adminToken()) return next();
    next(new HttpError(401, 'Admin password required'));
  };
}

export function adminRouter(db, extra) {
  const r = Router();
  r.use(adminAuth());

  r.get('/whoami', h((req) => ({
    via: 'network',
    needs_password: !!process.env.ADMIN_PASSWORD && parseCookies(req.headers.cookie)[ADMIN_COOKIE] !== adminToken(),
  })));

  r.post('/unlock', h((req, res) => {
    if (!process.env.ADMIN_PASSWORD) return { ok: true };
    const a = Buffer.from(str(req.body.password, 1000));
    const b = Buffer.from(process.env.ADMIN_PASSWORD);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Wrong admin password');
    res.cookie(ADMIN_COOKIE, adminToken(), { httpOnly: true, sameSite: 'strict', path: '/' });
    return { ok: true };
  }));

  r.get('/users', h(() => db.prepare(
    `SELECT ${PUBLIC_USER}, created_at,
      (SELECT COUNT(*) FROM characters c WHERE c.user_id = users.id) AS characters,
      (SELECT MAX(expires_at) FROM sessions s WHERE s.user_id = users.id) AS last_session_expiry
     FROM users ORDER BY username`
  ).all()));

  r.post('/users', h((req) => {
    const username = str(req.body.username, 64).trim();
    if (!username || !str(req.body.password)) throw new HttpError(400, 'Username and password required');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Username already taken');
    const id = db.prepare('INSERT INTO users(username, display_name, password_hash) VALUES(?,?,?)')
      .run(username, str(req.body.display_name, 64).trim() || username, hashPassword(req.body.password)).lastInsertRowid;
    return { id: Number(id) };
  }));

  r.post('/users/:id/password', h((req) => {
    const pw = str(req.body.password, 1000);
    if (!pw) throw new HttpError(400, 'Password is required');
    const info = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), Number(req.params.id));
    if (!info.changes) throw new HttpError(404, 'No such user');
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(req.params.id));
    return { ok: true };
  }));

  r.patch('/users/:id', h((req) => {
    const id = Number(req.params.id);
    const b = req.body;
    if (b.display_name != null) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(str(b.display_name, 64), id);
    if (b.username != null && str(b.username, 64).trim()) {
      const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(str(b.username, 64).trim(), id);
      if (clash) throw new HttpError(409, 'Username already taken');
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(str(b.username, 64).trim(), id);
    }
    return { ok: true };
  }));

  r.post('/users/:id/logout', h((req) => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(req.params.id));
    return { ok: true };
  }));

  r.delete('/users/:id', h((req) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  }));

  r.get('/campaigns', h(() => db.prepare(
    `SELECT c.id, c.name, c.invite_code, (SELECT COUNT(*) FROM campaign_members m WHERE m.campaign_id = c.id) AS members FROM campaigns c ORDER BY c.name`
  ).all()));

  r.get('/settings', h(() => ({
    registration_open: getSetting(db, 'registration_open'),
    ai_enabled: getSetting(db, 'ai_enabled'),
    ai_model: getSetting(db, 'ai_model'),
    ai_disabled_tools: getSetting(db, 'ai_disabled_tools'),
  })));

  r.patch('/settings', h((req) => {
    const b = req.body;
    if (b.registration_open != null) setSetting(db, 'registration_open', !!b.registration_open);
    if (b.ai_enabled != null) setSetting(db, 'ai_enabled', !!b.ai_enabled);
    if (b.ai_model != null) setSetting(db, 'ai_model', str(b.ai_model, 80).trim());
    if (Array.isArray(b.ai_disabled_tools)) setSetting(db, 'ai_disabled_tools', b.ai_disabled_tools.map((t) => str(t, 80)));
    return { ok: true };
  }));

  if (extra) extra(r);
  return r;
}
