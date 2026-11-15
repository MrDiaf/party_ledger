import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, useAction, useApp, useLoad, NeedParty, fmtDate } from '../components/ui.jsx';

/** One note's editor (DM). Saves itself a moment after you stop typing, and when you leave it. */
function NoteEditor({ cid, note, onSaved, onDeleted }) {
  const [f, setF] = useState({ title: note.title, body: note.body });
  const [status, setStatus] = useState('');
  const [run, busy, err] = useAction();
  const timer = useRef(null);
  const latest = useRef(f);
  latest.current = f;

  const save = async (extra = {}) => {
    clearTimeout(timer.current);
    setStatus('Saving…');
    await api.patch(`/campaigns/${cid}/notes/${note.id}`, { ...latest.current, ...extra });
    setStatus('Saved');
    await onSaved();
  };
  const edit = (k) => (e) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setStatus('Unsaved changes');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(save), 900);
  };
  // Flush on switching tabs / leaving the page.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); api.patch(`/campaigns/${cid}/notes/${note.id}`, latest.current).catch(() => {}); } }, [cid, note.id]);

  return (
    <div className="card stack">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input value={f.title} onChange={edit('title')} style={{ fontFamily: 'var(--display)', fontSize: 20, background: 'transparent', border: 0, padding: 0 }} />
        <span className="muted small nowrap">{status}</span>
      </div>
      <div className="row">
        <label className="inline"><input type="checkbox" checked={note.shared} disabled={busy}
          onChange={(e) => (!e.target.checked || confirm('Share this note with your players as an announcement?')) && run(() => save({ shared: e.target.checked }))} /> 📣 Visible to players</label>
        <label className="inline"><input type="checkbox" checked={note.pinned} disabled={busy} onChange={(e) => run(() => save({ pinned: e.target.checked }))} /> 📌 Pinned</label>
        {note.shared ? <span className="badge gold">Players can see this{note.published_at ? ` · shared ${fmtDate(note.published_at + 'Z')}` : ''}</span> : <span className="badge">Only you</span>}
        <span className="grow" />
        <button className="small danger" disabled={busy} onClick={() => confirm(`Delete "${note.title}"?`) && run(async () => { clearTimeout(timer.current); timer.current = null; await api.del(`/campaigns/${cid}/notes/${note.id}`); onDeleted(); })}>Delete</button>
      </div>
      <textarea className="note-body" value={f.body} onChange={edit('body')} onBlur={() => timer.current && run(save)}
        placeholder={note.shared ? 'Write your announcement. Players see it on the Overview and under Announcements.' : 'Plot threads, NPC secrets, encounter ideas… only you can see this.'} />
      <ErrorBox error={err} />
    </div>
  );
}

export default function NotesPage() {
  const { campaign } = useApp();
  const cid = campaign?.id;
  const isDm = campaign?.role === 'dm';
  const { id } = useParams();
  const nav = useNavigate();
  const { data: notes, error, reload } = useLoad(() => (cid ? api.get(`/campaigns/${cid}/notes`) : Promise.resolve([])), [cid]);
  const [run, busy, actErr] = useAction();
  if (!cid) return <NeedParty />;

  const current = notes?.find((n) => String(n.id) === id) || notes?.[0];
  const create = (shared) => run(async () => {
    const r = await api.post(`/campaigns/${cid}/notes`, { title: shared ? 'Announcement' : 'New note', shared });
    await reload();
    nav(`/notes/${r.id}`);
  });

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{isDm ? 'DM notes' : 'Announcements'}</h1>
        {isDm && (
          <div className="row">
            <button disabled={busy} onClick={() => create(false)}>+ Note</button>
            <button className="primary" disabled={busy} onClick={() => create(true)}>📣 New announcement</button>
          </div>
        )}
      </div>
      <ErrorBox error={error || actErr} />
      {notes && !notes.length && <div className="empty">{isDm ? 'No notes yet. Notes are private until you tick "Visible to players".' : 'Your DM has not posted any announcements yet.'}</div>}
      {notes?.length > 0 && (
        <div className="tabs">
          {notes.map((n) => (
            <button key={n.id} className={current?.id === n.id ? 'active' : ''} onClick={() => nav(`/notes/${n.id}`)}>
              {n.pinned ? '📌 ' : ''}{isDm && n.shared ? '📣 ' : ''}{n.title}
            </button>
          ))}
        </div>
      )}
      {current && (isDm
        ? <NoteEditor key={current.id} cid={cid} note={current} onSaved={reload} onDeleted={async () => { await reload(); nav('/notes'); }} />
        : (
          <div className="card stack announcement">
            <h2 style={{ margin: 0 }}>{current.title}</h2>
            <div className="muted small">{current.author || 'DM'} · {fmtDate((current.published_at || current.updated_at) + 'Z')}</div>
            <div className="pre">{current.body || <span className="muted">(empty)</span>}</div>
          </div>
        ))}
    </div>
  );
}
