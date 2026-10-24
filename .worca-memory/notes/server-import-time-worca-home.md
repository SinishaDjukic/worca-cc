---
name: server-import-time-worca-home
description: Never call worcaHome() at module top level in ui/server.mjs — server tests import it before setting WORCA_HOME
paths: ui/server.mjs
updated: 2026-10-04T22:33:30.391Z
author: Bulibas
---

Many server test files (`test/settings-api.test.mjs`, the index.html shell tests, …) `import('../ui/server.mjs')`
BEFORE they set `WORCA_HOME`. Under `node:test`, `worcaHome()` throws when `WORCA_HOME` is unset
("tests must never touch the real ~/.worca-cc"). So a top-level `worcaHome()` call in `ui/server.mjs`
(for example `createX({ home: worcaHome() })`) fails a whole file at import time. The scoped tests you wrote pass, and only
the full suite shows about 20 red tests in unrelated files.

Pass it lazily instead (`home: () => worcaHome()`) and resolve it at use, the way the terminal manager's
`pidFile`/`zshDir` getters already do (`Object.defineProperty(terminals, 'pidFile', { get: … })`).
Before you hand off, run the full suite (`GIT_CONFIG_GLOBAL="$HOME/.gitconfig" HOME="$(mktemp -d)" env -u WORCA_HOST_PID npm test`).
