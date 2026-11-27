# Requiring the CI checks on dev

`dev` has no branch rule that requires a check, so a red run does not stop a merge: #1505 merged with a red slow
shard (see [Test offenders](test-offenders.md)). This page is for the repo admin. It turns the three CI checks and
the ticket check below into required checks on `dev`. Follow the steps in order. Step 1 waits for 5 green `dev` push runs; once those are
in, steps 2 to 4 take under 10 minutes and need no code change.

## Required checks

A required check is matched by its job name. This table is the one place the names are written, and
`test/required-checks.test.mjs` fails when a workflow renames one of these jobs.

| Check | Workflow | Job id |
|---|---|---|
| `CI gate` | `.github/workflows/ci.yml` | `ci-gate` |
| `parity (tree against the CI image)` | `.github/workflows/parity-docker.yml` | `parity-docker` |
| `Firefox e2e (Playwright Firefox, branch and split tree)` | `.github/workflows/firefox-e2e.yml` | `firefox-e2e` |
| `Linked issue` | `.github/workflows/pr-context.yml` | `linked-issue` |

The last row is the ticket check: it fails a PR whose description names no issue, and the `no-issue` label is its
bypass. It reports on pull requests only, so the `dev` push steps below speak of the three CI checks.

## 1. See the three checks report

Before you start, slices 1 to 6 and 8 of the CI gate outline are merged into `dev`. These three matter most: without
them a check can stay silent on a PR, or go red on a cancelled or flaky run.

Prerequisite PRs:

| Slice | PR | Merged |
|---|---|---|
| Every required check reports on every PR | [search](https://github.com/worca-org/worca/pulls?q=is%3Apr+%22Every+required+check+reports+on+every+PR%22) | |
| Node test offenders: verdicts and fixes | [search](https://github.com/worca-org/worca/pulls?q=is%3Apr+%22Node+test+offenders%22) | |
| Browser offenders: extension Playwright and the CDP proofs | [search](https://github.com/worca-org/worca/pulls?q=is%3Apr+%22Browser+offenders%22) | |

Open a test PR into `dev` with a one-line docs change and the `no-issue` label. Confirm that every check in Required
checks appears on it and passes. Keep the test PR open for step 4.

Green dev push runs:

Wait for 5 consecutive green push runs on `dev` after the last of the slice 2, 5 and 6 merges, all three checks green
on each commit, and link each run here. Do not start step 3 before all 5 rows are filled. Find the runs in the
[filtered Actions list](https://github.com/worca-org/worca/actions/workflows/ci.yml?query=branch%3Adev+event%3Apush)
(and the parity and Firefox e2e workflows for the same commits). Fill the rows, and any empty Merged cells above, in
one docs PR before step 3. Where a run is already recorded in
[Post-merge check](test-offenders.md#post-merge-check), reuse its run id here instead of collecting it again. That
section also confirms no non-quarantined offender failed in those runs.

| # | Commit | CI | Parity | Firefox e2e |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

## 2. Set up the timings PR identity

The timings refresh (slice 12 of the outline) opens its PR as a GitHub App, so that PR's required checks start
without a person.

1. Create a GitHub App (your account or organisation › Settings › Developer settings › GitHub Apps › New GitHub App).
   Repository permissions: Contents read and write, Pull requests read and write, nothing else. Do not grant
   Workflows or Administration. Webhooks can stay off.
2. Install the App on this repository only.
3. In this repository's Settings › Secrets and variables › Actions, add two repository secrets: `TIMINGS_APP_ID`
   (the App ID) and `TIMINGS_APP_PRIVATE_KEY` (a private key generated on the App's page).
4. In Settings › Actions › General › Workflow permissions, turn on "Allow GitHub Actions to create and approve pull
   requests".

The App token is what lets the refresh PR's required checks start; a PR opened with the default Actions token does
not start workflows. If a secret is missing, the refresh fails with a message naming step 2 of this page.

The refresh is `.github/workflows/refresh-test-timings.yml` ("Refresh test timings", Mondays 03:00 UTC). With a secret
missing, its first check fails with `Refresh test timings needs the GitHub App secrets: see the CI gate admin checklist
step 2` and opens no PR. Run it once by hand (Actions › Refresh test timings › Run workflow) and again a week later, or
by hand twice, to see the same PR updated. When GitHub refuses the App's push because dev changed a workflow file (it
has no Workflows permission), the run closes its open PR, deletes the `timings-refresh` branch, pushes it again and
opens a fresh PR.

## 3. Require the checks on dev

1. Open Settings › Rules › Rulesets › New ruleset › New branch ruleset.
2. Name it, set Enforcement status to "Active", and under Target branches add `dev`.
3. Under Bypass list, add the Repository admin role and set it to "For pull requests only".
4. Turn on "Require status checks to pass". Add each check in Required checks by its exact name, with
   the source "GitHub Actions".
5. Turn on "Require branches to be up to date before merging".
6. Add nothing else. Save.

From now on, an open PR into `dev` that is behind needs "Update branch" (a new run that reports all three checks)
before it can merge. The cost: every merge into `dev` makes each open PR re-run all three checks before it can
merge. A merge queue would avoid that; it is out of scope here (no gating workflow uses `merge_group`).

## 4. Prove the rule

On the test PR from step 1, in this order:

1. Push a commit that fails a fast test. Once the CI gate finishes red, the merge box reads "Merging is blocked".
2. Label probe: add any label, `full-node-matrix` included. No `ci.yml` run starts (a label takes effect from the
   next push), and merging is still blocked. If a run starts, apply [Rollback](#rollback) and open an issue before
   going on.
3. Rollback probe: if the merge box asks for it, press "Update branch" first and wait for the checks. Then remove the
   gate from the ruleset and see the PR become mergeable. Then add it back, as in step 3.
4. Revert the failing commit. The gate passes and merge is allowed.
5. Ticket probe: remove the `no-issue` label. The ticket check turns red and merging is blocked again. Put the label
   back and it passes. Close the test PR without merging.

## Rollback

Remove the check from the ruleset in Settings › Rules › Rulesets (or set the ruleset's Enforcement status to
"Disabled"). A PR blocked only by that check can then merge. This needs no code change. Re-enabling it means
repeating step 3.

To undo step 2: turn the Actions setting off, uninstall the App and delete the two secrets. The timings refresh then
fails, naming step 2.

Every rollback opens (or links) an issue that names the reason and says "repeat step 3 when closed", so getting the
rule back on is tracked.

## Admin bypass

When a required check is broken for a reason outside the PR (a GitHub outage, a runner image break), an admin on the
bypass list ticks the bypass option in the merge box and merges. Before merging, the admin writes the reason and the
failing run link in the PR, and opens an issue for the broken check.

## A red leg that runs only on dev

The Node 22.19.0 and 26 fast legs run on `dev` pushes only (pull requests run the fast tier on Node 24), and the slow
tier runs on `dev` pushes and only on PRs that touch what it exercises. Such a failure shows red on that `dev` commit,
never on the PR that caused it. The next PR into `dev` either fixes it or adds a `test/quarantine.json` entry that
names the failing test, with its `path`, `reason` and `exitCondition`. When the file is a listed offender, that PR
also records the run in [Post-merge check](test-offenders.md#post-merge-check). The `full-node-matrix` label
reproduces the Node legs on that PR from its next push.
