# Stillhet findings ledger

What a slice found and did not fix, so nothing is lost between slices. Each slice adds its accepted minors, deferred items, `wired (partial)` rows and the controller's walk gaps here, in its PR. The final check run at the end of each feature works through every open row: check, fix, close (with the fidelity audit and the real test outside mock mode). The rule is in `plans/rail/implementation-prompt.md` › Acceptance for every slice.

**In a slice, fix only what blocks it:** majors, safety (an action without its confirm), fake success or demo data in the live kind, anything broken. Everything else is a row here, and the gate is accepted.

Columns: **From** (the slice and where it was found), **Area**, **Finding** (one line), **Where** (route or file), **Severity** (minor, deferred, partial, follow-up), **Status**.

**Row shape** (`test/stillhet-findings-ledger.test.mjs` holds it): an Open row's Status reads `open (owner: X)`, X one of `feature 3`, `Projects slice`, `final cleanup PR`, `owner decision`, `dev PR (owner to open the issue)`. A Closed row's **Closed by** names a PR (`#N` or `this PR`) or starts `reason:`; a row closed on a judgement the owner should see says `(owner to confirm)`.

## Open

| From | Area | Finding | Where | Severity | Status |
|---|---|---|---|---|---|
| slice 4 | Tests | jsdom host windows: every `stillhetHost(` call now passes `after` and closes its window (checked at the feature 1 final check); merging the split host test files back stays for the cleanup PR (related: #919, `ui/public/app.js` still unsplit) | `test/helpers/stillhet-host.mjs` | follow-up | open (owner: final cleanup PR) |
| slice 4 | Repo size | `out/stillhet-compare/` is tracked (one pair of each kind, per `docs/rail/gate.md`), about 18 MB per slice; decide before the dev merge whether dev should carry it, and the feature 1 audit PNGs (`out/stillhet-audit/feature-1/`) with it | `out/stillhet-compare/` | follow-up | open (owner: owner decision) |
| controller | Worca | The feature page's plan card shows the first draft's text and "v1" after a re-plan to v4 (dev's flag-off page; Stillhet's group page re-checked at the final check) | `#feature/ID` | follow-up | open (owner: dev PR (owner to open the issue)) |
| controller | Worca | The feature page has no Start now for a held run (start it via `POST /api/shape/features/:id/start`) (dev's flag-off page) | `#feature/ID` | follow-up | open (owner: dev PR (owner to open the issue)) |
| owner | Shell | The top-bar Stillhet switch becomes a 20px icon beside Ask worca and Pulse, design loop first (planned before the end of feature 3) | top bar | deferred | open (owner: feature 3) |
| feature 1 final check | Projects | The live workspace page draws dev's map and its questions only; Delete, Edit by hand, Scan again, Sync what is behind and Start a task across all are not drawn until they are wired | `workspaces/workspaces.js` | deferred | open (owner: Projects slice) |
| feature 1 audit fix pass | Chat | A live metrics or policy ChangeProposal shows dev's raw kind word as its row ("Change: enable"); the prototype has no pair for these kinds, so the words need a design | `live/chat-turns.mjs` `rowsOf` | follow-up | open (owner: owner decision) |
| feature 1 audit fix pass | Chat | An answered scope-switch ChangeProposal lists its project's full path as its row; the prototype's c11 says "This chat is on worca-cc now" | `live/chat-turns.mjs` scope-switch | follow-up | open (owner: owner decision) |
| feature 1 real test | Chat | Right after the first send in a new chat, the composer's project picker reads "No project" while the chat is on its project; a reload shows it right | `#chat/ID` composer | minor | open (owner: feature 2 final check) |

## Closed

| From | Area | Finding | Closed by |
|---|---|---|---|
| feature 1 audit | Pulse | Audit gap (Pulse and bell rows): a live Updates or Needs you row's detail line is dev's raw failure text (each failing test, 3–4 lines) or a raw cost comparison (`$0.80 >= $0.50`); the prototype says one short line naming the step | this PR |
| feature 1 audit | Bell | Audit gap (bell head): the live Needs you head shows only its count; the prototype adds the breakdown (tasks, missed schedules, projects, questions) | this PR |
| feature 1 audit | Profile | Audit gap (profile usage row): with no usage reading, Usage and costs shows the Pulse glyph and a dollar figure; the prototype draws its ring glyph | this PR |
| feature 1 audit | Chat | Audit gap (chat cards): a live TaskCard that needs you is not tinted and a failed one's Retry is not the main button (c17); branch names are monospace; a run's question shows twice (status line and OptionList); Approve and build shows on both TaskCard and PlanCard; a finished task with a PR shows a raw URL line, not Ready to merge with its checks and Merge PR (c18) | this PR |
| feature 1 audit | Chat | Audit gap (chat seed coverage): 13 dev chat card kinds have no live record in `tools/stillhet-seed-chat-cards.mjs` (run proposal, workflow, run-stop, ship, changes, route, receipt, script-approval, command, files, divider, unknown, and 11 of the 12 ChangeProposal kinds), so the audit judged them on the demo only | this PR |
| feature 1 audit | Tasks | Audit gap (task pages): a plan waiting for approval reads Needs you with a ? (prototype: Needs approval, pencil) and its Plan step shows done; a stopped task drops its subtitle and earlier stages; its failure box is raw monospace lines without the bold head, and the page head repeats it; failing checks and Create PR lack their sub-lines; a capped task repeats Plan and drops Paused at its cap | this PR |
| slice 3 | Profile | The usage rings per harness were `wired (partial)`: now the harness CLI's own plan-limit readings (`GET /api/usage-limits`) | this PR |
| slice 3 | Bell | The Needs you rows were `wired (partial)`: now one row per unsure workspace link, answered with dev's edge PUT | this PR |
| slice 5 r10 | Tasks | Open the needy round from its lit origin row | this PR |
| slice 5 r10 | Tasks | Drop the task-live page cache for removed run ids too | this PR |
| slice 5 r10 | Chat | Keep `{base}` out of live chat confirms when the card has no base | this PR |
| slice 5 r10 | Tasks | A failed live stacked Create PRs may draw the demo's `#959` PR | this PR |
| slice 5 r10 | Tasks | Archive toast counts done rows; ask before archiving a resumable run | this PR |
| slice 5 r10 | Tasks | Delete's confirm says what it removes (dev's own words) | this PR |
| slice 5 r10 | Tasks | Handle `does: 'pr'` on the demo center card | this PR |
| slice 5 r10 | Engine | Include the team pipeline cap in `state.capUsd` | reason: display-only value; enforcement already applies the lower team cap (`effectiveCap`) (owner to confirm) |
| slice 5 r10 | Security | Audit a run cost cap set at `POST /api/run` | this PR |
| slice 5 r10 | Security | Restart Build may build an unapproved plan with `humanInLoop: false` | this PR |
| slice 5 r10 | Security | The merge route ignores the review verdict and draft state | this PR |
| slice 5 web UI | Tasks | Show the cap refusal on one line and clear it on the next try | this PR |
| slice 5 web UI | Tasks | Bulk Label ignores dev's `runLabels` flag | this PR |
| slice 5 web UI | Tests | The seed's stub `gh` does not remember a merge | reason: stale; `test/stillhet-seed-tasks.test.mjs` proves the stub remembers it |
| slice 5 web UI | Tasks | Every live task page logs 404s in the console (the telemetry read with `runTelemetry` off; a merged PR's checks) | this PR |
| slice 5 web UI | Shell | The account menu stays open on navigation | this PR |
| slice 5 web UI | Tasks | Double full stop in refusal lines | reason: fixed in #1241 (`failureOf`), pinned by `test/run-page-model.test.mjs` |
| slice 5 web UI | Tasks | Simple level: the checklist expects a + with only Ask in chat; the design rule draws none | reason: the design draws none in Simple (`docs/rail/navigation.md`) (owner to confirm) |
| slice 5 web UI | Tasks | The center card's second action is clipped at 360 px | this PR |
| slice 5 web UI | Tasks | The group page head has no state word and lists members as "Task 1 / Task 2" | this PR |
| slice 5 web UI | Tasks | "What broke" shows on a passing PR | this PR |
| slice 5 r12 | Design | Design first: the Tasks center card's Merge confirm and its new live actions exist only in the live kind; add them to the prototype (demo kind) and the `docs/rail` panel.center rule | this PR |
| slice 5 web UI r5 | Tasks | A Restart Build round's Changes shows an empty live diff after the round ends; re-read its saved diff | this PR |
