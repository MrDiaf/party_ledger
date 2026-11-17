import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, Modal, useAction, useApp, useLoad, NeedParty, fmtDate } from '../components/ui.jsx';
import { LogText, readImages } from './LogsPage.jsx';

const noteImgUrl = (cid, id) => `/api/campaigns/${cid}/note-images/${id}`;

/** A note's pictures as numbered thumbnails; tap one to see it large (the DM can also remove it or refer to it). */
function NotePictures({ cid, note, onRemove, onRefer, viewer, setViewer }) {
  const images = note.images || [];
  return (
    <>
      {images.length > 0 && (
        <div className="log-pics">
          {images.map((i) => (
            <div key={i.id} className="log-pic">
              <img src={noteImgUrl(cid, i.id)} alt="" onClick={() => setViewer(i)} style={{ cursor: 'zoom-in' }} />
              <span>img{i.n}</span>
              {onRemove && <button className="ghost small" title="Remove picture" onClick={() => onRemove(i)}>✕</button>}
            </div>
          ))}
        </div>
      )}
      {viewer && (
        <Modal title={`Picture ${viewer.n}`} onClose={() => setViewer(null)} wide>
          <img className="viewer-img" src={noteImgUrl(cid, viewer.id)} alt={`Picture ${viewer.n}`} />
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="muted small">{onRefer ? `Write [img${viewer.n}] anywhere in the note to point at this picture.` : note.title}</span>
            <div className="row">
              <a className="btn small" href={noteImgUrl(cid, viewer.id)} download={`${note.title}-img${viewer.n}`}>Download</a>
              {onRefer && <button className="primary small" onClick={() => { onRefer(viewer.n); setViewer(null); }}>Refer to it in the note</button>}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** One note's editor (DM). Saves itself a moment after you stop typing, and when you leave it. */
function NoteEditor({ cid, note, onSaved, onDeleted }) {
  const [f, setF] = useState({ title: note.title, body: note.body });
  const [status, setStatus] = useState('');
  const [run, busy, err] = useAction();
  const [viewer, setViewer] = useState(null);
  const area = useRef(null);
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
  /** Insert "[imgN]" at the cursor (or the end) and save. */
  const refer = (ns) => {
    const el = area.current;
    const at = el && document.activeElement === el ? el.selectionStart : latest.current.body.length;
    const body = latest.current.body;
    const ins = `${at && !/\s$/.test(body.slice(0, at)) ? ' ' : ''}${ns.map((n) => `[img${n}]`).join(' ')} `;
    edit('body')({ target: { value: body.slice(0, at) + ins + body.slice(at) } });
  };
  const addPictures = (files) => run(async () => {
    const urls = await readImages(files);
    if (!urls.length) return;
    setStatus('Uploading pictures…');
    const r = await api.post(`/campaigns/${cid}/notes/${note.id}/images`, { images: urls });
    refer(r.images.map((i) => i.n));
    await onSaved();
  });
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
      <textarea ref={area} className="note-body" value={f.body} onChange={edit('body')} onBlur={() => timer.current && run(save)}
        onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addPictures(e.clipboardData.files); } }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addPictures(e.dataTransfer.files); } }}
        placeholder={note.shared ? 'Write your announcement. Players see it on the Overview and under Announcements.' : 'Plot threads, NPC secrets, encounter ideas… only you can see this.'} />
      <div className="row">
        <label className="btn small" htmlFor={`note-pics-${note.id}`} title="Add pictures (or paste / drop them into the note)">📎 Add pictures</label>
        <input id={`note-pics-${note.id}`} type="file" accept="image/*" multiple hidden onChange={(e) => { addPictures(e.target.files); e.target.value = ''; }} />
        <span className="muted small">Paste or drop pictures into the text too. Refer to one with [img1]{note.shared ? '. Players see them with the note.' : '.'}</span>
      </div>
      <NotePictures cid={cid} note={note} viewer={viewer} setViewer={setViewer} onRefer={(n) => refer([n])}
        onRemove={(i) => confirm(`Remove picture ${i.n}?`) && run(async () => { await api.del(`/campaigns/${cid}/notes/${note.id}/images/${i.id}`); await onSaved(); })} />
      <ErrorBox error={err} />
    </div>
  );
}

