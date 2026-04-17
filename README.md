# worca-cc

Autonomous software development pipeline with governance enforcement.

worca-cc is a multi-agent pipeline that plans, coordinates, implements, tests, reviews, and learns from code changes autonomously. It runs as a `.claude/` folder you drop into any project — fully configurable, with safety hooks at every stage.

![Pipeline stages — Preflight through PR with per-stage cost, turns, and duration](docs/screenshots/pipeline-stages.png)

## Features

### Pipeline

- **9-stage pipeline** — Preflight → Plan → Plan Review → Coordinate → Implement → Test → Review → PR → Learn
- **8 specialized agents** — Planner, Plan Reviewer, Coordinator, Implementer, Tester, Reviewer, Guardian, and Learner (model and max turns fully configurable per agent)
- **Pause, stop & resume** — pause mid-stage with clean checkpointing, stop with SIGTERM, resume from where you left off; the UI has pause/resume/stop buttons with real-time state transitions and force-cancel for stale runs
- **Circuit breakers** — error classification with halt thresholds; when a stage fails too many times, the circuit breaker trips and prevents runaway cost
- **Preflight checks** — language-agnostic environment validation that always runs before spending tokens, catching git state issues, missing dependencies, and configuration problems
- **Post-run retrospective (LEARN stage)** — optional stage that analyzes what went well, what failed, and why; produces ranked observations with actionable suggestions and copy-to-clipboard prompts for improving future runs

### Work Sources & Integration

- **Multiple input modes** — prompt, spec file, GitHub issue (`gh:issue:42`), beads task (`bd:bd-abc`), or issue URL
- **GitHub issue lifecycle** — start from issues with `--source gh:issue:N`, auto-post progress comments, link PRs, close issues on completion
- **Smart title generation** — `--prompt` is optional; when omitted, the title is generated from the spec or plan file and sanitized for branch names
- **Pipeline events & webhooks** — 52 structured event types emitted as a real-time JSONL stream; subscribe via configurable webhooks with HMAC-SHA256 signing, retry logic, and secret management; control webhooks can pause or abort the pipeline

### Governance & Safety

- **Governance hooks** — block dangerous operations (rm -rf, force push, env writes), enforce test gates, validate plans (each guard can be toggled independently)
- **Configurable subagent dispatch** — per-agent allowlists control which Claude Code subagents each pipeline agent can spawn; `general-purpose` is on an unbypassable denylist; dispatch events render as green/red badges per iteration in the UI
- **Human approval gates** — optional checkpoints after planning, before merge, and before deploy (configurable per gate)
- **Token and cost tracking** — per-agent usage with model-specific pricing, web search/fetch cost tracking, cache tier breakdown, budget warnings at configurable thresholds

### Pipeline Templates

- **Built-in templates** — `feature`, `bugfix`, `quick-fix`, `incident-analysis`, `refactor` — each with tailored stage flows, agent selection, and governance rules for different work types
- **Template selection UI** — styled dropdown on the new-run page with group headers, descriptions, and indentation; also selectable via CLI
- **Agent prompt overrides** — templates wire their own agent prompt overrides through the overlay resolver, so each work type gets purpose-built instructions

### Customization

- **Agent prompt overlays** — add `.claude/agents/<agent>.md` to customize agent instructions per-project without modifying core templates; overlay blocks can **append** to or **replace** (via `<!-- replace -->`) targeted sections; governance-protected sections cannot be replaced
- **Local settings** — `settings.local.json` deep-merges machine-specific overrides that aren't committed to git
- **Loop controls** — configurable iteration limits for implement/test cycles, code review, and PR updates (per-loop-type limits + global multiplier)

### Multi-Project Dashboard

- **Global mode** — `worca-ui` monitors all registered projects from one browser tab (default)
- **Sidebar project picker** — dropdown with live status dots (green = healthy, red = errors) and run count badges
- **Add-project dialog** — register projects via the UI with path validation and duplicate detection
- **Batch registration** — `worca-ui migrate --scan ~/dev` discovers and registers all worca-enabled projects in one command
- **Rich bead tooltips** — hover over any bead in Kanban, dependency graph, or list views for structured details with copy button and interactive content

### Parallel Pipelines

- **`run_multi.py`** — run N pipelines concurrently, each isolated in its own git worktree with independent `.worca/` state, `.beads/` database, and git branch
- **Three-level UI** — projects → pipelines → stages, with per-pipeline pause/stop/resume controls
- **Configurable cleanup** — `on-success` (remove successful worktrees), `always`, or `never`
- **Registry tracking** — all running pipelines are tracked in `.worca/multi/pipelines.d/` for monitoring and stale process recovery

## Architecture

```
Preflight → Planner → Plan Reviewer → Coordinator → Implementer(s) → Tester → Guardian → Learner
```

Plan Review and Learn are disabled by default; enable via `worca.stages.plan_review.enabled` / `worca.stages.learn.enabled` in settings.json.

| Agent | Role |
|-------|------|
| **Planner** | Reads work request, explores codebase, creates detailed implementation plan |
| **Plan Reviewer** | Validates plan for completeness, feasibility, and architecture fit; loops back to Planner on critical issues |
| **Coordinator** | Decomposes plan into beads tasks with dependencies and parallel groups |
| **Implementer** | Claims task, implements with TDD, commits code, closes task |
| **Tester** | Runs test suite, verifies coverage, collects proof artifacts |
| **Reviewer** | Reviews code changes for bugs, quality, and convention adherence; approves or requests changes |
| **Guardian** | Verifies test proof, commits code, creates PR, manages human gates |
| **Learner** | Analyzes completed run, produces ranked observations and improvement suggestions |

