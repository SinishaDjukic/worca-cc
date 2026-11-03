# Split by feature (#919): runbook

## Before Ship and on freeze day: `npm run split:verify`

One command, from a clean checkout of the commit to ship (this branch merged with the latest dev, or dev itself on
freeze day). It runs every check below in order, never stops early, prints one table (check · pass/fail · number ·
evidence file) and exits 0 only when every row passes. It never posts on #919 and never pushes. It takes many hours (the
crawl alone is hours); the table in `OUT/split-verify.md` grows row by row (`npm run split:verify -- --out DIR [--keep]
[--firefox-in-ci] [--waive-crawl OWNER:REASON] [--only ROWS]`; without `--out`, a new temp folder). Chrome (the crawl) and Playwright's Chromium (for
`e2e:extension`) must be installed. Firefox (for `e2e:firefox-smoke`) too, except with `--firefox-in-ci`: on macOS,
Playwright's Firefox hangs headless (macOS sandbox), so run verify with `--firefox-in-ci` there. `e2e:firefox-smoke`
then runs in the `firefox-e2e` workflow (`.github/workflows/firefox-e2e.yml`, Linux, the branch and its split tree), and
row i reads `e2e:firefox-smoke: CI job firefox-e2e, not run locally`. That is not a pass: the table ends with a
"Not run locally (not a pass)" line, `split-verify.json` lists it under `notLocal`, and the last line reads
`split:verify PASS, except 1 suite left to CI (firefox-e2e)`.

`--only a,b` reruns only those rows into the `--out` of an earlier run, after a fix. The earlier run's `head` must be
HEAD or an ancestor of it (otherwise exit 3: rerun all rows), so make the fix commit on top of the one verify ran on.
The other rows are carried (`pass (earlier)` / `FAIL (earlier)`), the table's tail names the earlier head and every
file changed since, and the rerun rows' old outputs move to `OUT/prev-N/`. Choose ROWS as the failed rows plus every
row the fix can affect: a fix in `tools/split-by-feature*` reruns b, c, d, e, f, h, i, k and l; a fix in `ui/` or
`src/` reruns d through l; a fix in `tools/parity*` reruns the parity rows it touches (e, f, g, h, k) and l; l always
reruns when h or j reruns.

`--only ROWS` into an empty or new `--out` is a fresh partial run: it runs those rows and row a (which resolves
origin/dev), records every other row as `not run`, and writes `split-verify.json` with `fresh: true`. A `--out` that is not
empty and holds no `split-verify.json` (a partial table from an interrupted run) stays exit 3, so it is never overwritten.

`--waive-crawl OWNER:REASON` records the owner's waiver of row h: the row reads `WAIVED` with the owner and reason,
spawns no crawl, and row l passes `--waive-crawl` to readiness instead of `--crawl-from`. `split-verify.json` records
`crawl: 'waived'`, so the go/no-go never reads a crawl left in `OUT` by an earlier run. Round 6 (2026-11-03) ran rows i,
j, k and l this way, fresh on the renamed split: `npm run split:verify -- --only i,j,k,l --firefox-in-ci --waive-crawl
"Emil Angelov:owner waiver 2026-11-03 00:16; …" --out "$(mktemp -d)"`.

The e2e judgement (row i): `e2e:extension` is judged "same results before and after"
(the same Playwright test statuses and pixel-identical `*-actual.png` / `*-diff.png`, before = a clean clone of HEAD,
after = the split tree), because dev's darwin screenshot baselines fail on a Mac on untouched dev too. The
baselines are not touched or masked. Every other `e2e:*` suite must exit 0, and a suite that prints SKIP is a fail.

