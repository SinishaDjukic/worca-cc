# Motion

| Rule | What | Why | Held by |
|---|---|---|---|
| `motion.timings` | Three timings, one curve; nothing slower, nothing bounces | Motion stays a signal | design-system-components |
| `motion.fade` | Fade, never slide; nothing travels across the screen | What changed is clear without a trip | by hand |
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
| Working | the live dot and the live cell breathe: the one thing that moves on its own, because it means work is happening |
| Worca writes in a field | the violet shimmer, while it writes |

- **Never:** a transition between pages or tabs (they change at once), a slide, a spring, a bounce, a count-up, a
  spinner, a skeleton shimmer, a parallax, motion on scroll, or anything that runs without a state change.
  The one named exception is the away screensaver: it starts after 5 idle minutes and is off under reduced motion.
- **Reduced motion** (`prefers-reduced-motion`): every timing is 0; the breathing is a still colour, the shimmer a still
  wash, the flash a still outline that fades with the next click.
- **In code:** a page that draws itself again after a change draws with `morph(target, html)` from
  `ui/public/design-system/components/motion.mjs`, never innerHTML: what is still there stays the same element, so its
  colour eases by its CSS transition, and only what is new or changed moves. A component says how it moves with
  `data-motion`: `in` (a menu, a popover, a dialog), `open` (the ConfirmStrip, a row's detail: its space opens too),
  `change` (the state word and dot), `swap` (a label replaced in place). Going to another page or run passes
  `{ motion: false }`. A page never animates by hand; reduced motion is handled there.
- A live update never moves what you are reading: what arrives above it holds its place until you scroll there (Pulse
  and the group page already keep this).
