# Worca levels

What the five worca levels mean, how to reach each one and where to see yours. The engineering detail (how progress is computed and stored) follows from section 3 and points at the code.

## 1. What it is

Worca levels show a person how far into Worca they have got. There are five levels, each with a piece of worca art, and they are reached in this order:

| Level | Name | What it means | Art file |
|---|---|---|---|
| 1 | Curious | Set up and signed in to a model. Everyone begins here, ready to try a first run. | `curious.svg` |
| 2 | Runner | Orchestrates one pipeline: Getting started steps 1 to 6 and 3 real runs. | `runner.svg` |
| 3 | Hooked | Builds regularly: 10 real runs, a pull request and 2 more things tried. | `hooked.svg` |
| 4 | WorcaHolic | Orchestrates the whole pod: parallel features, 5 merged pull requests and 2 power moves. | `worcaholic.svg` |
| 5 | Worca's Council | Builds on 20 of the last 30 days. | `council.svg` |

A **real run** is a run that finished, was not a demo run and cost something. A demo run or a run that cost nothing never counts, and deleting a run does not take it back.

- **Personal.** Each person has their own level; nobody sees anyone else's. Only you can see yours.
- **Earned, never ticked by hand.** An item is done only when Worca sees the real action or state. Nothing on the page can be checked off by the person.
- **Kept for good.** Once an item is done it stays done, and a level is never lowered. Removing an add-on or deleting a schedule later does not undo anything.
- **Levels are not Interface modes.** A level never changes the Interface mode (Simple, Advanced, Expert) on its own. Hooked and WorcaHolic only *offer* a bigger mode, see "The Advanced mode offer" below. See [ui-levels.md](ui-levels.md).
- **Existing users keep what they earned.** The first time Worca evaluates the current ladder it looks at what the person already did. If that earns a new level, one **Your work so far** dialog lists the levels credited, each with its date.

The art files are in `ui/public/assets/worca-levels/`. The ladder is defined in `src/shared/worca-levels.mjs`.

### How to reach each level

Open **Profile** (see "Where to see your level") and read **To reach <next level>**. Each item there has a dot (done or not yet), a short hint, a count such as "2 of 3 real runs" and, for an item with a page, an **Open** button that goes to it.

- **Curious.** Click **Finish setup** in the account menu and sign in to a model provider (**Sign in to a model** when only the provider is missing). Claude Code, Copilot or any other provider counts.
- **Runner.** Do Getting started steps 1 to 6 and finish 3 real runs.
- **Hooked.** Finish 10 real runs on at least 3 different days, let a run create 1 PR, and do any 2 of 5 extras: a scheduled run finished, a workspace run finished, an add-on installed, a pull request merged, or real runs on 2 projects. People on a team also have **Team set up**: turn on Team metrics and Team policy.
- **WorcaHolic.** Run 2 features at the same time (both must finish successfully), get 5 pull requests merged, and do any 2 of 3 power moves: a repeating schedule with 3 finished runs, 2 add-ons installed at once, or real runs on 3 or more projects.
- **Worca's Council.** Have 20 active days within the last 30. A day is active when a real run of yours finished; weekends count.

### Where to see your level

- **The account menu.** Click your avatar. At the top is a level card: the avatar, your level name and **View level**, then **To <next level>** with the count and a small segment bar. Click the card to open Profile. Nothing opens on hover. At the top level the card says "You've reached the top level." Before you have a level the card shows your initials, **Finish setup** or **Sign in to a model**, and what earns the first level.
- **Profile.** The page that shows the level in full: a hero with your level, **Next level** with progress, **To reach <next level>**, and **All levels** (each level with its items, its date, and **Reached**, **You are here**, **Next** or **Later**). Profile has no sidebar entry and every Interface mode reaches it. It opens from **View level**, from **See levels** on the Getting started line, and from **See your level** in the level-up dialog.
- **The level-up dialog.** When you reach a new highest level, a dialog says "You're <level>" with **See your level** and **Carry on**. It waits until you are not in a setup or another dialog.
- **Toasts.** Below Runner, a finished run of yours says "2 of 3 real runs toward Runner", or "Demo runs don't count. Try one on your project." From Runner on, when you are at least three quarters of the way through one item of the next level, one toast says what is left, for example "2 more real runs to Hooked". Each item is offered once.

