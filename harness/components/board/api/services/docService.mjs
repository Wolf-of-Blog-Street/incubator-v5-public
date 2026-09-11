import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CURATED_DOC_COLORS = [
  '#38bdf8', // sky
  '#a855f7', // purple
  '#10b981', // emerald
  '#f59e0b', // amber
  '#f43f5e', // rose
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#f97316'  // orange
];

export function getDeterministicDocColor(slug) {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) & 0xffffffff;
  }
  return CURATED_DOC_COLORS[Math.abs(hash) % CURATED_DOC_COLORS.length];
}

export function sortAndEnsureDocCodenames(docs) {
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

export function ensureDocCodenames(docs) {
  return sortAndEnsureDocCodenames(docs);
}

export function findDocsDir(customDir, projectName = null) {
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

export const CLOSED_STATUSES = ['closed', 'archived', 'finished', 'done'];

export function parseDocMetadataContent(content, slug, filePath) {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const statusMatch = content.match(/[-*]\s+\*\*Status\*\*:\s*([^\n\r]+)/i);
  const authorMatch = content.match(/[-*]\s+\*\*Author\*\*:\s*([^\n\r]+)/i);
  const targetMatch = content.match(/[-*]\s+\*\*Target Component\(s\)\*\*:\s*([^\n\r]+)/i);
  const updatedMatch = content.match(/[-*]\s+\*\*Last Updated\*\*:\s*([^\n\r]+)/i);
  const codenameMatch = content.match(/[-*]\s+\*\*Codename\*\*:\s*([^\n\r]+)/i);
  const colorMatch = content.match(/[-*]\s+\*\*Color\*\*:\s*([^\n\r]+)/i);

  const status = statusMatch ? statusMatch[1].trim() : 'Draft';
  const isFinished = CLOSED_STATUSES.includes(status.toLowerCase());
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

export async function parseDocMetadata(filePath) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  const slug = path.basename(filePath, '.md');
  return parseDocMetadataContent(content, slug, filePath);
}

export function parseDocMetadataSync(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const slug = path.basename(filePath, '.md');
  return parseDocMetadataContent(content, slug, filePath);
}

export function updateDocStatusInFileSync(filePath, newStatus) {
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
  return parseDocMetadataSync(filePath);
}

export async function updateDocStatusInFile(filePath, newStatus) {
  return updateDocStatusInFileSync(filePath, newStatus);
}

export async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    await fs.promises.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

export async function collectDocsFromDir(dir, seenSlugs = new Set()) {
  if (!dir) return [];
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const docs = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md') {
        const slug = path.basename(entry.name, '.md');
        if (!seenSlugs.has(slug)) {
          seenSlugs.add(slug);
          const filePath = path.join(dir, entry.name);
          const meta = await parseDocMetadata(filePath);
          docs.push({ ...meta, slug, filePath, isArchived: false });
        }
      }
    }

    const archiveDir = path.join(dir, 'archive');
    if (fs.existsSync(archiveDir)) {
      try {
        const archiveEntries = await fs.promises.readdir(archiveDir, { withFileTypes: true });
        for (const entry of archiveEntries) {
          if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md') {
            const slug = path.basename(entry.name, '.md');
            if (!seenSlugs.has(slug)) {
              seenSlugs.add(slug);
              const filePath = path.join(archiveDir, entry.name);
              const meta = await parseDocMetadata(filePath);
              docs.push({ ...meta, slug, filePath, isArchived: true });
            }
          }
        }
      } catch (_) {}
    }

    return docs;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/** Synced docs live at docs/sync/<agent>/<project>/; legacy flat <agent>/ when no project is given. */
export function syncDocsDirFor(resolvedSyncDocsDir, targetAgent, targetProject = null) {
  return path.join(resolvedSyncDocsDir, targetAgent, targetProject || '');
}

