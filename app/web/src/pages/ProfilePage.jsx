import { useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, useAction, useApp } from '../components/ui.jsx';

export default function ProfilePage() {
  const { me, refreshMe } = useApp();
  const [name, setName] = useState(me.display_name);
  const [color, setColor] = useState(me.color);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [run, busy, error] = useAction();
  const [msg, setMsg] = useState('');
  const save = (body, done) => run(async () => { await api.patch('/auth/me', body); await refreshMe(); setMsg(done); });
  return (
    <div className="stack" style={{ maxWidth: 520 }}>
      <h1>Profile</h1>
      <div className="card stack">
        <div><label>Username</label><div>{me.username}</div></div>
        <div className="row">
          <div className="grow"><label>Display name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label>Calendar colour</label><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></div>
        </div>
        <div className="row end"><button className="primary" disabled={busy} onClick={() => save({ display_name: name, color }, 'Saved')}>Save</button></div>
      </div>
      <div className="card stack">
        <h3>Change password</h3>
        <div><label>Current password</label><input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></div>
        <div><label>New password (any length)</label><input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></div>
        <div className="row end"><button disabled={busy || !pw.new_password} onClick={() => save(pw, 'Password changed')}>Change password</button></div>
      </div>
      <ErrorBox error={error} />
      {msg && <div className="notice">{msg}</div>}
    </div>
  );
}
