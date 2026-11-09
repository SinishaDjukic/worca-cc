# Narrow screens

| Rule | What | Why | Held by |
|---|---|---|---|
| `narrow.nothing-dropped` | A narrow page holds everything the wide one does | Things move, they are never dropped | run-page-sweep |
| `narrow.nav` | At 761–1080px the sidebar is a rail of icons; at 760px and below it is a drawer | A phone keeps its width; a tablet keeps every place one tap away | worca-sweep |
| `narrow.stack` | At 520px of content (560px for a settings row) side by side stacks on the same text edge | The one rail holds at any width | run-page-sweep |
| `narrow.state-word` | A state word is never cut; a row's reason wraps; a word stays with its picker | The part you need is the part a cut loses | pulse-sweep |
| `narrow.branch-fold` | A branch or path loses its middle, never its end | The end tells two apart | design-system-logic |

A narrow page holds everything the wide one does: things move, they are never dropped. Two widths decide it, and the
prototype does both at 375px.
- **1080px of window and below:** the sidebar starts as its strip of icons (56px), so every place stays one tap away; opened there, it stays open until a reload.
- **760px of window and below:** the trail becomes one link, `‹ Parent`; the sidebar becomes a drawer, because a rail
  would take a sixth of a phone's width; a panel or Dialog takes the window's width; a menu stays 16px inside it.
- **520px of content and below** (the card or panel's own width; a settings row and a settings record at 560px): side by side becomes one above the other, on the
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
- **One line or wrap:** a name (the title, a stage label, a list row's meta) keeps one line and ends in an ellipsis, with
  the whole text in its tooltip; a sentence wraps. A Pulse row's meta is its reason, so it is a sentence. A state word
  (`Resolved`) never shortens: the name beside it does. A list's sentence breaks between its parts: a word stays with
  its picker.
- **A panel's rows:** a panel is under 520px, so at 520px of window and below a row's step sits on its own line under
  the text, on the text edge; wider, under the time, its words ending on the time's edge.
- **A branch or a path loses its middle,** never its end: its start and its last part stay (`feat/unifi…-breadcrumb`,
  `ui/…/run-head.mjs`), since the end is what tells two apart. The full name is in its tooltip and a click copies it.
  The short name beside it (`dev`, the PR number) never shortens.
- **Touch:** a list shows its marks by default, since state comes first; tick boxes take the mark's place only while
  selecting, started by a long-press or the list's `Select`. What needs a pointer moves to its editor (a tag's ×).
