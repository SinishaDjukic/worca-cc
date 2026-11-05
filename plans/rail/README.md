# Worca Rail

The redesign of Worca, one page at a time. The rules every Rail page follows live in `docs/design-system.md`
› Worca Rail (the single source); this folder holds each page's spec, its review and the prototype.

Online: the [Design System](https://claude.ai/artifact/P38jGMS7jA9XQu2U2uP3HP) (a readable view built from
`docs/design-system.md`, the app's CSS parts in `ui/public/` and the prototype) and the
[Prototype](https://claude.ai/artifact/3S1E6PBSDpnK9R2G7fVhfz).

| Page | Spec | Status |
|---|---|---|
| Run and group page | `spec.md` (review `review.md`, shipping plan `enrollment.md`) | In the prototype |
| Pulse: the notification hub, usage rings, limit notifications and what a start does near a limit | `pulse.md` | Concept, in the prototype (`pulse.html`) |
| Settings: from the profile menu, the sidebar becomes its menu (four groups), one row per decision, records as Lists, search | `docs/design-system.md` › Settings, mocks `mocks/settings-menu-*.png` | In the prototype (`pulse.html` › Settings; `settings/`) |

Wave 1 (the run and group pages, Pulse, Settings, the shell) is `wave-1.md`; the waves after it, and the design
system's own consistency work between them, are `waves.md`.

- `prototype/`: the clickable prototype, laid out like the app's files.
  - `index.html` is **the one Worca**: today's shell and pages (`today/`, captured from the app in mock mode by
    `gates/capture-today.mjs`) with Wave 1 in them, joined by `shell/` (the router and the decisions on today's
    sidebar and top bar): a run row opens the Rail run page as a full page, Pulse sits in Activity's place, the profile
    menu opens Settings, every other page keeps today's design in the Rail colours. The prototype's own controls fold
    into its Prototype corner.
  - `run-page.html` and `pulse.html` explore the run page's and Pulse's cases; `components.html` is the gallery.
  - Each feature in its folder: `runs/`, `pulse/`, `settings/`, `design-system/` (the Rail look and the components'
    CSS), `shell/`; `gates/` holds the checks and the builds (`app.css`, `components.js` and `today.js` are built, not
    committed).
- The gates: `node plans/rail/prototype/gates/worca-sweep.mjs` (the one Worca: every route at three widths in both
  themes, and the journeys between its pieces), `gates/run-page-sweep.mjs file://…/run-page.html`,
  `gates/pulse-sweep.mjs file://…/pulse.html`, and `gates/ds-check.mjs` (everything from the design system; names, heads
  and alignment; `gates/align-proof.mjs` shows the alignment check catches each fault).
- `mocks/`: PNG mocks of decisions, named by page.

A new page gets a spec here, a row above, and its model and renderer in `prototype/`, built on `rail.css` and the
shared components; a rule that holds beyond one page goes to `docs/design-system.md` › Worca Rail.
