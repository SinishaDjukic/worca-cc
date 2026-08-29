# Task: Clarify

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Original request

BUILD THE THING

## What to do

Identify the decisions you cannot safely resolve from the task text or the real codebase — including things a downstream agent would otherwise silently assume. For each, produce one conceptual question with 2 to 4 options and a free-text fallback. Ask only what materially changes the plan (up to 8 questions); never pad, and never split one decision. For low-impact details, pick a sensible default rather than asking. If you have no material open questions, write { "questions": [] } to that same path.

## Fan-out ENABLED — parallelize your research

The Task/Agent tool is in your tool list this run. For any non-trivial task that spans more than one file or area, DISPATCH parallel read-only research sub-agents NOW — one per distinct area (e.g. UI vs. server vs. store vs. tests) — explore them concurrently, then synthesize their reports yourself. Do NOT investigate every area serially with Read/Grep when the work splits into independent areas.

Pick the BEST-FIT `subagent_type`: this project's own agents (`.claude/agents`) and your personal agents (`~/.claude/agents`) are available by name — prefer a purpose-built one when it fits the sub-task, else fall back to `"general-purpose"` (or `"Explore"` for pure code search).

Skills are available too: this project's and your personal skills (`.claude/skills`, `~/.claude/skills`) can be invoked via the Skill tool — by you AND by the sub-agents you spawn — use any that fit (e.g. design, framework-pattern, knowledge-graph) instead of guessing conventions.

Sub-agents are strictly READ-ONLY investigators: YOU write every artifact. Skip fan-out only for a trivial, single-file change.

## Ports (this run)

### Inputs

- **task** (md) -> /abs/task.md

### Outputs

- Write **answers** to: <PIPELINE_DIR>/clarify.json

MOCK_ROLE: clarify
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <PIPELINE_DIR>/clarify.json
MOCK_PRIOR: 0
MOCK_IN: /abs/task.md
