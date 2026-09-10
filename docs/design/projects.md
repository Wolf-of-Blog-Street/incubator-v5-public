# GitHub Projects Directory & Live Agent Checkout Inventory

- **Codename**: #d-7
- **Color**: #a855f7
- **Status**: Open & Active
- **Author**: Manager PM
- **Target Component(s)**: `components/board/ui/src/views/projectsView.js`, `components/board/api/routes/projects.mjs`, `components/board/engine/projectsStore.mjs`, `config/projects.json`, `components/board/tools/fleet.mjs`
- **Last Updated**: 2026-09-10

---

## 1. Context & Problem Statement

In Incubator v5, the operator orchestrates a fleet of distributed agent seats (`manager-pm`, `agent-d-pm`, `agent-g-pm`, `agent-c-pm`, `agent-b-pm`, etc.) alongside multiple independent GitHub codebases. Currently:
1. **Agent-Centric Fragmentation**: The Falcon Board features a **Fleet View** (showing agent seats) and **Roadmap/Kanban Views** (showing tasks for a single active workspace project), but provides **no unified project-centric directory**.
2. **Checkout Blindness**: The operator cannot see at a glance which agent seat has cloned or checked out a particular GitHub repository into its local `workspaces/` directory. Finding who is working on what requires manually inspecting disk directories or cross-referencing notes.
3. **Repository Bookmarking**: There is no fast, centralized bookmark catalog linking directly to each project's GitHub repository from the central board HUD.

This design document specifies a lightweight, elegant **GitHub Projects View** managed centrally by `manager-pm` (the Incubator v5 fleet manager). It provides a clean catalog of registered GitHub repositories, direct clickable links, and a **live inventory of which agent seats currently have each repository checked out**—with explicit notice when **no agent** has it checked out.

---

## 2. Goals & Explicit Non-Goals

### 2.1 Goals
* [ ] **Dedicated Projects View in HUD**: Add `[📁 Projects]` to the top navigation view switcher (`[🌐 Fleet] [📁 Projects] [📑 Roadmap] [▦ Flat Kanban] [📄 Design Docs]`) with shortcut key `4` (or `P`).
* [ ] **Clean, Direct GitHub Links**: Display every registered project with a prominent, clickable external link to its GitHub repository (`github.com/org/repo ↗`) opening in a new tab.
* [ ] **Live Agent Checkout Inventory**: Automatically detect and display all agent seats that currently have the repository checked out in their local `workspaces/` directory (displaying agent avatar, seat ID, display name, and local workspace path).
* [ ] **Explicit "Not Checked Out" Notice**: If **no agent** currently has the project checked out, the card prominently displays a clear notice: `⚠️ Not checked out by any agent` (unassigned/dormant state).
* [ ] **Quick Board Jump**: For projects checked out by an agent, provide a direct one-click action to inspect that agent's project board (`#agent=<id>&view=swimlanes`).
* [ ] **Centralized Management via `manager-pm`**: Managed through `config/projects.json` in the manager root, supported by REST API (`/api/v1/projects`), Fleet CLI (`fleet project catalog ...`), and a UI "+ Add Project" modal.
* [ ] **Live Workspace Remote Scanner**: Inspects agent seat workspace directories and `.git/config` remotes to match GitHub URLs to active checkouts dynamically.

### 2.2 Explicit Non-Goals
* **No Complex Git Automation**: This is not a Git hosting service or clone manager. It does not perform automated git clones, branch merges, or GitHub PR creation. "Nothing complex, just a clickable link to the github."
* **No Mandatory GitHub OAuth / Personal Access Tokens**: Projects are registered by their public/accessible GitHub URL; no external GitHub API credentials or webhooks are required.
* **No Destructive Workspace Deletions**: Removing a project from the catalog only removes it from the central directory; it never deletes local files from agent seats.

---

## 3. Data Models & Interface Contracts

### 3.1 Project Catalog Schema (`config/projects.json`)
Stored in the Incubator v5 manager root (`manager-pm`):

