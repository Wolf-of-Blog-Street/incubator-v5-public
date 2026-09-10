import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openRoster, AgentNotFoundError, validateAgentId } from '../engine/roster.mjs';

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
