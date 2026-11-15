import { useState } from 'react';
import { api, loadRules } from '../api.js';
import { Modal, ErrorBox, useAction, useApp, useLoad, NeedParty, fmtDate } from '../components/ui.jsx';
import { ItemModal as ItemInfoModal, CatalogPicker, KIND_ICON } from '../components/ItemInfo.jsx';
import { ItemGroups, ItemFields, itemSummary, blankItem } from '../components/ItemEditor.jsx';
import { itemOf, cleanItemFields } from '../../../shared/items.js';

// Treasury rows ↔ the shared item model used by character inventories.
const toEntry = (r) => ({ ...r.item, id: r.id, name: r.name, qty: r.quantity, notes: r.notes, desc: r.stats, holder: r.holder, value: r.value });
const toBody = (e) => ({ name: e.name.trim(), quantity: Number(e.qty) || 0, notes: e.notes || '', stats: e.desc || '', holder: e.holder || '', value: e.value || '', item: cleanItemFields(e) });

function CurrencyModal({ cid, cur, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', abbr: '', notes: '', gp_value: '', ...cur, gp_value: cur?.gp_value ?? '' });
  const [run, busy, error] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={cur?.id ? `Edit ${cur.name}` : 'New currency'} onClose={onClose}>
      <div className="stack">
        <div className="grid two">
          <div><label>Name</label><input autoFocus value={f.name} onChange={set('name')} placeholder="e.g. Dragon scales" /></div>
          <div><label>Short name</label><input value={f.abbr} onChange={set('abbr')} placeholder="e.g. ds" /></div>
        </div>
        <div><label>Worth in gold (optional, for the total)</label><input type="number" step="any" value={f.gp_value} onChange={set('gp_value')} /></div>
        <div><label>Notes — where it's accepted, exchange rates, lore…</label><textarea value={f.notes} onChange={set('notes')} /></div>
        <ErrorBox error={error} />
        <div className="row between">
          {cur?.id ? <button className="danger" onClick={() => confirm(`Remove ${cur.name}?`) && run(async () => { await api.del(`/campaigns/${cid}/currencies/${cur.id}`); onSaved(); })}>Remove</button> : <span />}
          <button className="primary" disabled={busy || !f.name.trim()} onClick={() => run(async () => {
            if (cur?.id) await api.patch(`/campaigns/${cid}/currencies/${cur.id}`, f); else await api.post(`/campaigns/${cid}/currencies`, f);
            onSaved();
          })}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

/** Add (draft until "Add item") or edit a treasury item with the same editor as character inventories. */
function TreasuryItemModal({ cid, srd, entry, holders, onClose, onSaved }) {
  const isNew = entry.id == null;
  const [e, setE] = useState(entry);
  const [run, busy, error] = useAction();
  const up = (p) => setE((x) => ({ ...x, ...p }));
  const extra = (
    <>
      <div><label>Held by</label><input list="treasury-holders" value={e.holder || ''} onChange={(ev) => up({ holder: ev.target.value })} placeholder="Party stash" />
        <datalist id="treasury-holders">{holders.map((h) => <option key={h} value={h} />)}</datalist></div>
      <div><label>Value</label><input value={e.value || ''} onChange={(ev) => up({ value: ev.target.value })} placeholder="50 gp" /></div>
    </>
  );
  return (
    <ItemInfoModal srd={srd} entry={isNew ? e : entry} title={isNew ? `${KIND_ICON[itemOf(srd, e).kind] || '📦'} New treasury item` : null} onClose={onClose}>
      <div className="stack" style={{ marginTop: isNew ? 0 : 12, borderTop: isNew ? 0 : '1px solid var(--line)', paddingTop: isNew ? 0 : 12 }}>
        <ItemFields e={e} srd={srd} onPatch={up} autoFocus={isNew} extra={extra} />
        <ErrorBox error={error} />
        <div className="row">
          {!isNew && <button className="danger small" disabled={busy} onClick={() => confirm(`Remove ${entry.name} from the treasury?`) && run(async () => { await api.del(`/campaigns/${cid}/items/${entry.id}`); onSaved(); })}>Remove</button>}
          <span className="grow" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !e.name.trim()} onClick={() => run(async () => {
            if (isNew) await api.post(`/campaigns/${cid}/items`, toBody(e)); else await api.patch(`/campaigns/${cid}/items/${entry.id}`, toBody(e));
            onSaved();
          })}>{isNew ? 'Add item' : 'Save'}</button>
        </div>
      </div>
    </ItemInfoModal>
  );
}

function Adjust({ cid, cur, onDone }) {
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [run, busy, error] = useAction();
  const go = (sign) => run(async () => {
    await api.post(`/campaigns/${cid}/currencies/${cur.id}/adjust`, { delta: sign * Number(amt), note });
    setAmt(''); setNote(''); onDone();
  });
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="number" step="any" placeholder="amount" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ width: 90 }} />
        <button className="small" disabled={busy || !Number(amt)} onClick={() => go(1)}>+ Add</button>
        <button className="small" disabled={busy || !Number(amt)} onClick={() => go(-1)}>− Spend</button>
      </div>
      {amt && <input placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
      <ErrorBox error={error} />
    </div>
  );
}

