# Stillhet test findings: delivery plan

Sources: `/Users/emil.angelov/src/worka-cc-test/plans/rail/test-results/`. Read FINDINGS.md, v1-chat-shell.md, v2-tasks-wf.md, v3-proj-ins-mk-set.md and a1…a7b. Paths are under `ui/public/stillhet/` unless they start with `ui/`, `src/`, `docs/`, `test/` or `plans/`.

**Already done or in flight**
- #1312 Create PR demo body (merged).
- #1305 (merged into docs/rail-agreed): not-live view, stale bar, Marketplace first sync, Pulse Needs you wording. Re-check F-5-18, C-4 and V1-06 against it.
- #1313 Chat repaint, still open (FINDINGS calls it #1297). Frame time went from 94 to 65 ms, so the goal is not met. The rest of the redraw storm is in B2.
- #1310 Timeline (F-6-20 = F-7b-20 = KF-24), PR soon.

**Ids used here that are not in FINDINGS.md**
- O1–O4: the owner's 4317 rows.
  - #1 the gate is not shown
  - #2 a blocked review shows a tick
  - #3 "into dev" base
  - #4 the gate is listed under Plan
- C-1–C-4: the classic bugs in §(h).
  - legacy spec cards throw
  - merged rows read Ready under quota
  - Scripts count 13 vs 18
  - Marketplace shows "0 plugins" on first open
- BG-1–BG-4, from v3's background notes:
  - BG-1 Settings content sits 56px off-centre against the dot mask.
  - BG-2 Requirements has no dots.
  - BG-3 the dots drop below 1180px.
  - BG-4 the token table in `app.css:23-35` holds classic's live tokens, loaded through `ui/public/shell/self-hosted.css`. Not dead.

**Rules applied**
- Batches of 5–10 fixes, one PR per fix, squash merge.
- Server or shared changes go in their own PR.
- **Branch.** B1–B3 PRs and their baseline tags go on `docs/rail-agreed`. Once feature 2 reaches dev, B4–B8 go on `dev`.
- **Baseline and rollback.**
  - Tag `stillhet-bN-base` before each batch.
  - To roll back one fix, revert its squash commit.
  - To roll back a batch, revert to its base tag.
- **Ledger rule.** Nearly every PR touches the shared ledger files:
  - `docs/design-system-catalog.json`
  - `docs/rail/components.md`
  - `plans/rail/prototype/components.html`
  - `ui/public/design-system/components/index.mjs`
  - `plans/rail/findings.md`
  - `plans/rail/stillhet-wiring.md`
  - `test/fixtures/rail-gate-baseline.json`
  - `stillhet-surfaces-baseline.json`
  - the no-demo baseline (B1.10)

  So PRs in a batch merge one at a time, each rebased on the one before. Ledger conflicts are resolved as unions. B1.10 merges last in B1.
- **Bundles.** A PR that holds unrelated findings (B3.2, B4.2, B4.3, B4.6) says so in its body. Each finding gets its own commit inside it, so one finding can be reverted on its own.
- **Working method.**
  - Lean by default, Shaper only where a fix is marked design-first.
  - A failing test comes first for every fix.
  - Every UI fix reaches the prototype.
- **The gate.** Each batch passes `gate.real-data` on four instances: classic and Stillhet, each on real and on empty data. Items that were OK before stay OK, classic included.
  - Gate instances use their own `HOME` until D25/F-X-01 is done.
  - Checks that need PR state run in a quiet GitHub hour (D27).
- **Classic safety.**
  - Design-system CSS is part of classic `/style.css` (`ui/public/parts.json`). Every PR that touches `ui/public/design-system/*.css` or a parts.json part runs `npm run stillhet:style-diff` with the flag off and gets classic re-checks.
  - Classic files (C lane) also need classic re-checks and `gate.prototype`.
- **Generated files.** `stillhet/graph.js` and `stillhet/app.css` are generated: edit their sources.
- **Lanes:**
  - **S** = server or live data: `ui/server.mjs`, `ui/routes/**`, `src/**`, `stillhet/live/*`.
  - **U** = UI or page: `stillhet/{chat,runs,centers,pulse,settings,projects,insights,workflows,schedules,marketplace,shell,workspaces}`, design system and CSS.
  - **S+U** = touches both, so it holds both lanes.
  - **C** = classic files.
- **Sizes:** S = under a day, M = 1–2 days, M+ = 2–3 days, L = 3 days or more.

---

## 1. Four views

