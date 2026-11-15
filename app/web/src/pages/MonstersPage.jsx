import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { Modal, ErrorBox, useAction, useApp, useLoad, NeedParty } from '../components/ui.jsx';

const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const mod = (s) => Math.floor((Number(s) - 10) / 2);
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const CR_ORDER = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const crValue = (cr) => { const i = CR_ORDER.indexOf(String(cr)); return i < 0 ? 99 : i; };

let catalogCache = null;
const loadCatalog = () => (catalogCache ||= api.get('/monsters').catch((e) => { catalogCache = null; throw e; }));

/** A Monster Manual stat block (or a custom monster's few fields). */
export function StatBlock({ m }) {
  if (!m) return null;
  const facts = [['Armor Class', m.ac], ['Hit Points', m.hp != null ? `${m.hp}${m.hp_dice ? ` (${m.hp_dice})` : ''}` : null], ['Initiative', m.initiative != null ? signed(m.initiative) : null], ['Speed', m.speed]]
    .filter(([, v]) => v != null && v !== '');
  const lines = [['Saving Throws', Object.entries(m.saves || {}).map(([k, v]) => `${k.toUpperCase()} ${signed(v)}`).join(', ')], ['Skills', m.skills], ['Vulnerabilities', m.vulnerabilities], ['Resistances', m.resistances], ['Immunities', m.immunities], ['Gear', m.gear], ['Senses', m.senses], ['Languages', m.languages],
    ['Challenge', m.cr != null && m.cr !== '' ? `${m.cr}${m.xp ? ` (${m.xp.toLocaleString()} XP)` : ''}${m.pb ? ` · PB +${m.pb}` : ''}` : '']].filter(([, v]) => v);
  return (
    <div className="statblock stack" style={{ gap: 8 }}>
      {m.type && <div className="muted small"><i>{m.type}</i>{m.page ? ` · Monster Manual p. ${m.page}` : ''}</div>}
      <div className="facts">{facts.map(([k, v]) => <div key={k}><span className="muted small">{k}</span><div>{v}</div></div>)}</div>
      {Object.keys(m.abilities || {}).length > 0 && (
        <div className="abil-row">{ABIL.map((a) => <div key={a}><span className="muted small">{a.toUpperCase()}</span><div>{m.abilities[a] ?? '—'}{m.abilities[a] != null && <span className="muted small"> ({signed(mod(m.abilities[a]))})</span>}</div></div>)}</div>
      )}
      {lines.length > 0 && <div className="small stack" style={{ gap: 2 }}>{lines.map(([k, v]) => <div key={k}><b>{k}</b> {v}</div>)}</div>}
      {(m.sections || []).map((s) => (
        <div key={s.name}>
          <div className="inv-group">{s.name}</div>
          {s.entries.map((e, i) => <p key={i} className="small" style={{ margin: '4px 0' }}>{e.name && <b><i>{e.name}.</i> </b>}{e.text}</p>)}
        </div>
      ))}
      {m.notes && <div className="pre small">{m.notes}</div>}
      {m.source === 'MM' && <div className="muted small">Read from your Monster Manual scan, so the odd OCR typo can slip through. Check the book when it matters.</div>}
    </div>
  );
}

function AddModal({ monster, onAdd, onClose }) {
  const [count, setCount] = useState(1);
  const [run, busy, err] = useAction();
  return (
    <Modal title={`🐉 ${monster.name}`} onClose={onClose} wide>
      <StatBlock m={monster} />
      <ErrorBox error={err} />
      <div className="row end" style={{ marginTop: 12, position: 'sticky', bottom: 0, background: 'var(--panel)', paddingTop: 8 }}>
        <label className="inline">How many <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 70 }} /></label>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => run(async () => { await onAdd({ index: monster.index, count: Number(count) || 1 }); onClose(); })}>Add to field</button>
      </div>
    </Modal>
  );
}

