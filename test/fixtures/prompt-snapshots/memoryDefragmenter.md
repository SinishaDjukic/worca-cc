# Task: Memory defragment

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

You are a pipeline agent. Read every input below, do your job exactly as your role instructions describe, and write EVERY declared output to its exact path.

Mode: task

Defragment the memory scope named below. Work only inside the memory directory your system prompt names (the `## Worca memory` block) — it sits outside the project checkout, in the run's own memory directory; the copy under the cwd's `.claude/rules/worca/` is read-only, so never write there. Never touch anything in the project directory.

task: /abs/task.md

## Ports (this run)

### Inputs

- **task** (md) -> /abs/task.md

### Outputs

- Write **report** to: <PIPELINE_DIR>/defrag-report.md

MOCK_ROLE: memory-defrag
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <PIPELINE_DIR>/defrag-report.md
MOCK_IN: /abs/task.md
