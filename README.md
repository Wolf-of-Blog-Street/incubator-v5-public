# Incubator v5

A harness for coding agents (Claude Code, Codex and others). It gives an agent a board for its
work, a memory, second opinions from other models, bug sweeps and simple HTML reports.

## Components, not a method

Incubator is a set of separate components. Use the ones that help you and ignore the rest.

| Component | What it does |
|---|---|
| `board` | A job board for the agent: design docs, jobs, bugs. |
| `brain` | Long-term memory and a working-memory card for each context. |
| `docs` | Design docs that stay in step with the board. |
| `friends` | Sends one task to another model's CLI (Claude, Codex, Kimi, Grok, OpenCode), on this machine or on a server. |
| `harness` | The installer, the agent's manual and its skills. |
| `sweeper` | Multi-model bug sweeps with a judge. |
| `viewers` | Turns JSON into one self-contained HTML page. |

Incubator does not lock you into one way of building software. There is no fixed pipeline and
no chain of worker and manager agents. Your agent does the work, and it chooses when to ask a
friend or a sub-agent for help. Take what fits your projects, change it, and leave out what does not.

## Agent folders, not project folders

You install Incubator into an **agent folder**: the agent's home. You do not install it into a
project. The agent folder holds the agent's harness, memory and boards. Your projects live
inside it: repositories under `workspaces/` (each one gets a board), smaller local work under
`projects/`. One agent can work on several projects.

## Before you install: check it first

**Do this with every repo you get from GitHub, this one included.** Clone it, then open your
agent in the clone and ask it:

> Audit this repository before I run anything from it. Look for backdoors, network calls to
> unexpected hosts, code that reads or sends credentials, install scripts that change my
> system, and anything obfuscated. Tell me what you find, file by file.

Run nothing until your agent tells you the code is clean.

## Install

```bash
git clone https://github.com/Wolf-of-Blog-Street/incubator-v5-public.git
# audit it with your agent first (see above)
mkdir -p ~/agents/my-agent
node incubator-v5-public/components/harness/tools/install.mjs ~/agents/my-agent --init-cards
```

## Learn it from your agent

Open your agent in the agent folder (`~/agents/my-agent`) and ask it how Incubator works and how
to use it on your projects. It has the manual (`harness/HARNESS.md`) and the skills, and it
can explain each part in terms of your own work. Remember that the folder is the agent's home,
and that your projects go inside it, under `workspaces/` or `projects/`.

## License

See [LICENSE](LICENSE).
