import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, fileToDataUrl, resizeImage } from '../api.js';
import { ErrorBox, Modal, useAction, useApp, useLoad, NeedParty } from '../components/ui.jsx';

const mapUrl = (cid, m) => `/api/campaigns/${cid}/maps/${m.id}/image?v=${encodeURIComponent(m.updated_at || '')}`;

/** Keep the original file when it is reasonably small (maps need detail); shrink huge ones. */
async function readMap(file) {
  if (!file?.type.startsWith('image/')) throw new Error('Pick an image file (JPEG, PNG, WebP or GIF)');
  return file.size <= 12 * 1024 * 1024 ? fileToDataUrl(file) : resizeImage(file, 6000, 0.9);
}

/** Pan & zoom: mouse wheel / buttons / double-click to zoom, drag to pan, pinch on touch screens. */
function ZoomImage({ src, alt }) {
  const box = useRef(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const [fit, setFit] = useState(1);
  const pts = useRef(new Map());
  const last = useRef(null);
  const size = useRef({ w: 1, h: 1 });

  const fitToBox = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const { w, h } = size.current;
    const s = Math.min(el.clientWidth / w, el.clientHeight / h, 1);
    setFit(s);
    setT({ s, x: (el.clientWidth - w * s) / 2, y: (el.clientHeight - h * s) / 2 });
  }, []);
  useEffect(() => { window.addEventListener('resize', fitToBox); return () => window.removeEventListener('resize', fitToBox); }, [fitToBox]);

  const zoomAt = (factor, cx, cy) => setT((p) => {
    const s = Math.max(fit * 0.5, Math.min(8, p.s * factor));
    const k = s / p.s;
    return { s, x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k };
  });
  const center = () => { const el = box.current; return [el.clientWidth / 2, el.clientHeight / 2]; };
  const local = (e) => { const r = box.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  useEffect(() => {
    const el = box.current;
    const onWheel = (e) => { e.preventDefault(); const [x, y] = local(e); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, x, y); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const down = (e) => { box.current.setPointerCapture(e.pointerId); pts.current.set(e.pointerId, local(e)); last.current = null; };
  const move = (e) => {
    if (!pts.current.has(e.pointerId)) return;
    const prev = pts.current.get(e.pointerId);
    const now = local(e);
    pts.current.set(e.pointerId, now);
    if (pts.current.size === 1) setT((p) => ({ ...p, x: p.x + now[0] - prev[0], y: p.y + now[1] - prev[1] }));
    else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (last.current) zoomAt(dist / last.current, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      last.current = dist;
    }
  };
  const up = (e) => { pts.current.delete(e.pointerId); last.current = null; };

  return (
    <div className="zoom-box" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={(e) => { const [x, y] = local(e); zoomAt(2, x, y); }}>
      <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}
        onLoad={(e) => { size.current = { w: e.target.naturalWidth, h: e.target.naturalHeight }; fitToBox(); }} />
      <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => zoomAt(1.4, ...center())} title="Zoom in">＋</button>
        <button onClick={() => zoomAt(1 / 1.4, ...center())} title="Zoom out">－</button>
        <button onClick={fitToBox} title="Fit to screen">⤢</button>
        <span className="small">{Math.round((t.s / (fit || 1)) * 100)}%</span>
      </div>
    </div>
  );
}

