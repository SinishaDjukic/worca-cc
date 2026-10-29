# Scheduled runs

Start a pipeline later — once, or on a repeat — from the web UI, the CLI or the API.
Every scheduling input is optional: a caller that does not schedule sees no change in
any request, response, status or output.

> **One honest limit.** Worca has no background daemon. A scheduled run starts only
> while a Worca process is up — the UI server (`worca ui`) or a waiting terminal
> (`--wait`) — and the machine is awake. A missed slot is handled explicitly, never
> silently: see [Missed slots](#missed-slots).

## How it works

A run that waits for its start time is a **launch ticket**, not a pipeline:

| Table | Purpose |
| --- | --- |
| `scheduled_runs` | One ticket per planned start. Its id **is** the `runId` the fired run carries, so links made at scheduling time (deep links, Ask cards) survive the start. |
| `schedules` | The parent of a repeating series: the rule and its policies. It materialises only its **next** occurrence as a ticket. One-off runs have no parent. |
| `notifications` | The append-only activity log (scope `schedule`) behind the feed, the unread badge and chat notices. |
| `pipelines` | Two nullable provenance columns only: `scheduled_for`, `schedule_id`. |

The pipeline row is still born inside `run()`. Nothing that enumerates pipeline
statuses — stats, the stale-run sweep, the delete guard, team metrics, task-source
write-back — ever meets a waiting row, and an older Worca on the same database
simply ignores the new tables (pending tickets do not start while it is the one
running).

Ticket states: `scheduled → firing → fired`, then the pipeline's own states. Side
exits: `canceled`, `skipped` (overlap, or skipped by hand), `missed`, `failed`. A
transient start error sends `firing` back to `scheduled` with a retry delay.

The UI server is the scheduler: a 30 s tick claims due tickets with one guarded
`UPDATE … WHERE status = 'scheduled'` (two servers on one home can never start a run
twice) and pushes each through the **same** start path as `POST /api/run` — so a
scheduled run is validated when it is scheduled and again when it starts.

## What is stored, and what is read at start

Text you authored is part of the request and is stored with it. Anything owned by
another system is referenced, and read when the run starts.

| Item | When scheduled | At start |
| --- | --- | --- |
| Inline prompt, title, markdown | stored on the ticket | used as stored |
| Prompt from a file (`--file`, `source.promptFile`) | the file's **content** is stored | used as stored |
| Uploaded / `--extras` files | copied to `<worcaHome>/scheduled/<id>/extras` | handed to the pipeline; removed after a one-off run, kept for a series |
| External task (plugin source, e.g. a GitHub issue) | reference only | fetched through `getTask`, as every run does; network / rate-limit / timeout errors retry with backoff inside the grace window, anything else fails at once |
| Workflow, guardrail set | validated, id stored | validated again, current definition used |
| Source branch | ref validated | worktree cut from the tip at start |
| Feature branch | name stored | a series appends `-YYYYMMDD` (plus `-HHMM` when it runs several times a day) so each occurrence has its own branch |
| Models, run config, tools | — | resolved in preflight, as today |
| Total cost budget | warning only | enforced; a blocked budget fails the ticket |

A workflow that asks questions behaves exactly as designed: an unattended run waits
for the answer (chat can deliver it). Nothing in the engine changes.

A schedule made from a [run preset](run-presets.md#schedules) follows the preset: it stores a
link, and each time it fires the preset's **current** setup (workflow, engine, guardrails, agent
picks, branches, tags) replaces the stored choices, while the prompt, title and target stay the
schedule's own. A choice you changed from the preset before scheduling (in the form, or on an Ask
Worca card) is kept as you made it. A preset that was deleted, or that can no longer start, fails
the run with a reason that names the preset or the broken item.

## Missed slots

Overdue tickets are judged at boot and on every tick. Within the grace window
(default 6 h, per schedule) the run starts late and the feed says so; beyond it — or
when the schedule says *skip* — the ticket becomes `missed` and waits for **Run
now** / **Reschedule**. For a series the grace is capped at the time to the next
occurrence, and the next slot is always computed from *now*: at most one late
occurrence starts after downtime, a backlog is never replayed.

