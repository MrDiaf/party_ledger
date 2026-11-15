import { useEffect, useState, useCallback } from 'react';
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import { api } from './api.js';
import { AppContext } from './components/ui.jsx';
import AuthPage from './pages/AuthPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import HomePage from './pages/HomePage.jsx';
import PartyPage from './pages/PartyPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import QuestsPage from './pages/QuestsPage.jsx';
import TreasuryPage from './pages/TreasuryPage.jsx';
import LogsPage from './pages/LogsPage.jsx';
import CharactersPage from './pages/CharactersPage.jsx';
import BuilderPage from './pages/BuilderPage.jsx';
import SheetPage from './pages/SheetPage.jsx';
import ImportPage from './pages/ImportPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import MonstersPage from './pages/MonstersPage.jsx';
import NotesPage from './pages/NotesPage.jsx';
import AiPanel from './components/AiPanel.jsx';

const CAMPAIGN_KEY = 'dnd.campaign';

export default function App() {
  const location = useLocation();
  const [me, setMe] = useState(undefined);
  const [campaignId, setCampaignIdState] = useState(() => {
    try { return Number(localStorage.getItem(CAMPAIGN_KEY)) || null; } catch { return null; }
  });
  const [aiOpen, setAiOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const refreshMe = useCallback(async () => {
    try { setMe(await api.get('/auth/me')); } catch { setMe({ user: null }); }
  }, []);
  useEffect(() => { refreshMe(); }, [refreshMe]);
  useEffect(() => setNavOpen(false), [location.pathname]);

  const setCampaignId = (id) => {
    setCampaignIdState(id);
    try { localStorage.setItem(CAMPAIGN_KEY, id ? String(id) : ''); } catch { /* storage may be blocked */ }
  };

  // Admin back door works without a normal login (LAN port) — render it standalone.
  if (location.pathname.startsWith('/admin')) return <AdminPage me={me?.user} />;
  if (me === undefined) return <div className="auth-wrap"><div className="muted">Loading…</div></div>;
  if (!me.user) return <AuthPage registrationOpen={me.registration_open} onDone={refreshMe} />;

  const campaigns = me.campaigns || [];
  const campaign = campaigns.find((c) => c.id === campaignId) || campaigns[0] || null;
  const ctx = { me: me.user, campaigns, campaign, setCampaignId, refreshMe, aiEnabled: me.ai_enabled };

  return (
    <AppContext.Provider value={ctx}>
      <div className={`app ${aiOpen ? 'with-ai' : ''}`}>
        <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
          <div className="brand">🐉 Party Ledger</div>
          <label>Party</label>
          <select value={campaign?.id || ''} onChange={(e) => setCampaignId(Number(e.target.value))}>
            {!campaigns.length && <option value="">No party yet</option>}
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <nav className="nav">
            <div className="nav-section">Shared</div>
            <NavLink to="/" end>🏰 Overview</NavLink>
            <NavLink to="/calendar">📅 Calendar</NavLink>
            <NavLink to="/quests">📜 Quests</NavLink>
            <NavLink to="/treasury">💰 Treasury</NavLink>
            <NavLink to="/logs">📖 Session logs</NavLink>
            <NavLink to="/party">🛡️ Party</NavLink>
            {campaign?.role !== 'dm' && campaign && <NavLink to="/notes">📣 Announcements</NavLink>}
            {campaign?.role === 'dm' && <>
              <div className="nav-section">Dungeon Master</div>
              <NavLink to="/monsters">🐉 Monsters</NavLink>
              <NavLink to="/notes">📝 DM notes</NavLink>
            </>}
            <div className="nav-section">Personal</div>
            <NavLink to="/characters">🧙 Characters</NavLink>
            <NavLink to="/profile">👤 Profile</NavLink>
          </nav>
          <div className="spacer" />
          {me.ai_enabled && <button onClick={() => setAiOpen((o) => !o)}>{aiOpen ? 'Hide assistant' : '✨ Assistant'}</button>}
          <div className="row between small muted" style={{ padding: '8px 4px 0' }}>
            <span><span className="dot" style={{ background: me.user.color }} /> {me.user.display_name}</span>
            <a href="#" onClick={async (e) => { e.preventDefault(); await api.post('/auth/logout'); refreshMe(); }}>Log out</a>
          </div>
        </aside>
        {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
        <div className="topbar">
          <button className="icon" onClick={() => setNavOpen((o) => !o)} aria-label="Menu">☰</button>
          <strong className="grow topbar-title">{campaign?.name || 'Party Ledger'}</strong>
          {me.ai_enabled && <button className="icon" onClick={() => setAiOpen((o) => !o)} aria-label="Assistant">✨</button>}
        </div>
        <main className="main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/quests" element={<QuestsPage />} />
            <Route path="/treasury" element={<TreasuryPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/logs/:id" element={<LogsPage />} />
            <Route path="/party" element={<PartyPage />} />
            <Route path="/characters" element={<CharactersPage />} />
            <Route path="/characters/new" element={<BuilderPage />} />
            <Route path="/characters/import" element={<ImportPage />} />
            <Route path="/characters/:id" element={<SheetPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/monsters" element={<MonstersPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/notes/:id" element={<NotesPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        {aiOpen && <AiPanel onClose={() => setAiOpen(false)} />}
        <nav className="bottom-nav" aria-label="Main">
          <NavLink to="/" end><span>🏰</span>Home</NavLink>
          <NavLink to="/characters"><span>🧙</span>Characters</NavLink>
          <NavLink to="/calendar"><span>📅</span>Calendar</NavLink>
          <NavLink to="/logs"><span>📖</span>Logs</NavLink>
          <button className={navOpen ? 'active' : ''} onClick={() => setNavOpen((o) => !o)}><span>☰</span>More</button>
        </nav>
      </div>
    </AppContext.Provider>
  );
}
