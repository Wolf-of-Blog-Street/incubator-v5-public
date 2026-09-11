# Agent Harness Manual — Incubator v5

Welcome to your **Incubator v5 Agent Harness**.

This document is your master operating manual. It teaches you how your workspace is structured, how to use your brain, how to track work on the project board, how to dispatch secondary model Friends, and how to execute multi-wave bug sweeps.

---

## 1. How We Work & Session Start Protocol

### How We Work
1. **Pair Programming by Default**: We work directly with the operator locally. We author design blueprints, write and refactor code, run tests, and debug together in real-time.
2. **No Bureaucracy**: No artificial non-coding barriers, no legalistic negative rules, and no multi-tier handoff bottlenecks. If a task needs doing, we design it, code it, test it, and land it.

### Session Start Protocol & Sequence of Work
When starting any session or receiving ANY user request:
1. **Check the Board & Design Docs**: Inspect the project board (`node harness/components/board/tools/board.mjs list` or SQLite in `boards/`) to see active jobs, and check `docs/design/INDEX.md` for active proposals. For non-trivial features, consult or author a design proposal; for obvious work, use standalone jobs.
2. **Check Active Memory**: Check your brain (`node harness/engine/brain.mjs list` and `brain/__source/working-memory.md`) to recall active state.
3. **Read Master Harness & Preferences**: Read [harness/HARNESS.md](HARNESS.md) and [harness/HARNESS-custom.md](HARNESS-custom.md) for tool usage, testing contracts, and custom preferences.

---

## 2. Custom Notes & Overrides
👉 **First**: Read [harness/HARNESS-custom.md](HARNESS-custom.md) for custom operator preferences and seat-specific rules.

---

## 3. Agent Directory Topology

Your agent home is organized into three distinct zones:

```
<agent-home>/
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
│   ├── HARNESS.md                     # This master manual
│   ├── HARNESS-custom.md              # Your custom notes (preserved across upgrades)
│   ├── engine/                        # Core engines (brain.mjs, etc.)
│   └── components/                    # Installed tools, skills and template libraries
│       ├── board/                     # Board component (CLI, REST API & web UI)
│       ├── brain/skills/              # Brain skills (brain-self-kickoff, etc.)
│       ├── docs/                      # Docs component & template bundle
│       ├── friends/                   # Multi-Model Friends Engine (Claude, Codex)
│       └── sweeper/                   # 3-Wave & Deep Multi-Model Bug Sweeper
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

## 4. The Project Board (`boards/<project>.sqlite`)

The project board tracks individual executable **tasks** (work items) that roll up to high-level **design docs / stages**.

### Key Rules
- **Only Real Projects in `workspaces/` Have Boards**: Every project in `workspaces/<project>/` has its own dedicated board at `boards/<project>.sqlite`.
- **`projects/` are NOT Managed by the Board**: Folders in `projects/` are small, fast, local-only scripts and experiments; they do not have boards.
- **GitHub is NOT Required**: Projects in `workspaces/<project>/` do NOT need a GitHub remote — some will have remotes, some are purely local Jujutsu (`jj`) working copies / repositories.
- **Docs are Part of the Project**: Documentation lives inside `workspaces/<project>/docs/`. There are **NO separate boards for docs**.
- **Multi-Project Workflows**: When working across projects, pass `--project <project-name>` to the board CLI (or `--db boards/<project>.sqlite`).

### Common Board Commands
```bash
# Add a task linked to a design stage (targeting a specific project)
node harness/components/board/tools/board.mjs add "Visual section inspector viewer" \
  --doc page-structure --track ux --project incubator-v5

# Sync design doc checklist to board items (auto-scaffolding milestones)
node harness/components/board/tools/board.mjs sync-doc <slug> --project incubator-v5

# List tasks for current or specified project
node harness/components/board/tools/board.mjs list --project incubator-v5