function CustomModal({ onAdd, onClose }) {
  const [f, setF] = useState({ name: '', ac: '', hp: '', cr: '', type: '', speed: '', notes: '' });
  const [count, setCount] = useState(1);
  const [run, busy, err] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Custom monster" onClose={onClose}>
      <div className="stack">
        <div className="grid two">
          <div><label>Name</label><input autoFocus value={f.name} onChange={set('name')} placeholder="Bandit lieutenant" /></div>
          <div><label>Type</label><input value={f.type} onChange={set('type')} placeholder="Medium Humanoid" /></div>
          <div><label>Armor Class</label><input type="number" value={f.ac} onChange={set('ac')} /></div>
          <div><label>Hit Points</label><input type="number" value={f.hp} onChange={set('hp')} /></div>
          <div><label>Challenge rating</label><input value={f.cr} onChange={set('cr')} placeholder="1/2" /></div>
          <div><label>Speed</label><input value={f.speed} onChange={set('speed')} placeholder="30 ft." /></div>
        </div>
        <div><label>Notes / attacks</label><textarea rows={5} value={f.notes} onChange={set('notes')} placeholder="Scimitar +4, 1d6+2 slashing…" /></div>
        <ErrorBox error={err} />
        <div className="row end">
          <label className="inline">How many <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 70 }} /></label>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !f.name.trim()} onClick={() => run(async () => { await onAdd({ monster: f, count: Number(count) || 1 }); onClose(); })}>Add to field</button>
        </div>
      </div>
    </Modal>
  );
}

/** An input that saves when you leave it (or press Enter), so typing never fights a reload. */
function LazyInput({ value, onCommit, as = 'input', ...props }) {
  const [v, setV] = useState(value ?? '');
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setV(value ?? ''); }
  const commit = () => { if (String(v) !== String(value ?? '')) onCommit(v); };
  const Tag = as;
  return <Tag {...props} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter' && as === 'input') e.currentTarget.blur(); }} />;
}

const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];
const SECTION_NAMES = ['Traits', 'Actions', 'Bonus Actions', 'Reactions', 'Legendary Actions'];

/** Active conditions as chips (tap to clear) plus the full 5e list to pick from. Stored as "Prone, Poisoned". */
function ConditionPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const active = String(value || '').split(',').map((c) => c.trim()).filter(Boolean);
  const toggle = (c) => onChange((active.includes(c) ? active.filter((x) => x !== c) : [...active, c]).join(', '));
  return (
    <div className="chips">
      {active.map((c) => <button key={c} className="chip on" title="Tap to remove" onClick={() => toggle(c)}>{c} ✕</button>)}
      <button className="chip" onClick={() => setOpen((o) => !o)}>{open ? 'Done' : '+ Condition'}</button>
      {open && CONDITIONS.filter((c) => !active.includes(c)).map((c) => <button key={c} className="chip" onClick={() => toggle(c)}>{c}</button>)}
    </div>
  );
}

/** Every trait / action in the Monster Manual, for suggestions: [{ section, name, text, from }] (deduplicated). */
let entryIndex = null;
async function loadEntryIndex() {
  if (entryIndex) return entryIndex;
  const seen = new Set();
  entryIndex = [];
  for (const m of await loadCatalog()) for (const sec of m.sections || []) for (const e of sec.entries || []) {
    const key = `${e.name}|${e.text}`.toLowerCase();
    if (e.name && !seen.has(key)) { seen.add(key); entryIndex.push({ section: sec.name, name: e.name, text: e.text, from: m.name, low: e.name.toLowerCase() }); }
  }
  return entryIndex;
}

