# Stillhet feature 1: fidelity audit (slices 1–5)

The audit `plans/rail/implementation-prompt.md` asks for at the end of a feature. Every area was scored against the
prototype side by side: same route, Expert, dark 1280, light 1280, light 360.

**How it was walked.**
- **Data.** The app ran on real seeded records: `tools/stillhet-seed-tasks.mjs`, `tools/stillhet-seed-chat-cards.mjs`
  and one user group made through `POST /api/run-groups`. The prototype ran on its demo data.
- **First score.** The same walk on a copy of the base `fc2285049`.
- **Re-score.** The walk on this branch. The fix pass (feature 1 audit fix pass) re-walked every cell once more, in
  Expert, on a sandbox seeded by both seed tools (chat first, tasks last). The Re-score column is that walk. Its
  evidence is the walk log `audit-fix/rescore-walk.log` in the pipeline's screenshots folder: one line per cell with
  the area, the cell, the score, the app PNG and the prototype PNG, and a side-by-side pair for each.
- **Scale.** 10 means the design is indistinguishable, 9 means only trivial differences remain, and below 9 means a
  real visible gap. Different records (names, counts, rows) are not gaps.
- **Screenshots.** The re-score shots are in `out/stillhet-audit/feature-1/`. The first-score, prototype and coverage
  shots are in the pipeline's screenshots folder (`audit-first/`, `audit-after/`).
- **Below 9.** The gaps are too big for this PR. Each has a named Open row in `plans/rail/findings.md` (owner:
  owner decision), and the area keeps its score.

**Checks on this branch.**
- **Pixel compare.** `npm run stillhet:compare`: 828 cells, 0 failing.
- **Flag-off style diff.** `npm run stillhet:style-diff -- --dev fc2285049` reports 69 differences, all on
  `#settings/experimental`. They are the accepted Stillhet Labs row and the size of its 3 containers in 3 cells. The
  tool removes that row from this tree's page only, and `fc2285049` draws it too. Nothing else differs.
- **Fake data.** No demo id, demo PR number (`#959`, `#960`) or "Would…" stand-in shows in the live app. The seeded
  PRs read #42 and #43.
- **Console.** The base logs a telemetry 404 on every task page; this branch logs none.
  - A paused task's saved-diff read 404'd on this branch. It is fixed in this PR: a live or paused round reads its
    live patch.
  - The 404s that remain are the seed's saved rows (`5eed…`), which have no run folder. The base reads them the same
    way.
- **D9 (Codex `rate_limits`).** No Codex rollout exists on the audit machine, so it could not be checked. Codex keeps
  no ring, as the plan says.

## Area: Shell bar and top bar

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 9 | 9 | `out/stillhet-audit/feature-1/shell-dark-1280.png` |
| light 1280 | 9 | 9 | `out/stillhet-audit/feature-1/shell-light-1280.png` |
| light 360 | 9 | 9 | `out/stillhet-audit/feature-1/shell-light-360.png` |

Reasons: The bar, its sections and tree, the top bar, the composer and its actions match the prototype in both themes
and at 360. What differs is the data: no live task means no trail chip, and no usage reading means no ring on the
avatar.

| Prototype | App | Outcome |
|---|---|---|
| A trail chip for the live task in the top bar | No chip (no live task in the cell) | Data, not a gap |
| A usage ring around the avatar | A plain avatar (no reading recorded) | Correct per D8 |

## Area: Pulse

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 8 | 9 | `out/stillhet-audit/feature-1/pulse-dark-1280.png` |
| light 1280 | 8 | 9 | `out/stillhet-audit/feature-1/pulse-light-1280.png` |
| light 360 | 8 | 9 | `out/stillhet-audit/feature-1/pulse-light-360.png` |

Reasons: The popover on Updates matches the prototype: its place and width, tabs and counts, filter sentence, group heads,
row grid, both themes and the 360 layout. Each live row's detail is now one short line after the project, from one rule
(`live-map.mjs` `shortDetail`): "billing · Build · 3 tests failed", a capped run "Cost cap reached · paused at $0.50", a
missed start "Worca was not running at 21:58". No line carries a newline, a `✗` or a `>=` comparison. What differs is the
data: other titles, projects and times.

