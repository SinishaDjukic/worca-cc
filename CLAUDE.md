# worca-cc

Autonomous software development pipeline combining orchestration with governance enforcement.

## Quick Start

```bash
# Install via /worca-install skill (recommended)
cd worca-cc && claude
# Then type: /worca-install /path/to/my-project

# Or manually copy .claude/ folder
cp -R .claude/ my-project/.claude/
cd my-project/.claude/worca-ui && npm install && npm run build && cd -

# Interactive mode
cd my-project && claude

# Autonomous mode
python .claude/scripts/run_pipeline.py --prompt "Add user auth"
```

## Architecture

9 stages: Preflight → Planner (Opus) → Plan Reviewer (Opus) → Coordinator (Opus) → Implementer(s) (Sonnet) → Tester (Sonnet) → Guardian (Opus) → Learner (Sonnet)

Plan Review and Learn are disabled by default; enable via `worca.stages.plan_review.enabled` / `worca.stages.learn.enabled` in settings.json.

All governance enforced via Python hooks in `.claude/hooks/`.

## Project Structure

```
.claude/
  agents/core/           # Agent .md templates (planner, plan_reviewer, coordinator, implementer, tester, guardian, learner)
  hooks/                 # Python hook scripts (pre_tool_use, post_tool_use, etc.)
  scripts/               # Pipeline entry points (run_pipeline.py, run_multi.py, preflight_checks.py)
  settings.json          # All pipeline config under the "worca" key
  worca/
    orchestrator/
      runner.py          # Main pipeline state machine and stage loop
      stages.py          # Stage enum, STAGE_ORDER, transitions, config readers
      prompt_builder.py  # Per-stage prompt construction
      error_classifier.py # LLM error classification + circuit breaker
      resume.py          # Resume point detection
      work_request.py    # Input normalization (gh issues, beads, prompts)
      registry.py        # Parallel pipeline registry (directory-based tracking)
    state/
      status.py          # Status JSON read/write, iteration tracking
    utils/
      claude_cli.py      # Claude subprocess management
      beads.py           # Beads CLI wrapper
      gh_issues.py       # GitHub issue lifecycle
      git.py             # Git operations
      env.py             # PATH enrichment
      project_registry.py # Auto-register projects in ~/.worca/projects.d/
    schemas/             # JSON schemas for structured agent output
  worca-ui/              # Web UI (lit-html + Shoelace + esbuild)
    app/                 # Source files (views/, utils/, styles.css, main.js)
    server/              # Express API server
tests/                   # Python tests (pytest)
docs/plans/              # Feature plans (W-NNN-slug.md)
```

## Configuration

Agent config in `.claude/settings.json` under the `worca` namespace. Key sections:
- `worca.stages` — enable/disable stages, override agents
- `worca.agents` — model and max_turns per agent
- `worca.models` — shorthand→full model ID mapping
- `worca.loops` — max iterations for test/review/planning retry loops
- `worca.circuit_breaker` — error classification and halt thresholds
- `worca.governance` — hook guards and dispatch rules

## Code Hosting

This project uses **GitHub** with the `gh` CLI. PR creation command:

```bash
gh pr create --title "..." --body "..."
```

The guardian agent uses this when creating PRs. Adapt this section for GitLab (`glab`), Bitbucket, or other hosting platforms.

## Development Approach

This project follows **TDD (Test-Driven Development)**:
1. Write a failing test first
2. Write minimal code to pass
3. Refactor

Implementer agents read this section to determine the testing methodology.

## Linting

```bash
ruff check .                                              # Python lint
cd .claude/worca-ui && npm run lint                       # UI lint (biome)
cd .claude/worca-ui && npm run lint:fix                   # Auto-fix UI lint issues
```

## Testing

```bash
pytest tests/                              # All Python tests
pytest tests/test_<module>.py              # Single module
npx vitest run .claude/worca-ui/server/    # UI server tests
cd .claude/worca-ui && npx playwright test --workers=1  # Browser e2e tests (must run serially)
```

Test naming: `tests/test_<module>.py` mirrors source module names. Pre-existing failures in unrelated tests should be ignored — only verify tests relevant to your changes.

**Playwright note:** Browser e2e tests must run with `--workers=1` (serial). Parallel workers cause flaky failures due to browser context contamination between isolated test servers.

## Governance

- Only the **guardian** agent may run `git commit` (enforced by pre_tool_use hook checking `WORCA_AGENT` env var)
- Source file writes are blocked until `MASTER_PLAN.md` exists (plan_check hook, only active when `WORCA_AGENT` is set)
- The post_tool_use hook has a test gate: 2 consecutive pytest failures block further tool calls
- Subagent dispatch is restricted per agent role (tracking hook)

## worca-ui Development

After modifying any source files in `.claude/worca-ui/app/`, rebuild the bundle:

```bash
cd .claude/worca-ui && npm run build
```

This runs esbuild to produce `app/main.bundle.js`. Without rebuilding, changes won't take effect.

### Running the UI

```bash
pnpm worca:ui                        # Build + start in global mode (port 3400)
pnpm worca:ui:stop                   # Stop the global server
pnpm worca:ui:restart                # Rebuild + restart in global mode
PORT=3401 pnpm worca:ui              # Custom port via env var
pnpm worca:ui -- --port 3401         # Custom port via flag
```

The `--port` flag takes precedence over the `PORT` env var. `HOST` / `--host` works the same way (default `127.0.0.1`).

Global mode (`--global`) starts the UI without a fixed project root, serving all projects registered in `~/.worca/projects.d/`. Use this when monitoring multiple projects from a single browser tab.

## Plans & Roadmap

- Feature tracking lives in **GitHub Issues**: https://github.com/SinishaDjukic/worca-cc/issues
- Labels: `area:cc` / `area:ui` for component, `P0`-`P4` for priority
- When a feature is completed, close the GitHub issue
- Bead-run linking uses labels (`run:{run_id}`), not `external_ref`

### GitHub Issue Structure

Issues must follow this structure so the pipeline can auto-detect plan files when started with `--source gh:issue:N`:

```markdown
## Problem

<What's wrong or missing — 2-5 sentences>

## Proposal

<What to build and how — bullet points or short paragraphs>

## Considerations

<Trade-offs, edge cases, dependencies — optional>

## Plan

- [docs/plans/W-NNN-short-description.md](https://github.com/SinishaDjukic/worca-cc/blob/master/docs/plans/W-NNN-short-description.md)
```

**Key rules:**
- Title format: `W-NNN: Short Description`
- Labels: one of `area:cc` / `area:ui` + one of `P0`-`P4`
- The `## Plan` section must contain a markdown link to `docs/plans/*.md` using an absolute blob URL (e.g. `https://github.com/SinishaDjukic/worca-cc/blob/main/docs/plans/W-NNN.md`) — the pipeline parses this link and skips the PLAN stage when the file exists
- If no plan link is present, the pipeline runs the Planner to generate one
- Plan files use the naming convention `W-NNN-short-description.md` in `docs/plans/`
