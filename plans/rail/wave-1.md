# Worca Rail: Wave 1, what Worca builds

**Building Rail now starts here.** The design is `docs/rail/` and the prototype (`plans/rail/prototype/`). This file never
restates them: it says what to build, in what order, from where, and how it is checked. Where Rail stands today:
`game-plan.md` › Now.

**Base branch: `docs/rail-agreed`.** Not `feat/rail-components`: that branch and its worktree are old. Do not take code
from `backup/rail-wave-1-*`, except where this file says read-only.

## Already done in Agreed: do not redo

**Before Agreed**, the library was incomplete, each page held its own logic and nothing failed a page that skipped the
design system. **Now**, in Agreed: the library is complete in `ui/public/design-system/components/` (with its tests and
gallery); the shared logic is in it (`runState`, `actionFlow`, `stepFlow`, `workPlace`, `shows`, `prefs`; `docs/rail/logic.md`);
the gate is in `npm test` (`test/rail-gate.test.mjs`, `test/rail-docs.test.mjs`).

**Not done: the Rail CSS move.** The Rail CSS is still in `plans/rail/prototype/`, so a library component in the app draws
unstyled until step 3 below lands. The app has no `rail` flag and no Rail page yet.

## The flag, and what the gates point at

**The prototype has no `rail` flag and always shows Rail.** The app gets the flag in step 1. **One `rail` flag holds the whole new
design: every planned wave enrolls under it, gradually, and nothing ships outside it.** Wave 1 stops at Labs: `rail` is
`experimental` and off (`docs/feature-flags.md`). Later stages are decided per wave.

Until step 1 lands, the page checks run on the prototype over `file://`. Once it lands they also run on the app in mock mode
with `rail` on, by URL (`run-page-sweep` and `pulse-sweep` already take one; step 1 gives `ds-check` and `worca-sweep` the
same argument), and one pass with `rail` off shows nothing changed. Commands: `docs/rail/gate.md`.

## Feature 1, tonight

One Feature, in this order. Each step is one or more slices, one PR per slice, built on `docs/rail-agreed`:

0. **CI holds the design system.** `npm test`, with `test/rail-gate.test.mjs` and `test/rail-docs.test.mjs` in it, runs on
   every PR into `dev` (`.github/workflows/ci.yml`): confirm it, and fix the workflow if they are skipped. Making that job a
   required check is a repository setting, a person's step when Agreed lands on `dev`; a run never changes repository rules.
1. **The flag.** `rail` in `src/shared/flags/registry.mjs`: `experimental`, off. `ui/public/design-system/rail-retires.json`
   with its freeze test: a slice that replaces an old part lists it, and a test fails any new use of a listed part.
2. **The tokens.** A layer scoped under `:root[data-rail]`, with `--sans` left as Poppins until graduation
   (`agreed/decisions-1.5b.md`, D6).
3. **The Rail CSS moves** from `plans/rail/prototype/design-system/` into `ui/public/` parts, listed in `ui/public/parts.json`,
   named by `docs/split-by-feature.md`. Scoped so **nothing changes with the flag off**: `rail-look.css` sets tokens on a
   bare `:root` with `--sans:Inter`, and `rail.css` restyles shared classes (`.menu`, `.btn`, `.tabs`) at its top level, so
   both move under `:root[data-rail]` and `--sans` is dropped; new classes (`set-row`, `list-row`, `side-menu`) need no scope.
   The prototype reads the parts through `app.css` and sets `data-rail` on its own page, so it keeps showing Rail.
4. **Rail colours on today's pages**, behind the flag: the palette and one surface for page and card.
5. **The shell and navigation.** `docs/rail/navigation.md`, the prototype's `shell/`.
6. **Settings.** `docs/rail/settings.md`, the prototype's `settings/`. A page draws Rail or its old self behind one
   `flagOn('rail')` at its entry, never mixed inside a component. Needs: **daily budget reset** (today weekly or monthly,
   `costLimitResetPeriod`); **Gemini quota** (set by the person, counted by Worca).