| Prototype | App | Outcome |
|---|---|---|
| One short detail line naming the step ("web-app · Build · 3 tests failed") | "billing · Build · 3 tests failed" | Fixed in this PR |
| "Cost cap reached", "paused at $5.00" | "Cost cap reached · Big refactor", "billing · paused at $0.50" | Fixed in this PR |
| "Worca was not running at 03:00" | "Worca was not running at 21:58" (was dev's raw timestamp) | Fixed in this PR |

## Area: Bell

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 7 | 9 | `out/stillhet-audit/feature-1/bell-dark-1280.png` |
| light 1280 | 7 | 9 | `out/stillhet-audit/feature-1/bell-light-1280.png` |
| light 360 | 7 | 9 | `out/stillhet-audit/feature-1/bell-light-360.png` |

Reasons: The popover frame, tabs, rows and icons match. The Needs you head now reads the count and its breakdown, as the
prototype's does: "12 · 9 tasks, 1 missed schedule, 1 project, 1 question" on the walk (both seeds together; the tasks seed
alone gives "7 · 4 tasks, 1 missed schedule, 1 project, 1 question", pinned by `test/stillhet-live-counts-1.test.mjs` and
`test/stillhet-seed-tasks.test.mjs`). Its rows carry Pulse's short lines; a plan run says "Waits for your OK on the plan",
a failing PR "1 check failing", and a long question is clipped to one line. The seeded missed schedule, the "Moved folder"
project and the unsure workspace link each have their row.

| Prototype | App | Outcome |
|---|---|---|
| "Needs you 10 · 4 tasks, 1 missed schedule, 3 projects, 2 questions" | "Needs you 12 · 9 tasks, 1 missed schedule, 1 project, 1 question" | Fixed in this PR (counts are data) |
| Short detail lines | Short detail lines | Fixed in this PR |
| A row per project that needs you and per workspace question | "Moved folder · Folder missing"; one workspace question | Fixed in this PR (seeded) |

## Area: Profile menu

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 8 | 9 | `out/stillhet-audit/feature-1/profile-dark-1280.png` |
| light 1280 | 8 | 9 | `out/stillhet-audit/feature-1/profile-light-1280.png` |
| light 360 | 8 | 9 | `out/stillhet-audit/feature-1/profile-light-360.png` |

Reasons: The menu's items, order, toggles and dividers match, and at 360 it opens inside the drawer. With no usage reading,
the Usage and costs row now wears the ring glyph as an empty track (`small.usage-rings`), its value the dollar spend. The
prototype's ring is filled and reads "71%" because its demo has a reading: data.

| Prototype | App | Outcome |
|---|---|---|
| A ring glyph and "71%" on Usage and costs | The ring glyph, an empty track, and "$0.80" (no reading) | Fixed in this PR (the figure is data) |
| "away at 22:00" under Away | No hint (no away schedule set) | Data, not a gap |

## Area: Chat

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 8 | 9 | `out/stillhet-audit/feature-1/chat-dark-1280.png` |
| light 1280 | 7 | 9 | `out/stillhet-audit/feature-1/chat-light-1280.png` |
| light 360 | 9 | 9 | `out/stillhet-audit/feature-1/chat-light-360.png` |

Reasons: Chat home has the prototype's structure, with clean wrapping at 360, and the live cards are now drawn as the
prototype draws them. The three cells walk c17 (failed), c1 (a question) and c18 (ready to merge):
- A card that needs you breathes with its tone (`data-attn` fail for c17, ask for c1); a failed card's Retry is its one
  filled button.
- Branch names are in the text face. This is a design change (D5): `rail.css:30` drew `.rc-mid` in `--mono`, and
  `docs/rail/look.md` now says a branch on a card is in the text face, for the demo and the app alike.
- A run's question shows once, in its OptionList; Approve and build once, on the PlanCard.
- A finished task whose PR is approved, passing and mergeable reads Ready to merge, its checks and Merge PR (c18); the PR
  card itself is no turn of its own.
What differs is the data: the seeded failed run has no failing tests to list, and other names and counts.

