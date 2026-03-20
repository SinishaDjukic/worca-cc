# W-003: Pipeline Events & Webhooks

**Date:** 2026-03-09 (extended 2026-03-20)
**Status:** Draft
**Author:** (auto-generated, extended by manual review)

---

## 1. Goal & Scope

Emit structured events at every meaningful point in the worca-cc pipeline so that external systems (dashboards, chat bots, CI/CD, monitoring) can react in real time **and optionally control the pipeline** via callback responses.

**In scope:**

- Define a versioned event schema covering all pipeline lifecycle moments — from high-level stage transitions down to individual tool calls, bead operations, git actions, test results, review verdicts, and circuit breaker decisions.
- Build an event emitter module that writes events to an append-only JSONL file and optionally delivers them via HTTP POST webhooks.
- Wire the `on_event` callback in `claude_cli.py:process_stream()` to emit agent-level telemetry events in real time.
- Integrate the emitter into `runner.py` at every stage transition, loop-back, error, bead lifecycle moment, and pipeline completion.
- Add hook-level event emission from `pre_tool_use.py` and `post_tool_use.py` for governance visibility.
- Add webhook configuration under the existing `worca` namespace in `settings.json`.
- Provide retry logic with exponential backoff for webhook delivery.
- Expose the event log to worca-ui via the existing WebSocket server.
- Implement a control webhook mechanism that allows external systems to approve milestones, pause/resume, and abort the pipeline via webhook callback responses.

**Out of scope (future extensions noted in section 11):**

- Slack, Discord, or email notification channels.
- Persistent event store (database-backed).
- Authentication for inbound webhook receivers (beyond shared secret signing).

---

## 2. Event Schema Design

### 2.1 Envelope

Every event shares a common envelope. All fields are required unless noted.

```json
{
  "schema_version": "1",
  "event_id":       "<uuid4>",
  "event_type":     "<dotted.event.type>",
  "timestamp":      "<ISO-8601 UTC>",
  "run_id":         "<YYYYMMDD-HHMMSS format, matches status.run_id>",
  "pipeline": {
    "branch":       "<git branch name>",
    "work_request": { "title": "...", "source_ref": "...", "priority": "..." }
  },
  "payload":        { /* event-type-specific data */ }
}
```

- `schema_version` starts at `"1"`. Bump only on breaking changes. Additive fields do not bump.
- `event_id` is a UUID4 generated at emit time; guarantees idempotent processing.
- `run_id` matches `status["run_id"]` (the `YYYYMMDD-HHMMSS` string) for direct correlation with the UI, status files, and archived results.

### 2.2 Event Types — Complete Catalog

Dotted naming convention: `pipeline.<noun>.<verb>`.

#### 2.2.1 Pipeline Lifecycle (5 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.run.started` | `run_pipeline()` begins, after `init_status()` or resume detection | `resume: bool`, `started_at`, `plan_file`, `settings_snapshot` |
| `pipeline.run.completed` | Pipeline finishes successfully (all stages done) | `duration_ms`, `total_cost_usd`, `total_turns`, `total_tokens`, `stages_completed` |
| `pipeline.run.failed` | Unrecoverable error (PipelineError, LoopExhaustedError, CircuitBreakerTripped) | `error`, `failed_stage`, `error_type`, `loop_counters` |
| `pipeline.run.interrupted` | SIGTERM/SIGINT caught (PipelineInterrupted) | `interrupted_stage`, `elapsed_ms` |
| `pipeline.run.resumed` | Pipeline resumes from a prior checkpoint | `resume_stage`, `previous_stages_completed` |

#### 2.2.2 Stage Lifecycle (4 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.stage.started` | A stage iteration begins (after `start_iteration()`) | `stage`, `iteration`, `agent`, `model`, `trigger`, `max_turns` |
| `pipeline.stage.completed` | A stage iteration finishes successfully | `stage`, `iteration`, `duration_ms`, `cost_usd`, `turns`, `outcome`, `token_usage` |
| `pipeline.stage.failed` | A stage iteration errors out | `stage`, `iteration`, `error`, `error_type`, `elapsed_ms` |
| `pipeline.stage.interrupted` | A stage is interrupted by signal | `stage`, `iteration`, `elapsed_ms` |

#### 2.2.3 Agent Telemetry (5 events)

These are emitted from within `claude_cli.py:process_stream()` via the `on_event` callback, providing real-time visibility into what each agent is doing.

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.agent.spawned` | `run_agent()` launches Claude subprocess | `stage`, `iteration`, `agent`, `model`, `pid`, `max_turns` |
| `pipeline.agent.tool_use` | Agent calls a tool (Read, Write, Edit, Bash, Grep, Glob, Agent) | `stage`, `iteration`, `tool`, `tool_input_summary`, `turn` |
| `pipeline.agent.tool_result` | Tool returns a result | `stage`, `iteration`, `tool`, `is_error`, `turn` |
| `pipeline.agent.text` | Agent emits text output (summary only, not full text) | `stage`, `iteration`, `text_length`, `turn` |
| `pipeline.agent.completed` | Claude subprocess exits (result event received) | `stage`, `iteration`, `turns`, `cost_usd`, `duration_ms`, `exit_code` |

#### 2.2.4 Bead Lifecycle (6 events)

These track individual work items through the COORDINATE and IMPLEMENT stages.

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.bead.created` | `post_tool_use.py` detects `bd create` success | `bead_id`, `title`, `run_label` |
| `pipeline.bead.assigned` | `_claim_bead()` sets bead to in_progress | `bead_id`, `title`, `iteration` |
| `pipeline.bead.completed` | `bd_close()` succeeds after implementation | `bead_id`, `reason` |
| `pipeline.bead.failed` | `bd_close()` fails or bead not closeable | `bead_id`, `error` |
| `pipeline.bead.labeled` | `bd_label_add()` tags beads with run label | `bead_ids`, `label` |
| `pipeline.bead.next` | More beads available, looping back to IMPLEMENT | `next_bead_id`, `bead_iteration`, `max_beads` |

#### 2.2.5 Git Operations (4 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.git.branch_created` | `create_branch()` succeeds in fresh start | `branch`, `base_ref` |
| `pipeline.git.commit` | Guardian agent runs `git commit` (detected via `post_tool_use.py`) | `stage`, `commit_hash`, `message_summary` |
| `pipeline.git.pr_created` | PR stage creates a pull request (detected from stage output) | `pr_url`, `pr_number`, `title` |
| `pipeline.git.pr_merged` | PR is merged (detected from stage output or GH issue lifecycle) | `pr_url`, `pr_number` |

#### 2.2.6 Test Detail (4 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.test.suite_started` | TEST stage begins execution | `stage`, `iteration`, `trigger` |
| `pipeline.test.suite_passed` | TEST stage result has `passed: true` | `iteration`, `coverage_pct`, `proof_artifacts` |
| `pipeline.test.suite_failed` | TEST stage result has `passed: false` | `iteration`, `failure_count`, `failures` (array of `{test, error, file}`) |
| `pipeline.test.fix_attempt` | Loop-back to IMPLEMENT triggered by test failure | `attempt`, `limit`, `failures_summary` |

#### 2.2.7 Review Detail (3 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.review.started` | REVIEW stage begins | `iteration`, `files_under_review` |
| `pipeline.review.verdict` | REVIEW stage produces outcome | `outcome` (approve/request_changes/reject/restart_planning), `issue_count`, `critical_count` |
| `pipeline.review.fix_attempt` | Loop-back to IMPLEMENT triggered by review changes | `attempt`, `limit`, `critical_issues` |

#### 2.2.8 Circuit Breaker (4 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.circuit_breaker.failure_recorded` | `record_failure()` increments counter | `stage`, `error`, `category`, `retriable`, `consecutive_failures` |
| `pipeline.circuit_breaker.retry` | Transient error triggers backoff retry | `stage`, `attempt`, `delay_seconds`, `consecutive_failures` |
| `pipeline.circuit_breaker.tripped` | `should_halt()` returns true | `reason`, `consecutive_failures`, `category` |
| `pipeline.circuit_breaker.reset` | `record_success()` resets counter | `stage`, `previous_consecutive_failures` |

#### 2.2.9 Cost & Token Tracking (3 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.cost.stage_total` | After each stage completes with token usage | `stage`, `iteration`, `cost_usd`, `input_tokens`, `output_tokens`, `model` |
| `pipeline.cost.running_total` | After each stage, with cumulative run totals | `total_cost_usd`, `total_input_tokens`, `total_output_tokens`, `by_stage`, `by_model` |
| `pipeline.cost.budget_warning` | Running total exceeds configured threshold | `total_cost_usd`, `budget_usd`, `pct_used` |

#### 2.2.10 Milestone & Loop Events (3 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.milestone.set` | A milestone gate is evaluated | `milestone`, `value` (bool), `stage` |
| `pipeline.loop.triggered` | A loop-back occurs | `loop_key`, `iteration`, `from_stage`, `to_stage`, `trigger` |
| `pipeline.loop.exhausted` | A loop reaches its configured maximum | `loop_key`, `iteration`, `limit` |

#### 2.2.11 Hook & Governance Events (3 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.hook.blocked` | `pre_tool_use.py` guard blocks an action (exit code 2) | `agent`, `tool`, `reason`, `rule` |
| `pipeline.hook.test_gate` | `post_tool_use.py` test gate triggers (warning or block) | `agent`, `strike`, `action` (warn/block), `command` |
| `pipeline.hook.dispatch_blocked` | `subagent_start.py` blocks a sub-agent dispatch | `agent`, `subagent_type`, `reason` |

#### 2.2.12 Preflight Events (2 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.preflight.completed` | Preflight checks finish | `checks` (array of `{name, status, message}`), `all_passed` |
| `pipeline.preflight.skipped` | Preflight skipped via `--skip-preflight` | `reason` |

#### 2.2.13 Learn Stage Events (2 events)

| Event Type | Emitted When | Key Payload Fields |
|---|---|---|
| `pipeline.learn.completed` | Learn stage produces learnings | `termination_type`, `learnings_path` |
| `pipeline.learn.failed` | Learn stage fails (non-fatal) | `error` |

#### 2.2.14 Control Events (Inbound, 4 event types)

These are **response-driven** — external systems respond to specific outbound events to control the pipeline. See Section 5 for the full control webhook protocol.

| Control Action | Triggered By Response To | Payload Fields |
|---|---|---|
| `control.milestone.approve` | `pipeline.milestone.set` (when `value: null`) | `milestone`, `approved: bool` |
| `control.pipeline.pause` | Any event | `reason` |
| `control.pipeline.resume` | Any event (while paused) | `reason` |
| `control.pipeline.abort` | Any event | `reason` |

### 2.3 Event Summary

