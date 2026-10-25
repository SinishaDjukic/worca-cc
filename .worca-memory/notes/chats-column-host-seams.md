---
name: chats-column-host-seams
description: Read before adding anything to the Chat page's History aside or head, or merging dev past #953 into a branch built on the old History column — what the Chats co
paths: ui/public/ask-panel.mjs, ui/public/chats-column.mjs, ui/public/style.css, test/ask-panel*.test.mjs, test/ui-chat-style.test.mjs, test/ui-chats-column.test.mjs
updated: 2026-10-25T07:35:56.772Z
author: Denislav Prinov
---
Dev's Chats column (#948 s2/s3, #953 retired the `chatsColumn` flag and the old History column) broke a side-chat branch in five silent ways while merging cleanly in app.js/style.css (PR 954 merge, 2026-10-25). See also [[ask-ui-hidden-pins]].

- `mountChatsColumn({host})` does `host.replaceChildren(head, chip, list, bar)`: anything added to `aside.chat-history` in `buildHistory` vanishes. Append extras AFTER the mount (in `mountChats`).
- The column owns the thread list (no `renderHistory`, no `?q=` search — search lives in the top bar's Chats group). A consumer of the rows reads them through `mountChatsColumn`'s `onThreads(threads, view)` (called on every paint); only `view.show === 'all'` is the whole list, and pinned chats lead it (sort yourself for "newest").
- `test/ui-chat-style.test.mjs` bans the OLD class names anywhere in style.css (`ask-thread-(row|pick|dot|col|title|meter|when|fill|topics|match)`, `chat-history-(head|…|body|…)`, `chat-new-btn`): reused markup needs new names.
- `.chat-page[data-chats="on"] .chat-history` (and its 1099px media twin) is (0,3,0) and `data-chats="on"` is always set: any `.chat-page[data-x] .chat-history` override ties and must come AFTER dev's block. Dev also hides the composer meter (`[data-chats="on"] [data-ask-meter]`) for the head's `.chat-head-meter`, and adds `.chat-new-plus` + `.runs-resize` (absolute, in the aside) — a re-host must hide or restate each.
- `onChatKeys` is a DOCUMENT listener gated only on `st.open` (⌘\, ⇧⌘L, ⌥⌘N, ⌥↑/↓, `?`); the column's menus, group picker and keys sheet append to `body` (outside `el.page`). A host showing the panel beside another page must gate keys to `el.page.contains(target)` and exempt `.wfv-menu, .group-picker, .keys-modal` from outside-press closes.
- Dev paths that remove chats bypass `deleteThread`: `onChatsGone` (Delete group) and `chatsCol.onFrame` (history clear). Per-chat state kept elsewhere (unread dot, recent rows) needs its own cleanup there.
- Old-column tests: the trash is now ⋯ › Delete… (`deleteFromList(ctx, id)` in `test/helpers/ask-panel-harness.mjs`); views via `#chats-view-btn` → `.wfv-menu [role="menuitemradio"]`.
