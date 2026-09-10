# Board Process Fixes: Traffic Light Authorization Gates (Red/Green), In-Review Column & Strict Human Merge Protocol

- **Codename**: #d-9
- **Color**: #10b981
- **Status**: Finished
- **Gate**: green
- **Author**: Manager PM
- **Target Component(s)**: `components/board`, `components/board/ui`, `harness/hooks`, `AGENTS.md`
- **Last Updated**: 2026-09-09

---

## 1. Context & Problem Statement

We diagnosed two critical failure modes in our autonomous agent execution loop:
1. **Agent Drift & Premature Execution**: Agents assigned to write a design doc start modifying production code without explicit approval, even when zero tasks are in progress.
2. **Invisible Review & Automatic Merging**: Tasks transition directly to `Done` (or disappear into closed filters) without pausing for human inspection, leading to silent drift and untested merges into main.

---

## 2. The Solution: Two-Tier Traffic Light Gates & The 4-Column Board

We implement a deterministic, un-bypassable **Traffic Light Gate System** combined with a mandatory **In-Review Human Gate**.

```
                        ┌──────────────────────────────────────────────┐
                        │           DESIGN DOC TRAFFIC LIGHT           │
                        │           🔴 RED (DESIGN ONLY)               │
                        │           🟢 GREEN (EXECUTION AUTHORIZED)    │
                        └──────────────────────┬───────────────────────┘
                                               │
               ┌───────────────────────────────┴───────────────────────────────┐
               ▼                                                               ▼
        [ 🔴 RED DOC ]                                                  [ 🟢 GREEN DOC ]
  - Design & Plan ONLY.                                           - Execution permitted on
  - Permitted: edit docs/design/*.md, plans, tasks.                 tasks with individual GREEN lights.
  - BLOCKED: editing any component/code files.                    - Individual tasks evaluate below:
                                                                               │
                                                               ┌───────────────┴───────────────┐
                                                               ▼                               ▼
                                                        [ 🔴 RED TASK ]                 [ 🟢 GREEN TASK ]
                                                        - HELD by operator.             - AUTHORIZED.
                                                        - Cannot be started.            - Moves to `In-Progress`.
                                                        - BLOCKED from code edits.      - Code edits permitted.
```

---

## 3. The 4-State Board Workflow & Automatic Red-on-Review Invariant

```
┌─────────────┐       ┌─────────────────┐       ┌────────────────────────┐       ┌──────────┐
│ ⏳ PLANNED   │ ───►  │ ⚡ IN-PROGRESS   │ ───►  │ 🔍 IN-REVIEW (AUTO-RED) │ ───►  │ ✅ DONE   │
│ On Backlog  │       │ Agent Executing │       │ 🔴 GATE FLIPS TO RED   │       │ Merged   │
│ 🔴 by def   │       │ 🟢 Authorized   │       │ Hard Stop & Yield Turn │       │ Approved │
└─────────────┘       └─────────────────┘       └────────────────────────┘       └──────────┘
```

### 3.1 The Automatic Red-on-Review Invariant
1. **Starting a Task**: A task can ONLY move from `Planned` to `In-Progress` if **both** the parent Design Doc and the task itself have **🟢 GREEN** traffic lights.
2. **Finishing Implementation**: Once the agent finishes writing code in the isolated workspace/branch:
   - The agent moves the task from `In-Progress` to **`In-Review`**.
   - **THE TASK'S TRAFFIC LIGHT AUTOMATICALLY FLIPS TO 🔴 RED.**
   - **The agent must immediately stop calling tools and yield the turn.**
3. **The Human Merge Gate**:
   - The operator inspects the diffs in the IDE ("Review Changes").
   - The task sits visibly in the **`In-Review`** column on the board with a prominent red traffic light.
   - The operator tests the change (choosing `Tier 1`, `Tier 2`, or `Tier 3` test suite).
   - **Only the operator can give the go-ahead to merge into main and transition the card to `Done`.** Under no circumstances can the agent auto-merge or self-mark `Done`.

### 3.2 The Task 1 Standard: "Setup the Design Doc and Tasks"
1. **Universal Invariant for Every Epic**:
   - **Task 1 is ALWAYS**: `Setup the design doc and tasks` (Milestone 1).
   - The parent Design Doc initializes to **`🔴 RED`** (`- **Gate**: red`).
   - **Task 1 is ALWAYS automatically initialized to `🟢 GREEN` and moved to `⚡ In-Progress`**.
   - All subsequent tasks (Task 2, Task 3...) initialize to **`⏳ Planned`** with Gate **`🔴 RED`**.
2. **What Happens in Task 1**:
   - The agent authors/refines `docs/design/<slug>.md`, registers it in `INDEX.md`, and syncs tasks to the Falcon Board.
   - The pre-tool hook permits editing design docs and planning artifacts, but blocks editing source code in `components/`, `tools/`, `harness/`.
3. **The Visual Signal to Operator**:
   - Once the design doc specification and tasks are complete, the agent moves Task 1 to **`🔍 In-Review`**.
   - Under the universal invariant, moving Task 1 to `In-Review` automatically flips its gate to **`🔴 RED`**, freezing all edits, and the agent yields turn.
   - **Task 1 sitting in `🔍 In-Review` is the explicit signal for the operator**: *"Ok, now I check the design doc and ungate each task here."*
