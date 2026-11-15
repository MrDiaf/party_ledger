// Character construction shared by the builder wizard and the sheet's level-up flow.
import { blankCharacter, normalizeCharacter, mod, hpAverage, suggestedSlots, suggestedResources, totalLevel, ABILITIES } from '../../../shared/rules.js';
import { classGear, backgroundGear, expandItems, findItem, weaponAttack, weaponProficient, armorClass } from '../../../shared/items.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
export const findClass = (srd, idx) => srd.classes.find((c) => c.index === idx);
export const findRace = (srd, idx) => srd.races.find((r) => r.index === idx);

/** Racial ability bonuses (race + subrace + chosen, e.g. Half-Elf +1/+1). */
export function racialBonuses(srd, draft) {
  const out = Object.fromEntries(ABILITIES.map((a) => [a, 0]));
  const race = findRace(srd, draft.race);
  const sub = race?.subraces.find((s) => s.index === draft.subrace);
  for (const src of [race?.ability_bonuses, sub?.ability_bonuses]) for (const [a, n] of Object.entries(src || {})) out[a] += n;
  for (const a of draft.raceAbilityChoice || []) out[a] += 1;
  return out;
}

export function maxSpellLevel(data) {
  const s = data.spellcasting;
  let max = 0;
  s.slots.forEach((x, i) => { if (x.max > 0) max = i + 1; });
  return Math.max(max, s.pact?.level || 0);
}

/** Merge freshly suggested class resources into existing ones, keeping usage and custom entries. */
function mergeResources(d, srd) {
  const fresh = suggestedResources(d, srd);
  const keep = d.resources.filter((r) => !r.key || !fresh.some((f) => f.key === r.key));
  d.resources = [...fresh.map((f) => ({ ...f, used: d.resources.find((r) => r.key === f.key)?.used || 0 })), ...keep.filter((r) => !r.key || !r.key.includes(':'))];
}

function refreshSlots(d, srd) {
  const s = suggestedSlots(d.classes, srd);
  d.spellcasting.slots = s.slots.map((max, i) => ({ max, used: Math.min(d.spellcasting.slots[i]?.used || 0, max) }));
  d.spellcasting.pact = s.pact ? { ...s.pact, used: Math.min(d.spellcasting.pact?.used || 0, s.pact.max) } : null;
  if (!d.spellcasting.ability) d.spellcasting.ability = d.classes.map((c) => findClass(srd, c.index)?.spellcasting_ability).find(Boolean) || null;
}

function spellEntry(srd, name) {
  const s = srd.spells.find((x) => x.name === name);
  return s
    ? { name: s.name, level: s.level, prepared: true, concentration: s.concentration, ritual: s.ritual, casting_time: s.casting_time, range: s.range, components: s.components, duration: s.duration, notes: '' }
    : { name, level: 0, prepared: true, concentration: false, ritual: false, casting_time: '', range: '', components: '', duration: '', notes: '' };
}

function addSpells(d, srd, names = []) {
  for (const n of names) if (!d.spells.some((s) => s.name === n)) d.spells.push(spellEntry(srd, n));
}

const picksOf = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Features gained at a level; `choices` maps feature name → chosen option (or options, e.g. invocations). */
function featuresFor(srd, classIdx, subclassIdx, level, choices = {}) {
  const def = findClass(srd, classIdx);
  const sub = def?.subclasses.find((s) => s.index === subclassIdx);
  const out = [];
  const add = (f, source) => {
    const picks = picksOf(choices[f.name]);
    const opts = picks.map((p) => f.options?.find((o) => o.name === p)).filter(Boolean);
    out.push({ name: picks.length ? `${f.name}: ${picks.join(', ')}` : f.name, source, desc: [f.desc, ...opts.map((o) => `${o.name}: ${o.desc}`)].join('\n\n') });
  };
  for (const f of def?.levels[level]?.features || []) add(f, `${def.name} ${level}`);
  for (const f of sub?.levels?.[level] || []) add(f, `${sub.name} ${level}`);
  return out;
}

