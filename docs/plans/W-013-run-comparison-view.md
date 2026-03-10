# W-013: Run Comparison View


**Goal:** Add a side-by-side run comparison mode to worca-ui so that users can select any two historical (or mixed active/historical) runs and inspect them together -- stage statuses, timing, cost, iteration counts, and log output -- without juggling two browser tabs.

**Architecture:** A new hash route (`#/compare?a={runId}&b={runId}`) drives a dedicated comparison view component. The server gains one new WebSocket message type, `get-run-snapshot`, that fetches a single run by ID on demand (archived or active) without subscribing to live updates. Client-side diff logic computes a stage alignment map and highlights divergence. Log panels inside the comparison view use the existing `subscribe-log` / `_sendArchivedLogs` path with a per-panel xterm terminal instance, enabling independent stage selection and synchronized scroll between the two log columns.

**Tech Stack:** lit-html, Shoelace `<sl-select>` / `<sl-badge>` / `<sl-tab-group>` / `<sl-details>`, xterm.js (reusing the existing lazy-import pattern), existing WebSocket client (`app/ws.js`), existing utility functions (`duration.js`, `status-badge.js`).

**Depends on:** W-000 Settings REST API (already complete). No other incomplete work items are required.

---

## 1. Scope and Boundaries

### In scope
- New URL route `#/compare` with `?a=` and `?b=` query params for the two run IDs
- Run selector UI: two `<sl-select>` dropdowns populated from the existing runs list, with a "Compare" button
- "Compare" button on run cards / history list (pre-populates one slot)
- Side-by-side split-pane layout: left pane = run A, right pane = run B
- Per-run header strip: title, overall status badge, total duration, total cost, branch
- Stage-by-stage comparison table with alignment on stage key
- Per-stage diff cells: status badge, duration delta (absolute and percentage), cost delta, iteration count
- Divergence highlighting: CSS class applied to any stage where the two runs differ in status or have a duration delta exceeding a threshold
- "First divergence" marker pointing to the earliest stage where statuses differ
- Side-by-side log panes: each pane shows an xterm.js terminal for the selected run/stage, with a stage selector dropdown above it
- Synchronized vertical scrolling: when the user scrolls one log pane to the bottom, the other follows (opt-in, with a toggle)
- New WebSocket message type `get-run-snapshot` returning a single run without a subscription
- Protocol registration of the new message type
- CSS for the comparison layout (split pane, diff table, divergence highlights)
- Rebuild of `app/main.bundle.js`

### Out of scope
- Comparing more than two runs at once
- Text-level log diffing (line-by-line unified diff of log content)
- Persisting a comparison selection across page reloads
- Exporting the comparison as a report
- Live updates while both runs are being compared (both runs treated as static snapshots at load time, with a manual refresh button)

---

## 2. New WebSocket Message: `get-run-snapshot`

The existing `subscribe-run` message sets up a persistent subscription and streams updates. The comparison view needs to fetch a snapshot of any run (active or archived) without a subscription so that both panels can coexist independently.

### Request

```
{ type: "get-run-snapshot", payload: { runId: string } }
```

### Response (success)

```
{ ok: true, type: "get-run-snapshot", payload: { id, active, started_at, completed_at, stages, work_request, ... } }
```

The payload is identical in shape to what `subscribe-run` sends as an initial snapshot. The server simply calls `discoverRuns(worcaDir)`, finds the matching run, and returns it directly -- no file-watching is set up.

### Response (not found)

```
{ ok: false, error: { code: "NOT_FOUND", message: "Run {runId} not found" } }
```

### Server implementation location

Add the handler inside `handleMessage()` in `server/ws.js`, immediately after the existing `subscribe-run` block, following the same pattern:

```javascript
if (req.type === 'get-run-snapshot') {
  const { runId } = req.payload || {};
  if (typeof runId !== 'string') {
    ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId required')));
    return;
  }
  const runs = discoverRuns(worcaDir);
  const run = runs.find(r => r.id === runId);
  if (run) {
    ws.send(JSON.stringify(makeOk(req, run)));
  } else {
    ws.send(JSON.stringify(makeError(req, 'NOT_FOUND', `Run ${runId} not found`)));
  }
  return;
}
```

---

## 3. Routing Changes

The existing router in `app/router.js` uses the hash pattern `#/{section}?run={runId}`. The comparison view adds a second query parameter without breaking existing routes.

### Current `parseHash` output shape

```javascript
{ section: string, runId: string | null }
```

### New `parseHash` output shape

```javascript
{ section: string, runId: string | null, compareA: string | null, compareB: string | null }
```

**Changes to `app/router.js`:**

```javascript
export function parseHash(hash) {
  const clean = (hash || '').replace(/^#\/?/, '');
  const [path, query] = clean.split('?');
  const section = path || 'active';
  const params = new URLSearchParams(query || '');
  return {
    section,
    runId: params.get('run') || null,
    compareA: params.get('a') || null,
    compareB: params.get('b') || null,
  };
}

export function buildCompareHash(runIdA, runIdB) {
  return `#/compare?a=${encodeURIComponent(runIdA)}&b=${encodeURIComponent(runIdB)}`;
}
```

All existing callers of `parseHash` only access `.section` and `.runId`, so the addition of `compareA`/`compareB` is backward-compatible.

---

## 4. Comparison Diff Logic

A pure utility module computes the structured diff between two run objects. This lives in `app/utils/run-diff.js` and has no DOM or framework dependencies, making it independently testable.

### Exports

#### `alignStages(runA, runB) -> StageAlignment[]`

Produces an ordered list of all stage keys present in either run, preserving the order they appear in `runA` (falling back to `runB` order for stages only in B).

```javascript
/**
 * @typedef {{ key: string, stageA: object|null, stageB: object|null }} StageAlignment
 */
