# The shared logic

| Rule | What | Why | Held by |
|---|---|---|---|
| `logic.one-source` | A state's word, colour and action, a step's flow and where the work goes come from the library | A page that rebuilds them gets them wrong: Chat's list once turned Paused and Stopped into Ready | rail-gate |
| `logic.pure` | The logic has no DOM and no mock data; a run's names reach it as facts | Chat, the run page and Pulse can all use it | design-system-logic |
| `logic.no-guess` | An unknown state throws | A new state must be named here before a page can show it | design-system-logic |

All of it is exported by `ui/public/design-system/components/index.mjs`.

| Need | Call | Module |
|---|---|---|
| What a state says, its colour and its one action | `runState(id, facts)` | `run-state.mjs` |
| Where a state sorts in a list of what waits on you | `sectionOf(word)` | `run-state.mjs` |
| What an action does, in one line | `actionHelp(label, facts)` | `run-state.mjs` |
| A chat's word, dot and section; what it did | `chatState(id)`, `CHAT_KINDS` | `run-state.mjs` |
| What a run's word is to the bulk table | `bulkStateOf(word)`, then `planBulk`, `skipText` | `run-state.mjs`, `src/shared/run-bulk.mjs` |
| Where an action leads: another state, a sentence, a confirm, a Dialog | `actionFlow(id, facts)`, `runFlow()` | `run-state.mjs` |
| The interface mode an action needs | `actionLevel(label)` | `run-state.mjs` |
| What a run keeps on its own page when it is in a group | `memberKeeps(label)` | `run-state.mjs` |
| A step's look and a stage's state | `stepLook`, `stageState`, `subState`, `stageMeta`, `defaultStage` | `run-state.mjs` |
| Confirm, working, then done or failed | `stepFlow(hooks)`, `confirmOf`, `workingWord`, `failureOf` | `step-flow.mjs` |
| Where the work goes | `workPhrase(place)` in words, `workPlace(place)` for a page | `work-place.mjs` |
| A long branch or path | `foldMiddle(text)` | `work-place.mjs` |
| What an interface mode shows | `atLevel(mode, need)`, `runPartShows(part, mode)` | `levels.mjs` |
| What a click, a long-press or a key means for a selection | `selectionAction(facts)`, `selectApply(pick, action, where)` | `selection.mjs` |
| What a selection key does to a selection | `selectStep(pick, act, where)` | `selection.mjs` |
| Where the focus goes when a row leaves | `keepFocus(before, after, id)` | `selection.mjs` |
| What a key does here | `shortcutAction(keyFacts(e), { scopes })` | `shortcuts.mjs` |
