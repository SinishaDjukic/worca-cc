# worca — Feature Ideas & Roadmap

> **Date:** 2026-03-09
> **Scope:** worca-cc (orchestration engine) + worca-ui (dashboard)

---

## 0. Completed

### W-000: Settings REST API

**Status:** Done

**Problem:** The Settings UI (4 tabs: agents, pipeline, governance, preferences) can render configuration but has no backend endpoints to load and save it.

**Proposal:** Add `/api/settings` GET and POST Express routes backed by `readFullSettings()` and `writeSettings()` in `settings-reader.js`.

**Plans:** [settings-page.md](plans/2026-03-09-settings-page.md), [pipeline-stage-editor.md](plans/2026-03-09-pipeline-stage-editor.md)

### W-009: Pipeline Control Actions

**Status:** Done

**Problem:** The UI is read-only. Users must use the CLI to start, stop, or manage pipeline runs.

**Proposal:** Add control actions to the UI:
- **Start Run:** Form with prompt input, work request type selector, and optional settings overrides
- **Stop Run:** Cancel button on active runs (sends SIGTERM to pipeline process)
- **Restart Stage:** Re-run a failed stage without restarting the entire pipeline

**Plan:** [W-009-pipeline-control-actions.md](plans/W-009-pipeline-control-actions.md)

---

## 1. worca-cc — Orchestration Engine

### W-001: Pipeline Resume & Checkpointing

**Problem:** If a pipeline run crashes, gets interrupted, or the machine restarts, all progress is lost. The user must re-run from scratch.

**Proposal:** Save stage outputs as checkpoint files in `.worca/checkpoints/{run_id}/`. Each completed stage writes its output (plan, task list, code diff, test results) to a checkpoint. Add `run_pipeline.py --resume <run_id>` to pick up from the last successful stage.

**Considerations:**
- Checkpoint format: JSON with stage name, output artifacts, and timestamp
- Need to handle stale worktrees and branches from interrupted runs
- Should validate that the codebase hasn't diverged since the checkpoint

---

### W-002: Parallel Implementer Execution

**Problem:** When the coordinator creates independent tasks, they execute sequentially through a single implementer. This wastes time when tasks have no dependencies.

**Proposal:** The coordinator marks tasks as parallelizable. The runner spawns multiple implementer agents in separate worktrees, each working on an independent task. Results are merged before the test stage.

**Considerations:**
- Test infrastructure exists (`test_run_parallel.py`) — build on it
- Merge conflicts between parallel worktrees need a resolution strategy
- Resource limits: cap concurrent agents (configurable in settings)
- Each implementer needs its own log stream (UI must support multiple concurrent logs)

---

### W-003: Pipeline Events & Webhooks

**Problem:** No way for external systems to react to pipeline events. Users must watch the UI or terminal.

**Proposal:** Emit structured events at key moments:
- `stage.started`, `stage.completed`, `stage.failed`
- `approval.needed` (plan or PR gate)
- `run.completed`, `run.failed`
- `test.failed` (with failure details)

Events are written to `.worca/events/{run_id}.jsonl` and optionally POSTed to configured webhook URLs.

**Considerations:**
- Webhook config in settings.json under `worca.webhooks`
- Retry logic for failed webhook delivery
- Event schema should be stable — consumers depend on it
- Natural foundation for Slack/email/Teams integrations

---

### W-004: Work Request Queue

**Problem:** Pipeline accepts one work request at a time. To process multiple issues, the user must invoke the pipeline repeatedly and wait.

**Proposal:** Add a queue that accepts multiple work requests. The pipeline processes them sequentially (or in parallel when resources allow). Supports priority ordering.

```bash
run_pipeline.py --queue issue-42 issue-55 "Add logging"
run_pipeline.py --from-beads  # pull all bd ready issues
```

**Considerations:**
- Queue persistence: write to `.worca/queue.json`
- Priority: beads priority field or explicit `--priority` flag
- Failure handling: skip failed items and continue, or halt
- UI integration: show queue status in dashboard

