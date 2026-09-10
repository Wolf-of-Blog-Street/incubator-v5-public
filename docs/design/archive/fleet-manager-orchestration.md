# Fleet Manager Orchestration & Automated Agent-Board Deployment

- **Status**: In Progress
- **Codename**: #d-3
- **Color**: #10b981
- **Author**: manager-pm (Fleet Manager & Pair Programmer)
- **Target Component(s)**: `components/board`, `components/harness`, `components/fleet`, `system/docs`
- **Last Updated**: 2026-09-08

---

## 1. Context & Problem Statement

In Incubator v5, all agent seats and Gemini/Claude models run **locally on developer workstations/laptops**. Work is executed entirely on local machines with direct pair programming, local IDEs, and local AI reasoning.

To provide the operator with a unified cockpit across distributed local seats without placing any cognitive or network burdens on local agents:
1. **Local Agent Ignorance**: Individual agents must remain completely unaware of remote servers. They interact strictly with their local `board.mjs` CLI and MCP tools.
2. **Central Fleet Manager Authority**: The Incubator v5 manager seat (e.g., `manager-pm`) governs the fleet. It manages `config/roster.json`, provisions unique cryptographic agent tokens, manages physical SQLite board files, and automates harness deployment.
3. **Dual Deployment Topologies**: The board server must run identically either **locally** (standalone single-dev mode with SQLite) or **centrally on Falcon Manager** (multi-tenant REST API with Bearer auth, connection pooling, and live telemetry).

This design specification formalizes the orchestration layer, security contracts, fleet provisioning CLI, and automated harness deployment pipeline that binds the Manager, Central Board Server, and local agent seats together.

---

## 2. Goals & Explicit Non-Goals

### 2.1 Goals
- [ ] **Manager Governance & Declaration**: Formalize schema for `manager` section in `config/roster.json` defining orchestrator roles, privileges, managed roots, and master operator tokens.
- [ ] **Agent Ignorance via Transparent Client Proxy**: Ensure `components/board/tools/client.mjs` transparently proxies all CLI and MCP calls over HTTP/Bearer to `FALCON_BOARD_URL` when set, falling back to local SQLite when unset or offline.
- [ ] **Fleet Provisioning CLI (`fleet.mjs`)**: Build an operator/manager CLI to register new agents, generate cryptographically secure tokens (`agt_live_<agent>_<crypto>`), allocate isolated database files, and declare workspace projects.
- [ ] **Automated Remote & Local Harness Deployment**: Extend `install.mjs` and provide a provisioning workflow that deploys the v5 harness to target agent seats, injects `harness/falcon.env`, and validates end-to-end board connectivity.
- [ ] **Central Server Production Readiness**: Provide containerization (`Dockerfile`, `docker-compose.yml`) and process supervision templates (`systemd` / PM2 service units) for 24/7 central hosting on Falcon Manager.
- [ ] **Manager Self-Management**: The manager uses its own local board and in-repo docs to dogfood its fleet orchestration tasks.

### 2.2 Explicit Non-Goals
- **No Agent Network Knowledge**: We will **never** teach local worker agents about HTTP REST endpoints, network tokens, or remote servers. All complexity is encapsulated inside `client.mjs`.
- **No Shared Database Tables**: No multi-tenant shared tables. Every agent and project gets a physically distinct SQLite database file (`boards/<agent>.<project>.sqlite`).
- **No External Cloud SaaS Dependencies**: The entire fleet management stack runs on pure Node.js ESM built-ins (`node:crypto`, `node:http`, `node:sqlite`, `node:fs`). Zero third-party npm runtime dependencies.

---

## 3. Data Models & Interface Contracts

### 3.1 Roster Configuration Schema (`config/roster.json`)

The central host stores `config/roster.json`. It defines the manager entity, operator security credentials, and the fleet of managed agent seats.

```json
{
  "version": "5.0.0",
  "default_agent": "manager-pm",
  "operator_token_hash": "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  "manager": {
    "agent_id": "manager-pm",
    "role": "fleet-orchestrator",
    "home_path": "~/Projects/agents/incubator-v5/manager/manager-pm",
    "managed_agents_root": "~/Projects/agents/incubator-v5",
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
      "tags": ["manager", "orchestrator", "pair"],
      "token_hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "projects": [
        {
          "id": "incubator-v5",
          "name": "Incubator v5 Platform",
          "board": "manager-pm.incubator-v5.sqlite",
          "docs_path": "docs/design"
        }
      ]
    },
    {
      "id": "example-pa",
      "name": "Example PA (Product Architect)",
      "icon": "🦅",
      "color": "cyan",
      "tags": ["architect", "design"],
      "token_hash": "sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
      "projects": [
        {
          "id": "incubator-v5",
          "name": "Incubator v5 Platform",
          "board": "example-pa.incubator-v5.sqlite",
          "docs_path": "docs/design"
        }
      ]
    }
  ]
}
```

