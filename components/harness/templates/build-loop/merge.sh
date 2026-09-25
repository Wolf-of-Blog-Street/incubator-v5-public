#!/bin/sh
# merge.sh <job> "<commit message>": the reviewer ships its own job with this, and with nothing else.
# It waits its turn, rebases the job onto main, runs the full check on the REBASED revision in the
# job's workspace, and only when that check passes: moves main, pushes, closes the board job and
# forgets the workspace. On a conflict or a failed check it exits non-zero with the output; main has not moved.
#
# Set for your project (export, or edit the defaults):
#   SEAT_ROOT  the seat folder (has harness/)          REPO       the project repository (jj)
#   WS_DIR     folder of the job workspaces (<WS_DIR>/<job>)   CHECK_CMD  the full check, run once (default: make check)
#   CHECK_DIR  folder inside the workspace to run it in (default: .)   PROJECT  board project name (optional)
#   MIGRATION_DIRS  numbered migration folders, relative to the workspace (optional, globs allowed)
set -e
: "${SEAT_ROOT:?}" "${REPO:?}" "${WS_DIR:?}"; CHECK_CMD=${CHECK_CMD:-make check}; CHECK_DIR=${CHECK_DIR:-.}
JOB=$1; MSG=$2; [ -n "$JOB" ] && [ -n "$MSG" ] || { echo 'usage: merge.sh <job> "<commit message>"'; exit 2; }
WS=$WS_DIR/$JOB; LOCK=${LOCK:-$WS_DIR/.merge-lock}; LOGS=${LOGS:-$WS_DIR/../runs}; mkdir -p "$LOGS"
. "$(dirname "$0")/lock.sh"; take_lock "job-$JOB"
cd "$WS"
CH=$(jj log --no-graph -r @ -T 'change_id.short()')
# The workspace's own name, whatever it is (job<id>, astra-<id>, ...). ponytail: the first name if two workspaces share @.
WSNAME=$(jj log --no-graph -r @ -T 'working_copies' | sed 's/@.*//; s/ .*//')
jj describe -m "$MSG" >/dev/null
# Parallel merges all add lines under CHANGELOG.md's "## Unreleased": the usual rebase conflict. Keep
# this job's own lines (they end in [<job>]) with their ### group, so a CHANGELOG-only conflict resolves here.
CL=$LOGS/$JOB-changelog-lines; : > "$CL"
[ -f CHANGELOG.md ] && awk -v j="[$JOB]" '/^## Unreleased/{u=1;next} u&&/^## /{exit} u&&/^### /{g=$0} u&&index($0,j){print g; print}' CHANGELOG.md > "$CL"
jj rebase -d main >/dev/null 2>&1 || { echo "REBASE CONFLICT for job $JOB"; jj st | head -20; exit 2; }
if [ -s "$CL" ] && [ "$(jj log --no-graph -r @ -T 'if(conflict, "C", "")')" = "C" ] && ! jj st | grep 'sided conflict' | grep -vq '^CHANGELOG.md '; then
  jj restore --from main CHANGELOG.md >/dev/null 2>&1 && python3 "$(dirname "$0")/cl-resolve.py" "$CL" && echo "CHANGELOG conflict resolved for job $JOB"
fi
[ "$(jj log --no-graph -r @ -T 'if(conflict, "C", "")')" = "C" ] && { echo "REBASE CONFLICT for job $JOB: resolve it in the workspace, then run merge.sh again"; jj st | head -20; exit 2; }
# Two parallel jobs can take the same migration number; each tree alone has one, so only the rebased tree shows it.
for m in $MIGRATION_DIRS; do
  d=$(ls "$m" | sed -n 's/^\([0-9][0-9]*\).*/\1/p' | sort | uniq -d | tr '\n' ' ')
  [ -z "$d" ] || { echo "MIGRATION NUMBER CLASH for job $JOB in $m: $d(renumber this job's migration); main NOT moved"; exit 3; }
done
# Main moves only when the rebased revision passes the check.
if (cd "$WS/$CHECK_DIR" && sh -c "$CHECK_CMD") > "$LOGS/$JOB-merge-check.log" 2>&1; then echo "check on the rebased revision: OK"
else echo "check on the rebased revision: FAILED (see $LOGS/$JOB-merge-check.log); main NOT moved"; tail -20 "$LOGS/$JOB-merge-check.log"; exit 3; fi
jj bookmark set main -r "$CH" >/dev/null
cd "$REPO"; jj new main >/dev/null 2>&1 || true; jj workspace update-stale >/dev/null 2>&1 || true
jj git push --bookmark main 2>&1 | tail -1
(cd "$SEAT_ROOT" && node harness/components/board/tools/board.mjs set "$JOB" --status done ${PROJECT:+--project "$PROJECT"} 2>&1 | tail -1)
jj workspace forget "$WSNAME" >/dev/null 2>&1 && echo "workspace $WSNAME forgotten" || true