| Check | Pass means |
|---|---|
| a. fetch | `git fetch origin dev` works; the table head prints the SHA used; HEAD contains it; no tracked changes |
| b. gate | `node tools/split-by-feature.mjs --check --stats` exits 0 and prints `spike gate passed` |
| c. dry-run-repeatable | `--dry-run` twice: both exit 0 and print the same tree hash |
| d. suite-split | full `npm test` on the split tree: 0 failures outside `test/flaky-register.json`; each register failure is named with its entry and its file rerun alone (`evidence/d-suite-split-flaky.json`) |
| e. parity-quick | quick parity, this tree against the split tree: PASS, 18 shot pairs, all 6 flows on both sides |
| f. parity-full | full parity with the timing gate, this tree against the split tree: 0 route, 0 visual, 0 flow differences; every route probed signed in and signed out; 18 screenshots light and dark; boot and page-load timings gated and within budget |
| g. parity-package | full parity, this tree against its own `npm pack` (`package:.`): 0 differences, same completeness as f (timings are not gated for a package) |
| h. crawl | `npm run parity -- crawl --a tree:. --b tree:SPLIT --b-screens package:. --dev SHA` (docs/parity-harness.md, Differential crawl), four workers: one control pass (A1 vs A2), the split at full depth and the package at screen level, both comparisons 0 unmasked differences, 0 unexplained masks, 0 real app launches (the app stub on), 0 unvisited and 0 unfillable routes; the number prints the coverage. Under `--waive-crawl`: `WAIVED`, no crawl spawned |
| i. e2e-split | every `e2e:*` suite in `package.json` but the snapshot updater, on the split tree, by the e2e judgement above: `e2e:extension` same before/after, every other suite green, no SKIP |
| j. catch-up | `npm run split:catch-up` on the fixture "old" PR (a route, a CSS rule, a markup line on pre-split dev) works, each edit in its split file and parity's only route difference the fixture's own; every open PR and dependabot branch dry-run (split, 3-way apply, related tests; fork PRs split and apply only). An open PR that needs a hand fix is counted, not a fail |
| k. rollback | the split reverted: diff to HEAD empty, then `npm test` and a quick parity (no crawl, no e2e) |
| l. readiness | `npm run readiness -- run` (with `--dev-ref` when HEAD is not dev, `--crawl-from OUT/crawl` or `--waive-crawl` when row h is waived, and `--catch-up-from OUT/catch-up/all.json`): verdict `go`; `report.md` and `report.json` written; the number names a waived parity row |

Catch-up runs before rollback because it needs the un-reverted split tree as "latest dev". Readiness runs last and
reuses h's crawl when its trees match its own (the crawl's A and first B tree hashes) or the crawl reuse rule holds
(below), and j's dry run when its M^ and M tree match.

## Layout

The split writes mechanical names that say what a file holds, never where it registers, and never numbers. The rules
live in `tools/split-by-feature/file-names.mjs`, and their inputs in the `naming` block of
`tools/split-by-feature/feature-map.json`, so a rerun on the same sources gives the same names.
`node tools/split-by-feature.mjs --check --stats --tree` prints the whole tree with line counts. Files aim at 150–500
lines; the cap stays 1,000.

- Routes: `ui/routes/FEATURE/AREA.mjs`, one `ui/routes/FEATURE/index.mjs` per feature and `ui/routes/index.mjs` on top.
  A unit is one statement component (a helper always lands with its users). Its area is the path segment after the
  feature prefix of its first route (`/api/runs/:id/diff` gives `diff`; a route on the prefix itself, `/api/run-groups`,
  gives `run-groups`). `naming.areas` groups areas under one name per feature (`pause`, `resume` and `stop` give
  `control`, and `ui/routes/runs/labels-and-tags.mjs` joins two); a key with a slash matches the literals after `/api/`
  (`history/pr` is `/api/history/pr`, not `/api/pr`). An unmapped area under `naming.areaMinLines` (150) joins the
  largest area of its segment while that stays within the cap. An area over the cap splits off its largest
  sub-resource until the rest fits (`ui/routes/chat/thread-cards.mjs`). The segment is a technical detail:
  `ui/routes/FEATURE/index.mjs` lists the areas that register at each barrier, and one name in two segments is a
  problem, never a suffix.
- CSS: `ui/public/FEATURE/PART.css`, one part per section marker (`/* ---- X ---- */`, `/* ── X ── */`). The name is the
  shortest prefix of at least 2 heading words that is unique in the folder (`ui/public/history/history-detail-diff-tab.css`);
  stopwords and phase tokens (`P3`, bare numbers) are dropped, and a heading left with fewer than 2 words is named from
  the first comment line under its marker. A section under 40 lines joins its same-feature neighbour. A section over
  1,000 lines is cut at the first rule of its most common class prefix, which `naming.cssPrefixes` names
  (`req` → `ui/public/requirements/requirements.css`). CSS belongs to its feature: `naming.cssBlocks` moves the rules
  of one section that start with given selectors (with the comments above them) to another feature and name
  (`.setup-card` in `marketplace P7` → `ui/public/setup-assistant/setup-wizard.css`). `ui/public/parts.json` keeps the
  original byte order, so the served `/style.css` stays byte-identical.
- Markup: `ui/public/FEATURE/PART.html`, named by the first `data-view` id in the block, else its dialog id, else the
  marker's words. A second top-level view in one marker block starts its own part, and `naming.views` files a view
  under another feature (`ui/public/scheduled-runs/schedules.html`).

