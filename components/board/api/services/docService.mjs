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

export async function updateDocStatusInFile(filePath, newStatus) {
  let content = await fs.promises.readFile(filePath, 'utf8');
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

  await fs.promises.writeFile(filePath, content, 'utf8');
  return parseDocMetadata(filePath);
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
          docs.push({ ...meta, slug, filePath });
        }
      }
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
  const agentSyncFile = path.join(syncDocsDirFor(resolvedSyncDocsDir, targetAgent, targetProject), `${slug}.md`);
  if (await fileExists(agentSyncFile)) return agentSyncFile;
  const fallbackFile = (resolvedDocsDir && targetAgent === defaultAgentId) ? path.join(resolvedDocsDir, `${slug}.md`) : null;
  if (fallbackFile && (await fileExists(fallbackFile))) return fallbackFile;
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

    const isClosed = CLOSED_STATUSES.includes((doc.status || '').toLowerCase().trim());
    const lifecycle = isClosed ? 'closed' : 'open';
    const executionState = (inProgress > 0 || todo > 0) ? 'active' : 'inactive';
    const stateLabel = `${isClosed ? 'Closed' : 'Open'} & ${executionState === 'active' ? 'Active' : 'Inactive'}`;

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
  }
  if (targetAgent === defaultAgentId && resolvedDocsDir && (await fileExists(resolvedDocsDir))) {
    docs.push(...(await collectDocsFromDir(resolvedDocsDir, seenSlugs)));
  }
  return { docs, agentSyncDir };
}
