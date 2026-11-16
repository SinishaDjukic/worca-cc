# Wiring

For every place: what it reads, what a person can do there, the route and payload behind it, and the test that proves it.

- **A row is one function a person needs**, not one button. Its route and field names are quoted from today's code (`ui/public/stillhet/live/*.mjs`, page code where the call still sits there, and classic's `ui/routes/**`, `ui/server.mjs`).
- **A row may only name a route or a field that exists.** One that is missing cites its id in [server.md](server.md) (S1 to S36, E1 to E9) and never restates the contract; until that lands the control is drawn disabled with its reason (`gate.controls`).
- **One id per thing, matched by id.** A task is its pipeline id (S3); a chat its thread id; a schedule its ticket or series id; a project its key; a workflow its `wf_` id; a plugin its name. Nothing is matched by title, label or position ([lessons.md](lessons.md) 18, 19).
- **Every read draws three states** besides its rows: empty (one line that says why and what to do), long (what "many" does), failed ("Could not …" with Try again; the last good rows stay).
- **Status:** `wired today` (the live code calls it and a test file names its route; where none does, the Proving test column says "test to write: NAME") · `call exists, control changed` (the call is there; the redesign moved or reshaped its control) · `to wire` (classic has the route; Stillhet never called it) · `server first: S#` · `later` · `dropped` (as [gaps.md](gaps.md) marks it).
- **Verdict** on today's live code per place: **reuse** (meets this spec), **adapt** (keep the file, change the named parts), **rewrite**. The lesson numbers that force it are named.
- **Tests:** a name without a path is `test/stillhet-NAME.test.mjs`; `new:` is a test to write. The files exist; they were not run while writing this file, and the redesign reports name some that still hold the old controls.

## The contract every place follows

