# System Architecture — Incubator v5

**Status**: Living  
**Target Audience**: Engineers & AI Agents  
**Last Updated**: 2026-09-08

---

## 1. System Overview

**Incubator v5** is a modular agent engineering platform. It packages and distributes a suite of autonomous software engineering components (`brain`, `board`, `docs`, `runner`, `bug-sweeper`, `providers`, `fleet`, `dashboard`) into **Agent Homes**.

---

## 2. Agent Directory Topology

Every agent managed by Incubator v5 has three primary zones:

```
<agent-home>/                          # The Agent's Home
├── AGENTS.md / CLAUDE.md / GEMINI.md  # Entry prompt
│
├── brain/                             # Zone 1: Persistent Memory & Task Ledger
│   └── __source/                      # Memory cards, task ledger, and context
│
├── boards/                            # Project task tracking SQLite databases
│   ├── <project-1>.sqlite             # Dedicated board per project
│   └── <project-2>.sqlite
│
├── harness/                           # Installed & maintained by Incubator v5
│   ├── HARNESS.md                     # Master manual teaching the agent all v5 components
│   ├── HARNESS-custom.md              # Custom operator notes (preserved across upgrades)
│   ├── engine/                        # Core engines (brain.mjs, etc.)
│   └── components/                    # Installed tools, skills and template libraries
│       ├── board/                     # Board component (CLI & engine)
│       ├── brain/skills/              # Brain skills (brain-self-kickoff, etc.)
│       └── docs/                      # Docs component & template bundle
│
├── projects/                          # Zone 2: Local-Only Workspaces
│   └── <project-name>/                # Local tools, scratch scripts, low-lifecycle projects
│       ├── src/                       # Local source code
│       └── docs/                      # Local documentation
│
└── workspaces/                        # Zone 3: Major Repositories (1 Project = Code + Docs)
    └── <project>/                     # Unified project repository
        ├── src/ or components/        # Source code
        └── docs/                      # In-Repo 3-Tier Documentation
            ├── system/                # Living architectural truth & manuals
            ├── design/                # Design blueprints & epics
            └── support/               # Runbooks & operational health
```

---

## 3. Work Zones Explained: `projects/` vs. `workspaces/`

| Zone | Purpose | Board Tracking | Version Control | Structure |
| :--- | :--- | :--- | :--- | :--- |
| **`projects/`** | **Local-Only Work** | **No Board** (Small, fast, lightweight) | Local Git/JJ (No remote) | Scratch scripts, internal utility scripts, rapid experiments. Has `projects/<name>/src/` and `projects/<name>/docs/`. |
| **`workspaces/`** | **Real Managed Projects** | **Dedicated Board** (`boards/<project>.sqlite`) | Local JJ/Git (GitHub optional) | Real production codebases. **1 unified repository containing source code and in-repo `docs/` (`system/`, `design/`, `support/`). GitHub remote is NOT required.** |


---

## 4. The 3-Tier Documentation System

All managed repositories in `workspaces/<project>/` maintain their documentation directly in **`<project>/docs/`**:

1. **`system/` (Living Truth)**: How the system works and how to run it (`ARCHITECTURE.md` for schemas/subsystems, `MANUAL.md` for CLI workflows/flags).
2. **`design/` (Transitional Blueprints)**: Architectural specs for active stages and features (`draft` → `in-progress` → `done` → `archive/`).
3. **`support/` (Living Truth)**: Operational runbooks, health checks, and troubleshooting guides (`RUNBOOK.md`).


### Index Invariant
Every tier directory (`system/`, `design/`, `support/`) **must contain an `INDEX.md`** table cataloging every file and its status.

---

## 5. The Component Suite

### 5.1 `brain` Component
- Zero-dependency persistent memory engine (`harness/engine/brain.mjs`).
- `brain-self-kickoff` skill: End-of-session memory write-back and clean resume prompts.

### 5.2 `board` & `dashboard` Component
- **Zero-dependency SQLite task ledger** (`boards/<project>.sqlite`) tracking stage tasks across `pair` and `runner` modes.
- **Topological Web Dashboard & Observatory**:
  - **Roadmap Swimlanes (`#swimlanes`)**: Visual timeline view grouping tasks under active design document headers with real-time completion progress bars.
  - **Flat Kanban (`#kanban`)**: Multi-column workflow board (`Planned`, `In Progress`, `Review`, `Done`, `Blocked`) with clean glassmorphism custom dropdown filters for Design Docs and Tracks.
  - **Fleet Matrix (`#fleet`)**: Real-time cross-agent health, active tasks, and status across all distributed local agent installations.
  - **Docs Catalog (`#docs`)**: Centralized design doc viewer with lifecycle filtering tabs (`All`, `Active`, `Finished`) and interactive Markdown reader drawer.
- **Design Document Lifecycle System**:
  - **Active-Only Viewports**: Roadmap Swimlanes, Flat Kanban, and Task Creation modals only display active design documents.
  - **Finished Archival**: Tasks belonging to finished design docs are automatically filtered from the main board clutter, while fully preserved and viewable under `#docs`.
  - **Markdown Frontmatter Sync**: Lifecycle transitions (`Active` ⇄ `Finished`) atomically update the source markdown frontmatter (`- **Status**: Finished`, `- **Last Updated**: YYYY-MM-DD`).
- **Universal Industry Tracks**:
  - Supports 15 industry standard tracks with visual iconography: `⬡ core`, `⚙️ engine`, `🛡️ harness`, `🧹 sweeper`, `✨ feature`, `🐛 bug`, `🎨 frontend`, `🔌 backend`, `⚡ api`, `🪄 ux`, `🗄️ db`, `☁️ infra`, `📄 docs`, `🧪 test`, `🚀 perf`.