/** How many options a feature lets you pick at this class level (invocations, metamagic), default 1. */
export function optionCount(srd, classIdx, level, featureName) {
  const cs = findClass(srd, classIdx)?.levels[level]?.class_specific || {};
  if (/Eldritch Invocations/.test(featureName)) return cs.invocations_known || 2;
  if (/Metamagic/.test(featureName)) return cs.metamagic_known || 2;
  return 1;
}

/** Apply what a feat gives that the sheet can track (ability +1, save, HP, speed, initiative, armor, resource). */
function applyFeat(srd, d, featName, ability) {
  const f = srd.feats.find((x) => x.name === featName);
  d.feats.push({ name: featName, desc: f?.desc || 'See the PHB feat description.' });
  if (!f) return;
  const ab = ability && f.asi?.includes(ability) ? ability : f.asi?.length === 1 ? f.asi[0] : null;
  if (ab) d.abilities[ab] = (Number(d.abilities[ab]) || 10) + 1;
  if (f.save && ab && !d.saves.includes(ab)) d.saves.push(ab);
  if (f.initiative) d.initiative_bonus = (Number(d.initiative_bonus) || 0) + f.initiative;
  if (f.speed) d.speed = (Number(d.speed) || 30) + f.speed;
  if (f.armor) for (const a of f.armor.split(/,\s*/)) if (!d.proficiencies.armor.includes(a)) d.proficiencies.armor.push(a);
  if (f.resource && !d.resources.some((r) => r.name === f.resource.name)) d.resources.push({ ...f.resource, used: 0 });
  return f;
}

/** Suggested AC from worn armor/shield, or unarmored (Unarmored Defense for barbarian/monk). */
export function suggestedAc(d, srd) {
  return armorClass(d, srd).ac;
}

/** Level-1 character from the wizard draft (before any level-ups). */
export function buildLevelOne(srd, draft) {
  const d = blankCharacter();
  const race = findRace(srd, draft.race);
  const sub = race?.subraces.find((s) => s.index === draft.subrace);
  const cls = findClass(srd, draft.class);
  const bg = srd.backgrounds.find((b) => b.index === draft.background);
  const bonus = racialBonuses(srd, draft);

  d.name = draft.name || '';
  d.race = race ? { index: race.index, name: race.name } : null;
  d.subrace = sub ? { index: sub.index, name: sub.name } : null;
  d.background = bg ? { index: bg.index, name: bg.name } : draft.customBackground ? { index: 'custom', name: draft.customBackground } : null;
  d.speed = sub?.speed || race?.speed || 30;
  d.size = race?.size || 'Medium';
  d.abilities = Object.fromEntries(ABILITIES.map((a) => [a, (Number(draft.base?.[a]) || 10) + bonus[a]]));
  d.traits = [...(race?.traits || []), ...(sub?.traits || [])].map((t) => ({ name: t.name, desc: t.desc }));
  d.proficiencies.languages = [...(race?.languages || []), ...(draft.languages || []).filter(Boolean)];
  d.proficiencies.tools = [...(bg?.tools || []), ...(draft.tools || []).filter(Boolean)];
  for (const p of [...(race?.proficiencies || []), ...(sub?.proficiencies || [])]) {
    if (/^Skill: /.test(p)) d.skills[p.replace(/^Skill: /, '')] = 'prof'; // e.g. elves' Keen Senses (Perception)
    else (/armor/i.test(p) ? d.proficiencies.armor : /tools|kit|supplies/i.test(p) ? d.proficiencies.tools : d.proficiencies.weapons).push(p);
  }
  for (const s of [...(draft.skills || []), ...(draft.raceSkills || []), ...(draft.bgSkills ?? bg?.skills ?? [])]) d.skills[s] = 'prof';
  for (const s of draft.expertise || []) d.skills[s] = 'expert';
  if (bg) d.features.push({ name: `Background: ${bg.feature.name}`, source: bg.name, desc: bg.feature.desc || 'See the PHB background description.' });
  const gold = draft.gearMode === 'gold';
  d.equipment = expandItems(srd, [...(gold ? [] : classGear(srd, cls, draft)), ...backgroundGear(srd, bg)]);
  d.coins.gp = (bg?.gold || 0) + (gold ? Number(draft.startingGold) || 0 : 0);
  Object.assign(d, {
    alignment: draft.alignment || '', appearance: draft.appearance || '', backstory: draft.backstory || '', allies: draft.allies || '',
    notes: draft.notes || '', portrait: draft.portrait || '',
    personality: { traits: draft.traits || '', ideals: draft.ideals || '', bonds: draft.bonds || '', flaws: draft.flaws || '' },
  });

  if (cls) {
    const sc = cls.subclasses.find((s) => s.index === draft.subclass);
    d.classes = [{ index: cls.index, name: cls.name, level: 1, hit_die: cls.hit_die, subclass: sc?.index || '', subclass_name: sc?.name || '' }];
    d.saves = [...cls.saves];
    for (const p of cls.proficiencies) (/armor|shield/i.test(p) ? d.proficiencies.armor : /weapon|sword|bow|crossbow|dagger|dart|sling|staff|club|mace|spear|javelin|sickle|scimitar|rapier|hammer|axe|flail|whip|pike|halberd|glaive|lance|trident|morningstar|maul|blowgun|net/i.test(p) ? d.proficiencies.weapons : d.proficiencies.tools).push(p);
    d.hit_dice = { [`d${cls.hit_die}`]: { total: 1, used: 0 } };
    const hp = Math.max(1, cls.hit_die + mod(d.abilities.con) + (draft.subrace === 'hill-dwarf' ? 1 : 0));
    d.hp = { max: hp, current: hp, temp: 0 };
    d.features.push(...featuresFor(srd, cls.index, sc?.index, 1, draft.featureChoices));
    d.spellcasting.ability = cls.spellcasting_ability;
    refreshSlots(d, srd);
    addSpells(d, srd, [...(draft.cantrips || []), ...(draft.spells || [])]);
    mergeResources(d, srd);
    d.level_log.push({ level: 1, class: cls.name, hp, note: 'Level 1' });
  }
  // Weapons in the pack become attack lines (recomputed with final scores in finishCharacter).
  d.attacks = weaponAttacks(srd, d);
  d.ac = suggestedAc(d, srd);
  return d;
}

