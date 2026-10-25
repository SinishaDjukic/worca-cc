---
name: test-suite-known-failures
description: Read before calling a red, cancelled or hung full-suite test a regression — env-var, load, clock, disk and archive-copy failures that also hit base.
paths: test/**, tools/test.mjs, tools/test-run.mjs
updated: 2026-10-25T16:17:41.711Z
author: Bulibas
---

Before blaming the diff: rerun the file alone with nothing else running, and on a `git archive <base> | tar -x -C <scratch>`
copy at the same time (dependencies per [[run-worktree-needs-npm-ci]]); check `uptime` and `df -h`. Start suites with the
env prefix from [[run-worktree-needs-npm-ci]].

**Shell env leaking into tests**
- `test/project-create.test.mjs` "with a remote: origin is exactly the URL" (`https://github.com/...` vs `git@github.com:...`):
  the full-suite prefix `GIT_CONFIG_GLOBAL="$HOME/.gitconfig"` loads the developer's `url.https://github.com/.insteadof
  git@github.com:`, which `git remote get-url` applies. Scoped `node tools/test.mjs` (no GIT_CONFIG_GLOBAL) passes (2026-10-25).
- `test/host-guard-wiring.test.mjs` ("WORCA_HOST_GUARD=0 spawns the legacy argv", "no WORCA_HOST_PID"): the shell
  inherits `WORCA_HOST_PID` from the worca server. `env -u WORCA_HOST_PID` passes.
- `test/orchestrator-recovery.test.mjs` :644 "auto + network down" and "interactive + network down" ("the default route
  probes the Anthropic API origin"): `ANTHROPIC_BASE_URL` set (2026-10-20). Unset: 30/30.
- `test/broker-secret-seal.test.mjs` :87 :94 :114 :136 ("model credentials are still reachable by agents: env
  OPENAI_API_KEY"): `OPENAI_API_KEY` exported (2026-10-23). Unset: 8/8.
- `test/graph-script-runner.test.mjs`: ANSI codes in captured shell output when `FORCE_COLOR=1`.

**Load and timing** (each passed alone; 2026-10-03 to 10-21). Running one file while a suite runs in the background
fails it every time and looks head-only. Seen: `cli-logs` "follow on a run with no log file yet" and :207 "follow picks
up a truncation"; the redact "ReDoS guard"; `secret-scan` "linear on long single-line input" (`'x\n'` 3096 ms vs a 3 s
ceiling, ~813 ms alone); `wsmap-detectors-p4-registry:139` "< 2 s per detector" (26 s under load);
`wsmap-detectors-p3-registry` "1 MiB pathological inputs stay linear"; `wsmap-redact` "redactSecrets and redactLines
stay linear"; `ask-api-cards` "project card: propose → Start via /api/run"; `git-push-retry:80` "the retry waits while a
git gc runs"; `ui-runs-view` A11 (:683) and D31 (:953); `ui-chat-panel-saved:341` (Needs-you badge '0' vs '1');
`ui-runs-scale`, `ui-git-gate`, `actions-spawn` "stop kills the whole process group", `mcp-definitions` "url checks stay
linear", `composer-save-feedback`. `ui-history-base-check` "Ship it keeps a current check" fails ALONE at load ~48:
`AT` is computed at module load (now − 3 min) and the slow file reads "4 min ago".

**Clock**: `ask-api-action-cards` :206 (Away "I'm back" counts only inside away hours) and :271 (per-person Away B4)
fail in ~30 ms at some local times (03:24, 2026-10-25), on base too: they build the away window from the clock.

**Teardown, flakes, disk**
- `api-run-engine` and `api-run-engine-default`: `after()` hits `ENOTEMPTY … Library/Caches/com.apple.python/…` (a
  python child still writes there); 2 of 3 runs under a scratch HOME, 3 of 3 with their own temp homes (2026-10-21).
  Every test inside passes; only the file teardown is red. `api-mcp-pipeline` can fail the same way on `/.git`.
- `api-memory` B29 ("an ORDINARY run … memory-changed") fails ~2 of 3 runs ALONE at base: run it 3 times on base and head.
- `orchestrator-workspace` compares the repo's `git worktree list` before/after: another session moving a worktree
  branch at the same time fails it.
- `api-platform-heartbeat` "an idle server: ok …" reads `health: 'degraded'` when the temp home's disk is ~96% full.

**Red on base too**
- `ui-team-metrics-timeline` :142 :162 (away-mode branch). Harness-bridge stack (feat/codex-adapter 89fac6e8): 7 at
  base — audit timeline, humanInLoop fallback, implementer on a bridged model, interactive proposal, two "form arm", "gate arm".
- On `git archive` copies (no `.git`): `cli-marketplace` C5 ("plugin \"github-source\" not found"), all of
  `extension-build` and `extension-icons`, and `settings-api:172` "GET /api/app/version" ("the real detection on this
  checkout" gets `'unknown'`, not `'source'`).
- This Mac (2026-10-19, origin/dev 735b354a, ffmpeg installed): `git-sync:371` "a timed-out fetch kills its whole
  process group" (ENOENT on `ssh-<n>.pid`), `promo-kit-tools` mixAudio x2 and exportFilm, `promo-narrate:401` finishSfx.
  12,381 with exactly these 5 red is the baseline.
- Linux run host (2026-10-21): `api-run-engine-default:112` "GET /api/engines … ?recheck=1"; `marketplace-publish-flow:126`
  expects commit author `'Worca'` but gets the host's git user; `memory-team-lifecycle` D3 `spawn E2BIG` (a 300 KiB argv
  string vs Linux's 128 KiB per-argument cap; slow tier, so `test:fast` never runs it).

**Cancels and hangs**
- `tools/test-run.mjs` caps each file at 300 s (`timeout: 300_000`). On 4–8-CPU Linux hosts big jsdom files
  (`ui-history-detail-tabs`, `ui-history-shipit`, `ui-running-detail`, other `ui-*`) are "cancelled" — not failed. Run
  them uncapped with `node --test` under a temp `WORCA_HOME`/`HOME` (~40 s each). The 8-CPU full suite (1,658 files)
  ended 12 fail / 32 cancelled; afterwards `node tools/test.mjs --concurrency 3 <the 37 red files>` was 563/563.
  Collect the files from the `test at test/<file>` lines after `failing tests:`.
- `npm test` can hang for good: `promo-kit-tools` "contactSheet … headless Chrome" timed out at 300 s, then no output
  for over an hour and no `ℹ fail` (2026-10-19). When the log stops growing, run the rest (zsh, ~12 min):
  `files=(${(f)"$(ls test/*.test.mjs | grep -v promo-kit-tools)"}); node tools/test.mjs "${files[@]}"`. Judge
  promo-kit only when the diff touches it.

**A new interleaving test** (fs-gate, held lock, poll loop) can pass alone and fail in the full suite. Before handoff
run 8–10 copies at once (each gets its own temp homes):
`for i in $(seq 8); do (npm test -- test/x.test.mjs > /tmp/x-$i.log 2>&1 &); done`. Wait on every condition you assert
(2026-10-17: a poll that waited on the first of two `rm`s failed 3 of 8 copies).
