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
| Feature branch | name stored | a series appends `-YYYYMMDD` so each occurrence has its own branch |
| Models, run config, tools | — | resolved in preflight, as today |
| Total cost budget | warning only | enforced; a blocked budget fails the ticket |

A workflow that asks questions behaves exactly as designed: an unattended run waits
for the answer (chat can deliver it). Nothing in the engine changes.

## Missed slots

Overdue tickets are judged at boot and on every tick. Within the grace window
(default 6 h, per schedule) the run starts late and the feed says so; beyond it — or
when the schedule says *skip* — the ticket becomes `missed` and waits for **Run
now** / **Reschedule**. For a series the grace is capped at the time to the next
occurrence, and the next slot is always computed from *now*: at most one late
occurrence starts after downtime, a backlog is never replayed.

## Repeating schedules

A rule is wall-clock time in an IANA timezone, never a UTC instant — "02:00 every
night" stays 02:00 across daylight-saving changes. A local time that does not exist
moves past the gap; one that occurs twice fires once.

```jsonc
{ "freq": "weekly",                 // daily | weekly | monthly
  "interval": 1,                    // every N
  "weekdays": ["mo","tu","we","th","fr"],
  "monthDay": 1,                    // 1..31 (clamped to the month) | "last"
  "time": "02:00", "tz": "Europe/Berlin",
  "end": { "type": "never" } }      // | { "type":"until","until":"2026-12-31" } | { "type":"count","count":10 }
```

- **Overlap** (`skip` · `queue` · `start`): what to do when the previous occurrence is
  still starting, running or pausing. `queue` holds one occurrence until the previous
  run ends. A *paused* previous run does not block.
- **Failure streak** (`maxFailures`, default 3, `0` = never): a ticket that could not
  start, a missed slot, or a run that ended in an error each count; a run you stopped
  and a paused run do not; a successful run resets it. At the limit the schedule
  pauses itself and says so. Every failure is reported either way.
- Editing a schedule **replaces** its pending occurrence. *Run now* adds one extra
  occurrence; the series does not shift.

The rule maths, the sentence ("Every weekday at 02:00") and the parsers live in
`src/shared/schedule/recurrence.mjs` — one module for the server, the CLI and the
browser, so the editor's preview is what will run.

## CLI

```bash
worca --prompt "Upgrade dependencies" --at "tomorrow 02:00"     # once
worca --prompt "…" --at 02:00 --wait                             # …and start it from this terminal
worca --file task.md --every "weekdays 02:00"                    # repeat
worca --memory-scope global --workflow wf_memory_defrag --every "day 03:30"
worca --prompt "…" --cron "0 2 * * 1-5"                          # cron subset

worca schedule list | show <id> | run-now <id> | move <id> --at "…"
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

## API

```
POST /api/run            + scheduledFor (ISO 8601 with offset or Z)      -> 202 { runId, status:"scheduled", scheduledFor }
                         + repeat { rule, overlap?, maxFailures? }        -> 202 { …, scheduleId, sentence }
                         + ifMissed ("run"|"skip"), graceMin (0..10080)
GET    /api/schedules[?projectDir=|workspaceId=][&all=1]  -> { schedules, tickets, counts, defaults }
GET    /api/schedules/:id                                 -> { kind, item, history, notifications }
PATCH  /api/schedules/:id         ticket: { scheduledFor?, ifMissed?, graceMin? }
                                  series: { title?, rule?, overlap?, maxFailures?, ifMissed?, graceMin? }
