# W-009: Pipeline Control Actions


**Goal:** Transform worca-ui from a read-only monitoring dashboard into a full pipeline control plane. Users will be able to start new pipeline runs, stop active runs with confirmation, and restart individual failed stages -- all from the browser.

**Architecture:** New REST API endpoints on the Express server handle pipeline lifecycle operations (start, stop, restart-stage). A `ProcessManager` module on the server spawns `run_pipeline.py` as a detached child process and tracks it via PID file. The frontend adds a **dedicated "New Pipeline" page** at `#/new-run` (not a dialog), with a "New Pipeline" button in both the **sidebar** and the **dashboard**. The new-run page supports all pipeline CLI options including `--plan` for pre-made plan files, with an **autocomplete file chooser** that discovers plan files from configured directories. A "Stop" button on active run headers (existing) and "Restart Stage" buttons on failed stage panels handle the remaining lifecycle actions. All destructive actions require confirmation dialogs. Real-time status updates continue to flow through the existing WebSocket file-watcher channel.

**Tech Stack:** Express REST API, Node.js `child_process.spawn`, lit-html, Shoelace detail/button/input/select/textarea components, existing WebSocket broadcast infrastructure.

**Depends on:** W-000 Settings REST API (already complete -- `GET/POST /api/settings` exists in `server/app.js`).

---

## 1. Scope and Boundaries

### In scope
- `POST /api/runs` -- start a new pipeline run (prompt, source, or spec; multipliers; optional plan file)
- `GET /api/plan-files` -- list available plan files from configured directories for the autocomplete chooser
- `DELETE /api/runs/:id` -- stop/cancel a running pipeline (SIGTERM with escalation to SIGKILL)
- `POST /api/runs/:id/stages/:stage/restart` -- restart a specific failed stage
- `GET /api/runs` -- list all runs (REST complement to existing WS `list-runs`)
- Process management module to spawn and track pipeline child processes
- Dedicated `#/new-run` page with form, autocomplete plan file chooser, and advanced options (msize, mloops)
- "New Pipeline" button in both the sidebar and dashboard
- `worca.planFiles` settings key for configurable plan file directories and extensions
- Confirmation dialog before stop/restart destructive actions
- Input validation and sanitization on all endpoints
- WebSocket broadcast of `run-started` / `run-stopped` events so all connected clients update

### Out of scope
- Multi-run concurrency (only one pipeline may run at a time; enforced by PID lock)
- Pipeline scheduling or cron-style triggers
- Run queue / deferred execution
- Authentication or authorization (single-user local tool)
- Editing work request content after submission

---

## 2. REST API Design

All endpoints are prefixed `/api/`. Responses follow the existing convention `{ ok: true, ...data }` on success, `{ ok: false, error: string }` on failure.

### `GET /api/runs`

Returns the same run list as the WebSocket `list-runs` message, for REST clients or initial page load.

**Response:**
```
{ ok: true, runs: [ { id, active, started_at, work_request, stages, ... } ] }
```

### `POST /api/runs`

Start a new pipeline run. The server spawns `python .claude/scripts/run_pipeline.py` as a detached child process.

**Request body:**
```
{
  "inputType": "prompt" | "source" | "spec",
  "inputValue": "Add user authentication",
  "msize": 1,           // optional, default 1, range 1-10
  "mloops": 1,          // optional, default 1, range 1-10
  "planFile": "docs/plans/W-009-pipeline-control-actions.md"  // optional, skips PLAN stage
}
```

**Validation rules:**
- `inputType` must be one of `"prompt"`, `"source"`, `"spec"`
- `inputValue` must be a non-empty string, max 10,000 characters
- `msize` and `mloops` must be integers 1-10 if provided
- `planFile` must be a non-empty string if provided (path validated by Python runner)
- Reject if a pipeline is already running (check PID file + `process.kill(pid, 0)`)
- Reject if the WebSocket server is not connected (edge case guard)

**Note:** `--plan` is additive -- you still need a work request input (`--prompt`/`--source`/`--spec`) even when providing a plan file. The plan skips the PLAN stage; the prompt describes what the pipeline is working on.

**Response on success:**
```
{ ok: true, pid: 12345, inputType: "prompt", inputValue: "..." }
```

**Response on conflict (pipeline already running):**
```
HTTP 409: { ok: false, error: "Pipeline already running (PID 12345)" }
```

### `DELETE /api/runs/:id`

Stop a running pipeline. The `:id` parameter is currently informational (since only one pipeline runs at a time), but validated against the active run for safety.

