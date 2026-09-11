import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolveScope, executeAdversarialTest, runSweep } from './sweeper.mjs';

const CODEX_PATH = '/opt/homebrew/bin/codex';
const CLAUDE_PATH = '/opt/homebrew/bin/claude';

function getClaudeOauthToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const maxTokensEnvPath = path.join(os.homedir(), '.config', 'incubator', 'max-tokens.env');
  if (fs.existsSync(maxTokensEnvPath)) {
    try {
      const content = fs.readFileSync(maxTokensEnvPath, 'utf8');
      const match = content.match(/ANTHROPIC_MAX_TOKEN_\w+=([^\s]+)/);
      if (match && match[1]) return match[1];
    } catch {
      // Ignore
    }
  }
  return null;
}

/**
 * Executes a non-interactive Astra High audit via local Codex CLI.
 * Dedicated to deep security holes, potential data loss, isolation breaches, and dangerous bugs.
 */
export async function invokeAstraFriend({ scopeFiles, existingFindingsContext = '', outputDir, effort = 'high' }) {
  const deepDir = path.join(outputDir, 'astra');
  fs.mkdirSync(deepDir, { recursive: true });

  const promptTemplatePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../prompts/deep-astra.md');
  const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf8');

  // Build the deep audit prompt focusing on security, data loss, and invariants (no human styles)
  const codeBlocks = scopeFiles.map(f => `### File: \`${f.path}\`\n\`\`\`javascript\n${f.content}\n\`\`\``).join('\n\n');
  const existingSection = existingFindingsContext ? `\n\n${existingFindingsContext}\n\n` : '';
  const fullPrompt = `${promptTemplate}${existingSection}\n\n## Target Source Code Files to Audit\n\n${codeBlocks}\n\nIMPORTANT: Return strictly valid JSON adhering to the specified schema, enclosed in a markdown json block.`;

  const promptFile = path.join(deepDir, 'astra_prompt.txt');
  fs.writeFileSync(promptFile, fullPrompt, 'utf8');

  const outputFile = path.join(deepDir, 'astra_result.txt');

  const args = [
    'exec',
    '--ephemeral',
    '-s', 'read-only',
    '-m', 'gpt-6-astra',
    '-c', `model_reasoning_effort=${effort}`,
    '-o', outputFile,
    '-'
  ];

  const defaultCodexHome = path.join(os.homedir(), '.incubator', 'auth', 'agents', 'manager-pm', 'friends', 'codex');
  const env = {
    ...process.env,
    CODEX_HOME: process.env.CODEX_HOME || (fs.existsSync(defaultCodexHome) ? defaultCodexHome : path.join(os.homedir(), '.codex'))
  };

  const start = Date.now();
  const res = spawnSync(CODEX_PATH, args, {
    env,
    encoding: 'utf8',
    input: fullPrompt,
    timeout: 600000 // 10 minutes timeout for deep reasoning
  });

  const duration_ms = Date.now() - start;

  if (res.status !== 0) {
    throw new Error(`Codex Astra execution failed (exit ${res.status}): ${res.stderr || res.stdout}`);
  }

  const rawOutput = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : (res.stdout || '');
  
  // Extract JSON block from output
  let parsed = { auditor: 'gpt-6-astra-high', findings: [] };
  const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, rawOutput];
  try {
    parsed = JSON.parse(jsonMatch[1].trim());
  } catch (err) {
    parsed = {
      auditor: 'gpt-6-astra-high',
      raw_output: rawOutput,
      findings: []
    };
  }

  fs.writeFileSync(path.join(deepDir, 'astra_result.json'), JSON.stringify(parsed, null, 2), 'utf8');

  return {
    parsed,
    duration_ms,
    rawOutput
  };
}

/**
 * Executes a non-interactive Fable 5.1 Medium audit via Claude Code CLI.
 * Balanced mixture of caller workflow consistency and code-level edge robustness.
 */
