# The gate

| Rule | What | Why | Held by |
|---|---|---|---|
| `gate.pages` | Every Rail page passes its sweeps in every case, at its widths, in both themes | A page is checked by running it | worca-sweep |
| `gate.controls` | Every control acts, or is disabled and says why | No dead controls | click-check |
| `gate.new-code` | New UI code that skips the library fails npm test; old pages shrink by a ratchet | The design system has force | rail-gate |
| `gate.docs` | Docs, catalog, library and gallery agree; every public export is a component, logic, an element found by need, or internal | One source, no drift | rail-docs |
| `gate.colour` | Nothing wears a colour Rail does not have (no blue, no gold: running is ink); readable text holds 4.5:1 (3:1 large); every state's ring holds 3:1, in both themes | Colour means state, and everyone can read it | colour-check |
| `gate.prototype` | Every change to today's UI is reflected in the Stillhet prototype, or the PR adds a `wire to` row under `## Dev surfaces` in `plans/rail/stillhet-wiring.md` that says why, or carries the `no-ui-change` label and a "No UI change:" line; every Settings key and every path today's UI fetches has a row or sits in the frozen baseline (`stillhet-surfaces`, in `npm test`) | One design system: nothing reaches today's UI that the prototype does not know about | prototype-pr-check |
| `gate.real-data` | Every Stillhet change is walked end to end in a real browser on four instances (classic and Stillhet, each on a copy of real data and on an empty install) against the prototype, by `plans/rail/test-protocol.md`: classic leads on what a place does and shows, the prototype on how it looks; the items the change touches and every item that passed before stay OK, classic included; no live control shows demo data, a would-answer or a local-only success; idle CPU and a live update stay within budget | Demo data hides what real data breaks; classic stays intact | by hand |
| `gate.coverage` | Every control classic Worca offers (`plans/rail/coverage/classic-controls.json`) is wired in Stillhet from its own place, planned (a findings row or a PLAN batch names its route), not offered by a decision (a `stillhet-wiring.md` row), or MISSING; MISSING is a frozen baseline that only shrinks, each control in it naming an open COV finding | Nothing classic does is lost on the way to Stillhet | stillhet-coverage |
| `gate.no-demo` | On a live Stillhet no control shows demo data, a would-answer or a local-only success; every demo-answer site in `ui/public/stillhet/` and every `wire to` row is classified (wired, refused with a reason, not in Stillhet yet, prototype-only), and the offenders can only shrink | A page starts from the demo model, so whatever is not wired looks real | stillhet-no-demo-on-live |

`gate.prototype` counts all of `ui/public/` except `stillhet/` and `design-system/` as today's UI. That is wider than
`rail-gate`'s skip list on purpose: `style.css`, `assets/`, `vendor/` and `browser-extension/` are not page code for the
library ratchet, but a change to them is still something the user sees.

## The checks

The one table: each check, its command, when it runs and the widths it owes. From `plans/rail/prototype/gates/`, shown as `G/`.

