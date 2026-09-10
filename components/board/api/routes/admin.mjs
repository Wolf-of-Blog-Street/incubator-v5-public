import { sendJson, sendError, parseBody } from '../middleware/json.mjs';

export async function handleAdminRoutes(req, res, pathname, ctxOrAppContext, ...legacyArgs) {
  let ctx, effectiveRoster, defaultAgentId;
  if (ctxOrAppContext && typeof ctxOrAppContext === 'object' && ctxOrAppContext.effectiveRoster) {
    ({ ctx, effectiveRoster, defaultAgentId } = ctxOrAppContext);
  } else {
    ctx = ctxOrAppContext;
    [effectiveRoster, defaultAgentId] = legacyArgs;
  }
  const method = req.method;

  // GET /api/v1/roster
  if (method === 'GET' && pathname === '/api/v1/roster') {
    const agents = effectiveRoster.listAgents();
    const manager = effectiveRoster.getManager();
    sendJson(res, 200, { agents, manager, defaultAgent: defaultAgentId });
    return true;
  }

  // GET /api/v1/admin/manager
  if (method === 'GET' && pathname === '/api/v1/admin/manager') {
    ctx.assertAdminOrOperator();
    sendJson(res, 200, effectiveRoster.getManager());
    return true;
  }

  // PATCH /api/v1/admin/manager
  if (method === 'PATCH' && pathname === '/api/v1/admin/manager') {
    ctx.assertAdminOrOperator();
    const body = await parseBody(req);
    const updated = effectiveRoster.updateManager(body);
    sendJson(res, 200, updated);
    return true;
  }

  // POST /api/v1/admin/agents
  if (method === 'POST' && pathname === '/api/v1/admin/agents') {
    ctx.assertAdminOrOperator();
    const body = await parseBody(req);
    if (!body || !body.id) {
      sendJson(res, 400, { error: 'Agent ID is required' });
      return true;
    }
    const autoGen = body.auto_generate_token !== false;
    const result = effectiveRoster.registerAgent(body, autoGen);
    sendJson(res, 201, result);
    return true;
  }

  // DELETE /api/v1/admin/agents/:agentId
  const adminAgentDeleteMatch = pathname.match(/^\/api\/v1\/admin\/agents\/([a-zA-Z0-9_\-]+)$/);
  if (method === 'DELETE' && adminAgentDeleteMatch) {
    ctx.assertAdminOrOperator();
    const agentId = adminAgentDeleteMatch[1];
    effectiveRoster.revokeAgent(agentId);
    sendJson(res, 200, { revoked: true, agentId });
    return true;
  }

  // POST /api/v1/admin/agents/:agentId/token/rotate
  const adminTokenRotateMatch = pathname.match(/^\/api\/v1\/admin\/agents\/([a-zA-Z0-9_\-]+)\/token\/rotate$/);
  if (method === 'POST' && adminTokenRotateMatch) {
    ctx.assertAdminOrOperator();
    const agentId = adminTokenRotateMatch[1];
    const result = effectiveRoster.rotateAgentToken(agentId);
    sendJson(res, 200, result);
    return true;
  }

  // POST /api/v1/admin/agents/:agentId/projects
  const adminProjectAllocMatch = pathname.match(/^\/api\/v1\/admin\/agents\/([a-zA-Z0-9_\-]+)\/projects$/);
  if (method === 'POST' && adminProjectAllocMatch) {
    ctx.assertAdminOrOperator();
    const agentId = adminProjectAllocMatch[1];
    const body = await parseBody(req);
    const project = effectiveRoster.allocateProject(agentId, body);
    sendJson(res, 201, { agentId, project });
    return true;
  }

  // GET /api/v1/admin/fleet/status
  if (method === 'GET' && pathname === '/api/v1/admin/fleet/status') {
    ctx.assertAdminOrOperator();
    const agents = effectiveRoster.listAgents();
    const manager = effectiveRoster.getManager();
    let totalProjects = 0;
    let totalTasks = 0;
    let totalDone = 0;
    let totalBugs = 0;

    for (const ag of agents) {
      totalProjects += ag.projects.length;
      totalTasks += ag.stats.totalTasks;
      totalDone += ag.stats.doneTasks;
      totalBugs += ag.stats.openBugs;
    }

    sendJson(res, 200, {
      status: 'healthy',
      manager,
      totalAgents: agents.length,
      totalProjects,
      totalTasks,
      totalDone,
      totalBugs,
      timestamp: new Date().toISOString()
    });
    return true;
  }

  return false;
}
