# One Rail: the philosophy

| Rule | What | Why | Held by |
|---|---|---|---|
| `rail.one-rail` | Everything aligns to one 20px rail and one text edge | Nothing floats, so a page is read straight down | ds-check |
| `rail.state-first` | The state word and colour come first, then what you can do; normal is off, only what needs you is lit (`look.alert-ladder`) | You see what is happening before anything else | run-page-sweep |
| `rail.one-place` | A fact appears once; everything else links to it | Two copies drift and make you compare | by hand |
| `rail.one-action` | Each state offers one main control; the rest sit behind ▾ and ⋯. The primary button belongs to a Warning (`look.alert-ladder`); a Caution or Advisory action is outlined. A page with no Warning keeps its own primary (the composer's send, Start, Save) | You never have to weigh buttons, and filled means it stopped | run-page-sweep |
| `rail.quiet` | Labels, banners and help appear only when there is something to say | Quiet pages make the exception visible | by hand |
| `rail.drafts` | What you make or change by hand (a workflow, an agent, a script, on its page or its canvas) is a draft until you save it: tasks keep running the saved one; a DraftBar on the thing says it is a draft, how many changes it holds, Discard and Save; leaving keeps the draft, and Drafts in the bar lists every one with its count; a thing never saved is a draft that nothing can run. A chat's proposal is a draft too: its card, until you apply it | You can try a change without breaking what runs, and come back to it | design-system-components |
| `rail.hand-to-chat` | Whatever a place sends to Chat arrives as a chip in the composer, its kind and its name, removable, and goes with the message. A workflow or project it picks is also set in the sentence; changing that there drops the chip. Pages call one handover, never pre-written text | What you chose is what Worca gets, the same way from every place | handover-check |
| `rail.chat-first` | Every feature is embedded in the chat, the main way to make and change things, and Chat is the only place to type to Worca: no composer on any other page. Other pages keep manual creation as the **legacy approach**, in those words, quiet. From Advanced up Tasks and Schedules keep it too, as Workflows and Projects do: their + holds Ask in chat, then Legacy approach. In Simple nothing is created there and they have no +. What exists stays controllable (Pause, Run now, Stop, Approve) | One place to make things, without taking the manual way from those who want it | by hand |
| `rail.stay-in-chat` | Unless you are in Expert, or a mode that turns a feature on, you stay in the context of the chat, represented by the card: links, search, Pulse and bars lead to the card in its chat, not to a page | The chat stays the one place you are | by hand |
| `rail.center` | A page outside Chat is first of all a center: what you land on for that thing, with the same or similar sidebar logic, adapted to the case (list.bar-model) | You always know where you are and what is there | by hand |
| `rail.still` | Nothing moves by itself; a click or repaint never scrolls the page | You never lose your place | run-page-sweep |

Every screen reads down one rail, and everything has one place on it.
1. **One rail.** Everything aligns to a single 20px rail and one text edge (rail + 12px gap); a dot, a step, a member
   run or a PR is a row on it. Nothing floats.
2. **State is the headline.** The first thing read is what is happening (a word and a colour that only ever mean a
   state), the second is what you can do about it.
3. **One place per fact.** A count, time, cost, PR number or question appears once; everything else links to it.
4. **One action, the rest behind ⋯.** Each state offers the one critical control; alternatives sit in its ▾, supporting
   actions in ⋯ next to it, danger last after a rule.
5. **Quiet until needed.** Labels, tags, banners and help appear when there is something to say; help lives in
   tooltips, not lines.
6. **Nothing moves by itself.** No jumps, no reflow on hover, no animation that is not a state change (Motion); a click, a
   repaint or a menu never scrolls the page.
7. **Drafts first.** What you change by hand is a draft until you save it; what runs keeps running the saved one,
   and a draft waits for you where you left it.
8. **Chat first; manual is the legacy approach.** Every feature lives in the chat, the only place to type to Worca; other
   pages keep manual creation as the legacy approach; Tasks and Schedules from Advanced up, and in Simple they create nothing.
9. **Stay in the chat, land on a center.** Outside Expert you stay with the card in its chat; a page outside Chat is a
   center for its thing.
