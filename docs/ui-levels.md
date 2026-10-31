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
   the cost-pause banner, the worktree notice (work retained after a failed commit) and any clarifying question
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
4. **An answer is never hidden.** A card Chat emits (run, workflow or
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

Feature flags are not levels: an element with `data-flag` shows when its flag is on, at any level;
with `data-min-level` as well, both must allow it ([feature-flags.md](feature-flags.md)).

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
| Build: Requirements (behind the requirements flag) | S |
| Runs counts: the amber Needs-you number (no symbol), else the live count as a grey number | S — each hidden at zero |
| Chat (the first sidebar row; the app's home) | S |
| Chat home: Start from a preset chips; "N more…" opens New run below Advanced and Settings › Presets from Advanced | S |
| The account corner and its menu: Interface mode, Settings, the Away and Keep awake switches, "Signed in as" (a shared identity) | S |
| The spend ring on the avatar and the menu's spend card (with the free-request row) | S — never hidden: a blocked limit turns the ring red and full, and the card and the New pipeline note say until when |
| Statistics, Workspaces | A |
| Add-ons: the group label, Marketplace, Connectors | A |
| Add-ons: Models, Providers | E — like every page, the open one keeps its row at a lower mode while the banner names its level |
| Schedules | A — kept visible at every level while anything is scheduled, missed, repeating or unread; its grey count and amber unread pill each hide at zero |
| Team metrics, Team policy | E |

### New pipeline

| Element | Level |
|---|---|
| Project, prompt, title, extra files, Start run; "Reuse last task" after a run starts (#687) | S |
| Start run's caret menu (Schedule…) | A |
| Workflow picker | S — lists Auto and Default only; the selected workflow always stays listed |
| Mock mode | S — sits beside Start run, outside the Advanced disclosure |
| Preset ▾ button and its menu (presets, Rename…, Delete…, Save as preset), its ✕, Update preset | S |
| Preset picker's "Manage presets…" entry | A |
| "Set in Advanced mode and still applied" note | S |
| Target switch (No project · Project) | S — its Workspace button A |
| Task source (Markdown), source and feature branch; "Run on the source branch" toggle | A |
| "Not sure what to build yet? Try Shaper" under the Markdown source (Shaper, gated) | A |
| Engine dropdown beside the workflow (greyed-out engines the credential broker refuses) | A — stays visible at every level while a non-Claude engine is picked (rule 2) |
| Advanced disclosure: guardrails, human in the loop, per-agent model and effort | A |
| Per-agent fan-out, sub-agent model, questions; feedback-loop max cycles; "Save as defaults"; memory scope | E |

The **Auto** workflow option is available for both targets — a project and a workspace.

### Running

| Element | Level |
|---|---|
| Card (History-level): status, title, elapsed, cost, Stop, Pause/Resume, open; a strip on a waiting or parked run that opens the run page at its question | S |
| "Scheduled" group (runs due within 24 h) | S — it only exists when something is scheduled |
| Needs-input pill and banner; clarify questions; Auto proposal ("Review the workflow": preview that opens a pan/zoom popup, Accept) — all answered on the run page | S |
| Recovery prompt, cycle gate, cost-pause banner | all |
| Run page card head: the status line, the head buttons (Try it, Create PR, Push, View PR │ ▾, Fix conflicts, Ask for changes, Discard / Apply to branch, How to merge, Discard / Apply to folder, Report) and the route (Where the work is) | S |
| View PR ▾ › Watch | A |
| Summary card › a live checkout: the Results row with Discard / Unlink | S |
| Summary card › the Actions row value (`Local copy open · since 18:12`, `Try it on this machine`) and the Actions tab's Download patch | A |
| Plan approval (Shaper): one step card — head (title + Plan chip), summary, folded shape check, Ask for changes / Full plan / Approve and build / ⋯ (Fix all, Save to plans/, Stop); the same card with the gate off (Full plan opens the artifact viewer) | all (rule 1) |
| Plan approval extras: perspectives "edit" (chips + Update plan), Fix all, Save to plans/ | S |
| Plan approval: Open in New run | A |
| Split approval (Plan in runs): one step card — head (title + Runs chip), the runs, the outline check, Ask for changes / Approve N runs / ⋯ (Fix all, Don't split, Stop) | all (rule 1) |
| Split extras: per-run ⋯ (Merge with next, Remove), Undo edits, "Ask me before each run" | S |
| Run page Overview: Perspective checklists (Shaper, gated): the latest review cycle as one summary line, unmet items open with their evidence, met items behind "Show N met items", earlier cycles behind "Earlier cycles" | S |
| Run page: usage-limit notice (reset time, Resume at HH:MM, Cancel) | S |
| Runs list / glance: "resets HH:MM" / "resumes HH:MM" | S |
| Runs list: the View menu (Show with counts, Group by, Started by on a shared deployment, Select, Keyboard shortcuts) and its chip; the row and member checkboxes, Select all, Space / ⌘A / Esc; the list keys (↑ ↓ / J K, ↵, → ←, `.`, S, E, Space, ⇧↑ ⇧↓, ⌘A, Esc), `?` and the Keyboard shortcuts sheet; the action bar's Stop and Archive (Undo); the row ⋯ menu's Stop, Archive (Restore on an archived row), View PR and Open feature, each with its key as a hint | S |
| Runs list: the label filter (chosen from the top search, "Runs labelled hotfix" or label:hotfix) and its chips with × under the header; the action bar's Label (with runLabels) | S |
| Runs list: Delete (the action bar and the row ⋯ menu); Add to group… and Remove from group (the row ⋯ menu); their keys ⌫, G and ⇧G | A |
| Run page: "Add to group…" on the Group row of a run in no group, the same as in the list's row menu | A |
| Resume menu: Resume at HH:MM (when the limit resets) | A |
| Run page glance: the run's name as the page title, the status line (state, then the step), time · cost (with its Away mode share) · changes; the Cost tags row under them, the Live view switch and its fogged graph of the running step(s), parallel steps (Now), one row per tab, a waiting question below its own heading, the result actions | S |
| Run progress: the bar under the status line (Plan · Build · Review · Ready, blue / amber / green), its text ("Build · task 2 of 4") in place of "Step: …", the chain's overall bar ("Run 2 of 3"), the Runs list's group bar and group row with its ⌄ | S |
| Run progress hover breakdown: stages with their agents and states, review pass count | A |
| Workflow graph with status colours, gate pip, End result; Workflow, Overview and Q&A tabs | S |
| Run header cost and its breakdown (agents, Away mode, Auto workflow, run title; stopped reviews and stopped agent turns apart); the Overview cost card's Away mode share | S |
| "Answered for you": one group per ask (kind · time · model · cost of its review, or "review stopped" and its lower bound), the answers, Check; the heading's answer count and what the Away mode reviews cost | S |
| Diff tab (live worktree while running, the final patch after) | A |
| Folder run (a Folder project): Changes tab, the Folder chip, the "<n> files · on a copy" bar with Discard and Apply to folder, the Apply to folder dialog | S |
| Run without a project (No project): the Artifacts tab, opened first; the No project chip | S |
| Live log pane (run page › Logs), log search / copy / auto-scroll, Summaries / Raw switch (flag `commandSummaries`) | A |
| Step log drawer under the Workflow graph (a card or execution-row click; Open in Logs, resize, close), Summaries / Raw switch (flag `commandSummaries`) | A — follows the Logs tab |
| Branch chip, progress n/m · step on the card, model · effort pill, graph zoom cluster | A |
| Auto proposal Revise; Artifacts tab | A |
| Actions tab, Overview actions strip, Create PR 'Try it first' button and strip | A |
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
| Save as preset (a run with a stored setup) | S |
| Run page bar: Back (every layout) and ⋯ (Away mode while live, Save as preset, Terminal, Report this run, Archive / Restore) | S |
| History: usage-limit notice | S |
| "Files changed" list on the Overview | S — the stand-in for the Diff tab |
| Folder run: Changes tab, the Folder chip, the Apply bar and dialog, Discard; the Git / Folder chip on a project's group in the Runs list | S |
| Run without a project: the Artifacts tab, opened first; the No project group and its chip in the Runs list | S |
| Overview: Perspective checklists, as on the run page (shaped runs) | S |
| Diff tab, diff pill, inline comments; Create PR / View PR; "Push <source>" (a run on its source branch, instead of a PR); branch line; Artifacts tab | A |
| Actions tab, Overview actions strip, Create PR 'Try it first' button and strip | A |
| Create PR dialog: Draft switch, "Will close owner/repo#N" line | A — ungated inside the modal (no `data-min-level`), so they show wherever the modal opens |
| Running-action pill in the header, sidebar Running actions rows (one tile on the rail) | all — shown only while a service runs |
| Mergeability pill; Logs tab; Agents tab; team-metrics status; MEMORY CHANGES; worktree row | E |
| Step log drawer under the Workflow graph, as on the run page | E — follows the Logs tab |

An open github.com or Azure DevOps pull request shows its state as GitHub's merge box would
(Draft, Merge conflicts, Changes requested, checks failed or running, Review
required, Out of date, Blocked, Ready to merge) in two places: the run page card's
status line (its checks line in the route's pull request row), and a "Pull request" row under the review verdict
on the Overview tab (one row per repository for a workspace run). Both show at
every level. Watch is changed from the View PR ▾ menu (Advanced) and from the
Overview row's switch (Advanced).

Watch PR is opt-in. In Ship It its switch starts from the project's **Watch new pull requests** setting (Project
page › Settings › Pull requests; off by default), and a workspace's Ship It starts it on only when every repository
it lists has that setting on. Watch PR supports github.com, Azure DevOps
([how Azure maps](azure-devops.md#watch-pr)) and Bitbucket Cloud ([how Bitbucket maps](bitbucket.md#watch-pr)) and batches
failed checks, merge conflicts and trusted author, owner, member or collaborator
feedback into at most three automatic fix runs. Checks that also fail on the base
branch are skipped, counted apart on the checks line ("· 2 also failing on dev")
and named in the fix brief as not the PR's to fix. A failed GitHub Actions check is
re-run (an Azure build policy re-queued) once per PR commit before any fix; a failure the base head has no result for
yet waits up to 30 minutes for it; and when the PR is behind its base and the base
head passes the failing check, the base is merged in first. When it merges cleanly
Worca writes the merge commit itself and pushes it: no agent, and no fix run used.
Only a conflicting merge starts a fix run, which merges the base in and nothing else. Review
text is untrusted code feedback. Each fix run is an unattended
Implement ⇄ Review on the PR's own branch, run through the built-in PR fix
workflow (`wf_pr_fix`, internal and not listed in the picker): it keeps the
original run's guardrails and engine (and a mock run's mock flag), never asks a
person, and uses the project's default agent models. A PR merged or closed while
a fix ran is not pushed to. Turning the watch off stops new work;
already-active work drains through publishing. Turning an idle watch off and on
resets its run allowance. Worca replies to review threads without resolving them.
With the watch off, or waiting for a person, Resolve on a conflicted PR merges the
base branch in once.

A pull request opened from a Chat card shows the same watch on that card, as its link's tooltip
(`PR #781 · watched`, `PR #781 · watch stopped`, or just `PR #781` while it is not watched). With Shaper on, a fix
run is a round of the run whose PR it fixes: it shows on that run's card, not as a card of its own (see
[Iterate in the chat](shape-it-first.md#iterate-in-the-chat-s5)). With Shaper off, every fix run on it, whether Watch PR started it or Resolve
did, appears in that chat by itself as a live run card. The card says what started the run (merge conflicts,
failing checks, review comments, changes requested) and links to the pull request. It ends with the outcome: the
pushed fix, why nothing was pushed, or that the watch gave up after three fix runs. The card is saved with the
chat, so it is there when the chat is opened later. The Chat row's dot lights when it lands in a chat that is not
on screen. Nothing else is posted: switching the watch, a stop that needs a person, and a clean base merge show
only in the tooltip.

### Workflows

The full-screen editor (`#workflows`) is Simple, and nothing inside it is
gated: the view shows the same controls at every level.

| Element | Level |
|---|---|
| The canvas, the top bar (Back, Workflows ▾ with New canvas, Open…, Import… and Export…, the name and its validation chip, the Library toggle, Save), Auto-layout and the zoom menu | all |
| The "+" menu: Task, End, AND, OR, Combine, Agent…, Script…, New agent…, New script… | all |
| The selection toolbar and its More / Params popover: model, effort, fan-out, ask questions, await all inputs, input count, seed the plan store, loop max cycles; a script's params, timeout and port editor | all |
| The Library: its Agents / Scripts / Workflows selector with each registry count, the domain folders that expand in place (Flow, Archived), the header search, every row action (Add to canvas, View, Edit, Duplicate, Delete, Open, Export), New agent and New script, legacy and archived rows | all |
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
| Projects list, add, project page Overview, remove, Use git (Folder projects) and Link remote (Git projects without origin) | S |
| Project Memory tab (view and edit files) | A |
| Project Memory tab › Team view (Local · Team · Both choice, note states, share existing notes, Compare, Undo seeding); project Settings › Team memory | A |
| Project page Overview › "Your team shares memory for this repository" (Turn on, Not now); the "team memory available" mark in the Projects list and the workspace wizard's import list | A |
| Project page Actions tab | A |
| Project page Automations tab (flag gitAutomations: Auto-handle switches with what each does and its limits, your own rules with Add / Turn off / Delete, each switch's and rule's limits with Edit limits, Waiting (the queue, in order, with Start now and Remove), Recent with Approve and Open run, Check now; a note naming the workspace whose rules take this repository's events over) | A — "Approve" waits on a person, but a `/worca approve` comment on GitHub or Azure DevOps answers it too |
| Workspaces list, create wizard (with its Add… / paste-box import), workspace page Overview (projects, the Remove confirm's re-scan choice and recommendation, description, re-scan, delete) | A |
| Workspace header "Scan model" control (view / change / clear the saved re-scan model); the choose-a-model window a re-scan opens when the workspace has no usable pick — it unblocks the re-scan, so it shows at any level | A |
| Workspace page Map tab (coverage, graph, edges, confirm / reject / clear, add / delete manual edges, Regenerate description) | A |
| Workspace page Actions tab | A |
| Workspace page Automations tab (flag gitAutomations: the project tab's switches, rules and Recent over every member's repository, the repositories watched, View PR, or View PRs ▾ listing each changed repository's PR) | A — as the project page's |
| Memory health, Defragment, snapshot restore | E — the health card stays visible when overdue or failing |
| Projects-row team chips; project page Team tab and its TEAM METRICS / TEAM POLICY cards; KEY card | E |
| Workspace page Team tab (members table, metrics home, policy home) and its METRICS HOME / POLICY HOME cards | E |

### Settings

| Element | Level |
|---|---|
| General: Appearance, Alerts, Interface mode, Getting started, About | S |
| Runs tab: Budget & cost limits (incl. Resume runs automatically when a usage limit resets) | S |
| Runs tab: Pull requests (Draft the PR description with AI automatically) | S |
| Runs tab: Network proxy | S — timeouts and the local port under More |
| Labs tab (feature flags) | S — flags are independent of levels (docs/feature-flags.md) |
| General: root folders; Runs tab: Scheduled runs defaults, Workspaces (scan models), chat notifications; Chat tab (limits, tools, web access, chat history) | A |
| Runs tab: Actions (keep policy, port range, editor/terminal, cap) | A |
| Runs tab: Wait for the network | A |
| Runs tab: Machine load (runs at once, test workers per run, archive finished runs after) | A |
| Guardrails tab (list, details); Memory tab (files) | A |
| Presets tab (every preset: Use, Rename, Duplicate, Edit scope, Delete) | A |
| Automations tab (flag gitAutomations: the overview — delivery, the projects and workspaces that automate something with Open, Waiting across them with Start now and Remove, Recent across them with Approve and Open run) | A |
| General: spawn diagnostics; Memory tab: the line linking to Helper jobs | E |
| Guardrails create / delete | E |

### Marketplace, Connectors, Models, Providers (the Add-ons pages)

Settings tabs once, pages of their own now. The old addresses (`#settings/plugins`, `#settings/mcp/…`,
`#settings/models/…`, `#settings/providers`, `#plugins`) land on the page they mean, sub-path kept.

| Element | Level |
|---|---|
| Marketplace page: the Browse, Installed and Marketplaces tabs, install, update, Add marketplace, Health (Check health), leftover data and Purge | A |
| Connectors page: the Sets, Servers and Skills views | A |
| Models page: the catalog, and the Engines card (Default engine, Models per engine: Step models and Helper jobs tables, including titles, Auto classifier, PR description, Memory defragment, Agent generation and, behind the `requirements` flag, Requirements interview) | E |
| Models page: the Roles card (Deep thinking, Everyday coding, Quick jobs per harness; its Claude / Codex switch is E). The Models nav entry is E, so below Expert the card opens from the `#models` address until the setup assistant adds a Simple-level way in | S |
| Models page: the catalog toolbar (search, filter chips, folding groups), the editor dialog's Connection section, the Import-models dialog (Copilot and OpenAI-compatible sources) | E |
| Providers page: Providers card (Copilot sign-in, account type, concurrency cap, key rows) and its Import-models shortcuts | E |
| The Copilot notice modal; a card's "needs sign-in" pill and button; the New pipeline caption's "needs sign-in" note | all (rule 1 — they block a run) |

### Requirements (behind the `requirements` flag)

| Element | Level |
|---|---|
| The list: the filter tabs (All open, Needs you, Ready, Started, Archived; the counts leave archived out), New feature, the feature rows grouped by project or workspace (id, title, the state line, the state badge or the latest run's pill, cost), "Spent on requirements this month" | S — product owners are its users |
| The list's group header: "Product brief: none yet · Create", "Product brief: being made…", "Product brief · <age> old" | S |
| New feature: Title, Describe it, For, the code-look hint or the green "Worca knows <name> from its product brief" line, "Worca interviews with <model> at <effort> effort" and the cost words, Cancel, Start the interview | S — the interview model is shown here, changed only on Models (E) |
| A feature's header: id, title, state, the target, round and cost chips, "Saved as specs/…"; Export ▾ (Save to specs/, Copy Markdown, Download .md); ⋯ (Your notes for Worca, Look closer / Look again, Archive / Restore) | S |
| Export to a tracker: Export ▾'s Export to Jira… and Export setup…, the setup dialog, the preview (fields, labels, the description, Export anyway), Export again and the comment preview, the failure states, the header's ticket chip, "Created SHOP-123", the History card, Report back on Ready to build, the start dialog and the runs card; on a phone (900 px and narrower) the dialogs as full-screen sheets | S — product owners are its users |
| Connect a tracker… (the menu item and its dialog) | S |
| Connect a tracker's Open the Marketplace page | A — the Marketplace page is Advanced |
| A feature's interview: the question card (options, Recommended, your own answer, Finish now, Skip, use recommended, Submit), Earlier rounds and Change, the working line, the error line and Try again | S |
| Feature chat: the header's Feature chat, Help me answer on each open question, the panel beside the spec and the phone sheet (Back), the first-open text and its three questions, the composer and its cost line, Answering… and Stop, the failed, stopped and spending-limit lines, Try again, ⋯ Clear chat | S — product owners are its users |
| Feature chat's drafts in the question card (drafted by Worca, ×, "Worca's draft: …") and its proposal cards (Before / After, New, Remove, Confirm / Reject, Why, Reject / Accept / Ask again, Accepted, Rejected, "The spec changed since Worca proposed this.") | S |
| A feature's spec card: the sections and their edits, Let Worca rewrite this, criteria add / remove, assumptions Confirm / Reject, the folded flow, edge cases, rules and out of scope | S |
| Ready to start?: the six checks and what each misses, Start in Worca, "Start before it's Ready…" and its dialog (the failing checks, the required reason, "Recorded as") | S |
| Decide the assumptions: Confirm / Reject, Show the other N, Confirm the N left, "Done, ask about A-n" | S |
| Ready to build: what Start does, the Workflow and Branch from chips, Start in Worca | S — the chips show a non-default workflow or branch at every level (rule 2) |
| Ready to build: Change (the Workflow and Branch from pickers) | A — like New pipeline's workflow list and branches |
| A started feature: Runs from this feature (each run's pill, spec version, "started before Ready", cost and link; the total; Start again with v<n>), Changed since the run started and Undo my changes, the "v<n> draft / v<n> started" switch | S |
| What Worca found in the code (a feature whose project or workspace has no product brief): the summary, how often Worca looked and what it cost, Look again | S |
| What Worca found in the code: the files Worca read | A |
| What Worca knows (a feature with a product brief): "from the product brief · <age>", what the brief describes, "Look closer · about $X" and its hint ("Worca works from the <name> brief and the files below." when the feature has files); after a closer look, "brief + a closer look · N files · $X", the summary, Add this to the brief, Look again | S |
| New feature: the Files field (the drop zone, the picked files, the refusal line), the privacy note, "Files stay on the feature…"; the feature page's "Reading N files…" | S — product owners are its users |
| The Files card: Files · N, Add files, the privacy note, "No files yet. Add emails, a spec, screenshots or a mockup.", each file (name, kind · size · cost, What Worca took from it, edited by you, Show all, the answers, Reading… / Asking… / could not read / Not read yet, Try again), Send with the run, "The spec mentions this file", the pencil and the ⋯ menu (Open, Edit, Ask about this file…, Replace with a newer version…, Read again, Remove); the header's "N files" chip | S — the switch shows its value at every level (rule 2) |
| Replace and its dialog; Ask about this file and its panel; the source tags on criteria and assumptions, "From <file>:" on questions | S |
| Ready to build: Files for the run (the chips, "n of m go with it", From the brief, a file that cannot go with the run, what the spec mentions) | S — the chips show which files go at every level (rule 2) |
| Decide: Ask about <file> (a file added or replaced after the interview), the "<file> to ask about" hint; Changed since the run started: the file lines and what Undo puts back | S |
| Product brief page, made: the Documents card (as the Files card, with Send with every run), "N documents", "(from <document>)" on brief items | S |
| A file's "Earlier text" history | A — as the files of a code look |
| Product brief page, none yet: Give Worca a head start (the four parts), the look box (branch, estimate, model, Create the brief / Try again, and why it cannot), the members left out, Your notes for Worca (the notes, "Let Worca look at the code", Save notes) | S — the switch shows its value on this page at every level (rule 2) |
| Product brief page, made: the chips (Made from <branch> @ <commit> · <age>, cost, Used by N features, Built from the workspace map), Export ▾ (Copy Markdown, Download .md), ⋯ (Refresh the brief · about $X, Delete the brief), Refreshing and the failed-refresh line, "The code moved on since this brief" and Refresh, the four sections with their pencils, "edited by you" and Let Worca rewrite this, How Worca uses it, Your notes for Worca and Edit notes | S |
| Product brief page: What Worca read (the files) | A — as the files of a code look |

Create the brief, Refresh, Look closer and Look again read the code with git: they are hidden while git is
missing (`data-needs-git`), at every level.

### Statistics, Team metrics, Team policy, Chat, Getting started

| Element | Level |
|---|---|
| Statistics page | A |
| Statistics: the Requirements tile (spend, features, a link to the page; behind the `requirements` flag), the Requirements row in the Group by tables and in the Cost report (money already spent there stays listed while the flag is off) | A — with the page |
| Team metrics page and every surface of it elsewhere | E |
| Team policy page and its Policy / Plugins / Catalog tabs | E |
| Team-policy notes on New pipeline; the team caps readout under Budget & cost limits | all — a team cap applies in every mode, so the reason it applies is never hidden |
| The Installed tab's Team policy card and the setup checklist (the Marketplace page) | A — with the page that holds them |
| Ask: chat, history, attachments, run card (its progress bar and stage text), proposal title / project / workflow / brief / Start | S |
| Pinpoint (#669): select text in a chat answer, a Markdown artifact or the Diff tab for Copy · Explain · Alternatives · Disagree · Note / Comment · Quote / Send to chat; the composer's quote chip; an artifact's pending-changes tray (sent back to the run as one direction while it still takes directions); the diff's open-comments tray (Propose fix run) | all — follows the surface it is on |
| Ask: the run card's Pause / Resume / Stop, its answer receipt, its result (verdict, changes, top changed files) and the composer's "→ run" direction chip | S — the run card's controls, as on the Running card |
| Ask: the run card's question (clarify, form, cycle gate, recovery, Auto proposal) | all (rule 1) — its own controls keep the run page's levels (Auto proposal Revise A, tunables E) |
| Ask: Chat home default pin "Shaper" (gated; help line, Beta badge; can be unpinned, see [Chat home](chat-home.md)) | S |
| Ask: run card, perspective chips and the Shaper nudge (open decisions, Run as is / Shaper with estimates) | S |
| Ask: Shaper proposal card — title + label, clamped brief, Project, Base branch, Perspectives, What happens, Advanced (collapsed; its fields keep their own levels), Start planning / Not now / Open in New run | S |
| Ask: the run card's question, "Use defaults" / "Answer" (shaping runs) | all (rule 1) |
| Ask: live run card, "Clarify ✓ · Plan ✓ · Refine ✓ while planning", plan file, saved path + Open | S |
| Ask: live run card, the feature strip of a sliced plan: progress, each slice's state and PR, Review plan / Answer / Open / Resume slice / Re-plan the rest / Cancel the rest / Open the re-plan, "Approve each slice's plan" | S |
| Ask: run card result, the checklist tally ("Checklist: 3 met · 1 unmet · 1 n/a") on a finished shaped run | S |
| Ask: the run card's agent model label, its artifact chips and "All artifacts", Create PR / View PR | A — as on the run page |
| Ask: a run without a project's file list on its run card (Artifacts · n; each file's name, size and Download; "All artifacts") | S — its Artifacts tab is Simple too |
| Ask: the pull-request card's Watch PR state, as its PR link tooltip (read-only; the switch stays on the run page) | all |
| Ask: the run card's stopped-watch line (`Watch stopped · …`, View PR, Ask for changes) | all (rule 1) |
| Ask: the Ask for changes field on finished run, feature, Ship and pull-request cards | all (rule 1) |
| Ask: the Changes card (`Changes to …`, Start round 2 / Add to Run 3's plan / Add Run 4 / Start Run 4, Not now) | all (rule 1) |
| Ask: the Route card (`Where does this go?`, Add to … / Own run now / Save for later, Not now) | all (rule 1) |
| Ask: a PR fix-run card — what started it, the pull request, the outcome | all |
| Ask: the run card's agent "cycle N" label | E — a loop badge |
| Ask: a proposal's own schedule (the "Schedule" action and its time), schedule-change cards | S — the answer the user asked for |
| Ask: a proposal's tracker task (id, title, link) in place of the brief; the "Auto" workflow option when Ask proposed it | S |
| Ask: "Schedule…" on a plain run proposal | A |
| Ask: a classified failure's human notice (what happened and where the remedy lives) | all — recovery instructions are never hidden (rule 1); Simple gets no Models page navigation, the copy names the mode instead |
| Ask: a classified failure's raw-detail expander ("Details") | E |
| Ask: proposal cards themselves | all (rule 4) |
| Ask: files card (show_files) — image tiles, file rows, viewer | S — an answer is never hidden (rule 4) |
| Ask: the context ring and its popover's window fill and topics | S |
| Ask: the chat scope pill and its menu (No project, projects, workspaces, Add project…) | S |
| Ask: model picker, cost meter, tool rows, branches, guardrails, "Open in New run" | A |
| Ask: the project switch card ("Your turn: pick a project") and the "Switched to …" divider | all (rule 4) |
| Ask: the chevron on a reply's activity line (`Done · 7.4s · …`) | A when it opens tool rows, E when it opens only sub-agents; the line itself shows at every level |
| Ask: per-agent lane, the context popover's Agents and Worktrees sections, sub-agent logs | E — a run card carrying Chat's per-agent picks shows its lane at every mode (the picks apply at Start) |
| Chat home: heading, composer, the New run / Build workflow / Track a run / Write a script tiles, the Add project tile, the one pinned-workflow slot (and More › Pinned), More (Step away), the tabs (Needs you, Running, Recent chats, Plans while Shaper is on, Workflows) and their run tiles, the Workflows and Away mode promos | S |
| Chat home: the Plans tab (Shaper, gated): shaped plans newest first with their state, and each sliced feature's card | S |
| Chat home: the Schedule a run and Explain a diff tiles; More › New workspace, Remember something, Find tasks; the Schedules promo | A — with the page or surface that owns each feature |
| Chat home: More › Team metrics, Add a model | E — with the Team metrics and Models pages |
| Getting started: all nine tiles show at every level, ordered Simple → Advanced → Expert; steps 6 and 7 wear "Advanced", steps 8 and 9 "Expert" | S |