export function alignStages(runA, runB) { ... }
```

Algorithm:
1. Build an ordered array of stage keys from `Object.keys(runA.stages || {})`.
2. Append any keys from `runB.stages` not already present, preserving their relative order from B.
3. Return `StageAlignment[]` where `stageA` and `stageB` are the corresponding stage objects (or `null` if absent from that run).

#### `stageDiff(stageA, stageB) -> StageDiff`

```javascript
/**
 * @typedef {{
 *   statusMatch: boolean,
 *   durationMsA: number,
 *   durationMsB: number,
 *   durationDeltaMs: number,
 *   durationDeltaPct: number|null,
 *   costA: number,
 *   costB: number,
 *   costDeltaUsd: number,
 *   iterCountA: number,
 *   iterCountB: number,
 *   isDiverged: boolean,
 * }} StageDiff
 */
export function stageDiff(stageA, stageB) { ... }
```

- `statusMatch`: `stageA.status === stageB.status` (both null counts as matching).
- Duration uses the existing `_stageWallMs` logic (replicated or imported).
- `durationDeltaPct`: `null` if either duration is zero.
- `isDiverged`: `true` when `!statusMatch` OR `Math.abs(durationDeltaPct) > 20` (20% threshold, configurable as a named constant `DIVERGE_PCT_THRESHOLD = 20`).
- Missing stage on one side: all numeric fields for that side are 0, status treated as `"absent"`.

#### `findFirstDivergence(alignments, diffs) -> string|null`

Returns the stage key of the first `StageAlignment` whose corresponding `StageDiff` has `isDiverged === true`, or `null` if the runs are identical across all stages.

#### `pipelineTotals(run) -> { totalDurationMs, totalCostUsd }`

Sums across all stages using the same wall-clock logic as `run-detail.js`.

---

## 5. Frontend View Components

### 5.1 New file: `app/views/run-comparison.js`

The top-level comparison view function. Exported as `runComparisonView(compareState, runs, { onSelectA, onSelectB, onCompare, onSwap, onStageSelectA, onStageSelectB, onToggleSync })`.

#### `compareState` shape

```javascript
{
  runIdA: string | null,
  runIdB: string | null,
  runA: object | null,      // fetched run snapshot
  runB: object | null,
  loadingA: boolean,
  loadingB: boolean,
  errorA: string | null,
  errorB: string | null,
  logStageA: string | null, // currently selected stage for log panel A
  logStageB: string | null,
  syncScroll: boolean,
}
```

#### Top-level template structure

```
.comparison-root
  .comparison-selector-bar          (always visible)
    .comparison-slot (A)
      <sl-select> run selector A
    .comparison-swap-btn             (swap A and B)
    .comparison-slot (B)
      <sl-select> run selector B
  .comparison-body                   (shown only when both runs loaded)
    .comparison-summary-row          (header strips side by side)
      .comparison-run-header (A)
      .comparison-run-header (B)
    .comparison-stage-table          (section 5.2)
    .comparison-logs-row             (section 5.3)
      .comparison-log-pane (A)
      .comparison-log-pane (B)
