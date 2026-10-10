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
| `simple` | New to Worca | The core loop: pick a project, describe the task, watch the run, answer its questions, read the result. Budget limits. The Workflows view: workflows, agents and scripts. Nothing here can break a run. |
| `advanced` | Regular use | How a run executes and what it changed: branches, guardrails, per-agent model and effort, the live log, the diff, pull requests, plugins, memory files. |
| `expert` | Authoring and team setup | Everything: model and guardrail authoring, routing env and secrets, fan-out and loop limits, log filters, per-node run detail, diagnostics, team metrics. |

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
   `#models` opens at Simple. The page shows a banner naming its level
   and offering the switch. Never disable a control or refuse a route because of
   the mode.
4. **An answer is never hidden.** A card Ask Worca emits (run, workflow or
   metrics proposal) is the assistant's reply. Hiding it would leave the chat
   text pointing at nothing. Trim the card's *fields*, not the card.
5. **Guides ask before they need a higher mode.** A Getting started step with a
   `level:` above the current mode asks "Switch to Expert?" before the tour
   moves anywhere; "Not now" leaves the mode and the page untouched
   (`startGuide` in `app.js`). If the mode is lowered while a tour runs, its
   next hop rings the account corner, then **Interface mode**, then the mode,
   instead of failing (`gsRaiseLevelHop`).
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
| A new page | add it to `VIEW_NAMES`, `VIEW_MIN_LEVEL` and `VIEW_TITLES` in `app.js` and tag its nav buttons; a page that takes over an old address (a Settings tab that became a page) maps it in `MOVED_ROUTES`, so links and bookmarks keep landing |
| A new Settings tab | add it to `SETTINGS_TABS` and `SETTINGS_TAB_MIN_LEVEL`, tag its tab button, and keep the strip ordered Simple → Advanced → Expert |
| A Getting started step | add `level:` to its entry in `GETTING_STARTED_STEPS` |

`test/ui-levels.test.mjs` fails when a nav item, Settings tab, Settings or Models page card or
detail tab has **no explicit level** — including `simple`. The decision cannot
be skipped by forgetting it.

### The switch

- The account menu: the corner at the foot of the sidebar (`#side-acct`) opens
  it, and its **Interface mode** row (`#acct-lvl`) names the current mode and
  opens a side menu (`#lvl-menu`) with Simple, Advanced and Expert. Each has
  bars showing how much of Worca is on screen and one line on what it adds.
  Choosing one applies at once, `POST /api/settings {uiLevel}` persists it, a
  failed save reverts, and both menus stay open so the page behind changes in
  place. Esc closes the side menu, then the menu.
- On the rail (tablets, and a folded sidebar) the corner is the avatar alone and
  opens the same menu; on a phone it sits at the foot of the drawer, and the
  drawer stays open while the menu is used.
- Settings › General › Interface mode shows the current mode, and its
  **Change…** opens `#mode-modal`: three radio cards that apply the same way.
  The guides open that dialog too when a save failed.
- `ui-level.mjs` paints all three (the menu row and side menu, the Settings card,
  the dialog) from one controller.
- Stored as `uiLevel` in `settings.json`. Absent means "never chosen".

## Catalogue

`S` = simple, `A` = advanced, `E` = expert, `all` = never gated.

### Navigation

| Element | Level |
|---|---|
| New pipeline, Getting started, Runs, Projects | S |
| Build: the group label, Workflows (the full-screen editor; agents and scripts live in its Library) | S |
| Runs counts: the amber Needs-you pill, else the live count as a grey number | S — each hidden at zero |
| Ask Worca button | S |
| The account corner and its menu: Interface mode, Settings, the away row, "Signed in as" (a shared identity) | S |
| The spend ring on the avatar and the menu's spend card (with the free-request row) | S — never hidden: a blocked limit turns the ring red and full, and the card and the New pipeline note say until when |
| Statistics, Workspaces | A |
| Add-ons: the group label, Marketplace, Connectors | A |
| Add-ons: Models, Providers | E — like every page, the open one keeps its row at a lower mode while the banner names its level |
| Schedules | A — kept visible at every level while anything is scheduled, missed, repeating or unread; its grey count and amber unread pill each hide at zero |
| Team metrics, Team policy | E |

### New pipeline

| Element | Level |
|---|---|
| Project, prompt, title, extra files, Start run | S |
| Start run's caret menu (Schedule…) | A |
| Workflow picker | S — lists Auto and Default only; the selected workflow always stays listed |
| Mock mode | S — sits beside Start run, outside the Advanced disclosure |
| "Set in Advanced mode and still applied" note | S |
| Target switch, task source (Markdown), source and feature branch | A |
| Engine dropdown beside the workflow (greyed-out engines the credential broker refuses) | A — stays visible at every level while a non-Claude engine is picked (rule 2) |
| Advanced disclosure: guardrails, human in the loop, per-agent model and effort | A |
| Per-agent fan-out, sub-agent model, questions; feedback-loop max cycles; "Save as workflow defaults"; memory scope | E |

