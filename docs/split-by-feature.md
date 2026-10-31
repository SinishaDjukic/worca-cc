# Split by feature (#919): runbook

## Before Ship and on freeze day: `npm run verify:919`

One command, from a clean checkout of the commit to ship (this branch merged with the latest dev, or dev itself on
freeze day). It runs every check below in order, never stops early, prints one table (check · pass/fail · number ·
evidence file) and exits 0 only when every row passes. It never posts on #919 and never pushes. It takes several hours; the
table in `OUT/verify-919.md` grows row by row (`npm run verify:919 -- --out DIR [--keep]`; without `--out`, a new temp
folder). Firefox (for `e2e:firefox-smoke`) and Playwright's Chromium (for `e2e:extension`) must be installed: a suite
that prints SKIP is a fail.

| Check | Pass means |
|---|---|
| a. fetch | `git fetch origin dev` works; the table head prints the SHA used; HEAD contains it; no tracked changes |
| b. gate | `node tools/split-by-feature.mjs --check --stats` exits 0 and prints `spike gate passed` |
| c. dry-run-repeatable | `--dry-run` twice: both exit 0 and print the same tree hash |
| d. suite-split | full `npm test` on the split tree: 0 failures outside `test/flaky-register.json`; each register failure is named with its entry and its file rerun alone (`evidence/d-suite-split-flaky.json`) |
| e. parity-quick | quick parity, this tree against the split tree: PASS, 18 shot pairs, all 6 flows on both sides |
| f. parity-full | full parity with the timing gate, this tree against the split tree: 0 route, 0 visual, 0 flow differences; every route probed signed in and signed out; 18 screenshots light and dark; boot and page-load timings gated and within budget |
| g. parity-package | full parity, this tree against its own `npm pack` (`package:.`): 0 differences, same completeness as f (timings are not gated for a package) |
| h. e2e-split | every `e2e:*` suite in `package.json` but the snapshot updater, on the split tree: exit 0 and no SKIP |
| i. rollback | the split reverted: diff to HEAD empty, then suite, full parity and the e2e suites pass again |
| j. readiness | `npm run readiness -- run` (with `--dev-ref` when HEAD is not dev): verdict `go`; `report.md` and `report.json` written |

A failing row names its evidence file inside `OUT`. When it is a test that is in the register, the row stays green
and the evidence names the entry and the solo rerun. When it is not, follow "When `suite-migrated` or `rollback` fails"
under The readiness command below.

This runbook does not choose its inputs. Fill them in on #919 before step 3:

| Input | Value |
|---|---|
| Go/no-go owner | |
| Freeze window | |

Docs note: `docs/design-system.md` and the generated `docs/feature-files.md` change only in the migration commit itself
(freeze day). Until then dev's docs describe the unsplit files, and the readiness `docs-and-package` row is the proof
that the migration commit updates them.

| Step | What to run | Who | Pass means |
|---|---|---|---|
| 1. Prepare | `npm test`; `node tools/split-by-feature.mjs --check --stats` | any contributor | both exit 0; the spike gate line says `passed` |
| 2. Keep ready | on every PR touching `ui/server.mjs`, `ui/public/style.css` or `ui/public/index.html`: CI (split-by-feature tests + `Parity (dev against itself)`); a new route gets a row in `tools/split-by-feature/feature-map.json` and `tools/parity/route-classes.json` | the PR author | CI green; `--check` prints `covered` |
| 3. Readiness | `npm run readiness -- run --out DIR`; read `DIR/report.md`; `npm run readiness -- post --out DIR` | go/no-go owner | verdict `go`; the comment shows in `gh issue view 919 --comments`; every PR author with an action is told |
| 4. Freeze day | announce the freeze on #919; rerun step 3 on the final dev commit; on a clean checkout run `git fetch origin dev && git switch -c split/919-migration origin/dev && node tools/split-by-feature.mjs --apply && node tools/split-by-feature.mjs --apply && git add -A && git commit -m "Split large files by feature (#919)"` (the second `--apply` prints `0 files changed`); open its PR into dev and squash-merge it as M | go/no-go owner | readiness `go` on the exact commit the split is applied to |
| 5. After the freeze | the PR catch-up recipe for each `catch up after the freeze` row; rebase the express 5 PR; rollback A or B if needed | PR authors; owner for rollback | `npm test` and `npm run parity -- run --a tree:. --b tree:. --out /tmp/p-dev` green on dev; no open PR conflicts only because of the split |
| 6. Before the next release | `npm pack --dry-run` lists `ui/routes/` and every feature folder; `npm run parity -- run --a tree:. --b package:. --out /tmp/p-pack`; release per docs/RELEASING.md | release owner | 0 route, visual and flow differences between the tree and the package |

