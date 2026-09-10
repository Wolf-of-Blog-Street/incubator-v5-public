/**
 * Incubator v5 — Friends Account Pool Engine
 *
 * Manages encrypted/safe multi-account pools for external AI CLI engines.
 * Supports API keys and OAuth sessions, rate-limit backoff cooling,
 * and multi-tenant agent seat assignment.
 *
 * Pure Node.js 22 ESM — Zero external dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { getDefaultAuthBaseDir, validateAgentId, SUPPORTED_PROVIDERS } from './sandbox.mjs';

export const ACCOUNT_STATUSES = ['healthy', 'cooling', 'expired', 'revoked'];
export const CREDENTIAL_TYPES = ['api_key', 'oauth'];

/**
 * Masks a secret string for safe logging and UI rendering.
 * @param {string} secret
 * @returns {string}
 */
export function maskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '******';
  const clean = secret.trim();
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

/**
 * Derives a consistent local machine encryption key for securing cached secrets.
 * @param {string} [salt]
 * @returns {Buffer} 32-byte key
 */
function deriveLocalEncryptionKey(salt = 'incubator-v5-friends-auth') {
  const seed = `${os.hostname()}-${os.userInfo().username}-${salt}`;
  return crypto.scryptSync(seed, 'salt-incubator-v5', 32);
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * @param {string} plaintext
 * @returns {string} iv:authTag:ciphertext (hex)
 */
export function encryptCredential(plaintext) {
  if (!plaintext) return '';
  const key = deriveLocalEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted credential string.
 * @param {string} payload
 * @returns {string}
 */
export function decryptCredential(payload) {
  if (!payload || !payload.includes(':')) return payload;
  try {
    const parts = payload.split(':');
    if (parts.length !== 3) return payload;
    const [ivHex, tagHex, encryptedHex] = parts;
    const key = deriveLocalEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // If decryption fails (e.g. plaintext migration), return as-is
    return payload;
  }
}

/**
 * Opens and manages the local account repository.
 *
 * @param {object} [options]
 * @param {string} [options.storagePath] - Custom path to accounts.json
 * @returns {object} Account store instance
 */
export function openAccountStore(options = {}) {
  const storagePath = options.storagePath
    ? path.resolve(options.storagePath)
    : path.join(getDefaultAuthBaseDir(), 'accounts.json');

  // Ensure parent directory exists with 0700 permissions
  fs.mkdirSync(path.dirname(storagePath), { recursive: true, mode: 0o700 });

  function loadAccounts() {
    if (!fs.existsSync(storagePath)) return [];
    const raw = fs.readFileSync(storagePath, 'utf8');
    if (!raw.trim()) return [];
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        throw new Error(`Corrupted account store: expected array in ${storagePath}`);
      }
      return data;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Corrupted account store in ${storagePath}: ${err.message}`);
      }
      throw err;
    }
  }

  function saveAccounts(accounts) {
    const serialized = JSON.stringify(accounts, null, 2);
    const parentDir = path.dirname(storagePath);
    const tmpPath = path.join(parentDir, `.${path.basename(storagePath)}.tmp.${process.pid}.${Date.now()}`);
    fs.writeFileSync(tmpPath, serialized, { mode: 0o600 });
    fs.renameSync(tmpPath, storagePath);
  }

  return {
    getStoragePath() {
      return storagePath;
    },

    /**
     * Adds an account to the pool.
     */
    addAccount({
      id = null,
      provider,
      type = 'api_key',
      label = null,
      credentials = {},
      assignedAgents = ['all']
    }) {
      if (!SUPPORTED_PROVIDERS.includes(provider)) {
        throw new Error(`Unsupported provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
      }
      if (!CREDENTIAL_TYPES.includes(type)) {
        throw new Error(`Invalid credential type "${type}". Supported: ${CREDENTIAL_TYPES.join(', ')}`);
      }

      const accountId = id || `acc-${provider}-${crypto.randomBytes(4).toString('hex')}`;
      const accounts = loadAccounts();

      if (accounts.some(a => a.id === accountId)) {
        throw new Error(`Account with ID "${accountId}" already exists`);
      }

      // Secure credentials before storing
      const securedCreds = { ...credentials };
      if (securedCreds.apiKey) {
        securedCreds.apiKey = encryptCredential(securedCreds.apiKey);
      }
      if (securedCreds.oauth?.accessToken) {
        securedCreds.oauth = {
          ...securedCreds.oauth,
          accessToken: encryptCredential(securedCreds.oauth.accessToken),
          refreshToken: securedCreds.oauth.refreshToken ? encryptCredential(securedCreds.oauth.refreshToken) : null
        };
      }

      const account = {
        id: accountId,
        provider,
        type,
        label: label || `${provider} (${type})`,
        credentials: securedCreds,
        status: 'healthy',
        coolingUntil: null,
        rateLimitCount: 0,
        lastUsedAt: null,
        assignedAgents: Array.isArray(assignedAgents) && assignedAgents.length > 0 ? assignedAgents : ['all'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      accounts.push(account);
      saveAccounts(accounts);

      return this.getAccount(accountId, { includeSecrets: false });
    },

    /**
     * Retrieves an account by ID.
     */
    getAccount(id, { includeSecrets = false } = {}) {
      const accounts = loadAccounts();
      const acc = accounts.find(a => a.id === id);
      if (!acc) return null;

      const copy = JSON.parse(JSON.stringify(acc));
      if (!includeSecrets) {
        if (copy.credentials.apiKey) {
          copy.credentials.apiKey = maskSecret(decryptCredential(copy.credentials.apiKey));
        }
        if (copy.credentials.oauth?.accessToken) {
          copy.credentials.oauth.accessToken = maskSecret(decryptCredential(copy.credentials.oauth.accessToken));
          if (copy.credentials.oauth.refreshToken) {
            copy.credentials.oauth.refreshToken = maskSecret(decryptCredential(copy.credentials.oauth.refreshToken));
          }
        }
      } else {
        if (copy.credentials.apiKey) {
          copy.credentials.apiKey = decryptCredential(copy.credentials.apiKey);
        }
        if (copy.credentials.oauth?.accessToken) {
          copy.credentials.oauth.accessToken = decryptCredential(copy.credentials.oauth.accessToken);
          if (copy.credentials.oauth.refreshToken) {
            copy.credentials.oauth.refreshToken = decryptCredential(copy.credentials.oauth.refreshToken);
          }
        }
      }
      return copy;
    },

    /**
     * Lists accounts matching optional filters.
     */
    listAccounts({ provider = null, agentId = null, includeSecrets = false } = {}) {
      const accounts = loadAccounts();
      const now = Date.now();
      let modified = false;

      // Automatically reset expired cooling periods
      for (const a of accounts) {
        if (a.coolingUntil && now >= a.coolingUntil) {
          a.status = 'healthy';
          a.coolingUntil = null;
          a.updatedAt = new Date().toISOString();
          modified = true;
        }
      }
      if (modified) saveAccounts(accounts);

      return accounts
        .filter(a => !provider || a.provider === provider)
        .filter(a => {
          if (!agentId) return true;
          return a.assignedAgents.includes('all') || a.assignedAgents.includes(agentId);
        })
        .map(a => this.getAccount(a.id, { includeSecrets }));
    },

    /**
     * Updates an existing account.
     */
    updateAccount(id, updates = {}) {
      const accounts = loadAccounts();
      const idx = accounts.findIndex(a => a.id === id);
      if (idx === -1) throw new Error(`Account "${id}" not found`);

      const acc = accounts[idx];
      if (updates.status && ACCOUNT_STATUSES.includes(updates.status)) {
        acc.status = updates.status;
      }
      if (updates.label !== undefined) acc.label = updates.label;
      if (updates.assignedAgents !== undefined && Array.isArray(updates.assignedAgents)) {
        acc.assignedAgents = updates.assignedAgents;
      }
      if (updates.coolingUntil !== undefined) acc.coolingUntil = updates.coolingUntil;
      if (updates.rateLimitCount !== undefined) acc.rateLimitCount = updates.rateLimitCount;
      if (updates.lastUsedAt !== undefined) acc.lastUsedAt = updates.lastUsedAt;

      if (updates.credentials) {
        const creds = { ...updates.credentials };
        if (creds.apiKey) creds.apiKey = encryptCredential(creds.apiKey);
        if (creds.oauth?.accessToken) {
          creds.oauth = {
            ...creds.oauth,
            accessToken: encryptCredential(creds.oauth.accessToken),
            refreshToken: creds.oauth.refreshToken ? encryptCredential(creds.oauth.refreshToken) : null
          };
        }
        acc.credentials = creds;
      }

      acc.updatedAt = new Date().toISOString();
      accounts[idx] = acc;
      saveAccounts(accounts);

      return this.getAccount(id, { includeSecrets: false });
    },

    /**
     * Removes an account from the pool.
     */
    removeAccount(id) {
      const accounts = loadAccounts();
      const filtered = accounts.filter(a => a.id !== id);
      if (filtered.length === accounts.length) return false;
      saveAccounts(filtered);
      return true;
    },

    /**
     * Selects the optimal healthy account for a given provider and agent seat.
     * Uses Least-Recently-Used (LRU) rotation among healthy accounts.
     *
     * @param {string} provider
     * @param {string} [agentId='all']
     * @returns {object|null} Account with decrypted credentials, or null if pool exhausted
     */
    getHealthyAccount(provider, agentId = 'all') {
      const candidates = this.listAccounts({ provider, agentId, includeSecrets: true });
      const now = Date.now();

      const healthy = candidates.filter(a => {
        if (a.status === 'revoked') return false;
        if (a.coolingUntil && now < a.coolingUntil) return false;
        if (a.credentials?.oauth?.expiresAt && now >= a.credentials.oauth.expiresAt) return false;
        return a.status === 'healthy';
      });

      if (healthy.length === 0) return null;

      // Sort by lastUsedAt ascending (nulls first, then oldest)
      healthy.sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return 0;
        if (!a.lastUsedAt) return -1;
        if (!b.lastUsedAt) return 1;
        return new Date(a.lastUsedAt).getTime() - new Date(b.lastUsedAt).getTime();
      });

      return healthy[0];
    },

    /**
     * Records a 429 rate limit hit for an account and sets cooling backoff.
     */
    recordRateLimit(accountId, retryAfterMs = 60000) {
      const acc = this.getAccount(accountId, { includeSecrets: true });
      if (!acc) return null;

      const newCount = (acc.rateLimitCount || 0) + 1;
      // Exponential backoff up to 10 minutes
      const backoffMs = Math.min(retryAfterMs * Math.pow(1.5, newCount - 1), 600000);
      const coolingUntil = Date.now() + backoffMs;

      return this.updateAccount(accountId, {
        status: 'cooling',
        coolingUntil,
        rateLimitCount: newCount
      });
    },

    /**
     * Records successful task execution for an account and resets cooling state.
     */
    recordSuccess(accountId) {
      return this.updateAccount(accountId, {
        status: 'healthy',
        coolingUntil: null,
        rateLimitCount: 0,
        lastUsedAt: new Date().toISOString()
      });
    }
  };
}
