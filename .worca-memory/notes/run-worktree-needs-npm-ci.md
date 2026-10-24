---
name: run-worktree-needs-npm-ci
description: Read before running any test in a worca run worktree (repos/<key>) — it has no node_modules, so server/WS tests fail at import; it may also have no git remote t
updated: 2026-10-20T01:30:43.236Z
author: Bulibas
---

A worca run worktree (`~/.worca-cc/runs/<id>/repos/<key>`) is checked out with NO `node_modules`
(the real checkout may not have one either). Any test file that imports a dependency — e.g.
`test/ask-api-threads.test.mjs` imports `ws` — then fails as a whole-file `✖` with
`ERR_MODULE_NOT_FOUND: Cannot find package 'ws'`, which looks like a red test but is not.
Pure-module and jsdom-harness tests may still pass, hiding the problem.

Fix: run `npm ci --no-audit --no-fund` once in the worktree before the first test run
(`node_modules` is gitignored, so it adds nothing to the diff).

Do not symlink the real checkout's `node_modules` into a scratch copy of origin/dev either (seen 2026-10-18): it
can lag dev's package.json (it lacked gsap@3.12.5 and playwright-core@1.56.0). `ui/server.mjs` then runs
`src/core/preflight-deps.mjs`, prints "installed dependencies do not match package.json" and exits 1. Every
server-importing test fails as a whole-file `✖` in about 300 ms, while the pure-module files pass. There is no
env bypass. Run `npm ci` in the scratch copy instead (about 5 s).

The full suite (`npm test`, about 12,300 tests) takes more than 10 minutes in a run worktree (seen 2026-10-18).
A Bash call with `run_in_background` and the default 600000 ms timeout is stopped mid-suite, and the log has no
summary. Start it with `run_in_background: true` and `timeout: 3600000`, redirect the output to a file, then
poll that file for the `ℹ fail` line.

A run worktree can also have NO git remote and only its own branch (seen 2026-10-20, Linux host): `git fetch origin
dev` fails with "'origin' does not appear to be a git repository", and the "real directory" may hold no checkout.
Fetch from the URL in package.json's `repository` field instead:
`git fetch https://github.com/SinishaDjukic/worca-cc.git +refs/heads/dev:refs/remotes/origin/dev`. `origin/dev`
then resolves as usual.

On a Linux host, `test/memory-team-lifecycle.test.mjs` D3 ("over the 256 KiB reader cap") fails with `spawn E2BIG`.
It passes a 300 KiB note as one argv string, and Linux caps one argument at 128 KiB (macOS has no such cap). This is
the machine, not the change. That file is in the slow tier, so `npm run test:fast` never runs it.
