import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openRoster } from '../engine/roster.mjs';
import { createBoardServer } from '../api/server.mjs';
import { createBoardClient } from '../tools/client.mjs';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-isolation-test-'));
}

test('multi-agent isolation: concurrent writes, physical db isolation, and cross-tenant guardrails', async () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');
  const configDir = path.join(tmpDir, 'config');
  const rosterPath = path.join(configDir, 'roster.json');
  fs.mkdirSync(boardsDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  const operatorToken = 'master_operator_secret_999';
  const falconToken = 'agt_live_falcon_sec_111';
  const sweeperToken = 'agt_live_sweeper_sec_222';
  const managerToken = 'agt_live_manager_sec_333';

  const rosterConfig = {
    version: '5.0.0',
    default_agent: 'manager-pm',
    operator_token: operatorToken,
    manager: {
      agent_id: 'manager-pm',
      role: 'fleet-orchestrator',
      capabilities: ['provision-agent', 'audit-fleet']
    },
    agents: [
      {
        id: 'manager-pm',
        name: 'Manager PM',
        token: managerToken,
        projects: [{ id: 'default', name: 'Manager Workspace', board: 'manager-pm.default.sqlite' }]
      },
      {
        id: 'example-pa',
        name: 'Example PA',
        token: falconToken,
        projects: [{ id: 'default', name: 'Falcon Workspace', board: 'example-pa.default.sqlite' }]
      },
      {
        id: 'sweeper-bot',
        name: 'Sweeper Bot',
        token: sweeperToken,
        projects: [{ id: 'default', name: 'Sweeper Workspace', board: 'sweeper-bot.default.sqlite' }]
      }
    ]
  };

  const roster = openRoster({ config: rosterConfig, rosterPath, boardsDir });
  const server = await createBoardServer({ roster, port: 0 });

  try {
    const serverUrl = server.url;

    // 1. Instantiate 3 independent clients simulating concurrent agent seats
    const falconClient = createBoardClient({ url: serverUrl, token: falconToken, agentId: 'example-pa' });
    const sweeperClient = createBoardClient({ url: serverUrl, token: sweeperToken, agentId: 'sweeper-bot' });
    const managerClient = createBoardClient({ url: serverUrl, token: managerToken, agentId: 'manager-pm' });

    // 2. Perform concurrent parallel operations across all 3 agents
    const [t1, t2, b1] = await Promise.all([
      falconClient.addItem({ title: 'Architect event-bus bridge', track: 'core', mode: 'pair' }),
      falconClient.addItem({ title: 'Draft schema for telemetry', track: 'db', mode: 'pair' }),
      sweeperClient.addItem({ title: 'BUG: Leaked token in circular error', track: 'bug', mode: 'runner' })
    ]);

    assert.deepStrictEqual([t1, t2].sort(), [1, 2]);
    assert.strictEqual(b1, 1);

    // Update items
    await falconClient.updateItem(1, { status: 'in-progress' });
    await falconClient.updateItem(2, { status: 'done' });
    await sweeperClient.updateItem(1, { status: 'done' });
    // Sweeper logs a second active bug
    await sweeperClient.addItem({ title: 'BUG: Ongoing race condition in cache', track: 'bug', mode: 'runner' });

    // 3. Verify that each agent only sees its own tasks via client listItems
    const falconTasks = await falconClient.listItems();
    assert.strictEqual(falconTasks.length, 2);
    const falconTitles = falconTasks.map(t => t.title).sort();
    assert.deepStrictEqual(falconTitles, [
      'Architect event-bus bridge',
      'Draft schema for telemetry'
    ]);

    const sweeperTasks = await sweeperClient.listItems();
    assert.strictEqual(sweeperTasks.length, 2);
    assert.strictEqual(sweeperTasks[0].title, 'BUG: Leaked token in circular error');
    assert.strictEqual(sweeperTasks[1].title, 'BUG: Ongoing race condition in cache');

    // 4. Strict Cross-Tenant Guardrails (assertTenantAccess)
    // Example PA attempts to read Sweeper Bot's board
    const crossReadRes = await fetch(`${serverUrl}/api/v1/agents/sweeper-bot/board`, {
      headers: { 'Authorization': `Bearer ${falconToken}` }
    });
    assert.strictEqual(crossReadRes.status, 403, 'Cross-tenant board read must be forbidden');

    // Sweeper Bot attempts to mutate tasks on Example PA's board
    const crossWriteRes = await fetch(`${serverUrl}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sweeperToken}`
      },
      body: JSON.stringify({
        agent: 'example-pa',
        title: 'Malicious task injection',
        track: 'core'
      })
    });
    assert.strictEqual(crossWriteRes.status, 403, 'Cross-tenant task injection must be forbidden');

    // 5. Manager Privileges
    // Manager PM (the configured fleet manager) has access to inspect any agent's board
    const mgrReadRes = await fetch(`${serverUrl}/api/v1/agents/example-pa/board`, {
      headers: { 'Authorization': `Bearer ${managerToken}` }
    });
    assert.strictEqual(mgrReadRes.status, 200, 'Fleet manager must have access to inspect agent boards');
    const mgrFalconBoard = await mgrReadRes.json();
    assert.strictEqual(mgrFalconBoard.totalTasks, 2);
    assert.strictEqual(mgrFalconBoard.totalDone, 1);

    // Operator Token also has full administrative access
    const opStatusRes = await fetch(`${serverUrl}/api/v1/admin/fleet/status`, {
      headers: { 'Authorization': `Bearer ${operatorToken}` }
    });
    assert.strictEqual(opStatusRes.status, 200);
    const opStatus = await opStatusRes.json();
    assert.strictEqual(opStatus.totalAgents, 3);
    assert.strictEqual(opStatus.totalTasks, 4); // 2 falcon + 2 sweeper
    assert.strictEqual(opStatus.totalDone, 2);  // 1 falcon + 1 sweeper
    assert.strictEqual(opStatus.totalBugs, 1);  // 1 active open bug on sweeper

    // 6. Verify Physical Database Isolation on Disk
    // Check that physical SQLite files exist and are strictly segregated
    const falconDbPath = path.join(boardsDir, 'example-pa.default.sqlite');
    const sweeperDbPath = path.join(boardsDir, 'sweeper-bot.default.sqlite');

    assert.ok(fs.existsSync(falconDbPath), 'Falcon physical DB must exist');
    assert.ok(fs.existsSync(sweeperDbPath), 'Sweeper physical DB must exist');

    // Directly query falcon physical SQLite db
    const falconDiskDb = new DatabaseSync(falconDbPath);
    const falconRows = falconDiskDb.prepare('SELECT title FROM items ORDER BY id ASC').all();
    falconDiskDb.close();

    assert.strictEqual(falconRows.length, 2);
    const diskFalconTitles = falconRows.map(r => r.title).sort();
    assert.deepStrictEqual(diskFalconTitles, [
      'Architect event-bus bridge',
      'Draft schema for telemetry'
    ]);

    // Directly query sweeper physical SQLite db
    const sweeperDiskDb = new DatabaseSync(sweeperDbPath);
    const sweeperRows = sweeperDiskDb.prepare('SELECT title FROM items ORDER BY id ASC').all();
    sweeperDiskDb.close();

    assert.strictEqual(sweeperRows.length, 2);
    assert.strictEqual(sweeperRows[0].title, 'BUG: Leaked token in circular error');
    assert.strictEqual(sweeperRows[1].title, 'BUG: Ongoing race condition in cache');
  } finally {
    server.closeAllConnections?.();
    server.close();
    roster.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
