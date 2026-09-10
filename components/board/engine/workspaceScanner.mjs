import fs from 'node:fs';
import path from 'node:path';

/**
 * Normalizes a GitHub repository URL into a clean lowercase "owner/repo" slug.
 * Handles HTTPS, SSH, trailing .git, and trailing slashes.
 * 
 * @param {string} rawUrl 
 * @returns {string|null} Normalized slug (e.g. "wolf-of-blog-street/project-alpha") or null
 */
export function normalizeGithubSlug(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();

  // Pattern 1: git@github.com:owner/repo(.git)
  const sshMatch = trimmed.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (sshMatch) {
    return `${sshMatch[1].toLowerCase()}/${sshMatch[2].toLowerCase()}`;
  }

  // Pattern 2: https?://(www.)github.com/owner/repo(.git)(/...)
  const httpMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/i);
  if (httpMatch) {
    return `${httpMatch[1].toLowerCase()}/${httpMatch[2].toLowerCase()}`;
  }

  return null;
}

/**
 * Parses Git remote URL and branch information from a workspace directory.
 * 
 * @param {string} dirPath Workspace directory absolute path
 * @returns {Object} { isGitRepo, remoteUrl, normalizedSlug, currentBranch, hasBoard }
 */
export function readGitWorktreeInfo(dirPath) {
  const result = {
    isGitRepo: false,
    remoteUrl: null,
    normalizedSlug: null,
    currentBranch: null,
    hasBoard: false
  };

  if (!dirPath || !fs.existsSync(dirPath)) return result;

  try {
    const gitDir = path.join(dirPath, '.git');
    if (fs.existsSync(gitDir)) {
      result.isGitRepo = true;

      // 1. Read Git Config for remote origin URL
      let configPath = gitDir;
      if (fs.statSync(gitDir).isDirectory()) {
        configPath = path.join(gitDir, 'config');
      } else {
        // Handle git worktree (.git is a file referencing gitdir)
        try {
          const gitFileContent = fs.readFileSync(gitDir, 'utf8');
          const gdMatch = gitFileContent.match(/^gitdir:\s*(.+)$/m);
          if (gdMatch) {
            configPath = path.resolve(dirPath, gdMatch[1].trim(), 'config');
          }
        } catch {}
      }

      if (fs.existsSync(configPath)) {
        try {
          const configContent = fs.readFileSync(configPath, 'utf8');
          const urlMatch = configContent.match(/\[remote\s+["']?(origin|[a-zA-Z0-9_\-]+)["']?\][^\[]*?url\s*=\s*([^\r\n]+)/is);
          if (urlMatch) {
            result.remoteUrl = urlMatch[2].trim();
            result.normalizedSlug = normalizeGithubSlug(result.remoteUrl);
          }
        } catch {}
      }

      // 2. Read HEAD for current branch
      const headPath = fs.statSync(gitDir).isDirectory() ? path.join(gitDir, 'HEAD') : null;
      if (headPath && fs.existsSync(headPath)) {
        try {
          const headContent = fs.readFileSync(headPath, 'utf8').trim();
          const refMatch = headContent.match(/^ref:\s*refs\/heads\/(.+)$/);
          if (refMatch) {
            result.currentBranch = refMatch[1];
          } else {
            result.currentBranch = headContent.slice(0, 8); // Detached commit SHA
          }
        } catch {}
      }
    }

    // 3. Check for local SQLite board
    const boardsDir = path.join(dirPath, 'boards');
    if (fs.existsSync(boardsDir)) {
      try {
        const files = fs.readdirSync(boardsDir);
        result.hasBoard = files.some(f => f.endsWith('.sqlite'));
      } catch {}
    }
  } catch {}

  return result;
}

/**
 * Searches and discovers agent seats across given search directories or common hierarchy.
 * An agent seat is identified by having a `workspaces/` child directory.
 * 
 * @param {Array<string>} [searchRoots=[]] Additional candidate directories to inspect
 * @returns {Array<Object>} List of discovered seats: { agentId, seatPath, workspacesPath }
 */
export function discoverAgentSeats(searchRoots = []) {
  const seats = new Map();

  function checkCandidate(candPath) {
    if (!candPath || !fs.existsSync(candPath)) return;
    const stat = fs.statSync(candPath);
    if (!stat.isDirectory()) return;

    const wsPath = path.join(candPath, 'workspaces');
    if (fs.existsSync(wsPath) && fs.statSync(wsPath).isDirectory()) {
      const agentId = path.basename(candPath);
      if (!seats.has(agentId)) {
        seats.set(agentId, {
          agentId,
          seatPath: path.resolve(candPath),
          workspacesPath: path.resolve(wsPath)
        });
      }
    }
  }

  // 1. Check passed roots directly
  for (const root of searchRoots) {
    if (!root) continue;
    checkCandidate(root);
  }

  // 2. Discover parent agent folders (up to 3 levels deep from root)
  const candidateRoots = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
    path.resolve(process.cwd(), '../../..'),
    process.env.INCUBATOR_AGENTS_ROOT || null
  ].filter(Boolean);

  for (const cRoot of candidateRoots) {
    if (!fs.existsSync(cRoot)) continue;
    checkCandidate(cRoot);

    try {
      const children = fs.readdirSync(cRoot);
      for (const child of children) {
        if (child.startsWith('.') || child === 'node_modules') continue;
        const sub = path.join(cRoot, child);
        checkCandidate(sub);

        // Level 2 (e.g. agent-d/agent-d/agent-d-pm)
        try {
          if (fs.statSync(sub).isDirectory()) {
            const subChildren = fs.readdirSync(sub);
            for (const sc of subChildren) {
              if (sc.startsWith('.') || sc === 'node_modules') continue;
              const sub2 = path.join(sub, sc);
              checkCandidate(sub2);

              // Level 3
              try {
                if (fs.statSync(sub2).isDirectory()) {
                  const sub3Children = fs.readdirSync(sub2);
                  for (const sc3 of sub3Children) {
                    if (sc3.startsWith('.') || sc3 === 'node_modules') continue;
                    checkCandidate(path.join(sub2, sc3));
                  }
                }
              } catch {}
            }
          }
        } catch {}
      }
    } catch {}
  }

  return Array.from(seats.values());
}

/**
 * Creates a WorkspaceScanner engine capable of synthesizing catalog projects
 * with live agent workspace checkouts and caching results.
 * 
 * @param {Object} [options={}]
 * @param {number} [options.cacheTtlMs=10000] In-memory cache TTL in milliseconds
 * @param {Array<string>} [options.searchRoots=[]] Custom paths to scan for agent seats
 * @returns {Object}
 */
export function createWorkspaceScanner(options = {}) {
  const cacheTtlMs = options.cacheTtlMs ?? 10000;
  const searchRoots = Array.isArray(options.searchRoots) ? options.searchRoots : [];

  let cachedResult = null;
  let cacheExpiry = 0;

  return {
    invalidateCache() {
      cachedResult = null;
      cacheExpiry = 0;
    },

    scanLiveInventory(catalogProjects = [], rosterAgents = []) {
      const now = Date.now();
      if (cachedResult && now < cacheExpiry) {
        return cachedResult;
      }

      // Build roster agent lookup map for rich UI metadata (icon, color, display name)
      const agentMetaMap = new Map();
      for (const ag of rosterAgents) {
        if (ag && ag.id) {
          agentMetaMap.set(ag.id, {
            name: ag.name || ag.id,
            icon: ag.icon || '🤖',
            color: ag.color || 'blue',
            projects: Array.isArray(ag.projects) ? ag.projects.map(p => p.id || p) : []
          });
        }
      }

      // 1. Discover all active agent seats
      const seats = discoverAgentSeats(searchRoots);

      // 2. Scan all workspaces across seats
      const scannedWorkspaces = [];

      // Check current working directory / server host repository
      try {
        const cwdGitInfo = readGitWorktreeInfo(process.cwd());
        if (cwdGitInfo.isGitRepo) {
          const cwdRepoSlug = cwdGitInfo.normalizedSlug?.split('/')[1] || path.basename(process.cwd()).toLowerCase();
          let cwdAgentId = null;

          // Find agent in roster configured for this repo
          for (const ag of rosterAgents) {
            const hasProj = ag.projects?.some(p => {
              const pid = (typeof p === 'string' ? p : p.id || '').toLowerCase();
              return pid === cwdRepoSlug;
            });
            if (hasProj) {
              cwdAgentId = ag.id;
              break;
            }
          }

          if (!cwdAgentId && agentMetaMap.has('manager-pm')) {
            cwdAgentId = 'manager-pm';
          }

          if (cwdAgentId) {
            const cwdMeta = agentMetaMap.get(cwdAgentId) || {
              name: cwdAgentId,
              icon: '🛡️',
              color: 'cyan',
              projects: []
            };
            scannedWorkspaces.push({
              agentId: cwdAgentId,
              agentName: cwdMeta.name,
              agentIcon: cwdMeta.icon,
              agentColor: cwdMeta.color,
              workspaceName: path.basename(process.cwd()),
              workspacePath: `workspaces/${path.basename(process.cwd())}`,
              absolutePath: process.cwd(),
              remoteUrl: cwdGitInfo.remoteUrl,
              normalizedSlug: cwdGitInfo.normalizedSlug,
              currentBranch: cwdGitInfo.currentBranch,
              hasBoard: cwdGitInfo.hasBoard,
              rosterProjects: cwdMeta.projects
            });
          }
        }
      } catch {}

      for (const seat of seats) {
        const meta = agentMetaMap.get(seat.agentId) || {
          name: seat.agentId,
          icon: '🤖',
          color: 'blue',
          projects: []
        };

        if (fs.existsSync(seat.workspacesPath)) {
          try {
            const entries = fs.readdirSync(seat.workspacesPath);
            for (const entry of entries) {
              if (entry.startsWith('.') || entry === 'node_modules') continue;
              const entryPath = path.join(seat.workspacesPath, entry);
              if (fs.statSync(entryPath).isDirectory()) {
                const gitInfo = readGitWorktreeInfo(entryPath);
                scannedWorkspaces.push({
                  agentId: seat.agentId,
                  agentName: meta.name,
                  agentIcon: meta.icon,
                  agentColor: meta.color,
                  workspaceName: entry,
                  workspacePath: `workspaces/${entry}`,
                  absolutePath: entryPath,
                  remoteUrl: gitInfo.remoteUrl,
                  normalizedSlug: gitInfo.normalizedSlug,
                  currentBranch: gitInfo.currentBranch,
                  hasBoard: gitInfo.hasBoard,
                  rosterProjects: meta.projects
                });
              }
            }
          } catch {}
        }
      }

      // 3. Synthesize catalog projects with active checkouts
      const checkedOutAgentSeatIds = new Set();
      const synthesizedProjects = catalogProjects.map(proj => {
        const projNormalizedSlug = normalizeGithubSlug(proj.github_url);
        const projId = proj.id.toLowerCase();

        // Match checkouts by normalized git slug, folder name, or roster configuration
        const matches = scannedWorkspaces.filter(ws => {
          if (projNormalizedSlug && ws.normalizedSlug && projNormalizedSlug === ws.normalizedSlug) {
            return true;
          }
          if (ws.workspaceName.toLowerCase() === projId) {
            return true;
          }
          if (ws.rosterProjects.some(rp => String(rp).toLowerCase() === projId)) {
            return true;
          }
          return false;
        });

        // Deduplicate matches by agentId (one entry per agent seat)
        const matchedAgentsMap = new Map();
        for (const m of matches) {
          if (!matchedAgentsMap.has(m.agentId)) {
            matchedAgentsMap.set(m.agentId, {
              agentId: m.agentId,
              agentName: m.agentName,
              agentIcon: m.agentIcon,
              agentColor: m.agentColor,
              workspacePath: m.workspacePath,
              absolutePath: m.absolutePath,
              hasBoard: m.hasBoard,
              currentBranch: m.currentBranch || 'main'
            });
            checkedOutAgentSeatIds.add(m.agentId);
          }
        }

        // Check roster configuration: if an agent in roster has this project configured,
        // attribute checkout to that seat even if the workspace directory is on a distributed seat
        for (const [agentId, meta] of agentMetaMap.entries()) {
          if (!matchedAgentsMap.has(agentId)) {
            const hasProject = meta.projects.some(rp => {
              const rpStr = String(rp).toLowerCase();
              return rpStr === projId || (projNormalizedSlug && normalizeGithubSlug(rpStr) === projNormalizedSlug);
            });
            if (hasProject) {
              matchedAgentsMap.set(agentId, {
                agentId,
                agentName: meta.name,
                agentIcon: meta.icon,
                agentColor: meta.color,
                workspacePath: `workspaces/${proj.id}`,
                absolutePath: null,
                hasBoard: true,
                currentBranch: 'main'
              });
              checkedOutAgentSeatIds.add(agentId);
            }
          }
        }

        const checkedOutBy = Array.from(matchedAgentsMap.values());
        const isCheckedOut = checkedOutBy.length > 0;

        return {
          ...proj,
          isCheckedOut,
          checkoutCount: checkedOutBy.length,
          checkedOutBy
        };
      });

      const checkedOutCount = synthesizedProjects.filter(p => p.isCheckedOut).length;
      const unassignedCount = synthesizedProjects.filter(p => !p.isCheckedOut).length;

      const result = {
        projects: synthesizedProjects,
        stats: {
          totalProjects: synthesizedProjects.length,
          checkedOutProjects: checkedOutCount,
          unassignedProjects: unassignedCount,
          activeAgentSeats: checkedOutAgentSeatIds.size
        }
      };

      cachedResult = result;
      cacheExpiry = now + cacheTtlMs;
      return result;
    }
  };
}
