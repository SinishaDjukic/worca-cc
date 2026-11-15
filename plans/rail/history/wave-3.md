History. Superseded by implementation-prompt.md; do not build from it.

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
11. **Functions from dev, never its design** (Emil, 8 Nov): a slice lists what dev's feature *does* (actions, fields,
    states, rules) and builds that on Rail's design. Dev's dialogs, boxes, tabs, pills and page shapes stay behind, so
    the old design's principles never come back. "Dev's full form" below means its functions, designed fresh in Rail.
10. **Ease of use first** (Emil, 8 Nov): every slice is judged by how easy and how simple it is for a person, then by Rail;
    the two personas score it, and under 8 it goes back.

## The order, after two users challenged the plan (8 Nov)

A daily user and a newcomer each read this plan beside the prototype (`review3/challenge-daily.md`, `challenge-new.md`).
Both said: **interleave** — a person moves to Rail when the daily loop works, not when the polish is done — and **no
dead ends first**: in the mode a newcomer gets (Simple), only Chat works of the nine places, Workflows hides the shell and
Projects is blank. So the order is:

1. **0.0 No dead ends** (new): every place under the W draws something true in every mode (a locked place says what it
   needs and offers its one way on, `nav.locked`); Workflows keeps the bar and the top bar; nothing blank. R63.
2. **1.0 The first minutes** (moved up): onboarding as a first chat ("Getting started", an ordinary chat in the bar), Add
   project as its change card at dev's depth (New, Folder, Clone), working before Claude is signed in. D19, 39, 57.
