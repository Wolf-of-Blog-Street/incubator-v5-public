# Incubator v5 Testing Guide & Operational Manual

> **Philosophy**: We follow Google's Test Size & Operational Cadence philosophy (*Software Engineering at Google*). Tests are not categorized by arbitrary code structures or mocked micro-units. They are classified by **scope, execution constraints, and operational trigger cadence**.

---

## 1. The Core Rule: Zero AI Test Slop

### What We NEVER Write (Forbidden "AI Slop")
1. **No Tautological Mocks**: Never copy-paste internal helpers or functions into a test file and assert that calling the copy returns expected values. (e.g. `isDocClosed` copy-pasted in test files).
2. **No Getter/Setter Tests**: Never test whether an object property or array getter simply returns its property.
3. **No Standalone "Patch Reproduction" Files**: When fixing a bug, do NOT create a new `bug-X.test.mjs` file that duplicates server bootstrapping, temp folders, and fixtures. Add the invariant check to the domain Contract test (Tier 1) or add the scenario step to the User Journey test (Tier 2).
4. **No Ephemeral Scratch Scripts in Tests**: Never commit adversarial test runner scripts (e.g. `sweep-api-layer.mjs`) into `components/*/tests/`.

---

## 2. The 3-Tier Testing Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            TIER 1: CONTRACT TESTS                           │
│  Trigger: After Every Task Completed                                        │
│  Budget:  < 2.0 Seconds | In-Process Only | Zero Network | Fast Invariants   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TIER 2: USER JOURNEY TESTS                           │
│  Trigger: After Design Doc / Milestone Completed                            │
│  Budget:  < 10.0 Seconds | Localhost Ephemeral E2E | Real User Scenarios     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     TIER 3: SYSTEM DEEP RELEASE FLIGHT                      │
│  Trigger: Before Tagging Releases / Production Deployments                  │
│  Budget:  Deep Execution (Minutes) | Multi-Model Sweeper | Live Snapshot    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tier Breakdown & Execution Rules

### Tier 1: Contract & Invariant Tests
* **When to Run**: Run **after every single task**. This is your rapid feedback loop while pairing or running blitz tasks.
* **Command**:
  ```bash
  npm run test:tier1
  # or
  node tools/test.mjs --tier1
  ```
* **Execution Budget**: `< 2.0 seconds` for the entire platform.
* **Constraints (Google Small Test standard)**:
  - In-process only.
  - No `fetch()`, no HTTP servers, no listening network sockets.
  - In-memory SQLite (`:memory:`) or fast temporary SQLite instances.
  - Zero `sleep` or timers.
* **What Lives Here**:
  - Security validation: Agent ID regex guards (rejecting `--flag` injection, directory traversal).
  - Cryptographic hashing: Token generation, SHA-256 hash verification, mask formatting.
  - Schema & Protocol contracts: Markdown design doc YAML/header parsers, user story resolvers.
  - Status transition state machines: Board item status transitions (`planned` -> `in-progress` -> `done`).

---

### Tier 2: User Journey Tests
* **When to Run**: Run **after finishing an Epic or Design Doc**. Before marking a doc as `Finished` or closing it.
* **Command**:
  ```bash
  npm run test:tier2
  # or
  node tools/test.mjs --tier2
  ```
* **Execution Budget**: `< 10.0 seconds`.
* **Constraints (Google Medium Test standard)**:
  - Black-box perspective: Written strictly from the viewpoint of an external agent CLI or human operator.
  - Uses real ephemeral HTTP servers on ephemeral port `0` and live HTTP `BoardClient`.
  - Multi-agent isolation: Simulates two different agent seats interacting with the server.
* **Core Scenarios Tested**:
  - **Journey A (Agent Provisioning & Doc Sync)**: Provision agent seat -> authenticate with Bearer token -> push design doc -> create tasks -> ensure tenant B cannot read or delete tenant A's tasks.
  - **Journey B (Doc Completion Guard & Lifecycle)**: Create doc with open tasks -> attempt to close doc -> verify rejection guard -> mark all tasks done -> close doc successfully.
  - **Journey C (Live WAL Database Backup & Recovery)**: Stream 100 concurrent task updates into an active SQLite database under WAL mode -> trigger atomic fleet backup -> restore snapshot into a clean directory -> verify 100% row integrity.
  - **Journey D (Friend Model Sandbox Dispatch)**: Dispatch sandboxed sub-agent -> verify config path isolation -> verify credential auto-renewal when expiring.

---

### Tier 3: System Deep Release Flight Gate
* **When to Run**: Run **before tagging any release (`vX.Y.Z`)** or deploying updates to the live daemon.
* **Command**:
  ```bash
  npm run test:tier3
  # or
  node tools/test.mjs --tier3
  # or via the release pipeline:
  node tools/release.mjs preflight
  ```
* **Execution Budget**: Deep & thorough (can take several minutes).
* **Scope (Google Large / System Test standard)**:
  - **Full Tier 1 + Tier 2 execution**.
  - **Clean-Room Seat Installation**: Runs `components/harness/tools/install.mjs` against a completely empty temporary directory tree to guarantee zero dirty-workspace side effects and verify file permissions (0600 for env files).
  - **Multi-Model Adversarial Bug Sweeper**: Runs the 3-wave Sweeper (`gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-1.5-pro` or Astra) across modified surface code to discover latent edge cases and invariant breaches.
  - **Live Production Database Sync & Snapshot Verification**: Connects to the real local Falcon Board instance or runs a full snapshot dry-run to verify migration compatibility and rollback safety.
  - **Clean Working Tree**: Confirms clean `jj` / git working copy with no uncommitted scratch artifacts.

---

## 4. How to Add New Tests (Checklist for Agents)

When adding test coverage for a new feature or bug fix, follow this decision tree:

1. **Is it a pure function, regex, security guard, token hash, or schema parser?**
   👉 Add it to the component's **`*.contract.test.mjs`** (Tier 1). Keep it sub-millisecond.
2. **Is it a user/agent workflow, HTTP endpoint sequence, or multi-tenant interaction?**
   👉 Add a scenario step to the component's **`*.journey.test.mjs`** (Tier 2).
3. **Is it a release check, bare installation test, or adversarial sweep?**
   👉 Add it to the Tier 3 Release Flight Suite in **`tools/release.mjs`**.

**NEVER create a standalone `bug-XYZ.test.mjs` file!**
