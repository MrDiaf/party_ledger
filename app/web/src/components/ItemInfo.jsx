import { useState } from 'react';
import { Modal } from './ui.jsx';
import { findItem, itemOf, groupKind, CUSTOM_KINDS } from '../../../shared/items.js';

export const KIND_ICON = { Weapon: '⚔️', Armor: '🛡️', Shield: '🛡️', Tool: '🔧', Pack: '🎒', Ammunition: '🏹', Consumable: '🧪', Focus: '🔮', 'Mount/Vehicle': '🐎', Gear: '🧰', Custom: '📦' };

/** Everything the catalog knows about one item, in plain words. */
export function ItemDetails({ srd, item, entry }) {
  const it = item || itemOf(srd, entry);
  if (!it) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        <div className="muted small">Custom item (not in the SRD catalog).</div>
        {entry?.weight != null && entry.weight !== '' && <div><b>Weight:</b> {entry.weight} lb</div>}
        {entry?.desc && <div className="pre">{entry.desc}</div>}
        {entry?.notes && <div className="muted">{entry.notes}</div>}
      </div>
    );
  }
  const props = it.properties || [];
  const facts = [
    ['Type', `${it.custom ? CUSTOM_KINDS.find(([k]) => k === it.kind)?.[1] || it.kind : groupKind(it) === 'Consumable' ? 'Consumable' : it.kind}${it.sub ? ` · ${it.sub}` : ''}`],
    ['Cost', it.cost], ['Weight', it.weight != null ? `${it.weight} lb${it.bundle ? ` per ${it.bundle}` : ''}` : ''],
    ['Damage', it.damage], ['Two-handed', it.versatile], ['Range', it.range], ['Thrown', it.thrown],
    ['Armor class', it.ac ? `${it.kind === 'Shield' ? '+' : ''}${it.ac.base}${it.ac.dex ? ` + DEX${it.ac.max_dex != null ? ` (max ${it.ac.max_dex})` : ''}` : ''}` : ''],
    ['Strength needed', it.str_min], ['Stealth', it.stealth_dis ? 'Disadvantage' : ''],
  ].filter(([, v]) => v != null && v !== '');
  return (
    <div className="stack" style={{ gap: 8 }}>
      {it.custom && <div className="muted small">Custom item (not in the SRD catalog).</div>}
      <div className="facts">{facts.map(([k, v]) => <div key={k}><span className="muted small">{k}</span><div>{v}</div></div>)}</div>
      {props.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <strong className="small">Properties</strong>
          {props.map((p) => (
            <details key={p} className="feature"><summary>{p}</summary><div className="desc">{srd.weapon_properties?.[p] || ''}</div></details>
          ))}
        </div>
      )}
      {it.special && <div className="pre small">{it.special}</div>}
      {it.desc && <div className="pre small muted">{it.desc}</div>}
      {it.contents && (
        <div><strong className="small">Contains</strong>
          <ul className="small" style={{ margin: '4px 0', paddingLeft: 18 }}>{it.contents.map((c) => <li key={c.index}>{c.qty > 1 ? `${c.qty}× ` : ''}{findItem(srd, c.index)?.name || c.index}</li>)}</ul>
          <div className="muted small">Packs are unpacked into their separate items on your sheet.</div>
        </div>
      )}
      {entry?.notes && <div className="muted small">Note: {entry.notes}</div>}
    </div>
  );
}

export function ItemModal({ srd, item, entry, title, onClose, children }) {
  const it = item || itemOf(srd, entry);
  const name = entry?.name || it?.name || 'Item';
  return (
    <Modal title={title || `${KIND_ICON[it?.kind] || '📦'} ${name}`} onClose={onClose}>
      {!title && <ItemDetails srd={srd} item={it} entry={entry} />}
      {children}
    </Modal>
  );
}

/** Item name with an info button. */
export function ItemChip({ srd, index, qty, label }) {
  const [open, setOpen] = useState(false);
  const it = findItem(srd, index);
  return (
    <>
      <button type="button" className="item-chip" onClick={(e) => { e.stopPropagation(); setOpen(true); }} title="Show item details">
        <span>{KIND_ICON[it?.kind] || '📦'}</span>{qty > 1 ? `${qty}× ` : ''}{label || it?.name || index}<span className="info-dot">i</span>
      </button>
      {open && <ItemModal srd={srd} item={it} onClose={() => setOpen(false)} />}
    </>
  );
}

const KINDS = ['All', 'Weapon', 'Armor', 'Shield', 'Gear', 'Consumable', 'Tool', 'Pack', 'Ammunition', 'Focus', 'Mount/Vehicle'];

/** Search the SRD catalog and pick an item. */
export function CatalogPicker({ srd, onPick, onClose, only }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('All');
  const [open, setOpen] = useState(null);
  const pool = only ? only.map((i) => findItem(srd, i)).filter(Boolean) : srd.items;
  const shown = pool.filter((i) => (kind === 'All' || groupKind(i) === kind) && (!q || i.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <Modal title="Add an item" onClose={onClose} wide>
      <div className="stack">
        <input autoFocus placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
        {!only && <div className="chips">{KINDS.map((k) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{KIND_ICON[k] || ''} {k}</button>)}</div>}
        <div className="catalog">
          {shown.map((i) => (
            <div key={i.index} className="catalog-row">
              <button className="ghost grow left" onClick={() => setOpen(open === i.index ? null : i.index)}>
                <span>{KIND_ICON[groupKind(i)]}</span><span className="grow">{i.name}</span>
                <span className="muted small">{[i.damage, i.ac && `AC ${i.ac.base}${i.kind === 'Shield' ? '+' : ''}`, i.cost, i.weight != null && `${i.weight} lb`].filter(Boolean).join(' · ')}</span>
              </button>
              <button className="small primary" onClick={() => onPick(i)}>Add</button>
              {open === i.index && <div className="catalog-detail"><ItemDetails srd={srd} item={i} /></div>}
            </div>
          ))}
          {!shown.length && <div className="muted small">Nothing matches.</div>}
        </div>
      </div>
    </Modal>
  );
}
