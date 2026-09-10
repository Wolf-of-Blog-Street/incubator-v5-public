import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBoard } from '../engine/board.mjs';
import { openRoster, AgentNotFoundError } from '../engine/roster.mjs';
import { UnauthorizedError, ForbiddenError } from '../engine/auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_UI_DIR = path.resolve(__dirname, '../ui');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5e6) { // 5MB limit for markdown doc sync
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, uiDir) {
  const parsedUrl = new URL(req.url, 'http://localhost');
  let pathname = parsedUrl.pathname;
  if (pathname === '/') pathname = '/index.html';

  const baseDir = path.resolve(uiDir);
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.resolve(baseDir, '.' + safePath);

  // Security guard: ensure resolved path is strictly inside uiDir
  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  fs.createReadStream(filePath).pipe(res);
}

function findDocsDir(customDir, projectName = null) {
  if (customDir === false) return null;
  if (customDir && fs.existsSync(customDir)) return path.resolve(customDir);
  const candidates = [
    projectName ? path.resolve(process.cwd(), `workspaces/${projectName}/docs/design`) : null,
    projectName ? path.resolve(process.cwd(), `../workspaces/${projectName}/docs/design`) : null,
    projectName ? path.resolve(process.cwd(), `docs/design`) : null,
    path.resolve(process.cwd(), 'docs/design'),
    path.resolve(process.cwd(), 'workspaces/incubator-v5/docs/design'),
    path.resolve(__dirname, '../../../../workspaces/incubator-v5/docs/design'),
    path.resolve(__dirname, '../../../../docs/design'),
    path.resolve(process.cwd(), 'workspaces/incubator-v5-docs/design'),
    path.resolve(process.cwd(), '../incubator-v5-docs/design'),
    path.resolve(__dirname, '../../../../incubator-v5-docs/design'),
    path.resolve(__dirname, '../../../../workspaces/incubator-v5-docs/design'),
    path.resolve(process.cwd(), 'design')
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}


const CURATED_DOC_COLORS = [
  '#38bdf8', // sky
  '#a855f7', // purple
  '#10b981', // emerald
  '#f59e0b', // amber
  '#f43f5e', // rose
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#f97316'  // orange
];

function getDeterministicDocColor(slug) {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) & 0xffffffff;
  }
  return CURATED_DOC_COLORS[Math.abs(hash) % CURATED_DOC_COLORS.length];
}

