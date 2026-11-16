# Build order

**Design system first, then places, with acceptance tests per step, split so that parallel agents never touch the same
files. Ledgers live one file per place or are generated, so they never conflict.**

The build is 36 steps in six waves. A step is one agent run on its own branch. "Fresh" is not "from nothing": each step
says whether today's code is reused, adapted or rewritten ([stillhet-features.md](stillhet-features.md) holds the
verdicts and what must not be built twice). The checks a step owes are the cells of [gate.md](gate.md).

## 1. The rules of the build

| # | Rule | From |
|---|---|---|
| R1 | One change is one run on its own branch (`feat/stillhet-bN-…`), merged into the integration branch; the owner names that branch | lesson 25 |
| R2 | A run touches only the files of its step, as listed in the file map; a need outside them is a note in its place file, never an edit | lesson 25 |
| R3 | A shared file has one owner step, or one lane that runs one step at a time; it is frozen to everyone else | lesson 25, the ledger rule of the first build |
| R4 | No file is appended to by two parallel runs: a ledger is one file per area, or a report a tool generates | lessons 25, 26 |
| R5 | Server before page: a page names only routes and fields that exist; a missing one is a server step first | lesson 24, [server.md](server.md) |
| R6 | The library before the page that needs it: rule, catalog entry, component, test, gallery example, in one library run | `build.teach`, `gate.new-code` |
| R7 | A run executes only the tests of the files it touched (`node tools/test.mjs --related` or named files), never the full suite or a page gate | lesson 29 |
| R8 | The full suite and the gate run once per batch, outside runs, on a quiet machine; at most four runs are open at once | lesson 29, the owner |
| R9 | Nothing is pushed or merged without the owner's yes; a tick names the test or the gate step that proves it | lesson 31, the owner |
| R10 | After every step the app with the flag off is classic, exactly; a step that cannot show it does not merge | lesson 32, `gate.flag-off` |

## 2. The file map: who owns what

Four lanes. **L** (library), **S** (server) and **G** (gate tooling) each run **one step at a time**, so their shared
files never meet. **P** (places) runs up to four steps side by side, because each owns its own files. A page step never
edits a file of L, S or G: a page only composes the library.

