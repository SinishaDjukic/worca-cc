# W-003: Pipeline Events & Webhooks

**Date:** 2026-03-09
**Status:** Draft
**Author:** (auto-generated)

---

## 1. Goal & Scope

Emit structured events at every meaningful point in the worca-cc pipeline so that external systems (dashboards, chat bots, CI/CD, monitoring) can react in real time.

**In scope:**

- Define a versioned event schema covering all pipeline lifecycle moments.
- Build an event emitter module that writes events to an append-only JSONL file and optionally delivers them via HTTP POST webhooks.
- Integrate the emitter into `runner.py` at each stage transition, loop-back, error, and pipeline completion.
- Add webhook configuration under the existing `worca` namespace in `settings.json`.
- Provide retry logic with exponential backoff for webhook delivery.
- Expose the event log to worca-ui via the existing WebSocket server.

**Out of scope (future extensions noted in section 9):**

- Slack, Discord, or email notification channels.
- Event filtering or routing rules beyond per-URL enable/disable.
- Persistent event store (database-backed).
- Authentication for inbound webhook receivers (beyond shared secret signing).

---

## 2. Event Schema Design

### 2.1 Envelope

Every event shares a common envelope. All fields are required unless noted.

```
{
  "schema_version": "1",
  "event_id":       "<uuid4>",
  "event_type":     "<dotted.event.type>",
  "timestamp":      "<ISO-8601 UTC>",
  "run_id":         "<12-char hex, matches watcher.js createRunId>",
  "pipeline": {
    "branch":       "<git branch name>",
    "work_request": { "title": "...", "source_ref": "...", "priority": "..." }
  },
  "payload":        { /* event-type-specific data */ }
}
```

- `schema_version` starts at `"1"`. Bump only on breaking changes. Additive fields do not bump.
- `event_id` is a UUID4 generated at emit time; guarantees idempotent processing.
- `run_id` uses the same SHA-256-based algorithm as `watcher.js:createRunId()` and `runner.py:_archive_run()` to enable correlation with existing UI and results files.

### 2.2 Event Types

