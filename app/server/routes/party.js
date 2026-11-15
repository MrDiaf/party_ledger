// Party content: calendar, quests, treasury, session logs.
// Service functions take (db, user, ...) and enforce membership; routers and MCP tools both use them.
import { Router } from 'express';
import ical from 'node-ical';
import { tx } from '../db.js';
import { HttpError, h, str, requireUser, requireMember } from '../core.js';
import { cleanItemFields } from '../../shared/items.js';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const iso = (v, name) => {
  const d = new Date(v);
  if (isNaN(d)) throw new HttpError(400, `Invalid ${name}`);
  return d.toISOString();
};

function owned(db, table, id, campaignCol = 'campaign_id') {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
  if (!row) throw new HttpError(404, 'Not found');
  return row[campaignCol];
}

// ============================== CALENDAR ==============================
export const EVENT_KINDS = ['session', 'busy', 'event'];

export function listEvents(db, user, campaignId, { from, to } = {}) {
  requireMember(db, user, campaignId);
  return db.prepare(
    `SELECT e.id, e.user_id, e.kind, e.title, e.description, e.location, e.start, e.end, e.all_day, e.redacted, e.source_uid,
            u.display_name AS author, u.color
     FROM events e JOIN users u ON u.id = e.user_id
     WHERE e.campaign_id = ? AND e.end >= ? AND e.start <= ? ORDER BY e.start`
  ).all(Number(campaignId), from ? iso(from, 'from') : '0000', to ? iso(to, 'to') : '9999');
}

/** Redacted events keep only the time slot — no title/description/location is ever stored. */
function eventFields(b) {
  const redacted = b.redacted ? 1 : 0;
  const start = iso(b.start, 'start');
  const end = b.end ? iso(b.end, 'end') : start;
  if (end < start) throw new HttpError(400, 'End is before start');
  return {
    kind: EVENT_KINDS.includes(b.kind) ? b.kind : redacted ? 'busy' : 'event',
    title: redacted ? 'Busy' : str(b.title, 200).trim() || 'Untitled',
    description: redacted ? '' : str(b.description),
    location: redacted ? '' : str(b.location, 300),
    start, end, all_day: b.all_day ? 1 : 0, redacted,
  };
}

