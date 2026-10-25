---
name: review-baseline-and-suite-noise
description: Read before reviewing a worca run's diff or judging a red full suite — the prompt's checkpoint may not be the branch base, and several suite failures are enviro
updated: 2026-10-25T00:28:29.075Z
author: Bulibas
---

**Checkpoint ref can be the wrong baseline.** A reviewer prompt may name a "pre-implementation checkpoint"
(e.g. `b146c1cf` on `dev`) that is NOT an ancestor of the run branch's HEAD. `git diff <checkpoint>` then mixes
in dozens of unrelated files (earlier branch commits, reverse diffs of dev-only work). Always check
`git merge-base --is-ancestor <ref> HEAD` first; if it fails, review `git diff HEAD` (implementers leave work
uncommitted/intent-to-added) and cross-check with `git status`. When the implementers committed their
work, the working tree is clean and `git diff HEAD` is empty: diff the parent branch head instead
(e.g. `git diff <parent-branch-head> HEAD`, found with `git log --oneline -n 12`).

**The run's base can be a feature branch far behind `origin/dev`.** Seen 2026-10-17 (PR status icons run): the
checkout was cut from `feat/worca-ai-enablement-plugin`, merge-base with dev 2026-10-06. Dev already had per-member
workspace PRs (#520: `pipeline_member_prs`, `enrichPipelinesPr` items with `members[]` + a rollup `pr`), so the
implementer's "a workspace run has at most one PR, skip the count" held only on the stale base. When a plan says
"check whether X exists", or a conclusion rests on something being absent, also run `git merge-base HEAD origin/dev`
and `git show origin/dev:<file> | grep <symbol>`, and report a divergence in the review as an integration risk.

**A fix-cycle review (cycle 2+) has no committed "before" to diff against.** The fix lands uncommitted, on top of the
cycle-1 tree. Do two things:
- **Find what changed.** When cycle 1 found the code byte-identical to the plan's whole-file blocks, extract those
  fenced blocks and `diff -u` each one against its file. When it did not, list the files changed after the cycle-1
  review by modification time (`stat -f '%Sm %N'`). Exact, and worked on team memory 1b cycles 3 and 4: rebuild the
  tree the previous review saw from its saved full diff — `git archive <checkpoint> | tar -x -C <dir>`, then
  `git apply <prev scratchpad>/cN.diff`, then `cmp`/`diff -u` each changed file against the worktree. So at the START
  of every review, save `git diff <checkpoint> > <your scratchpad>/c<N>.diff` (new files are intent-to-added, so they
  are in it) and name that path in the review.
- **Prove each new test catches its fix.** `rsync -a` the worktree to a scratch folder, leaving out `node_modules`,
  `.git`, `.worca-cc-test` and `graphify-out`, then symlink the real `node_modules` into it. Revert one fix at a time
  there and run `npm test -- <its test file>`; a scoped run makes its own home folders, so it works as is. A fix whose
  reversion stays green is untested (seen 2026-10-17: 2 of 17 survived). The Linux run host has no `rsync`
  (seen 2026-10-21): copy with `tar -c --exclude=./node_modules --exclude=./.git … . | tar -x -C <scratch>` instead.
- **Do the same in cycle 1 for every new guard branch** (a `continue`, a throw, a route's `if (!check) return`), even
  when the tests are copied verbatim from a reviewed plan. Plan tests check the happy paths. On team memory 1b
  (2026-10-17) 8 of 18 guard removals stayed green, among them the origin check on 5 of 6 routes. A python script that
  `str.replace`s one guard, runs `node tools/test.mjs <files>` under a temp HOME, then restores the file, does 18 in
  about 10 minutes. A test of a deadline or timeout fix must assert a `settled` flag one `setImmediate` after the
  fake-clock tick, not `await` the promise: reverted, an `await` hangs to the per-file timeout instead of failing
  (seen 2026-10-18, chip resolver deadline).
  A plan's own "guard-removal spot checks" list is NOT the full set: on the Clef pre-pass (2026-10-19) all 6 listed
  guards were covered, but 8 of 13 unlisted ones stayed green. Among them were the credential-broker refusal in a new
  provider patch (`refuseWithBroker`), a new `findLocalCredentials` key, and a typed request-body ID that goes into a
  URL next to a stored token. The broker-refusal precedent to copy is `test/bridge-broker.test.mjs` "provider keys,
  tests and the Copilot sign-in move to the key page"; `patchSpeech`'s refusal is untested there too.
  Also revert the CALL-SITE option, not only the helper's guard. On R14 (2026-10-24), every helper guard went red,
  including cursor's `writeCursorProjectFiles(..., { root })`. But dropping `root: workRoot` where `runCursorProcess`
  passes it stayed green, because the new test calls the helper directly. An implementer's "N/N guards red" claim
  counts helper guards only.

**Full-suite failures that are not the change's fault** (seen 2026-10-01, run under the worca host):
- `test/host-guard-wiring.test.mjs` "WORCA_HOST_GUARD=0 spawns the legacy argv" fails because the shell
  inherits `WORCA_HOST_PID` from the worca server. Proof: `env -u WORCA_HOST_PID <test command> test/host-guard-wiring.test.mjs` passes.
- Same class (seen 2026-10-20): `test/orchestrator-recovery.test.mjs` :644 "auto + network down" and the
  "interactive + network down" test fail ("the default route probes the Anthropic API origin") when the shell has
  `ANTHROPIC_BASE_URL` set. Proof: `env -u ANTHROPIC_BASE_URL node tools/test.mjs test/orchestrator-recovery.test.mjs` is 30/30.
- Same class (seen 2026-10-23): `test/broker-secret-seal.test.mjs` :87, :94, :114, :136 fail ("model credentials are
  still reachable by agents: env OPENAI_API_KEY") when the shell exports `OPENAI_API_KEY`. `env -u OPENAI_API_KEY` is 8/8.
  Start every suite as `env -u WORCA_HOST_PID -u ANTHROPIC_BASE_URL -u OPENAI_API_KEY npm test`.
- `test/ui-team-metrics-timeline.test.mjs` tests at :142 and :162 fail on a clean `git archive HEAD` copy of
  the away-mode branch too — pre-existing. Verify with `git archive HEAD | tar -x -C <scratch>` +
  symlinked `node_modules`, then run that file there, before blaming the diff.
- On the harness-bridge stack (feat/codex-adapter 89fac6e8, seen 2026-10-02) a run worktree's full suite
  has 7 failures at base, not the 1 the owner quotes: audit timeline, humanInLoop fallback, implementer
  on a bridged model, interactive proposal, two "form arm", "gate arm". `test/api-memory.test.mjs` B29
  ("an ORDINARY run … memory-changed") also flakes ALONE at base (fails about 2 runs in 3). A single
  red run of it proves nothing: run it 3 times on base and head `git archive` copies before calling it a regression.
- Timing tests go red under CPU load (seen 2026-10-03): `test/cli-logs.test.mjs` "follow on a run with no log
  file yet" and the redact "ReDoS guard" test. Running a single file while a full suite runs in the background
  makes it fail every time, which looks like a head-only regression. Rerun it with nothing else running before judging.
  Same class (seen 2026-10-08, full suite under the worca host): `test/wsmap-detectors-p4-registry.test.mjs:139`
  "pathological inputs … < 2 s per detector" took 26 s under load and failed; alone it passes. Also seen red in one
  full-suite run on 2026-10-16, and green when rerun alone: `test/wsmap-detectors-p3-registry.test.mjs` "1 MiB
  pathological inputs stay linear", `test/wsmap-redact.test.mjs` "redactSecrets and redactLines stay linear", and
  `test/ask-api-cards.test.mjs` "project card: propose → Start via /api/run" (13 s). Also seen 2026-10-17 (full
  suite, scratch HOME): `test/git-push-retry.test.mjs:80` "the retry waits while a git gc runs" ("waited for the gc
  (10ms)") and `test/cli-logs.test.mjs:207` "follow picks up a truncation"; alone both pass. Also seen 2026-10-18
  (`npm run test:fast` while two scoped runs ran beside it): `test/secret-scan.test.mjs` "linear on long single-line
  input (ReDoS guard)" — the `'x\n'` case took 3096 ms against its 3 s ceiling; alone it takes ~813 ms, 3 of 3 green.
  Same class, and it fails ALONE too under a busy machine (seen 2026-10-18, load average ~48):
  `test/ui-history-base-check.test.mjs` "Ship it keeps a current check" expects "(checked 3 min ago)" but gets "4 min",
  because `AT` is computed at module load (now − 3 min) and the file then takes ~50 s instead of ~28 s. The pre-merge
  head failed identically under the same load. Check `uptime` and run base at the same time before calling it a regression.
  Also seen 2026-10-20 (full suite, load average ~24, a change to `src/core/actions/` only): `test/ui-runs-view.test.mjs`
  A11 ("row ⋯ menu offers Select", :683) and D31 ("Checks failing … Fixing", :953), and `test/ui-chat-panel-saved.test.mjs:341`
  ("a finished run opened in the panel is acknowledged", a Needs-you badge '0' vs '1'). Rerun alone, both files: 77/77 green.
- `test/api-platform-heartbeat.test.mjs` "an idle server: ok …" gets `health: 'degraded'` when the disk holding the
  temp home is nearly full (`diskNearlyFull` → the `diskFull` signal; seen 2026-10-22 at 96% used, on a `git archive`
  base copy too). Check `df -h` before blaming the diff.
- `test/ask-api-action-cards.test.mjs` :206 (Away "I'm back" counts only inside away hours) and :271 (per-person Away B4)
  fail in about 30 ms, alone too, with "inside away hours, … changed the status" (seen 2026-10-25 at 03:24 local, on a
  `git archive` checkpoint copy as well). They build the away window from the clock, so they are time-of-day noise, not
  load: rerun them on a base copy at the same time before blaming the diff.
- A NEW test that forces an interleaving (fs-gate, a held lock, a poll loop) can pass alone and in its scoped run, yet
  fail in the full suite. Before handing one off, run 8–10 copies of its file at once:
  `for i in $(seq 8); do (npm test -- test/x.test.mjs > /tmp/x-$i.log 2>&1 &); done` — each copy gets its own temp
  WORCA_HOME/HOME, so they never clash. Seen 2026-10-17: a poll that waited on the first of two awaited `rm`s, then
  asserted the second, failed 3 of 8 copies; wait on every condition you assert.
- Under a scratch `HOME` (seen 2026-10-03), `test/api-run-engine.test.mjs` and `test/api-run-engine-default.test.mjs`
  fail about 2 runs in 3 on base too: their `after()` hits `ENOTEMPTY … Library/Caches/com.apple.python/…` while
  removing the temp home (a python child still writes its cache there). One red run of these is not a regression.
  On 2026-10-21 they failed 3 of 3 runs (in `test:related`, alone, and on a `git archive` base copy), with no
  scratch HOME, only the files' own temp homes. Every test inside them passed; only the whole-file teardown is red.
  Also seen 2026-10-21 on a Linux run host (base `git archive` copy too, every run, alone): `test/api-run-engine-default.test.mjs:112`
  "GET /api/engines … ?recheck=1" (`false !== true`), and `test/marketplace-publish-flow.test.mjs:126` "writable GitHub
  marketplace", which expects the commit author `'Worca'` but gets the host's global git user (`'worca agent'`).
  `test/api-mcp-pipeline.test.mjs` can go red in the full suite on an `ENOTEMPTY … /.git` teardown, and it passes alone.
- A new user setting key breaks exhaustive pins on purpose: the probe table in `test/settings-api.test.mjs`
  ("test probe missing for new key") and the sorted GET key list in `test/settings-projects-root.test.mjs`.
  A new Settings card breaks card-id pins, which are NOT in `test/ui-settings-tabs.test.mjs` (checked 2026-10-16):
  the Runs-tab id list is in `test/ui-settings-workspace-scan.test.mjs:80`, project-page cards in
  `test/ui-project-settings.test.mjs:46`, and every card needs `data-min-level` (`test/ui-levels.test.mjs`).
  Update them with the key.
- On a `git archive HEAD | tar -x` scratch copy (real checkout's `node_modules` symlinked), three files fail on base
  AND head alike (seen 2026-10-16 at 73f99f0b): `test/cli-marketplace.test.mjs` C5 ("plugin \"github-source\" not
  found"), and the whole of `test/extension-build.test.mjs` and `test/extension-icons.test.mjs`. They are artifacts
  of the archive copy, not regressions; everything else in the suite runs green there. Same class (seen 2026-10-24,
  checking one commit of a stack standalone): `test/settings-api.test.mjs:172` "GET /api/app/version" row "the real
  detection on this checkout" expects `'source'` and gets `'unknown'`: the copy has no `.git`.
- In a run worktree on this machine (seen 2026-10-19, origin/dev 735b354a), five tests fail on a clean
  `git archive origin/dev` copy too, every run, alone or in the full suite: `test/git-sync.test.mjs:371`
  "a timed-out fetch kills its whole process group" (ENOENT on its `ssh-<n>.pid` file), three in
  `test/promo-kit-tools.test.mjs` (mixAudio x2, exportFilm) and `test/promo-narrate.test.mjs:401` finishSfx.
  ffmpeg is installed, so it is not a missing tool. A full suite of 12,381 with exactly these 5 red is the baseline.
- `npm test` can HANG for good, not just fail (seen 2026-10-19, run worktree under the worca host):
  `test/promo-kit-tools.test.mjs` "contactSheet … headless Chrome" timed out at 300 s, then the runner printed
  nothing more for over an hour and never reached its `ℹ fail` summary. When the log stops growing, run every
  other file instead: `files=(${(f)"$(ls test/*.test.mjs | grep -v promo-kit-tools)"}); node tools/test.mjs "${files[@]}"`
  (zsh; about 12 min, 1,479 files). Judge promo-kit separately, only when the diff touches it.
- `test:related` on a 4-CPU Linux run host (seen 2026-10-20, 553 files, load ~18) "cancels" big jsdom files at the
  runner's fixed 300 s per-file cap (`tools/test-run.mjs` `timeout: 300_000`): `ui-history-detail-tabs`,
  `ui-history-shipit`, `ui-running-detail`, even rerun at `--concurrency 3`. A cancel is not a fail. Run the file
  uncapped with `node --test` under a temp `WORCA_HOME`/`HOME`: each passed in ~40 s on head and base alike.
  The full `npm test` on the 8-CPU Linux host (seen 2026-10-21, 1,658 files, about 63 min, load 20-30 in its jsdom
  phase) ended at 12 fail and 32 cancelled. The cancels were all `ui-*` jsdom files; the fails were budget and timing
  tests (`ui-runs-scale`, `ui-history-base-check`, `ui-git-gate`, `actions-spawn` "stop kills the whole process
  group", `mcp-definitions` "url checks stay linear", `composer-save-feedback`, `wsmap-detectors-p4-registry`) plus
  the two base failures above. Once the suite had ended, one `node tools/test.mjs --concurrency 3 <the 37 red files>`
  ran 563/563 green in about 2 min. Collect the files from the `test at test/<file>` lines after `failing tests:`.
