---
name: ask-ui-hidden-pins
description: Read before planning or reviewing a change to the Chat panel's DOM, the top bar, the page shell, openChat entry points or a new ask-api server test — the pins a
paths: ui/public/ask-panel.mjs, ui/public/app.js, ui/public/index.html, ui/public/style.css, ui/public/topnav-search.mjs, test/ask-api-*.test.mjs, test/ui-chat-*.test.mjs, test/ask-panel*.test.mjs
updated: 2026-10-25T00:43:39.650Z
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
- Page changes with NO click and NO hashchange: the History Diff opens its first file itself (`renderFileTree` `initialKey`), the live Diff's first `pick()` is a direct call, a reload on a live run gets the run from the `hello` frame after the first paint. Hook `paintFileList`, that `pick`, and `askRunStore.subscribe` (`pokeAskRuns` fires on every frame and also after the projects load — it masks a `loadProjects` hook's guard in tests).
- A queue item (`enqueueDraft`) must snapshot anything page-derived it sends: it drains after the person may have navigated.
- `showThread(null)` from `wantThread === undefined` (nothing ever shown) runs a full `newThread()` reset (scope, Sets, model). Tests booting `bootChat` on `#chat` start at `null` and never see it — boot on another page with the column open.
- app.js hides the panel BEFORE moving its root, so `openPage`'s unconditional re-pin covers the move; a panel-level `setHost` while open needs its own `applyPin()`.
- CSS: a `position:fixed;top:…;bottom:0` override under a base `height:100%` keeps the height (bottom ignored): add `height:auto` — the dock's phone tier hid the composer 48px below the screen; only a real browser shows it.
- A path that USED to route to `#chat` got side effects from that hashchange for free; a no-route path (the side column) must do them itself: the artifact popup (`artifacts/viewer.mjs` `onHash`) closed — else the column opens under it (z 50) and its `focusin` pulls the focus back (fixed with the `closeOpenViewer` export).
- `openPage` clears the unread dot on ANY show (`setUnread(false)`). A control that mirrors the Chat row's dot must also land where the Chat row does (`askPanel.unreadThreadId()`), or the news of a reply in another chat (a PR fix card) is lost — and a host that re-shows by itself (the column after Chat/Workflows) must keep the dot while it shows another chat.
- Passive `newThread()` (a 404 on load, `ask-history-cleared`) calls `focusComposer()`: a no-op while the Chat section is hidden, a focus theft once the panel shows beside a page — pass `focus:false` there.
- A page chip's id is the left-out key: an id that changes when data lands (a live run's `pipelineId` with the first frame) un-leaves it; an id without its run (`file:<path>`) leaves the same file out on the next run. Key a live run by `runId`, a file by `file:<run>:<path>`.
- An overlay that stays open across routes (the column below 1081px) makes navigation started INSIDE it look dead: the page changes behind it. A delegated `a[href^="#"]` listener misses most of it — the panel routes by hand in `topicRow`, `mcpManageItem`, the progress card's `onOpen` (a default-prevented link) and the `openNewPipeline` dep: grep `location.hash =` in ask-panel.mjs and route each through one helper.
- `.topnav` sizes `.topnav-r` `minmax(max-content,1fr)`: a new labelled bar button takes its width from the PAGE TITLE, on every page (a 113px label left `Runs` an ellipsis at 1081–1110px). Measure the title in Chrome at 1081–1160 and 761–960px (rail) against a checkpoint clone.

## Test-harness traps
- An ask-api test that posts a message and ends without `await idle()` (or settling the turn) lets the file's `after()` delete `WORCA_MOCK` before the turn's async title job spawns: the real CLI hits the no-real-claude guard, `npm test` exits 1 with 0 failures — only in the full suite, never alone. Compare `N test spawn(s) reached the real-claude guard` with a checkpoint run.
- `bootChat` boots one app per jsdom window and rebinds the global `document`: an app.js observer/timer callback that reads the global `document` throws "after the test ended" once another test booted. Capture the node at creation and bail when `document.body !== body`.
- The workspace page in `bootChat` needs `/api/team-metrics/scopes` and `/api/policy/scopes` arms (`paintWsMetricsRows` throws on the default body).
- A test of a late repaint must make the late data actually late: hold the arm's promise (`new Promise((r) => held.push(…))`) and release it after `settle`, else the route's own repaint covers the hook and its revert stays green.
- index.html ships static hidden `.viewer-modal` nodes (confirm, model editor, folder browser…): `querySelector('.viewer-modal')` is never null — the artifact popup is `.viewer-modal.apv`.
- Panel-harness tests that only ever click the pill's `No project` item leave the project/workspace items' handlers unguarded; a host-move test that moves the root by hand never runs app.js's close → move → `setHost` → `open` glue — add a `bootChat` test that streams in the column and routes (Chat row, Open in Chat, Workflows and back).
- `tools/test.mjs` runs a file named twice twice: a plan's "Step 2 command + `$(ls test/ask-panel*.test.mjs)`" line double-counts (v2 quoted 459 for 449 + 2×5). Name each file once.