Dotted naming convention: `pipeline.<noun>.<verb>`.

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.run.started` | `run_pipeline()` begins, after `init_status()` or resume detection | `resume: bool`, `started_at` |
| `pipeline.run.completed` | Pipeline finishes successfully (all stages done) | `duration_ms`, `total_cost_usd`, `total_turns` |
| `pipeline.run.failed` | Unrecoverable error (PipelineError, LoopExhaustedError) | `error`, `failed_stage`, `error_type` |
| `pipeline.run.interrupted` | SIGTERM/SIGINT caught (PipelineInterrupted) | `interrupted_stage` |
| `pipeline.run.resumed` | Pipeline resumes from a prior checkpoint | `resume_stage`, `previous_stage` |
| `pipeline.stage.started` | A stage iteration begins (after `start_iteration()`) | `stage`, `iteration`, `agent`, `model`, `trigger` |
| `pipeline.stage.completed` | A stage iteration finishes successfully | `stage`, `iteration`, `duration_ms`, `cost_usd`, `turns`, `outcome` |
| `pipeline.stage.failed` | A stage iteration errors out | `stage`, `iteration`, `error`, `error_type` |
| `pipeline.stage.interrupted` | A stage is interrupted by signal | `stage`, `iteration` |
| `pipeline.milestone.set` | A milestone gate is evaluated | `milestone`, `value` (bool), `stage` |
| `pipeline.loop.triggered` | A loop-back occurs (test failure, review changes, restart planning) | `loop_key`, `iteration`, `from_stage`, `to_stage`, `trigger` |
| `pipeline.loop.exhausted` | A loop reaches its configured maximum | `loop_key`, `iteration`, `limit` |

### 2.3 Versioning Strategy

- `schema_version` is a monotonically increasing integer string (`"1"`, `"2"`, ...).
- Adding new optional fields to payloads: no version bump.
- Adding new event types: no version bump.
- Removing or renaming fields, changing field semantics: version bump.
- Webhook consumers should ignore unknown fields and unknown event types.

---

## 3. Event Emitter Module

### 3.1 Location

New module: `.claude/worca/events/emitter.py`

Supporting files:
- `.claude/worca/events/__init__.py` (exports `emit_event`)
- `.claude/worca/events/webhook.py` (HTTP delivery)

### 3.2 Event Log File

Events are appended to `.worca/events.jsonl` (one JSON object per line). This file is:
- Append-only during a pipeline run.
- Archived alongside `status.json` when `_archive_run()` moves results to `.worca/results/{run_id}.json` (the events file is moved to `.worca/results/{run_id}/events.jsonl`).
- Human-readable and trivially parseable.

### 3.3 Emitter API

```
emit_event(
    event_type: str,
    payload: dict,
    *,
    run_id: str,
    branch: str,
    work_request: dict,
    events_path: str = ".worca/events.jsonl",
    settings_path: str = ".claude/settings.json",
) -> dict
```

Responsibilities:
1. Build the full envelope (generate `event_id`, `timestamp`).
2. Append the serialized JSON line to `events_path`.
3. If webhooks are configured, queue delivery via `deliver_webhook()` (non-blocking).
4. Return the built event dict for optional inline use.

### 3.4 Thread Safety

The emitter writes from the main orchestrator thread only (no concurrent writes). File writes use `open(..., "a")` with an explicit `flush()` after each line. No locking is required in the current single-process model.

### 3.5 Failure Isolation

Event emission must never crash the pipeline. All emitter code wraps in a top-level try/except that logs warnings to `_orchestrator_log` but does not propagate exceptions.

---

## 4. Webhook Delivery

### 4.1 Configuration (see also Section 6)

Webhooks are configured under `worca.webhooks` in `settings.json`. Each entry is an object:

```
{
  "url": "https://example.com/hook",
  "enabled": true,
  "secret": "optional-shared-secret",
  "events": ["pipeline.run.*", "pipeline.stage.completed"],
  "timeout_ms": 5000,
  "max_retries": 3
}
```

- `events`: glob-style patterns. `"*"` matches all. `"pipeline.run.*"` matches all run-level events. If omitted or empty, all events are delivered.
- `secret`: if set, the request includes an `X-Worca-Signature` header containing `HMAC-SHA256(secret, raw_body)`.
- `timeout_ms`: per-request timeout, default 5000.
- `max_retries`: retry count with exponential backoff, default 3.

### 4.2 HTTP Request Format

```
POST <url>
Content-Type: application/json
User-Agent: worca-pipeline/1.0
X-Worca-Event: <event_type>
X-Worca-Delivery: <event_id>
X-Worca-Signature: sha256=<hex-digest>  (only if secret configured)

