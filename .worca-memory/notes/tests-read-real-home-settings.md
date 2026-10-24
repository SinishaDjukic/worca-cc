---
name: tests-read-real-home-settings
description: Read before adding a user setting that changes run behaviour, or when a test passes in CI but fails on one developer's machine.
paths: src/core/settings.mjs, test/helpers/temp-home.mjs, test/**/*.test.mjs
updated: 2026-09-27T21:03:51.221Z
author: Bulibas
---

`test/helpers/temp-home.mjs` (`useTempHome`) swaps ONLY `WORCA_HOME` and resets the db singleton.
`src/core/settings.mjs` reads `settings.json` from `$HOME/.worca-cc` (falling back to `USERPROFILE`, then `os.homedir()`), and it never uses `WORCA_HOME` for this. It re-reads the file on every `readSettings()` call; nothing is cached.

As a result, every existing test that builds an orchestrator reads the developer's REAL settings. This includes the `auto: true` tests such as `test/writeback.test.mjs`. A new setting that changes run behaviour can therefore turn tests red on one machine only. Night mode is one example, because it changes how `--yes` answers gates and recovery.

What to do:
- In a test that exercises such a setting, swap `HOME` and `USERPROFILE` to a temp dir in `before`/`after`. `test/policy-local.test.mjs` shows the pattern.
- Run the full suite with a clean user layer: `HOME="$(mktemp -d)" env -u WORCA_HOST_PID npm test`.
