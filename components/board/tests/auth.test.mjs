import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateToken,
  hashToken,
  verifyToken,
  extractBearerToken,
  authenticateRequest,
  assertTenantAccess,
  UnauthorizedError,
  ForbiddenError
} from '../engine/auth.mjs';

test('auth engine: generateToken and hashToken', () => {
  const token = generateToken('sec_test_');
  assert.ok(token.startsWith('sec_test_'));
  assert.ok(token.length > 20);

  const hash = hashToken(token);
  assert.ok(hash.startsWith('sha256:'));
  assert.strictEqual(hash.length, 7 + 64); // "sha256:" + 64 hex chars
});

test('auth engine: verifyToken against plaintext and sha256 hashes', () => {
  const plain = 'my-secret-token-12345';
  const hashed = hashToken(plain);

  // Plaintext verification
  assert.strictEqual(verifyToken(plain, plain), true);
  assert.strictEqual(verifyToken('wrong-token', plain), false);

  // Hash verification
  assert.strictEqual(verifyToken(plain, hashed), true);
  assert.strictEqual(verifyToken('wrong-token', hashed), false);

  // Edge cases: null/undefined/empty
  assert.strictEqual(verifyToken('', hashed), false);
  assert.strictEqual(verifyToken(null, hashed), false);
  assert.strictEqual(verifyToken(plain, ''), false);
});

test('auth engine: extractBearerToken', () => {
  assert.strictEqual(extractBearerToken('Bearer token_123'), 'token_123');
  assert.strictEqual(extractBearerToken('bearer token_xyz-99'), 'token_xyz-99');
  assert.strictEqual(extractBearerToken('Basic user:pass'), null);
  assert.strictEqual(extractBearerToken('token_only'), null);
  assert.strictEqual(extractBearerToken(''), null);
  assert.strictEqual(extractBearerToken(undefined), null);
});

test('auth engine: authenticateRequest with agent tokens and operator token', () => {
  const tokenA = 'sec_ag_manager_secret1';
  const hashA = hashToken(tokenA);
  const tokenB = 'sec_ag_pa_secret2';
  const operatorToken = 'sec_op_master_secret';

  const agents = [
    { id: 'manager-pm', token_hash: hashA },
    { id: 'example-pa', token: tokenB }
  ];

  // 1. Missing header
  const unauth = authenticateRequest({ authHeader: undefined, agents });
  assert.strictEqual(unauth.authenticated, false);
  assert.ok(unauth.error.includes('Missing or malformed'));

  // 2. Invalid token
  const invalid = authenticateRequest({ authHeader: 'Bearer wrong_token', agents });
  assert.strictEqual(invalid.authenticated, false);
  assert.strictEqual(invalid.agentId, null);

  // 3. Valid Agent A token (hashed in roster)
  const authA = authenticateRequest({ authHeader: `Bearer ${tokenA}`, agents });
  assert.strictEqual(authA.authenticated, true);
  assert.strictEqual(authA.isOperator, false);
  assert.strictEqual(authA.agentId, 'manager-pm');

  // 4. Valid Agent B token (plaintext in roster)
  const authB = authenticateRequest({ authHeader: `Bearer ${tokenB}`, agents });
  assert.strictEqual(authB.authenticated, true);
  assert.strictEqual(authB.isOperator, false);
  assert.strictEqual(authB.agentId, 'example-pa');

  // 5. Operator master token
  const authOp = authenticateRequest({
    authHeader: `Bearer ${operatorToken}`,
    agents,
    operatorToken
  });
  assert.strictEqual(authOp.authenticated, true);
  assert.strictEqual(authOp.isOperator, true);
  assert.strictEqual(authOp.agentId, null);
});

test('auth engine: assertTenantAccess enforces strict cross-tenant isolation', () => {
  // Same agent allowed
  assert.doesNotThrow(() => {
    assertTenantAccess({ authenticatedAgentId: 'manager-pm', targetAgentId: 'manager-pm' });
  });

  // Operator allowed for any tenant
  assert.doesNotThrow(() => {
    assertTenantAccess({
      authenticatedAgentId: null,
      targetAgentId: 'example-pa',
      isOperator: true
    });
  });

  // Cross-tenant attempt rejected with ForbiddenError (403)
  assert.throws(
    () => {
      assertTenantAccess({
        authenticatedAgentId: 'manager-pm',
        targetAgentId: 'example-pa',
        isOperator: false
      });
    },
    (err) => {
      assert.ok(err instanceof ForbiddenError);
      assert.strictEqual(err.statusCode, 403);
      assert.ok(err.message.includes('Cross-tenant access denied'));
      return true;
    }
  );

  // Unauthenticated attempt rejected with UnauthorizedError (401)
  assert.throws(
    () => {
      assertTenantAccess({
        authenticatedAgentId: null,
        targetAgentId: 'manager-pm',
        isOperator: false
      });
    },
    (err) => {
      assert.ok(err instanceof UnauthorizedError);
      assert.strictEqual(err.statusCode, 401);
      return true;
    }
  );
});
