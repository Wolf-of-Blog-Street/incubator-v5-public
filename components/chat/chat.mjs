#!/usr/bin/env node
/**
 * chat — the fleet's live room. Every agent (Claude Code, Codex, agy) talks and listens here.
 * See design fleet-chat.md.
 *
 *   chat say <@seat[/context|/handle]|@handle|#channel> "<text>"   send; a mentioned agent is pinged in its cmux tab
 *   chat read [#channel] [--unread] [--since 2h]                   read (--unread: what is for you and not read yet)
 *   chat who [--refresh]                                           who is online, and every seat's contexts
 *   chat register [--seat s] [--handle h] --type claude|codex|agy --model m [--context c] [--subscribe #a,#b]
 *   chat serve                                                     the service (launchd me.falcon.chat), 127.0.0.1 only
 *   chat start                                                     open the delivery bridge in its own cmux tab (it types messages into agents' tabs)
 *   chat bridge                                                    the bridge itself (runs inside cmux)
 *   chat mcp                                                       MCP server on stdio: chat_send, chat_read, chat_who, chat_register
 *
 * Who you are: --as seat/handle, else CHAT_ME, else the seat of the current folder (harness/falcon.env)
 * with handle CHAT_HANDLE or "lead".
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keyOf, validAddress, recipients, isFor, deliveryText } from './lib/core.mjs';
import { buildDirectory, seatId } from './lib/directory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.CHAT_HOME || path.join(os.homedir(), '.incubator', 'chat');
const PORT = Number(process.env.CHAT_PORT || 3335);
const TELL = process.env.CHAT_TELL || path.join(__dirname, '..', 'harness', 'tools', 'cmux-tell.sh');
const MSGS = path.join(HOME, 'messages.jsonl');
const SESSIONS = path.join(HOME, 'sessions.json');
const DIRECTORY = path.join(HOME, 'directory.json');

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { fs.writeFileSync(p + '.tmp', JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(p + '.tmp', p); };
const since = s => { const m = String(s || '').match(/^(\d+)([mhd])$/); return m ? Date.now() - m[1] * { m: 6e4, h: 36e5, d: 864e5 }[m[2]] : 0; };

// ---------------------------------------------------------------- the service
export function serve(port = PORT) {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const messages = fs.existsSync(MSGS) ? fs.readFileSync(MSGS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const sessions = readJson(SESSIONS, {});
  let directory = readJson(DIRECTORY, []);
  const streams = new Set();
  const bridges = new Set(); // the delivery bridge's open stream (it runs inside cmux)

  const saveSessions = () => writeJson(SESSIONS, sessions);
  const list = () => Object.values(sessions);
  const refresh = async () => { directory = await buildDirectory(); writeJson(DIRECTORY, directory); };
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), 10 * 60 * 1000).unref();

  const body = req => new Promise((res, rej) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => { try { res(d ? JSON.parse(d) : {}); } catch (e) { rej(e); } }); });
  const send = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    // A web page in a browser can post to a local port; a message it forged would be typed into an agent's
    // session. So a browser request must come from this page itself, and a write must be JSON (a cross-site
    // JSON post needs a preflight, which this server never grants).
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, { error: 'cross-origin requests are refused' });
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON only' });
    try {
      if (req.method === 'POST' && u.pathname === '/register') {
        const b = await body(req);
        if (!b.seat || !b.handle) return send(res, 400, { error: 'seat and handle are required' });
        const k = keyOf(b), prev = sessions[k] || {};
        // A handle belongs to one tab. Another tab seen in the last day holds it: refuse, unless forced.
        if (prev.surface && b.surface && prev.surface !== b.surface && Date.now() - (prev.seenAt || 0) < 864e5 && !b.force)
          return send(res, 409, { error: `@${k} is held by another tab (seen ${Math.round((Date.now() - prev.seenAt) / 6e4)}m ago); register with your own --handle` });
        // One tab, one session: drop this tab's old registrations under other handles.
        if (b.surface) for (const [kk, v] of Object.entries(sessions)) if (kk !== k && v.surface === b.surface) delete sessions[kk];
        sessions[k] = { ...prev, seat: b.seat, handle: b.handle, type: b.type || prev.type || '?', model: b.model || prev.model || '?',
          context: b.context ?? prev.context ?? '', workspace: b.workspace || prev.workspace || null, surface: b.surface || prev.surface || null,
          subscriptions: b.subscriptions || prev.subscriptions || [], lastRead: prev.lastRead || 0, seenAt: Date.now() };
        saveSessions();
        const unread = messages.filter(m => m.id > sessions[k].lastRead && isFor(m, sessions[k], list()));
        return send(res, 200, { registered: sessions[k], unread });
      }
      if (req.method === 'POST' && u.pathname === '/send') {
        const b = await body(req);
        if (!b.from || !validAddress(b.to) || !String(b.text || '').trim()) return send(res, 400, { error: 'from, a valid to (@seat, @seat/context, @handle or #channel) and text are required' });
        const msg = { id: (messages.at(-1)?.id || 0) + 1, ts: Date.now(), from: b.from, to: b.to, text: String(b.text).slice(0, 8000) };
        if (sessions[b.from]) sessions[b.from].seenAt = Date.now();
        messages.push(msg);
        fs.appendFileSync(MSGS, JSON.stringify(msg) + '\n', { mode: 0o600 });
        const to = recipients(msg, list());
        for (const s of streams) s.write(`data: ${JSON.stringify(msg)}\n\n`);
        return send(res, 200, { id: msg.id, pinged: to.map(keyOf), waiting: to.filter(s => !s.surface || !bridges.size).map(keyOf), bridge: bridges.size > 0 });
      }
      if (req.method === 'GET' && u.pathname === '/read') {
        const me = sessions[u.searchParams.get('me')];
        const ch = u.searchParams.get('channel');
        let out = messages.filter(m => m.ts >= since(u.searchParams.get('since')));
        if (ch) out = out.filter(m => m.to === ch);
        if (u.searchParams.get('unread') && me) {
          out = out.filter(m => m.id > me.lastRead && isFor(m, me, list()));
          me.lastRead = messages.at(-1)?.id || 0; me.seenAt = Date.now(); saveSessions();
        }
        return send(res, 200, out.slice(-Number(u.searchParams.get('limit') || 50)));
      }
      if (req.method === 'GET' && u.pathname === '/whoami') {
        const hit = list().find(x => x.surface && x.surface === u.searchParams.get('surface'));
        return hit ? send(res, 200, hit) : send(res, 404, { error: 'this tab is not registered' });
      }
      if (req.method === 'GET' && u.pathname === '/who') {
        if (u.searchParams.get('refresh')) await refresh();
        return send(res, 200, { sessions: list().sort((a, b) => b.seenAt - a.seenAt), directory, bridge: bridges.size > 0 });
      }
      if (req.method === 'GET' && u.pathname === '/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n'); streams.add(res);
        if (u.searchParams.get('bridge')) bridges.add(res);
        req.on('close', () => { streams.delete(res); bridges.delete(res); });
        return;
      }
      if (req.method === 'GET' && u.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
        return res.end(fs.readFileSync(path.join(__dirname, 'page.html')));
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 500, { error: e.message }); }
  });
  setInterval(() => { for (const s of streams) s.write(': keepalive\n\n'); }, 15000).unref();
  server.listen(port, '127.0.0.1', () => console.log(`chat listening on http://127.0.0.1:${port}`));
  return server;
}

// ---------------------------------------------------------------- the bridge
/**
 * Delivery. cmux lets only processes started inside cmux type into a tab, so this runs in a cmux tab
 * of its own (chat start opens it). It follows the service's stream and types each message into the
 * tab of every session it pings, one delivery at a time per tab. A message it cannot deliver stays
 * unread and shows at that agent's next start or read.
 */
