# Stillhet findings ledger

What a slice found and did not fix, so nothing is lost between slices. Each slice adds its accepted minors, deferred items, `wired (partial)` rows and the controller's walk gaps here, in its PR. The final check run at the end of each feature works through every open row: check, fix, close (with the fidelity audit and the real test outside mock mode). The rule is in `plans/rail/implementation-prompt.md` › Acceptance for every slice.

**In a slice, fix only what blocks it:** majors, safety (an action without its confirm), fake success or demo data in the live kind, anything broken. Everything else is a row here, and the gate is accepted.

Columns: **From** (the slice and where it was found), **Area**, **Finding** (one line), **Where** (route or file), **Severity** (minor, deferred, partial, follow-up), **Status** (open, fixed in #PR).

## Open

| From | Area | Finding | Where | Severity | Status |
|---|---|---|---|---|---|
| slice 3 | Profile | The usage rings per harness are `wired (partial)`: dev reports no per-harness usage; build the source (requirement 5) | `stillhet-wiring.md` › profile | partial | open |
| slice 3 | Bell | The Needs you rows are `wired (partial)`; build what is missing (requirement 5) | `stillhet-wiring.md` › bell | partial | open |
| slice 4 | Tests | jsdom host windows are never freed in one process, so later tests slow down; worked around by splitting files (#1233, #1236). Find what retains the windows, then merge the splits back (related: #919, `ui/public/app.js` still unsplit) | `test/helpers/stillhet-host.mjs` | follow-up | open |
| slice 4 | Repo size | `out/stillhet-compare/` is tracked (one pair of each kind, per `docs/rail/gate.md`), about 18 MB per slice; decide before the dev merge whether dev should carry it | `out/stillhet-compare/` | follow-up | open |
| slice 5 r10 | Tasks | Open the needy round from its lit origin row | `live/live-map.mjs` | minor | open |
| slice 5 r10 | Tasks | Drop the task-live page cache for removed run ids too | `live/live-adapter.mjs` | minor | open |
| slice 5 r10 | Chat | Keep `{base}` out of live chat confirms when the card has no base | `chat/conversation.js` | minor | open |
| slice 5 r10 | Tasks | A failed live stacked Create PRs may draw the demo's `#959` PR (fake data in the live kind: check first at the final check) | `runs/run-page.js` | minor | open |
| slice 5 r10 | Tasks | Archive toast counts done rows; ask before archiving a resumable run (disputed) | `runs/runs-list.js` | minor | open |
| slice 5 r10 | Tasks | Delete's confirm says what it removes (disputed) | `runs/runs-list.js` | minor | open |
| slice 5 r10 | Tasks | Handle `does: 'pr'` on the demo center card | `centers/centers.js` | minor | open |
| slice 5 r10 | Engine | Include the team pipeline cap in `state.capUsd` (disputed) | `src/core/artifacts.mjs` | minor | open |
| slice 5 r10 | Security | Audit a run cost cap set at `POST /api/run` | `ui/server.mjs` | minor | open |
| slice 5 r10 | Security | Restart Build may build an unapproved plan with `humanInLoop: false` | `ui/routes/runs/control.mjs` | minor | open |
| slice 5 r10 | Security | The merge route ignores the review verdict and draft state | `ui/routes/history/pull-requests.mjs` | minor | open |
| slice 5 web UI | Tasks | Show the cap refusal on one line and clear it on the next try | task page | minor | open |
| slice 5 web UI | Tasks | Bulk Label ignores dev's `runLabels` flag | Tasks bar | minor | open |
| slice 5 web UI | Tests | The seed's stub `gh` does not remember a merge | `tools/stillhet-seed-tasks.mjs` | minor | open |
| slice 5 web UI | Tasks | Every live task page logs 404s in the console | `#run/ID` | minor | open |
| slice 5 web UI | Shell | The account menu stays open on navigation | profile menu | minor | open |
| slice 5 web UI | Tasks | Double full stop in refusal lines | refusals | minor | open |
| slice 5 web UI | Tasks | Simple level: the checklist expects a + with only Ask in chat; the design rule draws none (a person decides) | Tasks bar | minor | open |
| slice 5 web UI | Tasks | The center card's second action is clipped at 360 px | Tasks center | minor | open |
| slice 5 web UI | Tasks | The group page head has no state word and lists members as "Task 1 / Task 2" | `#group/ID` | minor | open |
| slice 5 web UI | Tasks | "What broke" shows on a passing PR | task page | minor | open |
| controller | Worca | The feature page's plan card shows the first draft's text and "v1" after a re-plan to v4 | `#feature/ID` | follow-up | open |
| controller | Worca | The feature page has no Start now for a held run (start it via `POST /api/shape/features/:id/start`) | `#feature/ID` | follow-up | open |
| owner | Shell | The top-bar Stillhet switch becomes a 20px icon beside Ask worca and Pulse, design loop first (planned before the end of feature 3) | top bar | deferred | open |

## Closed

| From | Area | Finding | Closed by |
|---|---|---|---|