### 3.2 Agent Environment Contract (`harness/falcon.env`)

Injected by the Manager during harness installation into the target agent's root:

```bash
# Auto-generated by Incubator v5 Fleet Manager — DO NOT EDIT DIRECTLY
FALCON_BOARD_URL="http://falcon.internal:3333"
FALCON_AGENT_ID="example-pa"
FALCON_AGENT_TOKEN="agt_live_example-pa_8f0a21d9b3e7c541"
FALCON_DEFAULT_PROJECT="incubator-v5"
```

The harness session startup script (`harness/bin/init.sh` or hook) sources this file automatically. When the local agent executes any `board` command, `client.mjs` transparently authenticates with the central server.

### 3.3 Security & Cryptographic Contract

1. **Token Generation**:
   Tokens are formatted as:
   `agt_live_<agent_id>_<hex(crypto.randomBytes(24))>`
2. **Token Verification**:
   - The central server stores only SHA-256 hashes (`token_hash: sha256(...)`).
   - Requests arrive with header `Authorization: Bearer agt_live_...`.
   - The server computes `sha256(token)` and compares it against stored hashes using `crypto.timingSafeEqual(bufferA, bufferB)`.
3. **Tenant Boundary Enforcement**:
   - `assertTenantAccess(callerAgentId, requestedAgentId, isOperator)`:
     If `callerAgentId !== requestedAgentId` and caller is not the operator, the server aborts with HTTP `403 Forbidden`.
   - Each project board points to an isolated SQLite file in `boards/<agent_id>.<project_id>.sqlite`.

---

