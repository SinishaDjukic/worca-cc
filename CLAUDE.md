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

5 agents: Planner (Opus) → Coordinator (Opus) → Implementer(s) (Sonnet) → Tester (Sonnet) → Guardian (Opus)

All governance enforced via Python hooks in `.claude/hooks/`.

## Configuration

Agent config in `.claude/settings.json` under the `worca` namespace.

## Testing

```bash
pytest tests/ -v
npx vitest run .claude/worca-ui/server/  # UI server tests
```

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
