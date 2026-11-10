# Stack PR fix rounds under their run (A + B) Implementation Plan

**Goal:** In the Runs list, a run's rounds (Watch PR fix runs, Resolve, Ask for changes → Round n) never appear as
top-level rows. They stack under the run that opened the PR, and one open PR raises at most one Needs-you item. For
SinishaDjukic/worca-cc#947 the list goes from 8 Needs-you items to 1, and the badge from 8 to 1.

**Spec:** `plans/pr-fix-rounds-stacking-design.md` §3 A and B (this plan wins where it is more exact).
`plans/run-redesign-design-spec.md` §3.6 / §3.6a (rounds are "never new rows"; `Fixing` while a fix round is live).

**Visual reference:** `plans/mocks/pr-fix-rounds-stacking.html` has three states: Today, Proposed, and Proposed ·
round 9 running. Build what it shows. The mock's commit hashes and titles are placeholders.

**Architecture:** No schema change. The round marker `pipelines.branch.roundOf` already exists, and `idx_pipelines_round_of`
indexes it. The work is:

- the History wire carries the marker;
- the run model stops raising a round to Needs you through its PR;
- `buildRunsModel` folds round rows into their origin before the group fold;
- `renderItem` draws the stack line and its expander.

C (fewer conflict rounds) is out of scope.

**Tech stack:** Node ESM, `node:test`, jsdom, vanilla DOM (`ui/public/*.mjs`), Express (`ui/server.mjs`).

## Decisions (D1–D9)

- **D1 (what a round is):** a run whose marker is `roundOf: { pipelineId, round ≥ 2, … }`. `roundOf.pipelineId`
  always names round 1, the origin (`roundOrigin`), so there are never chains of rounds.
- **D2 (fold target):** a round row folds into the row whose `pipelineId` is its origin. If there is no such top-level
  row, it folds into the group member with that `pipelineId`. The origin row or member gets `rounds: Round[]`, newest
  first.
- **D3 (orphan):** when neither the origin row nor the member is in the input (deleted, or filtered out by person or
  label), the newest round becomes the stack head. It keeps its own href, and its title becomes
  `<origin title or round title> · Round n`. Its older rounds stack under it. A round is never silently dropped.
- **D4 (archived origin):** while the origin is archived, its rounds are hidden from the active list, whether or not
  they are archived themselves. Nothing is written to the DB; the list just follows the origin. Under Show = Archived,
  they fold under the archived origin as usual. This replaces the design's "Archive cascades", because
  `archivePipeline` reclaims the branch and rounds share it, so a DB cascade is a separate change.
