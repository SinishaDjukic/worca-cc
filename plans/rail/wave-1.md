# Worca Rail: Wave 1, the goal

**Worca builds Wave 1 of the Rail redesign from one requirement, and every PR it delivers is checked against the design
system by the same gates the prototype passes.**

Shaped 4 Nov 2026. The steps: the Settings prototype (done), one prototype of all of Worca, then the requirement
(this file grows into it). The rules live in `docs/design-system.md` › Worca Rail; this file says what Wave 1 is.

## Scope

| In Wave 1 | How |
|---|---|
| The run page and the group page | Rail, as in the prototype (`index.html`) |
| Pulse: Now and Updates, the usage rings, Usage and costs, what a start does near a limit | Rail (`pulse.html`, `pulse.md`) |
| Settings: every section, opened from the profile menu | Rail (`pulse.html` › Settings, `settings-model.js`) |
| Every other page (Runs list, Chats, Schedules, Projects, Statistics, the Add-ons' own pages) | Today's design, with the Rail colours and surfaces: the palette and one surface for page and card; Poppins stays until the page moves to Rail |
| What the design promises and the app cannot do yet | Built: each gap is its own slice, with its backend (new APIs, calls, events), after the surface that needs it; the surface ships with a clear stand-in until it lands |

Out of scope: anything the design does not cover.

## How Worca receives it

**One Feature, sliced.** One requirement; Worca's planner cuts it into ordered runs, one PR per slice, each passing
the gates. The plan is approved once. Each PR follows the project's way: an issue, then a PR into `dev`, linked; a
feature flag only for a big feature (the surfaces), never for a small one.

## Enrollment: one flag, opt-in first

One flag, `rail`, for the whole wave: the Rail colours everywhere and the three surfaces, so there are two states to
test (today's Worca, or Wave 1), never a mix nobody designed. It follows Worca's flag lifecycle
(`docs/feature-flags.md`):

1. **Labs (opt-in):** `experimental`, off. A Worca turns it on in Settings › Labs (a Labs switch applies to everyone using
   that Worca). Every slice merges into `dev` behind it while it is off; the team dogfoods it.
2. **Switchover:** `beta`, on for everyone; Settings › Labs switches back, for one release cycle.
3. **Retiring:** forced on, no way back.
4. **Graduation:** one PR removes the flag and the old design (below).

## The old design leaves in one PR

Wave 1 keeps the old and the new apart, so retiring the old is a deletion, not a hunt:

- **Rail is a layer.** The Rail colours and surfaces are a token layer on today's values; every Rail rule that restyles a
  shared class (`.menu`, `.btn`, `.tabs`, a dialog's card) is scoped to `:root[data-rail]`. New classes (`set-row`,
  `list-row`, `side-menu`…) need no scope: today's pages never use them.
- **One branch per surface.** A page draws its Rail version or its old one behind one `flagOn('rail')` check at the
  page's entry, never mixed inside a component.
- **What retires is listed as it retires.** The slice that replaces an old part (a CSS part in `parts.json`, a markup part,
  a view, a function) adds it to `ui/public/design-system/rail-retires.json` with the Rail part that replaces it. A test
  fails any new use of a listed part, so the old design cannot grow during the wave.
- **Graduation** deletes the flag and its checks (the flags tests already demand it), every listed part, and the
  `:root[data-rail]` scopes; the Rail token values become the base tokens.

## The library and the files: aligned with the split

Rail follows the app's file layout (`docs/split-by-feature.md`, #919) like any other code; nothing lives beside it.

- **The components** are code in `ui/public/design-system/components/` (already), exported by its `index.mjs`, with their
  tests in `test/`. The app imports them; the prototype bundles the same files. One source.
- **The CSS** moves out of the prototype into `ui/public/FEATURE/PART.css` parts, listed in `ui/public/parts.json`, named by
  the split's rules (what it holds, at least 2 words, no numbers, no generic words; 150–500 lines, cap 1,000; a section
  under 40 lines joins its neighbour). The prototype then reads them through `app.css` like the rest. The map:

  | Today (prototype) | Becomes |
  |---|---|
  | `rail-look.css` (tokens, surfaces, motion timings) | `ui/public/design-system/rail-look.css` |
  | `rail.css` › components (status line, menus, strip, rows, lists, side menu, search, dialog, field, landing) | `ui/public/design-system/` parts by kind, such as `rail-controls.css`, `rail-rows.css`, `rail-feedback.css` |
  | `rail.css` › the run and group page (card, stepper, tabs, Create PR) | `ui/public/runs/` parts, such as `rail-run-card.css`, `rail-run-tabs.css`, `rail-create-pr.css` |
  | `pulse.css` (the panel, rings, New run near a limit) | `ui/public/pulse/` parts (a new feature folder) |
  | `pulse.css` › Settings' page | `ui/public/settings/` parts |
- **Markup** a Rail page needs is a part `ui/public/FEATURE/PART.html` named by its view; most Rail markup is built by the
  components in JS.
- **New APIs** for the missing functionality are routes in `ui/routes/FEATURE/AREA.mjs`, registered by the feature's
  `index.mjs`, never in `ui/server.mjs`.
- **The gates run in the app's test suite**, not only in the prototype: the component tests; the names, heads and
  alignment checks on the Rail pages with the flag on; the freeze on retired parts; and the split's own checks
  (`node tools/split-by-feature.mjs --check`, `test/split-by-feature-file-names.test.mjs`, `test/public-assets.test.mjs`).

## What has to exist before it is handed over

1. **One prototype of Worca.** `index.html` and `pulse.html` become one app: one sidebar, top bar and profile menu;
   Runs, a run page, a group page, Pulse, Usage and costs and Settings, navigated as in the app. The pages outside the
   scope appear as a sketch of today's page in the Rail colours, so the whole of Worca can be judged. One sweep covers
   it all.
2. **The design system as the source.** The rules, the catalog, the components in code with their tests and gallery,
   and the gates (`ds-check` with alignment, names and heads; the sweeps). The 8 catalog components not yet in code
   (OptionList, Checkbox, Chip, ListEditor, SuggestionField, Stepper, TagGroup and one more found on the way) are
   finished before the surfaces that use them.
3. **The requirement.** `enrollment.md` rewritten for Wave 1: the slices in order, each with what it changes, its
   acceptance criteria, its gate, and whether it carries a flag; and the inventory of the missing functionality, each
   gap with the API, call or event it needs.

## Decided

- Hand-off: one Feature, sliced (4 Nov).
- Pages outside the scope in the prototype: today's look in the new colours (4 Nov).
- Rail colours everywhere: the colours and the one-surface look; the type stays (4 Nov).
- Missing functionality: inventoried, one slice each with its backend, after its surface, with a stand-in until it
  lands (4 Nov).
- Enrollment: one `rail` flag for the wave, Labs opt-in first, then switchover, retiring, graduation (4 Nov).
- The old design leaves in one PR: a scoped Rail layer, one flag check per surface, the retire list and its freeze test
  (4 Nov).
- The library and the Rail CSS follow the split's layout and names; the gates run in the app's test suite (4 Nov).
- A setting or a place: the Marketplace store stays a place in the sidebar; installed plugins, Connectors, Models,
  Providers and Team policy are Settings. The sidebar keeps the places: Chat, Runs, Schedules, Statistics, Team
  metrics · Build: Workflows, Requirements, Marketplace · Manage: Projects, Workspaces (4 Nov).
