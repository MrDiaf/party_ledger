import { useState } from 'react';
import { api } from '../api.js';
import { Modal, ErrorBox, useAction, useApp, useLoad, NeedParty } from '../components/ui.jsx';

const STATUS = {
  active: { label: 'Active', badge: 'gold', icon: '⚔️' },
  available: { label: 'Available', badge: 'blue', icon: '📯' },
  completed: { label: 'Completed', badge: 'green', icon: '✅' },
  failed: { label: 'Failed', badge: 'red', icon: '💀' },
};
const GROUPS = [['Active', ['active']], ['Available', ['available']], ['Past', ['completed', 'failed']]];

function QuestModal({ cid, quest, onClose, onSaved }) {
  const [f, setF] = useState({ title: '', description: '', giver: '', reward: '', notes: '', status: 'active', ...quest });
  const [run, busy, error] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    if (quest?.id) await api.patch(`/campaigns/${cid}/quests/${quest.id}`, f); else await api.post(`/campaigns/${cid}/quests`, f);
    onSaved();
  });
  return (
    <Modal title={quest?.id ? 'Edit quest' : 'New quest'} onClose={onClose}>
      <div className="stack">
        <div><label>Title</label><input autoFocus value={f.title} onChange={set('title')} /></div>
        <div className="grid two">
          <div><label>Status</label><select value={f.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}</select></div>
          <div><label>Quest giver</label><input value={f.giver} onChange={set('giver')} /></div>
        </div>
        <div><label>Description</label><textarea value={f.description} onChange={set('description')} rows={4} /></div>
        <div><label>Reward</label><input value={f.reward} onChange={set('reward')} /></div>
        <div><label>Notes / progress</label><textarea value={f.notes} onChange={set('notes')} /></div>
        <ErrorBox error={error} />
        <div className="row between">
          {quest?.id ? <button className="danger" onClick={() => confirm('Delete this quest?') && run(async () => { await api.del(`/campaigns/${cid}/quests/${quest.id}`); onSaved(); })}>Delete</button> : <span />}
          <button className="primary" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

export default function QuestsPage() {
  const { campaign } = useApp();
  const cid = campaign?.id;
  const { data: quests, error, reload } = useLoad(() => (cid ? api.get(`/campaigns/${cid}/quests`) : Promise.resolve([])), [cid]);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [run] = useAction();
  if (!cid) return <NeedParty />;
  const filtered = (quests || []).filter((x) => !q || `${x.title} ${x.description} ${x.giver}`.toLowerCase().includes(q.toLowerCase()));
  const setStatus = (quest, status) => run(async () => { await api.patch(`/campaigns/${cid}/quests/${quest.id}`, { status }); reload(); });

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Quests</h1>
        <div className="row"><input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} /><button className="primary" onClick={() => setEdit({})}>+ New quest</button></div>
      </div>
      <ErrorBox error={error} />
      {GROUPS.map(([title, statuses]) => {
        const list = filtered.filter((x) => statuses.includes(x.status));
        return (
          <section key={title} className="stack">
            <h2>{title} <span className="muted small">({list.length})</span></h2>
            {!list.length ? <div className="empty">Nothing here.</div> : (
              <div className="grid cards">
                {list.map((x) => (
                  <div key={x.id} className="card click" onClick={() => setEdit(x)} style={{ opacity: title === 'Past' ? 0.8 : 1 }}>
                    <div className="row between"><strong>{STATUS[x.status].icon} {x.title}</strong><span className={`badge ${STATUS[x.status].badge}`}>{STATUS[x.status].label}</span></div>
                    {x.giver && <div className="muted small">from {x.giver}</div>}
                    {x.description && <p className="pre small" style={{ maxHeight: 90, overflow: 'hidden' }}>{x.description}</p>}
                    {x.reward && <div className="small">🎁 {x.reward}</div>}
                    <div className="row" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                      {x.status === 'available' && <button className="small" onClick={() => setStatus(x, 'active')}>Accept</button>}
                      {x.status === 'active' && <><button className="small" onClick={() => setStatus(x, 'completed')}>Complete</button><button className="small" onClick={() => setStatus(x, 'failed')}>Failed</button></>}
                      {title === 'Past' && <button className="small" onClick={() => setStatus(x, 'active')}>Reopen</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {edit && <QuestModal cid={cid} quest={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
