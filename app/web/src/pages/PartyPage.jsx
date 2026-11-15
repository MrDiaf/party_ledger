import { useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, useAction, useApp, useLoad } from '../components/ui.jsx';

function CreateJoin() {
  const { refreshMe, setCampaignId } = useApp();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [run, busy, error] = useAction();
  const go = (fn) => run(async () => { const r = await fn(); setCampaignId(r.id); await refreshMe(); setName(''); setCode(''); });
  return (
    <div className="grid two">
      <div className="card stack">
        <h3>Create a party</h3>
        <p className="muted small">You become its DM. Share the invite code with your friends.</p>
        <input placeholder="Party name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={busy || !name.trim()} onClick={() => go(() => api.post('/campaigns', { name }))}>Create</button>
      </div>
      <div className="card stack">
        <h3>Join a party</h3>
        <p className="muted small">Ask the DM for the invite code.</p>
        <input placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value)} />
        <button disabled={busy || !code.trim()} onClick={() => go(() => api.post('/campaigns/join', { code }))}>Join</button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

export default function PartyPage() {
  const { campaign, me, refreshMe } = useApp();
  const { data: c, error, reload } = useLoad(() => (campaign ? api.get(`/campaigns/${campaign.id}`) : Promise.resolve(null)), [campaign?.id]);
  const [run, busy, err] = useAction();
  const [edit, setEdit] = useState(null);
  const isDm = c && c.my_role === 'dm';
  const act = (fn) => run(async () => { await fn(); await reload(); await refreshMe(); });
  return (
    <div className="stack">
      <h1>Party</h1>
      <ErrorBox error={error || err} />
      {c && (
        <div className="card stack">
          {edit ? (
            <>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              <textarea placeholder="Description / setting notes" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              <div className="row end"><button onClick={() => setEdit(null)}>Cancel</button><button className="primary" onClick={() => act(async () => { await api.patch(`/campaigns/${c.id}`, edit); setEdit(null); })}>Save</button></div>
            </>
          ) : (
            <>
              <div className="row between"><h2 style={{ margin: 0 }}>{c.name}</h2>{isDm && <button className="small" onClick={() => setEdit({ name: c.name, description: c.description })}>Edit</button>}</div>
              {c.description && <p className="pre">{c.description}</p>}
            </>
          )}
          <div className="row">
            <span className="muted">Invite code:</span> <code style={{ fontSize: 16 }}>{c.invite_code}</code>
            {isDm && <button className="small" disabled={busy} onClick={() => act(() => api.patch(`/campaigns/${c.id}`, { regenerate_invite: true }))}>New code</button>}
          </div>
          <h3>Members</h3>
          <table><tbody>
            {c.members.map((m) => (
              <tr key={m.id}>
                <td><span className="dot" style={{ background: m.color }} /> {m.display_name} <span className="muted small">@{m.username}</span></td>
                <td><span className={`badge ${m.role === 'dm' ? 'gold' : ''}`}>{m.role === 'dm' ? 'DM' : 'Player'}</span></td>
                <td className="right">
                  {isDm && m.id !== me.id && <>
                    <button className="small" onClick={() => act(() => api.patch(`/campaigns/${c.id}/members/${m.id}`, { role: m.role === 'dm' ? 'player' : 'dm' }))}>{m.role === 'dm' ? 'Make player' : 'Make DM'}</button>{' '}
                    <button className="small danger" onClick={() => confirm(`Remove ${m.display_name} from the party?`) && act(() => api.del(`/campaigns/${c.id}/members/${m.id}`))}>Remove</button>
                  </>}
                  {m.id === me.id && <button className="small" onClick={() => confirm('Leave this party?') && act(() => api.del(`/campaigns/${c.id}/members/${m.id}`))}>Leave</button>}
                </td>
              </tr>
            ))}
          </tbody></table>
          {isDm && <div className="row end"><button className="small danger" onClick={() => confirm(`Delete "${c.name}" with all its quests, logs, calendar and treasury? This cannot be undone.`) && act(() => api.del(`/campaigns/${c.id}`))}>Delete party</button></div>}
        </div>
      )}
      <CreateJoin />
    </div>
  );
}