```

#### Run selector bar detail

- Each `<sl-select>` renders an `<sl-option>` for every run in the `runs` array. Option text is `run.work_request?.title || run.id` truncated to 60 characters, with a status icon prefix and a relative timestamp suffix (e.g., "2h ago").
- The currently selected value of each select is the run ID. When `onSelectA` / `onSelectB` fire, `main.js` fetches the snapshot and stores it in `compareState`.
- A "Swap" button (two arrows icon) calls `onSwap`, which exchanges A and B IDs in the URL and state.
- Disabled state: the A selector disables the option already chosen in B and vice versa.

#### Run header strip (per-side)

Shown inside `.comparison-run-header`:

```
[status badge]  Run title (truncated)
Branch: {branch}  |  Started: {timestamp}  |  Duration: {total}  |  Cost: ${total}
```

If the run is currently loading, show a spinner placeholder. If error, show a brief error message.

### 5.2 Stage Comparison Table

Rendered as part of `run-comparison.js` using `alignStages()` and `stageDiff()`.

#### Table structure

One row per `StageAlignment`. Columns:

| Column | Content |
|--------|---------|
| Stage | Stage key formatted as label (same logic as `run-detail.js`) |
| Status A | Status badge for run A's stage (or "absent" badge if null) |
| Status B | Status badge for run B's stage |
| Duration A | Formatted duration (e.g., "1m 23s") |
| Duration B | Formatted duration |
| Delta | Signed formatted delta, e.g., "+15s" or "-3m 02s"; colored green if B is faster, red if slower |
| Cost A | "$0.14" |
| Cost B | "$0.12" |
| Iters A | Iteration count |
| Iters B | Iteration count |

Row-level CSS classes:
- `.stage-row--diverged`: applied when `diff.isDiverged === true`
- `.stage-row--first-divergence`: applied to the row returned by `findFirstDivergence()`; renders a small "First divergence" label in the stage name cell

The first-divergence row also gets an `id="first-divergence"` attribute so a "Jump to first divergence" link in the summary row can scroll to it.

#### Delta formatting

```javascript
function formatDelta(deltaMs) {
  const sign = deltaMs >= 0 ? '+' : '-';
  return sign + formatDuration(Math.abs(deltaMs));
}
```

Green class when `deltaMs < 0` (B completed faster), red when `deltaMs > 0` (B took longer), neutral when 0.

#### Summary totals row

A footer row at the bottom of the table with aggregated totals for each column (sum of per-stage values using `pipelineTotals()`).

### 5.3 Log Panes

Two side-by-side log panels, each with:

1. Stage selector: `<sl-select>` with options for each stage key present in that run (plus an "All stages" option). Defaults to the first non-pending stage.
2. An xterm.js terminal container (`.comparison-log-terminal`).
3. A sync-scroll toggle `<sl-switch>` shown between the two panels (above the terminal row): "Sync scroll".

Log panels reuse the existing xterm terminal infrastructure from `log-viewer.js` but each panel needs its own terminal instance. The comparison view manages two terminal instances rather than sharing the module-level singleton.

Two new exported functions from a companion file `app/views/comparison-log-pane.js`:
- `mountComparisonTerminal(side, containerId, runId, stage)` -- creates or reuses an xterm Terminal instance keyed by `side` ('A' or 'B'), subscribes the WebSocket log channel for the given run/stage, writes lines into that terminal. Uses the same `_sendArchivedLogs` server path.
- `disposeComparisonTerminals()` -- disposes both terminal instances, sends `unsubscribe-log` for both panels.

The sync-scroll behavior is implemented by attaching a `scroll` event listener to each terminal's viewport element; when one reaches the bottom, the other is scrolled to its bottom too (using `terminal.scrollToBottom()`).

---

## 6. Main.js Integration

### 6.1 New module-level state

```javascript
let compareState = {
  runIdA: null,
  runIdB: null,
  runA: null,
  runB: null,
  loadingA: false,
  loadingB: false,
  errorA: null,
  errorB: null,
  logStageA: null,
  logStageB: null,
  syncScroll: true,
};
```

### 6.2 New handler functions

**`handleCompareSelectA(runId)`** and **`handleCompareSelectB(runId)`**:
- Update `compareState.runIdA` / `runIdB`.
- Set `loadingA` / `loadingB = true`, clear old data and error.
- Navigate to `buildCompareHash(runIdA, runIdB)` (updating URL without full re-route).
- Call `ws.send('get-run-snapshot', { runId })`.
- On resolution: set `runA` / `runB`, set `loadingA/B = false`, auto-set `logStageA/B` to the first non-pending stage key found in that run.
- On rejection: set `errorA/B`, clear loading.
- Call `rerender()`.

**`handleCompareSwap()`**:
- Swap `runIdA` ↔ `runIdB`, `runA` ↔ `runB`, `logStageA` ↔ `logStageB`, `errorA` ↔ `errorB`.
- Re-navigate to `buildCompareHash(newA, newB)`.
- Call `rerender()`.

**`handleCompareStageSelectA(stage)`** and **`handleCompareStageSelectB(stage)`**:
- Update `compareState.logStageA` / `logStageB`.
- Remount the corresponding log terminal with the new stage.
- Call `rerender()`.

**`handleCompareSyncScrollToggle()`**:
- Toggle `compareState.syncScroll`.
- Call `rerender()`.

### 6.3 Route handling in `onHashChange`

Add a block at the top of the `onHashChange` callback (and in the initial route evaluation at startup):

```javascript
if (route.section === 'compare') {
  // Dispose live-run terminals (not needed in compare view)
  disposeTerminal();
  disposeLiveTerminal();
  // Restore compare state from URL params
  if (route.compareA && route.compareA !== compareState.runIdA) {
    handleCompareSelectA(route.compareA);
  }
  if (route.compareB && route.compareB !== compareState.runIdB) {
    handleCompareSelectB(route.compareB);
  }
}
```

When navigating _away_ from the compare section, call `disposeComparisonTerminals()`.

### 6.4 `mainContentView()` addition

Add a branch before the existing `if (route.runId)` block:

```javascript
if (route.section === 'compare') {
  const runs = Object.values(state.runs);
  return runComparisonView(compareState, runs, {
    onSelectA: handleCompareSelectA,
    onSelectB: handleCompareSelectB,
    onSwap: handleCompareSwap,
    onStageSelectA: handleCompareStageSelectA,
    onStageSelectB: handleCompareStageSelectB,
    onToggleSyncScroll: handleCompareSyncScrollToggle,
  });
}
```

After `render()` returns, mount the comparison terminals:

```javascript
if (route.section === 'compare') {
  if (compareState.runIdA && compareState.runA) {
    mountComparisonTerminal('A', 'compare-log-A', compareState.runIdA, compareState.logStageA);
  }
  if (compareState.runIdB && compareState.runB) {
    mountComparisonTerminal('B', 'compare-log-B', compareState.runIdB, compareState.logStageB);
  }
}
```

### 6.5 `contentHeaderView()` addition

When `route.section === 'compare'`:
- Title: "Compare Runs"
- Show back button (navigates to `#/history`)
- No action button

### 6.6 "Compare" entry points

**From the history run list:** Add a small "Compare" button to each `runCardView`. Update `runCardView` to accept an optional `onCompare` callback in its options object. When clicked, navigate to `#/compare?a={run.id}` (B slot left empty; the selector bar prompts the user to pick the second run).

**From the run detail header:** When viewing a completed run (`!run.active`), add a "Compare..." button in `contentHeaderView()` that navigates to `#/compare?a={route.runId}`.

**From the sidebar:** Add a "Compare" nav item in `sidebar.js` that navigates to `#/compare` (both slots empty; user fills them via the selectors).

---

## 7. CSS

All new styles go into `app/styles.css`.

### Selector bar

```css
.comparison-selector-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-color);
  background: var(--surface-raised);
}
.comparison-slot { flex: 1; min-width: 0; }
.comparison-slot sl-select { width: 100%; }
.comparison-swap-btn {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
  color: var(--text-secondary);
}
.comparison-swap-btn:hover { color: var(--text-primary); border-color: var(--accent); }
```

### Split pane

