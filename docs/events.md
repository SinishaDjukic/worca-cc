# worca Events Reference

Canonical list of all event types worca emits, organized by domain. Use this as a developer reference when adding a webhook subscription, writing a renderer, or extending the integrations layer.

**Source of truth:** `src/worca/events/types.py` (constants + payload builders).
**Emitter:** `src/worca/events/emitter.py` (`emit_event()` builds the envelope and queues delivery).
**Outbound webhook signing:** `src/worca/events/webhook.py` (HMAC-SHA256, `X-Worca-Signature: sha256=<hex>`).
**Inbox / integrations:** `worca-ui/server/webhook-inbox.js`, `worca-ui/server/integrations/*`.

If anything in this doc disagrees with `types.py`, treat `types.py` as authoritative and open an issue. To regenerate this list mechanically: `grep -nE '^[A-Z_]+ *= *"[a-z.]+' src/worca/events/types.py`.

## Envelope

Every event emitted by `emit_event()` is wrapped in this envelope:

```jsonc
{
  "schema_version": 1,
  "event_id": "<uuid>",
  "event_type": "pipeline.run.completed",
  "timestamp": "2026-05-21T14:32:01.123Z",
  "run_id": "<run_id>",
  "pipeline": { /* run context */ },
  "payload": { /* event-specific shape — see below */ }
}
```

Version bumps only on **breaking** envelope changes. Payload field additions are non-breaking.

## Headers (outbound webhook POST)

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `worca-pipeline/1.0` |
| `X-Worca-Event` | the `event_type` string |
| `X-Worca-Delivery` | the `event_id` (UUID) — use this for dedupe |
| `X-Worca-Signature` | `sha256=<hex>` (only when subscriber has a `secret` configured) |

Subscribers should verify the signature with timing-safe compare. See `worca-ui/server/integrations/verify.js` for the canonical Node implementation.

---

## Event types

All event types are dotted strings, prefixed by **domain**: `pipeline.*`, `control.*`, `fleet.*`, `workspace.*`.

### `pipeline.run.*` — pipeline lifecycle

| Type | Constant | Payload builder |
|---|---|---|
| `pipeline.run.started` | `RUN_STARTED` | `run_started_payload(resume, started_at, plan_file?, settings_snapshot?, provenance?)` |
| `pipeline.run.completed` | `RUN_COMPLETED` | `run_completed_payload(duration_ms, total_cost_usd, total_turns, total_tokens, stages_completed)` |
| `pipeline.run.failed` | `RUN_FAILED` | `run_failed_payload(error, failed_stage, error_type, loop_counters?)` |
| `pipeline.run.interrupted` | `RUN_INTERRUPTED` | `run_interrupted_payload(interrupted_stage, elapsed_ms, source)` |
| `pipeline.run.cancelled` | `RUN_CANCELLED` | `run_cancelled_payload(cancelled_stage, elapsed_ms, source, reason?)` |
| `pipeline.run.resumed` | `RUN_RESUMED` | `run_resumed_payload(resume_stage, previous_stages_completed)` |
| `pipeline.run.paused` | `RUN_PAUSED` | `run_paused_payload(...)` |
| `pipeline.run.resumed_from_pause` | `RUN_RESUMED_FROM_PAUSE` | `run_resumed_from_pause_payload(...)` |

#### Provenance block (`pipeline.run.started` payload)

The optional `provenance` field in `pipeline.run.started` identifies the worca runtime that ran the pipeline. It is populated from the manifest written by `worca init` (or `worca init --upgrade`) at `.claude/worca/provenance.json`. Absent before the first `worca init --upgrade` after W-074 ships; subscribers must treat it as optional.

```json
{
  "worca_version": "0.57.0",
  "runtime_source": {
    "source": "git",
    "repo": "worca-cc",
    "commit": "ba1795b8",
    "branch": "main",
    "dirty": false
  }
}
```

`runtime_source.source` is `"git"` (dev checkout), `"pip"` (installed package), or `null` (degraded — version only). No `schema_version` bump required: the field is additive per §2 of this document.

### `pipeline.stage.*` — per-stage lifecycle

| Type | Constant |
|---|---|
| `pipeline.stage.started` | `STAGE_STARTED` |
| `pipeline.stage.completed` | `STAGE_COMPLETED` |
| `pipeline.stage.failed` | `STAGE_FAILED` |
| `pipeline.stage.interrupted` | `STAGE_INTERRUPTED` |

### `pipeline.agent.*` — agent (sub-process) telemetry

High-volume — subscribers should filter these unless you need deep observability.

