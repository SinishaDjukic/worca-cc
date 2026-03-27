# worca-cc

Autonomous software development pipeline with governance enforcement.

worca-cc is a multi-agent pipeline that plans, coordinates, implements, tests, reviews, and learns from code changes autonomously. It runs as a `.claude/` folder you drop into any project — fully configurable, with safety hooks at every stage.

## Features

### Pipeline

- **9-stage pipeline** — Preflight → Plan → Plan Review → Coordinate → Implement → Test → Review → PR → Learn
- **7 specialized agents** — Planner, Plan Reviewer, Coordinator, and Guardian on Opus; Implementer, Tester, and Learner on Sonnet (model and max turns fully configurable per agent)
- **Pause, stop & resume** — pause mid-stage with clean checkpointing, stop with SIGTERM, resume from where you left off; the UI has pause/resume/stop buttons with real-time state transitions

![Lifecycle controls — Failed status badge with Resume and Stop buttons](docs/screenshots/lifecycle-controls.png)

- **Circuit breakers** — error classification with halt thresholds; when a stage fails too many times, the circuit breaker trips and prevents runaway cost
- **Preflight checks** — language-agnostic environment validation that always runs before spending tokens, catching git state issues, missing dependencies, and configuration problems

![Preflight settings](docs/screenshots/preflight-settings.png)

- **Post-run retrospective (LEARN stage)** — optional stage that analyzes what went well, what failed, and why; produces ranked observations with actionable suggestions and copy-to-clipboard prompts for improving future runs

![Learnings panel — observations ranked by importance with evidence](docs/screenshots/learn-stage.png)

### Work Sources & Integration

- **Multiple input modes** — prompt, spec file, GitHub issue (`gh:issue:42`), beads task (`bd:bd-abc`), or issue URL
- **GitHub issue lifecycle** — start from issues with `--source gh:issue:N`, auto-post progress comments, link PRs, close issues on completion
- **Smart title generation** — `--prompt` is optional; when omitted, the title is generated from the spec or plan file and sanitized for branch names
- **Pipeline events & webhooks** — 52 structured event types emitted as a real-time JSONL stream; subscribe via configurable webhooks with HMAC-SHA256 signing, retry logic, and secret management; control webhooks can pause or abort the pipeline

![Webhooks settings — event system toggles, budget limits, and webhook configuration](docs/screenshots/webhooks-settings.png)

### Governance & Safety

- **Governance hooks** — block dangerous operations (rm -rf, force push, env writes), enforce test gates, validate plans (each guard can be toggled independently)
- **Human approval gates** — optional checkpoints after planning, before merge, and before deploy (configurable per gate)
- **Token and cost tracking** — per-agent usage with model-specific pricing, budget warnings at configurable thresholds

### Customization

- **Agent prompt overlays** — add `.claude/agents/overrides/<agent>.md` to customize agent instructions per-project without modifying core templates; overlay blocks can **append** to or **replace** (via `<!-- replace -->`) targeted sections; governance-protected sections cannot be replaced
- **Local settings** — `settings.local.json` deep-merges machine-specific overrides that aren't committed to git
- **Loop controls** — configurable iteration limits for implement/test cycles, code review, and PR updates (per-loop-type limits + global multiplier)

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

### Using the `/worca-install` skill (recommended)

If you already have Claude Code, run inside the worca-cc repo:

```bash
cd worca-cc && claude
# Then type: /worca-install /path/to/your-project
```

This copies all pipeline files, installs dependencies, initializes beads, and stores the worca-cc source path in the target's `settings.json` for future `/worca-sync` updates.

### Manual installation

```bash
# Clone the repo
git clone https://github.com/SinishaDjukic/worca-cc.git

# Install beads CLI (uninstall any existing version first)
npm uninstall -g @beads/bd
npm install -g @beads/bd@0.49.0

# Install in your project
cp -R worca-cc/.claude/ your-project/.claude/

# Initialize beads in your project (warnings about missing hooks or
# outdated CLI are non-blocking — the pipeline works without fixing them)
cd your-project && bd init

# Install dashboard dependencies and build
cd your-project/.claude/worca-ui && npm install && npm run build
```

### Updating an existing installation

Use the `/worca-sync` skill to pull the latest pipeline files from worca-cc:

```bash
cd your-project && claude
# Then type: /worca-sync
```

The source repo path is resolved automatically from `worca.source_repo` in your project's `settings.json` (set by `/worca-install`). You can also pass an explicit path: `/worca-sync /path/to/worca-cc`.

