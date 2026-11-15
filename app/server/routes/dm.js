// DM tools: the Monster Manual catalog, the party's active monsters ("the field") and DM notes /
// announcements. Monsters and private notes are DM-only; notes the DM shares are readable by the party.
import { Router } from 'express';
import { tx, DATA_DIR } from '../db.js';
import { HttpError, h, str, requireUser, requireMember, requireDm } from '../core.js';
import { loadMonsters } from '../monsterManual.js';
import { decodeImage } from './party.js';

const int = (v, d = null) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Math.round(Number(v)));

/** Is the user the DM of at least one party? (The catalog is the DM's book, not the players'.) */
function requireAnyDm(db, user) {
  if (!db.prepare("SELECT 1 FROM campaign_members WHERE user_id = ? AND role = 'dm'").get(user.id)) throw new HttpError(403, 'Only DMs can open the monster catalog');
}

let monstersJson = null;
export function monstersCatalog() {
  return (monstersJson ||= JSON.stringify(loadMonsters(DATA_DIR)));
}

// ============================== THE FIELD (active monsters) ==============================
const fieldRow = ({ data, ...r }) => ({ ...r, monster: JSON.parse(data || '{}') });

export function listField(db, user, campaignId) {
  requireDm(db, user, campaignId);
  return db.prepare('SELECT * FROM field_monsters WHERE campaign_id = ? ORDER BY sort, id').all(Number(campaignId)).map(fieldRow);
}

/**
 * Put monsters on the field: a catalog monster by `index` (copied, so later edits and book re-parses
 * never change a running fight) or a custom one from `monster` ({ name, ac, hp, … }). `count` adds several,
 * numbered "Goblin Warrior 1", "Goblin Warrior 2"…
 */
export function addToField(db, user, campaignId, b) {
  requireDm(db, user, campaignId);
  const cid = Number(campaignId);
  let m;
  if (b.index) {
    m = loadMonsters(DATA_DIR).find((x) => x.index === b.index);
    if (!m) throw new HttpError(404, 'Monster not found in the catalog');
  } else {
    const c = b.monster || {};
    m = { name: str(c.name, 120).trim(), ac: int(c.ac), hp: int(c.hp), type: str(c.type, 200), cr: str(c.cr, 10), speed: str(c.speed, 200), notes: str(c.notes, 4000), custom: true };
    if (!m.name) throw new HttpError(400, 'Give the monster a name');
  }
  return { ids: insertMonsters(db, cid, m, str(b.name, 120).trim() || m.name, int(b.count, 1)) };
}

/**
 * Insert `count` copies of monster `m` named "<base>", or "<base> 2", "<base> 3"… continuing after the highest
 * number already on the field. `extra` sets per-slot values (max HP, AC, notes) for duplicates.
 */
function insertMonsters(db, cid, m, base, count, extra = {}) {
  count = Math.min(Math.max(count || 1, 1), 30);
  const names = db.prepare('SELECT name FROM field_monsters WHERE campaign_id = ? AND (name = ? OR name LIKE ?)').all(cid, base, `${base} %`).map((r) => r.name);
  const top = Math.max(0, ...names.map((n) => (n === base ? 1 : Number(n.slice(base.length + 1)) || 0)));
  const numbered = count > 1 || top > 0;
  const sort = (db.prepare('SELECT MAX(sort) s FROM field_monsters WHERE campaign_id = ?').get(cid).s ?? 0) + 1;
  const hp = extra.hp_max ?? m.hp ?? 0;
  const data = JSON.stringify(m);
  return tx(db, () => Array.from({ length: count }, (_, k) => Number(db.prepare(
    'INSERT INTO field_monsters(campaign_id, monster_index, name, hp, hp_max, ac, notes, sort, data) VALUES(?,?,?,?,?,?,?,?,?)',
  ).run(cid, m.index || null, numbered ? `${base} ${top + k + 1}` : base, hp, hp, extra.ac !== undefined ? extra.ac : m.ac ?? null, extra.notes ?? '', sort + k, data).lastInsertRowid)));
}