**Behavior:**
1. Read PID from `.worca/pipeline.pid`
2. If PID not found, fallback to `pgrep -f run_pipeline.py`
3. Send `SIGTERM`
4. Set a 10-second watchdog timer; if process still alive after 10s, send `SIGKILL`
5. Clean up PID file

**Response on success:**
```
{ ok: true, stopped: true, pid: 12345 }
```

**Response if not running:**
```
HTTP 404: { ok: false, error: "No running pipeline found" }
```

### `POST /api/runs/:id/stages/:stage/restart`

Restart a specific failed stage by spawning the pipeline with `--resume` (the pipeline's resume logic re-runs from the failed stage).

**Validation:**
- Pipeline must NOT be currently running
- The identified stage must exist in `.worca/status.json`
- The stage status must be `"error"` (cannot restart a completed or in-progress stage)

**Behavior:**
1. Read `.worca/status.json`, verify stage exists and has `status: "error"`
2. Reset the stage's status to `"pending"` in status.json (clear `error`, `completed_at`)
3. Spawn `python .claude/scripts/run_pipeline.py --resume`
4. Return immediately; status updates flow via WebSocket file watcher

**Response:**
```
{ ok: true, restarted: true, stage: "test", pid: 12346 }
```

### `GET /api/plan-files`

Returns available plan files from configured directories for the autocomplete chooser on the New Pipeline page.

**Configuration:** Reads `worca.planFiles` from settings. Defaults to `{ dirs: ["docs/plans"], extensions: [".md"] }` if not configured.

**Behavior:**
1. Read `planFiles` config from settings (or use defaults)
2. For each directory in `dirs`, scan relative to project root
3. Filter files by configured extensions
4. Sort alphabetically within each directory

**Response:**
```
{
  "ok": true,
  "files": [
    { "path": "docs/plans/W-009-pipeline-control-actions.md", "dir": "docs/plans", "name": "W-009-pipeline-control-actions.md" },
    { "path": "docs/plans/W-001-pipeline-resume.md", "dir": "docs/plans", "name": "W-001-pipeline-resume.md" }
  ]
}
```

Uses `readdirSync` for simplicity (this is a local tool, directories are small). Gracefully handles missing directories (skip, don't error).

---

## 3. Process Management

### New file: `server/process-manager.js`

A stateless module that encapsulates all pipeline process lifecycle operations. Extracted from the inline logic currently in `ws.js` (`stop-run` and `resume-run` handlers).

**Exports:**

- `getRunningPid(worcaDir)` -- returns `{ pid: number } | null`. Reads `.worca/pipeline.pid`, verifies process is alive with `process.kill(pid, 0)`, cleans up stale PID files.

- `startPipeline(worcaDir, { inputType, inputValue, msize, mloops, planFile })` -- spawns `python .claude/scripts/run_pipeline.py --prompt "..."` (or `--source` / `--spec`) as a detached child. Appends `--plan <path>` if `planFile` is provided. Returns `{ pid }`. Rejects if a pipeline is already running.

- `stopPipeline(worcaDir)` -- sends SIGTERM, sets up SIGKILL watchdog timer. Returns `{ pid, stopped: true }`. Rejects if no pipeline running.

- `restartStage(worcaDir, stageKey)` -- validates stage is in error state, resets it in status.json, spawns with `--resume`. Returns `{ pid, stage }`.

**Implementation notes:**
- All `spawn()` calls use `{ detached: true, stdio: 'ignore', cwd: process.cwd() }` and `child.unref()` so the UI server can exit without killing the pipeline.
- The `env` passed to `spawn` must delete `CLAUDECODE` to prevent the pipeline from trying to use the parent's Claude session.
- The SIGKILL watchdog timer must be `unref()`'d so it does not keep the server alive.

---

## 4. Frontend Changes

### 4.1 Dedicated "New Pipeline" Page (`#/new-run`)

**Location:** A full page accessible at `#/new-run`, not a dialog. Reached via "New Pipeline" buttons in the sidebar and the dashboard.

**New file:** `.claude/worca-ui/app/views/new-run.js`

**Page layout (max-width 640px, centered):**

```
.new-run-page
  .new-run-header
    h2 "Start New Pipeline"
    p  "Configure and launch a new pipeline run."

  .new-run-form
    .new-run-section                       ← card with subtle border + bg
      .settings-field
        label "Input Type"
        sl-select#new-run-input-type       [Prompt | GitHub Issue | Spec File]
        @sl-change → update inputType, rerender()

      .settings-field
        label "Prompt" / "Source" / "Spec File Path"  (dynamic based on inputType)
        sl-textarea#new-run-input-value    (if prompt — multiline, 4 rows)
        sl-input#new-run-input-value       (if source or spec — single line)

    sl-details (summary="Advanced Options")  ← collapsible
      .new-run-advanced
        .new-run-grid (2-column)
          .settings-field
            label "Size Multiplier (msize)"
            sl-input#new-run-msize type=number min=1 max=10 value=1
            .settings-field-hint "Scales max_turns per stage (1-10)"

          .settings-field
            label "Loop Multiplier (mloops)"
            sl-input#new-run-mloops type=number min=1 max=10 value=1
            .settings-field-hint "Scales max loop iterations (1-10)"

        .settings-field
          label "Plan File (optional)"
          .plan-autocomplete                ← custom autocomplete widget
            sl-input#new-run-plan
              placeholder="Type to search plan files..."
              @sl-input → filter planFiles, show dropdown
              @sl-focus → open dropdown
              @sl-blur → close dropdown (200ms debounce for click events)
              clearable
            .plan-dropdown (if open && matches exist)
              grouped by directory:
                .plan-group-header "docs/plans/"
                .plan-item (clickable) → sets selectedPlan, fills input
          .settings-field-hint "Skips the planning stage. Relative to project root."

    .new-run-actions
      sl-button variant=primary "▶ Start Pipeline"
        disabled if: submitting OR pipeline already running
      .new-run-warning (if pipeline already running)
        "A pipeline is currently running."
```

**Autocomplete behavior:**
1. On page load (or first focus), fetch `GET /api/plan-files` and cache
2. On input, filter by substring match against filename and path
3. Group filtered results by directory
4. On click/enter on an item, set `selectedPlan`, fill input, close dropdown
5. On clear, reset `selectedPlan`
6. Raw paths not in the list are accepted as-is (Python validates existence)

**Submit handler:**
1. Read form values from DOM (`document.getElementById(...)`)
2. Validate: inputValue non-empty, msize/mloops in range
3. `POST /api/runs` with `{ inputType, inputValue, msize, mloops, planFile: selectedPlan || undefined }`
4. On 201: navigate to `#/active`
5. On 409: show "Pipeline already running" error
6. On other error: show error in toast

### 4.1a "New Pipeline" Button in Sidebar

**Modify:** `.claude/worca-ui/app/views/sidebar.js`

After the `.sidebar-logo` div, add a "New Pipeline" button with dashed border, accent color. Uses existing `onNavigate('new-run')` callback. Collapses to icon-only when sidebar is collapsed.

### 4.1b "New Pipeline" Button on Dashboard

**Modify:** `.claude/worca-ui/app/views/dashboard.js`

Update signature to `dashboardView(state, { onSelectRun, onNavigate })`. Add a "New Pipeline" action button after the stats grid.

### 4.1c Routing in `main.js`

**Modify:** `.claude/worca-ui/app/main.js`

1. Add import: `newRunView` from `./views/new-run.js`
2. Add import: `sl-textarea` Shoelace component
3. `contentHeaderView()`: add `route.section === 'new-run'` → title "New Pipeline", showBack = true
4. `mainContentView()`: add `route.section === 'new-run'` → return `newRunView(state, { rerender, onStarted })`
5. Update `dashboardView()` call to pass `onNavigate: handleNavigate`

### 4.2 "Stop" Button (already partially exists)

The `main.js` already has `handleStopPipeline()` which sends `stop-run` via WebSocket. This task migrates it to use the new `DELETE /api/runs/:id` REST endpoint and adds a confirmation dialog.

**Confirmation dialog text:** "Are you sure you want to stop this pipeline? The current stage will be interrupted and marked as error."

### 4.3 "Restart Stage" Button on Failed Stages

**Location:** Inside each stage panel in `run-detail.js`, shown only when `stage.status === 'error'` and the run is NOT currently active.

**Behavior:**
- Shows a confirmation dialog: "Restart the {stage} stage? The pipeline will resume from this point."
- Calls `POST /api/runs/:id/stages/:stage/restart` via `fetch()`
- On success: navigate to `#/active` to watch the resumed run
- On error: show error in a dialog

---

## 5. Security Considerations

### Input validation (server-side)
- All string inputs trimmed and length-capped (inputValue max 10,000 chars)
- `inputType` validated against whitelist `["prompt", "source", "spec"]`
- `msize` and `mloops` coerced to integers, clamped to 1-10
- `planFile` validated as non-empty string if provided; path existence validated by Python runner
- Stage name in restart endpoint validated against actual keys in status.json
- No shell interpolation: all arguments passed as array elements to `spawn()`, never concatenated into a shell string
- Plan file paths are never uploaded; they reference files already in the project directory

### Confirmation dialogs (client-side)
- Stop pipeline: requires explicit confirmation via Shoelace `<sl-dialog>` with two buttons (Cancel / Stop)
- Restart stage: requires explicit confirmation
- Start pipeline: no confirmation needed (non-destructive, and user explicitly filled the form)

### Race conditions
- PID file acts as a mutex; all operations check it before proceeding
- `process.kill(pid, 0)` used to verify process is actually alive (stale PID cleanup)
- REST endpoints return `409 Conflict` if pipeline is already running when trying to start
- REST endpoints return `404 Not Found` if pipeline is not running when trying to stop

### Process isolation
- Pipeline spawned with `detached: true` so it survives UI server restarts
- `CLAUDECODE` env var deleted to prevent session leaks
- `stdio: 'ignore'` prevents pipe deadlocks

---

## 6. Implementation Tasks

### Task 1: Create `server/process-manager.js`

**Files:**
- Create: `.claude/worca-ui/server/process-manager.js`

Extract pipeline process management from `server/ws.js` into a dedicated module.

**Functions to implement:**

`getRunningPid(worcaDir)`:
- Read `{worcaDir}/pipeline.pid`, parse as integer
- Verify with `process.kill(pid, 0)` (throws if dead)
- On verification failure: delete stale PID file, return null
- On success: return `{ pid }`

`startPipeline(worcaDir, { inputType, inputValue, msize, mloops, planFile })`:
- Call `getRunningPid()` first; throw if already running
- Build args array: `['.claude/scripts/run_pipeline.py']`
- Append `--prompt`/`--source`/`--spec` based on `inputType`, followed by `inputValue`
- Append `--msize N` if msize > 1
- Append `--mloops N` if mloops > 1
- Append `--plan <path>` if `planFile` is provided
- Clone `process.env`, delete `CLAUDECODE`
- `spawn('python', args, { detached: true, stdio: 'ignore', cwd: process.cwd(), env })`
- `child.unref()`
- Return `{ pid: child.pid }`

`stopPipeline(worcaDir)`:
- Call `getRunningPid()`; throw if null
- Fallback: `execFileSync('pgrep', ['-f', 'run_pipeline\\.py'])` if PID file missing
- Send `SIGTERM` via `process.kill(pid, 'SIGTERM')`
- Set 10-second `setTimeout` to send `SIGKILL` if still alive; `unref()` the timer
- Delete PID file
- Return `{ pid, stopped: true }`

`restartStage(worcaDir, stageKey)`:
- Call `getRunningPid()`; throw if pipeline is running
- Read `{worcaDir}/status.json`
- Validate `stageKey` exists in `status.stages`
- Validate `status.stages[stageKey].status === 'error'`
- Reset the stage: clear `error`, `completed_at`, set `status: 'pending'`
- Write updated status.json back
- Spawn `python .claude/scripts/run_pipeline.py --resume` (same as `startPipeline` but with `--resume` flag)
- Return `{ pid, stage: stageKey }`

---

### Task 2: Add REST API Endpoints to `server/app.js`

**Files:**
- Modify: `.claude/worca-ui/server/app.js`
- Modify: `.claude/worca-ui/server/index.js`

**Changes to `server/app.js`:**

Update `createApp(options)` to accept `{ settingsPath, worcaDir }`. The settings endpoints already exist; add the runs endpoints after them.

Add `import { getRunningPid, startPipeline, stopPipeline, restartStage } from './process-manager.js'` at the top.

Add `import { discoverRuns } from './watcher.js'` at the top.

Add `app.use(express.json())` if not already present (it is -- added by W-000).

Add these route handlers before the static file middleware and catch-all:

**`GET /api/runs`:**
- Call `discoverRuns(options.worcaDir)`, return `{ ok: true, runs }`
- Wrap in try/catch, return 500 on error

**`POST /api/runs`:**
- Read `req.body.inputType`, `req.body.inputValue`, `req.body.msize`, `req.body.mloops`, `req.body.planFile`
- Validate `inputType` is one of `['prompt', 'source', 'spec']`; return 400 if not
- Validate `inputValue` is a non-empty string with length <= 10000; return 400 if not
- Validate `msize` and `mloops` are integers 1-10 if provided; default to 1
- Validate `planFile` is a non-empty string if provided; return 400 if invalid
- Call `startPipeline(options.worcaDir, { inputType, inputValue, msize, mloops, planFile })`
- On success: return `{ ok: true, pid, inputType, inputValue }`
- On error with "already running": return 409
- On other error: return 500

**`GET /api/plan-files`:**
- Read `worca.planFiles` from settings via `readFullSettings(settingsPath)`
- Default to `{ dirs: ["docs/plans"], extensions: [".md"] }` if not configured
- Scan each directory relative to project root using `readdirSync`
- Filter by extensions, sort alphabetically, skip missing directories
- Return `{ ok: true, files: [{ path, dir, name }] }`

**`DELETE /api/runs/:id`:**
- Call `stopPipeline(options.worcaDir)`
- On success: return `{ ok: true, stopped: true, pid }`
- Broadcast `run-stopped` event via WebSocket (see Task 3)
- On "not running" error: return 404
- On other error: return 500

**`POST /api/runs/:id/stages/:stage/restart`:**
- Extract `req.params.stage`
- Call `restartStage(options.worcaDir, req.params.stage)`
- On success: return `{ ok: true, restarted: true, stage, pid }`
- On "already running" error: return 409
- On "stage not found" or "stage not in error": return 400
- On other error: return 500

**Changes to `server/index.js`:**

Pass `worcaDir` to `createApp`:
```
const worcaDir = join(cwd, '.worca');
const app = createApp({ settingsPath, worcaDir });
```

Also expose the `broadcast` function from `attachWsServer` return value so REST endpoints can trigger WebSocket broadcasts when starting/stopping runs. Store the returned `{ broadcast }` and pass it to `createApp` or attach it to `app.locals`.

---

### Task 3: Wire REST Actions to WebSocket Broadcasts

**Files:**
- Modify: `.claude/worca-ui/server/app.js`
- Modify: `.claude/worca-ui/server/index.js`

When a pipeline is started or stopped via REST, all connected WebSocket clients should be notified immediately (in addition to the status.json file watcher that will fire shortly after).

**Approach:**

In `server/index.js`, after creating both `app` and `wss`:
- Store the `broadcast` function returned by `attachWsServer` on `app.locals.broadcast`
- In the REST route handlers, after a successful start/stop/restart, call `app.locals.broadcast('run-started', { pid })` or `app.locals.broadcast('run-stopped', { pid })` or `app.locals.broadcast('stage-restarted', { stage, pid })`

**Changes to `protocol.js`:**
- Add `'stop-run'`, `'resume-run'`, `'run-started'`, `'run-stopped'`, `'stage-restarted'` to the `MESSAGE_TYPES` array

**Changes to `app/ws.js` (client):**
- The ws client `send()` method checks `MESSAGE_TYPES.includes(type)`. Since stop/resume already work via WebSocket (they are in `ws.js` server-side handlers), no change needed there. The new event types only need to be added so the client can register listeners via `ws.on('run-started', ...)`.

---

### Task 4: Refactor Existing Stop/Resume in `server/ws.js` to Use Process Manager

**Files:**
- Modify: `.claude/worca-ui/server/ws.js`

The existing `stop-run` and `resume-run` WebSocket handlers contain inline process management code. Refactor them to delegate to `process-manager.js`.

**Changes:**

Replace the `stop-run` handler body (lines 480-517) with:
- Import and call `stopPipeline(worcaDir)`
- On success: `ws.send(makeOk(req, result))`
- On error: `ws.send(makeError(req, 'not_running', error.message))`

Replace the `resume-run` handler body (lines 520-549) with:
- Import and call `startPipeline(worcaDir, { resume: true })` (add a `resume` option to `startPipeline` that passes `--resume` instead of `--prompt`)
- On success: `ws.send(makeOk(req, { resumed: true, pid }))`
- On error: `ws.send(makeError(req, error code, error.message))`

This eliminates code duplication between the REST and WebSocket paths.

---

### Task 5: Create "New Pipeline" Page View

**Files:**
- Create: `.claude/worca-ui/app/views/new-run.js`

A lit-html view function that renders the dedicated New Pipeline page. See Section 4.1 for the full page layout specification.

**Exported function:** `newRunView(state, { rerender, onStarted })`

**Module-level state:**
- `inputType` (default `'prompt'`) -- drives textarea vs input toggle
- `submitStatus` -- null | 'submitting' | 'error'
- `submitError` -- error message string
- `planFiles` -- cached response from `GET /api/plan-files`
- `planFilter` -- autocomplete search text
- `planDropdownOpen` -- boolean
- `selectedPlan` -- chosen plan file path

**Key implementation details:**
- Input type `<sl-select>` `@sl-change` updates `inputType` and calls `rerender()`
- Prompt renders `<sl-textarea>`, source/spec render `<sl-input>`
- Plan file autocomplete: fetch on first focus, filter on input, group by directory
- Submit handler reads DOM values, validates, calls `POST /api/runs`, navigates on success
- Already-running check: scan `state.runs` for any `run.active === true`

---

### Task 6: Add "New Pipeline" Buttons to Sidebar and Dashboard

**Files:**
- Modify: `.claude/worca-ui/app/views/sidebar.js`
- Modify: `.claude/worca-ui/app/views/dashboard.js`
- Modify: `.claude/worca-ui/app/main.js`
- Modify: `.claude/worca-ui/app/utils/icons.js`

**Changes to `icons.js`:**
- Add `Plus` icon from lucide

**Changes to `sidebar.js`:**
- After `.sidebar-logo`, add a "New Pipeline" button with dashed border, accent color
- `@click` calls `onNavigate('new-run')`
- Collapses to icon-only when sidebar is collapsed

**Changes to `dashboard.js`:**
- Update signature: `dashboardView(state, { onSelectRun, onNavigate })`
- After stats grid, add a "New Pipeline" action button
- `@click` calls `onNavigate('new-run')`

**Changes to `main.js`:**
- Add import: `newRunView` from `./views/new-run.js`
- Add import: `sl-textarea` Shoelace component
- `contentHeaderView()`: add `route.section === 'new-run'` case → title "New Pipeline", showBack = true
- `mainContentView()`: add `route.section === 'new-run'` case → return `newRunView(state, { rerender, onStarted: () => navigate('active', null) })`
- Update `dashboardView()` call to pass `onNavigate: handleNavigate`

---

### Task 7: Add Confirmation Dialog for Stop Pipeline

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

**Changes:**

Add module-level state:
- `let stopConfirmOpen = false`

Modify `handleStopPipeline()`:
- Instead of immediately sending the stop request, set `stopConfirmOpen = true` and rerender
- The confirmation dialog has "Cancel" and "Stop Pipeline" buttons

Add `handleConfirmStop()`:
- Sets `stopConfirmOpen = false`
- Proceeds with the existing stop logic (now calls `fetch('DELETE /api/runs/${runId}')` instead of `ws.send('stop-run')`)

Add `handleCancelStop()`:
- Sets `stopConfirmOpen = false`, rerenders

Render a `<sl-dialog>` for the confirmation:
```html
<sl-dialog label="Stop Pipeline?" ?open=${stopConfirmOpen}>
  <p>Are you sure? The current stage will be interrupted and marked as error.</p>
  <sl-button slot="footer" @click=${handleCancelStop}>Cancel</sl-button>
  <sl-button slot="footer" variant="danger" @click=${handleConfirmStop}>Stop Pipeline</sl-button>
</sl-dialog>
```

---

### Task 8: Add "Restart Stage" Button to Run Detail View

**Files:**
- Modify: `.claude/worca-ui/app/views/run-detail.js`
- Modify: `.claude/worca-ui/app/main.js`

**Changes to `run-detail.js`:**

Update the function signature to accept callbacks: `runDetailView(run, settings, { onRestartStage })`.

Inside each stage panel (the `Object.entries(stages).map(...)` block), after the stage detail rows, conditionally render a restart button when:
- `stageStatus === 'error'`
- `!run.active` (pipeline is not currently running)

```html
<sl-button variant="warning" size="small" @click=${() => onRestartStage(key)}>
  Restart Stage
</sl-button>
```

**Changes to `main.js`:**

Add module-level state:
- `let restartStageConfirmOpen = false`
- `let restartStageKey = null`

Add handler:
- `handleRestartStage(stageKey)`: sets `restartStageKey = stageKey`, `restartStageConfirmOpen = true`, rerenders
- `handleConfirmRestartStage()`:
  - Sets `restartStageConfirmOpen = false`
  - Calls `fetch('/api/runs/${runId}/stages/${restartStageKey}/restart', { method: 'POST' })`
  - On success: navigate to `#/active`
  - On error: show action error dialog
- `handleCancelRestartStage()`: clears state, rerenders

Render a confirmation dialog:
```html
<sl-dialog label="Restart Stage?" ?open=${restartStageConfirmOpen}>
  <p>Restart the "${restartStageKey}" stage? The pipeline will resume from this point.</p>
  <sl-button slot="footer" @click=${handleCancelRestartStage}>Cancel</sl-button>
  <sl-button slot="footer" variant="warning" @click=${handleConfirmRestartStage}>Restart</sl-button>
</sl-dialog>
```

Pass `{ onRestartStage: handleRestartStage }` to `runDetailView()` calls.

---

### Task 9: Update Protocol Types

**Files:**
- Modify: `.claude/worca-ui/app/protocol.js`

Add the following to the `MESSAGE_TYPES` array:
- `'stop-run'` (already used by WebSocket handler but not in the array)
- `'resume-run'` (already used by WebSocket handler but not in the array)
- `'run-started'`
- `'run-stopped'`
- `'stage-restarted'`

Update the `@typedef` JSDoc to include these new types.

---

### Task 10: Add CSS for New Pipeline Page and Action Buttons

**Files:**
- Modify: `.claude/worca-ui/app/styles.css`

Add styles for:
- `.new-run-page` — max-width 640px, centered
- `.new-run-header` — title h2 + muted subtitle
- `.new-run-section` — card container (border, radius, bg-secondary)
- `.new-run-grid` — 2-column grid for msize/mloops side by side
- `.new-run-actions` — flex row for submit button + warning
- `.new-run-warning` — amber warning message when pipeline is running
- `.plan-autocomplete` — position relative container
- `.plan-dropdown` — absolute positioned dropdown, scrollable, max-height 300px, z-index above form
- `.plan-group-header` — directory header in dropdown (dim, uppercase, small)
- `.plan-item` — clickable file item in dropdown, hover highlight
- `.sidebar-new-run` — padding container in sidebar
- `.sidebar-new-run-btn` — dashed border, accent color, full width, hover fill
- `.dashboard-actions` — flex row, right-aligned after stats
- `.stage-restart-btn` positioned at the bottom-right of failed stage panels
- `.confirm-dialog-body` for confirmation dialog text styling

---

### Task 11: Handle `run-started` / `run-stopped` Events in Frontend

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

Register WebSocket event handlers for the new broadcast events:

```javascript
ws.on('run-started', (payload) => {
  // Refresh run list
  ws.send('list-runs').then(payload => {
    const runs = {};
    for (const run of (payload.runs || [])) runs[run.id] = run;
    store.setState({ runs });
  }).catch(() => {});
});

ws.on('run-stopped', (payload) => {
  // Clear pipeline action state
  pipelineAction = null;
  // Refresh run list
  ws.send('list-runs').then(payload => {
    const runs = {};
    for (const run of (payload.runs || [])) runs[run.id] = run;
    store.setState({ runs });
  }).catch(() => {});
});

ws.on('stage-restarted', (payload) => {
  // Refresh; the run will re-appear as active
  ws.send('list-runs').then(payload => {
    const runs = {};
    for (const run of (payload.runs || [])) runs[run.id] = run;
    store.setState({ runs });
  }).catch(() => {});
});
```

---

### Task 12: Rebuild Frontend Bundle

**Files:**
- Run: the existing build/bundle script for worca-ui

After all frontend changes, rebuild `app/main.bundle.js`. Check `package.json` for the build command (likely `npx esbuild` or similar). The bundle must be regenerated since the app serves `main.bundle.js` as a static file.

---

## 7. Testing Strategy

### Unit Tests

**`server/process-manager.test.js`** (new file):
- Test `getRunningPid()` with valid PID file, stale PID file, missing PID file
- Test `startPipeline()` rejects when pipeline already running
- Test `startPipeline()` builds correct args for prompt/source/spec input types
- Test `startPipeline()` applies msize/mloops flags correctly
- Test `startPipeline()` appends `--plan` flag when planFile is provided
- Test `stopPipeline()` sends SIGTERM and cleans up PID file
- Test `stopPipeline()` rejects when no pipeline running
- Test `restartStage()` validates stage exists and is in error state
- Test `restartStage()` resets stage status in status.json before spawning
- Mock `child_process.spawn` and `fs` operations

**`server/app.test.js`** (new file or extend existing):
- Test `GET /api/runs` returns discovered runs
- Test `POST /api/runs` with valid prompt input returns 200 with pid
- Test `POST /api/runs` with missing inputType returns 400
- Test `POST /api/runs` with empty inputValue returns 400
- Test `POST /api/runs` when pipeline already running returns 409
- Test `DELETE /api/runs/:id` when running returns 200
- Test `DELETE /api/runs/:id` when not running returns 404
- Test `POST /api/runs/:id/stages/:stage/restart` with error stage returns 200
- Test `POST /api/runs/:id/stages/:stage/restart` with non-error stage returns 400
- Test `POST /api/runs/:id/stages/:stage/restart` with nonexistent stage returns 400
- Use `supertest` to test Express routes; mock `process-manager.js` exports

### Integration Tests

**Manual testing checklist:**
- Navigate to `#/new-run` from sidebar and from dashboard
- Start a pipeline from the UI with a prompt, verify the process appears in `ps`
- Start a pipeline with a plan file selected from autocomplete, verify `--plan` flag in spawned process
- Verify plan file autocomplete loads, filters, and groups by directory
- Verify the dashboard updates in real-time as the pipeline progresses
- Stop the pipeline from the UI, verify SIGTERM is sent
- Verify the confirmation dialog appears before stopping
- After a stage fails, verify the "Restart Stage" button appears
- Click "Restart Stage", verify the pipeline resumes from that stage
- Open two browser tabs, start a pipeline from one, verify the other updates
- Try to start a pipeline while one is running, verify the 409 error message
- Verify all form validation (empty prompt, invalid msize, etc.)

### Edge Cases to Verify

- Server restart while pipeline is running (PID file survives, reconnect picks it up)
- Stale PID file from a crashed pipeline (cleanup on next operation)
- Rapidly clicking stop then start (PID file mutex prevents race)
- Very long prompt text (10,000 char limit enforced)
- Pipeline that exits immediately with error (status.json updated, UI shows error)

---

## 8. File Summary

### New files
| File | Purpose |
|------|---------|
| `.claude/worca-ui/server/process-manager.js` | Pipeline lifecycle: start, stop, restart-stage |
| `.claude/worca-ui/server/process-manager.test.js` | Unit tests for process manager |
| `.claude/worca-ui/app/views/new-run.js` | Dedicated "New Pipeline" page with form + autocomplete plan chooser |

### Modified files
| File | Changes |
|------|---------|
| `.claude/worca-ui/server/app.js` | Add `GET /api/runs`, `POST /api/runs`, `GET /api/plan-files`, `DELETE /api/runs/:id`, `POST /api/runs/:id/stages/:stage/restart` |
| `.claude/worca-ui/server/index.js` | Pass `worcaDir` + `projectRoot` to `createApp`, expose `broadcast` on `app.locals` |
| `.claude/worca-ui/server/ws.js` | Refactor `stop-run` and `resume-run` handlers to use `process-manager.js` |
| `.claude/worca-ui/app/protocol.js` | Add new message types to `MESSAGE_TYPES` array |
| `.claude/worca-ui/app/utils/icons.js` | Add `Plus` icon |
| `.claude/worca-ui/app/main.js` | Route `#/new-run`, import `sl-textarea`, stop confirmation, restart-stage confirmation, wire callbacks |
| `.claude/worca-ui/app/views/sidebar.js` | Add "New Pipeline" button with dashed border |
| `.claude/worca-ui/app/views/dashboard.js` | Add "New Pipeline" button, update signature for `onNavigate` |
| `.claude/worca-ui/app/views/run-detail.js` | Add "Restart Stage" button on failed stage panels, update function signature |
| `.claude/worca-ui/app/styles.css` | Add styles for new-run page, plan autocomplete, sidebar button, confirmation dialogs |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all changes |

---

## 9. Rollout Order

Tasks should be implemented in this order due to dependencies:

1. **Task 1** (process-manager.js) -- foundation, no dependencies
2. **Task 4** (refactor ws.js) -- depends on Task 1
3. **Task 2** (REST API endpoints + plan-files) -- depends on Task 1
4. **Task 3** (wire REST to WebSocket broadcasts) -- depends on Task 2
5. **Task 9** (protocol types) -- small, independent
6. **Task 6** (Plus icon + sidebar/dashboard buttons) -- no server deps
7. **Task 5** (new-run page view with autocomplete) -- depends on Task 6 (icon)
8. **Task 7** (stop confirmation dialog) -- depends on Task 2 (uses REST)
9. **Task 8** (restart stage button + confirmation) -- depends on Task 2
10. **Task 10** (CSS for new-run page, autocomplete, sidebar) -- after views settled
11. **Task 11** (frontend event handlers) -- depends on Task 3, Task 9
12. **Task 12** (rebuild bundle) -- final step

Tasks 1+6+9 can run in parallel (no dependencies between them).