| Type | Constant |
|---|---|
| `pipeline.agent.spawned` | `AGENT_SPAWNED` |
| `pipeline.agent.tool_use` | `AGENT_TOOL_USE` |
| `pipeline.agent.tool_result` | `AGENT_TOOL_RESULT` |
| `pipeline.agent.text` | `AGENT_TEXT` |
| `pipeline.agent.completed` | `AGENT_COMPLETED` |
| `pipeline.agent.api_retry` | `AGENT_API_RETRY` |

`pipeline.agent.api_retry` (W-074) fires when the Claude CLI logs an API-throttling/backoff diagnostic on stderr (429/529/503, "overloaded", "retrying"). Payload: `stage`, `iteration`, `agent`, `attempt` (running count of matched retry lines this iteration), `detail` (raw stderr text, ≤300 chars), and optional `bead_id`. New event type — **no `schema_version` bump** (additive event types are non-breaking). Not Tier 1: no chat renderer (high-frequency, low signal-per-instance); the per-iteration count is surfaced in run-detail instead.

### `pipeline.iteration.*` — iteration-level analytics

| Type | Constant |
|---|---|
| `pipeline.iteration.access` | `ITERATION_ACCESS` |

### `pipeline.bead.*` — beads tracker integration

| Type | Constant |
|---|---|
| `pipeline.bead.created` | `BEAD_CREATED` |
| `pipeline.bead.assigned` | `BEAD_ASSIGNED` |
| `pipeline.bead.completed` | `BEAD_COMPLETED` |
| `pipeline.bead.failed` | `BEAD_FAILED` |
| `pipeline.bead.labeled` | `BEAD_LABELED` |
| `pipeline.bead.next` | `BEAD_NEXT` |

### `pipeline.git.*` — git operations

| Type | Constant |
|---|---|
| `pipeline.git.branch_created` | `GIT_BRANCH_CREATED` |
| `pipeline.git.commit` | `GIT_COMMIT` |
| `pipeline.git.pr_created` | `GIT_PR_CREATED` |
| `pipeline.git.pr_deferred` | `GIT_PR_DEFERRED` |
| `pipeline.git.pr_merged` | `GIT_PR_MERGED` |

**`pipeline.git.pr_deferred` — PR creation skipped, deferred to operator**

Emitted by the guardian stage when `worca.stages.pr.defer` is `true` (or `WORCA_DEFER_PR=1` is set by the workspace executor). Signals that a PR-ready branch exists but the pipeline intentionally did not open a PR — an operator or UI action is expected to do so. Chat-rendered (Tier 1).

**Payload fields:**