/** More of a monster already on the field, edits included: same stat block, max HP, AC and notes; fresh HP. */
export function duplicateFieldMonster(db, user, campaignId, id, b) {
  requireDm(db, user, campaignId);
  const row = db.prepare('SELECT * FROM field_monsters WHERE id = ? AND campaign_id = ?').get(Number(id), Number(campaignId));
  if (!row) throw new HttpError(404, 'Monster not on the field');
  const base = row.name.replace(/\s+\d+$/, '');
  return { ids: insertMonsters(db, row.campaign_id, JSON.parse(row.data || '{}'), base, int(b.count, 1), { hp_max: row.hp_max, ac: row.ac, notes: row.notes }) };
}

const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const TEXT_FIELDS = { name: 120, type: 200, speed: 200, cr: 10, hp_dice: 60, skills: 500, vulnerabilities: 500, resistances: 500, immunities: 500, gear: 500, senses: 500, languages: 500, notes: 4000 };
/** Edits to a field monster's own stat-block copy: known fields only, sane sizes. */
function cleanMonsterPatch(p) {
  const out = {};
  for (const [k, max] of Object.entries(TEXT_FIELDS)) if (p[k] != null) out[k] = str(p[k], max);
  for (const k of ['ac', 'initiative', 'hp', 'xp', 'pb']) if (p[k] !== undefined) out[k] = int(p[k]);
  for (const k of ['abilities', 'saves']) {
    if (p[k] && typeof p[k] === 'object') out[k] = Object.fromEntries(ABIL.filter((a) => int(p[k][a]) != null).map((a) => [a, int(p[k][a])]));
  }
  if (Array.isArray(p.sections)) {
    out.sections = p.sections.slice(0, 10).map((s) => ({
      name: str(s?.name, 60) || 'Traits',
      entries: (Array.isArray(s?.entries) ? s.entries : []).slice(0, 40).map((e) => ({ name: str(e?.name, 120), text: str(e?.text, 4000) })).filter((e) => e.name || e.text),
    })).filter((s) => s.entries.length);
  }
  return out;
}

export function updateFieldMonster(db, user, campaignId, id, b) {
  requireDm(db, user, campaignId);
  const row = db.prepare('SELECT * FROM field_monsters WHERE id = ? AND campaign_id = ?').get(Number(id), Number(campaignId));
  if (!row) throw new HttpError(404, 'Monster not on the field');
  const f = {
    name: b.name != null ? str(b.name, 120).trim() || row.name : row.name,
    hp_max: b.hp_max != null ? Math.max(0, int(b.hp_max, row.hp_max)) : row.hp_max,
    temp_hp: b.temp_hp != null ? Math.max(0, int(b.temp_hp, 0)) : row.temp_hp,
    ac: b.ac !== undefined ? int(b.ac) : row.ac,
    initiative: b.initiative !== undefined ? int(b.initiative) : row.initiative,
    conditions: b.conditions != null ? str(b.conditions, 500) : row.conditions,
    notes: b.notes != null ? str(b.notes, 4000) : row.notes,
  };
  // `damage` / `heal` are relative (temp HP absorbs damage first); `hp` sets it outright.
  let hp = b.hp != null ? int(b.hp, row.hp) : row.hp;
  // Raising max HP raises current HP by the same amount (a buffed monster is not left "wounded").
  if (b.hp == null && f.hp_max > row.hp_max) hp += f.hp_max - row.hp_max;
  if (b.damage != null) {
    let d = Math.max(0, int(b.damage, 0));
    const fromTemp = Math.min(f.temp_hp, d);
    f.temp_hp -= fromTemp; d -= fromTemp;
    hp -= d;
  }
  if (b.heal != null) hp += Math.max(0, int(b.heal, 0));
  f.hp = Math.min(Math.max(hp, 0), f.hp_max || hp);
  // `monster` edits this slot's own copy of the stat block (speed, scores, traits, actions…).
  const data = b.monster && typeof b.monster === 'object' ? JSON.stringify({ ...JSON.parse(row.data || '{}'), ...cleanMonsterPatch(b.monster), edited: true }) : row.data;
  db.prepare('UPDATE field_monsters SET name=?, hp=?, hp_max=?, temp_hp=?, ac=?, initiative=?, conditions=?, notes=?, data=? WHERE id=?')
    .run(f.name, f.hp, f.hp_max, f.temp_hp, f.ac, f.initiative, f.conditions, f.notes, data, row.id);
  return { ok: true, hp: f.hp, temp_hp: f.temp_hp };
}

