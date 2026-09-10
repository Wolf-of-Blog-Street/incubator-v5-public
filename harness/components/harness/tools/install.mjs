#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveSources() {
  const devRoot = path.resolve(__dirname, '../../..');
  if (fs.existsSync(path.join(devRoot, 'components'))) {
    return {
      harnessTemplate: path.join(devRoot, 'components/harness/templates/HARNESS.md.template'),
      customTemplate: path.join(devRoot, 'components/harness/templates/HARNESS-custom.md.template'),
      cardTemplate: path.join(devRoot, 'components/harness/templates/AGENTS.md.template'),
      brainSrc: path.join(devRoot, 'components/brain/engine/brain.mjs'),
      docsDir: path.join(devRoot, 'components/docs'),
      brainDir: path.join(devRoot, 'components/brain'),
      boardDir: path.join(devRoot, 'components/board'),
      sweeperDir: path.join(devRoot, 'components/sweeper'),
      friendsDir: path.join(devRoot, 'components/friends'),
      harnessDir: path.join(devRoot, 'components/harness')
    };
  }

  // Running from an installed harness: <seat>/harness/components/harness/tools
  const harnessHome = path.resolve(__dirname, '../../..');
  return {
    harnessTemplate: path.join(harnessHome, 'HARNESS.md'),
    customTemplate: path.join(harnessHome, 'HARNESS-custom.md'),
    cardTemplate: path.join(harnessHome, 'components/harness/templates/AGENTS.md.template'),
    brainSrc: path.join(harnessHome, 'engine/brain.mjs'),
    docsDir: path.join(harnessHome, 'components/docs'),
    brainDir: path.join(harnessHome, 'components/brain'),
    boardDir: path.join(harnessHome, 'components/board'),
    sweeperDir: path.join(harnessHome, 'components/sweeper'),
    friendsDir: path.join(harnessHome, 'components/friends'),
    harnessDir: path.join(harnessHome, 'components/harness')
  };
}

/**
 * Installs or upgrades the Incubator v5 harness in an agent home directory.
 * @param {Object} options
 * @param {string} options.agentHome - Absolute path to the agent home directory
 * @param {boolean} [options.initCards] - Whether to create entry AGENTS.md / CLAUDE.md cards
 * @param {Object} [options.env] - Optional key-value pairs for harness/falcon.env
 */
export function installHarness({ agentHome, initCards = false, env = null }) {
  if (!agentHome) throw new Error('agentHome is required');

  const sources = resolveSources();
  const harnessDir = path.join(agentHome, 'harness');
  fs.mkdirSync(harnessDir, { recursive: true });

  // 1. Copy HARNESS.md (always overwrite with latest)
  const harnessDestPath = path.join(harnessDir, 'HARNESS.md');
  if (fs.existsSync(sources.harnessTemplate)) {
    fs.copyFileSync(sources.harnessTemplate, harnessDestPath);
  }

  // 2. Copy HARNESS-custom.md (NEVER overwrite if already exists)
  const customDestPath = path.join(harnessDir, 'HARNESS-custom.md');
  if (!fs.existsSync(customDestPath) && fs.existsSync(sources.customTemplate)) {
    fs.copyFileSync(sources.customTemplate, customDestPath);
  }

  // 3. Deploy engine (brain.mjs)
  const harnessEngineDir = path.join(harnessDir, 'engine');
  fs.mkdirSync(harnessEngineDir, { recursive: true });
  if (fs.existsSync(sources.brainSrc)) {
    const brainDest = path.join(harnessEngineDir, 'brain.mjs');
    fs.copyFileSync(sources.brainSrc, brainDest);
  }

  // 4. Deploy components into harness/components/
  const harnessComponentsDir = path.join(harnessDir, 'components');
  fs.mkdirSync(harnessComponentsDir, { recursive: true });

  // Copy docs component
  if (fs.existsSync(sources.docsDir)) {
    fs.cpSync(sources.docsDir, path.join(harnessComponentsDir, 'docs'), { recursive: true });
  }

  // Copy brain component (including skills)
  if (fs.existsSync(sources.brainDir)) {
    fs.cpSync(sources.brainDir, path.join(harnessComponentsDir, 'brain'), { recursive: true });
  }

  // Copy board component
  if (fs.existsSync(sources.boardDir)) {
    fs.cpSync(sources.boardDir, path.join(harnessComponentsDir, 'board'), { recursive: true });
  }

  // Copy sweeper component
  if (fs.existsSync(sources.sweeperDir)) {
    fs.cpSync(sources.sweeperDir, path.join(harnessComponentsDir, 'sweeper'), { recursive: true });
  }

  // Copy friends component
  if (fs.existsSync(sources.friendsDir)) {
    fs.cpSync(sources.friendsDir, path.join(harnessComponentsDir, 'friends'), { recursive: true });
  }

  // Copy harness component (for self-hosting & multi-agent provisioning)
  if (fs.existsSync(sources.harnessDir)) {
    fs.cpSync(sources.harnessDir, path.join(harnessComponentsDir, 'harness'), { recursive: true });
  }

  // 5. Initialize brain store if not already present
  const brainDir = path.join(agentHome, 'brain');
  const brainSourceDir = path.join(brainDir, '__source');
  if (!fs.existsSync(brainDir)) {
    fs.mkdirSync(brainSourceDir, { recursive: true });
  }

  // 6. Ensure boards directory exists
  const boardsDir = path.join(agentHome, 'boards');
  if (!fs.existsSync(boardsDir)) {
    fs.mkdirSync(boardsDir, { recursive: true });
  }

  // 7. Ensure work zones exist
  const projectsDir = path.join(agentHome, 'projects');
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }

  const workspacesDir = path.join(agentHome, 'workspaces');
  if (!fs.existsSync(workspacesDir)) {
    fs.mkdirSync(workspacesDir, { recursive: true });
  }

  // 8. Optionally write entry AGENTS.md / CLAUDE.md / GEMINI.md
  if (initCards) {
    const cardContent = fs.existsSync(sources.cardTemplate)
      ? fs.readFileSync(sources.cardTemplate, 'utf8')
      : `# Agent Entrypoint — Incubator v5\n\n1. **Read Master Harness Manual**: Read [harness/HARNESS.md](harness/HARNESS.md) to understand workspace topology, brain usage, board tracking, and available tools.\n2. **Read Custom Preferences**: Read [harness/HARNESS-custom.md](harness/HARNESS-custom.md) for custom operator preferences.\n`;
    for (const card of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
      const cardPath = path.join(agentHome, card);
      if (!fs.existsSync(cardPath)) {
        fs.writeFileSync(cardPath, cardContent, 'utf8');
      }
    }
  }

  // 9. Optionally write harness/falcon.env for remote fleet board connectivity
  if (env && typeof env === 'object') {
    const envLines = [
      '# Incubator v5 Agent Seat Environment',
      `# Generated by Fleet Orchestrator on ${new Date().toISOString()}`,
      ...Object.entries(env).map(([k, v]) => `${k}=${v || ''}`)
    ];
    fs.writeFileSync(path.join(harnessDir, 'falcon.env'), envLines.join('\n') + '\n', 'utf8');
  }

  return { agentHome, harnessDir };
}

// CLI Mode
if (process.argv[1] === __filename) {
  const targetHome = path.resolve(process.argv[2] || '.');
  const initCards = process.argv.includes('--init-cards');

  installHarness({ agentHome: targetHome, initCards });
  console.log(`✅ Successfully installed Incubator v5 harness into: ${targetHome}/harness`);
}
