# worca-cc

worca (Workflow Orchestration for Agents) — autonomous software development pipeline combining orchestration with governance enforcement.

## Quick Start

```bash
# Install via /worca-install skill (recommended)
cd worca-cc && claude
# Then type: /worca-install /path/to/my-project

# Or manually copy .claude/ folder
cp -R .claude/ my-project/.claude/
cd my-project/worca-ui && npm install && npm run build && cd -

# Interactive mode
cd my-project && claude

# Autonomous mode (in-place)
python .claude/worca/scripts/run_pipeline.py --prompt "Add user auth"

# Autonomous mode in an isolated git worktree (parallel-safe)
python .claude/worca/scripts/run_worktree.py --prompt "Add user auth" [--branch main] [--guide spec.md]
# --branch: base branch for the new worktree (default: current HEAD)
# --guide: path to a reference guide injected into the plan prompt (repeatable, requires W-040)
# All four entry scripts (run_pipeline.py, run_worktree.py, run_fleet.py, run_workspace.py) accept
# --claude-md-mode <none|project|project+local|all> to restrict which CLAUDE.md files are loaded.
# Default is 'all' (standard behaviour). Use 'project' for hermetic/CI runs. See docs/claude-md-mode.md.
```

## Architecture

9 stages: Preflight → Planner (Opus) → Plan Reviewer (Opus) → Coordinator (Opus) → Implementer(s) (Sonnet) → Tester (Sonnet) → Reviewer (Opus) → Guardian (Opus) → Learner (Opus)

Plan Review and Learn are disabled by default; enable via `worca.stages.plan_review.enabled` / `worca.stages.learn.enabled` in settings.json.

PR creation can be deferred to an operator (e.g. promoted from the UI) via `worca.stages.pr.defer: true` in settings.json (default `false`). This is a template-driven key — templates own it when in play. The workspace DAG executor also sets `WORCA_DEFER_PR=1` in child runs; the two producers compose monotonically (either can defer, neither can un-defer). When deferred, the guardian stage emits `pipeline.git.pr_deferred` instead of creating a PR.

All governance enforced via Python hooks in `src/worca/claude_hooks/`.

The rationale behind major architectural choices — UI stack, state model, governance, modularity, webhooks — is consolidated in [`docs/design-principles.md`](./docs/design-principles.md). Read it before proposing structural changes.

## Project Structure

```
src/worca/               # Python package (pip-installable)
  orchestrator/          # Pipeline state machine, stages, prompt builder
  claude_hooks/          # Claude Code hook scripts (pre/post tool use, etc.)
  scripts/               # Pipeline entry points (run_pipeline.py, run_worktree.py)
  agents/core/           # Agent .md templates (planner, coordinator, etc.)
  schemas/               # JSON schemas for structured agent output
  state/                 # Status JSON read/write, iteration tracking
  utils/                 # Claude CLI, beads, git, gh_issues helpers
  cli/                   # CLI entry points (worca init, worca run, etc.)
.claude/
  worca/                 # Runtime copy (created by `worca init .`, gitignored)
  agents/                # User-specific agent overrides
  settings.json          # Pipeline config under the "worca" key
tests/                   # Python tests (pytest)
docs/plans/              # Feature plans (W-NNN-slug.md)
worca-ui/                # Web UI (lit-html + Shoelace + esbuild, top-level npm package)
  app/                   # Source files (views/, utils/, styles.css, main.js)
  server/                # Express API server
```

## Developer Setup (dogfooding)

```bash
pip install -e ".[dev]"   # Editable install — import worca points to src/worca/
worca init .              # Creates .claude/worca/ runtime copy (gitignored)
cd worca-ui && npm install && npm run build && cd -
```

After editing `src/worca/`, run `worca init --upgrade` to refresh `.claude/worca/`.
Tests import from the package directly (`from worca.xxx import yyy`), so they use live source via the editable install.

## Developer Tooling

Project-level skills and subagents (under `.claude/skills/` and `.claude/agents/`) automate recurring engineering rituals for worca-cc itself. They are **dev-time tooling** — separate from the runtime pipeline agents in `src/worca/agents/core/` that ship to consumer projects.

