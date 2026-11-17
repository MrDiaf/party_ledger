// Party maps: the DM uploads map images (world, region, dungeon…); players see the ones marked visible.
import { Router } from 'express';
import { HttpError, h, str, requireUser, requireMember, requireDm } from '../core.js';

const MAX_MAP = 20 * 1024 * 1024;

function decodeMap(img) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(String(img || ''));
  if (!m) throw new HttpError(400, 'Maps must be JPEG, PNG, WebP or GIF images');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_MAP) throw new HttpError(413, 'Map image too large (max 20 MB)');
  return { mime: m[1], data };
}

/** DM: every map. Players: only maps the DM made visible. */
export function listMaps(db, user, campaignId) {
  const role = requireMember(db, user, campaignId);
  return db.prepare(
    `SELECT id, title, notes, shared, sort, created_at, updated_at, length(data) AS bytes FROM party_maps
     WHERE campaign_id = ? ${role === 'dm' ? '' : 'AND shared = 1'} ORDER BY sort, id`
  ).all(Number(campaignId)).map((m) => ({ ...m, shared: !!m.shared }));
}

export function createMap(db, user, campaignId, b) {
  requireDm(db, user, campaignId);
  const img = decodeMap(b.image);
  const cid = Number(campaignId);
  const sort = (db.prepare('SELECT MAX(sort) s FROM party_maps WHERE campaign_id = ?').get(cid).s ?? 0) + 1;
  const id = db.prepare('INSERT INTO party_maps(campaign_id, title, notes, shared, sort, mime, data, author_id) VALUES(?,?,?,?,?,?,?,?)')
    .run(cid, str(b.title, 120).trim() || 'Map', str(b.notes, 5000), b.shared === false ? 0 : 1, sort, img.mime, img.data, user.id).lastInsertRowid;
  return { id: Number(id) };
}

function mapRow(db, campaignId, id) {
  const m = db.prepare('SELECT id, campaign_id, title, notes, shared, sort FROM party_maps WHERE id = ? AND campaign_id = ?').get(Number(id), Number(campaignId));
  if (!m) throw new HttpError(404, 'Map not found');
  return m;
}

export function updateMap(db, user, campaignId, id, b) {
  requireDm(db, user, campaignId);
  const m = mapRow(db, campaignId, id);
  const img = b.image ? decodeMap(b.image) : null;
  db.prepare(`UPDATE party_maps SET title=?, notes=?, shared=?, sort=?, updated_at=datetime('now')${img ? ', mime=?, data=?' : ''} WHERE id=?`)
    .run(b.title != null ? str(b.title, 120).trim() || m.title : m.title, b.notes != null ? str(b.notes, 5000) : m.notes,
      b.shared != null ? (b.shared ? 1 : 0) : m.shared, b.sort != null ? Number(b.sort) || 0 : m.sort, ...(img ? [img.mime, img.data] : []), m.id);
  return { ok: true };
}

export function deleteMap(db, user, campaignId, id) {
  requireDm(db, user, campaignId);
  db.prepare('DELETE FROM party_maps WHERE id = ? AND campaign_id = ?').run(Number(id), Number(campaignId));
  return { ok: true };
}

export function getMapImage(db, user, campaignId, id) {
  const role = requireMember(db, user, campaignId);
  const m = db.prepare('SELECT mime, data, shared FROM party_maps WHERE id = ? AND campaign_id = ?').get(Number(id), Number(campaignId));
  if (!m || (role !== 'dm' && !m.shared)) throw new HttpError(404, 'Map not found');
  return m;
}

export function mapsRouter(db) {
  const r = Router();
  r.get('/campaigns/:cid/maps', h((req) => listMaps(db, requireUser(req), req.params.cid)));
  r.post('/campaigns/:cid/maps', h((req) => createMap(db, requireUser(req), req.params.cid, req.body)));
  r.patch('/campaigns/:cid/maps/:id', h((req) => updateMap(db, requireUser(req), req.params.cid, req.params.id, req.body)));
  r.delete('/campaigns/:cid/maps/:id', h((req) => deleteMap(db, requireUser(req), req.params.cid, req.params.id)));
  r.get('/campaigns/:cid/maps/:id/image', h((req, res) => {
    const m = getMapImage(db, requireUser(req), req.params.cid, req.params.id);
    res.type(m.mime).set('Cache-Control', 'private, no-cache').send(Buffer.from(m.data));
  }));
  return r;
}
