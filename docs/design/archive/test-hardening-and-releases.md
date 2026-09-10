# Test Hardening, Three-Tier Quality Architecture & Safe Releases

- **Codename**: #d-8
- **Color**: #f43f5e
- **Status**: Finished
- **Author**: Manager PM
- **Target Component(s)**: `components/board`, `components/friends`, `components/sweeper`, `tools/test.mjs`, `tools/release.mjs`
- **Last Updated**: 2026-09-09

---

## 1. Context & Problem Statement

As autonomous AI agents develop and fix defects across Incubator v5, test suites have suffered from **AI Test Slop** and rapid fragmentation:
1. **Ad-hoc Bug Test Sprawl**: Rather than reinforcing core behavioral contracts, agents create one-off reproduction files (e.g. `bugs-68-74.test.mjs`, `sweeper-14-bugs.test.mjs`), duplicating server spin-ups, dummy database fixtures, and teardown boilerplate across 4,000+ lines.
2. **Tautological Mocks**: Tests frequently mock production behavior in-line (e.g. duplicating UI helper functions into test files) and assert that the mock returns what was written, verifying zero real production code.
3. **Missing Cadence Boundaries**: Agents either run all 4,000 lines on every single file change (slow, noisy) or run nothing at all, leaving regressions undetected until manual discovery.

To resolve this permanently, we adopt **Google's Test Size & Cadence Philosophy** (*Software Engineering at Google*), mapping tests not by internal structural implementation (avoiding fragile micro-unit tests), but by **operational scope, execution speed, and execution trigger cadence**.

---

## 2. Google's Test Philosophy & The 3-Tier Architecture

Google classifies tests by **Size** (Small, Medium, Large) defined by strict operational constraints, not lines of code:
* **Small Tests**: Single process, no sleep/delays, no blocking I/O, fast, deterministic.
* **Medium Tests**: Multi-process / localhost networking, real database (SQLite), cross-component integration within a single machine.
* **Large Tests**: Full end-to-end user journeys, live external services, multi-tenant lifecycle simulations, failover under load.

We map this directly to our **3-Tier Operational Cadence** with **NO micro-unit test slop**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TIER 1: CONTRACT TESTS                          │
│ Cadence: After Every Task  |  Runtime: < 2.0s  |  Scope: In-Process    │
│ Pure functions, invariant checks, CLI sanitization, schemas & tokens   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    TIER 2: DOC USER JOURNEY TESTS                      │
│ Cadence: After Design Doc Closes  |  Runtime: < 10s  |  Scope: Local E2E│
│ Complete component user workflows (Agent onboarding, doc sync, WAL)   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     TIER 3: RELEASE FLIGHT GATES                       │
│ Cadence: Before Tagging Releases  |  Runtime: < 60s  |  Scope: System  │
│ Clean-node install, multi-tenant failover, live daemon sync, rollback  │
└────────────────────────────────────────────────────────────────────────┘
```

### Tier 1: Contract & Invariant Tests (`npm run test:tier1` / `node tools/test.mjs --tier1`)
- **Trigger**: Run automatically after completing every individual task.
- **Rule**: **NO unit test slop**. We do NOT write tests for `getter returns property` or `mocked helper returns true`.
- **Scope**: Verifies explicit system invariants, protocol parsing, regex bounds, CLI argument attack vectors, token hashing, and schema validation.
- **Performance Budget**: Must complete in **< 2.0 seconds** across the entire workspace. Zero network, zero server port listening, in-process SQLite (`:memory:`) only.

### Tier 2: User Journey & Workflow Tests (`npm run test:tier2` / `node tools/test.mjs --tier2`)
- **Trigger**: Run whenever an Epic / Design Doc milestone or doc is marked finished.
- **Rule**: Written exclusively from the perspective of an external human operator or agent user.
- **Scope**: Multi-component integration. Spins up ephemeral board servers, connects live clients, performs multi-step user scenarios:
  1. *Journey 1*: Provision seat -> Sync design doc -> Mutate tasks -> Verify tenant isolation.
  2. *Journey 2*: Multi-tenant project filtering & status-guarded design doc closing.
  3. *Journey 3*: Live WAL transactions during non-blocking fleet backup and clean recovery.
  4. *Journey 4*: Multi-model Friend sandbox dispatch with credential failover & auto-renewal.
- **Performance Budget**: **< 10.0 seconds**.

### Tier 3: Release Flight Gate & Regression Suite (`npm run test:tier3` / `node tools/test.mjs --tier3`)
- **Trigger**: Run before git tagging, publishing releases, or updating the production daemon on `falcon-manager`.
- **Scope**: Full system audit:
  1. Executes Tier 1 + Tier 2 suites.
  2. Clean-room `harness/tools/install.mjs` execution into a bare directory tree.
  3. Live daemon state sync & rollback dry-run (`tools/release.mjs --dry-run`).
  4. Adversarial security sweeps across modified surfaces.
- **Performance Budget**: **< 60.0 seconds**.

---

## 3. Goals & Explicit Non-Goals

### Goals
- [ ] **Establish 3-Tier Runner**: Create `tools/test.mjs` supporting `--tier1`, `--tier2`, `--tier3`, and `--all`.
- [ ] **Audit & Hard-Trim AI Slop**:
  - Consolidate 11 fragmented board test files into 1 Contract suite (`board.contract.test.mjs`) and 1 User Journey suite (`board.journey.test.mjs`).
  - Delete tautological mock files (e.g. `doc-lifecycle.test.mjs`).
  - Remove stale runner artifacts (e.g. `sweep-api-layer.mjs`).
  - Clean up `.runs/` test residue.
- [ ] **Preserve 100% Real Defect Coverage**: Ensure all historical regressions from bugs #68–#75, #50–#53, and security findings remain strictly guarded inside clean contracts and user journeys.
- [ ] **Author Operational Testing Guide**: Create `docs/TESTING.md` documenting the 3-tier rules, how to run them, and how to write high-signal tests without AI slop.
- [ ] **Automate Safe Release Pipeline**: Create `tools/release.mjs` that enforces Tier 3 passage before allowing version bumps and deployment.

### Explicit Non-Goals
- No micro-unit testing of internal unexported implementation details or simple getters.
- No reliance on external third-party test runners (Jest, Mocha, Vitest). Use Node.js built-in `node:test` and `node:assert/strict` for zero-dependency speed and native ESM support.

---

## 4. Interface Contracts & CLI Specifications

### 4.1 Global Test Runner CLI (`tools/test.mjs`)
```bash
# Run Tier 1 (Post-task fast invariants, <2s)
node tools/test.mjs --tier1

