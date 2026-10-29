# Costs and budgets

What a run costs, where spend is shown, and the limits that stop it.

## Spend and limits

- **Cost on every run** — the run page shows each run's estimated cost as it goes; Expert mode
  adds per-step cost on the workflow graph. Figures are Claude Code's client-side estimates, not
  billing.
- **Statistics** (Advanced) — pick Today, This week, This month, Last month, All time or a Custom
  range for Spent, Saved
  (estimated human hours × your developer rate, minus spend), Pipeline spend, Chat, Time
  worked, Pipelines finished and PRs merged, plus *Spend per* and *Runs per* charts by hour, day
  or month (runs split into finished, stopped and failed). With a total limit, a ring around your
  avatar in the sidebar fills toward it (amber from 80%, red once new runs are blocked); the account
  menu's spend card has the figures. Filter or split spend by person (or by tag, see
  [Cost tags](#cost-tags)) and export the split as CSV; see
  [`docs/statistics.md`](statistics.md).
- **Hard limits** — set in Settings › Runs › Budget & cost limits, or with `worca config`. A
  per-pipeline cost limit pauses a runaway run before its next step; *Continue without cap (this
  pipeline)* or `worca resume <id> --ignore-cost-cap` lifts it for that run. A total cost limit
  counts pipeline and Chat spend over a weekly (from Monday) or monthly (from the 1st)
  window; once reached it pauses running pipelines at their next step and blocks new runs,
  resumes and Ask turns until the window resets or you raise the limit. Team caps live in
  [Team policy](team-policy.md).

![Statistics on a range with several days of data — Spent, Saved, Pipeline spend, Chat, Time worked, Pipelines finished and PRs merged tiles above the Spend per day and Runs per day charts, with the Everyone and grouping filters](screenshots/stats.png)

## Cost tags

- **Cost tags** — `key:value` tags such as `client:acme` on New
  pipeline, run pages and Ask run cards (`--tag` on the CLI), optional
  mandatory tags under Settings › Tags, and spend **By tag** on Statistics and
  Team metrics.