### The Advanced mode offer

When you reach Hooked, Worca offers Advanced mode; when you reach WorcaHolic it offers Expert mode. A dismissible banner appears at the top of the page, below the connection banner:

- At Hooked: "You're Hooked. Advanced mode shows Marketplace, Workspaces and Schedules in the sidebar." with a **Try Advanced mode** button.
- At WorcaHolic: "You're WorcaHolic. Expert mode shows Team metrics, Team policy and the Models page in the sidebar." with a **Try Expert mode** button.

Click **Try Advanced mode** (or **Try Expert mode**) to switch the Interface mode. Click the close button to dismiss it. Your mode changes only if you say yes, and your first answer stands: a mode you answered is never offered again. The banner is not shown when you are already in that mode or a bigger one. A dismissed Expert offer is not followed by an Advanced one. A person who already holds Hooked or WorcaHolic when the current ladder first runs is not offered the mode for a level they already have. You can change the Interface mode any time from the account menu.

## 2. The ladder

Items and deep links come from `WORCA_LEVELS` in `src/shared/worca-levels.mjs`. A level is reached when every shown item of that level and of the levels below it is done (earned in order). Items latch independently and early: a day or a run that counts before the level is open is stamped, and the level follows as soon as its last item completes. When several levels are reached in one evaluation, only the highest is celebrated.

| Level | Item id | Shown as | Done when | Open button |
|---|---|---|---|---|
| Curious | `setupFinished` | Finish setup | the Setup Assistant is finished | none |
| Curious | `providerSignedIn` | Sign in to a model provider | setup is finished and a provider is signed in (both at the same evaluation) | none |
| Runner | `runnerSteps` | Getting started steps 1 to 6 | Getting started shows 6 of the first 6 steps done (steps 7 to 9 are never read) | Open Getting started (`#getting-started`) |
| Runner | `realRuns` | 3 real runs | the person has 3 real runs | Open New pipeline (`#new`) |
| Hooked | `hookedRuns` | 10 real runs on 3 days | 10 real runs finished on 3 different days | Open New pipeline (`#new`) |
| Hooked | `prOpened` | 1 PR created | a real run of the person has a pull request | Open New pipeline (`#new`) |
| Hooked | `teamSetUp` | Team set up | Team metrics and Team policy are both on; shown only on a team | Open Team policy (`#team-policy`) |
| Hooked | `hookedPick` | Pick any 2 | 2 of the 5 choices below | none |
| WorcaHolic | `parallelFeatures` | Run 2 features at the same time | two different real runs overlapped in time | Open New pipeline (`#new`) |
| WorcaHolic | `prsMerged` | 5 merged pull requests | 5 pull requests of the person's runs were merged | Open New pipeline (`#new`) |
| WorcaHolic | `holicPick` | Pick any 2 | 2 of the 3 choices below | none |
| Worca's Council | `councilDays` | Any 20 active days in the last 30 | 20 active days inside a 30-day window | Open New pipeline (`#new`) |

The choices of **Pick any 2** at Hooked:

| Choice id | Shown as | Done when | Open button |
|---|---|---|---|
| `scheduledRunDone` | A scheduled run finished | a real run came from a schedule or had a scheduled time | Open Schedules (`#schedules`) |
| `workspaceRunDone` | A workspace run finished | a real run targeted a workspace | Open Workspaces (`#workspaces`) |
| `addonInstalled` | Install an add-on | 1 or more add-ons installed | Open Marketplace (`#marketplace`) |
| `prMerged` | Merge a pull request | a pull request one of the runs opened is merged | Open New pipeline (`#new`) |
| `twoProjects` | Real runs on 2 projects | real runs on 2 different projects | Open Projects (`#projects`) |

