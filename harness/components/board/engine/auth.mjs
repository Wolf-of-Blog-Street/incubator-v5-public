import crypto from 'node:crypto';

/**
 * Custom error for unauthorized requests (401).
 */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
    this.statusCode = 401;
  }
}

/**
 * Custom error for forbidden cross-tenant requests (403).
 */
export class ForbiddenError extends Error {
  constructor(message = 'Forbidden: Tenant access denied') {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
  }
}

/**
 * Generates a cryptographically secure random bearer token.
 * @param {string} prefix Optional token prefix (e.g. 'sec_ag_')
 * @returns {string}
 */
export function generateToken(prefix = 'sec_ag_') {
  return `${prefix}${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Computes SHA-256 hash of a token in standard format `sha256:<hex>`.
 * @param {string} token Plaintext token
 * @returns {string}
 */
export function hashToken(token) {
  if (typeof token !== 'string' || !token) {
    throw new Error('Token must be a non-empty string');
  }
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  return `sha256:${digest}`;
}

/**
 * Constant-time string comparison preventing timing attacks.
 * @param {string} a 
 * @param {string} b 
 * @returns {boolean}
 */
export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Constant time dummy comparison to avoid early length leak
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a provided plaintext token against a stored token or stored hash.
 * Supports both plaintext tokens and `sha256:<hex>` hashes.
 * @param {string} providedToken 
 * @param {string} storedTokenOrHash 
 * @returns {boolean}
 */
export function verifyToken(providedToken, storedTokenOrHash) {
  if (!providedToken || !storedTokenOrHash) return false;

  if (storedTokenOrHash.startsWith('sha256:')) {
    const computedHash = hashToken(providedToken);
    return timingSafeCompare(computedHash, storedTokenOrHash);
  }

  return timingSafeCompare(providedToken, storedTokenOrHash);
}

/**
 * Extracts the Bearer token from an Authorization header.
 * @param {string|undefined} authHeader 
 * @returns {string|null}
 */
export function extractBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+([a-zA-Z0-9_\-]+)$/i);
  return match ? match[1] : null;
}

/**
 * Authenticates an incoming request header against a roster of agents and optional operator token.
 * 
 * @param {Object} options
 * @param {string|undefined} options.authHeader The `Authorization` header value
 * @param {Array<Object>} options.agents Array of agent definitions from roster
 * @param {string|null} [options.operatorToken] Optional master operator token
 * @returns {{ authenticated: boolean, isOperator: boolean, agentId: string|null, agent: Object|null, error?: string }}
 */
export function authenticateRequest({ authHeader, agents = [], operatorToken = null }) {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return {
      authenticated: false,
      isOperator: false,
      agentId: null,
      agent: null,
      error: 'Missing or malformed Authorization header. Expected: Bearer <token>'
    };
  }

  // 1. Check if token matches operator master token
  if (operatorToken && verifyToken(token, operatorToken)) {
    return {
      authenticated: true,
      isOperator: true,
      agentId: null,
      agent: null
    };
  }

  // 2. Check against registered agents in the roster
  for (const agent of agents) {
    const expected = agent.token_hash || agent.token;
    if (expected && verifyToken(token, expected)) {
      return {
        authenticated: true,
        isOperator: false,
        agentId: agent.id,
        agent
      };
    }
  }

  return {
    authenticated: false,
    isOperator: false,
    agentId: null,
    agent: null,
    error: 'Invalid or unknown authorization token'
  };
}

/**
 * Asserts that the authenticated principal is allowed to access the target agent's board.
 * Throws ForbiddenError if an agent tries to access another agent's tenant.
 * 
 * @param {Object} options
 * @param {string|null} options.authenticatedAgentId 
 * @param {string} options.targetAgentId 
 * @param {boolean} [options.isOperator=false]
 */
export function assertTenantAccess({ authenticatedAgentId, targetAgentId, isOperator = false }) {
  if (isOperator) return true;
  if (!authenticatedAgentId) {
    throw new UnauthorizedError('Authentication required');
  }
  if (authenticatedAgentId !== targetAgentId) {
    throw new ForbiddenError(
      `Cross-tenant access denied: authenticated as "${authenticatedAgentId}" but requested "${targetAgentId}"`
    );
  }
  return true;
}