---

### W-005: Agent Memory & Context Sharing

**Problem:** Each agent starts with limited context about what previous agents decided. The implementer may not know why the planner chose a particular architecture. Test failures lose context when looping back.

**Proposal:** Create a shared context file (`.worca/context/{run_id}.md`) that accumulates decisions, rationale, and key artifacts across stages. Each agent reads it on start and appends to it on completion.

**Considerations:**
- Keep it concise — agents have context limits
- Structure: decisions, constraints, open questions, artifacts
- On loop-back (test → implement), include failure context automatically

---

### W-006: Cost & Token Tracking

**Status:** Done — [PR #1](https://github.com/SinishaDjukic/worca-cc/pull/1)

**Problem:** No visibility into how many tokens each agent/stage/run consumes. Opus stages are expensive; without data, optimization is guesswork.

**Proposal:** Track token usage per agent invocation. Claude CLI can report usage — capture it and write to `.worca/results/{run_id}.json` alongside existing run data.

**Metrics:**
- Input/output tokens per stage
- Total cost per run (using published pricing)
- Cumulative cost across all runs
- Cost trends over time

**Considerations:**
- Parse Claude CLI output or use `--usage` flag if available
- Store in run results JSON for UI consumption
- Privacy: no prompt content, only counts

---

### W-007: Dry Run Mode

**Problem:** No way to validate a pipeline configuration without executing it. Changing stages, governance rules, or agent models could break the pipeline.

**Proposal:** `run_pipeline.py --dry-run` validates the full configuration:
- All referenced agents exist and have valid prompts
- Stage transitions are valid
- Governance rules parse correctly
- Loop limits are sensible
- Required tools/hooks are present

**Considerations:**
- Fast feedback: should complete in seconds
- Output a validation report with warnings and errors
- Could also preview the work request normalization

---

### W-008: Configurable Agent Prompts

**Problem:** Agent prompt files (`.claude/agents/core/*.md`) are static. Different target projects may need different agent behavior (e.g., "always use TypeScript", "follow our commit conventions").

**Proposal:** Support per-project prompt overlays. A target project can place overrides in `.claude/agents/overrides/` that are appended to or replace sections of the core prompts.

**Considerations:**
- Overlay format: markdown with section markers (`## Override: Testing`)
- Merge strategy: append by default, replace if `<!-- replace -->` marker
- Don't break governance — overlays cannot disable safety hooks

---

## 2. worca-ui — Dashboard

### W-010: Approval Gate UI

**Problem:** When the pipeline hits an approval gate (plan or PR), the user must respond in the terminal. If they're watching the UI, they see the pipeline stalled but can't act.

**Proposal:** Show an approval dialog in the UI when a gate is reached:
- **Plan Approval:** Display the generated plan with a diff view. Approve, reject, or request changes.
- **PR Approval:** Show the PR diff, test results, and guardian review. Approve to merge or reject with comments.

**Considerations:**
- Needs bidirectional communication: UI → pipeline process
- Approval state stored in `.worca/approvals/{run_id}.json`
- Pipeline polls or watches for approval file
- Timeout: auto-reject after configurable duration?

---

### W-011: Beads Integration Panel

**Status:** Done

**Problem:** Beads issues (the task management layer) are invisible in the UI. Users must use the CLI to browse and select work.

**Proposal:** Add a Beads panel:
- **Sidebar section:** Show count of ready issues
- **Beads view:** List all open issues with status, priority, and dependencies
- **Quick actions:** Start a pipeline run from a beads issue, mark issues as in-progress
- **Dependency graph:** Visual representation of issue dependencies
- **Bidirectional linking:** Coordinator tags beads with `--labels "run:{run_id}"`, run detail page shows linked issues

**Considerations:**
- Requires `bd` CLI calls from the server (or direct SQLite reads from `.beads/beads.db`)
- Real-time updates: watch `.beads/beads.db` for changes
- Should respect beads dependency rules (can't start blocked issues)

---

### W-012: Log Search & Filtering

**Problem:** Current log viewer has basic stage filtering. For long runs, finding specific errors or events is tedious.

**Proposal:** Enhanced log capabilities:
- **Log level filtering:** Show only errors, warnings, or info
- **Time range selection:** Jump to a specific time window
- **Regex search:** Search across all log lines with regex support
- **Log export:** Download filtered logs as a text file
- **Bookmarks:** Mark important log lines for quick reference

**Considerations:**
- xterm.js search addon is already integrated — extend it
- Server-side filtering for large log files (don't send everything to client)
- Preserve color coding and stage tags in exports

---

### W-013: Run Comparison View

**Problem:** When debugging pipeline issues, users often want to compare a failed run with a previous successful one. Currently this requires opening two browser tabs and manually scrolling.

**Proposal:** Side-by-side run comparison:
- Select two runs to compare
- Show stage-by-stage diff (timing, status, outputs)
- Highlight where they diverged
- Compare log sections

**Considerations:**
- UI layout: split pane with synchronized scrolling
- Data: pull from `.worca/results/{run_id}.json` for both runs
- Most useful for: failed vs. successful, before vs. after config change

---

### W-014: Browser Notifications

**Problem:** Pipeline runs can take minutes to hours. Users switch to other work and miss completions, failures, or approval gates.

**Proposal:** Browser push notifications for key events:
- Run completed (success or failure)
- Approval gate reached
- Test failures detected
- Stage loop limit approaching

**Considerations:**
- Use Web Notifications API (requires user permission)
- Notification preferences in settings (which events to notify on)
- Sound option for critical events (approval needed)
- Works only when browser tab is open (not a PWA — keep it simple)

---

### W-015: Token & Cost Dashboard

**Status:** Done

**Problem:** Even if worca-cc tracks token usage (W-006), there's no way to visualize it.

**Proposal:** Add a cost analytics view:
- **Per-run breakdown:** Bar chart showing tokens by stage
- **Cumulative cost:** Running total across all runs
- **Trends:** Cost over time, average cost per run type
- **Optimization hints:** Flag stages that consume disproportionate tokens

**Considerations:**
- Depends on cost tracking in worca-cc (W-006)
- Chart library: lightweight (e.g., Chart.js or just SVG)
- Store aggregated data for fast loading

---

### W-016: Pipeline Templates

**Problem:** Users configure the pipeline from scratch each time. Common patterns (bugfix, feature, refactor) share similar configurations.

**Proposal:** Pre-built pipeline templates selectable from the UI:
- **Bugfix:** Skip planner, minimal coordination, focus on test
- **Feature:** Full pipeline with plan approval
- **Refactor:** Skip PR, add extra test iterations
- **Quick Fix:** Implementer only, no guardian review

**Considerations:**
- Templates stored as JSON presets in `.claude/templates/`
- UI: template picker when starting a new run
- Allow "Save current config as template"

---

### W-017: Multi-Project Support

**Problem:** Each worca-ui instance monitors a single project. Developers working across multiple repos must run separate servers.

**Proposal:** Single worca-ui instance that monitors multiple project directories:
- Project switcher in sidebar
- Aggregated dashboard across all projects
- Per-project settings

**Considerations:**
- Server watches multiple `.worca/` directories
- Routing: `/#/project/{name}/active/...`
- Config: list of project paths in `~/.worca/projects.json`

---

### W-018: Run Annotations

**Problem:** Historical runs have no user-provided context. "Run abc123" tells you nothing about what it was for.

**Proposal:** Let users add notes and tags to runs:
- **Tags:** "auth", "refactor", "hotfix" — filterable in run list
- **Notes:** Free-text annotations ("This was the auth migration, rolled back due to flaky tests")
- **Pinning:** Pin important runs to the top of history

**Considerations:**
- Store in `.worca/annotations/{run_id}.json`
- Searchable in the run list view
- Auto-tag from work request type (beads issue title, prompt keywords)

---

### W-019: Beads-by-Run with Kanban Visualization

**Status:** Done

**Problem:** The beads page shows all open issues globally with no way to filter by pipeline run. Users can't see which beads were created for a specific run or their completion status. Historical context is lost.

**Proposal:** Enhance the beads page with a run selector dropdown. When a run is selected, display its beads (all statuses) as a kanban board with three columns: Open | In Progress | Closed. Dependency arrows connect cards across columns. Unlinked beads (no `run:` label) shown via a separate "Unlinked Issues" filter option.

**Considerations:**
- Uses labels table for run linking (`run:{run_id}` label, migrated from `external_ref` in `e4df651`)
- Kanban shown only for run-filtered view; "All" and "Unlinked" keep existing list + DAG graph
- Server queries labels table: unlinked issues and distinct run labels for run selector population
- SVG overlay for dependency arrows between kanban cards

**Plan:** [W-019-beads-by-run-kanban.md](plans/W-019-beads-by-run-kanban.md)

---

### W-020: Show Latest Iteration Tab on Stage Expand

**Status:** Done

**Problem:** When a stage section is expanded, the tab group always defaults to showing the first iteration tab (Iter 1) instead of the latest one. User tab selections are lost on re-render.

**Proposal:** Track per-stage tab selections in a module-level Map. On expand, default to the latest iteration tab. If the user manually switches tabs, remember that choice for subsequent expansions.

**Plan:** [W-020-latest-iteration-tab-on-expand.md](plans/W-020-latest-iteration-tab-on-expand.md)

---

### W-021: Sticky Header for Content Pages

**Status:** Done

**Problem:** On Running, History, Beads, and Costs pages, the content header scrolls away with the content, losing access to navigation and action buttons.

**Proposal:** Make `.content-header` sticky (`position: sticky; top: 0`) within `.main-content`. Add a scroll shadow effect to indicate scrolled state.

**Plan:** [W-021-sticky-header-v2.md](plans/W-021-sticky-header-v2.md)

### W-022: API Duration & Turn Metrics in Pipeline UI

**Status:** Open

**Problem:** The pipeline detail page shows cost per stage and iteration but lacks API duration and turn count metrics. `duration_api_ms` (time spent in LLM API calls vs tool execution) is available from the SDK but not stored. Turn counts are stored per iteration but not surfaced as stage/pipeline totals.

**Proposal:**
1. **Store `duration_api_ms`** — capture from the SDK result and persist alongside existing `duration_ms` per iteration
2. **Pipeline header** — show "Total API Duration" and "Total Turns" next to existing "Pipeline Cost"
3. **Stage panels** — show aggregated API duration and turn count in the stage header meta strip (alongside existing cost and wall-clock duration)
4. **Iteration detail** — show "API Duration" per iteration (alongside existing "Iteration Duration")

**Considerations:**
- `duration_api_ms` measures only LLM round-trip time; `duration_ms - duration_api_ms` = tool execution time — useful for identifying bottlenecks
- Turn counts per stage help gauge agent efficiency (fewer turns = better prompting)
- Requires changes to both worca-cc (capture & store) and worca-ui (display)

---

## Appendix A: Prioritized Feature Table

| ID | Priority | Feature | Area | Status | Plan |
|----|----------|---------|------|--------|------|
| W-000 | P0 | Settings REST API | ui | [x] Done | [W-000-settings-rest-api.md](plans/W-000-settings-rest-api.md) |
| W-009 | P1 | Pipeline Control Actions | ui | [x] Done | [W-009-pipeline-control-actions.md](plans/W-009-pipeline-control-actions.md) |
| W-010 | P1 | Approval Gate UI | ui | [ ] | [W-010-approval-gate-ui.md](plans/W-010-approval-gate-ui.md) |
| W-001 | P1 | Pipeline Resume & Checkpointing | cc | [ ] | [W-001-pipeline-resume-checkpointing.md](plans/W-001-pipeline-resume-checkpointing.md) |
| W-011 | P1 | Beads Integration Panel | ui | [x] Done | [W-011-beads-integration-panel.md](plans/W-011-beads-integration-panel.md) |
| W-002 | P2 | Parallel Implementer Execution | cc | [ ] | [W-002-parallel-implementer-execution.md](plans/W-002-parallel-implementer-execution.md) |
| W-005 | P2 | Agent Memory & Context Sharing | cc | [ ] | [W-005-agent-memory-context-sharing.md](plans/W-005-agent-memory-context-sharing.md) |
| W-006 | P2 | Cost & Token Tracking | cc | [x] Done | [W-006-cost-token-tracking.md](plans/W-006-cost-token-tracking.md) |
| W-015 | P2 | Token & Cost Dashboard | ui | [x] Done | [W-015-token-cost-dashboard.md](plans/W-015-token-cost-dashboard.md) |
| W-014 | P2 | Browser Notifications | ui | [x] Done | [W-014-browser-notifications.md](plans/W-014-browser-notifications.md) |
| W-003 | P2 | Pipeline Events & Webhooks | cc | [ ] | [W-003-pipeline-events-webhooks.md](plans/W-003-pipeline-events-webhooks.md) |
| W-004 | P3 | Work Request Queue | cc | [ ] | [W-004-work-request-queue.md](plans/W-004-work-request-queue.md) |
| W-012 | P3 | Log Search & Filtering | ui | [ ] | [W-012-log-search-filtering.md](plans/W-012-log-search-filtering.md) |
| W-013 | P3 | Run Comparison View | ui | [ ] | [W-013-run-comparison-view.md](plans/W-013-run-comparison-view.md) |
| W-007 | P3 | Dry Run Mode | cc | [ ] | [W-007-dry-run-mode.md](plans/W-007-dry-run-mode.md) |
| W-008 | P3 | Configurable Agent Prompts | cc | [ ] | [W-008-configurable-agent-prompts.md](plans/W-008-configurable-agent-prompts.md) |
| W-016 | P4 | Pipeline Templates | ui | [ ] | [W-016-pipeline-templates.md](plans/W-016-pipeline-templates.md) |
| W-017 | P4 | Multi-Project Support | ui | [ ] | [W-017-multi-project-support.md](plans/W-017-multi-project-support.md) |
| W-018 | P4 | Run Annotations | ui | [ ] | [W-018-run-annotations.md](plans/W-018-run-annotations.md) |
| W-019 | P2 | Beads-by-Run Kanban | ui | [x] Done | [W-019-beads-by-run-kanban.md](plans/W-019-beads-by-run-kanban.md) |
| W-020 | P2 | Latest Iteration Tab on Expand | ui | [x] Done | [W-020-latest-iteration-tab-on-expand.md](plans/W-020-latest-iteration-tab-on-expand.md) |
| W-021 | P2 | Sticky Header for Content Pages | ui | [x] Done | [W-021-sticky-header-v2.md](plans/W-021-sticky-header-v2.md) |
| W-022 | P2 | API Duration & Turn Metrics | cc+ui | [ ] | [W-022-api-duration-turn-metrics.md](plans/W-022-api-duration-turn-metrics.md) |

**Legend:**
- **ID:** Unique identifier (`W-` prefix). Use to reference ideas in plans, beads, and commits.
- **Area:** `cc` = worca-cc (orchestration engine), `ui` = worca-ui (dashboard)
- **Status:** `[x]` = in progress or done, `[ ]` = not started
- **Plan:** link to existing design/plan document, `—` = no plan yet

## Appendix B: Plan Files

| File | Covers |
|------|--------|
| [W-000-settings-rest-api.md](plans/W-000-settings-rest-api.md) | W-000: Settings REST API (consolidated) |
| [W-001-pipeline-resume-checkpointing.md](plans/W-001-pipeline-resume-checkpointing.md) | W-001: Pipeline Resume & Checkpointing |
| [W-002-parallel-implementer-execution.md](plans/W-002-parallel-implementer-execution.md) | W-002: Parallel Implementer Execution |
| [W-003-pipeline-events-webhooks.md](plans/W-003-pipeline-events-webhooks.md) | W-003: Pipeline Events & Webhooks |
| [W-004-work-request-queue.md](plans/W-004-work-request-queue.md) | W-004: Work Request Queue |
| [W-005-agent-memory-context-sharing.md](plans/W-005-agent-memory-context-sharing.md) | W-005: Agent Memory & Context Sharing |
| [W-006-cost-token-tracking.md](plans/W-006-cost-token-tracking.md) | W-006: Cost & Token Tracking |
| [W-007-dry-run-mode.md](plans/W-007-dry-run-mode.md) | W-007: Dry Run Mode |
| [W-008-configurable-agent-prompts.md](plans/W-008-configurable-agent-prompts.md) | W-008: Configurable Agent Prompts |
| [W-009-pipeline-control-actions.md](plans/W-009-pipeline-control-actions.md) | W-009: Pipeline Control Actions |
| [W-010-approval-gate-ui.md](plans/W-010-approval-gate-ui.md) | W-010: Approval Gate UI |
| [W-011-beads-integration-panel.md](plans/W-011-beads-integration-panel.md) | W-011: Beads Integration Panel |
| [W-012-log-search-filtering.md](plans/W-012-log-search-filtering.md) | W-012: Log Search & Filtering |
| [W-013-run-comparison-view.md](plans/W-013-run-comparison-view.md) | W-013: Run Comparison View |
| [W-014-browser-notifications.md](plans/W-014-browser-notifications.md) | W-014: Browser Notifications |
| [W-015-token-cost-dashboard.md](plans/W-015-token-cost-dashboard.md) | W-015: Token & Cost Dashboard |
| [W-016-pipeline-templates.md](plans/W-016-pipeline-templates.md) | W-016: Pipeline Templates |
| [W-017-multi-project-support.md](plans/W-017-multi-project-support.md) | W-017: Multi-Project Support |
| [W-018-run-annotations.md](plans/W-018-run-annotations.md) | W-018: Run Annotations |
| [W-019-beads-by-run-kanban.md](plans/W-019-beads-by-run-kanban.md) | W-019: Beads-by-Run Kanban |
| [W-020-latest-iteration-tab-on-expand.md](plans/W-020-latest-iteration-tab-on-expand.md) | W-020: Show Latest Iteration Tab on Stage Expand |
| [W-021-sticky-header-v1.md](plans/W-021-sticky-header-v1.md) | W-021: Sticky Header (initial plan) |
| [W-021-sticky-header-v2.md](plans/W-021-sticky-header-v2.md) | W-021: Sticky Header (revised plan) |
| [W-022-api-duration-turn-metrics.md](plans/W-022-api-duration-turn-metrics.md) | W-022: API Duration & Turn Metrics |
| [worca-ui-design.md](plans/2026-03-08-worca-ui-design.md) | Original UI architecture and design spec |
| [worca-ui-plan.md](plans/2026-03-08-worca-ui-plan.md) | UI implementation plan (initial build) |
| [worca-ui-modernize-design.md](plans/2026-03-08-worca-ui-modernize-design.md) | Shoelace + xterm.js modernization |
| [worca-ui-e2e-server-tests.md](plans/2026-03-08-worca-ui-e2e-server-tests.md) | Server integration tests |
| [settings-page-design.md](plans/2026-03-09-settings-page-design.md) | Settings page design (4 tabs) |
| [settings-page.md](plans/2026-03-09-settings-page.md) | Settings page implementation plan |
| [pipeline-stage-editor-design.md](plans/2026-03-09-pipeline-stage-editor-design.md) | Stage editor design |
| [pipeline-stage-editor.md](plans/2026-03-09-pipeline-stage-editor.md) | Stage editor implementation plan |
