/**
 * Incubator v5 — Friends Engine
 *
 * Multi-Model Sub-Agent & Secondary CLI Dispatch Engine.
 * Enables invoking external CLI engines (Claude Code, Codex, Kimi, etc.)
 * inside isolated child revisions in Jujutsu (jj new).
 *
 * Pure Node.js 22 ESM — Zero external dependencies.
 */

import { spawn, execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Default Built-in Friends Catalog
 */
export const DEFAULT_FRIENDS_CATALOG = {
  claude: {
    id: 'claude',
    binary: 'claude',
    displayName: 'Claude Code',
    description: 'Anthropic Claude Code CLI with automated tool calling and analysis',
    promptFlag: '-p',
    modelFlag: '--model',
    effortFlag: null,
    defaultModel: 'claude-fable-5-1',
    defaultEffort: 'high',
    defaultFlags: ['--dangerously-skip-permissions'],
    modelAliases: {
      'fable': 'claude-fable-5-1',
      'fable-5.1': 'claude-fable-5-1',
      'fable-5': 'claude-fable-5-1',
      'fable 5.1': 'claude-fable-5-1',
      'sonnet': 'sonnet',
      'opus': 'claude-opus-4-8'
    },
    supportsNonInteractive: true
  },
  codex: {
    id: 'codex',
    binary: 'codex',
    displayName: 'Codex CLI',
    description: 'OpenAI Codex CLI for code synthesis and deep architectural design',
    promptFlag: null,
    modelFlag: '--model',
    effortFlag: null,
    defaultModel: 'gpt-6-astra',
    defaultEffort: 'ultra',
    defaultFlags: ['exec'],
    modelAliases: {
      'astra': 'gpt-6-astra',
      'sol': 'gpt-5.6-sol',
      'luna': 'gpt-5.5',
      'gpt-5': 'gpt-5.5',
      'gpt-6': 'gpt-6-astra',
      'codex': 'gpt-5-codex'
    },
    supportsNonInteractive: true
  },
  kimi: {
    id: 'kimi',
    binary: 'kimi',
    displayName: 'Kimi Code',
    description: 'Moonshot Kimi K3 CLI for high-context problem solving and review',
    promptFlag: '-p',
    modelFlag: '--model',
    effortFlag: null,
    defaultModel: 'kimi-k3',
    defaultEffort: 'high',
    defaultFlags: [],
    supportsNonInteractive: true
  },
  opencode: {
    id: 'opencode',
    binary: 'opencode',
    displayName: 'OpenCode CLI',
    description: 'Local and open-weight model runner for code review and refactoring',
    promptFlag: '-p',
    modelFlag: '--model',
    effortFlag: null,
    defaultModel: 'deepseek-coder-v2',
    defaultEffort: 'high',
    defaultFlags: [],
    supportsNonInteractive: true
  }
};

/**
 * Loads the effective friends catalog, optionally merged with a workspace config file.
 * @param {string} [customConfigPath] Optional path to a JSON config file (e.g. config/friends.json).
 * @returns {Record<string, object>}
 */
export function getFriendsCatalog(customConfigPath = null) {
  const catalog = { ...DEFAULT_FRIENDS_CATALOG };
  if (customConfigPath && fs.existsSync(customConfigPath)) {
    try {
      const raw = fs.readFileSync(customConfigPath, 'utf8');
      const custom = JSON.parse(raw);
      for (const [key, val] of Object.entries(custom)) {
        catalog[key] = { ...(catalog[key] || { id: key }), ...val };
      }
    } catch {
      // Ignore malformed custom config and use defaults
    }
  }
  return catalog;
}

/**
 * Checks if an executable exists on the system PATH or target file path.
 * @param {string} binary
 * @returns {boolean}
 */
export function isBinaryAvailable(binary) {
  if (!binary) return false;
  if (path.isAbsolute(binary)) {
    try {
      const stat = fs.statSync(binary);
      return stat.isFile() && (stat.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }
  try {
    const checkCmd = os.platform() === 'win32' ? 'where' : 'which';
    const res = spawnSync(checkCmd, [binary], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Mutex registry for preventing concurrent working-copy mutations in the same Jujutsu repository.
 */
const JJ_LOCKS = new Map();

async function acquireJjLock(cwd) {
  while (JJ_LOCKS.has(cwd)) {
    await JJ_LOCKS.get(cwd);
  }
  let unlock;
  const promise = new Promise(resolve => { unlock = resolve; });
  JJ_LOCKS.set(cwd, promise);
  return () => {
    JJ_LOCKS.delete(cwd);
    unlock();
  };
}

/**
 * Synthesizes the exact CLI command and argument vector for dispatching a friend.
 *
 * @param {string} friendId - Provider ID (e.g. 'claude', 'codex')
 * @param {object} options
 * @param {string} options.prompt - The instruction or query to execute
 * @param {string} [options.model] - Model name override
 * @param {string} [options.effort] - Effort level override
 * @param {string[]} [options.extraFlags] - Additional CLI flags
 * @param {string} [options.configPath] - Optional custom friends.json path
 * @returns {{ binary: string, args: string[], provider: object }}
 */
export function resolveFriendCommand(friendId, options = {}) {
  const catalog = getFriendsCatalog(options.configPath);
  const provider = catalog[friendId];
  if (!provider) {
    const available = Object.keys(catalog).join(', ');
    throw new Error(`Unknown friend provider "${friendId}". Available providers: ${available}`);
  }

  const binary = provider.binary;
  const args = [...(provider.defaultFlags || [])];

  const rawModel = options.model || provider.defaultModel;
  const model = provider.modelAliases?.[rawModel] || rawModel;
  if (model && provider.modelFlag) {
    args.push(provider.modelFlag, model);
  }

  const effort = options.effort || provider.defaultEffort;
  if (effort && provider.effortFlag) {
    args.push(provider.effortFlag, effort);
  }

  if (Array.isArray(options.extraFlags)) {
    args.push(...options.extraFlags);
  }

  if (options.prompt) {
    if (provider.promptFlag) {
      args.push(provider.promptFlag, options.prompt);
    } else {
      args.push(options.prompt);
    }
  }

  return { binary, args, provider, resolvedModel: model };
}

/**
 * Checks if a directory is inside a Jujutsu repository.
 * @param {string} cwd
 * @returns {boolean}
 */
export function isJjRepository(cwd = process.cwd()) {
  try {
    const res = spawnSync('jj', ['root'], { cwd, stdio: 'pipe', encoding: 'utf8' });
    return res.status === 0 && res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Executes a function within an isolated Jujutsu revision (jj new).
 *
 * @param {string} cwd - Target working directory
 * @param {object} options
 * @param {string} options.description - Commit description (e.g. "friend(claude): fix concurrency race")
 * @param {boolean} [options.noJj=false] - If true, bypasses jj isolation
 * @param {boolean} [options.autoAbandon=false] - If true, automatically abandons the revision on execution failure
 * @param {Function} executeFn - Async callback: async ({ changeId, cwd }) => result
 * @returns {Promise<{ result: any, changeId: string|null, commitId: string|null, diffStat: string|null }>}
 */
export async function withJjIsolation(cwd, options, executeFn) {
  const isJj = !options.noJj && isJjRepository(cwd);
  const releaseLock = isJj ? await acquireJjLock(cwd) : () => {};

  let changeId = null;
  let commitId = null;
  let diffStat = null;

  try {
    if (isJj) {
      const desc = options.description || 'friend execution';
      const newRes = spawnSync('jj', ['new', '-m', desc], { cwd, stdio: 'pipe', encoding: 'utf8' });
      if (newRes.status !== 0) {
        throw new Error(`Failed to create isolated Jujutsu revision: ${newRes.stderr.trim()}`);
      }

      try {
        const logRes = spawnSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'change_id'], { cwd, stdio: 'pipe', encoding: 'utf8' });
        if (logRes.status === 0) {
          changeId = logRes.stdout.trim();
        }
      } catch {
        // Non-fatal
      }
    }

    try {
      const result = await executeFn({ changeId, cwd, isIsolated: isJj });

      if (isJj) {
        // Capture resulting commit ID and diff stats
        try {
          const commitRes = spawnSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'commit_id'], { cwd, stdio: 'pipe', encoding: 'utf8' });
          if (commitRes.status === 0) commitId = commitRes.stdout.trim();

          const diffRes = spawnSync('jj', ['diff', '--stat'], { cwd, stdio: 'pipe', encoding: 'utf8' });
          if (diffRes.status === 0) diffStat = diffRes.stdout.trim();
        } catch {
          // Non-fatal
        }
      }

      return { result, changeId, commitId, diffStat, isIsolated: isJj };
    } catch (err) {
      if (isJj && options.autoAbandon && changeId) {
        try {
          spawnSync('jj', ['abandon', '-r', changeId], { cwd, stdio: 'ignore' });
        } catch {
          // Ignore abandon errors
        }
      }
      throw err;
    }
  } finally {
    releaseLock();
  }
}

/**
 * Spawns a friend CLI subprocess with streaming telemetry and timeout enforcement.
 *
 * @param {string} binary
 * @param {string[]} args
 * @param {object} options
 * @param {string} [options.cwd=process.cwd()]
 * @param {number} [options.timeoutMs=120000] - Default timeout: 2 minutes (0 disables timeout)
 * @param {Record<string, string>} [options.env={}]
 * @param {Function} [options.onStdout] - (chunk: string) => void
 * @param {Function} [options.onStderr] - (chunk: string) => void
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string, durationMs: number }>}
 */
export function spawnFriendProcess(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const cwd = options.cwd || process.cwd();
    const timeoutMs = options.timeoutMs ?? 120000;
    const env = { ...process.env, ...(options.env || {}) };

    let stdout = '';
    let stderr = '';
    let isFinished = false;

    const child = spawn(binary, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (child.stdin) {
      try { child.stdin.end(); } catch {}
    }

    let timeoutTimer = null;
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!isFinished) {
          isFinished = true;
          try {
            child.kill('SIGTERM');
            setTimeout(() => {
              try { child.kill('SIGKILL'); } catch {}
            }, 2000);
          } catch {}
          reject(new Error(`Friend process timed out after ${timeoutMs}ms (${binary} ${args.slice(0, 2).join(' ')})`));
        }
      }, timeoutMs);
    }

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      if (typeof options.onStdout === 'function') options.onStdout(text);
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      if (typeof options.onStderr === 'function') options.onStderr(text);
    });

    child.on('error', err => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (!isFinished) {
        isFinished = true;
        reject(err);
      }
    });

    child.on('close', code => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (!isFinished) {
        isFinished = true;
        const durationMs = Date.now() - startTime;
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          durationMs
        });
      }
    });
  });
}

