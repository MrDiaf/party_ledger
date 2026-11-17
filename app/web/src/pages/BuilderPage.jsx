import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, loadRules, resizeImage } from '../api.js';
import { ErrorBox, ListInput, useAction, useApp, useLoad } from '../components/ui.jsx';
import { ABILITIES, ABILITY_NAMES, SKILLS, STANDARD_ARRAY, POINT_BUY_COST, roll4d6DropLowest, rollDie, mod, signed, derived } from '../../../shared/rules.js';
import { buildLevelOne, applyLevel, finishCharacter, findClass, findRace, racialBonuses, spellsFor } from '../lib/character.js';
import { STARTING_WEALTH, classGear, backgroundGear, expandItems, findItem, totalWeight } from '../../../shared/items.js';
import { ItemChip, KIND_ICON } from '../components/ItemInfo.jsx';
import LevelChoice from '../components/LevelChoice.jsx';
import { OptionCards, AlignmentPicker } from '../components/Choices.jsx';
import { optionCount } from '../lib/character.js';
import SpellPicker from '../components/SpellPicker.jsx';

const DRAFT_KEY = 'dnd.builder.draft';
const EMPTY = { step: 0, targetLevel: 1, method: 'roll', base: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, rolls: [], assign: {}, skills: [], raceSkills: [], raceAbilityChoice: [], levels: [], featureChoices: {}, cantrips: [], spells: [], languages: [], gear: {}, gearPicks: {}, gearMode: 'gear', startingGold: 0 };

const loadDraft = () => { try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(DRAFT_KEY)) }; } catch { return EMPTY; } };

function Bonus({ b }) {
  const e = Object.entries(b || {}).filter(([, n]) => n);
  return e.length ? <span className="small">{e.map(([a, n]) => `${a.toUpperCase()} +${n}`).join(', ')}</span> : null;
}

