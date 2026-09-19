# UI levels — Simple, Advanced, Expert

The web UI has an **interface mode** that decides how much of Worca is on
screen. It works like Kodi's settings levels: a first-week user sees the core
loop and nothing else, a regular user adds git, cost and workflow controls, and
an expert sees everything.

This document is the source of truth for **which level a UI element belongs
to**, and the instructions for placing new ones. If you add, move or remove
anything a user can see, read [Placing a new element](#placing-a-new-element)
and update the [catalogue](#catalogue).

## The three levels

| Level | Who | What it shows |
|---|---|---|
| `simple` | New to Worca | The core loop: pick a project, describe the task, watch the run, answer its questions, read the result. Budget limits. Nothing here can break a run. |
| `advanced` | Regular use | How a run executes and what it changed: branches, guardrails, per-agent model and effort, the live log, the diff, pull requests, workflows built from existing agents, plugins, memory files. |
| `expert` | Authoring and team setup | Everything: agent, model and guardrail authoring, routing env and secrets, fan-out and loop limits, log filters, per-node run detail, diagnostics, team metrics. |

Levels are **cumulative**. Advanced shows everything Simple shows; Expert shows
all. Nothing exists only at a lower level, so raising the mode never removes
anything.

## Rules

1. **A blocking prompt is never hidden.** The cycle gate, the recovery prompt,
   the cost-pause banner, the retained-work banner and any clarifying question
   show at every level. A run that waits on a hidden control is a dead run. A
   blocking prompt may be *reworded* for Simple (the cycle gate is), never
   removed. Recovery instructions (the retained-work git commands) count as part
   of the prompt.
2. **A non-default value stays visible.** If a guardrail set, a model override,
   a feature branch or a fan-out toggle was set in a higher mode, a lower mode
   still shows it. Use `keepVisible()` on the control, or name it in the
   "still applied to this run" note on New pipeline.
3. **The mode is a view preference, not a permission.** A deep link such as
   `#settings/models` opens at Simple. The page shows a banner naming its level
   and offering the switch. Never disable a control or refuse a route because of
   the mode.
4. **An answer is never hidden.** A card Ask Worca emits (run, workflow or
   metrics proposal) is the assistant's reply. Hiding it would leave the chat
   text pointing at nothing. Trim the card's *fields*, not the card.
5. **Guides ask before they need a higher mode.** A Getting started step with a
   `level:` above the current mode asks "Switch to Expert?" before the tour
   moves anywhere; "Not now" leaves the mode and the page untouched
   (`startGuide` in `app.js`). If the mode is lowered while a tour runs, its
   next hop rings the mode switch instead of failing (`gsRaiseLevelHop`).
6. **Upgrades lose nothing.** An install that already has projects or runs
   starts at Expert, which is the UI it always had. Only a fresh install starts
   at Simple (`effectiveUiLevel` in `ui/server.mjs`). The first project and the
   welcome dismissal both end "fresh", so each pins the derived mode first
   (`pinUiLevel`) — a new user never jumps to Expert by using the app.

## Placing a new element

Ask these in order and stop at the first yes.

1. **Does a run wait until the user acts on it?** Or is it an error, a warning
   about money, or a recovery instruction? → **all levels, never gated.**
2. **Is it needed to start a run, watch it, answer it or read its result? Does
   it protect the user's money?** → `simple`.
3. **Does it need git, cost or workflow knowledge, and is its default safe to
   leave alone?** → `advanced`.
4. **Can a wrong value break runs, reroute API traffic or leak a secret? Is it
   authoring (agents, models, guardrail sets, plugins), diagnostics, per-node
   tuning or team infrastructure? Does its label need a glossary?** → `expert`.

When unsure, pick the **higher** level. Moving a control down later surprises
nobody; moving it up takes something away from people who use it.

Then check two things:

- **Can it hold a non-default value?** If yes, keep it visible when it does
  (rule 2).
- **Is it the only way to reach something a lower level needs?** If hiding it
  strands a Simple user, either lower it or give Simple a plain substitute (the
  "Files changed" list on the History overview stands in for the Diff tab).

Whole pages follow the same questions: tag the **entry points** (the nav item,
the tab button), never the page container, so deep links keep working.

## How to implement it

The mode lives in `<html data-level="simple|advanced|expert">`. The server
renders it (`src/core/index-html.mjs`), `ui/public/ui-level.mjs` keeps it live,
and three selectors in `ui/public/style.css` are the whole gate.

| Situation | Do this |
|---|---|
| Static markup in `index.html` | `data-min-level="advanced"` on the element |
| An element built in JS | `tagLevel(el, 'expert')`, or `el.dataset.minLevel = 'expert'` in a module that does not import `ui-level.mjs` |
| It can hold a non-default value | `keepVisible(el, isNonDefault)` (sets `data-level-keep`) |
| An option list, a default tab, anything CSS cannot express | `levelAtLeast('advanced')`, and repaint on the `worca:level` event (`onLevelChange` in `app.js`) |
| Something that changes layout size (graph node footers) | gate it in the renderer, not in CSS (`applyDecor` in `graph/run-decor.mjs`) |
| Copy that stands in for a control a higher mode shows | `data-max-level="simple"` (rare) |
| A detail tab | add `level:` to its entry in `RD_TABS` / `HD_TABS` / `PD_TABS` |
| A new page | add it to `VIEW_MIN_LEVEL` and `VIEW_TITLES` in `app.js` and tag its nav buttons |
| A new Settings tab | add it to `SETTINGS_TAB_MIN_LEVEL` and tag its tab button |
| A Getting started step | add `level:` to its entry in `GETTING_STARTED_STEPS` |

`test/ui-levels.test.mjs` fails when a nav item, Settings tab, Settings card or
detail tab has **no explicit level** — including `simple`. The decision cannot
be skipped by forgetting it.

### The switch

- Sidebar: `#nav-mode`, a plain `.nav button` directly above Settings. No
  `data-nav` (it is an action, not a page). Its icon is the state readout: a
  stack of layers, the second lit from Advanced, the third from Expert. On the
  collapsed rail the icon is all that shows.
- Below 1080 px the sidebar is hidden; `.topnav-mode` is the same control.
- Click opens `#mode-modal`: three radio cards. Choosing one applies at once
  (the app re-lays out behind the dialog), `POST /api/settings {uiLevel}`
  persists it, and a failed save reverts.
- Settings › General › Interface mode shows the current mode and opens the same
  dialog.
- Stored as `uiLevel` in `settings.json`. Absent means "never chosen".

## Catalogue

`S` = simple, `A` = advanced, `E` = expert, `all` = never gated.

### Navigation

| Element | Level |
|---|---|
| New pipeline, Getting started, Running, History, Projects, Settings | S |
| Ask Worca pill, sidebar spend indicator, the mode item | S |
| Statistics, Workflow Composer, Workspaces | A |
| Team metrics, Agents, Scripts | E |

### New pipeline

| Element | Level |
|---|---|
| Project, prompt, title, extra files, Start run | S |
| Workflow picker | S — lists Auto and Default only; the selected workflow always stays listed |
| Mock mode | S — sits beside Start run, outside the Advanced disclosure |
| "Set in Advanced mode and still applied" note | S |
| Target switch, task source (Markdown), source and feature branch | A |
| Advanced disclosure: guardrails, human in the loop, per-agent model and effort | A |
| Per-agent fan-out, sub-agent model, questions; feedback-loop max cycles; "Save as workflow defaults"; memory scope | E |

### Running

| Element | Level |
|---|---|
| Card status, title, elapsed, cost, Stop, Pause/Resume, open | S |
| Needs-input pill and banner; clarify questions; Auto proposal and Accept | S |
| Recovery prompt, cycle gate, cost-pause banner, retained-work banner | all |
| Workflow graph with status colours, gate pip, End result; Overview tab | S |
| Density toggle, live log pane, log search / copy / auto-scroll | A |
| Branch chip, progress n/m, model · effort pill, graph zoom cluster | A |
| Auto proposal Revise; Artifacts tab; Report this run | A |
| Log filters (source, level, node, cycle) | E |
| Graph node totals, fan and execution strips, loop badges | E |
| Agents tab, WORKTREE card, Auto proposal tunables table | E |

### History

| Element | Level |
|---|---|
| List, project filter, Refresh; Overview (verdict, findings, duration, cost, task); Clarify tab; Resume | S |
| "Files changed" list on the Overview | S — the stand-in for the Diff tab |
| Diff tab, diff pill, inline comments; Create PR / View PR; branch line; ⋯ menu (Archive, Report); Artifacts tab | A |
| Mergeability pill; Logs tab; Agents tab; team-metrics status; MEMORY CHANGES; WORKTREE card | E |

### Workflow Composer (page: A)

| Element | Level |
|---|---|
| Saved pipelines, canvas editing, agent palette, Save, Import, Export as JSON, validation chips | A |
| Inspector: model, effort | A |
| Script inspector: origin and runtime chips, params (what the card runs is never hidden); the Import dialog's command list | A |
| "Create agent…" in the palette (wizard with name, description, system prompt) | A |
| AND / OR / Combine nodes and input count | E |
| Scripts group in the palette (placing a card that runs a command) | E |
| Script inspector: timeout, await all inputs, port list and port editor | E |
| Inspector: fan-out, sub-agent model, ask questions, await all inputs, seed the plan store, port list; loop max cycles | E |
| Legend, save-dialog Domain, export as skill or plugin, legacy and archived rows | E |

### Agents (page: E)

Everything on the page, and the full agent form (runner type, ports, side
effect, mock role, workspace variants).

### Scripts (page: E)

Everything on the page: the list, the three tabs of a script and the test bench.

### Projects and Workspaces

| Element | Level |
|---|---|
| Projects list, add, project page Overview, remove | S |
| Project Memory tab (view and edit files) | A |
| Workspaces page, create wizard, description, re-scan, delete | A |
| Memory health, Defragment, snapshot restore | E — the health card stays visible when overdue or failing |
| Team-metrics cell and setup; workspace metrics table and home; KEY card | E |

### Settings

| Element | Level |
|---|---|
| General: Appearance, Interface mode, Budget & cost limits, Getting started, About | S |
| General: root folders, Ask Worca limits, chat notifications | A |
| Guardrails tab (list, details); Plugins tab (installed, available, install); Memory tab (files) | A |
| General: title model, Auto workflow model, spawn diagnostics | E |
| Guardrails create / delete; Models tab; marketplaces, Doctor, leftover data | E |

### Statistics, Team metrics, Ask Worca, Getting started

| Element | Level |
|---|---|
| Statistics page | A |
| Team metrics page and every surface of it elsewhere | E |
| Ask: chat, history, attachments, run card, proposal title / project / workflow / brief / Start | S |
| Ask: proposal cards themselves | all (rule 4) |
| Ask: model picker, scope, ctx and cost meter, tool rows, branches, guardrails, "Open in New Pipeline" | A |
| Ask: per-agent lane, worktrees, agents popover, sub-agent logs | E |
| Getting started: all eight tiles show at every level, ordered Simple → Advanced → Expert; steps 6 and 7 wear "Advanced", step 8 "Expert" | S |
