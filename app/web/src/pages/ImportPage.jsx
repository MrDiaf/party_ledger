import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, resizeImage, fileToDataUrl } from '../api.js';
import { ErrorBox, useAction, useApp } from '../components/ui.jsx';
import { derived, signed, ABILITIES } from '../../../shared/rules.js';

export default function ImportPage() {
  const { aiEnabled, campaigns, campaign } = useApp();
  const nav = useNavigate();
  const [images, setImages] = useState([]);
  const [pdfs, setPdfs] = useState([]); // [{ name, size, data }]
  const [pdfErr, setPdfErr] = useState('');
  const [draft, setDraft] = useState(null);
  const [partyId, setPartyId] = useState(campaign?.id || '');
  const [drag, setDrag] = useState(false);
  const [run, busy, error] = useAction();
  const add = async (files) => {
    setPdfErr('');
    const all = [...files];
    const pics = all.filter((f) => f.type.startsWith('image/'));
    const docs = all.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const big = docs.filter((f) => f.size > 20 * 1024 * 1024);
    if (big.length) setPdfErr(`${big.map((f) => f.name).join(', ')}: PDFs up to 20 MB please.`);
    const list = await Promise.all(pics.slice(0, 4).map((f) => resizeImage(f, 2000, 0.88)));
    const pdfList = await Promise.all(docs.filter((f) => f.size <= 20 * 1024 * 1024).slice(0, 2).map(async (f) => ({ name: f.name, size: f.size, data: (await fileToDataUrl(f)).replace(/^data:[^;]*;/, 'data:application/pdf;') })));
    setImages((prev) => [...prev, ...list].slice(0, 4));
    setPdfs((prev) => [...prev, ...pdfList].slice(0, 2));
  };
  const total = images.length + pdfs.length;
  const x = draft ? derived(draft) : null;
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <h1>Import a character sheet</h1>
      {!aiEnabled && <div className="notice">The AI assistant is turned off. An admin can enable it under Admin → AI assistant.</div>}
      <div className="card stack">
        <p>Take a photo of each page, or upload scans or a <b>PDF</b> of the sheet (D&D Beyond exports and fillable PDF sheets work best — their typed-in fields are read exactly). The assistant fills in a draft. Nothing is saved until you check it and press <b>Create</b>.</p>
        <div className="row">
          <label className="btn primary">📷 Take photo<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></label>
          <label className="btn">🖼 Upload images<input type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></label>
          <label className="btn">📄 Upload PDF<input type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></label>
          <span className="muted small">Up to 4 photos and 2 PDFs (first 6 pages each).</span>
        </div>
        <div className={`drop-zone ${drag ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}>or drop photos / PDFs here</div>
        {pdfErr && <div className="error small">{pdfErr}</div>}
        {pdfs.length > 0 && (
          <div className="chips">
            {pdfs.map((p, i) => (
              <span key={i} className="item-chip plain">📄 {p.name} <span className="muted">({(p.size / 1024 / 1024).toFixed(1)} MB)</span>
                <button className="ghost small" onClick={() => setPdfs(pdfs.filter((_, j) => j !== i))}>✕</button></span>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="row">
            {images.map((src, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={src} alt={`page ${i + 1}`} style={{ height: 140, borderRadius: 8, border: '1px solid var(--line)' }} />
                <button className="small" style={{ position: 'absolute', top: 4, right: 4 }} onClick={() => setImages(images.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}
        <ErrorBox error={error} />
        <div className="row end">
          <button className="primary" disabled={!total || busy || !aiEnabled} onClick={() => run(async () => setDraft((await api.post('/characters/import-image', { images, files: pdfs.map((p) => p.data) })).data))}>
            {busy ? 'Reading the sheet… (can take a minute)' : 'Read sheet'}
          </button>
        </div>
      </div>
      {draft && (
        <div className="card stack">
          <h2>Check the result</h2>
          <div className="grid two">
            <div><label>Name</label><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div><label>Party</label><select value={partyId} onChange={(e) => setPartyId(e.target.value)}><option value="">Private</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="muted">{draft.race?.name} {draft.subrace?.name && `(${draft.subrace.name})`} · {draft.classes.map((c) => `${c.name} ${c.level}`).join(' / ')} · {draft.background?.name}</div>
          <div className="abilities">{ABILITIES.map((a) => (
            <div key={a} className="ability"><div className="name">{a.toUpperCase()}</div>
              <input type="number" value={draft.abilities[a]} onChange={(e) => setDraft({ ...draft, abilities: { ...draft.abilities, [a]: Number(e.target.value) } })} />
              <div className="muted">{signed(x.mods[a])}</div></div>
          ))}</div>
          <div className="small">HP {draft.hp.current}/{draft.hp.max} · AC {draft.ac} · {Object.keys(draft.skills).length} skills · {draft.spells.length} spells · {draft.equipment.length} items · {draft.features.length} features</div>
          {draft.notes && <div className="notice small pre">{draft.notes}</div>}
          <p className="muted small">Everything else can be fixed on the sheet after creating — it all stays editable and versioned.</p>
          <div className="row end"><button className="primary" disabled={busy || !draft.name} onClick={() => run(async () => {
            const r = await api.post('/characters', { data: draft, kind: 'import', campaign_id: partyId || null });
            nav(`/characters/${r.id}`);
          })}>Create character</button></div>
        </div>
      )}
    </div>
  );
}