export function createEvent(db, user, campaignId, b) {
  requireMember(db, user, campaignId);
  const f = eventFields(b);
  const id = db.prepare(
    `INSERT INTO events(campaign_id, user_id, kind, title, description, location, start, end, all_day, redacted, source_uid)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).run(Number(campaignId), user.id, f.kind, f.title, f.description, f.location, f.start, f.end, f.all_day, f.redacted, b.source_uid ? str(b.source_uid, 500) : null).lastInsertRowid;
  return { id: Number(id) };
}

function editableEvent(db, user, id) {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id));
  if (!ev) throw new HttpError(404, 'Event not found');
  const role = requireMember(db, user, ev.campaign_id);
  if (ev.user_id !== user.id && role !== 'dm') throw new HttpError(403, 'Only the author or DM can change this event');
  return ev;
}

export function updateEvent(db, user, id, b) {
  const ev = editableEvent(db, user, id);
  const f = eventFields({ ...ev, ...b });
  db.prepare('UPDATE events SET kind=?, title=?, description=?, location=?, start=?, end=?, all_day=?, redacted=? WHERE id=?')
    .run(f.kind, f.title, f.description, f.location, f.start, f.end, f.all_day, f.redacted, ev.id);
  return { ok: true };
}

export function deleteEvent(db, user, id) {
  editableEvent(db, user, id);
  db.prepare('DELETE FROM events WHERE id = ?').run(Number(id));
  return { ok: true };
}

/** Fetch the user's private iCal feed and expand events within [from, to]. Nothing is stored here. */
export async function fetchIcs(url, from, to) {
  let u;
  try { u = new URL(url.replace(/^webcal:/i, 'https:')); } catch { throw new HttpError(400, 'That is not a valid calendar URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Calendar URL must be http(s)');
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!res?.ok) throw new HttpError(502, `Could not download calendar${res ? ` (HTTP ${res.status})` : ''}`);
  const text = await res.text();
  if (text.length > 20e6) throw new HttpError(413, 'Calendar too large');
  let data;
  try { data = ical.sync.parseICS(text); } catch { throw new HttpError(422, 'Could not parse calendar (expected iCal / .ics)'); }
  const out = [];
  for (const ev of Object.values(data)) {
    if (ev.type !== 'VEVENT') continue;
    const allDay = ev.datetype === 'date';
    const dur = ev.end ? new Date(ev.end) - new Date(ev.start) : allDay ? 864e5 : 36e5;
    const starts = [];
    if (ev.rrule) {
      for (const d of ev.rrule.between(new Date(from.getTime() - dur), to, true)) {
        const key = d.toISOString().slice(0, 10);
        if (ev.exdate && Object.keys(ev.exdate).some((k) => k.slice(0, 10) === key)) continue;
        const override = ev.recurrences && Object.entries(ev.recurrences).find(([k]) => k.slice(0, 10) === key)?.[1];
        starts.push({ start: override?.start ? new Date(override.start) : d, ev: override || ev });
      }
    } else starts.push({ start: new Date(ev.start), ev });
    for (const { start, ev: e } of starts) {
      const end = e.end && e !== ev ? new Date(e.end) : new Date(start.getTime() + dur);
      if (end < from || start > to) continue;
      out.push({
        uid: `${ev.uid}|${start.toISOString()}`,
        title: String(e.summary?.val ?? e.summary ?? ''),
        description: String(e.description?.val ?? e.description ?? ''),
        location: String(e.location?.val ?? e.location ?? ''),
        start: start.toISOString(), end: end.toISOString(), all_day: allDay,
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 2000);
}

/** Re-pull the feed and move/remove events this user previously shared from it. */
export async function resyncIcs(db, user, campaignId) {
  requireMember(db, user, campaignId);
  const url = db.prepare('SELECT ics_url FROM users WHERE id = ?').get(user.id).ics_url;
  if (!url) throw new HttpError(400, 'No calendar linked');
  const shared = db.prepare('SELECT * FROM events WHERE campaign_id = ? AND user_id = ? AND source_uid IS NOT NULL').all(Number(campaignId), user.id);
  if (!shared.length) return { updated: 0, removed: 0 };
  const starts = shared.map((e) => new Date(e.start));
  const from = new Date(Math.min(...starts) - 864e5 * 7);
  const to = new Date(Math.max(...starts) + 864e5 * 7);
  const fresh = await fetchIcs(url, from, to);
  const byBase = new Map();
  for (const f of fresh) {
    const base = f.uid.split('|')[0];
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }
  let updated = 0, removed = 0;
  tx(db, () => {
    for (const e of shared) {
      const exact = fresh.find((f) => f.uid === e.source_uid);
      const base = byBase.get(e.source_uid.split('|')[0]);
      const match = exact || (base?.length === 1 ? base[0] : null); // single events whose time moved
      if (!match) { db.prepare('DELETE FROM events WHERE id = ?').run(e.id); removed++; continue; }
      const f = eventFields({ ...match, redacted: e.redacted, kind: e.kind });
      db.prepare('UPDATE events SET title=?, description=?, location=?, start=?, end=?, all_day=?, source_uid=? WHERE id=?')
        .run(f.title, f.description, f.location, f.start, f.end, f.all_day, match.uid, e.id);
      updated++;
    }
  });
  return { updated, removed };
}

function calendarRoutes(r, db) {
  r.get('/:cid/events', h((req) => listEvents(db, requireUser(req), req.params.cid, req.query)));
  r.post('/:cid/events', h((req) => createEvent(db, requireUser(req), req.params.cid, req.body)));
  r.patch('/:cid/events/:id', h((req) => updateEvent(db, requireUser(req), req.params.id, req.body)));
  r.delete('/:cid/events/:id', h((req) => deleteEvent(db, requireUser(req), req.params.id)));

  // Calendar link lives on the user; preview is fetched live and never persisted.
  r.get('/:cid/ics', h((req) => {
    const user = requireUser(req);
    requireMember(db, user, req.params.cid);
    const url = db.prepare('SELECT ics_url FROM users WHERE id = ?').get(user.id).ics_url;
    const shared = db.prepare('SELECT source_uid FROM events WHERE campaign_id = ? AND user_id = ? AND source_uid IS NOT NULL').all(Number(req.params.cid), user.id);
    return { linked: !!url, shared_uids: shared.map((s) => s.source_uid) };
  }));
  r.put('/:cid/ics', h((req) => {
    const user = requireUser(req);
    const url = str(req.body.url, 2000).trim();
    db.prepare('UPDATE users SET ics_url = ? WHERE id = ?').run(url || null, user.id);
    return { linked: !!url };
  }));
  r.post('/:cid/ics/preview', h(async (req) => {
    const user = requireUser(req);
    requireMember(db, user, req.params.cid);
    const url = db.prepare('SELECT ics_url FROM users WHERE id = ?').get(user.id).ics_url;
    if (!url) throw new HttpError(400, 'Link a calendar first');
    const from = req.body.from ? new Date(req.body.from) : new Date();
    const to = req.body.to ? new Date(req.body.to) : new Date(Date.now() + 864e5 * 60);
    return fetchIcs(url, from, to);
  }));
  r.post('/:cid/ics/share', h((req) => {
    const user = requireUser(req);
    const list = Array.isArray(req.body.events) ? req.body.events.slice(0, 500) : [];
    const existing = new Set(db.prepare('SELECT source_uid FROM events WHERE campaign_id = ? AND user_id = ? AND source_uid IS NOT NULL')
      .all(Number(req.params.cid), user.id).map((e) => e.source_uid));
    let added = 0;
    tx(db, () => {
      for (const e of list) {
        if (e.uid && existing.has(e.uid)) continue;
        createEvent(db, user, req.params.cid, { ...e, source_uid: e.uid, kind: e.redacted ? 'busy' : 'event' });
        added++;
      }
    });
    return { added };
  }));
  r.post('/:cid/ics/resync', h((req) => resyncIcs(db, requireUser(req), req.params.cid)));
}

// ============================== QUESTS ==============================
export const QUEST_STATUSES = ['available', 'active', 'completed', 'failed'];

export function listQuests(db, user, campaignId, status) {
  requireMember(db, user, campaignId);
  const rows = db.prepare('SELECT * FROM quests WHERE campaign_id = ? ORDER BY updated_at DESC').all(Number(campaignId));
  return status ? rows.filter((q) => q.status === status) : rows;
}

function questFields(b, prev = {}) {
  const m = { ...prev, ...b };
  return {
    title: str(m.title, 200).trim() || 'Untitled quest',
    description: str(m.description), giver: str(m.giver, 200), reward: str(m.reward, 500), notes: str(m.notes),
    status: QUEST_STATUSES.includes(m.status) ? m.status : 'active',
  };
}

export function createQuest(db, user, campaignId, b) {
  requireMember(db, user, campaignId);
  const f = questFields(b);
  const id = db.prepare('INSERT INTO quests(campaign_id, title, description, giver, reward, notes, status, created_by) VALUES(?,?,?,?,?,?,?,?)')
    .run(Number(campaignId), f.title, f.description, f.giver, f.reward, f.notes, f.status, user.id).lastInsertRowid;
  return { id: Number(id) };
}

export function updateQuest(db, user, id, b) {
  const q = db.prepare('SELECT * FROM quests WHERE id = ?').get(Number(id));
  if (!q) throw new HttpError(404, 'Quest not found');
  requireMember(db, user, q.campaign_id);
  const f = questFields(b, q);
  db.prepare("UPDATE quests SET title=?, description=?, giver=?, reward=?, notes=?, status=?, updated_at=datetime('now') WHERE id=?")
    .run(f.title, f.description, f.giver, f.reward, f.notes, f.status, q.id);
  return { ok: true };
}

export function deleteQuest(db, user, id) {
  requireMember(db, user, owned(db, 'quests', id));
  db.prepare('DELETE FROM quests WHERE id = ?').run(Number(id));
  return { ok: true };
}

function questRoutes(r, db) {
  r.get('/:cid/quests', h((req) => listQuests(db, requireUser(req), req.params.cid, req.query.status)));
  r.post('/:cid/quests', h((req) => createQuest(db, requireUser(req), req.params.cid, req.body)));
  r.patch('/:cid/quests/:id', h((req) => updateQuest(db, requireUser(req), req.params.id, req.body)));
  r.delete('/:cid/quests/:id', h((req) => deleteQuest(db, requireUser(req), req.params.id)));
}

// ============================== TREASURY ==============================
const log = (db, cid, uid, msg) => db.prepare('INSERT INTO treasury_log(campaign_id, user_id, message) VALUES(?,?,?)').run(cid, uid, msg);
const fmt = (n) => (Math.round(n * 100) / 100).toString();

export function getTreasury(db, user, campaignId) {
  requireMember(db, user, campaignId);
  const cid = Number(campaignId);
  const currencies = db.prepare('SELECT * FROM currencies WHERE campaign_id = ? ORDER BY sort, id').all(cid);
  return {
    currencies,
    total_gp: currencies.reduce((s, c) => s + (c.gp_value != null ? c.gp_value * c.amount : 0), 0),
    items: db.prepare('SELECT * FROM items WHERE campaign_id = ? ORDER BY name').all(cid).map(itemRow),
    log: db.prepare(
      `SELECT l.id, l.message, l.at, u.display_name AS author FROM treasury_log l LEFT JOIN users u ON u.id = l.user_id
       WHERE l.campaign_id = ? ORDER BY l.id DESC LIMIT 200`
    ).all(cid),
  };
}

function findCurrency(db, campaignId, ref) {
  const cid = Number(campaignId);
  const c = typeof ref === 'number' || /^\d+$/.test(String(ref))
    ? db.prepare('SELECT * FROM currencies WHERE id = ? AND campaign_id = ?').get(Number(ref), cid)
    : db.prepare('SELECT * FROM currencies WHERE campaign_id = ? AND (lower(abbr) = lower(?) OR lower(name) = lower(?))').get(cid, String(ref), String(ref));
  if (!c) throw new HttpError(404, `Unknown currency "${ref}"`);
  return c;
}

export function adjustCurrency(db, user, campaignId, ref, delta, note = '') {
  requireMember(db, user, campaignId);
  const c = findCurrency(db, campaignId, ref);
  const d = num(delta);
  if (!d) throw new HttpError(400, 'Amount must be a non-zero number');
  tx(db, () => {
    db.prepare('UPDATE currencies SET amount = amount + ? WHERE id = ?').run(d, c.id);
    log(db, c.campaign_id, user.id, `${d > 0 ? '+' : ''}${fmt(d)} ${c.abbr || c.name} (now ${fmt(c.amount + d)})${note ? ` — ${str(note, 300)}` : ''}`);
  });
  return { currency: c.name, amount: c.amount + d };
}

export function upsertCurrency(db, user, campaignId, b, id) {
  requireMember(db, user, campaignId);
  const cid = Number(campaignId);
  const f = { name: str(b.name, 80).trim(), abbr: str(b.abbr, 12).trim(), notes: str(b.notes), gp_value: b.gp_value === '' || b.gp_value == null ? null : num(b.gp_value, null) };
  if (id) {
    const c = findCurrency(db, cid, Number(id));
    db.prepare('UPDATE currencies SET name=?, abbr=?, notes=?, gp_value=? WHERE id=?').run(f.name || c.name, f.abbr, f.notes, f.gp_value, c.id);
    return { id: c.id };
  }
  if (!f.name) throw new HttpError(400, 'Currency name required');
  const newId = db.prepare('INSERT INTO currencies(campaign_id, name, abbr, notes, gp_value, amount) VALUES(?,?,?,?,?,?)')
    .run(cid, f.name, f.abbr, f.notes, f.gp_value, num(b.amount)).lastInsertRowid;
  log(db, cid, user.id, `New currency: ${f.name}`);
  return { id: Number(newId) };
}

export function deleteCurrency(db, user, campaignId, id) {
  requireMember(db, user, campaignId);
  const c = findCurrency(db, campaignId, Number(id));
  db.prepare('DELETE FROM currencies WHERE id = ?').run(c.id);
  log(db, c.campaign_id, user.id, `Removed currency ${c.name} (had ${fmt(c.amount)})`);
  return { ok: true };
}

/** Treasury row → API shape: `item` holds the shared item-model fields (see shared/items.js). */
const itemRow = ({ data, ...r }) => ({ ...r, item: JSON.parse(data || '{}') });

function itemFields(b, prev = {}) {
  const m = { ...prev, ...b };
  // Item-model fields arrive either as `item: {…}` or top-level (MCP); a body without them keeps the old ones.
  const model = b.item || Object.keys(cleanItemFields(b)).length ? cleanItemFields(b.item || b) : JSON.parse(prev.data || '{}');
  return { name: str(m.name, 200).trim() || 'Unnamed item', quantity: num(m.quantity, 1), holder: str(m.holder, 120), value: str(m.value, 120), stats: str(m.stats), notes: str(m.notes), data: JSON.stringify(model) };
}

export function addItem(db, user, campaignId, b) {
  requireMember(db, user, campaignId);
  const f = itemFields(b);
  const id = db.prepare('INSERT INTO items(campaign_id, name, quantity, holder, value, stats, notes, data) VALUES(?,?,?,?,?,?,?,?)')
    .run(Number(campaignId), f.name, f.quantity, f.holder, f.value, f.stats, f.notes, f.data).lastInsertRowid;
  log(db, Number(campaignId), user.id, `Added ${fmt(f.quantity)}× ${f.name}${f.holder ? ` (held by ${f.holder})` : ''}`);
  return { id: Number(id) };
}

export function updateItem(db, user, id, b) {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(id));
  if (!it) throw new HttpError(404, 'Item not found');
  requireMember(db, user, it.campaign_id);
  const f = itemFields(b, it);
  db.prepare("UPDATE items SET name=?, quantity=?, holder=?, value=?, stats=?, notes=?, data=?, updated_at=datetime('now') WHERE id=?")
    .run(f.name, f.quantity, f.holder, f.value, f.stats, f.notes, f.data, it.id);
  const changes = [];
  if (f.quantity !== it.quantity) changes.push(`qty ${fmt(it.quantity)} → ${fmt(f.quantity)}`);
  if (f.holder !== it.holder) changes.push(`holder → ${f.holder || 'party'}`);
  if (changes.length) log(db, it.campaign_id, user.id, `${f.name}: ${changes.join(', ')}`);
  return { ok: true };
}

export function removeItem(db, user, id) {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(id));
  if (!it) throw new HttpError(404, 'Item not found');
  requireMember(db, user, it.campaign_id);
  db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
  log(db, it.campaign_id, user.id, `Removed ${fmt(it.quantity)}× ${it.name}`);
  return { ok: true };
}

function treasuryRoutes(r, db) {
  r.get('/:cid/treasury', h((req) => getTreasury(db, requireUser(req), req.params.cid)));
  r.post('/:cid/currencies', h((req) => upsertCurrency(db, requireUser(req), req.params.cid, req.body)));
  r.patch('/:cid/currencies/:id', h((req) => upsertCurrency(db, requireUser(req), req.params.cid, req.body, req.params.id)));
  r.delete('/:cid/currencies/:id', h((req) => deleteCurrency(db, requireUser(req), req.params.cid, req.params.id)));
  r.post('/:cid/currencies/:id/adjust', h((req) => adjustCurrency(db, requireUser(req), req.params.cid, Number(req.params.id), req.body.delta, req.body.note)));
  r.post('/:cid/items', h((req) => addItem(db, requireUser(req), req.params.cid, req.body)));
  r.patch('/:cid/items/:id', h((req) => updateItem(db, requireUser(req), req.params.id, req.body)));
  r.delete('/:cid/items/:id', h((req) => removeItem(db, requireUser(req), req.params.id)));
}

// ============================== SESSION LOGS ==============================
export function listSessions(db, user, campaignId) {
  requireMember(db, user, campaignId);
  return db.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM log_entries e WHERE e.session_id = s.id) AS entries
     FROM game_sessions s WHERE s.campaign_id = ? ORDER BY s.number DESC`
  ).all(Number(campaignId));
}

