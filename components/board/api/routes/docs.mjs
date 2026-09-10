import fs from 'node:fs';
import path from 'node:path';
import { sendJson, sendError, parseBody } from '../middleware/json.mjs';
import { UnauthorizedError } from '../../engine/auth.mjs';
import {
  parseDocMetadata,
  updateDocStatusInFile,
  ensureDocCodenames,
  fileExists,
  collectDocsFromDir,
  resolveDocFile,
  attachDocTaskStats,
  checkDocCanClose,
  resolveAllAgentDocs,
  syncDocsDirFor
} from '../services/docService.mjs';

/**
 * Handles all design document HTTP routes (v1 and legacy).
 */
export async function handleDocRoutes(
  req,
  res,
  pathname,
  ctxOrAppContext,
  ...legacyArgs
) {
  let ctx, effectiveRoster, defaultAgentId, defaultBoard, resolvedDocsDir, resolvedSyncDocsDir, eventBroker;
  if (ctxOrAppContext && typeof ctxOrAppContext === 'object' && ctxOrAppContext.effectiveRoster) {
    ({ ctx, effectiveRoster, defaultAgentId, defaultBoard, resolvedDocsDir, resolvedSyncDocsDir, eventBroker } = ctxOrAppContext);
  } else {
    ctx = ctxOrAppContext;
    [effectiveRoster, defaultAgentId, defaultBoard, resolvedDocsDir, resolvedSyncDocsDir, eventBroker] = legacyArgs;
  }

  const method = req.method;

  function assertDocMutationAuth(errMessage = 'Authentication token required') {
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

  // POST /api/v1/docs/sync (Push local design doc to Falcon Manager)
  if (method === 'POST' && pathname === '/api/v1/docs/sync') {
    assertDocMutationAuth('Authentication token required to sync design docs');
    const body = await parseBody(req);
    const { slug, content } = body;
    if (!slug || typeof slug !== 'string') {
      sendError(res, 400, 'Design doc slug is required');
      return true;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(slug)) {
      sendError(res, 400, 'Invalid design doc slug format');
      return true;
    }
    if (!content || typeof content !== 'string') {
      sendError(res, 400, 'Design doc content is required');
      return true;
    }

    const targetAgent = ctx.resolveTargetAgent(body.agent);
    const targetProject = ctx.resolveTargetProject(body.project);
    ctx.checkTenantAccess(targetAgent);
    const agentSyncDir = syncDocsDirFor(resolvedSyncDocsDir, targetAgent, targetProject);
    await fs.promises.mkdir(agentSyncDir, { recursive: true });

    const safeSlug = path.basename(slug, '.md');
    const targetFile = path.join(agentSyncDir, `${safeSlug}.md`);
    await fs.promises.writeFile(targetFile, content, 'utf8');
    eventBroker.broadcastChange('doc:sync', { slug: safeSlug, agentId: targetAgent, projectId: targetProject });

    sendJson(res, 200, {
      success: true,
      slug: safeSlug,
      agentId: targetAgent,
      filePath: targetFile
    });
    return true;
  }

  // GET /api/v1/agents/:agentId/docs or /api/v1/docs
  const agentDocsMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/docs$/);
  if (method === 'GET' && (agentDocsMatch || pathname === '/api/v1/docs')) {
    const targetAgent = agentDocsMatch ? agentDocsMatch[1] : ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();

    const { docs, agentSyncDir } = await resolveAllAgentDocs(targetAgent, defaultAgentId, resolvedSyncDocsDir, resolvedDocsDir, targetProject);

    const board = effectiveRoster.getBoard(targetAgent, targetProject);
    attachDocTaskStats(docs, board);

    ensureDocCodenames(docs);
    sendJson(res, 200, {
      docs,
      agentId: targetAgent,
      projectId: targetProject,
      docsDir: agentSyncDir
    });
    return true;
  }

  // GET /api/v1/agents/:agentId/docs/:slug or /api/v1/docs/:slug
  const agentDocDetailMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/docs\/([a-zA-Z0-9_\-]+)$/);
  const docDetailV1Match = pathname.match(/^\/api\/v1\/docs\/([a-zA-Z0-9_\-]+)$/);
  if (method === 'GET' && (agentDocDetailMatch || docDetailV1Match)) {
    const targetAgent = agentDocDetailMatch ? agentDocDetailMatch[1] : ctx.resolveTargetAgent();
    const targetProject = ctx.resolveTargetProject();
    const slug = agentDocDetailMatch ? agentDocDetailMatch[2] : docDetailV1Match[1];

    const docFile = await resolveDocFile({ slug, targetAgent, targetProject, resolvedSyncDocsDir, resolvedDocsDir, defaultAgentId });
    if (!docFile) {
      sendError(res, 404, `Design doc "${slug}" not found for agent "${targetAgent}"`);
      return true;
    }

    const meta = await parseDocMetadata(docFile);
    const rawContent = await fs.promises.readFile(docFile, 'utf8');
    const tasks = effectiveRoster.getBoard(targetAgent, targetProject).listItems({ design_slug: slug });
    sendJson(res, 200, {
      doc: {
        ...meta,
        content: rawContent,
        tasks
      },
      agentId: targetAgent,
      projectId: targetProject
    });
    return true;
  }

  // POST /api/v1/agents/:agentId/docs/:slug/status or /api/v1/docs/:slug/status
  const agentDocStatusMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/docs\/([a-zA-Z0-9_\-]+)\/status$/);
  const docStatusMatch = pathname.match(/^\/api\/v1\/docs\/([a-zA-Z0-9_\-]+)\/status$/);
  if (method === 'POST' && (agentDocStatusMatch || docStatusMatch)) {
    assertDocMutationAuth('Authentication token required to update doc status');
    const body = await parseBody(req);
    const targetAgent = agentDocStatusMatch ? agentDocStatusMatch[1] : ctx.resolveTargetAgent(body.agent);
    const targetProject = ctx.resolveTargetProject(body.project);
    const slug = agentDocStatusMatch ? agentDocStatusMatch[2] : docStatusMatch[1];
    const newStatus = body.status || 'Finished';
    const force = Boolean(body.force);

    ctx.checkTenantAccess(targetAgent);

    const isClosing = ['finished', 'done', 'closed', 'archived'].includes(newStatus.toLowerCase());
    if (isClosing) {
      if (effectiveRoster.hasConfiguredCredentials() && !ctx.isManagerOrOperator()) {
        sendError(res, 403, `Non-Closing Invariant: Only human operator or manager can mark design doc "${slug}" Closed`);
        return true;
      }
      const board = effectiveRoster.getBoard(targetAgent, targetProject);
      const check = checkDocCanClose(board, slug, force);
      if (!check.canClose) {
        sendError(res, 400, check.error, check.details);
        return true;
      }
    }

    const docFile = await resolveDocFile({ slug, targetAgent, targetProject, resolvedSyncDocsDir, resolvedDocsDir, defaultAgentId });
    if (!docFile) {
      sendError(res, 404, `Design doc "${slug}" not found for agent "${targetAgent}"`);
      return true;
    }

    const updatedMeta = await updateDocStatusInFile(docFile, newStatus);
    const board = effectiveRoster.getBoard(targetAgent, targetProject);
    if (isClosing) {
      board.closeDesignDoc(slug, { force });
    } else {
      board.reopenDesignDoc(slug);
    }
    eventBroker.broadcastChange('doc:status', { slug, status: updatedMeta.status, isFinished: updatedMeta.isFinished, agentId: targetAgent, projectId: targetProject });

    sendJson(res, 200, {
      success: true,
      slug,
      status: updatedMeta.status,
      isFinished: updatedMeta.isFinished,
      doc: updatedMeta,
      agentId: targetAgent,
      projectId: targetProject
    });
    return true;
  }

  // ==========================================
  // Legacy Routes (Backward Compatibility)
  // ==========================================

  // GET /api/docs
  if (method === 'GET' && pathname === '/api/docs') {
    if (!resolvedDocsDir || !(await fileExists(resolvedDocsDir))) {
      sendJson(res, 200, { docs: [] });
      return true;
    }

    const docs = await collectDocsFromDir(resolvedDocsDir);
    attachDocTaskStats(docs, defaultBoard);
    ensureDocCodenames(docs);
    sendJson(res, 200, { docs, docsDir: resolvedDocsDir });
    return true;
  }

  // GET /api/docs/:slug
  const docDetailMatch = pathname.match(/^\/api\/docs\/([a-zA-Z0-9_\-]+)$/);
  if (method === 'GET' && docDetailMatch) {
    const slug = docDetailMatch[1];
    if (!resolvedDocsDir) {
      sendError(res, 404, 'Docs directory not found');
      return true;
    }
    const docFile = path.join(resolvedDocsDir, `${slug}.md`);
    if (!(await fileExists(docFile))) {
      sendError(res, 404, `Design doc "${slug}" not found`);
      return true;
    }

    const meta = await parseDocMetadata(docFile);
    const rawContent = await fs.promises.readFile(docFile, 'utf8');
    const tasks = defaultBoard.listItems({ design_slug: slug });
    sendJson(res, 200, {
      doc: {
        ...meta,
        content: rawContent,
        tasks
      }
    });
    return true;
  }

  // POST /api/docs/:slug/status
  const legacyDocStatusMatch = pathname.match(/^\/api\/docs\/([a-zA-Z0-9_\-]+)\/status$/);
  if (method === 'POST' && legacyDocStatusMatch) {
    ctx.assertLegacyMutationAccess();
    const slug = legacyDocStatusMatch[1];
    const body = await parseBody(req);
    const newStatus = body.status || 'Finished';

    if (!resolvedDocsDir) {
      sendError(res, 404, 'Docs directory not found');
      return true;
    }
    const docFile = path.join(resolvedDocsDir, `${slug}.md`);
    if (!(await fileExists(docFile))) {
      sendError(res, 404, `Design doc "${slug}" not found`);
      return true;
    }

    const updatedMeta = await updateDocStatusInFile(docFile, newStatus);
    eventBroker.broadcastChange('doc:status', { slug, status: updatedMeta.status, isFinished: updatedMeta.isFinished });
    sendJson(res, 200, {
      success: true,
      slug,
      status: updatedMeta.status,
      isFinished: updatedMeta.isFinished,
      doc: updatedMeta
    });
    return true;
  }

  return false;
}
