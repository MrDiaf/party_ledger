import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const SESSION_COOKIE = 'dnd_session';
const SESSION_DAYS = 60;

// Passwords: deliberately no length/complexity rules (owner's requirement) — only non-empty.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)').run(token, userId, expires);
  return { token, expires };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const PUBLIC_USER = 'id, username, display_name, color';

export function userFromToken(db, token) {
  if (!token) return null;
  return db.prepare(
    `SELECT u.id, u.username, u.display_name, u.color FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, new Date().toISOString()) || null;
}

/** Express middleware: attaches req.user (or null). */
export function sessionMiddleware(db) {
  return (req, _res, next) => {
    req.user = userFromToken(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    next();
  };
}

export function requireUser(req) {
  if (!req.user) throw new HttpError(401, 'Not logged in');
  return req.user;
}

export function membership(db, user, campaignId) {
  return db.prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?').get(Number(campaignId), user.id);
}

/** Any member may read/write party content; returns role. There is no site-wide override. */
export function requireMember(db, user, campaignId) {
  const m = membership(db, user, campaignId);
  if (m) return m.role;
  throw new HttpError(403, 'You are not a member of this party');
}

export function requireDm(db, user, campaignId) {
  const role = requireMember(db, user, campaignId);
  if (role !== 'dm') throw new HttpError(403, 'Only the DM can do that');
  return role;
}

export const str = (v, max = 20000) => (v == null ? '' : String(v).slice(0, max));

/** Wrap async route handlers so thrown HttpErrors become JSON responses. */
export const h = (fn) => async (req, res, next) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    next(e);
  }
};

export function errorHandler(err, _req, res, _next) {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Internal error' : err.message });
}
