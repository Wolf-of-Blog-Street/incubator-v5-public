import path from 'node:path';
import { validateAgentId } from '../../engine/roster.mjs';
import { createProjectsStore } from '../../engine/projectsStore.mjs';
import { createWorkspaceScanner } from '../../engine/workspaceScanner.mjs';

/**
 * Handles fleet commands in Local Mode directly using roster.json and SQLite boards.
 */
export async function handleLocalCommand(command, parsed, roster, loadInstaller, rosterPath) {
  switch (command) {
    case 'projects':
    case 'project-catalog': {
      const sub = parsed._[1] || 'list';
      const projectsFilePath = parsed.flags['projects-file'] || (rosterPath ? path.resolve(path.dirname(rosterPath), 'projects.json') : path.resolve('config/projects.json'));
      const projectsStore = createProjectsStore({ filePath: projectsFilePath });
      const boardsDir = path.join(path.dirname(rosterPath), '../boards');
      const workspaceScanner = createWorkspaceScanner({
        searchRoots: [
          process.cwd(),
          path.resolve('..'),
          path.resolve('../..'),
          path.resolve('../../..'),
          boardsDir ? path.resolve(boardsDir, '..') : null,
          process.env.INCUBATOR_AGENTS_ROOT || null
        ].filter(Boolean)
      });

      if (sub === 'list') {
        const catalog = projectsStore.listProjects();
        const rosterAgents = roster.listAgents();
        const inventory = workspaceScanner.scanLiveInventory(catalog, rosterAgents);

        if (parsed.flags.json) {
          console.log(JSON.stringify(inventory, null, 2));
          return;
        }

        console.log(`\n📁 GitHub Projects Catalog & Live Inventory (Local: ${projectsFilePath})\n`);
        console.log(`Total Projects: ${inventory.stats.totalProjects} | Checked Out: ${inventory.stats.checkedOutProjects} | Unassigned: ${inventory.stats.unassignedProjects}\n`);

        for (const proj of inventory.projects) {
          console.log(`• 📁 ${proj.name} (${proj.id})`);
          console.log(`  URL: ${proj.github_url}`);
          if (proj.description) console.log(`  Description: ${proj.description}`);
          if (proj.tags && proj.tags.length > 0) console.log(`  Tags: ${proj.tags.join(', ')}`);
          if (proj.isCheckedOut && proj.checkedOutBy.length > 0) {
            const seats = proj.checkedOutBy.map(c => `${c.agentName} (${c.workspacePath || c.agentId})`).join(', ');
            console.log(`  Status: \x1b[32mChecked out\x1b[0m by ${seats}`);
          } else {
            console.log(`  Status: \x1b[33m⚠️  Not checked out by any agent\x1b[0m`);
          }
          console.log('');
        }
        break;
      }

      if (sub === 'add') {
        const url = parsed._[2];
        if (!url) {
          console.error('Error: GitHub URL required. Example: fleet project-catalog add https://github.com/org/repo --name "My Project"');
          process.exit(1);
        }
        const tags = parsed.flags.tags ? parsed.flags.tags.split(',').map(t => t.trim()) : [];
        const created = projectsStore.addProject({
          id: parsed.flags.id,
          name: parsed.flags.name,
          github_url: url,
          description: parsed.flags.desc || parsed.flags.description || '',
          tags
        });
        if (parsed.flags.json) {
          console.log(JSON.stringify(created, null, 2));
          return;
        }
        console.log(`\n✅ Registered project "${created.name}" (${created.id}) to catalog.`);
        console.log(`   URL: ${created.github_url}\n`);
        break;
      }

      if (sub === 'rm' || sub === 'remove') {
        const id = parsed._[2];
        if (!id) {
          console.error('Error: Project ID required. Example: fleet project-catalog rm repo-id');
          process.exit(1);
        }
        const ok = projectsStore.deleteProject(id);
        if (!ok) {
          throw new Error(`Project "${id}" not found in catalog`);
        }
        if (parsed.flags.json) {
          console.log(JSON.stringify({ removed: true, id }, null, 2));
          return;
        }
        console.log(`\n🗑️  Successfully removed project "${id}" from catalog.\n`);
        break;
      }

      if (sub === 'scan') {
        workspaceScanner.invalidateCache();
        const catalog = projectsStore.listProjects();
        const rosterAgents = roster.listAgents();
        const inventory = workspaceScanner.scanLiveInventory(catalog, rosterAgents);

        if (parsed.flags.json) {
          console.log(JSON.stringify(inventory.stats, null, 2));
          return;
        }
        console.log(`\n🔍 Scanned fleet agent workspaces across search roots:`);
        console.log(`   Total Projects:     ${inventory.stats.totalProjects}`);
        console.log(`   Checked Out:        ${inventory.stats.checkedOutProjects}`);
        console.log(`   Unassigned:         ${inventory.stats.unassignedProjects}`);
        console.log(`   Active Agent Seats: ${inventory.stats.activeAgentSeats}\n`);
        break;
      }

      console.error(`Unknown project-catalog subcommand: "${sub}". Available: list, add, rm, scan.`);
      process.exit(1);
    }

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
        console.log(`  Tags: ${ag.tags?.join(', ') ?? 'none'}`);
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
}
