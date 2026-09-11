import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { CHAOS_SEEDS, runChaosBattery, burstConcurrency, auditHandles } from './chaos.mjs';
import { agyDriver } from './agyDriver.mjs';
import { resolveStories, formatStoriesContext } from './storyResolver.mjs';

export {
  CHAOS_SEEDS,
  runChaosBattery,
  burstConcurrency,
  auditHandles,
  agyDriver,
  resolveStories,
  formatStoriesContext
};

const DEFAULT_MODELS = {
  wave1: 'gemini-3.6-flash-low',
  wave2: 'gemini-3.8-flash-low',
  wave3: 'gemini-3.7-flash-low',
  judge: 'gemini-3.8-flash-low'
};

/**
 * Resolves all source files within target paths.
 */
export function resolveScope(targets, baseDir = process.cwd(), extensions = ['.mjs', '.js', '.cjs', '.py', '.sh']) {
  const fileList = [];
  const targetArray = Array.isArray(targets) ? targets : (typeof targets === 'string' && targets.includes(',') ? targets.split(',').map(s => s.trim()) : [targets]);
  const visitedDirs = new Set();

  function walk(currentPath) {
    let stat;
    try {
      stat = fs.lstatSync(currentPath);
    } catch {
      return; // Skip broken symlinks or inaccessible entries (Task #56)
    }

    if (stat.isSymbolicLink()) {
      try {
        const real = fs.realpathSync(currentPath);
        const realStat = fs.statSync(real);
        if (realStat.isDirectory()) {
          if (visitedDirs.has(real)) return; // Prevent cyclic directory symlink loops
          visitedDirs.add(real);
          const basename = path.basename(real);
          if (basename === 'node_modules' || basename === '.git' || basename === '.runs' || basename === 'tests' || basename === '__tests__') return;
          for (const entry of fs.readdirSync(real)) {
            walk(path.join(real, entry));
          }
        } else if (realStat.isFile()) {
          const ext = path.extname(real);
          if (extensions.includes(ext) && !real.includes('node_modules') && !real.includes('.git') && !real.includes('.test.') && !real.includes('/tests/')) {
            fileList.push(path.resolve(real));
          }
        }
      } catch {
        return;
      }
      return;
    }

    if (stat.isFile()) {
      const ext = path.extname(currentPath);
      if (extensions.includes(ext) && !currentPath.includes('node_modules') && !currentPath.includes('.git') && !currentPath.includes('.test.') && !currentPath.includes('/tests/')) {
        fileList.push(path.resolve(currentPath));
      }
    } else if (stat.isDirectory()) {
      try {
        const real = fs.realpathSync(currentPath);
        if (visitedDirs.has(real)) return;
        visitedDirs.add(real);
      } catch {
        return;
      }
      const basename = path.basename(currentPath);
      if (basename === 'node_modules' || basename === '.git' || basename === '.runs' || basename === 'tests' || basename === '__tests__') return;
      try {
        for (const entry of fs.readdirSync(currentPath)) {
          walk(path.join(currentPath, entry));
        }
      } catch {
        return;
      }
    }
  }

  for (const t of targetArray) {
    const fullPath = path.isAbsolute(t) ? t : path.resolve(baseDir, t);
    if (fs.existsSync(fullPath)) {
      walk(fullPath);
    }
  }

  return fileList.map(filePath => {
    return {
      path: path.relative(baseDir, filePath),
      absolutePath: filePath,
      content: fs.readFileSync(filePath, 'utf8')
    };
  });
}

/**
 * Executes an adversarial test file using node --test and returns the execution report.
 */
export function executeAdversarialTest(testFilePath) {
  const start = Date.now();
  const childEnv = { ...process.env, NODE_ENV: 'test' };
  for (const k of Object.keys(childEnv)) {
    if (k.startsWith('NODE_TEST_')) delete childEnv[k];
  }

  const res = spawnSync(process.execPath, [testFilePath], {
    encoding: 'utf8',
    timeout: 15000,
    env: childEnv
  });

  const stderr = res.stderr || '';
  const stdout = res.stdout || '';

  // Differentiate reproduction assertion failures from harness/import/syntax errors (Task #55)
  let isHarnessError = false;
  if (res.status !== 0) {
    if (/ERR_MODULE_NOT_FOUND|SyntaxError|ReferenceError:.*is not defined|Cannot find module/i.test(stderr + stdout)) {
      isHarnessError = true;
    }
  }

  const passed = res.status === 0;

  return {
    passed,
    isHarnessError,
    exitCode: res.status,
    stdout,
    stderr,
    duration_ms: Date.now() - start
  };
}

/**
 * Evaluates a set of adversarial test definitions, writes them to a run directory, runs them, and returns execution proofs.
 */
