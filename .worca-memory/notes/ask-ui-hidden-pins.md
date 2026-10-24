---
name: ask-ui-hidden-pins
description: Read before planning or reviewing a change to the Chat panel's DOM, the top bar, the page shell, openChat entry points or a new ask-api server test — the pins a
paths: ui/public/ask-panel.mjs, ui/public/app.js, ui/public/index.html, ui/public/style.css, ui/public/topnav-search.mjs, test/ask-api-*.test.mjs, test/ui-chat-*.test.mjs, test/ask-panel*.test.mjs
updated: 2026-10-24T20:27:39.788Z
author: Denislav Prinov
---

Found replaying "Ask worca beside the page" (2026-10-24, 8 tasks). Each one turned a green-looking plan red.

## Pins on markup and copy
- `test/ui-chat-name-copy.test.mjs` bans `/Ask Worca/gi` in ui/public, ui/server.mjs, src and the extension: ANY "Ask worca" string (button, aria-label, heading) fails it. That run narrowed the pattern to case-sensitive `/…Ask Worca…/g` (the old capitalised name stays banned) — check it is still so before adding copy.
- `test/ask-panel.test.mjs:41` pins `[data-chat-composer-lead]:first-child` of `.ask-composer-box`; `test/extension-sidebar-markup.test.mjs` compares the extension's box children with the panel's — a new box child needs a filter there.
- `test/ask-panel-history.test.mjs` pins the History column's children (`head, new, body`) and the `[data-ask-new-btn]` count.
- `test/ui-topnav-shell.test.mjs` pins `.main-col`'s children; `test/ui-activity-topnav.test.mjs` pins `.topnav-r`'s child ids; both use line-exact phone-block slices — put new tier rules in your own `@media` block.
- `test/ui-terminal-layout.test.mjs` counts the exact line `if (e.target?.closest?.('.term-pane')) return;` (4): an extra Escape exemption goes on its OWN line.
- `test/ui-design-language.test.mjs` A5: a `*-chip`/`*-btn` class at 26/31/34/36/43/44px height is red (use 28/32).
- `.btn` is `display:inline-flex` and style.css has no global `[hidden]` rule: a hidden `.btn` needs its own `[hidden]{display:none;}` twin.
- `openChat` from a non-Chat page is pinned to land on `#chat` by `ui-chat-page-app`, `ui-chat-route`, `ui-diff-comments` and `ui-topnav-search-app` (the "Ask in Chat" row).

## Behaviour traps
- `RUN_PAGE_PARTS` (prompt.mjs) must hold every Details tab key of `RD_TABS`/`HD_TABS` (`changes`, `actions` were missing): an unknown `runPage` makes `validateClientContext` refuse the whole message with 400.
- A Details tab click only `replaceState`s and a Diff file pick only sets `.active`: no hashchange. Anything that repaints from `getPageContext()` needs its own hook.
- The Chat home's `.chat-page[data-view="home"] .ask-composer > .ask-pop` opens composer menus DOWNWARD; a composer docked at the bottom on home needs an upward override.
- `openPage()` always focused the composer; `enterChatView` on a bare `#chat` opens the UNREAD chat — use `chat/new` to keep a new chat.
- app.js page-level Escape arms (History/Running detail, project page, workspace-create) are document CAPTURE listeners: they run before element handlers, so they need an exemption for any new surface holding a text field.

## Test-harness traps
- An ask-api test that posts a message and ends without `await idle()` (or settling the turn) lets the file's `after()` delete `WORCA_MOCK` before the turn's async title job spawns: the real CLI hits the no-real-claude guard, `npm test` exits 1 with 0 failures — only in the full suite, never alone. Compare `N test spawn(s) reached the real-claude guard` with a checkpoint run.
- `bootChat` boots one app per jsdom window and rebinds the global `document`: an app.js observer/timer callback that reads the global `document` throws "after the test ended" once another test booted. Capture the node at creation and bail when `document.body !== body`.
- The workspace page in `bootChat` needs `/api/team-metrics/scopes` and `/api/policy/scopes` arms (`paintWsMetricsRows` throws on the default body).
