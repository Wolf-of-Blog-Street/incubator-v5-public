# Design Specs & Epics Index

This directory contains **living, evergreen architectural blueprints** for Incubator v5.
Each blueprint governs a major core subsystem or component. Whenever a task or bug touches that subsystem, it attaches to the corresponding blueprint so agents load the required context first.

---

## Active Living Blueprints

| Codename | Blueprint / Component | Status | Target Component | Description |
| :--- | :--- | :--- | :--- | :--- |
| **#d-1** | [`board`](board.md) | Open & Inactive (100%) | `board`, `board/ui`, `components/board` | Project Board, Kanban UI & Pair Programming Workflow |
| **#d-2** | [`fleet`](fleet.md) | Open & Inactive (100%) | `fleet`, `harness`, `config/roster.json` | Fleet Roster, Multi-Seat Agent Provisioning & Workspace Harness |
| **#d-3** | [`sub-agents`](sub-agents.md) | Open & Inactive (100%) | `friends`, `auth`, `tools/friend.mjs` | Secondary Model Dispatch (Claude/Codex) & Zero-Interference Account Pools |
| **#d-4** | [`sweeper`](sweeper.md) | Open & Inactive (100%) | `sweeper`, `tools/sweep.mjs` | Automated 3-Wave Bug Sweeper & Intent-Driven User Story Audits |
| **#d-5** | [`testing`](testing.md) | Open & Inactive (100%) | `tools/test.mjs`, `tools/release.mjs` | Google-Style 3-Tier Quality Architecture & Safe Releases |
| **#d-6** | [`refactor`](refactor.md) | Open & Inactive (100%) | `components/board`, `components/board/ui`, `components/board/api` | Codebase Architecture, Modular Decomposition & Clean Scaling |
| **#d-7** | [`projects`](projects.md) | Open & Inactive (100%) | `board/ui`, `board/api`, `config/projects.json`, `tools/fleet.mjs` | GitHub Projects Directory & Live Agent Checkout Inventory |

---

## Templates & Archives

- **Template**: [`templates/epic.template.md`](templates/epic.template.md) — The standard Google-style design doc blueprint.
- **Historical Archive**: [`archive/`](archive/) — Superseded stage documents and historical migration specifications.
