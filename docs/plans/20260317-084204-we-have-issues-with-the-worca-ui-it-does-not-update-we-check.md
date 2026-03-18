# MASTER PLAN: Fix Worca UI Auto-Refresh

**Work Request:** The worca UI does not auto-update — Chrome DevTools shows events arriving but in most cases the UI does not refresh to reflect new pipeline state.

---

## Root Cause Analysis

After tracing the full data path from `status.json` → file watcher → WebSocket broadcast → client handler → state store → `rerender()`, three distinct bugs were found. The primary bug is server-side and explains "most cases".

---

### Bug 1 — PRIMARY: New-run status watcher never set up (server/ws.js)

**Severity:** Critical — affects every new pipeline run using the per-run directory format.

**Path:** `.worca/runs/{id}/status.json`

**What happens:**

1. Pipeline writes `.worca/active_run` (new run ID).
2. `activeRunWatcher` fires (`filename === 'active_run'`).
3. `resolveActiveRunDir()` is called. It reads `active_run`, builds the run dir path, then checks `existsSync(join(runDir, 'status.json'))`. The run's `status.json` **does not exist yet** — the run directory is still being created.
4. `resolveActiveRunDir()` falls back to returning `worcaDir` (`.worca/`).
5. `setupStatusWatcher()` sets up a watcher on `.worca/` — the **wrong directory**.
6. The pipeline then creates `.worca/runs/{id}/` and starts writing `status.json` there.
7. **No watcher is on `.worca/runs/{id}/`**. Neither `statusWatcher` nor `activeRunWatcher` watches subdirectories (`recursive: false`).
8. All subsequent `status.json` updates are invisible to the server. No broadcasts. UI is frozen.

