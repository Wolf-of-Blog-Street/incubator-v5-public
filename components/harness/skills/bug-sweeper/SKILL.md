---
name: bug-sweeper
description: >-
  Run bug sweeps on a component and pass the findings back, sweep after sweep. Use when the operator says
  "sweep", "bug sweep", "run a sweep on <target>", "run another sweep", "sweep it again", "deep sweep", or asks
  to harden code before production. One sweep is three waves and a judge; "run another sweep" (or "another wave")
  means a full new sweep on the same target with the sweep ledger passed in.
---

# Bug Sweeper

The full teaching is HARNESS.md section 10. This card is the short form.

## Words
- **Wave**: one model pass. Wave 1 breadth (`gemini-3.6-flash`), wave 2 depth (`gemini-3.8-flash`), wave 3 generated tests that run (`gemini-3.7-flash`), then the judge (`gemini-3.8-flash`).
- **Sweep**: one full run, three waves and the judge. A **deep sweep** (`--deep`) adds Claude Fable 5.1 (medium effort), Claude Opus 5.5 (`xhigh` effort, up to 30 minutes) and Codex `gpt-6-astra` (high effort) to the Gemini baseline, then one judge over all findings. `--skip-claude` drops both Claude passes.
- **Ledger**: `.runs/sweeps/<target-slug>/ledger.md`. One per target. Every sweep reads it through `--prior`, standard and deep alike.

## Run
```bash
T=.runs/sweeps/<target-slug>
node harness/components/sweeper/tools/sweep.mjs --target <path> --spec <design doc> --run-dir $T/sweep-1
node harness/components/sweeper/tools/sweep.mjs --target <path> --spec <design doc> --prior $T/ledger.md --run-dir $T/sweep-2
node harness/components/sweeper/tools/sweep.mjs --target <path> --spec <design doc> --prior $T/ledger.md --run-dir $T/deep-3 --deep
```
Number the run folders in order. When `$T/ledger.md` exists, always pass it.

## After every sweep, before you report
1. Read `summary.md` (or `deep-summary.md`). Give your own verdict on each stamped bug: check it against the real system. Read the generated test before you trust it.
2. Fix the real bugs at the root cause. Leave a regression test that fails on the old code.
3. Write the ledger. Four parts, kept current, not a diary:
   - **Facts**: what you measured about the real system. These stop false findings.
   - **Fixed**: finding, location, what the fix does.
   - **Rejected**: finding and reason, with the judge's discards you agree with.
   - **Look next**: areas not covered yet, and the code the last fixes changed most.
4. Report: real and fixed, rejected and why, discarded, and if another sweep is worth the run.

Stop when a sweep stamps nothing real. For code that must not fail: standard sweeps until quiet, one deep sweep, then a standard sweep over the deep sweep's fixes.

## Sandbox
Wave 3 runs generated tests with the environment of the sweep command. When the target writes outside the repo (a store in `$HOME`, the Keychain, a live service), set its paths to scratch folders, its URLs to a dead port, and put a no-op stand-in first in `PATH` for any system command it calls.
