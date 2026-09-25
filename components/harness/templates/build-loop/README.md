# Build loop templates

A coder and reviewer build, for a project with a complete design and many jobs. Copy this folder into your seat (for example `sandbox/<project>/`), fill the `<PLACEHOLDERS>` in the two prompts, and set the variables at the top of each script. HARNESS.md section 8a is the teaching.

| File | Use |
|---|---|
| `coder-prompt.md` | The coder's contract. One job, the card's files only, lean tests, one full check at the end. |
| `reviewer-prompt.md` | The reviewer's contract. Uses the work by hand, fixes it, ships it with `merge.sh`. Verdicts: SHIPPED, SHIPPED-FIXED, BLOCKED. |
| `chain.sh <job>` | Runs the coder, then the reviewer the moment the coder exits. No timer on either run. |
| `merge.sh <job> "<message>"` | The only way a job reaches main. One merge at a time; the full check runs on the rebased revision before main moves. |
| `cl-resolve.py <lines>` | Called by `merge.sh`: puts the job's `[<job>]` lines back into `CHANGELOG.md` when the changelog is the only rebase conflict. |
| `main-push.sh "<message>"` | Every other writer to main (doc commits, a hotfix). Takes the same lock. |
| `lock.sh` | The lock. The owner file names the owner and its pid; a lock whose pid is dead is cleared by the next caller. |
