# worca-cc

Autonomous software development pipeline combining orchestration with governance enforcement.

## Quick Start

```bash
# Copy .claude/ folder to your target project
cp -R .claude/ my-project/.claude/

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
- Detailed implementation plans live in `docs/plans/` with the naming convention `W-NNN-short-description.md`
- When creating a new feature, create a GitHub issue with the `W-NNN` prefix in the title, appropriate labels, and link to the plan file
- When a feature is completed, close the GitHub issue
- Bead-run linking uses labels (`run:{run_id}`), not `external_ref`
