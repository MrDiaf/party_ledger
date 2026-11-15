// Shared item UI for character inventories and the party treasury: one item model (shared/items.js),
// one grouped list and one editor, so both places add and edit items the same way.
import {
  findItem, itemOf, groupKind, ITEM_GROUPS, CUSTOM_KINDS, WEAPON_TYPES, ARMOR_TYPES, DAMAGE_TYPES,
} from '../../../shared/items.js';
import { KIND_ICON } from './ItemInfo.jsx';

const ARMOR_HINT = { 'Light armor': '+ DEX modifier', 'Medium armor': '+ DEX modifier (max 2)', 'Heavy armor': 'no DEX' };

/** The section an item sits in by default: catalog kind (consumables split out), or a custom item's category. */
export const defaultGroup = (srd, e) => { const c = findItem(srd, e.index); return c ? groupKind(c) : itemOf(srd, e).kind; };
/** The section an item is shown under: a catalog item can be moved with `category`. */
export const groupOf = (srd, e) => (findItem(srd, e.index) && ITEM_GROUPS.some(([k, l]) => l && k === e.category) ? e.category : defaultGroup(srd, e));

/** Short stats shown on a list row: damage or AC. */
export function itemSummary(srd, e) {
  const it = itemOf(srd, e);
  return [it?.damage, it?.ac && `AC ${it.kind === 'Shield' ? '+' : ''}${it.ac.base}`].filter(Boolean).join(' · ');
}

/** Entries grouped into inventory sections with headings; `renderRow(entry, key)` draws each row. */
export function ItemGroups({ srd, entries, renderRow, empty = 'No items yet.' }) {
  const rows = entries.map((e, i) => ({ e, key: e.id ?? i, group: groupOf(srd, e) }));
  if (!rows.length) return <div className="muted small">{empty}</div>;
  return ITEM_GROUPS.map(([k, label]) => {
    const list = rows.filter((r) => r.group === k || (k === 'Armor' && r.group === 'Shield'));
    if (!label || !list.length) return null;
    return (
      <div key={k}>
        <div className="inv-group">{KIND_ICON[k] || '📦'} {label}</div>
        {list.map(({ e, key }) => renderRow(e, key))}
      </div>
    );
  });
}

