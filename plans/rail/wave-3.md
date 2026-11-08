# Wave 3: everything left, redesigned with Rail

Rail grew up during Wave 2: chat leads, one store, one card shape, folds as the foot, forms in the chat, commands as
dev's, the composer in one place, motion that is calm and means something. This wave brings everything else to that
language: first Rail's own older pieces, then every dev area Rail has not reached, ordered by how often people use it.

Sources (8 Nov 2026): two read-only audits.
- **Rail against its own rules:** 65 findings across 11 places, plus a colour and contrast scan of 25 pages in both
  themes.
- **Dev against Rail:** 63 areas; 35 are not in Rail at all and 28 only in part. The pages under the W are captures, not
  redesigns.

The audit files live in the session scratchpad (`review3/`). The numbers below are the audits' own numbers: **R** is a
Rail finding, **D** is a dev area.

## What every slice follows (what Wave 1 and 2 taught)

1. **The design system leads.**
   - Every new need is a rule in `docs/rail/`, a catalog entry, a library component, a test and a gallery example.
   - A page only composes these.
   - The gate fails a page that hand-writes the library's markup.
2. **Chat leads.** Everything leads to its card in its chat. A place is a list beside the chat, never a second home for
   a thing.
3. **One store.** A thing is written once, and every surface reads it and hears it change.
4. **One card shape:**
   - Head: a kicker with its mark and one word, the title, one line, its facts, and ⋯ at the right.
   - Body, on the rail. Never a box inside a box.
   - One primary action beside quiet ones. Only one filled button on a screen.
   - One fold, as the foot.
   - Dialogs are small forms under their card.
   - A choice is a picker in a sentence: no pills, no grey buttons.
5. **One list:**
   - The list sentence.
   - The fixed sections, in date order.
   - One-line rows (mark, title, one end). Never a box per item.
6. **Each fact once, in its true state.** Names are the same everywhere.
7. **Colour means state:**
   - Amber: it waits on you.
   - Red: failed.
   - Green: done.
   - Violet: merged.
   - Ink: running.
   - Nothing else carries colour.
   - Readable text is never `--ink-3`.
   - Every state's mark meets 3:1 in both themes.
8. **Calm motion:** a fade, a breath for what needs you, and nothing that travels across the screen.
9. **Keep it simple.** Offer cuts before additions; when a page and Rail disagree, Rail's way wins, adapted.

## Phase 0: Rail's own debts (do first: everything after builds on them)

