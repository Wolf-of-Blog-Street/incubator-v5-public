---
name: brain-self-kickoff
description: >-
  End-of-session memory write-back and clean handoff. Use when the operator asks for a
  "self-kickoff", "hand off", at the end of a long session, or when context is getting full.
  Updates the brain cards, rewrites the current context's working memory through Opus 4.5 with
  the state of play and exact next steps, and produces a resume prompt for the next session.
---

# brain-self-kickoff — Session Memory Write-Back & Handoff

When a session concludes or context is getting large, use this skill to persist durable knowledge to your brain and generate a clean resume prompt.

---

## 1. Update Durable Brain Cards
Review what happened during the session and record durable knowledge into `brain/`:

```bash
# Create or update specific knowledge cards
node harness/engine/brain.mjs new --entity note --slug <slug> --description "<description>"
```

- **New durable findings / architecture decisions**: Save to a dedicated note card.
- **Completed tasks**: Update or archive in brain.
- **Resolved items**: Mark finished.

---

## 2. Rewrite the Working Memory Through Opus 4.5
Working memory is per context: `wm-<context>` for the loaded context, `working-memory` when none is
loaded. You never write it yourself. Write a digest and hand it to the `wm` tool, which asks Opus 4.5
to rewrite the card whole:

```bash
node harness/components/brain/tools/wm.mjs which          # which card this handoff updates
printf '%s' "$DIGEST" | node harness/components/brain/tools/wm.mjs update --event kickoff
```

The digest is what you know now: state of play, what is mid-stream, live constraints and gotchas,
exact next actions. Opus keeps what a future agent must know and drops the rest. The card is not a
record: no log of the session, no decisions list, no rules, nothing the operator said. If more than
one context is loaded, run it once per context you worked in with `--context <slug>`.

Read the card the tool prints. That is what the next session starts from.

---

## 3. Emit the Resume / Kickoff Prompt
Generate a clear, self-contained prompt for the operator to paste into the next session:

```markdown
### 🧠 Session Kickoff / Resume Prompt

Start the next session with the following prompt:
---
I am resuming work on [Project/Component].
- **Current State**: [Brief 1-2 sentence summary of what is done]
- **Active Task**: [The immediate next milestone to tackle]
- **Action Plan**:
  1. [Step 1]
  2. [Step 2]
---
```
