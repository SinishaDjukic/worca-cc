# Stillhet (codename Rail): the plan

The one plan. Build Stillhet, Worca's new design system, in the real app, behind the `rail` flag, opt-in and opt-out. Every entry point (`CLAUDE.md`, `AGENTS.md`, `docs/rail/README.md`) and every agent definition points here. Old wave and game plans are in `plans/rail/history/`: history, never built from. `test/rail-instructions.test.mjs` keeps these instructions from drifting back.

## Read first

`CLAUDE.md`, `CONTRIBUTING.md`, `docs/rail/README.md` (it leads), `docs/rail/gate.md`, `docs/feature-flags.md`, `plans/rail/stillhet-wiring.md` (where every moved feature, action and figure stands). The working design is `plans/rail/prototype/`; the rules are `docs/rail/`; the components are `ui/public/design-system/components/` (`docs/design-system-catalog.json` says which meets which need).

## The five requirements

1. Stillhet (codename Rail) is a new design system under the `rail` flag, opt-in and opt-out.
2. We build it, and adapt every existing feature to it, **stepping first on the redesign**: the prototype's screen is what gets built.
3. Where something a feature needs is missing in the design, it is created in the design first (the prototype plus a `docs/rail/` rule, catalog entry, component, test and gallery example), then built.
4. **The design leads.** Dev contributes data, APIs and logic, never its screens or markup.
5. What the design introduces is developed for real: no "Would…" toasts and no disabled stand-ins in the app.

## Order of authority

The concept below, then `docs/rail/`, then the prototype's code. The prototype still has things the concept removes (the "Ask about this…" docks): the concept wins. A real conflict between the prototype and a rule is a question for a person.

## How Stillhet is built

- With Stillhet on, Worca serves the prototype itself (`plans/rail/prototype/`) as its interface. With it off, today's app stays exactly dev's.
- One codebase: the prototype is Stillhet with a demo data adapter; the app is the same code with a live adapter. There is never a second copy of a page. A data layer in the prototype's model shape replaces its seeded data with Worca's real APIs and live frames.
- Never reuse dev's screens or wrap dev's DOM. Reuse dev's data, APIs and logic underneath.
- The prototype's "Would…" lines live only in its demo adapter. The app does the real action; a control that cannot act is disabled and says why, and a missing action is built.
- Features that move or merge are mapped once, in `plans/rail/stillhet-wiring.md`, from the prototype's own code. Old addresses are redirected with Stillhet on.
- Every slice merges the latest `dev` first and adopts anything new in dev into the design.

## Opt-in and opt-out

- The public name is Stillhet, behind the flag, opt-in and opt-out. One flag, `rail`, under Labs; every path only sets that flag.
- On reload from dev, ask an existing user once, in plain words: an evolution of Worca's design system; calm, only what needs you is lit, Chat first; an invitation to test it and report bugs on GitHub (the issues page). Accepting turns the flag on; declining changes nothing and never asks again. New users are asked in onboarding (slice 13).
- A small switch in the top bar, "Stillhet UI" with a beta chip, is the same setting as Settings › Labs. The question, the switch and the Labs row stay hidden behind an internal ask switch until Chat works (slice 4 turns it on).
- Off means today's app: same behaviour, same data, no migration that cannot be undone. Test both states.

## The slices

Each is its own PR into `dev`, from the latest `dev` (slice 1 from `docs/rail-agreed`).

1. Instructions cleanup plus the flag, opt-in and opt-out
2. The prototype served under the flag
3. The live data layer
4. Chat
5. Tasks and the task page
6. Schedules
7. Workflows
8. Marketplace
9. Projects
10. Insights
11. Requirements
12. Settings
13. Onboarding

Removing dead code and deprecated routes is a separate final PR after every slice is merged and verified; old public addresses keep their redirects.

## Acceptance for every slice

- A pixel comparison of the slice's pages, app against prototype: same route, mode, theme and width, differences fixed unless the owner accepts them in writing; the pairs go in the PR.
- The gates in `docs/rail/gate.md` pass, with no raising of the ratchet baseline.
- Every action and figure on the slice's pages is wired (`plans/rail/stillhet-wiring.md`), with no "Would…" in the app.
- No dev capability is lost, and no Stillhet module imports or wraps a dev screen.
- With the flag off the app shows 0 computed-style differences from the dev commit merged in first.

## Testing

- Two tiers. A fix round runs only the tests of changed files, the design-system gates and the flag-off checks. The real-browser walk runs once per slice, at the end, in Expert (another level only when the change touches what that level shows); levels run one after another.
- Grid: both themes at 1280, light at 360; 420 only when the change is about layout. A fix round re-walks only the cells of the pages it touched.
- Test both flag states. Nothing is rerun on an identical tree.

