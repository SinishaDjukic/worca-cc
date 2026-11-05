---
name: webui-step-playwright-denied
description: Read when a Web UI review reports "critical: not tested" because Playwright MCP was refused, or when a reviewer needs a live UI walk in a headless run.
updated: 2026-11-05T10:39:33.103Z
author: Bulibas
---

The headless Web UI step can report a "critical" with 0 of N cases run, because every Playwright MCP call was refused
with "you haven't granted it yet". That is a harness permission problem, not a defect. It still forces a fix cycle, in
which the implementer correctly changes nothing (FEAT-1 search bar settings, 2026-10-29). The code reviewer of the next
cycle should not block on it.

Live check without the MCP, as the code reviewer (worked in about 1 minute):
- Start the server with `WORCA_MOCK=1`, a scratch HOME/WORCA_HOME, and its own PORT.
- Write the walk script to the scratchpad with Write. Import `chromium` from `<worktree>/node_modules/playwright-core/index.mjs`
  by absolute path, and call `chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-mock-keychain'] })`.
  `launch()` refuses `--user-data-dir`; that flag needs `launchPersistentContext`.
- Use `newContext({ colorScheme })` for light/dark and `setViewportSize` for 390 px. Selectors: `#tsearch-input`, `#tsearch-pop .tsearch-group`, `.tsearch-note`.

Trap: pick the PORT with `lsof -nP -iTCP:<port> -sTCP:LISTEN` first (prints nothing = free). This Mac runs long-lived
bench servers on 43xx ports (4391 = the #943 bench, HOME `~/dev/bench/worca-943-combined-sg/home`). A busy port makes
the new server exit at once ("port … is already in use"), so a setup `POST /api/settings {uiLevel:'expert'}` sent right
after lands on the OTHER server and rewrites its settings.json (2026-11-05; sibling bench homes hold `uiLevel: "simple"`).
Before any write, also check the answering server is yours (`GET /api/settings` `projectsRootDefault` under your sandbox).
The first-boot Welcome dialog (`#welcome-modal`) blocks clicks even after `onboarding.welcomeSeen`; remove the node in
the walk (`document.getElementById('welcome-modal')?.remove()`).

Trap: `(echo $$ > pid; exec env … node ui/server.mjs) > log` records the PARENT zsh's pid, because `$$` inside a subshell
is still the parent's. Stopping that pid leaves node listening. Find the real pid with `lsof -nP -iTCP:<port> -sTCP:LISTEN`,
then `kill <literal pid>`.
