// Builds app/server/data/srd.json from the 5e SRD 5.1 dataset (github.com/5e-bits/5e-database,
// SRD content under the OGL 1.0a / CC-BY-4.0) plus PHB (2014) name supplements that are not in the SRD.
// The output is committed, so this only needs re-running to refresh data:  npm run srd
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2014/en/5e-SRD-';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/data/srd.json');

async function load(name) {
  const res = await fetch(`${BASE}${name}.json`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const [Classes, Levels, Features, Races, Subraces, Traits, Backgrounds, Spells, Conditions, Skills, Languages, Equipment, Feats, Subclasses, EquipmentCategories, WeaponProperties, MagicSchools] =
  await Promise.all(['Classes', 'Levels', 'Features', 'Races', 'Subraces', 'Traits', 'Backgrounds', 'Spells', 'Conditions', 'Skills', 'Languages', 'Equipment', 'Feats', 'Subclasses', 'Equipment-Categories', 'Weapon-Properties', 'Magic-Schools'].map(load));

const text = (d) => (Array.isArray(d) ? d.join('\n') : d || '');
const abil = (list = []) => Object.fromEntries(list.map((b) => [b.ability_score.index, b.bonus]));
const skillName = (i) => i.replace(/^Skill: /, '');
const featureById = new Map(Features.map((f) => [f.index, f]));
const traitById = new Map(Traits.map((t) => [t.index, t]));

function featureOut(ref) {
  const f = featureById.get(ref.index);
  if (!f) return { name: ref.name, desc: '' };
  const options = Features.filter((o) => o.parent?.index === f.index).map((o) => ({ name: o.name.replace(/^.*?: /, ''), desc: text(o.desc) }));
  return { name: f.name, desc: text(f.desc), ...(options.length ? { options } : {}) };
}

// ---------- starting equipment choices ----------
// Every option becomes { label, items: [{ index, qty } | { category, qty, label }] } — a "category" item means
// "pick any item from that equipment category" (e.g. any martial melee weapon).
const PLAIN = (x) => String(x || '').replace(/[’]/g, "'");
function refItems(o) {
  if (o.option_type === 'counted_reference') return [{ index: o.of.index, qty: o.count }];
  if (o.option_type === 'multiple') return o.items.flatMap(refItems);
  if (o.option_type === 'choice') {
    const f = o.choice.from;
    if (f.option_set_type === 'equipment_category') return [{ category: f.equipment_category.index, qty: o.choice.choose, label: PLAIN(o.choice.desc) }];
    // nested explicit list (rare) — take it as a category-like pick from those items
    return [{ pick: (f.options || []).flatMap(refItems).map((x) => x.index).filter(Boolean), qty: o.choice.choose, label: PLAIN(o.choice.desc) }];
  }
  return [];
}
const itemName = (i) => Equipment.find((e) => e.index === i)?.name || i;
const catName = (i) => EquipmentCategories.find((e) => e.index === i)?.name || i;
function labelFor(items) {
  return items.map((x) => (x.index ? `${x.qty > 1 ? `${x.qty}× ` : ''}${itemName(x.index)}` : x.label || `any ${catName(x.category).toLowerCase()}`)).join(' + ');
}
function choiceOut(o) {
  const f = o.from;
  let options;
  if (f.option_set_type === 'equipment_category') options = [{ items: [{ category: f.equipment_category.index, qty: o.choose, label: PLAIN(o.desc) || `any ${catName(f.equipment_category.index).toLowerCase()}` }] }];
  else options = f.options.map((x) => ({ items: refItems(x) }));
  options = options.map((x) => ({ label: labelFor(x.items), ...x }));
  return { desc: PLAIN(o.desc) || options.map((x) => x.label).join(' or '), choose: o.choose, options };
}

// ---------- classes ----------
const CASTER = { bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full', paladin: 'half', ranger: 'half', warlock: 'pact' };
const SUBCLASS_LEVEL = { barbarian: 3, bard: 3, cleric: 1, druid: 2, fighter: 3, monk: 3, paladin: 3, ranger: 3, rogue: 3, sorcerer: 1, warlock: 1, wizard: 2 };
// PHB 2014 subclasses that are not in the SRD (name only — details live in the PHB / rules search).
const PHB_SUBCLASSES = {
  barbarian: ['Path of the Totem Warrior'], bard: ['College of Valor'],
  cleric: ['Knowledge Domain', 'Light Domain', 'Nature Domain', 'Tempest Domain', 'Trickery Domain', 'War Domain'],
  druid: ['Circle of the Moon'], fighter: ['Battle Master', 'Eldritch Knight'], monk: ['Way of Shadow', 'Way of the Four Elements'],
  paladin: ['Oath of the Ancients', 'Oath of Vengeance'], ranger: ['Beast Master'], rogue: ['Assassin', 'Arcane Trickster'],
  sorcerer: ['Wild Magic'], warlock: ['The Archfey', 'The Great Old One'],
  wizard: ['School of Abjuration', 'School of Conjuration', 'School of Divination', 'School of Enchantment', 'School of Illusion', 'School of Necromancy', 'School of Transmutation'],
};
const ASI_LEVELS = { fighter: [4, 6, 8, 12, 14, 16, 19], rogue: [4, 8, 10, 12, 16, 19] };

const classes = Classes.map((c) => {
  const levels = {};
  for (const l of Levels.filter((x) => x.class.index === c.index && !x.subclass)) {
    const sc = l.spellcasting || {};
    levels[l.level] = {
      prof_bonus: l.prof_bonus,
      features: l.features.map(featureOut).filter((f) => !/^Ability Score Improvement/.test(f.name)),
      asi: (ASI_LEVELS[c.index] || [4, 8, 12, 16, 19]).includes(l.level),
      ...(l.spellcasting ? {
        cantrips_known: sc.cantrips_known ?? null, spells_known: sc.spells_known ?? null,
        slots: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => sc[`spell_slots_level_${n}`] || 0),
      } : {}),
      class_specific: l.class_specific || {},
    };
  }
  const srdSubs = Subclasses.filter((s) => s.class.index === c.index).map((s) => {
    const levelsSub = {};
    for (const l of Levels.filter((x) => x.subclass?.index === s.index)) levelsSub[l.level] = l.features.map(featureOut);
    return { index: s.index, name: s.name, desc: text(s.desc), levels: levelsSub };
  });
  const profs = c.proficiencies.filter((p) => !p.index.startsWith('saving-throw')).map((p) => p.name);
  const choice = c.proficiency_choices[0];
  const toolChoice = c.proficiency_choices.slice(1).map((p) => p.desc).filter(Boolean);
  return {
    index: c.index, name: c.name, hit_die: c.hit_die,
    saves: c.saving_throws.map((s) => s.index),
    proficiencies: profs, tool_choices: toolChoice,
    skill_choices: { choose: choice.choose, from: choice.from.options.map((o) => skillName(o.item?.name || o.choice?.desc || '')).filter(Boolean) },
    spellcasting_ability: c.spellcasting?.spellcasting_ability?.index || null,
    caster: CASTER[c.index] || null,
    subclass_level: SUBCLASS_LEVEL[c.index],
    subclass_flavor: Subclasses.find((s) => s.class.index === c.index)?.subclass_flavor || 'Subclass',
    subclasses: [...srdSubs, ...(PHB_SUBCLASSES[c.index] || []).map((name) => ({ index: name.toLowerCase().replace(/[^a-z]+/g, '-'), name, desc: 'PHB subclass — see the Player\'s Handbook for features.', levels: {}, phb: true }))],
    multiclass_prereq: (c.multi_classing.prerequisites || []).map((p) => ({ ability: p.ability_score.index, min: p.minimum_score })),
    multiclass_prereq_any: (c.multi_classing.prerequisite_options?.from?.options || []).map((p) => ({ ability: p.ability_score.index, min: p.minimum_score })),
    starting_equipment: c.starting_equipment.map((e) => ({ index: e.equipment.index, qty: e.quantity })),
    starting_choices: (c.starting_equipment_options || []).map(choiceOut),
    levels,
  };
});

// ---------- races ----------
const PHB_SUBRACES = {
  dwarf: [{ index: 'mountain-dwarf', name: 'Mountain Dwarf', ability_bonuses: { str: 2 }, proficiencies: ['Light Armor', 'Medium Armor'], traits: [{ name: 'Dwarven Armor Training', desc: 'You have proficiency with light and medium armor.' }] }],
  elf: [
    { index: 'wood-elf', name: 'Wood Elf', ability_bonuses: { wis: 1 }, speed: 35, proficiencies: ['Longswords', 'Shortswords', 'Shortbows', 'Longbows'], traits: [{ name: 'Elf Weapon Training', desc: 'Proficiency with the longsword, shortsword, shortbow, and longbow.' }, { name: 'Fleet of Foot', desc: 'Your base walking speed increases to 35 feet.' }, { name: 'Mask of the Wild', desc: 'You can attempt to hide even when you are only lightly obscured by foliage, heavy rain, falling snow, mist, and other natural phenomena.' }] },
    { index: 'drow', name: 'Dark Elf (Drow)', ability_bonuses: { cha: 1 }, proficiencies: ['Rapiers', 'Shortswords', 'Hand crossbows'], traits: [{ name: 'Superior Darkvision', desc: 'Darkvision radius of 120 feet.' }, { name: 'Sunlight Sensitivity', desc: 'Disadvantage on attack rolls and Wisdom (Perception) checks that rely on sight when you, the target, or what you are trying to perceive is in direct sunlight.' }, { name: 'Drow Magic', desc: 'Dancing lights cantrip; faerie fire at 3rd level and darkness at 5th level, once per long rest each. Charisma is your spellcasting ability.' }, { name: 'Drow Weapon Training', desc: 'Proficiency with rapiers, shortswords, and hand crossbows.' }] },
  ],
  halfling: [{ index: 'stout-halfling', name: 'Stout Halfling', ability_bonuses: { con: 1 }, traits: [{ name: 'Stout Resilience', desc: 'Advantage on saving throws against poison, and resistance against poison damage.' }] }],
  gnome: [{ index: 'forest-gnome', name: 'Forest Gnome', ability_bonuses: { dex: 1 }, traits: [{ name: 'Natural Illusionist', desc: 'You know the minor illusion cantrip. Intelligence is your spellcasting ability for it.' }, { name: 'Speak with Small Beasts', desc: 'Through sounds and gestures, you can communicate simple ideas with Small or smaller beasts.' }] }],
};

const races = Races.map((r) => ({
  index: r.index, name: r.name, speed: r.speed, size: r.size,
  ability_bonuses: abil(r.ability_bonuses),
  ability_bonus_choice: r.ability_bonus_options ? { choose: r.ability_bonus_options.choose, from: r.ability_bonus_options.from.options.map((o) => o.ability_score.index) } : null,
  languages: r.languages.map((l) => l.name),
  extra_languages: r.language_options?.choose || 0,
  // Half-Elf "Skill Versatility" is modelled as a trait in the SRD data — surface it as a choice.
  skill_choice: r.index === 'half-elf' ? { choose: 2, from: Skills.map((s) => s.name) }
    : r.starting_proficiency_options ? { choose: r.starting_proficiency_options.choose, from: r.starting_proficiency_options.from.options.map((o) => skillName(o.item.name)).filter((n) => !n.includes(':')) } : null,
  // The SRD keeps racial proficiencies on traits (Keen Senses → Perception, Dwarven Combat Training → axes…).
  proficiencies: [...(r.starting_proficiencies || []), ...r.traits.flatMap((t) => traitById.get(t.index)?.proficiencies || [])].map((p) => p.name),
  traits: r.traits.map((t) => ({ name: t.name, desc: text(traitById.get(t.index)?.desc) })),
  age: r.age, alignment: r.alignment, size_description: r.size_description,
  subraces: [
    ...Subraces.filter((s) => s.race.index === r.index).map((s) => ({
      index: s.index, name: s.name, desc: s.desc, ability_bonuses: abil(s.ability_bonuses),
      traits: s.racial_traits.map((t) => ({ name: t.name, desc: text(traitById.get(t.index)?.desc) })),
      proficiencies: [...(s.starting_proficiencies || []), ...s.racial_traits.flatMap((t) => traitById.get(t.index)?.proficiencies || [])].map((p) => p.name),
    })),
    ...(PHB_SUBRACES[r.index] || []).map((s) => ({ ...s, phb: true })),
  ],
}));

// ---------- backgrounds (SRD has only Acolyte; the rest are PHB summaries) ----------
// Equipment is a comma list; each entry becomes an item, linked to the catalog where one exists
// ("index:qty:name" lets an entry carry a catalog index plus its own wording).
const BG_ITEM = {
  'Holy symbol': 'emblem', 'vestments': 'vestments', 'common clothes': 'clothes-common', 'pouch': 'pouch', 'Fine clothes': 'clothes-fine',
  'disguise kit': 'disguise-kit', 'Crowbar': 'crowbar', 'costume': 'clothes-costume', 'shovel': 'shovel', 'iron pot': 'pot-iron',
  "traveler's clothes": 'clothes-travelers', 'winter blanket': 'blanket', 'herbalism kit': 'herbalism-kit', 'signet ring': 'signet-ring',
  'Staff': 'quarterstaff', 'hunting trap': 'hunting-trap', 'Bottle of black ink': 'ink-1-ounce-bottle', 'quill': 'ink-pen', 'small knife': 'small-knife',
  'Small knife': 'small-knife', 'Belaying pin (club)': 'club', '50 feet of silk rope': 'rope-silk-50-feet', 'purse': 'pouch',
  'Scroll case of notes': 'case-map-or-scroll', '5 sticks of incense': 'block-of-incense', 'dark common clothes with hood': 'clothes-common',
};
const bgItems = (list) => list.split(/,\s*/).map((raw) => {
  const index = BG_ITEM[raw] || Equipment.find((e) => e.name.toLowerCase() === raw.toLowerCase())?.index;
  const [, n, rest] = raw.match(/^(\d+) (.*)$/) || [null, 1, raw]; // "5 sticks of incense" -> 5× "Sticks of incense"
  return { name: rest[0].toUpperCase() + rest.slice(1), qty: Number(n), ...(index ? { index } : {}) };
});
const bg = (name, skills, tools, languages, feature, equipment, gold = 10) => ({
  index: name.toLowerCase().replace(/[^a-z]+/g, '-'), name, skills, tools, languages, feature: { name: feature, desc: '' }, equipment: bgItems(equipment), gold,
});
const acolyte = Backgrounds[0];
const backgrounds = [
  { index: 'acolyte', name: 'Acolyte', skills: acolyte.starting_proficiencies.map((p) => skillName(p.name)), tools: [], languages: 2, feature: { name: acolyte.feature.name, desc: text(acolyte.feature.desc) }, equipment: bgItems('Holy symbol, prayer book or wheel, 5 sticks of incense, vestments, common clothes, pouch'), gold: 15 },
  bg('Charlatan', ['Deception', 'Sleight of Hand'], ['Disguise kit', 'Forgery kit'], 0, 'False Identity', 'Fine clothes, disguise kit, con tools', 15),
  bg('Criminal', ['Deception', 'Stealth'], ['One gaming set', "Thieves' tools"], 0, 'Criminal Contact', 'Crowbar, dark common clothes with hood, pouch', 15),
  bg('Entertainer', ['Acrobatics', 'Performance'], ['Disguise kit', 'One musical instrument'], 0, 'By Popular Demand', 'Musical instrument, favor of an admirer, costume, pouch', 15),
  bg('Folk Hero', ['Animal Handling', 'Survival'], ["One artisan's tools", 'Vehicles (land)'], 0, 'Rustic Hospitality', "Artisan's tools, shovel, iron pot, common clothes, pouch", 10),
  bg('Guild Artisan', ['Insight', 'Persuasion'], ["One artisan's tools"], 1, 'Guild Membership', "Artisan's tools, letter of introduction from your guild, traveler's clothes, pouch", 15),
  bg('Hermit', ['Medicine', 'Religion'], ['Herbalism kit'], 1, 'Discovery', 'Scroll case of notes, winter blanket, common clothes, herbalism kit', 5),
  bg('Noble', ['History', 'Persuasion'], ['One gaming set'], 1, 'Position of Privilege', 'Fine clothes, signet ring, scroll of pedigree, purse', 25),
  bg('Outlander', ['Athletics', 'Survival'], ['One musical instrument'], 1, 'Wanderer', "Staff, hunting trap, trophy from an animal, traveler's clothes, pouch", 10),
  bg('Sage', ['Arcana', 'History'], [], 2, 'Researcher', 'Bottle of black ink, quill, small knife, letter from a dead colleague, common clothes, pouch', 10),
  bg('Sailor', ['Athletics', 'Perception'], ["Navigator's tools", 'Vehicles (water)'], 0, "Ship's Passage", 'Belaying pin (club), 50 feet of silk rope, lucky charm, common clothes, pouch', 10),
  bg('Soldier', ['Athletics', 'Intimidation'], ['One gaming set', 'Vehicles (land)'], 0, 'Military Rank', 'Insignia of rank, trophy from a fallen enemy, bone dice or deck of cards, common clothes, pouch', 10),
  bg('Urchin', ['Sleight of Hand', 'Stealth'], ['Disguise kit', "Thieves' tools"], 0, 'City Secrets', 'Small knife, map of your home city, pet mouse, token from your parents, common clothes, pouch', 10),
];

// ---------- feats (SRD: Grappler; PHB names for reference) ----------
// PHB feats: short summaries in our own words (the PHB has the full text). `asi` = "+1 to one of these",
// other keys are effects the app applies when the feat is taken (see applyLevel).
const PHB_FEATS = {
  Alert: { desc: '+5 to initiative. You can\'t be surprised while conscious, and creatures you can\'t see don\'t gain advantage on attacks against you.', initiative: 5 },
  Athlete: { desc: 'Standing up from prone costs only 5 ft of movement, climbing costs no extra movement, and running jumps need only a 5 ft run-up.', asi: ['str', 'dex'] },
  Actor: { desc: 'Advantage on Deception and Performance checks while passing yourself off as someone else; you can mimic voices and sounds you have heard.', asi: ['cha'] },
  Charger: { desc: 'When you Dash, you can use a bonus action for one melee attack (+5 damage if you moved 10+ ft in a straight line) or a 10 ft shove.' },
  'Crossbow Expert': { desc: 'Ignore the loading property of crossbows, no disadvantage on ranged attacks with an enemy within 5 ft, and a bonus-action hand crossbow attack after attacking with a one-handed weapon.' },
  'Defensive Duelist': { desc: 'Prerequisite: DEX 13. While wielding a finesse weapon, use your reaction when hit by a melee attack to add your proficiency bonus to AC against it.' },
  'Dual Wielder': { desc: '+1 AC while holding a melee weapon in each hand; two-weapon fighting works with any one-handed weapons; draw or stow two weapons at once.' },
  'Dungeon Delver': { desc: 'Advantage on checks to find secret doors and on saves against traps, resistance to trap damage, and you can search for traps at normal pace.' },
  Durable: { desc: 'When you spend a hit die to heal, you regain at least twice your CON modifier (minimum 2).', asi: ['con'] },
  'Elemental Adept': { desc: 'Prerequisite: spellcasting. Pick acid, cold, fire, lightning or thunder: your spells ignore resistance to it and treat 1s on its damage dice as 2s.' },
  'Great Weapon Master': { desc: 'After a melee crit or dropping a creature to 0 HP, make a bonus-action melee attack. With a heavy weapon you may take -5 to hit for +10 damage.' },
  Healer: { desc: 'Stabilising with a healer\'s kit also restores 1 HP. As an action, a kit use heals 1d6 + 4 + the target\'s number of hit dice (once per creature per rest).' },
  'Heavily Armored': { desc: 'Prerequisite: medium armor proficiency. Gain heavy armor proficiency.', asi: ['str'], armor: 'Heavy armor' },
  'Heavy Armor Master': { desc: 'Prerequisite: heavy armor proficiency. In heavy armor, nonmagical bludgeoning, piercing and slashing damage you take is reduced by 3.', asi: ['str'] },
  'Inspiring Leader': { desc: 'Prerequisite: CHA 13. A 10-minute speech gives up to six creatures temporary HP equal to your level + CHA modifier (once per rest each).' },
  'Keen Mind': { desc: 'You always know which way is north and the hours to sunrise/sunset, and can recall anything you saw or heard in the past month.', asi: ['int'] },
  'Lightly Armored': { desc: 'Gain light armor proficiency.', asi: ['str', 'dex'], armor: 'Light armor' },
  Linguist: { desc: 'Learn three languages and create written ciphers others need an Intelligence check to crack.', asi: ['int'] },
  Lucky: { desc: '3 luck points per long rest: spend one to roll an extra d20 on an attack, check or save (pick which die counts), or on an attack against you.', resource: { name: 'Luck points', max: 3, recharge: 'long' } },
  'Mage Slayer': { desc: 'Reaction melee attack when a creature within 5 ft casts a spell; creatures you damage have disadvantage on concentration saves; advantage on saves vs spells cast within 5 ft.' },
  'Magic Initiate': { desc: 'Pick bard, cleric, druid, sorcerer, warlock or wizard: learn two of its cantrips and one 1st-level spell you can cast once per long rest.' },
  'Martial Adept': { desc: 'Learn two Battle Master maneuvers and gain one d6 superiority die (regained on a short or long rest).', resource: { name: 'Superiority die (d6)', max: 1, recharge: 'short' } },
  'Medium Armor Master': { desc: 'Prerequisite: medium armor proficiency. Medium armor no longer gives stealth disadvantage, and its DEX cap rises to +3.' },
  Mobile: { desc: '+10 ft speed; Dash ignores difficult terrain; a creature you attack in melee can\'t make opportunity attacks against you that turn.', speed: 10 },
  'Moderately Armored': { desc: 'Prerequisite: light armor proficiency. Gain medium armor and shield proficiency.', asi: ['str', 'dex'], armor: 'Medium armor, Shields' },
  'Mounted Combatant': { desc: 'While mounted: advantage on melee attacks vs smaller unmounted creatures, redirect attacks from your mount to you, and your mount takes less damage from DEX-save effects.' },
  Observant: { desc: 'Read lips, and +5 to your passive Perception and passive Investigation.', asi: ['int', 'wis'] },
  'Polearm Master': { desc: 'Bonus-action d4 attack with the butt of a glaive, halberd, quarterstaff or spear, and opportunity attacks when creatures enter your reach.' },
  Resilient: { desc: 'Gain proficiency in saving throws of the ability you raise.', asi: ['str', 'dex', 'con', 'int', 'wis', 'cha'], save: true },
  'Ritual Caster': { desc: 'Prerequisite: INT or WIS 13. Gain a ritual book with two 1st-level ritual spells from one class and cast them as rituals; copy more you find.' },
  'Savage Attacker': { desc: 'Once per turn, reroll a melee weapon\'s damage dice and use either total.' },
  Sentinel: { desc: 'Your opportunity attacks stop a creature\'s movement, Disengage doesn\'t avoid them, and you can react to attack a creature within 5 ft that attacks someone else.' },
  Sharpshooter: { desc: 'No disadvantage at long range, ranged weapon attacks ignore half and three-quarters cover, and you may take -5 to hit for +10 damage.' },
  'Shield Master': { desc: 'Bonus-action shove with your shield after attacking, add the shield\'s AC to DEX saves vs effects aimed only at you, and take no damage on a successful DEX save.' },
  Skilled: { desc: 'Gain proficiency in any combination of three skills or tools.' },
  Skulker: { desc: 'Prerequisite: DEX 13. Hide when only lightly obscured, missing a ranged attack doesn\'t reveal you, and dim light doesn\'t hinder your Perception.' },
  'Spell Sniper': { desc: 'Prerequisite: spellcasting. Double the range of attack-roll spells, ignore half and three-quarters cover with them, and learn one attack cantrip.' },
  'Tavern Brawler': { desc: 'Proficiency with improvised weapons, d4 unarmed strikes, and a bonus-action grapple after hitting with an unarmed strike or improvised weapon.', asi: ['str', 'con'] },
  Tough: { desc: 'Your hit point maximum increases by 2 for every level you have, now and later.', hp_per_level: 2 },
  'War Caster': { desc: 'Prerequisite: spellcasting. Advantage on concentration saves, somatic components with your hands full, and cast a spell as an opportunity attack.' },
  'Weapon Master': { desc: 'Gain proficiency with four weapons of your choice.', asi: ['str', 'dex'] },
};
const feats = [...Feats.map((f) => ({ name: f.name, desc: text(f.desc) })), ...Object.entries(PHB_FEATS).map(([name, f]) => ({ name, ...f, phb: true }))].sort((a, b) => a.name.localeCompare(b.name));

const dmgOf = (s) => (Array.isArray(s.damage) ? s.damage[0] : s.damage); // newer dataset versions use an array
const spells = Spells.map((s) => ({
  index: s.index, name: s.name, level: s.level, school: s.school.name, casting_time: s.casting_time, range: s.range,
  components: s.components.join(', '), material: s.material || '', duration: s.duration, concentration: !!s.concentration,
  ritual: !!s.ritual, classes: s.classes.map((c) => c.index), desc: text(s.desc), higher_level: text(s.higher_level),
  ...(s.attack_type ? { attack: s.attack_type } : {}),
  ...(s.dc ? { save: s.dc.dc_type.index, save_success: s.dc.dc_success } : {}),
  ...(dmgOf(s)?.damage_type ? { damage_type: dmgOf(s).damage_type.name } : {}),
  ...(dmgOf(s)?.damage_at_slot_level ? { damage_slot: dmgOf(s).damage_at_slot_level } : {}),
  ...(dmgOf(s)?.damage_at_character_level ? { damage_char: dmgOf(s).damage_at_character_level } : {}),
  ...(s.heal_at_slot_level ? { heal_slot: s.heal_at_slot_level } : {}),
}));

// ---------- equipment catalog ----------
const cost = (c) => (c ? `${c.quantity} ${c.unit}` : '');
const KIND = (e) => {
  const c = e.equipment_category?.index;
  if (c === 'weapon') return 'Weapon';
  if (c === 'armor') return e.armor_category === 'Shield' ? 'Shield' : 'Armor';
  if (c === 'tools') return 'Tool';
  if (c === 'mounts-and-vehicles') return 'Mount/Vehicle';
  if (e.gear_category?.index === 'equipment-packs') return 'Pack';
  if (e.gear_category?.index === 'ammunition') return 'Ammunition';
  if (['arcane-foci', 'druidic-foci', 'holy-symbols'].includes(e.gear_category?.index)) return 'Focus';
  return 'Gear';
};
const items = Equipment.map((e) => ({
  index: e.index, name: e.name, kind: KIND(e),
  sub: e.category_range || (e.armor_category && e.armor_category !== 'Shield' ? `${e.armor_category} armor` : '') || e.gear_category?.name || e.tool_category || e.vehicle_category || '',
  cost: cost(e.cost), weight: e.weight ?? null,
  ...(e.desc?.length ? { desc: text(e.desc) } : {}),
  ...(e.damage ? { damage: `${e.damage.damage_dice} ${e.damage.damage_type.name.toLowerCase()}` } : {}),
  ...(e.two_handed_damage ? { versatile: `${e.two_handed_damage.damage_dice} ${e.two_handed_damage.damage_type.name.toLowerCase()}` } : {}),
  ...(e.range && e.weapon_range === 'Ranged' ? { range: `${e.range.normal}/${e.range.long} ft` } : {}),
  ...(e.throw_range ? { thrown: `${e.throw_range.normal}/${e.throw_range.long} ft` } : {}),
  ...(e.properties?.length ? { properties: e.properties.map((p) => p.name) } : {}),
  ...(e.special?.length ? { special: text(e.special) } : {}),
  ...(e.armor_class ? { ac: { base: e.armor_class.base, dex: !!e.armor_class.dex_bonus, max_dex: e.armor_class.max_bonus ?? null } } : {}),
  ...(e.str_minimum ? { str_min: e.str_minimum } : {}),
  ...(e.stealth_disadvantage ? { stealth_dis: true } : {}),
  ...(e.contents?.length ? { contents: e.contents.map((c) => ({ index: c.item.index, qty: c.quantity })) } : {}),
  ...(e.quantity > 1 ? { bundle: e.quantity } : {}),
}));
const KEEP_CATS = ['simple-weapons', 'martial-weapons', 'simple-melee-weapons', 'simple-ranged-weapons', 'martial-melee-weapons', 'martial-ranged-weapons',
  'light-armor', 'medium-armor', 'heavy-armor', 'shields', 'artisans-tools', 'gaming-sets', 'musical-instruments', 'arcane-foci', 'druidic-foci', 'holy-symbols', 'equipment-packs', 'kits'];
const equipment_categories = Object.fromEntries(EquipmentCategories.filter((c) => KEEP_CATS.includes(c.index)).map((c) => [c.index, { name: c.name, items: c.equipment.map((x) => x.index) }]));
const weapon_properties = Object.fromEntries(WeaponProperties.map((p) => [p.name, text(p.desc)]));
const schools = Object.fromEntries(MagicSchools.map((m) => [m.name, m.desc]));

const weapons = Equipment.filter((e) => e.equipment_category?.index === 'weapon').map((w) => ({
  name: w.name, category: w.category_range, damage: w.damage ? `${w.damage.damage_dice} ${w.damage.damage_type.name.toLowerCase()}` : '',
  properties: (w.properties || []).map((p) => p.name),
}));
const armor = Equipment.filter((e) => e.equipment_category?.index === 'armor').map((a) => ({
  name: a.name, category: a.armor_category, base: a.armor_class.base, dex: a.armor_class.dex_bonus, max_dex: a.armor_class.max_bonus ?? null,
}));

const out = {
  source: 'SRD 5.1 via 5e-bits/5e-database (OGL 1.0a) + PHB 2014 name supplements',
  skills: Skills.map((s) => ({ name: s.name, ability: s.ability_score.index, desc: text(s.desc) })),
  languages: Languages.map((l) => l.name),
  conditions: Conditions.map((c) => ({ name: c.name, desc: text(c.desc) })),
  races, classes, backgrounds, feats, spells, weapons, armor, items, equipment_categories, weapon_properties, schools,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB): ${classes.length} classes, ${races.length} races, ${spells.length} spells`);
