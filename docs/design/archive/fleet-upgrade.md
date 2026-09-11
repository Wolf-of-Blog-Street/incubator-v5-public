# Fleet Upgrade: Deploy Harness 5.3 to Every Seat Without Clobbering Them

- **Codename**: #d-10
- **Status**: Closed
- **Author**: Manager PM
- **Target Component(s)**: `components/harness/tools/install.mjs`, `components/board/tools/fleet.mjs`, `deploy/`, every seat under `~/agents/`, the board server on `falcon-manager`
- **Last Updated**: 2026-09-11 (rev 2: version stamping from #167)

---

## 1. Context & Scope

The product repo (`workspaces/incubator-v5`, main at `wosvxzvqpnvw`) is 27 changes ahead of what the fleet runs. Only the `manager-pm` seat has the current harness. The six worker seats run a manual from before the design-doc lifecycle (#d-8), the atomic doc-to-board sync rule, the jj teachings (#153), and the pair-programmer checklist. Their entry cards are the old two-line bootstrap. The board server on `falcon-manager` already runs the current engine code, but its `harness/` tree and git checkout are stale.

Every seat carries state the installer must not touch: the operator's brain, local SQLite boards, checked-out workspaces, seat credentials, and leftover v4 files that some seats still depend on. This doc records what is on each seat today, what the installer does and does not touch, and the order of operations for a deploy that leaves all of that intact. See `docs/system/MANUAL.md` §7 and §8 for the installer and fleet CLI, and `docs/support/RUNBOOK.md` §3 and §4 for the server and backups.

## 2. Goals & Explicit Non-Goals

**Goals**
- Every roster seat runs the harness built from repo main: `HARNESS.md`, `engine/brain.mjs`, and all six `harness/components/*` trees byte-identical to the repo.
- Every worker seat gets the current entry cards (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`).
- The board server on `falcon-manager` runs the same code as main, restarted cleanly, with a fresh backup taken first.
- Nothing seat-specific changes: `HARNESS-custom.md`, `harness/falcon.env`, `brain/`, `boards/`, `workspaces/`, `projects/`, `.mcp.json`, `install.json`, seat git and jj state, and the v4 leftovers listed in Appendix A.
- Every seat proves it still reaches the board after the upgrade.

**Non-Goals**
- No cleanup of v4 leftovers (`harness/tools`, `harness/hooks`, `harness/skills`, `harness/substrate.json`, `harness/harness.md`, `_legacy_v4/`). That is a separate task with its own per-seat list.
- No reconciliation of the remote git checkout. The remote tree has 345 dirty files and three local "friend execution" commits. Deploy by file sync, not by git.
- No roster or token changes. Tokens on every seat already match the remote roster.
- No changes to `agent-d-pm-evidence`. It has no harness and is not on the roster.

## 3. Alternatives Considered

1. **`fleet provision <id> --force` per seat.** Rotates the bearer token and rewrites `falcon.env` on every seat. That is the one thing we do not want. Discarded.
2. **Git pull on the remote, `git reset --hard origin/main`.** Loses the remote's three local commits and 345 uncommitted files, some of which may be sweeper output. Discarded for this deploy; a follow-up can reconcile.
3. **Installer per seat plus scoped rsync to the remote (chosen).** `install.mjs` is already written to preserve custom notes and never delete. rsync limited to code directories cannot reach `config/`, `boards/`, or `falcon.env`. Both steps are idempotent and reversible from the backups this doc requires.

## 4. Design

### 4.1 What the installer does, verified from `components/harness/tools/install.mjs`

| Path in seat | Behaviour |
| :--- | :--- |
| `harness/HARNESS.md` | Always overwritten from `components/harness/templates/HARNESS.md.template`. |
| `harness/HARNESS-custom.md` | Written only if missing. Never overwritten. |
| `harness/engine/brain.mjs` | Always overwritten. |
| `harness/components/{docs,brain,board,sweeper,friends,harness}` | Recursive copy. Same-named files overwritten. Extra files in the seat are left in place. |
| `brain/__source`, `boards/`, `projects/`, `workspaces/` | Created only if missing. Contents never read or written. |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | Untouched unless `--init-cards` (write missing only) or `--upgrade-cards` (overwrite all three). |
| `harness/falcon.env` | Written only when the API is called with an `env` object. The CLI never passes one. Untouched. |
| `harness/manifest.json` | Always rewritten (#167): `harness_version` from the source repo `package.json`, `source_revision` from the working-copy commit, `installed_at`, `seat` from `falcon.env`. |
| Remote roster `harness_version` | After writing the manifest the installer sends `PATCH /api/v1/admin/agents/<seat>` with the seat's own token from `falcon.env`. Failure is silent, so `fleet list` is the check. |
| Anything else (`harness/tools`, `harness/brain`, `.mcp.json`, `install.json`, seat git) | Not referenced. Untouched. |

Destination symlinks are removed before writing. Nothing is deleted. There is no dry-run. Verification is by checksum against the repo plus the manifest and the roster field, which must both read `5.3.0`.

Run it from the repo so it resolves sources from `components/`:

```bash
node ~/agents/manager-pm/workspaces/incubator-v5/components/harness/tools/install.mjs <seat> [--upgrade-cards]
```

### 4.2 Card upgrade guard

All six worker seats carry the same old card, md5 `35563c60dd1083d40ac24f0dcaa20005`, in all three files. It is the v5.0 two-line bootstrap, not an operator edit. Pass `--upgrade-cards` only when all three cards on that seat still have that hash. Any other hash means someone customised the card: leave it and report it.

### 4.3 Remote deploy

The server runs as a user unit (`systemctl --user`, `Linger=yes`) from `/home/falcon/incubator-v5/components/board/tools/serve.mjs`. It does not use `/home/falcon/incubator-v5/harness/`. Its data is `config/roster.json` (remote copy is authoritative; it has `client-x` for `agent-d-pm`, the local copy in `manager-pm/config/` does not) and `boards/*.sqlite` (gitignored, live WAL files present).

Sync only code, never data:

```bash
cd ~/agents/manager-pm/workspaces/incubator-v5
rsync -av --delete \
  --exclude node_modules --exclude .runs --exclude '*.sqlite*' \
  components/ falcon-manager:/home/falcon/incubator-v5/components/
rsync -av --delete tools/ falcon-manager:/home/falcon/incubator-v5/tools/
rsync -av package.json falcon-manager:/home/falcon/incubator-v5/package.json
rsync -av --delete docs/system/ falcon-manager:/home/falcon/incubator-v5/docs/system/
rsync -av --delete docs/support/ falcon-manager:/home/falcon/incubator-v5/docs/support/
ssh falcon-manager 'systemctl --user restart falcon-board && sleep 2 && curl -sf http://localhost:3333/api/v1/health'
```

`--delete` is scoped to `components/` and `tools/`, so stale test files from earlier releases go away and `config/`, `boards/`, `harness/`, `backups/`, and logs are never in scope. Remote Node is v22.23.2; the code already runs there, so no runtime change.

### 4.4 Order of operations

1. Freeze the release: #158 and #167 are reviewed. Bump `package.json` to 5.3.0, land on main, tag `v5.3.0`, push main and the tag to GitHub. Every install after this stamps `5.3.0`. Deploy from a clean working copy at the tag so `source_revision` in every manifest is the tagged commit.
2. Record the before state for every seat and the remote (Appendix B checksums, task counts from `fleet list`).
3. Back up the remote boards with `backup.mjs` (VACUUM INTO) into `/home/falcon/backups/pre-v5.3/`. Tar each seat's `harness/` into `manager-pm/.runs/fleet-upgrade/<date>/<seat>-harness.tgz`.
4. Deploy the remote first (4.3) and confirm `fleet list` still shows seven seats with the same task counts.
5. Upgrade seats one at a time, `manager-pm` last: install, then run the post-checks in Appendix B before moving to the next seat.
6. Land: update working memory, close this doc. The tag already exists from step 1.

Rollback for a seat is `rm -rf harness && tar xzf <backup>`. Rollback for the remote is the reverse rsync from the local tag checkout plus a service restart; boards are untouched either way.

## 5. Implementation Milestones

- [ ] **Milestone 1: Setup the design doc and tasks**
  - This doc is registered in `INDEX.md` and synced to the board. Operator reviews the per-seat inventory (Appendix A) and confirms the three decisions: upgrade cards under the hash guard, leave v4 leftovers alone, deploy remote by rsync not git.
- [ ] **Milestone 2: Freeze main and record the before state**
  - #158 and #167 are done. Bump `package.json` to 5.3.0, `npm test` green, land on main, tag `v5.3.0`, `jj git push` main and the tag. Then, from a clean working copy at the tag, write the before checksums from Appendix B and the `fleet list` task counts and versions to `manager-pm/.runs/fleet-upgrade/<date>/before.txt`.
- [ ] **Milestone 3: Back up remote boards and seat harnesses**
  - On `falcon-manager`: `node components/board/tools/backup.mjs --boards-dir boards --roster config/roster.json --out /home/falcon/backups/pre-v5.3` and confirm the manifest lists all 12 databases. Locally: tar `harness/` of every seat into the run directory. No seat is touched until its tarball exists.
- [ ] **Milestone 4: Deploy the board server**
  - Run the scoped rsync from 4.3, restart the user unit, `/api/v1/health` must report `5.3.0`. From `manager-pm`, `fleet list` must show the same seven seats and task counts as before. Open the board in Chrome and confirm the Lanes view renders for `manager-pm` and `agent-d-pm`.
- [ ] **Milestone 5: Upgrade the six worker seats**
  - For each of `agent-b-pm`, `agent-d-pm`, `agent-c-pm`, `agent-e-pm`, `agent-g-pm`, `agent-f-pm` in that order: check the card hash guard, run the installer with `--upgrade-cards` only if it passes, then run the Appendix B after-checks. Stop on the first seat that fails a check.
- [ ] **Milestone 6: Upgrade manager-pm and verify the fleet**
  - Install into `manager-pm` without card flags (its cards already match). Run the after-checks. `fleet list` must show `[v5.3.0]` on all seven seats, and `fleet verify <id>` passes for each. From two worker seats, `board.mjs list` and `brain.mjs list` succeed.
- [ ] **Milestone 7: Living docs**
  - Fold 4.1 (installer contract) and 4.3 (remote deploy by scoped rsync) into `docs/system/MANUAL.md` §7 and `docs/support/RUNBOOK.md` §3. Note in the runbook that the remote runs `components/`, not `harness/`.
- [ ] **Milestone 8: Land**
  - `jj describe`, `jj bookmark set main -r @`, push. Update `brain/__source/working-memory.md` with the deployed version and revision. Marking this Done closes the doc.

---

## Appendix A: Seat inventory, 2026-09-11

Root for all seats: `~/agents/`. Every seat has `harness/falcon.env` at mode 600 pointing at `http://localhost:3333` with its own agent id, and its token hash matches the remote roster. Every seat has `harness/components/{board,brain,docs,friends,harness,sweeper}` and `harness/engine/`.

| Seat | Path | HARNESS.md | Cards | HARNESS-custom.md | Must not touch (beyond the standard list) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| manager-pm | `incubator-v5/manager/manager-pm` | current | current template | 33 lines, seat identity and manager rules | `harness/manifest.json` (hand-made, says v5.0.0), `harness/tools/` (v4 guards), `boards/incubator-v5.sqlite`, `boards/project.sqlite`, `config/`, `ai_docs/`, `agent-docs/` |
| agent-b-pm | `example-pa/agent-b/agent-b-pm` | stale (262 lines) | old, hash `35563c…` | template only | `brain/__source/{me,working-memory}.md`, `workspaces/{example-pa,example-pa-docs}`, `config/`, `engine/`, `_legacy_v4/` |
| agent-d-pm | `project-seo/agent-d/agent-d-pm` | stale | old | template only | `boards/{project,project-alpha}.sqlite` with live WAL, 13 brain files, `workspaces/{client-x,project-alpha,project-beta}`, `projects/{clients,tests}`, `.env`, `data/`, `docs/`, `sandbox/`, `scratch/`, `tools/`, `viewers/` |
| agent-c-pm | `project-brain/agent-c/agent-c-pm` | stale | old | template only | v4 files inside `harness/`: `harness.md`, `manifest.json` (v4.7.0), `substrate.json`, `tools/{guards,viewers,brain.mjs}`. `.mcp.json` points at `~/incubator-v4-base` on falcon-manager. 9 brain files. `workspaces/{project-brain,project-brain-docs,example-pa}` |
| agent-e-pm | `project-social/agent-e/agent-e-pm` | stale | old | template only | v4 files inside `harness/`: `harness.md`, `manifest.json` (v4.6.0), `substrate.json`, `tools/`. `.mcp.json`. `brain/__source` is empty. `workspaces/{project-social,project-social-docs}` |
| agent-g-pm | `project-gamma/agent-g/agent-g-pm` | stale | old | template only | **`harness/brain/` is a live v4 brain store** (`__source`, `__forgotten`, `__meta`); root `brain/__source` is empty. `harness/hooks/brain-session-start.sh`, `harness/skills/`. `workspaces/{project-gamma-v3,-v3-docs,-v4,-v4-docs}`. Seat git has 5975 dirty files. |
| agent-f-pm | `project-web/agent-f/agent-f-pm` | stale | old | template only | 3 brain files, `workspaces/{bakeoff-20260818,manager-dev-board-backup,project-web,project-web-docs}`, `config/`, `engine/`, `_legacy_v4/` |

Not a seat: `project-seo/agent-d/agent-d-pm-evidence` (no `harness/`, not on the roster).

Remote: `falcon@203.0.113.10`, `/home/falcon/incubator-v5`. User unit `falcon-board.service` active, process started 2026-09-11 11:24. `components/board/{tools/serve.mjs,api/server.mjs,engine/board.mjs,tools/board/reportCommands.mjs}` already match local main. `harness/HARNESS.md` there is stale and unused. Last backup: `/home/falcon/backups/v5-initial/snapshot-2026-09-08T21-23-26-930Z`. Also present and inactive: `incubator-fleet-hub.service` (v4), `dashboard-api.service`.

## Appendix B: Checks per seat

Record before and after. A seat passes only when every "unchanged" line is identical and every "matches repo" line is identical to the repo file.

```bash
S=<seat path>; R=~/agents/manager-pm/workspaces/incubator-v5
# unchanged
md5 -q $S/harness/falcon.env $S/harness/HARNESS-custom.md
ls $S/brain/__source | md5 -q;  ls $S/boards | md5 -q;  ls $S/workspaces | md5 -q;  ls $S/projects | md5 -q
[ -f $S/.mcp.json ] && md5 -q $S/.mcp.json;  [ -d $S/harness/brain ] && ls -R $S/harness/brain | md5 -q
# version stamp (after only): both must read 5.3.0
grep harness_version $S/harness/manifest.json
node harness/components/board/tools/fleet.mjs list | grep "($(basename $S))"
# matches repo (after only)
diff -q $S/harness/HARNESS.md $R/components/harness/templates/HARNESS.md.template
diff -q $S/harness/engine/brain.mjs $R/components/brain/engine/brain.mjs
for c in board brain docs friends harness sweeper; do diff -rq --exclude node_modules --exclude tests $R/components/$c $S/harness/components/$c | grep -v "^Only in $S"; done
# cards (after only, worker seats)
diff -q $S/CLAUDE.md $R/components/harness/templates/AGENTS.md.template
# reaches the board
(cd $S && node harness/components/board/tools/board.mjs list >/dev/null && node harness/engine/brain.mjs list >/dev/null && echo OK)
```

The component diff ignores lines that begin `Only in <seat>`: those are the leftovers the installer never deletes. Any line that begins `Only in $R` or `Files … differ` is a failure.