| Prototype | App | Outcome |
|---|---|---|
| A needs-you card tinted (c1 amber, c17 red) | Tinted with its tone | Fixed in this PR |
| Retry as the main button (c17) | Retry filled | Fixed in this PR |
| Branch line in the text face | Text face (the design changed: D5) | Fixed in this PR |
| The question only in the OptionList | Only in the OptionList | Fixed in this PR |
| One Approve and build | On the PlanCard only | Fixed in this PR |
| Ready to merge, its checks and Merge PR (c18) | Ready to merge, "All 3 checks pass", "Approved by maya", Merge PR | Fixed in this PR |

**Coverage: every dev chat card** (`plans/rail/stillhet-wiring.md`, "Every dev chat card"). Every kind now has a live
record (`tools/stillhet-seed-chat-cards.mjs`, 27 new `SEEDED_CARDS` keys), walked at light 1280 against its prototype pair
(`audit-fix/cov-chat-*-app.png` beside `audit-fix/proto-chat-*.png` in the pipeline's screenshots folder).

| Dev card | Live pair | Note |
|---|---|---|
| question | `cov-chat-question` | OptionList, Answer, Use Worca's picks; the question only there |
| progress (the run card) | `cov-chat-question`, `cov-chat-plan`, `cov-chat-failed`, `cov-chat-pr`, `cov-chat-prs` | Question, needs approval, failed, finished and Ready to merge (c18); a running state is not seeded |
| the run's own questions | `cov-chat-question` | Two OptionLists under the TaskCard |
| the Shaper plan (plan approval) | `cov-chat-plan` | PlanCard with the one Approve and build |
| run proposal (no type) | `cov-chat-flows` (`proposal`) | From a real mock turn; TaskProposal, Start, Not now |
| workflow, workflow-build | `cov-chat-flows` (`workflow`, `workflow-build`) | ChangeProposal with its Steps row (c9 w9) |
| run-stop | `cov-chat-actions` (`run-stop`) | Stop run, Keep running (c9 a6) |
| pull-request | `cov-chat-prs` (`pr-pending`, `ready`) | Create PR row; an opened PR shows on its TaskCard alone |
| ship | `cov-chat-actions` (`ship`) | Its agreed requirements, Ships as one PR, Create PR (c6 a6) |
| changes | `cov-chat-actions` (`changes`) | Start the follow-up, Not now (c6 a5) |
| route | `cov-chat-actions` (`route`) | Worca's guess first, the other two, Not now; no prototype pair |
| scope-switch, model, schedule, away, proxy, web, clone, project, workspace, actions, metrics, policy | `cov-chat-changes`, `cov-chat-change` (model) | One ChangeProposal each, every one with its rows (c11 a2, c7 a4, c12 a2, c9 p9, c7 a2, c21 a2, c0 g2, c21 a3) |
| receipt | `cov-chat-actions` (`receipt`) | Applied, Revert (c9 a4) |
| script-approval | `cov-chat-actions` (`script-approval`) | Run it, Not now (c10 a3) |
| command, command group | `cov-chat-commands` (`command`, `commands`) | A finished command folds with no Stop (c3); two in one answer are one group (c2 a2) |
| files | `cov-chat-commands` (`files`) | A real attachment: View, download (c2) |
| notice, divider | `cov-chat-divider` (`divider`), `cov-chat-actions` (`unknown`) | The divider from answering a scope switch (c11) |
| a failed reply | `cov-chat-failed` | Details, Try again |
| an unknown card type | `cov-chat-actions` (`unknown`) | A notice from its own title; no prototype pair |

The walk of the new kinds found two gaps that do not hold Chat below 9; each is a new Open row of
`plans/rail/findings.md`, owner decision: a metrics or policy proposal shows dev's raw kind word ("enable") as its row, and
an answered scope switch lists its project's full path. Route, actions, metrics, policy and the unknown type have no
prototype pair, so they are logged, not designed.

## Area: Tasks

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 7 | 9 | `out/stillhet-audit/feature-1/tasks-dark-1280.png` |
| light 1280 | 6 | 9 | `out/stillhet-audit/feature-1/tasks-light-1280.png` |
| light 360 | 4 | 9 | `out/stillhet-audit/feature-1/tasks-light-360.png` |

Reasons: The center card's actions stay inside the card, and the card frame, head and filters match. The task pages now
keep the design's detail, from dev's own data:
- A plan waiting for your approval reads Needs approval with the pencil, and its Plan stage opens on the step that waits,
  "Waiting for your approval", with the run's own findings under it (its shape check and role reviews; none without a
  review). This is a design change (D1): the prototype had Needs approval and the pencil on `gate` only; the library's
  `plan` state now has them too.
