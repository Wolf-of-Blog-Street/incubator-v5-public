---
name: brain-self-kickoff
description: >-
  End-of-session memory write-back and clean handoff. Use when the operator asks for a
  "self-kickoff", "hand off", at the end of a long session, or when context is getting full.
  Updates the brain cards, updates the working-memory card with the current state of play
  and concrete next steps, and produces a resume prompt for the next session.
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

## 2. Update `working-memory` Card
Update your primary `working-memory` card with the latest summary:

1. **Current State**: What was completed in this session.
2. **In-Flight Work**: What is currently mid-stream.
3. **Exact Next Steps**: Concrete, prioritized actions for the next session.

```bash
# Update working-memory body
node harness/engine/brain.mjs new --entity note --slug working-memory --description "Active working memory" 2>/dev/null || true
echo "## Current State of Play\n...\n\n## Exact Next Actions\n1. ..." | node harness/engine/brain.mjs body working-memory
```

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
