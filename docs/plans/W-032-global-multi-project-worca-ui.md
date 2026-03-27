# W-032: Global Multi-Project worca-ui

**Status:** Draft
**Priority:** P2
**Dependencies:** W-017 (multi-project support), W-030 (parallel pipeline execution)
**Type:** Feature / Architecture

---

## Context

Currently, each worca-cc project runs its own worca-ui server + browser tab. With multiple projects on a developer's machine, each potentially running parallel pipelines (W-030), this becomes an MxN problem. The goal is a **single global worca-ui instance** monitoring all projects and all their pipelines from one browser tab.

Two existing plans cover significant ground:
- **W-017** (`W-017-multi-project-support.md`) — multi-project file-watching via `~/.worca/projects.json`, project-scoped WebSocket protocol, sidebar project picker, aggregated dashboard. 14 tasks, fully designed.
- **W-030** (`W-030-parallel-pipeline-execution.md`) — parallel pipelines within a single project via git worktrees, `.worca/multi/registry.json`, multi-pipeline dashboard. 17 tasks, fully designed.

This plan covers what's **not yet designed**: the integration approach, global installation, W-017+W-030 interaction, and complications.

---

## 1. Integration Approach: File-Watching Primary + Webhook Supplementary

The global server watches multiple `.worca/` directories discovered from `~/.worca/projects.json`. Webhooks supplement file-watching as a fast-path hint channel.

### File-Watching (Primary)

File-watching is the source of truth for all data: logs, run state, beads, settings.

- **Complete data access** — logs, events, beads, settings, agent prompts, costs. No gaps.
- **Zero pipeline changes** — Python code writes files as always. Server reads them. Clean separation.
- **Zero per-project configuration** — no webhook URLs, no secrets, no ports. Just register the path.
- **Already designed** — W-017 provides 14 implementation tasks with full code sketches.
- **Proven** — the per-project server already uses this exact mechanism successfully.

### Webhooks (Supplementary)

Webhooks act as **hints** — when a webhook arrives, the server immediately refreshes the corresponding project's state instead of waiting for the next 75ms debounce cycle. If the webhook channel is down, file watchers provide complete coverage with only a slight latency increase. Projects that don't configure webhooks work fully via file-watching alone.

- **Faster status updates** — webhook push is ~1-5ms vs 75ms debounce. Near-instant UI updates for stage transitions and pipeline lifecycle events.
- **Future remote monitoring** — webhooks are network-transport-agnostic. When remote monitoring is needed later, the webhook path is already in place.
- **Leverage existing infrastructure** — the pipeline already has full webhook delivery (`worca/events/emitter.py`) with HMAC signing, retries, and 20+ event types. No new Python code needed.
- **Event enrichment** — webhook payloads carry structured data (token usage, error details, bead state) that may not be immediately available from status.json when the file watcher fires.

### Webhook Auto-Injection

When a project is registered with the global server, it automatically writes a webhook entry to that project's `.claude/settings.local.json` — **unless the project already has `worca.webhooks` configured**, in which case the existing user-defined configuration takes precedence:

```json
{
  "worca": {
    "webhooks": [{
      "url": "http://localhost:3400/api/projects/inbox",
      "events": ["pipeline.*"],
      "project_id": "my-api"
    }]
  }
}
```

### Pipeline Self-Registration

When `run_pipeline.py` starts, it checks `~/.worca/projects.json` and appends the current project if not listed. This closes the discovery gap without manual registration.

```
Pipeline starts in /dev/my-api
  -> Checks ~/.worca/projects.json
  -> /dev/my-api not listed
  -> Appends { name: "my-api", path: "/dev/my-api" }
  -> Global server picks up change via fs.watch on ~/.worca/projects.json
  -> Sets up watchers for /dev/my-api/.worca/
```

---

## 2. Global Installation

W-017 assumes the server is started from within a project directory. For a truly global instance, we need:

### 2.1 `--global` Flag on `bin/worca-ui.js`

```bash
# Per-project mode (existing, unchanged)
cd /dev/my-project && worca-ui start

# Global mode (new)
worca-ui start --global [--port 3400]
```

In global mode:
- Skip `findProjectRoot()` cwd walk-up
- Read projects from `~/.worca/projects.json` instead
- PID file at `~/.worca/worca-ui-global.pid` (not project-local)
- If `projects.json` doesn't exist, create it empty and show "Add Project" prompt in UI

Later (Phase 6), extract to a standalone `worca-ui-global` npm package with its own release cycle.

### 2.2 Project Management CLI

```bash
worca-ui projects add /path/to/project    # Register a project
worca-ui projects remove my-project       # Unregister by name
worca-ui projects list                    # Show all registered projects
```

These write to `~/.worca/projects.json` and, if the global server is running, it picks up changes via file watching.

### 2.3 Dynamic Project Registration