export async function resolveDocFile({ slug, targetAgent, targetProject = null, resolvedSyncDocsDir, resolvedDocsDir, defaultAgentId }) {
  if (resolvedSyncDocsDir && targetAgent) {
    const agentSyncDir = syncDocsDirFor(resolvedSyncDocsDir, targetAgent, targetProject);
    const agentSyncFile = path.join(agentSyncDir, `${slug}.md`);
    if (await fileExists(agentSyncFile)) return agentSyncFile;
    const agentArchiveFile = path.join(agentSyncDir, 'archive', `${slug}.md`);
    if (await fileExists(agentArchiveFile)) return agentArchiveFile;
  }
  if (resolvedDocsDir && (targetAgent === defaultAgentId || !targetAgent)) {
    const fallbackFile = path.join(resolvedDocsDir, `${slug}.md`);
    if (await fileExists(fallbackFile)) return fallbackFile;
    const fallbackArchiveFile = path.join(resolvedDocsDir, 'archive', `${slug}.md`);
    if (await fileExists(fallbackArchiveFile)) return fallbackArchiveFile;
  }
  return null;
}

export function attachDocTaskStats(docs, board) {
  for (const doc of docs) {
    const tasks = board.listItems({ design_slug: doc.slug });
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in-progress' || t.status === 'review').length;
    const todo = tasks.filter(t => t.status === 'planned' || t.status === 'todo').length;
    const openBugs = tasks.filter(t => t.track === 'bug' && t.status !== 'done').length;
    const progress = total === 0 ? 0 : Math.round((done / total) * 100);

    const isAllDone = total > 0 && done === total;
    const isExplicitClosed = CLOSED_STATUSES.includes((doc.status || '').toLowerCase().trim());
    const isClosed = isExplicitClosed || isAllDone || Boolean(doc.isArchived);
    const lifecycle = isClosed ? 'closed' : 'open';
    const executionState = (inProgress > 0 || todo > 0) ? 'active' : 'inactive';
    const stateLabel = isClosed ? 'Closed' : (executionState === 'active' ? 'Open & Active' : 'Open & Inactive');

    doc.taskStats = {
      total,
      done,
      inProgress,
      todo,
      openBugs,
      progress,
      lifecycle,
      execution_state: executionState,
      state_label: stateLabel
    };
    doc.lifecycle = lifecycle;
    doc.execution_state = executionState;
    doc.state_label = stateLabel;
    if (isClosed) {
      doc.status = 'Closed';
      doc.isFinished = true;
    }
  }
  return docs;
}

export function checkDocCanClose(board, slug, force = false) {
  const items = board.listItems({ design_slug: slug });
  const openTasks = items.filter(t => t.status !== 'done');
  if (openTasks.length > 0 && !force) {
    return {
      canClose: false,
      error: `Cannot close design doc "${slug}": ${openTasks.length} task(s) still open. Use --force to close anyway.`,
      details: {
        closed: false,
        designSlug: slug,
        total: items.length,
        done: items.filter(t => t.status === 'done').length,
        openTasks
      }
    };
  }
  return { canClose: true };
}

export async function resolveAllAgentDocs(targetAgent, defaultAgentId, resolvedSyncDocsDir, resolvedDocsDir, targetProject = null) {
  const agentSyncDir = syncDocsDirFor(resolvedSyncDocsDir, targetAgent, targetProject);
  const seenSlugs = new Set();
  const docs = [];
  if (await fileExists(agentSyncDir)) {
    docs.push(...(await collectDocsFromDir(agentSyncDir, seenSlugs)));
    if (!targetProject) {
      try {
        const entries = await fs.promises.readdir(agentSyncDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== 'archive') {
            const projectDir = path.join(agentSyncDir, entry.name);
            docs.push(...(await collectDocsFromDir(projectDir, seenSlugs)));
          }
        }
      } catch {}
    }
  }
  if (targetAgent === defaultAgentId && resolvedDocsDir && (await fileExists(resolvedDocsDir))) {
    docs.push(...(await collectDocsFromDir(resolvedDocsDir, seenSlugs)));
  }
  return { docs, agentSyncDir };
}

/**
 * Finds the doc file location (active or archive) synchronously.
 */
/**
 * Locates all copies of a design doc across design directories and sync directories.
 * Returns an array of location objects for every copy found.
 */
