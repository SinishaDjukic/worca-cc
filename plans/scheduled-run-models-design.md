# Change the agents' models of a scheduled run — design

Status: approved design (2026-10-23), ready for the implementation plan
Builds on: PR #608 "Switch AI Models on Paused Workflows" (`src/core/model-switch.mjs`, the Models panel,
`worca switch-model`) and the scheduled-runs subsystem (`src/core/scheduler.mjs`, docs/scheduled-runs.md).

## Goal

A run that is **scheduled** — a one-off ticket, or a repeating schedule and the occurrences it has
already materialized — can have the model, effort and sub-agent model of its agent stages changed
before it fires, from the Schedules page, `worca switch-model` and the API. The same validation the
run route applies to per-agent picks applies here, so what a ticket fires is always something
`POST /api/run` would have accepted.

Success:

- On the Schedules page, a one-off card and a repeating card offer **Models…**; saving changes the
  stages' picks for that run, or for every run of the series from now on, and the card hints how many
  agents carry a pick.
- `worca switch-model <ticket-or-schedule-id>` lists the stages with their picks and changes them with
  the same `--stage`, `--model`, `--effort`, `--subagent-model` and `--all` flags as a run.
- A ticket or series that follows a run preset keeps the edit: the preset's agent picks no longer
  apply to it, and the card and CLI say so.
- A fired run uses the edited picks exactly as it uses picks made when the run was scheduled.

## Decisions (agreed)

| # | Decision |
|---|----------|
| D1 | **Scope: one-off tickets AND repeating schedules.** A series edit rewrites the series' request and every pending ticket already materialized from it (status `scheduled` or `missed`, never one that is `firing`), so the next occurrence follows. |
| D2 | **Surfaces: Schedules page, CLI and API.** The UI reuses the Models panel (`ui/public/model-switch.mjs`); the CLI extends `worca switch-model`; both ride two new routes. |
| D3 | **CLI: `worca switch-model` takes a ticket or schedule id too.** One command for a run that has not finished: scheduled, running or paused. No new `worca schedule` verb; `worca schedule show` gains an Agents block. |
| D4 | **Preset followers: the edit is an override that wins at fire time**, exactly like a choice changed before scheduling (`overriddenKeys` / `bodyFollowingPreset` `keep`): `overlay` is added to the request's `internal.presetOverrides`. |
| D5 | **Mechanism: edit the stored overlay** (`request.overlay.nodes`), checked with the run route's `checkRunOverlay`. Rejected: freezing a manifest on the ticket (breaks "workflow validated again, current definition used", docs/scheduled-runs.md) and a fire-time hook (two sources of truth, errors surface unattended). |
| D6 | **Fields: model, effort, sub-agent model** — the overlay's node keys the run card lane also sends (`CARD_NODE_KEYS`). Sub-agent effort is not an overlay key and is not offered; a request for it is refused, never dropped. |
| D7 | **No schema change.** Everything lives in the existing `request` JSON of `scheduled_runs` and `schedules`; `updated_by` records who. |

## Background: what a scheduled run stores and fires

- A ticket (`scheduled_runs`, UUID id) and a series (`schedules`, `sch_` id) store the full
  `POST /api/run` body as `request` (`storedRequestOf`, `ui/server.mjs`). Per-agent picks are
  `request.overlay.nodes[nodeId] = { model, effort, fanOut, askQuestions, subagentModel }`
  (`src/core/run-overlay.mjs` `OVERLAY_KEYS`), checked at scheduling time by `checkRunOverlay(nodes,
  { workflow, models, engine, wires })` and fired verbatim: `fireTicket` → `startRunHandler` with
  `internal` set, which skips the overlay check.
- `materializeNext(scheduleId)` copies `schedules.request` into the next ticket, so a series edit must
  also touch the pending ticket(s) (D1).
- A preset follower: `fireTicket` replaces every setup key of the stored request with the preset's
  current setup (`bodyFollowingPreset`), except the keys in `request.internal.presetOverrides`.
  `overlay` is a setup key (`PRESET_SETUP_KEYS`), so an edit must register it there (D4).
- The engine a ticket starts on is resolved at start: `resolveRunEngine({ explicit: body.engine,
  projectDir | workspace })` (`src/core/settings-cascade.mjs`). An edit validates against the same
  resolution, so the catalog it offers is the one the run will see unless the project's default engine
  changes in between — the same window every scheduled pick already has.
- The ticket item the Schedules page receives (`rowToTicket` / `GET /api/schedules/:id`) carries
  `summary` (`summarizeRequest`), not the request, so the UI cannot see picks today.
- `overlayWorkflowRefusal(workflow, { scan })` refuses an overlay for the Auto workflow (it picks
  models at start) and for a scan target. A resume ticket (`resumePipelineId`) has no request of
  its own to edit: the paused run it resumes is switched with the existing feature.