export function removeFromField(db, user, campaignId, id) {
  requireDm(db, user, campaignId);
  if (id === 'all') db.prepare('DELETE FROM field_monsters WHERE campaign_id = ?').run(Number(campaignId));
  else db.prepare('DELETE FROM field_monsters WHERE id = ? AND campaign_id = ?').run(Number(id), Number(campaignId));
  return { ok: true };
}

// ============================== DM NOTES & ANNOUNCEMENTS ==============================
/** DM: every note. Players: only the notes the DM shared (announcements). */
export function listNotes(db, user, campaignId) {
  const role = requireMember(db, user, campaignId);
  const all = role === 'dm';
  return db.prepare(
    `SELECT n.*, u.display_name AS author FROM dm_notes n LEFT JOIN users u ON u.id = n.author_id
     WHERE n.campaign_id = ? ${all ? '' : 'AND n.shared = 1'} ORDER BY n.pinned DESC, n.sort, n.id`
  ).all(Number(campaignId)).map((n) => ({
    ...n, shared: !!n.shared, pinned: !!n.pinned,
    // pictures without their data (served by /note-images/:id), so [imgN] references resolve
    images: db.prepare('SELECT id, n FROM note_images WHERE note_id = ? ORDER BY n').all(n.id),
  }));
}

function dmNote(db, user, campaignId, id) {
  requireDm(db, user, campaignId);
  const n = db.prepare('SELECT * FROM dm_notes WHERE id = ? AND campaign_id = ?').get(Number(id), Number(campaignId));
  if (!n) throw new HttpError(404, 'Note not found');
  return n;
}

/** Add pictures to a note (DM). Numbered per note: refer to them in the text with [img1], [img2]… */
export function addNoteImages(db, user, campaignId, noteId, images) {
  const note = dmNote(db, user, campaignId, noteId);
  const decoded = (images || []).slice(0, 10).map(decodeImage);
  if (!decoded.length) throw new HttpError(400, 'No image');
  return tx(db, () => {
    let n = db.prepare('SELECT MAX(n) n FROM note_images WHERE note_id = ?').get(note.id).n || 0;
    const out = decoded.map((img) => ({ n: ++n, id: Number(db.prepare('INSERT INTO note_images(note_id, n, mime, data) VALUES(?,?,?,?)').run(note.id, n, img.mime, img.data).lastInsertRowid) }));
    db.prepare("UPDATE dm_notes SET updated_at = datetime('now') WHERE id = ?").run(note.id);
    return { images: out };
  });
}

export function deleteNoteImage(db, user, campaignId, noteId, imageId) {
  const note = dmNote(db, user, campaignId, noteId);
  db.prepare('DELETE FROM note_images WHERE id = ? AND note_id = ?').run(Number(imageId), note.id);
  return { ok: true };
}

/** A note's picture: the DM always, players only when the note is shared. */
export function getNoteImage(db, user, campaignId, imageId) {
  const img = db.prepare('SELECT i.mime, i.data, n.campaign_id, n.shared FROM note_images i JOIN dm_notes n ON n.id = i.note_id WHERE i.id = ?').get(Number(imageId));
  if (!img || img.campaign_id !== Number(campaignId)) throw new HttpError(404, 'Image not found');
  const role = requireMember(db, user, campaignId);
  if (role !== 'dm' && !img.shared) throw new HttpError(404, 'Image not found');
  return img;
}

