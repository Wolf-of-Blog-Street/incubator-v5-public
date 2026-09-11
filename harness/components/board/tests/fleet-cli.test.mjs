import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openRoster } from '../engine/roster.mjs';
import { createBoardServer } from '../api/server.mjs';

const pExec = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../tools/fleet.mjs');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-fleet-cli-test-'));
}

test('fleet CLI: local mode manages agents, projects, and token lifecycle', async () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');
  const rosterPath = path.join(tmpDir, 'config', 'roster.json');
  fs.mkdirSync(boardsDir, { recursive: true });
  fs.mkdirSync(path.dirname(rosterPath), { recursive: true });

  const initialRoster = {
    version: '5.0.0',
    default_agent: 'manager-pm',
    manager: {
      agent_id: 'manager-pm',
      role: 'fleet-orchestrator',
      capabilities: ['provision-agent', 'audit-fleet']
    },
    agents: [
      {
        id: 'manager-pm',
        name: 'Manager PM',
        token: 'agt_live_manager_root_token',
        projects: [
          { id: 'default', name: 'Manager Master', board: 'manager-pm.default.sqlite' }
        ]
      }
    ]
  };

  fs.writeFileSync(rosterPath, JSON.stringify(initialRoster, null, 2), 'utf8');

  try {
    // 1. List fleet
    const { stdout: listOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'list', '--roster', rosterPath, '--boards-dir', boardsDir]
    );
    assert.match(listOut, /Incubator v5 Fleet Roster/);
    assert.match(listOut, /Manager PM \(manager-pm\)/);
    assert.match(listOut, /Manager: manager-pm/);

    // List with --json
    const { stdout: listJsonOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'list', '--roster', rosterPath, '--boards-dir', boardsDir, '--json']
    );
    const parsedList = JSON.parse(listJsonOut);
    assert.strictEqual(parsedList.agents.length, 1);
    assert.strictEqual(parsedList.manager.agent_id, 'manager-pm');

    // 2. Status
    const { stdout: statusOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'status', '--roster', rosterPath, '--boards-dir', boardsDir]
    );
    assert.match(statusOut, /Fleet Status: \[HEALTHY\]/);
    assert.match(statusOut, /Total Agent Seats: 1/);

    // 3. Add new agent
    const { stdout: addOut } = await pExec(
      process.execPath,
      [
        CLI_PATH, 'add', 'example-pa',
        '--name', 'Example PA',
        '--tags', 'architect,design',
        '--icon', '🦅',
        '--color', 'cyan',
        '--roster', rosterPath,
        '--boards-dir', boardsDir
      ]
    );
    assert.match(addOut, /Registered new agent seat: Example PA \(example-pa\)/);
    assert.match(addOut, /agt_live_falcon-pa_/);

    // Verify persisted roster
    const rosterAfterAdd = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    assert.strictEqual(rosterAfterAdd.agents.length, 2);
    const falcon = rosterAfterAdd.agents.find(a => a.id === 'example-pa');
    assert.ok(falcon);
    assert.deepStrictEqual(falcon.tags, ['architect', 'design']);
    assert.ok(falcon.token_hash, 'Token must be stored as hash');

    // 4. Allocate a project
    const { stdout: projOut } = await pExec(
      process.execPath,
      [
        CLI_PATH, 'project', 'add', 'example-pa', 'telemetry-svc',
        '--name', 'Telemetry Service',
        '--roster', rosterPath,
        '--boards-dir', boardsDir
      ]
    );
    assert.match(projOut, /Allocated project "Telemetry Service" \(telemetry-svc\) to agent "example-pa"/);

    // 5. Verify agent board connectivity
    const { stdout: verifyOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'verify', 'example-pa', '--roster', rosterPath, '--boards-dir', boardsDir]
    );
    assert.match(verifyOut, /Verified agent "example-pa"/);
    assert.match(verifyOut, /Status: ONLINE/);

    // 6. Rotate agent token
    const { stdout: rotateOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'token', 'example-pa', '--rotate', '--roster', rosterPath, '--boards-dir', boardsDir]
    );
    assert.match(rotateOut, /Rotated Token for Agent: example-pa/);
    assert.match(rotateOut, /agt_live_falcon-pa_/);

    // 7. Remove agent
    const { stdout: removeOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'remove', 'example-pa', '--roster', rosterPath, '--boards-dir', boardsDir]
    );
    assert.match(removeOut, /Successfully revoked agent seat: example-pa/);

    const rosterAfterRm = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    assert.strictEqual(rosterAfterRm.agents.length, 1);
    assert.strictEqual(rosterAfterRm.agents[0].id, 'manager-pm');

    // 8. Defensive CLI checks
    await assert.rejects(async () => {
      await pExec(
        process.execPath,
        [CLI_PATH, 'add', 'invalid/traversal', '--roster', rosterPath, '--boards-dir', boardsDir]
      );
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('fleet CLI: remote HTTP mode communicates with Board Server REST API', async () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');
  const rosterPath = path.join(tmpDir, 'config', 'roster.json');
  const operatorToken = 'master_operator_secret_123';

  const rosterConfig = {
    version: '5.0.0',
    default_agent: 'manager-pm',
    operator_token: operatorToken,
    manager: {
      agent_id: 'manager-pm',
      role: 'fleet-orchestrator',
      capabilities: ['provision-agent']
    },
    agents: [
      {
        id: 'manager-pm',
        name: 'Manager PM',
        token: 'agt_live_manager_token',
        projects: [{ id: 'default', name: 'Manager Master', board: 'manager-pm.default.sqlite' }]
      }
    ]
  };

  const roster = openRoster({ config: rosterConfig, rosterPath, boardsDir });
  const server = await createBoardServer({ roster, port: 0 });

  try {
    const serverUrl = server.url;

    // 1. Remote list
    const { stdout: listOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'list', '--url', serverUrl, '--token', operatorToken]
    );
    assert.match(listOut, /Incubator v5 Fleet Roster \(Remote:/);
    assert.match(listOut, /Manager PM \(manager-pm\)/);

    // 2. Remote status
    const { stdout: statusOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'status', '--url', serverUrl, '--token', operatorToken]
    );
    assert.match(statusOut, /Fleet Status: \[HEALTHY\]/);
    assert.match(statusOut, /Total Agent Seats: 1/);

    // 3. Remote add agent
    const { stdout: addJsonOut } = await pExec(
      process.execPath,
      [
        CLI_PATH, 'add', 'sweeper-bot',
        '--name', 'Sweeper Bot',
        '--url', serverUrl,
        '--token', operatorToken,
        '--json'
      ]
    );
    const addResult = JSON.parse(addJsonOut);
    assert.strictEqual(addResult.agent.id, 'sweeper-bot');
    assert.ok(addResult.token.startsWith('agt_live_sweeper-bot_'));

    // 4. Remote allocate project
    const { stdout: projOut } = await pExec(
      process.execPath,
      [
        CLI_PATH, 'project', 'add', 'sweeper-bot', 'lint-cleaner',
        '--name', 'Lint Cleaner',
        '--url', serverUrl,
        '--token', operatorToken
      ]
    );
    assert.match(projOut, /Allocated project "lint-cleaner" to agent "sweeper-bot"/);

    // 5. Remote verify
    const { stdout: verifyOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'verify', 'sweeper-bot', '--url', serverUrl, '--token', operatorToken]
    );
    assert.match(verifyOut, /Verified agent "sweeper-bot"/);
    assert.match(verifyOut, /Status: ONLINE/);

    // 5b. Remote verify using FALCON_BOARD_TOKEN environment variable (Task #168)
    const { stdout: verifyEnvOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'verify', 'sweeper-bot'],
      {
        env: {
          ...process.env,
          FALCON_BOARD_URL: serverUrl,
          FALCON_BOARD_TOKEN: operatorToken,
          FALCON_ENV_LOADED: '1'
        }
      }
    );
    assert.match(verifyEnvOut, /Verified agent "sweeper-bot"/);
    assert.match(verifyEnvOut, /Status: ONLINE/);

    // 6. Remote rotate token
    const { stdout: rotateOut } = await pExec(
      process.execPath,
      [
        CLI_PATH, 'token', 'sweeper-bot', '--rotate',
        '--url', serverUrl,
        '--token', operatorToken,
        '--json'
      ]
    );
    const rotateResult = JSON.parse(rotateOut);
    assert.strictEqual(rotateResult.agentId, 'sweeper-bot');
    assert.notStrictEqual(rotateResult.token, addResult.token);

    // 7. Remote remove agent
    const { stdout: removeOut } = await pExec(
      process.execPath,
      [CLI_PATH, 'remove', 'sweeper-bot', '--url', serverUrl, '--token', operatorToken]
    );
    assert.match(removeOut, /Successfully revoked agent seat: sweeper-bot/);

    // 8. Remote unauthorized call fails
    await assert.rejects(async () => {
      await pExec(
        process.execPath,
        [CLI_PATH, 'status', '--url', serverUrl, '--token', 'bogus_token']
      );
    });
  } finally {
    server.closeAllConnections?.();
    server.close();
    roster.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('fleet provision: automates seat directory layout, harness deployment, and transparent board proxying', async () => {
  const tmpDir = createTempDir();
  const serverDir = path.join(tmpDir, 'server');
  const boardsDir = path.join(serverDir, 'boards');
  const rosterPath = path.join(serverDir, 'config', 'roster.json');
  const agentSeatDir = path.join(tmpDir, 'managed-seats', 'worker-seat');
  const operatorToken = 'master_operator_secret_456';

  const rosterConfig = {
    version: '5.0.0',
    default_agent: 'manager-pm',
    operator_token: operatorToken,
    manager: {
      agent_id: 'manager-pm',
      role: 'fleet-orchestrator',
      capabilities: ['provision-agent']
    },
    agents: [
      {
        id: 'manager-pm',
        name: 'Manager PM',
        token: 'agt_live_manager_token',
        projects: [{ id: 'default', name: 'Manager Master', board: 'manager-pm.default.sqlite' }]
      }
    ]
  };

  const roster = openRoster({ config: rosterConfig, rosterPath, boardsDir });
  const server = await createBoardServer({ roster, port: 0 });

  try {
    const serverUrl = server.url;

    // 1. Provision new seat via fleet CLI
    const { stdout: provOut } = await pExec(
      process.execPath,
      [
        CLI_PATH, 'provision', 'worker-seat',
        '--target', agentSeatDir,
        '--url', serverUrl,
        '--token', operatorToken,
        '--name', 'Worker Seat',
        '--icon', '⚡',
        '--tags', 'worker,test'
      ]
    );

    assert.match(provOut, /Successfully provisioned agent seat "worker-seat"/);
    assert.match(provOut, /Central Board:/);

    // 2. Verify physical layout in provisioned seat
    assert.ok(fs.existsSync(path.join(agentSeatDir, 'harness/HARNESS.md')), 'HARNESS.md must be deployed');
    assert.ok(fs.existsSync(path.join(agentSeatDir, 'harness/HARNESS-custom.md')), 'HARNESS-custom.md must be deployed');
    assert.ok(fs.existsSync(path.join(agentSeatDir, 'harness/engine/brain.mjs')), 'brain.mjs must be deployed');
    assert.ok(fs.existsSync(path.join(agentSeatDir, 'harness/components/board/tools/board.mjs')), 'board CLI must be deployed');
    assert.ok(fs.existsSync(path.join(agentSeatDir, 'AGENTS.md')), 'AGENTS.md card must exist');
    assert.ok(fs.existsSync(path.join(agentSeatDir, 'brain/__source')), 'brain store must be initialized');
    assert.ok(fs.existsSync(path.join(agentSeatDir, 'workspaces')), 'workspaces directory must exist');
    assert.ok(fs.existsSync(path.join(agentSeatDir, 'projects')), 'projects directory must exist');

    // 3. Verify harness/falcon.env contents
    const envPath = path.join(agentSeatDir, 'harness/falcon.env');
    assert.ok(fs.existsSync(envPath), 'falcon.env must be injected');
    const envContent = fs.readFileSync(envPath, 'utf8');
    assert.match(envContent, new RegExp(`FALCON_BOARD_URL=${serverUrl}`));
    assert.match(envContent, /FALCON_AGENT_ID=worker-seat/);
    assert.match(envContent, /FALCON_BOARD_TOKEN=agt_live_worker-seat_/);

    // 4. Execute board CLI from inside the agent seat without any URL or token arguments
    const agentBoardCli = path.join(agentSeatDir, 'harness/components/board/tools/board.mjs');
    const { stdout: taskAddOut } = await pExec(
      process.execPath,
      [agentBoardCli, 'add', 'Verify automated provisioning', '--track', 'test'],
      { cwd: agentSeatDir }
    );
    assert.match(taskAddOut, /Task #1 created/);

    // 5. Verify that central server received the task for worker-seat
    const tasksRes = await fetch(`${serverUrl}/api/v1/tasks?agent=worker-seat`, {
      headers: { 'Authorization': `Bearer ${operatorToken}` }
    });
    assert.strictEqual(tasksRes.status, 200);
    const tasksData = await tasksRes.json();
    const tasks = tasksData.tasks;
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].title, 'Verify automated provisioning');
    assert.strictEqual(tasks[0].track, 'test');
  } finally {
    server.closeAllConnections?.();
    server.close();
    roster.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

