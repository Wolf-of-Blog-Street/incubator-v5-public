#!/bin/sh
# main-push.sh "<commit message>": EVERY other writer to main (the lead's doc commits, a hotfix) uses
# this, so main never moves while a job's rebased revision is in its check. Same lock as merge.sh.
set -e
: "${REPO:?}" "${WS_DIR:?}"; LOCK=${LOCK:-$WS_DIR/.merge-lock}
[ -n "$1" ] || { echo 'usage: main-push.sh "<commit message>"'; exit 2; }
. "$(dirname "$0")/lock.sh"; take_lock "main-push"
cd "$REPO"
jj describe -m "$1" >/dev/null
jj rebase -d main >/dev/null 2>&1 || true
[ "$(jj log --no-graph -r @ -T 'if(conflict, "C", "")')" = "C" ] && { echo "CONFLICT with main: resolve it in $REPO"; exit 2; }
CH=$(jj log --no-graph -r @ -T 'change_id.short()')
jj new >/dev/null && jj bookmark set main -r "$CH" >/dev/null && jj git push --bookmark main 2>&1 | tail -1
