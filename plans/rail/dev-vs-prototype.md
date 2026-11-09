# Dev vs the prototype: every function, and where Stillhet takes it

What dev does today, by area, against the Rail prototype (`plans/rail/prototype/`), so no function is lost while
Stillhet (the `rail` flag) replaces today's pages slice by slice. The owner reviews this list before slice 2; a function
the owner drops is marked `owner dropped` with their words.

A function is a user action: a route in `VIEW_NAMES` (`ui/public/app.js`), a route family under `ui/routes/`, a Settings
tab or row, a + or ⋯ menu entry, a keyboard shortcut, or a `worca` CLI command. `test/rail-docs.test.mjs` fails when a
`VIEW_NAMES` route or a `ui/routes/` family has no row here.

Seeded from `plans/rail/dev-alignment.md` (its decision numbers are cited as DA-1 … DA-15). The prototype's places are
`shell/shell.js` `TITLES` (Chat, Tasks, Schedules, Statistics, Team metrics, Workflows, Requirements, Projects,
Workspaces, Marketplace, Insights) and the captures in `today/pages.json`.

**Status:** `kept` the prototype has it and its slice carries it over; `built` in the app behind `rail`; `verified` built
and checked by its page gates in the app; `owner dropped` the owner said to drop it; `open` the prototype lacks it, or
it is not decided yet. **Slice:** s1 the opt-in and colours, s2 data source and shell, s3 Chat first, s4 Tasks and
Schedules, s5 the other centers, s6 onboarding and the boss round, s7 cleanup.

## Shell and navigation

| Function | Where in dev | In prototype | Slice | Status | Notes |
|---|---|---|---|---|---|
| Sidebar: places, counts, live runs | `ui/public/shell/sidebar.html` | the one bar (`shell/shell.js` `PLACES`) | s2 | kept | Rail groups places as Work, Build, Manage, Insight |
| Top bar: page title, search, New run, Activity | `ui/public/shell/main-column.html` | the one bar, InView | s2 | kept | New run becomes the composer (Chat first, s3) |
| Account menu: Settings, mode, theme, Keep awake | `ui/public/shell/sidebar.html` | the profile menu | s2 | kept | |
| Search or ask, ⌘K | `ui/public/global-search.mjs` | Search (`side-menu.mjs#search`) | s2 | kept | S7 (click-sweep): "Ask Chat: x" claims it asked |
| Keyboard sheet, `?` | `ui/public/keys-sheet.mjs` | none | s2 | open | A3 (click-sweep): `?` opens nothing on Tasks, Chat, Schedules |
| Moved routes redirect (`plugins`, `guardrails`, `settings/mcp`, `settings/models`, `settings/providers`, `composer`, `agents`, `scripts`, `agent-create`) | `ui/public/app.js` `MOVED_ROUTES` | none | s7 | open | old addresses keep their redirects |
| Not found | `ui/public/app.js` `showView` | `lost` | s2 | kept | |
| Bell count and "the badge and the Runs list disagree" (schedule `sch-s3`) | `ui/public/app.js` | Pulse badge | s2 | open | the sixth sweep failure of the handover; the bell count of slice 2 |
| Toasts over page heads | `ui/public/design-system/components/toast.mjs` | Toast | s2 | open | still-open from the request |
| App update, health, folders | `ui/routes/shell/` | none | s2 | open | server family; the shell's pieces |
| Speech: voice input | `ui/routes/speech/` | none | s3 | open | the composer's mic |
| Terminal pane | `ui/routes/terminal/` | none | s5 | open | |
| Browser extension pairing | `ui/routes/browser-extension/` | none | s5 | open | Settings › General › Browser extension |

## Chat

| Function | Where in dev | In prototype | Slice | Status | Notes |
|---|---|---|---|---|---|
| Chat home and threads (`#chat`) | `ui/public/ask-panel.mjs`, `ui/routes/chat/` | Chat (`chat/`) | s3 | kept | |
| New chat (+, ⌥⌘N) | `ui/public/ask-panel.mjs` | + New chat | s3 | kept | |
| Chats list: show or hide (⌘\\), focus (⌘⇧L), previous or next (⌥↑ ⌥↓) | `ui/public/list-keys.mjs` `chatPageKeyAction` | the chats column | s3 | kept | A7 (click-sweep): hiding the bar has no way back but ⌘\\ |
| Chat row ⋯: Select, Rename…, Pin, Add to group…, Remove from group, Archive, Delete… | `ui/public/chats-list.mjs` `chatRowMenuItems` | row ⋯ | s3 | kept | |
| Chat group ⋯: Rename…, Ungroup, Archive group, Delete group… | `ui/public/chats-list.mjs` | group ⋯ | s3 | kept | |
| Command summaries in chat | `ui/public/chat/` (flag `commandSummaries`) | CommandRow, CommandGroup | s3 | kept | DA-3: a failed group opens itself once |
| Side chat beside a page | `ui/public/ask-panel.mjs` | Ask worca beside a page | s3 | kept | DA-4: fade, never slide |
| "Pinned and recent" head | `ui/public/chats-list.mjs` | the chats column | s3 | open | still-open from the request |
| The Shaper card's count and order | `ui/public/chat/` | TaskProposal at parity | s3 | open | still-open from the request |