### Skills (invoke explicitly)

All dev-time skills live in `.claude/skills/` (prefixed `worca-*`, plus `state-action-matrix`). They self-describe and appear in the session skill list — check there for the full set and triggers rather than maintaining a copy here. Rituals to internalize:

- `/worca-dev-precommit` before every commit — picks the right ruff / biome / vitest / playwright / npm-pack subset for what the branch changed.
- `/worca-pr-prep` before merging a PR — verifies CI green and rebase, then merges via `gh pr merge --merge` (never local merge).
- `/worca-plan-new` to file a W-NNN feature plan; `/worca-issue` for reading/listing/filing GitHub issues (bakes in the `--json` workaround).
- `/state-action-matrix` before touching pipeline states, transitions, or action gating.
- Scaffolding skills (`/worca-ui-add-page`, `/worca-ui-add-card`, `/worca-event-add`) over hand-wiring — they cover wire-up points that silently fail when missed.

### Subagents (dispatch via Agent tool)

All prefixed `worca-*` to distinguish them from pipeline agents (planner, coordinator, etc.). Dispatch them when the trigger condition fires — they run in isolated context and return a structured verdict.

| Subagent | Dispatch when |
|---|---|
| `worca-plan-template-reviewer` | After drafting or substantially editing a plan file in `docs/plans/`. Audits against `_TEMPLATE.md` conventions. |
| `worca-dispatch-governance-reviewer` | After editing `worca.governance.dispatch` in settings.json, any agent prompt in `src/worca/agents/core/`, or hook code in `src/worca/claude_hooks/`. |
| `worca-ui-design-reviewer` | After UI changes — checks badge color compliance, the lit-html template binding gotcha, and the npm `files` allowlist. |
| `worca-stage-key-reviewer` | After changes to code that reads `status.json` or compares `stages.*` — catches the silent `'guardian'` (agent) vs `'pr'` (stage key) confusion. |
| `worca-release-preflight` | Right before `/worca-release` or `/worca-rc`. Audits version-file parity, CI status, MIGRATION.md coverage. |
| `worca-ui-routing-reviewer` | After adding or modifying a worca-ui section. Audits all 5 wire-up points (view, dispatch, header, sidebar, WS/fetch). |
| `worca-ui-card-consistency-reviewer` | After changes to any `*-card.js` view. Audits the 4-section layout, `statusIcon`/`statusClass` usage, and per-domain variant map (no inline `variant="success"`). Spec: `worca-ui/docs/card-layout.md`. |
| `worca-ui-a11y-reviewer` | After non-trivial UI changes (new views, dialogs, form controls, status indicators). Raises the a11y floor on new code without forcing global retrofit. |
| `worca-event-payload-reviewer` | After changes under `src/worca/events/`, `tests/test_event_types.py`, or `worca-ui/server/integrations/renderers.js`. Audits payload consistency, test coverage, and Tier 1 renderer wiring. Spec: `docs/events.md`. |
| `worca-integrations-security-reviewer` | After changes to `src/worca/events/webhook.py`, `worca-ui/server/webhook-inbox.js`, or anything under `worca-ui/server/integrations/`. Audits HMAC handling, timing-safe compare, allowlist enforcement, and secret hygiene. |

### Why the prefix

Skills and subagents in this repo split into two scopes:
- **Pipeline agents** (`src/worca/agents/core/*.md`) — the product. Unprefixed names (`planner`, `coordinator`, etc.) ship to consumer projects via `worca init`.
- **Dev-time tooling** (`.claude/skills/worca-*`, `.claude/agents/worca-*`) — only useful in the worca-cc repo itself. The `worca-` prefix signals scope and groups them in skill/agent lists.

## Configuration

