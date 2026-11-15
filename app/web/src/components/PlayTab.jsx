import { useState } from 'react';
import { CONDITIONS, EXHAUSTION, TIME } from '../../../shared/rules.js';

const fmtLeft = (s) => (s == null ? '∞' : s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}` : `${Math.ceil(s / 6)} rnd`);

function Pips({ max, used, onUse, onRestore, readOnly }) {
  if (max > 12) {
    return (
      <div className="row">
        <strong>{Math.max(0, max - used)}</strong><span className="muted">/ {max}</span>
        {!readOnly && <><button className="small" onClick={onUse}>−1</button><button className="small" onClick={onRestore}>+1</button></>}
      </div>
    );
  }
  return (
    <div className="pips">
      {Array.from({ length: Math.max(max, used) }, (_, i) => {
        const isUsed = i >= max - used;
        return <button key={i} className={`pip ${isUsed ? 'used' : ''}`} disabled={readOnly} title={isUsed ? 'Restore' : 'Use'} onClick={isUsed ? onRestore : onUse} />;
      })}
    </div>
  );
}

/** In-play resource management: every button is one recorded action. */
export default function PlayTab({ data, act, readOnly, derived }) {
  const [amount, setAmount] = useState('');
  const [effect, setEffect] = useState({ name: '', amount: 1, unit: 'minute', concentration: false });
  const [cond, setCond] = useState('');
  const hp = data.hp;
  const n = Number(amount);
  const hpPct = (x) => `${Math.max(0, Math.min(100, (x / Math.max(1, hp.max + hp.temp)) * 100))}%`;
  const slots = data.spellcasting.slots.map((s, i) => ({ ...s, level: i + 1 })).filter((s) => s.max || s.used);
  const go = (a) => !readOnly && act(a);

  return (
    <div className="grid two">
      <div className="stack">
        <div className="card stack">
          <div className="row between">
            <h3 style={{ margin: 0 }}>Hit points</h3>
            <span style={{ fontSize: 26, fontWeight: 700 }}>{hp.current}<span className="muted" style={{ fontSize: 16 }}> / {hp.max}</span>{hp.temp > 0 && <span style={{ color: 'var(--blue)', fontSize: 16 }}> +{hp.temp}</span>}</span>
          </div>
          <div className="hp-bar"><div className="fill" style={{ width: hpPct(hp.current) }} /><div className="temp" style={{ width: hpPct(hp.temp) }} /></div>
          {!readOnly && (
            <div className="row">
              <input type="number" min="0" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90 }} />
              <button className="danger" disabled={!n} onClick={() => { go({ type: 'damage', amount: n }); setAmount(''); }}>Damage</button>
              <button disabled={!n} onClick={() => { go({ type: 'heal', amount: n }); setAmount(''); }}>Heal</button>
              <button disabled={!n} onClick={() => { go({ type: 'temp_hp', amount: n }); setAmount(''); }}>Temp HP</button>
            </div>
          )}
          {hp.current === 0 && (
            <div className="card tight stack" style={{ borderColor: 'var(--red)' }}>
              <strong>Death saves — {data.death_saves.success}✓ / {data.death_saves.fail}✗</strong>
              {!readOnly && <div className="row">
                <button className="small" onClick={() => go({ type: 'death_save', result: 'success' })}>Success</button>
                <button className="small" onClick={() => go({ type: 'death_save', result: 'fail' })}>Fail</button>
                <button className="small" onClick={() => go({ type: 'death_save', result: 'nat20' })}>Nat 20</button>
                <button className="small" onClick={() => go({ type: 'death_save', result: 'nat1' })}>Nat 1</button>
                <button className="small ghost" onClick={() => go({ type: 'death_save', result: 'reset' })}>Reset</button>
              </div>}
            </div>
          )}
          <div className="row">
            <span className="muted small">Hit dice:</span>
            {Object.entries(data.hit_dice).map(([die, hd]) => (
              <span key={die} className="row" style={{ gap: 4 }}>
                <span className="badge gold">{hd.total - (hd.used || 0)}/{hd.total} {die}</span>
                {!readOnly && <button className="small" disabled={hd.total - (hd.used || 0) <= 0} onClick={() => {
                  const roll = prompt(`Rolled ${die} result (leave empty to roll for you):`);
                  if (roll === null) return;
                  go({ type: 'spend_hit_die', die, ...(roll.trim() ? { roll: Number(roll) } : {}) });
                }}>Spend</button>}
              </span>
            ))}
          </div>
          <label className="inline"><input type="checkbox" disabled={readOnly} checked={!!data.inspiration} onChange={(e) => go({ type: 'set_inspiration', value: e.target.checked })} /> Heroic inspiration</label>
        </div>

        {!readOnly && (
          <div className="card row">
            <button className="primary" onClick={() => confirm('Take a short rest? Short-rest resources and pact slots recharge (1 hour passes).') && go({ type: 'short_rest' })}>☕ Short rest</button>
            <button className="primary" onClick={() => confirm('Take a long rest? HP, spell slots and resources are restored, half your hit dice come back, exhaustion −1 (8 hours pass).') && go({ type: 'long_rest' })}>🌙 Long rest</button>
          </div>
        )}

        {(slots.length > 0 || data.spellcasting.pact) && (
          <div className="card stack">
            <div className="row between"><h3 style={{ margin: 0 }}>Spell slots</h3>{derived.spell_dc && <span className="muted small">Save DC {derived.spell_dc} · attack +{derived.spell_attack}</span>}</div>
            {slots.map((s) => (
              <div key={s.level} className="row"><span style={{ width: 60 }}>Level {s.level}</span>
                <Pips max={s.max} used={s.used} readOnly={readOnly} onUse={() => go({ type: 'use_slot', level: s.level })} onRestore={() => go({ type: 'restore_slot', level: s.level })} /></div>
            ))}
            {data.spellcasting.pact && (
              <div className="row"><span style={{ width: 60 }}>Pact L{data.spellcasting.pact.level}</span>
                <Pips max={data.spellcasting.pact.max} used={data.spellcasting.pact.used} readOnly={readOnly} onUse={() => go({ type: 'use_pact' })} onRestore={() => go({ type: 'restore_pact' })} /></div>
            )}
          </div>
        )}

        <div className="card stack">
          <h3 style={{ margin: 0 }}>Class & other resources</h3>
          {data.resources.map((r) => (
            <div key={r.key || r.name} className="row between">
              <span>{r.name} <span className="muted small">({r.recharge === 'short' ? 'short rest' : r.recharge === 'long' ? 'long rest' : 'manual'})</span></span>
              <Pips max={r.max} used={r.used || 0} readOnly={readOnly} onUse={() => go({ type: 'use_resource', key: r.key, name: r.name })} onRestore={() => go({ type: 'restore_resource', key: r.key, name: r.name })} />
            </div>
          ))}
          {!data.resources.length && <div className="muted small">None. Add custom ones (potions, charges, Luck points…) on the Sheet tab.</div>}
        </div>
      </div>

      <div className="stack">
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Conditions</h3>
          <div className="row">
            {data.conditions.map((c) => (
              <span key={c.name} className="badge red" style={{ fontSize: 13 }}>{c.name}{c.note && ` (${c.note})`} {!readOnly && <a href="#" onClick={(e) => { e.preventDefault(); go({ type: 'remove_condition', name: c.name }); }}>✕</a>}</span>
            ))}
            {!data.conditions.length && <span className="muted small">None</span>}
          </div>
          {!readOnly && (
            <div className="row">
              <input list="conditions" placeholder="Add condition…" value={cond} onChange={(e) => setCond(e.target.value)} className="grow" />
              <datalist id="conditions">{CONDITIONS.map((c) => <option key={c} value={c} />)}</datalist>
              <button disabled={!cond.trim()} onClick={() => { go({ type: 'add_condition', name: cond.trim() }); setCond(''); }}>Add</button>
            </div>
          )}
          <div className="row">
            <span className="muted small">Exhaustion</span>
            <select disabled={readOnly} value={data.exhaustion} style={{ width: 'auto' }} onChange={(e) => go({ type: 'set_exhaustion', level: Number(e.target.value) })}>
              {EXHAUSTION.map((t, i) => <option key={i} value={i}>{i} — {t}</option>)}
            </select>
          </div>
        </div>

        <div className="card stack">
          <h3 style={{ margin: 0 }}>Active spells & effects</h3>
          {data.effects.map((e) => (
            <div key={e.id} className="row between">
              <span>{e.concentration && <span className="badge gold" title="Concentration">C</span>} <strong>{e.name}</strong> {e.note && <span className="muted small">{e.note}</span>}</span>
              <span className="row"><span className="badge">{fmtLeft(e.remaining)}</span>{!readOnly && <button className="small ghost" onClick={() => go({ type: 'remove_effect', id: e.id, name: e.name })}>End</button>}</span>
            </div>
          ))}
          {!data.effects.length && <span className="muted small">Nothing active.</span>}
          {!readOnly && (
            <>
              <div className="row">
                <input list="spellnames" placeholder="Spell / effect" className="grow" value={effect.name} onChange={(e) => setEffect({ ...effect, name: e.target.value })} />
                <datalist id="spellnames">{data.spells.map((s) => <option key={s.name} value={s.name} />)}</datalist>
                <input type="number" min="0" value={effect.amount} style={{ width: 64 }} onChange={(e) => setEffect({ ...effect, amount: e.target.value })} />
                <select value={effect.unit} style={{ width: 'auto' }} onChange={(e) => setEffect({ ...effect, unit: e.target.value })}>
                  <option value="round">rounds</option><option value="minute">minutes</option><option value="hour">hours</option><option value="none">until ended</option>
                </select>
              </div>
              <div className="row between">
                <label className="inline small"><input type="checkbox" checked={effect.concentration} onChange={(e) => setEffect({ ...effect, concentration: e.target.checked })} /> Concentration</label>
                <button disabled={!effect.name.trim()} onClick={() => {
                  const sp = data.spells.find((s) => s.name === effect.name);
                  go({ type: 'add_effect', name: effect.name.trim(), concentration: effect.concentration || !!sp?.concentration, ...(effect.unit === 'none' ? {} : { seconds: Number(effect.amount) * TIME[effect.unit] }) });
                  setEffect({ name: '', amount: 1, unit: 'minute', concentration: false });
                }}>Start</button>
              </div>
              <div className="row">
                <span className="muted small">Time passes:</span>
                {[['1 round', 6], ['1 min', 60], ['10 min', 600], ['1 hour', 3600]].map(([l, s]) => <button key={l} className="small" onClick={() => go({ type: 'advance_time', seconds: s })}>+{l}</button>)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
