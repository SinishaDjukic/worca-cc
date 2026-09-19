# Getting started (in-app onboarding)

The web UI walks a new install through the first eight things to do with Worca:
a one-time **welcome** dialog, a **Getting started** page (its own view, reached
from the sidebar pill under *New pipeline* or from Settings) holding the
checklist, and **spotlight guides** that ring the real control for each step. Every
tick is derived from product state, never stored. A guide is an ordered walk of
real controls: most hops advance when the user performs the real action; a hop
that only explains something (the Composer canvas, its side panel), or whose
state is already right, carries a **Next** button instead. Every start is a fresh
walk from the first hop, so a replayed guide explains every stop again.

## The eight steps

| # | Tile | Done when (derived) | Guide (each row is a hop; the first that applies is lit) |
|---|---|---|---|
| 1 | Connect Claude Code | the configured `claude` binary resolves on the server's `PATH` (`WORCA_CLAUDE_BIN` honoured; the Windows npm-shim case uses preflight's probe) | a dialog with the install command and **Check again** |
| 2 | Add your first project | one project is registered | sidebar › **Projects** → **Add project** (the native folder chooser opens; it is ringed again if that is cancelled) → in the dialog: the **path** → the **name** → **Add project** → the new row (Done) |
| 3 | Watch a run end to end | any pipeline reached `done` | (no project: the Add project walk of 2, then on) → sidebar › **New pipeline** → project select → prompt → **Mock mode** → **Start run** → sidebar › **Running** (skipped when the app already routed there) → the run's **card** (Done) |
| 4 | Ask Worca about a run | one Ask thread exists | the **Ask Worca** dock pill (skipped while the sheet is open) → the input box (suggests a question) → **Send** → the transcript, where the answer lands (Done) |
| 5 | Run a real pipeline | any pipeline with spend above zero | as 3, but after the project: the **Workflow** picker ("choose a built-in workflow"; Auto is the one state it asks to change), then prompt → Mock (only ringed when it is on) → **Start run** → Running → the run's card (Done) |
| 6 | Explore the built-in workflows | a project has a persisted picker choice (`project_config.active_workflow_id`, Auto included) | sidebar › **Workflow Composer** → the **Default** row in Saved pipelines (opens it on the canvas) → the **canvas** (explains the loop, the cards and the wires; Next) → the side panel's **expand** toggle when it is collapsed → the **side panel** (Agents to drag onto the canvas, Info for the selection; Next) → sidebar › **New pipeline** → the project select (the pick is saved per project) → the **Workflow** picker (the user's own pick, a `change`, never the value a project loads) → prompt → **Start run** (Mock is mentioned, not rung) → Running → the run's card (Done) |
| 7 | Group projects into a workspace | one workspace exists | (fewer than two projects: the Add project walk) → sidebar › **Workspaces** → **Create workspace** → in the wizard: **name** → two or more **projects** → **Scan interconnections** → the scan's status while it runs → **Save workspace** |
| 8 | Turn on team metrics | any project or workspace records (`listScopes().anyEnabled`) | (no project: the Add project walk) → sidebar › **Projects** → **Set up team metrics…** → the dialog's **Create branch and enable** (a project with no origin remote gets its Team metrics cell ringed with the reason and Done instead) |

Every tour runs to the thing its tile promises, never to the first click of a
multi-step action: a project registered, a run on its card under Running, the
answer in the transcript, a workspace saved, team metrics enabled. A hop that
opens something (a dialog, the Ask sheet, the wizard, the side panel) is skipped
while it is open and lit again if it is closed.

Getting to another view is itself a hop: the sidebar entry (or the compact
top-nav twin below 1080px) is ringed and the user's own click routes, so they
learn where things live. A user already on the right view passes that hop on
arrival; leaving the view before the stops that follow it are done re-lights it.

**Passing a hop.** The lit hop is the first the guide has not passed in this run.
A hop that asks for page state (a project picked, a task typed, Mock on, a
workflow on the canvas) passes when that state arrives while it is lit. When the
state was already right when the guide reached it, the hop is still lit, with
copy that says so and a **Next** button, so a replay explains every stop again:
it passes on Next, on the control's own click, or on a change made to the
control (a toggle is the exception: its click would undo the state, so only Next
or the watcher passes it). Explanation-only hops pass on Next alone. Some hops
are skipped rather than acknowledged when already right: an open Ask sheet's
pill, a hidden field, an already-expanded side panel, Mock already off for a real
run. Nothing about passing is stored; the state itself is always re-read from the
page after each interaction, so the guide can never desync. Labels are outcomes,
never settings; the arc runs prerequisite → first object → see the loop → talk to
it → know the workflows → real work → scale.

