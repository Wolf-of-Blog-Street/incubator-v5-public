import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveScope,
  executeAdversarialTest,
  runAdversarialTestSuite,
  formatSummaryMarkdown,
  runSweep
} from '../engine/sweeper.mjs';

test('resolveScope finds files recursively and respects ignore lists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-scope-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'file1.mjs'), 'export const a = 1;');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'file2.js'), 'const b = 2;');
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'ignored.js'), 'ignored');

    const files = resolveScope(tmpDir, tmpDir);
    assert.equal(files.length, 2);
    const paths = files.map(f => f.path);
    assert.ok(paths.includes('file1.mjs'));
    assert.ok(paths.includes(path.join('sub', 'file2.js')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a generated test never sees the operator environment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-env-'));
  const f = path.join(dir, 'env.test.mjs');
  fs.writeFileSync(f, "import assert from 'node:assert';\nassert.equal(process.env.SWEEPER_SECRET_PROBE, undefined);\nassert.notEqual(process.env.HOME, " + JSON.stringify(os.homedir()) + ");\nassert.equal(process.env.SWEEPER_ALLOWED, 'yes');\n");
  process.env.SWEEPER_SECRET_PROBE = 'token'; process.env.SWEEPER_ALLOWED = 'yes'; process.env.SWEEPER_TEST_ENV = 'SWEEPER_ALLOWED';
  try { const r = executeAdversarialTest(f); assert.equal(r.passed, true, r.stderr); }
  finally { delete process.env.SWEEPER_SECRET_PROBE; delete process.env.SWEEPER_ALLOWED; delete process.env.SWEEPER_TEST_ENV; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('executeAdversarialTest runs a test script and captures pass/fail status', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-exec-test-'));
  try {
    const passingTest = path.join(tmpDir, 'pass.test.mjs');
    fs.writeFileSync(passingTest, `
      import test from 'node:test';
      import assert from 'node:assert/strict';
      test('passes', () => { assert.equal(1, 1); });
    `);

    const passResult = executeAdversarialTest(passingTest);
    assert.equal(passResult.passed, true);
    assert.equal(passResult.exitCode, 0);

    const failingTest = path.join(tmpDir, 'fail.test.mjs');
    fs.writeFileSync(failingTest, `
      import test from 'node:test';
      import assert from 'node:assert/strict';
      test('fails', () => { assert.equal(1, 2); });
    `);

    const failResult = executeAdversarialTest(failingTest);
    assert.equal(failResult.passed, false);
    assert.notEqual(failResult.exitCode, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runSweep runs the complete 3-wave pipeline and synthesizes reports', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-pipeline-test-'));
  try {
    const srcFile = path.join(tmpDir, 'sample.mjs');
    fs.writeFileSync(srcFile, `
      export function divide(a, b) {
        if (b === 0) throw new Error("Division by zero");
        return a / b;
      }
    `);

    // Mock LLM Driver to simulate the 3 waves
    const mockDriver = {
      async executeWave1() {
        return {
          wave: 1,
          hunter: 'gemini-3.6-flash',
          findings: [
            {
              id: 'W1-01',
              severity: 'low',
              category: 'defensive',
              file: 'sample.mjs',
              line: 3,
              title: 'Division by zero throws unhandled error',
              suggested_fix: 'Return null or result object'
            }
          ]
        };
      },
      async executeWave2({ wave1 }) {
        return {
          wave: 2,
          hunter: 'gemini-3.8-flash',
          findings: [
            {
              id: 'W2-01',
              severity: 'medium',
              category: 'integrity',
              file: 'sample.mjs',
              lines: [2, 5],
              title: 'Non-number input causes NaN without validation',
              invariant_violated: 'Function assumes inputs are numeric',
              suggested_fix: 'Validate typeof a and b === "number"'
            }
          ]
        };
      },
      async executeWave3() {
        return {
          wave: 3,
          role: 'adversarial-test-generator',
          tests: [
            {
              test_name: 'test_divide_by_zero',
              target_finding_id: 'W1-01',
              code: `
                import test from 'node:test';
                import assert from 'node:assert/strict';
                test('division by zero behavior', () => {
                  assert.equal(1, 1);
                });
              `
            }
          ]
        };
      },
      async executeJudge({ wave1, wave2, testProofs }) {
        return {
          verdict: 'clean',
          judge: 'gemini-3.8-flash',
          summary: {
            total_reviewed: 2,
            stamped_verified: 0,
            discarded_trivia: 2
          },
          stamped_bugs: [],
          discarded_findings: [
            { original_id: 'W1-01', reason: 'Throwing an Error is expected JavaScript behavior.' },
            { original_id: 'W2-01', reason: 'Caller contract specifies numeric inputs.' }
          ]
        };
      }
    };

    const res = await runSweep({
      target: srcFile,
      baseDir: tmpDir,
      runDir: path.join(tmpDir, '.runs', 'test-run'),
      llmDriver: mockDriver
    });

    assert.equal(res.judgeVerdict.verdict, 'clean');
    assert.equal(res.testProofs.length, 1);
    assert.equal(res.testProofs[0].passed, true);
    assert.ok(fs.existsSync(path.join(res.outputDir, 'summary.json')));
    assert.ok(fs.existsSync(path.join(res.outputDir, 'summary.md')));
    assert.ok(res.summaryMd.includes('Incubator v5 Bug Sweep Report'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a model step that fails does not end the sweep and never reads as clean', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-failed-step-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.mjs'), 'export const a = 1;');
    const ok = { findings: [], tests: [], stamped_bugs: [], discarded_findings: [], verdict: 'clean', summary: {} };
    const res = await runSweep({
      target: tmpDir, baseDir: tmpDir, runDir: path.join(tmpDir, 'run'),
      llmDriver: { executeWave1: async () => ok, executeWave2: async () => { throw new Error('Failed to parse JSON response'); }, executeWave3: async () => ok, executeJudge: async () => ({ ...ok }) }
    });
    assert.equal(res.judgeVerdict.verdict, 'incomplete');
    assert.match(res.summaryMd, /Wave 2 FAILED, this sweep is incomplete/);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('the bug collector logs what the judge stamped, never raw model candidates', async () => {
  const { extractBugsFromRun } = await import('../tools/collect-and-log-bugs.mjs');
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-collect-'));
  try {
    fs.mkdirSync(path.join(run, 'astra'));
    fs.writeFileSync(path.join(run, 'astra', 'astra_result.txt'), JSON.stringify({ findings: [{ id: 'ASTRA-01', title: 'raw one' }, { id: 'ASTRA-02', title: 'raw two' }] }));
    fs.writeFileSync(path.join(run, 'deep-summary.json'), JSON.stringify({ judge: { verdict: 'issues_detected', stamped_bugs: [{ id: 'BUG-01', title: 'stamped', file: 'a.mjs' }] } }));
    assert.deepEqual(extractBugsFromRun(run, 'components/x').map(b => b.title), ['stamped']);
  } finally { fs.rmSync(run, { recursive: true, force: true }); }
});

test('the bug collector finds a run in the sweeps layout, and a run of a path inside the component', async () => {
  const { findLatestRunForTarget } = await import('../tools/collect-and-log-bugs.mjs');
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-runs-'));
  try {
    const run = path.join(runs, 'sweeps', 'board', 'sweep-2'); fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ target: 'workspaces/x/components/board/engine/board.mjs' }));
    assert.equal(findLatestRunForTarget('components/board', runs), run);
    assert.equal(findLatestRunForTarget('components/brain', runs), null);
  } finally { fs.rmSync(runs, { recursive: true, force: true }); }
});

test('a model reply with code fences inside its JSON strings keeps its findings; junk throws', async () => {
  const { parseModelJson } = await import('../engine/deepSweeper.mjs');
  const reply = '```json\n' + JSON.stringify({ findings: [{ id: 'OPUS-01', recommended_fix: '```js\nconst a = 1;\n```' }] }, null, 2) + '\n```';
  assert.equal(parseModelJson(reply).findings[0].id, 'OPUS-01');
  assert.throws(() => parseModelJson('I could not audit this.'), /not JSON/);
});

test('a wave 3 entry with no code, or a test that cannot import, is a harness error and never proof', async () => {
  const { runAdversarialTestSuite } = await import('../engine/sweeper.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-suite-'));
  try {
    const proofs = runAdversarialTestSuite([{ test_name: 'no_code' }, { test_name: 'bad_import', test_code: "import x from './nope.mjs';" }], out);
    assert.deepEqual(proofs.map(p => [p.passed, p.isHarnessError]), [[false, true], [false, true]]);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
