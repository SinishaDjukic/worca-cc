# W-074: Capture & surface Claude CLI API-throttling/retry signal

**Status:** Draft
**Priority:** P2
**Area:** cc
**Date:** 2026-06-15
**Depends on:** None

## Problem

When the Claude CLI hits API throttling (HTTP 429/529 "overloaded"), it retries **internally** with exponential backoff and emits nothing on its stdout stream-json channel — the stream simply goes silent until a retry succeeds. worca's stream consumer (`src/worca/utils/claude_cli.py:421` `process_stream`) only ever parses three stdout event types (`system/init`, `assistant`, `result`), so a multi-minute backoff is invisible: no event, no log line, no counter. The CLI *does* print retry/backoff diagnostics to **stderr**, but worca's `_tee_stderr` thread (`claude_cli.py:646`) only echoes those lines to the console (`sys.stderr.write`) and never persists them to the run dir or parses them.

Concrete impact (run `20260615-090105-889-fd6cf15c`, implement iter 2): the iteration recorded `duration_ms=3979583` (66 min wall) but `duration_api_ms=1108832` (18.5 min in-API) over 172 turns — ~48 min (72%) spent *not* generating tokens, including two ~16–18 min windows of total event silence right after trivial tool calls. Diagnosing this required a forensic dig through `procs/`, `events.jsonl`, and `status.json` because the throttling signal is captured **nowhere**. From the UI the run looked hung when it was actually backing off.

## Proposal

Tag every persisted log line by its origin stream (`out` / `err`), persist **all** stderr (not just matches) into the existing per-iteration log with the tag, parse stderr in the tee thread to count retries (`api_retries`) and measure the aggregate backoff-window span (`api_retry_wait_ms`), emit a new `pipeline.agent.api_retry` event, record both per-iteration metrics (plus coarse `non_api_wait_ms` and `api_error_status`) in `status.json`, and surface the signal across **four UI surfaces**: (6a) log-viewer err-line coloring + a 3-way `sl-radio-button` stream filter; (6b) a per-iteration `⟳ N retries` chip + `Wait:` time/% row; (6c) a collapsed-stage-header `⟳ N` chip + a Duration `sl-tooltip` with the across-iterations breakdown; and (6d) a dedicated striped `API Retry/Wait` segment in the pipeline timing bar (which also corrects a current misattribution of backoff time into "Tools"). The `stream` tag is the spine that makes the retry parse, the persisted err stream, and the UI filter hang together; `api_retry_wait_ms` is the spine for the timing-bar split.

## Design

### 1. Log-line format: add a `stream` tag

- **Current state:** `claude_cli.py` writes log lines as `<ISO-timestamp>\t<text>` via `write_log_line` (called from `process_stream`, `claude_cli.py:431`/`:469`). The server parser `worca-ui/server/log-tailer.js:35` `parseLogLine` matches `/^(<ISO>)\t([\s\S]*)$/` and `splitTimestamps` (`log-tailer.js:51`) emits parallel `{ lines[], timestamps[] }` arrays — the shape the `log-bulk` WS payload carries.
- **Obstacle:** there is no third dimension. A 3-way out/err filter is impossible unless each persisted line records which stream it came from. We also rejected merging at the FD level (`stderr=subprocess.STDOUT`): the stdout NDJSON stream is load-bearing (`result` event, `structured_output`, token/cost accounting), `result` events exceed `PIPE_BUF` (~4 KB) so they span multiple syscalls, and an unsynchronized stderr write landing mid-line would split a JSON record → `JSONDecodeError` → the result event is silently dropped. Tag at the **application layer**, one file.
- **Resolution:** introduce an optional middle column. New canonical line shape:

  ```
  <ISO-timestamp>\t<stream>\t<text>      # stream ∈ {out, err}
  ```

  Back-compat: legacy lines `<ISO>\t<text>` (no recognized stream token in column 2) parse as `stream="out"`. The regex stays anchored on the timestamp; the stream token is a fixed small enum so it is unambiguous to detect.

**Before / after (`write_log_line` call sites in `claude_cli.py`):**

```python
# before — process_stream writes stdout-derived lines untagged
write_log_line(log_file, log_line)

# after — stdout-derived lines are tagged "out"; tee thread writes "err"
write_log_line(log_file, log_line, stream="out")
```

