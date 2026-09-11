import fs from 'node:fs';
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

/**
 * Traverses upward from startDir looking for an existing boards/ folder
 * or workspace boundaries (.git, config/roster.json, harness/HARNESS.md).
 * Prevents fragmented SQLite databases when commands are invoked in subdirectories.
 * @param {string} [startDir=process.cwd()]
 * @returns {string} Absolute path to resolved boards directory
 */
export function findBoardsDir(startDir = process.cwd()) {
  let curr = path.resolve(startDir);
  while (true) {
    const candidate = path.join(curr, 'boards');
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Ignore permission or stat errors
    }

    const isGit = fs.existsSync(path.join(curr, '.git'));
    const isRoster = fs.existsSync(path.join(curr, 'config/roster.json'));
    const isHarness = fs.existsSync(path.join(curr, 'harness/HARNESS.md'));
    if (isGit || isRoster || isHarness) {
      return path.join(curr, 'boards');
    }

    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve('boards');
}

export function findDefaultDb(projectName) {
  if (process.env.BOARD_DB) return path.resolve(process.env.BOARD_DB);
  const boardsDir = findBoardsDir();
  const name = projectName || process.env.BOARD_PROJECT || 'project';
  return path.join(boardsDir, `${name}.sqlite`);
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
  let currentMilestone = null;
  let currentBriefLines = [];

  function flushCurrentMilestone() {
    if (currentMilestone) {
      currentMilestone.brief = currentBriefLines.join('\n').trim();
      milestones.push(currentMilestone);
      currentMilestone = null;
      currentBriefLines = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+.*(?:Implementation Milestones|Implementation Checklist|Milestones)/i.test(line)) {
      inMilestonesSection = true;
      continue;
    }
    if (inMilestonesSection && /^##\s+[^#]/.test(line)) {
      flushCurrentMilestone();
      break;
    }

    if (inMilestonesSection) {
      if (/^###\s+Round\s+\d+/i.test(line)) {
        continue;
      }

      const match = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
      if (match) {
        flushCurrentMilestone();

        const isDone = match[1].toLowerCase() === 'x';
        let rawTitle = match[2].trim();
        rawTitle = rawTitle.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '').trim();
        let track = normalizeTrack(defaultTrack, 'core');
        const trackMatch = rawTitle.match(/^\[([a-zA-Z0-9_\-]+)\]\s*/);
        if (trackMatch) {
          track = normalizeTrack(trackMatch[1], defaultTrack);
          rawTitle = rawTitle.slice(trackMatch[0].length).trim();
        }

        currentMilestone = {
          title: rawTitle,
          round: 1,
          track,
          status: isDone ? 'done' : 'planned',
          brief: ''
        };
      } else if (currentMilestone) {
        if (/^\s+[-*]/.test(line) || (/^\s{2,}\S/.test(line) && !/^###?\s+/.test(line))) {
          const stripped = line.replace(/^ {2,4}/, '');
          currentBriefLines.push(stripped);
        } else if (line.trim() === '' && currentBriefLines.length > 0) {
          currentBriefLines.push('');
        }
      }
    }
  }

  flushCurrentMilestone();
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
  board list [--doc <slug>] [--status <status>] [--mode pair|runner] [--track <track>] [--all] [--closed] [--done] [--json]
  board sync-doc <slug> [--file <path>]
  board finish-doc <slug> [--force]
  board reopen-doc <slug>

Notes:
  A card is a job. A card without --doc is a standalone job.
  Design docs close and archive automatically when all attached jobs are Done.

Options:
  --url <url>    Remote board URL (default: $FALCON_BOARD_URL)
  --token <tok>  Remote board Bearer token (default: $FALCON_BOARD_TOKEN)
  --agent <id>   Target agent ID (default: $FALCON_AGENT_ID)
  --db <path>    Local SQLite file path (default: boards/project.sqlite or $BOARD_DB)
  --doc <slug>   Parent design doc slug (omit for standalone job)
  --track <name> Track (e.g. core, feature, bug, frontend, backend, api, ux, db, infra, docs, test, perf)
  --mode <mode>  Execution mode (pair | runner)
  --status <s>   Job status (${VALID_STATUSES.join(', ')})
  --all          Show all docs and tasks (including closed docs and done tasks)
  --closed       Include closed design docs
  --done         Include done tasks
  --json         Output raw JSON
  `);
}
