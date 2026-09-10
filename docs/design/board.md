# Project Board

- **Codename**: #d-1
- **Color**: #38bdf8
- **Status**: Open & Inactive
- **Author**: Manager PM
- **Target Component(s)**: `components/board`, `components/board/ui`, `components/board/tools`, `components/board/engine`
- **Last Updated**: 2026-09-10

---

## 1. Context & Architecture Overview

In Incubator v5, the **Project Board** is the operational cockpit for autonomous agents and human operators. It binds task tracking, multi-tenant agent rosters, real-time web visualization, and collaborative pair programming into a unified, zero-dependency Node.js system.

This design document consolidates the previous blueprints (`falcon-manager-board-roster`, `board-process-fixes`) into the single, living specification for the board subsystem.

### 1.1 Core Principles
1. **Local Agent Ignorance**: Individual local agents interact strictly with their local `board.mjs` CLI tool and local SQLite databases without being burdened by network details.
2. **Fast, Collaborative Pair Programming**: No artificial permission gates or bureaucracy. Work directly with the human operator locally, implementing and verifying changes seamlessly.
3. **Natural 4-Column Task Progression**: Work items transition through `Planned` -> `In Progress` -> `In Review` -> `Done`.
4. **Living Architectural Spec**: When modifying board engine, REST API, or UI features, the task attaches here so agents load full context before editing code.

---

## 2. The 4-Column Board & Collaborative Pair Programming Workflow

```
┌─────────────┐       ┌─────────────────┐       ┌──────────────┐       ┌──────────┐
│ ⏳ PLANNED   │ ───►  │ ⚡ IN-PROGRESS   │ ───►  │ 🔍 IN-REVIEW │ ───►  │ ✅ DONE   │
│ On Backlog  │       │ Agent Executing │       │ Review & PR  │       │ Merged   │
│ Queue state │       │ Live pairing    │       │ Verification │       │ Approved │
└─────────────┘       └─────────────────┘       └──────────────┘       └──────────┘
```

- **`⏳ Planned`**: Actionable work item queued under its design doc.
- **`⚡ In-Progress`**: Active work item being developed and tested by the agent.
- **`🔍 In-Review`**: Work completed, automated tests verified, and ready for operator inspection.
- **`✅ Done`**: Operator reviewed, merged, and verified.


---

## 3. Data Models & Interface Contracts

### 3.1 SQLite Schema (`boards/project.sqlite`)
```sql
CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  design_slug TEXT,
  track       TEXT NOT NULL DEFAULT 'core',
  title       TEXT NOT NULL,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'planned', -- 'planned' | 'in-progress' | 'review' | 'done'
  mode        TEXT NOT NULL DEFAULT 'pair',    -- 'pair' | 'runner'
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_items_design_slug ON items(design_slug);
CREATE INDEX idx_items_status ON items(status);
```

### 3.2 CLI Commands (`components/board/tools/board.mjs`)
```bash
# Add task to design doc
node components/board/tools/board.mjs add "Task title" --doc board-and-workflow --track core

# Update task status
node components/board/tools/board.mjs set 42 --status in-progress

# Sync design doc checklist to board items
node components/board/tools/board.mjs sync-doc board-and-workflow
```

---

## 4. Web UI Architecture (`components/board/ui/`)
- **Single Page Application**: Vanilla JS (`app.js`) and CSS (`app.css`) with zero bundle steps or frontend frameworks.
- **Views**:
  1. `Roadmap / Swimlanes`: Collapsible per-spec progress lanes.
  2. `Flat Kanban`: 4-column layout (`⏳ Planned`, `⚡ In-Progress`, `🔍 In-Review`, `✅ Done`).
  3. `Fleet Matrix`: Multi-agent installation topology and active project cards.
  4. `Design Docs Catalog`: Overview of active and living blueprints.
- **WebSocket Synchronization**: Live updates pushed instantly on task mutations.

---

