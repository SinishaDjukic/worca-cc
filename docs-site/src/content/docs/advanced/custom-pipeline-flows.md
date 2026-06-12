---
title: Custom pipeline flows
description: Reorder stages, add your own, and wire stage outputs into downstream prompts — the pipeline's topology, stages, and data flow are declared contracts.
sidebar:
  order: 8.5
---

The nine-stage pipeline described in [The pipeline & stages](/concepts/the-pipeline-and-stages/) is the *default* flow, not a hardcoded one. The pipeline is three independent, declared contracts — each validated when a run launches, never mid-run:

| Contract | What it governs | Where you declare it |
|---|---|---|
| **Topology** | What runs, in what order, with which loops | `worca.flow` stage list + `on:` transitions |
| **Execution** | What a stage *is* | Builtin stage names keep their behavior; any other name runs your agent |
| **Data** | What flows between stages | `outputs` declarations + `{{stages.<stage>.<output>}}` placeholders |

With no `worca.flow` configured, behavior is byte-identical to the classic pipeline. Everything on this page is opt-in.

## The flow document

`worca.flow` lives in `settings.json` (or a [pipeline template's](/concepts/pipeline-templates/) `config` — it's a template-owned key). The document below *is* the builtin default:

```json
{
  "worca": {
    "flow": {
      "version": 1,
      "stages": [
        { "name": "preflight" },
        { "name": "plan" },
        { "name": "plan_review", "enabled": false,
          "on": { "plan_review_revise": { "goto": "plan", "loop": "plan_review" } } },
        { "name": "coordinate" },
        { "name": "implement",
          "on": { "next_bead": { "goto": "implement", "loop": "bead_iteration" } } },
        { "name": "test",
          "on": { "test_failure": { "goto": "implement", "loop": "implement_test" } } },
        { "name": "review",
          "on": { "review_changes": { "goto": "implement", "loop": "pr_changes" },
                  "restart_planning": { "goto": "plan", "loop": "restart_planning" } } },
        { "name": "pr" },
        { "name": "learn", "enabled": false, "post": true }
      ]
    }
  }
}
```

Stage order is the list order; `on:` maps outcome **triggers** to jumps. Removing a transition means the trigger logs and the run advances instead of looping. The rules, all enforced at launch:

- **Backward or self jumps need a `loop` key** — unbounded cycles are rejected. Limits come from `worca.loops.<key>` (default 5).
- **`goto` must target an enabled, non-post stage.** Post stages (Learn) run after the pipeline ends and can't be jump targets.
- A malformed flow — unknown keys, missing files, a typo'd target — **fails the launch with a precise error**, never mid-run.
- Custom flows are **fingerprinted**: a paused run refuses to resume if the flow changed underneath it.

## Adding your own stage

Any stage name outside the builtin set runs your agent under the generic stage executor. Adding a stage is three files and one flow entry — no Python:

```text
.claude/
  agents/
    docs_auditor.md        # the agent prompt
    docs_audit.block.md    # optional: the per-run user message
  schemas/
    docs_audit.json        # structured-output schema
  settings.json            # worca.flow gains the entry below
```

```json
{ "name": "docs_audit", "agent": "docs_auditor", "schema": "docs_audit.json",
  "on": { "needs_rework": { "goto": "implement", "loop": "docs_rework" } } }
```

The schema's `outcome` enum drives what happens next:

| Agent's `outcome` | What the pipeline does |
|---|---|
| missing / `"success"` | advance to the next stage |
| declared in the stage's `on:` map | the outcome **is** the trigger — jump per the flow, consuming the loop's budget |
| `"reject"` | the run fails through the normal failure path |

Launch validation cross-checks the enum against your declared triggers, so an outcome the agent could never produce is caught before any tokens are spent.

:::caution[Custom agents start locked down]
A custom agent gets **no tools, skills, or subagents** until you grant them in `worca.governance.dispatch.<section>.per_agent_allow`. And no custom agent can ever `git commit` — commits and PRs stay with the Guardian. See [Dispatch governance](/advanced/dispatch-governance/).
:::

## Wiring stage outputs into downstream prompts

Each stage can declare **outputs** — named picks from its validated structured result:

```json
{ "name": "qa", "agent": "qa_agent", "schema": "qa.json",
  "outputs": { "failures": "/failures", "summary": "/summary" },
  "on": { "test_failure": { "goto": "implement", "loop": "implement_test" } } }
```

After the stage completes, `stages.qa.failures` and `stages.qa.summary` exist in the prompt context, and **any later stage's templates** can reference them:

```markdown
{{stages.qa.summary}}                       value substitution
{{#if stages.qa.failures}}…{{/if}}          conditional section
{{stages.qa.summary|no QA summary yet}}     with a default
```

This works across the builtin/custom boundary in both directions. To feed your custom QA stage's findings into the builtin Implementer's retry prompt, add a project overlay `.claude/agents/implement.block.md`:

```markdown
<!-- append -->

{{#if stages.qa.failures}}
## QA findings to address

{{stages.qa.summary}}
{{/if}}
```

(Overlay mechanics are covered in [Anatomy of an agent prompt](/advanced/anatomy-of-an-agent-prompt/).)

**The contract is checked, not hoped for.** At launch, worca renders every enabled stage's resolved templates — overlays included — and verifies each `stages.*` reference against a producer that declares the output. A typo'd placeholder **fails the launch with the template and key named**, instead of silently rendering as an empty string. Conditional references to stages that are disabled, omitted, or only reachable later legitimately render empty — those are accepted.

Builtin stages declare their own outputs (`stages.plan.approach`, `stages.test.passed`, `stages.coordinate.beads_ids`, …), so your custom stages can consume builtin results the same way. Legacy flat names (`plan_approach`, `test_failures`, …) used by older prompt overlays keep resolving through an alias table.

:::note
Output values render with plain string conversion — lists and objects come out as their literal representation. For prose-quality prompts, pick scalar fields like `/summary`.
:::

## What can you remove or replace?

Two different questions per builtin stage: *can you drop it?* and *could your own stage do its job?*

| Stage | Completely optional? | Replaceable with a custom stage? |
|---|---|---|
| Preflight | ✅ yes | ⚠️ partially |
| Planner | ⚠️ with a pre-made plan | ⚠️ mostly |
| Plan Reviewer | ✅ yes (off by default) | ✅ yes — ideal candidate |
| Coordinator | ✅ yes | ⚠️ only together with its consumer |
| Implementer | ✅ yes (audit-style flows) | ✅ mostly |
| Tester | ✅ yes | ✅ yes — ideal candidate |
| Reviewer | ✅ yes | ✅ yes — ideal candidate |
| Guardian (PR) | ✅ yes (work stays uncommitted) | ❌ **never** |
| Learner | ✅ yes (off by default) | ❌ no (post slot is builtin-only) |

The pattern: **judge stages swap freely** (Plan Reviewer, Tester, Reviewer are exactly the agent + schema + outcome-loop shape a custom stage has), **producer stages swap together with their consumers** (the Coordinator's beads only mean something to the builtin Implementer's fan-out), and **the commit boundary doesn't swap at all** — only the Guardian may commit, so any flow that should end in a PR includes the builtin `pr` stage.

Worth knowing before you remove things:

- Dropping the **Planner** requires a pre-made plan (`--plan`) — governance blocks source edits until a plan file exists.
- Dropping the **Coordinator** degrades the Implementer to a single one-shot pass (no task fan-out).
- Dropping the **Implementer** turns test/review failures into logged warnings — fine for audit/report pipelines.
- Builtin loop triggers (`test_failure`, `review_changes`, …) fire on fixed conditions. You can rewire where they *go*, not when they fire.

## Where this shows up in the UI

The Pipelines editor's **Prompts** tab shows the effective prompt for every stage — including the shared blocks (`{{block:…}}` inserts like the graphify and CRG reminders) and auxiliary agents — with badges marking what a pipeline replaces or merges. Custom flows themselves are settings-level today; edit `worca.flow` in `settings.json` or ship it inside a [pipeline template](/advanced/authoring-templates/).
