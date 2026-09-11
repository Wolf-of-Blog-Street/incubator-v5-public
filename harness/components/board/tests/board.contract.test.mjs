import test from 'node:test';
import assert from 'node:assert/strict';
import { openBoard, VALID_STATUSES, VALID_MODES } from '../engine/board.mjs';
import { openRoster, validateAgentId, AgentNotFoundError } from '../engine/roster.mjs';
import {
  generateToken,
  hashToken,
  verifyToken,
  extractBearerToken,
  authenticateRequest,
  assertTenantAccess,
  UnauthorizedError,
  ForbiddenError
} from '../engine/auth.mjs';

test('Board Engine Contract: Task state transitions, modes, and filtering in-process', () => {
  const board = openBoard(':memory:');

  // Verify status and mode definitions
  assert.ok(VALID_STATUSES.includes('planned'));
  assert.ok(VALID_STATUSES.includes('in-progress'));
  assert.ok(VALID_STATUSES.includes('done'));
  assert.ok(VALID_MODES.includes('pair'));
  assert.ok(VALID_MODES.includes('runner'));

  // 1. Create items
  const id1 = board.addItem({ title: 'Task Alpha', design_slug: 'epic-1', track: 'core', mode: 'pair' });
  const id2 = board.addItem({ title: 'Task Beta', design_slug: 'epic-1', track: 'ux', mode: 'runner' });
  assert.strictEqual(id1, 1);
  assert.strictEqual(id2, 2);

  // 2. Summary & Stats
  const summary = board.getStageSummary('epic-1');
  assert.strictEqual(summary.total, 2);
  assert.strictEqual(summary.done, 0);
  assert.strictEqual(summary.percentComplete, 0);

  // 3. Status update
  board.updateItem(id1, { status: 'done' });
  const updated1 = board.getItem(id1);
  assert.strictEqual(updated1.status, 'done');

  // 4. Mode filter
  const runnerTasks = board.listItems({ mode: 'runner' });
  assert.strictEqual(runnerTasks.length, 1);
  assert.strictEqual(runnerTasks[0].id, 2);

  // 5. Doc close guard contract
  const blockedClose = board.closeDesignDoc('epic-1', { force: false });
  assert.strictEqual(blockedClose.closed, false);
  assert.strictEqual(blockedClose.openTasks.length, 1);

  // Mark all done
  board.updateItem(id2, { status: 'done' });
  const successfulClose = board.closeDesignDoc('epic-1', { force: false });
  assert.strictEqual(successfulClose.closed, true);

  board.close();
});

test('Roster & Security Contract: Agent ID validation and anti-traversal invariant', () => {
  // Safe agent IDs
  assert.doesNotThrow(() => validateAgentId('manager-pm'));
  assert.doesNotThrow(() => validateAgentId('agent_123'));
  assert.doesNotThrow(() => validateAgentId('seat-dev-1'));

  // Hostile / Traversal agent IDs
  assert.throws(() => validateAgentId('../escape'), /Invalid agent ID/i);
  assert.throws(() => validateAgentId('/root/dir'), /Invalid agent ID/i);
  assert.throws(() => validateAgentId('agent;rm -rf'), /Invalid agent ID/i);
  assert.throws(() => validateAgentId(''), /Invalid agent ID/i);
  assert.throws(() => validateAgentId(null), /Invalid agent ID/i);

  // CLI argument injection prevention (SEC-01 from bug audit)
  const hostileIds = ['--comment', '-rf', '--help', '---test', '  '];
  for (const hid of hostileIds) {
    assert.throws(() => validateAgentId(hid), /Invalid agent ID/i, `Must reject ${hid}`);
  }
});