## Tasks, runs and their pages

| Function | Where in dev | In prototype | Slice | Status | Notes |
|---|---|---|---|---|---|
| Runs list (`#runs`) | `ui/public/app.js`, `ui/routes/runs/` | Tasks | s4 | kept | DA-1: the View menu becomes a sentence; DA-2: day sections never fold |
| A live run's page (`#running`) | `ui/public/app.js` | `run-page.html`, Tasks | s4 | kept | |
| A saved run's page (`#history`) | `ui/public/app.js`, `ui/routes/history/` | none | s4 | open | the prototype has one run page for live and saved |
| A feature's page (`#feature`) | `ui/public/shape/`, `ui/routes/shape/` | none | s4 | open | Shaper features; Open feature from a row ⋯ |
| A group's page (`#group`) | `ui/public/app.js` | none | s4 | open | DA-11: the kind chip moves into the metadata line |
| Run row ⋯: Select, Stop, Archive, Delete, Add to group…, Remove from group, View PR, Open feature | `ui/public/app.js` `runsRowMenuItems` | row ⋯ | s4 | kept | |
| List keys: J/K, Enter, fold, `.`, S, E, G, ⇧G, Delete, Space, ⇧↑↓, ⌘A, Esc | `ui/public/list-keys.mjs` `listKeyAction` | none | s4 | open | one shared module for Runs and Chats |
| Run control: stop, pause, resume, budget | `ui/routes/runs/` | the bar: Pause, Run after, Stop | s4 | kept | |
| Run artifacts, checkout, folder apply | `ui/routes/runs/` | Artifacts | s4 | kept | |
| Branches, push, pull requests, sync | `ui/routes/history/` | Create PR and stacks | s4 | kept | |
| Run labels on Tasks | `ui/public/app.js` (flag `runLabels`) | labels and cost tags | s4 | open | still-open from the request |
| Expert task pages, click-tested | `ui/public/app.js` | Tasks | s4 | open | still-open from the request |
| Actions (project launchers) | `ui/routes/actions/` | none | s5 | open | |
| Run presets | `ui/routes/run-presets/` | none | s4 | open | Settings › Presets |

## Starting work and schedules

| Function | Where in dev | In prototype | Slice | Status | Notes |
|---|---|---|---|---|---|
| New run form (`#new`) | `ui/public/new-run/`, `ui/routes/new-run/` | none | s3 | open | Chat first: the composer starts anything |
| Getting started (`#getting-started`) | `ui/public/getting-started.mjs` | none | s6 | open | the onboarding redesign |
| Setup assistant | `ui/routes/setup-assistant/` | none | s6 | open | stepped setup |
| Schedules (`#schedules`) | `ui/public/app.js`, `ui/routes/scheduled-runs/` | Schedules | s4 | kept | |
| Schedules' wording and Skip | `ui/public/app.js` | Schedules | s4 | open | R2 (click-sweep) |

## Build

| Function | Where in dev | In prototype | Slice | Status | Notes |
|---|---|---|---|---|---|
| Workflows (`#workflows`): the editor, agents, scripts | `ui/public/workflows/`, `ui/routes/workflows/` | Workflows, WorkflowStory | s5 | kept | |
| Scripts | `ui/routes/scripts/` | Workflows › Library | s5 | kept | |
| Skills | `ui/routes/skills/` | none | s5 | open | |
| One session (flag `sessionGroups`) | `ui/public/workflows/` | none | s5 | open | |
| Requirements (`#requirements`, flag `requirements`) | `ui/public/requirements-view.mjs`, `ui/routes/shape/` | Requirements | s5 | kept | DA-15 |
| Marketplace (`#marketplace`) | `ui/public/marketplace/`, `ui/routes/marketplace/` | Marketplace | s5 | kept | O2 (click-sweep): Plugins misses some entries |
| Connectors (`#connectors`) | `ui/public/app.js`, `ui/routes/mcp-servers/` | none | s5 | open | MCP servers |
| Models (`#models`) | `ui/public/app.js`, `ui/routes/models/` | none | s5 | open | |
| Providers (`#providers`) | `ui/public/app.js`, `ui/routes/models/` | none | s5 | open | usage rings show connected providers only |

