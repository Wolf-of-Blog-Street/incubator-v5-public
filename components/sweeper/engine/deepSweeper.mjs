import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolveScope, executeAdversarialTest, runSweep } from './sweeper.mjs';
import { agyDriver } from './agyDriver.mjs';

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
 * Reads the JSON a model returned. The outermost braces come first: a reply whose JSON strings hold
 * code fences (a suggested fix, test code) breaks a fence regex, and its findings were lost as "0 findings".
 * A reply that cannot be parsed throws, so the pass is reported as skipped, never as a clean result.
 */
export function parseModelJson(rawOutput) {
  const raw = String(rawOutput || '').trim();
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  const tries = [raw, a !== -1 && b > a ? raw.slice(a, b + 1) : null, (raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [])[1]];
  for (const t of tries) { if (!t) continue; try { const j = JSON.parse(t); if (j && typeof j === 'object') return j; } catch { /* next */ } }
  throw new Error(`model reply is not JSON (${raw.length} chars): ${raw.slice(0, 120).replace(/\n/g, ' ')}`);
}

/**
 * Executes a non-interactive Astra High audit via local Codex CLI.
 * Dedicated to deep security holes, potential data loss, isolation breaches, and dangerous bugs.
 */
export async function invokeAstraFriend({ scopeFiles, storiesContext = '', existingFindingsContext = '', outputDir, effort = 'high' }) {
  const deepDir = path.join(outputDir, 'astra');
  fs.mkdirSync(deepDir, { recursive: true });

  const promptTemplatePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../prompts/deep-astra.md');
  const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf8');

  // Build the deep audit prompt focusing on security, data loss, and invariants (no human styles)
  const codeBlocks = scopeFiles.map(f => `### File: \`${f.path}\`\n\`\`\`javascript\n${f.content}\n\`\`\``).join('\n\n');
  const existingSection = existingFindingsContext ? `\n\n${existingFindingsContext}\n\n` : '';
  const storiesSection = storiesContext ? `\n\n## Intended Functionality & Real-World User Stories\n\n${storiesContext}\n\n` : '';
  const fullPrompt = `${promptTemplate}${storiesSection}${existingSection}\n\n## Target Source Code Files to Audit\n\n${codeBlocks}\n\nIMPORTANT: Return strictly valid JSON adhering to the specified schema, enclosed in a markdown json block.`;

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

  if (res.error || res.status !== 0) {
    throw new Error(`Codex Astra execution failed (${res.error ? res.error.code || res.error.message : `exit ${res.status}`}): ${String(res.stderr || res.stdout || '').slice(0, 500)}`);
  }

  const rawOutput = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : (res.stdout || '');
  
  // Extract JSON block from output
  fs.writeFileSync(path.join(deepDir, 'astra_raw.txt'), rawOutput, 'utf8'); // kept: a reply that does not parse can still be read by hand
  const parsed = parseModelJson(rawOutput);
  if (!Array.isArray(parsed.findings)) throw new Error('model reply has no findings array');

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
export async function invokeFableFriend({ scopeFiles, storiesContext = '', existingFindingsContext = '', outputDir, effort = 'medium', model = 'claude-fable-5-1', label = 'fable', auditor = 'claude-fable-5-1-med', timeout = 600000 }) {
  const fableDir = path.join(outputDir, label);
  fs.mkdirSync(fableDir, { recursive: true });

  const promptTemplatePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../prompts/deep-fable.md');
  // One brief for every Claude pass; each pass gets its own auditor name and finding ids, so the judge can tell them apart.
  const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf8')
    .replaceAll('claude-fable-5-1-med', auditor).replaceAll('FABLE-', `${label.toUpperCase()}-`).replace('(Fable 5.1 Medium)', `(${auditor})`);

  const codeBlocks = scopeFiles.map(f => `### File: \`${f.path}\`\n\`\`\`javascript\n${f.content}\n\`\`\``).join('\n\n');
  const storiesSection = storiesContext ? `\n\n## Intended Functionality & Real-World User Stories\n\n${storiesContext}\n\n` : '';
  const existingSection = existingFindingsContext ? `\n\n${existingFindingsContext}\n\n` : '';
  const fullPrompt = `${promptTemplate}${storiesSection}${existingSection}\n\n## Target Source Code Files to Audit\n\n${codeBlocks}\n\nIMPORTANT: Return strictly valid JSON adhering to the specified schema, enclosed in a markdown json block.`;

  const promptFile = path.join(fableDir, `${label}_prompt.txt`);
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

  // The prompt goes in on stdin: as an argv element a large target passes the OS limit (E2BIG).
  const args = [
    '-p',
    '--model', model,
    '--dangerously-skip-permissions',
    '--tools', ''
  ];

  const start = Date.now();
  const res = spawnSync(CLAUDE_PATH, args, {
    env,
    encoding: 'utf8',
    input: fullPrompt,
    maxBuffer: 20 * 1024 * 1024,
    timeout
  });
  const duration_ms = Date.now() - start;

  if (res.error || res.status !== 0) {
    throw new Error(`Claude ${label} execution failed (${res.error ? res.error.code || res.error.message : `exit ${res.status}`}): ${String(res.stderr || res.stdout || '').slice(0, 500)}`);
  }

  const rawOutput = (res.stdout || '').trim();
  fs.writeFileSync(path.join(fableDir, `${label}_raw.txt`), rawOutput, 'utf8'); // kept: a reply that does not parse can still be read by hand
  const parsed = parseModelJson(rawOutput);
  if (!Array.isArray(parsed.findings)) throw new Error('model reply has no findings array');

  fs.writeFileSync(path.join(fableDir, `${label}_result.json`), JSON.stringify(parsed, null, 2), 'utf8');

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
 * - Opus 5.5 XHigh: the same audit brief as Fable, at the highest reasoning effort, for the faults a faster pass misses
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
  existingFindings = [],
  priorContext = '',
  judgeDriver = agyDriver
}) {
  const sweepId = `deep-sweep-${Date.now()}`;
  const outputDir = runDir || path.join(baseDir, '.runs', sweepId);
  fs.mkdirSync(outputDir, { recursive: true });

  const boardFindingsContext = existingFindings.length > 0 ? `
## ALREADY IDENTIFIED BUGS (DO NOT DUPLICATE)
The following ${existingFindings.length} bugs have ALREADY been identified and logged on the project board.
DO NOT report these again. Your objective is to hunt for OTHER, NEW, or OVERLOOKED bugs beyond these:

${existingFindings.map((b, i) => `${i + 1}. **${b.id || `EXISTING-${i + 1}`}**: ${b.title} (${b.file || ''}) - ${b.root_cause || b.description || ''}`).join('\n')}
` : '';
  // The sweep ledger (--prior) reaches every model of the deep sweep, as it reaches every wave of a standard one.
  const existingFindingsContext = [priorContext, boardFindingsContext].filter(Boolean).join('\n\n');

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

  // baseline.storiesContext already carries the ledger, so the deep models get it once, through the stories.
  let fableFindings = [];
  let fableResult = { parsed: { findings: [] }, duration_ms: 0 };
  if (!skipClaude) {
    try {
      console.log(`  2. Fable 5.1 Wave (claude-fable-5-1 @ ${fableEffort} - Workflow & Edge Mixture)...`);
      fableResult = await invokeFableFriend({
        scopeFiles: baseline.scopeFiles,
        storiesContext: baseline.storiesContext,
        outputDir,
        effort: fableEffort
      });
      fableFindings = fableResult.parsed?.findings || [];
      console.log(`     → Fable 5.1 finished in ${(fableResult.duration_ms / 1000).toFixed(1)}s. Surfaced ${fableFindings.length} finding(s).`);
    } catch (err) {
      fableResult.skipped = String(err.message || err).split('\n')[0];
      console.log(`     ⚠️ Fable 5.1 skipped (${err.message}). Continuing with Astra and Gemini.`);
    }
  } else {
    fableResult.skipped = 'operator instruction (--skip-claude)';
    console.log(`  2. Fable 5.1 Wave: Skipped (operator instruction).`);
  }

  // Opus 5.5 at xhigh effort: same brief as the Fable wave, a second Claude at full depth.
  let opusFindings = [];
  let opusResult = { parsed: { findings: [] }, duration_ms: 0 };
  if (!skipClaude) {
    try {
      console.log(`  2b. Opus 5.5 Wave (claude-opus-5-5 @ xhigh - Deep Workflow & Edge Audit)...`);
      opusResult = await invokeFableFriend({
        scopeFiles: baseline.scopeFiles,
        storiesContext: baseline.storiesContext,
        outputDir,
        effort: 'xhigh',
        model: 'claude-opus-5-5',
        label: 'opus',
        auditor: 'claude-opus-5-5-xhigh',
        timeout: 1800000 // 30 minutes: xhigh thinks long
      });
      opusFindings = opusResult.parsed?.findings || [];
      console.log(`     → Opus 5.5 finished in ${(opusResult.duration_ms / 1000).toFixed(1)}s. Surfaced ${opusFindings.length} finding(s).`);
    } catch (err) {
      opusResult.skipped = String(err.message || err).split('\n')[0];
      console.log(`     ⚠️ Opus 5.5 skipped (${err.message}). Continuing with Astra and Gemini.`);
    }
  } else {
    opusResult.skipped = 'operator instruction (--skip-claude)';
  }

  console.log(`  3. Astra Wave (gpt-6-astra @ ${astraEffort} - Deep Reliability, Data Loss & System Invariants)...`);
  // Same rule as the Claude passes: a pass that fails or times out is skipped, the sweep still finishes.
  let astraResult = { parsed: { findings: [] }, duration_ms: 0 };
  try {
    astraResult = await invokeAstraFriend({
      scopeFiles: baseline.scopeFiles,
      storiesContext: baseline.storiesContext,
      outputDir,
      effort: astraEffort
    });
  } catch (err) {
    astraResult.skipped = String(err.message || err).split('\n')[0];
    console.log(`     ⚠️ Astra skipped (${astraResult.skipped}). Continuing with the other findings.`);
  }
  const astraFindings = astraResult.parsed?.findings || [];
  console.log(`     → Astra High finished in ${(astraResult.duration_ms / 1000).toFixed(1)}s. Surfaced ${astraFindings.length} deep finding(s).`);

  // Step 4: Synthesize All Findings for the Sane Judge
  console.log(`\n⚖️ [Sane Judge] Adjudicating All Findings Across Gemini, Fable 5.1, Opus 5.5, and Astra...`);
  const allCandidateFindings = [
    ...(baseline.wave1?.findings || []).map(f => ({ ...f, source: 'gemini-3.6' })),
    ...(baseline.wave2?.findings || []).map(f => ({ ...f, source: 'gemini-3.8' })),
    ...fableFindings.map(f => ({ ...f, source: 'claude-fable-5-1' })),
    ...opusFindings.map(f => ({ ...f, source: 'claude-opus-5-5' })),
    ...astraFindings.map(f => ({ ...f, source: 'gpt-6-astra' }))
  ];

  // Run dynamic test proofs if authored
  const dynamicTestProofs = [];
  const testsDir = path.join(outputDir, 'deep-tests');
  fs.mkdirSync(testsDir, { recursive: true });

  for (let i = 0; i < allCandidateFindings.length; i++) {
    const f = allCandidateFindings[i];
    if (f.test_code) {
      // The id is model text: keep it out of the path.
      const testFile = path.join(testsDir, `test_${i + 1}_${String(f.id || 'x').replace(/[^a-zA-Z0-9_-]/g, '_')}.test.mjs`);
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

  // One judge over every model's findings. Without it the deep report is a list of unvetted candidates.
  let deepVerdict = null;
  try {
    const judgePrompt = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../prompts/judge-gavel.md'), 'utf8');
    deepVerdict = await judgeDriver.executeJudge({
      scopeFiles: baseline.scopeFiles,
      wave1: { source: 'gemini baseline', findings: allCandidateFindings.filter(f => f.source.startsWith('gemini')).map(({ test_code, ...f }) => f) },
      wave2: { source: 'deep models', findings: allCandidateFindings.filter(f => !f.source.startsWith('gemini')).map(({ test_code, ...f }) => f) },
      testProofs: [...(baseline.testProofs || []), ...dynamicTestProofs],
      prompt: judgePrompt,
      storiesContext: baseline.storiesContext
    });
  } catch (err) {
    deepVerdict = { verdict: 'unjudged', judge_error: String(err.message || err).split('\n')[0], stamped_bugs: [], discarded_findings: [] };
    console.log(`     ⚠️ Deep judge failed (${deepVerdict.judge_error}). The report lists unjudged candidates.`);
  }

  // Generate Synthesized Report
  const reportLines = [];
  reportLines.push(`# 🛡️ Multi-Model Deep Sweeper Report (Gemini + Fable 5.1 + Opus 5.5 + Astra)`);
  reportLines.push(`- **Sweep ID**: \`${sweepId}\``);
  reportLines.push(`- **Target**: \`${target}\``);
  reportLines.push(`- **Sweepers**: Gemini 3.6 (Story), Gemini 3.8 (Operational), Fable 5.1 Med (Mixture), Opus 5.5 XHigh (Deep Mixture), Astra High (Security/Invariants)`);
  reportLines.push(`- **Total Candidate Findings**: ${allCandidateFindings.length}`);
  reportLines.push('');
  reportLines.push('---');
  reportLines.push('');

  reportLines.push('## 🌟 Model Findings Breakdown');
  reportLines.push(`- **Gemini 3.6 (Story Walkthrough)**: ${baseline.wave1?.findings?.length || 0} candidate(s)`);
  reportLines.push(`- **Gemini 3.8 (Operational Reality)**: ${baseline.wave2?.findings?.length || 0} candidate(s)`);
  reportLines.push(`- **Fable 5.1 Med (Workflow & Edge Mixture)**: ${fableFindings.length} candidate(s)${fableResult.skipped ? ` — ⚠️ SKIPPED: ${fableResult.skipped}` : ''}`);
  reportLines.push(`- **Opus 5.5 XHigh (Deep Workflow & Edge Audit)**: ${opusFindings.length} candidate(s)${opusResult.skipped ? ` — ⚠️ SKIPPED: ${opusResult.skipped}` : ''}`);
  reportLines.push(`- **Astra High (Security & Data Loss)**: ${astraFindings.length} candidate(s)${astraResult.skipped ? ` — ⚠️ SKIPPED: ${astraResult.skipped}` : ''}`);
  reportLines.push('');

  reportLines.push(`## ⚖️ Judge Verdict: ${(deepVerdict.verdict || 'unknown').toUpperCase()}`);
  if (deepVerdict.judge_error) reportLines.push(`⚠️ **The judge failed, so every candidate below is UNJUDGED**: ${deepVerdict.judge_error}`);
  for (const b of deepVerdict.stamped_bugs || []) {
    reportLines.push(`### [${b.severity || 'HIGH'}] ${b.title} (\`${b.id}\`)`);
    reportLines.push(`- **Location**: \`${b.file || 'N/A'}${b.line ? ':' + b.line : ''}\``);
    reportLines.push(`- **Real World Impact**: ${b.real_world_impact || b.root_cause || 'N/A'}`);
    reportLines.push(`- **Proof**: \`${b.dynamic_repro || 'N/A'}\``);
    reportLines.push(`- **Recommended Action**: ${b.recommended_fix || b.suggested_fix || 'N/A'}`);
    reportLines.push('');
  }
  if (!deepVerdict.judge_error && !(deepVerdict.stamped_bugs || []).length) reportLines.push('_No bugs stamped._');
  if ((deepVerdict.discarded_findings || []).length) {
    reportLines.push('### Discarded');
    for (const d of deepVerdict.discarded_findings) reportLines.push(`- **\`${d.original_id || d.id}\`**: ${d.reason || "N/A"}`);
  }
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
    opus: opusResult.parsed,
    astra: astraResult.parsed,
    judge: deepVerdict,
    allCandidates: allCandidateFindings,
    dynamicTestProofs
  }, null, 2), 'utf8');

  return {
    sweepId,
    outputDir,
    baseline,
    fableResult,
    opusResult,
    astraResult,
    allCandidateFindings,
    deepVerdict,
    dynamicTestProofs,
    deepSummaryMd
  };
}
