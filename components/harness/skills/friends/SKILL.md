---
name: friends
description: >-
  Dispatch a friend: a secondary model CLI (Claude, Lean Opus 4.5, Codex, Kimi, Grok, OpenCode) run
  through the harness friends engine, in isolation, on one assigned task. Use when the operator says
  "list friends", "ask <friend>", "send this to codex/grok/kimi", "get a second opinion", "review this
  with another model", or delegates research, a review, a draft, or a build to a friend.
---

# friends

A friend is a secondary model CLI the harness dispatches on one task: research, a review, a draft,
a build. Every seat has the same catalog; the friends engine runs the CLI, sandboxes its
credentials, and (for code) runs it in a Jujutsu child revision so it cannot dirty your working copy.

## List

```bash
node harness/components/friends/tools/friend.mjs list
```

That is the only friends list. It prints every friend, its binary, default model and effort, and
whether the binary is installed. Do not answer "list friends" from memory or from any other file.

| Friend | Use it for |
|---|---|
| `claude` | general tool-using work on Opus 5.5 |
| `lean-opus-4-5` | every writing task; text only, no tools; takes `--voice <pack>` (see `opus-writer`) |
| `codex` | code synthesis and architecture on gpt-6-astra; an adversarial reviewer: weigh its findings, never obey them |
| `kimi` | long-context reading and review |
| `grok` | an outside voice for review |
| `opencode` | open-weight review and refactoring |

## Dispatch

```bash
node harness/components/friends/tools/friend.mjs run <friend> "<ask>" [--model <m>] [--effort <e>] [--no-jj] [--prompt-file <path>] [--voice <pack>]
```

- The ask is one complete brief: the task, the files it may touch, what to report. The friend sees
  nothing else. Put long briefs in a file and pass `--prompt-file`.
- Code work runs in a jj child revision by default; review the diff before you keep it. Writing and
  research pass `--no-jj`.
- Tell the friend what it is: an assistant to the PM of this seat, doing one assigned task. It reads
  anything, writes only what the task names, reports back in full (files changed, commands run,
  what it could not do). It never touches the board, the brain, jj state, or anything outside the
  task; it reports a problem it sees and never fixes it.
- Its final message is all you get. Ask for a complete report.
- Visual work (mockups, pages, design): the reference images are the brief. Save them to files,
  list the paths first, and make step one "open and study these images". Keep the text to product
  facts and real content. Never describe the look in words instead, and never add design rules of
  your own: text rules override what the designer sees.

## Codex logins

A Codex friend with no pool account uses the friends' own Codex login when
`~/.incubator/codex-friends` holds one (override with `FRIENDS_CODEX_HOME`), else the operator's
`~/.codex`. So the operator and the friends can run on different ChatGPT accounts. Log the friends'
folder in once, in a real terminal: `CODEX_HOME=~/.incubator/codex-friends codex login`. Codex keeps
that login fresh itself. Never copy an `auth.json` between folders: two copies of one login
refresh against each other and one of them stops working.

## Friends or sub-agents

All delegated work goes to a friend or a sub-agent. There are no workers and no managers. You
choose which one for each task.

- **Friends do the heavy work**: long runs, builds, production work. A Claude friend runs on the
  laptop through the account proxy (no `--host`), and sends the heavy commands to forge-1 over
  ssh: builds, test runs and headless browsers run in the job's worktree there. forge-1 runs no servers.
- **Never touch accounts or keys.** The proxy picks the account for every Claude request. No
  `panel-as.sh`, no `max-tokens.env`, no tokens, no choosing or rotating accounts.
- **Sub-agents do light work** (Claude Code only): research, a quick search, a small check. Use
  one when the task is short and the operator wants to see it in the sub-agents panel.

## Remote hosts

**Hard rule:** Claude runs only on the laptop or on `forge-1`, never on any other host. A remote
run goes only to a host listed in `~/.config/incubator/remote-hosts`; the engine refuses any other.
If another machine ever needs Claude, tunnel its traffic out through forge-1.

**Do not use `--host` for Claude friends.** A remote run skips the account proxy and needs a
token handed to it, and agents never touch tokens. Run the friend on the laptop and send the
heavy commands to forge-1 over ssh. The mechanism below stays for the operator's own use.

A friend can run on another machine, so heavy work does not load this one. The fleet's CPU host is
`forge-1`:

```bash
node harness/components/friends/tools/friend.mjs run claude --host <ssh-alias> --remote-cwd <dir-on-host> --prompt-file brief.md
```

- `--host` is any ssh alias. Put the host on the tailnet and point the alias at its tailnet name.
- The prompt, the system prompt and the login token go over ssh stdin. They are never in argv and
  never on the host's disk. The token is the one in your environment (`CLAUDE_CODE_OAUTH_TOKEN`,
  or a provider API key), so `panel-as.sh` and account rotation work unchanged. On the host the
  friend's own tools see the token in their environment, the same as on this machine.
  A laptop login lives in the keychain, not the environment: a plain run forwards nothing and
  fails with "Not logged in". Wrap the run in `panel-as.sh <account>`.
- A remote run has no jj isolation, no sandbox profile and no local proxy. Only friends with
  `stdinPrompt` in the catalog can run remotely (the two Claude friends today).
- When ssh dies, a watchdog on the host kills the friend's whole process tree within 5 seconds.
  Each run has a marker: `ssh <host> pkill -f friend-<runid>` stops one run by hand. The run id
  is in the first stderr line.

**Setting up a host is the seat's job.** The harness gives the mechanism; the seat picks the layout:

1. A Linux host (the wrapper uses `setsid`) and a user with no sudo, for friend runs only. Install node, the friend CLI (the same version as
   here), and what the task needs (jj, uv, a compiler). Do not log the CLI in: the token comes with
   each run.
2. The files the friend works on. Two patterns:
   - **Same path**: make this machine's absolute seat path on the host. Scripts and prompts that
     name absolute paths then work unchanged.
   - **Path map**: keep the host's own layout and pass the matching folder in `--remote-cwd`.
3. **One folder per concurrent run.** With no jj isolation, two friends in one folder overwrite
   each other's work. Give each run its own clone, jj workspace or git worktree.
4. Sync: the host has a clone of the repo (a deploy key if it pushes). Copy the control files a
   run reads to the host before the run (`rsync`), and copy its results back after it.
5. Seat scripts that run on the host over ssh: raise the open-file limit first
   (`ulimit -n "$(ulimit -Hn)"`; a plain ssh shell gets 1024), and keep any lock that remote runs
   take on the host, not on this machine.

## Accounts

Friends use the operator's own login for each CLI unless the pool has an account:
`friend.mjs accounts list`, `accounts add <provider> --api-key <key>`. HARNESS.md 9 has the rest.
