# W-009: Pipeline Control Actions

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform worca-ui from a read-only monitoring dashboard into a full pipeline control plane. Users will be able to start new pipeline runs, stop active runs with confirmation, and restart individual failed stages -- all from the browser.

**Architecture:** New REST API endpoints on the Express server handle pipeline lifecycle operations (start, stop, restart-stage). A `ProcessManager` module on the server spawns `run_pipeline.py` as a detached child process and tracks it via PID file. The frontend adds a "New Run" dialog on the dashboard, a "Stop" button on active run headers (existing), and "Restart Stage" buttons on failed stage panels. All destructive actions require confirmation dialogs. Real-time status updates continue to flow through the existing WebSocket file-watcher channel.

**Tech Stack:** Express REST API, Node.js `child_process.spawn`, lit-html, Shoelace dialog/button/input/select/textarea components, existing WebSocket broadcast infrastructure.

**Depends on:** W-000 Settings REST API (already complete -- `GET/POST /api/settings` exists in `server/app.js`).

---

## 1. Scope and Boundaries

### In scope
- `POST /api/runs` -- start a new pipeline run (prompt, source, or spec; multipliers)
- `DELETE /api/runs/:id` -- stop/cancel a running pipeline (SIGTERM with escalation to SIGKILL)
- `POST /api/runs/:id/stages/:stage/restart` -- restart a specific failed stage
- `GET /api/runs` -- list all runs (REST complement to existing WS `list-runs`)
- Process management module to spawn and track pipeline child processes
- "New Run" button and dialog on the dashboard view
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
  "mloops": 1           // optional, default 1, range 1-10
}
```

**Validation rules:**
- `inputType` must be one of `"prompt"`, `"source"`, `"spec"`
- `inputValue` must be a non-empty string, max 10,000 characters
- `msize` and `mloops` must be integers 1-10 if provided
- Reject if a pipeline is already running (check PID file + `process.kill(pid, 0)`)
- Reject if the WebSocket server is not connected (edge case guard)

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

---

## 3. Process Management

### New file: `server/process-manager.js`

A stateless module that encapsulates all pipeline process lifecycle operations. Extracted from the inline logic currently in `ws.js` (`stop-run` and `resume-run` handlers).

**Exports:**

- `getRunningPid(worcaDir)` -- returns `{ pid: number } | null`. Reads `.worca/pipeline.pid`, verifies process is alive with `process.kill(pid, 0)`, cleans up stale PID files.

- `startPipeline(worcaDir, { inputType, inputValue, msize, mloops })` -- spawns `python .claude/scripts/run_pipeline.py --prompt "..."` (or `--source` / `--spec`) as a detached child. Returns `{ pid }`. Rejects if a pipeline is already running.

- `stopPipeline(worcaDir)` -- sends SIGTERM, sets up SIGKILL watchdog timer. Returns `{ pid, stopped: true }`. Rejects if no pipeline running.

- `restartStage(worcaDir, stageKey)` -- validates stage is in error state, resets it in status.json, spawns with `--resume`. Returns `{ pid, stage }`.

**Implementation notes:**
- All `spawn()` calls use `{ detached: true, stdio: 'ignore', cwd: process.cwd() }` and `child.unref()` so the UI server can exit without killing the pipeline.
- The `env` passed to `spawn` must delete `CLAUDECODE` to prevent the pipeline from trying to use the parent's Claude session.
- The SIGKILL watchdog timer must be `unref()`'d so it does not keep the server alive.

---

## 4. Frontend Changes

### 4.1 "New Run" Button and Dialog

**Location:** Dashboard view and the content header when on the dashboard section.

**Dialog fields:**
- Input type: `<sl-select>` with options Prompt / GitHub Issue / Spec File
- Input value: `<sl-textarea>` for prompt, `<sl-input>` for source reference or spec path
- Size multiplier: `<sl-input type="number">` (1-10, default 1)
- Loop multiplier: `<sl-input type="number">` (1-10, default 1)
- Submit button: "Start Pipeline"
- Cancel button

**Behavior:**
- Calls `POST /api/runs` via `fetch()`
- On success: close dialog, navigate to `#/active` (the file watcher will pick up the new run)
- On error: show error message in dialog (e.g., "Pipeline already running")
- Disable submit button while request is in flight

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
- Stage name in restart endpoint validated against actual keys in status.json
- No shell interpolation: all arguments passed as array elements to `spawn()`, never concatenated into a shell string

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

`startPipeline(worcaDir, { inputType, inputValue, msize, mloops })`:
- Call `getRunningPid()` first; throw if already running
- Build args array: `['.claude/scripts/run_pipeline.py']`
- Append `--prompt`/`--source`/`--spec` based on `inputType`, followed by `inputValue`
- Append `--msize N` if msize > 1
- Append `--mloops N` if mloops > 1
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
- Read `req.body.inputType`, `req.body.inputValue`, `req.body.msize`, `req.body.mloops`
- Validate `inputType` is one of `['prompt', 'source', 'spec']`; return 400 if not
- Validate `inputValue` is a non-empty string with length <= 10000; return 400 if not
- Validate `msize` and `mloops` are integers 1-10 if provided; default to 1
- Call `startPipeline(options.worcaDir, { inputType, inputValue, msize, mloops })`
- On success: return `{ ok: true, pid, inputType, inputValue }`
- On error with "already running": return 409
- On other error: return 500

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

### Task 5: Add "New Run" Dialog Component

**Files:**
- Create: `.claude/worca-ui/app/views/new-run-dialog.js`

A lit-html view function that renders a Shoelace `<sl-dialog>` with the new run form.

**Exported function:** `newRunDialogView(isOpen, { onSubmit, onClose })`