The **Auto** workflow option is available for both targets — a project and a workspace.

### Running

| Element | Level |
|---|---|
| Card (History-level): status, title, elapsed, cost, Stop, Pause/Resume, open; a strip on a waiting or parked run that opens the run page at its question | S |
| "Scheduled" group (runs due within 24 h) | S — it only exists when something is scheduled |
| Needs-input pill and banner; clarify questions; Auto proposal ("Review the workflow": preview that opens a pan/zoom popup, Accept) — all answered on the run page | S |
| Recovery prompt, cycle gate, cost-pause banner, retained-work banner | all |
| Run page glance: the run's name as the page title, the status line (state, then the step), time · cost (with its Away mode share) · changes, the Live view switch and its fogged graph of the running step(s), parallel steps (Now), one row per tab, a waiting question below its own heading, the result actions | S |
| Workflow graph with status colours, gate pip, End result; Workflow, Overview and Q&A tabs | S |
| Run header cost and its breakdown (agents, Away mode, Auto workflow, run title; stopped reviews and stopped agent turns apart); the Overview cost card's Away mode share | S |
| "Answered for you": one group per ask (kind · time · model · cost of its review, or "review stopped" and its lower bound), the answers, Check; the heading's answer count and what the Away mode reviews cost | S |
| Diff tab (live worktree while running, the final patch after) | A |
| Live log pane (run page › Logs), log search / copy / auto-scroll | A |
| Branch chip, progress n/m · step on the card, model · effort pill, graph zoom cluster | A |
| Auto proposal Revise; Artifacts tab | A |
| Actions tab, Overview actions strip, Ship It 'Try it first' strip | A |
| Running-action pill in the header, sidebar Running actions rows (one tile on the rail) | all — shown only while a service runs |
| Log filters (source, level, node, cycle) | E |
| Graph node totals, fan and execution strips, Away mode chips and bands, loop badges | E |
| Agents tab, worktree row, Auto proposal tunables table | E |

### History

| Element | Level |
|---|---|
| List, project filter, Refresh; Overview (verdict, findings, duration, cost, task); Clarify tab; Resume | S |
| Header cost and its breakdown (agents, Away mode, Auto workflow, run title; stopped reviews and stopped agent turns apart); the glance and Overview cost's Away mode share | S |
| "Answered for you", as on the run page | S |
| "Files changed" list on the Overview | S — the stand-in for the Diff tab |
| Diff tab, diff pill, inline comments; Create PR / View PR; branch line; ⋯ menu (Archive, Restore, Report); Artifacts tab; Archived toggle in the Runs header (with Restore) | A |
| Actions tab, Overview actions strip, Ship It 'Try it first' strip | A |
| Ship It modal: Open as draft checkbox, "Will close owner/repo#N" line | A — ungated inside the modal (no `data-min-level`), so they show wherever the modal opens |
| Running-action pill in the header, sidebar Running actions rows (one tile on the rail) | all — shown only while a service runs |
| Mergeability pill; Logs tab; Agents tab; team-metrics status; MEMORY CHANGES; worktree row | E |

An open github.com pull request shows its state as GitHub's merge box would
(Draft, Merge conflicts, Changes requested, checks failed or running, Review
required, Out of date, Blocked, Ready to merge) in two places: the footer of the
run page's pull request button, and a "Pull request" row under the review verdict
on the Overview tab (one row per repository for a workspace run). Both show at
every level; the Watch switch in them is advanced.

Watch PR is opt-in, also in Ship It. It supports github.com only and batches
failed checks, merge conflicts and trusted author, owner, member or collaborator
feedback into at most three automatic fix runs, skipping checks that also fail on
the base branch. Review text is untrusted code feedback. Each fix run is an unattended
Implement ⇄ Review on the PR's own branch, run through the built-in PR fix
workflow (`wf_pr_fix`, internal and not listed in the picker): it keeps the
original run's guardrails and engine (and a mock run's mock flag), never asks a
person, and uses the project's default agent models. A PR merged or closed while
a fix ran is not pushed to. Turning the watch off stops new work;
already-active work drains through publishing. Turning an idle watch off and on
resets its run allowance. Worca replies to review threads without resolving them.
With the watch off, or waiting for a person, Resolve on a conflicted PR merges the
base branch in once.

### Workflows

The full-screen editor (`#workflows`) is Simple, and nothing inside it is
gated: the view shows the same controls at every level.

