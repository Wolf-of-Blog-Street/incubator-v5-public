# Codebase Architecture & Modular Refactor Plan

- **Codename**: #d-6
- **Color**: #6366f1
- **Status**: Closed
- **Author**: Manager PM
- **Target Component(s)**: `components/board`, `components/board/ui`, `components/board/api`, `components/friends`, `components/sweeper`
- **Last Updated**: 2026-09-10

---

## 1. Context & Objective

Incubator v5 was built as a zero-dependency autonomous agent harness and multi-seat development environment. During rapid greenfield feature expansion, several key components grew into monoliths without formal module boundaries:
- `components/board/ui/app.js` (3,466 lines: Kanban, Swimlanes, Fleet matrix, Markdown parser, Doc reader, Dialogs, Filter bar, SSE sync).
- `components/board/api/server.mjs` (1,070 lines: Dual-route `/api/` vs `/api/v1/`, static file serving, token authentication, gate management).
- `components/board/ui/app.css` (3,709 lines: monolithic stylesheet without design tokens or component isolation).

### Refactoring Goals
1. **High Modularity**: Break monolithic controllers into single-responsibility ES modules with explicit interfaces.
2. **Unified API Surface**: Eliminate dual-routing ambiguities between legacy and v1 APIs; standardize authentication, tenancy, and loopback guards.
3. **Frontend Component Architecture**: Modularize frontend logic (`ui/modules/kanban.js`, `ui/modules/drawer.js`, `ui/modules/fleet.js`, `ui/modules/api.js`, `ui/modules/markdown.js`) with pure CSS layers.
4. **Ready for Expansion**: Ensure new views, agents, or tools can plug in without touching unrelated core files.
5. **Zero Breaking Changes**: Maintain 100% passing test coverage (all 14 test suites) across all refactoring milestones.

---

## 2. Multi-Perspective Sub-Agent Audit Findings

We deployed three specialized Gemini sub-agents with distinct evaluation layers:
- **Sub-Agent 1 (Gemini 3.8 Flash High)**: Architectural & System Topology
- **Sub-Agent 2 (Gemini 3.7 Flash High)**: API Contracts, Security & State Invariants
- **Sub-Agent 3 (Gemini 3.6 Flash High)**: File, Function & Implementation Review

```
┌────────────────────────────────────────────────────────────────────────┐
│                     TRI-MODEL CODEBASE AUDIT MATRIX                    │
├──────────────────────┬──────────────────────┬──────────────────────────┤
│    3.8 Flash High    │    3.7 Flash High    │      3.6 Flash High      │
│  Architectural View  │  Contract & Security │   Code & Function View   │
├──────────────────────┼──────────────────────┼──────────────────────────┤
│ - Subsystem coupling │ - API route unif.    │ - Function complexity    │
│ - Directory topology │ - Auth & Loopback    │ - Dead code & duplicates │
│ - Data flow & State  │ - Error handling     │ - Formatting & contracts │
│ - Scalability seams  │ - Test surface gaps  │ - CSS structure & tokens │
└──────────────────────┴──────────────────────┴──────────────────────────┘
```

### 2.1 Sub-Agent 1 (3.8 High): Architectural & System Topology
1. **Frontend God Object (`app.js`)**: 3,466 lines conflating DOM queries, network fetching, SSE subscriptions, state mutations, and view rendering. Blocks parallel development and makes new view additions high-risk.
2. **Monolithic API Server (`server.mjs`)**: Routing, authentication, static file serving, markdown filesystem writes, and SSE connection tracking all packed into one 1,070-line closure.
3. **Ambient State Side Effects**: Tools like `client.mjs` execute directory-traversing `.env` lookups that pollute `process.env` and create test leakage across test suites.
4. **Direct Subsystem Coupling**: Sweeper and Friends engines directly import internal SQLite files from Board rather than communicating across clean interface ports.

