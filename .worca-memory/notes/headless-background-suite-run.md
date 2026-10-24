---
name: headless-background-suite-run
description: Read before giving a scratch clone deps, reading test counts, reproducing CI's Node 22, or blaming a red test on your change — host, load and hang reds
paths: test/**, docs/superpowers/plans/**
updated: 2026-10-23T08:31:15.216Z
author: Denislav Prinov
---

Core worktree recipe (link, `env -u WORCA_HOST_PID`, waiting): [[pipeline-worktree-node-modules]].

## Scratch trees
- Link a clone's `node_modules` to the REAL dir (or a worktree's real copy, after `ls -d <wt>/node_modules/yaml <wt>/node_modules/express`), never to a worktree path that is itself missing (dangles silently); check `ls node_modules/express`. A `git archive <base> src | tar -x` export needs its own link before importing `yaml`.
- Fastest complete scratch: `git archive HEAD | tar -x -C "$S"`, `git init`, `npm ci --no-audit --no-fund` (~0.5 s warm). A partial `cp -R src test tools package.json` reds every orchestrator test (`unknown agent "clarify"`: the registry reads repo-root dirs) — also copy `agents scripts skills plugins worca-cc-marketplace.json`, link `ui`; run the unmutated copy green once.
- A snapshot lacking a new dep: `npm install --prefix <scratch>/deps <pkg>@<pin>` + a `node --import` `registerHooks({ resolve })` hook resolving it there.
- Built-in marketplace checks (`WORCA_BUILTIN_MARKETPLACE=<dir>`) read the COMMITTED tree: copy `git status --short -uall` files into a checkpoint clone and commit there.
- Never commit/reset a scratch clone while its suite runs (`test/orchestrator-workspace.test.mjs` snapshots `git worktree list`). Parallel verifiers get separate `git clone`s, never `git worktree add` trees of one clone (one's checkout changes the other's `git worktree list`: "workspace tests must not add/remove a worktree in the PRODUCT repo").

## CI's Node 22 on this Node 25 host
CI is ubuntu + Node 22 only. `npm install --no-audit --no-fund node@22` in a mkdtemp dir (~2 s) gives `node_modules/.bin/node`. A PATH passed in node's `spawnSync('/bin/zsh', ['-c', cmd], { env })` is LOST (`~/.zshenv` prepends `/opt/homebrew/bin`): `export PATH="<n22>/node_modules/.bin:$PATH"` INSIDE the `-c` string and print `node --version`. `tools/test.mjs` children inherit it and print `✔`/`ℹ fail N` even piped; bare piped `node --test` prints TAP (`# fail N`). Judge by exit status.
- A fake settling only on an `AbortSignal.timeout` abort (unref'd timer) passes on Node 25; on Node 22 the loop drains (`'Promise resolution is still pending but the event loop has already resolved'`) and every LATER test in the file is cancelled (`ℹ fail 0`, `ℹ cancelled N`; only the first red is the cause). Give fakes a ref'd bound — `hangOn` in `test/git-free-team-policy.test.mjs` (3 s `setTimeout` rejecting `'hung'`, cleared on abort) — and prove it on Node 22.
- Recursion limits differ (`JSON.stringify` RangeError at ~6800 deep on Node 22, never on 25): test deep inputs on both.

## Reading a run
- Summary lines `ℹ tests / ℹ pass / ℹ fail`; list reds with `awk '/^✖ failing tests:/{f=1} f'`. Node 25 skips start `﹣` (U+FE63). `ps` needs `-ax`.
- `--test-force-exit` loses tests (under-counts by one in a file, drops late-registered tests, last rows with `--test-concurrency=1`): keep each plan command's flags, take RED counts from a run without it, compare `--test-reporter=spec` name lists when counts disagree.
- `npm test` has NO force-exit: a timer on a jsdom window a test never closes (an app.js `setInterval`, a rotating placeholder) keeps the file alive forever while plan commands pass — destroy widgets and `win.close()` in `afterEach`. Find it: per-file `spawnSync(node, ['--test', f], { timeout: 90000 })` (ETIMEDOUT = hang), on a checkpoint clone too.
- A re-run's poll can read the LAST run's log (`exit=0` lingers): delete logs first. A red CSS pin prints all of `style.css` (~450 KB) as `actual`: read the log from node. A new linearity row bounds CPU (`process.cpuUsage()`), never wall time.
- Host-independent gate: the plans' `t test/*.mjs` (temp `HOME`, `env -u WORCA_HOST_PID`, no-real-claude PATH), then `node test/helpers/no-real-claude/assert-none.mjs` (1 skip = the npm-only guard).

## Reds that are not your change — attribute in a checkpoint clone first
Compare failing-NAME sets tree vs checkpoint, never counts.
- `no-real-claude-guard` "under `npm test` the guard dir is first on PATH" fails in any checkout reached through a symlink (`/tmp`, bare `mktemp -d`): clone under `$(cd "$(mktemp -d)" && pwd -P)`.
- `cli-subcommands`: exactly 2 fails when the host has a regular FILE at `/tmp/x` (never delete it unless yours). `title-model`: 2 `generateTitle` fails when the real `~/.worca-cc/settings.json` sets `titleModel` — never "fix" it in an unrelated change.
- `cli-auto` "interactive: the proposal renders…" and `cli-interactive` gate/recovery arms inherit the REAL `HOME`: the user's Away switch makes them fail ("Away mode answered …"), at the checkpoint too; same for `verify:run-monitor`.
- A file-level `not ok` with `exitCode: 1` and no failing subtest = a process death under load (Node 22): rerun alone, then at the checkpoint.
- **Load:** at load ~100 a background `npm test` with a 25-min timeout was killed after ~1750 tests (use 7200000 or attribute by file), and 23 tests in 12 files failed at the checkpoint itself, even alone at load ~10 (ask-api-cards, cli-logs follow, git-sync, policy-api, project-sync, scan-api, script-bench, team-metrics-api, wsmap-detectors-p4-registry, wsmap-redact, wsmap-scan-launch-check, workspaces-api). Research lanes beside the suite ARE the load (4 opus lanes + `npm test`: 803 s, ~13 reds passing alone): start it after lanes report.
- **Load flakes** (green alone 3×): `ui-team-policy` "New pipeline: the policy notes line paints…", `ui-running-density` "the coalesced pin re-arms…", `ui-running-detail` "the 1 s interval ticks", `git-push-retry` "the retry waits while a git gc runs…", `git-sync` "joining a longer in-flight fetch…" and "a timed-out fetch kills its whole process group" (`ENOENT … ssh-N.pid`, also red alone right after a full suite), `cli-logs` "follow …", `wsmap-detectors-p4-registry` "pathological inputs", `terminal-manager` "Stop ends a running command…", `orchestrator-questions` "composite slices never gate…", `ask-api-cards`, `mcp-test` hanging-server kill, `project-sync` backoff; with two suites at once also `wsmap-detector-config-env`, `wsmap-detectors-p3-registry`, `wsmap-redact`. Diff the source, run the file alone 3×, then one suite rerun.
- `fetch failed … ECONNRESET` in an in-process server test (`workspaces-api`): keep-alive race vs `keepAliveTimeout` 5000 ms after a ~5 s spawnSync — fix in the test (`Connection: close`). A +28 s outlier = a mock run's child outliving `after()`.
- `ENOTEMPTY … rmdir` file-level red in an `after()` (`ℹ tests` one above green): `api-mcp-pipeline` (a git child of the in-process server still writing, [[server-run-done-ordering]]) and `api-run-engine-default` (macOS python caches into its sandbox HOME). INTERMITTENT on base and tree alike (checkpoint 4 of 7 incl. a green first run, tree 8 of 8): attribute with ≥ 3 back-to-back runs per side; one green run proves nothing; fix in the test (`maxRetries`). Each red leaves `worca-cc-engdef-home-XXXXXX` in `os.tmpdir()`: remove only the exact paths from YOUR runs' `rmdir '…'` errors.
- **A HANG, not a red:** no `ℹ` lines; the hung child has ppid 1, 0% CPU: `ps -ax -o pid,ppid,etime,%cpu,command | grep -- --test-isolation=process`, confirm `lsof -p <pid> | grep cwd` is YOUR clone, `kill <literal pid>`. Seen once in `ui-graph-view` (green 6× after): task files get one retry on an alarm kill.
- A green suite is ZERO coverage for `tools/verify-*-cdp.mjs` ([[real-browser-view-probe]]): CI's `cdp` job is the gate; run those proofs one at a time, Bash timeout 600000.
