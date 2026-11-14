# When something breaks

| Rule | What | Why | Held by |
|---|---|---|---|
| `fail.one-place` | An unplanned error has one place and one calm sentence | A crash in the page never stops a run | run-page-sweep |
| `fail.no-raw` | The raw error sits behind Details or Copy details | Readable, and ready to paste into an issue | by hand |
| `fail.offline` | A lost connection is a quiet state, not an error | Nothing typed is lost, nothing runs twice | run-page-sweep |
| `fail.chat-thread` | A conversation that is loading, could not load or is gone shows the list's ListState: loading; "Could not load this chat" (ListState's `title`) with Try again; "This chat no longer exists" with a Chat home link and no Try again | A chat never spins or shows a raw error; the composer keeps what you typed | stillhet-compare |
| `fail.chat-turn` | A reply that failed is one TurnRow with the failed mark and a calm sentence; the raw error is behind Details; Try again sends your words once more, with no second YouTurn | One place, one sentence; nothing is sent twice | stillhet-compare |
| `fail.pulse-list` | Pulse's popover says its list state as the bar's lists do: ListState loading until the first data, ListState could not load with Try again when it failed; the bell shows no number meanwhile | One look for one state, wherever the list is | stillhet-compare |
| `fail.task-page` | A task page that is loading, could not load or is gone shows the list's ListState: loading until the list's first load and the task's detail are in; "Could not load this task" (ListState's `title`) with "Nothing changed." and Try again, the one sentence for a server error and a lost connection alike; "This task no longer exists" with a Tasks button and no Try again | A task page never spins or shows a raw error; Try again draws the page and puts focus on its heading | stillhet-compare |
| `fail.task-action` | A task action that failed says `Could not ACTION: REASON` once, where it started: its confirm strip or its dialog (which keeps what you typed), else the shell's toast; the page and the store stay as they were | One place, one sentence, nothing changed by a refusal | stillhet-compare |

An error nobody planned for still has one place and one calm sentence. A crash in the interface never stops a run:
runs execute on their own, and the words say so.
- **A step you took:** the place you acted, like any failure (`Could not merge #959`), with the reason `Something went
  wrong on Worca's side. Nothing changed.`, Try again and a Details link.
- **A part that cannot be drawn:** that part only, as EmptyState's error (`Could not show the changes`, `Something went
  wrong here. The rest of the page still works.`, Reload this part, Details). Nothing typed elsewhere is lost.
- **In the background** (an uncaught error or a rejected promise, with no part to point at): one error Toast that stays
  until closed: `Something went wrong`, `Worca hit an error it did not expect. Your runs keep going.`, Reload and Copy
  details. A repeat adds a count to it, never a second toast; it never moves focus.
- **Never the raw error in visible text:** the message, the stack and an error id go behind Details or Copy details,
  ready to paste into an issue or Chat.
- **A lost connection is a state, not an error:** `Offline · retrying` with a grey dot at the end of the top bar, gone
  when it reconnects (a toast says `Back online`). Nothing you typed is lost and nothing is retried twice.

- **A sign-in that ended** is a Dialog with its one step: `Session expired`, what still holds (`Your runs keep going`), and
  Sign in again; no Cancel, since nothing works until then.

The prototype's Break picker and its Connection picker play each case.
