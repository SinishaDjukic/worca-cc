# Task: Refine Plan

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Original request

BUILD THE THING

## What to do

You are a pipeline agent. Read every input below, do your job exactly as your role instructions describe, and write EVERY declared output to its exact path.

Read the current plan, critically review it INCLUDING its code snippets, then write an improved version and a machine-readable review.

Mark a finding critical/major only if it must be fixed before implementation.

## Fan-out ENABLED — parallelize your research

The Task/Agent tool is in your tool list this run. For any non-trivial task that spans more than one file or area, DISPATCH parallel read-only research sub-agents NOW — one per distinct area (e.g. UI vs. server vs. store vs. tests) — explore them concurrently, then synthesize their reports yourself. Do NOT investigate every area serially with Read/Grep when the work splits into independent areas.

Pick the BEST-FIT `subagent_type`: this project's own agents (`.claude/agents`) and your personal agents (`~/.claude/agents`) are available by name — prefer a purpose-built one when it fits the sub-task, else fall back to `"general-purpose"` (or `"Explore"` for pure code search).

Skills are available too: this project's and your personal skills (`.claude/skills`, `~/.claude/skills`) can be invoked via the Skill tool — by you AND by the sub-agents you spawn — use any that fit (e.g. design, framework-pattern, knowledge-graph) instead of guessing conventions.

Sub-agents are strictly READ-ONLY investigators: YOU write every artifact. Skip fan-out only for a trivial, single-file change.

### Sub-agent model — YOUR call, per spawn

The operator has asked you to choose each sub-agent's model deliberately: pass `model` on EVERY Task/Agent call — this instruction is that request (the tool's usual "only when explicitly asked" caveat is satisfied here). Never omit the parameter: an agent definition may pin its own default, so an omitted `model` lands wherever that definition says, not where you intend. Legal values: `sonnet`, `opus`, `fable`.

Choose on WHO CHECKS THE OUTPUT, never on how small or cheap the sub-task looks:
- `sonnet`: mechanical, bounded investigation whose findings the report itself lets you verify — grep-and-summarize a known pattern, enumerate usages or call sites, extract or reformat existing content, confirm what a file plainly states.
- `opus`: investigation needing real codebase judgment you will build on — trace why something fails, map how a subsystem hangs together, weigh where a change belongs.
- `fable`: analysis whose VERDICT the run depends on and nothing downstream re-checks — a severity call, a design or plan judgement, an accept/reject recommendation.

When unsure between two tiers, take the lower one only if you will verify the result yourself.

## Ports (this run)

### Inputs

- **plan** (md) -> /abs/plan.md

### Outputs

- Write **plan** (also **revise**) to: <WORCA_HOME>/store/<STORE_KEY>/plans/01-01-26-feature.md
- Write the **verdict** JSON (machine-readable) to: <PIPELINE_DIR>/refine-review-cycle2.json

The review JSON shape is { "issues": [ { "severity", "title", "detail", "location" } ], "summary" }. Use severities critical|major|minor|suggestion; only critical/major block the pipeline.

MOCK_ROLE: refiner
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <WORCA_HOME>/store/<STORE_KEY>/plans/01-01-26-feature.md
MOCK_JSON: <PIPELINE_DIR>/refine-review-cycle2.json
MOCK_IN: /abs/plan.md
