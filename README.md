# Worca

[![npm](https://img.shields.io/npm/v/@worca/app)](https://www.npmjs.com/package/@worca/app)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)](.nvmrc)

Worca is a **deterministic multi-agent pipeline** that drives Claude Code
(headless) through **Plan → Refine → Implement → Review** for a software task.
You point it at a project, describe the work, and a state machine runs the
agents of your chosen workflow in sequence — looping until the work clears
quality gates, pausing to ask *you* the questions that matter, and keeping
every run isolated in its own git worktree and branch.

It ships as a **web UI**, a **CLI**, and an installable **`/worca` skill** for
Claude Code — all running the same engine. See the
**[architecture in one picture](docs/ARCHITECTURE.md)**.

[![The Worca stack — clients, the engine, the headless Claude Code harness, and model endpoints](docs/screenshots/architecture.png)](docs/ARCHITECTURE.md)

## How a run works

1. **Clarify** — instead of assuming, the planner turns hidden decisions into
   multiple-choice questions (2–4 options plus free text). Your answers are
   appended to the plan so reviewers see them.
2. **Plan** — the planner explores the codebase and writes an implementation
   plan with concrete code snippets.
3. **Refine** — the refiner reviews and rewrites the plan (`-v2`, `-v3`, …)
   until no critical/major issues remain.
4. **Implement** — the implementer follows the approved plan with no
   deviation, using TDD (red-green-refactor).
5. **Review** — the code reviewer reviews the git diff and hands blocking
   findings back to the implementer, looping Implement → Review until clean.

Loops gate to you past their cycle cap (default 3): approve another cycle or
continue with the open issues shown. Only `critical`/`major` findings block; a
finished run ends on its own branch, one click away from a PR.

![Clarify questions — real decisions with options, before any code is written](docs/screenshots/clarify.png)

Every finished run keeps its full record — the diff per file, per-step costs
and durations, the clarify Q&A, agent transcripts, and logs:

![Run detail — diff, per-step costs, and one-click PR](docs/screenshots/run-detail.png)

## Features

### Pipeline

- **Deterministic engine** — a state machine sequences the agents; agents do
  the creative work, the engine does the control flow. Every step, verdict,
  and artifact is recorded.
- **Pause & resume, even across restarts** — pause mid-run (or hit a cost
  cap); resume later re-attaches the interrupted Claude sessions
  (`claude --resume`), surviving server restarts. Worktrees and uncommitted
  agent work are kept.
- **Isolated worktrees** — each run works on its own git worktree and feature
  branch; your checkout is never touched, and parallel runs don't collide.
- **Live cockpit** — flow graph per run, streaming log with source/level/
  step/cycle filters and search, per-run cost and elapsed time, compact and
  detailed densities.
- **One-click PRs** — a finished run shows its diff (files, +/−) and opens a
  pull request via `gh` from the History view.
- **Mock mode** — the entire pipeline runs offline with a deterministic mock
  (no `claude`, no tokens) for demos, development, and CI.

![Running pipeline with live flow graph and streaming log](docs/screenshots/running.png)

### Agents

- **11 data-driven agents** — planner, plan refiner, plan reviewer,
  implementer, code reviewer, clarify, decomposer (splits a plan into
  vertical-slice tasks, one implementer each), manual-tests checklist, manual
  web-UI testing (drives a browser via Playwright), workspace scanner, and
  workspace reviewer. Each agent is a markdown prompt plus a metadata sidecar
  declaring its typed input/output ports — new agents drop in without engine
  changes.
- **AI-assisted agent creation** — describe a new agent in the UI and Worca
  generates both its system prompt and metadata (or paste your own prompt and
  let it infer just the wiring); edit, regenerate, and save.
- **Per-agent model & effort** — pick model and reasoning effort per agent,
  per workflow, or per run, with a clear resolution order and "save as
  workflow defaults".

### Workflow Composer

- **Compose your own pipeline** — drag agents onto a canvas and wire their typed
  ports: each card declares what it consumes and produces, a wire only connects
  compatible ports, and a wire that closes a cycle becomes a loop with its own
  cycle cap (a reviewer keeps sending work back until it passes or the budget
  runs out). Flow cards — **Task** (the run's request), **End** (the result),
  **AND**, **OR**, **Combine** — express joins, choices and merges without any
  code. Saved pipelines appear in the New Pipeline picker.
- **Share a pipeline** — *Export…* on a saved pipeline offers three formats.
  A *JSON file* passes it to another Worca user, who picks it up with
  *Import…* (a taken name gets a ` (2)` suffix; nothing is ever overwritten).
  A *Claude Code skill* turns it into a runnable `/command` under `.claude/`
  so it runs without Worca. A *Worca plugin* folder bundles the pipeline with
  your own agents it uses and the skills they need, so the recipient runs
  `worca plugin link <folder>` and updates later with `worca plugin reimport`.
  Built-in agents are never copied — a plugin pipeline may reference them
  directly. The saved list is tabbed by domain; click a card to open it.

![Workflow Composer — drag agents into steps, groups, and feedback loops](docs/screenshots/composer.png)

### Guardrails

- **Named policy sets, selected per run** — built-in **Permissive / Normal /
  Strict** tiers plus your own sets. Normal protects credential files and
  blocks publication commands; Strict adds environment scrub on agent spawn,
  network-egress and cloud-CLI denies, and home-dir credential protection.
- **Enforced via Claude Code permissions** — policies compile to
  `permissions.deny` rules on every agent spawn; repo settings can't undo
  them. See [`docs/guardrails.md`](docs/guardrails.md) for the full model and
  its honest limitations.

### Workspaces

- **Multi-project runs** — group related repos into a workspace; a scanner
  maps how they interconnect (shared APIs, schemas, build deps) into an
  editable description, and a workspace run fans the pipeline out across all
  members — one branch and worktree per member, one cross-project review
  verdict at the end.

### Plugins & chat

- **Plugin system with marketplaces** — plugins contribute task sources
  (e.g. GitHub Issues), agents, skills, workflow templates, models, and chat
  channels. Install from a marketplace with an explicit consent ceremony
  (what's installed, which secrets are required, which setup commands run);
  updates show a commit-level preview before you accept.
- **Drive runs from chat** — bundled two-way **Telegram**, **Slack**,
  **Discord**, and **Microsoft Teams** channels: get notified on questions,
  finishes, failures, and cost pauses, and answer back with commands —
  `/status`, `/cost`, `/answer`, `/approve`, `/pause`, `/resume`, `/stop`,
  and more — with allowlist-based authorization.

### Costs & budgets

- **Cost tracking everywhere** — per-run and per-step cost estimates, a
  Statistics view with spend/time/outcome charts per day, week, or month, and
  a spend indicator in the sidebar.
- **Hard limits** — a per-pipeline cost cap pauses a runaway run (resumable
  with an explicit override); a total budget pauses everything and blocks new
  runs until the weekly or monthly window resets.

![Statistics — spend, time worked, outcomes, and per-day charts](docs/screenshots/stats.png)

### Models

- **Bring your own models** — register any model id (a proxy, a fine-tune, an
  alternative provider), declare which effort levels it supports, and attach
  per-model routing environment (e.g. `ANTHROPIC_BASE_URL`) that is merged
  into that model's agent spawns. Share a model catalog as a plugin, with
  secrets required at install time.
- **No first-party account needed** — run and chat titles are written by the
  model the run or chat itself uses (Settings › General › Title generation picks
  a fixed one instead), endpoint-routed models carry Claude Code's internal
  haiku/sonnet/opus/fable tier keys so nothing falls back to the Anthropic API,
  and *Hide built-in models* (Settings › Models) drops the built-ins from every
  picker.

### Storage

- **Nothing in your repo** — run state lives in one SQLite database
  (`~/.worca-cc/worca-cc.db`), plan/review markdown in a machine-wide store
  keyed by repo identity (stable across worktrees). The **History** view
  spans every project on the machine. See
  [`docs/storage.md`](docs/storage.md).

![History — every run on the machine, grouped by project, one click from a PR](docs/screenshots/history.png)

## Install

```bash
npm install -g @worca/app
```

Requirements:

- **Node.js >= 22.13.0** (the built-in `node:sqlite` store)
- The **[Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI**
  (`claude`) on your `PATH` — for real runs; mock mode needs nothing.
  On **native Windows** both the [native installer](https://docs.anthropic.com/en/docs/claude-code/setup)
  (`claude.exe`) and `npm install -g @anthropic-ai/claude-code` work: npm puts a
  `claude.cmd` shim on `PATH` that Node cannot spawn, so Worca runs the package's
  native `claude.exe` next to it instead. If that binary is missing (the package's
  `postinstall` didn't run) or the layout isn't npm's, Worca says so rather than
  a bare `ENOENT`; `WORCA_CLAUDE_BIN` can always point at a `claude.exe` directly.

## Quick start

### Web UI

```bash
worca ui            # start it (worca --ui does the same)
```

Open the printed URL (default `http://localhost:4317`), add a project, and
click **New pipeline**: describe the task (or paste a markdown brief, or pull
a task from a plugin source like GitHub Issues), pick a workflow and
guardrails, and run. Answer clarify questions and loop gates as they come —
in the browser or from chat.

The UI is one process per machine. Starting it while it is already up is not
an error — Worca prints the URL and how to restart it, and exits 0:

```bash
worca ui status                 # is it running? (exit 0 = yes, 1 = no)
worca ui restart                # stop the running one, start it again
worca ui stop                   # stop it gracefully
worca ui --port 4318 --open     # another port; open the browser when up
```

`--port` (or the `PORT` env var) picks the port; `stop`, `restart` and
`status` remember the port of the last started UI, so they usually need no
flag. See `worca ui help`.

### CLI

```bash
# run a pipeline against a project
worca --project /path/to/your/project --prompt "Add a /search endpoint"

# use a markdown brief as the prompt
worca --project /path/to/your/project --file ./brief.md --title "Search feature"

# pause with Ctrl+C, continue later (survives restarts)
worca resume <pipelineId>

# offline demo — full pipeline, no tokens
worca --project /path/to/your/project --prompt "demo task" --mock --yes

# share a saved pipeline: as JSON, or as a plugin folder bundling your agents + skills
worca workflow export wf_my-flow --format json --out my-flow.json
worca workflow import my-flow.json
worca workflow export wf_my-flow --format plugin --target ./my-flow-plugin
```

Run `worca --help` for all subcommands (projects, plugins, marketplaces,
workflows, config, doctor) and flags.

Exit codes, for scripts and CI wrappers: `0` the run finished (or an
interactive run paused and you can resume it); `1` a hard error, a stop, or an
interactive pause an error forced; `2` a usage error; `3` a `--yes` run that
parked itself — auth, quota, a usage or cost limit, exhausted retries, or a
step error — with nobody attached to resume it. Nothing is discarded on a
pause: `worca resume <pipelineId>` picks the run up where it stopped, and the
cause is printed with the pause block on stdout.

### `/worca` skill (inside Claude Code)

```bash
worca --install /path/to/your/project
```

Then open Claude Code in that project and run:

```
/worca Add a /search endpoint with pagination
```

The skill starts the same deterministic orchestrator.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — the whole stack in one picture
- [Guardrails](docs/guardrails.md) — policy model, enforcement, limitations
- [Storage](docs/storage.md) — where state lives, project keys, migration
- [Releasing](docs/RELEASING.md) — how `@worca/app` versions are published
- [Contributing](CONTRIBUTING.md) — developing Worca from source

## Contributing

Bug reports and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for
the from-source setup, the test suite, and the PR workflow. Development
happens on the `dev` branch.

## License

[MIT](LICENSE)
