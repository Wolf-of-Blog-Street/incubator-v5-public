/**
 * Handles terminal listing and formatted report of project board tasks grouped by design doc.
 */
export async function handleList(board, parsed, STATUS_ICONS) {
  const showAll = Boolean(parsed.flags.all);
  const showClosed = showAll || Boolean(parsed.flags.closed);
  const showDone = showAll || Boolean(parsed.flags.done) || (parsed.flags.status === 'done');

  // Doc metadata (codename, lifecycle, state label) comes from the board, same as the API/web UI.
  const docMeta = {};
  try {
    const docs = await board.listDocs();
    for (const doc of docs) docMeta[doc.slug] = doc;
  } catch {}

  function isDocClosed(slug, stageItems = null) {
    if (!slug || slug.toLowerCase() === 'standalone') return false;
    const meta = docMeta[slug];
    if (meta) {
      if (
        meta.lifecycle === 'closed' ||
        meta.isFinished === true ||
        (typeof meta.status === 'string' && meta.status.toLowerCase() === 'closed') ||
        meta.taskStats?.lifecycle === 'closed'
      ) {
        return true;
      }
    }
    const items = stageItems || (allItems ? allItems.filter((i) => i.design_slug === slug) : []);
    if (items.length > 0 && items.every((i) => i.status === 'done')) {
      return true;
    }
    return false;
  }

  // Fetch full items matching doc/mode/track so per-doc progress headers stay accurate against the full set.
  const allItems = await board.listItems({
    design_slug: parsed.flags.doc,
    mode: parsed.flags.mode,
    track: parsed.flags.track,
  });

  const matchesFilter = (item) => {
    if (!showClosed && isDocClosed(item.design_slug)) return false;
    if (parsed.flags.status && parsed.flags.status !== 'all') {
      return item.status === parsed.flags.status;
    }
    if (!showDone && item.status === 'done') return false;
    return true;
  };

  if (parsed.flags.json) {
    const jsonItems = allItems.filter(matchesFilter);
    console.log(JSON.stringify(jsonItems, null, 2));
    return;
  }

  if (allItems.length === 0) {
    console.log('No tasks found on the board.');
    return;
  }

  // Group by design_slug
  const grouped = {};
  for (const item of allItems) {
    const key = item.design_slug || 'Standalone';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }

  let headerPrinted = false;

  for (const [stage, stageItems] of Object.entries(grouped)) {
    const isClosed = isDocClosed(stage);
    if (!showClosed && isClosed) continue;

    const visibleItems = stageItems.filter(matchesFilter);
    if (visibleItems.length === 0 && !parsed.flags.doc) continue;

    if (!headerPrinted) {
      console.log('\n📋 Incubator v5 Project Board');
      console.log('═'.repeat(78));
      headerPrinted = true;
    }

    const done = stageItems.filter((i) => i.status === 'done').length;
    const total = stageItems.length;
    const openBugs = stageItems.filter((i) => i.track === 'bug' && i.status !== 'done').length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    const bugBadge = openBugs > 0 ? ` · 🐛 ${openBugs} bug(s)` : '';
    const meta = docMeta[stage] || null;
    const codenameStr = meta?.codename ? ` [${meta.codename}]` : '';
    const hasActiveTasks = stageItems.some((i) => i.status === 'in-progress' || i.status === 'review' || i.status === 'planned');
    const allDone = total > 0 && done === total;
    const stateLabel = isClosed ? 'Closed' : (meta?.state_label || (allDone ? 'Closed' : `Open & ${hasActiveTasks ? 'Active' : 'Inactive'}`));
    const stateModelStr = stage === 'Standalone' ? '' : ` [${stateLabel}]`;
    const stageHeader = stage === 'Standalone' ? 'Standalone & Ad-hoc' : `Stage / Design:${codenameStr} ${stage}${stateModelStr}`;
    console.log(`\n📌 ${stageHeader} (${done}/${total} done · ${pct}%${bugBadge})`);
    console.log('─'.repeat(78));

    if (visibleItems.length === 0) {
      console.log('  (No open tasks. Use --done or --all to view completed tasks)');
    } else {
      for (const item of visibleItems) {
        const idStr = `#${item.id}`.padEnd(5);
        const isBug = item.track === 'bug';
        const trackStr = isBug ? `[🐛 bug]`.padEnd(10) : `[${item.track}]`.padEnd(10);
        const modeStr = `(${item.mode})`.padEnd(9);
        const statusStr = (STATUS_ICONS[item.status] || item.status).padEnd(16);
        console.log(`  ${idStr} ${trackStr} ${modeStr} ${statusStr} ${item.title}`);
      }
    }
  }

  if (!headerPrinted) {
    console.log('\nNo open tasks found on the board. (Use --all to show closed docs and completed tasks)\n');
  } else {
    console.log('\n' + '═'.repeat(78) + '\n');
  }
}
