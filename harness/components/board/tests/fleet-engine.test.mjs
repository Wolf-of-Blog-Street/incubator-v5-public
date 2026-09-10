import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openRoster, AgentNotFoundError, validateAgentId } from '../engine/roster.mjs';
import { createBoardServer } from '../api/server.mjs';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-engine-test-'));
}

test('fleet engine: manager schema, registration, token generation, and persistence', () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');
  const rosterPath = path.join(tmpDir, 'config', 'roster.json');

  const rosterConfig = {
    version: '5.0.0',
    default_agent: 'manager-pm',
    operator_token: 'op_secret_master_token_123',
    manager: {
      agent_id: 'manager-pm',
      role: 'fleet-orchestrator',
      capabilities: ['provision-agent', 'install-harness', 'audit-fleet']
    },
    agents: [
      {
        id: 'manager-pm',
        name: 'Manager PM',
        icon: '🛡️',
        color: 'cyan',
        tags: ['manager', 'pair'],
        token: 'agt_live_manager_123'
      }
    ]
  };

  const roster = openRoster({ config: rosterConfig, rosterPath, boardsDir });

  try {
    // 1. Manager Inspection
    const mgr = roster.getManager();
    assert.strictEqual(mgr.agent_id, 'manager-pm');
    assert.strictEqual(mgr.role, 'fleet-orchestrator');
    assert.deepStrictEqual(mgr.capabilities, ['provision-agent', 'install-harness', 'audit-fleet']);

    // 2. Register new agent with auto-generated token
    const regResult = roster.registerAgent({
      id: 'example-pa',
      name: 'Example PA',
      icon: '🦅',
      color: 'cyan',
      tags: ['architect', 'design']
    }, true);

    assert.strictEqual(regResult.agent.id, 'example-pa');
    assert.ok(regResult.token, 'Must return plain token on auto-generation');
    assert.ok(regResult.token.startsWith('agt_live_example-pa_'));
    assert.strictEqual(roster.hasAgent('example-pa'), true);

    // Verify token can authenticate
    const authSuccess = roster.authenticate(`Bearer ${regResult.token}`);
    assert.strictEqual(authSuccess.authenticated, true);
    assert.strictEqual(authSuccess.agentId, 'example-pa');

    // 3. Allocate a new project
    const projResult = roster.allocateProject('example-pa', {
      id: 'telemetry-svc',
      name: 'Telemetry Service',
      board: 'falcon.telemetry.sqlite'
    });
    assert.strictEqual(projResult.id, 'telemetry-svc');
    assert.strictEqual(projResult.name, 'Telemetry Service');

    const falconProjects = roster.getProjects('example-pa');
    assert.strictEqual(falconProjects.length, 2); // default + telemetry-svc

    // 4. Token Rotation
    const rotated = roster.rotateAgentToken('example-pa');
    assert.ok(rotated.token.startsWith('agt_live_example-pa_'));
    assert.notStrictEqual(rotated.token, regResult.token);

    // Old token should now fail
    const oldAuth = roster.authenticate(`Bearer ${regResult.token}`);
    assert.strictEqual(oldAuth.authenticated, false);

    // New token must succeed
    const newAuth = roster.authenticate(`Bearer ${rotated.token}`);
    assert.strictEqual(newAuth.authenticated, true);
    assert.strictEqual(newAuth.agentId, 'example-pa');

    // 5. Revocation
    const revoked = roster.revokeAgent('example-pa');
    assert.strictEqual(revoked, true);
    assert.strictEqual(roster.hasAgent('example-pa'), false);
    assert.throws(() => roster.getAgent('example-pa'), AgentNotFoundError);

    // 6. Verify file persistence on disk
    assert.strictEqual(fs.existsSync(rosterPath), true);
    const persisted = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    assert.strictEqual(persisted.manager.agent_id, 'manager-pm');
    assert.strictEqual(persisted.agents.length, 1);
    assert.strictEqual(persisted.agents[0].id, 'manager-pm');
  } finally {
    roster.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('fleet engine: REST admin API routes enforce security and perform fleet ops', async () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');
  const rosterPath = path.join(tmpDir, 'config', 'roster.json');
  const opToken = 'master_operator_token_xyz';

  const rosterConfig = {
    version: '5.0.0',
    default_agent: 'manager-pm',
    operator_token: opToken,
    manager: {
      agent_id: 'manager-pm',
      role: 'fleet-orchestrator',
      capabilities: ['provision-agent']
    },
    agents: [
      {
        id: 'manager-pm',
        name: 'Manager PM',
        token: 'agt_live_manager_token'
      },
      {
        id: 'worker-bob',
        name: 'Worker Bob',
        token: 'agt_live_bob_token'
      }
    ]
  };

  const roster = openRoster({ config: rosterConfig, rosterPath, boardsDir });
  const server = await createBoardServer({ roster, port: 0 });

  try {
    const baseUrl = server.url;

    // 1. Unauthenticated call to /api/v1/admin/manager must fail (403)
    const unauthRes = await fetch(`${baseUrl}/api/v1/admin/manager`);
    assert.strictEqual(unauthRes.status, 403);

    // 2. Worker Bob (non-manager, non-operator) must fail (403)
    const bobRes = await fetch(`${baseUrl}/api/v1/admin/manager`, {
      headers: { 'Authorization': 'Bearer agt_live_bob_token' }
    });
    assert.strictEqual(bobRes.status, 403);

    // 3. Manager (manager-pm) gets access
    const mgrRes = await fetch(`${baseUrl}/api/v1/admin/manager`, {
      headers: { 'Authorization': 'Bearer agt_live_manager_token' }
    });
    assert.strictEqual(mgrRes.status, 200);
    const mgrData = await mgrRes.json();
    assert.strictEqual(mgrData.agent_id, 'manager-pm');

    // 4. Operator token gets access to register new agent
    const regRes = await fetch(`${baseUrl}/api/v1/admin/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${opToken}`
      },
      body: JSON.stringify({
        id: 'sweeper-bot',
        name: 'Bug Sweeper Bot',
        tags: ['sweeper']
      })
    });
    assert.strictEqual(regRes.status, 201);
    const regData = await regRes.json();
    assert.strictEqual(regData.agent.id, 'sweeper-bot');
    assert.ok(regData.token.startsWith('agt_live_sweeper-bot_'));

    // 5. Operator checks fleet status
    const statusRes = await fetch(`${baseUrl}/api/v1/admin/fleet/status`, {
      headers: { 'Authorization': `Bearer ${opToken}` }
    });
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.status, 'healthy');
    assert.strictEqual(statusData.totalAgents, 3); // manager-pm, worker-bob, sweeper-bot

    // 6. Rotate token via admin route
    const rotateRes = await fetch(`${baseUrl}/api/v1/admin/agents/sweeper-bot/token/rotate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${opToken}` }
    });
    assert.strictEqual(rotateRes.status, 200);
    const rotateData = await rotateRes.json();
    assert.notStrictEqual(rotateData.token, regData.token);

    // 7. Revoke agent via admin route
    const delRes = await fetch(`${baseUrl}/api/v1/admin/agents/sweeper-bot`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${opToken}` }
    });
    assert.strictEqual(delRes.status, 200);

    const postDelStatus = await fetch(`${baseUrl}/api/v1/admin/fleet/status`, {
      headers: { 'Authorization': `Bearer ${opToken}` }
    });
    const postDelData = await postDelStatus.json();
    assert.strictEqual(postDelData.totalAgents, 2);
  } finally {
    server.close();
    roster.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
