# Task: Implementation

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

You are a pipeline agent. Read every input below, do your job exactly as your role instructions describe, and write EVERY declared output to its exact path.

Work inside the project directory (your cwd). Commit nothing; just edit files and tests.

Mode: plan

Implement the plan using TDD (red-green-refactor). Follow it with NO deviation; deviate slightly only if a step does not work at all.

plan: /abs/plan.md

## Fan-out ENABLED — parallelize your research

The Task/Agent tool is in your tool list this run. For any non-trivial task that spans more than one file or area, DISPATCH parallel read-only research sub-agents NOW — one per distinct area (e.g. UI vs. server vs. store vs. tests) — explore them concurrently, then synthesize their reports yourself. Do NOT investigate every area serially with Read/Grep when the work splits into independent areas.

Pick the BEST-FIT `subagent_type`: this project's own agents (`.claude/agents`) and your personal agents (`~/.claude/agents`) are available by name — prefer a purpose-built one when it fits the sub-task, else fall back to `"general-purpose"` (or `"Explore"` for pure code search).

Skills are available too: this project's and your personal skills (`.claude/skills`, `~/.claude/skills`) can be invoked via the Skill tool — by you AND by the sub-agents you spawn — use any that fit (e.g. design, framework-pattern, knowledge-graph) instead of guessing conventions.

Sub-agents are strictly READ-ONLY investigators: YOU write every artifact. Skip fan-out only for a trivial, single-file change.

## Ports (this run)

### Inputs

- **plan** (md) -> /abs/plan.md

### Outputs

- (none — report your findings as your final message)

MOCK_ROLE: implementer
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_IN: /abs/plan.md