# Update status
node harness/components/board/tools/board.mjs set <id> --status in-progress
node harness/components/board/tools/board.mjs set <id> --status done
```

### Planning Mode & The Atomic Design-to-Board Invariant
When designing new features, architectures, or non-trivial tasks:
1. **Atomic Design & Board Sync Standard**: Creating or modifying a design doc and scaffolding its task cards onto the Falcon Board is a **SINGLE ATOMIC TRANSACTION**. An agent must **NEVER** write a design doc on disk without immediately running `node harness/components/board/tools/board.mjs sync-doc <slug> --project <project>` in the exact same turn. Authoring a `.md` doc without immediately populating its task cards on the board is a **HARNESS PROTOCOL FAILURE**.
2. **Planning Mode Precedence**: IDE Planning Mode restrictions ("stop and wait for user review") apply strictly to executing *code modifications in components/source*. Writing `docs/design/<slug>.md`, updating `INDEX.md`, and running `board.mjs sync-doc` ARE the required deliverables of planning. Always execute the atomic doc + board sync before pausing for operator review.
3. **Attach Plan to the Board**: Simultaneously attach the implementation plan and verification checklist directly to the board task's `--details` field:
   ```bash
   node harness/components/board/tools/board.mjs set <id> --details "<markdown-plan>"
   ```
This guarantees plans are visible both in the active pair-programming IDE session and persistently stored on the project board and web viewer.

### Multi-Agent Fleet Environment (`harness/falcon.env`)
If your agent seat was provisioned as part of a multi-agent fleet managed by a central Falcon Board Server, your seat will contain a `harness/falcon.env` file:
```bash
FALCON_BOARD_URL=http://<host>:<port>
FALCON_BOARD_TOKEN=agt_live_<agent-id>_<secret>
FALCON_AGENT_ID=<agent-id>
```
The Board CLI and MCP server transparently load this configuration if present. You interact with `board.mjs` identically, while all task mutations and design document states synchronize securely to the central board with strict tenant isolation. If `harness/falcon.env` is absent, the board automatically falls back to local SQLite storage at `boards/project.sqlite`.

---

## 5. Using Your Brain (`brain/`)

Your brain is your persistent memory store (`node harness/engine/brain.mjs`). It keeps track of durable knowledge across sessions.

```bash
# List active memory notes
node harness/engine/brain.mjs list

# Create a new memory note
node harness/engine/brain.mjs new --entity note --slug <slug> --description "<description>"

# End-of-session handoff
# Run the brain-self-kickoff skill when concluding a session.
```

---

## 6. Work Zones: `projects/` vs. `workspaces/` vs. `harness/`

| Zone | Purpose | Board Tracking | Version Control | Structure |
| :--- | :--- | :--- | :--- | :--- |
| **`projects/`** | **Local-Only Work** | **No Board** (Small, fast, lightweight) | Local Jujutsu (`jj`, no remote) | Scratch scripts, one-off tools, rapid prototypes. Has `projects/<name>/src/` and `projects/<name>/docs/`. |
| **`workspaces/`** | **Real Managed Projects & Source of Truth** | **Dedicated Board** (`boards/<project>.sqlite`) | Local Jujutsu (`jj`, GitHub remote optional) | Real production codebases. **All platform development for Incubator v5 happens inside `workspaces/incubator-v5/`.** |
| **`harness/`** | **Deployed Runtime Environment** | Managed by Installer (`install.mjs`) | Deployed seat runtime | Installed tools, engines, and manuals. **NEVER edit files inside `harness/` directly!** |

### Platform Development & Dogfooding Invariant
When developing, fixing, or extending Incubator v5 itself:
1. **Work in `workspaces/incubator-v5/` FIRST**: All code, documentation, engine components, and harness templates (`components/harness/templates/`) MUST be developed, tested, and recorded in Jujutsu (`jj describe`) inside `workspaces/incubator-v5/`.
2. **Never Edit Deployed Seat Files Directly**: Directly editing files in your seat home (`harness/`, `AGENTS.md`, `CLAUDE.md`) is a fatal failure mode. It bypasses the product repository, starves other fleet seats of updates, will be wiped out on the next harness install, and causes Incubator v5 to die.
3. **Dogfood via `install.mjs`**: Once changes are verified and recorded in Jujutsu inside `workspaces/incubator-v5/`, dogfood the update into your own seat (and target fleet seats) by running:
   ```bash
   node workspaces/incubator-v5/components/harness/tools/install.mjs <target-seat-path>
4. **Role of Entrypoint Cards (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)**: Entrypoint cards establish the non-negotiable **Mandatory Bootstrap Protocol** that every incoming agent must execute before taking action (checking the board, locating the governing design blueprint in `docs/design/INDEX.md`, inspecting working memory, and loading the harness). Comprehensive operational teachings, tool references, and architecture details live here in `HARNESS.md`.