- A stopped task reads "Stopped by you · the branch and changes stay" and keeps every stage it ran.
- A failure is a bold head and one row per failure; the page head does not repeat it, and the step that broke wears the
  failed look.
- Create PR reads "Opened #43" and Checks "1 failed" or "3 of 3 passed"; a capped task's paused step reads "Paused at its cap".
What differs is the data: dev has no check names and no PR open date, so the lines read counts.

**The 360 wrap (R-qa-6).** In the live light 360 cell, a card with two actions wraps the second under the first inside
the card, with nothing clipped.

| Prototype | App | Outcome |
|---|---|---|
| Needs approval, with a pencil, for a plan waiting for you | Needs approval, the pencil | Fixed in this PR (design first: D1) |
| The plan stage open and waiting, its findings listed | Opens on "Waiting for your approval", the run's findings | Fixed in this PR |
| Stopped by you, the branch and changes stay, all stages | The same | Fixed in this PR |
| A bold failure head and rows per failure | The same; the head omits it | Fixed in this PR |
| Create PR and Checks sub-lines | "Opened #N", "N failed" / "N of M passed" | Fixed in this PR |
| Paused at its cap under the step | "Paused at its cap" | Fixed in this PR |
| Two actions side by side, clipped at 360 (base) | Wrapped inside the card | Fixed earlier |

**Coverage: every task state** (light 1280; the fix pass's shots are in the pipeline's screenshots folder, `audit-fix/`: the three cells and `cov-task-capped`, `cov-task-failing`, `cov-task-approved`; the group page's is the first audit's).

| State | Live pair | Prototype | Verdict |
|---|---|---|---|
| failed | `tasks-dark-1280-app` | `route-run-failed` | Bold head, a row per failure, the step that broke |
| capped | `cov-task-capped` | `deep/route-run-capped` | Paused at its cap under the step |
| plan | `tasks-light-1280-app` | `deep/route-run-plan` | Needs approval, the pencil, the waiting step and the run's own findings |
| stopped | `tasks-light-360-app` | `deep/route-run-stopped` | The subtitle and every stage |
| approved | `cov-task-approved` | `route-run-approved` | No false failure box; Opened #42, 3 of 3 passed |
| failing | `cov-task-failing` | `deep/route-run-failing` | Opened #43, 1 failed |
| group page | `cov-task-group` | `deep/route-run-group-shipped` | Improved: a state word and member titles |
| c17 (failed, in chat) | `chat-dark-1280-app` | `route-chat-c17` | Tint and main Retry |
| c18 (ready to merge, in chat) | `chat-light-360-app` | `route-chat-c18` | Ready to merge, its checks, Merge PR |

## Area: Settings › Labs and opt-out

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 9 | 9 | `out/stillhet-audit/feature-1/labs-dark-1280.png` |
| light 1280 | 9 | 9 | `out/stillhet-audit/feature-1/labs-light-1280.png` |
| light 360 | 9 | 9 | `out/stillhet-audit/feature-1/labs-light-360.png` |

Reasons: Labs matches the prototype row for row in both themes and at 360. The only difference is the top bar's live
task pill, which is data. With Stillhet on, the way out is the top-bar Stillhet switch, and the way in is dev's Labs
`rail` row (`plans/rail/implementation-prompt.md`, "Opt-in and opt-out"). The flag-off style diff keeps that row as
the one accepted difference.

| Prototype | App | Outcome |
|---|---|---|
| The live-task pill in the top bar | None (no live task) | Data, not a gap |
