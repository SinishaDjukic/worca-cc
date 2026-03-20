# Fix: Live Stream Logs Bleeding into Log History + Add Timestamps

## Problem

1. **Bug**: Real-time streaming log lines (`log-line` WebSocket events) are appended to both the **Live Output** terminal and the **Log History** terminal. They should only appear in Live Output. The Log History panel should only display logs loaded on subscription via `log-bulk` (historical backfill).

2. **Feature**: No timestamps are shown on log lines. Add a local-timezone timestamp to each log line visible in both Live Output (real-time) and Log History (when reviewing past output).

## Root Cause Analysis

### Bug: Streaming to Log History

In `.claude/worca-ui/app/main.js`, the `log-line` handler (lines 164-177) writes to **both** terminals:

```javascript
ws.on('log-line', (payload) => {
  store.appendLog(payload);
  if (logFilter !== '*') writeIterationSeparator(payload.iteration);  // ← Log History
  if (logFilter !== '*') writeLogLine(payload);                        // ← Log History
  writeLiveLogLine(payload);                                           // ← Live Output
});
```

The `writeLogLine(payload)` and `writeIterationSeparator()` calls write to the Log History xterm terminal. These should be removed from the `log-line` handler so streaming only goes to Live Output.

### Missing Timestamps

- The server (`ws.js` line 228) broadcasts `log-line` events with `{ stage, iteration, line }` — no `timestamp` field.
- Both `live-output.js` and `log-viewer.js` already check for `entry.timestamp` and render it if present, but it's never set.
- `log-bulk` sends raw string arrays — no per-line timestamp either.

## Implementation Plan

### Task 1: Stop streaming `log-line` events to Log History terminal

**File**: `.claude/worca-ui/app/main.js`

**Changes** (lines 164-177):
- Remove `if (logFilter !== '*') writeLogLine(payload);` from the `log-line` handler
- Remove `if (logFilter !== '*') writeIterationSeparator(payload.iteration);` from the `log-line` handler
- Keep `store.appendLog(payload)` (state tracking) and `writeLiveLogLine(payload)` (Live Output)
- Keep `writeLiveIterationSeparator(payload.iteration)` (Live Output)

**Result**: `log-line` events only write to Live Output. Log History is populated exclusively by `log-bulk` on subscribe/resubscribe.

### Task 2: Add server-side timestamps to `log-line` events

**File**: `.claude/worca-ui/server/ws.js`

**Changes** (inside `watchSingleLogFile`, lines 227-233):
- Add a `timestamp` field with ISO 8601 value to each `log-line` payload:

```javascript
broadcastToLogSubscribers(stage, 'log-line', {
  stage: stage || 'orchestrator',
  iteration: iteration ?? undefined,
  line,
  timestamp: new Date().toISOString(),
});
```

This captures the moment the server detects the new line (close to when it was written to the log file).

### Task 3: Add client-side timestamp to `log-bulk` entries

**File**: `.claude/worca-ui/app/main.js`

**Changes** in `log-bulk` handler (lines 179-189):
- When constructing `entry` from bulk lines, add a `timestamp` field. Since bulk lines are historical and we don't know the original write time, stamp them with the current time (the moment they were received/loaded). This gives approximate timing for recently written lines and a baseline for archived runs.
- Also preserve the `iteration` field from `payload.iteration` (currently lost):

```javascript
const entry = {
  stage: payload.stage,
  iteration: payload.iteration,
  line,
  timestamp: new Date().toISOString(),
};
```

### Task 4: Format timestamps in local timezone on the client

**Files**: `.claude/worca-ui/app/views/live-output.js` and `.claude/worca-ui/app/views/log-viewer.js`

Both files already render timestamps at lines 97 and 93 respectively:
```javascript
const ts = entry.timestamp ? `${DIM}${entry.timestamp}${RESET} ` : '';
```

**Changes**:
- Create a shared helper function `formatTimestamp(isoString)` that converts an ISO timestamp to local timezone format `HH:MM:SS` (compact, suitable for terminal display).
- Update both files to use the formatter:

```javascript
function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}
```

Then in the write functions:
```javascript
const ts = entry.timestamp ? `${DIM}${formatTimestamp(entry.timestamp)}${RESET} ` : '';
```

**Placement**: Define the helper inline in each view file (they're small, self-contained modules — no need for a shared utility file for a 6-line function).

### Task 5: Rebuild the UI bundle

```bash
cd .claude/worca-ui && npm run build
```

### Task 6: Test

1. **Streaming isolation**: Start a pipeline run, observe that:
   - Live Output terminal shows real-time log lines with timestamps
   - Log History terminal does NOT receive new lines while streaming
   - Log History only populates when a stage is selected (via `log-bulk` backfill)

2. **Timestamp format**: Verify timestamps appear as `HH:MM:SS` in local timezone on both terminals.

3. **Log History backfill**: Select a stage in Log History dropdown — confirm historical lines load with timestamps.

4. **Iteration handling**: Verify `log-bulk` entries now include the `iteration` field (fixes a secondary data-loss bug where iteration was dropped).

5. **Run existing tests**:
   ```bash
   npx vitest run .claude/worca-ui/server/
   ```

## Files Modified

| File | Change |
|------|--------|
| `.claude/worca-ui/app/main.js` | Remove Log History writes from `log-line` handler; add timestamp+iteration to `log-bulk` entries |
| `.claude/worca-ui/server/ws.js` | Add `timestamp` field to `log-line` broadcast payload |
| `.claude/worca-ui/app/views/live-output.js` | Add `formatTimestamp()` helper; use it in `writeLiveLogLine()` |
| `.claude/worca-ui/app/views/log-viewer.js` | Add `formatTimestamp()` helper; use it in `writeLogLine()` |

## Risks & Considerations

- **Log History won't live-update during a run**: This is the intended behavior per the user's request. Users can resubscribe (re-select the stage) to refresh Log History with the latest bulk data.
- **Bulk timestamps are approximate**: `log-bulk` lines get timestamped at receive time, not original write time. For active runs this is near-real-time; for archived runs it's the time of viewing. This is acceptable since exact historical timestamps aren't available from plain-text log files.
- **No server-side format changes**: Existing WebSocket protocol remains backward-compatible — `timestamp` is a new optional field.
