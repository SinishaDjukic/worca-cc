---
title: Costs & budgets
description: Where run costs come from, project-wide pricing (currency, server-tool rates), and the cost budget that halts a runaway run.
sidebar:
  order: 4.5
---

worca tracks what every stage spends and rolls it up per run, per stage, and
per model. This page covers where those numbers come from, the project-wide
pricing settings, and the **budget** — a cost circuit breaker that stops a
run before it burns through more than you allowed.

## Where the numbers come from

Each agent subprocess reports its token usage and cost when it finishes. By
default the cost figure is Claude CLI's own number. Two overrides exist:

- **Per-model pricing rates.** A model alias can carry its own input/output/
  cache rates — required for alt-endpoint models where the CLI's
  Anthropic-priced number would be wrong (often reported as $0 or priced
  against the wrong model). Rates are edited per alias on the
  [Models page](/configuration/models/); when an alias routes through
  `ANTHROPIC_BASE_URL`, worca prices usage from these rates instead of
  trusting the CLI.
- **Server-tool rates.** Web search and web fetch requests are billed
  per-request, not per-token. Their rates live here, under
  **Project Settings → Costs & Budgets**.

The **Costs** page in the sidebar aggregates all of it: totals across runs,
cost by run, by stage, and by model.

## Project-wide pricing settings

**Project Settings → Costs & Budgets** edits the project-wide keys under
`worca.pricing`:

| Setting | Key | Meaning |
|---|---|---|
| Currency | `worca.pricing.currency` | Display currency for every cost figure (default `USD`). Label only — worca does no FX conversion. |
| Web search rate | `worca.pricing.server_tools.web_search_per_request` | Cost added per web-search request an agent makes. |
| Web fetch rate | `worca.pricing.server_tools.web_fetch_per_request` | Cost added per web-fetch request. |

Per-model token rates deliberately do **not** live on this tab — each alias
carries its own pricing in the [Models editor](/configuration/models/), so a
model and its rates travel together.

## The budget (cost circuit breaker)

`worca.budget` is project cost policy — it watches the run's accumulated
cost and acts at two thresholds:

| Setting | Key | Behavior |
|---|---|---|
| Max cost | `worca.budget.max_cost_usd` | Hard ceiling. A run that crosses it is halted rather than allowed to keep spending. Unset = no ceiling. |
| Warning threshold | `worca.budget.warning_pct` | At this percentage of max cost (default 80%), worca emits a `cost.budget_warning` event — wire it to a [webhook or chat notification](/integrations/events-overview/) to get pinged before the ceiling hits. |

Budgets complement the [loop limits and circuit breaker](/configuration/loops-and-circuit-breaker/):
loop limits bound *iterations*, the error circuit breaker bounds *repeated
failures*, and the budget bounds *spend* — three independent ways a run is
prevented from running away.

## Cost events

Every completed stage emits `cost.stage_total`; the run maintains
`cost.running_total`, and the budget warning above fires once the threshold
is crossed. The full event catalog is in the
[events overview](/integrations/events-overview/).
