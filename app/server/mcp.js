// MCP server exposing the app to the AI assistant (Codex). Each assistant run gets a short-lived
// bearer token bound to the acting user, so every tool runs with exactly that user's permissions.
// The admin can switch individual tools off in Settings → AI (setting `ai_disabled_tools`).
import crypto from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getSetting } from './db.js';
import { HttpError, requireMember } from './core.js';
import * as party from './routes/party.js';
import * as chars from './routes/characters.js';
import { myCampaigns } from './routes/auth.js';
import { derived, normalizeCharacter } from '../shared/rules.js';
import { lookupRules } from './rulesSearch.js';

// ---- per-run tokens --------------------------------------------------------------------
const tokens = new Map(); // token -> { userId, campaignId, expires }
export function issueToken(userId, campaignId) {
  const token = crypto.randomBytes(24).toString('base64url');
  tokens.set(token, { userId, campaignId, expires: Date.now() + 15 * 60 * 1000 });
  return token;
}
export function revokeToken(token) { tokens.delete(token); }
function resolveToken(db, header) {
  const token = /^Bearer (.+)$/.exec(header || '')?.[1];
  const t = token && tokens.get(token);
  if (!t || t.expires < Date.now()) return null;
  const user = db.prepare('SELECT id, username, display_name, color FROM users WHERE id = ?').get(t.userId);
  return user ? { user, campaignId: t.campaignId } : null;
}

// ---- tool catalogue ----------------------------------------------------------------------
const cid = z.number().int().optional().describe('Party id; defaults to the party the user is currently viewing');
// Same item model as character inventories (shared/items.js).
const ITEM_INPUT = {
  index: z.string().optional(), category: z.string().optional(), weapon_type: z.string().optional(), damage: z.string().optional(), damage_type: z.string().optional(),
  range: z.string().optional(), versatile: z.string().optional(), properties: z.array(z.string()).optional(), armor_type: z.string().optional(), ac_base: z.number().optional(), weight: z.number().optional(),
};
const ACTION_TYPES = ['damage', 'heal', 'temp_hp', 'set_hp', 'death_save', 'use_slot', 'restore_slot', 'use_pact', 'restore_pact', 'use_resource', 'restore_resource', 'spend_hit_die', 'add_condition', 'remove_condition', 'set_exhaustion', 'add_effect', 'remove_effect', 'advance_time', 'short_rest', 'long_rest', 'set_inspiration', 'cast_spell'];

function sheetSummary(ch) {
  const d = normalizeCharacter(ch.data);
  const x = derived(d);
  return {
    id: ch.id, name: d.name, race: d.race?.name, subrace: d.subrace?.name, classes: d.classes.map((c) => `${c.name}${c.subclass_name ? ` (${c.subclass_name})` : ''} ${c.level}`),
    level: x.level, abilities: d.abilities, modifiers: x.mods, proficiency_bonus: x.pb, ac: d.ac, initiative: x.initiative, speed: d.speed,
    hp: d.hp, hit_dice: d.hit_dice, death_saves: d.death_saves, spell_slots: d.spellcasting.slots.map((s, i) => ({ level: i + 1, ...s })).filter((s) => s.max || s.used),
    pact_slots: d.spellcasting.pact, spell_dc: x.spell_dc, spell_attack: x.spell_attack, resources: d.resources, conditions: d.conditions,
    exhaustion: d.exhaustion, effects: d.effects, inspiration: d.inspiration, spells: d.spells.map((s) => `${s.name} (${s.level === 0 ? 'cantrip' : `L${s.level}`})`),
    attacks: d.attacks, equipment: d.equipment, coins: d.coins, features: d.features.map((f) => f.name), feats: d.feats.map((f) => f.name),
  };
}