- The Models panel: `renderModelSwitchPanel(payload, { doc, onSave, onCancel })` takes
  `describeModelSwitch`'s payload (`stages[]` with `nodeId, key, label, model, effort, subagentModel,
  subagentEffort, fanOut, state, switchable`, plus `models`, `efforts`, `subagents`, `subagentModels`,
  `subagentEfforts`, `status`) and returns `picks()`; `diffChanges(stages, picks)` yields the changes;
  `switchNotice(out)` words the toast.
- `worca switch-model` resolves its id with `resolveRunRef` (`src/cli/runs.mjs`): pipelines only, by
  prefix, ambiguity refused.

## 1. Data

- A pick: `request.overlay.nodes[nodeId]` with any of `model`, `effort`, `subagentModel`. An overlay
  names values and never clears one, so **clearing a field deletes the key**; a node left without keys
  is deleted; `overlay.nodes` left empty is deleted (`overlay.wires` stays).
- `effort` rides only beside a `model` in the stored node (`checkRunOverlay` canonicalises a model with
  `effort: ''` = the model's default). An effort picked without a model, on a node whose stored pick
  has none, is refused by the checker ("an effort without a model"), as on the run card.
- Series: `schedules.request` is rewritten, then every ticket of the series with status `scheduled` or
  `missed` gets the same `request` (`request` only — its time, policies and `internal` are its own,
  except `presetOverrides`, see below).
- Preset follower (ticket `presetId`, or series `presetId`): `request.internal.presetOverrides` gains
  `'overlay'` (deduplicated) on the series and on each rewritten pending ticket.
- Who: `updated_by` through the existing `touchTicket` / `updateSchedule` stamping (`by`).
- The wire item gains `summary.agentPicks` (the count of nodes carrying a pick), computed in
  `summarizeRequest`.

## 2. Core — `src/core/schedule-models.mjs` (new)

Pure over the store, no HTTP. Both functions resolve `id` to a ticket or a series the way
`findScheduleItem` does (a `sch_` prefix names a series; else a ticket by exact id).

```js
/** @returns {Promise<SchedModelsPayload>}  @throws {ModelSwitchError} */
export async function describeScheduledModels(id)
/** @returns {Promise<{ ok:true, kind, id, changed:object[], overlay:object|null, warnings:string[], pendingTickets:number }>}
 *  @throws {ModelSwitchError} */
