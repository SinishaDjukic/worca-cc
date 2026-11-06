# A thing's page

| Rule | What | Why | Held by |
|---|---|---|---|
| `thing.slots` | Top bar, title, metadata line, StatusLine, progress, Figures, Tabs, in that order | Every thing reads the same | run-page-sweep |
| `thing.work-phrase` | Where the work goes is one phrase that follows the run, never a badge | One fact, one place | design-system-components |
| `thing.list-home` | A list about a step is Overview's focus; a list about the whole is a tab; never both | One place per list | by hand |
| `thing.by-exception` | A tab draws in full what needs you; what went fine is one line | The exception is the news | by hand |
| `thing.opens` | A row opens its detail in place; a problem opens itself once; sections never collapse | Nothing is hidden when it matters | by hand |
| `thing.tabs-by-level` | Four tabs in every interface mode; inside them, Logs, the graph and Actions are Advanced, Agents and log filters Expert | The page keeps its shape in every mode | design-system-components |

**A thing's page** (a run, a group; the pattern for any page about one thing with a state), top to bottom:
| Slot | Holds | Never holds |
|---|---|---|
| Top bar | The trail to the parent (the page itself is never a crumb; `‹ Parent` at 760px and below); at its right only quiet lines that are about the window, not the thing: the pager, `Offline · retrying` | Buttons for the thing |
| Title | The name, one line with an ellipsis | Chips, buttons |
| Metadata line | Facts as short phrases (where it lives, its kind, when it runs), then its TagGroup; one line, the rest folds into `+N`. A fact that is also a setting is a SentencePicker in its phrase (`Runs [every weekday ▾] at [09:00 ▾]`) | Facts another slot shows, colour, a setting the page does not show |
| StatusLine | The state word and one detail line; at its right the action slot: the one next step (main ▾), then ⋯. A state that calls for no step leaves the slot empty; ⋯ stays | A second primary |
| The thing's progress | Stepper and the open stage's StepRows; a question is answered under its step, as an OptionList | — |
| Figures | Its numbers; each opens its own detail: its tab when it has one (Changes), else a breakdown under it (Cost) | Chips, lists |
| Tabs | Sections of the thing; each tab's content starts on the tab text edge | A second list of what the page already lists |

**Where a run's work goes** is one phrase in the metadata line that follows the run, never a badge: `branch into dev`, `#959 merges branch into dev`, `branch merged into dev`, `main to origin/main`, `into ~/folder`. A run started with Run on the source branch lands on the source itself, so it says so from the start: `on source then to origin` while it works (the agents' copy it commits on stays hidden), `source to origin` once merged back, with Push as its one step and never a pull request. When the merge back fails the copy shows, `copy not merged into source`, the state is Needs you and the step is How to merge. A branch is named once in the phrase, and its middle folds, never its end. Prototype cases `source`, `source-ready`, `source-unmerged`.

**Where a list goes on a thing's page** (checks, a plan's steps, files, decisions): each list has one home, chosen by
what it belongs to.
- **Part of a step** (the checks of the PR stage, the plan of the Plan stage): its StepRow says it in one line, a count
  and the names that matter (`2 failed · unit, e2e`); the whole list is Overview's first section, the state's focus,
  named by what it is (`What broke`, `The plan`, `To check`), and the card's action lands there.
- **About the thing as a whole** (files, decisions, activity): its own tab, its count a caption on the tab; a Figure
  may open it (Changes).
- Never both: a list in the focus section has no tab, and a tab's list is not repeated in the card.
- **A tab reports by exception:** what needs the person is drawn in full; what went fine is one line with › to its
  detail, and opens by itself only when something in it did not pass.
- **A list of what a run produced groups by what each item is** (Code, Tests, Not in the code), not by folder;
  largest first, the folder after the name, each group's head with its count.

**The run page's cases** (each a prototype case; its state's word and action are in `run-state.mjs`):
- **Paused says why, and offers only what can help.** A usage limit offers the other engine and `Resume at 14:00`; a total budget offers only Open Settings; a team cap asks for a reason and links its policy; `Resume at…` is off on a cost cap and says why. A restart, a time limit, an Away limit and an error are one state with their own detail line. An interrupted run resumes, or says it cannot and offers a new run.
- **The word stays Rail's; the rest is the detail line:** `2 open issues`, `End not reached`, `Not in dev yet`, `Waiting for the network`, `Copying the folder`, a PR's `Draft`, `Out of date with dev`, `Blocked by branch rules`. Only a host's word for a closed PR changes the word (Closed, Abandoned, Declined).
- **A PR's stage holds its Watch and its rounds as StepRows.** A round says its request and never raises Needs you; the run that opened the PR does. Create PR's step carries what the automatic PR did, in one line: Opened, `Not opened: why`, Waiting for the feature, Waiting for the requirements to be marked.
- **Requirements still to mark are Overview's focus and lock Create PR,** which says why (`Mark every requirement … N left`); Not met and Dropped count once they say why.
- **A review's findings** are under the asking step and in Overview's focus: the gate's issues, one line per role that opens its findings.
- **A workflow without stages** has one Stepper segment per node. Parallel steps are several `now` rows.
- **Activity** holds, under its steps: Logs, Agents, Sessions, Step usage (flag `runTelemetry`), Cost. The graph opens from its head, a Dialog without a form with a step log drawer under the graph. **Changes** holds Actions under Check out: services, ports, the patch; in a workspace only the projects that changed; off on a hosted Worca, saying why.
- **A group reads from the run that holds it up** (`Run 2 of 3 · failed`, `Stopped at run 2`); what you do on a member's page stays in the group and the group follows. A kind `Group` is Independent, in any order. One PR says why it is off.

**What opens, and what does not** (mocks: `plans/rail/mocks/run-expand-rules-*.png`):
- **A row opens its own detail, in place:** the ask's parts, a file's diff, a step's rounds. Its › points right while
  closed and down while open; focus stays on the row.
- **What has a problem opens by itself** (a failing test, a part of the ask not done, a failed command in Chat: its
  group and its row, with the output); what went fine stays one line. It opens once: folded by the person, it stays
  folded.
- **A fact that has a home elsewhere links there instead of opening a copy:** the evidence line goes to Activity.
- **Sections never collapse:** a section or group is always drawn; one that is too long shows less, it does not fold.
- **Opening never moves what is above it.** Several rows may be open at once, except one detail of a kind at a time
  (one diff).
