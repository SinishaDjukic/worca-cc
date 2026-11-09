# Rail: implementation prompt

Build the Rail redesign in the real Worca app, from the prototype on branch `docs/rail-shaping`, behind the one `rail` flag. Work
on a feature branch into `dev`, by PR linked to an issue, with no attribution lines. Never merge without the owner's yes.

## Read first

`CLAUDE.md`, `CONTRIBUTING.md`, `docs/rail/README.md` (it leads), `docs/rail/gate.md`, `docs/feature-flags.md`, `plans/rail/gameplan.md`,
`plans/rail/click-sweep.md`. The working design is `plans/rail/prototype/`; the rules are `docs/rail/`; the components are
`ui/public/design-system/components/` (`docs/design-system-catalog.json` says which meets which need). Approved mocks:
`plans/rail/mocks/wave-3/` (`cockpit/ladder.png` is the alert ladder, `projects-center/`, `tasks-*`, `schedules-*`).

## The goal behind it

Worca builds itself on Rail. A page only composes the design system and its data shapes. Anything a page needs and Rail lacks is added first:
rule in `docs/rail/`, catalog entry, component, test, gallery example. Never only in the page. Take dev's functions, never its design concepts.

## Step 1: what is missing

Before building, compare `dev` with the prototype and write `plans/rail/dev-vs-prototype.md`: every function dev has that the prototype lacks,
by area, with where it lives in dev. Things only the prototype has are fine; they are built here. Bring the list to the owner; missing
functions must be kept unless the owner drops them.

## The concept (do not re-decide)

- **Chat first.** Chat is the only place to type to Worca. No composer on any other page: remove every "Ask about this…" dock; ⌘J and the
  top bar's Ask go to Chat with the page as a removable chip, and Back returns (`rail.hand-to-chat`, mock `ask-jump`).
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

Mock first, as PNG, for anything the prototype doesn't already settle, and show the owner before building it.

## Still open from the prototype

- Everything not fixed in `plans/rail/click-sweep.md`, and the coverage it lists as owed.
- Toasts sit over page heads (`rc-toast` under the head). Run labels show on Tasks and filter. "Pinned and recent" head matches the other heads. Settings landing title spacing at 360/420; "Stays in Pulse only" lower case; `#settings/` trailing slash.
- The bell: count what needs you once. It currently reads 10 (8 in Simple) and a project can count twice.
- Shaper card: the text says one thing is open while two questions follow, and Approve comes before the questions it depends on.
- Insights' mock figures disagree with Tasks; the data source settles it.
- Expert: only part of the Task pages were click-tested.
- Scores so far are mostly 7 to 8.5 of 10; Projects' center was not re-scored after its last revision.

## Definition of done

Each slice: `npm test` and every page gate in `docs/rail/gate.md`, with no raising of the ratchet baseline. Then the validation below, fixes, re-test of what was fixed.

**Validation, each round:** agents split evenly across every page, one area each, real mouse clicks, every control and every option of every dropdown, all three modes, Cancel, Esc, double click, Back, empty and long input, both themes, narrow widths.
Judge the outcome, not that something happened: what was picked is what arrived, counts follow, nothing leaves its bounds. Check consistency of icons, colours and themes each round and propose improvements. Report design findings tied to usability and a Rail rule.

**Reviewers:** a new user, a daily user and a UX/UI reviewer against Rail, independent, unprompted, on every design round: 8.0 of 10 from each; below is revised and re-challenged; after three rounds it goes to the owner with the reason.

**Boss round before done:** every area, three independent agents, two rounds with fixes, average at least 7.5 per area, none under 7.0, no critical open, then final validation.
