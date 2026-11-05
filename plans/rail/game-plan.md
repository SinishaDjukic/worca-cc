# Worca Rail: the game plan

Bundled 5 Nov 2026. The goal: the library, the tokens and the design system lead, and Worca is built from them. This
file is the one place for where Rail stands and what comes next; the details live in the files it names.

## 1. Three steps for everything: Shaping, Agreed, Accepted

| | Shaping | Agreed | Accepted |
|---|---|---|---|
| Where | `docs/rail-shaping` | `docs/rail-agreed` | what is merged on `dev` |
| Holds | ideas being shaped; every shape changes it | decided work waiting to be enrolled (handed to the Shaper) | built and merged work |
| Read by | shaping sessions | the next enrollment | Worca, the Shaper, the app's code |

An idea moves Shaping → Agreed when it is decided, and Agreed → Accepted when its Feature is built and merged. Shaping is
always based on Agreed, and Agreed on `dev`; each is rebased after the step below it moves. Wave 1.5 is in Agreed, as it
stands, to be enrolled as soon as Wave 1 completes.

What lives where:

| What | Accepted | Shaping (and Agreed, once decided) |
|---|---|---|
| Rules (`docs/design-system.md`, later `docs/rail/`) | the rules that hold | proposed and changed rules, marked |
| Catalog (`docs/design-system-catalog.json`) | what exists | proposed entries |
| Library (`ui/public/design-system/components/`, tests, gallery) | what the app may import | proposed components with tests; never imported by app code |
| Tokens and CSS parts | the values in use | proposed values |
| Checks (ds-check, alignment, sweeps, docs check) | what every PR passes | new checks with their proof pages |
| Prototype (`plans/rail/prototype/`) | decided pages | pages and options being shaped |
| Plans (`plans/rail/*.md`) | a plan Worca builds from (`wave-1.md`) | plans being shaped (`waves.md`, this file) |
| Mocks | only the mock that records a decision | every option, rejected ones too |
| Artifacts | Prototype and Design System, generated from `dev` | Prototype · Shaping and Design System · Shaping, generated from the branch |

- **Promotion:** decided ideas move to Agreed; an enrolled Feature reaches `dev` as PRs, carrying its page, rule, catalog entry, component and test, check,
  plan and deciding mock together. Agreed and Shaping are then rebased.
- **Generated, never copied:** one publish script builds the four artifacts from their git refs.
- **Setting it up** (after Wave 1, so nothing in it moves): the publish script; the two Shaping artifacts; the current
  Prototype and Design System artifacts regenerated from `dev` (cut back to what is merged).

## 2. Where things stand

- **On `dev`:** the design system, the components in code, the prototype and its checks (#1105); the marks as SVG
  (#1101, open for review).
- **Wave 1** (`wave-1.md`): one Shaper Feature (`feat_1803efb33a68`), 8 slices, Ask me before each run on, every plan
  checked against the `rail` flag before approval. Slices 1–4 done, 5 (Settings) building, 6–8 waiting.
- **Shipping Wave 1:** the slices started from `feat/rail-components` before its squash merge, so each slice branch
  merges `dev` in before its PR (the content is identical, there is no conflict), and every PR targets `dev`, not the
  Feature's recorded landing branch. Slice 1 ended with 2 open review issues: read before it ships.

## 3. The waves

The order and how every wave works are in `waves.md`. In short:

| Wave | What |
|---|---|
| 1 | Run and group pages, Pulse, Settings, the shell (building) |
| 1.5 | In Agreed, enrolled right after Wave 1. The design system holds: one concern one place (`docs/rail/`, rule ids, docs check); the row primitive (one rail, one end, the end-column rule); generated docs and artifacts; Accepted and Shaping set up; Wave 1's open decisions; the type (Inter) |
| 2 | The daily loop: Runs list, New run, Chat and run cards, Ask worca, shaped toward Wave 6 so it is not redesigned twice |
| 3 | Building blocks: Workflows, Requirements and features, Schedules, Projects, Workspaces |
| 4 | Store and insight: Marketplace, Skills, Statistics, Team metrics, Usage and costs, C4 and graph, artifacts, diffs, terminal |
| 5 | Edges and graduation: onboarding, Away, empty and error pages, the extension, docs-site; the `rail` flag and the old design go |
| 6 | Chat is the product, builds are its hidden engine (to shape) |
| 7 | Micro-frontends on one shell and one versioned design system (to shape) |

Every wave redesigns from what each page is for (no patching), mocks its choices, joins the prototype, puts every new
need into the design system first, and goes to the Shaper as one Feature behind the `rail` flag.

## 4. Open decisions

Wave 1's open decisions are decided (5 Nov): `agreed/decisions-1.5b.md`, enrolled with Wave 1.5.

For Wave 1.5 and later:
- When the type moves to Inter: with graduation or a wave earlier.
- Wave 6's challenges (`waves.md`): what stays visible, a run's address, builds with no chat, features in a chat, Pulse,
  teams.
- Wave 7's: why, the shared core, contracts, styles, delivery, gates.

## 5. Standing rules

- The design system leads; a page only composes it. What a page teaches goes into the DS, the library and a check first.
- Structure over prose: a component owns its layout.
- A long branch or path folds its middle, never renamed.
- Runs are dispatched, Chat steers; ordinary chats are never intercepted.
- One `rail` flag across the waves until graduation; small features ship without a flag.
- Issue, then a PR into `dev`, linked, no attribution.
