/**
 * Chaos battery seeds for testing boundary conditions and input resilience.
 */
export const CHAOS_SEEDS = [
  // Empty & Whitespace variations
  { label: 'empty_string', value: '' },
  { label: 'spaces_only', value: '     ' },
  { label: 'tabs_and_newlines', value: '\t\r\n   \n\t' },
  { label: 'zero_width_space', value: '\u200B\u200C\u200D\uFEFF' },

  // Unicode & Script variations
  { label: 'emoji_sequence', value: '🔥🚀💥🛡️' },
  { label: 'rtl_override', value: '\u202Ereversed_text\u202C' },
  { label: 'nfd_unnormalized', value: 'e\u0301' }, // é in decomposed form
  { label: 'zalgo_stress', value: 't̷e̶s̸t̴' },

  // Numbers & Boundary Values
  { label: 'zero', value: 0 },
  { label: 'negative_one', value: -1 },
  { label: 'max_safe_integer', value: Number.MAX_SAFE_INTEGER },
  { label: 'beyond_max_safe_int', value: Number.MAX_SAFE_INTEGER + 1000 },
  { label: 'nan', value: NaN },
  { label: 'infinity', value: Infinity },
  { label: 'negative_infinity', value: -Infinity },

  // Types & Prototype Pollution Protections
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'boolean_true', value: true },
  { label: 'boolean_false', value: false },
  { label: 'empty_array', value: [] },
  { label: 'empty_object', value: {} },
  { label: 'nested_empty_array', value: [[], [null]] },
  { label: 'proto_key', value: '__proto__' },
  { label: 'constructor_key', value: 'constructor' },

  // Strings with Injection & Formatting chars
  { label: 'sql_quote_escape', value: "' OR '1'='1" },
  { label: 'sql_semicolon_drop', value: "test'; DROP TABLE items;--" },
  { label: 'path_traversal_dotdot', value: '../../../../../../etc/passwd' },
  { label: 'encoded_dotdot', value: '..%2f..%2f..%2f' },
  { label: 'null_byte_string', value: 'file.txt\0.js' }
];

/**
 * Runs a function against the chaos battery to test unhandled crashes.
 * @param {Function} fn - The test function accepting the chaos seed
 * @returns {Array<{ seed: string, threw: boolean, errorName: string, errorMessage: string }>}
 */
export function runChaosBattery(fn) {
  const results = [];
  for (const seed of CHAOS_SEEDS) {
    try {
      fn(seed.value);
      results.push({ label: seed.label, threw: false });
    } catch (err) {
      results.push({
        label: seed.label,
        threw: true,
        errorName: err?.name || 'Error',
        errorMessage: err?.message || String(err),
        isTypeError: err instanceof TypeError
      });
    }
  }
  return results;
}

/**
 * Executes an async operation across multiple concurrent bursts to detect race conditions.
 * @param {Function} workerFn - Async function (workerIndex) => Promise<any>
 * @param {number} concurrency - Number of concurrent parallel promises (default: 30)
 */
export async function burstConcurrency(workerFn, concurrency = 30) {
  const tasks = Array.from({ length: concurrency }, (_, i) => workerFn(i));
  const results = await Promise.allSettled(tasks);
  const rejections = results.filter(r => r.status === 'rejected');
  return {
    total: concurrency,
    fulfilled: concurrency - rejections.length,
    rejected: rejections.length,
    errors: rejections.map(r => r.reason?.message || String(r.reason))
  };
}

/**
 * Resource Watchdog: captures active handles before and after an operation.
 */
export function auditHandles() {
  const getHandles = () => {
    if (typeof process._getActiveHandles === 'function') {
      return process._getActiveHandles().map(h => h?.constructor?.name || 'Handle');
    }
    return [];
  };

  const initialHandles = getHandles();

  return {
    initialCount: initialHandles.length,
    checkLeaks() {
      const current = getHandles();
      const leaked = current.length - initialHandles.length;
      return {
        initial: initialHandles.length,
        current: current.length,
        leakedCount: Math.max(0, leaked),
        currentTypes: current
      };
    }
  };
}
