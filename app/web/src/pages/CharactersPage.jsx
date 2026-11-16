import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, Modal, useAction, useApp, useLoad } from '../components/ui.jsx';
import { blankCharacter } from '../../../shared/rules.js';

/** Skip the builder: an empty sheet you fill in yourself, like the paper one. */
function BlankSheetModal({ onClose }) {
  const { campaigns, campaign } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [party, setParty] = useState(campaign?.id || '');
  const [run, busy, err] = useAction();
  return (
    <Modal title="Fill in a blank sheet" onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>No wizard, no rules checks: you get the official sheet's fields empty and type everything in yourself — species, class and level, scores, skills, gear and spells. The level-up button, resource tracking and PDF download still work afterwards.</p>
        <div><label>Character name</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label>Party</label><select value={party} onChange={(e) => setParty(Number(e.target.value) || '')}><option value="">No party (private)</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <ErrorBox error={err} />
        <div className="row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !name.trim()} onClick={() => run(async () => {
            const r = await api.post('/characters', { data: { ...blankCharacter(), name: name.trim(), classes: [{ index: '', name: '', level: 1, hit_die: 8, subclass: '', subclass_name: '' }] }, campaign_id: party || null });
            nav(`/characters/${r.id}?tab=sheet`);
          })}>Create blank sheet</button>
        </div>
      </div>
    </Modal>
  );
}

/** Archive (hide, keep everything) / restore / delete — shared by the list cards and the sheet page. */
export function useCharacterLifecycle(onDone) {
  const [run, busy, err] = useAction();
  return {
    busy, err,
    archive: (c, archived = true) => run(async () => { await api.post(`/characters/${c.id}/archive`, { archived }); await onDone?.('archive'); }),
    remove: (c) => confirm(`Delete ${c.name} permanently, including all history? This cannot be undone.\n\nTip: Archive hides a character but keeps it.`)
      && run(async () => { await api.del(`/characters/${c.id}`); await onDone?.('delete'); }),
  };
}

function Card({ c, life }) {
  return (
    <div className="card stack" style={{ gap: 8, opacity: c.archived_at ? 0.7 : 1 }}>
      <Link to={`/characters/${c.id}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <div className="portrait" style={{ width: 56, height: 56, fontSize: 24 }}>{c.portrait ? <img src={c.portrait} alt="" /> : '🧝'}</div>
          <div className="grow">
            <div style={{ fontFamily: 'var(--display)', fontSize: 17, color: 'var(--gold)' }}>{c.name}</div>
            <div className="muted small">{c.summary || '—'}</div>
            <div className="small">HP {c.hp?.current}/{c.hp?.max} · <span className="muted">{c.owner}</span></div>
          </div>
        </div>
      </Link>
      {life && (
        <div className="row end">
          {c.archived_at
            ? <button className="small" disabled={life.busy} onClick={() => life.archive(c, false)}>Restore</button>
            : <button className="small" disabled={life.busy} onClick={() => life.archive(c)}>Archive</button>}
          <button className="small danger" disabled={life.busy} onClick={() => life.remove(c)}>Delete</button>
        </div>
      )}
    </div>
  );
}

export default function CharactersPage() {
  const { me, campaign } = useApp();
  const [blank, setBlank] = useState(false);
  const { data, error, reload } = useLoad(() => api.get('/characters?archived=1'), []);
  const life = useCharacterLifecycle(reload);
  const mine = (data || []).filter((c) => c.user_id === me.id && !c.archived_at);
  const archived = (data || []).filter((c) => c.user_id === me.id && c.archived_at);
  const party = (data || []).filter((c) => c.user_id !== me.id && (!campaign || c.campaign_id === campaign.id));
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Characters</h1>
        <div className="row">
          <Link className="btn primary" to="/characters/new">+ New character</Link>
        </div>
      </div>
      <div className="grid three start-options">
        <Link to="/characters/new" className="card click start-card"><div className="start-icon">🧙</div><b>Guided builder</b><span className="muted small">Step by step: species, class, background, equipment choices, abilities, skills and spells.</span></Link>
        <button className="card click start-card" onClick={() => setBlank(true)}><div className="start-icon">📝</div><b>Blank sheet</b><span className="muted small">Skip the builder and fill in the character sheet yourself, field by field.</span></button>
        <div className="card start-card"><div className="start-icon">📄</div><b>Paper sheet</b><span className="muted small">Prefer pen and paper? <a href="/api/sheet/blank.pdf">Download the blank official sheet</a> to print, or <Link to="/characters/import">import a photo or PDF</Link> of a filled one.</span></div>
      </div>
      {blank && <BlankSheetModal onClose={() => setBlank(false)} />}
      <ErrorBox error={error || life.err} />
      <h2>Mine</h2>
      {mine.length ? <div className="grid cards">{mine.map((c) => <Card key={c.id} c={c} life={life} />)}</div> : <div className="empty">No characters yet.</div>}
      <h2>Party members'</h2>
      {party.length ? <div className="grid cards">{party.map((c) => <Card key={c.id} c={c} />)}</div> : <div className="empty">None shared with this party yet.</div>}
      {archived.length > 0 && (
        <details>
          <summary><h2 style={{ display: 'inline' }}>Archived ({archived.length})</h2></summary>
          <p className="muted small">Hidden from your lists and your party. Restore one to bring it back.</p>
          <div className="grid cards">{archived.map((c) => <Card key={c.id} c={c} life={life} />)}</div>
        </details>
      )}
    </div>
  );
}