Agent config in `.claude/settings.json` under the `worca` namespace. Key sections:
- `worca.default_template` — optional template id pinned as the project default; every run uses it unless `--template` overrides at launch
- `worca.stages` — enable/disable stages, override agents
- `worca.flow` — declarative pipeline topology: stage order + outcome-driven loop transitions (W-070). Omitted = builtin 9-stage flow, byte-identical to legacy behavior. Custom flows are validated fail-loud at launch and fingerprinted into `status.json` so a paused run never silently resumes under a changed topology. See [`docs/flow.md`](./docs/flow.md).
- `worca.agents` — model, max_turns, effort, and max_beads per agent (coordinator only for max_beads)
- `worca.agents.coordinator.max_beads` — bead decomposition cap: `0` = auto (default, current behavior), `1` = single-bead mandate, `>1` = advisory budget. Enforcement is soft (logs on deviation, run proceeds). Suppressed when PR-revision mode is active (review comments drive bead count). Precedence: per-run `--max-beads` override → template config → `0`. The `quick-fix` template ships with `max_beads: 1` (entire fix as one atomic bead).
- `worca.effort` — auto_mode, auto_cap for adaptive effort levels (see [`docs/effort.md`](./docs/effort.md))
- `worca.models` — shorthand→full model ID mapping (supports per-model env vars)
- `worca.loops` — max iterations for test/review/planning retry loops
- `worca.circuit_breaker` — error classification and halt thresholds
- `worca.governance` — hook guards and dispatch rules (see [`docs/governance.md`](./docs/governance.md) for the full reference)

**Template-driven keys.** When a template is in play at run launch (explicit or via `worca.default_template`), these are stripped from the project-Settings merge base before the template's `config` applies: `worca.agents`, `worca.stages`, `worca.flow`, `worca.loops`, `worca.circuit_breaker`, `worca.effort`, `worca.governance.dispatch`. The template owns them outright. Cross-template keys (`models`, `webhooks`, `pricing`, `governance.guards`, `graphify`, `code_review_graph`, preflight definitions) keep applying. Full precedence reference: [`docs/configuration-precedence.md`](./docs/configuration-precedence.md).

### Model Profiles (`worca.models`)

Entries are either a plain model-ID string or `{id, env}` — the `env` map merges into the subprocess environment when that model runs (alt-endpoint routing, per-stage tuning like `CLAUDE_CODE_MAX_OUTPUT_TOKENS`). Key gotchas:

- **Secrets** belong in `settings.local.json` (gitignored, deep-merged over `settings.json`); the UI Secrets panel writes only there. Never inline secrets in `settings.json`. Worktree runs materialize the parent's secrets into the worktree's gitignored `settings.json`.
- **Reserved keys** matching `WORCA_*`, `PATH`, or `CLAUDECODE` are silently stripped with a stderr warning (denylist shared between `src/worca/utils/env.py` and `worca-ui/server/reserved-env-keys.json`).
- **Cost source per alias:** if an alias's `env` sets `ANTHROPIC_BASE_URL`, worca overrides Claude CLI's `total_cost_usd` from `worca.pricing.models.<alias>`; otherwise the CLI's number is authoritative.

Model refs also support **tier pinning** (`user:alias` / `project:alias` / `builtin:alias`) to bypass alias shadowing between settings tiers — `work_request.py` hard-pins `builtin:haiku` so title generation is deterministic regardless of user/project shadows. Full syntax, bare-alias resolution, import auto-pinning, and precedence: [`docs/configuration-precedence.md`](./docs/configuration-precedence.md).

### Effort Levels (`worca.effort`)

Per-agent reasoning effort (`low | medium | high | xhigh | max`) via `worca.agents.<agent>.effort`; omitted means model default. `worca.effort.auto_mode` defaults to `adaptive`: the coordinator labels each bead's complexity (`worca-effort:<level>`) as the implementer's starting point, and loopbacks escalate effort, capped by `auto_cap` (default `xhigh`). Resolved effort passes through `CLAUDE_CODE_EFFORT_LEVEL` — the only non-interactive way to set `max`. Set `auto_mode: "disabled"` for pre-W-052 behavior. Full reference (modes, model-specific effort ladders): [`docs/effort.md`](./docs/effort.md).

## Code Hosting

This project uses **GitHub** with the `gh` CLI. PR creation command:

```bash
gh pr create --title "..." --body "..."
```

**Merging PRs:** Always use `gh pr merge <number> --merge` (not local `git merge` + push). This ensures GitHub auto-closes the PR and links the merge commit properly.