### 2.2 Sub-Agent 2 (3.7 High): API Contracts, Security & State Invariants
1. **Tenant Boundary Leak**: In `resolveTargetAgent()`, unauthenticated requests fell back to query parameters (`?agent=`), which allowed reading another agent's tasks or board without credential verification.
2. **Loopback Perimeter Vulnerability**: IP-based `isLoopback()` check is vulnerable behind reverse proxies or shared host networks (which see `127.0.0.1`). Recommends zero-trust token authentication (Bearer header or ephemeral local session tokens).
3. **Global Unscoped SSE Broadcasts**: `/api/events` and `/api/v1/events` stream all events globally without tenant scoping, missing periodic heartbeat pings (`:keepalive\n\n`), leading to proxy disconnects and socket leaks.
4. **Dual Routing Divergence**: `/api/*` and `/api/v1/*` have divergent parameter conventions and authorization semantics. Recommends upstream URL rewrite normalization into a single canonical `/api/v1/` tree.

### 2.3 Sub-Agent 3 (3.6 High): File, Function & Implementation Review
1. **Monolithic DOM Cache Vulnerability**: Eagerly caching 80+ DOM elements on script load causes unhandled null dereference errors if any ID changes in markup. Needs safe lazy getters and scoped controllers.
2. **Rendering Performance**: Card rendering executes linear searches and string hashing on every card render ($O(N \cdot M)$ complexity). Needs pre-indexed `Map<slug, doc>` for $O(1)$ lookups.
3. **Fragile Plan Validation**: `hasImplementationPlan()` used brittle comment string matching. Needs structural section parsing.
4. **Synchronous File I/O**: `server.mjs` executes `fs.readFileSync` and `fs.writeFileSync` synchronously inside async request handlers, blocking the event loop. Needs `node:fs/promises`.
5. **Path Traversal Guard**: `serveStatic()` used `filePath.startsWith(baseDir)`, which is insecure for similarly named sibling directories. Needs `path.relative(baseDir, filePath)`.

---

## 3. Target Modular Architecture

```
components/board/
├── api/
│   ├── server.mjs             # Entrypoint & factory (createBoardServer)
│   ├── middleware/            # Composable HTTP middleware
│   │   ├── auth.mjs           # Bearer token verification & tenant isolation
│   │   ├── cors.mjs           # CORS preflight & headers
│   │   ├── json.mjs           # Streaming body parser with payload limit
│   │   └── static.mjs         # Hardened static file server (path.relative guard)
│   ├── routes/                # Modular route controllers
│   │   ├── admin.mjs          # Fleet status & seat provisioning
│   │   ├── board.mjs          # Board summary & task CRUD
│   │   ├── docs.mjs           # Design doc sync & metadata inspection
│   │   ├── events.mjs         # SSE real-time broadcast controller with keepalive
│   │   └── health.mjs         # Health checks & uptime telemetry
│   └── services/              # Pure domain logic
│       ├── docService.mjs     # Markdown parsing, codenames, and async file updates
│       ├── eventBroker.mjs    # Multi-tenant SSE subscriber & broadcast hub
│       └── taskService.mjs    # High-level task queries and checklist logic
├── engine/
│   ├── auth.mjs               # Token hashing & tenant assertion guards
│   ├── board.mjs              # SQLite DatabaseSync queries & indices
│   └── roster.mjs             # Agent & project workspace directory resolver
├── tools/
│   ├── board.mjs              # CLI interface
│   ├── client.mjs             # Hermetic BoardClient (local SQLite or remote HTTP)
│   ├── fleet.mjs              # Multi-agent fleet management CLI
│   ├── mcp-server.mjs         # Model Context Protocol adapter
│   └── serve.mjs              # Standalone daemon launcher
└── ui/
    ├── index.html             # Shell markup loading module entrypoint
    ├── css/                   # Modular design system
    │   ├── main.css           # Aggregate entrypoint with @import
    │   ├── tokens.css         # Color palette, spacing, typography variables
    │   ├── base.css           # Reset, layout frame, scrollbars
    │   ├── components/        # Component-scoped CSS (cards, drawer, modals, hud)
    │   └── views/             # View-specific CSS (kanban, swimlanes, docs, fleet)
    └── src/                   # ESM Web Application
        ├── index.js           # Bootstrap & dependency wiring
        ├── store/             # Unidirectional state container
        │   ├── actions.js     # User & network intent definitions
        │   ├── reducers.js    # Pure deterministic state transformers
        │   └── store.js       # Centralized observable store
        ├── api/               # API clients
        │   ├── client.js      # REST API client with error handling
        │   └── sse.js         # Auto-reconnecting SSE event listener with heartbeat
        ├── components/        # Reusable UI widgets (Drawer, Modal, HUD, Toast)
        └── views/             # Pluggable View modules
            ├── registry.js    # View registration & switcher lifecycle
            ├── fleetView.js   # Multi-agent fleet card grid
            ├── kanbanView.js  # Standard status column board
            ├── swimlanesView.js# Stage & Design Doc grouped swimlanes
            └── docsView.js    # Design doc catalog & Markdown reader
```