```css
.comparison-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  overflow-y: auto;
  flex: 1;
}
.comparison-summary-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.comparison-run-header {
  padding: var(--space-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}
.comparison-run-header-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: var(--space-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### Stage table

```css
.comparison-stage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.comparison-stage-table th {
  text-align: left;
  padding: var(--space-1) var(--space-2);
  border-bottom: 2px solid var(--border-color);
  color: var(--text-secondary);
  font-weight: 600;
  white-space: nowrap;
}
.comparison-stage-table td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border-muted);
  vertical-align: middle;
}
.stage-row--diverged td { background: rgba(var(--warning-rgb), 0.06); }
.stage-row--first-divergence td { background: rgba(var(--danger-rgb), 0.08); }
.first-divergence-marker {
  font-size: 0.7rem;
  color: var(--danger);
  font-weight: 600;
  margin-left: var(--space-1);
  white-space: nowrap;
}
.delta-faster { color: var(--success); }
.delta-slower { color: var(--danger); }
.delta-neutral { color: var(--text-secondary); }
```

### Log panes

```css
.comparison-logs-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  min-height: 400px;
}
.comparison-log-pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.comparison-log-pane-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border-color);
}
.comparison-log-pane-header sl-select { flex: 1; }
.comparison-log-terminal {
  flex: 1;
  min-height: 0;
  background: #0f172a;
}
.comparison-sync-toggle {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: var(--space-1);
}
```

---

## 8. Implementation Tasks

### Task 1: Add `get-run-snapshot` WebSocket handler in `server/ws.js`

**Files:**
- Modify: `.claude/worca-ui/server/ws.js`

Inside `handleMessage()`, after the `subscribe-run` handler block (around line 542), add:

```javascript
if (req.type === 'get-run-snapshot') {
  const { runId } = req.payload || {};
  if (typeof runId !== 'string') {
    ws.send(JSON.stringify(makeError(req, 'bad_request', 'payload.runId required')));
    return;
  }
  const runs = discoverRuns(worcaDir);
  const run = runs.find(r => r.id === runId);
  if (run) {
    ws.send(JSON.stringify(makeOk(req, run)));
  } else {
    ws.send(JSON.stringify(makeError(req, 'NOT_FOUND', `Run ${runId} not found`)));
  }
  return;
}
```

No new imports needed -- `discoverRuns`, `makeOk`, and `makeError` are already imported.

---

### Task 2: Register new protocol types in `app/protocol.js`

**Files:**
- Modify: `.claude/worca-ui/app/protocol.js`

Add `'get-run-snapshot'` to the `MESSAGE_TYPES` array and to the `@typedef` comment:

```javascript
/** @typedef {'subscribe-run'|'unsubscribe-run'|'subscribe-log'|'unsubscribe-log'|'list-runs'|'get-agent-prompt'|'get-preferences'|'set-preferences'|'stop-run'|'resume-run'|'get-run-snapshot'|'run-snapshot'|'run-update'|'runs-list'|'log-line'|'log-bulk'|'preferences'} MessageType */