3. **0.1 Colour and contrast** (done, with the colour gate).
4. **0.2 One card language**, **0.3 the task page as the card's stream**.
5. **1.1 Starting a task at dev's depth** and **1.2 the conversation, complete**, now also holding what the daily user
   found missing: the chat run panel (D14), whether Worca watches a PR (shown on the card, not only in ⋯), the failure's
   reason on the card (the failing tests' names), one name per action (Restart Build, not also Try again), Tasks rows
   saying what a running task does, `?` opening the shortcuts sheet (D3), syntax highlighting in diffs (D26), and the
   server-unreachable and session notices (D6, D7).
6. **0.4 Lists, bar and search**, extended: the places findable (the switcher visible, its name steady), a list you chose
   stays when you open a task from it, In view explained (its tooltip and first use), Today in time order.
7. **Phase 2** (the task page's leftovers) with **the terminal moved up**: Resolve in a terminal needs it (D60, with
   Actions' command pattern, D43, D1).
8. **0.5** shrinks: a schedule's runs as rows that lead to their cards (not a whole conversation). **0.6, 0.7, 0.8.**
9. **Phases 3, 4, 5** as below. **1.3 Ask worca beside any page** and **1.4 Pinpoint** move to Phase 4: there are already
   three ways to ask. The Away screensaver is cut.

Also from the challenges: the audit findings R17 (done), R26 (a home's composer names what will happen: Start task;
Customise under the words, as on the proposal) and R64 (Marketplace, Statistics, Team metrics captured → 4.1, 4.2) are
named; Actions (D43) and the agent editor (D31) live in one phase each (3.1 and 3.2); the newcomer agent runs in the
default mode on an empty store, the daily one in Expert on the seeded store.

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
| 4.2 Insights | **One place, Insights** (Emil, 8 Nov), replacing Statistics, the cost report and Team metrics with no overlap: one sentence picks what you look at ("Showing **cost** of **all projects** by **label**, **this month**") instead of three pages that repeat the same numbers. Two parts under it: **Yours** (your tasks: how many, how they went, what they cost, what they saved) and **Team** (Advanced/Expert, with team policy: throughput, cost by person, the work items on a calendar). Numbers are said in sentences, one chart per question, the list sentence for ranges (no pill filters, no stat-tile boxes). | D54–56, 51 | L |
| 4.3 Settings' leftovers | Model editor and import, the manual server form, the model bridge, spawn diagnostics, machine load and sync before run. | D48–50, 52, 53 | M |

**Labels and tags, and Insights (proposal for Emil):** labels (on chats and tasks) and cost tags are how you *organise*
work, not something you look at; they are kept and edited where you organise (a task's or chat's Label…, and Settings ›
Labels for the list of them), and Insights *reads* them as one of its "by" choices (by label, by tag). So they are not a
third part of Insights. One question for Emil: merge labels and cost tags into one thing ("labels"), since a person
rarely knows the difference? Recommended: yes, one word, one list, in Settings.

## Phase 5: rare, specialist and edges

Workspaces with the map and the create flow (D40–42), Actions and the running-actions tile with the terminal pane as the
command pattern (D1, 43, 60), scripts, the agent editor, C4 and the code editor (D31, 32, 61, 62), onboarding (D19, 57,
58), the shell's small edges (D2–9), and outside the app the browser extension and the docs site (D63, 64).

## Enhancements to weigh (step 2.1)

1. **Onboarding is a first chat.** Worca greets you, signs Claude in as a change card, and proposes your first task. It
   replaces the tiles and the spotlight tour.
2. ~~A project's page leads with its chats and tasks~~ → **a project filter on the Chat and Tasks lists** (both users: a
   second home for things breaks "everything to its card").
3. **One "something is running" pattern** (CommandRow) for commands, Actions, the terminal and the running-actions tile.
4. **Insight answers questions** (deferred: on top of the cost report, never instead of it). "How did we do this week?" in
   chat answers with a small Insight card.
5. ~~The colour and contrast gate~~: it is 0.1's, done (`colour-check`).
6. **Every place is a list beside the chat, in the one bar**: Projects, Workflows, Requirements and Marketplace each get
   the list sentence and rows, so learning one list teaches all of them.

## Validation (step 4, each phase)

- **The usual gates:** the design-system tests, the gate, the sweep with a step per new flow, the design-system check,
  both click-throughs, and the full suite.
- **The new colour and contrast gate (0.1)**, in both themes.
- **Two personas in every challenge and every evaluation:** a daily user (Expert, the seeded store) and a **new user** (the default mode, an empty store, never told how it works). Read-only, scoring every task. The aim is everything at
  8 or above. What scores under 8 goes back into the phase.
- **One store checks:** every surface agrees after each action, for each new place that holds things.

## Open decisions (for Emil, batched)

1. **StageBar colour:** finished cells quiet and only the cell it is on coloured (look.md), or every finished cell in the
   state's colour (components.md)? I recommend look.md.
2. **The enhancements above:** take all, some, or none.
3. **Order:** Phase 0 first and whole, then 1, 2, 3, 4, 5? Or interleave the daily dev areas (1.1, 1.2) with Phase 0?

## Decided (8 Nov, Emil: "as per you")

- The order: the challengers' (0.0 and 1.0 first, interleaved).
- StageBar: finished stages quiet, only the stage it is on in its state's colour (look.md); components.md follows.
- Simple mode: Tasks shows in Simple, Schedules from Advanced; a locked place always says what it needs and its way on.
- Names: Vitals → **Now**, Track a task → **Follow a task**, Review gate → **Waits for your OK**.

## Progress (8 Nov, autonomous run while Emil is away)

Built, each through every gate (sweep, DS check, the new colour gate, both click-throughs) and the full suite:
- 0.0 no dead ends · 1.0 the first minutes (Getting started, Add project at dev's functions) · 0.1 colour and the colour
  gate · 0.2 one card language · 0.3 the task page reads as its card · 0.8 the phone composer.
- 1.1 dev's New run functions as Rail rows (PR, watch, review rounds, tools, a schedule's rules, Save as preset).
- 1.2 in part: a decision's reason on its card, Show its stages from the task itself, one name per action and task,
  schedules in Pulse, one fill while a confirm asks.
- 0.4 in part: newest first in a day, menus that show whole choices, no project chosen for you.

Persona round (before the last fixes): new user 5.9, daily user 6.1. Next: a fresh round on this build, then 1.2's
remaining cards (route, requirements step, form questions, workflow at parity), 0.4–0.7, and Phases 2–5.

Round 5 (daily 6.0, new user 6.1), fixed in this pass:
- A slice's Show its stages works; a step on the full page keeps its task (name, branch, what was asked).
- The full page says what this task was asked and what broke in it, the same lines as its card; the Node 24 task fails
  for Node 24 reasons.
- Simple shows only the places it has (the mode was read after the menu drew); a schedule you made opens in any mode.
- A task's name is a whole clause ("Add a GET /health endpoint"), never cut mid-phrase; the brief keeps every word.
- A schedule takes the time you wrote ("at 1am" → 01:00) and its name without the when; pausing it reaches Pulse.
- The reply to what you sent comes into view (its Start is never under Latest); notices come in at the top.
- Words: Sign in to Claude Code; Restart Build's tip; "Worca watches its PR", gone once merged; Settings opens on General
  in Simple; a new chat starts on the project you added last; the composer keeps "on" when a starter is armed;
  Shaper's requirements step and the route card; Artifacts without old colours.

Still open from round 5 (next pass):
- The full page's mock facts (cost, time, plan, activity) still come from its case's sample; the card is the truth.
  Retire the page into the card (its functions as card rows) rather than patch the sample.
- The card's ⋯ and the page's ⋯ offer different actions: one list, from the library.
- Appearance: unlabelled theme and background swatches; Settings has no Appearance section and no way back but the menu.

Since: while a confirm asks, its row holds the one button (no second Merge PR); the row you are on never folds behind
Show N more (`list.fold-keeps-current`, in the sweep); a failed card's ⋯ leads with Ask Worca to fix it (a follow-up
with what failed already written) and Show the log; the first screen says "What's next?" and, until you have signed in,
points to Getting started; a follow-up's box is the card's width.

