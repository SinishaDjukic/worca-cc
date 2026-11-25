# Test offenders: verdicts and evidence

Repeat offenders are the test files that kept turning CI red. If a shard is red, look the file up here before you
rerun it. Each row gives the verdict (why it failed), the outcome (what was done about it), the local runs used as
evidence, the CI history and the fix. `test/test-offenders.test.mjs` keeps this page in line with
`test/quarantine.json` and `test/tiers.json`.

Three loaded full-suite runs and five alone runs per file showed no offender failure on this tree. That cannot rule
out a rare flake. The five dev push runs under [Post-merge check](#post-merge-check) are the second check.

The browser offenders (extension Playwright specs and CDP proofs) are added to the same Verdicts table later, with
their spec or proof paths.

Words used:
- Verdict: `deterministic` (fails every time on a given tree), `flaky (timing)` (depends on how fast something
  finishes), `flaky (load)` (fails only when the machine is busy), `environment` (depends on the runner or the
  tools installed). A file whose failures had several causes lists each cause, separated by `;`. The open (or
  last) cause comes first.
- Outcome: `green` (in the normal tiers and passing), `slow tier` (in the slow tier of `test/tiers.json` and
  passing), `quarantined` (in `test/quarantine.json`).
- Evidence: `5/5 alone` means 5 passing runs of `node tools/test.mjs FILE`. `full-1`, `full-2` and `full-3` are
  the loaded full-suite runs under [Evidence runs](#evidence-runs).

## Verdicts

| File | Verdict | Outcome | Evidence | CI history | Fix |
|---|---|---|---|---|---|
| `test/ui-ask-side-shell.test.mjs` | deterministic | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | 23 runs, 2026-11-23 to 2026-11-25: a fixture chat dated 2026-10-24 folded into "Older" after 30 days, so the row menu was not there (`:990`, "Cannot read properties of null (reading 'click')"). The 2 runs on 2026-11-25 and the late 2026-11-24 PR runs were on branches without the fix | `be80c31e7` (#1580) dates the fixture at load time (`:976`) |
| `test/api-attribution-audit.test.mjs` | deterministic (product race) | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | 17 runs, 2026-11-15 to 2026-11-23: archiving a stopped run raced its teardown, `500 !== 200` with `ENOTEMPTY … rmdir …/pipelines/…` (`:128`) | `098d11ff3` (#1528): the archive waits for the run to settle (`untilRunSettled`, `ui/routes/runs/runs.mjs`). The fixed sleeps at `:171` and `:174` are the file's only remaining wall-clock budget; they were never seen failing |
| `test/parity-routes.test.mjs` | deterministic | slow tier | 5/5 alone; 0 failures in full-1, full-2, full-3 | 12 runs, 2026-11-20 to 2026-11-22, all `slow tests (1/2)`: "unclassified routes: GET /api/requirements/search, POST /api/requirements/attach/resolve" (`:103`); #1505 merged with that shard red. 1 PR run on 2026-11-22 named its own new route (`GET /api/app/update/changes`): the guard doing its job | `303c9c242` classifies the two routes. Making `CI gate` a required check (a later slice) stops a red merge |
| `test/design-film-mp4-real.test.mjs` | flaky (timing); deterministic | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | (B) 2 runs, 2026-11-18 (Node 22.19.0) and 2026-11-20 (Node 26): "the video holds 55 of its 60 frames" (`:115`). (A) 23 runs, 2026-11-14 to 2026-11-20: "test timed out after 300000ms" (`:48`, or file level), a CDP `send()` on a closed socket that never settled | (B) the change that added this page: the final audio mux in `assets/promo-kit/tools/export.mjs` no longer passes `-shortest`, which cut the copied video where a shorter AAC track ended. `test/promo-kit-tools.test.mjs` "exportFilm keeps every frame when the audio ends early" shows the cut (55 of 60 frames with 0.9 s of audio) and now passes. Why the app's mix came out short on those 2 CI runners is inferred, not reproduced. (A) `b4ebb10d0`: a CDP call on a closed browser fails at once |
| `test/ask-panel-voice.test.mjs` | deterministic | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | 8 runs, all 2026-11-23: PV6 (`:796`) read a chip that #1546 removed, after #1546 and #1468 merged one after the other ("Cannot read properties of null (reading 'textContent')") | `c03361ebd` (#1555): PV6 reads the voice state from the input placeholder |
| `test/ui-ship-words.test.mjs` | deterministic | green | 5/5 alone; 0 failures in full-1, full-2, full-3 | 8 runs, 2026-11-20 to 2026-11-23: the wording guard (`:52`) caught `` `${T.prsOpened} pull request opened` `` in `src/shared/worca-levels.mjs` (#1506). The guard did its job | `5c990240f` (#1545): the milestone says "PR created" |

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

## Post-merge check

Fill in after this page merges: the next 5 push runs of `ci.yml` on `dev`. A failure of an offender that is not
quarantined reopens its row. That offender is then quarantined in a follow-up PR (an entry in
`test/quarantine.json`, outcome `quarantined` here). The CI gate checklist links this section.

| Dev push run id | Date | Offender failures |
|---|---|---|
| | | |
| | | |
| | | |
| | | |
| | | |
