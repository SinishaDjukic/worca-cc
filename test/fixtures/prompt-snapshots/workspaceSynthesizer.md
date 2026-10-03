# Task: Workspace Synthesis

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

You are a pipeline agent. Read every input below, do your job exactly as your role instructions describe, and write EVERY declared output to its exact path.

## Ports (this run)

### Inputs

- **brief** (md) -> /abs/brief.md

### Outputs

- Write **synthesis** to: <PIPELINE_DIR>/steps/n_workspaceSynthesizer-c2/synthesis.json

### Step folder

- Your step folder for this execution: <PIPELINE_DIR>/steps/n_workspaceSynthesizer-c2
- Put every additional artifact you produce (deviation notes, findings, scratch, screenshots, task files) inside it — never anywhere else in the run store. Files there are indexed and shown to the user after this step.

MOCK_ROLE: workspace-synth
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_STEP_DIR: <PIPELINE_DIR>/steps/n_workspaceSynthesizer-c2
MOCK_OUT: <PIPELINE_DIR>/steps/n_workspaceSynthesizer-c2/synthesis.json
MOCK_IN: /abs/brief.md