export async function bridge(port = PORT) {
  const queues = new Map();
  const deliver = (s, msg) => {
    const q = (queues.get(s.surface) || Promise.resolve()).then(() => new Promise(res =>
      execFile('sh', [TELL, s.workspace, s.surface, deliveryText(msg)], { timeout: 180000 }, (err, out) => {
        console.log(`${new Date().toTimeString().slice(0, 8)}  #${msg.id} → @${keyOf(s)}: ${err ? 'NOT delivered: ' + String(out || err.message).trim().split('\n').pop() : 'delivered'}`);
        res();
      })));
    queues.set(s.surface, q);
  };
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/stream?bridge=1`);
      console.log(`${new Date().toTimeString().slice(0, 8)}  bridge connected; delivering fleet chat into cmux tabs`);
      let buf = '';
      for await (const chunk of r.body) {
        buf += Buffer.from(chunk).toString();
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const ev = buf.slice(0, k); buf = buf.slice(k + 2);
          const line = ev.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue;
          const msg = JSON.parse(line.slice(6));
          const { sessions } = await (await fetch(`http://127.0.0.1:${port}/who`)).json();
          for (const s of recipients(msg, sessions)) if (s.workspace && s.surface) deliver(s, msg);
        }
      }
    } catch (e) { console.log(`bridge: ${e.message}; retrying in 5s`); }
    await new Promise(res => setTimeout(res, 5000));
  }
}