/** [{ name, write, description, input, run(ctx, args) }] */
export const TOOLS = [
  { name: 'list_parties', write: false, description: 'List the parties (campaigns) the user belongs to.', input: {},
    run: (c) => myCampaigns(c.db, c.user.id) },
  { name: 'lookup_rules', write: false, description: "Search the Player's Handbook (5e 2014) and SRD for a rule, spell, condition or feature.", input: { query: z.string() },
    run: (_c, a) => lookupRules(a.query) },
  { name: 'list_calendar_events', write: false, description: 'List calendar events of a party in a date range (ISO dates).', input: { campaign_id: cid, from: z.string().optional(), to: z.string().optional() },
    run: (c, a) => party.listEvents(c.db, c.user, c.cid(a), a) },
  { name: 'create_calendar_event', write: true, description: 'Add an event to the party calendar. kind: session | busy | event.', input: { campaign_id: cid, title: z.string(), start: z.string(), end: z.string().optional(), kind: z.enum(['session', 'busy', 'event']).optional(), description: z.string().optional(), all_day: z.boolean().optional() },
    run: (c, a) => party.createEvent(c.db, c.user, c.cid(a), a) },
  { name: 'delete_calendar_event', write: true, description: 'Delete a calendar event the user created (or any, if DM).', input: { event_id: z.number().int() },
    run: (c, a) => party.deleteEvent(c.db, c.user, a.event_id) },
  { name: 'list_quests', write: false, description: 'List quests; status filter: available | active | completed | failed.', input: { campaign_id: cid, status: z.enum(['available', 'active', 'completed', 'failed']).optional() },
    run: (c, a) => party.listQuests(c.db, c.user, c.cid(a), a.status) },
  { name: 'create_quest', write: true, description: 'Create a quest.', input: { campaign_id: cid, title: z.string(), description: z.string().optional(), giver: z.string().optional(), reward: z.string().optional(), status: z.enum(['available', 'active', 'completed', 'failed']).optional() },
    run: (c, a) => party.createQuest(c.db, c.user, c.cid(a), a) },
  { name: 'update_quest', write: true, description: 'Update quest fields or status.', input: { quest_id: z.number().int(), title: z.string().optional(), description: z.string().optional(), notes: z.string().optional(), reward: z.string().optional(), status: z.enum(['available', 'active', 'completed', 'failed']).optional() },
    run: (c, a) => party.updateQuest(c.db, c.user, a.quest_id, a) },
  { name: 'get_treasury', write: false, description: 'Party currencies (incl. custom), items and recent treasury log.', input: { campaign_id: cid },
    run: (c, a) => party.getTreasury(c.db, c.user, c.cid(a)) },
  { name: 'adjust_currency', write: true, description: 'Add (positive) or spend (negative) party currency. currency = abbreviation or name, e.g. "gp".', input: { campaign_id: cid, currency: z.string(), delta: z.number(), note: z.string().optional() },
    run: (c, a) => party.adjustCurrency(c.db, c.user, c.cid(a), a.currency, a.delta, a.note) },
  { name: 'add_item', write: true, description: 'Add an item to the party treasury. For an SRD item set `index` to its slug (e.g. "longsword", "chain-mail"); otherwise set `category` (Weapon, Armor, Shield, Ammunition, Consumable, Focus, Tool, Gear, Mount/Vehicle, Custom) and, for weapons, weapon_type/damage/damage_type, for armor armor_type/ac_base. stats = free-text description.', input: { campaign_id: cid, name: z.string(), quantity: z.number().optional(), holder: z.string().optional(), value: z.string().optional(), stats: z.string().optional(), notes: z.string().optional(), ...ITEM_INPUT },
    run: (c, a) => party.addItem(c.db, c.user, c.cid(a), a) },
  { name: 'update_item', write: true, description: 'Update a treasury item (quantity, holder, notes…). Sending any item-model field (index, category, damage…) replaces all of them.', input: { item_id: z.number().int(), name: z.string().optional(), quantity: z.number().optional(), holder: z.string().optional(), value: z.string().optional(), stats: z.string().optional(), notes: z.string().optional(), ...ITEM_INPUT },
    run: (c, a) => party.updateItem(c.db, c.user, a.item_id, a) },
  { name: 'remove_item', write: true, description: 'Remove an item from the treasury.', input: { item_id: z.number().int() },
    run: (c, a) => party.removeItem(c.db, c.user, a.item_id) },
  { name: 'list_sessions', write: false, description: 'List game sessions (logs) of a party.', input: { campaign_id: cid },
    run: (c, a) => party.listSessions(c.db, c.user, c.cid(a)) },
  { name: 'get_session_log', write: false, description: 'Read a session log with all its entries.', input: { session_id: z.number().int() },
    run: (c, a) => party.getSessionLog(c.db, c.user, a.session_id) },
  { name: 'create_session', write: true, description: 'Start a new session log.', input: { campaign_id: cid, title: z.string().optional(), date: z.string().optional() },
    run: (c, a) => party.createSession(c.db, c.user, c.cid(a), a) },
  { name: 'add_log_entry', write: true, description: 'Append an entry to a session log. To refer to a picture already in that session, write [imgN] (N = the image number from get_session_log).', input: { session_id: z.number().int(), text: z.string() },
    run: (c, a) => party.addLogEntry(c.db, c.user, a.session_id, a.text) },
  { name: 'propose_session_image', write: true,
    description: 'Propose adding an image the user sent you in chat (by upload_id) to a session log, with an optional caption. This does NOT add it yet: '
      + 'the user gets a confirm/discard card in the chat panel. Ask the user which session if unclear, and tell them to confirm.',
    input: { session_id: z.number().int(), upload_id: z.number().int(), caption: z.string().optional() },
    run: (c, a) => {
      const up = c.db.prepare('SELECT id FROM ai_uploads WHERE id = ? AND user_id = ?').get(a.upload_id, c.user.id);
      if (!up) throw new HttpError(404, `No image with upload_id ${a.upload_id} from this user`);
      const s = party.getSessionLog(c.db, c.user, a.session_id, Number.MAX_SAFE_INTEGER); // permission check
      const id = Number(c.db.prepare("INSERT INTO ai_proposals(user_id, kind, payload) VALUES(?, 'session_image', ?)")
        .run(c.user.id, JSON.stringify({ session_id: s.id, campaign_id: s.campaign_id, upload_id: up.id, caption: a.caption || '', session: `Session ${s.number}${s.title ? `: ${s.title}` : ''}` })).lastInsertRowid);
      return { proposal_id: id, status: 'waiting for the user to confirm in the chat panel — not added yet', next_image_number: (s.images.at(-1)?.n || 0) + 1 };
    } },
  { name: 'list_characters', write: false, description: "List characters the user can see (own + party members').", input: { campaign_id: z.number().int().optional() },
    run: (c, a) => chars.listCharacters(c.db, c.user, a.campaign_id) },
  { name: 'get_character', write: false, description: 'Current state of a character: stats, HP, slots, resources, conditions, effects, inventory.', input: { character_id: z.number().int() },
    run: (c, a) => sheetSummary(chars.getCharacter(c.db, c.user, a.character_id)) },
  { name: 'get_character_history', write: false, description: 'Version history (git-like) of a character.', input: { character_id: z.number().int() },
    run: (c, a) => chars.history(c.db, c.user, a.character_id).slice(0, 100) },
  { name: 'character_action', write: true,
    description: `Resource management on a character (PHB rules applied, recorded in history). type: ${ACTION_TYPES.join(', ')}. ` +
      'Fields by type: damage/heal/temp_hp {amount}, set_hp {current,max,temp}, death_save {result: success|fail|nat1|nat20|reset}, use_slot/restore_slot {level, spell?}, ' +
      'use_resource/restore_resource {name, amount?}, spend_hit_die {die:"d8", roll?}, add_condition {name, note?}, remove_condition {name}, set_exhaustion {level}, ' +
      'add_effect {name, rounds|minutes|seconds, concentration?}, remove_effect {name}, advance_time {seconds}, set_inspiration {value}, cast_spell {spell, level (slot level, 0 for cantrips), pact?, ritual?} (uses the slot and starts a concentration/duration effect).',
    input: { character_id: z.number().int(), type: z.enum(ACTION_TYPES), amount: z.number().optional(), level: z.number().int().optional(), name: z.string().optional(), note: z.string().optional(), result: z.string().optional(), die: z.string().optional(), roll: z.number().int().optional(), rounds: z.number().optional(), minutes: z.number().optional(), seconds: z.number().optional(), concentration: z.boolean().optional(), current: z.number().optional(), max: z.number().optional(), temp: z.number().optional(), value: z.boolean().optional(), spell: z.string().optional(), damage_type: z.string().optional(), pact: z.boolean().optional(), ritual: z.boolean().optional() },
    run: (c, a) => { const { character_id, ...action } = a; const r = chars.characterAction(c.db, c.user, character_id, action, 'ai'); return { message: r.message, version: r.version }; } },
  { name: 'update_character_fields', write: true, description: 'Overwrite top-level sheet fields (e.g. equipment, notes, spells, features, coins) with new values. Read the character first and send complete replacement values.', input: { character_id: z.number().int(), fields: z.record(z.string(), z.any()), message: z.string().optional() },
    run: (c, a) => { const ch = chars.getCharacter(c.db, c.user, a.character_id); return chars.commitCharacter(c.db, c.user, a.character_id, { ...ch.data, ...a.fields }, 'ai', a.message || `AI edited ${Object.keys(a.fields).join(', ')}`); } },
  { name: 'revert_character', write: true, description: 'Revert a character to an earlier version id (creates a new version; nothing is lost).', input: { character_id: z.number().int(), version_id: z.number().int() },
    run: (c, a) => chars.revert(c.db, c.user, a.character_id, a.version_id) },
];

export function enabledTools(db) {
  const off = new Set(getSetting(db, 'ai_disabled_tools') || []);
  return TOOLS.filter((t) => !off.has(t.name));
}

function buildServer(db, ctx) {
  const server = new McpServer({ name: 'dnd-table', version: '1.0.0' });
  for (const t of enabledTools(db)) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.input, annotations: { readOnlyHint: !t.write } }, async (args) => {
      try {
        const out = await t.run(ctx, args || {});
        return { content: [{ type: 'text', text: JSON.stringify(out ?? { ok: true }, null, 1) }] };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    });
  }
  return server;
}

/** Express handler for POST/GET/DELETE /mcp (stateless streamable HTTP). */
export function mcpHandler(db) {
  return async (req, res) => {
    const auth = resolveToken(db, req.headers.authorization);
    if (!auth) return res.status(401).json({ error: 'Invalid or expired MCP token' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const ctx = {
      db, user: auth.user,
      cid: (a) => {
        const id = a.campaign_id ?? auth.campaignId;
        if (!id) throw new HttpError(400, 'campaign_id is required (use list_parties)');
        requireMember(db, auth.user, id);
        return id;
      },
    };
    const server = buildServer(db, ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}
