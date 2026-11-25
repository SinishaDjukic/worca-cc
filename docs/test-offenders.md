# Test offenders: verdicts and evidence

Repeat offenders are the test files that kept turning CI red. If a shard is red, look the file up here before you
rerun it. Each row gives the verdict (why it failed), the outcome (what was done about it), the local runs used as
evidence, the CI history and the fix. `test/test-offenders.test.mjs` keeps this page in line with
`test/quarantine.json` and `test/tiers.json`.

Three loaded full-suite runs and five alone runs per file showed no offender failure on this tree. That cannot rule
out a rare flake. The five dev push runs under [Post-merge check](#post-merge-check) are the second check.

The browser offenders (the extension Playwright spec and four CDP proofs) are rows of the same Verdicts table, by
spec or proof path. Each is checked with its own harness while `npm run test:fast` runs in the background:
`env -u FORCE_COLOR -u PORT HOME="$(mktemp -d "$TMPDIR/home.XXXXXX")" npm run verify:NAME` for a proof (a fresh HOME
per run), and `npm run e2e:extension -- visual.spec.mjs -g "tokens resolve|computed styles"` for the spec. That
filter selects the offender's own 4 tests, which compare computed values, in light and dark. The spec's screenshot
tests are left to CI: `extension-e2e` runs the whole file against the linux baselines inside the pinned Playwright
image, and the darwin baselines a local run compares against are stale (see the note under the loaded browser runs).

Words used:
- Verdict: `deterministic` (fails every time on a given tree), `flaky (timing)` (depends on how fast something
  finishes), `flaky (load)` (fails only when the machine is busy), `environment` (depends on the runner or the
  tools installed). A file whose failures had several causes lists each cause, separated by `;`. The open (or
  last) cause comes first.
- Outcome: `green` (in the normal tiers and passing), `slow tier` (in the slow tier of `test/tiers.json` and
  passing), `quarantined` (in `test/quarantine.json`).
- Evidence: `5/5 alone` means 5 passing runs of `node tools/test.mjs FILE`. `full-1`, `full-2` and `full-3` are
  the loaded full-suite runs under [Evidence runs](#evidence-runs). `browser-1` to `browser-6` are the loaded
  browser runs there: a spec or proof row cites the runs that ran its own harness (`browser-1` to `browser-3` for
  the proofs, `browser-4` to `browser-6` for the spec).

## Verdicts

| File | Verdict | Outcome | Evidence | CI history | Fix |
|---|---|---|---|---|---|
| `test/ui-ask-side-shell.test.mjs` | deterministic | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | 23 runs, 2026-11-23 to 2026-11-25: a fixture chat dated 2026-10-24 folded into "Older" after 30 days, so the row menu was not there (`:990`, "Cannot read properties of null (reading 'click')"). The 2 runs on 2026-11-25 and the late 2026-11-24 PR runs were on branches without the fix | `be80c31e7` (#1580) dates the fixture at load time (`:976`) |
| `test/api-attribution-audit.test.mjs` | deterministic (product race) | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | 17 runs, 2026-11-15 to 2026-11-23: archiving a stopped run raced its teardown, `500 !== 200` with `ENOTEMPTY … rmdir …/pipelines/…` (`:128`) | `098d11ff3` (#1528): the archive waits for the run to settle (`untilRunSettled`, `ui/routes/runs/runs.mjs`). The fixed sleeps at `:171` and `:174` are the file's only remaining wall-clock budget; they were never seen failing |
| `test/parity-routes.test.mjs` | deterministic | slow tier | 5/5 alone; 0 failures in full-1, full-2, full-3 | 12 runs, 2026-11-20 to 2026-11-22, all `slow tests (1/2)`: "unclassified routes: GET /api/requirements/search, POST /api/requirements/attach/resolve" (`:103`); #1505 merged with that shard red. 1 PR run on 2026-11-22 named its own new route (`GET /api/app/update/changes`): the guard doing its job | `303c9c242` classifies the two routes. Making `CI gate` a required check (a later slice) stops a red merge |
| `test/design-film-mp4-real.test.mjs` | flaky (timing); deterministic | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | (B) 2 runs, 2026-11-18 (Node 22.19.0) and 2026-11-20 (Node 26): "the video holds 55 of its 60 frames" (`:115`). (A) 23 runs, 2026-11-14 to 2026-11-20: "test timed out after 300000ms" (`:48`, or file level), a CDP `send()` on a closed socket that never settled | (B) the change that added this page: the final audio mux in `assets/promo-kit/tools/export.mjs` no longer passes `-shortest`, which cut the copied video where a shorter AAC track ended. `test/promo-kit-tools.test.mjs` "exportFilm keeps every frame when the audio ends early" shows the cut (55 of 60 frames with 0.9 s of audio) and now passes. Why the app's mix came out short on those 2 CI runners is inferred, not reproduced. (A) `b4ebb10d0`: a CDP call on a closed browser fails at once |
| `test/ask-panel-voice.test.mjs` | deterministic | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | 8 runs, all 2026-11-23: PV6 (`:796`) read a chip that #1546 removed, after #1546 and #1468 merged one after the other ("Cannot read properties of null (reading 'textContent')") | `c03361ebd` (#1555): PV6 reads the voice state from the input placeholder |
| `test/ui-ship-words.test.mjs` | deterministic | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | 8 runs, 2026-11-20 to 2026-11-23: the wording guard (`:52`) caught `` `${T.prsOpened} pull request opened` `` in `src/shared/worca-levels.mjs` (#1506). The guard did its job | `5c990240f` (#1545): the milestone says "PR created" |
| `e2e/extension/visual.spec.mjs` | deterministic | green | 0 failures in browser-4, browser-5, browser-6 (4 tests each: tokens resolve and computed styles, light and dark) | 5 dev runs, job `extension-e2e`, light and dark: "computed styles of Ask elements …" (`:58` then, `:63` now) read `"padding-left": "8px"` against `"10px"` on the bar buttons, after `b4374eed9` (#1546) gave the app's `.ask-model-btn` `padding:0 8px`, CSS the sidebar does not load. Green on every dev run since 45230448507 | `538d89ee0` (#1554) takes side padding out of the comparison for the two bar buttons |
| `tools/verify-composer-cdp.mjs` | environment; deterministic | green | 0 failures in browser-1, browser-2, browser-3 (20 checks each). With a HOME holding the real `settings.json` (`welcomeSeen`, `setupFinished`): exit 0, its sha256 unchanged | (env) local only: the proof sandboxed `WORCA_HOME` but not `HOME`, so the worca-level summary dialog covered the canvas at check (1), 3 of 3 on a developer machine, and its `POST /api/settings` wrote the real settings file. (det) 2 dev runs and about 20 PR runs, 2026-11-24 to 2026-11-25: FAIL (11) an unexpected `wfv-howto-btn` in the top bar, FAIL (18) the wider top-left bar, after #1443 | (env) this page's change: `HOME` and `USERPROFILE` point at the temp home before `ui/server.mjs` is imported; Chrome gets the real HOME back (`test/verify-composer-cdp.test.mjs`). (det) `be80c31e7` (#1580) |
| `tools/verify-theme-cdp.mjs` | deterministic | green | 0 failures in browser-1, browser-2, browser-3 | "project Back": 2 PR runs, 2026-11-21 and 2026-11-24, never on a dev push, cause not identified; the post-merge window watches it. "one button style / dark / system-dark": 2 dev runs and PR runs after #1443 (`.topnav-howto` at font-size 0px). "page intro": 2 PR runs after `06aabffa2` redesigned Connectors | "project Back": none (open). #1443: `be80c31e7` (#1580). Page intro: `cfcc71db9` |
| `tools/verify-feature-page-cdp.mjs` | deterministic | green | 0 failures in browser-1, browser-2, browser-3 | 2 dev runs and PR runs, 2026-11-24: "the group page at 290px" measured the `.topnav-howto` button at font-size 0px, after #1443 | `be80c31e7` (#1580) |
| `tools/verify-requirements-cdp.mjs` | deterministic | green | 0 failures in browser-1, browser-2, browser-3 | 10 runs (2 dev, 8 PR), 2026-11-19 to 2026-11-22: "back on the feature" and "the start records the file it sent", after #1500 changed how runs start | `b8889ce73`: the proof starts runs through the run setup overlay |

## Evidence runs

All runs are on `feat/run-5-node-test-offenders-verdicts` at HEAD `a882cb206` plus this page's change, on a macOS
arm64 laptop, Node v26.5.0, with Chrome and ffmpeg present. The logs and timings files are kept in the run's
pipeline folder (`evidence/`). Seconds come from each run's `--timings-out` file.

Alone runs, 2026-11-25, before the `-shortest` fix: `env -u FORCE_COLOR node tools/test.mjs FILE`, 5 runs per file,
0 failed and 0 skipped in every run.

| File | Runs | Pass per run | Seconds per run |
|---|---|---|---|
| `test/ui-ask-side-shell.test.mjs` | 5/5 | 53 | 19.1, 19.5, 19.4, 19.3, 19.3 |
| `test/api-attribution-audit.test.mjs` | 5/5 | 4 | 5.2, 4.9, 5.1, 4.8, 4.9 |
| `test/parity-routes.test.mjs` | 5/5 | 10 | 0.7, 0.7, 0.7, 0.7, 0.6 |
| `test/design-film-mp4-real.test.mjs` | 5/5 | 5 | 20.2, 20.0, 19.8, 19.6, 19.9 |
| `test/ask-panel-voice.test.mjs` | 5/5 | 19 | 1.5, 1.3, 1.3, 1.3, 1.3 |
| `test/ui-ship-words.test.mjs` | 5/5 | 9 | 0.6, 0.5, 0.5, 0.5, 0.5 |

Loaded runs, after the fix: `env -u FORCE_COLOR node tools/test.mjs --timings-out full-N.timings.json`, tier
`all` (the slow tier too), one after another. Failures were read with `parseFailures` (`tools/flaky-register.mjs`).

| Run | Date | HEAD | Log sha256 | Tests | Pass | Fail | Offender seconds | Other failures |
|---|---|---|---|---|---|---|---|---|
| full-1 | 2026-11-25 | `a882cb206` + this change | `c4aab90644d1d662f4bf2131a2f71732c766c04aaaf1219f014f95ef76d3e98f` (`full-1.log`) | 28904 | 28860 | 6 (offenders: 0) | `test/ui-ask-side-shell.test.mjs=24.19s`, `test/api-attribution-audit.test.mjs=5.22s`, `test/parity-routes.test.mjs=0.86s`, `test/design-film-mp4-real.test.mjs=20.94s`, `test/ask-panel-voice.test.mjs=1.41s`, `test/ui-ship-words.test.mjs=0.58s` | `test/api-workflow-test-project-try.test.mjs` (1), `test/api-workflow-test-round2.test.mjs` (2), `test/test-offenders.test.mjs` (1), `test/workflow-test-project-copy.test.mjs` (1), `test/workflow-test-project-key.test.mjs` (1) |
| full-2 | 2026-11-25 | `a882cb206` + this change | `c5f1def18989b963ff0f937192403741fdc34c784aaf0722fc6c943f07f20a53` (`full-2.log`) | 28904 | 28860 | 6 (offenders: 0) | `test/ui-ask-side-shell.test.mjs=28.18s`, `test/api-attribution-audit.test.mjs=5.29s`, `test/parity-routes.test.mjs=0.97s`, `test/design-film-mp4-real.test.mjs=21.21s`, `test/ask-panel-voice.test.mjs=1.42s`, `test/ui-ship-words.test.mjs=0.58s` | `test/api-workflow-test-project-try.test.mjs` (1), `test/api-workflow-test-round2.test.mjs` (2), `test/test-offenders.test.mjs` (1), `test/workflow-test-project-copy.test.mjs` (1), `test/workflow-test-project-key.test.mjs` (1) |
| full-3 | 2026-11-25 | `a882cb206` + this change | `060d50ee7edbea62071ab254dae0ff9480ba574a88e9f53a75abf0d8f57bb8a3` (`full-3.log`) | 28904 | 28859 | 7 (offenders: 0) | `test/ui-ask-side-shell.test.mjs=24.15s`, `test/api-attribution-audit.test.mjs=5.17s`, `test/parity-routes.test.mjs=0.76s`, `test/design-film-mp4-real.test.mjs=21.33s`, `test/ask-panel-voice.test.mjs=1.88s`, `test/ui-ship-words.test.mjs=0.66s` | `test/api-workflow-test-project-try.test.mjs` (1), `test/api-workflow-test-round2.test.mjs` (2), `test/test-offenders.test.mjs` (1), `test/workflow-test-project-copy.test.mjs` (1), `test/workflow-test-project-key.test.mjs` (1), `test/tools-test-runner.test.mjs` (1) |

The other failures do not count against an offender:
- `test/test-offenders.test.mjs` failed in each run because this page did not have these rows yet.
- The 5 `workflow-test` tests (`test/api-workflow-test-project-try.test.mjs`,
  `test/api-workflow-test-round2.test.mjs`, `test/workflow-test-project-copy.test.mjs`,
  `test/workflow-test-project-key.test.mjs`) failed in every run and fail alone too on this machine. The change
  does not touch the code they test.
- `test/tools-test-runner.test.mjs` ("suiteTmpOutsideWorca …") failed once, in full-3, and passes alone.

Loaded browser runs, 2026-11-25, on `feat/run-6-browser-offenders-extension-playwright` at HEAD `797b81472` plus this
page's change, same laptop, Chrome for the proofs and Playwright's Chromium (`@playwright/test` 1.65.1) for the spec.
Each round ran composer, feature-page, requirements, theme, then the spec, one after another, while
`npm run test:fast` ran in the background. Each proof ran with a fresh HOME and `PORT` unset, as in the intro; the CDP
ports were the defaults. Seconds are `/usr/bin/time -p` real time. One log per round (the 5 harness logs in run order),
kept in `evidence/` with its sha256. `browser-4` to `browser-6` ran later the same day at HEAD `7d9d4bd88` plus this
page's change, under the same load: each round ran only the spec's own harness,
`env -u FORCE_COLOR -u PORT npm run e2e:extension -- visual.spec.mjs -g "tokens resolve|computed styles"`.

| Run | Date | HEAD | Load | Log sha256 | Results | Offender seconds |
|---|---|---|---|---|---|---|
| browser-1 | 2026-11-25 | `797b81472` + this change | `npm run test:fast` | `8f9f4c60be53fd86ffa6e924dc6bcb240276ce4dce208cc076e008f8b2b26f2e` (`browser-1.log`) | 4/5: `e2e/extension/visual.spec.mjs` exit 1 | `tools/verify-composer-cdp.mjs=38.3s`, `tools/verify-feature-page-cdp.mjs=20.4s`, `tools/verify-requirements-cdp.mjs=110.7s`, `tools/verify-theme-cdp.mjs=428.1s`, `e2e/extension/visual.spec.mjs=67.0s` |
| browser-2 | 2026-11-25 | `797b81472` + this change | `npm run test:fast` | `a3453ac9087a8daf91860ff7bc9452f451a2d253a69cc4415ed789246eaf4030` (`browser-2.log`) | 4/5: `e2e/extension/visual.spec.mjs` exit 1 | `tools/verify-composer-cdp.mjs=36.5s`, `tools/verify-feature-page-cdp.mjs=14.4s`, `tools/verify-requirements-cdp.mjs=103.3s`, `tools/verify-theme-cdp.mjs=381.5s`, `e2e/extension/visual.spec.mjs=48.8s` |
| browser-3 | 2026-11-25 | `797b81472` + this change | `npm run test:fast` | `5fcfb93a6fc9712e7c69ed375eb5b76599eeb5d8c2994dfda1d23aa0f81d39c0` (`browser-3.log`) | 4/5: `e2e/extension/visual.spec.mjs` exit 1 | `tools/verify-composer-cdp.mjs=37.8s`, `tools/verify-feature-page-cdp.mjs=15.0s`, `tools/verify-requirements-cdp.mjs=106.0s`, `tools/verify-theme-cdp.mjs=383.1s`, `e2e/extension/visual.spec.mjs=37.1s` |
| browser-4 | 2026-11-25 | `7d9d4bd88` + this change | `npm run test:fast` | `2211da306b5e6ea924ed21325a7bdfd072c2fa5577233e1097a4d0ca68c48491` (`browser-4.log`) | 1/1 exit 0 (4 of 4 tests) | `e2e/extension/visual.spec.mjs=17.6s` |
| browser-5 | 2026-11-25 | `7d9d4bd88` + this change | `npm run test:fast` | `821f31a6681b797b56b4ce860764f2d7d45aa6802cf2c0766622ca359181950e` (`browser-5.log`) | 1/1 exit 0 (4 of 4 tests) | `e2e/extension/visual.spec.mjs=15.9s` |
| browser-6 | 2026-11-25 | `7d9d4bd88` + this change | `npm run test:fast` | `b6aca49e9ecab7d487a4261f4277d7fe750bde00b51970ab0c0b0429d897f3ef` (`browser-6.log`) | 1/1 exit 0 (4 of 4 tests) | `e2e/extension/visual.spec.mjs=16.5s` |

In `browser-1` to `browser-3`, which ran the whole spec file, the spec's `:50` and `:63` tests passed in light and
dark, 12 of 12. Its 4 screenshot tests (`:98`, `:120`) failed with 2-3% pixel diffs, on `sidebar-chat` and
`sidebar-composer`. `browser-4` to `browser-6` ran only the spec's own harness (`-g "tokens resolve|computed styles"`,
the 4 computed-value tests), with no proofs.

The darwin screenshot baselines in `e2e/extension/__screenshots__` are stale: `sidebar-chat-*-darwin.png` and
`sidebar-composer-*-darwin.png` were last updated on 2026-10-14 (`fd6eb0c3d`), while the linux ones that CI compares
were refreshed on 2026-10-25 (`40600ff09`) and 2026-10-26 (`86a38b317`). A local run of the whole spec therefore
fails its screenshot tests on macOS. CI never compares darwin baselines. Refreshing them, with the pixel changes
reviewed, is a follow-up; this page leaves them as they are.

## CI failure history

Source: the last 200 failed `ci.yml` runs (2026-11-14 to 2026-11-25), `gh run view ID --log-failed`, searched for
each file's `test at …` line. "dev" is a push to `dev`; the others are pull request runs.

- `test/ui-ask-side-shell.test.mjs`, fast tests shard 1/4 (Node 22.19.0, 24 and 26), 23 runs. dev: 45409974761,
  45357178869. PR: 45576083436, 45453131971, 45445708066, 45435564912, 45435559418, 45435537797, 45435165033,
  45426285892, 45422962899, 45405615594, 45401097722, 45378688636, 45374074972, 45371345250, 45367215179,
  45356666173, 45300525190, 45298724748, 45294961816, 45293338727, 45292998621.
- `test/api-attribution-audit.test.mjs`, fast tests shard 4/4, 17 runs. dev: 44835825694, 44750081547,
  44494558165, 44309045353. PR: 45121661516, 45090629669, 45070675729, 45068317042, 45057924201, 45049824528,
  44814521073, 44759165394, 44750589195, 44617904423, 44392489414, 43861438587, 43696285312.
- `test/parity-routes.test.mjs`, slow tests shard 1/2, 12 runs. dev: 44826349828, 44821482637, 44760932899. PR:
  45031819631 (its own new route), 44832195349, 44826565392, 44826550078, 44815135068, 44815069026, 44814521073,
  44765508561, 44760587428.
- `test/design-film-mp4-real.test.mjs`, fast tests shards 1/4 to 4/4. (B) frame loss, 2 runs, PR: 44750589195
  (Node 26), 44404082530 (Node 22.19.0). (A) 300 s timeout, 23 runs. dev: 44740323575, 44732054871,
  44483781001, 44476632602, 44137963048, 44123294739, 44116229662, 44109462679, 43641351902. PR: 44815069026,
  44759165394, 44725306749, 44617904423, 44604900273, 44315704852, 44116158410, 44093542293, 44033876536,
  43675772499, 43663725257, 43641420625, 43640757154, 43633720071.
- `test/ask-panel-voice.test.mjs`, fast tests shard 1/4 (one run 3/4), 8 runs. dev: 45170618730. PR:
  45223688887, 45205947085, 45174607827, 45173708929, 45173261127, 45171925767, 45171649568.
- `test/ui-ship-words.test.mjs`, fast tests shards 1/4 and 2/4, 8 runs. dev: 45071431393. PR: 45090629669,
  45072298253, 45070675729, 45070336133, 45028494841, 44765508561, 44759165394.

The browser offenders, from the last 120 failed `ci.yml` runs, read the same way:

- `e2e/extension/visual.spec.mjs`, job `extension-e2e`, 5 runs, light and dark: `"padding-left": "8px"` against
  `"10px"` on the bar buttons after #1546. dev: 45102926427, 45107372698, 45125540891, 45170618730, 45224008084.
  Green on every dev run since 45230448507.
- `tools/verify-composer-cdp.mjs`, job `cdp` (the rest group): FAIL (11), an unexpected `wfv-howto-btn` in the top
  bar, and FAIL (18), the wider top-left bar, after #1443. dev: 45357178869, 45409974761, plus about 20 PR runs up to
  PR 45576083436 (2026-11-25, a branch without the fix). Locally it also failed 3 of 3 on a machine whose real
  `~/.worca-cc/settings.json` holds `onboarding.welcomeSeen` and `onboarding.setupFinished`: the worca-level summary
  dialog covered the canvas at check (1).
- `tools/verify-theme-cdp.mjs`, job `cdp` (`theme` group). "project Back", cause not identified, PR: 44917572665
  (2026-11-21), 45378688636 (2026-11-24), never on a dev push. "one button style / dark / system-dark" after #1443,
  dev: 45357178869, 45409974761. "page intro" after `06aabffa2`, PR: 45003518603, 45005394485.
- `tools/verify-feature-page-cdp.mjs`, job `cdp` (the rest group): "the group page at 290px" measured the
  `.topnav-howto` button at font-size 0px after #1443. dev: 45357178869, 45409974761.
- `tools/verify-requirements-cdp.mjs`, job `cdp` (the rest group): "back on the feature" and "the start records the
  file it sent" after #1500, 10 runs. dev: 44760932899, 44821482637. PR: 45028494841 and 7 runs on 2026-11-20.

## Post-merge check

Fill in after each slice merges: the next 5 push runs of `ci.yml` on `dev`, counted from that slice's merge commit
(the `Window` column). A failure of any of the 11 offenders that is not quarantined reopens its row. That offender is
then quarantined in a follow-up PR (an entry in `test/quarantine.json`, outcome `quarantined` here). The browser rows
watch the theme proof's "project Back" by name. The CI gate checklist links this section.

| Window | Dev push run id | Date | Offender failures |
|---|---|---|---|
| from slice 5 merge | | | |
| from slice 5 merge | | | |
| from slice 5 merge | | | |
| from slice 5 merge | | | |
| from slice 5 merge | | | |
| from slice 6 merge | | | |
| from slice 6 merge | | | |
| from slice 6 merge | | | |
| from slice 6 merge | | | |
| from slice 6 merge | | | |