function sortAndEnsureDocCodenames(docs) {
  // 1. Identify all explicit #d-X numbers
  const usedNumbers = new Set();
  for (const doc of docs) {
    if (doc.codename) {
      const m = doc.codename.match(/^#d-(\d+)$/i);
      if (m) usedNumbers.add(parseInt(m[1], 10));
    }
  }

  // 2. For docs without an explicit codename, assign the lowest unused integer
  let nextNum = 1;
  for (const doc of docs) {
    if (!doc.codename) {
      while (usedNumbers.has(nextNum)) {
        nextNum++;
      }
      doc.codename = `#d-${nextNum}`;
      usedNumbers.add(nextNum);
    }
  }

  // 3. Sort deterministically: #d-1, #d-2, #d-3 ... followed by alphabetical slug
  docs.sort((a, b) => {
    const numA = parseInt((a.codename.match(/^#d-(\d+)$/i) || [])[1] || '999999', 10);
    const numB = parseInt((b.codename.match(/^#d-(\d+)$/i) || [])[1] || '999999', 10);
    if (numA !== numB) return numA - numB;
    return a.slug.localeCompare(b.slug);
  });

  return docs;
}

function ensureDocCodenames(docs) {
  return sortAndEnsureDocCodenames(docs);
}

function parseDocMetadata(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const slug = path.basename(filePath, '.md');
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const statusMatch = content.match(/[-*]\s+\*\*Status\*\*:\s*([^\n\r]+)/i);
  const authorMatch = content.match(/[-*]\s+\*\*Author\*\*:\s*([^\n\r]+)/i);
  const targetMatch = content.match(/[-*]\s+\*\*Target Component\(s\)\*\*:\s*([^\n\r]+)/i);
  const updatedMatch = content.match(/[-*]\s+\*\*Last Updated\*\*:\s*([^\n\r]+)/i);
  const codenameMatch = content.match(/[-*]\s+\*\*Codename\*\*:\s*([^\n\r]+)/i);
  const colorMatch = content.match(/[-*]\s+\*\*Color\*\*:\s*([^\n\r]+)/i);

  const status = statusMatch ? statusMatch[1].trim() : 'Draft';
  const isFinished = ['finished', 'done', 'closed', 'archived'].includes(status.toLowerCase());
  const codename = codenameMatch ? codenameMatch[1].trim() : null;
  const color = colorMatch ? colorMatch[1].trim() : getDeterministicDocColor(slug);

  return {
    slug,
    title: titleMatch ? titleMatch[1].trim() : slug,
    status,
    isFinished,
    author: authorMatch ? authorMatch[1].trim() : null,
    targets: targetMatch ? targetMatch[1].trim() : null,
    lastUpdated: updatedMatch ? updatedMatch[1].trim() : null,
    codename,
    color,
    filePath
  };
}

function updateDocStatusInFile(filePath, newStatus) {
  let content = fs.readFileSync(filePath, 'utf8');
  const today = new Date().toISOString().slice(0, 10);

  if (/[-*]\s+\*\*Status\*\*:\s*[^\n\r]+/i.test(content)) {
    content = content.replace(/([-*]\s+\*\*Status\*\*:\s*)[^\n\r]+/i, `$1${newStatus}`);
  } else {
    content = content.replace(/^(#\s+[^\n\r]+\n)/m, `$1\n- **Status**: ${newStatus}\n`);
  }

  if (/[-*]\s+\*\*Last Updated\*\*:\s*[^\n\r]+/i.test(content)) {
    content = content.replace(/([-*]\s+\*\*Last Updated\*\*:\s*)[^\n\r]+/i, `$1${today}`);
  } else if (/[-*]\s+\*\*Status\*\*:\s*[^\n\r]+/i.test(content)) {
    content = content.replace(/([-*]\s+\*\*Status\*\*:\s*[^\n\r]+\n)/i, `$1- **Last Updated**: ${today}\n`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return parseDocMetadata(filePath);
}

export function createBoardServer({
  roster = null,
  rosterPath = null,
  boardsDir = null,
  operatorToken = null,
  dbPath = null,
  uiDir = DEFAULT_UI_DIR,
  docsDir = null,
  syncDocsDir = null,
  port = 0
} = {}) {
  // Initialize Roster
  let effectiveRoster = roster;
  if (!effectiveRoster) {
    if (rosterPath || boardsDir || !dbPath) {
      effectiveRoster = openRoster({ rosterPath, boardsDir, operatorToken });
    } else {
      // Wrap single-database path into a single-agent roster with project
      const defaultId = 'manager-pm';
      const dbBase = path.basename(dbPath);
      const projName = dbBase === 'project.sqlite' ? 'incubator-v5' : dbBase.replace(/\.sqlite$/, '');
      effectiveRoster = openRoster({
        config: {
          default_agent: defaultId,
          agents: [
            {
              id: defaultId,
              name: 'Manager PM (Local Seat)',
              icon: '🛡️',
              color: 'cyan',
              tags: ['orchestrator', 'pair'],
              projects: [
                {
                  id: projName,
                  name: projName,
                  board: dbBase,
                  docs_path: 'docs/design'
                }
              ]
            }
          ]
        },
        boardsDir: path.dirname(path.resolve(dbPath)),
        operatorToken
      });
    }
  }


  const resolvedDocsDir = findDocsDir(docsDir);
  const resolvedSyncDocsDir = path.resolve(syncDocsDir || 'docs/sync');
  fs.mkdirSync(resolvedSyncDocsDir, { recursive: true });

  const defaultAgentId = effectiveRoster.getDefaultAgentId();
  const defaultBoard = effectiveRoster.getBoard(defaultAgentId);

  const sseClients = new Set();
  function broadcastChange(type, data = {}) {
    const payload = `data: ${JSON.stringify({ type, data, ts: Date.now() })}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch (_) {
        sseClients.delete(client);
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    try {
      // Helper to authenticate request
      const authHeader = req.headers['authorization'];
      const auth = effectiveRoster.authenticate(authHeader);

      function isManagerOrOperator() {
        const mgr = effectiveRoster.getManager();
        return Boolean(auth.isOperator || (auth.authenticated && mgr && auth.agentId === mgr.agent_id));
      }

      function checkTenantAccess(targetAgent) {
        if (auth.authenticated && !isManagerOrOperator()) {
          effectiveRoster.assertTenantAccess(auth.agentId, targetAgent, false);
        }
      }

      function resolveTargetAgent(explicitAgentParam = null) {
        if (auth.authenticated && !auth.isOperator) {
          if (explicitAgentParam && explicitAgentParam !== auth.agentId) {
            effectiveRoster.assertTenantAccess(auth.agentId, explicitAgentParam, false);
          }
          return auth.agentId;
        }
        return explicitAgentParam || parsedUrl.searchParams.get('agent') || defaultAgentId;
      }

      function resolveTargetProject(explicitProjectParam = null) {
        return explicitProjectParam || parsedUrl.searchParams.get('project') || null;
      }

      function assertAdminOrOperator() {
        if (!isManagerOrOperator()) {
          throw new ForbiddenError('Admin or Operator authorization required');
        }
      }

      function assertLegacyMutationAccess() {
        if (effectiveRoster.hasConfiguredCredentials()) {
          if (!auth.authenticated) {
            throw new UnauthorizedError('Authentication token required for board mutations');
          }
          checkTenantAccess(defaultAgentId);
        }
      }

      // ==========================================
      // API v1 Routes (Multi-Agent & Authenticated)
      // ==========================================

      // API: GET /api/v1/health
      if (method === 'GET' && pathname === '/api/v1/health') {
        sendJson(res, 200, {
          status: 'ok',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          version: '5.0.0'
        });
        return;
      }

      // API: GET /api/v1/events or /api/events (Server-Sent Events for real-time live sync)
      if (method === 'GET' && (pathname === '/api/v1/events' || pathname === '/api/events')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);
        sseClients.add(res);
        req.on('close', () => {
          sseClients.delete(res);
        });
        return;
      }

      // API: GET /api/v1/roster
      if (method === 'GET' && pathname === '/api/v1/roster') {
        const agents = effectiveRoster.listAgents();
        const manager = effectiveRoster.getManager();
        sendJson(res, 200, { agents, manager, defaultAgent: defaultAgentId });
        return;
      }

      // API: GET /api/v1/admin/manager
      if (method === 'GET' && pathname === '/api/v1/admin/manager') {
        assertAdminOrOperator();
        sendJson(res, 200, effectiveRoster.getManager());
        return;
      }

      // API: PATCH /api/v1/admin/manager
      if (method === 'PATCH' && pathname === '/api/v1/admin/manager') {
        assertAdminOrOperator();
        const body = await parseBody(req);
        const updated = effectiveRoster.updateManager(body);
        sendJson(res, 200, updated);
        return;
      }

      // API: POST /api/v1/admin/agents (Register new agent seat)
      if (method === 'POST' && pathname === '/api/v1/admin/agents') {
        assertAdminOrOperator();
        const body = await parseBody(req);
        if (!body || !body.id) {
          sendJson(res, 400, { error: 'Agent ID is required' });
          return;
        }
        const autoGen = body.auto_generate_token !== false;
        const result = effectiveRoster.registerAgent(body, autoGen);
        sendJson(res, 201, result);
        return;
      }

      // API: DELETE /api/v1/admin/agents/:agentId (Revoke agent seat)
      const adminAgentDeleteMatch = pathname.match(/^\/api\/v1\/admin\/agents\/([a-zA-Z0-9_\-]+)$/);
      if (method === 'DELETE' && adminAgentDeleteMatch) {
        assertAdminOrOperator();
        const agentId = adminAgentDeleteMatch[1];
        effectiveRoster.revokeAgent(agentId);
        sendJson(res, 200, { revoked: true, agentId });
        return;
      }

      // API: POST /api/v1/admin/agents/:agentId/token/rotate (Rotate agent secret token)
      const adminTokenRotateMatch = pathname.match(/^\/api\/v1\/admin\/agents\/([a-zA-Z0-9_\-]+)\/token\/rotate$/);
      if (method === 'POST' && adminTokenRotateMatch) {
        assertAdminOrOperator();
        const agentId = adminTokenRotateMatch[1];
        const result = effectiveRoster.rotateAgentToken(agentId);
        sendJson(res, 200, result);
        return;
      }

      // API: POST /api/v1/admin/agents/:agentId/projects (Allocate project)
      const adminProjectAllocMatch = pathname.match(/^\/api\/v1\/admin\/agents\/([a-zA-Z0-9_\-]+)\/projects$/);
      if (method === 'POST' && adminProjectAllocMatch) {
        assertAdminOrOperator();
        const agentId = adminProjectAllocMatch[1];
        const body = await parseBody(req);
        const project = effectiveRoster.allocateProject(agentId, body);
        sendJson(res, 201, { agentId, project });
        return;
      }

      // API: GET /api/v1/admin/fleet/status (Fleet health check)
      if (method === 'GET' && pathname === '/api/v1/admin/fleet/status') {
        assertAdminOrOperator();
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
        return;
      }

      // API: GET /api/v1/agents/:agentId/projects/:projectId/board
      const agentProjBoardMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/projects\/([a-zA-Z0-9_\-]+)\/board$/);
      if (method === 'GET' && agentProjBoardMatch) {
        const targetAgent = agentProjBoardMatch[1];
        const targetProject = agentProjBoardMatch[2];
        checkTenantAccess(targetAgent);
        const summary = effectiveRoster.getBoard(targetAgent, targetProject).getBoardSummary();
        sendJson(res, 200, { ...summary, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: GET /api/v1/board
      if (method === 'GET' && pathname === '/api/v1/board') {
        const targetAgent = resolveTargetAgent();
        const targetProject = resolveTargetProject();
        const summary = effectiveRoster.getBoard(targetAgent, targetProject).getBoardSummary();
        sendJson(res, 200, { ...summary, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: GET /api/v1/agents/:agentId/board
      const agentBoardMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/board$/);
      if (method === 'GET' && agentBoardMatch) {
        const targetAgent = agentBoardMatch[1];
        const targetProject = resolveTargetProject();
        checkTenantAccess(targetAgent);
        const summary = effectiveRoster.getBoard(targetAgent, targetProject).getBoardSummary();
        sendJson(res, 200, { ...summary, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: GET /api/v1/agents/:agentId/projects/:projectId/tasks
      const agentProjTasksMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/projects\/([a-zA-Z0-9_\-]+)\/tasks$/);
      if (method === 'GET' && agentProjTasksMatch) {
        const targetAgent = agentProjTasksMatch[1];
        const targetProject = agentProjTasksMatch[2];
        checkTenantAccess(targetAgent);
        const doc = parsedUrl.searchParams.get('doc') || undefined;
        const status = parsedUrl.searchParams.get('status') || undefined;
        const mode = parsedUrl.searchParams.get('mode') || undefined;
        const track = parsedUrl.searchParams.get('track') || undefined;

        const tasks = effectiveRoster.getBoard(targetAgent, targetProject).listItems({ design_slug: doc, status, mode, track });
        sendJson(res, 200, { tasks, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: GET /api/v1/tasks
      if (method === 'GET' && pathname === '/api/v1/tasks') {
        const targetAgent = resolveTargetAgent();
        const targetProject = resolveTargetProject();
        const doc = parsedUrl.searchParams.get('doc') || undefined;
        const status = parsedUrl.searchParams.get('status') || undefined;
        const mode = parsedUrl.searchParams.get('mode') || undefined;
        const track = parsedUrl.searchParams.get('track') || undefined;

        const tasks = effectiveRoster.getBoard(targetAgent, targetProject).listItems({ design_slug: doc, status, mode, track });
        sendJson(res, 200, { tasks, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: POST /api/v1/tasks
      if (method === 'POST' && pathname === '/api/v1/tasks') {
        if (!auth.authenticated) {
          throw new UnauthorizedError('Authentication token required to create tasks');
        }
        const body = await parseBody(req);
        const targetAgent = resolveTargetAgent(body.agent);
        const targetProject = resolveTargetProject(body.project);
        const id = effectiveRoster.getBoard(targetAgent, targetProject).addItem(body);
        const task = effectiveRoster.getBoard(targetAgent, targetProject).getItem(id);
        broadcastChange('task:create', { id, agentId: targetAgent, projectId: targetProject });
        sendJson(res, 201, { task, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: GET /api/v1/tasks/:id
      const v1TaskDetailMatch = pathname.match(/^\/api\/v1\/tasks\/(\d+)$/);
      if (method === 'GET' && v1TaskDetailMatch) {
        const id = Number(v1TaskDetailMatch[1]);
        const targetAgent = resolveTargetAgent();
        const targetProject = resolveTargetProject();
        checkTenantAccess(targetAgent);
        const task = effectiveRoster.getBoard(targetAgent, targetProject).getItem(id);
        if (!task) return sendError(res, 404, `Task #${id} not found in agent "${targetAgent}"`);
        sendJson(res, 200, { task, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: PATCH /api/v1/tasks/:id
      if (method === 'PATCH' && v1TaskDetailMatch) {
        if (!auth.authenticated) {
          throw new UnauthorizedError('Authentication token required to update tasks');
        }
        const id = Number(v1TaskDetailMatch[1]);
        const body = await parseBody(req);
        const targetAgent = resolveTargetAgent(body.agent);
        const targetProject = resolveTargetProject(body.project);
        checkTenantAccess(targetAgent);
        const task = effectiveRoster.getBoard(targetAgent, targetProject).updateItem(id, body);
        broadcastChange('task:update', { id, agentId: targetAgent, projectId: targetProject });
        sendJson(res, 200, { task, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: DELETE /api/v1/tasks/:id
      if (method === 'DELETE' && v1TaskDetailMatch) {
        if (!auth.authenticated) {
          throw new UnauthorizedError('Authentication token required to delete tasks');
        }
        const id = Number(v1TaskDetailMatch[1]);
        const targetAgent = resolveTargetAgent();
        const targetProject = resolveTargetProject();
        checkTenantAccess(targetAgent);
        const ok = effectiveRoster.getBoard(targetAgent, targetProject).deleteItem(id);
        if (!ok) return sendError(res, 404, `Task #${id} not found in agent "${targetAgent}"`);
        broadcastChange('task:delete', { id, agentId: targetAgent, projectId: targetProject });
        sendJson(res, 200, { success: true, deleted_id: id, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: POST /api/v1/tasks/:id/toggle-checklist
      const v1ToggleChecklistMatch = pathname.match(/^\/api\/v1\/tasks\/(\d+)\/toggle-checklist$/);
      if (method === 'POST' && v1ToggleChecklistMatch) {
        if (!auth.authenticated) {
          throw new UnauthorizedError('Authentication token required to toggle checklist');
        }
        const id = Number(v1ToggleChecklistMatch[1]);
        const body = await parseBody(req);
        const targetAgent = resolveTargetAgent(body.agent);
        const targetProject = resolveTargetProject(body.project);
        const itemIndex = Number(body.index);
        if (isNaN(itemIndex) || itemIndex < 0) {
          return sendError(res, 400, 'Valid checklist item index is required');
        }
        const task = effectiveRoster.getBoard(targetAgent, targetProject).toggleChecklistItem(id, itemIndex);
        broadcastChange('task:update', { id, agentId: targetAgent, projectId: targetProject });
        sendJson(res, 200, { task, agentId: targetAgent, projectId: targetProject });
        return;
      }


      // API: POST /api/v1/docs/sync (Push local design doc to Falcon Manager)
      if (method === 'POST' && pathname === '/api/v1/docs/sync') {
        if (!auth.authenticated) {
          throw new UnauthorizedError('Authentication token required to sync design docs');
        }
        const body = await parseBody(req);
        const { slug, content, title } = body;
        if (!slug || typeof slug !== 'string') {
          return sendError(res, 400, 'Design doc slug is required');
        }
        if (!content || typeof content !== 'string') {
          return sendError(res, 400, 'Design doc content is required');
        }

        const targetAgent = resolveTargetAgent(body.agent);
        const agentSyncDir = path.join(resolvedSyncDocsDir, targetAgent);
        fs.mkdirSync(agentSyncDir, { recursive: true });

        const safeSlug = path.basename(slug, '.md');
        const targetFile = path.join(agentSyncDir, `${safeSlug}.md`);
        fs.writeFileSync(targetFile, content, 'utf8');
        broadcastChange('doc:sync', { slug: safeSlug, agentId: targetAgent });

        sendJson(res, 200, {
          success: true,
          slug: safeSlug,
          agentId: targetAgent,
          filePath: targetFile
        });
        return;
      }

      // API: GET /api/v1/agents/:agentId/docs
      const agentDocsMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/docs$/);
      if (method === 'GET' && agentDocsMatch) {
        const targetAgent = agentDocsMatch[1];
        const targetProject = resolveTargetProject();
        checkTenantAccess(targetAgent);

        const agentSyncDir = path.join(resolvedSyncDocsDir, targetAgent);
        const docs = [];
        const seenSlugs = new Set();

        function collectDocs(dir) {
          if (!dir || !fs.existsSync(dir)) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md') {
              const slug = path.basename(entry.name, '.md');
              if (seenSlugs.has(slug)) continue;
              seenSlugs.add(slug);

              const meta = parseDocMetadata(path.join(dir, entry.name));
              const tasks = effectiveRoster.getBoard(targetAgent, targetProject).listItems({ design_slug: meta.slug });
              const total = tasks.length;
              const done = tasks.filter(t => t.status === 'done').length;
              const openBugs = tasks.filter(t => t.track === 'bug' && t.status !== 'done').length;
              const progress = total === 0 ? 0 : Math.round((done / total) * 100);

              docs.push({
                ...meta,
                taskStats: { total, done, openBugs, progress }
              });
            }
          }
        }

        // Collect from synced docs first, then local fallback
        collectDocs(agentSyncDir);
        if (resolvedDocsDir && targetAgent === defaultAgentId) {
          collectDocs(resolvedDocsDir);
        }

        ensureDocCodenames(docs);
        sendJson(res, 200, { docs, agentId: targetAgent, projectId: targetProject });
        return;
      }

      // API: GET /api/v1/agents/:agentId/docs/:slug
      const agentDocDetailMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/docs\/([a-zA-Z0-9_\-]+)$/);
      if (method === 'GET' && agentDocDetailMatch) {
        const targetAgent = agentDocDetailMatch[1];
        const slug = agentDocDetailMatch[2];
        const targetProject = resolveTargetProject();
        checkTenantAccess(targetAgent);

        const agentSyncFile = path.join(resolvedSyncDocsDir, targetAgent, `${slug}.md`);
        const fallbackFile = (resolvedDocsDir && targetAgent === defaultAgentId) ? path.join(resolvedDocsDir, `${slug}.md`) : null;
        let docFile = null;

        if (fs.existsSync(agentSyncFile)) {
          docFile = agentSyncFile;
        } else if (fallbackFile && fs.existsSync(fallbackFile)) {
          docFile = fallbackFile;
        }

        if (!docFile) {
          return sendError(res, 404, `Design doc "${slug}" not found for agent "${targetAgent}"`);
        }

        const meta = parseDocMetadata(docFile);
        const rawContent = fs.readFileSync(docFile, 'utf8');
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
        return;
      }

      // API: POST /api/v1/agents/:agentId/docs/:slug/status or /api/v1/docs/:slug/status
      const agentDocStatusMatch = pathname.match(/^\/api\/v1\/agents\/([a-zA-Z0-9_\-]+)\/docs\/([a-zA-Z0-9_\-]+)\/status$/);
      const docStatusMatch = pathname.match(/^\/api\/v1\/docs\/([a-zA-Z0-9_\-]+)\/status$/);
      if (method === 'POST' && (agentDocStatusMatch || docStatusMatch)) {
        if (!auth.authenticated) {
          throw new UnauthorizedError('Authentication token required to update doc status');
        }
        const body = await parseBody(req);
        const targetAgent = agentDocStatusMatch ? agentDocStatusMatch[1] : resolveTargetAgent(body.agent);
        const targetProject = resolveTargetProject(body.project);
        const slug = agentDocStatusMatch ? agentDocStatusMatch[2] : docStatusMatch[1];
        const newStatus = body.status || 'Finished';
        const force = Boolean(body.force);

        checkTenantAccess(targetAgent);

        // Guard check: If closing/finishing the doc, verify all board tasks are completed unless force is true
        const isClosing = ['finished', 'done', 'closed', 'archived'].includes(newStatus.toLowerCase());
        if (isClosing) {
          const board = effectiveRoster.getBoard(targetAgent, targetProject);
          const items = board.listItems({ design_slug: slug });
          const openTasks = items.filter(t => t.status !== 'done');
          if (openTasks.length > 0 && !force) {
            return sendError(res, 400, `Cannot close design doc "${slug}": ${openTasks.length} task(s) still open. Use --force to close anyway.`, {
              closed: false,
              designSlug: slug,
              total: items.length,
              done: items.filter(t => t.status === 'done').length,
              openTasks
            });
          }
        }

        const agentSyncFile = path.join(resolvedSyncDocsDir, targetAgent, `${slug}.md`);
        const fallbackFile = (resolvedDocsDir && targetAgent === defaultAgentId) ? path.join(resolvedDocsDir, `${slug}.md`) : null;
        let docFile = null;

        if (fs.existsSync(agentSyncFile)) {
          docFile = agentSyncFile;
        } else if (fallbackFile && fs.existsSync(fallbackFile)) {
          docFile = fallbackFile;
        }

        if (!docFile) {
          return sendError(res, 404, `Design doc "${slug}" not found for agent "${targetAgent}"`);
        }

        const updatedMeta = updateDocStatusInFile(docFile, newStatus);
        broadcastChange('doc:status', { slug, status: updatedMeta.status, agentId: targetAgent, projectId: targetProject });
        sendJson(res, 200, {
          success: true,
          slug,
          status: updatedMeta.status,
          isFinished: updatedMeta.isFinished,
          doc: updatedMeta,
          agentId: targetAgent,
          projectId: targetProject
        });
        return;
      }

      // ==========================================
      // Legacy Routes (Backward Compatibility)
      // ==========================================

      // API: GET /api/docs
      if (method === 'GET' && pathname === '/api/docs') {
        if (!resolvedDocsDir || !fs.existsSync(resolvedDocsDir)) {
          sendJson(res, 200, { docs: [] });
          return;
        }

        const entries = fs.readdirSync(resolvedDocsDir, { withFileTypes: true });
        const docs = [];
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md') {
            const meta = parseDocMetadata(path.join(resolvedDocsDir, entry.name));
            const tasks = defaultBoard.listItems({ design_slug: meta.slug });
            const total = tasks.length;
            const done = tasks.filter(t => t.status === 'done').length;
            const openBugs = tasks.filter(t => t.track === 'bug' && t.status !== 'done').length;
            const progress = total === 0 ? 0 : Math.round((done / total) * 100);

            docs.push({
              ...meta,
              taskStats: { total, done, openBugs, progress }
            });
          }
        }
        ensureDocCodenames(docs);
        sendJson(res, 200, { docs, docsDir: resolvedDocsDir });
        return;
      }

      // API: GET /api/docs/:slug
      const docDetailMatch = pathname.match(/^\/api\/docs\/([a-zA-Z0-9_\-]+)$/);
      if (method === 'GET' && docDetailMatch) {
        const slug = docDetailMatch[1];
        if (!resolvedDocsDir) return sendError(res, 404, 'Docs directory not found');
        const docFile = path.join(resolvedDocsDir, `${slug}.md`);
        if (!fs.existsSync(docFile)) {
          return sendError(res, 404, `Design doc "${slug}" not found`);
        }

        const meta = parseDocMetadata(docFile);
        const rawContent = fs.readFileSync(docFile, 'utf8');
        const tasks = defaultBoard.listItems({ design_slug: slug });
        sendJson(res, 200, {
          doc: {
            ...meta,
            content: rawContent,
            tasks
          }
        });
        return;
      }

      // API: POST /api/docs/:slug/status
      const legacyDocStatusMatch = pathname.match(/^\/api\/docs\/([a-zA-Z0-9_\-]+)\/status$/);
      if (method === 'POST' && legacyDocStatusMatch) {
        assertLegacyMutationAccess();
        const slug = legacyDocStatusMatch[1];
        const body = await parseBody(req);
        const newStatus = body.status || 'Finished';

        if (!resolvedDocsDir) return sendError(res, 404, 'Docs directory not found');
        const docFile = path.join(resolvedDocsDir, `${slug}.md`);
        if (!fs.existsSync(docFile)) {
          return sendError(res, 404, `Design doc "${slug}" not found`);
        }

        const updatedMeta = updateDocStatusInFile(docFile, newStatus);
        broadcastChange('doc:status', { slug, status: updatedMeta.status, isFinished: updatedMeta.isFinished });
        sendJson(res, 200, {
          success: true,
          slug,
          status: updatedMeta.status,
          isFinished: updatedMeta.isFinished,
          doc: updatedMeta
        });
        return;
      }

      // API: GET /api/board
      if (method === 'GET' && pathname === '/api/board') {
        const summary = defaultBoard.getBoardSummary();
        sendJson(res, 200, summary);
        return;
      }

      // API: GET /api/tasks
      if (method === 'GET' && pathname === '/api/tasks') {
        const doc = parsedUrl.searchParams.get('doc') || undefined;
        const status = parsedUrl.searchParams.get('status') || undefined;
        const mode = parsedUrl.searchParams.get('mode') || undefined;
        const track = parsedUrl.searchParams.get('track') || undefined;

        const tasks = defaultBoard.listItems({ design_slug: doc, status, mode, track });
        sendJson(res, 200, { tasks });
        return;
      }

      // API: GET /api/tasks/:id
      const taskDetailMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
      if (method === 'GET' && taskDetailMatch) {
        const id = Number(taskDetailMatch[1]);
        const task = defaultBoard.getItem(id);
        if (!task) return sendError(res, 404, `Task #${id} not found`);
        sendJson(res, 200, { task });
        return;
      }

      // API: POST /api/tasks
      if (method === 'POST' && pathname === '/api/tasks') {
        assertLegacyMutationAccess();
        const body = await parseBody(req);
        const id = defaultBoard.addItem(body);
        const task = defaultBoard.getItem(id);
        broadcastChange('task:create', { id });
        sendJson(res, 201, { task });
        return;
      }

      // API: PATCH /api/tasks/:id
      if (method === 'PATCH' && taskDetailMatch) {
        assertLegacyMutationAccess();
        const id = Number(taskDetailMatch[1]);
        const body = await parseBody(req);
        const task = defaultBoard.updateItem(id, body);
        broadcastChange('task:update', { id });
        sendJson(res, 200, { task });
        return;
      }

      // API: POST /api/tasks/:id/toggle-checklist
      const toggleChecklistMatch = pathname.match(/^\/api\/tasks\/(\d+)\/toggle-checklist$/);
      if (method === 'POST' && toggleChecklistMatch) {
        assertLegacyMutationAccess();
        const id = Number(toggleChecklistMatch[1]);
        const body = await parseBody(req);
        const itemIndex = Number(body.index);
        if (isNaN(itemIndex) || itemIndex < 0) {
          return sendError(res, 400, 'Valid checklist item index is required');
        }
        const task = defaultBoard.toggleChecklistItem(id, itemIndex);
        broadcastChange('task:update', { id });
        sendJson(res, 200, { task });
        return;
      }

      // API: DELETE /api/tasks/:id
      if (method === 'DELETE' && taskDetailMatch) {
        assertLegacyMutationAccess();
        const id = Number(taskDetailMatch[1]);
        const ok = defaultBoard.deleteItem(id);
        if (!ok) return sendError(res, 404, `Task #${id} not found`);
        broadcastChange('task:delete', { id });
        sendJson(res, 200, { success: true, deleted_id: id });
        return;
      }

      // If it starts with /api/ but didn't match, return 404 JSON
      if (pathname.startsWith('/api/')) {
        sendError(res, 404, `Route ${method} ${pathname} not found`);
        return;
      }

      // Fall back to serving static files from UI directory
      serveStatic(req, res, uiDir);

    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return sendError(res, 401, err.message);
      }
      if (err instanceof ForbiddenError) {
        return sendError(res, 403, err.message);
      }
      if (err instanceof AgentNotFoundError) {
        return sendError(res, 404, err.message);
      }
      const isNotFound = /not found/i.test(err.message);
      sendError(res, isNotFound ? 404 : 400, err.message);
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' ? address.port : port;
      resolve({
        server,
        port: actualPort,
        url: `http://localhost:${actualPort}`,
        roster: effectiveRoster,
        board: defaultBoard,
        close: () => {
          for (const client of sseClients) {
            try { client.end(); } catch (_) {}
          }
          sseClients.clear();
          server.close();
          effectiveRoster.closeAll();
        }
      });
    });
    server.on('error', reject);
  });
}