| Check | Command | When | Widths |
|---|---|---|---|
| Library tests | `node --test test/design-system-components.test.mjs test/design-system-logic.test.mjs` | Every change to the library; in `npm test` | none |
| `rail-gate` | `node --test test/rail-gate.test.mjs` | Every change to UI code; in `npm test` | none |
| `rail-docs` | `node --test test/rail-docs.test.mjs` | Every change to a rule, the catalog or the library; in `npm test` | none |
| Run page's model | `node --test test/run-page-model.test.mjs` | A change to the run page's cases; in `npm test` | none |
| `rail-default` | `node --test test/rail-default.test.mjs` | A change to a pattern, `featureKinds` or `build.md`; in `npm test` | none |
| `rail-look-options` | `node --test test/rail-look-options.test.mjs` | Every change to the library; in `npm test` | none |
| `settings-sentences` | `node G/settings-sentences.mjs` | A change to Settings' model | none |
| Real-data browser test (`gate.real-data`) | browser agents walk `plans/rail/test-protocol.md` on four instances (classic and Stillhet; a copy of real data and an empty install, each with its own `HOME`) against the prototype | Before every Stillhet PR or fix batch merges; the touched items plus every item that passed before | 1280, 390 |
| `ds-check`, with `align-check` | `node G/ds-check.mjs` | A change to a Rail page, inside its run | 900, 400 |
| `handover-check` | `node G/handover-check.mjs` | A change to anything that sends to Chat | 1280 |
| `colour-check` | `node G/colour-check.mjs` (`--list` to see all) | A change to a colour, a token or a page's text | 1280, light and dark |
| `worca-sweep` | `node G/worca-sweep.mjs` | A change to the shell or to what joins pages | 1280, 900, 760, 375 |
| `run-page-sweep` | `node G/run-page-sweep.mjs file://$PWD/plans/rail/prototype/run-page.html` | A change to the run or group page | 900, 375 |
| `pulse-sweep` | `node G/pulse-sweep.mjs file://$PWD/plans/rail/prototype/pulse.html` | A change to Pulse or Settings | 900, 375 |
| `click-check` | `node G/click-check.mjs --small` inside a run; without `--small` once per page | A change to a control | 1280, and 375 without `--small` |
| The sweeps a change needs | `npm run stillhet:sweeps` (`-- --base REF` adds the commits since it; `--all`; `--list` names them without running) | Every change to a prototype page, instead of picking the four sweeps above by hand: it runs the ones this table's "When" names for the changed files, and all four for a file every page shares | theirs |
| Prototype-vs-app comparison | Built in slice 2 by `npm run stillhet:compare`, every route, no list: the places, the states and every deep route the prototype's data names (each task case, chat, schedule, Settings section and place item; one pair of each kind stays in `out/stillhet-compare/`, the rest in the git-ignored `deep/`); the parts first: `npm run stillhet:compare -- --parts invitation,design-switch` | Once per slice, after it is built; never inside a fix round | 1280 both themes, 360 light |
| Stillhet wiring rows | `npm run stillhet:wiring` (`--list` for every id); also `test/stillhet-wiring.test.mjs` | A change to an action or a model file of `ui/public/stillhet/` (the test also runs in `npm test`) | none |
| `stillhet-surfaces` | `node --test test/stillhet-surfaces.test.mjs` (`npm run stillhet:surfaces`; after adding rows, `-- --update` lowers the baseline) | Every change to a Settings key or to a fetch in today's UI; in `npm test` | none |
| `stillhet-coverage` (`gate.coverage`) | `node --test test/stillhet-coverage.test.mjs`; the inventory: `node tools/classic-inventory.mjs` (static scan, joins the last walk; `--walk URL` walks a classic instance first, read-only; `--show TEXT` prints a control's status; `--update` lowers the baseline) | Every change to today's UI, to `ui/public/stillhet/`, or to a wiring, findings or PLAN row; in `npm test`. The walk by hand when classic changes its pages | none |
| `stillhet-no-demo-on-live` (`gate.no-demo`) | `node --test test/stillhet-no-demo-on-live.test.mjs` (`node tools/stillhet-no-demo.mjs --list`; `--update` lowers the baseline) | Every change to `ui/public/stillhet/` or to a `wire to` row; in `npm test` | none |
| `stillhet-perf-budgets` | `node tools/test.mjs test/stillhet-perf-budgets.test.mjs test/stillhet-perf-budgets-chat-host.test.mjs test/stillhet-perf-budgets-tasks-host.test.mjs`. Budgets in `test/fixtures/stillhet-perf-budgets.json` only go down: a lower measurement fails until the JSON is lowered, a higher one fails; the exclusion list only shrinks (D19) | Every change to `ui/public/stillhet/` or a design-system component it draws; in `npm test` | none |
| `prototype-pr-check` | `node tools/prototype-pr-check.mjs --base origin/dev` | Every PR, in CI's `prototype` job; after adding the label or the body line, re-run the `prototype` job. Advisory until a maintainer makes it a required check in GitHub's settings | none |
| Flag-off style diff | `npm run stillhet:style-diff -- --dev DEV_BASE` (the dev commit merged in first, one seed, a frozen clock) | Once per slice | 1280 both themes, 360 light |
| Feature fidelity audit | No command: a live walk on the seeds (`tools/stillhet-seed-tasks.mjs`, `tools/stillhet-seed-chat-cards.mjs`) beside the prototype, scored per area in `plans/rail/audit-feature-1.md`; its shape is held by `test/stillhet-audit-report.test.mjs` | Once at the end of a feature, before it goes to dev | 1280 both themes, 360 light |
| The audit by looking | No command: open every control and judge the page as a person would | Once per page, after it is built, before review | wide, narrow |
| A person's review | The step a gate cannot do: nothing pushes or merges without it | After the audit by looking | wide, narrow |

**Speed.** `ds-check`, `worca-sweep`, `run-page-sweep` and `pulse-sweep` run their units (a theme and a width, a page) side by
side, each in its own browser context, and print the report a single walk prints (`G/pool.mjs`). From disk that is the CPU
count less one, at most 8; against the app (`STILLHET_TARGET`) one at a time, since the app is shared. `--workers N` sets it.
`click-check` splits its walk across worker processes with the same flag (`tools/stillhet-gates.mjs`).
From disk `worca-sweep` waits for a route to be drawn (its hashchange handled, a frame painted), not a fixed time, and a
journey step that already holds does not wait; against the app the fixed waits stay, as its data comes over the network.

`npm test` holds the library tests, `rail-gate`, `rail-docs`, the run page's model, `rail-default` and `rail-look-options` (the first six), the wiring test, `stillhet-surfaces`, the performance budgets, `stillhet-no-demo-on-live` and `stillhet-coverage`. A sweep runs in both themes: no sideways scroll, no clipped text without a tooltip,
no overlaps, every section on the text edge, contrast 4.5:1, every menu and dialog inside the window, no page jump on any
click, the top bar one row, one way back at a time (`‹ Settings` only while the side menu is hidden); and every control does
something. `ds-check`: everything on the page comes from the design system. `align-check`, on a settings tab: one left edge
for every head, name and divider, one right edge where every row's end stops (a quiet button by its text), and each row's
name, sentence and end on one baseline. The alignment is SettingsRow's and SettingsSection's, never a page's;
`align-proof.mjs` shows the check catches each fault. These run on the prototype, and on the app from slice 2 (`plans/rail/implementation-prompt.md`).

**Mode.** A comparison names its mode, set on the prototype's own `file://` origin with `worca-rail.mode`. Expert is the default; Simple and Advanced only when a change touches what that mode shows. Modes run one after another, never in parallel.

## Classic coverage

`gate.coverage` keeps a list of every classic control and where it stands in Stillhet (`tools/classic-inventory.mjs`).
- **The inventory** combines a static scan of today's UI (every button, field, toggle, menu item, tab and dialog, with the
  `/api/…` routes and Settings keys of the code that draws and handles it) and a read-only browser walk of a classic
  instance in Expert mode (every page and Settings tab, each menu and dialog opened and closed with Escape; every request
  but GET is aborted, and the walk never changes the mode). The walk adds what it sees only when the code has its label;
  what it keeps is free of real data (addresses read `KEY` and `ID`).