A sub-daily series (several times a day) is not capped by the next slot: after downtime
it starts **one** catch-up run within its grace and reports the slots that passed in one
*missed* item; the grid then resumes. Its missed slots notify but do not count toward the
failure streak, and an overlap skip leaves no feed item (the skipped occurrence is in its
history).

## After another run

A one-off run can wait for a **run** instead of a time — a running (or already finished)
pipeline, or another one-off scheduled run — and can start on that run's feature branch.
Chain three and you have a train: refactor → tests → docs, each on the branch the previous
one left.

- **Predecessor.** A pipeline (any run in **Runs**) or a one-off scheduled run.
  Never a repeating schedule: give one of its runs instead. Both must target the same project
  or the same workspace.
- **Gate.** By default the dependent starts only when the predecessor finishes `done`.
  *Start even if it fails or is stopped* (`afterPolicy: any`) also accepts `error`, `stopped`
  and `interrupted`. A predecessor that ends any other way — or is canceled, missed, skipped
  or archived — leaves the dependent **missed** with the reason, and *Run now* still starts it.
  A paused predecessor keeps the dependent waiting; there is no grace and no missed-slot
  policy on an after-run.
- **Source branch from the run before it.** Pick *Branch of the run before it* in New
  pipeline (or `sourceFromPrevious: true`): when the ticket fires, the predecessor's feature
  branch — per member project for a workspace — becomes this run's source branch. Feature
  branches always survive a run, so a `done` predecessor always has one. Any scheduled run,
  timed or not, may also pick a finished run's branch from the *Run branches* group of the
  Source branch picker.
- **When it starts.** The scheduler tick (30 s) reads the predecessor's state from the
  database, so a predecessor that ends in a `--wait` terminal or another server is seen too;
  a run ending in the UI server nudges an extra tick. The ticket's time becomes the moment
  the gate opened; from there the usual retry rules apply.
- **Edit.** *Change…* on the card switches between a time and a predecessor. Canceling a
  predecessor, or archiving its pipeline (History's delete keeps the row but removes its
  branch), names the runs that wait for it; they are marked missed on the next tick. A run cannot wait for itself, directly or through a chain.
- **Entry points.** **Run after** (*Schedule a run after this*) on a run's page;
  *Schedule next…* on a scheduled run's card; the **After a run** side of the schedule sheet's kind switch.
  All open New pipeline with the pick made (`#new/after/<id>`).

An older worca on the same home never starts an after-run early: until its gate opens the
ticket's time is the year 9999, which that build shows as a run "in 7973 years". Run one
build per home.

## Repeating schedules

A rule is wall-clock time in an IANA timezone, never a UTC instant — "02:00 every
night" stays 02:00 across daylight-saving changes. A local time that does not exist
moves past the gap; one that occurs twice fires once.

```jsonc
{ "freq": "weekly",                 // daily | weekly | monthly
  "interval": 1,                    // every N
  "weekdays": ["mo","tu","we","th","fr"],
  "monthDay": 1,                    // 1..31 (clamped to the month) | "last"
  // ONE of:
  "time": "02:00",                  // once a day
  // "times": ["09:00","13:00","17:00"],                    2..96 fixed times a day
  // "step": { "minutes": 15, "from": "09:00", "to": "18:00" }   every N minutes (15..1440) in a daily time range
  "tz": "Europe/Berlin",
  "end": { "type": "never" } }      // | { "type":"until","until":"2026-12-31" } | { "type":"count","count":10 }
```

- **Several times a day.** `times` runs at each listed time; `step` runs every N minutes
  (hours are stored as minutes: `2h` is `120`). Every N minutes restarts each matching day
  at the range start (00:00 without one), and the range end is included: hourly from 09:00
  to 18:00 runs at 09:00 … 18:00.
- Runs of one schedule must be **at least 15 minutes apart**, across midnight too (the last
  run of one day and the first of the next, when two matching days can follow each other).
- The time range cannot cross midnight: use two schedules or a `times` list.
- Around a daylight-saving change a sub-daily slot that does not exist has no run, and a
  repeated hour runs once. A once-a-day time still moves past the gap.
- `until` is the last local date (all its slots run); `count` counts runs.

