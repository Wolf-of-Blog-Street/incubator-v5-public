import path from 'node:path';
import { openBoard } from '../board.mjs';
import { validateAgentId, AgentNotFoundError, ProjectNotFoundError } from './agentStore.mjs';
import { findDocsDir } from '../../api/services/docService.mjs';

/**
 * Resolves standard doc directories and agent/project metadata for a board instance.
 */
export function resolveBoardDocOptions(agentId, targetProject, options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : process.cwd();
  const syncDocsBase = options.syncDocsDir || options.resolvedSyncDocsDir || path.join(rootDir, 'docs/sync');
  const resolvedSyncDocsDir = path.resolve(syncDocsBase);

  let docsDir = null;
  if (targetProject && targetProject.docs_path) {
    docsDir = path.isAbsolute(targetProject.docs_path)
      ? targetProject.docs_path
      : path.resolve(rootDir, targetProject.docs_path);
  } else if (options.docsDir || options.resolvedDocsDir) {
    docsDir = path.resolve(options.docsDir || options.resolvedDocsDir);
  } else {
    try {
      docsDir = findDocsDir(null, targetProject?.id || 'incubator-v5');
    } catch (_) {
      docsDir = path.resolve(rootDir, 'docs/design');
    }
  }

  return {
    rootDir,
    docsDir,
    resolvedDocsDir: docsDir,
    resolvedSyncDocsDir,
    targetAgent: agentId,
    targetProject: targetProject?.id || null
  };
}

/**
 * Applies doc directories and tenant metadata to an open board instance.
 */
export function applyBoardDocOptions(board, agentId, targetProject, options = {}) {
  if (!board) return;
  const opts = resolveBoardDocOptions(agentId, targetProject, options);
  board.rootDir = opts.rootDir;
  board.docsDir = opts.docsDir;
  board.resolvedDocsDir = opts.resolvedDocsDir;
  board.resolvedSyncDocsDir = opts.resolvedSyncDocsDir;
  board.targetAgent = opts.targetAgent;
  board.targetProject = opts.targetProject;
}

/**
 * Manages pooling of SQLite board connections, cache invalidation,
 * and multi-project statistics aggregation across agents.
 */
export function createBoardFactory(agentStore, options = {}) {
  const boardsPool = new Map();
  let factoryOptions = { ...options };

  function setDocDirectories(docOpts = {}) {
    factoryOptions = { ...factoryOptions, ...docOpts };
    for (const [key, board] of boardsPool.entries()) {
      const [agId, prId] = key.split('::');
      const agent = agentStore.agentsMap.get(agId);
      const proj = agent?.projects?.find(p => p.id === prId) || agent?.projects?.[0];
      applyBoardDocOptions(board, agId, proj, factoryOptions);
    }
  }

  function evictBoard(agentId, projectId) {
    const poolKey = `${agentId}::${projectId}`;
    if (boardsPool.has(poolKey)) {
      try {
        boardsPool.get(poolKey).close();
      } catch (e) {
        // ignore closed
      }
      boardsPool.delete(poolKey);
    }
  }

  function evictAgentBoards(agentId) {
    for (const key of boardsPool.keys()) {
      if (key.startsWith(`${agentId}::`)) {
        try {
          boardsPool.get(key).close();
        } catch (e) {
          // ignore closed
        }
        boardsPool.delete(key);
      }
    }
  }

  function getBoard(agentId, projectId = null) {
    validateAgentId(agentId);
    const agent = agentStore.agentsMap.get(agentId);
    if (!agent) throw new AgentNotFoundError(agentId);

    let targetProject = agent.projects[0];
    if (projectId) {
      const found = agent.projects.find(p => p.id === projectId);
      if (!found) {
        throw new ProjectNotFoundError(agentId, projectId);
      }
      targetProject = found;
    }

    const poolKey = `${agentId}::${targetProject.id}`;
    if (!boardsPool.has(poolKey)) {
      const boardOpts = resolveBoardDocOptions(agentId, targetProject, factoryOptions);
      boardsPool.set(poolKey, openBoard(targetProject.dbPath, boardOpts));
    }
    const board = boardsPool.get(poolKey);
    applyBoardDocOptions(board, agentId, targetProject, factoryOptions);
    return board;
  }

  function listAgents() {
    const result = [];
    for (const [id, agent] of agentStore.agentsMap.entries()) {
      const agg = aggregateAgentProjects(agent, getBoard);
      const overallPct = agg.totalTasks > 0 ? Math.round((agg.totalDone / agg.totalTasks) * 100) : 0;
      const { token: _token, token_hash: _hash, ...safeMeta } = agent;

      result.push({
        ...safeMeta,
        isDefault: id === agentStore.defaultAgentId,
        stats: {
          totalTasks: agg.totalTasks,
          doneTasks: agg.totalDone,
          inProgressTasks: agg.inProgressTasks,
          plannedTasks: agg.plannedTasks,
          openBugs: agg.openBugs,
          progressPct: overallPct
        },
        projects: agg.projectSummaries,
        stages: agg.stagesSummary
      });
    }
    return result;
  }

  function closeAll() {
    for (const [id, board] of boardsPool.entries()) {
      try {
        board.close();
      } catch (e) {
        // ignore closed
      }
    }
    boardsPool.clear();
  }

  return {
    boardsPool,
    getBoard,
    evictBoard,
    evictAgentBoards,
    setDocDirectories,
    listAgents,
    closeAll
  };
}

/**
 * Pure calculation helper computing project task statistics from items and summary.
 * 
 * @param {Array<Object>} allItems
 * @param {Object} summary
 * @returns {Object}
 */
export function calculateProjectStats(allItems = [], summary = {}) {
  const projInProgress = allItems.filter((i) => i.status === 'in-progress').length;
  const projPlanned = allItems.filter((i) => i.status === 'planned').length;
  return {
    totalTasks: summary.totalTasks || 0,
    doneTasks: summary.totalDone || 0,
    inProgressTasks: projInProgress,
    plannedTasks: projPlanned,
    openBugs: summary.openBugs || 0,
    progressPct: summary.overallProgress || 0
  };
}

/**
 * Aggregates multi-project stats across a single agent's assigned projects.
 * 
 * @param {Object} agent
 * @param {Function} getBoard
 * @returns {Object}
 */
export function aggregateAgentProjects(agent, getBoard) {
  const projectSummaries = [];
  let totalTasks = 0;
  let totalDone = 0;
  let inProgressTasks = 0;
  let plannedTasks = 0;
  let openBugs = 0;
  let stagesSummary = [];

  for (const proj of agent.projects) {
    const board = getBoard(agent.id, proj.id);
    const summary = board.getBoardSummary();
    const allItems = board.listItems();
    const stats = calculateProjectStats(allItems, summary);

    totalTasks += stats.totalTasks;
    totalDone += stats.doneTasks;
    inProgressTasks += stats.inProgressTasks;
    plannedTasks += stats.plannedTasks;
    openBugs += stats.openBugs;

    projectSummaries.push({
      id: proj.id,
      name: proj.name,
      board: proj.board,
      docs_path: proj.docs_path,
      stats,
      stages: summary.stages
    });

    if (proj.id === agent.projects[0].id) {
      stagesSummary = summary.stages;
    }
  }

  return {
    projectSummaries,
    stagesSummary,
    totalTasks,
    totalDone,
    inProgressTasks,
    plannedTasks,
    openBugs
  };
}
