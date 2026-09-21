import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRAIN_SCRIPT = path.resolve(__dirname, '../engine/brain.mjs');

test('brain engine initializes, creates nodes, and retrieves records', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-brain-test-'));

  try {
    // 1. Initialize brain
    fs.mkdirSync(path.join(tmpHome, 'brain/__source'), { recursive: true });
    execFileSync(process.execPath, [BRAIN_SCRIPT, 'reindex', '--root', tmpHome], { encoding: 'utf8' });

    // 2. Create a node
    const createOut = execFileSync(
      process.execPath,
      [
        BRAIN_SCRIPT,
        'new',
        '--root',
        tmpHome,
        '--entity',
        'note',
        '--slug',
        'my-task',
        '--description',
        'Testing incubator-v5 brain integration',
      ],
      { encoding: 'utf8' }
    );
    assert.match(createOut, /created my-task/);

    // 3. List nodes
    const listOut = execFileSync(
      process.execPath,
      [BRAIN_SCRIPT, 'list', '--root', tmpHome],
      { encoding: 'utf8' }
    );
    assert.match(listOut, /my-task/);
    assert.match(listOut, /Testing incubator-v5 brain integration/);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('wm: default card when no context, wm-<context> when loaded; prompt carries the not-a-record rules', async () => {
  const { buildPrompt } = await import('../tools/wm.mjs');
  const { spawnSync } = await import('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-'));
  const wm = (args, input) => spawnSync(process.execPath, [new URL('../tools/wm.mjs', import.meta.url).pathname, ...args, '--root', tmp], { encoding: 'utf8', input: input ?? '' });
  try {
    fs.mkdirSync(path.join(tmp, 'brain/__source'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'brain/__source/working-memory.md'), '---\nentity: note\n---\n## State of play\ndefault body\n');
    assert.match(wm(['which']).stdout, /^working-memory \(default/);
    assert.match(wm(['show']).stdout, /default body/);

    fs.mkdirSync(path.join(tmp, '.brain'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.brain/active.json'), JSON.stringify({ active: ['focus', 'wolf-network'] }));
    assert.match(wm(['which']).stdout, /^wm-wolf-network \(context: wolf-network\)/);
    assert.match(wm(['show']).stdout, /empty/);
    assert.match(wm(['which', '--context', 'other']).stdout, /^wm-other/);
    assert.match(wm(['which', '--context', 'default']).stdout, /^working-memory \(default/);
    assert.match(wm(['show', '--context', 'default']).stdout, /default body/);

    const dry = wm(['prompt', '--event', 'load'], 'digest text').stdout;
    assert.match(dry, /never a record/);
    assert.match(dry, /digest text/);
    assert.match(dry, /Only what belongs to this context/);
    assert.equal(wm(['prompt', '--event', 'bogus']).status, 1);

    // a leftover card with an unregistered entity is normalised before the body is written
    fs.writeFileSync(path.join(tmp, 'brain/__source/working-memory.md'), '---\nentity: working-memory\ndescription: old\n---\nold body\n');
    const src = fs.readFileSync(new URL('../tools/wm.mjs', import.meta.url), 'utf8');
    assert.match(src, /entity: note/);
    assert.match(src, /brain\(root, \['sync', '--slug', target\.slug\]\)/);

    const p = buildPrompt({ event: 'end', context: null, current: 'cur', digest: 'dig' });
    assert.match(p, /default working memory/);
    assert.match(p, /ENDING its session/);
    assert.doesNotMatch(p, /DESK ROSTER/);
    const pc = buildPrompt({ event: 'change', context: 'wolf-network', current: 'cur', digest: 'dig', roster: 'tool (1):\n  deploy-wobs — rsync the site' });
    assert.match(pc, /CHANGED mid-session/);
    assert.match(pc, /DESK ROSTER[\s\S]*deploy-wobs/);
    assert.equal(wm(['prompt', '--event', 'change'], 'x').status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('search: every term hits alone but the AND is empty → rank by coverage, never a single-word sweep', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-brain-search-'));
  const brain = (...args) => execFileSync(process.execPath, [BRAIN_SCRIPT, ...args, '--root', tmpHome], { encoding: 'utf8' });
  try {
    fs.mkdirSync(path.join(tmpHome, 'brain/__source'), { recursive: true });
    brain('reindex');
    const mk = (slug, desc) => brain('new', '--entity', 'note', '--slug', slug, '--description', desc);
    mk('nhb-bible-offer-learnings', 'nhb bible offer learnings from the launch');
    mk('bible-apps-market', 'bible apps market research');
    mk('bible-reading-plan', 'bible reading plan for the offer page');
    mk('idea-list-one', 'ideas for the next campaign');
    mk('idea-list-two', 'more ideas about growth');
    const out = brain('search', 'nhb bible offer ideas');
    assert.match(out, /^search .*: total 0/m, 'the full AND header stays honest');
    assert.match(out, /best match .*ranked by terms matched of 4/, `expected a coverage-ranked retry:\n${out}`);
    const first = out.split('\n').find(l => /^\s+\d\/4\s/.test(l));
    assert.match(first, /^\s+3\/4\s+nhb-bible-offer-learnings/, `expected the 3-of-4 card first:\n${out}`);
    assert.doesNotMatch(out, /reduced query "nhb"/, 'no single-word collapse');
    assert.doesNotMatch(out, /try fewer or different words/);
    const direct = brain('search', 'nhb offer');
    assert.match(direct, /total 1, shown 1/, 'the AND path is untouched');
    assert.doesNotMatch(direct, /best match/);
    const control = brain('search', 'zxqv wqpl');
    assert.match(control, /try fewer or different words/);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
