// Pure PHB-5e (2014) rule helpers shared by the server (API + MCP tools) and the web client.
// Nothing here locks the player in: these compute suggestions and apply button presses,
// but every stored value stays freely editable on the sheet.

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
export const SKILLS = {
  Acrobatics: 'dex', 'Animal Handling': 'wis', Arcana: 'int', Athletics: 'str', Deception: 'cha', History: 'int',
  Insight: 'wis', Intimidation: 'cha', Investigation: 'int', Medicine: 'wis', Nature: 'int', Perception: 'wis',
  Performance: 'cha', Persuasion: 'cha', Religion: 'int', 'Sleight of Hand': 'dex', Stealth: 'dex', Survival: 'wis',
};
export const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];
export const EXHAUSTION = ['None', 'Disadvantage on ability checks', 'Speed halved', 'Disadvantage on attack rolls and saving throws', 'Hit point maximum halved', 'Speed reduced to 0', 'Death'];
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const TIME = { round: 6, minute: 60, '10 minutes': 600, hour: 3600, '8 hours': 28800 };

export const mod = (score) => Math.floor((Number(score || 10) - 10) / 2);
export const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
export const profBonus = (level) => 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
export const totalLevel = (data) => (data.classes || []).reduce((s, c) => s + (Number(c.level) || 0), 0) || 1;
export const hpAverage = (hitDie) => Math.floor(hitDie / 2) + 1;

