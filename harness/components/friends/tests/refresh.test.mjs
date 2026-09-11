import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { openAccountStore } from '../engine/accounts.mjs';
import {
  isTokenExpiringSoon,
  getTokenRemainingMinutes,
  refreshAccountToken,
  auditAuthHealth,
  autoRenewExpiringAccounts,
  startAuthHeartbeatDaemon
} from '../engine/refresh.mjs';

test('Credential Refresh — Token TTL Detection', () => {
  const now = Date.now();

  const healthyAccount = {
    type: 'oauth',
    credentials: {
      oauth: { expiresAt: now + (120 * 60 * 1000) } // 2 hours remaining
    }
  };

  const expiringAccount = {
    type: 'oauth',
    credentials: {
      oauth: { expiresAt: now + (15 * 60 * 1000) } // 15 mins remaining
    }
  };

  const apiKeyAccount = {
    type: 'api_key',
    credentials: { apiKey: 'sk-ant-test' }
  };

  assert.equal(isTokenExpiringSoon(healthyAccount, 30), false);
  assert.equal(isTokenExpiringSoon(expiringAccount, 30), true);
  assert.equal(isTokenExpiringSoon(apiKeyAccount, 30), false);

  assert.ok(getTokenRemainingMinutes(healthyAccount) >= 119);
  assert.ok(getTokenRemainingMinutes(expiringAccount) <= 16);
  assert.equal(getTokenRemainingMinutes(apiKeyAccount), null);
});

test('Credential Refresh — Headless Token Renewal & Auto-Renew', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-refresh-test-'));
  const storagePath = path.join(tmpDir, 'accounts.json');
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const store = openAccountStore({ storagePath });

  // 1. Add an expiring OAuth account
  const now = Date.now();
  store.addAccount({
    id: 'claude-oauth-expiring',
    provider: 'claude',
    type: 'oauth',
    label: 'Claude OAuth Seat',
    credentials: {
      oauth: {
        accessToken: 'old_access_token_123',
        refreshToken: 'valid_refresh_token_456',
        expiresAt: now + (10 * 60 * 1000) // 10 minutes left
      }
    }
  });

  // 2. Add an API Key account (never expires)
  store.addAccount({
    id: 'codex-api-key',
    provider: 'codex',
    type: 'api_key',
    credentials: { apiKey: 'sk-codex-123' }
  });

  // 3. Verify auditAuthHealth detects expiring status
  const audit1 = auditAuthHealth(store, { thresholdMinutes: 30 });
  assert.equal(audit1.total, 2);
  assert.equal(audit1.expiringSoon, 1);
  assert.equal(audit1.healthy, 1);

  // 4. Trigger autoRenewExpiringAccounts
  const renewResults = await autoRenewExpiringAccounts(store, {
    thresholdMinutes: 30,
    simulatedTtlSeconds: 7200
  });

  assert.equal(renewResults.length, 1);
  assert.equal(renewResults[0].success, true);
  assert.equal(renewResults[0].renewed, true);

  // 5. Verify audit after renewal
  const audit2 = auditAuthHealth(store, { thresholdMinutes: 30 });
  assert.equal(audit2.expiringSoon, 0);
  assert.equal(audit2.healthy, 2);

  // Verify new token expiration is ~2 hours in future
  const renewedAccount = store.getAccount('claude-oauth-expiring', { includeSecrets: true });
  assert.ok(renewedAccount.credentials.oauth.expiresAt > now + (3600 * 1000));
  assert.notEqual(renewedAccount.credentials.oauth.accessToken, 'old_access_token_123');
});

test('Credential Refresh — Heartbeat Daemon', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-daemon-test-'));
  const storagePath = path.join(tmpDir, 'accounts.json');
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const store = openAccountStore({ storagePath });

  const reportPromise = new Promise((resolve) => {
    const stopDaemon = startAuthHeartbeatDaemon(store, {
      intervalMs: 100,
      onReport: (report) => {
        stopDaemon();
        resolve(report);
      }
    });
  });

  const report = await reportPromise;
  assert.ok(report);
  assert.ok(report.timestamp);
  assert.equal(report.total, 0);
});
