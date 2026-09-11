import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openBoard } from '../engine/board.mjs';
import {
  extractMilestonesFromDoc,
  findDefaultDb
} from '../tools/board/parser.mjs';
import {
  handleSyncDoc
} from '../tools/board/docCommands.mjs';
import {
  reconcileDocStatusSync,
  updateIndexOnCloseSync,
  updateIndexOnReopenSync,
  attachDocTaskStats,
  findDocLocationSync
} from '../api/services/docService.mjs';
import { createBoardServer } from '../api/server.mjs';

function createTempProject() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-lifecycle-test-'));
  const docsDir = path.join(tempDir, 'docs', 'design');
  const archiveDir = path.join(docsDir, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });

  const indexContent = `# Design Specs & Epics Index

## Active Living Blueprints

| Codename | Blueprint / Component | Status | Target Component | Description |
| :--- | :--- | :--- | :--- | :--- |
| **#d-10** | [\`search-engine\`](search-engine.md) | Open & Active | \`core\`, \`api\` | Fast full-text search engine |

---

## Closed (archived)

| Codename | Blueprint | Description |
| :--- | :--- | :--- |
| **#d-1** | [\`board\`](archive/board.md) | Project Board & Kanban |
`;

  const docContent = `# Search Engine

- **Codename**: #d-10
- **Status**: Open & Active
- **Author**: manager
- **Target Component(s)**: core, api
- **Last Updated**: 2026-09-10

## Context & Scope
Search engine implementation proposal.

## Implementation Milestones

### Round 1 — Initial Build
- [ ] **Milestone 1: Indexer Engine**
  - Parse tokens and build inverted index
  - Cache postings list in memory
- [ ] **Milestone 2: Query Resolver & Verification**
  - Implement boolean queries
  - Verify with unit tests
`;

  fs.writeFileSync(path.join(docsDir, 'INDEX.md'), indexContent, 'utf8');
  fs.writeFileSync(path.join(docsDir, 'search-engine.md'), docContent, 'utf8');

  return { tempDir, docsDir, archiveDir };
}

test('Milestone brief extraction and round prefix omission', () => {
  const sampleDoc = `
## Implementation Milestones

### Round 1 — Setup
- [ ] **Milestone 1: Indexer**
  - Implement token parsing
  - Scaffold in-memory posting list
- [x] **Milestone 2: Query API**
  - Support AND/OR operators
`;

  const milestones = extractMilestonesFromDoc(sampleDoc, 'api');
  assert.strictEqual(milestones.length, 2);

  // 1. Milestone 1
  assert.strictEqual(milestones[0].title, 'Milestone 1: Indexer');
  assert.strictEqual(milestones[0].status, 'planned');
  assert.strictEqual(milestones[0].track, 'api');
  assert.strictEqual(
    milestones[0].brief,
    '- Implement token parsing\n- Scaffold in-memory posting list'
  );

  // 2. Milestone 2
  assert.strictEqual(milestones[1].title, 'Milestone 2: Query API');
  assert.strictEqual(milestones[1].status, 'done');
  assert.strictEqual(
    milestones[1].brief,
    '- Support AND/OR operators'
  );
});

