# W-032: Global Multi-Project worca-ui

**Status:** Draft
**Priority:** P2
**Type:** Feature / Architecture
**Subsumes:** W-017 (multi-project support), W-030 (parallel pipeline execution)

---

## 1. Goal

Replace per-project worca-ui server instances with a **single global worca-ui** that monitors all registered projects and all their parallel pipelines from one browser tab. Support a three-level hierarchy: projects → pipelines → stages.

---

## 2. Architecture Overview

```
~/.worca/
  config.json              — global settings (maxProjects, etc.)
  worca-ui-global.pid      — PID file for global server
  projects.d/              — one JSON file per registered project
    worca-cc.json
    my-api.json

Global Server (port 3400)
  ├─ ProjectRegistry         — scans projects.d/, watches for add/remove
  ├─ WatcherSet per project  — status, logs, beads, events watchers
  │    ├─ Main run watchers
  │    └─ Worktree pipeline sub-watchers (from multi/registry.json)
  ├─ ProcessManager          — Map<project, ProcessState>
  ├─ Express API             — /api/projects/:id/... scoped endpoints
  └─ WebSocket               — project-scoped subscriptions

Client (single browser tab)
  ├─ #/dashboard             — cross-project overview
  ├─ #/project/{slug}/active — project's active runs
  ├─ #/project/{slug}/beads  — project's beads
  └─ Sidebar project picker  — with status badges
```

**Data flow:** Pipelines write to their local `.worca/` directories as always. The global server discovers projects from `~/.worca/projects.d/`, sets up file watchers per project, and streams data to the browser via WebSocket. No pipeline code changes required for basic monitoring.

---

## 3. Design Decisions

Each decision documents the choice, rationale, alternatives considered, and impact.

### D1: Data Mechanism — File-Watching Only

**Choice:** File-watching is the sole data mechanism. No webhook auto-injection.

**Rationale:** File-watching provides complete data access (logs, events, beads, settings, costs) with zero per-project configuration. The per-project server already uses this mechanism successfully. Adding webhooks for auto-injection introduces complexity (lifecycle management, cleanup on deregistration, settings mutation) for marginal latency improvement (75ms → 5ms) that is imperceptible in pipeline monitoring UX.

**Webhooks as optional hints:** Projects that want sub-10ms updates can manually configure webhooks in their `settings.local.json`. The server provides a `POST /api/projects/inbox` endpoint that triggers an immediate refresh (bypasses 75ms debounce). This is entirely opt-in and zero-configuration by default.

**Tradeoff:** 75ms latency on status updates vs zero configuration burden. Acceptable because pipeline stages last minutes, not milliseconds.

**Impact:** Simplifies Phases 0-3 significantly. Webhook endpoint is Phase 5 (optional).

### D2: Project Registry — Directory-Based (`~/.worca/projects.d/`)

**Choice:** One JSON file per project in `~/.worca/projects.d/` instead of a single `projects.json`.

**Rationale:** Eliminates race conditions when multiple pipelines self-register simultaneously. Each pipeline writes its own file atomically via `tempfile.mkstemp()` + `os.rename()`. No file locking needed.

**Alternative considered:** Single `projects.json` (W-017 design). Requires file locking or last-writer-wins semantics when two pipelines register at the same time.

**Format:**
```
~/.worca/projects.d/
  worca-cc.json → { "name": "worca-cc", "path": "/dev/worca-cc" }
  my-api.json   → { "name": "my-api", "path": "/dev/my-api" }
```

**Rules:**
- `name` — URL-safe slug (`/^[a-z0-9_-]{1,64}$/i`), unique, used in URLs and WS messages
- `path` — absolute path to project root; server derives `{path}/.worca` as worcaDir
- Filename matches project name: `{name}.json`
- Default limit: 20 projects, configurable via `~/.worca/config.json` (`{ "maxProjects": 20 }`)

**Server-side:** `project-registry.js` scans `projects.d/` to assemble project list. Watches directory for add/remove events. If `projects.d/` doesn't exist and not in `--global` mode, synthesizes a single project from `process.cwd()` (backwards compatible).

**Pipeline-side:** New `worca/utils/project_registry.py` with `auto_register_project(project_path)` called at pipeline start.

**Impact:** Different registry format from W-017. Server watches a directory instead of a file. CLI commands write individual files instead of rewriting a single JSON.

### D3: ws.js Decomposition — 7 Focused Modules

**Choice:** Decompose `server/ws.js` (~1,385 lines, 12 concerns) into 7 focused modules before adding multi-project support.

**Rationale:** Adding multi-project watchers to a 1,385-line monolith would be unmaintainable. Each extracted module has a single responsibility and can be tested independently. The decomposition is a pure refactor — all existing tests must pass unchanged.

| New Module | Responsibility |
|-----------|---------------|
| `server/ws-client-manager.js` | Client subscriptions, heartbeat, WeakMap tracking |
| `server/ws-broadcaster.js` | Message broadcasting, subscription-filtered delivery |
| `server/ws-status-watcher.js` | Status/active-run file watching, debounced refresh |
| `server/ws-log-watcher.js` | Log file/stage/iteration watching, line counting |
| `server/ws-beads-watcher.js` | Beads DB watching, debounced refresh |
| `server/ws-event-watcher.js` | events.jsonl subscription management |
| `server/ws-message-router.js` | Message dispatch (23 handlers) |

`ws.js` becomes an orchestrator (~100 lines) that imports and wires these modules.

