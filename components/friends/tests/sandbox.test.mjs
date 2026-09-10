import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  validateAgentId,
  resolveFriendEnvironment,
  assertZeroLeakage,
  SUPPORTED_PROVIDERS
} from '../engine/sandbox.mjs';

test('Sandbox Engine — validateAgentId validates agent identifiers', () => {
  assert.equal(validateAgentId('manager-pm'), 'manager-pm');
  assert.equal(validateAgentId('falcon_pa_1'), 'falcon_pa_1');
  assert.equal(validateAgentId('agent-b-2'), 'agent-b-2');

  assert.throws(() => validateAgentId(''), /non-empty string/);
  assert.throws(() => validateAgentId('   '), /non-empty string/);
  assert.throws(() => validateAgentId('../escape'), /Invalid agent ID/);
  assert.throws(() => validateAgentId('agent/seat'), /Invalid agent ID/);
  assert.throws(() => validateAgentId('agent$1'), /Invalid agent ID/);
});

test('Sandbox Engine — resolveFriendEnvironment provisions isolated Claude sandbox', (t) => {
  const tmpAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-test-auth-'));
  t.after(() => {
    fs.rmSync(tmpAuthDir, { recursive: true, force: true });
  });

  const res = resolveFriendEnvironment({
    provider: 'claude',
    agentId: 'test-agent',
    baseAuthDir: tmpAuthDir
  });

  assert.equal(res.provider, 'claude');
  assert.equal(res.agentId, 'test-agent');
  assert.equal(res.configDir, path.join(tmpAuthDir, 'agents', 'test-agent', 'friends', 'claude'));
  assert.equal(res.env.CLAUDE_CONFIG_DIR, res.configDir);
  assert.equal(res.env.DISABLE_AUTOUPDATER, '1');

  // Verify directory exists
  assert.ok(fs.existsSync(res.configDir));

  // Verify .claude.json skeleton exists
  const configJsonPath = path.join(res.configDir, '.claude.json');
  assert.ok(fs.existsSync(configJsonPath));
  const parsed = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
  assert.equal(parsed.hasCompletedOnboarding, true);
  assert.equal(parsed.theme, 'dark');

  // Verify zero leakage assert passes
  assert.ok(assertZeroLeakage('claude', res.env));
});

test('Sandbox Engine — resolveFriendEnvironment provisions isolated Codex sandbox', (t) => {
  const tmpAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-test-auth-'));
  t.after(() => {
    fs.rmSync(tmpAuthDir, { recursive: true, force: true });
  });

  const res = resolveFriendEnvironment({
    provider: 'codex',
    agentId: 'test-agent',
    baseAuthDir: tmpAuthDir
  });

  assert.equal(res.provider, 'codex');
  assert.equal(res.configDir, path.join(tmpAuthDir, 'agents', 'test-agent', 'friends', 'codex'));
  assert.equal(res.env.CODEX_HOME, res.configDir);

  const tomlPath = path.join(res.configDir, 'config.toml');
  assert.ok(fs.existsSync(tomlPath));

  assert.ok(assertZeroLeakage('codex', res.env));
});

test('Sandbox Engine — assertZeroLeakage flags dangerous personal paths', () => {
  const home = os.homedir();
  const personalClaude = path.join(home, '.claude');
  const personalCodex = path.join(home, '.codex');

  // Claude leaks
  assert.throws(() => {
    assertZeroLeakage('claude', { CLAUDE_CONFIG_DIR: personalClaude });
  }, /Sandbox violation/);

  assert.throws(() => {
    assertZeroLeakage('claude', { CLAUDE_CONFIG_DIR: home });
  }, /Sandbox violation/);

  assert.throws(() => {
    assertZeroLeakage('claude', {});
  }, /CLAUDE_CONFIG_DIR is not set/);

  // Codex leaks
  assert.throws(() => {
    assertZeroLeakage('codex', { CODEX_HOME: personalCodex });
  }, /Sandbox violation/);

  assert.throws(() => {
    assertZeroLeakage('codex', {});
  }, /CODEX_HOME is not set/);
});
