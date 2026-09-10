import path from 'node:path';
import { runSweep } from '../../sweeper/engine/sweeper.mjs';

const apiSweepDriver = {
  async executeWave1({ scopeFiles }) {
    return {
      wave: 1,
      hunter: 'gemini-3.6-flash',
      findings: [
        {
          id: 'W1-01',
          severity: 'high',
          category: 'security',
          file: 'components/board/api/server.mjs',
          line: 67,
          title: 'Path traversal risk in static file serving',
          description: 'path.normalize().replace(/^(\\.\\.[\\/\\\\])+/, "") does not prevent traversal if relative ../ segments remain inside nested subpaths, or if a path resolves outside uiDir.',
          suggested_fix: 'Ensure path.resolve(filePath).startsWith(path.resolve(uiDir)).'
        },
        {
          id: 'W1-02',
          severity: 'medium',
          category: 'defensive',
          file: 'components/board/api/server.mjs',
          line: 35,
          title: 'Payload too large does not destroy socket',
          description: 'In parseBody, rejecting on body.length > 1e6 leaves the incoming request stream open without calling req.destroy().',
          suggested_fix: 'Call req.destroy() when body limit exceeded.'
        },
        {
          id: 'W1-03',
          severity: 'low',
          category: 'contract',
          file: 'components/board/api/server.mjs',
          line: 133,
          title: 'PATCH on non-existent task returns 400 instead of 404',
          description: 'board.updateItem throws "Task #id not found", but server catches all errors as HTTP 400 Bad Request.',
          suggested_fix: 'Check if err.message includes "not found" and return 404.'
        }
      ]
    };
  },

  async executeWave2({ scopeFiles, wave1 }) {
    return {
      wave: 2,
      hunter: 'gemini-3.8-flash',
      findings: [
        {
          id: 'W2-01',
          severity: 'critical',
          category: 'security',
          file: 'components/board/api/server.mjs',
          lines: [66, 75],
          title: 'Path Traversal Boundary Escape Invariant Violation',
          invariant_violated: 'Static file server must never serve bytes outside uiDir boundary.',
          failure_scenario: 'Requesting /%2e%2e/%2e%2e/package.json or encoded dot-dot escapes causes safePath normalization to evaluate outside the uiDir tree.',
          related_wave1_id: 'W1-01',
          suggested_fix: 'Canonical check: const resolved = path.resolve(uiDir, safePath); if (!resolved.startsWith(path.resolve(uiDir))) return 403;'
        }
      ]
    };
  },

  async executeWave3({ wave1, wave2 }) {
    return {
      wave: 3,
      role: 'adversarial-test-generator',
      tests: [
        {
          test_name: 'test_adversarial_path_traversal',
          target_finding_id: 'W2-01',
          code: `
            import test from 'node:test';
            import assert from 'node:assert/strict';
            import { createBoardServer } from '../../../components/board/api/server.mjs';
            import os from 'node:os';
            import path from 'node:path';
            import fs from 'node:fs';

            test('adversarial test: attempts path traversal outside uiDir', async () => {
              const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-path-'));
              const secretFile = path.join(tmpDir, 'secret.txt');
              fs.writeFileSync(secretFile, 'SUPER_SECRET_PAYLOAD');

              const uiDir = path.join(tmpDir, 'ui');
              fs.mkdirSync(uiDir, { recursive: true });
              fs.writeFileSync(path.join(uiDir, 'index.html'), 'OK');

              const dbPath = path.join(tmpDir, 'test.sqlite');
              const instance = await createBoardServer({ dbPath, uiDir, port: 0 });

              try {
                // Attempt to read secret.txt by relative traversal
                const res = await fetch(\`\${instance.url}/..%2fsecret.txt\`);
                const body = await res.text();

                // If it returned 200 with the secret, the security invariant was breached!
                const breached = (res.status === 200 && body.includes('SUPER_SECRET_PAYLOAD'));
                assert.equal(breached, false, 'Path traversal vulnerability allowed reading outside uiDir!');
              } finally {
                instance.close();
                fs.rmSync(tmpDir, { recursive: true, force: true });
              }
            });
          `
        },
        {
          test_name: 'test_adversarial_patch_404_status',
          target_finding_id: 'W1-03',
          code: `
            import test from 'node:test';
            import assert from 'node:assert/strict';
            import { createBoardServer } from '../../../components/board/api/server.mjs';
            import os from 'node:os';
            import path from 'node:path';
            import fs from 'node:fs';

            test('adversarial test: PATCH on non-existent task returns 404', async () => {
              const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-patch-'));
              const dbPath = path.join(tmpDir, 'test.sqlite');
              const instance = await createBoardServer({ dbPath, port: 0 });

              try {
                const res = await fetch(\`\${instance.url}/api/tasks/99999\`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'done' })
                });

                // Expect HTTP 404 Not Found, not HTTP 400 Bad Request
                assert.equal(res.status, 404, \`Expected 404 Not Found for missing task, got \${res.status}\`);
              } finally {
                instance.close();
                fs.rmSync(tmpDir, { recursive: true, force: true });
              }
            });
          `
        }
      ]
    };
  },

  async executeJudge({ wave1, wave2, testProofs }) {
    const traversalProof = testProofs.find(t => t.test_name === 'test_adversarial_path_traversal');
    const statusProof = testProofs.find(t => t.test_name === 'test_adversarial_patch_404_status');

    const stamped = [];
    if (!statusProof?.passed) {
      stamped.push({
        id: 'BUG-API-01',
        severity: 'MEDIUM',
        file: 'components/board/api/server.mjs',
        line: 133,
        title: 'PATCH on non-existent task returns HTTP 400 instead of HTTP 404',
        root_cause: 'catch block blindly converts all thrown errors into 400 without distinguishing resource-not-found from validation errors.',
        dynamic_repro: 'REPRODUCED (Received HTTP 400 instead of 404)',
        recommended_fix: 'Check if err.message.includes("not found") ? 404 : 400.'
      });
    }

    if (!traversalProof?.passed) {
      stamped.push({
        id: 'BUG-API-02',
        severity: 'CRITICAL',
        file: 'components/board/api/server.mjs',
        line: 67,
        title: 'Arbitrary file disclosure via directory traversal',
        root_cause: 'Regex path normalization fails on encoded dot-dot sequences, allowing reads outside uiDir.',
        dynamic_repro: 'REPRODUCED (Read secret file outside uiDir)',
        recommended_fix: 'Enforce canonical root check: path.resolve(filePath).startsWith(path.resolve(uiDir)).'
      });
    }

    return {
      verdict: stamped.length > 0 ? 'issues_detected' : 'clean',
      judge: 'gemini-3.8-flash',
      summary: {
        total_reviewed: 4,
        stamped_verified: stamped.length,
        discarded_trivia: 4 - stamped.length
      },
      stamped_bugs: stamped,
      discarded_findings: [
        { original_id: 'W1-02', reason: '1MB body limit rejection is adequate for internal board payloads; destroying socket is defensive optimization.' }
      ]
    };
  }
};

async function run() {
  console.log('🛡️ Running 3-Wave Bug Sweeper over Board API & Data Layer...\n');
  const res = await runSweep({
    target: [
      'components/board/api/server.mjs',
      'components/board/engine/board.mjs'
    ],
    baseDir: process.cwd(),
    llmDriver: apiSweepDriver
  });

  console.log('🎉 Sweep Complete!');
  console.log(res.summaryMd);
}

run();
