import fs from 'node:fs';
import path from 'node:path';

/**
 * Handles design doc lifecycle, synchronization, and milestones scaffolding.
 */

/**
 * Locates the local Markdown file for a given design doc slug across candidate directories.
 * 
 * @param {string} slug
 * @param {string} [projectName='incubator-v5']
 * @param {string|null} [customFile=null]
 * @returns {string|null}
 */
export function findDocFile(slug, projectName = 'incubator-v5', customFile = null) {
  if (customFile && fs.existsSync(customFile)) {
    return path.resolve(customFile);
  }
  const candidates = [
    path.resolve(`docs/design/${slug}.md`),
    path.resolve(`workspaces/${projectName}/docs/design/${slug}.md`),
    path.resolve(`../workspaces/${projectName}/docs/design/${slug}.md`),
    path.resolve(`design/${slug}.md`),
    path.resolve(`workspaces/incubator-v5-docs/design/${slug}.md`),
    path.resolve(`../incubator-v5-docs/design/${slug}.md`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Updates the frontmatter status of a design doc Markdown file on disk.
 * 
 * @param {string} slug
 * @param {Object} options
 * @param {string} options.status
 * @param {string} [options.projectName='incubator-v5']
 * @param {string|null} [options.customFile=null]
 * @returns {string|null} Updated file path, or null if file not found
 */
export function updateDocFrontmatterStatus(slug, { status, projectName = 'incubator-v5', customFile = null }) {
  const filePath = findDocFile(slug, projectName, customFile);
  if (!filePath) return null;

  let text = fs.readFileSync(filePath, 'utf8');
  const today = new Date().toISOString().slice(0, 10);

  if (/[-*]\s+\*\*Status\*\*:\s*[^\n\r]+/i.test(text)) {
    text = text.replace(/([-*]\s+\*\*Status\*\*:\s*)[^\n\r]+/i, `$1${status}`);
  } else {
    text = text.replace(/^(#\s+[^\n\r]+\n)/m, `$1\n- **Status**: ${status}\n`);
  }

  if (/[-*]\s+\*\*Last Updated\*\*:\s*[^\n\r]+/i.test(text)) {
    text = text.replace(/([-*]\s+\*\*Last Updated\*\*:\s*)[^\n\r]+/i, `$1${today}`);
  } else if (/[-*]\s+\*\*Status\*\*:\s*[^\n\r]+/i.test(text)) {
    text = text.replace(/([-*]\s+\*\*Status\*\*:\s*[^\n\r]+\n)/i, `$1- **Last Updated**: ${today}\n`);
  }

  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
}

export async function handleSyncDoc(board, parsed, projectName, extractMilestonesFromDoc) {
  const slug = parsed._[1] || parsed.flags.doc;
  if (!slug) {
    console.error('Error: Design doc slug is required. Example: board sync-doc falcon-manager-board-roster');
    process.exit(1);
  }
  const customFile = parsed.flags.file;
  const resolvedFile = findDocFile(slug, projectName || 'incubator-v5', customFile);
  if (!resolvedFile) {
    console.error(`Error: Could not find design doc file for slug "${slug}"`);
    process.exit(1);
  }
  await board.syncDoc(slug, resolvedFile);
  console.log(`📄 Synced design doc "${slug}" (${resolvedFile}) to Falcon Board`);

  // Auto-scaffold tasks from Implementation Milestones. Sub-bullet briefs are copied into task details.
  if (!parsed.flags['no-scaffold']) {
    const existing = await board.listItems({ design_slug: slug });
    const existingTitles = new Set(existing.map(t => t.title));
    const docContent = fs.readFileSync(resolvedFile, 'utf8');
    const targetCompMatch = docContent.match(/[-*]\s+\*\*Target Component\(s\)\*\*:\s*([^\n\r]+)/i);
    let defaultTrack = 'core';
    if (targetCompMatch) {
      const compText = targetCompMatch[1].toLowerCase();
      if (compText.includes('sweeper')) defaultTrack = 'sweeper';
      else if (compText.includes('harness') || compText.includes('fleet')) defaultTrack = 'harness';
      else if (compText.includes('brain')) defaultTrack = 'engine';
      else if (compText.includes('docs')) defaultTrack = 'docs';
    }
    const milestones = extractMilestonesFromDoc(docContent, defaultTrack)
      .filter(m => !existingTitles.has(m.title) && (existing.length === 0 || m.status !== 'done'));
    if (milestones.length > 0) {
      console.log(`🔨 Auto-scaffolding ${milestones.length} milestone task(s) from design doc onto board...`);
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        const taskStatus = (i === 0 && m.status !== 'done') ? 'in-progress' : m.status;
        const newId = await board.addItem({
          title: m.title,
          details: m.brief || undefined,
          design_slug: slug,
          track: m.track,
          mode: 'pair',
          status: taskStatus,
        });
        console.log(`   Task #${newId} [${m.track} · ${taskStatus}] "${m.title}"`);
      }
    }
  }
}

export async function handleFinishDoc(board, parsed, projectName) {
  const slug = parsed._[1] || parsed.flags.doc;
  if (!slug) {
    console.error('Error: Design doc slug required. Example: board finish-doc v5-foundation');
    process.exit(1);
  }
  const force = Boolean(parsed.flags.force);
  let res;
  try {
    res = await board.closeDesignDoc(slug, { force });
  } catch (err) {
    if (err.body && (err.body.openTasks || err.body.closed === false)) {
      res = { closed: false, error: err.message, openTasks: err.body.openTasks, ...err.body };
    } else {
      throw err;
    }
  }
  if (!res.closed) {
    console.error(`\n⚠️  ${res.error}\n`);
    console.log(`Open Tasks in "${slug}":`);
    for (const t of res.openTasks || []) {
      console.log(`  #${t.id} [${t.track}] (${t.status}) ${t.title}`);
    }
    console.log('');
    process.exit(1);
  } else {
    const updatedFile = updateDocFrontmatterStatus(slug, { status: 'Closed', projectName });
    if (updatedFile) {
      console.log(`Updated status to Closed in: ${updatedFile}`);
    }
    console.log(`\n🎉 Design Doc "${slug}" is CLOSED!`);
    console.log(`All ${res.total} task(s) completed (100%).`);
    console.log(`Note: Doc status is automatically recomputed on subsequent task writes.\n`);
  }
}

export async function handleReopenDoc(board, parsed, projectName) {
  const slug = parsed._[1] || parsed.flags.doc;
  if (!slug) {
    console.error('Error: Design doc slug required. Example: board reopen-doc v5-foundation');
    process.exit(1);
  }
  const res = await board.reopenDesignDoc(slug);
  if (!res.reopened) {
    console.error(`\n⚠️  ${res.error}\n`);
    process.exit(1);
  } else {
    const updatedFile = updateDocFrontmatterStatus(slug, { status: 'Open & Active', projectName });
    if (updatedFile) {
      console.log(`Updated status to Open & Active in: ${updatedFile}`);
    }
    console.log(`✅ Reopened design doc "${slug}".`);
    console.log(`Note: Doc status is automatically recomputed on subsequent task writes.\n`);
  }
}