## Rules

- Work on a feature branch into `dev`, by PR linked to an issue, with no attribution lines other than the project's own. Never merge without the owner's yes. Names say what a thing does; no issue numbers in tool, test, script, tag or branch names.
- Answer open questions from this file, then `docs/rail/`, then the prototype, before asking the owner.
- Reuse the library: call its components, never write their markup or words. Anything a page needs and Rail lacks is added first: rule in `docs/rail/`, catalog entry, component, test, gallery example.

## The concept (do not re-decide)

- **Chat first.** Chat is the only place to type to Worca. No composer on any other page: remove every "Ask about this…" dock; ⌘J and the
  top bar's Ask go to Chat with the page as a removable chip, and Back returns (`rail.hand-to-chat`).
- **Side chat goes.** Under Stillhet, "Side chat beside a page" is removed (settled: dropped; see `plans/rail/stillhet-wiring.md`): ⌘J and Ask hand over to Chat instead. With the flag off it stays as it is today. The rest of the dev list was reviewed and stands.
- **Centers.** Pages outside Chat are centers: Tasks, Schedules, Workflows, Marketplace, Projects, Insights, Requirements. Each lands on a grid of cards
  that sums up what the sidebar cannot (`rail.center`, `panel.center`, `panel.center-shelf`). Projects is by workspace from Advanced.
- **Manual creation** stays from Advanced up in the same + menu, under the heading **"Legacy approach"**; the actions themselves keep **"by hand"**, as the prototype has them ("Edit by hand", "Add a project by hand", "By hand: a draft until you save it"). Never replace "by hand" with "Legacy approach" or "yourself":
  "Ask in chat" first, "Legacy approach" second. In Simple nothing is created outside Chat.
- **Stay in the chat.** Outside Expert you stay with the card in its chat (`rail.stay-in-chat`).
- **Dark cockpit, Nordic calm.** Normal is off; only what needs you is lit. One ranked ladder everywhere: 3 Warning, 2 Caution, 1 Advisory, 0 Normal
  (`look.alert-ladder`). The primary button only at Warning. One icon, one meaning. `?` and `!` both breathe whole in their colour; a focused card is read after 5 seconds.
- **Navigation.** W opens the full features menu with Chat's home behind it. The bar's title goes to that center's home; its ▾ is the quick menu and
  does not replace the full one; pages carry a breadcrumb (`nav.center-home`, `nav.quick`). Labs features sit where they will live, with one quiet word (`nav.labs`).
- **Modes.** Simple, Advanced, Expert. The graph is a selling point: Advanced and Expert show dev's real engine drawn in the Rail look, the graph by default; Simple gets the story. Backwards compatible.
- **Drafts.** Anything edited by hand is a draft until saved; tasks run the saved one (`rail.drafts`).
- **Toasts** say only what happened. A control acts, or is disabled and says why.

## Still open from the prototype

- `plans/rail/click-sweep.md` keeps every round's findings, most since fixed: re-check each against the code, and fix what still fails. Also the coverage it lists as owed.
- Toasts sit over page heads (`rc-toast` under the head). Run labels show on Tasks and filter. "Pinned and recent" head matches the other heads. Settings landing title spacing at 360/420; "Stays in Pulse only" lower case; `#settings/` trailing slash.
- The bell: count what needs you once. It currently reads 10 (8 in Simple) and a project can count twice.
- Shaper card: the text says one thing is open while two questions follow, and Approve comes before the questions it depends on.
- Insights' mock figures disagree with Tasks; the data source settles it.
- Expert: only part of the Task pages were click-tested.
- Scores so far are mostly 7 to 8.5 of 10; Projects' center was not re-scored after its last revision.

### Known red at handover (final gates on this branch)

Passing: run-page sweep, ds-check, colour-check, click-check (4,629 clicks), handover-check, settings-sentences, the design-system tests; `npm test` 21,182 passed.
Failing, fix these first:
- `npm test`: "boot: until the runs are known the chat list alone never picks the tab" (1 test, in test/ui-chat-home.test.mjs). It passed when run alone, so check for a timing flake under load first.
- `worca-sweep` steps at several widths: "one store: Pulse and the bar agree at the start", "answering moves the task everywhere", "accepting a gate moves it everywhere", "pausing moves it everywhere", "a Shaper slice is its own row with its type in the icon". The bell now counts every item that needs you (see above), and task marks changed with the dark cockpit, so decide for each whether the check or the code is out of date. Run `node plans/rail/prototype/gates/worca-sweep.mjs` for the whole list.