## Manage

| Function | Where in dev | In prototype | Slice | Status | Notes |
|---|---|---|---|---|---|
| Projects (`#projects`) | `ui/public/app.js`, `ui/routes/projects/` | Projects | s5 | kept | Projects' re-score: s6 (still-open) |
| Workspaces (`#workspaces`) | `ui/public/app.js`, `ui/routes/workspace-map/` | Workspaces, WorkspaceMap | s5 | kept | |
| New workspace (`#workspace-create`) | `ui/public/app.js` | none | s5 | open | |
| Git event automations (flag `gitAutomations`) | `ui/routes/git-automations/` | none | s5 | open | Settings › Automations |
| Guardrails | `ui/routes/guardrails/` | none | s5 | open | Settings › Guardrails |
| Network proxy | `ui/routes/network-proxy/` | none | s5 | open | Settings › Runs › Network proxy |

## Insight

| Function | Where in dev | In prototype | Slice | Status | Notes |
|---|---|---|---|---|---|
| Statistics (`#stats`) | `ui/public/app.js`, `ui/routes/statistics/` | Statistics, Insights | s5 | kept | Insights' figures (still-open) |
| Team metrics (`#team-metrics`) | `ui/public/app.js`, `ui/routes/team-metrics/` | Team metrics | s5 | kept | |
| Team policy (`#team-policy`) | `ui/public/app.js`, `ui/routes/team-policy/` | none | s5 | open | |

## Settings (`#settings`)

| Function | Where in dev | In prototype | Slice | Status | Notes |
|---|---|---|---|---|---|
| Settings page (`#settings`) and its server routes | `ui/public/settings/settings.html`, `ui/routes/settings/` | `settings/` | s5 | kept | DA rename table; title spacing, "Stays in Pulse only" wording and `#settings/` are still-open (s5) |
| General: Setup assistant, Appearance, Alerts, My credentials, Browser extension, Interface mode, Spawn diagnostics, Getting started, About | `ui/public/settings/settings.html` | General | s5 | kept | renamed: Credentials, Diagnostics |
| Labels & cost tags | `ui/public/settings/settings.html` | Labels | s5 | kept | |
| Presets | `ui/public/settings/settings.html` | none | s5 | open | |
| Runs: Budget & cost limits, Away mode, Smart run naming, Sync before run, Scheduled runs, Wait for the network, Machine load, Network proxy, Actions, Pull requests, Workspaces | `ui/public/settings/settings.html` | Runs | s5 | kept | renamed: Per run, Naming, Sync, Schedules, Offline, Capacity, Network › Proxy, Scans |
| Automations | `ui/public/settings/settings.html` | none | s5 | open | |
| Labs, with the Stillhet switch | `ui/public/flags-view.mjs` | Labs | s1 | built | the one off switch for Stillhet; nav.labs |
| Chat: Chat notifications, Engine & models, Limits & access | `ui/public/settings/settings.html` | Chat | s5 | kept | renamed: Chat › Channels, Chat › Engine, Abilities |
| Guardrails | `ui/public/settings/settings.html` | none | s5 | open | |
| Memory | `ui/public/settings/settings.html` | none | s5 | open | R8 (click-sweep): the Memory row and dialog |
| Notifications and onboarding API | `ui/routes/settings/` | none | s1 | built | `stillhetAsked` is the fourth onboarding pref |
| Labs flags API | `ui/routes/feature-flags/` | none | s1 | built | `rail` is a registry flag |

## The `worca` CLI

The CLI is not a page; Stillhet changes none of it. Each command stays as it is.

| Function | Where in dev | In prototype | Slice | Status | Notes |
|---|---|---|---|---|---|
| Run a task, `ui`, `--install`, `add`, `list`, `remove`, `resume`, `run --preset`, `runs`, `logs`, `sessions`, `stop`, `pause`, `doctor` | `src/cli/worca-cc.mjs` | none | none | kept | |
| `plugin`, `marketplace`, `script`, `config`, `workflow`, `metrics`, `policy`, `memory team`, `schedule`, `models`, `container`, `extension`, `proxy`, `setup`, `broker` | `src/cli/worca-cc.mjs` | none | none | kept | |
| `flags on rail` / `off rail` | `src/cli/worca-cc.mjs` | none | s1 | built | marks the Stillhet question asked (D3) |

## Still open

