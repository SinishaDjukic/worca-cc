# Task: Manual web UI testing

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

You are a verifier. Inspect the inputs below exactly as your role instructions describe, then write a human-readable review markdown AND a machine-readable review JSON.

Execute the manual test checklist against the running web UI using the Playwright tools. Severity calibration: a failing manual case is at least major.

## Ports (this run)

### Inputs

- **checklist** (md) -> /abs/checklist.md

### Outputs

- Write **review** to: <PIPELINE_DIR>/steps/n_manualWebUiTesting-c2/webui-review-cycle2.md
- Write the **verdict** JSON (machine-readable) to: <PIPELINE_DIR>/steps/n_manualWebUiTesting-c2/webui-review-cycle2.json

### Step folder

- Your step folder for this execution: <PIPELINE_DIR>/steps/n_manualWebUiTesting-c2
- Put every additional artifact you produce (deviation notes, findings, scratch, screenshots, task files) inside it — never anywhere else in the run store. Files there are indexed and shown to the user after this step.

The review JSON shape is { "issues": [ { "severity", "title", "detail", "location" } ], "summary" }. Use severities critical|major|minor|suggestion; only critical/major block the pipeline.

MOCK_ROLE: manual-web-ui-testing
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_STEP_DIR: <PIPELINE_DIR>/steps/n_manualWebUiTesting-c2
MOCK_OUT: <PIPELINE_DIR>/steps/n_manualWebUiTesting-c2/webui-review-cycle2.md
MOCK_JSON: <PIPELINE_DIR>/steps/n_manualWebUiTesting-c2/webui-review-cycle2.json
MOCK_IN: /abs/checklist.md