| Area | Files | Owner | Everyone else |
|---|---|---|---|
| A component | `ui/public/design-system/components/<name>.mjs` and its cases in `test/design-system-*.test.mjs` | L: B3, B4, B5, then one library run at a time | Calls it; never edits it |
| What every component shares | `components/index.mjs`, `docs/design-system-catalog.json`, `docs/stillhet/*.md` (all but `gate.md`), `plans/stillhet/prototype/*.html` | L | Frozen |
| The look | `ui/public/stillhet/css/stillhet-look.css` (tokens, type roles), `css/stillhet.css`, `css/access.css`, `css/places.css` | L | Frozen. A place adds a rule in **its own stylesheet** (the rows below), with tokens only |
| Classic's design-system styles | `ui/public/design-system/*.css` (part of classic's `/style.css` through `ui/public/parts.json`) | Nobody. A change is a classic change: its own L run with the flag-off style diff | Frozen (lesson 32) |
| The loader and the seam | `ui/public/stillhet/boot.js`, `shell.html`, `host-app.js`, `host-prototype.js`, `adapter.js` | B10, once | Frozen. B10 lists every file of this map in `boot.js` and creates the missing ones empty, so no later step edits the loader |
| The shell | `shell/frame.js`, `shell.js`, `world.js`, `drafts.js`, `old-addresses.js`, `shell/shell.css`, `live/live-adapter.mjs`, `live/live-map.mjs`, `live/model-shape.mjs`, `demo/shell.js` | B10 | Reads the one store; never writes these |
| Pulse, the profile menu, the search | `pulse/pulse.js`, `pulse-model.js`, `pulse/pulse.css`, `shell/account.js`, `shell/search.js`, `live/pulse-live.mjs`, `demo/pulse.js` | B11 | |
| Chat: the bar and the thread | `chat/chats-column.js`, `chats-model.js`, `conversation.js`, `live/chat-live.mjs`, `demo/chat.js` | B12 (the split), then B14 | |
| Chat: the composer | `chat/composer.js`, `voice.mjs`, `prompt-check.mjs` | B15 | |
| Chat: the cards | `chat/cards.js`, `live/chat-turns.mjs`, `live/chat-cards-live.mjs` | B16 | |
| New task | `chat/new-task.js`, `centers/forms.css`, `live/run-options-live.mjs` | B17 | B15 reads the options, never edits them |
| A task's page, the group page | `runs/run-page.js`, `run-page-model.js`, `runs/task.css`, `live/task-live.mjs`, `task-page.mjs`, `terminal-live.mjs`, `demo/task.js` | B18 | |
| Tasks | `runs/runs-list.js`, `runs-model.js`, `runs/tasks-home.js` | B13 (the home), then B19 | |
| Schedules, New schedule | `schedules/schedules.js`, `schedules-model.js`, `schedules-home.js`, `schedule-form.js`, `live/schedule-live.mjs`, `schedule-rule.mjs`, `demo/schedules.js` | B13, then B20 | |
| A project's page | `projects/projects.js`, `projects-home.js`, `projects/projects.css`, `live/projects-live.mjs`, `projects-map.mjs`, `demo/projects.js` | B13, then B22 | |
| Add a project, workspaces | `projects/project-add.js`, `workspaces/workspaces.js` | B23 | |
| Workflows | `workflows/**`, `graph/**`, `live/workflow-live.mjs`, `workflow-map.mjs`, `workflow-draft.mjs`, `demo/workflows.js` | B24 | |
| Marketplace | `marketplace/**`, `live/market-live.mjs`, `market-map.mjs`, `demo/marketplace.js` | B25 | |
| Insights | `insights/**`, `live/insights-live.mjs`, `insights-map.mjs`, `work-map.mjs`, `demo/insights.js` | B26 | |
| Settings: the frame | `settings/settings.js`, `settings-model.js` (the list of tabs only, after the split), `settings/settings.css`, `settings/tabs/appearance.js`, `demo/settings.js` | B28 | |
| Settings: a tab | `settings/tabs/<tab>.js`, one file per tab | B29 to B32, by group | |
| Requirements | `requirements/requirements.js` | Nobody: Later ([gaps.md](gaps.md)); B10 draws its "Not in Stillhet yet" line | |
| The old homes and the demo switch | `centers/centers.js`, `demo/demo-actions.js` | B13 deletes the first; B10 splits the second into the `demo/<area>.js` files above | |
| The schema | `src/core/db.mjs` | B6 only: it adds **every** v98 column of [server.md](server.md) in one migration (S2, S5, S19, S20, S21) | Later S steps write the columns; none edits the migration |
| Server routes and logic | `ui/server.mjs`, `ui/routes/**`, `src/**`, and the server tests each S row names | S: the step of its S row | Frozen to L, G and P |
| Classic's surfaces list | `plans/stillhet/spec/dev-surfaces.md` (today's `## Dev surfaces` rows) | S (a new Settings key needs its row) | |
| The gate's tools | `tools/stillhet-*.mjs`, `tools/classic-inventory.mjs`, `tools/prototype-pr-check.mjs`, `tools/test*.mjs`, `plans/stillhet/prototype/gates/**`, `test/fixtures/stillhet-*`, `test/helpers/stillhet-host.mjs`, `stillhet-server.mjs`, `stillhet-live-fixture.mjs`, `stillhet-perf.mjs`, `package.json`, `.gitignore`, `docs/stillhet/gate.md` | G: B2, then one G run at a time | Frozen. A run that edits `package.json` or the runner makes `--related` fall back to the full suite |
| A page's tests | `test/stillhet-<area>-*.test.mjs`, `test/helpers/stillhet-<area>-host.mjs`, `test/fixtures/stillhet-perf-budgets/<area>.json` | The step that owns the files they test | |
| The spec | `plans/stillhet/spec/*.md` | The spec's owner, between batches | Read only during a batch |
| A place file | `plans/stillhet/spec/places/<area>.md` | The step of that area; the batch close between batches | |
| Classic's pages | `ui/public/**` outside `stillhet/` and `design-system/` | Nobody | Never touched (R10) |
| Generated | `ui/public/stillhet/components.js`, `graph.js`, `app.css`, everything under `out/` | Their tools | Never tracked (lesson 26) |

**The catalog: one lane, not one file per component.** The choice was between splitting
`docs/design-system-catalog.json` into a file per component merged by a generator, and giving it one owner. One owner
wins: the prototype is already drawn from the library, so the build adds few components; the catalog, `index.mjs`, the
rules and the gallery must change together anyway (`gate.docs`); and a generator would be one more tool, with its own
test, for a file that then changes a few times per batch. So a page step that finds a need writes it under "Needs from
the library" in its place file and stops on that part; the next L run delivers it whole (R6). At most one L run is open.

