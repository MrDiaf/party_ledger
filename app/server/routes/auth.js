import { Router } from 'express';
import crypto from 'node:crypto';
import { getSetting, tx } from '../db.js';
import {
  HttpError, h, str, hashPassword, verifyPassword, createSession, parseCookies,
  SESSION_COOKIE, requireUser, requireMember, requireDm, PUBLIC_USER,
} from '../core.js';

const PALETTE = ['#c9a227', '#4f9dde', '#d9534f', '#5cb85c', '#a06cd5', '#e8853d', '#3fbfad', '#e05ea0', '#8d9b3a', '#7a8cff'];

function setSessionCookie(res, { token, expires }) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', expires: new Date(expires), path: '/' });
}

export function myCampaigns(db, userId) {
  return db.prepare(
    `SELECT c.id, c.name, c.description, m.role FROM campaigns c JOIN campaign_members m ON m.campaign_id = c.id
     WHERE m.user_id = ? ORDER BY c.name`
  ).all(userId);
}

export function inviteCode() {
  return crypto.randomBytes(5).toString('base64url').toUpperCase().replace(/[-_]/g, 'X');
}

export function authRouter(db) {
  const r = Router();

  r.post('/register', h((req, res) => {
    const username = str(req.body.username, 64).trim();
    const password = str(req.body.password, 1000);
    if (!username) throw new HttpError(400, 'Username is required');
    if (!password) throw new HttpError(400, 'Password is required');
    const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
    if (count > 0 && !getSetting(db, 'registration_open')) throw new HttpError(403, 'Registration is closed — ask the admin');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Username already taken');
    const info = db.prepare('INSERT INTO users(username, display_name, password_hash, color) VALUES(?,?,?,?)')
      .run(username, str(req.body.display_name, 64).trim() || username, hashPassword(password), PALETTE[count % PALETTE.length]);
    setSessionCookie(res, createSession(db, Number(info.lastInsertRowid)));
    return { ok: true };
  }));

  r.post('/login', h((req, res) => {
    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(str(req.body.username, 64).trim());
    if (!user || !verifyPassword(str(req.body.password, 1000), user.password_hash)) throw new HttpError(401, 'Wrong username or password');
    setSessionCookie(res, createSession(db, user.id));
    return { ok: true };
  }));

  r.post('/logout', h((req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  r.get('/me', h((req) => {
    if (!req.user) return { user: null, registration_open: !!getSetting(db, 'registration_open') || db.prepare('SELECT COUNT(*) n FROM users').get().n === 0 };
    return { user: req.user, campaigns: myCampaigns(db, req.user.id), ai_enabled: !!getSetting(db, 'ai_enabled') };
  }));

  r.patch('/me', h((req) => {
    const user = requireUser(req);
    const b = req.body;
    if (b.display_name != null) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(str(b.display_name, 64).trim() || user.username, user.id);
    if (b.color != null && /^#[0-9a-f]{6}$/i.test(b.color)) db.prepare('UPDATE users SET color = ? WHERE id = ?').run(b.color, user.id);
    if (b.new_password != null) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
      if (!verifyPassword(str(b.current_password, 1000), row.password_hash)) throw new HttpError(400, 'Current password is wrong');
      if (!str(b.new_password)) throw new HttpError(400, 'New password is required');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.new_password), user.id);
    }
    return { user: db.prepare(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`).get(user.id) };
  }));

  return r;
}

export function campaignsRouter(db) {
  const r = Router();

  r.get('/', h((req) => myCampaigns(db, requireUser(req).id)));

  r.post('/', h((req) => {
    const user = requireUser(req);
    const name = str(req.body.name, 120).trim();
    if (!name) throw new HttpError(400, 'Name is required');
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO campaigns(name, description, invite_code, created_by) VALUES(?,?,?,?)')
        .run(name, str(req.body.description), inviteCode(), user.id).lastInsertRowid);
      db.prepare("INSERT INTO campaign_members(campaign_id, user_id, role) VALUES(?,?, 'dm')").run(id, user.id);
      seedCurrencies(db, id);
      return { id };
    });
  }));

  r.post('/join', h((req) => {
    const user = requireUser(req);
    const c = db.prepare('SELECT id FROM campaigns WHERE invite_code = ?').get(str(req.body.code, 40).trim().toUpperCase());
    if (!c) throw new HttpError(404, 'No party with that invite code');
    db.prepare("INSERT OR IGNORE INTO campaign_members(campaign_id, user_id, role) VALUES(?,?,'player')").run(c.id, user.id);
    return { id: c.id };
  }));

  r.get('/:id', h((req) => {
    const user = requireUser(req);
    const role = requireMember(db, user, req.params.id);
    const c = db.prepare('SELECT id, name, description, invite_code FROM campaigns WHERE id = ?').get(Number(req.params.id));
    c.members = db.prepare(
      `SELECT u.id, u.username, u.display_name, u.color, m.role FROM campaign_members m JOIN users u ON u.id = m.user_id
       WHERE m.campaign_id = ? ORDER BY m.role = 'dm' DESC, u.display_name`
    ).all(c.id);
    c.my_role = role;
    return c;
  }));

  r.patch('/:id', h((req) => {
    const user = requireUser(req);
    requireDm(db, user, req.params.id);
    const b = req.body;
    if (b.name != null) db.prepare('UPDATE campaigns SET name = ? WHERE id = ?').run(str(b.name, 120).trim() || 'Party', Number(req.params.id));
    if (b.description != null) db.prepare('UPDATE campaigns SET description = ? WHERE id = ?').run(str(b.description), Number(req.params.id));
    if (b.regenerate_invite) db.prepare('UPDATE campaigns SET invite_code = ? WHERE id = ?').run(inviteCode(), Number(req.params.id));
    return { ok: true };
  }));

  r.patch('/:id/members/:userId', h((req) => {
    requireDm(db, requireUser(req), req.params.id);
    const role = req.body.role === 'dm' ? 'dm' : 'player';
    db.prepare('UPDATE campaign_members SET role = ? WHERE campaign_id = ? AND user_id = ?').run(role, Number(req.params.id), Number(req.params.userId));
    return { ok: true };
  }));

  r.delete('/:id/members/:userId', h((req) => {
    const user = requireUser(req);
    if (Number(req.params.userId) !== user.id) requireDm(db, user, req.params.id);
    db.prepare('DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?').run(Number(req.params.id), Number(req.params.userId));
    return { ok: true };
  }));

  r.delete('/:id', h((req) => {
    requireDm(db, requireUser(req), req.params.id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  }));

  return r;
}

export function seedCurrencies(db, campaignId) {
  const ins = db.prepare('INSERT INTO currencies(campaign_id, name, abbr, gp_value, sort) VALUES(?,?,?,?,?)');
  [['Platinum', 'pp', 10], ['Gold', 'gp', 1], ['Electrum', 'ep', 0.5], ['Silver', 'sp', 0.1], ['Copper', 'cp', 0.01]]
    .forEach(([n, a, v], i) => ins.run(campaignId, n, a, v, i));
}
