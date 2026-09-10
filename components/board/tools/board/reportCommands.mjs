import fs from 'node:fs';
import path from 'node:path';

function resolveDocMetadata(slug) {
  if (!slug || slug === 'Standalone') return { codename: '', status: '', isClosed: false, stateLabel: '' };
  const searchDirs = [
    path.resolve(process.cwd(), 'docs/design'),
    path.resolve(process.cwd(), 'workspaces/incubator-v5/docs/design'),
    path.resolve(process.cwd(), '../workspaces/incubator-v5/docs/design')
  ];
  for (const dir of searchDirs) {
    const file = path.join(dir, `${slug}.md`);
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const cMatch = content.match(/[-*]\s+\*\*Codename\*\*:\s*([^\n\r]+)/i);
        const sMatch = content.match(/[-*]\s+\*\*Status\*\*:\s*([^\n\r]+)/i);
        const status = sMatch ? sMatch[1].trim() : 'Draft';
        const isClosed = ['closed', 'archived', 'finished', 'done'].includes(status.toLowerCase());
        return {
          codename: cMatch ? cMatch[1].trim() : '',
          status,
          isClosed
        };
      } catch {}
    }
  }
  return { codename: '', status: '', isClosed: false };
}

/**
 * Handles terminal listing and formatted report of project board tasks grouped by design doc.
 */
export async function handleList(board, parsed, STATUS_ICONS) {
  const items = await board.listItems({
    design_slug: parsed.flags.doc,
    status: parsed.flags.status,
    mode: parsed.flags.mode,
    track: parsed.flags.track,
  });

  if (parsed.flags.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log('No tasks found on the board.');
    return;
  }

  // Group by design_slug
  const grouped = {};
  for (const item of items) {
    const key = item.design_slug || 'Standalone';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }

  console.log('\n📋 Incubator v5 Project Board');
  console.log('═'.repeat(78));

  for (const [stage, stageItems] of Object.entries(grouped)) {
    const done = stageItems.filter((i) => i.status === 'done').length;
    const total = stageItems.length;
    const openBugs = stageItems.filter((i) => i.track === 'bug' && i.status !== 'done').length;
    const pct = Math.round((done / total) * 100);
    const bugBadge = openBugs > 0 ? ` · 🐛 ${openBugs} bug(s)` : '';
    const meta = resolveDocMetadata(stage);
    const codenameStr = meta.codename ? ` [${meta.codename}]` : '';
    const hasActiveTasks = stageItems.some((i) => i.status === 'in-progress' || i.status === 'review' || i.status === 'planned');
    const execStateStr = hasActiveTasks ? 'Active' : 'Inactive';
    const lifecycleStr = meta.isClosed ? 'Closed' : 'Open';
    const stateModelStr = stage === 'Standalone' ? '' : ` [${lifecycleStr} & ${execStateStr}]`;
    const stageHeader = stage === 'Standalone' ? 'Standalone & Ad-hoc' : `Stage / Design:${codenameStr} ${stage}${stateModelStr}`;
    console.log(`\n📌 ${stageHeader} (${done}/${total} done · ${pct}%${bugBadge})`);
    console.log('─'.repeat(78));

    for (const item of stageItems) {
      const idStr = `#${item.id}`.padEnd(5);
      const isBug = item.track === 'bug';
      const trackStr = isBug ? `[🐛 bug]`.padEnd(10) : `[${item.track}]`.padEnd(10);
      const modeStr = `(${item.mode})`.padEnd(9);
      const statusStr = (STATUS_ICONS[item.status] || item.status).padEnd(16);
      console.log(`  ${idStr} ${trackStr} ${modeStr} ${statusStr} ${item.title}`);
    }
  }
  console.log('\n' + '═'.repeat(78) + '\n');
}
