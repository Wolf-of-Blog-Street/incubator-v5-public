# Central Board on Falcon Manager & Secure Local Agent Integration

- **Codename**: #d-2
- **Color**: #38bdf8
- **Status**: Finished
- **Author**: manager-pm (Pair Programmer)
- **Target Component(s)**: `components/board`, `components/dashboard`, `components/harness`
- **Last Updated**: 2026-09-09

---

## 1. Context & Architecture Overview

In Incubator v5, **all agent seats and Gemini models run locally** on developer machines/laptops. Work is executed entirely on local machines with direct pair programming, local IDEs, and local AI reasoning.

To provide the operator with a **single, unified topological view across all active local agent installs**, **Falcon Manager** acts solely as the **central board and dashboard host**. 

### 1.1 Hierarchical Topology: Agent → Projects → Boards

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LOCAL WORKSTATIONS / LAPTOPS                       │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ AGENT: manager-pm (Agent Home)                                          │  │
│  │  ├── brain/                             (Persistent agent memory)     │  │
│  │  ├── harness/                           (Installed tools & engine)    │  │
│  │  ├── boards/                            (Per-project SQLite boards)   │  │
│  │  │   ├── incubator-v5.sqlite            (Project A Board)             │  │
│  │  │   └── mobile-app.sqlite              (Project B Board)             │  │
│  │  │                                                                    │  │
│  │  └── workspaces/                        (Main Project Repositories)   │  │
│  │      ├── incubator-v5/                  (Project A Code + Docs)       │  │
│  │      │   ├── components/                (Source code)                 │  │
│  │      │   └── docs/                      (Unified 3-Tier Docs)         │  │
│  │      │       ├── system/                (Living truth)                │  │
│  │      │       ├── design/                (Design specs / epics)        │  │
│  │      │       └── support/               (Runbooks)                    │  │
│  │      │                                                                │  │
│  │      └── mobile-app/                    (Project B Code + Docs)       │  │
│  │          ├── src/                                                     │  │
│  │          └── docs/                      (Unified 3-Tier Docs)         │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │
                                       │  Authenticated HTTPS Ingestion
                                       │  (Bearer Token: `sec_manager_...`)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FALCON MANAGER HOST                              │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      SECURE INGESTION & ROSTER API                    │  │
│  │  • Hierarchical Roster: Agent → Projects → (Board + Docs)             │  │
│  │  • Endpoints: /api/v1/agents/:id/projects/:projId/(board|tasks|docs)  │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│                                      ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                   TOPOLOGICAL DASHBOARD UI (1 DASH)                   │  │
│  │  • Fleet Topology Matrix: Multi-agent & multi-project rollups         │  │
│  │  • Agent & Project Switcher: Drill down into any project's board      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Goals & Explicit Non-Goals

### Goals
- [ ] **Goal 1: Central Multi-Agent Board Service on Falcon Manager**:
  - Run a zero-dependency HTTP server on Falcon Manager managing `boards/<agent-id>.<project>.sqlite` instances and agent roster.
  - Expose a single unified Web Dashboard ("1 Dash") displaying the entire agent fleet and project topology.
- [ ] **Goal 2: Secure Agent Authentication & Scoped Ingestion API**:
  - Authenticate all incoming requests via Bearer Tokens (`Authorization: Bearer <token>`).
  - Strict tenant guard: an agent token can ONLY mutate tasks, bugs, and design doc syncs for its assigned `agent_id` and declared `projects`.
- [ ] **Goal 3: Local Agent Client & MCP Bridge**:
  - Update local `board.mjs` CLI to communicate seamlessly with Falcon Manager using local config (`FALCON_BOARD_URL`, `FALCON_AGENT_TOKEN`, `--project <name>`).
  - Provide an MCP tool bridge allowing local Geminis to query and update the board via structured tool calls.
  - Implement design doc synchronization (`board sync-doc <slug>`) so local markdown blueprints are viewable in the central dashboard.
- [ ] **Goal 4: Topological Fleet Dashboard UI**:
  - **Fleet Overview**: Top-level matrix showing every local agent install, active projects, design stages, completion %, open tasks, and bugs.
  - **Agent & Project Context Switcher**: Instant drill-down into any agent's specific project board with Design Doc Swimlanes, Flat Kanban, Task Plans, and Markdown Doc Reader.
- [ ] **Goal 5: Design Doc Lifecycle & Active-Only Viewport Filtering**:
  - **Iterative Refinement or Explicit Completion**: Ability to keep design docs active indefinitely to continuously refine and cut new tasks, or explicitly mark them as `Finished`.
  - **Active-Only Primary Views**: Roadmap Swimlanes (`#swimlanes`), Flat Kanban (`#kanban`), and task filter toolbars strictly show *active* design docs to prevent cognitive clutter.
  - **Comprehensive Catalog in Docs Section**: The Design Docs catalog (`#docs`) lists both Active and Finished documents, badging finished docs and providing filter toggles (`All | Active | Finished`).
  - **Doc Reader Actions**: Provide direct `[Mark as Finished ✓]` and `[Reopen Design Doc ↻]` actions in the Reader modal and Swimlanes header.
