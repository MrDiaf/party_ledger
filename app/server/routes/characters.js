// Characters with git-like history. Every change writes a row to character_versions; the
// characters row holds the current head. Reverting creates a new version, so nothing is ever lost.
import { Router } from 'express';
import { tx } from '../db.js';
import { HttpError, h, str, requireUser, membership } from '../core.js';
import { normalizeCharacter, applyAction, diffSummary } from '../../shared/rules.js';

export const VERSION_KINDS = ['create', 'import', 'autosave', 'manual', 'levelup', 'revert', 'resource', 'ai'];
const COALESCE_MS = 2 * 60 * 1000;
const MAX_JSON = 4 * 1024 * 1024;

function access(db, user, ch) {
  if (ch.user_id === user.id) return 'edit';
  if (ch.campaign_id) {
    const m = membership(db, user, ch.campaign_id);
    if (m?.role === 'dm') return 'edit';
    if (m) return 'view';
  }
  return null;
}

function load(db, user, id, need = 'view') {
  const ch = db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(id));
  if (!ch) throw new HttpError(404, 'Character not found');
  const a = access(db, user, ch);
  if (!a || (need === 'edit' && a !== 'edit')) throw new HttpError(403, need === 'edit' ? 'You cannot edit this character' : 'You cannot view this character');
  return { ...ch, data: normalizeCharacter(JSON.parse(ch.data)), can_edit: a === 'edit' };
}

function encode(data) {
  const json = JSON.stringify(normalizeCharacter(data));
  if (json.length > MAX_JSON) throw new HttpError(413, 'Character data too large (portrait image too big?)');
  return json;
}

/** Archived characters are left out unless `archived` is set; then only your own archived ones are added. */
export function listCharacters(db, user, campaignId, { archived = false } = {}) {
  const rows = db.prepare(
    `SELECT c.id, c.name, c.user_id, c.campaign_id, c.updated_at, c.archived_at, c.data, u.display_name AS owner
     FROM characters c JOIN users u ON u.id = c.user_id
     WHERE (c.user_id = ? OR c.campaign_id IN (SELECT campaign_id FROM campaign_members WHERE user_id = ?))
       AND (c.archived_at IS NULL OR (? AND c.user_id = ?))
     ORDER BY c.updated_at DESC`
  ).all(user.id, user.id, archived ? 1 : 0, user.id);
  return rows
    .filter((r) => !campaignId || r.campaign_id === Number(campaignId))
    .map(({ data, ...r }) => {
      const d = JSON.parse(data);
      return {
        ...r,
        summary: `${d.race?.name || ''} ${(d.classes || []).map((c) => `${c.name} ${c.level}`).join(' / ')}`.trim(),
        hp: d.hp, portrait: d.portrait ? `/api/characters/${r.id}/portrait` : '',
      };
    });
}

export function getCharacter(db, user, id) {
  const ch = load(db, user, id);
  return { id: ch.id, name: ch.name, user_id: ch.user_id, campaign_id: ch.campaign_id, data: ch.data, head_version: ch.head_version, can_edit: ch.can_edit, updated_at: ch.updated_at, archived_at: ch.archived_at };
}

export function createCharacter(db, user, data, { kind = 'create', campaignId = null, message } = {}) {
  const d = normalizeCharacter(data);
  if (!str(d.name).trim()) throw new HttpError(400, 'Give your character a name first');
  if (campaignId && !membership(db, user, campaignId)) throw new HttpError(403, 'Not a member of that party');
  const json = encode(d);
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO characters(user_id, campaign_id, name, data) VALUES(?,?,?,?)').run(user.id, campaignId ? Number(campaignId) : null, d.name.trim(), json).lastInsertRowid);
    const v = Number(db.prepare('INSERT INTO character_versions(character_id, parent_id, kind, message, data, author_id) VALUES(?,?,?,?,?,?)')
      .run(id, null, kind, message || (kind === 'import' ? 'Imported from sheet photo' : 'Character created'), json, user.id).lastInsertRowid);
    db.prepare('UPDATE characters SET head_version = ? WHERE id = ?').run(v, id);
    return { id, version: v };
  });
}

/**
 * Write a new head version. `autosave` versions from the same author within COALESCE_MS are
 * folded into the previous autosave so typing does not create hundreds of versions.
 */
