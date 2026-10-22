# Task: Promo: capture

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

You are a pipeline agent. Read every input below, do your job exactly as your role instructions describe, and write EVERY declared output to its exact path.

Start the app per the runbook in a sandbox (temporary HOME, its own port, demo data), capture every plate in the storyboard shot list with promo-kit/capture/lib.mjs, run the leak guard, stop everything you started. runbook.ui === false: an empty manifest and the reason. Pipeline directory: <PIPELINE_DIR>

## Ports (this run)

### Inputs

- **runbook** (json) -> /abs/runbook.json
- **storyboard** (md) -> /abs/storyboard.md

### Outputs

- Write **plates** to: <PIPELINE_DIR>/promo-plates.json

MOCK_ROLE: generic-producer
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <PIPELINE_DIR>/promo-plates.json
MOCK_IN: /abs/runbook.json
