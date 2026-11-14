# Worca levels

A maintainer reference for the usage-level feature. It points at the code and does not restate it.

## 1. What it is

Worca levels show a person how far into Worca they have got. There are five levels, each with a piece of worca art:

| Level | Name | Key | Art file |
|---|---|---|---|
| 1 | Curious | `curious` | `curious.svg` |
| 2 | Runner | `runner` | `runner.svg` |
| 3 | Hooked | `hooked` | `hooked.svg` |
| 4 | WorcaHolic | `worcaholic` | `worcaholic.svg` |
| 5 | Worca's Council | `council` | `council.svg` |

- **Personal.** Each person has their own level; nobody sees anyone else's.
- **Always on.** There is no feature flag and no opt-out.
- **Earned, never ticked by hand.** An item is done only when Worca sees the real action or state. Nothing on the page can be checked off by the person.
- **Kept for good.** Once an item is done it stays done, and a level is never lowered. Removing an add-on or deleting a schedule later does not undo anything.
- **Levels are not Interface modes.** A level never changes the Interface mode (Simple, Advanced, Expert), and the mode never hides a level. Links to pages of a higher mode open them with the usual banner. See [ui-levels.md](ui-levels.md).
- **Existing users start at a backfilled level.** A first evaluation looks at what the person already did and starts them there. Nothing before that level is celebrated.

The art files are in `ui/public/assets/worca-levels/`. The ladder is defined in `src/shared/worca-levels.mjs`.

## 2. The ladder

Items and deep links come from `WORCA_LEVELS` in `src/shared/worca-levels.mjs`. A level is reached when every item of that level and of the levels below it is done (earned in order). Items latch independently and early: a 30-day streak that happens before WorcaHolic is stamped, and Worca's Council follows as soon as WorcaHolic completes. When several levels are reached in one evaluation, only the highest is celebrated.

| Level | Item id | Done when | Link |
|---|---|---|---|
| Curious | none (everyone starts here) | | |
| Runner | `gettingStarted` | Getting started shows 9 of 9 steps done | `#getting-started` |
| Runner | `firstRequirement` | the person has 1 or more requirements; with the `requirements` flag off, their first started run | `#requirements` |
| Runner | `firstFeatureDone` | the person has 1 or more runs with status `done` | `#requirements` |
| Hooked | `addonInstalled` | 1 or more add-ons installed | `#marketplace` |
| Hooked | `spaceSetUp` | 1 or more spaces | `#workspaces` |
| Hooked | `scheduleCreated` | a schedule, a one-off scheduled run, or a run started with a scheduled time | `#schedules` |
| Hooked | `statsViewed` | the client posted `stats-viewed` | `#stats` |
| WorcaHolic | `parallelFeatures` | two different `done` runs of the person overlapped in time | `#new` |
| WorcaHolic | `addonsAtOnce` | 2 or more add-ons installed at the same time, at some point | `#marketplace` |
| WorcaHolic | `repeatingSchedule` | a repeating schedule, or a run that came from one (this survives deleting the schedule) | `#schedules` |
| WorcaHolic | `teamMetrics` | see below | `#team-policy` or `#team-metrics` |
| Worca's Council | `councilStreak` | 30 days in a row with 2 or more finished runs each | `#new` |

Thresholds are the `WORCA_THRESHOLDS` constants in `src/shared/worca-levels.mjs`: `parallelFeatures` 2, `addonsAtOnce` 2, `teamMetricsRuns` 10, `councilDays` 30, `councilDailyRuns` 2.

Marketplace, Workspaces, Schedules, Statistics, Team metrics and Team policy are hidden from the sidebar in Simple mode, so those hints say the link opens the page anyway.

### Item rules

- **`firstRequirement` with the flag off.** With the `requirements` flag off there is no requirement to write, so the item is done on the person's first started run. The served view then words `firstRequirement` and `firstFeatureDone` as tasks and links them to `#new`, because `#requirements` redirects to chat while the flag is off.
- **`parallelFeatures`.** "Feature" means a pipeline run; any workflow template counts. Overlap is strict (`a.start < b.end && b.start < a.end`), so back-to-back runs do not count. Both runs must be `done`. Runs with a NULL start or end, with `end <= start`, or deleted are ignored.
- **`addonsAtOnce`.** The live record keeps `addonPeak = max(addonPeak, count)`, updated at install time, so a removal later does not undo it. An add-on counts when installed, even if disabled.
- **`teamMetrics`.** Stamped only by the server, when the client posts `team-metrics-viewed` and, at that moment, both hold: Team policy is installed (`onboardingStatus().steps.teamPolicy`, install-wide, so whoever installed it counts), and the person has 10 or more `done` runs shown in Team metrics (section 5). Opening Team metrics with either part unmet changes nothing. The stamp is `teamMetricsOpenedAt`, set once. The Open link is `#team-policy` while Team policy is not installed, else `#team-metrics`.
- **`councilStreak`.** See section 4.

