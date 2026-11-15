import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useLoad, fmtDate, ErrorBox } from '../components/ui.jsx';

export default function HomePage() {
  const { campaign, me } = useApp();
  const cid = campaign?.id;
  const { data, error } = useLoad(async () => {
    const chars = await api.get('/characters');
    if (!cid) return { chars };
    const now = new Date();
    const [events, quests, sessions, treasury, notes] = await Promise.all([
      api.get(`/campaigns/${cid}/events?from=${now.toISOString()}&to=${new Date(+now + 21 * 864e5).toISOString()}`),
      api.get(`/campaigns/${cid}/quests?status=active`),
      api.get(`/campaigns/${cid}/sessions`),
      api.get(`/campaigns/${cid}/treasury`),
      api.get(`/campaigns/${cid}/notes`),
    ]);
    // Announcements = notes the DM shared: pinned first, then the most recently shared.
    const announcements = notes.filter((n) => n.shared)
      .sort((a, b) => b.pinned - a.pinned || String(b.published_at || b.updated_at).localeCompare(String(a.published_at || a.updated_at))).slice(0, 3);
    return { chars, events, quests, sessions, treasury, announcements };
  }, [cid]);

  return (
    <div className="stack">
      <h1>{campaign ? campaign.name : `Welcome, ${me.display_name}`}</h1>
      <ErrorBox error={error} />
      {!campaign && (
        <div className="card">
          <p>You are not in a party yet. <Link to="/party">Create or join one</Link> to share a calendar, quests, treasury and session logs.</p>
        </div>
      )}
      {data?.announcements?.map((n) => (
        <Link key={n.id} to={`/notes/${n.id}`} className="card announcement" style={{ color: 'var(--text)', textDecoration: 'none' }}>
          <div className="row between"><strong>📣 {n.pinned ? '📌 ' : ''}{n.title}</strong><span className="muted small">{fmtDate((n.published_at || n.updated_at) + 'Z')}</span></div>
          <div className="pre small" style={{ marginTop: 6 }}>{n.body.length > 280 ? `${n.body.slice(0, 280)}…` : n.body}</div>
        </Link>
      ))}
      {data && campaign && (
        <div className="grid two">
          <div className="card">
            <div className="row between"><h3>Next 3 weeks</h3><Link to="/calendar" className="small">Calendar →</Link></div>
            {data.events.filter((e) => e.kind === 'session').length ? data.events.filter((e) => e.kind === 'session').slice(0, 5).map((e) => (
              <div key={e.id} className="row"><span className="badge gold">session</span> {e.title} <span className="muted small">{fmtDate(e.start)}</span></div>
            )) : <p className="muted">No sessions scheduled.</p>}
            <p className="muted small">{data.events.length} calendar entries in total.</p>
          </div>
          <div className="card">
            <div className="row between"><h3>Active quests</h3><Link to="/quests" className="small">Quests →</Link></div>
            {data.quests.length ? data.quests.slice(0, 6).map((q) => <div key={q.id}>📜 {q.title}</div>) : <p className="muted">No active quests.</p>}
          </div>
          <div className="card">
            <div className="row between"><h3>Treasury</h3><Link to="/treasury" className="small">Treasury →</Link></div>
            <div className="row">{data.treasury.currencies.filter((c) => c.amount).map((c) => <span key={c.id} className="badge gold">{+c.amount.toFixed(2)} {c.abbr || c.name}</span>)}</div>
            <p className="muted small">≈ {data.treasury.total_gp.toFixed(1)} gp in coin · {data.treasury.items.length} items</p>
          </div>
          <div className="card">
            <div className="row between"><h3>Latest session</h3><Link to="/logs" className="small">Logs →</Link></div>
            {data.sessions[0] ? <Link to={`/logs/${data.sessions[0].id}`}>#{data.sessions[0].number} {data.sessions[0].title || 'Untitled'} — {data.sessions[0].entries} entries</Link> : <p className="muted">No sessions logged yet.</p>}
          </div>
        </div>
      )}
      {data && (
        <div className="card">
          <div className="row between"><h3>My characters</h3><Link to="/characters" className="small">Characters →</Link></div>
          {data.chars.filter((c) => c.user_id === me.id).map((c) => (
            <div key={c.id}><Link to={`/characters/${c.id}`}>{c.name}</Link> <span className="muted small">{c.summary} · HP {c.hp?.current}/{c.hp?.max}</span></div>
          ))}
          {!data.chars.some((c) => c.user_id === me.id) && <p className="muted">None yet — <Link to="/characters/new">create one</Link>.</p>}
        </div>
      )}
    </div>
  );
}