<full event envelope as JSON body>
```

### 4.3 Delivery Module

File: `.claude/worca/events/webhook.py`

```
deliver_webhook(event: dict, webhook_config: dict) -> None
```

- Uses `urllib.request` (stdlib) to avoid adding a `requests` dependency.
- Runs delivery in a `threading.Thread(daemon=True)` so the pipeline is not blocked waiting for HTTP responses.
- Retries on 5xx or network errors with exponential backoff: 1s, 2s, 4s (capped by `max_retries`).
- Logs delivery success/failure to the orchestrator log. Does not raise on failure.

### 4.4 Event Filtering

Before delivery, `deliver_webhook()` checks the event type against the webhook's `events` patterns using `fnmatch.fnmatch()`. If no pattern matches, the event is silently skipped for that webhook.

### 4.5 Signature Computation

If `secret` is set:
1. Serialize the event dict to a canonical JSON string (sorted keys, no extra whitespace).
2. Compute `HMAC-SHA256(secret.encode(), json_bytes)`.
3. Set header `X-Worca-Signature: sha256=<hex_digest>`.

---

## 5. Integration Points in runner.py

This section maps each event type to the exact location in `runner.py` where `emit_event()` is called. Line references are to the current file as of 2026-03-09.

### 5.1 Pipeline Lifecycle

| Event | Location in `run_pipeline()` | After / Before |
|---|---|---|
| `pipeline.run.started` | After `init_status()` + `save_status()` (~line 426) for fresh starts, or after resume detection (~line 402) | After branch creation and status initialization |
| `pipeline.run.resumed` | Inside the `if resume_stage is not None` block (~line 402) | After `_log("Resuming from ...")` |
| `pipeline.run.completed` | After the while loop, after `status["completed_at"]` is set (~line 684) | After pipeline summary logging |
| `pipeline.run.failed` | In the `except` handlers that raise `PipelineError` or `LoopExhaustedError` — add a `try/except` wrapper around the main while loop | Before `raise` |
| `pipeline.run.interrupted` | In the `except PipelineInterrupted` handler — add emit before re-raise | Before `raise PipelineInterrupted(...)` |

### 5.2 Stage Lifecycle

| Event | Location | After / Before |
|---|---|---|
| `pipeline.stage.started` | After `start_iteration()` + `save_status()` (~line 482) | After `_log(f"{stage_label}{iter_label} starting...")` |
| `pipeline.stage.completed` | After `complete_iteration()` + `update_stage()` in each branch (PLAN ~577, TEST ~607/609, REVIEW ~618, default ~659) | After `save_status()` in each branch |
| `pipeline.stage.failed` | In the `except Exception as e` block (~line 520) | After `save_status()`, before `raise` |
| `pipeline.stage.interrupted` | In the `except InterruptedError` block (~line 506) and the shutdown check (~line 490) | After `save_status()`, before `raise PipelineInterrupted(...)` |

### 5.3 Milestone & Loop Events

| Event | Location | After / Before |
|---|---|---|
| `pipeline.milestone.set` | After `set_milestone()` call (~line 576) | After `save_status()` |
| `pipeline.loop.triggered` | At each `continue` statement that loops back: test failure (~line 604), review changes (~line 640), restart planning (~line 654) | Before `continue` |
| `pipeline.loop.exhausted` | Before each `raise LoopExhaustedError(...)` call (~lines 600, 635, 650) | Before `raise` |

### 5.4 Emitter Context Setup

At the start of `run_pipeline()`, after status is initialized or loaded for resume, build the emitter context dict:

```
_event_ctx = {
    "run_id": <computed from status via same SHA-256 algorithm>,
    "branch": branch_name,
    "work_request": wr_dict,
    "events_path": os.path.join(os.path.dirname(status_path), "events.jsonl"),
    "settings_path": settings_path,
}
```

All `emit_event()` calls unpack `**_event_ctx` for the common arguments.

### 5.5 Archive Integration

Modify `_archive_run()` to also move `.worca/events.jsonl` into `.worca/results/{run_id}/events.jsonl` alongside the archived logs.

---

## 6. Configuration Schema

Additions to `.claude/settings.json` under the `worca` namespace:

```json
{
  "worca": {
    "events": {
      "enabled": true,
      "log_path": ".worca/events.jsonl"
    },
    "webhooks": [
      {
        "url": "https://example.com/worca-events",
        "enabled": true,
        "secret": "",
        "events": ["*"],
        "timeout_ms": 5000,
        "max_retries": 3
      }
    ]
  }
}
```

**Field definitions:**

| Field | Type | Default | Description |
|---|---|---|---|
| `worca.events.enabled` | bool | `true` | Master switch for the entire event system. When false, no events are emitted and no webhooks fire. |
| `worca.events.log_path` | string | `".worca/events.jsonl"` | Path to the append-only event log file (relative to project root). |
| `worca.webhooks` | array | `[]` | List of webhook endpoint configurations. |
| `worca.webhooks[].url` | string | (required) | HTTPS endpoint to POST events to. |
| `worca.webhooks[].enabled` | bool | `true` | Per-webhook toggle. |
| `worca.webhooks[].secret` | string | `""` | Shared secret for HMAC-SHA256 signature. Empty string means unsigned. |
| `worca.webhooks[].events` | array of string | `["*"]` | Glob patterns for event types to deliver. |
| `worca.webhooks[].timeout_ms` | int | `5000` | HTTP request timeout in milliseconds. |
| `worca.webhooks[].max_retries` | int | `3` | Number of retries on failure (5xx / network error). |

**Validation rules (enforced at pipeline start):**
- `url` must start with `https://` or `http://localhost` (for development).
- `timeout_ms` must be 1000-30000.
- `max_retries` must be 0-10.
- `events` patterns must contain only alphanumeric, dots, and `*`.

