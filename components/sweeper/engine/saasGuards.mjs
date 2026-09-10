/**
 * SaaS Production Defense Guards
 * High-ROI, zero-bloat automated guards to prevent double-charges, cross-tenant leaks, and secret exposure.
 */

const SECRET_PATTERNS = [
  { name: 'Stripe Secret Key', regex: /sk_(?:live|test)_[0-9a-zA-Z]{24,}/ },
  { name: 'Bearer Token', regex: /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/i },
  { name: 'Database Connection String', regex: /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@[^\s/]+/i },
  { name: 'Private Key Header', regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'Generic Password Parameter', regex: /(?:password|client_secret|api_key)\s*[:=]\s*["'][^"'\s]{6,}["']/i },
  { name: 'Absolute Local System Path in Stack', regex: /(?:\/Users\/[a-zA-Z0-9_-]+|\/home\/[a-zA-Z0-9_-]+)\/[a-zA-Z0-9_.\/-]+/ }
];

/**
 * Safely converts any value or canonical structure to a deterministic string representation for sorting.
 * Handles BigInt, Symbol, undefined, null, objects, and primitives without throwing.
 */
function safeKey(k) {
  if (k === null) return 'null';
  if (k === undefined) return 'undefined';
  if (typeof k === 'bigint') return `${k}n`;
  if (typeof k === 'symbol') return k.toString();
  try {
    const s = JSON.stringify(k);
    return s !== undefined ? s : String(k);
  } catch {
    return String(k);
  }
}

/**
 * Creates a deterministic, canonical snapshot of an object or primitive.
 * Normalizes property insertion order and supports Sets, Maps, Dates, RegExps, BigInts, and Symbols.
 * 
 * @param {any} val - Input state snapshot
 * @param {WeakSet} [seen] - Visited objects set to prevent recursion on cyclic references
 * @returns {any} Deterministic normalized snapshot
 */
export function canonicalSnapshot(val, seen = new WeakSet()) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return `${val}n`;
  if (typeof val === 'symbol') return val.toString();
  if (typeof val !== 'object') return val;

  if (seen.has(val)) return '[Circular]';
  seen.add(val);

  if (val instanceof Date) return val.toISOString();
  if (val instanceof RegExp) return val.toString();
  if (val instanceof Set) {
    const items = Array.from(val).map((item) => canonicalSnapshot(item, seen));
    items.sort((a, b) => safeKey(a).localeCompare(safeKey(b)));
    return items;
  }
  if (val instanceof Map) {
    const entries = Array.from(val.entries()).map(([k, v]) => [
      canonicalSnapshot(k, seen),
      canonicalSnapshot(v, seen)
    ]);
    entries.sort((a, b) => safeKey(a[0]).localeCompare(safeKey(b[0])));
    return entries;
  }
  if (Array.isArray(val)) return val.map((item) => canonicalSnapshot(item, seen));

  const sortedObj = {};
  const keys = Object.keys(val).sort();
  for (const k of keys) {
    sortedObj[k] = canonicalSnapshot(val[k], seen);
  }
  return sortedObj;
}

/**
 * Asserts that executing an action twice with the same payload produces idempotent results
 * without creating duplicate state or mutating existing records.
 * 
 * @param {Function} actionFn - Async function (payload) => Promise<result>
 * @param {any} payload - The input payload (e.g. webhook or checkout body)
 * @param {Function} [stateSnapshotFn] - Optional function returning current resource count or state snapshot
 * @returns {Promise<{ isIdempotent: boolean, firstResult: any, secondResult: any, error: string|null }>}
 */
export async function assertIdempotent(actionFn, payload, stateSnapshotFn = null) {
  let stateBefore = null;
  if (stateSnapshotFn) {
    try {
      stateBefore = await stateSnapshotFn();
    } catch (err) {
      return {
        isIdempotent: false,
        firstResult: null,
        secondResult: null,
        error: `Failed to capture initial state snapshot: ${err.message}`
      };
    }
  }

  let res1;
  try {
    res1 = await actionFn(payload);
  } catch (err) {
    return {
      isIdempotent: false,
      firstResult: null,
      secondResult: null,
      error: `Initial action failed: ${err.message}`
    };
  }

  let stateAfterFirst = null;
  if (stateSnapshotFn) {
    try {
      stateAfterFirst = await stateSnapshotFn();
    } catch (err) {
      return {
        isIdempotent: false,
        firstResult: res1,
        secondResult: null,
        error: `Failed to capture state snapshot after first run: ${err.message}`
      };
    }
  }

  let res2;
  try {
    res2 = await actionFn(payload);
  } catch (err) {
    return {
      isIdempotent: false,
      firstResult: res1,
      secondResult: null,
      error: `Idempotency violation: Replay execution failed: ${err.message}`
    };
  }

  let stateAfterSecond = null;
  if (stateSnapshotFn) {
    try {
      stateAfterSecond = await stateSnapshotFn();
    } catch (err) {
      return {
        isIdempotent: false,
        firstResult: res1,
        secondResult: res2,
        error: `Failed to capture state snapshot after replay: ${err.message}`
      };
    }
  }

  let isIdempotent = true;
  let error = null;

  // Check state invariant on replay using canonical snapshots to ignore key insertion order
  if (stateAfterFirst !== null && stateAfterSecond !== null) {
    const c1 = canonicalSnapshot(stateAfterFirst);
    const c2 = canonicalSnapshot(stateAfterSecond);
    const s1 = typeof c1 === 'object' ? JSON.stringify(c1) : c1;
    const s2 = typeof c2 === 'object' ? JSON.stringify(c2) : c2;
    if (s1 !== s2) {
      isIdempotent = false;
      error = `Idempotency violation: State mutated on replay (first: ${s1}, second: ${s2})`;
    }
  }

  // Check result consistency (IDs should match if present)
  if (res1 && res2 && typeof res1 === 'object' && typeof res2 === 'object') {
    if (res1.id && res2.id && res1.id !== res2.id) {
      isIdempotent = false;
      error = `Idempotency violation: Returned different IDs on replay (${res1.id} !== ${res2.id})`;
    }
  }

  return {
    isIdempotent,
    firstResult: res1,
    secondResult: res2,
    error
  };
}

