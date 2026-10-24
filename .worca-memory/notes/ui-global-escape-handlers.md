---
name: ui-global-escape-handlers
description: Read before adding any UI surface that takes typed keys (an editor, a terminal, a REPL) outside the view's own DOM. Document-level Escape/shortcut handlers in a
paths: ui/public/app.js, ui/public/ask-panel.mjs, ui/public/*.mjs
updated: 2026-10-17T13:38:43.893Z
author: Bulibas
---

`ui/public/app.js` has document-level **capture-phase** Escape handlers that navigate whatever the
event's target is:

- History detail arm (~:24375): closes the detail screen.
- Running detail arm (~:24406): Details goes back to the glance; on the glance in the slide layout it goes to `#runs`.
- Projects detail arm (~:24427): leaves the project page.
- Workspace wizard (~:9104, capture phase since 2026-10-16): clicks Close.

All four stand down while any pop-up is on screen through one DOM check, `dialogOpen(document)` from
`modal-guard.mjs` (an open `.viewer-modal` or `dialog[open]`) — there is no per-modal list to extend any more. The
Scripts page has a fifth, host-level arm (`scripts-view.mjs` `onKeyDown`) with the same bail; see
[[ui-modal-stacking-traps]] for why a page arm that `preventDefault()`s must check it first.

That holds only where `ui/public/modal-guard.mjs` exists (PR #774). A branch cut from an older dev has no such file
(checked 2026-10-17 on the team-memory 1b run, base 73f99f0b): there the project-page arm (~:27031) bails on an
EXPLICIT list (`#confirm-modal`, `#plugin-modal`, `#project-add-modal`, `#project-bulk-modal`,
`.viewer-modal.sync-modal`). Run `ls ui/public/modal-guard.mjs` first; without it, put a new dialog in `#plugin-modal`
(`pluginModal(title, bodyEl, actions)` / `closePluginModal()`) or add it to every arm's list.

Each arm opts subtrees out with its own `e.target.closest(...)` guard (`#runs-search-row`, `.mem-editor`).
A new body-level surface that receives keys (the #573 terminal pane `.term-pane`, any future editor
dock) must add its own guard to **all four**. Otherwise Escape typed there (vim, less, fzf) moves the
page. Because the arms run in capture phase, `stopPropagation` in the surface cannot prevent this.

Ask's Ctrl+K toggle (`ask-panel.mjs` `onDocKeydown`, capture phase) is the same trap: it needs an
`e.target.closest(...)` exemption.

To prove a guard works: in `test/ui-running-detail.test.mjs`, use `bootRunning` + `openGlance`, then
dispatch `keydown` Escape from an element inside the surface and assert the hash is unchanged.

Separate trap on the same path: `/ws` has no backpressure. `send()` and `broadcast()` in
`ui/server.mjs` never check `ws.bufferedAmount`. Any new high-rate stream needs its own flow control;
#573 added `src/core/terminal/fanout.mjs` for this.
