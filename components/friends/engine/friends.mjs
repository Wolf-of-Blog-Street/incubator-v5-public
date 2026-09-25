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
import { resolveFriendEnvironment, SUPPORTED_PROVIDERS } from './sandbox.mjs';
import { openAccountStore } from './accounts.mjs';

/**
 * Standard voice-pack system prompt. Three parts, this order, nothing else:
 * the opening line, the preamble, then the pack (samples only).
 */
export const VOICE_OPENING = 'Write in this voice.';
export const VOICE_PREAMBLE = "These voice styles are for you to understand the style, the sentence structure, the energy and the way the person writes. Don't blindly parrot the same words the person uses, but adapt their style to the task you have.";
export const VOICE_PACK_DIR = 'data/opus-writer/voice-pack';

export function buildVoiceSystemPrompt(packText) {
  return `${VOICE_OPENING}\n\n${VOICE_PREAMBLE}\n\n${packText}`;
}

/**
 * Resolves a voice pack by name (data/opus-writer/voice-pack/<name>.md under cwd) or by path.
 * @returns {{ name: string, path: string, text: string }}
 */
export function loadVoicePack(nameOrPath, cwd = process.cwd()) {
  const candidates = [
    path.resolve(cwd, nameOrPath),
    path.resolve(cwd, VOICE_PACK_DIR, `${nameOrPath}.md`),
    path.resolve(cwd, VOICE_PACK_DIR, nameOrPath, 'pack.md')
  ];
  const found = candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!found) {
    throw new Error(`Voice pack "${nameOrPath}" not found. Looked in ${VOICE_PACK_DIR}/ under ${cwd}`);
  }
  return { name: path.basename(found, '.md'), path: found, text: fs.readFileSync(found, 'utf8') };
}

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
    systemPromptFlag: '--system-prompt',
    systemPromptFileFlag: '--system-prompt-file',
    stdinPrompt: true,
    modelFlag: '--model',
    effortFlag: null,
    defaultModel: 'claude-opus-5-5',
    defaultEffort: 'high',
    defaultFlags: ['--dangerously-skip-permissions'],
    modelAliases: {
      'fable': 'claude-fable-5-1',
      'fable-5.1': 'claude-fable-5-1',
      'fable-5': 'claude-fable-5-1',
      'fable 5.1': 'claude-fable-5-1',
      'sonnet': 'sonnet',
      'opus': 'claude-opus-5-5',
      'opus-5.5': 'claude-opus-5-5',
      'opus 5.5': 'claude-opus-5-5'
    },
    supportsNonInteractive: true
  },
  'lean-opus-4-5': {
    id: 'lean-opus-4-5',
    binary: 'claude',
    displayName: 'Lean Opus 4.5',
    description: 'Claude Code CLI pinned to claude-opus-4-5, text only: no tools, no MCP, no project hooks; the writing model',
    promptFlag: '-p',
    systemPromptFlag: '--system-prompt',
    systemPromptFileFlag: '--system-prompt-file',
    stdinPrompt: true,
    modelFlag: '--model',
    effortFlag: null,
    defaultModel: 'claude-opus-4-5',
    defaultEffort: null,
    // text only: no tools, no MCP, no project hooks or settings. Opus writes; it never touches the seat.
    defaultFlags: ['--strict-mcp-config', '--dangerously-skip-permissions', '--tools', '', '--setting-sources', 'user'],
    modelAliases: { 'opus-4.5': 'claude-opus-4-5', 'lean': 'claude-opus-4-5' },
    sandboxProvider: 'claude',
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
  grok: {
    id: 'grok',
    binary: 'grok',
    displayName: 'Grok Build',
    description: 'xAI Grok CLI for code synthesis and review',
    promptFlag: '-p',
    modelFlag: '--model',
    effortFlag: '--reasoning-effort',
    defaultModel: 'grok-4.6',
    defaultEffort: 'high',
    defaultFlags: ['--always-approve'],
    modelAliases: { 'grok-4.5': 'grok-4.5', 'grok-4.6': 'grok-4.6', 'grok': 'grok-4.6' },
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
  if (effort) {
    if (provider.effortFlag) {
      args.push(provider.effortFlag, effort);
    } else if (friendId === 'codex') {
      args.push('-c', `model_reasoning_effort=${effort}`);
    }
  }

  if (Array.isArray(options.extraFlags)) {
    args.push(...options.extraFlags);
  }

  if (options.systemPrompt) {
    if (!provider.systemPromptFlag) {
      throw new Error(`Friend "${friendId}" does not support a system prompt`);
    }
    args.push(provider.systemPromptFlag, options.systemPrompt);
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
 * @param {boolean} [options.inheritLogin=false] - Keep the operator's CLI config dirs (no pool account)
 * @param {string} [options.input] - Text written to the child's stdin before it is closed
 * @param {Function} [options.onStdout] - (chunk: string) => void
 * @param {Function} [options.onStderr] - (chunk: string) => void
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string, durationMs: number }>}
 */
export function spawnFriendProcess(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const cwd = options.cwd || process.cwd();
    const timeoutMs = options.timeoutMs ?? 120000;

    // Cleanse ambient provider credentials and config dirs unless explicitly passed in options.env (Task #47)
    const baseEnv = { ...process.env };
    if (!options.env?.ANTHROPIC_API_KEY) delete baseEnv.ANTHROPIC_API_KEY;
    if (!options.env?.OPENAI_API_KEY) delete baseEnv.OPENAI_API_KEY;
    if (!options.env?.MOONSHOT_API_KEY) delete baseEnv.MOONSHOT_API_KEY;
    if (!options.env?.XAI_API_KEY) delete baseEnv.XAI_API_KEY;
    if (!options.inheritLogin) {
      if (!options.env?.CLAUDE_CONFIG_DIR) delete baseEnv.CLAUDE_CONFIG_DIR;
      if (!options.env?.CODEX_HOME) delete baseEnv.CODEX_HOME;
      if (!options.env?.KIMI_HOME) delete baseEnv.KIMI_HOME;
      if (!options.env?.OPENCODE_HOME) delete baseEnv.OPENCODE_HOME;
      if (!options.env?.GROK_HOME) delete baseEnv.GROK_HOME;
    }

    const env = { ...baseEnv, ...(options.env || {}) };
    // Claude friends go through the account proxy when one is configured (CLAUDE_PROXY_URL in the
    // operator's environment, or ~/.claude/settings.json env.ANTHROPIC_BASE_URL), so a friend run
    // draws on the pool, not on one login. A pool API key means a real API account: no proxy for it.
    if (/\bclaude/.test(path.basename(binary)) && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_BASE_URL) {
      const proxy = process.env.CLAUDE_PROXY_URL || claudeSettingsBaseUrl();
      if (proxy) env.ANTHROPIC_BASE_URL = proxy;
    }

    let stdout = '';
    let stderr = '';
    let isFinished = false;

    const child = spawn(binary, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (child.stdin) {
      child.stdin.on('error', () => {}); // a child that exits early closes its stdin: not our error
      try { child.stdin.end(options.input ?? undefined); } catch {}
    }

    let timedOut = false;
    let timeoutTimer = null;
    let killTimer = null;

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!isFinished) {
          timedOut = true;
          try {
            child.kill('SIGTERM');
            killTimer = setTimeout(() => {
              try { child.kill('SIGKILL'); } catch {}
            }, 1000);
          } catch {}
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
      if (killTimer) clearTimeout(killTimer);
      if (!isFinished) {
        isFinished = true;
        reject(err);
      }
    });

    child.on('close', (code, signal) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (!isFinished) {
        isFinished = true;
        if (timedOut) {
          reject(new Error(`Friend process timed out after ${timeoutMs}ms (${binary} ${args.slice(0, 2).join(' ')}). CUT BY A TIMER THE CALLER SET: the work is NOT finished and this is not a verdict. Resume it in the same workspace, or run it with --timeout 0.`));
        } else {
          const durationMs = Date.now() - startTime;
          // A child killed by a signal has code null: report 128 + signal number, never a green 0.
          const signalCode = signal ? 128 + (os.constants.signals[signal] || 0) : 1;
          resolve({
            exitCode: code ?? signalCode,
            signal: signal || null,
            stdout,
            stderr,
            durationMs
          });
        }
      }
    });
  });
}

