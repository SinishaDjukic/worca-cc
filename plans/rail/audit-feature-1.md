# Stillhet feature 1: fidelity audit (slices 1–5)

The audit `plans/rail/implementation-prompt.md` asks for at the end of a feature. Every area was scored against the
prototype side by side: same route, Expert, dark 1280, light 1280, light 360.

**How it was walked.**
- **Data.** The app ran on real seeded records: `tools/stillhet-seed-tasks.mjs`, `tools/stillhet-seed-chat-cards.mjs`
  and one user group made through `POST /api/run-groups`. The prototype ran on its demo data.
- **First score.** The same walk on a copy of the base `fc2285049`.
- **Re-score.** The walk on this branch.
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
| dark 1280 | 8 | 8 | `out/stillhet-audit/feature-1/pulse-dark-1280.png` |
| light 1280 | 8 | 8 | `out/stillhet-audit/feature-1/pulse-light-1280.png` |
| light 360 | 8 | 8 | `out/stillhet-audit/feature-1/pulse-light-360.png` |

Reasons: The popover on Updates matches the prototype. Its place and width, tabs and counts, filter sentence, group
heads, row grid and both themes are right, and the 360 layout holds. The one gap is a live row's detail line, which
is dev's raw failure text.
Open row: Audit gap (Pulse and bell rows)

| Prototype | App | Outcome |
|---|---|---|
| One short detail line naming the step ("web-app · Build · 3 tests failed") | Each failing test inline, 3–4 lines; a raw `$0.80 >= $0.50` | Open row |

## Area: Bell

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 7 | 7 | `out/stillhet-audit/feature-1/bell-dark-1280.png` |
| light 1280 | 7 | 7 | `out/stillhet-audit/feature-1/bell-light-1280.png` |
| light 360 | 7 | 7 | `out/stillhet-audit/feature-1/bell-light-360.png` |

Reasons: The popover frame, tabs, rows and icons match. Two gaps remain:
- The Needs you head shows only its count; the prototype adds the breakdown.
- The rows carry the same raw detail lines as Pulse (Open row "Audit gap (Pulse and bell rows)").

This PR adds the workspace questions to the bell. None were seeded, so the cell does not show them;
`test/stillhet-live-counts-1.test.mjs` and `test/stillhet-live-counts-3.test.mjs` pin them.
Open row: Audit gap (bell head)

| Prototype | App | Outcome |
|---|---|---|
| "Needs you 10 · 4 tasks, 1 missed schedule, 3 projects, 2 questions" | "Needs you 4" | Open row |
| Short detail lines | Raw failure text, 3–4 lines | Open row (Pulse and bell rows) |

## Area: Profile menu

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 8 | 8 | `out/stillhet-audit/feature-1/profile-dark-1280.png` |
| light 1280 | 8 | 8 | `out/stillhet-audit/feature-1/profile-light-1280.png` |
| light 360 | 8 | 8 | `out/stillhet-audit/feature-1/profile-light-360.png` |

Reasons: The menu's items, order, toggles and dividers match, and at 360 it opens inside the drawer. With no usage
reading, the Usage and costs row falls back to the Pulse glyph and a dollar figure, where the prototype draws its
ring glyph. The real rings (D7, D8) are pinned by `test/usage-limits.test.mjs` and `test/stillhet-live-map.test.mjs`.
Open row: Audit gap (profile usage row)

| Prototype | App | Outcome |
|---|---|---|
| A ring glyph and "71%" on Usage and costs | The Pulse glyph and "$0.80" (no reading) | Open row |
| "away at 22:00" under Away | No hint (no away schedule set) | Data, not a gap |

## Area: Chat

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 8 | 8 | `out/stillhet-audit/feature-1/chat-dark-1280.png` |
| light 1280 | 7 | 7 | `out/stillhet-audit/feature-1/chat-light-1280.png` |
| light 360 | 9 | 9 | `out/stillhet-audit/feature-1/chat-light-360.png` |

Reasons: Chat home has the prototype's structure, with clean wrapping at 360. The gaps are in how the live cards are
drawn:
- A card that needs you is not tinted, and a failed card's Retry is not the main button (c17).
- Branch names are in monospace.
- A run's question shows twice, and Approve and build shows on both the TaskCard and the PlanCard.
- A finished task with a PR shows a raw URL line, not Ready to merge with its checks and Merge PR (c18).

The light 1280 cell includes the conversations. This PR's `{base}` fix shows only inside a confirm, which no cell
opens; `test/stillhet-chat-app-host-1.test.mjs` pins it.
Open row: Audit gap (chat cards)

| Prototype | App | Outcome |
|---|---|---|
| A needs-you card tinted (c1 amber, c17 red) | No tint | Open row |
| Retry as the main button (c17) | An outline Retry | Open row |
| Branch line in the text face | Monospace | Open row |
| The question only in the OptionList | Also the TaskCard's status line | Open row |
| One Approve and build | On the TaskCard and the PlanCard | Open row |
| Ready to merge, its checks and Merge PR (c18) | "The pull request is open." and a raw URL | Open row |