---

## 7. Implementation Tasks

### Task 1: Create event emitter module

**Files to create:**
- `.claude/worca/events/__init__.py`
- `.claude/worca/events/emitter.py`

**Changes in `emitter.py`:**
- Define `SCHEMA_VERSION = "1"`.
- Define `_compute_run_id(status: dict) -> str` — port the SHA-256 logic from `_archive_run()` and `watcher.js:createRunId()` into a shared helper.
- Implement `emit_event()` per the API in section 3.3.
- Wrap all I/O in try/except, log warnings on failure, never propagate.
- Read `worca.events.enabled` from settings; if false, return immediately.
- After writing to JSONL, iterate `worca.webhooks` and spawn delivery threads.

### Task 2: Create webhook delivery module

**Files to create:**
- `.claude/worca/events/webhook.py`

**Changes:**
- Implement `deliver_webhook(event: dict, webhook_config: dict) -> None`.
- Use `urllib.request.Request` + `urllib.request.urlopen` for HTTP POST.
- Implement `_matches_event_filter(event_type: str, patterns: list[str]) -> bool` using `fnmatch.fnmatch`.
- Implement `_compute_signature(secret: str, body: bytes) -> str` using `hmac` + `hashlib.sha256`.
- Implement retry loop with exponential backoff (1s base, 2x multiplier, capped at `max_retries`).
- Each webhook delivery runs in `threading.Thread(daemon=True)` to avoid blocking the pipeline.
- Log success/failure via `_log()` from runner or a passed-in logger callback.

### Task 3: Extract `_compute_run_id` to shared utility

**Files to modify:**
- `.claude/worca/state/status.py` — add `compute_run_id(status: dict) -> str` function.
- `.claude/worca/orchestrator/runner.py` — replace inline SHA-256 logic in `_archive_run()` with a call to `compute_run_id()`.

**Rationale:** The run ID algorithm is duplicated in `runner.py` (Python), `watcher.js` (Node), and will be needed in the emitter. Centralizing the Python copy in `status.py` keeps it near the status data it operates on.

### Task 4: Integrate emitter into `runner.py`

**Files to modify:**
- `.claude/worca/orchestrator/runner.py`

**Changes:**
- Add import: `from worca.events.emitter import emit_event`
- Add import: `from worca.state.status import compute_run_id`
- After status initialization (fresh start) or resume detection, build `_event_ctx` dict.
- Add `emit_event("pipeline.run.started", ...)` after fresh start initialization.
- Add `emit_event("pipeline.run.resumed", ...)` after resume detection.
- Add `emit_event("pipeline.stage.started", ...)` after each `start_iteration()` + `save_status()`.
- Add `emit_event("pipeline.stage.completed", ...)` after each `complete_iteration()` + `save_status()` in the PLAN, TEST, REVIEW, and default branches.
- Add `emit_event("pipeline.stage.failed", ...)` in the `except Exception` handler.
- Add `emit_event("pipeline.stage.interrupted", ...)` in the interrupt handlers.
- Add `emit_event("pipeline.milestone.set", ...)` after each `set_milestone()` call.
- Add `emit_event("pipeline.loop.triggered", ...)` before each loop-back `continue`.
- Add `emit_event("pipeline.loop.exhausted", ...)` before each `raise LoopExhaustedError`.
- Add `emit_event("pipeline.run.completed", ...)` after pipeline summary logging.
- Wrap the main while loop in a try/except to catch `PipelineError` and `LoopExhaustedError` and emit `pipeline.run.failed` before re-raising.
- Add `emit_event("pipeline.run.interrupted", ...)` in the `PipelineInterrupted` handler.