4. **Operator Sign-off & Task Ungating**:
   - The operator reviews the design doc and tasks on the board.
   - The operator flips the Design Doc gate to **`🟢 GREEN`**.
   - The operator marks Task 1 as **`✅ Done`**.
   - The operator selectively un-gates the approved execution tasks (e.g. flipping Task 2 to **`🟢 GREEN`**).


---

## 4. UX & Visual Design Specifications

### 4.1 Traffic Light Indicators on UI Elements

1. **On Design Doc Pills (Top Toolbar & Filter Dropdown)**:
   - The design doc pill (e.g. `[#d-6] v4-to-v5-agent-upgrade`) features an explicit traffic light indicator:
     - `🔴 [#d-6] v4-to-v5-agent-upgrade...` (Red: Design-only mode)
     - `🟢 [#d-6] v4-to-v5-agent-upgrade...` (Green: Execution authorized)
   - Clickable toggle for the operator to flip the doc between Red and Green.

2. **On Every Task Card**:
   - Each card displays a distinct traffic light badge next to its status:
     - `🔴 HELD` (Red light): Locked. Agent cannot edit code.
     - `🟢 READY` (Green light): Authorized for execution.
   - When a card moves to `In-Review`, it displays:
     - `🔴 IN-REVIEW (AWAITING OPERATOR MERGE)`

3. **Design Doc Selector Dropdown**:
   - Displays the remaining **non-finished task count** (`Planned` + `In-Progress` + `In-Review`) rather than total tasks or 0 when done.
   - Displays the doc's overall traffic light (`🔴` or `🟢`).

4. **Sub-Filter Dropdown Alignment**:
   - Sub-filters match the 4 column names:
     - `All Tasks`
     - `⏳ Planned`
     - `⚡ In-Progress`
     - `🔍 In-Review`
     - `✅ Done`

---

## 5. Architectural Implementation & Hard Tool Enforcement

### 5.1 SQLite Schema Update
```sql
ALTER TABLE items ADD COLUMN gate TEXT NOT NULL DEFAULT 'red'; -- 'red' | 'green'
```

### 5.2 Antigravity Pre-Tool Execution Hook (`.agents/hooks.json`)
We install a deterministic pre-tool hook in AGY:
```json
{
  "hooks": [
    {
      "event": "PreToolExecution",
      "tools": ["replace_file_content", "multi_replace_file_content", "write_to_file"],
      "handler": "components/board/tools/gate-guard.mjs"
    }
  ]
}
```

#### Gate Guard Logic (`gate-guard.mjs`):
1. If the target file is in `docs/design/*.md` or `.gemini/brain/*`: **ALLOW** (planning/design is always permitted).
2. If the target file is in `components/`, `tools/`, `harness/`, or source directories:
   - Query active tasks from `board.sqlite`:
     ```sql
     SELECT items.*, docs.gate as doc_gate 
     FROM items 
     JOIN docs ON items.design_slug = docs.slug 
     WHERE items.status = 'in-progress';
     ```
   - **Check 1**: Is there at least one task in `in-progress`? If no -> **BLOCK**.
   - **Check 2**: Is `doc_gate === 'green'`? If no -> **BLOCK** (`"Parent design doc gate is RED"`).
   - **Check 3**: Is `task.gate === 'green'`? If no -> **BLOCK** (`"Task #id gate is RED"`).
   - **Check 4**: Is the task in `review`? If yes -> **BLOCK** (`"Task is In-Review; code changes frozen until operator merge"`).

---

## 6. Implementation Milestones

- [ ] **Milestone 1: Schema & Data Layer**
  - Task 1.1: Add `gate` column (`red` | `green`) to `board.sqlite` items table and design doc parser.
  - Task 1.2: Add CLI commands: `board gate <id> <red|green>` and `board doc-gate <slug> <red|green>`.
- [ ] **Milestone 2: UI Traffic Lights & 4-Column Board**
  - Task 2.1: Add 4th column `In-Review` to Kanban grid and Swimlanes view (`Planned`, `In-Progress`, `In-Review`, `Done`).
  - Task 2.2: Add traffic light indicators (`🔴` / `🟢`) to doc pills, card headers, and Kanban filter dropdowns.
  - Task 2.3: Wire automatic flip to `🔴 red` when task status changes to `review`.
  - Task 2.4: Update Design Doc dropdown to show remaining non-finished task count and match column naming.
- [ ] **Milestone 3: Hard Enforcement Hook & Harness Invariants**
  - Task 3.1: Implement `components/board/tools/gate-guard.mjs` pre-tool hook.
  - Task 3.2: Update `HARNESS.md` and `AGENTS.md` with the strict Red/Green authorization rules.
- [ ] **Milestone 4: Verification & Live Deployment**
  - Task 4.1: Automated contract tests for gate transitions and review column partitioning.
  - Task 4.2: Deploy live to `falcon-manager`, restart service, and visually verify on UI.

---

## 7. Verification Plan
- **Verification 1**: Create a red design doc -> attempt to call `replace_file_content` on a code file -> verify hook blocks with `[GATE_VIOLATION]`.
- **Verification 2**: Set doc to green and task to green -> move to `in-progress` -> verify code edits allowed.
- **Verification 3**: Move task to `review` -> verify gate flips to red and further code edits are blocked until operator approval.