**Rollback strategy:** `ws.js` retains a facade with `WORCA_WS_MODULES=0` kill switch to fall back to the original monolithic code path during validation (see §9b). Legacy path deleted once Phase 0 verification passes.

**Impact:** Prerequisite for Phase 1. Pure refactor — no behavior change.

### D4: State Management — Nested Project-Scoped Structure

**Choice:** Full rewrite of `app/state.js` to nested project-scoped structure.

```javascript
{
  activeProject: "project-name",
  projects: {
    [name]: {
      runs: { [id]: runObj },
      logLines: [],
      beads: { issues: [], dbExists: false, loading: false },
    }
  },
  preferences: { theme, sidebarCollapsed, notifications }  // GLOBAL
}
```

**Alternative considered (W-017):** Keep flat `runs` map, add `projectRuns` alongside as derived view. Rejected because it creates two competing state representations and every view must decide which to read.

**Tradeoff:** Higher migration cost (~23 files) but cleaner long-term architecture. All views access state through accessors consistently.

**Migration strategy:** Introduce `app/state-accessors.js` with fallback to old flat shape (see §9a). Views migrated one file at a time — each commit independently safe and revertable. Eliminates big-bang risk.

**Impact:** All view components that call `store.getState()` must be updated to use accessors. Preferences remain global (one user, one theme).

### D5: REST API — Project-Scoped URL Prefix

**Choice:** `/api/projects/:projectId/...` prefix for all project-scoped endpoints.

```
Project-scoped:
  /api/projects/:projectId/runs
  /api/projects/:projectId/runs/:id/status
  /api/projects/:projectId/settings
  /api/projects/:projectId/beads/issues
  /api/projects/:projectId/costs
  /api/projects/:projectId/branches
  /api/projects/:projectId/plan-files
  /api/projects/:projectId/project-info

Global:
  GET  /api/projects              — list registered projects
  POST /api/projects              — register new project
  DELETE /api/projects/:projectId — unregister project
  POST /api/projects/inbox        — webhook hints (Phase 5)
```

**Implementation:** Express sub-router with `projectResolver` middleware that validates `:projectId` and injects `req.project = { worcaDir, projectRoot, settingsPath }`.

**Impact:** All existing API endpoints move under the project prefix. Client `fetch()` calls updated. Per-project mode uses a synthetic project ID (slugified cwd).

### D6: URL Routing — Project Required in Global Mode

**Choice:** Always require project in URL for global mode. No "first project" fallback.

```
Global mode:
  #/dashboard                          — cross-project overview
  #/project/{slug}/active              — project's active runs
  #/project/{slug}/history             — project's run history
  #/project/{slug}/active?run={id}     — specific run detail
  #/project/{slug}/settings            — project settings
  #/project/{slug}/beads               — project beads

Per-project mode (unchanged):
  #/active, #/history                  — no project prefix needed
```

**Legacy URL handling:** `#/active` or `#/history` in global mode → redirect to `#/dashboard`. No ambiguous "first project" resolution.

**Tradeoff:** Breaking change for any external tools that link to `#/active` on a global server. Acceptable because global mode is entirely new.

### D7: Port Strategy

**Choice:** Global server uses port 3400 exclusively. Fails to start if occupied. Per-project servers auto-find available ports via existing `findAvailablePort()`.

**Extended PID file format:** `{ pid, port, host, mode: "global"|"per-project", projectPath, started_at }`. On port conflict, the error message reads the PID file and explains what's running.

**Impact:** Global server always at `http://localhost:3400`. Predictable, bookmarkable.

### D8: Process Manager — Class with Map

**Choice:** Replace `process-manager.js` module-level state with a `ProcessManager` class.

```javascript
class ProcessManager {
  constructor(projectRegistry) {
    this.registry = projectRegistry;
    this.processes = new Map(); // projectName → { pid, worcaDir, startTime }
  }
  startPipeline(projectName, opts) { ... }
  stopPipeline(projectName) { ... }  // PID file only, NO pgrep
  pausePipeline(projectName, runId) { ... }
  restartStage(projectName, stageKey, opts) { ... }
}
```

**Critical:** Remove the `pgrep -f run_pipeline.py` fallback that could kill the wrong project's pipeline. PID file is the sole source of truth.

**Impact:** Breaking change to process-manager API. All callers updated in the same phase.

### D9: Watcher Lifecycle — WatcherSet Class

**Choice:** Per-project `WatcherSet` class manages all file watchers for one project.

```javascript
class WatcherSet {
  constructor(projectId, worcaDir) { ... }
  create()    // status, activeRun, beads, log, event watchers
  destroy()   // close all watchers, clear timers, set closed=true
  isAlive()   // !closed && existsSync(worcaDir)
}
```

Global server manages `Map<projectName, WatcherSet>`. On project add/remove, create/destroy the set.

**Watcher budget:** Log at startup: `20 projects × 19 watchers = 380 (4.6% of Linux inotify limit)`. Warn at 60%, refuse above 100% with actionable sysctl command.

**Shutdown cleanup:** `process.on('SIGTERM', cleanup)` and `process.on('exit', cleanup)` to prevent orphaned watchers.

**Activity-based tiering:**

| Tier | Criteria | Resources |
|------|----------|-----------|
| Full | User viewing in UI OR pipeline running | All watchers, log tailing, beads polling, 75ms debounce |
| Polling | Registered but inactive | Status watcher only, 5s debounce, no log/beads watchers |

Projects start in Polling. Promote to Full on WS subscription. Demote when no clients and no active pipeline.