export function commitCharacter(db, user, id, data, kind = 'autosave', message = '') {
  if (!VERSION_KINDS.includes(kind)) throw new HttpError(400, 'Bad version kind');
  const ch = load(db, user, id, 'edit');
  const next = normalizeCharacter(data);
  const json = encode(next);
  if (json === JSON.stringify(ch.data) && kind !== 'manual') return { version: ch.head_version, unchanged: true };
  return tx(db, () => {
    const head = db.prepare('SELECT * FROM character_versions WHERE id = ?').get(ch.head_version);
    const now = Date.now();
    if (kind === 'autosave' && head?.kind === 'autosave' && head.author_id === user.id
      && now - new Date(head.updated_at).getTime() < COALESCE_MS && now - new Date(head.created_at).getTime() < 8 * COALESCE_MS) {
      const base = head.parent_id ? JSON.parse(db.prepare('SELECT data FROM character_versions WHERE id = ?').get(head.parent_id).data) : null;
      db.prepare("UPDATE character_versions SET data = ?, message = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .run(json, diffSummary(base, next), head.id);
      db.prepare("UPDATE characters SET data = ?, name = ?, updated_at = datetime('now') WHERE id = ?").run(json, next.name.trim() || ch.name, ch.id);
      return { version: head.id, coalesced: true };
    }
    const msg = str(message, 500) || diffSummary(ch.data, next);
    const v = Number(db.prepare('INSERT INTO character_versions(character_id, parent_id, kind, message, data, author_id) VALUES(?,?,?,?,?,?)')
      .run(ch.id, ch.head_version, kind, msg, json, user.id).lastInsertRowid);
    db.prepare("UPDATE characters SET data = ?, name = ?, head_version = ?, updated_at = datetime('now') WHERE id = ?").run(json, next.name.trim() || ch.name, v, ch.id);
    return { version: v };
  });
}

export function characterAction(db, user, id, action, kind = 'resource') {
  const ch = load(db, user, id, 'edit');
  let result;
  try { result = applyAction(ch.data, action || {}); } catch (e) { throw new HttpError(400, e.message); }
  const { version } = commitCharacter(db, user, id, result.data, kind, result.message);
  return { message: result.message, version, data: result.data };
}

export function history(db, user, id) {
  load(db, user, id);
  return db.prepare(
    `SELECT v.id, v.parent_id, v.kind, v.message, v.created_at, v.updated_at, u.display_name AS author
     FROM character_versions v LEFT JOIN users u ON u.id = v.author_id WHERE v.character_id = ? ORDER BY v.id DESC LIMIT 1000`
  ).all(Number(id));
}

export function getVersion(db, user, id, versionId) {
  load(db, user, id);
  const v = db.prepare('SELECT * FROM character_versions WHERE id = ? AND character_id = ?').get(Number(versionId), Number(id));
  if (!v) throw new HttpError(404, 'Version not found');
  return { ...v, data: normalizeCharacter(JSON.parse(v.data)) };
}

export function revert(db, user, id, versionId) {
  const v = getVersion(db, user, id, versionId);
  return commitCharacter(db, user, id, v.data, 'revert', `Reverted to version #${v.id} (${v.message})`);
}

export function charactersRouter(db) {
  const r = Router();
  r.get('/', h((req) => listCharacters(db, requireUser(req), req.query.campaign, { archived: req.query.archived === '1' })));
  r.post('/', h((req) => createCharacter(db, requireUser(req), req.body.data, {
    kind: req.body.kind === 'import' ? 'import' : 'create', campaignId: req.body.campaign_id || null,
  })));
  r.get('/:id', h((req) => getCharacter(db, requireUser(req), req.params.id)));
  r.get('/:id/portrait', h((req, res) => {
    const { data } = load(db, requireUser(req), req.params.id);
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(data.portrait || '');
    if (!m) throw new HttpError(404, 'No portrait');
    res.type(m[1]).set('Cache-Control', 'private, max-age=60').send(Buffer.from(m[2], 'base64'));
  }));
  r.put('/:id', h((req) => commitCharacter(db, requireUser(req), req.params.id, req.body.data,
    ['autosave', 'manual', 'levelup'].includes(req.body.kind) ? req.body.kind : 'autosave', req.body.message)));
  r.patch('/:id/meta', h((req) => {
    const user = requireUser(req);
    const ch = load(db, user, req.params.id, 'edit');
    const cid = req.body.campaign_id ? Number(req.body.campaign_id) : null;
    if (cid && !membership(db, user, cid)) throw new HttpError(403, 'Not a member of that party');
    db.prepare('UPDATE characters SET campaign_id = ? WHERE id = ?').run(cid, ch.id);
    return { ok: true };
  }));
  r.post('/:id/action', h((req) => characterAction(db, requireUser(req), req.params.id, req.body)));
  r.get('/:id/history', h((req) => history(db, requireUser(req), req.params.id)));
  r.get('/:id/versions/:vid', h((req) => getVersion(db, requireUser(req), req.params.id, req.params.vid)));
  r.post('/:id/revert/:vid', h((req) => revert(db, requireUser(req), req.params.id, req.params.vid)));
  r.post('/:id/archive', h((req) => {
    const ch = load(db, requireUser(req), req.params.id);
    if (ch.user_id !== req.user.id) throw new HttpError(403, 'Only the owner can archive a character');
    db.prepare("UPDATE characters SET archived_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?").run(req.body.archived === false ? 0 : 1, ch.id);
    return { ok: true };
  }));
  r.delete('/:id', h((req) => {
    const ch = load(db, requireUser(req), req.params.id, 'edit');
    if (ch.user_id !== req.user.id) throw new HttpError(403, 'Only the owner can delete a character');
    db.prepare('DELETE FROM characters WHERE id = ?').run(ch.id);
    return { ok: true };
  }));
  return r;
}
