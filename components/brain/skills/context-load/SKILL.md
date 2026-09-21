---
name: context-load
description: >-
  Load a brain context and bring its working memory up to date through Opus 4.5. Use when the
  operator says "load <context>", "switch to <context>", "change focus to <context>", "we're on
  <context> now", or when the work in front of you belongs to a world you have not loaded yet.
---

# context-load

Loading a context does two things: it opens the desk in the brain, and it brings that context's
working memory up to date with what you know right now. Both, every time. Never just the first.

## Steps

1. **See what exists.** `node harness/engine/brain.mjs contexts` lists every context with ● on the
   loaded ones. If the world you need has no context yet, mint it first:
   ```bash
   node harness/engine/brain.mjs new --entity context --slug <slug> --description "<what this world is>"
   node harness/engine/brain.mjs set <slug> --field profile.name --to "<Name>"
   node harness/engine/brain.mjs set <slug> --field profile.mission --to "<one line>"
   ```
2. **Load it.** `node harness/engine/brain.mjs context <slug>`. Read the roster it prints.
3. **Write the digest.** In your own words, what you know right now that a future agent in this
   context must know: anything you were already doing that belongs to this world, live constraints,
   gotchas, what is mid-stream, next actions. Include things that were true before you loaded the
   context. Leave out work that belongs to another world.
4. **Update the working memory through Opus 4.5.**
   ```bash
   printf '%s' "$DIGEST" | node harness/components/brain/tools/wm.mjs update --event load
   ```
   Or write the digest to a file and pass `--digest <file>`. The tool reads the current card, asks
   Opus 4.5 to rewrite it whole with the digest folded in and stale lines removed, and writes it
   through the brain. It prints the new card. Read it; that is your working memory now.
5. **Equip the desk.** A context with only a working memory card is empty: loading it shows one
   line and every skill and tool stays hidden in search. In the same turn, wire what serves this
   world. One skill card per seat skill that applies (reuse the card if it exists; a card can sit in
   several contexts), one tool card per script or service, each with an `in_context` edge and a why:
   ```bash
   node harness/engine/brain.mjs new --entity skill --slug skill-<name> --description "<the line that lets an agent choose it>"
   node harness/engine/brain.mjs link skill-<name> --verb in_context --to <slug> --why "<why>"
   node harness/engine/brain.mjs new --entity tool --slug <tool> --description "<what it does>"
   node harness/engine/brain.mjs set <tool> --field profile.command --to "<command>"
   node harness/engine/brain.mjs link <tool> --verb in_context --to <slug> --why "<why>"
   ```
   Notes and references that serve the desk get `in_context` edges the same way: a research card,
   a reference to a file, an idea list. A card with no edge into the desk is invisible to it.
   Then `node harness/engine/brain.mjs context <slug>` must list them. HARNESS.md 5 has the verb
   cheat sheet and the walk-the-graph order; run `brain <verb> --help` before any verb you have
   not used this session.
6. **Keep it current, immediately.** While you work in this context, the moment something changes
   that the next agent must know (you wired a card, found a constraint, moved a state), run:
   ```bash
   printf '%s' "<what changed>" | node harness/components/brain/tools/wm.mjs update --event change
   ```
   The update is the last step of the change, in the same turn. Never say "the card picks it up on
   the next load"; nothing folds in later unless someone writes it into a digest. Never edit
   `brain/__source/wm-*.md` by hand.

## Loading default

"default" is not a context card. It is the working memory that serves when no context is loaded.
"Load default" is two commands, and the second is not optional:

```bash
node harness/engine/brain.mjs context --drop --all
printf '%s' "$DIGEST" | node harness/components/brain/tools/wm.mjs update --event load --context default
```

Before the drop: say what you are about to drop. If the operator asked for default, that is the
yes. If you are choosing it yourself, wait for one. For each loaded context you did work in this
session, run `brain-session-end` first.

The digest for the default card is what belongs to no world: which contexts exist and what each is
for (so the card routes), seat-wide rules, and anything true right now that no context owns. A
default card that names a context that no longer exists, or misses one that does, is stale; the
update is what keeps it right. Read the card the tool prints.

## Switching

Loading a second context does not drop the first. If you are changing worlds, drop the old one:
`node harness/engine/brain.mjs context --drop <old>`. Run `brain-session-end` for the old context
before you drop it if you did real work there. `wm which` tells you which card serves when more than
one is loaded (the last loaded); `--context <slug>` on any `wm` command picks explicitly.

## What the card is for

Only what a future agent must know or it will get hurt. Not a record, not a log, not decisions, not
laws, not what the operator said. The record is the code and `docs/`.
