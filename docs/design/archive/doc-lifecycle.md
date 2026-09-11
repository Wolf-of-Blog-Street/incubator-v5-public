# Design Doc Lifecycle: Proposals That Close Themselves

- **Codename**: #d-8
- **Color**: #f472b6
- **Status**: Closed
- **Author**: Manager PM
- **Target Component(s)**: `components/harness/templates/HARNESS.md.template`, `docs/design/templates/epic.template.md`, `components/board/engine/board.mjs`, `components/board/api/services/docService.mjs`, `components/board/tools/board/docCommands.mjs`, `components/board/ui`
- **Last Updated**: 2026-09-10

---

## 1. Context & Problem Statement

The harness teaches two models of a design doc at once. The template is a Google-style proposal: problem statement, goals, alternatives, milestones. The lifecycle rules make the same file evergreen: it never closes, new work is appended as rounds, and only the operator may mark it Closed.

The two models conflict:
1. A landed proposal reads as fiction. Its problem statement describes a problem fixed weeks ago.
2. Rounds turn a spec into a diary. An agent loading the doc for context must work out which sections are still true.
3. Closing is manual, so every doc sits at Open & Inactive forever and the board's Open/Closed filter carries no signal.
4. The docs rule says history lives in version control, and the rounds section contradicts it.

## 2. Goals & Explicit Non-Goals

### 2.1 Goals
* [ ] **One design doc = one proposal.** A doc describes one round of work. It is authored, tasks are scaffolded, work lands, and the doc closes. New work on the same area is a new doc.
* [ ] **Docs close themselves.** When the last job attached to a doc moves to Done, the board marks the doc Closed. Reopening a task, or adding a new task, reopens the doc. No operator step.
* [ ] **Current truth lives in `docs/system/`.** The landing milestone of every proposal folds what changed into the system docs. Agents read `system/` for how the component works and `design/` for what is in flight.
* [ ] **Harness teaches this in one place.** Section 8 of HARNESS.md and the epic template say proposal, not evergreen. The rounds mechanism is removed from the teachings, the template, and `sync-doc`.
* [ ] **Board reflects it.** Closed docs drop out of the default Roadmap/Lanes; the Docs view shows Open as active work and Closed as history.

### 2.2 Explicit Non-Goals
* No change to the task state machine or the task schema.
* No migration of already-landed docs. Existing docs keep their current status until their tasks change.

## 3. Alternatives Considered

1. **Evergreen Blueprints with Rounds (Status Quo)**:
   - *Trade-off*: Concentrates all subsystem history in one document, but turns specs into stale diaries where past problem statements read as current bugs. Requires manual closing which operators rarely perform.
2. **Issue Tracker Only (No Design Docs)**:
   - *Trade-off*: Eliminates doc maintenance, but loses early architectural exploration, trade-off deliberation, and shared understanding of complex systems.
3. **Google-Style Proposals with Automated Board Lifecycle (Chosen)**:
   - *Trade-off*: A design doc serves as an informal thinking guide for non-obvious work. When work lands, enduring truth moves to `docs/system/`, and the proposal auto-archives as history. Simple, clear, zero manual closing bureaucracy.

## 4. Design

### 4.1 Lifecycle
```
Open & Active    tasks exist and at least one is not Done
Open & Inactive  a doc with zero tasks (just authored, or all tasks deleted)
Closed           tasks exist and all are Done          <- set by the board engine, not by hand
```
Transitions are computed by the board on task writes. `attachDocTaskStats` derives `execution_state`; `all done` becomes `Closed` instead of `Inactive`, and the derived state is written back to the doc file's `Status` line so the file agrees with the board.

### 4.2 The procedure, end to end
```
1. Read docs/system/ for the area.            (context, cite it, do not copy it)
2. Write docs/design/<slug>.md from the template; register in design/INDEX.md.
3. board sync-doc <slug>   -> one job per milestone; Milestone 1 to In-Review; operator reviews & approves.
4. Work the milestones:    plan and code in whatever chunking makes sense.
5. Living docs milestone:   update docs/system/ in the same change.
6. Verification milestone:  npm test green, new tests, Chrome check for UI.
7. Land milestone:          commit, fast-forward main, push, dogfood harness.
   Marking it Done closes the doc: Status -> Closed, file moved to design/archive/,
   INDEX.md row moved to the archive table. Nothing for the operator to do.
```
Closing is the board's job (4.3). Archiving is part of closing: `reconcileDocStatus` moves the file to `design/archive/<slug>.md` and rewrites both INDEX tables, so `design/` only lists work in flight. Reopening a task moves the file back.