A name the rules cannot derive, a name with a number (`chat-2`, `workspaces-two`) or a generic word from
`naming.generic` (part, document, shared, common, misc, other, utils, this…) makes the namer throw: it is a `--check`
problem, never a fallback. So is a collision. The fix is a `naming.areas`, `naming.cssBlocks` or `naming.rename` entry
(generated path → content name, `ui/public/scripts/code-editor.css`) in a reviewed edit.

Routes are plain modules with `register(app)`, so every statement moves verbatim, in the order the barriers define. An
`express.Router` per feature is a possible later step. It would change the express stack, so it needs its own parity
and equivalence proof.

## Crawl reuse rule

An earlier full crawl, and any evidence that depends only on served output, stays valid while both hold:

1. origin/dev's SHA is unchanged;
2. the served CSS, the served `index.html` and the sorted route table are byte-identical on the trees compared.

Otherwise re-crawl. Each crawl report records `dev` and a `served` fingerprint per side
(`tools/parity.mjs crawl … --dev SHA`). Check the rule by hand with
`node tools/parity/reuse.mjs --earlier-dev SHA --dev SHA --tree LABEL=DIR [--tree LABEL=DIR …] --out FILE` (exit 0
VALID, 1 not). Readiness applies it on its own: `--crawl-from DIR` is reused when the trees match or the rule holds
(`(split:verify row h, reuse rule)` in the parity row). The go/no-go's `reuse-rule` gate reads that file for every verify
row it carries from an earlier run. The row-h waiver of 2026-11-03 (Emil Angelov) stays recorded in the go/no-go; a later
full crawl replaces it.

A failing row names its evidence file inside `OUT`. When it is a test that is in the register, the row stays green
and the evidence names the entry and the solo rerun. When it is not, follow "When `suite-migrated` or `rollback` fails"
under The readiness command below.

The owner set these inputs (2026-11-02). Readiness prints them in its Inputs section:

| Input | Value |
|---|---|
| Go/no-go owner | Emil Angelov |
| Freeze window | dev frozen since 2026-11-01 at bf92e1579 (1.17.0-rc.2), until checklist step E1 |

Docs note: `docs/design-system.md` and the generated `docs/feature-files.md` change only in the migration commit itself
(freeze day). Until then dev's docs describe the unsplit files, and the readiness `docs-and-package` row is the proof
that the migration commit updates them.

| Step | What to run | Who | Pass means |
|---|---|---|---|
| 1. Prepare | `npm test`; `node tools/split-by-feature.mjs --check --stats` | any contributor | both exit 0; the spike gate line says `passed` |
| 2. Keep ready | on every PR touching `ui/server.mjs`, `ui/public/style.css` or `ui/public/index.html`: CI (split-by-feature tests + `Parity (dev against itself)`); a new route gets a row in `tools/split-by-feature/feature-map.json` and `tools/parity/route-classes.json` | the PR author | CI green; `--check` prints `covered` |
| 3. Readiness | `npm run readiness -- run --out DIR`; read `DIR/report.md`; `npm run readiness -- post --out DIR` | go/no-go owner | verdict `go`; the comment shows in `gh issue view 919 --comments`; every PR author with an action is told |
| 4. Freeze day | announce the freeze on #919; rerun step 3 on the final dev commit; on a clean checkout run `git fetch origin dev && git switch -c split/feature-migration origin/dev && node tools/split-by-feature.mjs --apply && node tools/split-by-feature.mjs --apply && git add -A && git commit -m "Split large files by feature (#919)"` (the second `--apply` prints `0 files changed`); open its PR into dev and squash-merge it as M | go/no-go owner | readiness `go` on the exact commit the split is applied to |
| 5. After the freeze | the PR catch-up recipe for each `catch up after the freeze` row; rebase the express 5 PR; rollback A or B if needed | PR authors; owner for rollback | `npm test` and `O=$(mktemp -d); npm run parity -- run --a tree:. --b tree:. --out "$O"` green on dev; no open PR conflicts only because of the split |
| 6. Before the next release | `npm pack --dry-run` lists `ui/routes/` and every feature folder; `O=$(mktemp -d); npm run parity -- run --a tree:. --b package:. --out "$O"`; release per docs/RELEASING.md | release owner | 0 route, visual and flow differences between the tree and the package |

