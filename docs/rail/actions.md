# Actions: where they go, and how a step runs

| Rule | What | Why | Held by |
|---|---|---|---|
| `act.slots` | Each kind of action has one slot | You look in one place | by hand |
| `act.confirm` | A step that others see or cannot be taken back confirms first; spending alone never does | Asks only when it matters | design-system-logic |
| `act.flow` | Confirm, working, then the state moves on or the place you acted says what failed | The same flow on every page | design-system-logic |
| `act.this-thing` | An action moves this thing: its name, its figures and where its work goes stay; the target supplies only the state | A step never lands you on someone else's page | run-page-model |
| `act.archive` | Archive removes the local branch, worktree and logs; the remote branch and any PR stay. Restore and Undo bring back the record, read only, never those files or a way to resume | One rule on the run page and in a list, as in the app | design-system-logic |
| `act.fail-words` | A failure says Could not …, the reason, Nothing changed., Try again | Calm, and you know where you stand | design-system-components |
| `act.limit-note` | Near a limit, a confirm that starts agent work carries the limit note | You decide before spending | by hand |

**Where an action goes** (on every page):
| Kind of action | Slot |
|---|---|
| The one step the state calls for | The action slot's main; alternatives in its ▾; the one that ends the thing (Stop, Cancel) last, after a rule |
| Supporting actions on the whole thing | ⋯ next to the action slot; tools first, then Report, then Archive or Delete after a rule |
| Actions on one section | That section's head, at its right (Check out in the Changes head, Reset to defaults in its section) |
| A fact's detail, or going to the place a fact names | The fact itself, as a Figure or Text link (`#959` opens the PR); ⋯ only when no fact on the page names it |
| A yes or no, or a one-line answer | ConfirmStrip under the top bar, opening on the safe choice |
| A step that needs fields | Dialog |
| Commands you run yourself (`How to merge`) | A Dialog without a form, with a CopyButton; never a Toast, which fades |
| Sending something with your words (`Report this run`) | Dialog, with the note |
| A choice that changes a step | SentencePicker, inside the sentence it changes |
| A thing's own setting (a schedule's times, a run's budget) | The fact itself, where the page shows it, as a SentencePicker; a setting the page does not show is not added to be editable. Settings that must change together: a Dialog from ⋯ (`Edit schedule…`). Where it belongs (its group): ⋯ |
| Anything about how Worca behaves everywhere | Settings, never on a thing's page |

## Steps that change state
A SentencePicker or Switch on a page takes effect at once, like a setting, and a failed change flips back with a Toast
saying why; inside a Dialog it applies when the dialog is submitted. A step that changes what other people see (a PR,
a branch, a merge, a comment) or cannot be taken back (Create PR, Merge, Fix checks, Stop, Cancel the rest, Re-plan,
Discard, Push, Apply to branch, Link remote) confirms first, in the dialog or the strip; the strip's safe side says
what it keeps when Cancel would read as the step itself (`Delete run`, `Keep`). Spending alone never confirms: starting agent work is
not a reason to ask, and Stop stays at hand while it works. Near a limit, the confirm of a step that starts agent work
carries the limit note in one line (`Needs about 12% of Claude Code’s session; 9% is left.`). Its button then says
what is happening (`Creating…`, `Merging…`) and is disabled until Worca has taken the step on; a step that keeps
working (a fix, a re-plan) then becomes the state, and the state word says it (`Fixing checks`). On success the page
moves on and a toast says what happened. On failure nothing changes: the place you acted says what failed and why
(`Could not merge #959`, the reason, `Nothing changed.`) with Try again, and what already succeeded stays (a stack
that fails part-way keeps the PRs it opened; a retry opens the rest). Pause, Resume, Re-run checks, Copy link and
Terminal do not confirm. **Archive** confirms on the run's page, saying what goes; it is off while kept work or a local copy is
open, saying which. In a list it takes Undo instead, unless a run could still resume: that asks, since Undo brings back only
the record. `Pause after this step` changes nothing yet: the run stays Working and its detail line says so
until the step ends.