function UploadModal({ cid, onDone, onClose }) {
  const [f, setF] = useState({ title: '', notes: '', shared: true, image: '' });
  const [run, busy, err] = useAction();
  const pick = (file) => run(async () => {
    const image = await readMap(file);
    setF((x) => ({ ...x, image, title: x.title || file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }));
  });
  return (
    <Modal title="🗺️ Upload a map" onClose={onClose}>
      <div className="stack">
        <label className={`map-drop ${f.image ? 'has' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
          {f.image ? <img src={f.image} alt="" /> : <span>Choose or drop a map image</span>}
          <input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files[0])} />
        </label>
        <div><label>Name</label><input value={f.title} maxLength={120} placeholder="e.g. Sword Coast, Goblin cave level 1" onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><label>Notes for the party (optional)</label><textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <label className="inline"><input type="checkbox" checked={f.shared} onChange={(e) => setF({ ...f, shared: e.target.checked })} /> Visible to players now</label>
        <ErrorBox error={err} />
        <div className="row end"><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !f.image} onClick={() => run(async () => { const r = await api.post(`/campaigns/${cid}/maps`, f); await onDone(r.id); })}>{busy ? 'Uploading…' : 'Upload'}</button></div>
      </div>
    </Modal>
  );
}

/** Full-screen map viewer with prev/next and (for the DM) editing. */
function MapViewer({ cid, map, maps, isDm, onClose, go, reload }) {
  const [edit, setEdit] = useState(null);
  const [run, busy, err] = useAction();
  const i = maps.findIndex((m) => m.id === map.id);
  useEffect(() => {
    const k = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; if (e.key === 'ArrowRight' && maps[i + 1]) go(maps[i + 1]); if (e.key === 'ArrowLeft' && maps[i - 1]) go(maps[i - 1]); if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [i, maps, go, onClose]);
  const patch = (b) => run(async () => { await api.patch(`/campaigns/${cid}/maps/${map.id}`, b); await reload(); });
  return (
    <div className="map-viewer">
      <div className="map-bar">
        <button className="ghost" onClick={onClose}>✕</button>
        <button className="ghost" disabled={i <= 0} onClick={() => go(maps[i - 1])} title="Previous map">‹</button>
        <div className="grow" style={{ minWidth: 0 }}>
          <strong className="map-title">{map.title}</strong>
          <div className="muted small">{i + 1} / {maps.length}{isDm ? (map.shared ? ' · visible to players' : ' · hidden from players') : ''}</div>
        </div>
        <button className="ghost" disabled={i >= maps.length - 1} onClick={() => go(maps[i + 1])} title="Next map">›</button>
        {isDm && <button className="small" onClick={() => setEdit(edit ? null : { title: map.title, notes: map.notes })}>✎ Edit</button>}
        <a className="btn small" href={mapUrl(cid, map)} download={map.title}>⬇</a>
      </div>
      <ZoomImage key={map.id} src={mapUrl(cid, map)} alt={map.title} />
      {(map.notes || edit) && (
        <div className="map-notes">
          {edit ? (
            <div className="stack">
              <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              <textarea rows={3} value={edit.notes} placeholder="Notes for the party" onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              <div className="row">
                <label className="inline small"><input type="checkbox" checked={map.shared} disabled={busy} onChange={(e) => patch({ shared: e.target.checked })} /> Visible to players</label>
                <label className="btn small">Replace image<input type="file" accept="image/*" hidden onChange={(e) => run(async () => { await api.patch(`/campaigns/${cid}/maps/${map.id}`, { image: await readMap(e.target.files[0]) }); await reload(); })} /></label>
                <span className="grow" />
                <button className="small danger" disabled={busy} onClick={() => confirm(`Delete the map "${map.title}"?`) && run(async () => { await api.del(`/campaigns/${cid}/maps/${map.id}`); await reload(); onClose(); })}>Delete</button>
                <button className="small" onClick={() => setEdit(null)}>Cancel</button>
                <button className="small primary" disabled={busy} onClick={() => run(async () => { await api.patch(`/campaigns/${cid}/maps/${map.id}`, edit); await reload(); setEdit(null); })}>Save</button>
              </div>
            </div>
          ) : <div className="pre small">{map.notes}</div>}
          <ErrorBox error={err} />
        </div>
      )}
    </div>
  );
}

export default function MapsPage() {
  const { campaign } = useApp();
  const cid = campaign?.id;
  const isDm = campaign?.role === 'dm';
  const { id } = useParams();
  const nav = useNavigate();
  const { data: maps, error, reload } = useLoad(() => (cid ? api.get(`/campaigns/${cid}/maps`) : Promise.resolve([])), [cid]);
  const [uploading, setUploading] = useState(false);
  const go = useCallback((m) => nav(`/maps/${m.id}`, { replace: true }), [nav]);
  if (!cid) return <NeedParty />;
  const open = maps?.find((m) => String(m.id) === id);
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Maps</h1>
        {isDm && <button className="primary" onClick={() => setUploading(true)}>+ Upload map</button>}
      </div>
      <ErrorBox error={error} />
      {maps && !maps.length && <div className="empty">{isDm ? 'No maps yet. Upload world, region or dungeon maps for your party to look at.' : 'Your DM has not shared any maps yet.'}</div>}
      <div className="map-grid">
        {maps?.map((m) => (
          <button key={m.id} className="map-card" onClick={() => nav(`/maps/${m.id}`)}>
            <img src={mapUrl(cid, m)} alt="" loading="lazy" />
            <div className="map-card-title">{m.title}{isDm && !m.shared && <span className="badge" style={{ marginLeft: 6 }}>hidden</span>}</div>
          </button>
        ))}
      </div>
      {uploading && <UploadModal cid={cid} onClose={() => setUploading(false)} onDone={async (newId) => { setUploading(false); await reload(); nav(`/maps/${newId}`); }} />}
      {open && <MapViewer cid={cid} map={open} maps={maps} isDm={isDm} go={go} reload={reload} onClose={() => nav('/maps')} />}
    </div>
  );
}