| Category | Event Count | Source Module |
|---|---|---|
| Pipeline lifecycle | 5 | `runner.py` |
| Stage lifecycle | 4 | `runner.py` |
| Agent telemetry | 5 | `claude_cli.py` |
| Bead lifecycle | 6 | `runner.py` + `post_tool_use.py` |
| Git operations | 4 | `runner.py` + `post_tool_use.py` |
| Test detail | 4 | `runner.py` |
| Review detail | 3 | `runner.py` |
| Circuit breaker | 4 | `runner.py` + `error_classifier.py` |
| Cost & tokens | 3 | `runner.py` |
| Milestones & loops | 3 | `runner.py` |
| Hook & governance | 3 | `pre_tool_use.py` + `post_tool_use.py` + `subagent_start.py` |
| Preflight | 2 | `runner.py` |
| Learn stage | 2 | `runner.py` |
| Control (inbound) | 4 | `webhook.py` response handling |
| **Total** | **52** | |

### 2.4 Versioning Strategy

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
- `.claude/worca/events/__init__.py` (exports `emit_event`, `EventContext`)
- `.claude/worca/events/webhook.py` (HTTP delivery + control response handling)
- `.claude/worca/events/types.py` (event type constants + payload builders)

### 3.2 Event Log File

Events are appended to `.worca/runs/{run_id}/events.jsonl` (one JSON object per line, co-located with status.json). This file is:
- Append-only during a pipeline run.
- Archived alongside `status.json` when `_archive_run()` moves results to `.worca/results/{run_id}/`.
- Human-readable and trivially parseable.

### 3.3 EventContext Class

Rather than passing 5+ arguments to every `emit_event()` call, create a context object once at pipeline start and pass it around.

```python
@dataclass
class EventContext:
    run_id: str
    branch: str
    work_request: dict
    events_path: str           # .worca/runs/{run_id}/events.jsonl
    settings_path: str
    enabled: bool = True       # read from worca.events.enabled
    _webhooks: list = None     # cached webhook configs
    _log_file: IO = None       # cached file handle

    def emit(self, event_type: str, payload: dict) -> dict | None:
        """Emit an event. Returns the event dict, or None if disabled."""
        ...

    def close(self):
        """Flush and close the event log file."""
        ...
```

This object is created once in `run_pipeline()` and threaded to:
- All `emit()` calls in `runner.py`
- `run_stage()` / `run_agent()` via the `on_event` callback closure
- Hook scripts via environment variable pointing to events file path

### 3.4 Emitter API

```python
def emit_event(
    ctx: EventContext,
    event_type: str,
    payload: dict,
) -> dict | None
```

Responsibilities:
1. Return `None` immediately if `ctx.enabled` is False.
2. Build the full envelope (generate `event_id` via `uuid4()`, `timestamp` via `datetime.now(timezone.utc)`).
3. Append the serialized JSON line to `ctx.events_path`.
4. If webhooks are configured, queue delivery via `deliver_webhook()` (non-blocking).
5. Return the built event dict for optional inline use.

### 3.5 Event Type Constants

File: `.claude/worca/events/types.py`

Define all event types as string constants to prevent typos and enable IDE autocomplete:

```python
# Pipeline lifecycle
RUN_STARTED = "pipeline.run.started"
RUN_COMPLETED = "pipeline.run.completed"
RUN_FAILED = "pipeline.run.failed"
RUN_INTERRUPTED = "pipeline.run.interrupted"
RUN_RESUMED = "pipeline.run.resumed"

# Stage lifecycle
STAGE_STARTED = "pipeline.stage.started"
STAGE_COMPLETED = "pipeline.stage.completed"
STAGE_FAILED = "pipeline.stage.failed"
STAGE_INTERRUPTED = "pipeline.stage.interrupted"

# Agent telemetry
AGENT_SPAWNED = "pipeline.agent.spawned"
AGENT_TOOL_USE = "pipeline.agent.tool_use"
AGENT_TOOL_RESULT = "pipeline.agent.tool_result"
AGENT_TEXT = "pipeline.agent.text"
AGENT_COMPLETED = "pipeline.agent.completed"

# ... etc for all 52 types
```

### 3.6 Payload Builder Helpers

Also in `types.py`, provide typed helper functions that construct validated payloads:

```python
def stage_started_payload(stage: str, iteration: int, agent: str,
                          model: str, trigger: str, max_turns: int) -> dict:
    return {
        "stage": stage, "iteration": iteration, "agent": agent,
        "model": model, "trigger": trigger, "max_turns": max_turns,
    }
```

This prevents inconsistent payloads across call sites and makes it easy to add new fields.

### 3.7 Thread Safety

The emitter writes from the main orchestrator thread for all runner events. Agent telemetry events are written from the `process_stream()` reader thread (one at a time per stage). Since only one stage runs at a time, there's no concurrent-write risk for the JSONL file, but use `open(..., "a")` with explicit `flush()` after each line for safety.

### 3.8 Failure Isolation & Pipeline Impact Guarantees

**Critical design invariant: webhook failures never affect the pipeline.**

This is enforced at three levels:

1. **Async delivery (observer webhooks):** All observer webhook deliveries run in `threading.Thread(daemon=True)`. The `emit_event()` call returns immediately after writing to the JSONL file — it does not wait for HTTP responses. A webhook endpoint that is slow (10s response), down (connection refused), or returning errors (500) has zero impact on pipeline timing or outcome. The daemon threads are fire-and-forget; they die when the pipeline process exits.

2. **Exception isolation:** Both `emit_event()` and `deliver_webhook()` wrap all code in top-level try/except blocks. Network errors, JSON serialization failures, file I/O errors — all are caught, logged to `_orchestrator_log` as warnings, and silently swallowed. The pipeline never sees the exception.

3. **Timeout enforcement:** Each webhook has a configurable `timeout_ms` (default 5000, max 30000). `urllib.request.urlopen` is called with this timeout. Hung servers are abandoned after the timeout, the delivery thread logs the failure and exits.

**The one exception: control webhooks.** Webhooks with `"control": true` are delivered **synchronously** at specific pause points (milestone gates, stage completions) because the pipeline must read the response to act on it. However, even control webhooks are protected by timeout + try/except — a failing control webhook is treated as `{"control": {"action": "continue"}}` (no action). The pipeline never blocks indefinitely on any webhook.

**Summary:**

| Webhook Type | Delivery | Failure Impact | Blocks Pipeline? |
|---|---|---|---|
| Observer (`control: false`) | Async (daemon thread) | None — logged and ignored | No |
| Control (`control: true`) | Sync at pause points only | Treated as "continue" | Briefly (up to `timeout_ms`), at natural pause points only |

### 3.9 High-Volume Event Throttling

Agent telemetry events (`pipeline.agent.tool_use`, `pipeline.agent.text`) can be very frequent. To prevent overwhelming webhook consumers:
- Always write to the JSONL file (local is cheap).
- For webhook delivery, apply a per-event-type rate limit: max 1 delivery per second per event type. Queue intermediate events and deliver only the most recent.
- Rate limiting is per-webhook, not global — a high-volume dashboard webhook can be configured with `"rate_limit_ms": 0` to receive all events.

---

## 4. Webhook Delivery

### 4.1 Configuration (see also Section 8)

Webhooks are configured under `worca.webhooks` in `settings.json`. Each entry is an object:

```json
{
  "url": "https://example.com/hook",
  "enabled": true,
  "secret": "optional-shared-secret",
  "events": ["pipeline.run.*", "pipeline.stage.completed"],
  "timeout_ms": 5000,
  "max_retries": 3,
  "rate_limit_ms": 1000,
  "control": false
}
```

- `events`: glob-style patterns. `"*"` matches all. `"pipeline.run.*"` matches all run-level events. If omitted or empty, all events are delivered.
- `secret`: if set, the request includes an `X-Worca-Signature` header containing `HMAC-SHA256(secret, raw_body)`.
- `timeout_ms`: per-request timeout, default 5000.
- `max_retries`: retry count with exponential backoff, default 3.
- `rate_limit_ms`: minimum interval between deliveries of the same event type, default 1000. Set to 0 for no throttling.
- `control`: if true, the pipeline reads control commands from webhook responses (see Section 5).

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

```python
def deliver_webhook(event: dict, webhook_config: dict, on_control: Callable = None) -> None
```

- Uses `urllib.request` (stdlib) to avoid adding a `requests` dependency.
- Runs delivery in a `threading.Thread(daemon=True)` so the pipeline is not blocked waiting for HTTP responses.
- Retries on 5xx or network errors with exponential backoff: 1s, 2s, 4s (capped by `max_retries`).
- Logs delivery success/failure to the orchestrator log. Does not raise on failure.
- When `webhook_config["control"]` is true and the response body contains a JSON `control` field, calls `on_control(control_dict)` on the main thread (see Section 5).

### 4.4 Event Filtering

Before delivery, `deliver_webhook()` checks the event type against the webhook's `events` patterns using `fnmatch.fnmatch()`. If no pattern matches, the event is silently skipped for that webhook.

### 4.5 Signature Computation

If `secret` is set:
1. Serialize the event dict to a canonical JSON string (sorted keys, no extra whitespace).
2. Compute `HMAC-SHA256(secret.encode(), json_bytes)`.
3. Set header `X-Worca-Signature: sha256=<hex_digest>`.

---

## 5. Control Webhooks (Bidirectional)

### 5.1 Concept

Control webhooks extend the event system from purely observational to **bidirectional**. When a webhook is configured with `"control": true`, the pipeline reads the HTTP response body for control commands. This enables external systems to:

- Approve or reject milestone gates (plan approval, PR approval)
- Pause the pipeline (e.g., for manual review)
- Resume a paused pipeline
- Abort the pipeline gracefully

### 5.2 Response Protocol

A control webhook endpoint responds with JSON:

```json
{
  "control": {
    "action": "approve" | "reject" | "pause" | "resume" | "abort" | "continue",
    "reason": "optional human-readable reason"
  }
}
```

- `"continue"` (or absent `control` field): no action, pipeline proceeds normally. This is the default.
- `"approve"` / `"reject"`: only meaningful as a response to `pipeline.milestone.set` events. Ignored for other event types.
- `"pause"`: pipeline enters a polling loop, emitting `pipeline.run.paused` every 30s, until a `"resume"` or `"abort"` response is received.
- `"resume"`: exits pause state.
- `"abort"`: raises `PipelineInterrupted` with the provided reason.

### 5.3 Implementation in runner.py

Control responses are processed **synchronously** — only control webhooks (not regular observer webhooks) block the pipeline briefly to read responses.

```python
def _check_control_response(ctx: EventContext, event: dict) -> str | None:
    """Deliver to control webhooks synchronously and return action if any."""
    for wh in ctx.control_webhooks:
        response = deliver_webhook_sync(event, wh)
        if response and "control" in response:
            action = response["control"].get("action", "continue")
            if action != "continue":
                return action
    return None
```