**Reading issues — always pass `--json`.** This repo has at least one classic-Projects-linked issue, and the default `gh issue view N` (and the unfiltered `gh issue list`) fail on the deprecated `repository.issue.projectCards` GraphQL field:

```
GraphQL: Projects (classic) is being deprecated in favor of the new Projects experience…
(repository.issue.projectCards)
```

Use `--json` with explicit fields to bypass it. Defaults that work:

```bash
gh issue view 119 --json number,title,body,labels,state,assignees,comments
gh issue list --json number,title,labels,state --limit 30
gh issue list --label area:cc --json number,title,labels --limit 30
```

For a human-readable view, post-process with `--jq` (e.g. `--jq '"#\(.number) \(.title)"'`) instead of falling back to the unfiltered command.

**Editing a PR/issue body — use the REST API, not `gh pr edit`.** `gh pr edit <N> --body …` hits the same classic-Projects deprecation (`repository.pullRequest.projectCards`) and **aborts without applying the change** — silently leaving the body unedited. Patch via REST instead (no `projectCards` path):

```bash
python3 -c "import json; print(json.dumps({'body': open('/tmp/body.md').read()}))" > /tmp/patch.json
gh api --method PATCH repos/SinishaDjukic/worca-cc/pulls/<N> --input /tmp/patch.json
# verify: gh pr view <N> --json body --jq .body
```

Build the JSON with `json.dumps` (or `jq`) so backticks/emoji in the body survive shell quoting and JSON escaping. Note: `gh pr merge` and `gh pr view --json …` do *not* trigger this — only the `gh pr edit` mutation does.

The guardian agent uses this when creating PRs. Adapt this section for GitLab (`glab`), Bitbucket, or other hosting platforms.

> Use `/worca-issue` to read/list/create issues — it bakes in the `--json` workaround, the W-NNN-vs-bug title rule, and the required label set. Use `/worca-pr-prep` to run the pre-merge gate.

## Development Approach

This project follows **TDD (Test-Driven Development)**:
1. Write a failing test first
2. Write minimal code to pass
3. Refactor

Implementer agents read this section to determine the testing methodology.

## Linting

```bash
ruff check .                                              # Python lint
cd worca-ui && npm run lint                       # UI lint (biome)
cd worca-ui && npm run lint:fix                   # Auto-fix UI lint issues
```

**CI enforces biome formatting strictly.** Always run `cd worca-ui && npm run lint` before committing any worca-ui changes (JS, server, app). Use `npm run lint:fix` to auto-fix formatting issues. Common biome rules: long ternaries must be split across lines, trailing commas required.

> Use `/worca-dev-precommit` to bundle ruff + biome + vitest + (conditional) playwright + npm-pack check — it picks the right subset based on what changed.

## Testing

```bash
pytest tests/                              # All Python tests
pytest tests/test_<module>.py              # Single module
pytest tests/integration/                  # Pipeline integration tests (uses mock claude)
npx vitest run worca-ui/server/    # UI server tests
cd worca-ui && npx playwright test --workers=1  # Browser e2e tests (must run serially)
```

Test naming: `tests/test_<module>.py` mirrors source module names. To skip a failing test, name it and verify it fails on the parent commit — aggregate dismissals ("pre-existing", "flaky", "unrelated") are not accepted.

**Integration tests** (`tests/integration/`) run the full pipeline with a mock Claude CLI (`tests/mock_claude/mock_claude.py`). They require `pip install -e ".[dev]"` and Unix (signal tests are skipped on Windows). Each test spins up a temp git repo + worca runtime, so they're slower (~30-60s for the full suite).

**Playwright note:** Browser e2e tests must run with `--workers=1` (serial). Parallel workers cause flaky failures due to browser context contamination between isolated test servers.

**Conditional Playwright runs (UI changes).** When the diff between `$WORCA_BASE_BRANCH` and `HEAD` touches any path under `worca-ui/app/` or `worca-ui/server/`, the tester MUST run Playwright in addition to vitest:

