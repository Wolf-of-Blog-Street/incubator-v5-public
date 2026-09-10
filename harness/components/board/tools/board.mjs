#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VALID_STATUSES, VALID_MODES } from '../engine/board.mjs';
import { createBoardClient } from './client.mjs';

const __filename = fileURLToPath(import.meta.url);

function findDefaultDb(projectName) {
  if (projectName) return path.resolve(`boards/${projectName}.sqlite`);
  if (process.env.BOARD_DB) return process.env.BOARD_DB;
  if (process.env.BOARD_PROJECT) return path.resolve(`boards/${process.env.BOARD_PROJECT}.sqlite`);
  return path.resolve('boards/project.sqlite');
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.flags[key] = argv[++i];
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const STATUS_ICONS = {
  planned: '⏳ PLANNED',
  'in-progress': '⚡ IN-PROGRESS',
  review: '🔍 REVIEW',
  done: '✅ DONE',
  blocked: '🛑 BLOCKED',
};

export async function runCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const command = parsed._[0] || 'list';
  const projectName = parsed.flags.project || process.env.BOARD_PROJECT || null;
  const url = parsed.flags.url || process.env.FALCON_BOARD_URL || null;
  const token = parsed.flags.token || process.env.FALCON_BOARD_TOKEN || null;
  const dbPath = parsed.flags.db || findDefaultDb(projectName);
  const agentId = parsed.flags.agent || process.env.FALCON_AGENT_ID || null;
  const isExplicitDb = Boolean(parsed.flags.db) && !parsed.flags.url;
  const board = createBoardClient({
    url: isExplicitDb ? null : url,
    token,
    dbPath,
    agentId,
    local: isExplicitDb
  });


  try {
    switch (command) {
      case 'add': {
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
        break;
      }

      case 'bug': {
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
        break;
      }

      case 'sync-doc': {
        const slug = parsed._[1] || parsed.flags.doc;
        if (!slug) {
          console.error('Error: Design doc slug is required. Example: board sync-doc falcon-manager-board-roster');
          process.exit(1);
        }
        const customFile = parsed.flags.file;
        let resolvedFile = null;
        if (customFile && fs.existsSync(customFile)) {
          resolvedFile = path.resolve(customFile);
        } else {
          const candidates = [
            path.resolve(`docs/design/${slug}.md`),
            path.resolve(`workspaces/${projectName || 'incubator-v5'}/docs/design/${slug}.md`),
            path.resolve(`../workspaces/${projectName || 'incubator-v5'}/docs/design/${slug}.md`),
            path.resolve(`design/${slug}.md`),
            path.resolve(`workspaces/incubator-v5-docs/design/${slug}.md`),
            path.resolve(`../incubator-v5-docs/design/${slug}.md`),
          ];
          for (const c of candidates) {
            if (fs.existsSync(c)) {
              resolvedFile = c;
              break;
            }
          }
        }
        if (!resolvedFile) {
          console.error(`Error: Could not find design doc file for slug "${slug}"`);
          process.exit(1);
        }
        await board.syncDoc(slug, resolvedFile);
        console.log(`📄 Synced design doc "${slug}" (${resolvedFile}) to Falcon Board`);
        break;
      }

      case 'close-doc':
      case 'finish-doc': {
        const slug = parsed._[1] || parsed.flags.doc;
        if (!slug) {
          console.error('Error: Design doc slug required. Example: board finish-doc v5-foundation');
          process.exit(1);
        }
        const force = Boolean(parsed.flags.force);
        const res = await board.closeDesignDoc(slug, { force });
        if (!res.closed) {
          console.error(`\n⚠️  ${res.error}\n`);
          console.log(`Open Tasks in "${slug}":`);
          for (const t of res.openTasks) {
            console.log(`  #${t.id} [${t.track}] (${t.status}) ${t.title}`);
          }
          console.log('');
          process.exit(1);
        } else {
          // Attempt to update doc frontmatter if doc file exists locally
          const docCandidates = [
            path.resolve(`docs/design/${slug}.md`),
            path.resolve(`workspaces/${projectName || 'incubator-v5'}/docs/design/${slug}.md`),
            path.resolve(`design/${slug}.md`),
            path.resolve(`workspaces/incubator-v5-docs/design/${slug}.md`),
          ];
          for (const cand of docCandidates) {
            if (fs.existsSync(cand)) {
              let text = fs.readFileSync(cand, 'utf8');
              const today = new Date().toISOString().slice(0, 10);
              if (/[-*]\s+\*\*Status\*\*:\s*[^\n\r]+/i.test(text)) {
                text = text.replace(/([-*]\s+\*\*Status\*\*:\s*)[^\n\r]+/i, '$1Finished');
              } else {
                text = text.replace(/^(#\s+[^\n\r]+\n)/m, '$1\n- **Status**: Finished\n');
              }
              if (/[-*]\s+\*\*Last Updated\*\*:\s*[^\n\r]+/i.test(text)) {
                text = text.replace(/([-*]\s+\*\*Last Updated\*\*:\s*)[^\n\r]+/i, `$1${today}`);
              }
              fs.writeFileSync(cand, text, 'utf8');
              console.log(`Updated status to Finished in: ${cand}`);
              break;
            }
          }
          console.log(`\n🎉 Design Doc "${slug}" is CLOSED! (Finished)`);
          console.log(`All ${res.total} task(s) completed (100%).\n`);
        }
        break;
      }

      case 'open-doc':
      case 'reopen-doc': {
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
          const docCandidates = [
            path.resolve(`docs/design/${slug}.md`),
            path.resolve(`workspaces/${projectName || 'incubator-v5'}/docs/design/${slug}.md`),
            path.resolve(`design/${slug}.md`),
            path.resolve(`workspaces/incubator-v5-docs/design/${slug}.md`),
          ];
          for (const cand of docCandidates) {
            if (fs.existsSync(cand)) {
              let text = fs.readFileSync(cand, 'utf8');
              const today = new Date().toISOString().slice(0, 10);
              if (/[-*]\s+\*\*Status\*\*:\s*[^\n\r]+/i.test(text)) {
                text = text.replace(/([-*]\s+\*\*Status\*\*:\s*)[^\n\r]+/i, '$1Active');
              } else {
                text = text.replace(/^(#\s+[^\n\r]+\n)/m, '$1\n- **Status**: Active\n');
              }
              if (/[-*]\s+\*\*Last Updated\*\*:\s*[^\n\r]+/i.test(text)) {
                text = text.replace(/([-*]\s+\*\*Last Updated\*\*:\s*)[^\n\r]+/i, `$1${today}`);
              }
              fs.writeFileSync(cand, text, 'utf8');
              console.log(`Updated status to Active in: ${cand}`);
              break;
            }
          }
          console.log(`✅ Reopened design doc "${slug}".`);
        }
        break;
      }

      case 'set': {
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
        console.log(`Updated Task #${id}: [${updated.status.toUpperCase()}] "${updated.title}" (${updated.mode})`);
        break;
      }

      case 'rm': {
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
        break;
      }

      case 'list': {
        const items = await board.listItems({
          design_slug: parsed.flags.doc,
          status: parsed.flags.status,
          mode: parsed.flags.mode,
          track: parsed.flags.track,
        });

        if (parsed.flags.json) {
          console.log(JSON.stringify(items, null, 2));
          break;
        }

        if (items.length === 0) {
          console.log('No tasks found on the board.');
          break;
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

        function resolveDocCodename(slug) {
          if (!slug || slug === 'Standalone') return '';
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
                const match = content.match(/[-*]\s+\*\*Codename\*\*:\s*([^\n\r]+)/i);
                if (match) return match[1].trim();
              } catch {}
            }
          }
          return '';
        }

        for (const [stage, stageItems] of Object.entries(grouped)) {
          const done = stageItems.filter((i) => i.status === 'done').length;
          const total = stageItems.length;
          const openBugs = stageItems.filter((i) => i.track === 'bug' && i.status !== 'done').length;
          const pct = Math.round((done / total) * 100);
          const bugBadge = openBugs > 0 ? ` · 🐛 ${openBugs} bug(s)` : '';
          const codename = resolveDocCodename(stage);
          const codenameStr = codename ? ` [${codename}]` : '';
          const stageHeader = stage === 'Standalone' ? 'Standalone & Ad-hoc' : `Stage / Design:${codenameStr} ${stage}`;
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
        break;
      }

      default:
        console.log(`
Incubator v5 Board CLI

Usage:
  board add <title> [--doc <slug>] [--track <track>] [--mode pair|runner] [--details <text>]
  board bug <title> [--doc <slug>] [--mode pair|runner] [--details <text>]
  board set <id> [--status <status>] [--mode pair|runner] [--track <track>] [--title <title>]
  board rm <id>
  board list [--doc <slug>] [--status <status>] [--mode pair|runner] [--track <track>] [--json]
  board sync-doc <slug> [--file <path>]
  board finish-doc <slug> [--force]
  board reopen-doc <slug>

Options:
  --url <url>    Remote board URL (default: $FALCON_BOARD_URL)
  --token <tok>  Remote board Bearer token (default: $FALCON_BOARD_TOKEN)
  --agent <id>   Target agent ID (default: $FALCON_AGENT_ID)
  --db <path>    Local SQLite file path (default: boards/project.sqlite or $BOARD_DB)
  --doc <slug>   Parent design doc slug (e.g. page-structure)
  --track <name> Track (e.g. core, feature, bug, frontend, backend, api, ux, db, infra, docs, test, perf)
  --mode <mode>  Execution mode (pair | runner)
  --status <s>   Task status (${VALID_STATUSES.join(', ')})
        `);
        break;
    }
  } finally {
    board.close();
  }
}

const isDirectExecution = process.argv[1] && (
  process.argv[1] === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__filename) ||
  (fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename))
);

if (isDirectExecution) {
  runCli().catch((err) => {
    console.error(`\n❌ Board Error: ${err.message}\n`);
    process.exit(1);
  });
}
