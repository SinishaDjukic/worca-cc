# When something breaks

| Rule | What | Why | Held by |
|---|---|---|---|
| `fail.one-place` | An unplanned error has one place and one calm sentence | A crash in the page never stops a run | run-page-sweep |
| `fail.no-raw` | The raw error sits behind Details or Copy details | Readable, and ready to paste into an issue | by hand |
| `fail.offline` | A lost connection is a quiet state, not an error | Nothing typed is lost, nothing runs twice | run-page-sweep |

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

The prototype's Break picker plays each case.
