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

Every tile, chart and grouped row follows the filters. Chat spend is not tied to a run,
so any active filter leaves it out, and the Spent tile drops its budget meter (the limit covers
the whole account, not the filtered slice).

## View

While the `runTags` feature flag is on, three chips replace the Group by select:

- **Overview** (default): the tiles and charts.
- **By person**: the person table on its own (one row per starter, `(unknown person)` for runs with
  no named starter, a `Chat` row, a `Total` footer equal to the Spent tile), with Export CSV.
- **By tag**: one table per tag key. Configured tag dimensions (team policy `runs.tagDimensions` or
  Settings › Tags) come first, read by label ("Cost centre"), even when no run in
  the range carries them. Every other key follows when a run in the range carries it, by spend.
  Each table lists the values by spend, then **Untagged**, then **Chat** (absent while a
  filter is active), and a **Total** footer equal to the Spent tile. Share is an integer percent;
  the column always adds up to 100% (— at $0). More than 8 values show the top 7 and an
  **Other (n)** row that expands in place. A plain tag such as `spike` reads `spike` and Untagged.
  By tag appears only when a tag is in use or a dimension is configured.

The chosen chip is remembered in this browser. With `runTags` off, the **Group by** select stays:
**Group by person** adds the person table under the charts.

**How the numbers reconcile.** Spend is counted when it happened (each cost ledger entry by its
time), so a run that started on 31 August and kept spending on 1 September splits across the two
months. Runs and outcomes are counted in the period the run started. A row can therefore show
spend with 0 runs. The row amounts always add up to the Spent tile. All time uses the stored run
totals, so older runs recorded before the cost ledger still count.

Retagging a finished run moves its spend to the new row the next time the page loads.

## CSV export

**Export CSV** on the person table, and each By tag table's **CSV** link (named
`statistics-<range>-tag-<key>.csv`, the none row reading `(no client)`), download the rows on screen. The file is UTF-8 with a byte
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
| `byTag` | `1` adds `tagGroups` |
| `tagKey` | repeatable, with `byTag=1`; the configured keys, which always get a table (up to 50) |

A malformed range, date, tag or group answers 400. The response adds `filter`, `filtered`,
`groupBy`, `groups` (`{ by, label, rows }`), `tagGroups` (`null` without `byTag=1`, otherwise
`[{ key, configured, rows }]` with the same rows as `groupBy=tag:` for that key) and `people` (the
names for the person picker).