test('Auth Engine Contract: Token hashing, bearer extraction, and cryptographic verification', () => {
  const plainToken = generateToken('sec_test_');
  assert.ok(plainToken.startsWith('sec_test_'));
  assert.ok(plainToken.length > 20);

  const hashed = hashToken(plainToken);
  assert.ok(hashed.startsWith('sha256:'));
  assert.strictEqual(hashed.length, 7 + 64);

  // Verification invariants
  assert.strictEqual(verifyToken(plainToken, hashed), true);
  assert.strictEqual(verifyToken(plainToken, plainToken), true);
  assert.strictEqual(verifyToken('wrong-token', hashed), false);
  assert.strictEqual(verifyToken('', hashed), false);
  assert.strictEqual(verifyToken(null, hashed), false);

  // Bearer parsing
  assert.strictEqual(extractBearerToken('Bearer secret-token-123'), 'secret-token-123');
  assert.strictEqual(extractBearerToken('bearer lower-token'), 'lower-token');
  assert.strictEqual(extractBearerToken('Basic admin:secret'), null);
  assert.strictEqual(extractBearerToken(''), null);
  assert.strictEqual(extractBearerToken(undefined), null);

  // Multi-tenant assertion invariants
  const agents = [
    { id: 'agent-a', token_hash: hashToken('tok-a') },
    { id: 'agent-b', token: 'tok-b' }
  ];

  // Operator auth passes any agent
  const opAuth = authenticateRequest({ authHeader: 'Bearer op-secret', agents, operatorToken: 'op-secret' });
  assert.strictEqual(opAuth.isOperator, true);
  assert.doesNotThrow(() => assertTenantAccess({ authenticatedAgentId: opAuth.agentId, targetAgentId: 'agent-a', isOperator: opAuth.isOperator }));
  assert.doesNotThrow(() => assertTenantAccess({ authenticatedAgentId: opAuth.agentId, targetAgentId: 'agent-b', isOperator: opAuth.isOperator }));

  // Scoped agent auth passes own, throws on foreign
  const agentAuthA = authenticateRequest({ authHeader: 'Bearer tok-a', agents, operatorToken: 'op-secret' });
  assert.strictEqual(agentAuthA.agentId, 'agent-a');
  assert.doesNotThrow(() => assertTenantAccess({ authenticatedAgentId: agentAuthA.agentId, targetAgentId: 'agent-a', isOperator: agentAuthA.isOperator }));
  assert.throws(() => assertTenantAccess({ authenticatedAgentId: agentAuthA.agentId, targetAgentId: 'agent-b', isOperator: agentAuthA.isOperator }), ForbiddenError);
});

test('Upward Board Directory Resolution: Prevents database fragmentation in subdirectories', async () => {
  const { findBoardsDir, findDefaultDb } = await import('../tools/board/parser.mjs');
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boards-upward-test-')));
  try {
    const rootBoards = path.join(root, 'boards');
    fs.mkdirSync(rootBoards, { recursive: true });

    const nestedSubdir = path.join(root, 'workspaces', 'sub-agent', 'deep-folder');
    fs.mkdirSync(nestedSubdir, { recursive: true });

    // Calling findBoardsDir from nested folder must resolve root's boards directory
    const resolved = findBoardsDir(nestedSubdir);
    assert.strictEqual(resolved, rootBoards);

    // findDefaultDb with project name resolves inside the upward found boards directory
    const prevCwd = process.cwd();
    try {
      process.chdir(nestedSubdir);
      const dbPath = findDefaultDb('falcon-proj');
      assert.strictEqual(dbPath, path.join(rootBoards, 'falcon-proj.sqlite'));
    } finally {
      process.chdir(prevCwd);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ProjectsStore Safety Guard: Corrupted catalog creates backup before overwrite', async () => {
  const { createProjectsStore } = await import('../engine/projectsStore.mjs');
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-corrupt-test-'));
  try {
    const catalogFile = path.join(tmpDir, 'projects.json');
    const corruptContent = '{\n  "projects": [ { "id": "original", "name": "Broken JSON\n';
    fs.writeFileSync(catalogFile, corruptContent, 'utf8');

    const store = createProjectsStore({ filePath: catalogFile });
    // Adding a project should trigger persist, which backs up the corrupted file
    store.addProject({
      name: 'New Project',
      github_url: 'https://github.com/org/new-proj'
    });

    // Check that a .corrupted backup was created
    const files = fs.readdirSync(tmpDir);
    const backup = files.find(f => f.startsWith('projects.json.corrupted.'));
    assert.ok(backup, 'Corrupted backup file must exist');

    const backedUpContent = fs.readFileSync(path.join(tmpDir, backup), 'utf8');
    assert.strictEqual(backedUpContent, corruptContent);

    // Check that new catalog is valid JSON with the new project
    const newCatalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    assert.strictEqual(newCatalog.projects.length, 1);
    assert.strictEqual(newCatalog.projects[0].id, 'new-proj');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

