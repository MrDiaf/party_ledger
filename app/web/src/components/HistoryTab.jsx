import { useState } from 'react';
import { api } from '../api.js';
import { Modal, ErrorBox, useAction, useLoad, fmtDate } from './ui.jsx';

const KIND = { create: 'gold', import: 'gold', levelup: 'green', revert: 'red', manual: 'blue', ai: 'blue', resource: '', autosave: '' };

/** Flatten an object into "path: value" lines for a readable line diff. */
function flatten(obj, prefix = '', out = []) {
  if (obj && typeof obj === 'object') {
    const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
    if (!entries.length) out.push(`${prefix}: ${Array.isArray(obj) ? '[]' : '{}'}`);
    for (const [k, v] of entries) {
      if (k === 'portrait') { out.push(`${prefix}${k}: ${v ? '(image)' : ''}`); continue; }
      const p = Array.isArray(obj) ? `${prefix.replace(/\.$/, '')}[${k}].` : `${prefix}${k}.`;
      flatten(v, p, out);
    }
  } else out.push(`${prefix.replace(/\.$/, '')}: ${String(obj).replace(/\n/g, '⏎').slice(0, 300)}`);
  return out;
}

export function diffLines(a, b) {
  const A = new Set(flatten(a)), B = new Set(flatten(b));
  return [...[...A].filter((l) => !B.has(l)).map((l) => ['del', l]), ...[...B].filter((l) => !A.has(l)).map((l) => ['add', l])]
    .sort((x, y) => x[1].localeCompare(y[1]));
}

function VersionModal({ charId, version, current, canEdit, onClose, onReverted }) {
  const { data: v, error } = useLoad(() => api.get(`/characters/${charId}/versions/${version.id}`), [version.id]);
  const { data: parent } = useLoad(() => (version.parent_id ? api.get(`/characters/${charId}/versions/${version.parent_id}`) : Promise.resolve(null)), [version.parent_id]);
  const [mode, setMode] = useState('change');
  const [run, busy, err] = useAction();
  const lines = v ? (mode === 'change' ? diffLines(parent?.data || {}, v.data) : diffLines(v.data, current)) : [];
  return (
    <Modal title={`Version #${version.id}`} onClose={onClose} wide>
      <div className="stack">
        <div><span className={`badge ${KIND[version.kind]}`}>{version.kind}</span> {version.message} <span className="muted small">— {version.author}, {fmtDate(version.created_at)}</span></div>
        <div className="tabs">
          <button className={mode === 'change' ? 'active' : ''} onClick={() => setMode('change')}>What changed in this version</button>
          <button className={mode === 'now' ? 'active' : ''} onClick={() => setMode('now')}>Difference to current sheet</button>
        </div>
        <ErrorBox error={error || err} />
        <div className="diff">
          {!v ? 'Loading…' : !lines.length ? 'No differences.' : lines.map(([k, l], i) => <div key={i} className={k}>{k === 'add' ? '+ ' : '− '}{l}</div>)}
        </div>
        {canEdit && (
          <div className="row end">
            <button className="primary" disabled={busy || !v} onClick={() => confirm('Restore this version? Your current state stays in history, so you can come back to it.') && run(async () => { await api.post(`/characters/${charId}/revert/${version.id}`); onReverted(); })}>⟲ Restore this version</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function HistoryTab({ charId, current, canEdit, onReverted, flush }) {
  const { data: versions, error, reload } = useLoad(() => api.get(`/characters/${charId}/history`), [charId, current]);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('all');
  const [run, busy, err] = useAction();
  const shown = (versions || []).filter((v) => filter === 'all' || (filter === 'milestones' ? ['create', 'import', 'levelup', 'manual', 'revert'].includes(v.kind) : v.kind === filter));
  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All changes</option><option value="milestones">Milestones (create, level-ups, snapshots)</option>
            <option value="resource">Resource actions</option><option value="autosave">Edits</option><option value="ai">AI changes</option>
          </select>
          <span className="muted small">{versions?.length || 0} versions — nothing is ever deleted.</span>
        </div>
        {canEdit && <button disabled={busy} onClick={() => {
          const m = prompt('Snapshot name (like a git commit message):', 'Before the dragon fight');
          if (m) run(async () => { await flush(); await api.put(`/characters/${charId}`, { data: current, kind: 'manual', message: m }); reload(); });
        }}>📌 Save snapshot</button>}
      </div>
      <ErrorBox error={error || err} />
      <div className="card">
        {shown.map((v) => (
          <div key={v.id} className="history-item">
            <span className={`badge kind ${KIND[v.kind]}`}>{v.kind}</span>
            <div><div>{v.message}</div><div className="muted small">#{v.id} · {v.author || 'unknown'} · {fmtDate(v.updated_at || v.created_at)}</div></div>
            <button className="small" onClick={() => setOpen(v)}>View</button>
          </div>
        ))}
        {!shown.length && <div className="muted">No versions.</div>}
      </div>
      {open && <VersionModal charId={charId} version={open} current={current} canEdit={canEdit} onClose={() => setOpen(null)} onReverted={() => { setOpen(null); onReverted(); }} />}
    </div>
  );
}
