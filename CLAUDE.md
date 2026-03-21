# worca-cc

Autonomous software development pipeline combining orchestration with governance enforcement.

## Quick Start

```bash
# Copy .claude/ folder to your target project
cp -R .claude/ my-project/.claude/

# Build the UI (required on first setup)
cd my-project/.claude/worca-ui && npm install && npm run build && cd -

# Interactive mode
cd my-project && claude

# Autonomous mode
python .claude/scripts/run_pipeline.py --prompt "Add user auth"
```

## Architecture

6 stages: Preflight → Planner (Opus) → Coordinator (Opus) → Implementer(s) (Sonnet) → Tester (Sonnet) → Guardian (Opus)

All governance enforced via Python hooks in `.claude/hooks/`.

## Project Structure

```
.claude/
  agents/core/           # Agent .md templates (planner, coordinator, implementer, tester, guardian)
  hooks/                 # Python hook scripts (pre_tool_use, post_tool_use, etc.)
  scripts/               # Pipeline entry points (run_pipeline.py, preflight_checks.py)
  settings.json          # All pipeline config under the "worca" key
  worca/
    orchestrator/
      runner.py          # Main pipeline state machine and stage loop
      stages.py          # Stage enum, STAGE_ORDER, transitions, config readers
      prompt_builder.py  # Per-stage prompt construction
      error_classifier.py # LLM error classification + circuit breaker
      resume.py          # Resume point detection
      work_request.py    # Input normalization (gh issues, beads, prompts)
    state/
      status.py          # Status JSON read/write, iteration tracking
    utils/
      claude_cli.py      # Claude subprocess management
      beads.py           # Beads CLI wrapper
      gh_issues.py       # GitHub issue lifecycle
      git.py             # Git operations
      env.py             # PATH enrichment
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

## Testing

```bash
pytest tests/                              # All Python tests
pytest tests/test_<module>.py              # Single module
npx vitest run .claude/worca-ui/server/    # UI server tests
```

Test naming: `tests/test_<module>.py` mirrors source module names. Pre-existing failures in unrelated tests should be ignored — only verify tests relevant to your changes.

## Governance

- Only the **guardian** agent may run `git commit` (enforced by pre_tool_use hook checking `WORCA_AGENT` env var)
- Source file writes are blocked until `MASTER_PLAN.md` exists (plan_check hook)
- The post_tool_use hook has a test gate: 2 consecutive pytest failures block further tool calls
- Subagent dispatch is restricted per agent role (tracking hook)

## worca-ui Development

After modifying any source files in `.claude/worca-ui/app/`, rebuild the bundle:

```bash
cd .claude/worca-ui && npm run build
```

This runs esbuild to produce `app/main.bundle.js`. Without rebuilding, changes won't take effect.

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

- [W-NNN-short-description.md](docs/plans/W-NNN-short-description.md)
```

**Key rules:**
- Title format: `W-NNN: Short Description`
- Labels: one of `area:cc` / `area:ui` + one of `P0`-`P4`
- The `## Plan` section must contain a markdown link to `docs/plans/*.md` — the pipeline parses this link and skips the PLAN stage when the file exists
- If no plan link is present, the pipeline runs the Planner to generate one
- Plan files use the naming convention `W-NNN-short-description.md` in `docs/plans/`
