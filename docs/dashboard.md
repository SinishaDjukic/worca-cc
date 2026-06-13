# Dashboard (worca-ui)

A real-time web dashboard for monitoring and controlling the pipeline. All updates stream via WebSocket — no polling, no page refreshes.

```bash
worca-ui                                  # Monitor all projects (default, port 3400)
worca-ui --project /path                  # Monitor single project
worca-ui --help                           # Show all commands and options
```

## Pipeline Detail

Stage pipeline with iteration counts, costs, duration, and a timing bar showing Thinking vs Tools breakdown. Expand any stage to drill into per-iteration metrics. Pause, resume, and stop controls in the header.

![Pipeline detail — stage pipeline with costs, turns, and timing bar](screenshots/run-detail-stages.png)

Expand a stage to see individual iterations — each shows agent, turns, cost, duration, and outcome. The log viewer streams real-time agent output with per-stage filtering.

Each iteration row also shows a **Zap effort badge** (the level the coordinator assigned — low / medium / high / max), and per-iteration dispatch renders as separate **Tools / Skills / Subagents** rows with allow (green) / deny (red) badges, plus a **Lockdown** chip when an agent's dispatch is set to `none`. Agent prompts, guides, context artifacts, and bead tooltips render as sanitized markdown, and the expanded **Agent Instructions** panel separates the resolved system prompt from your work-request message with an accented divider.

![Pipeline detail — IMPLEMENT expanded](screenshots/pipeline-detail-implement.png)

The header shows lifecycle controls — pause, resume, and stop buttons with real-time state transitions and a status badge.

![Lifecycle controls — Failed status badge with Resume and Stop buttons](screenshots/lifecycle-controls.png)

### PR Details

When the PR stage completes, an inline **PR info strip** appears at the bottom of the stage card with the metadata captured by the guardian agent (W-051) — visible the moment the stage is expanded, no second click. Items render only when their data is present:

- Linked PR number with provider-aware external-link icon
- Provider — GitHub, GitLab, Bitbucket, Azure DevOps, or Gitea (auto-detected from the PR URL)
- Short commit SHA with copy-to-clipboard button
- Source → target branch flow
- Review status badge (when surfaced by the host)