// ---------- dice ----------
export function rollDie(sides, rng = Math.random) {
  return 1 + Math.floor(rng() * sides);
}
/** PHB ability score method: roll 4d6, drop the lowest. */
export function roll4d6DropLowest(rng = Math.random) {
  const rolls = [0, 0, 0, 0].map(() => rollDie(6, rng));
  const dropIndex = rolls.indexOf(Math.min(...rolls));
  const total = rolls.reduce((s, r, i) => (i === dropIndex ? s : s + r), 0);
  return { rolls, dropIndex, total };
}
/** Parse "2d6+3" style expressions. */
export function rollExpr(expr, rng = Math.random) {
  const m = String(expr).replace(/\s/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  const n = Number(m[1] || 1), sides = Number(m[2]), bonus = Number(m[3] || 0);
  const rolls = Array.from({ length: Math.min(n, 100) }, () => rollDie(sides, rng));
  return { rolls, bonus, total: rolls.reduce((a, b) => a + b, 0) + bonus };
}

// ---------- spell slots ----------
// PHB multiclass spellcaster table (caster level 1..20 -> slots for spell levels 1..9).
const MULTICLASS_SLOTS = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
const THIRD_CASTER_SUBCLASSES = ['eldritch-knight', 'arcane-trickster'];
const pad9 = (a) => Array.from({ length: 9 }, (_, i) => a[i] || 0);

/** Suggested spell slot maxima: { slots: [9], pact: {level, max} | null }. */
export function suggestedSlots(classes, srd) {
  const casters = classes.filter((c) => {
    const def = srd?.classes.find((d) => d.index === c.index);
    return (def?.caster && def.caster !== 'pact') || THIRD_CASTER_SUBCLASSES.includes(c.subclass);
  });
  let slots = pad9([]);
  if (casters.length === 1 && srd) {
    const c = casters[0];
    const def = srd.classes.find((d) => d.index === c.index);
    if (def?.caster) slots = pad9(def.levels[c.level]?.slots || []);
    else slots = pad9(MULTICLASS_SLOTS[Math.floor(c.level / 3) - 1] || []); // third-caster single class
  } else if (casters.length > 1) {
    let lvl = 0;
    for (const c of casters) {
      const def = srd?.classes.find((d) => d.index === c.index);
      if (def?.caster === 'full') lvl += c.level;
      else if (def?.caster === 'half') lvl += Math.floor(c.level / 2);
      else lvl += Math.floor(c.level / 3);
    }
    slots = pad9(MULTICLASS_SLOTS[lvl - 1] || []);
  }
  const wl = classes.find((c) => c.index === 'warlock');
  let pact = null;
  if (wl && srd) {
    const s = srd.classes.find((d) => d.index === 'warlock')?.levels[wl.level]?.slots || [];
    const level = s.findIndex((n) => n > 0) + 1;
    if (level > 0) pact = { level, max: s[level - 1] };
  }
  return { slots, pact };
}

// ---------- class resources ----------
/** Standard PHB limited-use features derived from class levels. Returns [{key,name,max,recharge}]. */
export function suggestedResources(data, srd) {
  const out = [];
  const m = Object.fromEntries(ABILITIES.map((a) => [a, mod(data.abilities?.[a])]));
  const cs = (c) => srd?.classes.find((d) => d.index === c.index)?.levels[c.level]?.class_specific || {};
  for (const c of data.classes || []) {
    const L = c.level, k = cs(c);
    const add = (name, max, recharge) => max > 0 && out.push({ key: `${c.index}:${name}`, name, max, recharge });
    switch (c.index) {
      case 'barbarian': add('Rage', L >= 20 ? 99 : k.rage_count, 'long'); break;
      case 'bard': add('Bardic Inspiration', Math.max(1, m.cha), L >= 5 ? 'short' : 'long'); break;
      case 'cleric': if (L >= 2) add('Channel Divinity', k.channel_divinity_charges || 1, 'short'); break;
      case 'druid': if (L >= 2) add('Wild Shape', L >= 20 ? 99 : 2, 'short'); break;
      case 'fighter': add('Second Wind', 1, 'short'); if (L >= 2) add('Action Surge', k.action_surges || 1, 'short'); if (L >= 9) add('Indomitable', k.indomitable_uses || 1, 'long'); break;
      case 'monk': if (L >= 2) add('Ki', k.ki_points || L, 'short'); break;
      case 'paladin': add('Lay on Hands (HP pool)', 5 * L, 'long'); add('Divine Sense', 1 + m.cha, 'long'); if (L >= 3) add('Channel Divinity', 1, 'short'); break;
      case 'sorcerer': if (L >= 2) add('Sorcery Points', k.sorcery_points || L, 'long'); break;
      case 'wizard': add('Arcane Recovery', 1, 'long'); break;
      default: break;
    }
  }
  return out;
}

// ---------- defaults / derived ----------
export function blankCharacter() {
  return {
    name: '', player: '', race: null, subrace: null, background: null, alignment: '', xp: 0, size: 'Medium', speed: 30,
    classes: [], abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saves: [], skills: {}, proficiencies: { armor: [], weapons: [], tools: [], languages: [] },
    ac: 10, initiative_bonus: 0, inspiration: false,
    hp: { max: 1, current: 1, temp: 0 }, hit_dice: {}, death_saves: { success: 0, fail: 0 },
    attacks: [], features: [], traits: [], feats: [],
    spellcasting: { ability: null, slots: pad9([]).map(() => ({ max: 0, used: 0 })), pact: null },
    spells: [], resources: [], conditions: [], exhaustion: 0, effects: [],
    equipment: [], attunement: ['', '', ''], coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    appearance: '', backstory: '', personality: { traits: '', ideals: '', bonds: '', flaws: '' },
    allies: '', notes: '', portrait: '', level_log: [],
  };
}

/** Fill missing fields so older/imported data never crashes the sheet. */
export function normalizeCharacter(d) {
  const b = blankCharacter();
  const out = { ...b, ...(d || {}) };
  for (const k of ['abilities', 'proficiencies', 'hp', 'death_saves', 'coins', 'personality', 'spellcasting']) out[k] = { ...b[k], ...(d?.[k] || {}) };
  if (!Array.isArray(out.spellcasting.slots) || out.spellcasting.slots.length !== 9) out.spellcasting.slots = b.spellcasting.slots;
  for (const k of ['classes', 'saves', 'attacks', 'features', 'traits', 'feats', 'spells', 'resources', 'conditions', 'effects', 'equipment', 'level_log'])
    if (!Array.isArray(out[k])) out[k] = [];
  if (!Array.isArray(out.attunement)) out.attunement = ['', '', ''];
  if (typeof out.skills !== 'object' || !out.skills) out.skills = {};
  if (typeof out.hit_dice !== 'object' || !out.hit_dice) out.hit_dice = {};
  return out;
}

export function derived(data) {
  const level = totalLevel(data);
  const pb = profBonus(level);
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, mod(data.abilities[a])]));
  const saves = Object.fromEntries(ABILITIES.map((a) => [a, mods[a] + (data.saves.includes(a) ? pb : 0)]));
  const skills = Object.fromEntries(Object.entries(SKILLS).map(([s, a]) => {
    const p = data.skills[s];
    return [s, mods[a] + (p === 'expert' ? pb * 2 : p === 'prof' ? pb : p === 'half' ? Math.floor(pb / 2) : 0)];
  }));
  const sa = data.spellcasting.ability;
  return {
    level, pb, mods, saves, skills,
    passive_perception: 10 + skills.Perception,
    initiative: mods.dex + (Number(data.initiative_bonus) || 0),
    spell_dc: sa ? 8 + pb + mods[sa] : null,
    spell_attack: sa ? pb + mods[sa] : null,
  };
}

