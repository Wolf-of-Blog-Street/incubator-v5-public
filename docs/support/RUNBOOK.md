# Operational Runbook — Incubator v5

**Status**: Living  
**Target Audience**: Operators & SRE  
**Last Updated**: 2026-09-08

---

## 1. Routine Maintenance & Operations

### 1.1 Running the Central Board & Dashboard
```bash
# Start the local board observatory UI
node harness/components/board/tools/serve.mjs --port 3333 --db boards/project.sqlite

# Start multi-agent host on Falcon Manager with auth & roster
node harness/components/board/tools/serve.mjs \
  --port 3333 \
  --roster config/roster.json \
  --token sec_manager_key
```

### 1.2 Health Checking & Diagnostics
```bash
# Check board HTTP health and database connection
curl -s http://localhost:3333/api/v1/health | jq .

# Verify fleet topology
curl -s http://localhost:3333/api/v1/fleet | jq .
```

---

## 2. Common Incident Recovery

### 2.1 Restarting Stale Dashboard Service
```bash
# Locate process by port
lsof -ti:3333 | xargs kill -9 2>/dev/null || true

# Relaunch dashboard daemon
node harness/components/board/tools/serve.mjs --port 3333 --db boards/project.sqlite &
```

### 2.2 Re-syncing Local Agent State
If an agent's board state is out of sync with Falcon Manager:
```bash
node harness/components/board/tools/sync.mjs \
  --server https://falcon.internal:3333 \
  --token sec_agent_token \
  --db boards/project.sqlite \
  --docs workspaces/incubator-v5-docs/design
```

---

## 3. Production Deployment Runbook

### 3.1 Running via Docker Compose
```bash
# Build and start container stack with persistent volumes
docker compose -f deploy/docker-compose.yml up -d --build

# View container logs
docker compose -f deploy/docker-compose.yml logs -f

# Check container healthcheck status
docker inspect --format='{{json .State.Health.Status}}' falcon-board-server
```

### 3.2 Running via Systemd (Linux Hosts)
```bash
# 1. Install service unit
sudo cp deploy/systemd/falcon-board.service /etc/systemd/system/
sudo systemctl daemon-reload

# 2. Enable and start service
sudo systemctl enable --now falcon-board

# 3. Inspect logs and status
sudo systemctl status falcon-board
sudo journalctl -u falcon-board -f
```

### 3.3 Upgrading the running server and the fleet (as deployed on `falcon-manager`)

The production board on `falcon-manager` runs as a **user** unit (`systemctl --user`, `Linger=yes` for user `falcon`), not the system unit in 3.2. It executes `/home/falcon/incubator-v5/components/board/tools/serve.mjs` directly, so the remote `harness/` directory is unused. Its data is `config/roster.json` (the authoritative roster) and `boards/*.sqlite`. Both are outside every path below.

Release first, then deploy:

```bash
# 1. Cut the release in the product repo
#    bump package.json, npm test, jj bookmark set main -r @, git tag -a vX.Y.Z, jj git push --bookmark main, git push origin vX.Y.Z

# 2. Snapshot the remote boards and roster
ssh falcon-manager 'cd /home/falcon/incubator-v5 && node components/board/tools/backup.mjs --boards-dir boards --roster config/roster.json --out /home/falcon/backups/pre-vX.Y.Z'

# 3. Sync code only (dry-run with -n first and read every "deleting" line)
rsync -a --delete --exclude node_modules --exclude .runs --exclude '*.sqlite*' components/ falcon-manager:/home/falcon/incubator-v5/components/
rsync -a --delete tools/        falcon-manager:/home/falcon/incubator-v5/tools/
rsync -a package.json           falcon-manager:/home/falcon/incubator-v5/package.json
rsync -a --delete docs/system/  falcon-manager:/home/falcon/incubator-v5/docs/system/
rsync -a --delete docs/support/ falcon-manager:/home/falcon/incubator-v5/docs/support/

# 4. Restart and check: health must report the new version
ssh falcon-manager 'systemctl --user restart falcon-board && sleep 3 && curl -sf http://localhost:3333/api/v1/health'

# 5. Upgrade seats, one at a time, from the product repo
tar czf <backup-dir>/<seat>-harness.tgz -C <seat> harness
node components/harness/tools/install.mjs <seat> [--upgrade-cards]
node harness/components/board/tools/fleet.mjs list     # every seat shows [vX.Y.Z]
```

`--delete` is scoped to `components/` and `tools/`; `config/`, `boards/`, `backups/` and logs are never in scope. Pass `--upgrade-cards` only when the seat's three entry cards are the stock template and not operator edits. Do not use `fleet provision --force` to upgrade: it rotates the token and rewrites `falcon.env`.

Rollback: for a seat, `rm -rf harness && tar xzf <backup>`; for the server, rsync the previous tag's checkout the same way and restart. Boards are untouched either way.

---

## 4. Live Backups & Disaster Recovery

### 4.1 Scheduled Live Backup
```bash
# Run non-blocking atomic backup using SQLite VACUUM INTO
node harness/components/board/tools/backup.mjs \
  --boards-dir /data/boards \
  --roster /data/config/roster.json \
  --out /data/backups

# Add to crontab for hourly snapshots:
# 0 * * * * cd /opt/incubator-v5 && node harness/components/board/tools/backup.mjs --out /data/backups >> /var/log/falcon-backup.log 2>&1
```

### 4.2 Disaster Recovery / Snapshot Restore
```bash
# 1. Stop board server service
sudo systemctl stop falcon-board
# or: docker compose -f deploy/docker-compose.yml stop

# 2. Restore databases and roster from chosen snapshot directory
RESTORE_SNAP=/data/backups/snapshot-2026-09-08T20-00-00-000Z
cp $RESTORE_SNAP/*.sqlite /data/boards/
cp $RESTORE_SNAP/roster.json /data/config/roster.json

# 3. Restart board server
sudo systemctl start falcon-board
```

---

## 5. Automated Seat Provisioning & Credential Management

### 5.1 Provisioning a New Agent Seat
```bash
# Provision new agent seat 'worker-1'
node harness/components/board/tools/fleet.mjs provision worker-1 \
  --target /var/agents/worker-1 \
  --server-url http://central-board:3333 \
  --name "Worker 1" \
  --tags "pipeline,runner"

# Verify that the new seat communicates with the central board
cd /var/agents/worker-1
node harness/components/board/tools/board.mjs list
```

### 5.2 Emergency Credential Rotation
If an agent's secret Bearer token is leaked or compromised:
```bash
# 1. Rotate token on the central server (invalidates old token immediately)
node harness/components/board/tools/fleet.mjs token <agent-id> --rotate

# 2. Update the token in the agent's harness/falcon.env:
# FALCON_BOARD_TOKEN=<new_token>
```