- [ ] **Goal 6: Agent-Project-Board Roster Hierarchy & Consolidated Project Docs**:
  - **1 Project = 1 Codebase + 1 Board + 1 Unified `docs/` Folder**: Eliminate separate `<project>-docs` repositories. Embed the 3-tier documentation structure directly into `workspaces/<project>/docs/`.
  - **Multi-Project Agent Support**: Agents can have multiple concurrent projects, each with its own project SQLite board (`boards/<project>.sqlite`). No separate boards for docs.
  - **Roster Schema Evolution**: Roster cleanly structures agents and their attached active projects.

### Non-Goals
- **No model execution on Falcon Manager**: Falcon Manager does NOT run AI models, inference, or agent loops. All reasoning and coding remain 100% local.
- **No remote workspace file mounting**: Local agents push updates and doc snapshots over authenticated REST rather than mounting network filesystems.
- **No separate boards for documentation**: Docs are first-class assets inside the project repo and do not require distinct task boards.

---

## 3. Security & Ingestion Architecture

### 3.1 Authentication & Permissions
Falcon Manager maintains an agent roster and token registry in `config/roster.json` reflecting the Agent → Project hierarchy:

```json
{
  "agents": [
    {
      "id": "manager-pm",
      "name": "Manager PM (Local Mac)",
      "token_hash": "sha256:...",
      "icon": "🛡️",
      "color": "cyan",
      "projects": [
        {
          "id": "incubator-v5",
          "name": "Incubator v5 Platform",
          "board": "incubator-v5.sqlite",
          "docs_path": "workspaces/incubator-v5/docs/design"
        }
      ]
    },
    {
      "id": "example-pa",
      "name": "Example PA (Local Laptop)",
      "token_hash": "sha256:...",
      "icon": "🦅",
      "color": "amber",
      "projects": [
        {
          "id": "falcon-core",
          "name": "Falcon Core",
          "board": "falcon-core.sqlite",
          "docs_path": "workspaces/falcon-core/docs/design"
        }
      ]
    }
  ]
}
```

- Each local agent stores its secret token locally in `~/.incubator/credentials.json` or `.env`.
- Every mutation request includes `Authorization: Bearer <secret_token>`.
- The server validates the token and automatically resolves the `agent_id`. Any attempt by Agent A to modify Agent B's tasks returns `403 Forbidden`.

### 3.2 Secure API Contracts

| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| `/api/v1/roster` | `GET` | Operator / Token | Returns the fleet topology and status rollup across all agents. |
| `/api/v1/board` | `GET` | Agent Token | Retrieves the board summary for the authenticated agent. |
| `/api/v1/tasks` | `GET`, `POST` | Agent Token | Lists tasks or creates a new task/bug for the authenticated agent. |
| `/api/v1/tasks/:id` | `GET`, `PATCH`, `DELETE`| Agent Token | Inspects, updates (status, details, track), or deletes a task. |
| `/api/v1/tasks/:id/toggle-checklist` | `POST` | Agent Token | Toggles a specific checklist item on a task. |
| `/api/v1/docs/sync` | `POST` | Agent Token | Pushes local design doc markdown + metadata to Falcon Manager. |
| `/api/v1/docs/:slug/status` | `POST` | Operator / Agent | Updates doc status (e.g. Active <-> Finished) and updates markdown frontmatter. |
| `/api/v1/agents/:id/*` | `GET` | Operator UI | Operator dashboard endpoints for viewing specific agent boards and docs. |

---

## 4. Implementation Milestones

- [ ] **Milestone 1: Central Multi-Agent Storage & Security Layer (`components/board/engine/`)**
  - Implement per-agent SQLite database pooling on Falcon Manager (`boards/<agent-id>.sqlite`).
  - Implement token validation and tenant isolation guards in `components/board/engine/auth.mjs`.
  - Add unit tests for token verification, multi-agent database isolation, and permission enforcement.

- [ ] **Milestone 2: Authenticated REST API & Doc Sync Ingestion (`components/board/api/`)**
  - Implement `/api/v1/*` authenticated routes on the server.
  - Implement `/api/v1/docs/sync` endpoint for storing and rendering synced local design docs.
  - Add integration tests for authenticated CRUD and doc synchronization.

- [ ] **Milestone 3: Local Agent Client & MCP Bridge (`components/board/tools/`)**
  - Update `board.mjs` CLI to support both local direct mode and remote Falcon Manager mode (`--remote` or auto-detected via env).
  - Implement local MCP tool (`board_manage`) for local Gemini pair programming.
  - Add automated `board sync-doc` command to push local design docs to Falcon Manager.

