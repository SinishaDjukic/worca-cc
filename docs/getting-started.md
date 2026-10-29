# Getting started (in-app onboarding)

The web UI walks a new install through the first nine things to do with Worca:
a one-time **welcome** dialog, a **Getting started** page (its own view, reached
from the sidebar pill under *New pipeline* or from Settings) holding the
checklist, and **spotlight guides** that ring the real control for each step. Every
tick is derived from product state, never stored. A guide is an ordered walk of
real controls: most hops advance when the user performs the real action; a hop
that only explains something (the Workflows canvas, its chat), or whose
state is already right, carries a **Next** button instead. Every start is a fresh
walk from the first hop, so a replayed guide explains every stop again.

## The nine steps

| # | Tile | Done when (derived) | Guide (each row is a hop; the first that applies is lit) |
|---|---|---|---|
| 1 | Connect Claude Code | the configured `claude` binary resolves on the server's `PATH` (`WORCA_CLAUDE_BIN` honoured; the Windows npm-shim case uses preflight's probe) and `claude auth status` does not report it signed out (preflight `probeClaudeAuth`: remembered 60 s; mock mode and auth env vars skip it; an unknown answer never un-ticks) | a dialog with the install command, the `/login` step, and **Check again** (a fresh sign-in check) |
| 2 | Add your first project | one project is registered | sidebar › **Projects** → **Add project** (the dialog opens on **New**) → the **name** → **Create project** → the new row (Done); to register a folder you already have, the **Folder** tab: the **path** (**Choose folder…**) → the **name** → **Add project** |
| 3 | Watch a run end to end | any pipeline reached `done` | (no project: the Add project walk of 2, then on) → sidebar › **New pipeline** → project select (none while New run's **Target** is **No project**) → prompt → **Mock mode** → **Start run** → sidebar › **Runs** (skipped when the app already routed there) → the run's **page** (Done) |
| 4 | Ask about a run in Chat | one Ask thread exists | sidebar › **Chat** → the input box (suggests a question) → **Send** → the transcript, where the answer lands (Done) |
| 5 | Run a real pipeline | any pipeline with spend above zero | as 3, but after the project: the **Workflow** picker ("choose a built-in workflow"; Auto is the one state it asks to change), then prompt → Mock (only ringed when it is on) → **Start run** → Runs → the run's page (Done) |
| 6 | Explore the built-in workflows | a project has a persisted picker choice (`project_config.active_workflow_id`, Auto included) | sidebar › **Workflows** → the **Library** toggle (only when the Library is closed) → the selector's **Workflows** tab → the folder holding **Default**, expanded in place (its domain, when Workflows has more than one; while a search is open, the header's close button first, which closes the search) → the **Default** row (opens it on the canvas) → the **canvas** (the cards and the wires; Next) → the **chat** (what it can change; Next) → **Back** (leaves the editor) → the top bar's **New run** → the project select (the pick is saved per project; none while New run's **Target** is **No project**, so the tile waits for a pick on a project) → the **Workflow** picker (the user's own pick, a `change`, never the value a project loads) → prompt → **Start run** (Mock is mentioned, not rung) → Running → the run's card (Done) |
| 7 | Group projects into a workspace | one workspace exists | (fewer than two projects: the Add project walk) → sidebar › **Workspaces** → **Create workspace** → in the wizard: **name** → two to 40 **projects** (a note warns past 10, a stronger one past 20) → (the **Models** column: scan agent and project agents, default Sonnet · medium) → **Scan interconnections** — the scan runs as a pipeline you can follow under **Runs**; the workspace appears when it finishes, its relations on the **Map** tab |
| 8 | Turn on team metrics | any project or workspace records (`listScopes().anyEnabled`) | (no project: the Add project walk) → sidebar › **Projects** → a project row → its **Team** tab → **Set up metrics…** → the dialog's **Create and enable** (a project with no origin remote gets its Team metrics block ringed with the reason and Done instead; one already on gets its block explained, with Done) |
| 9 | Set a team policy | any project or workspace resolves a policy (`listPolicyScopes().anyEnabled`: its own home, or one it follows) | (no project: the Add project walk) → sidebar › **Projects** → a project row → its **Team** tab → **Set up policy…** → the dialog's **Create and enable** → the new home's Team policy page, on **Edit policy** (Done). A project pointed at another home stays on its page: its Team policy block is ringed with what happened (Done). No origin remote, or already on: the block ringed with the reason (Done) |

On a machine without git the Add project dialog has no **Clone from URL** tab and no **Use git** switch, runs (steps 3 and 5, and the last hop of step 6) work on a copy of the folder, applied back with **Apply to folder**, the workspace of step 7 is made from registered projects and its runs work on a copy of each member, and the setup dialogs of steps 8 and 9 work for a team repository on github.com (a folder asks for it once: **GitHub repository**) and show `Needs git` for one on another host.

A Folder project can become a Git project later. Use **Use git** on its row's No git box or on its page header, optionally with a remote URL. The folder's files stay as they are, and the first run commits them. A Git project without an origin gets **Link remote** on its page header.

Every tour runs to the thing its tile promises, never to the first click of a
multi-step action: a project registered, a run open on its page under Runs, the
answer in the transcript, a workspace saved, team metrics enabled, a policy home
on its own page. A hop that
opens something (a dialog, the wizard, the side panel) is skipped
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

## First start

On a fresh install (the welcome not seen, no project and no run: `fresh` in `GET /api/onboarding`, derived and
never stored), the setup assistant (`docs/setup-assistant.md`) opens before the welcome. **Set up later** closes
it at once and goes straight to the welcome; finishing it ends on the welcome's three doors too. Settings ›
General › Setup assistant › **Run setup** reopens it later with the saved values.

## Surfaces

- **Page** (`#getting-started` view, `#getting-started-host`, painted by
  `ui/public/getting-started.mjs` on every entry): a card of nine equal tiles
  that wrap 3 → 1 (a 3×3 square, then one column: two columns would orphan the
  ninth), a `n of 9` progress mark and **Hide from sidebar**.
  Tiles reveal one at a time when the page opens; a done tile arrives already
  drawn and still, its mark filled with ink, its label struck. Done tiles stay
  clickable so any guide can be replayed. The page itself is always available
  (Hide only removes the pill; Settings › General › Getting started reopens it).
- **Sidebar pill** under *New pipeline* (mounted by app.js, not shipped in the
  shell): `Getting started · 3/9`, in the guide's violet with a pulsing halo
  (still under reduced motion); it routes to the page and reads as the current
  view while it is open. Gone once the checklist is hidden or complete.
- **Welcome** (`#welcome-modal`): shown once, on the first visit to New
  pipeline, with three doors (add a project / watch a mock run / run a real
  pipeline) and Skip. An install that has already done everything never sees
  it (it is marked seen silently).
- **Settings › General › Getting started**: **Show again** undoes Hide and
  opens the page (**Open checklist** when nothing is hidden). Only the
  checklist returns; the welcome stays seen.
- **Settings › General › About** shows the Worca version you are running and whether it is the
  latest stable release: **Latest**, or **Update available: X.Y.Z** with links to that release's
  **What's new** page and the GitHub **Changes since** comparison. **Release notes** always links to
  [docs.worca.dev/changelog](https://docs.worca.dev/changelog/). When an update is available, a small
  **Update available** marker also appears at the bottom of the sidebar; it opens the About card.
  Worca only looks (at most every 12 hours, at the npm registry's `latest` tag for `@worca/app`, and
  again when an open tab regains focus). **Update to X.Y.Z** installs the latest stable and restarts
  Worca. Running runs pause and continue after the restart (when auto-resume is on), and the page
  reconnects by itself. **Choose version…** picks a release candidate or rolls back (older versions
  sit behind **Show older versions**; a version older than 1.14.0 installs and then has to be started
  by hand with `worca ui`, plus `--port <n>` off the default port). The update only works when Worca
  was started with `worca ui` from an `npm install -g` install whose global folder you can write to.
  Otherwise the card shows why and the command to run
  (`npm install -g @worca/app@<v> && worca ui restart`). On a shared or hosted install the buttons
  are off: whoever runs that Worca updates it. A failed install starts the previous version again and
  shows npm's reason on the card. Nothing updates automatically. Run from a git checkout instead of
  an npm install, the card says **Source build** (update with `git pull`, then `worca ui restart`)
  and npm is never asked. Turn
  **Check for new Worca versions** off in the same card to stop the check (turning it back on checks
  afresh); offline, the card simply shows no status. Behind the Docker egress overlay the check
  needs `registry.npmjs.org`, which the default allowlist already includes.
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
  Runs list re-sorting its rows) can carry the control out of view again:
  the guide brings it back, throttled, until the user scrolls themselves. A
  control that is repainted under the ring is re-acquired for about a second
  before the guide gives up; a control that never appears ends the guide quietly.
  The elevation forces `position:relative` only on a static control; an
  absolutely positioned target (a Workflows floating bar's control) keeps its
  own position. The elevation is a z-index, so it cannot escape a stacking
  context: the Projects and Workspaces slide screens rest on `transform:none`
  (a resting `translateX(0)` would trap every control on them under the scrim),
  a target inside the project page's sticky tab bar names it in `lift`, and the
  Workflows hops name the stage (`.wfv-stage`), its floating bars (`.wfv-float`)
  and the Library (`.wfl`, an overlay at ≤ 760 px) the same way.
- **Interface mode** (docs/ui-levels.md): a step whose controls live above the
  current mode asks once, before the tour moves anywhere (*Switch to Advanced?*);
  confirming switches and starts the tour. Should the mode drop while a tour
  runs, the hop becomes the account corner, then the menu's **Interface mode**
  row, then the right mode in its side menu (pointer mode); choosing it carries
  the tour on. A switch the server refuses (a failed save) puts the mode back
  and says why in a toast, and the hop stays on the side menu. With the
  Interface mode dialog open (Settings › General › **Change…**), the hop rings
  its card instead, then **Done**.

Layering: the spotlight sits below every
`.viewer-modal` (z 50), so a dialog the target opens simply covers it. Targets
inside a stacking context the class cannot escape (the Workflows stage) are lifted with
their ancestor (`lift`). `pointer` mode (no scrim, above the modal layer) exists
for targets inside an open dialog.

## API and storage

- `GET /api/onboarding[?recheck=1]` → `{ steps, done, total, claude: { bin, hint, auth }, hidden, welcomeSeen }` (`auth`: `signed-in` | `signed-out` | `unknown` | `null` when the binary is missing; `recheck` skips the remembered sign-in answer)
  (`src/core/onboarding.mjs`). Computed on every call from the store and the
  PATH; team metrics and team policy read the cached scope status only (no
  discovery).
- `POST /api/onboarding` `{ hidden?, welcomeSeen? }` — booleans only, unknown
  keys 400 — writes the two flags to `settings.json` (`onboarding: {...}`,
  dropped when both are false) and broadcasts `onboarding-changed`.
- The client refetches on `pipelines-changed`, `projects-changed`,
  `workspaces-changed`, `team-metrics-changed`, `team-policy-changed`,
  `onboarding-changed`, on a run
  finishing, on an Ask turn ending and on a Workflows save (coalesced, 250 ms).

## Tests

`test/onboarding-status.test.mjs` (probes), `test/api-onboarding.test.mjs`
(routes), `test/ui-getting-started.test.mjs` (shelf, pill, welcome bindings),
`test/ui-guide-spot.test.mjs` (attach, exits, re-acquire, fallbacks) and
`test/ui-onboarding-shell.test.mjs` (shell markup, boot wiring, Hide / Show
again, guides across views).
