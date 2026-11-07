# Worca Rail: Wave 2, the game plan

**Shaping, not decided.** Written 7 Nov 2026 on `docs/rail-shaping`. It says what gets shaped, in what order and how. Nothing
here is a design: a design is what ends up in the prototype. `waves.md` holds how every wave works; `plans/rail/agreed/` holds
what is already decided.

## How the branches work

| Branch | Holds | Moves when |
|---|---|---|
| `docs/rail-shaping` (this one, local) | Ideas being shaped: changed prototype pages, proposed rules marked, every option's mock | Every shape |
| `docs/rail-agreed` | Decided work, frozen while Wave 1 is dispatched from it | An idea here is decided; a real bug in what Wave 1 builds |
| `dev` | Built and merged work | A Feature's PRs land |

- Shaping is cut from Agreed and keeps its design system: start from what exists, adapt it, and say when a decided rule changes.
- **Agreed moves into Shaping by merge, never rebase.** Each lesson from Wave 1 lands in Agreed first, then merges here.
- Decided work moves to Agreed together: page, rule, catalog entry, component, test, gallery example, deciding mock.
- Git is the source. Shaping's pages are generated from this branch by `tools/rail-artifact.mjs` and `tools/rail-prototype-page.mjs`.

## What Wave 2 holds

The daily loop, shaped toward Wave 6 so it isn't redesigned twice (`waves.md`).

| # | Page or piece | Starts from | State |
|---|---|---|---|
| 1 | Runs list | The reference build in the prototype, `lists-index.md` | C3 decided; the rest to shape |
| 2 | Chats column | The reference build, `lists-index.md` | To shape |
| 3 | New run | Today's capture and the prototype's dialog | To shape; the Form pattern |
| 4 | Task estimation advisor | `waves.md`, shaped together with New run | An idea |
| 5 | Chat home | Today's capture | C1 decided |
| 6 | A build in a conversation | The run card in the prototype | C2 decided |
| 7 | Answering a build's question | The OptionList | C6 decided |
| 8 | Where a build opens | The trail and navigation rules | C4 decided |
| 9 | Ask worca's side column | The column in the shell, today's capture inside | To shape |

## The order

1. **Runs list and Chats column.** The most is already built, and they settle the shared list. Whatever they teach the row, the
   sentence and selection reaches every later page.
2. **New run and the advisor.** One form, one sentence; the advisor needs New run's shape, and its figures need the run card.
3. **Chat home, then the conversation:** the build card, its question, where a build opens.
4. **Ask worca's column,** which is that conversation in a narrower place.

## Each page, in steps

From `waves.md`, with what Agreed taught:

1. **The list.** What the page does in dev: functions, states, actions, levels, each with its file. `lists-index.md` is the model.
2. **What it is for.** One sentence, who uses it and how often, its states, what it drops.
3. **A fresh capture,** then **the open choices as mocks,** until the person decides.
4. **Into the prototype,** from the library alone. What the library lacks goes into it first.
5. **The audit by looking:** open every control and judge it as a person would. Fix what it finds.
6. **The gates** read the page by themselves; its key cases join `compare-pages.json` when it is built in the app.
7. **Move to Agreed,** then one Feature per page to Worca's Shaper, behind the `rail` flag.

## Shaped so far (7 Nov), in mocks

Mocks: `mocks/wave-2/` (`node plans/rail/mocks/wave-2/render.mjs`). These are directions Emil chose; none is built, and each still moves to Agreed with its page, rule, catalog entry, component and test.