### D10: Pipeline Isolation — Git Worktrees

**Choice:** Parallel pipelines within a project use git worktrees for full isolation (from W-030).

Each parallel pipeline gets:
- Its own git worktree (`.worktrees/pipeline-{run_id}/`)
- Its own `.worca/` state directory
- Its own `.beads/` database (via `bd init` in worktree)
- Its own branch (`worca/{slug}-{run_id}`)
- Its own OS process (separate PID, environ, module globals)

**Run ID format:** `YYYYMMDD-HHMMSS-{ms}-{hex4}` (e.g., `20260323-143052-847-a1b2`). Millisecond precision + random suffix eliminates collision risk.

**Sequenced plan files:** Generated plans go to `{run_dir}/plan-{NNN}.md` instead of `MASTER_PLAN.md` at project root. Pre-made plans (`--plan`, `--spec`) remain at their original location (read-only input).

**Base branch:** `--base-branch main` (default for `run_multi.py`) for independent features. `--base-branch HEAD` for iterative work. Single-pipeline `run_pipeline.py` retains current behavior (branch from HEAD).

**Cumulative stats:** Each pipeline writes per-run stats to its worktree. `run_multi.py` orchestrator merges into main tree's `cumulative.json` sequentially after each worker exits (single writer, no locking needed).

**Test gate:** Strike state persisted to `{run_dir}/test_gate_strikes.json` instead of in-memory `_state` dict (survives across subprocess invocations, naturally isolated per worktree).

### D11: Pipeline Registry (Parallel Runs)

**Choice:** `.worca/multi/pipelines.d/` in the main working tree, with one JSON file per active worktree pipeline. Mirrors the directory-based pattern from D2.

```
.worca/multi/pipelines.d/
  20260323-143052-847-a1b2.json → {
    "run_id": "20260323-143052-847-a1b2",
    "request": "Add user auth",
    "worktree_path": "/abs/path/.worktrees/pipeline-20260323-143052-847-a1b2",
    "branch": "worca/add-user-auth-20260323-143052-847-a1b2",
    "base_branch": "main",
    "status": "running",
    "pid": 12345,
    "started_at": "2026-03-23T14:30:52Z",
    "completed_at": null,
    "pr_url": null
  }
```

Each pipeline writes its own file atomically via temp+rename. No file locking needed (see §9d). Stale entries reconciled on startup by checking PID liveness. The watcher scans the directory; `run_multi.py` reads all files to build a combined view.

### D12: Notification System — Phased

**Phase 1 (with multi-project):** Add project name to desktop notification titles. Only `run_failed` and `approval_needed` trigger desktop notifications. Click navigates to `#/project/{slug}/active?run={id}`.

**Phase 2 (with global mode):** Sidebar status badges per project — green (idle), orange (running), red (error), yellow (approval needed).

**Phase 3 (if needed at scale):** Global notification feed panel.

### D13: Binary Distribution

**Accept status quo for Phases 0-4.** Run global mode from one project's `.claude/worca-ui/` copy: `cd /path/to/any-project && worca-ui start --global`.

**Phase 6 (later):** Extract to standalone `@worca/ui` npm package with own release cycle.

---

## 4. Isolation Contract

Every artifact the pipeline touches falls into one of three categories:

| Artifact | Scope | Mechanism | Notes |
|---|---|---|---|
| `.worca/runs/{run_id}/` | **Isolated** | Worktree `cwd` | Pipeline state, logs, events |
| `.worca/runs/{run_id}/plan-{NNN}.md` | **Isolated** | Worktree `cwd` | Sequenced generated plans |
| `.worca/active_run` | **Isolated** | Worktree `cwd` | Per-worktree pointer |
| `.worca/pipeline.pid` | **Isolated** | Worktree `cwd` | Per-process lock |
| `.beads/` | **Isolated** | `bd init` per worktree | In-flight task coordination |
| `test-results/` | **Isolated** | Worktree `cwd` | Test runner output |
| `docs/plans/*.md` (pre-made) | **Shared (read-only)** | Git branch copy | Input specs |
| `.claude/settings.json` | **Shared (read-only)** | Git branch copy | Not mutated at runtime |
| `CLAUDE.md` | **Shared (read-only)** | Git branch copy | Not mutated at runtime |
| `.worca/multi/registry.json` | **Shared (read-write)** | File locking + atomic writes | Cross-pipeline coordination |
| `.worca/stats/cumulative.json` | **Shared (single-writer)** | Orchestrator merges after worker exit | No concurrent writes |
| Git object store | **Shared** | Git worktree design | Shared by all worktrees (feature) |

---

## 5. WebSocket Protocol

Single `/ws` connection serves all projects. The server fills `project` on every outbound event.

### Connection Handshake (§9c)

On connect, server sends `hello` with protocol version and capabilities. Client responds with `hello-ack`. Clients that don't respond within 2s are treated as protocol 1 (legacy). See §9c for full negotiation rules.

### Outbound (server → client)

**`runs-list`** — one per project on connect and on file-system change:
```json
{ "type": "runs-list", "payload": { "project": "worca-cc", "runs": [...], "settings": {...} } }
```

**`run-snapshot`**, **`run-update`** — extended with `project`:
```json
{ "type": "run-snapshot", "payload": { "project": "worca-cc", "id": "abc123", ... } }
```

**`projects-updated`** — broadcast after project add/remove:
```json
{ "type": "projects-updated", "payload": { "projects": [...] } }
```

