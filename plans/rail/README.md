# Worca Rail

The redesign of Worca, one page at a time. The rules every Rail page follows live in `docs/design-system.md`
› Worca Rail (the single source); this folder holds each page's spec, its review and the prototype.

| Page | Spec | Status |
|---|---|---|
| Run and group page | `spec.md` (review `review.md`, shipping plan `enrollment.md`) | In the prototype |

- `prototype/`: the clickable prototype, every page in one place (`index.html`; the run page is `run-page-model.js`
  and `run-page.js`, the shared styles `rail.css`). The gate: `node plans/rail/prototype/sweep.mjs file://$PWD/plans/rail/prototype/index.html`.
- `mocks/`: PNG mocks of decisions, named by page.

A new page gets a spec here, a row above, and its model and renderer in `prototype/`, built on `rail.css` and the
shared components; a rule that holds beyond one page goes to `docs/design-system.md` › Worca Rail.