| Today | Becomes |
|---|---|
| `design-system/rail-look.css` | `ui/public/design-system/rail-look.css` |
| `design-system/rail.css` › components | `ui/public/design-system/` parts by kind (`rail-controls.css`, `rail-rows.css`, `rail-feedback.css`) |
| `design-system/rail.css` › the run and group page | `ui/public/runs/` parts (`rail-run-card.css`, `rail-run-tabs.css`, `rail-create-pr.css`) |
| `pulse/pulse.css` › the panel, New run near a limit | `ui/public/pulse/` parts (a new feature folder) |
| `pulse/pulse.css` › Settings' page | `ui/public/settings/` parts |

## The Features after it

One each, only after the person has reviewed the one before. Worca does not continue to the next by itself.

- **Feature 2: Pulse.** `docs/rail/`, `plans/rail/pulse.md`, the prototype's `pulse/`. Needs: **usage feed**.
- **Feature 3: the run and group pages.** `docs/rail/thing-page.md`, the prototype's `runs/`. Needs: **Merge**, **Fix checks**,
  **Re-run checks**, **Restart Build**. Each gap ships after its surface, with a clear stand-in until then. The other
  new actions are `PROPOSED` in `runs/run-page-model.js`.

**Not in Wave 1: the Runs list and the Chats column.** They are in the prototype as reference for Wave 2. Today's design stays.
**Also out: run estimates.** Wave 2 (`waves.md`).

## Checks

**Inside a run, small checks only:** the library's tests, `rail-gate`, `rail-docs`, and the checks of the page it touched.
**Once per page, after it is built, never inside a run:**
1. The prototype-vs-app comparison (below).
2. The audit by looking: open every control and judge the page as a person would.
3. A person's review.

**Nothing pushes or merges without the person's yes.**

**The comparison (a step for Wave 1, to build small).** Prototype against app, about 15 key cases, wide and narrow.
It covers only what is enrolled in one small file, `plans/rail/compare-pages.json`: it starts with the shell and Settings,
and a page joins when its Feature is built (Pulse, then the run and group pages). Later pages join only after their wave is
shaped and built. Captured pages and the reference Runs list and Chats column are not compared: the prototype does not hold
their final design. A gap outside the file is not a failure. Starting point, read-only: `tools/rail-compare-*.mjs` on
`backup/rail-wave-1-fix-slice-1`. That version was too heavy.

## Wave 1's additions

Not yet in the library. A Feature adds each first, as `docs/rail/build.md` says: the drawer, the icon rail, a form's problem
note, Sign in again.

## Open

Left out on purpose, each over an hour or needing a decision:

- **rail-gate's class list** is by hand: the catalog does not hold classes, so generating it means adding them there first.
- **"Held by" proves a check exists, not that it holds the rule:** grepping each rule's subject in its check.
- **The catalog restates `docs/rail/`** in its `patterns`, `actions` and `howToBuild`: cut it to need, component, code.
- **Rows outside `row()`:** `fileRow`, `stackedPrRow`, and `pulseRow` (its time in the text, no ⋯).
- **Pickers:** picks report as `data-menu-pick` or `data-pick`; one attribute means touching every page's handler.
- **Toast:** `warn` and `error` that stay, and a `toast()` that takes Undo: `pulse.js` still writes it by hand.
- **Exports outside the catalog** (about 130, by `HELPERS` in `test/rail-docs.test.mjs`): promote `moreMenu`, `splitButton`,
  `statusDot`, `confirmForm`, `selectAllBox`, `toastUndo`; drop what no page calls (`isLiveStep`, `selectCount`, `chordId`).
- **Library shape:** keys and the shortcuts sheet in one module, `prefs` a global store holding provider connection, icons
  passed in as SVG with their own stroke widths, `pd-`/`rc-`/`pz-` classes on generic components.
- **By-hand rules that could be checked cheaply:** `small.no-emoji`, `motion.fade`, `list.row-one-target`.
