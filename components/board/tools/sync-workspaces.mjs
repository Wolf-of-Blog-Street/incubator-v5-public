#!/usr/bin/env node
/**
 * sync-workspaces — a seat reports its own folders to the board.
 *
 *   workspaces/<name>/   → kind "workspace" (a board; a catalog entry when it has a GitHub remote of its own)
 *   projects/<name>/     → kind "project"   (listed only; no board)
 *   brain/__source/*.md with entity: context → the seat's contexts (● when loaded), PATCHed onto the roster entry
 *
 * Idempotent: every run re-posts the current set; the roster upserts by id. Nothing is removed
 * here (a deleted folder may be a temporary state; remove with fleet project rm when you mean it).
 * Reads harness/falcon.env for the board URL, token and seat id. Quiet on success unless --verbose.
 *
 *   node harness/components/board/tools/sync-workspaces.mjs [--root <seat>] [--dry-run] [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGitWorktreeInfo, normalizeGithubSlug } from '../engine/workspaceScanner.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const root = path.resolve(opt('--root') || process.cwd());
const dryRun = flag('--dry-run');
const verbose = flag('--verbose') || dryRun;
const log = (...a) => { if (verbose) console.log(...a); };

const SKIP = new Set(['INDEX.md', 'README.md']);
const skipName = (n) => n.startsWith('.') || n.startsWith('_') || SKIP.has(n);

function readEnv() {
  const env = { url: process.env.FALCON_BOARD_URL, token: process.env.FALCON_BOARD_TOKEN, seat: process.env.FALCON_AGENT_ID };
  const p = path.join(root, 'harness', 'falcon.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const [k, ...v] = t.split('=');
      const val = v.join('=');
      if (k === 'FALCON_BOARD_URL' && !env.url) env.url = val;
      if (k === 'FALCON_BOARD_TOKEN' && !env.token) env.token = val;
      if (k === 'FALCON_AGENT_ID' && !env.seat) env.seat = val;
    }
  }
  return env;
}

function titleOf(dir, fallback) {
  for (const f of ['README.md', 'INDEX.md']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/^#\s+(.+)$/m);
    if (m) return m[1].trim().slice(0, 80);
  }
  return fallback;
}

function listDirs(sub, seatRoot = root) {
  const base = path.join(seatRoot, sub);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(e => e.isDirectory() && !skipName(e.name))
    .map(e => ({ name: e.name, dir: path.join(base, e.name) }));
}

/** Folders → project records. The folder decides the kind; a remote is recorded when the workspace has one of its own. */
export function scanSeat(seatRoot = root) {
  const out = [];
  const validId = (n) => /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(n);
  for (const { name, dir } of listDirs('workspaces', seatRoot)) {
    if (!validId(name)) continue;
    const git = readGitWorktreeInfo(dir);
    const remote = git?.remoteUrl || null;
    out.push({
      id: name, name: titleOf(dir, name), kind: 'workspace', remote,
      docs_path: fs.existsSync(path.join(dir, 'design')) ? `workspaces/${name}/design` : `workspaces/${name}/docs/design`,
      github: remote ? normalizeGithubSlug(remote) : null
    });
  }
  for (const { name, dir } of listDirs('projects', seatRoot)) {
    if (!validId(name)) continue;
    out.push({ id: name, name: titleOf(dir, name), kind: 'project', remote: null, docs_path: `projects/${name}`, github: null });
  }
  return out;
}

/** Context cards from the brain: slug, name, mission, and whether the desk is loaded. */
export function scanContexts(seatRoot = root) {
  const src = path.join(seatRoot, 'brain', '__source');
  if (!fs.existsSync(src)) return [];
  let active = [];
  try { active = JSON.parse(fs.readFileSync(path.join(seatRoot, '.brain', 'active.json'), 'utf8')).active || []; } catch {}
  const out = [];
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith('.md')) continue;
    let head = '';
    try { head = fs.readFileSync(path.join(src, f), 'utf8').slice(0, 4000); } catch { continue; }
    const fm = head.match(/^---\n([\s\S]*?)\n---/);
    if (!fm || !/^entity:\s*context\s*$/m.test(fm[1])) continue;
    if (/^status:\s*(archived|superseded)\s*$/m.test(fm[1])) continue;
    const slug = f.slice(0, -3);
    if (slug === 'focus') continue; // the reserved always-active desk is not a context to list
    const name = fm[1].match(/^\s+name:\s*(.+)$/m)?.[1]?.trim() || slug;
    const mission = fm[1].match(/^\s+mission:\s*(.+)$/m)?.[1]?.trim() || fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() || '';
    out.push({ slug, name, mission, active: active.includes(slug) });
  }
  return out.sort((a, b) => (b.active - a.active) || a.slug.localeCompare(b.slug));
}

async function request(env, method, p, body) {
  const res = await fetch(`${env.url.replace(/\/$/, '')}${p}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
}

async function main() {
  const env = readEnv();
  const found = scanSeat(root);
  const contexts = scanContexts(root);
  log(`seat ${env.seat || '?'}: ${found.length} folder(s), ${contexts.length} context(s)`);
  for (const f of found) log(`  ${f.kind === 'workspace' ? 'ws ' : 'prj'} ${f.id}  ${f.remote || '(local)'}`);
  for (const c of contexts) log(`  ${c.active ? '●' : '○'}   ${c.slug}  ${c.mission}`);
  if (dryRun) return;
  if (!env.url || !env.token || !env.seat) { log('sync-workspaces: no board env (harness/falcon.env); skipped'); return; }

  let catalogIds = new Set();
  try {
    const cat = await request(env, 'GET', '/api/v1/projects');
    for (const p of (cat.data?.projects || [])) catalogIds.add(p.id);
  } catch {}

  let n = 0, errors = 0;
  for (const f of found) {
    const r = await request(env, 'POST', `/api/v1/admin/agents/${env.seat}/projects`, {
      id: f.id, name: f.name, kind: f.kind, remote: f.remote, docs_path: f.docs_path
    });
    if (!r.ok) { errors++; log(`  ! ${f.id}: ${r.status} ${r.text.slice(0, 120)}`); continue; }
    n++;
    if (f.kind === 'workspace' && f.github && !catalogIds.has(f.id)) {
      const c = await request(env, 'POST', '/api/v1/projects', { id: f.id, name: f.name, github_url: f.remote, tags: [] });
      if (c.ok) { catalogIds.add(f.id); log(`  + catalog ${f.id}`); }
      else if (c.status !== 409 && c.status !== 400) log(`  ! catalog ${f.id}: ${c.status}`);
    }
  }
  const cr = await request(env, 'PATCH', `/api/v1/admin/agents/${env.seat}`, { contexts });
  if (!cr.ok) { errors++; log(`  ! contexts: ${cr.status} ${cr.text.slice(0, 120)}`); }
  log(`synced ${n}/${found.length} folders, ${contexts.length} contexts${errors ? `, ${errors} failed` : ''}`);
  if (errors) process.exitCode = 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(err => { console.error(`sync-workspaces: ${err.message}`); process.exit(1); });
}
