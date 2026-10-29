# Costs and budgets

What a run costs, where you see the spend, and the limits that stop a run before it costs too much.

## Spend and limits

### Cost on every run

The run page shows each run's estimated cost as it goes. In Expert mode, the workflow graph also shows the cost of
each step. These figures are Claude Code's client-side estimates, not your bill.

### Statistics

**Statistics** (Advanced) sums up spend over a range: Today, This week, This month, Last month, All time or a
Custom range. It shows:

- Spent
- Saved: estimated human hours × your developer rate, minus spend
- Pipeline spend and Chat
- Time worked
- Pipelines finished and PRs merged

Below the tiles, the *Spend per* and *Runs per* charts break it down by hour, day or month, with runs split into
finished, stopped and failed. You can filter or split spend by person, or by tag (see [Cost tags](#cost-tags)), and
export the split as CSV. More in [Statistics](statistics.md).

With a total limit set, a ring around your avatar in the sidebar fills toward it. It turns amber at 80% and red once
new runs are blocked. The account menu's spend card has the figures.

### Hard limits

Set limits in Settings › Runs › Budget & cost limits, or with `worca config`.

A per-pipeline cost limit pauses a runaway run before its next step. To lift it for that run, choose *Continue
without cap (this pipeline)* or run `worca resume <id> --ignore-cost-cap`.

A total cost limit counts pipeline and Chat spend over a window: weekly from Monday, or monthly from the 1st. Once
the limit is reached, running pipelines pause at their next step, and new runs, resumes and Ask turns are blocked
until the window resets or you raise the limit.

Team caps live in [Team policy](team-policy.md).

![Statistics on a range with several days of data — Spent, Saved, Pipeline spend, Chat, Time worked, Pipelines finished and PRs merged tiles above the Spend per day and Runs per day charts, with the Everyone and grouping filters](screenshots/stats.png)

## Cost tags

Tags let you see what spend went where, for example per client. A tag is a `key:value` pair such as `client:acme`.
You add tags on New pipeline, on run pages and on Ask run cards, or with `--tag` on the CLI. Settings › Tags can
make some tags mandatory. Statistics and Team metrics then show spend **By tag**.