| Slice | What | Findings | Size |
|---|---|---|---|
| 0.1 Colour and contrast | One token set: running is ink everywhere (the page's live step, Pulse); no blue in Rail; one danger red (the token); state rings at 3:1 in dark; readable text never ink-3 (stage labels, times, meter, ⌘K, help lines); the Pulse badge's amber is `--amber`. Decide the StageBar rule once: finished cells quiet, only the cell it is on in its state's colour (look.md wins; components.md follows). **Plus a new gate:** a colour scan in CI that fails any computed colour outside the tokens and any state mark under 3:1. | R10, 24, 27, 28, 31–34, 39, 46–48, 50, 53 | M |
| 0.2 One card language | One filled button held for every card, task cards included, and a resolved card loses its fill. No box inside a card: `.rc-card` becomes the body on the rail, with separators where needed. Actions always under the body. Kicker marks by kind (a schedule's clock). One state, one word (Running/Working). Danger is the quiet red everywhere. The attention breath takes the state's colour (failed red, ready green) and is never a filled panel. The composer is radius 8. Worca's pick matches the preset answer. No filler lines, no head restated. Commands on the text edge. | R1–9, 11–14, 16, 18 | M |
| 0.3 The task page is the card's stream | One stage display (the StageBar), the card's head on the page, the page's content from the task (no shared fixture), one ⋯ style, the eye moved into ⋯, the trail in the top bar, Changes once, nothing dropped on a phone. | R15, 29, 30, 35–40 | L |
| 0.4 Lists, bar and search | Fixed section words (no Upcoming/Paused as their own words), one-line rows (RoundRows folded into the row's end), no branch before Build, Schedules gets the full sentence, Recent one line, one highlighted place, search keeps state colours and lists a thing once, one name per task. | R19–23, 25, 51, 52, 54–56 | M |
| 0.5 A schedule's page is a conversation | Its runs as cards on the rail with the timeline, the state word as Headline, the reword bug fixed, outputs on the text edge. | R41–44 | L |
| 0.6 Pulse in Rail's marks | Vitals and Updates rows built on the library row with KindMarks (no dots), unread as the row's weight, not a blue dot; one head action (⋯). | R45–49 | M |
| 0.7 Settings | The background stops at the rail as it does in Chat; records use ListRow and KindMark (no loose dots; signed in is not green); the end column lines up; no repeated section icons; task, not run; `settings.md` rewritten for the one bar. | R57–62 | M |
| 0.8 Phone | The composer's sentence stacks on one edge, each word with its picker; the meter stays whole; stage parts keep their facts. | R40, 65 | S |

## Phase 1: the daily loop (dev areas people use every day)

| Slice | What | Areas | Size |
|---|---|---|---|
| 1.1 Starting a task, at dev's full depth | Dev's full New run form becomes the composer and its proposal: which fields survive (workflow, sources, branches, per-agent settings, loops, sets, PR automation, presets) and where (sentence, Customise, ⋯). The schedule sheet's fields (once, repeat, window, time zone, policies) become the schedule proposal's Customise. | D16, 17 | L |
| 1.2 The conversation, complete | The chat-cards list's next pass: Shaper's route card and requirements step, form widgets for questions, workflow proposal at parity, the four settings proposals, ref chips in answers, task card facts (cost, elapsed, agents, files, artifacts), Chat home's run tiles and promos. | D10–12; chat-cards.md › Next pass | L |
| 1.3 Ask worca beside any page | The side column's home: page chips, suggestions, recent chats; the same conversation and composer. | D13 | M |
| 1.4 Pinpoint | Select text in an answer, a diff or an artifact and act on it (Copy, Explain, Ask, Disagree): one small library popover. | D15 | M |
| 1.5 Schedules' Activity | What schedules did, as the schedule's own conversation (0.5), so no separate feed. | D18 | S |

## Phase 2: the task page's leftovers

Artifacts and their viewers, the live workflow graph with its step log, telemetry (Labs), ask forms (the widgets from
1.2), applying a folder task, Results as the Overview's outcome, and syntax highlighting in diffs. **D20–26**, M.

## Phase 3: building blocks (weekly for builders)

| Slice | What | Areas | Size |
|---|---|---|---|
| 3.1 Projects | A list in the one bar (the list sentence and rows); a project's page as tabs on Rail's page shape (Overview, Team, Memory, Settings, Actions, Automations); Add project as the chat's change card at dev's depth (New, Folder, Clone, browse). | D37–39, 43, 44 | L |
| 3.2 Workflows | The Library as a list in the one bar; the canvas in Rail's look (nodes as KindMarks, no boxes per node beyond the graph's own); building in chat (already); save, agent editor, export as forms. | D27–31, 33 | L |
| 3.3 Requirements and the Shaper feature page | Requirements as a list and a page of rows by perspective; the Shaper feature page as the feature card's own page (slices, checklist, ship). | D34–36 | L |

## Phase 4: store, insight and settings' leftovers

| Slice | What | Areas | Size |
|---|---|---|---|
| 4.1 Marketplace | A list (no card per plugin), the plugin's page and its install as a form; installed plugins already in Settings. | D45–47 | M |
| 4.2 Insight | Statistics, the cost report and team metrics as one Insight place: numbers said in sentences, one chart per question, the list sentence for ranges (no pill filters, no stat-tile boxes). | D54–56, 51 | L |
| 4.3 Settings' leftovers | Model editor and import, the manual server form, the model bridge, spawn diagnostics, machine load and sync before run. | D48–50, 52, 53 | M |

## Phase 5: rare, specialist and edges

Workspaces with the map and the create flow (D40–42), Actions and the running-actions tile with the terminal pane as the
command pattern (D1, 43, 60), scripts, the agent editor, C4 and the code editor (D31, 32, 61, 62), onboarding (D19, 57,
58), the shell's small edges (D2–9), and outside the app the browser extension and the docs site (D63, 64).

## Enhancements to weigh (step 2.1)

1. **Onboarding is a first chat.** Worca greets you, signs Claude in as a change card, and proposes your first task. It
   replaces the tiles and the spotlight tour.
2. **A project's page leads with its chats and tasks** (by date). Its settings sit behind its ⋯ and tabs, so the project
   page is useful daily, not only at setup.
3. **One "something is running" pattern** (CommandRow) for commands, Actions, the terminal and the running-actions tile.
4. **Insight answers questions.** "How did we do this week?" in chat answers with a small Insight card, and the Insight
   place is the same cards together, not a dashboard.
5. **The colour and contrast gate** (0.1) keeps Rail honest after this wave.
6. **Every place is a list beside the chat, in the one bar**: Projects, Workflows, Requirements and Marketplace each get
   the list sentence and rows, so learning one list teaches all of them.

## Validation (step 4, each phase)

- **The usual gates:** the design-system tests, the gate, the sweep with a step per new flow, the design-system check,
  both click-throughs, and the full suite.
- **The new colour and contrast gate (0.1)**, in both themes.
- **User agents after each phase:** a daily user and a newcomer, read-only, scoring every task. The aim is everything at
  8 or above. What scores under 8 goes back into the phase.
- **One store checks:** every surface agrees after each action, for each new place that holds things.

## Open decisions (for Emil, batched)

1. **StageBar colour:** finished cells quiet and only the cell it is on coloured (look.md), or every finished cell in the
   state's colour (components.md)? I recommend look.md.
2. **The enhancements above:** take all, some, or none.
3. **Order:** Phase 0 first and whole, then 1, 2, 3, 4, 5? Or interleave the daily dev areas (1.1, 1.2) with Phase 0?