---

## 4. Execution Roadmap (Milestones)

- [x] **Milestone 1**: Author design doc #d-6 and register tasks on the Project Board (Gate: 🔴 RED).
- [x] **Milestone 2**: Execute Tri-Model Audit (3.8 High Architectural, 3.7 High API/Security, 3.6 High Code/Function).
- [x] **Milestone 3**: Decompose Backend `server.mjs` into `api/middleware/`, `api/routes/`, and `api/services/` with unified `/api/v1/` routing.
- [x] **Milestone 4**: Deconstruct `app.css` into `tokens.css`, `components/`, and `views/` CSS modules.
- [x] **Milestone 5**: Modularize `app.js` into ESM `ui/src/` (Store, ViewRegistry, Kanban, Swimlanes, Fleet, Drawer, Docs).
- [x] **Milestone 6**: End-to-end verification via Chrome DevTools MCP and `npm test` (all 14 test suites green).

---

## 5. Phase 2: Deep Modular Refactor & Multi-Layer Decomposition

### 5.1 Tri-Model Codebase Review Findings

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                            TRI-MODEL CODEBASE REVIEW (PHASE 2)                              │
├──────────────────────────┬──────────────────────────────┬───────────────────────────────────┤
│   Gemini 3.8 Flash High  │    Gemini 3.7 Flash High     │       Gemini 3.6 Flash High       │
│    Architectural View    │      Contracts & State       │        Code Health & Size         │
├──────────────────────────┼──────────────────────────────┼───────────────────────────────────┤
│ - 1,391-line index.js    │ - Auth gate token contract   │ - index.js decomposition          │
│   violates single-resp.  │   blocks local browser UI    │   (7 modules < 300 lines)         │
│ - 10-arg handler in      │ - Strict 4-column invariant  │ - Replace synchronous             │
│   routes/docs.mjs        │   (legacy 'planned' mapping) │   fs.readdirSync in routes        │
│ - Unidirectional event   │ - Zero-closing rule on       │ - Pre-index Map<slug, doc>        │
│   delegation decoupling  │   design doc state machine   │   for O(1) card rendering         │
│ - Router & State Sync    │ - SSE heartbeat & payload    │ - Swimlanes view decomposition    │
│   boundary separation    │   hash deduplication         │   into sub-renderers              │
└──────────────────────────┴──────────────────────────────┴───────────────────────────────────┘
```

1. **Gemini 3.8 Flash High (Architectural & Boundary Layer)**:
   - Slicing `components/board/ui/src/index.js` (1,391 lines) into dedicated architectural modules:
     - `store/selectors.js`: Pure data filtering and aggregation.
     - `components/hud.js`: Top HUD metrics.
     - `components/filterBar.js`: Toolbar controls, segmented controls, custom dropdowns.
     - `components/switcher.js`: Agent & project workspace switchers.
     - `views/router.js`: URL hash routing and viewport visibility.
     - `events/delegation.js`: Centralized event delegator separating DOM events from logic.
     - `api/sync.js`: Board state synchronization and change detection.
     - `index.js`: Minimal bootstrap entrypoint (~60 lines).
   - Backend Server Services: Bundle `server.mjs` dependency arguments into a unified `AppContext`.

2. **Gemini 3.7 Flash High (Contracts, Security & State Invariants)**:
   - Provide seamless local loopback authorization so browser dashboard can toggle gates without manual token copy.
   - Enforce the 4-column board invariant across all views: `TO-DO` -> `IN PROGRESS` -> `IN REVIEW` -> `DONE`.
   - Maintain the strict non-closing invariant: Design doc status transitions are strictly `Open & Active` $\leftrightarrow$ `Open & Inactive`.

3. **Gemini 3.6 Flash High (Code Health, Decomposition & Performance)**:
   - Migrate all remaining synchronous filesystem calls (`fs.readdirSync`, `fs.readFileSync`) in `routes/docs.mjs` to `fs.promises`.
   - Pre-index design docs in selectors to avoid $O(N \cdot M)$ card rendering lookups.
   - Modularize `swimlanesView.js` into sub-renderers.

- [x] **Milestone 7**: Frontend UI Layer Decomposition (`selectors.js`, `hud.js`, `filterBar.js`, `switcher.js`, `router.js`, `delegation.js`, `sync.js`, and `index.js`).
- [x] **Milestone 8**: Backend Server & Service Layer Decoupling (async fs in `routes/docs.mjs`, unified `AppContext`, loopback session auth for browser UI).
- [x] **Milestone 9**: View Component Decomposition (extract sub-components in `swimlanesView.js`, optimize card document lookups).
- [x] **Milestone 10**: End-to-End Verification & Gate Clearance (Tier 1/2/3 automated tests, Chrome MCP verification).

---

## 6. Phase 3: Core Engine, CLI Tools & CSS Modular Decomposition

### 6.1 Tri-Model Codebase Review Findings (Phase 3)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                            TRI-MODEL CODEBASE REVIEW (PHASE 3)                              │
├──────────────────────────┬──────────────────────────────┬───────────────────────────────────┤
│   Gemini 3.8 Flash High  │    Gemini 3.7 Flash High     │       Gemini 3.6 Flash High       │
│    Architectural Seams   │  Contracts & State Security  │     File Size & Slicing Plan      │
├──────────────────────────┼──────────────────────────────┼───────────────────────────────────┤
│ - hud.css (1,007 lines)  │ - Invalidate connection pool │ - Slice hud.css into 5 partials   │
│   collides 6 subdomains  │   in roster on project alloc │   (header, switchers, telemetry,  │
│ - fleet.mjs (649 lines)  │ - Eliminate silent fallback  │   controls, filters < 270 lines)  │
│   duplicates remote vs   │   in getBoard() / client     │ - Slice delegation.js (540 lines) │
│   local CLI handlers     │ - Strict validateProjectId() │   into 5 domain event modules     │
│ - delegation.js 540 lines│   and validateDocSlug() regex│ - Slice filterBar.js (434 lines)  │
│   fan-out imports 8 mods │ - Require safe integer id    │   into state & dropdown renderers │
│ - roster.mjs (518 lines) │   assertions on task routes  │ - Slice fleet.mjs into cli/remote/│
│   mixes store & pool     │ - Atomic roster file write   │   local modules under 250 lines   │
│ - board.mjs (483 lines)  │   mode: 0o600 for credential │ - Slice roster.mjs into agentStore│
│   embeds markdown parser │   protection                 │   auth, and boardFactory modules  │
└──────────────────────────┴──────────────────────────────┴───────────────────────────────────┘
```

