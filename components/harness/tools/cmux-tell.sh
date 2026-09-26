#!/bin/sh
# cmux-tell.sh <workspace> <surface> "<text>": deliver one message to an agent in another cmux surface
# (Claude Code or Codex) and submit it. The text goes first; the submit is a raw carriage return,
# because `cmux send-key enter` does not submit in Claude Code. The return is repeated until the
# text has left the input box (an extra return on an empty box does nothing).
# It never types over a draft: while the box holds text (someone is typing), it waits, then gives up.
# Exit 0 delivered, 1 not delivered, 3 the box stayed busy with someone else's text. Must run inside cmux.
WS=$1; SF=$2; TEXT=$3
[ -n "$WS" ] && [ -n "$SF" ] && [ -n "$TEXT" ] || { echo 'usage: cmux-tell.sh <workspace> <surface> "<text>"'; exit 2; }
SNIP=$(printf %s "$TEXT" | head -c 30)
# The input box: the text on the last prompt line (❯ Claude Code, › Codex). Placeholders count as empty.
box() {
  cmux read-screen --workspace "$WS" --surface "$SF" --lines 40 2>/dev/null \
    | grep -E '^[[:space:]]*(❯|›)' | tail -n 1 | sed -E 's/^[[:space:]]*(❯|›)[[:space:]]?//' \
    | sed -E 's/^(Try ".*"|Press up to edit queued messages|Ask Codex to do anything|Implement \{feature\}|Find and fix a bug in @filename|Summarize recent commits|Write tests for @filename|Improve documentation in @filename|Run \/review on my current changes|Use \/skills to list available skills)[[:space:]]*$//'
}
n=0; while [ -n "$(box)" ]; do n=$((n+1)); [ $n -gt 24 ] && { echo "BUSY: $WS $SF has a draft in its input box; not delivered"; exit 3; }; sleep 5; done
cmux send --workspace "$WS" --surface "$SF" "$TEXT" >/dev/null || exit 1
for i in 1 2 3 4 5; do
  sleep 2
  cmux send --workspace "$WS" --surface "$SF" "$(printf '\r')" >/dev/null
  sleep 2
  box | grep -qF -- "$SNIP" || { echo "delivered to $WS $SF"; exit 0; }
done
echo "NOT delivered to $WS $SF: the text is still in the input box"; exit 1