| Element | Level |
|---|---|
| The canvas, the top bar (Back, Workflows ▾ with New canvas, Open…, Import… and Export…, the name and its validation chip, the Library toggle, Save), Auto-layout and the zoom menu | all |
| The "+" menu: Task, End, AND, OR, Combine, Agent…, Script…, New agent…, New script… | all |
| The selection toolbar and its More / Params popover: model, effort, fan-out, ask questions, await all inputs, input count, seed the plan store, loop max cycles; a script's params, timeout and port editor | all |
| The Library: Agents, Scripts and Workflows tabs, every row action (Add to canvas, View, Edit, Duplicate, Delete, Open, Export), New agent and New script, legacy and archived rows | all |
| The agent sheet: the full agent form (runner type, ports, side effect, mock role, workspace variants) and the agent wizard | all |
| The script sheet: the runtime step, the workspace and the bench under its editor; the Import dialog's command list | all |
| The composer chat in the dock | all |
| The save dialog's Domain | all |
| Export as a Claude Code skill or a Worca plugin (the shared Export dialog) | E |

The old addresses `#composer`, `#agents`, `#scripts` and `#agent-create` land
inside the view.

### Projects and Workspaces

| Element | Level |
|---|---|
| Projects list, add, project page Overview, remove | S |
| Project Memory tab (view and edit files) | A |
| Project page Actions tab | A |
| Workspaces list, create wizard, workspace page Overview (projects, description, re-scan, delete) | A |
| Workspace page Map tab (coverage, graph, edges, confirm / reject / clear, add / delete manual edges, Regenerate description) | A |
| Workspace page Actions tab | A |
| Memory health, Defragment, snapshot restore | E — the health card stays visible when overdue or failing |
| Projects-row team chips; project page Team tab and its TEAM METRICS / TEAM POLICY cards; KEY card | E |
| Workspace page Team tab (members table, metrics home, policy home) and its METRICS HOME / POLICY HOME cards | E |

### Settings

| Element | Level |
|---|---|
| General: Appearance, Alerts, Interface mode, Getting started, About | S |
| Runs tab: Budget & cost limits | S |
| General: root folders; Runs tab: Scheduled runs defaults, Workspaces (scan models), chat notifications; Ask Worca tab (limits, tools, web access, chat history) | A |
| Runs tab: Actions (keep policy, port range, editor/terminal, cap) | A |
| Guardrails tab (list, details); Memory tab (files) | A |
| General: spawn diagnostics; Memory tab: the line linking to Helper jobs | E |
| Guardrails create / delete | E |

### Marketplace, Connectors, Models, Providers (the Add-ons pages)

Settings tabs once, pages of their own now. The old addresses (`#settings/plugins`, `#settings/mcp/…`,
`#settings/models/…`, `#settings/providers`, `#plugins`) land on the page they mean, sub-path kept.

| Element | Level |
|---|---|
| Marketplace page: installed, available, install | A |
| Marketplace page: Add marketplace, the Marketplaces list, Doctor, leftover data | E |
| Connectors page: the Sets, Servers and Skills views | A |
| Models page: the catalog, and the Engines card (Default engine, Models per engine: Step models and Helper jobs tables, including titles, Auto classifier, PR description and Memory defragment) | E |
| Models page: the catalog toolbar (search, filter chips, folding groups), the editor dialog's Connection section, the Import-models dialog (Copilot and OpenAI-compatible sources) | E |
| Providers page: Providers card (Copilot sign-in, account type, concurrency cap, key rows) and its Import-models shortcuts | E |
| The Copilot notice modal; a card's "needs sign-in" pill and button; the New pipeline caption's "needs sign-in" note | all (rule 1 — they block a run) |

### Statistics, Team metrics, Team policy, Ask Worca, Getting started

| Element | Level |
|---|---|
| Statistics page | A |
| Team metrics page and every surface of it elsewhere | E |
| Team policy page and its Policy / Plugins / Catalog tabs | E |
| Team-policy notes on New pipeline; the team caps readout under Budget & cost limits | all — a team cap applies in every mode, so the reason it applies is never hidden |
| Required-plugins strip and setup checklist (the Marketplace page) | A — with the page that holds them |
| Ask: chat, history, attachments, run card, proposal title / project / workflow / brief / Start | S |
| Ask: a proposal's own schedule (the "Schedule" action and its time), schedule-change cards | S — the answer the user asked for |
| Ask: a proposal's tracker task (id, title, link) in place of the brief; the "Auto" workflow option when Ask proposed it | S |
| Ask: "Schedule…" on a plain run proposal | A |
| Ask: a classified failure's human notice (what happened and where the remedy lives) | all — recovery instructions are never hidden (rule 1); Simple gets no Models page navigation, the copy names the mode instead |
| Ask: a classified failure's raw-detail expander ("Details") | E |
| Ask: proposal cards themselves | all (rule 4) |
| Ask: the context ring and its popover's window fill and topics | S |
| Ask: model picker, scope, cost meter, tool rows, branches, guardrails, "Open in New Pipeline" | A |
| Ask: per-agent lane, the context popover's Agents and Worktrees sections, sub-agent logs | E |
| Getting started: all nine tiles show at every level, ordered Simple → Advanced → Expert; steps 6 and 7 wear "Advanced", steps 8 and 9 "Expert" | S |
