# Ticket updates: what Worca does to a ticket when a run finishes

Date: 2026-10-29. Base: `dev` at 74ea2a87a (schema v81; A6 export merged as #1010; A6.1 import open as #1041, which takes
v82). Branch: `feat/ticket-updates`. Decisions are numbered TU-D<n> when other documents cite them. The screens were agreed
as a mock first: Claude Design canvas "Jira status picker" (https://claude.ai/artifact/WqBFrAG6dPMQ66F8RDmUmB), boards
**1 · Ticket updates (light)** (Main), **2 · Ticket updates (dark)** (Dark), **3 · Add projects you work on** (Projects),
**4 · A project rule: that project's statuses** (AddRule), **5 · States** (States), **6 · Phone, 390 px** (Phone) and
**7 · What the ticket's comment says** (Comment). Their copy is approved and used verbatim here. Where this document fills a
gap the boards leave, it says so ("not on the boards").

## 1. Problem

Each tracker plugin has its own "on completion" setting, and each is per connection and blind to projects:

| Plugin | Setting | What it does today |
|---|---|---|
| jira-source | `transitionOnComplete` (free text) | matched against the issue's transitions by transition name or target status name; a required Resolution makes the transition fail, and with it the whole write-back |
| azure-boards-source | `closeOnComplete` yes / no | moves the work item to its type's Completed-category state |
| github-source | `closeOnComplete` yes / no | closes the issue (`state_reason: completed`) |

People work on several projects with different workflows, Jira is not the only tracker (more are coming, and one day
Worca's own), and a typed status name breaks silently when a workflow changes. So **Worca owns what happens to a ticket
when a run finishes**, per connection and per project, and the plugins only translate it into their tracker's terms.

**Success:**
1. In Marketplace › Installed › a tracker plugin › Settings, a saved connection shows **Ticket updates**: the projects the
   person works on, and per project what a finished run does to its tickets (Don't move, Any Done status, or one of that
   project's statuses).
2. A run that writes back moves its ticket by the rule of the ticket's project, else the All projects rule, and the one
   comment it posts ends with a line saying what happened.
3. Jira never closes a finished run's ticket as Won't Do or Duplicate, and fills a required Resolution itself.
4. New run, Requirements export and import list only the projects the person works on.
5. With nothing saved, every plugin behaves exactly as today. With the flag off, nothing changes at all.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Four provider-neutral categories: `todo`, `in_progress`, `done`, `cancelled`.** Each plugin maps its tracker onto them. Jira: statusCategory `new` → todo, `indeterminate` → in_progress, `done` → done, except a done status whose name means a negative ending (Won't Do, Won't Fix, Rejected, Duplicate, Cancelled, Canceled, Declined, Invalid, Obsolete, Abandoned, Not planned; case-insensitive, `'` or `’`), which is cancelled. Azure Boards (PR 2): Proposed → todo, InProgress and Resolved → in_progress, Completed → done, Removed → cancelled (so Any Done status is Completed, as `closeOnComplete` does today; user, 2026-10-29). GitHub (PR 2): open → todo, closed `completed` → done, closed `not_planned` → cancelled; no in_progress. Linear (later): backlog, triage, unstarted → todo; started → in_progress; completed → done; canceled → cancelled. The name list lives in the plugin: mapping is translation. |
| D2 | **Settings per connection, stored by Worca.** A connection is a plugin profile (`plugin-config.mjs`; `default` for a single-profile source such as github-source). Per profile and task source Worca keeps **Projects you work on** (a list of the tracker's projects, empty = all) and **rules** keyed by (project, moment) → target. Project `''` is All projects. The only moment is `finished` (a run that writes back finishes successfully); it is stored per moment so `started` and `pr_opened` can be added without a format change. Targets: `none` (Don't move), `category` `done` (Any Done status), `status` (one status of that project, by its id, with its name and category kept for display), and `typed` (D4, All projects only). The All projects row exists once saved, offers only Don't move and Any Done status (plus a carried-over typed value while it is selected), and cannot be removed. A project row overrides All projects. Removing a project from Projects you work on keeps its rule: a choice is never dropped silently. |
| D3 | **Storage: a host file in the plugin's data folder, not a SQLite table.** `<plugins>/<name>/data/ticket-updates.json`, in the same `profiles/1` envelope as `config.json` and `state.json` (§4). Why: the rules belong to one profile and should live and die with it. `deleteProfile` already rewrites that profile's buckets in `config.json`, `secrets.json` and `state.json`; it gains this file in the same loop, so the Marketplace's Remove profile and every other caller drop the rules with no extra hook (a table would need a `clearBindingsForProfile`-style call in each place). Uninstall keeps `data/` and purge removes it, so a reinstall gets its rules back exactly when it gets its connection back. No migration means no clash with #1041's v82. Not in `config.json` itself: `PUT /api/plugins/:name/config` writes any key it is given, so a host key there could be set around the validation of §5. Not in `state.json`: connectors write it. The file holds no secrets. |
| D4 | **Legacy stays until the first save.** With no record for a profile and source, Worca passes no `move` and each plugin uses its old setting exactly as today (Jira's comment order included). A new optional op `legacyMove()` answers `{ field, target }`: the config key of the old setting and what it means, `{ category: 'done' }` (Azure, GitHub "yes"), `{ typed: '<text>' }` (Jira text) or null (blank or "no"). The plugin answers it because only the plugin knows what its old setting means. On first open the All projects row is filled from it: Any Done status, "<text> (as typed)" or Don't move, with the note of board 5 B naming the field's label from the config schema when the old value was set. After the first save Worca always passes `move`, and the old field's control in Settings is replaced by "Moved to Ticket updates." (its label stays, so a person who looks for it finds where it went; the control is gone, so a Save never sends it). A typed value goes to the plugin as `move: { status: '<text>' }`, matched by transition or status name as today. |
| D5 | **Contract: optional additions, plugin API stays 5.** `capabilities()` adds `ticketUpdates: true`; new ops `listStatuses({ project })` and `legacyMove()`; `reportResult` accepts `move` and answers what happened; `listProjects` items may carry `name` (the project's name without its key, for the chips); `getTask`'s `meta.project` names the ticket's project as a `listProjects` value (§3). A connector without them answers `unimplemented` or leaves the field out: the section is hidden for it and it behaves as before. `plugin-api.mjs`'s comment gains the line, as A6 did. |
| D6 | **The ticket's project is pinned when the run starts, never parsed by the host.** `resolveTaskInput` copies `task.meta.project` (a string) into `sourceMeta.project`, so it lands in `pipelines.source_ref` beside the pinned profile and inputs. A Requirements start (A6-D15) has no `getTask`: `reportTo` carries the link's `tracker_project` as `project`, and the run harness copies it into `reportMeta`. A row without `project` (a run started before this change) uses the All projects rule. Why not parse the id ("SHOP-123", "org/Shop#12", "owner/repo#12"): the host would then know each tracker's id format, which is what this design moves out of the host. Jira and Azure already answer `meta.project`; github-source adds it in PR 2 (today it has `meta.repo`). |
| D7 | **The host decides the move and passes it only when it can be heard.** In `reportResultForPipeline`, after the existing `capabilities({ inputs })` probe: when the flag is on, the answer has `ticketUpdates: true` and a record exists for the row's profile and source, it adds `move` to `reportResult`'s args (§6); otherwise it passes none and legacy applies. A run that did not finish successfully gets `{ none: true }` once rules exist, so no plugin falls back to its old setting. The extra decision costs no extra spawn: the probe already runs on every write-back. |
| D8 | **Routes: host routes under `/api/plugins/:name/ticket-updates`, server-side calls only.** The sheet reads and saves through four routes (§5) beside the config routes, each `requireFlag('ticketUpdates')`. `listProjects` and `listStatuses` run in the server through `callSource` with the saved profile, never from the browser: `POST /api/sources/call`'s allowlist is unchanged (it never gains `listStatuses` or `legacyMove`). |
| D9 | **The projects filter is applied where each list is built, server-side.** New run: `POST /api/sources/call` filters the result of `op: 'listProjects'` by the call's profile (the source pane's project remote-select); github-source's `listRepos` joins in PR 2. Requirements export: `exportOptions` (`src/core/requirements/export.mjs`) filters `projects` by the connection's profile. Requirements import (A6.1, #1041): `importOptions` does the same; whichever of #1041 and this PR merges second adds that line. Two rules everywhere: a saved choice outside the filter stays listed (an export setup's tracker project), and the filter only shortens lists, so a pasted key or link still finds a ticket in any project (jira-source's `pastedKey`, A6.1-D3). A6.1's **All projects** word search looks only in the picked projects: `searchTickets` gains an optional `projects` list, and jira-source adds `project in (…)` to its query; a pasted key or link is unaffected (user, 2026-10-29). The Ticket updates section's own picker calls `listProjects` unfiltered. |
| D10 | **Jira chooses the transition itself (§7).** Any Done status: a transition whose target is done and not cancelled-named, preferring "Done", then Closed, Resolved, Complete, Completed, then any other, in Jira's order. Never a cancelled one: if only those are reachable it does not move and says so. A required Resolution is filled with the first allowed value named Done, Fixed, Complete or Completed; if none fits, the next candidate is tried, and if none can be completed it does not move and says so. The same Resolution rule applies to a status move. A failed move (other than auth, network, rate limit, timeout) still posts the comment, with the reason as its last line. |
| D11 | **What happened is the last line of the one comment, and Worca hears it too.** With `move`, Jira transitions first, then posts one comment: the run summary, its links, then the outcome line (board 7). `reportResult` answers `{ moved: { from, to } \| null, note }`. `reportResultForPipeline` returns them; the run's audit line becomes "Result reported back to the task source. <note>" and the results view's Report result status "reported · <note>". |
| D12 | **One host-drawn section in the manage sheet, saved with its Save.** `ui/public/marketplace/manage-sheet.mjs` mounts **Ticket updates** in a task-source group after the Test connection row, when the flag is on and `GET …/ticket-updates` says `available`. It joins the group's dirty check and the sheet's Save: the group's config `PUT` goes first, then the ticket-updates `PUT`; a refused config save sends nothing more. A profile switch, Add profile and Remove profile repaint it with the group. The connection counts as saved when the profile is in the roster and every required config field has a stored value (the server answers `connection`); before that the section shows only board 5 A's line. Level: Advanced with the Marketplace page; no new level. |
| D13 | **Controls reuse the closest upstream patterns; there is no generic combobox to take.** The rule select is a button (`role="combobox"`, `aria-haspopup="listbox"`) opening a listbox placed by `placeFlyout` (`side-flyout.mjs`), with `aria-activedescendant` on the button as in `group-picker.mjs` `openGroupPicker` and `topnav-search.mjs`, and group labels and sub-lines as in `cost-dimension-picker.mjs`. The projects popover follows `label-picker.mjs` `openLabelPicker`: a search box over a multi-select listbox of checkbox rows that stays open across toggles. Both are new small modules in `ui/public/marketplace/` (§8); neither is made generic in this PR. |
| D14 | **Report back says the rule's move.** A6's Report back hint (`requirements-view.mjs` `reportRow`) reads `exportView`'s `doneStatus` today. `exportView` gains `move` (`{ kind: 'category' \| 'status' \| 'none', label }` or null), resolved from the link's connection and tracker project with the same function as write-back; when it is not null the hint uses it (§9), else the current two lines stay. |
| D15 | **New run gets no new line.** The only write-back control there is jira-source's own "Write result back" input; the move is a property of the connection, shown where the connection is set. The outcome reaches the person in the ticket's comment, the run's audit line and the results view (D11). |
| D16 | **Behind a Labs flag `ticketUpdates`, off by default** (user, 2026-10-29). It changes what Worca writes to external trackers, and CONTRIBUTING puts new experimental UI behind a flag. Off: the section is hidden, the routes answer 404, no filter applies, and write-back ignores saved rules (the plugins' old settings apply, D4). The file is kept, so turning the flag on again restores the rules. Owner TomicaB; `requires` nothing (the Requirements parts apply when both flags are on). |
| D17 | **Mock mode answers the new ops.** `plugin-shim.mjs` `MOCK_DEFAULTS`: `capabilities` adds `ticketUpdates: true`; `listProjects` SHOP Shop, CRM Customer portal, OPS Operations, SUP Support desk, MKT Marketing site, DATA Data platform (board 3); `listStatuses` board 4's CRM workflow (Done, Released; In Progress, Waiting for customer; Open; Won't Fix) for any project, with SHOP adding Resolved; `legacyMove` `{ field: 'transitionOnComplete', target: null }`; `reportResult` answers by `move`: category → `{ moved: { from: 'In Progress', to: 'Done' }, note: 'Moved to Done.' }`, status → the same to its name, none or absent → `{ moved: null, note: '' }`, and still records its args in `lastReport`. |
| D18 | **jira-source goes to 0.2.0.** The Marketplace offers an update only for a higher manifest version; A6's ops shipped without a bump, and this adds more. |

## 3. Contract

**Moves** (Worca to plugin, in `reportResult`'s args): `{ category: 'done' }` | `{ status: '<value>', name?: '<label>' }` |
`{ none: true }`. `status` is a `listStatuses` value, or the typed text of a carried-over legacy setting (then without
`name`). Absent: the plugin's old setting applies.

| Op | Args | Answers |
|---|---|---|
| `capabilities` (existing) | `{ inputs }` | adds `ticketUpdates: true` |
| `listProjects` (existing, the project input's `optionsFrom`) | `{}` | `[{ value, label, name? }]`; `name` new and optional: the project's name alone ("Shop"), for the chips |
| `listStatuses` | `{ project }` | `[{ value, label, category }]`, every status of the project once, `category` one of D1's four |
| `legacyMove` | `{}` | `{ field, target }`; `field` the old setting's config key, `target` `{ category: 'done' }`, `{ typed }` or null |
| `reportResult` (existing, positional) | `(id, { status, summary, links, inputs, move? })` | adds `{ moved: { from, to } \| null, note }`; `note` is the outcome line, `''` when nothing was to be done |
| `getTask` (existing, positional) | `(id)` | `meta.project`: the ticket's project as a `listProjects` value, when the tracker has projects |

Timeouts: `listProjects` 60 s (Jira Cloud pages up to 2,000 projects, as A6-D14), `listStatuses` and `legacyMove` the
`callSource` default (30 s). Failures throw `PluginOpError` as today. A cancelled status may still be picked by name as a
project's status: only Any Done status refuses them.

## 4. Storage

```
<plugins>/<name>/data/ticket-updates.json
{ "$format": "profiles/1", "profiles": { "acme": { "jira": {
    "projects": [{ "value": "SHOP", "label": "Shop" }, { "value": "CRM", "label": "Customer portal" }],
    "rules": [
      { "project": "", "moment": "finished", "target": { "kind": "category", "value": "done" } },
      { "project": "SHOP", "label": "Shop", "moment": "finished",
        "target": { "kind": "status", "value": "10012", "label": "Resolved", "category": "done" } },
      { "project": "CRM", "label": "Customer portal", "moment": "finished", "target": { "kind": "none" } }
    ],
    "savedAt": "2026-10-29T10:42:00.000Z", "savedBy": "pat" } } } }
```

A carried-over Jira value is `{ "kind": "typed", "value": "Resolve" }`. Limits checked on save: at most 200 projects and
200 project rules, values and labels at most 200 characters, one rule per (project, moment), exactly one All projects
rule, All projects only `none`, `category` or `typed`, moments only `finished`. `plugin-config.mjs` gains
`readTicketUpdates(name, profile, sourceId)` and `writeTicketUpdates(name, profile, sourceId, record)` (atomic, the
envelope helpers it already has), and `deleteProfile` drops the profile's bucket here too. `docs/storage.md` lists the file.

## 5. API

All `requireFlag('ticketUpdates')`; `:name` through `requirePlugin`; `sourceId` and `profile` guarded exactly as
`PUT /api/plugins/:name/config` guards them (an unknown source 400, a multi-profile source without a roster profile 400).
A tracker failure answers 502 `{ error, kind }` with A6-D11's sentence ("Worca could not reach Jira: the API token was
refused."); `reachReason` and `reachSentence` move from `requirements/export.mjs` to a shared `src/core/source-reach.mjs`
and are re-exported there, unchanged.

| Route | Does |
|---|---|
| `GET /api/plugins/:name/ticket-updates?sourceId=&profile=` | `{ available, connection: 'saved' \| 'new', profile: { id, label }, saved, projects, rules, legacy: { field, label, target } \| null }`. Spawns `capabilities` (and `legacyMove` while nothing is saved); no tracker call. `available: false` when the plugin lacks `ticketUpdates` |
| `GET /api/plugins/:name/ticket-updates/projects?sourceId=&profile=` | `{ projects: [{ value, label, name? }] }`, unfiltered (`listProjects`) |
| `GET /api/plugins/:name/ticket-updates/statuses?sourceId=&profile=&project=` | `{ statuses: [{ value, label, category }] }` (`listStatuses`) |
| `PUT /api/plugins/:name/ticket-updates` `{ sourceId, profile, projects, rules }` | validates (§4) and saves; `{ ok: true }`; 409 "This plugin cannot update tickets." without `ticketUpdates`. Emits `plugins-changed` (`config`) |

## 6. Host resolution

`src/core/ticket-updates.mjs` (new, pure but for the file read):

```
moveFor({ plugin, sourceId, profile, project, status }):
  if (!flagEnabled('ticketUpdates')) return undefined
  rec = readTicketUpdates(plugin, profile || 'default', sourceId)
  if (!rec) return undefined                                   // legacy (D4)
  if (status !== 'completed') return { none: true }            // only `finished` exists (D7)
  rule = project && rec.rules.find(r => r.project === project && r.moment === 'finished')
      || rec.rules.find(r => r.project === '' && r.moment === 'finished')
  return toMove(rule.target)   // none → {none:true}; category → {category:'done'};
                               // status → {status:value, name:label}; typed → {status:value}
```

Also `projectFilter(plugin, sourceId, profile)` (a Set, or null for none picked or flag off), `filterProjects(options,
filter, keep)` and `describeMove(move)` for D14. `reportResultForPipeline` calls `moveFor` with the call's profile (the
legacy `DEFAULT_PROFILE` for a row that predates profiles), `ref.project` and the row's result status, after the probe
(D7).

## 7. The Jira connector

`plugins/jira-source/connector/index.mjs`, REST v2 on Cloud and Data Center as before:

- **capabilities:** `{ writeBack, incrementalSync: false, export: true, ticketUpdates: true }`.
- **listProjects:** items gain `name` (`p.name`).
- **legacyMove:** `{ field: 'transitionOnComplete', target: text ? { typed: text } : null }`.
- **listStatuses:** `GET /rest/api/2/project/{key}/statuses` (per issue type), each status once by id, category by D1,
  in the order Jira lists them.
- **reportResult without `move`:** unchanged, byte for byte.
- **reportResult with `move`:** read the status (`fields=status`), then `GET /rest/api/2/issue/{key}/transitions?expand=transitions.fields`.
  - `{ none: true }`: no read, no transition, no line.
  - `{ category: 'done' }`: current status done-category (cancelled-named too) → "Already in <status>." Else candidates:
    transitions whose `to.statusCategory.key` is `done` and whose `to.name` is not cancelled-named, ordered by D10.
    Skip a candidate whose other required fields have no default (§9 for the line when all are skipped).
  - `{ status }`: current status's id equals `status`, or its name equals it case-insensitively → "Already in <status>."
    Else the transition whose `to.id` equals it, else whose name or `to.name` equals it case-insensitively.
  - **Resolution:** when the chosen transition's `fields.resolution.required` is true, send `fields: { resolution: { id } }`
    with the first `allowedValues` named Done, Fixed, Complete or Completed; none → the next candidate (category only),
    else not moved.
  - `POST …/transitions` first; a 400 is a "Not moved" line, any other failure throws as today (the write-back fails and
    Report result retries; a retry after a failed comment finds the ticket moved and says "Already in …").
  - Then one comment: summary, links, the outcome line last (D11). Answer `{ commented: true, transitioned, moved, note }`.

## 8. Screens

Built with upstream classes as the manage sheet is (`.mk-sec`, `.mk-sec-head`, `.section-title`, `.btn` / `.btn-sm`,
`.hint`, `.chip`, the sheet's error wash); CSS as `mk-tu-*` rules in the Marketplace block of `ui/public/style.css`,
tokens only, so board 2 (dark) needs nothing more.

- **Section** (board 1): header **Ticket updates** with the meta "<profile label> (<profile id>)" ("Acme (acme)"); the sub
  line; **Projects you work on**: chips (mono key, then `name` or `label`, a × button), then **Add projects…**; its hint.
  **When a run finishes successfully**: a `role="list"` of rules, each a grid of name, a 220 px select and a remove button:
  **All projects** with "Unless a project below says otherwise" and no remove button, then one row per project rule (mono
  key and name). **Add a project rule** adds a row whose first control is a project select ("Project"; the projects you
  work on, all projects when none are picked, minus those with a rule) and whose move select starts at Any Done status
  (board 4). Then the hint about Won't Do and Resolution.
- **Projects popover** (board 3): a dialog "Projects you work on" with the search box and a multi-select listbox "Jira
  projects" of checkbox rows (mono key, name), the footer "<n> picked · <m> projects on <profile label>" and **Done**.
  Toggles apply at once; Done, Esc or a press outside closes it and focuses **Add projects…**.
- **Move select** (board 4): the listbox "<KEY> statuses" (on the All projects row it holds only the first two options and
  is labelled "All projects: move to"): **Don't move** (an empty dot), **Any Done status** with the sub "One this ticket can
  reach", a separator, then the project's statuses grouped "Done · <KEY>'s workflow", "In progress", "To do", "Cancelled", each
  with its dot (done green, in progress peach, to do grey, cancelled red). The selected option has a check. The list is
  loaded on first open and kept for the sheet's opening; on open the section also loads, four at a time, the statuses of
  each project whose rule names a status, to find a status that is gone (board 5 E).
- **States** (board 5): A, B, C, D and E as §10.
- **Phone** (board 6): at 600 px and narrower each rule stacks (name and remove button on one line, the select below at full
  width), chips are 36 px with 32 px × buttons, and every button and select is 44 px tall.
- **Comment** (board 7): §9's lines.

## 9. Copy

Board copy (verbatim):

- Header "Ticket updates"; meta "Acme (acme)".
- Sub: "What Worca does to a ticket when a run that writes back finishes. A project's own rule wins over All projects."
- "Projects you work on"; "Add projects…"; chip × "Remove SHOP"; hint "New run, Requirements export and import list only
  these. None picked = all projects."
- Popover: search placeholder "Find a project by key or name" (label "Find a project"); listbox "Jira projects"; footer
  "2 picked · 6 projects on Acme"; "Done".
- "When a run finishes successfully"; "All projects", "Unless a project below says otherwise"; "Add a project rule";
  remove "Remove the SHOP rule", on a new row "Remove the new rule"; the new row's project select "Project".
- Move select: label "SHOP: move to" ("All projects: move to"); options "Don't move", "Any Done status" (sub "One this
  ticket can reach"); groups "Done · CRM's workflow", "In progress", "To do", "Cancelled"; listbox "CRM statuses".
- Hint: "Any Done status: one the ticket can reach, never Won't Do, Rejected or Duplicate. When a move asks for a
  Resolution, Worca fills in Done, Fixed or Complete. Every update is the last line of Worca's comment on the ticket."
- New-row hint (board 4): "A project rule lists that project's own statuses. The project list is the projects you work on
  (all projects when none are picked)."
- Not saved: "Save this connection first. Ticket updates read Jira's projects and statuses through it."
- Carried over: "Filled in from the old **Transition on completion** setting. Nothing changes until you save; after that, the
  old setting is no longer used." (the bold part is the old field's label); the value "Resolve (as typed)".
- Loading: "Getting CRM's statuses…". Unreachable: "Worca could not reach Jira: the API token was refused." and **Try again**.
- Gone: "CRM has no status named Shipped any more. Pick another; until then a run leaves CRM tickets where they are and
  says so in its comment."
- Comment lines: `Moved to Resolved.` / `Already in Closed.` / `Moved to Done, Resolution: Done.` / `Not moved: from "In
  Review" only Won't Do and Duplicate lead to a Done status.` / `Not moved: the move to Done needs a Resolution, and none is
  named Done, Fixed or Complete.` / legacy and an unreachable status: `Could not move to "Shipped" from "In Progress"
  (available: Start, Review).`

Not on the boards (the smallest wording, in the boards' voice):

- Getting projects: "Getting Acme's projects…"; none match the search: "No project matches."; none picked in the footer:
  "None picked · 6 projects on Acme".
- Every listed project has a rule: **Add a project rule** is disabled, with the hint "Every project you work on has a rule."
- The old field after the first save: "Moved to Ticket updates."
- Jira lines: `Not moved: from "In Review" no transition leads to a Done status.` / `Not moved: CRM has no status named
  Shipped any more.` (a picked status whose id the project no longer has) / `Not moved: the move to Done asks for fields
  Worca does not fill (Fix versions).` / `Not moved: Jira refused the move to Done: <Jira's message>.`
- Results view: "reported · Moved to Resolved."; audit: "Result reported back to the task source. Moved to Resolved."
- Report back hint (D14), with Jira as the connection's tracker and SHOP the ticket's project: "When the run ends, Worca
  comments with the result and the pull request link, and moves the ticket to a Done status (Ticket updates in the Jira
  connection)." / "…, and moves the ticket to Resolved (Ticket updates in the Jira connection)." / "When the run ends,
  Worca comments with the result and the pull request link. Ticket updates in the Jira connection leave SHOP tickets where
  they are."

## 10. Errors and states

- **A, not saved:** a new profile (the id field), or a profile without its required values. Only the line; no call.
- **B, carried over:** `saved: false` and a legacy target. The note sits above the rules; the section is not dirty until
  the person changes something, so closing the sheet asks nothing. Saving anything (a project, a rule) saves the All projects
  row as shown, typed value included.
- **C, loading:** the listbox opens at once with its two general options and "Getting CRM's statuses…" (`aria-live`); the
  projects popover says "Getting Acme's projects…".
- **D, unreachable:** A6's sentence and **Try again**, inside the listbox or the popover. Saved rules stay as they are;
  Don't move and Any Done status still work; a status rule keeps its stored name.
- **E, status gone:** a rule's stored status is not in the project's list: the select shows the stored name, and the error
  line sits under the row (`aria-describedby`). Save still works; write-back then leaves the ticket and says so (§9).
- **Save refused** (a 400 from §4's checks, a 409): the sheet's error wash under Settings, as a refused config save.
- A project saved in Projects you work on that the tracker no longer lists stays as a chip with its stored label.

## 11. Accessibility

- The section is a `section` labelled by its header; the rules a `role="list"`.
- Move select: a `button` with `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls` and the
  label "<KEY>: move to"; focus stays on it while open and `aria-activedescendant` names the active option. Options
  `role="option"` with `aria-selected`; group labels and the separator `role="presentation"`. Keys: ↑ ↓ Home End move,
  Enter or Space picks and closes, Esc closes without change and keeps focus, type-ahead jumps to the next option starting
  with the typed letters. The dots are `aria-hidden`; the group label says the category.
- Projects popover: `role="dialog"` labelled "Projects you work on"; focus in the search box; the listbox
  `aria-multiselectable="true"`; ↑ ↓ and Space toggle, Enter on the search toggles the active row, Esc closes and focuses
  **Add projects…**.
- Loading and failure lines are `aria-live="polite"`; the gone error is tied to its select with `aria-describedby`.
- Phone: 44 px targets (board 6). Contrast and dark theme from the tokens.

## 12. Tests

- **Rules and storage** (`test/ticket-updates.test.mjs`): `moveFor` (project rule wins, All projects, no project, no
  record → undefined, a failed run → none, flag off → undefined, typed → status); validation of §4; one record per profile
  and source; `deleteProfile` drops it (`test/plugin-config.test.mjs`); purge removes it.
- **Routes** (`test/api-ticket-updates.test.mjs`, mock shim): the four routes, the profile and source guards, 502 with
  the reach sentence, 409 without the capability, 404 with the flag off; `POST /api/sources/call` still refuses
  `listStatuses` and `legacyMove`, and filters `listProjects` by the profile only when the flag is on and projects are picked.
- **Write-back** (`test/writeback.test.mjs`, `test/sources.test.mjs`): `move` only with `ticketUpdates` and a record;
  `meta.project` pinned at fetch; a row without `project`; a Requirements `reportTo` carrying `project`; the note in the
  audit line and the retry's answer.
- **Filter consumers:** `exportOptions` filtered with the setup's project kept (`test/requirements-export.test.mjs`);
  `exportView`'s `move` and the Report back hint; `importOptions` filtered and a pasted key in another project still found
  (with #1041).
- **Jira** (`test/jira-source-ticket-updates.test.mjs`, `test/helpers/fake-jira.mjs`): `listStatuses` on Cloud and Data
  Center, dedupe and categories (cancelled names, both apostrophes); the preference order; only cancelled reachable; no
  done reachable; required Resolution filled, unfillable with a fallback candidate, unfillable with none; other required
  fields; already in; status by id, typed by name, gone; a 400 on the transition still comments; auth still throws; the
  line is last; every existing `jira-source-connector` test unchanged (legacy).
- **Shim** (`test/plugin-shim.test.mjs`): D17's answers.
- **UI (jsdom)** (`test/marketplace-ticket-updates.test.mjs`): boards 1, 3, 4, 5 (A to E) and 6; dirty and Save order;
  a refused config save sends no ticket-updates `PUT`; profile switch; the old field's line after save; the keyboard and
  `aria-*` of §11.
- **Browser** (`tools/verify-ticket-updates-cdp.mjs`, `npm run verify:ticket-updates`; mock, jira-source linked with
  `linkPlugin` and one profile, as `verify-requirements-cdp.mjs`): pick projects, add a project rule, pick a status, Save,
  reopen; New run's project select lists only the picked ones; a mock run's `lastReport` carries the move; light, dark and
  390 px.
- **Real Jira, by hand** before the flag leaves Labs: Cloud and Data Center; Any Done status on a workflow with Won't Do; a
  required Resolution; a project status rule; a legacy carry-over.

## 13. Docs

- `docs/ticket-updates.md` (new; the flag's `docs`): what it does, the categories, legacy, the filter.
- `plugins/jira-source/README.md`: a Ticket updates section; `transitionOnComplete` marked as the old setting.
- `.claude/skills/creating-worca-cc-plugins/SKILL.md`: the contract table rows of §3 and a paragraph on `move`.
- `docs/feature-flags.md` (the table row), `docs/storage.md` (the file), `docs/ui-levels.md` (the section, the popover and
  the move select: A, with the Marketplace page), `docs/requirements.md` (the Report back line, the filter),
  `docs/changelog/unreleased.md` (a Ticket updates entry).

## 14. Phasing, out of scope and open questions

**PR 1 (this design):** `ticket-updates.mjs`, the storage and `deleteProfile`, the routes, `source-reach.mjs`, the
write-back and `meta.project` pinning, the `/api/sources/call` and `exportOptions` filters, `exportView`'s `move`, the
flag, the mock, jira-source (contract, §7, 0.2.0), the section and its two controls, tests, docs. The `importOptions`
filter lands here if #1041 merges first, else in #1041's follow-up.
**PR 2:** azure-boards-source and github-source adopt the contract (`listStatuses`, `legacyMove`, `move`, `meta.project`,
github-source's `listProjects` over its repos).
**Out of scope:** moments other than `finished`; per-run overrides; a Worca-native tracker; moving tickets on failure;
team policy for these settings.

**Decided by the user (2026-10-29):** the Labs flag (D16); A6.1's All projects word search looks only in the picked
projects (D9; lands with the `importOptions` filter); Azure Boards' Resolved counts as in progress, so Any Done status
means Completed (D1).
