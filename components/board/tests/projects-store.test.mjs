import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  slugify,
  deriveIdFromGithubUrl,
  isValidGithubUrl,
  createProjectsStore
} from '../engine/projectsStore.mjs';
import {
  normalizeGithubSlug,
  readGitWorktreeInfo,
  createWorkspaceScanner
} from '../engine/workspaceScanner.mjs';

test('GitHub Projects Store & Live Workspace Scanner Contracts', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-test-'));
  const projectsFilePath = path.join(tmpDir, 'projects.json');

  await t.test('1. URL Normalization & Slug Utility Contracts', () => {
    // Slugs
    assert.equal(slugify('Project Alpha'), 'project-alpha');
    assert.equal(slugify('  My Awesome Project! 123 '), 'my-awesome-project-123');
    assert.equal(slugify(''), '');

    // Derive ID from URL
    assert.equal(deriveIdFromGithubUrl('https://github.com/Wolf-of-Blog-Street/project-alpha.git'), 'project-alpha');
    assert.equal(deriveIdFromGithubUrl('git@github.com:org/my-service.git'), 'my-service');
    assert.equal(deriveIdFromGithubUrl('https://github.com/org/trailing-slash/'), 'trailing-slash');

    // Valid GitHub URLs
    assert.equal(isValidGithubUrl('https://github.com/Wolf-of-Blog-Street/project-alpha'), true);
    assert.equal(isValidGithubUrl('git@github.com:Wolf-of-Blog-Street/project-alpha.git'), true);
    assert.equal(isValidGithubUrl('http://github.com/org/repo.git'), true);
    assert.equal(isValidGithubUrl('https://gitlab.com/org/repo'), false);
    assert.equal(isValidGithubUrl('invalid-url'), false);

    // GitHub Slug Normalization (SSH vs HTTPS vs Case)
    assert.equal(
      normalizeGithubSlug('https://github.com/Wolf-of-Blog-Street/project-alpha.git'),
      'wolf-of-blog-street/project-alpha'
    );
    assert.equal(
      normalizeGithubSlug('git@github.com:Wolf-of-Blog-Street/project-alpha.git'),
      'wolf-of-blog-street/project-alpha'
    );
    assert.equal(
      normalizeGithubSlug('https://github.com/Wolf-of-Blog-Street/project-alpha/'),
      'wolf-of-blog-street/project-alpha'
    );
    assert.equal(normalizeGithubSlug('not-a-github-url'), null);
  });

  await t.test('2. ProjectsStore CRUD & Atomic Persistence Contract', () => {
    const store = createProjectsStore({ filePath: projectsFilePath });

    // Initial list is empty
    assert.deepEqual(store.listProjects(), []);

    // Add project
    const p1 = store.addProject({
      id: 'project-alpha',
      name: 'Project Alpha',
      github_url: 'https://github.com/Wolf-of-Blog-Street/project-alpha',
      description: 'Catalina SERP engine',
      tags: ['SEO', 'Client']
    });

    assert.equal(p1.id, 'project-alpha');
    assert.equal(p1.name, 'Project Alpha');
    assert.deepEqual(p1.tags, ['seo', 'client']);
    assert.ok(p1.created_at);
    assert.ok(p1.updated_at);

    // Verify file exists on disk with valid JSON
    assert.ok(fs.existsSync(projectsFilePath));
    const diskContent = JSON.parse(fs.readFileSync(projectsFilePath, 'utf8'));
    assert.equal(diskContent.projects.length, 1);
    assert.equal(diskContent.projects[0].id, 'project-alpha');

    // Duplicate addition throws error
    assert.throws(() => {
      store.addProject({
        id: 'project-alpha',
        github_url: 'https://github.com/Wolf-of-Blog-Street/project-alpha'
      });
    }, /already exists/);

    // Add second project with auto-derived ID and name
    const p2 = store.addProject({
      github_url: 'https://github.com/Wolf-of-Blog-Street/project-beta.git'
    });
    assert.equal(p2.id, 'project-beta');
    assert.equal(p2.name, 'Project Beta');

    // Get project
    const fetched = store.getProject('project-alpha');
    assert.equal(fetched.name, 'Project Alpha');
    assert.equal(store.getProject('non-existent'), null);

    // Update project
    const updated = store.updateProject('project-alpha', {
      description: 'Updated Catalina SERP platform description',
      tags: ['seo', 'enterprise', 'v5']
    });
    assert.equal(updated.description, 'Updated Catalina SERP platform description');
    assert.deepEqual(updated.tags, ['seo', 'enterprise', 'v5']);

    // Delete project
    const deleted = store.deleteProject('project-beta');
    assert.equal(deleted, true);
    assert.equal(store.listProjects().length, 1);
    assert.equal(store.deleteProject('non-existent'), false);

    // Reload from disk
    store.reload();
    assert.equal(store.listProjects().length, 1);
    assert.equal(store.getProject('project-alpha').tags.length, 3);
  });

  await t.test('3. Live Workspace Scanner & Synthesis Contract', () => {
    // Setup mock seats in tmp directory
    const seatSplish = path.join(tmpDir, 'seats', 'agent-d-pm');
    const wsSplish = path.join(seatSplish, 'workspaces', 'project-alpha');
    fs.mkdirSync(path.join(wsSplish, '.git'), { recursive: true });

    // Mock git config in agent-d workspace
    fs.writeFileSync(
      path.join(wsSplish, '.git', 'config'),
      '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/Wolf-of-Blog-Street/project-alpha.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
    );
    fs.writeFileSync(path.join(wsSplish, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    // Setup another seat with different project
    const seatManager = path.join(tmpDir, 'seats', 'manager-pm');
    const wsManager = path.join(seatManager, 'workspaces', 'incubator-v5');
    fs.mkdirSync(path.join(wsManager, '.git'), { recursive: true });
    fs.writeFileSync(
      path.join(wsManager, '.git', 'config'),
      '[remote "origin"]\n\turl = git@github.com:Wolf-of-Blog-Street/incubator-v5.git\n'
    );

    // Test readGitWorktreeInfo
    const gitInfo = readGitWorktreeInfo(wsSplish);
    assert.equal(gitInfo.isGitRepo, true);
    assert.equal(gitInfo.currentBranch, 'main');
    assert.equal(gitInfo.normalizedSlug, 'wolf-of-blog-street/project-alpha');

    // Test Scanner Synthesis
    const scanner = createWorkspaceScanner({
      searchRoots: [path.join(tmpDir, 'seats', 'agent-d-pm'), path.join(tmpDir, 'seats', 'manager-pm')],
      cacheTtlMs: 50
    });

    const catalog = [
      {
        id: 'project-alpha',
        name: 'Project Alpha',
        github_url: 'https://github.com/Wolf-of-Blog-Street/project-alpha',
        description: 'SEO engine'
      },
      {
        id: 'incubator-v5',
        name: 'Incubator v5',
        github_url: 'https://github.com/Wolf-of-Blog-Street/incubator-v5',
        description: 'Core platform'
      },
      {
        id: 'unassigned-repo',
        name: 'Unassigned Repo',
        github_url: 'https://github.com/Wolf-of-Blog-Street/unassigned-repo',
        description: 'Unassigned test repository'
      }
    ];

    const roster = [
      { id: 'agent-d-pm', name: 'Agent D SEO', icon: '🤖', color: 'emerald' },
      { id: 'manager-pm', name: 'Manager PM', icon: '🛡️', color: 'cyan' }
    ];

    const inventory = scanner.scanLiveInventory(catalog, roster);

    assert.equal(inventory.stats.totalProjects, 3);
    assert.equal(inventory.stats.checkedOutProjects, 2);
    assert.equal(inventory.stats.unassignedProjects, 1);
    assert.equal(inventory.stats.activeAgentSeats, 2);

    // Project 1: Checked out by Agent D
    const seoProj = inventory.projects.find(p => p.id === 'project-alpha');
    assert.equal(seoProj.isCheckedOut, true);
    assert.equal(seoProj.checkoutCount, 1);
    assert.equal(seoProj.checkedOutBy[0].agentId, 'agent-d-pm');
    assert.equal(seoProj.checkedOutBy[0].agentName, 'Agent D SEO');
    assert.equal(seoProj.checkedOutBy[0].workspacePath, 'workspaces/project-alpha');

    // Project 2: Checked out by Manager
    const incProj = inventory.projects.find(p => p.id === 'incubator-v5');
    assert.equal(incProj.isCheckedOut, true);
    assert.equal(incProj.checkedOutBy[0].agentId, 'manager-pm');

    // Project 3: Unassigned (explicit dormant notice state)
    const unassignedProj = inventory.projects.find(p => p.id === 'unassigned-repo');
    assert.equal(unassignedProj.isCheckedOut, false);
    assert.equal(unassignedProj.checkoutCount, 0);
    assert.deepEqual(unassignedProj.checkedOutBy, []);
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
