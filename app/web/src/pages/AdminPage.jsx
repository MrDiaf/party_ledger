import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, useAction, useLoad, fmtDay } from '../components/ui.jsx';

function Users() {
  const { data: users, error, reload } = useLoad(() => api.get('/admin/users'), []);
  const [run, busy, err] = useAction();
  const [msg, setMsg] = useState('');
  const [nu, setNu] = useState({ username: '', password: '' });
  const act = (fn, done) => run(async () => { await fn(); setMsg(done || ''); await reload(); });
  return (
    <div className="stack">
      <ErrorBox error={error || err} />
      {msg && <div className="notice">{msg}</div>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>User</th><th>Characters</th><th>Joined</th><th /></tr></thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id}>
                <td><span className="dot" style={{ background: u.color }} /> <strong>{u.display_name}</strong> <span className="muted">@{u.username}</span></td>
                <td>{u.characters}</td>
                <td className="nowrap">{fmtDay(u.created_at + 'Z')}</td>
                <td className="right">
                  <div className="row end">
                    <button className="small" disabled={busy} onClick={() => {
                      const pw = prompt(`New password for ${u.username} (any length):`);
                      if (pw) act(() => api.post(`/admin/users/${u.id}/password`, { password: pw }), `Password for ${u.username} reset — they were logged out everywhere.`);
                    }}>Reset password</button>
                    <button className="small" disabled={busy} onClick={() => {
                      const name = prompt('Username:', u.username);
                      if (name && name !== u.username) act(() => api.patch(`/admin/users/${u.id}`, { username: name }), 'Renamed');
                    }}>Rename</button>
                    <button className="small" disabled={busy} onClick={() => act(() => api.post(`/admin/users/${u.id}/logout`), `${u.username} logged out everywhere`)}>Log out</button>
                    <button className="small danger" disabled={busy} onClick={() => confirm(`Delete ${u.username} and all their characters? This cannot be undone.`) && act(() => api.del(`/admin/users/${u.id}`), 'Deleted')}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card row">
        <strong>Add account</strong>
        <input className="grow" style={{ width: 160 }} placeholder="username" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
        <input className="grow" style={{ width: 160 }} placeholder="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
        <button className="primary" disabled={busy || !nu.username || !nu.password} onClick={() => act(async () => { await api.post('/admin/users', nu); setNu({ username: '', password: '' }); }, 'Account created')}>Create</button>
      </div>
    </div>
  );
}

function Settings() {
  const { data: s, error, reload } = useLoad(() => api.get('/admin/settings'), []);
  const [run, , err] = useAction();
  if (!s) return <ErrorBox error={error} />;
  return (
    <div className="card stack">
      <ErrorBox error={err} />
      <label className="inline"><input type="checkbox" checked={s.registration_open} onChange={(e) => run(async () => { await api.patch('/admin/settings', { registration_open: e.target.checked }); reload(); })} /> Anyone who can reach the app may create an account</label>
      <p className="muted small">Turn this off once all your friends have accounts — especially if the app is exposed with Tailscale Funnel.</p>
    </div>
  );
}

