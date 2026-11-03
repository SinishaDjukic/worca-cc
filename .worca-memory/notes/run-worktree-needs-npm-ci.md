---
name: run-worktree-needs-npm-ci
description: Read before running tests, fetching dev, or writing under .claude/ in a worca run worktree — no node_modules, maybe no remote, .claude writes refused.
updated: 2026-11-03T23:07:39.918Z
author: Bulibas
---

**No `node_modules`.** A run worktree (`~/.worca-cc/runs/<id>/repos/<key>`) is checked out without it (the real
checkout may lack it too). A test file that imports a dependency (e.g. `test/ask-api-threads.test.mjs` imports `ws`)
fails whole-file with `ERR_MODULE_NOT_FOUND: Cannot find package 'ws'`, while pure-module and jsdom tests pass and
hide it. Run `npm install --no-audit --no-fund --no-package-lock` once before the first test (`node_modules` is
gitignored, adds nothing to the diff). Since `4cf9cf079` (2026-10-22, on dev) the repo tracks NO `package-lock.json`,
so `npm ci` on a dev-based worktree refuses ("can only install with an existing package-lock.json"); and a plain
`npm install` writes an UNTRACKED, non-ignored lockfile that teardown's `git add -A` would commit. Plans' Setup lines
still say `npm ci`: correct them (2026-11-04, #1074 refine).
Never symlink the real checkout's `node_modules` into a scratch copy of origin/dev: it can lag package.json (lacked
gsap@3.12.5 and playwright-core@1.56.0 on 2026-10-18), `src/core/preflight-deps.mjs` prints "installed dependencies
do not match package.json" and exits 1, and every server-importing test fails in ~300 ms. No env bypass; the install
in the scratch copy takes ~5 s.

**Full suite.** `npm test` (~12,300 tests) takes over 10 minutes here (about 63 min on the 8-CPU Linux host). A Bash
call with `run_in_background` and the default 600000 ms timeout is stopped mid-suite with no summary: use
`timeout: 3600000`, redirect to a file, poll it for the `ℹ fail` line. Start every full suite as
`env -u WORCA_HOST_PID -u ANTHROPIC_BASE_URL -u OPENAI_API_KEY -u FORCE_COLOR GIT_CONFIG_GLOBAL="$HOME/.gitconfig" HOME="$(mktemp -d)" npm test`
— each of those leaks turns tests red ([[test-suite-known-failures]], [[tests-read-real-home-settings]]).

**No git remote.** A worktree can have no remote and only its own branch (2026-10-20, Linux host): `git fetch origin dev`
fails with "'origin' does not appear to be a git repository". Fetch from package.json's `repository` URL:
`git fetch https://github.com/SinishaDjukic/worca-cc.git +refs/heads/dev:refs/remotes/origin/dev`.

**Writes under `.claude/` are refused in unattended runs** (planner, implementer, AI-readiness Generate): `.claude/rules/*.md`
("sensitive file") and skills, even the TRACKED `.claude/skills/creating-worca-cc-plugins/SKILL.md` ("you haven't granted
it yet", #540, 2026-10-21). Root `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc` and `.github/copilot-instructions.md`
write fine. Never retry or route through a shell. A plan step that edits a `.claude/` file cannot finish unattended: say
so in the plan, and the implementer puts the exact stale lines and their replacement in DEVIATIONS.md for a human.
Readiness folds skills, agent roles and rules into "Key workflows" and "Rules" sections of `CLAUDE.md` and the multi-tool
files, listing each `.claude/` target under `skipped` with "write refused by host". `.claude/rules/worca/` holds a
self-ignoring `.gitignore` (`*`): committed project rules live directly under `.claude/rules/`.