## 5. Verification Plan
- **Contract Tests (Tier 1)**: `node tools/test.mjs --tier1 --component board`
  - Validates SQLite engine invariants, state transitions, and bearer auth.
- **Journey Tests (Tier 2)**: `node tools/test.mjs --tier2 --component board`
  - Validates multi-tenant agent onboarding, project switching, and REST endpoints.

---

## 6. Deep Multi-Model Audit Remediation (Bugs #115–#129)

Remediation work items surfaced by the Multi-Model Deep Sweeper (Gemini baseline + Claude Fable 5.1 + OpenAI Codex Astra High) on 2026-09-10.

### 6.1 Registered Bug Cards
- [x] [🐛 bug] **[DEEP-01] Missing credentials bypass tenant read isolation; loopback bypasses mutation auth** (#115)
  - `api/middleware/auth.mjs`: Enforce tenant checks on tenant routes; reject unauthenticated requests when credentials configured; remove unconditional loopback mutation bypass.
- [x] [🐛 bug] **[DEEP-02 / FABLE-02] UI mutations and deletions silently mutate default tenant instead of selected tenant** (#116)
  - `ui/src/api/client.js` & `ui/src/components/drawer.js`: Route all mutations through `/api/v1/tasks/:id?agent=${agent}&project=${project}` carrying the `(agentId, projectId, taskId)` tuple.
- [x] [🐛 bug] **[DEEP-03] Stale roster persistence resurrects revoked credentials** (#117)
  - `engine/roster/agentStore.mjs`: Purge disk-revoked tenants during `persist()` to prevent stale in-memory snapshots from resurrecting revoked credentials.
- [x] [🐛 bug] **[FABLE-01] UI event handlers call fetchData() without render callback, preventing DOM repaint** (#118)
  - `ui/src/index.js` & `ui/src/api/sync.js`: Bind `render` callback to `fetchData` in a wrapped `sync` helper and `setDefaultRenderer` so all user actions trigger repaints.
- [x] [🐛 bug] **[FABLE-03] board CLI drops --project flag when connecting to remote server** (#119)
  - `tools/board/cli.mjs` & `client.mjs`: Pass `project` to `createBoardClient` and attach to remote request payloads.
- [x] [🐛 bug] **[FABLE-04] Finished status written by CLI and API is not recognized as closed by doc parser or UI** (#120)
  - `api/services/docService.mjs` & `ui/src/store/state.js`: Export `CLOSED_STATUSES` / `CLOSED_DOC_STATUSES` including `finished`/`done`.
- [x] [🐛 bug] **[FABLE-05] Closing design doc with zero tasks mutates file then returns 404** (#121)
  - `engine/board.mjs`: Make `closeDesignDoc` idempotent for empty docs (return empty summary with percentComplete: 100 instead of throwing).
- [x] [🐛 bug] **[FABLE-06] Remote client and UI doc actions omit project context** (#122)
  - `tools/board/client.mjs` & `ui/src/api/client.js`: Attach `project` to doc status/gate updates and checklist toggles.
- [x] [🐛 bug] **[FABLE-07] Remote finish-doc drops openTasks report on 400 error** (#123)
  - `tools/board/docCommands.mjs` & `tools/client.mjs`: Catch 400 error with structured `openTasks` payload in remote mode and print report.
- [x] [🐛 bug] **[FABLE-08] Cached defaultBoard handle closes permanently upon agent revocation or reallocation** (#124)
  - `api/server.mjs`: Convert `defaultBoard` and `defaultAgentId` in `appContext` to lazy dynamic getters.
- [x] [🐛 bug] **[FABLE-09] Admin mutations run silently in-memory without persistence in single-db mode** (#125)
  - `engine/roster/agentStore.mjs` & `api/server.mjs`: Derive default roster path in single-db mode.
- [x] [🐛 bug] **[FABLE-10] MCP server breaks JSON-RPC correlation on error and drops ping requests** (#126)
  - `components/board/tools/mcp-server.mjs`: Retain request `id` on errors, handle unknown methods with code `-32601`, and implement `ping` handler.
- [x] [🐛 bug] **[FABLE-11] fleet.mjs direct execution check compares undecoded URL pathname** (#127)
  - `tools/board/tools/fleet.mjs`: Use `fileURLToPath(import.meta.url)` and `fs.realpathSync`.
- [x] [🐛 bug] **[FABLE-12] sync-doc auto-scaffold aborts mid-loop on unvalidated milestone track tags** (#128)
  - `tools/board/parser.mjs`: Validate milestone track tags against `VALID_TRACKS` and aliases, falling back to `defaultTrack`.
- [x] [🐛 bug] **[FABLE-13] gate-guard denies all code edits if any active task is red, blocking authorized tasks** (#129)
  - `tools/gate-guard.mjs`: Allow edits if *any* active task is authorized (`🟢`).



---

## 7. Implementation Milestones
*This section is the work history of the area. New work is appended as a new `### Round N — YYYY-MM-DD: <title>` block. Earlier rounds are never deleted or edited.*

### Round 1 — 2026-09-08: Initial build & audit remediation
Built before rounds were tracked here. Tasks #17–#73 and #115–#129 on the board, all done. See sections 1–6 for the resulting design.

### Round 2 — 2026-09-10: Visual cleanup & user-friendly UI

The board works but reads as cluttered. Observed on the live HUD and Flat Kanban:
- Three overlapping doc filters in the filter bar (`DOCS`, `SUB-FILTER`, `DESIGN DOC`) plus a fourth `DESIGN DOC` dropdown repeated in the Flat Kanban banner.
- The Flat Kanban banner row carries only a view name and a tagline and costs a full row of vertical space.
- Header pills truncate the agent and project names (`Manager PM (Fle…`, `Incubator v5 Platf…`); the view switcher overflows off the right edge.
- Empty columns render as tall empty boxes while `Done` holds 122 cards in one scroll.
- Cards stack five to six pills and buttons (track, Plan, codename, doc name, magnifier, Reopen) around a two-line title; mono and sans fonts mix inside one card.
- The `STAGE COMPLETION` bar and red `BUGS 0` badge dominate the header even when there is nothing to act on.

- [x] **Milestone 1: Setup the design doc and tasks**
  - Task 1.1: Append this round to `docs/design/board.md` and sync to the board.
  - Task 1.2: Attach the plan to Milestone 1, move it to In-Review, yield for alignment.
- [x] **Milestone 2: HUD & filter bar consolidation**
  - Task 2.1: Collapse the three doc filters into one control; drop the duplicate in the Flat Kanban banner.
  - Task 2.2: Give agent and project names room (wider pills or two-line label), keep the view switcher inside the viewport.
  - Task 2.3: Demote passive telemetry (completion bar, zero-count badges) to quiet secondary styling.
- [x] **Milestone 3: Board layout & empty states**
  - Task 3.1: Remove the Flat Kanban banner row; the view switcher already names the view.
  - Task 3.2: Compact empty columns with a short empty-state hint instead of a tall box.
  - Task 3.3: Collapse `Done` by default (show latest N with "show all") so active work stays in view.
- [x] **Milestone 4: Card redesign**
  - Task 4.1: One-line meta row (id · track · codename) above the title; actions on hover only.
  - Task 4.2: One type family per card; reserve mono for ids and codenames.
- [x] **Milestone 5: Visual system pass, Chrome verification & landing**
  - Task 5.1: Normalise spacing, radius, and contrast tokens across HUD, filter bar, columns, cards, and drawer.
  - Task 5.2: Verify every view live in Chrome at desktop and narrow widths; screenshot before/after.
  - Task 5.3: Fold changes back into section 4 (Web UI Architecture) and `docs/system/`.

Landed 2026-09-10. Deferred to a later round: drawer, dialogs, Fleet and Projects views keep their earlier styling.