export function runAdversarialTestSuite(tests, outputDir) {
  const testsDir = path.join(outputDir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });

  const results = [];

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const safeName = (t.test_name || `test_${i}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const testFile = path.join(testsDir, `${safeName}.test.mjs`);

    fs.writeFileSync(testFile, t.code, 'utf8');
    const execResult = executeAdversarialTest(testFile);

    results.push({
      test_name: t.test_name,
      target_finding_id: t.target_finding_id || null,
      test_file: testFile,
      passed: execResult.passed,
      exitCode: execResult.exitCode,
      duration_ms: execResult.duration_ms,
      stdout: execResult.stdout,
      stderr: execResult.stderr
    });
  }

  return results;
}

/**
 * Synthesizes final summary markdown from wave findings, test proofs, and judge verdict.
 */
export function formatSummaryMarkdown({ sweepId, target, scopeFiles, wave1, wave2, testProofs, judgeVerdict, stories = [], specSource = 'N/A' }) {
  const lines = [];
  lines.push(`# 🛡️ Incubator v5 Bug Sweep Report`);
  lines.push(`- **Sweep ID**: \`${sweepId}\``);
  lines.push(`- **Target**: \`${target}\``);
  lines.push(`- **Audited Files**: ${scopeFiles.length} file(s)`);
  lines.push(`- **User Stories Source**: \`${specSource}\` (${stories.length} story/stories evaluated)`);
  lines.push(`- **Verdict**: **${(judgeVerdict.verdict || 'UNKNOWN').toUpperCase()}**`);
  lines.push(`- **Judge**: \`${judgeVerdict.judge || DEFAULT_MODELS.judge}\``);
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## Executive Summary');
  const summary = judgeVerdict.summary || {};
  lines.push(`- **User Stories Audited**: ${stories.length}`);
  lines.push(`- **Findings Audited**: ${summary.total_reviewed ?? (wave1.findings.length + wave2.findings.length)}`);
  lines.push(`- **Stamped Invariant Bugs**: ${judgeVerdict.stamped_bugs?.length ?? 0}`);
  lines.push(`- **Discarded Speculative Trivia**: ${judgeVerdict.discarded_findings?.length ?? 0}`);
  lines.push(`- **Dynamic Story Tests Executed**: ${testProofs.length} (${testProofs.filter(t => !t.passed).length} reproducing failures)`);
  lines.push('');

  if (stories.length > 0) {
    lines.push('### Evaluated User Stories');
    for (const s of stories) {
      lines.push(`- **\`${s.id}\`**: ${s.action} *(Expected: ${s.expected_outcome})*`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 🚨 Stamped Bugs (Real-World Functional Blockers)');
  if (!judgeVerdict.stamped_bugs || judgeVerdict.stamped_bugs.length === 0) {
    lines.push('_No critical or invariant bugs stamped. Target satisfies all evaluated user stories._');
  } else {
    for (const b of judgeVerdict.stamped_bugs) {
      lines.push(`### [${b.severity || 'HIGH'}] ${b.title} (\`${b.id}\`)`);
      if (b.target_story_id) {
        lines.push(`- **Broken User Story**: \`${b.target_story_id}\``);
      }
      lines.push(`- **Location**: \`${b.file}${b.line ? ':' + b.line : ''}\``);
      lines.push(`- **Real World Impact**: ${b.real_world_impact || b.root_cause || 'Prevents execution'}`);
      lines.push(`- **Dynamic Proof**: \`${b.dynamic_repro || 'N/A'}\``);
      lines.push(`- **Root Cause**: ${b.root_cause || b.description || 'N/A'}`);
      lines.push(`- **Recommended Action**: ${b.recommended_fix || b.suggested_fix || 'N/A'}`);
      lines.push('');
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 🧪 Dynamic Tests (Wave 3 Execution)');
  if (testProofs.length === 0) {
    lines.push('_No dynamic tests executed._');
  } else {
    lines.push('| Test Name | Target Finding | Status | Duration |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const tp of testProofs) {
      const statusIcon = tp.isHarnessError
        ? '⚠️ ERROR (Harness/Import Issue)'
        : (tp.passed ? '✅ PASSED (Workflow Satisfied)' : '💥 FAILED (Story Broken / Bug Confirmed)');
      lines.push(`| \`${tp.test_name}\` | \`${tp.target_finding_id || 'general'}\` | ${statusIcon} | ${tp.duration_ms}ms |`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 🗑️ Discarded Findings (Trivia / Non-Impactful Edge Cases)');
  if (!judgeVerdict.discarded_findings || judgeVerdict.discarded_findings.length === 0) {
    lines.push('_None._');
  } else {
    for (const d of judgeVerdict.discarded_findings) {
      lines.push(`- **\`${d.original_id}\`**: ${d.reason}`);
    }
  }

  return lines.join('\n');
}

/**
 * Main Bug Sweeper Orchestrator.
 */
export async function runSweep({
  target,
  baseDir = process.cwd(),
  runDir = null,
  llmDriver = agyDriver,
  apiKey = process.env.GEMINI_API_KEY || null,
  security = false,
  story = null,
  spec = null,
  existingFindingsContext = ''
}) {
  const sweepId = `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const outputDir = runDir || path.join(baseDir, '.runs', sweepId);
  fs.mkdirSync(outputDir, { recursive: true });

  const scopeFiles = resolveScope(target, baseDir);
  if (scopeFiles.length === 0) {
    throw new Error(`No auditable source files found for target: ${target}`);
  }

  // Resolve user stories / specification
  const resolvedStories = resolveStories({
    target,
    storyText: story,
    specPath: spec,
    baseDir
  });
  const rawStoriesContext = formatStoriesContext(resolvedStories.stories, resolvedStories.specSource);
  const storiesContext = existingFindingsContext
    ? `${rawStoriesContext}\n\n${existingFindingsContext}`
    : rawStoriesContext;

  // Load prompts (prefer story-walkthrough over legacy breadth/depth)
  const promptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../prompts');
  const wave1PromptFile = fs.existsSync(path.join(promptsDir, 'wave1-story-walkthrough.md')) ? 'wave1-story-walkthrough.md' : 'wave1-breadth.md';
  const wave2PromptFile = fs.existsSync(path.join(promptsDir, 'wave2-operational-reality.md')) ? 'wave2-operational-reality.md' : 'wave2-depth.md';
  const wave3PromptFile = security
    ? 'wave3-security-invariants.md'
    : (fs.existsSync(path.join(promptsDir, 'wave3-story-proof.md')) ? 'wave3-story-proof.md' : 'wave3-adversarial.md');

  const wave1Prompt = fs.readFileSync(path.join(promptsDir, wave1PromptFile), 'utf8');
  const wave2Prompt = fs.readFileSync(path.join(promptsDir, wave2PromptFile), 'utf8');
  const wave3Prompt = fs.readFileSync(path.join(promptsDir, wave3PromptFile), 'utf8');
  const judgePrompt = fs.readFileSync(path.join(promptsDir, 'judge-gavel.md'), 'utf8');

  // Step 1: Execute Wave 1 (Story-to-Code Mental Walkthrough)
  let wave1Result = { wave: 1, hunter: DEFAULT_MODELS.wave1, findings: [] };
  if (llmDriver) {
    wave1Result = await llmDriver.executeWave1({
      scopeFiles,
      prompt: wave1Prompt,
      storiesContext,
      model: DEFAULT_MODELS.wave1
    });
  }

  // Step 2: Execute Wave 2 (Operational Reality & Silent Degradation)
  let wave2Result = { wave: 2, hunter: DEFAULT_MODELS.wave2, findings: [] };
  if (llmDriver) {
    wave2Result = await llmDriver.executeWave2({
      scopeFiles,
      wave1: wave1Result,
      prompt: wave2Prompt,
      storiesContext,
      model: DEFAULT_MODELS.wave2
    });
  }

  // Step 3: Execute Wave 3 (Real Story Reproduction Tests)
  let wave3Result = { wave: 3, role: 'story-reproduction-engineer', tests: [] };
  if (llmDriver) {
    wave3Result = await llmDriver.executeWave3({
      scopeFiles,
      wave1: wave1Result,
      wave2: wave2Result,
      prompt: wave3Prompt,
      storiesContext,
      model: DEFAULT_MODELS.wave3
    });
  }

  // Step 4: Run the generated tests dynamically
  const testProofs = runAdversarialTestSuite(wave3Result.tests || [], outputDir);

  // Step 5: Execute Judge (Real-Use Gavel)
  let judgeVerdict = {
    verdict: testProofs.some(t => !t.passed) ? 'issues_detected' : 'clean',
    judge: DEFAULT_MODELS.judge,
    summary: {
      total_reviewed: (wave1Result.findings?.length || 0) + (wave2Result.findings?.length || 0),
      stamped_verified: 0,
      discarded_trivia: 0
    },
    stamped_bugs: [],
    discarded_findings: []
  };

  if (llmDriver) {
    judgeVerdict = await llmDriver.executeJudge({
      scopeFiles,
      wave1: wave1Result,
      wave2: wave2Result,
      testProofs,
      prompt: judgePrompt,
      storiesContext,
      model: DEFAULT_MODELS.judge
    });
  }

  // Step 6: Generate Summary Report
  const summaryMd = formatSummaryMarkdown({
    sweepId,
    target,
    scopeFiles,
    wave1: wave1Result,
    wave2: wave2Result,
    testProofs,
    judgeVerdict,
    stories: resolvedStories.stories,
    specSource: resolvedStories.specSource
  });

  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({
    sweepId,
    target,
    models: DEFAULT_MODELS,
    wave1: wave1Result,
    wave2: wave2Result,
    tests: testProofs,
    judge: judgeVerdict
  }, null, 2), 'utf8');

  fs.writeFileSync(path.join(outputDir, 'summary.md'), summaryMd, 'utf8');

  return {
    sweepId,
    outputDir,
    scopeFiles,
    wave1: wave1Result,
    wave2: wave2Result,
    wave3: wave3Result,
    testProofs,
    judgeVerdict,
    storiesContext,
    summaryMd
  };
}