```bash
cd worca-ui && npx playwright test --workers=1
# Per-file if you hit port collisions:
cd worca-ui && npx playwright test e2e/<spec>.spec.js --workers=1
```

This closes the feedback loop inside the implementer → tester iteration instead of waiting for out-of-band CI. The per-failure attribution rules above apply: name each failing test, verify against the parent commit, or route the failure back to the implementer.

If the Chromium binary is missing (`npx playwright install chromium` was never run in this environment), state that explicitly in your verdict — do not silently skip the suite.

**Playwright `test.describe() called in unexpected context`.** This is almost always a stale Playwright transform cache — not a bug in your spec — and shows up most often right after rewriting a spec file. Recover with one cache-bust and move on:

```bash
cd worca-ui && rm -rf node_modules/.cache && npx playwright test e2e/<spec>.spec.js --workers=1
```

Do **not** binary-bisect the spec to find the offending block — the file is fine; the cache is stale. And do not try to "reproduce" it by importing the spec outside the test runner (`node -e "import('./e2e/x.spec.js')"`) — running a Playwright spec outside `npx playwright test` *always* throws this exact error, so it is not a signal.

**Coverage runs** (Python) use the centralized runner in `scripts/coverage.py`. `python scripts/coverage.py ci` is the one-shot (erase stale state → pytest under `WORCA_COVERAGE=1` → combine fragments → `coverage-out/coverage.json` + `.xml`); `compare --baseline=… --current=…` diffs per-module deltas; `--include-unit-tests` adds in-process unit coverage (doubles wall time, full baseline only). Key gotcha: `WORCA_COVERAGE=1` enables subprocess-level coverage for integration runs AND auto-disables `pytest-cov` — without that, pytest-cov silently consumes the fragments before `coverage combine` can merge them.

> Use `/worca-coverage` for all common flows — it wraps the runner with the right env vars and subcommands.

## Governance

- Only the **guardian** agent may run `git commit` (enforced by pre_tool_use hook checking `WORCA_AGENT` env var)
- Source file writes are blocked until `MASTER_PLAN.md` exists (plan_check hook, only active when `WORCA_AGENT` is set)
- The post_tool_use hook has a test gate: 2 consecutive pytest failures block further tool calls
- Tool, skill, and subagent dispatch is governed per agent role via `worca.governance.dispatch`

### Dispatch Governance (`worca.governance.dispatch`)

`tools`, `skills`, and `subagents` each follow a three-tier model:

1. **`always_disallowed`** — hard-deny defaults. Shipped from `_DISPATCH_DEFAULTS` in `tracking.py`; project-editable but rarely should be edited.
2. **`default_denied`** — blocked unless the agent names them in `per_agent_allow`. The `"*"` wildcard does NOT include these.
3. **`per_agent_allow`** — per-agent allow list with `_defaults` fallback. `"*"` means "everything except the deny tiers". `[]` falls through to `_defaults`. `["none"]` is the explicit lockdown sentinel (`LOCKDOWN_SENTINEL`).

MCP tools (`mcp_*`) flow through other channels, not `--tools`. For the full reference — including the shipped denylist contents, mixed-form semantics, the CLI-flag mapping for `tools`, and the resolution algorithm — see [`docs/governance.md`](./docs/governance.md). Dispatch the `worca-dispatch-governance-reviewer` subagent after changes here.

## Events & Webhooks

worca emits ~80 event types across `pipeline.*`, `control.*`, `fleet.*`, and `workspace.*` domains. The full reference lives in [`docs/events.md`](./docs/events.md) — start there before adding a new event type, configuring a webhook subscriber, or writing an integrations adapter. Subscribers can register webhooks (`worca.webhooks` in settings.json, with optional HMAC signing and control-response support) or chat adapters (Telegram, Discord, Slack, generic — configured at `~/.worca/integrations/config.json`).

When adding a new event, use `/worca-event-add` to scaffold the constant, payload builder, test, and (if Tier 1) the chat renderer in one pass. To test a webhook config without running a pipeline, use `/worca-webhook-test`. The `worca-event-payload-reviewer` and `worca-integrations-security-reviewer` subagents audit changes for consistency and security correctness.

