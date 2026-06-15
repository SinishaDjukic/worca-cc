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

Tag every persisted log line by its origin stream (`out` / `err`), persist **all** stderr (not just matches) into the existing per-iteration log with the tag, parse stderr in the tee thread to count retries and emit a new `pipeline.agent.api_retry` event, record a per-iteration `api_retries` count in `status.json`, and extend the UI log viewer with err-line coloring plus a 3-way stream filter (`out+err` default / `out` only / `err` only). The `stream` tag in the log line format is the spine that makes the retry parse, the persisted err stream, and the UI filter all hang together.

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

`write_log_line` gains a `stream: str = "out"` kwarg and emits `f"{ts}\t{stream}\t{text}"`. A single module-level `_LOG_WRITE_LOCK` guards the shared `log_file` handle because the `process_stream` loop (main thread) and `_tee_stderr` (background thread) will now both write it (today they do not share a handle — `_tee_stderr` only writes to `sys.stderr`).

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

### 3. `result` event: record `api_retries` + expose wall-vs-api gap

- **Current state:** `process_stream` (`claude_cli.py:471-486`) accumulates `duration_ms`, `duration_api_ms`, `num_turns`, and `usage` across `result` events. The CLI's terminal `result` event already carries throttling-adjacent fields we capture but don't surface: `api_error_status` (null on success; HTTP status on a final API error), `usage.service_tier`, `ttft_ms`.
- **Obstacle:** the retry count lives in the tee thread, not in the parsed result; and the captured `duration_ms`/`duration_api_ms` are stored but the "non-API wait" delta is never computed or surfaced.
- **Resolution:** thread the tee's `retry_state` into the returned `result_event` after `proc.wait()` (`claude_cli.py:~664`): `result_event["api_retries"] = retry_state["count"]`. Propagate `api_retries`, `api_error_status`, and a derived `non_api_wait_ms = max(0, duration_ms - duration_api_ms)` into the per-iteration `token_usage` block written to `status.json`. The wall-vs-api delta includes local tool execution time (not pure throttling), so it is labeled `non_api_wait_ms` (a coarse upper bound), while `api_retries` is the precise signal.

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

### 6. UI: err coloring + 3-way stream filter

