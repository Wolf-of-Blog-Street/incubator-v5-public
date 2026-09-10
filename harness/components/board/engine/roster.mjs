import fs from 'node:fs';
import path from 'node:path';
import { openBoard } from './board.mjs';
import { authenticateRequest, assertTenantAccess, generateToken, hashToken } from './auth.mjs';

const AGENT_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/;

export class AgentNotFoundError extends Error {
  constructor(agentId) {
    super(`Agent "${agentId}" not found in roster`);
    this.name = 'AgentNotFoundError';
    this.statusCode = 404;
  }
}

/**
 * Validates agent ID format to ensure safety and prevent path traversal or CLI argument injection.
 * @param {string} id
 */
export function validateAgentId(id) {
  if (!id || typeof id !== 'string' || !AGENT_ID_REGEX.test(id)) {
    throw new Error(`Invalid agent ID: "${id}". Must start with alphanumeric and contain only alphanumeric, underscores, or hyphens.`);
  }
}

/**
 * Initializes and manages a multi-agent roster with isolated SQLite database connections.
 * 
 * @param {Object} options
 * @param {string} [options.rosterPath] Path to roster.json file
 * @param {Object} [options.config] Raw config object (if not reading from file)
 * @param {string} [options.boardsDir] Base directory to store agent SQLite databases (default: 'boards')
 * @param {string|null} [options.operatorToken] Optional master operator token
 */