The spike gate (`--check --stats`): at least 95% of the route statements between the static mount and the SPA
fallback move, and the residual `ui/server.mjs` is at most its ceiling in `tools/split-by-feature/size-caps.json`
(10,119 lines: the residual on `04370c0f6` merged with dev `c82347c7c`, whose git automations added 113 lines to it,
then 33 more from dev `b76706df6`'s in-place Chat engine switching (#982) and 1 from `405db5a4d` (Settings › My
credentials); each raise is in `size-caps-raises.json`;
accepted as is). `--apply` refuses a failed gate; `--dry-run` reports it as a problem and exits 1. Raising the ceiling
is a hand edit in a reviewed PR, and a raise is recorded in `tools/split-by-feature/size-caps-raises.json`
(`{file, from, to, why}`; a test pins `size-caps.json` to the last raise). The readiness Risks list every raise for the
owner's sign-off.

Every guard failure (coverage, size cap, the spike gate, unclassified routes in `test/parity-routes.test.mjs`, the
direct-read guard in `test/public-assets.test.mjs`, and the two checks in After the split) ends
with `if this branch started before the #919 split: run npm run split:catch-up -- BRANCH`. On a branch that started after
M, the fix is a feature-map edit instead.

## Migration checklist

Owner: Emil Angelov (go/no-go owner). Dev is frozen since 2026-11-01 at `bf92e1579` (1.17.0-rc.2). 🔒 = the owner
confirms before the step happens. Nothing here is done by a tool on its own: every 🔒 step is a person's action.

| Step | What | Who | Command | Pass |
|---|---|---|---|---|
| A1 | Finish tooling (this round) | worca run | `npm run split:verify -- --only i,j,k,l --firefox-in-ci --waive-crawl OWNER:REASON --out V`; `npm run split:go-no-go -- --verify V --verify-earlier T1 --readiness V/readiness --t2 T2 --stub-smoke FILE --masks-crawl CHAT --reuse reuse.json --renamed renamed.json --row e=DIR --row f=DIR --waive GATE=OWNER:REASON … --out DIR` (after a rename, `renamed.json` is `node tools/parity/reuse.mjs` on the earlier and the renamed split: rows i–l stay valid while the behaviour is byte-identical) | `split-go-no-go.md` first line reads `GO`; attached to the run |
| A2 🔒 | Review the go/no-go | owner | read `split-go-no-go.md`, its evidence, and the waived gates and their evidence | the owner agrees with every gate |
| A3 🔒 | Sign off the size cap | owner | `node tools/split-by-feature.mjs --check --stats` | 10,119 ≤ ceiling; every raise in `tools/split-by-feature/size-caps-raises.json` accepted |
| B1 | Ship one tooling PR | owner | one PR from the tooling branch into dev, linked to #919 | one PR, CI started |
| B2 | CI green | CI | tests, `parity-docker`, `firefox-e2e` | all three checks green (`parity-docker`: the branch image against the split-tree image, 0 route, 0 px, 0 flow differences; tree against package) |
| B3 🔒 | Merge the tooling | owner | squash-merge B1 | merged; dev still frozen |
| B4 | Suite on dev | owner | `npm test` on dev after the merge | 0 failures outside `test/flaky-register.json` |
| C1 | Readiness on frozen dev | owner | `npm run readiness -- run --out DIR` (`--crawl-from DIR` is reused under the crawl reuse rule; it re-crawls only when dev moved) | 10/10 rows pass, verdict `go` |
| C2 🔒 | Post on #919 | owner | `npm run readiness -- post --out DIR` | the comment shows in `gh issue view 919 --comments` |
| C3 🔒 | Tag 1.17.0 from rc.2 (only if releasing now) | owner | docs/RELEASING.md, from `bf92e1579` | tag `worca-app-v1.17.0` on `bf92e1579` |
| D1 🔒 | Backups | owner | `git tag -a feature-split/before origin/dev -m "#919 split large files by feature: dev before the migration commit, dev $(git rev-parse origin/dev), $(date +%F)"`; push it; push `origin/dev` to the protected `backup/dev-before-feature-split`; in the owner's own checkout `git branch backup/dev-before-feature-split feature-split/before` (local, never pushed over); `mkdir -p ~/Backups/worca && git bundle create ~/Backups/worca/dev-before-feature-split.bundle origin/dev && git bundle verify ~/Backups/worca/dev-before-feature-split.bundle` | tag and branch on origin; the local branch exists; `git bundle verify` passes |
| D2 | verify on that SHA | owner | `npm run split:verify -- --firefox-in-ci` on a clean checkout of it; C1's crawl stays valid if dev is still at the SHA C1 ran on and `node tools/parity/reuse.mjs` on C1's split and the freeze-day split prints VALID | every row passes (`e2e:firefox-smoke` left to CI) |
| D3 | The migration commit M, in its own PR | owner | freeze-day command of step 4 above (`--apply` twice, one commit) | one commit M, its PR into dev |
| D4 | CI green on M | CI | tests, `parity-docker`, `firefox-e2e` | all green (on M the branch is already split: `parity-docker` runs tree against package only; the image pair ran in B2) |
| D5 | Owner's 15-minute check | owner | Actions › Check out on M's PR branch, then the main pages, a chat message and a run (or `tools/split-real-e2e.mjs`) | same as before the split |
| D6 🔒 | Merge the migration | owner | squash-merge M's PR | merged |
| D7 | Tag the split | owner | `git tag -a feature-split/after origin/dev -m "#919 split large files by feature: dev after the migration commit, dev $(git rev-parse origin/dev), $(date +%F)"`; push the tag | annotated tag on M |
| D8 | Suite and parity on dev | owner | `npm test`; `O=$(mktemp -d); npm run parity -- run --a tree:. --b tree:. --out "$O"` | both green |
| D9 | Red while still frozen | owner | Rollback A below (`git revert M`) | its Pass: line |
| E1 | Unfreeze | owner | announce on #919 | announced |
| E2 | Open PRs catch up | PR authors | `npm run split:catch-up -- BRANCH`; the express 5 PR last | each PR green on the split |
| E3 | Watch period, staging, release | owner | docs/RELEASING.md | no split regression reported |
| E4 | Lower the caps and clean up | owner | one final, separate PR | merged on its own, revertable on its own |

