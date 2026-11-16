# A thing's page

A thing's page starts with a PlaceHead (`panel.place-head`); a task's page is the one exception and has its own slots, below.

| Rule | What | Why | Held by |
|---|---|---|---|
| `thing.page-frame` | Every page of a place is the one centred reading column (`.convo-col.is-center`, 720px wide), with one title size and one text edge; its loading and failed pages too. Only the workflow editor keeps the full width | Moving between places never shifts the title or the column | design-system-places-redesign |
| `thing.slots` | A task's page: fixed slots, top to bottom: the trail, the title, where its work goes, where it was started, the StatusLine, the stage train, what it asks, its parts, Figures (the table below) | Every task reads the same, as its card does | run-page-sweep |
| `thing.one-edge` | On a task's page the title, the branch, Started from, the state word, a stage's steps, the fold names and the section heads start on one text edge; the title and the state word share the page size | One edge is read straight down (`stillhet.one-rail`) | by hand |
| `thing.inspect` | A task's page is an inspect view: it holds the actions that answer the work that exists (Answer, Approve, Merge, Retry, Stop) and nothing that starts new work. New work from it is the link **Start a follow-up in Chat** | Work starts in one place (`stillhet.chat-first`) | by hand |
| `thing.from-chat` | A task's page says where it was started, under its title: `Started from the chat NAME` with **Open the chat**, or `Started from New task` with **Ask about it in chat**. The chat's card says `Task · started from this chat` and its title opens the page | The link between the work and the talk is written on both ends | design-system-task-redesign |
| `thing.stage-train` | A task's stages are one horizontal train (StageBar) on its page and its card: a knot per stage with its name and time under it, done in ink, the current one in its state's colour with its step (`Review 3 of 3`). The train says the same in words to a screen reader (`Stage 3 of 5: Review, working`) | Progress is read in one line, in every theme, without colour for what went fine | design-system-task-redesign |
| `thing.knot-opens` | A knot is a button with a name: on the page and on a card it opens the detail panel at that stage's steps (`panel.detail-panel`); on a feature's page a member's knot opens the panel on that member. With Task details set to Inside the card (`panel.detail-where`) it opens the steps under the train. A stage with nothing to open is not a button | Each stage is one click away, and nothing pressable does nothing | design-system-task-redesign |
| `thing.parts-under-train` | A task's parts are the detail panel's tabs (Steps, Log, Changes, Checks, Decisions, Cost; `panel.detail-panel`): under the train one row each for Steps, Changes, Checks and Decisions, saying what it holds before it opens (`5 files`, `3 · 1 open`); the Time and Cost figures open Cost, a step of Steps opens its Log. A row opens its part in the detail panel beside the page and nothing folds open in the column; `#run/<task>/<part>` links to it. What the task asks (the step that asks, with its answer) stays in the column. With Task details set to Inside the card the parts are folds under the train (Changes, Activity, Decisions) and the part that matters now opens by itself | A part is found in the same place on every task, and the page stays its state and its one action | by hand |
| `thing.open-line` | A toggle that opens a part in place (a StagePart: a step's log, More options; Changes and Show its stages with Task details set to Inside the card) draws a hairline from its words to its chevron, closed and open; what it opens hangs on that line and ends with its own line | You see where an opened part starts and ends | design-system-task-redesign |
| `thing.diff` | A diff is a DiffView: side by side from 900px of its own width, unified under that, a Segmented choosing where both fit. Every added and removed line has line numbers, a sign and a screen-reader word, on a tint under ink text | Two columns compare best, a narrow place cannot hold them, and colour alone says nothing | design-system-task-redesign |
| `thing.diff-find` | A diff has one Find field in its head: it marks every match in the files shown, says which one you are on (3 of 12), and Enter or Next and Shift+Enter or Previous step through them; Escape clears it | A long diff is searched, not scrolled | design-system-task-redesign |
| `thing.diff-whole` | An opened file shows its diff in place; **Open the whole diff** and **View changes** open a Dialog with every hunk, of one file or of all | The long read gets the window, the quick look stays on the page | by hand |
| `thing.work-phrase` | Where the work goes is one phrase that follows the task, never a badge; a branch is named once in it and its middle folds, never its end (the table below) | One fact, one place | design-system-logic |
| `thing.list-home` | A list about a step (a PR's checks, the plan) shows under that stage, named by what it is (`What broke`, `The plan`); a list about the whole task (files, decisions, activity) is its part; never both | One place per list | by hand |
| `thing.one-telling` | On a thing's page a fact about one of its parts is told in one section: a count or a step's cost is not repeated by a head, a note or a row | Three tellings on one screen read as three facts (`stillhet.one-place`) | by hand |
| `thing.by-exception` | A part draws in full what needs you; what went fine is one line with › to its detail | The exception is the news | by hand |
| `thing.opens` | A row opens its own detail in place, its › turning down, focus staying on the row; several may be open, but one diff at a time. Opening never moves what is above it | Nothing jumps when you look closer | by hand |
| `thing.opens-itself` | Inside an open part, what has a problem opens by itself, once (a failing test, a failed command, a part of the ask not done); folded by the person it stays folded. The detail panel itself never opens by itself (`panel.detail-panel`) | Nothing is hidden when it matters, and nothing reopens against you | by hand |
| `thing.no-collapse` | A section is always drawn; one that is too long shows less and never folds | Nothing hides | by hand |
| `thing.produced-by-kind` | A list of what a task produced groups by what each item is (Code, Tests, Documents, not code), largest first, the folder after the name, each group's head with its count | You look for a kind of change, not a folder | by hand |
| `thing.read-only` | A task that is not yours (a teammate's synced record) shows the head, the StatusLine with an empty action slot and no ⋯, Figures, its runs and its PR (TaskView), and never steps, logs or actions | What a record shows is true, and nothing offers what cannot be done | design-system-task-view |
| `thing.parts-by-level` | Inside the parts, Logs, the graph, Sessions and Actions are Advanced; Agents and the log filters are Expert. A mode never removes a part | The page keeps its shape in every mode | design-system-logic |
| `thing.follows-state` | Rows, folds, figures and menus show only what the state makes true: no Changes before Build has run, no Decisions before anything is decided, and what is gone says gone and has no tools | A page never contradicts itself | run-page-model |
| `thing.direction` | While a task runs or waits paused, ⋯ offers `Send a direction`: a field under the StatusLine with Send direction and Not now. An empty one sends nothing, a refusal keeps the text, and a finished or gone task does not offer it | A direction is the one word a running task can take; anything longer is its chat's | by hand |

## A task's page, top to bottom

| Slot | Holds | Never holds |
|---|---|---|
| Top bar | The trail to the parent (`‹ Parent` at 760px and below); at its right only lines about the window (the pager, `Offline · retrying`) and the shell's own search and Pulse | Buttons for the task |
| Title | The name, one line with an ellipsis, and the Keep in view eye | Chips, buttons |
| Where its work goes | The work phrase (`thing.work-phrase`) | Facts another slot shows, colour |
| Started from | The chat's name and **Open the chat**, or New task and **Ask about it in chat** (`thing.from-chat`) | A composer |
| StatusLine | The state word and one detail line; at its right the one next step (main ▾), then ⋯. A confirm opens under it (`act.confirm-in-place`) | A second primary |
| Stage train | StageBar; under it only the step that asks, a question answered under it as an OptionList. A stage's StepRows open in the detail panel, from its knot | Tabs |
| Parts | One row each for Steps, Changes, Checks, Decisions (those the task has); a row opens its tab in the detail panel (`thing.parts-under-train`) | The part's content, a second list of what the page already lists |
| Figures | Its numbers; each opens its own detail (Cost: a breakdown under it) | Chips, lists |

## Where a task's work goes

| Case | Phrase |
|---|---|
| Working on a branch | `branch into dev` |
| A PR is open | `#959 merges branch into dev` |
| Merged | `branch merged into dev` |
| No PR, pushed | `main to origin/main` |
| A copy of a folder | `into ~/folder` |
| Started with Run on the source branch | `on source then to origin` while it works; `source to origin` once merged back, with Push as its one step and never a PR |
| The merge back failed | `copy not merged into source`: the state is Needs you and the step is How to merge |

Prototype cases: `source`, `source-ready`, `source-unmerged`.

## What the parts hold

With Task details in the side panel, a part is a tab of the detail panel; a tab with nothing to show is left out.

| Part | Holds |
|---|---|
| Steps | The stages as one list on the rail, each step once on one line; the stage a knot pointed at is scrolled to and marked; a failed step shows what broke under it; a step's name opens it in Log. On a feature's page the member's name with Open task comes first. `Problems and questions` filters it only when there are any |
| Log | One step's log, the step picked at the top, in mono in its own box; under it Agents and Sessions (Expert, Advanced). Opens at the running or failed step |
| Changes | The files by kind, each opening its DiffView with Find; its tab counts the files only. Under Check out, Actions: services, ports, the patch; in a workspace only the projects that changed, its stacks first (one ListRow per stack with Start and Stop; off on a hosted Worca, saying why) |
| Checks | What broke in a step's tests, what the review found, the PR's own steps; each a short group |
| Decisions | What was decided and what is still open, each opening its detail |
| Cost | The total and the budget, each stage with its steps (model, time, cost), then what Worca's own calls took and Step usage (flag `runTelemetry`) |

The graph opens from the panel's foot, a Dialog without a form with a step log drawer. With Task details set to Inside the card the folds are Changes, Activity (steps, Logs, Agents, Sessions, Step usage, Cost) and Decisions.

## The task page's cases

Each is a prototype case; a state's word and action come from `run-state.mjs`.

| Case | What the page does |
|---|---|
| Paused | Says why and offers only what can help: a usage limit offers `Resume at 14:00` and one `Resume on ‹Engine›` per engine it can switch to (asked first); a total budget offers Open Settings; a team cap asks for a reason and links its policy. A restart, a time limit, an Away limit and an error are one state with their own detail line |
| The word and the detail | The word stays Stillhet's; the rest is the detail line (`2 open issues`, `Not in dev yet`, `Out of date with dev`). Only a host's word for a closed PR changes the word (Closed, Abandoned, Declined) |
| A PR's stage | Holds its Watch and its fix rounds as StepRows; a round never raises Needs you. Create PR's step says what the automatic PR did in one line |
| Requirements still to mark | Show under the stage that asks and lock Create PR, which says why (`Mark every requirement … N left`) |
| A review's findings | Under the asking step: the gate's issues, one line per role that opens its findings |
| A workflow without stages | One knot per node; parallel steps are several `now` rows |
| A group | Reads from the task that holds it up (`Task 2 of 3 · failed`); what you do on a member's page stays in the group. Once every task is ready its action is Create PR: separate PRs (a Group) or stacked PRs (a Feature) |
| Never started, Discarded, Archived, Deleted | Nothing spent, made or decided; what is gone says so in the place it was and keeps no tools. The logs go with the worktree |
| Try it | Lives in ⋯ and never dead-ends: it says what is happening (`Checking out…`), then offers the next step (`Start Web`, `Open :3000`, or `Open Actions` when there is no service; `tryStep`) |