// ---------------- steps ----------------
function RaceStep({ srd, draft, set }) {
  const race = findRace(srd, draft.race);
  return (
    <div className="stack">
      <div className="grid cards">
        {srd.races.map((r) => (
          <button key={r.index} className={`choice-card ${draft.race === r.index ? 'selected' : ''}`} onClick={() => set({ race: r.index, subrace: r.subraces[0]?.index || null, raceAbilityChoice: [], raceSkills: [] })}>
            <div className="title">{r.name}</div>
            <div className="muted small">{r.size} · speed {r.speed} ft</div>
            <Bonus b={r.ability_bonuses} />{r.ability_bonus_choice && <span className="small"> + choose {r.ability_bonus_choice.choose}</span>}
          </button>
        ))}
      </div>
      {race && (
        <div className="card stack">
          <h2>{race.name}</h2>
          {race.subraces.length > 0 && (
            <div><label>Subrace</label>
              <div className="grid cards">
                {race.subraces.map((s) => (
                  <button key={s.index} className={`choice-card ${draft.subrace === s.index ? 'selected' : ''}`} onClick={() => set({ subrace: s.index })}>
                    <div className="title">{s.name}</div><Bonus b={s.ability_bonuses} />
                    <div className="muted small">{s.traits.map((t) => t.name).join(', ')}{s.phb ? ' · PHB' : ''}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {race.ability_bonus_choice && (
            <div><label>+1 to {race.ability_bonus_choice.choose} abilities of your choice</label>
              <div className="row">{race.ability_bonus_choice.from.map((a) => (
                <label key={a} className="inline"><input type="checkbox" checked={draft.raceAbilityChoice.includes(a)} onChange={(e) => set({ raceAbilityChoice: e.target.checked ? [...draft.raceAbilityChoice, a] : draft.raceAbilityChoice.filter((x) => x !== a) })} /> {ABILITY_NAMES[a]}</label>
              ))}</div>
            </div>
          )}
          {race.skill_choice && (
            <div><label>Choose {race.skill_choice.choose} skill proficiencies</label>
              <div className="row">{race.skill_choice.from.map((s) => (
                <label key={s} className="inline small"><input type="checkbox" checked={draft.raceSkills.includes(s)} onChange={(e) => set({ raceSkills: e.target.checked ? [...draft.raceSkills, s] : draft.raceSkills.filter((x) => x !== s) })} /> {s}</label>
              ))}</div>
            </div>
          )}
          <div>{[...race.traits, ...(race.subraces.find((s) => s.index === draft.subrace)?.traits || [])].map((t) => (
            <details key={t.name} className="feature"><summary>{t.name}</summary><div className="desc">{t.desc}</div></details>
          ))}</div>
          <p className="muted small">{race.age} {race.size_description}</p>
        </div>
      )}
    </div>
  );
}

function ClassStep({ srd, draft, set }) {
  const cls = findClass(srd, draft.class);
  return (
    <div className="stack">
      <div className="grid cards">
        {srd.classes.map((c) => (
          <button key={c.index} className={`choice-card ${draft.class === c.index ? 'selected' : ''}`} onClick={() => set({ class: c.index, skills: [], subclass: null, featureChoices: {}, cantrips: [], spells: [], gear: {}, gearPicks: {}, levels: draft.levels.map((l) => ({ ...l, class: c.index })) })}>
            <div className="title">{c.name}</div>
            <div className="muted small">d{c.hit_die} hit die · saves {c.saves.map((s) => s.toUpperCase()).join(', ')}{c.caster ? ` · ${c.caster} caster` : ''}</div>
          </button>
        ))}
      </div>
      {cls && (
        <div className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{cls.name}</h2>
            <div className="row"><label style={{ margin: 0 }}>Starting level</label>
              <select style={{ width: 80 }} value={draft.targetLevel} onChange={(e) => {
                const n = Number(e.target.value);
                const levels = Array.from({ length: n - 1 }, (_, i) => draft.levels[i] || { class: draft.class });
                set({ targetLevel: n, levels });
              }}>{Array.from({ length: 20 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
            </div>
          </div>
          {draft.targetLevel > 1 && <div className="notice small">You'll walk through level 2 → {draft.targetLevel} one level at a time after the basics, choosing HP, subclass, ASIs/feats and spells just like levelling up in play.</div>}
          <div className="muted small">Proficiencies: {cls.proficiencies.join(', ')}</div>
          {cls.subclass_level === 1 && (
            <div><label>{cls.subclass_flavor}</label>
              <div className="grid cards">{cls.subclasses.map((s) => (
                <button key={s.index} className={`choice-card ${draft.subclass === s.index ? 'selected' : ''}`} onClick={() => set({ subclass: s.index })}>
                  <div className="title">{s.name}</div><div className="muted small" style={{ maxHeight: 54, overflow: 'hidden' }}>{s.desc}</div>
                </button>
              ))}</div>
            </div>
          )}
          <h3>Level 1 features</h3>
          {[...cls.levels[1].features, ...(cls.subclasses.find((x) => x.index === draft.subclass)?.levels?.[1] || [])].map((f) => {
            const pick = draft.featureChoices[f.name];
            return (
              <details key={f.name} className="feature" open={!!f.options}>
                <summary>{f.name}{pick?.length ? `: ${[].concat(pick).join(', ')}` : f.options ? ' — choose below' : ''}</summary>
                <div className="desc">{f.desc}</div>
                {f.options && <OptionCards options={f.options} value={pick} max={optionCount(srd, cls.index, 1, f.name)} onChange={(v) => set({ featureChoices: { ...draft.featureChoices, [f.name]: v } })} />}
              </details>
            );
          })}
          <div className="muted small">Starting equipment is chosen in the Equipment step.</div>
        </div>
      )}
    </div>
  );
}

function BackgroundStep({ srd, draft, set }) {
  const bg = srd.backgrounds.find((b) => b.index === draft.background);
  const bgSkills = draft.bgSkills ?? bg?.skills ?? [];
  return (
    <div className="stack">
      <div className="grid cards">
        {srd.backgrounds.map((b) => (
          <button key={b.index} className={`choice-card ${draft.background === b.index ? 'selected' : ''}`} onClick={() => set({ background: b.index, bgSkills: undefined, customBackground: '' })}>
            <div className="title">{b.name}</div><div className="muted small">{b.skills.join(', ')}</div>
          </button>
        ))}
        <button className={`choice-card ${draft.background === 'custom' ? 'selected' : ''}`} onClick={() => set({ background: 'custom', bgSkills: [] })}>
          <div className="title">Custom</div><div className="muted small">Make your own (PHB p.125)</div>
        </button>
      </div>
      {draft.background && (
        <div className="card stack">
          {draft.background === 'custom' && <div><label>Background name</label><input value={draft.customBackground || ''} onChange={(e) => set({ customBackground: e.target.value })} /></div>}
          {bg && <><h2>{bg.name}</h2><div><b>Feature: {bg.feature.name}</b>{bg.feature.desc && <div className="muted small pre">{bg.feature.desc}</div>}</div>
            <div className="small">Tools: {bg.tools.join(', ') || '—'} · Extra languages: {bg.languages} · {bg.gold} gp</div>
            <div className="chips">{bg.equipment.map((e, i) => (e.index ? <ItemChip key={i} srd={srd} index={e.index} qty={e.qty} label={e.name} /> : <span key={i} className="item-chip plain">📦 {e.name}</span>))}</div></>}
          <div><label>Background skills (2 — swap freely)</label>
            <div className="row">{[0, 1].map((i) => (
              <select key={i} style={{ width: 'auto' }} value={bgSkills[i] || ''} onChange={(e) => { const s = [...bgSkills]; s[i] = e.target.value; set({ bgSkills: s }); }}>
                <option value="">—</option>{Object.keys(SKILLS).map((s) => <option key={s}>{s}</option>)}
              </select>
            ))}</div>
          </div>
          <div><label>Extra languages & tool proficiencies (comma separated)</label>
            <ListInput value={draft.languages || []} placeholder="e.g. Elvish, Dwarvish" onChange={(languages) => set({ languages })} />
          </div>
        </div>
      )}
    </div>
  );
}

export function EquipmentStep({ srd, draft, set }) {
  const cls = findClass(srd, draft.class);
  const bg = srd.backgrounds.find((b) => b.index === draft.background);
  if (!cls) return <div className="empty">Pick a class first — starting equipment comes from your class and background.</div>;
  const wealth = STARTING_WEALTH[cls.index] || [4, 10];
  const gold = draft.gearMode === 'gold';
  const preview = expandItems(srd, [...(gold ? [] : classGear(srd, cls, draft)), ...backgroundGear(srd, bg)]);
  const setPick = (key, k, v) => { const cur = [...(draft.gearPicks[key] || [])]; cur[k] = v; set({ gearPicks: { ...draft.gearPicks, [key]: cur } }); };
  return (
    <div className="stack">
      <div className="tabs">
        <button className={!gold ? 'active' : ''} onClick={() => set({ gearMode: 'gear' })}>🎒 Class equipment</button>
        <button className={gold ? 'active' : ''} onClick={() => set({ gearMode: 'gold' })}>💰 Gold instead ({wealth[0]}d4{wealth[1] > 1 ? ` × ${wealth[1]}` : ''} gp)</button>
      </div>
      {gold ? (
        <div className="card row">
          <button className="primary" onClick={() => set({ startingGold: Array.from({ length: wealth[0] }, () => rollDie(4)).reduce((a, b) => a + b, 0) * wealth[1] })}>🎲 Roll {wealth[0]}d4{wealth[1] > 1 ? ` × ${wealth[1]}` : ''}</button>
          <input type="number" min="0" style={{ width: 110 }} value={draft.startingGold || 0} onChange={(e) => set({ startingGold: Number(e.target.value) })} />
          <span className="muted small">gp to buy your own gear (add items on the sheet's Inventory tab). Background items are still included.</span>
        </div>
      ) : (
        <>
          {cls.starting_equipment.length > 0 && (
            <div className="card stack"><h3 style={{ margin: 0 }}>Every {cls.name} gets</h3>
              <div className="chips">{cls.starting_equipment.map((e) => <ItemChip key={e.index} srd={srd} index={e.index} qty={e.qty} />)}</div>
            </div>
          )}
          {cls.starting_choices.map((ch, ci) => {
            const sel = draft.gear[ci] ?? 0;
            return (
              <div key={ci} className="card stack">
                <div className="row between"><h3 style={{ margin: 0 }}>Choice {ci + 1}</h3><span className="muted small">{ch.desc}</span></div>
                <div className="grid cards">
                  {ch.options.map((o, oi) => (
                    <div key={oi} role="button" tabIndex={0} className={`choice-card ${sel === oi ? 'selected' : ''}`} onClick={() => set({ gear: { ...draft.gear, [ci]: oi } })}
                      onKeyDown={(e) => e.key === 'Enter' && set({ gear: { ...draft.gear, [ci]: oi } })}>
                      <div className="row" style={{ gap: 6 }}><input type="radio" readOnly checked={sel === oi} /><strong>({String.fromCharCode(97 + oi)})</strong></div>
                      <div className="chips" style={{ marginTop: 6 }}>
                        {o.items.map((it, ii) => (it.index
                          ? <ItemChip key={ii} srd={srd} index={it.index} qty={it.qty} />
                          : <span key={ii} className="badge gold">{it.label || srd.equipment_categories[it.category]?.name}</span>))}
                      </div>
                      {sel === oi && o.items.map((it, ii) => !it.index && (
                        <div key={ii} className="stack" style={{ gap: 6, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                          {Array.from({ length: it.qty }, (_, k) => {
                            const key = `${ci}.${ii}`;
                            const v = draft.gearPicks[key]?.[k] || '';
                            const pool = srd.equipment_categories[it.category]?.items || it.pick || [];
                            return (
                              <div key={k} className="row" style={{ flexWrap: 'nowrap' }}>
                                <select value={v} onChange={(e) => setPick(key, k, e.target.value)}>
                                  <option value="">Choose {(srd.equipment_categories[it.category]?.name || 'an item').toLowerCase()}…</option>
                                  {pool.map((i) => { const x = findItem(srd, i); return <option key={i} value={i}>{x?.name || i}{x?.damage ? ` — ${x.damage}` : ''}{x?.ac ? ` — AC ${x.ac.base}` : ''}</option>; })}
                                </select>
                                {v && <ItemChip srd={srd} index={v} label="info" />}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
      <div className="card stack">
        <h3 style={{ margin: 0 }}>From your background{bg ? ` (${bg.name})` : ''}</h3>
        {bg ? <div className="chips">{bg.equipment.map((e, i) => (e.index ? <ItemChip key={i} srd={srd} index={e.index} qty={e.qty} label={e.name} /> : <span key={i} className="item-chip plain">📦 {e.name}</span>))}<span className="badge gold">💰 {bg.gold} gp</span></div>
          : <div className="muted small">Custom background — add its items on the sheet.</div>}
      </div>
      <div className="card">
        <div className="row between"><h3 style={{ margin: 0 }}>Your inventory will be</h3><span className="muted small">{preview.length} items · {+totalWeight({ equipment: preview }, srd).toFixed(1)} lb</span></div>
        <div className="chips" style={{ marginTop: 8 }}>{preview.map((e, i) => (e.index ? <ItemChip key={i} srd={srd} index={e.index} qty={e.qty} label={e.name} /> : <span key={i} className="item-chip plain">{KIND_ICON.Gear} {e.qty > 1 ? `${e.qty}× ` : ''}{e.name}</span>))}</div>
        <p className="muted small" style={{ marginBottom: 0 }}>Packs are unpacked into separate items. Armor and weapons start equipped; weapons get attack lines and your AC is worked out from what you wear.</p>
      </div>
    </div>
  );
}

function AbilityStep({ srd, draft, set }) {
  const [rolling, setRolling] = useState(false);
  const bonus = racialBonuses(srd, draft);
  const pool = draft.method === 'roll' ? draft.rolls.map((r) => r.total) : draft.method === 'array' ? STANDARD_ARRAY : null;
  const used = Object.values(draft.assign || {});
  const pointsSpent = ABILITIES.reduce((s, a) => s + (POINT_BUY_COST[draft.base[a]] ?? 99), 0);
  const assign = (a, idx) => {
    const next = { ...draft.assign };
    for (const k of Object.keys(next)) if (next[k] === idx) delete next[k];
    if (idx === '') delete next[a]; else next[a] = Number(idx);
    set({ assign: next, base: { ...draft.base, ...Object.fromEntries(ABILITIES.map((x) => [x, next[x] != null ? pool[next[x]] : 8])) } });
  };
  const rollAll = () => {
    setRolling(true);
    setTimeout(() => {
      const rolls = Array.from({ length: 6 }, () => roll4d6DropLowest());
      set({ rolls, assign: {}, base: Object.fromEntries(ABILITIES.map((a) => [a, 8])) });
      setRolling(false);
    }, 600);
  };
  return (
    <div className="stack">
      <div className="tabs">
        {[['roll', '🎲 4d6 drop lowest'], ['array', 'Standard array'], ['pointbuy', 'Point buy'], ['manual', 'Manual']].map(([k, l]) => (
          <button key={k} className={draft.method === k ? 'active' : ''} onClick={() => set({ method: k, assign: {}, base: k === 'pointbuy' ? Object.fromEntries(ABILITIES.map((a) => [a, 8])) : draft.base })}>{l}</button>
        ))}
      </div>
      {draft.method === 'roll' && (
        <div className="card stack">
          <div className="row"><button className="primary" onClick={rollAll} disabled={rolling}>{draft.rolls.length ? 'Reroll all' : 'Roll 6 scores'}</button>
            <span className="muted small">Roll four d6, drop the lowest, six times. Then assign each total to an ability.</span></div>
          <div className="stack" style={{ gap: 6 }}>
            {(rolling ? Array.from({ length: 6 }, () => ({ rolls: [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)), dropIndex: -1, total: '?' })) : draft.rolls).map((r, i) => (
              <div key={i} className="row">
                {r.rolls.map((d, j) => <span key={j} className={`die ${rolling ? 'rolling' : ''} ${j === r.dropIndex ? 'dropped' : ''}`}>{d}</span>)}
                <span style={{ fontSize: 20, fontWeight: 700, marginLeft: 6 }}>= {r.total}</span>
                {!rolling && used.includes(i) && <span className="badge gold">{ABILITIES.find((a) => draft.assign[a] === i)?.toUpperCase()}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {draft.method === 'pointbuy' && <div className={`notice ${pointsSpent > 27 ? 'error' : ''}`}>Points spent: {pointsSpent} / 27 (scores 8–15)</div>}
      <div className="abilities">
        {ABILITIES.map((a) => {
          const final = (Number(draft.base[a]) || 0) + bonus[a];
          return (
            <div key={a} className="ability stack" style={{ gap: 4 }}>
              <div className="name">{ABILITY_NAMES[a]}</div>
              {pool ? (
                <select value={draft.assign?.[a] ?? ''} onChange={(e) => assign(a, e.target.value)}>
                  <option value="">—</option>
                  {pool.map((v, i) => <option key={i} value={i} disabled={used.includes(i) && draft.assign[a] !== i}>{v}</option>)}
                </select>
              ) : draft.method === 'pointbuy' ? (
                <div className="row" style={{ justifyContent: 'center', gap: 4 }}>
                  <button className="small" disabled={draft.base[a] <= 8} onClick={() => set({ base: { ...draft.base, [a]: draft.base[a] - 1 } })}>−</button>
                  <strong>{draft.base[a]}</strong>
                  <button className="small" disabled={draft.base[a] >= 15} onClick={() => set({ base: { ...draft.base, [a]: draft.base[a] + 1 } })}>+</button>
                </div>
              ) : (
                <input type="number" value={draft.base[a]} onChange={(e) => set({ base: { ...draft.base, [a]: Number(e.target.value) } })} style={{ width: '100%' }} />
              )}
              <div className="small muted">{bonus[a] ? `+${bonus[a]} racial` : ' '}</div>
              <div className="mod">{final}</div>
              <div className="muted">{signed(mod(final))}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SkillsStep({ srd, draft, set }) {
  const cls = findClass(srd, draft.class);
  const bg = srd.backgrounds.find((b) => b.index === draft.background);
  const bgSkills = draft.bgSkills ?? bg?.skills ?? [];
  const fixed = new Set([...bgSkills, ...draft.raceSkills]);
  const n = cls?.skill_choices.choose || 0;
  return (
    <div className="card stack">
      <div className="row between"><h2 style={{ margin: 0 }}>Skill proficiencies</h2><span className={`badge ${draft.skills.length === n ? 'green' : 'gold'}`}>{draft.skills.length} / {n} class picks</span></div>
      <p className="muted small">{cls?.name} picks from: {cls?.skill_choices.from.join(', ')}. Picking others is allowed (homebrew).</p>
      <p className="muted small" style={{ margin: 0 }}>Being proficient in a skill adds your proficiency bonus (+2 at level 1, rising to +6) to ability checks with it. Tap a skill to read what it covers.</p>
      <div className="skill-pick">
        {Object.entries(SKILLS).map(([s, a]) => {
          const from = [bgSkills.includes(s) && 'background', draft.raceSkills.includes(s) && 'race'].filter(Boolean);
          const allowed = cls?.skill_choices.from.includes(s);
          const desc = srd.skills.find((k) => k.name === s)?.desc;
          const on = draft.skills.includes(s) || fixed.has(s);
          return (
            <div key={s} className={`skill-card ${on ? 'on' : ''} ${allowed && !fixed.has(s) ? 'allowed' : ''}`}>
              <label className="inline" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={on} disabled={fixed.has(s)} style={{ marginTop: 3 }}
                  onChange={(e) => set({ skills: e.target.checked ? [...draft.skills, s] : draft.skills.filter((x) => x !== s) })} />
                <span className="grow">
                  <strong>{s}</strong> <span className="muted small">{ABILITY_NAMES[a]}</span>{' '}
                  {from.length ? <span className="badge">from {from.join(' & ')}</span> : allowed ? <span className="badge gold">{cls.name} option</span> : null}
                </span>
              </label>
              {desc && <details className="skill-desc"><summary className="small muted">What it covers</summary><div className="small">{desc}</div></details>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpellsStep({ srd, draft, set, level1 }) {
  const cls = findClass(srd, draft.class);
  const l1 = cls?.levels[1] || {};
  if (!cls?.caster || !(l1.slots?.[0] || l1.cantrips_known)) {
    return <div className="empty">{cls?.name || 'This class'} has no spells at level 1.{draft.targetLevel > 1 ? ' You can pick spells when levelling up in the next step.' : ''}</div>;
  }
  const prepared = ['cleric', 'druid', 'paladin'].includes(cls.index);
  const abilityMod = mod(level1.abilities[cls.spellcasting_ability]);
  const suggested = cls.index === 'wizard' ? 6 : prepared ? Math.max(1, abilityMod + 1) : l1.spells_known;
  return (
    <div className="grid two">
      {l1.cantrips_known > 0 && <div className="card"><SpellPicker label="Cantrips" spells={spellsFor(srd, cls.index, 0, 0, draft.subclass)} suggested={l1.cantrips_known} selected={draft.cantrips} onChange={(cantrips) => set({ cantrips })} /></div>}
      <div className="card">
        <SpellPicker label={cls.index === 'wizard' ? 'Spellbook (level 1)' : prepared ? 'Prepared spells' : 'Spells known'} spells={spellsFor(srd, cls.index, 1, 1, draft.subclass)} suggested={suggested} selected={draft.spells} onChange={(spells) => set({ spells })} />
        {prepared && <p className="muted small">{cls.name}s prepare {signed(abilityMod)} + level spells each day from the whole list — you can change these anytime on the sheet.</p>}
      </div>
    </div>
  );
}

function LevelsStep({ srd, draft, set, level1 }) {
  const [open, setOpen] = useState(0);
  let data = level1;
  return (
    <div className="stack">
      {draft.levels.map((choice, i) => {
        const before = data;
        data = applyLevel(srd, data, choice);
        const lvl = i + 2;
        return (
          <div key={i} className="card">
            <div className="row between" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i ? -1 : i)}>
              <h2 style={{ margin: 0 }}>Level {lvl}</h2>
              <span className="muted small">{findClass(srd, choice.class)?.name} · +{data.hp.max - before.hp.max} HP {open === i ? '▲' : '▼'}</span>
            </div>
            {open === i && (
              <div style={{ marginTop: 12 }}>
                <LevelChoice srd={srd} data={before} choice={choice} onChange={(c) => { const levels = [...draft.levels]; levels[i] = c; set({ levels }); }} />
                {i + 1 < draft.levels.length && <div className="row end"><button className="primary" onClick={() => setOpen(i + 1)}>Next level →</button></div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetailsStep({ draft, set, campaigns }) {
  const f = (k, label, area) => (
    <div><label>{label}</label>{area ? <textarea rows={area} value={draft[k] || ''} onChange={(e) => set({ [k]: e.target.value })} /> : <input value={draft[k] || ''} onChange={(e) => set({ [k]: e.target.value })} />}</div>
  );
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <label className="portrait" style={{ cursor: 'pointer', margin: 0 }} title="Upload portrait">
            {draft.portrait ? <img src={draft.portrait} alt="" /> : '🧝'}
            <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files[0] && set({ portrait: await resizeImage(e.target.files[0], 400, 0.8) })} />
          </label>
          <div className="grow stack">
            <div><label>Character name</label><input autoFocus value={draft.name || ''} onChange={(e) => set({ name: e.target.value })} style={{ fontSize: 18 }} /></div>
            <div className="grid two">
              <div><label>Party</label><select value={draft.campaign_id || ''} onChange={(e) => set({ campaign_id: Number(e.target.value) || null })}><option value="">No party (private)</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            </div>
          </div>
        </div>
      </div>
      <div className="card stack"><h3 style={{ margin: 0 }}>Alignment</h3><AlignmentPicker value={draft.alignment || ''} onChange={(alignment) => set({ alignment })} /></div>
      <div className="card grid two">
        {f('traits', 'Personality traits', 3)}{f('ideals', 'Ideals', 3)}{f('bonds', 'Bonds', 3)}{f('flaws', 'Flaws', 3)}
      </div>
      <div className="card stack">
        {f('appearance', 'Appearance', 3)}{f('backstory', 'Backstory', 8)}{f('allies', 'Allies & organisations', 3)}{f('notes', 'Anything else (personal notes, goals, secrets for the DM…)', 4)}
      </div>
    </div>
  );
}

export function Review({ srd, data, draft }) {
  const x = derived(data);
  const warnings = [];
  if (!draft.name?.trim()) warnings.push('Give your character a name (Details step).');
  if (!draft.race) warnings.push('No race chosen.');
  if (!draft.class) warnings.push('No class chosen.');
  if (draft.method === 'roll' && draft.rolls.length && Object.keys(draft.assign).length < 6) warnings.push('Not every rolled score is assigned.');
  const cls = findClass(srd, draft.class);
  if (cls && draft.skills.length !== cls.skill_choices.choose) warnings.push(`${cls.name} normally picks ${cls.skill_choices.choose} skills (you picked ${draft.skills.length}).`);
  return (
    <div className="stack">
      {warnings.map((w) => <div key={w} className="notice small">⚠️ {w}</div>)}
      <div className="card sheet-head">
        <div className="portrait">{data.portrait ? <img src={data.portrait} alt="" /> : '🧝'}</div>
        <div className="grow">
          <h1 style={{ margin: 0 }}>{data.name || 'Unnamed'}</h1>
          <div className="muted">{data.subrace?.name || data.race?.name} · {data.classes.map((c) => `${c.name}${c.subclass_name ? ` (${c.subclass_name})` : ''} ${c.level}`).join(' / ')} · {data.background?.name}</div>
        </div>
        {[['HP', data.hp.max], ['AC', data.ac], ['Init', signed(x.initiative)], ['Prof', `+${x.pb}`], ['Speed', data.speed]].map(([l, v]) => (
          <div key={l} className="stat-box"><div className="label">{l}</div><div className="value">{v}</div></div>
        ))}
      </div>
      <div className="abilities">{ABILITIES.map((a) => <div key={a} className="ability"><div className="name">{a.toUpperCase()}</div><div className="mod">{signed(x.mods[a])}</div><div className="muted">{data.abilities[a]}</div></div>)}</div>
      <div className="grid two">
        <div className="card"><h3>Proficient skills</h3>{Object.keys(data.skills).join(', ') || '—'}</div>
        <div className="card"><h3>Equipment ({data.equipment.length})</h3><div className="small">{data.equipment.map((e) => `${e.qty > 1 ? `${e.qty}× ` : ''}${e.name}`).join(', ') || '—'}</div>
          <div className="muted small">AC {data.ac} · {data.attacks.map((a) => `${a.name} ${a.bonus}`).join(', ')}</div></div>
        <div className="card"><h3>Features ({data.features.length})</h3><div className="small">{data.features.map((f) => f.name).join(' · ')}</div></div>
        <div className="card"><h3>Spells ({data.spells.length})</h3><div className="small">{data.spells.map((s) => s.name).join(', ') || '—'}</div>
          {data.spellcasting.slots.some((s) => s.max) && <div className="muted small">Slots: {data.spellcasting.slots.map((s, i) => s.max && `L${i + 1}×${s.max}`).filter(Boolean).join(' ')}</div>}</div>
      </div>
      <p className="muted small">Everything stays editable on the sheet afterwards — nothing here is locked.</p>
    </div>
  );
}

export default function BuilderPage() {
  const { campaigns, campaign } = useApp();
  const nav = useNavigate();
  const { data: srd, error } = useLoad(loadRules, []);
  const [draft, setDraft] = useState(loadDraft);
  const [run, busy, err] = useAction();
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage full/blocked: draft lives in memory */ } }, [draft]);
  useEffect(() => { if (draft.campaign_id === undefined && campaign) setDraft((d) => ({ ...d, campaign_id: campaign.id })); }, [campaign, draft.campaign_id]);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const stepsRef = useRef(null);
  // keep the active step pill visible in the (horizontally scrolling) step bar on phones
  useEffect(() => { stepsRef.current?.querySelector('.active')?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }, [draft.step, srd]);

  const level1 = useMemo(() => (srd ? buildLevelOne(srd, draft) : null), [srd, draft]);
  const final = useMemo(() => (srd && level1 ? finishCharacter(srd, draft.levels.reduce((d, c) => applyLevel(srd, d, c), level1)) : null), [srd, level1, draft.levels]);
  if (!srd) return error ? <ErrorBox error={error} /> : <div className="muted">Loading rules…</div>;

  const steps = [
    ['Race', <RaceStep key="r" srd={srd} draft={draft} set={set} />, !!draft.race],
    ['Class', <ClassStep key="c" srd={srd} draft={draft} set={set} />, !!draft.class],
    ['Background', <BackgroundStep key="b" srd={srd} draft={draft} set={set} />, !!draft.background],
    ['Equipment', <EquipmentStep key="e" srd={srd} draft={draft} set={set} />, !!draft.class && !!draft.background],
    ['Abilities', <AbilityStep key="a" srd={srd} draft={draft} set={set} />, draft.method !== 'roll' || draft.rolls.length > 0],
    ['Skills', <SkillsStep key="s" srd={srd} draft={draft} set={set} />, draft.skills.length > 0],
    ['Spells', <SpellsStep key="sp" srd={srd} draft={draft} set={set} level1={level1} />, true],
    ...(draft.targetLevel > 1 ? [[`Levels 2–${draft.targetLevel}`, <LevelsStep key="l" srd={srd} draft={draft} set={set} level1={level1} />, true]] : []),
    ['Details', <DetailsStep key="d" draft={draft} set={set} campaigns={campaigns} />, !!draft.name],
    ['Review', <Review key="rv" srd={srd} data={final} draft={draft} />, false],
  ];
  const step = Math.min(draft.step, steps.length - 1);
  const isLast = step === steps.length - 1;
  const create = () => run(async () => {
    const r = await api.post('/characters', { data: final, campaign_id: draft.campaign_id || null });
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    nav(`/characters/${r.id}`);
  });

  return (
    <div className="stack">
      <div className="page-head">
        <h1>New character</h1>
        <div className="row">
          <span className="muted small">Draft saved in this browser — nothing is created until you press Create.</span>
          <button className="small danger" onClick={() => confirm('Discard this draft and start over?') && setDraft({ ...EMPTY })}>Start over</button>
        </div>
      </div>
      <div className="steps" ref={stepsRef}>
        {steps.map(([label, , done], i) => <button key={label} className={i === step ? 'active' : done ? 'done' : ''} onClick={() => set({ step: i })}>{i + 1}. {done && i !== step ? '✓ ' : ''}{label}</button>)}
      </div>
      {steps[step][1]}
      <ErrorBox error={err} />
      <div className="row between builder-nav" style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', padding: '12px 0', flexWrap: 'nowrap', zIndex: 10 }}>
        <button disabled={step === 0} onClick={() => { set({ step: step - 1 }); window.scrollTo({ top: 0 }); }}>← Back</button>
        <span className="muted small center mobile-only">Step {step + 1} of {steps.length}: {steps[step][0]}</span>
        {final && <span className="muted small summary">{final.name || 'Unnamed'} · {final.race?.name || '?'} {final.classes.map((c) => `${c.name} ${c.level}`).join('/') || '?'} · HP {final.hp.max}</span>}
        {isLast
          ? <button className="primary" disabled={busy || !draft.name?.trim()} onClick={create}>⚔️ Create character</button>
          : <button className="primary" onClick={() => { set({ step: step + 1 }); window.scrollTo({ top: 0 }); }}>Next →</button>}
      </div>
    </div>
  );
}
