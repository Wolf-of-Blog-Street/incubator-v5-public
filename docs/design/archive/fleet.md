# Fleet & Agents

- **Codename**: #d-2
- **Color**: #10b981
- **Status**: Closed
- **Author**: Manager PM
- **Target Component(s)**: `components/fleet`, `components/harness`, `config/roster.json`, `tools/fleet.mjs`, `install.mjs`
- **Last Updated**: 2026-09-10

---

## 1. Context & Architecture Overview

In Incubator v5, all agent seats run locally on developer workstations with direct pair programming and IDE integration. To coordinate across distributed seats:
1. **The Central Fleet Manager Authority**: Managed by `manager-pm`, governing `config/roster.json`, issuing cryptographic bearer tokens (`agt_live_<agent>_<crypto>`), and managing distinct SQLite database files per agent/project.
2. **Automated Harness Provisioning (`install.mjs`)**: Deploys uniform v5 harness tooling, living manuals, and secure environments (`harness/falcon.env`) across all agent seats.
3. **Workspace Project Discovery**: Automatically discovers active codebases and maps them to clean project slots on the central board.

This document consolidates `v5-foundation`, `fleet-manager-orchestration`, and `v4-to-v5-agent-upgrade` into an enduring living specification.

---

## 2. Goals & Invariants

- [x] **Unified Multi-Seat Roster**: Support all active seats (`manager-pm`, `agent-b-pm`, `agent-d-pm`, `agent-c-pm`, `agent-e-pm`, `agent-f-pm`, `agent-g-pm`).
- [x] **Isolated SQLite Databases**: No shared multi-tenant tables. Every agent/project has its own dedicated physical SQLite file.
- [x] **Non-Destructive Upgrade Protocol**: Legacy v4 files are cleanly moved to `_legacy_v4/` with `.git` and `.jj` repositories preserved.
- [x] **Living Spec Anchor**: Any task involving agent provisioning, seats, or harness tooling attaches here so agents load required context first.

---

## 3. Data Contracts

### 3.1 Roster Schema (`config/roster.json`)
```json
{
  "version": "5.0.0",
  "default_agent": "manager-pm",
  "manager": {
    "agent_id": "manager-pm",
    "role": "fleet-orchestrator",
    "capabilities": ["provision-agent", "install-harness", "audit-fleet"]
  },
  "agents": [
    {
      "id": "manager-pm",
      "name": "Manager PM",
      "token": "agt_live_manager_...",
      "projects": [
        { "id": "default", "name": "Manager Default", "board": "manager-pm.default.sqlite" }
      ]
    }
  ]
}
```

### 3.2 Fleet CLI (`components/board/tools/fleet.mjs`)
```bash
# List all registered agents and projects
node components/board/tools/fleet.mjs list

# Provision a new agent seat
node components/board/tools/fleet.mjs register-agent --id example-pa --name "Example PA"
```

---

## 4. Verification Plan
- **Contract Tests (Tier 1)**: `node tools/test.mjs --tier1 --component board` (validates roster parser, token hashing, agent ID sanitization).
- **Harness Journey Tests (Tier 2)**: `node tools/test.mjs --tier2 --component harness` (validates `install.mjs`, file permissions `0600`, and symlink defense).
