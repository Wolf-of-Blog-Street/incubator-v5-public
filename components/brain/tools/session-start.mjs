#!/usr/bin/env node
/**
 * session-start — the SessionStart hook body. Prints, for the agent's opening context:
 * the contexts roster (● = loaded), which working-memory card serves, its body, and the
 * one instruction: load a context (context-load) or stay on default, asking the operator when
 * it is not obvious. Never fails the session: any error prints a one-line note instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAIN = path.join(__dirname, '..', 'engine', 'brain.mjs');
const WM = path.join(__dirname, 'wm.mjs');
const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

const run = (file, args) => {
  const r = spawnSync(process.execPath, [file, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, BRAIN_ROOT: root } });
  return (r.stdout || '').trim() || (r.stderr || '').trim();
};

if (!fs.existsSync(path.join(root, 'brain', '__source'))) {
  console.log('brain: no brain/__source here; this seat has no memory. Nothing to load.');
  process.exit(0);
}

// Report this seat's workspaces/ and projects/ to the board (quiet, best effort, capped).
try {
  spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'board', 'tools', 'sync-workspaces.mjs'), '--root', root], { cwd: root, encoding: 'utf8', timeout: 8000 });
} catch {}

const contexts = run(BRAIN, ['contexts']);
const which = run(WM, ['which']);
const body = run(WM, ['show']);
const loaded = /●/.test(contexts);
const anyContexts = !/\(no contexts/.test(contexts);
const src = path.join(root, 'brain', '__source');
const mtime = f => { try { return fs.statSync(path.join(src, f)).mtimeMs; } catch { return 0; } };
const defaultAge = mtime('working-memory.md');
const newestWm = fs.readdirSync(src).filter(f => f.startsWith('wm-')).map(mtime).reduce((a, b) => Math.max(a, b), 0);
const defaultStale = defaultAge && newestWm && defaultAge < newestWm;

console.log('# Brain at session start\n');
console.log('## Contexts\n' + contexts);
console.log(`${loaded ? '  ' : '● '}default — the card that serves when no context is loaded (load it by dropping every loaded context; see context-load)\n`);
console.log('## Working memory serving now\n' + which + '\n');
console.log(body + '\n');
if (defaultStale && !loaded) console.log('Note: the default card is older than the newest context card. It may be a leftover from before contexts existed. Rewrite it through wm.mjs update --event load --context default with a digest of what belongs to no context.\n');
// An equipped desk lists skill or tool members; an empty one shows only its working memory.
const loadedSlugs = [...contexts.matchAll(/^● ([a-zA-Z0-9][a-zA-Z0-9_-]*)/gm)].map(m => m[1]);
const bare = loadedSlugs.filter(slug => {
  const desk = run(BRAIN, ['context', slug]);
  return !/^\s*(skill|tool)\b/mi.test(desk) && !/\b(skill|tool)s?:/i.test(desk);
});
if (bare.length) console.log(`Note: ${bare.join(', ')} ${bare.length === 1 ? 'has' : 'have'} no skills or tools wired. An empty desk hides all equipment in search. Wire what serves this world (HARNESS.md 5, "A context is equipped, not just minted").\n`);

console.log('## What to do first');
if (loaded) {
  console.log('A context is loaded. Work in it. If the task in front of you belongs to a different world, use the context-load skill to switch (drop the old one after brain-session-end).');
} else if (anyContexts) {
  console.log('No context is loaded; the default working memory is serving. Contexts exist. If the task names a world, load it with the context-load skill. If it is not obvious which, ask the operator: list the contexts above and offer "stay on default". If you just dropped to default, the default card must be rewritten now: printf \'%s\' "$DIGEST" | node harness/components/brain/tools/wm.mjs update --event load --context default');
} else {
  console.log('No contexts exist yet on this seat. Work on the default working memory. When a duty of this seat becomes clear (see its roster notes: node harness/components/board/tools/fleet.mjs notes <seat>), mint a context for it with the context-load skill.');
}
console.log('Working memory is per context and is only ever rewritten through Opus 4.5 (wm.mjs update). Never edit the card by hand.');
console.log('Brain CLI: run `node harness/engine/brain.mjs <verb> --help` before any verb you have not used this session. Cheat sheet: HARNESS.md section 5.');
console.log(`
## Quick commands (B = node harness/engine/brain.mjs · WM = node harness/components/brain/tools/wm.mjs)
  B contexts                       every context, ● = loaded (the list above)
  B context <slug>                 load a desk and print its members; B context --drop <slug> | --drop --all
  B relations <slug>               a card's edges with whys: walk these before you search
  B get <slug> --body              one card in full
  B search "<keywords>"            last resort, keywords not sentences; a hit the graph missed means a missing edge
  WM which · WM show               which working-memory card serves, and its text
  printf '%s' "$DIGEST" | WM update --event load|change|end|kickoff [--context <slug>|default]   rewrite it through Opus 4.5
  (change = something the next agent must know just changed; run it in the same turn, never "later")`);

// Fleet chat: every session that comes online registers who it is and what it works on, so every
// agent can find it (chat who) and message it (chat say). Best effort: no chat service, no block.
try {
  let hook = {};
  try { if (!process.stdin.isTTY) hook = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
  const model = hook.model?.id || (typeof hook.model === 'string' ? hook.model : '') || process.env.ANTHROPIC_MODEL || 'claude';
  const CHAT = path.join(__dirname, '..', '..', 'chat', 'chat.mjs');
  if (fs.existsSync(CHAT)) {
    const reg = extra => spawnSync(process.execPath, [CHAT, 'register', '--type', 'claude', '--model', model, '--context', loadedSlugs.join(',') || 'default', ...extra], { cwd: root, encoding: 'utf8', timeout: 5000 });
    // This tab keeps its handle; a new tab takes "lead" when it is free, else a handle of its own.
    let r = reg([]);
    if (/held by another tab/.test(r.stderr || '')) r = reg(['--handle', `tab-${String(process.env.CMUX_SURFACE_ID || Date.now()).slice(0, 4).toLowerCase()}`]);
    const out = (r.stdout || '').trim() + (/tab-/.test(r.stdout || '') ? '\nThis session got a placeholder handle. Register again with a real one: chat register --handle <name> --type claude --model <model> --context <slug>' : '');
    console.log(`\n## Fleet chat\n${out || 'chat: the chat service is not running; register later with: node harness/components/chat/chat.mjs register --type claude --model <model>'}`);
    console.log('Message any agent: node harness/components/chat/chat.mjs say @seat[/context] "..." · who is online and every seat\'s contexts: chat who · after you load or switch a context: chat register --type claude --model <model> --context <slug>');
  }
} catch {}
