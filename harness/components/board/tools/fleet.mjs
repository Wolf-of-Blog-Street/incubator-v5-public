#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRoster, validateAgentId } from '../engine/roster.mjs';
import { autoLoadFalconEnv } from './client.mjs';

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

function findRosterPath() {
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

function findBoardsDir(rosterPath) {
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

function resolveRosterConfig(flags) {
  if (process.env.FALCON_ENV_LOADED !== '1') {
    autoLoadFalconEnv();
  }
  const rosterPath = flags.roster || findRosterPath();
  const boardsDir = flags['boards-dir'] || findBoardsDir(rosterPath);
  const operatorToken = flags.token || process.env.FALCON_OPERATOR_TOKEN || null;
  return { rosterPath, boardsDir, operatorToken };
}

function resolveRemoteClient(flags) {
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

async function loadInstaller() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, '../../harness/tools/install.mjs'),
    path.resolve(currentDir, '../harness/tools/install.mjs'),
    path.resolve(currentDir, '../../../components/harness/tools/install.mjs'),
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

function printHelp() {
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

  // ==========================================
  // Remote Mode (Delegates to REST Admin API)
  // ==========================================
  if (remote) {
    try {
      switch (command) {
        case 'list': {
          const data = await remote.request('/api/v1/roster', 'GET');
          if (parsed.flags.json) {
            console.log(JSON.stringify(data, null, 2));
            return;
          }
          console.log(`\n🌐 Incubator v5 Fleet Roster (Remote: ${remote.cleanUrl})\n`);
          if (data.manager) {
            console.log(`🛡️  Manager: ${data.manager.agent_id} (${data.manager.role})`);
          }
          console.log(`Seats Online: ${data.agents.length}\n`);
          for (const ag of data.agents) {
            const defaultBadge = ag.isDefault ? ' [DEFAULT]' : '';
            console.log(`• ${ag.icon || '🤖'} ${ag.name} (${ag.id})${defaultBadge}`);
            console.log(`  Tags: ${ag.tags ? ag.tags.join(', ') : 'none'}`);
            console.log(`  Tasks: ${ag.stats.totalTasks} total | ${ag.stats.doneTasks} done (${ag.stats.progressPct}%) | ${ag.stats.openBugs} bugs`);
            if (ag.projects && ag.projects.length > 0) {
              console.log(`  Projects: ${ag.projects.map(p => p.id).join(', ')}`);
            }
            console.log('');
          }
          break;
        }

        case 'status': {
          const data = await remote.request('/api/v1/admin/fleet/status', 'GET');
          if (parsed.flags.json) {
            console.log(JSON.stringify(data, null, 2));
            return;
          }
          console.log(`\n🌐 Fleet Status: [${data.status.toUpperCase()}]`);
          console.log(`Manager: ${data.manager.agent_id} (${data.manager.role})`);
          console.log(`Total Agent Seats: ${data.totalAgents}`);
          console.log(`Total Projects:    ${data.totalProjects}`);
          console.log(`Tasks Completed:   ${data.totalDone} / ${data.totalTasks}`);
          console.log(`Active Bugs:       ${data.totalBugs}\n`);
          break;
        }

        case 'add': {
          const agentId = parsed._[1];
          if (!agentId) {
            console.error('Error: agent-id required. Example: fleet add example-pa --name "Example PA"');
            process.exit(1);
          }
          const projects = parsed.flags.projects
            ? parsed.flags.projects.split(',').map(p => ({ id: p.trim(), name: p.trim() }))
            : undefined;
          const tags = parsed.flags.tags
            ? parsed.flags.tags.split(',').map(t => t.trim())
            : undefined;

          const payload = {
            id: agentId,
            name: parsed.flags.name || agentId,
            icon: parsed.flags.icon || '🤖',
            color: parsed.flags.color || 'cyan',
            tags,
            projects
          };

          const res = await remote.request('/api/v1/admin/agents', 'POST', payload);
          if (parsed.flags.json) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }
          console.log(`\n✅ Registered new agent seat: ${res.agent.name} (${res.agent.id})`);
          if (res.token) {
            console.log(`🔑 Generated Secret Bearer Token: \x1b[32m${res.token}\x1b[0m`);
            console.log(`⚠️  Store this token safely in the agent's harness/falcon.env!\n`);
          }
          break;
        }

        case 'remove':
        case 'rm': {
          const agentId = parsed._[1];
          if (!agentId) {
            console.error('Error: agent-id required. Example: fleet remove example-pa');
            process.exit(1);
          }
          await remote.request(`/api/v1/admin/agents/${agentId}`, 'DELETE');
          console.log(`\n🗑️  Successfully revoked agent seat: ${agentId}\n`);
          break;
        }

        case 'token': {
          const agentId = parsed._[1];
          if (!agentId || !parsed.flags.rotate) {
            console.error('Error: specify agent-id and --rotate. Example: fleet token example-pa --rotate');
            process.exit(1);
          }
          const res = await remote.request(`/api/v1/admin/agents/${agentId}/token/rotate`, 'POST');
          if (parsed.flags.json) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }
          console.log(`\n🔄 Rotated Token for Agent: ${agentId}`);
          console.log(`🔑 New Secret Bearer Token: \x1b[32m${res.token}\x1b[0m`);
          console.log(`⚠️  Update this token immediately in the agent's harness/falcon.env!\n`);
          break;
        }

        case 'project': {
          const sub = parsed._[1];
          if (sub !== 'add') {
            console.error('Error: project subcommand required. Example: fleet project add example-pa telemetry-svc');
            process.exit(1);
          }
          const agentId = parsed._[2];
          const projId = parsed._[3];
          if (!agentId || !projId) {
            console.error('Error: agent-id and project-id required. Example: fleet project add example-pa telemetry-svc');
            process.exit(1);
          }
          const payload = {
            id: projId,
            name: parsed.flags.name || projId,
            board: `${agentId}.${projId}.sqlite`,
            docs_path: parsed.flags.docs || 'docs/design'
          };
          const res = await remote.request(`/api/v1/admin/agents/${agentId}/projects`, 'POST', payload);
          console.log(`\n✅ Allocated project "${projId}" to agent "${agentId}"\n`);
          break;
        }

        case 'verify': {
          const agentId = parsed._[1];
          if (!agentId) {
            console.error('Error: agent-id required. Example: fleet verify example-pa');
            process.exit(1);
          }
          const summary = await remote.request(`/api/v1/agents/${agentId}/board`, 'GET');
          console.log(`\n🔍 Verified agent "${agentId}":`);
          console.log(`Status: ONLINE (Board reachable)`);
          console.log(`Tasks: ${summary.totalTasks} total | ${summary.totalDone} done (${summary.overallProgress}%)\n`);
          break;
        }

        case 'provision': {
          const agentId = parsed._[1];
          if (!agentId) {
            console.error('Error: agent-id required. Example: fleet provision example-pa --target /path/to/seat');
            process.exit(1);
          }
          validateAgentId(agentId);

          const targetDir = parsed.flags.target ? path.resolve(parsed.flags.target) : path.resolve(agentId);
          const projects = parsed.flags.projects
            ? parsed.flags.projects.split(',').map(p => ({ id: p.trim(), name: p.trim() }))
            : [{ id: 'default', name: `${agentId} Workspace` }];
          const tags = parsed.flags.tags
            ? parsed.flags.tags.split(',').map(t => t.trim())
            : ['worker'];

          const payload = {
            id: agentId,
            name: parsed.flags.name || agentId,
            icon: parsed.flags.icon || '🤖',
            color: parsed.flags.color || 'cyan',
            tags,
            projects
          };

          let token;
          try {
            const regRes = await remote.request('/api/v1/admin/agents', 'POST', payload);
            token = regRes.token;
          } catch (err) {
            if (parsed.flags.force) {
              const rotRes = await remote.request(`/api/v1/admin/agents/${agentId}/token/rotate`, 'POST');
              token = rotRes.token;
            } else {
              throw err;
            }
          }

          const serverUrl = parsed.flags['server-url'] || remote.cleanUrl;
          const installer = await loadInstaller();
          installer.installHarness({
            agentHome: targetDir,
            initCards: parsed.flags['init-cards'] !== false,
            env: {
              FALCON_BOARD_URL: serverUrl,
              FALCON_BOARD_TOKEN: token,
              FALCON_AGENT_ID: agentId
            }
          });

          const summary = {
            status: 'provisioned',
            agentId,
            targetDir,
            serverUrl,
            tokenMasked: token ? token.slice(0, 12) + '...' + token.slice(-6) : 'configured'
          };

          if (parsed.flags.json) {
            console.log(JSON.stringify({ ...summary, token }, null, 2));
            return;
          }

          console.log(`\n🚀 Successfully provisioned agent seat "${agentId}"!`);
          console.log(`📂 Home Directory: ${targetDir}`);
          console.log(`🌐 Central Board:  ${serverUrl}`);
          console.log(`⚙️  Environment:    ${path.join(targetDir, 'harness/falcon.env')}`);
          if (token) {
            console.log(`🔑 Bearer Token:   \x1b[32m${token}\x1b[0m\n`);
          }
          break;
        }

        default:
          console.error(`Unknown command: "${command}". Run "fleet --help" for available commands.`);
          process.exit(1);
      }
      return;
    } catch (err) {
      console.error(`\n❌ Remote Fleet Error: ${err.message}\n`);
      process.exit(1);
    }
  }

  // ==========================================
  // Local Mode (Direct roster.json / SQLite)
  // ==========================================
  const { rosterPath, boardsDir, operatorToken } = resolveRosterConfig(parsed.flags);
  const roster = openRoster({ rosterPath, boardsDir, operatorToken });

  try {
    switch (command) {
      case 'list': {
        const agents = roster.listAgents();
        const manager = roster.getManager();
        if (parsed.flags.json) {
          console.log(JSON.stringify({ agents, manager }, null, 2));
          return;
        }
        console.log(`\n🌐 Incubator v5 Fleet Roster (Local: ${rosterPath})\n`);
        if (manager) {
          console.log(`🛡️  Manager: ${manager.agent_id} (${manager.role})`);
        }
        console.log(`Seats Online: ${agents.length}\n`);
        for (const ag of agents) {
          const defaultBadge = ag.isDefault ? ' [DEFAULT]' : '';
          console.log(`• ${ag.icon || '🤖'} ${ag.name} (${ag.id})${defaultBadge}`);
          console.log(`  Tags: ${ag.tags ? ag.tags.join(', ') : 'none'}`);
          console.log(`  Tasks: ${ag.stats.totalTasks} total | ${ag.stats.doneTasks} done (${ag.stats.progressPct}%) | ${ag.stats.openBugs} bugs`);
          if (ag.projects && ag.projects.length > 0) {
            console.log(`  Projects: ${ag.projects.map(p => p.id).join(', ')}`);
          }
          console.log('');
        }
        break;
      }

      case 'status': {
        const agents = roster.listAgents();
        const manager = roster.getManager();
        let totalProjects = 0;
        let totalTasks = 0;
        let totalDone = 0;
        let totalBugs = 0;

        for (const ag of agents) {
          totalProjects += ag.projects.length;
          totalTasks += ag.stats.totalTasks;
          totalDone += ag.stats.doneTasks;
          totalBugs += ag.stats.openBugs;
        }

        if (parsed.flags.json) {
          console.log(JSON.stringify({ manager, totalAgents: agents.length, totalProjects, totalTasks, totalDone, totalBugs }, null, 2));
          return;
        }
        console.log(`\n🌐 Fleet Status: [HEALTHY]`);
        console.log(`Manager: ${manager.agent_id} (${manager.role})`);
        console.log(`Total Agent Seats: ${agents.length}`);
        console.log(`Total Projects:    ${totalProjects}`);
        console.log(`Tasks Completed:   ${totalDone} / ${totalTasks}`);
        console.log(`Active Bugs:       ${totalBugs}\n`);
        break;
      }

      case 'add': {
        const agentId = parsed._[1];
        if (!agentId) {
          console.error('Error: agent-id required. Example: fleet add example-pa --name "Example PA"');
          process.exit(1);
        }
        validateAgentId(agentId);

        const projects = parsed.flags.projects
          ? parsed.flags.projects.split(',').map(p => ({ id: p.trim(), name: p.trim() }))
          : undefined;
        const tags = parsed.flags.tags
          ? parsed.flags.tags.split(',').map(t => t.trim())
          : undefined;

        const payload = {
          id: agentId,
          name: parsed.flags.name || agentId,
          icon: parsed.flags.icon || '🤖',
          color: parsed.flags.color || 'cyan',
          tags,
          projects
        };

        const result = roster.registerAgent(payload, true);
        if (parsed.flags.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(`\n✅ Registered new agent seat: ${result.agent.name} (${result.agent.id})`);
        if (result.token) {
          console.log(`🔑 Generated Secret Bearer Token: \x1b[32m${result.token}\x1b[0m`);
          console.log(`⚠️  Store this token safely in the agent's harness/falcon.env!\n`);
        }
        break;
      }

      case 'remove':
      case 'rm': {
        const agentId = parsed._[1];
        if (!agentId) {
          console.error('Error: agent-id required. Example: fleet remove example-pa');
          process.exit(1);
        }
        roster.revokeAgent(agentId);
        console.log(`\n🗑️  Successfully revoked agent seat: ${agentId}\n`);
        break;
      }

      case 'token': {
        const agentId = parsed._[1];
        if (!agentId || !parsed.flags.rotate) {
          console.error('Error: specify agent-id and --rotate. Example: fleet token example-pa --rotate');
          process.exit(1);
        }
        const rotated = roster.rotateAgentToken(agentId);
        if (parsed.flags.json) {
          console.log(JSON.stringify(rotated, null, 2));
          return;
        }
        console.log(`\n🔄 Rotated Token for Agent: ${agentId}`);
        console.log(`🔑 New Secret Bearer Token: \x1b[32m${rotated.token}\x1b[0m`);
        console.log(`⚠️  Update this token immediately in the agent's harness/falcon.env!\n`);
        break;
      }

      case 'project': {
        const sub = parsed._[1];
        if (sub !== 'add') {
          console.error('Error: project subcommand required. Example: fleet project add example-pa telemetry-svc');
          process.exit(1);
        }
        const agentId = parsed._[2];
        const projId = parsed._[3];
        if (!agentId || !projId) {
          console.error('Error: agent-id and project-id required. Example: fleet project add example-pa telemetry-svc');
          process.exit(1);
        }
        const payload = {
          id: projId,
          name: parsed.flags.name || projId,
          board: `${agentId}.${projId}.sqlite`,
          docs_path: parsed.flags.docs || 'docs/design'
        };
        const res = roster.allocateProject(agentId, payload);
        console.log(`\n✅ Allocated project "${res.name}" (${res.id}) to agent "${agentId}"\n`);
        break;
      }

      case 'verify': {
        const agentId = parsed._[1];
        if (!agentId) {
          console.error('Error: agent-id required. Example: fleet verify example-pa');
          process.exit(1);
        }
        const board = roster.getBoard(agentId);
        const summary = board.getBoardSummary();
        console.log(`\n🔍 Verified agent "${agentId}":`);
        console.log(`Status: ONLINE (Database valid)`);
        console.log(`Tasks: ${summary.totalTasks} total | ${summary.totalDone} done (${summary.overallProgress}%)\n`);
        break;
      }

      case 'provision': {
        const agentId = parsed._[1];
        if (!agentId) {
          console.error('Error: agent-id required. Example: fleet provision example-pa --target /path/to/seat');
          process.exit(1);
        }
        validateAgentId(agentId);

        const targetDir = parsed.flags.target ? path.resolve(parsed.flags.target) : path.resolve(agentId);
        const projects = parsed.flags.projects
          ? parsed.flags.projects.split(',').map(p => ({ id: p.trim(), name: p.trim() }))
          : [{ id: 'default', name: `${agentId} Workspace` }];
        const tags = parsed.flags.tags
          ? parsed.flags.tags.split(',').map(t => t.trim())
          : ['worker'];

        const payload = {
          id: agentId,
          name: parsed.flags.name || agentId,
          icon: parsed.flags.icon || '🤖',
          color: parsed.flags.color || 'cyan',
          tags,
          projects
        };

        let token;
        if (roster.hasAgent(agentId)) {
          if (!parsed.flags.force) {
            throw new Error(`Agent "${agentId}" is already registered. Use --force to rotate credentials and re-provision.`);
          }
          const rotated = roster.rotateAgentToken(agentId);
          token = rotated.token;
        } else {
          const regResult = roster.registerAgent(payload, true);
          token = regResult.token;
        }

        const serverUrl = parsed.flags['server-url'] || process.env.FALCON_BOARD_URL || 'http://localhost:3333';
        const installer = await loadInstaller();
        installer.installHarness({
          agentHome: targetDir,
          initCards: parsed.flags['init-cards'] !== false,
          env: {
            FALCON_BOARD_URL: serverUrl,
            FALCON_BOARD_TOKEN: token,
            FALCON_AGENT_ID: agentId
          }
        });

        const summary = {
          status: 'provisioned',
          agentId,
          targetDir,
          serverUrl,
          tokenMasked: token ? token.slice(0, 12) + '...' + token.slice(-6) : 'configured'
        };

        if (parsed.flags.json) {
          console.log(JSON.stringify({ ...summary, token }, null, 2));
          return;
        }

        console.log(`\n🚀 Successfully provisioned agent seat "${agentId}"!`);
        console.log(`📂 Home Directory: ${targetDir}`);
        console.log(`🌐 Central Board:  ${serverUrl}`);
        console.log(`⚙️  Environment:    ${path.join(targetDir, 'harness/falcon.env')}`);
        if (token) {
          console.log(`🔑 Bearer Token:   \x1b[32m${token}\x1b[0m\n`);
        }
        break;
      }

      default:
        console.error(`Unknown command: "${command}". Run "fleet --help" for available commands.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Fleet Error: ${err.message}\n`);
    process.exit(1);
  } finally {
    roster.closeAll();
  }
}

// Direct execution guard
const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectExecution) {
  runCli().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error(`\n❌ Fleet Error: ${err.message}\n`);
    process.exit(1);
  });
}
