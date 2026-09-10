# Account Isolation & Zero-Interference Identity Management

- **Status**: In Progress
- **Author**: manager-pm (Fleet Manager & Pair Programmer)
- **Target Component(s)**: `components/friends`, `components/auth`, `components/harness`
- **Codename**: #d-5
- **Color**: #8b5cf6
- **Last Updated**: 2026-09-08

---

## 1. Context & Problem Statement

In an agentic workspace, automated background tasks, multi-turn bug sweeps, and friend dispatches (`claude`, `codex`, `kimi`, `opencode`) execute frequent model queries. By default, these CLI binaries store and read authentication credentials, OAuth refresh tokens, interactive session histories, and working state directly inside the operator's global user home directory (e.g., `~/.claude.json`, `~/.codex/`, `~/.config/`).

This default shared-state behavior creates critical operational collisions:
1. **Interactive Session Eviction & Token Revocation**: Automated sub-agents exchanging OAuth tokens in the background frequently invalidate or expire the operator's personal interactive sessions (e.g., `401 OAuth access token has been revoked`).
2. **Quota & Rate-Limit Cannibalization**: Background sweeps and automated coding tasks burn through the operator's primary rate limits and high-priority tiers, leaving the operator throttled during direct terminal use.
3. **Session & History Pollution**: Automated sub-agent threads, temporary workspace permissions, and scratchpad states clutter the operator's interactive session history and recent files.
4. **Operator Lockout Risk**: If an automated worker experiences auth failures or crashes during token refresh, it can corrupt local configuration files and break the operator's personal tools.

This design specification introduces **Zero-Interference Account & Profile Management**, establishing strict credential sandboxing, dedicated automation account pools, rate-limit fallback, and isolated configuration directories so automated agents never collide with or degrade the operator's direct use.

---

## 2. Goals & Explicit Non-Goals

### Goals
- [ ] **Strict Profile & Config Sandboxing**: Automated friend invocations run with isolated config directories (e.g. `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_CONFIG_HOME`) located in `~/.incubator/auth/agents/<agentId>/friends/<provider>/` or seat sandboxes, leaving operator global configs (`~/.claude.json`, `~/.codex/config.toml`) untouched.
- [ ] **Universal Multi-Agent Roster Support**: Works seamlessly across **ALL** agent seats in the roster (`manager-pm`, `example-pa/agent-b-pm`, `project-social/agent-e-pm`, `project-brain/agent-c-pm`, etc.), ensuring strict isolation between agents and preventing any agent from starving another agent's quota.
- [ ] **Local Fleet Control Plane (Managed Locally by Manager PM)**: Manager PM manages the central credential store, account health probes, key rotation, and automated refresh loops directly from the local MacBook workstation, distributing configured profiles to remote seats as needed.
- [ ] **Automated Credential Refresh & Token Renewal Daemon**: Proactively monitor token TTLs and perform background OAuth refresh / token exchange so automated sub-agents across the fleet never stall on expired/revoked credentials (`401 OAuth token expired`).
- [ ] **Account Health & Quota Failover**: Track rate limits (429), token expiration, and auth failures with automatic failover across account pools or graceful fallback to alternate model providers.
- [ ] **Zero-Interference Operator Guarantee**: The operator can run `claude` or `codex` directly in their terminal or IDE at any time with full performance, dedicated interactive tokens, and zero risk of background eviction.
- [ ] **CLI & MCP Management Tools**: Provide `friend accounts list`, `friend accounts add`, `friend accounts refresh`, `friend accounts sync`, and programmatic MCP tools for fleet-wide inspection and provisioning.
- [ ] **Zero External Dependencies**: Implemented in pure Node.js 22 built-ins (`node:fs`, `node:path`, `node:crypto`, `node:child_process`).

### Non-Goals
- **Centralized Cloud Key Vault Service**: No external proprietary secrets managers or SaaS dependencies; keys and tokens are securely managed locally by Manager PM and distributed to fleet hosts via secure transport.
- **Modifying Upstream CLI Binaries**: No binary patching of `claude` or `codex`; isolation is achieved cleanly via environment variable steering, isolated working trees, and configuration redirection.

---

## 3. Architecture & Data Contracts

### 3.1 Directory & Profile Isolation Topology

Claude Code and Codex CLI provide native environment variable overrides that govern where configuration, token stores, and session state are persisted. Manager PM structures the sandboxes per-agent seat:

| Provider | Environment Variable | Default Location | Automation Sandbox Path (Per Agent Seat) |
| :--- | :--- | :--- | :--- |
| **Claude Code** | `CLAUDE_CONFIG_DIR` | `~/.claude/` | `~/.incubator/auth/agents/<agentId>/friends/claude/` |
| **OpenAI Codex** | `CODEX_HOME` | `~/.codex/` | `~/.incubator/auth/agents/<agentId>/friends/codex/` |

