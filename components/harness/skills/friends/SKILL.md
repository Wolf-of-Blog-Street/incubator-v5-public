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
| `claude` | general tool-using work on Fable 5.1 |
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

## Accounts

Friends use the operator's own login for each CLI unless the pool has an account:
`friend.mjs accounts list`, `accounts add <provider> --api-key <key>`. HARNESS.md 9 has the rest.
