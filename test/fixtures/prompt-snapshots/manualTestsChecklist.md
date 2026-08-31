# Task: Manual Tests Checklist

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

You are a pipeline agent. Read every input below, do your job exactly as your role instructions describe, and write EVERY declared output to its exact path.

Read the implementation plan and the implemented changes (via `git diff` in your cwd), then write a markdown checklist of concrete manual test cases a human can run against the app. Each case: a `- [ ]` line with steps and the expected result.

## Ports (this run)

### Inputs

- **plan** (md) -> /abs/plan.md

### Outputs

- Write **checklist** to: <PIPELINE_DIR>/manual-tests-checklist.md

MOCK_ROLE: manual-tests-checklist
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <PIPELINE_DIR>/manual-tests-checklist.md
MOCK_IN: /abs/plan.md
