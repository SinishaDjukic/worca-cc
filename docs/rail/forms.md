# Forms and suggestions

| Rule | What | Why | Held by |
|---|---|---|---|
| `form.dialog` | A step that needs fields is one Dialog: framing sentence, Fields, a foot that names what happens | You know what the button does | by hand |
| `form.suggest` | Worca's text runs on a helper job; if it cannot write, the field keeps its text and says so | A suggestion never blocks you | by hand |

**A form** (New run, Create PR): a Dialog. It opens with the one sentence that frames the step, its choices as
SentencePickers (`A [large ▾] task`, `branch into dev ▾`), then its Fields. Text Worca can write is a SuggestionField.
A problem with the choice shows before it is made, on the rail with an amber dot: one note, what it means, and
the ways out as buttons. The start button names what will happen (`Start at 16:40`); Cancel is quiet, before it.
A setup of several steps is one Dialog with the Stepper at its head, one step per screen, Back and Next in its foot.
A view that only shows (a workflow graph at full size) is a Dialog without a form: its head, the view, Close.

## Suggestions
- The violet shimmer means Worca is writing text you will review. It never means loading or a run state.
- Every suggestion runs on a helper job's model (Models › Helper jobs) and its sparkle's tooltip names it: PR titles
  and descriptions (stacked ones too) on PR description; run title and branch on Run naming; drafted answers and
  change requests on Drafts.
- If Worca cannot write it (an error, or no answer in 20s), nothing changes: the field keeps the text it had, says so
  in grey (`Couldn't write it … The text is as it was.`) with Try again, and the form still submits.
