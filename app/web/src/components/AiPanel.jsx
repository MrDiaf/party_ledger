import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, resizeImage } from '../api.js';
import { useApp, useLoad } from './ui.jsx';

const EXAMPLES = ['Tordek took 12 slashing damage', 'We take a long rest', 'Add 150 gp and a Bag of Holding to the treasury', 'What quests are still open?', 'How does grappling work?'];
const MARK = /\[attached image upload_id (\d+)\]/g;

/** A message; image markers in user messages are shown as thumbnails. */
function Message({ m }) {
  const ids = m.role === 'user' ? [...m.content.matchAll(MARK)].map((x) => x[1]) : [];
  const text = m.content.replace(MARK, '').replace(/^\(image\)\s*$/m, '').trim();
  return (
    <div className={`msg ${m.role}`}>
      {text}
      {(ids.length > 0 || m.previews?.length > 0) && (
        <div className="msg-pics">
          {ids.map((id) => <a key={id} href={`/api/ai/uploads/${id}`} target="_blank" rel="noreferrer"><img src={`/api/ai/uploads/${id}`} alt="" /></a>)}
          {m.previews?.map((u, i) => <img key={i} src={u} alt="" />)}
        </div>
      )}
    </div>
  );
}

/** Something the assistant wants to do that waits for the user's OK. */
function Proposal({ p, onDone }) {
  const nav = useNavigate();
  const [caption, setCaption] = useState(p.payload.caption || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const decide = async (d) => {
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/ai/proposals/${p.id}/${d}`, d === 'accept' ? { caption } : {});
      await onDone();
      if (d === 'accept' && r.session_id) nav(`/logs/${r.session_id}`);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="proposal">
      <div className="small"><b>Add this picture to {p.payload.session}?</b></div>
      <img src={`/api/ai/uploads/${p.payload.upload_id}`} alt="" />
      <input value={caption} placeholder="Caption (optional)" onChange={(e) => setCaption(e.target.value)} />
      {err && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}
      <div className="row end" style={{ gap: 6 }}>
        <button className="small" disabled={busy} onClick={() => decide('discard')}>Discard</button>
        <button className="small primary" disabled={busy} onClick={() => decide('accept')}>✓ Add to session</button>
      </div>
    </div>
  );
}

export default function AiPanel({ onClose }) {
  const { campaign } = useApp();
  const { data, reload, setData } = useLoad(() => api.get('/ai/messages'), []);
  const [text, setText] = useState('');
  const [pics, setPics] = useState([]);
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const file = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [data, busy]);

  const addFiles = async (files) => {
    const urls = await Promise.all([...files].filter((f) => f.type.startsWith('image/')).slice(0, 4).map((f) => resizeImage(f, 1600, 0.85)));
    setPics((p) => [...p, ...urls].slice(0, 4));
  };
  const send = async (msg) => {
    if ((!msg.trim() && !pics.length) || busy) return;
    const images = pics;
    setText(''); setPics([]);
    setBusy(true);
    setData((d) => ({ ...d, messages: [...(d?.messages || []), { id: `tmp${Date.now()}`, role: 'user', content: msg, previews: images }] }));
    try { await api.post('/ai/chat', { message: msg, images, campaign_id: campaign?.id }); } catch { /* error is stored as a message */ }
    await reload();
    setBusy(false);
  };

  return (
    <aside className="ai-panel">
      <div className="head">
        <strong>✨ Assistant</strong>
        <div className="row" style={{ gap: 4 }}>
          <button className="small ghost" title="Clear conversation and images" onClick={async () => { await api.del('/ai/messages'); reload(); }}>Clear</button>
          <button className="small ghost" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="ai-msgs" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
        {!data?.messages?.length && (
          <div className="muted small stack">
            <div>Ask me to track HP and spell slots, update quests, the treasury or session log, or look up a PHB rule. Send me pictures (📎) and I can put them in a session log — you confirm first. I act with your permissions{campaign ? ` in “${campaign.name}”` : ''}.</div>
            {EXAMPLES.map((e) => <button key={e} className="small" style={{ justifyContent: 'flex-start', whiteSpace: 'normal' }} onClick={() => send(e)}>{e}</button>)}
          </div>
        )}
        {data?.messages?.map((m) => <Message key={m.id} m={m} />)}
        {busy && <div className="msg assistant muted typing">Thinking</div>}
        {data?.proposals?.map((p) => <Proposal key={p.id} p={p} onDone={reload} />)}
        <div ref={end} />
      </div>
      {pics.length > 0 && (
        <div className="ai-pics">{pics.map((u, i) => <div key={i} className="log-pic"><img src={u} alt="" /><button className="ghost small" onClick={() => setPics((p) => p.filter((_, j) => j !== i))}>✕</button></div>)}</div>
      )}
      <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <button type="button" title="Attach pictures" onClick={() => file.current.click()}>📎</button>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <textarea rows={2} style={{ minHeight: 44 }} value={text} placeholder={pics.length ? 'e.g. “add this to tonight’s session as the map”' : 'Message…'} onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
        <button className="primary" disabled={busy || (!text.trim() && !pics.length)}>Send</button>
      </form>
    </aside>
  );
}