/** The entry name field, with matching traits/actions from the book to pick (fills in the text too). */
function EntryNameInput({ value, section, onPick, onChange }) {
  const [focus, setFocus] = useState(false);
  const { data: all } = useLoad(loadEntryIndex, []);
  const q = value.trim().toLowerCase();
  const hits = focus && q.length >= 2 && all
    ? all.filter((e) => e.low.includes(q) || e.text.toLowerCase().includes(q))
      .sort((a, b) => (b.section === section) - (a.section === section) || b.low.startsWith(q) - a.low.startsWith(q) || a.name.length - b.name.length)
      .slice(0, 8)
    : [];
  return (
    <div className="grow suggest">
      <input value={value} placeholder="Name: type to search the book (e.g. Bite, Multiattack, Pack Tactics)"
        onChange={(e) => onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
      {hits.length > 0 && (
        <div className="suggest-list">
          {hits.map((e, i) => (
            <button key={i} type="button" className="ghost left" onMouseDown={(ev) => ev.preventDefault()} onClick={() => { onPick(e); setFocus(false); }}>
              <b>{e.name}</b> <span className="muted small">· {e.section} · {e.from}</span>
              <div className="small muted">{e.text.length > 140 ? `${e.text.slice(0, 140)}…` : e.text}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Edit this slot's own copy of the stat block: header values, scores and every trait / action. */
function EditStatBlock({ s, onSave, onClose }) {
  const m0 = s.monster;
  const [hp, setHp] = useState({ hp: s.hp, hp_max: s.hp_max, temp_hp: s.temp_hp, ac: s.ac ?? '', roll: s.initiative ?? '' });
  const setH = (k) => (e) => setHp({ ...hp, [k]: e.target.value });
  const [m, setM] = useState(() => ({
    type: m0.type || '', cr: m0.cr || '', speed: m0.speed || '', hp_dice: m0.hp_dice || '', initiative: m0.initiative ?? '',
    skills: m0.skills || '', senses: m0.senses || '', languages: m0.languages || '', resistances: m0.resistances || '', immunities: m0.immunities || '', vulnerabilities: m0.vulnerabilities || '', gear: m0.gear || '',
    abilities: { ...(m0.abilities || {}) },
    sections: (m0.sections || []).map((x) => ({ name: x.name, entries: x.entries.map((e) => ({ ...e })) })),
  }));
  const [run, busy, err] = useAction();
  const set = (k) => (e) => setM({ ...m, [k]: e.target.value });
  const setSec = (si, fn) => setM({ ...m, sections: m.sections.map((x, i) => (i === si ? fn(x) : x)) });
  const setEntry = (si, ei, k, v) => setSec(si, (x) => ({ ...x, entries: x.entries.map((e, j) => (j === ei ? { ...e, [k]: v } : e)) }));
  return (
    <Modal title={`✎ ${s.name}`} onClose={onClose} wide>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>Changes apply to this monster on the field only, not to the Monster Manual.</p>
        <div className="grid three">
          <div><label>Current HP</label><input type="number" value={hp.hp} onChange={setH('hp')} /></div>
          <div><label>Max HP <span className="muted small">(raising it heals too)</span></label><input type="number" value={hp.hp_max} onChange={setH('hp_max')} /></div>
          <div><label>Temp HP</label><input type="number" value={hp.temp_hp} onChange={setH('temp_hp')} /></div>
          <div><label>Armor Class</label><input type="number" value={hp.ac} onChange={setH('ac')} /></div>
          <div><label>Initiative (rolled)</label><input type="number" value={hp.roll} onChange={setH('roll')} /></div>
        </div>
        <div className="grid three">
          <div><label>Type</label><input value={m.type} onChange={set('type')} placeholder="Medium Humanoid, Neutral" /></div>
          <div><label>Challenge rating</label><input value={m.cr} onChange={set('cr')} /></div>
          <div><label>Initiative bonus</label><input type="number" value={m.initiative} onChange={set('initiative')} /></div>
          <div><label>Speed</label><input value={m.speed} onChange={set('speed')} /></div>
          <div><label>Hit dice</label><input value={m.hp_dice} onChange={set('hp_dice')} placeholder="8d8 + 16" /></div>
        </div>
        <div className="abil-row">{ABIL.map((a) => (
          <div key={a}><span className="muted small">{a.toUpperCase()}</span>
            <input type="number" value={m.abilities[a] ?? ''} style={{ textAlign: 'center' }}
              onChange={(e) => setM({ ...m, abilities: { ...m.abilities, [a]: e.target.value === '' ? undefined : Number(e.target.value) } })} /></div>
        ))}</div>
        <div className="grid two">
          {[['skills', 'Skills'], ['senses', 'Senses'], ['languages', 'Languages'], ['resistances', 'Resistances'], ['immunities', 'Immunities'], ['vulnerabilities', 'Vulnerabilities'], ['gear', 'Gear']].map(([k, l]) => (
            <div key={k}><label>{l}</label><input value={m[k]} onChange={set(k)} /></div>
          ))}
        </div>
        {m.sections.map((sec, si) => (
          <div key={si} className="card stack" style={{ gap: 6 }}>
            <div className="row">
              <select value={sec.name} onChange={(e) => setSec(si, (x) => ({ ...x, name: e.target.value }))} style={{ width: 'auto' }}>
                {[...new Set([...SECTION_NAMES, sec.name])].map((n) => <option key={n}>{n}</option>)}
              </select>
              <span className="grow" />
              <button className="small danger" onClick={() => setM({ ...m, sections: m.sections.filter((_, i) => i !== si) })}>Remove section</button>
            </div>
            {sec.entries.map((e, ei) => (
              <div key={ei} className="stack" style={{ gap: 4 }}>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <EntryNameInput value={e.name} section={sec.name} onChange={(v) => setEntry(si, ei, 'name', v)}
                    onPick={(pick) => setSec(si, (x) => ({ ...x, entries: x.entries.map((en, j) => (j === ei ? { name: pick.name, text: pick.text } : en)) }))} />
                  <button className="small ghost" title="Remove" onClick={() => setSec(si, (x) => ({ ...x, entries: x.entries.filter((_, j) => j !== ei) }))}>✕</button>
                </div>
                <textarea rows={2} value={e.text} placeholder="Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d8 + 3) Piercing damage." onChange={(ev) => setEntry(si, ei, 'text', ev.target.value)} />
              </div>
            ))}
            <button className="small" onClick={() => setSec(si, (x) => ({ ...x, entries: [...x.entries, { name: '', text: '' }] }))}>+ Entry</button>
          </div>
        ))}
        <div className="row">
          <button className="small" onClick={() => setM({ ...m, sections: [...m.sections, { name: SECTION_NAMES.find((n) => !m.sections.some((x) => x.name === n)) || 'Traits', entries: [{ name: '', text: '' }] }] })}>+ Section</button>
        </div>
        <ErrorBox error={err} />
        <div className="row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => run(async () => {
            const sections = m.sections.map((x) => ({ ...x, entries: x.entries.filter((e) => e.name.trim() || e.text.trim()) })).filter((x) => x.entries.length);
            const n = (v) => (v === '' || v == null ? null : Number(v));
            const body = { monster: { ...m, initiative: n(m.initiative), sections }, hp_max: n(hp.hp_max), temp_hp: n(hp.temp_hp) ?? 0, ac: n(hp.ac), initiative: n(hp.roll) };
            // Only send current HP when it was changed here, so raising max HP can heal by the difference.
            if (String(hp.hp) !== String(s.hp)) body.hp = n(hp.hp);
            await onSave(body);
            onClose();
          })}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

/** One monster on the field: HP with damage/heal, initiative, conditions, notes and its (editable) stat block. */
function Slot({ s, cid, onChanged, onRemove }) {
  const [amt, setAmt] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [run, busy, err] = useAction();
  const patch = (body) => run(async () => { await api.patch(`/campaigns/${cid}/field/${s.id}`, body); await onChanged(); });
  const pct = s.hp_max ? Math.max(0, Math.min(100, (s.hp / s.hp_max) * 100)) : 0;
  const down = s.hp_max > 0 && s.hp <= 0;
  const hit = (key) => { const n = Number(amt); if (n > 0) { patch({ [key]: n }); setAmt(''); } };
  const num = (v) => (v === '' ? null : Number(v));
  return (
    <div className={`card stack field-slot ${down ? 'down' : ''}`} style={{ gap: 8 }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <LazyInput className="init" type="number" title="Initiative" placeholder="Init" value={s.initiative ?? ''} onCommit={(v) => patch({ initiative: num(v) })} />
        <div className="grow">
          <LazyInput className="slot-name" value={s.name} onCommit={(v) => patch({ name: v })} />
          <div className="muted small">{down ? '💀 Down · ' : ''}AC {s.ac ?? '—'}{s.monster.speed ? ` · ${s.monster.speed}` : ''}{s.monster.cr ? ` · CR ${s.monster.cr}` : ''}{s.monster.type ? ` · ${s.monster.type.split(',')[0]}` : ''}{s.monster.edited ? ' · ✎ edited' : ''}</div>
        </div>
        <button className="small ghost" title="Remove from the field" onClick={onRemove}>✕</button>
      </div>
      <div className="hp-bar" title={`${s.hp} / ${s.hp_max} HP`}><div style={{ width: `${pct}%`, background: pct > 50 ? 'var(--green)' : pct > 25 ? 'var(--gold)' : 'var(--red)' }} /></div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <b className="nowrap">{s.hp} / {s.hp_max} HP</b>{s.temp_hp > 0 && <span className="badge gold">+{s.temp_hp} temp</span>}
        <span className="grow" />
        <input type="number" min={0} inputMode="numeric" placeholder="amount" value={amt} onChange={(e) => setAmt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hit('damage')} style={{ width: 80 }} />
        <button className="small danger" disabled={busy || !(Number(amt) > 0)} onClick={() => hit('damage')}>Damage</button>
        <button className="small" disabled={busy || !(Number(amt) > 0)} onClick={() => hit('heal')}>Heal</button>
      </div>
      <ConditionPicker value={s.conditions} onChange={(v) => patch({ conditions: v })} />
      <div className="row">
        <button className="small ghost" onClick={() => setOpen((o) => !o)}>{open ? '▾ Hide stat block' : '▸ Stat block & notes'}</button>
        <span className="grow" />
        <button className="small" title="Add more of this monster, edits included" onClick={() => {
          const n = prompt(`How many more ${s.name.replace(/\s+\d+$/, '')}? (copies keep your edits and start at full HP)`, '1');
          if (n && Number(n) > 0) run(async () => { await api.post(`/campaigns/${cid}/field/${s.id}/duplicate`, { count: Number(n) }); await onChanged(); });
        }}>⧉ Duplicate</button>
        <button className="small" onClick={() => setEditing(true)}>✎ Edit</button>
      </div>
      {open && (
        <div className="stack" style={{ gap: 8 }}>
          <StatBlock m={{ ...s.monster, ac: s.ac, hp: s.hp_max }} />
          <div><label>Notes</label><LazyInput as="textarea" rows={2} value={s.notes} placeholder="Your notes for this monster…" onCommit={(v) => patch({ notes: v })} /></div>
        </div>
      )}
      {editing && <EditStatBlock s={s} onClose={() => setEditing(false)} onSave={(body) => api.patch(`/campaigns/${cid}/field/${s.id}`, body).then(onChanged)} />}
      <ErrorBox error={err} />
    </div>
  );
}

export default function MonstersPage() {
  const { campaign } = useApp();
  const cid = campaign?.id;
  const isDm = campaign?.role === 'dm';
  const { data: field, error, reload, setData: setField } = useLoad(() => (cid && isDm ? api.get(`/campaigns/${cid}/field`) : Promise.resolve([])), [cid, isDm]);
  const { data: catalog, error: catErr } = useLoad(() => (isDm ? loadCatalog() : Promise.resolve([])), [isDm]);
  const [q, setQ] = useState('');
  const [cr, setCr] = useState('');
  const [preview, setPreview] = useState(null);
  const [custom, setCustom] = useState(false);
  const [run, , actErr] = useAction();

  const shown = useMemo(() => (catalog || [])
    .filter((m) => (!q || m.name.toLowerCase().includes(q.toLowerCase()) || (m.type || '').toLowerCase().includes(q.toLowerCase())) && (!cr || String(m.cr) === cr))
    .slice(0, 200), [catalog, q, cr]);
  // Initiative order once rolled; otherwise the order they were added.
  const ordered = useMemo(() => [...(field || [])].sort((a, b) => (b.initiative ?? -99) - (a.initiative ?? -99) || a.sort - b.sort), [field]);

  if (!cid) return <NeedParty />;
  if (!isDm) return <div className="empty">Only the party's DM can see the monsters.</div>;

  const add = async (body) => { await api.post(`/campaigns/${cid}/field`, body); await reload(); };
  const rollInitiative = () => run(async () => {
    for (const s of field.filter((x) => x.initiative == null)) {
      const bonus = s.monster.initiative ?? (s.monster.abilities?.dex != null ? mod(s.monster.abilities.dex) : 0);
      await api.patch(`/campaigns/${cid}/field/${s.id}`, { initiative: 1 + Math.floor(Math.random() * 20) + bonus });
    }
    await reload();
  });
  const crs = [...new Set((catalog || []).map((m) => String(m.cr ?? '')).filter(Boolean))].sort((a, b) => crValue(a) - crValue(b));

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Monsters</h1>
        <span className="badge">DM only</span>
      </div>
      <ErrorBox error={error || actErr} />
      <div className="grid two monsters-layout">
        <div className="stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>On the field {field?.length ? <span className="muted small">({field.filter((s) => s.hp > 0 || !s.hp_max).length} standing)</span> : null}</h2>
            <div className="row">
              {field?.some((s) => s.initiative == null) && <button className="small" onClick={rollInitiative}>🎲 Roll initiative</button>}
              {field?.length > 0 && <button className="small danger" onClick={() => confirm('Remove every monster from the field?') && run(async () => { await api.del(`/campaigns/${cid}/field/all`); await reload(); })}>Clear field</button>}
            </div>
          </div>
          {!field?.length && <div className="empty">No monsters on the field. Pick some from the Monster Manual.</div>}
          {ordered.map((s) => (
            <Slot key={s.id} s={s} cid={cid} onChanged={reload}
              onRemove={() => run(async () => { setField(field.filter((x) => x.id !== s.id)); await api.del(`/campaigns/${cid}/field/${s.id}`); await reload(); })} />
          ))}
        </div>

        <div className="card stack">
          <div className="row between">
            <h3 style={{ margin: 0 }}>Monster Manual</h3>
            <button className="small" onClick={() => setCustom(true)}>+ Custom monster</button>
          </div>
          <ErrorBox error={catErr} />
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input placeholder="Search name or type…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={cr} onChange={(e) => setCr(e.target.value)} style={{ width: 110 }}><option value="">Any CR</option>{crs.map((c) => <option key={c} value={c}>CR {c}</option>)}</select>
          </div>
          {catalog && !catalog.length && <div className="notice small">No Monster Manual found on the server. Put the PDF next to the app (see README → Monster Manual). Custom monsters work without it.</div>}
          <div className="catalog">
            {shown.map((m) => (
              <div key={m.index} className="catalog-row">
                <button className="ghost grow left" onClick={() => setPreview(m)}>
                  <span className="grow">{m.name}</span>
                  <span className="muted small nowrap">{[m.cr != null && `CR ${m.cr}`, m.ac != null && `AC ${m.ac}`, m.hp != null && `${m.hp} HP`].filter(Boolean).join(' · ')}</span>
                </button>
                <button className="small primary" onClick={() => run(() => add({ index: m.index, count: 1 }))}>Add</button>
              </div>
            ))}
            {catalog && !shown.length && catalog.length > 0 && <div className="muted small">Nothing matches.</div>}
          </div>
        </div>
      </div>
      {preview && <AddModal monster={preview} onAdd={add} onClose={() => setPreview(null)} />}
      {custom && <CustomModal onAdd={add} onClose={() => setCustom(false)} />}
    </div>
  );
}
