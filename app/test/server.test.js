import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-test-'));
process.env.MM_PDF = '/nonexistent/monster-manual.pdf'; // tests never depend on the owner's book
process.env.MM_OCR_JSON = '/nonexistent/monster-manual-ocr.json';
process.env.MM_FIXES_JSON = '/nonexistent/monster-manual-fixes.json';
const { openDb } = await import('../server/db.js');
const { createApp, createAdminApp } = await import('../server/index.js');
const { isTrustedAdminRequest } = await import('../server/routes/admin.js');

let server, base, db, adminServer, adminBase;
before(async () => {
  db = openDb(':memory:');
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  adminServer = createAdminApp(db).listen(0, '127.0.0.1');
  await new Promise((r) => adminServer.once('listening', r));
  adminBase = `http://127.0.0.1:${adminServer.address().port}`;
});
after(() => { server.close(); adminServer.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

/** Tiny cookie-keeping client. */
function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  };
  return { raw: (u) => fetch(base + u, { headers: { cookie } }), get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u) };
}

const alice = client(), bob = client(), eve = client();
let partyId, charId;

test('register accepts a one-character password; no account (not even the first) is admin', async () => {
  assert.equal((await alice.post('/api/auth/register', { username: 'alice', password: 'x' })).status, 200);
  const me = await alice.get('/api/auth/me');
  assert.equal(me.body.user.is_admin, undefined);
  assert.equal(db.prepare('SELECT is_admin FROM users WHERE username = ?').get('alice').is_admin, 0);
  assert.equal((await bob.post('/api/auth/register', { username: 'bob', password: '1' })).status, 200);
  assert.equal((await eve.post('/api/auth/register', { username: 'eve', password: 'e' })).status, 200);
  assert.equal((await client().post('/api/auth/register', { username: 'BOB', password: 'z' })).status, 409);
  assert.equal((await client().post('/api/auth/login', { username: 'bob', password: 'wrong' })).status, 401);
});

test('admin network gate allows LAN, rejects Tailscale', () => {
  assert.equal(isTrustedAdminRequest('192.168.0.20'), true);
  assert.equal(isTrustedAdminRequest('::ffff:10.1.2.3'), true);
  assert.equal(isTrustedAdminRequest('127.0.0.1'), true);
  assert.equal(isTrustedAdminRequest('::1'), true);
  assert.equal(isTrustedAdminRequest('100.100.172.17'), false);
  assert.equal(isTrustedAdminRequest('100.64.0.1', {}, '0.0.0.0/0'), false, 'Tailscale CGNAT is always denied');
  assert.equal(isTrustedAdminRequest('fd7a:115c:a1e0::1'), false);
  assert.equal(isTrustedAdminRequest('8.8.8.8'), false);
  assert.equal(isTrustedAdminRequest('192.168.0.20', { 'Tailscale-Funnel-Request': '?1' }), false);
});

test('main port has no admin API, even for the first account / a legacy is_admin flag', async () => {
  db.prepare("UPDATE users SET is_admin = 1 WHERE username = 'alice'").run();
  for (const c of [alice, bob]) {
    assert.equal((await c.get('/api/admin/users')).status, 404);
    assert.equal((await c.patch('/api/admin/settings', { registration_open: false })).status, 404);
  }
  db.prepare("UPDATE users SET is_admin = 0 WHERE username = 'alice'").run();
});

