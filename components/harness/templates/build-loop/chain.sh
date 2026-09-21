#!/bin/sh
# chain.sh <job>: run the coder, then the reviewer the moment the coder exits. No job waits to be
# noticed between the two (that wait measured 19% of job time). No timer on either run: a run ends
# when the agent ends its turn, and a live orchestrator decides when a run has gone on too long.
#
# Set: SEAT_ROOT, WS_DIR (job workspaces), CARDS (folder of <job>.md cards), PROMPTS (this folder,
# with your project's coder-prompt.md and reviewer-prompt.md), LOGS. Models: CODER_MODEL, REVIEWER_MODEL.
set -e
: "${SEAT_ROOT:?}" "${WS_DIR:?}" "${CARDS:?}" "${PROMPTS:?}" "${LOGS:?}"
JOB=$1; [ -n "$JOB" ] || { echo "usage: chain.sh <job>"; exit 2; }
FRIEND="node $SEAT_ROOT/harness/components/friends/tools/friend.mjs"; mkdir -p "$LOGS"
run() { # run <role> <model> <prompt-file>
  $FRIEND run claude --model "$2" --effort medium --no-jj --prompt-file "$3" --cwd "$WS_DIR/$JOB" --timeout 0 > "$LOGS/$JOB-$1.log" 2>&1
}
{ cat "$PROMPTS/coder-prompt.md"; echo; echo ---; echo; cat "$CARDS/$JOB.md"; } > "$LOGS/$JOB-coder-prompt.md"
run coder "${CODER_MODEL:-claude-opus-5}" "$LOGS/$JOB-coder-prompt.md" || echo "coder exited non-zero; the reviewer judges the code alone"
(cd "$SEAT_ROOT" && node harness/components/board/tools/board.mjs set "$JOB" --status review >/dev/null 2>&1) || true
{ cat "$PROMPTS/reviewer-prompt.md"; echo; echo ---
  echo "Your workspace: $WS_DIR/$JOB. The coder's run log (its report is the last message): $LOGS/$JOB-coder.log. Write your report to $LOGS/$JOB-review.md."
  echo; echo ---; echo; cat "$CARDS/$JOB.md"; } > "$LOGS/$JOB-review-prompt.md"
run reviewer "${REVIEWER_MODEL:-claude-fable-5-1}" "$LOGS/$JOB-review-prompt.md"
