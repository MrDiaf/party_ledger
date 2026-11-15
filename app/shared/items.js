// Equipment as real items (not text): every inventory entry can link to the SRD item catalog by `index`,
// which supplies weight, cost, damage, AC, properties and description. Custom items just carry their own fields.
import { mod, signed, profBonus, totalLevel } from './rules.js';

export const findItem = (srd, index) => (index ? srd?.items?.find((i) => i.index === index) : null);

/** Inventory sections, in display order: [kind, label]. Shield shares the Armor section. */
export const ITEM_GROUPS = [['Weapon', 'Weapons'], ['Armor', 'Armor & shields'], ['Shield', null], ['Ammunition', 'Ammunition'], ['Consumable', 'Consumables'],
  ['Focus', 'Spellcasting focus'], ['Tool', 'Tools & kits'], ['Pack', 'Packs'], ['Gear', 'Adventuring gear'], ['Mount/Vehicle', 'Mounts & vehicles'], ['Custom', 'Other items']];
/** Categories a custom item can be given (Armor and Shield are separate so a shield adds to AC). */
export const CUSTOM_KINDS = [['Weapon', 'Weapon'], ['Armor', 'Armor'], ['Shield', 'Shield'], ['Ammunition', 'Ammunition'], ['Consumable', 'Consumable'],
  ['Focus', 'Spellcasting focus'], ['Tool', 'Tool / kit'], ['Gear', 'Adventuring gear'], ['Mount/Vehicle', 'Mount / vehicle'], ['Custom', 'Other (flavour item)']];
export const WEAPON_TYPES = ['Simple Melee', 'Simple Ranged', 'Martial Melee', 'Martial Ranged'];
export const ARMOR_TYPES = ['Light armor', 'Medium armor', 'Heavy armor'];
export const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];

// Catalog gear that is used up — shown under Consumables (and filterable as such in the catalog).
const CONSUMABLES = new Set(['acid-vial', 'alchemists-fire-flask', 'antitoxin-vial', 'holy-water-flask', 'oil-flask', 'rations-1-day', 'healers-kit', 'poison-basic-vial', 'ball-bearings-bag-of-1000', 'caltrops', 'chalk-1-piece', 'candle', 'torch']);
/** Which inventory section / catalog filter a catalog item belongs to. */
export const groupKind = (it) => (it?.kind === 'Gear' && CONSUMABLES.has(it.index) ? 'Consumable' : it?.kind || 'Custom');

/** Item-model fields an entry may carry besides name/qty/notes (catalog link + custom-item stats). */
const ITEM_KEYS = { index: 'str', category: 'str', weapon_type: 'str', damage: 'str', damage_type: 'str', range: 'str', versatile: 'str', armor_type: 'str', ac_base: 'num', weight: 'num', properties: 'list' };
/** Keep only known item fields with sane types (used by the treasury so it stores the same item model). */
export function cleanItemFields(b) {
  const out = {};
  for (const [k, t] of Object.entries(ITEM_KEYS)) {
    const v = b?.[k];
    if (v == null || v === '') continue;
    if (t === 'str') out[k] = String(v).slice(0, 120);
    else if (t === 'num' && Number.isFinite(Number(v))) out[k] = Number(v);
    else if (t === 'list' && Array.isArray(v)) out[k] = v.map((x) => String(x).slice(0, 40)).slice(0, 20);
  }
  return out;
}

/**
 * The item behind an inventory entry: the catalog item, or one built from a custom entry's own fields
 * (category, weapon damage, armor AC…) so custom weapons and armor work like catalog ones.
 */
export function itemOf(srd, e) {
  const cat = findItem(srd, e?.index);
  if (cat || !e) return cat;
  const kind = CUSTOM_KINDS.some(([k]) => k === e.category) ? e.category : 'Custom';
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const it = { name: e.name, kind, custom: true, sub: '', weight: num(e.weight), desc: e.desc || '' };
  if (kind === 'Weapon') {
    it.sub = WEAPON_TYPES.includes(e.weapon_type) ? e.weapon_type : 'Simple Melee';
    it.damage = [e.damage, e.damage_type].filter(Boolean).join(' ');
    it.properties = Array.isArray(e.properties) ? e.properties : [];
    if (e.range) it.range = e.range;
    if (e.versatile && it.properties.includes('Versatile')) it.versatile = e.versatile;
  }
  if (kind === 'Armor') {
    it.sub = ARMOR_TYPES.includes(e.armor_type) ? e.armor_type : 'Light armor';
    const base = num(e.ac_base);
    if (base != null) it.ac = { base, dex: it.sub !== 'Heavy armor', max_dex: it.sub === 'Medium armor' ? 2 : null };
  }
  if (kind === 'Shield') it.ac = { base: num(e.ac_base) ?? 2, dex: false, max_dex: null };
  return it;
}

/** PHB starting wealth by class (dice, multiplier) for "take gold instead of equipment". */
export const STARTING_WEALTH = {
  barbarian: [2, 10], bard: [5, 10], cleric: [5, 10], druid: [2, 10], fighter: [5, 10], monk: [5, 1],
  paladin: [5, 10], ranger: [5, 10], rogue: [4, 10], sorcerer: [3, 10], warlock: [4, 10], wizard: [4, 10],
};

/** One inventory entry for a catalog item (armor and shields start worn, weapons ready). */
export function itemEntry(srd, index, qty = 1, notes = '') {
  const it = findItem(srd, index);
  if (!it) return { name: index, qty, notes, equipped: false };
  return { index, name: it.name, qty, notes, equipped: ['Armor', 'Shield', 'Weapon'].includes(it.kind) };
}