1. **Gemini 3.8 Flash High (Architectural Seams & Topology)**:
   - **HUD Stylesheet Decomposition**: Slicing `components/board/ui/css/components/hud.css` (1,007 lines) into component-scoped partials (`hud-header.css`, `hud-switchers.css`, `hud-telemetry.css`, `hud-controls.css`, `hud-filter-bar.css`) linked by an `@import` index manifest.
   - **CLI Tool Decoupling**: Refactor `components/board/tools/fleet.mjs` (649 lines) and `board.mjs` (483 lines) from dual-mode script monoliths into thin executable wrappers delegating to dedicated sub-command modules (`fleet/remoteCommands.mjs`, `fleet/localCommands.mjs`, `board/taskCommands.mjs`, `board/docCommands.mjs`).
   - **Domain Event Separation**: Break `components/board/ui/src/events/delegation.js` (540 lines) into focused domain listeners (`filterEvents.js`, `navigationEvents.js`, `clickDelegation.js`, `overlayEvents.js`, `shortcutEvents.js`).

2. **Gemini 3.7 Flash High (Contracts, Security & State Invariants)**:
   - **Roster & Project Integrity**: Enforce strict `validateProjectId()` regex (`/^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/`). Invalidate cached `boardsPool` instances upon project allocation. Enforce file mode `0o600` on atomic roster writes.
   - **Eliminate Silent State Fallbacks**: Remove silent project fallbacks that risk writing to default boards or local SQLite instead of alerting the caller when remote server configuration is expected.
   - **Route Contract Hardening**: Enforce `Number.isSafeInteger(id)` and non-negative integer checklist index assertions.