![PR info strip — guardian's PR stage card expanded showing the inline PR metadata row](screenshots/pr-details-panel.png)

This works across all five supported hosts, so non-GitHub remotes get the same one-glance PR summary.

## Learnings

After a run completes, the LEARN stage produces ranked observations and actionable suggestions. Copy-to-clipboard buttons let you feed insights directly into future runs or agent prompts; copied prompts automatically include a `## Source` block (project, run ID, branch, artifacts path, start time, and fleet/workspace IDs) for full traceability.

![Learnings panel](screenshots/learn-stage.png)

## Global Dashboard

In global mode (the default), the sidebar shows a project picker with all registered projects, live status indicators, and a "Run Pipeline" split-button (chevron exposes "Run Fleet" / "Run Workspace"). Select a project to see its runs, beads, costs, and settings.

![Global dashboard — project-scoped history view with sidebar navigation](screenshots/global-dashboard.png)

The sidebar project picker shows all registered projects with live status dots (green = healthy, red = errors) and run count badges.

![Sidebar project picker with all registered projects and live status dots](screenshots/sidebar-projects.png)

## Add Project

Click the **+** button next to the project picker to register one or more projects. Pick **Single project** for a normal directory, or **Multiple projects** to scan a parent folder and register several repositories at once; the dialog validates the path and auto-generates a slug for the project name. Adding a single project then opens the **Project Setup** wizard, which installs worca and walks through initial configuration. (Registering multiple projects does *not* create a [workspace](#workspace-runs) — that's a separate concept.)

![Add project dialog with Single project and Multiple projects modes](screenshots/add-project-dialog.png)

## Run History

Browse completed and interrupted runs sorted newest-first. Each card shows the branch, timing, and stage completion badges.

![Run History](screenshots/history.png)

## Run Pipeline

Start a single-project pipeline run from a prompt, GitHub issue, or spec file. Advanced options for size/loop multipliers, branch selection, and pre-made plan files.

![Run Pipeline — launcher form for a single-project pipeline](screenshots/new-pipeline.png)

## Beads Issues

Browse runs filtered to those that produced beads. Each card shows the run's branch, template, timing, cost, stage badges, and a closed/total bead count badge (e.g. `7/7 Beads`). Drilling into a run reveals the per-run beads list and dependency graph in the run detail view.

![Beads Issues view — runs with bead counts and stage badges](screenshots/beads-kanban.png)

## Token & Cost Dashboard

Per-run cost breakdown with a stage-proportional bar chart. Detailed table showing cost, turns, duration, and API duration per iteration.

![Cost Dashboard](screenshots/costs.png)

## Settings

Configure agent models and max turns, pipeline stages, governance rules, pricing, webhooks, integrations, and preflight checks — all saved to `.claude/settings.json` and effective immediately without restarting. Saves are locked while a pipeline is running to prevent mid-run config drift.

![Project Settings — Approval Gates, Circuit Breaker, and Execution & Parallelism subpanels (W-049)](screenshots/settings.png)

W-049 added four subpanels for previously JSON-only knobs:

- **Execution & Parallelism** — worktree base directory, default PR base branch, max concurrent pipelines, cleanup policy
- **Approval Gates** — plan and PR approval gates (gate the run pre-PR-creation when enabled)
- **Circuit Breaker** — max failures before halting, classifier model selection
- **Preferences** (global, `~/.worca/settings.json`) — cross-project keys: cleanup policy, concurrency cap, worktree disk warning threshold, classifier model

When a project's `.claude/settings.json` still contains misplaced global keys or template-default milestone values, an inline banner offers one-click migration; saving any settings change triggers the same auto-migration on the server side.

The **Graphify** tab (optional, off by default) enables the code knowledge-graph integration per project — pick the model profile, copy the recommended `uv tool install` command, and trigger async **Build** / **Clear** of the per-commit graph cache. When a graph is ready, each agent iteration in run detail shows a `Graphify: N` query-count badge.

Preflight checks validate the environment before spending tokens — catching git state issues, missing dependencies, and configuration problems. Each check can be toggled independently.

![Preflight settings](screenshots/preflight-settings.png)

The webhooks panel configures event subscriptions, budget limits, and HMAC-SHA256 signing for pipeline event delivery.

![Webhooks settings — event system toggles, budget limits, and webhook configuration](screenshots/webhooks-settings.png)

### Integrations

A card-catalog UI for chat integrations (Telegram, Discord, Slack, generic webhook). Each card shows real connection-health badges (polled every 10s while the tab is open), an enable/disable toggle, and Edit/Remove buttons. Adding or updating a project auto-configures its outbound webhook so events route correctly without manual setup.

![Integrations card catalog — Telegram connected and enabled, Discord and Slack configured but disabled](screenshots/integrations.png)

See the [Chat Integrations Setup Guide](spec/integrations/README.md) for the full configuration model and security details.

## Sidebar Badges

The sidebar count badges follow a three-tier escalation that mirrors the badge-color-language guide:

- 🔵 **primary (blue)** — at least one item is actively in flight (running / resuming; for workspaces also `planning` / `integration_testing`)
- 🟠 **warning (orange)** — at least one item needs operator attention (halted, integration_failed, failed, or worktree disk pressure)
- ⚪ **neutral (grey)** — all items are idle / terminal

Running, Worktrees, Fleets, and Workspaces all use the same priority. A running fleet badge reads blue at a glance; a halted one flips to orange. The History row is always grey — it's an archive count.

## Fleet Runs

Fan a single work-request across N independent projects in parallel. The list view shows one card per fleet with project-name chips, status badge, and aggregate timing.

![Fleet runs list — one card per fleet with per-project chips](screenshots/fleet-runs.png)

Click into a fleet to see the per-child run cards, the work request, the attached guide (if any), and lifecycle controls (Pause / Halt / Stop / Resume / Cleanup / Re-run).

![Fleet detail — halted fleet with circuit-breaker banner and child summary](screenshots/fleet-detail.png)

See [Fleet Runs](fleet-runs.md) for the full CLI and orchestrator reference.

## Workspace Runs

Coordinate changes across interdependent projects with dependency-ordered execution. Workspace runs decompose one prompt into per-project sub-plans, execute them in DAG tier order, run cross-project integration tests, and create linked PRs.

The workspace list shows one card per run with the project-name chips that come from the workspace's `projects[]`. Same shape as the fleet card so the two surfaces read as siblings.

![Workspace runs list — one card per workspace with per-project chips](screenshots/workspace-runs.png)

The detail page surfaces the dependency graph (arrowheads show propagation order), the work request, the optional reference guide, and a per-project run card list with live status.

![Workspace detail — dependency graph with arrowheads and per-project run cards](screenshots/workspace-detail-dag.png)

Launch new workspace runs from the **+ Run Workspace** entry in the sidebar split-button. The launcher picks a registered workspace definition, accepts a prompt or `--source` reference, supports normative guide attachment, and exposes per-tier concurrency plus four planning strategies — **master planner** (default), **independent** (each project runs its own Planner), **existing plan** (upload or reference a `workspace-plan.json`), and **per-project plans** (attach a markdown plan per repo).

![Workspace launcher — prompt + guide + plan-mode form for starting a workspace run](screenshots/workspace-launcher.png)

Workspace definitions live in **Configuration → Workspaces**. Each row carries the parent path, project count, whether an integration test is configured, the umbrella GitHub repository, and quick actions (Launch / Edit / Delete).

![Workspaces configuration — table of registered workspace definitions](screenshots/workspaces-config.png)

See [Workspace Runs](workspace-runs.md) for the full schema, lifecycle, and DAG executor reference.

## Worktrees

Every parallel pipeline runs in its own git worktree under `<project>/.worktrees/pipeline-<run_id>/` with independent `.worca/` state. The Worktrees view shows every worktree across registered projects with disk usage, age, and one-click cleanup. The sidebar badge flips to orange when total disk usage crosses the warning threshold (default 2 GB).

![Worktrees view — list of worktrees with disk usage, age, and Cleanup actions](screenshots/worktrees.png)
