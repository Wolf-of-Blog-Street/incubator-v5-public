import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openRoster } from '../engine/roster.mjs';
import { createBoardServer } from '../api/server.mjs';
import { createBoardClient } from '../tools/client.mjs';

function makeTempHarness() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-journey-'));
  const boardsDir = path.join(tmpDir, 'boards');
  const syncDocsDir = path.join(tmpDir, 'sync-docs');
  fs.mkdirSync(boardsDir, { recursive: true });
  fs.mkdirSync(syncDocsDir, { recursive: true });

  const managerToken = 'agt_live_manager_secret_111';
  const falconToken = 'agt_live_falcon_secret_222';

  const rosterConfig = {
    version: '5.0.0',
    default_agent: 'manager-pm',
    operator_token: 'op_master_secret_999',
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
        projects: [
          { id: 'default', name: 'Manager Default' },
          { id: 'mobile', name: 'Manager Mobile' }
        ]
      },
      {
        id: 'example-pa',
        name: 'Example PA',
        token: falconToken,
        projects: [
          { id: 'default', name: 'Falcon Default' }
        ]
      }
    ]
  };

  const roster = openRoster({ config: rosterConfig, boardsDir });
  return { tmpDir, boardsDir, syncDocsDir, roster, managerToken, falconToken };
}

test('User Journey: Multi-Tenant Provisioning, Doc Sync, Project Scoping, and Guardrails', async (t) => {
  const h = makeTempHarness();
  const server = await createBoardServer({
    roster: h.roster,
    boardsDir: h.boardsDir,
    syncDocsDir: h.syncDocsDir,
    port: 0
  });

  t.after(async () => {
    server.close();
    h.roster.closeAll();
    fs.rmSync(h.tmpDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;

  // 1. Authenticate as Manager PM via Client
  const managerClient = createBoardClient({
    url: baseUrl,
    token: h.managerToken,
    agentId: 'manager-pm'
  });

  // 2. Manager creates tasks in 'default' project
  const task1Id = await managerClient.addItem({
    title: 'Core architecture spec',
    design_slug: 'v5-arch',
    track: 'core'
  });
  assert.equal(task1Id, 1);

  // 3. Manager creates task in 'mobile' project
  const managerMobileClient = createBoardClient({
    url: baseUrl,
    token: h.managerToken,
    agentId: 'manager-pm',
    project: 'mobile'
  });
  const mobileTaskId = await managerMobileClient.addItem({
    title: 'Mobile screen layout',
    design_slug: 'mobile-app',
    track: 'ux'
  });
  assert.equal(mobileTaskId, 1); // ID starts at 1 for separate project db

  // 4. Verify Bug #73: getItem and deleteItem are strictly agent-scoped
  const itemManager = await managerClient.getItem(task1Id);
  assert.ok(itemManager);
  assert.equal(itemManager.title, 'Core architecture spec');

  // 5. Authenticate as Example PA (different tenant)
  const falconClient = createBoardClient({
    url: baseUrl,
    token: h.falconToken,
    agentId: 'example-pa'
  });

  // Example PA cannot see or delete Manager PM's tasks
  const falconItems = await falconClient.listItems({});
  assert.equal(falconItems.length, 0);

  // Cross-tenant delete attempt rejected with 404 (not found in Falcon's tenant)
  await assert.rejects(
    () => falconClient.deleteItem(task1Id),
    /not found in agent "example-pa"/i
  );
  const stillExists = await managerClient.getItem(task1Id);
  assert.ok(stillExists, 'Manager task must not be deleted by Falcon');

  // 6. Bug #68 & #70: Doc Sync and Completion Guard
  // Write a mock doc to sync-docs
  const docFile = path.join(h.syncDocsDir, 'manager-pm', 'v5-arch.md');
  fs.mkdirSync(path.dirname(docFile), { recursive: true });
  fs.writeFileSync(docFile, `# V5 Arch\n- **Status**: In Progress\n`, 'utf8');

  // Attempt to close doc while task1 is still 'planned'
  await assert.rejects(
    () => managerClient.closeDesignDoc('v5-arch'),
    /still open/i,
    'Cannot close doc with open tasks without force'
  );

  // Mark task1 done
  await managerClient.updateItem(task1Id, { status: 'done' });
  const closeRes = await managerClient.closeDesignDoc('v5-arch');
  assert.equal(closeRes.closed, true);

  // Write mobile doc file
  const mobDocFile = path.join(h.syncDocsDir, 'manager-pm', 'mobile', 'mobile-app.md');
  fs.mkdirSync(path.dirname(mobDocFile), { recursive: true });
  fs.writeFileSync(mobDocFile, `# Mobile App\n- **Status**: Draft\n`, 'utf8');

  // 7. Bug #72: Project filtering on doc endpoints
  const docList = await fetch(`${baseUrl}/api/v1/agents/manager-pm/docs?project=mobile`, {
    headers: { Authorization: `Bearer ${h.managerToken}` }
  }).then(r => r.json());
  assert.ok(docList.docs);
  // Mobile doc list should show mobile-app with 1 task
  const mobDoc = docList.docs.find(d => d.slug === 'mobile-app');
  assert.ok(mobDoc);
  assert.equal(mobDoc.taskStats.total, 1);
});