Only the single `scheduleRefresh()` call from step 2 fires (which likely finds no active run since `status.json` doesn't exist yet), so the client never receives updated run state.

**Affected code:**
- `server/ws.js`: `resolveActiveRunDir()` — gates directory resolution on `status.json` existing
- `server/ws.js`: `setupStatusWatcher()` — does not retry when the run directory hasn't been created yet

---

### Bug 2 — SECONDARY: File watcher filename null check (server/ws.js)

**Severity:** High — causes missed refreshes on some Linux/Docker configurations.

On Linux, `fs.watch()` callbacks can receive `null` as `filename` (inotify race conditions, certain kernel events, network filesystems, containerized environments). The current guards are:

```js
// statusWatcher
if (filename === 'status.json') { scheduleRefresh(); }

// activeRunWatcher
if (filename === 'active_run' || filename === 'status.json') { ... }
```

When `filename` is `null`, neither condition is true, and `scheduleRefresh()` is never called even though a real change occurred.

**Affected code:**
- `server/ws.js`: both watcher callbacks

---

### Bug 3 — SECONDARY: `readSettings` failure silently aborts the `runs-list` broadcast (server/ws.js)

**Severity:** Medium — causes permanent stale UI on settings file errors.

In `scheduleRefresh`:

```js
try {
  const runs = discoverRuns(worcaDir);
  const active = runs.find(r => r.active);
  if (active) {
    broadcastToSubscribers(active.id, 'run-snapshot', active);  // ← sent
  }
  const settings = readSettings(settingsPath);                  // ← may throw
  broadcast('runs-list', { runs, settings });                   // ← never reached
} catch { /* ignore */ }
```

If `readSettings` throws (missing file, malformed JSON, permission error), `broadcastToSubscribers` has already been called but `broadcast('runs-list', ...)` is **never reached**. Clients that are NOT subscribed to the specific run (e.g., dashboard, run list views) never receive the update.

**Affected code:**
- `server/ws.js`: `scheduleRefresh()`

---

### Bug 4 — MINOR: Missing message types in protocol.js (app/protocol.js)

**Severity:** Low — breaks beads counts/refs features silently.

`ws.send()` validates types against `MESSAGE_TYPES`. The following are called from `main.js` but missing from the list:

- `list-beads-counts` — called in `fetchBeadsCounts()`
- `list-beads-refs` — would be called if beads refs UI is added
- `list-beads-unlinked` — called if beads unlinked view is used

These silently reject with "unknown message type" (caught by `.catch(() => {})`). Beads counts are never shown in run list badges.

---

### Bug 5 — MINOR: `settings` variable updated after store triggers rerender (app/main.js)

**Severity:** Low — renders stale settings on every `runs-list` event.

```js
ws.on('runs-list', (payload) => {
  const runs = {};
  for (const run of (payload.runs || [])) { runs[run.id] = run; }
  store.setState({ runs });              // ← triggers rerender() synchronously
  if (payload.settings) settings = payload.settings;  // ← settings updated AFTER
});
```

`store.setState` calls `emit()` → `rerender()` synchronously. At that point `settings` still holds the previous value. The run detail view (`runDetailView(run, settings, ...)`) renders with stale settings. The next event updates correctly.

---

## Implementation Plan

### Task 1: Fix `resolveActiveRunDir` — remove `status.json` existence gate

**File:** `.claude/worca-ui/server/ws.js`

Change `resolveActiveRunDir` to return the run directory based solely on the `active_run` pointer, without requiring `status.json` to exist yet:

```js
function resolveActiveRunDir() {
  const activeRunPath = join(worcaDir, 'active_run');
  if (existsSync(activeRunPath)) {
    try {
      const runId = readFileSync(activeRunPath, 'utf8').trim();
      if (runId) {
        return join(worcaDir, 'runs', runId);
      }
    } catch { /* ignore */ }
  }
  return worcaDir; // legacy fallback
}
```

This ensures `setupStatusWatcher` always tries the correct run directory.

---

### Task 2: Fix `setupStatusWatcher` — retry when run directory not yet created

**File:** `.claude/worca-ui/server/ws.js`

Add retry logic so the watcher is eventually set up once the pipeline creates the run directory:

```js
function setupStatusWatcher() {
  if (statusWatcher) { statusWatcher.close(); statusWatcher = null; }
  const runDir = resolveActiveRunDir();
  if (watchedRunDir !== null && runDir !== watchedRunDir) {
    clearLogWatchers();
  }
  watchedRunDir = runDir;

  function tryWatch() {
    if (statusWatcher) return; // already established
    try {
      if (existsSync(runDir)) {
        statusWatcher = watch(runDir, { recursive: false }, (_eventType, filename) => {
          if (!filename || filename === 'status.json') {
            scheduleRefresh();
          }
        });
      } else {
        // Run directory not created yet — retry after a short delay
        setTimeout(() => {
          // Only retry if this is still the active run
          if (resolveActiveRunDir() === runDir) tryWatch();
        }, 500);
      }
    } catch { /* ignore */ }
  }

  tryWatch();
}
```

The 500ms retry loop stops naturally once the directory exists and the watcher is established. It also self-cancels if the active run changes.

---

### Task 3: Fix filename null check in both file watchers

**File:** `.claude/worca-ui/server/ws.js`

**`statusWatcher` callback** — accept null filename (fire on any directory event):
```js
statusWatcher = watch(runDir, { recursive: false }, (_eventType, filename) => {
  if (!filename || filename === 'status.json') {
    scheduleRefresh();
  }
});
```

**`activeRunWatcher` callback** — same treatment:
```js
activeRunWatcher = watch(worcaDir, { recursive: false }, (_eventType, filename) => {
  if (!filename || filename === 'active_run' || filename === 'status.json') {
    const newRunDir = resolveActiveRunDir();
    if (newRunDir !== watchedRunDir) {
      setupStatusWatcher();
    }
    scheduleRefresh();
  }
});
```

---

### Task 4: Fix `scheduleRefresh` — separate `readSettings` from broadcast path

**File:** `.claude/worca-ui/server/ws.js`

Move the settings read before the broadcast try block so a settings error doesn't block the run broadcast:

```js
function scheduleRefresh() {
  if (REFRESH_TIMER) clearTimeout(REFRESH_TIMER);
  REFRESH_TIMER = setTimeout(() => {
    REFRESH_TIMER = null;
    let settings = {};
    try { settings = readSettings(settingsPath); } catch { /* ignore */ }
    try {
      const runs = discoverRuns(worcaDir);
      const active = runs.find(r => r.active);
      if (active) {
        broadcastToSubscribers(active.id, 'run-snapshot', active);
      }
      broadcast('runs-list', { runs, settings });
    } catch { /* ignore */ }
  }, REFRESH_DEBOUNCE_MS);
}
```

---

### Task 5: Add missing message types to protocol.js

**File:** `.claude/worca-ui/app/protocol.js`

Add to `MESSAGE_TYPES`:
```js
'list-beads-counts', 'list-beads-refs', 'list-beads-unlinked',
```

---

### Task 6: Fix `settings` timing in `runs-list` handler

**File:** `.claude/worca-ui/app/main.js`

Update `settings` before calling `store.setState` so `rerender()` gets fresh settings:

```js
ws.on('runs-list', (payload) => {
  if (payload.settings) settings = payload.settings;  // update FIRST
  const runs = {};
  for (const run of (payload.runs || [])) {
    runs[run.id] = run;
  }
  store.setState({ runs });
});
```

---

### Task 7: Rebuild the frontend bundle

**After all source file edits**, rebuild the bundle per project conventions:

```bash
cd .claude/worca-ui && npm run build
```

---

## Test Strategy

### Manual verification (end-to-end)
1. Start the worca-ui server: `node .claude/worca-ui/bin/worca-ui.js`
2. Open the UI in Chrome; open Chrome DevTools → Network → WS
3. Start a new pipeline run
4. Verify that `runs-list` and `run-snapshot` events appear in DevTools AND the dashboard/run-detail UI updates stage status in real time
5. Navigate to run detail; confirm stage panels open/close as stages transition

### Unit tests
Run existing test suite; confirm no regressions:
```bash
npx vitest run .claude/worca-ui/server/
```

### Targeted regression test for Bug 1
The `server-e2e.test.js` file exists. Add a test that:
1. Creates `.worca/active_run` pointing to a new run ID
2. Waits 200ms (simulating pipeline startup delay before run dir creation)
3. Creates `.worca/runs/{id}/status.json`
4. Waits for the WS client to receive a `runs-list` event with the active run

---

## File Change Summary

| File | Changes |
|------|---------|
| `.claude/worca-ui/server/ws.js` | Fix `resolveActiveRunDir`, `setupStatusWatcher` (retry), watcher filename null checks, `scheduleRefresh` settings isolation |
| `.claude/worca-ui/app/protocol.js` | Add missing message types |
| `.claude/worca-ui/app/main.js` | Fix `settings` timing in `runs-list` handler |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt output (after `npm run build`) |