- **The status** of a control is its worst route or key: wired when Stillhet's code calls it from the control's own place
  (its page's Stillhet folder, or a `wired` row that names a file there; the same route called from another place clears
  nothing), planned when a `wire to` row, `PLAN.md`, `FINDINGS.md` or an Open findings row names it, not offered when a `not offered
  live` or `not a dev capability` row does, else MISSING. A control with no route and no key takes its page's place.
  A row under `## Classic controls` in `plans/rail/stillhet-wiring.md` (the control's id, a status, why) decides one control.
- **The baseline** (`test/fixtures/stillhet-coverage-baseline.json`) maps each MISSING control to its COV finding; a new
  MISSING control fails `npm test` until it is wired, planned or decided, or given a finding; a covered one fails until
  `--update` lowers the baseline. `plans/rail/coverage/COVERAGE.md` is the readable report, regenerated with the inventory.

## New code

`npm test` holds the design system like the feature flag tests hold flags (`test/rail-gate.test.mjs`, `tools/rail-gate.mjs`):
- **New UI code that rebuilds what the library owns fails:** a component's markup, an inline icon, a state's word, a
  failure's sentence. Call the library instead.
- **Old pages are frozen.** `test/fixtures/rail-gate-baseline.json` holds each old file's count. It can only shrink: a
  file that grows fails; a file that shrinks lowers its count in the same change, with `node tools/rail-gate.mjs --update`,
  which refuses a higher one.
- **The docs, catalog, library and gallery agree** (`test/rail-docs.test.mjs`).
- **The Worca Rail page is generated** from these files, the catalog and the library by `node tools/rail-artifact.mjs`, and
  never edited by hand. Git is the source; nothing is copied.
