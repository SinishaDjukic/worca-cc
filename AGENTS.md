# Worca

Read `CONTRIBUTING.md` for setup, tests and the PR workflow.

## Any UI work starts at the design system

Before you build or change a page, read [docs/rail/README.md](docs/rail/README.md). It leads; a page only composes it.
**Building Rail now:** start at [plans/rail/wave-1.md](plans/rail/wave-1.md).

- **Components and shared logic:** `ui/public/design-system/components/` (`index.mjs` exports them all). Call them; never
  write their markup or their words. `docs/design-system-catalog.json` says which one meets which need.
- **The working design:** `plans/rail/prototype/`, with the run card as the model. A plan points to it and never restates
  it; a real conflict is a question for a person.
- **What a page needs and the design system lacks** is added first: the rule in `docs/rail/`, the catalog entry, the
  component, its test, its gallery example.
- **The gate:** `npm test` fails new UI code that skips the library (`test/rail-gate.test.mjs`); old pages are frozen by a
  ratchet that can only shrink. Don't raise the baseline; use the library. The page checks are not in `npm test`: each
  check, its command and when it runs are in [docs/rail/gate.md](docs/rail/gate.md).

Today's pages keep `docs/design-system.md` until they move to Rail. Feature flags: `docs/feature-flags.md`. Interface
modes: `docs/ui-levels.md`.