- **Overlap** (`skip` · `queue` · `start`): what to do when the previous occurrence is
  still starting, running or pausing. `queue` holds one occurrence until the previous
  run ends. A *paused* previous run does not block.
- **Failure streak** (`maxFailures`, default 3, `0` = never): a ticket that could not
  start, a missed slot (a missed slot of a sub-daily series does not), or a run that ended in an error each count; a run you stopped
  and a paused run do not; a successful run resets it. At the limit the schedule
  pauses itself and says so. Every failure is reported either way.
- Editing a schedule **replaces** its pending occurrence. *Run now* adds one extra
  occurrence; the series does not shift.

The rule maths, the sentence ("Every weekday at 02:00", "Every 15 minutes, 09:00–18:00, weekdays",
"Every day at 09:00, 13:00 and 17:00") and the parsers live in
`src/shared/schedule/recurrence.mjs` — one module for the server, the CLI and the
browser, so the editor's preview is what will run.

## CLI

```bash
worca --prompt "Upgrade dependencies" --at "tomorrow 02:00"     # once
worca --prompt "…" --at 02:00 --wait                             # …and start it from this terminal
worca --file task.md --every "weekdays 02:00"                    # repeat
worca --prompt "…" --every "15m 09:00-18:00 weekdays"           # every 15 minutes, office hours
worca --prompt "…" --every "day 09:00,13:00,17:00"              # several fixed times a day
worca --memory-scope global --workflow wf_memory_defrag --every "day 03:30"
worca --prompt "…" --cron "0 2 * * 1-5"                          # cron subset (*/N, ranges, lists)
worca --prompt "Add tests" --after 1a2b3c4d --source-from-previous   # when that run ends, on its branch
worca --prompt "Docs" --after 1a2b3c4d --after-any                    # even if it fails or is stopped

worca schedule list | show <id> | run-now <id> | move <id> --at "…"
worca schedule move <id> --after <id>
worca schedule cancel <id> | skip <id> | pause <id> | resume <id> | log [--unread]
```

`--at` takes `02:00` (next occurrence), `today 22:00`, `tomorrow 02:00`, `+90m`,
`2026-09-19 02:00`, or ISO 8601 with an offset — local time unless an offset is
given (`--tz` overrides the zone). More: `--until`, `--count`, `--overlap`,
`--max-failures`, `--if-missed run|skip`, `--grace 6h`. See `worca schedule help`.

The CLI writes straight into the shared database, so scheduling needs no running
server. `--wait` holds the terminal: the process owns its ticket (the server shows
it but never starts it while the owner is alive), polls the row so **Run now**,
**Change time** and **Cancel** from the UI still work, and hands the ticket back to
the server on Ctrl+C. `--model`, `--permission-mode` and `--yes` survive the wait.

`worca schedule show` on an after-run prints `after`, `on error` (start anyway / do not
start) and `source` instead of `when` and `if missed`. `worca schedule cancel` has no
confirmation and names no dependents — check `worca schedule list` before canceling a run
others wait for; they are marked missed on the next tick.

## API