// ---------------------------------------------------------------- the client
/** The seat folder: the nearest folder up from here with harness/falcon.env. */
function seatDir(from = process.cwd()) {
  for (let d = path.resolve(from); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'harness', 'falcon.env'))) return d;
    if (d === path.dirname(d)) return null;
  }
}
/**
 * Who is calling: --as seat/handle, else CHAT_ME, else the session registered for this cmux tab,
 * else the seat of the current folder with --handle, CHAT_HANDLE or "lead".
 */
export async function whoAmI(flags = {}) {
  const me = flags.as || process.env.CHAT_ME;
  if (me) { const [seat, handle = 'lead'] = String(me).split('/'); return { seat, handle, explicit: true }; }
  const dir = seatDir();
  const seat = flags.seat || (dir ? seatId(dir) : null);
  const handle = flags.handle || process.env.CHAT_HANDLE;
  if (handle) return { seat, handle, explicit: true };
  const tab = process.env.CMUX_SURFACE_ID;
  if (tab) { try { const s = await call('GET', `/whoami?surface=${encodeURIComponent(tab)}`); return { seat: s.seat, handle: s.handle, explicit: true }; } catch {} }
  return { seat, handle: 'lead', explicit: false };
}
async function call(method, p, payload) {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers: { 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined })
    .catch(() => { throw new Error(`the chat service is not running on 127.0.0.1:${PORT} (launchd me.falcon.chat; start it with: chat serve)`); });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
const fmtMsg = m => `${new Date(m.ts).toTimeString().slice(0, 5)}  #${m.id}  @${m.from} → ${m.to}: ${m.text}`;
const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

export const api = {
  say: (me, to, text) => call('POST', '/send', { from: `${me.seat}/${me.handle}`, to, text }),
  read: (me, { channel, unread, since: s } = {}) => call('GET', `/read?me=${encodeURIComponent(`${me.seat}/${me.handle}`)}${channel ? `&channel=${encodeURIComponent(channel)}` : ''}${unread ? '&unread=1' : ''}${s ? `&since=${s}` : ''}`),
  who: refresh => call('GET', `/who${refresh ? '?refresh=1' : ''}`),
  register: (me, f) => call('POST', '/register', { seat: me.seat, handle: me.handle, force: !!f.force, type: f.type, model: f.model, context: f.context,
    workspace: f.workspace || process.env.CMUX_WORKSPACE_ID, surface: f.surface || process.env.CMUX_SURFACE_ID,
    subscriptions: f.subscribe ? String(f.subscribe).split(',').map(s => s.trim()).filter(Boolean) : undefined }),
};
export { fmtMsg };

