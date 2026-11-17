# Actions: where they go, and how a step runs

| Rule | What | Why | Held by |
|---|---|---|---|
| `act.slots` | Each kind of action has one slot (the table below) | You look in one place | by hand |
| `act.looks-clickable` | An acting control is a button with a visible border at rest, in every kind; only an icon button is borderless. A labelled button is 32px with meta-size words (from classic's bordered buttons) | Nobody should hunt with the pointer for what can be pressed | by hand |
| `act.confirm` | A step that others see or that cannot be taken back confirms first; spending alone never does | Asks only when it matters | design-system-logic |
| `act.confirm-in-place` | A confirm opens at the control that asked: in place of a card's buttons, or under the status line that holds the action. Escape cancels and the focus returns to the control | The question is where the eye and the pointer already are | design-system-confirm-strip |
| `act.safe-side` | A confirm opens on its safe choice, and that choice says what it keeps when Cancel would read as the step itself (`Delete task`, `Keep`) | Enter never does the dangerous thing | design-system-confirm-strip |
| `act.at-once` | A picker or a Switch on a page takes effect at once, and a failed change flips back with a Toast saying why; inside a Dialog it applies when the Dialog is submitted | A page has no Save of its own | by hand |
| `act.flow` | Confirm, working, then the state moves on or the place you acted says what failed. A step whose result arrives later (a PR) keeps its working word until it arrives | The same flow on every page | design-system-logic |
| `act.demo-says` | In the prototype's demo a step that only says something (`Would open…`) goes straight to its words, with no working; the app never has such a step | No flash for what does no work | design-system-logic |
| `act.busy` | A button that waits on the server is busy while its action is out: the breathing knot (`look.running-sign`) and a present-tense label (`busyWord`: Create PR reads Creating PR…), its width steady, unpressable. A button that acts at once never is | You see that the press was taken and what is happening | design-system-task-redesign |
| `act.nothing-moves` | Nothing moves under the pointer: a menu floats over the page, and a card or row you acted on keeps its place and shows its new state; the order settles on the next visit or the next Order pick | A second press never lands on another thing | by hand |
| `act.copy-link` | Copy a link puts the page's address on the clipboard, and the address follows the view: it holds only what differs from the page's defaults, with days as calendar days. It sends nothing and says Copied a link to the page; a browser that refuses says so | A colleague sees exactly what you saw, whenever the link is opened | stillhet-insights-host-2 |
| `act.link-opens` | An opened link that names something unknown or impossible drops that part and opens the rest | A stale link never breaks the page | stillhet-insights-host-2 |
| `act.this-thing` | An action moves this thing: its name, its figures and where its work goes stay; the target supplies only the state | A step never lands you on someone else's page | run-page-model |
| `act.archive` | Archive removes the local branch, worktree and logs; the remote branch and any PR stay. Restore and Undo bring back the record, read only, never those files or a way to resume | One rule on the task's page and in a list, as in the app | design-system-logic |
| `act.archive-asks` | Archive confirms on the task's page, saying what goes, and is off while kept work or a local copy is open. In a list it takes Undo instead, unless the task could still resume: that asks | Undo brings back only the record | design-system-logic |
| `act.fail-words` | A failure says Could not …, the reason, Nothing changed., Try again, in the place you acted. What already succeeded stays (a stack that fails part-way keeps the PRs it opened; a retry opens the rest) | Calm, and you know where you stand | design-system-components |
| `act.limit-note` | Near a limit, a confirm that starts agent work carries the limit note in one line (`Claude Code's session is at 91%. This may pause before it finishes.`) | You decide before spending | by hand |

## Where an action goes

| Kind of action | Slot |
|---|---|
| The one step the state calls for | The action slot's main; alternatives in its ▾; the one that ends the thing (Stop, Cancel) last, after a rule |
| Supporting actions on the whole thing | ⋯ next to the action slot; tools first, then Report, then Archive or Delete after a rule |
| Actions on one section | That section's head, at its right (Check out in the Changes head, Reset to defaults in its section) |
| A fact's detail, or going to the place a fact names | The fact itself, as a Figure or Text link (`#959` opens the PR); ⋯ only when no fact on the page names it |
| A yes or no, or a one-line answer | ConfirmStrip, at the control that asked (`act.confirm-in-place`) |
| A step that needs fields | Dialog (`form.dialog`) |
| Commands you run by hand (`How to merge`) | A Dialog without a form, with a CopyButton; never a Toast, which fades |
| Sending something with your words (`Report this task`) | Dialog, with the note |
| Starting new work, or changing a task or a schedule | Chat (`stillhet.chat-first`): the page offers **Ask about it in chat** or, on a schedule, **Change in its chat** |
| A setting of Worca, or of a project | Settings, or the project's Settings tab, as a labelled picker in its row (`set.one-choice`) |

## Which steps confirm

| Confirms | Does not |
|---|---|
| Create PR, Merge, Fix checks, Stop, Cancel the rest, Re-plan, Discard, Push, Apply to branch, Link remote, Delete | Pause, Resume, Re-run checks, Copy link, Terminal, anything that only spends |

`Pause after this step` changes nothing yet: the task stays Working and its detail line says so until the step ends.
