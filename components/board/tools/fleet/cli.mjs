import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRoster } from '../../engine/roster.mjs';
import { autoLoadFalconEnv } from '../client.mjs';
import { handleRemoteCommand } from './remoteCommands.mjs';
import { handleLocalCommand } from './localCommands.mjs';

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

export function findRosterPath() {
  if (process.env.FALCON_ROSTER_PATH && fs.existsSync(process.env.FALCON_ROSTER_PATH)) {
    return path.resolve(process.env.FALCON_ROSTER_PATH);
  }
  let curr = path.resolve(process.cwd());
  while (true) {
    const cand = path.join(curr, 'config/roster.json');
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve('config/roster.json');
}

export function findBoardsDir(rosterPath) {
  if (process.env.BOARDS_DIR && fs.existsSync(process.env.BOARDS_DIR)) {
    return path.resolve(process.env.BOARDS_DIR);
  }
  if (rosterPath && fs.existsSync(rosterPath)) {
    const cand = path.join(path.dirname(path.dirname(rosterPath)), 'boards');
    if (fs.existsSync(cand)) return cand;
  }
  let curr = path.resolve(process.cwd());
  while (true) {
    const cand = path.join(curr, 'boards');
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve('boards');
}

export function resolveRosterConfig(flags) {
  if (process.env.FALCON_ENV_LOADED !== '1') {
    autoLoadFalconEnv();
  }
  const rosterPath = flags.roster || findRosterPath();
  const boardsDir = flags['boards-dir'] || findBoardsDir(rosterPath);
  const operatorToken = flags.token || process.env.FALCON_OPERATOR_TOKEN || null;
  return { rosterPath, boardsDir, operatorToken };
}

export function resolveRemoteClient(flags) {
  if (flags.local || flags.roster || flags['boards-dir']) return null;
  if (process.env.FALCON_ENV_LOADED !== '1') {
    autoLoadFalconEnv();
  }
  const url = flags.url || process.env.FALCON_BOARD_URL || null;
  const token = flags.token || process.env.FALCON_OPERATOR_TOKEN || process.env.FALCON_AGENT_TOKEN || null;
  if (!url) return null;

  const cleanUrl = url.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', 'Connection': 'close' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  async function request(endpoint, method = 'GET', body = null) {
    const opts = { method, headers: { ...headers } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${cleanUrl}${endpoint}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status} from board server`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return { request, cleanUrl };
}

export async function loadInstaller() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, '../../../harness/tools/install.mjs'),
    path.resolve(currentDir, '../../harness/tools/install.mjs'),
    path.resolve(currentDir, '../harness/tools/install.mjs'),
    path.resolve(process.cwd(), 'components/harness/tools/install.mjs'),
    path.resolve(process.cwd(), 'harness/components/harness/tools/install.mjs')
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      return await import(cand);
    }
  }
  throw new Error('Could not locate Incubator v5 harness installer (install.mjs)');
}

export function printHelp() {
  console.log(`
🛡️  Incubator v5 Fleet Management CLI (fleet)

Usage:
  fleet <command> [arguments] [options]

Commands:
  list                          List all registered agents, project boards, and health metrics
  status                        Show aggregated fleet overview and manager status
  add <agent-id> [options]      Register a new agent seat and generate secure credentials
  provision <agent-id> [opts]   Automate full agent seat provisioning, harness install, & env injection
  remove <agent-id>             Decommission/revoke an agent seat
  token <agent-id> --rotate     Rotate agent Bearer token
  project add <agent-id> <id>   Allocate a new workspace project to an agent
  project-catalog [subcommand]  Manage GitHub project catalog & view seat inventory (list, add, rm, scan)
  verify <agent-id>             Verify connectivity and database integrity for an agent

Options:
  --target <path>               Target directory for provisioning an agent seat
  --server-url <url>            Central Board Server URL for harness/falcon.env
  --name <name>                 Human-readable display name for agent seat
  --icon <icon>                 Emoji or icon for agent seat (default: 🤖)
  --color <color>               Brand color (cyan, indigo, amber, red, green)
  --tags <tags>                 Comma-separated list of tags (e.g. "pair,architect")
  --projects <projects>         Comma-separated list of project IDs
  --init-cards                  Initialize AGENTS.md / CLAUDE.md / GEMINI.md cards (default: true)
  --force                       Force re-registration/credential rotation if agent already exists
  --json                        Output raw JSON
  --url <url>                   Remote Falcon Board Server URL (e.g. http://localhost:3333)
  --token <token>               Operator / Master Bearer token for remote administration
  --roster <path>               Path to roster.json (local mode)
  --boards-dir <path>           Base path to SQLite boards/ directory (local mode)
  --help                        Show this help text
`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const command = parsed._[0] || 'list';

  if (parsed.flags.help || command === 'help') {
    printHelp();
    return;
  }

  const remote = resolveRemoteClient(parsed.flags);

  if (remote) {
    try {
      await handleRemoteCommand(command, parsed, remote, loadInstaller);
      return;
    } catch (err) {
      console.error(`\n❌ Remote Fleet Error: ${err.message}\n`);
      process.exit(1);
    }
  }

  const { rosterPath, boardsDir, operatorToken } = resolveRosterConfig(parsed.flags);
  const roster = openRoster({ rosterPath, boardsDir, operatorToken });

  try {
    await handleLocalCommand(command, parsed, roster, loadInstaller, rosterPath);
  } catch (err) {
    console.error(`\n❌ Fleet Error: ${err.message}\n`);
    process.exit(1);
  } finally {
    roster.closeAll();
  }
}
