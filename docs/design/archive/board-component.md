# Epic: Incubator v5 Board Component & Stage Task Tracking

- **Status**: Done
- **Author**: Pair (Operator + Antigravity)
- **Target Component(s)**: `components/board`, `components/harness`
- **Landed Date**: 2026-09-08

---

## 1. Context & Problem Statement

In v4, the project management system suffered from a fundamental category error: **it conflated a high-level Design Doc with a single execution ticket** (`1 Doc = 1 Job = 1 Run = Done`).

In real engineering workflows (such as building pipeline stages in Project Gamma), a single stage or architectural epic contains multiple distinct pieces of work across different layers:
- Data persistence & schema migrations (`db`)
- Core logic & stage pipelines (`pipeline` / `api`)
- Visual viewers, inspection tools, or frontend UI (`ux`)
- Automated benchmarks, eval runs, or bug sweeps (`test` / `eval`)

Furthermore, some tasks are best done interactively in **pair mode** (e.g. rapid prototyping or core algorithm design), while others (like UX iterations with browser checks or large eval runs) are best offloaded to **runner mode** (autonomous execution on a server/runner).

The v5 Board component decouples the **Architectural Blueprint (Design Doc)** from the **Executable Work Items (Board Tasks)**, allowing stages to be designed holistically and executed incrementally across both pair and runner modes.

---

## 2. Goals & Explicit Non-Goals

### Goals
- [x] **Unified Board Schema**: A single, clean zero-dependency SQLite table (`node:sqlite`) tracking tasks, their status, their track (`db`, `ux`, `pipeline`, etc.), and execution mode (`pair` vs `runner`).
- [x] **Design Doc Linkage**: Every task can link to a parent `design_slug` (e.g. `2026-08-30-section-extraction`), enabling progress rollups for entire stages.
- [x] **Dual Execution Modes**: Support both interactive local pair programming (`pair`) and autonomous background jobs (`runner`).
- [x] **Clean CLI & Table Formatter**: Commands (`add`, `list`, `set`, `rm`) with visual rollup grouped by stage/design doc.
- [x] **Harness Integration**: Installed automatically into agent homes via `installHarness`.

### Non-Goals
- ❌ **No Rigid 6-Tier Pipelines**: No micro-states for `spec`, `check`, `qc`, `landing`. Review and verification are milestones or verification steps, not hardcoded state machines.
- ❌ **No Cross-Machine File Mounting**: Boards live cleanly in the agent home; remote runners report status via API/MCP rather than shared SQLite mounts.

---

## 3. Data Models & Interface Contracts

### 3.1 SQLite Storage (`boards/<project>.sqlite`)

```sql
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  design_slug TEXT,                                  -- Links to design/<slug>.md (optional)
  track       TEXT NOT NULL DEFAULT 'core',         -- e.g. 'db', 'pipeline', 'ux', 'eval'
  title       TEXT NOT NULL,                         -- Human-readable task title
  details     TEXT,                                  -- Optional notes, requirements, or run receipts
  status      TEXT NOT NULL DEFAULT 'planned',       -- planned | in-progress | review | done | blocked
  mode        TEXT NOT NULL DEFAULT 'pair',          -- pair | runner
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_design_slug ON items(design_slug);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
```

### 3.2 CLI Interface

```bash
# Add a task linked to a stage/design doc
node harness/components/board/tools/board.mjs add "Visual section inspector viewer" \
  --doc page-structure --track ux --mode runner

# List tasks grouped by stage/design doc
node harness/components/board/tools/board.mjs list

# Update status or mode
node harness/components/board/tools/board.mjs set 3 --status in-progress
node harness/components/board/tools/board.mjs set 3 --status done
```

---

## 4. Implementation Milestones

- [x] **Milestone 1: Core Database & API Layer**
  - Implemented in `components/board/engine/board.mjs` with full CRUD operations using `node:sqlite`.
  - WAL mode and safe schema migrations included.
- [x] **Milestone 2: CLI Tool & Stage Rollup Formatter**
  - Implemented in `components/board/tools/board.mjs`.
  - Formatted ANSI board view grouped by design doc / stage with progress percentages.
- [x] **Milestone 3: Automated Test Verification**
  - Implemented in `components/board/tests/board.test.mjs` verifying CRUD, status transitions, and group filtering.
- [x] **Milestone 4: Harness Installer Integration**
  - Updated `components/harness/tools/install.mjs` to deploy `board` component to `harness/`.
  - Updated `harness/HARNESS.md` with board usage instructions.

---

## 5. Verification Plan

### 5.1 Automated Tests
```bash
npm test components/board/tests/board.test.mjs
# Result: PASS (all tests green)
```

---

## 6. Living Docs Update Plan
- [x] Updated `system/ARCHITECTURE.md` to document the Board component and stage task model.
- [x] Updated `system/MANUAL.md` with the new Board CLI commands.
- [x] Archived this design doc to `design/archive/board-component.md`.