The spike gate (`--check --stats`): at least 95% of the route statements between the static mount and the SPA
fallback move, and the residual `ui/server.mjs` is at most its ceiling in `tools/split-by-feature/size-caps.json`
(10,085 lines: the residual on `04370c0f6` merged with dev `c82347c7c`, whose git automations added 113 lines to it;
accepted as is). `--apply` refuses a failed gate; `--dry-run` reports it as a problem and exits 1. Raising the ceiling
is a hand edit in a reviewed PR.

## Rollback
Two layers roll back separately. The tooling PRs (slices 1–3 and the #919 follow-up; T below is the one to undo)
change no served output and no runtime path. The migration commit M has its own procedures, A and B below.

Tooling, plain revert (T is still the newest commit on dev): `git switch -c revert/919-tooling origin/dev && git revert --no-edit T`
(`git revert -m 1 T` if T is a merge commit). Check: `git diff origin/dev^ HEAD` prints nothing and `npm test` ends with `fail 0`.

Tooling, two-part revert (later PRs landed on top of T, and their tests read the shell through
`src/core/public-assets.mjs`): keep `src/core/public-assets.mjs`, `src/core/read-index-html.mjs`,
`src/core/read-style-css.mjs`, `src/core/read-server-source.mjs` and the codemodded reads; `git rm -r` the splitter
(`tools/split-by-feature.mjs` and its folder), the readiness command (`tools/readiness.mjs` and its folder), their tests
(`test/split-by-feature*.test.mjs`, `test/readiness*.test.mjs`) and their entries in `test/tiers.json` and
`.github/workflows/ci.yml`. Check: `npm test` ends with `fail 0` and `tools/split-by-feature.mjs` is gone.

Pass: the check of the procedure used holds, and no file under `ui/` changed.

M is the migration commit. The repo squash-merges, so M is one non-merge commit and `M^` is the dev commit it split.
If M were ever a merge commit, use `git revert -m 1 M` below.

## Rollback A: still frozen (no later commit touched the split files)
1. `git log --format=%h M..origin/dev -- ui/routes ui/public ui/server.mjs docs/design-system.md docs/feature-files.md package.json` prints nothing.
2. `git switch -c revert/919-split origin/dev && git revert --no-edit M`
3. `git diff --stat M^ HEAD -- ui docs/design-system.md docs/feature-files.md package.json` prints nothing; `npm test`; `npm run parity -- run --a tree:PATH-OF-M^ --b tree:. --out /tmp/p-revert`.
4. PR into dev, linked to #919. (The readiness `rollback` row rehearses steps 2–3 on every dry run, on a clone with no later dev commits.)

Pass: step 3's diff prints nothing, `npm test` has 0 failures outside `test/flaky-register.json`, and the parity run prints PASS.

## Rollback B: later commits touched the split files
Not rehearsed by the readiness command: it depends on the commits that land after M.
1. List them: `git log --format='%h %s' M..origin/dev -- ui/routes ui/public ui/server.mjs`.
2. Save the served CSS and HTML of today's dev (the same bytes the split serves):
   `node --input-type=module -e "import {assemble} from './src/core/public-assets.mjs'; import fs from 'node:fs'; for (const [k,f] of [['css','style.css'],['html','index.html']]) fs.writeFileSync('/tmp/919-'+f, assemble(k,f,'ui/public').text)"`
3. `git switch -c revert/919-split origin/dev && git revert --no-commit M`
4. Conflicts in `ui/public/**` parts: `git rm` the parts and `parts.json`; copy `/tmp/919-style.css` and `/tmp/919-index.html` to `ui/public/`.
   Check: `cmp /tmp/919-style.css ui/public/style.css && cmp /tmp/919-index.html ui/public/index.html` exits 0.
5. Conflicts in `ui/routes/*.mjs`: for each commit from step 1, move its hunk from the route file back to the same handler in
   `ui/server.mjs` (`git show HASH -- ui/routes` is the list); then `git rm -r ui/routes`.
   Check: `git grep -n "ui/routes" -- ui/server.mjs` prints nothing, and `git status --porcelain` shows no `UU` line.
6. `npm test`; `npm run parity -- run --a tree:PATH-OF-DEV --b tree:. --out /tmp/p-revert`.
7. Commit, PR into dev, linked to #919.

Pass: both checks in steps 4 and 5 hold, `npm test` has 0 failures outside `test/flaky-register.json`, and the parity run in step 6 reports 0 route, visual and flow differences.

## PR catch-up recipe (a PR branch P that started before M)
This runs the splitter from dev at `M^`, never P's own copy of it, and the tool makes both scratch clones itself.
M below is the migration commit's full SHA.
1. `git switch P && git merge M^` (bring P to the commit just before the split; resolve ordinary conflicts).
2. `W=$(mktemp -d)/c && node tools/readiness.mjs split --rev HEAD --splitter-rev M^ --out $W` (clones `HEAD` to
   `$W/tree` and `M^` to `$W/splitter`, splits the first with the second's splitter, commits the result).
3. `git -C $W/tree diff --binary M HEAD > /tmp/P.patch` (P's change, in the split layout: M is the split of M^).
4. `git switch -c P-caught-up origin/dev && git apply -3 /tmp/P.patch && git commit -m "catch up with the #919 split"`.
5. `git diff --stat origin/dev` lists only P's own files; `npm test`; `npm run parity -- run --a tree:PATH-OF-DEV --b tree:. --out /tmp/p-catchup`; then push and update the PR.
6. Shared clones borrow objects from this repository: remove `$W` before any `git gc --prune=now` here, and do the
   same for a `--keep` readiness tree.

Pass: step 5's diff lists only P's own files, `npm test` has 0 failures outside `test/flaky-register.json`, and parity has 0 route and flow differences outside P's own routes.

## The readiness command

`tools/readiness.mjs` (`npm run readiness -- …`) has three subcommands:

| Command | What it does | Exit |
|---|---|---|
| `run [--out DIR] [--keep] [--dev-ref REF]` | fetches `origin/dev`, builds and checks the migrated tree, rehearses the rollback, checks open PRs, writes `DIR/report.md` and `DIR/report.json`. `--dev-ref` rehearses on another commit (for example origin/dev merged with an unmerged branch); `post` refuses such a report | 0 go, 1 no-go |
| `post --out DIR` | checks `gh auth status` and the `origin` URL, scans the comment, comments on #919 and confirms `gh issue view 919 --comments` shows it | 0 posted, 1 refused or failed |
| `split --rev REV --splitter-rev REV --out DIR` | the catch-up recipe's split: clones both revisions as scratch clones under `DIR`, splits the first with the second's splitter, commits; a failed split removes the out dir it made, or empties the one it was given | 0 split |

Exit 2 is a bad argument; exit 3 means the run could not start (the out dir is not empty, `git fetch origin dev`
failed, or the report would link a file it did not write), and no report is written. Without `--out`, `run` writes
to a new folder under the temp dir. A run takes about 40–60 min: 2 `npm ci`, 2 full suites and 2 parity runs.

`run` works in shared clones under `DIR/trees` (`base` and `migrated`), checked out detached at the dev SHA and
marked as scratch; it adds no worktree, branch or tag to this repository. They are removed at the end unless `--keep`
is given. Its 11 steps print a `[n/11]` line each; steps 1–10 each produce one check row (`✔ pass` or `✖ fail`, never
anything else), step 11 writes the report:

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
7. `parity`: `tools/parity.mjs run` of dev against the migrated tree passes.
8. `open-prs`: every open PR and `dependabot/*` branch is merge-checked against dev and the migration commit and
   gets one action. A head closed or deleted between the listing and the fetch is left out and named in the row.
9. `rollback`: rollback A on the migrated clone (revert the migration commit); the diff to dev is empty, and the
   suite, parity and every `e2e:*` suite in `package.json` (today `e2e:extension` and `e2e:firefox-smoke`; the
   snapshot updater `e2e:extension:update-linux` is not a suite) pass again; a suite that prints SKIP is listed as
   skipped; the row fails when no suite ran. While `split-check` fails this proves the mechanics only.
10. `baseline`: conflicted-merge share, boot and page-load medians and the dead-code count, dev against migrated.
    It fails when `open-prs` fails (no table to compare); no open PRs at all is a passing, empty comparison.

`report.md` has 11 sections: Verdict, Dev commit, Migration checks, Test suite, Parity, Rollback rehearsal, Open PRs
and dependabot branches, Baseline comparison, Files and lines moved per feature, Risks and surprises (accepted deltas,
the capped `ui/server.mjs`, the pinned routes), Inputs and next steps. The Verdict names the cause of a failed
split-check: either the missing splitter or the spike gate. Each row links
its evidence: a file inside `DIR` (`evidence/…`, `parity/…`, `parity-reverted/…`) or a GitHub URL. A step that throws
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