- **Multi-Install Falcon Manager Roster API**:
  - Central ingestion and query API (`/api/v1/...`) supporting bearer token authentication and isolated per-agent SQLite databases (`boards/<agent-id>.sqlite`).

### 5.3 `docs` Component
- 3-tier templates, generator (`scaffold.mjs`), and validator (`validate.mjs`).

### 5.4 `harness` Component
- Provisions and upgrades agent homes with `HARNESS.md`, `HARNESS-custom.md`, engines, and component libraries.

### 5.5 `bug-sweeper` Component
- Multi-wave bug hunting and judging engine (`gemini-3.6-flash`, `gemini-3.8-flash`, and executable `node:test` suites).

---

## 6. Central REST API Surface (v1)

The Board & Fleet dashboard exposes the following REST API:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/health` | `GET` | Health check, uptime, and database status. |
| `/api/v1/roster` | `GET` | List all registered agent seats, project boards, and health metrics. |
| `/api/v1/tasks` | `GET`, `POST` | List and create board tasks (scoped to tenant). |
| `/api/v1/tasks/:id` | `PATCH`, `DELETE` | Update status/details or remove a task. |
| `/api/v1/docs` | `GET` | List all design documents with computed `isFinished` status and task metrics. |
| `/api/v1/docs/:slug` | `GET` | Get full Markdown content and metadata for a specific design doc. |
| `/api/v1/docs/:slug/status` | `POST` | Transition document lifecycle status (`Active` ⇄ `Finished`) and update Markdown source. |
| `/api/v1/fleet` | `GET` | Return real-time topological health matrix across all registered agent installs. |
| `/api/v1/agents/:agentId/board` | `GET` | Scoped board view for a specific local agent install. |
| `/api/v1/agents/:agentId/projects/:projectId/tasks` | `GET`, `POST` | Project-scoped task management for a specific agent install. |
| `/api/v1/agents/:agentId/docs/:slug/status` | `POST` | Scoped design document status update for a specific agent install. |
| `/api/v1/admin/manager` | `GET`, `PATCH` | Inspect or update the Fleet Manager configuration (Admin/Operator only). |
| `/api/v1/admin/agents` | `POST` | Register a new agent seat and generate cryptographically secure tokens. |
| `/api/v1/admin/agents/:id` | `DELETE` | Revoke/decommission an agent seat. |
| `/api/v1/admin/agents/:id/token/rotate` | `POST` | Rotate an agent seat's secret Bearer token. |
| `/api/v1/admin/agents/:id/projects` | `POST` | Allocate a new workspace project to an agent seat. |
| `/api/v1/admin/fleet/status` | `GET` | Deep aggregated health check across all active SQLite databases in the fleet. |

---

## 7. Multi-Agent Fleet Architecture & Transparent Proxying

### 7.1 Local Agent Ignorance
Local agents are completely unaware of central servers, remote REST APIs, or networking layers. They interact exclusively with the standard local `board.mjs` CLI tool:
```bash
node harness/components/board/tools/board.mjs list
node harness/components/board/tools/board.mjs add "Implement feature" --track core
```
Under the hood, `components/board/tools/client.mjs` inspects `harness/falcon.env`. If present:
```bash
FALCON_BOARD_URL=http://<central-server>:3333
FALCON_BOARD_TOKEN=agt_live_<agent-id>_<secret>
FALCON_AGENT_ID=<agent-id>
```
The client transparently proxies board calls over HTTP with Bearer authentication and tenant scope headers. If absent, it falls back to direct local SQLite storage (`boards/project.sqlite`).

### 7.2 Strict Cross-Tenant Guardrails & Physical Isolation
- **No Shared Tables**: Every agent and workspace project is allocated a physically dedicated SQLite file on disk (`boards/<agent-id>.<project-id>.sqlite`).
- **Cryptographic Token Verification**: Secret Bearer tokens (`agt_live_<agent>_<hex>`) are stored as salted SHA-256 hashes in `config/roster.json`.
- **Tenant Enforcement (`assertTenantAccess`)**: Any attempt by an agent to inspect, mutate, or inject tasks into another agent's tenant returns `403 Forbidden`.
- **Manager Seat Role**: The designated Manager (`manager-pm`) possesses fleet-wide audit and provisioning privileges, enabling consolidated observability on the Central Board dashboard.

---

## 8. Production Deployment & Live Backup Architecture

### 8.1 Zero-Dependency Containerization
The Falcon Board Server requires zero external npm packages and runs on pure Node.js ESM built-ins (`node:sqlite`, `node:crypto`, `node:http`, `node:fs`).
- **`deploy/Dockerfile`**: Minimalist Alpine Linux image exposing port `3333` with built-in healthchecks.
- **`deploy/docker-compose.yml`**: Production stack mounting persistent volumes for `/data/boards` and `/data/config`.
- **`deploy/systemd/falcon-board.service`**: Production systemd unit template with process isolation and sandboxing.

### 8.2 Non-Blocking Live Backups (`VACUUM INTO`)
- **`components/board/tools/backup.mjs`**: Executes SQLite's native `VACUUM INTO` command on active database files. This creates consistent, point-in-time binary snapshots without acquiring exclusive locks or interrupting ongoing agent writes.
- Backs up all `boards/*.sqlite` files and `config/roster.json`, writing a structured `manifest.json` with SHA-256 integrity hashes.


