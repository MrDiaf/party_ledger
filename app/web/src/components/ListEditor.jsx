/**
 * Edit an array of objects inline. fields: [{ key, label, type: 'text'|'number'|'area'|'check', width }]
 * Nothing is validated — the sheet never locks the player.
 */
export default function ListEditor({ items, fields, onChange, readOnly, addLabel = '+ Add', blank = {}, render }) {
  const set = (i, k, v) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const move = (i, d) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x);
    onChange(next);
  };
  return (
    <div className="list-edit">
      {items.map((it, i) => (
        <div key={i} className="item">
          {readOnly ? render?.(it) ?? <div><strong>{it[fields[0].key]}</strong> {fields.slice(1).map((f) => it[f.key] && f.type !== 'area' && <span key={f.key} className="muted small"> · {String(it[f.key])}</span>)}{fields.filter((f) => f.type === 'area' && it[f.key]).map((f) => <div key={f.key} className="muted small pre">{it[f.key]}</div>)}</div> : (
            <>
              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {fields.filter((f) => f.type !== 'area').map((f) => (
                  f.type === 'check'
                    ? <label key={f.key} className="inline small"><input type="checkbox" checked={!!it[f.key]} onChange={(e) => set(i, f.key, e.target.checked)} /> {f.label}</label>
                    : <div key={f.key} style={{ flex: f.width || 1, minWidth: 70 }}><label>{f.label}</label>
                      <input type={f.type === 'number' ? 'number' : 'text'} value={it[f.key] ?? ''} onChange={(e) => set(i, f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)} /></div>
                ))}
                <div className="row" style={{ gap: 2 }}>
                  <button className="ghost small" onClick={() => move(i, -1)} title="Move up">↑</button>
                  <button className="ghost small" onClick={() => move(i, 1)} title="Move down">↓</button>
                  <button className="ghost small" onClick={() => onChange(items.filter((_, j) => j !== i))} title="Remove">✕</button>
                </div>
              </div>
              {fields.filter((f) => f.type === 'area').map((f) => (
                <textarea key={f.key} rows={2} placeholder={f.label} value={it[f.key] ?? ''} onChange={(e) => set(i, f.key, e.target.value)} />
              ))}
            </>
          )}
        </div>
      ))}
      {!items.length && <div className="muted small" style={{ padding: '6px 0' }}>None.</div>}
      {!readOnly && <button className="small" style={{ marginTop: 8 }} onClick={() => onChange([...items, { ...blank }])}>{addLabel}</button>}
    </div>
  );
}