export function findAllDocLocationsSync(slug, options = {}) {
  const safeSlug = path.basename(slug, '.md');
  const candidateDirs = new Set();

  function addDir(d) {
    if (d && typeof d === 'string') {
      try {
        const resolved = path.resolve(d);
        if (fs.existsSync(resolved)) {
          candidateDirs.add(resolved);
        }
      } catch (_) {}
    }
  }

  // 1. Explicit docsDir / resolvedDocsDir
  addDir(options.docsDir);
  addDir(options.resolvedDocsDir);

  // 2. rootDir variations
  if (options.rootDir) {
    addDir(path.resolve(options.rootDir, 'docs/design'));
    addDir(path.resolve(options.rootDir, 'design'));
    addDir(path.resolve(options.rootDir));
  }

  // 3. syncDocsDir variations (handles sync copies on server and remote hosts)
  const syncDocsBase = options.resolvedSyncDocsDir || options.syncDocsDir || (options.rootDir ? path.resolve(options.rootDir, 'docs/sync') : path.resolve('docs/sync'));
  if (syncDocsBase && fs.existsSync(syncDocsBase)) {
    if (options.targetAgent) {
      if (options.targetProject) {
        addDir(path.join(syncDocsBase, options.targetAgent, options.targetProject));
      }
      addDir(path.join(syncDocsBase, options.targetAgent));
    }
    // Scan all agent/project directories under syncDocsBase for this slug
    try {
      const topEntries = fs.readdirSync(syncDocsBase, { withFileTypes: true });
      for (const top of topEntries) {
        if (top.isDirectory() && top.name !== 'archive') {
          const topPath = path.join(syncDocsBase, top.name);
          addDir(topPath);
          try {
            const subEntries = fs.readdirSync(topPath, { withFileTypes: true });
            for (const sub of subEntries) {
              if (sub.isDirectory() && sub.name !== 'archive') {
                addDir(path.join(topPath, sub.name));
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // 4. Default / fallback design directories
  const projectName = options.projectName || options.targetProject || 'incubator-v5';
  addDir(findDocsDir(null, projectName));
  addDir(path.resolve(process.cwd(), 'docs/design'));
  addDir(path.resolve(process.cwd(), `workspaces/${projectName}/docs/design`));
  addDir(path.resolve(process.cwd(), `../workspaces/${projectName}/docs/design`));
  addDir(path.resolve(process.cwd(), 'design'));

  const locations = [];
  const seenPaths = new Set();

  for (const dir of candidateDirs) {
    const activeFile = path.join(dir, `${safeSlug}.md`);
    const archiveDir = path.join(dir, 'archive');
    const archiveFile = path.join(archiveDir, `${safeSlug}.md`);
    const indexFile = path.join(dir, 'INDEX.md');

    if (fs.existsSync(activeFile)) {
      try {
        const canonical = fs.realpathSync(activeFile);
        if (!seenPaths.has(canonical)) {
          seenPaths.add(canonical);
          locations.push({
            found: true,
            isArchived: false,
            filePath: activeFile,
            designDir: dir,
            archiveDir,
            indexFile: fs.existsSync(indexFile) ? indexFile : null
          });
        }
      } catch (_) {}
    } else if (fs.existsSync(archiveFile)) {
      try {
        const canonical = fs.realpathSync(archiveFile);
        if (!seenPaths.has(canonical)) {
          seenPaths.add(canonical);
          locations.push({
            found: true,
            isArchived: true,
            filePath: archiveFile,
            designDir: dir,
            archiveDir,
            indexFile: fs.existsSync(indexFile) ? indexFile : null
          });
        }
      } catch (_) {}
    }
  }

  return locations;
}

export function findDocLocationSync(slug, options = {}) {
  const all = findAllDocLocationsSync(slug, options);
  return all.length > 0 ? all[0] : { found: false };
}

/**
 * Synchronously rewrites the design/INDEX.md file when a doc transitions to Closed.
 * Moves the doc row from the active blueprints table to the closed (archived) table.
 */
export function updateIndexOnCloseSync(indexFilePath, slug, docMeta = {}) {
  if (!indexFilePath || !fs.existsSync(indexFilePath)) return false;
  let content = fs.readFileSync(indexFilePath, 'utf8');

  // Look for any line matching this slug (e.g. `[doc-lifecycle](...)` or `[`doc-lifecycle`](...)`)
  const slugRegex = new RegExp(`\\|[^\\n\\r]*\\[\`?${slug}\`?\\]\\([^\\)\\n\\r]*\\)[^\\n\\r]*\\|`, 'i');
  const match = content.match(slugRegex);

  const safeCodename = docMeta.codename ? `**${docMeta.codename.replace(/\*/g, '')}**` : null;
  const safeDesc = docMeta.title || slug;

  let codename = safeCodename;
  let description = safeDesc;

  if (match) {
    const matchedLine = match[0];
    const closedSectionIndex = content.search(/##\s+Closed/i);
    const lineIndex = content.indexOf(matchedLine);
    if (closedSectionIndex !== -1 && lineIndex > closedSectionIndex) {
      // Already in closed section
      return true;
    }

    // Parse cells from matchedLine
    const cells = matchedLine.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 1 && cells[0].includes('#d-')) {
      codename = cells[0];
    }
    if (cells.length >= 5) {
      description = cells[4];
    } else if (cells.length >= 3) {
      description = cells[cells.length - 1];
    }

    // Remove the line from active table
    content = content.replace(matchedLine + '\n', '').replace(matchedLine, '');
  }

  // Row for Closed table: | Codename | Blueprint | Description |
  const closedRow = `| ${codename || '-'} | [\`${slug}\`](archive/${slug}.md) | ${description} |`;

  // Find closed table
  const closedHeaderMatch = content.match(/(##\s+Closed[^\n\r]*\n+)(\|[\s\S]*?\|\s*:---[^\n\r]*\|)/i);
  if (closedHeaderMatch) {
    const insertPos = content.indexOf(closedHeaderMatch[0]) + closedHeaderMatch[0].length;
    content = content.slice(0, insertPos) + '\n' + closedRow + content.slice(insertPos);
  } else {
    content += `\n\n## Closed (archived)\n\n| Codename | Blueprint | Description |\n| :--- | :--- | :--- |\n${closedRow}\n`;
  }

  fs.writeFileSync(indexFilePath, content, 'utf8');
  return true;
}

/**
 * Synchronously rewrites the design/INDEX.md file when a doc transitions back to Open.
 * Moves the doc row from the closed (archived) table to the active blueprints table.
 */
export function updateIndexOnReopenSync(indexFilePath, slug, docMeta = {}, targetStatus = 'Open & Active') {
  if (!indexFilePath || !fs.existsSync(indexFilePath)) return false;
  let content = fs.readFileSync(indexFilePath, 'utf8');

  const slugRegex = new RegExp(`\\|[^\\n\\r]*\\[\`?${slug}\`?\\]\\([^\\)\\n\\r]*\\)[^\\n\\r]*\\|`, 'i');
  const match = content.match(slugRegex);

  const safeCodename = docMeta.codename ? `**${docMeta.codename.replace(/\*/g, '')}**` : null;
  const safeDesc = docMeta.title || slug;
  const safeTargets = docMeta.targets || '-';

  let codename = safeCodename;
  let description = safeDesc;
  let targets = safeTargets;

  if (match) {
    const matchedLine = match[0];
    const closedSectionIndex = content.search(/##\s+Closed/i);
    const lineIndex = content.indexOf(matchedLine);

    if (closedSectionIndex === -1 || lineIndex < closedSectionIndex) {
      // Just update status if needed
      const updatedLine = matchedLine.replace(/\|\s*(?:Open & Active|Open & Inactive|Draft|Active|Closed|Finished)\s*\|/i, `| ${targetStatus} |`);
      if (updatedLine !== matchedLine) {
        content = content.replace(matchedLine, updatedLine);
        fs.writeFileSync(indexFilePath, content, 'utf8');
      }
      return true;
    }

    const cells = matchedLine.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 1 && cells[0].includes('#d-')) {
      codename = cells[0];
    }
    if (cells.length >= 3) {
      description = cells[2];
    }

    // Remove from closed table
    content = content.replace(matchedLine + '\n', '').replace(matchedLine, '');
  }

  // Active table row: | Codename | Blueprint / Component | Status | Target Component | Description |
  const activeRow = `| ${codename || '-'} | [\`${slug}\`](${slug}.md) | ${targetStatus} | ${targets} | ${description} |`;

  const activeHeaderMatch = content.match(/(##\s+Active[^\n\r]*\n+)(\|[\s\S]*?\|\s*:---[^\n\r]*\|)/i);
  if (activeHeaderMatch) {
    const insertPos = content.indexOf(activeHeaderMatch[0]) + activeHeaderMatch[0].length;
    content = content.slice(0, insertPos) + '\n' + activeRow + content.slice(insertPos);
  } else {
    content = `## Active Living Blueprints\n\n| Codename | Blueprint / Component | Status | Target Component | Description |\n| :--- | :--- | :--- | :--- | :--- |\n${activeRow}\n\n---\n\n` + content;
  }

  fs.writeFileSync(indexFilePath, content, 'utf8');
  return true;
}

/**
 * Reconciles the design doc lifecycle state based on task completion on the board.
 * Automatically archives docs when all tasks are Done, and unarchives them if a task reopens.
 */
export function reconcileDocStatusSync(slug, options = {}) {
  if (!slug || typeof slug !== 'string') return null;
  const board = options.board;
  if (!board) return null;

  const safeSlug = path.basename(slug, '.md');
  const items = board.listItems({ design_slug: safeSlug });
  const total = items.length;
  const done = items.filter(i => i.status === 'done').length;
  const openTasks = total - done;

  let targetStatus;
  let shouldBeClosed = false;

  if (total > 0 && done === total) {
    targetStatus = 'Closed';
    shouldBeClosed = true;
  } else if (total > 0) {
    targetStatus = 'Open & Active';
    shouldBeClosed = false;
  } else {
    targetStatus = 'Open & Inactive';
    shouldBeClosed = false;
  }

  if (options.forceClose) {
    targetStatus = 'Closed';
    shouldBeClosed = true;
  } else if (options.forceReopen) {
    targetStatus = total > 0 ? 'Open & Active' : 'Open & Inactive';
    shouldBeClosed = false;
  }

  const locations = findAllDocLocationsSync(safeSlug, options);
  if (locations.length === 0) {
    return {
      slug: safeSlug,
      targetStatus,
      shouldBeClosed,
      fileFound: false,
      total,
      done,
      openTasks
    };
  }

  const updatedLocations = [];
  let primaryMeta = null;

  for (const docLoc of locations) {
    const { filePath, isArchived, designDir, archiveDir, indexFile } = docLoc;
    let currentMeta = parseDocMetadataSync(filePath);
    let newFilePath = filePath;

    if (shouldBeClosed) {
      updateDocStatusInFileSync(filePath, 'Closed');
      currentMeta = parseDocMetadataSync(filePath);

      if (!isArchived) {
        if (!fs.existsSync(archiveDir)) {
          fs.mkdirSync(archiveDir, { recursive: true });
        }
        const targetArchiveFile = path.join(archiveDir, `${safeSlug}.md`);
        fs.renameSync(filePath, targetArchiveFile);
        newFilePath = targetArchiveFile;

        if (indexFile && fs.existsSync(indexFile)) {
          updateIndexOnCloseSync(indexFile, safeSlug, currentMeta);
        }
      }
    } else {
      updateDocStatusInFileSync(filePath, targetStatus);
      currentMeta = parseDocMetadataSync(filePath);

      if (isArchived) {
        const targetActiveFile = path.join(designDir, `${safeSlug}.md`);
        fs.renameSync(filePath, targetActiveFile);
        newFilePath = targetActiveFile;

        if (indexFile && fs.existsSync(indexFile)) {
          updateIndexOnReopenSync(indexFile, safeSlug, currentMeta, targetStatus);
        }
      }
    }

    if (!primaryMeta) primaryMeta = currentMeta;
    updatedLocations.push({
      filePath: newFilePath,
      isArchived: shouldBeClosed,
      designDir,
      archiveDir,
      indexFile
    });
  }

  return {
    slug: safeSlug,
    targetStatus,
    shouldBeClosed,
    fileFound: true,
    filePath: updatedLocations[0]?.filePath,
    isArchived: shouldBeClosed,
    meta: primaryMeta,
    locations: updatedLocations,
    total,
    done,
    openTasks
  };
}

export async function reconcileDocStatus(slug, options = {}) {
  return reconcileDocStatusSync(slug, options);
}

