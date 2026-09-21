#!/usr/bin/env node
/**
 * wm — context-aware working memory.
 *
 * One working-memory card per context, plus one default. The default (`working-memory`) is
 * the card used when no context is loaded. A context's card is `wm-<context>`, a note with an
 * in_context edge into the context.
 *
 * Every update is written by Opus 4.5 (friend lean-opus-4-5), never by the calling agent.
 * The agent supplies a digest of what it knows now; Opus rewrites the card whole.
 *
 *   wm which                       print the current working-memory slug and the context it serves
 *   wm show [--context <slug>]     print the current (or named) working-memory body
 *   wm update --event load|change|end|kickoff [--context <slug>] [--digest <file|->]
 *                                  rewrite the card through Opus 4.5 from the digest (stdin if omitted)
 *   wm prompt --event ...          print the exact prompt that would go to Opus (dry run)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dispatchFriend } from '../../friends/engine/friends.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAIN = path.join(__dirname, '..', 'engine', 'brain.mjs');
const DEFAULT_SLUG = 'working-memory';

function usage(code = 0) {
  console.log(`wm — context-aware working memory (written by Opus 4.5)

  wm which                        current working-memory slug + the context it serves
  wm show [--context <slug>]      print the current (or named) working memory; --context default = the default card
  wm update --event load|change|end|kickoff [--context <slug>] [--digest <file|->]
                                  rewrite the card through Opus 4.5 from your digest (stdin if omitted)
                                  change = something the next agent must know changed mid-session; run it then, not later
  wm prompt --event ... [...]     print the prompt that would go to Opus (dry run, no write)

The default card (working-memory) is used when no context is loaded. A loaded context uses
wm-<context>. Never edit these cards by hand; the update goes through Opus 4.5.`);
  process.exit(code);
}

function parseArgs(argv) {
  const a = { cmd: argv[0] || 'help', event: null, context: null, digest: null, root: process.cwd() };
  for (let i = 1; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--event') a.event = argv[++i];
    else if (x === '--context') a.context = argv[++i];
    else if (x === '--digest') a.digest = argv[++i];
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--help' || x === '-h') usage(0);
    else { console.error(`unknown argument: ${x}`); usage(1); }
  }
  return a;
}

function brain(root, args, input) {
  const res = spawnSync(process.execPath, [BRAIN, ...args], {
    cwd: root, encoding: 'utf8', input, env: { ...process.env, BRAIN_ROOT: root }
  });
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}

/** Loaded contexts, focus excluded, in load order. */
function activeContexts(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'active.json'), 'utf8'));
    return (Array.isArray(parsed?.active) ? parsed.active : []).filter(s => s && s !== 'focus');
  } catch { return []; }
}

/** Which card serves now: the named context, else the most recently loaded, else the default. */
function resolveTarget(root, contextFlag) {
  const active = activeContexts(root);
  const context = contextFlag === 'default' ? null : (contextFlag || active[active.length - 1] || null);
  return { context, slug: context ? `wm-${context}` : DEFAULT_SLUG, active };
}

function readBody(root, slug) {
  const p = path.join(root, 'brain', '__source', `${slug}.md`);
  if (!fs.existsSync(p)) return '';
  const raw = fs.readFileSync(root && p, 'utf8');
  const m = raw.match(/^---\n[\s\S]*?\n---\n?/);
  return (m ? raw.slice(m[0].length) : raw).trim();
}

function ensureCard(root, target) {
  const p = path.join(root, 'brain', '__source', `${target.slug}.md`);
  if (fs.existsSync(p)) return;
  const desc = target.context ? `Working memory for the ${target.context} context` : 'Default working memory (no context loaded)';
  const r = brain(root, ['new', '--entity', 'note', '--slug', target.slug, '--description', desc]);
  if (!r.ok) throw new Error(`could not create ${target.slug}: ${r.err || r.out}`);
  if (target.context) {
    brain(root, ['link', target.slug, '--verb', 'in_context', '--to', target.context, '--why', 'the working memory this context loads with']);
  }
}

const EVENT_TEXT = {
  load: `The agent has just LOADED this context. It may have been working on things relevant to this
context before loading it. Fold in only what from the digest a future agent in THIS context must
know; the digest may carry work that belongs to other contexts, and that stays out. Remove anything
in the current card that is no longer true or no longer matters.`,
  end: `The agent is ENDING its session in this context. Rewrite the card so the next agent can
continue without re-deriving anything. Keep what still matters, drop what is finished or stale.`,
  kickoff: `The agent is HANDING OFF this context to its next session. Rewrite the card as the clean
state of play plus the exact next actions.`,
  change: `Something CHANGED mid-session that a future agent in this context must know: a new card,
tool or reference on the desk, a fact learned, a constraint found, a state that moved. Fold the
digest in and keep everything else that still holds. This is a small, precise edit, not a fresh
draft.`
};

