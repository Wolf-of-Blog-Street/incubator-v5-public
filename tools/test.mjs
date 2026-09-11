#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');

// Parse flags
const args = process.argv.slice(2);
const isTier1 = args.includes('--tier1');
const isTier2 = args.includes('--tier2');
const isTier3 = args.includes('--tier3');
const isAll = args.includes('--all') || (!isTier1 && !isTier2 && !isTier3);
const componentFilter = args.find((a, i) => args[i - 1] === '--component');

/**
 * Manifest defining test suite classification across components.
 * Strictly adheres to Google Small (<2s, in-process) and Medium (<10s, local E2E).
 */
const TEST_REGISTRY = [
  // --- TIER 1: In-process Invariant & Contract Tests (<2.0s total) ---
  {
    tier: 1,
    name: 'board-contracts',
    component: 'board',
    path: 'components/board/tests/board.contract.test.mjs',
    desc: 'SQLite engine invariants, status state machines, agent ID sanitation & SHA-256 tokens'
  },
  {
    tier: 1,
    name: 'projects-store',
    component: 'board',
    path: 'components/board/tests/projects-store.test.mjs',
    desc: 'GitHub projects catalog CRUD, atomic persistence, URL normalizer & live workspace scanner'
  },
  {
    tier: 1,
    name: 'doc-lifecycle-autoclose',
    component: 'board',
    path: 'components/board/tests/doc-lifecycle-autoclose.test.mjs',
    desc: 'Design doc auto-close on all tasks done, archive move, index rewrite, reopen, and brief extraction'
  },
  {
    tier: 1,
    name: 'friends-sandbox',
    component: 'friends',
    path: 'components/friends/tests/sandbox.test.mjs',
    desc: 'Sub-agent environment sandboxing and zero-token leakage'
  },
  {
    tier: 1,
    name: 'friends-accounts',
    component: 'friends',
    path: 'components/friends/tests/accounts.test.mjs',
    desc: 'Credential encryption, masking, and account pool store contracts'
  },
  {
    tier: 1,
    name: 'friends-refresh',
    component: 'friends',
    path: 'components/friends/tests/refresh.test.mjs',
    desc: 'Token TTL detection and proactive refresh contracts'
  },
  {
    tier: 1,
    name: 'sweeper-contracts',
    component: 'sweeper',
    path: 'components/sweeper/tests/sweeper.test.mjs',
    desc: 'File scope resolver, ignore filters, and adversarial runner contracts'
  },
  {
    tier: 1,
    name: 'sweeper-stories',
    component: 'sweeper',
    path: 'components/sweeper/tests/story-sweeper.test.mjs',
    desc: 'Markdown design doc user story parsing and intent extraction'
  },
  {
    tier: 1,
    name: 'brain-contracts',
    component: 'brain',
    path: 'components/brain/tests/brain.test.mjs',
    desc: 'Brain markdown card storage and metadata schemas'
  },
  {
    tier: 1,
    name: 'docs-contracts',
    component: 'docs',
    path: 'components/docs/tests/scaffold.test.mjs',
    desc: 'Design doc template scaffolding and header validation'
  },

  // --- TIER 2: Component User Journey & Workflow Tests (<10.0s total) ---
  {
    tier: 2,
    name: 'board-user-journeys',
    component: 'board',
    path: 'components/board/tests/board.journey.test.mjs',
    desc: 'End-to-end multi-agent provisioning, doc sync, lifecycle guards & tenant isolation'
  },
  {
    tier: 2,
    name: 'board-wal-backup',
    component: 'board',
    path: 'components/board/tests/backup.test.mjs',
    desc: 'Live un-checkpointed WAL snapshot preservation and atomic restore'
  },
  {
    tier: 2,
    name: 'projects-api',
    component: 'board',
    path: 'components/board/tests/projects-api.test.mjs',
    desc: 'Projects catalog REST API routes, auth gating, CRUD and live inventory scan'
  },
  {
    tier: 2,
    name: 'friends-dispatch-journey',
    component: 'friends',
    path: 'components/friends/tests/dispatch-account.test.mjs',
    desc: 'Sandboxed Claude/Codex CLI dispatch with credential injection and custom config'
  },
  {
    tier: 2,
    name: 'harness-install-journey',
    component: 'harness',
    path: 'components/harness/tests/install.test.mjs',
    desc: 'Clean seat installation, 0600 env permissions & symlink defense'
  }
];

function runTestFile(suite) {
  return new Promise((resolve) => {
    const fullPath = path.resolve(ROOT_DIR, suite.path);
    if (!fs.existsSync(fullPath)) {
      return resolve({
        suite,
        passed: false,
        durationMs: 0,
        output: `File not found: ${suite.path}`
      });
    }

    const start = Date.now();
    const proc = spawn(process.execPath, ['--test', fullPath], {
      cwd: ROOT_DIR,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });

    proc.on('close', (code) => {
      resolve({
        suite,
        passed: code === 0,
        durationMs: Date.now() - start,
        output
      });
    });
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Incubator v5 — Unified Test Suite Runner (Google 3-Tier)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let suitesToRun = TEST_REGISTRY.filter((s) => {
    if (componentFilter && s.component !== componentFilter) return false;
    if (isAll) return true;
    if (isTier1 && s.tier === 1) return true;
    if (isTier2 && s.tier === 2) return true;
    return false;
  });

  if (isTier3) {
    console.log('🚀 Running TIER 3: Deep System Flight & Release Gate...');
    // Tier 3 delegates to the release preflight verifier
    const { runTier3Flight } = await import('./release.mjs');
    const result = await runTier3Flight();
    process.exit(result.passed ? 0 : 1);
  }

  const activeTiers = [...new Set(suitesToRun.map((s) => s.tier))].sort();
  console.log(`Active Target Tiers: [ ${activeTiers.map(t => `Tier ${t}`).join(', ')} ]`);
  console.log(`Suites Queued: ${suitesToRun.length} files\n`);

  let allPassed = true;
  let totalDuration = 0;
  const results = [];

  for (const suite of suitesToRun) {
    process.stdout.write(`  [Tier ${suite.tier}] [${suite.component}] ${suite.name} ... `);
    const res = await runTestFile(suite);
    results.push(res);
    totalDuration += res.durationMs;

    if (res.passed) {
      console.log(`✅ PASSED (${res.durationMs}ms)`);
    } else {
      console.log(`❌ FAILED (${res.durationMs}ms)`);
      allPassed = false;
    }
  }

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log(`Summary: ${results.filter(r => r.passed).length}/${results.length} suites passed in ${(totalDuration / 1000).toFixed(2)}s`);

  // Failure details
  if (!allPassed) {
    console.log('\n❌ Failure Output:');
    for (const res of results.filter(r => !r.passed)) {
      console.log(`\n--- [${res.suite.name}] (${res.suite.path}) ---`);
      console.log(res.output);
    }
    process.exit(1);
  } else {
    console.log('✨ All quality invariants verified.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