/** Ask for a name (and, for announcements, the message) before creating. */
function CreateNoteModal({ shared, onCreate, onClose }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [run, busy, err] = useAction();
  return (
    <Modal title={shared ? '📣 New announcement' : '📝 New private note'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (title.trim()) run(() => onCreate({ title: title.trim(), body, shared })); }}>
        <div><label>{shared ? 'Announcement title' : 'Note title'}</label>
          <input autoFocus value={title} maxLength={120} placeholder={shared ? 'e.g. Next session moved to Saturday' : 'e.g. Villain plans, NPC secrets'} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><label>{shared ? 'Message (you can add pictures after creating)' : 'Text (optional)'}</label>
          <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <div className="muted small">{shared ? 'Players see it straight away on the Overview and under Announcements.' : 'Only you can see this until you tick "Visible to players".'}</div>
        <ErrorBox error={err} />
        <div className="row end"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !title.trim()}>{shared ? 'Post announcement' : 'Create note'}</button></div>
      </form>
    </Modal>
  );
}

const excerpt = (t) => String(t || '').replace(/\[img\s*\d+\]/gi, '🖼').replace(/\s+/g, ' ').trim().slice(0, 160);

function NoteCard({ cid, n, onOpen, isDm }) {
  const first = n.images?.[0];
  return (
    <button className="note-card" onClick={onOpen}>
      {first && <img src={noteImgUrl(cid, first.id)} alt="" loading="lazy" />}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="note-card-title">{n.pinned ? '📌 ' : ''}{n.title}</div>
        <div className="muted small">{fmtDate(((n.shared && n.published_at) || n.updated_at) + 'Z')}{n.images?.length ? ` · ${n.images.length} picture${n.images.length > 1 ? 's' : ''}` : ''}{isDm && n.shared ? ' · players can see' : ''}</div>
        <div className="small note-card-text">{excerpt(n.body) || <span className="muted">(empty)</span>}</div>
      </div>
    </button>
  );
}

export default function NotesPage() {
  const { campaign } = useApp();
  const cid = campaign?.id;
  const isDm = campaign?.role === 'dm';
  const { id } = useParams();
  const nav = useNavigate();
  const { data: notes, error, reload } = useLoad(() => (cid ? api.get(`/campaigns/${cid}/notes`) : Promise.resolve([])), [cid]);
  const [creating, setCreating] = useState(null); // null | 'note' | 'announcement'
  const [q, setQ] = useState('');
  const [viewer, setViewer] = useState(null);
  if (!cid) return <NeedParty />;

  const open = notes?.find((n) => String(n.id) === id);
  const match = (n) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q.toLowerCase());
  const announcements = (notes || []).filter((n) => n.shared && match(n));
  const privateNotes = (notes || []).filter((n) => !n.shared && match(n));
  const create = async (b) => {
    const r = await api.post(`/campaigns/${cid}/notes`, b);
    setCreating(null);
    await reload();
    nav(`/notes/${r.id}`);
  };
  const section = (title, list, empty) => (
    <section className="stack" style={{ gap: 8 }}>
      <h2 style={{ margin: 0 }}>{title} <span className="muted small">({list.length})</span></h2>
      {list.length ? <div className="note-list">{list.map((n) => <NoteCard key={n.id} cid={cid} n={n} isDm={isDm} onOpen={() => nav(`/notes/${n.id}`)} />)}</div>
        : <div className="empty">{empty}</div>}
    </section>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{isDm ? 'Notes & announcements' : 'Announcements'}</h1>
        {isDm && (
          <div className="row">
            <button onClick={() => setCreating('note')}>📝 Private note</button>
            <button className="primary" onClick={() => setCreating('announcement')}>📣 Announcement</button>
          </div>
        )}
      </div>
      <ErrorBox error={error} />
      {(notes?.length || 0) > 4 && <input placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />}
      {notes && section('📣 Announcements', announcements, isDm ? 'Nothing announced yet. Announcements are notes your players can see.' : 'Your DM has not posted any announcements yet.')}
      {notes && isDm && section('📝 Private notes', privateNotes, 'No private notes. Only you see these.')}

      {creating && <CreateNoteModal shared={creating === 'announcement'} onCreate={create} onClose={() => setCreating(null)} />}
      {open && (isDm ? (
        <Modal title={open.shared ? '📣 Announcement' : '📝 Private note'} onClose={() => nav('/notes')} wide>
          <NoteEditor key={open.id} cid={cid} note={open} onSaved={reload} onDeleted={async () => { await reload(); nav('/notes'); }} />
        </Modal>
      ) : (
        <Modal title={open.title} onClose={() => nav('/notes')} wide>
          <div className="stack announcement">
            <div className="muted small">{open.author || 'DM'} · {fmtDate((open.published_at || open.updated_at) + 'Z')}</div>
            <div className="pre">{open.body
              ? <LogText text={open.body} images={open.images || []} onOpen={setViewer} url={(i) => noteImgUrl(cid, i.id)} where="note" />
              : <span className="muted">(empty)</span>}</div>
            <NotePictures cid={cid} note={open} viewer={viewer} setViewer={setViewer} />
          </div>
        </Modal>
      ))}
    </div>
  );
}
