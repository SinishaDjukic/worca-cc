# Worca Rail

The redesign of Worca, one page at a time. The rules every Rail page follows live in `docs/rail/`
(the single source); this folder holds each page's spec, its review and the prototype.

The prototype's code here is the source. The **Worca Rail** page is generated from the branch by
`node tools/rail-artifact.mjs` (the rules, the catalog, the library's gallery) and never edited by hand. The old
**Prototype** artifact is retired as a source: never build from it or edit it. `prototype/today/` is a capture of the old app: never built from or compared against.

| Page | Spec | Status |
|---|---|---|
| Run and group page | `spec.md` (review `review.md`; `enrollment.md` is the old shipping plan, replaced by `implementation-prompt.md`) | In the prototype |
| Pulse: the notification hub, usage rings, limit notifications and what a start does near a limit | `pulse.md` | Concept, in the prototype (`pulse.html`) |
| Runs list and Chats column: dev's functions adapted to Rail, **for reference only**. Their real design is decided in Wave 2 Shaping | `history/lists-index.md`, `agreed/chat-and-runs-decisions.md` | In the prototype, as reference |
| Settings: from the profile menu, the sidebar becomes its menu (five groups), one row per decision, records as Lists, search | `docs/rail/settings.md, mocks `mocks/settings-menu-*.png` | In the prototype (`pulse.html` › Settings; `settings/`) |

Old wave and game plans are in `history/`: history, superseded by `implementation-prompt.md`, the one plan to build from.

To look at it, `npm run rail` builds the prototype's generated files and opens `prototype/index.html`. What to check by
eye before accepting it: `review-agreed.md`.

- `prototype/`: the clickable prototype, laid out like the app's files.
  - `index.html` is **the one Worca**: today's shell and pages (`today/`, captured from the app in mock mode by
    `gates/capture-today.mjs`) with the Rail pages in them, joined by `shell/` (the router and the decisions on today's
    sidebar and top bar): a run row opens the Rail run page as a full page, Pulse sits in Activity's place, the profile
    menu opens Settings, and the pages not yet drawn stay as the capture shows them; the Runs list and the Chats column are there as reference. The prototype's own controls fold
    into its Prototype corner.
  - `run-page.html` and `pulse.html` explore the run page's and Pulse's cases; `components.html` is the gallery.
  - The page code is shared with the app and lives in `ui/public/stillhet/` (one loader, `boot.js`; each feature in its
    folder: `runs/`, `pulse/`, `settings/`, `shell/`, `css/` for the Rail look and the components' CSS). `index.html` here
    keeps only the Prototype corner and loads that code with `data-host="prototype"`; the app's `shell.html` loads the
    same file with `data-host="app"`. `gates/` holds the checks; `npm run stillhet:build` writes `app.css`, `components.js`,
    `graph.js` and `today.js` into `ui/public/stillhet/` (built, not committed).
- The gates: `docs/rail/gate.md` holds the one table of commands, when they run and their widths.
- `mocks/`: PNG mocks of decisions, named by page.

A new page gets a spec here, a row above, and its model and renderer in `prototype/`, built on `rail.css` and the
shared components; a rule that holds beyond one page goes to `docs/rail/.
