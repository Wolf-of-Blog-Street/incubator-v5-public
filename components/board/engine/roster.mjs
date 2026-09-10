import path from 'node:path';
import fs from 'node:fs';
import { createAgentStore, validateAgentId, validateProjectId, AgentNotFoundError, ProjectNotFoundError } from './roster/agentStore.mjs';
import { createBoardFactory } from './roster/boardFactory.mjs';
import { authenticateRequest, assertTenantAccess, canAccessTenant } from './auth.mjs';

export { validateAgentId, validateProjectId, AgentNotFoundError, ProjectNotFoundError, canAccessTenant };

/**
 * Initializes and manages a multi-agent roster with isolated SQLite database connections.
 * 
 * @param {Object} [options={}]
 * @param {string} [options.rosterPath] Path to roster.json file
 * @param {Object} [options.config] Raw config object (if not reading from file)
 * @param {string} [options.boardsDir] Base directory to store agent SQLite databases (default: 'boards')
 * @param {string|null} [options.operatorToken] Optional master operator token
 * @returns {Object} Roster facade instance
 */
export function openRoster(options = {}) {
  const boardsDir = path.resolve(options.boardsDir ?? 'boards');
  fs.mkdirSync(boardsDir, { recursive: true });

  const agentStore = createAgentStore(options, boardsDir);
  const boardFactory = createBoardFactory(agentStore);

  return {
    /**
     * Checks if an agent exists in the roster.
     * @param {string} agentId
     * @returns {boolean}
     */
    hasAgent(agentId) {
      return agentStore.hasAgent(agentId);
    },

    /**
     * Retrieves safe metadata for a registered agent.
     * @param {string} agentId
     * @returns {Object}
     * @throws {AgentNotFoundError} If agent does not exist
     */
    getAgent(agentId) {
      return agentStore.getAgent(agentId);
    },

    /**
     * Retrieves the list of projects allocated to an agent.
     * @param {string} agentId
     * @returns {Array<Object>}
     * @throws {AgentNotFoundError} If agent does not exist
     */
    getProjects(agentId) {
      return agentStore.getProjects(agentId);
    },

    /**
     * Gets the default agent identifier.
     * @returns {string}
     */
    getDefaultAgentId() {
      return agentStore.defaultAgentId;
    },

    /**
     * Sets the default agent identifier.
     * @param {string} id
     * @throws {AgentNotFoundError} If agent does not exist
     */
    setDefaultAgentId(id) {
      agentStore.setDefaultAgentId(id);
    },

    /**
     * Gets the current manager configuration.
     * @returns {Object}
     */
    getManager() {
      return agentStore.getManager();
    },

    /**
     * Updates manager configuration fields.
     * @param {Object} [updates={}]
     * @returns {Object} Updated manager configuration
     */
    updateManager(updates = {}) {
      return agentStore.updateManager(updates);
    },

    /**
     * Registers a new agent in the roster.
     * @param {Object} agentConfig
     * @param {boolean|Object} [optionsOrAutoGenerate=false]
     * @returns {{ agent: Object, token?: string }}
     */
    registerAgent(agentConfig, optionsOrAutoGenerate = false) {
      return agentStore.registerAgent(agentConfig, optionsOrAutoGenerate);
    },

    /**
     * Revokes an agent and closes all their active board connections.
     * @param {string} agentId
     * @returns {boolean}
     * @throws {AgentNotFoundError} If agent does not exist
     */
    revokeAgent(agentId) {
      return agentStore.revokeAgent(agentId, (id) => boardFactory.evictAgentBoards(id));
    },

    /**
     * Generates a new token for an agent and updates stored hash.
     * @param {string} agentId
     * @returns {{ agentId: string, token: string }}
     * @throws {AgentNotFoundError} If agent does not exist
     */
    rotateAgentToken(agentId) {
      return agentStore.rotateAgentToken(agentId);
    },

    /**
     * Allocates a project database and documentation path to an agent.
     * @param {string} agentId
     * @param {Object} projectDef
     * @returns {Object}
     * @throws {AgentNotFoundError} If agent does not exist
     */
    allocateProject(agentId, projectDef) {
      return agentStore.allocateProject(agentId, projectDef, (agId, prId) => boardFactory.evictBoard(agId, prId));
    },

    /**
     * Retrieves an active SQLite board instance for an agent and project.
     * @param {string} agentId
     * @param {string|null} [projectId=null]
     * @returns {Object} Board instance
     * @throws {AgentNotFoundError} If agent does not exist
     * @throws {ProjectNotFoundError} If project does not exist
     */
    getBoard(agentId, projectId = null) {
      return boardFactory.getBoard(agentId, projectId);
    },

    /**
     * Lists all registered agents with aggregated project task metrics.
     * @returns {Array<Object>}
     */
    listAgents() {
      return boardFactory.listAgents();
    },

    /**
     * Checks if any agent or operator credentials are configured.
     * @returns {boolean}
     */
    hasConfiguredCredentials() {
      if (agentStore.operatorToken) return true;
      for (const agent of agentStore.agentsMap.values()) {
        if (agent.token || agent.token_hash) return true;
      }
      return false;
    },

    /**
     * Authenticates an incoming Authorization header against registered agents.
     * @param {string|undefined} authHeader
     * @returns {{ authenticated: boolean, isOperator: boolean, agentId: string|null, agent: Object|null, error: string|null }}
     */
    authenticate(authHeader) {
      const agents = Array.from(agentStore.agentsMap.values());
      return authenticateRequest({ authHeader, agents, operatorToken: agentStore.operatorToken });
    },

    /**
     * Asserts tenant isolation, throwing if caller lacks access to target.
     * @param {string|null} authenticatedAgentId
     * @param {string} targetAgentId
     * @param {boolean} [isOperator=false]
     * @returns {boolean}
     * @throws {UnauthorizedError}
     * @throws {ForbiddenError}
     */
    assertTenantAccess(authenticatedAgentId, targetAgentId, isOperator = false) {
      return assertTenantAccess({ authenticatedAgentId, targetAgentId, isOperator });
    },

    /**
     * Closes all active SQLite database connections across all pools.
     */
    closeAll() {
      boardFactory.closeAll();
    }
  };
}
