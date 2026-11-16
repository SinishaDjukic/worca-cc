# When something breaks

| Rule | What | Why | Held by |
|---|---|---|---|
| `fail.one-place` | An unplanned error has one place and one calm sentence, and the words say that tasks keep going | A crash in the page never stops a task | run-page-sweep |
| `fail.no-raw` | The raw error (the message, the stack, an error id) sits behind Details or Copy details, never in visible text | Readable, and ready to paste into an issue or Chat | by hand |
| `fail.part` | A part that cannot be drawn fails alone, as EmptyState's error with Reload this part and Details; the rest of the page still works and nothing typed elsewhere is lost | One broken part is not a broken page | run-page-sweep |
| `fail.background` | An error with no part to point at (an uncaught error, a rejected promise) is one error Toast that stays until closed, with Reload and Copy details. A repeat adds a count to it, never a second toast, and it never moves the focus | It is said once, and never interrupts typing | design-system-components |
| `fail.offline` | A lost connection is a quiet state, not an error: `Offline · retrying` with a grey dot at the end of the top bar, gone when it reconnects (a toast says `Back online`) | Nothing typed is lost, nothing is sent twice | run-page-sweep |
| `fail.session` | A sign-in that ended is a Dialog with its one step, Sign in again, and no Cancel | Nothing works until then, so nothing else is offered | by hand |
| `fail.task-action` | A task action that failed says `Could not ACTION: REASON` once, where it started: its confirm strip or its dialog (which keeps what you typed), else the toast. The page and the store stay as they were | One place, one sentence, nothing changed by a refusal | stillhet-compare |
| `fail.task-page` | A task page that is loading, could not load or is gone shows the list's ListState (the words below); Try again draws the page and puts the focus on its heading | A task page never spins or shows a raw error | stillhet-compare |
| `fail.chat-thread` | A conversation that is loading, could not load or is gone shows the list's ListState (the words below); the composer keeps what you typed | A chat never spins or shows a raw error | stillhet-compare |
| `fail.chat-turn` | A reply that failed is one TurnRow with the failed mark and a calm sentence; Try again sends your words once more, with no second YouTurn | One place, one sentence; nothing is sent twice | stillhet-compare |
| `fail.pulse-list` | Pulse's panel says its list state as the bar's lists do: ListState loading until the first data, could not load with Try again; its icon shows no number meanwhile | One look for one state, wherever the list is | stillhet-compare |

## The words

| Case | Says | Offers |
|---|---|---|
| A step you took (`act.fail-words`) | `Could not merge #959`, `Something went wrong on Worca's side. Nothing changed.` | Try again, Details |
| A part that cannot be drawn | `Could not show the changes`, `Something went wrong here. The rest of the page still works.` | Reload this part, Details |
| In the background | `Something went wrong`, `Worca hit an error it did not expect. Your tasks keep going.` | Reload, Copy details |
| A task that could not load | `Could not load this task`, `Nothing changed.` | Try again |
| A task that is gone | `This task no longer exists` | Tasks |
| A chat that could not load | `Could not load this chat` | Try again |
| A chat that is gone | `This chat no longer exists` | Chat home |
| A sign-in that ended | `Session expired`, `Your tasks keep going` | Sign in again |

The prototype's Break picker and its Connection picker play each case.