- [ ] **Milestone 4: Topological Fleet Dashboard UI (`components/board/ui/`)**
  - Build **Topological Fleet Overview**: visual grid of all local agents, current active stages, progress bars, and recent activity.
  - Build **Agent Context Switcher**: seamlessly drill down into any agent’s design doc swimlanes, tasks, and rendered markdown docs.

- [ ] **Milestone 5: Design Doc Lifecycle Management & Active-Only Viewport Filtering (`components/board/ui/`, `api/`)**
  - Implement status transition API to mark design docs `Finished` or `Active`.
  - Update Swimlanes, Kanban, and filter toolbars to strictly filter out `Finished` design docs by default.
  - Update `#docs` catalog view to present all docs with `All | Active | Finished` filtering and clear status pills.
  - Add UI actions in the Doc Reader and Swimlane headers: `[Mark as Finished ✓]` and `[Reopen Design Doc ↻]`.

- [ ] **Milestone 6: Agent-Project-Board Hierarchy & Consolidated Project Docs Migration**
  - **Data Model & Backend API (`components/board/api/`, `engine/`)**:
    - Update `roster.json` schema to nest `projects: [{ id, name, board, docs_path }]` under each agent.
    - Implement agent-and-project scoped endpoints: `/api/v1/agents/:agentId/projects/:projectId/(board|tasks|docs)`.
    - Provide backward compatibility for single-board local agents (`boards/project.sqlite`).
  - **UX & Dashboard Viewports (`components/board/ui/`)**:
    - Build **Hierarchical Agent & Project Context Selector**: Header dropdown showing `[Agent] ▾ / [Project] ▾` with dynamic filtering.
    - Update **Fleet Matrix (`#fleet`)**: Render a grouped topology view showing each agent install and its nested active projects, total tasks, and completion %.
    - Update **Doc Reader & Catalog (`#docs`)**: Resolve and render 3-tier Markdown documents directly from the selected project's in-repo `docs/` folder.
  - **Harness Teachings & Agent Operational Protocol (`harness/`, `components/harness/templates/`)**:
    - Update master `HARNESS.md` and `HARNESS.md.template` to teach agents the consolidated topology:
      - Every workspace in `workspaces/<project>/` is a single unified repository containing source code and 3-tier docs in `<project>/docs/`.
      - Standalone `<project>-docs/` repos are abolished.
      - Each project has its own dedicated board `boards/<project>.sqlite`. No separate boards for docs.
      - Agents must execute `board` commands against the current project's board (`--project <name>` or `--db boards/<project>.sqlite`).
  - **Tooling & Docs Consolidation (`components/docs/`, `workspaces/`)**:
    - Update `components/docs/tools/scaffold.mjs` to scaffold `docs/` directly inside the current project root.
    - Update `components/docs/tools/validate.mjs` to validate in-repo `<project>/docs/`.
    - Migrate `workspaces/incubator-v5-docs/` content directly into `workspaces/incubator-v5/docs/`.

- [ ] **Milestone 7: Verification, End-to-End Tests & Living Docs**
  - End-to-end tests: simulate multi-agent and multi-project task manipulation and doc sync.
  - Live Chrome DevTools verification of the 2-tier Agent → Project selector and Fleet Matrix.
  - Update `system/ARCHITECTURE.md` and `system/MANUAL.md` to reflect unified in-repo docs and multi-project roster architecture.

---

## 5. Verification Plan

### 5.1 Automated Tests
```bash
# Auth & multi-agent isolation tests
npm test components/board/tests/auth.test.mjs

# Authenticated API & doc sync tests
npm test components/board/tests/api.test.mjs

# Local client & MCP integration tests
npm test components/board/tests/client.test.mjs
```

### 5.2 Live Verification
1. Start Central Board on Falcon Manager:
   ```bash
   node components/board/tools/serve.mjs --port 3333 --roster config/roster.json
   ```
2. Run local CLI from local agent seat for a specific project:
   ```bash
   node harness/components/board/tools/board.mjs add "Implement project switcher" --doc falcon-manager-board-roster --project incubator-v5
   ```
3. Inspect Dashboard UI in Chrome:
   - Verify Agent → Project hierarchical selector switches active boards and in-repo docs cleanly.
   - Verify Fleet Topology Matrix displays nested project cards with live progress bars.

---

## 6. Living Docs & Harness Teachings Update Plan
- [ ] **`harness/HARNESS.md` & `HARNESS.md.template`**: Teach all agents the 1-Project = 1-Repo + In-Repo Docs + 1-Board topology.
- [ ] **`system/ARCHITECTURE.md`**: Update architecture topology diagrams and document Agent → Project → Board hierarchy.
- [ ] **`system/MANUAL.md`**: Document `--project <name>` CLI parameter and in-repo `docs/` layout.

