#!/usr/bin/env node

import path from 'node:path';
import { runSweep } from '../engine/sweeper.mjs';
import { runDeepSweep } from '../engine/deepSweeper.mjs';

function parseArgs(args) {
  const parsed = {
    target: '.',
    runDir: null,
    waves: [1, 2, 3],
    security: false,
    deep: false,
    effort: 'high',
    story: null,
    spec: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
🛡️ Incubator v5 Bug Sweeper

Usage:
  node tools/sweep.mjs [--target <dir|file>] [--spec <file>] [--story <text>] [options]

Options:
  --target <path>    Target file or directory to sweep (default: .)
  --spec <file>      Design doc spec containing intended behavior & user stories
  --story <text>     Explicit user story describing how the component should work
  --deep             Run deep sweep with Astra / Codex advisory
  --waves <1,2,3>    Wave selection (default: 1,2,3)
  --security         Focus on security and auth vulnerabilities
  --effort <level>   Effort level for deep sweeper (low, medium, high)
  --run-dir <dir>    Custom output run directory
      `);
      process.exit(0);
    } else if (args[i] === '--target' && args[i + 1]) {
      parsed.target = args[++i];
    } else if (args[i] === '--run-dir' && args[i + 1]) {
      parsed.runDir = args[++i];
    } else if (args[i] === '--waves' && args[i + 1]) {
      parsed.waves = args[++i].split(',').map(Number);
    } else if (args[i] === '--security') {
      parsed.security = true;
    } else if (args[i] === '--deep') {
      parsed.deep = true;
    } else if (args[i] === '--effort' && args[i + 1]) {
      parsed.effort = args[++i];
    } else if (args[i] === '--story' && args[i + 1]) {
      parsed.story = args[++i];
    } else if (args[i] === '--spec' && args[i + 1]) {
      parsed.spec = args[++i];
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  if (args.deep) {
    console.log(`\n🛡️ [Deep Sweeper] Fast Baseline (Gemini) + Deep Advisory (Astra @ ${args.effort} via Codex)`);
    console.log(`Target: ${args.target}\n`);
    try {
      const res = await runDeepSweep({
        target: args.target,
        runDir: args.runDir,
        security: args.security,
        effort: args.effort,
        story: args.story,
        spec: args.spec
      });
      console.log(`✅ Deep Sweep completed: ${res.sweepId}`);
      console.log(`📁 Report written to: ${path.join(res.outputDir, 'deep-summary.md')}\n`);
      console.log(res.deepSummaryMd);
    } catch (err) {
      console.error(`❌ Deep Sweep failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  console.log(`\n🛡️ Incubator v5 Bug Sweeper (3-Wave System)`);
  console.log(`Target: ${args.target}`);
  console.log(`Waves: [${args.waves.join(', ')}] — Breadth (3.6) → Depth (3.8) → Adversarial Tests (3.7) → Judge (3.8)\n`);

  try {
    const res = await runSweep({
      target: args.target,
      runDir: args.runDir,
      security: args.security,
      story: args.story,
      spec: args.spec
    });

    console.log(`✅ Sweep completed: ${res.sweepId}`);
    console.log(`📁 Report written to: ${path.join(res.outputDir, 'summary.md')}\n`);
    console.log(res.summaryMd);
  } catch (err) {
    console.error(`❌ Sweep failed: ${err.message}`);
    process.exit(1);
  }
}

main();