function claudeSettingsBaseUrl() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')).env?.ANTHROPIC_BASE_URL || null; } catch { return null; }
}

/**
 * Rate limit or revoked login, read from the output of a FAILED run only: a green run that prints
 * "429" in a diff stat is not a rate limit.
 */
export function classifyFailure({ exitCode, stdout = '', stderr = '' }) {
  if (exitCode === 0) return { isRateLimited: false, isRevoked: false };
  const text = `${stdout} ${stderr}`;
  const isRateLimited = /\b429\b|rate[_\s-]?limit(ed)?\b|quota[_\s-]?exceeded/i.test(text);
  const isRevoked = !isRateLimited && /\b401\b|\bunauthorized\b|\brevoked\b|token[_\s-]?expired/i.test(text);
  return { isRateLimited, isRevoked };
}

/**
 * A run has no timer unless the caller sets one. 0, a negative number, or text that is not a
 * number all mean "no timer"; a live orchestrator decides when a run has gone on too long.
 */
export function parseTimeoutMs(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
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
 * @param {number} [options.timeoutMs=0] - No timer by default. A value above 0 cuts the run after that many ms.
 * @param {Function} [options.onStdout]
 * @param {Function} [options.onStderr]
 * @returns {Promise<object>} Execution report
 */
export async function dispatchFriend(friendId, options = {}) {
  if (options.host) return dispatchRemoteFriend(friendId, options);
  const { binary, args, provider } = resolveFriendCommand(friendId, options);
  const cwd = options.cwd || process.cwd();
  const description = options.description || `friend(${friendId}): ${options.prompt ? options.prompt.slice(0, 60) : 'run'}`;
  const agentId = options.agentId || 'manager-pm';
  const baseAuthDir = options.baseAuthDir || null;

  // 1. Resolve sandboxed environment if provider is supported
  let friendEnv = options.env ? { ...options.env } : {};
  let configDir = null;
  const sandboxProvider = provider.sandboxProvider || friendId;
  if (SUPPORTED_PROVIDERS.includes(sandboxProvider)) {
    const sandboxed = resolveFriendEnvironment({
      provider: sandboxProvider,
      agentId,
      baseAuthDir,
      customEnv: friendEnv
    });
    friendEnv = sandboxed.env;
    configDir = sandboxed.configDir;
  }

  // 2. Select healthy account from pool if store available
  let activeAccount = null;
  let store = options.accountStore || null;
  if (!store && options.accountsPath !== false) {
    try {
      store = openAccountStore({ storagePath: options.accountsPath });
    } catch {
      store = null;
    }
  }

  if (store) {
    activeAccount = store.getHealthyAccount(friendId, agentId);
    if (activeAccount) {
      if (activeAccount.type === 'api_key' && activeAccount.credentials?.apiKey) {
        if (friendId === 'claude') {
          friendEnv.ANTHROPIC_API_KEY = activeAccount.credentials.apiKey;
        } else if (friendId === 'codex') {
          friendEnv.OPENAI_API_KEY = activeAccount.credentials.apiKey;
        } else if (friendId === 'kimi') {
          friendEnv.MOONSHOT_API_KEY = activeAccount.credentials.apiKey;
        }
      } else if (activeAccount.type === 'oauth' && activeAccount.credentials?.oauth && configDir) {
        if (friendId === 'claude') {
          const credPath = path.join(configDir, '.credentials.json');
          fs.writeFileSync(credPath, JSON.stringify(activeAccount.credentials.oauth, null, 2), { mode: 0o600 });
        } else if (friendId === 'codex') {
          const authPath = path.join(configDir, 'auth.json');
          fs.writeFileSync(authPath, JSON.stringify(activeAccount.credentials.oauth, null, 2), { mode: 0o600 });
        }
      }
    }
  }

  // 3. No pool account: use the operator's own CLI login instead of an empty sandbox profile.
  //    The sandbox only protects the operator's config when a pool credential is in play.
  const inheritLogin = !activeAccount && SUPPORTED_PROVIDERS.includes(sandboxProvider);
  if (inheritLogin) {
    delete friendEnv.CLAUDE_CONFIG_DIR;
    delete friendEnv.CODEX_HOME;
    delete friendEnv.KIMI_HOME;
    delete friendEnv.OPENCODE_HOME;
    delete friendEnv.GROK_HOME;
    configDir = null;
    if (typeof options.onStderr === 'function') {
      options.onStderr(`[friends] no ${friendId} account in the pool; using the operator's own ${friendId} login\n`);
    }
  }

  const report = await withJjIsolation(
    cwd,
    { description, noJj: options.noJj, autoAbandon: options.autoAbandon },
    async ({ changeId, isIsolated }) => {
      const execResult = await spawnFriendProcess(binary, args, {
        cwd,
        env: friendEnv,
        inheritLogin,
        timeoutMs: options.timeoutMs ?? 0,
        onStdout: options.onStdout,
        onStderr: options.onStderr
      });
      return execResult;
    }
  );

  const { isRateLimited, isRevoked } = classifyFailure(report.result);

  if (activeAccount && store) {
    if (isRateLimited) {
      store.recordRateLimit(activeAccount.id);
    } else if (isRevoked) {
      store.updateAccount(activeAccount.id, { status: 'revoked' });
    } else if (report.result.exitCode === 0) {
      store.recordSuccess(activeAccount.id);
    }
  }

  return {
    provider: friendId,
    displayName: provider.displayName,
    binary,
    args,
    prompt: options.prompt,
    cwd,
    accountId: activeAccount?.id || null,
    auth: activeAccount ? `pool:${activeAccount.id}` : 'operator-login',
    isIsolated: report.isIsolated,
    changeId: report.changeId,
    commitId: report.commitId,
    diffStat: report.diffStat,
    exitCode: report.result.exitCode,
    stdout: report.result.stdout,
    stderr: report.result.stderr,
    durationMs: report.result.durationMs,
    isRateLimited,
    isRevoked
  };
}

/**
 * Quotes one word for a POSIX shell: ssh joins its argv into one string that the remote shell parses.
 */
export function shellQuote(word) {
  return `'${String(word).replace(/'/g, `'\\''`)}'`;
}

/** One ssh alias per line. When the file exists, remote runs go only to the hosts it lists. */
export const REMOTE_HOSTS_FILE = path.join(os.homedir(), '.config', 'incubator', 'remote-hosts');

function readRemoteHosts() {
  try { return fs.readFileSync(REMOTE_HOSTS_FILE, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')); } catch { return null; }
}

/** Auth variables a remote run forwards from the local environment (over stdin, never argv). */
export const REMOTE_AUTH_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MOONSHOT_API_KEY', 'XAI_API_KEY'];

/**
 * The wrapper the remote shell runs. Arguments: $0 friend-<runid> (the marker ps and pkill see),
 * $1 working directory, $2 system-prompt-file flag, then the command. Stdin: a count of auth lines,
 * the NAME=value lines, the system prompt byte count and bytes, then the prompt, which becomes the
 * friend's stdin (through fd 3: sh gives a background job /dev/null before any <&0). The friend runs in its own session so one kill takes its whole process tree; a
 * watchdog kills that tree when the ssh session (the wrapper's parent) goes away.
 */
export const REMOTE_WRAPPER = `set -u
IFS= read -r k; names=
i=0; while [ "$i" -lt "$k" ]; do IFS= read -r l; export "$l"; names="$names \${l%%=*}"; i=$((i+1)); done
IFS= read -r n; sp=
if [ "$n" -gt 0 ]; then sp=$(mktemp); dd bs=1 count="$n" of="$sp" 2>/dev/null; fi
cd "$1" || exit 97
flag=$2; shift 2
[ -n "$sp" ] && set -- "$@" "$flag" "$sp"
exec 3<&0
setsid "$@" <&3 3<&- & child=$!
exec 3<&-
for v in $names; do unset "$v"; done
stop() { kill -TERM "-$child" 2>/dev/null; sleep 5; kill -KILL "-$child" 2>/dev/null; }
trap 'stop; [ -n "$sp" ] && rm -f "$sp"; exit 143' HUP INT TERM
parent=$PPID
( while kill -0 "$parent" 2>/dev/null; do sleep 5; done; stop ) </dev/null >/dev/null 2>&1 & dog=$!
wait "$child"; rc=$?
kill "$dog" 2>/dev/null; [ -n "$sp" ] && rm -f "$sp"
exit "$rc"`;

/**
 * Builds the ssh argv and the stdin for a remote run. Pure: no I/O, so it is tested directly.
 * @returns {{ sshArgs: string[], input: string, runId: string, remoteCwd: string }}
 */
export function buildRemoteInvocation(friendId, options = {}, env = process.env, { allowedHosts = readRemoteHosts() } = {}) {
  const catalog = getFriendsCatalog(options.configPath);
  const provider = catalog[friendId];
  if (!provider) throw new Error(`Unknown friend provider "${friendId}"`);
  if (!provider.stdinPrompt) throw new Error(`Friend "${friendId}" cannot run remotely: it has no stdin prompt (stdinPrompt in the catalog)`);
  if (options.systemPrompt && !provider.systemPromptFileFlag) throw new Error(`Friend "${friendId}" cannot take a system prompt remotely (systemPromptFileFlag in the catalog)`);
  if (!options.remoteCwd) throw new Error('A remote run needs --remote-cwd: the folder on the host the friend works in');
  if (!options.host || String(options.host).startsWith('-')) throw new Error(`A remote run needs --host <ssh-alias>; "${options.host ?? ''}" is not one`); // a leading dash would be an ssh option

  const { binary, args } = resolveFriendCommand(friendId, { ...options, prompt: null, systemPrompt: null });
  if (provider.promptFlag) args.push(provider.promptFlag);
  if (allowedHosts && !allowedHosts.includes(options.host)) {
    throw new Error(`Host "${options.host}" is not in ${REMOTE_HOSTS_FILE}: remote runs go only to ${allowedHosts.join(', ') || 'no host'}`);
  }

  const auth = REMOTE_AUTH_VARS.filter(v => env[v]).map(v => {
    if (/[\r\n]/.test(env[v])) throw new Error(`${v} holds a line break: refusing to forward it`);
    return `${v}=${env[v]}`;
  });
  const system = options.systemPrompt || '';
  const input = `${auth.length}\n${auth.map(l => `${l}\n`).join('')}${Buffer.byteLength(system)}\n${system}${options.prompt || ''}`;

  const runId = options.runId || `${Date.now().toString(36)}-${process.pid}`;
  const remote = ['sh', '-c', REMOTE_WRAPPER, `friend-${runId}`, options.remoteCwd, provider.systemPromptFileFlag || '', binary, ...args];
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', options.host, remote.map(shellQuote).join(' ')];
  return { sshArgs, input, runId, remoteCwd: options.remoteCwd };
}

/**
 * Runs a friend on another host over ssh. No jj isolation, no sandbox profile, no local proxy:
 * the host's folder is the seat's to prepare (see the friends skill). The dispatchFriend report shape, plus host and runId.
 */
async function dispatchRemoteFriend(friendId, options) {
  const { sshArgs, input, runId, remoteCwd } = buildRemoteInvocation(friendId, options);
  if (typeof options.onStderr === 'function') {
    options.onStderr(`[friends] remote run friend-${runId} on ${options.host}:${remoteCwd}\n`);
    if (!REMOTE_AUTH_VARS.some(v => process.env[v])) {
      options.onStderr(`[friends] no token in this environment to forward (${REMOTE_AUTH_VARS.join(', ')}): the host needs its own login. Run through panel-as.sh to forward a Max token.\n`);
    }
  }
  const res = await spawnFriendProcess('ssh', sshArgs, {
    cwd: process.cwd(),
    input,
    inheritLogin: true,
    timeoutMs: options.timeoutMs ?? 0,
    onStdout: options.onStdout,
    onStderr: options.onStderr
  });
  return {
    provider: friendId,
    displayName: getFriendsCatalog(options.configPath)[friendId].displayName,
    binary: 'ssh',
    args: sshArgs,
    prompt: options.prompt,
    host: options.host,
    cwd: remoteCwd,
    runId,
    accountId: null,
    auth: 'forwarded',
    isIsolated: false,
    changeId: null,
    commitId: null,
    diffStat: null,
    exitCode: res.exitCode,
    stdout: res.stdout,
    stderr: res.stderr,
    durationMs: res.durationMs,
    signal: res.signal,
    ...classifyFailure(res)
  };
}
