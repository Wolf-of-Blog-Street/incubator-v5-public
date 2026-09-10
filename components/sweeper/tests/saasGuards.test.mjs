import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertIdempotent,
  canonicalSnapshot,
  auditTenantIsolation,
  auditSecretSanitization
} from '../engine/saasGuards.mjs';

test('assertIdempotent verifies replay safety and flags duplicate creation', async () => {
  // Test 1: Safe idempotent function
  let store = {};
  const safeHandler = async (payload) => {
    if (!store[payload.id]) {
      store[payload.id] = { id: payload.id, amount: payload.amount };
    }
    return store[payload.id];
  };

  const safeRes = await assertIdempotent(
    safeHandler,
    { id: 'sub_123', amount: 50 },
    () => Object.keys(store).length
  );
  assert.equal(safeRes.isIdempotent, true);
  assert.equal(safeRes.error, null);

  // Test 2: Unsafe non-idempotent function (creates duplicates on every call)
  const items = [];
  const unsafeHandler = async (payload) => {
    const item = { id: 'item_' + Math.random(), name: payload.name };
    items.push(item);
    return item;
  };

  const unsafeRes = await assertIdempotent(
    unsafeHandler,
    { name: 'Subscription' },
    () => items.length
  );
  assert.equal(unsafeRes.isIdempotent, false);
  assert.match(unsafeRes.error, /Idempotency violation/);
});

test('auditTenantIsolation catches cross-tenant mutation risks in SQL', () => {
  const unsafeSqlCode = `
    export function deleteItem(id) {
      db.prepare("DELETE FROM items WHERE id = ?").run(id);
    }
    export function updateSettings(id, value) {
      db.prepare("UPDATE accounts SET value = ? WHERE id = ?").run(value, id);
    }
  `;

  const findings = auditTenantIsolation(unsafeSqlCode);
  assert.equal(findings.length, 2);
  assert.match(findings[0].warning, /cross-tenant/);

  const safeSqlCode = `
    export function deleteItem(id, tenantId) {
      db.prepare("DELETE FROM items WHERE id = ? AND tenant_id = ?").run(id, tenantId);
    }
    export function updateSettings(id, orgId, value) {
      db.prepare("UPDATE accounts SET value = ? WHERE id = ? AND org_id = ?").run(value, id, orgId);
    }
  `;

  const cleanFindings = auditTenantIsolation(safeSqlCode);
  assert.equal(cleanFindings.length, 0);
});

test('auditSecretSanitization flags leaked tokens and approves clean payloads', () => {
  // Leaked credentials
  const dirtyError1 = {
    message: 'Payment failed with Stripe key sk_test_FAKEFIXTURE51Abcdef1234567890abcdef123',
    code: 500
  };
  const res1 = auditSecretSanitization(dirtyError1);
  assert.equal(res1.clean, false);
  assert.equal(res1.leaked[0].name, 'Stripe Secret Key');

  const dirtyError2 = {
    error: 'Connection timeout to postgres://admin:superSecret123@db.internal:5432/saas_db'
  };
  const res2 = auditSecretSanitization(dirtyError2);
  assert.equal(res2.clean, false);
  assert.equal(res2.leaked[0].name, 'Database Connection String');

  // Clean error response
  const cleanError = {
    error: 'Resource not found',
    code: 404,
    requestId: 'req-8f92b1'
  };
  const cleanRes = auditSecretSanitization(cleanError);
  assert.equal(cleanRes.clean, true);
  assert.equal(cleanRes.leaked.length, 0);

  // Deeply nested secret inside details
  const nestedDirty = {
    error: {
      status: 500,
      details: {
        rawClientKey: 'sk_test_FAKEFIXTURE99887766554433221100aabb'
      }
    }
  };
  const nestedRes = auditSecretSanitization(nestedDirty);
  assert.equal(nestedRes.clean, false);
  assert.equal(nestedRes.leaked[0].name, 'Stripe Secret Key');

  // Error instance serialization
  const errObj = new Error('Database connection failed: postgres://user:secretPass123@db.svc:5432/main');
  const errRes = auditSecretSanitization(errObj);
  assert.equal(errRes.clean, false);
  assert.equal(errRes.leaked[0].name, 'Database Connection String');
});

