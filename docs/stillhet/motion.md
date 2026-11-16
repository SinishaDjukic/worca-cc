# Motion

| Rule | What | Why | Held by |
|---|---|---|---|
| `motion.timings` | Three timings on one curve (`--ease`, `cubic-bezier(.2, 0, 0, 1)`): `--motion-quick` 150ms when something appears, opens or goes, `--motion-change` 200ms when something becomes something else, `--motion-flash` 1.2s for the one flash after a jump. Nothing is slower; nothing bounces | Motion stays a signal | stillhet-docs |
| `motion.fade` | What appears fades in, what goes fades out, and what is around it moves to its new place at the same pace. Only a thing arriving or leaving its own place may move a few pixels (a new row drops 4px, a folding section's rows rise 6px) | What changed is clear without a trip across the screen | by hand |
| `motion.never` | Never a transition between pages or tabs, a slide, a spring, a bounce, a count-up, a spinner, a skeleton shimmer, a parallax, motion on scroll, or anything that runs without a state change | Motion shows what changed, never decorates | by hand |
| `motion.reduced` | Under reduced motion every timing is 0: a breath is a still colour, the shimmer a still wash, the flash a still outline for the length of `flash`, and the page jumps instead of scrolling | Respects the person's setting | by hand |
| `motion.morph` | A page redraws with `morph()`, never raw innerHTML; a page whose parts are strings patches them with `patchParts`. Raw innerHTML is only for a frame built once | What stays keeps its element, its focus and its eased colour | design-system-components |
| `motion.data-motion` | A component says how it moves with `data-motion`: `in` (a menu, a popover, a dialog), `open` (the ConfirmStrip, a row's detail: its space opens too), `change` (the state word and mark), `swap` (a label replaced in place). A page never animates by hand, and going to another page passes `{ motion: false }` | One place decides motion, and reduced motion is handled there | design-system-components |
| `motion.fold` | Every toggle that opens something in place moves the same way: the part fades as its space opens or closes, what is below moves with it and the chevron turns, over `change`. The library does it (`watchFolds`); a page does nothing | Opening reads as one thing unfolding, and you see where it went | design-system-components |
| `motion.small` | Small motion says what changed, once, and only where you look (the table below); a new row is tinted for the flash once ever, so a filter or a fold showing it again is no arrival | The screen never changes under you without saying how | design-system-components |
| `motion.attention` | What needs you breathes as a whole, slowly and softly (about 4s a breath), in its state's colour: amber asks, red failed. Never a shake or a bounce; under reduced motion it holds a quiet edge in that colour | You see where to look without being pulled | by hand |
| `motion.attention-row` | In a bar or a list the whole row that needs you breathes whenever it is not the one you have open, and only that row: a waiting task breathes, its chat and its group hold still. It stops only when it no longer needs you | The breath points at the one thing to open | by hand |
| `motion.attention-card` | In a chat only the newest card that needs you breathes, as only one button is filled: softly in and out as a whole, never an edge or a filled panel. It keeps breathing a while once you open the chat (3 seconds; Settings › Notifications › Breathing: 1, 3 or 5 seconds, or until you act) and stops at once when you act | A long chat shows one place to answer | by hand |
| `motion.pulse-icon` | The Pulse icon holds still by default. With Pulse icon motion on (Settings › Appearance) it shakes when its count grows, again every 3.5s, until you read or act; never under reduced motion | News may call, but only when the person asked it to | design-system-components |
| `motion.stage-advance` | When a stage train reaches a later stage its last notch fills, the notches pulse once, the line travels to the next knot and that knot pops once. Once per change, never on first sight, none under reduced motion (`watchStageAdvance`) | The one moment a task moves on is seen | design-system-components |
| `motion.crafting` | While Worca makes a thing (a workflow, an image, a document) a Crafting stands where the thing will be: a small sketch of that kind draws itself line by line, holds, fades and starts again (about 3.2s), with one line saying what is being made. Under reduced motion the sketch stands drawn | Making reads the same everywhere, calm, and says what is coming | design-system-components |
| `motion.scroll-fade` | Every column that scrolls under something (a chat, the bars, Settings and its menu, Pulse's panel, a task's page, Tasks) fades at the edge where there is more, eased over 200ms and gone at either end. A chat fades over its last 32px above the composer and its first 24px under the top bar | It reads as one surface sliding under another, with no shadow or line, and the last line is never dimmed | design-system-components |
| `motion.scroll-measure` | A column is measured only when it scrolls, resizes or its content changes; a draw that changes nothing measures nothing | A fade must not cost a frame | design-system-components |
| `motion.live-holds` | A live update never moves what you are reading: what arrives above holds its place until you scroll there | You never lose your place | by hand |
| `motion.follow-end` | A chat at its end (its last `PIN` px in view, `scroll-fade.mjs`) stays at its end as a reply grows; scrolled further up it holds its place and a quiet Latest floats above the composer. Opening a chat lands on its newest turn; a follow moves only the scroll box, at once (`pinnedToEnd`) | You read the reply as it is written, and never lose a place you scrolled to | design-system-components |
| `motion.away-screen` | The away screensaver is the one thing that moves without a state change: with Away and Keep awake on and the window focused it starts after 5 idle minutes, never under reduced motion. Any input hides it and does not reach the page (`awayShows`) | The named exception, so there is no second one | design-system-components |

## What moves, moment by moment

| Moment | Motion |
|---|---|
| A row opens or closes its detail (`motion.fold`) | the detail fades as its space opens or closes, over `change`; the chevron turns; what is below moves with it |
| A row arrives or leaves (Pulse, Tasks, a cleared update) | fades in or out over `quick`; a new row drops 4px; the rows around it move to their place |
| A date section folds or opens | its rows rise and fade, or come down, over `change` |
| A state changes (the word, the mark, a step's mark) | the old fades out, the new fades in, over `change`; a changed mark's ring fills to its stage, then pulses once |
| A text replaces another in place (`Merging…` for `Merge PR`) | crossfade over `quick` |
| A menu, popover, tooltip or panel opens | fades in over `quick` (a tooltip after its usual delay); closes at once |
| A Dialog or the ConfirmStrip opens | fades in over `quick`; the strip's space opens with it |
| A Switch changes | the thumb moves over `quick`; the track's colour over `change` |
| A tick box is ticked | the tick fades in over `quick` |
| A tab is chosen | its line grows from the centre; a pressed tab dips |
| Hover and press | the tint over 100ms |
| A Toast | fades in over `quick`, out over `change` |
| A link or a search lands on a fact's home | the target comes into view, lights once and fades over `flash`; focus moves to it (`land()`) |
| The bar switches place, or becomes Settings' menu | its content fades over `change`; the page changes at once |
| The search takes the focus | its width grows over `change` (`keys.search`) |
| The drawer (760px and below) | fades in over `quick`, never a slide; closes at once |
| Work is happening | the running sign breathes (`look.running-sign`) |
| Worca writes in a field | the violet shimmer, while it writes |
