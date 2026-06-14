---
title: Customizing dispatch governance
description: Control which tools, skills, and subagents each agent may invoke — from the chip-based editor in the Pipeline Templates Governance tab.
sidebar:
  order: 10
---

Beyond the always-on safety hooks described in [Governance](/concepts/governance/), worca lets you control exactly which **tools**, **skills**, and **subagents** each pipeline agent may dispatch. The whole model is editable from the dashboard.

## Edit it in the template

Dispatch governance lives on each pipeline template's **Governance** tab. Open the [Pipeline Templates](/configuration/pipeline-templates/) editor, pick the template you're customizing, and scroll past Test Gate and Plan Review Enforcement to reach **Governance Dispatch** — one section per dispatch domain (**Tools**, **Skills**, **Subagents**), each with the same three-tier structure:

![The Governance Dispatch overview at the top of the Tools section: a description paragraph, then a Tools card with three tier-labeled chip rows — Always Disallowed (chips: EnterPlanMode, EnterWorktree, TodoWrite), an empty Default Denied input, and the first Per-Agent Allow rows (_defaults, Planner, Plan_reviewer, Coordinator) each with an `any` chip.](/screenshots/dispatch-governance/03-tools-tiers.png)

The run-detail view then shows each iteration's actual dispatch decisions as allow (green) / deny (red) badges, so you can confirm a change took effect.

The rest of this page explains the model the chip editor writes to — useful for understanding precedence or when you're scripting `settings.json` directly.

## The three tiers

Each section (`tools`, `skills`, `subagents`) has the same structure:

| Tier | Meaning |
|---|---|
| **Always Disallowed** | Hard deny. Editable, but rarely should be — these are footguns no agent should invoke. |
| **Default Denied** | Blocked **unless** an agent names it in Per-Agent Allow. The `any` wildcard does *not* include these. |
| **Per-Agent Allow** | Per-agent allow list, with a `_defaults` fallback row. |

The chip colours in the editor reinforce the tiers — gray for the locked Always Disallowed list, amber for the Default Denied opt-in tier, blue for per-agent allowances.

## Resolution

For a given `(section, agent, candidate)`:

1. Matches Always Disallowed? → **deny**.
2. Look up Per-Agent Allow for the agent, falling back to `_defaults`.
3. If the row has `any` (wildcard): allow anything not in Default Denied (a name listed explicitly opts in past Default Denied).
4. If the row has no `any`: allow only names listed explicitly; deny the rest.

Interactive sessions (no `WORCA_AGENT` set) are never gated — this only applies to pipeline agents.

## Examples — read the chip rows

A picture worth several JSON examples. The Skills section below shows three patterns at once — and these are all just chip-add operations in the editor:

![The Skills dispatch card: Always Disallowed chip list (batch, fewer-permission-prompts, loop, schedule, worca-release, worca-rc, worca-pr-prep, worca-install, worca-sync, worca-sync-commit, worca-sync-pr, worca-agent-override, worca-analyze, worca-plan-new, update-config, hookify:hookify, hookify:configure, hookify:list, hookify:writing-rules, init). Default Denied chips: claude-api, debug, review, security-review, simplify, feature-dev:feature-dev, claude-md-management:revise-claude-md, claude-md-management:claude-md-improver. Per-Agent Allow rows: _defaults (empty), Planner (any), Plan_reviewer (any), Coordinator (any), Implementer (any · simplify · claude-api), Tester (any · debug), Reviewer (any · review · security-review).](/screenshots/dispatch-governance/02-skills-chips.png)

What each row says:

- **`_defaults`** (empty) → any agent without an explicit row inherits the fallback. Empty means "use the implicit `any`."
- **Planner / Plan_reviewer / Coordinator** all have just the `any` chip → wildcard, anything allowed except the deny tiers.
- **Implementer** has `any · simplify · claude-api` → wildcard *plus* an explicit opt-in to two skills from the Default Denied tier. That's how you grant a normally-blocked skill to one agent — add a chip with that name to its row.
- **Tester** has `any · debug` → same pattern: wildcard plus opt-in to the `debug` skill.
- **Reviewer** has `any · review · security-review` → exactly the "let the reviewer use the `review` skill" example: add the `review` chip to the Reviewer row.

To **lock an agent out** of a section entirely, replace its row with a single `none` chip (the explicit lockdown sentinel). To **restrict to a named subset** (e.g. give the Reviewer only `Read` and `Grep`), remove the `any` chip and add only the names you want. A named tool list auto-includes `Skill` and `Agent` so worca's own skill/subagent governance still fires.

## What `--tools` does and doesn't cover

The Tools section maps to the agent subprocess's `--tools` / `--disallowedTools` flags, which restrict only the **built-in** tool set. **MCP tools (`mcp_*`) are not covered** — they flow through separate channels and a named tool allowlist won't block them.

:::tip
The full default configuration and the complete resolution algorithm are documented in [`docs/governance.md`](https://github.com/SinishaDjukic/worca-cc/blob/master/docs/governance.md) in the source repository.
:::