export async function switchScheduledModels(id, { changes, by = 'local' } = {})
```

Payload (the Models panel's shape, extended):

```js
{
  kind: 'once' | 'recurring', id, title, status: 'scheduled',
  startsAt: iso | null,            // once: run_at (null when chained after a run)
  sentence: string | null,         // recurring: the rule's sentence
  workflowId, engine,              // engine: resolveRunEngine({ explicit: request.engine, projectDir | workspace })
  models: engineCatalog(models, engine),   // model-switch.mjs: the models this engine runs, efforts in its vocabulary
  efforts: HARNESS_EFFORTS[engine], subagents: engineHasSubagents(engine), subagentModels: subagentModelsOf(engine),
  fields: ['model', 'effort', 'subagentModel'],   // D6: the panel renders only these columns
  preset: { id, name, overridden: boolean } | null, // overridden: 'overlay' already in presetOverrides
  pendingTickets: number,          // recurring: tickets the edit will also rewrite; once: 0
  stages: [{ nodeId, key, label, fanOut,
             model, effort, subagentModel,          // the stored pick ('' = none)
             picked: boolean,                       // any key stored for this node
             projectDefault: { model, effort, subagentModel } | null,   // resolveGraph's nodeCtx for a project target; null for a workspace
             state: 'scheduled', switchable: true }],
}
```

- The workflow: `readWorkflow(request.workflowId)` (`src/core/workflows.mjs`); its agent nodes are the
  stages. Missing or unreadable → `WORKFLOW_GONE` 409.
- The catalog: `listModels(projectDir)` for a project target, `listModels('')` for a workspace — the
  run route's rule.
- `projectDefault`: `resolveGraph(projectDir, workflowId, loadAgentRegistry(AGENTS_DIR), AGENTS_DIR)`
  → `nodeCtx[nodeId]` `{ model, effort, subagentModel }`, so the panel can read "project: Opus 5.5 ·
  high" under a stage with no pick. A workspace target shows none (its run merges over the primary
  member's settings, which a card does not show — docs/models.md).
- `switchScheduledModels`:
  1. refusals as in §6; `changes` must be an object keyed by node id; each change may carry only the
     three fields (`subagentEffort` or anything else → `BAD_FIELD` 400 naming the field); a node that
     is not an agent node of the workflow → `UNKNOWN_STAGE` 400.
  2. next nodes = the stored nodes with each change merged per key; `''` (the panel's Default, the
     CLI's `default`) deletes the key.
  3. `checkRunOverlay(nextNodes, { workflow, models, engine, wires: stored.wires })` → errors joined →
     `INVALID_SELECTION` 400. The canonical `nodes` it returns are what is stored.
  4. `changed` = the nodes whose stored entry differs (`{ nodeId, label, before, after }`); none → return
     `{ ok: true, changed: [] }` and write nothing.
  5. write: ticket → `updateTicketRequest(id, request, { by })` (new in `scheduler.mjs`, status
     `scheduled | missed` only, else null → `NOT_SCHEDULABLE`); series → `updateSchedule(id, { request },
     { by })` then `updateTicketRequest` for each pending ticket of the series. A preset follower's
     `request.internal.presetOverrides` gains `'overlay'` first.
  6. feed: `addNotification({ kind: 'changed', severity: 'info', ticketId | scheduleId, projectDir, title,
     message: 'agent models changed by <who>: Plan → Opus 5.5 · high; Review → project default.' })`
     (`src/core/notifications.mjs`; `info` severity arrives read, like `completed`).
  7. warnings: `modelSwitchWarnings(changed, models)` (model-switch.mjs: a model that needs sign-in).

## 3. Server (`ui/server.mjs`)

- `GET /api/schedules/:id/models` → `describeScheduledModels(id)`; errors through the model-switch
  envelope (`modelSwitchReply`: `{ error, code }` with the error's status).
- `POST /api/schedules/:id/models` `{ changes }` → `switchScheduledModels(id, { changes, by: actorOf(req) })`;
  on `changed.length`: `emitChanged('schedules-changed', 'updated')` and `emitChanged('notifications-changed')`.
- `GET /api/schedules` and `GET /api/schedules/:id` carry `summary.agentPicks` through `summarizeRequest`
  (no route change).

## 4. UI

`ui/public/model-switch.mjs`:

- `payload.fields` (default: all four): columns not listed are not rendered — no header, no cell;
  `picks()` carries only the listed fields.
- `STATE_LABEL.scheduled = 'scheduled'`.
- `payload.status === 'scheduled'`: title "Models for this scheduled run" (once) or "Models for every
  run of this schedule" (recurring, with "Also updates N waiting run(s)." when `pendingTickets`);
  subtitle "Each pick applies when the run starts. Default keeps the project's setting."; a
  `projectDefault` reads under the stage as "project: <label> · <effort>"; **Save** is the only
  action (no Save & resume); a preset follower shows the note "Overrides the agent picks of the run
  preset <name> for this schedule." (`msw-note`).

`ui/public/schedules-view.mjs`:

- Once card: **Models…** (`btn btn-sm`) after *Change time*, hidden when the ticket is `firing`, is a
  resume ticket (`resumePipelineId`), or its workflow is `wf_auto`. Repeating card: **Models…** after
  *Edit*, hidden for `wf_auto`. A paused series still offers it.
- Click: `GET /api/schedules/:id/models` → `renderModelSwitchPanel(payload, { onSave, onCancel })` into
  a host under the card (`.sched-models`, one open at a time; the card re-render on `load()` closes it).
  `onSave` → `POST …/models { changes: diffChanges(payload.stages, picks) }` → `deps.notify(switchNotice(out))`
  → `load()`. A refusal shows in the panel (`showError`).
- The card's details block adds "Agents: N picked" when `summary.agentPicks > 0`.
- The activity feed's badge map (`KIND`) gains `changed: ['Changed', 'blue']`, so the new entry renders
  like its siblings instead of falling back to the raw kind.

## 5. CLI (`src/cli/switch-model.mjs`, `src/cli/schedule.mjs`)

- Id resolution: a new `resolveSwitchRef(ref, fail)` tries pipelines (`resolveRunRef` without failing),
  then tickets (`scheduled_runs.id LIKE 'ref%'` with status `scheduled | missed`), then series (`sch_`
  prefix on `schedules`). More than one kind, or more than one hit → fail "… matches a run and a
  scheduled run — use a longer id". Returns `{ kind: 'run' | 'once' | 'recurring', id }`.
- Scheduled target: listing header `<title> — scheduled, starts <when>` / `— waiting for <run>` /
  `— repeating schedule, <sentence>`; the STATE column reads `scheduled`; a stage with no pick shows the
  project default dimmed with "(project)". A preset follower prints "Follows run preset <name>; agent
  picks here override it." once.
- Changes: `--stage`/`--all` with `--model`, `--effort`, `--subagent-model`; `default` clears a field.
  `--subagent-effort` on a scheduled target → exit 2, "a scheduled run stores no sub-agent effort". Prints
  `Changed <label> (<nodeId>): a → b` per stage, then for a series "Also updated N waiting run(s)." and
  warnings. `--json`: `{ id, kind, changed, warnings, pendingTickets }`. No resume hint.
- `worca schedule show <id>`: an `agents` block listing each agent stage's pick (`Plan: Opus 5.5 · high`)
  or `project default`, and the preset line when `overridden`.
- Help: `SWITCH_HELP` names the scheduled case and the `sch_` id; the top-level `worca --help` line reads
  "Change the models of a scheduled, running or paused run's remaining stages (this run only)."

## 6. Error codes

| code | HTTP | when |
|---|---|---|
| `NOT_FOUND` | 404 | no ticket or series with that id |
| `NOT_SCHEDULABLE` | 409 | a ticket that is `firing`, `fired`, `canceled`, `skipped` or `failed`; a series that `ended` |
| `RESUME_TICKET` | 409 | a resume ticket: "this schedule resumes run <pipelineId> — switch that run's models (worca switch-model <pipelineId>)" |
| `AUTO_WORKFLOW` | 400 | `wf_auto`: "the Auto workflow picks its models when the run starts" |
| `SCAN_TARGET` | 400 | `overlayWorkflowRefusal`'s scan case |
| `WORKFLOW_GONE` | 409 | the workflow no longer exists or does not load |
| `UNKNOWN_STAGE`, `BAD_FIELD`, `BAD_REQUEST`, `INVALID_SELECTION` | 400 | as the run switch; `INVALID_SELECTION` carries `checkRunOverlay`'s messages |

All raised as `ModelSwitchError` (model-switch.mjs) so the server, CLI and panel reuse their handling.

## 7. Docs

- docs/scheduled-runs.md: the stored-vs-start table gains "Per-agent picks (overlay) | checked, stored |
  used as stored; change them any time before the start with Models… or `worca switch-model <id>`";
  **CLI** (the switch-model line, `schedule show`'s agents block), **API** (the two routes), **UI**
  (Models… on both cards), **Repeating schedules** (an edit reaches waiting occurrences; a preset
  follower's edit overrides the preset's picks).
- docs/models.md, "Switch models on a running or paused run": retitle to "… scheduled, running or paused
  run"; a paragraph on the scheduled case (what changes, the three fields, presets).

## 8. Tests

`GIT_CONFIG_GLOBAL=/dev/null node tools/test.mjs <files>`.

- `test/schedule-models.test.mjs` (new): describe for a ticket with and without picks (project
  defaults from resolveGraph, `picked`, `agentPicks`); switch merges per key, clears on `''`, refuses a
  foreign-engine model and an unknown stage, stores the checker's canonical nodes, writes nothing on
  no-op; a series edit rewrites the series and its pending tickets but not a firing one; a preset
  follower gains `presetOverrides: ['overlay']`; refusals for a fired ticket, a resume ticket, `wf_auto`,
  a missing workflow; the feed entry.
- `test/scheduler-presets.test.mjs`: a follower's picks edited, then fired → `bodyFollowingPreset` keeps
  the edited overlay while every other setup key follows the preset.
- `test/api-schedules.test.mjs`: GET payload shape; POST applies and bumps `summary.agentPicks`; 409 on a
  fired ticket; 400 on a bad selection with the checker's message.
- `test/ui-model-switch.test.mjs`: `fields` hides the sub-agent effort column; the scheduled copy, no
  Save & resume; the preset note; `projectDefault` line.
- `test/schedules-view.test.mjs`: Models… present/hidden per card kind and state; click fetches the
  payload and renders the panel; Save posts the diff and toasts.
- `test/cli-switch-model.test.mjs`: a ticket id and a `sch_` id list and change; ambiguity refused;
  `--subagent-effort` refused; `--json` shape. `test/cli-schedule.test.mjs`: `show` prints the agents block.

## 9. Acceptance criteria

1. A one-off ticket's Models… saves a pick; `worca schedule show` and the card show it; the fired run's
   Agents tab labels that stage with the picked model.
2. A series edit changes its next materialized ticket and every later one; a ticket that was firing is
   untouched.
3. A preset follower keeps the edited picks when it fires; the preset's other setup keys still apply.
4. `worca switch-model <ticket>` and `<sch_id>` list and change picks with the run's flags; a pipeline id
   still works as before.
5. A foreign-engine model, an unknown stage and a sub-agent effort are refused with the codes in §6.
6. Resume tickets, Auto-workflow items and firing tickets offer no Models… and refuse the routes.
7. The suites in §8 pass; docs name the new case.

## Out of scope

- Changing a ticket's run-level default model (`request.model`) or engine.
- Re-validating stale picks at fire time (today a fired ticket skips the overlay check; a model removed
  from the catalog fails deeper). A follow-up: run `checkRunOverlay` in `fireTicket` and skip the ticket
  with the reason, as the tag check does.
- Editing loop budgets (`overlay.wires`).
- The Ask run card after scheduling (it follows the series' Run now / Delete only).
