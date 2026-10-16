# Statistics

The Statistics page shows spend, time worked and outcomes across all pipelines, archived ones
included. It can also split that spend by run tag or by person and export the split as CSV.

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

- **Tags** (behind the `runTags` feature flag): only runs that carry every tag in the field. A
  `client:acme` tag matches exactly; a bare `client` matches any client value.
- **Person**: only runs started by that person.

Every tile, chart and grouped row follows the filters. Ask Worca chat spend is not tied to a run,
so any active filter leaves it out, and the Spent tile drops its budget meter (the limit covers
the whole account, not the filtered slice).

## Group by

**Group by person** or **Group by tag: client** (one option per tag key in use, while `runTags` is
on) adds a table under the charts:

- one row per value (`acme`, `globex`, or a person's name);
- a `(no client)` row for runs without that tag, or `(unknown person)` for runs with no named
  starter;
- an `Ask Worca` row for chat spend (absent while a filter is active);
- a `Total` footer equal to the Spent tile.

A plain tag such as `spike` groups into `spike` and `(no spike)`. Rows with no spend and no runs
are left out.

**How the numbers reconcile.** Spend is counted when it happened (each cost ledger entry by its
time), so a run that started on 31 August and kept spending on 1 September splits across the two
months. Runs and outcomes are counted in the period the run started. A row can therefore show
spend with 0 runs. The row amounts always add up to the Spent tile. All time uses the stored run
totals, so older runs recorded before the cost ledger still count.

Retagging a finished run moves its spend to the new row the next time the page loads.

## CSV export

**Export CSV** on the grouped table downloads the rows on screen. The file is UTF-8 with a byte
order mark (so Excel reads accents correctly), uses CRLF line ends and RFC 4180 quoting. Columns:
the group (for example `client` or `person`), `spendUsd`, `runs`, `finished`, `stopped`,
`failed`, `running`, `paused`, `prsOpened`, `prsMerged`.

## API

`GET /api/stats?range=lastMonth&tag=client:acme&tag=spike&person=bob&groupBy=tag:client`

| Parameter | Values |
| --- | --- |
| `range` | `today`, `week`, `month` (default), `lastMonth`, `custom`, `all` |
| `from`, `to` | `YYYY-MM-DD`, required with `range=custom` |
| `tag` | repeatable; up to 20 |
| `person` | a starter's name |
| `groupBy` | `person` or `tag:` followed by a tag key |

A malformed range, date, tag or group answers 400. The response adds `filter`, `filtered`,
`groupBy`, `groups` (`{ by, label, rows }`) and `people` (the names for the person picker).
