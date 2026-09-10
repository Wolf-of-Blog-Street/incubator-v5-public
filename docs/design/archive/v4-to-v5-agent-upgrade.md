# Multi-Agent Incubator v5 Fleet Upgrade & Legacy V4 Cleanup

- **Status**: In Progress
- **Codename**: #d-6
- **Color**: #38bdf8
- **Author**: manager-pm (Fleet Manager & Pair Programmer)
- **Target Component(s)**: `components/fleet`, `components/harness`, `components/board`, `config/roster.json`
- **Last Updated**: 2026-09-09

---

## 1. Context & Problem Statement

Across `~/Projects/agents`, six key agent seats exist that were originally provisioned during the Incubator v4 development cycle:
1. `project-gamma` (`agent-g-pm`)
2. `project-brain` (`agent-c-pm`)
3. `example-pa` (`agent-b-pm`)
4. `agent-d` (`agent-d-pm`)
5. `project-blog` (`agent-f-pm`)
6. `project-social` (`agent-e-pm`)

These seats currently contain heterogeneous and outdated configurations: legacy v4.3/v4.6 harnesses, multiple SQLite databases with deprecated schemas, obsolete `.accounts/codex` and `project-management/` directories, and lack of integration with the central Incubator v5 multi-tenant board server running on Falcon Manager.

This design document establishes the standard, non-destructive upgrade procedure to:
1. Clean up legacy v4 debris while safeguarding historical databases and Git/JJ repositories.
2. Install the modern Incubator v5 harness (`harness/HARNESS.md`, `engine/brain.mjs`, v5 component libraries).
3. Discover and register all active repositories under `workspaces/` as distinct projects in `config/roster.json`.
4. Provision secure, cryptographic bearer tokens in `harness/falcon.env` for transparent remote board synchronization.
5. Surface all agents, their workspaces, and their design documents on the Central Board.

---

## 2. Goals & Explicit Non-Goals

### 2.1 Goals
- [ ] **Non-Destructive V4 Cleanup**: Archive obsolete `project-management/`, `roles/`, and legacy account folders into a seat-local `_legacy_v4/` directory rather than deleting them outright.
- [ ] **Incubator v5 Harness Deployment**: Install the modern v5 harness stack into each of the 6 seats via `installHarness()`, guaranteeing uniform engine, docs, board, sweeper, and brain capabilities.
- [ ] **Comprehensive Workspace Registration**: Map each seat's active codebases into `config/roster.json` projects (e.g., `project-gamma-v3`, `project-gamma-v4`, `project-brain`, `example-pa`, `project-alpha`, `project-beta`, `project-blog`, `project-social`).
- [ ] **Central Board Connection & Security**: Issue unique cryptographic bearer tokens (`agt_live_<seat>_<crypto>`) for each agent and generate clean `harness/falcon.env` files pointing to `http://localhost:3333`.
- [ ] **Live Central Board Visibility**: Ensure all 6 agents appear in the Central Board UI's Fleet matrix, Agent Switcher dropdown, and Design Docs catalog with their actual design specifications.

### 2.2 Explicit Non-Goals
- **No Git / Version Control Destruction**: Never reset, overwrite, or delete `.git` or `.jj` directories in any seat or workspace.
- **No Codebase Disruption**: Do not modify source code inside workspaces (e.g., inside `project-gamma-v3/`, `project-blog/`, etc.); only manage the seat wrapper, harness, and board configuration.
- **No Manual Multi-Step Agent Operations**: The local agent sessions remain completely unaware of remote REST infrastructure; everything is handled transparently through `client.mjs` and `falcon.env`.

---

## 3. Data Models & Interface Contracts

### 3.1 Roster Configuration Schema (`config/roster.json`)

The central roster on Falcon Manager and the local manager seat declare each agent seat, its icon, brand color, security hash, and workspace projects:

