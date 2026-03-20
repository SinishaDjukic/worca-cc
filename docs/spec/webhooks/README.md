# Worca Pipeline Events & Webhooks

**Version:** 1
**Status:** Stable
**Schema Version:** `"1"`

---

## Table of Contents

1. [Overview](#1-overview)
2. [HTTP Protocol](#2-http-protocol)
3. [Event Envelope](#3-event-envelope)
4. [Event Catalog](#4-event-catalog)
5. [Control Webhooks](#5-control-webhooks)
6. [Configuration Reference](#6-configuration-reference)
7. [Examples](#7-examples)
8. [JSON Schema Reference](#8-json-schema-reference)

---

## 1. Overview

### 1.1 What Are Worca Pipeline Events?

Worca emits **50 structured events** as it runs your AI-powered software development pipeline. These events cover every meaningful moment — from when a pipeline run starts to when individual test cases fail, code is committed, and beads (work items) complete. Events are emitted in real time, ordered by timestamp, and written to an append-only JSONL file at `.worca/runs/{run_id}/events.jsonl`.

Event categories:

| Category | Events |
|---|---|
| Pipeline lifecycle | 5 |
| Stage lifecycle | 4 |
| Agent telemetry | 5 |
| Bead lifecycle | 6 |
| Git operations | 4 |
| Test detail | 4 |
| Review detail | 3 |
| Circuit breaker | 4 |
| Cost & tokens | 3 |
| Milestones & loops | 3 |
| Hook & governance | 3 |
| Preflight | 2 |
| **Total** | **50** |

### 1.2 How Webhook Delivery Works

Worca uses a **push model**: when an event occurs, worca sends an HTTP POST request to each configured webhook URL. Observer webhooks are delivered **asynchronously** in background threads and never block the pipeline. Control webhooks (see [Section 5](#5-control-webhooks)) are delivered synchronously at natural pause points to read pipeline control commands.

### 1.3 Quick Start

**Step 1: Configure a webhook endpoint in `.claude/settings.json`:**

```json
{
  "worca": {
    "webhooks": [
      {
        "url": "https://your-server.example.com/worca-events",
        "enabled": true,
        "secret": "your-shared-secret",
        "events": ["*"],
        "timeout_ms": 5000,
        "max_retries": 3
      }
    ]
  }
}
```

**Step 2: Your endpoint receives HTTP POST requests like this:**

```
POST /worca-events HTTP/1.1
Content-Type: application/json
X-Worca-Event: pipeline.run.started
X-Worca-Delivery: 550e8400-e29b-41d4-a716-446655440000
X-Worca-Signature: sha256=abc123...

{
  "schema_version": "1",
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "event_type": "pipeline.run.started",
  "timestamp": "2026-03-09T14:32:00.000Z",
  "run_id": "20260309-143200",
  "pipeline": {
    "branch": "worca/w-042-add-auth",
    "work_request": { "title": "W-042: Add user authentication", "source_ref": "gh:issue:42", "priority": "P2" }
  },
  "payload": {
    "resume": false,
    "started_at": "2026-03-09T14:32:00.000Z",
    "plan_file": null
  }
}
```

**Step 3: Respond with HTTP 2xx to acknowledge receipt.** Any non-2xx response triggers a retry.

---

## 2. HTTP Protocol

### 2.1 Request Format

Every webhook delivery is an HTTP POST with a JSON body:

```
POST <your-url>
Content-Type: application/json
User-Agent: worca-pipeline/1.0
X-Worca-Event: <event_type>
X-Worca-Delivery: <event_id>
X-Worca-Signature: sha256=<hex-digest>   (only when secret is configured)

<full event envelope as JSON>
```

### 2.2 Request Headers

| Header | Always Present | Description |
|---|---|---|
| `Content-Type` | Yes | Always `application/json` |
| `User-Agent` | Yes | Always `worca-pipeline/1.0` |
| `X-Worca-Event` | Yes | The `event_type` string, e.g. `pipeline.run.started` |
| `X-Worca-Delivery` | Yes | The `event_id` UUID — use this for idempotency and deduplication |
| `X-Worca-Signature` | Only if `secret` is configured | HMAC-SHA256 signature of the request body |

### 2.3 Authentication: HMAC-SHA256 Signature Verification

When you configure a `secret`, every request includes an `X-Worca-Signature` header:

```
X-Worca-Signature: sha256=<hex-encoded-HMAC-SHA256>
```

The signature is computed as:

```
HMAC-SHA256(secret, raw_request_body_bytes)
```

**Verification example (Python):**

```python
import hmac
import hashlib

def verify_signature(payload_bytes: bytes, secret: str, signature_header: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        payload_bytes,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

**Verification example (Node.js):**

```javascript
const crypto = require("crypto");

function verifySignature(payloadBytes, secret, signatureHeader) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(payloadBytes)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );
}
```

Always use a timing-safe comparison to prevent timing attacks.

### 2.4 Response Expectations

| HTTP Status | Interpretation |
|---|---|
| `2xx` (200–299) | Success — event acknowledged, no retry |
| `4xx` (400–499) | Client error — **no retry** (the payload won't change) |
| `5xx` (500–599) | Server error — **retry with exponential backoff** |
| Network error / timeout | Treated as 5xx — retry |

Your endpoint should respond quickly. If processing takes more than a few seconds, respond immediately with `202 Accepted` and process asynchronously.

### 2.5 Retry Behavior

On `5xx` or network failure, worca retries with exponential backoff:

| Attempt | Delay Before Retry |
|---|---|
| 1st retry | 1 second |
| 2nd retry | 2 seconds |
| 3rd retry | 4 seconds |

The number of retries is configured via `max_retries` (default 3). After all retries are exhausted, the delivery is abandoned and a warning is logged. **Delivery failures never affect the pipeline.**

### 2.6 Rate Limiting

High-frequency events (especially `pipeline.agent.tool_use` and `pipeline.agent.text`) can occur dozens of times per minute. To prevent overwhelming your endpoint, worca applies a per-event-type rate limit:

- Default: 1 delivery per second per event type per webhook.
- Configure with `rate_limit_ms` in the webhook config. Set to `0` for no throttling.
- Events emitted while rate-limited are queued; only the most recent is delivered when the window expires.
- The JSONL file always receives every event regardless of rate limits.

---

## 3. Event Envelope

Every event shares a common envelope structure. All fields are present in every event.

### 3.1 Common Fields

```json
{
  "schema_version": "1",
  "event_id":       "550e8400-e29b-41d4-a716-446655440000",
  "event_type":     "pipeline.stage.completed",
  "timestamp":      "2026-03-09T14:35:42.123Z",
  "run_id":         "20260309-143200",
  "pipeline": {
    "branch":       "worca/w-042-add-auth",
    "work_request": {
      "title":      "W-042: Add user authentication",
      "source_ref": "gh:issue:42",
      "priority":   "P2"
    }
  },
  "payload": { }
}
```

| Field | Type | Description |
|---|---|---|
| `schema_version` | string | Always `"1"`. Bumped only on breaking changes. |
| `event_id` | string (UUID4) | Unique ID generated at emit time. Use for idempotency/deduplication. |
| `event_type` | string | Dotted event name, e.g. `pipeline.run.started`. See [Section 4](#4-event-catalog). |
| `timestamp` | string (ISO-8601 UTC) | When the event was emitted, e.g. `2026-03-09T14:35:42.123Z`. |
| `run_id` | string | Pipeline run identifier in `YYYYMMDD-HHMMSS` format. Correlates with the UI and status files. |
| `pipeline.branch` | string | Git branch name for this run. |
| `pipeline.work_request.title` | string | Human-readable work request title. |
| `pipeline.work_request.source_ref` | string | Source reference (e.g. `gh:issue:42`, `bead:worca-cc-abc`). May be absent. |
| `pipeline.work_request.priority` | string | Priority string (e.g. `P2`). May be absent. |
| `payload` | object | Event-specific data. Fields vary by `event_type`. See [Section 4](#4-event-catalog). |

### 3.2 Versioning Policy

- `schema_version` is `"1"` until a breaking change is required.
- **No version bump:** Adding optional fields to payloads, adding new event types, extending enum values.
- **Version bump required:** Removing or renaming fields, changing field types or semantics.
- **Consumer contract:** Ignore unknown fields. Ignore unknown event types. Write forward-compatible consumers.

### 3.3 Idempotency

Each event has a unique `event_id` (UUID4). Your consumer can use this for idempotent processing:

```python
if event_id in already_processed:
    return  # skip duplicate
already_processed.add(event_id)
process(event)
```

Duplicate delivery can happen in edge cases (e.g., worca retried after a 2xx response was lost in transit). Always deduplicate on `event_id`.

---

## 4. Event Catalog

### 4.1 Pipeline Lifecycle

These events track the overall pipeline run from start to finish.

#### `pipeline.run.started`

Emitted when the pipeline begins execution, after initialization.

| Field | Type | Required | Description |
|---|---|---|---|
| `resume` | boolean | Yes | `true` if resuming from a prior checkpoint, `false` for a fresh start. |
| `started_at` | string (ISO-8601) | Yes | When this run was initialized. |
| `plan_file` | string \| null | No | Path to plan file if provided as input, otherwise null. |
| `settings_snapshot` | object | No | Snapshot of relevant worca settings for this run. |

**Example:**
```json
{
  "payload": {
    "resume": false,
    "started_at": "2026-03-09T14:32:00.000Z",
    "plan_file": "docs/plans/W-042-add-auth.md",
    "settings_snapshot": { "models": { "opus": "claude-opus-4-6" } }
  }
}
```

---

#### `pipeline.run.completed`

Emitted when the pipeline finishes successfully (all stages completed).

| Field | Type | Required | Description |
|---|---|---|---|
| `duration_ms` | integer | Yes | Total run duration in milliseconds. |
| `total_cost_usd` | number | Yes | Total cost of the run in USD. |
| `total_turns` | integer | Yes | Total agent turns across all stages. |
| `total_tokens` | integer | Yes | Total tokens consumed across all stages. |
| `stages_completed` | array of string | Yes | Ordered list of stage names that completed successfully. |

---

#### `pipeline.run.failed`

Emitted when the pipeline terminates with an unrecoverable error.

| Field | Type | Required | Description |
|---|---|---|---|
| `error` | string | Yes | Human-readable error message. |
| `failed_stage` | string \| null | Yes | Stage name where failure occurred, or null if pre-stage. |
| `error_type` | string | Yes | Python exception class name (e.g. `PipelineError`, `LoopExhaustedError`). |
| `loop_counters` | object | No | Current loop iteration counts at time of failure. |

---

#### `pipeline.run.interrupted`

Emitted when the pipeline is interrupted by a signal (SIGTERM/SIGINT) or user abort.

| Field | Type | Required | Description |
|---|---|---|---|
| `interrupted_stage` | string | Yes | Stage name that was active when interrupted. |
| `elapsed_ms` | integer | Yes | Elapsed run time in milliseconds at interruption. |

---

#### `pipeline.run.resumed`

Emitted when the pipeline detects a prior checkpoint and resumes from it.

| Field | Type | Required | Description |
|---|---|---|---|
| `resume_stage` | string | Yes | The stage the pipeline is resuming from. |
| `previous_stages_completed` | array of string | Yes | Stages that were already completed before resumption. |

---

### 4.2 Stage Lifecycle

These events are emitted for every stage iteration (plan, coordinate, implement, test, review, etc.).

#### `pipeline.stage.started`

Emitted at the beginning of each stage iteration.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage name (e.g. `PLAN`, `IMPLEMENT`, `TEST`). |
| `iteration` | integer | Yes | Iteration number within this stage (1-based). |
| `agent` | string | Yes | Agent template name (e.g. `planner`, `implementer`). |
| `model` | string | Yes | Claude model ID being used. |
| `trigger` | string | Yes | What triggered this stage (e.g. `initial`, `test_failure`, `review_changes`). |
| `max_turns` | integer | Yes | Maximum turns configured for this agent invocation. |

**Example:**
```json
{
  "payload": {
    "stage": "IMPLEMENT",
    "iteration": 2,
    "agent": "implementer",
    "model": "claude-sonnet-4-6",
    "trigger": "test_failure",
    "max_turns": 40
  }
}
```

---

#### `pipeline.stage.completed`

Emitted when a stage iteration finishes successfully.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage name. |
| `iteration` | integer | Yes | Iteration number. |
| `duration_ms` | integer | Yes | Stage duration in milliseconds. |
| `cost_usd` | number | Yes | Cost of this stage iteration in USD. |
| `turns` | integer | Yes | Number of agent turns used. |
| `outcome` | string | Yes | Stage outcome (e.g. `success`, `passed`, `approved`). |
| `token_usage` | object | No | `{ "input_tokens": N, "output_tokens": N }` |

---

#### `pipeline.stage.failed`

Emitted when a stage iteration terminates with an error.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage name. |
| `iteration` | integer | Yes | Iteration number. |
| `error` | string | Yes | Error message. |
| `error_type` | string | Yes | Exception class name. |
| `elapsed_ms` | integer | Yes | Elapsed time when failure occurred. |

---

#### `pipeline.stage.interrupted`

Emitted when a stage is interrupted by a signal mid-execution.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage name. |
| `iteration` | integer | Yes | Iteration number. |
| `elapsed_ms` | integer | Yes | Elapsed time when interrupted. |

---

### 4.3 Agent Telemetry

Real-time visibility into agent activity. These events are emitted from inside the agent subprocess stream. Frequency can be high; rate limiting applies (see [Section 2.6](#26-rate-limiting)).

#### `pipeline.agent.spawned`

Emitted when an agent subprocess starts.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage that launched this agent. |
| `iteration` | integer | Yes | Stage iteration number. |
| `agent` | string | Yes | Agent template name. |
| `model` | string | Yes | Claude model ID. |
| `pid` | integer | No | Process ID of the Claude subprocess. |
| `max_turns` | integer | Yes | Maximum turns for this invocation. |

---

#### `pipeline.agent.tool_use`

Emitted each time the agent calls a tool (Read, Write, Edit, Bash, Grep, Glob, Agent).

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Current stage. |
| `iteration` | integer | Yes | Stage iteration. |
| `tool` | string | Yes | Tool name (e.g. `Read`, `Bash`, `Write`). |
| `tool_input_summary` | string | Yes | Abbreviated tool input (file path, command prefix, pattern, etc.). Never contains file contents. |
| `turn` | integer | Yes | Current agent turn number. |

---

#### `pipeline.agent.tool_result`

Emitted when a tool call returns a result.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Current stage. |
| `iteration` | integer | Yes | Stage iteration. |
| `tool` | string | Yes | Tool name. |
| `is_error` | boolean | Yes | `true` if the tool returned an error result. |
| `turn` | integer | Yes | Current agent turn number. |

---

#### `pipeline.agent.text`

Emitted when the agent outputs text (reasoning, explanations). Contains length only, not the text itself.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Current stage. |
| `iteration` | integer | Yes | Stage iteration. |
| `text_length` | integer | Yes | Number of characters in the text block. |
| `turn` | integer | Yes | Current agent turn number. |

---

#### `pipeline.agent.completed`

Emitted when the agent subprocess exits.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage that ran this agent. |
| `iteration` | integer | Yes | Stage iteration. |
| `turns` | integer | Yes | Total turns used. |
| `cost_usd` | number | Yes | Total cost for this invocation in USD. |
| `duration_ms` | integer | Yes | Subprocess duration in milliseconds. |
| `exit_code` | integer | Yes | Subprocess exit code (`0` = success). |

---

### 4.4 Bead Lifecycle

Bead events track individual work items (beads) through the COORDINATE and IMPLEMENT stages. Beads are discrete tasks managed by the `bd` CLI.

**Example — bead assigned:**
```json
{
  "event_type": "pipeline.bead.assigned",
  "payload": {
    "bead_id": "worca-cc-abc",
    "title": "W-042 T3: Implement JWT token generation",
    "iteration": 1
  }
}
```

#### `pipeline.bead.created`

| Field | Type | Required | Description |
|---|---|---|---|
| `bead_id` | string | Yes | Bead identifier (e.g. `worca-cc-abc`). |
| `title` | string | Yes | Bead title. |
| `run_label` | string | No | Run label applied to link this bead to the run (e.g. `run:20260309-143200`). |

#### `pipeline.bead.assigned`

| Field | Type | Required | Description |
|---|---|---|---|
| `bead_id` | string | Yes | Bead identifier. |
| `title` | string | Yes | Bead title. |
| `iteration` | integer | Yes | IMPLEMENT stage iteration number. |

#### `pipeline.bead.completed`

| Field | Type | Required | Description |
|---|---|---|---|
| `bead_id` | string | Yes | Bead identifier. |
| `reason` | string | Yes | Completion reason (e.g. `implemented`). |

#### `pipeline.bead.failed`

| Field | Type | Required | Description |
|---|---|---|---|
| `bead_id` | string | Yes | Bead identifier. |
| `error` | string | Yes | Error message explaining why the bead could not be closed. |

#### `pipeline.bead.labeled`

| Field | Type | Required | Description |
|---|---|---|---|
| `bead_ids` | array of string | Yes | IDs of beads that were labeled. |
| `label` | string | Yes | Label applied (e.g. `run:20260309-143200`). |

#### `pipeline.bead.next`

Emitted when more beads are available and the pipeline loops back to IMPLEMENT.

| Field | Type | Required | Description |
|---|---|---|---|
| `next_bead_id` | string | Yes | ID of the next bead to be implemented. |
| `bead_iteration` | integer | Yes | Bead loop iteration count. |
| `max_beads` | integer | No | Maximum beads configured for this run. |

---

### 4.5 Git Operations

#### `pipeline.git.branch_created`

| Field | Type | Required | Description |
|---|---|---|---|
| `branch` | string | Yes | Name of the branch created (e.g. `worca/w-042-add-auth`). |
| `base_ref` | string | No | Base ref the branch was created from (e.g. `main`). |

#### `pipeline.git.commit`

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage during which the commit occurred (always `GUARDIAN`). |
| `commit_hash` | string | Yes | Short commit hash (7 characters). |
| `message_summary` | string | Yes | First line of the commit message (subject). |

#### `pipeline.git.pr_created`

| Field | Type | Required | Description |
|---|---|---|---|
| `pr_url` | string | Yes | Full URL of the created pull request. |
| `pr_number` | integer | Yes | PR number. |
| `title` | string | Yes | PR title. |

#### `pipeline.git.pr_merged`

| Field | Type | Required | Description |
|---|---|---|---|
| `pr_url` | string | Yes | URL of the merged pull request. |
| `pr_number` | integer | Yes | PR number. |

---

### 4.6 Test Detail

#### `pipeline.test.suite_started`

Emitted when the TEST stage begins execution.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Always `TEST`. |
| `iteration` | integer | Yes | Test iteration number. |
| `trigger` | string | Yes | What triggered this test run (e.g. `initial`, `fix_attempt`). |

#### `pipeline.test.suite_passed`

| Field | Type | Required | Description |
|---|---|---|---|
| `iteration` | integer | Yes | Test iteration number. |
| `coverage_pct` | number \| null | No | Test coverage percentage if reported. |
| `proof_artifacts` | array of string | No | Paths to test output artifacts. |

#### `pipeline.test.suite_failed`

| Field | Type | Required | Description |
|---|---|---|---|
| `iteration` | integer | Yes | Test iteration number. |
| `failure_count` | integer | Yes | Number of failing tests. |
| `failures` | array of object | Yes | Up to 10 failures: `[{ "test": "...", "error": "...", "file": "..." }]`. Capped at 10 to prevent large payloads. |

**Example:**
```json
{
  "payload": {
    "iteration": 1,
    "failure_count": 3,
    "failures": [
      { "test": "test_auth_token_expiry", "error": "AssertionError: expected 401", "file": "tests/test_auth.py" },
      { "test": "test_refresh_token", "error": "KeyError: 'refresh_token'", "file": "tests/test_auth.py" }
    ]
  }
}
```

#### `pipeline.test.fix_attempt`

Emitted before looping back to IMPLEMENT after a test failure.

| Field | Type | Required | Description |
|---|---|---|---|
| `attempt` | integer | Yes | Fix attempt number (1-based). |
| `limit` | integer | Yes | Maximum fix attempts configured. |
| `failures_summary` | string | Yes | Brief summary of the failures driving this attempt. |

---

### 4.7 Review Detail

#### `pipeline.review.started`

| Field | Type | Required | Description |
|---|---|---|---|
| `iteration` | integer | Yes | Review iteration number. |
| `files_under_review` | array of string | No | File paths being reviewed, if determinable. |

#### `pipeline.review.verdict`

| Field | Type | Required | Description |
|---|---|---|---|
| `outcome` | string | Yes | One of: `approve`, `request_changes`, `reject`, `restart_planning`. |
| `issue_count` | integer | Yes | Total number of issues found. |
| `critical_count` | integer | Yes | Number of critical/blocking issues. |

#### `pipeline.review.fix_attempt`

| Field | Type | Required | Description |
|---|---|---|---|
| `attempt` | integer | Yes | Fix attempt number (1-based). |
| `limit` | integer | Yes | Maximum fix attempts configured. |
| `critical_issues` | array of string | No | Descriptions of critical issues from the review. |

---

### 4.8 Circuit Breaker

The circuit breaker monitors consecutive failures and halts the pipeline if a threshold is exceeded.

#### `pipeline.circuit_breaker.failure_recorded`

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage where the failure occurred. |
| `error` | string | Yes | Error message. |
| `category` | string | Yes | Error category (e.g. `transient`, `persistent`, `fatal`). |
| `retriable` | boolean | Yes | Whether the error is considered retriable. |
| `consecutive_failures` | integer | Yes | Count of consecutive failures after recording this one. |

#### `pipeline.circuit_breaker.retry`

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage being retried. |
| `attempt` | integer | Yes | Retry attempt number. |
| `delay_seconds` | number | Yes | Seconds to wait before the retry (exponential backoff). |
| `consecutive_failures` | integer | Yes | Current consecutive failure count. |

#### `pipeline.circuit_breaker.tripped`

Emitted just before the pipeline halts due to too many failures.

| Field | Type | Required | Description |
|---|---|---|---|
| `reason` | string | Yes | Human-readable reason for tripping. |
| `consecutive_failures` | integer | Yes | Failure count that triggered the trip. |
| `category` | string | Yes | Error category. |

#### `pipeline.circuit_breaker.reset`

Emitted when a successful stage execution resets the failure counter (only if counter was non-zero).

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage that succeeded. |
| `previous_consecutive_failures` | integer | Yes | Failure count before reset. |

---

### 4.9 Cost & Tokens

#### `pipeline.cost.stage_total`

Emitted after each stage completes with token usage data.

| Field | Type | Required | Description |
|---|---|---|---|
| `stage` | string | Yes | Stage name. |
| `iteration` | integer | Yes | Stage iteration. |
| `cost_usd` | number | Yes | Cost for this stage iteration in USD. |
| `input_tokens` | integer | Yes | Input tokens consumed. |
| `output_tokens` | integer | Yes | Output tokens generated. |
| `model` | string | Yes | Model used for this stage. |

#### `pipeline.cost.running_total`

Emitted after each stage with cumulative run totals.

| Field | Type | Required | Description |
|---|---|---|---|
| `total_cost_usd` | number | Yes | Cumulative cost across all stages so far. |
| `total_input_tokens` | integer | Yes | Cumulative input tokens. |
| `total_output_tokens` | integer | Yes | Cumulative output tokens. |
| `by_stage` | object | No | Per-stage cost breakdown: `{ "PLAN": { "cost_usd": 0.12, ... }, ... }` |
| `by_model` | object | No | Per-model cost breakdown: `{ "claude-opus-4-6": { "cost_usd": 0.30, ... }, ... }` |

#### `pipeline.cost.budget_warning`

Emitted when running cost exceeds the configured budget threshold. Only emitted if `worca.budget.max_cost_usd` is set.

| Field | Type | Required | Description |
|---|---|---|---|
| `total_cost_usd` | number | Yes | Current total cost. |
| `budget_usd` | number | Yes | Configured budget limit. |
| `pct_used` | number | Yes | Percentage of budget used (e.g. `80.5`). |

---

### 4.10 Milestones & Loops

#### `pipeline.milestone.set`

Emitted when a milestone gate is evaluated (e.g. plan approval).

| Field | Type | Required | Description |
|---|---|---|---|
| `milestone` | string | Yes | Milestone name (e.g. `plan_approved`). |
| `value` | boolean \| null | Yes | `true` if approved, `false` if rejected, `null` if awaiting external approval (control webhook). |
| `stage` | string | Yes | Stage that set this milestone. |

#### `pipeline.loop.triggered`

Emitted when the pipeline loops back (test failure → implement, review changes → implement, etc.).

| Field | Type | Required | Description |
|---|---|---|---|
| `loop_key` | string | Yes | Loop identifier (e.g. `implement_test`, `pr_changes`, `restart_planning`). |
| `iteration` | integer | Yes | Current loop iteration. |
| `from_stage` | string | Yes | Stage looping from. |
| `to_stage` | string | Yes | Stage looping to. |
| `trigger` | string | Yes | What caused the loop (e.g. `test_failure`, `review_request_changes`). |

#### `pipeline.loop.exhausted`

Emitted when a loop reaches its configured maximum without completing.

| Field | Type | Required | Description |
|---|---|---|---|
| `loop_key` | string | Yes | Loop identifier. |
| `iteration` | integer | Yes | Final iteration count reached. |
| `limit` | integer | Yes | Configured maximum. |

---

### 4.11 Hook & Governance

These events are emitted from within pipeline hook processes (pre/post tool use, subagent dispatch). They capture governance enforcement actions.

#### `pipeline.hook.blocked`

Emitted when a governance guard blocks a tool call.

| Field | Type | Required | Description |
|---|---|---|---|
| `agent` | string | Yes | Agent that attempted the blocked action (e.g. `implementer`). |
| `tool` | string | Yes | Tool that was blocked (e.g. `Bash`). |
| `reason` | string | Yes | Human-readable reason for blocking. |
| `rule` | string | No | Specific governance rule that triggered the block. |

#### `pipeline.hook.test_gate`

Emitted when the test gate triggers (consecutive pytest failures).

| Field | Type | Required | Description |
|---|---|---|---|
| `agent` | string | Yes | Agent that triggered the gate. |
| `strike` | integer | Yes | Current consecutive failure count (1 or 2). |
| `action` | string | Yes | `warn` (first strike) or `block` (second strike). |
| `command` | string | No | The pytest command that failed. |

#### `pipeline.hook.dispatch_blocked`

Emitted when a subagent dispatch is denied by governance rules.

| Field | Type | Required | Description |
|---|---|---|---|
| `agent` | string | Yes | Agent that attempted the dispatch. |
| `subagent_type` | string | Yes | The subagent type that was blocked. |
| `reason` | string | No | Reason for blocking. |

---

### 4.12 Preflight

#### `pipeline.preflight.completed`

| Field | Type | Required | Description |
|---|---|---|---|
| `checks` | array of object | Yes | Array of check results: `[{ "name": "...", "status": "pass|fail|warn", "message": "..." }]` |
| `all_passed` | boolean | Yes | `true` if all checks passed. |

#### `pipeline.preflight.skipped`

| Field | Type | Required | Description |
|---|---|---|---|
| `reason` | string | Yes | Why preflight was skipped (e.g. `--skip-preflight flag`). |

---

### 4.13 Learn Stage

The learn stage uses the same generic stage lifecycle events as all other stages (see [Section 4.2](#42-stage-lifecycle)), with `stage="learn"` in every payload.

| Event | Meaning |
|---|---|
| `pipeline.stage.started` with `stage="learn"` | Learn stage has begun post-run analysis. |
| `pipeline.stage.completed` with `stage="learn"` | Learnings were saved to `learnings.json`. |
| `pipeline.stage.failed` with `stage="learn"` | Learn stage encountered an error (non-fatal). |

To subscribe to learn stage events specifically, use `"pipeline.stage.*"` and filter client-side on `payload.stage == "learn"`.

---

### 4.14 Control Events (Inbound)

Control events are not outbound events — they are **actions triggered by control webhook responses**. See [Section 5](#5-control-webhooks) for the full control webhook protocol.

| Control Action | Response To | Description |
|---|---|---|
| `control.milestone.approve` | `pipeline.milestone.set` | Approve a milestone gate (e.g. plan approval). |
| `control.milestone.reject` | `pipeline.milestone.set` | Reject a milestone gate, triggering replanning or abort. |
| `control.pipeline.pause` | Any event | Pause the pipeline pending external input. |
| `control.pipeline.resume` | Any event (while paused) | Resume a paused pipeline. |
| `control.pipeline.abort` | Any event | Abort the pipeline gracefully. |

---

## 5. Control Webhooks

### 5.1 Overview

Control webhooks extend the event system from read-only observation to **bidirectional control**. When a webhook is configured with `"control": true`, the pipeline reads the HTTP response body for control commands. This enables:

- **Milestone gates**: Auto-approve or require human approval for plan and PR milestones.
- **Pause/resume**: Pause the pipeline for manual review, then resume.
- **Abort**: Gracefully stop the pipeline from an external system.

### 5.2 Enabling Control Mode

```json
{
  "worca": {
    "webhooks": [
      {
        "url": "https://your-server.example.com/worca-control",
        "enabled": true,
        "secret": "required-for-control-webhooks",
        "events": ["pipeline.milestone.set", "pipeline.stage.completed"],
        "control": true,
        "timeout_ms": 10000
      }
    ]
  }
}
```

**Requirements:**
- `secret` must be non-empty. Control webhooks without a secret are ignored at startup.
- `control: true` causes synchronous delivery at pause points (see Section 5.4).

### 5.3 Response Protocol

Your control endpoint responds with a JSON body. The `control` field is optional — omitting it means "continue":

```json
{
  "control": {
    "action": "approve",
    "reason": "Plan reviewed and approved by team lead"
  }
}
```

| Action | Effect |
|---|---|
| `continue` (or absent) | No action. Pipeline proceeds normally. |
| `approve` | Approve a milestone gate (only for `pipeline.milestone.set` events). |
| `reject` | Reject a milestone gate, triggering replanning or abort. |
| `pause` | Pipeline enters pause state, polling for resume. |
| `resume` | Exit pause state and continue. |
| `abort` | Raise interrupt, pipeline shuts down gracefully with the provided `reason`. |

### 5.4 Which Events Support Control Responses

Control checks happen at **natural pause points** only:

1. After `pipeline.milestone.set` events (plan approval, PR approval)
2. After `pipeline.stage.completed` events
3. After `pipeline.loop.triggered` events

For all other event types, `control` responses are received but the `approve`/`reject` actions are ignored (treated as `continue`). `pause` and `abort` are honored for all events.

### 5.5 Pause/Resume Behavior

When a control response returns `"pause"`:

1. A `pipeline.run.paused` event is emitted (not in the 52-event catalog — it's an implicit state event).
2. The pipeline enters a polling loop, checking for `resume` or `abort` every 30 seconds.
3. Each poll emits a `pipeline.run.paused` heartbeat with `"waiting": true`.
4. On `resume`, the pipeline continues from exactly where it left off.
5. On `abort`, a `PipelineInterrupted` exception is raised.

### 5.6 Failure Handling

If a control webhook endpoint is unreachable, times out, or returns a non-2xx response, the pipeline treats it as `{ "control": { "action": "continue" } }`. The pipeline **never blocks indefinitely** on a control webhook.

### 5.7 Security Requirements

- Control webhooks **must** have a non-empty `secret`. This is enforced at pipeline startup.
- Your endpoint should validate the `X-Worca-Signature` header on every request (see [Section 2.3](#23-authentication-hmac-sha256-signature-verification)).
- Respond within `timeout_ms` (default 10000ms for control, 5000ms for observers). Slow responses are abandoned and treated as `continue`.

---

## 6. Configuration Reference

### 6.1 Settings Schema

Webhooks are configured in `.claude/settings.json` under the `worca` namespace:

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

### 6.2 Field Reference

#### `worca.events` (global event settings)

| Field | Type | Default | Description |
|---|---|---|---|
| `worca.events.enabled` | boolean | `true` | Master switch. When `false`, no events are emitted and no webhooks fire. |
| `worca.events.agent_telemetry` | boolean | `true` | Emit agent telemetry events (`tool_use`, `text`, etc.). Disable to reduce volume. |
| `worca.events.hook_events` | boolean | `true` | Emit hook governance events. Disable if hooks are noisy. |
| `worca.events.rate_limit_ms` | integer | `1000` | Global default rate limit for webhook delivery of high-frequency events. |

#### `worca.webhooks[]` (per-webhook configuration)

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | (required) | HTTPS endpoint URL to POST events to. `http://localhost` allowed for development. |
| `enabled` | boolean | `true` | Per-webhook on/off toggle without removing the config. |
| `secret` | string | `""` | Shared secret for HMAC-SHA256 signing. Empty = no signature header. Required for control webhooks. |
| `events` | array of string | `["*"]` | Glob patterns for event types to deliver (see [Section 6.3](#63-event-filtering-patterns)). |
| `timeout_ms` | integer | `5000` | Per-request timeout. Range: 1000–30000. |
| `max_retries` | integer | `3` | Retry attempts on 5xx/network error. Range: 0–10. |
| `rate_limit_ms` | integer | `1000` | Min ms between deliveries of the same event type. `0` = no throttling. |
| `control` | boolean | `false` | If `true`, pipeline reads control commands from responses. Requires `secret`. |

#### `worca.budget` (cost monitoring)

| Field | Type | Default | Description |
|---|---|---|---|
| `worca.budget.max_cost_usd` | number \| null | `null` | Run cost budget. When set, triggers `pipeline.cost.budget_warning` at threshold. |
| `worca.budget.warning_pct` | integer | `80` | Percentage of budget at which to emit the first warning event. |

### 6.3 Event Filtering Patterns

The `events` array uses glob-style pattern matching (`fnmatch`):

| Pattern | Matches |
|---|---|
| `"*"` | All 50 event types |
| `"pipeline.run.*"` | All 5 pipeline lifecycle events |
| `"pipeline.stage.*"` | All 4 stage lifecycle events |
| `"pipeline.agent.*"` | All 5 agent telemetry events |
| `"pipeline.run.failed"` | Only `pipeline.run.failed` |
| `"pipeline.*.failed"` | `pipeline.run.failed`, `pipeline.stage.failed`, `pipeline.bead.failed` |
| `"pipeline.cost.*"` | All 3 cost events |

Multiple patterns are OR-combined — the event is delivered if it matches **any** pattern.

**Note:** If `events` is omitted or set to an empty array (`[]`), all events are delivered — equivalent to `["*"]`. To suppress all deliveries, set `"enabled": false` instead.

### 6.4 Validation Rules

Enforced at pipeline startup:

- `url` must start with `https://` or `http://localhost`.
- `timeout_ms` must be in range 1000–30000.
- `max_retries` must be in range 0–10.
- `events` patterns must contain only alphanumeric characters, dots, hyphens, underscores, and `*`.
- Control webhooks (`control: true`) must have a non-empty `secret`. Webhooks failing this check are skipped with a startup warning.

---

## 7. Examples

### 7.1 Minimal Observer Webhook

Receive all events with no filtering or authentication:

```json
{
  "worca": {
    "webhooks": [
      {
        "url": "https://my-dashboard.example.com/pipeline-events",
        "enabled": true
      }
    ]
  }
}
```

### 7.2 Filtered Webhook (Failures Only)

Only receive failure-related events for alerting:

```json
{
  "worca": {
    "webhooks": [
      {
        "url": "https://alerts.example.com/worca-failures",
        "enabled": true,
        "secret": "alert-webhook-secret",
        "events": [
          "pipeline.run.failed",
          "pipeline.run.interrupted",
          "pipeline.stage.failed",
          "pipeline.test.suite_failed",
          "pipeline.circuit_breaker.tripped"
        ]
      }
    ]
  }
}
```

### 7.3 Control Webhook (Auto-Approve Plans)

Auto-approve all plan milestones and receive stage completions:

```json
{
  "worca": {
    "webhooks": [
      {
        "url": "https://ci.example.com/worca-control",
        "enabled": true,
        "secret": "control-webhook-secret",
        "events": [
          "pipeline.milestone.set",
          "pipeline.stage.completed"
        ],
        "control": true,
        "timeout_ms": 10000
      }
    ]
  }
}
```

Your endpoint auto-approves plan milestones:

```python
@app.route("/worca-control", methods=["POST"])
def worca_control():
    event = request.get_json()
    if event["event_type"] == "pipeline.milestone.set":
        milestone = event["payload"]["milestone"]
        if milestone == "plan_approved":
            return jsonify({"control": {"action": "approve", "reason": "auto-approved"}})
    return jsonify({})  # continue for all other events
```

### 7.4 Python Flask Receiver

Complete webhook receiver with signature verification:

```python
import hmac
import hashlib
import json
from flask import Flask, request, jsonify, abort

app = Flask(__name__)
WEBHOOK_SECRET = "your-shared-secret"

def verify_signature(payload_bytes: bytes, signature_header: str) -> bool:
    if not signature_header:
        return False
    expected = "sha256=" + hmac.new(
        WEBHOOK_SECRET.encode("utf-8"),
        payload_bytes,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)

@app.route("/worca-events", methods=["POST"])
def receive_event():
    payload_bytes = request.get_data()
    signature = request.headers.get("X-Worca-Signature", "")

    if not verify_signature(payload_bytes, signature):
        abort(401, "Invalid signature")

    event = json.loads(payload_bytes)
    event_type = event["event_type"]
    run_id = event["run_id"]

    print(f"[{run_id}] {event_type}: {event['payload']}")

    # Handle specific event types
    if event_type == "pipeline.run.completed":
        duration_s = event["payload"]["duration_ms"] / 1000
        cost = event["payload"]["total_cost_usd"]
        print(f"Run completed in {duration_s:.1f}s, cost ${cost:.4f}")

    elif event_type == "pipeline.run.failed":
        stage = event["payload"].get("failed_stage", "unknown")
        error = event["payload"]["error"]
        print(f"Run FAILED at {stage}: {error}")
        # Send alert here

    elif event_type == "pipeline.test.suite_failed":
        failures = event["payload"]["failures"]
        for f in failures:
            print(f"  FAIL: {f['test']} — {f['error']}")

    return jsonify({"status": "ok"}), 200

if __name__ == "__main__":
    app.run(port=4567)
```

### 7.5 Node.js Express Receiver

Complete webhook receiver with HMAC-SHA256 verification:

```javascript
const express = require("express");
const crypto = require("crypto");

const app = express();
const WEBHOOK_SECRET = "your-shared-secret";

// Parse raw body for signature verification
app.use(express.raw({ type: "application/json" }));

function verifySignature(payloadBytes, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = "sha256=" + crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(payloadBytes)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signatureHeader)
    );
  } catch {
    return false;
  }
}

app.post("/worca-events", (req, res) => {
  const signature = req.headers["x-worca-signature"] || "";

  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(req.body.toString());
  const { event_type, run_id, payload } = event;

  console.log(`[${run_id}] ${event_type}`);

  switch (event_type) {
    case "pipeline.run.completed":
      console.log(`Run done: ${payload.duration_ms}ms, $${payload.total_cost_usd}`);
      break;

    case "pipeline.run.failed":
      console.error(`Run FAILED at ${payload.failed_stage}: ${payload.error}`);
      // Send alert (Slack, PagerDuty, etc.)
      break;

    case "pipeline.test.suite_failed":
      payload.failures.forEach(f => {
        console.error(`  FAIL: ${f.test} — ${f.error}`);
      });
      break;
  }

  res.json({ status: "ok" });
});

app.listen(4567, () => {
  console.log("Webhook receiver listening on :4567");
});
```

---

## 8. JSON Schema Reference

Formal JSON Schema (Draft 2020-12) definitions are provided for machine-readable validation:

| Schema File | Description |
|---|---|
| [`schemas/envelope.schema.json`](schemas/envelope.schema.json) | Common event envelope (all fields except `payload`) |
| [`schemas/events/pipeline.run.schema.json`](schemas/events/pipeline.run.schema.json) | Pipeline lifecycle events (started, completed, failed, interrupted, resumed) |
| [`schemas/events/pipeline.stage.schema.json`](schemas/events/pipeline.stage.schema.json) | Stage lifecycle events (started, completed, failed, interrupted) |
| [`schemas/events/pipeline.agent.schema.json`](schemas/events/pipeline.agent.schema.json) | Agent telemetry events (spawned, tool_use, tool_result, text, completed) |
| [`schemas/events/pipeline.bead.schema.json`](schemas/events/pipeline.bead.schema.json) | Bead lifecycle events (created, assigned, completed, failed, labeled, next) |
| [`schemas/events/pipeline.git.schema.json`](schemas/events/pipeline.git.schema.json) | Git operation events (branch_created, commit, pr_created, pr_merged) |
| [`schemas/events/pipeline.test.schema.json`](schemas/events/pipeline.test.schema.json) | Test detail events (suite_started, suite_passed, suite_failed, fix_attempt) |
| [`schemas/events/pipeline.review.schema.json`](schemas/events/pipeline.review.schema.json) | Review detail events (started, verdict, fix_attempt) |
| [`schemas/events/pipeline.circuit_breaker.schema.json`](schemas/events/pipeline.circuit_breaker.schema.json) | Circuit breaker events (failure_recorded, retry, tripped, reset) |
| [`schemas/events/pipeline.cost.schema.json`](schemas/events/pipeline.cost.schema.json) | Cost & token events (stage_total, running_total, budget_warning) |
| [`schemas/events/pipeline.milestone.schema.json`](schemas/events/pipeline.milestone.schema.json) | Milestone events (set) |
| [`schemas/events/pipeline.loop.schema.json`](schemas/events/pipeline.loop.schema.json) | Loop events (triggered, exhausted) |
| [`schemas/events/pipeline.hook.schema.json`](schemas/events/pipeline.hook.schema.json) | Hook governance events (blocked, test_gate, dispatch_blocked) |
| [`schemas/events/pipeline.preflight.schema.json`](schemas/events/pipeline.preflight.schema.json) | Preflight events (completed, skipped) |
| [`schemas/control-response.schema.json`](schemas/control-response.schema.json) | Control webhook response format |

### Usage Example (Python, jsonschema library)

```python
import json
import jsonschema
from pathlib import Path

schema_dir = Path("docs/spec/webhooks/schemas")

# Load and validate the envelope
envelope_schema = json.loads((schema_dir / "envelope.schema.json").read_text())
event = json.loads(raw_event_json)
jsonschema.validate(event, envelope_schema)
```

### Compatibility

- All schemas use [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/schema).
- `additionalProperties: false` is used on all envelope schemas.
- Payload schemas allow additional properties to ensure forward compatibility with future fields.
- Consumers should always set `additionalProperties` to `true` in their own validation rules to accept future additive changes.
