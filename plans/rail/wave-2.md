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

## Open questions, to answer while shaping

- **C5:** what does a build with no conversation belong to: schedules, re-runs, PR fix runs?
- **List rows:** a progress bar, or words only?
- **Chats:** Delete and group actions: Advanced like Runs, or every level as dev does? Where does sort live?
- **Run panel:** a run from Chat opens beside the conversation today, but "a thing opens as a full page" holds everywhere else (C4).
- **The advisor:** what it reads, how sure it says it is, what happens when a start doesn't fit.
- **Old Shaping's five,** never decided; each needs asking before it comes in: PlaceRow, New run off the top bar, no title from
  1081px, a 288px sidebar, a kind icon with a state dot. Ideas only, read-only: `backup/rail-shaping-final`.
- **Parked, only if wanted:** backgrounds on Chat home and the away screen; an icon redraw.

## When

Shaping can start now; it touches nothing Wave 1 builds. Wave 2 goes to Worca only after Wave 1's Features are reviewed, since each
wrong turn there should change the standard first. Stale captures (Runs, Chat) are refreshed when their page's step 3 comes.
