# Rail: implementation prompt

Build the Rail redesign in the real Worca app, from the prototype on branch `docs/rail-agreed` (start there; it holds everything), behind the one `rail` flag. Merge the latest `dev` in first and keep it merged. Work
on a feature branch into `dev`, by PR linked to an issue, with no attribution lines. Never merge without the owner's yes.

## Read first

`CLAUDE.md`, `CONTRIBUTING.md`, `docs/rail/README.md` (it leads), `docs/rail/gate.md`, `docs/feature-flags.md`, `plans/rail/gameplan.md`,
`plans/rail/click-sweep.md`. The working design is `plans/rail/prototype/`; the rules are `docs/rail/`; the components are
`ui/public/design-system/components/` (`docs/design-system-catalog.json` says which meets which need).

**Order of authority:** the concept below, then `docs/rail/`, then the prototype's HTML. The prototype still has things the concept removes (the "Ask about this…" docks, some "by hand" labels): the concept wins.

**The prototype is a mock; the real app is not.** Its seeded data, and every toast saying "Would open…", "Would save…" or "Would run…", stand for real behaviour. Build the real action, on real data, using dev's existing function; never ship a "Would…" or a seeded number.

**The prototype's HTML is the source of truth.** Run it (`plans/rail/prototype/index.html`; build its bundle with `node plans/rail/prototype/gates/components-js.mjs`) and read its code.

## The goal behind it

Worca builds itself on Rail. A page only composes the design system and its data shapes. Anything a page needs and Rail lacks is added first:
rule in `docs/rail/`, catalog entry, component, test, gallery example. Never only in the page. Take dev's functions, never its design concepts.

## Step 1: what is missing

Before building, compare `dev` with the prototype and write `plans/rail/dev-vs-prototype.md`: every function dev has that the prototype lacks,
by area, with where it lives in dev. Things only the prototype has are fine; they are built here. Bring the list to the owner; missing
functions must be kept unless the owner drops them. Stop for the owner's review of this list before building any later slice: if slices are dispatched as runs, turn on "Ask me before each run".

## Iterate and validate against dev, all the way through

The comparison in step 1 was never run on the prototype; it is the first job here, and it is not one-off. For every slice, compare what you built with dev's behaviour and with the prototype, and record the result in `plans/rail/dev-vs-prototype.md`.
- Anything needed to align with the prototype and not yet developed is built.
- Features dev has that the prototype does not cover are adopted the same way: Rail's language, philosophy, library and standards decide how they look and behave. The prototype is the model, not the limit.
- Nothing dev does today may be lost or broken.

## Opt-in: Stillhet