```
POST /api/run            + scheduledFor (ISO 8601 with offset or Z)      -> 202 { runId, status:"scheduled", scheduledFor }
                         + repeat { rule, overlap?, maxFailures? }        -> 202 { …, scheduleId, sentence }
                         + ifMissed ("run"|"skip"), graceMin (0..10080)
POST /api/run            + after { kind:"ticket"|"pipeline", id }, afterPolicy? ("done"|"any"), sourceFromPrevious?
                                                                          -> 202 { runId, status:"scheduled", after:{kind,id,title}, sourceFromPrevious }
POST /api/schedules/resume  { pipelineId, scheduledFor | after, afterPolicy?, ifMissed?, graceMin?, engine? }
                         resume a paused run at a time, or after another run ends (never both; a resume
                         never waits on its own run or on a run that waits on it, and has no sourceFromPrevious)
                                                                          -> 202 { runId, status:"scheduled", scheduledFor|after, resumePipelineId }
GET    /api/schedules[?projectDir=|workspaceId=][&all=1]  -> { schedules, tickets, counts, defaults }
GET    /api/schedules/:id                                 -> { kind, item, history, notifications }
GET    /api/schedules/after-candidates?projectDir=|workspaceId=  -> { runs, tickets }
GET    /api/schedules/after/:id                                  -> { kind, id, title, status, projectDir, workspaceId }
PATCH  /api/schedules/:id         ticket: { scheduledFor?, ifMissed?, graceMin? }
                                  series: { title?, rule?, overlap?, maxFailures?, ifMissed?, graceMin? }
PATCH  /api/schedules/:id         ticket: { after?, afterPolicy?, sourceFromPrevious? }  (after OR scheduledFor)
DELETE /api/schedules/:id         cancel a one-off ticket / delete a series
POST   /api/schedules/:id/run-now | skip-next | pause | resume
POST   /api/schedules/preview     { rule, count? } -> { rule, sentence, next[] }
GET    /api/schedules/dependents?workflowId=|projectDir=|workspaceId=
GET    /api/schedules/dependents?pipelineId=|ticketId=
GET    /api/branches              + runs: [{ branch, pipelineId, title, status, endedAt }]
GET    /api/notifications?scope=schedule[&unread=1][&problems=1]
POST   /api/notifications/:id/read { read? } · POST /api/notifications/read-all
```

Without `scheduledFor`/`repeat`, `POST /api/run` answers `200 { runId }` exactly as
before. `GET /api/runs` gains an additive `scheduled: []`; `GET /api/counts` gains
`schedules`. WebSocket broadcasts: `schedules-changed`, `notification`,
`notifications-changed`. A time without an offset is a 400 — the server cannot know
the caller's zone — and so is a time in the past.

## UI

![Schedules view on the Repeating tab: three active repeating schedules (a monthly flaky-test sweep, a weekly broken-link sweep and a nightly dependency audit) for demo projects, each with its rule, project, next start time, pause switch and Run now, Skip next, Edit and Delete buttons](screenshots/schedules.png)

- **New pipeline** and the **Ask run card**: *Start run* is a split button;
  *Schedule…* opens the schedule sheet at once — before the prompt is typed — and the
  pick waits on the form while *Start run* reads as **Schedule**. The sheet builds a
  sentence and shows the next three dates; presets are Once, Every day, Weekdays,
  Weekly, Monthly, Custom; *Times a day* picks one time, a list of times, or every N
  minutes/hours, optionally only between two times. An Ask card that becomes a repeating schedule follows the
  series (Run now, Delete schedule) instead of one run.
- **Schedules › Schedule a run** picks the time FIRST: it opens New pipeline with the
  schedule sheet already up (`#new/schedule`); the pick then waits on the form
  ("Scheduled · Starts Sat Sep 19, 02:00 · Change… · Start now instead") and *Start run*
  reads as **Schedule**, so describing the task and one click schedules it. The pick is
  never persisted — a reload is a plain form — and the menu's *Start run now* ignores it.
- **Schedules** (sidebar), three tabs routed as `#schedules[/once|/repeating]`:
  **Activity** — the feed; **Once** — one-off runs with Run now, Change time, Cancel;
  **Repeating** — the series with Run now, Skip next, Edit, a pause switch and Delete.
  Every card names its target first: *Project · shop* or *Workspace · Storefront*.
  Problems (missed, failed, paused itself, run error) count towards the amber unread
  badge and resolve themselves when you act on them; completed, late and skipped
  items arrive read. Notifications are purged after 90 days, ended tickets after 30.
- **Runs** lists upcoming and missed runs beside live and finished ones. A run's page
  header says *Started by schedule* (or *Started by a repeating schedule*), linking to
  Schedules. **Settings › Runs › Scheduled runs** holds the defaults a new
  schedule inherits.
- Removing a project or workspace cancels its schedules; the confirmation names them.
- **Interface mode** ([ui-levels.md](ui-levels.md)): the Schedules entry, *Start run*'s
  caret and the Settings card are Advanced. The Schedules entry stays visible in every
  mode while anything is scheduled, missed, repeating or unread, and a schedule Ask
  Worca proposed shows on its card in every mode.

## Chat

