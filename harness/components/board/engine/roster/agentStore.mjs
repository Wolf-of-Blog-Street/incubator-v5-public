import fs from 'node:fs';
import path from 'node:path';
import { generateToken, hashToken } from '../auth.mjs';

const AGENT_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/;
const PROJECT_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/;

export class AgentNotFoundError extends Error {
  constructor(agentId) {
    super(`Agent "${agentId}" not found in roster`);
    this.name = 'AgentNotFoundError';
    this.statusCode = 404;
  }
}

export class ProjectNotFoundError extends Error {
  constructor(agentId, projectId) {
    super(`Project "${projectId}" not found for agent "${agentId}"`);
    this.name = 'ProjectNotFoundError';
    this.statusCode = 404;
  }
}

export function validateAgentId(id) {
  if (!id || typeof id !== 'string' || !AGENT_ID_REGEX.test(id)) {
    throw new Error(`Invalid agent ID: "${id}". Must start with alphanumeric and contain only alphanumeric, underscores, or hyphens.`);
  }
}

export function validateProjectId(id) {
  if (!id || typeof id !== 'string' || !PROJECT_ID_REGEX.test(id)) {
    throw new Error(`Invalid project ID: "${id}". Must start with alphanumeric and contain only alphanumeric, underscores, or hyphens.`);
  }
}

function getDefaultConfig() {
  return {
    default_agent: 'manager-pm',
    manager: {
      agent_id: 'manager-pm',
      role: 'fleet-orchestrator',
      home_path: path.resolve('../..'),
      capabilities: ['provision-agent', 'install-harness', 'audit-fleet', 'deploy-board']
    },
    agents: [{
      id: 'manager-pm',
      name: 'Manager PM (Local Seat)',
      icon: '🛡️',
      color: 'cyan',
      tags: ['orchestrator', 'pair'],
      projects: [{ id: 'incubator-v5', name: 'Incubator v5 Platform', board: 'incubator-v5.sqlite', docs_path: 'docs/design' }]
    }]
  };
}

/**
 * Creates and initializes the in-memory agent metadata store and persistence layer.
 */
