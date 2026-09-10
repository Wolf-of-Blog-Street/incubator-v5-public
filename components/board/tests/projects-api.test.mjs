import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBoardServer } from '../api/server.mjs';
import { createProjectsStore } from '../engine/projectsStore.mjs';
import { createWorkspaceScanner } from '../engine/workspaceScanner.mjs';

test('Projects Catalog REST API Route Integration', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-api-test-'));
  const projectsFilePath = path.join(tmpDir, 'projects.json');
  const boardsDir = path.join(tmpDir, 'boards');
  fs.mkdirSync(boardsDir, { recursive: true });

  const operatorToken = 'test_oper_tok_12345';
  const initialProjects = [
    {
      id: 'test-repo-1',
      name: 'Test Repo 1',
      github_url: 'https://github.com/Wolf-of-Blog-Street/test-repo-1',
      description: 'First test repository',
      tags: ['core']
    }
  ];

  const projectsStore = createProjectsStore({
    filePath: projectsFilePath,
    initialProjects
  });

  const workspaceScanner = createWorkspaceScanner({
    searchRoots: [tmpDir],
    cacheTtlMs: 100
  });

  const boardServer = await createBoardServer({
    boardsDir,
    operatorToken,
    projectsStore,
    workspaceScanner,
    port: 0
  });

  const baseUrl = boardServer.url;
  const authHeaders = {
    'Authorization': `Bearer ${operatorToken}`,
    'Content-Type': 'application/json'
  };

  await t.test('1. GET /api/v1/projects returns catalog and aggregate stats', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(Array.isArray(data.projects), true);
    assert.equal(data.projects.length, 1);
    assert.equal(data.projects[0].id, 'test-repo-1');
    assert.equal(data.projects[0].isCheckedOut, false);
    assert.ok(data.stats);
    assert.equal(data.stats.totalProjects, 1);
    assert.equal(data.stats.unassignedProjects, 1);
    assert.equal(data.stats.checkedOutProjects, 0);
  });

  await t.test('2. POST /api/v1/projects creates a new project', async () => {
    const payload = {
      name: 'Second Repo',
      github_url: 'https://github.com/Wolf-of-Blog-Street/second-repo.git',
      description: 'Second test repository',
      tags: ['feature', 'tools']
    };

    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.project.id, 'second-repo');
    assert.equal(data.project.name, 'Second Repo');
    assert.deepEqual(data.project.tags, ['feature', 'tools']);

    // Confirm it appears in GET
    const listRes = await fetch(`${baseUrl}/api/v1/projects`);
    const listData = await listRes.json();
    assert.equal(listData.projects.length, 2);
    assert.equal(listData.stats.totalProjects, 2);
  });

  await t.test('3. PATCH /api/v1/projects/:id updates metadata', async () => {
    const updatePayload = {
      description: 'Updated description for second repo',
      tags: ['production']
    };

    const res = await fetch(`${baseUrl}/api/v1/projects/second-repo`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify(updatePayload)
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.project.description, 'Updated description for second repo');
    assert.deepEqual(data.project.tags, ['production']);
  });

  await t.test('4. POST /api/v1/projects/scan forces workspace inventory refresh', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/scan`, {
      method: 'POST',
      headers: authHeaders
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.scanned, true);
    assert.ok(data.stats);
    assert.equal(data.projects.length, 2);
  });

  await t.test('5. DELETE /api/v1/projects/:id removes project from catalog', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/second-repo`, {
      method: 'DELETE',
      headers: authHeaders
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.id, 'second-repo');

    // Confirm it's gone
    const listRes = await fetch(`${baseUrl}/api/v1/projects`);
    const listData = await listRes.json();
    assert.equal(listData.projects.length, 1);
    assert.equal(listData.stats.totalProjects, 1);
  });

  // Cleanup
  boardServer.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