test('admin port: password reset kills sessions; registration toggle', async () => {
  const admin = async (method, url, body) => {
    const res = await fetch(adminBase + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const users = (await admin('GET', '/api/admin/users')).body;
  const bobId = users.find((u) => u.username === 'bob').id;
  assert.equal((await admin('POST', `/api/admin/users/${bobId}/password`, { password: 'new' })).status, 200);
  assert.equal((await bob.get('/api/auth/me')).body.user, null);
  assert.equal((await bob.post('/api/auth/login', { username: 'bob', password: 'new' })).status, 200);
  await admin('PATCH', '/api/admin/settings', { registration_open: false });
  assert.equal((await client().post('/api/auth/register', { username: 'zed', password: 'z' })).status, 403);
  await admin('PATCH', '/api/admin/settings', { registration_open: true });
});

test('parties: create, join by code, membership enforced', async () => {
  partyId = (await alice.post('/api/campaigns', { name: 'Curse of Testing' })).body.id;
  const party = (await alice.get(`/api/campaigns/${partyId}`)).body;
  assert.equal(party.my_role, 'dm');
  assert.equal((await bob.post('/api/campaigns/join', { code: party.invite_code.toLowerCase() })).body.id, partyId);
  assert.equal((await eve.get(`/api/campaigns/${partyId}/quests`)).status, 403);
});

test('calendar: redacted events store only the time slot', async () => {
  const r = await bob.post(`/api/campaigns/${partyId}/events`, { title: 'Doctor appointment', description: 'private', location: 'Clinic', start: '2026-12-01T10:00:00Z', end: '2026-12-01T11:00:00Z', redacted: true });
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(r.body.id);
  assert.equal(row.title, 'Busy');
  assert.equal(row.description, '');
  assert.equal(row.location, '');
  // Even an edit cannot sneak details into a redacted event.
  await bob.patch(`/api/campaigns/${partyId}/events/${r.body.id}`, { title: 'Secret' });
  assert.equal(db.prepare('SELECT title FROM events WHERE id = ?').get(r.body.id).title, 'Busy');
  assert.equal((await alice.get(`/api/campaigns/${partyId}/events`)).body.length, 1);
  // Players cannot edit each other's events; the DM can.
  const a = await alice.post(`/api/campaigns/${partyId}/events`, { title: 'Session 1', kind: 'session', start: '2026-12-02T18:00:00Z' });
  assert.equal((await bob.del(`/api/campaigns/${partyId}/events/${a.body.id}`)).status, 403);
});

test('quests, treasury and session logs', async () => {
  const q = await bob.post(`/api/campaigns/${partyId}/quests`, { title: 'Find the cat', status: 'active' });
  await bob.patch(`/api/campaigns/${partyId}/quests/${q.body.id}`, { status: 'completed' });
  assert.equal((await alice.get(`/api/campaigns/${partyId}/quests?status=completed`)).body[0].title, 'Find the cat');

  const t0 = (await alice.get(`/api/campaigns/${partyId}/treasury`)).body;
  assert.deepEqual(t0.currencies.map((c) => c.abbr), ['pp', 'gp', 'ep', 'sp', 'cp']);
  const gp = t0.currencies.find((c) => c.abbr === 'gp');
  await alice.post(`/api/campaigns/${partyId}/currencies/${gp.id}/adjust`, { delta: 25, note: 'loot' });
  const custom = await alice.post(`/api/campaigns/${partyId}/currencies`, { name: 'Dragon scales', abbr: 'ds', notes: 'Accepted in Thay' });
  await alice.post(`/api/campaigns/${partyId}/currencies/${custom.body.id}/adjust`, { delta: 3 });
  await alice.post(`/api/campaigns/${partyId}/items`, { name: '+1 Longsword', stats: '1d8+1 slashing', holder: 'Bob' });
  const t1 = (await alice.get(`/api/campaigns/${partyId}/treasury`)).body;
  assert.equal(t1.currencies.find((c) => c.abbr === 'gp').amount, 25);
  assert.equal(t1.total_gp, 25);
  assert.ok(t1.log.some((l) => l.message.includes('+25 gp') && l.message.includes('loot')));
  assert.equal(t1.items[0].stats, '1d8+1 slashing');

  // Treasury items use the same item model as inventories: catalog link or custom category + stats.
  const sword = await bob.post(`/api/campaigns/${partyId}/items`, { name: 'Longsword', quantity: 1, value: '15 gp', item: { index: 'longsword', bogus: 'x' } });
  const axe = await bob.post(`/api/campaigns/${partyId}/items`, { name: 'Frost axe', item: { category: 'Weapon', weapon_type: 'Martial Melee', damage: '1d12', damage_type: 'cold', properties: ['Heavy'] } });
  const byId = async (id) => (await alice.get(`/api/campaigns/${partyId}/treasury`)).body.items.find((i) => i.id === id);
  assert.deepEqual((await byId(sword.body.id)).item, { index: 'longsword' }, 'unknown fields are dropped');
  assert.equal((await byId(axe.body.id)).item.damage_type, 'cold');
  await bob.patch(`/api/campaigns/${partyId}/items/${axe.body.id}`, { quantity: 2 });
  const axe2 = await byId(axe.body.id);
  assert.equal(axe2.quantity, 2);
  assert.equal(axe2.item.damage, '1d12', 'a quantity-only update keeps the item stats');
  await bob.patch(`/api/campaigns/${partyId}/items/${axe.body.id}`, { item: { category: 'Consumable' } });
  assert.deepEqual((await byId(axe.body.id)).item, { category: 'Consumable' });

  const s = await alice.post(`/api/campaigns/${partyId}/sessions`, { title: 'The beginning' });
  await bob.post(`/api/campaigns/${partyId}/sessions/${s.body.id}/entries`, { text: 'We met in a tavern' });
  const log = (await alice.get(`/api/campaigns/${partyId}/sessions/${s.body.id}`)).body;
  assert.equal(log.number, 1);
  assert.equal(log.entries[0].text, 'We met in a tavern');
  assert.equal((await alice.get(`/api/campaigns/${partyId}/sessions/${s.body.id}?after=${log.entries[0].id}`)).body.entries.length, 0);
});

test('characters: create, autosave coalesces, level-up version, revert', async () => {
  const data = { name: 'Tordek', classes: [{ index: 'fighter', name: 'Fighter', level: 1, hit_die: 10 }], hp: { max: 12, current: 12, temp: 0 }, hit_dice: { d10: { total: 1, used: 0 } } };
  assert.equal((await bob.post('/api/characters', { data: { ...data, name: '' } })).status, 400);
  charId = (await bob.post('/api/characters', { data, campaign_id: partyId })).body.id;
  await bob.put(`/api/characters/${charId}`, { data: { ...data, notes: 'a' } });
  await bob.put(`/api/characters/${charId}`, { data: { ...data, notes: 'ab' } });
  let h = (await bob.get(`/api/characters/${charId}/history`)).body;
  assert.deepEqual(h.map((v) => v.kind), ['autosave', 'create']);
  await bob.put(`/api/characters/${charId}`, { data: { ...data, notes: 'ab', classes: [{ ...data.classes[0], level: 2 }] }, kind: 'levelup', message: 'Level 2' });
  h = (await bob.get(`/api/characters/${charId}/history`)).body;
  assert.equal(h[0].kind, 'levelup');
  const created = h.find((v) => v.kind === 'create');
  await bob.post(`/api/characters/${charId}/revert/${created.id}`);
  const now = (await bob.get(`/api/characters/${charId}`)).body;
  assert.equal(now.data.classes[0].level, 1);
  assert.equal(now.data.notes, '');
  assert.equal((await bob.get(`/api/characters/${charId}/history`)).body.length, 4, 'revert adds a version, never deletes');
  // party DM may edit, outsider may not view
  assert.equal((await alice.put(`/api/characters/${charId}`, { data: { ...now.data, notes: 'dm note' } })).status, 200);
  assert.equal((await eve.get(`/api/characters/${charId}`)).status, 403);
});

test('characters: owner can archive, restore and delete; DM and others cannot', async () => {
  const id = (await bob.post('/api/characters', { data: { name: 'Retired Rogue' }, campaign_id: partyId })).body.id;
  const ids = async (c, q = '') => (await c.get(`/api/characters${q}`)).body.map((x) => x.id);
  // alice is the party DM: she can edit bob's character but not archive or delete it.
  assert.equal((await alice.post(`/api/characters/${id}/archive`, {})).status, 403);
  assert.equal((await alice.del(`/api/characters/${id}`)).status, 403);
  assert.equal((await eve.post(`/api/characters/${id}/archive`, {})).status, 403);

  assert.equal((await bob.post(`/api/characters/${id}/archive`, {})).status, 200);
  assert.ok(!(await ids(bob)).includes(id), 'archived characters are hidden by default');
  assert.ok(!(await ids(alice)).includes(id), 'and hidden from the party');
  assert.ok(!(await ids(alice, '?archived=1')).includes(id), 'others never see your archive');
  const mine = (await bob.get('/api/characters?archived=1')).body.find((x) => x.id === id);
  assert.ok(mine.archived_at);
  assert.ok((await bob.get(`/api/characters/${id}`)).body.archived_at);

  assert.equal((await bob.post(`/api/characters/${id}/archive`, { archived: false })).status, 200);
  assert.ok((await ids(alice)).includes(id), 'restored');

  assert.equal((await bob.del(`/api/characters/${id}`)).status, 200);
  assert.equal((await bob.get(`/api/characters/${id}`)).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM character_versions WHERE character_id = ?').get(id).n, 0);
});

test('DM tools: monsters on the field and notes/announcements are DM-only, shared notes reach players', async () => {
  // bob is a player, alice the DM of partyId.
  assert.equal((await bob.get('/api/monsters')).status, 403, 'players cannot open the catalog');
  assert.equal((await alice.get('/api/monsters')).status, 200);
  assert.equal((await bob.get(`/api/campaigns/${partyId}/field`)).status, 403);
  assert.equal((await bob.post(`/api/campaigns/${partyId}/field`, { monster: { name: 'Goblin', hp: 7, ac: 15 } })).status, 403);

  const add = await alice.post(`/api/campaigns/${partyId}/field`, { monster: { name: 'Goblin', hp: 7, ac: 15 }, count: 3 });
  assert.equal(add.body.ids.length, 3);
  let field = (await alice.get(`/api/campaigns/${partyId}/field`)).body;
  assert.deepEqual(field.map((f) => f.name), ['Goblin 1', 'Goblin 2', 'Goblin 3']);
  await alice.post(`/api/campaigns/${partyId}/field`, { monster: { name: 'Goblin', hp: 7 } });
  assert.equal((await alice.get(`/api/campaigns/${partyId}/field`)).body.at(-1).name, 'Goblin 4', 'numbering continues');

  const g = field[0].id;
  await alice.patch(`/api/campaigns/${partyId}/field/${g}`, { temp_hp: 3 });
  let r = await alice.patch(`/api/campaigns/${partyId}/field/${g}`, { damage: 5 });
  assert.deepEqual([r.body.hp, r.body.temp_hp], [5, 0], 'temp HP soaks damage first');
  r = await alice.patch(`/api/campaigns/${partyId}/field/${g}`, { damage: 50 });
  assert.equal(r.body.hp, 0, 'never below 0');
  r = await alice.patch(`/api/campaigns/${partyId}/field/${g}`, { heal: 50 });
  assert.equal(r.body.hp, 7, 'never above max');
  await alice.patch(`/api/campaigns/${partyId}/field/${g}`, { initiative: 17, conditions: 'Prone' });
  field = (await alice.get(`/api/campaigns/${partyId}/field`)).body;
  assert.equal(field[0].initiative, 17);
  assert.equal(field[0].monster.name, 'Goblin');
  assert.equal((await alice.del(`/api/campaigns/${partyId}/field/all`)).status, 200);
  assert.equal((await alice.get(`/api/campaigns/${partyId}/field`)).body.length, 0);

  // Notes: private until shared.
  assert.equal((await bob.post(`/api/campaigns/${partyId}/notes`, { title: 'hack' })).status, 403);
  const secret = (await alice.post(`/api/campaigns/${partyId}/notes`, { title: 'The butler did it', body: 'shh' })).body.id;
  const news = (await alice.post(`/api/campaigns/${partyId}/notes`, { title: 'Next session moved' })).body.id;
  assert.equal((await bob.get(`/api/campaigns/${partyId}/notes`)).body.length, 0);
  await alice.patch(`/api/campaigns/${partyId}/notes/${news}`, { shared: true, body: 'Friday instead' });
  const seen = (await bob.get(`/api/campaigns/${partyId}/notes`)).body;
  assert.deepEqual(seen.map((n) => n.title), ['Next session moved']);
  assert.ok(seen[0].published_at);
  assert.equal((await bob.patch(`/api/campaigns/${partyId}/notes/${news}`, { body: 'lol' })).status, 403);
  assert.equal((await eve.get(`/api/campaigns/${partyId}/notes`)).status, 403, 'non-members see nothing');
  assert.equal((await alice.get(`/api/campaigns/${partyId}/notes`)).body.length, 2);
  await alice.del(`/api/campaigns/${partyId}/notes/${secret}`);
  assert.equal((await alice.get(`/api/campaigns/${partyId}/notes`)).body.length, 1);
});

test('field monsters: raising max HP heals by the same amount, stat-block edits stay on the slot', async () => {
  const id = (await alice.post(`/api/campaigns/${partyId}/field`, { monster: { name: 'Ogre', hp: 59, ac: 11, speed: '40 ft.' } })).body.ids[0];
  const get = async () => (await alice.get(`/api/campaigns/${partyId}/field`)).body.find((f) => f.id === id);
  await alice.patch(`/api/campaigns/${partyId}/field/${id}`, { damage: 20 });
  await alice.patch(`/api/campaigns/${partyId}/field/${id}`, { hp_max: 69 });
  assert.deepEqual([(await get()).hp, (await get()).hp_max], [49, 69], '39 + 10');
  await alice.patch(`/api/campaigns/${partyId}/field/${id}`, { hp_max: 30 });
  assert.equal((await get()).hp, 30, 'lowering max caps current HP');
  await alice.patch(`/api/campaigns/${partyId}/field/${id}`, { monster: { speed: '50 ft.', abilities: { str: 21, dex: 'x' }, sections: [{ name: 'Actions', entries: [{ name: 'Club', text: '+7 to hit' }, { name: '', text: '' }] }], evil: 'nope' } });
  const m = (await get()).monster;
  assert.equal(m.speed, '50 ft.');
  assert.deepEqual(m.abilities, { str: 21 });
  assert.deepEqual(m.sections, [{ name: 'Actions', entries: [{ name: 'Club', text: '+7 to hit' }] }]);
  assert.equal(m.evil, undefined);
  assert.equal(m.name, 'Ogre');
  assert.ok(m.edited);
  // Duplicates keep the edits, max HP and AC, start at full HP, and number on from the original.
  await alice.patch(`/api/campaigns/${partyId}/field/${id}`, { ac: 14, damage: 5, conditions: 'Prone' });
  const dup = (await alice.post(`/api/campaigns/${partyId}/field/${id}/duplicate`, { count: 2 })).body.ids;
  const all = (await alice.get(`/api/campaigns/${partyId}/field`)).body;
  const copies = all.filter((f) => dup.includes(f.id));
  assert.deepEqual(copies.map((c) => c.name), ['Ogre 2', 'Ogre 3']);
  assert.deepEqual(copies.map((c) => [c.hp, c.hp_max, c.ac, c.conditions, c.monster.speed]), [[30, 30, 14, '', '50 ft.'], [30, 30, 14, '', '50 ft.']]);
  for (const c of copies) await alice.del(`/api/campaigns/${partyId}/field/${c.id}`);
  await alice.del(`/api/campaigns/${partyId}/field/${id}`);
});

test('DM note pictures: DM-only until the note is shared', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const note = (await alice.post(`/api/campaigns/${partyId}/notes`, { title: 'Map', body: 'The cave [img1]' })).body.id;
  assert.equal((await bob.post(`/api/campaigns/${partyId}/notes/${note}/images`, { images: [png] })).status, 403);
  const up = await alice.post(`/api/campaigns/${partyId}/notes/${note}/images`, { images: [png, png] });
  assert.deepEqual(up.body.images.map((i) => i.n), [1, 2]);
  const img = up.body.images[0].id;
  assert.equal((await alice.raw(`/api/campaigns/${partyId}/note-images/${img}`)).status, 200);
  assert.equal((await bob.raw(`/api/campaigns/${partyId}/note-images/${img}`)).status, 404, 'hidden while the note is private');
  await alice.patch(`/api/campaigns/${partyId}/notes/${note}`, { shared: true });
  const r = await bob.raw(`/api/campaigns/${partyId}/note-images/${img}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal((await eve.raw(`/api/campaigns/${partyId}/note-images/${img}`)).status, 403, 'non-members never');
  assert.deepEqual((await bob.get(`/api/campaigns/${partyId}/notes`)).body.find((x) => x.id === note).images.map((i) => i.n), [1, 2]);
  await alice.del(`/api/campaigns/${partyId}/notes/${note}/images/${img}`);
  assert.equal((await alice.raw(`/api/campaigns/${partyId}/note-images/${img}`)).status, 404);
  await alice.del(`/api/campaigns/${partyId}/notes/${note}`);
});

test('resource actions go through rules and land in history', async () => {
  let r = await bob.post(`/api/characters/${charId}/action`, { type: 'temp_hp', amount: 5 });
  r = await bob.post(`/api/characters/${charId}/action`, { type: 'damage', amount: 8 });
  assert.equal(r.body.data.hp.temp, 0);
  assert.equal(r.body.data.hp.current, 9);
  r = await bob.post(`/api/characters/${charId}/action`, { type: 'long_rest' });
  assert.equal(r.body.data.hp.current, 12);
  assert.equal((await bob.post(`/api/characters/${charId}/action`, { type: 'nope' })).status, 400);
  const h = (await bob.get(`/api/characters/${charId}/history`)).body;
  assert.equal(h[0].kind, 'resource');
  assert.match(h[0].message, /Long rest/);
});

test('MCP endpoint rejects requests without a valid token', async () => {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 401);
});

test('MCP: token-scoped tools, disabled tools hidden, permissions enforced', async () => {
  const { issueToken } = await import('../server/mcp.js');
  const { setSetting } = await import('../server/db.js');
  const bobId = db.prepare("SELECT id FROM users WHERE username = 'bob'").get().id;
  const eveId = db.prepare("SELECT id FROM users WHERE username = 'eve'").get().id;
  const rpc = async (token, method, params = {}) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return (await res.json()).result;
  };
  setSetting(db, 'ai_disabled_tools', ['remove_item']);
  const bob = issueToken(bobId, partyId);
  const tools = (await rpc(bob, 'tools/list')).tools.map((t) => t.name);
  assert.ok(tools.includes('character_action'));
  assert.ok(!tools.includes('remove_item'));
  const r = await rpc(bob, 'tools/call', { name: 'adjust_currency', arguments: { currency: 'gp', delta: -5, note: 'AI test' } });
  assert.match(r.content[0].text, /"amount": 20/);
  const hit = await rpc(bob, 'tools/call', { name: 'character_action', arguments: { character_id: charId, type: 'damage', amount: 3 } });
  assert.match(hit.content[0].text, /HP 12 → 9/);
  assert.equal((await bob_history()).kind, 'ai');
  const eve = issueToken(eveId, partyId);
  const denied = await rpc(eve, 'tools/call', { name: 'get_treasury', arguments: {} });
  assert.equal(denied.isError, true);
  setSetting(db, 'ai_disabled_tools', []);
  async function bob_history() { return db.prepare('SELECT kind FROM character_versions WHERE character_id = ? ORDER BY id DESC').get(charId); }
});

test('character sheet PDF download (official sheet + detail pages)', async () => {
  assert.equal((await fetch(`${base}/api/characters/${charId}/pdf`)).status, 401, 'needs a login');
  const res = await bob.raw(`/api/characters/${charId}/pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /attachment; filename=".*_sheet\.pdf"/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await eve.raw(`/api/characters/${charId}/pdf`)).status, 403, 'outsiders cannot download');
});

test('rules bundle has the item catalog and structured starting gear', async () => {
  const r = (await bob.get('/api/rules')).body;
  assert.ok(r.items.length > 200);
  assert.ok(r.classes.every((c) => Array.isArray(c.starting_choices)));
  assert.ok(r.skills.every((s) => s.desc));
});

test('session log pictures, [imgN] references and assistant proposals', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const s = (await bob.post(`/api/campaigns/${partyId}/sessions`, { title: 'Pics' })).body;
  const r = await bob.post(`/api/campaigns/${partyId}/sessions/${s.id}/entries`, { text: 'The map', images: [png, png] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.images.map((i) => i.n), [1, 2]);
  await bob.post(`/api/campaigns/${partyId}/sessions/${s.id}/entries`, { text: 'We follow the river on [img2]' });
  const log = (await alice.get(`/api/campaigns/${partyId}/sessions/${s.id}`)).body;
  assert.equal(log.images.length, 2);
  assert.equal(log.entries[0].images.length, 2);
  const img = await alice.raw(`/api/campaigns/${partyId}/log-images/${log.images[0].id}`);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await eve.raw(`/api/campaigns/${partyId}/log-images/${log.images[0].id}`)).status, 403);
  assert.equal((await bob.post(`/api/campaigns/${partyId}/sessions/${s.id}/entries`, { images: ['data:text/html;base64,AAAA'] })).status, 400);

  // assistant: an uploaded image becomes a proposal, and only lands in the log once the user accepts
  const me = (await bob.get('/api/auth/me')).body.user;
  const up = Number(db.prepare('INSERT INTO ai_uploads(user_id, mime, data) VALUES(?,?,?)').run(me.id, 'image/png', Buffer.from(png.split(',')[1], 'base64')).lastInsertRowid);
  const { TOOLS } = await import('../server/mcp.js');
  const tool = TOOLS.find((t) => t.name === 'propose_session_image');
  const res = tool.run({ db, user: me }, { session_id: s.id, upload_id: up, caption: 'Goblin cave' });
  assert.match(res.status, /not added yet/);
  assert.equal((await bob.get(`/api/campaigns/${partyId}/sessions/${s.id}`)).body.images.length, 2, 'nothing committed before confirmation');
  const props = (await bob.get('/api/ai/messages')).body.proposals;
  assert.equal(props.length, 1);
  assert.equal((await alice.post(`/api/ai/proposals/${props[0].id}/accept`)).status, 404, 'only the owner can confirm');
  const ok = await bob.post(`/api/ai/proposals/${props[0].id}/accept`, { caption: 'Goblin cave entrance' });
  assert.equal(ok.body.images[0].n, 3);
  const after = (await bob.get(`/api/campaigns/${partyId}/sessions/${s.id}`)).body;
  assert.equal(after.entries.at(-1).text, 'Goblin cave entrance');
  assert.equal((await bob.post(`/api/ai/proposals/${props[0].id}/accept`)).status, 404, 'cannot commit twice');
  assert.throws(() => tool.run({ db, user: { id: 99999 } }, { session_id: s.id, upload_id: up }), /No image/);
});

test('sheet import refuses uploads that are not photos or PDFs', async () => {
  const r = await bob.post('/api/characters/import-image', { files: ['data:text/html;base64,PGh0bWw+'] });
  assert.equal(r.status, 400);
  assert.equal((await bob.post('/api/characters/import-image', {})).status, 400);
});