test('assertIdempotent detects repeated balance/state mutation even when record count is unchanged', async () => {
  let account = { id: 'acc_1', balance: 100 };
  const nonIdempotentDebit = async (payload) => {
    account.balance -= payload.amount;
    return { success: true, balance: account.balance };
  };

  const res = await assertIdempotent(
    nonIdempotentDebit,
    { amount: 20 },
    () => ({ balance: account.balance })
  );
  assert.equal(res.isIdempotent, false);
  assert.match(res.error, /State mutated on replay/);
});

test('auditSecretSanitization handles circular references safely and inspects undefined payloads', () => {
  // Circular reference containing a secret
  const circularObj = {
    error: 'Payment error',
    auth: {
      secretToken: 'sk_test_FAKEFIXTUREcircular1234567890abcdef'
    }
  };
  circularObj.auth.self = circularObj;

  const circRes = auditSecretSanitization(circularObj);
  assert.equal(circRes.clean, false);
  assert.equal(circRes.leaked[0].name, 'Stripe Secret Key');

  // Undefined and null payloads
  assert.equal(auditSecretSanitization(undefined).clean, true);
  assert.equal(auditSecretSanitization(null).clean, true);
});

test('auditTenantIsolation catches multi-line SQL mutations and subquery tenant leakage', () => {
  // Multi-line SQL without tenant scope
  const multilineSql = `
    export function updateItem(id, val) {
      db.prepare(\`
        UPDATE items
        SET val = ?
        WHERE id = ?
      \`).run(val, id);
    }
  `;
  const mlFindings = auditTenantIsolation(multilineSql);
  assert.equal(mlFindings.length, 1);
  assert.match(mlFindings[0].warning, /cross-tenant/);

  // Subquery containing tenant_id while outer query is unscoped
  const subquerySql = `
    export function deleteOrder(id) {
      db.prepare("DELETE FROM orders WHERE id = ? AND item_id IN (SELECT id FROM items WHERE tenant_id = 456)").run(id);
    }
  `;
  const sqFindings = auditTenantIsolation(subquerySql);
  assert.equal(sqFindings.length, 1);
  assert.match(sqFindings[0].warning, /cross-tenant/);

  // Inverted disjunction: WHERE tenant_id = ? OR id = ?
  const invertedDisjunction = `
    export function deleteAccount(id, tenantId) {
      db.prepare("DELETE FROM accounts WHERE tenant_id = ? OR id = ?").run(tenantId, id);
    }
  `;
  const invFindings = auditTenantIsolation(invertedDisjunction);
  assert.equal(invFindings.length, 1);
  assert.match(invFindings[0].warning, /cross-tenant/);
});

test('assertIdempotent eliminates false positives on object key insertion order and handles Sets/Maps', async () => {
  let calls = 0;
  const dummyAction = async () => {
    calls++;
    return { ok: true };
  };

  // State snapshot returns keys in alternating insertion order
  const unorderedSnapshot = () => {
    return calls === 1
      ? { alpha: 1, beta: 2, gamma: [10, 20] }
      : { gamma: [10, 20], beta: 2, alpha: 1 };
  };

  const orderRes = await assertIdempotent(dummyAction, {}, unorderedSnapshot);
  assert.equal(orderRes.isIdempotent, true);
  assert.equal(orderRes.error, null);

  // Snapshot using Set of objects in different insertion orders
  const objSet1 = new Set([{ id: 'a', val: 1 }, { id: 'b', val: 2 }]);
  const objSet2 = new Set([{ id: 'b', val: 2 }, { id: 'a', val: 1 }]);
  calls = 0;
  const setObjRes = await assertIdempotent(
    dummyAction,
    {},
    () => (calls === 1 ? objSet1 : objSet2)
  );
  assert.equal(setObjRes.isIdempotent, true);

  // Snapshot with Date mutation
  let dateVal = new Date('2026-09-08T12:00:00.000Z');
  const dateMutatingAction = async () => {
    dateVal = new Date(dateVal.getTime() + 1000);
    return { ok: true };
  };
  const dateRes = await assertIdempotent(
    dateMutatingAction,
    {},
    () => ({ updatedAt: dateVal })
  );
  assert.equal(dateRes.isIdempotent, false);
  assert.match(dateRes.error, /State mutated on replay/);
});