Control checks are inserted at **natural pause points** only:
1. After `pipeline.milestone.set` events (plan approval, PR approval)
2. After `pipeline.stage.completed` events
3. After `pipeline.loop.triggered` events

This keeps the control overhead minimal — at most 1 synchronous HTTP call per stage transition.

### 5.4 Pause/Resume State Machine

When a control response returns `"pause"`:

```python
def _handle_pause(ctx: EventContext, reason: str):
    ctx.emit("pipeline.run.paused", {"reason": reason})
    _log(f"Pipeline paused: {reason}", "warn")
    while True:
        time.sleep(30)
        ctx.emit("pipeline.run.paused", {"reason": reason, "waiting": True})
        action = _check_control_response(ctx, last_event)
        if action == "resume":
            ctx.emit("pipeline.run.resumed_from_pause", {"reason": "control webhook"})
            _log("Pipeline resumed by control webhook", "ok")
            return
        elif action == "abort":
            raise PipelineInterrupted(f"Aborted via control webhook: {reason}")
```

### 5.5 Security

- Control webhooks **must** have a `secret` configured. The pipeline validates this at startup and skips control webhooks without secrets.
- The pipeline verifies the response signature if present.
- Control endpoints should also validate `X-Worca-Signature` on the request to prevent spoofed events.

---

## 6. Integration Points — Complete Map

This section maps every event type to its exact source location and implementation approach.

### 6.1 Pipeline Lifecycle Events (runner.py)

| Event | Location in `run_pipeline()` | Implementation |
|---|---|---|
| `pipeline.run.started` | After `save_status()` at ~line 769, fresh start path | `ctx.emit(RUN_STARTED, {"resume": False, "started_at": status["started_at"], "plan_file": status.get("plan_file")})` |
| `pipeline.run.resumed` | Inside `if resume_stage is not None` at ~line 724 | `ctx.emit(RUN_RESUMED, {"resume_stage": resume_stage.value, "previous_stages_completed": [...]})` |
| `pipeline.run.completed` | After `status["completed_at"]` is set at ~line 1341 | `ctx.emit(RUN_COMPLETED, {"duration_ms": int(total_elapsed*1000), "total_cost_usd": total_cost, ...})` |
| `pipeline.run.failed` | In each `except` handler: `LoopExhaustedError` (~1375), `PipelineError` (~1379), `CircuitBreakerTripped` (~1032), generic `Exception` (~1385) | `ctx.emit(RUN_FAILED, {"error": str(e), "failed_stage": status.get("stage"), "error_type": type(e).__name__})` |
| `pipeline.run.interrupted` | In `except PipelineInterrupted` at ~line 1373, and the shutdown check at ~line 900 | `ctx.emit(RUN_INTERRUPTED, {"interrupted_stage": current_stage.value})` |

### 6.2 Stage Lifecycle Events (runner.py)

| Event | Location | Implementation |
|---|---|---|
| `pipeline.stage.started` | After `start_iteration()` + `save_status()` at ~line 892 | `ctx.emit(STAGE_STARTED, stage_started_payload(current_stage.value, iter_num, ...))` |
| `pipeline.stage.completed` | After `complete_iteration()` in each branch: PREFLIGHT (~1115), PLAN (~1124), COORDINATE (~1138), IMPLEMENT (~1157), TEST pass (~1242), TEST fail-through, REVIEW (~1253), default (~1311) | `ctx.emit(STAGE_COMPLETED, {...})` after each `save_status()` |
| `pipeline.stage.failed` | In `except Exception` at ~line 991 | `ctx.emit(STAGE_FAILED, {"stage": current_stage.value, "error": str(e), ...})` |
| `pipeline.stage.interrupted` | In `except InterruptedError` at ~line 977 and shutdown check at ~line 900 | `ctx.emit(STAGE_INTERRUPTED, {...})` |

### 6.3 Agent Telemetry Events (claude_cli.py)

**Implementation approach:** Modify `run_stage()` in `runner.py` to pass an `on_event` callback to `run_agent()`. The callback is a closure over the `EventContext` and current stage/iteration.

```python
# In run_stage(), before calling run_agent():
def _agent_event_handler(event: dict):
    etype = event.get("type", "")
    if etype == "system" and event.get("subtype") == "init":
        ctx.emit(AGENT_SPAWNED, {"stage": stage.value, "model": event.get("model"), ...})
    elif etype == "assistant":
        for block in event.get("message", {}).get("content", []):
            if block.get("type") == "tool_use":
                ctx.emit(AGENT_TOOL_USE, {
                    "stage": stage.value, "tool": block["name"],
                    "tool_input_summary": _summarize_tool_input(block),
                    ...
                })
            elif block.get("type") == "text":
                ctx.emit(AGENT_TEXT, {
                    "stage": stage.value, "text_length": len(block.get("text", "")),
                    ...
                })
    elif etype == "user":
        for block in (event.get("content") or []):
            if isinstance(block, dict) and block.get("type") == "tool_result":
                ctx.emit(AGENT_TOOL_RESULT, {
                    "stage": stage.value, "is_error": block.get("is_error", False),
                    ...
                })
    elif etype == "result":
        ctx.emit(AGENT_COMPLETED, {
            "stage": stage.value, "turns": event.get("num_turns"),
            "cost_usd": event.get("total_cost_usd"),
            ...
        })

raw = run_agent(..., on_event=_agent_event_handler)
```

**Tool input summarization** — the `_summarize_tool_input()` helper extracts key fields without including file contents:
- `Read` → `file_path`
- `Write` → `file_path`
- `Edit` → `file_path`
- `Bash` → first 120 chars of `command`
- `Grep` → `pattern`
- `Glob` → `pattern`
- `Agent` → `description`
- Everything else → empty string

This matches the existing `_format_log_line()` summarization logic in `claude_cli.py`.

### 6.4 Bead Lifecycle Events (runner.py + post_tool_use.py)

| Event | Location | Implementation |
|---|---|---|
| `pipeline.bead.created` | `post_tool_use.py:_link_bd_create_to_run()` at ~line 39 | After parsing issue ID from `bd create` output, emit via events file (see 6.4.1) |
| `pipeline.bead.assigned` | `runner.py` at ~line 914, after `_claim_bead(bead_id)` | `ctx.emit(BEAD_ASSIGNED, {"bead_id": bead_id, "title": bead["title"], "iteration": iter_num})` |
| `pipeline.bead.completed` | `runner.py` at ~line 1170, after `bd_close(claimed_bead)` succeeds | `ctx.emit(BEAD_COMPLETED, {"bead_id": claimed_bead, "reason": "implemented"})` |
| `pipeline.bead.failed` | `runner.py` at ~line 1172, when `bd_close()` fails | `ctx.emit(BEAD_FAILED, {"bead_id": claimed_bead, "error": "close failed"})` |
| `pipeline.bead.labeled` | `runner.py` at ~line 1147, after `bd_label_add()` | `ctx.emit(BEAD_LABELED, {"bead_ids": beads_ids, "label": run_label})` |
| `pipeline.bead.next` | `runner.py` at ~line 1189, before loop-back `continue` | `ctx.emit(BEAD_NEXT, {"next_bead_id": next_bead["id"], "bead_iteration": loop_counters["bead_iteration"]})` |

**6.4.1 Hook-emitted events:** Hooks run in separate processes and cannot access the `EventContext` directly. Instead:
- Set `WORCA_EVENTS_PATH` env var pointing to the events JSONL file.
- Provide a lightweight `emit_from_hook(event_type, payload)` function in `.claude/worca/events/hook_emitter.py` that reads `WORCA_EVENTS_PATH` and `WORCA_RUN_ID` from env, constructs a minimal envelope, and appends to the file.
- Hook events skip webhook delivery (the worca-ui watcher will pick them up from the file). This avoids webhook dependencies in hook processes.

### 6.5 Git Events (runner.py + post_tool_use.py)

| Event | Location | Implementation |
|---|---|---|
| `pipeline.git.branch_created` | `runner.py` at ~line 745, after `create_branch()` | `ctx.emit(GIT_BRANCH_CREATED, {"branch": branch_name})` |
| `pipeline.git.commit` | `post_tool_use.py`, detect `git commit` in Bash output | Parse commit hash from stdout, emit via hook_emitter |
| `pipeline.git.pr_created` | `runner.py`, after PR stage output parsing | Extract `pr_url` from PR stage result output |
| `pipeline.git.pr_merged` | `runner.py` or `gh_issues.py:gh_issue_complete()` | Detect merge from GH issue lifecycle |

### 6.6 Test Detail Events (runner.py)

| Event | Location | Implementation |
|---|---|---|
| `pipeline.test.suite_started` | Same as `pipeline.stage.started` for TEST | Emit alongside `STAGE_STARTED` when `current_stage == Stage.TEST` |
| `pipeline.test.suite_passed` | ~line 1238, `passed` is True | `ctx.emit(TEST_SUITE_PASSED, {"coverage_pct": result.get("coverage_pct"), ...})` |
| `pipeline.test.suite_failed` | ~line 1220, `passed` is False | `ctx.emit(TEST_SUITE_FAILED, {"failure_count": len(new_failures), "failures": new_failures[:10]})` — cap at 10 failures to prevent huge payloads |
| `pipeline.test.fix_attempt` | ~line 1231, before loop-back continue | `ctx.emit(TEST_FIX_ATTEMPT, {"attempt": loop_counters["implement_test"], "limit": ..., "failures_summary": ...})` |

### 6.7 Review Detail Events (runner.py)

| Event | Location | Implementation |
|---|---|---|
| `pipeline.review.started` | Same as `pipeline.stage.started` for REVIEW | Emit alongside `STAGE_STARTED` when `current_stage == Stage.REVIEW` |
| `pipeline.review.verdict` | ~line 1249, after `handle_pr_review()` | `ctx.emit(REVIEW_VERDICT, {"outcome": outcome, "issue_count": len(result.get("issues", [])), "critical_count": len(critical_issues)})` |
| `pipeline.review.fix_attempt` | ~line 1283, before loop-back continue | `ctx.emit(REVIEW_FIX_ATTEMPT, {"attempt": loop_counters["pr_changes"], ...})` |

### 6.8 Circuit Breaker Events (runner.py)

All in the `except Exception` handler at ~lines 1007-1045:

