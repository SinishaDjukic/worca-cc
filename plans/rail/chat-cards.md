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

## Parity: every flow, every card, every action (from dev, 7 Nov)

Two read-only audits of dev's code (ask-panel.mjs, chat/*, shape/*, run-state.mjs, home*.mjs) listed every starter's flow and
every action. Rail reproduces each flow in its card shape; a box is ticked when the prototype has it and a sweep walks it.

### How starting works
- [x] A starter only arms the composer: an intent chip (icon, name, ✕) and its placeholder; nothing is sent until you send.
- [x] Chat home: the composer, then one row of starters: New task, Shaper, Build workflow, Schedule, Track a run, More ▾
      (Explain a diff, Write a script, Add project, Step away, Team metrics, Add a model, New workspace, Remember something,
      Find tasks). Pinned workflows lead the row (right-click or Shift+F10: Unpin; Shaper pinned by default). More you can
      do: Memory defragment (Schedule it), All workflows. Start from a preset, by scope (any, this project, this workspace).
- [x] The composer: + (files, a ticket, reuse), the sentence, engine with model and effort as one picker, voice with its
      hands-free ▾, send; Stop while replying; queued messages (edit, resume); the context meter; @ mentions of tasks and PRs.

### New task (and a pinned workflow, and Find tasks)
1. [x] TaskProposal: Proposed · from this chat; title (rename in place); From preset X; labels; why.
   - [x] Where it runs: No project / Project / Workspace; project; source branch; feature branch; Run on the source branch;
         base branch; per-member source branches (workspace).
   - [x] Workflow (with its description), Engine (Default …), Guardrails (every agent), Pull request when done.
   - [x] Agents (Expert): per agent model, effort, sub-agents, fan-out; Reset to proposal; Save as project defaults.
   - [x] Task brief, Markdown, @ pills, count; a tracker task shows a Task box instead (id, title, profile).
   - [x] Foot: Open in New run, Not now, Schedule…, Start. Open decisions: Run as is / Shaper, each with its estimate,
         perspective chips.
2. [x] The running task card: steps, agents, cost, elapsed; Pause, Stop; waiting: the question under it; done: result,
       top files, artifacts, Ask for changes (inline).
3. [x] Then a PR offer, and a Changes card when you ask for changes.

### Shaper
1. [x] Proposal, Shaper's: clamped brief (Show brief), target, Perspectives (Product locked, + N more), What happens
       ("Up to 3 questions, then a plan you approve"), Advanced folded (engine, guardrails, agents); Open in New run,
       Not now, Start planning. With requirements first: Large task · ≈ $31 · ~84 min; "You lead as [role], supported by
       [no one else]"; Shape requirements (needs a lead role).
2. [x] Clarify: "A few questions before the plan", up to 3, lettered, Worca's pick; Answer, Use defaults.
3. [x] Step receipt: one line naming what was decided (Requirements agreed, Changes asked · Plan, Stopped at the plan).
4. [ ] Requirements (requirements first): N decisions need you · as Product; agreed ones folded by perspective; Agree and
       plan, Ask for changes (Send changes, Cancel), Try again.
5. [x] Split (outline): the runs, each ⋯ Merge with next, Remove; Undo edits; Ask me before each run; Ask for changes,
       Approve N runs, ⋯ Fix all, Plan it as one, Stop.
6. [x] Plan card (PlanCard) — still to add: Shape check line, Perspectives with Update plan, Requirements fold, per-role
       Show/Hide, Decisions needed, implementer and requirement concerns (Approve, Ask for changes), ⋯ Fix all, Save to
       plans/, Open in New run, Stop.
7. [x] Gate and recovery step: A decision is needed / A step failed; Accept as is, Run another cycle, Retry, Abort, Pause.
8. [x] Feature card: step log (Show/Hide), Pause (Pausing…), Stop, Resume, Re-plan the rest; ⋯ Re-plan the rest, Cancel
       the rest, Ask before each run, Open the plan.
9. [x] Ship: Requirements N/M, each Met / Not met (where it moved) / Dropped (why); As one PR / As stacked PRs; Create PR
       (its dialog), Not now.
10. [x] Changes: the quoted request; Start round 2 / Add to Run 3's plan / Add Run 4 / Start Run 4; Not now.
11. [x] Route: Where does this go?, Worca's guess, three choices, Where in the feature; its named action, Not now; Open run.

