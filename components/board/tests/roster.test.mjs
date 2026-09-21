import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openRoster, AgentNotFoundError, ProjectNotFoundError, validateAgentId } from '../engine/roster.mjs';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'roster-test-'));
}

test('roster engine: agent ID validation prevents directory traversal', () => {
  assert.doesNotThrow(() => validateAgentId('manager-pm'));
  assert.doesNotThrow(() => validateAgentId('agent_123'));
  assert.doesNotThrow(() => validateAgentId('seat-dev-1'));

  assert.throws(() => validateAgentId('../escape'), /Invalid agent ID/);
  assert.throws(() => validateAgentId('/root/dir'), /Invalid agent ID/);
  assert.throws(() => validateAgentId('agent;rm -rf'), /Invalid agent ID/);
  assert.throws(() => validateAgentId(''), /Invalid agent ID/);
  assert.throws(() => validateAgentId(null), /Invalid agent ID/);
});

test('roster engine: initializes multi-agent roster and isolates SQLite databases', () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');

  const rosterConfig = {
    default_agent: 'agent-alpha',
    agents: [
      {
        id: 'agent-alpha',
        name: 'Agent Alpha (Pair)',
        icon: '🛡️',
        color: 'cyan',
        tags: ['pair']
      },
      {
        id: 'agent-beta',
        name: 'Agent Beta (Worker)',
        icon: '⚡',
        color: 'amber',
        tags: ['worker']
      }
    ]
  };

  const roster = openRoster({ config: rosterConfig, boardsDir });

  try {
    assert.strictEqual(roster.hasAgent('agent-alpha'), true);
    assert.strictEqual(roster.hasAgent('agent-beta'), true);
    assert.strictEqual(roster.hasAgent('agent-unknown'), false);
    assert.strictEqual(roster.getDefaultAgentId(), 'agent-alpha');

    // Retrieve agent metadata
    const alphaMeta = roster.getAgent('agent-alpha');
    assert.strictEqual(alphaMeta.id, 'agent-alpha');
    assert.strictEqual(alphaMeta.name, 'Agent Alpha (Pair)');

    // 1. Mutate Agent Alpha board
    const boardAlpha = roster.getBoard('agent-alpha');
    const idA1 = boardAlpha.addItem({
      title: 'Alpha task 1',
      track: 'core',
      status: 'in-progress'
    });
    assert.strictEqual(idA1, 1);

    // 2. Inspect Agent Beta board — MUST BE EMPTY (100% tenant isolation)
    const boardBeta = roster.getBoard('agent-beta');
    const betaTasksBefore = boardBeta.listItems({});
    assert.strictEqual(betaTasksBefore.length, 0, 'Beta board must be isolated from Alpha');

    // 3. Mutate Agent Beta board
    const idB1 = boardBeta.addItem({
      title: 'Beta task 1',
      track: 'feature',
      status: 'done'
    });
    assert.strictEqual(idB1, 1); // Auto-increment starts at 1 in isolated DB

    // 4. Verify Alpha still only has Alpha task
    const alphaTasks = boardAlpha.listItems({});
    assert.strictEqual(alphaTasks.length, 1);
    assert.strictEqual(alphaTasks[0].title, 'Alpha task 1');

    // 5. Test aggregated listAgents() rollup metrics
    const agentsList = roster.listAgents();
    assert.strictEqual(agentsList.length, 2);

    const alphaSummary = agentsList.find((a) => a.id === 'agent-alpha');
    assert.strictEqual(alphaSummary.stats.totalTasks, 1);
    assert.strictEqual(alphaSummary.stats.inProgressTasks, 1);
    assert.strictEqual(alphaSummary.stats.doneTasks, 0);

    const betaSummary = agentsList.find((a) => a.id === 'agent-beta');
    assert.strictEqual(betaSummary.stats.totalTasks, 1);
    assert.strictEqual(betaSummary.stats.doneTasks, 1);
    assert.strictEqual(betaSummary.stats.inProgressTasks, 0);
  } finally {
    roster.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('roster engine: dynamic agent registration and unknown agent errors', () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');

  const roster = openRoster({
    config: { default_agent: 'agent-1', agents: [{ id: 'agent-1', name: 'Agent 1' }] },
    boardsDir
  });

  try {
    assert.throws(() => roster.getAgent('nonexistent'), AgentNotFoundError);
    assert.throws(() => roster.getBoard('nonexistent'), AgentNotFoundError);

    // Register a new agent dynamically
    roster.registerAgent({
      id: 'agent-2',
      name: 'Agent 2 (Dynamic)',
      icon: '🦅'
    });

    assert.strictEqual(roster.hasAgent('agent-2'), true);
    const board2 = roster.getBoard('agent-2');
    const id = board2.addItem({ title: 'Dynamic task' });
    assert.strictEqual(id, 1);
  } finally {
    roster.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('roster engine: agent notes are stored, updated, listed, and persisted', () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');
  const rosterPath = path.join(tmpDir, 'roster.json');

  const roster = openRoster({
    config: { default_agent: 'agent-1', agents: [{ id: 'agent-1', name: 'Agent 1', notes: 'initial' }] },
    boardsDir,
    rosterPath
  });

  try {
    assert.strictEqual(roster.getAgent('agent-1').notes, 'initial');
    roster.updateAgent('agent-1', { notes: 'handles all the things' });
    assert.strictEqual(roster.getAgent('agent-1').notes, 'handles all the things');
    assert.strictEqual(roster.listAgents().find(a => a.id === 'agent-1').notes, 'handles all the things');
    roster.updateAgent('agent-1', { notes: null });
    assert.strictEqual(roster.getAgent('agent-1').notes, '');

    roster.updateAgent('agent-1', { notes: 'persisted' });
    const onDisk = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    assert.strictEqual(onDisk.agents.find(a => a.id === 'agent-1').notes, 'persisted');
  } finally {
    roster.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('sync-workspaces: the folder decides: workspaces/ are workspaces (remote recorded when present), projects/ are projects', async () => {
  const { scanSeat } = await import('../tools/sync-workspaces.mjs');
  const tmp = createTempDir();
  try {
    fs.mkdirSync(path.join(tmp, 'workspaces/repo-a/.git'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'workspaces/repo-a/.git/config'), '[remote "origin"]\n\turl = https://github.com/org/repo-a.git\n');
    fs.writeFileSync(path.join(tmp, 'workspaces/repo-a/README.md'), '# Repo A\n');
    fs.mkdirSync(path.join(tmp, 'workspaces/loose'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'workspaces/_scratch'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'workspaces/INDEX.md'), '');
    fs.mkdirSync(path.join(tmp, 'projects/local-thing'), { recursive: true });
    const found = scanSeat(tmp);
    const byId = Object.fromEntries(found.map(f => [f.id, f]));
    assert.deepEqual(Object.keys(byId).sort(), ['local-thing', 'loose', 'repo-a']);
    assert.equal(byId['repo-a'].kind, 'workspace');
    assert.equal(byId['repo-a'].name, 'Repo A');
    assert.equal(byId['repo-a'].remote, 'https://github.com/org/repo-a.git');
    assert.equal(byId['loose'].kind, 'workspace');
    assert.equal(byId['loose'].remote, null);
    assert.equal(byId['local-thing'].kind, 'project');

    const roster = openRoster({ config: { default_agent: 'a1', agents: [{ id: 'a1', name: 'A1' }] }, boardsDir: path.join(tmp, 'boards') });
    try {
      roster.allocateProject('a1', { id: 'repo-a', name: 'Repo A', kind: 'workspace', remote: 'https://github.com/org/repo-a.git' });
      roster.allocateProject('a1', { id: 'local-thing', kind: 'project' });
      const ps = roster.getProjects('a1');
      assert.equal(ps.find(p => p.id === 'repo-a').kind, 'workspace');
      assert.equal(ps.find(p => p.id === 'repo-a').remote, 'https://github.com/org/repo-a.git');
      assert.equal(ps.find(p => p.id === 'local-thing').kind, 'project');
      assert.equal(ps.find(p => p.id === 'default').kind, 'workspace', 'existing records default to workspace');
      assert.equal(ps.find(p => p.id === 'local-thing').board, null, 'a local project has no board');
      assert.throws(() => roster.getBoard('a1', 'local-thing'), /no board/);
      assert.ok(roster.getBoard('a1', 'repo-a'), 'a workspace has a board');
      const listed = roster.listAgents().find(a => a.id === 'a1').projects;
      assert.equal(listed.find(p => p.id === 'local-thing').stats, null);
      assert.ok(!fs.existsSync(path.join(tmp, 'boards', 'a1.local-thing.sqlite')), 'no sqlite file for a local project');
      const gone = roster.removeProject('a1', 'local-thing');
      assert.equal(gone.id, 'local-thing');
      assert.ok(!roster.getProjects('a1').some(p => p.id === 'local-thing'));
      assert.throws(() => roster.removeProject('a1', 'local-thing'), ProjectNotFoundError);
      roster.removeProject('a1', 'repo-a');
      assert.throws(() => roster.removeProject('a1', 'default'), /only project/);

      // contexts: reported from the brain, kept on the roster, bad rows dropped
      const { scanContexts } = await import('../tools/sync-workspaces.mjs');
      fs.mkdirSync(path.join(tmp, 'brain/__source'), { recursive: true });
      fs.mkdirSync(path.join(tmp, '.brain'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'brain/__source/wolf-network.md'), '---\nentity: context\ndescription: d\nprofile:\n  name: Wolf Network\n  mission: The PBN and its sites\n---\nbody\n');
      fs.writeFileSync(path.join(tmp, 'brain/__source/old.md'), '---\nentity: context\nstatus: archived\n---\n');
      fs.writeFileSync(path.join(tmp, 'brain/__source/note.md'), '---\nentity: note\n---\n');
      fs.writeFileSync(path.join(tmp, 'brain/__source/focus.md'), '---\nentity: context\n---\n');
      fs.writeFileSync(path.join(tmp, '.brain/active.json'), JSON.stringify({ active: ['focus', 'wolf-network'] }));
      const ctx = scanContexts(tmp);
      assert.deepEqual(ctx, [{ slug: 'wolf-network', name: 'Wolf Network', mission: 'The PBN and its sites', active: true }]);
      roster.updateAgent('a1', { contexts: [...ctx, { slug: 'bad slug!' }, 'junk'] });
      assert.deepEqual(roster.getAgent('a1').contexts, ctx);
      assert.deepEqual(roster.listAgents().find(a => a.id === 'a1').contexts, ctx);
    } finally { roster.closeAll(); }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
