import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, resizeImage } from '../api.js';
import { ErrorBox, Modal, useAction, useApp, useLoad, NeedParty, fmtDay } from '../components/ui.jsx';

const imgUrl = (cid, id) => `/api/campaigns/${cid}/log-images/${id}`;

/** Text with [img3] references turned into clickable picture chips (`url` maps a picture to its address). */
export function LogText({ text, images, cid, onOpen, url = (img) => imgUrl(cid, img.id), where = 'session' }) {
  const parts = String(text || '').split(/(\[img\s*\d+\])/gi);
  return parts.map((p, i) => {
    const m = /^\[img\s*(\d+)\]$/i.exec(p);
    if (!m) return <span key={i}>{p}</span>;
    const img = images.find((x) => x.n === Number(m[1]));
    return img
      ? <button key={i} className="img-ref" onClick={() => onOpen(img)} title={`Picture ${img.n}`}><img src={url(img)} alt="" />img{img.n}</button>
      : <span key={i} className="badge red" title={`No picture with that number in this ${where}`}>{p}</span>;
  });
}

/** Read image files (picker, paste or drop) as downscaled data URLs. */
export const readImages = (files) => Promise.all([...files].filter((f) => f.type.startsWith('image/')).slice(0, 10).map((f) => resizeImage(f, 1800, 0.85)));

const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

function useDictation(onFinal) {
  const [on, setOn] = useState(false);
  const rec = useRef(null);
  const active = useRef(false);
  const cb = useRef(onFinal);
  cb.current = onFinal;
  useEffect(() => () => { active.current = false; rec.current?.stop(); }, []);
  const toggle = () => {
    if (active.current) { active.current = false; rec.current?.stop(); setOn(false); return; }
    const r = new Speech();
    r.continuous = true;
    r.interimResults = false;
    r.lang = navigator.language || 'en-US';
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) cb.current(e.results[i][0].transcript.trim());
    };
    // Browsers end recognition after silence; restart while the user still wants dictation.
    r.onend = () => { if (active.current && rec.current === r) r.start(); else setOn(false); };
    r.onerror = (e) => { if (e.error !== 'no-speech') { active.current = false; setOn(false); } };
    rec.current = r;
    active.current = true;
    r.start();
    setOn(true);
  };
  return { supported: !!Speech, on, toggle };
}

