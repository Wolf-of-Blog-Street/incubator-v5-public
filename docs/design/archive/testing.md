# Quality Architecture & Testing

- **Codename**: #d-5
- **Color**: #f59e0b
- **Status**: Closed
- **Author**: Manager PM
- **Target Component(s)**: `tools/test.mjs`, `tools/release.mjs`, `docs/TESTING.md`
- **Last Updated**: 2026-09-10

---

## 1. Context & Architecture Overview

To eliminate **AI Test Slop** (fragile micro-unit tests, tautological mocks, and ad-hoc reproduction files), Incubator v5 adopts **Google's Test Size & Cadence Philosophy** (*Software Engineering at Google*).

Tests are organized strictly by operational constraints and execution cadence rather than internal code structure.

---

## 2. The 3-Tier Operational Hierarchy

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
│ Cadence: After Milestone Closes   |  Runtime: < 10s  |  Scope: Local E2E│
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

---

## 3. CLI Contracts

```bash
# Rapid in-process contract tests (< 2.0s)
npm run test:tier1

# Component user journey tests (< 10.0s)
npm run test:tier2

# Full flight release pre-check
node tools/release.mjs preflight
```

---

## 4. Invariants & Rules
- **No Unit Test Slop**: No testing of getters, simple object returns, or in-line mocks.
- **Single Source of Truth**: When bugs are fixed, tests are added to the component's domain Contract test (Tier 1) or Journey test (Tier 2).
