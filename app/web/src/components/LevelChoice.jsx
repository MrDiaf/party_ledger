import { ABILITIES, hpAverage, rollDie, mod, signed } from '../../../shared/rules.js';
import { levelInfo, multiclassWarning, spellsFor, maxSpellLevel, applyLevel, optionCount } from '../lib/character.js';
import SpellPicker from './SpellPicker.jsx';
import { OptionCards, FeatPicker } from './Choices.jsx';

const Feature = ({ f, choice, onChoose, max }) => (
  <details className="feature" open={!!f.options}>
    <summary>{f.name}{choice?.length ? `: ${[].concat(choice).join(', ')}` : f.options ? ' — choose below' : ''}</summary>
    <div className="desc">{f.desc}</div>
    {f.options && <OptionCards options={f.options} value={choice} max={max} onChange={onChoose} />}
  </details>
);

/** Editor for one level-up step. `data` = the character before this level. */
export default function LevelChoice({ srd, data, choice, onChange }) {
  const info = levelInfo(srd, data, choice.class);
  const set = (patch) => onChange({ ...choice, ...patch });
  if (!info) return null;
  // subclass picked on this very level: show its features (and their options) straight away
  const subFeats = info.subclassFeatures.length ? info.subclassFeatures : info.def.subclasses.find((x) => x.index === choice.subclass)?.levels?.[info.level] || [];
  const warn = multiclassWarning(srd, data, choice.class);
  const after = applyLevel(srd, data, { ...choice, spells: [] });
  const maxLvl = maxSpellLevel(after);
  const known = data.spells.map((s) => s.name);
  const asiTotal = Object.values(choice.asi?.plus || {}).reduce((s, n) => s + Number(n || 0), 0);
  const hpVal = choice.hp ?? hpAverage(info.def.hit_die);
  const conMod = mod(after.abilities.con);
  const dwarf = data.subrace?.index === 'hill-dwarf' ? 1 : 0;
  return (
    <div className="stack">
      <div className="row">
        <div><label>Take this level in</label>
          <select value={choice.class} onChange={(e) => set({ class: e.target.value, subclass: undefined, featureChoices: {}, spells: [] })} style={{ width: 'auto' }}>
            {srd.classes.map((c) => {
              const cur = data.classes.find((x) => x.index === c.index);
              return <option key={c.index} value={c.index}>{c.name} {cur ? `→ ${cur.level + 1}` : '(multiclass)'}</option>;
            })}
          </select>
        </div>
        <div><label>Hit points (d{info.def.hit_die})</label>
          <div className="row">
            <input type="number" value={hpVal} style={{ width: 70 }} onChange={(e) => set({ hp: Number(e.target.value) })} />
            <button className="small" onClick={() => set({ hp: rollDie(info.def.hit_die) })}>🎲 Roll</button>
            <button className="small" onClick={() => set({ hp: hpAverage(info.def.hit_die) })}>Average ({hpAverage(info.def.hit_die)})</button>
            <span className="muted small">{signed(conMod)} CON{dwarf ? ' +1 Dwarven Toughness' : ''} → +{Math.max(1, hpVal + conMod + dwarf)} HP</span>
          </div>
        </div>
      </div>
      {warn && <div className="notice small">{warn}</div>}

      {info.needsSubclass && (
        <div>
          <label>{info.def.subclass_flavor}</label>
          <div className="grid cards">
            {info.def.subclasses.map((s) => (
              <button key={s.index} className={`choice-card ${choice.subclass === s.index ? 'selected' : ''}`} onClick={() => set({ subclass: s.index })}>
                <div className="title">{s.name}</div>
                <div className="muted small" style={{ maxHeight: 60, overflow: 'hidden' }}>{s.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {(info.features.length > 0 || subFeats.length > 0) && (
        <div><h3>New features</h3>
          {[...info.features, ...subFeats].map((f) => <Feature key={f.name} f={f} max={optionCount(srd, choice.class, info.level, f.name)} choice={choice.featureChoices?.[f.name]} onChoose={(v) => set({ featureChoices: { ...choice.featureChoices, [f.name]: v } })} />)}
        </div>
      )}

      {info.asi && (
        <div className="card tight stack">
          <div className="row">
            <strong>Ability Score Improvement</strong>
            <label className="inline"><input type="radio" checked={choice.asi?.mode !== 'feat'} onChange={() => set({ asi: { mode: 'asi', plus: {} } })} /> +2 / +1+1</label>
            <label className="inline"><input type="radio" checked={choice.asi?.mode === 'feat'} onChange={() => set({ asi: { mode: 'feat', feat: '' } })} /> Feat</label>
          </div>
          {choice.asi?.mode === 'feat' ? (
            <FeatPicker feats={srd.feats} value={choice.asi} onChange={(v) => set({ asi: { mode: 'feat', ...v } })} />
          ) : (
            <div className="row">
              {ABILITIES.map((a) => (
                <div key={a} className="center">
                  <div className="small muted">{a.toUpperCase()} {data.abilities[a]}</div>
                  <select value={choice.asi?.plus?.[a] || 0} style={{ width: 60 }} onChange={(e) => set({ asi: { mode: 'asi', plus: { ...(choice.asi?.plus || {}), [a]: Number(e.target.value) } } })}>
                    {[0, 1, 2].map((n) => <option key={n} value={n}>+{n}</option>)}
                  </select>
                </div>
              ))}
              <span className={`badge ${asiTotal === 2 ? 'green' : 'red'}`}>{asiTotal}/2 points</span>
            </div>
          )}
          {choice.asi?.mode !== 'feat' && ABILITIES.some((a) => data.abilities[a] + (choice.asi?.plus?.[a] || 0) > 20) && <div className="small muted">Note: PHB caps scores at 20 (allowed anyway).</div>}
        </div>
      )}

      {info.isCaster && maxLvl > 0 && (
        <SpellPicker label={`New spells (up to level ${maxLvl})`} spells={spellsFor(srd, choice.class, maxLvl)} exclude={known}
          suggested={info.newSpellsKnown != null ? info.newSpellsKnown + info.newCantrips : null}
          selected={choice.spells || []} onChange={(spells) => set({ spells })} />
      )}
      <div className="muted small">After this level: HP {after.hp.max} · {after.classes.map((c) => `${c.name} ${c.level}`).join(' / ')}</div>
    </div>
  );
}
