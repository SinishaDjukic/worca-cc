# The gate

| Rule | What | Why | Held by |
|---|---|---|---|
| `gate.pages` | Every Rail page passes its sweeps in every case, at its widths, in both themes | A page is checked by running it | worca-sweep |
| `gate.controls` | Every control acts, or is disabled and says why | No dead controls | click-check |
| `gate.new-code` | New UI code that skips the library fails npm test; old pages shrink by a ratchet | The design system has force | rail-gate |
| `gate.docs` | Docs, catalog, library and gallery agree | One source, no drift | rail-docs |

## The checks

The one table: each check, its command, when it runs and the widths it owes. From `plans/rail/prototype/gates/`, shown as `G/`.

| Check | Command | When | Widths |
|---|---|---|---|
| Library tests | `node --test test/design-system-components.test.mjs test/design-system-logic.test.mjs` | Every change to the library; in `npm test` | none |
| `rail-gate` | `node --test test/rail-gate.test.mjs` | Every change to UI code; in `npm test` | none |
| `rail-docs` | `node --test test/rail-docs.test.mjs` | Every change to a rule, the catalog or the library; in `npm test` | none |
| Run page's model | `node --test test/run-page-model.test.mjs` | A change to the run page's cases; in `npm test` | none |
| `settings-sentences` | `node G/settings-sentences.mjs` | A change to Settings' model | none |
| `ds-check`, with `align-check` | `node G/ds-check.mjs` | A change to a Rail page, inside its run | 900, 400 |
| `worca-sweep` | `node G/worca-sweep.mjs` | A change to the shell or to what joins pages | 1280, 900, 760, 375 |
| `run-page-sweep` | `node G/run-page-sweep.mjs file://$PWD/plans/rail/prototype/run-page.html` | A change to the run or group page | 900, 375 |
| `pulse-sweep` | `node G/pulse-sweep.mjs file://$PWD/plans/rail/prototype/pulse.html` | A change to Pulse or Settings | 900, 375 |
| `click-check` | `node G/click-check.mjs --small` inside a run; without `--small` once per page | A change to a control | 1280, and 375 without `--small` |
| Prototype-vs-app comparison | Wave 1 builds it, small (`plans/rail/wave-1.md`) | Once per page, after it is built; never inside a run; only pages in `plans/rail/compare-pages.json` | wide, narrow |
| The audit by looking | No command: open every control and judge the page as a person would | Once per page, after it is built, before review | wide, narrow |
| A person's review | The step a gate cannot do: nothing pushes or merges without it | After the audit by looking | wide, narrow |

`npm test` holds only the first four. A sweep runs in both themes: no sideways scroll, no clipped text without a tooltip,
no overlaps, every section on the text edge, contrast 4.5:1, every menu and dialog inside the window, no page jump on any
click, the top bar one row, one way back at a time (`‹ Settings` only while the side menu is hidden); and every control does
something. `ds-check`: everything on the page comes from the design system. `align-check`, on a settings tab: one left edge
for every head, name and divider, one right edge where every row's end stops (a quiet button by its text), and each row's
name, sentence and end on one baseline. The alignment is SettingsRow's and SettingsSection's, never a page's;
`align-proof.mjs` shows the check catches each fault. These run on the prototype, and on the app from Wave 1's first step
(`plans/rail/wave-1.md`).

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
