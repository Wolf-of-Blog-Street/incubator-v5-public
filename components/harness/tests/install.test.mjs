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

test('installHarness installs default skills for Claude (.claude/skills) and Codex/OpenCode/agy (.agents/skills), and leaves seat-added skills alone', async () => {
  const tmpAgentHome = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-agent-home-'));
  try {
    // Seat-owned skill that must survive an install
    const ownSkill = path.join(tmpAgentHome, '.claude/skills/my-own-skill');
    fs.mkdirSync(ownSkill, { recursive: true });
    fs.writeFileSync(path.join(ownSkill, 'SKILL.md'), '# mine\n');

    const res = await installHarness({ agentHome: tmpAgentHome });
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/tools/viewers/render.mjs')), 'viewers renderer at the path the skill names');
    assert.ok(fs.existsSync(path.join(tmpAgentHome, 'harness/tools/viewers/lib/themes/dark1.css')), 'viewers theme shipped');
    // no-clobber: a file the seat edited after install is kept; the new version lands beside it
    const themePath = path.join(tmpAgentHome, 'harness/tools/viewers/lib/themes/dark1.css');
    const m1 = JSON.parse(fs.readFileSync(path.join(tmpAgentHome, 'harness/manifest.json'), 'utf8'));
    assert.ok(m1.files['tools/viewers/lib/themes/dark1.css'], 'manifest records shipped file hashes');
    fs.appendFileSync(themePath, '\n/* seat edit */\n');
    const res2 = await installHarness({ agentHome: tmpAgentHome });
    assert.match(fs.readFileSync(themePath, 'utf8'), /seat edit/, 'local edit survives a reinstall');
    assert.ok(fs.existsSync(themePath + '.shipped'), 'shipped version placed beside the kept file');
    assert.deepEqual(res2.manifest.kept_local, ['tools/viewers/lib/themes/dark1.css']);
    const wmPath = path.join(tmpAgentHome, 'brain/__source/working-memory.md');
    assert.ok(fs.existsSync(wmPath), 'default working-memory card seeded');
    fs.writeFileSync(wmPath, 'KEEP');
    await installHarness({ agentHome: tmpAgentHome });
    assert.equal(fs.readFileSync(wmPath, 'utf8'), 'KEEP', 'existing default card never overwritten');
    for (const skill of ['brain-self-kickoff', 'context-load', 'brain-session-end', 'viewers', 'opus-writer', 'world-class-hooks', 'friends']) {
      assert.ok(fs.existsSync(path.join(tmpAgentHome, '.claude/skills', skill, 'SKILL.md')), `${skill} in .claude/skills`);
      assert.ok(fs.existsSync(path.join(tmpAgentHome, '.agents/skills', skill, 'SKILL.md')), `${skill} in .agents/skills`);
      assert.ok(res.manifest.skills.includes(skill), `${skill} recorded in manifest`);
    }
    assert.equal(fs.readFileSync(path.join(ownSkill, 'SKILL.md'), 'utf8'), '# mine\n');
    // SessionStart hook merged into .claude/settings.json, existing keys kept, idempotent
    const settingsPath = path.join(tmpAgentHome, '.claude/settings.json');
    const st = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(st.hooks.SessionStart.length, 1);
    assert.equal(st.hooks.SessionStart[0].hooks[0].command, 'node harness/components/brain/tools/session-start.mjs');
    fs.writeFileSync(settingsPath, JSON.stringify({ ...st, env: { KEEP: '1' } }, null, 2));
    await installHarness({ agentHome: tmpAgentHome });
    const st2 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(st2.env.KEEP, '1');
    assert.equal(st2.hooks.SessionStart.length, 1);
    for (const pack of ['full-sample-1', 'world-class-hooks', 'fear-hooks', 'bhw-titles']) {
      assert.ok(fs.existsSync(path.join(tmpAgentHome, 'data/opus-writer/voice-pack', `${pack}.md`)), `${pack} voice pack installed`);
    }
  } finally {
    fs.rmSync(tmpAgentHome, { recursive: true, force: true });
  }
});
