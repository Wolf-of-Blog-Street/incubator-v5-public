# lock.sh: sourced by merge.sh and main-push.sh. One writer to main at a time.
# take_lock <owner-label>. The owner file holds "<label> <pid>". A lock whose pid is dead is
# stale (its run was killed) and is cleared here, so nobody clears a lock by hand.
# ponytail: a mkdir lock with a 40 minute wait; use a queue if merges ever pile up past that.
: "${LOCK:?set LOCK to the lock folder path}"
take_lock() {
  n=0
  until mkdir "$LOCK" 2>/dev/null; do
    pid=$(cut -d' ' -f2 "$LOCK/owner" 2>/dev/null)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then echo "stale lock of $(cat "$LOCK/owner") cleared"; rm -rf "$LOCK"; continue; fi
    n=$((n+1)); [ $n -gt 240 ] && { echo "MERGE LOCK held for 40 minutes by $(cat "$LOCK/owner" 2>/dev/null); $1 not merged"; exit 4; }
    sleep 10
  done
  echo "$1 $$" > "$LOCK/owner"; trap 'rm -rf "$LOCK"' EXIT INT TERM
}