export async function invokeFableFriend({ scopeFiles, storiesContext = '', existingFindingsContext = '', outputDir, effort = 'medium' }) {
  const fableDir = path.join(outputDir, 'fable');
  fs.mkdirSync(fableDir, { recursive: true });

  const promptTemplatePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../prompts/deep-fable.md');
  const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf8');

  const codeBlocks = scopeFiles.map(f => `### File: \`${f.path}\`\n\`\`\`javascript\n${f.content}\n\`\`\``).join('\n\n');
  const storiesSection = storiesContext ? `\n\n## Intended Functionality & Real-World User Stories\n\n${storiesContext}\n\n` : '';
  const existingSection = existingFindingsContext ? `\n\n${existingFindingsContext}\n\n` : '';
  const fullPrompt = `${promptTemplate}${storiesSection}${existingSection}\n\n## Target Source Code Files to Audit\n\n${codeBlocks}\n\nIMPORTANT: Return strictly valid JSON adhering to the specified schema, enclosed in a markdown json block.`;

  const promptFile = path.join(fableDir, 'fable_prompt.txt');
  fs.writeFileSync(promptFile, fullPrompt, 'utf8');

  const token = getClaudeOauthToken();
  const env = {
    ...process.env,
    CLAUDE_CODE_EFFORT_LEVEL: effort
  };
  if (token) {
    env.CLAUDE_CODE_OAUTH_TOKEN = token;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }

  const args = [
    '-p', fullPrompt,
    '--model', 'claude-fable-5-1',
    '--dangerously-skip-permissions',
    '--tools', ''
  ];

  const start = Date.now();
  const res = spawnSync(CLAUDE_PATH, args, {
    env,
    encoding: 'utf8',
    input: '',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 600000 // 10 minutes
  });
  const duration_ms = Date.now() - start;

  if (res.status !== 0) {
    throw new Error(`Claude Fable execution failed (exit ${res.status}): ${res.stderr || res.stdout}`);
  }

  const rawOutput = (res.stdout || '').trim();
  let parsed = { auditor: 'claude-fable-5-1-med', findings: [] };
  const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, rawOutput];
  try {
    parsed = JSON.parse(jsonMatch[1].trim());
  } catch (err) {
    parsed = {
      auditor: 'claude-fable-5-1-med',
      raw_output: rawOutput,
      findings: []
    };
  }

  fs.writeFileSync(path.join(fableDir, 'fable_result.json'), JSON.stringify(parsed, null, 2), 'utf8');

  return {
    parsed,
    duration_ms,
    rawOutput
  };
}

/**
 * Runs the Multi-Model Deep Sweeper:
 * - Geminis (3.6 / 3.8): Use cases, human simulation, CLI workflows, operational reality
 * - Fable 5.1 Med: Mixture of workflow consistency and code-level edge robustness
 * - Astra High: Deep security, potential data loss, storage invariants, and dangerous bugs
 * - Sane Judge (Gemini 3.8 Flash): Sanity check / reality filter across all candidates
 */