export function createSession(db, user, campaignId, b = {}) {
  requireMember(db, user, campaignId);
  const cid = Number(campaignId);
  const n = (db.prepare('SELECT MAX(number) n FROM game_sessions WHERE campaign_id = ?').get(cid).n || 0) + 1;
  const id = db.prepare('INSERT INTO game_sessions(campaign_id, number, title, date, summary) VALUES(?,?,?,?,?)')
    .run(cid, num(b.number, n) || n, str(b.title, 200), str(b.date, 30) || new Date().toISOString().slice(0, 10), str(b.summary)).lastInsertRowid;
  return { id: Number(id), number: n };
}

function sessionRow(db, user, id) {
  const s = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(Number(id));
  if (!s) throw new HttpError(404, 'Session not found');
  requireMember(db, user, s.campaign_id);
  return s;
}

export function getSessionLog(db, user, id, afterId = 0) {
  const s = sessionRow(db, user, id);
  s.entries = db.prepare(
    `SELECT e.id, e.text, e.at, e.user_id, u.display_name AS author, u.color FROM log_entries e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.session_id = ? AND e.id > ? ORDER BY e.id`
  ).all(s.id, Number(afterId) || 0);
  // every picture of the session (small: no image data), so [imgN] references always resolve
  s.images = db.prepare('SELECT id, entry_id, n FROM log_images WHERE session_id = ? ORDER BY n').all(s.id);
  for (const e of s.entries) e.images = s.images.filter((i) => i.entry_id === e.id);
  return s;
}

