import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, loadRules, resizeImage } from '../api.js';
import { Modal, ErrorBox, ListInput, useAction, useApp, useLoad } from '../components/ui.jsx';
import { ABILITIES, ABILITY_NAMES, SKILLS, derived as derive, signed, normalizeCharacter, suggestedSlots, suggestedResources } from '../../../shared/rules.js';
import { applyLevel, suggestedAc } from '../lib/character.js';
import { armorClass } from '../../../shared/items.js';
import PlayTab from '../components/PlayTab.jsx';
import HistoryTab from '../components/HistoryTab.jsx';
import ListEditor from '../components/ListEditor.jsx';
import LevelChoice from '../components/LevelChoice.jsx';
import SpellBook from '../components/SpellBook.jsx';
import InventoryTab from '../components/InventoryTab.jsx';
import { ALIGNMENTS } from '../components/Choices.jsx';
import { useCharacterLifecycle } from './CharactersPage.jsx';

const SKILL_CYCLE = { undefined: 'prof', prof: 'expert', expert: undefined };

function LevelUpModal({ srd, data, onClose, onApply }) {
  const [choice, setChoice] = useState({ class: data.classes[0]?.index || 'fighter' });
  return (
    <Modal title={`Level up → level ${data.classes.reduce((s, c) => s + c.level, 0) + 1}`} onClose={onClose} wide>
      <LevelChoice srd={srd} data={data} choice={choice} onChange={setChoice} />
      <div className="row end" style={{ marginTop: 14 }}><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => onApply(applyLevel(srd, data, choice), choice)}>⬆ Level up</button></div>
    </Modal>
  );
}

const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

/** Who the character is — editable by hand, for people filling in a blank sheet without the builder. */
function IdentityCard({ data, edit, ro, srd }) {
  const set = (k, v) => edit((d) => ({ ...d, [k]: v }));
  const named = (list, name) => (name ? { index: list?.find((r) => r.name.toLowerCase() === name.toLowerCase())?.index || slug(name), name } : null);
  const setClass = (i, p) => edit((d) => ({ ...d, classes: d.classes.map((c, j) => (j === i ? { ...c, ...p } : c)) }));
  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Character</h3>
      <div className="grid three">
        <div><label>Species</label><input list="dl-races" disabled={ro} value={data.race?.name || ''} onChange={(e) => set('race', named(srd?.races, e.target.value))} /></div>
        <div><label>Subspecies / lineage</label><input list="dl-subraces" disabled={ro} value={data.subrace?.name || ''} onChange={(e) => set('subrace', named(srd?.races.flatMap((r) => r.subraces), e.target.value))} /></div>
        <div><label>Background</label><input list="dl-bgs" disabled={ro} value={data.background?.name || ''} onChange={(e) => set('background', named(srd?.backgrounds, e.target.value))} /></div>
      </div>
      <datalist id="dl-races">{srd?.races.map((r) => <option key={r.index} value={r.name} />)}</datalist>
      <datalist id="dl-subraces">{srd?.races.flatMap((r) => r.subraces).map((r) => <option key={r.index} value={r.name} />)}</datalist>
      <datalist id="dl-bgs">{srd?.backgrounds.map((r) => <option key={r.index} value={r.name} />)}</datalist>
      <div className="stack" style={{ gap: 6 }}>
        <label style={{ margin: 0 }}>Classes</label>
        {data.classes.map((c, i) => {
          const def = srd?.classes.find((k) => k.index === c.index);
          return (
            <div key={i} className="class-row">
              <input list="dl-classes" disabled={ro} value={c.name} placeholder="Class" onChange={(e) => {
                const d2 = srd?.classes.find((k) => k.name.toLowerCase() === e.target.value.toLowerCase());
                setClass(i, { name: e.target.value, index: d2?.index || slug(e.target.value), ...(d2 ? { hit_die: d2.hit_die } : {}) });
              }} />
              <input type="number" min="1" max="20" disabled={ro} value={c.level} title="Level" onChange={(e) => setClass(i, { level: Number(e.target.value) })} />
              <input list={`dl-sub-${i}`} disabled={ro} value={c.subclass_name || ''} placeholder={def?.subclass_flavor || 'Subclass'} onChange={(e) => setClass(i, { subclass_name: e.target.value, subclass: def?.subclasses.find((s2) => s2.name === e.target.value)?.index || slug(e.target.value) })} />
              <datalist id={`dl-sub-${i}`}>{def?.subclasses.map((s2) => <option key={s2.index} value={s2.name} />)}</datalist>
              <select disabled={ro} value={c.hit_die || 8} title="Hit die" onChange={(e) => setClass(i, { hit_die: Number(e.target.value) })}>{[6, 8, 10, 12].map((n) => <option key={n} value={n}>d{n}</option>)}</select>
              {!ro && <button className="ghost small" title="Remove class" onClick={() => edit((d) => ({ ...d, classes: d.classes.filter((_, j) => j !== i) }))}>✕</button>}
            </div>
          );
        })}
        <datalist id="dl-classes">{srd?.classes.map((r) => <option key={r.index} value={r.name} />)}</datalist>
        {!ro && <div className="row">
          <button className="small" onClick={() => edit((d) => ({ ...d, classes: [...d.classes, { index: '', name: '', level: 1, hit_die: 8, subclass: '', subclass_name: '' }] }))}>+ Class</button>
          {data.classes.length > 0 && <button className="small" onClick={() => edit((d) => {
            const hd = {};
            for (const c of d.classes) { const k = `d${c.hit_die || 8}`; hd[k] = { total: (hd[k]?.total || 0) + (Number(c.level) || 0), used: Math.min(d.hit_dice[k]?.used || 0, (hd[k]?.total || 0) + (Number(c.level) || 0)) }; }
            const saves = d.saves.length ? d.saves : srd?.classes.find((k) => k.index === d.classes[0].index)?.saves || [];
            return { ...d, hit_dice: hd, saves };
          })}>↻ Hit dice from classes</button>}
        </div>}
      </div>
    </div>
  );
}

