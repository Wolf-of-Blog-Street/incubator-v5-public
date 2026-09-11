/**
 * Handles task-level board commands: add, bug, set, and rm.
 */

/**
 * Adds a new task card to the board.
 * @param {Object} board Board database client instance
 * @param {Object} parsed Parsed CLI flags and arguments
 * @returns {Promise<void>}
 */
export async function handleTaskAdd(board, parsed) {
  const title = parsed._.slice(1).join(' ');
  if (!title) {
    console.error('Error: Task title is required. Example: board add "My task" --doc stage-1');
    process.exit(1);
  }
  const id = await board.addItem({
    title,
    design_slug: parsed.flags.doc || null,
    track: parsed.flags.track || 'core',
    details: parsed.flags.details || null,
    status: parsed.flags.status || 'planned',
    mode: parsed.flags.mode || 'pair',
  });
  console.log(`✅ Task #${id} created: "${title}" [${parsed.flags.track || 'core'} · ${parsed.flags.mode || 'pair'}]`);
}

/**
 * Adds a bug card to the board under the 'bug' track.
 * @param {Object} board Board database client instance
 * @param {Object} parsed Parsed CLI flags and arguments
 * @returns {Promise<void>}
 */
export async function handleBugAdd(board, parsed) {
  const title = parsed._.slice(1).join(' ');
  if (!title) {
    console.error('Error: Bug title is required. Example: board bug "Undefined payload crashes secret sanitizer" --doc v5-foundation');
    process.exit(1);
  }
  const id = await board.addItem({
    title: `BUG: ${title.replace(/^BUG:\s*/i, '')}`,
    design_slug: parsed.flags.doc || null,
    track: 'bug',
    details: parsed.flags.details || null,
    status: parsed.flags.status || 'planned',
    mode: parsed.flags.mode || 'pair',
  });
  console.log(`🐛 Bug #${id} logged: "${title}" [bug · ${parsed.flags.mode || 'pair'}]`);
}

/**
 * Updates task properties (status, mode, track, title, details).
 * @param {Object} board Board database client instance
 * @param {Object} parsed Parsed CLI flags and arguments
 * @returns {Promise<void>}
 */
export async function handleTaskSet(board, parsed) {
  const id = Number(parsed._[1]);
  if (!id) {
    console.error('Error: Task ID required. Example: board set 3 --status done');
    process.exit(1);
  }
  const updates = {};
  if (parsed.flags.status) updates.status = parsed.flags.status;
  if (parsed.flags.mode) updates.mode = parsed.flags.mode;
  if (parsed.flags.track) updates.track = parsed.flags.track;
  if (parsed.flags.doc !== undefined) updates.design_slug = parsed.flags.doc;
  if (parsed.flags.title) updates.title = parsed.flags.title;
  if (parsed.flags.details) updates.details = parsed.flags.details;

  const updated = await board.updateItem(id, updates);
  if (!updated) {
    console.error(`Task #${id} not found`);
    process.exit(1);
  }
  console.log(`Updated Task #${id}: [${updated.status.toUpperCase()}] "${updated.title}" (${updated.mode})`);
}

/**
 * Deletes a task card from the board.
 * @param {Object} board Board database client instance
 * @param {Object} parsed Parsed CLI flags and arguments
 * @returns {Promise<void>}
 */
export async function handleTaskRm(board, parsed) {
  const id = Number(parsed._[1]);
  if (!id) {
    console.error('Error: Task ID required. Example: board rm 3');
    process.exit(1);
  }
  const ok = await board.deleteItem(id);
  if (ok) {
    console.log(`🗑️ Deleted Task #${id}`);
  } else {
    console.log(`Task #${id} not found`);
  }
}