**`pipeline-status-changed`** — broadcast on any parallel pipeline state change:
```json
{ "type": "pipeline-status-changed", "payload": { "project": "worca-cc", "runId": "...", "status": "running", "stage": "IMPLEMENT" } }
```

### Inbound (client → server)

All existing messages (`list-runs`, `subscribe-run`, `subscribe-log`, `stop-run`, `resume-run`, `get-agent-prompt`) gain a required `project` field.

New messages:
- `list-pipelines { project }` → returns parallel pipeline registry for that project
- `subscribe-pipeline { project, runId }` → subscribe to a worktree pipeline's events

**Backward compat:** Messages without `project` default to the first project (per-project mode always has exactly one).

---

## 6. Backwards Compatibility

| Scenario | Behavior |
|----------|----------|
| No `projects.d/` + `worca-ui start` | Unchanged. Synthesizes single project from cwd. |
| `projects.d/` exists + `worca-ui start` | Per-project mode ignores registry, monitors own project only. |
| `worca-ui start --global` with no `projects.d/` | Creates empty `projects.d/`, shows "Add Project" in UI. |
| `worca-ui start --global` with `projects.d/` | Monitors all registered projects. |
| Legacy URL `#/active` in global mode | Redirects to `#/dashboard`. |
| Legacy URL `#/active` in per-project mode | Works as today. |
| WS messages without `project` field | Default to first/only project (protocol 1 via §9c handshake). |
| `run_pipeline.py` unchanged | Writes to local `.worca/`. Global server discovers via watchers. |
| Old run IDs (`YYYYMMDD-HHMMSS`) | Still parsed correctly. New format adds fields but regex is compatible. |

---

## 7. Implementation Phases

Each phase is self-contained and shippable. Verification criteria must pass before proceeding.

### Phase 0: Foundation Refactoring

**Goal:** Prepare the codebase for multi-project without changing behavior. All existing tests must pass unchanged.

**Tasks:**

0.1. **Decompose `server/ws.js`** into 7 modules (see D3). `ws.js` becomes a ~100-line orchestrator. Pure extraction — no logic changes.

0.2. **Refactor `server/process-manager.js`** to `ProcessManager` class (see D8). Remove `pgrep` fallback. All callers pass project name.

0.3. **Add `schema_version` field to status.json** writes in `status.py`. Server tolerates missing field for old runs.

