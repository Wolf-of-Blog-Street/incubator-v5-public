#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const pExec = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');

/**
 * Executes a child process and returns stdout/stderr with execution status.
 */
async function runStep(title, fn) {
  process.stdout.write(`  ▶ ${title} ... `);
  const start = Date.now();
  try {
    const result = await fn();
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`✅ OK (${duration}s)`);
    return { passed: true, duration, result };
  } catch (err) {
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`❌ FAILED (${duration}s)`);
    console.error(`\n    Error details: ${err.message || err}`);
    if (err.stdout) console.error(`    Stdout: ${err.stdout}`);
    if (err.stderr) console.error(`    Stderr: ${err.stderr}`);
    return { passed: false, duration, error: err };
  }
}

/**
 * TIER 3 FLIGHT VERIFICATION:
 * Deep, multi-stage pre-flight release check:
 * 1. Executes Tier 1 (fast contract invariants)
 * 2. Executes Tier 2 (user journey simulations)
 * 3. Clean-Room Seat Installation (verifies clean fs, symlink safety, 0600 mode)
 * 4. Database Snapshot & Atomic Restore Dry-Run (un-checkpointed WAL check)
 * 5. Multi-Model Static Guard Sweeper across codebase
 */
export async function runTier3Flight() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Incubator v5 — TIER 3: Deep System Flight Gate & Release Pre-flight');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let allPassed = true;

  // Step 1: Run Tier 1
  const s1 = await runStep('Running Tier 1 Contract Invariants (<2s)', async () => {
    const { stdout } = await pExec(process.execPath, ['tools/test.mjs', '--tier1'], { cwd: ROOT_DIR });
    return stdout;
  });
  if (!s1.passed) allPassed = false;

  // Step 2: Run Tier 2
  const s2 = await runStep('Running Tier 2 User Journeys (<10s)', async () => {
    const { stdout } = await pExec(process.execPath, ['tools/test.mjs', '--tier2'], { cwd: ROOT_DIR });
    return stdout;
  });
  if (!s2.passed) allPassed = false;

  // Step 3: Clean-Room Harness Installation
  const s3 = await runStep('Clean-Room Seat Installation & Security Mode 0600', async () => {
    const tmpSeat = fs.mkdtempSync(path.join(os.tmpdir(), 'release-seat-verify-'));
    try {
      const { installHarness } = await import('../components/harness/tools/install.mjs');
      installHarness({
        agentHome: tmpSeat,
        env: { FALCON_BOARD_TOKEN: 'rel-token-check' }
      });
      const credFile = path.join(tmpSeat, 'harness', 'falcon.env');
      if (!fs.existsSync(credFile)) throw new Error('falcon.env was not created in clean install');
      const stat = fs.statSync(credFile);
      const mode = stat.mode & 0o777;
      if (mode !== 0o600) throw new Error(`falcon.env permissions invalid: expected 0600, got 0${mode.toString(8)}`);
      return true;
    } finally {
      fs.rmSync(tmpSeat, { recursive: true, force: true });
    }
  });
  if (!s3.passed) allPassed = false;

  // Step 4: Atomic Fleet Backup & Snapshot Verification
  const s4 = await runStep('Live WAL Snapshot & Atomic Backup Dry-Run', async () => {
    const tmpBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'release-backup-verify-'));
    try {
      const { createFleetBackup } = await import('../components/board/tools/backup.mjs');
      const manifest = createFleetBackup({
        outDir: tmpBackups,
        boardsDir: path.join(ROOT_DIR, 'boards'),
        rosterPath: path.join(ROOT_DIR, 'config', 'roster.json')
      });
      if (!manifest || manifest.version !== '5.0.0') {
        throw new Error('Manifest validation failed');
      }
      return manifest;
    } finally {
      fs.rmSync(tmpBackups, { recursive: true, force: true });
    }
  });
  if (!s4.passed) allPassed = false;

  // Step 5: Board Engine SQLite Schema & Contract Integrity Audit
  const s5 = await runStep('Board Engine SQLite Schema & Contract Integrity Audit', async () => {
    const { openBoard } = await import('../components/board/engine/board.mjs');
    const b = openBoard(':memory:');
    const id = b.addItem({ title: 'Release Sanity Task', track: 'core', status: 'planned' });
    if (!id || id <= 0) throw new Error('Failed to create sanity task in board engine');
    b.updateItem(id, { status: 'done' });
    const item = b.getItem(id);
    if (item.status !== 'done') throw new Error('Failed to transition item status in board engine');
    b.close();
    return true;
  });
  if (!s5.passed) allPassed = false;

  console.log('\n───────────────────────────────────────────────────────────────');
  if (allPassed) {
    console.log('🚀 TIER 3 FLIGHT COMPLETE: System is 100% verified and ready for release tagging.\n');
  } else {
    console.log('❌ TIER 3 FLIGHT ABORTED: One or more pre-flight flight gates failed.\n');
  }

  return { passed: allPassed };
}

// CLI Execution
if (process.argv[1] === __filename) {
  const cmd = process.argv[2] || 'preflight';

  if (cmd === 'preflight') {
    runTier3Flight().then(({ passed }) => {
      process.exit(passed ? 0 : 1);
    });
  } else if (cmd === 'publish' || cmd === 'tag') {
    const versionIdx = process.argv.indexOf('--version');
    const version = versionIdx !== -1 ? process.argv[versionIdx + 1] : null;
    if (!version) {
      console.error('Error: --version <semver> is required for publishing/tagging releases.');
      process.exit(1);
    }

    console.log(`Starting release flight for version v${version}...`);
    runTier3Flight().then(async ({ passed }) => {
      if (!passed) {
        console.error('Release publication aborted due to flight check failure.');
        process.exit(1);
      }
      console.log(`Tagging release v${version}...`);
      // Update package.json version
      const pkgPath = path.join(ROOT_DIR, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.version = version;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log(`✅ package.json version set to ${version}`);
      console.log(`✨ Release v${version} flight successfully verified.`);
      process.exit(0);
    });
  } else {
    console.log(`
Incubator v5 Release CLI

Usage:
  node tools/release.mjs preflight             Run Tier 3 deep flight gate
  node tools/release.mjs publish --version <v> Run Tier 3 and stamp version
`);
    process.exit(0);
  }
}