const MAX_IMAGE = 8 * 1024 * 1024;
/** "data:image/jpeg;base64,..." (or { mime, data: Buffer }) → { mime, data } */
export function decodeImage(img) {
  if (img?.data instanceof Uint8Array) return { mime: img.mime, data: Buffer.from(img.data) };
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(String(img || ''));
  if (!m) throw new HttpError(400, 'Images must be JPEG, PNG, WebP or GIF');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_IMAGE) throw new HttpError(413, 'Image too large (max 8 MB)');
  return { mime: m[1], data };
}

/** Add pictures to a session as one log entry (text is an optional caption). Returns { id, images: [{ id, n }] }. */
export function addLogImages(db, user, sessionId, text, images) {
  const s = sessionRow(db, user, sessionId);
  const decoded = (images || []).slice(0, 10).map(decodeImage);
  if (!decoded.length) throw new HttpError(400, 'No image');
  return tx(db, () => {
    const entryId = Number(db.prepare('INSERT INTO log_entries(session_id, user_id, text) VALUES(?,?,?)').run(s.id, user.id, str(text).trim()).lastInsertRowid);
    let n = db.prepare('SELECT MAX(n) n FROM log_images WHERE session_id = ?').get(s.id).n || 0;
    const out = decoded.map((img) => {
      n += 1;
      const id = Number(db.prepare('INSERT INTO log_images(session_id, entry_id, n, user_id, mime, data) VALUES(?,?,?,?,?,?)').run(s.id, entryId, n, user.id, img.mime, img.data).lastInsertRowid);
      return { id, n };
    });
    return { id: entryId, images: out };
  });
}

