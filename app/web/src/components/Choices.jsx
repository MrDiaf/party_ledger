import { useState } from 'react';
import { ABILITY_NAMES } from '../../../shared/rules.js';

/**
 * Pick one (or `max`) options of a feature such as Fighting Style, showing what each one does.
 * value: string (single) or string[] (multi).
 */
export function OptionCards({ options, value, onChange, max = 1, readOnly }) {
  const picked = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (n) => {
    if (readOnly) return;
    if (max === 1) return onChange(picked[0] === n ? '' : n);
    onChange(picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n]);
  };
  return (
    <div className="stack" style={{ gap: 6, marginTop: 6 }}>
      <div className="small muted">{max > 1 ? `Choose ${max} — ${picked.length}/${max} picked` : 'Choose one:'}</div>
      <div className="option-grid">
        {options.map((o) => {
          const on = picked.includes(o.name);
          return (
            <button key={o.name} type="button" className={`option-card ${on ? 'selected' : ''}`} onClick={() => toggle(o.name)}>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><input type={max > 1 ? 'checkbox' : 'radio'} readOnly checked={on} tabIndex={-1} /><strong>{o.name}</strong></div>
              <div className="small muted option-desc">{o.desc || 'No description in the SRD — see the PHB.'}</div>
            </button>
          );
        })}
      </div>
      {max > 1 && picked.length > max && <div className="small" style={{ color: 'var(--red)' }}>More than {max} picked (allowed, but not standard).</div>}
    </div>
  );
}

const featTags = (f) => [
  f.asi?.length && `+1 ${f.asi.length > 3 ? 'any ability' : f.asi.map((a) => a.toUpperCase()).join(' or ')}`,
  f.save && 'saving throw proficiency', f.hp_per_level && `+${f.hp_per_level} HP per level`, f.initiative && `+${f.initiative} initiative`,
  f.speed && `+${f.speed} ft speed`, f.armor && `${f.armor} proficiency`, f.resource && `${f.resource.max} ${f.resource.name}`,
].filter(Boolean);

/** Feat chooser with descriptions and the +1 ability choice for half-feats. value = { feat, ability }. */
export function FeatPicker({ feats, value, onChange }) {
  const [q, setQ] = useState('');
  const shown = feats.filter((f) => !q || `${f.name} ${f.desc}`.toLowerCase().includes(q.toLowerCase()));
  const sel = feats.find((f) => f.name === value?.feat);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {sel && (
        <div className="card tight stack" style={{ borderColor: 'var(--gold)' }}>
          <div className="row between"><strong>{sel.name}</strong><button className="small ghost" onClick={() => onChange({ feat: '' })}>Change</button></div>
          <div className="small">{sel.desc}</div>
          {featTags(sel).length > 0 && <div className="chips">{featTags(sel).map((t) => <span key={t} className="badge green">{t}</span>)}</div>}
          {sel.asi?.length > 1 && (
            <div className="row"><span className="small muted">+1 to:</span>
              {sel.asi.map((a) => <label key={a} className="inline small"><input type="radio" checked={value.ability === a} onChange={() => onChange({ ...value, ability: a })} /> {ABILITY_NAMES[a]}</label>)}
            </div>
          )}
          <div className="small muted">Green tags are applied to your sheet automatically; the rest is written into your feats.</div>
        </div>
      )}
      {!sel && <>
        <input placeholder="Search feats…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="option-grid feats">
          {shown.map((f) => (
            <button key={f.name} type="button" className="option-card" onClick={() => onChange({ feat: f.name, ability: f.asi?.length === 1 ? f.asi[0] : '' })}>
              <strong>{f.name}</strong>
              <div className="small muted option-desc">{f.desc || 'See the PHB.'}</div>
              {featTags(f).length > 0 && <div className="chips" style={{ marginTop: 4 }}>{featTags(f).map((t) => <span key={t} className="badge green">{t}</span>)}</div>}
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}

// Our own short explanations of the nine alignments (PHB p.122 covers them in full).
export const ALIGNMENTS = [
  ['Lawful Good', 'Does the right thing and keeps their word; believes rules, duty and order serve the greater good. A knight sworn to protect the weak.'],
  ['Neutral Good', 'Does the most good they can, following rules only when they help. Kind first, rules second.'],
  ['Chaotic Good', 'Follows their conscience and values freedom; kind-hearted but distrusts authority. A rebel who robs the cruel to help the poor.'],
  ['Lawful Neutral', 'Lives by a code, tradition or law above personal feelings of right and wrong. A judge, soldier or monk who follows orders and vows.'],
  ['True Neutral', 'Avoids taking sides; acts on what seems best at the moment, or seeks balance. Pragmatic and moderate.'],
  ['Chaotic Neutral', 'Follows whims and personal freedom above everything; unpredictable, not cruel. Good fun at the table — but play it with care for your party.'],
  ['Lawful Evil', 'Takes what they want within a code, hierarchy or contract. A tyrant or a devilishly honest schemer.'],
  ['Neutral Evil', 'Does whatever they can get away with for themselves, without loyalty or remorse.'],
  ['Chaotic Evil', 'Driven by greed, hatred or bloodlust with no regard for others. Usually for villains; check with your DM before playing one.'],
  ['Unaligned', 'Has no moral compass to speak of — mostly animals and constructs.'],
];

export function AlignmentPicker({ value, onChange }) {
  const sel = ALIGNMENTS.find(([a]) => a === value);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="align-grid">
        {ALIGNMENTS.slice(0, 9).map(([a]) => (
          <button key={a} type="button" className={`align-cell ${value === a ? 'selected' : ''}`} onClick={() => onChange(value === a ? '' : a)}>{a === 'True Neutral' ? 'Neutral' : a}</button>
        ))}
      </div>
      <div className="small muted">{sel ? <><b style={{ color: 'var(--text)' }}>{sel[0]}:</b> {sel[1]}</> : 'Your character\'s moral and social outlook. It guides how you roleplay — it is not a rule that limits what you can do, and you can change it as your character grows. Ask your DM if the campaign has preferences (many tables avoid evil characters).'}</div>
    </div>
  );
}
