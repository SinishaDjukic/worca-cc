---
name: readiness-generate-claude-dir-refused
description: Read before ANY unattended worca run (planner, implementer, AI-readiness Generate) plans or makes a write under .claude/ (skills, rules, agents, settings), even
paths: .claude/**, CLAUDE.md, AGENTS.md
updated: 2026-10-21T15:14:17.557Z
author: Bulibas
---

In unattended worca runs the host refuses EVERY Write or Edit under `.claude/`:
- AI-readiness Generate (seen 2026-10-07, run 607cdf50): `.claude/rules/*.md` ("sensitive file") and
  `.claude/skills/<name>/SKILL.md` ("you haven't granted it yet"). Root files (`CLAUDE.md`, `AGENTS.md`),
  `.cursor/rules/*.mdc` and `.github/copilot-instructions.md` were written fine.
- An implementer (seen 2026-10-21, #540): an Edit of the TRACKED plugin-author skill
  `.claude/skills/creating-worca-cc-plugins/SKILL.md` was refused the same way ("you haven't granted it yet").
  A plan whose docs step lists a `.claude/` file therefore cannot finish that step unattended. Say so in the plan,
  and have the implementer put the exact stale lines and their replacement text in DEVIATIONS.md for a human.

Do not retry `.claude/` writes or route them through a shell command. For readiness, plan from the start to fold
skills, agent roles and rules into a "Key workflows" and "Rules" section of `CLAUDE.md` and the multi-tool files,
and list each `.claude/` target under `skipped` with "write refused by host".

Also: `.claude/rules/worca/` holds a self-ignoring `.gitignore` (`*`), so committed project rules must live directly
under `.claude/rules/`, never inside `worca/`. And the map's `add-run-engine` anchors (`src/core/engines/**`, codex
sites) do not exist on `dev` at f039a128: the run memory rule `adding-a-run-engine` comes from another branch.
