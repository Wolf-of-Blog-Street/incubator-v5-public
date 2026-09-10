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
export function installHarness({ agentHome, initCards = false, upgradeCards = false, env = null }) {
  if (!agentHome) throw new Error('agentHome is required');

  const resolvedHome = path.resolve(agentHome);
  const sources = resolveSources();
  const harnessDir = path.join(resolvedHome, 'harness');
  fs.mkdirSync(harnessDir, { recursive: true, mode: 0o700 });

  // Safe file copy helper that rejects destination symlinks (Task #50)
  function safeCopyFile(src, dest, options = {}) {
    if (!fs.existsSync(src)) return;
    try {
      const lstat = fs.lstatSync(dest);
      if (lstat.isSymbolicLink()) {
        fs.unlinkSync(dest);
      }
    } catch {
      // Destination does not exist yet
    }
    fs.copyFileSync(src, dest);
    if (options.mode) {
      try { fs.chmodSync(dest, options.mode); } catch {}
    }
  }

  // Safe directory copy helper that guards against self-referential copying (Task #52)
  function safeCopyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    const resolvedSrc = path.resolve(src);
    const resolvedDest = path.resolve(dest);
    if (resolvedSrc === resolvedDest || resolvedDest.startsWith(resolvedSrc + path.sep)) {
      // Avoid self-referential copy
      return;
    }
    // Reject destination if it is a symlink
    try {
      const lstat = fs.lstatSync(resolvedDest);
      if (lstat.isSymbolicLink()) {
        fs.unlinkSync(resolvedDest);
      }
    } catch {}
    fs.cpSync(resolvedSrc, resolvedDest, { recursive: true });
  }

  // 1. Copy HARNESS.md (always overwrite with latest, reject destination symlinks - Task #50)
  const harnessDestPath = path.join(harnessDir, 'HARNESS.md');
  safeCopyFile(sources.harnessTemplate, harnessDestPath);

  // 2. Copy HARNESS-custom.md (NEVER overwrite if already exists)
  const customDestPath = path.join(harnessDir, 'HARNESS-custom.md');
  if (!fs.existsSync(customDestPath) && fs.existsSync(sources.customTemplate)) {
    safeCopyFile(sources.customTemplate, customDestPath);
  }

  // 3. Deploy engine (brain.mjs)
  const harnessEngineDir = path.join(harnessDir, 'engine');
  fs.mkdirSync(harnessEngineDir, { recursive: true });
  const brainDest = path.join(harnessEngineDir, 'brain.mjs');
  safeCopyFile(sources.brainSrc, brainDest);

  // 4. Deploy components into harness/components/ (Task #52 self-referential check)
  const harnessComponentsDir = path.join(harnessDir, 'components');
  fs.mkdirSync(harnessComponentsDir, { recursive: true });

  safeCopyDir(sources.docsDir, path.join(harnessComponentsDir, 'docs'));
  safeCopyDir(sources.brainDir, path.join(harnessComponentsDir, 'brain'));
  safeCopyDir(sources.boardDir, path.join(harnessComponentsDir, 'board'));
  safeCopyDir(sources.sweeperDir, path.join(harnessComponentsDir, 'sweeper'));
  safeCopyDir(sources.friendsDir, path.join(harnessComponentsDir, 'friends'));
  safeCopyDir(sources.harnessDir, path.join(harnessComponentsDir, 'harness'));

  // 5. Initialize brain store if not already present (Task #53: check __source instead of parent)
  const brainDir = path.join(resolvedHome, 'brain');
  const brainSourceDir = path.join(brainDir, '__source');
  if (!fs.existsSync(brainSourceDir)) {
    fs.mkdirSync(brainSourceDir, { recursive: true });
  }

  // 6. Ensure boards directory exists
  const boardsDir = path.join(resolvedHome, 'boards');
  if (!fs.existsSync(boardsDir)) {
    fs.mkdirSync(boardsDir, { recursive: true });
  }

  // 7. Ensure work zones exist
  const projectsDir = path.join(resolvedHome, 'projects');
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }

  const workspacesDir = path.join(resolvedHome, 'workspaces');
  if (!fs.existsSync(workspacesDir)) {
    fs.mkdirSync(workspacesDir, { recursive: true });
  }

  // 8. Optionally write or upgrade entry AGENTS.md / CLAUDE.md / GEMINI.md
  if (initCards || upgradeCards) {
    const cardContent = fs.existsSync(sources.cardTemplate)
      ? fs.readFileSync(sources.cardTemplate, 'utf8')
      : `# Agent Entrypoint — Incubator v5\n\nYou are an autonomous engineering agent operating within the **Incubator v5** multi-agent platform.\n\n## ⚠️ Mandatory Bootstrap Protocol (Execute Before Any Planning or Code Changes)\n\nWhen you receive ANY user task, feature request, inquiry, or bug report, you must follow this strict sequence:\n\n1. **Step 1: Check the Board & Design Specs First (NO UNATTACHED WORK)**\n   - Query the project board (\`node harness/components/board/tools/board.mjs list\` or SQLite board in \`boards/\`) to inspect active epics and tasks.\n   - Inspect \`docs/design/INDEX.md\` to identify the governing living architectural blueprint (\`#d-X\`) for the affected subsystem.\n   - **Crucial Invariant**: NEVER formulate an implementation plan, write code, or execute tool changes without anchoring to a governing Design Doc and task on the board. If no design doc or task exists for the requested work, scaffold the design doc first or register a task before proceeding.\n\n2. **Step 2: Read Brain & Active Working Memory**\n   - Check your persistent brain memory (\`brain/__source/working-memory.md\` or \`node harness/engine/brain.mjs list\`) to ground yourself in the current state of play and recent operator decisions.\n\n3. **Step 3: Read Harness Rules & Preferences**\n   - Read [harness/HARNESS.md](harness/HARNESS.md) to understand workspace topology, tool usage, Google 3-tier testing standards, and execution pipelines (e.g., pair vs blitz).\n   - Read [harness/HARNESS-custom.md](harness/HARNESS-custom.md) for custom operator preferences.\n`;
    for (const card of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
      const cardPath = path.join(resolvedHome, card);
      if (upgradeCards || !fs.existsSync(cardPath)) {
        try {
          const lstat = fs.lstatSync(cardPath);
          if (lstat.isSymbolicLink()) fs.unlinkSync(cardPath);
        } catch {}
        fs.writeFileSync(cardPath, cardContent, 'utf8');
      }
    }
  }

  // 9. Optionally write harness/falcon.env with 0600 mode (Task #51)
  if (env && typeof env === 'object') {
    const envLines = [
      '# Incubator v5 Agent Seat Environment',
      `# Generated by Fleet Orchestrator on ${new Date().toISOString()}`,
      ...Object.entries(env).map(([k, v]) => `${k}=${v || ''}`)
    ];
    const envPath = path.join(harnessDir, 'falcon.env');
    try {
      const lstat = fs.lstatSync(envPath);
      if (lstat.isSymbolicLink()) fs.unlinkSync(envPath);
    } catch {}
    fs.writeFileSync(envPath, envLines.join('\n') + '\n', { mode: 0o600 });
    try { fs.chmodSync(envPath, 0o600); } catch {}
  }

  return { agentHome: resolvedHome, harnessDir };
}

// CLI Mode
if (process.argv[1] === __filename) {
  const targetHome = path.resolve(process.argv[2] || '.');
  const initCards = process.argv.includes('--init-cards');
  const upgradeCards = process.argv.includes('--upgrade-cards') || process.argv.includes('--force-cards');

  installHarness({ agentHome: targetHome, initCards, upgradeCards });
  console.log(`✅ Successfully installed Incubator v5 harness into: ${targetHome}/harness`);
}