Sync uses `rsync --delete` for core directories (worca, worca-ui, agents, hooks, scripts) to remove stale files, and additive sync for skills to preserve project-specific skills. Settings are merged — project-specific permissions, MCP config, and model preferences are never overwritten.

## Usage

Three modes of operation:

```bash
# Interactive — open Claude with pipeline hooks active
cd your-project && claude

# Autonomous — run full pipeline from prompt
python .claude/scripts/run_pipeline.py --prompt "Add user authentication"

# From spec file or pre-made plan
python .claude/scripts/run_pipeline.py --spec spec.md --plan plan.md

# From GitHub issue
python .claude/scripts/run_pipeline.py --source gh:issue:42
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--prompt TEXT` | Text prompt describing the work (optional — title auto-generated from spec/plan if omitted) |
| `--spec FILE` | Path to spec/requirements file |
| `--source TEXT` | Source reference (`gh:issue:42`, `bd:bd-abc`, or issue URL) |
| `--plan FILE` | Pre-made plan file (skips Plan stage) |
| `--resume` | Resume a previous run from status.json |
| `--branch NAME` | Use an existing branch instead of creating one |
| `--model MODEL` | Override the default model for all agents |
| `--msize [1-10]` | Task size multiplier — scales max_turns per stage |
| `--mloops [1-10]` | Loop multiplier — scales max loop iterations |
| `--settings FILE` | Path to settings.json (default: `.claude/settings.json`) |
| `--status-dir DIR` | Directory for pipeline status files (default: `.worca`) |

`--prompt`, `--spec`, and `--source` are mutually exclusive — provide one.

## Dashboard (worca-ui)

```bash
cd .claude/worca-ui && npm start
# Opens http://127.0.0.1:3400
```

A real-time web dashboard for monitoring and controlling the pipeline. All updates stream via WebSocket — no polling, no page refreshes.

### Pipeline Detail

Stage pipeline with iteration counts, costs, duration, and a timing bar showing Thinking vs Tools breakdown. Expand any stage to drill into per-iteration metrics. Pause, resume, and stop controls in the header.

![Pipeline detail — stage pipeline with costs, turns, and timing bar](docs/screenshots/run-detail-stages.png)

Expand a stage to see individual iterations — each shows agent, turns, cost, duration, and outcome. The log viewer streams real-time agent output with per-stage filtering.

![Pipeline detail — IMPLEMENT expanded](docs/screenshots/pipeline-detail-implement.png)

### Learnings

After a run completes, the LEARN stage produces ranked observations and actionable suggestions. Copy-to-clipboard buttons let you feed insights directly into future runs or agent prompts.

![Learnings panel](docs/screenshots/learn-stage.png)

### Run History

Browse completed and interrupted runs sorted newest-first. Each card shows the branch, timing, and stage completion badges.

![Run History](docs/screenshots/history.png)

### New Pipeline

Start a run from a prompt, GitHub issue, or spec file. Advanced options for size/loop multipliers, branch selection, and pre-made plan files.

![New Pipeline](docs/screenshots/new-pipeline.png)

### Beads Task Board

Kanban view of tasks created by the Coordinator, filtered by run. Shows priority badges, dependency chains, and status across Open/In Progress/Closed columns. Badge shows closed/total count (e.g., "3/5 beads").

![Beads Kanban](docs/screenshots/beads-kanban.png)

### Token & Cost Dashboard

Per-run cost breakdown with a stage-proportional bar chart. Detailed table showing cost, turns, duration, and API duration per iteration.

![Cost Dashboard](docs/screenshots/costs.png)

### Settings

Configure agent models and max turns, pipeline stages, governance rules, pricing, webhooks, and preflight checks — all saved to `.claude/settings.json` and effective immediately without restarting.

![Settings](docs/screenshots/settings.png)

### Development

After cloning, install the root dev dependencies to enable git hooks:

```bash
npm install          # installs husky (pre-commit hooks)
pip install -e ".[dev]"  # installs ruff, pytest, etc.
```

The pre-commit hook runs automatically on every `git commit` and checks:
- **ruff** — Python linting
- **biome** — JavaScript linting and formatting (worca-ui)
- **esbuild** — UI bundle build

After modifying any source files in `worca-ui/app/`, rebuild the bundle:

```bash
cd .claude/worca-ui && npm run build
```

This runs esbuild to produce `app/main.bundle.js`, which the server loads by default. Without rebuilding, changes to the source files won't take effect.

## Configuration

All configuration lives in `.claude/settings.json` under the `worca` key:

