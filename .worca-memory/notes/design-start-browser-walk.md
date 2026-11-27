---
name: design-start-browser-walk
description: Traps when checking the design start (#chat/new/design, its tiles and popups) in a real browser
paths: ui/public/design/**, ui/public/ask-panel.mjs
updated: 2026-11-27T06:59:20.119Z
author: Denislav Prinov
---

Checking the design start (`#chat/new/design`: heading, composer, kind buttons, the designs grid) in headless Chrome
via playwright-core cost two extra passes on 2026-11-26. Three traps:

- **Two headings match.** The Chat page keeps the hidden Chat home's `h1.chat-home-title` ("What should worca do?")
  before the start's, so `.chat-page[data-view="design"] .chat-home-title` resolves to the hidden one and a
  `waitForSelector` times out. Select `.dz-start-in-chat .chat-home-title`.
- **"The heading does not move" needs a layout position.** Playwright's `click()` and `fill()` scroll their target
  into view, and Show fewer calls `scrollIntoView` itself, so a viewport `getBoundingClientRect().top` jumps (190 ->
  -162) with no layout change. Measure `rect.top + window.scrollY + Σ ancestor.scrollTop`. On the checkpoint and after
  the designs grid landed, that is 190 px at 1440, 1024, 390 and 290 wide.
- **The composer's model pill is Advanced only** (`[data-ask-model-btn]`, `data-min-level="advanced"`): at the default
  level `click()` waits 30 s on "element is not visible". `POST /api/settings {uiLevel:'advanced'}` before the page
  loads. The gear's popup (`.dz-set-pop`) opens upward and never covers the tiles; the model and project menus
  (`.ask-pop`) open downward over the kind buttons and tiles.

Seeding: set HOME/USERPROFILE/WORCA_HOME (+ `WORCA_TEST_ALLOW_HOME_FALLBACK=1`) in the script's own `process.env`,
then `import()` `src/core/design/store.mjs` and call `createDesign({kind, title})` before spawning `ui/server.mjs`
(`WORCA_FLAGS=design WORCA_MOCK=1`, a free port from `net.createServer().listen(0)`), as
`tools/verify-design-stage-cdp.mjs:248-260` does. Launch Chrome with the REAL HOME in its env, or it gets the temp one.
For the "as before this branch" comparison, `git -C <worktree> archive <checkpoint> | tar -x -C <scratch>/base` with
`node_modules` symlinked serves the checkpoint UI fine (`preflightDeps` passes: same package.json).