**Verification:**
- All existing vitest tests pass
- All existing Playwright e2e tests pass
- Server starts and monitors a single project identically to before
- `stopPipeline()` works via PID file (manually verify pgrep removal doesn't break single-project)

**Files changed:**
| File | Change |
|------|--------|
| `server/ws.js` | Extract to 7 modules, become orchestrator |
| `server/ws-client-manager.js` | New — client subscriptions, heartbeat |
| `server/ws-broadcaster.js` | New — broadcast logic |
| `server/ws-status-watcher.js` | New — status file watching |
| `server/ws-log-watcher.js` | New — log tailing |
| `server/ws-beads-watcher.js` | New — beads watching |
| `server/ws-event-watcher.js` | New — events.jsonl |
| `server/ws-message-router.js` | New — message dispatch |
| `server/process-manager.js` | Refactor to class |
| `worca/state/status.py` | Add schema_version |

---

### Phase 1: Multi-Project Core

**Goal:** Register multiple projects, monitor each independently, switch between them in the UI. This is the first user-visible feature.

Phase 1 is split into three independently shippable sub-phases to reduce big-bang risk (see §9a, §9b).

#### Phase 1a: Server-Side Multi-Project

Server gains multi-project support. UI remains single-project — the server picks the active project from the first registered entry. WS protocol versioning (§9c) is added here.

**Tasks:**

1.1. **Create `server/project-registry.js`** — read/write `~/.worca/projects.d/`, validate slugs, synthesize default for per-project mode. Exports: `readProjects(prefsDir)`, `writeProjects(prefsDir, projects)`, `validateProjectEntry()`, `slugify()`.

1.2. **Create `WatcherSet` class** (see D9) — encapsulates all file watchers for one project. `create()`, `destroy()`, `isAlive()`. Watcher budget calculation on startup. Wrap all callbacks in try/catch for per-project error isolation.

1.3. **Wire multi-project into ws.js orchestrator** — `Map<projectName, WatcherSet>`. `setupProjectWatchers()` per project. `scheduleRefresh(projectName)` scoped. All outbound messages include `project` field.

1.4. **Update REST API** with project-scoped prefix (see D5) — `projectResolver` middleware. Move all existing endpoints under `/api/projects/:projectId/...`. Add `GET/POST/DELETE /api/projects`.

1.5. **WS protocol handshake** (§9c) — server sends `hello` with `protocol: 2` and `capabilities` on connect. Clients without `hello-ack` within 2s treated as protocol 1. Protocol 1 clients auto-scoped to first project.

**Verification (1a):**
- All existing vitest + Playwright tests pass (server behavior unchanged for single project)
- `curl /api/projects` returns list with synthesized single project
- `curl /api/projects/foo/runs` returns run data
- WS connection receives `hello` message; old clients still work via timeout fallback

#### Phase 1b: State + Routing Migration

State management migrated to nested structure via accessor layer. Router gains project support. Views updated incrementally — one commit per file.

**Tasks:**

1.6. **Add `app/state-accessors.js`** (§9a) — thin accessor functions with fallback to old flat shape. `getRuns()`, `getLogLines()`, `getBeads()`, `getPreferences()`.

1.7. **Rewrite `app/state.js`** to nested project-scoped structure (see D4). Add `setProjectRuns()`, `setActiveProject()`, `setProjects()`. Accessors still fall back to old shape until all views are migrated.

1.8. **Update `app/router.js`** — three-argument `parseHash/buildHash/navigate` supporting `#/project/{slug}/...` (see D6).

1.9. **Update `app/main.js`** — project switching, project-scoped WS subscriptions, `handleSwitchProject()`, `handleAddProject()`. Fetch `/api/projects` at startup. Include `project` in all WS messages. Send `hello-ack` on connect.

1.10. **Update all remaining views** — migrate each view to use `state-accessors.js`. One commit per file, each independently revertable.

**Verification (1b):**
- Navigating to `#/project/foo/active` shows correct data
- `#/active` still works in single-project mode
- No visual regressions — each view renders identically to before
- All vitest + Playwright tests pass (updated for accessor usage)

#### Phase 1c: New UI Surfaces

Pure additive UI — sidebar picker, dashboard, dialogs. Nothing breaks if this sub-phase is delayed; project switching still works via URL from 1b.

**Tasks:**

1.11. **Add sidebar project picker** (`app/views/sidebar.js`) — shown when >1 project registered. Per-project active run count badge.

1.12. **Add aggregated dashboard** (`app/views/dashboard.js`) — one card per project when `activeProject` is null. Click switches to that project.

1.13. **Add project dialog** (`app/views/add-project-dialog.js`) — name + path fields, validation, calls `POST /api/projects`.

1.14. **Add Projects tab to Settings** (`app/views/settings.js`) — list projects, remove button, add button.

1.15. **Add CSS** for project picker, project cards, add-project dialog.

1.16. **Enhanced notifications** (D12 Phase 1) — project name in notification title.

1.17. **Rebuild frontend bundle.**

**Verification (1c — full Phase 1):**
- Start server with no `projects.d/` — behaves exactly as before (single project, no picker)
- Create `projects.d/` with 2 project files — picker appears, switching works
- Runs from project A are never visible when viewing project B
- Add/remove project via Settings — sidebar updates without page reload
- Two browser tabs — add project in one, both update via `projects-updated`
- `stop-run` and `resume-run` operate on correct project's worcaDir
- Legacy URLs redirect to `#/dashboard` in multi-project mode
- All vitest + Playwright tests pass

**New test files (across all Phase 1 sub-phases):**
- `server/project-registry.test.js` — registry CRUD, validation, slugify
- `test/multi-project-fixtures.js` — reusable temp directory fixture factory
- `test/multi-project-api.test.js` — project-scoped endpoints
- `test/multi-project-isolation.test.js` — cross-project data isolation
- `test/multi-project-websocket.test.js` — project-scoped subscriptions, protocol handshake
- `e2e/multi-project.spec.js` — browser-level project switching

---

### Phase 2: Global Mode + Control Center

**Goal:** Run worca-ui as a global service with CLI management and full pipeline control across projects.

**Tasks:**

2.1. **`--global` flag on `bin/worca-ui.js`** — skip `findProjectRoot()`, read from `projects.d/`, PID file at `~/.worca/worca-ui-global.pid`.

2.2. **Port strategy** (see D7) — global server claims 3400, fails if occupied with clear error. Extended PID file format.

2.3. **`worca-ui projects add/remove/list` CLI** — `projects add /path/to/project` writes to `projects.d/`, `projects remove name` deletes file, `projects list` scans directory.

2.4. **`worca-ui migrate` command** — discovers existing projects and registers them for global mode. `--scan <dirs>` walks directories (depth 2) looking for `.worca/` subdirs, shows summary table, writes to `projects.d/` on confirm. `--add <path>` registers a single project non-interactively. `--dry-run` shows what would be registered. `--status` reports migration health (missing paths, schema mismatches). On first `--global` launch with empty `projects.d/`, auto-detect `.worca/` in cwd and offer to register.

2.5. **Dynamic project registration** — global server watches `~/.worca/projects.d/` directory. On file add/remove, diff and create/destroy WatcherSets. Broadcast `projects-updated`.

2.6. **Pipeline self-registration** — new `worca/utils/project_registry.py` with `auto_register_project()`. Called from `runner.py` at pipeline start. Writes `{slug}.json` to `~/.worca/projects.d/` atomically.

2.7. **Full pipeline control** — `POST /api/projects/:id/runs` spawns `run_pipeline.py` with `cwd` set to that project. Start/stop/pause/resume via ProcessManager class.

2.8. **Sidebar status badges** (D12 Phase 2) — green/orange/red/yellow per project.

2.9. **Activity-based tiering** (see D9) — Polling tier for inactive projects, Full tier when subscribed.

**Verification:**
- `worca-ui start --global` with no `projects.d/` — starts, shows "Add Project"
- `worca-ui start --global` in a directory with `.worca/` and empty `projects.d/` — offers to register current project
- `worca-ui migrate --scan ~/dev --dry-run` — lists discovered projects without writing
- `worca-ui migrate --scan ~/dev` — registers discovered projects, all appear in UI
- `worca-ui migrate --status` — reports health of registered projects
- `worca-ui projects add /path/to/project` — project appears in UI without restart
- `worca-ui projects remove name` — project disappears from UI
- Start a pipeline from project A via UI — pipeline runs in project A's directory
- Stop pipeline from project B via UI — correct pipeline stops
- Start global server when port 3400 occupied — clear error message
- Pipeline starts in unregistered project → auto-registers → appears in global UI
- Sidebar shows correct status badges per project

---

### Phase 3: Parallel Pipelines (Python Core)

**Goal:** Run multiple independent pipelines simultaneously within a single project using git worktrees. No UI changes yet — CLI-only verification.

**Tasks:**

3.1. **Run ID uniqueness** — modify `_generate_run_id()` to include milliseconds + random suffix. Update `discoverRuns()` regex in `watcher.js`.

3.2. **Worktree lifecycle helpers** — extend `git.py` with `create_pipeline_worktree(run_id, slug, base_branch)`, `remove_pipeline_worktree(path)`, `list_pipeline_worktrees()`.

3.3. **Per-worktree beads init** — after worktree creation, run `bd init` in worktree directory.

3.4. **Pipeline registry module** — new `worca/orchestrator/registry.py` with `register_pipeline()`, `update_pipeline()`, `deregister_pipeline()`, `list_pipelines()`. Directory-based: one file per pipeline in `.worca/multi/pipelines.d/`, atomic writes via temp+rename, no file locking (see D11, §9d).

3.5. **`run_multi.py` entry point** — accepts multiple `--request` args, `--max-parallel` (default 3), `--base-branch` (default `main`), `--cleanup` (default `on-success`). Creates worktrees, inits beads, registers pipelines, dispatches via `ProcessPoolExecutor`. Merges per-run stats into cumulative after each worker exits.

3.6. **`run_pipeline.py` worktree mode** — add `--worktree` flag. Skip `create_branch()` (branch exists from worktree creation). Set `status["worktree"]`. Register completion in multi-pipeline registry.

3.7. **Sequenced plan files** — generated plans go to `{run_dir}/plan-{NNN}.md`. Update `runner.py` plan path resolution, `prompt_builder.py` hardcoded `MASTER_PLAN.md`, keep `guard.py` fallback for backward compat.

3.8. **Cumulative stats merge** — each pipeline writes per-run stats to worktree. `run_multi.py` merges sequentially into main tree's `cumulative.json`.

3.9. **Test gate persistence** — move strike state to `{run_dir}/test_gate_strikes.json`.

3.10. **Worktree cleanup policy** — `on-success` (default): remove on success, keep on failure. `always`: remove regardless. `never`: keep all.

3.11. **Stale registry reconciliation** — on `run_multi.py` startup, check all "running" entries, verify PID liveness, mark dead as "failed (stale)".

3.12. **CLI multi-status** — `worca.py multi-status` reads registry + each worktree's status.json, prints table. `--watch` for auto-refresh.

3.13. **CLI per-pipeline control** — extend `worca.py pause/stop/resume` with `--run-id` for targeting specific pipelines.

3.14. **Settings schema** — add `worca.parallel` section: `max_concurrent_pipelines`, `default_base_branch`, `cleanup_policy`, `worktree_base_dir`.

**Verification:**
- Launch 2 pipelines via `run_multi.py --request "A" --request "B"` — both run in separate worktrees
- Each worktree has its own `.worca/`, `.beads/`, branch
- `worca.py multi-status` shows both pipelines with correct stages
- Kill one pipeline — the other continues unaffected
- Cleanup removes worktree on success, preserves on failure
- `cumulative.json` contains stats from both (no data loss)
- Generated plan lands in `.worca/runs/{id}/plan-001.md`, not project root
- Run IDs never collide even with sub-second launches
- Stale registry entries are cleaned on next startup

**New test files:**
- `tests/test_registry.py` — registry CRUD, file locking, stale reconciliation
- `tests/test_run_id.py` — new format, uniqueness
- `tests/test_git_worktree.py` — worktree create/remove/list
- `tests/test_plan_file_location.py` — sequenced plans in run dir
- `tests/test_stats_merge.py` — per-run stats + orchestrator merge
- `tests/test_test_gate_persistence.py` — strike state across subprocess invocations
- `tests/test_multi_pipeline.py` — integration: 2 pipelines with `--dry-run`

---

### Phase 4: Parallel Pipeline UI + Three-Level Integration

**Goal:** Show parallel pipelines in the global UI, grouped under their parent project. Full three-level hierarchy: projects → pipelines → stages.

**Tasks:**

4.1. **Registry watcher** (`server/multi-watcher.js`) — watches `.worca/multi/pipelines.d/` directory per project. On file add/remove/change, diffs pipeline list, creates/destroys per-worktree WatcherSets.

4.2. **WebSocket protocol extension** — `list-pipelines`, `subscribe-pipeline`, `pipeline-status-changed` messages. Per-worktree watchers emit events with `project` + `runId`.

4.3. **Multi-pipeline dashboard** (`app/views/multi-dashboard.js`) — card grid of all running pipelines. Status badge, stage progress, elapsed time, quick actions. Click navigates to run detail.

4.4. **Launch panel** — "Launch Parallel" button. Multiple request inputs, base branch selector (from `GET /api/projects/:id/branches`), max parallel slider, cleanup selector. Calls `POST /api/projects/:id/multi-pipeline`.

4.5. **REST endpoint** — `POST /api/projects/:id/multi-pipeline` spawns `run_multi.py` in target project.

4.6. **Three-level rendering** — dashboard shows projects, each project expandable to show its parallel pipelines, each pipeline shows stage progress.

4.7. **Rebuild frontend bundle.**

**Verification:**
- Start 2 parallel pipelines in project A — both appear as cards under project A
- Start 1 pipeline in project B — appears separately under project B
- Click a pipeline card — navigates to run detail with correct log streaming
- Pause/stop a specific pipeline from the UI — correct pipeline affected
- Pipeline completes and is cleaned up — card moves to "completed" section
- Launch panel validates inputs and shows branch selector

---

### Phase 5: Webhook Hints (Optional)

**Goal:** Add optional webhook endpoint for sub-10ms status updates. Zero configuration required.

**Tasks:**

5.1. **`POST /api/projects/inbox`** endpoint — accepts webhook payloads, identifies project from `project_id` or `X-Worca-Project` header, triggers immediate refresh of that project's status (bypasses 75ms debounce).

5.2. **Graceful handling** — if project not found, log and ignore. If malformed payload, 400 response. No auto-injection into project files.

**Verification:**
- Send webhook to inbox — project status refreshes immediately
- No webhook configured — file-watching works as before
- Unknown project in webhook — logged, not crashed

---

### Phase 6: Standalone Package (Later)

- Extract to `@worca/ui` npm package
- `npm install -g @worca/ui && worca-ui start --global`
- Separate release cycle from worca-cc

---

## 8. Testing Strategy

### Test Doubles (API contract tests)

- `FakeProjectRegistry` — in-memory project list
- `FakeFileWatcher` — simulated file change events
- `FakeProcessManager` — tracks spawn calls without real processes
- Use for: endpoint scoping, state isolation, message routing

### Test Fixtures Factory (filesystem/WebSocket tests)

- `createMultiProjectFixture([{ name, runs, settings }])` — generates temp directory trees with populated `.worca/` dirs
- Matches existing `seedRun()` / `startServer()` patterns
- Use for: watcher behavior, log tailing, beads isolation, e2e flows

### Playwright

Maintain `--workers=1` constraint. Multi-project e2e tests are even more sensitive to parallel execution.

### Edge Cases

- Project path doesn't exist on disk — server skips gracefully, UI shows indicator
- Two projects have runs with same `run_id` — separated by project key, no collision
- `projects.d/` deleted while server running — server falls back to empty project list
- All projects removed — empty state, "Add Project" prompt
- Rapid project switching — each switch unsubscribes before new subscription
- Version mismatch between global server and project's worca-cc — server tolerates with `?.` chains

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| inotify limit on Linux with many projects | Watchers fail to create | Budget calculation at startup, warn at 60%, refuse at 100%, document sysctl fix. Benchmark real watcher counts with active pipelines (estimate of 19/project may be low). |
| API rate limits with parallel pipelines | Pipelines stall with 429 errors | Circuit breaker handles retries. Document impact. Default `max_concurrent_pipelines` = 3. |
| Disk space from worktrees | Large repos × N worktrees | Git worktrees share object store. Cleanup policy removes completed. |
| Registry file corruption on crash | Stale entries block new launches | Reconciliation on startup checks PID liveness. Atomic writes via temp+rename. |
| State migration breaks views | UI errors on update | Accessor layer (see §9a) allows incremental migration. Each file migrated in its own commit. |
| ws.js decomposition introduces bugs | Existing features break | Facade with kill switch (see §9b) preserves old code path during Phase 0. |
| Multiple pipelines self-registering simultaneously | Race condition on registry | Directory-based registry (D2) — each pipeline writes its own file atomically. |
| `flock` fragility for pipeline registry | Stale locks after crashes, no NFS support | Use per-pipeline status files (like D2 pattern) instead of single locked registry. See §9d. |
| PID file as sole truth after pgrep removal | Orphaned PID files from OOM/SIGKILL | ProcessManager checks PID liveness (`kill -0`) before trusting PID file. |
| No per-project error isolation | One bad `.worca/` crashes global server | WatcherSet wraps all callbacks in try/catch, emits degraded-project event. |
| No authentication on control API | Any local process can manipulate pipelines | Bind to 127.0.0.1 only (default). Document risk in global mode. |

### §9a: P0 — State Migration via Accessor Layer

Instead of rewriting all ~23 view files simultaneously, introduce a thin accessor module that decouples views from state shape:

```javascript
// app/state-accessors.js
export function getActiveProject(state) {
  return state.activeProject
    ? state.projects[state.activeProject]
    : state; // ← fallback: old flat shape still works
}
export function getRuns(state)     { return getActiveProject(state).runs; }
export function getLogLines(state) { return getActiveProject(state).logLines; }
export function getBeads(state)    { return getActiveProject(state).beads; }
export function getPreferences(state) { return state.preferences; } // always global
```

**Migration sequence:**
1. Add `state-accessors.js` with passthrough fallbacks (returns old shape if `state.projects` doesn't exist)
2. Migrate views to use accessors one file at a time — each commit is independently safe
3. Once all files use accessors, flip `state.js` to the nested structure
4. Remove fallbacks

This turns a flag-day rewrite into ~25 small, independently reviewable and revertable commits.

### §9b: P0 — Phase 0 Rollback via Facade + Kill Switch

Keep `ws.js` as a facade that delegates to the 7 new modules, with a fallback to the original code:

```javascript
// server/ws.js — becomes orchestrator, not gutted
const USE_MODULES = process.env.WORCA_WS_MODULES !== '0';

export function setupWebSocket(server, opts) {
  if (USE_MODULES) return setupModular(server, opts);
  return setupLegacy(server, opts); // original code, untouched
}
```

During Phase 0, ship with both paths. Run tests against both. Once verified, delete the legacy path in a separate commit.

For Phase 1+, add a global mode gate in `~/.worca/config.json`:
```json
{ "multiProject": false }
```
When `false` (default), the server skips project registry scanning, scoped URLs, and sidebar picker. Single boolean kill switch, not a feature flag system.

**Rollback matrix:**

| Problem | Recovery action |
|---------|----------------|
| Phase 0 module extraction breaks watchers | `WORCA_WS_MODULES=0 worca-ui start` |
| Phase 1a registry causes server crashes | Set `multiProject: false` in config |
| Phase 1b state migration breaks views | Revert single accessor commit; fallback covers it |
| Phase 1c UI components broken | Revert; use URL-based project switching from 1b |

### §9c: P1 — WebSocket Protocol Versioning

Add a version handshake on WebSocket connection, backward-compatible with current clients:

**Server side** — on new connection, send hello within 100ms:
```json
{ "type": "hello", "protocol": 2, "capabilities": ["multi-project", "pipeline-control"], "serverVersion": "1.2.0" }
```

**Client side** — respond with hello-ack:
```json
{ "type": "hello-ack", "protocol": 2 }
```

**Negotiation rules:**

| Client sends | Server behavior |
|-------------|-----------------|
| `hello-ack` with `protocol: 2` | Full multi-project mode, `project` field required |
| `hello-ack` with `protocol: 1` | Legacy mode — auto-scope to first project, omit new message types |
| No `hello-ack` within 2s | Assume protocol 1 (current clients) |

Current clients ignore the unknown `hello` message. Server detects old clients by timeout. The `capabilities` array lets the client adapt UI without hard version checks. ~50 lines total implementation.

### §9d: P1 — Pipeline Registry Lock Fragility

`fcntl.flock()` on `.worca/multi/registry.json` (D11) is advisory-only, doesn't work across NFS, and crash-held locks go stale. Replace with the same pattern used for project registry (D2):

Each pipeline writes its own status file:
```
.worca/multi/pipelines.d/
  20260323-143052-847-a1b2.json → { "run_id": "...", "status": "running", ... }
  20260323-150100-312-c3d4.json → { "run_id": "...", "status": "completed", ... }
```

Atomic writes via temp+rename. No locking needed. The watcher scans the directory. `run_multi.py` reads all files to build a combined view. Stale entries detected by PID liveness check, same as D2.

---

## 10. Settings Schema Additions

```json
{
  "worca": {
    "parallel": {
      "max_concurrent_pipelines": 3,
      "default_base_branch": "main",
      "cleanup_policy": "on-success",
      "worktree_base_dir": ".worktrees",
      "registry_path": ".worca/multi/registry.json",
      "status_poll_interval_seconds": 5
    }
  }
}
```

Global config at `~/.worca/config.json`:
```json
{
  "maxProjects": 20
}
```

---

## 11. File Changes Summary

### New files (by phase)

| Phase | File | Purpose |
|-------|------|---------|
| 0 | `server/ws-client-manager.js` | Client subscriptions, heartbeat |
| 0 | `server/ws-broadcaster.js` | Broadcast logic |
| 0 | `server/ws-status-watcher.js` | Status file watching |
| 0 | `server/ws-log-watcher.js` | Log tailing |
| 0 | `server/ws-beads-watcher.js` | Beads watching |
| 0 | `server/ws-event-watcher.js` | Events.jsonl |
| 0 | `server/ws-message-router.js` | Message dispatch |
| 1a | `server/project-registry.js` | Read/write projects.d/ |
| 1b | `app/state-accessors.js` | Thin accessor layer with flat-shape fallback |
| 1c | `app/views/add-project-dialog.js` | Add project dialog |
| 1 | `test/multi-project-fixtures.js` | Fixture factory |
| 1 | `test/multi-project-*.test.js` | Multi-project tests (4 files) |
| 1 | `e2e/multi-project.spec.js` | Browser e2e |
| 2 | `worca/utils/project_registry.py` | Pipeline self-registration |
| 3 | `scripts/run_multi.py` | Multi-pipeline entry point |
| 3 | `worca/orchestrator/registry.py` | Pipeline registry CRUD |
| 4 | `server/multi-watcher.js` | Registry watcher |
| 4 | `app/views/multi-dashboard.js` | Multi-pipeline dashboard |

### Modified files (key changes)

| File | Phase | Change |
|------|-------|--------|
| `server/ws.js` | 0,1 | Extract to modules, then multi-project orchestration |
| `server/process-manager.js` | 0 | ProcessManager class, remove pgrep |
| `server/index.js` | 1,2 | Project registry loading, --global mode |
| `server/app.js` | 1,2 | Project-scoped API prefix, projectResolver middleware |
| `app/state.js` | 1 | Nested project-scoped structure |
| `app/router.js` | 1 | Project segment in hash |
| `app/main.js` | 1,4 | Project switching, three-level rendering |
| `app/views/sidebar.js` | 1,2 | Project picker, status badges |
| `app/views/dashboard.js` | 1,4 | Aggregated cards, parallel pipeline cards |
| `app/views/settings.js` | 1 | Projects tab |
| `bin/worca-ui.js` | 2 | --global flag, projects subcommand |
| `worca/orchestrator/runner.py` | 2,3 | Self-registration, run ID, worktree mode, sequenced plans |
| `worca/utils/git.py` | 3 | Worktree lifecycle helpers |
| `worca/orchestrator/prompt_builder.py` | 3 | Replace hardcoded MASTER_PLAN.md |
| `worca/hooks/test_gate.py` | 3 | File-backed strike state |
| `worca/utils/stats.py` | 3 | Per-run stats write |
| `server/ws.js` (again) | 4 | Pipeline protocol extension |
