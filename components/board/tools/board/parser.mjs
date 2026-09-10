import path from 'node:path';
import { VALID_STATUSES, VALID_TRACKS } from '../../engine/board.mjs';

export const STATUS_ICONS = {
  planned: '⏳ PLANNED',
  'in-progress': '⚡ IN-PROGRESS',
  review: '🔍 REVIEW',
  done: '✅ DONE',
  blocked: '🛑 BLOCKED',
};

const TRACK_ALIASES = {
  ui: 'ux',
  cli: 'infra',
  refactor: 'core',
  fix: 'bug',
};

export function normalizeTrack(candidate, defaultTrack = 'core') {
  if (!candidate) return VALID_TRACKS.includes(defaultTrack) ? defaultTrack : 'core';
  const lower = candidate.toLowerCase();
  if (VALID_TRACKS.includes(lower)) return lower;
  if (TRACK_ALIASES[lower] && VALID_TRACKS.includes(TRACK_ALIASES[lower])) return TRACK_ALIASES[lower];
  return VALID_TRACKS.includes(defaultTrack) ? defaultTrack : 'core';
}

export function findDefaultDb(projectName) {
  if (projectName) return path.resolve(`boards/${projectName}.sqlite`);
  if (process.env.BOARD_DB) return process.env.BOARD_DB;
  if (process.env.BOARD_PROJECT) return path.resolve(`boards/${process.env.BOARD_PROJECT}.sqlite`);
  return path.resolve('boards/project.sqlite');
}

export function parseArgs(argv) {
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

export function extractMilestonesFromDoc(content, defaultTrack = 'core') {
  const milestones = [];
  const lines = content.split('\n');
  let inMilestonesSection = false;
  let round = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+.*(?:Implementation Milestones|Implementation Checklist|Milestones)/i.test(line)) {
      inMilestonesSection = true;
      continue;
    }
    if (inMilestonesSection && /^##\s+[^#]/.test(line)) {
      break;
    }

    if (inMilestonesSection) {
      const roundMatch = line.match(/^###\s+Round\s+(\d+)/i);
      if (roundMatch) {
        round = Number(roundMatch[1]);
        continue;
      }
      const match = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (match) {
        const isDone = match[1].toLowerCase() === 'x';
        let rawTitle = match[2].trim();
        rawTitle = rawTitle.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '').trim();
        let track = normalizeTrack(defaultTrack, 'core');
        const trackMatch = rawTitle.match(/^\[([a-zA-Z0-9_\-]+)\]\s*/);
        if (trackMatch) {
          track = normalizeTrack(trackMatch[1], defaultTrack);
          rawTitle = rawTitle.slice(trackMatch[0].length).trim();
        }
        milestones.push({
          title: round > 1 ? `Round ${round} · ${rawTitle}` : rawTitle,
          round,
          track,
          status: isDone ? 'done' : 'planned'
        });
      }
    }
  }

  return milestones;
}

export function printHelp() {
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
}
