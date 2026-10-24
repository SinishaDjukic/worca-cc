---
name: engine-cost-unknown-surfaces
description: Read before adding an engine without cost reporting, or a new surface that prints a run's cost.
paths: src/cli/**, src/core/chat/**, src/core/ask/follow.mjs, src/core/run-report.mjs, src/shared/engine-switch.mjs
updated: 2026-10-06T19:39:31.302Z
author: Bulibas
---

Some engines report no cost (Cursor: capability `cost: false`). For a run on such an engine, `totalCostUsd` is 0, or
it holds only the Claude helper jobs' cost. Never print that number as the run's cost.

The fix in the browser UI alone was not enough. It cost a review cycle, because the text surfaces still printed
`$0.00`:
- `src/cli/render.mjs` `formatTotals`
- `src/cli/runs.mjs` show
- chat `/cost`, `/status` and `/last`
- chat `renderDone`
- `ask/follow.mjs`

Route every text surface through `runCostLabel(engine, costUsd, fmt)` from `src/shared/engine-switch.mjs`, or through
`fmtRunCost` in chat. Pass the run's `runEngine`: history rows and state both carry it.

Still not routed (seen 2026-10-06):
- `run-report.mjs` metric rows
- `worca runs show --json` `costUsd`

To find every surface, grep `totalCostUsd|total_cost_usd` across `src/` and `ui/public/`.
