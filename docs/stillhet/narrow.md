# Narrow screens

| Rule | What | Why | Held by |
|---|---|---|---|
| `narrow.nothing-dropped` | A narrow page holds everything the wide one does | Things move, they are never dropped | run-page-sweep |
| `narrow.nav` | From 761 to 1080px the bar starts as its strip of icons (56px); at 760px and below it is a drawer that shows each row's icon and name | A phone keeps its width; a tablet keeps every place one tap away | worca-sweep |
| `narrow.frame-toggles` | MenuButton (the phone's hamburger) and SideToggle (the wide screen's collapse) both carry `aria-expanded` and `aria-controls` for the bar; SideToggle hides from 1080px down, MenuButton shows at 760px and below | One bar, three widths, a button for each way in | design-system-shell-frame |
| `narrow.stack` | At 520px of content (560px for a settings row and a form's grid) side by side becomes one above the other, on the same text edge | The one rail holds at any width | run-page-sweep |
| `narrow.one-line-or-wrap` | A name (a title, a stage's name, a row's title) keeps one line and ends in an ellipsis, with the whole text in its tooltip; a sentence wraps | A name is recognised, a sentence is read | pulse-sweep |
| `narrow.state-word` | A state word is never cut: the name beside it shortens. A row's reason wraps, and a word stays with its picker | The part you need is the part a cut loses | pulse-sweep |
| `narrow.branch-fold` | A branch or a path loses its middle, never its end (`feat/unifi…-breadcrumb`); the full name is in its tooltip and a click copies it. The short name beside it (`dev`, a PR number) never shortens | The end tells two apart | design-system-logic |
| `narrow.touch` | On touch a list shows its marks; tick boxes take the mark's place only while selecting, started by a long-press or Select. What needs a pointer moves to its editor (a tag's ×) | State comes first, and nothing depends on hover | by hand |

## What changes at which width

| Width | What changes |
|---|---|
| 1180px of window and below | no page background (`look.backgrounds`) |
| 1080px of window and below | the bar starts as its strip; opened there, it stays open until a reload |
| 760px of window and below | the trail is one link, `‹ Parent`; the bar is a drawer; a panel or a Dialog takes the window's width; a menu stays 16px inside it; the chat's timeline is not drawn (`panel.timeline`) |
| 560px of content | a settings row's name goes above its value and its control under the supporting line; a form's grid is one column (`form.grid`) |
| 520px of content | the StatusLine's action slot moves under the state word and its detail, the main step and its ▾ whole, its other buttons as items of ⋯; a ListRow keeps its mark, its title and its end, and its other columns wrap under the title; Figures and a section head's actions wrap to the next line; Tabs keep one line and scroll sideways inside their strip |
| 520px of window and below | a panel's row puts its step on its own line under the text, on the text edge |
| 480px of window and below, or when the top bar runs out of room | a top-bar button with a label keeps only its icon; its tooltip names it |
| 390px | a page's filter line keeps one line and its `end` slot wraps under it (`list.filters`); the page itself never scrolls sideways |