The choices of **Pick any 2** at WorcaHolic:

| Choice id | Shown as | Done when | Open button |
|---|---|---|---|
| `repeatingScheduleRuns` | A repeating schedule with 3 finished runs | 3 real runs of one schedule | Open Schedules (`#schedules`) |
| `addonsAtOnce` | 2 add-ons at once | 2 or more add-ons installed at the same time, at some point | Open Marketplace (`#marketplace`) |
| `threeProjects` | Real runs on 3 or more projects | real runs on 3 different projects | Open Projects (`#projects`) |

Thresholds are the `WORCA_THRESHOLDS` constants in `src/shared/worca-levels.mjs`: `runnerSteps` 6, `runnerRealRuns` 3, `hookedRuns` 10, `hookedDays` 3, `hookedPick` 2, `hookedProjects` 2, `prsOpened` 1, `parallelFeatures` 2, `holicMergedPrs` 5, `holicPick` 2, `repeatingScheduleRuns` 3, `addonsAtOnce` 2, `holicProjects` 3, `councilDays` 20, `councilWindow` 30, `nudgeAt` 0.75.

Schedules, Workspaces, Marketplace, Team metrics and Team policy are not in the sidebar in Simple mode, so the hints say the **Open** button opens the page anyway.

### Item rules

- **Real runs.** Every count except the first two Curious items, Getting started, the add-on counts and **Team set up** reads real runs only (finished, not a demo, cost something). Deleted runs still count. A run's finish is its `finished_at`, else its `updated_at` for a run from before that column existed.
- **`hookedRuns`.** 10 real runs on at least 3 different local days. The runs of one schedule add a single day in total, the day of the schedule's first finish, so a repeating schedule earns one day.
- **`teamSetUp`.** Shown, and required, only for a person on a team (Team metrics or Team policy is on), or once it has been done. It is done when both are on.
- **`parallelFeatures`.** "Feature" means a pipeline run; any workflow template counts. Overlap is strict (`a.start < b.end && b.start < a.end`), so back-to-back runs do not count. Both runs must be real runs. Runs with a NULL start or end, or with `end <= start`, are ignored.
- **`prMerged` and `prsMerged`.** A pull request counts as merged when the run's recorded state is `MERGED`. When a run has a pull request but no readable state (offline, no git host) the item is not met and looks like any item not done yet in Profile; the server marks it unknown, so no toast offers it.
- **`addonsAtOnce`.** The live record keeps `addonPeak = max(addonPeak, count)`, updated at install time, so a removal later does not undo it. An add-on counts when installed, even if disabled.
- **`councilDays`.** A day is active when one real run of the person finished on it, in the person's time zone. The runs of one schedule count one active day in total. Days without activity never reset anything.
- **A pick item.** Done when `need` of its choices have latched; it carries the count of choices done.

## 3. How progress is computed

