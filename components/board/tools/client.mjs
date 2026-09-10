import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBoard } from '../engine/board.mjs';

function findDefaultDb() {
  if (process.env.BOARD_DB) return process.env.BOARD_DB;
  return path.resolve('boards/project.sqlite');
}

/**
 * Searches upward from starting directories until a falcon env file is found.
 */
function findFalconEnvFile(startDirs = []) {
  if (process.env.FALCON_ENV_PATH && fs.existsSync(process.env.FALCON_ENV_PATH)) {
    return path.resolve(process.env.FALCON_ENV_PATH);
  }

  const filePatterns = ['harness/falcon.env', '.falcon.env', 'falcon.env'];

  for (const start of startDirs) {
    if (!start) continue;
    let curr = path.resolve(start);
    while (true) {
      for (const pattern of filePatterns) {
        const candidate = path.join(curr, pattern);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  }

  return null;
}

/**
 * Automatically loads harness/falcon.env into process.env if present and not already set.
 */
export function autoLoadFalconEnv() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const envFile = findFalconEnvFile([process.cwd(), currentDir]);

  if (!envFile) return;

  try {
    const content = fs.readFileSync(envFile, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {
    // ignore read error
  }
}

/**
 * Creates a Board client.
 * If FALCON_BOARD_URL (or options.url) is provided, connects over HTTP/HTTPS with Bearer token.
 * Otherwise, seamlessly falls back to direct local SQLite access.
 * 
 * @param {Object} options
 * @param {string} [options.url] Base URL of Falcon Manager Board (e.g. http://localhost:3333)
 * @param {string} [options.token] Bearer auth token for the agent seat
 * @param {string} [options.agentId] Optional agent ID identifier
 * @param {string} [options.dbPath] Path to local SQLite database (for fallback)
 */
function resolveDocPath(slug, explicitPath = null) {
  if (explicitPath && fs.existsSync(explicitPath)) {
    return path.resolve(explicitPath);
  }
  const candidates = [
    explicitPath,
    path.resolve(`docs/design/${slug}.md`),
    path.resolve(`workspaces/incubator-v5/docs/design/${slug}.md`),
    path.resolve(`../workspaces/incubator-v5/docs/design/${slug}.md`),
    path.resolve(`../incubator-v5-docs/design/${slug}.md`),
    path.resolve(`workspaces/incubator-v5-docs/design/${slug}.md`)
  ].filter(Boolean);

  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

export function createBoardClient(options = {}) {
  if (process.env.FALCON_ENV_LOADED !== '1') {
    autoLoadFalconEnv();
  }
  const url = options.local === true ? null : (options.url || process.env.FALCON_BOARD_URL || null);
  const token = options.token || process.env.FALCON_BOARD_TOKEN || process.env.FALCON_AGENT_TOKEN || null;
  const dbPath = options.dbPath || findDefaultDb();
  const agentId = options.agentId || process.env.FALCON_AGENT_ID || null;
  const project = options.project || process.env.BOARD_PROJECT || null;

  if (!url) {
    // Local fallback direct SQLite
    const board = openBoard(dbPath);
    return {
      isRemote: false,
      addItem: (item) => board.addItem(item),
      updateItem: (id, updates) => board.updateItem(id, updates),
      deleteItem: (id) => board.deleteItem(id),
      listItems: (filters) => board.listItems(filters),
      getItem: (id) => board.getItem(id),
      toggleChecklistItem: (id, index) => board.toggleChecklistItem(id, index),
      getBoardSummary: () => board.getBoardSummary(),
      closeDesignDoc: (slug, opts) => board.closeDesignDoc(slug, opts),
      finishDesignDoc: (slug, opts) => board.closeDesignDoc(slug, opts),
      openDesignDoc: (slug) => board.reopenDesignDoc(slug),
      reopenDesignDoc: (slug) => board.reopenDesignDoc(slug),
      syncDoc: async (slug, filePath) => {
        const resolved = resolveDocPath(slug, filePath);
        if (!resolved) {
          throw new Error(`Design doc file not found for slug "${slug}"`);
        }
        return { success: true, local: true, slug, filePath: resolved };
      },
      close: () => board.close()
    };
  }

  // Remote REST API client
  const cleanUrl = url.replace(/\/+$/, '');
  const headers = {
    'Content-Type': 'application/json',
    'Connection': 'close'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  async function request(endpoint, method = 'GET', body = null) {
    const opts = { method, headers: { ...headers } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${cleanUrl}${endpoint}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status} from board server`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  return {
    isRemote: true,
    async addItem(item) {
      const payload = { ...item };
      if (agentId && !payload.agent) payload.agent = agentId;
      if (project && !payload.project) payload.project = project;
      const data = await request('/api/v1/tasks', 'POST', payload);
      return data.task.id;
    },
    async updateItem(id, updates) {
      const payload = { ...updates };
      if (agentId && !payload.agent) payload.agent = agentId;
      if (project && !payload.project) payload.project = project;
      const data = await request(`/api/v1/tasks/${id}`, 'PATCH', payload);
      return data.task;
    },
    async deleteItem(id) {
      const params = new URLSearchParams();
      if (agentId) params.set('agent', agentId);
      if (project) params.set('project', project);
      const q = params.toString() ? `?${params.toString()}` : '';
      const data = await request(`/api/v1/tasks/${id}${q}`, 'DELETE');
      return data.success === true;
    },
    async listItems(filters = {}) {
      const params = new URLSearchParams();
      if (agentId) params.set('agent', agentId);
      if (project) params.set('project', project);
      if (filters.doc || filters.design_slug) params.set('doc', filters.doc || filters.design_slug);
      if (filters.status) params.set('status', filters.status);
      if (filters.mode) params.set('mode', filters.mode);
      if (filters.track) params.set('track', filters.track);
      const q = params.toString() ? `?${params.toString()}` : '';
      const data = await request(`/api/v1/tasks${q}`, 'GET');
      return data.tasks || [];
    },
    async getItem(id) {
      const params = new URLSearchParams();
      if (agentId) params.set('agent', agentId);
      if (project) params.set('project', project);
      const q = params.toString() ? `?${params.toString()}` : '';
      const data = await request(`/api/v1/tasks/${id}${q}`, 'GET');
      return data.task;
    },
    async toggleChecklistItem(id, index) {
      const payload = { index };
      if (agentId) payload.agent = agentId;
      if (project) payload.project = project;
      const data = await request(`/api/v1/tasks/${id}/toggle-checklist`, 'POST', payload);
      return data.task;
    },
    async getBoardSummary() {
      const params = new URLSearchParams();
      if (project) params.set('project', project);
      const q = params.toString() ? `?${params.toString()}` : '';
      const endpoint = agentId ? `/api/v1/agents/${agentId}/board${q}` : `/api/v1/board${q}`;
      return await request(endpoint, 'GET');
    },
    async syncDoc(slug, filePath) {
      if (!slug) throw new Error('slug is required');
      const resolved = resolveDocPath(slug, filePath);
      if (!resolved) {
        throw new Error(`Design doc file not found for slug "${slug}"`);
      }
      const content = fs.readFileSync(resolved, 'utf8');
      const payload = { slug, content };
      if (agentId) payload.agent = agentId;
      if (project) payload.project = project;
      return await request('/api/v1/docs/sync', 'POST', payload);
    },
    async closeDesignDoc(slug, opts = {}) {
      const payload = { status: 'Closed', force: Boolean(opts.force) };
      if (agentId) payload.agent = agentId;
      if (project) payload.project = project;
      const endpoint = agentId ? `/api/v1/agents/${agentId}/docs/${slug}/status` : `/api/v1/docs/${slug}/status`;
      const res = await request(endpoint, 'POST', payload);
      return { closed: true, designSlug: slug, ...res };
    },
    async finishDesignDoc(slug, opts = {}) {
      return this.closeDesignDoc(slug, opts);
    },
    async openDesignDoc(slug) {
      const payload = { status: 'Active' };
      if (agentId) payload.agent = agentId;
      if (project) payload.project = project;
      const endpoint = agentId ? `/api/v1/agents/${agentId}/docs/${slug}/status` : `/api/v1/docs/${slug}/status`;
      const res = await request(endpoint, 'POST', payload);
      return { reopened: true, designSlug: slug, ...res };
    },
    async reopenDesignDoc(slug) {
      return this.openDesignDoc(slug);
    },
    close() {
      // HTTP client holds no open sockets or handles
    }
  };
}