/** Category + stats editor for a custom (non-catalog) item: weapons get damage, armor and shields get AC. */
function CustomItemFields({ e, srd, onPatch }) {
  const kind = itemOf(srd, e).kind;
  const props = Array.isArray(e.properties) ? e.properties : [];
  const toggle = (p) => onPatch({ properties: props.includes(p) ? props.filter((x) => x !== p) : [...props, p] });
  const armorType = ARMOR_TYPES.includes(e.armor_type) ? e.armor_type : 'Light armor';
  return (
    <>
      <div><label>Category</label>
        <select value={kind} onChange={(ev) => {
          const k = ev.target.value;
          onPatch({ category: k, ...(k === 'Shield' && e.ac_base == null ? { ac_base: 2 } : {}) });
        }}>
          {CUSTOM_KINDS.map(([k, l]) => <option key={k} value={k}>{KIND_ICON[k] || '📦'} {l}</option>)}
        </select>
      </div>
      {kind === 'Weapon' && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="grid two">
            <div><label>Weapon type</label><select value={WEAPON_TYPES.includes(e.weapon_type) ? e.weapon_type : 'Simple Melee'} onChange={(ev) => onPatch({ weapon_type: ev.target.value })}>{WEAPON_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label>Damage dice</label><input placeholder="1d8" value={e.damage || ''} onChange={(ev) => onPatch({ damage: ev.target.value.replace(/\s+/g, '') })} /></div>
            <div><label>Damage type</label><select value={e.damage_type || ''} onChange={(ev) => onPatch({ damage_type: ev.target.value })}><option value="">—</option>{DAMAGE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            {(/Ranged/.test(e.weapon_type || '') || props.includes('Thrown')) && <div><label>Range (ft)</label><input placeholder="80/320 ft" value={e.range || ''} onChange={(ev) => onPatch({ range: ev.target.value })} /></div>}
            {props.includes('Versatile') && <div><label>Two-handed damage</label><input placeholder="1d10" value={e.versatile || ''} onChange={(ev) => onPatch({ versatile: ev.target.value.replace(/\s+/g, '') })} /></div>}
          </div>
          <div><label>Properties</label>
            <div className="chips">{Object.keys(srd?.weapon_properties || {}).filter((p) => p !== 'Monk').map((p) => (
              <button key={p} type="button" className={`chip ${props.includes(p) ? 'on' : ''}`} onClick={() => toggle(p)}>{p}</button>
            ))}</div>
          </div>
        </div>
      )}
      {kind === 'Armor' && (
        <div className="grid two">
          <div><label>Armor type</label><select value={armorType} onChange={(ev) => onPatch({ armor_type: ev.target.value })}>{ARMOR_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label>Base AC <span className="muted small">{ARMOR_HINT[armorType]}</span></label>
            <input type="number" inputMode="numeric" placeholder="11" value={e.ac_base ?? ''} onChange={(ev) => onPatch({ ac_base: ev.target.value === '' ? null : Number(ev.target.value) })} /></div>
        </div>
      )}
      {kind === 'Shield' && (
        <div><label>AC bonus</label><input type="number" inputMode="numeric" value={e.ac_base ?? 2} onChange={(ev) => onPatch({ ac_base: ev.target.value === '' ? null : Number(ev.target.value) })} /></div>
      )}
    </>
  );
}

/**
 * Editor for one item entry ({ name, qty, notes, desc, index?, category?, …stats }).
 * `extra` adds context-specific fields (e.g. treasury holder/value) inside the grid.
 */
export function ItemFields({ e, srd, onPatch, autoFocus, extra }) {
  const cat = findItem(srd, e.index);
  const def = defaultGroup(srd, e);
  const defSection = ITEM_GROUPS.find(([k]) => k === (def === 'Shield' ? 'Armor' : def))?.[1];
  return (
    <>
      <div className="grid two">
        <div><label>Name</label><input autoFocus={autoFocus} placeholder="Item name" value={e.name} onChange={(ev) => onPatch({ name: ev.target.value })} /></div>
        <div><label>Quantity</label><input type="number" step="any" value={e.qty} onChange={(ev) => onPatch({ qty: Number(ev.target.value) })} /></div>
        {!cat && <div><label>Weight (lb, each)</label><input type="number" step="any" value={e.weight ?? ''} onChange={(ev) => onPatch({ weight: ev.target.value === '' ? '' : Number(ev.target.value) })} /></div>}
        <div><label>Notes</label><input value={e.notes || ''} onChange={(ev) => onPatch({ notes: ev.target.value })} /></div>
        {extra}
        {cat && <div><label>Shown under</label>
          <select value={groupOf(srd, e) === def ? '' : e.category} onChange={(ev) => onPatch({ category: ev.target.value || undefined })}>
            <option value="">Default{defSection ? ` (${defSection})` : ''}</option>
            {ITEM_GROUPS.filter(([k, l]) => l && k !== (def === 'Shield' ? 'Armor' : def)).map(([k, l]) => <option key={k} value={k}>{KIND_ICON[k] || '📦'} {l}</option>)}
          </select>
        </div>}
      </div>
      {!cat && <CustomItemFields e={e} srd={srd} onPatch={onPatch} />}
      {!cat && <div><label>Description / stats</label><textarea rows={3} value={e.desc || ''} onChange={(ev) => onPatch({ desc: ev.target.value })} /></div>}
    </>
  );
}

/** A blank custom item to start the "+ Custom item" draft from. */
export const blankItem = () => ({ name: '', qty: 1, notes: '', equipped: false, category: 'Custom' });