### 4.3 Engine Integration & Path Resolution
- `engine/board.mjs` `updateItem`, `addItem`, `deleteItem`: after the write, recompute the doc's task counts and call `reconcileDocStatus(slug)`. The routes inherit this directly.
- `docService.mjs` `reconcileDocStatus`: resolves the doc file for the agent and project (supporting both local `docs/design/` and remote sync copies under `docs/sync/<agent>/<project>/`), rewrites `Status` to `Closed` when all tasks are done, `Open & Active` when any task is open. On `Closed` it moves the file to the corresponding `archive/` subfolder and updates `INDEX.md`; on reopen it moves it back. Safe, idempotent, no-ops if doc file is absent.
- Operator marks Milestone 1 Done as the alignment signal; the engine handles closing on the final milestone.
- `finish-doc` and `reopen-doc` CLI commands remain as manual overrides with notice that subsequent task writes recompute status.

### 4.4 Teachings
HARNESS.md section 8 becomes the lifecycle table (4.1), the procedure block (4.2), and a short guide to the doc itself, taken from how Google does it (Ubl, *Design Docs at Google*; *Software Engineering at Google* ch. 10):

- A design doc is informal. The template is an outline, not a form. Use the sections that help and drop the ones that do not.
- It says what and why, and weighs the trade-offs. Context and scope, goals and non-goals, the design, alternatives considered, anything cross-cutting like security or data. Sketches of APIs and data, not full definitions. No pseudo-code, no step lists. If it starts to read like an implementation manual, stop.
- It is updated while the work lands, when reality corrects it. When the last job is done it closes and stays in the archive as the record of why.
- Do not write one for obvious work. That is a standalone job.
- The doc owns the shape; the worker owns the build. Plan and code in whatever order and size works. Work is work.

The Non-Closing Invariant, the rounds subsection, the operator-only close rule, and the "never work without a design doc" bootstrap rule are deleted. Section 8 after this change is shorter than before it.

The epic template follows the Google outline plus one section of ours, Implementation Milestones, which is how the board gets its jobs. Milestone 1 and the three closing milestones (Living docs, Verification, Land) are pre-filled; the work milestones go between. A line or two under a milestone is its brief and `sync-doc` copies it into the job. The separate Verification Plan and Living Docs Update Plan sections are folded into those two closing milestones.

Vocabulary in UI copy and CLI help: a card is a job, a card without a doc is a standalone job.

## 5. Implementation Milestones

- [ ] **Milestone 1: Setup the design doc and tasks**
  - Author this doc, register in INDEX.md, `sync-doc`, attach plan, move to In-Review.
- [ ] **Milestone 2: Board auto-close**
  - `reconcileDocStatus` in docService with archive move and INDEX rewrite; hooks in board engine and API task routes; `sync-doc` copies each milestone's sub-bullets into the job's details as its brief; tests for close on last Done, archive move, reopen on task reopen or add, brief copied, no-op when the doc file is absent.
- [ ] **Milestone 3: Harness teachings and template**
  - Rewrite HARNESS.md section 8 per 4.4 and delete the no-doc bootstrap rule from the AGENTS.md template; epic template follows the Google outline with milestones; remove rounds from parser and sync-doc; job vocabulary in CLI help and manual.
- [ ] **Milestone 4: Board UI**
  - Docs view and Lanes treat Closed as history by default; UI copy uses job / task / standalone job.
- [ ] **Milestone 5: Living docs**
  - Fold the lifecycle and the `system/` rules into `docs/system/ARCHITECTURE.md` and `MANUAL.md`.
- [ ] **Milestone 6: Verification**
  - `npm test` green with lifecycle tests; auto-close and reopen checked on the dev board in Chrome.
- [ ] **Milestone 7: Land**
  - Commit, fast-forward main, push, dogfood the harness into the seat. Closing this task closes the doc.

## 6. Verification Plan
- `npm test` green with the new lifecycle tests.
- On the dev board: create a doc with two tasks, mark both Done, doc shows Closed in the file and the UI; reopen one, doc shows Open & Active.
- A fresh agent reads HARNESS.md section 8 and can state the lifecycle in one sentence.

## 7. Living Docs Update Plan
- `docs/system/ARCHITECTURE.md`: replace the design doc state model with section 4.1 above.
- `docs/system/MANUAL.md`: `finish-doc` and `reopen-doc` documented as overrides.
