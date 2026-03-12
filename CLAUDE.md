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

- All feature plans go in `docs/plans/` with the naming convention `W-NNN-short-description.md`
- When creating a plan, assign the next available W- number (check `docs/IDEAS.md` Appendix A for the latest)
- After creating a plan file, update `docs/IDEAS.md`:
  1. Add a section under the appropriate category (cc or ui) with Status, Problem, Proposal, and Plan link
  2. Add a row to **Appendix A** (Prioritized Feature Table)
  3. Add a row to **Appendix B** (Plan Files)
- When a feature is completed, update its Status to `Done` in both the section and Appendix A
- Bead-run linking uses labels (`run:{run_id}`), not `external_ref`