Wave 3, second run (8 Nov, "continue with the rest"):
- 0.5 a schedule's runs as the chat's task cards; 0.6 Pulse rows on the sidebar's marks, unread as weight; 0.7 Settings
  without section icons or loose dots, one end edge.
- Attention (Emil): a mark keeps its type; needing you is colour and a slow, soft breath, never ? or !; in a bar the whole
  row (its mark and name) breathes until you open it; in a chat the whole card fades in and out. Rules: list.kind-mark,
  motion.attention.
- One way for a place to give the shell its bar list and page (RailPlaces); PlaceHead and BarChart in the library.
- 3.1 Projects, 3.2 Workflows (agents and scripts in the same list), 3.3 Requirements, 4.1 Marketplace, 4.2 Insights (one
  place for Statistics, the cost report and Team metrics: questions in the bar, one sentence of pickers, one chart, a
  breakdown; labels and cost tags are what "by" reads), Phase 5 Workspaces.
- Still to do: 1.2's rest, 1.3–1.5, Phase 2 (artifact viewers, the live graph), 4.3 Settings' leftovers, Phase 5's rest
  (Actions, scripts' editor, onboarding, edges), and a persona round on the new places.

- Built from the approved mocks: the chat cards (question forms, a workflow at dev's depth, a setting, the facts line), Ask
  beside any page (⌘J), and task depth on the card (panel.task-depth): each stage's time, cycles and cost, the one running
  now; a stage's Log (LogLines, its filters a sentence: summaries or raw, cycle, agent; First error, Copy, Follow live) and
  Artifacts (ArtifactView in place, Previous and Next, Open full, Download); findings to confirm with notes and Send to
  Review; a task made on a copy of a folder ends in a change card: Apply, Show the diff, Discard. Phase 2's artifact
  viewers and live graph are these.

Next (Emil, 8 Nov), after the approved builds (chat cards, Ask beside a page, task depth, ⌘J): the second pass on
Workflows, Projects and Workspaces, and a heavy one on **Insights**, through the loop (mock, both users, Emil, build).
Insights is one feature in the places menu; its bar holds the sub-features in groups, lean and smooth, every metric dev
already records and nothing invented:
- Cost: spend, cost per task (middle, slowest tenth), by model, chat and requirements spend, budget pace.
- Value: time saved, value against spend.
- Quality: how tasks end, review cycles, the stage that fails most, autonomy (how often you stepped in), cache use.
- Flow: shipped PRs, start to merge, throughput, time waiting on you.
- Team (Expert): the same by person, missing cost tags, the work items on a calendar.
Each sub-feature: one sentence answer, one chart, one "by" picker, its breakdown as rows; no tiles; the one search finds it.
Insights' cost dimensions (Emil, 8 Nov: "we need all possible dimensions because costs are super important for the AI"):
every dimension dev records is a "by" (and a filter), offered only when it has data, one level deeper when asked:
where (project, workspace, branch, ticket, PR) · what did the work (workflow, stage, step and agent role, sub-agents) ·
what it ran on (model, engine or provider, effort, cache read vs write, tokens in and out) · why it cost (review cycles,
retries, fix rounds: rework; failed or stopped tasks: waste) · who and how (person, chat vs task vs scheduled vs
requirements, Away vs at the desk) · how you organise (each cost tag key, labels) · when (hour, day, week, month, time of
day). Each row leads to the tasks behind it.

## Second pass: purpose first (Emil, 8 Nov: "understand the purpose … at some point fully integrated into chat … like tasks and schedules, more supporting")

The pattern Tasks and Schedules already follow: born in a chat, a card there, a row under its chat in the bar, a page only
for depth. The three places measured against it:

| Place | What it is for (dev) | Where it already touches Chat | Adapted: supporting, not a destination |
|---|---|---|---|
| Projects | Where the work happens (a repository or a folder) and its defaults: branch, workflow, models, limits; its state (diverged, folder missing) | The composer's "on billing-api"; Add project is a chat card; a chat belongs to one | A scope above chats: the bar's "from" and "by project" group chats under it; its page shrinks to its settings; its state (diverged, missing) comes to the chat that runs on it as a card |
| Workflows | How a task runs: steps, agents, models, effort, loops, and what that costs | The task sentence's "with Default"; a proposed workflow is a change card (built) | Recipes picked in the sentence and made or changed in a chat; the place stays a library to browse and compare, each workflow with its cost and outcomes from Insights; agents and scripts are its parts |
| Workspaces | Several projects that work together, and the map of how they depend (APIs, messages, packages, tables) given to every agent as context; change order providers first | None yet beyond New workspace as a chat | A wider scope: "on Billing (3 projects)" in the same picker as a project; a task across them splits into slices per project (slices exist); the map's unconfirmed links come as questions in a chat; the page keeps the map |

Questions to settle before mocks:
1. Is a workspace a project made of projects, so one scope picker and one bar group ("on billing-api" or "on Billing")?
2. Do Workflows, agents and scripts stay a place in the menu, or join a "Customise" home with the Marketplace?
3. (Decided below: one Projects entry.) Do Projects and Workspaces keep menu entries, or are they reached from the bar's groups, the scope picker and search?

Direction (Emil, 8 Nov): everything is defined in a chat; the places are views.
- Workflows, agents and scripts are browsed as the Marketplace is (ways in with counts, cards, yours first); opening one
  leads to Change it in a chat; Build it by hand is the one manual way in, quiet, never the lead.
- Tasks and Schedules pages show what a chat defined; nothing is made or edited there. Agreed: what exists stays
  controllable on its page (Pause, Run now, Stop, Approve); defining moves to the chat, a gradual, smooth transition.
- Mock: plans/rail/mocks/wave-3/workflows-2: explore as the Marketplace; one opened as a view with its graph and what each
  step does in plain words; Build it by hand is the classic way, on the graph (Emil: keep the graph, keep the explanation).
  Proposed for the library: WorkflowGraph's flow variant (left to right, arrows, the loop drawn back), on the page, not only in a dialog.
- Decided (rail.chat-first): Projects' and Workspaces' settings are shown and changed in place by hand, or in a chat.

Graph editor (Emil, 8 Nov: a hard requirement; resistance welcome, it is very complex). Dev's is a free canvas: agents and
scripts from the Library, Task, End, AND, OR, Combine, typed ports and wires with checks, the inspector (model, effort,
sub-agents, sessions, script inputs, timeout), auto-layout, zoom, Import, Export, Save, and a chat dock whose cards change
the canvas; the chat's proposals draw with the same renderer. About 15,000 lines, 138 test files. Tried in a mock
(graph-try, graph-mock.mjs bundles dev's view.mjs): it already draws in Rail's tokens with no change. The resistance:
1. Keep the engine as it is; Rail is a skin (tokens, the inspector as sentences, the dock as Ask beside the page). A
   rewrite would cost months and its 138 test files.
2. It speaks engineering (ports typed md, await any, on blocking, model ids): a plain layer, ports shown only while you
   wire, a model's name and effort in words.
3. Hand-building is Expert (docs/ui-levels.md); Simple sees the view and Change it in a chat. A wide screen only; a
   narrow one reads What each step does.
4. The view draws fitted on its auto layout; the wrapped flow layout crosses its wires (seen in graph-try).
Agreed (Emil, 8 Nov): the graph editor is kept for Expert (advanced) mode, and everything stays backwards compatible: one
workflow format for a chat, the canvas and Import/Export, every saved and built-in workflow opens and runs as it does today,
and the engine and its tests are kept, with Rail as its skin.
5. Auto-align (Emil, 8 Nov) stays: dev's Auto-layout tidies the canvas in one click; in Rail it is one quiet button
   beside zoom, and the view always opens aligned.

Selling point (Emil, 8 Nov): workflows and the graph sell Worca. The graph is shown large to everyone (a workflow's page,
a chat's proposal, a task card), drawn by dev's renderer in Rail's skin; only editing by hand is Expert. Mock workflows-2
redone: frame 2 on dev's renderer (wider than the reading column, plain words), frame 3 the Expert canvas (Add as a menu
in words, Auto-align beside zoom, the picked step as sentences on the right, Ask Worca as the one chat).

Personas on workflows-2 (8 Nov). New user: browse 7, opened 5, editor 4. Daily user: 6, 7, 5. Taken:
- Cards keep cost, time, merged; provenance and "Tasks that used it" cut; "Ready" cut; one set of step names everywhere.
- The loop in words on the graph ("sends fixes back, up to 2×"); port types and await rows hidden on the view.
- Editor: Undo, Redo, Import and Export in its head; the Library a list to drag from; Add closed; session and sub-agents
  under More settings; a script step's inputs and a picked wire (what it carries, when, Delete) in the right panel; what
  Ask Worca proposes shows on the graph to Apply or Undo; Edit by hand beside Change it in a chat for Expert.
Open:
- The daily user wants a step's model and effort editable on the view (conflicts with: pages are views, defined in a chat).
- The new user reads the view's wiring as an engineer's diagram: a plain view mode in the renderer (a step's name, model
  and one line, wires without port labels) is real work in view.mjs; the mock only hides words.

Decided (Emil, 8 Nov):
- A step's model and effort change in place on a workflow's page: a manual edit, no conflict with defining in a chat.
  From Advanced (per-agent model and effort is Advanced, docs/ui-levels.md); Simple reads them.
- Simple draws a workflow plainly (its steps left to right, the loop drawn back in words); Advanced and Expert show the
  real graph by default and keep the plain drawing one pick away (Showing the graph / the steps), since raising the mode
  never removes anything. Edit by hand is Expert.
- Told as a storyboard (Emil: be more creative): a panel a step (what happens to your task there, its time and cost),
  the loop drawn back under the two it joins, then How a task goes through it (straight through, the check finds
  something, still unsafe after two fixes) from its last tasks; Simple's drawing is the storyboard. Proposed library
  piece: WorkflowStory.
- Every workflow reads first in plain words (Emil, 8 Nov): a small helper model (Haiku 5.5) writes a few sentences from
  the workflow, once and again when it changes; shown above the drawing in every mode, said to be by Haiku.
- The storyboard is crafted with a simple animation (Emil, 8 Nov; no Haiku wording in it): each step's ring draws, its name
  and words fade in, its time and cost follow; the loop draws back; the ways a task goes settle one by one. Ease-out, no
  bounce, all at once with reduced motion. Mock: mocks/wave-3/story-craft.html; GIFs generated/story-craft-{light,dark}.gif.
- Crafting in the library (Emil, 8 Nov: a generic animation while Worca makes something): motion.crafting, Crafting
  (crafting.mjs; a workflow, an image, a document), its test, catalog entry and gallery; mocks/wave-3/crafting.html.

Built (8 Nov): Workflows from the agreed mock: ways in with counts, cards, WorkflowStory, dev's real graph from Advanced (bundled to graph.js; Rail's skin .gv-skin), model and effort in place, the Expert canvas (the bar becomes the Library, Auto-align is dev's auto-layout, Undo, Redo, Import, Export), Crafting in a chat. Personas on the build: new user 6, 8, 4; daily user 7, 6, 7; their fixes are in.
Drafts (Emil, 8 Nov: a philosophy for everything the user edits): rail.drafts, DraftBar; workflows and agents have them, scripts when their editor exists.
The stage bar is one line (Emil chose A of mocks/wave-3/stage-line): look.stage-line; an open toggle draws a gentle line: panel.open-line. Ideas offered, not decided: the line as the toggle (click a stage opens it), hover a stage for its time and cost.

Folds move (Emil, 8 Nov): motion.fold, watchFolds in the library: every toggle with aria-expanded fades its part as the space opens or closes, the chevron turns; pages do nothing, date sections keep their own (list.fold-motion).

Projects and Workspaces (Emil, 8 Nov): a workspace is organizational: a named set of projects and the map of how they connect. Dev also runs tasks on one (a workspace run, the chat's scope), so that stays, from Advanced, for backward compatibility. Menu, from the code: one entry, Projects; its bar holds Needs you, Projects and (Advanced) Workspaces as rows of their own, never nested: workspace_projects lets a project be in several workspaces, and a member can be a folder that is not a registered project. Workflows and the Marketplace stay separate. Mock: mocks/wave-3/scope; personas before the changes: new user 7, 6, 5; daily user 7, 7, 6. Left for the build: type-ahead in a long picker, Sync's preview.

Two ideas mocked at Emil's yes (mocks/wave-3/scope-2): a workspace comes from use (Worca suggests it when a task touches projects that look connected); from Advanced the Projects home is one map, a workspace an outline around a part of it, a project in two where they overlap. Its limit: only links inside scanned workspaces are known. A project and a workspace read the same: needs you, how it stands, what is on it, settings.

The concept (Emil, 8 Nov, in his words): all these features are embedded in the chat, and users keep the option to perform them manually, as is for the workflows. Chat first, manual second, for Workflows, agents, scripts, Projects, Workspaces and the like: a page ends with the composer, Change it in a chat leads, the manual way is there and quiet. Tasks and Schedules are different: their pages only reference what was dispatched, for legacy, and nothing can be created from them.

Personas on the map (8 Nov; new user 8, 5, 5, 8; daily user 8, 5, 7, 8): overlapping outlines do not scale. The home is now each workspace one box (a count and only what is wrong or running, a line between boxes for a shared project); a box opens in place with arrows for who calls whom; a shared project says also in X; healthy says nothing. The bar from Advanced: Needs you, Workspaces, All projects folded.

Built (8 Nov): Projects and Workspaces as one place. One Projects entry (old workspaces links land on projects/ws:<id>); Simple the list; from Advanced each workspace a box, one opened alone as its map (WorkspaceBoxes, WorkspaceMap, workspaceOrder; panel.workspace-map), questions first with their evidence, Scan again beside the map's age; by hand second and quiet (Add a project by hand, New workspace by hand, Edit by hand as a draft); one scope picker in the composer with each project's state; Worca raises git trouble and suggests keeping two projects together, one card at a time. Personas on the build: new user 5, 7, 6, 6; daily user 6, 6, 8 (home, workspace, chat); their fixes are in, the neighbouring boxes cut from an opened workspace. Differs from the mock: a shared project is said in words on its box, no drawn line between boxes. Not in the prototype: real drag into a workspace, type-ahead in a long picker, Sync's preview, a question on its map edge. rail.chat-first is the written rule. Scripts have their own icon (`script`, code), sliders mean settings.

Default labels and cost tags (Emil, 8 Nov): set per workspace and per project; every new task there gets them (the workspace's and the project's), and a task can change its own. New: dev has labels (run_labels) and cost tags (tag dimensions), no defaults. They stay two things, which closes the labels and cost tags merge question; a default tag feeds cost by tag in Insights.
Projects sidebar re-organized at Emil's word (messy; how to create a workspace; what belongs where): mocks/wave-3/scope-3: A a tree, workspace over its projects; B ways in; C the tree with a by.
Personas on the sidebar (A, B, C): new user 8, 4, 6; daily user 6, 5, 7. Iterated: healthy workspaces fold, a folded one shows its worst state, a project in two is under both, one + menu (Ask in chat, By hand), Out of sync; labels add up, a cost tag has one value (the project's own wins; if two workspaces differ the composer asks; never counted twice). Awaiting Emil: A or C; whether the home keeps the boxes now that the tree says the same.

Insights mocked (mocks/wave-3/insights-2). Personas: new user 7, 8, 7, 4; daily user 7, 8, 7, 5. Taken: the worth in the headline (saved, what it cost), plain column names, numbers that add up and a pace from the last days, comparison on the same days, all ranges, filters as chips, Then by only when wanted, total or the mix over time, Your views in the bar, CSV with every row on every page, status and API or subscription as dimensions, a quiet bar. Not yet decided: a stacked chart is a second kind of chart in Rail (look.chart says one series).

Labs in the sidebar (Emil, 8 Nov): nav.labs: a Labs feature sits in the group where it will live, with one quiet word Labs at its end; Settings › Labs is the only switch. navItem({ lab }).