## 3. How progress is computed

1. **Facts.** `src/core/worca-levels/facts.mjs` (`gatherFacts`) reads numbers and booleans from real sources: the database (runs, requirements, schedules, workspaces), the plugin lock, the `requirements` flag, Getting started's status, the run ledgers, and the person's live record. Each source is guarded. One that fails is logged and takes a neutral value (0, false, empty), so `gatherFacts` never throws.
2. **Conditions.** `src/core/worca-levels/evaluate.mjs` holds one condition per item id. `evaluate` is pure: facts, the stored record and `now` in; level, `doneAt`, progress and next items out.
3. **The latch (`doneAt`).** The first time an item's condition is met, `evaluate` stamps it in `doneAt`. A stamped item stays done even if the fact later drops. The level is the larger of the stored level and the level the latched items earn.
4. **Service.** `src/core/worca-levels/service.mjs` re-reads facts on every state request, evaluates, and writes the record only when it changed. It decides when a level-up is celebrated and when the welcome shows. The welcome is `existing` only when there is past activity and the backfilled level is above 1; otherwise it is `new`.
   `POST /api/worca-level/ack` takes `{ what: 'welcome' }` or `{ what: 'celebration', index }`. The celebration ack names the level that was shown, and the server records `max(celebrated, min(index, level))`, so a level reached between the view and the ack is still celebrated. A missing or out-of-range `index` is a 400. The range comes from the ladder length, so `index: 5` is accepted.

### Progress shape

The next-level progress is `{ done, total, unit }`. `unit: 'items'` counts items (3 for Runner, 4 for Hooked, 4 for WorcaHolic). When the next level is Worca's Council it is `{ done: min(current, 30), total: 30, unit: 'days' }`, drawn as 30 thin segments. At the top level progress is null and no segments are drawn. Items with a count carry it until done: `gettingStarted` its steps, `teamMetrics` its runs of 10, `councilStreak` its days of 30.

### Time zone

The client sends `tz = Intl.DateTimeFormat().resolvedOptions().timeZone` on every level request (GET query `?tz=`, and in the ack and events body). The server validates it and stores it on the person's record when it changed. When the value is missing or invalid it uses the stored `record.tz`, else the server zone. An invalid `tz` never fails a request. Past latches are unaffected when the zone changes.

### The timeline algorithms

Both live in `src/core/worca-levels/timeline.mjs`, are pure and take `now` from the caller.

- **First parallel pair (`firstParallelPair`).** Intervals are the person's `done` runs, `started_at` to `updated_at`. They are sorted by start and swept with a min-heap of ends, O(n log n), with no self-join over all runs. For each interval that starts before the earliest open end, the pair's finish is the later of the two ends. The earliest such finish over all pairs is `doneAt`.
- **Council streak (`councilStreak`).** Each `done` run's `updated_at` is mapped to a calendar day in the person's zone (`dayKey`). A day qualifies when 2 or more runs end on it. Consecutive days are compared with calendar arithmetic on the `YYYY-MM-DD` key, done on the UTC date, so a daylight saving change never shifts a day. The item is met on the first stretch of 30 consecutive qualifying days anywhere in history, and `doneAt` is the finish of the 2nd run on the 30th day. Progress `current` counts the consecutive qualifying days ending yesterday, plus 1 if today already qualifies, so a day still in progress never resets the count.

### Skipping expensive sources

`gatherFacts` takes `skip`, a set of source names. A skipped source is not run and returns its neutral value. `getState` and `ack` skip:

- `parallel` once `doneAt.parallelFeatures` is set;
- `council` once `doneAt.councilStreak` is set;
- `teamMetricsRuns` unless the stored level is 3 (the next level is WorcaHolic) and `doneAt.teamMetrics` is unset.

