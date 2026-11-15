import { test } from 'node:test';
import assert from 'node:assert/strict';
import srd from '../server/data/srd.json' with { type: 'json' };
import { applyAction, blankCharacter, durationSeconds } from '../shared/rules.js';
import { classGear, backgroundGear, expandItems, armorClass, weaponAttack, totalWeight } from '../shared/items.js';
import { buildLevelOne, finishCharacter } from '../web/src/lib/character.js';
import { repairWords, buildVocab, parsePhbSpells } from '../server/phbSpells.js';

const fighter = srd.classes.find((c) => c.index === 'fighter');

test('starting equipment is structured choices, not text', () => {
  assert.equal(fighter.starting_choices.length, 4);
  assert.ok(fighter.starting_choices[0].options[1].items.some((i) => i.index === 'longbow'));
  // (b) leather armor, longbow, 20 arrows + (a) martial weapon & shield with a picked longsword
  const gear = classGear(srd, fighter, { gear: { 0: 1, 1: 0, 2: 1, 3: 1 }, gearPicks: { '1.0': ['longsword'] } });
  assert.deepEqual(gear.map((g) => g.index), ['leather-armor', 'longbow', 'arrow', 'longsword', 'shield', 'handaxe', 'explorers-pack']);
  const items = expandItems(srd, gear);
  assert.ok(!items.some((i) => i.index === 'explorers-pack'), 'packs are unpacked');
  assert.equal(items.find((i) => i.index === 'torch').qty, 10);
  assert.ok(backgroundGear(srd, srd.backgrounds.find((b) => b.index === 'acolyte')).some((i) => i.index === 'vestments'));
});

test('AC and attacks come from worn gear', () => {
  const d = { ...blankCharacter(), abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, classes: [{ index: 'fighter', level: 1 }],
    equipment: [{ index: 'scale-mail', name: 'Scale Mail', qty: 1, equipped: true }, { index: 'shield', name: 'Shield', qty: 1, equipped: true }] };
  assert.equal(armorClass(d, srd).ac, 14 + 2 + 2, 'medium armor caps DEX at +2, shield +2');
  d.equipment[0].equipped = false;
  assert.equal(armorClass(d, srd).ac, 10 + 2 + 2);
  const atk = weaponAttack(srd.items.find((i) => i.index === 'rapier'), d);
  assert.deepEqual([atk.bonus, atk.damage], ['+5', '1d8+3 piercing'], 'finesse uses the better of STR/DEX');
  assert.equal(totalWeight({ equipment: [{ index: 'arrow', qty: 20 }, { name: 'rock', qty: 2, weight: 3 }] }, srd), 1 + 6);
});

test('builder: gear, AC and racial skill proficiencies', () => {
  const d = finishCharacter(srd, buildLevelOne(srd, { race: 'elf', subrace: 'high-elf', class: 'fighter', background: 'soldier', base: { str: 15, dex: 14, con: 13, int: 10, wis: 12, cha: 8 },
    gear: { 0: 0 }, gearPicks: { '1.0': ['longsword'] }, skills: [], raceSkills: [] }));
  assert.equal(d.skills.Perception, 'prof', 'Keen Senses');
  assert.equal(d.ac, 18, 'chain mail + shield (default option a of choice 2)');
  assert.ok(d.attacks.some((a) => a.name === 'Longsword'));
  const gold = buildLevelOne(srd, { class: 'fighter', background: 'soldier', gearMode: 'gold', startingGold: 120 });
  assert.equal(gold.coins.gp, 130);
  assert.ok(!gold.equipment.some((e) => e.index === 'chain-mail'));
});

test('cast_spell spends the slot and tracks concentration', () => {
  let d = { ...blankCharacter(), spellcasting: { ability: 'wis', slots: [3, 2, 0, 0, 0, 0, 0, 0, 0].map((max) => ({ max, used: 0 })), pact: null },
    spells: [{ name: 'Bless', level: 1, concentration: true, duration: 'Up to 1 minute' }, { name: 'Cure Wounds', level: 1, duration: 'Instantaneous' }] };
  let r = applyAction(d, { type: 'cast_spell', spell: 'Bless', level: 2 });
  assert.equal(r.data.spellcasting.slots[1].used, 1);
  assert.deepEqual(r.data.effects.map((e) => [e.name, e.remaining, e.concentration]), [['Bless (L2)', 60, true]]);
  r = applyAction(r.data, { type: 'cast_spell', spell: 'Cure Wounds', level: 1 });
  assert.equal(r.data.spellcasting.slots[0].used, 1);
  assert.equal(r.data.effects.length, 1, 'instantaneous spells add no effect');
  r = applyAction(r.data, { type: 'cast_spell', spell: 'Detect Magic', level: 1, ritual: true, concentration: true, duration: '10 minutes' });
  assert.equal(r.data.spellcasting.slots[0].used, 1, 'rituals use no slot');
  assert.deepEqual(r.data.effects.map((e) => e.name), ['Detect Magic'], 'new concentration replaces the old');
  assert.equal(durationSeconds('Concentration, up to 8 hours'), 28800);
  assert.equal(durationSeconds('Instantaneous'), null);
});