### Task 5: Archive events alongside run results

**Files to modify:**
- `.claude/worca/orchestrator/runner.py` — in `_archive_run()`.

**Changes:**
- After moving `status.json` to `results/{run_id}.json`, also move `.worca/events.jsonl` to `.worca/results/{run_id}/events.jsonl` if the file exists.
- Use `shutil.move()` consistent with the existing log archival pattern.

### Task 6: Expose events to worca-ui via WebSocket

**Files to modify:**
- `.claude/worca-ui/server/ws.js`
- `.claude/worca-ui/server/watcher.js`

**Changes in `watcher.js`:**
- Add `watchEvents(worcaDir, callback)` function that watches `.worca/events.jsonl` for changes and tails new lines, similar to the existing log-tailer pattern.

**Changes in `ws.js`:**
- Start an event watcher alongside the existing status file watcher.
- On new event lines, broadcast a `pipeline_event` message to connected WebSocket clients.
- Add a `get_events` request handler that returns the last N events (or events since a given `event_id`) from the JSONL file.

### Task 7: Add webhook configuration validation

**Files to modify:**
- `.claude/worca/orchestrator/runner.py` — at pipeline start, before the main loop.

**Changes:**
- Read `worca.webhooks` from settings.
- Validate each webhook config against the rules in section 6.
- Log warnings for invalid configurations; skip invalid webhooks but do not abort the pipeline.

### Task 8: Add worca.events and worca.webhooks defaults to settings.json

**Files to modify:**
- `.claude/settings.json`

**Changes:**
- Add the `events` key under `worca` with `enabled: true`.
- Add an empty `webhooks` array under `worca`.
- This makes the configuration discoverable without requiring users to know the schema.

---

## 8. Testing Strategy

### 8.1 Unit Tests

**File to create:** `tests/test_event_emitter.py`

- Test `emit_event()` writes valid JSONL to a temp file.
- Test envelope structure: all required fields present, `schema_version` is `"1"`, `event_id` is valid UUID4, `timestamp` is valid ISO-8601.
- Test that `emit_event()` is a no-op when `worca.events.enabled` is false.
- Test that `emit_event()` catches and logs (does not raise) I/O errors.
- Test `_compute_run_id` matches the expected SHA-256 output for known inputs.

**File to create:** `tests/test_webhook.py`

- Test `_matches_event_filter()` with exact match, wildcard, multi-pattern, and no-match cases.
- Test `_compute_signature()` produces correct HMAC-SHA256 hex digest.
- Test `deliver_webhook()` sends correct HTTP request (mock `urllib.request.urlopen`).
- Test retry logic: mock a 500 response followed by a 200, verify two requests were made.
- Test timeout handling: mock a hung server, verify delivery does not block beyond `timeout_ms`.
- Test that delivery failure does not propagate exceptions.

### 8.2 Integration Tests

**File to create:** `tests/test_event_integration.py`

- Run a minimal pipeline (with stages mocked to return immediately) and verify that the expected sequence of events appears in `events.jsonl`.
- Verify event ordering: `run.started` comes first, `stage.started`/`stage.completed` alternate, `run.completed` comes last.
- Verify loop events: mock a test failure, verify `loop.triggered` appears before the second `stage.started` for IMPLEMENT.
- Verify resume events: create a status file mid-pipeline, run the pipeline, verify `run.resumed` is emitted.