/**
 * Strips nested subqueries with balanced parenthesis tracking across the full captured block.
 */
function stripSubqueries(sql) {
  let result = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '(') depth++;
        else if (sql[j] === ')') depth--;
        j++;
      }
      const block = sql.slice(i, j);
      if (/\bSELECT\b/i.test(block)) {
        result += '()';
        i = j;
        continue;
      }
    }
    result += sql[i];
    i++;
  }
  return result;
}

/**
 * Audits source code for potential cross-tenant isolation gaps in SQL/data access queries.
 * Handles multi-line queries, block comments, and balanced nested subquery isolation.
 * Flags UPDATE or DELETE statements filtering by ID without strict top-level AND tenant/organization scope.
 * 
 * @param {string} sourceCode - Raw source code of data repository or API handlers
 * @returns {Array<{ query: string, warning: string }>}
 */
export function auditTenantIsolation(sourceCode) {
  if (typeof sourceCode !== 'string') return [];

  const findings = [];

  // 1. Strip multi-line comments (/* ... */) and line comments (-- or //) across the full text
  const strippedCode = sourceCode
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/\/\/.*$/gm, ' ');

  // 2. Match mutation statements (UPDATE or DELETE FROM) with WHERE clauses across multiple lines
  const mutationRegex = /\b(UPDATE\s+[a-zA-Z0-9_]+(?:\s+SET\s+[\s\S]*?|\s+)\bWHERE\b[\s\S]*?|DELETE\s+FROM\s+[a-zA-Z0-9_]+\s+\bWHERE\b[\s\S]*?)(?=;|\n\s*(?:UPDATE|DELETE|SELECT|INSERT|export|function|const|let|var|\`|\"|\')|$)/gi;

  let match;
  while ((match = mutationRegex.exec(strippedCode)) !== null) {
    const fullQuery = match[1];
    const normalizedQuery = fullQuery.replace(/\s+/g, ' ').trim();

    const whereIdx = normalizedQuery.toUpperCase().indexOf('WHERE ');
    if (whereIdx === -1) continue;

    const whereClause = normalizedQuery.slice(whereIdx + 6).trim();

    // Strip nested subqueries with balanced parenthesis tracker so inner SELECT conditions cannot mask outer tenant scope
    const topLevelWhere = stripSubqueries(whereClause);

    // Check if target mutation filters by ID
    const hasIdFilter = /\bid\s*(?:=|\bIN\b)/i.test(topLevelWhere);
    if (hasIdFilter) {
      // Must have tenant/org/user/workspace scope bound to top level
      const hasTenantScope = /\b(?:tenant_id|org_id|user_id|workspace_id)\s*=/i.test(topLevelWhere);

      // Check for any disjunction (OR) involving tenant scope or ID filter
      const hasOrDisjunction = /\bOR\s+(?:tenant_id|org_id|user_id|workspace_id)\b/i.test(topLevelWhere) ||
                               /\b(?:tenant_id|org_id|user_id|workspace_id)\s*=[^()]+?\s+OR\b/i.test(topLevelWhere);

      if (!hasTenantScope || hasOrDisjunction) {
        findings.push({
          query: normalizedQuery,
          warning: 'Potential cross-tenant vulnerability: Mutation filters by ID without strict top-level AND tenant_id/org_id/user_id scope.'
        });
      }
    }
  }

  return findings;
}

/**
 * Audits an error response payload, Error object, or logged string to guarantee secrets and internal paths are stripped.
 * Handles circular references safely across both Error instances and objects, and inspects non-enumerable properties.
 * 
 * @param {any} responseData - The error payload, JSON string, or Error object sent to client
 * @returns {{ clean: boolean, leaked: Array<{ name: string, matched: string }> }}
 */
export function auditSecretSanitization(responseData) {
  if (responseData === undefined || responseData === null) {
    return { clean: true, leaked: [] };
  }

  let content = '';
  if (typeof responseData === 'string') {
    content = responseData;
  } else {
    try {
      const seen = new WeakSet();
      content = JSON.stringify(responseData, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);

          if (value instanceof Error) {
            // Extract non-enumerable properties along with any custom properties
            const errObj = {
              name: value.name,
              message: value.message,
              stack: value.stack,
              cause: value.cause,
              code: value.code,
              ...value
            };
            return errObj;
          }
        }
        return value;
      }) || '';
    } catch {
      content = String(responseData) || '';
    }
  }

  const leaked = [];

  for (const pattern of SECRET_PATTERNS) {
    const match = content.match(pattern.regex);
    if (match) {
      leaked.push({
        name: pattern.name,
        matched: match[0].slice(0, 30) + '...' // truncate for safety in report
      });
    }
  }

  return {
    clean: leaked.length === 0,
    leaked
  };
}