export const MESSAGE_TYPES = [
  'subscribe-run', 'unsubscribe-run',
  'subscribe-log', 'unsubscribe-log',
  'list-runs',
  'get-agent-prompt',
  'get-preferences', 'set-preferences',
  'stop-run', 'resume-run',
  'get-run-snapshot',           // <-- new
  // Server → Client events
  'run-snapshot', 'run-update', 'runs-list',
  'log-line', 'log-bulk',
  'preferences'
];
```

---

### Task 3: Extend `app/router.js` with compare route support

**Files:**
- Modify: `.claude/worca-ui/app/router.js`

Update `parseHash` to extract `compareA` and `compareB` params. Add `buildCompareHash` helper.

```javascript
export function parseHash(hash) {
  const clean = (hash || '').replace(/^#\/?/, '');
  const [path, query] = clean.split('?');
  const section = path || 'active';
  const params = new URLSearchParams(query || '');
  return {
    section,
    runId: params.get('run') || null,
    compareA: params.get('a') || null,
    compareB: params.get('b') || null,
  };
}

export function buildCompareHash(runIdA, runIdB) {
  const parts = [];
  if (runIdA) parts.push(`a=${encodeURIComponent(runIdA)}`);
  if (runIdB) parts.push(`b=${encodeURIComponent(runIdB)}`);
  return parts.length > 0 ? `#/compare?${parts.join('&')}` : '#/compare';
}
```

The existing `buildHash` function is unchanged.

---

### Task 4: Create `app/utils/run-diff.js`

**Files:**
- Create: `.claude/worca-ui/app/utils/run-diff.js`

Pure utility module, no DOM or framework dependencies.

```javascript
import { elapsed } from './duration.js';

export const DIVERGE_PCT_THRESHOLD = 20; // percent

function stageWallMs(stage) {
  if (!stage) return 0;
  const iters = stage.iterations || [];
  let earliest = stage.started_at || null;
  let latest = stage.completed_at || null;
  for (const it of iters) {
    if (it.started_at && (!earliest || it.started_at < earliest)) earliest = it.started_at;
    if (it.completed_at && (!latest || it.completed_at > latest)) latest = it.completed_at;
  }
  return earliest ? elapsed(earliest, latest || null) : 0;
}

function stageCostUsd(stage) {
  if (!stage) return 0;
  return (stage.iterations || []).reduce((sum, it) => sum + (it.cost_usd || 0), 0);
}

export function alignStages(runA, runB) {
  const keysA = Object.keys(runA?.stages || {});
  const keysB = Object.keys(runB?.stages || {});
  const seen = new Set(keysA);
  const extra = keysB.filter(k => !seen.has(k));
  const allKeys = [...keysA, ...extra];
  return allKeys.map(key => ({
    key,
    stageA: runA?.stages?.[key] || null,
    stageB: runB?.stages?.[key] || null,
  }));
}

export function stageDiff(stageA, stageB) {
  const statusA = stageA?.status || 'absent';
  const statusB = stageB?.status || 'absent';
  const statusMatch = statusA === statusB;
  const durationMsA = stageWallMs(stageA);
  const durationMsB = stageWallMs(stageB);
  const durationDeltaMs = durationMsB - durationMsA;
  const durationDeltaPct = durationMsA > 0
    ? ((durationMsB - durationMsA) / durationMsA) * 100
    : null;
  const costA = stageCostUsd(stageA);
  const costB = stageCostUsd(stageB);
  const costDeltaUsd = costB - costA;
  const iterCountA = stageA?.iterations?.length ?? 0;
  const iterCountB = stageB?.iterations?.length ?? 0;
  const isDiverged = !statusMatch
    || (durationDeltaPct !== null && Math.abs(durationDeltaPct) > DIVERGE_PCT_THRESHOLD);
  return {
    statusMatch, durationMsA, durationMsB, durationDeltaMs,
    durationDeltaPct, costA, costB, costDeltaUsd,
    iterCountA, iterCountB, isDiverged,
  };
}

export function findFirstDivergence(alignments, diffs) {
  for (let i = 0; i < alignments.length; i++) {
    if (diffs[i]?.isDiverged) return alignments[i].key;
  }
  return null;
}

export function pipelineTotals(run) {
  if (!run?.stages) return { totalDurationMs: 0, totalCostUsd: 0 };
  const totalCostUsd = Object.values(run.stages)
    .flatMap(s => s.iterations || [])
    .reduce((sum, it) => sum + (it.cost_usd || 0), 0);
  // Pipeline wall time: earliest stage start to latest stage end
  let earliest = run.started_at || null;
  let latest = run.completed_at || null;
  for (const s of Object.values(run.stages)) {
    for (const it of s.iterations || []) {
      if (it.started_at && (!earliest || it.started_at < earliest)) earliest = it.started_at;
      if (it.completed_at && (!latest || it.completed_at > latest)) latest = it.completed_at;
    }
  }
  const totalDurationMs = earliest ? elapsed(earliest, latest || null) : 0;
  return { totalDurationMs, totalCostUsd };
}
```

---

### Task 5: Create `app/views/comparison-log-pane.js`

**Files:**
- Create: `.claude/worca-ui/app/views/comparison-log-pane.js`

Manages two independent xterm Terminal instances (keyed `'A'` and `'B'`) for the comparison view. Follows the same lazy-import pattern used in `log-viewer.js`.

**Module-level state:**

```javascript
const terminals = {};   // { A: Terminal|null, B: Terminal|null }
const fitAddons = {};
const containers = {};  // { A: HTMLElement|null, B: HTMLElement|null }
const pendingInits = {}; // { A: Promise|null, B: Promise|null }
```

**Exported functions:**

`mountComparisonTerminal(side, containerId, runId, stage)`:
1. Locate `document.getElementById(containerId)`. If not found, return.
2. If `terminals[side]` already exists and is mounted in the same container (check for `.xterm` child), call `fitAddons[side].fit()` and return -- no re-initialization needed.
3. If `terminals[side]` exists but the container changed (different `containerId`), dispose it first.
4. Lazy-load xterm (same `import('xterm')` / `import('@xterm/addon-fit')` pattern as `log-viewer.js`). Guard with `pendingInits[side]`.
5. Create a new `Terminal` with the same theme config as the log viewer.
6. Attach FitAddon, open into the container, fit.
7. Attach ResizeObserver on the container to call `fitAddon.fit()`.
8. Send `ws.send('subscribe-log', { stage, runId, iteration: null })` to receive bulk logs.
9. Handle `log-bulk` events by checking if `payload.stage === stage` (or `stage === null` for all) and writing to `terminals[side]`.

`disposeComparisonTerminals()`:
- Dispose all terminal instances in `terminals`.
- Clear the `terminals`, `fitAddons`, `containers`, `pendingInits` maps.
- Send `ws.send('unsubscribe-log')` for each active log subscription.

**Log routing:** The existing `ws.on('log-bulk', ...)` and `ws.on('log-line', ...)` handlers in `main.js` write to the live-output and log-viewer terminals. The comparison log pane registers its own listeners via `ws.on('log-bulk', comparisonLogBulkHandler)` and `ws.on('log-line', comparisonLogLineHandler)`. These handlers write to the appropriate terminal based on which run/stage the payload matches.

Because both comparison panels subscribe independently (each with their own `subscribe-log` message), the server sends separate `log-bulk` payloads for each. The client-side handlers distinguish them by matching `payload.runId` (if the server includes it) or by relying on the fact that the two subscriptions produce separate WS messages directed to the same client -- this works because `subscribe-log` currently uses a shared `logStage` field on the `subs` entry. See the note in Task 8 about the `subs` multi-subscription limitation.

---

### Task 6: Create `app/views/run-comparison.js`

**Files:**
- Create: `.claude/worca-ui/app/views/run-comparison.js`

The main comparison view template. Imports from `run-diff.js`, `status-badge.js`, `duration.js`, and `icons.js`.

```javascript
import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { alignStages, stageDiff, findFirstDivergence, pipelineTotals } from '../utils/run-diff.js';
import { statusIcon, statusClass, resolveStatus } from '../utils/status-badge.js';
import { formatDuration, formatTimestamp } from '../utils/duration.js';
import { iconSvg, ArrowLeftRight, GitBranch, Clock, Coins, AlertTriangle } from '../utils/icons.js';
```

**`runComparisonView(compareState, runs, callbacks)`**:

Renders the selector bar unconditionally, then the comparison body if both runs are loaded.

**`_selectorBar(compareState, runs, callbacks)`**: Private function rendering the two `<sl-select>` elements and swap button.

Each `<sl-select>` option list iterates `runs` sorted by `started_at` descending. Options render:

```html
<sl-option value="${run.id}">
  ${unsafeHTML(statusIcon(overallStatus, 12))}
  ${title.slice(0, 60)}${title.length > 60 ? '…' : ''}
  · ${relativeTime(run.started_at)}
</sl-option>
```

Where `relativeTime` is a small helper that returns "just now", "3h ago", "2d ago", etc.

**`_runHeader(run, loading, error, label)`**: Renders one header strip. Shows a spinner when `loading`, an error alert when `error !== null`, otherwise the full header strip.

**`_stageTable(runA, runB, settings)`**: Calls `alignStages`, maps to `stageDiff` for each row, calls `findFirstDivergence`. Renders the `<table>` with `<thead>` and `<tbody>`. The `settings` parameter is passed through for stage label lookup (`stageUi[key]?.label`).

**`_logRow(compareState, callbacks)`**: Renders `.comparison-logs-row` with two `.comparison-log-pane` elements and the sync-scroll toggle. Each pane contains:

```html
<div class="comparison-log-pane-header">
  <sl-select value="${logStage || ''}" @sl-change=${e => onStageSelectA(e.target.value || null)}>
    <sl-option value="">All stages</sl-option>
    ${stageKeys.map(key => html`<sl-option value="${key}">${label}</sl-option>`)}
  </sl-select>
</div>
<div class="comparison-log-terminal" id="compare-log-A"></div>
```

The sync toggle is rendered between the two pane headers (centered):

```html
<div class="comparison-sync-toggle">
  <sl-switch ?checked=${syncScroll} @sl-change=${onToggleSyncScroll} size="small">
    Sync scroll
  </sl-switch>
</div>
```

---

### Task 7: Wire comparison into `app/main.js`

**Files:**
- Modify: `.claude/worca-ui/app/main.js`

**Imports to add:**

```javascript
import { runComparisonView } from './views/run-comparison.js';
import { mountComparisonTerminal, disposeComparisonTerminals } from './views/comparison-log-pane.js';
import { buildCompareHash } from './router.js';
```

**Module-level state to add:**

```javascript
let compareState = {
  runIdA: null, runIdB: null,
  runA: null, runB: null,
  loadingA: false, loadingB: false,
  errorA: null, errorB: null,
  logStageA: null, logStageB: null,
  syncScroll: true,
};
```

**Handler functions to add** (full implementations as described in section 6.2):

- `handleCompareSelectA(runId)`
- `handleCompareSelectB(runId)`
- `handleCompareSwap()`
- `handleCompareStageSelectA(stage)`
- `handleCompareStageSelectB(stage)`
- `handleCompareSyncScrollToggle()`

**`fetchCompareRun(runId, side)` -- shared internal helper:**

```javascript
function fetchCompareRun(runId, side) {
  const loadKey = side === 'A' ? 'loadingA' : 'loadingB';
  const dataKey = side === 'A' ? 'runA' : 'runB';
  const errorKey = side === 'A' ? 'errorA' : 'errorB';
  const idKey = side === 'A' ? 'runIdA' : 'runIdB';
  compareState = { ...compareState, [loadKey]: true, [dataKey]: null, [errorKey]: null, [idKey]: runId };
  rerender();
  ws.send('get-run-snapshot', { runId }).then(run => {
    const firstStage = Object.keys(run.stages || {}).find(k => run.stages[k].status !== 'pending') || null;
    const stageKey = side === 'A' ? 'logStageA' : 'logStageB';
    compareState = { ...compareState, [loadKey]: false, [dataKey]: run, [stageKey]: firstStage };
    rerender();
  }).catch(err => {
    compareState = { ...compareState, [loadKey]: false, [errorKey]: err?.message || 'Failed to load run' };
    rerender();
  });
}
```

**`onHashChange` additions:**

At the start of the callback, after updating `route`:

```javascript
if (route.section === 'compare') {
  if (route.compareA && route.compareA !== compareState.runIdA) {
    fetchCompareRun(route.compareA, 'A');
  }
  if (route.compareB && route.compareB !== compareState.runIdB) {
    fetchCompareRun(route.compareB, 'B');
  }
}
```

When navigating _away_ from compare (previous section was 'compare', new section is not):

```javascript
if (prevRoute?.section === 'compare' && route.section !== 'compare') {
  disposeComparisonTerminals();
  compareState = { runIdA: null, runIdB: null, runA: null, runB: null,
    loadingA: false, loadingB: false, errorA: null, errorB: null,
    logStageA: null, logStageB: null, syncScroll: true };
}
```

**`mainContentView()` additions:**

Add before `if (route.runId) { ... }`:

```javascript
if (route.section === 'compare') {
  return runComparisonView(compareState, Object.values(state.runs), settings, {
    onSelectA: (id) => { location.hash = buildCompareHash(id, compareState.runIdB); },
    onSelectB: (id) => { location.hash = buildCompareHash(compareState.runIdA, id); },
    onSwap: handleCompareSwap,
    onStageSelectA: handleCompareStageSelectA,
    onStageSelectB: handleCompareStageSelectB,
    onToggleSyncScroll: handleCompareSyncScrollToggle,
  });
}
```

**`rerender()` additions:**

After the main `render(html`...`, appEl)` call, in the terminal mount section, add:

```javascript
if (route.section === 'compare') {
  if (compareState.runIdA && compareState.runA) {
    mountComparisonTerminal('A', 'compare-log-A', compareState.runIdA, compareState.logStageA);
  }
  if (compareState.runIdB && compareState.runB) {
    mountComparisonTerminal('B', 'compare-log-B', compareState.runIdB, compareState.logStageB);
  }
}
```

**`contentHeaderView()` additions:**

```javascript
if (route.section === 'compare') {
  title = 'Compare Runs';
  showBack = true;
}
```

**Startup route check:** After the initial `route = parseHash(location.hash)`, add:

```javascript
if (route.section === 'compare') {
  if (route.compareA) fetchCompareRun(route.compareA, 'A');
  if (route.compareB) fetchCompareRun(route.compareB, 'B');
}
```

---

### Task 8: Handle `subscribe-log` multi-panel limitation in `server/ws.js`

**Problem:** The current `subs` WeakMap stores a single `logStage` per connection. If the comparison view sends two `subscribe-log` messages (one for run A's stage, one for run B's stage), the second overwrites the first.

**Solution:** Extend the `subs` entry to support a set of log subscriptions keyed by a client-assigned channel ID:

```javascript
// Current shape:
s = { runId: null, logStage: null }

// New shape:
s = { runId: null, logStage: null, logChannels: new Map() }
// logChannels: Map<channelId, { runId, stage }>
```

Add an optional `channelId` field to the `subscribe-log` and `unsubscribe-log` message payload. When `channelId` is present, store the subscription in `logChannels` instead of `logStage`. The `broadcastToLogSubscribers` function checks both `logStage` (legacy) and `logChannels` (new).

The server includes the `channelId` in the `log-bulk` and `log-line` responses so the client can route to the correct terminal.

**Changes to `server/ws.js`:**

In `ensureSubs`:

```javascript
function ensureSubs(ws) {
  let s = subs.get(ws);
  if (!s) {
    s = { runId: null, logStage: null, logChannels: new Map() };
    subs.set(ws, s);
  }
  return s;
}
```

In `subscribe-log` handler, detect `channelId`:

```javascript
const { stage, runId, iteration, channelId } = req.payload || {};
if (channelId) {
  s.logChannels.set(channelId, { stage: stage || '*', runId });
} else {
  s.logStage = stage || '*';
}
```

In `broadcastToLogSubscribers`, include channel routing:

```javascript
function broadcastToLogSubscribers(stage, type, payload, runId) {
  for (const ws of wss.clients) {
    if (ws.readyState !== ws.OPEN) continue;
    const s = subs.get(ws);
    if (!s) continue;
    // Legacy single subscription
    if (s.logStage === stage || s.logStage === '*') {
      ws.send(JSON.stringify({ id: `evt-${Date.now()}`, ok: true, type, payload }));
    }
    // Channel-based subscriptions (comparison view)
    for (const [channelId, ch] of s.logChannels) {
      if (ch.runId && ch.runId !== runId) continue;
      if (ch.stage === stage || ch.stage === '*') {
        ws.send(JSON.stringify({ id: `evt-${Date.now()}`, ok: true, type, payload: { ...payload, channelId } }));
      }
    }
  }
}
```

**Changes to `app/views/comparison-log-pane.js`:**

Use `channelId: 'compare-A'` and `channelId: 'compare-B'` in the `subscribe-log` payloads. In the `log-bulk` and `log-line` event handlers, route by `payload.channelId`.

**Backward compatibility:** Existing `subscribe-log` messages without `channelId` continue to work via `s.logStage` unchanged.

---

### Task 9: Add "Compare" entry points in the existing views

**Files:**
- Modify: `.claude/worca-ui/app/views/run-card.js`
- Modify: `.claude/worca-ui/app/views/sidebar.js`
- Modify: `.claude/worca-ui/app/main.js` (contentHeaderView for run detail)

**`run-card.js`:** Accept an optional `onCompare` callback. Render a small icon button when provided:

```javascript
export function runCardView(run, { onClick, onCompare } = {}) {
  ...
  return html`
    <div class="run-card" @click=${onClick ? () => onClick(run.id) : null}>
      ...
      ${onCompare ? html`
        <button class="run-card-compare-btn" title="Compare this run" @click=${(e) => {
          e.stopPropagation();
          onCompare(run.id);
        }}>
          ${unsafeHTML(iconSvg(ArrowLeftRight, 13))} Compare
        </button>
      ` : nothing}
    </div>
  `;
}
```

**`sidebar.js`:** Add a "Compare" nav item after "History":

```javascript
<li class="${route.section === 'compare' ? 'active' : ''}">
  <button @click=${() => onNavigate('compare')}>
    ${unsafeHTML(iconSvg(ArrowLeftRight, 16))}
    Compare
  </button>
</li>
```

**`main.js` -- `contentHeaderView()`:** When `route.runId` is set and the run is not active, add a "Compare" action button alongside the stop/resume button:

```javascript
const compareBtn = !run.active ? html`
  <button class="action-btn action-btn--secondary" @click=${() => {
    location.hash = buildCompareHash(route.runId, null);
  }}>
    ${unsafeHTML(iconSvg(ArrowLeftRight, 14))}
    Compare...
  </button>
` : nothing;
```

**`run-list.js`:** Pass `onCompare` through from `main.js`:

```javascript
export function runListView(runs, filter, { onSelectRun, onCompare }) {
  ...
  ${filtered.map(run => runCardView(run, { onClick: onSelectRun, onCompare }))}
```

In `main.js`, add `onCompare: (runId) => { location.hash = buildCompareHash(runId, null); }` to all `runListView()` calls.

---

### Task 10: Add CSS for comparison view to `app/styles.css`

**Files:**
- Modify: `.claude/worca-ui/app/styles.css`

Append all the CSS blocks described in section 7. Additionally:

```css
.run-card-compare-btn {
  margin-top: var(--space-2);
  font-size: 0.75rem;
  padding: 2px var(--space-2);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.run-card-compare-btn:hover { color: var(--accent); border-color: var(--accent); }

.comparison-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.comparison-empty-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  color: var(--text-muted);
  font-size: 0.875rem;
}
```

---

### Task 11: Rebuild frontend bundle

**Files:**
- Run build script in `.claude/worca-ui/`

After all frontend file changes, rebuild `app/main.bundle.js`. Check `package.json` for the build command. Based on the project structure, this is likely:

```bash
cd .claude/worca-ui && npm run build
```

or the equivalent `npx esbuild` invocation that produces `app/main.bundle.js`.

---

## 9. Testing Strategy

### Unit Tests

**`app/utils/run-diff.test.js`** (new file):

- `alignStages` with runs that have all stages in common -- returns all, ordered by A
- `alignStages` with a stage only in B -- appended after A's stages
- `alignStages` with a stage only in A -- present with `stageB: null`
- `stageDiff` with identical stages -- `isDiverged: false`, `statusMatch: true`, deltas zero
- `stageDiff` with different statuses -- `isDiverged: true`, `statusMatch: false`
- `stageDiff` with duration difference under threshold (15%) -- `isDiverged: false`
- `stageDiff` with duration difference over threshold (25%) -- `isDiverged: true`
- `stageDiff` with `stageA: null` (stage absent from run A) -- `durationMsA: 0`, `costA: 0`, `statusA === 'absent'`, `isDiverged: true`
- `findFirstDivergence` returns correct stage key for first diverged row
- `findFirstDivergence` returns `null` when all stages match
- `pipelineTotals` sums cost correctly across iterations
- `pipelineTotals` on run with no stages returns zeros

**`app/router.test.js`** (extend existing):

- `parseHash('#/compare?a=abc&b=def')` returns `{ section: 'compare', compareA: 'abc', compareB: 'def', runId: null }`
- `parseHash('#/compare?a=abc')` returns `{ compareA: 'abc', compareB: null }`
- `buildCompareHash('abc', 'def')` returns `'#/compare?a=abc&b=def'`
- `buildCompareHash('abc', null)` returns `'#/compare?a=abc'`
- Existing tests for the non-compare route patterns still pass

### Integration / Manual Testing Checklist

- Navigate to `#/compare` via sidebar: both selector dropdowns are empty, body is not shown
- Select run A from dropdown: loading state shown for left pane, then header strip populates
- Select run B from dropdown: right pane loads, stage table appears below the headers
- Stage table shows correct status badges for each side
- A row where both runs succeeded has no divergence highlight
- A row where one run errored has the divergence highlight (`.stage-row--diverged`)
- The first diverged row has the "First divergence" marker label
- Duration delta column shows correct sign, color, and units
- Cost delta column shows correct sign
- Swap button exchanges A and B (URL updates, panels swap)
- Log panes show stage selector dropdowns with the run's stages
- Selecting a stage in log pane A loads logs for run A's stage without affecting pane B
- Selecting a stage in log pane B loads logs for run B's stage without affecting pane A
- With sync scroll ON: scrolling either terminal to bottom causes the other to scroll to bottom
- With sync scroll OFF: terminals scroll independently
- "Compare" button on a run card pre-populates the A slot and navigates to `#/compare?a={id}`
- "Compare..." button in the run detail header pre-populates A and navigates to compare
- Navigating away from compare and back resets the comparison state cleanly
- Opening `#/compare?a={id}&b={id2}` directly (e.g., pasting URL) loads both runs automatically
- A run that exists only in `.worca/results/` (archived) loads correctly in a comparison slot
- Comparing an active run with a historical run works (active run shows in-progress stages)

### Edge Cases to Verify

- Comparing a run with itself (same ID in both slots): all deltas zero, no divergence, no crash
- One run has a stage the other lacks: "absent" badge shown, row treated as diverged
- A run with zero stages (e.g., failed before any stage started): table is empty, no crash
- Very long run title in the header strip: truncated with ellipsis, no layout overflow
- Connection drop mid-comparison: error state shown, manual refresh recovers
- Navigating to `#/compare` with an invalid run ID in the URL: error message shown in the affected slot

---

## 10. File Summary

### New files

| File | Purpose |
|------|---------|
| `.claude/worca-ui/app/utils/run-diff.js` | Pure diff computation: stage alignment, per-stage diff, divergence detection, totals |
| `.claude/worca-ui/app/utils/run-diff.test.js` | Unit tests for all run-diff exports |
| `.claude/worca-ui/app/views/run-comparison.js` | Top-level comparison view: selector bar, run headers, stage table, log row |
| `.claude/worca-ui/app/views/comparison-log-pane.js` | Two-terminal log panel manager for the comparison view |

### Modified files

| File | Changes |
|------|---------|
| `.claude/worca-ui/server/ws.js` | Add `get-run-snapshot` handler; extend `subs` for multi-channel log subscriptions; update `broadcastToLogSubscribers` to include channel routing |
| `.claude/worca-ui/app/protocol.js` | Add `'get-run-snapshot'` to `MESSAGE_TYPES` and the `@typedef` |
| `.claude/worca-ui/app/router.js` | Add `compareA`/`compareB` parsing to `parseHash`; add `buildCompareHash` export |
| `.claude/worca-ui/app/main.js` | Add `compareState`; add compare handler functions; wire compare route in `onHashChange`; add compare branch in `mainContentView`; mount comparison terminals in `rerender`; add "Compare..." button in `contentHeaderView`; pass `onCompare` to `runListView` |
| `.claude/worca-ui/app/views/run-card.js` | Accept and render optional `onCompare` callback as a "Compare" icon button |
| `.claude/worca-ui/app/views/run-list.js` | Pass `onCompare` through to `runCardView` |
| `.claude/worca-ui/app/views/sidebar.js` | Add "Compare" navigation item |
| `.claude/worca-ui/app/styles.css` | Add all comparison layout and component styles (selector bar, split pane, stage table, log panes, divergence highlights) |
| `.claude/worca-ui/app/main.bundle.js` | Rebuilt from source after all changes |

---

## 11. Rollout Order

Tasks must be implemented in this sequence due to dependencies:

1. **Task 4** (`run-diff.js`) -- pure utility, no dependencies; enables testing immediately
2. **Task 3** (`router.js`) -- needed by Tasks 7 and 11; no dependencies on other new code
3. **Task 2** (`protocol.js`) -- needed by the WS client before Task 7 can send the new message type
4. **Task 1** (`server/ws.js` -- `get-run-snapshot` handler) -- server side; can be done in parallel with Tasks 2-4
5. **Task 8** (`server/ws.js` -- multi-channel log subscriptions) -- server side; depends on Task 1 being settled first to avoid merge conflicts in the same file
6. **Task 5** (`comparison-log-pane.js`) -- depends on Task 8 (uses `channelId`); depends on Task 2 (protocol type)
7. **Task 6** (`run-comparison.js`) -- depends on Task 4 (diff utils) and Task 5 (log pane)
8. **Task 9** (entry points: `run-card.js`, `sidebar.js`, `run-list.js`) -- independent of Tasks 5-6; requires only Task 3 for `buildCompareHash`
9. **Task 7** (`main.js` wiring) -- depends on Tasks 2, 3, 5, 6, 9
10. **Task 10** (CSS) -- after all view components are settled
11. **Task 11** (rebuild bundle) -- final step
