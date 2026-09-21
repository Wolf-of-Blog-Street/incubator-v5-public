---
name: brain-session-end
description: >-
  Close out work in the current context by rewriting its working memory through Opus 4.5. Use when
  the operator says "session end", "we're done", "wrap up", "finish here", "that's it for today",
  or when you are about to drop a context you did real work in. Lighter than brain-self-kickoff:
  no resume prompt, no durable-card review, just the working memory left clean for the next agent.
---

# brain-session-end

Leave the working memory for the context you worked in exactly as the next agent needs it. Nothing
more.

## Steps

1. **Check which card serves.** `node harness/components/brain/tools/wm.mjs which`. If more than one
   context is loaded, run the steps below once per context you worked in, with `--context <slug>`.
2. **Write the digest.** What is true now that was not true at the start: state of play, what is
   mid-stream and where it stops, live constraints and gotchas found, exact next actions. Skip
   what is finished unless knowing it changes what the next agent does.
3. **Update through Opus 4.5.**
   ```bash
   printf '%s' "$DIGEST" | node harness/components/brain/tools/wm.mjs update --event end
   ```
   Read the card it prints. If it kept something that no longer matters, or dropped something the
   next agent needs, run it again with a sharper digest. Never edit the card by hand.
4. **Durable facts go elsewhere.** A decision belongs in the design doc. A how-it-works belongs in
   `docs/system/`. A reusable finding belongs in its own brain card. Working memory is not the place
   for any of these; it only points at them when the next agent must know they exist.

That's the whole skill. If the operator wants a resume prompt for the next session, use
`brain-self-kickoff` instead; it includes this step.