**Template structure:**
- `<sl-dialog label="Start New Pipeline" ?open=${isOpen}>`
- Input type selector: `<sl-select id="new-run-type" value="prompt">` with options: Prompt, GitHub Issue, Spec File
- Input value:
  - For "prompt": `<sl-textarea id="new-run-value" placeholder="Describe the work..." rows="4">`
  - For "source": `<sl-input id="new-run-value" placeholder="gh:issue:42">`
  - For "spec": `<sl-input id="new-run-value" placeholder="path/to/spec.md">`
- Size multiplier: `<sl-input id="new-run-msize" type="number" value="1" min="1" max="10" label="Size multiplier">`
- Loop multiplier: `<sl-input id="new-run-mloops" type="number" value="1" min="1" max="10" label="Loop multiplier">`
- Footer slot: Cancel button + "Start Pipeline" primary button
- `@sl-after-hide` handler calls `onClose`

**Input type switching:**
- Use a module-level variable `currentInputType` (default `'prompt'`)
- On `<sl-select>` change, update `currentInputType` and call the rerender callback
- Conditionally render textarea vs input based on `currentInputType`

---

### Task 6: Add "New Run" Button to Dashboard and Content Header

**Files:**
- Modify: `.claude/worca-ui/app/views/dashboard.js`
- Modify: `.claude/worca-ui/app/main.js`

**Changes to `dashboard.js`:**

Add a "New Run" button in the dashboard stats row or as a prominent call-to-action. Import the `Play` and `Plus` icons. Add a button:
```html
<button class="action-btn action-btn--primary" @click=${onNewRun}>
  + New Run
</button>
```

Update the function signature to accept a callbacks object: `dashboardView(state, { onSelectRun, onNewRun })`.

**Changes to `main.js`:**

Add module-level state:
- `let newRunDialogOpen = false`
- `let newRunSubmitting = false`
- `let newRunError = null`

Add handler functions:
- `handleOpenNewRunDialog()` -- sets `newRunDialogOpen = true`, calls `rerender()`
- `handleCloseNewRunDialog()` -- sets `newRunDialogOpen = false`, clears error, calls `rerender()`
- `handleSubmitNewRun({ inputType, inputValue, msize, mloops })`:
  - Sets `newRunSubmitting = true`, rerenders
  - Calls `fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputType, inputValue, msize, mloops }) })`
  - On success: close dialog, navigate to `#/active`
  - On error: set `newRunError` to error message, rerender
  - Finally: set `newRunSubmitting = false`

Import and render `newRunDialogView` in the main `rerender()` function, appending it after the app shell (same pattern as the existing `action-error-dialog`).

Add a "New Run" button in `contentHeaderView()` when on the dashboard section (no run selected).

Pass `onNewRun: handleOpenNewRunDialog` to `dashboardView()`.

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

### Task 10: Add CSS for New Run Dialog and Action Buttons

**Files:**
- Modify: `.claude/worca-ui/app/styles.css` (or wherever the main stylesheet lives)

Add styles for:
- `.new-run-dialog` form layout (field spacing, label alignment)
- `.new-run-field` with margin-bottom for form fields
- `.new-run-actions` for the dialog footer button alignment
- `.stage-restart-btn` positioned at the bottom-right of the stage panel
- `.confirm-dialog-body` for confirmation dialog text styling
- Ensure `.action-btn--primary` and `.action-btn--danger` styles exist (they likely already do from the existing stop/resume buttons)

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
- Start a pipeline from the UI with a prompt, verify the process appears in `ps`
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
| `.claude/worca-ui/app/views/new-run-dialog.js` | "New Run" form dialog component |

### Modified files
| File | Changes |
|------|---------|
| `.claude/worca-ui/server/app.js` | Add `GET /api/runs`, `POST /api/runs`, `DELETE /api/runs/:id`, `POST /api/runs/:id/stages/:stage/restart` |
| `.claude/worca-ui/server/index.js` | Pass `worcaDir` to `createApp`, expose `broadcast` on `app.locals` |
| `.claude/worca-ui/server/ws.js` | Refactor `stop-run` and `resume-run` handlers to use `process-manager.js` |
| `.claude/worca-ui/app/protocol.js` | Add new message types to `MESSAGE_TYPES` array |
| `.claude/worca-ui/app/main.js` | Add new-run dialog state, stop confirmation, restart-stage confirmation, new event handlers, new action functions |
| `.claude/worca-ui/app/views/dashboard.js` | Add "New Run" button, update function signature for callbacks |
| `.claude/worca-ui/app/views/run-detail.js` | Add "Restart Stage" button on failed stage panels, update function signature |
| `.claude/worca-ui/app/styles.css` | Add styles for new-run dialog, restart button, confirmation dialogs |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all changes |

---

## 9. Rollout Order

Tasks should be implemented in this order due to dependencies:

1. **Task 1** (process-manager.js) -- foundation, no dependencies
2. **Task 4** (refactor ws.js) -- depends on Task 1
3. **Task 2** (REST API endpoints) -- depends on Task 1
4. **Task 3** (wire REST to WebSocket broadcasts) -- depends on Task 2
5. **Task 9** (protocol types) -- small, independent
6. **Task 5** (new-run-dialog component) -- independent frontend work
7. **Task 6** (new-run button on dashboard + main.js wiring) -- depends on Task 5
8. **Task 7** (stop confirmation dialog) -- depends on Task 2 (uses REST)
9. **Task 8** (restart stage button + confirmation) -- depends on Task 2
10. **Task 10** (CSS) -- after all view changes settled
11. **Task 11** (frontend event handlers) -- depends on Task 3, Task 9
12. **Task 12** (rebuild bundle) -- final step
