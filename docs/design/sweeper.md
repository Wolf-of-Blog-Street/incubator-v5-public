# 3-Wave Bug Sweeper

- **Codename**: #d-4
- **Color**: #f43f5e
- **Status**: Open & Inactive
- **Author**: Manager PM
- **Target Component(s)**: `components/sweeper`, `tools/sweep.mjs`, `engine/sweeper.mjs`
- **Last Updated**: 2026-09-09

---

## 1. Context & Architecture Overview

Synthetic adversarial fuzzing in a vacuum consistently fails because tests miss real environment constraints and API contracts.

The **Bug Sweeper** audits code through **Intent-Driven Mental Walkthroughs** modeled after senior human engineers:
1. **Spec & Story Grounding**: The sweeper never audits code in a vacuum; it parses design docs and user stories first.
2. **Mental Walkthroughs (Waves 1 & 2)**: Traces execution step-by-step from invocation to completion, detecting silent degradation and false success.
3. **Reproducible Test Proofs (Wave 3)**: Generates executable Node.js tests (`node:test`) proving defects before fixes are attempted.
4. **The Gavel**: A frontier judge model filters theoretical noise from genuine operational roadblocks.

This document refines `sweeper-intent-and-stories` into the permanent living blueprint for the sweeper subsystem.

---

## 2. CLI Contracts (`components/sweeper/tools/sweep.mjs`)

```bash
# Sweep component against its living design doc
node components/sweeper/tools/sweep.mjs --target components/board --spec docs/design/board-and-workflow.md

# Sweep with specific user story
node components/sweeper/tools/sweep.mjs --target components/board/tools/client.mjs --story "Agent runs board sync-doc from a nested workspace folder and expects the doc to appear on the remote Falcon Board"
```

---

## 3. Verification Plan
- **Contract Tests (Tier 1)**: `node tools/test.mjs --tier1 --component sweeper` (validates file scope resolver, ignore filters, user story parser, static SaaS guards).
- **Adversarial Dogfooding**: Run sweeper sweeps against newly authored components.