test('Doc auto-closes when last task is marked done, archives file, and rewrites INDEX.md', () => {
  const { tempDir, docsDir, archiveDir } = createTempProject();
  const board = openBoard(':memory:', { docsDir, rootDir: tempDir });

  // 1. Add 2 tasks for search-engine
  const id1 = board.addItem({
    title: 'Milestone 1: Indexer Engine',
    design_slug: 'search-engine',
    track: 'core',
    status: 'planned'
  });
  const id2 = board.addItem({
    title: 'Milestone 2: Query Resolver',
    design_slug: 'search-engine',
    track: 'api',
    status: 'planned'
  });

  // Check initial active location
  const activeFile = path.join(docsDir, 'search-engine.md');
  const archivedFile = path.join(archiveDir, 'search-engine.md');
  assert.strictEqual(fs.existsSync(activeFile), true);
  assert.strictEqual(fs.existsSync(archivedFile), false);

  // 2. Mark first task done -> doc remains active
  board.updateItem(id1, { status: 'done' });
  assert.strictEqual(fs.existsSync(activeFile), true);
  assert.strictEqual(fs.existsSync(archivedFile), false);

  // 3. Mark second (last) task done -> doc auto-closes and archives!
  board.updateItem(id2, { status: 'done' });

  // File should now be in archiveDir
  assert.strictEqual(fs.existsSync(activeFile), false, 'Active file should have moved');
  assert.strictEqual(fs.existsSync(archivedFile), true, 'Archived file should exist');

  // Verify frontmatter in archived file
  const archivedContent = fs.readFileSync(archivedFile, 'utf8');
  assert.match(archivedContent, /-\s+\*\*Status\*\*:\s*Closed/);

  // Verify INDEX.md rewrite
  const indexContent = fs.readFileSync(path.join(docsDir, 'INDEX.md'), 'utf8');
  assert.strictEqual(indexContent.includes('[`search-engine`](archive/search-engine.md)'), true);
  assert.strictEqual(indexContent.includes('[`search-engine`](search-engine.md)'), false);

  // 4. Reopen one task -> doc unarchives and moves back!
  board.updateItem(id2, { status: 'in-progress' });
  assert.strictEqual(fs.existsSync(activeFile), true, 'Active file should be restored');
  assert.strictEqual(fs.existsSync(archivedFile), false, 'Archived file should be moved back');

  const unarchivedContent = fs.readFileSync(activeFile, 'utf8');
  assert.match(unarchivedContent, /-\s+\*\*Status\*\*:\s*Open & Active/);

  const reloadedIndex = fs.readFileSync(path.join(docsDir, 'INDEX.md'), 'utf8');
  assert.strictEqual(reloadedIndex.includes('[`search-engine`](search-engine.md)'), true);
  assert.strictEqual(reloadedIndex.includes('[`search-engine`](archive/search-engine.md)'), false);

  board.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Adding a task to a closed doc automatically unarchives it', () => {
  const { tempDir, docsDir, archiveDir } = createTempProject();
  const board = openBoard(':memory:', { docsDir, rootDir: tempDir });

  const id1 = board.addItem({
    title: 'Task 1',
    design_slug: 'search-engine',
    status: 'done'
  });

  const activeFile = path.join(docsDir, 'search-engine.md');
  const archivedFile = path.join(archiveDir, 'search-engine.md');

  // Since id1 was added as done and it's the only task, doc auto-closed
  assert.strictEqual(fs.existsSync(activeFile), false);
  assert.strictEqual(fs.existsSync(archivedFile), true);

  // Adding a new planned task unarchives the doc
  board.addItem({
    title: 'Task 2',
    design_slug: 'search-engine',
    status: 'planned'
  });

  assert.strictEqual(fs.existsSync(activeFile), true);
  assert.strictEqual(fs.existsSync(archivedFile), false);

  board.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Graceful no-op when doc file is absent on disk', () => {
  const board = openBoard(':memory:');

  // Adding a task for a doc with no markdown file should never throw
  const id1 = board.addItem({
    title: 'Ghost task 1',
    design_slug: 'ghost-doc',
    status: 'planned'
  });
  assert.strictEqual(typeof id1, 'number');

  // Updating to done should not throw
  board.updateItem(id1, { status: 'done' });
  const item = board.getItem(id1);
  assert.strictEqual(item.status, 'done');

  // Deleting should not throw
  assert.strictEqual(board.deleteItem(id1), true);

  board.close();
});

