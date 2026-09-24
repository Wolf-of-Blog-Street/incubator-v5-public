# Incubator v5

A harness for coding agents (Claude Code, Codex and others). It gives an agent a board for its
work, a memory, second opinions from other models, bug sweeps and simple HTML reports.

## Components, not a method

Incubator is a set of separate components. Use the ones that help you and ignore the rest.

- **`board`**: the agent's job board. A card is one job. Jobs belong to a design doc, or they
  stand alone. The board runs as local SQLite, or on a shared server for several agents, and
  has a web view.
- **`brain`**: the agent's memory. Durable cards for facts and decisions, and a short
  working-memory card for each context, so the next session starts where the last one stopped.
- **`docs`**: the documentation system for each project (see below). It scaffolds the doc tree
  and checks that it is complete.
- **`friends`**: sends one task to another model's CLI (Claude, Codex, Kimi, Grok, OpenCode). A
  friend runs in its own isolated revision, so it cannot touch your working copy. It can also
  run on a server over ssh, so long or heavy work does not load your laptop.
- **`harness`**: the installer, the agent's manual (`HARNESS.md`), its skills and a
  coder-then-reviewer build loop.
- **`sweeper`**: bug sweeps. Several models audit the code in waves, and a judge keeps only the
  real findings.
- **`viewers`**: turns JSON into one self-contained, script-free HTML page (reports, model
  bake-offs, side-by-side and tabbed document views).

Incubator does not lock you into one way of building software. There is no fixed pipeline and
no chain of worker and manager agents. Your agent does the work, and it chooses when to ask a
friend or a sub-agent for help. Take what fits your projects, change it, and leave out what does not.

## How docs work

Each project keeps its docs in four tiers, each with an `INDEX.md`:

- **`product/`**: who the users are and what they need (requirements and user stories). It says
  nothing about how the system is built.
- **`system/`**: how the system works now (architecture, manual). This is the living truth.
  Every change that alters it updates it in the same commit.
- **`design/`**: design docs for work in progress.
- **`support/`**: runbooks and troubleshooting.

### Design docs, the Google way

Design docs follow Google's practice (Malte Ubl, *Design Docs at Google*; *Software
Engineering at Google*, chapter 10):

- A design doc is informal. The template is an outline, not a form.
- It says what and why, and weighs trade-offs: context and scope, goals and non-goals,
  alternatives considered, the design. It is not an implementation manual.
- It changes as the work lands, so it stays true to what was built.
- Obvious work, small changes and bug fixes need no design doc. They are standalone jobs.

A design doc and the board stay in step. `board sync-doc <slug>` makes one job for each
milestone in the doc. When the last job is done, the board closes the doc and moves it to
`design/archive/`, where it stays as the record of why the system is the way it is.

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
