# Remote Auto-Close Verification Probe

- **Codename**: #d-9
- **Status**: Closed
- **Author**: manager-pm
- **Target Component(s)**: board, harness
- **Last Updated**: 2026-09-10

## Context & Scope
Live operational proof that design doc auto-closing executes cleanly end-to-end on the remote Falcon Board (`falcon-manager:3333`).

## Goals & Non-Goals
### Goals
- Validate that remote job status updates archive both the design copy and the sync copy.
- Validate that `INDEX.md` is updated automatically on disk.

### Non-Goals
- Altering core board schemas or database contracts.

## Alternatives Considered
- Manual `finish-doc` invocation: Rejected in favor of the self-closing lifecycle.

## Design
The board engine synchronously invokes `reconcileDocStatusSync` on task mutations, archiving both the local project copy and the multi-tenant `docs/sync/<agent>/<project>/` copy when all tasks reach `done`.

## Milestones

- [ ] **Milestone 1: Remote Auto-Close Verification Probe**
  - Verify remote board auto-closes proposal upon final job completion