test('auditSecretSanitization handles Error instances with circular references and non-enumerable properties', () => {
  const customErr = new Error('Gateway timeout');
  customErr.code = 'ETIMEDOUT';
  customErr.cause = { credentialKey: 'sk_test_FAKEFIXTUREnestedCauseKey1234567890abcdef' };
  customErr.selfRef = customErr; // circular reference on Error instance

  const res = auditSecretSanitization(customErr);
  assert.equal(res.clean, false);
  assert.ok(res.leaked.some((l) => l.name === 'Stripe Secret Key'));
});

test('auditTenantIsolation catches nested-parenthesis subquery tenant evasion', () => {
  const nestedParenSql = `
    export function deleteOrder(id) {
      db.prepare("DELETE FROM orders WHERE id = ? AND item_id IN (SELECT id FROM items WHERE tenant_id = COALESCE(?, 1))").run(id);
    }
  `;
  const findings = auditTenantIsolation(nestedParenSql);
  assert.equal(findings.length, 1);
  assert.match(findings[0].warning, /cross-tenant/);
});

test('canonicalSnapshot and assertIdempotent handle circular references safely', async () => {
  const circularObj = { id: 'entity-1', name: 'Root' };
  circularObj.self = circularObj;
  circularObj.nested = { parent: circularObj };

  // Should not throw RangeError: Maximum call stack size exceeded
  const snapshot = canonicalSnapshot(circularObj);
  assert.equal(snapshot.self, '[Circular]');
  assert.equal(snapshot.nested.parent, '[Circular]');

  const dummyAction = async () => ({ ok: true });
  const res = await assertIdempotent(dummyAction, {}, () => circularObj);
  assert.equal(res.isIdempotent, true);
  assert.equal(res.error, null);
});

test('canonicalSnapshot handles BigInt, Symbol, and undefined safely in Sets and Maps', () => {
  const symA = Symbol('tokenA');
  const symB = Symbol('tokenB');
  const bigintVal = 9007199254740993n;

  const testSet = new Set([bigintVal, 100n, symB, symA, undefined]);
  const normSet = canonicalSnapshot(testSet);
  assert.ok(Array.isArray(normSet));
  assert.equal(normSet.length, 5);

  const testMap = new Map([
    [bigintVal, 'large-int'],
    [symA, 'symbol-key']
  ]);
  const normMap = canonicalSnapshot(testMap);
  assert.ok(Array.isArray(normMap));
  assert.equal(normMap.length, 2);
});

test('auditTenantIsolation catches subqueries with long spacing or newlines', () => {
  const formattedSql = `
    export function updateItems(id) {
      db.prepare("UPDATE items SET status = 'active' WHERE id = ? AND category_id IN (
        /* deeply indented comment or subquery */
        
        
        SELECT id FROM categories WHERE tenant_id = 99
      )").run(id);
    }
  `;
  const findings = auditTenantIsolation(formattedSql);
  assert.equal(findings.length, 1);
  assert.match(findings[0].warning, /cross-tenant/);
});

test('assertIdempotent cleanly captures replay exceptions without crashing runner', async () => {
  let callCount = 0;
  const failingReplayAction = async () => {
    callCount++;
    if (callCount === 2) {
      throw new Error('duplicate key value violates unique constraint "users_pkey"');
    }
    return { ok: true, id: 'user_1' };
  };

  const res = await assertIdempotent(failingReplayAction, {});
  assert.equal(res.isIdempotent, false);
  assert.equal(res.firstResult.id, 'user_1');
  assert.equal(res.secondResult, null);
  assert.match(res.error, /Replay execution failed/);
});