export function getLogImage(db, user, id) {
  const img = db.prepare('SELECT i.mime, i.data, s.campaign_id FROM log_images i JOIN game_sessions s ON s.id = i.session_id WHERE i.id = ?').get(Number(id));
  if (!img) throw new HttpError(404, 'Image not found');
  requireMember(db, user, img.campaign_id);
  return img;
}

export function updateSession(db, user, id, b) {
  const s = sessionRow(db, user, id);
  const m = { ...s, ...b };
  db.prepare('UPDATE game_sessions SET number=?, title=?, date=?, summary=? WHERE id=?').run(num(m.number, s.number), str(m.title, 200), str(m.date, 30), str(m.summary), s.id);
  return { ok: true };
}

export function deleteSession(db, user, id) {
  sessionRow(db, user, id);
  db.prepare('DELETE FROM game_sessions WHERE id = ?').run(Number(id));
  return { ok: true };
}

export function addLogEntry(db, user, sessionId, text) {
  sessionRow(db, user, sessionId);
  const t = str(text).trim();
  if (!t) throw new HttpError(400, 'Entry is empty');
  const id = db.prepare('INSERT INTO log_entries(session_id, user_id, text) VALUES(?,?,?)').run(Number(sessionId), user.id, t).lastInsertRowid;
  return { id: Number(id) };
}