| Event | Location | Implementation |
|---|---|---|
| `pipeline.circuit_breaker.failure_recorded` | After `record_failure()` at ~line 1019 | `ctx.emit(CB_FAILURE_RECORDED, {"stage": current_stage.value, "category": _cat, "consecutive_failures": cb["consecutive_failures"]})` |
| `pipeline.circuit_breaker.retry` | At ~line 1043, before `time.sleep(_delay)` | `ctx.emit(CB_RETRY, {"stage": current_stage.value, "attempt": _retry_attempt, "delay_seconds": _delay})` |
| `pipeline.circuit_breaker.tripped` | At ~line 1029, before `raise CircuitBreakerTripped` | `ctx.emit(CB_TRIPPED, {"reason": reason, "category": _cat})` |
| `pipeline.circuit_breaker.reset` | At ~line 1049, in the `else` (success) path after `record_success()` | `ctx.emit(CB_RESET, {"stage": current_stage.value})` — only emit if previous `consecutive_failures > 0` |

### 6.9 Cost & Token Events (runner.py)

| Event | Location | Implementation |
|---|---|---|
| `pipeline.cost.stage_total` | After token usage extraction at ~line 1062, for each completed stage | `ctx.emit(COST_STAGE_TOTAL, {"stage": current_stage.value, "cost_usd": ..., "input_tokens": ..., "output_tokens": ..., "model": ...})` |
| `pipeline.cost.running_total` | Same location, compute running aggregate | Sum all stage costs so far from `status["stages"]` |
| `pipeline.cost.budget_warning` | Same location, check against `worca.budget.max_cost_usd` setting | Only emit if setting exists and threshold exceeded. Emit at 80% and 100%. |

### 6.10 Milestone & Loop Events (runner.py)

| Event | Location | Implementation |
|---|---|---|
| `pipeline.milestone.set` | After `set_milestone()` calls: plan_approved (~line 1123), plan skipped (~line 843) | `ctx.emit(MILESTONE_SET, {"milestone": name, "value": value, "stage": current_stage.value})` |
| `pipeline.loop.triggered` | Before each loop-back `continue`: test failure (~1235), review changes (~1287), restart planning (~1304), next bead (~1192) | `ctx.emit(LOOP_TRIGGERED, {"loop_key": ..., "from_stage": ..., "to_stage": ..., "trigger": ...})` |
| `pipeline.loop.exhausted` | Before `raise LoopExhaustedError` (~1299) and at loop limit log warnings (~1237, ~1289) | `ctx.emit(LOOP_EXHAUSTED, {"loop_key": ..., "iteration": ..., "limit": ...})` |

### 6.11 Hook & Governance Events (hook scripts)

These use the lightweight `hook_emitter.py` approach (see 6.4.1).

| Event | Location | Implementation |
|---|---|---|
| `pipeline.hook.blocked` | `pre_tool_use.py:main()` at ~line 57, when `check_guard()` returns non-zero | `emit_from_hook(HOOK_BLOCKED, {"agent": os.environ.get("WORCA_AGENT"), "tool": tool_name, "reason": reason})` |
| `pipeline.hook.test_gate` | `post_tool_use.py:main()` at ~line 59, when `check_test_gate()` returns non-zero | `emit_from_hook(HOOK_TEST_GATE, {"agent": ..., "strike": ..., "action": "block"})` |
| `pipeline.hook.dispatch_blocked` | `subagent_start.py`, when dispatch is denied | `emit_from_hook(HOOK_DISPATCH_BLOCKED, {"agent": ..., "subagent_type": ...})` |

### 6.12 Preflight Events (runner.py)

| Event | Location | Implementation |
|---|---|---|
| `pipeline.preflight.completed` | ~line 1106, after `run_preflight()` returns | `ctx.emit(PREFLIGHT_COMPLETED, {"checks": result.get("checks", []), "all_passed": proc.returncode == 0})` |
| `pipeline.preflight.skipped` | ~line 950, skip_preflight path | `ctx.emit(PREFLIGHT_SKIPPED, {"reason": "--skip-preflight"})` |

### 6.13 Learn Stage Events (runner.py)

| Event | Location | Implementation |
|---|---|---|
| `pipeline.learn.completed` | `_run_learn_stage()` at ~line 438, after learnings saved | `ctx.emit(LEARN_COMPLETED, {"termination_type": termination_type, "learnings_path": learnings_path})` |
| `pipeline.learn.failed` | `_run_learn_stage()` at ~line 440, in except block | `ctx.emit(LEARN_FAILED, {"error": str(e)})` |

### 6.14 EventContext Threading

The `EventContext` must be available in `_run_learn_stage()` which is called from multiple exception handlers. Add `ctx` as a parameter to `_run_learn_stage()`, with a fallback no-op context if None.

```python
def _run_learn_stage(status, prompt_builder, settings_path, run_dir,
                     termination_type, termination_reason, msize, logs_dir,
                     force=False, event_ctx=None):
```

---

## 7. Configuration Schema

Additions to `.claude/settings.json` under the `worca` namespace:

```json
{
  "worca": {
    "events": {
      "enabled": true,
      "agent_telemetry": true,
      "hook_events": true,
      "rate_limit_ms": 1000
    },
    "webhooks": [
      {
        "url": "https://example.com/worca-events",
        "enabled": true,
        "secret": "",
        "events": ["*"],
        "timeout_ms": 5000,
        "max_retries": 3,
        "rate_limit_ms": 1000,
        "control": false
      }
    ],
    "budget": {
      "max_cost_usd": null,
      "warning_pct": 80
    }
  }
}
```

**Field definitions:**

| Field | Type | Default | Description |
|---|---|---|---|
| `worca.events.enabled` | bool | `true` | Master switch for the entire event system. When false, no events are emitted and no webhooks fire. |
| `worca.events.agent_telemetry` | bool | `true` | Emit agent-level events (tool_use, text, etc.). Can be disabled to reduce event volume. |
| `worca.events.hook_events` | bool | `true` | Emit hook governance events. Can be disabled if hooks are noisy. |
| `worca.events.rate_limit_ms` | int | `1000` | Global default rate limit for webhook delivery of high-frequency events. |
| `worca.webhooks` | array | `[]` | List of webhook endpoint configurations. |
| `worca.webhooks[].url` | string | (required) | HTTPS endpoint to POST events to. |
| `worca.webhooks[].enabled` | bool | `true` | Per-webhook toggle. |
| `worca.webhooks[].secret` | string | `""` | Shared secret for HMAC-SHA256 signature. Empty string means unsigned. |
| `worca.webhooks[].events` | array of string | `["*"]` | Glob patterns for event types to deliver. |
| `worca.webhooks[].timeout_ms` | int | `5000` | HTTP request timeout in milliseconds. |
| `worca.webhooks[].max_retries` | int | `3` | Number of retries on failure (5xx / network error). |
| `worca.webhooks[].rate_limit_ms` | int | `1000` | Minimum interval between same-type event deliveries. 0 = no throttling. |
| `worca.webhooks[].control` | bool | `false` | If true, pipeline reads control commands from HTTP responses. Requires `secret`. |
| `worca.budget.max_cost_usd` | float/null | `null` | Cost budget for the run. When set, `pipeline.cost.budget_warning` events fire at `warning_pct`% and 100%. |
| `worca.budget.warning_pct` | int | `80` | Percentage of budget at which to emit first warning. |

**Validation rules (enforced at pipeline start):**
- `url` must start with `https://` or `http://localhost` (for development).
- `timeout_ms` must be 1000-30000.
- `max_retries` must be 0-10.
- `events` patterns must contain only alphanumeric, dots, and `*`.
- Control webhooks (`control: true`) must have a non-empty `secret`.

---

## 8. Implementation Tasks

### Phase 1: Core Infrastructure (Tasks 1-4)

#### Task 1: Create event types and payload helpers

**Files to create:**
- `.claude/worca/events/__init__.py`
- `.claude/worca/events/types.py`

**Guidance:**
- Define all 52 event type constants as module-level strings.
- Group constants by category with comments.
- Create one payload builder function per event type that accepts typed parameters and returns a dict. This prevents missing fields and enables validation.
- No external dependencies.

#### Task 2: Create event emitter module

**Files to create:**
- `.claude/worca/events/emitter.py`

**Guidance:**
- Implement the `EventContext` dataclass and `emit_event()` function per Section 3.
- Read `worca.events.enabled` from settings at `EventContext` construction time; cache it.
- Use `uuid.uuid4()` for event IDs, `datetime.now(timezone.utc).isoformat()` for timestamps.
- Open the JSONL file lazily on first write using `open(..., "a")`. Keep the file handle open for the run duration (`ctx._log_file`). Flush after every write.
- Wrap all I/O in try/except — log to stderr, never propagate.
- After writing to JSONL, iterate `worca.webhooks` and call `deliver_webhook()` for each matching webhook.

#### Task 3: Create webhook delivery module

**Files to create:**
- `.claude/worca/events/webhook.py`

**Guidance:**
- Implement `deliver_webhook(event, webhook_config, on_control=None)`.
- Use `urllib.request.Request` + `urllib.request.urlopen` for HTTP POST.
- Implement `_matches_event_filter(event_type, patterns)` using `fnmatch.fnmatch`.
- Implement `_compute_signature(secret, body)` using `hmac` + `hashlib.sha256`.
- Retry loop with exponential backoff: 1s, 2s, 4s (capped by `max_retries`).
- Each delivery runs in `threading.Thread(daemon=True)`.
- Rate limiting: maintain a `dict[str, float]` mapping `event_type → last_delivery_timestamp`. Skip delivery if within `rate_limit_ms`.
- For `control: true` webhooks, implement `deliver_webhook_sync()` that blocks and returns the response body as dict.

#### Task 4: Create hook emitter for subprocess events

**Files to create:**
- `.claude/worca/events/hook_emitter.py`