The new design system's public name is **Stillhet** (codename Rail). It ships behind a feature flag, opt-in and opt-out (`docs/feature-flags.md`).
- It is one flag under Labs. Every path only sets that flag. New users are asked as part of onboarding, never by the reload prompt; if they skip, it stays a flag in Labs.
- **Header toggle:** a small switch in the top bar on the right of Pulse (right of Activity in today's app, before New run), labelled "Stillhet UI" with a small "beta" chip; switch only at phone width. Grey only, it is a normal state. It is the same setting as Settings › Labs, acts at once, explains itself on hover, and is disabled with the reason when the flag is locked. It shows with the flag off too, so the flag-off comparison excludes it.
- When an existing user reloads Worca from dev, ask them once, in plain words: this is an evolution of Worca's design system called Stillhet; say what it is for (calm: only what needs you is lit; Chat first); invite them to adopt it for testing and to report any bugs on our GitHub (link to the issues page).
- Accepting turns the flag on. Declining leaves everything as it is and does not ask again on each reload. They can turn it off or on later in Settings, and turning it off returns them to today's app.
- With the flag off, or while opting in or out, existing code and functions must not break: same behaviour, same data, no migration that can't be undone. Test both states.

## Test as you build

Focus on testing and validation: full end-to-end in a real browser against the real app, not only the prototype's mocks, in both flag states, all three modes, both themes and narrow widths. Stay as close as possible to the philosophy, the library and Rail itself at every step.

## The concept (do not re-decide)

- **Chat first.** Chat is the only place to type to Worca. No composer on any other page: remove every "Ask about this…" dock; ⌘J and the
  top bar's Ask go to Chat with the page as a removable chip, and Back returns (`rail.hand-to-chat`).
- **Centers.** Pages outside Chat are centers: Tasks, Schedules, Workflows, Marketplace, Projects, Insights, Requirements. Each lands on a grid of cards
  that sums up what the sidebar cannot (`rail.center`, `panel.center`, `panel.center-shelf`). Projects is by workspace from Advanced.
- **Manual creation** stays from Advanced up as the **"Legacy approach"** (exact words, replacing every remaining "by hand") in the same + menu:
  "Ask in chat" first, "Legacy approach" second. In Simple nothing is created outside Chat.
- **Stay in the chat.** Outside Expert you stay with the card in its chat (`rail.stay-in-chat`).
- **Dark cockpit, Nordic calm.** Normal is off; only what needs you is lit. One ranked ladder everywhere: 3 Warning, 2 Caution, 1 Advisory, 0 Normal
  (`look.alert-ladder`). The primary button only at Warning. One icon, one meaning. `?` and `!` both breathe whole in their colour; a focused card is read after 5 seconds.
- **Navigation.** W opens the full features menu with Chat's home behind it. The bar's title goes to that center's home; its ▾ is the quick menu and
  does not replace the full one; pages carry a breadcrumb (`nav.center-home`, `nav.quick`). Labs features sit where they will live, with one quiet word (`nav.labs`).
- **Modes.** Simple, Advanced, Expert. The graph is a selling point: Advanced and Expert show dev's real engine with Rail's skin, the graph by default; Simple gets the story. Backwards compatible.
- **Drafts.** Anything edited by hand is a draft until saved; tasks run the saved one (`rail.drafts`).
- **Toasts** say only what happened. A control acts, or is disabled and says why.

## Build order

1. One data source: every page reads the same facts for tasks, schedules, projects and costs, so no number can differ between pages. Each number opens what it counts.
2. Shell and navigation, then Chat and its cards to dev parity, then Tasks and the task page, Schedules, Workflows and the graph, Marketplace, Projects and Workspaces, Insights, Requirements, Settings.
3. The onboarding redesign last: mock it, challenge it with a new user and a UX/UI reviewer to 8.0, then build.

Mock first for anything the prototype doesn't already settle, and show the owner before building it.

## Still open from the prototype

- `plans/rail/click-sweep.md` keeps every round's findings, most since fixed: re-check each against the code, and fix what still fails. Also the coverage it lists as owed.
- Toasts sit over page heads (`rc-toast` under the head). Run labels show on Tasks and filter. "Pinned and recent" head matches the other heads. Settings landing title spacing at 360/420; "Stays in Pulse only" lower case; `#settings/` trailing slash.
- The bell: count what needs you once. It currently reads 10 (8 in Simple) and a project can count twice.
- Shaper card: the text says one thing is open while two questions follow, and Approve comes before the questions it depends on.
- Insights' mock figures disagree with Tasks; the data source settles it.
- Expert: only part of the Task pages were click-tested.
- Scores so far are mostly 7 to 8.5 of 10; Projects' center was not re-scored after its last revision.

## Known red at handover (final gates on this branch)

Passing: run-page sweep, ds-check, colour-check, click-check (4,629 clicks), handover-check, settings-sentences, the design-system tests; `npm test` 21,182 passed.
Failing, fix these first:
- `npm test`: "boot: until the runs are known the chat list alone never picks the tab" (1 test, in test/ui-chat-home.test.mjs). It passed when run alone, so check for a timing flake under load first.
- `worca-sweep` steps at several widths: "one store: Pulse and the bar agree at the start", "answering moves the task everywhere", "accepting a gate moves it everywhere", "pausing moves it everywhere", "a Shaper slice is its own row with its type in the icon". The bell now counts every item that needs you (see above), and task marks changed with the dark cockpit, so decide for each whether the check or the code is out of date. Run `node plans/rail/prototype/gates/worca-sweep.mjs` for the whole list.

## Definition of done

Each slice: `npm test` and every page gate in `docs/rail/gate.md`, with no raising of the ratchet baseline. Then the validation below, fixes, re-test of what was fixed.

**Validation, each round:** agents split evenly across every page, one area each, real mouse clicks, every control and every option of every dropdown, all three modes, Cancel, Esc, double click, Back, empty and long input, both themes, narrow widths.
Judge the outcome, not that something happened: what was picked is what arrived, counts follow, nothing leaves its bounds. Check consistency of icons, colours and themes each round and propose improvements. Report design findings tied to usability and a Rail rule.

**Reviewers:** a new user, a daily user and a UX/UI reviewer against Rail, independent, unprompted, on every design round: 8.0 of 10 from each; below is revised and re-challenged; after three rounds it goes to the owner with the reason.

**Boss round before done:** every area, three independent agents, two rounds with fixes, average at least 7.5 per area, none under 7.0, no critical open, then final validation.