- **`worca.agents`** — model and max_turns per agent (planner, coordinator, implementer, tester, guardian, learner)
- **`worca.stages`** — enable/disable pipeline stages (preflight, plan, coordinate, implement, test, review, pr, learn), assign agents
- **`worca.loops`** — iteration limits (implement/test: 5, code review: 5, PR changes: 5, restart planning: 2)
- **`worca.governance`** — guards (block rm -rf, force push, env writes), test gate strike limit, dispatch rules
- **`worca.milestones`** — human approval gates (plan, PR, deploy)
- **`worca.pricing`** — per-model token pricing for cost tracking
- **`worca.circuit_breaker`** — max failures before halting, transient error retry logic
- **`worca.events`** — event emission and webhook configuration (HMAC signing, retry, secret management)

### Local overrides

Create `settings.local.json` next to `settings.json` for machine-specific overrides. It deep-merges on top of the base config and is gitignored.

### Agent prompt overlays

Add `.claude/agents/overrides/<agent>.md` files to customize agent prompts per-project. Use `## Override: <Section Name>` blocks to target specific sections. Add `<!-- replace -->` as the first line to replace instead of append. Governance-protected sections (marked `<!-- governance -->`) cannot be replaced.

## Architecture

```
Preflight → Planner (Opus) → Plan Reviewer (Opus) → Coordinator (Opus) → Implementer(s) (Sonnet) → Tester (Sonnet) → Guardian (Opus) → Learner (Sonnet)
```

Plan Review and Learn are disabled by default; enable via `worca.stages.plan_review.enabled` / `worca.stages.learn.enabled` in settings.json.

| Agent | Model | Role |
|-------|-------|------|
| **Planner** | Opus | Reads work request, explores codebase, creates detailed implementation plan |
| **Plan Reviewer** | Opus | Validates plan for completeness, feasibility, and architecture fit; loops back to Planner on critical issues |
| **Coordinator** | Opus | Decomposes plan into beads tasks with dependencies and parallel groups |
| **Implementer** | Sonnet | Claims task, implements with TDD, commits code, closes task |
| **Tester** | Sonnet | Runs test suite, verifies coverage, collects proof artifacts |
| **Guardian** | Opus | Verifies test proof, reviews code, creates PR, manages human gates |
| **Learner** | Sonnet | Analyzes completed run, produces ranked observations and improvement suggestions |

Governance hooks run at every tool call — `pre_tool_use` enforces guards and plan validation, `post_tool_use` enforces test gates and links beads tasks. The event system emits structured events at each stage transition, bead assignment, error, and governance violation.

## Project Structure

```
.claude/
├── agents/
│   ├── core/           # Agent templates (planner, coordinator, implementer, tester, guardian, learner)
│   ├── domain/         # Custom domain-specific agents
│   └── overrides/      # Per-project prompt overlays (gitignored)
├── hooks/              # Claude Code lifecycle hooks
│   ├── pre_tool_use.py
│   ├── post_tool_use.py
│   └── ...
├── scripts/
│   ├── run_pipeline.py # CLI entry point
│   ├── run_learn.py    # LEARN stage runner
│   ├── run_parallel.py # Parallel batch execution
│   └── run_batch.py    # Batch runner
├── skills/
│   ├── worca-install/        # /worca-install skill
│   ├── worca-sync/           # /worca-sync skill
│   └── worca-agent-override/ # /worca-agent-override skill
├── worca/
│   ├── orchestrator/   # Pipeline runner, stages, resume, prompt builder, error classifier, overlays, events, control
│   ├── events/         # Event emitter, webhook dispatch, event types
│   ├── hooks/          # Guard, plan_check, test_gate, tracking, session
│   ├── schemas/        # JSON schemas for agent outputs
│   ├── state/          # Status persistence
│   └── utils/          # Git, beads, Claude CLI, GitHub issues, token tracking, settings
├── worca-ui/
│   ├── server/         # Express + WebSocket server
│   ├── app/            # Lit-HTML frontend
│   └── scripts/        # Build scripts
└── settings.json       # Configuration
```

## Linting

```bash
# Python lint
ruff check .

# UI lint (JavaScript)
cd .claude/worca-ui && npm run lint

# Auto-fix lint issues
cd .claude/worca-ui && npm run lint:fix
```

## Testing

```bash
# Python tests
pytest tests/ -v

# UI server tests
npx vitest run .claude/worca-ui/server/

# Browser e2e tests (must run serially)
cd .claude/worca-ui && npx playwright test --workers=1
```

## License

[MIT](LICENSE)