Each condition is already latched or never reads the skipped fact: the `teamMetrics` condition reads `teamMetricsOpenedAt`, and the run count only feeds progress and the check at open time. So skipping never changes a level. `team-metrics-viewed` never skips the count. This bounds the ledger reads that would otherwise run on every debounced `pipelines-changed` poke.

## 4. Who counts as the person

The route layer calls `resolveIdentity(req)` in `src/core/identity.mjs`. Nothing else decides identity.

- **Single-person install** (`operator` or `local` source): the person key is the fixed `_local`. Fact queries do not filter by person, so every row counts. This also covers old runs with a NULL `started_by`.
- **Shared install** (`access` or `header` source, see `isSharedIdentity`): the key is the lowercased identity name. Runs, requirements and schedules are filtered to that person.

`personOf` in `service.mjs` makes this choice.

## 5. Known limits

- **`updated_at` stands in for the finish time.** `updatePipelineTitle`, or a pause and resume, can stretch an interval and create a false overlap. This matches Statistics. Overlap needs both runs `done`, which limits the impact.
- **"Shown in Team metrics" is the ledger proxy.** Per run it is `<worcaHome>/metrics/ledger/<runId>.json` with state `recorded`, which is written only after the run's record is flushed to the metrics branch. It is not a read of the git-backed Team metrics page. Ledgers are per machine and are swept after 180 days, so a run recorded from another machine of the same person is not counted, and the page's date range and filters are ignored. The count is the person's newest `done` runs, capped at 10. A later sweep can lower the count, which is harmless after the item has latched.
- **Policy is detected from the cached discovery.** A teammate's Team policy install shows here after discovery runs. The Team policy page can refresh it, and the next level request then sees it.
- **Runner's "Getting started 9/9" includes the Team metrics and Team policy steps.** Team metrics and Team policy must therefore be enabled on the install for Runner to be reachable. The Open link covers the steps; a Simple-mode user reaches those pages through the usual banner.
- **A shared install does not credit add-ons installed before levels shipped or through the CLI.** On a single-person install the plugin lock and the workspaces table backfill add-ons and spaces. On a shared install only the person's own live events count, because those cannot otherwise be attributed to a person. The same holds for spaces.
- **Getting started is install-wide.** It is credited from install state, which is what the person's checklist shows. A person who joins an already set-up shared install gets it credited.
- **Reads write.** The state request latches and raises the record. It is idempotent and serialised through the store queue.
- **Pokes reach every socket.** The `worca-level-changed` event carries no payload; each client re-reads only its own view.

## 6. Storage

State lives in `<settings root>/.worca-cc/worca-levels.json`, next to `away-people.json`. The path is `worcaLevelsFile()` in `src/core/worca-levels/store.mjs`. Shape: `{ version: 1, people: { [key]: record } }`. A record holds the level, `doneAt`, the celebration state, `tz`, and the live fields (`addons`, `addonPeak`, `spaces`, `statsViewedAt`, `teamMetricsOpenedAt`).

- `updatePerson` is the only writer. Updates go through an in-process promise queue and `writeJsonAtomic`, so parallel updates for one person do not lose writes.
- **Corrupt file.** An unreadable or wrongly shaped file is renamed to `worca-levels.json.corrupt-<timestamp>`, a warning is logged, and the store starts empty. It never throws. People are then re-evaluated from facts and start at their backfilled level, but live-only history (shared-install add-ons and spaces, Statistics and Team metrics views) is lost with the file.
- A missing file reads as empty.
- Person keys of `__proto__`, `constructor` and `prototype` are rejected.
- **Safety on read.** `store.mjs` answers an unreadable file (anything but a missing one) as empty to readers but refuses to write over it, so a transient read error cannot erase other people's records.

## 7. Client wiring

`ui/public/worca-level/app-wiring.mjs` is what `app.js` calls: it fetches the view at boot and after a payload-free poke (a sequence guard drops an older answer that arrives late), repaints the corner and the Getting started line, mounts the level card at the top of the account menu, and opens the welcome or celebration dialog. A dialog never opens while a blocking prompt or another modal is on screen; it retries on the next poke or settle, and never hides or re-orders prompt nodes. Profile is the page that shows the level in full; it has no sidebar entry and opens from the menu card, the tooltip and the Getting started line. Styles are in `ui/public/worca-level/worca-level.css`. Links the server sends are rendered only when they start with `#`.