1. **Facts.** `src/core/worca-levels/facts.mjs` (`gatherFacts`) reads numbers and booleans from real sources: Getting started's status, the real-run rows in the database, the plugin lock and the person's live record. Each source is guarded. One that fails is logged and takes a neutral value (0, false, empty), so `gatherFacts` never throws. No fact comes from which pages a person opened.
2. **Conditions.** `src/core/worca-levels/conditions.mjs` holds one condition per item and choice id; `evaluate.mjs` turns them into the view. `evaluate` is pure: facts, the stored record and `now` in; level, `doneAt`, `reachedAt`, progress and next items out.
3. **The latch (`doneAt`).** The first time an item's condition is met, `evaluate` stamps it in `doneAt` (the instant the thing really happened when the fact knows it, else `now`). A stamped item stays done even if the fact later drops. The level is the larger of the stored level and the level the latched items earn, and a level the record already holds counts as satisfied, so a missing item of it never blocks the climb above. `reachedAt` stamps each level once.
4. **Service.** `src/core/worca-levels/service.mjs` re-reads facts on every state request, evaluates, and writes the record only when it changed. A record from before the current ladder is migrated at its first evaluation (`migrate.mjs`): it keeps its level as a floor from Runner up, keeps the `parallelFeatures`, `addonInstalled` and `addonsAtOnce` stamps, and gets one summary when the credit is new and there was past activity. The level is credited as held, so it is not also celebrated.
   `POST /api/worca-level/ack` takes `{ what: 'celebration', index }`, `{ what: 'summary' }`, `{ what: 'nudge', id }` or `{ what: 'mode-suggestion', mode, answer }`. The celebration ack names the level that was shown, and the server records `max(celebrated, min(index, level))`, so a level reached between the view and the ack is still celebrated. A missing or out-of-range `index` (1 to 5) is a 400. `mode` is `advanced` or `expert` and `answer` is `accepted` or `dismissed`; the first answer stands. A stale tab's `welcome` ack is answered with the view and records nothing: there is no levels welcome any more.

### Progress shape

The next-level progress is `{ done, total, unit }`. `unit: 'items'` counts the shown items of the next level that are done (a pick item counts as one). When the next level is Worca's Council it is `{ done: min(active days in the window, 20), total: 20, unit: 'days' }`, drawn as 20 thin segments. At the top level progress is null and no segments are drawn. Items with a count carry it until done: `runnerSteps` its steps, `realRuns` its runs, `hookedRuns` its runs and days, a pick item the choices done.

### Time zone

The client sends `tz = Intl.DateTimeFormat().resolvedOptions().timeZone` on every level request (GET query `?tz=`, and in the ack body). The server validates it and stores it on the person's record when it changed. When the value is missing or invalid it uses the stored `record.tz`, else the server zone. An invalid `tz` never fails a request. Past latches are unaffected when the zone changes.

### The timeline algorithms

All live in `src/core/worca-levels/timeline.mjs`, are pure and take `now` from the caller.

- **First parallel pair (`firstParallelPair`).** Intervals are the person's real runs, `started_at` to the finish instant. They are sorted by start and swept with a min-heap of ends, O(n log n), with no self-join over all runs. For each interval that starts before the earliest open end, the pair's finish is the later of the two ends. The earliest such finish over all pairs is `doneAt`.
- **Runs on days (`firstRunsOnDays`).** Real runs are walked oldest finish first. `metAt` is the finish of the first run at which 10 runs and 3 distinct local days both hold. Runs of one schedule add one day in total.
- **Active days (`activeDayKeys`, `activeDaysWindow`).** Each real run's finish is mapped to a calendar day in the person's zone (`dayKey`); runs of one schedule count one day, the day of its first finish. Day numbers are compared with calendar arithmetic on the `YYYY-MM-DD` key, done on the UTC date, so a daylight saving change never shifts a day. `inWindow` counts the active days in the last 30 days including today; `metAt` is the first finish that completed 20 active days inside some 30-day window.

### Skipping expensive sources

`gatherFacts` takes `skip`, a set of source names. A skipped source is not run and returns its neutral value. The service skips `parallel` once `doneAt.parallelFeatures` is set on a record already under the current ladder. Its condition is already latched, so skipping never changes a level. The first evaluation of a migrated record reads every source.

## 4. Who counts as the person

The route layer calls `resolveIdentity(req)` in `src/core/identity.mjs`. Nothing else decides identity.

- **Single-person install** (`operator` or `local` source): the person key is the fixed `_local`. Fact queries do not filter by person, so every row counts. This also covers old runs with a NULL `started_by`.
- **Shared install** (`access` or `header` source, see `isSharedIdentity`): the key is the lowercased identity name. Runs are filtered to that person, by who started the run, else the credit key a deleted run keeps.

`personOf` in `service.mjs` makes this choice.

## 5. Known limits

