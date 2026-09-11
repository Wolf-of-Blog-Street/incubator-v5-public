import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installHarness } from '../tools/install.mjs';

test('installHarness installs harness, brain, board, work zones, manifest.json, and preserves HARNESS-custom.md', async () => {
  const tmpAgentHome = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-agent-home-'));

  try {
    // 1. First install
    const res1 = await installHarness({ agentHome: tmpAgentHome, initCards: true });
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/HARNESS.md')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/HARNESS-custom.md')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/manifest.json')));
    const manifest = JSON.parse(fs.readFileSync(path.join(tmpAgentHome, 'harness/manifest.json'), 'utf8'));
    assert.strictEqual(manifest.harness_version, JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version);
    assert.strictEqual(manifest.seat, path.basename(tmpAgentHome));
    assert.ok(typeof manifest.source_revision === 'string' && manifest.source_revision.length > 0);
    assert.ok(Date.parse(manifest.installed_at) > 0);

    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/engine/brain.mjs')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/components/docs/templates')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/components/brain/skills/brain-self-kickoff/SKILL.md')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/components/board/tools/board.mjs')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'brain/__source')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'boards')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'projects')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'workspaces')));
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'AGENTS.md')));
    const cardText = fs.readFileSync(path.join(tmpAgentHome, 'AGENTS.md'), 'utf8');
    assert.match(cardText, /Orientation & Workflow/i);
    assert.match(cardText, /Check Context & The Board/i);

    // 2. Modify HARNESS-custom.md with custom operator notes
    const customPath = path.join(tmpAgentHome, 'harness/HARNESS-custom.md');
    fs.writeFileSync(customPath, '# CUSTOM USER NOTES: Never delete me!', 'utf8');

    // Simulate an old AGENTS.md card
    const agentCardPath = path.join(tmpAgentHome, 'AGENTS.md');
    fs.writeFileSync(agentCardPath, '# Old Agent Entrypoint\n', 'utf8');

    // 3. Second install without upgradeCards preserves old card
    await installHarness({ agentHome: tmpAgentHome, initCards: true });
    assert.equal(fs.readFileSync(agentCardPath, 'utf8'), '# Old Agent Entrypoint\n');

    // 4. Third install with upgradeCards upgrades the card to latest template
    await installHarness({ agentHome: tmpAgentHome, upgradeCards: true });
    const upgradedCardText = fs.readFileSync(agentCardPath, 'utf8');
    assert.match(upgradedCardText, /Orientation & Workflow/i);

    // Verify custom notes were preserved across all installs
    const customContent = fs.readFileSync(customPath, 'utf8');
    assert.equal(customContent, '# CUSTOM USER NOTES: Never delete me!');
  } finally {
    fs.rmSync(tmpAgentHome, { recursive: true, force: true });
  }
});
