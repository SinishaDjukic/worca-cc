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

- `prototype/`: the clickable prototype, every page in one place (`index.html`; the run page is `run-page-model.js`
  and `run-page.js`, the shared styles `rail.css`). Pulse is `pulse.html`, `pulse-model.js`, `pulse.js` and `pulse.css`. The gates: `node plans/rail/prototype/sweep.mjs file://$PWD/plans/rail/prototype/index.html` and
  `node plans/rail/prototype/pulse-sweep.mjs file://$PWD/plans/rail/prototype/pulse.html`; and for both pages,
  `node plans/rail/prototype/ds-check.mjs`: everything on them comes from the design system. The pages draw on the app's CSS as `prototype/app.css`, assembled from `ui/public/parts.json` by
  `node plans/rail/prototype/app-css.mjs` (the gates run it first; it is not committed).
- `mocks/`: PNG mocks of decisions, named by page.

A new page gets a spec here, a row above, and its model and renderer in `prototype/`, built on `rail.css` and the
shared components; a rule that holds beyond one page goes to `docs/design-system.md` › Worca Rail.
