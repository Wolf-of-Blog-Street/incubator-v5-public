import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installHarness } from '../tools/install.mjs';

test('installHarness installs harness, brain, board, work zones, and preserves HARNESS-custom.md', () => {
  const tmpAgentHome = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-agent-home-'));

  try {
    // 1. First install
    const res1 = installHarness({ agentHome: tmpAgentHome, initCards: true });
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/HARNESS.md')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/HARNESS-custom.md')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/engine/brain.mjs')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/components/docs/templates')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/components/brain/skills/brain-self-kickoff/SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/components/board/tools/board.mjs')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'brain/__source')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'boards')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'projects')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'workspaces')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'AGENTS.md')));

    // 2. Modify HARNESS-custom.md with custom operator notes
    const customPath = path.join(tmpAgentHome, 'harness/HARNESS-custom.md');
    fs.writeFileSync(customPath, '# CUSTOM USER NOTES: Never delete me!', 'utf8');

    // 3. Second install (upgrade scenario)
    installHarness({ agentHome: tmpAgentHome, initCards: true });

    // Verify custom notes were preserved
    const customContent = fs.readFileSync(customPath, 'utf8');
    assert.equal(customContent, '# CUSTOM USER NOTES: Never delete me!');
  } finally {
    fs.rmSync(tmpAgentHome, { recursive: true, force: true });
  }
});