/**
 * High-level orchestration helper: Dispatches a friend within an isolated Jujutsu revision.
 *
 * @param {string} friendId
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} [options.cwd=process.cwd()]
 * @param {string} [options.model]
 * @param {string} [options.effort]
 * @param {boolean} [options.noJj=false]
 * @param {number} [options.timeoutMs=180000]
 * @param {Function} [options.onStdout]
 * @param {Function} [options.onStderr]
 * @returns {Promise<object>} Execution report
 */
export async function dispatchFriend(friendId, options = {}) {
  const { binary, args, provider } = resolveFriendCommand(friendId, options);
  const cwd = options.cwd || process.cwd();
  const description = options.description || `friend(${friendId}): ${options.prompt ? options.prompt.slice(0, 60) : 'run'}`;

  const report = await withJjIsolation(
    cwd,
    { description, noJj: options.noJj, autoAbandon: options.autoAbandon },
    async ({ changeId, isIsolated }) => {
      const execResult = await spawnFriendProcess(binary, args, {
        cwd,
        timeoutMs: options.timeoutMs,
        onStdout: options.onStdout,
        onStderr: options.onStderr
      });
      return execResult;
    }
  );

  return {
    provider: friendId,
    displayName: provider.displayName,
    binary,
    args,
    prompt: options.prompt,
    cwd,
    isIsolated: report.isIsolated,
    changeId: report.changeId,
    commitId: report.commitId,
    diffStat: report.diffStat,
    exitCode: report.result.exitCode,
    stdout: report.result.stdout,
    stderr: report.result.stderr,
    durationMs: report.result.durationMs
  };
}