Chat can schedule on your behalf and manage what is scheduled. The rule it follows:
**anything that starts, moves, edits, cancels or deletes a run is a card you confirm**;
the small reversible changes it makes directly, and only when you ask.

| Tool | What it does | How |
| --- | --- | --- |
| `propose_run` + `when` / `every` | A run card whose main button is **Schedule** (*Start now* is the alternative, *Change…* opens the schedule sheet) | card |
| `preview_schedule` | Your words → the exact time, or the sentence and the next three dates. Nothing is created | read |
| `list_schedules`, `get_schedule`, `list_schedule_activity` | What is scheduled, one schedule's runs and policies, the activity feed | read |
| `propose_schedule_change` | `run_now`, `move` (a one-off run), `edit` (a series: every, until, count, overlap, maxFailures, title), `cancel`, `delete` | card |
| `propose_run` + `after` (+ `afterPolicy`, `sourceFromPrevious`) | A run card whose main button is **Schedule**: it starts when that run ends, on its branch when asked | card |
| `propose_schedule_change` `move` + `after` | Point a one-off run at another run instead of a time | card |
| `pause_schedule`, `resume_schedule`, `skip_next_run`, `mark_schedule_activity_read` | Reversible, never start a run | direct |
| `list_task_sources`, `find_tasks`, `get_task` | The installed task sources (GitHub Issues, Jira, …) with their inputs and profile bindings; search one; read one task | read |
| `propose_run` + `source` | A run whose task is a tracker task — a reference the run fetches when it starts | card |

**Tracker tasks.** "Schedule a fix for Jira bug PROJ-123 with auto, tonight at 2" becomes one card:
Chat finds the issue (`list_task_sources` → `find_tasks` / `get_task`) and proposes a run
with `source {plugin, sourceId, taskId, profile?, inputs?}` instead of a brief, `workflowId
"wf_auto"` and `when`. The card shows the task (id, title, link) where the brief would be, and
starting or scheduling it sends POST /api/run what New run's source pane sends (plus, on a saved
workflow, the per-agent picks Chat proposed for this run as its `overlay`) — so the run reads
the issue as it is when it starts, and can write its result back.
- The parent looks the task up once (`src/core/ask/source-spec.mjs checkTask`): a missing task
  refuses the card; a network, rate-limit or timeout failure keeps it with a warning (the run
  fetches it again at start). Only the `listTasks` and `getTask` ops are reachable from Ask.
- A multi-profile source uses the profile the project (or workspace) is bound to; when none is
  bound Ask asks which. A brief and a source together are refused — POST /api/run takes one.
- **Auto** (`wf_auto`) picks the workflow from the task when the run starts, on a project or a
  workspace. With human-in-the-loop on (a project's stored switch; a workspace run is on by
  default), an Auto run waits for its proposed workflow to be accepted, which an unattended
  run cannot do by itself — Ask says so.
- *Open in New run* is hidden on a tracker-task card: the source pane cannot be pre-filled
  from a card yet.

- **Your words, your clock.** The model passes what you said in the CLI's forms
  (`tomorrow 02:00`, `+90m`, `weekdays 02:00`, `month last 03:00`, `30m 09:00-18:00 weekdays`) and never computes a
  date: `src/core/ask/schedule-spec.mjs` reads them in the timezone your browser reports
  (sent with every message, shown in the context block as *user's time*), with the same
  shared module the schedule sheet uses. A series keeps its own zone when edited.
- **Validated twice.** Like every Ask card, the MCP child validates for the model and the
  server re-validates the tool input against the live rows before a card appears — a
  change the rows no longer allow becomes a notice, never a card. Applying a schedule
  card runs the same code as the matching button on the Schedules page
  (`scheduleVerb` in `ui/server.mjs`), then Chat gets a
  `[worca event] schedule card <id> applied | declined | failed` turn and confirms.
- **Where a run came from.** `get_run` carries `startedBy { scheduledFor, scheduleId }`
  for a run a schedule started. A scheduled or repeating card is listed in the context
  block, so the model does not propose it again.
- A direct write in the MCP child repaints open tabs: the server turns it into the same
  `schedules-changed` / `notifications-changed` broadcasts the REST routes send.
