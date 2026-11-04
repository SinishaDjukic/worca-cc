# Statistics

The Statistics page shows spend, time worked and outcomes across all pipelines, archived ones
included. It can also split that spend by cost tag, person, project, workflow or status, with hours and value,
and export the split as CSV.

## Ranges

| Range | Window | Bars |
| --- | --- | --- |
| Today | today, local time | per hour |
| This week | the current week | per day |
| This month | the current calendar month | per day |
| Last month | the previous calendar month | per day |
| All time | everything; bars cover the last 12 months | per month |
| Custom | From 00:00 through the end of To, both local dates | per day up to 92 days, per month beyond |

A custom range is at most 5 years. A To before From is refused in the page and by the API (400).
The delta chips compare with the window just before: the month before for Last month, an
equally long period for Custom.

## Filters

- **Cost tags**: only runs that carry every tag in the field. A
  `client:acme` tag matches exactly; a bare `client` matches any client value.
- **Person**: only runs started by that person.

Every tile, chart and grouped row follows the filters. Chat and Requirements spend are not tied to a run,
so any active filter leaves them out, and the Spent tile drops its budget meter (the limit covers
the whole account, not the filtered slice).

The **Cost** view has its own filter bar instead (see below): there the Cost tags field and the Person
select are hidden.

## View

Three chips choose the view:

- **Overview** (default): the tiles and charts.
- **By person**: the person table on its own (one row per starter, `(unknown person)` for runs with
  no named starter, a `Chat` row, a `Total` footer equal to the Spent tile), with Export CSV.
- **Cost**: the Cost and value report (below).

The chosen chip is remembered in this browser (a stored By tag choice opens Cost).

## Cost

The Cost and value report splits the period's spend and asks what it bought.

- **KPIs**: **Spent** and **Human hours** (each with the change against the previous period),
  **Saved** (red when negative), **Cost per hour** (spend ÷ human hours, `—` at 0 hours) and
  **Allocated** (the share of spend that carries the Allocate by value, with the Unallocated amount
  under it).
- **Filters**: chips such as `client = acme` and `status = Finished`, AND-ed. **Add filter** picks a
  dimension, then a value. A second chip on the same dimension replaces the first. Clicking a value in
  the table adds its chip; when that value is the Allocate by dimension, then by moves up to Allocate by.
- **Allocate by → then by**: any cost tag key, or the built-ins Person, Project, Workflow and Status.
  The picker lists policy dimensions first (in their configured order), then the built-ins, then
  every other cost tag key a run in the period carries, by share of spend. Type to search by label or
  key. Then by can be None.
- **Rows**: the top 5 values by spend, then **Other (n)** when 2 or more values are left over (a single
  leftover value shows as itself), then **Unallocated** (runs without the value, only when there are
  any), then **Chat** (chat spend), then **Requirements** (the Requirements page's spend,
  also after its flag is turned off), each only without filter chips. Shares are of the whole report total
  at both levels; under one percent reads `<1%`, never `0%`, and no spend reads `—`. The rows add up to
  the Spent tile, and each row's second-level rows add up to it. Expand a row to see its then by values;
  a row of Other expands to the values it folds.
- **Columns**: Share, AI spend, Human hours, Saved, $ per hour and Runs. **N runs** opens those runs in
  the Runs list. Hours and Saved follow
  [Human hours and "Saved"](team-metrics.md#human-hours-and-saved).
- **Chart**: stacked areas per row over the period, switchable between **AI spend** and **Human hours**
  (Chat has no hours, so the hours chart leaves it out). Unallocated is hatched; when Allocate by
  is a cost tag its legend item offers **Tag N runs**, which opens the Runs list with those runs ticked.
  The chart is drawn from the cost ledger, so for All time it can show less than the table for runs
  recorded before the ledger.
- **Saved views**: **Save view** keeps Allocate by, then by, the chart metric and the filters under a
  name, in this browser only (up to 20). Pick one from **Saved views** to apply it; **Delete view**
  removes it.

Changing Allocate by, then by, a filter or the chart metric does not reload the page's data.

**How the numbers reconcile.** Spend is counted when it happened (each cost ledger entry by its
time), so a run that started on 31 August and kept spending on 1 September splits across the two
months. Runs and outcomes are counted in the period the run started. A row can therefore show
spend with 0 runs. The row amounts always add up to the Spent tile. All time uses the stored run
totals, so older runs recorded before the cost ledger still count.

Retagging a finished run moves its spend to the new row the next time the page loads.

## CSV export

**Export CSV** on the person table downloads the rows on screen. The file is UTF-8 with a byte
order mark (so Excel reads accents correctly), uses CRLF line ends and RFC 4180 quoting. Columns:
the group (for example `client` or `person`), `spendUsd`, `runs`, `finished`, `stopped`,
`failed`, `running`, `paused`, `prsOpened`, `prsMerged`.

**Download CSV** in the Cost view saves the report, for example `statistics-month-cost-client.csv`, with
the same columns plus `humanHours`, `savedUsd` and `usdPerHour`. A then by dimension adds a second label
column after the first, one row per (value, then by value) pair. `Other (n)` is unfolded into its values.
Numbers stay numbers: a negative Saved exports as `-15`.

## API

`GET /api/stats?range=lastMonth&tag=client:acme&tag=spike&person=bob&groupBy=tag:client`

| Parameter | Values |
| --- | --- |
| `range` | `today`, `week`, `month` (default), `lastMonth`, `custom`, `all` |
| `from`, `to` | `YYYY-MM-DD`, required with `range=custom` |
| `tag` | repeatable; up to 20 |
| `person` | a starter's name |
| `groupBy` | `person` or `tag:` followed by a tag key |
| `byTag` | `1` adds `tagGroups` |
| `tagKey` | repeatable, with `byTag=1`; the configured keys, which always get a table (up to 50) |
| `report` | `1` adds `report` (the Cost view's per-run facts) |

A malformed range, date, tag or group answers 400. The response adds `filter`, `filtered`,
`groupBy`, `groups` (`{ by, label, rows }`), `tagGroups` (`null` without `byTag=1`, otherwise
`[{ key, configured, rows }]` with the same rows as `groupBy=tag:` for that key) and `people` (the
names for the person picker).

With `report=1` the response adds `report`:

- `buckets`: each chart bucket's start (ms), the same buckets as `series`.
- `runs`: one fact per run the period counts: `id`, `person`, `project` (the registered name, else the
  project key without its hash, for example `web-app`), `workflow`, `status` (`finished`, `stopped`,
  `failed`, `paused`, `running`), `pr` (`opened`, `merged` or `null`), `tags` (`{ client: 'acme' }`),
  `usd`, `hours`, `inCohort` (started in the period; a run that only spent in it counts its money, not
  itself), `spend` (`[bucketIndex, usd]` pairs) and `hourBucket`. Spend of a deleted run is a fact with
  `orphan: true`. The facts' `usd` add up to `totals.pipelineSpendUsd`.
- `prevRuns`: the previous period's facts (no buckets), `null` for All time.
- `ask`: `{ spentUsd, prevSpentUsd, series }` for Chat, `null` while a filter is active.
- `requirements`: `{ spentUsd, prevSpentUsd, series }` for the Requirements page, `null` while a filter
  is active. With the `requirements` flag off it is there only when this period or the one before has
  Requirements spend, and `totals.requirements` (the Statistics tile's figures) is left out.

Without `report=1` there is no `report` key.