- **Current state:** `worca-ui/app/views/log-viewer.js` is a terminal-style viewer (`getTerminalInstance`, `writeLogLine:132`, `clearTerminal`, `searchTerminal`). It already has a **stage** filter (`onStageFilter`, `:244`) and an **iteration** filter (`onIterationFilter`, `:254`) driven from `state.logLines` (objects already carrying `.stage`). `logViewerView` (`:198`) renders the controls via `sl-select`.
- **Obstacle:** lines must know their stream to be filtered/colored; the terminal re-renders from the in-memory buffer on filter change.
- **Resolution:**
  - `state.logLines` entries gain a `stream` field (populated from the WS `streams[]`).
  - `writeLogLine` (`:132`) emits err lines with an ANSI color + a non-color gutter marker. Use a muted amber/red foreground **and** a leading `err│` gutter tag — color alone fails accessibility (the `worca-ui-a11y-reviewer` floor: color-not-alone). Follow `worca-ui/docs/badge-color-language.md` semantics (amber = caution); set the ANSI palette so it is legible on **both** light and dark terminals (cf. the `.markdown-body` dark-surface contrast gotcha in project memory — do not hardcode one theme's color).
  - Add a 3-way control mirroring the existing filters: an `sl-radio-group` / segmented `sl-button-group` with `out+err` (default) / `out` / `err`, wired to a new `onStreamFilter` handler. Filtering is **client-side** from the already-streamed buffer (no refetch) — on change, `clearTerminal()` then replay the filtered `logLines`. Default = merged.
  - **Retries pill (canonical placement spec):** a small `⟳ N retries` pill sourced from `api_retries` in `token_usage` (fallback: counted `api_retry` events) — the at-a-glance signal, with the err-filtered log as the drill-down. It lives in the **run-detail stage section** (`run-detail.js`), **not** in the log viewer. Phase 4 and the Files table reference this placement rather than re-specifying it.

### 7. Data flow (ASCII)

```
claude CLI ── stdout (NDJSON) ──► process_stream ──► write_log_line(…, stream="out") ─┐
            │                         │                                                 ├─► logs/<stage>/iter-N.log   (ts \t stream \t text)
            └─ stderr (raw text) ──► _tee_stderr ──► write_log_line(…, stream="err") ──┘            │
                                        │                                                            │
                                        ├─ _RETRY_RE match ─► retry_state.count++ ─► on_retry ─► emit pipeline.agent.api_retry
                                        └─ console echo (unchanged)                                  │
                                                                                                     ▼
result_event{api_retries, api_error_status, non_api_wait_ms} ─► token_usage in status.json   log-tailer.js parseLogLine ─► {ts,stream,text}
                                                                                                     │
                                                                                            WS log-bulk {lines, timestamps, streams}
                                                                                                     ▼
                                                                              log-viewer.js: err coloring + 3-way filter + retries pill
```

## Implementation Plan

Phases are vertical capability slices, not layers.

### Phase 1: Tagged log format + stderr persistence (Python, end-to-end write path)
**Files:** `src/worca/utils/claude_cli.py`
**Tasks:**
1. Add `stream: str = "out"` and `stamp: bool = False` kwargs to `write_log_line`; emit `<ts>\t<stream>\t<text>` (stamp the ts when `stamp=True`, for stderr).
2. Add module-level `_LOG_WRITE_LOCK`; guard the `process_stream` log writes (`claude_cli.py:431`,`:469`) with it and pass `stream="out"`.
3. Rewrite `_tee_stderr` (`:646`) to stamp + write `stream="err"` under the lock, keep the console echo, and run `_RETRY_RE` per line into a thread-safe `retry_state` + optional `on_retry`.
4. Add `_RETRY_RE`.

### Phase 2: Retry count + api_retry event (Python, signal surfacing)
**Files:** `src/worca/utils/claude_cli.py`, `src/worca/events/types.py`, `src/worca/orchestrator/runner.py`, `docs/events.md`
**Tasks:**
1. `run_agent` (`claude_cli.py:520`): accept `on_retry`; after `proc.wait()`, set `result_event["api_retries"] = retry_state["count"]`.
2. `events/types.py`: add `AGENT_API_RETRY` constant + `agent_api_retry_payload`.
3. `runner.py`: import the constant/payload (`:96-98`), and in the telemetry wiring (`:1569`) pass an `on_retry` closure that `emit_event(ctx, AGENT_API_RETRY, …)`.
4. Propagate `api_retries`, `api_error_status`, `non_api_wait_ms` into the per-iteration `token_usage` written to `status.json`.
5. `docs/events.md`: add the `pipeline.agent.api_retry` row (note: new event, no `schema_version` bump).

### Phase 3: Server stream passthrough (JS)
**Files:** `worca-ui/server/log-tailer.js`
**Tasks:**
1. `parseLogLine` → `{ ts, stream, text }` with `out` default for untagged/legacy lines.
2. `splitTimestamps` → add parallel `streams[]`.
3. Add `streams` to the `log-bulk` + incremental WS payloads (in the tailer module that builds them).

### Phase 4: Viewer coloring + 3-way filter + retries pill (UI)
**Files:** `worca-ui/app/views/log-viewer.js`, `worca-ui/app/styles.css`, run-detail stage header (`worca-ui/app/views/run-detail.js`)
**Tasks:**
1. Carry `stream` onto `state.logLines`; `writeLogLine` colors `err` (ANSI amber + `err│` gutter), light/dark safe.
2. Add `onStreamFilter` + segmented control (default `out+err`); client-side replay on change.
3. Add the `⟳ N retries` pill to run-detail per the canonical placement in Design §6 (run-detail stage section, not the viewer).
4. `npm run build` to refresh `app/main.bundle.js`.

### Files Changed Summary

| File | Change |
|------|--------|
| `src/worca/utils/claude_cli.py` | `write_log_line` stream/stamp kwargs + lock; `_tee_stderr` persist+parse+retry count; `_RETRY_RE`; `run_agent` `on_retry` + `api_retries` on result |
| `src/worca/events/types.py` | `AGENT_API_RETRY` constant + `agent_api_retry_payload` |
| `src/worca/orchestrator/runner.py` | import + emit `api_retry`; propagate `api_retries`/`api_error_status`/`non_api_wait_ms` into `token_usage` |
| `docs/events.md` | document `pipeline.agent.api_retry` |
| `worca-ui/server/log-tailer.js` | `parseLogLine`/`splitTimestamps` carry `stream`; WS payload `streams[]` |
| `worca-ui/app/views/log-viewer.js` | err coloring, 3-way stream filter, client-side replay |
| `worca-ui/app/views/run-detail.js` | retries pill in stage section |
| `worca-ui/app/styles.css` | err line / control styling (light+dark) |

## Considerations

- **stderr volume — decision: persist ALL stderr tagged `err` (not just retry matches).** The CLI may print non-retry noise (progress, warnings); persisting everything means the line you need is never filtered away at write time, and the 3-way toggle keeps it one click out of view. Cost: larger iter logs. Accepted — the toggle exists precisely to manage the noise. The retry *matcher* only drives the count/event, never what is written.
- **Reject FD-level merge (`stderr=subprocess.STDOUT`).** stdout is load-bearing NDJSON; `result` events exceed `PIPE_BUF` and would be corruptible by mid-line stderr interleaving → dropped `result`/`structured_output`. Application-layer tagging keeps stdout pristine and keeps err lines labeled. (This is the explicit alternative considered and rejected.)
- **Concurrency:** `process_stream` (main thread) and `_tee_stderr` (daemon thread) now share `log_file` → `_LOG_WRITE_LOCK` is mandatory; without it, interleaved writes corrupt lines in the very file we're trying to make trustworthy.
- **`non_api_wait_ms` is coarse** — it folds in local tool execution (greps, edits, `pytest`/`vitest` runs), so it is an upper bound on throttling, not a measurement. `api_retries` is the precise signal; label them distinctly in the UI.
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
| Python | `test_agent_api_retry_payload` | payload shape, `bead_id` omission, `detail` truncation |
| Python | `test_token_usage_carries_retry_fields` | `status.json` token_usage gets `api_retries`/`api_error_status`/`non_api_wait_ms` |
| JS (vitest, server) | `parseLogLine` tagged / legacy-untagged / mixed | `stream` defaults to `out`, parses `err` |
| JS (vitest, server) | `splitTimestamps` returns `streams[]` | parallel array aligns with lines |

### Integration / E2E Tests
- `worca-ui/app/` (vitest, component): `log-viewer` stream filter — merged/out/err replay filters the in-memory buffer correctly and err lines carry the gutter marker. (Component-level, not a pure unit, so listed here rather than in the unit table.)
- `tests/integration/`: a ≤30 LOC mock-claude run whose mock emits a synthetic stderr "overloaded, retrying" line; assert `iter-N.log` contains an `\terr\t` line, `status.json` token_usage shows `api_retries >= 1`, and a `pipeline.agent.api_retry` event lands in `events.jsonl`. (Extend `tests/mock_claude/mock_claude.py` to optionally print a stderr retry line.)
- Playwright (`worca-ui/e2e/`): the diff touches `worca-ui/app/` + `server/`, so a viewer spec is required — assert the 3-way control toggles visible lines and err lines are styled. (Conditional-Playwright rule in CLAUDE.md.)

### Existing Tests to Update
- `worca-ui/server/` tests asserting `splitTimestamps`/`parseLogLine` return shape (now includes `streams`/`stream`).
- Any `log-viewer` vitest asserting `state.logLines` entry shape (now has `stream`).
- `tests/test_event_types.py` event-catalog completeness test (if it enumerates all event constants).
- Per-failure attribution rules apply (name each failing test, verify against parent commit).

## Files to Create/Modify

| File | Create/Modify | Purpose |
|------|---------------|---------|
| `src/worca/utils/claude_cli.py` | Modify | format tag, lock, tee persist+parse, `api_retries` |
| `src/worca/events/types.py` | Modify | `AGENT_API_RETRY` + payload |
| `src/worca/orchestrator/runner.py` | Modify | emit event, propagate retry fields to token_usage |
| `docs/events.md` | Modify | document new event |
| `worca-ui/server/log-tailer.js` | Modify | `stream` parse + WS passthrough |
| `worca-ui/app/views/log-viewer.js` | Modify | coloring + 3-way filter |
| `worca-ui/app/views/run-detail.js` | Modify | retries pill |
| `worca-ui/app/styles.css` | Modify | err/control styling |
| `tests/test_claude_cli.py` | Modify/Create | tee/format/matcher/run_agent tests |
| `tests/test_event_types.py` | Modify | api_retry payload test |
| `tests/integration/test_api_retry_signal.py` | Create | end-to-end mock-claude retry capture |
| `tests/mock_claude/mock_claude.py` | Modify | optional synthetic stderr retry line |
| `worca-ui/server/*log*.test.js` | Modify | `stream`/`streams` shape |
| `worca-ui/app/views/log-viewer*.test.js` | Modify/Create | filter + coloring |
| `worca-ui/e2e/log-viewer*.spec.js` | Modify/Create | toggle + styling e2e |

## Out of Scope

- **Parsing per-retry backoff duration / attempt sequencing** — count + raw line only; the persisted err text carries the detail for anyone who needs it.
- **Surfacing throttling in chat integrations** — `api_retry` is intentionally not Tier 1 (no renderer). High-frequency, low per-instance signal.
- **A dedicated throttling dashboard / cross-run analytics** — this plan delivers per-run capture + per-iteration count + drill-down log only.
- **Distinguishing throttling from network/tool latency inside `non_api_wait_ms`** — it stays a labeled coarse upper bound; `api_retries` is the precise number.
- **Changing the CLI invocation or retry policy** — worca observes, it does not tune the CLI's backoff.
- **Retrofitting historical run logs** — old logs render as all-`out`; no backfill.