```json
{
  "version": "1.0.0",
  "projects": [
    {
      "id": "project-alpha",
      "name": "Project Alpha",
      "github_url": "https://github.com/Wolf-of-Blog-Street/project-alpha",
      "description": "Catalina SERP and SEO analysis platform",
      "tags": ["seo", "client"],
      "created_at": "2026-09-10T01:00:00.000Z",
      "updated_at": "2026-09-10T01:00:00.000Z"
    },
    {
      "id": "project-beta",
      "name": "Project Beta",
      "github_url": "https://github.com/Wolf-of-Blog-Street/project-beta",
      "description": "Outreach campaign automation engine",
      "tags": ["outreach", "automation"],
      "created_at": "2026-09-10T01:00:00.000Z",
      "updated_at": "2026-09-10T01:00:00.000Z"
    }
  ]
}
```

### 3.2 Live Inventory Payload Schema (API Return Shape)
When querying `GET /api/v1/projects`, the manager aggregates catalog items with live agent workspace checkouts:

```json
{
  "projects": [
    {
      "id": "project-alpha",
      "name": "Project Alpha",
      "github_url": "https://github.com/Wolf-of-Blog-Street/project-alpha",
      "description": "Catalina SERP and SEO analysis platform",
      "tags": ["seo", "client"],
      "isCheckedOut": true,
      "checkoutCount": 1,
      "checkedOutBy": [
        {
          "agentId": "agent-d-pm",
          "agentName": "Agent D SEO",
          "agentIcon": "🤖",
          "agentColor": "emerald",
          "workspacePath": "workspaces/project-alpha",
          "absolutePath": "~/Projects/agents/agent-d/agent-d/agent-d-pm/workspaces/project-alpha",
          "hasBoard": true,
          "currentBranch": "main"
        }
      ]
    },
    {
      "id": "example-pa",
      "name": "Example PA",
      "github_url": "https://github.com/Wolf-of-Blog-Street/example-pa",
      "description": "Autonomous PA and operational execution engine",
      "tags": ["pa", "assistant"],
      "isCheckedOut": false,
      "checkoutCount": 0,
      "checkedOutBy": []
    }
  ],
  "stats": {
    "totalProjects": 2,
    "checkedOutProjects": 1,
    "unassignedProjects": 1,
    "activeAgentSeats": 5
  }
}
```

### 3.3 REST API Routes (`components/board/api/routes/projects.mjs`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/projects` | Optional (Operator/Loopback) | List all projects with live checkout inventory and summary metrics. |
| `POST` | `/api/v1/projects` | Operator / Admin | Register a new GitHub project (body: `{ name, github_url, description?, tags? }`). |
| `PATCH` | `/api/v1/projects/:id` | Operator / Admin | Update project metadata (body: `{ name?, github_url?, description?, tags? }`). |
| `DELETE` | `/api/v1/projects/:id` | Operator / Admin | Unregister a project from the catalog. |
| `POST` | `/api/v1/projects/scan` | Operator / Admin | Force re-scan of all fleet agent seat workspaces to refresh git remotes. |

### 3.4 CLI Commands (`components/board/tools/fleet.mjs`)

```bash
# List all registered GitHub projects and their live checkout status
node harness/components/board/tools/fleet.mjs project-catalog list

# Add a new GitHub project to the manager catalog
node harness/components/board/tools/fleet.mjs project-catalog add \
  https://github.com/Wolf-of-Blog-Street/project-alpha \
  --name "Project Alpha" --desc "Catalina SERP engine"

# Remove a project from catalog
node harness/components/board/tools/fleet.mjs project-catalog rm project-alpha

# Scan fleet workspaces and report checkout inventory
node harness/components/board/tools/fleet.mjs project-catalog scan
```

---

## 4. UX & Visual Design Specification

### 4.1 HUD View Switcher Integration
The view toggle in `index.html` receives a 5th button:
```
[ 🌐 Fleet (0) ] [ 📁 Projects (1) ] [ 📑 Roadmap (2) ] [ ▦ Flat Kanban (3) ] [ 📄 Design Docs (4) ]
```

