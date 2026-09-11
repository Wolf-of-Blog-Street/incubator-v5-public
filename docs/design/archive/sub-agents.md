# Secondary Sub-Agents

- **Codename**: #d-3
- **Color**: #8b5cf6
- **Status**: Closed
- **Author**: Manager PM
- **Target Component(s)**: `components/friends`, `components/auth`, `tools/friend.mjs`, `engine/friends.mjs`
- **Last Updated**: 2026-09-10

---

## 1. Context & Architecture Overview

Primary agents frequently need to invoke alternative model families (Claude Code, OpenAI Codex, Kimi, Aider) for tough bug solving, architectural second opinions, or specialized reasoning.

However, default CLI tool behaviors create critical issues:
1. **Interactive Session Eviction**: Automated token refreshes invalidate the operator's personal interactive sessions.
2. **Quota Cannibalization**: Background tasks burn through personal API quotas.
3. **Working Tree Corruption**: Unconstrained secondary CLI runs can overwrite uncommitted changes or pollute working directories.

This document consolidates `friends` and `friends-account-management` into the permanent living specification for secondary model integration.

---

## 2. Core Subsystems

### 2.1 Jujutsu Revision Sandboxing
Every friend dispatch runs in an isolated child revision (`jj new -m "friend(<provider>): <prompt>"`) created automatically before process execution. If the run fails, the child revision is safely abandoned without touching the parent working tree.

### 2.2 Zero-Interference Account Pools
Dedicated credential stores (`~/.incubator/auth/`) and environment variable steering (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) ensure automated workers never share config files or touch the operator's personal global `~/.claude.json` or `~/.codex/`.

---

## 3. Data Contracts & CLI

```bash
# List available friend providers
node components/friends/tools/friend.mjs list

# Dispatch Claude or Codex inside isolated JJ revision
node components/friends/tools/friend.mjs run claude -p "Audit this function for race conditions"

# Manage dedicated account pools
node components/friends/tools/friend.mjs accounts list
```

---

## 4. Verification Plan
- **Contract Tests (Tier 1)**: `node tools/test.mjs --tier1 --component friends` (verifies account pool encryption, token TTL checks, sandbox variables).
- **Journey Tests (Tier 2)**: `node tools/test.mjs --tier2 --component friends` (verifies sandboxed execution and credential injection).
