import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoardClient } from '../tools/client.mjs';
import { createBoardServer } from '../api/server.mjs';
import { openRoster } from '../engine/roster.mjs';
import { createMcpServer } from '../tools/mcp-server.mjs';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'client-test-'));
}

test('board client: transparent local SQLite mode when URL is omitted', async () => {
  const tmpDir = createTempDir();
  const dbPath = path.join(tmpDir, 'local.sqlite');

  const client = createBoardClient({ dbPath });
  assert.strictEqual(client.isRemote, false);

  try {
    const id = await client.addItem({ title: 'Local Task 1', track: 'core' });
    assert.strictEqual(id, 1);

    const tasks = await client.listItems({});
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].title, 'Local Task 1');

    const updated = await client.updateItem(1, { status: 'done' });
    assert.strictEqual(updated.status, 'done');

    const summary = await client.getBoardSummary();
    assert.strictEqual(summary.totalTasks, 1);
    assert.strictEqual(summary.totalDone, 1);

    const ok = await client.deleteItem(1);
    assert.strictEqual(ok, true);
  } finally {
    client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('board client: remote HTTP mode with Bearer authentication and doc sync', async () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');
  const syncDocsDir = path.join(tmpDir, 'sync-docs');
  const mockUiDir = path.join(tmpDir, 'ui');
  fs.mkdirSync(mockUiDir, { recursive: true });

  const testToken = 'sec_ag_agent1_token';
  const roster = openRoster({
    config: {
      default_agent: 'agent-1',
      agents: [
        {
          id: 'agent-1',
          name: 'Agent One',
          token: testToken
        }
      ]
    },
    boardsDir
  });

  const serverInstance = await createBoardServer({
    roster,
    syncDocsDir,
    docsDir: false,
    uiDir: mockUiDir,
    port: 0
  });

  const client = createBoardClient({
    url: serverInstance.url,
    token: testToken,
    agentId: 'agent-1'
  });
  assert.strictEqual(client.isRemote, true);

  try {
    // 1. Add item over HTTP
    const id = await client.addItem({
      title: 'Remote Task 1',
      design_slug: 'remote-stage',
      track: 'api',
      details: '- [ ] Step 1\n- [ ] Step 2'
    });
    assert.strictEqual(id, 1);

    // 2. List items
    const tasks = await client.listItems({});
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].title, 'Remote Task 1');

    // 3. Get item
    const item = await client.getItem(1);
    assert.strictEqual(item.id, 1);

    // 4. Toggle checklist item
    const toggled = await client.toggleChecklistItem(1, 0);
    assert.ok(toggled.details.includes('- [x] Step 1'));

    // 5. Update item
    const updated = await client.updateItem(1, { status: 'in-progress' });
    assert.strictEqual(updated.status, 'in-progress');

    // 6. Board summary
    const summary = await client.getBoardSummary();
    assert.strictEqual(summary.totalTasks, 1);

    // 7. Sync design doc
    const sampleDocPath = path.join(tmpDir, 'sample-stage.md');
    fs.writeFileSync(sampleDocPath, '# Sample Stage\n\nBlueprint content\n');
    const syncRes = await client.syncDoc('sample-stage', sampleDocPath);
    assert.strictEqual(syncRes.success, true);
    assert.strictEqual(syncRes.slug, 'sample-stage');

    // 8. Delete item
    const delOk = await client.deleteItem(1);
    assert.strictEqual(delOk, true);
  } finally {
    client.close();
    serverInstance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('mcp server: tool registration and tool calls', async () => {
  const tmpDir = createTempDir();
  const dbPath = path.join(tmpDir, 'mcp.sqlite');

  const mcp = createMcpServer({ dbPath });

  try {
    // 1. initialize
    const initRes = mcp.handleMessage({ method: 'initialize', id: 1 });
    assert.strictEqual(initRes.serverInfo.name, 'incubator-board');

    // 2. tools/list
    const toolsRes = mcp.handleMessage({ method: 'tools/list', id: 2 });
    assert.ok(Array.isArray(toolsRes.tools));
    assert.ok(toolsRes.tools.some((t) => t.name === 'board_add'));
    assert.ok(toolsRes.tools.some((t) => t.name === 'board_list'));
    assert.ok(toolsRes.tools.some((t) => t.name === 'board_sync_doc'));

    // 3. tools/call board_add
    const callAddRes = await mcp.handleToolCall('board_add', {
      title: 'MCP Task',
      track: 'core',
      doc: 'test-doc'
    });
    assert.ok(callAddRes.content[0].text.includes('Created task #1'));

    // 4. tools/call board_list
    const callListRes = await mcp.handleToolCall('board_list', {});
    assert.ok(callListRes.content[0].text.includes('MCP Task'));
  } finally {
    mcp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
