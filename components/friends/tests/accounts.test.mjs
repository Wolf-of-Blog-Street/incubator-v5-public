import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  openAccountStore,
  encryptCredential,
  decryptCredential,
  maskSecret
} from '../engine/accounts.mjs';

test('Account Pool — Credential Encryption & Masking', () => {
  const secret = 'sk-ant-api03-very-secret-token-key-1234567890';
  const encrypted = encryptCredential(secret);
  assert.notEqual(encrypted, secret);
  assert.ok(encrypted.includes(':'));

  const decrypted = decryptCredential(encrypted);
  assert.equal(decrypted, secret);

  const masked = maskSecret(secret);
  assert.ok(masked.startsWith('sk-a'));
  assert.ok(masked.endsWith('7890'));
  assert.ok(!masked.includes('very-secret'));
});

test('Account Pool — Lifecycle & Failover Rotation', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-accounts-test-'));
  const storagePath = path.join(tmpDir, 'accounts.json');
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const store = openAccountStore({ storagePath });

  // 1. Add primary and secondary accounts
  const acc1 = store.addAccount({
    id: 'claude-primary',
    provider: 'claude',
    type: 'api_key',
    label: 'Claude Primary Key',
    credentials: { apiKey: 'sk-ant-primary-secret-key-1111' },
    assignedAgents: ['manager-pm', 'example-pa']
  });

  const acc2 = store.addAccount({
    id: 'claude-backup',
    provider: 'claude',
    type: 'api_key',
    label: 'Claude Backup Key',
    credentials: { apiKey: 'sk-ant-backup-secret-key-2222' },
    assignedAgents: ['all']
  });

  assert.equal(acc1.id, 'claude-primary');
  assert.equal(acc2.id, 'claude-backup');
  // Secrets must be masked by default
  assert.ok(acc1.credentials.apiKey.includes('...'));

  // 2. Initial selection picks the first available
  const selected1 = store.getHealthyAccount('claude', 'manager-pm');
  assert.ok(selected1);
  assert.equal(selected1.id, 'claude-primary');
  assert.equal(selected1.credentials.apiKey, 'sk-ant-primary-secret-key-1111');

  // Record success on acc1
  store.recordSuccess(selected1.id);

  // 3. Next selection picks acc2 because acc1 has a newer lastUsedAt
  const selected2 = store.getHealthyAccount('claude', 'manager-pm');
  assert.equal(selected2.id, 'claude-backup');

  // 4. Test Rate-Limit Failover
  store.recordRateLimit('claude-primary', 5000);
  const coolingAcc = store.getAccount('claude-primary');
  assert.equal(coolingAcc.status, 'cooling');
  assert.ok(coolingAcc.coolingUntil > Date.now());

  // While primary is cooling, getHealthyAccount must return the backup
  const failover = store.getHealthyAccount('claude', 'manager-pm');
  assert.equal(failover.id, 'claude-backup');

  // If backup is also rate limited, pool returns null
  store.recordRateLimit('claude-backup', 5000);
  const exhausted = store.getHealthyAccount('claude', 'manager-pm');
  assert.equal(exhausted, null);

  // 5. Automatic cooling recovery when timestamp passes
  store.updateAccount('claude-primary', { coolingUntil: Date.now() - 1000 });
  const recovered = store.getHealthyAccount('claude', 'manager-pm');
  assert.equal(recovered.id, 'claude-primary');
  assert.equal(recovered.status, 'healthy');
});

test('Account Pool — Tenant Agent Assignment Isolation', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-accounts-tenant-'));
  const storagePath = path.join(tmpDir, 'accounts.json');
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const store = openAccountStore({ storagePath });

  store.addAccount({
    id: 'codex-falcon-only',
    provider: 'codex',
    type: 'api_key',
    credentials: { apiKey: 'sk-codex-falcon' },
    assignedAgents: ['example-pa']
  });

  // example-pa can access it
  const forFalcon = store.getHealthyAccount('codex', 'example-pa');
  assert.ok(forFalcon);
  assert.equal(forFalcon.id, 'codex-falcon-only');

  // other agent seats cannot access it
  const forManager = store.getHealthyAccount('codex', 'manager-pm');
  assert.equal(forManager, null);
});