export function openRoster(options = {}) {
  const boardsDir = path.resolve(options.boardsDir || 'boards');
  fs.mkdirSync(boardsDir, { recursive: true });

  let config = {};
  if (options.config) {
    config = options.config;
  } else if (options.rosterPath && fs.existsSync(options.rosterPath)) {
    const raw = fs.readFileSync(options.rosterPath, 'utf8');
    config = JSON.parse(raw);
  } else {
    // Default fallback roster with a local seat
    config = {
      default_agent: 'manager-pm',
      manager: {
        agent_id: 'manager-pm',
        role: 'fleet-orchestrator',
        home_path: path.resolve('../..'),
        capabilities: ['provision-agent', 'install-harness', 'audit-fleet', 'deploy-board']
      },
      agents: [
        {
          id: 'manager-pm',
          name: 'Manager PM (Local Seat)',
          icon: '🛡️',
          color: 'cyan',
          tags: ['orchestrator', 'pair'],
          projects: [
            {
              id: 'incubator-v5',
              name: 'Incubator v5 Platform',
              board: 'incubator-v5.sqlite',
              docs_path: 'docs/design'
            }
          ]
        }
      ]
    };
  }

  const agentsMap = new Map();
  const boardsPool = new Map();
  let defaultAgentId = config.default_agent || 'manager-pm';
  let operatorToken = options.operatorToken || config.operator_token || config.operator_token_hash || null;
  let managerConfig = config.manager || {
    agent_id: defaultAgentId,
    role: 'fleet-orchestrator',
    capabilities: ['provision-agent', 'install-harness', 'audit-fleet', 'deploy-board']
  };

  function register(agent) {
    if (!agent || typeof agent !== 'object') {
      throw new Error('Agent configuration must be an object');
    }
    validateAgentId(agent.id);

    // Resolve dbPath: if explicit board_db provided, resolve relative to boardsDir, else default
    const defaultDbFilename = agent.board_db ? path.basename(agent.board_db) : `${agent.id}.sqlite`;
    const defaultResolvedDbPath = path.resolve(boardsDir, defaultDbFilename);

    let projects = [];
    if (Array.isArray(agent.projects) && agent.projects.length > 0) {
      projects = agent.projects.map(p => {
        const pId = p.id || 'default';
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
      projects = [
        {
          id: 'default',
          name: agent.name || agent.id,
          board: defaultDbFilename,
          dbPath: defaultResolvedDbPath,
          docs_path: agent.docs_dir || null
        }
      ];
    }

    agentsMap.set(agent.id, {
      id: agent.id,
      name: agent.name || agent.id,
      icon: agent.icon || '🤖',
      color: agent.color || 'blue',
      tags: Array.isArray(agent.tags) ? agent.tags : [],
      token: agent.token || null,
      token_hash: agent.token_hash || (agent.token ? hashToken(agent.token) : null),
      dbPath: projects[0].dbPath,
      docsDir: projects[0].docs_path,
      projects
    });
  }

  // Register initial agents
  if (Array.isArray(config.agents)) {
    for (const ag of config.agents) {
      register(ag);
    }
  }

  if (agentsMap.size > 0 && !agentsMap.has(defaultAgentId)) {
    defaultAgentId = agentsMap.keys().next().value;
  }

  function persistRosterIfConfigured() {
    if (options.rosterPath) {
      const serialized = {
        version: config.version || '5.0.0',
        default_agent: defaultAgentId,
        operator_token_hash: operatorToken && operatorToken.startsWith('sha256:') ? operatorToken : (operatorToken ? hashToken(operatorToken) : null),
        manager: managerConfig,
        agents: Array.from(agentsMap.values()).map(a => ({
          id: a.id,
          name: a.name,
          icon: a.icon,
          color: a.color,
          tags: a.tags,
          token_hash: a.token_hash || (a.token ? hashToken(a.token) : null),
          projects: a.projects.map(p => ({
            id: p.id,
            name: p.name,
            board: p.board,
            docs_path: p.docs_path
          }))
        }))
      };
      const parentDir = path.dirname(path.resolve(options.rosterPath));
      fs.mkdirSync(parentDir, { recursive: true });
      const tmpPath = path.join(parentDir, `.${path.basename(options.rosterPath)}.tmp.${process.pid}.${Date.now()}`);
      fs.writeFileSync(tmpPath, JSON.stringify(serialized, null, 2), 'utf8');
      fs.renameSync(tmpPath, options.rosterPath);
    }
  }

  return {
    /**
     * Checks if an agent is registered in the roster.
     * @param {string} agentId 
     * @returns {boolean}
     */
    hasAgent(agentId) {
      return agentsMap.has(agentId);
    },

    /**
     * Retrieves sanitized metadata for an agent (token secrets omitted).
     * @param {string} agentId 
     * @returns {Object}
     */
    getAgent(agentId) {
      const agent = agentsMap.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);
      const { token, token_hash, ...safeMeta } = agent;
      return safeMeta;
    },

    /**
     * Returns the projects for an agent.
     * @param {string} agentId 
     * @returns {Array<Object>}
     */
    getProjects(agentId) {
      validateAgentId(agentId);
      const agent = agentsMap.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);
      return agent.projects.map(p => ({
        id: p.id,
        name: p.name,
        board: p.board,
        docs_path: p.docs_path
      }));
    },

    /**
     * Returns the default agent ID.
     * @returns {string}
     */
    getDefaultAgentId() {
      return defaultAgentId;
    },

    /**
     * Sets the default agent ID.
     * @param {string} id 
     */
    setDefaultAgentId(id) {
      validateAgentId(id);
      if (!agentsMap.has(id)) throw new AgentNotFoundError(id);
      defaultAgentId = id;
    },

    /**
     * Returns the Manager entity configuration.
     * @returns {Object}
     */
    getManager() {
      return { ...managerConfig };
    },

    /**
     * Updates Manager entity configuration.
     * @param {Object} updates
     */
    updateManager(updates = {}) {
      if (typeof updates !== 'object' || !updates) throw new Error('Manager updates must be an object');
      if (updates.agent_id) {
        validateAgentId(updates.agent_id);
        if (!agentsMap.has(updates.agent_id)) throw new AgentNotFoundError(updates.agent_id);
      }
      managerConfig = { ...managerConfig, ...updates };
      persistRosterIfConfigured();
      return { ...managerConfig };
    },

    /**
     * Dynamically registers or updates an agent in the roster.
     * If token is not provided or generated, optionally generates one.
     * @param {Object} agentConfig 
     * @param {boolean} [autoGenerateToken=false]
     * @returns {{ agent: Object, token?: string }}
     */
    registerAgent(agentConfig, autoGenerateToken = false) {
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
      persistRosterIfConfigured();

      const registered = this.getAgent(configToRegister.id);
      return {
        agent: registered,
        ...(plainToken ? { token: plainToken } : {})
      };
    },

    /**
     * Decommissions/revokes an agent seat from the active roster.
     * Closes any open board connections in the pool.
     * @param {string} agentId
     * @returns {boolean}
     */
    revokeAgent(agentId) {
      validateAgentId(agentId);
      if (!agentsMap.has(agentId)) throw new AgentNotFoundError(agentId);

      // Evict any open board handles
      for (const key of Array.from(boardsPool.keys())) {
        if (key.startsWith(`${agentId}::`)) {
          try {
            boardsPool.get(key).close();
          } catch (e) {
            // ignore
          }
          boardsPool.delete(key);
        }
      }

      agentsMap.delete(agentId);
      if (defaultAgentId === agentId) {
        defaultAgentId = agentsMap.keys().next().value || 'default';
      }

      persistRosterIfConfigured();
      return true;
    },

    /**
     * Rotates an agent's secret token, returning the newly generated token.
     * @param {string} agentId
     * @returns {{ agentId: string, token: string }}
     */
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
        persistRosterIfConfigured();
      } catch (err) {
        // Rollback state in memory if persistence fails
        agent.token_hash = prevTokenHash;
        agent.token = prevToken;
        throw err;
      }
      return { agentId, token: newToken };
    },

    /**
     * Allocates or updates a workspace project for a specific agent.
     * @param {string} agentId 
     * @param {Object} projectDef { id, name, board, docs_path }
     */
    allocateProject(agentId, projectDef) {
      validateAgentId(agentId);
      const agent = agentsMap.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);
      if (!projectDef || !projectDef.id) throw new Error('Project definition with id is required');

      const pId = projectDef.id;
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

      persistRosterIfConfigured();
      return { ...projectRecord };
    },

    /**
     * Returns the pooled Board instance for the specified agent and project.
     * Lazily opens and caches the SQLite connection.
     * 
     * @param {string} agentId 
     * @param {string|null} [projectId=null]
     * @returns {Object} Board instance
     */
    getBoard(agentId, projectId = null) {
      validateAgentId(agentId);
      const agent = agentsMap.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);

      let targetProject = agent.projects[0];
      if (projectId) {
        const found = agent.projects.find(p => p.id === projectId);
        if (found) targetProject = found;
      }

      const poolKey = `${agentId}::${targetProject.id}`;
      if (!boardsPool.has(poolKey)) {
        boardsPool.set(poolKey, openBoard(targetProject.dbPath));
      }
      return boardsPool.get(poolKey);
    },

    /**
     * Lists all registered agents along with aggregated task and stage statistics across their projects.
     * @returns {Array<Object>}
     */
    listAgents() {
      const result = [];
      for (const [id, agent] of agentsMap.entries()) {
        const projectSummaries = [];
        let totalTasks = 0;
        let totalDone = 0;
        let inProgressTasks = 0;
        let plannedTasks = 0;
        let openBugs = 0;
        let stagesSummary = [];

        for (const proj of agent.projects) {
          const board = this.getBoard(id, proj.id);
          const summary = board.getBoardSummary();
          const allItems = board.listItems();
          const projInProgress = allItems.filter((i) => i.status === 'in-progress').length;
          const projPlanned = allItems.filter((i) => i.status === 'planned').length;

          totalTasks += summary.totalTasks;
          totalDone += summary.totalDone;
          inProgressTasks += projInProgress;
          plannedTasks += projPlanned;
          openBugs += summary.openBugs;

          projectSummaries.push({
            id: proj.id,
            name: proj.name,
            board: proj.board,
            docs_path: proj.docs_path,
            stats: {
              totalTasks: summary.totalTasks,
              doneTasks: summary.totalDone,
              inProgressTasks: projInProgress,
              plannedTasks: projPlanned,
              openBugs: summary.openBugs,
              progressPct: summary.overallProgress
            },
            stages: summary.stages
          });

          if (proj.id === agent.projects[0].id) {
            stagesSummary = summary.stages;
          }
        }

        const overallPct = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;
        const { token, token_hash, ...safeMeta } = agent;

        result.push({
          ...safeMeta,
          isDefault: id === defaultAgentId,
          stats: {
            totalTasks,
            doneTasks: totalDone,
            inProgressTasks,
            plannedTasks,
            openBugs,
            progressPct: overallPct
          },
          projects: projectSummaries,
          stages: stagesSummary
        });
      }
      return result;
    },


    /**
     * Returns true if any agent or operator has credentials configured.
     * @returns {boolean}
     */
    hasConfiguredCredentials() {
      if (operatorToken) return true;
      for (const agent of agentsMap.values()) {
        if (agent.token || agent.token_hash) return true;
      }
      return false;
    },

    /**
     * Authenticates an incoming Authorization header against the registered roster agents.
     * @param {string|undefined} authHeader 
     * @returns {{ authenticated: boolean, isOperator: boolean, agentId: string|null, agent: Object|null, error?: string }}
     */
    authenticate(authHeader) {
      const agents = Array.from(agentsMap.values());
      return authenticateRequest({ authHeader, agents, operatorToken });
    },

    /**
     * Asserts tenant access between the authenticated principal and the target agent.
     * @param {string|null} authenticatedAgentId 
     * @param {string} targetAgentId 
     * @param {boolean} [isOperator=false]
     */
    assertTenantAccess(authenticatedAgentId, targetAgentId, isOperator = false) {
      return assertTenantAccess({ authenticatedAgentId, targetAgentId, isOperator });
    },

    /**
     * Closes all open SQLite board handles in the pool.
     */
    closeAll() {
      for (const [id, board] of boardsPool.entries()) {
        try {
          board.close();
        } catch (e) {
          // ignore closed
        }
      }
      boardsPool.clear();
    }
  };
}