function weaponAttacks(srd, d) {
  const seen = new Set();
  return d.equipment.map((e) => findItem(srd, e.index)).filter((it) => it?.kind === 'Weapon' && !seen.has(it.index) && seen.add(it.index))
    .map((it) => weaponAttack(it, d, weaponProficient(it, d)));
}

/** After all level-ups: refresh weapon attack bonuses and AC for the final ability scores. */
export function finishCharacter(srd, d) {
  const out = normalizeCharacter(clone(d));
  const custom = out.attacks.filter((a) => !a.index);
  out.attacks = [...weaponAttacks(srd, out), ...custom];
  out.ac = suggestedAc(out, srd);
  return out;
}

/**
 * Apply one level-up. choice = { class, hp (rolled/average die value), subclass?, asi?: {mode:'asi', plus:{str:1,...}} | {mode:'feat', feat},
 *   featureChoices?: {featureName: optionName}, spells?: [names] }.
 * Never refuses: unusual choices just produce unusual characters.
 */
export function applyLevel(srd, data, choice) {
  const d = normalizeCharacter(clone(data));
  const def = findClass(srd, choice.class);
  if (!def) return d;
  const before = totalLevel(d);
  let entry = d.classes.find((c) => c.index === def.index);
  if (!entry) {
    entry = { index: def.index, name: def.name, level: 0, hit_die: def.hit_die, subclass: '', subclass_name: '' };
    d.classes.push(entry);
  }
  entry.level += 1;
  const L = entry.level;

  // Ability Score Improvement / feat first: a CON increase raises HP for every previous level too (PHB p.177).
  const conBefore = mod(d.abilities.con);
  if (choice.asi?.mode === 'asi') for (const [a, n] of Object.entries(choice.asi.plus || {})) d.abilities[a] = (Number(d.abilities[a]) || 10) + Number(n || 0);
  const hadTough = d.feats.some((f) => f.name === 'Tough');
  if (choice.asi?.mode === 'feat' && choice.asi.feat) {
    const f = applyFeat(srd, d, choice.asi.feat, choice.asi.ability);
    // Tough: +2 HP for every level you already have (the new level's +2 is added below)
    if (f?.hp_per_level && !hadTough) { d.hp.max += f.hp_per_level * before; d.hp.current += f.hp_per_level * before; }
  }
  const conMod = mod(d.abilities.con);
  if (conMod !== conBefore) { d.hp.max += (conMod - conBefore) * before; d.hp.current += (conMod - conBefore) * before; }

  const tough = d.feats.some((f) => f.name === 'Tough') ? 2 : 0;
  const gain = Math.max(1, Number(choice.hp ?? hpAverage(def.hit_die)) + conMod + tough + (d.subrace?.index === 'hill-dwarf' ? 1 : 0));
  d.hp.max += gain;
  d.hp.current += gain;
  const die = `d${def.hit_die}`;
  d.hit_dice[die] = { total: (d.hit_dice[die]?.total || 0) + 1, used: d.hit_dice[die]?.used || 0 };

  if (choice.subclass) {
    const sc = def.subclasses.find((s) => s.index === choice.subclass);
    entry.subclass = choice.subclass;
    entry.subclass_name = sc?.name || choice.subclass;
    // Subclass chosen late (e.g. on import) — pull in its earlier features too.
    for (let l = 1; l < L; l++) for (const f of sc?.levels?.[l] || []) if (!d.features.some((x) => x.name === f.name)) d.features.push({ name: f.name, source: `${sc.name} ${l}`, desc: f.desc });
  }
  d.features.push(...featuresFor(srd, def.index, entry.subclass, L, choice.featureChoices));
  refreshSlots(d, srd);
  addSpells(d, srd, choice.spells);
  mergeResources(d, srd);
  d.level_log.push({
    level: before + 1, class: `${def.name} ${L}`, hp: gain,
    note: [choice.subclass && `subclass ${entry.subclass_name}`, choice.asi?.mode === 'asi' && `ASI ${Object.entries(choice.asi.plus || {}).filter(([, n]) => n).map(([a, n]) => `${a.toUpperCase()}+${n}`).join(' ')}`,
      choice.asi?.mode === 'feat' && `feat ${choice.asi.feat}${choice.asi.ability ? ` (+1 ${choice.asi.ability.toUpperCase()})` : ''}`, choice.spells?.length && `spells: ${choice.spells.join(', ')}`].filter(Boolean).join('; '),
  });
  return d;
}

