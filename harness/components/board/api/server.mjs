import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRoster, AgentNotFoundError, ProjectNotFoundError } from '../engine/roster.mjs';
import { UnauthorizedError, ForbiddenError } from '../engine/auth.mjs';
import { handleCorsPreflight } from './middleware/cors.mjs';
import { sendError } from './middleware/json.mjs';
import { serveStatic } from './middleware/static.mjs';
import { createAuthContext } from './middleware/auth.mjs';
import { EventBroker } from './services/eventBroker.mjs';
import { findDocsDir, ensureDocCodenames } from './services/docService.mjs';
import { handleHealthRoutes } from './routes/health.mjs';
import { handleEventRoutes } from './routes/events.mjs';
import { handleAdminRoutes } from './routes/admin.mjs';
import { handleBoardRoutes } from './routes/board.mjs';
import { handleDocRoutes } from './routes/docs.mjs';
import { handleProjectRoutes } from './routes/projects.mjs';
import { createProjectsStore } from '../engine/projectsStore.mjs';
import { createWorkspaceScanner } from '../engine/workspaceScanner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_UI_DIR = path.resolve(__dirname, '../ui');

export { findDocsDir, ensureDocCodenames };

export function createBoardServer({
  roster = null,
  rosterPath = null,
  boardsDir = null,
  operatorToken = null,
  dbPath = null,
  uiDir = DEFAULT_UI_DIR,
  docsDir = null,
  syncDocsDir = null,
  projectsStore = null,
  projectsFilePath = null,
  workspaceScanner = null,
  port = 0
} = {}) {
  const resolvedDocsDir = findDocsDir(docsDir);
  const resolvedSyncDocsDir = path.resolve(syncDocsDir || 'docs/sync');
  fs.mkdirSync(resolvedSyncDocsDir, { recursive: true });
  const serverRootDir = process.cwd();

  // Initialize Roster
  let effectiveRoster = roster;
  if (!effectiveRoster) {
    if (rosterPath || boardsDir || !dbPath) {
      effectiveRoster = openRoster({
        rosterPath,
        boardsDir,
        operatorToken,
        docsDir: resolvedDocsDir,
        syncDocsDir: resolvedSyncDocsDir,
        rootDir: serverRootDir
      });
    } else {
      // Wrap single-database path into a single-agent roster with project and derived rosterPath
      const defaultId = 'manager-pm';
      const dbBase = path.basename(dbPath);
      const projName = dbBase === 'project.sqlite' ? 'incubator-v5' : dbBase.replace(/\.sqlite$/, '');
      const derivedBoardsDir = path.dirname(path.resolve(dbPath));
      const potentialRosterPath = path.resolve(derivedBoardsDir, '../config/roster.json');
      const resolvedRosterPath = fs.existsSync(potentialRosterPath) ? potentialRosterPath : path.resolve(derivedBoardsDir, 'roster.json');

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
        rosterPath: resolvedRosterPath,
        boardsDir: derivedBoardsDir,
        operatorToken,
        docsDir: resolvedDocsDir,
        syncDocsDir: resolvedSyncDocsDir,
        rootDir: serverRootDir
      });
    }
  } else {
    if (typeof effectiveRoster.setDocDirectories === 'function') {
      effectiveRoster.setDocDirectories({
        docsDir: resolvedDocsDir,
        syncDocsDir: resolvedSyncDocsDir,
        rootDir: serverRootDir
      });
    }
  }

  const candidateProjectsFile = rosterPath ? path.resolve(path.dirname(rosterPath), 'projects.json') : null;
  const resolvedProjectsFile = projectsFilePath ||
    (candidateProjectsFile && fs.existsSync(candidateProjectsFile) ? candidateProjectsFile : null) ||
    (fs.existsSync(path.resolve('config/projects.json')) ? path.resolve('config/projects.json') : null) ||
    candidateProjectsFile ||
    path.resolve('config/projects.json');

  const effectiveProjectsStore = projectsStore || createProjectsStore({
    filePath: resolvedProjectsFile
  });
  const effectiveWorkspaceScanner = workspaceScanner || createWorkspaceScanner({
    searchRoots: [
      process.cwd(),
      path.resolve('..'),
      path.resolve('../..'),
      path.resolve('../../..'),
      boardsDir ? path.resolve(boardsDir, '..') : null,
      process.env.FALCON_AGENTS_ROOT,
      process.env.AGENTS_ROOT
    ].filter(Boolean)
  });

  const eventBroker = new EventBroker({ keepaliveIntervalMs: 15000 });

  const server = http.createServer(async (req, res) => {
    // 1. CORS Preflight
    if (handleCorsPreflight(req, res)) return;

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    try {
      // 2. Health check
      if (handleHealthRoutes(req, res, pathname)) return;

      // 3. Real-time SSE event stream
      if (handleEventRoutes(req, res, pathname, eventBroker)) return;

      // 4. Create request auth context and unified application context
      const ctx = createAuthContext(req, effectiveRoster, parsedUrl, () => effectiveRoster.getDefaultAgentId());
      const appContext = {
        ctx,
        effectiveRoster,
        get defaultAgentId() {
          return effectiveRoster.getDefaultAgentId();
        },
        get defaultBoard() {
          const id = effectiveRoster.getDefaultAgentId();
          return id ? effectiveRoster.getBoard(id) : null;
        },
        resolvedDocsDir,
        resolvedSyncDocsDir,
        projectsStore: effectiveProjectsStore,
        workspaceScanner: effectiveWorkspaceScanner,
        eventBroker
      };

      // 5. Admin & Fleet Management routes
      if (await handleAdminRoutes(req, res, pathname, appContext)) return;

      // 6. Board and Task CRUD routes (v1 and legacy)
      if (await handleBoardRoutes(req, res, pathname, parsedUrl, appContext)) return;

      // 7. Design Doc routes (v1 and legacy)
      if (await handleDocRoutes(req, res, pathname, appContext)) return;

      // 8. Projects Catalog & Live Inventory routes
      if (await handleProjectRoutes(req, res, pathname, appContext)) return;

      // 9. 404 for unhandled API routes
      if (pathname.startsWith('/api/')) {
        sendError(res, 404, `Route ${method} ${pathname} not found`);
        return;
      }

      // 9. Static UI assets
      serveStatic(req, res, uiDir);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return sendError(res, 401, err.message);
      }
      if (err instanceof ForbiddenError) {
        return sendError(res, 403, err.message);
      }
      const isNotFound = err instanceof AgentNotFoundError ||
                         err instanceof ProjectNotFoundError ||
                         (err.message && err.message.toLowerCase().includes('not found'));
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
        get board() {
          const id = effectiveRoster.getDefaultAgentId();
          return id ? effectiveRoster.getBoard(id) : null;
        },
        close: () => {
          eventBroker.close();
          server.close();
          effectiveRoster.closeAll();
        }
      });
    });
    server.on('error', reject);
  });
}
