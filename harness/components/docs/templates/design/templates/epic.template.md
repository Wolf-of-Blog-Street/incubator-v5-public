# [Epic Title]

- **Status**: [Draft | In-Progress | Review | Done]
- **Codename**: [e.g. #d-1]
- **Color**: [e.g. #38bdf8]
- **Author**: [Author Name / Agent]
- **Target Component(s)**: [e.g. src/core, tools/cli]
- **Last Updated**: YYYY-MM-DD

---

## 1. Context & Problem Statement
*Describe the problem being solved, the motivation, and background context in 1–2 paragraphs.*

---

## 2. Goals & Explicit Non-Goals
* **Goals**:
  - [ ] Goal 1: Specific functional or operational requirement.
  - [ ] Goal 2: Measurable performance or reliability target.
* **Non-Goals**:
  - Out-of-scope boundary 1 (e.g. "No UI changes in this epic; CLI only").
  - Out-of-scope boundary 2 (e.g. "No external service dependencies; keep in-process").

---

## 3. Data Models & Interface Contracts
*Define all schemas and interfaces before writing implementation code.*

### 3.1 Data Schemas / Storage
```sql
-- Schema or JSON payload format
CREATE TABLE example_entity (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

### 3.2 CLI & API Contracts
```bash
# Command line interface specification
node bin/cli.mjs --input <path> --concurrency <number>
```
* **Inputs**: Required arguments and environment variables.
* **Outputs**: Expected stdout shape or JSON return object.

---

## 4. Implementation Milestones
*Break the work down into 3–5 bite-sized, sequential phases.*

- [ ] **Milestone 1: Schemas & Data Layer**
  - Task 1.1: Create data schemas / access methods.
  - Task 1.2: Unit test data layer against fixtures.
- [ ] **Milestone 2: Core Business Logic**
  - Task 2.1: Implement processing engine / worker handlers.
  - Task 2.2: Add unit tests for edge cases and errors.
- [ ] **Milestone 3: CLI / Tool Integration**
  - Task 3.1: Wire up command line interface and flag parsing.
  - Task 3.2: Connect CLI to core engine.
- [ ] **Milestone 4: End-to-End Verification & Docs**
  - Task 4.1: Run full verification commands.
  - Task 4.2: Update living documentation in `system/`.

---

## 5. Verification Plan
*Specific, executable commands to verify that the feature works as intended.*

### 5.1 Automated Tests
```bash
npm test tests/path/to/test.mjs
```

### 5.2 Manual / Smoke Verification
```bash
# Command to run and expected output
node bin/cli.mjs --sample
```

---

## 6. Living Docs Update Plan
*Specify what changes will be folded into living docs upon completion:*
- [ ] **`system/ARCHITECTURE.md`**: Update architecture diagram / schema notes.
- [ ] **`system/MANUAL.md`**: Add new CLI command reference and examples.
- [ ] **Archive**: Move this document to `design/archive/<slug>.md` and update `design/INDEX.md`.