Rollback: before D6 (merge the migration), red means fix and repeat from the failing step. After D6, red means
`git revert M` (Rollback A), or Rollback B only if later commits touched the split files. Never reset or force-push.

## Rollback
Two layers roll back separately. The tooling PRs (slices 1–3 and the #919 follow-up; T below is the one to undo)
change no served output and no runtime path. The migration commit M has its own procedures, A and B below.

Tooling, plain revert (T is still the newest commit on dev): `git switch -c revert/split-tooling origin/dev && git revert --no-edit T`
(`git revert -m 1 T` if T is a merge commit). Check: `git diff origin/dev^ HEAD` prints nothing and `npm test` ends with `fail 0`.

Tooling, two-part revert (later PRs landed on top of T, and their tests read the shell through
`src/core/public-assets.mjs`): keep `src/core/public-assets.mjs`, `src/core/read-index-html.mjs`,
`src/core/read-style-css.mjs`, `src/core/read-server-source.mjs` and the codemodded reads; `git rm -r` the splitter
(`tools/split-by-feature.mjs` and its folder), the readiness command (`tools/readiness.mjs` and its folder), their tests
(`test/split-by-feature*.test.mjs`, `test/readiness*.test.mjs`) and their entries in `test/tiers.json` and
`.github/workflows/ci.yml`. Check: `npm test` ends with `fail 0` and `tools/split-by-feature.mjs` is gone.

Pass: the check of the procedure used holds, and no file under `ui/` changed.

Four restore points (checklist D1 and D7), and what each protects against:

| Restore point | Where | Protects against |
|---|---|---|
| The local branch `backup/dev-before-feature-split` | the owner's own checkout, never pushed over | a remote force-push or deletion |
| The protected remote branch `backup/dev-before-feature-split` | origin | losing this machine |
| The bundle `~/Backups/worca/dev-before-feature-split.bundle` | outside the repo folder; `git bundle verify` passes | a corrupted repo |
| The annotated tags `feature-split/before` (M^) and `feature-split/after` (M) | origin | they are the named references for revert and catch-up (`npm run split:catch-up` takes them as its M^ and M defaults) |

M is the migration commit. The repo squash-merges, so M is one non-merge commit and `M^` is the dev commit it split. The tags
name them: `feature-split/after` is M and `feature-split/before` is M^.
If M were ever a merge commit, use `git revert -m 1 M` below.

## Rollback A: still frozen (no later commit touched the split files)
1. `git log --format=%h M..origin/dev -- ui/routes ui/public ui/server.mjs docs/design-system.md docs/feature-files.md package.json` prints nothing.
2. `git switch -c revert/feature-split origin/dev && git revert --no-edit M`
3. `git diff --stat M^ HEAD -- ui docs/design-system.md docs/feature-files.md package.json` prints nothing; `npm test`; `O=$(mktemp -d); npm run parity -- run --a tree:PATH-OF-M^ --b tree:. --out "$O"`.
4. PR into dev, linked to #919. (The readiness `rollback` row rehearses steps 2–3 on every dry run, on a clone with no later dev commits.)

Pass: step 3's diff prints nothing, `npm test` has 0 failures outside `test/flaky-register.json`, and the parity run prints PASS.

## Rollback B: later commits touched the split files
Not rehearsed by the readiness command: it depends on the commits that land after M.
1. List them: `git log --format='%h %s' M..origin/dev -- ui/routes ui/public ui/server.mjs`.
2. Save the served CSS and HTML of today's dev (the same bytes the split serves) into a new folder `S=$(mktemp -d)`:
   `node --input-type=module -e "import {assemble} from './src/core/public-assets.mjs'; import fs from 'node:fs'; for (const [k,f] of [['css','style.css'],['html','index.html']]) fs.writeFileSync(process.argv[1]+'/unsplit-'+f, assemble(k,f,'ui/public').text)" "$S"`
3. `git switch -c revert/feature-split origin/dev && git revert --no-commit M`
4. Conflicts in `ui/public/**` parts: `git rm` the parts and `parts.json`; copy `$S/unsplit-style.css` and `$S/unsplit-index.html` to `ui/public/`.
   Check: `cmp "$S/unsplit-style.css" ui/public/style.css && cmp "$S/unsplit-index.html" ui/public/index.html` exits 0.
5. Conflicts in `ui/routes/**` (the area files under `ui/routes/FEATURE/`): for each commit from step 1, move its hunk from the
   route file back to the same handler in `ui/server.mjs` (`git show HASH -- ui/routes` is the list); then `git rm -r ui/routes`.
   Check: `git grep -n "ui/routes" -- ui/server.mjs` prints nothing, and `git status --porcelain` shows no `UU` line.
6. `npm test`; `O=$(mktemp -d); npm run parity -- run --a tree:PATH-OF-DEV --b tree:. --out "$O"`.
7. Commit, PR into dev, linked to #919.

Pass: both checks in steps 4 and 5 hold, `npm test` has 0 failures outside `test/flaky-register.json`, and the parity run in step 6 reports 0 route, visual and flow differences.

## PR catch-up recipe (a PR branch P that started before M)
`npm run split:catch-up -- BRANCH` runs steps 1–5 in scratch clones and prints what moved and what needs a hand fix; it
never pushes. The caught-up commit stays in `OUT/BRANCH/applied` (`git fetch OUT/BRANCH/applied HEAD && git switch -c
BRANCH-caught-up FETCH_HEAD` takes it). `--all` dry-runs every open PR and dependabot branch (split, 3-way apply,
related tests; a fork PR's code is not run), `--fixture` the fixture "old" PR with quick parity. `--m SHA` names M; by
default M is the tag `feature-split/after` and M^ the tag `feature-split/before` (D7, D1), else M is the newest
first-parent commit on origin/dev whose subject starts with `Split large files by feature (#919)`. With none (before the freeze), the tool rehearses: M^ is HEAD and M is HEAD's own split, built under `OUT/m`.
Exit 0 every target works (a single BRANCH also when quick parity only warns: `works (review parity warning)`), 1 a
hand fix, 2 bad arguments, 3 could not start. The manual steps:

This runs the splitter from dev at `M^`, never P's own copy of it, and the tool makes both scratch clones itself.
M below is the migration commit's full SHA (the tag `feature-split/after`; M^ is `feature-split/before`).
1. `git switch P && git merge M^` (bring P to the commit just before the split; resolve ordinary conflicts).
2. `W=$(mktemp -d)/c && node tools/readiness.mjs split --rev HEAD --splitter-rev M^ --out $W` (clones `HEAD` to
   `$W/tree` and `M^` to `$W/splitter`, splits the first with the second's splitter, commits the result).
3. `git -C $W/tree diff --binary M HEAD > "$W.patch"` (P's change, in the split layout: M is the split of M^).
4. `git switch -c P-caught-up origin/dev && git apply -3 "$W.patch" && git commit -m "catch up with the #919 split"`.
5. `git diff --stat origin/dev` lists only P's own files; `npm test`; `O=$(mktemp -d); npm run parity -- run --a tree:PATH-OF-DEV --b tree:. --out "$O"`; then push and update the PR.
6. Shared clones borrow objects from this repository: remove `$W` before any `git gc --prune=now` here, and do the
   same for a `--keep` readiness tree.

Pass: step 5's diff lists only P's own files, `npm test` has 0 failures outside `test/flaky-register.json`, and parity has 0 route and flow differences outside P's own routes.

## After the split

On the split tree (`ui/public/parts.json` exists), `node tools/split-by-feature.mjs --check` and its test
(`test/split-by-feature-plan.test.mjs`) catch three old-layout changes that otherwise merge cleanly
(`tools/split-by-feature/after-split.mjs`):

- **A movable route left in `ui/server.mjs`.** Between the parts-aware static mount (`servePublic`) and the SPA fallback,
  the rules that moved routes at the split (`tools/split-by-feature/routes.mjs`) still apply. A route they would move, and
  whose key is not in `tools/split-by-feature/pinned.json`, fails with
  `route GET /api/x (ui/server.mjs:N) belongs in ui/routes/FEATURE/ — run npm run split:catch-up -- BRANCH`.
- **A route above the static mount.** The top of `ui/server.mjs` is for central sign-in and guards only: any
  `app.get|post|put|patch|delete|all` call before `servePublic` whose method and path are not in
  `tools/split-by-feature/central-routes.json` (today's ingress, body-limit, git guard and `/vendor` routes, each with
  its reason) fails with the same message plus `(top of ui/server.mjs is for central sign-in and guards only)`. The
  rule is the same for people and AI agents: move the code, never add an exception.
- **A kept monolith.** `ui/public/style.css` or `ui/public/index.html` next to `ui/public/parts.json`, typically a
  modify/delete conflict resolved by keeping the PR's copy, is not served: the app builds `/style.css` and the page from
  the parts. `--check` and `test/public-assets.test.mjs` fail and name the catch-up command.

**Reading a catch-up parity warning.** `npm run split:catch-up -- BRANCH` compares dev with the caught-up tree in quick
parity. When the 3-way apply is clean and the related tests pass, it exits 0 and prints the `To take it:` line. Route,
flow or signed-out differences outside the routes the patch adds are printed as
`warning: parity: these routes differ from dev; check they are your PR's own changes: …`, and the verdict reads
`works (review parity warning)`. A PR that changes API behaviour on purpose lists its own routes here. Check that each
one is your change, then take the result. A difference you did not make is a hand fix. `--fixture` (split:verify row j)
still counts parity differences as a hand fix, and `--all` and the readiness row run no parity, as before.

## The readiness command

`tools/readiness.mjs` (`npm run readiness -- …`) has three subcommands:

| Command | What it does | Exit |
|---|---|---|
| `run [--out DIR] [--keep] [--dev-ref REF] [--crawl-from DIR \| --waive-crawl OWNER:REASON] [--catch-up-from FILE]` | fetches `origin/dev`, builds and checks the migrated tree, rehearses the rollback, checks open PRs, writes `DIR/report.md` and `DIR/report.json`. `--dev-ref` rehearses on another commit (for example origin/dev merged with an unmerged branch); `post` refuses such a report. `--crawl-from` / `--catch-up-from` reuse split:verify's crawl and catch-up dry run when their trees are this run's (the crawl also under the crawl reuse rule). `--waive-crawl` records the owner's waiver: no crawl is spawned or copied, and the parity row reads `⚠ waived` while its parity passes; `post` refuses a report with a waived row | 0 go, 1 no-go |
| `post --out DIR` | checks `gh auth status` and the `origin` URL, scans the comment, comments on #919 and confirms `gh issue view 919 --comments` shows it | 0 posted, 1 refused or failed |
| `split --rev REV --splitter-rev REV --out DIR` | the catch-up recipe's split: clones both revisions as scratch clones under `DIR`, splits the first with the second's splitter, commits; a failed split removes the out dir it made, or empties the one it was given | 0 split |

Exit 2 is a bad argument; exit 3 means the run could not start (the out dir is not empty, `git fetch origin dev`
failed, or the report would link a file it did not write), and no report is written. Without `--out`, `run` writes
to a new folder under the temp dir. A run takes about 30–45 min: 2 `npm ci`, 2 full suites, 1 full parity and 1 quick parity. Its Inputs section prints
the owner and the freeze window from the Inputs table above.

`run` works in shared clones under `DIR/trees` (`base` and `migrated`), checked out detached at the dev SHA and
marked as scratch; it adds no worktree, branch or tag to this repository. They are removed at the end unless `--keep`
is given. Its 11 steps print a `[n/11]` line each; steps 1–10 each produce one check row (`✔ pass` or `✖ fail`, or `⚠ waived`
on the parity row under `--waive-crawl`), step 11 writes the report:

1. `gh-auth`: `gh auth status`.
2. `split-check`: `node tools/split-by-feature.mjs --check --stats` on the dev commit; fails while the spike gate fails, and names a missing splitter (`splitter missing: …`) when the dev
   commit has no `tools/split-by-feature.mjs`.
3. `dry-run-repeatable`: the split is built twice; both tree hashes must match. The result is committed as the
   migration commit.
4. `equivalence`: the served CSS and `index.html` bytes and the ordered route table are identical on both trees, and
   slice 1's served-output and route-table equivalence (`tools/split-by-feature/equivalence.mjs`) holds, whose
   accepted deltas go to `evidence/accepted-deltas.json`.
5. `docs-and-package`: the migration rewrites `docs/design-system.md`, lists every moved file in
   `docs/feature-files.md`, and `npm pack` lists `ui/routes/` and every feature folder.
6. `suite-migrated`: `npm test` on the migrated tree has 0 failures outside `test/flaky-register.json`.
7. `parity`: `tools/parity.mjs run` of dev against the migrated tree passes, and so does the differential crawl of
   dev against the migrated tree (`crawl/report.md`; reused from split:verify row h when its trees match or the crawl
   reuse rule holds). Under `--waive-crawl` the full parity still runs: the row is `waived` when it passes and `fail`
   when it fails, and `evidence/crawl-waived.txt` records the waiver.
8. `open-prs`: every open PR and `dependabot/*` branch is merge-checked against dev and the migration commit and
   gets one action. A head closed or deleted between the listing and the fetch is left out and named in the row.
   Each also gets a Catch-up column from the catch-up dry run (`works`, `needs hand fix` with the reason, or
   `not run`); a hand fix there does not fail the row.
9. `rollback`: rollback A on the migrated clone (revert the migration commit): the diff to dev is empty, and the
   suite and a quick parity pass again (no e2e: with an empty diff the reverted tree is dev's own; the e2e suites run
   in split:verify row i and the `firefox-e2e` CI job). While `split-check` fails this proves the mechanics only.
10. `baseline`: conflicted-merge share, boot and page-load medians and the dead-code count, dev against migrated.
    It fails when `open-prs` fails (no table to compare); no open PRs at all is a passing, empty comparison.

`report.md` has 11 sections: Verdict, Dev commit, Migration checks, Test suite, Parity, Rollback rehearsal, Open PRs
and dependabot branches, Baseline comparison, Files and lines moved per feature, Risks and surprises (accepted deltas,
the capped `ui/server.mjs`, every ceiling raise from `tools/split-by-feature/size-caps-raises.json` as needing the
owner's sign-off, the pinned routes), Inputs and next steps. The Verdict names the cause of a failed
split-check: either the missing splitter or the spike gate. Each row links
its evidence: a file inside `DIR` (`evidence/…`, `crawl/…`, `parity/…`, `parity-reverted/…`) or a GitHub URL. A step that throws
is a `fail` row whose evidence is `evidence/ID.log` with the error.

In the posted comment, `DIR`, the repo root and the home dir read `$OUT`, `$REPO` and `~`, every evidence link points
to a collapsed tail (the last 40 lines) under `## Evidence`, and the comment is capped at 60 000 characters by omitting
the largest tails. A tail the secret scan flags is omitted automatically, and the command prints which. A finding in
the report itself refuses the post (`readiness: refusing to post: line 12: …`): read that line in `DIR/comment.md`,
fix its cause, and rerun step 3. Do not edit the evidence by hand.

When `suite-migrated` or `rollback` fails on a test that is not in `test/flaky-register.json`: run that file alone
in the kept tree (`npm run readiness -- run --keep …`, then `node tools/test.mjs FILE` in `OUT/trees/migrated`) three
times. If it passes alone, record it in `test/flaky-register.json` through a PR (the register's own test checks the
entry's shape), note it in the #919 comment thread, and rerun step 3. If it fails alone, it is a real regression: no-go.

## PR scope check

The tooling PR changes tooling only. Each line prints nothing or exits 0 (`e2e/` is allowed: `e2e/extension/visual.spec.mjs`
reads `style.css` through `src/core/read-style-css.mjs`):

```sh
git diff --name-only origin/dev...HEAD | grep -vE '^(tools|test|docs|e2e)/|^\.github/workflows/|^package\.json$|^npm-shrinkwrap\.json$|^src/core/(public-assets|read-index-html|read-server-source|read-style-css)\.mjs$'
git diff --quiet origin/dev...HEAD -- ui/server.mjs ui/public/style.css ui/public/index.html
git diff origin/dev...HEAD -- package.json | grep -E '^[+-] ' | grep -vE '"(parity|readiness|split:verify|split:go-no-go|split:catch-up|acorn|eslint-scope)":'
```
