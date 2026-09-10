# Product & CLI Manual — Incubator v5

**Status**: Living  
**Target Audience**: Operators, Developers, and AI Agents  
**Last Updated**: 2026-09-08

---

## 1. Quickstart

Incubator v5 tools live inside your agent's `harness/components/`.

---

## 2. Project Board CLI (`components/board/tools/board.mjs`)

The project board tracks individual executable tasks grouped by architectural design doc / stage.

### Common Invocations

```bash
# Add a task linked to a design doc in a specific project
node harness/components/board/tools/board.mjs add "Visual section inspector viewer" \
  --doc page-structure --track ux --mode runner --project incubator-v5

# Add a quick task (unassigned to a design doc)
node harness/components/board/tools/board.mjs add "Fix authentication timeout in dev server" --project incubator-v5

# List all tasks for a project
node harness/components/board/tools/board.mjs list --project incubator-v5

# Filter tasks by status, execution mode, or track
node harness/components/board/tools/board.mjs list --mode runner
node harness/components/board/tools/board.mjs list --status in-progress

# Update task status or mode
node harness/components/board/tools/board.mjs set 3 --status in-progress
node harness/components/board/tools/board.mjs set 3 --status done
node harness/components/board/tools/board.mjs set 3 --mode runner

# Mark a design document as Finished or Reopen it
node harness/components/board/tools/board.mjs finish-doc falcon-manager-board-roster --project incubator-v5
node harness/components/board/tools/board.mjs reopen-doc falcon-manager-board-roster --project incubator-v5

# Delete a task
node harness/components/board/tools/board.mjs rm 3
```

### Options Reference
- `--project <name>`: Target project name (resolves to `boards/<name>.sqlite` and `workspaces/<name>/docs/design/`).
- `--db <path>`: Path to project SQLite board (defaults to `boards/project.sqlite` or derived from `--project`).
- `--doc <slug>`: Links task to `workspaces/<project>/docs/design/<slug>.md`.
- `--track <name>`: Layer track (`core`, `engine`, `harness`, `sweeper`, `feature`, `bug`, `frontend`, `backend`, `api`, `ux`, `db`, `infra`, `docs`, `test`, `perf`).
- `--mode <mode>`: `pair` (local interactive) or `runner` (autonomous background execution).
- `--status <status>`: `planned`, `in-progress`, `review`, `done`, `blocked`.
- `--json`: Output raw JSON instead of formatted ANSI table.

---

## 3. Web Dashboard Server (`components/board/tools/serve.mjs`)

Launch the real-time board observatory and fleet web dashboard:

```bash
# Start dashboard on port 3333 pointing to local board
node harness/components/board/tools/serve.mjs --port 3333 --db boards/project.sqlite

# Start multi-agent host on Falcon Manager with roster
node harness/components/board/tools/serve.mjs --port 3333 --roster config/roster.json --token sec_manager_key
```

### Available Dashboard Views
- `http://localhost:3333/#swimlanes` — Visual Roadmap Swimlanes for active design docs.
- `http://localhost:3333/#kanban` — Multi-column workflow Kanban with doc & track dropdowns.
- `http://localhost:3333/#fleet` — Real-time distributed multi-agent fleet topology.
- `http://localhost:3333/#docs` — 3-Tier Design Docs catalog with Active/Finished lifecycle filters.

---

## 4. Local Agent Board Sync (`components/board/tools/sync.mjs`)

Sync local tasks and design docs to a central Falcon Manager dashboard:

```bash
node harness/components/board/tools/sync.mjs \
  --server https://falcon.internal:3333 \
  --token sec_agent_token \
  --db boards/project.sqlite \
  --docs workspaces/incubator-v5-docs/design
```


---

## 5. Persistent Brain Engine (`harness/engine/brain.mjs`)

Manage persistent memory, task cards, and durable session state.

```bash
# List active memory cards
node harness/engine/brain.mjs list

# Create a new note
node harness/engine/brain.mjs new --entity note --slug <slug> --description "<text>"

# Write / update card body
echo "Detailed memory notes..." | node harness/engine/brain.mjs body <slug>

# Retrieve a card
node harness/engine/brain.mjs get <slug>

# Search memory
node harness/engine/brain.mjs search "<query>"
```

---

## 6. Documentation Scaffolder (`components/docs/tools/scaffold.mjs`)

Provision a clean 3-tier documentation repository for any workspace.

```bash
# Provision docs
node harness/components/docs/tools/scaffold.mjs workspaces/<new-project>-docs --name "Project Name"

# Validate 3-tier structure and link health
node harness/components/docs/tools/validate.mjs workspaces/<project>-docs
```

---

## 7. Harness Installer (`components/harness/tools/install.mjs`)

Install or upgrade the Incubator v5 harness in any agent home:

```bash
node components/harness/tools/install.mjs <target-agent-home> [--init-cards]
```

---

## 8. Fleet Management CLI (`components/board/tools/fleet.mjs`)

Administer the distributed agent fleet, provision seats, and manage access credentials.

```bash
# List all registered agents and health metrics (local or remote)
node harness/components/board/tools/fleet.mjs list
node harness/components/board/tools/fleet.mjs list --url http://central-server:3333 --token <operator-token>

# Fleet aggregated status
node harness/components/board/tools/fleet.mjs status

# Register a new agent seat manually
node harness/components/board/tools/fleet.mjs add example-pa \
  --name "Example PA" \
  --icon "🦅" \
  --tags "architect,design"

# Fully automated agent seat provisioning (creates directory, deploys harness, injects falcon.env)
node harness/components/board/tools/fleet.mjs provision example-pa \
  --target /path/to/example-pa \
  --server-url http://central-server:3333 \
  --name "Example PA" \
  --icon "🦅"

# Rotate an agent's secret Bearer token
node harness/components/board/tools/fleet.mjs token example-pa --rotate

# Allocate a new workspace project to an agent
node harness/components/board/tools/fleet.mjs project add example-pa telemetry-svc --name "Telemetry Service"

# Verify agent board database and health
node harness/components/board/tools/fleet.mjs verify example-pa

# Decommission/revoke an agent seat
node harness/components/board/tools/fleet.mjs remove example-pa
```

---

## 9. Live Backup Utility (`components/board/tools/backup.mjs`)

Perform online, non-blocking atomic snapshots of all active fleet SQLite databases and roster configuration using SQLite's native `VACUUM INTO`:

```bash
# Backup all databases and roster to backups/ directory
node harness/components/board/tools/backup.mjs --out backups/

# Custom boards directory and roster path with JSON output
node harness/components/board/tools/backup.mjs \
  --boards-dir /data/boards \
  --roster /data/config/roster.json \
  --out /data/backups \
  --json
```

