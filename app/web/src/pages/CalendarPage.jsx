import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { api } from '../api.js';
import { Modal, ErrorBox, useAction, useApp, useLoad, NeedParty, fmtDate } from '../components/ui.jsx';

const HL_KEY = 'dnd.calendar.highlight';
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function EventModal({ cid, initial, members, me, isDm, onClose, onSaved }) {
  const isNew = !initial.id;
  const canEdit = isNew || initial.user_id === me.id || isDm;
  const [f, setF] = useState(() => ({
    title: initial.redacted ? '' : initial.title || '', kind: initial.kind || 'session', description: initial.description || '', location: initial.location || '',
    start: toLocalInput(new Date(initial.start)), end: toLocalInput(new Date(initial.end || initial.start)), all_day: !!initial.all_day,
  }));
  const [run, busy, error] = useAction();
  const author = members.find((m) => m.id === initial.user_id);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () => run(async () => {
    const body = { ...f, start: new Date(f.start).toISOString(), end: new Date(f.end).toISOString(), redacted: f.kind === 'busy' };
    if (isNew) await api.post(`/campaigns/${cid}/events`, body); else await api.patch(`/campaigns/${cid}/events/${initial.id}`, body);
    onSaved();
  });
  if (!canEdit) {
    return (
      <Modal title={initial.title} onClose={onClose}>
        <p><span className="dot" style={{ background: author?.color }} /> {author?.display_name} · <span className="badge">{initial.kind}</span>{initial.redacted ? <span className="badge"> details hidden</span> : null}</p>
        <p>{fmtDate(initial.start)} → {fmtDate(initial.end)}</p>
        {initial.location && <p>📍 {initial.location}</p>}
        {initial.description && <p className="pre">{initial.description}</p>}
      </Modal>
    );
  }
  return (
    <Modal title={isNew ? 'New calendar entry' : 'Edit entry'} onClose={onClose}>
      <div className="stack">
        <div className="row">
          {[['session', '🎲 Game session'], ['event', '📌 Event'], ['busy', '⛔ Busy (no details)']].map(([k, l]) => (
            <label key={k} className="inline"><input type="radio" checked={f.kind === k} onChange={() => setF({ ...f, kind: k })} /> {l}</label>
          ))}
        </div>
        {f.kind !== 'busy' && <div><label>Title</label><input autoFocus value={f.title} onChange={set('title')} /></div>}
        <div className="grid two">
          <div><label>Start</label><input type="datetime-local" value={f.start} onChange={set('start')} /></div>
          <div><label>End</label><input type="datetime-local" value={f.end} onChange={set('end')} /></div>
        </div>
        <label className="inline"><input type="checkbox" checked={f.all_day} onChange={set('all_day')} /> All day</label>
        {f.kind !== 'busy' && <>
          <div><label>Location</label><input value={f.location} onChange={set('location')} /></div>
          <div><label>Notes</label><textarea value={f.description} onChange={set('description')} /></div>
        </>}
        <ErrorBox error={error} />
        <div className="row between">
          {!isNew ? <button className="danger" onClick={() => run(async () => { await api.del(`/campaigns/${cid}/events/${initial.id}`); onSaved(); })}>Delete</button> : <span />}
          <button className="primary" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function ImportModal({ cid, onClose, onSaved }) {
  const { data: status, reload } = useLoad(() => api.get(`/campaigns/${cid}/ics`), [cid]);
  const [url, setUrl] = useState('');
  const [days, setDays] = useState(60);
  const [events, setEvents] = useState(null);
  const [choice, setChoice] = useState({}); // uid -> 'skip' | 'redact' | 'full'
  const [run, busy, error] = useAction();
  const [msg, setMsg] = useState('');
  const shared = new Set(status?.shared_uids || []);

  const load = () => run(async () => {
    const list = await api.post(`/campaigns/${cid}/ics/preview`, { to: new Date(Date.now() + days * 864e5).toISOString() });
    setEvents(list);
    setChoice(Object.fromEntries(list.map((e) => [e.uid, 'skip'])));
  });
  const share = () => run(async () => {
    // Redacted entries are stripped HERE, in the browser, before anything is sent.
    const picked = events.filter((e) => choice[e.uid] !== 'skip' && !shared.has(e.uid)).map((e) => (choice[e.uid] === 'redact'
      ? { uid: e.uid, start: e.start, end: e.end, all_day: e.all_day, redacted: true }
      : { uid: e.uid, title: e.title, description: e.description, location: e.location, start: e.start, end: e.end, all_day: e.all_day, redacted: false }));
    const r = await api.post(`/campaigns/${cid}/ics/share`, { events: picked });
    setMsg(`Shared ${r.added} entries.`);
    await reload();
    onSaved();
  });
  const setAll = (v) => setChoice(Object.fromEntries(Object.keys(choice).map((k) => [k, v])));

  return (
    <Modal title="Link Google Calendar" onClose={onClose} wide>
      <div className="stack">
        {!status?.linked ? (
          <>
            <p>Paste your calendar's <b>secret iCal address</b>. Only you see the full events — you choose which ones to share with the party, and whether to share details or just “busy”.</p>
            <ol className="muted small">
              <li>Open <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">Google Calendar → Settings</a> on a computer.</li>
              <li>Under <i>Settings for my calendars</i> pick your calendar → <i>Integrate calendar</i>.</li>
              <li>Copy <b>Secret address in iCal format</b> (ends in <code>basic.ics</code>) and paste it here. Works with Outlook/Apple/any .ics link too.</li>
            </ol>
            <div className="row"><input className="grow" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="primary" disabled={!url.trim() || busy} onClick={() => run(async () => { await api.put(`/campaigns/${cid}/ics`, { url }); await reload(); })}>Link</button></div>
          </>
        ) : (
          <>
            <div className="row between">
              <span><span className="badge green">calendar linked</span> <span className="muted small">The link is stored on your account only.</span></span>
              <div className="row">
                <button className="small" disabled={busy} onClick={() => run(async () => { const r = await api.post(`/campaigns/${cid}/ics/resync`); setMsg(`Resynced: ${r.updated} updated, ${r.removed} removed.`); onSaved(); })}>Resync shared</button>
                <button className="small danger" onClick={() => run(async () => { await api.put(`/campaigns/${cid}/ics`, { url: '' }); setEvents(null); await reload(); })}>Unlink</button>
              </div>
            </div>
            <div className="row">
              <span>Show the next</span>
              <select style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[14, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}</select>
              <button className="primary" disabled={busy} onClick={load}>{busy ? 'Loading…' : 'Load my events'}</button>
            </div>
          </>
        )}
        <ErrorBox error={error} />
        {msg && <div className="notice">{msg}</div>}
        {events && (
          <>
            <div className="row">
              <span className="muted small">Set all:</span>
              <button className="small" onClick={() => setAll('skip')}>Don't share</button>
              <button className="small" onClick={() => setAll('redact')}>Busy only</button>
              <button className="small" onClick={() => setAll('full')}>With details</button>
            </div>
            <div style={{ maxHeight: '45vh', overflowY: 'auto' }}>
              <table>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.uid} style={{ opacity: shared.has(e.uid) ? 0.5 : 1 }}>
                      <td className="nowrap small">{e.all_day ? new Date(e.start).toLocaleDateString() : fmtDate(e.start)}</td>
                      <td>{e.title || <i className="muted">(no title)</i>}{e.location && <div className="muted small">📍 {e.location}</div>}</td>
                      <td className="nowrap">
                        {shared.has(e.uid) ? <span className="badge green">shared</span> : (
                          <select value={choice[e.uid]} onChange={(ev) => setChoice({ ...choice, [e.uid]: ev.target.value })} style={{ width: 'auto' }}>
                            <option value="skip">Don't share</option>
                            <option value="redact">Busy only (hide details)</option>
                            <option value="full">Share with details</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!events.length && <div className="empty">No events in that range.</div>}
            </div>
            <div className="row end"><button className="primary" disabled={busy || !Object.entries(choice).some(([k, v]) => v !== 'skip' && !shared.has(k))} onClick={share}>Share selected</button></div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function CalendarPage() {
  const { campaign, me } = useApp();
  const cid = campaign?.id;
  const { data: party } = useLoad(() => (cid ? api.get(`/campaigns/${cid}`) : Promise.resolve(null)), [cid]);
  const calRef = useRef(null);
  const [highlight, setHighlight] = useState(() => { try { return JSON.parse(localStorage.getItem(HL_KEY)) || null; } catch { return null; } });
  const [hideOthers, setHideOthers] = useState(false);
  const [modal, setModal] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const members = party?.members || [];
  const isDm = party && party.my_role === 'dm';
  const hl = useMemo(() => new Set(highlight || members.map((m) => m.id)), [highlight, members]);

  useEffect(() => { try { localStorage.setItem(HL_KEY, JSON.stringify(highlight)); } catch { /* ignore */ } }, [highlight]);
  useEffect(() => { calRef.current?.getApi().refetchEvents(); }, [hl, hideOthers]);

  if (!cid) return <NeedParty />;
  const toggle = (id) => setHighlight([...(hl.has(id) ? [...hl].filter((x) => x !== id) : [...hl, id])]);
  const refetch = () => { setModal(null); calRef.current?.getApi().refetchEvents(); };

  const fetchEvents = async (info, success, failure) => {
    try {
      const list = await api.get(`/campaigns/${cid}/events?from=${info.start.toISOString()}&to=${info.end.toISOString()}`);
      setError(null);
      success(list.filter((e) => !hideOthers || hl.has(e.user_id) || e.kind === 'session').map((e) => ({
        id: String(e.id), title: e.kind === 'busy' ? `${e.author}: busy` : e.kind === 'session' ? `🎲 ${e.title}` : `${e.author}: ${e.title}`,
        start: e.start, end: e.end, allDay: !!e.all_day,
        backgroundColor: e.kind === 'session' ? '#d4ae3f' : e.color, textColor: e.kind === 'session' ? '#1a140c' : '#fff',
        classNames: [hl.has(e.user_id) || e.kind === 'session' ? '' : 'dimmed', e.redacted ? 'redacted' : ''].filter(Boolean),
        extendedProps: e,
      })));
    } catch (err) { setError(err); failure(err); }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="row">
          <button onClick={() => setImporting(true)}>🔗 Google Calendar</button>
          <button className="primary" onClick={() => setModal({ start: new Date(new Date().setHours(18, 0, 0, 0)), end: new Date(new Date().setHours(22, 0, 0, 0)), kind: 'session' })}>+ Add entry</button>
        </div>
      </div>
      <div className="card tight row">
        <span className="muted small">Highlight:</span>
        {members.map((m) => (
          <span key={m.id} className={`person-chip ${hl.has(m.id) ? 'on' : 'off'}`} style={{ color: m.color }} onClick={() => toggle(m.id)}>
            <span className="dot" style={{ background: m.color }} /><span style={{ color: 'var(--text)' }}>{m.display_name}</span>
          </span>
        ))}
        <button className="small ghost" onClick={() => setHighlight(null)}>All</button>
        <button className="small ghost" onClick={() => setHighlight([me.id])}>Only me</button>
        <label className="inline small"><input type="checkbox" checked={hideOthers} onChange={(e) => setHideOthers(e.target.checked)} /> Hide others instead of dimming</label>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={window.innerWidth < 760 ? 'listMonth' : 'dayGridMonth'}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listMonth' }}
          firstDay={1}
          height="auto"
          selectable
          nowIndicator
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          events={fetchEvents}
          select={(s) => setModal({ start: s.allDay ? new Date(s.start.setHours(18)) : s.start, end: s.allDay ? new Date(new Date(s.start).setHours(22)) : s.end, kind: 'session' })}
          eventClick={(e) => setModal(e.event.extendedProps)}
        />
      </div>
      <p className="muted small">Gold = game sessions. Striped = shared as “busy” (details stay private).</p>
      {modal && <EventModal cid={cid} initial={modal} members={members} me={me} isDm={isDm} onClose={() => setModal(null)} onSaved={refetch} />}
      {importing && <ImportModal cid={cid} onClose={() => setImporting(false)} onSaved={() => calRef.current?.getApi().refetchEvents()} />}
    </div>
  );
}