/** Equipment packs become their contents, so "Explorer's Pack" is a backpack, a bedroll, 10 torches… */
export function expandItems(srd, entries) {
  const out = [];
  const add = (e) => {
    const same = out.find((o) => o.index && o.index === e.index && o.notes === e.notes);
    if (same) same.qty += e.qty; else out.push({ ...e });
  };
  for (const e of entries) {
    const it = findItem(srd, e.index);
    if (it?.contents) for (const c of it.contents) add(itemEntry(srd, c.index, c.qty * (e.qty || 1), `from ${it.name}`));
    else add(e);
  }
  return out;
}

/**
 * Items from the class starting-equipment choices. draft.gear = { [choiceIdx]: optionIdx },
 * draft.gearPicks = { 'choiceIdx.itemIdx': [index, ...] } for "any martial weapon"-style picks.
 */
export function classGear(srd, cls, draft) {
  if (!cls) return [];
  const out = cls.starting_equipment.map((e) => itemEntry(srd, e.index, e.qty, 'starting equipment'));
  (cls.starting_choices || []).forEach((ch, ci) => {
    const opt = ch.options[draft.gear?.[ci] ?? 0];
    opt?.items.forEach((it, ii) => {
      if (it.index) out.push(itemEntry(srd, it.index, it.qty, 'starting equipment'));
      else {
        const picks = draft.gearPicks?.[`${ci}.${ii}`] || [];
        for (let k = 0; k < it.qty; k++) if (picks[k]) out.push(itemEntry(srd, picks[k], 1, 'starting equipment'));
      }
    });
  });
  return out;
}

/** Background equipment list → entries (catalog-linked where possible). */
export function backgroundGear(srd, bg) {
  return (bg?.equipment || []).map((e) => (typeof e === 'string' ? { name: e, qty: 1, notes: 'background', equipped: false }
    : e.index ? { ...itemEntry(srd, e.index, e.qty, 'background'), name: e.name, equipped: false } : { name: e.name, qty: e.qty || 1, notes: 'background', equipped: false }));
}

/** Weapon attack line for the sheet (finesse uses the better of STR/DEX, ranged uses DEX). */
export function weaponAttack(item, data, proficient = true) {
  const m = (a) => mod(data.abilities?.[a]);
  const props = item.properties || [];
  const ranged = /Ranged/.test(item.sub || '');
  const am = ranged ? m('dex') : props.includes('Finesse') ? Math.max(m('str'), m('dex')) : m('str');
  const pb = proficient ? profBonus(totalLevel(data)) : 0;
  const notes = [...props, item.range && `range ${item.range}`, item.thrown && `thrown ${item.thrown}`, item.versatile && `two-handed ${item.versatile}`].filter(Boolean).join(', ');
  return { name: item.name, bonus: signed(am + pb), damage: `${item.damage}${am ? ` ${signed(am)}` : ''}`.replace(/^(\S+) (\w+) ([+-]\d+)$/, '$1$3 $2'), notes, index: item.index };
}

/** Is the character proficient with this catalog weapon (by category or by name)? */
export function weaponProficient(item, data) {
  const p = (data.proficiencies?.weapons || []).join(', ').toLowerCase();
  const cat = (item.sub || '').toLowerCase();
  return (cat.startsWith('simple') && p.includes('simple')) || (cat.startsWith('martial') && p.includes('martial')) || p.includes(item.name.toLowerCase().replace(/,.*$/, ''));
}

/** AC from worn armor + shield (or unarmored / Unarmored Defense). Returns { ac, source }. */
export function armorClass(data, srd) {
  const m = (a) => mod(data.abilities?.[a]);
  const worn = (data.equipment || []).filter((e) => e.equipped).map((e) => itemOf(srd, e)).filter(Boolean);
  const armor = worn.find((i) => i.kind === 'Armor' && i.ac);
  const shieldItem = worn.find((i) => i.kind === 'Shield');
  const shield = shieldItem ? shieldItem.ac?.base ?? 2 : 0;
  if (armor?.ac) {
    const dex = armor.ac.dex ? (armor.ac.max_dex != null ? Math.min(armor.ac.max_dex, m('dex')) : m('dex')) : 0;
    const defense = (data.features || []).some((f) => /^Fighting Style: .*\bDefense\b/.test(f.name)) ? 1 : 0; // +1 AC while wearing armor
    return { ac: armor.ac.base + dex + shield + defense, source: `${armor.name}${shield ? ' + shield' : ''}${defense ? ' + Defense style' : ''}` };
  }
  const cls = (data.classes || []).map((c) => c.index);
  if (cls.includes('barbarian')) return { ac: 10 + m('dex') + m('con') + shield, source: `Unarmored Defense${shield ? ' + shield' : ''}` };
  if (cls.includes('monk') && !shield) return { ac: 10 + m('dex') + m('wis'), source: 'Unarmored Defense' };
  return { ac: 10 + m('dex') + shield, source: `unarmored${shield ? ' + shield' : ''}` };
}

/** Total carried weight (lb) of inventory entries, using catalog weights or an entry's own `weight`. */
export function totalWeight(data, srd) {
  return (data.equipment || []).reduce((s, e) => {
    const it = findItem(srd, e.index);
    const w = e.weight != null && e.weight !== '' ? Number(e.weight) : it?.weight ?? 0;
    const bundle = it?.bundle || 1; // arrows etc. are priced/weighed per bundle of 20
    return s + (Number(w) || 0) * (Number(e.qty) || 0) / bundle;
  }, 0);
}
