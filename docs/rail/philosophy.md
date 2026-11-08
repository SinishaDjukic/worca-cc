# One Rail: the philosophy

| Rule | What | Why | Held by |
|---|---|---|---|
| `rail.one-rail` | Everything aligns to one 20px rail and one text edge | Nothing floats, so a page is read straight down | ds-check |
| `rail.state-first` | The state word and colour come first, then what you can do | You see what is happening before anything else | run-page-sweep |
| `rail.one-place` | A fact appears once; everything else links to it | Two copies drift and make you compare | by hand |
| `rail.one-action` | Each state offers one main control; the rest sit behind ▾ and ⋯ | You never have to weigh buttons | run-page-sweep |
| `rail.quiet` | Labels, banners and help appear only when there is something to say | Quiet pages make the exception visible | by hand |
| `rail.drafts` | What you make or change by hand (a workflow, an agent, a script, on its page or its canvas) is a draft until you save it: tasks keep running the saved one; a DraftBar on the thing says it is a draft, how many changes it holds, Discard and Save; leaving keeps the draft, and Drafts in the bar lists every one with its count; a thing never saved is a draft that nothing can run. A chat's proposal is a draft too: its card, until you apply it | You can try a change without breaking what runs, and come back to it | design-system-components |
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
