#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { runSweep } from '../engine/sweeper.mjs';
import { runDeepSweep } from '../engine/deepSweeper.mjs';

function parseArgs(args) {
  const parsed = {
    target: '.',
    runDir: null,
    security: false,
    deep: false,
    effort: 'high',
    story: null,
    spec: null,
    skipClaude: false,
    prior: null
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
  --skip-claude      Skip the Claude waves, Fable 5.1 and Opus 5.5 (Gemini + Codex Astra only)
  --security         Focus on security and auth vulnerabilities
  --effort <level>   Effort level for deep sweeper (low, medium, high)
  --run-dir <dir>    Custom output run directory
  --prior <file>     The sweep ledger: findings of earlier sweeps with verdicts (fixed, rejected and why).
                     Every wave, the judge and every --deep model read it.
      `);
      process.exit(0);
    } else if (args[i] === '--target' && args[i + 1]) {
      parsed.target = args[++i];
    } else if (args[i] === '--run-dir' && args[i + 1]) {
      parsed.runDir = args[++i];
    } else if (args[i] === '--security') {
      parsed.security = true;
    } else if (args[i] === '--deep') {
      parsed.deep = true;
    } else if (args[i] === '--skip-claude') {
      parsed.skipClaude = true;
    } else if (args[i] === '--effort' && args[i + 1]) {
      parsed.effort = args[++i];
    } else if (args[i] === '--story' && args[i + 1]) {
      parsed.story = args[++i];
    } else if (args[i] === '--spec' && args[i + 1]) {
      parsed.spec = args[++i];
    } else if (args[i] === '--prior' && args[i + 1]) {
      parsed.prior = args[++i];
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.prior && !fs.existsSync(args.prior)) { console.error(`❌ --prior: ledger file not found: ${args.prior}`); process.exit(2); }
  const priorContext = args.prior ? `## Findings of earlier sweeps, with verdicts\nDo not report these again. Do not re-raise a rejected finding unless you have new proof against its stated reason. Look for what these sweeps missed, and check that each fix is complete.\n\n${fs.readFileSync(args.prior, 'utf8')}` : '';
  
  if (args.deep) {
    console.log(`\n🛡️ [Deep Sweeper] Gemini baseline + Fable 5.1 (medium) + Opus 5.5 (xhigh) + Astra (${args.effort}, via Codex)`);
    console.log(`Target: ${args.target}\n`);
    try {
      const res = await runDeepSweep({
        target: args.target,
        runDir: args.runDir,
        security: args.security,
        effort: args.effort,
        skipClaude: args.skipClaude,
        story: args.story,
        spec: args.spec,
        priorContext
      });
      console.log(`✅ Deep Sweep completed: ${res.sweepId}`);
      console.log(`📁 Report written to: ${path.join(res.outputDir, 'deep-summary.md')}\n`);
      console.log(res.deepSummaryMd);
      if (res.baseline?.judgeVerdict?.verdict === 'incomplete' || res.deepVerdict?.judge_error) { console.error('❌ Deep sweep INCOMPLETE: a model step or the judge failed (see the report).'); process.exit(1); }
    } catch (err) {
      console.error(`❌ Deep Sweep failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  console.log(`\n🛡️ Incubator v5 Bug Sweeper (3-Wave System)`);
  console.log(`Target: ${args.target}`);
  console.log(`Waves: Breadth (3.6) → Depth (3.8) → Adversarial Tests (3.7) → Judge (3.8)\n`);

  try {
    const res = await runSweep({
      target: args.target,
      runDir: args.runDir,
      security: args.security,
      story: args.story,
      spec: args.spec,
      existingFindingsContext: priorContext
    });

    console.log(`✅ Sweep completed: ${res.sweepId}`);
    console.log(`📁 Report written to: ${path.join(res.outputDir, 'summary.md')}\n`);
    console.log(res.summaryMd);
    // A sweep with a failed step is not a result: callers must see a non-zero exit.
    if (res.judgeVerdict?.verdict === 'incomplete') { console.error('❌ Sweep INCOMPLETE: a model step failed (see the report).'); process.exit(1); }
  } catch (err) {
    console.error(`❌ Sweep failed: ${err.message}`);
    process.exit(1);
  }
}

main();