/** What a given class level grants, for the level-up UI. */
export function levelInfo(srd, data, classIdx) {
  const def = findClass(srd, classIdx);
  if (!def) return null;
  const current = data.classes.find((c) => c.index === classIdx);
  const L = (current?.level || 0) + 1;
  const lvl = def.levels[L] || {};
  const subIdx = current?.subclass;
  const sub = def.subclasses.find((s) => s.index === subIdx);
  const prev = def.levels[L - 1] || {};
  return {
    def, level: L, isNewClass: !current,
    features: lvl.features || [],
    subclassFeatures: sub?.levels?.[L] || [],
    needsSubclass: L >= def.subclass_level && !subIdx,
    asi: !!lvl.asi,
    newCantrips: Math.max(0, (lvl.cantrips_known || 0) - (prev.cantrips_known || 0)),
    newSpellsKnown: lvl.spells_known != null ? Math.max(0, lvl.spells_known - (prev.spells_known || 0)) : null,
    isCaster: !!def.caster,
  };
}

/** Multiclass prerequisites (PHB p.163) — returns a warning string or ''. Not enforced. */
export function multiclassWarning(srd, data, classIdx) {
  const def = findClass(srd, classIdx);
  if (!def || data.classes.some((c) => c.index === classIdx) || !data.classes.length) return '';
  const fails = [];
  const check = (idx) => {
    const d = findClass(srd, idx);
    const req = d.multiclass_prereq || [];
    if (req.some((r) => (data.abilities[r.ability] || 0) < r.min)) fails.push(`${d.name} needs ${req.map((r) => `${r.ability.toUpperCase()} ${r.min}`).join(' and ')}`);
  };
  check(classIdx);
  for (const c of data.classes) check(c.index);
  return fails.length ? `PHB multiclass prerequisites not met: ${fails.join('; ')}. Allowed anyway.` : '';
}

export function spellsFor(srd, classIdx, maxLevel, minLevel = 0) {
  return srd.spells.filter((s) => s.classes.includes(classIdx) && s.level <= maxLevel && s.level >= minLevel);
}
