# Narrow screens

| Rule | What | Why | Held by |
|---|---|---|---|
| `narrow.nothing-dropped` | A narrow page holds everything the wide one does | Things move, they are never dropped | run-page-sweep |
| `narrow.nav` | At 761–1080px the sidebar is a rail of icons; at 760px and below it is a drawer | A phone keeps its width; a tablet keeps every place one tap away | worca-sweep |
| `narrow.stack` | At 520px of content side by side stacks on the same text edge | The one rail holds at any width | run-page-sweep |
| `narrow.branch-fold` | A branch or path loses its middle, never its end | The end tells two apart | design-system-components |

A narrow page holds everything the wide one does: things move, they are never dropped. Two widths decide it, and the
prototype does both at 375px.
- **1080px of window and below:** the sidebar becomes its rail of icons (60px), so every place stays one tap away.
- **760px of window and below:** the trail becomes one link, `‹ Parent`; the sidebar becomes a drawer, because a rail
  would take a sixth of a phone's width; a panel or Dialog takes the window's width; a menu stays 16px inside it.
- **520px of content and below** (the card or panel's own width): side by side becomes one above the other, on the
  same text edge:
  - the StatusLine's action slot moves under the state word and its detail; the main step and its ▾ stay whole, and
    the action slot's other buttons (Pause, Run after) fold into ⋯ as items of their own;
  - a settings row's name goes above its sentence, and the row's button under the sentence;
  - a ListRow keeps its mark on the rail, its title and its time or figure at the right; its other columns wrap to a
    second line under the title;
  - Figures and a section head's actions wrap to the next line; Tabs keep one line and scroll sideways inside their
    strip, the page never does.
- **480px of window and below,** or whenever the bar runs out of room (a side column takes the space): a top-bar
  button with a label keeps only its icon, and its tooltip names it.
- **One line or wrap:** a name (the title, a stage label, a row's meta) keeps one line and ends in an ellipsis, with
  the whole text in its tooltip; a sentence wraps.
- **A branch or a path loses its middle,** never its end: its start and its last part stay (`feat/unifi…-breadcrumb`,
  `ui/…/run-head.mjs`), since the end is what tells two apart. The full name is in its tooltip and a click copies it.
  The short name beside it (`dev`, the PR number) never shortens.
- **Touch:** a list shows its marks by default, since state comes first; tick boxes take the mark's place only while
  selecting, started by a long-press or the list's `Select`. What needs a pointer moves to its editor (a tag's ×).
