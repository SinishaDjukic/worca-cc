# One rail: the philosophy

Stillhet is calm and state-first: a page shows what is happening, then the one thing you can do about it, and stays
quiet about everything else. This is how its parts fit together; the table below holds the rules themselves.

- **The rail.** Every row on a page sits on one 20px line with one text edge beside it: a state mark, a step, a task
  in a list. Nothing floats, so a page reads straight down.
- **The state word.** What a thing is doing is said first, in a word and a colour that only ever mean a state. Normal
  is plain ink. Colour is kept for what needs you: amber asks, red has stopped.
- **The one action.** Each state offers one main button. Filled means something stopped and waits for you; the state's
  own action is outlined in ink; every other control is a lighter outline or sits behind ⋯.
- **Chat.** Work starts here and only here: you ask, Worca proposes, and a task or a schedule begins from its card.
  Chat is the only place you type to Worca.
- **The card.** A task in a chat is a card that answers two questions: what is its state, and what do I do now. It
  holds the state, the stage train, one message and the vitals.
- **The detail panel.** What you open to investigate (activity, changes, decisions, checks) opens beside the chat, only
  when you ask for it.
- **The places.** Tasks, Schedules, Workflows, Projects, Marketplace, Insights and Settings are views: each has a bar
  that lists its things, a home that sums them up, and a page per thing. A row opens the thing's own page; the page
  names its chat.
- **Facts lead.** What you scan or choose is a labelled value or a control in a fixed place. A sentence is one short
  supporting line, never the control. Nothing moves when a value changes.
- **The library.** Every page is composed from the same components; a page never draws its own. What a page needs and
  the library lacks is added to the library first, with its rule.


| Rule | What | Why | Held by |
|---|---|---|---|
| `stillhet.one-rail` | Everything aligns to one 20px rail and one text edge | Nothing floats, so a page is read straight down | ds-check |
| `stillhet.state-first` | The state word and colour come first, then what you can do; normal is off, only what needs you is lit (`look.alert-ladder`) | You see what is happening before anything else | run-page-sweep |
| `stillhet.one-place` | A fact appears once; everything else links to it | Two copies drift and make you compare | by hand |
| `stillhet.one-action` | Each state offers one main control; the rest sit behind ▾ and ⋯. Only a Warning's action is filled (`look.alert-ladder`); a page with no Warning keeps its own primary (send, Start, Save) | You never have to weigh buttons, and filled means it stopped | run-page-sweep |
| `stillhet.quiet` | Labels, banners and help appear only when there is something to say | Quiet pages make the exception visible | by hand |
| `stillhet.scan-first` | Facts lead, sentences support: what a person scans or chooses is a labelled value or a control in a fixed place, and a sentence is at most one short supporting line in the secondary style. Nothing changes size or place when a value changes | A sentence of pickers has to be read every time and reflows with every pick; a labelled place is learned once | by hand |
| `stillhet.chat-first` | Work starts in Chat and nowhere else: Tasks and Schedules are views to inspect, with no + and nothing that starts or edits work. A page hands itself to Chat with one **Ask about it in chat** (or, on a schedule, **Change in its chat**, `panel.schedule-change`), and what exists stays answerable where you see it (Answer, Approve, Merge, Retry, Pause, Resume, Stop, Run now) | One place where work begins, so you always know where to go and what a page is for | by hand |
| `stillhet.work-and-talk` | A task is the work; a chat is where you talk about it. A thing's row, card title or search result opens the thing's own page in every mode, and each end names the other (`thing.from-chat`) | You always know whether you are looking at the work or talking about it | by hand |
| `stillhet.hand-to-chat` | Whatever a place sends to Chat arrives as a removable chip in the composer, its kind and its name, and goes with the message. Pages call the one handover, never pre-written text | What you chose is what Worca gets, the same way from every place | handover-check |
| `stillhet.hand-picks` | A workflow or project a handover picks is also set in the composer's own pickers; changing it there drops the chip | The chip and the pickers never say two things | handover-check |
| `stillhet.drafts` | What you build by hand (a workflow, an agent, a script, a workspace, Team policy) is a draft until you save it: tasks keep running the saved one, and a DraftBar on the thing counts the changes and offers Discard and Save. Leaving keeps the draft; a chat's proposal is a draft until you apply it | You can try a change without breaking what runs, and come back to it | design-system-components |
| `stillhet.undo-sends-nothing` | A delete with Undo in its notice sends nothing until the notice ends (it times out, the next notice replaces it, or the page closes); Undo sends nothing at all | Undo is true: nothing has to be brought back | design-system-components |
| `stillhet.center` | A page outside Chat is first of all a center: what you land on for that thing, with the bar's one model (`list.bar-model`) | You always know where you are and what is there | by hand |
| `stillhet.still` | Nothing moves by itself; a click or repaint never scrolls the page | You never lose your place | run-page-sweep |
