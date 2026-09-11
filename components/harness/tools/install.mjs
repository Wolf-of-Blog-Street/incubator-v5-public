#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePackageVersion(sourceDir) {
  let dir = path.resolve(sourceDir);
  while (dir && dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.version) return pkg.version;
      } catch {}
    }
    const manifestPath = path.join(dir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (mf.harness_version) return mf.harness_version;
        if (mf.incubator_release) return mf.incubator_release.replace(/^v/, '');
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return 'unknown';
}

function resolveSourceRevision(sourceDir) {
  try {
    const out = execSync(`jj log -r @ -n 1 --no-graph -T 'if(empty, parents.map(|p| p.commit_id().shortest(8)).join(" "), commit_id.shortest(8))'`, {
      cwd: sourceDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim();
    if (out) return out;
  } catch {}

  try {
    const out = execSync('git rev-parse --short HEAD', {
      cwd: sourceDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim();
    if (out) return out;
  } catch {}

  let dir = path.resolve(sourceDir);
  while (dir && dir !== path.dirname(dir)) {
    const manifestPath = path.join(dir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (mf.source_revision) return mf.source_revision;
      } catch {}
    }
    dir = path.dirname(dir);
  }

  return 'unknown';
}

function resolveSources() {
  const devRoot = path.resolve(__dirname, '../../..');
  if (fs.existsSync(path.join(devRoot, 'components'))) {
    return {
      sourceDir: devRoot,
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
    sourceDir: harnessHome,
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
export async function installHarness({ agentHome, initCards = false, upgradeCards = false, env = null, roster = null, rosterPath = null }) {
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
      : `# Agent Entrypoint — Incubator v5\n\nWelcome to **Incubator v5**. You are an engineer pair programming with the operator.\n\n## Orientation & Workflow\n\nWhen starting a session or picking up work:\n\n1. **Check Context & The Board**:\n   - Inspect the board (\`node harness/components/board/tools/board.mjs list\`) to see active jobs.\n   - Check \`docs/design/INDEX.md\` to see proposals in flight. For non-trivial architectural changes, write or update a design proposal. For obvious work, small tweaks, or bug fixes, work directly or use a standalone job. Work is work.\n2. **Check Memory**: Read \`brain/__source/working-memory.md\` to ground yourself in recent decisions.\n3. **Master Manual**: Refer to [harness/HARNESS.md](harness/HARNESS.md) and [harness/HARNESS-custom.md](harness/HARNESS-custom.md) for tool usage, testing standards, and operator preferences.\n`;
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

  // 10. Write harness/manifest.json (Task #167)
  let seatId = env?.FALCON_AGENT_ID || null;
  const falconEnvPath = path.join(harnessDir, 'falcon.env');
  if (!seatId && fs.existsSync(falconEnvPath)) {
    try {
      const lines = fs.readFileSync(falconEnvPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('FALCON_AGENT_ID=')) {
          seatId = trimmed.slice('FALCON_AGENT_ID='.length).trim();
          break;
        }
      }
    } catch {}
  }
  if (!seatId) seatId = path.basename(resolvedHome);

  const harnessVersion = resolvePackageVersion(sources.sourceDir);
  const sourceRevision = resolveSourceRevision(sources.sourceDir);
  const manifestData = {
    harness_version: harnessVersion,
    source_revision: sourceRevision,
    installed_at: new Date().toISOString(),
    seat: seatId
  };

  const manifestPath = path.join(harnessDir, 'manifest.json');
  try {
    const lstat = fs.lstatSync(manifestPath);
    if (lstat.isSymbolicLink()) fs.unlinkSync(manifestPath);
  } catch {}
  fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2) + '\n', 'utf8');

  // 11. Update roster with harness_version (Task #167)
  if (roster && typeof roster.updateAgent === 'function') {
    try {
      roster.updateAgent(seatId, { harness_version: harnessVersion });
    } catch {}
  } else if (rosterPath && fs.existsSync(rosterPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
      if (Array.isArray(raw.agents)) {
        const ag = raw.agents.find(a => a.id === seatId);
        if (ag) {
          ag.harness_version = harnessVersion;
          fs.writeFileSync(rosterPath, JSON.stringify(raw, null, 2), 'utf8');
        }
      }
    } catch {}
  }

  let boardUrl = env?.FALCON_BOARD_URL || process.env.FALCON_BOARD_URL;
  let boardToken = env?.FALCON_BOARD_TOKEN || process.env.FALCON_BOARD_TOKEN;
  let targetAgentId = env?.FALCON_AGENT_ID || process.env.FALCON_AGENT_ID;

  if (fs.existsSync(falconEnvPath)) {
    try {
      const lines = fs.readFileSync(falconEnvPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [k, ...vParts] = trimmed.split('=');
        const v = vParts.join('=');
        if (k === 'FALCON_BOARD_URL' && !boardUrl) boardUrl = v;
        if (k === 'FALCON_BOARD_TOKEN' && !boardToken) boardToken = v;
        if (k === 'FALCON_AGENT_ID' && !targetAgentId) targetAgentId = v;
      }
    } catch {}
  }

  const effectiveAgentId = targetAgentId || seatId;
  if (boardUrl && boardToken && effectiveAgentId) {
    try {
      const endpoint = `${boardUrl.replace(/\/$/, '')}/api/v1/admin/agents/${effectiveAgentId}`;
      await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${boardToken}`
        },
        body: JSON.stringify({ harness_version: harnessVersion }),
        signal: AbortSignal.timeout(3000)
      });
    } catch {}
  }

  return { agentHome: resolvedHome, harnessDir, manifest: manifestData };
}

// CLI Mode
if (process.argv[1] === __filename) {
  const targetHome = path.resolve(process.argv[2] || '.');
  const initCards = process.argv.includes('--init-cards');
  const upgradeCards = process.argv.includes('--upgrade-cards') || process.argv.includes('--force-cards');

  await installHarness({ agentHome: targetHome, initCards, upgradeCards });
  console.log(`✅ Successfully installed Incubator v5 harness into: ${targetHome}/harness`);
}

