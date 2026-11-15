import { useMemo, useState } from 'react';
import { Modal } from './ui.jsx';
import ListEditor from './ListEditor.jsx';
import { ABILITY_NAMES, signed, totalLevel, mod } from '../../../shared/rules.js';
import { maxSpellLevel } from '../lib/character.js';

export const SCHOOL = {
  Abjuration: { icon: '🛡️', color: '#4f8fd6' }, Conjuration: { icon: '🌀', color: '#d6a84f' }, Divination: { icon: '👁️', color: '#5fc4c4' },
  Enchantment: { icon: '💫', color: '#d66fb4' }, Evocation: { icon: '🔥', color: '#e0603f' }, Illusion: { icon: '🎭', color: '#9a6fe0' },
  Necromancy: { icon: '💀', color: '#6fae5a' }, Transmutation: { icon: '⚗️', color: '#e08f3f' },
};
const ORD = ['Cantrip', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
const lvlName = (l) => (l ? `${ORD[l]} level` : 'Cantrip');

/** Casting-time marker like BG3: ● action, ▲ bonus action, ⟲ reaction, ⧗ longer. */
export function CastMark({ time }) {
  const t = String(time || '').toLowerCase();
  const [cls, sym, label] = t.includes('bonus') ? ['bonus', '▲', 'Bonus action'] : t.includes('reaction') ? ['reaction', '⟲', 'Reaction'] : /^1 action/.test(t) ? ['action', '●', 'Action'] : ['long', '⧗', time || '?'];
  return <span className={`cast-mark ${cls}`} title={label}>{sym}</span>;
}

const pickScaled = (table, level) => {
  if (!table) return null;
  const keys = Object.keys(table).map(Number).filter((k) => k <= level).sort((a, b) => b - a);
  return keys.length ? table[keys[0]] : null;
};

/** Merge a character's spell entry with the rules entry (full text, damage, save…). */
export function spellInfo(srd, entry) {
  const s = srd?.spells.find((x) => x.name.toLowerCase() === String(entry?.name || '').toLowerCase());
  return { ...(s || {}), ...Object.fromEntries(Object.entries(entry || {}).filter(([, v]) => v !== '' && v != null)), desc: s?.desc || entry?.notes || '', known: !!s };
}

export function SpellTile({ s, onClick, prepared, dim, selected }) {
  const sc = SCHOOL[s.school] || { icon: '✨', color: '#a89a86' };
  return (
    <button type="button" className={`spell-tile ${dim ? 'dim' : ''} ${selected ? 'selected' : ''}`} style={{ '--school': sc.color }} onClick={onClick} title={`${s.name} — ${lvlName(s.level)} ${s.school || ''}`}>
      <span className="spell-icon">{sc.icon}</span>
      <span className="spell-lvl">{s.level ? s.level : '∞'}</span>
      {prepared && <span className="spell-prep" title="Prepared">★</span>}
      <span className="spell-name">{s.name}</span>
      <span className="spell-tags"><CastMark time={s.casting_time} />{s.concentration && <span title="Concentration">C</span>}{s.ritual && <span title="Ritual">R</span>}{s.source === 'PHB' && <span title="From your PHB">PHB</span>}</span>
    </button>
  );
}

/** Full spell card with casting controls. */
export function SpellDetail({ srd, data, entry, onClose, act, onEdit, onAdd, readOnly }) {
  const s = spellInfo(srd, entry);
  const sc = SCHOOL[s.school] || { icon: '✨', color: '#a89a86' };
  const slots = data?.spellcasting.slots || [];
  const pact = data?.spellcasting.pact;
  const options = [];
  if (s.level > 0 && data) {
    slots.forEach((sl, i) => { if (i + 1 >= s.level && sl.max > 0) options.push({ key: `s${i + 1}`, level: i + 1, left: sl.max - sl.used, max: sl.max }); });
    if (pact && pact.level >= s.level) options.push({ key: 'pact', level: pact.level, pact: true, left: pact.max - pact.used, max: pact.max });
  }
  const [pick, setPick] = useState(() => (options.find((o) => o.left > 0) || options[0])?.key);
  const chosen = options.find((o) => o.key === pick);
  const castLevel = s.level ? chosen?.level || s.level : 0;
  const charLevel = data ? totalLevel(data) : 1;
  const abil = data?.spellcasting.ability;
  const am = abil ? mod(data.abilities[abil]) : 0;
  const dmg = s.damage_slot ? pickScaled(s.damage_slot, castLevel) : s.damage_char ? pickScaled(s.damage_char, charLevel) : null;
  const heal = s.heal_slot ? pickScaled(s.heal_slot, castLevel)?.replace('MOD', signed(am).replace('+', '')) : null;
  const pb = data ? 2 + Math.floor((Math.max(1, charLevel) - 1) / 4) : 2;
  const facts = [
    ['Casting time', <><CastMark time={s.casting_time} /> {s.casting_time}</>], ['Range', s.range],
    ['Components', `${s.components || ''}${s.material ? ` (${s.material})` : ''}`], ['Duration', `${s.concentration ? 'Concentration, ' : ''}${s.duration || ''}`],
    s.attack && ['Attack', `${s.attack} spell attack${abil ? ` ${signed(pb + am)}` : ''}`],
    s.save && ['Saving throw', `${ABILITY_NAMES[s.save] || s.save.toUpperCase()}${abil ? ` DC ${8 + pb + am}` : ''}${s.save_success ? ` (${s.save_success} on success)` : ''}`],
    dmg && ['Damage', `${dmg} ${s.damage_type ? s.damage_type.toLowerCase() : ''}${s.level ? ` at level ${castLevel}` : ` at character level ${charLevel}`}`],
    heal && ['Healing', `${heal}${s.level ? ` at level ${castLevel}` : ''}`],
    s.classes?.length && ['Classes', s.classes.map((c) => c[0].toUpperCase() + c.slice(1)).join(', ')],
  ].filter(Boolean);
  return (
    <Modal title="" onClose={onClose}>
      <div className="spell-head" style={{ '--school': sc.color }}>
        <span className="spell-icon big">{sc.icon}</span>
        <div className="grow">
          <h2 style={{ margin: 0 }}>{s.name}</h2>
          <div className="muted">{lvlName(s.level)} {s.school ? s.school.toLowerCase() : ''}{s.ritual ? ' (ritual)' : ''}{s.source === 'PHB' ? ' · from your PHB' : ''}</div>
        </div>
      </div>
      <div className="facts" style={{ margin: '12px 0' }}>{facts.map(([k, v]) => <div key={k}><span className="muted small">{k}</span><div>{v}</div></div>)}</div>
      {s.desc ? <div className="pre spell-text">{s.desc}</div> : <div className="muted small">No rules text for this spell (custom or not in your books). Notes: {entry?.notes || '—'}</div>}
      {s.higher_level && <div className="pre spell-text"><b>At higher levels.</b> {s.higher_level}</div>}
      {s.source === 'PHB' && <div className="muted small">Text read from your PHB scan — OCR can leave small typos.</div>}

      {act && !readOnly && (
        <div className="cast-box">
          {s.level > 0 && (options.length ? (
            <div className="row" style={{ gap: 6 }}>
              <span className="small muted">Cast with:</span>
              {options.map((o) => (
                <button key={o.key} className={`slot-btn ${pick === o.key ? 'on' : ''}`} disabled={o.left <= 0} onClick={() => setPick(o.key)}>
                  {o.pact ? 'Pact' : `L${o.level}`} <span className="small">{o.left}/{o.max}</span>
                </button>
              ))}
            </div>
          ) : <div className="small muted">No spell slots of level {s.level}+ on this sheet.</div>)}
          <div className="row">
            {(s.level === 0 || chosen) && <button className="primary" disabled={s.level > 0 && chosen.left <= 0} onClick={() => { act({ type: 'cast_spell', spell: s.name, level: castLevel, pact: !!chosen?.pact }); onClose(); }}>✨ Cast{s.level ? ` at level ${castLevel}` : ''}</button>}
            {s.ritual && <button onClick={() => { act({ type: 'cast_spell', spell: s.name, level: s.level, ritual: true }); onClose(); }}>📖 Cast as ritual (no slot)</button>}
          </div>
          {(s.concentration || /minute|hour|round|day/i.test(s.duration || '')) && <div className="small muted">Casting starts a timed effect on the Play tab{s.concentration ? ' and ends any other concentration' : ''}.</div>}
        </div>
      )}
      <div className="row end" style={{ marginTop: 12 }}>
        {onEdit && !readOnly && entry && <>
          <label className="inline small"><input type="checkbox" checked={!!entry.prepared} onChange={(e) => onEdit({ ...entry, prepared: e.target.checked })} /> Prepared</label>
          <button className="small danger" onClick={() => { onEdit(null); onClose(); }}>Remove from spellbook</button>
        </>}
        {onAdd && <button className="primary" onClick={() => { onAdd(s); onClose(); }}>+ Add to spellbook</button>}
      </div>
    </Modal>
  );
}

function Filters({ level, setLevel, levels, q, setQ, extra }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips">
        <button className={`chip ${level === 'all' ? 'on' : ''}`} onClick={() => setLevel('all')}>All</button>
        {levels.map((l) => <button key={l} className={`chip ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>{l ? ORD[l] : 'Cantrips'}</button>)}
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}><input placeholder="Search spells…" value={q} onChange={(e) => setQ(e.target.value)} />{extra}</div>
    </div>
  );
}

/** Browse every spell (SRD + your PHB) and add to the spellbook. */
export function SpellLibrary({ srd, data, onAdd, onClose }) {
  const mine = data.classes.map((c) => c.index);
  const [cls, setCls] = useState(mine[0] || 'all');
  const [level, setLevel] = useState('all');
  const [school, setSchool] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [picked, setPicked] = useState([]);
  const have = new Set(data.spells.map((s) => s.name.toLowerCase()));
  const cap = maxSpellLevel(data);
  const pool = srd.spells.filter((s) => (cls === 'all' || s.classes.includes(cls)) && (school === 'all' || s.school === school));
  const shown = pool.filter((s) => (level === 'all' || s.level === level) && (!q || s.name.toLowerCase().includes(q.toLowerCase())));
  const levels = [...new Set(pool.map((s) => s.level))].sort((a, b) => a - b);
  return (
    <Modal title="Spell library" onClose={onClose} wide>
      <div className="stack">
        <div className="row">
          <select value={cls} style={{ width: 'auto' }} onChange={(e) => setCls(e.target.value)}>
            <option value="all">Every class</option>{srd.classes.filter((c) => c.caster || ['fighter', 'rogue'].includes(c.index)).map((c) => <option key={c.index} value={c.index}>{c.name}{mine.includes(c.index) ? ' (yours)' : ''}</option>)}
          </select>
          <select value={school} style={{ width: 'auto' }} onChange={(e) => setSchool(e.target.value)}>
            <option value="all">Every school</option>{Object.keys(SCHOOL).map((k) => <option key={k} value={k}>{SCHOOL[k].icon} {k}</option>)}
          </select>
          <span className="muted small">{cap ? `Your slots reach level ${cap}.` : ''} {srd.phb_spells ? `${srd.phb_spells} PHB spells loaded from your book.` : ''}</span>
        </div>
        <Filters level={level} setLevel={setLevel} levels={levels} q={q} setQ={setQ} />
        <div className="spell-grid">
          {shown.map((s) => <SpellTile key={s.index} s={s} dim={have.has(s.name.toLowerCase()) || (s.level > cap && s.level > 0)} selected={picked.includes(s.name)} onClick={() => setOpen(s)} />)}
          {!shown.length && <div className="muted small">No spells match.</div>}
        </div>
        <div className="row between">
          <span className="muted small">{picked.length ? `Selected: ${picked.join(', ')}` : 'Tap a spell to read it, then add it. Dimmed = already known or above your slot level (still allowed).'}</span>
          <div className="row">
            <input placeholder="Custom spell name…" style={{ width: 180 }} onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) { setPicked((p) => [...p, e.target.value.trim()]); e.target.value = ''; } }} />
            <button className="primary" disabled={!picked.length} onClick={() => { onAdd(picked); onClose(); }}>Add {picked.length || ''}</button>
          </div>
        </div>
      </div>
      {open && <SpellDetail srd={srd} entry={open} onClose={() => setOpen(null)} onAdd={(s) => setPicked((p) => (p.includes(s.name) || have.has(s.name.toLowerCase()) ? p : [...p, s.name]))} />}
    </Modal>
  );
}

const entryFor = (srd, name) => {
  const s = srd?.spells.find((k) => k.name === name);
  return { name, level: s?.level ?? 1, prepared: true, concentration: !!s?.concentration, ritual: !!s?.ritual, casting_time: s?.casting_time || '', range: s?.range || '', components: s?.components || '', duration: s?.duration || '', notes: '' };
};

/** The Spells tab: slots, spell tiles by level, details & casting, library. */
export default function SpellBook({ data, edit, act, ro, srd, x }) {
  const [level, setLevel] = useState('all');
  const [q, setQ] = useState('');
  const [onlyPrepared, setOnlyPrepared] = useState(false);
  const [open, setOpen] = useState(null);
  const [library, setLibrary] = useState(false);
  const [table, setTable] = useState(false);
  const setSpells = (v) => edit((d) => ({ ...d, spells: v }));
  const spells = useMemo(() => data.spells.map((e, i) => ({ ...spellInfo(srd, e), _i: i })), [data.spells, srd]);
  const levels = [...new Set(spells.map((s) => Number(s.level) || 0))].sort((a, b) => a - b);
  const shown = spells.filter((s) => (level === 'all' || Number(s.level) === level) && (!onlyPrepared || s.prepared || !s.level) && (!q || s.name.toLowerCase().includes(q.toLowerCase())));
  const groups = [...new Set(shown.map((s) => Number(s.level) || 0))].sort((a, b) => a - b);
  const slots = data.spellcasting.slots.map((s, i) => ({ ...s, level: i + 1 })).filter((s) => s.max || s.used);
  const pact = data.spellcasting.pact;
  const go = (a) => !ro && act(a);
  return (
    <div className="stack">
      <div className="card spell-bar">
        <div className="row" style={{ gap: 16 }}>
          <div><div className="muted small">Ability</div><strong>{data.spellcasting.ability ? ABILITY_NAMES[data.spellcasting.ability] : '—'}</strong></div>
          <div><div className="muted small">Save DC</div><strong>{x.spell_dc ?? '—'}</strong></div>
          <div><div className="muted small">Attack</div><strong>{x.spell_attack != null ? signed(x.spell_attack) : '—'}</strong></div>
          <div><div className="muted small">Prepared</div><strong>{data.spells.filter((s) => s.prepared && s.level > 0).length}</strong></div>
        </div>
        <div className="slot-row">
          {slots.map((s) => (
            <div key={s.level} className="slot-group">
              <span className="muted small">L{s.level}</span>
              <div className="pips">{Array.from({ length: Math.max(s.max, s.used) }, (_, i) => {
                const used = i >= s.max - s.used;
                return <button key={i} className={`pip slot ${used ? 'used' : ''}`} disabled={ro} title={used ? 'Restore slot' : 'Use slot'} onClick={() => go({ type: used ? 'restore_slot' : 'use_slot', level: s.level })} />;
              })}</div>
            </div>
          ))}
          {pact && <div className="slot-group"><span className="muted small">Pact L{pact.level}</span><div className="pips">{Array.from({ length: pact.max }, (_, i) => {
            const used = i >= pact.max - pact.used;
            return <button key={i} className={`pip slot pact ${used ? 'used' : ''}`} disabled={ro} onClick={() => go({ type: used ? 'restore_pact' : 'use_pact' })} />;
          })}</div></div>}
          {!slots.length && !pact && <span className="muted small">No spell slots.</span>}
        </div>
      </div>

      <div className="row between">
        <div className="grow"><Filters level={level} setLevel={setLevel} levels={levels} q={q} setQ={setQ}
          extra={<label className="inline small nowrap"><input type="checkbox" checked={onlyPrepared} onChange={(e) => setOnlyPrepared(e.target.checked)} /> Prepared</label>} /></div>
      </div>
      <div className="row">
        {!ro && srd && <button className="primary" onClick={() => setLibrary(true)}>📚 Learn spells</button>}
        {!ro && <button className="small ghost" onClick={() => setTable((t) => !t)}>{table ? 'Show spellbook' : '✎ Edit as list'}</button>}
        <span className="muted small">● action · ▲ bonus action · ⟲ reaction · ★ prepared</span>
      </div>

      {table ? (
        <div className="card">
          <ListEditor readOnly={ro} items={data.spells} onChange={setSpells} blank={{ name: '', level: 1, prepared: true }}
            fields={[{ key: 'name', label: 'Spell', width: 3 }, { key: 'level', label: 'Lvl', type: 'number' }, { key: 'casting_time', label: 'Casting' }, { key: 'range', label: 'Range' }, { key: 'notes', label: 'Notes', width: 2 }, { key: 'prepared', label: 'Prepared', type: 'check' }, { key: 'concentration', label: 'C', type: 'check' }, { key: 'ritual', label: 'R', type: 'check' }]} />
        </div>
      ) : groups.length ? groups.map((g) => (
        <div key={g}>
          <h3 className="spell-group-title">{g ? `${ORD[g]} level` : 'Cantrips'} {g > 0 && data.spellcasting.slots[g - 1]?.max > 0 && <span className="muted small">· {data.spellcasting.slots[g - 1].max - data.spellcasting.slots[g - 1].used}/{data.spellcasting.slots[g - 1].max} slots</span>}</h3>
          <div className="spell-grid">{shown.filter((s) => (Number(s.level) || 0) === g).map((s) => <SpellTile key={s._i} s={s} prepared={s.prepared && s.level > 0} dim={s.level > 0 && !s.prepared} onClick={() => setOpen(s._i)} />)}</div>
        </div>
      )) : <div className="empty">No spells yet.{!ro && ' Open the library to learn some.'}</div>}

      {open != null && data.spells[open] && <SpellDetail srd={srd} data={data} entry={data.spells[open]} act={act} readOnly={ro} onClose={() => setOpen(null)}
        onEdit={(e) => setSpells(e ? data.spells.map((s, i) => (i === open ? e : s)) : data.spells.filter((_, i) => i !== open))} />}
      {library && <SpellLibrary srd={srd} data={data} onClose={() => setLibrary(false)} onAdd={(names) => setSpells([...data.spells, ...names.filter((n) => !data.spells.some((s) => s.name === n)).map((n) => entryFor(srd, n))])} />}
    </div>
  );
}