**Guidance:**
- Lightweight module imported by hook scripts.
- Reads `WORCA_EVENTS_PATH` and `WORCA_RUN_ID` from environment.
- If either is missing, silently no-ops (hooks run outside pipeline too).
- Constructs a minimal envelope (no webhook delivery — just JSONL append).
- Uses `open(..., "a")` + `flush()` per write.
- The `pipeline` field in the envelope is omitted (hooks don't have full context). The worca-ui watcher fills it in from the associated status.json.

### Phase 2: Runner Integration (Tasks 5-10)

#### Task 5: Initialize EventContext in run_pipeline()

**Files to modify:**
- `.claude/worca/orchestrator/runner.py`

**Guidance:**
- After status initialization (~line 769 fresh start, ~line 724 resume), create an `EventContext`.
- Set `events_path = os.path.join(run_dir, "events.jsonl")`.
- Set `WORCA_EVENTS_PATH` env var for hooks.
- Emit `pipeline.run.started` or `pipeline.run.resumed`.
- Add `ctx.close()` to the `finally` block alongside `_close_orchestrator_log()`.

#### Task 6: Wire stage lifecycle events

**Files to modify:**
- `.claude/worca/orchestrator/runner.py`

**Guidance:**
- After `start_iteration()` + `save_status()` (~line 892): emit `pipeline.stage.started`.
- In each completion branch (PREFLIGHT, PLAN, COORDINATE, IMPLEMENT, TEST, REVIEW, default): emit `pipeline.stage.completed` after `save_status()`.
- In `except Exception` (~line 991): emit `pipeline.stage.failed`.
- In `except InterruptedError` (~line 977) and shutdown check (~line 900): emit `pipeline.stage.interrupted`.
- Pattern: every `save_status()` call that changes stage status is immediately followed by the corresponding emit.

#### Task 7: Wire agent telemetry via on_event callback

**Files to modify:**
- `.claude/worca/orchestrator/runner.py` (in `run_stage()`)

**Guidance:**
- In `run_stage()`, construct an `on_event` callback closure that captures `ctx`, `stage`, `iteration`.
- Check `worca.events.agent_telemetry` setting — if false, pass `on_event=None`.
- The callback translates stream-json events to pipeline events using the mapping in Section 6.3.
- Use `_summarize_tool_input()` — reuse/share logic with the existing `_format_log_line()` in `claude_cli.py`.
- `run_stage()` needs to accept `event_ctx` as a parameter. Thread it from `run_pipeline()`.

#### Task 8: Wire bead lifecycle events

**Files to modify:**
- `.claude/worca/orchestrator/runner.py`
- `.claude/hooks/post_tool_use.py`

**Guidance (runner.py):**
- After `_claim_bead()` (~line 914): emit `pipeline.bead.assigned`.
- After `bd_close()` success (~line 1170): emit `pipeline.bead.completed`.
- After `bd_close()` failure (~line 1172): emit `pipeline.bead.failed`.
- After `bd_label_add()` (~line 1147): emit `pipeline.bead.labeled`.
- Before next-bead loop-back continue (~line 1192): emit `pipeline.bead.next`.

**Guidance (post_tool_use.py):**
- In `_link_bd_create_to_run()`, after parsing the issue ID (~line 39), call `emit_from_hook(BEAD_CREATED, ...)`.
- Import `emit_from_hook` from `worca.events.hook_emitter`.

#### Task 9: Wire test, review, and loop events

**Files to modify:**
- `.claude/worca/orchestrator/runner.py`

**Guidance:**
- TEST stage (~lines 1205-1243):
  - After `passed` check: emit `pipeline.test.suite_passed` or `pipeline.test.suite_failed`.
  - Before loop-back continue (~line 1235): emit `pipeline.test.fix_attempt`.
- REVIEW stage (~lines 1246-1304):
  - After `handle_pr_review()` (~line 1249): emit `pipeline.review.verdict`.
  - Before loop-back continue (~line 1287): emit `pipeline.review.fix_attempt`.
- Milestone events: after each `set_milestone()` call: emit `pipeline.milestone.set`.
- Loop events: before each loop-back `continue` and before each `raise LoopExhaustedError`: emit `pipeline.loop.triggered` / `pipeline.loop.exhausted`.

#### Task 10: Wire circuit breaker, cost, and remaining events

**Files to modify:**
- `.claude/worca/orchestrator/runner.py`

**Guidance:**
- Circuit breaker events: in the `except Exception` handler (~lines 1007-1045):
  - After `record_failure()`: emit `pipeline.circuit_breaker.failure_recorded`.
  - Before `time.sleep(_delay)`: emit `pipeline.circuit_breaker.retry`.
  - Before `raise CircuitBreakerTripped`: emit `pipeline.circuit_breaker.tripped`.
  - In the success path after `record_success()`: emit `pipeline.circuit_breaker.reset` (only if previous consecutive_failures > 0 — check before `record_success()` resets).
- Cost events: after token usage extraction (~line 1062):
  - Emit `pipeline.cost.stage_total` with the stage's usage.
  - Compute running total from `status["stages"]` and emit `pipeline.cost.running_total`.
  - Check budget threshold and emit `pipeline.cost.budget_warning` if exceeded.
- Git events:
  - After `create_branch()` (~line 745): emit `pipeline.git.branch_created`.
  - After PR stage output: parse `result` dict for PR URL and emit `pipeline.git.pr_created`.
- Preflight events: emit from the preflight handling at ~lines 950 and 1106.
- Learn events: emit from `_run_learn_stage()` at ~lines 438 and 440.

### Phase 3: Hook Integration (Task 11)

#### Task 11: Wire hook governance events

**Files to modify:**
- `.claude/hooks/pre_tool_use.py`
- `.claude/hooks/post_tool_use.py`
- `.claude/hooks/subagent_start.py`

**Guidance:**
- Import `emit_from_hook` from `worca.events.hook_emitter` (with try/except ImportError fallback).
- In `pre_tool_use.py`, after `check_guard()` returns non-zero (~line 57): emit `pipeline.hook.blocked`.
- In `post_tool_use.py`, after `check_test_gate()` returns non-zero (~line 59): emit `pipeline.hook.test_gate`.
- In `post_tool_use.py`, after `git commit` detection in Bash output: emit `pipeline.git.commit`.
- In `subagent_start.py`, when dispatch is denied: emit `pipeline.hook.dispatch_blocked`.
- Set `WORCA_EVENTS_PATH` in `run_pipeline()` env setup alongside existing `WORCA_PLAN_FILE` and `WORCA_RUN_ID`.

### Phase 4: Control Webhooks (Task 12)

#### Task 12: Implement control webhook response handling

**Files to modify:**
- `.claude/worca/events/webhook.py` (add `deliver_webhook_sync()`)
- `.claude/worca/events/emitter.py` (add `_check_control_response()`)
- `.claude/worca/orchestrator/runner.py` (add control checks at pause points)

**Guidance:**
- `deliver_webhook_sync()`: same as async delivery but blocking, returns parsed JSON response body.
- `_check_control_response(ctx, event)`: iterate `ctx.control_webhooks`, call `deliver_webhook_sync()`, return first non-"continue" action or None.
- In `runner.py`, insert control checks at three points:
  1. After `pipeline.milestone.set` emits (~line 1123 plan approved, ~line 843 plan skipped)
  2. After `pipeline.stage.completed` emits (all branches)
  3. After `pipeline.loop.triggered` emits (before each `continue`)
- Handle `"pause"` via `_handle_pause()` polling loop (see Section 5.4).
- Handle `"abort"` by raising `PipelineInterrupted`.
- Handle `"approve"` / `"reject"` by overriding milestone values.
- Validate at startup: control webhooks must have `secret` set.

### Phase 5: UI and Archive Integration (Tasks 13-16)

#### Task 13: Expose events to worca-ui via WebSocket

**Files to modify:**
- `.claude/worca-ui/server/ws.js`
- `.claude/worca-ui/server/watcher.js`

**Guidance (watcher.js):**
- Add `watchEvents(runDir, callback)` function that watches `{runDir}/events.jsonl` using `fs.watch()`.
- Tail new lines using the same byte-offset tracking pattern as the existing log tailer.
- Parse each new line as JSON and invoke `callback(event)`.
- Handle file creation (events.jsonl may not exist when watcher starts) by retrying watch on `rename` events.

**Guidance (ws.js):**
- Start an event watcher alongside the existing status file watcher, keyed to the active run's directory.
- On new event lines, broadcast a `pipeline-event` message to connected WebSocket clients subscribed to that run.
- Add a `get-events` request handler that reads the JSONL file and returns events filtered by:
  - `since_event_id`: return events after this event ID
  - `event_types`: glob patterns to filter
  - `limit`: max events to return (default 100)
- Add `subscribe-events` / `unsubscribe-events` handlers for real-time event streaming.

#### Task 14: Archive events alongside run results

**Files to modify:**
- `.claude/worca/orchestrator/runner.py` — in `_archive_run()`.

**Guidance:**
- Events are already co-located in `run_dir` (`.worca/runs/{run_id}/events.jsonl`), so they are automatically moved when `shutil.move(run_dir, dest)` runs at ~line 169.
- No additional code needed — verify this works by running a test pipeline.
- Add a check: if `events.jsonl` does not exist in the run dir (e.g., events were disabled), skip gracefully.

#### Task 15: Add Webhooks tab to the Settings UI

The worca-ui settings page (`settings.js`, 718 lines) has 5 existing tabs: Agents, Pipeline, Governance, Preferences, Notifications. Webhook configuration needs a 6th tab so users can manage webhooks visually instead of editing `settings.json` by hand.

**Files to modify:**
- `.claude/worca-ui/app/views/settings.js` — add `webhooksTab()` function and register it in the tab list.
- `.claude/worca-ui/server/settings-validator.js` — add webhook validation rules.

**Guidance (settings.js — Webhooks tab):**

The tab should follow the established patterns in the existing tabs (form inputs, save buttons, validation feedback via toast notifications, REST API `POST /api/settings`).

**UI layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  Agents │ Pipeline │ Governance │ Webhooks │ Prefs │ Notif  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Events System                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ☑ Enabled    ☑ Agent telemetry    ☑ Hook events     │   │
│  │ Rate limit: [1000] ms                                │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Budget                                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Max cost: [$___] per run    Warning at: [80] %       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Webhooks                           [+ Add Webhook]         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ☑  https://example.com/hook                          │   │
│  │    Events: pipeline.run.*, pipeline.stage.completed   │   │
│  │    Timeout: 5000ms │ Retries: 3 │ Control: No        │   │
│  │    [Edit] [Test] [Delete]                             │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ ☑  https://slack-relay.internal/worca                │   │
│  │    Events: pipeline.run.completed, pipeline.run.fail  │   │
│  │    Timeout: 5000ms │ Retries: 3 │ Control: No        │   │
│  │    [Edit] [Test] [Delete]                             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│                                              [Save]         │
└─────────────────────────────────────────────────────────────┘
```

**Webhook list view:**
- Each webhook shown as a card with: enabled toggle, URL, event patterns (comma-separated), timeout, retries, control flag.
- Action buttons: Edit (expand inline form), Test (send a `pipeline.test.ping` event), Delete (with confirmation).
- "Add Webhook" button opens an inline form at the top.

**Add/Edit webhook form:**
- URL input (required, validated: must start with `https://` or `http://localhost`).
- Secret input (password field, optional, required if control is enabled).
- Event patterns input (comma-separated, with examples dropdown: `*`, `pipeline.run.*`, `pipeline.stage.completed`). Show a multi-select checklist of event categories (Pipeline, Stage, Agent, Bead, Git, Test, Review, Circuit Breaker, Cost, Milestone, Hook, Preflight, Learn) that auto-generates the glob patterns.
- Timeout slider (1000-30000ms, default 5000).
- Max retries slider (0-10, default 3).
- Rate limit input (0-10000ms, default 1000).
- Control toggle (checkbox, shows warning: "Control webhooks can pause/abort the pipeline").
- Save / Cancel buttons.

**Test webhook button:**
- Sends a synthetic `pipeline.test.ping` event to the webhook URL via `POST /api/webhooks/test`.
- Shows success (green check + response status) or failure (red X + error message) inline.

**Guidance (settings-validator.js):**
- Add `validateWebhooks(webhooks)` function. Existing validator has `VALID_AGENTS`, `VALID_STAGES`, `VALID_MODELS`, `VALID_GUARDS` — follow the same pattern.
- Validation rules match Section 7 of this plan:
  - `url` must start with `https://` or `http://localhost`.
  - `timeout_ms` must be 1000-30000.
  - `max_retries` must be 0-10.
  - `events` patterns must match `/^[a-zA-Z0-9.*]+$/`.
  - Control webhooks must have non-empty `secret`.
- Return validation errors array (same pattern as existing `validateAgents()`, `validateStages()`).

**Guidance (server — test endpoint):**

**Files to modify:**
- `.claude/worca-ui/server/app.js` — add `POST /api/webhooks/test` endpoint.

The endpoint:
1. Reads the webhook config from the request body.
2. Constructs a `pipeline.test.ping` event with `payload: {"message": "Test from worca-ui"}`.
3. Sends it via `urllib`-equivalent (`node-fetch` or `https` module) with the same headers/signature logic as the Python delivery module.
4. Returns `{success: true, status_code: N, response_time_ms: N}` or `{success: false, error: "..."}`.

#### Task 16: Add webhook configuration validation (Python side)

**Files to modify:**
- `.claude/worca/orchestrator/runner.py` — at pipeline start.
- `.claude/worca/events/emitter.py` — in `EventContext.__init__`.

**Guidance:**
- Read `worca.webhooks` from settings in `EventContext.__init__`.
- Validate each webhook config:
  - `url` must start with `https://` or `http://localhost`.
  - `timeout_ms` must be 1000-30000.
  - `max_retries` must be 0-10.
  - `events` patterns must contain only `[a-zA-Z0-9.*]`.
  - Control webhooks must have non-empty `secret`.
- Log warnings for invalid configurations; exclude invalid webhooks from delivery list.
- Separate `ctx._webhooks` (observer) and `ctx._control_webhooks` (control) lists.

#### Task 17: Add defaults to settings.json

**Files to modify:**
- `.claude/settings.json`

**Guidance:**
- Add `events` and `webhooks` and `budget` keys under `worca` with the defaults from Section 7.
- This makes the configuration discoverable.

---

## 9. Testing Strategy

### 9.0 Approach & Philosophy

**Testing scope:** Every event type must be tested — both that it emits at the right moment and that its payload contains the expected fields. Tests are organized in three tiers:

1. **Unit tests** — test modules in isolation with mocks. Fast, no I/O beyond temp files. Run in <5s total.
2. **Integration tests** — test event sequences across a mocked pipeline run. Use real file I/O but mock `run_agent()` and external commands. Run in <30s.
3. **End-to-end tests** — test webhook delivery and worca-ui event streaming against real servers. Run in <60s.

**Test tools:** pytest (Python), vitest (JS). All tests use stdlib mocking (`unittest.mock`) — no additional test dependencies.

**Coverage target:** 100% of event types must have at least one unit test verifying emission. All error paths (I/O failure, webhook timeout, missing env vars) must have dedicated tests.

**Test location convention:** `tests/test_event_*.py` for Python, `.claude/worca-ui/test/events.test.js` for JS.

### 9.1 Unit Tests — Event Types & Payload Builders

**File to create:** `tests/test_event_types.py`

**Scope:** Validate the `types.py` module — event type constants and payload builder functions.

**Tests:**
- All 52 event type constants match the naming convention `pipeline.<noun>.<verb>` (regex check).
- No duplicate event type values across all constants.
- Each payload builder function returns a dict with all expected required keys.
- Payload builders reject missing required arguments (TypeError).
- Payload builder for `test.suite_failed` caps `failures` array at 10 items.
- Payload builder for `agent.tool_use` truncates `tool_input_summary` at 200 chars.

### 9.2 Unit Tests — Event Emitter

**File to create:** `tests/test_event_emitter.py`

**Scope:** Validate `emitter.py` — the `EventContext` class and `emit_event()` function.

**Tests:**
- `emit_event()` writes valid JSONL (one JSON object per line) to a temp file.
- Envelope structure: all required fields present (`schema_version`, `event_id`, `event_type`, `timestamp`, `run_id`, `pipeline`, `payload`).
- `schema_version` is `"1"`.
- `event_id` is a valid UUID4 (parse with `uuid.UUID`).
- `timestamp` is valid ISO-8601 (parse with `datetime.fromisoformat`).
- `emit_event()` returns the built event dict.
- `emit_event()` returns `None` and writes nothing when `ctx.enabled` is False.
- `emit_event()` catches and logs (does not raise) I/O errors (mock `open()` to raise `OSError`).
- `emit_event()` catches and logs JSON serialization errors (pass a non-serializable payload).
- `EventContext.close()` flushes and closes the file handle.
- `EventContext` reads `worca.events.enabled` from settings and caches it.
- Multiple sequential `emit_event()` calls produce multiple lines in the same file (file handle reuse).

### 9.3 Unit Tests — Webhook Delivery

**File to create:** `tests/test_webhook.py`

**Scope:** Validate `webhook.py` — delivery, filtering, signing, retries, rate limiting.

**Tests (event filtering):**
- `_matches_event_filter("pipeline.run.started", ["pipeline.run.*"])` → True
- `_matches_event_filter("pipeline.run.started", ["pipeline.stage.*"])` → False
- `_matches_event_filter("pipeline.run.started", ["*"])` → True
- `_matches_event_filter("pipeline.run.started", [])` → True (empty = all)
- `_matches_event_filter("pipeline.agent.tool_use", ["pipeline.run.*", "pipeline.agent.*"])` → True

**Tests (signature):**
- `_compute_signature("secret123", b'{"test": true}')` produces correct HMAC-SHA256 hex digest (compare against known precomputed value).
- Signature with empty secret returns empty string.

**Tests (HTTP delivery):**
- `deliver_webhook()` sends POST with correct `Content-Type`, `User-Agent`, `X-Worca-Event`, `X-Worca-Delivery` headers (mock `urlopen`).
- Body matches the full event envelope JSON.
- `X-Worca-Signature` header present when secret is configured, absent when not.
- Retry logic: mock a 500 response followed by a 200 — verify two requests were made with exponential backoff.
- Retry exhaustion: mock three 500 responses — verify no exception raised, failure is logged.
- Timeout handling: mock `urlopen` to raise `urllib.error.URLError` — verify no exception propagated.
- Thread isolation: `deliver_webhook()` runs in a daemon thread — verify main thread is not blocked (use `threading.Event` to detect completion).

**Tests (rate limiting):**
- Emit two events of the same type within `rate_limit_ms` — verify only one `urlopen` call.
- Emit two events of different types within `rate_limit_ms` — verify both delivered.
- Emit same type event after `rate_limit_ms` elapses — verify it is delivered.
- `rate_limit_ms: 0` disables throttling — verify all events delivered.

**Tests (sync delivery for control webhooks):**
- `deliver_webhook_sync()` returns parsed JSON response body.
- `deliver_webhook_sync()` returns None on network error (does not raise).
- `deliver_webhook_sync()` returns None on non-JSON response.

### 9.4 Unit Tests — Hook Emitter

**File to create:** `tests/test_hook_emitter.py`

**Scope:** Validate `hook_emitter.py` — the lightweight emitter for subprocess hooks.

**Tests:**
- `emit_from_hook()` writes valid JSONL when `WORCA_EVENTS_PATH` and `WORCA_RUN_ID` env vars are set.
- `emit_from_hook()` is a silent no-op when `WORCA_EVENTS_PATH` is missing.
- `emit_from_hook()` is a silent no-op when `WORCA_RUN_ID` is missing.
- Envelope contains `schema_version`, `event_id`, `event_type`, `timestamp`, `run_id`, `payload`.
- Envelope does NOT contain `pipeline` field (hooks lack full context).
- File append is atomic — write + flush per event (mock `open` and verify `flush()` called).
- I/O errors are caught and do not propagate (hook must not crash the agent).

### 9.5 Unit Tests — Control Webhooks

**File to create:** `tests/test_control_webhook.py`

**Scope:** Validate control webhook response handling and the pause/resume state machine.

**Tests:**
- `_check_control_response()` returns `"approve"` when control webhook responds with `{"control": {"action": "approve"}}`.
- `_check_control_response()` returns `None` when response is `{"control": {"action": "continue"}}`.
- `_check_control_response()` returns `None` when response has no `control` field.
- `_check_control_response()` returns `None` when no control webhooks are configured.
- `_check_control_response()` returns first non-continue action when multiple control webhooks exist.
- `_handle_pause()` emits `pipeline.run.paused` and enters polling loop (mock `time.sleep`).
- `_handle_pause()` exits loop and returns on `"resume"` response.
- `_handle_pause()` raises `PipelineInterrupted` on `"abort"` response.
- Config validation rejects control webhooks with empty secret.
- Config validation accepts control webhooks with non-empty secret.

### 9.6 Integration Tests — Event Sequences

**File to create:** `tests/test_event_integration.py`

**Scope:** Verify that a complete pipeline run produces the correct sequence and completeness of events. Uses mocked stages (no real Claude CLI calls).

**Test fixtures:**
- `mock_run_stage()`: returns canned structured output for each stage.
- `mock_run_preflight()`: returns success checks.
- Temp directory for `.worca/` state.

**Tests:**

**Happy path (all stages pass):**
- Mock all stages to return success. Run `run_pipeline()`.
- Read `events.jsonl` and parse all events.
- Verify ordering: `run.started` is first event, `run.completed` is last.
- For each stage in order (PREFLIGHT → PLAN → COORDINATE → IMPLEMENT → TEST → REVIEW → PR):
  - `stage.started` appears before `stage.completed`.
  - `cost.stage_total` and `cost.running_total` appear after `stage.completed`.
- Verify `milestone.set` appears after PLAN stage.
- Verify `bead.labeled` appears after COORDINATE stage.
- Verify every event has valid envelope fields.
- Verify no duplicate `event_id` values.

**Test failure loop:**
- Mock TEST stage to fail on first call, succeed on second.
- Verify event sequence: `test.suite_failed` → `test.fix_attempt` → `loop.triggered` → `stage.started` (IMPLEMENT) → `stage.completed` (IMPLEMENT) → `stage.started` (TEST) → `test.suite_passed`.

**Bead iteration loop:**
- Mock COORDINATE to return 3 beads. Mock IMPLEMENT to succeed.
- Verify: 3x `bead.assigned` → `bead.completed` → `bead.next` (for beads 1-2), then advance to TEST.

**Review changes loop:**
- Mock REVIEW to return `request_changes` with critical issues on first call, `approve` on second.
- Verify: `review.verdict` (request_changes) → `review.fix_attempt` → `loop.triggered` → IMPLEMENT → TEST → `review.verdict` (approve).

**Circuit breaker — transient retry:**
- Mock stage to raise RuntimeError once, then succeed.
- Verify: `stage.failed` → `circuit_breaker.failure_recorded` → `circuit_breaker.retry` → `stage.started` (same stage) → `stage.completed` → `circuit_breaker.reset`.

**Circuit breaker — tripped:**
- Mock stage to raise RuntimeError 3 times.
- Verify: 3x `circuit_breaker.failure_recorded` → `circuit_breaker.tripped` → `run.failed`.

**Resume:**
- Create a status file with PLAN completed. Run with `resume=True`.
- Verify: `run.resumed` is first event (not `run.started`), resuming from COORDINATE.

**Pipeline failure:**
- Mock PLAN to return `approved: False`.
- Verify: `milestone.set` (plan_approved=False) → `run.failed`.

**Interruption:**
- Set `_shutdown_requested = True` before a stage starts.
- Verify: `stage.interrupted` → `run.interrupted`.

**Budget warning:**
- Configure `budget.max_cost_usd: 1.0`. Mock stages to accumulate >$0.80 cost.
- Verify: `cost.budget_warning` emitted when 80% threshold crossed.

### 9.7 Integration Tests — Webhook Delivery

**File to create:** `tests/test_webhook_integration.py`

**Scope:** Test real HTTP webhook delivery against a local server. Validates the full round-trip including threading, headers, signature, and control responses.

**Test fixtures:**
- `WebhookTestServer`: a `http.server.HTTPServer` subclass running in a background thread on `localhost`. Records all received requests and allows configuring response bodies.
- Cleanup: server is shut down in fixture teardown.

**Tests:**

**Basic delivery:**
- Start test server. Configure a webhook pointing to `http://localhost:<port>`.
- Emit an event. Wait for the delivery thread to complete (join with timeout).
- Verify the server received exactly one POST with correct headers and body.

**HMAC signature verification:**
- Configure webhook with `secret: "test-secret-123"`.
- Emit an event. On the server side, verify `X-Worca-Signature` matches `HMAC-SHA256("test-secret-123", body)`.

**Unreachable server:**
- Configure webhook pointing to `http://localhost:1` (refused).
- Emit an event. Verify the pipeline does not hang (event emission returns within 1s).
- Verify no exception propagated.

**Control webhook — pause/resume:**
- Configure control webhook. Server responds with `{"control": {"action": "pause"}}` on first request.
- Call `_check_control_response()` and verify it returns `"pause"`.
- Change server to respond with `{"control": {"action": "resume"}}`.
- Call `_check_control_response()` and verify it returns `"resume"`.

**Control webhook — abort:**
- Server responds with `{"control": {"action": "abort", "reason": "manual stop"}}`.
- Call `_check_control_response()` and verify it returns `"abort"`.

**Event filtering:**
- Configure webhook with `events: ["pipeline.run.*"]`.
- Emit `pipeline.run.started` — verify server receives it.
- Emit `pipeline.stage.started` — verify server does NOT receive it.

### 9.8 worca-ui Tests

**File to create:** `.claude/worca-ui/test/events.test.js`

**Scope:** Test the worca-ui WebSocket server's event watching and broadcasting.

**Tests:**
- `watchEvents()` detects new lines appended to an events.jsonl file and invokes callback with parsed JSON.
- `watchEvents()` handles file creation (file doesn't exist initially, then is created).
- `watchEvents()` handles malformed JSON lines gracefully (skips, doesn't crash).
- `get-events` request handler returns events filtered by `since_event_id`.
- `get-events` request handler returns events filtered by `event_types` glob patterns.
- `get-events` request handler respects `limit` parameter.
- `subscribe-events` WebSocket message starts broadcasting `pipeline-event` messages to the client.
- `unsubscribe-events` stops broadcasting.
- `pipeline-event` messages contain the full event envelope.

### 9.9 Agent Telemetry Tests

**File to create:** `tests/test_agent_telemetry.py`

**Scope:** Test the `on_event` callback that translates stream-json events to pipeline events.

**Test fixtures:**
- A mock `EventContext` that records all emitted events in a list.
- Sample NDJSON event sequences representing common agent behaviors.

**Tests:**

**System init event:**
- Feed `{"type": "system", "subtype": "init", "model": "claude-sonnet-4-6"}`.
- Verify `pipeline.agent.spawned` emitted with `model: "claude-sonnet-4-6"`.

**Tool use events:**
- Feed assistant message with `tool_use` block for each tool type (Read, Write, Edit, Bash, Grep, Glob, Agent).
- Verify `pipeline.agent.tool_use` emitted for each.
- Verify `tool_input_summary` matches expected summarization:
  - Read → file path
  - Bash → first 120 chars of command
  - Grep → pattern
  - Agent → description

**Tool result events:**
- Feed user message with `tool_result` block, `is_error: false`.
- Verify `pipeline.agent.tool_result` emitted with `is_error: false`.
- Same with `is_error: true`.

**Text output:**
- Feed assistant message with `text` block.
- Verify `pipeline.agent.text` emitted with `text_length` matching the text.

**Result event:**
- Feed `{"type": "result", "num_turns": 15, "total_cost_usd": 0.42}`.
- Verify `pipeline.agent.completed` emitted with matching values.

**No event for hook/system events:**
- Feed `{"type": "system", "subtype": "hook"}`.
- Verify no pipeline event is emitted (hooks are noisy, should be filtered).

**Rate limiting (if agent_telemetry rate_limit is active):**
- Feed 10 tool_use events in quick succession.
- Verify all are written to JSONL but only a subset are delivered to webhooks.

### 9.10 Settings UI Tests

**File to create:** `.claude/worca-ui/test/settings-webhooks.test.js`

**Scope:** Test the Webhooks tab rendering, form validation, and API integration.

**Tests:**
- `webhooksTab()` renders empty state ("No webhooks configured") when `worca.webhooks` is empty.
- `webhooksTab()` renders webhook cards for each configured webhook.
- Webhook card shows URL, event patterns, timeout, retries, control badge, enabled toggle.
- "Add Webhook" button opens inline form.
- Form validates URL: rejects `ftp://`, accepts `https://`, accepts `http://localhost`.
- Form validates timeout: rejects 500, accepts 5000, rejects 50000.
- Form validates event patterns: rejects `pipeline.run.{bad}`, accepts `pipeline.run.*`.
- Form shows warning when control is enabled without secret.
- Save button calls `POST /api/settings` with updated `worca.webhooks` array.
- Delete button removes webhook from array and saves.
- Enable/disable toggle updates `enabled` field and saves.
- Event category checklist generates correct glob patterns (e.g., checking "Pipeline" produces `pipeline.run.*`).

**File to create:** `.claude/worca-ui/test/settings-validator-webhooks.test.js`

**Scope:** Test the validator extensions for webhook configuration.

**Tests:**
- `validateWebhooks([])` returns no errors.
- `validateWebhooks([{url: "https://ok.com"}])` returns no errors (other fields have defaults).
- `validateWebhooks([{url: "ftp://bad.com"}])` returns URL validation error.
- `validateWebhooks([{url: "https://ok.com", timeout_ms: 0}])` returns timeout error.
- `validateWebhooks([{url: "https://ok.com", control: true, secret: ""}])` returns "control requires secret" error.
- `validateWebhooks([{url: "https://ok.com", control: true, secret: "s3cr3t"}])` returns no errors.

**File to create:** `.claude/worca-ui/test/webhooks-test-endpoint.test.js`

**Scope:** Test the `POST /api/webhooks/test` endpoint.

**Tests:**
- Endpoint sends a `pipeline.test.ping` event to the provided URL.
- Returns `{success: true, status_code: 200}` when target responds 200.
- Returns `{success: false, error: "..."}` when target is unreachable.
- Includes correct `X-Worca-Event`, `X-Worca-Signature` headers when secret is provided.
- Times out after `timeout_ms` and returns error.

### 9.11 Test Matrix Summary

| Test File | Type | Event Categories Covered | Expected Count |
|---|---|---|---|
| `test_event_types.py` | Unit | All 52 types | ~10 tests |
| `test_event_emitter.py` | Unit | Emitter mechanics | ~12 tests |
| `test_webhook.py` | Unit | Delivery, filtering, signing, retries, rate limit | ~15 tests |
| `test_hook_emitter.py` | Unit | Hook subprocess emitter | ~7 tests |
| `test_control_webhook.py` | Unit | Control responses, pause/resume | ~10 tests |
| `test_event_integration.py` | Integration | All categories in pipeline context | ~12 tests |
| `test_webhook_integration.py` | Integration | Real HTTP delivery | ~6 tests |
| `test_agent_telemetry.py` | Unit | Agent telemetry | ~10 tests |
| `events.test.js` | Unit/Integration | worca-ui event streaming | ~9 tests |
| `settings-webhooks.test.js` | Unit | Settings UI Webhooks tab | ~12 tests |
| `settings-validator-webhooks.test.js` | Unit | Webhook config validation (JS) | ~6 tests |
| `webhooks-test-endpoint.test.js` | Integration | Webhook test ping endpoint | ~5 tests |
| **Total** | | | **~114 tests** |

### 9.12 Testing Per Implementation Phase

Each phase has a **test gate** — all tests for that phase must pass before proceeding.

| Phase | Tasks | Test Files | Gate |
|---|---|---|---|
| Phase 1 (Core) | 1-4 | `test_event_types.py`, `test_event_emitter.py`, `test_webhook.py`, `test_hook_emitter.py` | All unit tests pass |
| Phase 2 (Runner) | 5-10 | `test_event_integration.py`, `test_agent_telemetry.py` | Integration tests pass, all event types emitted |
| Phase 3 (Hooks) | 11 | Updated `test_hook_emitter.py` + manual verification | Hook events appear in JSONL during test pipeline run |
| Phase 4 (Control) | 12 | `test_control_webhook.py`, `test_webhook_integration.py` | Control actions work end-to-end |
| Phase 5 (UI) | 13-15 | `events.test.js`, `settings-webhooks.test.js`, `settings-validator-webhooks.test.js`, `webhooks-test-endpoint.test.js` | UI receives events, settings tab CRUD works, test ping works |
| Phase 6 (Validation) | 16-17 | Updated `test_event_emitter.py` (validation tests) | Invalid configs rejected gracefully |

---

## 10. Implementation Order and Dependencies

```
Phase 1: Core Infrastructure (no runner changes, independently testable)
  Task 1: types.py ─────────┐
  Task 2: emitter.py ───────┤── all independent, can be parallel
  Task 3: webhook.py ───────┤
  Task 4: hook_emitter.py ──┘

Phase 2: Runner Integration (depends on Phase 1)
  Task 5: EventContext init ─── first (others depend on ctx)
  Task 6: Stage lifecycle ──┐
  Task 7: Agent telemetry ──┤── can be parallel after Task 5
  Task 8: Bead lifecycle ───┤
  Task 9: Test/review/loop ─┤
  Task 10: CB/cost/git/etc ─┘

Phase 3: Hook Integration (depends on Task 4)
  Task 11: Hook events ─── can be parallel with Phase 2

Phase 4: Control Webhooks (depends on Phase 1 + Task 5)
  Task 12: Control responses ─── after Phase 2

Phase 5: UI and Archive Integration (depends on Phase 1)
  Task 13: worca-ui WebSocket events ─── can be parallel with Phase 2
  Task 14: Archive verification ─── after Phase 2
  Task 15: Settings UI Webhooks tab ─── depends on Task 13 (shares ws.js)

Phase 6: Validation and Defaults (depends on all above)
  Task 16: Config validation (Python) ─── after Phase 4
  Task 17: Settings defaults ─── any time
```

**Suggested implementation sessions:**
1. **Session 1:** Tasks 1-4 (core modules, fully testable in isolation)
2. **Session 2:** Tasks 5-10 (runner integration, all events wired)
3. **Session 3:** Tasks 11-12 (hooks + control webhooks)
4. **Session 4:** Tasks 13-17 (UI, settings tab, validation, polish)

---

## 11. Future Extensions (Out of Scope)

**Slack notifications:** Add a Slack delivery channel alongside webhooks. Read a `worca.notifications.slack` config with `webhook_url`, `channel`, and `events` filter. Format event payloads into Slack Block Kit messages.

**Email notifications:** Add an email delivery channel using SMTP. Batch rapid events into digest emails using a short delay window.

**Event routing and filtering rules:** Allow per-webhook transformation and filtering beyond glob patterns. Define rules using a lightweight expression language.

**Persistent event store:** Replace or supplement the JSONL file with a SQLite database for querying, aggregation, and retention policies.

**External event ingestion:** Accept inbound events (e.g., GitHub PR status, CI results) that the pipeline can react to, enabling bidirectional integration.

**Event replay:** Add `--replay-events` flag to `run_pipeline.py` that reads a previous run's `events.jsonl` and re-delivers to configured webhooks. Useful for testing webhook consumers.

**Budget enforcement:** Extend `pipeline.cost.budget_warning` to optionally **halt** the pipeline when budget is exceeded (currently advisory only).

**Webhook batching:** For high-volume deployments, batch multiple events into a single HTTP POST with an array body, reducing connection overhead.

---

## Appendix A: Event Flow Diagram

```
run_pipeline() called
  │
  ├── [fresh start]
  │     emit: pipeline.run.started
  │     emit: pipeline.git.branch_created
  │
  ├── [resume]
  │     emit: pipeline.run.resumed
  │
  ├── for each stage:
  │     │
  │     ├── start_iteration()
  │     │     emit: pipeline.stage.started
  │     │     emit: pipeline.test.suite_started  (TEST only)
  │     │     emit: pipeline.review.started      (REVIEW only)
  │     │
  │     ├── [bead assignment, IMPLEMENT only]
  │     │     emit: pipeline.bead.assigned
  │     │
  │     ├── run_stage() / run_agent()
  │     │     │
  │     │     ├── [subprocess spawned]
  │     │     │     emit: pipeline.agent.spawned
  │     │     │
  │     │     ├── [each tool call]
  │     │     │     emit: pipeline.agent.tool_use
  │     │     │     emit: pipeline.agent.tool_result
  │     │     │
  │     │     ├── [each text block]
  │     │     │     emit: pipeline.agent.text
  │     │     │
  │     │     ├── [hook blocks action]
  │     │     │     emit: pipeline.hook.blocked
  │     │     │
  │     │     ├── [test gate triggers]
  │     │     │     emit: pipeline.hook.test_gate
  │     │     │
  │     │     ├── [git commit detected]
  │     │     │     emit: pipeline.git.commit
  │     │     │
  │     │     └── [subprocess exits]
  │     │           emit: pipeline.agent.completed
  │     │
  │     ├── [success]
  │     │     emit: pipeline.stage.completed
  │     │     emit: pipeline.cost.stage_total
  │     │     emit: pipeline.cost.running_total
  │     │     emit: pipeline.cost.budget_warning  (if threshold hit)
  │     │     emit: pipeline.circuit_breaker.reset  (if prev failures)
  │     │     │
  │     │     ├── [PREFLIGHT]
  │     │     │     emit: pipeline.preflight.completed / .skipped
  │     │     │
  │     │     ├── [PLAN]
  │     │     │     emit: pipeline.milestone.set (plan_approved)
  │     │     │     → control check (approve/reject)
  │     │     │
  │     │     ├── [COORDINATE]
  │     │     │     emit: pipeline.bead.labeled
  │     │     │
  │     │     ├── [IMPLEMENT]
  │     │     │     emit: pipeline.bead.completed / .failed
  │     │     │     emit: pipeline.bead.next  (if more beads)
  │     │     │
  │     │     ├── [TEST passed]
  │     │     │     emit: pipeline.test.suite_passed
  │     │     │
  │     │     ├── [TEST failed]
  │     │     │     emit: pipeline.test.suite_failed
  │     │     │     emit: pipeline.test.fix_attempt
  │     │     │     emit: pipeline.loop.triggered
  │     │     │     → control check
  │     │     │
  │     │     ├── [REVIEW]
  │     │     │     emit: pipeline.review.verdict
  │     │     │     emit: pipeline.review.fix_attempt  (if changes)
  │     │     │     emit: pipeline.loop.triggered  (if loop-back)
  │     │     │     → control check
  │     │     │
  │     │     └── [PR]
  │     │           emit: pipeline.git.pr_created
  │     │
  │     ├── [error]
  │     │     emit: pipeline.stage.failed
  │     │     emit: pipeline.circuit_breaker.failure_recorded
  │     │     │
  │     │     ├── [retriable transient]
  │     │     │     emit: pipeline.circuit_breaker.retry
  │     │     │
  │     │     └── [halt]
  │     │           emit: pipeline.circuit_breaker.tripped
  │     │           emit: pipeline.run.failed
  │     │
  │     └── [interrupted]
  │           emit: pipeline.stage.interrupted
  │           emit: pipeline.run.interrupted
  │
  ├── [all stages done]
  │     emit: pipeline.run.completed
  │     emit: pipeline.learn.completed / .failed  (if enabled)
  │
  ├── [unrecoverable error]
  │     emit: pipeline.run.failed
  │     emit: pipeline.learn.completed / .failed  (if enabled)
  │
  └── [signal caught]
        emit: pipeline.run.interrupted
```

## Appendix B: Example Events

### B.1 Stage Completed with Cost

```json
{
  "schema_version": "1",
  "event_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "event_type": "pipeline.stage.completed",
  "timestamp": "2026-03-20T14:32:07.123456+00:00",
  "run_id": "20260320-143000",
  "pipeline": {
    "branch": "worca/add-user-auth-X2k",
    "work_request": { "title": "Add user authentication", "source_ref": "GH#42", "priority": "2" }
  },
  "payload": {
    "stage": "implement",
    "iteration": 2,
    "duration_ms": 45230,
    "cost_usd": 0.87,
    "turns": 34,
    "outcome": "success",
    "trigger": "test_failure",
    "token_usage": { "input_tokens": 125000, "output_tokens": 18000 }
  }
}
```

### B.2 Agent Tool Use

```json
{
  "schema_version": "1",
  "event_id": "f9e8d7c6-b5a4-3210-fedc-ba9876543210",
  "event_type": "pipeline.agent.tool_use",
  "timestamp": "2026-03-20T14:31:15.456789+00:00",
  "run_id": "20260320-143000",
  "pipeline": {
    "branch": "worca/add-user-auth-X2k",
    "work_request": { "title": "Add user authentication", "source_ref": "GH#42", "priority": "2" }
  },
  "payload": {
    "stage": "implement",
    "iteration": 2,
    "tool": "Edit",
    "tool_input_summary": "src/auth/login.py",
    "turn": 12
  }
}
```

### B.3 Circuit Breaker Retry

```json
{
  "schema_version": "1",
  "event_id": "11223344-5566-7788-99aa-bbccddeeff00",
  "event_type": "pipeline.circuit_breaker.retry",
  "timestamp": "2026-03-20T14:35:00.000000+00:00",
  "run_id": "20260320-143000",
  "pipeline": {
    "branch": "worca/add-user-auth-X2k",
    "work_request": { "title": "Add user authentication", "source_ref": "GH#42", "priority": "2" }
  },
  "payload": {
    "stage": "implement",
    "attempt": 1,
    "delay_seconds": 10,
    "consecutive_failures": 1
  }
}
```

### B.4 Control Webhook Response

Request (pipeline → webhook):
```json
{
  "event_type": "pipeline.milestone.set",
  "payload": { "milestone": "plan_approved", "value": true, "stage": "plan" }
}
```

Response (webhook → pipeline):
```json
{
  "control": {
    "action": "approve",
    "reason": "Plan reviewed and approved by team lead"
  }
}
```

### B.5 Bead Lifecycle

```json
{
  "schema_version": "1",
  "event_id": "aabbccdd-eeff-0011-2233-445566778899",
  "event_type": "pipeline.bead.assigned",
  "timestamp": "2026-03-20T14:28:00.000000+00:00",
  "run_id": "20260320-143000",
  "pipeline": {
    "branch": "worca/add-user-auth-X2k",
    "work_request": { "title": "Add user authentication", "source_ref": "GH#42", "priority": "2" }
  },
  "payload": {
    "bead_id": "beads-abc123",
    "title": "Implement JWT token generation",
    "iteration": 1
  }
}
```

### B.6 Running Cost Total

```json
{
  "schema_version": "1",
  "event_id": "deadbeef-cafe-babe-face-000000000001",
  "event_type": "pipeline.cost.running_total",
  "timestamp": "2026-03-20T14:33:00.000000+00:00",
  "run_id": "20260320-143000",
  "pipeline": {
    "branch": "worca/add-user-auth-X2k",
    "work_request": { "title": "Add user authentication", "source_ref": "GH#42", "priority": "2" }
  },
  "payload": {
    "total_cost_usd": 3.42,
    "total_input_tokens": 450000,
    "total_output_tokens": 65000,
    "by_stage": {
      "plan": { "cost_usd": 0.95 },
      "coordinate": { "cost_usd": 0.72 },
      "implement": { "cost_usd": 1.75 }
    },
    "by_model": {
      "claude-opus-4-6": { "cost_usd": 1.67 },
      "claude-sonnet-4-6": { "cost_usd": 1.75 }
    }
  }
}
```