The global server watches `~/.worca/projects.json` itself. When projects are added/removed (via CLI, REST API, or pipeline self-registration), the server dynamically creates/destroys watcher sets without restart.

```
~/.worca/projects.json changes
  -> fs.watch triggers
  -> Diff old vs new project list
  -> teardownProjectWatchers(removed)
  -> setupProjectWatchers(added)
  -> Broadcast 'projects-updated' to all WS clients
```

### 2.4 Port Strategy

The global server claims port 3400. If port 3400 is already in use, the global server **fails to start** with a clear error message indicating what's occupying the port. Per-project servers continue using `findAvailablePort()` to auto-select the next available port, as they already do today. This keeps the global server at a predictable, bookmarkable URL.

### 2.5 Project Limit

Default limit of 20 projects, configurable via `~/.worca/config.json` (`{ "maxProjects": 20 }`). The limit guards against runaway inotify watchers on Linux.

---

## 3. W-030 Integration: Three-Level Hierarchy

W-030 adds parallel pipelines within a project via git worktrees. Combined with multi-project, this creates:

```
Global Server
  ├─ Project "worca-cc" (watches /dev/worca-cc/.worca/)
  │    ├─ Main run (if any)
  │    ├─ Worktree pipeline 1 (watches /dev/worca-cc/.worktrees/pipeline-abc/.worca/)
  │    └─ Worktree pipeline 2 (watches /dev/worca-cc/.worktrees/pipeline-def/.worca/)
  ├─ Project "my-api" (watches /dev/my-api/.worca/)
  │    └─ Main run only
  └─ Project "frontend" (watches /dev/frontend/.worca/)
       ├─ Worktree pipeline 1
       └─ Worktree pipeline 2
```

