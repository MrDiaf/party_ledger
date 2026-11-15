import { useState } from 'react';

/** Pick spells by name from a list of SRD spells. Counts are suggestions only. */
export default function SpellPicker({ spells, selected, onChange, suggested, label, exclude = [] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const sel = new Set(selected);
  const shown = spells.filter((s) => !exclude.includes(s.name) && (!q || s.name.toLowerCase().includes(q.toLowerCase())));
  const toggle = (name) => onChange(sel.has(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between">
        <strong>{label}</strong>
        <span className={`badge ${suggested != null && selected.length > suggested ? 'red' : 'gold'}`}>{selected.length}{suggested != null ? ` / ${suggested} suggested` : ' chosen'}</span>
      </div>
      <input placeholder="Search spells…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 7, padding: '4px 8px' }}>
        {shown.map((s) => (
          <div key={s.index} style={{ borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="checkbox" checked={sel.has(s.name)} onChange={() => toggle(s.name)} />
              <span className="grow" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === s.index ? null : s.index)}>
                {s.name} <span className="muted small">{s.level ? `L${s.level}` : 'cantrip'} · {s.school}{s.concentration ? ' · C' : ''}{s.ritual ? ' · R' : ''}</span>
              </span>
            </div>
            {open === s.index && <div className="muted small pre" style={{ padding: '4px 0 4px 24px' }}>{s.casting_time} · {s.range} · {s.components} · {s.duration}{'\n'}{s.desc}</div>}
          </div>
        ))}
        {!shown.length && <div className="muted small">No spells.</div>}
      </div>
      <div className="row">
        <input id={`custom-${label}`} placeholder="Add a spell not in the list (homebrew/PHB)…" className="grow" onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target.value.trim()) { onChange([...selected, e.target.value.trim()]); e.target.value = ''; }
        }} />
      </div>
      {selected.filter((n) => !spells.some((s) => s.name === n)).length > 0 && (
        <div className="row small">Custom: {selected.filter((n) => !spells.some((s) => s.name === n)).map((n) => <span key={n} className="badge">{n} <a href="#" onClick={(e) => { e.preventDefault(); toggle(n); }}>✕</a></span>)}</div>
      )}
    </div>
  );
}
