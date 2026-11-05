# Worca Rail: run page enrollment

From design to the only design, in five phases, on Worca's flag lifecycle (`docs/feature-flags.md`): one flag,
`runCardV2`, moves `experimental` → `beta` (on by default) → `retiring` → graduated. Design: the "Run card redesign"
canvas and `plans/rail/prototype/index.html`. Review and its P0 / P1 lists: `plans/rail/review.md`.

| Phase | Flag | Who sees v2 | Length | Done when |
|---|---|---|---|---|
| 1. Implement | `experimental`, off | Nobody unless switched on | ~4 weeks core, +3 for new actions | Acceptance tests pass with the flag on and off |
| 2. Deploy as Labs | `experimental`, off, Labs chip | People who turn it on in Settings › Labs | 2 weeks | No P0 bugs, no flicker, top feedback fixed |
| 3. Switchover | `beta`, **on** | Everyone; Settings › Labs or ⋯ switches back | 1 release cycle (≤ 90 days review window) | Few switch back, no regressions |
| 4. Deprecate old design | `retiring`, then removed | Everyone, no way back | 1 release, then one graduation PR | v1 code and the flag gone in one PR |
| 5. Enroll the language | per page, each its own flag | Page by page | Ongoing, highest traffic first | Every page on the shared components |

## 1. Implement

Behind `runCardV2` (`experimental`, default off), cut at `paintRunHead`, the group head and `initRdTabs` / `initHdTabs`
in `ui/public/app.js`; the chat run card stays on v1 until phase 5.

- **Slices** (each its own PR into `dev`, branch `feat/run-card-v2-<slice>`):
  1. Card and stepper: a pure model `src/shared/run-card-model.mjs` beside `runModel`, a renderer
     `ui/public/run-card-v2.mjs` that patches nodes in place, the page bar, figures, live line, flat-list fallback
     for workflows without stages. 7–9 days.
  2. The four tabs, with old tab links aliased (diff → changes; workflow, logs, agents → activity; qa → decisions;
     artifacts → summary) and a decision on per-level gating (`docs/ui-levels.md`). 5–7 days.
  3. Group page and the stack card, without merge or recommendation. 5–6 days.
  4. Flag, tests (flag on and off), `docs/design-system.md` rules (Route, Card head, Patterns, Tabs), `docs/INDEX.md`
     rows. 3–4 days.
- **New actions, separate slices outside the design flag:** Fix checks (1–2 days), One PR vs Stacked recommendation
  with the "cannot combine" check (3), Merge PR from Worca (4–6), Resume from a stage (8–12). Until they land: a link
  to GitHub for Merge PR, "Start a new run" for Resume from Build.
- **Both designs read actions from `headModel`**, so v1 and v2 never offer different buttons.
- **Exit:** the QA acceptance list in the review passes with the flag on and off; P0 list closed.

## 2. Deploy as Labs

- Registry entry: `stage: 'experimental'`, `default: false`, `owner`, `added`, `reviewBy` (≤ 90 days), `docs`.
- The card shows the **Labs** chip (`data-flag-chip`), linking to its Settings › Labs row; "How it works" links the
  design doc.
- Dogfood for two weeks: the team runs on v2 daily, on desktop and phone, in both themes and in Away mode.
- Collect feedback in one issue; fix P0 and the top P1 items (failure evidence, budget, answer in place).
- **Exit:** no open P0, no flicker or focus loss on live runs, numbers match v1 for the same run.

## 3. Switchover

- Move the flag to `stage: 'beta'`, `default: true`: everyone is enrolled, anyone can switch back in Settings › Labs,
  with `worca flags off runCardV2`, or from a "Use the classic run page" item in ⋯.
- Changelog entry (`/worca-changelog`) with the new card, the tabs and where things moved.
- Watch one release cycle: issues, switch-backs, CDP click-through of every run kind.
- **Exit:** switch-backs rare and explained, no regressions open, review window not exceeded.

## 4. Deprecate the old design

- One release on `stage: 'retiring'`: forced on, hidden from Settings, refused by the API; the ⋯ item goes.
- Then the graduation PR, in one change: delete the registry entry and every `data-flag` / `flagOn` /
  `onFlagChange` / `flagEnabled` / `requireFlag` use, the v1 card code (the route, facts block and tiles, the old
  result rows, `RD_TABS` / `HD_TABS` v1 tab sets), their CSS and tests. Keep the tab-link aliases.
- `test/flags-registry.test.mjs` and `test/flags-usage.test.mjs` enforce it.
- **Exit:** v1 code and the flag are gone; design system describes only v2.

## 5. Enroll the design and language across Worca

The run card becomes the source of shared components and of the Route language (one rail, stations as states, one
next step, colour only where a state is). Move them to `ui/public/components/` and roll them out page by page, each
page behind its own flag on the same lifecycle:

- **Components:** status dot and rail, stepper (full and compact), step row, action split button with help lines,
  tabs, + chips, stack card, evidence box.
- **Pages, highest traffic first:**
  1. Runs list rows: the compact stepper under each live row, the same dots and words.
  2. Chat run card: the compact card (state, compact stepper, one action), sharing the model.
  3. History (saved runs): the same card and tabs as the live page.
  4. Group, feature and chain pages: done in phase 1–3, aligned to the shared components.
  5. Statistics and Team metrics: cost and state colours from the same tokens; cost by step from Activity's data.
  6. Settings, Marketplace and other lists: divided rows on the rail, one action per row, help lines in menus.
- **Each page:** a design pass on the canvas first, the five-way review, then the same five phases at a smaller scale.
- **Exit:** every page uses the shared components; `docs/design-system.md` describes them once.
