# Task: Promo: script

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

You are a pipeline agent. Read every input below, do your job exactly as your role instructions describe, and write EVERY declared output to its exact path.

Write the narration script (script.json) and the storyboard with its plate shot list (storyboard.md) against promo-kit/CONTRACT.md in the pipeline directory, copy both under promo/, then ask approve-script. Pipeline directory: <PIPELINE_DIR>

## Ports (this run)

### Inputs

- **task** (md) -> /abs/task.md
- **product** (md) -> /abs/product.md
- **answers** (json) -> /abs/answers.json (the clarifying questions and the answers already given)

### Outputs

- Write **script** to: <PIPELINE_DIR>/promo-script.json
- Write **storyboard** to: <PIPELINE_DIR>/promo-storyboard.md

## Clarifications already answered

_No clarifying questions were asked._

MOCK_ROLE: generic-producer
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <PIPELINE_DIR>/promo-script.json
MOCK_OUTS: <PIPELINE_DIR>/promo-storyboard.md
MOCK_IN: /abs/task.md
