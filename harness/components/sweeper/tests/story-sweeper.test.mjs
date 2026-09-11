import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  parseStoriesFromSpec,
  autoDiscoverSpec,
  resolveStories,
  formatStoriesContext
} from '../engine/storyResolver.mjs';
import { formatSummaryMarkdown, runSweep } from '../engine/sweeper.mjs';

test('storyResolver: parses user stories from markdown spec with checklist goals', () => {
  const sampleSpec = `
# Sample Epic
## 1. Context
Some background.

## 2. Goals & Explicit Non-Goals
- [ ] **Remote Doc Sync**: Discovers seat env and syncs design doc to remote server.
- [ ] **Offline Guard**: Fails loudly if remote server is unreachable.
- [x] **Local Fallback**: Preserves offline fallback when URL is omitted.

## 3. Interface Contracts
Some contracts.
`;

  const stories = parseStoriesFromSpec(sampleSpec, 'sample-epic.md');
  assert.strictEqual(stories.length, 3);
  assert.strictEqual(stories[0].id, 'STORY-1');
  assert.strictEqual(stories[0].title, 'Remote Doc Sync');
  assert.ok(stories[0].action.includes('Discovers seat env'));
  assert.strictEqual(stories[1].id, 'STORY-2');
  assert.strictEqual(stories[1].title, 'Offline Guard');
});

test('storyResolver: parses explicit user stories from text string', () => {
  const storyText = `
Agent runs board sync-doc from nested workspace and expects remote upload
---
Agent runs board add and gets task ID back without silent failures
`;

  const resolved = resolveStories({ target: 'components/board', storyText });
  assert.strictEqual(resolved.stories.length, 2);
  assert.strictEqual(resolved.stories[0].id, 'US-1');
  assert.ok(resolved.stories[0].action.includes('Agent runs board sync-doc'));
  assert.strictEqual(resolved.stories[1].id, 'US-2');
  assert.ok(resolved.stories[1].action.includes('Agent runs board add'));
});

test('storyResolver: auto-discovers matching spec for target component', () => {
  const resolved = resolveStories({ target: 'components/board' });
  assert.ok(resolved.stories.length > 0);
  assert.ok(resolved.specSource !== null);
});

test('storyResolver: formats stories context into prompt-ready markdown', () => {
  const stories = [
    {
      id: 'US-01',
      title: 'Upload Doc',
      actor: 'Agent',
      action: 'Run board sync-doc',
      expected_outcome: 'Doc appears on central board'
    }
  ];

  const formatted = formatStoriesContext(stories, 'test-spec.md');
  assert.ok(formatted.includes('## 🎯 User Stories & Intended Functionality'));
  assert.ok(formatted.includes('[US-01] Upload Doc'));
  assert.ok(formatted.includes('Doc appears on central board'));
});

test('sweeper engine: passes storiesContext through all waves to judge and formats report', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-test-'));
  const testFile = path.join(tmpDir, 'target.mjs');
  fs.writeFileSync(testFile, 'export function doSomething() { return true; }\n', 'utf8');

  const receivedContexts = [];

  const mockDriver = {
    async executeWave1(args) {
      receivedContexts.push(args.storiesContext);
      return { wave: 1, hunter: 'mock-3.6', findings: [] };
    },
    async executeWave2(args) {
      receivedContexts.push(args.storiesContext);
      return { wave: 2, hunter: 'mock-3.8', findings: [] };
    },
    async executeWave3(args) {
      receivedContexts.push(args.storiesContext);
      return { wave: 3, role: 'story-reproduction-engineer', tests: [] };
    },
    async executeJudge(args) {
      receivedContexts.push(args.storiesContext);
      return {
        verdict: 'clean',
        judge: 'mock-judge',
        summary: { total_reviewed: 0, stamped_verified: 0, discarded_trivia: 0 },
        stamped_bugs: [],
        discarded_findings: []
      };
    }
  };

  try {
    const sweepRes = await runSweep({
      target: testFile,
      baseDir: tmpDir,
      runDir: path.join(tmpDir, 'run'),
      llmDriver: mockDriver,
      story: 'User expects doSomething to return true and not throw'
    });

    assert.strictEqual(receivedContexts.length, 4, 'All 4 phases must receive storiesContext');
    assert.ok(receivedContexts[0].includes('User expects doSomething to return true'));
    assert.ok(sweepRes.summaryMd.includes('**User Stories Audited**: 1'));
    assert.ok(sweepRes.summaryMd.includes('User expects doSomething to return true'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