3. **Gemini 3.6 Flash High (File Size & Slicing Plan)**:
   - Target invariant: Every source file capped strictly under 300 lines.
   - Decomposition targets:
     - `components/board/ui/css/components/hud.css` (1,007 lines $\rightarrow$ 5 sub-files < 270 lines).
     - `components/board/tools/fleet.mjs` (649 lines $\rightarrow$ `fleet/cli.mjs`, `fleet/remoteCommands.mjs`, `fleet/localCommands.mjs`, `fleet.mjs` < 250 lines).
     - `components/board/ui/src/events/delegation.js` (540 lines $\rightarrow$ 5 listener sub-files < 160 lines).
     - `components/board/engine/roster.mjs` (518 lines $\rightarrow$ `roster/agentStore.mjs`, `roster/auth.mjs`, `roster/boardFactory.mjs`, `roster.mjs` < 180 lines).
     - `components/board/tools/board.mjs` (483 lines $\rightarrow$ `board/cli.mjs`, `board/taskCommands.mjs`, `board/docCommands.mjs`, `board/reportCommands.mjs`, `board.mjs` < 180 lines).
     - `components/board/ui/src/components/filterBar.js` (434 lines $\rightarrow$ `filterState.js`, `docDropdownRenderer.js`, `trackLifecycleRenderer.js`, `filterBar.js` < 150 lines).

### 6.2 Phase 3 Execution Milestones

- [x] **Milestone 11**: HUD CSS Monolith Modularization (Slice `hud.css` into 5 partials linked by an `@import` index).
- [x] **Milestone 12**: UI Event Delegation Modularization (Slice `delegation.js` into domain listener modules).
- [x] **Milestone 13**: FilterBar UI Decomposition (Slice `filterBar.js` into state, doc dropdown, and track/lifecycle modules).
- [x] **Milestone 14**: Fleet & Board CLI Modernization (Slice `fleet.mjs` and `board.mjs` into modular command handlers).
- [x] **Milestone 15**: Roster Core Engine Decomposition (Slice `roster.mjs` into `agentStore.mjs`, `auth.mjs`, `boardFactory.mjs`, with facade).
- [x] **Milestone 16**: End-to-End Quality Verification (14/14 test suites, Chrome DevTools MCP, CLI automation).

---

## 7. Phase 4: Tri-Wave Review Hardening (Code Review, Functions & Style)