`write_log_line` (defined in `src/worca/utils/log_lines.py:47`, *not* `claude_cli.py` — only the call sites are in `claude_cli.py`) gains `stream: str = "out"` and `stamp: bool = False` kwargs and emits `f"{ts}\t{stream}\t{text}"`. A single module-level `_LOG_WRITE_LOCK` guards the shared `log_file` handle because the `process_stream` loop (main thread) and `_tee_stderr` (background thread) will now both write it (today they do not share a handle — `_tee_stderr` only writes to `sys.stderr`).

### 2. stderr tee: persist all + parse retries

- **Current state:** `claude_cli.py:646` `_tee_stderr` iterates `proc.stderr` and writes each line to `sys.stderr` only. stderr lines carry no ISO timestamp prefix (they are raw CLI text).
- **Obstacle:** (a) stderr is never persisted, so the UI can never show it; (b) retry/backoff lines are never counted; (c) without a worca-side timestamp, err lines cannot interleave correctly by `ts` in the merged viewer.
- **Resolution:** the tee thread (a) stamps each line with worca's receive-time ISO timestamp, (b) writes it to the shared `log_file` tagged `stream="err"` (under `_LOG_WRITE_LOCK`), (c) still echoes to `sys.stderr` (unchanged console behavior), and (d) runs each line through a conservative retry matcher, incrementing a thread-safe counter and invoking an `on_retry` callback.

```python
def _tee_stderr():
    for line in proc.stderr:
        sys.stderr.write(line)            # unchanged console echo
        sys.stderr.flush()
        text = line.rstrip("\n")
        with _LOG_WRITE_LOCK:
            if log_file:
                write_log_line(log_file, text, stream="err", stamp=True)
        m = _RETRY_RE.search(text)
        if m:
            with _retry_lock:
                retry_state["count"] += 1
            if on_retry:
                on_retry(text, retry_state["count"])
```

**Retry matcher (`_RETRY_RE`)** — deliberately broad but anchored on retry vocabulary so a CLI wording tweak degrades to "we still persisted the raw err line" rather than silently zeroing the count:

```python
_RETRY_RE = re.compile(
    r"(?i)\b(?:overloaded|rate.?limit|retry(?:ing)?|too many requests|"
    r"\b429\b|\b529\b|\b503\b)\b"
)
```

The matcher is unit-tested against captured sample lines and is intentionally easy to extend. **We persist all stderr regardless of match** (per decision below) — the matcher only drives the *count* and the *event*, never what gets written.