---

## 7. The 3-Tier Documentation System

All major repositories in `workspaces/<project>/` maintain their documentation in **`<project>/docs/`**:

1. **`system/` (Living Truth)**: How the system works and how to run it (`ARCHITECTURE.md` for schemas/subsystems, `MANUAL.md` for CLI workflows/flags).
2. **`design/` (Transitional Blueprints)**: Architectural specs for active stages and features (`draft` → `in-progress` → `done` → `archive/`).
3. **`support/` (Living Truth)**: Operational runbooks, health checks, and troubleshooting guides (`RUNBOOK.md`).

### Index Invariant
Every tier directory (`system/`, `design/`, `support/`) **must contain an `INDEX.md`** table cataloging every file and its status.

### Living Docs (`docs/system/`)
`docs/system/` contains the enduring truth of the repository:
- `ARCHITECTURE.md`: Current as-built subsystem architectures, lifecycle models, schemas, and invariants.
- `MANUAL.md`: Operator and developer workflows, CLI commands, and flags.

Design docs in `docs/design/` are transitional proposals. They cite `docs/system/` for context without duplicating it. When work lands, any enduring updates to system truth are folded into `docs/system/` in the same change.

---

## 8. Workflow: Design Doc Lifecycle & Jobs

### 8.1 Lifecycle
A design doc is a transitional proposal for non-obvious work that closes itself when completed:

```
Open & Active    tasks exist and at least one is not Done
Open & Inactive  a doc with zero tasks (just authored, or all tasks deleted)
Closed           tasks exist and all are Done          <- set by the board engine, not by hand
```

When the last job attached to a design doc is marked Done:
- The board engine automatically marks the doc `Closed`.
- Moves the markdown file to `docs/design/archive/<slug>.md`.
- Rewrites `docs/design/INDEX.md` so active tables only list work in flight.
- If a task is reopened or added later, the doc automatically unarchives back to `Open & Active`.

### 8.2 The Procedure, End to End
```
1. Read docs/system/ for the area.           (context, cite it, do not copy it)
2. Write docs/design/<slug>.md from template; register in docs/design/INDEX.md.
3. board sync-doc <slug>  -> one job per milestone; Milestone 1 to In-Review; operator reviews & approves.
4. Work the milestones:   plan and code in whatever chunking makes sense.
5. Living docs milestone: update docs/system/ in the same change.
6. Verification milestone: npm test green, new tests, Chrome check for UI.
7. Land milestone:         describe change (jj describe), advance main bookmark (jj bookmark set main -r @), push (jj git push), dogfood harness.
   Marking it Done closes the doc: Status -> Closed, file moved to docs/design/archive/,
   INDEX.md row moved to the archive table. Nothing for the operator to do.
```

### 8.3 Google-Style Design Philosophy
A design doc follows Google's engineering culture (Ubl, *Design Docs at Google*; *Software Engineering at Google* ch. 10):
- **A design doc is informal**: The template is an outline, not a form. Use the sections that help and drop the ones that do not.
- **It says what and why, and weighs trade-offs**: Context and scope, goals and non-goals, design, alternatives considered, anything cross-cutting like security or data. Sketches of APIs and data, not full definitions. No pseudo-code, no step lists. If it starts to read like an implementation manual, stop.
- **It is updated while work lands**: Reality corrects the proposal. When the last job is done, it closes and stays in the archive as the record of why.
- **Do not write one for obvious work**: Obvious work, small tweaks, and bug fixes use a standalone job or direct code. Work is work.
- **The doc owns the shape; the worker owns the build**: Plan and code in whatever order and size works.

### 8.4 Job Vocabulary
- A card on the board is a **job** (or task).
- A card without a governing design doc is a **standalone job**.

### 8.5 Interactive Verification with Chrome
Work on UX, frontend, web viewer, and UI flows with Chrome to check as you create:
- **Live Chrome Inspection**: Launch and inspect the interface in Chrome (using DevTools or browser subagents) continuously as you create, style, and structure elements.
- **Interactive Verification**: Actively exercise interactive flows (clicking buttons, switching tabs/views, modal/dropdown states, live data reloads) in the browser before marking any UX task complete.
- **Visual Integrity & Polish**: Confirm layouts, spacing, color contrasts, typography, and responsive resizing visually in the live browser rather than assuming static correctness.

