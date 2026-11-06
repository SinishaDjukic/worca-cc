# Worca levels

A maintainer reference for the usage-level feature. It points at the code and does not restate it.

## 1. What it is

Worca levels show a person how far into Worca they have got. There are four levels, each with a piece of worca art:

| Level | Name | Art file |
|---|---|---|
| 1 | Calf | `calf.svg` |
| 2 | Swimmer | `swimmer.svg` |
| 3 | Hunter | `hunter.svg` |
| 4 | Pod Leader | `pod-leader.svg` |

- **Personal.** Each person has their own level; nobody sees anyone else's.
- **Always on.** There is no feature flag and no opt-out.
- **Levels only go up.** Once an action is done it stays done, and a level is never lowered.
- **Existing users start at a backfilled level.** A first evaluation looks at what the person already did and starts them there. Nothing before that level is celebrated.

The art files are in `ui/public/assets/worca-levels/`. The ladder is defined in `src/shared/worca-levels.mjs`.

## 2. The ladder

Actions and deep links come from `WORCA_LEVELS` in `src/shared/worca-levels.mjs`. A level is reached when every action of that level and the levels below it is done.

| Level | Action id | Link |
|---|---|---|
| Calf | none (everyone starts here) | |
| Swimmer | `gettingStarted` | `#getting-started` |
| Swimmer | `firstRequirement` | `#requirements` |
| Swimmer | `firstFeatureDone` | `#requirements` |
| Hunter | `addonInstalled` | `#marketplace` |
| Hunter | `spaceSetUp` | `#workspaces` |
| Hunter | `scheduleCreated` | `#schedules` |
| Hunter | `statsViewed` | `#stats` |
| Pod Leader | `parallelFeatures` | `#runs` |
| Pod Leader | `addonsInUse` | `#marketplace` |
| Pod Leader | `scheduledRuns` | `#schedules` |
| Pod Leader | `metricsRegular` | `#stats` |

Marketplace, Workspaces, Schedules and Stats are hidden from the sidebar in Simple mode, so those hints say the link opens the page anyway.

## 3. How progress is computed

1. **Facts.** `src/core/worca-levels/facts.mjs` (`gatherFacts`) reads numbers and booleans from real actions: the database (runs, requirements, schedules, workspaces, phase times), the plugin lock, the `requirements` flag, Getting started's status, and the person's live record. Each source is guarded. One that fails is logged and counts as 0 or false, so `gatherFacts` never throws.
2. **Conditions.** `src/core/worca-levels/evaluate.mjs` holds one condition per action id. `evaluate` is pure: facts, the stored record and `now` in; level, `doneAt`, progress and next actions out.
3. **The latch (`doneAt`).** The first time an action's condition is met, `evaluate` stamps it in `doneAt`. A stamped action stays done even if the fact later drops, for example when an add-on is removed. The level is the larger of the stored level and the level the latched actions earn.
4. **Service.** `src/core/worca-levels/service.mjs` re-reads facts on every state request, evaluates, and writes the record only when it changed. It decides when a level-up is celebrated and when the welcome shows.
   `POST /api/worca-level/ack` takes `{ what: 'welcome' }` or `{ what: 'celebration', index }`. The celebration ack names the level that was shown, and the server records `max(celebrated, min(index, level))`, so a level reached between the view and the ack is still celebrated. A missing or out-of-range `index` is a 400.

Thresholds are the `WORCA_THRESHOLDS` constants in `src/shared/worca-levels.mjs`:

| Constant | Value | Meaning |
|---|---|---|
| `parallelFeatures` | 2 | runs in flight at once |
| `addonsInUse` | 2 | add-ons enabled |
| `scheduledRuns` | 5 | runs started from a schedule |
| `metricsDays` | 3 | distinct days on Stats |

Parallel runs come from a sweep over phase times (`peakParallelBackfill`, last 90 days) combined with the live peak the route hooks record. Stats days come only from live events: the Stats view sends `stats-viewed`, and the store keeps the last 30 distinct UTC days. Stats views are not backfilled.

## 4. Who counts as the person

The route layer calls `resolveIdentity(req)` in `src/core/identity.mjs`. Nothing else decides identity.

- **Single-person install** (`operator` or `local` source): the person key is the fixed `_local`. Fact queries do not filter by person, so every row counts. This also covers old runs with a NULL `started_by`.
- **Shared install** (`access` or `header` source, see `isSharedIdentity`): the key is the lowercased identity name. Runs, requirements and schedules are filtered to that person.

`personOf` in `service.mjs` makes this choice.

## 5. Known limits

- **Add-ons and spaces on shared installs.** On a single-person install they are read from the plugin lock and the workspaces table, which backfills. On a shared install only the person's own live events count (decision D-4). Add-ons and spaces created before levels shipped, and anything done through the CLI, cannot be attributed to a person, so they are not credited.
- **Getting started is install-wide.** It is credited from install state, which is what the person's checklist shows. A person who joins an already set-up shared install gets it credited.
- **Reads write.** The state request latches and raises the record. It is idempotent and serialised through the store queue.
- **Pokes reach every socket.** The `worca-level-changed` event carries no payload; each client re-reads only its own view.

## 6. Storage

State lives in `<settings root>/.worca-cc/worca-levels.json`, next to `away-people.json`. The path is `worcaLevelsFile()` in `src/core/worca-levels/store.mjs`. Shape: `{ version: 1, people: { [key]: record } }`.

- `updatePerson` is the only writer. Updates go through an in-process promise queue and `writeJsonAtomic`, so parallel updates for one person do not lose writes.
- **Corrupt file.** An unreadable or wrongly shaped file is renamed to `worca-levels.json.corrupt-<timestamp>`, a warning is logged, and the store starts empty. It never throws. People are then re-evaluated from facts and start at their backfilled level, but live-only history (Stats days, shared-install add-ons and spaces) is lost with the file.
- A missing file reads as empty.
- Person keys of `__proto__`, `constructor` and `prototype` are rejected.

## 7. Open decisions pending the PO

These are planner choices, not yet confirmed. They do not block the feature.

- **D-1: four levels on five-level art.** The requirements ask for four levels, and the design art has five. The four are mapped Calf, Swimmer, Hunter, Pod Leader, and Council is dropped. Copy says "Level n of 4".
- **D-6: `requirements` flag off.** With the flag off there is no requirement to write, so `firstRequirement` is done on the person's first started run. It stays in the ladder so Swimmer keeps three actions. The served view then words `firstRequirement` and `firstFeatureDone` as tasks and links them to `#new`, because `#requirements` redirects to chat while the flag is off.
- **D-7: `metricsRegular` = 3 days.** Statistics viewed on three distinct days. The number is a planner choice.

## 8. Client wiring

`ui/public/worca-level/app-wiring.mjs` is what `app.js` calls: it fetches the view at boot and after a payload-free poke (a sequence guard drops an older answer that arrives late), repaints the corner and the Getting started line, mounts the "Your level" row at the top of the account menu, and opens the welcome or celebration dialog. Styles are in `ui/public/worca-level/worca-level.css`. Links the server sends are rendered only when they start with `#`.

## 9. Store safety

`store.mjs` answers an unreadable file (anything but a missing one) as empty to readers but refuses to write over it, so a transient read error cannot erase other people's records. A corrupt file is moved aside as before.