export function createNote(db, user, campaignId, b) {
  requireDm(db, user, campaignId);
  const cid = Number(campaignId);
  const sort = (db.prepare('SELECT MAX(sort) s FROM dm_notes WHERE campaign_id = ?').get(cid).s ?? 0) + 1;
  const id = db.prepare('INSERT INTO dm_notes(campaign_id, title, body, shared, pinned, sort, author_id) VALUES(?,?,?,?,?,?,?)')
    .run(cid, str(b.title, 120).trim() || 'New note', str(b.body, 100000), b.shared ? 1 : 0, b.pinned ? 1 : 0, sort, user.id).lastInsertRowid;
  return { id: Number(id) };
}

export function updateNote(db, user, campaignId, id, b) {
  requireDm(db, user, campaignId);
  const n = db.prepare('SELECT * FROM dm_notes WHERE id = ? AND campaign_id = ?').get(Number(id), Number(campaignId));
  if (!n) throw new HttpError(404, 'Note not found');
  // Sharing for the first time counts as publishing: it is dated so players see it as new.
  const publish = b.shared && !n.shared;
  db.prepare(`UPDATE dm_notes SET title=?, body=?, shared=?, pinned=?, updated_at=datetime('now')${publish ? ", published_at=datetime('now')" : ''} WHERE id=?`)
    .run(b.title != null ? str(b.title, 120).trim() || n.title : n.title, b.body != null ? str(b.body, 100000) : n.body,
      b.shared != null ? (b.shared ? 1 : 0) : n.shared, b.pinned != null ? (b.pinned ? 1 : 0) : n.pinned, n.id);
  return { ok: true };
}

export function deleteNote(db, user, campaignId, id) {
  requireDm(db, user, campaignId);
  db.prepare('DELETE FROM dm_notes WHERE id = ? AND campaign_id = ?').run(Number(id), Number(campaignId));
  return { ok: true };
}

export function dmRouter(db) {
  const r = Router();
  r.get('/monsters', h((req, res) => {
    requireAnyDm(db, requireUser(req));
    res.type('json').set('Cache-Control', 'private, max-age=3600').send(monstersCatalog());
  }));
  r.get('/campaigns/:cid/field', h((req) => listField(db, requireUser(req), req.params.cid)));
  r.post('/campaigns/:cid/field', h((req) => addToField(db, requireUser(req), req.params.cid, req.body)));
  r.post('/campaigns/:cid/field/:id/duplicate', h((req) => duplicateFieldMonster(db, requireUser(req), req.params.cid, req.params.id, req.body)));
  r.patch('/campaigns/:cid/field/:id', h((req) => updateFieldMonster(db, requireUser(req), req.params.cid, req.params.id, req.body)));
  r.delete('/campaigns/:cid/field/:id', h((req) => removeFromField(db, requireUser(req), req.params.cid, req.params.id)));
  r.get('/campaigns/:cid/notes', h((req) => listNotes(db, requireUser(req), req.params.cid)));
  r.post('/campaigns/:cid/notes', h((req) => createNote(db, requireUser(req), req.params.cid, req.body)));
  r.patch('/campaigns/:cid/notes/:id', h((req) => updateNote(db, requireUser(req), req.params.cid, req.params.id, req.body)));
  r.post('/campaigns/:cid/notes/:id/images', h((req) => addNoteImages(db, requireUser(req), req.params.cid, req.params.id, req.body.images)));
  r.delete('/campaigns/:cid/notes/:id/images/:imageId', h((req) => deleteNoteImage(db, requireUser(req), req.params.cid, req.params.id, req.params.imageId)));
  r.get('/campaigns/:cid/note-images/:id', h((req, res) => {
    const img = getNoteImage(db, requireUser(req), req.params.cid, req.params.id);
    res.type(img.mime).set('Cache-Control', 'private, max-age=86400').send(Buffer.from(img.data));
  }));
  r.delete('/campaigns/:cid/notes/:id', h((req) => deleteNote(db, requireUser(req), req.params.cid, req.params.id)));
  return r;
}
