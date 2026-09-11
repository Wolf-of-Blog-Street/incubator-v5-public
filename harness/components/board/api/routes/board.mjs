import { sendJson, sendError, parseBody } from '../middleware/json.mjs';
import { UnauthorizedError } from '../../engine/auth.mjs';

export async function handleBoardRoutes(
  req,
  res,
  pathname,
  parsedUrl,
  ctxOrAppContext,
  ...legacyArgs
) {
  let ctx, effectiveRoster, defaultBoard, eventBroker;
  if (ctxOrAppContext && typeof ctxOrAppContext === 'object' && ctxOrAppContext.effectiveRoster) {
    ({ ctx, effectiveRoster, defaultBoard, eventBroker } = ctxOrAppContext);
  } else {
    ctx = ctxOrAppContext;
    [effectiveRoster, defaultBoard, eventBroker] = legacyArgs;
  }

  const method = req.method;

  function assertTaskMutationAuth(errMessage = 'Authentication token required') {
    if (effectiveRoster.hasConfiguredCredentials()) {
      if (!ctx.auth.authenticated) {
        throw new UnauthorizedError(errMessage);
      }
    } else if (ctx.isLoopback && ctx.isLoopback()) {
      return;
    } else if (!ctx.auth.authenticated) {
      throw new UnauthorizedError(errMessage);
    }
  }

  // ==========================================
  // API v1 Routes
  // ==========================================

  // GET /api/v1/agents/:agentId/projects/:projectId/board
  const agentProjBoardMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/projects\/([a-zA-Z0-9_\-]+)\/board$/);
  if (method === 'GET' && agentProjBoardMatch) {
    const targetAgent = agentProjBoardMatch[1];
    const targetProject = agentProjBoardMatch[2];
    ctx.checkTenantAccess(targetAgent);
    const summary = effectiveRoster.getBoard(targetAgent, targetProject).getBoardSummary();
    sendJson(res, 200, { ...summary, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  // GET /api/v1/board
  if (method === 'GET' && pathname === '/api/v1/board') {
    const targetAgent = ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();
    const summary = effectiveRoster.getBoard(targetAgent, targetProject).getBoardSummary();
    sendJson(res, 200, { ...summary, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  // GET /api/v1/agents/:agentId/board
  const agentBoardMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/board$/);
  if (method === 'GET' && agentBoardMatch) {
    const targetAgent = agentBoardMatch[1];
    const targetProject = ctx.resolveTargetProject();
    ctx.checkTenantAccess(targetAgent);
    const summary = effectiveRoster.getBoard(targetAgent, targetProject).getBoardSummary();
    sendJson(res, 200, { ...summary, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  // GET /api/v1/agents/:agentId/projects/:projectId/tasks
  const agentProjTasksMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/projects\/([a-zA-Z0-9_\-]+)\/tasks$/);
  if (method === 'GET' && agentProjTasksMatch) {
    const targetAgent = agentProjTasksMatch[1];
    const targetProject = agentProjTasksMatch[2];
    ctx.checkTenantAccess(targetAgent);
    const doc = parsedUrl.searchParams.get('doc') || undefined;
    const status = parsedUrl.searchParams.get('status') || undefined;
    const mode = parsedUrl.searchParams.get('mode') || undefined;
    const track = parsedUrl.searchParams.get('track') || undefined;

    const tasks = effectiveRoster.getBoard(targetAgent, targetProject).listItems({ design_slug: doc, status, mode, track });
    sendJson(res, 200, { tasks, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  // GET /api/v1/tasks
  if (method === 'GET' && pathname === '/api/v1/tasks') {
    const targetAgent = ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();
    const doc = parsedUrl.searchParams.get('doc') || undefined;
    const status = parsedUrl.searchParams.get('status') || undefined;
    const mode = parsedUrl.searchParams.get('mode') || undefined;
    const track = parsedUrl.searchParams.get('track') || undefined;

    const tasks = effectiveRoster.getBoard(targetAgent, targetProject).listItems({ design_slug: doc, status, mode, track });
    sendJson(res, 200, { tasks, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  // POST /api/v1/tasks
  if (method === 'POST' && pathname === '/api/v1/tasks') {
    assertTaskMutationAuth('Authentication token required to create tasks');
    const body = await parseBody(req);
    const targetAgent = ctx.resolveTargetAgent(body.agent);
    const targetProject = ctx.resolveTargetProject(body.project);
    ctx.checkTenantAccess(targetAgent);
    const id = effectiveRoster.getBoard(targetAgent, targetProject).addItem(body);
    const task = effectiveRoster.getBoard(targetAgent, targetProject).getItem(id);
    eventBroker.broadcastChange('task:create', { id, agentId: targetAgent, projectId: targetProject });
    sendJson(res, 201, { task, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  // Task details match for v1: /api/v1/tasks/:id
  const v1TaskDetailMatch = pathname.match(/^\/api\/v1\/tasks\/(\d+)$/);
  if (method === 'GET' && v1TaskDetailMatch) {
    const id = Number(v1TaskDetailMatch[1]);
    const targetAgent = ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();
    ctx.checkTenantAccess(targetAgent);
    const task = effectiveRoster.getBoard(targetAgent, targetProject).getItem(id);
    if (!task) return sendError(res, 404, `Task #${id} not found in agent "${targetAgent}"`);
    sendJson(res, 200, { task, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  if (method === 'PATCH' && v1TaskDetailMatch) {
    assertTaskMutationAuth('Authentication token required to update tasks');
    const id = Number(v1TaskDetailMatch[1]);
    const body = await parseBody(req);
    const targetAgent = ctx.resolveTargetAgent(body.agent);
    const targetProject = ctx.resolveTargetProject(body.project);
    ctx.checkTenantAccess(targetAgent);
    const task = effectiveRoster.getBoard(targetAgent, targetProject).updateItem(id, body);
    if (!task) return sendError(res, 404, `Task #${id} not found in agent "${targetAgent}"`);
    eventBroker.broadcastChange('task:update', { id, agentId: targetAgent, projectId: targetProject });
    sendJson(res, 200, { task, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  if (method === 'DELETE' && v1TaskDetailMatch) {
    assertTaskMutationAuth('Authentication token required to delete tasks');
    const id = Number(v1TaskDetailMatch[1]);
    const targetAgent = ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();
    ctx.checkTenantAccess(targetAgent);
    const ok = effectiveRoster.getBoard(targetAgent, targetProject).deleteItem(id);
    if (!ok) return sendError(res, 404, `Task #${id} not found in agent "${targetAgent}"`);
    eventBroker.broadcastChange('task:delete', { id, agentId: targetAgent, projectId: targetProject });
    sendJson(res, 200, { success: true, deleted_id: id, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  // POST /api/v1/tasks/:id/toggle-checklist
  const v1ToggleChecklistMatch = pathname.match(/^\/api\/v1\/tasks\/(\d+)\/toggle-checklist$/);
  if (method === 'POST' && v1ToggleChecklistMatch) {
    assertTaskMutationAuth('Authentication token required to toggle checklist');
    const id = Number(v1ToggleChecklistMatch[1]);
    const body = await parseBody(req);
    const targetAgent = ctx.resolveTargetAgent(body.agent);
    const targetProject = ctx.resolveTargetProject(body.project);
    ctx.checkTenantAccess(targetAgent);
    const itemIndex = Number(body.index);
    if (Number.isNaN(itemIndex) || itemIndex < 0) {
      return sendError(res, 400, 'Valid checklist item index is required');
    }
    const task = effectiveRoster.getBoard(targetAgent, targetProject).toggleChecklistItem(id, itemIndex);
    if (!task) return sendError(res, 404, `Task #${id} not found in agent "${targetAgent}"`);
    eventBroker.broadcastChange('task:update', { id, agentId: targetAgent, projectId: targetProject });
    sendJson(res, 200, { task, agentId: targetAgent, projectId: targetProject });
    return true;
  }

  // ==========================================
  // Legacy Routes (Backward Compatibility)
  // ==========================================

  // GET /api/board
  if (method === 'GET' && pathname === '/api/board') {
    const targetAgent = ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();
    ctx.checkTenantAccess(targetAgent);
    const board = effectiveRoster.getBoard(targetAgent, targetProject);
    const summary = board.getBoardSummary();
    sendJson(res, 200, summary);
    return true;
  }

  // GET /api/tasks
  if (method === 'GET' && pathname === '/api/tasks') {
    const targetAgent = ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();
    ctx.checkTenantAccess(targetAgent);
    const doc = parsedUrl.searchParams.get('doc') || undefined;
    const status = parsedUrl.searchParams.get('status') || undefined;
    const mode = parsedUrl.searchParams.get('mode') || undefined;
    const track = parsedUrl.searchParams.get('track') || undefined;

    const board = effectiveRoster.getBoard(targetAgent, targetProject);
    const tasks = board.listItems({ design_slug: doc, status, mode, track });
    sendJson(res, 200, { tasks });
    return true;
  }

  // Legacy task detail match: /api/tasks/:id
  const taskDetailMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (method === 'GET' && taskDetailMatch) {
    const id = Number(taskDetailMatch[1]);
    const targetAgent = ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();
    ctx.checkTenantAccess(targetAgent);
    const board = effectiveRoster.getBoard(targetAgent, targetProject);
    const task = board.getItem(id);
    if (!task) return sendError(res, 404, `Task #${id} not found`);
    sendJson(res, 200, { task });
    return true;
  }

  // POST /api/tasks
  if (method === 'POST' && pathname === '/api/tasks') {
    const body = await parseBody(req);
    const targetAgent = ctx.resolveTargetAgent(body?.agent);
    const targetProject = ctx.resolveTargetProject(body?.project);
    ctx.assertLegacyMutationAccess(targetAgent);
    const board = effectiveRoster.getBoard(targetAgent, targetProject);
    const id = board.addItem(body);
    const task = board.getItem(id);
    eventBroker.broadcastChange('task:create', { id, agentId: targetAgent, projectId: targetProject });
    sendJson(res, 201, { task });
    return true;
  }

  // PATCH /api/tasks/:id
  if (method === 'PATCH' && taskDetailMatch) {
    const id = Number(taskDetailMatch[1]);
    const body = await parseBody(req);
    const targetAgent = ctx.resolveTargetAgent(body?.agent);
    const targetProject = ctx.resolveTargetProject(body?.project);
    ctx.assertLegacyMutationAccess(targetAgent);
    const board = effectiveRoster.getBoard(targetAgent, targetProject);
    const task = board.updateItem(id, body);
    if (!task) return sendError(res, 404, `Task #${id} not found`);
    eventBroker.broadcastChange('task:update', { id, agentId: targetAgent, projectId: targetProject });
    sendJson(res, 200, { task });
    return true;
  }

  // POST /api/tasks/:id/toggle-checklist
  const toggleChecklistMatch = pathname.match(/^\/api\/tasks\/(\d+)\/toggle-checklist$/);
  if (method === 'POST' && toggleChecklistMatch) {
    const id = Number(toggleChecklistMatch[1]);
    const body = await parseBody(req);
    const targetAgent = ctx.resolveTargetAgent(body?.agent);
    const targetProject = ctx.resolveTargetProject(body?.project);
    ctx.assertLegacyMutationAccess(targetAgent);
    const itemIndex = Number(body.index);
    if (Number.isNaN(itemIndex) || itemIndex < 0) {
      return sendError(res, 400, 'Valid checklist item index is required');
    }
    const board = effectiveRoster.getBoard(targetAgent, targetProject);
    const task = board.toggleChecklistItem(id, itemIndex);
    if (!task) return sendError(res, 404, `Task #${id} not found`);
    eventBroker.broadcastChange('task:update', { id, agentId: targetAgent, projectId: targetProject });
    sendJson(res, 200, { task });
    return true;
  }

  // DELETE /api/tasks/:id
  if (method === 'DELETE' && taskDetailMatch) {
    const id = Number(taskDetailMatch[1]);
    const targetAgent = ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();
    ctx.assertLegacyMutationAccess(targetAgent);
    const board = effectiveRoster.getBoard(targetAgent, targetProject);
    const ok = board.deleteItem(id);
    if (!ok) return sendError(res, 404, `Task #${id} not found`);
    eventBroker.broadcastChange('task:delete', { id, agentId: targetAgent, projectId: targetProject });
    sendJson(res, 200, { success: true, deleted_id: id });
    return true;
  }

  return false;
}