export default function TreasuryPage() {
  const { campaign } = useApp();
  const cid = campaign?.id;
  const { data: t, error, reload } = useLoad(() => (cid ? api.get(`/campaigns/${cid}/treasury`) : Promise.resolve(null)), [cid]);
  const [curModal, setCurModal] = useState(null);
  const { data: srd } = useLoad(loadRules, []);
  const { data: chars } = useLoad(() => (cid ? api.get(`/characters?campaign=${cid}`) : Promise.resolve([])), [cid]);
  const [itemModal, setItemModal] = useState(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [run, , actErr] = useAction();
  if (!cid) return <NeedParty />;
  const holders = ['Party stash', ...new Set((chars || []).map((c) => c.name))];
  const items = (t?.items || []).filter((i) => !q || `${i.name} ${i.holder} ${i.stats} ${i.notes}`.toLowerCase().includes(q.toLowerCase())).map(toEntry);
  const setQty = (e, qty) => run(async () => {
    if (qty <= 0) { if (!confirm(`Remove ${e.name} from the treasury?`)) return; await api.del(`/campaigns/${cid}/items/${e.id}`); }
    else await api.patch(`/campaigns/${cid}/items/${e.id}`, { quantity: qty });
    await reload();
  });
  const addFromCatalog = (it) => run(async () => {
    await api.post(`/campaigns/${cid}/items`, { name: it.name, quantity: 1, value: it.cost || '', item: { index: it.index } });
    setPicking(false); await reload();
  });
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Treasury</h1>
        {t && <span className="badge gold" style={{ fontSize: 14 }}>≈ {t.total_gp.toFixed(2)} gp total</span>}
      </div>
      <ErrorBox error={error} />
      {t && <>
        <div className="row between"><h2 style={{ margin: 0 }}>Currency</h2><button onClick={() => setCurModal({})}>+ Custom currency</button></div>
        <div className="grid cards">
          {t.currencies.map((c) => (
            <div key={c.id} className="card stack" style={{ gap: 6 }}>
              <div className="row between">
                <strong>{c.name} {c.abbr && <span className="muted">({c.abbr})</span>}</strong>
                <button className="small ghost" onClick={() => setCurModal(c)}>✎</button>
              </div>
              <div style={{ fontSize: 26, fontWeight: 600 }}>{+c.amount.toFixed(2)}</div>
              {c.notes && <div className="muted small pre">{c.notes}</div>}
              {c.gp_value != null && c.abbr !== 'gp' && <div className="muted small">1 {c.abbr || c.name} = {c.gp_value} gp</div>}
              <Adjust cid={cid} cur={c} onDone={reload} />
            </div>
          ))}
        </div>
        <div className="row between"><h2 style={{ margin: 0 }}>Items</h2>
          <div className="row">
            <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
            {srd && <button className="primary" onClick={() => setPicking(true)}>+ Add from catalog</button>}
            <button onClick={() => setItemModal(blankItem())}>+ Custom item</button>
          </div>
        </div>
        <ErrorBox error={actErr} />
        <div className="card stack">
          <ItemGroups srd={srd} entries={items} empty={q ? 'Nothing matches.' : 'No items yet.'} renderRow={(e) => (
            <div key={e.id} className="inv-row">
              <button className="ghost inv-name" onClick={() => setItemModal(e)}>
                <span className="grow left">{e.name}{e.notes && <span className="muted small"> · {e.notes}</span>}</span>
                <span className="muted small nowrap">{[itemSummary(srd, e), e.value].filter(Boolean).join(' · ')}</span>
                <span className="badge" title="Held by">{e.holder || 'party'}</span>
              </button>
              <div className="qty">
                <button className="small ghost" onClick={() => setQty(e, e.qty - 1)}>−</button>
                <span>{+Number(e.qty).toFixed(2)}</span>
                <button className="small ghost" onClick={() => setQty(e, e.qty + 1)}>+</button>
              </div>
            </div>
          )} />
        </div>
        <details className="card">
          <summary><strong>History</strong> <span className="muted small">({t.log.length})</span></summary>
          <table style={{ marginTop: 8 }}><tbody>
            {t.log.map((l) => <tr key={l.id}><td className="nowrap muted small">{fmtDate(l.at + 'Z')}</td><td className="small">{l.author}</td><td>{l.message}</td></tr>)}
          </tbody></table>
        </details>
      </>}
      {curModal && <CurrencyModal cid={cid} cur={curModal} onClose={() => setCurModal(null)} onSaved={() => { setCurModal(null); reload(); }} />}
      {itemModal && <TreasuryItemModal cid={cid} srd={srd} entry={itemModal} holders={holders} onClose={() => setItemModal(null)} onSaved={() => { setItemModal(null); reload(); }} />}
      {picking && srd && <CatalogPicker srd={srd} onPick={addFromCatalog} onClose={() => setPicking(false)} />}
    </div>
  );
}
