import { sendJson, sendError, parseBody } from '../middleware/json.mjs';
import { UnauthorizedError } from '../../engine/auth.mjs';

/**
 * Handles all GitHub projects catalog and live inventory HTTP routes.
 * 
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @param {Object} appContext
 * @returns {Promise<boolean>} True if route was handled, false otherwise
 */
export async function handleProjectRoutes(req, res, pathname, appContext) {
  const {
    ctx,
    effectiveRoster,
    projectsStore,
    workspaceScanner,
    eventBroker
  } = appContext;

  if (!projectsStore || !workspaceScanner) {
    return false;
  }

  const method = req.method;

  function assertProjectMutationAuth(errMessage = 'Authentication token required') {
    if (effectiveRoster && effectiveRoster.hasConfiguredCredentials()) {
      if (!ctx.auth.authenticated) {
        throw new UnauthorizedError(errMessage);
      }
    } else if (ctx.isLoopback && ctx.isLoopback()) {
      return;
    } else if (!ctx.auth.authenticated) {
      throw new UnauthorizedError(errMessage);
    }
  }

  // 1. GET /api/v1/projects — List all catalog projects with live inventory
  if (method === 'GET' && pathname === '/api/v1/projects') {
    const catalog = projectsStore.listProjects();
    const rosterAgents = effectiveRoster ? effectiveRoster.listAgents() : [];
    const inventory = workspaceScanner.scanLiveInventory(catalog, rosterAgents);

    sendJson(res, 200, {
      success: true,
      projects: inventory.projects,
      stats: inventory.stats
    });
    return true;
  }

  // 2. POST /api/v1/projects/scan — Force re-scan and refresh cache
  if (method === 'POST' && pathname === '/api/v1/projects/scan') {
    assertProjectMutationAuth('Authentication token required to scan project workspaces');
    workspaceScanner.invalidateCache();
    const catalog = projectsStore.listProjects();
    const rosterAgents = effectiveRoster ? effectiveRoster.listAgents() : [];
    const inventory = workspaceScanner.scanLiveInventory(catalog, rosterAgents);

    if (eventBroker) {
      eventBroker.broadcastChange('project:inventory', { action: 'scan', stats: inventory.stats });
    }

    sendJson(res, 200, {
      success: true,
      scanned: true,
      projects: inventory.projects,
      stats: inventory.stats
    });
    return true;
  }

  // 3. POST /api/v1/projects — Register new GitHub repository into catalog
  if (method === 'POST' && pathname === '/api/v1/projects') {
    assertProjectMutationAuth('Authentication token required to register projects');
    const body = await parseBody(req);
    if (!body || !body.github_url) {
      sendError(res, 400, 'github_url is required');
      return true;
    }

    const created = projectsStore.addProject({
      id: body.id,
      name: body.name,
      github_url: body.github_url,
      description: body.description,
      tags: body.tags
    });

    workspaceScanner.invalidateCache();
    if (eventBroker) {
      eventBroker.broadcastChange('project:inventory', { action: 'add', project: created });
    }

    sendJson(res, 201, {
      success: true,
      project: created
    });
    return true;
  }

  // Parameterized Project Routes: /api/v1/projects/:id
  const projectItemMatch = pathname.match(/^\/api\/v1\/projects\/([a-zA-Z0-9_\-]+)$/);
  if (projectItemMatch) {
    const projectId = projectItemMatch[1];

    // 4. GET /api/v1/projects/:id
    if (method === 'GET') {
      const catalog = projectsStore.listProjects();
      const rosterAgents = effectiveRoster ? effectiveRoster.listAgents() : [];
      const inventory = workspaceScanner.scanLiveInventory(catalog, rosterAgents);
      const target = inventory.projects.find(p => p.id === projectId);
      if (!target) {
        sendError(res, 404, `Project "${projectId}" not found in catalog`);
        return true;
      }
      sendJson(res, 200, { success: true, project: target });
      return true;
    }

    // 5. PATCH /api/v1/projects/:id — Update project metadata
    if (method === 'PATCH') {
      assertProjectMutationAuth('Authentication token required to update projects');
      const body = await parseBody(req);
      const updated = projectsStore.updateProject(projectId, body);
      if (!updated) {
        sendError(res, 404, `Project "${projectId}" not found`);
        return true;
      }

      workspaceScanner.invalidateCache();
      if (eventBroker) {
        eventBroker.broadcastChange('project:inventory', { action: 'update', project: updated });
      }

      sendJson(res, 200, { success: true, project: updated });
      return true;
    }

    // 6. DELETE /api/v1/projects/:id — Remove project from catalog
    if (method === 'DELETE') {
      assertProjectMutationAuth('Authentication token required to delete projects');
      const ok = projectsStore.deleteProject(projectId);
      if (!ok) {
        sendError(res, 404, `Project "${projectId}" not found`);
        return true;
      }

      workspaceScanner.invalidateCache();
      if (eventBroker) {
        eventBroker.broadcastChange('project:inventory', { action: 'delete', id: projectId });
      }

      sendJson(res, 200, { success: true, id: projectId });
      return true;
    }
  }

  return false;
}
