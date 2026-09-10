# Incubator v5 Foundation & Core Infrastructure

- **Codename**: #d-1
- **Color**: #a855f7
- **Status**: In Progress
- **Author**: manager-pm (Pair Programmer)
- **Target Component(s)**: `components/docs`, `components/brain`, `components/board`, `components/harness`, `components/sweeper`
- **Last Updated**: 2026-09-08

---

## 1. Context & Problem Statement

Incubator v4 suffered from excessive multi-tier management bureaucracy: operators were separated from execution by dev managers, reviewer layers, and repetitive handoffs. Furthermore, workspace state accumulated untracked artifacts, legacy substrate scripts, and fragile git index states.

**Incubator v5** replaces this with a modern, high-velocity engineering foundation:
1. **Zero-Bureaucracy Pair Programming & Autonomous Runners**: Direct execution between the operator and AI pair programmer, with background jobs dispatched to sandboxed runners.
2. **Strict 3 Work Zones**: Persistent Memory (`brain/`), Local-Only Scratch (`projects/`), and Production Repositories (`workspaces/`).
3. **3-Tier Living Documentation**: Living Truth (`system/`), Transitional Blueprints (`design/`), and Operational Runbooks (`support/`).
4. **Zero-Dependency Node.js Core**: Pure ECMAScript modules with native Node.js primitives (including `node:sqlite` and `node:test`).
5. **Multi-Wave Bug Sweeper**: Autonomous adversarial verification with Gemini models (3.6 Flash breadth, 3.8 Flash depth, 3.7 Flash test generator, and 3.8 Flash High judge).

---

## 2. Goals & Explicit Non-Goals

### Goals
- [x] **Goal 1: Living Documentation Component**: Automated scaffolding and validation of the 3-tier docs architecture (`docs/scaffold.mjs`).
- [x] **Goal 2: Persistent Brain Engine**: Deterministic CAS-safe memory ledger (`brain.mjs`) supporting records, notes, and session handoffs.
- [x] **Goal 3: Multi-Task Stage Project Board**: Embedded SQLite task and bug tracking engine (`board.mjs`) with stage summary rollups, bug counters, and design doc lifecycle enforcement.
- [x] **Goal 4: Harness Installer**: Clean provisioning and synchronization of the operator's workspace harness (`install.mjs`).
- [x] **Goal 5: Bug Sweeper Pipeline**: 3-wave autonomous adversarial bug hunting and invariant verification engine (`sweeper.mjs`).
- [x] **Goal 6: Board Web UI & Viewer**: Real-time dark-mode web dashboard (`components/board/ui/`) with live sync and slide-over task inspector.

### Non-Goals
- **No standalone runner daemon/sandbox execution**: Direct pair programming with operator and IDE tooling replaces complex detached runner infrastructure.
- **No heavy external npm dependencies**: Core components must remain zero-dependency ESM.
- **No dev manager bureaucracy**: Elimination of middle-manager agent roles and multi-tier PR rituals.

---

## 3. Data Models & Interface Contracts

### 3.1 Board SQLite Schema (`boards/project.sqlite`)
```sql
CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  design_slug TEXT,
  track       TEXT NOT NULL DEFAULT 'core',
  title       TEXT NOT NULL,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'planned',
  mode        TEXT NOT NULL DEFAULT 'pair',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_items_design_slug ON items(design_slug);
CREATE INDEX idx_items_status ON items(status);
```

### 3.2 3-Wave Bug Sweeper Pipeline
```
Target Files
    │
    ▼
🌊 [Wave 1: Breadth Hunter]  (gemini-3.6-flash-low)   — Synthesizes initial breach points
    │
    ▼
🌊 [Wave 2: Depth Hunter]    (gemini-3.8-flash-low)   — Challenges findings & checks deep invariants
    │
    ▼
🌊 [Wave 3: Test Generator]  (gemini-3.7-flash-low)   — Generates dynamic reproducible test proofs
    │
    ▼
⚖️  [Presiding Judge]        (gemini-3.8-flash-high)  — Separates real invariant bugs from trivia
```

---

## 4. Implementation Milestones & Board Tasks

- [x] **Milestone 1: Documentation Component & Templates** (Task #1)
  - Scaffold 3-tier structure (`system/`, `design/`, `support/`).
  - Add validator and living truth templates.
- [x] **Milestone 2: Persistent Brain Engine & Handoff** (Task #2)
  - Implement CAS-safe brain ledger with markdown frontmatter parser.
  - Implement `working-memory` card and handoff skill.
- [x] **Milestone 3: Stage Project Board Engine** (Task #3)
  - SQLite backend with stage rollups, bug tracking, and `close-doc` lifecycle.
- [x] **Milestone 4: Harness Installer & Work Zones** (Task #4)
  - Workspace provisioning with `HARNESS-custom.md` preservation.
- [x] **Milestone 5: Bug Sweeper Component** (Task #6)
  - Multi-wave adversarial pipeline with live Gemini driver and Judge gavel.
- [x] **Milestone 6: Board Web UI & Viewer** (Task #10)
  - Zero-dependency web dashboard at `http://localhost:3333` with live telemetry.
