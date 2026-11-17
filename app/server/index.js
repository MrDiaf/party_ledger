import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { rulesJson } from './rulesData.js';
import { sheetRoutes } from './sheetPdf.js';
import { sessionMiddleware, errorHandler } from './core.js';
import { authRouter, campaignsRouter } from './routes/auth.js';
import { adminRouter, adminNetworkGate } from './routes/admin.js';
import { dmRouter, monstersCatalog } from './routes/dm.js';
import { mapsRouter } from './routes/maps.js';
import { partyRouter } from './routes/party.js';
import { charactersRouter } from './routes/characters.js';
import { mcpHandler } from './mcp.js';
import { aiRouter, aiAdminRoutes } from './ai.js';
import { importRouter } from './importSheet.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
function spa(app) {
  if (!fs.existsSync(DIST)) return;
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|mcp).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

/** Main app — the one Tailscale serve/funnel should point at. */
export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(express.json({ limit: '30mb' }));
  app.use(sessionMiddleware(db));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/rules', (_req, res) => res.type('json').set('Cache-Control', 'public, max-age=3600').send(rulesJson()));
  app.use('/api/auth', authRouter(db));
  app.use('/api/campaigns', campaignsRouter(db));
  app.use('/api/campaigns', partyRouter(db));
  app.use('/api', sheetRoutes(db));
  app.use('/api/characters', importRouter(db));
  app.use('/api/characters', charactersRouter(db));
  app.use('/api', dmRouter(db));
  app.use('/api', mapsRouter(db));
  app.use('/api/ai', aiRouter(db));
  // No admin API here: the admin panel lives only on the LAN-only admin port (createAdminApp).
  // MCP is only for the Codex process inside this container.
  app.all('/mcp', (req, res, next) => (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ? next() : res.status(403).end()), mcpHandler(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  spa(app);
  app.use(errorHandler);
  return app;
}

/** Admin back door — separate port, home-LAN addresses only, never Tailscale. */
export function createAdminApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(adminNetworkGate);
  app.use(express.json({ limit: '1mb' }));
  app.use(sessionMiddleware(db));
  app.use('/api/admin', adminRouter(db, aiAdminRoutes));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.get('/', (_req, res) => res.redirect('/admin'));
  spa(app);
  app.use(errorHandler);
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  const port = Number(process.env.PORT || 3000);
  const adminPort = Number(process.env.ADMIN_INTERNAL_PORT || 3001);
  createApp(db).listen(port, () => console.log(`app listening on :${port}`));
  setImmediate(() => { rulesJson(); monstersCatalog(); }); // warm the PHB spell + Monster Manual extraction so the first visitor does not wait
  createAdminApp(db).listen(adminPort, () => console.log(`admin listening on :${adminPort} (LAN only)`));
  setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()), 3600e3).unref();
}
