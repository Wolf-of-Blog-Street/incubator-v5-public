# Bug Sweeper Re-Architecture: Intent-Driven & User-Story Mental Walkthroughs

- **Status**: Finished
- **Codename**: #d-7
- **Color**: #f43f5e
- **Author**: manager-pm (Fleet Manager & Pair Programmer)
- **Target Component(s)**: `components/sweeper`
- **Last Updated**: 2026-09-09

---

## 1. Context & Problem Statement

The Incubator v5 Bug Sweeper was originally implemented around a generic, synthetic adversarial testing paradigm: feeding raw source files into an LLM and asking it to hunt for theoretical edge cases (missing null guards, unclosed handles, in-memory micro-concurrency races) using isolated `os.tmpdir()` mocks.

This approach failed in practice. For example, during the fleet deployment, a critical bug went undetected where the board client searched only 4 directory levels up instead of 5 for `harness/falcon.env`, causing the client to silently fall back to an offline SQLite database and prevent design docs from syncing to the central board. The original sweeper missed this completely because:
1. It evaluated code in a vacuum without knowing what the code was intended to accomplish.
2. It lacked user stories, API contracts, and knowledge of the runtime directory topology.
3. It engaged in synthetic unit-level fuzzing rather than mental walkthroughs of real operational workflows.

Human software engineers do not audit code by fuzzing random null inputs. Humans audit code by:
1. Asking: *"What is this code supposed to do? Who uses it, and how?"*
2. Mentally walking through the execution path from the user's or caller's perspective line by line.
3. Identifying where the code fails to deliver the intended functionality, breaks the user journey, or silently degrades.

This design document establishes the architectural overhaul of the Bug Sweeper into an **Intent-Driven, User-Story-Powered Simulation Auditor**.

---

## 2. Goals & Explicit Non-Goals

### 2.1 Goals
- [x] **User Story & Spec First**: The sweeper must never audit code in a vacuum. Every sweep must be supplied with or automatically discover the component's user stories, design doc specifications, or API contracts.
- [x] **Simulate Human Mental Walkthroughs**: Waves 1 and 2 must trace execution step-by-step from invocation to completion against real user stories, looking for functional roadblocks and environment misassumptions.
- [x] **Flag Silent Degradation & False Success**: Explicitly detect and flag patterns where code catches errors and silently falls back to a degraded mode without failing loudly or warning the operator.
- [x] **Story-Level Proof Generation (Wave 3)**: Wave 3 test generation must create reproduction tests that execute the broken user story end-to-end rather than synthetic unit-test trivia.
- [x] **Relevance Gavel**: The Judge must reject any finding that does not actually stop the software from working the way it is supposed to in real production use.

### 2.2 Explicit Non-Goals
- **Not a Static Linter**: Sweeper is not an ESLint replacement; it does not report style, naming, or cosmetic formatting concerns.
- **Not a Chaos/Fuzz Testing Suite**: Sweeper does not throw random 10MB payloads or absurd parameter types into functions unless the user story explicitly involves untrusted arbitrary inputs.

---

## 3. Data Models & Interface Contracts

### 3.1 CLI Arguments Contract (`components/sweeper/tools/sweep.mjs`)
```bash
# Explicit spec doc
node components/sweeper/tools/sweep.mjs --target components/board --spec docs/design/falcon-manager-board-roster.md

# Explicit user story
node components/sweeper/tools/sweep.mjs --target components/board/tools/client.mjs --story "Agent runs board sync-doc from a nested workspace folder and expects the doc to appear on the remote Falcon Board"

# Auto-discovery mode (finds matching design doc or README)
node components/sweeper/tools/sweep.mjs --target components/board
```

### 3.2 User Story Data Model
```json
{
  "stories": [
    {
      "id": "US-01",
      "actor": "Agent / Developer",
      "action": "Executes `board sync-doc <slug>` from `workspaces/<project>` directory",
      "expected_outcome": "Discovers seat environment, connects via HTTP to remote board on localhost:3333 with Bearer token, and uploads the doc without falling back to local offline SQLite.",
      "critical_invariants": [
        "Must traverse directory hierarchy until `harness/falcon.env` is found",
        "Must fail loudly if token or server is unreachable rather than silently pretending to succeed"
      ]
    }
  ]
}
```

### 3.3 Re-Architected 3-Wave Prompt Pipeline

```
Target Files + User Stories / Specs
    │
    ▼
🌊 [Wave 1: Story-to-Code Walkthrough] (gemini-3.6/3.8)
   - Line-by-line mental walkthrough of each user story
   - Pinpoints where code fails to deliver the expected outcome
    │
    ▼
🌊 [Wave 2: Operational Reality & Silent Failures] (gemini-3.8)
   - Audits environmental assumptions (paths, CWD, remote vs local, permissions)
   - Unmasks silent fallbacks, swallowed errors, and false successes
    │
    ▼
🌊 [Wave 3: Broken Workflow Reproduction] (gemini-3.7/3.8)
   - Generates executable test reproducing the exact broken user story
    │
    ▼
⚖️  [Presiding Judge: Real-Use Gavel] (gemini-3.8-flash-high)
   - Filter rule: "Does this prevent real use as described in the user stories?"
   - Drops trivia; stamps verified workflow-breaking bugs
```

---

## 4. Implementation Milestones

- [x] **Milestone 1: Spec & Story Resolution Engine**
  - Implement `resolveStories({ target, specPath, storyText, baseDir })` in `sweeper.mjs`.
  - Auto-discover matching design docs in `docs/design/*.md` by component name matching.
  - Parse user stories and acceptance criteria from design doc markdown.

- [x] **Milestone 2: Prompt Suite Overhaul**
  - Rewrite `prompts/wave1-breadth.md` -> `prompts/wave1-story-walkthrough.md`.
  - Rewrite `prompts/wave2-depth.md` -> `prompts/wave2-operational-reality.md`.
  - Rewrite `prompts/wave3-adversarial.md` -> `prompts/wave3-story-proof.md`.
  - Update `prompts/judge-gavel.md` with the "Real-Use Invariant" filter.

- [x] **Milestone 3: Engine & CLI Integration**
  - Update `components/sweeper/engine/sweeper.mjs` to incorporate stories across all waves.
  - Wire `--spec` and `--story` into `components/sweeper/tools/sweep.mjs`.
  - Format reports to tie stamped bugs directly to broken user stories.

- [x] **Milestone 4: Verification & Dogfooding**
  - Run the upgraded sweeper against `components/board/tools/client.mjs` using the real user story that previously failed.
  - Verify that the sweeper accurately evaluates the user story.
  - Update living documentation in `harness/HARNESS.md`.

---

## 5. Verification Plan

### 5.1 Automated Tests
```bash
# Test story resolution and prompt injection
node --test components/sweeper/tests/story-resolution.test.mjs
```

### 5.2 Dogfooding Run
```bash
node components/sweeper/tools/sweep.mjs \
  --target components/board/tools/client.mjs \
  --story "Agent in workspaces/incubator-v5 runs sync-doc and expects remote upload to Falcon Board"
```
Verify the output confirms that directory traversal up to the seat root succeeds and validates the real workflow.
