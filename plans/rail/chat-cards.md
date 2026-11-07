# Worca Rail · Wave 2: every chat card in Rail

**Goal.** Every card a conversation can show is Rail's: one shape, simpler than dev's, and no function lost. Tasks as a place
go away later, so everything that points at a task leads to its card in its chat. Built in the Shaping prototype through the
library (rule, catalog entry, component, test, gallery example), then checked by the sweeps.

## Three principles

1. **One card shape.** Every card reads the same way down the rail: a **kicker** (its mark and one word: Proposed, Running,
   Plan, Proposed change), a **title**, at most **one line why**, a **body** (a sentence, rows, a stage stream, a graph),
   then **its actions**: one primary, the rest quiet, the rest of all in its ⋯. A one-line thing (an offer, a warning, a
   receipt, a notice) is a TurnRow with its actions at its end. Nothing else: no coloured heads, no eyebrows, no pills.
2. **Everything leads to its card in its chat.** A row in the bar's tree, an In view tab, a search result, Pulse, a
   schedule's runs, a notification, the trail: each opens the chat and scrolls to the card, which flashes once. A task or a
   schedule with no chat gets one, named after it, holding its card (C5's answer). The task page stays only as a fallback
   until the card holds everything it does.
3. **The card opens in place.** A task card's "How it ran" opens the full stage stream under it, as the task page reads
   today: each stage with its parts (Decisions on Plan, Changes on Build, Activity on Review), the workflow graph, the
   result. Nothing needs a page.

And one look rule, for every page: **the background fades into the reading column**, its last faint dots ending at the
column's rail (Chat home's title and composer, a chat, Settings, the Tasks and Schedules homes). The away screen, with
nothing to read, keeps it full.

## Every card, dev's and Rail's

| dev's card | Rail | Keeps |
|---|---|---|
| Run proposal (`buildCardForm`) | TaskProposal | title, why, project, workflow, engine, then, every Customise field, Start, Start later, Decline, the Shaper nudge |
| Scheduled stub, terminal stub | TaskCard, compact (Starts at 14:00: Start now, Cancel); declined or failed: one line | start time, Start now, Cancel, the reason |
| Live run card (`run-card.mjs`) | TaskCard: kicker and state, stage bar, one action (Answer, Create PR, Retry), ⋯ (Pause, Stop, Keep in view, Open graph); How it ran opens the stage stream in place | status, graph (in the stream, Expand), the run's question (a question under it), Pause, Stop, result, rounds, PR watch |
| Result block | the card's last stage line: Merged #1102 · 5 files +358 −144, View PR | PR, diff size, view |
| Rounds log, PR watch | the PR stage's lines: Round 2 · fixing checks; a watch that gave up: one line with Watch again | each round, restart |
| Command card (`command`) | TurnRow: the command, live seconds while it runs, its output folded; a failure opens itself | command, output, duration, failure |
| Activity (tools, agents) | ThinkingRow: one line now; done, Thought for 8s with its steps | every step |
| Notice, divider | TurnRow notice; TurnDivider | the words |
| Question (`ask_question`) | a question under its card or the chat: OptionList, Worca's pick, own answer, Use Worca's picks | options, recommended, free text, defaults |
| Project switch | TurnRow offer: Use worca-cc, Keep no project | both choices |
| Files | FilesCard | tiles, rows, View, Download |
| Receipt, Stop warning, PR offer | ChangeProposal receipt with Revert; TurnRow warnings and offers | Revert, Keep running, Stop, Create PR |
| Settings proposals (model, schedule, away, proxy, web, clone, project, workspace, actions, metrics) | ChangeProposal: before → after, Apply, Not now; a receipt with Revert | every field, Apply, Decline, applied and failed states |
| Workflow proposal | ChangeProposal with its WorkflowGraph, Save | name, reasoning, graph, Save, Decline |
| Agent and script drafts, script approval | ChangeProposal (Save, Edit, Not now); TurnRow approval (Run, Not now) | draft, Save, Edit, Decline, Run |
| Shaper Clarify step | questions under the chat, Use Worca's picks; done: a receipt line "Clarified · 3 answers" that opens them | each answer, defaults, the receipt |
| Shaper plan card | PlanCard | versions, roles' review, per-role rows, Approve and build, Ask for changes, Full plan |
| Shaper decision, route | a question | the choices, recommended |
| Shaper changes, ship | ChangeProposal; TurnRow PR offer | the change list, Build this, Create PR |
| Feature card (a planning run's step log) | TaskCard of a feature: its slices as rows under it, each with its mark; How it ran opens their stages | each slice, its state, opening one |
| User extras (attachments, quote, reply context, run chips) | YouTurn: quote, files; a task named in it is a chip that leads to its card | all four |

## Order

1. One card shape across TaskCard, TaskProposal, ChangeProposal, PlanCard (shared kicker, head, actions).
2. Everything leads to its card: one `RailShell.openCard(task)` that every link calls; a flash on arrival; a chat for a
   task without one.
3. The task card opens in place: the stage stream (StageLine, StagePart) under How it ran, with the graph and the result.
4. The remaining cards: command (live), Shaper Clarify receipt, feature card, scheduled and stopped stubs, run chips in
   your messages.
5. The background fades into every reading column, from one shared mask.
6. Rules, catalog, tests, gallery examples; the sweeps walk each card and each link to its card.