test('sync-doc copies milestone briefs directly into task details', async () => {
  const { tempDir, docsDir } = createTempProject();
  const board = openBoard(':memory:', { docsDir, rootDir: tempDir });

  const client = {
    ...board,
    syncDoc: async () => ({ success: true }),
    listItems: (args) => board.listItems(args),
    addItem: (args) => board.addItem(args)
  };

  // Custom doc with sub-bullet briefs
  const parsed = {
    _: ['sync-doc', 'search-engine'],
    flags: { file: path.join(docsDir, 'search-engine.md') }
  };

  await handleSyncDoc(client, parsed, 'test-project', extractMilestonesFromDoc);

  const items = board.listItems({ design_slug: 'search-engine' });
  assert.strictEqual(items.length, 2);

  const task1 = items.find(i => i.title.includes('Indexer Engine'));
  assert.strictEqual(Boolean(task1), true);
  assert.strictEqual(
    task1.details,
    '- Parse tokens and build inverted index\n- Cache postings list in memory'
  );

  board.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('attachDocTaskStats derives closed lifecycle and updates metadata', () => {
  const board = openBoard(':memory:');
  board.addItem({ title: 'Task 1', design_slug: 'completed-doc', status: 'done' });
  board.addItem({ title: 'Task 2', design_slug: 'completed-doc', status: 'done' });

  board.addItem({ title: 'Task 3', design_slug: 'in-flight-doc', status: 'done' });
  board.addItem({ title: 'Task 4', design_slug: 'in-flight-doc', status: 'in-progress' });

  const docs = [
    { slug: 'completed-doc', status: 'Open & Active' },
    { slug: 'in-flight-doc', status: 'Draft' },
    { slug: 'empty-doc', status: 'Draft' }
  ];

  attachDocTaskStats(docs, board);

  // Completed doc
  assert.strictEqual(docs[0].lifecycle, 'closed');
  assert.strictEqual(docs[0].state_label, 'Closed');
  assert.strictEqual(docs[0].status, 'Closed');
  assert.strictEqual(docs[0].isFinished, true);

  // In-flight doc
  assert.strictEqual(docs[1].lifecycle, 'open');
  assert.strictEqual(docs[1].execution_state, 'active');
  assert.strictEqual(docs[1].state_label, 'Open & Active');

  // Empty doc
  assert.strictEqual(docs[2].lifecycle, 'open');
  assert.strictEqual(docs[2].execution_state, 'inactive');
  assert.strictEqual(docs[2].state_label, 'Open & Inactive');

  board.close();
});

test('End-to-End API server autoclose: Remote job completion archives sync and design copies and updates INDEX.md', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-autoclose-server-test-'));
  const boardsDir = path.join(tmpDir, 'boards');
  const syncDocsDir = path.join(tmpDir, 'docs', 'sync');
  const docsDir = path.join(tmpDir, 'docs', 'design');
  const archiveDir = path.join(docsDir, 'archive');
  const rosterPath = path.join(tmpDir, 'roster.json');

  fs.mkdirSync(boardsDir, { recursive: true });
  fs.mkdirSync(syncDocsDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  const rosterConfig = {
    version: '5.0.0',
    default_agent: 'manager-pm',
    agents: [
      {
        id: 'manager-pm',
        name: 'Manager PM',
        projects: [
          {
            id: 'incubator-v5',
            name: 'Incubator v5 Platform',
            board: 'incubator-v5.sqlite',
            docs_path: docsDir
          }
        ]
      }
    ]
  };
  fs.writeFileSync(rosterPath, JSON.stringify(rosterConfig, null, 2));

  const initialIndex = `# Design Specs & Epics Index

## Active Living Blueprints

| Codename | Blueprint / Component | Status | Target Component | Description |
| :--- | :--- | :--- | :--- | :--- |
| **#d-99** | [\`telemetry-pipe\`](telemetry-pipe.md) | Open & Active | \`core\` | Real-time telemetry pipe |

---

## Closed (archived)

| Codename | Blueprint | Description |
| :--- | :--- | :--- |
`;
  fs.writeFileSync(path.join(docsDir, 'INDEX.md'), initialIndex);

  const docContent = `# Telemetry Pipe

- **Codename**: #d-99
- **Status**: Open & Active
- **Author**: manager
- **Target Component(s)**: core

## Context & Scope
Proposal for real-time telemetry pipeline.
`;
  // Design copy
  fs.writeFileSync(path.join(docsDir, 'telemetry-pipe.md'), docContent);

  const instance = await createBoardServer({
    rosterPath,
    boardsDir,
    docsDir,
    syncDocsDir,
    port: 0
  });

  try {
    // 1. Sync doc via REST API (creates the sync copy at docs/sync/manager-pm/incubator-v5/telemetry-pipe.md)
    const syncRes = await fetch(`${instance.url}/api/v1/docs/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'telemetry-pipe',
        content: docContent,
        agent: 'manager-pm',
        project: 'incubator-v5'
      })
    });
    assert.strictEqual(syncRes.status, 200);

    const syncFile = path.join(syncDocsDir, 'manager-pm', 'incubator-v5', 'telemetry-pipe.md');
    const syncArchiveFile = path.join(syncDocsDir, 'manager-pm', 'incubator-v5', 'archive', 'telemetry-pipe.md');
    assert.strictEqual(fs.existsSync(syncFile), true);
    assert.strictEqual(fs.existsSync(path.join(docsDir, 'telemetry-pipe.md')), true);

    // 2. Add 2 jobs via REST API
    const resTask1 = await fetch(`${instance.url}/api/v1/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Job 1: Ingestion Buffer',
        design_slug: 'telemetry-pipe',
        status: 'planned'
      })
    });
    assert.strictEqual(resTask1.status, 201);
    const { task: t1 } = await resTask1.json();

    const resTask2 = await fetch(`${instance.url}/api/v1/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Job 2: Flush Worker',
        design_slug: 'telemetry-pipe',
        status: 'planned'
      })
    });
    assert.strictEqual(resTask2.status, 201);
    const { task: t2 } = await resTask2.json();

    // 3. Mark Job 1 Done via REST PATCH
    const patch1 = await fetch(`${instance.url}/api/v1/tasks/${t1.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    assert.strictEqual(patch1.status, 200);

    // Doc still open (Job 2 remains)
    assert.strictEqual(fs.existsSync(path.join(docsDir, 'telemetry-pipe.md')), true);
    assert.strictEqual(fs.existsSync(syncFile), true);

    // 4. Mark Job 2 Done via REST PATCH (triggers auto-close!)
    const patch2 = await fetch(`${instance.url}/api/v1/tasks/${t2.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    assert.strictEqual(patch2.status, 200);

    // 5. Verify BOTH design copy and sync copy were archived!
    assert.strictEqual(fs.existsSync(path.join(docsDir, 'telemetry-pipe.md')), false, 'Design copy should be moved to archive');
    assert.strictEqual(fs.existsSync(path.join(docsDir, 'archive', 'telemetry-pipe.md')), true, 'Archived design copy should exist');
    assert.strictEqual(fs.existsSync(syncFile), false, 'Sync copy should be moved to archive');
    assert.strictEqual(fs.existsSync(syncArchiveFile), true, 'Archived sync copy should exist');

    // 6. Verify INDEX.md updated
    const indexAfterClose = fs.readFileSync(path.join(docsDir, 'INDEX.md'), 'utf8');
    assert.match(indexAfterClose, /##\s+Closed[\s\S]*telemetry-pipe/);

    // 7. Verify GET /api/v1/docs reports Closed
    const docsRes = await fetch(`${instance.url}/api/v1/docs`);
    assert.strictEqual(docsRes.status, 200);
    const { docs } = await docsRes.json();
    const docMeta = docs.find(d => d.slug === 'telemetry-pipe');
    assert.strictEqual(docMeta.lifecycle, 'closed');
    assert.strictEqual(docMeta.state_label, 'Closed');

    // 8. Reopen: PATCH Job 1 back to 'in-progress'
    const patchReopen = await fetch(`${instance.url}/api/v1/tasks/${t1.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in-progress' })
    });
    assert.strictEqual(patchReopen.status, 200);

    // 9. Verify BOTH copies unarchived!
    assert.strictEqual(fs.existsSync(path.join(docsDir, 'telemetry-pipe.md')), true, 'Design copy should be restored to active');
    assert.strictEqual(fs.existsSync(path.join(docsDir, 'archive', 'telemetry-pipe.md')), false);
    assert.strictEqual(fs.existsSync(syncFile), true, 'Sync copy should be restored to active');
    assert.strictEqual(fs.existsSync(syncArchiveFile), false);

    // 10. Verify INDEX.md restored
    const indexAfterReopen = fs.readFileSync(path.join(docsDir, 'INDEX.md'), 'utf8');
    assert.match(indexAfterReopen, /##\s+Active[\s\S]*telemetry-pipe/);
  } finally {
    instance.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