### 4.2 Projects View Layout & DOM Structure

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ 📁 GITHUB PROJECTS                     TOTAL: 12  │  CHECKED OUT: 8  │  UNASSIGNED: 4   [+ Add]│
│ Unified repository inventory & live agent checkout allocation                               │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ [ ⌕ Search projects or github repo... ]     [ All (12) ]  [ Checked Out (8) ]  [ Unassigned (4) ]│
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│ ┌──────────────────────────────────────────┐  ┌──────────────────────────────────────────┐  │
│ │ 📁 Project Alpha        🟢 1 Seat       │  │ 📁 Client First Funding    ⚪ Unassigned  │  │
│ │ https://github.com/Wolf.../project-alpha ↗  │  │ https://github.com/.../project-delta ↗      │  │
│ │ Catalina SERP analysis platform          │  │ Client-facing financial portal           │  │
│ │                                          │  │                                          │  │
│ │ CHECKED OUT BY:                          │  │ CHECKED OUT BY:                          │  │
│ │ ┌──────────────────────────────────────┐ │  │ ┌──────────────────────────────────────┐ │  │
│ │ │ 🤖 Agent D SEO (agent-d-pm)│ │  │ │ ⚠️ Not checked out by any agent seat. │ │  │
│ │ │ 📂 workspaces/project-alpha          │ │  │ │    This repository is unassigned.    │ │  │
│ │ │ [ Inspect Board ↗ ]                  │ │  │ └──────────────────────────────────────┘ │  │
│ │ └──────────────────────────────────────┘ │  │                                          │  │
│ └──────────────────────────────────────────┘  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Key UX States

1. **Checked Out State (`isCheckedOut === true`)**:
   - Status Badge: `🟢 Checked Out (N agent seats)`.
   - Cards list each checking-out agent with avatar, seat ID, workspace path, and a quick-action button `Inspect Board ↗` that switches directly to that agent's board.
2. **Unassigned State (`isCheckedOut === false`)**:
   - Status Badge: `⚪ Unassigned` (with subtle neutral/amber styling).
   - Dedicated Notice Box:
     ```html
     <div class="projects-unassigned-notice">
       <span class="notice-icon">⚠️</span>
       <div class="notice-body">
         <span class="notice-title">Not checked out by any agent</span>
         <span class="notice-sub">No active agent seat currently has this repository in its workspace</span>
       </div>
     </div>
     ```
3. **Add Project Modal**:
   - Triggered via `+ Add Project` button.
   - Fields:
     - **GitHub Repository URL** (Required): e.g. `https://github.com/org/repo` (auto-extracts repo name as default title).
     - **Project Name** (Optional, defaults to repository name).
     - **Description** (Optional).
     - **Tags** (Optional, comma-separated).
   - Validation: Validates URL structure (`github.com/...`). On submit, sends `POST /api/v1/projects`, broadcasts SSE update, and renders immediately.

---

## 5. Live Agent Inventory Detection Engine

To maintain an accurate, real-time inventory without requiring complex daemon processes:

1. **Seat Workspace Discovery**:
   - The engine reads all known agent seats from `config/roster.json` and agent directory paths.
   - For each agent seat (e.g. `~/Projects/agents/agent-d/agent-d/agent-d-pm`), it lists directories inside `<seat>/workspaces/`.
2. **Git Remote URL Normalization**:
   - For each workspace subfolder, the engine reads `<seat>/workspaces/<proj>/.git/config` (or parses `git remote get-url origin`).
   - URLs are normalized to handle protocol differences:
     - `https://github.com/Wolf-of-Blog-Street/project-alpha.git` → `Wolf-of-Blog-Street/project-alpha`
     - `git@github.com:Wolf-of-Blog-Street/project-alpha.git` → `Wolf-of-Blog-Street/project-alpha`
3. **Roster Match Fallback**:
   - If an agent's `roster.json` entry explicitly lists a project `id` or `board` matching the project ID, it is also associated.