### Build workflow
1. [x] Workflow proposal: building (a trace), then Proposed workflow · round N, target, editable name, the graph (Expand
       opens Workflows), model chips per node, loops, "uses a workflow you already had"; Decline, Save as workflow
       (Save & propose). Saved: Saved to Workflows, Open in Workflows; a TaskProposal follows if you asked to run it.

### Schedule a run (and Memory defragment)
1. [x] TaskProposal with when: Scheduled / Repeats / After run, its time, Change…; Schedule, Start now.
2. [x] Scheduled card: its kind, title, next time; Run now, Cancel / Delete schedule, Schedules.
3. [x] Schedule change: Now → Becomes, next runs; Decline and Run now / Move / Apply / Cancel run / Delete.

### Track a run
1. [x] A picker (Live / Nothing running) fills the composer; then the running task card.

### Explain a diff
1. [x] A picker (Finished) fills the composer; a text answer; a FilesCard (Diff kind; Download, Show in folder) if shown.

### Write a script
1. [x] Script draft: name, runtime (Shell, Python, Node.js), key, description, inputs, outputs, params, program · N tests;
       Edit…, Decline, Save script; Saved to your scripts.
2. [x] Script approval: dev's note ("on this machine with your access and no sandbox", where, how long), folds (Command, Program, Exit codes, Test cases); Don't run, Run (Don't save,
       Save); done, exit N.
3. [x] Command: Stop, Copy command, Copy output, Show in terminal, Show all.

### Add project
1. [x] Add project (New: name, location, use git; Folder: choose, several; Clone: URL, branch, folder name). In chat: a
       ChangeProposal of kind Project (Create, Add) or Clone (Clone, Cloning…).

### Step away
1. [x] A receipt: Away mode, before → after, Revert. Changing its settings: Change Away mode? Now / After; Keep as is, Apply.

### Team metrics, Add a model, New workspace
1. [ ] Team metrics: a text answer; a ChangeProposal only to change it (Enable, Include my runs, Metrics home, Route
       members).
2. [x] Add a model: Proposed model change (Add, Edit, Remove, Provider, From Copilot); before → after, warnings; Decline,
       Add / Apply / Remove (red) / Import; then Models.
3. [x] New workspace: Create / Add members / Remove member / Rename; rows; removing asks for a re-scan (No, Partial,
       Full, the recommended named); Decline, its action; then Open the workspace.

### Remember something, Find tasks, plain Ask
1. [x] Remember: a text answer, the tool as a row. Find tasks: a list, then a TaskProposal with the Task box.
2. [x] Plain Ask: words; a question (Answer, your own answer, arrow keys) or a project switch (Switch, Continue without).

### On the card, not the page (everything the task page does today)
- [x] Stop; Retry, Restart Build, Start a new run; Resume at…, on another engine, Switch model.
- [x] Create PR, Publish branch, Push, Link remote, Apply to branch or folder, Discard, Download patch, Commit it yourself,
      How to merge; Watch, Copy PR link, Fix checks, Re-run checks, Fix conflicts, Resolve in a terminal, Mark ready,
      Merge PR, View fix run.
- [x] Ask for changes inline; Archive, Restore, Report, Save as preset, Away mode, Labels and cost tags, Terminal.
- [ ] And three dev lacks on its page too: Run after, Copy branch name, Sync log.

### Settings proposals, per kind
- [x] Web access (Allow in chat, Always allow, Deny); proxy; actions; a setting's revert scope (This run only, Your settings).

### Still open (7 Nov, after the parity build)
- Dialogs an action opens (Create PR, Raise the cap, Resume at…, Switch model…) still open on the task page; bring them
  into the chat as a ChangeProposal or a sheet over it.
- Shaper with requirements first (the `shapeRequirements` flag): the lead role sentence and the Requirements card with
  Agree and plan; today requirements show as decisions and a folded agreed list.
- Away mode's settings change (Keep as is, Apply), Team metrics' change kinds, the model kinds Edit, Remove, Provider,
  From Copilot, proxy, actions, and a setting's revert scope (This run only, Your settings).
- Arrow keys between a question's options; Chat home's "More you can do" (Memory defragment) and the Plans and Workflows
  tabs, which live in Places today; run tiles with a mini graph.
- The task page's own gaps: Run after, Copy branch name, Sync log.
