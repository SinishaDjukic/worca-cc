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

- `prototype/`: the clickable prototype, laid out like the app's files. The pages at its root (`index.html` the run
  page, `pulse.html` Pulse and Settings, `components.html` the gallery); each feature in its folder: `runs/` (the run
  page's model and renderer), `pulse/` (Pulse's model, renderer and CSS), `settings/` (Settings' content and renderer),
  `design-system/` (the Rail look and the components' CSS); `today/` today's Worca, captured from the app in mock mode by
  `gates/capture-today.mjs` (its shell and the pages outside Wave 1's scope, as they render); `gates/` holds the checks
  and the builds. The pages draw on
  the app's CSS as `app.css`, assembled from `ui/public/parts.json`, and on the components as `components.js`, bundled
  from `ui/public/design-system/components/` (both built by the gates, not committed).
- The gates: `node plans/rail/prototype/gates/run-page-sweep.mjs file://$PWD/plans/rail/prototype/index.html`,
  `node plans/rail/prototype/gates/pulse-sweep.mjs file://$PWD/plans/rail/prototype/pulse.html`, and
  `node plans/rail/prototype/gates/ds-check.mjs` for both pages: everything comes from the design system, names and
  heads follow their rules, every Settings section lines up (`gates/align-check.mjs`; `gates/align-proof.mjs` shows the
  check catches each fault).
- `mocks/`: PNG mocks of decisions, named by page.

A new page gets a spec here, a row above, and its model and renderer in `prototype/`, built on `rail.css` and the
shared components; a rule that holds beyond one page goes to `docs/design-system.md` › Worca Rail.