export function renderWho(w) {
  const lines = ['Online (seat/handle · type · model · working on · seen):'];
  for (const s of w.sessions) lines.push(`  @${s.seat}/${s.handle}  ${s.type}  ${s.model}  ${s.context || '-'}  ${s.surface ? '' : '(no cmux tab: messages wait) '}${ago(s.seenAt)} ago`);
  lines.push('', 'Seats and their contexts (● loaded):');
  for (const d of w.directory) lines.push(`  ${d.seat}: ${d.contexts.map(c => `${c.loaded ? '●' : '○'}${c.slug}`).join(', ') || '(no contexts)'}`);
  if (!w.bridge) lines.push('', 'The delivery bridge is not running: messages wait as unread until it is (chat start, from inside cmux).');
  lines.push('', 'Address: @seat, @seat/context, @seat/handle or @handle; #channel for a room.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- CLI
function parse(argv) {
  const f = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); f[k] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
    else pos.push(argv[i]);
  }
  return { f, pos };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { f, pos } = parse(rest);
  const KNOWN = { say: ['as', 'seat', 'handle'], read: ['as', 'seat', 'handle', 'unread', 'since'], who: ['refresh'], serve: ['port'], bridge: ['port'], start: [], mcp: [],
    register: ['as', 'seat', 'handle', 'type', 'model', 'context', 'subscribe', 'workspace', 'surface', 'force'] };
  let me;
  const need = () => { if (!me.seat) throw new Error('no seat here: run chat from a seat folder, or pass --as seat/handle'); };
  (async () => {
    const bad = KNOWN[cmd] ? Object.keys(f).filter(k => k !== 'help' && !KNOWN[cmd].includes(k)) : [];
    if (!KNOWN[cmd] || f.help || bad.length) {
      if (bad.length && !f.help) console.error(`chat ${cmd}: unknown option ${bad.map(b => '--' + b).join(', ')}`);
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 20).map(l => l.replace(/^ \* ?/, '')).join('\n'));
      process.exit(KNOWN[cmd] && !bad.length ? 0 : 2);
    }
    me = await whoAmI(f);
    if (cmd === 'serve') return serve(Number(f.port || PORT));
    if (cmd === 'mcp') return (await import('./mcp.mjs')).runMcp();
    if (cmd === 'bridge') return bridge(Number(f.port || PORT));
    if (cmd === 'start') {
      const w = await api.who();
      if (w.bridge) return console.log('the bridge is already running');
      execFile('cmux', ['new-workspace', '--name', 'Fleet Chat bridge', '--cwd', process.cwd(), '--focus', 'false', '--command', `${process.execPath} ${fileURLToPath(import.meta.url)} bridge`], (e, out) => console.log(e ? `could not open the bridge tab: ${e.message}` : `bridge started in a cmux tab ${String(out).trim()}`));
      return;
    }
    if (cmd === 'say') { need(); const r = await api.say(me, pos[0], pos.slice(1).join(' ')); return console.log(`sent #${r.id}; pinged ${r.pinged.join(', ') || 'nobody (no session matches; it waits in the log)'}${r.waiting.length ? `; waiting (no cmux tab): ${r.waiting.join(', ')}` : ''}`); }
    if (cmd === 'read') { need(); const r = await api.read(me, { channel: pos[0], unread: f.unread, since: f.since }); return console.log(r.map(fmtMsg).join('\n') || '(nothing)'); }
    if (cmd === 'who') return console.log(renderWho(await api.who(f.refresh)));
    if (cmd === 'register') {
      need();
      if (!f.type || !f.model) throw new Error('register needs --type claude|codex|agy and --model <model>');
      const r = await api.register(me, f);
      const s = r.registered;
      console.log(`registered @${s.seat}/${s.handle} (${s.type} ${s.model}, working on ${s.context || '-'})${s.surface ? '' : ' with no cmux tab: messages to you wait until you read them'}`);
      if (r.unread.length) console.log(`\nUnread for you (${r.unread.length}); read them with: chat read --unread\n` + r.unread.slice(-10).map(fmtMsg).join('\n'));
      return;
    }
  })().catch(e => { console.error(`chat: ${e.message}`); process.exit(1); });
}