## 4. Architecture & Component Interaction Flow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                CENTRAL HOST (Falcon Manager)                           │
│                                                                                        │
│   components/board/tools/serve.mjs                                                     │
│     ├── config/roster.json (Manager declaration, operator token hash, agent hashes)   │
│     ├── boards/*.sqlite (Physical multi-tenant SQLite database pool)                   │
│     ├── API Server: /api/v1/roster, /api/v1/agents/:id/projects/:pid/(board|tasks|docs)│
│     └── Web UI: Fleet Topology Matrix (#fleet), Swimlanes (#swimlanes), Docs (#docs)   │
└──────────────────────────────────────────▲─────────────────────────────────────────────┘
                                           │
                        Ingestion API Calls over HTTP / Bearer Auth
                                           │
         ┌─────────────────────────────────┴─────────────────────────────────┐
         │                                                                   │
┌────────┴─────────────────────────────────────────┐       ┌─────────────────┴─────────────────────────────────┐
│ LOCAL AGENT SEAT 1: Manager PM (Manager)           │       │ LOCAL AGENT SEAT 2: Example PA (Worker)            │
│                                                  │       │                                                   │
│ 1. Pair Programming CLI / Operator Cockpit       │       │ 1. Claude / Gemini Pair Programming Session       │
│ 2. Fleet Tooling:                                │       │ 2. Unaware of Server: Runs standard board CLI     │
│    - fleet.mjs (Provision new agents/boards)     │       │    `node harness/components/board/tools/board.mjs` │
│    - install.mjs (Deploy harness & falcon.env)   │       │ 3. client.mjs transparently routes calls:         │
│ 3. In-Repo Code & Docs (workspaces/incubator-v5) │       │    `FALCON_BOARD_URL` set? -> Remote HTTP proxy   │
│ 4. Local Board Fallback (boards/project.sqlite)  │       │    `FALCON_BOARD_URL` unset? -> Local SQLite      │
└──────────────────────────────────────────────────┘       └───────────────────────────────────────────────────┘
```

---

## 5. Implementation Milestones & Task Breakdown

### Milestone 1: Manager Configuration Schema & Fleet Engine
- [x] **Task 1.1: Formalize Manager & Fleet Schema in `roster.mjs`**
  - Add support for top-level `manager` configuration object in `openRoster()`.
  - Validate manager credentials, managed agent root directory, and administrative capabilities.
  - Implement programmatic methods: `roster.getManager()`, `roster.registerAgent(agentDef)`, `roster.revokeAgent(agentId)`, `roster.allocateProject(agentId, projectDef)`.
- [x] **Task 1.2: Roster Administrative API Endpoints**
  - Implement authenticated admin routes in `server.mjs`:
    - `POST /api/v1/admin/agents`: Register new agent seat and return generated token.
    - `DELETE /api/v1/admin/agents/:id`: Revoke agent credentials.
    - `POST /api/v1/admin/agents/:id/projects`: Add new workspace project to agent roster.
    - `GET /api/v1/admin/fleet/status`: Deep health check across all pooled SQLite databases.
  - Guard all admin routes with `operatorToken` or manager authorization.
- [x] **Task 1.3: Unit Test Suite for Fleet Engine**
  - Create `components/board/tests/fleet-engine.test.mjs` verifying agent registration, token generation, hash verification, project allocation, and administrative access controls.

### Milestone 2: Fleet Management CLI (`fleet.mjs`)
- [x] **Task 2.1: Author `components/board/tools/fleet.mjs`**
  - Build command-line interface for the manager seat:
    - `fleet list`: Pretty-print all registered agents, project boards, and health status.
    - `fleet add <agent-id> --name <name> --icon <icon> --projects <p1,p2>`: Register agent, generate token, and initialize databases.
    - `fleet remove <agent-id>`: Decommission agent from roster.
    - `fleet token <agent-id> --rotate`: Rotate security token and output new secret.
    - `fleet verify <agent-id>`: Test connection and permissions for an agent seat.
- [x] **Task 2.2: CLI Tests & Error Handling**
  - Verify collision prevention (cannot overwrite existing agents without `--force`), invalid ID sanitization, and output masking for security tokens.

### Milestone 3: Automated Agent Provisioning & Harness Installer
- [x] **Task 3.1: Automated Provisioning Pipeline (`fleet provision`)**
  - Wire up end-to-end provisioning workflow:
    1. Register agent in central roster.
    2. Create target directory at `<managed_agents_root>/<agent-id>` if non-existent.
    3. Run `components/harness/tools/install.mjs` targeting the agent seat.
    4. Inject `harness/falcon.env` with server URL, agent ID, and generated token.
    5. Initialize default project directories (`workspaces/` and `projects/`).
- [x] **Task 3.2: Environment Integration in Local Harness**
  - Update `components/harness/templates/HARNESS.md.template` and session startup hook to auto-load `harness/falcon.env` if present.
  - Verify that `board.mjs` transparently picks up `FALCON_BOARD_URL` and `FALCON_AGENT_TOKEN`.

### Milestone 4: Central Server Production Deployment & Containerization
- [x] **Task 4.1: Production Packaging**
  - Author `deploy/Dockerfile` for minimal zero-dependency Node.js Alpine runtime.
  - Author `deploy/docker-compose.yml` with persistent volume mounts (`/data/boards`, `/data/config`).
  - Author `deploy/systemd/falcon-board.service` template for Linux hosts.
- [x] **Task 4.2: Backup & Integrity Utilities**
  - Author `components/board/tools/backup.mjs` leveraging SQLite's native `VACUUM INTO` for online, non-blocking snapshot backups of all fleet databases.

### Milestone 5: End-to-End Verification & Living System Documentation
- [x] **Task 5.1: Multi-Agent Ingestion & Isolation Verification**
  - Provision fixture agents `example-pa` and `sweeper-bot`.
  - Simulate concurrent task creation and design doc sync from multiple independent client processes.
  - Verify that each agent only mutates its own board, while the Central Board UI reflects the full fleet in real time.
- [x] **Task 5.2: Update Living System Documentation**
  - Fold deployment topology and manager operational commands into `docs/system/ARCHITECTURE.md` and `docs/system/MANUAL.md`.
  - Document production deployment runbooks in `docs/support/RUNBOOK.md`.

---

## 6. Verification Plan

### 6.1 Automated Test Execution
```bash
# In workspaces/incubator-v5
npm test
# Run fleet engine and administrative integration tests
node --test components/board/tests/fleet-engine.test.mjs
```

### 6.2 Manual Smoke & Provisioning Verification
```bash
# 1. Start central server with multi-agent roster
node components/board/tools/serve.mjs --port 3333 --roster config/roster.json --boards-dir boards/

# 2. Provision new agent seat 'test-worker'
node components/board/tools/fleet.mjs provision test-worker \
  --name "Test Worker" \
  --icon "🧪" \
  --target /tmp/test-worker-seat

# 3. Verify target seat environment
cat /tmp/test-worker-seat/harness/falcon.env

# 4. Run board CLI from test seat without knowing about central server
cd /tmp/test-worker-seat
node harness/components/board/tools/board.mjs add "Execute smoke test" --track test

# 5. Verify task appears on central dashboard at http://localhost:3333/#agent=test-worker
```

---

## 7. Living Docs Update Plan

- [ ] **`docs/system/ARCHITECTURE.md`**: Add Section 5 "Fleet Management, Manager Role, and Deployment Topologies".
- [ ] **`docs/system/MANUAL.md`**: Add CLI command reference for `fleet.mjs` and deployment flags.
- [ ] **`docs/support/RUNBOOK.md`**: Add operational guide for deploying on a central server, rotating tokens, and configuring systemd/docker.