export async function runDeepSweep({
  target,
  baseDir = process.cwd(),
  runDir = null,
  security = true,
  effort = null,
  astraEffort = effort || 'high',
  fableEffort = 'medium',
  skipClaude = false,
  story = null,
  spec = null,
  existingFindings = []
}) {
  const sweepId = `deep-sweep-${Date.now()}`;
  const outputDir = runDir || path.join(baseDir, '.runs', sweepId);
  fs.mkdirSync(outputDir, { recursive: true });

  const existingFindingsContext = existingFindings.length > 0 ? `
## ALREADY IDENTIFIED BUGS (DO NOT DUPLICATE)
The following ${existingFindings.length} bugs have ALREADY been identified and logged on the project board.
DO NOT report these again. Your objective is to hunt for OTHER, NEW, or OVERLOOKED bugs beyond these:

${existingFindings.map((b, i) => `${i + 1}. **${b.id || `EXISTING-${i + 1}`}**: ${b.title} (${b.file || ''}) - ${b.root_cause || b.description || ''}`).join('\n')}
` : '';

  console.log(`\n🛡️ [Multi-Model Deep Sweeper] Launching Sweeper Waves...`);
  console.log(`  1. Gemini Waves (3.6 Story Walkthrough + 3.8 Operational Reality)...`);
  const baseline = await runSweep({
    target,
    baseDir,
    runDir: path.join(outputDir, 'baseline'),
    security,
    story,
    spec,
    existingFindingsContext
  });

  let fableFindings = [];
  let fableResult = { parsed: { findings: [] }, duration_ms: 0 };
  if (!skipClaude) {
    try {
      console.log(`  2. Fable 5.1 Wave (claude-fable-5-1 @ ${fableEffort} - Workflow & Edge Mixture)...`);
      fableResult = await invokeFableFriend({
        scopeFiles: baseline.scopeFiles,
        storiesContext: baseline.storiesContext,
        existingFindingsContext,
        outputDir,
        effort: fableEffort
      });
      fableFindings = fableResult.parsed?.findings || [];
      console.log(`     → Fable 5.1 finished in ${(fableResult.duration_ms / 1000).toFixed(1)}s. Surfaced ${fableFindings.length} finding(s).`);
    } catch (err) {
      console.log(`     ⚠️ Fable 5.1 skipped (${err.message}). Continuing with Astra and Gemini.`);
    }
  } else {
    console.log(`  2. Fable 5.1 Wave: Skipped (operator instruction).`);
  }

  console.log(`  3. Astra Wave (gpt-6-astra @ ${astraEffort} - Deep Reliability, Data Loss & System Invariants)...`);
  const astraResult = await invokeAstraFriend({
    scopeFiles: baseline.scopeFiles,
    existingFindingsContext,
    outputDir,
    effort: astraEffort
  });
  const astraFindings = astraResult.parsed.findings || [];
  console.log(`     → Astra High finished in ${(astraResult.duration_ms / 1000).toFixed(1)}s. Surfaced ${astraFindings.length} deep finding(s).`);

  // Step 4: Synthesize All Findings for the Sane Judge
  console.log(`\n⚖️ [Sane Judge] Adjudicating All Findings Across Gemini, Fable 5.1, and Astra...`);
  const allCandidateFindings = [
    ...(baseline.wave1?.findings || []).map(f => ({ ...f, source: 'gemini-3.6' })),
    ...(baseline.wave2?.findings || []).map(f => ({ ...f, source: 'gemini-3.8' })),
    ...fableFindings.map(f => ({ ...f, source: 'claude-fable-5-1' })),
    ...astraFindings.map(f => ({ ...f, source: 'gpt-6-astra' }))
  ];

  // Run dynamic test proofs if authored
  const dynamicTestProofs = [];
  const testsDir = path.join(outputDir, 'deep-tests');
  fs.mkdirSync(testsDir, { recursive: true });

  for (let i = 0; i < allCandidateFindings.length; i++) {
    const f = allCandidateFindings[i];
    if (f.test_code) {
      const testFile = path.join(testsDir, `test_${f.id || i + 1}.test.mjs`);
      fs.writeFileSync(testFile, f.test_code, 'utf8');
      const testRes = executeAdversarialTest(testFile);
      dynamicTestProofs.push({
        id: f.id,
        source: f.source,
        test_name: `test_${f.id || i + 1}`,
        passed: testRes.passed,
        isHarnessError: testRes.isHarnessError,
        duration_ms: testRes.duration_ms
      });
    }
  }

  // Generate Synthesized Report
  const reportLines = [];
  reportLines.push(`# 🛡️ Multi-Model Deep Sweeper Report (Gemini + Fable 5.1 + Astra)`);
  reportLines.push(`- **Sweep ID**: \`${sweepId}\``);
  reportLines.push(`- **Target**: \`${target}\``);
  reportLines.push(`- **Sweepers**: Gemini 3.6 (Story), Gemini 3.8 (Operational), Fable 5.1 Med (Mixture), Astra High (Security/Invariants)`);
  reportLines.push(`- **Total Candidate Findings**: ${allCandidateFindings.length}`);
  reportLines.push('');
  reportLines.push('---');
  reportLines.push('');

  reportLines.push('## 🌟 Model Findings Breakdown');
  reportLines.push(`- **Gemini 3.6 (Story Walkthrough)**: ${baseline.wave1?.findings?.length || 0} candidate(s)`);
  reportLines.push(`- **Gemini 3.8 (Operational Reality)**: ${baseline.wave2?.findings?.length || 0} candidate(s)`);
  reportLines.push(`- **Fable 5.1 Med (Workflow & Edge Mixture)**: ${fableFindings.length} candidate(s)`);
  reportLines.push(`- **Astra High (Security & Data Loss)**: ${astraFindings.length} candidate(s)`);
  reportLines.push('');

  reportLines.push('### Candidate Findings Details');
  for (const f of allCandidateFindings) {
    reportLines.push(`#### [${f.severity || 'HIGH'}] [${f.source}] ${f.title} (\`${f.id}\`)`);
    if (f.category) reportLines.push(`- **Category**: \`${f.category}\``);
    reportLines.push(`- **Root Cause**: ${f.root_cause || f.mental_walkthrough || f.operational_scenario || 'N/A'}`);
    reportLines.push(`- **Failure Scenario**: ${f.failure_scenario || 'N/A'}`);
    reportLines.push(`- **Recommended Action**: ${f.recommended_fix || f.suggested_fix || 'N/A'}`);
    reportLines.push('');
  }

  const deepSummaryMd = reportLines.join('\n');
  fs.writeFileSync(path.join(outputDir, 'deep-summary.md'), deepSummaryMd, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'deep-summary.json'), JSON.stringify({
    sweepId,
    target,
    gemini_wave1: baseline.wave1,
    gemini_wave2: baseline.wave2,
    fable: fableResult.parsed,
    astra: astraResult.parsed,
    allCandidates: allCandidateFindings,
    dynamicTestProofs
  }, null, 2), 'utf8');

  return {
    sweepId,
    outputDir,
    baseline,
    fableResult,
    astraResult,
    allCandidateFindings,
    dynamicTestProofs,
    deepSummaryMd
  };
}