DELETE /api/schedules/:id         cancel a one-off ticket / delete a series
POST   /api/schedules/:id/run-now | skip-next | pause | resume
POST   /api/schedules/preview     { rule, count? } -> { rule, sentence, next[] }
GET    /api/schedules/dependents?workflowId=|projectDir=|workspaceId=
GET    /api/notifications?scope=schedule[&unread=1][&problems=1]
POST   /api/notifications/:id/read { read? } · POST /api/notifications/read-all
```

Without `scheduledFor`/`repeat`, `POST /api/run` answers `200 { runId }` exactly as
before. `GET /api/runs` gains an additive `scheduled: []`; `GET /api/counts` gains
`schedules`. WebSocket broadcasts: `schedules-changed`, `notification`,
`notifications-changed`. A time without an offset is a 400 — the server cannot know
the caller's zone — and so is a time in the past.

## UI

- **New pipeline** and the **Ask run card**: *Start run* is a split button;
  *Schedule…* opens the schedule sheet after the form validates. The sheet builds a
  sentence and shows the next three dates; presets are Once, Every day, Weekdays,
  Weekly, Monthly, Custom. An Ask card that becomes a repeating schedule follows the
  series (Run now, Delete schedule) instead of one run.
- **Schedules** (sidebar): one-off runs and repeating schedules with Run now, Change
  time / Edit, Skip next, pause switch, Cancel / Delete — and the **Activity** feed.
  Problems (missed, failed, paused itself, run error) count towards the amber unread
  badge and resolve themselves when you act on them; completed, late and skipped
  items arrive read. Notifications are purged after 90 days, ended tickets after 30.
- **Running** shows what is due within 24 hours. **History** marks a run *Started by
  schedule*. **Settings › General › Scheduled runs** holds the defaults a new
  schedule inherits.
- Removing a project or workspace cancels its schedules; the confirmation names them.
- **Interface mode** ([ui-levels.md](ui-levels.md)): the Schedules entry, *Start run*'s
  caret and the Settings card are Advanced. The Schedules entry stays visible in every
  mode while anything is scheduled, missed, repeating or unread, and a schedule Ask
  Worca proposed shows on its card in every mode.

## Ask Worca

Ask Worca can schedule on your behalf and manage what is scheduled. The rule it follows:
**anything that starts, moves, edits, cancels or deletes a run is a card you confirm**;
the small reversible changes it makes directly, and only when you ask.

| Tool | What it does | How |
| --- | --- | --- |
| `propose_run` + `when` / `every` | A run card whose main button is **Schedule** (*Start now* is the alternative, *Change…* opens the schedule sheet) | card |
| `preview_schedule` | Your words → the exact time, or the sentence and the next three dates. Nothing is created | read |
| `list_schedules`, `get_schedule`, `list_schedule_activity` | What is scheduled, one schedule's runs and policies, the activity feed | read |
| `propose_schedule_change` | `run_now`, `move` (a one-off run), `edit` (a series: every, until, count, overlap, maxFailures, title), `cancel`, `delete` | card |
| `pause_schedule`, `resume_schedule`, `skip_next_run`, `mark_schedule_activity_read` | Reversible, never start a run | direct |
| `list_task_sources`, `find_tasks`, `get_task` | The installed task sources (GitHub Issues, Jira, …) with their inputs and profile bindings; search one; read one task | read |
| `propose_run` + `source` | A run whose task is a tracker task — a reference the run fetches when it starts | card |

**Tracker tasks.** "Schedule a fix for Jira bug PROJ-123 with auto, tonight at 2" becomes one card:
Ask Worca finds the issue (`list_task_sources` → `find_tasks` / `get_task`) and proposes a run
with `source {plugin, sourceId, taskId, profile?, inputs?}` instead of a brief, `workflowId
"wf_auto"` and `when`. The card shows the task (id, title, link) where the brief would be, and
starting or scheduling it sends POST /api/run exactly what New pipeline's source pane sends —
so the run reads the issue as it is when it starts, and can write its result back.
- The parent looks the task up once (`src/core/ask/source-spec.mjs checkTask`): a missing task
  refuses the card; a network, rate-limit or timeout failure keeps it with a warning (the run
  fetches it again at start). Only the `listTasks` and `getTask` ops are reachable from Ask.
- A multi-profile source uses the profile the project (or workspace) is bound to; when none is
  bound Ask asks which. A brief and a source together are refused — POST /api/run takes one.
- **Auto** (`wf_auto`) picks the workflow from the task when the run starts (projects only).
  In a project with human-in-the-loop on, an Auto run waits for its proposed workflow to be
  accepted, which an unattended run cannot do by itself — Ask says so.
- *Open in New Pipeline* is hidden on a tracker-task card: the source pane cannot be pre-filled
  from a card yet.

- **Your words, your clock.** The model passes what you said in the CLI's forms
  (`tomorrow 02:00`, `+90m`, `weekdays 02:00`, `month last 03:00`) and never computes a
  date: `src/core/ask/schedule-spec.mjs` reads them in the timezone your browser reports
  (sent with every message, shown in the context block as *user's time*), with the same
  shared module the schedule sheet uses. A series keeps its own zone when edited.
- **Validated twice.** Like every Ask card, the MCP child validates for the model and the
  server re-validates the tool input against the live rows before a card appears — a
  change the rows no longer allow becomes a notice, never a card. Applying a schedule
  card runs the same code as the matching button on the Schedules page
  (`scheduleVerb` in `ui/server.mjs`), then Ask Worca gets a
  `[worca event] schedule card <id> applied | declined | failed` turn and confirms.
- **Where a run came from.** `get_run` carries `startedBy { scheduledFor, scheduleId }`
  for a run a schedule started. A scheduled or repeating card is listed in the context
  block, so the model does not propose it again.
- A direct write in the MCP child repaints open tabs: the server turns it into the same
  `schedules-changed` / `notifications-changed` broadcasts the REST routes send.
