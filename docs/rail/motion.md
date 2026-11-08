# Motion

| Rule | What | Why | Held by |
|---|---|---|---|
| `motion.timings` | Three timings, one curve; nothing slower, nothing bounces | Motion stays a signal | rail-docs |
| `motion.attention` | Attention is colour and a breath, everywhere: what needs you breathes as a whole, slowly and softly (about 4s a breath), in its state's colour (amber asks, red failed): in a bar or list its whole row whenever it is not the one you have open (leave it unfixed and it breathes again; it stops only when it no longer needs you), and only the row that needs you (a waiting task breathes; its chat and group hold still, unless the attention is the chat's own), in a chat its whole card until you focus it or act; its mark keeps that colour and holds still; running breathes in ink. In a chat, the card that needs you fades in its colour as a whole, softly in and out (never an edge, never a filled panel that stays). What needs you in a chat (a question, a plan to approve, a gate, a task waiting on you) breathes softly in Rail's amber, like an unread mark (only the newest such thing, as only one button is filled), from when you open the chat or it starts to wait, until you focus it or act on it. Never a shake or a bounce; under reduced motion it holds a quiet amber edge instead | You see where to look without being pulled | by hand |
| `motion.scroll-fade` | A scrolling chat fades over its last 32px where it goes under the composer, and its first 24px under the top bar once scrolled; the fade eases in and out as you scroll (200ms), and is gone at either end, so the last line is never dimmed. While there is more below, a quiet Latest floats just above the input and scrolls to the newest turn | Reads as one surface sliding under the input, calmly, with no shadow or line | design-system-components |
| `motion.fade` | Fade; nothing travels across the screen. Only a thing arriving or leaving its own place may move a few pixels (a new row drops 4px, a folding section's rows rise 6px) | What changed is clear without a trip | by hand |
| `motion.small` | Small motion says what changed, once, and only where you look: a changed mark's ring fills to its stage then pulses; a new row drops in, tinted for the flash timing, once ever (a filter or a fold showing it again is no arrival); a date section's rows rise and fade as it folds and come down as it opens; the bar's list fades in when it switches place; the tab you are on grows its line from the centre and a pressed tab dips. All on the three timings, none under reduced motion | The screen never changes under you without saying how | design-system-components |
| `motion.morph` | A page redraws with morph(), never raw innerHTML | What stays keeps its element and focus | design-system-components |
| `motion.reduced` | Under reduced motion every timing is 0 | Respects the person's setting | by hand |
| `motion.live-holds` | A live update never moves what you are reading | You never lose your place | by hand |

Motion shows what changed, never decorates. Every change of state on the screen eases in, quickly and with one
curve; everything else is still. Filmed from the run page: `plans/rail/mocks/motion-*.gif`.
- **Three timings, one curve:** `--motion-quick` 150ms (something appears, opens or goes), `--motion-change` 200ms
  (something that was there becomes something else), `--motion-flash` 1.2s (the one flash after a jump); all on
  `--ease` `cubic-bezier(.2, 0, 0, 1)`. Nothing is slower; nothing bounces.
- **Fade, never slide.** What appears fades in and what goes fades out; what is around it moves to its new place at the
  same pace, so nothing jumps. Nothing travels across the screen.

| Moment | Motion |
|---|---|
| A row opens or closes its detail | the detail fades over `quick`; the › turns; what is below moves with it |
| A row arrives or leaves (Pulse, Runs, a cleared update) | fades in or out over `quick`; the rows around it move to their place |
| A state changes (the word, the dot, a step's mark, a progress cell) | the old fades out, the new fades in, over `change`; a colour changes over `change` |
| A text replaces another in place (`Merging…` for `Merge PR`) | crossfade over `quick` |
| A menu, popover, tooltip or panel opens | fades in over `quick` (a tooltip after its usual delay); closes at once |
| A Dialog or the ConfirmStrip opens | fades in over `quick`; the strip's space opens with it |
| A Switch changes | the thumb moves over `quick`; the track's colour over `change` |
| A tick box is ticked | the tick fades in over `quick` |
| Hover and press | the tint over 100ms, never a lift or a size change |
| A Toast | fades in over `quick`, out over `change` |
| A link or a search lands on a fact's home | the target comes into view, lights once and fades over `flash`; focus moves to it (`land()` in motion.mjs) |
| The sidebar becomes another menu (Settings) | its content fades over `change`; the page changes at once |
| The drawer (760px and below) | fades in over `quick`, never a slide; closes at once |
| Working | the live dot and the live cell breathe: the one thing that moves on its own, because it means work is happening |
| Worca writes in a field | the violet shimmer, while it writes |

- **Never:** a transition between pages or tabs (they change at once), a slide, a spring, a bounce, a count-up, a
  spinner, a skeleton shimmer, a parallax, motion on scroll, or anything that runs without a state change.
  The one named exception is the away screensaver (`awayShows`, `awayScreen`): with Away and Keep awake on and the window
  focused, it starts after 5 idle minutes and is off under reduced motion; any input hides it and does not reach the page.
- **Reduced motion** (`prefers-reduced-motion`): every timing is 0; the breathing is a still colour, the shimmer a still
  wash, the flash a still outline that stays for the length of `flash`, and the page jumps instead of scrolling.
- **In code:** a page that draws itself again after a change draws with `morph(target, html)` from
  `ui/public/design-system/components/motion.mjs`, never innerHTML: what is still there stays the same element, so its
  colour eases by its CSS transition, and only what is new or changed moves. A component says how it moves with
  `data-motion`: `in` (a menu, a popover, a dialog), `open` (the ConfirmStrip, a row's detail: its space opens too),
  `change` (the state word and dot), `swap` (a label replaced in place). Going to another page or run passes
  `{ motion: false }`. A page never animates by hand; reduced motion is handled there.
- A live update never moves what you are reading: what arrives above it holds its place until you scroll there (Pulse
  and the group page already keep this).