```json
{
  "version": "5.0.0",
  "default_agent": "manager-pm",
  "operator_token_hash": null,
  "manager": {
    "agent_id": "manager-pm",
    "role": "fleet-orchestrator",
    "home_path": "~/Projects/agents/incubator-v5/manager/manager-pm",
    "managed_agents_root": "~/Projects/agents",
    "capabilities": [
      "provision-agent",
      "install-harness",
      "audit-fleet",
      "deploy-board"
    ]
  },
  "agents": [
    {
      "id": "manager-pm",
      "name": "Manager PM (Fleet Manager)",
      "icon": "🛡️",
      "color": "cyan",
      "tags": ["manager", "orchestrator"],
      "token_hash": "...",
      "projects": [
        { "id": "incubator-v5", "name": "Incubator v5 Platform", "board": "incubator-v5.sqlite", "docs_path": "docs/design" }
      ]
    },
    {
      "id": "agent-g-pm",
      "name": "Agent G PM",
      "icon": "🗺️",
      "color": "indigo",
      "tags": ["atlas", "research", "pipeline"],
      "token_hash": "...",
      "projects": [
        { "id": "project-gamma-v3", "name": "Project Gamma v3", "board": "agent-g-pm.project-gamma-v3.sqlite", "docs_path": "workspaces/project-gamma-v3/docs/design" },
        { "id": "project-gamma-v4", "name": "Project Gamma v4", "board": "agent-g-pm.project-gamma-v4.sqlite", "docs_path": "workspaces/project-gamma-v4/docs/design" }
      ]
    },
    {
      "id": "agent-c-pm",
      "name": "Agent C PM",
      "icon": "🧠",
      "color": "purple",
      "tags": ["brain", "memory", "core"],
      "token_hash": "...",
      "projects": [
        { "id": "project-brain", "name": "Project Brain Platform", "board": "agent-c-pm.project-brain.sqlite", "docs_path": "workspaces/project-brain-docs/design" }
      ]
    },
    {
      "id": "agent-b-pm",
      "name": "Agent B PM",
      "icon": "🦅",
      "color": "cyan",
      "tags": ["pa", "assistant", "architect"],
      "token_hash": "...",
      "projects": [
        { "id": "example-pa", "name": "Example PA Platform", "board": "agent-b-pm.example-pa.sqlite", "docs_path": "workspaces/example-pa-docs/design" }
      ]
    },
    {
      "id": "agent-d-pm",
      "name": "Agent D PM",
      "icon": "🌊",
      "color": "teal",
      "tags": ["seo", "audit", "crawler"],
      "token_hash": "...",
      "projects": [
        { "id": "project-alpha", "name": "Project Alpha", "board": "agent-d-pm.project-alpha.sqlite", "docs_path": "docs/design" },
        { "id": "project-beta", "name": "Project Beta", "board": "agent-d-pm.project-beta.sqlite", "docs_path": "docs/design" }
      ]
    },
    {
      "id": "agent-f-pm",
      "name": "Agent F PM",
      "icon": "🐺",
      "color": "amber",
      "tags": ["blog", "marketing", "platform"],
      "token_hash": "...",
      "projects": [
        { "id": "project-blog", "name": "Wolf of Blog Street", "board": "agent-f-pm.project-blog.sqlite", "docs_path": "workspaces/project-blog/apps/com/docs/design" }
      ]
    },
    {
      "id": "agent-e-pm",
      "name": "Agent E PM",
      "icon": "📱",
      "color": "rose",
      "tags": ["social", "distribution"],
      "token_hash": "...",
      "projects": [
        { "id": "project-social", "name": "Project Social", "board": "agent-e-pm.project-social.sqlite", "docs_path": "workspaces/project-social-docs/design" }
      ]
    }
  ]
}
```

### 3.2 Seat Environment File (`harness/falcon.env`)
```bash
# Auto-generated by Incubator v5 Fleet Manager — DO NOT EDIT DIRECTLY
FALCON_BOARD_URL="http://localhost:3333"
FALCON_AGENT_ID="<seat-id>"
FALCON_BOARD_TOKEN="agt_live_<seat-id>_<hex_entropy>"
FALCON_DEFAULT_PROJECT="<primary-project-id>"
```

---

## 4. Implementation Milestones

- [ ] **Milestone 1: Roster Registration & Central Provisioning**
  - Task 1.1: Generate cryptographic bearer tokens and SHA-256 hashes for all 6 target agents.
  - Task 1.2: Register agents and workspace projects in `config/roster.json` on local manager seat and Falcon Manager host.
  - Task 1.3: Initialize dedicated physical SQLite board files (`boards/<agent>.<project>.sqlite`).
- [ ] **Milestone 2: Seat Cleanup & Non-Destructive Archival**
  - Task 2.1: Move legacy `project-management/`, `roles/`, and obsolete `.accounts/` into `<seat>/_legacy_v4/`.
  - Task 2.2: Ensure clean directory structure (`workspaces/`, `projects/`, `brain/`, `boards/`).
- [ ] **Milestone 3: Harness Installation & Invariants Enforcement**
  - Task 3.1: Execute `installHarness({ agentHome, initCards: true })` for all 6 seats.
  - Task 3.2: Inject `harness/falcon.env` with 0600 file permissions.
  - Task 3.3: Deploy standard `AGENTS.md` and `CLAUDE.md` referencing `harness/HARNESS.md`.
  - Task 3.4: Update `install.json` to reflect `"incubator_release": "v5.0.0"`.
- [ ] **Milestone 4: Falcon Manager Synchronization & Board Deployment**
  - Task 4.1: Synchronize updated boards and `roster.json` to Falcon Manager server.
  - Task 4.2: Restart board server on port 3333.
- [ ] **Milestone 5: Verification & Walkthrough**
  - Task 5.1: Verify board API and CLI access from each seat using `board.mjs summary`.
  - Task 5.2: Verify visual rendering of all seats and projects in Central Board UI.
  - Task 5.3: Document results in `walkthrough.md`.

---

## 5. Verification Plan

### 5.1 Automated Tests
```bash
# Verify fleet engine tests
node --test components/board/tests/fleet-engine.test.mjs
node --test components/board/tests/doc-lifecycle.test.mjs
npm test
```

### 5.2 Seat CLI Verification
From each upgraded agent seat, run:
```bash
node harness/components/board/tools/board.mjs summary
```
Expected output: valid board summary returned via remote Central Board transparent proxy.

### 5.3 Central Board Web UI Verification
Access `http://localhost:3333`:
1. Check Fleet Overview (`#fleet`): all 7 agents (`manager-pm`, `agent-g-pm`, `agent-c-pm`, `agent-b-pm`, `agent-d-pm`, `agent-f-pm`, `agent-e-pm`) show active status.
2. Select each agent from top-left switcher: confirm assigned workspace projects, task cards, and design documents load cleanly.
