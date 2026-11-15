// AI assistant via the Codex CLI, authenticated with the admin's ChatGPT subscription
// (`codex login --device-auth`). Codex reaches the app through our MCP endpoint.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { DATA_DIR, getSetting } from './db.js';
import { HttpError, h, str, requireUser, requireMember } from './core.js';
import { decodeImage, addLogImages } from './routes/party.js';
import { issueToken, revokeToken, enabledTools, TOOLS } from './mcp.js';

const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const CODEX_HOME = process.env.CODEX_HOME || path.join(DATA_DIR, 'codex');
const MCP_URL = process.env.MCP_INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 3000}/mcp`;
const RUN_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 240000);
fs.mkdirSync(CODEX_HOME, { recursive: true });

function run(args, { input, env = {}, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(CODEX_BIN, args, { env: { ...process.env, CODEX_HOME, ...env }, cwd: os.tmpdir() });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: e.message });
    }
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

// ---- login management (admin) -------------------------------------------------------------
let login = null; // { proc, output, state, url, code }

export async function codexStatus() {
  const r = await run(['login', 'status']);
  const text = (r.stdout + r.stderr).trim();
  return {
    installed: r.code !== -1,
    logged_in: r.code === 0 && /logged in/i.test(text),
    detail: text.split('\n').slice(-3).join(' ').slice(0, 300),
    login: login && { state: login.state, url: login.url, code: login.code, output: login.output.slice(-1500) },
  };
}

function startLogin() {
  if (login?.state === 'pending') return;
  const proc = spawn(CODEX_BIN, ['login', '--device-auth'], { env: { ...process.env, CODEX_HOME }, cwd: os.tmpdir() });
  login = { proc, output: '', state: 'pending', url: null, code: null };
  const onData = (d) => {
    // eslint-disable-next-line no-control-regex
    login.output += d.toString().replace(/\x1b\[[0-9;]*m/g, '');
    login.url ||= /(https:\/\/\S+)/.exec(login.output)?.[1] || null;
    login.code ||= /\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\b/.exec(login.output)?.[1] || null;
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (e) => { login.state = 'error'; login.output += `\n${e.message}`; });
  proc.on('close', (code) => { if (login.state === 'pending') login.state = code === 0 ? 'done' : 'error'; });
  setTimeout(() => { if (login?.proc === proc && login.state === 'pending') { proc.kill(); login.state = 'expired'; } }, 15 * 60 * 1000);
}

export function aiAdminRoutes(r) {
  r.get('/ai/status', h(async () => ({ ...(await codexStatus()), tools: TOOLS.map((t) => ({ name: t.name, write: t.write, description: t.description.split('. ')[0] })) })));
  r.post('/ai/login', h(() => { startLogin(); return { ok: true }; }));
  r.post('/ai/login/cancel', h(() => { if (login?.state === 'pending') { login.proc.kill(); login.state = 'cancelled'; } return { ok: true }; }));
  r.post('/ai/logout', h(async () => { await run(['logout']); login = null; return { ok: true }; }));
  r.post('/ai/api-key', h(async (req) => {
    const key = str(req.body.key, 500).trim();
    if (!key) throw new HttpError(400, 'Key required');
    const res = await run(['login', '--with-api-key'], { input: key });
    if (res.code !== 0) throw new HttpError(400, (res.stderr || res.stdout).slice(0, 300) || 'Login failed');
    return { ok: true };
  }));
}

// ---- running the agent -------------------------------------------------------------------
const SYSTEM = `You are the assistant for a private Dungeons & Dragons 5e (2014 Player's Handbook) group-organisation app.
You can read and change app data ONLY through the "dnd" MCP tools. Never run shell commands or edit files.
Character resource changes (damage, healing, spell slots, rests, conditions, effects) must go through character_action so they are recorded in history.
Images the user sends you are stored with an upload_id. To put one into a session log, call propose_session_image: that only creates a
proposal the user must confirm in the chat panel, so say so and never claim it is attached before they confirm. In session log text, [imgN] refers to picture N of that session.
Use lookup_rules when a rule matters. Be concise. If something is ambiguous (which character, how much), ask before writing.
Answer in the language the user writes in.`;

let busy = 0;

/**
 * Run `codex exec` once. Returns { text, tools: [{name, ok}], error? }.
 * `schemaFile`/`images` are used by the sheet-photo import.
 */
export async function runAgent(db, { user, campaignId, prompt, images = [], schema = null, useTools = true }) {
  if (!getSetting(db, 'ai_enabled')) throw new HttpError(403, 'The AI assistant is disabled by the admin');
  if (busy >= 3) throw new HttpError(429, 'The assistant is busy — try again in a moment');
  busy++;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-ai-'));
  const token = issueToken(user.id, campaignId || null);
  try {
    const outFile = path.join(tmp, 'last.txt');
    const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', tmp, '-o', outFile,
      '-c', 'approval_policy="never"'];
    const model = getSetting(db, 'ai_model');
    if (model) args.push('-m', model);
    if (useTools && enabledTools(db).length) {
      // Tools are pre-approved: the admin decides which tools exist (Settings → AI) and every
      // tool enforces the acting user's permissions server-side, so there is nothing to prompt for.
      args.push('-c', `mcp_servers.dnd.url="${MCP_URL}"`, '-c', 'mcp_servers.dnd.bearer_token_env_var="DND_MCP_TOKEN"',
        '-c', 'mcp_servers.dnd.default_tools_approval_mode="approve"');
    }
    if (schema) {
      const sf = path.join(tmp, 'schema.json');
      fs.writeFileSync(sf, JSON.stringify(schema));
      args.push('--output-schema', sf);
    }
    for (const img of images) args.push('-i', img);
    args.push('-');
    const res = await run(args, { input: prompt, env: { DND_MCP_TOKEN: token }, timeout: RUN_TIMEOUT_MS });
    const tools = [];
    let lastAgentText = '', errorText = '';
    for (const line of res.stdout.split('\n')) {
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      const item = ev.item || {};
      if (ev.type === 'item.completed' && item.type === 'mcp_tool_call') tools.push({ name: item.tool, ok: item.status !== 'failed' && !item.error });
      if (ev.type === 'item.completed' && item.type === 'agent_message') lastAgentText = item.text || lastAgentText;
      if (ev.type === 'error' || ev.type === 'turn.failed') errorText = ev.message || ev.error?.message || JSON.stringify(ev).slice(0, 300);
    }
    const text = (fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '') || lastAgentText;
    if (!text) {
      const detail = errorText || res.stderr.split('\n').filter(Boolean).slice(-3).join(' ') || `codex exited with ${res.code}`;
      if (res.code === -1) throw new HttpError(503, 'Codex CLI is not installed in this container');
      throw new HttpError(502, /login|auth|401/i.test(detail) ? 'The assistant is not linked — the admin needs to sign in under Admin → AI' : `Assistant failed: ${detail.slice(0, 400)}`);
    }
    return { text, tools };
  } finally {
    busy--;
    revokeToken(token);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function chatPrompt(db, user, campaignId, history, message) {
  const party = campaignId ? db.prepare('SELECT id, name FROM campaigns WHERE id = ?').get(campaignId) : null;
  const convo = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  return `${SYSTEM}\n\nActing user: ${user.display_name} (id ${user.id}).${party ? ` Current party: "${party.name}" (campaign_id ${party.id}).` : ''}\n` +
    `Today is ${new Date().toISOString().slice(0, 10)}.\n\n${convo ? `Conversation so far:\n${convo}\n\n` : ''}User: ${message}`;
}

export function aiRouter(db) {
  const r = Router();
  r.get('/messages', h((req) => {
    const user = requireUser(req);
    return {
      enabled: !!getSetting(db, 'ai_enabled'),
      messages: db.prepare('SELECT id, role, content, at FROM ai_messages WHERE user_id = ? ORDER BY id DESC LIMIT 60').all(user.id).reverse(),
      proposals: db.prepare("SELECT id, kind, payload, at FROM ai_proposals WHERE user_id = ? AND status = 'pending' ORDER BY id").all(user.id)
        .map((p) => ({ ...p, payload: JSON.parse(p.payload) })),
    };
  }));
  r.delete('/messages', h((req) => {
    const uid = requireUser(req).id;
    db.prepare('DELETE FROM ai_messages WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM ai_proposals WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM ai_uploads WHERE user_id = ?').run(uid);
    return { ok: true };
  }));
  r.get('/uploads/:id', h((req, res) => {
    const up = db.prepare('SELECT mime, data FROM ai_uploads WHERE id = ? AND user_id = ?').get(Number(req.params.id), requireUser(req).id);
    if (!up) throw new HttpError(404, 'Image not found');
    res.type(up.mime).set('Cache-Control', 'private, max-age=86400').send(Buffer.from(up.data));
  }));
  // The user confirms (optionally with an edited caption) or discards what the assistant proposed.
  r.post('/proposals/:id/:decision', h((req) => {
    const user = requireUser(req);
    const p = db.prepare("SELECT * FROM ai_proposals WHERE id = ? AND user_id = ? AND status = 'pending'").get(Number(req.params.id), user.id);
    if (!p) throw new HttpError(404, 'Nothing to confirm (already handled?)');
    if (req.params.decision === 'discard') {
      db.prepare("UPDATE ai_proposals SET status = 'discarded' WHERE id = ?").run(p.id);
      return { ok: true };
    }
    if (req.params.decision !== 'accept') throw new HttpError(400, 'accept or discard');
    const pl = JSON.parse(p.payload);
    const up = db.prepare('SELECT mime, data FROM ai_uploads WHERE id = ? AND user_id = ?').get(pl.upload_id, user.id);
    if (!up) throw new HttpError(404, 'The image is gone (conversation cleared?)');
    const caption = req.body.caption != null ? str(req.body.caption) : pl.caption;
    const r2 = addLogImages(db, user, pl.session_id, caption, [{ mime: up.mime, data: up.data }]);
    db.prepare("UPDATE ai_proposals SET status = 'accepted' WHERE id = ?").run(p.id);
    db.prepare("INSERT INTO ai_messages(user_id, campaign_id, role, content) VALUES(?,?, 'assistant', ?)")
      .run(user.id, pl.campaign_id, `✅ Added to ${pl.session} as [img${r2.images[0].n}].`);
    return { ok: true, ...r2, session_id: pl.session_id };
  }));
  r.post('/chat', h(async (req) => {
    const user = requireUser(req);
    const images = (Array.isArray(req.body.images) ? req.body.images : []).slice(0, 4).map(decodeImage);
    const typed = str(req.body.message, 8000).trim();
    if (!typed && !images.length) throw new HttpError(400, 'Say something first');
    const ids = images.map((img) => Number(db.prepare('INSERT INTO ai_uploads(user_id, mime, data) VALUES(?,?,?)').run(user.id, img.mime, img.data).lastInsertRowid));
    // the marker stays in the stored conversation so later turns still know the upload ids
    const message = `${typed || '(image)'}${ids.length ? `\n${ids.map((i) => `[attached image upload_id ${i}]`).join(' ')}` : ''}`;
    const campaignId = req.body.campaign_id ? Number(req.body.campaign_id) : null;
    if (campaignId) requireMember(db, user, campaignId);
    const history = db.prepare('SELECT role, content FROM ai_messages WHERE user_id = ? ORDER BY id DESC LIMIT 12').all(user.id).reverse();
    db.prepare("INSERT INTO ai_messages(user_id, campaign_id, role, content) VALUES(?,?, 'user', ?)").run(user.id, campaignId, message);
    let reply;
    const imgDir = ids.length ? fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-chat-')) : null;
    try {
      const files = images.map((img, i) => {
        const f = path.join(imgDir, `upload-${ids[i]}.${img.mime.split('/')[1].replace('jpeg', 'jpg')}`);
        fs.writeFileSync(f, img.data);
        return f;
      });
      reply = await runAgent(db, { user, campaignId, images: files, prompt: chatPrompt(db, user, campaignId, history, message) });
    } catch (e) {
      db.prepare("INSERT INTO ai_messages(user_id, campaign_id, role, content) VALUES(?,?, 'assistant', ?)").run(user.id, campaignId, `⚠️ ${e.message}`);
      throw e;
    } finally {
      if (imgDir) fs.rmSync(imgDir, { recursive: true, force: true });
    }
    const toolNote = reply.tools.length ? `\n\n🔧 ${reply.tools.map((t) => t.name + (t.ok ? '' : ' (failed)')).join(', ')}` : '';
    db.prepare("INSERT INTO ai_messages(user_id, campaign_id, role, content) VALUES(?,?, 'assistant', ?)").run(user.id, campaignId, reply.text + toolNote);
    return { reply: reply.text + toolNote, tools: reply.tools };
  }));
  return r;
}
