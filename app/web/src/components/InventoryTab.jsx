import { useState } from 'react';
import { findItem, itemOf, itemEntry, expandItems, weaponAttack, weaponProficient, armorClass, totalWeight } from '../../../shared/items.js';
import { ItemModal, CatalogPicker, KIND_ICON } from './ItemInfo.jsx';
import { ItemGroups, ItemFields, itemSummary, groupOf, blankItem } from './ItemEditor.jsx';

/** Inventory where every entry is an item: details on tap, quantity, worn/equipped, weight. */
export default function InventoryTab({ data, edit, ro, srd }) {
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(null); // a new custom item: only added to the inventory on "Add item"

  const setEq = (equipment) => edit((d) => ({ ...d, equipment }));
  const patch = (i, p) => setEq(data.equipment.map((e, j) => (j === i ? { ...e, ...p } : e)));
  const hasAttack = (it) => data.attacks.some((a) => (it.index ? a.index === it.index : !a.index && a.name === it.name));
  const weight = srd ? totalWeight(data, srd) : 0;
  const cap = (Number(data.abilities.str) || 10) * 15;
  const ac = srd ? armorClass(data, srd) : null;

  const addItem = (it) => {
    const entry = itemEntry(srd, it.index, 1, '');
    edit((d) => {
      const next = { ...d, equipment: [...d.equipment, entry] };
      if (it.kind === 'Weapon' && !d.attacks.some((a) => a.index === it.index)) next.attacks = [...d.attacks, weaponAttack(it, d, weaponProficient(it, d))];
      return next;
    });
    setAdding(false);
  };

  /** Commit the custom-item draft; a weapon with damage also gets its attack line, like catalog weapons. */
  const addDraft = () => {
    const entry = { ...draft, name: draft.name.trim() };
    const it = itemOf(srd, entry);
    edit((d) => {
      const next = { ...d, equipment: [...d.equipment, entry] };
      if (it.kind === 'Weapon' && it.damage && !d.attacks.some((a) => !a.index && a.name === it.name)) next.attacks = [...d.attacks, weaponAttack(it, d, weaponProficient(it, d))];
      return next;
    });
    setDraft(null);
  };

  return (
    <div className="grid two inv-layout">
      <div className="card stack">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Equipment</h3>
          <span className={`small ${weight > cap ? 'badge red' : 'muted'}`}>{+weight.toFixed(1)} / {cap} lb carried</span>
        </div>
        {ac && <div className="row small"><span className="muted">AC from gear: <b>{ac.ac}</b> ({ac.source})</span>
          {!ro && ac.ac !== data.ac && <button className="small" onClick={() => edit((d) => ({ ...d, ac: ac.ac }))}>Set AC {data.ac} → {ac.ac}</button>}</div>}
        <ItemGroups srd={srd} entries={data.equipment} renderRow={(e, i) => {
          const kind = groupOf(srd, e);
          const canEquip = ['Weapon', 'Armor', 'Shield', 'Focus'].includes(kind) || e.equipped;
          return (
            <div key={i} className={`inv-row ${e.equipped ? 'equipped' : ''}`}>
              {canEquip ? <button className={`equip-toggle ${e.equipped ? 'on' : ''}`} disabled={ro} title={e.equipped ? 'Equipped — tap to unequip' : 'Tap to equip'} onClick={() => patch(i, { equipped: !e.equipped })}>{e.equipped ? '✓' : ''}</button> : <span className="equip-toggle blank" />}
              <button className="ghost inv-name" onClick={() => setOpen(i)}>
                <span className="grow left">{e.name}{e.notes && <span className="muted small"> · {e.notes}</span>}</span>
                <span className="muted small nowrap">{itemSummary(srd, e)}</span>
              </button>
              <div className="qty">
                {!ro && <button className="small ghost" onClick={() => (e.qty <= 1 ? confirm(`Remove ${e.name}?`) && setEq(data.equipment.filter((_, j) => j !== i)) : patch(i, { qty: e.qty - 1 }))}>−</button>}
                <span>{e.qty}</span>
                {!ro && <button className="small ghost" onClick={() => patch(i, { qty: (Number(e.qty) || 0) + 1 })}>+</button>}
              </div>
            </div>
          );
        }} />
        {!ro && (
          <div className="row">
            {srd && <button className="primary" onClick={() => setAdding(true)}>+ Add from catalog</button>}
            <button onClick={() => { setOpen(null); setDraft(blankItem()); }}>+ Custom item</button>
          </div>
        )}
      </div>

      <div className="stack">
        <div className="card"><h3>Coins</h3>
          <div className="coins">{['cp', 'sp', 'ep', 'gp', 'pp'].map((c) => (
            <div key={c}><label>{c.toUpperCase()}</label><input type="number" inputMode="numeric" disabled={ro} value={data.coins[c]} onChange={(ev) => edit((d) => ({ ...d, coins: { ...d.coins, [c]: Number(ev.target.value) } }))} /></div>
          ))}</div>
        </div>
        <div className="card stack"><h3>Magic item attunement</h3>
          {data.attunement.map((a, i) => <input key={i} disabled={ro} value={a} placeholder={`Slot ${i + 1}`} onChange={(ev) => edit((d) => ({ ...d, attunement: d.attunement.map((t, j) => (j === i ? ev.target.value : t)) }))} />)}
        </div>
        <div className="card small muted">Carrying capacity is STR × 15 lb (PHB p.176). Tap an item for its full details; the ✓ marks what you wear or wield, which drives the suggested AC.</div>
      </div>

      {adding && <CatalogPicker srd={srd} onPick={addItem} onClose={() => setAdding(false)} />}
      {(draft || (open != null && data.equipment[open])) && (
        <ItemModal srd={srd} entry={draft || data.equipment[open]} title={draft ? `${KIND_ICON[itemOf(srd, draft).kind] || '📦'} New custom item` : null} onClose={() => { setOpen(null); setDraft(null); }}>
          {(!ro || draft) && (() => {
            const e = draft || data.equipment[open];
            const up = draft ? (p) => setDraft((d) => ({ ...d, ...p })) : (p) => patch(open, p);
            const cat = findItem(srd, e.index);
            const it = itemOf(srd, e);
            return (
              <div className="stack" style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <ItemFields e={e} srd={srd} onPatch={up} autoFocus={!!draft} />
                <div className="row">
                  <label className="inline"><input type="checkbox" checked={!!e.equipped} onChange={(ev) => up({ equipped: ev.target.checked })} /> Equipped / worn</label>
                  {cat?.contents && <button onClick={() => { setEq([...data.equipment.slice(0, open), ...expandItems(srd, [e]), ...data.equipment.slice(open + 1)]); setOpen(null); }}>Unpack into items</button>}
                  {!draft && it?.kind === 'Weapon' && it.damage && !hasAttack(it) && <button onClick={() => edit((d) => ({ ...d, attacks: [...d.attacks, weaponAttack(it, d, weaponProficient(it, d))] }))}>Add attack line</button>}
                  <span className="grow" />
                  {draft ? (
                    <>
                      <button onClick={() => setDraft(null)}>Cancel</button>
                      <button className="primary" disabled={!e.name.trim()} onClick={addDraft}>Add item</button>
                    </>
                  ) : <button className="danger small" onClick={() => { setEq(data.equipment.filter((_, j) => j !== open)); setOpen(null); }}>Remove</button>}
                </div>
              </div>
            );
          })()}
        </ItemModal>
      )}
    </div>
  );
}