- **D5 (stack head while a round is live):** if a round is live (starting, running, paused or pausing), the row's
  model is that round's `runModel`, with the origin's title, position and href. The line is `Running · Round n ·
  <request>`, the dot is Working, and the chip reads `Fixing` (existing D31 behaviour through the origin's watch). The
  row is not Needs you through the PR. A live round that asks a question or is paused for a limit **is** Needs you,
  and raises the stack.
- **D6 (stack line when nothing is live):** under the row's own title and chip, the sub-line is the newest round's:
  `Round n · <request> · <outcome>` plus the list's `· <time>`. The expander `▸ k rounds` sits at the line's end.
  When the origin needs a person for any reason other than its PR (a question, a pause), the row's own model line
  wins and the round line becomes a second line.
- **D7 (round line words):** `<request>` is `roundOf.request` (for Watch PR rounds, the `fixRoundWords` text such as
  `merge dev in` or `<member> · resolve conflicts`; for an Ask round, the person's first line). `<outcome>` comes from
  `roundOf.outcome`:
  - `pushed` → `pushed <sha>`
  - `failed` → `nothing pushed: <WATCH_WHY[reason] or reason>`
  - `ended` → `PR <reason>`

  With no outcome, it comes from the round's status: done → `done`, failed → `failed`, stopped → `stopped`, live →
  `running`.
- **D8 (one PR, one Needs you):** `finishedNeedsYou(run)` is false for a round, and so is `runModel`'s `prNeeds`.
  `needsYouItems` keeps a round only for its own non-PR reasons (a question, paused, failed and unread). Among rows
  without a round marker that are raised by the **same open PR url**, only the newest counts (badge, Activity, and the
  Needs-you section). The others list under Recent.
- **D9 (expander state):** the open or closed state of a stack lives in `runsUi.groupsToggled`, under the key
  `rounds:<origin pipelineId>`, and is closed by default. An open stack shows the newest 5 rounds plus a
  `+n earlier` line, which shows all of them when clicked. A round line is a link to that round's page
  (`#history/<pk>/<id>`, or `#running/<runId>` while live).

## Global constraints

- One commit per task. Subjects start with `Runs list:`, and every message ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `runs-list.mjs` and `src/shared/run-model.mjs` stay pure (no DOM globals, no clock), as they are today.
- `style.css`: tokens only. Rows stay 1px-divided rows (spec §1), and round lines are plain text links, not cards.
- No change to how rounds are **created** (`pr-watch.mjs`, `/resolve-pipeline`, `changes.mjs`) or stored.
- The run page of a round is unchanged, apart from D8: it no longer reads Needs you through the PR.
- One test file: `node tools/test.mjs test/<file>.test.mjs`. Full suite: `npm test` (compare failures with `dev`
  before blaming this branch).

## Tasks

### Task 1: the History and live wire carry the round marker

- `src/core/artifacts.mjs` `rowToHistoryEntry`: add `roundOf`, built from `branchObj.roundOf` by a small
  `wireRoundOf(m)`. The result is `{ pipelineId, round, request, by?, kinds?, outcome? }`, or omitted when there is no
  valid marker (`Number.isInteger(round) && round >= 2`). Reuse `cleanOutcome` from `src/core/shape/rounds.mjs`; that
  module is a leaf, so check that the import adds no cycle, and if it would, inline the same shape. The `lite`
  (archived) path keeps it too, because D4 needs it.
- `ui/public/app.js`:
  - `runsHistItem` passes `roundOf: p.roundOf || null`, and `histRun` sets `round: p.roundOf` when present (run-model's
    `roundOf` reads `.round`).
  - `runsLiveItem` passes `roundOf` from `r.branch && r.branch.roundOf` (the harness puts it on `state.branch`,
    `run-harness.mjs` ~988).
  - `runsGroupItem` members pass the same `roundOf` (null for an origin).
- `ui/public/runs-list.mjs`: `liveRow` / `histRow` copy `roundOf` onto the row.
- **Tests:**
  - `test/history-round-marker.test.mjs`: a round row's entry has `roundOf.pipelineId`, `round` and `outcome`; an origin
    and a plain run have none; a malformed marker is omitted.
  - `ui-runs-list-model.test.mjs`: `histRow` / `liveRow` copy it.

### Task 2: a round is never Needs you through its PR (D8, model half)

- `src/shared/run-model.mjs`: `finishedNeedsYou(run)` returns false when `roundOf(run)` is not null. `runModel`
  computes `prNeeds` through the same rule, so a round's page says Done rather than Needs you; its PR chip stays.
- **Tests (`test/run-model.test.mjs`):**
  - A done round with a conflicting PR → `state !== 'needs-you'`, `prNeeds === false`.
  - The origin with the same PR → `needs-you`.
  - A round with a stopped watch → not needs-you; the origin with it → needs-you, with the `Watch stopped` line.

### Task 3: Needs-you count, one per PR (D8, list half)

- `ui/public/runs-list.mjs`:
  - `needsYouItems`: a history row with `roundOf` counts only through `needsYou` without `prNeeds`. That already
    follows from Task 2 once `p.run.round` is set, so assert it.
  - Add `dedupeByPr(rows)`: among rows that need you **only** through their PR (`prNeedsOf` true, no question, not
    paused), keep the newest per normalized PR url (`pr.url`, else each `memberPrs[].url`). It is used by
    `needsYouItems` and by `buildRunsModel`'s `needs` flag.
  - `countNeedsYou` and `activity-model.mjs` follow automatically, because both read `needsYouItems`.
- **Tests (`ui-runs-list-model.test.mjs`):**
  - The #947 fixture (origin in a feature group, plus 7 done rounds, all carrying PR #947 `conflicts`) →
    `countNeedsYou === 1`.
  - Two unmarked runs on the same open PR → 1.
  - Two runs on different PRs → 2.
  - A paused round → counts (1 + 1).

### Task 4: fold rounds into their origin (D2–D5)

- `ui/public/runs-list.mjs` `buildRunsModel`, before the group fold:
  1. Split `rows0` into plain rows and round rows (`r.roundOf`).
  2. Index the origins: top-level rows by `pipelineId`, and group members by `pipelineId` (from `groupRows`).
  3. For each origin, build `rounds` (newest first) as `{ n, pipelineId, runId, href, status, state, request, outcome,
     line, activityMs }`, with `line` from a new exported `roundLine(round, now)` (D7).
  4. D4: an archived origin (`archived` on the row, or absent from the active input while present in the archived
     feed, which the caller passes as `archivedIds: Set`) drops its rounds from the active view.
  5. D3: rounds with no origin form an orphan stack headed by the newest round.
  6. D5: if any round is live, the head's `model` becomes that round's model (`runModel(round.run)`), keeping the
     origin's `title`, `href` and `position`; `needs` follows that model. Otherwise the head keeps its own model, and
     `r.roundsLine` is the newest round's `line` (D6).
  7. The round rows leave `rows0`. The origin's `activityMs` becomes the max of its own and its rounds'. The group's
     `memberKeys` gain each round's `p:` and `r:` keys, so `isMemberOpen` marks the group and member while a round's
     page is open, and `isRowSelected` marks a top-level origin when `sel.pipelineId` is one of its rounds (add a
     `roundKeys` set to the row).
  8. The "Needs before the fold" loop runs after this, on heads only.
- **Tests (`ui-runs-list-model.test.mjs`):**
  - #947 fixture → the Needs-you section has 1 row (the group); member 3 has `rounds.length === 7`, and its
    `roundsLine` starts `Round 8 · merge dev in · pushed`.
  - A top-level origin plus 2 rounds → 1 row.
  - A live round → the head's state is `working`, the line is `Running · Round 9 · merge dev in`, and it is in Running,
    not Needs you.
  - A paused round → the head is Needs you.
  - An orphan → the newest round heads, titled `… · Round 8`.
  - An archived origin → its rounds are not listed in the active view.
  - Show = Archived → they fold under it.
  - Person and label filters apply to the head only.
  - `counts.needs` matches the section.

### Task 5: draw the stack (D6, D7, D9)

- `ui/public/runs-list.mjs` `renderItem`: when `r.rounds && r.rounds.length`:
  - The sub-line is `r.roundsLine` (D6), or the model line followed by a second `runs-rounds-line` when the head
    needs you for its own reason.
  - Add a `button.runs-rounds-toggle` (`▸ k rounds` / `▾ k rounds`, `aria-expanded`, `data-rounds-key="rounds:<id>"`)
    at the line's end.
  - When open, add a `div.runs-rounds[role=list]` of `a.runs-round` links: `R<n>`, the request and outcome, and the time
    (`rowTime`). It shows the newest 5, then a `button.runs-rounds-more` with `+n earlier` (D9).
  - The same applies at the `member` level, inside a group.
  - The open state comes from a new option `roundsOpen: Set` passed through `renderRunsList`.
- `ui/public/app.js`:
  - `runsRowSig` adds `r.roundsLine`, the round count, the open state, and each round's `[n, status, outcome.sha]`, so
    a new round repaints the row.
  - Add a click handler for `.runs-rounds-toggle` and `.runs-rounds-more` that flips `runsUi.groupsToggled` or a
    `runsUi.roundsAll` set, then `paintRunsList()`.
  - `runsFocusTarget` gains a `rounds` key, so focus returns to the toggle after the repaint.
- `ui/public/style.css`: `.runs-rounds` is indented to the title's left edge with a 1px `--border` left rule;
  `.runs-round` uses 12px secondary text with a primary hover; the toggle is an accent text button. Tokens only.
- **Tests:**
  - `test/ui-runs-list-rounds-dom.test.mjs` (jsdom): a closed toggle and no list; open shows 5 lines plus `+2 earlier`;
    clicking more shows 7; links point at the round's href; `aria-expanded` follows the state; a member-level stack
    renders inside `.runs-members`.

### Task 6: check it in the app, and update the docs

- Run the app (the `run` skill, or the CDP check in `test/verify-runs-list-cdp.test.mjs` extended with the fixture).
  Screenshot the three mock states: the #947 data in mock mode, a live round, and an opened stack. Check the badge,
  Activity and the Needs-you count all read 1.
- `docs/`: in the page that documents the Runs list (find it via `grep -l "Needs you" docs/*.md`), add a short
  "Rounds" paragraph covering stacking, the expander, and one Needs-you item per PR.
- In `plans/pr-fix-rounds-stacking-design.md` §3 A4, replace the archive cascade with D4.

## Review focus

1. **The #947 fixture end to end:** badge 1, one Needs-you row (the group), member 3 with `R8 … ▸ 7 rounds`, nothing
   from those 7 runs elsewhere in the list (Tasks 3 and 4).
2. **A live fix round:** the group is in Running, the member's dot pulses, the chip reads `Fixing`, there's no Needs
   you, and the badge is 0 for that PR (Task 4, D5).
3. **Nothing disappears:** an orphan round lists (D3), and a paused or questioning round still raises Needs you
   (D5, D8).
4. **Archived origin:** its rounds are gone from the active list, with nothing written to the DB (D4).
5. **Repaint:** a new round arriving over the WebSocket updates the stack line without a full reload, and focus
   survives toggling (Task 5).
