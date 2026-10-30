# Split by feature (#919): runbook

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
| 4. Freeze day | announce the freeze on #919; rerun step 3 on the final dev commit; apply and merge the split as one squash commit M (slice 1's revised `--apply`) | go/no-go owner | readiness `go` on the exact commit the split is applied to |
| 5. After the freeze | the PR catch-up recipe for each `catch up after the freeze` row; rebase the express 5 PR; rollback A or B if needed | PR authors; owner for rollback | `npm test` and `npm run parity -- run --a tree:. --b tree:. --out /tmp/p-dev` green on dev; no open PR conflicts only because of the split |
| 6. Before the next release | `npm pack --dry-run` lists `ui/routes/` and every feature folder; `npm run parity -- run --a tree:. --b package:. --out /tmp/p-pack`; release per docs/RELEASING.md | release owner | 0 route, visual and flow differences between the tree and the package |

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
| `run [--out DIR] [--keep]` | fetches `origin/dev`, builds and checks the migrated tree, rehearses the rollback, checks open PRs, writes `DIR/report.md` and `DIR/report.json` | 0 go, 1 no-go |
| `post --out DIR` | checks `gh auth status` and the `origin` URL, scans the comment, comments on #919 and confirms `gh issue view 919 --comments` shows it | 0 posted, 1 refused or failed |
| `split --rev REV --splitter-rev REV --out DIR` | the catch-up recipe's split: clones both revisions as scratch clones under `DIR`, splits the first with the second's splitter, commits | 0 split |

Exit 2 is a bad argument; exit 3 means the run could not start (the out dir is not empty, `git fetch origin dev`
failed, or the report would link a file it did not write), and no report is written. Without `--out`, `run` writes
to a new folder under the temp dir. A run takes about 40–60 min: 2 `npm ci`, 2 full suites and 2 parity runs.

`run` works in shared clones under `DIR/trees` (`base` and `migrated`), checked out detached at the dev SHA and
marked as scratch; it adds no worktree, branch or tag to this repository. They are removed at the end unless `--keep`
is given. Its 11 steps print a `[n/11]` line each; steps 1–10 each produce one check row (`✔ pass` or `✖ fail`, never
anything else), step 11 writes the report:

1. `gh-auth`: `gh auth status`.
2. `split-check`: `node tools/split-by-feature.mjs --check --stats` on the dev commit; fails while the spike gate fails.
3. `dry-run-repeatable`: the split is built twice; both tree hashes must match. The result is committed as the
   migration commit.
4. `equivalence`: the served CSS and `index.html` bytes and the ordered route table are identical on both trees.
5. `docs-and-package`: the migration rewrites `docs/design-system.md`, lists every moved file in
   `docs/feature-files.md`, and `npm pack` lists `ui/routes/` and every feature folder.
6. `suite-migrated`: `npm test` on the migrated tree has 0 failures outside `test/flaky-register.json`.
7. `parity`: `tools/parity.mjs run` of dev against the migrated tree passes.
8. `open-prs`: every open PR and `dependabot/*` branch is merge-checked against dev and the migration commit and
   gets one action. A head closed or deleted between the listing and the fetch is left out and named in the row.
9. `rollback`: rollback A on the migrated clone (revert the migration commit); the diff to dev is empty, and the
   suite and parity pass again. While `split-check` fails this proves the mechanics only.
10. `baseline`: conflicted-merge share, boot and page-load medians and the dead-code count, dev against migrated.
    It fails when `open-prs` fails (no table to compare); no open PRs at all is a passing, empty comparison.

`report.md` has 10 sections: Verdict, Dev commit, Migration checks, Test suite, Parity, Rollback rehearsal, Open PRs
and dependabot branches, Baseline comparison, Files and lines moved per feature, Inputs and next steps. Each row links
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
