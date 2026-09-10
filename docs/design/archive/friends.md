# Friends — Multi-Model Sub-Agent & Secondary CLI Dispatch Engine

- **Status**: Finished
- **Author**: manager-pm (Fleet Manager & Pair Programmer)
- **Target Component(s)**: `components/friends`, `components/board`, `components/harness`
- **Codename**: #d-4
- **Color**: #f59e0b
- **Last Updated**: 2026-09-08

---

## 1. Context & Problem Statement

In an agentic ecosystem, a primary agent seat (e.g. `manager-pm`, `example-pa`, or an autonomous background runner) frequently encounters tasks requiring specialized external capabilities:
1. **Alternative Perspectives & Tough Bug Solving**: Invoking a distinct model architecture (e.g., Claude Code `claude`, Codex `codex`, Kimi, Aider) to analyze tricky race conditions or review complex pull requests.
2. **Deep Creative & Architectural Design**: Leveraging heavy frontier models (e.g., `sol` or `astra-ultra` on Codex) to draft exploratory designs, generate prototypes, or produce formal specifications.
3. **Safe Change Isolation**: Direct unconstrained execution in the agent's active folder risks polluting the working directory, corrupting uncommitted files, or creating merge conflicts.

The **Friends** component provides a structured, lightweight dispatch engine that invokes secondary CLI tools within the agent's folder while strictly constraining their modifications to an **isolated child revision in Jujutsu (`jj new`)**.

---

## 2. Goals & Explicit Non-Goals

### Goals
- [ ] **Multi-Provider Catalog**: Support pluggable definitions for popular AI CLI tools (`claude`, `codex`, `kimi`, `opencode`, custom scripts) with configurable model and effort parameters.
- [ ] **Automated Jujutsu Isolation**: Every friend dispatch automatically branches a dedicated child revision (`jj new -m "friend(<name>): <prompt summary>"`) before execution, preserving working copy hygiene and enabling instant review, rebase, or discard.
- [ ] **Unified Friends CLI (`friend.mjs`)**: Provide intuitive commands for listing providers, running tasks, streaming stdout/stderr, and outputting JSON telemetry.
- [ ] **Programmatic API & MCP Bridge**: Enable other agents to dispatch friends programmatically via Node.js ESM engine imports and MCP tool calls.
- [ ] **Zero External Dependencies**: Implemented strictly using Node.js 22 ESM built-in modules (`node:child_process`, `node:fs`, `node:path`).

### Non-Goals
- **Replacing Primary Agent Seats**: Friends are on-demand task-oriented tools, not persistent stateful agents with long-term memory.
- **Complex Distributed Orchestration**: Friend processes run locally in the agent's target folder; distributed worker clustering is handled by the Fleet manager.

---

## 3. Architecture & Data Contracts

### 3.1 Friend Provider Schema
Providers are configured in `components/friends/engine/friends.mjs` (with optional overrides from `config/friends.json`):

```json
{
  "claude": {
    "binary": "claude",
    "displayName": "Claude Code",
    "promptFlag": "-p",
    "modelFlag": "--model",
    "effortFlag": "--effort",
    "defaultModel": "sonnet",
    "defaultEffort": "high",
    "flags": ["--dangerously-skip-permissions"],
    "supportsNonInteractive": true
  },
  "codex": {
    "binary": "codex",
    "displayName": "Codex CLI",
    "promptFlag": "-p",
    "modelFlag": "--model",
    "defaultModel": "gpt-5-codex",
    "flags": [],
    "supportsNonInteractive": true
  }
}
```

### 3.2 CLI Interface (`friend.mjs`)
```bash
# List available friend engines
node harness/components/friends/tools/friend.mjs list

# Run a friend in an isolated jj change
node harness/components/friends/tools/friend.mjs run claude "Investigate sqlite concurrency deadlock"

# Run with specific model and effort override
node harness/components/friends/tools/friend.mjs run codex "Design vector indexing schema" --model sol --effort ultra

# Run without jj isolation (direct working copy edit)
node harness/components/friends/tools/friend.mjs run claude "Fix typo in README" --no-jj
```

### 3.3 Execution Lifecycle
```
[Primary Agent] ──> friend.mjs run <name> "<prompt>"
                         │
                         ├── 1. Validate Provider & Binary Check
                         ├── 2. Create Child Revision: `jj new -m "friend(<name>): <prompt>"`
                         ├── 3. Spawn Subprocess (claude/codex) with streaming telemetry
                         ├── 4. Capture Output, Duration & Exit Code
                         └── 5. Output Summary: Resulting Commit ID & Modified Files (`jj diff --stat`)
```

---

## 4. Implementation Milestones & Task Breakdown

- [ ] **Milestone 1: Friend Roster & Provider Catalog Engine** (`components/friends/engine/friends.mjs`)
  - [ ] Task 1.1: Implement provider registry (`claude`, `codex`, `kimi`, `opencode`) with argument synthesis.
  - [ ] Task 1.2: Add binary healthcheck and capability detection.
  - [ ] Task 1.3: Write unit tests for provider resolution and model/effort flags.

- [ ] **Milestone 2: Jujutsu Revision Isolation & Execution Sandbox** (`components/friends/engine/friends.mjs`)
  - [ ] Task 2.1: Implement `withJjIsolation(cwd, options, fn)` to manage `jj new` lifecycle.
  - [ ] Task 2.2: Add non-blocking streaming process runner with timeout and signal handling.
  - [ ] Task 2.3: Write integration tests verifying working copy isolation and rollback on failure.

- [ ] **Milestone 3: Unified Friends CLI (`friend.mjs`)** (`components/friends/tools/friend.mjs`)
  - [ ] Task 3.1: Build `friend list`, `friend run`, and `friend check` subcommands.
  - [ ] Task 3.2: Implement formatted ANSI progress output and machine-readable `--json` format.
  - [ ] Task 3.3: Write CLI integration test suite.

- [ ] **Milestone 4: Board & Harness Integration, MCP Bridge & Living Docs**
  - [ ] Task 4.1: Integrate `components/friends` into `install.mjs` for automated fleet distribution.
  - [ ] Task 4.2: Expose `dispatch_friend` and `list_friends` in MCP tools.
  - [ ] Task 4.3: Update living documentation in `docs/system/ARCHITECTURE.md` and `docs/system/MANUAL.md`.
