#!/bin/sh
# cmux-tell.sh <workspace> <surface> "<text>": deliver one message to an agent in another cmux surface
# (Claude Code or Codex) and submit it. The text goes first; the submit is a raw carriage return,
# because `cmux send-key enter` does not submit in Claude Code. The return is repeated until the
# text has left the input box (an extra return on an empty box does nothing). Exit 1 if it never left.
WS=$1; SF=$2; TEXT=$3
[ -n "$WS" ] && [ -n "$SF" ] && [ -n "$TEXT" ] || { echo 'usage: cmux-tell.sh <workspace> <surface> "<text>"'; exit 2; }
SNIP=$(printf %s "$TEXT" | head -c 30)
# The input box: the lines between the last two ──── rules on screen (Claude Code); the last 6 lines otherwise.
inbox() { cmux read-screen --workspace "$WS" --surface "$SF" --lines 40 2>/dev/null | awk '/^─{10}/{n++; if(n>1){buf=""}; next} {buf=buf $0 "\n"} END{printf "%s", buf}' | tail -n 8; }
cmux send --workspace "$WS" --surface "$SF" "$TEXT" >/dev/null || exit 1
for i in 1 2 3 4 5; do
  sleep 2
  cmux send --workspace "$WS" --surface "$SF" "$(printf '\r')" >/dev/null
  sleep 2
  inbox | grep -qF -- "$SNIP" || { echo "delivered to $WS $SF"; exit 0; }
done
echo "NOT delivered to $WS $SF: the text is still in the input box"; exit 1