export function buildPrompt({ event, context, current, digest, roster = '' }) {
  const where = context ? `the "${context}" context` : 'the default working memory (no context loaded)';
  const rosterBlock = roster ? `

DESK ROSTER (what is wired into this context right now: tools, skills, references, projects; one
line each, from the brain). The card may point at these by slug so the next agent knows they exist
and what each is for; it must not repeat their bodies:
<<<
${roster}
>>>` : '';
  return `You are rewriting the working memory card for ${where}. Return the new card body only, as
Markdown, no preamble, no fences, no commentary.

${EVENT_TEXT[event]}

What working memory IS: a clean space holding everything a future agent needs to know to work in
this context without hurting itself. Things that, if the agent does not know them, will cost it:
current state of play, live constraints, gotchas, where things are, what is mid-stream, and the exact
next actions.

What working memory is NOT: a record. It is never a record. It is not a log of what happened, not a
list of decisions, not a set of laws or rules the operator once said, not a diary. The record lives in
the code and in docs/. Past work appears only when knowing it changes what the next agent does.

Rules for the rewrite:
- Rewrite the whole card. Do not append.
- Keep it short. Cut every line a future agent would not act on.
- Present tense for the state of things. Imperative for next actions.
- No "the operator decided", no "on <date> we", no rulings, no quotes of the operator.
- If the digest contradicts the current card, the digest wins; the card is the older view.
- Only what belongs to this context. Work for another world, however fresh, stays out.
- Two sections at most: "## State of play" and "## Next actions". Add a third only for gotchas.

CURRENT CARD (may be empty):
<<<
${current || '(empty)'}
>>>

DIGEST FROM THE AGENT (what it knows now):
<<<
${digest || '(none)'}
>>>${rosterBlock}`;
}

/** The desk roster for a context: the member lines from `brain context <slug>`, body excluded. */
function readRoster(root, context) {
  if (!context) return '';
  const r = brain(root, ['context', context]);
  if (!r.ok) return '';
  // Drop the header and the card body; keep the grouped member lines (they start with two spaces).
  const lines = r.out.split('\n').filter(l => (/^\s{2,}\S/.test(l) || /^[a-z]+ \(\d+\):?$/i.test(l))
    && !/^\s*\(no body/.test(l) && !/^\s{2,}wm-/.test(l));
  // Drop a group header that ended up with no members (the notes group once wm-* is removed).
  return lines.filter((l, i) => !(/^[a-z]+ \(\d+\):?$/i.test(l) && (i === lines.length - 1 || /^[a-z]+ \(\d+\):?$/i.test(lines[i + 1])))).join('\n').trim();
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.cmd === 'help') usage(0);
  const root = a.root;
  if (!fs.existsSync(path.join(root, 'brain', '__source'))) {
    console.error(`no brain/__source under ${root}; run from the seat root or pass --root`);
    process.exit(1);
  }
  const target = resolveTarget(root, a.context);

  if (a.cmd === 'which') {
    console.log(`${target.slug} (${target.context ? `context: ${target.context}` : 'default: the card that serves when no context is loaded'})`);
    if (target.active.length > 1) console.log(`loaded contexts: ${target.active.join(', ')} — using the last loaded; pass --context to choose`);
    return;
  }
  if (a.cmd === 'show') {
    const body = readBody(root, target.slug);
    console.log(`# ${target.slug}${target.context ? ` — ${target.context}` : ' — default'}\n`);
    console.log(body || '(empty — nothing recorded yet)');
    return;
  }
  if (a.cmd !== 'update' && a.cmd !== 'prompt') usage(1);
  if (!EVENT_TEXT[a.event]) { console.error('--event must be load, change, end or kickoff'); process.exit(1); }

  let digest = '';
  if (a.digest && a.digest !== '-') digest = fs.readFileSync(path.resolve(a.digest), 'utf8');
  else if (a.digest === '-' || !process.stdin.isTTY) digest = fs.readFileSync(0, 'utf8');
  digest = digest.trim();

  const current = readBody(root, target.slug);
  const roster = readRoster(root, target.context);
  const prompt = buildPrompt({ event: a.event, context: target.context, current, digest, roster });
  if (a.cmd === 'prompt') { console.log(prompt); return; }

  ensureCard(root, target);
  console.error(`wm: ${a.event} → ${target.slug} via Opus 4.5 …`);
  const report = await dispatchFriend('lean-opus-4-5', { prompt, cwd: root, noJj: true, timeoutMs: 240000 });
  // Opus sometimes leads with an H1 or a code fence; the card's heading is printed by show, so drop them.
  const body = (report.stdout || '').trim().replace(/^```[a-z]*\n([\s\S]*?)\n```$/m, '$1').replace(/^#\s+[^\n]*\n+/, '').trim();
  if (report.exitCode !== 0 || !body) {
    console.error(`wm: Opus 4.5 failed (exit ${report.exitCode}); card unchanged.\n${report.stderr || ''}`);
    process.exit(1);
  }
  // A leftover card may carry an unregistered entity (v4 wrote entity: working-memory); the brain
  // only accepts registered ones, so normalise the frontmatter to note before writing the body.
  try {
    const cardPath = path.join(root, 'brain', '__source', `${target.slug}.md`);
    const raw = fs.readFileSync(cardPath, 'utf8');
    if (/^entity:\s*(?!note\s*$)\S+/m.test(raw.split('\n---')[0] || '')) {
      fs.writeFileSync(cardPath, raw.replace(/^entity:\s*\S+.*$/m, 'entity: note'), 'utf8');
      brain(root, ['sync', '--slug', target.slug]);
    }
  } catch {}
  const w = brain(root, ['body', target.slug], body + '\n');
  if (!w.ok) { console.error(`wm: brain body failed: ${w.err || w.out}`); process.exit(1); }
  console.log(`# ${target.slug} — updated (${a.event})\n\n${body}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(err => { console.error(`wm: ${err.message}`); process.exit(1); });
}