## Guide Precedence

When a pipeline run includes a `--guide` file, the guide is injected into the work request under a `## Reference Guide (normative)` header by `attach_guide()` in `work_request.py`. All agents must treat it as the highest-authority source:

**Authority order: guide > plan > description**

- The **guide** is normative — it overrides everything else. It typically carries a migration spec, RFC, or compliance requirement.
- The **plan** is derived from the guide and description. If it diverges from the guide, the guide wins.
- The **description** is task scope. Conflicts with the guide are bugs in the description, not the guide.

Agent behavior when a guide is present:

| Agent | Behavior |
|-------|----------|
| **Planner** | Produces a plan that conforms to the guide. Reports any description-vs-guide conflict rather than silently picking a side. |
| **Reviewer** | Flags any plan instruction that contradicts the guide as a `critical` issue. Surfaces plan-vs-guide divergence explicitly. |
| **Tester** | Flags guide-vs-description conflicts as bug notes in proof artifacts. Does not resolve conflicts — surfaces them. |

See `src/worca/agents/core/planner.md`, `reviewer.md`, and `tester.md` for the per-agent instruction blocks.

## Knowledge Graph (Graphify)

Optional, **off by default** (`worca.graphify.enabled`, project-level). The Preflight stage builds a per-commit code knowledge graph with the [graphify](https://github.com/safishamsi/graphify) CLI, content-addressed under `$WORCA_CACHE/ast/` — nothing is written into the repo tree. Agents query it on demand (a bare `graphify query "<question>"` reads the cached graph via the exported `GRAPHIFY_OUT`); they are never fed the report. Authority order: **guide > plan > graph > description** (the graph is advisory orientation). The `pre_tool_use` hook blocks mutating graphify subcommands and allows reads (`worca.governance.guards.block_graphify_mutation`, default `true`) — the pipeline owns all graph builds.

**Install (only if enabling):** `uv tool install 'graphifyy>=0.8.16,<1'` — the PyPI package is `graphifyy` (double-y); the CLI it installs is `graphify`. Full spec: [`docs/plans/W-053-graphify-integration.md`](./docs/plans/W-053-graphify-integration.md).

## worca-ui Development

**Badge color language:** all `sl-badge` variants and status colors follow the guide in [`worca-ui/docs/badge-color-language.md`](./worca-ui/docs/badge-color-language.md). Read it before adding or modifying badges — blue means active, orange means caution, green means done.

**Card layout:** all card-style views (run, fleet, workspace, worktree) share the `.run-card` base structure documented in [`worca-ui/docs/card-layout.md`](./worca-ui/docs/card-layout.md). New card types must follow the 4-section pattern (top → meta → stages → actions) and route through `statusIcon`/`statusClass` + a per-domain variant map.

**Working directory resets every command.** Under the pipeline, a hook prefixes every Bash command with `cd <project-root>`, so `cd` does **not** persist between commands — each command starts from the repo root, even after a previous `cd worca-ui`. Always combine the directory change with the command (`cd worca-ui && npm run build`) or use absolute paths. A bare `npx playwright …` / `npm run …` issued after an earlier `cd worca-ui` will silently run from the repo root and fail.

**Read the component before writing E2E selectors.** Selectors live in `worca-ui/app/views/*.js` — confirm class names and tag types against the source rather than guessing, then write the test. Two recurring gotchas: the launcher prompt is an `sl-textarea.textarea-fleet-prompt` (not `.input-prompt` / `sl-input`), and the header **Launch** button is a plain `<button class="action-btn action-btn--primary">` (not `sl-button`).

After modifying any source files in `worca-ui/app/`, rebuild the bundle:

```bash
cd worca-ui && npm run build
```

This runs esbuild to produce `app/main.bundle.js`. Without rebuilding, changes won't take effect.

**Before committing any worca-ui changes**, always run lint and tests locally to catch failures before they reach CI:

```bash
cd worca-ui && npm run lint:fix && npx vitest run
```

Run both checks from inside `worca-ui/` so config paths resolve correctly. Do not commit if either fails — fix them first.

**Whenever you add a new file or directory under `worca-ui/server/` or `worca-ui/app/`, verify it ships in the npm package.** The `files` field in `worca-ui/package.json` is an allowlist — anything not matched is silently dropped from the published tarball. The CLI spawns the server with `stdio: 'ignore'`, so a missing-module crash in the published package looks like "started (PID …)" followed by the browser failing to connect — the underlying error is invisible.

Run this before committing any new `server/` or `app/` path:

```bash
cd worca-ui && npm pack --dry-run | grep <new-path>
```

If the new file is absent, extend the `files` glob (e.g. `server/**/*.js` rather than `server/*.js`) and re-check.

> Dispatch `worca-ui-design-reviewer` after non-trivial UI changes — it audits badge color compliance, the lit-html template binding gotcha, and the npm `files` allowlist in one pass.

### Running the UI

```bash
pnpm worca:ui                        # Build + start in global mode (port 3400, default)
pnpm worca:ui:stop                   # Stop the global server
pnpm worca:ui:restart                # Rebuild + restart in global mode
PORT=3401 pnpm worca:ui              # Custom port via env var
pnpm worca:ui -- --port 3401         # Custom port via flag
pnpm worca:ui -- --project /path     # Single-project mode
pnpm worca:ui -- --help              # Show all commands and options
pnpm worca:ui -- --version           # Print version
```

The `--port` flag takes precedence over the `PORT` env var. `HOST` / `--host` works the same way (default `127.0.0.1`).

Global mode (the default) starts the UI without a fixed project root, serving all projects registered in `~/.worca/projects.d/`. Use `--project` to scope to a single project.

**Fleet and workspace grouping requires global mode.** Fleet (`--fleet-id`) and workspace (`--workspace-id`) grouping headers only appear when all member runs are visible across all registered projects. In single-project mode, cross-project siblings are invisible and the UI surfaces an inline notice prompting the user to switch to global mode.

### Worktree cleanup

Each `run_worktree.py` invocation creates a git worktree on disk. Worktrees persist until explicitly removed:

```bash
worca cleanup                    # Interactive: list completed worktrees, prompt to remove
worca cleanup --all              # Remove all completed/failed worktrees without prompting
worca cleanup --run-id <id>      # Remove a specific worktree by run ID
worca cleanup --dry-run          # Preview what would be removed
worca cleanup --older-than 7d   # Remove worktrees started more than 7 days ago
```

Running worktrees are never eligible for cleanup. Use `git worktree list` to see all worktrees.

## Fleet Runs

Fan out a single work-request to N independent projects in parallel via `python .claude/worca/scripts/run_fleet.py --projects <paths> --prompt "..."`. Supports `--guide` (repeatable), `--plan` (shared plan skips child Planner), `--plan-first` (reference-project planning), `--base`/`--head-template` for branch naming, `--max-parallel` (default 5), and a circuit breaker on failure ratio (default 0.30).

Lifecycle actions on an existing fleet_id: `--pause` (paused at next checkpoint), `--stop` (immediate SIGTERM), `--resume` (continues in place or re-dispatches failed children). `--branch` is explicitly rejected — use `--base` + `--head-template`. Worktree cleanup via `worca cleanup --fleet-id <id>`.

Full walkthrough (every flag, halt-vs-pause-vs-stop matrix, circuit breaker semantics, resume behavior): [`docs/fleet-runs.md`](./docs/fleet-runs.md).

## Workspace Runs

Coordinate changes across interdependent projects with dependency-ordered execution via `python .claude/worca/scripts/run_workspace.py <parent-dir> --prompt "..."`. Unlike fleet runs (same prompt to N independent projects), workspace runs decompose one prompt into per-project sub-plans, execute them in DAG tier order, run cross-project integration tests, and create linked PRs with dependency metadata.

A workspace is defined by `workspace.json` in a parent directory listing sibling projects with `depends_on` relationships, an optional `integration_test` command, and an optional `umbrella_repo`. Initialize with `worca workspace init <parent>`. Child pipelines are standard worca runs via `run_worktree.py` — governance, hooks, and stage machinery are unchanged.

Supports `--guide`, `--skip-integration`, `--skip-planning` (each project plans independently), `--workspace-plan PATH` (reuse an existing workspace-plan.json), `--project-plan NAME=PATH` (repeatable, per-repo markdown plans), `--resume`, `--dry-run` (prints the DAG and exits), `--max-parallel` (default 5). Worktree cleanup via `worca cleanup --workspace-id <id>`. See W-056 for planning strategy options — four modes are documented in [`docs/workspace-runs.md` § Planning strategies](./docs/workspace-runs.md#planning-strategies).

Full walkthrough (workspace.json schema, master-planner role, DAG executor + context injection between tiers, integration testing, PR linking with dependency comments, umbrella issue): [`docs/workspace-runs.md`](./docs/workspace-runs.md).

## Platform Support

Linux, macOS, and Windows are all supported targets. worca-ui, the governance hooks, and the Python library are first-class on all three (validated in CI: Windows, macOS, and Ubuntu jobs). The autonomous **pipeline control plane** (pause/stop/resume, orphan reaping, detached worktree/fleet/workspace runs) is POSIX-native; on native Windows it **degrades gracefully — never crashing, never destructive** — but lifecycle is best-effort. **Run the pipeline under WSL2 on Windows** for full fidelity.

Key Windows degradations (all guarded): liveness probes route through `worca.utils.proc.pid_is_alive()` (never `os.kill(pid, 0)`, which would `TerminateProcess`); `SIGTERM` is a hard kill (no graceful handler); process-group reaping falls back to best-effort single-child `terminate()`; `start_new_session` detach is ignored. Full matrix and details: [`docs/platform-support.md`](./docs/platform-support.md).

## Migrating

User-facing upgrade and cleanup steps live in [`MIGRATION.md`](./MIGRATION.md).

## Releasing

Two independent packages release by pushing tags — CI handles publishing. **Never use twine or npm publish manually.**

| Package | Version source | Tag format |
|---|---|---|
| `worca-cc` | `pyproject.toml` + `src/worca/__init__.py` (both must match) | `worca-cc-vX.Y.Z` |
| `@worca/ui` | `worca-ui/package.json` | `worca-ui-vX.Y.Z` |

Use `/worca-release` (stable) or `/worca-rc` (RC) — they handle version bump + commit + tag + push. CI validates tag matches version, builds, tests, and publishes (PyPI via trusted publishing, npm via `NPM_TOKEN`). Releases are independent — a UI fix doesn't require a Python release. Dispatch `worca-release-preflight` first to audit version-file parity, master/CI state, and MIGRATION.md coverage.

## Plans & Roadmap

- Feature tracking lives in **GitHub Issues**: https://github.com/SinishaDjukic/worca-cc/issues
- Labels: `area:cc` / `area:ui` for component, `P0`-`P4` for priority
- When a feature is completed, close the GitHub issue
- Bead-run linking uses labels (`run:{run_id}`), not `external_ref`

### GitHub Issue Structure

Issues use this structure so the pipeline can auto-detect plan files when started with `--source gh:issue:N`:

```markdown
## Problem

## Proposal

## Considerations

## Plan

- [docs/plans/W-NNN-slug.md](https://github.com/SinishaDjukic/worca-cc/blob/master/docs/plans/W-NNN-slug.md)
```

**Key rules:**
- Title — features/refactors: `W-NNN: Short Description`. Bugs: plain descriptive title, no prefix.
- Labels — one of `area:cc` / `area:ui` + one of `P0`-`P4`. Bugs add `bug`.
- The `## Plan` link MUST be an absolute blob URL — the pipeline parses this exact format. Missing/relative link means the pipeline runs the Planner.
- Plan file convention: `docs/plans/W-NNN-short-description.md`. Write per [`docs/plans/_TEMPLATE.md`](./docs/plans/_TEMPLATE.md).
- `W-NNN` is for features/refactors only. Bugs do not get an allocation; if a fix is large enough to need a plan, file it as a refactor with `W-NNN` instead.

Use `/worca-plan-new` to file a new W-NNN end-to-end. After drafting, dispatch `worca-plan-template-reviewer` to audit against the template.
