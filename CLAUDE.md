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
```