From the request, each with its slice: the bell count and "the badge and the Runs list disagree" (s2); toasts over page
heads (s2); "Pinned and recent" head (s3); the Shaper card's count and order (s3); run labels on Tasks (s4); Expert task
pages click-test (s4); Insights' figures (s5); Settings title spacing, "Stays in Pulse only" wording and `#settings/` (s5);
Projects' re-score (s6). From `plans/rail/click-sweep.md` round 3: F1, F2, G5, H3, I1, J1, K5, L3, L5, O2, R2, R3, R7,
R8 and the owner's U1 (the stage line's advance animation) are open, each in the slice of its place.

## The handover's checks (`node plans/rail/prototype/gates/worca-sweep.mjs`)

| Check | Verdict | Fix |
|---|---|---|
| one store: Pulse and the bar agree at the start | green | `shell/world.js` exports `needsYou`; `chat/chats-column.js` reads it; the sweep keeps its own oracle |
| answering moves the task everywhere | green | the same |
| accepting a gate moves it everywhere | green | the same |
| pausing moves it everywhere | green | the same |
| a Shaper slice is its own row with its state in the icon | green | asserts the state glyph (`kind-task`, 13 px at size 20) in its ring, per `list.kind-mark` |
| the badge and the Runs list disagree | open → s2 | the bell count of slice 2; not fixed in slice 1 |

## Deviations from the approved outline

- **D13:** the shell and Chat rules stay in the prototype as `plans/rail/prototype/design-system/rail-shell.css` (scoped like
  the parts) until slices 2 and 3; the wave-1 table had moved every rule.
- **D18:** the page gates still run on the prototype; `worca-sweep` and `ds-check` take an optional URL, so slice 2 points
  them at the app once it has a Rail shell.

## Where rail.css went (slice 1)

Cut along the block comments of the prototype's `rail.css` (1,944 lines; today's line numbers):

| Lines | Part |
|---|---|
| 1–208 (but 6), 311–375, 1308–1316, 1335–1352, 1417–1489 | `ui/public/runs/rail-run-card.css` |
| 209–310, 376–441, 475–489, 545–632, 746–781, 1080–1099 | `ui/public/runs/rail-run-tabs.css` |
| 502–544, 633–735 (but 727–728) | `ui/public/runs/rail-create-pr.css` |
| 490–501, 782–847, 939–960, 965–991, 996–1000, 1100–1112, 1279–1307, 1894–1931 | `ui/public/design-system/rail-controls.css` |
| 848–912, 1001–1034, 1048–1079, 1113–1143, 1331–1334, 1932–1944 | `ui/public/design-system/rail-rows.css` |
| 442–474, 727–728, 736–745, 961–964, 992–995, 1391–1416 | `ui/public/design-system/rail-feedback.css` |
| 6, 913–938, 1035–1047, 1144–1278, 1317–1330, 1353–1390, 1490–1893 | `plans/rail/prototype/design-system/rail-shell.css` |

`rail-look.css` moved to `ui/public/design-system/rail-look.css` without `--sans`, and without its body type smoothing and
its scrollbar rules, which went to `rail-shell.css` with the artboard's `html,body` sizing (line 6): the shell runs the
library's scrollbars (`watchScrollbars`), and the app does not until slice 2, so today's pages keep their type, their
scrollbars and their page sizing with `rail` on. Lines 727–728 (the strip's error title) left their block for
`rail-feedback.css`, because the question needs them while `rail` is off.

With `rail` on, today's pages change colour only. 59 scoped rules set more than colour on classes or ids that today's
pages draw too, for example `.menu`'s `max-width`, `.rc`, the `tp-`, `pd-`, `sk-`, `fc-` and `plan-` families,
`.menu-h`, `.is-flash` and `#route-chat`. They moved to the end of `rail-shell.css`, each under the part it came from,
and come back with the slice that draws them. `test/rail-parts-scope.test.mjs` fails a part rule that sets a non-colour
property and names no library-only class (the CDP proof's own split between colour and non-colour properties).

## Slice log

- **s1 (this slice):** the `rail` flag and its Labs row; the one-time Stillhet question (`ui/public/stillhet.mjs`) and
  `onboarding.stillhetAsked`; `data-rail` at first paint and live; OutLink and the form strip's failure in the library;
  Rail's CSS as seven scoped app parts; `rail-retires.json` and its freeze; the chat-home boot test on the injected clock;
  the four "agree" checks and the Shaper-row check green. `tools/verify-flags-cdp.mjs --stillhet` against `origin/dev`
  (`0e006ee4d`) exits 0: pass A (flag off, 24 checks), pass B (flag on, non-colour, 8 checks), pass C (the question, 16
  checks). The prototype's `index.html` nav now draws as `pulse.html`'s does, a side effect of the
  shared shell CSS.
