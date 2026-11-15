import { test } from 'node:test';
import assert from 'node:assert/strict';
import srd from '../server/data/srd.json' with { type: 'json' };
import { roll4d6DropLowest, applyAction, blankCharacter, suggestedSlots, suggestedResources, derived, profBonus } from '../shared/rules.js';
import { sheetToCharacter } from '../server/importSheet.js';

const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('4d6 drop lowest', () => {
  // rolls 6,1,4,3 -> drop the 1 -> 13
  const r = roll4d6DropLowest(seq([5 / 6, 0, 3 / 6, 2 / 6]));
  assert.deepEqual(r.rolls, [6, 1, 4, 3]);
  assert.equal(r.dropIndex, 1);
  assert.equal(r.total, 13);
});

test('proficiency bonus and derived stats', () => {
  assert.deepEqual([1, 4, 5, 9, 13, 17, 20].map(profBonus), [2, 2, 3, 4, 5, 6, 6]);
  const d = { ...blankCharacter(), classes: [{ index: 'rogue', level: 5 }], abilities: { str: 8, dex: 16, con: 12, int: 10, wis: 14, cha: 10 }, skills: { Perception: 'expert' } };
  const x = derived(d);
  assert.equal(x.skills.Perception, 2 + 6);
  assert.equal(x.passive_perception, 18);
});

test('spell slots: single class table, multiclass table, pact magic', () => {
  assert.deepEqual(suggestedSlots([{ index: 'paladin', level: 5 }], srd).slots.slice(0, 3), [4, 2, 0]);
  // Wizard 3 + Paladin 4 = caster level 3 + 2 = 5 -> 4/3/2
  assert.deepEqual(suggestedSlots([{ index: 'wizard', level: 3 }, { index: 'paladin', level: 4 }], srd).slots.slice(0, 4), [4, 3, 2, 0]);
  assert.deepEqual(suggestedSlots([{ index: 'warlock', level: 5 }], srd).pact, { level: 3, max: 2 });
});

test('class resources', () => {
  const r = suggestedResources({ abilities: { cha: 16 }, classes: [{ index: 'barbarian', level: 3 }, { index: 'bard', level: 5 }] }, srd);
  assert.deepEqual(r.map((x) => [x.name, x.max, x.recharge]), [['Rage', 3, 'long'], ['Bardic Inspiration', 3, 'short']]);
});

test('damage, death saves, concentration, effects, rests', () => {
  let d = { ...blankCharacter(), hp: { max: 20, current: 5, temp: 3 }, hit_dice: { d10: { total: 4, used: 3 } }, classes: [{ level: 4 }],
    resources: [{ key: 'x', name: 'Action Surge', max: 1, used: 1, recharge: 'short' }, { key: 'y', name: 'Indomitable', max: 1, used: 1, recharge: 'long' }], exhaustion: 2 };
  d.spellcasting.slots[0] = { max: 3, used: 2 };
  let r = applyAction(d, { type: 'damage', amount: 6 });
  assert.equal(r.data.hp.current, 2);
  assert.equal(r.data.hp.temp, 0);
  r = applyAction(r.data, { type: 'damage', amount: 2 });
  assert.match(r.message, /unconscious/);
  r = applyAction(r.data, { type: 'damage', amount: 1 });
  assert.equal(r.data.death_saves.fail, 1);
  r = applyAction(r.data, { type: 'heal', amount: 4 });
  assert.equal(r.data.death_saves.fail, 0);
  r = applyAction(r.data, { type: 'add_effect', name: 'Bless', minutes: 1, concentration: true });
  r = applyAction(r.data, { type: 'add_effect', name: 'Hunter\'s Mark', minutes: 60, concentration: true });
  assert.deepEqual(r.data.effects.map((e) => e.name), ["Hunter's Mark"]);
  r = applyAction(r.data, { type: 'add_effect', name: 'Mage Armor', seconds: 8 * 3600 });
  r = applyAction(r.data, { type: 'advance_time', seconds: 3600 });
  assert.deepEqual(r.data.effects.map((e) => e.name), ['Mage Armor']);
  r = applyAction(r.data, { type: 'short_rest' });
  assert.equal(r.data.resources[0].used, 0);
  assert.equal(r.data.resources[1].used, 1);
  r = applyAction(r.data, { type: 'long_rest' });
  assert.equal(r.data.hp.current, 20);
  assert.equal(r.data.hit_dice.d10.used, 1, 'regain half level (2) hit dice');
  assert.equal(r.data.spellcasting.slots[0].used, 0);
  assert.equal(r.data.exhaustion, 1);
  assert.equal(r.data.effects.length, 0);
});

test('massive damage is flagged', () => {
  const d = { ...blankCharacter(), hp: { max: 10, current: 4, temp: 0 } };
  assert.match(applyAction(d, { type: 'damage', amount: 14 }).message, /instant death/);
});

test('sheet import maps to SRD entries', () => {
  const d = sheetToCharacter({ name: 'Mira', race: 'High Elf', subrace: 'High Elf', classes: [{ name: 'wizard', subclass: 'School of Evocation', level: 3 }], abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 }, spell_slots_total: [], skills: [{ name: 'Arcana (Int)', proficiency: 'prof' }] });
  assert.equal(d.classes[0].index, 'wizard');
  assert.equal(d.classes[0].hit_die, 6);
  assert.equal(d.spellcasting.ability, 'int');
  assert.deepEqual(d.spellcasting.slots.slice(0, 2).map((s) => s.max), [4, 2]);
  assert.equal(d.skills.Arcana, 'prof');
  assert.deepEqual(d.hit_dice, { d6: { total: 3, used: 0 } });
});
