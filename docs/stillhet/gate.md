# The gate

| Rule | What | Why | Held by |
|---|---|---|---|
| `gate.pages` | Every Stillhet page passes its sweeps in every case, at its widths, in both themes | A page is checked by running it | worca-sweep |
| `gate.sweep` | A sweep fails a page on: a sideways scroll, clipped text without a tooltip, an overlap, a section off the text edge, contrast under 4.5:1, a menu or dialog outside the window, a page jump on a click, a top bar of two rows, or two ways back at once | The faults a person sees first are checked by a machine first | worca-sweep |
| `gate.controls` | Every control acts, or is disabled and says why | No dead controls | click-check |
| `gate.new-code` | New UI code that rebuilds what the library owns (a component's markup, an inline icon, a state's word, a failure's sentence) fails `npm test`. Old pages are frozen by a baseline that only shrinks (`node tools/stillhet-library-gate.mjs --update` refuses a higher count) | The design system has force | stillhet-library-gate |
| `gate.docs` | Docs, catalog, library and gallery agree: every rule has one home and a check that exists, and every public export is a component, logic, an element found by need, or internal | One source, no drift | stillhet-docs |
| `gate.generated-page` | The Stillhet design-system page is generated from these files, the catalog and the library (`node tools/stillhet-design-system-page.mjs`), and never edited by hand | Git is the source; nothing is copied | stillhet-docs |
| `gate.colour` | Nothing wears a colour Stillhet does not have (no blue, no gold: running is ink). Readable text holds 4.5:1 (3:1 large) and every state's ring 3:1, in both themes | Colour means state, and everyone can read it | colour-check |
| `gate.align` | On a settings tab every head, name and divider share one left edge, every row's end stops on one right edge, and a row's name, value and end share one baseline. The alignment is SettingsRow's and SettingsSection's, never a page's (`align-proof.mjs` shows the check catches each fault) | One edge is the look; a page cannot break it | align-check |
| `gate.flag-off` | With the `stillhet` flag off Worca is classic: the page is dev's byte for byte but for the flag's own gate, the same behaviour and data, and no migration that cannot be undone. An old `rail` flag in settings or `WORCA_FLAGS` is read as `stillhet` | Stillhet is opt-in, and turning it off must cost nothing | stillhet-flag-off |
| `gate.prototype` | Every change to today's UI (all of `ui/public/` except `stillhet/` and `design-system/`) is reflected in the Stillhet prototype, or the PR adds a `wire to` row that says why (`plans/stillhet/spec/wiring.md`), or carries the `no-ui-change` label and a "No UI change:" line | One design system: nothing reaches today's UI that the prototype does not know about | prototype-pr-check |
| `gate.surfaces` | Every Settings key and every path today's UI fetches has a wiring row or sits in a frozen baseline | A new classic surface cannot appear unseen | stillhet-surfaces |
| `gate.real-data` | Every Stillhet change is walked end to end in a real browser on four instances (classic and Stillhet, each on a copy of real data and on an empty install, each with its own HOME) against the prototype, by `plans/stillhet/spec/gate.md`. Classic leads on what a place does and shows, the prototype on how it looks, and classic stays intact | Demo data hides what real data breaks | by hand |
| `gate.function-first` | The look is judged only after the function is proven on real data: a failed step stops the gate, and nothing later is run or scored | A page can look right on seeded data and do nothing | by hand |
| `gate.coverage` | Every control classic Worca offers (`test/fixtures/stillhet-first-wiring/coverage/classic-controls.json`) is wired in Stillhet from its own place, planned, not offered by a decision, or MISSING. MISSING is a frozen baseline that only shrinks, each control in it naming an open finding | Nothing classic does is lost on the way to Stillhet | stillhet-coverage |
| `gate.no-demo` | On a live Stillhet no control shows demo data, a would-answer or a local-only success: every demo-answer site in `ui/public/stillhet/` and every `wire to` row is classified (wired, refused with a reason, not in Stillhet yet, prototype-only), and the offenders only shrink | A page starts from the demo model, so whatever is not wired looks real | stillhet-no-demo-on-live |
| `gate.perf` | Idle CPU and the cost of a live update stay inside budgets that only go down (`test/fixtures/stillhet-perf-budgets.json`) | A redraw per live frame once took the whole CPU | stillhet-perf-budgets |
| `gate.modes` | A check names its mode (`worca-stillhet.mode`): Expert by default, Simple and Advanced only when a change touches what that mode shows, one after another and never in parallel. A walk never reports a place its mode does not offer | A mode switched mid-walk reads as a missing place | by hand |
| `gate.person` | Nothing is pushed or merged without the audit by looking (open every control, judge the page as a person would) and a person's review | The step a gate cannot do | by hand |

## The checks

Each check, its command, when it runs and the widths it owes. `G/` is `plans/stillhet/prototype/gates/`.

| Check | Command | When | Widths |
|---|---|---|---|
| Library tests | `node --test test/design-system-components.test.mjs test/design-system-logic.test.mjs` | Every change to the library; in `npm test` | none |
| Redesign library tests | `node --test test/design-system-shell-redesign.test.mjs test/design-system-task-redesign.test.mjs test/design-system-forms-redesign.test.mjs test/design-system-places-redesign.test.mjs test/design-system-settings-redesign.test.mjs` | A change to the parts they name; in `npm test` | none |
| `stillhet-library-gate` | `node --test test/stillhet-library-gate.test.mjs` | Every change to UI code; in `npm test` | none |
| `stillhet-docs` | `node --test test/stillhet-docs.test.mjs` | Every change to a rule, the catalog or the library; in `npm test` | none |
| The task page's model | `node --test test/run-page-model.test.mjs` | A change to the task page's cases; in `npm test` | none |
| `stillhet-default` | `node --test test/stillhet-default.test.mjs` | A change to a pattern, `featureKinds` or `build.md`; in `npm test` | none |
| `stillhet-look-options` | `node --test test/stillhet-look-options.test.mjs` | Every change to the library; in `npm test` | none |
| `stillhet-flag-off` | `node --test test/stillhet-flag-off.test.mjs` | Every change to how Stillhet loads; in `npm test` | none |
| `stillhet-surfaces` | `node --test test/stillhet-surfaces.test.mjs` (`npm run stillhet:surfaces`; after adding rows, `-- --update` lowers the baseline) | Every change to a Settings key or to a fetch in today's UI; in `npm test` | none |
| `stillhet-coverage` | `node --test test/stillhet-coverage.test.mjs`; the inventory: `node tools/classic-inventory.mjs` (`--walk URL` walks a classic instance first, read-only; `--show TEXT` prints a control's status; `--update` lowers the baseline) | Every change to today's UI, to `ui/public/stillhet/` or to a wiring row; in `npm test` | none |
| `stillhet-no-demo-on-live` | `node --test test/stillhet-no-demo-on-live.test.mjs` (`node tools/stillhet-no-demo.mjs --list`; `--update` lowers the baseline) | Every change to `ui/public/stillhet/` or to a `wire to` row; in `npm test` | none |
| `stillhet-perf-budgets` | `node tools/test.mjs test/stillhet-perf-budgets.test.mjs test/stillhet-perf-budgets-chat-host.test.mjs test/stillhet-perf-budgets-tasks-host.test.mjs` | Every change to `ui/public/stillhet/` or a component it draws; in `npm test` | none |
| Wiring rows | `npm run stillhet:wiring` (`--list` for every id); `test/stillhet-wiring.test.mjs` | A change to an action or a model file of `ui/public/stillhet/`; in `npm test` | none |
| `settings-sentences` | `node G/settings-sentences.mjs` | A change to Settings' model: it reads each row's value, supporting line and picker words for every option | none |
| `ds-check`, with `align-check` | `node G/ds-check.mjs` | A change to a Stillhet page | 900, 400 |
| `handover-check` | `node G/handover-check.mjs` | A change to anything that sends to Chat | 1280 |
| `colour-check` | `node G/colour-check.mjs` (`--list` to see all) | A change to a colour, a token or a page's text | 1280, light and dark |
| `worca-sweep` | `node G/worca-sweep.mjs` | A change to the shell or to what joins pages | 1280, 900, 760, 375 |
| `run-page-sweep` | `node G/run-page-sweep.mjs file://$PWD/plans/stillhet/prototype/run-page.html` | A change to the task or group page | 900, 375 |
| `pulse-sweep` | `node G/pulse-sweep.mjs file://$PWD/plans/stillhet/prototype/pulse.html` | A change to Pulse or Settings | 900, 375 |
| `click-check` | `node G/click-check.mjs --small` for one change; without `--small` once per page | A change to a control | 1280, and 375 without `--small` |
| The sweeps a change needs | `npm run stillhet:sweeps` (`-- --base REF` adds the commits since it; `--all`; `--list` names them without running) | Every change to a prototype page: it runs the sweeps this table names for the changed files | theirs |
| `stillhet-compare` | `npm run stillhet:compare` (every route; `-- --parts NAME,NAME` for parts first) | Once per batch, after the function is proven (`gate.function-first`) | 1280 both themes, 360 light |
| Flag-off style diff | `npm run stillhet:style-diff -- --dev DEV_BASE` | Once per batch | 1280 both themes, 360 light |
| `prototype-pr-check` | `node tools/prototype-pr-check.mjs --base origin/dev` | Every PR, in CI's `prototype` job; re-run the job after adding the label or the body line | none |
| The real-data walk (`gate.real-data`) | `node tools/stillhet-gate-instances.mjs start` starts the four instances; `node tools/stillhet-seed-gate.mjs URL` leaves a held review gate on a mock instance; the walk is `plans/stillhet/spec/gate.md` | Before every Stillhet PR or fix batch merges: the touched items and every item that passed before | 1280, 390 |
| The audit by looking, then a person's review (`gate.person`) | No command | Once per page, after it is built | wide, narrow |

`ds-check`, `worca-sweep`, `run-page-sweep` and `pulse-sweep` run their units side by side (`--workers N`; from disk the
CPU count less one, at most 8; against the app, `STILLHET_TARGET`, one at a time). The full `npm test` takes about 30
minutes: inside an agent's work, run only the tests of the files touched.

## A classic control's status (`gate.coverage`)

| Status | When |
|---|---|
| wired | Stillhet's code calls its route from the control's own place; the same route called from another place clears nothing |
| planned | a `wire to` row names it |
| not offered | a wiring row says `not offered live` or `not a dev capability`, with why |
| MISSING | none of these; it sits in `test/fixtures/stillhet-coverage-baseline.json` with its finding, and a new one fails `npm test` |

A control's status is its worst route or key; one with no route and no key takes its page's place. The readable report is
`test/fixtures/stillhet-first-wiring/coverage/COVERAGE.md`, regenerated with the inventory.
