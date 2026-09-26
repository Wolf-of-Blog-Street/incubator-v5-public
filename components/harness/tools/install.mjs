#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
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
      harnessDir: path.join(devRoot, 'components/harness'),
      viewersDir: path.join(devRoot, 'components/viewers'),
      chatDir: path.join(devRoot, 'components/chat'),
      componentsDir: path.join(devRoot, 'components'),
      skillsDirs: [path.join(devRoot, 'components/harness/skills'), path.join(devRoot, 'components/brain/skills')]
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
    harnessDir: path.join(harnessHome, 'components/harness'),
    viewersDir: path.join(harnessHome, 'components/viewers'),
    chatDir: path.join(harnessHome, 'components/chat'),
    componentsDir: path.join(harnessHome, 'components'),
    skillsDirs: [path.join(harnessHome, 'components/harness/skills'), path.join(harnessHome, 'components/brain/skills')]
  };
}

/**
 * Installs or upgrades the Incubator v5 harness in an agent home directory.
 * @param {Object} options
 * @param {string} options.agentHome - Absolute path to the agent home directory
 * @param {boolean} [options.initCards] - Whether to create entry AGENTS.md / CLAUDE.md cards
 * @param {Object} [options.env] - Optional key-value pairs for harness/falcon.env
 */
export async function installHarness({ agentHome, initCards = false, upgradeCards = false, pm = false, env = null, roster = null, rosterPath = null }) {
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

  // No-clobber install (v5.7.7): harness/manifest.json remembers the hash of every file the
  // installer shipped. A file a seat has edited since (hash differs from what was shipped) is
  // kept; the new shipped version lands beside it as <file>.shipped and the manifest lists it.
  const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const priorManifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(harnessDir, 'manifest.json'), 'utf8')); } catch { return {}; } })();
  const priorFiles = priorManifest.files && typeof priorManifest.files === 'object' ? priorManifest.files : {};
  const shippedFiles = {};
  const keptLocal = [];
  function walk(dir, rel = '') {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
      else if (e.isFile()) out.push(r);
    }
    return out;
  }
  function guardedCopyDir(src, dest, key) {
    if (!fs.existsSync(src)) return;
    const resolvedSrc = path.resolve(src);
    const resolvedDest = path.resolve(dest);
    if (resolvedSrc === resolvedDest || resolvedDest.startsWith(resolvedSrc + path.sep)) return;
    try { if (fs.lstatSync(resolvedDest).isSymbolicLink()) fs.unlinkSync(resolvedDest); } catch {}
    for (const rel of walk(resolvedSrc)) {
      const from = path.join(resolvedSrc, rel);
      const to = path.join(resolvedDest, rel);
      const manifestKey = `${key}/${rel}`;
      const srcHash = sha(from);
      shippedFiles[manifestKey] = srcHash;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(to)) {
        const localHash = sha(to);
        const recorded = priorFiles[manifestKey];
        if (recorded && localHash !== recorded && localHash !== srcHash) {
          // Locally modified since it was shipped: keep it, put the new version beside it.
          fs.copyFileSync(from, `${to}.shipped`);
          keptLocal.push(manifestKey);
          continue;
        }
      }
      fs.copyFileSync(from, to);
      const stale = `${to}.shipped`;
      if (fs.existsSync(stale)) fs.unlinkSync(stale);
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

  guardedCopyDir(sources.docsDir, path.join(harnessComponentsDir, 'docs'), 'components/docs');
  guardedCopyDir(sources.brainDir, path.join(harnessComponentsDir, 'brain'), 'components/brain');
  guardedCopyDir(sources.boardDir, path.join(harnessComponentsDir, 'board'), 'components/board');
  guardedCopyDir(sources.sweeperDir, path.join(harnessComponentsDir, 'sweeper'), 'components/sweeper');
  guardedCopyDir(sources.friendsDir, path.join(harnessComponentsDir, 'friends'), 'components/friends');
  guardedCopyDir(sources.harnessDir, path.join(harnessComponentsDir, 'harness'), 'components/harness');
  guardedCopyDir(sources.viewersDir, path.join(harnessComponentsDir, 'viewers'), 'components/viewers');
  guardedCopyDir(sources.chatDir, path.join(harnessComponentsDir, 'chat'), 'components/chat');
  // components.json marks each component fleet (every seat) or pm (the PM seat only, installed with --pm).
  // Never on a fleet seat, never public: a pm component is dogfood.
  const scopes = (() => { try { return JSON.parse(fs.readFileSync(path.join(sources.componentsDir, 'components.json'), 'utf8')); } catch { return {}; } })();
  safeCopyFile(path.join(sources.componentsDir, 'components.json'), path.join(harnessComponentsDir, 'components.json'));
  const pmComponents = pm ? Object.keys(scopes).filter(c => scopes[c] === 'pm' && fs.existsSync(path.join(sources.componentsDir, c))) : [];
  for (const c of pmComponents) {
    guardedCopyDir(path.join(sources.componentsDir, c), path.join(harnessComponentsDir, c), `components/${c}`);
    sources.skillsDirs = [...(sources.skillsDirs || []), path.join(sources.componentsDir, c, 'skills')];
  }
  // The viewers skill calls harness/tools/viewers/render.mjs; ship the renderer there too.
  guardedCopyDir(sources.viewersDir, path.join(harnessDir, 'tools', 'viewers'), 'tools/viewers');
  if (keptLocal.length) {
    console.warn(`⚠ kept ${keptLocal.length} locally modified file(s); the shipped version sits beside each as .shipped:`);
    for (const k of keptLocal) console.warn(`   harness/${k}`);
  }

  // 4b. Install default skills into every CLI's project skill dir.
  // .claude/skills is read by Claude Code; .agents/skills is the shared convention read by Codex, OpenCode and agy.
  // Harness-shipped skills are always overwritten; skills the seat added itself are left alone.
  const skillTargets = ['.claude/skills', '.agents/skills'];
  const installedSkills = [];
  for (const skillsSrc of (sources.skillsDirs || [])) {
    if (!fs.existsSync(skillsSrc)) continue;
    for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
      if (!entry.isDirectory() || !fs.existsSync(path.join(skillsSrc, entry.name, 'SKILL.md'))) continue;
      for (const target of skillTargets) {
        safeCopyDir(path.join(skillsSrc, entry.name), path.join(resolvedHome, target, entry.name));
      }
      installedSkills.push(entry.name);
      // A skill may ship data: <skill>/voice-pack/*.md lands in <seat>/data/opus-writer/voice-pack/
      const packSrc = path.join(skillsSrc, entry.name, 'voice-pack');
      if (fs.existsSync(packSrc)) {
        const packDest = path.join(resolvedHome, 'data/opus-writer/voice-pack');
        fs.mkdirSync(packDest, { recursive: true });
        for (const f of fs.readdirSync(packSrc)) {
          if (f.endsWith('.md')) safeCopyFile(path.join(packSrc, f), path.join(packDest, f));
        }
      }
    }
  }

  // 5. Initialize brain store if not already present (Task #53: check __source instead of parent)
  const brainDir = path.join(resolvedHome, 'brain');
  const brainSourceDir = path.join(brainDir, '__source');
  if (!fs.existsSync(brainSourceDir)) {
    fs.mkdirSync(brainSourceDir, { recursive: true });
  }
  // Every seat has a default working-memory card: it serves when no context is loaded, so an
  // agent is never forced to load one. Seeded once, never overwritten; Opus rewrites it later.
  const defaultWm = path.join(brainSourceDir, 'working-memory.md');
  if (!fs.existsSync(defaultWm)) {
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(defaultWm, [
      '---',
      'entity: note',
      'description: Default working memory (serves when no context is loaded)',
      `date_created: ${today}`,
      '---',
      '## State of play',
      'Nothing recorded yet. This card serves when no context is loaded.',
      '',
      '## Next actions',
      '1. Read the seat\'s roster notes: node harness/components/board/tools/fleet.mjs notes <seat>',
      '2. When a duty is clear, mint a context for it with the context-load skill; otherwise work here.',
      ''
    ].join('\n'), 'utf8');
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

  // 8a. The fleet chat block in every card that exists: added once, replaced on each install, the rest of the card untouched.
  {
    const blockPath = path.join(path.dirname(sources.cardTemplate), 'chat-card-block.md');
    const block = fs.existsSync(blockPath) ? fs.readFileSync(blockPath, 'utf8').trim() : null;
    const re = /<!-- incubator:chat[\s\S]*?<!-- \/incubator:chat -->/;
    for (const card of block ? ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] : []) {
      const cardPath = path.join(resolvedHome, card);
      if (!fs.existsSync(cardPath)) continue;
      const text = fs.readFileSync(cardPath, 'utf8');
      const next = re.test(text) ? text.replace(re, block) : `${text.replace(/\s*$/, '')}\n\n${block}\n`;
      if (next !== text) fs.writeFileSync(cardPath, next, 'utf8');
    }
  }

  // 8b. SessionStart hook: merge into <seat>/.claude/settings.json, keep every other key.
  // Idempotent: the hook is recognised by its command string; a seat's own hooks stay.
  {
    const settingsPath = path.join(resolvedHome, '.claude', 'settings.json');
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
    if (!settings || typeof settings !== 'object') settings = {};
    const hookCmd = 'node harness/components/brain/tools/session-start.mjs';
    settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
    const list = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
    // compact too: a session that auto-compacts gets its brain and working memory back.
    const matcher = 'startup|resume|clear|compact';
    const mine = list.find(entry => (entry.hooks || []).some(h => h.command === hookCmd));
    if (mine) mine.matcher = matcher;
    else list.push({ matcher, hooks: [{ type: 'command', command: hookCmd, timeout: 60 }] });
    settings.hooks.SessionStart = list;
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
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
    pm_components: pmComponents,
    source_revision: sourceRevision,
    installed_at: new Date().toISOString(),
    seat: seatId,
    skills: installedSkills,
    files: shippedFiles,
    kept_local: keptLocal
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
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('usage: node install.mjs <seat folder> [--pm] [--init-cards] [--upgrade-cards]\n  --pm  also install pm components (components.json): the PM seat only');
    process.exit(0);
  }
  // The target is the first argument that is not a flag: "--help" or "--pm" is never a folder.
  const targetHome = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-')) || '.');
  const initCards = process.argv.includes('--init-cards');
  const upgradeCards = process.argv.includes('--upgrade-cards') || process.argv.includes('--force-cards');
  const pm = process.argv.includes('--pm');

  await installHarness({ agentHome: targetHome, initCards, upgradeCards, pm });
  console.log(`✅ Successfully installed Incubator v5 harness into: ${targetHome}/harness`);
}

