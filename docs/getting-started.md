# Getting started (in-app onboarding)

The web UI walks a new install through the first eight things to do with Worca:
a one-time **welcome** dialog, a **Getting started** page (its own view, reached
from the sidebar pill under *New pipeline* or from Settings) holding the
checklist, and **spotlight guides** that ring the real control for each step. There is no narrated tour and no step counter: every guide advances only
when the user performs the real action, and every tick is derived from product
state, never stored.

## The eight steps

| # | Tile | Done when (derived) | Guide (each row is a hop; the first that applies is lit) |
|---|---|---|---|
| 1 | Connect Claude Code | the configured `claude` binary resolves on the server's `PATH` (`WORCA_CLAUDE_BIN` honoured; the Windows npm-shim case uses preflight's probe) | a dialog with the install command and **Check again** |
| 2 | Add your first project | one project is registered | sidebar › **Projects** → **Add project** |
| 3 | Watch a run end to end | any pipeline reached `done` | (no project: sidebar › Projects → Add project) → sidebar › **New pipeline** → project select → prompt → **Mock mode** → **Start run** → sidebar › **Running** (skipped when the app already routed there) |
| 4 | Ask Worca about a run | one Ask thread exists | the **Ask Worca** dock pill → the input box (suggests a question) → **Send** |
| 5 | Run a real pipeline | any pipeline with spend above zero | as 3, but after the project: the **Workflow** picker while it says Auto ("choose a built-in workflow"), then prompt → Mock off → **Start run** → Running |
| 6 | Explore the built-in workflows | a project has a persisted picker choice (`project_config.active_workflow_id`, Auto included) | sidebar › **Workflow Composer** → the **Default** row in Saved pipelines (opens it on the canvas) → sidebar › **New pipeline** → the **Workflow** picker; a pick ends the guide |
| 7 | Group projects into a workspace | one workspace exists | (fewer than two projects: sidebar › Projects → Add project) → sidebar › **Workspaces** → **Create workspace** |
| 8 | Turn on team metrics | any project or workspace records (`listScopes().anyEnabled`) | (no project: sidebar › Projects → Add project) → sidebar › **Projects** → the first **Set up team metrics…** (a project with no origin remote gets its Team metrics cell ringed with the reason instead) |

Getting to another view is itself a hop: the sidebar entry (or the compact
top-nav twin below 1080px) is ringed and the user's own click routes, so they
learn where things live. A user already on the right view skips that hop. Every
hop is re-derived from the page after each interaction, so the guide can never
desync. Labels are outcomes, never settings; the arc runs prerequisite → first
object → see the loop → talk to it → know the workflows → real work → scale.

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
  corner radius), one balloon of *why* plus **Skip**. Esc, the scrim and Skip
  dismiss; the control's real click advances or ends the guide. A guide's next
  hop is re-derived from the page after every interaction (typing the prompt,
  opening Advanced, flipping Mock, a nav click) and on a slow poll for outcomes
  that land later (a workflow loading onto the canvas), so it can never desync. When a
  guide arrives on a view the page starts at the top and glides down to the
  ringed control, the ring following it per frame (reduced motion jumps). A
  control that is repainted under the ring is re-acquired for about a second
  before the guide gives up; a control that never appears ends the guide quietly.

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
