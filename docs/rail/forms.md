# Forms and suggestions

| Rule | What | Why | Held by |
|---|---|---|---|
| `form.dialog` | A step that needs fields is one Dialog: framing sentence, Fields, a foot that names what happens | You know what the button does | by hand |
| `form.suggest` | Worca's text runs on a helper job; if it cannot write, the field keeps its text and says so | A suggestion never blocks you | by hand |
| `form.composer` | The composer sits in one place on every page that has one (Chat, a conversation, Tasks, Schedules, a schedule's page): on the cards' rail and as wide as the cards; on a home at one height under its heading, so moving between places never shifts it. Starting anything is one composer: you pick Ask, Task or Schedule; the sentence and Customise open under the words; its button names what will happen. Its engine carries its effort; a meter says how full the chat's context is; while Worca replies, what you write can be queued (Edit, remove) and goes when the reply ends; @ names a task, which becomes a chip leading to its card; voice has a hands-free mode. A task is started one way: Task in the composer, a starter or an ask each show the proposal, and its Start dispatches. While Worca replies, sending queues; Stop stands alone. An armed starter's chip takes the mode word's place. On Chat home a row of starters (pinned workflows first, Shaper by default, then New task, Build workflow, Schedule a run, Track a run, More with the rest, presets and Pin a workflow) only arms the composer: a chip with its name and ✕, and its placeholder; nothing is sent until you send, and each starter sends into its own flow of cards. A message is never read as a task | One way in, and ordinary stays ordinary | worca-sweep |

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
