// Monster Manual parser on small synthetic, OCR-style stat blocks (no book text in the repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ocrNum, fixText, typeInfo, parseBlock, parseIndex, similarity } from '../server/monsterManual.js';

const L = (text, h = 9) => ({ text, h });

test('OCR numbers and text repair', () => {
  assert.equal(ocrNum('l7s'), 175);
  assert.equal(ocrNum('+I'), 1);
  assert.equal(ocrNum('-Z'), -2);
  assert.equal(ocrNum(']4'), 14);
  assert.equal(fixText('Hit:l0 (2d6 + 3) damage. lf the target'), 'Hit: 10 (2d6 + 3) damage. If the target');
});

test('type line is rebuilt from sizes, types and alignments', () => {
  assert.equal(typeInfo('La rge Co nstru ct, U n a I igned').type, 'Large Construct, Unaligned');
  assert.equal(typeInfo('Mediumor Small Humanoid, Neutrol Evil').type, 'Medium or Small Humanoid, Neutral Evil');
  assert.equal(typeInfo('Cargantuan Dragon (Chromatic), Chaotic Evtl').type, 'Gargantuan Dragon (Chromatic), Chaotic Evil');
});

test('stat block: AC, HP checked against its dice, scores, CR from XP, sections', () => {
  const m = parseBlock([
    L('Tesr BEAsr', 17), L('Large Monstrosity, Unaligned'), L("AC '14", 12), L('lnitiative +2 (12)'), L('HP l7s (27d8 + 5a)'), L('Speed 30 ft., Climb 30 ft.'),
    L('MOD SAVE', 6), L('Srn 18 +4 +4 Drx\'15 +2 +4', 14), L('lrr 3 -4 -4 Wts 12 +l +l', 14), L('Cor 16 +3 +3', 12), L('Cxr 7 -Z -2', 14),
    L('Skills Perception +3'), L('Senses Darkvision 60 ft.; Passive Perception 13'), L('Languages None'), L('CR l4 (XP 11,500; PB +5)'),
    L('AcrroNs', 11), L('Multiattack. The beast makes two Bite attacks.'), L('Bite. Melee Attack Roll: +7, reach 5 ft. Hit:l3 (2d8 + 4) Piercing'), L('damage.'),
    L('ReecrroNs', 10), L('Snap. The beast bites back.'),
  ]);
  assert.equal(m.ac, 14);
  assert.equal(m.initiative, 2);
  assert.equal(m.hp, 175, '27d8 + 54 averages 175');
  assert.equal(m.hp_dice, '27d8 + 54');
  assert.deepEqual(m.abilities, { str: 18, dex: 15, con: 16, int: 3, wis: 12, cha: 7 });
  assert.deepEqual(m.saves, { dex: 4 });
  assert.equal(m.cr, '14');
  assert.equal(m.xp, 11500);
  assert.equal(m.languages, 'None');
  assert.deepEqual(m.sections.map((s) => s.name), ['Actions', 'Reactions']);
  assert.equal(m.sections[0].entries[1].name, 'Bite');
  assert.match(m.sections[0].entries[1].text, /Hit: 13 \(2d8 \+ 4\) Piercing damage\.$/);
});

test('index of stat blocks: several columns per line, OCR digits in names and pages', () => {
  const idx = parseIndex('Aarakocra Skirmisher............. 10        Doppe19an9er........................... 100     Gray Oo2e.................................... I 51\nSea Hag ........................ 27 I');
  assert.deepEqual(idx, [
    { name: 'Aarakocra Skirmisher', page: 10 }, { name: 'Doppelganger', page: 100 }, { name: 'Gray Ooze', page: 151 }, { name: 'Sea Hag', page: 271 },
  ]);
  assert.ok(similarity('AurunrrD Ruc oF SMoTHERING', 'Animated Rug of Smothering') > similarity('AurunrrD Ruc oF SMoTHERING', 'Animated Armor'));
});