### 1a. Functional: wrong or missing behaviour or data, dead or fake actions (≈84)
| Area | Ids | Batch |
|---|---|---|
| Chat composer and cards | F-a1-01 model jumps to Opus max · F-a1-04 Stop dead · F-a1-07 no workflow picker · F-a1-08 · F-a2-03 · F-a2-04 · F-a2-05 · F-a2-10 · F-a2-11 · F-a2-18 | B1, B2, B7, B4, B3, B4, B4, B4, B4, B8 |
| Chat bar, search | F-a1-03 page 1 only · F-a2-02 = F-7a-04 = V1-05 search · F-7b-16 | B4 |
| Task page truth | O1 gate · O2 blocked review shows a tick · O4 · O3 = F-3-02 base · F-3-03 no remote · F-a4-03 + F-a1-09 no Pause/Stop · F-a4-09 · F-a4-11 | B1 ×6, B3, B3 |
| Task information | F-3-04 Q&A · F-3-05 Agents · F-3-07 steps · F-3-12 · F-3-13 · V-TW-14 Sessions · V-TW-15 follow-up item | B4, B6, B4, B6, B6, B6, B6 |
| Tasks list, centers | F-3-01 = F-7a-01 PR state (failed lookup / token / group members) · F-3-06 · F-3-08 filters · F-3-09 workflowId · F-3-10 counts · F-3-14 · F-3-15 · F-a4-05 duplicates · F-a4-07 archived | B1 / B3 / B4, B3, B4, B3, B3, B4, B4, B3, B3 |
| New task, schedules | F-a4-06 = F-5-04 wrong project · F-a4-04 · F-a4-08 · F-a4-14 · F-a4-15 | B1, B5, B7, B7, B7 |
| Settings demo and fake | F-7b-04, F-7b-05, F-5-01 = F-7b-11, F-5-02 = F-7b-12 (strip) · F-7b-03, F-7b-06 … F-7b-10, F-7b-13 (not-live rows) · F-7b-01 Labs · F-7b-02 Notifications | B1 |
| Workflows, Marketplace | F-5-03 · F-5-05 = F-6-02 · F-5-06 · F-5-07 · F-5-08 · F-5-09 · F-5-10 · F-5-15 · F-5-17 · F-5-20 · V-TW-06 loop | B8, B3, B8, B8, B2, B6, B5, B5, B8, B8, B5 |
| Projects, Insights | F-6-03 · F-6-04 · F-6-05 · F-6-06/07 = F-7b-17 · F-6-08 · F-6-09 · F-6-10 · F-6-15 · F-6-21 · V3-09 | B3, B7, B5, B8, B4, B6, B4, B4, B8, B5 |
| Navigation, places | F-7a-07 = F-7b-18/19 · F-7b-14 · F-7b-15 · F-3-17 · F-3-20 · F-a4-01 (#1312, done) · F-6-20 (#1310) | B8, B5, B5, B5, B8, done, #1310 |
| Classic | C-1 legacy spec cards · C-2 merged reads Ready under quota · C-3 Scripts count | B6, B3, B6 |

### 1b. Non-functional (≈36)
| Kind | Ids | Batch |
|---|---|---|
| Performance and redraw | F-a1-02 (+F-a1-10) · F-a2-06 · F-a4-02 dialogs vanish · F-a4-10 · F-6-01 · V1-02 · V3-07 · V-TW-16 · F-6-19 | B2 (V1-02 B4, F-6-19 B4) |
| Reliability, stale state, lost input | F-3-01 · F-7a-02 · F-7a-03 · F-a1-05 · F-a2-01 · F-5-08 · F-5-09 · F-5-11 · F-5-18 · F-6-16 · F-6-18 · F-3-18 · F-a2-17 · V1-10 · C-4 | B1/B3/B4, B3, B3, B4, B2, B2, B6, B4, B5, B3, B3, B4, B6, B5, B6 |
| Safety: money, repos, settings | F-a1-01 · F-a1-04 · F-a4-03 · F-a4-06 · F-a4-01 (done) · F-7b-01 · F-7b-04 · F-7b-05 · F-5-01 · O3 · F-3-03 · F-X-01 settings.json outside WORCA_HOME | B1 (F-a1-04: B2; F-X-01: B7.6 by D25) |
| GitHub quota | F-X-02 · C-2 · F-3-18 | B3, B3, B4 |

### 1c. UX (≈39)
| Kind | Ids | Batch |
|---|---|---|
| Wording | F-a1-06 user text reworded · F-a2-12 · F-a2-13 · F-a2-14 · F-a2-15 · F-a2-16 · F-3-11 · F-3-19 · F-a4-13 · F-5-16 · V-TW-19 · V3-13 · F-6-11 = V3-10 · F-6-12 · F-6-14 · F-6-17 · F-7a-06 · F-7a-08 | B6, B4 ×5, B3, B5 ×5, B4, B4, B4, B3, B3, B5 |
| Confusing states | O4 · F-3-16 · V1-06 Ready tone · V3-05 "On it now:" empty · V3-12 · F-a2-09 safety line missing · F-6-13 · F-7a-05 | B1, B3, B5, B4, B4, B4, B5, B5 |
| Missing feedback | F-a2-01 silent drop · F-a2-08 unread dot · F-a4-12 · V1-04 · F-5-12 · F-6-04 | B2, B7, B5, B7, B6, B7 |
| Dead ends | F-a4-11 · F-5-13 · F-5-14 · F-5-19 · F-6-16 half save · F-a4-15 no date · F-5-03 | B3, B6, B6, B5, B3, B7, B8 |

### 1d. UI: visual parity (≈35)
| Kind | Ids | Batch |
|---|---|---|
| Overflow on real data | V-TW-01 = V3-01 button 639px · V-TW-02 = V3-02 · V-TW-03 · V-TW-04 · V-TW-05 · V-TW-07 · V-TW-08 · V-TW-09 graph 0.33 · V-TW-10 · V-TW-18 · V3-03 · V3-04 · V3-11 | B3, B3, B5 ×11 |
| Spacing, alignment | V1-01 pinned rows 44 vs 32 · V1-03 · V1-07 · V1-08 · V1-09 · V-TW-11 · V-TW-12 · V-TW-13 · V-TW-17 · V3-06 · V3-08 | B5, B5, B7, B5, B6, B5, B4, B6, B5, B4, B5 |
| Backgrounds, surfaces | BG-1 · BG-2 · BG-3 · BG-4 (scope: Rail no longer inherits it) · V-TW-20 dock surfaces · V-TW-21 dot colour hard-coded · V-TW-22 picked segment = field (classic `.seg`) | B6 |
| Content shape | V-TW-06 · V3-09 · F-a2-07 · F-3-16 | B5, B5, B4, B3 |

---

## 2. Batches

Each line reads: id(s) → fix · lane · files · size. "→ after" gives the order within a batch when two fixes share a file.

### B1: Safety (money, real repos, wrong writes, wrong PR actions, fake success)
Goal: no live control spends wrongly, writes to the wrong place, offers a wrong PR action, loses a known PR state, or reports a success it did not have.

1. F-7b-04, F-7b-05, F-5-01 = F-7b-11, F-5-02 = F-7b-12 → remove the demo Plugins rows, the sample spend and caps, and Setup. Plugins lists only `/api/plugins`. No design needed · U · `settings/settings-model.js` (:66, :70, :148-150, :360, :397, :681), `settings/settings.js`, `pulse/pulse.js:21` · S
2. F-7b-03, F-7b-06 … F-7b-10, F-7b-13 → every remaining sample row is a not-live row: "Not in Stillhet yet: turn Stillhet off from the top-bar switch to use it" Words only (D6, D23) · U · reuse `notInStillhet` in `design-system/components/empty-state.mjs:30-38` if it fits a row. Otherwise add a new component file. Do not change `settings-row.mjs`: classic imports it (`prompt-check/chip-host.mjs:9`, `shape/proposal.mjs:14`), and any change to it needs classic re-checks. Also docs, catalog, gallery and `settings/settings-model.js` · M · design-first (the not-live row) · after 1
3. F-7b-01, F-7b-02 → Labs and the Notifications pickers are disabled with a reason, using row 2 (D22, default disable). Wiring Labs would expose real flags, `rail` included · U · `settings/settings-model.js` FLAGS :111, `settings/settings.js` :153, :273-277, `pulse/pulse.js:889-900` · S · after 2
4. F-a4-06 = F-5-04 → the project picker reads `/api/projects` and never defaults to a removed project · U · `centers/centers.js:293` · S
5. F-a1-01 → a new chat is seeded from the composer's own model pick, never from the catalogue default · S · `live/chat-live.mjs:378-383` · S · can start now
6. O1, O2, O4 → map the review gate (its question, Run another cycle, Accept as is). A blocked review shows blocked. An open gate sits under Review · S+U · `live/task-page.mjs`, `live/task-live.mjs` act :368, `runs/run-page-model.js:81` · M
7. O3 = F-3-02, F-3-03 → no Create PR without a remote or with an unknown base. The base comes from the PR or the run's base · S · `live/task-page.mjs` · M · after 6
8. F-3-01 (cause) → a failed lookup never clears a known PR state. `enrichPipelinesPr` returns `pr: null` on any failed lookup, quota included (`src/core/artifacts.mjs:2781-2811`), and the client then deletes the PR (`live/live-adapter.mjs:117`). The server tells "lookup failed" apart from "no PR" and sends only the second as null. The client keeps the PR on "failed" · S (own server PR, then a client PR) · `src/core/artifacts.mjs` enrichPipelinesPr :2781, `src/core/git-info.mjs` findPrForBranch :1062, `live/live-adapter.mjs:113-118` · M
9. F-a4-03 + F-a1-09 → a task page opened by run id learns its `pipelineId` from the state frame (`live/live-adapter.mjs:254`). It gets Pause and Stop, with no `/api/runs/<runId>` 404s · S+U · `live/task-live.mjs` (:368), `live/live-adapter.mjs`, `runs/run-page-model.js` (:81, :813) · M · after 6; after #1313 (shares live-adapter.mjs)
10. Track A1 → live gate test: any live control that shows demo data, a would-answer or a local-only success fails. Today's offenders are frozen as a ratchet baseline · U · `test/stillhet-no-demo-on-live.test.mjs`, `tools/` · S · merges last

- **Depends on:** #1313 only for item 9. Item 1 takes in the `fix/stillhet-settings-no-handle` commit. All other items can start now.
- **Order:** 1 → 2 → 3 (settings-model.js, settings.js, pulse.js). 6 → 7 → 9 (task-page.mjs, task-live.mjs, run-page-model.js). 10 last.
- **Classic re-checks:**
  - item 8: classic Runs PR states, Needs you count, Create PR, PR watch.
  - item 2: only if it touches `settings-row.mjs` (it should not).
- **Design-first:** item 2.
- **Owner decisions:** D22 (item 3), D6 and D23 (item 2, words only, not blocking), D24 (may this stripped Settings ship to dev), D27 (how item 8 is verified).

### B2: Redraw storm and lost input (what #1313 leaves)
1. F-a4-02 (part) → host `#center-dlg` outside `#app`, so dialogs survive a repaint · U · `centers/centers.js:318` · S · first
2. F-a1-04 → keep confirm and form in a per-id store, not on `liveCard(t)`, so Stop confirms and stops · U · `chat/conversation.js` · S · after #1313
3. F-a1-02 (rest) + F-a1-10 → `onPrs` draws only when a PR really changed · S · `live/live-adapter.mjs:113-122` · S · after #1313
4. Track C1 → performance budget tests (§3C) · U · `test/` · S
5. F-a2-01 → a send during streaming is queued with the line "Sends when the reply finishes" (D7: queue) · S+U · `live/chat-live.mjs` `send`, `chat/conversation.js` (:1567) · S · after 2 and #1313
6. F-a4-02, F-a4-10, F-6-01, V3-07, V-TW-16, F-a2-06 (check) → library rule plus component: an open menu, input or dialog keeps its value and focus across a draw · U · `docs/rail/`, `design-system/components/dialog.mjs`, catalog, gallery · M · design-first. Classic re-check: dialogs
7. Partial patching → `renderInShell` patches `#app` by part, not as a whole · U · `pulse/pulse.js:754-780`, `projects/projects.js:140,189,283` · L · after 4 (budgets in place) and 6
8. Unplaced redraw causes, each measured against C1:
   - Pulse re-renders and runs `fitMenus` on every draw.
   - The scroll fade re-measures on every draw (`components.js:5150`).
   - `pulse.js:773` rewrites `#route-settings`, which wipes Settings fields.

   · U · `pulse/pulse.js`, `components.js` source · M · after 7
9. F-5-08 → Edit a copy by hand stays a draft until Save (D8) · S+U · `workflows/workflows.js:274`, `live/workflow-live.mjs` · S
10. Observer CPU → `rewordIn` skips chat turns and Prose and runs only on added nodes · U · `shell/shell.js:386-403` · S · after #1313. Keep only if C1 measures it; otherwise move to B6 with F-a1-06

- **Depends on:** #1313 merged (items 2, 3, 5, 10).
- **Order:** 2 → 5 (conversation.js). 1 → 6 → 7 → 8 (pulse.js, centers.js).
- **Classic re-checks:** classic chat send while streaming is unchanged; classic dialogs (item 6). If item 6 or 7 touches design-system CSS: run style-diff with the flag off.
- **Design-first:** item 6 (the rule), item 5 (the queued line in the prototype).
- **Owner decisions:** D7 (decided: queue), D8 (item 9), D19 (item 4).

### B3: Wrong data
1. F-3-11 → local log times and step names · S · `live/task-page.mjs` (:113) · S
2. **Bundle**, one commit per finding:
   - F-a4-05: filter tickets that have a `scheduleId`.
   - F-3-06: keep members without a run.
   - F-a2-03: draw member cards.
   - F-6-03: `remote:null` offers Link a remote.
   - F-7a-06: the pause reason by kind.

   · S+U · `live/live-map.mjs` (:77, :383), `live/chat-turns.mjs`, `projects/projects.js:181` · M · design-first (Link a remote) · after 1
3. F-7a-02, F-7a-03, F-a4-07 → supersede by `pipelineId`; re-read the saved row on `stopped`; apply `run-created` at once; read archived with `?archived=1` · S · `live/live-adapter.mjs`, `live/live-map.mjs` · M · after 2
4. F-7a-02 (server part) → `run-created` carries `pipelineId` where it is known. Today only resume (`ui/server.mjs:5549`) knows it; a new run's `announceRun` (:1452, called :3553) runs before :1581-1583 captures it · S (own server PR) · `ui/server.mjs` · S. Classic re-check: run list and live updates
5. F-5-05 = F-6-02, F-6-16, F-6-17, F-6-18 → await the refresh after add; check workspace members before saving the name; plain refusal words; no reads of removed items · S · `live/projects-live.mjs` · M
6. F-3-10, F-3-16, V-TW-01 = V3-01, V-TW-02 = V3-02 → right week counts and cost; one line per task; short button labels; left-aligned links · U · `centers/centers.js`, `design-system/confirm-strip.css` · S. Style-diff with the flag off, plus classic re-checks
7. F-a4-09, F-a4-11 → a group with one done member is not Working; Restart Build is disabled with a reason when there is no plan · U · `runs/run-page-model.js`. Confirm F-a4-09's file first: if it is `live/task-page.mjs`, run this after 1 · S
8. F-3-09 → history rows carry `workflowId` · S · `listAllPipelines` in `src/core/artifacts.mjs` (:2656) · S. Classic re-check: Runs list and history consumers. Closes the findings.md row "by-workflow grouping"
9. F-X-02, C-2 → a shared, longer PR-status cache with quota backoff · S · `src/core/git-info.mjs` findPrForBranch, `src/core/artifacts.mjs:2781` · L. Classic re-checks: Create PR, PR watch, checks, Runs
10. F-3-01 (token) → a per-client PR token: a random integer, because the server runs `Number(req.body.token)||0` (`ui/routes/history/history.mjs:42`), or a server PR that issues it · S · `live/live-adapter.mjs:108-112` · S

- **Depends on:** B1.8 and B1.9.
- **Order:** 1 → 2 → 3 (task-page.mjs:113, live-map.mjs). 4 before 3's frame handling is relied on. 9 after B1.8.
- **Classic re-checks:** as listed per item; classic Projects after add and remove.

### G: Before feature 2 goes to dev (D26)
1. Second test pass (P11): 36 not tested, 14 blocked, 21 partial, TK-15/16/18/21/22 included. Also re-run every §2 row plus SX-05 and SX-10. Needs:
   - a `rail` that is not locked
   - GitHub quota or a quiet hour
   - `serverMock` and a higher run cap
   - state fixtures
2. The feature fidelity audit required by `docs/rail/gate.md`.
3. The four open findings.md rows owned by "feature 2 final check":
   - by-workflow grouping → B3.8
   - workflow picker row → D28
   - slice-10 Insights minors (`scope=`, `of=`, `act.copy-link`) → one small PR here
   - Schedules compare PNGs re-shot → confirm against their cells or restore

### B4: Missing information (on dev)
1. F-3-04, F-3-07, V-TW-12 → map `clarify` (Decisions) and the time, cost and cycle of each `steps[]` entry · S · `live/task-page.mjs` · M
2. **Bundle**:
   - F-a2-05: answered cards keep their outcome.
   - F-a2-09: the safety line.
   - F-a2-10, F-a2-11: ship and PR card facts.
   - F-a2-12–14: wording.

   · S+U · `live/chat-turns.mjs`, `chat/conversation.js` (:731, :765) · M
3. **Bundle**:
   - F-a2-04: merged card figures.
   - F-a1-08: proposal model and branch.
   - F-a2-07: PR chips.
   - F-a2-15, F-a2-16: head project.
   - V1-02: the Ask composer re-measures on resize.

   · U · `chat/conversation.js` · M · after 2
4. F-3-14, F-3-15, F-3-08 → row facts and chips, View PR, label, person and workflow filters · U · `runs/runs-list.js` · M · design-first (filters)
5. F-6-15, V3-05, V3-06, F-6-14, V3-12, F-6-19 → readiness, Metrics/Policy, last run; empty head line; names not keys; no wait on history · U · `projects/projects.js`, `workspaces/workspaces.js` · M
6. **Bundle**:
   - F-a1-03: follow the cursor.
   - F-a2-02 = F-7a-04 = V1-05: search via `?q=` with chats and tasks.
   - F-7b-16: classic card names.
   - F-5-11: re-read pins.

   · S+U · `live/live-adapter.mjs`, `pulse/pulse.js` (search index), `chat/conversation.js:246-254` · M · after 3
7. F-a1-05 → resubscribe and catch up after a reload mid-reply · S · `live/chat-live.mjs:184-213` · S
8. F-3-18 → read checks only for open PRs · S · `live/task-live.mjs` · S
9. F-6-08, F-6-10, F-6-11 = V3-10, F-6-12 → the per-task figure counts tasks only; people count; formatted hours and negative amounts; outcome split · S+U · `insights/insights-model.js`, `insights/insights.js`, `live/insights-map.mjs` · S · after #1310
10. F-3-01 (group members) → group members' `pr` from `/api/run-groups` · S · `live/live-map.mjs:431-447` · S

- **Depends on:** B3.8 (item 4's filter); #1310 (item 9).
- **Order:** 2 → 3 → 6 (conversation.js).
- **Classic re-checks:** server search `?q=`, if it is added server-side.
- **Owner decisions:** D4 blocks only item 4's "using workflow" filter.

### B5: Fits on real data, wording and navigation
1. V-TW-06, V-TW-19, F-5-10 → loop from ≠ to; all loops; plurals and model words · S+U · `live/workflow-map.mjs:84`, `workflows/workflows.js:86-93` · S · first (before 2's V-TW-07)
2. V1-01, V-TW-03, V-TW-04, V-TW-05, V-TW-07, V-TW-10, V-TW-17, V-TW-18, V3-03, V3-11 → Stillhet-only CSS:
   - `:is(.bar-list,.bar-back) .lr-rail{height:28px}`
   - base and chip shrink with an ellipsis
   - `break-word`
   - `flex:none`
   - stage min-height
   - card foot clamp
   - name column

   · U · `css/rail.css` (:1626), Stillhet `shell/shell.css` · M (prototype included)
3. V-TW-08, V-TW-11 (css), `.bc-v` nowrap, empty-state alignment → design-system CSS · U · `design-system/design-system.css` · S. Style-diff with the flag off, plus classic re-checks
4. V-TW-09 → a minimum fit scale plus horizontal scroll · C · classic `ui/public/graph/view.mjs` (`stillhet/graph.js` is generated) · S. Classic graph re-check, `gate.prototype`
5. V3-04, V3-08, V3-09, F-6-13 → thin the x labels; crumbs inside the column while loading; split the series by project; absent pages say "Not in Stillhet yet" · U · `design-system/components/chart.mjs`, `insights/insights.js`, `css/rail.css:1626` · M · after 2
6. F-3-19, F-a4-12, F-a4-13, F-5-19 → plurals; true PR failure words; no Open in Workflows for a deleted workflow · U · `runs/run-page.js` · S
7. F-7a-05, F-7a-08, F-7b-14, F-7b-15, F-3-17 → Pulse closes on navigation; ⌘J scope; old addresses resolve · U · `shell/shell.js`, `shell/old-addresses.js`, `settings/settings.js` · S
8. F-a4-04, F-6-05 → re-run a route's gone check when its source loads · U · `shell/shell.js:268` · S · after 7
9. V1-03, V1-06, V1-08, V1-10 → no empty row time; Ready tone by `look.alert-ladder`; search does not shift; badge on first paint · U · `design-system/components/row.mjs`, `pulse/pulse.css`, `shell/shell.css` (V1-08) · S · after 2
10. F-5-15, F-5-16, V3-13, F-5-18 (check against #1305) → pinned sha; field names from the manifest · S+U · `marketplace/marketplace.js`, `live/market-live.mjs` · S

- **Order:** 1 → 2 → 5 and 9 (rail.css:1626, shell.css). 7 → 8 (shell.js).
- **Owner decisions:** D20 (item 2, 32px), D21 (item 9, re-decided after B1.8).

### B6: Surface system and remaining parity
1. Track B → rule `look.surface` plus a page-canvas component; the shell owns the canvas and the content column · U · `docs/rail/look.md`, `design-system/components/shell-frame.mjs` (or a new `page-canvas.mjs`), catalog, gallery · M · design-first (Shaper)
2. BG-1, BG-2, BG-3, BG-4 (Rail no longer inherits classic's tokens; the table stays for classic), V-TW-20, V-TW-21, V-TW-22 → apply item 1:
   - the Settings column is centred
   - one dock surface
   - a dot colour token
   - a picked-segment token

   `.seg` is classic (`ui/public/settings/info-tooltips.css:60-63`), so it needs classic re-checks · U · `shell/shell.css`, `css/rail.css`, the app.css source (not the generated `stillhet/app.css`), settings layout · M · after 1. Style-diff with the flag off
3. F-3-05, V-TW-13, V-TW-14, F-3-13 → Agents with sub-agents, Sessions, Overview facts · S · `live/task-page.mjs` · M
4. F-3-12, V-TW-15 → artifact names and viewer navigation; "Start a follow-up task" · U · `runs/run-page.js` · S
5. F-5-12, F-5-13, F-5-14 → empty reasons; no empty ⋯ menu; Run all disabled with no cases · U · `workflows/workflows.js` · S
6. C-1, C-3, C-4 (check against #1305) → classic legacy spec cards; the Scripts count includes `shared` · C · `ui/public/` classic chat and workflows · S. Full classic walk of Chat and Workflows
7. F-6-09 → missing Insights measures · S · `live/insights-live.mjs` · M
8. F-a2-17, V1-09 → no MCP preview for a gone chat; the effort word is not orphaned · U · `chat/conversation.js` · S
9. F-a1-06 → `rewordIn` leaves user text alone (wording part; the CPU part is B2.10 if it was measured) · U · `shell/shell.js:386-403` · S
10. F-5-09 → deferred deletes flush on `pagehide` · S · `live/workflow-live.mjs`, `live/market-live.mjs:244` · S

- **Owner decisions:** D16–D18 block items 1–2; D14 for item 5.

### B7: Design-first or decision-first controls
1. F-a4-08, F-a4-15 → schedule prompt and workflow; a date picker for a one-off schedule · U · `schedules/schedules.js` · S · design-first (D15)
2. F-a2-08, V1-04, V1-07 → unread dot; New chat in the empty live list; head rhythm · U · `chat/chats-column.js` · S · design-first (unread dot)
3. F-a1-07 → workflow picker in the composer · U · `chat/conversation.js` · S · design-first (D4; the findings row's owner by D28)
4. F-a4-14 → guardrails, draft PR and slice PR in New task · U · `centers/centers.js` · S · design-first
5. F-6-04 → scan-model picker for a workspace · U · `workspaces/workspaces.js` · S · design-first
6. F-X-01 → settings location plus migration. Today it is under `defaultRoot` by design (`src/core/settings.mjs:85-91`), `worcaHome` reads its root from settings (`src/core/projects.mjs:46`), and 64 files depend on it · S (own server PR) · M+ · blocked by D25. Classic re-check: settings read and write on a default HOME. Until it is done, gate instances use their own HOME

### B8: Places that need design first (Shaper; the interim "Not in Stillhet yet" words come from B1.2)
1. F-7b-17 = F-6-06/07, F-6-21 → project and workspace tabs (D3)
2. F-7a-07 = F-7b-18/19 → `#design` and `#profile` (D1)
3. F-5-06 → agent and script authoring (D9)
4. F-5-07, F-5-17 → plugin management (D10)
5. F-5-20 → export to a marketplace (D11)
6. F-5-03 → newcomer path (D13)
7. F-a2-18 → Requirements parts (D2)
8. F-3-20 → mock choice and mock mark (D5)
9. SC-03 → schedule Activity feed (D12)

Each is blocked by its decision. "Drop" closes it with its row in the gate baseline. A real "Open in classic" follows D23. The real Settings build (wave 3) follows separately.

---

### B9: Classic functions missing in Stillhet (coverage)
From gate.coverage (`tools/classic-inventory.mjs`, `plans/rail/coverage/COVERAGE.md`): every classic control was mapped to Stillhet; these are the classic functions no Stillhet code, wiring row or plan reaches. Each item is one finding (`plans/rail/findings.md`, COV-N) and lists the classic API it needs and the Stillhet place it belongs in by the design's rules; where the design has no home yet the item is design first (rule, catalog entry, component, test, gallery) or waits on its decision. Ordered by user impact. Each closes when its controls leave the MISSING baseline (`test/fixtures/stillhet-coverage-baseline.json`, `test/stillhet-coverage.test.mjs`).

1. **COV-1** Add a project: New (make the folder), Several folders… (add many at once) and the in-app folder browser (23 controls) · classic `/api/fs/dirs`, `/api/git`, `/api/projects/bulk`, `/api/projects/create`, `/api/projects/probe` · Stillhet place: Projects › + › Add a project by hand (one folder or repository only today) · owner: Projects slice
2. **COV-2** New run form: saved run defaults, presets (apply, check, duplicate, update), a workflow's defaults, a ticket source, sync before start, engine check, policy scope and notes (52 controls) · classic `/api/engines`, `/api/policy/notes`, `/api/policy/scopes`, `/api/presets/:param`, `/api/presets/:param/check`, `/api/presets/:param/duplicate` and 5 more · Stillhet place: + › New task… › More options, and Chat's TaskProposal · owner: feature 2 final check
3. **COV-3** Run and chat extras: a direction straight to a run, a run's files for Chat, restore a run, a chat's engine switch, a chat attachment, Propose fix run, Resume on / Switch model from a run link (17 controls) · classic `/api/ask/runs/:param`, `/api/ask/threads/:param/attachments/:param`, `/api/ask/threads/:param/engine`, `/api/run-links/:param`, `/api/runs/:param/ask-files/:param/:param`, `/api/runs/:param/directions` and 1 more · Stillhet place: Chat (TaskCard ⋯, FilesCard, the composer) and the task page · owner: feature 2 final check
4. **COV-4** A workspace task: its comments, diff and log per member; a workspace's settings and the impact of removing a member (30 controls) · classic `/api/workspaces/:param/members/remove-impact`, `/api/workspaces/:param/runs/:param/:param`, `/api/workspaces/:param/runs/:param/comments`, `/api/workspaces/:param/runs/:param/diff`, `/api/workspaces/:param/runs/:param/log`, `/api/workspaces/:param/scan-models` and 3 more · Stillhet place: the task page of a workspace task; Projects › a workspace · owner: Projects slice
5. **COV-5** Task page extras: resolve a moved base in a terminal or a pipeline, PR remotes, cross-link and mergeable, a group's suggested name, Away decisions, guardrail details, team memory dismiss, browse launchers (19 controls) · classic `/api/actions/launchers/browse`, `/api/guardrails/:param`, `/api/memory/team/:param/available/dismiss`, `/api/night-decisions`, `/api/pr/crosslink`, `/api/pr/mergeable` and 3 more · Stillhet place: the task page (base-moved strip, PR dialog, Changes › Actions), the bar's Add to group · owner: feature 2 final check
6. **COV-6** Report a run (report, report result) and a run's PR auto setting (8 controls) · classic `/api/pipelines/:param/pr-auto`, `/api/pipelines/:param/report`, `/api/pipelines/:param/report-result` · Stillhet place: the task page ⋯ › Report this task, the PR dialog · owner: feature 2 final check
7. **COV-7** A project's tabs: readiness (Recheck, Ignore), sync settings, team policy and team metrics enable, house brief, a project terminal (27 controls) · classic `/api/projects/:param/house-brief`, `/api/projects/:param/policy/enable`, `/api/projects/:param/readiness`, `/api/projects/:param/sync/settings`, `/api/projects/:param/team-metrics`, `/api/projects/:param/team-metrics/enable` and 3 more · Stillhet place: the project page (D3, B8.1): where its tabs live · owner: Projects slice
8. **COV-8** Schedule a one-off after another run: the after-candidates list behind Change… and Schedule next… (6 controls) · classic `/api/schedules/after-candidates` · Stillhet place: Schedules › a one-off's "after TITLE" picker · owner: feature 2 final check
9. **COV-9** The Shaper answerer: Fix all, Ask for changes, Agree and plan, Update plan on a feature or a requirement (7 controls) · classic `/api/answerer` · Stillhet place: Chat › PlanCard, Requirements · owner: feature 3
10. **COV-10** Project automations: add, turn off and delete a rule, check now (5 controls) · classic `/api/automations/rules/:param` · Stillhet place: the project page (D3) or Settings › Automations · owner: Projects slice
11. **COV-11** Models and providers: GitHub Copilot sign-in and models, OpenAI-compatible list and import, credentials, OpenRouter free limits (15 controls) · classic `/api/credentials`, `/api/models`, `/api/openrouter/free-daily`, `/api/providers/copilot/login`, `/api/providers/copilot/login/:param`, `/api/providers/copilot/logout` and 2 more · Stillhet place: Settings › Models (wave 3 slice 12) · owner: feature 3
12. **COV-12** Connectors: MCP sets, run preview, a project's .mcp.json approve, validate a server, team members (8 controls) · classic `/api/mcp/preview`, `/api/mcp/projects/:param`, `/api/mcp/projects/:param/mcpjson`, `/api/mcp/projects/:param/mcpjson/approve`, `/api/mcp/servers/validate`, `/api/mcp/sets` and 1 more · Stillhet place: Settings › Connectors (wave 3 slice 12) · owner: feature 3
13. **COV-13** The setup assistant: detect, apply, team setup draft and share (24 controls) · classic `/api/setup/apply`, `/api/setup/apply/:param`, `/api/setup/detect`, `/api/setup/team`, `/api/setup/team/draft` · Stillhet place: Settings (wave 3 slice 12) and onboarding (slice 13) · owner: feature 3
14. **COV-14** Settings keys with no Stillhet row or plan: the helper models (title, naming, PR description, command summary, agent generator, auto workflow, second opinion, utility, design, factory), the Chat engine and models, Chat's turn and cost caps and web access, actions detection and gate, memory defrag, test workers, the projects root default, debug spawn, the workspace scan model (40 controls) · classic `actionsDetected`, `actionsGate`, `agentGenModel`, `agentGenModelEffective`, `askEngine`, `askMaxBudgetUsd` and 28 more · Stillhet place: Settings › Chat, Models, Machine (wave 3 slice 12) · owner: feature 3
15. **COV-15** Version and updates: check now, channel, choose a version, update, dismiss (6 controls) · classic `/api/app/update`, `/api/app/update/dismiss`, `/api/app/update/preview`, `/api/app/update/versions`, `/api/app/version`, `/api/app/version/check` · Stillhet place: Settings › About (wave 3 slice 12, F-7b-07) · owner: feature 3
16. **COV-16** Chat engine status and Send test message (Chat settings, plugin install steps) (11 controls) · classic `/api/chat/status`, `/api/chat/test` · Stillhet place: Settings › Chat (wave 3 slice 12) · owner: feature 3
17. **COV-17** Smart naming: suggest a name on rename, branch pattern and when to suggest (7 controls) · classic `/api/naming/config`, `/api/naming/suggest` · Stillhet place: Settings › Starting › Naming (wave 3) and the task rename · owner: feature 3
18. **COV-18** Labels admin: rename and delete a label (1 control) · classic `/api/labels/:param`, `/api/labels/rename` · Stillhet place: Settings › Labels and cost tags (wave 3, F-7b-10) · owner: feature 3
19. **COV-19** Ticket sources: test a connection, call a source, a profile (5 controls) · classic `/api/sources`, `/api/sources/call` · Stillhet place: Marketplace › a plugin's set-up, New task's Start from a ticket · owner: feature 3
20. **COV-20** Requirements: the whole page (brief, helper chat, assumptions, answers, attachments, import and export, save, start, finish, revert) (77 controls) · classic `/api/requirements`, `/api/requirements/:param`, `/api/requirements/:param/:param`, `/api/requirements/:param/answers`, `/api/requirements/:param/archive`, `/api/requirements/:param/assumptions/:param` and 23 more · Stillhet place: Requirements (wave 3 slice 11, D2, B8.7) · owner: feature 3
21. **COV-21** Onboarding and the Worca level: the newcomer checks, the team setup notice, the level and its events (10 controls) · classic `/api/onboarding`, `/api/worca-level`, `/api/worca-level/ack`, `/api/worca-level/events` · Stillhet place: onboarding (wave 3 slice 13, D13, B8.6) and the profile · owner: feature 3
22. **COV-22** Pinpoint: select text in an answer, an artifact or a diff, then Explain, Alternatives, Discuss, Use this (9 controls) · classic `/api/pinpoint` · Stillhet place: Chat and the task page's Changes (design first) · owner: owner decision
23. **COV-23** Agent and script authoring: generate an agent (and stop), script runtimes and the bench (14 controls) · classic `/api/agents/generate`, `/api/agents/generate/stop`, `/api/scripts/bench/:param/output/:param`, `/api/scripts/bench/stop`, `/api/scripts/runtimes` · Stillhet place: Workflows (D9, B8.3) · owner: owner decision
24. **COV-24** Team metrics: discover repositories, flush (3 controls) · classic `/api/team-metrics/discover`, `/api/team-metrics/flush` · Stillhet place: Insights › Team · owner: final cleanup PR
25. **COV-25** Browser push sign-up and the session guard's Sign in again (3 controls) · classic `/api/health`, `/api/push` · Stillhet place: the shell (profile menu) and Settings › Notifications · owner: feature 3
26. **COV-26** Export to a marketplace: publish targets and export jobs (20 controls) · classic `/api/marketplaces/jobs/:param`, `/api/marketplaces/publish-targets` · Stillhet place: Workflows › export (D11, B8.5) · owner: owner decision
27. **COV-27** Import Claude Code skills: browse home, preview, import (3 controls) · classic `/api/skills/home`, `/api/skills/import`, `/api/skills/import/:param`, `/api/skills/import/preview` · Stillhet place: Marketplace (D10, B8.4) · owner: owner decision
28. **COV-28** The Design page: versions, pictures, sound, export, models, builds (28 controls) · classic `/api/design/:param`, `/api/design/:param/export`, `/api/design/:param/pictures`, `/api/design/:param/pictures/:param`, `/api/design/:param/sound`, `/api/design/:param/versions/:param/restore` and 2 more · Stillhet place: #design (D1, B8.2): a home or retire · owner: owner decision
29. **COV-29** Controls only another Stillhet place reached (50 controls): Workflows' chat groups and chat cards, Schedules' notifications, a chat's workspace menu, Insights filters and more; the coverage check counts a route only from the control's own place, so each needs its own place's code, a `wired` row naming that place's file, or a `## Classic controls` row · classic `/api/ask/groups/:param`, `/api/notifications/read-all`, `/api/workspaces/:param`, `/api/scripts/:param` and more · Stillhet place: each control's page's place · owner: feature 3

The Settings, Requirements and onboarding items (COV-11 … COV-21) go into wave 3 (4b) with the slice named in their place; the Pinpoint, authoring, export, skills and Design items (COV-22, COV-23, COV-26 … COV-28) wait on D9, D10, D11 and D1, or a new decision for Pinpoint.

## 3. Cross-cutting tracks

**A. No action without backend**
- **Rule:** a live control never shows demo data, a would-answer, or a success that was only local.
- **A1 (B1.10):** a gate test reads every demo-answer call site in Stillhet code (70 grep hits in 14 files; the owner counts 66), each of which must never reach a live control. It also reads the 19 `wire to` rows in `plans/rail/stillhet-wiring.md` § Dev surfaces.
  - It classifies each site as wired, refused with a reason, not in Stillhet yet (words only), or prototype-only.
  - The live instance fails on any site that is not classified.
  - The baseline can only shrink.
- **A2:** every batch lowers the baseline:
  - B1: Settings.
  - B2 and B6: workflow copy and deletes.
  - B5: Marketplace and Insights absent pages.
  - B8: the rest.
- **A3:** `gate.real-data` walks the remaining sites on instances B and D in each batch.

**B. Surface and background system (B6.1, B6.2)**
- **Rule:** the shell owns the canvas:
  - one mask from `--col-w`
  - every page's content column centred on it
  - docks and fills from tokens
  - a dot colour token
  - a picked segment with a fill of its own
- The component, its test and its gallery example come first. Pages then only declare their column width.
- Classic's tokens (`app.css:23-35` via `self-hosted.css`) and `.seg` stay. Rail stops inheriting them.
- V1-01 is fixed earlier, in B5.2.

**C. Performance budgets as tests (B2.4; re-run in every gate.real-data)**
- **C1 in `npm test` (host):**
  - An idle long chat (200 turns) makes 0 DOM mutations in 10 s, apart from the exclusions listed in the test:
    - text updates on time-tick elements (turn times, relative times)
    - the orb and thinking-indicator subtree

    The exclusion list can only shrink.
  - A PR frame with no change makes 0 draws.
  - One live update repaints only its own turn.
- **C2 in gate.real-data:** idle main-thread CPU and one live-update frame on a long chat.
- **Numbers (D19):** a ratchet starts from measured values (for example a 65 ms frame on a long chat, after #1313). Each batch may only lower them. The target is ≤16 ms scripting and idle CPU under 5%. A batch that regresses a budget does not merge.

---

## 4. Owner decisions (merged)
| # | Decision | Default proposed | Blocks |
|---|---|---|---|
| D1 | `#design` and `#profile`: a home or retire them | retire, with words only ("turn Stillhet off from the top-bar switch") | B8.2 |
| D2 | Which Requirements parts get a place | — | B8.7 |
| D3 | Home for project and workspace tabs | — | B8.1 |
| D4 | Workflow picker place, "using workflow" filter | the proposal's Select workflow | B7.3, the B4.4 filter part |
| D5 | Mock choice in Stillhet | classic only | B8.8 |
| D6 | Form of the Settings stop-gap | **decided (owner, 2026-11-15): words only, "Not in Stillhet yet: turn Stillhet off from the top-bar switch to use it"** | B1.2 |
| D7 | Send while streaming: queue or refuse | **decided (owner, 2026-11-15): queue, as classic does** | B2.5 |
| D8 | Copy by hand is a draft until Save | yes (prototype) | B2.9 (not blocking) |
| D9 | Where agents and scripts are authored | — | B8.3 |
| D10 | Plugin management place | — | B8.4 |
| D11 | Export to a marketplace: keep or drop | — | B8.5 |
| D12 | Schedule Activity feed place | — | B8.9 |
| D13 | Newcomer path before wave 3 | — | B8.6 |
| D14 | Team / For you with nothing live: hide or say why | say why | B6.5 |
| D15 | Date picker for a one-off schedule | yes | B7.1 |
| D16 | Canvas below 1180px: none, or a narrower clear column | narrower column | B6.1 |
| D17 | Canvas on not-live pages (Requirements) | yes, same canvas | B6.2 |
| D18 | Dock surface: solid like `#task-dock` or transparent like `#wf-dock` | transparent, composer on `--bg` | B6.2 |
| D19 | Performance budget numbers | a ratchet from measured values (65 ms frame, measured idle mutations and CPU), lowered each batch toward 0 idle mutations, CPU under 5%, frame ≤16 ms | B2.4 |
| D20 | Pinned and recent rows at 32px, as in the Chat bar (prototype too) | 32px | B5.2 |
| D21 | Ready in Needs you: advisory ink per `look.alert-ladder` (V1-06) | re-decide after B1.8 (failed-lookup fix) shows true PR states | B5.9 |
| D22 | Labs and Notifications: wire or disable | **decided (owner, 2026-11-15): disable with a reason in B1; wire in wave 3** | B1.3 |
| D23 | "Open in classic" mechanism | **decided (owner, 2026-11-15): none; not-live places use words only** | — |
| D24 | May a stripped Settings (with not-live rows) ship to dev before wave 3 | yes, with the not-live rows | the move to dev |
| D25 | F-X-01: settings location and migration | **decided (owner, 2026-11-15): later, as its own server PR outside these batches; test instances use their own HOME meanwhile** | — |
| D26 | Second test pass and fidelity audit gate the move to dev | **decided (owner, 2026-11-15): yes; feature 2 reaches dev only after B1–B3, the second test pass and the feature fidelity audit** | G, the move to dev |
| D27 | Verifying PR-state fixes needs GitHub quota | the failed-lookup fix (B1.8) first; gate in a quiet hour | B1.8, B3.9, B3.10, B4.10 checks |
| D28 | Owner of the findings.md workflow picker row (B7.3 comes after dev) | re-own it to B7.3; the row stays open with that owner | G.3 |

---

## 4b. Wave 3 inputs
These are the outcomes of this plan and the findings that wave 3 must take in. Until wave 3 ships, each place keeps B1.2's not-live row ("Not in Stillhet yet: turn Stillhet off from the top-bar switch to use it", D6/D23, decided).

**Slice 11: Requirements**
- **Missing classic parts:** product brief, Files, Code look, Start before Ready, weekly spend, model picker, New feature. Ids: F-a2-18 (RQ-03), D2, B8.7.
- **Canvas on a not-live page:** Requirements uses the same canvas as other pages (D17, BG-2). This builds on B6.1 and B6.2.
- **Not-live rows replaced:** Requirements' "Not in Stillhet yet" state and its gate baseline row (A1) are removed when slice 11 ships.

**Slice 12: Settings**
- **Spec:** the a7b "Wave 3 checklist" (`a7b-settings-pagemap.md`), row by row. Every sample or missing row becomes live against the classic key it names, with classic's real value as the expected value on instance A.
- **Labs:** wire it for real through `PATCH /api/flags`. B1.3 disables it until then (D22, decided). Fix the wrong flag set, the "Locked" Run telemetry, and the missing `rail`/`design` rows (F-7b-01, F-7b-06).
- **Notifications:** wire Badge, Sound, Breathing and Updates to the saved setting (`chat.notify`). B1.3 disables them until then (F-7b-02, D22).
- **Plugins management:** install, update, remove. Ids: F-5-01 = F-7b-11, F-5-07, F-5-17, D10, B8.4.
- **Setup assistant:** reads `/api/config`, `/api/providers`, `/api/proxy/*`, and Apply works (F-5-02 = F-7b-12, OB-03).
- **Spending and caps:** `/api/budget`, `totalCostLimitUsd`, `pipelineCostLimitUsd`, `costLimitResetPeriod`, `humanRateUsdPerHour`, Usage, Team caps. Ids: F-7b-04. The Pulse cap is removed in B1.1.
- **Sign-ins and models:** Models sign-ins and the catalogue, Roles (`modelRoles`), Engine (`runEngine`), Step models (`stepModels`). Ids: F-7b-08.
- **Away:** hours, runs, decisions, priorities, model, limits, review loops, exceptions (`nightMode*`). Ids: F-7b-13.
- **Machine:** capacity (`runLimits.maxConcurrentRuns`), test workers, archive, checkouts, editor and terminal (`actions.*`), ports, proxy, login, bypass, timeouts (`networkWait`), offline. Ids: F-7b-13.
- **Team policy:** the real policy and Copy for PR (F-7b-05).
- **Labels and Cost tags:** `/api/labels`, `tagDimensions`, `enforceTags`, `/api/tags`. Ids: F-7b-10 (KF-28).
- **Presets:** `/api/presets` (F-7b-10).
- **Guardrails, Memory, Connectors:** F-7b-10.
- **Starting and Limits:** Naming (`smartNaming`), Sync, Pull requests (`autoGeneratePrDescription`), Schedules, Paused runs (`resumeAfterUsageLimit`). The Warning line, Manual starts and Automatic starts have no classic key: decide in slice 12 whether to add one or drop the rows (F-7b-03, per a7b).
- **Chat history:** the real count, including on empty data (F-7b-09).
- **About:** the real version and update state, and working links (F-7b-07).
- **Scan-model picker:** F-6-04, if it lands in Settings (Models › Helper jobs › Workspace scan; a7b lists `workspaceScan` as missing). Otherwise it stays as B7.5 on the workspace page.
- **Project and workspace tabs' home:** decide whether they sit in Settings or on their own pages (D3, F-7b-17 = F-6-06/07, F-6-21, B8.1).
- **`#design` and `#profile`:** a home or retire them (D1, F-7a-07 = F-7b-18/19, B8.2).
- **Settings field redraw:** must stay fixed. Fields must survive a draw: `pulse.js:773` rewriting `#route-settings` (B2.8) and the keep-value-and-focus rule (B2.6).
- **Canvas:** the Settings column is centred on the canvas (BG-1, B6.2).
- **Not-live rows replaced:** every row from B1.2 and B1.3 (F-7b-03, F-7b-06 … F-7b-10, F-7b-13, Labs, Notifications) is replaced, and its A1 baseline rows are removed.
- **Not in slice 12:** F-X-01, the settings location (D25, decided). It ships later as its own server PR outside these batches. Slice 12 must not assume a new location, and test instances keep their own HOME meanwhile.

**Slice 13: Onboarding**
- **Newcomer path:** Getting started (9 tiles: Connect Claude Code, Add your first project, Watch a run end to end, …), the first-run mode dialog, and Show again. Ids: F-5-03, OB-01, OB-07, OB-09, D13, B8.6.
- **Stillhet opt-in:** new users in onboarding, existing users a prompt (decided earlier). Test it with `rail` not locked (OB-08; blocked in pass 1).
- **Add project from onboarding:** opens the project, and its picker reads `/api/projects` (OB-04 = F-5-05, fixed in B3.5; OB-05 = F-5-04, fixed in B1.4). Slice 13 keeps both.
- **Not-live rows replaced:** the hidden Setup assistant and Show again from B1.1 and B1.2 come back live.

---


### Gate follow-ups (B1 combined gate, 2026-11-15)
- **B3 add:** `/api/history` rows carry the stored `pr_url`/`pr_state`, so the first paint shows the known PR state instead of "Ready · Create PR" for 10–25 s until the PR batch arrives (classic Runs has the same lag) · S · `ui/routes/history/history.mjs`, `src/core/artifacts.mjs` listAllPipelines.
- **B3 add (design call):** a stage head whose step ended blocked shows blocked, not a tick (`stagesOf` in `live/task-page.mjs` changes the head only for `ask`).
- **Gate setup:** test instances need a way to answer a live review gate (a run stopped at the gate), and Claude CLI login under their own HOME, to cover O1/O4 and real replies.
- **#1314:** wrong attribution (three people share one 229-item timeline) → fix run on #1314's branch before merge.

## 5. Timeline
| Step | Lane S (server/live) | Lane U (UI/page) | Gate |
|---|---|---|---|
| 0 | #1313 merged, #1310 merged | — | — |
| B1 (docs/rail-agreed) | B1.5, B1.8 now; B1.6 → B1.7; B1.9 (S+U) after #1313 | B1.1 → B1.2 → B1.3, B1.4 now; B1.10 last | tag, gate.real-data (own HOME, quiet hour), merge one at a time |
| B2 (docs/rail-agreed) | B2.3, B2.5 (S+U), B2.9 (S+U) | B2.1 first; B2.2 → B2.5; B2.4; B2.6 → B2.7 → B2.8; B2.10 | gate plus the budgets |
| B3 (docs/rail-agreed) | B3.1 → B3.2 (S+U) → B3.3; B3.4, B3.5, B3.8, B3.9, B3.10 | B3.6, B3.7 | gate |
| G | — | P11 second pass, fidelity audit, findings.md rows | → **feature 2 to dev** |
| B4 (dev) | B4.1, B4.2 (S+U), B4.6 (S+U), B4.7, B4.8, B4.9 (S+U), B4.10 | B4.3, B4.4, B4.5 | gate |
| B5 (dev) | B5.1 (S+U), B5.10 (S+U) | B5.2, B5.3, B5.5–B5.9; B5.4 (C) | gate, style-diff, classic re-checks |
| B6 (dev) | B6.3, B6.7, B6.10 | B6.1 → B6.2, B6.4, B6.5, B6.8, B6.9; B6.6 (C) | gate |
| B7 (dev) | B7.6 per D25 | B7.1–B7.5 per design | gate |
| B8 (dev) | per decision | per decision | gate |

- **Within a batch:** fixes that share a file follow the order given in their batch. The rest run side by side within their lane, limited by machine load. An S+U PR holds both lanes.
- **Merging:**
  - One PR at a time, each rebased on the one before.
  - Ledger files are resolved as unions.
  - B1.10 goes last in B1.
- **Running ahead:** some design work can start during B1–B2 (Shaper, docs and prototype only):
  - B1.2's not-live row
  - B2.6's rule
  - B3.2's Link a remote
  - B4.4's filters
  - B6.1
  - B7 and B8

  Ask decisions D1–D28 together at the start.
- **Feature 2 to dev:** once #1313 and #1310 are merged, B1–B3 have each passed gate.real-data, and step G is done. That covers every critical row in FINDINGS §2, wrong PR actions, the redraw storm and the wrong data. B4–B8 follow on dev in the same way.