function entryRow(db, user, id) {
  const e = db.prepare('SELECT e.*, s.campaign_id FROM log_entries e JOIN game_sessions s ON s.id = e.session_id WHERE e.id = ?').get(Number(id));
  if (!e) throw new HttpError(404, 'Entry not found');
  requireMember(db, user, e.campaign_id);
  return e;
}

function logRoutes(r, db) {
  r.get('/:cid/sessions', h((req) => listSessions(db, requireUser(req), req.params.cid)));
  r.post('/:cid/sessions', h((req) => createSession(db, requireUser(req), req.params.cid, req.body)));
  r.get('/:cid/sessions/:id', h((req) => getSessionLog(db, requireUser(req), req.params.id, req.query.after)));
  r.patch('/:cid/sessions/:id', h((req) => updateSession(db, requireUser(req), req.params.id, req.body)));
  r.delete('/:cid/sessions/:id', h((req) => deleteSession(db, requireUser(req), req.params.id)));
  r.post('/:cid/sessions/:id/entries', h((req) => (req.body.images?.length
    ? addLogImages(db, requireUser(req), req.params.id, req.body.text, req.body.images)
    : addLogEntry(db, requireUser(req), req.params.id, req.body.text))));
  r.get('/:cid/log-images/:id', h((req, res) => {
    const img = getLogImage(db, requireUser(req), req.params.id);
    res.type(img.mime).set('Cache-Control', 'private, max-age=86400').send(Buffer.from(img.data));
  }));
  r.patch('/:cid/entries/:id', h((req) => {
    const e = entryRow(db, requireUser(req), req.params.id);
    const t = str(req.body.text).trim();
    if (!t && !db.prepare('SELECT 1 FROM log_images WHERE entry_id = ?').get(e.id)) throw new HttpError(400, 'Entry is empty');
    db.prepare('UPDATE log_entries SET text = ? WHERE id = ?').run(t, e.id);
    return { ok: true };
  }));
  r.delete('/:cid/entries/:id', h((req) => {
    const e = entryRow(db, requireUser(req), req.params.id);
    db.prepare('DELETE FROM log_entries WHERE id = ?').run(e.id);
    return { ok: true };
  }));
}

export function partyRouter(db) {
  const r = Router();
  calendarRoutes(r, db);
  questRoutes(r, db);
  treasuryRoutes(r, db);
  logRoutes(r, db);
  return r;
}