```
Operator Personal Space (Global)            Incubator Fleet Multi-Agent Sandboxes
─────────────────────────────────          ──────────────────────────────────────────
~/.claude/ & ~/.claude.json                ~/.incubator/auth/
  ├── Primary OAuth Tokens                   ├── accounts.json (Local Central Store)
  └── macOS Keychain (Default Partition)     └── agents/
~/.codex/                                         ├── manager-pm/friends/
  ├── config.toml                                 │    ├── claude/ (Isolated Sandbox)
  ├── auth.json (Personal Auth)                   │    └── codex/ (Isolated Sandbox)
  └── history/                                    ├── example-pa/friends/
                                                  │    ├── claude/ (Isolated Sandbox)
                                                  │    └── codex/ (Isolated Sandbox)
                                                  └── [other-agents]/...
```

When `dispatchFriend(provider, options)` runs for any agent seat:
1. **Agent Seat Context Resolution**: Identifies the calling agent (`options.agentId || state.activeAgentId || 'manager-pm'`).
2. **Pre-flight Token Health Check**: Verifies that the provider's active token for this seat is valid. If within renewal window (< 15 mins remaining), triggers an automated proactive refresh.
3. **Isolated Environment Steering**: Injects `CLAUDE_CONFIG_DIR` and `CODEX_HOME` pointing to the agent's specific sandboxed path.
4. **Dedicated Key Injection**: Injects dedicated API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) or service tokens configured for this seat/pool.
5. **Isolated Subprocess Execution**: Executes the subprocess with `child.stdin.end()` inside Jujutsu isolation.

### 3.2 Automated Token Refresh Loop & Heartbeat

```
┌────────────────────────────────────────────────────────────────────────┐
│  Manager PM Local Auth Heartbeat Daemon (Runs on Local MacBook Seat)     │
└───────────────────────┬────────────────────────┬───────────────────────┘
                        │                        │
             Every 10 mins (Daemon/Cron)   Before dispatchFriend()
                        │                        │
                        ▼                        ▼
              [Token TTL < Threshold?] ───Yes───► [Execute OAuth Refresh]
                        │                        │
                        No                       ▼
                        │               [Atomic Local Store Update]
                        ▼                        │
                  [Status: Healthy]     [Sync to Remote Seats / Board]
```

### 3.3 Multi-Agent Account Pool Schema (`~/.incubator/auth/accounts.json`)

```json
{
  "version": 1,
  "manager": "manager-pm",
  "autoRefresh": true,
  "refreshIntervalSec": 600,
  "fleetPools": {
    "default": {
      "claude": {
        "mode": "isolated-profile",
        "accounts": [
          {
            "id": "fleet-claude-primary",
            "type": "oauth-profile",
            "status": "healthy",
            "tokenExpiresAt": "2026-09-09T08:00:00Z",
            "autoRenew": true,
            "rateLimitResetAt": null,
            "lastUsed": "2026-09-08T23:10:00Z"
          }
        ]
      },
      "codex": {
        "mode": "isolated-home",
        "accounts": [
          {
            "id": "fleet-codex-primary",
            "type": "api-key",
            "envVar": "OPENAI_API_KEY",
            "status": "healthy",
            "rateLimitResetAt": null,
            "lastUsed": "2026-09-08T23:10:00Z"
          }
        ]
      }
    }
  },
  "agentOverrides": {
    "example-pa": {
      "pool": "default"
    },
    "manager-pm": {
      "pool": "default"
    }
  }
}
```

### 3.4 Local Fleet Account CLI Contract (`friend accounts` / `fleet accounts`)

```bash
# List all configured accounts, seats, and health across the entire roster
friend accounts list

# Manually trigger credential renewal and health probe for all roster seats
friend accounts refresh [--agent <agentId>] [provider]

# Add or update a dedicated automation key for a seat or fleet pool
friend accounts set claude --key "sk-ant-..." --pool default
friend accounts set codex --home "~/.incubator/auth/agents/manager-pm/friends/codex"

# Push/sync refreshed credentials to remote fleet seats (falcon-manager, example-pa)
friend accounts sync [--all | --agent <agentId>]

# Test authentication health for all agents in roster
friend accounts test [--all | --agent <agentId>]

# Reset rate-limit cooldown state
friend accounts reset-quota <provider> [account-id]
```

---

### 3.5 macOS Keychain Protection & Verified Credential Mechanics

