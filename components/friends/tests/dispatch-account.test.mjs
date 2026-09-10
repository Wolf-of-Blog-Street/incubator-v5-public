import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { dispatchFriend } from '../engine/friends.mjs';
import { openAccountStore } from '../engine/accounts.mjs';

test('Dispatch Friend — Injects Sandboxed Auth & Environment', async (t) => {
  const tmpAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-dispatch-auth-'));
  const accountsPath = path.join(tmpAuthDir, 'accounts.json');
  t.after(() => {
    fs.rmSync(tmpAuthDir, { recursive: true, force: true });
  });

  const store = openAccountStore({ storagePath: accountsPath });

  // Add sandboxed test account
  store.addAccount({
    id: 'claude-auto-test',
    provider: 'claude',
    type: 'api_key',
    label: 'Test Claude Key',
    credentials: { apiKey: 'sk-ant-test-dispatch-key-999' },
    assignedAgents: ['all']
  });

  // Create a mock executable script to verify environment injection
  const scriptPath = path.join(tmpAuthDir, 'mock-claude.sh');
  fs.writeFileSync(scriptPath, `#!/bin/sh
echo "CONFIG=$CLAUDE_CONFIG_DIR"
echo "KEY=$ANTHROPIC_API_KEY"
exit 0
`, { mode: 0o755 });

  // Override catalog with mock binary
  const customConfigPath = path.join(tmpAuthDir, 'friends.json');
  fs.writeFileSync(customConfigPath, JSON.stringify({
    claude: {
      binary: scriptPath,
      defaultFlags: []
    }
  }));

  const report = await dispatchFriend('claude', {
    prompt: 'hello world',
    noJj: true,
    baseAuthDir: tmpAuthDir,
    accountsPath,
    configPath: customConfigPath,
    agentId: 'manager-pm'
  });

  assert.equal(report.exitCode, 0);
  assert.equal(report.accountId, 'claude-auto-test');

  // Verify that CLAUDE_CONFIG_DIR points to sandboxed path
  const expectedDir = path.join(tmpAuthDir, 'agents', 'manager-pm', 'friends', 'claude');
  assert.ok(report.stdout.includes(`CONFIG=${expectedDir}`));
  assert.ok(report.stdout.includes('KEY=sk-ant-test-dispatch-key-999'));

  // Verify success was recorded on account
  const updatedAcc = store.getAccount('claude-auto-test');
  assert.ok(updatedAcc.lastUsedAt);
  assert.equal(updatedAcc.status, 'healthy');
});

test('Dispatch Friend — Rate Limit 429 Detection & Cooling Record', async (t) => {
  const tmpAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-dispatch-rate-'));
  const accountsPath = path.join(tmpAuthDir, 'accounts.json');
  t.after(() => {
    fs.rmSync(tmpAuthDir, { recursive: true, force: true });
  });

  const store = openAccountStore({ storagePath: accountsPath });

  store.addAccount({
    id: 'codex-rate-limited',
    provider: 'codex',
    type: 'api_key',
    credentials: { apiKey: 'sk-rate-test' },
    assignedAgents: ['all']
  });

  // Mock script simulating 429 rate limit
  const scriptPath = path.join(tmpAuthDir, 'mock-codex-429.sh');
  fs.writeFileSync(scriptPath, `#!/bin/sh
echo "Error: 429 Too Many Requests: Rate limit exceeded" >&2
exit 1
`, { mode: 0o755 });

  const customConfigPath = path.join(tmpAuthDir, 'friends.json');
  fs.writeFileSync(customConfigPath, JSON.stringify({
    codex: {
      binary: scriptPath,
      defaultFlags: []
    }
  }));

  const report = await dispatchFriend('codex', {
    prompt: 'test prompt',
    noJj: true,
    baseAuthDir: tmpAuthDir,
    accountsPath,
    configPath: customConfigPath,
    agentId: 'manager-pm'
  });

  assert.equal(report.exitCode, 1);
  assert.equal(report.isRateLimited, true);

  // Verify account in store was placed into cooling state
  const updatedAcc = store.getAccount('codex-rate-limited');
  assert.equal(updatedAcc.status, 'cooling');
  assert.ok(updatedAcc.coolingUntil > Date.now());
  assert.equal(updatedAcc.rateLimitCount, 1);
});