## 3. The ledgers

The first build's shared files (`findings.md`, `stillhet-wiring.md`, `test-results/PLAN.md`, the baselines) are replaced by:

| Ledger | Lives in | Written by | Read by | A step must |
|---|---|---|---|---|
| Wiring: what each control sends | The rows are the spec's: [wiring.md](wiring.md), one list per place. Their state is in `spec/places/<area>.md`: per row id, `wired`, `not offered` (with the reason) or `later`, and **Proven by** (a test file or a gate cell) | The area's step | `tools/stillhet-wiring.mjs` and `test/stillhet-wiring.test.mjs` (every action in the area's files has a row; every `wired` row names its proof); the walk lists of [gate.md](gate.md) | Set the state and the proof of every row it built; add no row (a missing row is a spec change) |
| Findings | "Open findings" in the same place file: id, one line, severity, the gate cell that found it. A walk writes what it finds to `out/stillhet-walk/<batch>/<area>.md` (ignored); the batch close copies what stays open | The batch close, between batches; the step that fixes one removes it | `test/stillhet-findings-ledger.test.mjs` (the row shape, per file) | Close a finding by naming the test that now holds it |
| Needs from the library | A section of the same place file | The area's step | The next L run | Stop on that part; never build it in the page |
| Coverage of classic | Generated: `tools/classic-inventory.mjs` writes `out/stillhet-coverage/` (the controls and the readable report). It reads `dev`, [gaps.md](gaps.md) (Drop and Later), `wiring.md` and the place files | The tool | `test/stillhet-coverage.test.mjs` | Nothing by hand |
| The no-demo list | None: the count is zero. `tools/stillhet-no-demo.mjs` fails any demo branch or demo answer outside `demo/` and `adapter.js` | Nobody | `test/stillhet-no-demo-on-live.test.mjs` | Keep it at zero (lesson 1) |
| Ratchets (library gate, surfaces, coverage) | `test/fixtures/stillhet-*-baseline.json` | The batch close only (`--update`) | Their tests: a count above its baseline fails, a count below it passes and is printed | Never edit a baseline in a run |
| Performance budgets | `test/fixtures/stillhet-perf-budgets/<area>.json` | The area's step; a value only goes down | `test/stillhet-perf-budgets*.test.mjs` | Add its budgets with its first page |
| A batch's record | `plans/stillhet/spec/batches/batch-N.md`: the steps, the gate cells with their evidence files, what stayed open | The batch close, once | The owner's review | Nothing |

Moving the tools to these files is step B2. Until B2 merges, no page step starts.

## 4. The steps

**What every page step owes** (called "the set" below): unit tests for each file it touched; one **contract test** per
live source (`test/stillhet-contract-<source>.test.mjs`: the source's count equals the API's on a store larger than one
page, and it reads empty and failed); one **keyboard test** (`test/stillhet-keys-<area>.test.mjs`: every control is
reached by Tab, Escape returns focus to its trigger); its **performance budget** (an idle page makes 0 mutations, a
frame that changes nothing makes 0 draws); no demo branch; every row of its list in [wiring.md](wiring.md) set and
proven in its place file; and the gate cells **G1, G2, G3·B, G3·D, G4, G5** of [gate.md](gate.md). A server step owes
its proving tests ([server.md](server.md)) and **G1, G2, G3·A, G3·C** for every route classic shares. "With" lists the
steps that may be open at the same time; with the lanes that is never more than four.

### Wave 0: before any page

| Step | Delivers | Owns | After | With | Server | Acceptance, beyond the set | Today's code |
|---|---|---|---|---|---|---|---|
| B1 (S) | The integration branch, with every addition of "Already on this branch" in [server.md](server.md) present | Nothing new; a fix only where a named test fails | — | B2, B3 | The bring-along table | Each test that table names passes, by name; `test/stillhet-flag-off.test.mjs` | **Reuse** |
| B2 (G) | The gate's tools on the new ledgers: the place files, generated coverage, no-demo at zero, ratchets that pass under their baseline, budgets per area, `test/stillhet-out-untracked.test.mjs`, the walk-list tool (`tools/stillhet-walk.mjs`), the instance tool's key rewrite and `clean`, the two new look checks (no control moves, corners) | The gate's tools | — | B1, B3 | S31 | The tests of each tool; `test/stillhet-gate-instances*.test.mjs`; a tracked file under `out/` fails | **Adapt** the tools; the old ledgers go |
| B3 (L) | The words at their source: "run" as a noun is "task" in the library's words; the walker `rewordIn` is deleted from `shell/shell.js` (the one line B3 may touch there) | The library's word files | — | B1, B2 | — | A new test: chat turns, Prose and titles pass through every draw unchanged (lesson 4); `test/design-system-logic.test.mjs` | **Adapt** |
| B4 (L) | The library pass, the look: the type scale and Text size tokens, a visible border on every acting control, a note at body size, clamp with tooltip, corners from tokens | The look and the components it touches | B3 | B2, an S step | — | `test/stillhet-library-gate.test.mjs` fails a borderless button and a font size off the roles; each gallery example drawn with its longest real value at 390 (lessons 8, 9, 11, 12) | **Reuse**, corrected |
| B5 (L) | The library pass, behaviour: one `plural()`; the FilterRow (tabs with counts, labelled pickers); one Dialog with a full backdrop; Menu, Dialog and the confirm strip own Escape, focus and shortcuts; arrows in radio groups; no control twice; **the place-by-mode table** (`components/places.mjs`) | The components it touches, `index.mjs`, the catalog | B4 | B2, an S step | — | One keyboard test per component; a test that two controls with one label in one menu fail; `test/stillhet-docs.test.mjs` (lessons 7, 10, 14, 23, 28, 33) | **Reuse**, extended |
| B6 (S) | Tasks and history: the v98 migration (all columns), the stored PR verdict, the workflow as columns, one id per task, a gone branch reads as no diff | `src/core/db.mjs`, `src/core/artifacts.mjs`, `ui/routes/history/`, `ui/routes/runs/`, the pause and frame code in `ui/server.mjs` | B1 | B2, an L step | S1, S2, S3, S7 | `test/db-migrate-v98`, `test/history-api-stored-pr`, `test/history-api`, `test/server-pause-resume`, `test/ws-run-pipeline-frame` | **Adapt** the branch's additions |
| B7 (S) | One list of what needs you from the server; updates for more than schedules; updates for one schedule | A new route in `ui/routes/shell/`, `src/shared/needs-you.mjs` (the rule, unchanged), `src/core/notifications.mjs` | B6 | An L step, a G step | S27, S28, S13 | `test/api-needs-you`, `test/needs-you`, `test/api-notifications`, `test/api-schedules` | **Reuse** the rule; build the route |
| B8 (S) | Chat, workflows and schedules: a settled card answers with its block; a proposal carries the composer's picks; a conditional workflow save; Run now on a card-made series | `ui/routes/chat/`, `ui/routes/workflows/`, `fireTicket` in `ui/server.mjs` | B7 | An L step, a G step | S9, S10, S11, S12 | `test/ask-api-cards`, `test/api-workflows-graph`, `test/api-schedules` | **Adapt** |
| B9 (S) | Settings keys and frames: the limit rules, what reaches you per group, Text size, project frames that name their project | `ui/routes/settings/`, `src/core/settings.mjs`, `src/core/stillhet-shell.mjs`, the three frames in `ui/server.mjs`, `spec/dev-surfaces.md` | B8 | An L step, a G step | S24, S25, S26, S14 | `test/settings-api`, `test/chat-notifier`, `test/stillhet-shell`, `test/ws-project-frames`, `test/stillhet-surfaces.test.mjs` | Build |

### Wave 1: the shell and Chat, where work starts

| Step | Delivers | Owns | After | With | Server | Acceptance, beyond the set | Today's code |
|---|---|---|---|---|---|---|---|
| B10 (P) | The shell: the loader with every file; the place button with counts from the one list; the mock word; one hand-over function; In view; old addresses; skip to content; the locks and the "Not in Stillhet yet" lines read from the place table | The loader and the seam, the shell | B5, B7 | B12, B13, an S step | S27 | `test/stillhet-old-addresses.test.mjs` with a row per classic route; a test that walks the place table (each place, in each mode that does not offer it, shows one line and one way on); every address opened cold (lesson 21); `handover-check` | **Adapt**: the places literal and the hand-over leave `shell.js`. In view needs a server row that [server.md](server.md) does not have yet: it stays per session until then |
| B11 (P) | Pulse (Now and Updates) on server read state; the profile menu with Usage and costs; the one search | Pulse, the profile menu, the search | B10 | B14, B15, B16 | S27, S28 | `test/stillhet-pulse-read-host-1` and `-2` against server read state; the badge, Now's Needs you and Tasks' Needs you tab hold the same ids on one fixture; every classic search word finds its place; `pulse-sweep` | **Rewrite** `pulse/pulse.js`; **adapt** the model and the mapping. Search beyond the first page needs a server row not in [server.md](server.md) yet |
| B12 (P) | Chat's files split, behaviour unchanged: the thread, the composer, the cards, New task each in its own file | Chat: the bar and the thread (and creates the other Chat files) | B5 | B10, B13 | — | Every existing `test/stillhet-chat-*.test.mjs` passes unchanged | **Adapt** `chat/conversation.js` (1,995 lines) |
| B13 (P) | The homes: one home file per place from the library's parts, no demo switch, no own `plural`; `centers/centers.js` deleted | The home files of Tasks, Schedules and Projects | B5 | B10, B12 | — | `test/stillhet-tasks-center-week-host.test.mjs`; every count on a home equals the rows it opens (lesson 5) | **Rewrite** `centers/centers.js` |
| B14 (P) | The chats bar and the thread: every chat beyond the first page, archived, unread in another chat, labels, tabs with counts | Chat: the bar and the thread | B10, B12 | B11, B15, B16 | — | The contract test on a store of more than one page of chats (lesson 20); two chats with one title (lesson 18) | **Adapt** |
| B15 (P) | The composer: the Workflow picker, the engine, attach a file, one Voice button, the prompt check, the handed chip | Chat: the composer | B10, B12 | B11, B14, B16 | — | `test/stillhet-chat-prompt-check*.test.mjs`; the body sent carries the chip's thing by id and nothing once it is removed | **Reuse** the prompt check and voice; **adapt** the rest |
| B16 (P) | The cards: the task card and its stage train, proposals that keep the composer's picks, the plan, questions, files, the PR card; a card that asks shows what it asks about | Chat: the cards | B8, B10, B12 | B11, B14, B15 | S9, S10, S3 | `test/stillhet-chat-proposal-options-host.test.mjs`; the body sent on Start equals what the card showed (lesson 15); draw twice keeps an open Stop confirm (lesson 17); `test/stillhet-task-card-host.test.mjs` | **Reuse** the library cards and `chat-turns`; **adapt** the drawing |
| B17 (P) | New task as a form of labelled fields, opened from Chat's starters only: presets, a ticket source, sync, guardrails once, PR choices, human in the loop, no memory, mock on a mock instance | New task | B15 | B18, B19, B20 | — | The body of `POST /api/run` equals the fields shown; the prompt check in the dialog (a new host test); no control moves when another's value changes (lesson 7) | **Adapt** `run-options-live.mjs`; the form is new |

### Wave 2: the views to inspect

| Step | Delivers | Owns | After | With | Server | Acceptance, beyond the set | Today's code |
|---|---|---|---|---|---|---|---|
| B18 (P) | A task's page and the group page: one id, the stage train, the diff side by side, the PR part, a moved base, away decisions, the launchers; "Started from the chat NAME"; no composer | A task's page | B6, B16 | B17, B19, B20 | S1, S3, S6, S7, S8 | `test/run-page-model.test.mjs`, `test/stillhet-task-live.test.mjs`, `test/stillhet-task-page.test.mjs`; Pause and Stop by the task's one id (lesson 19); `run-page-sweep` | **Reuse** the library and the model; **adapt** the live code |
| B19 (P) | Tasks: tabs with counts (Needs you, Running, Pull requests, All), labelled pickers, rows with project and state, a row opens the task's page and the bar keeps its filters; Whose; restore. No + and no form | Tasks | B13, B6 | B17, B18, B20 | S1, S2, S4 | Every tab's count equals its rows; a filter set by a link applies to that visit and offers Clear; `test/stillhet-live-counts-1` to `-3` | **Adapt** |
| B20 (P) | Schedules: a schedule's page with its prompt, workflow and updates; New schedule as labelled fields from Chat, with Once and a date; edit as a draft. No + on the list | Schedules, New schedule | B13, B8 | B17, B18, B19 | S12, S13 | `test/stillhet-schedules-drafts-host.test.mjs`; a cold reload of a schedule's address never says "no schedule" before the read answers (lesson 21) | **Reuse** the drafts and `schedule-live`; the form is new |
| B21 (S) | Whose tasks; who continued past a cap, as a record; a round keeps its setup; a group ship's refusal names what was pushed | `ui/routes/history/`, `ui/routes/runs/`, `src/core/cost-budget.mjs`, a new people route | B9 | Up to three P steps | S4, S5, S6, S8 | `test/api-people`, `test/api-team-tasks`, `test/budget-api`, `test/restart-build-api`, `test/api-run-groups` | Build |

### Wave 3: the places

| Step | Delivers | Owns | After | With | Server | Acceptance, beyond the set | Today's code |
|---|---|---|---|---|---|---|---|
| B22 (P) | A project's page as tabs: Settings, Memory, Sets, Actions, Automations, Readiness, Team; live frames | A project's page | B13, B9 | B24, B25, B26 | S14 | `test/stillhet-projects-*.test.mjs`; a Recheck in one tab shows in another | **Adapt** |
| B23 (P) | Add a project (one folder, a new folder, several, the browser, clone); a workspace's page | Add a project, workspaces | B22 | B24, B25, B26 | — | `test/stillhet-gateg-places.test.mjs`; a workspace address opened cold | **Adapt** |
| B24 (P) | Workflows: tabs with counts, the story in plain words, Edit as a draft in the graph editor, the conditional save | Workflows | B10, B8 | B22, B25, B26 | S11 | `test/stillhet-workflow-draft.test.mjs`, `test/stillhet-workflows-copy-draft.test.mjs`, `test/stillhet-workflows-host-page.test.mjs`; a save against a workflow changed since is refused and the draft kept; two steps of one name (lesson 18) | **Reuse**. The story's own words wait for a server row not in [server.md](server.md) yet |
| B25 (P) | Marketplace: Installed and Not installed tabs, a plugin's own page with all its settings, a chat channel's form | Marketplace | B10 | B22, B24, B26 | — | `test/stillhet-marketplace-*.test.mjs`; the channel form's body equals `PUT /api/plugins/:name/config` | **Reuse** the slots; build the plugin page |
| B26 (P) | Insights: your pages and the team pages on one day rule, totals that equal their rows, a row that cannot open not drawn as one; a measure's page only once its server row exists | Insights | B10, B27 for the measures | B22, B24, B25 | S15, S22, then S16 to S21 | `test/stillhet-insights-host-1` and `-2`; every total equals the sum of its rows on the seeded store | **Reuse** |
| B27 (S) | Stats and history count the same tasks; one day rule; the six measures as one change | `src/core/stats.mjs`, `ui/routes/statistics/`, `ui/routes/team-metrics/`, the writers of the v98 columns | B21 | Three P steps | S15 to S22 | `test/stats-api`, `test/team-metrics-api`, `test/stats-rework`, `-review`, `-autonomy`, `-cache`, `-merge`, `-waiting` | Build |

### Wave 4: Settings, tab by tab

| Step | Delivers | Owns | After | With | Server | Acceptance, beyond the set | Today's code |
|---|---|---|---|---|---|---|---|
| B28 (P) | The frame: one file per tab, the menu by mode from the place table, the search index, the not-live row, section heads that lead; **Appearance** with Text size | Settings: the frame | B10, B9 | Three P steps of wave 3 | S26 | `test/stillhet-settings-not-live-rows.test.mjs`; `settings-sentences`; no sample value on a live page (lesson 2); `ds-check` at Large at 390 | **Adapt** `settings-model.js` (1,024 lines, sample rows inside) |
| B29 (P) | Work: Tasks (limits, task limits), Presets, Labels, Automations | `settings/tabs/runs.js`, `presets.js`, `labels.js`, `automations.js` | B28 | B30, B31, B32 | S24 | Each key round-trips: the body sent, then the value read back from `GET /api/settings` | **Adapt** |
| B30 (P) | AI: Models (sign-ins, providers, helper models, keys), Chat, Memory | `settings/tabs/models.js`, `ask.js`, `memory.js` | B28 | B29, B31, B32 | — | A sign-in row opens its settings; "providers" and "import models" are found by the search | **Adapt** |
| B31 (P) | Access and Add-ons: Team policy (read in Advanced, changed in Expert), Guardrails, Plugins, Connectors | `settings/tabs/team.js`, `guardrails.js`, `plugins.js`, `connectors.js` | B28 | B29, B30, B32 | — | Team policy's edits are off below Expert and each says why (`set.read-level`) | **Adapt** |
| B32 (P) | Worca: General (the setup assistant, version and updates, ticket sources), Notifications per group, Labs | `settings/tabs/general.js`, `notifications.js`, `experimental.js` | B28 | B29, B30, B31 | S25 | `test/stillhet-settings-prompt-check.test.mjs`; an event muted for chat is not sent | **Adapt**; Labs is **reuse** |

### Wave 5: limits, onboarding and the switch, last

| Step | Delivers | Owns | After | With | Server | Acceptance, beyond the set | Today's code |
|---|---|---|---|---|---|---|---|
| B33 (S) | Usage windows beyond Claude; usage events; what a start does near a limit | `src/core/usage-limits.mjs`, `src/core/scheduler.mjs`, `ui/routes/runs/drain-and-budget.mjs`, `ui/public/engine-locks.mjs` moved to `src/shared/` | B27 | Up to three Settings steps | S23, S29, E6, E7, E8 | `test/usage-limits`, `test/usage-events`, `test/usage-room`, `test/api-run-start-after-reset`, `test/scheduler-near-limit` | Build, server first |
| B34 (P) | The rings, Pulse's Limits group and the note in New task and Resume | An L run for the note's component first; then a new `shell/limits.js` (in the loader from B10), whose one function B11 and B17 call from the start and which draws nothing until this step | B33, B11, B17 | B35 | S23, S29, E6, E7 | A harness under the line draws no note; the note's buttons send what they say; a harness with no reading draws an empty track | **Reuse** the library's rings; the note is new |
| B35 (P) | Getting started with its step count, the team-setup notice, sign in again; the first run on an empty install | A new `shell/onboarding.js` (listed in the loader by B10) | B17, B32 | B34 | — | The walk of gate cell G3·D from a first open to a first task | **Adapt** |
| B36 (P) | The switch and the opt-in: `STILLHET_ASK_ON` turns true, the invitation and the way back | `src/core/stillhet.mjs` (the one constant), nothing else | Every step above | — | — | `test/design-system-stillhet-switch.test.mjs`, `test/design-system-invitation.test.mjs`, `test/stillhet-flag-off.test.mjs`; the flag-off style diff shows only the accepted Labs row; the personas' walk | **Reuse**: complete and tested |

**Later, outside this build:** Requirements, the Design page, Pinpoint, writing agents and scripts, labels admin, a
workspace's settings, smart naming, the Team metrics timeline ([gaps.md](gaps.md), Later). Until each is designed its
place says "Not in Stillhet yet" and opens classic's page. S30 (settings under `WORCA_HOME`) is its own server change;
the instance tool's own HOME holds until then.

## 5. A batch, and done

**A batch** is 5 to 10 steps or fixes, picked by priority, that can be reviewed together. It closes in this order, and
only the batch close does these, outside any run:

1. Every step's run is finished and its own tests pass (R7).
2. The steps are merged into the batch's branch, one after the other; the file map means no merge needs a hand.
3. The full suite, once, on a quiet machine (about 30 minutes; its own lock). A base that was already red is listed by file first: the batch is clean when it adds no failure.
4. The gate of [gate.md](gate.md), steps 1 to 6, for the places the batch touched and the standing list.
5. The ratchets are lowered (`--update`), the place files take the open findings, `batches/batch-N.md` is written.
6. The owner's review, then the owner's yes. Only then the batch merges into the integration branch. A fix found by the gate is a fix in the next batch, unless it is critical: then the batch waits.

A fix batch after the waves follows the same rules: each fix is one run, on the files of one area.

**The whole build is done when:**

- every **Must** row of [gaps.md](gaps.md) is `wired` in a place file with its proof, and every Later row says where classic does it;
- the coverage report has no control without a home: each is offered, Later with its place, or dropped by a written decision;
- with the flag off the app is classic: the golden page test, the style diff at 0 differences but the accepted row, and the classic walk on instances A and C;
- the six personas of [assessment.md](assessment.md) walk the live app on real data (instance B) and an empty install (D), and what they find is fixed or answered;
- no finding of severity critical or major is open in any place file.
