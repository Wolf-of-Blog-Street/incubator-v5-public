import path from 'node:path';
import { runSweep } from '../engine/sweeper.mjs';

// Realistic 3-wave driver simulating the behavior of 3.6 Flash (breadth), 3.8 Flash (depth),
// 3.7 Flash (adversarial test generation), and 3.8 Flash (Judge).
const dogfoodDriver = {
  async executeWave1({ scopeFiles }) {
    return {
      wave: 1,
      hunter: 'gemini-3.6-flash',
      findings: [
        {
          id: 'W1-01',
          severity: 'medium',
          category: 'defensive',
          file: 'components/board/engine/board.mjs',
          line: 48,
          title: 'Unchecked non-string title causes unhandled TypeError',
          description: 'Calling addItem({ title: 12345 }) throws TypeError: title.trim is not a function instead of a clean validation Error.',
          suggested_fix: 'Validate typeof title === "string" before calling .trim()'
        },
        {
          id: 'W1-02',
          severity: 'low',
          category: 'contract',
          file: 'components/board/engine/board.mjs',
          line: 47,
          title: 'VALID_TRACKS defined but never enforced in addItem or updateItem',
          description: 'export const VALID_TRACKS exists but addItem allows any arbitrary string (e.g. track: "nonsense").',
          suggested_fix: 'Enforce VALID_TRACKS.includes(track) or document that tracks are open-ended.'
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
          severity: 'high',
          category: 'integrity',
          file: 'components/board/engine/board.mjs',
          lines: [48, 70],
          title: 'Type coercion vulnerability in title validation across addItem and updateItem',
          invariant_violated: 'Input validation contract states that task title must be a non-empty string.',
          failure_scenario: 'Passing non-string primitives (numbers, booleans, objects) bypasses string length checks and causes uncaught runtime exceptions in caller processes.',
          related_wave1_id: 'W1-01',
          suggested_fix: 'Normalize or guard typeof title === "string" && title.trim().length > 0.'
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
          test_name: 'test_adversarial_title_types',
          target_finding_id: 'W1-01',
          code: `
            import test from 'node:test';
            import assert from 'node:assert/strict';
            import { openBoard } from '../../components/board/engine/board.mjs';
            import os from 'node:os';
            import path from 'node:path';
            import fs from 'node:fs';

            test('adversarial test: passing numeric title to addItem', () => {
              const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-board-'));
              try {
                const board = openBoard(path.join(tmpDir, 'test.sqlite'));
                // Should either cleanly accept or throw "Task title is required"
                assert.throws(() => {
                  board.addItem({ title: 12345 });
                }, (err) => {
                  // If it throws a raw TypeError instead of clean Error, that proves the bug!
                  return err instanceof TypeError;
                });
                board.close();
              } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
              }
            });
          `
        },
        {
          test_name: 'test_adversarial_track_permissiveness',
          target_finding_id: 'W1-02',
          code: `
            import test from 'node:test';
            import assert from 'node:assert/strict';
            import { openBoard, VALID_TRACKS } from '../../components/board/engine/board.mjs';
            import os from 'node:os';
            import path from 'node:path';
            import fs from 'node:fs';

            test('adversarial test: track field accepts unlisted track', () => {
              const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-track-'));
              try {
                const board = openBoard(path.join(tmpDir, 'test.sqlite'));
                const id = board.addItem({ title: 'Valid task', track: 'unlisted_track_99' });
                const item = board.getItem(id);
                assert.equal(item.track, 'unlisted_track_99');
                assert.equal(VALID_TRACKS.includes('unlisted_track_99'), false);
                board.close();
              } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
              }
            });
          `
        }
      ]
    };
  },

  async executeJudge({ wave1, wave2, testProofs }) {
    const rawTypeErrorTest = testProofs.find(t => t.test_name === 'test_adversarial_title_types');
    const trackTest = testProofs.find(t => t.test_name === 'test_adversarial_track_permissiveness');

    return {
      verdict: 'issues_detected',
      judge: 'gemini-3.8-flash',
      summary: {
        total_reviewed: 3,
        stamped_verified: 2,
        discarded_trivia: 1
      },
      stamped_bugs: [
        {
          id: 'BUG-01',
          severity: 'MEDIUM',
          file: 'components/board/engine/board.mjs',
          line: 48,
          title: 'Unchecked title primitive causes raw TypeError instead of contract validation error',
          root_cause: 'board.mjs assumes typeof title === "string" and directly invokes .trim() without typeof guard.',
          dynamic_repro: rawTypeErrorTest?.passed ? 'REPRODUCED (TypeError thrown on numeric title)' : 'NOT_TESTED',
          recommended_fix: 'if (typeof title !== "string" || !title.trim()) throw new Error("Task title is required");'
        },
        {
          id: 'BUG-02',
          severity: 'LOW',
          file: 'components/board/engine/board.mjs',
          line: 47,
          title: 'Unenforced VALID_TRACKS allows arbitrary track identifiers',
          root_cause: 'VALID_TRACKS is exported as a constant set but addItem and updateItem do not validate against it.',
          dynamic_repro: trackTest?.passed ? 'REPRODUCED (Unlisted track was inserted)' : 'NOT_TESTED',
          recommended_fix: 'Add validation: if (track && !VALID_TRACKS.includes(track)) throw new Error(`Invalid track: ${track}`);'
        }
      ],
      discarded_findings: [
        {
          original_id: 'W1-01',
          reason: 'Subsumed into unified finding BUG-01.'
        }
      ]
    };
  }
};

async function run() {
  console.log('🚀 Running 3-Wave Dogfood Bug Sweep on Incubator v5 Board Engine...\n');
  const res = await runSweep({
    target: 'components/board/engine/board.mjs',
    baseDir: process.cwd(),
    llmDriver: dogfoodDriver
  });

  console.log('🎉 Dogfood Sweep Finished!');
  console.log(`📁 Report: ${path.join(res.outputDir, 'summary.md')}\n`);
  console.log(res.summaryMd);
}

run();
