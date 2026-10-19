# Bundle integration: Runs redesign run 5, Shaper as chat cards, Shaper role reviews

Run branch worca-cc/bundle-integration-merge-the-runs-redesign-fe56f029, from 5fc94958.

### Merge 1 — Runs redesign run 5 (4dd77e0a)
| File | Conflict | Resolution |
|---|---|---|
| ui/public/chat/run-card.mjs | setFix (#773) vs get reasonText (§5a.2) in the returned object | both members kept, both in the `@returns` JSDoc |
| docs/changelog/unreleased.md | Run presets + Watch PR fix runs vs Runs redesign sections | all three sections kept (HEAD's two, then R5's) |

### Merge 2 — Shaper as chat cards (48fbd4f1)
| File | Conflict | Resolution |
|---|---|---|
| src/core/db.mjs | SCHEMA_VERSION 64 vs 62; INCREMENTAL_COLUMNS.pipelines tail; migrate() tail | `SCHEMA_VERSION = 66`; both column sets (release_* relabelled v65); `shape_features` v61 → v65, `slices.kind` v62 → v66; v65 comment rung and `if (current < 66)` notes table + guarded round-of index after v64 (D2) |
| test/db-migrate-v61.test.mjs | add/add | dev's (Run presets) |
| test/db-migrate-v62.test.mjs | add/add | dev's (Run presets); Shaper's two files renamed to test/db-migrate-v65.test.mjs and test/db-migrate-v66.test.mjs with their numbers changed (D3) |
| docs/shape-it-first.md | "The feature page" (redesign) vs "One card, three hosts" (Shaper) | Shaper's paragraph adapted to the group page tabs (Plans tab: log and actions, no step; group page Overview: log, actions, Ship; open step in the status card; saved notes on the chat card) |
| ui/server.mjs | ask store import line | both: `runLinkTarget` and `newAskId` |
| ui/public/ask-run-card.mjs | `pr` vs `pr` + `rounds` + `watch` | ours' `pr` (the const), plus Shaper's `rounds` and `watch` |
| ui/public/shape/questions.mjs | `.btn-primary` "Answer and draft" + Skip vs Shaper's step head + "Answer" | Shaper's; the submit is found by `[data-qpanel-submit]` |
| ui/public/shape/outline-body.mjs | header, btn helper, held/card bodies vs Shaper's one layout | Shaper's structure; `btn btn-sm` helper; both ⋯ are `btn-quiet btn-icon` + `icon(doc,'more',16)` |
| ui/public/shape/plan-body.mjs | header, btn helper, check rows, foot | Shaper's structure; `btn btn-sm` helper; ⋯ icon button |
| ui/public/shape/feature-view.mjs | the redesign's page view vs Shaper's one card | Shaper's, stripped to the replanned note, step slot (deps.mountAsk), log, Ship card, actions with `omit` (D12); `paintHead`, `refreshFeatureStatus`, runs fold and the `renderRowIcon` / `paintChainBar` / `paintFeatureMembers` imports deleted |
| ui/public/chat/run-card.mjs | 12 hunks | the unified card (§5.3): C1's head / status / members / footer / delegate, Shaper's log, notes, watch, Ask for changes, feature extras, receipts; see "One source for the run card" |
| ui/public/app.js | imports; featureMountAsk vs featurePageDeps; paintFeaturePageProgress; pr-watch-changed; run-page delegate; #feature route | Shaper's imports minus `sliceLineCopy` / `refreshFeatureStatus`; Shaper's `featureMountAsk` (dormant: no caller passes `ask`); `paintFeaturePageProgress` deleted with its `state`-case call; both pr-watch-changed bodies + `round-changed` (D15); ours' full delegate selector; ours' `mountGroupPage` route |
| ui/public/style.css | 5 hunks | ours at :8504 (Shaper's `.ask-card-not-now:disabled` skin dropped); Shaper's Ship card / release row rules with `4px` → `var(--r-sm)`, `.ask-prcard-watch*` dropped; `.chat-rc-factions` + `[hidden]` only (`.chat-rc-btn*`, `.chat-rc-stop`, hand-sized `.chat-rc-factions .btn` dropped); Shaper's feature-view rules minus head/chip/status/runs; `.feature-page-error` + `.feature-page .shape-feature` |
| test/ui-chat-action-cards.test.mjs | CSS rule pins | ours' hunk; Shaper's clean hunks kept |
| test/ui-chat-run-card.test.mjs | 4 hunks | see Tests changed |
| test/ui-question-shaping.test.mjs | 2 hunks | Shaper's, `.btn-go` → `[data-qpanel-submit]` |
| test/ui-shape-app-wiring.test.mjs | 4 hunks | see Tests changed |
| test/ui-shape-plan-body.test.mjs | 2 hunks | see Tests changed |
| test/ui-shape-questions.test.mjs | 2 hunks | Shaper's, `.btn-go` → `[data-qpanel-submit]` / `.btn-primary` |
| (hidden) renderRowIcon | removed from runs-list.mjs by the redesign; imported by feature-card, feature-view, run-card | feature-card's log check is `icon(doc,'check',12)`; the other two imports went with the deleted head code; rounds.mjs drops its `ICON_WORD` import |
| (hidden) design language | clean-merged Shaper code failed test/ui-design-language.test.mjs | ship/route/changes cards: `ask-card-start` → `btn btn-sm btn-primary`, bare `ask-card-not-now` → `btn btn-sm btn-quiet ask-card-not-now` (and chat/ask-changes.mjs); check-row marks are icons; feature-actions buttons `btn btn-sm` + ⋯ icon; `.ask-routecard-open` / `.chat-rc-watch-*` focus radius `var(--r-sm)`; quote rules prefixed `blockquote.` |
| (hidden) group page mount | C1's `mountShapeFeature(h, id, { mode: 'page' })` + `__shapeMode`, banned by Shaper's scan | the D12 mount: `{ loading: true, inGroup: true }`, repainted when the group model's actions change; `__askInCard` and `featurePageDeps` deleted |
| src/core/shape/rounds.mjs, docs/storage.md | (clean) stale labels | `idx_pipelines_round_of (v66)`; "Run groups (v64)" |
| ui/public/run-status-card.mjs, ui/public/group-page.mjs, app.js paintHdActions / paintRdActions | (clean) D8 | `UNAVAILABLE` holds only `retry`; every host passes its own `disable['ask-changes']` reason |
| tools/verify-feature-page-cdp.mjs | (clean) waited for `.shape-feature.is-page` | the feature-page block rewritten to the merged Overview (one status line, ≤1 member list, no Shaper duplicates, Re-plan + icon ⋯, menu items, full width) |

### Merge 3 — Role reviews + Project fit (68a69419)
| File | Conflict | Resolution |
|---|---|---|
| src/core/ask/proposal.mjs | imports; proposal reader bindings | both sides: `withProjectFit` + `ensureHouseBrief`, and the preset imports; `readPreset`, `presetsOn` and `hasHouseBrief` |
| src/shared/run-progress.mjs | the redesign's step/fill/sameWord vs RR's text line | the redesign's lines, `const rw = roleWhat()` and `!rw` in `oneStep` (D17); RR's `roleFact` / `roleWhat` / the `rw` branch in `workingWhat` merged cleanly above |
| test/run-progress.test.mjs | import list | ours; plus the stage-sorted walk (D27) |
| ui/public/shape/check-row.mjs | icon import, mark, RR's re-appended `buildCheckRow` | ours (icons), `buildCheckRow` dropped (D18) |
| test/ui-shape-check-row.test.mjs | import | ours; RR's duplicated block deleted by hand |
| ui/public/shape/plan-body.mjs | imports, sender, check/role/perspectives region, foot | merge 2's body; `planApproveLabel` + role-review import + `chipsHiddenFor`; the role fold after the Shape fold; chips `hidden: chipsHiddenFor(perspectives)`; approve label `planApproveLabel(plan, openBlocking(plan.roleReviews))`; RR's `plan-answer` event fired inside the submit stepSender calls |
| ui/public/chat/run-card.mjs | answerReceipt; state vars; delegate vs RR's qBody listener; painted; receipt input | RR's approve line kept, the base "Cycle gate" line dropped (D26); `planSent` with every `sent` reset (incl. the `!ownIsCurrent()` one); `plan-answer` listener just before the one delegate; `painted` gains `planAsk` / `roleReviews`; Shaper's `own` reads `planSent` too |
| test/ui-shape-app-wiring.test.mjs | imports | both |
| ui/public/style.css | token block | ours (`--r-xs`, `--r-sm`, `--r-card` / `--r-ctrl` as `var(--r-sm)`); RR's `14px` / `10px` and `--shadow` / `--shadow-soft` dropped |
| ui/public/shape/step-receipt.mjs | (clean) D16 | `stepReceipt` returns `planApprovedLine(plan.roleReviews)` when the plan has role-review rounds |
| ui/public/house-brief-view.mjs | (clean) design language | `btn-mini` → `btn-sm` |
| ui/public/style.css `.plan-check-show` | (clean) hand-sized | padding and font-size dropped |

### Schema numbering
v61–v63 Run Presets · v64 Runs redesign · v65 Shaper s4 release columns · v66 Shaper s5 notes + round-of index · role reviews: none

### One source for the run card
- Head (status dot, title, kind chip, Open ›), status line, bars, member rows: `runModel` / `groupModel` through `paintStatusDot`, `paintRunStatus`, `renderMemberRows` (`ui/public/run-status-card.mjs`). The chip is `PR fix run` for a fix card, `Shaping` for an open shaping plan (flag on), else `kindLabel(row)` (D7).
- Rounds feed the model: a live round (`liveRound`, `ui/public/chat/rounds.mjs`) is the model's input with its `round`; a stopped watch rides on `watch` (D6). The footer then targets the round's run (D25).
- Footer: `syncActions` owns Pause, Stop, Resume, Answer, Open PR, Ship it and Ask for changes; Shaper's `paintFeatureActions` adds Re-plan the rest, Cancel the rest and ⋯ only, with `omit: m.actions` (D10).
- Shaper's slots: the step log (feature or rounds), saved notes, the Watch-stopped line only when the model line does not already say it (D9), the open step (Shaper's wins over `ownIsCurrent()`, D11) through the one `delegateQuestion`, the receipt (named note, RR's approve line), the checklist score button and the Ask for changes field (focused by the footer action, D8).
- Removed duplicates: Shaper's `pill`, `kicker`, `dot`, `progBar`, `.chat-rc-fstatus`, `.chat-rc-chain`, `ol.chat-rc-members` (`paintFeatureMembers`), `paintFeature`, `PILL_FAMILY`, `Q_BUTTONS` / `.btn-go` listener, Shaper's own Pause/Stop; C1's `featureEl` / `ctx.mountFeature` strip; `featureCardModel`'s chip/icon/word/status/run/group/members (D5); `roundsModel`'s live status fields; `feature-view.mjs`'s head, status, runs fold and `refreshFeatureStatus`; app.js `paintFeaturePageProgress`, `featurePageDeps`, `__askInCard`, `{ mode: 'page' }`.

### Behaviour changes and dormant code left for the polish run
- The chat home Plans list body has no runs fold any more (D22); its row keeps its state chip and `featureHeadline`.
- Shaper's `featureMountAsk` has no caller (the group page shows the open step in its status card).
- A halted feature shows the model's disabled `retry` ("Start a new run to try again") next to Shaper's Resume (Open question 2).
- `paintFeaturePageProgress` / `refreshFeatureStatus` deleted (D12): the `state` frame repaints the group page's model block through `scheduleGroupPagePaint`.
- Saved notes show on the chat card only.
- The approve receipt from `planApprovedLine` drops "after N rounds of changes" while the stored feature log keeps `planApprovedText` (D16).
- The group page omits only the Resume (and Pause/Stop) its model offers (D10).
- A live round's footer acts on the round's run (D25).
- A feature's live round no longer words the chat card's status line ("Running · Round 2 · …"): a feature card's line is the group model's, and feeding rounds into group rows is out of scope. The round still shows in the step log.
- The disabled reason with the flag off reads "Turn on Shaper to ask for changes" (the plan's "Turn on Shape it first …" fails `test/shape-vocabulary-scan.test.mjs`; the flag's title is "Shaper").
- The CDP feature-page checks replaced: three-part segmented bar, slice 1's "merge first", "Re-plan the rest moved into ⋯", "Approve each slice's plan" unchecked, the amber halted head.
- RR's three `buildCheckRow` tests are gone with the function (deleted on Shaper's side, D18).
- Shaper's `.shape-feature-order` line repeats `.gpage-ship`'s merge order on the group page.
- R5's run-progress shipped-workflow walk is sorted by stage (D27).

### Tests changed
Every rewritten or removed assertion, per file (the plan's D20). One bullet per file; sub-bullets name the test.

- test/ui-chat-action-cards.test.mjs: conflict hunk (CSS rule pins) ours; Shaper's clean hunks kept (PR watch tooltip test, ship/changes/route registry, s5 PR card field). First pass took `--ours` for the whole file and lost them; redone with `git checkout -m`.
- test/ui-question-shaping.test.mjs: conflict hunks Shaper's with `.btn-go` → `[data-qpanel-submit]`; "every step kind … group page" tests read `.gpage-card .gpage-question .qpanel` (D12), fixture gains GET /api/run-groups (feat_1 group, member pipelineId pshape01) and the hello run gets pipelineId pshape01.
- test/ui-shape-questions.test.mjs: Shaper's, fixture button `btn btn-primary` + data-qpanel-submit; `.btn-go` selectors → `[data-qpanel-submit]` / `.btn-primary`.
- test/ui-shape-plan-body.test.mjs: action labels `textContent || aria-label` ("More for this plan"), svg assert; "one primary, no .btn-go" merges both titles.
- test/ui-shape-outline-body.test.mjs: ⋯ read as aria-label "More for these runs".
- test/ui-shape-app-wiring.test.mjs: "#feature/feat_1 fetches the feature": ours' gets, `.gpage .gpage-overview .shape-feature`, one `.gpage-card .run-status-text`, no `.shape-feature-head` (replaces `.shape-feature-seg` ×3 and `.chat-rc-member` ×4). "#feature says it is loading": `.gpage-overview .shape-feature`. "ask host survives a repaint": ours' `.gpage-question` lines and gets 3; the tail stamps `.gpage-card .run-status-text` "stale" and asserts the `state` frame repainted it (was `.shape-feature-status` rewritten by paintFeaturePageProgress). "mountShapeFeature paints the host": `.shape-feature-status` 'Waiting · Run 2' → null. "two paints in flight": witness `[data-act="feature-stop"]` (running slice gains pipelineId p2 / runId r2) instead of `.shape-feature-status`. "the Plans tab mounts the card with Runs folded…" → "the Plans tab and the group page Overview mount the same head-less view" (no `details.shape-feature-runs` on either).
- test/ui-chat-run-card.test.mjs: imports union; ASK_HTML fixtures ours (data-qpanel-submit); C1's "the feature strip mounts the feature card" test replaced by Shaper's feature tests (D23); slice 4 + s5 tests kept side by side. Rewrites to the model markup: helper `featureRow` (groupModel) passed through `controls.groupOf`.
  - "feature card: Shaping, then Feature · 1/3 …" → chip `Shaping`, then `Feature · 3 runs`, `.run-member-title` rows, one `.run-status-text`, one `ol.run-members`, no `.chat-rc-fstatus/.chat-rc-chain/ol.chat-rc-members/.ask-rc-pill` (removed: runs-list glyph head dot, `.chat-rc-chain` + 4 `.run-chain-part`).
  - "run 2's plan ask is the open step": status "Run 2 of 3 · needs you" (was `.chat-rc-fstatus` "Needs you · Run 2 · Plan"), head `.status-dot` word (was `.ask-rc-pill` amber), answer via `[data-qpanel-submit]`.
  - "controller: ctx.shaperCard feeds the card": witnesses are the step log and the open step painted from the member's run-store snapshot (was `.chat-rc-fstatus` text).
  - "halted feature": "Run 2 of 3 · failed" (was "Failed · Run 2 · Review"); buttons read `textContent || aria-label` (⋯ → "More actions"); one Resume; removed: `.chat-rc-pause` hidden, `.chat-rc-member-state`[3] "Waiting".
  - "running feature": Pause/Stop are the model's `[data-model-action]` and go through `controls.act` with the group row (was Shaper's `feature-pause`/`feature-stop` → controls.pause/stop); asserts Shaper paints neither.
  - "re-plan from the card": ⋯ read by aria-label.
  - s5 "a round 2 of the last run": the round's "Running · Round 2 · Build" status assert removed (a feature's status line is the group model's; feeding rounds into group rows is out of scope); member count via `.run-member`.
  - s5 plain-run rounds: `.run-status-text` "Running · Round 2 · working" (runModel roundLine; the fixture run has no staged progress) — was `.chat-rc-fstatus` "… · Build"; needs-you round reads "Round 2 · Needs you…" with `run-status` state needs-you (removed: `.ask-rc-pill`, `.chat-rc-dot-ic`, `.ask-rc-prog` asserts).
  - s5 Ask for changes: the feature half passes `groupOf` (field waits for the group model's ready state); asserts `run-status` state `ready` (was `.chat-rc-fstatus` /^Ready to ship/).
  - s5 controller feature round: asserts the round's log line and one status line (removed: "Needs you · Round 2 · Plan" — feature rounds no longer drive the card's status).
  - s5 watch gave up: model line "Needs you · Watch stopped · …", no `.chat-rc-watch-text` (D9), enabled `[data-model-action="ask-changes"]` focuses the field (was `.chat-rc-watch-text`, `.chat-rc-watch-pr`, `.chat-rc-watch-ask`).
  - slice 4 feature test: `.chat-rc-feature` hidden → absent (D23).
  - Added: five "merge:" tests (one status line/member list; watch said once + Ask focuses; Ask disabled with flag off; PR fix run chip; live Watch round names the round and Stop targets it, D25).
- test/ui-chat-rounds.test.mjs: live-round status/icon/word/run asserts → `liveRound`'s `{ r, m }` (live by snapshot, by row status with no snapshot, starting, terminal snapshot not live); log and watch asserts stay.
- test/ui-shape-feature-card.test.mjs: chip/icon/status/group/members/run asserts removed (D5) — "shaping", "after a 3-run split", "run 2 asks" keep their step asserts; "status words …" becomes "controls follow the feature" (target, halted, inactive when done/canceled/re-planning); `paintFeatureMembers` test removed; log mark is `.chat-rc-log-check svg` (was `svg.runs-glyph-done`); "controls: … waiting runs read Waiting" loses the status and members asserts; the pre-upgrade REST card test passes a stub group row via `groupOf` and reads `.run-status-text` "Run 2 of 3 · needs you", `.run-member-title`, `[data-qpanel-submit]`.
- test/ui-shape-feature-view.test.mjs: `look()` drops chip/status/runs, buttons read `textContent || aria-label`; "same card … only Runs folding and the step differ" → "only the step differs" (two `details.shape-feature-runs` asserts removed); halted test drops the `.shape-feature-status` /^Failed · Run 2/ and `.chat-rc-member-state`[3] "Waiting" asserts, buttons `['Resume', 'Re-plan the rest', 'More actions']`; re-planned test drops `refreshFeatureStatus` (deleted) and its status assert, keeps the banner (now asserted above the log); ship-one `ask-card-start` → `btn-primary`; shipped test drops `.chat-rc-member-state`[1] "PR #1 open"; added the D10/D12 test (omit Resume; no pause/stop deps → no Pause/Stop; no head/status/runs/members).
- test/ui-ship-card.test.mjs, test/ui-shape-changes-card.test.mjs, test/ui-shape-route-card.test.mjs: `ask-card-start` → `btn-primary` (D14).
- test/ui-group-page-route.test.mjs (clean merge): `.shape-feature.is-page` → `.shape-feature` (:44, :48); the "a repaint never remounts" identity assert stays.
- test/ui-run-status-card.test.mjs: the stopped-watch footer passes `disable: { 'ask-changes': "Ask for changes from the run's chat" }`; the title pin reads that reason (was "Ask for changes is not available yet"); added: with no `disable` entry, `ask-changes` is enabled (D8).
- test/ui-shape-check-row.test.mjs: the unmet mark is an `svg` (was the '✕' glyph); the gate-another scan allows `ui/public/question-delegate.mjs` (D19). (Both were needed already in merge 2.)
- test/event-golden-replay.test.mjs + test/fixtures/event-golden/shaper-feature-3-runs.json (regenerated with UPDATE_EVENT_GOLDEN=1, this test only): not in the plan; the golden pinned featureCardModel's chip/status/bars/members, which D5 removes. Output now `{label, phase, log, step, target}`; the chip/status words assert, the run1-build members assert and the run2-plan group-parts assert are removed; log and step-kind asserts stay; a run2-plan target assert is added.
- test/ui-shape-feature-actions.test.mjs: added "omits what the model footer already shows" (omit Resume, icon ⋯ with aria-label) and "no pause/stop deps → no Pause/Stop"; existing asserts unchanged.
- test/run-progress.test.mjs: ours' import list; R5's "every shipped workflow" test walks the agent/script nodes sorted by stage (plan, build, review) (D27); 18/18.
- test/ui-shape-check-row.test.mjs: ours' import (no `buildCheckRow`); RR's duplicated block (`foldItem` / `FOLD_CHECK` + four repeated Shaper tests) deleted by hand. RR's three `buildCheckRow` tests ("passing checks are chips…", "each failing check gets a Fix button…", "no Fix button without onFix") were already deleted on Shaper's side and git dropped them (D18).
- test/ui-shape-app-wiring.test.mjs (merge 3): both imports; RR's feature-page test selects `.gpage-card .gpage-question .plan-approve` and its group lists run 2 (p2) as a member; RR's run-page `.plan-more` count is 1 for workspace and project runs (Shaper's ⋯ always holds Stop).
- test/ui-shape-plan-body.test.mjs (merge 3): RR's role rows: a met row's mark is the check icon (was '✓' text); `!` for an open issue unchanged.
- test/ui-shape-step-receipt.test.mjs: added the D16 row (approve with role-review rounds → planApprovedLine; empty rounds → planApprovedText).

### Suite result
`npm test` (`node tools/test.mjs`) after merge 3: ℹ tests 12876 · ℹ pass 12866 · ℹ fail 1.
- The one failure is `test/api-run-engine.test.mjs`, file-level only: `ENOTEMPTY … rmdir …/Library/Caches/com.apple.python` (the temp-HOME cleanup race). Re-run alone: pass 5, fail 1, and the 1 is that same file-level hook. Environment, not the merge.
- `test/ui-runs-live-id.test.mjs` (recorded as failing on plain dev) passed in this run.
- No flaky file needed a re-run.

### UX web check
- `node tools/verify-feature-page-cdp.mjs`: exit 0, "all checks passed" (25 ok lines). The merged feature-page block reads one status line, at most one member list, no Shaper head/status/runs fold/member list, Re-plan the rest beside an icon ⋯, the four ⋯ items, full width; the group-page layout audit runs at 375 and 1440 in light and dark. Screenshots: worca-feature-page-runs-1792394444561.png, worca-feature-page-page-1792394444827.png (macOS temp directory).
- `node tools/verify-runs-list-cdp.mjs`: exit 0, "all checks passed" (layout and button audits for the list, the View menu, a row ⋯ menu and the Add to group picker at 375 and 1440, light and dark; no page exceptions).
- Not done: the hand-driven Playwright pass over the chat feature card (shaping, after the split), the Ship card and the Watch PR fix round under `WORCA_MOCK=1` in 2 themes × 2 widths. Those states are covered by jsdom tests only (test/ui-chat-run-card.test.mjs "merge: …" tests, test/ui-ship-card.test.mjs, test/ui-shape-feature-view.test.mjs).