export function StatsTab({ data, edit, ro, x, srd }) {
  const set = (k, v) => edit((d) => ({ ...d, [k]: v }));
  const [openSkill, setOpenSkill] = useState(null);
  const skillDesc = (n) => srd?.skills.find((k) => k.name === n)?.desc;
  const ac = srd ? armorClass(data, srd) : null;
  return (
    <div className="stack">
      <IdentityCard data={data} edit={edit} ro={ro} srd={srd} />
      <div className="abilities">
        {ABILITIES.map((a) => (
          <div key={a} className="ability">
            <div className="name">{ABILITY_NAMES[a]}</div>
            <div className="mod">{signed(x.mods[a])}</div>
            <input type="number" disabled={ro} value={data.abilities[a]} onChange={(e) => set('abilities', { ...data.abilities, [a]: Number(e.target.value) })} />
          </div>
        ))}
      </div>
      <div className="grid three">
        <div className="card">
          <h3>Saving throws</h3>
          {ABILITIES.map((a) => (
            <div key={a} className="skill-row">
              <button className={`prof-toggle ${data.saves.includes(a) ? 'prof' : ''}`} disabled={ro} onClick={() => set('saves', data.saves.includes(a) ? data.saves.filter((s) => s !== a) : [...data.saves, a])} />
              <strong>{signed(x.saves[a])}</strong><span>{ABILITY_NAMES[a]}</span>
            </div>
          ))}
          <h3 style={{ marginTop: 14 }}>Skills</h3>
          <div className="muted small" style={{ marginBottom: 4 }}>Circle: tap for proficient (+{x.pb}) → expertise ★ (+{x.pb * 2}) → none. Tap a skill name to read what it covers.</div>
          {Object.entries(SKILLS).map(([s, a]) => (
            <div key={s}>
              <div className="skill-row">
                <button className={`prof-toggle ${data.skills[s] || ''}`} disabled={ro} title="None → proficient → expertise" onClick={() => {
                  const next = { ...data.skills }; const v = SKILL_CYCLE[data.skills[s]];
                  if (v) next[s] = v; else delete next[s];
                  set('skills', next);
                }}>{data.skills[s] === 'expert' ? '★' : ''}</button>
                <strong>{signed(x.skills[s])}</strong>
                <button className="skill-name" onClick={() => setOpenSkill(openSkill === s ? null : s)}>{s} <span className="muted small">{a}</span>{data.skills[s] && <span className="badge gold" style={{ marginLeft: 6 }}>{data.skills[s] === 'expert' ? 'expertise' : 'proficient'}</span>}</button>
              </div>
              {openSkill === s && <div className="skill-info small">{skillDesc(s) || 'No description.'}<div className="muted" style={{ marginTop: 4 }}>{ABILITY_NAMES[a]} modifier {signed(x.mods[a])}{data.skills[s] ? ` + proficiency ${data.skills[s] === 'expert' ? `×2 (${signed(x.pb * 2)})` : signed(x.pb)}` : ''} = {signed(x.skills[s])}</div></div>}
            </div>
          ))}
          <div className="muted small" style={{ marginTop: 6 }}>Passive Perception {x.passive_perception}</div>
        </div>
        <div className="card stack">
          <h3>Combat</h3>
          <div className="grid two">
            <div><label>Armor class <a href="#" className="small" title={ac?.source} onClick={(e) => { e.preventDefault(); !ro && set('ac', suggestedAc(data, srd)); }}>(suggest {ac?.ac ?? '—'})</a></label><input type="number" disabled={ro} value={data.ac} onChange={(e) => set('ac', Number(e.target.value))} /></div>
            <div><label>Speed</label><input type="number" disabled={ro} value={data.speed} onChange={(e) => set('speed', Number(e.target.value))} /></div>
            <div><label>Initiative bonus (extra)</label><input type="number" disabled={ro} value={data.initiative_bonus} onChange={(e) => set('initiative_bonus', Number(e.target.value))} /></div>
            <div><label>Size</label><input disabled={ro} value={data.size} onChange={(e) => set('size', e.target.value)} /></div>
            <div><label>Max HP</label><input type="number" disabled={ro} value={data.hp.max} onChange={(e) => set('hp', { ...data.hp, max: Number(e.target.value) })} /></div>
            <div><label>Current HP</label><input type="number" disabled={ro} value={data.hp.current} onChange={(e) => set('hp', { ...data.hp, current: Number(e.target.value) })} /></div>
            <div><label>XP</label><input type="number" disabled={ro} value={data.xp} onChange={(e) => set('xp', Number(e.target.value))} /></div>
            <div><label>Alignment</label><input list="dl-align" disabled={ro} value={data.alignment} onChange={(e) => set('alignment', e.target.value)} title={ALIGNMENTS.find(([a]) => a === data.alignment)?.[1] || ''} />
              <datalist id="dl-align">{ALIGNMENTS.map(([a]) => <option key={a} value={a} />)}</datalist></div>
          </div>
          {ALIGNMENTS.find(([a]) => a === data.alignment) && <div className="small muted">{data.alignment}: {ALIGNMENTS.find(([a]) => a === data.alignment)[1]}</div>}
          <h3>Weapons & damage cantrips</h3>
          <ListEditor readOnly={ro} items={data.attacks} onChange={(v) => set('attacks', v)} blank={{ name: '', bonus: '', damage: '', notes: '' }}
            fields={[{ key: 'name', label: 'Name', width: 2 }, { key: 'bonus', label: 'Atk / DC' }, { key: 'damage', label: 'Damage & type', width: 2 }, { key: 'notes', label: 'Notes', width: 2 }]} />
          {srd && !ro && <details><summary className="small muted">Add a weapon from the PHB list</summary>
            <select onChange={(e) => {
              const w = srd.weapons.find((k) => k.name === e.target.value); if (!w) return;
              const finesse = w.properties.includes('Finesse'), ranged = /Ranged/.test(w.category);
              const am = ranged ? x.mods.dex : finesse ? Math.max(x.mods.str, x.mods.dex) : x.mods.str;
              set('attacks', [...data.attacks, { name: w.name, bonus: signed(am + x.pb), damage: `${w.damage}${am ? ` ${signed(am)}` : ''}`, notes: w.properties.join(', ') }]);
              e.target.value = '';
            }}><option value="">Choose…</option>{srd.weapons.map((w) => <option key={w.name}>{w.name}</option>)}</select>
          </details>}
        </div>
        <div className="card stack">
          <h3>Proficiencies & languages</h3>
          {[['armor', 'Armor'], ['weapons', 'Weapons'], ['tools', 'Tools'], ['languages', 'Languages']].map(([k, l]) => (
            <div key={k}><label>{l}</label><ListInput area disabled={ro} value={data.proficiencies[k]} placeholder="Separate with commas" onChange={(v) => set('proficiencies', { ...data.proficiencies, [k]: v })} /></div>
          ))}
          <h3>Spellcasting</h3>
          <div className="row">
            <select disabled={ro} value={data.spellcasting.ability || ''} style={{ width: 'auto' }} onChange={(e) => set('spellcasting', { ...data.spellcasting, ability: e.target.value || null })}>
              <option value="">No spellcasting</option>{ABILITIES.map((a) => <option key={a} value={a}>{ABILITY_NAMES[a]}</option>)}
            </select>
            {x.spell_dc && <span className="muted small">DC {x.spell_dc} · +{x.spell_attack}</span>}
          </div>
          <div className="row" style={{ gap: 4 }}>
            {data.spellcasting.slots.map((s, i) => (
              <div key={i} className="center" style={{ width: 46 }}><div className="muted small">L{i + 1}</div>
                <input type="number" min="0" disabled={ro} value={s.max} style={{ padding: 3, textAlign: 'center' }} onChange={(e) => set('spellcasting', { ...data.spellcasting, slots: data.spellcasting.slots.map((t, j) => (j === i ? { ...t, max: Number(e.target.value) } : t)) })} /></div>
            ))}
          </div>
          <h3>Resources (custom allowed)</h3>
          <ListEditor readOnly={ro} items={data.resources} onChange={(v) => set('resources', v)} blank={{ name: '', max: 1, used: 0, recharge: 'long' }}
            fields={[{ key: 'name', label: 'Name', width: 2 }, { key: 'max', label: 'Max', type: 'number' }, { key: 'recharge', label: 'short/long/none' }]} />
          <div className="muted small">Hit dice: {Object.entries(data.hit_dice).map(([d, h]) => `${h.total}${d}`).join(' + ') || '—'}</div>
          {srd && !ro && <button className="small" onClick={() => {
            const s = suggestedSlots(data.classes, srd);
            const fresh = suggestedResources(data, srd);
            edit((d) => ({
              ...d,
              spellcasting: { ...d.spellcasting, slots: s.slots.map((max, i) => ({ max, used: d.spellcasting.slots[i]?.used || 0 })), pact: s.pact ? { ...s.pact, used: d.spellcasting.pact?.used || 0 } : null },
              resources: [...fresh.map((f) => ({ ...f, used: d.resources.find((r) => r.key === f.key)?.used || 0 })), ...d.resources.filter((r) => !r.key || !fresh.some((f) => f.key === r.key))],
            }));
          }}>↻ Recalculate slots & class resources from levels</button>}
        </div>
      </div>
    </div>
  );
}