A dedicated, comprehensive 3-wave audit was executed across the codebase with focused mandates:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    TRI-WAVE CODE REVIEW & CRAFTSMANSHIP SYNTHESIS                           │
├──────────────────────────┬──────────────────────────────┬───────────────────────────────────┤
│   Gemini 3.8 Flash High  │    Gemini 3.7 Flash High     │       Gemini 3.6 Flash High       │
│     Pillar 1: Code Review│     Pillar 2: Functions      │       Pillar 3: Style & Idioms    │
├──────────────────────────┼──────────────────────────────┼───────────────────────────────────┤
│ - Enforce tenant access  │ - Unify createAgentStore     │ - Modernize nullish coalescing    │
│   in POST /tasks, toggle,│   options signature          │   (??) & optional chaining (?.)   │
│   and POST /docs/sync    │ - Add options bag to         │ - Complete JSDoc @param/@returns/ │
│ - Fix RangeError in      │   registerAgent              │   @throws across all modules      │
│   timingSafeCompare(0)   │ - Extract pure stat reducers │ - Replace global isNaN with       │
│ - Throw ProjectNotFound  │   in listAgents              │   Number.isNaN                    │
│   in getBoard()          │ - Predictable return shape   │ - Simplify closeAllDropdowns      │
│ - Sync SQLite board on   │   in authenticateRequest     │ - Status transition map for       │
│   doc status route       │ - Unify candidate path search│   card quick action buttons       │
│ - Fix PATCH 404 guard    │   in docCommands             │ - Eliminate dead destructuring    │
└──────────────────────────┴──────────────────────────────┴───────────────────────────────────┘
```

### 7.1 Detailed Synthesis by Pillar

1. **Pillar 1: Code Review (Correctness, Invariants & Edge Cases — Gemini 3.8 Flash High)**:
   - **Tenant Authorization Guards**: Enforce `ctx.checkTenantAccess(targetAgent)` across mutation routes (`POST /api/v1/tasks`, `POST /api/v1/tasks/:id/toggle-checklist`, `POST /api/v1/docs/sync`).
   - **Timing-Safe Buffer Comparison**: Fix `timingSafeCompare` in `auth.mjs` where `crypto.timingSafeEqual` throws an unhandled `RangeError` if either buffer length is 0.
   - **No Silent Project Fallback**: In `boardFactory.mjs`, when `projectId` is specified but does not exist in `agent.projects`, throw an explicit `ProjectNotFoundError` (404) rather than silently mutating `agent.projects[0]`.
   - **Markdown-SQLite Desync Fix**: In `routes/docs.mjs`, invoke `board.closeDesignDoc(slug)` and `board.reopenDesignDoc(slug)` so SQLite task counts and gates stay in sync with markdown frontmatter.
   - **PATCH 404 Guard**: In `routes/board.mjs`, verify `updated !== null` before broadcasting changes or responding with 200.

2. **Pillar 2: Functions (Design, Purity, Signatures & SRP — Gemini 3.7 Flash High)**:
   - **Options Objects vs Positional Arguments**: Standardize `createAgentStore({ ...options, boardsDir })` and `registerAgent(config, { autoGenerateToken } = {})`.
   - **Pure Stat Calculations**: Separate data calculation from I/O in `listAgents()` by extracting pure `calculateProjectStats()` and `aggregateAgentProjects()`.
   - **Predictable Return Contracts**: Ensure `authenticateRequest()` always returns `{ authenticated, isOperator, agentId, agent, error: null }` on success paths.
   - **Shared Doc Frontmatter & File Resolution**: Consolidate repeated 6-candidate file path search and regex replacement loops in `docCommands.mjs` into shared utilities.

3. **Pillar 3: Style (Modern ES, JSDoc & Consistency — Gemini 3.6 Flash High)**:
   - **Idiom Modernization**: Replace `||` with `??` where appropriate, use `Number.isNaN()`, and iterate directly over `boardsPool.keys()`.
   - **JSDoc Completeness**: Add complete JSDoc blocks across `agentStore.mjs`, `boardFactory.mjs`, `roster.mjs`, `auth.mjs`, and `taskCommands.mjs`.
   - **UI Simplification**: Modernize `closeAllDropdowns()` with optional chaining and replace nested ternary operators with clear transition lookup maps in `clickDelegation.js`.

### 7.2 Phase 4 Execution Milestones

- [x] **Milestone 17**: Code Review & Security Hardening (Tenant guards, timingSafeCompare fix, ProjectNotFoundError, SQLite doc sync).
- [x] **Milestone 18**: Function Craftsmanship & Signature Modernization (Options signatures, pure stat reduction, predictable return contracts).
- [x] **Milestone 19**: Style, Idiom & JSDoc Standardization (Nullish coalescing, JSDoc annotations, clean event delegation maps).
- [x] **Milestone 20**: Regression Testing & Live Gate Clearance (14/14 test suites, Chrome MCP interactive flow, fleet status verification).


