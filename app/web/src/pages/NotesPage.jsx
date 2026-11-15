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

export default function NotesPage() {
  const { campaign } = useApp();
  const cid = campaign?.id;
  const isDm = campaign?.role === 'dm';
  const { id } = useParams();
  const nav = useNavigate();
  const { data: notes, error, reload } = useLoad(() => (cid ? api.get(`/campaigns/${cid}/notes`) : Promise.resolve([])), [cid]);
  const [run, busy, actErr] = useAction();
  const [viewer, setViewer] = useState(null);
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
            <div className="pre">{current.body
              ? <LogText text={current.body} images={current.images || []} onOpen={setViewer} url={(i) => noteImgUrl(cid, i.id)} where="note" />
              : <span className="muted">(empty)</span>}</div>
            <NotePictures cid={cid} note={current} viewer={viewer} setViewer={setViewer} />
          </div>
        ))}
    </div>
  );
}