**Integration mechanism:**
1. Per-project watcher watches `.worca/multi/registry.json` (W-030's registry)
2. When a worktree pipeline registers, create sub-watchers for `{worktreePath}/.worca/`
3. All worktree runs are tagged with the parent project name in WS messages
4. UI groups worktree runs under their parent project

**WebSocket address:** `{ project: "worca-cc", runId: "20260323-143052-847-a1b2" }` — run ID alone is unique (W-030 adds ms + random suffix), so project + runId is sufficient to identify any pipeline anywhere.

---

## 4. Implementation Details

### 4.1 Log Streaming Across Arbitrary Directories

`fs.watch()` works across the filesystem when the process has read access. On macOS (FSEvents), this is straightforward. On Linux (inotify), there's a per-user watch limit (default 8192). With N projects x M runs x K log files, this could be hit.

**Mitigation:** Warn at startup if watch count approaches the limit. Document `sysctl fs.inotify.max_user_watches=65536`.

### 4.2 Pipeline Control Across Projects

Pause/stop/resume writes to `{worcaDir}/runs/{runId}/control.json` and sends SIGTERM via PID from `{worcaDir}/pipeline.pid`. For the global server:
- Resolve the correct project's `worcaDir` from the registry before writing
- Remove the `pgrep -f run_pipeline.py` fallback in `stopPipeline()` — it could match a pipeline from the wrong project. **Use PID-file-only resolution.**

### 4.3 Full Control Center

The global UI supports starting, stopping, pausing, and resuming pipelines in any registered project.

**Starting pipelines:** `POST /api/runs?project=X` spawns `python run_pipeline.py` with `cwd` set to that project's root. The `startPipeline()` function already accepts `projectRoot` — resolve it from the project registry.

**Stopping/pausing/resuming:** Write `control.json` + SIGTERM via PID file. The global server resolves the target project's `worcaDir` from the registry.

**W-030 parallel launches:** `POST /api/multi-pipeline?project=X` spawns `python run_multi.py` in the target project's directory.

**Process manager refactor:** Refactor `process-manager.js` from module-level state to a `Map<projectName, ProcessState>` to track one process state per project (or per project+worktree for W-030).

### 4.4 Beads Isolation

Each project has its own `.beads/beads.db`. The global server opens separate SQLite connections per project. The existing `beads-reader.js` takes `beadsDbPath` as a parameter, so it already works per-project.

With W-030 worktrees, each worktree gets its own beads DB. The global server does not read worktree beads — those are internal pipeline coordination state. Only the parent project's beads matter for the UI's beads panel.

### 4.5 Settings Per-Project

Different projects have different stage configs, agent models, governance rules. The global server serves settings per-project via `GET /api/settings?project=X`. The settings editor must be scoped to the active project.

### 4.6 Stale Projects

A registered project might be moved or deleted. Handle gracefully:
- `discoverRuns()` on non-existent `worcaDir` returns empty array (already does)
- File watchers on missing paths fail to start — catch and skip
- UI shows "Project not found" indicator
- A "Validate" button in project management checks all paths

### 4.7 Version Compatibility

If the global server is newer than a project's worca-cc, status.json formats might differ. The server already tolerates unknown fields (spreads data with `...`) and handles missing fields (uses `?.` chains). Add a `schema_version` field to status.json to future-proof.

### 4.8 Security

The global server has read/write access to all registered project directories. The user explicitly registers paths. The server binds to `127.0.0.1` (not network-exposed). No new attack surface compared to per-project mode.

---

## 5. Backwards Compatibility

| Scenario | Behavior |
|----------|----------|
| No `~/.worca/projects.json` + `worca-ui start` (per-project mode) | Unchanged. Server walks up from cwd, monitors single project. |
| `~/.worca/projects.json` exists + `worca-ui start` (per-project mode) | Still works. The per-project server ignores `projects.json` and monitors its own project only. |
| `worca-ui start --global` with no `projects.json` | Creates empty `projects.json`, shows "Add Project" in UI. |
| `worca-ui start --global` with `projects.json` | Monitors all registered projects. |
| Legacy URLs (`#/active`, `#/history`) | Resolve to first project. No redirect loop. |
| WS messages without `project` field | Default to first project (projects[0]). |
| `run_pipeline.py` unchanged | Writes to `.worca/` as always. Global server discovers via file watching. |

---

## 6. Implementation Sequence

### Phase 1: W-017 Multi-Project (Server + Client)
Implement W-017 as designed (14 tasks):
- `~/.worca/projects.json` registry
- Multi-project file watchers
- Project-scoped WebSocket protocol
- Sidebar project picker + aggregated dashboard

### Phase 2: Global Installation + Full Control Center
On top of W-017:
- `--global` flag on `bin/worca-ui.js`
- `worca-ui projects add/remove/list` CLI
- Dynamic project registration (watch `projects.json`)
- Pipeline self-registration in `runner.py`
- Multi-project process manager (`Map<project, ProcessState>`)
- Full control: start/stop/pause/resume pipelines in any project from the global UI
- PID file at `~/.worca/worca-ui-global.pid`

### Phase 3: Webhook Supplementary Channel
Add webhook integration alongside file-watching:
- `POST /api/projects/inbox` endpoint for receiving pipeline webhooks
- Auto-inject webhook config into project's `settings.local.json` on registration (skip if project already has `worca.webhooks` defined)
- Webhook events trigger immediate status refresh (bypass 75ms debounce)
- Project identification via `X-Worca-Project` header or `project_id` in payload
- Graceful degradation: if webhooks aren't configured, file-watching covers everything

### Phase 4: W-030 Parallel Pipelines
Implement W-030 as designed (17 tasks):
- Git worktree isolation
- `.worca/multi/registry.json`
- Multi-pipeline dashboard within a project

### Phase 5: W-017 + W-030 Integration
Connect the two:
- Global server watches each project's `multi/registry.json`
- Dynamic sub-watchers for worktree pipelines
- Three-level UI hierarchy (projects → pipelines → stages)
- `POST /api/multi-pipeline?project=X` for launching parallel runs from any project

### Phase 6 (Later): Extract to Standalone Package
- Publish `worca-ui-global` as separate npm package
- `npm install -g worca-ui-global && worca-ui-global start`
- Separate release cycle from worca-cc

---

## 7. Key Files to Modify

| File | Phase | Change |
|------|-------|--------|
| `server/project-registry.js` | 1 | New — read/write `~/.worca/projects.json` |
| `server/ws.js` | 1,3,5 | Multi-project watchers, webhook hint integration, worktree sub-watchers |
| `server/index.js` | 1,2 | Project registry loading, `--global` mode |
| `server/app.js` | 1,2,3 | `/api/projects` endpoints, project-scoped pipeline control, webhook inbox |
| `server/process-manager.js` | 2,4 | Multi-project process map (`Map<project, ProcessState>`), remove `pgrep` fallback |
| `app/state.js` | 1 | Two-level `projectRuns` state shape |
| `app/router.js` | 1 | `#/project/{slug}/{section}` routing |
| `app/main.js` | 1,5 | Project switching, scoped subscriptions, three-level rendering |
| `app/views/sidebar.js` | 1 | Project picker |
| `app/views/dashboard.js` | 1,5 | Aggregated project cards, parallel pipeline cards |
| `bin/worca-ui.js` | 2 | `--global` flag, `projects` subcommand |
| `.claude/worca/orchestrator/runner.py` | 2 | `_auto_register_project()` |

---

## 8. Decisions

1. **Maximum project count:** Default 20, configurable via `~/.worca/config.json` (`{ "maxProjects": 20 }`). Guards against runaway inotify watchers on Linux.
2. **Webhook auto-injection:** Auto-inject on project registration. Existing `worca.webhooks` config takes precedence.
3. **Remote monitoring:** Deferred. The webhook channel enables it later; auth/TLS/network binding are out of scope now.
4. **Port strategy:** Global server uses 3400 exclusively; fails to start if occupied. Per-project servers auto-find available ports.
5. **Packaging:** Phased — `--global` flag first (Phase 2), standalone npm package later (Phase 6).