Governance hooks run at every tool call — `pre_tool_use` enforces guards and plan validation, `post_tool_use` enforces test gates and links beads tasks. The event system emits structured events at each stage transition, bead assignment, error, and governance violation.

## Project Structure

After `worca init`, your project gets:

```
.claude/
  worca/                 # Runtime copy of pipeline (managed, overwritten on upgrade)
  agents/                # Your agent prompt overrides (never touched by upgrade)
  settings.json          # Pipeline configuration
```

## Prerequisites

- Python 3.8+
- Node.js 22+ (for dashboard)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command)
- Git
- [beads](https://github.com/nightconcept/beads) CLI for task management and work coordination
  ```bash
  npm install -g @beads/bd@0.49.0
  ```
  Use version 0.49.0 specifically — later versions require Dolt DB, which is not needed for this project.

## Installation

```bash
pip install worca-cc              # Python pipeline + CLI
npm install -g @worca/ui          # Dashboard
npm install -g @beads/bd@0.49.0   # Issue tracking
```

```bash
cd your-project
worca init                        # scaffolds .claude/ with pipeline files
```

To update: `pip install --upgrade worca-cc && worca init --upgrade`

Use `worca init --check` for a dry-run that shows what would change without modifying anything.

## Quick Start

```bash
# Interactive — open Claude with pipeline hooks active
cd your-project && claude

# Autonomous — run full pipeline from prompt
worca run --prompt "Add user authentication"

# From spec file or pre-made plan
worca run --spec spec.md --plan plan.md

# From GitHub issue
worca run --source gh:issue:42

# From the dashboard — click "New Pipeline" in worca-ui
worca-ui                         # monitor all projects (default)
worca-ui --project /path         # monitor single project
worca-ui --help                  # show all commands and options
```

See [CLI Reference](docs/cli-reference.md) for all flags and commands.

## Dashboard (worca-ui)

A real-time web dashboard for monitoring and controlling the pipeline. All updates stream via WebSocket — no polling, no page refreshes.

![Pipeline detail — stage pipeline with costs, turns, and timing bar](docs/screenshots/run-detail-stages.png)

![Global dashboard — project-scoped history view with sidebar navigation](docs/screenshots/global-dashboard.png)

![Beads Kanban](docs/screenshots/beads-kanban.png)

See [Dashboard Guide](docs/dashboard.md) for the full screenshot walkthrough.

## Chat Integrations

Get pipeline notifications on your phone and control runs remotely via **Telegram**, **Discord**, **Slack**, or any outbound webhook. Integrations run inside the UI server process — no separate service needed.

- **Telegram** — two-way: push notifications + commands (`/pause`, `/resume`, `/stop`, `/status`, `/cost`, `/pr`)
- **Discord** — outbound push notifications via bot
- **Slack** — outbound push notifications via incoming webhook
- **Generic webhook** — POST to any HTTP endpoint in multiple payload formats (`generic-json`, `slack-compatible`, `ntfy`, etc.)

**Quick start:**
```bash
# 1. Create ~/.worca/integrations/config.json (see docs)
# 2. Set env vars for bot tokens / webhook URLs
export TELEGRAM_BOT_TOKEN=...

# 3. Restart the UI server
pnpm worca:ui:restart

# 4. Verify
worca integrations status
```

See [Chat Integrations Setup Guide](docs/spec/integrations/README.md) for the full configuration reference, BotFather setup, Discord/Slack webhook instructions, strict inbox verification, and the security model.

## Configuration

All configuration lives in `.claude/settings.json` under the `worca` key:

- **`worca.agents`** — model and max_turns per agent (planner, plan_reviewer, coordinator, implementer, tester, reviewer, guardian, learner)
- **`worca.stages`** — enable/disable pipeline stages (preflight, plan, coordinate, implement, test, review, pr, learn), assign agents
- **`worca.loops`** — iteration limits (implement/test: 5, code review: 5, PR changes: 5, restart planning: 2)
- **`worca.governance`** — guards (block rm -rf, force push, env writes), test gate strike limit, `subagent_dispatch` per-agent allowlists (user config replaces defaults per agent; `general-purpose` denylist enforced)
- **`worca.milestones`** — human approval gates (plan, PR, deploy)
- **`worca.pricing`** — per-model token pricing for cost tracking
- **`worca.circuit_breaker`** — max failures before halting, transient error retry logic
- **`worca.events`** — event emission and webhook configuration (HMAC signing, retry, secret management)
- **`worca.parallel`** — parallel pipeline settings (max_concurrent_pipelines: 3, default_base_branch, cleanup_policy: `on-success`|`always`|`never`, worktree_base_dir)

### Local overrides

Create `settings.local.json` next to `settings.json` for machine-specific overrides. It deep-merges on top of the base config and is gitignored.

### Agent prompt overlays

Add `.claude/agents/<agent>.md` files to customize agent prompts per-project. Use `## Override: <Section Name>` blocks to target specific sections. Add `<!-- replace -->` as the first line to replace instead of append. Governance-protected sections (marked `<!-- governance -->`) cannot be replaced.

## Documentation

- [CLI Reference](docs/cli-reference.md) — all flags and commands for `worca run`, `worca multi`, `worca init`, `worca-ui`
- [Dashboard Guide](docs/dashboard.md) — full screenshot walkthrough of the monitoring UI
- [Chat Integrations Setup](docs/spec/integrations/README.md) — Telegram, Discord, Slack, webhook config, security model
- [Contributing](CONTRIBUTING.md) — development setup, project structure, linting, testing, and release process
- [Changelog — worca-cc](src/worca/CHANGELOG.md)
- [Changelog — @worca/ui](worca-ui/CHANGELOG.md)

## License

[MIT](LICENSE)