## Surfaces

- **Page** (`#getting-started` view, `#getting-started-host`, painted by
  `ui/public/getting-started.mjs` on every entry): a card of eight equal tiles
  that wrap 4 → 2 → 1, a `n of 8` progress mark and **Hide from sidebar**.
  Tiles reveal one at a time when the page opens; a done tile arrives already
  drawn and still, its mark filled with ink, its label struck. Done tiles stay
  clickable so any guide can be replayed. The page itself is always available
  (Hide only removes the pill; Settings › General › Getting started reopens it).
- **Sidebar pill** under *New pipeline* (mounted by app.js, not shipped in the
  shell): `Getting started · 3/8`, in the guide's violet with a pulsing halo
  (still under reduced motion); it routes to the page and reads as the current
  view while it is open. Gone once the checklist is hidden or complete.
- **Welcome** (`#welcome-modal`): shown once, on the first visit to New
  pipeline, with three doors (add a project / watch a mock run / run a real
  pipeline) and Skip. An install that has already done everything never sees
  it (it is marked seen silently).
- **Settings › General › Getting started**: **Show again** undoes Hide and
  opens the page (**Open checklist** when nothing is hidden). Only the
  checklist returns; the welcome stays seen.
- **Spotlight** (`ui/public/guide-spot.mjs`): scrim over the page, the one real
  control elevated above it and ringed (violet, pulsing halo, the control's own
  corner radius), one balloon of *why* plus **Skip** — and **Next** (or **Done**
  on a closing stop) on a hop that only explains or whose state is already
  right. Esc and Skip dismiss; a click on the scrim is swallowed and answered
  with one pulse of the ring and the balloon, so a stray click never ends a
  guide. The control's real click advances or ends the guide. A guide's next
  hop is re-derived from the page after every interaction (typing the prompt,
  opening Advanced, flipping Mock, a nav click) and on a slow poll for outcomes
  that land later (a workflow loading onto the canvas), so it can never desync. When a
  guide arrives on a view the page starts at the top and glides down to the
  ringed control, the ring following it per frame (reduced motion jumps). A
  control taller than most of the window (a run card) is brought to its top, and
  when neither edge has room the balloon is pinned inside the viewport over it,
  arrow off, rather than parked off-screen. A view that keeps settling (the
  Running list re-sorting its cards) can carry the control out of view again:
  the guide brings it back, throttled, until the user scrolls themselves. A
  control that is repainted under the ring is re-acquired for about a second
  before the guide gives up; a control that never appears ends the guide quietly.
  The elevation forces `position:relative` only on a static control; an
  absolutely positioned target (the Composer's floating side panel) keeps its
  own position.
- **Interface mode** (docs/ui-levels.md): a step whose controls live above the
  current mode asks once, before the tour moves anywhere (*Switch to Advanced?*);
  confirming switches and starts the tour. Should the mode drop while a tour
  runs, the hop becomes the mode switch itself, then the right card in the
  dialog, then **Done** (pointer mode, above the dialog) so the tour is seen to
  carry on rather than sit dimmed behind it.

Layering: the spotlight sits above the Ask dock (z 40) and below every
`.viewer-modal` (z 50), so a dialog the target opens simply covers it. Targets
inside a stacking context the class cannot escape (the Ask dock) are lifted with
their ancestor (`lift`). `pointer` mode (no scrim, above the modal layer) exists
for targets inside an open dialog.

## API and storage

- `GET /api/onboarding` → `{ steps, done, total, claude: { bin, hint }, hidden, welcomeSeen }`
  (`src/core/onboarding.mjs`). Computed on every call from the store and the
  PATH; team metrics reads the cached scope status only (no discovery).
- `POST /api/onboarding` `{ hidden?, welcomeSeen? }` — booleans only, unknown
  keys 400 — writes the two flags to `settings.json` (`onboarding: {...}`,
  dropped when both are false) and broadcasts `onboarding-changed`.
- The client refetches on `pipelines-changed`, `projects-changed`,
  `workspaces-changed`, `team-metrics-changed`, `onboarding-changed`, on a run
  finishing, on an Ask turn ending and on a Composer save (coalesced, 250 ms).

## Tests

`test/onboarding-status.test.mjs` (probes), `test/api-onboarding.test.mjs`
(routes), `test/ui-getting-started.test.mjs` (shelf, pill, welcome bindings),
`test/ui-guide-spot.test.mjs` (attach, exits, re-acquire, fallbacks) and
`test/ui-onboarding-shell.test.mjs` (shell markup, boot wiring, Hide / Show
again, guides across views).
