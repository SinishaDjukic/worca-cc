# Worca Rail

The redesign of Worca, one page at a time. The rules every Rail page follows live in `docs/rail/`
(the single source); this folder holds each page's spec, its review and the prototype.

The prototype's code here is the source. The **Worca Rail** page is generated from the branch by
`node tools/rail-artifact.mjs` (the rules, the catalog, the library's gallery) and never edited by hand. The old
**Prototype** artifact is retired as a source: never build from it or edit it.

| Page | Spec | Status |
|---|---|---|
| Run and group page | `spec.md` (review `review.md`; `enrollment.md` is the old shipping plan, replaced by `wave-1.md`) | In the prototype |
| Pulse: the notification hub, usage rings, limit notifications and what a start does near a limit | `pulse.md` | Concept, in the prototype (`pulse.html`) |
| Runs list and Chats column: dev's functions adapted to Rail, **for reference only**. Their real design is decided in Wave 2 Shaping | `lists-index.md`, `agreed/chat-and-runs-decisions.md` | In the prototype, as reference |
| Settings: from the profile menu, the sidebar becomes its menu (five groups), one row per decision, records as Lists, search | `docs/rail/settings.md, mocks `mocks/settings-menu-*.png` | In the prototype (`pulse.html` › Settings; `settings/`) |

Wave 2 is being shaped: `wave-2.md`, on `docs/rail-shaping`. Wave 1 (the run and group pages, Pulse, Settings, the shell) is `wave-1.md`; the waves after it, and the design
system's own consistency work between them, are `waves.md`.
Where it all stands, Accepted and Shaping, and the open decisions: `game-plan.md`.

To look at it, `npm run rail` builds the prototype's generated files and opens `prototype/index.html`. What to check by
eye before accepting it: `review-agreed.md`.

- `prototype/`: the clickable prototype, laid out like the app's files.
  - `index.html` is **the one Worca**: today's shell and pages (`today/`, captured from the app in mock mode by
    `gates/capture-today.mjs`) with Wave 1 in them, joined by `shell/` (the router and the decisions on today's
    sidebar and top bar): a run row opens the Rail run page as a full page, Pulse sits in Activity's place, the profile
    menu opens Settings, and every other page keeps today's design in the Rail colours, apart from the Runs list and the
    Chats column, which are there as reference for Wave 2. The prototype's own controls fold
    into its Prototype corner.
  - `run-page.html` and `pulse.html` explore the run page's and Pulse's cases; `components.html` is the gallery.
  - Each feature in its folder: `runs/`, `pulse/`, `settings/`, `design-system/` (the Rail look and the components'
    CSS), `shell/`; `gates/` holds the checks and the builds (`app.css`, `components.js` and `today.js` are built, not
    committed).
- The gates: `docs/rail/gate.md` holds the one table of commands, when they run and their widths.
- `mocks/`: PNG mocks of decisions, named by page.

A new page gets a spec here, a row above, and its model and renderer in `prototype/`, built on `rail.css` and the
shared components; a rule that holds beyond one page goes to `docs/rail/.
