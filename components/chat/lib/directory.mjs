// The directory: every seat on this machine and every context in its brain, read from the brains themselves.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const AGENTS_ROOT = process.env.CHAT_AGENTS_ROOT || path.join(os.homedir(), 'Projects', 'agents');

/** Seat folders: a folder with harness/falcon.env, up to four levels under the agents root. */
export function findSeats(root = AGENTS_ROOT, depth = 4) {
  const out = [];
  const walk = (dir, d) => {
    if (fs.existsSync(path.join(dir, 'harness', 'falcon.env'))) { out.push(dir); return; }
    if (d === 0) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_') || ['node_modules', 'workspaces', 'projects', 'harness'].includes(e.name)) continue;
      walk(path.join(dir, e.name), d - 1);
    }
  };
  walk(root, depth);
  return out;
}

/** The seat id a seat folder is known by on the board: FALCON_AGENT_ID in harness/falcon.env, else the folder name. */
export function seatId(dir) {
  try {
    const m = fs.readFileSync(path.join(dir, 'harness', 'falcon.env'), 'utf8').match(/^\s*(?:export\s+)?FALCON_AGENT_ID\s*=\s*["']?([^"'\s]+)/m);
    if (m) return m[1];
  } catch {}
  return path.basename(dir);
}

/** Context lines from brain contexts: "● slug — name: mission" when loaded, "  slug — ..." when not. "focus" is the brain's own bubble, not a world. */
export function parseContexts(out) {
  return String(out).split('\n').map(l => l.match(/^([●○]|\s)\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s+—\s+(.*)$/)).filter(Boolean)
    .map(m => { const i = m[3].indexOf(': '); return { slug: m[2], name: (i > 0 ? m[3].slice(0, i) : m[3]).trim(), mission: i > 0 ? m[3].slice(i + 2).trim() : '', loaded: m[1] === '●' }; })
    .filter(c => c.slug !== 'focus');
}

const run = (dir) => new Promise(res => execFile(process.execPath, [path.join(dir, 'harness', 'engine', 'brain.mjs'), 'contexts'],
  { cwd: dir, timeout: 20000, env: { ...process.env, BRAIN_ROOT: dir } }, (_e, stdout) => res(stdout || '')));

/** Build the directory: [{ seat, dir, contexts }]. */
export async function buildDirectory(root = AGENTS_ROOT) {
  const seats = findSeats(root);
  return Promise.all(seats.map(async dir => ({ seat: seatId(dir), dir, contexts: parseContexts(await run(dir)) })));
}