function Ai() {
  const { data: st, error, reload } = useLoad(() => api.get('/admin/ai/status'), []);
  const { data: s, reload: reloadSettings } = useLoad(() => api.get('/admin/settings'), []);
  const [run, busy, err] = useAction();
  const [model, setModel] = useState(null);
  const pending = st?.login?.state === 'pending';
  useEffect(() => {
    if (!pending) return undefined;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [pending, reload]);
  const patch = (body) => run(async () => { await api.patch('/admin/settings', body); await reloadSettings(); });
  const disabled = new Set(s?.ai_disabled_tools || []);
  return (
    <div className="stack">
      <ErrorBox error={error || err} />
      <div className="card stack">
        <h3>ChatGPT subscription link (Codex)</h3>
        {!st ? <div className="muted">Checking…</div> : !st.installed ? <div className="error">Codex CLI is not installed in the container.</div> : (
          <>
            <div className="row">
              {st.logged_in ? <span className="badge green">linked</span> : <span className="badge red">not linked</span>}
              <span className="muted small">{st.detail}</span>
            </div>
            {pending && (
              <div className="notice stack">
                <div>1. Open <a href={st.login.url || 'https://auth.openai.com/codex/device'} target="_blank" rel="noreferrer">{st.login.url || 'the device login page'}</a> and sign in with your ChatGPT account.</div>
                <div>2. Enter this code: <code style={{ fontSize: 20 }}>{st.login.code || '…'}</code></div>
                <div className="muted small">Waiting for confirmation…</div>
              </div>
            )}
            {st.login && ['error', 'expired'].includes(st.login.state) && <pre className="diff">{st.login.output}</pre>}
            <div className="row">
              {!st.logged_in && !pending && <button className="primary" disabled={busy} onClick={() => run(async () => { await api.post('/admin/ai/login'); setTimeout(reload, 1500); })}>Link ChatGPT account</button>}
              {pending && <button onClick={() => run(async () => { await api.post('/admin/ai/login/cancel'); reload(); })}>Cancel</button>}
              {st.logged_in && <button className="danger" disabled={busy} onClick={() => confirm('Unlink the ChatGPT account?') && run(async () => { await api.post('/admin/ai/logout'); reload(); })}>Unlink</button>}
              <button className="ghost" onClick={reload}>Refresh</button>
            </div>
            <details>
              <summary className="muted small">Use an OpenAI API key instead</summary>
              <div className="row" style={{ marginTop: 8 }}>
                <input type="password" placeholder="sk-…" id="apikey" className="grow" />
                <button onClick={() => run(async () => { await api.post('/admin/ai/api-key', { key: document.getElementById('apikey').value }); reload(); })}>Save key</button>
              </div>
            </details>
          </>
        )}
      </div>
      {s && (
        <div className="card stack">
          <h3>Assistant settings</h3>
          <label className="inline"><input type="checkbox" checked={s.ai_enabled} onChange={(e) => patch({ ai_enabled: e.target.checked })} /> Assistant enabled for all users</label>
          <div className="row">
            <div className="grow"><label>Model (empty = Codex default for your plan)</label><input value={model ?? s.ai_model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gpt-5.6" /></div>
            <button onClick={() => patch({ ai_model: model ?? s.ai_model })}>Save</button>
          </div>
          <h3 style={{ marginTop: 10 }}>What the assistant may do (MCP tools)</h3>
          <p className="muted small">Every tool runs with the permissions of the person chatting, so it can never touch parties or characters they couldn't edit themselves.</p>
          <div className="row">
            <button className="small" onClick={() => patch({ ai_disabled_tools: st.tools.filter((t) => t.write).map((t) => t.name) })}>Read-only</button>
            <button className="small" onClick={() => patch({ ai_disabled_tools: [] })}>Allow everything</button>
          </div>
          <table><tbody>
            {st?.tools.map((t) => (
              <tr key={t.name}>
                <td style={{ width: 30 }}><input type="checkbox" checked={!disabled.has(t.name)} onChange={(e) => patch({ ai_disabled_tools: e.target.checked ? [...disabled].filter((x) => x !== t.name) : [...disabled, t.name] })} /></td>
                <td><code>{t.name}</code> {t.write ? <span className="badge red">writes</span> : <span className="badge">reads</span>}</td>
                <td className="muted small">{t.description}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

export default function AdminPage({ me }) {
  const [tab, setTab] = useState('users');
  const { data: who, error, reload } = useLoad(() => api.get('/admin/whoami'), []);
  const [pw, setPw] = useState('');
  const [run, , err] = useAction();
  return (
    <div className="main" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-head">
        <h1>⚙️ Admin</h1>
        {me && <Link to="/">← Back to app</Link>}
      </div>
      {error && <div className="error">{error.status === 403 ? 'The admin panel is only available on the admin port from the server\'s home network.' : error.message}</div>}
      {who?.via === 'network' && <div className="notice small">You are using the home-network back door. It is not reachable through Tailscale.</div>}
      {who?.needs_password ? (
        <form className="card stack" style={{ maxWidth: 360 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post('/admin/unlock', { password: pw }); reload(); }); }}>
          <label>Admin password</label>
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
          <ErrorBox error={err} />
          <button className="primary">Unlock</button>
        </form>
      ) : who && (
        <>
          <div className="tabs">
            {[['users', 'Accounts'], ['settings', 'Settings'], ['ai', 'AI assistant']].map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab === 'users' && <Users />}
          {tab === 'settings' && <Settings />}
          {tab === 'ai' && <Ai />}
        </>
      )}
    </div>
  );
}
