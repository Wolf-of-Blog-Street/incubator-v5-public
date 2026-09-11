import path from 'node:path';
import { validateAgentId } from '../../engine/roster.mjs';

/**
 * Handles fleet commands in Remote Mode delegating to REST Admin API.
 */
export async function handleRemoteCommand(command, parsed, remote, loadInstaller) {
  switch (command) {
    case 'projects':
    case 'project-catalog': {
      const sub = parsed._[1] || 'list';

      if (sub === 'list') {
        const data = await remote.request('/api/v1/projects', 'GET');
        if (parsed.flags.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log(`\n📁 GitHub Projects Catalog & Live Inventory (Remote: ${remote.cleanUrl})\n`);
        console.log(`Total Projects: ${data.stats.totalProjects} | Checked Out: ${data.stats.checkedOutProjects} | Unassigned: ${data.stats.unassignedProjects}\n`);

        for (const proj of data.projects) {
          console.log(`• 📁 ${proj.name} (${proj.id})`);
          console.log(`  URL: ${proj.github_url}`);
          if (proj.description) console.log(`  Description: ${proj.description}`);
          if (proj.tags && proj.tags.length > 0) console.log(`  Tags: ${proj.tags.join(', ')}`);
          if (proj.isCheckedOut && proj.checkedOutBy && proj.checkedOutBy.length > 0) {
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
        const payload = {
          id: parsed.flags.id,
          name: parsed.flags.name,
          github_url: url,
          description: parsed.flags.desc || parsed.flags.description || '',
          tags
        };
        const data = await remote.request('/api/v1/projects', 'POST', payload);
        if (parsed.flags.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        console.log(`\n✅ Registered project "${data.project.name}" (${data.project.id}) to catalog.`);
        console.log(`   URL: ${data.project.github_url}\n`);
        break;
      }

      if (sub === 'rm' || sub === 'remove') {
        const id = parsed._[2];
        if (!id) {
          console.error('Error: Project ID required. Example: fleet project-catalog rm repo-id');
          process.exit(1);
        }
        const data = await remote.request(`/api/v1/projects/${id}`, 'DELETE');
        if (parsed.flags.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        console.log(`\n🗑️  Successfully removed project "${id}" from catalog.\n`);
        break;
      }

      if (sub === 'scan') {
        const data = await remote.request('/api/v1/projects/scan', 'POST');
        if (parsed.flags.json) {
          console.log(JSON.stringify(data.stats, null, 2));
          return;
        }
        console.log(`\n🔍 Scanned fleet agent workspaces across search roots:`);
        console.log(`   Total Projects:     ${data.stats.totalProjects}`);
        console.log(`   Checked Out:        ${data.stats.checkedOutProjects}`);
        console.log(`   Unassigned:         ${data.stats.unassignedProjects}`);
        console.log(`   Active Agent Seats: ${data.stats.activeAgentSeats}\n`);
        break;
      }

      console.error(`Unknown project-catalog subcommand: "${sub}". Available: list, add, rm, scan.`);
      process.exit(1);
    }

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
        const versionBadge = ag.harness_version ? ` [v${ag.harness_version}]` : '';
        console.log(`• ${ag.icon || '🤖'} ${ag.name} (${ag.id})${versionBadge}${defaultBadge}`);
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
      await remote.request(`/api/v1/admin/agents/${agentId}/projects`, 'POST', payload);
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
      await installer.installHarness({
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
