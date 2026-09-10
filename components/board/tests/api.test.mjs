import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoardServer } from '../api/server.mjs';
import { openRoster } from '../engine/roster.mjs';

test('Board API server handles board stats, task CRUD, and static files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-api-test-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const mockUiDir = path.join(tmpDir, 'ui');
  fs.mkdirSync(mockUiDir, { recursive: true });
  fs.writeFileSync(path.join(mockUiDir, 'index.html'), '<h1>Test UI</h1>');

  const mockDocsDir = path.join(tmpDir, 'design');
  fs.mkdirSync(mockDocsDir, { recursive: true });
  fs.writeFileSync(
    path.join(mockDocsDir, 'sample-spec.md'),
    `# Sample Spec\n\n- **Status**: in-progress\n- **Author**: test\n\n## Overview\nThis is a sample design doc.\n`
  );

  const instance = await createBoardServer({
    dbPath,
    uiDir: mockUiDir,
    docsDir: mockDocsDir,
    port: 0
  });

  try {
    // 1. Initial GET /api/board (empty)
    const resBoard = await fetch(`${instance.url}/api/board`);
    assert.equal(resBoard.status, 200);
    const boardData = await resBoard.json();
    assert.equal(boardData.totalTasks, 0);
    assert.equal(boardData.overallPercentComplete, 0);

    // 2. POST /api/tasks (create task 1)
    const resCreate1 = await fetch(`${instance.url}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Build Web UI Layout',
        design_slug: 'v5-foundation',
        track: 'ux',
        mode: 'runner'
      })
    });
    assert.equal(resCreate1.status, 201);
    const createData1 = await resCreate1.json();
    assert.equal(createData1.task.id, 1);
    assert.equal(createData1.task.status, 'planned');
    assert.equal(createData1.task.mode, 'runner');

    // 3. POST /api/tasks (create task 2)
    const resCreate2 = await fetch(`${instance.url}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Implement API Routes',
        design_slug: 'v5-foundation',
        track: 'api',
        mode: 'pair',
        status: 'done'
      })
    });
    assert.equal(resCreate2.status, 201);

    // 4. GET /api/board (reflects 2 tasks, 1 done, 50% complete)
    const resBoard2 = await fetch(`${instance.url}/api/board`);
    const boardData2 = await resBoard2.json();
    assert.equal(boardData2.totalTasks, 2);
    assert.equal(boardData2.totalDone, 1);
    assert.equal(boardData2.overallPercentComplete, 50);
    assert.equal(boardData2.stages.length, 1);
    assert.equal(boardData2.stages[0].design_slug, 'v5-foundation');
    assert.equal(boardData2.stages[0].percentComplete, 50);

    // 5. GET /api/tasks with filtering
    const resFiltered = await fetch(`${instance.url}/api/tasks?status=planned`);
    const filteredData = await resFiltered.json();
    assert.equal(filteredData.tasks.length, 1);
    assert.equal(filteredData.tasks[0].id, 1);

    // 6. PATCH /api/tasks/1 (update status to in-progress)
    const resPatch = await fetch(`${instance.url}/api/tasks/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in-progress' })
    });
    assert.equal(resPatch.status, 200);
    const patchData = await resPatch.json();
    assert.equal(patchData.task.status, 'in-progress');

    // 7. Static file serving (GET / -> index.html)
    const resStatic = await fetch(`${instance.url}/`);
    assert.equal(resStatic.status, 200);
    assert.equal(resStatic.headers.get('content-type'), 'text/html; charset=utf-8');
    const staticHtml = await resStatic.text();
    assert.equal(staticHtml, '<h1>Test UI</h1>');

    // 8. Standalone task creation (no design_slug)
    const resCreateStandalone = await fetch(`${instance.url}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Ad-hoc bug fix',
        track: 'bug',
        mode: 'pair'
      })
    });
    assert.equal(resCreateStandalone.status, 201);
    const standaloneData = await resCreateStandalone.json();
    assert.equal(standaloneData.task.design_slug, null);

    // 9. Verify GET /api/board includes standalone section
    const resBoardStandalone = await fetch(`${instance.url}/api/board`);
    const boardDataStandalone = await resBoardStandalone.json();
    assert.equal(boardDataStandalone.standalone.total, 1);
    assert.equal(boardDataStandalone.standalone.openBugs, 1);

    // 10. Verify GET /api/docs and GET /api/docs/:slug
    const resDocsList = await fetch(`${instance.url}/api/docs`);
    assert.equal(resDocsList.status, 200);
    const docsListData = await resDocsList.json();
    assert.equal(docsListData.docs.length, 1);
    assert.equal(docsListData.docs[0].slug, 'sample-spec');
    assert.equal(docsListData.docs[0].title, 'Sample Spec');
    assert.equal(docsListData.docs[0].codename, '#d-1');
    assert.ok(docsListData.docs[0].color);

    const resDocDetail = await fetch(`${instance.url}/api/docs/sample-spec`);
    assert.equal(resDocDetail.status, 200);
    const docDetailData = await resDocDetail.json();
    assert.equal(docDetailData.doc.slug, 'sample-spec');
    assert.ok(docDetailData.doc.color);
    assert.ok(docDetailData.doc.content.includes('# Sample Spec'));

    // 11. Status transition: POST /api/docs/sample-spec/status
    const resDocFinish = await fetch(`${instance.url}/api/docs/sample-spec/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Finished' })
    });
    assert.equal(resDocFinish.status, 200);
    const docFinishData = await resDocFinish.json();
    assert.equal(docFinishData.success, true);
    assert.equal(docFinishData.status, 'Finished');
    assert.equal(docFinishData.isFinished, true);

    const resDocsAfterFinish = await fetch(`${instance.url}/api/docs`);
    const docsAfterFinishData = await resDocsAfterFinish.json();
    assert.equal(docsAfterFinishData.docs[0].status, 'Finished');
    assert.equal(docsAfterFinishData.docs[0].isFinished, true);

    // 12. DELETE /api/tasks/1
    const resDel = await fetch(`${instance.url}/api/tasks/1`, { method: 'DELETE' });
    assert.equal(resDel.status, 200);

    const resGetAfterDel = await fetch(`${instance.url}/api/tasks/1`);
    assert.equal(resGetAfterDel.status, 404);
  } finally {
    instance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Board API server supports multi-agent /api/v1 routes, Bearer auth, and doc sync', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-multi-api-test-'));
  const boardsDir = path.join(tmpDir, 'boards');
  const syncDocsDir = path.join(tmpDir, 'sync-docs');
  const mockUiDir = path.join(tmpDir, 'ui');
  fs.mkdirSync(mockUiDir, { recursive: true });

  const tokenAlpha = 'sec_ag_alpha_12345';
  const tokenBeta = 'sec_ag_beta_67890';
  const operatorToken = 'sec_op_master_99999';

  const rosterConfig = {
    default_agent: 'agent-alpha',
    operator_token: operatorToken,
    agents: [
      {
        id: 'agent-alpha',
        name: 'Agent Alpha (Pair)',
        token: tokenAlpha,
        icon: '🛡️'
      },
      {
        id: 'agent-beta',
        name: 'Agent Beta (Worker)',
        token: tokenBeta,
        icon: '⚡'
      }
    ]
  };

  const roster = openRoster({
    config: rosterConfig,
    boardsDir,
    operatorToken
  });

  const instance = await createBoardServer({
    roster,
    syncDocsDir,
    docsDir: false,
    uiDir: mockUiDir,
    port: 0
  });

  try {
    // 1. GET /api/v1/roster
    const resRoster = await fetch(`${instance.url}/api/v1/roster`);
    assert.equal(resRoster.status, 200);
    const rosterData = await resRoster.json();
    assert.equal(rosterData.agents.length, 2);
    assert.equal(rosterData.defaultAgent, 'agent-alpha');

    // 2. Unauthenticated POST /api/v1/tasks -> 401
    const resUnauth = await fetch(`${instance.url}/api/v1/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unauthorized Task' })
    });
    assert.equal(resUnauth.status, 401);

    // 3. Authenticated POST /api/v1/tasks with Alpha's token
    const resCreateAlpha = await fetch(`${instance.url}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        title: 'Alpha Feature A',
        design_slug: 'feature-alpha',
        track: 'core',
        status: 'in-progress'
      })
    });
    assert.equal(resCreateAlpha.status, 201);
    const alphaCreated = await resCreateAlpha.json();
    assert.equal(alphaCreated.agentId, 'agent-alpha');
    assert.equal(alphaCreated.task.id, 1);
    assert.equal(alphaCreated.task.title, 'Alpha Feature A');

    // 4. Cross-tenant attempt: Alpha tries to write to Beta's board -> 403 Forbidden
    const resCrossTenant = await fetch(`${instance.url}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        agent: 'agent-beta',
        title: 'Malicious Cross-Tenant Task'
      })
    });
    assert.equal(resCrossTenant.status, 403);
    const crossTenantData = await resCrossTenant.json();
    assert.ok(crossTenantData.error.includes('Cross-tenant access denied'));

    // 5. Authenticated POST /api/v1/tasks with Beta's token
    const resCreateBeta = await fetch(`${instance.url}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenBeta}`
      },
      body: JSON.stringify({
        title: 'Beta Worker Task',
        track: 'backend',
        status: 'done'
      })
    });
    assert.equal(resCreateBeta.status, 201);
    const betaCreated = await resCreateBeta.json();
    assert.equal(betaCreated.agentId, 'agent-beta');
    assert.equal(betaCreated.task.id, 1); // Isolated DB starts at 1

    // 6. Check isolated boards
    const resAlphaBoard = await fetch(`${instance.url}/api/v1/agents/agent-alpha/board`);
    assert.equal(resAlphaBoard.status, 200);
    const alphaBoardData = await resAlphaBoard.json();
    assert.equal(alphaBoardData.totalTasks, 1);
    assert.equal(alphaBoardData.totalDone, 0);

    const resBetaBoard = await fetch(`${instance.url}/api/v1/agents/agent-beta/board`);
    assert.equal(resBetaBoard.status, 200);
    const betaBoardData = await resBetaBoard.json();
    assert.equal(betaBoardData.totalTasks, 1);
    assert.equal(betaBoardData.totalDone, 1);

    // 7. Design Doc Sync: POST /api/v1/docs/sync
    const resDocSync = await fetch(`${instance.url}/api/v1/docs/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        slug: 'feature-alpha',
        title: 'Feature Alpha Blueprint',
        content: '# Feature Alpha Blueprint\n\n- **Status**: in-progress\n- **Author**: manager-pm\n\nSynced blueprint content.\n'
      })
    });
    assert.equal(resDocSync.status, 200);
    const docSyncData = await resDocSync.json();
    assert.equal(docSyncData.success, true);
    assert.equal(docSyncData.slug, 'feature-alpha');

    // 8. View synced docs: GET /api/v1/agents/agent-alpha/docs and /:slug
    const resGetAlphaDocs = await fetch(`${instance.url}/api/v1/agents/agent-alpha/docs`);
    assert.equal(resGetAlphaDocs.status, 200);
    const alphaDocsList = await resGetAlphaDocs.json();
    assert.equal(alphaDocsList.docs.length, 1);
    assert.equal(alphaDocsList.docs[0].slug, 'feature-alpha');
    assert.equal(alphaDocsList.docs[0].taskStats.total, 1);

    const resGetAlphaDocDetail = await fetch(`${instance.url}/api/v1/agents/agent-alpha/docs/feature-alpha`);
    assert.equal(resGetAlphaDocDetail.status, 200);
    const alphaDocDetail = await resGetAlphaDocDetail.json();
    assert.ok(alphaDocDetail.doc.content.includes('Synced blueprint content'));
    assert.equal(alphaDocDetail.doc.tasks.length, 1);

    // 8b. Project-scoped sync: a doc synced under project "proj-a" is invisible under "proj-b",
    //     and an unauthenticated read for another agent must not 401 (the UI viewer has no token).
    const resDocSyncProj = await fetch(`${instance.url}/api/v1/docs/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenBeta}` },
      body: JSON.stringify({ slug: 'beta-spec', project: 'proj-a', content: '# Beta Spec\n\n- **Status**: draft\n' })
    });
    assert.equal(resDocSyncProj.status, 200);
    assert.ok((await resDocSyncProj.json()).filePath.includes(path.join('agent-beta', 'proj-a')));
    const betaDocsA = await (await fetch(`${instance.url}/api/v1/agents/agent-beta/docs?project=proj-a`)).json();
    assert.deepEqual(betaDocsA.docs.map(d => d.slug), ['beta-spec']);
    const resBetaDocsB = await fetch(`${instance.url}/api/v1/agents/agent-beta/docs?project=proj-b`);
    assert.equal(resBetaDocsB.status, 200);
    assert.deepEqual((await resBetaDocsB.json()).docs, []);
    assert.equal((await fetch(`${instance.url}/api/v1/agents/agent-beta/docs/beta-spec?project=proj-b`)).status, 404);
    assert.equal((await fetch(`${instance.url}/api/v1/agents/agent-beta/docs/beta-spec?project=proj-a`)).status, 200);

    // 9. Checklist toggle: POST /api/v1/tasks/1/toggle-checklist
    const resToggle = await fetch(`${instance.url}/api/v1/tasks/1/toggle-checklist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({ index: 0 })
    });
    assert.equal(resToggle.status, 200);
    const toggleData = await resToggle.json();
    assert.ok(toggleData.task.details.includes('- [x]'));

    // 10. Mark task done and test Doc Status Transition: POST /api/v1/docs/:slug/status
    await fetch(`${instance.url}/api/v1/tasks/1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({ status: 'done', agent: 'agent-alpha' })
    });

    const resDocFinishV1 = await fetch(`${instance.url}/api/v1/docs/feature-alpha/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({ status: 'Finished', agent: 'agent-alpha' })
    });
    assert.equal(resDocFinishV1.status, 200);
    const docFinishV1Data = await resDocFinishV1.json();
    assert.equal(docFinishV1Data.success, true);
    assert.equal(docFinishV1Data.status, 'Finished');
    assert.equal(docFinishV1Data.isFinished, true);

    // Verify in GET /api/v1/agents/agent-alpha/docs
    const resDocsAfterFinishV1 = await fetch(`${instance.url}/api/v1/agents/agent-alpha/docs`);
    const docsAfterFinishV1Data = await resDocsAfterFinishV1.json();
    assert.equal(docsAfterFinishV1Data.docs[0].status, 'Finished');
    assert.equal(docsAfterFinishV1Data.docs[0].isFinished, true);

    // Reopen doc: POST /api/v1/docs/:slug/status -> Active
    const resDocReopenV1 = await fetch(`${instance.url}/api/v1/docs/feature-alpha/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({ status: 'Active', agent: 'agent-alpha' })
    });
    assert.equal(resDocReopenV1.status, 200);
    const docReopenV1Data = await resDocReopenV1.json();
    assert.equal(docReopenV1Data.status, 'Active');
    assert.equal(docReopenV1Data.isFinished, false);
  } finally {
    instance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