### 8.3 Webhook Integration Tests

**File to create:** `tests/test_webhook_integration.py`

- Start a local HTTP server (using `http.server` from stdlib).
- Configure a webhook pointing to `http://localhost:<port>`.
- Emit an event, verify the local server receives the POST with correct headers and body.
- Test HMAC signature verification on the receiving end.
- Test that the pipeline does not hang if the webhook server is unreachable.

### 8.4 worca-ui Tests

**File to create:** `.claude/worca-ui/test/events.test.js`

- Test `watchEvents()` correctly tails new JSONL lines.
- Test `get_events` request handler returns correct data.
- Test WebSocket broadcast of `pipeline_event` messages.

---

## 9. Future Extensions (Out of Scope)

These are natural follow-ups that the event system is designed to support but are not part of this work item.

**Slack notifications:** Add a Slack delivery channel alongside webhooks. Read a `worca.notifications.slack` config with `webhook_url`, `channel`, and `events` filter. Format event payloads into Slack Block Kit messages. The existing event filtering and envelope structure transfer directly.

**Email notifications:** Add an email delivery channel using SMTP. Read `worca.notifications.email` config with `smtp_host`, `from`, `to`, and `events` filter. Generate HTML email bodies from event payloads. Batch multiple rapid events into digest emails using a short delay window.

**Event routing and filtering rules:** Allow per-webhook transformation and filtering beyond glob patterns. Define rules like "only send pipeline.run.failed if the error_type is LoopExhaustedError" using a lightweight expression language.

**Persistent event store:** Replace or supplement the JSONL file with a SQLite database for querying, aggregation, and retention policies. Add an events API endpoint to worca-ui for historical queries.

**External event ingestion:** Accept inbound events (e.g., GitHub PR status, CI results) that the pipeline can react to, enabling bidirectional integration.

---

## Appendix A: Event Flow Diagram

```
run_pipeline() called
  |
  +-- [fresh start]
  |     emit: pipeline.run.started
  |
  +-- [resume]
  |     emit: pipeline.run.resumed
  |
  +-- for each stage:
  |     |
  |     +-- start_iteration()
  |     |     emit: pipeline.stage.started
  |     |
  |     +-- run_stage()
  |     |     |
  |     |     +-- [success]
  |     |     |     emit: pipeline.stage.completed
  |     |     |
  |     |     +-- [error]
  |     |     |     emit: pipeline.stage.failed
  |     |     |
  |     |     +-- [interrupted]
  |     |           emit: pipeline.stage.interrupted
  |     |
  |     +-- [milestone gate]
  |     |     emit: pipeline.milestone.set
  |     |
  |     +-- [loop-back needed]
  |     |     |
  |     |     +-- [within limit]
  |     |     |     emit: pipeline.loop.triggered
  |     |     |
  |     |     +-- [limit exceeded]
  |     |           emit: pipeline.loop.exhausted
  |     |           emit: pipeline.run.failed
  |
  +-- [all stages done]
  |     emit: pipeline.run.completed
  |
  +-- [unrecoverable error]
  |     emit: pipeline.run.failed
  |
  +-- [signal caught]
        emit: pipeline.run.interrupted
```

## Appendix B: Example Event

```json
{
  "schema_version": "1",
  "event_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "event_type": "pipeline.stage.completed",
  "timestamp": "2026-03-09T14:32:07.123456+00:00",
  "run_id": "3f8a1c2b4d5e",
  "pipeline": {
    "branch": "worca/add-user-auth-X2k",
    "work_request": {
      "title": "Add user authentication",
      "source_ref": "PROJ-42",
      "priority": "high"
    }
  },
  "payload": {
    "stage": "implement",
    "iteration": 2,
    "duration_ms": 45230,
    "cost_usd": 0.87,
    "turns": 34,
    "outcome": "success",
    "trigger": "test_failure"
  }
}
```