export default function SheetPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { campaigns, me } = useApp();
  const { data: srd } = useLoad(loadRules, []);
  const [ch, setCh] = useState(null);
  const [data, setData] = useState(null);
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'play');
  const [status, setStatus] = useState('');
  const [toast, setToast] = useState('');
  const [levelUp, setLevelUp] = useState(false);
  const [run, , error, setError] = useAction();
  const life = useCharacterLifecycle((what) => (what === 'delete' ? nav('/characters') : load()));
  const dirty = useRef(false);
  const timer = useRef(null);
  const latest = useRef(null);
  latest.current = data;

  const load = useCallback(async () => {
    const c = await api.get(`/characters/${id}`);
    setCh(c); setData(normalizeCharacter(c.data));
  }, [id]);
  useEffect(() => { load().catch(setError); }, [load, setError]);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setStatus('Saving…');
    try {
      await api.put(`/characters/${id}`, { data: latest.current, kind: 'autosave' });
      setStatus('Saved');
    } catch (e) { dirty.current = true; setStatus(''); setError(e); }
  }, [id, setError]);

  // Pick up changes made elsewhere (DM, AI assistant) while nothing is pending locally.
  useEffect(() => {
    const t = setInterval(async () => {
      if (dirty.current || document.hidden) return;
      try {
        const c = await api.get(`/characters/${id}`);
        if (!dirty.current && c.head_version !== ch?.head_version) { setCh(c); setData(normalizeCharacter(c.data)); }
      } catch { /* ignore */ }
    }, 10000);
    return () => clearInterval(t);
  }, [id, ch?.head_version]);
  useEffect(() => () => { save(); }, [save]);
  useEffect(() => {
    const warn = (e) => { if (dirty.current) { save(); e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  const edit = (fn) => {
    setData((d) => fn(d));
    dirty.current = true;
    setStatus('Unsaved changes');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 1200);
  };
  const act = (action) => run(async () => {
    await save();
    const r = await api.post(`/characters/${id}/action`, action);
    setData(normalizeCharacter(r.data));
    setCh((c) => ({ ...c, head_version: r.version }));
    setToast(r.message);
    setTimeout(() => setToast((t) => (t === r.message ? '' : t)), 5000);
  });

  const x = useMemo(() => (data ? derive(data) : null), [data]);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="muted">Loading…</div>;
  const ro = !ch.can_edit;
  const isOwner = ch?.user_id === me.id;
  const setField = (k) => (e) => edit((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div className="stack">
      <div className="card sheet-head">
        <label className="portrait" style={{ cursor: ro ? 'default' : 'pointer', margin: 0 }}>
          {data.portrait ? <img src={data.portrait} alt="" /> : '🧝'}
          {!ro && <input type="file" accept="image/*" hidden onChange={async (e) => { if (e.target.files[0]) { const p = await resizeImage(e.target.files[0], 400, 0.8); edit((d) => ({ ...d, portrait: p })); } }} />}
        </label>
        <div className="grow" style={{ minWidth: 200 }}>
          <input value={data.name} disabled={ro} onChange={setField('name')} style={{ fontFamily: 'var(--display)', fontSize: 24, background: 'transparent', border: 0, padding: 0 }} />
          <div className="muted">{data.subrace?.name || data.race?.name || 'No race'} · {data.classes.map((c) => `${c.name}${c.subclass_name ? ` (${c.subclass_name})` : ''} ${c.level}`).join(' / ') || 'No class'} · {data.background?.name || ''}</div>
          <div className="row small" style={{ marginTop: 4 }}>
            {ch.archived_at && <span className="badge">🗄 Archived</span>}
            <span className="muted">{ro ? '👁 View only' : status}</span>
            {!ro && <select value={ch.campaign_id || ''} style={{ width: 'auto', padding: '2px 6px' }} onChange={(e) => run(async () => { await api.patch(`/characters/${id}/meta`, { campaign_id: Number(e.target.value) || null }); setCh({ ...ch, campaign_id: Number(e.target.value) || null }); })}>
              <option value="">Private (no party)</option>{campaigns.map((c) => <option key={c.id} value={c.id}>Party: {c.name}</option>)}
            </select>}
          </div>
        </div>
        {[['Level', x.level], ['AC', data.ac], ['Init', signed(x.initiative)], ['Speed', data.speed], ['Prof', `+${x.pb}`], ['HP', `${data.hp.current}/${data.hp.max}`]].map(([l, v]) => (
          <div key={l} className="stat-box"><div className="label">{l}</div><div className="value">{v}</div></div>
        ))}
        <div className="head-actions">
          {!ro && srd && <button className="primary" onClick={async () => { await save(); setLevelUp(true); }}>⬆ Level up</button>}
          <a className="btn" href={`/api/characters/${id}/pdf`} onClick={async (e) => { if (dirty.current) { e.preventDefault(); await save(); window.location.href = `/api/characters/${id}/pdf`; } }} title="Download the filled-in official character sheet as a PDF">⬇ PDF</a>
        </div>
      </div>

      {toast && <div className="notice">📝 {toast}</div>}
      <ErrorBox error={error} />

      <div className="tabs sheet-tabs">
        {[['play', '⚔️', 'Play'], ['sheet', '📋', 'Sheet'], ['features', '✨', 'Features'], ['spells', '🔮', 'Spells'], ['inventory', '🎒', 'Items'], ['story', '📖', 'Story'], ['history', '🕓', 'History']].map(([k, i, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={async () => { await save(); setTab(k); window.scrollTo({ top: 0 }); }}><span className="tab-icon">{i}</span><span className="tab-label">{l}</span></button>
        ))}
      </div>

      {tab === 'play' && <PlayTab data={data} act={act} readOnly={ro} derived={x} />}
      {tab === 'sheet' && <StatsTab data={data} edit={edit} ro={ro} x={x} srd={srd} />}
      {tab === 'features' && (
        <div className="grid three">
          {[['features', 'Class features'], ['traits', 'Species traits'], ['feats', 'Feats']].map(([k, l]) => (
            <div key={k} className="card"><h3>{l}</h3>
              <ListEditor readOnly={ro} items={data[k]} onChange={(v) => edit((d) => ({ ...d, [k]: v }))} blank={{ name: '', desc: '' }}
                render={(f) => <details className="feature"><summary>{f.name} {f.source && <span className="muted small">· {f.source}</span>}</summary><div className="desc">{f.desc}</div></details>}
                fields={[{ key: 'name', label: 'Name', width: 2 }, { key: 'source', label: 'Source' }, { key: 'desc', label: 'Description', type: 'area' }]} />
            </div>
          ))}
        </div>
      )}
      {tab === 'spells' && <SpellBook data={data} edit={edit} act={act} ro={ro} srd={srd} x={x} />}
      {tab === 'inventory' && <InventoryTab data={data} edit={edit} ro={ro} srd={srd} />}
      {tab === 'story' && (
        <div className="stack">
          <div className="card grid two">
            {[['traits', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws']].map(([k, l]) => (
              <div key={k}><label>{l}</label><textarea rows={3} disabled={ro} value={data.personality[k]} onChange={(e) => edit((d) => ({ ...d, personality: { ...d.personality, [k]: e.target.value } }))} /></div>
            ))}
          </div>
          <div className="card stack">
            {[['appearance', 'Appearance', 3], ['backstory', 'Backstory', 10], ['allies', 'Allies & organisations', 3], ['notes', 'Personal notes', 6]].map(([k, l, r]) => (
              <div key={k}><label>{l}</label><textarea rows={r} disabled={ro} value={data[k]} onChange={setField(k)} /></div>
            ))}
          </div>
          {data.level_log.length > 0 && <div className="card"><h3>Level log</h3>{data.level_log.map((l, i) => <div key={i} className="small">Level {l.level}: {l.class} · +{l.hp} HP{l.note ? ` · ${l.note}` : ''}</div>)}</div>}
          {isOwner && (
            <div className="row end">
              <ErrorBox error={life.err} />
              <button className="small" disabled={life.busy} onClick={() => life.archive(ch, !ch.archived_at)}>{ch.archived_at ? 'Restore from archive' : 'Archive character'}</button>
              <button className="danger small" disabled={life.busy} onClick={() => life.remove({ ...ch, name: data.name })}>Delete character</button>
            </div>
          )}
        </div>
      )}
      {tab === 'history' && <HistoryTab charId={id} current={data} canEdit={!ro} flush={save} onReverted={() => load()} />}

      {levelUp && <LevelUpModal srd={srd} data={data} onClose={() => setLevelUp(false)} onApply={(next, choice) => run(async () => {
        const cls = next.classes.find((c) => c.index === choice.class);
        await api.put(`/characters/${id}`, { data: next, kind: 'levelup', message: `Level up → ${cls.name} ${cls.level} (character level ${derive(next).level})` });
        setLevelUp(false);
        await load();
        setToast(`Levelled up! ${cls.name} ${cls.level}`);
      })} />}
    </div>
  );
}