4. **Inventory Synthesis**:
   - For each catalog project, `checkedOutBy` is constructed by aggregating all matching agent seats.
   - If `checkedOutBy.length === 0`, `isCheckedOut` is set to `false`.
5. **Caching & SSE Broadcast**:
   - Results are cached in-memory with a short TTL (10 seconds) or invalidated immediately whenever an agent seat is provisioned, a project is allocated, or a manual scan is triggered.
   - Real-time updates push through the existing SSE broker (`project:inventory`).

---

## 6. Implementation Milestones

- [x] **Milestone 1: Design Specification & Falcon Board Task Scaffolding**
  - Task 1.1: Author technical design specification in `docs/design/projects.md`.
  - Task 1.2: Register in `INDEX.md`, scaffold tasks on Falcon Board (`board sync-doc projects`).
  - Task 1.3: Move Task 1 to `🔍 In-Review` for operator review and alignment.
- [x] **Milestone 2: Catalog Store & Live Inventory Engine**
  - Task 2.1: Implement `projectsStore.mjs` with `config/projects.json` persistence.
  - Task 2.2: Implement live workspace remote scanner and URL normalizer.
  - Task 2.3: Add unit tests in `tests/projects-store.test.mjs`.
- [x] **Milestone 3: REST API & Fleet CLI Integration**
  - Task 3.1: Create `routes/projects.mjs` (`GET`, `POST`, `PATCH`, `DELETE`, `scan`).
  - Task 3.2: Wire CLI subcommands into `tools/fleet/localCommands.mjs` and `remoteCommands.mjs`.
  - Task 3.3: Add API route integration tests in `tests/projects-api.test.mjs`.
- [x] **Milestone 4: Falcon Board UI Projects View & DevTools Verification**
  - Task 4.1: Add `[📁 Projects]` button to top HUD view toggle and register router hash `#projects`.
  - Task 4.2: Build `projectsView.js` component with search, filter chips, and dark glassmorphic cards.
  - Task 4.3: Implement "+ Add Project" modal dialog and quick jump to agent boards.
  - Task 4.4: Live visual & interactive verification in Chrome using DevTools MCP.

---

## 7. Verification Plan

### 7.1 Automated Tests
```bash
# Run projects store and live scanner unit tests
node --test workspaces/incubator-v5/components/board/tests/projects-store.test.mjs

# Run projects REST API route integration tests
node --test workspaces/incubator-v5/components/board/tests/projects-api.test.mjs

# Run full board test suite to ensure zero regressions
npm test
```

### 7.2 Manual & Live DevTools Verification
1. **Live Browser Navigation**:
   - Open `http://localhost:3333` in Chrome via DevTools MCP.
   - Click `[📁 Projects]` in the HUD; verify view transitions smoothly and URL updates to `#projects`.
2. **Clickable GitHub Links**:
   - Click the GitHub repository link on a project card; confirm it opens the correct GitHub URL in a new tab (`target="_blank"`, `rel="noopener noreferrer"`).
3. **Live Checkout Inspection**:
   - Inspect a project checked out by `agent-d-pm` (e.g. `project-alpha`); confirm agent avatar, name, and workspace path are rendered.
   - Click `[Inspect Board ↗]`; confirm board switches to `agent-d-pm` project view.
4. **Explicit Unassigned State Verification**:
   - Inspect a project with no agent checkouts; confirm the prominent notice `⚠️ Not checked out by any agent` is clearly displayed.
5. **Add Project Modal**:
   - Click `+ Add Project`, enter a new GitHub URL, submit; confirm card immediately renders in the catalog with real-time detection.

---

## 8. Living Docs Update Plan

- [ ] **`docs/system/ARCHITECTURE.md`**: Document the Projects Catalog and live workspace checkout detection engine.
- [ ] **`docs/design/INDEX.md`**: Register `#d-7` in the Active Living Blueprints table.
- [ ] **`harness/HARNESS.md`**: Document the `fleet project-catalog` CLI commands.
