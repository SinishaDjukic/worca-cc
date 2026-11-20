# Stack PR fix rounds under their run: one PR, one Needs you

Status: proposal (2026-11-05). Extends the run-redesign spec §3.6 / §3.6a. It does not change those decisions; it
makes the Runs list follow them.

## 1. What the person sees today

Runs › Needs you shows **8** items for **one** pull request (SinishaDjukic/worca-cc#947):

- the feature group "Flag Runs That Finish Without…", raised to Needs you by member 3's PR (`Conflicts`), and
- 7 separate cards, "Merge dev into PR 947 …" / "Merge origin/dev into …", each one `Conflicts · In review`.

The Runs badge says 8 as well. All seven cards are the same branch
(`worca-cc/run-3-route-swallowed-step-failures-ba22d7fd`) and the same PR, and none of them can be acted on alone. The
only thing the person can do is resolve the PR's conflicts again, which adds a ninth card.

## 2. Why (from the code and the local DB)

| # | Cause | Where |
|---|---|---|
| 1 | Every conflict fix is its own pipeline, and it is **already marked as a round** of run 3: `branch.roundOf = { pipelineId: ba22d7fd, round: 2…8, by: 'watch', kinds }`. | `pr-watch.mjs` `prepareAndStart` → `ui/server.mjs` `prFixRoundOf` |
| 2 | The Runs list folds **group members** into their group row (`memberKeys`), but it never reads `roundOf`, so every round lists as a top-level row. That breaks spec §3.6: "shown as rounds of the same run, never as new rows". | `ui/public/runs-list.mjs` `buildRunsModel` / `groupOf` |
| 3 | When the fix run publishes, `attachPr` writes the PR onto the **round's own row** (`pr_url`). Every round therefore gets its own PR chip, and `finishedNeedsYou` raises each one to Needs you independently. | `pr-watch.mjs` `publishFix` → `attachPr`; `run-model.mjs` `finishedNeedsYou` |
| 4 | The badge and Activity count History rows without folding (`needsYouItems`), so even a folded list would still say 8. | `runs-list.mjs` `needsYouItems` / `countNeedsYou`, `activity-model.mjs` |
| 5 | `dev` moves fast. Each new base sha that clashes is a new `conflict:<head>@<base>` key, so it needs a new round. The watch hit its cap (`needs-person`, `cap`, `fix_runs = 6`), and **Resolve** (`resolveOnce`) bypasses the cap, so every Resolve click adds another round. | `collectTriggers`, `resolveOnce`, `MAX_FIX_RUNS = 3` |

The data model is already right: the rounds know their run. What's wrong is that the list and the Needs-you count
ignore that link.

## 3. Proposal

There are three layers. A and B fix what you see and can ship together. C reduces how often new rounds happen and is
optional.

### A. Stack rounds under their run (the list)

**Rule:** a row whose run has a `roundOf` marker is never a top-level row. It folds into its **origin** (round 1):
the origin's own row, or, when the origin belongs to a group, that group member's row.

What changes:

1. **Wire.** `listAllPipelines` (History) and the live items expose `roundOf: { pipelineId, round, by, kinds, outcome }`
   from the indexed marker (`idx_pipelines_round_of`, `ROUND_OF_EXPR`). History currently sends `branch` as just the
   feature name, so the marker never reaches the client.
2. **Fold.** `buildRunsModel` adds a round fold *before* the group fold:
   - key each round row by `p:<origin>`; the origin row collects them in `row.rounds[]` (sorted by `round`);
   - the group's `memberKeys` also take each member's round keys, so opening a round marks the member and the group
     as selected (`isMemberOpen`);
   - the stack's `activityMs` is the latest round's, so the run moves back up Recent when a round runs;
   - **orphan fallback:** if the origin isn't listed (deleted, or filtered out by person or label), the newest round
     stands in for it, titled with the origin's title plus `Round n`. A round never disappears.
3. **Row.** The origin row reads as one piece of work:

   ```
   ● 3 · Route swallowed step failures                ⇅ Conflicts   ⋯
     Round 8 · merge dev in · pushed 3e4f5a6 · Thu     ▸ 7 rounds
   ```

   - The status line is the **latest** round's (spec D22 `roundLine`): `Running · Round 8 · merge dev in` while live,
     else its outcome (`pushed …`, `nothing pushed: conflicts remain`).
   - `▸ 7 rounds` expands a compact sub-list, one line per round, like group members:
     `R8 merge dev in · pushed 3e4f5a6 · Thu`, `R7 merge dev in · pushed … · Wed`, … Each line opens that round's
     page. The list is closed by default; when there are more than 5, it shows the latest 5 and a `+2 earlier` line.
   - Inside a feature group, the member line gets the same `R8` suffix and the expander. The group row's count
     (`3/3`) is unchanged, because rounds are not members.
4. **Archived origin.** While the origin is archived, its rounds are hidden from the active list too. Nothing is
   written to the DB. A real archive cascade is out of scope: `archivePipeline` reclaims the branch, and rounds share
   it. See plan D4.

### B. One PR, one Needs you (the state)

**Rule:** a PR's state belongs to the run that **opened** it (the origin, or the workspace run that owns the member
PR). Rounds report outcomes; they don't own the PR.