# Run Tier 2 (Post-doc user workflows, <10s)
node tools/test.mjs --tier2

# Run Tier 3 (Pre-release full flight gate)
node tools/test.mjs --tier3

# Run all tiers
node tools/test.mjs --all

# Run specific component within a tier
node tools/test.mjs --tier1 --component board
```

### 4.2 Release Gate CLI (`tools/release.mjs`)
```bash
# Run pre-flight release check without mutating state
node tools/release.mjs preflight

# Execute verified release: runs Tier 3, snapshots DBs, bumps version, git tags
node tools/release.mjs publish --version 5.1.0
```

---

## 5. Implementation Milestones

- [ ] **Milestone 1: Design Doc Approval & Test Taxonomy Definition**
  - Task 1.1: Register `#d-8` in `docs/design/INDEX.md` and sync with Falcon Board.
  - Task 1.2: Author `docs/TESTING.md` operational guide outlining Google-style 3-tier rules.
- [ ] **Milestone 2: Unified Test Runner (`tools/test.mjs`)**
  - Task 2.1: Build `tools/test.mjs` orchestrator with `--tier1`, `--tier2`, `--tier3` filters and summary reporting.
  - Task 2.2: Update `package.json` scripts (`test:tier1`, `test:tier2`, `test:tier3`, `test`).
- [ ] **Milestone 3: Audit, Trimming & Consolidation of Existing Tests**
  - Task 3.1: Board consolidation: merge `auth.test.mjs`, `roster.test.mjs`, `board.test.mjs`, and agent-validation into `components/board/tests/board.contract.test.mjs`.
  - Task 3.2: Board journey consolidation: merge `bugs-68-74.test.mjs`, `api.test.mjs`, `client.test.mjs`, and `multi-agent-isolation.test.mjs` into high-signal `components/board/tests/board.journey.test.mjs`.
  - Task 3.3: Prune dead test slop: delete `doc-lifecycle.test.mjs` and stray artifact `sweep-api-layer.mjs`.
  - Task 3.4: Friends & Sweeper tier tagging: assign existing suites to Tier 1 and Tier 2.
- [ ] **Milestone 4: Tier 3 System Flight Gate & Release Pipeline**
  - Task 4.1: Build `tools/release.mjs` preflight verifier (Tier 3 automated flight check).
  - Task 4.2: End-to-end verification of all three tiers.

---

## 6. Verification Plan

### 6.1 Automated Execution
```bash
# Tier 1 verification (must finish in < 2.0s)
time node tools/test.mjs --tier1

# Tier 2 verification (must finish in < 10.0s)
time node tools/test.mjs --tier2

# Tier 3 verification
node tools/release.mjs preflight
```

### 6.2 Manual / Smoke Verification
- Verify line count reduction from ~4,087 lines down by >30% while maintaining 100% bug coverage (#68–#75).
- Verify Falcon Board sync with `node components/board/tools/client.mjs sync-doc test-hardening-and-releases`.

---

## 7. Living Docs Update Plan
- [ ] **`docs/TESTING.md`**: Living guide for operators and agents on writing and running tests.
- [ ] **`system/MANUAL.md`**: Add CLI command reference for `tools/test.mjs` and `tools/release.mjs`.
- [ ] **Archive**: Update `docs/design/INDEX.md` upon completion.