test('PHB OCR text is repaired and parsed', () => {
  const vocab = buildVocab(['when you use a curse with the creature and choose one bonus action the hex spell']);
  assert.equal(repairWords('W h en you u se a cu rse w ith', vocab), 'When you use a curse with');
  const txt = ['H ex', '', '1st-level enchantment', 'Casting Tim e: 1 bon u s action', 'Range: 9 0 feet', 'Components: V, S, M (the petrified', 'eye of a newt)',
    'Duration: Concentration, up to 1 hour', 'You place a cu rse on a creature.', 'A t Higher Levels. W h en you use a', 'slot of 3rd level...'].join('\n');
  const [s] = parsePhbSpells(txt, buildVocab([...vocab.keys(), 'place on at higher levels slot level of eye newt petrified range feet']));
  assert.equal(s.name, 'Hex');
  assert.deepEqual([s.level, s.school, s.casting_time, s.range, s.components, s.material, s.concentration, s.duration], [1, 'Enchantment', '1 bonus action', '90 feet', 'V, S, M', 'the petrified eye of a newt', true, 'up to 1 hour']);
  assert.equal(s.desc, 'You place a curse on a creature.');
  assert.match(s.higher_level, /^When you use a slot/);
  assert.deepEqual(s.classes, ['warlock']);
});

test('feats and feature options are applied, not just named', async () => {
  const { applyLevel } = await import('../web/src/lib/character.js');
  let d = buildLevelOne(srd, { race: 'human', class: 'fighter', background: 'soldier', base: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 8 }, featureChoices: { 'Fighting Style': 'Defense' } });
  assert.match(d.features.find((f) => f.name.startsWith('Fighting Style')).desc, /Defense: While you are wearing armor/);
  for (let i = 0; i < 3; i++) d = applyLevel(srd, d, { class: 'fighter', hp: 6 });
  const hp = d.hp.max;
  d = applyLevel(srd, d, { class: 'fighter', hp: 6, asi: { mode: 'feat', feat: 'Tough' } });
  assert.equal(d.hp.max, hp + 2 * 4 + (6 + 2 + 2), 'Tough: +2 for the 4 earlier levels and +2 on the new one');
  d = applyLevel(srd, d, { class: 'fighter', hp: 6 });
  d = applyLevel(srd, d, { class: 'fighter', hp: 6, asi: { mode: 'feat', feat: 'Resilient', ability: 'wis' } });
  assert.equal(d.abilities.wis, 14, 'human 12+1, Resilient +1');
  assert.ok(d.saves.includes('wis'));
  assert.ok(srd.feats.every((f) => f.desc), 'every feat has a description');
  let w = buildLevelOne(srd, { class: 'warlock', subclass: 'fiend', background: 'sage' });
  w = applyLevel(srd, w, { class: 'warlock', hp: 5, featureChoices: { 'Eldritch Invocations': ['Agonizing Blast', 'Devil\'s Sight'] } });
  assert.ok(w.features.some((f) => f.name === "Eldritch Invocations: Agonizing Blast, Devil's Sight"));
});

test('custom items: weapons get damage, armor and shields drive AC, consumables group', async () => {
  const { itemOf, armorClass, weaponAttack, groupKind, findItem } = await import('../shared/items.js');
  const srd = JSON.parse((await import('node:fs')).readFileSync(new URL('../server/data/srd.json', import.meta.url)));
  const sword = itemOf(srd, { name: 'Moonblade', category: 'Weapon', weapon_type: 'Martial Melee', damage: '1d8', damage_type: 'radiant', properties: ['Finesse'] });
  assert.equal(sword.kind, 'Weapon');
  assert.equal(sword.damage, '1d8 radiant');
  const d = { abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 }, classes: [{ index: 'fighter', level: 1 }], features: [], equipment: [] };
  assert.equal(weaponAttack(sword, d).damage, '1d8+3 radiant', 'finesse uses DEX');
  d.equipment = [
    { name: 'Dragonscale', category: 'Armor', armor_type: 'Medium armor', ac_base: 15, equipped: true },
    { name: 'Tower shield', category: 'Shield', ac_base: 3, equipped: true },
  ];
  assert.equal(armorClass(d, srd).ac, 15 + 2 + 3, 'medium armor caps DEX at 2, custom shield bonus');
  d.equipment[0].armor_type = 'Heavy armor';
  assert.equal(armorClass(d, srd).ac, 15 + 3);
  assert.equal(itemOf(srd, { name: 'Lucky coin' }).kind, 'Custom', 'uncategorised custom items are flavour items');
  assert.equal(itemOf(srd, { name: 'Potion', category: 'Consumable' }).kind, 'Consumable');
  assert.equal(groupKind(findItem(srd, 'rations-1-day')), 'Consumable');
});