| Field | Type | Description |
|---|---|---|
| `pr_title` | string | Proposed PR title (from the guardian's draft) |
| `base_branch` | string | Target branch the PR would merge into |
| `head_branch` | string | Branch containing the changes |
| `commit_sha` | string? | HEAD commit SHA at the time of deferral |

### `pipeline.test.*` — test loop

| Type | Constant |
|---|---|
| `pipeline.test.suite_started` | `TEST_SUITE_STARTED` |
| `pipeline.test.suite_passed` | `TEST_SUITE_PASSED` |
| `pipeline.test.suite_failed` | `TEST_SUITE_FAILED` |
| `pipeline.test.fix_attempt` | `TEST_FIX_ATTEMPT` |

### `pipeline.review.*` — code review loop

| Type | Constant |
|---|---|
| `pipeline.review.started` | `REVIEW_STARTED` |
| `pipeline.review.verdict` | `REVIEW_VERDICT` |
| `pipeline.review.fix_attempt` | `REVIEW_FIX_ATTEMPT` |

### `pipeline.circuit_breaker.*` — error classification

| Type | Constant |
|---|---|
| `pipeline.circuit_breaker.failure_recorded` | `CB_FAILURE_RECORDED` |
| `pipeline.circuit_breaker.retry` | `CB_RETRY` |
| `pipeline.circuit_breaker.tripped` | `CB_TRIPPED` |
| `pipeline.circuit_breaker.reset` | `CB_RESET` |

### `pipeline.cost.*` — token + cost telemetry

| Type | Constant |
|---|---|
| `pipeline.cost.stage_total` | `COST_STAGE_TOTAL` |
| `pipeline.cost.running_total` | `COST_RUNNING_TOTAL` |
| `pipeline.cost.budget_warning` | `COST_BUDGET_WARNING` |

### `pipeline.milestone.*`, `pipeline.loop.*` — control plane

| Type | Constant |
|---|---|
| `pipeline.milestone.set` | `MILESTONE_SET` |
| `pipeline.loop.triggered` | `LOOP_TRIGGERED` |
| `pipeline.loop.exhausted` | `LOOP_EXHAUSTED` |

### `pipeline.hook.*` — governance hook telemetry

| Type | Constant |
|---|---|
| `pipeline.hook.blocked` | `HOOK_BLOCKED` |
| `pipeline.hook.test_gate` | `HOOK_TEST_GATE` |
| `pipeline.hook.dispatch_blocked` | `HOOK_DISPATCH_BLOCKED` |
| `pipeline.hook.dispatch_allowed` | `HOOK_DISPATCH_ALLOWED` |
| `pipeline.hook.graph_query` | `HOOK_GRAPH_QUERY` |

`pipeline.hook.graph_query` is emitted live by the `post_tool_use` hook on every knowledge-graph query (graphify CLI read or CRG MCP tool); payload `{engine, op, agent?}`. The UI server (`graph-query-aggregator.js`) folds these into live `graphify_invocations` / `crg_invocations` / `crg_tool_counts` for the still-running iteration so the graphify/CRG badges update during the run, mirroring how `dispatch_{allowed,blocked}` feed the skills/subagents badges. The runner's completion-time tally remains authoritative. Like the dispatch events, it is high-frequency telemetry and is **not** chat-notifiable (no Tier 1 renderer).

### `pipeline.plan_review.*` — plan review detail

| Type | Constant | Payload builder |
|---|---|---|
| `pipeline.plan_review.edited` | `PLAN_EDITED` | `plan_edited_payload(stage, mode, mode_reason, issue_counts, original_plan_path?)` |

Emitted when the plan reviewer edits the plan in `review_and_edit` mode (W-059). Not chat-rendered (Tier 2 — webhook/notification only, no renderer entry).

**Payload fields:**

| Field | Type | Description |
|---|---|---|
| `stage` | string | Stage key (`"plan_review"`) |
| `mode` | string | Resolved mode (`"review_and_edit"`) |
| `mode_reason` | string | Why this mode was selected (e.g. `"from template/pipeline"`, `"forced by project"`) |
| `issue_counts` | object | Issue counts by severity: `{ "critical": N, "major": N, "minor": N, "suggestion": N }` |
| `original_plan_path` | string? | Path to the preserved original plan file (for future diff UI) |

### `pipeline.claude_md.*` — CLAUDE.md load mode

| Type | Constant | Payload builder |
|---|---|---|
| `pipeline.claude_md.mode_resolved` | `CLAUDE_MD_MODE_RESOLVED` | `claude_md_mode_resolved_payload(mode, source, overlay_path, exclude_count)` |

Emitted once per run right after the CLAUDE.md overlay is materialized (Phase 2 of run startup). **Tier 2** — pipeline-internal mechanics; not chat-rendered. Useful for webhook subscribers auditing hermetic-run behaviour.

**Payload fields:**

| Field | Type | Description |
|---|---|---|
| `mode` | string | Resolved mode: `"none"` \| `"project"` \| `"project+local"` \| `"all"` |
| `source` | string | Where the mode came from: `"cli"` \| `"template"` \| `"project_settings"` \| `"default"` |
| `overlay_path` | string \| null | Absolute path to the written overlay JSON, or `null` when mode is `"all"` or `"none"` (no `claudeMdExcludes` needed) |
| `exclude_count` | integer | Number of `claudeMdExcludes` entries written (0 for `"all"` and `"none"`) |

### `pipeline.preflight.*`, `pipeline.learn.*`

| Type | Constant |
|---|---|
| `pipeline.preflight.completed` | `PREFLIGHT_COMPLETED` |
| `pipeline.preflight.skipped` | `PREFLIGHT_SKIPPED` |
| `pipeline.learn.completed` | `LEARN_COMPLETED` |
| `pipeline.learn.failed` | `LEARN_FAILED` |

### `control.*` — incoming control signals

These are inbound to worca (typically posted to the inbox or returned in a control-webhook response). External systems use these to pause/resume/abort runs.

| Type | Constant |
|---|---|
| `control.milestone.approve` | `CONTROL_MILESTONE_APPROVE` |
| `control.pipeline.pause` | `CONTROL_PIPELINE_PAUSE` |
| `control.pipeline.resume` | `CONTROL_PIPELINE_RESUME` |
| `control.pipeline.abort` | `CONTROL_PIPELINE_ABORT` |

### `fleet.*` — fleet runs (fan-out across N projects)

| Type | Constant |
|---|---|
| `fleet.launched` | `FLEET_LAUNCHED` |
| `fleet.halted` | `FLEET_HALTED` |
| `fleet.completed` | `FLEET_COMPLETED` |
| `fleet.failed` | `FLEET_FAILED` |
| `fleet.circuit_breaker.tripped` | `FLEET_CIRCUIT_BREAKER_TRIPPED` |

### `workspace.*` — workspace runs (DAG across interdependent projects)

| Type | Constant |
|---|---|
| `workspace.launched` | `WORKSPACE_LAUNCHED` |
| `workspace.completed` | `WORKSPACE_COMPLETED` |
| `workspace.failed` | `WORKSPACE_FAILED` |
| `workspace.halted` | `WORKSPACE_HALTED` |
| `workspace.paused` | `WORKSPACE_PAUSED` |
| `workspace.resumed` | `WORKSPACE_RESUMED` |
| `workspace.plan.started` | `WORKSPACE_PLAN_STARTED` |
| `workspace.plan.completed` | `WORKSPACE_PLAN_COMPLETED` |
| `workspace.plan.failed` | `WORKSPACE_PLAN_FAILED` |
| `workspace.plan.loaded` | `WORKSPACE_PLAN_LOADED` |
| `workspace.plan.partial` | `WORKSPACE_PLAN_PARTIAL` |
| `workspace.tier.started` | `WORKSPACE_TIER_STARTED` |
| `workspace.tier.completed` | `WORKSPACE_TIER_COMPLETED` |
| `workspace.tier.failed` | `WORKSPACE_TIER_FAILED` |
| `workspace.project.skipped` | `WORKSPACE_PROJECT_SKIPPED` |
| `workspace.integration_test.started` | `WORKSPACE_INTEGRATION_STARTED` |
| `workspace.integration_test.passed` | `WORKSPACE_INTEGRATION_PASSED` |
| `workspace.integration_test.failed` | `WORKSPACE_INTEGRATION_FAILED` |
| `workspace.umbrella_issue.created` | `WORKSPACE_UMBRELLA_ISSUE_CREATED` |
| `workspace.circuit_breaker.tripped` | `WORKSPACE_CIRCUIT_BREAKER_TRIPPED` |
| `workspace.guide_conflict` | `GUIDE_CONFLICT` |

---

## Chat-rendered (Tier 1) subset

The integrations layer (`worca-ui/server/integrations/`) renders a curated subset of event types into chat messages (Telegram, Discord, Slack, generic webhook). The current Tier 1 set is defined in `worca-ui/server/integrations/renderers.js` — search the file for the mapped event-type strings.

Today's Tier 1 typically includes:
- `pipeline.run.completed`, `pipeline.run.failed`, `pipeline.run.interrupted`
- `pipeline.git.pr_created`, `pipeline.git.pr_deferred`, `pipeline.git.pr_merged`
- `pipeline.circuit_breaker.tripped`
- `pipeline.cost.budget_warning`

When adding a new event that should be chat-notifiable, **add a renderer entry** in the same file. Without it, the event will fire but no chat message will be sent. The `worca-event-payload-reviewer` subagent catches this drift.

## Adding a new event

Use the `/worca-event-add` skill. It scaffolds the constant, the payload builder, the test, and (if Tier 1) the renderer stub in one pass.

After adding, run `worca-event-payload-reviewer` to audit.

## Subscriber config (webhooks)

User-facing webhook subscriptions live in `settings.json` under `worca.webhooks`:

```jsonc
"worca": {
  "webhooks": [
    {
      "url": "https://example.com/hook",
      "secret": "base64-encoded-secret",
      "timeout_ms": 5000,
      "max_retries": 3,
      "events": ["pipeline.run.completed", "pipeline.run.failed"]
    }
  ]
}
```

`events` accepts fnmatch patterns (`pipeline.run.*`, `workspace.*`). Omit or `null` to receive everything.

For **control webhooks** (the subscriber can pause/abort the run via its response), set `"control": true` AND `"secret": "..."` (required for control mode). The pipeline calls these synchronously at milestones and reads `{ control: { action: "pause" | "abort" | "continue" } }` from the response body.

## Integrations config (chat adapters)

`~/.worca/integrations/config.json`:

```jsonc
{
  "schema_version": 1,
  "enabled": true,
  "webhook_secret_env": "WORCA_WEBHOOK_SECRET",
  "adapters": {
    "telegram": {
      "enabled": true,
      "bot_token_env": "TELEGRAM_BOT_TOKEN",
      "chat_id": "123456789",
      "rate_limit_per_min": 20,
      "events": ["pipeline.run.completed", "pipeline.run.failed", "pipeline.git.pr_merged"]
    }
    /* discord, slack, webhook_out follow the same shape */
  }
}
```

Secrets MUST be in env vars referenced by name (`*_env` keys), never inline. The config validator (`integrations-config-validator.test.js`) enforces this.

## Testing locally

Use the `/worca-webhook-test` skill to sign and POST a synthetic event to your configured webhook URL without running a full pipeline.