| Direction | Mock |
|---|---|
| **One bar for every feature**, Settings' behaviour: head, what it shows, list, you. The house opens the places. The Chats column goes | 1 |
| **Chat dispatches everything.** Tasks and schedules are cards in a conversation and a rounded dependency tree in the bar. Tasks and Schedules as places are Expert, listed with the others under Places | 2 |
| **Builds become tasks** in every word a person reads. Substages can no longer be called tasks | all |
| **The icon carries type, state and progress:** one smooth ring, the usage ring's look, filling by main stage and deepening into the state colour; substages in the tooltip. The card's step bar keeps its stages, in the same colours. A question, a problem, a pause or a stop takes the icon's centre | 3, 10 |
| **Watch:** git's icon itself pulses while it fixes, twice as fast as the mark; while it waits, its tooltip says so. The eye on its switch, the refresh arrow on a round | built |
| **Appearance** is a submenu of the profile menu: theme and background. **Tooltips** are the library's, on hover, focus and long-press | built |
| **A row's end holds one thing:** git's own icon if it has one, otherwise the time; the rest in the tooltip | 2, 3 |
| Views stay: by state, day (Today, Yesterday, Previous 7 days, Previous 30 days, Older), project, AI topic with its helper named. Your groups, selecting and keys stay | 3 |
| **One search at the top,** results under an area head. Lean icons on Settings' sections and sub-sections, one new set | 4 |
| **Backgrounds:** Dots by default, one family with Aurora dots, Dusk dots, Mist. Chat home and away only | 5 |
| **The conversation on one rail;** thinking and commands fold, a failure opens itself | 6 |
| **No New run button or dialog:** the composer says Ask, Task or Schedule, you pick it, and every New run function has a place | 7 |
| **A task or a schedule opens like a chat:** a reading column, marks, a composer that goes to its chat. Pulse stays | 8 |
| **Anchors are a timeline:** the whole chat as a strip on the right edge, each tick where its moment is, the band showing what is on screen. Hover a tick to see what is there; `[` and `]` step between them | 9 |
| Chat home's line always names Worca: "What's next for Worca?" | 5 |
| **Every feature sits under the house:** inside Chat, everything is about Chat. No row of places in the bar | 1, 12 |
| **Asking about a task or schedule with no chat** starts a new chat and links it | 8 |
| **Status words:** all 19 stay. The icon breathes while work happens: dot and icon merge, so no dot sits beside an icon | 10 |
| **Every kind of row** has one shape: chats by kind and channel, chains, features, watched tasks and rounds, schedules, events; bold is unread. Cost never shows in the bar: it stays on cards and pages | 11 |
| **Touch:** a long-press shows a tooltip; anchors open from a list button | to mock |
| **The empty, loading, offline and failed bar** say it in one line, from `listState` | 11 |
| **Places by mode** come from today's levels, with Tasks and Schedules moved to Expert | 12 |
| **Rename everywhere:** runs and builds become tasks. The screen moves with Wave 2; docs, CLI, API and settings keys rename at the final stage (Wave 5) | all |

Decided rules these change: C1 (Chat home's list moves to the bar), C3 (Expert only), "no drawn rails" (the tree), the quiet grey finished step, `thing.slots` (stages read as a stream), `form.dialog` (New run), the conversation's rail, "the sidebar holds places".

## Open questions, to answer while shaping

- **C5:** what does a build with no conversation belong to: schedules, re-runs, PR fix runs?
- **List rows:** a progress bar, or words only?
- **Chats:** Delete and group actions: Advanced like Runs, or every level as dev does? Where does sort live?
- **Run panel:** a run from Chat opens beside the conversation today, but "a thing opens as a full page" holds everywhere else (C4).
- **The advisor:** what it reads, how sure it says it is, what happens when a start doesn't fit.
- **Old Shaping's five,** never decided; each needs asking before it comes in (New run off the top bar is now mock 7): PlaceRow, no title from
  1081px, a 288px sidebar, a kind icon with a state dot. Ideas only, read-only: `backup/rail-shaping-final`.
- **Shared sign-ins:** whose task a row is. Not today's problem; the list's `started by` stays.
- **Parked, only if wanted:** backgrounds on Chat home and the away screen; an icon redraw.

## When

Shaping can start now; it touches nothing Wave 1 builds. Wave 2 goes to Worca only after Wave 1's Features are reviewed, since each
wrong turn there should change the standard first. Stale captures (Runs, Chat) are refreshed when their page's step 3 comes.