function SessionView({ cid, id, onChanged }) {
  const { me } = useApp();
  const [session, setSession] = useState(null);
  const [entries, setEntries] = useState([]);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const [meta, setMeta] = useState(null);
  const [pending, setPending] = useState([]); // images waiting to be posted (data URLs)
  const [viewer, setViewer] = useState(null);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const addFiles = async (files) => { const urls = await readImages(files); if (urls.length) setPending((p) => [...p, ...urls].slice(0, 10)); };
  const insertRef = (n) => { setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}[img${n}] `); setViewer(null); setTimeout(() => input.current?.focus(), 0); };
  const [run, busy, error] = useAction();
  const lastId = useRef(0);
  const bottom = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    let stop = false;
    lastId.current = 0;
    setEntries([]);
    const poll = async () => {
      try {
        const s = await api.get(`/campaigns/${cid}/sessions/${id}?after=${lastId.current}`);
        if (stop) return;
        setSession(s);
        if (s.entries.length) {
          lastId.current = s.entries[s.entries.length - 1].id;
          setEntries((prev) => [...prev, ...s.entries]);
          setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        }
      } catch { /* transient — next poll retries */ }
    };
    poll();
    const t = setInterval(poll, 4000); // simple polling is plenty for a handful of players
    return () => { stop = true; clearInterval(t); };
  }, [cid, id]);

  const reloadAll = async () => {
    const s = await api.get(`/campaigns/${cid}/sessions/${id}`);
    setSession(s); setEntries(s.entries); lastId.current = s.entries.at(-1)?.id || 0;
  };
  const send = (t, imgs = []) => run(async () => {
    if (!t.trim() && !imgs.length) return;
    await api.post(`/campaigns/${cid}/sessions/${id}/entries`, { text: t, ...(imgs.length ? { images: imgs } : {}) });
    setPending([]);
    const s = await api.get(`/campaigns/${cid}/sessions/${id}?after=${lastId.current}`);
    if (s.entries.length) { lastId.current = s.entries.at(-1).id; setEntries((p) => [...p, ...s.entries]); }
    setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  });
  const dict = useDictation((t) => send(t));

  if (!session) return <div className="muted">Loading…</div>;
  const images = session.images || [];
  const post = () => { const t = text; const imgs = pending; setText(''); send(t, imgs); };
  const exportText = () => {
    const txt = `Session ${session.number}: ${session.title}\n${session.date}\n\n${session.summary ? `${session.summary}\n\n` : ''}${entries.map((e) => `[${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${e.author}: ${e.text}${e.images?.length ? ` ${e.images.map((i) => `(picture img${i.n})`).join(' ')}` : ''}`).join('\n')}`;
    navigator.clipboard?.writeText(txt);
  };
  return (
    <div className="stack">
      {meta ? (
        <div className="card stack">
          <div className="grid three">
            <div><label>Number</label><input type="number" value={meta.number} onChange={(e) => setMeta({ ...meta, number: e.target.value })} /></div>
            <div><label>Title</label><input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></div>
            <div><label>Date</label><input type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} /></div>
          </div>
          <div><label>Summary / recap</label><textarea rows={4} value={meta.summary} onChange={(e) => setMeta({ ...meta, summary: e.target.value })} /></div>
          <div className="row between">
            <button className="danger" onClick={() => confirm('Delete this session and all its entries?') && run(async () => { await api.del(`/campaigns/${cid}/sessions/${id}`); onChanged(); nav('/logs'); })}>Delete session</button>
            <div className="row"><button onClick={() => setMeta(null)}>Cancel</button><button className="primary" onClick={() => run(async () => { await api.patch(`/campaigns/${cid}/sessions/${id}`, meta); setMeta(null); await reloadAll(); onChanged(); })}>Save</button></div>
          </div>
        </div>
      ) : (
        <div className="row between">
          <div>
            <h2 style={{ margin: 0 }}>Session {session.number}{session.title && `: ${session.title}`}</h2>
            <div className="muted small">{fmtDay(session.date)}</div>
          </div>
          <div className="row"><button className="small" onClick={exportText}>Copy as text</button><button className="small" onClick={() => setMeta({ number: session.number, title: session.title, date: session.date, summary: session.summary })}>Edit</button></div>
        </div>
      )}
      {!meta && session.summary && <div className="card pre">{session.summary}</div>}
      <div className={`card ${drag ? 'drop-on' : ''}`} onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDrag(true); } }}
        onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
        {!entries.length && <div className="muted center">Nothing logged yet. Start typing below — everyone in the party sees entries live. Drop pictures here or use 📷.</div>}
        {entries.map((e) => (
          <div key={e.id} className="log-entry">
            <span className="time">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {editing?.id === e.id ? (
              <div className="row"><input className="grow" autoFocus value={editing.text} onChange={(ev) => setEditing({ ...editing, text: ev.target.value })}
                onKeyDown={(ev) => ev.key === 'Enter' && run(async () => { await api.patch(`/campaigns/${cid}/entries/${e.id}`, { text: editing.text }); setEditing(null); await reloadAll(); })} />
                <button className="small" onClick={() => setEditing(null)}>Cancel</button></div>
            ) : (
              <div className="grow" style={{ minWidth: 0 }}>
                <span className="who" style={{ color: e.color }}>{e.author}</span><span className="pre"><LogText text={e.text} images={images} cid={cid} onOpen={setViewer} /></span>
                {e.images?.length > 0 && <div className="log-pics">{e.images.map((i) => (
                  <button key={i.id} className="log-pic" onClick={() => setViewer(i)}><img src={imgUrl(cid, i.id)} alt={`Picture ${i.n}`} loading="lazy" /><span>img{i.n}</span></button>
                ))}</div>}
              </div>
            )}
            <div className="row" style={{ gap: 2 }}>
              {(e.user_id === me.id) && editing?.id !== e.id && <>
                <button className="ghost small" onClick={() => setEditing({ id: e.id, text: e.text })}>✎</button>
                <button className="ghost small" onClick={() => run(async () => { await api.del(`/campaigns/${cid}/entries/${e.id}`); await reloadAll(); })}>✕</button>
              </>}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <ErrorBox error={error} />
      <div className="log-composer">
        {pending.length > 0 && (
          <div className="log-pending">
            {pending.map((u, i) => (
              <div key={i} className="log-pic"><img src={u} alt="" /><span>img{(images.at(-1)?.n || 0) + i + 1}</span>
                <button className="ghost small" title="Remove" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>✕</button></div>
            ))}
            <span className="muted small">Text you type becomes the caption. Refer to pictures anywhere with [img{(images.at(-1)?.n || 0) + 1}].</span>
          </div>
        )}
        <div className="log-input">
          <button title="Add pictures" onClick={() => document.getElementById(`pics-${id}`).click()}>📷</button>
          <input id={`pics-${id}`} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <textarea ref={input} className="grow" rows={2} style={{ minHeight: 44 }} placeholder={pending.length ? 'Caption (optional)…' : 'What happened? Refer to a picture with [img1] (Enter to post)'} value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } }} />
          {dict.supported && <button className={dict.on ? 'primary' : ''} onClick={dict.toggle} title="Dictate (each sentence is posted as an entry)">{dict.on ? '⏺' : '🎙️'}</button>}
          <button className="primary" disabled={busy || (!text.trim() && !pending.length)} onClick={post}>Post</button>
        </div>
        {images.length > 0 && <div className="row small muted" style={{ gap: 4 }}>Refer to: {images.slice(-8).map((i) => <button key={i.id} className="chip" onClick={() => insertRef(i.n)}>[img{i.n}]</button>)}</div>}
      </div>
      {viewer && (
        <Modal title={`Picture ${viewer.n}`} onClose={() => setViewer(null)} wide>
          <img className="viewer-img" src={imgUrl(cid, viewer.id)} alt={`Picture ${viewer.n}`} />
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="muted small">Write [img{viewer.n}] in any entry to point at this picture.</span>
            <div className="row"><a className="btn small" href={imgUrl(cid, viewer.id)} download={`session-${session.number}-img${viewer.n}`}>Download</a><button className="primary small" onClick={() => insertRef(viewer.n)}>Refer to it in a new entry</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function LogsPage() {
  const { campaign } = useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const cid = campaign?.id;
  const { data: sessions, error, reload } = useLoad(() => (cid ? api.get(`/campaigns/${cid}/sessions`) : Promise.resolve([])), [cid]);
  const [run, busy, err] = useAction();
  if (!cid) return <NeedParty />;
  const start = () => run(async () => { const r = await api.post(`/campaigns/${cid}/sessions`, {}); await reload(); nav(`/logs/${r.id}`); });
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Session logs</h1>
        <button className="primary" disabled={busy} onClick={start}>+ Start new session</button>
      </div>
      <ErrorBox error={error || err} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(180px, 240px) minmax(0, 1fr)' }}>
        <div className="stack" style={{ gap: 6 }}>
          {sessions?.map((s) => (
            <Link key={s.id} to={`/logs/${s.id}`} className={`card tight click ${String(s.id) === id ? 'selected' : ''}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>
              <strong>#{s.number}</strong> {s.title || <span className="muted">Untitled</span>}
              <div className="muted small">{fmtDay(s.date)} · {s.entries} entries</div>
            </Link>
          ))}
          {!sessions?.length && <div className="empty">No sessions yet.</div>}
        </div>
        <div>{id ? <SessionView key={id} cid={cid} id={id} onChanged={reload} /> : <div className="empty">Pick a session or start a new one.</div>}</div>
      </div>
    </div>
  );
}
