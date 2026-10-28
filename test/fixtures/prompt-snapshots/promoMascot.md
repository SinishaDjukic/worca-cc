# Task: Promo: mascot

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

You are a pipeline agent. Read every input below, do your job exactly as your role instructions describe, and write EVERY declared output to its exact path.

Skip with a one-line report when mascots are off. Otherwise re-skin the kit base rig (promo-kit/film/mascot.js) into promo/film/mascot.js: from the attached image, or designed for the product; no arms or hands, props on the nose tip; check it on a contact sheet. Pipeline directory: <PIPELINE_DIR>

## Ports (this run)

### Inputs

- **answers** (json) -> /abs/answers.json (the clarifying questions and the answers already given)
- **storyboard** (md) -> /abs/storyboard.md

### Outputs

- Write **mascot** to: <PIPELINE_DIR>/promo-mascot.md

## Clarifications already answered

_No clarifying questions were asked._

MOCK_ROLE: generic-producer
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <PIPELINE_DIR>/promo-mascot.md
MOCK_IN: /abs/answers.json
