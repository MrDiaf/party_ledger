import { useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, useAction } from '../components/ui.jsx';

export default function AuthPage({ registrationOpen, onDone }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', display_name: '' });
  const [run, busy, error] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    run(async () => { await api.post(`/auth/${mode}`, form); await onDone(); });
  };
  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={submit}>
        <h1>🐉 Party Ledger</h1>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
          {registrationOpen && <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create account</button>}
        </div>
        <div><label>Username</label><input autoFocus autoComplete="username" value={form.username} onChange={set('username')} /></div>
        {mode === 'register' && <div><label>Display name (optional)</label><input value={form.display_name} onChange={set('display_name')} /></div>}
        <div><label>Password</label><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} /></div>
        <ErrorBox error={error} />
        <button className="primary" disabled={busy}>{mode === 'login' ? 'Enter' : 'Create account'}</button>
        <p className="muted small center">Forgot your password? Ask the admin — they can reset it.</p>
      </form>
    </div>
  );
}