1. `prNeedsOf` / `finishedNeedsYou` return false for a row with `roundOf`. The PR chip on a round line shows the
   **outcome** (`pushed`, `failed`), never the PR's state.
2. `needsYouItems` (badge, Activity, chat home) drops round rows and dedupes by PR url: when two rows without a
   round marker point at the same open PR (for example a hand-started "Resolve conflicts…" chat run), only the
   newest one counts.
3. **What the one item says:** the origin, or its group, is Needs you once, with the reason from the PR and the
   watch:
   `Needs you · Conflicts · 7 rounds already merged dev in`, with actions `Open PR` · `Resolve` · `Resolve in terminal`.
   The round count is the signal that "dev keeps moving".

Result for #947: **1** Needs-you item (the feature group, member 3), badge **1**.

### C. Fewer conflict rounds (optional, behaviour)

Showing 7 rounds as one stack hides the noise, but it still costs 7 agent runs. Ordered by value:

1. **Try a merge with no agent on Resolve too.** `prepareAndStart` already tries `mergeBase` (a merge commit with no
   agent) on the `behind` path. Do the same first for a `CONFLICTING` PR, since GitHub's "conflicting" is sometimes
   stale and a fresh `merge-tree` is clean. This costs nothing when it fails.
2. **Settle the base first.** Hold a conflict round until the base has been quiet for N minutes (default 10;
   `retryState.baseSettle`), the same way `BASE_WAIT_MS` holds check failures. A burst of merges to `dev` then costs
   one round instead of several.
3. **Say it at the cap instead of looping.** After 2 conflict rounds in 24 h, the watch stops with a new reason,
   `conflict-churn`: `Needs you · Watch stopped · dev keeps moving: 3 merges in 24 h`. Resolve still works, but the
   item suggests merging the PR soon or splitting it. Resolve counts toward the same history line, so the person
   sees how many times it has already happened.

Recommendation: ship A + B now (they implement an already-agreed spec), add C1 (cheap and safe), and decide on C2/C3
after a week of data.

## 4. Alternatives considered

- **Reuse one pipeline for every fix (resume instead of a new run).** Rejected. Spec §3.6 keeps each round's diff,
  cost and request separately, the fix workflow (`wf_pr_fix`) differs from the origin's, and a resumed run can't
  re-enter a finished pipeline cleanly.
- **Hide finished rounds entirely.** Rejected. The person loses the trail (cost, what was pushed), and a failed round
  would vanish.
- **Group the rounds as a user group.** Rejected. Groups are for separate work items with a count (`3/3`); rounds
  aren't members, and they would inflate the count and the group total twice.

## 5. Edge cases

- **Live round:** the stack is Working (`Running · Round 9 · merge dev in`) and the chip reads `Fixing`; it is not
  Needs you (spec §3.6a).
- **Workspace runs:** the origin is the workspace run, and the member key is already in the round's request
  (`fixRoundWords`). The fold is the same.
- **Show filters:** a stack counts as Running when any round is live, and as Needs you only through its origin.
- **Group by project / date:** the stack files under the origin's project and its latest round's date.
- **Old runs with no marker** (the Oct 5 "Resolve Conflicts With Dev" runs) are unchanged, except for B2's PR-url
  dedupe.

## 6. Files

- `src/core/artifacts.mjs`: `listAllPipelines` adds `roundOf` (and the live item adapter in `ui/public/app.js`).
- `ui/public/runs-list.mjs`: round fold, `rounds[]`, `memberKeys`, `needsYouItems` dedupe, the stack DOM (expander +
  round lines).
- `src/shared/run-model.mjs`: `finishedNeedsYou` / `prOf` ignore a round's own PR; the origin's Needs-you line carries
  the round count.
- `ui/public/activity-model.mjs`: nothing to change beyond `needsYouItems` (it uses it).
- C1 / C2 / C3: `src/core/pr-watch.mjs` (`prepareAndStart`, `collectTriggers`, a new `conflict-churn` reason in
  `WATCH_WHY`).

## 7. Tests

- 7 round rows plus their origin in a feature group → 1 top-level row; member 3 has `rounds.length === 7`.
- The badge and Activity count 1 for that fixture (the counts today are 8 and 8).
- A live round → the stack is Running, the chip reads `Fixing`, not Needs you.
- An origin that is missing or filtered out → the newest round stands in, titled `… · Round 8`.
- Selecting a round marks its member and group (`isMemberOpen`).
- Two unmarked runs on the same open PR → one Needs-you item.
- (C1) A conflicting PR whose fresh `merge-tree` is clean → pushed with no fix run and no new round.