| Part | The rule | Holds it today | Test |
|---|---|---|---|
| The adapter | One live adapter does all I/O: the GET of each source in `SOURCES`, one socket (`/ws`), and one slice per place (`chat`, `task`, `workflow`, `schedule`, `market`, `projects`, `insights`, `runOptions`). A page calls its slice (`act(id, args)`, reads) and never `fetch` | `live/live-adapter.mjs` `startLive`; `SOURCES`; the `*_ACTIONS` tables (id → words, args → method, url, body) | `live-adapter`, `import-guard` |
| The model shape | Both adapters fill one shape per kind (`task`, `group`, `chat`, `schedule`, `project`, `costs`, `space`, `update`, `workflow`, `agent`, `script`, `plugin`, `market`, `insight`; chat turns by `t`; the task page). A mapper keeps no field outside it; a fact the server cannot fill is empty, never sample | `live/model-shape.mjs` (`SHAPES`, `TURN_SHAPES`, `TASK_PAGE_SHAPE`), `live/live-map.mjs` | `model-shape`, `live-map`, `live-map-detail` |
| No demo branch in a page | A page has no `LIVE` test. Today the page files still branch (conversation.js 97 sites, centers.js 48, pulse.js 45, insights.js 27, projects.js 24, workflows.js 21, marketplace.js 19, schedules.js 16, runs-list.js 13, …): the build moves each into its adapter slice. Baseline zero (lesson 1) | page code under `ui/public/stillhet/` | `no-demo-on-live`, `settings-live-no-demo` (fail today) |
| What a demo adapter may hold | Rows and answers in the same shapes, one store per fact (`build.one-mock`), a wait where the live call waits. No control exists only in the demo: what has no live source is `R.notInStillhet` in both kinds | `shell/world.js`, each place's `*-model.js` | `seed-*`, `demo-actions` |
| Live frames | A frame changes only its own part: a run frame (`run-created`, `run-pipeline`, `state`, `question`, `question-resolved`, `done`, `error`, `title`) moves one task; a `*-changed` frame re-reads only its sources (`CHANGED`), debounced 250 ms; `pipelines-changed` with a `pipelineId` reads one row (`GET /api/history/:key/:id?row=1`); `history-pr` items patch `pr` on rows only when the PR differs | `live-adapter.mjs` `apply`, `refreshRun`, `onPrs` | `live-adapter-run-read`, `live-adapter-pr-frame-host` |
| How a page patches | The store's writers (`load`, `move`, `add`, `setState`) notify by part; a page patches the part that changed and keeps open menus, dialogs, typed text and focus (`comp.patch-parts`, `comp.keep-open`). An idle page makes 0 mutations; a frame that changes nothing makes 0 draws (lesson 16) | `shell/world.js`, `design-system/components/keep-open.mjs` | `perf-budgets`, `perf-budgets-chat-host`, `perf-budgets-tasks-host`, `keep-open-*-host`, `chat-repaint-host`, `pulse-redraw-host` |
| State by id | Confirm, form and busy state live in a store keyed by the thing's id, never on an object built per draw (lesson 17) | `chat-live.mjs` `actionRunner` (pending keys) | `tasks-refusals-host-1`, `-2`; new: draw twice, the confirm stays |
| Beyond the first page | A read follows the server to the end: `GET /api/ask/threads?show=all` by `cursor` (up to 100 pages); `GET /api/history` returns every row, `?archived=1` the archive. A list shows 50 rows and Show more; a count is the server's, never the loaded rows (lesson 20) | `live-adapter.mjs` `allThreads`, `SOURCES.archived` | `live-counts-1`, `-2`, `-3` |
| A cold address | An address opened on reload waits for its source before "not found": the page reads `loading` until the first load or the thing's own read answers (lesson 21) | `task-live.mjs` `listLoaded`, `listFailed`; `projects-live.mjs` early record | `routes`, `old-addresses`, `projects-host-gone`, `schedules-page-host` |
| Errors | One sentence: "Could not WORDS: REASON", the words from the action table, the reason the server's `error`. No answer: "Worca is not answering". A refusal with a code the page knows becomes a note at the control, not a toast. 401 or socket close 4001: `conn: 'session'` (sign in again); a dropped socket: `conn: 'offline'`, back-off 1 to 30 s, every source read again on `hello` | `chat-live.mjs` `actionRunner`, `refuse`; `live-adapter.mjs` `connect` | `chat-live`, `task-live`, `tasks-refusals-host-*`, `new-task-refusals-host` |
| Busy buttons | A button that waits on the server shows the knot and present-tense words (`R.button({ busy })`, `R.busyWord`) from press to answer and refuses a second press (the runner's pending key). One that acts at once shows none | `button.mjs`, `actionRunner.run` | `test/design-system-task-redesign`; new: every action id has busy words |
| Flags and modes | `hello.flags` and `flags` frames are the Labs flags; `stillhet` off reaches the host and reloads into classic. One table of place by mode feeds navigation, locks and the gate (lesson 28) | `live-adapter.mjs` `copyFlags`; `shell/shell.js` places | `flag-off`, `shell`, `surfaces` |

**Verdict on the adapter itself:** **reuse** `live-adapter.mjs`, `live-map.mjs`, `model-shape.mjs`, `work-map.mjs`. Adapt three things: the needs-you rule moves to the server (S27); project frames gain their listeners (S14); the run id stops being a key anywhere (S3, lesson 19: `task.learned`, `supersede` and the run-id fallbacks go once `run-created` names its pipeline).

## Shell and navigation

**Today's live code:** `shell/shell.js`, `shell/world.js`, `shell/old-addresses.js`, `host-app.js`, library `shell-frame.mjs`, `side-menu.mjs` · tests `shell`, `shell-parts-host`, `frame`, `routes`, `old-addresses`, `search-classic-names-host`, `test/design-system-shell-redesign` · **adapt** · the frame, routes and search are sound; the counts are computed in the browser from five reads (lesson 5) and the mock word is never read.

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| The place list, each place with its count | Today: store parts (`runs`, `chats`, `schedules`, `projects`) through `StillhetWorld.needsLabel`. Target: S27 `counts.byKind` | `needs-you-changed` (S27); until then each part's frame | A place with nothing shows no count | n/a | The list still opens; counts are left out |
| Who is signed in, mode, theme | `GET /api/whoami` `{name, source, shared}`; `GET /api/settings` `uiLevel`; the shell's `data-level` stamp | `settings-changed` | "Local" when not shared | n/a | The menu draws without the name |
| Usage rings on the avatar | `GET /api/usage-limits` `harnesses[].windows[] {kind, pct, resetsAt}` | `usage-limits-changed`; re-read each `USAGE_REFRESH_MS` while a task runs | No ring for a harness with no reading | n/a | No ring; the flyout says "Could not read the limits" |
| Mock or test instance | `hello.serverMock` (not read today) | `hello` | Nothing drawn | n/a | n/a |
| Search results | The store's parts, this page first, then other places; Settings and classic names from `old-addresses.js` `WORDS` | Each part's frame | "Nothing called X" with the places searched | 8 per place, then "All N in PLACE" | n/a (local) |
| Connection | The socket's state; `world.setState({conn})` | `hello`, close | n/a | n/a | "Offline: trying again" strip; `session`: "Sign in again" |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| See the places and go to one | `R.barPlaceHead` / `R.placeButton`: the place's name and chevron as one button; `R.placeItems` (home first, counts) | none (hash routes) | The page opens; focus on its heading | An unknown address: "No page called X" after the source answered | `test/design-system-shell-redesign`, `routes` | wired today (counts: server first: S27) |
| Open an old (classic) address | `old-addresses.js` `resolve` | none | Lands on the Stillhet place, section and row | No match: the place's home with one line | `old-addresses` | wired today |
| Search everything | Top-bar search, a combobox (`R.watchSearch`) | Places, settings, plugins and loaded rows: the browser's index (plugins by name from `GET /api/plugins`). A task by its prompt, branch or PR number, a chat by its messages, a schedule by its prompt: S33 | Enter opens the result | n/a | `search-classic-names-host`; new: finds an uninstalled plugin by name; `test/api-search` | wired today (task prompts and chat messages: server first: S33) |
| Change the interface mode | Profile menu, `R.menuItem` with its one line | `POST /api/settings {uiLevel}` | The shell redraws in the mode | "Could not change the mode"; the old mode stays | `live-counts-1` | wired today |
| Keep awake; Away | Profile menu rows | `POST /api/settings {keepAwake}`; `POST /api/settings {nightModeToggle: 'on' or 'here'}`; read `GET /api/away-mode` | The row shows the server's value | "Could not change Away" | `live-counts-2`, `live-map` | wired today (call sits in `pulse/pulse.js`: moves to the adapter) |
| Know it is a mock or test instance | One quiet word in the top bar | `hello.serverMock` | Drawn | n/a | new: `shell` reads `serverMock` | to wire |
| Team-setup notice ("the team updated the recommended setup · Review") | Profile menu row, opens Settings › General › Setup | `GET /api/setup/team` (classic); answer `POST /api/setup/apply` | The row goes once applied or dismissed | Row stays | new: `shell-team-setup-host` | to wire |
| Getting started with a step count | The Getting started row, "2 of 5 done" | `GET /api/onboarding` (status and prefs; `?recheck=1`), `POST /api/onboarding` (prefs) | The count follows the server | The row draws without a count | new: `onboarding-count-host` | to wire |
| Sign in again when the session ends | The `conn: 'session'` strip | 401 on any read; socket close code 4001 | Reload after sign-in | n/a | `live-adapter` | wired today |
| Desktop alerts | Settings › Notifications asks the browser's permission | The browser's own Notification permission, per browser (classic has no push service: server.md, Not server work) | Alerts follow S25 once built | Denied: the row says so | new: `notifications-permission-host` | to wire (what reaches you: server first: S25) |
| Start a task from any page | none | none | n/a | n/a | n/a | dropped: work starts in Chat only; Chat is one click away |
| Your level; the Profile page | none | `/api/worca-level` is not called | n/a | n/a | n/a | dropped (agreed): a game layer; the menu and Settings cover the page |
| The Design page | `R.notInStillhet`, opens classic's page | none | n/a | n/a | `gateg-places` | later (agreed) |
| Text size | Settings › Appearance (see Settings) | S26 | | | | server first: S26 |

## Chat

**Today's live code:** `live/chat-live.mjs`, `live/chat-turns.mjs`, `chat/voice.mjs`; pages `chat/conversation.js`, `chat/chats-column.js` · tests `chat-live`, `chat-live-reload`, `chat-turns`, `chat-app-host-1…5`, `chat-queue-host`, `chat-follow-host`, `chat-model-picker-host`, `chat-home-pins-host`, `chat-prose-host`, `chat-repaint-host`, `classic-extras-chat-host` · **reuse** the two live files; **adapt** the page · the thread model is classic's own reducer (`src/shared/ask-model.mjs`) and the action table is complete; `conversation.js` still holds 97 live branches and card state per draw (lessons 1, 17).

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| The chats bar: chats, groups, pinned, archived, unread | `GET /api/ask/threads?show=all` (`threads`, `cursor`, `total`, `counts`), every page; `GET /api/ask/groups`; unread from `ask-done` / `ask-error` on a chat not open | `ask-start`, `ask-done`, `ask-error`, `ask-title`, `ask-message`, `ask-groups-changed`, `ask-labels-changed` | "No chats yet" with the starters | 50 rows, Show more; counts are `counts` from the server | "Could not read the chats · Try again" |
| A chat's tasks under it | `GET /api/ask/run-links` `links` joined to tasks by pipeline id | `ask-run-status`, `pipelines-changed` | No fold | All; folded past 5 | The chat row draws without tasks |
| A conversation's turns | `GET /api/ask/threads/:id` (`thread`, `messages`, `attachments`, `runLinks`, `inFlight`); then `{type: 'subscribe', threadId}` on the socket | `ask-*` for that thread, `ask-command`, `term-*` | Chat home | Older turns load on scroll up; the timeline track lists anchors | "Could not open the chat · Try again"; a failed reply is a `failed` turn with Details and Try again |
| Models, workflows, projects, guardrails, labels, starters | `GET /api/ask/models`, `/api/workflows`, `/api/projects`, `/api/guardrails`, `/api/ask/labels`, `/api/chat-home/pins` (the chat catalog) | `workflows-changed`, `projects-changed`, `settings-changed` | A picker with one choice is plain text | Type-ahead in the picker | The picker says "Could not read the models" and keeps the chat's own |
| What a reply named (tasks, files, PRs) | `POST /api/ask/refs/resolve {refs}` | none | Plain text | Capped per call (`REFS_MAX`) | Plain text |
| A command's output | `GET /api/terminal/sessions/:id`; `term-*` frames while it runs | `term-*` | "No output" | Folded; opens in `R.terminalPane` | "Could not open the terminal" |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Start a chat and send a message | Composer (`R.composer`), Enter | `POST /api/ask/threads {}` then `POST /api/ask/threads/:id/messages {text, model?, effort?, mcpOff?, attachments?, context?}` | Your turn shows at once; the reply streams | 409 turn in flight: the message queues (up to `QUEUE_MAX` 3) and says so; other: "Could not send your message", the text stays in the composer | `chat-live`, `chat-queue-host` | wired today |
| Stop a reply | Composer's Stop | `POST …/threads/:id/stop` | The turn ends as stopped | "Could not stop the reply" | `chat-live` | wired today |
| Pick the workflow before sending | Composer's Workflow picker ("with the Default workflow"), in Ask too | Rides the message's `context` and the proposal that follows; its picks must come back on the block (S10) | The proposal shows the pick; a change is a visible row (`panel.proposal-keeps-picks`) | n/a | new: `chat-proposal-keeps-picks-host` | server first: S10 (the picker is drawn; lesson 15) |
| Switch a chat's model, effort, engine, project | Composer pickers | `PATCH …/threads/:id {model, effort}`; `POST …/threads/:id/engine {engine, model, effort, dropTurns?}`; `PATCH … {scope}` | The picker shows the server's value; a later send uses it | "Could not switch the engine"; the old one stays | `chat-model-picker-host`, `chat-app-host-2` | wired today |
| Attach a file; see and open attachments | Composer + › Add files; `R.filesCard` | Rides `attachments` on the message; open `GET …/threads/:id/attachments/:attId`; `POST …/attachments/:attId/reveal {}`; `GET /api/ask/reveal` says if reveal works here | The file is a tile on your turn | "Could not attach the file" | `classic-extras-chat-host` | wired today (gaps.md's "no attachment" was the prototype) |
| Rename, pin, archive, delete a chat | Row ⋯ (`R.menu`) | `PATCH …/threads/:id {title}` / `{pinned}` / `{archived}`; `DELETE …/threads/:id` | The row follows the frame | "Could not delete the chat" | `chat-live`, `chat-app-host-4` | wired today |
| Label a chat; filter by label | Row ⋯ › Label; the bar's Filter | `PUT …/threads/:id/labels {labels}`; `GET /api/ask/labels` | Chips follow the answer | "Could not label the chat" | `chat-app-host-3` | wired today |
| Group chats | Row ⋯ › Add to group, Move, Leave; group ⋯ | `POST /api/ask/groups {name, nameSource: 'user', threadIds}`; `POST /api/ask/groups/:id/threads {threadIds}`; `DELETE …/groups/:id/threads/:threadId`; `PATCH …/groups/:id {name, nameSource}`; `POST …/groups/:id/archive {archived}`; `DELETE …/groups/:id[?deleteChats=true]`; `POST /api/ask/groups/undo {token}` | The bar follows `ask-groups-changed`; Undo for the token's life | "Could not move the chat" | test to write: `chat-groups-host` | wired today |
| A reply landed in another chat | The unread dot on its row; cleared on open (`seen`) | `ask-done` / `ask-error` frames; no route | Dot shows, clears | n/a | `live-adapter`, `live-counts-1`; `test/ask-api-threads` | wired today (per browser; per person across devices: server first: S36) |
| Voice: speak and hands-free | One Voice button with a menu (Speak, Hands-free, Voice options) | Classic's engine (`src/shared/ask-voice.mjs`), `POST /api/speech/transcribe`, `/api/speech/synthesize` | Words land in the composer | "Could not hear you: REASON" | `voice` | call exists, control changed |
| MCP sets for this chat | Composer › Sets | `POST /api/ask/mcp-preview {threadId?, model?, mcpOff?}`; `PATCH …/threads/:id {mcpOff}` | The tick follows the answer | "Could not load the sets"; a gone chat stops asking | `chat-app-host-3`, `chat-live` | wired today |
| Pin a workflow as a starter | Chat home starter cards (`R.starterGrid`); Workflows ⋯ › Pin | `GET` / `PUT /api/chat-home/pins {pins}` | The card shows on Chat home | "Could not pin the starter" | `chat-home-pins-host` | wired today |
| Prompt check on what you type | The chip under the composer | `POST /api/prompt-check/grade`, `/improve`, `/kind-correction` | The chip says how clear it is; Improve rewrites | The chip goes quiet | `chat-prompt-check`, `-chip`, `-improve`, `-scope` | wired today |
| Plans | Reached from the task (its Plan stage) and search; no tab | `GET /api/runs/:id/plan` | The plan opens on the task | "Could not read the plan" | `task-page-stages-host` | wired today |
| Remove a chat's worktree; stop a command | The turn's ⋯ | `DELETE …/threads/:id/worktrees/:worktreeId`; `POST /api/terminal/sessions/:id/stop` | The row says removed / stopped | "Could not remove the worktree" | `chat-live`, `terminal-live` | wired today |
| Delete all chats | Settings › Chat › History, behind a confirm with the server's counts | `GET /api/ask/history` then `DELETE /api/ask/threads` | The bar empties | "Could not delete the chats" | `chat-app-host-3`, `chat-live` | wired today |
| Send a direction straight to a running task | none; a message in its chat | `POST …/threads/:id/directions {runId, text}` and `POST /api/runs/:id/directions {text}` exist in the tables | n/a | n/a | n/a | dropped: a task does not change while it runs (`nav.task-like-chat`); the two table rows are deleted |
| Pinpoint (Explain, Alternatives, Discuss, Use this) | `R.notInStillhet` | `/api/pinpoint` (classic) | | | | later |

## The task card and proposals in Chat

**Today's live code:** `live/chat-live.mjs` (`ACTIONS`, `startBodyOf`, `prBodyOf`, the card flow), `live/chat-turns.mjs` (blocks → turns), library `kind-mark.mjs` (`taskCard`, `taskProposal`, `changeProposal`, `planCard`) · tests `chat-turns`, `task-card-host`, `chat-cards-tone-host-1…4`, `chat-proposal-options-host`, `chat-persp-picker`, `seed-chat-cards` · **adapt** · the calls are right; a settled card answers 409 with no code (S9), a proposal does not carry the composer's picks (S10, lesson 15), Stop's confirm was lost per draw (lesson 17), and a card keyed by run id loses Pause and Stop (lesson 19, S3).

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| A task card: state word, stage train, the one action, what it asks | The store's task (history row or live run) by pipeline id; its stage from `state` frames (`progressOfState`); its question from `question` | Run frames; `history-pr` for the PR | n/a | Stages past 7 fold their middle; open decisions listed on the folded card | The card keeps its last state and says "Out of date" (`list: 'refresh'`) |
| A proposal's rows (Project, Workflow, Model, Starts, Then), its files | The card block of `GET /api/ask/threads/:id`; picks: S10 | `ask-message` | n/a | Files past 4: "and N more" | n/a |
| A workflow proposal's story | The block's graph through `R.workflowStory`; the plain words per step: S35 (`story`), until then the step's own name | `ask-message`; `workflows-changed` with `action: 'story'` (S35) | n/a | Scrolls inside its box | n/a |
| PR checks on a card | `GET /api/pr/checks?id=PIPELINE&…` only while its PR is known open; fresh for 60 s, 2 in flight | `history-pr` | "No checks" | Failed checks first; "and N passed" | "Could not read the checks" |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Start a proposed task | TaskProposal › Start (`R.taskProposal`) | `POST /api/run` with `startBodyOf(card, picks)`: `{prompt or source, workflowId, guardrailsId, mock: false, title?, tags?, engine?, perspectives?, extras?, projectDir or workspaceId or noProject, sourceBranch?, sourceBranchByKey?, featureBranch? or sameAsSource?, askThreadId, askCardId}` | The proposal becomes the task card | 409 `engine-refused` (resend with `allowUnguardedEngine`), 409 `sync-diverged` (resend with `syncPolicy: 'origin' or 'last-fetch'`): a note on the card; E7 near a limit | `chat-proposal-options-host`, `chat-live` | wired today (picks shown as rows: server first: S10) |
| Customise a proposal (project, workflow, engine, branches, guardrails, reviewed by) | TaskProposal › Customise: labelled fields; `perspectiveChoices` | Rides `picks` on the Start body; lists from the chat catalog and `run-options-live` | The rows show the picks | A locked choice says why | `chat-proposal-options-host`, `chat-persp-picker` | wired today |
| Set a proposal aside; start later | Not now; Start later | `POST …/threads/:id/cards/:cardId {state: 'dismissed'}` (a run) or `{state: 'declined'}` | The card folds to one line | 409 on a settled card: redraw it, say nothing (S9) | `chat-turns` | wired today |
| Apply, save, undo a change proposal (settings, workflow, agent, script) | ChangeProposal › Apply / Save workflow; receipt › Revert | `POST …/cards/:cardId {state: 'applied', scope?}`; a workflow card `{state: 'saved'}`; `{state: 'reverted'}`; other verbs `{…body}`; `{choice}` | A receipt with Revert | 409 `card is saved` today (feedback 16) | `chat-cards-tone-host-*`; `test/ask-api-cards` | server first: S9 (a saved card offers no Not now) |
| Run a proposed workflow once | Workflow proposal › Run once, beside Save | `POST /api/run` with the proposal's `workflowId` after a save | A task card follows | As Start | new: `chat-workflow-run-once-host` | to wire |
| Answer a task's question | The card's question (`R.optionList`, own words, Use Worca's picks) | `POST /api/answer {runId, id, payload}` (`payload.answers` for several) | The question leaves; the task goes on | "Could not answer the task's question"; the choice stays | `chat-app-host-3`, `task-live` | wired today |
| Approve a plan, ask for changes, fix, stop | PlanCard › Approve and build, Ask for changes, Full plan | `POST /api/runs/:id/answer {id, decision: 'approve' or 'revise' or 'stop', feedback?, source?: 'check', …picks}`; `GET /api/runs/:id/plan`; `POST /api/runs/:id/plan/save {overwrite?}` | The card moves to Build | "Could not approve the plan" | `chat-turns`, `task-page-decisions-host` | wired today |
| Accept a review as is, or run another cycle | The gate on the card: Accept as is, Run another cycle, with what the review found | `POST /api/answer {runId, id: gateId, payload: {decision: 'continue' or 'another'}}` | The card moves on | "Could not accept the review as is" | `task-page-stages-host`, `task-live` | wired today |
| Pause, resume, stop a task | Card ⋯ and its one action | `POST /api/pause {runId}`; `POST /api/resume {pipelineId, baseCheck: true, baseAck?, ignoreCostCap?}`; `POST /api/stop {runId?, pipelineId?}`; Stop asks first, at the control | The state word follows the frame | Resume: a moved base asks "Resume anyway" (`baseAck`); a cap asks with the amount (E1, E9); pause by pipeline id: S3 | `task-card-host`, `tasks-refusals-host-1` | wired today (pause by pipeline id: server first: S3) |
| Create the PR; ship a feature | Card's action Create PR; a feature's Ship | `POST /api/pr` `prBodyOf`: `{id, title, body?, draft?, watch?, baseBranch?, askThreadId?, askCardId?, projectKey or projectDir}`; `POST /api/shape/features/:id/ship {mode: 'one' or 'stacked'}`; `PUT /api/shape/features/:id/acceptance {entries}` | The card shows the PR | The refusal's words; a pushed branch is said | `task-card-host`, `chat-live` | wired today |
| Merge, re-run checks, fix checks, watch | Card's action once a PR is open | `POST /api/pr/merge`, `/api/pr/rerun-checks`, `/api/pr/fix-checks` with the task's PR scope (`prScope`); `GET` / `POST /api/pr/watch {watch, id}` | The card shows Merged / a fix round | What `/api/pr/resolve` refuses (draft, review verdict) | `task-card-host`; `test/pr-task-actions-api` | wired today |
| Retry; propose a fix task from a failed one | Card's action Retry; the failed card's "Propose a fix" | Retry: `POST /api/answer {runId, id: recoveryId, payload: {decision: 'retry'}}` or `POST /api/resume`; Restart Build: `POST /api/runs/:id/restart-build {}` (E2). Propose a fix: a message in the chat, no route | A new round on the card | 409 `NOT_STOPPED`, `NO_PLAN`, `NO_BRANCH`: not offered when it cannot work (lesson 22) | `tasks-actions-host`, `chat-app-host-5`; `test/restart-build-api` | wired today (Propose a fix: to wire; picks follow rounds: server first: S6) |
| Resume on another engine; switch model | Card ⋯ › Resume on ENGINE, Switch model… | `POST /api/resume {pipelineId, baseCheck, engine}` / `{…, model}` | The card resumes | The engine refusal | `classic-extras-task-host` | wired today |
| Follow up, run after | Card ⋯ › Start a follow-up, Run after… (moved here from the page) | `POST /api/run` with the task's setup (`newTaskBodyOf`) and the new prompt; `after: {kind, id}, afterPolicy: 'done'` | A new card in the same chat | As Start | `task-follow-up-host` | call exists, control changed |
| Open the task, its changes, files, patch, terminal | Card title (opens `#run/ID`); View changes; ⋯ | `OPENS`: `/api/runs/:id/artifact-raw/NAME[?download=1]`, `/api/runs/:id/recovery-patch?projectKey=…` or `/changes/patch` (a folder task); `POST /api/runs/:id/resolve-terminal {}` | A new tab, or the page | "the browser blocked the new tab" | `chat-app-host-4`, `task-tools-host-1`; test to write: `task-card-terminal-host` | wired today |
| Label, archive from the card | Card ⋯ | `PUT /api/runs/:id/labels {labels}`; `POST /api/runs/bulk {action: 'archive', targets: [{pipelineId}]}` (200 with `skipped` is a refusal when none done) | Chips; the card folds | The skip's reason | `task-card-host` | wired today |
| A schedule's card: Run now, Pause, Resume, Skip, Edit… | The schedule card in its chat | As Schedules below; Edit… opens `StillhetCenters.editSchedule(id)` | | | `schedules-actions-host` | call exists, control changed |

## New task and New schedule (the forms, opened from Chat)

**Today's live code:** `live/run-options-live.mjs` (every option read and write), `centers/centers.js` (`startBody`, `liveStart`, `liveSchedule`), `live/schedule-live.mjs` `newBodyOf`, `live/schedule-rule.mjs` · tests `run-options-live`, `new-task-forms-host`, `-options-host`, `-presets-host`, `-projects-host`, `-refusals-host`, `-source-host`, `-source-connect-host`, `-workflow-host`, `schedule-rule`, `test/design-system-forms-redesign` · **adapt** · `run-options-live.mjs` is reused whole; the body builder lives in page code and finds the workflow by title, the engine by label and builds `guardrailsId` from the label's words (lessons 1, 18): it moves into the live slice and sends ids. The tests open the forms from a bar + that no longer exists.

Opened only from Chat: the starter card "New task", More › "New task form…", a card's action (`StillhetCenters.newTask(keep)`, `.newSchedule(keep)`, `.editSchedule(id)`).

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| Projects to pick | `GET /api/projects` (the store's part), never task rows | `projects-changed` | "Add a project" row in the picker | Type-ahead | The picker says it could not read them; the form stays |
| Defaults for the project; its workflow | `GET /api/run-defaults?projectDir=`; `GET /api/config?projectDir=` (`activeWorkflowId`) | `settings-changed` | The Default workflow, named | n/a | The fields keep the app defaults, said so |
| Workflows, engines and models, guardrails | Chat's catalog; Auto (`wf_auto`) is a client constant, listed first | `workflows-changed` | One choice: plain text | Type-ahead | "Could not read the workflows" |
| Branches | `GET /api/branches?projectDir=` | none | The project's base only | Type-ahead | The base as text |
| Presets | `GET /api/presets`; `POST /api/presets/:id/check {projectDir}` | none | The Preset field is not drawn | Type-ahead | The field is not drawn |
| Ticket sources and tickets | `GET /api/sources`; `GET /api/source-bindings?projectDir=&plugin=&sourceId=`; `POST /api/sources/call {plugin, sourceId, op, args, profile?}` | `plugins-changed` | "No ticket source: add one in Marketplace" | The source's own search, debounced 300 ms | "Could not reach SOURCE" with Test connection |
| Team policy notes | `GET /api/policy/notes?scope=project:KEY&guardrailsId=&models=` | none | No note | n/a | No note (a refusal here is "none") |
| What a one-off can wait for | `GET /api/schedules/after-candidates?…` | `schedules-changed` | "Nothing to wait for" | Type-ahead | The field is not drawn |
| Room before a limit | E6 | `usage-limits-changed` | n/a | n/a | n/a |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Start a task from the form | New task dialog (`R.dialog`, `R.field`): Project, Preset, What should it do, Workflow, Engine and model, Source branch, Base branch; Start | `POST /api/run {projectDir or noProject, prompt, workflowId?, engine?, sourceBranch?, syncBeforeStart?, pr?: {open, slices?}, featureBranch?, costCapUsd?, overlay?: {nodes}, title?, tags?, extras?: [{name, dataBase64}], guardrailsId?, presetId?}` | The dialog closes; the task's page opens (`runId` in the answer; its pipeline id by `run-pipeline`, S3) | 409 `engine-refused`: a note with "Allow unguarded" (`allowUnguardedEngine`); 409 `sync-diverged`: a note with its options (`syncPolicy`); a broken preset lists what to reset; other: "Could not start the task" at the text, the form keeps what was typed | `new-task-forms-host`, `new-task-refusals-host` | call exists, control changed |
| More options: run on the source branch, draft PR, one PR or a PR per slice (Shaper) | Checkboxes and a picker in More options | `sameAsSource: true` (drops `featureBranch`, `pr`); `pr.open: 'draft'`; `pr.slices` | As above | As above | `new-task-options-host` | call exists, control changed |
| Human in the loop; Worca may answer for me; run without memory | Checkboxes | `humanInLoop` (Auto: always sent; else only when touched); `nightMode: true`; `noMemory: true` | As above | As above | `new-task-options-host` | call exists, control changed |
| Guardrails, once | One picker in More options | `guardrailsId` (the id from `GET /api/guardrails`, not the label) | As above | The engine refusal | `new-task-options-host`; new: the id sent equals the id listed | call exists, control changed |
| Mock mode | A quiet row, only when `hello.serverMock` | `mock: true` | As above | n/a | new: not drawn off a mock instance | to wire (needs `serverMock`) |
| Cost cap; cost tags; a model for every step | More options | `costCapUsd`; `tags`; `overlay.nodes {NODE: {model}}`; save the project's tags `PUT /api/projects/:key/tags/defaults {tags}` | As above | 400 on a bad cap, at the field | `new-task-options-host` | call exists, control changed |
| Presets: apply, check, update, duplicate | The Preset field's menu | Apply: client (`presetId` and what it carries); `POST /api/presets/:id/check {projectDir}`; `PUT /api/presets/:id {setup, basis: {projectDir}}`; `POST /api/presets/:id/duplicate {}`; save from a task `POST /api/pipelines/:id/preset {name, scope: {kind}}` | The field names the preset | A broken item is listed with Reset | `new-task-presets-host` | call exists, control changed |
| Manage presets (rename, delete) | Settings › Tasks › Presets | `/api/presets/:id` (classic; methods not called by Stillhet) | | | new: `settings-presets-host` | to wire |
| A workflow's saved defaults; the project's workflow | "Save as this workflow's defaults", Reset | `PATCH /api/workflows/:id/defaults {defaults}`; `DELETE /api/config/workflow?projectDir=&workflowId=`; `PATCH /api/config {projectDir, activeWorkflowId}` | The note says saved | "Could not select the workflow" | `new-task-workflow-host` | call exists, control changed |
| A ticket as the source; Test connection; a profile | Source tabs in the form; Profile field; Test connection | `source: {type: 'plugin', plugin, sourceId, taskId, profile?, inputs?}` in place of `prompt`; `PUT /api/source-bindings {projectDir, plugin, sourceId, profile}`; `POST /api/sources/call` | The ticket's title is the task's | "Could not reach SOURCE: REASON" | `new-task-source-host`, `new-task-source-connect-host` | call exists, control changed |
| Sync before start; engine check; team policy notes | Start from picker; the notes under the fields (body size, lesson 9) | `syncBeforeStart`; the two 409s above; `GET /api/policy/notes` | A note, never a headline | As above | `new-task-refusals-host` | call exists, control changed |
| Add a project from the form | Project picker › Add a project… | `POST /api/projects {name, path, useGit?}` | The project is picked | "Could not add" | `new-task-projects-host` | call exists, control changed |
| Start near a limit | The dialog's warning with "Use ENGINE" or "Start after the reset" | E6, E7 | | | | server first: S23, S24 (E6, E7) |
| Make a schedule | New schedule dialog: Name, What should it do, Project, Workflow, Engine and model, Repeats, At, Date for Once | Repeating: `POST /api/run {projectDir or noProject, …run fields, prompt, title, repeat: {rule (with `end`), overlap?, maxFailures?}}`; once: `POST /api/run {…, scheduledFor: ISO}` | Lands on the new schedule's page (`id`, `ticketId` or `scheduleId` in the answer) | A rule error (`rule.error`) at Repeats; unknown project refused before posting | `schedules-tickets-host`, `schedule-rule` | call exists, control changed |
| Change a schedule | Edit schedule dialog, from the schedule's card and "Change it in chat" | `PATCH /api/schedules/:id` `patchOf`: a series `{rule?, overlap?, maxFailures?, ifMissed?, graceMin?}`; a one-off `{scheduledFor}` or `{after}` | The page shows the new facts | "Could not save the changes" at Name | `schedules-drafts-host` (holds the old draft bar) | call exists, control changed |

## Tasks (inspect)

**Today's live code:** `live/task-live.mjs` (`LIST_ACTIONS`), `live/live-map.mjs` (`taskOfLive`, `taskOfSaved`, groups), `live/work-map.mjs`; pages `runs/runs-list.js`, `centers/centers.js` · tests `tasks-list-host-1…4`, `tasks-actions-host`, `tasks-refusals-host-1`, `-2`, `tasks-walk-host`, `tasks-center-week-host`, `live-counts-*`, `work-map` · **adapt** · reads and bulk actions hold; the needs-you count is computed here (S27, lesson 5), the workflow comes from the stepper (S2), the PR verdict is absent on first paint (S1), and the row mapping drops `tags` (server.md, Not server work).

Nothing here starts work: no +, no form. One quiet "Start one in Chat" at the end of the filter line and in the empty state.

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| The task rows: title, project · state, time, PR | `GET /api/history` `pipelines[]` (`id`, `projectKey`, `status`, `title`, `startedBy`, `labels`, `tags`, `storedPr`, `workflowId`, `workflowName`, `totalCostUsd`, `mtime`) joined to live runs from `hello.runs` by pipeline id | Run frames; `pipelines-changed`; `history-pr` | "No tasks yet · Start one in Chat" | 50 rows per section, Show more; the tab's count is all rows | "Could not read the tasks · Try again"; later failures mark the list out of date |
| Tabs with counts: Needs you, Running, Pull requests, All, Archived | Counted from the same rows; Needs you from S27 with "3 of 8, tasks" | `needs-you-changed` (S27) | A tab with 0 stays, greyed | n/a | n/a |
| Each row's PR state | `POST /api/history/pr {token}` asks; `history-pr {token, items: [{id, projectKey, pr}], done}` frames answer (10 to 25 s); first paint from `storedPr` | `history-pr` | No PR mark | n/a | A failed lookup keeps the stored PR; the page's Try again asks again |
| Archived | `GET /api/history?archived=1` | `pipelines-changed` with `bulk-archive`, `bulk-restore`, `bulk-delete`, `deleted`, `restored` | "Nothing archived" | Show more | That view alone says "Could not read the archive" |
| Groups and features | `GET /api/run-groups` `groups[]` (members by pipeline id) | `run-groups-changed` | No group rows | Members fold past 5 | The tasks draw ungrouped |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Open a task and keep the list | A row or card title opens `#run/ID`; the bar keeps Tasks, its filters, scroll and selection | none | The page; the row is marked current | Cold address: see the contract | `test/design-system-shell-redesign`, `tasks-list-host-1` | wired today |
| Filter, sort and group | `R.filterRow`: tabs with counts; pickers Order, Group by (Project, Workflow, Topic, None), Project | none (client, over all rows) | The line never changes size | n/a | `tasks-list-host-1…4` | wired today (by workflow: server first: S2) |
| See what runs now | The Running tab | Live runs from `hello` and run frames | Rows move on their frames | n/a | `tasks-list-host-2` | wired today |
| See the pull requests that need someone | The Pull requests tab: rows with a PR that is open, failing or awaiting review | The `history-pr` batch; verdict on first paint: S1 | A row opens its task | n/a | new: `tasks-pull-requests-host` | to wire (first paint: server first: S1) |
| Whose tasks | The "Whose" picker; "Started by NAME" on a row | Row `startedBy`; the people and the team's rows: S4 | | | | server first: S4 |
| Narrow for one visit | `R.narrowedLine` ("Narrowed to web-app · Clear") from a link | none | Clear restores your view | n/a | `test/design-system-shell-redesign` | wired today |
| Respond from a card: Answer, Approve, Merge, Retry, Fix checks, Resume, Stop, Open | The card's one action (`R.cardAction`), the same rule as the chat card | The routes of the task card section | The card stays in place and shows its new state; order settles on the next visit | As the card | `tasks-actions-host`, `tasks-refusals-host-*` | wired today |
| Stop | Row ⋯ › Stop, confirm at the control | `POST /api/stop {runId}` or `{pipelineId}` | The row moves to Stopped | "Could not stop the task" | `tasks-actions-host`, `tasks-list-host-1` | wired today |
| Archive, restore, delete, one or many | Row ⋯; Select then the bulk bar | `POST /api/runs/bulk {action: 'archive' or 'restore' or 'delete', targets: [{pipelineId}]}`; one archived task: `POST /api/runs/:id/restore?SCOPE` | Rows leave; Undo for restore | 200 with `skipped`: the reason per row | `tasks-list-host-1`, `task-live`, `classic-extras-task-host` | wired today |
| Label one or many | Row ⋯ › Label; the bulk bar | `PUT /api/runs/:id/labels {labels}`; `POST /api/runs/bulk/labels {pipelineIds, add or remove}`; vocabulary `GET /api/labels` | Chips on the rows | "Could not label the tasks" | `task-page-facts-host` (one); test to write: `tasks-bulk-label-host` (many) | wired today |
| Labels admin (rename, delete) | Settings › Tasks › Labels | `POST /api/labels/rename`, `DELETE /api/labels/:label` (classic) | | | | later |
| Group tasks | Row ⋯ › Add to group, Remove from group; bulk › Make a group | `POST /api/run-groups {title, pipelineIds}`; `POST /api/run-groups/:id/members {pipelineIds}`; `DELETE /api/run-groups/members/:pipelineId`; `POST /api/run-groups/undo {token}` | The rows fold under the group | "Could not make the group" | `tasks-list-host-2`, `task-live` | wired today |
| Watch a PR | Row ⋯ | `GET` / `POST /api/pr/watch {watch, id}` | The row's mark | "Could not watch the PR" | `chat-app-host-2` | wired today |
| Keep a task, chat or schedule in view | Row and card ⋯ › Keep in view; the top bar's In view tabs | S32 (today the browser keeps the list, so it is lost on another device and is not per person) | The tab shows on every device | At the cap of 5 the item says why | `test/api-in-view` | server first: S32 |
| Figures for the week | The Figures toggle at the end of the filter line | Counted from the rows shown | Equals the rows it opens (lesson 5) | n/a | `tasks-center-week-host` | wired today |

## A task's page (inspect)

**Today's live code:** `live/task-page.mjs` (`taskPageOf` and the mappers), `live/task-live.mjs` (`TASK_ACTIONS`, the part reads), `live/terminal-live.mjs`; pages `runs/run-page.js`, `runs/run-page-model.js` · tests `task-page`, `task-live`, `task-page-facts-host`, `-facts-host-2`, `-stages-host`, `-states-host`, `-decisions-host`, `task-tools-host-1`, `-2`, `task-links-host`, `task-follow-up-host`, `classic-extras-task-host`, `terminal-live` · **adapt** · the mappers and the action table are kept; the page is keyed by whatever id opened it and has no Pause or Stop under a run id (lesson 19, S3); the base shown comes from `sourceBranch`, not the PR's base; the PR dialog once took its text from the demo model (lesson 2).

No chat box. The head says "Started from the chat NAME · Open the chat" (`GET /api/ask/run-links`, `chatOfRun`) or "Started from New task · Ask about it in chat".

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| The head and the stage train | `GET /api/history/:key/:id` `state` (a workspace task: `GET /api/workspaces/:id/runs/:runId`); while live, the run's `state` frames (`steps`, `stepper`, `totalCostUsd`, `totalActiveMs`, `pipelineCapUsd`, `pauseReason`, `pauseAfterStep`, `branch`) | `state`, `question`, `done`, `error`, `title`, `run-pipeline` | n/a | A long branch folds its middle, whole in the tooltip; stages past 7 scroll in the train | "Could not open the task · Try again"; "not found" only after the list and the task's own read answered |
| Changes | Running: `GET /api/runs/:id/live-diff` (`patch`); ended: `GET /api/history/:key/:id/diff`; a gone branch: S7 | `state` (a step ended) | "No changes yet"; "Documents, not code" | Files listed; a file opens `R.diffView`; "Open the whole diff" in a dialog, side by side from 900px | "Could not read the changes"; today a gone branch is a 404 (S7) |
| Comments on the diff | `GET /api/history/:key/:id/comments` (by path) | none | None | Threads fold past 3 | The diff draws without them |
| Activity (the log) | `GET /api/history/:key/:id/log` (NDJSON) | `state` | "Nothing logged" | The last 200 lines, Show earlier | "Could not read the log" |
| Documents and the plan | `GET /api/runs/:id/artifacts`; text `GET /api/runs/:id/artifact?rel=`; raw `/artifact-raw/REL` | `state` | "No documents" | Listed by stage | "Could not open the document" |
| Decisions: who answered, away decisions, cap events | The state's questions and answers; `GET /api/whoami`; cap events: S5 | `question-resolved` | "No decisions were needed" | Newest first | n/a |
| Setup, sessions, step usage | `GET /api/pipelines/:id/setup`; `GET /api/runs/:id/sessions`; with `runTelemetry` on, `GET /api/runs/:id/telemetry` | none | The part is not drawn | Tables scroll inside themselves | The part says it could not be read |
| Services, stacks and tools in the worktree | `GET /api/runs/:id/actions?SCOPE` | `actions-changed` | The part is not drawn | n/a | "Could not read the actions" |
| PR and checks | The row's `pr` (batch) and `storedPr`; `GET /api/pr/checks?id=&…` | `history-pr` | Create PR when the work is ready | Failed first | A failed lookup keeps the stored PR |
| A group or feature (`#run/group:GID`) | `GET /api/run-groups`; a re-planned feature follows `GET /api/shape/features/:id`; whether they combine `GET /api/run-groups/:id/combine` (`oneOff`) | `run-groups-changed` | "This group has no tasks" | Members in stack order | "Could not check whether the tasks combine" |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Answer, approve the plan, accept or re-run a review | The status line's action and the open decision | As the task card: `POST /api/answer`, `POST /api/runs/:id/answer` | The page moves on | As the card | `task-page-stages-host`, `task-live` | wired today |
| Pause now, or after this step | Status line › Pause ▾ | `POST /api/pause {runId}`; `{runId, afterStep: true}` (E3) | "Pausing after this step" until it lands | 409 `ALREADY_PAUSING`; opened by pipeline id with no live run id: S3 | `tasks-actions-host`, `task-live`; `test/pause-after-step` | wired today (by pipeline id: server first: S3) |
| Resume; resume past a cap; raise the cap | Status line › Resume; the cap strip | `POST /api/resume {pipelineId, baseCheck: true, baseAck?}`; `{…, ignoreCostCap: true}`; `{…, costCapUsd}` (E1) | The task runs again | 400 bad cap; 403 the total budget; a moved base asks; past a budget confirms with the amount (E9) | `tasks-refusals-host-1`; `test/budget-api` | wired today (the record of who: server first: S5) |
| Resume later; near a limit | Resume ▾ › Resume at… | `POST /api/schedules/resume {pipelineId, scheduledFor}`; after a reset: E7 | A waiting row in Schedules | "Could not schedule the resume" | `task-tools-host-2` | wired today (after the reset: server first: S23, S24) |
| Stop | Status line › Stop, confirm under the line | `POST /api/stop {runId}` or `{pipelineId}` | Stopped | "Could not stop the task" | `tasks-actions-host` | wired today |
| Retry; Restart Build | Status line › Retry | As the card (E2) | A new round in the train | The three 409s; not offered without a plan | `tasks-actions-host` | wired today (picks follow: server first: S6) |
| Create the PR | Create PR dialog: title, description, draft, watch, base | `POST /api/pr` `prBodyOf`; the text from `POST /api/pr/describe` (classic), never a demo body | The head shows the PR | The refusal; "the branch was pushed" when it was | `task-page-facts-host`; new: the dialog never reads a demo body | wired today (describe: to wire) |
| Merge, re-run checks, fix checks | Status line once a PR is open | `POST /api/pr/merge`, `/rerun-checks`, `/fix-checks` | Merged / a fix round | As `/api/pr/resolve` | `task-tools-host-2`, `tasks-actions-host` | wired today |
| PR: remotes, cross-link, mergeable, auto setting, link a remote on a finished task | The PR part's rows; Create PR's Remote picker | `GET /api/pr/remotes`, `POST /api/pr/crosslink`, `POST /api/pr/mergeable`, `GET /api/pipelines/:id/pr-auto` (classic; payloads as classic's page sends them); publish: `POST /api/runs/:id/publish {projectKey or projectDir, memberKey?}`; no remote: opens `#projects/KEY` › Link a remote… | The row says mergeable or why not | The route's words | new: `task-page-pr-host` | to wire (publish: wired today) |
| A moved base: resolve in a terminal or with a pipeline | The moved-base note's two actions | `POST /api/runs/:id/base-check`, `POST /api/runs/:id/update-branch` (classic); terminal `POST /api/runs/:id/resolve-terminal {}` | The note goes | The conflict's words | new: `task-page-moved-base-host` | to wire (terminal: wired today) |
| Read and download the diff; comment on a line | Changes fold; `R.diffView`; a line's comment box | Reads above; patch through `OPENS.patch`; `POST /api/history/:key/:id/comments {path, side, line, body, project?}` | The thread shows on the line | "Could not add the comment"; the text stays | `task-tools-host-2`, `task-live` | wired today |
| Labels and cost tags | Chips in the head | `PUT /api/runs/:id/labels {labels}`; `PUT /api/runs/:id/tags {tags}` | Chips follow the answer | "Could not change the cost tags" | `task-page-facts-host` | wired today |
| Open in editor, terminal, files; services and stacks | The Tools part | `POST /api/runs/:id/terminal?SCOPE {member?}`; `/builtins/:builtin`; `/actions/:actionId/start` and `/stop`; `/stacks/:stackId/start` and `/stop` | A terminal pane, or the tool opens | "Could not open the tool" | `task-tools-host-1`, `-2`, `terminal-live` | wired today |
| Kept work: check out, apply, discard; a folder task's Apply | The kept-work note | `POST /api/runs/:id/checkout?SCOPE`, `/apply-retained`, `/discard-worktree`; a folder task `GET /api/runs/:id/apply-plan` then `POST /api/runs/:id/apply` | The note says done | The conflict list | `task-live` | wired today |
| Away mode on this task; see away decisions | Head ⋯ › Worca may answer; Decisions | `POST /api/run/night {runId, mode}`; decisions `GET /api/night-decisions` (classic, not called) | The mark on the head | "Could not set Away mode on this task" | `task-tools-host-2` | wired today (the decisions read: to wire) |
| Save as preset; archive; restore | Head ⋯ | `POST /api/pipelines/:id/preset {name, scope}`; bulk archive; restore | A toast names it | The refusal | `task-tools-host-2`, `classic-extras-task-host` | wired today |
| A workspace task: comments, diff and log per member | Member tabs inside Changes and Activity | `/api/workspaces/:id/runs/:runId`, `/diff`, `/log`, `/comments` (`project: MEMBER`) | Each member's own part | Per member | `task-page-facts-host-2` | wired today |
| A group: Create PR or PRs, merge a member | The group page's action | `POST /api/run-groups/:id/ship {mode}` or `POST /api/shape/features/:id/ship {mode}`; a member's own PR routes | The members show their PRs | Names what was pushed: S8 | `task-tools-host-2` | wired today (the refusal: server first: S8) |
| Follow up, run after, run another cycle | Not on the page: the link "Start a follow-up in its chat" | See the task card | | | `task-follow-up-host` | call exists, control changed |
| Report a task | Head ⋯ › Report… | `POST /api/pipelines/:id/report-issue {reason, expectation}` (in the table today) | | | | later (the call stays, the control is not drawn) |
| Guardrail details; dismiss a team memory note | `R.notInStillhet` | classic | | | | later |

## Schedules (inspect)

**Today's live code:** `live/schedule-live.mjs` (`SCHEDULE_ACTIONS`), `live/schedule-rule.mjs`, `live-map.mjs` `scheduleOf`; page `schedules/schedules.js` · tests `schedule-live`, `schedule-rule`, `schedules-actions-host`, `-delete-host`, `-page-host`, `-tickets-host`, `-drafts-host`, `seed-schedules` · **reuse** the live files; the page lost its drafts and its + in the redesign, so four host tests hold old controls.

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| Schedule rows: name, what it does, workflow, repeats, next, state | `GET /api/schedules` (`tickets[]` one-offs with `after`, `series[]` with `rule`, `nextAt`, `overlap`, `maxFailures`, `ifMissed`, `graceMin`, `pauseWhy`) | `schedules-changed` | "No schedules · Start one in Chat" | 50 rows, Show more | "Could not read the schedules · Try again" |
| What a waiting start will do near a limit | Row `nearLimit` (E8) | `usage-limits-changed` | n/a | n/a | n/a |
| Needs you (a missed time, a paused series) | S27 `kind: schedule`; today `needsLabel('schedule')` | `needs-you-changed` | Tab greyed | n/a | n/a |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Open a schedule | A row or card title opens `#schedule/ID` | none | The page | Cold address waits for `GET /api/schedules` | `schedules-page-host` | wired today |
| Filter and order | `R.filterRow`: tabs Repeating, Once, Paused, All; Order, Project | none | | | `schedules-actions-host` | wired today |
| Run now; stop its task | Card and row action | `POST /api/schedules/:id/run-now {}`; `POST /api/stop {pipelineId}` | A task starts; the card says Running | "card is scheduled" on a series made from a chat card (S12) | `schedules-actions-host`; `test/api-schedules` | wired today (series from a card: server first: S12) |
| Pause, resume | Card and row action | `POST /api/schedules/:id/pause {}`, `/resume {}` | The state word follows the frame | "Could not pause it" | `schedules-actions-host` | wired today |
| Skip next time; keep next time | Row ⋯; the page's head | `POST /api/schedules/:id/skip-next {}`, `/keep-next {}` | "Next" moves | "Could not skip next time" | `schedules-actions-host`; `test/api-schedule-keep-next` | wired today |
| Delete | Row ⋯ › Delete, Undo for 5 s; names the starts that waited for it | `DELETE /api/schedules/:id` after the Undo window (flushed on `pagehide`) | The row leaves | "Could not delete it"; the row returns | `schedules-delete-host` | wired today |
| Create or change one | none here: "Start one in Chat", "Change it in chat" | See the forms | | | | dropped from this place (the owner): moved to Chat |
| Its activity feed with Mark all read | none | | | | | dropped: Pulse holds it, filtered to the schedule |

## A schedule's page (inspect)

**Today's live code:** the same files; `live-map.mjs` `firesOf` · tests `schedules-page-host`, `schedules-drafts-host` · **adapt** · the page is now labelled facts (`R.fieldValue`) with no draft; `save` stays for the Edit dialog; its activity needs S13.

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| The facts: What it does, Repeats, At or Date and time or Runs after, Project, Workflow, Engine and model, Preset; in Expert: While one still runs, When runs fail, A missed time, How late it may start, Stop after | The store's schedule (`GET /api/schedules`); one schedule `GET /api/schedules/:id` | `schedules-changed` | A fact with no value is not drawn | The prompt clamps to 6 lines, Show all | "Could not open the schedule"; "There is no schedule" only after the list answered (lesson 21) |
| Its tasks (each fire) | `GET /api/schedules/:id` `history` (newest first), joined to tasks by pipeline id | `schedules-changed`, run frames | "It has not run yet · next TIME" | 20, Show more | "Could not read its tasks" |
| Its updates | S13 | `notifications-changed` | "Nothing to report" | 20, Show more | "Could not read its updates" |

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Run now, Stop, Pause, Resume, Skip, Keep | The head's buttons | As Schedules | | | `schedules-page-host` | wired today |
| See its prompt and workflow | The facts | Read above | | | `schedules-page-host` | wired today |
| Change its time or instruction | "Change it in chat" opens its chat with the schedule in focus, or `handOver({about})`; the chat's card has Edit… | `PATCH /api/schedules/:id` (see the forms) | | | new: `schedule-change-in-chat-host` | call exists, control changed |
| See its updates, in Pulse's terms | "Updates" fold; "All in Pulse" opens Pulse filtered | S13 | | | | server first: S13 |
| Open a fire's task | A row | none | `#run/ID` | | `schedules-page-host` | wired today |

## Workflows

**Today's live code:** `live/workflow-live.mjs`, `live/workflow-map.mjs`, `live/workflow-draft.mjs`, `graph-entry.mjs`; page `workflows/workflows.js` · tests `workflow-live`, `workflow-map`, `workflow-draft`, `workflows-host-actions`, `-host-page`, `-host-roundtrip`, `workflows-copy-draft`, `graph-entry`, `seed-workflows` · **reuse**, with one adapt: Save sends no base (S11; the client's own `STALE` check stays as the message).

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| Workflow cards: name, what it does, tasks and merged counts | `GET /api/workflows`; counts `GET /api/workflow-usage`; pinned from `GET /api/chat-home/pins` | `workflows-changed`, `plugins-changed` | Each tab says why it is empty ("None of your own yet · Use one as a template") | All; tabs All, For you, Your team's, Built in with counts | "Could not read the workflows · Try again" |
| A workflow's page: story and graph | `GET /api/workflows/:id`; agents `GET /api/agents`; the story's words per step: S35 | `workflows-changed` | The step's own name where no words are written yet | The graph scrolls inside its box with Zoom and Fit | "Could not read WORKFLOW" |
| Agents and scripts (Expert) | `GET /api/agents`, `GET /api/scripts` | `scripts-changed` | "No agents of your own" | All | "Could not read the agents" |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Browse and filter by category | `R.filterRow` tabs with counts; Sort by; Figures; Story and graph or Story only | none | | | `workflows-host-page` | wired today |
| Open a workflow; see its tasks | A card title opens its page; "Open its tasks" goes to Tasks narrowed by workflow | none; the narrowing needs S2 | | | `workflows-host-page` | wired today (by workflow: server first: S2) |
| Edit in the graph editor | Edit on the workflow's page: a draft until Save (a built-in: a draft of a copy); bar Undo, Redo, Import, Export, Discard, Save | `POST /api/workflows` with the whole template (`id` kept); a copy drops `id`, `origin`, `createdAt`, `updatedAt`, `archivedAt`, `needsRepo` and sends `name` | Saved; the page shows it | A name taken retries up to 5 names; changed since you started: "discard the draft or save a copy" | `workflows-host-roundtrip`, `workflows-copy-draft`, `workflow-draft` | wired today (conditional save: server first: S11) |
| Use as a template | Card ⋯ › Use as a template | `POST /api/workflows` with no id and the first free name | Opens the copy as a draft | "Could not copy" | `workflows-copy-draft` | wired today |
| Delete, with Undo | Card ⋯ › Delete | `DELETE /api/workflows/:id` after the Undo window | The card leaves | "Could not delete" | `workflows-host-actions` | wired today |
| Import and export a workflow file | Editor bar; card ⋯ | `GET /api/workflows/:id/json`; `POST /api/workflows/import-json {workflow, dryRun: true}` then `{workflow, acceptScripts?}` | The file downloads; an import opens as a draft | The check's findings before anything is written | `workflows-host-actions` | wired today |
| Pin as a Chat starter | Card ⋯ › Pin | `PUT /api/chat-home/pins {pins}` | "X is a starter on Chat" | "Could not pin X" | `workflows-host-actions`, `chat-home-pins-host` | wired today |
| Run a workflow | Its page's "Use it in Chat" hands over to the composer with the workflow picked | none | | | new: `workflow-use-in-chat-host` | call exists, control changed |
| Agents and scripts: new, duplicate, source, generate, runtimes, the test bench | `R.notInStillhet` | `PUT /api/agents/:key {meta, markdown}`, `DELETE /api/agents/:id`, `DELETE /api/scripts/:id`, `POST /api/scripts/bench {key, all: true, …}` are in the table today | | | `workflows-host-actions` | later (the calls stay; the controls are not drawn) |
| Export to a marketplace; export as a skill or plugin; import Claude Code skills | `R.notInStillhet` | `POST /api/workflows/:id/export {destination: 'global' or 'plugin', pluginDir?, dryRun?}` is in the table today; `/api/skills/import` (classic) | | | | later |

## Marketplace and a plugin's page

**Today's live code:** `live/market-live.mjs` (`MARKET_ACTIONS`), `live/market-map.mjs`; page `marketplace/marketplace.js` · tests `market-live`, `market-map`, `marketplace-host-actions`, `-host-page`, `-host-page-2`, `-host-roundtrip`, `seed-marketplace` · **adapt** · install, update, remove, set-up and sources are sound; health, Test connection, enable, purge and the channel form are drawn on demo data only (lessons 1, 3).

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| Plugin cards and the tabs All, Installed, Updates, Not installed with counts | `GET /api/plugins`; `GET /api/marketplaces` | `plugins-changed` (both lists, once, debounced) | "Nothing installed yet"; "No source lists a plugin · Add a source" | All; type in the top search | "Could not read the plugins · Try again" |
| A plugin's page: what it adds, where from, its settings (set or not set) | `GET /api/plugins/:name`; `GET /api/plugins/:name/config` (channels with schema and values; secret asks) | `plugins-changed` | "It asks for nothing" | Settings grouped by source | "Could not read PLUGIN" |
| Health | `POST /api/plugins/:name/doctor` (classic; not called) | none | "Not checked yet" | n/a | "Could not check" |
| Sources | `GET /api/marketplaces` (`sha`, `synced`, `error`) | `plugins-changed` | The built-in source only | n/a | A source's own error on its row |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Find a plugin | The top-bar search (by name); the tabs | none | | | `search-classic-names-host` | wired today (on-page search field: dropped, `set.search`) |
| Install | Card and page action Install (busy) | `POST /api/plugins/install {repoUrl, name, sha, subdir, marketplace}` | The card reads Installed; Set it up if it asks | "Could not install NAME: REASON" | `marketplace-host-actions` | wired today |
| Update one or all | Update; Update all | `POST /api/plugins/:name/update {}` (preview) then `{confirm: true, candidateSha}` | The version moves | A changed candidate asks again | `marketplace-host-roundtrip` | wired today |
| Remove | Page ⋯ › Remove… | `DELETE /api/plugins/:name` | The card reads Not installed | What still uses it (`GET /api/plugins/:name/references`, classic, not called) | `marketplace-host-actions` | wired today (references: to wire) |
| Set it up: all its settings | Page › Its settings: Change / Set up, labelled fields | `PUT /api/plugins/:name/config` (the body the schema asks for); profiles `POST /api/plugins/:name/profiles {sourceId, id, label}`, `DELETE …/profiles/:profile?sourceId=` | Each row says set | Field errors at the field | `marketplace-host-page-2` | wired today |
| Test connection; health | Page › How it is doing | `POST /api/plugins/:name/doctor` (classic); a source: `POST /api/sources/call` | The row says Healthy or what failed | The check's words | new: `marketplace-health-host` | to wire |
| Enable or disable | Page › Enabled switch | `POST /api/plugins/:name/enable` (classic; body as classic's page sends it) | The switch shows the server's value | The switch returns | new: `marketplace-enable-host` | to wire |
| Purge its settings | Page ⋯ › Purge its settings… | `DELETE /api/plugins/:name/data` (classic) | The settings read not set | "Could not purge" | new: `marketplace-purge-host` | to wire |
| A chat channel: edit, test, switch | "Its channel" on the plugin's page: values, Edit (labelled fields), Send a test message; Settings › Chat links here | `GET` / `PUT /api/plugins/:name/config {channelId, values}`; `POST /api/chat/test` (classic); status `GET /api/chat/status` | Saved; the channel's worker restarts | Field errors; "Could not send the test message" | new: `marketplace-channel-host` | to wire |
| Sources: add, sync, remove | The Sources part | `POST /api/marketplaces {url}`; `POST /api/marketplaces/:id/refresh {}`; `DELETE /api/marketplaces/:id` | The list follows the frame | The source's error on its row | `marketplace-host-actions` | wired today |
| Hide installed | The Not installed tab | none | | | `marketplace-host-page` | wired today |

## Projects and a project's tabs

**Today's live code:** `live/projects-live.mjs` (`PROJECT_ACTIONS`), `live/projects-map.mjs`; page `projects/projects.js` · tests `projects-live`, `projects-map`, `projects-add-ways`, `projects-host-actions`, `-host-gone`, `-host-roundtrip`, `-host-standing`, `-host-words`, `keep-open-projects-host`, `seed-projects` · **adapt** · the list, the add ways, sync and the Settings tab are sound; Memory, Sets, Actions and Automations read `R.notInStillhet` live, Readiness is read-only, and three server frames are not heard (S14).

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| Project cards: name, path, branch, origin state, needs you | `GET /api/projects` joined by key to `GET /api/sync/projects` (ahead, behind, checked, remote) | `projects-changed`, `project-sync-changed`, `clone-changed` | "No projects yet · Add a project" | All; Sort by, Group by | "Could not read the projects · Try again" |
| Overview: readiness line, last task, what is on it now, this month | The store's tasks by project key; `GET /api/stats` for the month (the model Insights reads) | Run frames | "Nothing has run here yet" | n/a | Each part alone says it could not be read |
| Tasks tab | The store's tasks for the key: Need you, Working, Ended; "All N in Tasks" | Run frames | "No tasks on this project" | 10 per group | n/a |
| Memory tab | `/api/memory/projects/:key` (registered by `registerMemoryRoutes` in `ui/server.mjs`); team notes `GET /api/memory/team/:key`; health `GET /api/memory/health` | none found | "No memory files yet" | Files listed, newest first | "Could not read the memory" |
| Sets tab | `GET /api/mcp/projects/:key`; `GET /api/mcp/projects/:key/mcpjson`; guardrails `GET /api/guardrails` | `settings-changed` | "It uses the General set" | n/a | "Could not read the sets" |
| Actions tab | `GET /api/projects/:key/actions` | `actions-changed` | "No actions yet · Add one" | n/a | "Could not read the actions" |
| Automations tab | `GET /api/automations` (rules and events) | none found | "No rules yet · Add rule" | Events: 20, Show more | "Could not read the rules" |
| Readiness tab | `GET /api/projects/:key/readiness` (`readiness` or `disabled: true`) | `readiness-changed` (S14) | Off: "Readiness is off for this project" | Nine rows | "Could not read the checks" |
| Settings tab: how its tasks run, cost tags and labels, where it is, team | `GET /api/projects/:key/settings`; `GET /api/projects/:key/tags/defaults`; `GET /api/projects/:key/team-metrics` (`status`); `GET /api/policy/scopes` | `settings-changed`; `team-metrics-changed`, `team-policy-changed` (S14) | "Uses yours" per row | n/a | Per section |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Add a project: one folder, a new folder, several folders, the folder browser, clone | + › Add a project… dialog with the ways as tabs | `POST /api/projects {name, path, useGit?}`; `GET /api/fs/dirs?path=`; `GET /api/projects/probe?path=`; `GET /api/git`; `POST /api/projects/create {name, useGit?, dryRun?}`; `POST /api/projects/bulk {projects: [{name, path}]}`; `POST /api/projects/clone {url, branch?, name?}` then `clone-changed` frames | Lands on the project's page | Per row for several; a clone's failure says why | `projects-add-ways`, `projects-host-actions` | wired today |
| Rename; point at a moved folder | Page ⋯ | `PATCH /api/projects/:key {name}` / `{path}` (answers `previousKey`) | The address follows the new key | "Could not move" | `projects-host-roundtrip`; `test/api-project-update` | wired today |
| Sync; check origin; set up git; link a remote | The origin action; Settings tab › Where it is | `POST /api/projects/:key/sync {mode: 'ff' or 'fetch'}`; `POST /api/projects/:key/git-init {}` or `{remoteUrl}` | The origin line follows the frame | Diverged: says so, offers nothing destructive | `projects-host-standing` | wired today |
| Copy the path; open a terminal | Settings tab › Where it is; Actions tab | Copy: client; `POST /api/projects/:key/terminal` (classic) | A terminal pane | "Could not open a terminal" | new: `project-terminal-host` | to wire |
| Remove a project | Page ⋯ › Remove…, Undo | `DELETE /api/projects?name=NAME[&deleteFolder=1]` | The card leaves | "Could not remove" | `projects-host-gone` | wired today |
| Memory: the files, New file, Defragment, History | Memory tab | `/api/memory/projects/:key` (methods as classic's page uses them; not called by Stillhet); Defragment is a task: `POST /api/run {workflowId: 'wf_memory_defrag', memoryScope}` (the chat card already sends it) | The file list follows | "Could not save the file" | new: `project-memory-host` | to wire |
| Sets per project; approve its `.mcp.json` | Sets tab: switches; Approve, Take approval back | `PUT /api/mcp/projects/:key`; `POST /api/mcp/projects/:key/mcpjson/approve` (classic) | The switch shows the server's value | The validation's words | new: `project-sets-host` | to wire |
| Actions: add, edit, remove, try; open the editor, terminal, files | Actions tab | `PUT /api/projects/:key/actions`; `POST /api/projects/:key/actions/:actionId/try`; launchers `GET /api/actions/launchers` (classic) | The list follows | "Could not run ACTION" | new: `project-actions-host` | to wire |
| Automations: add a rule, turn off, delete, check now | Automations tab | `POST /api/automations/rules`; `PATCH` / `DELETE /api/automations/rules/:id`; `POST /api/automations/poll`; events `POST /api/automations/events/:id/approve`, `/start`, `/remove` (classic) | The rule's switch; "Checked just now" | The rule's error on its row | new: `project-automations-host` | to wire |
| Readiness: Recheck, Ignore, tool choice | Readiness tab: Recheck per row and Recheck all (busy); Ignore; Detect / Used / Not used | `GET /api/projects/:key/readiness?refresh=1`; Ignore and tool choice `PATCH /api/projects/:key/settings` (the keys classic's page sends) | The summary is counted from the same rows | "Could not recheck" | new: `project-readiness-host` | to wire (live in another tab: server first: S14) |
| How its tasks run: step and helper models, chat turn limit, context size, skill delivery, team memory | Settings tab: a labelled picker per row (`R.settingsRow.picker`), "Use yours" | `PATCH /api/projects/:key/settings {settingId: value or null}`; `{'memory.team': on}` | The row shows the server's value | The picker returns | `projects-host-words`, `projects-map` | wired today |
| Default cost tags and labels | Settings tab | `PUT /api/projects/:key/tags/defaults {tags, labels}` | Saved | "Could not save" | `projects-host-roundtrip`; `test/api-project-defaults` | wired today |
| Team metrics and policy for the project | Settings tab › Team | Read today; enable `POST /api/projects/:key/team-metrics/enable`, `POST /api/projects/:key/policy/enable` (classic) | "On" | The refusal | new: `project-team-host` | to wire |

## Workspaces

**Today's live code:** `live/projects-live.mjs` (the `space-*`, `scan`, `answer`, `open-editor` rows), `live-map.mjs` (spaces and maps) · tests `workspaces-host-actions`, `projects-live` · **reuse**.

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| Workspaces, their projects, links and open questions | `GET /api/workspaces`, then each `GET /api/workspaces/:id/map` in parallel | `workspaces-changed` | "No workspaces · group projects that change together" | Links grouped by project | A failed map leaves that workspace without questions, never the list unread |

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Make, rename, delete a workspace | + › New workspace…; page ⋯ | `POST /api/workspaces {name, projectPaths}`; `PATCH /api/workspaces/:id {name}`; `DELETE /api/workspaces/:id` | The page opens / leaves | "Could not save" | `workspaces-host-actions` | wired today |
| Add or remove a member | The Projects part | `POST /api/workspaces/:id/members {add: paths}` / `{remove: path, rescan: 'none'}` | The list follows | "Could not save" | `workspaces-host-actions` | wired today |
| Scan for links; answer a link question | Scan (busy); the question's choices | `POST /api/workspaces/:id/scan {}`; `PUT /api/workspaces/:id/map/edges/:edgeId {state}` (`null` for auto) | The question leaves Needs you | "Could not scan" | `workspaces-host-actions` | wired today |
| Default tags and labels; open a file in the editor; sync all members | Page parts | `GET` / `PUT /api/workspaces/:id/defaults {tags, labels}`; `POST /api/workspaces/:id/open-in-editor {projectKey, file}`; `POST /api/projects/:key/sync {mode: 'ff'}` | | "Could not open" | `test/api-workspace-open-in-editor` | wired today |
| A workspace's settings; what removing a member does | `R.notInStillhet` | `GET` / `PATCH /api/workspaces/:id/settings`, `GET /api/workspaces/:id/members/remove-impact` (classic) | | | | later |

## Insights

**Today's live code:** `live/insights-live.mjs` (GETs only, its own cache), `live/insights-map.mjs` (`SOURCE_OF` names the field behind each figure) · tests `insights-live`, `insights-map`, `insights-model`, `insights-figures`, `insights-host-1`, `-2`, `insights-work-host`, `seed-insights` · **reuse** · the six pages with no measure are already out of the place; they return with S16 to S21.

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| Your spend, per task, budget, time saved, value, ends, fails, shipped, throughput, shaping | `GET /api/stats?…&report=1[&tags]`: `totals.spentUsd`, `totals.pipelineSpendUsd`, `totals.runs`, `totals.savedUsd`, `totals.prsMerged`, `totals.finished`, `report.runs`, `shaping.groups`; budget `GET /api/budget` `totalLimitUsd` | `pipelines-changed`, `ask-done`, `ask-error`, `budget-changed` (re-read, debounced) | "Nothing in this range · widen it" | Buckets by the range; rows in `R.figureRows` scroll inside | "Could not read the figures · Try again"; the last figures stay, marked out of date |
| The team's spend, people, untagged, the heat grid | `GET /api/team-metrics/scopes`; `GET /api/team-metrics?scope=&range=all&aggregate=0&defer=1` (records, aggregated in the browser by `src/shared/team-metrics/`); the pooled cap `GET /api/policy?scope=` | `team-metrics-changed` | "Team metrics are off · turn them on in a project" | People: 20, Show more | A refused policy read is "none", never a failed page |
| A person's work | `POST /api/team-metrics/prs` in chunks of 500; `GET /api/team-metrics/pr-events` | none | "No pull requests in this range" | Chunks load as the row opens | "Could not read their pull requests" |
| Cost tag keys for the breakdown | `GET /api/tag-dimensions` | none | The Tag picker is not drawn | n/a | Not drawn |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Pick the view, range, scope and breakdown | `R.filterRow`: Show, Range, Whose, Tag | Query params of the reads above; the picks are kept per browser | | | `insights-host-1` | wired today |
| Open a number to the tasks behind it | A row with a chevron is a button; one that cannot open is plain text with its reason | Tasks narrowed by project (and by workflow: S2); stats and history count different tasks: S15 | Tasks opens narrowed for the visit | n/a | `insights-figures`; new: every row that opens equals the rows it opens | server first: S15 (by person: S4) |
| Why it cost, Review, Autonomy, Cache, Start to merge, Waiting on you | Not drawn until measured | S16, S17, S18, S19, S20, S21 | | | | server first: S16…S21 |
| One day rule across your and the team's pages | n/a | S22 | | | | server first: S22 |
| Budget overrides, who continued past a cap | Insights › Budget rows | S5 | | | | server first: S5 |
| Team metrics: Timeline, discover repositories, Check now, Push now | `R.notInStillhet` | `POST /api/team-metrics/discover`, `/flush` (classic) | | | | later |

## Requirements (later)

**Today's live code:** none; the place is `R.notInStillhet` behind its Labs flag and opens classic's page · test `gateg-places` · no verdict.

| Function | Stillhet control | Route | Status |
|---|---|---|---|
| The whole page: brief, helper chat, assumptions, answers, attachments, import and export, start, finish, revert; the Shaper answerer (Fix all, Ask for changes, Agree and plan) | "Not in Stillhet yet · Open it in classic" | `/api/shape/features/:id` and its `start`, `replan`, `resume`, `cancel`, `approve-each`; `GET` / `PUT /api/answerer` (classic) | later (agreed) |
| A Shaper feature met from Chat (its card, its slices, Ship, mark a requirement) | The feature's TaskCard and the group page | See the task card and the task's page | wired today |

## Settings, tab by tab

**Today's live code:** `settings/settings-model.js`, `settings/settings.js` · tests `settings-labs-live`, `settings-labs-notifications-live`, `settings-labs-reset`, `settings-live-no-demo`, `settings-not-live-rows`, `settings-prompt-check`, `models` · **rewrite** · the page starts from about 150 sample rows and overlays five live parts (Labs, About › Version, Chat › Prompt check, Chat › Delete all, Add-ons › Installed); every other row is `NotLiveRow` or a sample value (lessons 1, 2, 3). The build keeps the row components and the section list, and replaces the model with a settings slice in the adapter that reads `GET /api/settings` once and writes one key per control.

**Reads (every tab)**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| A row's value, in words | `GET /api/settings` (the key named in the tab's row below); the tab's own list route | `settings-changed`; `flags` | "Not set" with what the default does | A list past 20 rows gets Show more; a long value folds, whole in the tooltip | The tab says "Could not read the settings · Try again"; a control that could not save returns to the server's value |

**Functions**

| Tab | Function | Stillhet control | Route and payload | Proving test | Status |
|---|---|---|---|---|---|
| General | Version and updates: check now, channel, choose a version | About rows; Check now (busy) | `GET /api/app/version`; `POST /api/app/version/check`; `GET /api/app/update`, `/update/versions`, `/update/preview`; `POST /api/app/update`, `/update/dismiss` (classic) | `settings-live-no-demo`, `settings-not-live-rows` (version); new: `settings-update-host` | wired today (version, Check now); to wire (channel, choose a version) |
| General | The setup assistant: detect, apply, share the team setup | Setup rows; Run setup | `GET /api/setup/detect`; `POST /api/setup/apply`, `GET /api/setup/apply/:id`; `GET /api/setup/team`; `POST /api/setup/team/draft` (classic) | new: `settings-setup-host` | to wire |
| General | Folders, language, sounds | Rows | `GET` / `POST /api/settings`; `GET /api/sound` | new: `settings-general-host` | to wire |
| Appearance | Theme | Segmented | `POST /api/settings {theme}`: a server setting, stamped on the shell as `data-theme` (classic's own key) | `look-options`; test to write: `settings-theme-host` | to wire (Stillhet keeps it in the browser today) |
| Appearance | Background; breathing background | Picker, switch | S34 (today `localStorage`) | `test/settings-api`, `test/stillhet-shell` | server first: S34 |
| Appearance | Pulse icon motion | Switch | Follows `pulseFor` (Notifications) | `pulse-app-host` | wired today |
| Appearance | Text size | Small · Default · Large | S26 (one change with S34) | `test/settings-api`, `test/stillhet-shell` | server first: S26 |
| Models | Sign-ins: GitHub Copilot and the rest; a row opens that provider's settings | Provider rows; its dialog (State, Usage, Models, Import models) | `GET /api/providers`; `PATCH /api/providers/:name`; `POST /api/providers/:name/test`; Copilot `POST /api/providers/copilot/login`, `/login/:deviceCode`, `/logout`, `GET …/copilot/models`, `POST …/copilot/import-models`; `GET /api/engines`; `GET /api/credentials` (classic) | new: `settings-providers-host` | to wire |
| Models | OpenAI-compatible lists and import; the catalogue: add, edit, test, remove a model | Catalogue rows; Add model | `GET /api/providers/openai/models`, `POST …/openai/import-models`; `GET` / `POST /api/models`, `PATCH` / `DELETE /api/models/:id`, `POST /api/models/:id/test`, `POST /api/models/promote` (classic) | new: `settings-models-host` | to wire |
| Models | Picture and voice keys | Rows under Sign-ins | `PATCH /api/providers/images`, `/sound`, `/speech`; `POST /api/images/test`, `/api/providers/sound/test`, `/speech/test` (classic) | new: `settings-media-keys-host` | to wire |
| Models | The helper models (title, naming, PR text, command summary, second opinion and more); the Chat engine | Roles rows, a picker each | `GET /api/config`, `POST /api/config`, `DELETE /api/config/models` (classic); the chat engine in `GET` / `POST /api/settings` | new: `settings-roles-host` | to wire |
| Models | Share as plugin | Catalogue ⋯ | `POST /api/models/export-plugin` (classic) | | to wire |
| Models | Usage windows per provider | The provider dialog's Usage | `GET /api/usage-limits` (Claude today) | `test/usage-limits-api` | wired today for Claude; server first: S23 |
| Connectors | MCP servers and sets: add, edit, validate, duplicate, test a member; run preview; team members | Lists with ⋯; Add server; Validate | `GET` / `POST /api/mcp/servers`, `PUT` / `DELETE /api/mcp/servers/:id`, `POST /api/mcp/servers/validate`; `GET` / `POST /api/mcp/sets`, `PUT` / `DELETE /api/mcp/sets/:id`, `POST …/sets/:id/duplicate`, `PUT` / `DELETE …/sets/:id/members/:serverId`, `POST …/members/:serverId/test`; `POST /api/mcp/preview`; team `POST /api/mcp/teams/:home/forget` (classic) | new: `settings-connectors-host` | to wire |
| Connectors | Skills in sets; import Claude Code skills | Skills list | `GET /api/skills`, `/api/skills/home`; `POST /api/skills/import` (classic) | | later |
| Team policy | Read the effective policy; edit a guardrail rule; which models the team may use; publish | Rows with "was …"; a draft with the DraftBar (Discard, Publish) | `GET /api/policy?scope=`, `GET /api/policy/scopes`; `PUT /api/policy`; `POST /api/policy/validate`, `/discover`; guardrails `GET` / `POST /api/guardrails`, `GET` / `PUT` / `DELETE /api/guardrails/:id` (classic) | new: `settings-team-policy-host` | to wire |
| Tasks | Limits: archive after, longest wait, tasks at once; budget and caps; paused tasks resume after a reset (E4) | Rows with a picker each | `GET` / `POST /api/settings`; `GET /api/budget` (`totalLimitUsd`, resets) | `test/settings-api`; new: `settings-limits-host` | to wire |
| Tasks | The warning line and the two start rules | Pickers | S24 | | server first: S24 |
| Tasks | Ticket sources: test a connection, profiles; ticket update rules | Sources rows | `GET /api/sources`, `POST /api/sources/call`, `GET` / `PUT /api/source-bindings`; `POST` / `DELETE /api/plugins/:name/profiles…` | new: `settings-sources-host` | to wire |
| Tasks | Cost tags; presets (rename, delete) | Lists | `GET /api/tags`, `GET /api/tag-dimensions`; `GET /api/presets`, `/api/presets/:id` | | to wire |
| Tasks | Smart naming: suggest on rename, the branch pattern | `R.notInStillhet` | `GET /api/naming/config`, `POST /api/naming/suggest` (classic) | | later |
| Chat | Prompt check | Switch | `POST /api/settings {chat: {promptCheck}}`; read `chatPrefs` from `GET /api/settings` | `settings-prompt-check` | wired today |
| Chat | The chat engine, turn limit, history: Delete all chats | Rows; Delete all behind a confirm | `POST /api/settings {chat: {…}}`; `GET /api/ask/history`, `DELETE /api/ask/threads` | `chat-live` | wired today (Delete all); to wire (the rest) |
| Chat | Chat channels | A link to each channel's plugin page; engine status | `GET /api/chat/status` | | to wire (see Marketplace) |
| Chat | Speech and voice | Rows | `GET /api/speech`, `GET /api/sound`, `GET /api/sound/voices/:id/sample`, `DELETE /api/speech/cache` (classic) | `voice` | to wire |
| Notifications | How long Pulse shows news | Picker | `POST /api/settings {pulseFor}` (`until-read`, `10s`, `1m`, `never`) | `test/settings-pulse-for`, `settings-labs-notifications-live` | wired today |
| Notifications | What reaches you, per group; when a limit is near | A row per group: level and where | S25; S24 (`usage.warnPct`) | | server first: S25, S24 |
| Memory | Global notes: the files, New note, Defragment, proposals | List with ⋯ | `/api/memory/global` (registered by `registerMemoryRoutes`); `GET /api/memory/health`; `GET /api/memory/proposals`, `POST /api/memory/proposals/:id/:action` (classic) | new: `settings-memory-host` | to wire |
| Add-ons | Installed plugins | The list, each opens its plugin's page | `GET /api/plugins` through the Marketplace slice | `settings-not-live-rows` | wired today |
| Network | Proxy: detect, sign in, test | Rows | `GET /api/proxy/status`, `/detect`; `PUT /api/proxy/settings`; `POST /api/proxy/login`, `/logout`, `/test` (classic) | new: `settings-proxy-host` | to wire |
| Labs | A feature's switch; Reset all; the Stillhet row | Switches by stage; Reset all behind a confirm | `GET /api/flags` (`flags[] {key, on, stage, locked, source}`); `PATCH /api/flags {KEY: true or false or null}`; a flag that needs others asks first | `settings-labs-live`, `settings-labs-reset` | wired today |
| Labs | The Labs guide; report a bug; suggest an improvement | Links that open a new tab | none | | to wire (links only) |

## Pulse and the one count

**Today's live code:** `pulse/pulse.js`, `pulse/pulse-model.js`, `live-map.mjs` `updateOf`, `src/shared/needs-you.mjs` · tests `pulse-app-host`, `pulse-read-host-1`, `-2`, `pulse-redraw-host`, `live-counts-*`, `test/needs-you` · **rewrite** the live part · the page calls `fetch` and `A.post` itself behind 45 `LIVE` branches, counts what needs you in the browser from five reads, and keeps "read" per browser for everything but schedules (lessons 1, 3, 5). The shared rule (`needs-you.mjs`) and the row components are kept; a Pulse slice in the adapter replaces the page's own calls.

**Reads**

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| The badge and Needs you: each item with its reason and its one action | Target: S27 `items[]`, `counts`. Today: `needs()` over history, the PR batch, schedules, projects and sync, workspace maps | `needs-you-changed` (S27); today every source's frame | "Nothing needs you" | Grouped by kind; 10 per kind, Show more; the badge is `counts.total` | The badge keeps its last number, greyed; "Could not read what needs you" |
| Now: what runs, what is scheduled next, services running | The store's live runs; `GET /api/schedules` (next times); `GET /api/actions/running` | Run frames, `schedules-changed`, `actions-changed` | "Nothing is running" | 5 per group, "All N in Tasks" | Per group |
| Updates | `GET /api/notifications` (`notifications[]` with `scheduleId`, `unread`); schedule kinds only today (S28) | `notifications-changed` | "No updates" | 30, Show earlier; unread first | "Could not read the updates" |
| Limits and spend | `GET /api/usage-limits`; `GET /api/budget` (spent, `totalLimitUsd`, resets) re-read each minute while a task runs | `usage-limits-changed`, `budget-changed` | "No limits reported" (a harness with `source: none`, S23) | One row per harness | "Could not read the limits" |
| Away | `GET /api/away-mode` | `settings-changed` | Off | n/a | The row is not drawn |

**Functions**

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| See one count of what needs you, everywhere | The Pulse badge; each place's part with "3 of 8, tasks" | S27 | | | `test/api-needs-you` | server first: S27 |
| Act on a row that needs you | The row's one bordered action (`R.cardAction`): Retry, Answer, Approve, Create PR, Merge, Resume, Run now, Open | The routes of the task card and Schedules; Resume: `POST /api/resume {pipelineId, baseCheck: true}` | The row reads Resolved | Resume past a used-up budget asks at the button with the amount (E9) | `pulse-read-host-2` | wired today (the calls move from `pulse.js` to the adapter) |
| What is scheduled next; make a schedule | Now › Scheduled; "New schedule" hands over to Chat's form | `GET /api/schedules`; the form's route | | | `pulse-app-host` | wired today (New schedule: call exists, control changed) |
| Mark an update read or unread; mark all read | Row click; Mark all read | `POST /api/notifications/:id/read {read?: false}`; `POST /api/notifications/read-all {scope: 'schedule'}` | The unread count is the server's answer | "Could not mark all read" | `pulse-read-host-1`, `live-counts-2` | wired today for schedules; server first: S28 (tasks, PRs, usage, projects) |
| Usage events (near, reached, reset, moved, held) | Updates rows of scope usage | S29 | | | | server first: S29 |
| Stop a running service | Now › Services › Stop | `POST /api/actions/instances/:id/stop` | The row leaves | "Could not stop NAME" | `live-counts-2` | wired today |
| Away: step away and come back; Keep awake | The Away row | `POST /api/settings {nightModeToggle: 'on' or 'here'}`; `{keepAwake}` | The row shows the server's state | "Could not change Away" | `live-counts-2` | wired today |
| How long the icon shows news | Pulse › ⋯; Settings › Notifications | `POST /api/settings {pulseFor}` | | "Could not change the Pulse icon" | `pulse-app-host`, `test/settings-pulse-for` | wired today |
| A schedule's activity feed | Pulse › Updates filtered to the schedule | S13 | | | | server first: S13 |

## Onboarding and the Stillhet switch

**Today's live code:** `ui/public/stillhet.mjs` (`mountStillhetAsk`, `stillhetLabsRow`), `ui/public/stillhet/host-app.js`, `design-system/components/stillhet-switch.mjs`, `src/core/stillhet.mjs`, `src/core/stillhet-shell.mjs` · tests `flag-off`, `app-host`, `boot`, `default`, `test/design-system-stillhet-switch`, `ui-stillhet` · **reuse**.

| What is shown | Live read | Frames | Empty | Long | Failed |
|---|---|---|---|---|---|
| Whether Stillhet is on, and whether you were asked | `GET /api/flags` (`stillhet`); `onboarding.stillhetAsked` in `GET /api/onboarding` | `flags`, `onboarding-changed` (sent by the server; no Stillhet listener found) | n/a | n/a | The switch is disabled with "Could not read the features" |
| Getting started: which steps are done | `GET /api/onboarding` (status; `fresh`) | `onboarding-changed` | The row leaves when all are done | n/a | The row draws without a count |

| Function | Stillhet control | Route and payload | On success | On refusal or failure | Proving test | Status |
|---|---|---|---|---|---|---|
| Turn Stillhet on or off | The top-bar switch (`R.stillhetSwitch`, a 2-row menu); Settings › Labs › Stillhet | `PATCH /api/flags {stillhet: true or false}` (on also stores `stillhetAsked`); the page reloads into the other shell | The other design, same address where it has one | A flag locked by `WORCA_FLAGS` says "Locked" | `flag-off`, `test/design-system-stillhet-switch`, `app-host` | wired today |
| Be asked once (an existing user) | Classic's prompt, drawn by today's app | Yes: `PATCH /api/flags {stillhet: true}`; No thanks: `POST /api/onboarding {stillhetAsked: true}` | Never asked again | The prompt stays | `ui-stillhet` | wired today |
| A new user's first run | Getting started as a chat that walks you through, with its count | `GET` / `POST /api/onboarding` | Steps tick as the server sees them | n/a | new: `onboarding-count-host` | to wire |
| With the flag off, classic is unchanged | n/a | The server sends classic's `index.html` byte for byte | n/a | n/a | `flag-off` | wired today |

## What the old map said that the code does not do

`test/fixtures/stillhet-first-wiring/stillhet-wiring.md` against today's code. Of the 153 routes it names on rows marked "wired", all but one (`GET /api/schedules/dependents`) are called somewhere under `ui/public/stillhet/` (checked by script, then by eye for templated paths); what differs is where and how.

| The old map said | The code |
|---|---|
| Pulse, Away, Keep awake, mark read and Stop a service are "wired" | The calls sit in `pulse/pulse.js` behind `LIVE`, not in an adapter slice; they are real, and they are the pattern lesson 1 forbids |
| "Every Settings value and model list: wire to" read as one open item | It is about 150 rows. Only Labs, Version, Prompt check, Delete all chats and Installed plugins are live; `stillhet-no-demo-on-live` was reported failing on projects.js, run-page.js, workflows.js and insights |
| New schedule from the Schedules bar's +; a schedule's page edits as drafts; Edit… and "Run after this" in ⋯ | Those controls are gone (the owner's later direction). `schedule-live.mjs` `save` and `new` remain and are reached only from Chat's dialogs; four schedules host tests still click the old controls |
| New task from the Tasks bar's + and the top bar | Gone. `new-task-forms-host` opens the form through `bar-new|form`, which no longer exists in Tasks |
| The task page "docks the composer" and sends directions to the run | The dock is deleted; `run-direction` and `direction` remain in the tables with no control (gaps.md drops the function) |
| Dependents of a deleted schedule use the same set as `GET /api/schedules/dependents` | That route is never called; the names come from the store's one-offs whose `after.id` matches |
| Pause is wired for a task | `POST /api/pause` is sent with `runId` only; a page opened by pipeline id with no live run id cannot pause (S3) |
| Mark all read clears Updates | It posts `{scope: 'schedule'}`; a task's outcome is "read" per browser only (S28) |
| The mock badge is covered by the hello frame | Nothing under `ui/public/stillhet/` or the library reads `serverMock` |
| New task sends dev's `guardrailsId` | `centers.js` builds it from the label (`form.guard.toLowerCase().replace(/ /g, '-')`) and finds the workflow by title and the engine by label; the chat proposal path (`startBodyOf`) sends real ids |
| History rows carry labels and cost tags into Tasks | The `task` shape lists `labels`; `tags` reach only the task page (`TASK_PAGE_SHAPE.tags`), so a Tasks row cannot show or filter by cost tag |
| A project page follows Readiness, Team metrics and Team policy live | `PROJECT_FRAMES` holds `clone-changed`, `settings-changed`, `projects-changed`, `workspaces-changed` only (S14) |

## Open questions

| # | The choice | Recommendation |
|---|---|---|
| 1 | **Run once on a workflow proposal:** save first and then start, or start an unsaved workflow? `POST /api/run` takes a `workflowId`, so an unsaved run needs server work | Save then start, in one click, and say "Saved and started". No new server row |
| 2 | **The Pull requests tab before S1:** draw it from the batch (empty for 10 to 25 s after load) or wait for S1? | Build S1 first; it is small and the tab is the team lead's main ask |
| 3 | **Report a task** is `later` in gaps.md but its call is already in `TASK_ACTIONS` | Keep it later; delete the table row until the control is designed, so no dead call ships |
| 4 | **The agents, scripts and bench calls** in `workflow-live.mjs` serve a part gaps.md marks later | Keep the file's rows (they are tested) and do not draw the controls; remove nothing |
| 5 | **Per-step models in New task:** today one model for every step (`overlay.nodes`); classic edits each step | Keep one pick in the form. A per-step editor needs no server work (`overlay.nodes`, `GET /api/run-defaults` and `GET /api/pipelines/:id/setup` exist; S6 only keeps a round's picks), so it is a design call: add it to More options once drawn in the prototype |
| 6 | **Desktop alerts** are per browser; S25 stores "where" per group on the server | The permission stays per browser; S25 decides what is sent. Say "on this browser" on the row |
| 7 | **Needs you in the Chat bar** counts chats (5) while the one count counts tasks (4) | The Chat bar shows S27's task and proposal items grouped under their chat, and says "N of TOTAL" like every place |
| 8 | **The tab of a project in the address** (`#projects/KEY` always opens Overview) | Add `#projects/KEY/TAB`; classic's `#projects/KEY/settings` already lands there through old addresses |
| 9 | **Memory routes:** `/api/memory/projects/:key` is registered by a helper, and its methods were not read for this file | Read `registerMemoryRoutes` in `ui/server.mjs` before the Memory tab is planned; if a method is missing it becomes a server.md row |
| 10 | **Tests that hold old controls** (schedules hosts, `new-task-forms-host`, `projects-host-words`): rewrite in the place's own change, or in one sweep first? | In each place's change, so a place is never green on a test of a control it no longer has (lesson 31) |