export function createAgentStore(options = {}, legacyBoardsDir) {
  const boardsDir = options.boardsDir ?? legacyBoardsDir ?? path.resolve('boards');
  let config = options.config ?? null;
  if (!config && options.rosterPath && fs.existsSync(options.rosterPath)) {
    config = JSON.parse(fs.readFileSync(options.rosterPath, 'utf8'));
  }
  if (!config) config = getDefaultConfig();

  const agentsMap = new Map();
  let defaultAgentId = config.default_agent ?? 'manager-pm';
  let operatorToken = options.operatorToken ?? config.operator_token ?? config.operator_token_hash ?? null;
  let managerConfig = config.manager ? { ...config.manager } : {
    agent_id: defaultAgentId,
    role: 'fleet-orchestrator',
    capabilities: ['provision-agent', 'install-harness', 'audit-fleet', 'deploy-board']
  };

  function register(agent) {
    if (!agent || typeof agent !== 'object') throw new Error('Agent configuration must be an object');
    validateAgentId(agent.id);

    const defaultDb = agent.board_db ? path.basename(agent.board_db) : `${agent.id}.sqlite`;
    let projects = [];
    if (Array.isArray(agent.projects) && agent.projects.length > 0) {
      projects = agent.projects.map(p => {
        const pId = p.id || 'default';
        validateProjectId(pId);
        const pDbFilename = p.board ? path.basename(p.board) : `${agent.id}.${pId}.sqlite`;
        return {
          id: pId,
          name: p.name || pId,
          board: pDbFilename,
          dbPath: path.resolve(boardsDir, pDbFilename),
          docs_path: p.docs_path || null
        };
      });
    } else {
      projects = [{
        id: 'default',
        name: agent.name || agent.id,
        board: defaultDb,
        dbPath: path.resolve(boardsDir, defaultDb),
        docs_path: agent.docs_dir || null
      }];
    }

    agentsMap.set(agent.id, {
      id: agent.id,
      name: agent.name || agent.id,
      icon: agent.icon || '🤖',
      color: agent.color || 'blue',
      tags: Array.isArray(agent.tags) ? agent.tags : [],
      token: agent.token || null,
      token_hash: agent.token_hash || (agent.token ? hashToken(agent.token) : null),
      harness_version: agent.harness_version || null,
      dbPath: projects[0].dbPath,
      docsDir: projects[0].docs_path,
      projects
    });
  }

  if (Array.isArray(config.agents)) {
    for (const ag of config.agents) register(ag);
  }

  if (agentsMap.size > 0 && !agentsMap.has(defaultAgentId)) {
    defaultAgentId = agentsMap.keys().next().value;
  }

  const locallyRegisteredAgentIds = new Set();

  function persist() {
    if (options.rosterPath) {
      if (fs.existsSync(options.rosterPath)) {
        try {
          const diskRaw = fs.readFileSync(options.rosterPath, 'utf8');
          const diskJson = JSON.parse(diskRaw);
          if (Array.isArray(diskJson.agents)) {
            const diskAgentIds = new Set(diskJson.agents.map(a => a.id));
            for (const inMemId of agentsMap.keys()) {
              if (!diskAgentIds.has(inMemId) && !locallyRegisteredAgentIds.has(inMemId)) {
                agentsMap.delete(inMemId);
              }
            }
          }
        } catch {
          // If disk read or parse fails, proceed with in-memory state
        }
      }

      const serialized = {
        version: config.version || '5.0.0',
        default_agent: defaultAgentId,
        operator_token_hash: operatorToken && operatorToken.startsWith('sha256:') ? operatorToken : (operatorToken ? hashToken(operatorToken) : null),
        manager: managerConfig,
        agents: Array.from(agentsMap.values()).map(a => {
          const entry = {
            id: a.id,
            name: a.name,
            icon: a.icon,
            color: a.color,
            tags: a.tags,
            token_hash: a.token_hash || (a.token ? hashToken(a.token) : null),
            projects: a.projects.map(p => ({ id: p.id, name: p.name, board: p.board, docs_path: p.docs_path }))
          };
          if (a.harness_version) {
            entry.harness_version = a.harness_version;
          }
          return entry;
        })
      };
      const parentDir = path.dirname(path.resolve(options.rosterPath));
      fs.mkdirSync(parentDir, { recursive: true });
      const tmpPath = path.join(parentDir, `.${path.basename(options.rosterPath)}.tmp.${process.pid}.${Date.now()}`);
      fs.writeFileSync(tmpPath, JSON.stringify(serialized, null, 2), { mode: 0o600, encoding: 'utf8' });
      fs.renameSync(tmpPath, options.rosterPath);
      locallyRegisteredAgentIds.clear();
    }
  }

  return {
    agentsMap,
    get operatorToken() { return operatorToken; },
    get defaultAgentId() { return defaultAgentId; },
    setDefaultAgentId(id) {
      validateAgentId(id);
      if (!agentsMap.has(id)) throw new AgentNotFoundError(id);
      defaultAgentId = id;
      persist();
    },
    getManager() { return { ...managerConfig }; },
    updateManager(updates = {}) {
      if (typeof updates !== 'object' || !updates) throw new Error('Manager updates must be an object');
      if (updates.agent_id) {
        validateAgentId(updates.agent_id);
        if (!agentsMap.has(updates.agent_id)) throw new AgentNotFoundError(updates.agent_id);
      }
      managerConfig = { ...managerConfig, ...updates };
      persist();
      return { ...managerConfig };
    },
    hasAgent(agentId) {
      return agentsMap.has(agentId);
    },
    getAgent(agentId) {
      const agent = agentsMap.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);
      const { token, token_hash, ...safeMeta } = agent;
      return structuredClone(safeMeta);
    },
    updateAgent(agentId, updates = {}) {
      validateAgentId(agentId);
      const agent = agentsMap.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);
      if (!updates || typeof updates !== 'object') throw new Error('Agent updates must be an object');

      if (updates.name !== undefined) agent.name = String(updates.name);
      if (updates.icon !== undefined) agent.icon = String(updates.icon);
      if (updates.color !== undefined) agent.color = String(updates.color);
      if (updates.tags !== undefined && Array.isArray(updates.tags)) agent.tags = updates.tags;
      if (updates.harness_version !== undefined) {
        agent.harness_version = updates.harness_version === null ? null : String(updates.harness_version);
      }
      persist();
      const { token, token_hash, ...safeMeta } = agent;
      return structuredClone(safeMeta);
    },
    getProjects(agentId) {
      validateAgentId(agentId);
      const agent = agentsMap.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);
      return agent.projects.map(p => ({ id: p.id, name: p.name, board: p.board, docs_path: p.docs_path }));
    },
    registerAgent(agentConfig, optionsOrAutoGenerate = {}) {
      const opts = typeof optionsOrAutoGenerate === 'boolean'
        ? { autoGenerateToken: optionsOrAutoGenerate }
        : (optionsOrAutoGenerate ?? {});
      const { autoGenerateToken = false, allowOverwrite = false } = opts;

      if (!allowOverwrite && agentsMap.has(agentConfig.id)) {
        throw new Error(`Agent "${agentConfig.id}" is already registered`);
      }

      let plainToken = null;
      let configToRegister = { ...agentConfig };

      if (autoGenerateToken && !configToRegister.token && !configToRegister.token_hash) {
        plainToken = generateToken(`agt_live_${agentConfig.id}_`);
        configToRegister.token_hash = hashToken(plainToken);
      } else if (configToRegister.token && !configToRegister.token_hash) {
        plainToken = configToRegister.token;
        configToRegister.token_hash = hashToken(plainToken);
      }

      register(configToRegister);
      locallyRegisteredAgentIds.add(configToRegister.id);
      persist();

      const registered = this.getAgent(configToRegister.id);
      return { agent: registered, ...(plainToken ? { token: plainToken } : {}) };
    },
    revokeAgent(agentId, onRevokeCallback) {
      validateAgentId(agentId);
      if (!agentsMap.has(agentId)) throw new AgentNotFoundError(agentId);
      if (typeof onRevokeCallback === 'function') onRevokeCallback(agentId);

      agentsMap.delete(agentId);
      if (defaultAgentId === agentId) {
        defaultAgentId = agentsMap.keys().next().value || 'default';
      }
      if (managerConfig.agent_id === agentId) {
        managerConfig.agent_id = defaultAgentId;
      }
      persist();
      return true;
    },
    rotateAgentToken(agentId) {
      validateAgentId(agentId);
      const agent = agentsMap.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);

      const prevTokenHash = agent.token_hash;
      const prevToken = agent.token;
      const newToken = generateToken(`agt_live_${agentId}_`);
      agent.token_hash = hashToken(newToken);
      agent.token = null;

      try {
        persist();
      } catch (err) {
        agent.token_hash = prevTokenHash;
        agent.token = prevToken;
        throw err;
      }
      return { agentId, token: newToken };
    },
    allocateProject(agentId, projectDef, onAllocateCallback) {
      validateAgentId(agentId);
      const agent = agentsMap.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);
      if (!projectDef || !projectDef.id) throw new Error('Project definition with id is required');

      const pId = projectDef.id;
      validateProjectId(pId);
      const pDbFilename = projectDef.board ? path.basename(projectDef.board) : `${agent.id}.${pId}.sqlite`;
      const projectRecord = {
        id: pId,
        name: projectDef.name || pId,
        board: pDbFilename,
        dbPath: path.resolve(boardsDir, pDbFilename),
        docs_path: projectDef.docs_path || 'docs/design'
      };

      const existingIndex = agent.projects.findIndex(p => p.id === pId);
      if (existingIndex >= 0) {
        agent.projects[existingIndex] = projectRecord;
      } else {
        agent.projects.push(projectRecord);
      }

      if (typeof onAllocateCallback === 'function') onAllocateCallback(agentId, pId);
      persist();
      return { ...projectRecord };
    },
    persist
  };
}