Based on Claude Code and Codex authentication specifications:
1. **Claude Code Keychain Keying**:
   - On macOS, Claude Code stores OAuth tokens in the macOS Keychain (`security` CLI / Keychain Services API).
   - Crucially, Claude Code **keys its Keychain entry to the active `CLAUDE_CONFIG_DIR` path**.
   - By steering automated runs to `CLAUDE_CONFIG_DIR=~/.incubator/auth/agents/<agentId>/friends/claude`, Claude Code creates and maintains distinct Keychain items per agent seat, completely isolated from the operator's default `~/.claude` Keychain entry.
2. **API Key Priority Bypass**:
   - When `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is provided in the isolated profile, Claude Code and Codex prioritize the environment variable and completely bypass Keychain queries.
3. **Avoid `CLAUDE_CODE_OAUTH_TOKEN` Gotcha**:
   - Direct injection of `CLAUDE_CODE_OAUTH_TOKEN` causes the CLI to delete the Keychain entry on process exit. Therefore, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` profile directory steering is the officially supported, stable isolation method.
4. **Headless Background Token Refresh**:
   - Background refresh executes token renewals locally within the isolated directory structure without triggering interactive OS prompts or revoking the operator's interactive session.

---

### 3.6 Local Fleet Manager Administration & Remote Seat Distribution

As the Fleet Manager, `manager-pm` manages the credential lifecycle locally and propagates it across the topology:
1. **Local Authoring & Token Renewal**: All OAuth logins, API key provisioning, and automated renewals are executed locally on the MacBook control plane by `manager-pm`.
2. **Automated Remote Sync**: When credentials are added or refreshed, `friend accounts sync` deploys the sandboxed credentials to remote agent hosts (`falcon-manager:/home/falcon/...`, `example-pa`, etc.) using secure SSH/SCP or Board proxy sync.
3. **Multi-Agent Roster Registration**: The Board server roster (`config/roster.json`) tracks auth health badges per agent seat on the live dashboard.

---

## 4. Implementation Milestones

- [x] **Milestone 1: Config Directory & Profile Sandboxing Engine**
  - Implement runtime directory resolution (`resolveFriendEnvironment`) for `claude`, `codex`, `kimi`, `opencode`.
  - Automatically initialize isolated config skeletons under `~/.incubator/auth/friends/<provider>/`.
  - Unit test environment injection and verify zero access to operator `~/.claude.json` / `~/.codex/` and zero mutation of primary macOS Keychain items.

- [x] **Milestone 2: Multi-Account Pool & Credential Storage**
  - Implement encrypted/safe local account repository (`components/friends/engine/accounts.mjs`).
  - Add account health checking, 429 rate-limit backoff tracking, and multi-key rotation.
  - Test account pool failover and recovery.

- [x] **Milestone 3: Automated Credential Refresh & Heartbeat Daemon**
  - Implement proactive token expiration detection (TTL check) and automated background OAuth renewal loop.
  - Support headless token renewal without macOS Keychain prompt collisions.
  - Add periodic background auth health probe and early operator warning banners on the board.
  - Add `friend accounts refresh` CLI commands.

- [x] **Milestone 4: Friends Dispatcher Integration & Auto-Recovery**
  - Connect `dispatchFriend` to account pool resolver and pre-flight token health check.
  - Automatically retry with secondary key or alternate model when 429 / 401 occurs in background runner.
  - Expose `friend accounts` CLI subcommands in `components/friends/tools/friend.mjs`.

- [x] **Milestone 5: Fleet Distribution, MCP Bridge & Live Verification**
  - Update `components/board/tools/mcp-server.mjs` with `friend_accounts_list` and `friend_accounts_refresh`.
  - Deploy account isolation sandbox and refresh daemon to `falcon-manager` and `example-pa/agent-b-pm`.
  - Perform live verification with automated tasks and verify operator interactive sessions and MacBook Keychain items remain completely uninterrupted.

---

## 5. Verification Plan

1. **Automated Unit Tests**:
   - `test/accounts-engine.test.mjs`: Test profile sandboxing, account rotation, rate-limit cooldown, and error handling.
   - `test/token-refresh.test.mjs`: Test token TTL parsing, simulated OAuth renewal, and expired token auto-recovery.
   - `test/friends-isolation.test.mjs`: Verify subprocess env vars contain sandboxed config paths and never read global operator tokens.
2. **Adversarial & Concurrency Tests**:
   - Run simultaneous interactive CLI command and automated friend dispatch; assert zero token corruption or OAuth eviction.
   - Simulate expired access token; assert proactive renewal succeeds without failing the dispatch task.
   - Simulate 429 quota exhaustion; assert automatic failover to secondary account or alternate friend provider.
3. **Fleet Host Parity**:
   - Verify isolated account sandboxes and refresh daemon function uniformly on macOS and `falcon-manager` Ubuntu.