**Coverage: every dev chat card** (`plans/rail/stillhet-wiring.md`, "Every dev chat card"). 13 kinds have no live
record in the seed and were judged on the demo only. That gap is its own Open row, "Audit gap (chat seed coverage)".

| Dev card | Live pair | Note |
|---|---|---|
| question | `cov-chat-question` | OptionList, Answer, Use Worca's picks |
| progress (the run card) | `cov-chat-question`, `cov-chat-plan`, `cov-chat-failed`, `cov-chat-pr` | The question, needs-you, failed and finished states; a running state is not seeded |
| the run's own questions | `cov-chat-question` | Two OptionLists under the TaskCard |
| the Shaper plan (plan approval) | `cov-chat-plan` | PlanCard: Reviewed by, Approve and build, Ask for changes, Read the plan |
| run proposal (no type) | no live record | Demo only (TaskProposal) |
| workflow, workflow-build | no live record | Demo only |
| run-stop | no live record | Demo only |
| pull-request | `cov-chat-pr` (done state only) | The pending Create PR row is not seeded |
| ship | no live record | Demo only |
| changes | no live record | Demo only |
| route | no live record | Demo only |
| scope-switch, model, schedule, away, proxy, web, clone, project, workspace, actions, metrics, policy | `cov-chat-change` (model only) | The other 11 kinds have no live record |
| receipt | no live record | Demo only |
| script-approval | no live record | Demo only |
| command, command group | no live record | Demo only (c2) |
| files | no live record | Demo only |
| notice, divider | `cov-chat-pr` (notice) | No divider is seeded |
| a failed reply | `cov-chat-failed` | Details, Try again |
| an unknown card type | no live record | Demo only |

## Area: Tasks

| Cell | First score | Re-score | Screenshot |
|---|---|---|---|
| dark 1280 | 7 | 8 | `out/stillhet-audit/feature-1/tasks-dark-1280.png` |
| light 1280 | 6 | 6 | `out/stillhet-audit/feature-1/tasks-light-1280.png` |
| light 360 | 4 | 8 | `out/stillhet-audit/feature-1/tasks-light-360.png` |

Reasons: The center card's actions now stay inside the card. On the base the second button ran past the column at
1280 and off the screen at 360. The card frame, head and filters match. The light 1280 cell includes the task pages,
which still lose design detail:
- the plan page's step marks;
- the stopped page's subtitle and earlier stages;
- the plain failure box;
- the checks sub-lines;
- the capped page's repeated Plan.

The approved page no longer shows a "What broke" box, and the group head shows a state word and its member titles.
Open row: Audit gap (task pages)

**The 360 wrap (R-qa-6).** In the live light 360 cell, the failed card holds two actions. "Retry Update Node to 24"
is the primary; "Open CSV export for billing" wraps under it, about 228 px of the card's 344 px, with nothing
clipped. On the base the second button ran off the screen.

| Prototype | App | Outcome |
|---|---|---|
| Needs approval, with a pencil, for a plan waiting for you | Needs you, with a ? | Open row |
| The plan stage open and waiting, its findings listed | The Plan stage marked done | Open row |
| Stopped by you, the branch and changes stay, all stages | No subtitle, from PR on | Open row |
| A bold failure head and rows per failure | Monospace lines; the head repeats it | Open row |
| Create PR and Checks sub-lines | None | Open row |
| Paused at its cap under the step | Plan repeated, no cap line | Open row |
| Two actions side by side, clipped at 360 (base) | Wrapped inside the card | Fixed in this PR |

**Coverage: every task state** (light 1280, `cov-task-*` in the pipeline's screenshots).

| State | Live pair | Prototype | Verdict |
|---|---|---|---|
| failed | `cov-task-failed` | `route-run-failed` | Unchanged; failure box and step marks differ |
| capped | `cov-task-capped` | `deep/route-run-capped` | Unchanged; Plan repeated, no cap line |
| plan | `cov-task-plan` | `deep/route-run-plan` | Unchanged; step marks, subtitle |
| stopped | `cov-task-stopped` | `deep/route-run-stopped` | Unchanged; subtitle and stages |
| approved | `cov-task-approved` | `route-run-approved` | Improved: no false failure box; #42 |
| failing | `cov-task-failing` | `deep/route-run-failing` | Unchanged; no sub-lines |
| group page | `cov-task-group` | `deep/route-run-group-shipped` | Improved: a state word and member titles |
| c17 (failed, in chat) | `cov-chat-failed` | `route-chat-c17` | Tint, main Retry and failure lines missing (Chat Open row) |
| c18 (ready to merge, in chat) | none: the seed has no ready-to-merge chat card | `route-chat-c18` | Gap; Chat Open rows |

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