**Backoff-window timing (`api_retry_wait_ms`).** The count alone cannot drive the timing-bar split (§6d), which needs a *duration*. Measure the wall span of each backoff burst: the tee thread stamps `retry_state["pending_since"]` (worca receive-time) on the first retry line of a burst; `process_stream`, on its next stdout event (`assistant` / `result`), closes the window under `_LOG_WRITE_LOCK` — `retry_state["wait_ms"] += now − pending_since; pending_since = None`. After `proc.wait()`, `result_event["api_retry_wait_ms"] = retry_state["wait_ms"]`. This is the wall gap of the backoff window — a tight upper bound on pure backoff (it can fold in the few ms of the resuming round-trip's setup), and distinct from the coarse run-level `non_api_wait_ms`. Per-attempt sequencing / individual backoff durations stay out of scope.

### 3. `result` event: record `api_retries` + expose wall-vs-api gap

- **Current state:** `process_stream` (`claude_cli.py:471-486`) accumulates `duration_ms`, `duration_api_ms`, `num_turns`, and `usage` across `result` events. The CLI's terminal `result` event already carries throttling-adjacent fields we capture but don't surface: `api_error_status` (null on success; HTTP status on a final API error), `usage.service_tier`, `ttft_ms`.
- **Obstacle:** the retry count lives in the tee thread, not in the parsed result; and the captured `duration_ms`/`duration_api_ms` are stored but the "non-API wait" delta is never computed or surfaced.
- **Resolution:** thread the tee's `retry_state` into the returned `result_event` after `proc.wait()` (`claude_cli.py:~664`): `result_event["api_retries"] = retry_state["count"]` and `result_event["api_retry_wait_ms"] = retry_state["wait_ms"]` (§2 backoff-window timing). Propagate `api_retries`, `api_retry_wait_ms`, `api_error_status`, and a derived `non_api_wait_ms = max(0, duration_ms - duration_api_ms)` into the per-iteration `token_usage` block written to `status.json`. Two distinct wait signals: `api_retry_wait_ms` is the **precise** measured backoff-window span (drives the timing-bar segment §6d); `non_api_wait_ms` is the **coarse** wall-vs-api delta that also folds in local tool execution (drives the per-iteration `Wait:` row §6b). `api_retries` is the precise count.

### 4. New event: `pipeline.agent.api_retry`

- **Current state:** agent telemetry events are defined in `src/worca/events/types.py` (`AGENT_SPAWNED:35`, `AGENT_TOOL_USE:36`, `AGENT_TEXT:38`, `AGENT_COMPLETED:39`) with matching payload builders (`agent_*_payload`, `:391`+) and wired into the runner's `on_event` telemetry closure (`runner.py:1569`, imports at `runner.py:96-98`).
- **Obstacle:** retries arrive on the stderr/tee path, not the stdout `on_event` path, so they need a sibling callback (`on_retry`) plumbed from the runner through `run_agent` into the tee.
- **Resolution:** add the constant + payload builder + wire an `on_retry` callback that emits the event with the active `EventContext`.

```python
# events/types.py
AGENT_API_RETRY = "pipeline.agent.api_retry"

def agent_api_retry_payload(*, stage, iteration, agent, attempt, detail, bead_id=None):
    p = {"stage": stage, "iteration": iteration, "agent": agent,
         "attempt": attempt, "detail": detail[:300]}
    if bead_id:
        p["bead_id"] = bead_id
    return p
```

Envelope `schema_version` is **not** bumped — this is a brand-new event type, not a change to an existing payload (per `docs/events.md` versioning rule: additive event types and additive payload fields are non-breaking). It is **not** Tier 1 (no chat renderer) — it is high-frequency, low-signal-per-instance telemetry; surfacing is via the per-iteration count, not a chat ping. Add it to the event catalog in `docs/events.md`.

### 5. Server: carry `stream` through to the WS payload

- **Current state:** `splitTimestamps` (`log-tailer.js:51`) returns `{ lines, timestamps }`; `readNewLines`/`readLastLines`/`readLinesFrom` return raw line arrays consumed by the tailer that builds `log-bulk` / incremental WS messages.
- **Resolution:** `parseLogLine` returns `{ ts, stream, text }` (stream defaults to `"out"` when column 2 is absent/unrecognized — back-compat for old logs and `orchestrator.log`). `splitTimestamps` returns a third parallel array `streams[]`. The `log-bulk` and incremental WS payloads gain a `streams` field alongside `lines`/`timestamps`. Server vitest covers: tagged line parse, legacy untagged line → `out`, mixed file.

### 6. UI: four coordinated surfaces

The retry signal surfaces across four places. **All four degrade to today's UI when a run has zero retries** — no segment, no chip, no tooltip line, identical render.

#### 6a. Log viewer — err coloring + 3-way stream filter
*(files: `worca-ui/app/views/log-viewer.js`, `worca-ui/app/styles.css`)*

- **Current state:** `log-viewer.js` is a terminal-style viewer (`getTerminalInstance`, `writeLogLine:132`, `clearTerminal`, `searchTerminal`) with a **stage** filter (`onStageFilter`, `:244`) and an **iteration** filter (`onIterationFilter`, `:254`) driven from `state.logLines` (objects already carrying `.stage`). The controls (`.log-controls`, `:238`) are rendered as `sl-select` dropdowns.
- **Resolution:**
  - `state.logLines` entries gain a `stream` field (from the WS `streams[]`).
  - `writeLogLine` (`:132`) emits `err` lines with an ANSI amber foreground **and** a leading `err│` gutter marker — color alone fails the `worca-ui-a11y-reviewer` color-not-alone floor. Follow `worca-ui/docs/badge-color-language.md` (amber = caution); set the ANSI palette legible on **both** light and dark terminals (cf. the `.markdown-body` dark-surface contrast gotcha in project memory — do not hardcode one theme's color).
  - **Control = `sl-radio-button` segmented group** (NOT a 3rd `sl-select`, NOT the vertical `sl-radio-group`). The two adjacent controls in `.log-controls` are data-selecting dropdowns (stage, iteration); a stream filter is a *view mode* over a fixed 3-value enum, which reads better as a one-click segmented switch. `sl-radio-button` is Shoelace's segmented primitive (same family as the export-mode `sl-radio-group` already used in `main.js`). Placed after the iteration `sl-select`, before the search `sl-input`. Default `all`. Filtering is **client-side** (`clearTerminal()` then replay the filtered buffer) — no refetch.

  ```js
  <sl-radio-group class="log-stream-filter" size="small"
      .value=${streamFilter /* 'all' | 'out' | 'err' */}
      @sl-change=${(e) => onStreamFilter(e.target.value)}>
    <sl-radio-button value="all">All</sl-radio-button>
    <sl-radio-button value="out">stdout</sl-radio-button>
    <sl-radio-button value="err">${unsafeHTML(iconSvg(AlertTriangle, 12))} stderr</sl-radio-button>
  </sl-radio-group>
  ```
  ```css
  .log-controls .log-stream-filter { flex: 0 0 auto; }
  .log-stream-filter sl-radio-button[value="err"]::part(button--checked) { color: var(--status-blocked, #f59e0b); }
  ```

#### 6b. Run-detail — per-iteration retry chip + wait time
*(file: `worca-ui/app/views/run-detail.js`, `_iterationDetailView` `:1599`)*

Add two `.stage-info-item`s to the iteration `.stage-info-strip`, immediately after the existing `API:` item:
- a precise **retry-count chip** (`⟳ N retries`, amber `iter-retry-warn` class) when `iter.api_retries > 0`;
- a **`Wait:` time + %** item from `iter.non_api_wait_ms`, computed as a % of iteration wall (`elapsed(started_at, completed_at)`, matching the `API:` %-calc at `:1627`), with an `sl-tooltip` noting it's coarse (tools + backoff) and surfacing `api_error_status` when present.

The label is honestly `Wait` because `non_api_wait_ms` is coarse; the precise signal is the adjacent count chip. Requires `iter.api_retries` / `non_api_wait_ms` / `api_error_status` surfaced onto the iteration view-model (W-074 writes them to `token_usage` in §3).

```js
${iter.api_retries ? html`<span class="stage-info-item iter-retry-warn">
  ${unsafeHTML(iconSvg(RefreshCw, 12))}
  <span class="meta-value">${iter.api_retries} ${iter.api_retries === 1 ? 'retry' : 'retries'}</span>
</span>` : nothing}
${iter.non_api_wait_ms ? html`<span class="stage-info-item">
  <sl-tooltip content="Wall time not generating tokens (tools + API retry/backoff)${iter.api_error_status ? ` · last API status ${iter.api_error_status}` : ''}">
    <span class="meta-label">Wait:</span>
    <span class="meta-value">${formatDuration(iter.non_api_wait_ms)}${iter.started_at && iter.completed_at ? ` (${Math.round((iter.non_api_wait_ms / elapsed(iter.started_at, iter.completed_at)) * 100)}%)` : ''}</span>
  </sl-tooltip>
</span>` : nothing}
```

#### 6c. Run-detail — collapsed stage-header retry chip + Duration tooltip
*(file: `worca-ui/app/views/run-detail.js`, stage summary slot `:2169`)*

Two additions to the `sl-details` summary so the signal is visible **even when the stage is collapsed**:
- an at-a-glance `⟳ N` `.stage-meta-item` in `.stage-panel-meta` when `stageRetries > 0` (sums `iter.api_retries` across the stage), amber — sits alongside the existing turns / cost / timer meta items. *(This replaces the standalone `⟳ N retries` "pill" from the earlier draft — the count now lives in the meta strip, per-iteration chips, and the bar.)*
- wrap the existing **Duration** meta item (Timer icon + `${stageDuration}`) in an `sl-tooltip hoist` showing the across-iterations breakdown, reusing the `stageApiMs` / `stageApiPct` aggregates already computed for the expanded body (`:2285`). `hoist` is **mandatory** — the tooltip lives inside the `sl-details` summary and would otherwise clip (same `hoist`+`placement` pattern as the bead tooltip at `:1711`).

```js
<sl-tooltip hoist placement="bottom" distance="4">
  <div slot="content">
    <strong>Duration ${stageDuration}</strong><br>
    Thinking (API): ${formatDuration(stageApiMs)} (${stageApiPct}%)<br>
    Tools + retry wait: ${formatDuration(stageNonApiMs)} (${100 - stageApiPct}%)
    ${stageRetries ? html`<br>⟳ ${stageRetries} API retries` : nothing}
  </div>
  <span class="meta-value">${stageDuration}</span>
</sl-tooltip>
```

#### 6d. Run-detail — timing-bar "API Retry/Wait" segment
*(files: `worca-ui/app/views/run-detail.js`, `_pipelineTimingBar` `:357`; `worca-ui/app/styles.css`)*

**Correctness fix first:** today `toolsMs = sessionMs − thinkingMs` (`:371`). The CLI's 429/529 backoff sleeps *inside* the session but *outside* `duration_api_ms`, so backoff time is currently mis-bucketed into **"Tools (Agent)"**, silently inflating it. (The "Rest of Pipeline" segment's tooltip claims "retry delays" but `restMs = wall − session`, so backoff is not actually there.)

**Resolution — always-on dedicated segment (Option 2, chosen):** carve a new `API Retry/Wait` segment out of `toolsMs` using the precise `api_retry_wait_ms` (§2/§3):

```js
const retryWaitMs = allIters.reduce((s, it) => s + (it.api_retry_wait_ms || 0), 0);
const toolsMs = Math.max(0, sessionMs - thinkingMs - retryWaitMs);  // was sessionMs - thinkingMs
// new segment between 'tools' and 'rest' in the segments array:
{ key: 'retry', pct: Math.round((retryWaitMs / pipelineWallMs) * 100), ms: retryWaitMs,
  label: 'API Retry/Wait', desc: 'Time stalled in CLI backoff after 429/529 throttling', cls: 'timing-bar-retry' }
```

Always-visible (**not** hover-to-split, **not** tooltip-only) because the whole point of W-074 is that backoff was *invisible* and runs "looked hung" — burying it behind a hover re-hides the very thing we're surfacing. The bar already `.filter(s => s.pct > 0)`s, so a zero-retry run renders byte-identically to today; the legend and per-segment `sl-tooltip` auto-pick-up the new entry.

**Color = a striped gradient (pattern, not solid)** so the meaning survives colorblindness + the a11y color-not-alone floor and stays visually distinct from the *solid* amber "Thinking" segment:

```css
.timing-bar-retry {
  background: repeating-linear-gradient(45deg,
    var(--status-error, #dc2626), var(--status-error, #dc2626) 5px,
    var(--status-blocked, #f59e0b) 5px, var(--status-blocked, #f59e0b) 10px);
}
```

This requires `api_retry_wait_ms` (a measured duration, not a count — see §2/§3). Bar geometry can't be drawn from a count, and `non_api_wait_ms` is too coarse (it includes real tool time) to render as "retry."

### 7. Data flow (ASCII)

```
claude CLI ── stdout (NDJSON) ──► process_stream ──► write_log_line(…, stream="out") ─┐
            │                         │   └─ closes backoff window: wait_ms += now−pending_since      ├─► logs/<stage>/iter-N.log  (ts \t stream \t text)
            └─ stderr (raw text) ──► _tee_stderr ──► write_log_line(…, stream="err") ──┘            │
                                        │                                                            │
                                        ├─ _RETRY_RE match ─► retry_state.count++ ; pending_since=now ─► on_retry ─► emit pipeline.agent.api_retry
                                        └─ console echo (unchanged)                                  │
                                                                                                     ▼
result_event{api_retries, api_retry_wait_ms, api_error_status, non_api_wait_ms} ─► token_usage in status.json   log-tailer.js parseLogLine ─► {ts,stream,text}
                                                                                                     │
                                                                                            WS log-bulk {lines, timestamps, streams}
                                                                                                     ▼
       run-detail.js: timing-bar "API Retry/Wait" segment (6d) · per-iter retry chip + Wait% (6b) · stage-header ⟳N + Duration tooltip (6c)
       log-viewer.js: err coloring + 3-way stream filter (6a)
```

## Implementation Plan

Phases are vertical capability slices, not layers.

### Phase 1: Tagged log format + stderr persistence (Python, end-to-end write path)
**Files:** `src/worca/utils/log_lines.py`, `src/worca/utils/claude_cli.py`
**Tasks:**
1. `log_lines.py`: add `stream: str = "out"` and `stamp: bool = False` kwargs to `write_log_line`; emit `<ts>\t<stream>\t<text>` (stamp the ts when `stamp=True`, for stderr).
2. `claude_cli.py`: add module-level `_LOG_WRITE_LOCK`; guard the `process_stream` log writes (`:431`,`:469`) with it and pass `stream="out"`.
3. Rewrite `_tee_stderr` (`:646`) to stamp + write `stream="err"` under the lock, keep the console echo, and run `_RETRY_RE` per line into a thread-safe `retry_state` + optional `on_retry`.
4. Add `_RETRY_RE`.

### Phase 2: Retry count + backoff timing + api_retry event (Python, signal surfacing)
**Files:** `src/worca/utils/claude_cli.py`, `src/worca/events/types.py`, `src/worca/orchestrator/runner.py`, `docs/events.md`
**Tasks:**
1. Backoff-window timing: tee stamps `retry_state["pending_since"]` on the first retry line of a burst; `process_stream` closes the window on its next stdout event (`retry_state["wait_ms"] += now − pending_since`) under `_LOG_WRITE_LOCK`.
2. `run_agent` (`claude_cli.py:520`): accept `on_retry`; after `proc.wait()` (`:664`), set `result_event["api_retries"] = retry_state["count"]` and `result_event["api_retry_wait_ms"] = retry_state["wait_ms"]`.
3. `events/types.py`: add `AGENT_API_RETRY` constant + `agent_api_retry_payload`.
4. `runner.py`: import the constant/payload (`:97`), and in the telemetry wiring (event handler `_make_agent_event_handler` ~`:1564`, `on_event` plumbing ~`:1786`/`:1842`) pass an `on_retry` closure that `emit_event(ctx, AGENT_API_RETRY, …)`.
5. Propagate `api_retries`, `api_retry_wait_ms`, `api_error_status`, `non_api_wait_ms` into the per-iteration `token_usage` written to `status.json` (and surface them onto the iteration view-model the UI reads).
6. `docs/events.md`: add the `pipeline.agent.api_retry` row (note: new event, no `schema_version` bump).

### Phase 3: Server stream passthrough (JS)
**Files:** `worca-ui/server/log-tailer.js`
**Tasks:**
1. `parseLogLine` → `{ ts, stream, text }` with `out` default for untagged/legacy lines.
2. `splitTimestamps` → add parallel `streams[]`.
3. Add `streams` to the `log-bulk` + incremental WS payloads (in the tailer module that builds them).

### Phase 4: UI — four surfaces (viewer filter, iteration row, stage header, timing bar)
**Files:** `worca-ui/app/views/log-viewer.js`, `worca-ui/app/views/run-detail.js`, `worca-ui/app/styles.css`
**Tasks:**
1. **6a — Log viewer:** carry `stream` onto `state.logLines`; `writeLogLine` colors `err` (ANSI amber + `err│` gutter, light/dark safe); add `onStreamFilter` + an `sl-radio-button` segmented control in `.log-controls` (default `all`); client-side replay on change.
2. **6b — Iteration row:** in `_iterationDetailView` (`:1599`), add the `⟳ N retries` chip + `Wait:` time+% items to `.stage-info-strip` (after `API:`), sourced from `iter.api_retries` / `non_api_wait_ms` / `api_error_status`.
3. **6c — Stage header:** in the `sl-details` summary (`:2169`), add the at-a-glance `⟳ N` `.stage-meta-item` (when `stageRetries > 0`) and wrap the Duration meta item in an `sl-tooltip hoist` with the across-iterations breakdown.
4. **6d — Timing bar:** in `_pipelineTimingBar` (`:357`), subtract `api_retry_wait_ms` from `toolsMs` and add the striped `API Retry/Wait` segment between `tools` and `rest`; add `.timing-bar-retry` CSS.
5. `npm run build` to refresh `app/main.bundle.js`.

### Files Changed Summary

| File | Change |
|------|--------|
| `src/worca/utils/log_lines.py` | `write_log_line` gains `stream`/`stamp` kwargs; emit `<ts>\t<stream>\t<text>` |
| `src/worca/utils/claude_cli.py` | `_LOG_WRITE_LOCK`; `_tee_stderr` persist+parse+count+`pending_since`; `_RETRY_RE`; `process_stream` closes backoff window into `wait_ms`; `run_agent` `on_retry` + `api_retries`/`api_retry_wait_ms` on result |
| `src/worca/events/types.py` | `AGENT_API_RETRY` constant + `agent_api_retry_payload` |
| `src/worca/orchestrator/runner.py` | import + emit `api_retry`; propagate `api_retries`/`api_retry_wait_ms`/`api_error_status`/`non_api_wait_ms` into `token_usage` + iteration view-model |
| `docs/events.md` | document `pipeline.agent.api_retry` |
| `worca-ui/server/log-tailer.js` | `parseLogLine`/`splitTimestamps` carry `stream`; WS payload `streams[]` |
| `worca-ui/app/views/log-viewer.js` | 6a — err coloring, `sl-radio-button` 3-way stream filter, client-side replay |
| `worca-ui/app/views/run-detail.js` | 6b — per-iter retry chip + `Wait:` row; 6c — stage-header `⟳ N` + Duration `sl-tooltip hoist`; 6d — `API Retry/Wait` timing-bar segment + `toolsMs` correction |
| `worca-ui/app/styles.css` | err line / `.log-stream-filter` / `.iter-retry-warn` / `.timing-bar-retry` styling (light+dark) |

## Considerations

- **stderr volume — decision: persist ALL stderr tagged `err` (not just retry matches).** The CLI may print non-retry noise (progress, warnings); persisting everything means the line you need is never filtered away at write time, and the 3-way toggle keeps it one click out of view. Cost: larger iter logs. Accepted — the toggle exists precisely to manage the noise. The retry *matcher* only drives the count/event, never what is written.
- **Reject FD-level merge (`stderr=subprocess.STDOUT`).** stdout is load-bearing NDJSON; `result` events exceed `PIPE_BUF` and would be corruptible by mid-line stderr interleaving → dropped `result`/`structured_output`. Application-layer tagging keeps stdout pristine and keeps err lines labeled. (This is the explicit alternative considered and rejected.)
- **Concurrency:** `process_stream` (main thread) and `_tee_stderr` (daemon thread) now share `log_file` → `_LOG_WRITE_LOCK` is mandatory; without it, interleaved writes corrupt lines in the very file we're trying to make trustworthy.
- **Two wait signals, deliberately.** `api_retry_wait_ms` is the **precise** measured backoff-window span (drives the timing-bar segment §6d and is an upper bound only by the few ms of resume setup). `non_api_wait_ms = duration_ms − duration_api_ms` is **coarse** — it also folds in local tool execution (greps, edits, `pytest`/`vitest`), so it drives the per-iteration `Wait:` row §6b labeled honestly as "tools + retry." `api_retries` is the precise count. Label all three distinctly; never draw bar geometry from the coarse number.
- **Timing-bar misattribution fix.** Today `_pipelineTimingBar` computes `toolsMs = sessionMs − thinkingMs`; CLI backoff sleeps inside the session but outside `duration_api_ms`, so backoff currently inflates the **"Tools (Agent)"** segment. §6d carves it out using `api_retry_wait_ms`, which both adds the new signal and *corrects* the existing Tools number. A zero-retry run renders identically to today (segment filtered out at `pct === 0`).
- **Matcher brittleness** — `_RETRY_RE` depends on CLI stderr wording. Mitigation: persist-all means a wording drift loses only the count, not the evidence; the matcher is unit-tested against captured samples and trivially extensible.
- **Governance:** no dispatch/permission changes. The stderr path is read-only telemetry. Dispatch `worca-event-payload-reviewer` (new event type) and `worca-ui-design-reviewer` + `worca-ui-a11y-reviewer` (viewer color/contrast/color-not-alone).
- **Breaking changes:** none. The log format change is backward-compatible (untagged legacy lines → `out`); the event is additive; the WS `streams` field is additive (clients default to `out`).
- **Migration:** none required. Old run logs render as all-`out`. No config keys change.

## Test Plan

### Unit Tests

| Layer | Test | Validates |
|-------|------|-----------|
| Python | `test_write_log_line_tags_stream` | `write_log_line(…, stream="err")` emits `ts\terr\ttext` |
| Python | `test_tee_stderr_persists_and_counts` | err lines persisted tagged + `_RETRY_RE` increments count |
| Python | `test_retry_re_matches_samples` | matcher hits captured 429/529/overloaded/retrying lines, misses benign lines |
| Python | `test_run_agent_sets_api_retries` | `result_event["api_retries"]` reflects tee count |
| Python | `test_run_agent_sets_api_retry_wait_ms` | backoff window (`pending_since` → next stdout event) accumulates into `wait_ms` on the result |
| Python | `test_agent_api_retry_payload` | payload shape, `bead_id` omission, `detail` truncation |
| Python | `test_token_usage_carries_retry_fields` | `status.json` token_usage gets `api_retries`/`api_retry_wait_ms`/`api_error_status`/`non_api_wait_ms` |
| JS (vitest, server) | `parseLogLine` tagged / legacy-untagged / mixed | `stream` defaults to `out`, parses `err` |
| JS (vitest, server) | `splitTimestamps` returns `streams[]` | parallel array aligns with lines |
| JS (vitest, component) | `_pipelineTimingBar` retry segment | with `api_retry_wait_ms > 0` a `.timing-bar-retry` segment renders, `toolsMs` is reduced; with `0` the segment is absent (identical to today) |
| JS (vitest, component) | iteration `Wait:` row + retry chip | `.iter-retry-warn` chip + `Wait:` %-of-wall render from `iter.api_retries`/`non_api_wait_ms`; absent when zero |
| JS (vitest, component) | stage-header Duration tooltip | `sl-tooltip hoist` breakdown + `⟳ N` meta item aggregate across iterations |

### Integration / E2E Tests
- `worca-ui/app/` (vitest, component): `log-viewer` stream filter — `all`/`out`/`err` replay filters the in-memory buffer correctly and err lines carry the gutter marker. (Component-level, not a pure unit, so listed here rather than in the unit table.)
- `tests/integration/`: a ≤30 LOC mock-claude run whose mock emits a synthetic stderr "overloaded, retrying" line; assert `iter-N.log` contains an `\terr\t` line, `status.json` token_usage shows `api_retries >= 1` and `api_retry_wait_ms >= 0`, and a `pipeline.agent.api_retry` event lands in `events.jsonl`. (Extend `tests/mock_claude/mock_claude.py` to optionally print a stderr retry line.)
- Playwright (`worca-ui/e2e/`): the diff touches `worca-ui/app/` + `server/`, so a viewer spec is required — assert the `sl-radio-button` 3-way control toggles visible lines and err lines are styled; assert a run with retries renders the `.timing-bar-retry` segment and the stage-header `⟳ N` meta item. (Conditional-Playwright rule in CLAUDE.md.)

### Existing Tests to Update
- `worca-ui/server/` tests asserting `splitTimestamps`/`parseLogLine` return shape (now includes `streams`/`stream`).
- Any `log-viewer` vitest asserting `state.logLines` entry shape (now has `stream`).
- `tests/test_event_types.py` event-catalog completeness test (if it enumerates all event constants).
- Per-failure attribution rules apply (name each failing test, verify against parent commit).

## Files to Create/Modify

| File | Create/Modify | Purpose |
|------|---------------|---------|
| `src/worca/utils/log_lines.py` | Modify | `write_log_line` `stream`/`stamp` kwargs + tagged format |
| `src/worca/utils/claude_cli.py` | Modify | lock, tee persist+parse, backoff-window `wait_ms`, `api_retries`/`api_retry_wait_ms` |
| `src/worca/events/types.py` | Modify | `AGENT_API_RETRY` + payload |
| `src/worca/orchestrator/runner.py` | Modify | emit event, propagate retry fields to token_usage + iteration VM |
| `docs/events.md` | Modify | document new event |
| `worca-ui/server/log-tailer.js` | Modify | `stream` parse + WS passthrough |
| `worca-ui/app/views/log-viewer.js` | Modify | 6a — coloring + `sl-radio-button` 3-way filter |
| `worca-ui/app/views/run-detail.js` | Modify | 6b iteration row, 6c stage-header tooltip + `⟳ N`, 6d timing-bar segment + `toolsMs` fix |
| `worca-ui/app/styles.css` | Modify | err / `.log-stream-filter` / `.iter-retry-warn` / `.timing-bar-retry` styling |
| `tests/test_log_lines.py` | Modify/Create | tagged-format / `stamp` tests |
| `tests/test_claude_cli.py` | Modify/Create | tee/matcher/backoff-window/run_agent tests |
| `tests/test_event_types.py` | Modify | api_retry payload test |
| `tests/integration/test_api_retry_signal.py` | Create | end-to-end mock-claude retry capture |
| `tests/mock_claude/mock_claude.py` | Modify | optional synthetic stderr retry line |
| `worca-ui/server/*log*.test.js` | Modify | `stream`/`streams` shape |
| `worca-ui/app/views/log-viewer*.test.js` | Modify/Create | filter + coloring |
| `worca-ui/app/views/run-detail*.test.js` | Modify/Create | timing-bar retry segment, iteration `Wait:` row, stage-header tooltip |
| `worca-ui/e2e/log-viewer*.spec.js` | Modify/Create | stream toggle + styling + retry-segment e2e |

## Out of Scope

- **Per-attempt sequencing / individual backoff durations** — we measure the *aggregate* backoff-window wall span (`api_retry_wait_ms`, §2) to drive the timing-bar segment, but not each attempt's duration or the inter-attempt order; the persisted err text carries that detail for anyone who needs it.
- **Surfacing throttling in chat integrations** — `api_retry` is intentionally not Tier 1 (no renderer). High-frequency, low per-instance signal.
- **A dedicated throttling dashboard / cross-run analytics** — this plan delivers per-run capture + per-iteration count + drill-down log only.
- **Distinguishing throttling from network/tool latency inside `non_api_wait_ms`** — it stays a labeled coarse upper bound; `api_retries` is the precise number.
- **Changing the CLI invocation or retry policy** — worca observes, it does not tune the CLI's backoff.
- **Retrofitting historical run logs** — old logs render as all-`out`; no backfill.
