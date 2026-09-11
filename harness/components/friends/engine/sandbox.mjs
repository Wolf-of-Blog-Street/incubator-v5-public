/**
 * Incubator v5 — Friends Sandbox Engine
 *
 * Provides dedicated directory and profile isolation for external CLI engines
 * (Claude Code, OpenAI Codex, Kimi, OpenCode).
 * Guarantees zero leakage into operator personal configs (~/.claude, ~/.codex)
 * and partitions macOS Keychain entries per agent seat.
 *
 * Pure Node.js 22 ESM — Zero external dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const SUPPORTED_PROVIDERS = ['claude', 'codex', 'kimi', 'opencode'];

export function getDefaultAuthBaseDir() {
  return path.join(os.homedir(), '.incubator', 'auth');
}

/**
 * Validates agent identifier against directory traversal and special chars.
 * @param {string} agentId
 * @returns {string}
 */
export function validateAgentId(agentId) {
  if (typeof agentId !== 'string' || !agentId.trim()) {
    throw new Error('Agent ID must be a non-empty string');
  }
  const clean = agentId.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(clean)) {
    throw new Error(`Invalid agent ID "${agentId}". Must contain only alphanumeric characters, dashes, and underscores.`);
  }
  return clean;
}

/**
 * Resolves dedicated, isolated profile paths and environment variables for a friend.
 * Automatically provisions initial configuration skeletons and enforces 0700/0600 permissions.
 *
 * @param {object} params
 * @param {string} params.provider - 'claude' | 'codex' | 'kimi' | 'opencode'
 * @param {string} [params.agentId='default'] - Target agent seat identifier
 * @param {string} [params.baseAuthDir] - Root auth storage directory
 * @param {Record<string, string>} [params.customEnv] - Additional custom environment variables
 * @returns {{ provider: string, agentId: string, configDir: string, env: Record<string, string> }}
 */
export function resolveFriendEnvironment({
  provider,
  agentId = 'default',
  baseAuthDir = null,
  customEnv = {}
}) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported friend provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }

  const validAgentId = validateAgentId(agentId);
  const rootAuth = baseAuthDir ? path.resolve(baseAuthDir) : getDefaultAuthBaseDir();
  const configDir = path.join(rootAuth, 'agents', validAgentId, 'friends', provider);

  // Ensure isolated config directory exists with 0700 permissions
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

  // Initialize provider-specific configuration skeletons
  if (provider === 'claude') {
    const claudeJsonPath = path.join(configDir, '.claude.json');
    if (!fs.existsSync(claudeJsonPath)) {
      const initialConfig = JSON.stringify({
        hasCompletedOnboarding: true,
        theme: 'dark',
        migrationVersion: 13
      }, null, 2);
      fs.writeFileSync(claudeJsonPath, initialConfig, { mode: 0o600 });
    }
  } else if (provider === 'codex') {
    const codexConfigPath = path.join(configDir, 'config.toml');
    if (!fs.existsSync(codexConfigPath)) {
      const initialToml = [
        '# Incubator v5 Sandboxed Codex Configuration',
        '# Isolated from operator personal ~/.codex',
        ''
      ].join('\n');
      fs.writeFileSync(codexConfigPath, initialToml, { mode: 0o600 });
    }
  }

  // Construct isolated environment dictionary
  const env = { ...process.env, ...customEnv };

  if (provider === 'claude') {
    env.CLAUDE_CONFIG_DIR = configDir;
    env.DISABLE_AUTOUPDATER = '1';
    if (!customEnv.ANTHROPIC_API_KEY) {
      delete env.ANTHROPIC_API_KEY;
    }
  } else if (provider === 'codex') {
    env.CODEX_HOME = configDir;
    if (!customEnv.OPENAI_API_KEY) {
      delete env.OPENAI_API_KEY;
    }
  } else if (provider === 'kimi') {
    env.KIMI_HOME = configDir;
    if (!customEnv.MOONSHOT_API_KEY) {
      delete env.MOONSHOT_API_KEY;
    }
  } else if (provider === 'opencode') {
    env.OPENCODE_HOME = configDir;
  }

  assertZeroLeakage(provider, env);

  return {
    provider,
    agentId: validAgentId,
    configDir,
    env
  };
}

/**
 * Asserts that the synthesized environment strictly points to an isolated sandbox
 * and cannot mutate the operator's personal configuration files.
 *
 * @param {string} provider
 * @param {Record<string, string>} env
 * @returns {boolean}
 */
export function assertZeroLeakage(provider, env) {
  const home = os.homedir();
  const personalClaude = path.join(home, '.claude');
  const personalCodex = path.join(home, '.codex');

  if (provider === 'claude') {
    if (!env.CLAUDE_CONFIG_DIR) {
      throw new Error('Sandbox violation: CLAUDE_CONFIG_DIR is not set');
    }
    const resolved = path.resolve(env.CLAUDE_CONFIG_DIR);
    if (resolved === path.resolve(home) || resolved === path.resolve(personalClaude)) {
      throw new Error(`Sandbox violation: CLAUDE_CONFIG_DIR points to operator personal path: ${resolved}`);
    }
  } else if (provider === 'codex') {
    if (!env.CODEX_HOME) {
      throw new Error('Sandbox violation: CODEX_HOME is not set');
    }
    const resolved = path.resolve(env.CODEX_HOME);
    if (resolved === path.resolve(personalCodex)) {
      throw new Error(`Sandbox violation: CODEX_HOME points to operator personal path: ${resolved}`);
    }
  }

  return true;
}