/** Seconds for a spell duration text ("Concentration, up to 1 minute", "8 hours"); null = no timer. */
export function durationSeconds(text) {
  const t = String(text || '').toLowerCase();
  const m = t.match(/(\d+)\s*(round|minute|hour|day)/);
  if (!m) return null;
  return Number(m[1]) * { round: 6, minute: 60, hour: 3600, day: 86400 }[m[2]];
}

// ---------- resource actions (button presses) ----------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const int = (v) => Math.trunc(Number(v) || 0);
const clone = (x) => JSON.parse(JSON.stringify(x));
const fmtDur = (s) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : s >= 60 ? `${+(s / 60).toFixed(1)} min` : `${Math.round(s / 6)} rnd`);

/**
 * Apply one resource action to character data. Returns { data, message }.
 * Actions: damage, heal, temp_hp, set_hp, death_save, use_slot, restore_slot, use_pact, restore_pact,
 * use_resource, restore_resource, spend_hit_die, add_condition, remove_condition, set_exhaustion,
 * add_effect, remove_effect, advance_time, short_rest, long_rest, set_inspiration, cast_spell.
 */
export function applyAction(input, a) {
  const d = normalizeCharacter(clone(input));
  const hp = d.hp;
  const m = (k) => mod(d.abilities[k]);
  let msg;
  switch (a.type) {
    case 'damage': {
      let amt = Math.max(0, int(a.amount));
      const fromTemp = Math.min(hp.temp, amt);
      hp.temp -= fromTemp; amt -= fromTemp;
      const wasAt = hp.current;
      hp.current = Math.max(0, hp.current - amt);
      msg = `Took ${int(a.amount)}${a.damage_type ? ` ${a.damage_type}` : ''} damage${fromTemp ? ` (${fromTemp} absorbed by temp HP)` : ''}: HP ${wasAt} → ${hp.current}`;
      if (hp.current === 0 && amt - wasAt >= hp.max) msg += ' — massive damage: instant death (PHB p.197)';
      else if (hp.current === 0 && wasAt === 0) { d.death_saves.fail = Math.min(3, d.death_saves.fail + (a.critical ? 2 : 1)); msg += ` — death save failure (${d.death_saves.fail}/3)`; }
      else if (hp.current === 0) msg += ' — unconscious, making death saves';
      if (amt > 0 && d.effects.some((e) => e.concentration)) msg += ` — concentration check DC ${Math.max(10, Math.floor(amt / 2))}`;
      break;
    }
    case 'heal': {
      const amt = Math.max(0, int(a.amount));
      const was = hp.current;
      hp.current = Math.min(hp.max, hp.current + amt);
      if (was === 0 && hp.current > 0) d.death_saves = { success: 0, fail: 0 };
      msg = `Healed ${amt}: HP ${was} → ${hp.current}`;
      break;
    }
    case 'temp_hp': {
      // Temporary HP don't stack — keep the higher value (PHB p.198).
      const amt = Math.max(0, int(a.amount));
      const was = hp.temp;
      hp.temp = a.replace ? amt : Math.max(hp.temp, amt);
      msg = `Temp HP ${was} → ${hp.temp}`;
      break;
    }
    case 'set_hp': {
      if (a.max != null) hp.max = Math.max(1, int(a.max));
      if (a.current != null) hp.current = clamp(int(a.current), 0, hp.max);
      if (a.temp != null) hp.temp = Math.max(0, int(a.temp));
      msg = `HP set to ${hp.current}/${hp.max}${hp.temp ? ` (+${hp.temp} temp)` : ''}`;
      break;
    }
    case 'death_save': {
      if (a.result === 'reset') { d.death_saves = { success: 0, fail: 0 }; msg = 'Death saves reset'; break; }
      if (a.result === 'nat20') { hp.current = Math.max(hp.current, 1); d.death_saves = { success: 0, fail: 0 }; msg = 'Natural 20 on death save — back up with 1 HP'; break; }
      const k = a.result === 'fail' ? 'fail' : 'success';
      d.death_saves[k] = Math.min(3, d.death_saves[k] + (a.result === 'nat1' ? 2 : 1));
      msg = `Death save ${k} (${d.death_saves.success}✓ / ${d.death_saves.fail}✗)`;
      if (d.death_saves.success >= 3) msg += ' — stable';
      if (d.death_saves.fail >= 3) msg += ' — dead';
      break;
    }
    case 'use_slot':
    case 'restore_slot': {
      const lvl = clamp(int(a.level), 1, 9);
      const s = d.spellcasting.slots[lvl - 1];
      const n = Math.max(1, int(a.count) || 1);
      s.used = a.type === 'use_slot' ? s.used + n : Math.max(0, s.used - n);
      msg = `${a.type === 'use_slot' ? 'Used' : 'Restored'} level ${lvl} slot${a.spell ? ` (${a.spell})` : ''}: ${Math.max(0, s.max - s.used)}/${s.max} left`;
      if (s.used > s.max) msg += ' — over the maximum';
      break;
    }
    case 'use_pact':
    case 'restore_pact': {
      if (!d.spellcasting.pact) d.spellcasting.pact = { level: 1, max: 1, used: 0 };
      const p = d.spellcasting.pact;
      p.used = a.type === 'use_pact' ? p.used + 1 : Math.max(0, p.used - 1);
      msg = `${a.type === 'use_pact' ? 'Used' : 'Restored'} pact slot${a.spell ? ` (${a.spell})` : ''}: ${Math.max(0, p.max - p.used)}/${p.max} left`;
      break;
    }
    case 'use_resource':
    case 'restore_resource': {
      const r = d.resources.find((x) => x.key === a.key || x.name.toLowerCase() === String(a.name || a.key || '').toLowerCase());
      if (!r) throw new Error(`No resource "${a.name || a.key}"`);
      const n = Math.max(1, int(a.amount) || 1);
      r.used = a.type === 'use_resource' ? (r.used || 0) + n : Math.max(0, (r.used || 0) - n);
      msg = `${a.type === 'use_resource' ? 'Used' : 'Restored'} ${n} ${r.name}: ${Math.max(0, r.max - r.used)}/${r.max} left`;
      break;
    }
    case 'spend_hit_die': {
      const die = String(a.die || Object.keys(d.hit_dice)[0] || 'd8');
      const hd = d.hit_dice[die];
      if (!hd) throw new Error(`No ${die} hit dice`);
      hd.used = (hd.used || 0) + 1;
      const roll = a.roll != null ? int(a.roll) : rollDie(Number(die.slice(1)));
      const gain = Math.max(0, roll + m('con'));
      const was = hp.current;
      hp.current = Math.min(hp.max, hp.current + gain);
      msg = `Spent a ${die} hit die (rolled ${roll}${signed(m('con'))} CON): HP ${was} → ${hp.current}; ${hd.total - hd.used}/${hd.total} ${die} left`;
      break;
    }
    case 'add_condition': {
      const name = String(a.name || '').trim();
      if (!name) throw new Error('Condition name required');
      if (!d.conditions.some((c) => c.name.toLowerCase() === name.toLowerCase())) d.conditions.push({ name, note: String(a.note || '') });
      msg = `Condition added: ${name}${a.note ? ` (${a.note})` : ''}`;
      break;
    }
    case 'remove_condition': {
      d.conditions = d.conditions.filter((c) => c.name.toLowerCase() !== String(a.name).toLowerCase());
      msg = `Condition removed: ${a.name}`;
      break;
    }
    case 'set_exhaustion': {
      d.exhaustion = clamp(int(a.level), 0, 6);
      msg = `Exhaustion level ${d.exhaustion}: ${EXHAUSTION[d.exhaustion]}`;
      break;
    }
    case 'add_effect': {
      const name = String(a.name || '').trim() || 'Effect';
      const seconds = a.seconds != null ? int(a.seconds) : a.rounds != null ? int(a.rounds) * 6 : a.minutes != null ? int(a.minutes) * 60 : null;
      let note = '';
      if (a.concentration) {
        const prev = d.effects.filter((e) => e.concentration);
        if (prev.length) note = ` (ends concentration on ${prev.map((e) => e.name).join(', ')})`;
        d.effects = d.effects.filter((e) => !e.concentration);
      }
      d.effects.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, remaining: seconds, concentration: !!a.concentration, note: String(a.note || '') });
      msg = `Effect started: ${name}${seconds != null ? ` for ${fmtDur(seconds)}` : ''}${a.concentration ? ' [concentration]' : ''}${note}`;
      break;
    }
    case 'remove_effect': {
      const e = d.effects.find((x) => x.id === a.id || x.name.toLowerCase() === String(a.name || '').toLowerCase());
      d.effects = d.effects.filter((x) => x !== e);
      msg = `Effect ended: ${e?.name || a.name || a.id}`;
      break;
    }
    case 'advance_time': {
      const s = Math.max(0, int(a.seconds));
      const expired = [];
      d.effects = d.effects.filter((e) => {
        if (e.remaining == null) return true;
        e.remaining -= s;
        if (e.remaining <= 0) { expired.push(e.name); return false; }
        return true;
      });
      msg = `Advanced ${fmtDur(s)}${expired.length ? ` — expired: ${expired.join(', ')}` : ''}`;
      break;
    }
    case 'short_rest': {
      const parts = [];
      for (const r of d.resources) if (r.recharge === 'short' && r.used) { parts.push(r.name); r.used = 0; }
      if (d.spellcasting.pact?.used) { d.spellcasting.pact.used = 0; parts.push('pact slots'); }
      const t = applyAction(d, { type: 'advance_time', seconds: 3600 });
      Object.assign(d, t.data);
      msg = `Short rest${parts.length ? ` — recharged ${parts.join(', ')}` : ''}. Spend hit dice to heal.`;
      break;
    }
    case 'long_rest': {
      const lvl = totalLevel(d);
      hp.current = hp.max; hp.temp = 0;
      d.death_saves = { success: 0, fail: 0 };
      // Regain spent hit dice up to half your total level (minimum 1), largest dice first.
      let regain = Math.max(1, Math.floor(lvl / 2));
      for (const die of Object.keys(d.hit_dice).sort((x, y) => Number(y.slice(1)) - Number(x.slice(1)))) {
        const hd = d.hit_dice[die];
        const back = Math.min(regain, hd.used || 0);
        hd.used = (hd.used || 0) - back; regain -= back;
      }
      d.spellcasting.slots.forEach((s) => { s.used = 0; });
      if (d.spellcasting.pact) d.spellcasting.pact.used = 0;
      d.resources.forEach((r) => { if (r.recharge !== 'none') r.used = 0; });
      const exWas = d.exhaustion;
      if (d.exhaustion > 0) d.exhaustion -= 1;
      const t = applyAction(d, { type: 'advance_time', seconds: TIME['8 hours'] });
      Object.assign(d, t.data);
      msg = `Long rest — HP full (${hp.max}), slots & resources restored, hit dice regained${exWas ? `, exhaustion ${exWas} → ${d.exhaustion}` : ''}`;
      break;
    }
    case 'cast_spell': {
      // { spell, level (slot level; 0 = cantrip/at will), pact?, concentration?, duration? ("1 minute"), ritual? }
      const name = String(a.spell || a.name || 'a spell');
      const known = d.spells.find((s) => s.name.toLowerCase() === name.toLowerCase());
      const lvl = clamp(int(a.level ?? known?.level ?? 0), 0, 9);
      const parts = [];
      if (a.ritual) parts.push('as a ritual (no slot, +10 minutes)');
      else if (lvl > 0 && a.pact) {
        if (!d.spellcasting.pact) d.spellcasting.pact = { level: lvl, max: 1, used: 0 };
        const p = d.spellcasting.pact;
        p.used += 1;
        parts.push(`pact slot ${Math.max(0, p.max - p.used)}/${p.max} left${p.used > p.max ? ' — over the maximum' : ''}`);
      } else if (lvl > 0) {
        const s = d.spellcasting.slots[lvl - 1];
        s.used += 1;
        parts.push(`level ${lvl} slot ${Math.max(0, s.max - s.used)}/${s.max} left${s.used > s.max ? ' — over the maximum' : ''}`);
      }
      const conc = a.concentration ?? known?.concentration ?? false;
      const secs = a.seconds != null ? int(a.seconds) : durationSeconds(a.duration ?? known?.duration);
      if (conc || secs) {
        const t = applyAction(d, { type: 'add_effect', name: lvl > (known?.level || 0) && known ? `${name} (L${lvl})` : name, seconds: secs, concentration: conc });
        Object.assign(d, t.data);
        parts.push(t.message.replace(/^Effect started: /, 'effect: '));
      }
      msg = `Cast ${name}${lvl ? ` at level ${lvl}` : ''}${parts.length ? ` — ${parts.join('; ')}` : ''}`;
      break;
    }
    case 'set_inspiration': {
      d.inspiration = !!a.value;
      msg = d.inspiration ? 'Gained heroic inspiration' : 'Used heroic inspiration';
      break;
    }
    default:
      throw new Error(`Unknown action ${a.type}`);
  }
  return { data: d, message: msg };
}

/** Short human summary of what changed between two character snapshots (for history). */
export function diffSummary(a, b) {
  if (!a) return 'Created';
  const changed = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed.push(k.replace(/_/g, ' '));
  if (!changed.length) return 'No changes';
  if (JSON.stringify(a.hp) !== JSON.stringify(b.hp) && b.hp) {
    const i = changed.indexOf('hp');
    changed[i] = `HP ${a.hp?.current}/${a.hp?.max} → ${b.hp.current}/${b.hp.max}`;
  }
  return `Edited ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` +${changed.length - 6} more` : ''}`;
}
