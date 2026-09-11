# [Proposal Title]

- **Codename**: [Auto-assigned or e.g. #d-10]
- **Status**: Open & Active
- **Author**: [Author Name / Agent]
- **Target Component(s)**: [e.g. components/board, components/harness]
- **Last Updated**: YYYY-MM-DD

---

## 1. Context & Scope
*Describe the problem being solved, the motivation, and architectural background in 1–2 concise paragraphs. Cite relevant living docs in `docs/system/` rather than duplicating them.*

---

## 2. Goals & Explicit Non-Goals
* **Goals**:
  - Goal 1: Specific functional or operational capability.
  - Goal 2: Measurable performance, safety, or quality target.
* **Non-Goals**:
  - Out-of-scope boundary 1 (e.g. "No changes to existing task schema").
  - Out-of-scope boundary 2 (e.g. "No external service dependencies; keep in-process").

---

## 3. Alternatives Considered
*Compare 2–3 viable approaches and state trade-offs explicitly (why the chosen path is preferred).*
1. **Approach A (Status Quo / Baseline)**: Trade-offs and reasons discarded.
2. **Approach B (Alternative Architecture)**: Trade-offs and reasons discarded.
3. **Approach C (Chosen Proposal)**: Why this delivers the best balance of simplicity, safety, and velocity.

---

## 4. Design
*Sketches of interfaces, data flow, and subsystem interactions. Focus on what and why, not pseudo-code or line-by-line procedures. If it starts to read like an implementation manual, stop.*

---

## 5. Implementation Milestones
*Break work down into sequential milestones. A line or two under each milestone is its brief; `sync-doc` copies it into the job's details.*

- [ ] **Milestone 1: Setup the design doc and tasks**
  - Author this proposal in `docs/design/<slug>.md`, register in `INDEX.md`, sync to board (`board sync-doc <slug>`), and move Milestone 1 to In-Review for operator alignment.
- [ ] **Milestone 2: [Core Work Milestone]**
  - Brief describing deliverables and implementation steps for this milestone.
- [ ] **Milestone 3: Living docs**
  - Fold changes to system truth, schemas, or operational manuals into `docs/system/ARCHITECTURE.md` and `MANUAL.md`.
- [ ] **Milestone 4: Verification**
  - Automated tests passing (`npm test`), new unit/contract tests, and interactive UI verification in Chrome if applicable.
- [ ] **Milestone 5: Land**
  - Commit revision, update main bookmark, push, and dogfood seat. Marking Done closes and archives this proposal automatically.