- **A run's finish is `finished_at`, else `updated_at`.** A run from before `finished_at` existed uses `updated_at`, which a title change or a pause and resume can stretch. Overlap needs both runs to be real runs, which limits the impact.
- **Merged pull requests need a readable state.** A run with a pull request and no recorded state shows its item as unknown, never as undone. It is not met until the state is known.
- **Page views feed no level.** The `stats-viewed` and `team-metrics-viewed` events are accepted from a stale tab and record nothing.
- **Runner's "Getting started 1 to 6" is install-wide.** It is credited from install state, which is what the person's checklist shows. A person who joins an already set-up shared install gets it credited. Steps 7 to 9 (Workspaces, Team metrics, Team policy) are never read.
- **A shared install does not credit add-ons installed before levels shipped or through the CLI.** On a single-person install the plugin lock backfills add-ons. On a shared install only the person's own live events count, and only while the add-on is still in the lock, because installs cannot otherwise be attributed to a person.
- **Reads write.** The state request latches and raises the record. It is idempotent and serialised through the store queue.
- **Pokes reach every socket.** The `worca-level-changed` event carries no payload; each client re-reads only its own view.

## 6. Storage

State lives in `<settings root>/.worca-cc/worca-levels.json`, next to `away-people.json`. The path is `worcaLevelsFile()` in `src/core/worca-levels/store.mjs`. Shape: `{ version: 1, people: { [key]: record } }`. A record holds `rules` (2 once written under the current ladder), the level, `celebrated`, `doneAt`, `reachedAt`, `summary`, `nudged`, `modeSuggestion`, `tz`, and the live fields (`addons`, `addonPeak`; older records may still carry `spaces`, `statsViewedAt` and `teamMetricsOpenedAt`, which no level reads).

- `updatePerson` is the only writer. Updates go through an in-process promise queue and `writeJsonAtomic`, so parallel updates for one person do not lose writes.
- **Corrupt file.** An unreadable or wrongly shaped file is renamed to `worca-levels.json.corrupt-<timestamp>`, a warning is logged, and the store starts empty. It never throws. People are then re-evaluated from facts and start at their earned level, but live-only history (shared-install add-ons) is lost with the file, and a person's first evaluation runs again.
- A missing file reads as empty.
- Person keys of `__proto__`, `constructor` and `prototype` are rejected.
- **Safety on read.** `store.mjs` answers an unreadable file (anything but a missing one) as empty to readers but refuses to write over it, so a transient read error cannot erase other people's records.

## 7. Client wiring

`ui/public/worca-level/app-wiring.mjs` is what `app.js` calls: it fetches the view at boot and after a payload-free poke (a sequence guard drops an older answer that arrives late), repaints the corner and the Getting started line, mounts the compact level card (`ui/public/worca-level/level-card.mjs`: avatar, name and "View level", then "To <Next>" with the count and a small segment bar) at the top of the account menu, which opens on a click or Enter (nothing opens on hover or focus; clicking the card goes straight to `#profile/level` and closes the menu, with nothing in between; a person with no level yet sees their initials, the step that earns the first level and one action), and opens the celebration or summary dialog (`dialogs.mjs`). A summary outranks a celebration. A dialog never opens while a blocking prompt, the setup assistant or another modal is on screen, nor while a live run is open; Runner's celebration also waits until a run-result page has been on screen. It retries on the next poke or settle, and never hides or re-orders prompt nodes. `notices.mjs` builds the run-finished and almost-there toasts, and `mode-suggestion.mjs` paints the Interface-mode banner into the `mode-suggest-host` element of the main column; the mode changes only inside the accept click. Profile (`profile-view.mjs`) is the page that shows the level in full; it has no sidebar entry and opens from "View level" on the account-menu level card, "See levels" on the Getting started line and "See your level" in the level-up dialog. Styles are in `ui/public/worca-level/worca-level.css`. Links the server sends are rendered only when they start with `#`.