---

## 9. Friends Engine (`components/friends`)

The **Friends Engine** orchestrates external CLI engines (Claude Code, OpenAI Codex, Kimi) to perform sub-agent delegation, secondary code reviews, and adversarial audits inside isolated Jujutsu child revisions.

### Supported Friends & Models
- **Claude (`claude`)**: Anthropic Claude Code CLI (`claude-fable-5-1`, `claude-opus-4-8`).
- **Codex (`codex`)**: OpenAI Codex CLI (`gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.5`).

### Key Capabilities
1. **Isolated Jujutsu Child Revisions (`jj new`)**: Dispatches run in an isolated working copy without dirtying the parent agent's workspace.
2. **Credential Multi-Tenant Sandbox**: Injects OAuth tokens and provider configurations dynamically from `~/.config/incubator/max-tokens.env` or local auth pools.
3. **Non-Interactive & CLI Execution**:
   ```bash
   # List available friends and active accounts
   node harness/components/friends/tools/friend.mjs catalog
   node harness/components/friends/tools/friend.mjs accounts list

   # Dispatch a prompt to a Friend
   node harness/components/friends/tools/friend.mjs dispatch claude "Review API error handling in routes/docs.mjs"
   node harness/components/friends/tools/friend.mjs dispatch codex "Implement constant-time timingSafeEqual helper" --model gpt-6-astra
   ```

---

## 10. Bug Sweeper (`components/sweeper`)

The **Bug Sweeper** is Incubator v5's autonomous quality & invariant assurance engine. It supports both high-throughput Gemini-powered sweeps and deep multi-model audits.

### 10.1 Standard 3-Wave Gemini Sweep
1. **Wave 1 (Breadth & Story Walkthrough)**: High-throughput mental walkthrough matching specs to code via `gemini-3.6-flash`.
2. **Wave 2 (Depth & Operational Reality)**: Invariant auditing, state machine race conditions, and silent data corruption via `gemini-3.8-flash`.
3. **Wave 3 (Dynamic Adversarial Tests)**: Synthesizes and executes real Node.js test scripts (`node:test`) to dynamically verify bugs.
4. **Judge / Gavel**: Adjudicates all candidate findings against dynamic execution proofs, discards speculative trivia, and stamps verified bugs via `gemini-3.8-flash`.

```bash
# Run standard 3-wave sweep over target component
node harness/components/sweeper/tools/sweep.mjs --target workspaces/incubator-v5/components/board --spec workspaces/incubator-v5/docs/design/board.md
```

### 10.2 Multi-Model Deep Sweeper (`--deep`)
When the **`--deep`** flag is passed, the sweeper escalates into a multi-model heterogeneous audit pipeline:
1. **Gemini Fast Baseline**: Generates scope, story context, and initial operational reality scans.
2. **Claude Fable 5.1 (`claude-fable-5-1`)**: Analyzes real-world workflow consistency, edge cases, and ergonomic failure scenarios.
3. **Codex Astra High (`gpt-6-astra`)**: Deep reasoning sweep focused strictly on security holes, tenant boundary breaches, data loss, and storage invariant violations.
4. **Sane Judge**: Cross-model synthesis, dynamic test execution, and final unified verdict in `.runs/<sweep-id>/deep-summary.md`.

```bash
# Run deep multi-model sweep (Gemini + Fable 5.1 + Astra High)
node harness/components/sweeper/tools/sweep.mjs --target workspaces/incubator-v5/components/board --spec workspaces/incubator-v5/docs/design/board.md --deep

# Optional controls
node harness/components/sweeper/tools/sweep.mjs --target <target> --deep --effort high --security
```

---

## 11. Standard Jujutsu (JJ) Workflow

For all workspace repositories, follow the **Feature Change + Fast-Forward Main** standard:

```bash
# 1. Start a focused change off main with a descriptive change summary
jj new main -m "feat(area): short description"

# 2. Develop and test in the working copy
npm test

# 3. Advance / fast-forward main bookmark to the verified change revision
jj bookmark set main -r @

# 4. Open a clean next working copy for subsequent work
jj new
```

**Why this standard**:
- Keeps a clean, bisectable, linear history without redundant merge bubbles, while tracking revisions cleanly in Jujutsu.
- Preserves full Jujutsu change isolation, revision tracking, and `jj undo` safety during development.
