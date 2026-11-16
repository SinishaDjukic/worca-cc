# Stillhet browser test protocol: the function checklist

Built from `plans/rail/stillhet-wiring.md`, `plans/rail/implementation-prompt.md`, `plans/rail/findings.md`, the classic UI (`ui/public/app.js` `VIEW_NAMES`, `MOVED_ROUTES`, `PD_TABS`, `WD_TABS`, `HD_TABS`/`RD_TABS`, `TP_TABS`, `SETTINGS_TABS`, `ui/public/settings-index.mjs`, `ui/public/marketplace/page.mjs`, `ui/public/schedules-view.mjs`, `ui/public/group-page.mjs`, `ui/public/chat/home-lists.mjs`, `ui/public/activity-model.mjs`) and Stillhet's own tables (`ui/public/stillhet/shell/shell.js` `PLACES`, `ui/public/stillhet/shell/old-addresses.js`, `ui/public/stillhet/settings/settings-model.js` `GROUPS`). Branch `docs/rail-agreed` at a29b53a53.

## 1. Purpose and rule

Every function is tested end to end in a real headless browser on four instances and compared three ways (classic, Stillhet, prototype).

- **The classic UI leads on WHAT:** functions, fields, counts, states.
- **The prototype leads on HOW:** layout, components, wording, flows.

Verdicts: **Missing function** · **Wrong wiring** · **Missing or wrong detail** · **Design gap** · **Behaviour bug** (state, cache, lag, CPU, scroll) · **OK**.

When classic and the prototype disagree:
- Classic has it and the prototype has no place for it: **Design gap**, for the owner.
- The prototype has it and classic has no data: **missing backend**. It is either built, or the wiring says "not offered live", and then live Stillhet must not draw it or must say why.
- Naming or order differ: the prototype wins, as long as no function is lost.

## 2. Targets

| Target | What | Address |
|---|---|---|
| A | classic (`rail` off), real data (a copy) | http://localhost:4501 |
| B | Stillhet (`rail` on), real data (a copy) | http://localhost:4502 |
| C | classic, empty home | http://localhost:4503 |
| D | Stillhet, empty home | http://localhost:4504 |
| P | prototype (demo data) | http://localhost:4420/plans/rail/prototype/index.html (places by hash: `#chat`, `#runs`, `#run/ID`, `#schedules`, `#workflows`, `#marketplace`, `#projects`, `#insights/spend`, `#settings`, `#requirements`); also `run-page.html` (task cases, tools panel › Run), `pulse.html`, `components.html` (gallery), `stillhet-switch.html`. Demo inputs: `?first` (newcomer), `?state=empty\|loading\|failed\|offline\|refresh-failed\|connection-lost\|session-expired\|thread-loading\|thread-failed\|thread-gone\|task-loading\|task-failed\|task-gone\|update-asks\|action-failed`, `?invite=stillhet` |

**Never use http://localhost:4317.** It is the owner's live instance.

**Writes** (items marked **W**):
- **Scratch project.** On A and B, writes happen only in a scratch project. Make it with `git init` in a temp folder, add it by hand as `stillhet-scratch-<target>`, and delete it at the end. Never write to any other project.
- **Real runs.** Before starting any run, read `serverMock` in the WS `hello` frame (`ui/server.mjs` sends it). If it is false:
  - Classic: turn on New run's **Mock** switch (`#mock-switch`).
  - Stillhet: it always sends `mock: false` (`live/chat-live.mjs`), so it may start runs only on an instance with `serverMock: true` (`WORCA_MOCK=1`). Otherwise mark the item `blocked: no mock`.
- **Mock workflows.** If the workflow list has a mock or dry-run workflow, prefer it. Find one with `curl -s :450X/api/workflows | jq '.[]|select((.name+.id)|test("mock|dry";"i"))|{id,name}'`. If none exists, rely on server mock.
- **Global writes** (**W-g**) change the whole install: plugin install/remove, Settings values, flags, Delete all chats, Labs. Do them only on C and D, then restore.

## 3. Evidence rule

A check passes only when both of these hold:
1. The outcome is verified in the UI.
2. Where the check writes, the outcome is also verified in the API or state. For example, GET the run, the thread, the label, the schedule or the project after the action and quote the field.

Also:
- Every check attaches the console errors and the failed network requests of its page.
- Screenshots are supplementary, never the evidence.
- For a count or figure, quote the API number next to the UI number on both UIs.

## 4. The checklist

Columns:
- **Classic**: way in on A/C.
- **Stillhet**: way in on B/D.
- **P**: the prototype page or cell.
- **T**: the targets the item applies to.
- **Verify**: the expected outcome.
- **W**: writes (scratch project or mock run); **W-g**: global write, C/D only.

Rule for every place's **-00** item, the control sweep: click every control of the place in each mode (Simple, Advanced, Expert). Each control must do one of two things:
- Send its request: name it from the network log, and the state must change.
- Be disabled and say why.

Any "Would…" or "Not connected to Worca yet." in B or D is **Wrong wiring**.

### 4.1 Chat (CH)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| CH-00 | Control sweep of Chat home, a conversation, the composer and the chats bar | `#chat` | `#chat` | `#chat` | ABCD | every control acts or says why; no "Would…" | |
| CH-01 | Chat home loads | `#chat` home tabs Needs, Running, Chats, Plans, Workflows | `#chat` home: starters, Follow a task, bar | `#chat` | ABCD | each classic tab's items are reachable in Stillhet (bar, Pulse, starters); counts equal `GET /api/ask/threads?show=all` and running runs; C/D show an empty state, not demo chats | |
| CH-02 | Chats list: all chats, pinned and recent, groups, Show N more | sidebar chats column | chats bar | `#chat` | AB | same chats, same count, same order as `GET /api/ask/threads?show=all`; the open chat never folds behind Show N more | |
| CH-03 | Open an existing chat: every turn and card drawn | `#chat/ID` | `#chat/ID` | `#chat` c1–c18 | AB | same turns as `GET /api/ask/threads/:id`; no turn missing; markdown (lists, code, tables, links in a new tab) drawn by Prose | |
| CH-04 | New chat and send | composer | composer (Chat home or conversation) | `#chat` | ABCD | `POST /api/ask/threads` then `…/messages` carries model, effort, project; a refusal keeps the text | W |
| CH-05 | Stop a reply | Stop | composer Stop | `#chat` | AB | `POST …/stop`; the turn ends stopped | W |
| CH-06 | Attach files | composer attach | composer + › Files | `#chat` | AB | message `attachments`; FilesCard shows them | W |
| CH-07 | `@` mention a task | `@` menu | composer `@` menu | `#chat` | AB | the message carries the task's name and run id | W |
| CH-08 | Answer ref chips (run, PR, chat refs) | ref chips | RefChip in Prose | `#chat` | AB | `POST /api/ask/refs/resolve`; each chip opens its task, PR or chat | |
| CH-09 | Project scope picker | composer project | composer project picker | `#chat` | AB | `PATCH …{scope}` is answered before the picker changes; after the first send it shows the chat's project, not "No project" | W |
| CH-10 | Model, effort, engine switch | composer engine | engine picker grouped by engine | `#chat` | AB | list equals `GET /api/ask/models`; another engine's model → `POST …/engine` | W |
| CH-11 | MCP Sets (Advanced+) | composer sets | Sets picker | `#chat` | AB | ticks equal `POST /api/ask/mcp-preview`; off → `PATCH {mcpOff}` | W |
| CH-12 | Prompt check chip, kind correction, Improve | composer chip | sentence-row chip, RewriteSuggestion | `#chat` | AB | `POST /api/prompt-check/grade`, `/kind-correction`, `/improve`; hidden when the `promptCheck` pref is off | |
| CH-13 | Pick a workflow for a task from chat | composer / proposal workflow | composer workflow picker, "Select workflow" | `#chat` | AB | lists `GET /api/workflows`; the proposal carries `workflowId` (known major: none listed) | |
| CH-14 | Run proposal: where it runs, branches, guardrails, perspectives "reviewed by", Start, Not now | proposal card | TaskProposal | `#chat` | AB | Start → `POST /api/run` with `askThreadId`/`askCardId` and the perspective set; Not now → card verb | W |
| CH-15 | Question card: choice, text, Use Worca's picks | question card | OptionList | `#chat` | AB | `POST …/cards/:cardId {choice\|text}`; your own answer drawn | W |
| CH-16 | Run card status: state, step n of m, live progress | run card | TaskCard status line | `#chat` | AB | matches the run's live state and step; updates on frames without reload | |
| CH-17 | Run card actions: Pause, Resume, Stop | run card | TaskCard ⋯ (run-state flow) | `#chat` | AB | `POST /api/pause\|resume\|stop`; card and `GET /api/history/:key/:id` agree | W |
| CH-18 | Run card actions: Create PR, open changes, download patch, apply files, save plan, archive, label, watch, copy PR link, open terminal, open Settings › Budget or Team › Policy | run card buttons | TaskCard ⋯, act rows | `#chat` c17, c18 | AB | each route as in the wiring's Chat capabilities row; a done task's ⋯ has Start a follow-up, Report this task, Archive (known gap) | W |
| CH-19 | Run card information: cost, time, branch, PR state, checks, Ready to merge | run card | TaskCard | `#chat` c18 | AB | every field classic shows is present; PR line is "Ready to merge" with checks, not a raw URL | |
| CH-20 | Shaper PlanCard: Approve and build, Ask for changes, Read the plan (coverage, role reviews), Save to plans/, Stop, Fix all, decisions | plan card | PlanCard under TaskCard | `#chat` | AB | `POST /api/runs/:id/answer {decision}`; `GET …/plan`; `…/plan/save`; decisions carry Worca's pick | W |
| CH-21 | A feature's total cost and time | feature card | TaskCard folded Figures | `#chat` | AB | equals `GET /api/run-groups` `cost.usd`; time first start to last end | |
| CH-22 | Ask for changes on a run; directions to a followed run | card actions | under TaskCard; ⋯ Send a direction | `#chat` | AB | `POST …/changes`, `…/directions` | W |
| CH-23 | Workflow and workflow-build cards: Save workflow, Not now, Run with {name} | action card | ChangeProposal with steps / one TaskProposal | `#chat` | AB | save → `POST /api/workflows`; thenRun → one linked run, never a second card | W |
| CH-24 | run-stop, pull-request, changes, route, script-approval cards | action cards | TurnRows | `#chat` | AB | each verb → `POST …/cards/:cardId {verb\|state}`; Create PR → `POST /api/pr` | W |
| CH-25 | Ship card: requirement marks, one PR or stacked, Create PR | ship card | Ship ChangeProposal | `#chat` | AB | acceptance PUT per mark; Create PR off until all are marked; `POST /api/shape/features/:id/ship {mode}` | W |
| CH-26 | ChangeProposals (scope-switch, model, schedule, away, proxy, web, clone, project, workspace, actions, metrics, policy) and receipt Revert | thread cards | ChangeProposal rows before → after, Apply, Not now, Revert | `#chat` c11 | AB | Apply/Revert send the card verb and the setting changes in its API; metrics/policy rows are words, not "Change: enable"; scope-switch says "This chat is on X now" | W |
| CH-27 | Command cards: Copy, Stop, Show in terminal | command card | CommandRow / CommandGroup, TerminalPane | `#chat` | AB | `POST /api/terminal/sessions/:id/stop`; terminal output streams | |
| CH-28 | Files card: open, download, Show in folder | files card | FilesCard | `#chat` | AB | `GET …/attachments/:attId` opens in a new tab; `POST …/reveal` | |
| CH-29 | Failed reply (Details, Try again); notice, divider, unknown card | ask-error | failed TurnRow, TurnDivider, notice | `#chat` | AB | Try again resends; unknown shows its title, never its type id | |
| CH-30 | Rename, pin, archive (+Undo), delete a chat | row menu | bar row menu and bulk bar | `#chat` | AB | `PATCH` / `DELETE /api/ask/threads/:id`; Undo is the reverse PATCH; delete asks first | W |
| CH-31 | Chat labels | none (new) | conversation head + Label | `#chat` | AB | `PUT /api/ask/threads/:id/labels`; vocabulary `GET /api/ask/labels`; 32 chars, 50 a chat | W |
| CH-32 | Chat groups: add, rename, delete, undo, suggested name | group dialog | Add to group, Rename, Delete, Undo | `#chat` | AB | `ui/routes/chat/groups.mjs` routes; state after reload | W |
| CH-33 | Search chats | top bar search | top bar search (page first) | `#chat` | AB | `GET /api/ask/threads?q=`; same hits as classic | |
| CH-34 | Unread dot when a reply lands elsewhere | sidebar dot | bar dot | `#chat` | AB | `ask-done`/`ask-error` lights it; opening clears it | |
| CH-35 | External origin mark | row mark | row origin mark | `#chat` | AB | threads with `origin` show it | |
| CH-36 | Chat home pins (starters) | home pins | starters row | `#chat` | AB | `PUT /api/chat-home/pins`, answered first; named by `GET /api/workflows` | W |
| CH-37 | Chat worktrees (Expert): list and remove | chat worktrees | conversation head Worktrees · N | `#chat` | AB | "Remove this worktree?" then `DELETE …/worktrees/:wtId` | W |
| CH-38 | Voice: dictate, hands-free | mic | composer mic, Voice options | `#chat` | AB | needs a microphone: list it for the owner, check that the control shows and its settings link | |
| CH-39 | Follow a task | none | Chat home Follow a task | `#chat` | AB | new chat sends "Follow the task … (run ID)"; toast waits for ok | W |
| CH-40 | A task opens the chat that started it; a scheduled run with no card opens by its address | run-links | bar task rows, `chatOfTask` | `#chat` | AB | `GET /api/ask/run-links`; no dead link | |
| CH-41 | Side chat beside a page vs hand to Chat | `#ask-side` side mode, ⌘J | ⌘J / top bar Ask → Chat with the page chip; Back returns | `#chat` | AB | the chip is removable; the answer has the page context (`pageProjectKey`, `pageWorkspaceId`); Back returns to the page | W |
| CH-42 | Send while a reply streams (queue) | composer | composer | `#chat` | AB | the second message queues and sends after the reply | W |
| CH-43 | Chat states: loading, failed, gone | n/a | open a bad `#chat/ID`; drop the network | `?state=thread-loading\|thread-failed\|thread-gone` | BD | the design's state shows, not a blank or demo thread | |

### 4.2 Tasks and the task page (TK)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| TK-00 | Control sweep of the Tasks center, the bar rows, the task page and the group page | `#runs`, run page | `#runs`, `#run/ID`, `#run/group:ID` | `#runs`, `run-page.html` | ABCD | every control acts or says why | |
| TK-01 | Tasks list: every task with its fields (title, project, state icon, time, cost, labels, cost tags, PR, person, workflow) | `#runs` list | Tasks bar rows + center | `#runs` | ABCD | count equals `GET /api/history` plus running runs; each field classic shows is on the row (known: tags, workflow) | |
| TK-02 | Tasks center cards (needs you, running, ready, by workflow) | none | `#runs` center | `#runs` | ABCD | sums agree with the list; by-workflow grouping works (known partial: no workflow id) | |
| TK-03 | Filters: state, label, project, person, "using workflow", archived | `#runs` filters | bar filters, sentence filters | `#runs` | AB | each filter's result count equals classic's; "using workflow" is not empty (known) | |
| TK-04 | Open a task | `#running/ID`, `#history/KEY/ID` | `#run/ID` (old addresses redirect in place) | `run-page.html` | AB | the same run opens; Back leaves the page in one step | |
| TK-05 | Task page head and facts: state word, project, branch, base, workflow, engine/model, cost, cap, elapsed, PR, labels, started by, schedule | Overview tab | page head and metadata line | `run-page.html` | AB | every Overview field of classic is present and equals `GET /api/history/:key/:id` | |
| TK-06 | Stages: each stage's time, cycles, cost, the running one; graph (Advanced/Expert) or story (Simple) | Workflow tab | stages, graph | `run-page.html` | AB | stage list and costs equal classic; the running stage is lit | |
| TK-07 | **Logs**: run log and step logs, Summaries and Raw, by cycle and by agent, First error, Copy, Follow live | Logs tab (Summaries/Raw, filters) | Activity › Logs; a stage's Log | `run-page.html` Activity | AB | lines equal `GET /api/history/:key/:id/log`; live run lines stream; Copy copies the shown lines; a finished no-project run shows its log (#1266) | |
| TK-08 | **Agent output**: agents per step, their messages | Agents tab | Agents | `run-page.html` | AB | each agent and its output as classic | |
| TK-09 | Sessions and the trace | Sessions tab | Sessions › Open the transcript | `run-page.html` | AB | `GET /api/runs/:id/sessions`, `…/sessions/:sid/trace` | |
| TK-10 | **Costs** per step and Step usage (tokens, telemetry) | Overview/Workflow costs, telemetry | Step usage, stage costs | `run-page.html` | AB | sums equal classic and `GET /api/runs/:id/telemetry`; no 404 when `runTelemetry` is off | |
| TK-11 | **Diff / Changes**: file list, counts, a file's whole diff, Refresh, live diff of a running task, folder run's Changes | Diff, Changes tabs | Changes part, Open the whole diff, Changes ▾ › Refresh | `run-page.html` | AB | files and +/− equal `GET /api/history/:key/:id/diff` or `/api/runs/:id/live-diff`; a Restart Build round re-reads its saved diff | |
| TK-12 | Diff-line comments | Diff comment | Changes › Comment on a line | `run-page.html` | AB | `POST /api/history/:key/:id/comments`; shown after reload | W |
| TK-13 | Artifacts and documents: list, view in place, Previous/Next, Open full, Download | Artifacts tab | Changes' documents, viewer | `run-page.html` | AB | `GET /api/runs/:id/artifacts`, `/artifact`, `/artifact-raw` | |
| TK-14 | Q&A history ("Answered for you", See the answers) | Q&A tab | question part | `run-page.html` | AB | every asked question and answer is shown | |
| TK-15 | Answer a running task's question; Use Worca's picks | Q&A / question panel | question part | `run-page.html` | AB | `POST /api/answer`; the run continues | W |
| TK-16 | Plan approval: Approve and build, Ask for changes, Full plan, Save to plans/ | plan gate | plan case, center's Approve | `run-page.html` plan | AB | `POST /api/runs/:id/answer`; `GET …/plan`; reads "Needs approval" with a pencil, Plan step not done | W |
| TK-17 | Pause, Pause after this step, Resume, Stop | run page | action slot and ▾, card ⋯, bar menu | `run-page.html` | AB | `POST /api/pause {afterStep}`, `/resume`, `/stop`; state in `GET` agrees; Stop asks first | W |
| TK-18 | Cost cap: Raise the cap, Continue without cap, team-cap reason | cap dialog | capped case's main action, ▾, team-cap dialog | `run-page.html` capped | AB | `POST /api/resume {costCapUsd\|ignoreCostCap}`; "Paused at its cap" shown | W |
| TK-19 | Restart Build, Retry, Try again | run page | failed/stopped cases, c17 Retry | `run-page.html` failed | AB | `POST /api/runs/:id/restart-build` or `/api/resume`; refusal on one line | W |
| TK-20 | Switch model; Resume at… | paused run | paused task's ▾ | `run-page.html` | AB | `POST /api/resume {model}`; Resume at… off on a cost cap | W |
| TK-21 | Create PR (PR dialog, describe), Watch, Resolve, checks, mergeable | Create PR | ready/in-review cases, PR dialog, ▾ Watch | `run-page.html` ready | AB | `POST /api/pr`, `/describe`, `/watch`, `/resolve`; `GET /api/pr/checks` | W |
| TK-22 | Merge PR, Re-run checks, Fix checks, reviewers "Approved by" | PR panel | approved/failing cases, center Merge | `run-page.html` | AB | `POST /api/pr/merge` asks first and refuses without a review verdict; `/rerun-checks`, `/fix-checks` | W |
| TK-23 | Publish branch | Publish branch | ready case's Publish branch | `run-page.html` | AB | `POST /api/runs/:id/publish` | W |
| TK-24 | Check out, Try it, Copy git commands, copy branch | Actions tab | Changes › Check out; ⋯ › Try it | `run-page.html` | AB | `POST /api/runs/:id/checkout`, the first service started, localhost Open | W |
| TK-25 | Terminal, services, built-in tools, stacks | Actions tab | ⋯ › Terminal (Ctrl+\`), Changes › Actions, Stack rows | `run-page.html` | AB | `POST /api/runs/:id/terminal`, `…/actions/:id/start\|stop`, `…/builtins/:key`, `…/stacks/:id/start\|stop` | W |
| TK-26 | Base moved: base check, update branch, resolve, Sync log | base strip | base-moved strip, Resolve in a terminal, ⋯ › Sync log | `run-page.html` | AB | the strip shows when classic does; Sync log opens Activity › Logs | W |
| TK-27 | Kept work: Apply to branch, Discard, recovery patch | kept case | kept/failed-kept cases, Changes ▾ › Download patch | `run-page.html` | AB | `POST …/apply-retained`, `…/discard-worktree` (asks first), `GET …/recovery-patch` | W |
| TK-28 | Failure box: bold head, details, copy error, Ask Worca to fix it, Show the log | Overview error | failure part | `run-page.html` failed | AB | head not repeated; Details copies title and text | |
| TK-29 | Report this task | report modal | ⋯ › Report this task | `run-page.html` | AB | `POST /api/pipelines/:id/report-issue` | W |
| TK-30 | Save as preset | run page | ⋯ › Save as preset | `run-page.html` | AB | `POST /api/pipelines/:id/preset`; offered only with a stored setup | W |
| TK-31 | Away mode on a running task | run page | ⋯ Away mode | `run-page.html` | AB | `POST /api/run/night` | W |
| TK-32 | Labels and cost tags on a task | Label | page + menu, metadata line, bar Label | `run-page.html` | AB | `PUT /api/runs/:id/labels`; shown on the row and page (known: tags missing) | W |
| TK-33 | Archive, restore, delete (single and bulk); archived view | row/bulk Archive, Delete | bar row menu, bulk bar, page ⋯ | `#runs` | AB | `POST /api/runs/bulk {action}`; Delete's confirm says what it removes; resumable run asks first | W |
| TK-34 | Bulk label (respects the `runLabels` flag) | bulk Label | bulk bar Label | `#runs` | AB | `POST /api/runs/bulk/labels` | W |
| TK-35 | Run groups: Add to group, Remove, Move to group…, Undo | Group | bar menu, ⋯ › Move to group… | `#runs` | AB | `/api/run-groups…` routes; members fold under one row | W |
| TK-36 | Group page: members, state word, Runs/Overview/Decisions/Logs content, Merge #N, Fix checks on #N | `#feature/ID`, `#group/ID` (tabs Runs, Overview, Decisions, Logs) | `#run/group:ID` | `run-page.html` chain | AB | every classic tab's content has a place; a re-planned feature opens its newest plan (classic shows v1: known) | |
| TK-37 | Ship a group: one PR, several, stacked | ship-it dialog | group Create PR and ▾ "… instead", confirm | `run-page.html` | AB | `GET …/combine`, `POST /api/run-groups/:id/ship` or `/api/shape/features/:id/ship` | W |
| TK-38 | Start a new task: project or No project, workflow, engine, base, source branch, then, cost cap, agents per step, files, sync before start | `#new` | + › New task… (More options) | `#runs` + | ABCD | `POST /api/run` body as in the wiring's Tasks row; files as `extras`; mock (see §2) | W |
| TK-39 | Run after / chain (`#new/after`) | `#new/after` | Run after this (schedules), New task "It starts once X ends" | `#runs` | AB | `POST /api/run {after, afterPolicy}` | W |
| TK-40 | "Merge when checks pass" at start | none | not offered live | `#runs` + | BD | live does not draw it, or says why | |
| TK-41 | Open the PR on GitHub from a row | View PR | row View PR | `#runs` | AB | opens `pr.url` in a new tab | |
| TK-42 | Copy link; in-view tab keep and drop | n/a | ⋯ › Copy link; top bar in-view tab × | `run-page.html` | B | link reopens the task; × drops a `task:run:ID` tab (known bug) | |
| TK-43 | Glance vs Details modes | run page `data-mode` glance/details | one task page | `run-page.html` | AB | everything in Details has a place | |
| TK-44 | Shaper slice rows, fix rounds folded under the origin | runs list | bar rows, rounds | `#runs` | AB | a slice has its own row with its type icon; a fix round opens from its lit origin row | |
| TK-45 | Multi-repo PR cases (worca-api #212 …), folder cases, "copy 3 PR links", "git switch {groupBranch}" | n/a | not offered live | `run-page.html` | BD | not drawn live, never a demo PR number | |
| TK-46 | Task page states: loading, failed, gone, no-project task, folder run | `#history/KEY/bad` | `#run/bad` | `?state=task-loading\|task-failed\|task-gone` | ABD | the design's state; a no-project task opens its real page, not a demo page | |
| TK-47 | Mock run indicator and choice | New run Mock switch | none seen | `#runs` + | AB | Stillhet shows when a run is a mock run; no way to pick mock is a **Design gap** to report | |

### 4.3 Schedules (SC)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| SC-00 | Control sweep | `#schedules` | `#schedules`, a schedule page | `#schedules` | ABCD | every control acts or says why | |
| SC-01 | List: series and one-offs, counts, next times | tabs Once, Repeating, Activity | center + bar (Advanced+) | `#schedules` | ABCD | count equals `GET /api/schedules` (schedules + tickets); next time equals the server's | |
| SC-02 | Schedule fields: repeat sentence, time, next, project, workflow, preset ("from X", "preset deleted"), `after TITLE`, status; Expert overlap, failures before pause, if missed, grace | schedule rows / sheet | page sentence, Expert line | `#schedules` | AB | every classic field present and equal | |
| SC-03 | History of a series (last 50 fires) and Activity tab | Activity tab | page TaskCards | `#schedules` | AB | equals `GET /api/schedules/:id` `history` | |
| SC-04 | Ended series | list | Ended section | `#schedules` | AB | status ended listed apart | |
| SC-05 | Run now (series, missed ticket) | Run now | head, bar ⋯, center, Chat card, Pulse | `#schedules` | AB | `POST /api/schedules/:id/run-now`; a task appears | W |
| SC-06 | Stop the running fire | Stop | page head | `#schedules` | AB | `POST /api/stop {pipelineId}` | W |
| SC-07 | Pause / Resume | toggles | head, ⋯, bar, center, Chat card | `#schedules` | AB | `POST …/pause\|resume`; status in GET | W |
| SC-08 | Skip next / Keep next | Skip | ⋯ | `#schedules` | AB | `POST …/skip-next`, `…/keep-next`; `skippedRunAt` | W |
| SC-09 | Delete a series, cancel a one-off, Undo, dependents note | Delete | ⋯, notice Undo | `#schedules` | AB | `DELETE` after the Undo window; "Y was waiting for it"; a refusal brings the row back | W |
| SC-10 | Edit repeat, time, Expert options, grace as a draft; Save, Discard | edit sheet | sentence + DraftBar | `#schedules` | AB | `PATCH /api/schedules/:id` on Save only; leave/return keeps the draft | W |
| SC-11 | Change what a one-off waits for | Change… | `after TITLE` picker | `#schedules` | AB | `PATCH {after}` | W |
| SC-12 | New schedule: Ask in chat; Legacy approach form (Advanced+); none in Simple | schedule sheet | Schedules + | `#schedules` | ABCD | `POST /api/run {repeat}`; the zone is the browser's | W |
| SC-13 | Run after this (a one-off still to come) | Schedule next… | page ⋯, bar ⋯ | `#schedules` | AB | `POST /api/run {after:{kind:'ticket'}}` | W |
| SC-14 | Alarms: missed, failed, paused itself | sidebar "Scheduled runs that need a look", Activity menu | bell, Pulse Needs you | `#schedules` | AB | rows equal `GET /api/notifications` and missed tickets | |
| SC-15 | Old tabs `#schedules/once`, `/repeating`, `/activity` | tabs | redirect to Schedules | n/a | B | land in Schedules, in place | |
| SC-16 | A failed ticket's Open project → Locate folder… | n/a | ticket action | `#schedules` | AB | lands on the project page with Locate folder… | |
| SC-17 | Run now on a series made from a chat card | Run now | Run now | n/a | AB | known: fails "card is scheduled" on both UIs | W |

### 4.4 Workflows (WF)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| WF-00 | Control sweep | `#workflows` | `#workflows` | `#workflows` | ABCD | every control acts or says why | |
| WF-01 | Library: workflows (built-in and own), usage counts | `#workflows` library | `#workflows` browsed like Marketplace | `#workflows` | ABCD | count equals `GET /api/workflows`; usage equals `GET /api/workflow-usage` | |
| WF-02 | Open a workflow: steps, agents, models, feedback loops, node tunables; graph (Advanced/Expert), story (Simple) | `#workflows/ID` composer | `#workflows/workflow:ID` | `#workflows` | AB | every step and setting classic shows is present; graph equals the template | |
| WF-03 | Create a workflow: Ask in chat; Legacy approach "Edit by hand" draft | composer New | + menu | `#workflows` | ABCD | Save → `POST /api/workflows`; a draft until saved | W |
| WF-04 | Edit and save; refuse a changed base | composer Save | canvas Save | `#workflows` | AB | the change is in `GET /api/workflows/:id`; a changed base is refused (known race) | W |
| WF-05 | Built-in opens as a copy; Duplicate | Library row | open built-in | `#workflows` | AB | the built-in is never overwritten | W |
| WF-06 | Delete a workflow | Delete | ⋯ Delete | `#workflows` | AB | asks first; gone from GET | W |
| WF-07 | Import JSON; Export as JSON or as a Claude Code skill or plugin | import, `#export-format` dialog | Import, canvas Export | `#workflows` | AB | `POST /api/workflows/import-json`; `GET /api/workflows/:id/json` downloads | W |
| WF-08 | Agents: list, open, edit, duplicate, delete, regenerate, new agent wizard | `#workflows/agents`, `/agents/KEY`, `/agents/new` | `#workflows/~agents`, `agent:KEY` | `#workflows` | AB | the agent routes; old `#agents`, `#agent-create` redirect | W |
| WF-09 | Scripts: list, open, new, run the saved cases | `#workflows/scripts`, `/scripts/KEY` | `#workflows/~scripts`, `script:KEY` | `#workflows` | AB | `POST /api/scripts/bench {key, all:true}` result shown | W |
| WF-10 | Pin a workflow to Chat home | pin | pin | `#workflows` | AB | `PUT /api/chat-home/pins` | W |
| WF-11 | Drafts survive navigation; discard asks | composer guardDiscard | inline drafts | `#workflows` | AB | leave and return keeps the draft; discard asks | |
| WF-12 | Team way (share with team) | none | not offered live | `#workflows` | BD | not drawn, or says why | |
| WF-13 | Open in Workflows from a chat card or a task's Workflow dialog | Open in Workflows | Workflow dialog | `#workflows` | AB | opens that workflow | |
| WF-14 | Old addresses `#composer`, `#agents`, `#scripts`, `#agent-create`, `#workflows/ID` | MOVED_ROUTES | old-addresses | n/a | AB | each lands on its Stillhet target | |

### 4.5 Marketplace (MK)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| MK-00 | Control sweep | `#marketplace` | `#marketplace` | `#marketplace` | ABCD | every control acts or says why | |
| MK-01 | Catalogue loads; first run syncs the builtin once | tabs Browse, Installed, Marketplaces | `#marketplace` | `#marketplace` | ABCD | on D: "Loading the catalogue…", then the catalogue; an empty one offers Sync; count equals classic Browse | |
| MK-02 | Browse and filter by kind | Browse | `#marketplace/~all` | `#marketplace` | AB | same plugins | |
| MK-03 | Plugin page: description, version, kinds, source, provenance, open on GitHub | plugin modal | `#marketplace/NAME` | `#marketplace` | AB | fields equal `GET /api/plugins/:name`; GitHub link is `webUrl` | |
| MK-04 | Install, choose projects | install sheet | Install | `#marketplace` | CD | plugin routes; shown as installed | W-g |
| MK-05 | Installed: list, update (preview, apply), update all, remove | Installed | `#marketplace/~installed` | `#marketplace` | ABCD | lists equal; update/remove on C/D only | W-g |
| MK-06 | Set it up (config) | manage sheet | set it up form | `#marketplace` | CD | `GET`/`PUT /api/plugins/:name/config` | W-g |
| MK-07 | Where plugins come from: sync, add, remove a source, open on GitHub | Marketplaces tab | sources section | `#marketplace` | ABCD | `POST /api/marketplaces…`; add/remove on C/D | W-g |
| MK-08 | For you | none | not offered live | `#marketplace` | BD | not drawn live | |
| MK-09 | An update that asks for something new | update sheet | form.update-asks | `?state=update-asks` | CD | the form asks; values saved | W-g |
| MK-10 | Ticket updates section, task-source connectors | ticket-updates-section | ? | `#marketplace` | AB | present in Stillhet, or **Design gap** | |
| MK-11 | Export marketplace / Share as plugin | export dialog, Models › Share as plugin… | ? | `#marketplace` | AB | mapped, or **Design gap** | |
| MK-12 | Old addresses `#plugins`, `#marketplace/installed/X`, `/browse/…`, `/marketplaces` | MOVED_ROUTES | old-addresses | n/a | B | land in place | |

### 4.6 Projects and Workspaces (PJ)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| PJ-00 | Control sweep | `#projects`, `#workspaces` | `#projects`, `#projects/KEY`, `#projects/ws:ID` | `#projects` | ABCD | every control acts or says why | |
| PJ-01 | Projects list or center: name, path, git state, behind/ahead, origin, tasks needing you, this month's spend | `#projects` | `#projects` center + bar | `#projects` | ABCD | count equals `GET /api/projects`; every classic field present | |
| PJ-02 | Project page Overview fields | `#projects/KEY` Overview | `#projects/KEY` | `#projects` | AB | equal to classic Overview | |
| PJ-03 | Add a project: Ask in chat; by hand (path); clone a URL | Add project dialog | + › Legacy approach › Add a project by hand | `#projects` | ABCD | `POST /api/projects` or `/clone`; scratch only | W |
| PJ-04 | Rename | settings | Rename… | `#projects` | AB | `PATCH {name}` on the scratch project | W |
| PJ-05 | Locate a moved folder | missing-folder state | Locate folder… | `#projects` | AB | `PATCH {path}` | W |
| PJ-06 | Remove, with Undo | Remove | Remove… | `#projects` | AB | `DELETE /api/projects?name=` after the Undo window | W |
| PJ-07 | Sync, Check origin now, Retry | sync controls | Sync, Check origin now | `#projects` | AB | `POST …/sync {mode:'ff'\|'fetch'}` on scratch | W |
| PJ-08 | Use git; link a repository or remote | git setup | Use git, Link a remote… | `#projects` | AB | `POST …/git-init`; remote set | W |
| PJ-09 | How its tasks run (project settings), Away | Settings tab, `/away` | How its tasks run | `#projects` | AB | `GET`/`PATCH /api/projects/:key/settings` | W |
| PJ-10 | Team memory, Memory notes | Memory tab, `/memory/NAME` | Team memory | `#projects` | AB | `PATCH {'memory.…'}`; memory notes have a place, or **Missing function** | W |
| PJ-11 | Cost tags, Who pays, Labels defaults | Settings tab | Cost tags, Who pays and Labels | `#projects` | AB | `GET`/`PUT /api/projects/:key/tags/defaults` | W |
| PJ-12 | Project Team, Sets (MCP), Actions, Automations tabs | `/team`, `/mcp`, `/actions`, `/automations` | stopgap: land on the project page | n/a | AB | each tab's content is reachable somewhere in Stillhet; if not, **Missing function** (slice 12 owes it) | |
| PJ-13 | Branch names | settings | not offered live | `#projects` | BD | not drawn live | |
| PJ-14 | This month's spend equals Insights | n/a | project fact | `#projects` | B | equals the Insights project row | |
| PJ-15 | Workspaces list (Projects by workspace, Advanced+) | `#workspaces` | `#projects` by workspace | `#projects` | ABCD | count equals `GET /api/workspaces` | |
| PJ-16 | Workspace page: Overview, Map, questions (Is this right?), open in editor | `#workspaces/ID` Overview, Map | `#projects/ws:ID` | `#projects` | AB | map equals classic; answer → `PUT …/map/edges/:edgeId` | W |
| PJ-17 | Make a workspace by hand; scan wizard | `#workspace-create` wizard (scan model, import) | + › Make a workspace by hand | `#projects` | ABCD | draft until Save, then `POST /api/workspaces`; scan model choice has a place | W |
| PJ-18 | Edit by hand: name and members | members | Edit by hand | `#projects` | AB | `PATCH /api/workspaces/:id`, `POST …/members` | W |
| PJ-19 | Scan again; Sync what is behind | Scan | Scan again, Sync what is behind | `#projects` | AB | `POST …/scan`; member sync | W |
| PJ-20 | Delete a workspace, with Undo | Delete | Delete… | `#projects` | AB | `DELETE /api/workspaces/:id` after Undo | W |
| PJ-21 | Workspace cost tags and Labels | n/a | Cost tags and Labels | `#projects` | AB | `GET`/`PUT /api/workspaces/:id/defaults` | W |
| PJ-22 | Workspace Team, Actions, Automations tabs | `#workspaces/ID/team\|actions\|automations` | ? | n/a | AB | mapped, or **Missing function** | |
| PJ-23 | Start a task across all members | workspace | workspace page | `#projects` | AB | starts one task on the workspace | W |
| PJ-24 | A behind project in Pulse Needs you → Sync | n/a | Pulse item Sync | `pulse.html` | AB | names behind count, effect, fix; Sync clears it | W |

### 4.7 Insights (IN)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| IN-00 | Control sweep | `#stats`, `#team-metrics` | `#insights/…` | `#insights/spend` | ABCD | every control acts or says why | |
| IN-01 | Insights center and the classic Overview | `#stats` Overview | `#insights` center | `#insights/spend` | ABCD | each classic Overview figure has a card; C/D show an empty state, not demo figures | |
| IN-02 | Spend | Stats Cost | `insights/spend` | same | AB | equals `GET /api/stats` `totals.spentUsd` and classic for the same range | |
| IN-03 | Per task, Budget, Time saved, Value for spend | Stats | `insights/per-task`, `budget`, `time-saved`, `value` | same | AB | formulas per the wiring; Budget against `GET /api/budget` | |
| IN-04 | How tasks end, Where it fails | Stats | `insights/ends`, `fails` | same | AB | finished/failed/stopped equal classic | |
| IN-05 | Shipped, Throughput | Stats | `insights/shipped`, `throughput` | same | AB | prsMerged, prsOpened, finished | |
| IN-06 | Ranges: Today, week, month, last month, Quarter, Year, All, Custom | Stats ranges; Team metrics Quarter, Year | range picker | same | AB | each classic range exists; figures equal per range | |
| IN-07 | Filters: project, tag dimension, person, saved views | Stats dims, cost-dimension picker | sentence filters, Save this view | same | AB | equal sums; `of=` keys checked against live keys | |
| IN-08 | By person (team) | Stats By person; Team metrics Overview | `insights/team` | same | AB | equals `GET /api/team-metrics` through `aggregate()` | |
| IN-09 | Missing cost tags; Tag these N tasks; Set a default for a project | Team metrics todos | `insights/untagged` | same | AB | rows equal `missingKeyTodos()`; Tag hands to Chat; Set a default opens project tags | W |
| IN-10 | Shaping spend; Who spends where (heat) | Stats, cost heat grid | `insights/shaping`, `insights/heat` | same | AB | equal `shaping.groups`, `heatGrid()` | |
| IN-11 | Team scope | Team metrics scope | team scope picker | same | AB | `GET /api/team-metrics/scopes` | |
| IN-12 | Download CSV; Copy link | Stats export | Download CSV, copy link | same | AB | CSV equals `reportCsv`; the link has only what you narrowed, no `scope=` | |
| IN-13 | Six not-live pages: Why it cost, Review, Autonomy, Cache, Start to merge, Waiting on you | none | `insights/why`… | same | BD | live says not offered, never demo figures | |
| IN-14 | Team metrics Timeline | `#team-metrics/timeline` | lands on By person | n/a | AB | known: no home, **Missing function** until a Team page | |
| IN-15 | Team metrics enable, Push now, Check now | Team metrics | none | n/a | AB | known: no home | |
| IN-16 | Insights agree with Tasks (sum of task costs, counts) | n/a | Insights vs Tasks | n/a | B | totals agree within the local vs UTC day difference | |
| IN-17 | Old addresses `#stats`, `#stats/…`, `#statistics`, `#team-metrics/…` | n/a | old-addresses | n/a | B | land on `insights/spend`, `insights/team` | |

### 4.8 Pulse, top bar, navigation and old addresses (NV)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| NV-00 | Control sweep of the shell: sidebar, top bar, Pulse, bell, profile menu | sidebar, topnav | shell | `#chat`, `pulse.html` | ABCD | every control acts or says why | |
| NV-01 | Places per mode | sidebar `data-nav` (Chat, Design, Runs, Schedules, Requirements, Workflows, Marketplace, Projects, Workspaces, Stats, Team metrics, Team policy, Connectors, Models, Providers, Settings) | `PLACES` (Chat, Tasks, Schedules, Workflows, Requirements, Marketplace, Projects, Settings, Insights) | `#chat` | ABCD | every classic item maps to a place (see §4.12); each mode shows the right ones | |
| NV-02 | W full menu; title → the center's home; ▾ quick menu; breadcrumb | sidebar | W, bar title, ▾, breadcrumb | `#chat` | BD | the clicked place opens; the sidebar never leads to the wrong place (owner: leads to Projects) | |
| NV-03 | One search: this page first, then other places | top bar Search or ask (also settings cards) | top bar search | `#chat` | AB | results equal classic's for tasks, chats, projects, schedules, workflows, settings | |
| NV-04 | Ask worca / ⌘J | `#topnav-ask`, side chat | hand to Chat with a page chip; Back returns | `#chat` | AB | see CH-41 | |
| NV-05 | Pulse: Now, Updates, Needs you | Activity menu (Needs, Running, Scheduled), `#activity` | Pulse | `pulse.html` | ABCD | rows equal `GET /api/notifications`, failed/paused outcomes, running runs; `#activity` opens Chat with Pulse on Now | |
| NV-06 | Pulse badge and bell count | `#topnav-activity-n` | Pulse badge, bell head breakdown | `pulse.html` | AB | counted once (a project never twice); badge equals bell rows | |
| NV-07 | A Needs you item says what is wrong, the effect, the one fix; acting clears it | Activity Needs | Pulse/bell row | `pulse.html` | AB | each row type (task, missed schedule, project, workspace question) acts | W |
| NV-08 | Pulse row actions: Resume, Try again, Restart Build, Run now, ask Chat, send a test notification | Activity rows | Pulse rows | `pulse.html` | AB | `POST /api/resume`, `/api/schedules/:id/run-now`, … | W |
| NV-09 | Running tasks and status icons | Activity Running | bar Pulse running, row icons | `pulse.html` | AB | an icon changes within 2 s of the run frame (see SX-06) | |
| NV-10 | Profile menu: usage rings, spend and budget left, Details | account menu, `#profile` | profile menu | `#chat` | ABCD | `GET /api/usage-limits`, `GET /api/budget`; opens in under 1 s (owner: slow) | |
| NV-11 | Interface mode | sidebar mode switch, `ui-levels/mode.html` | profile menu mode | `#chat` | AB | `POST /api/settings {uiLevel}` only on a pick; the page re-renders | W-g |
| NV-12 | Keep awake, Away | sidebar Switches | profile menu | `#chat` | CD | `POST /api/settings {keepAwake}`, `{nightModeToggle}`; `GET /api/away-mode` | W-g |
| NV-13 | Theme: light, dark, system | sidebar theme | profile / shell | `#chat` | ABCD | the theme applies and persists | |
| NV-14 | The Stillhet switch: Labs row; top-bar icon with Try Stillhet / Back to today's UI | Settings › Labs `rail`, top bar | top-bar icon | `stillhet-switch.html` | ABCD (flip on C/D only) | flipping reloads each open page once, never while typing; a flag locked by `WORCA_FLAGS` says why; off gives the same data | W-g |
| NV-15 | Invitation strip | `?invite=stillhet` | ConfirmStrip | `?invite=stillhet` | CD | hidden while the ask switch is off; when shown: Try sets the flag, No thanks is never asked again | W-g |
| NV-16 | Old addresses: each `old-addresses.js` row | MOVED_ROUTES (`#plugins`, `#guardrails`, `#settings/mcp\|models\|providers`, `#composer`, `#agents`, `#scripts`, `#agent-create`) | Stillhet table: `#stats`, `#statistics`, `#team-metrics`, `#pipelines`, `#running/ID`, `#history/KEY/ID`, `#feature/ID`, `#group/ID\|p:\|t:`, `#activity`, `#connectors`, `#models`, `#providers`, `#team-policy`, `#workspaces/ID`, `#workspace-create`, `#new`, `#getting-started`, `#chat/new`, `#plugins`, `#guardrails`, `#schedules/TAB`, `#composer`, `#agents`, `#scripts`, `#agent-create`, `#workflows/…`, `#marketplace/…`, `#projects/KEY/TAB` | n/a | AB | each lands on its target in place; one Back leaves | |
| NV-17 | Unknown address | Chat + "Unknown address" notice | ? | n/a | AB | the same, or the design's equivalent | |
| NV-18 | Connection lost, session expired, reconnect | connection state | banners | `?state=connection-lost\|session-expired` | AB | stop the instance's WS: banner; on reconnect the data refetches without a reload | |
| NV-19 | Running actions, Update available | sidebar indicators | ? | n/a | AB | mapped, or **Design gap** | |
| NV-20 | Keyboard shortcuts sheet | keys-sheet | ? | n/a | AB | mapped, or **Design gap** | |
| NV-21 | In-view tabs (kept pages) in the top bar | n/a | in-view tabs | `#chat` | B | open and × work for every kind (TK-42) | |
| NV-22 | Toasts say only what happened and never cover a page head | notify | rc-toast | `#chat` | AB | position and wording | |
| NV-23 | Away screensaver; level banner | away-screensaver, level banner | ? | n/a | AB | mapped, or **Design gap** | |
| NV-24 | Not-live places say so | n/a | Requirements (and the six Insights pages) | `#requirements` | BD | "not in Stillhet yet", where it lives today, Back to Chat; the bar resets to home | |

### 4.9 Settings (SE)

Wave 3. Mostly sample data. On B/D every row must be either real, with its value equal to classic's `GET /api/settings` or its own route, or plainly not live yet. A row that shows demo values as real is **Wrong wiring**, major.

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| SE-00 | Control sweep | `#settings/*` | `#settings/*` | `#settings` | ABCD | every control acts or says why | |
| SE-01 | Landing and sections | tabs General, Labels & cost tags, Presets, Runs, Automations, Labs, Chat, Guardrails, Memory | groups Work, AI, Access, Add-ons, Worca | `#settings` | ABCD | every classic tab and card (`settings-index.mjs` CARDS) maps to a section | |
| SE-02 | General: setup assistant, appearance, alerts, browser extension, interface mode, Worca root folder, spawn diagnostics, getting started, About and update check | `#settings` | `#settings/general` | same | ABCD | values equal; Check now and Choose version… act | W-g |
| SE-03 | Labels and Cost tags | `#settings/tags` | `#settings/labels` | same | ABCD | values equal `/api/labels` and `/api/tags` (known: demo values) | W-g |
| SE-04 | Presets | `#settings/presets` | `#settings/presets` | same | ABCD | list equals the presets API | W-g |
| SE-05 | Runs: Budget & cost limits | `#settings/runs` budget card | Runs › Spending | same | ABCD | equals `GET /api/budget` | W-g |
| SE-06 | Runs: Away mode, smart run naming, sync before run, scheduled runs | runs cards | Runs › Away mode, Starting | same | ABCD | values equal | W-g |
| SE-07 | Runs: network proxy, wait for the network, machine load, actions, pull requests, workspaces scan models | runs cards | Runs › Limits, Machine | same | ABCD | values equal | W-g |
| SE-08 | Notifications: chat notifications, alerts, Pulse animation (`pulseFor`), send a test | runs/general cards | `#settings/notifications` | same | ABCD | `pulseFor` wired; test sends | W-g |
| SE-09 | Automations (flag gitAutomations) | `#settings/automations` | `#settings/automations` | same | ABCD | shown only with the flag | W-g |
| SE-10 | Labs (feature flags), Labs guide link | `#settings/experimental` | `#settings/experimental` | same | ABCD | flags equal `GET /api/flags`; known row-order diff | W-g |
| SE-11 | Chat: engine & models, limits & access; Prompt check (wired) | `#settings/ask` | `#settings/ask` | same | ABCD | `chatPrefs.promptCheck` toggles the chip (CH-12) | W-g |
| SE-12 | Chat history: Delete all chats | Chat tab | Settings › Chat › History, ConfirmStrip | same | CD | the confirm states dev's counts; `DELETE /api/ask/threads`; toast says what went | W-g |
| SE-13 | Guardrails: list, wizard, `#settings/guardrails/ID` | `#settings/guardrails` | `#settings/guardrails` | same | ABCD | list equal; `#guardrails/ID` redirects | W-g |
| SE-14 | Memory (defragment) | `#settings/memory` | `#settings/memory` | same | ABCD | mapped | W-g |
| SE-15 | Models: engines, roles, model editor, import models, share as plugin, send a test | `#models` | `#settings/models` | same | ABCD | list equals the models routes; send a test acts | W-g |
| SE-16 | Providers | `#providers` | `#settings/models` | same | ABCD | providers listed | W-g |
| SE-17 | Connectors (MCP servers) | `#connectors` | `#settings/connectors` | same | ABCD | servers equal | W-g |
| SE-18 | Team policy: Policy, Plugins, Catalog; copy the policy for a PR | `#team-policy` | `#settings/team` | same | ABCD | equals `GET /api/policy`; copy works | |
| SE-19 | Credentials (credential broker only) | credentials card | Credentials, Open Models | same | AB | shown only with a broker | |
| SE-20 | Report a bug, suggest an improvement | About | `#settings/general` | same | AB | opens a GitHub issue in a new tab | |
| SE-21 | Copy a setting's value | n/a | copy | same | AB | clipboard has the value | |
| SE-22 | Plugins section | Marketplace | `#settings/plugins` | same | AB | leads to Marketplace or lists installed | |
| SE-23 | Settings search | top bar search indexes cards | top bar search | same | AB | a card name finds its row | |
| SE-24 | Project-level settings moving here (team metrics enable, project tabs) | project tabs | Settings › Projects (slice 12) | same | AB | record which still have no home | |

### 4.10 Requirements (RQ)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| RQ-01 | Requirements place (flag `requirements`) | `#requirements` | `#requirements` (not live) | `#requirements` | ABCD | classic with the flag on: list, interview, spec; Stillhet: not-live notice (NV-24) | |
| RQ-02 | Flag off | deep link → Chat | place hidden | n/a | ABCD | hidden in both | |
| RQ-03 | Interview to a testable spec, list of requirements, their states | requirements view | not live | `#requirements` | AC vs P | record each classic function the prototype has a place for (**Design gap** where none) | |
| RQ-04 | Copy as Markdown; Save specs | requirements view | wire to | `#requirements` | B | not live: disabled with a reason | |
| RQ-05 | Requirements reaching a Shaper run (ship card marks) | ship card | Ship ChangeProposal | `#chat` | AB | see CH-25 | |

### 4.11 Onboarding and first run (OB)

| ID | Function | Classic | Stillhet | P | T | Verify | W |
|---|---|---|---|---|---|---|---|
| OB-01 | First screen of an empty home | `#getting-started`, welcome | `#chat` (`#getting-started` → Chat) | `?first` | CD | classic checklist (Connect Claude Code, add project, watch a run) has a Stillhet way; live never shows demo data | |
| OB-02 | Empty state of every place | each page | each place | `?first`, `?state=empty` | CD | each place shows its design's empty state with its one way forward | |
| OB-03 | Setup assistant; Claude not signed in | setup assistant | Settings › General › Setup | `#settings/general` | CD | the dialog with install command and Check again | W-g |
| OB-04 | Add the first project | Projects Add | Projects + / Ask in chat | `?first` | CD | `POST /api/projects` | W |
| OB-05 | First task end to end (mock) | New run, Mock | Chat → TaskProposal → Start | `?first` | CD | a mock run reaches done; its card and page show logs, cost, diff | W |
| OB-06 | Marketplace on first run | Marketplace | Marketplace | `#marketplace` | CD | see MK-01 | |
| OB-07 | Interface mode first choice | mode dialog | onboarding (slice 13, not built) | `?first` | CD | record what Stillhet shows | |
| OB-08 | Opt-in and opt-out | Labs row | Labs row / switch | `stillhet-switch.html` | CD | see NV-14, NV-15 | W-g |
| OB-09 | Getting started tour (spotlight guide) | `#getting-started`, guide-spot | none | n/a | CD | mapped, or **Design gap** | |

### 4.12 Page map (every classic page, tab and sub-view)

Each row is a check: open the classic address on A and the Stillhet target on B. The content must be there; otherwise the verdict is **Missing function** or **Design gap**.

| Classic page / tab | Stillhet target | Item |
|---|---|---|
| `#chat` home tabs Needs, Running, Chats, Plans, Workflows | Chat home, bar, Pulse | CH-01 |
| `#chat/ID`; side chat `#ask-side` | `#chat/ID`; hand to Chat | CH-03, CH-41 |
| `#new`, `#new/after` | + › New task… | TK-38, TK-39 |
| `#getting-started` | Chat | OB-01, OB-09 |
| `#runs`; run glance/details | `#runs`; `#run/ID` | TK-01, TK-43 |
| run tabs Overview, Diff, Changes, Artifacts, Actions, Workflow, Q&A, Logs, Sessions, Agents | task page parts | TK-05–TK-14, TK-24, TK-25 |
| `#feature/ID`, `#group/ID` tabs Runs, Overview, Decisions, Logs | `#run/group:ID` | TK-36 |
| `#schedules/once\|repeating\|activity` | `#schedules` | SC-01, SC-03, SC-15 |
| `#workflows`, `/agents`, `/scripts`, `/ID` | `#workflows`, `~agents`, `~scripts`, `workflow:ID` | WF-01–WF-09 |
| `#marketplace` Browse, Installed, Marketplaces | `#marketplace`, `~all`, `~installed`, sources | MK-01–MK-07 |
| `#projects/KEY` Overview, Team, Memory, Settings, Sets, Actions, Automations, Away | `#projects/KEY` | PJ-02, PJ-09–PJ-12 |
| `#workspaces/ID` Overview, Map, Team, Actions, Automations; `#workspace-create` | `#projects/ws:ID`; + menu | PJ-15–PJ-22 |
| `#stats` Overview, Cost, By person | `#insights/*` | IN-01–IN-08 |
| `#team-metrics` Overview, Timeline | `#insights/team` (Timeline: none) | IN-08, IN-14, IN-15 |
| `#team-policy` Policy, Plugins, Catalog | `#settings/team` | SE-18 |
| `#settings` 9 tabs and their cards | `#settings/*` | SE-01–SE-14 |
| `#models`, `#providers`, `#connectors` | `#settings/models`, `#settings/connectors` | SE-15–SE-17 |
| `#requirements` | `#requirements` (not live) | RQ-01 |
| `#design` (flag `design`) | none found in Stillhet | check: **Missing function** or owner decision |
| `#profile` (Worca levels) | none found (profile menu has usage only) | check: **Missing function** or owner decision |
| Activity menu, `#activity` | Pulse | NV-05 |

## 5. Stress items (behaviour)

| ID | Scenario | T | Verify |
|---|---|---|---|
| SX-01 | Fast chat switching: 20 chats in 10 s, then stay | AB | the shown thread is the clicked one; no turns from another chat (cache mixing); no chat vanishes from the bar; no console errors |
| SX-02 | Two tabs on one chat; send from one | AB | the other shows the turn without reload; no duplicate turns |
| SX-03 | Reload mid-reply | AB | after the reload the reply continues or ends cleanly; composer state right |
| SX-04 | Rail toggle mid-session (A vs B as separate instances; flip only on C/D) | CD | the page reloads once, never while typing; the same chats, tasks and counts on both sides |
| SX-05 | Long existing chat (biggest thread on A/B) | AB | open in under 2 s; CPU idle (no busy loop in a 10 s performance trace); smooth scroll; the "thinking" indicator does not blink when idle |
| SX-06 | Status icon latency: pause and resume a mock run | AB | the bar, card and page icons change within 2 s of the frame |
| SX-07 | Pulse read state | AB | mark read, reload, second tab: still read; the badge count follows |
| SX-08 | Back/forward over 10 places, old addresses and task pages | AB | each step lands on the right page; no loop on old addresses |
| SX-09 | Narrow screen 360, 390, 420 px on every place | ABD | no horizontal scroll; long branches fold with "…"; menus fit; center cards not clipped |
| SX-10 | Chats disappear: leave B open 30 min with runs finishing; reconnect the WS | AB | the bar keeps every chat of `GET /api/ask/threads?show=all` |
| SX-11 | Profile usage under load | AB | profile menu opens in under 1 s while 3 runs stream |

## 6. Known findings to re-verify

The owner's four problem areas come first. Each is covered by items, not just a note.

| KF | Area | Items to run | Pass when |
|---|---|---|---|
| KF-01 | **Logs not showing**: run logs, step logs, agent output, costs and diffs on the task page and the run card (logs location fixed in #1266) | TK-07, TK-08, TK-09, TK-10, TK-11, TK-13, CH-18, CH-19, OB-05 | every classic Logs, Agents, Sessions, costs and Diff tab content is shown in Stillhet for a running, finished, failed and no-project task |
| KF-02 | **Missing information**: every field classic shows for a run, task, chat, project, schedule and workflow | TK-01, TK-05, TK-06, CH-03, CH-19, PJ-01, PJ-02, SC-02, WF-02, MK-03, IN-01 | a field-by-field table per object, classic vs Stillhet, has no gap |
| KF-03 | **Wrong wiring**: every Stillhet control does its expected effect | every **-00** control sweep, plus every **W** item | each control's request and state change are proven; none says "Would…" or "Not connected" |
| KF-04 | **Missing content and pages**: every classic page, tab and sub-view maps to a Stillhet place | §4.12 page map, PJ-12, PJ-22, IN-14, IN-15, NV-19, NV-20, NV-23, OB-09, MK-10, MK-11 | each row has a home, or a finding is filed |

The owner's reported issues:

| KF | Issue | Items |
|---|---|---|
| KF-05 | Labels and tags missing (Settings shows demo labels and cost tags; task rows carry no tags) | SE-03, TK-01, TK-32, CH-31 |
| KF-06 | Slow profile usage | NV-10, SX-11 |
| KF-07 | Chat CPU and the thinking blink | SX-05 |
| KF-08 | Status icon delay | NV-09, SX-06 |
| KF-09 | Marketplace empty on first run | MK-01, OB-06 |
| KF-10 | Pages not loading; "Select workflow" empty; the sidebar leads to Projects | NV-01, NV-02, CH-13, TK-03, each place's -00 item |
| KF-11 | Chats disappearing (cache mixing?) | SX-01, SX-02, SX-10, CH-02 |
| KF-12 | Pulse Needs you unclear | NV-06, NV-07, PJ-24 |

The open rows of `plans/rail/findings.md`:

| KF | Finding (findings.md) | Items |
|---|---|---|
| KF-13 | Feature page plan card shows v1 after a re-plan (`#feature/ID`) | TK-36 |
| KF-14 | Feature page has no Start now for a held run | TK-36 |
| KF-15 | Top-bar Stillhet switch becomes a 20 px icon | NV-14 |
| KF-16 | Metrics/policy ChangeProposal shows raw kind word | CH-26 |
| KF-17 | Scope-switch ChangeProposal lists the full path | CH-26 |
| KF-18 | Workflow save race (no conditional save) | WF-04 |
| KF-19 | Tasks center "by workflow" grouping lacks workflow id | TK-02 |
| KF-20 | Workflows keeps inline drafts, not RailDrafts | WF-11 |
| KF-21 | Run now on a chat-card series fails "card is scheduled" | SC-17 |
| KF-22 | Done task card ⋯ lacks follow-up, Report, Archive | CH-18 |
| KF-23 | In-view tab × cannot drop `task:run:ID` | TK-42, NV-21 |
| KF-24 | Team metrics Timeline has no home | IN-14 |
| KF-25 | Team metrics enable, Push now, Check now have no home | IN-15 |
| KF-26 | Six Insights pages not offered live; local vs UTC days | IN-13, IN-16 |
| KF-27 | Style diff with Stillhet off is not 0 (`#settings/experimental` flag-row order) | SE-10 |
| KF-28 | Labels and Cost tags show demo values; task rows carry no tags (major) | SE-03, TK-01 |
| KF-29 | Live composer has no workflow picker; "using workflow" filter empty (major) | CH-13, TK-03 |
| KF-30 | Insights review minors (copied link keeps `scope=`, `of=` filters, saved views) | IN-07, IN-12 |
| KF-31 | Repo, test and compare-PNG rows (`stillhet-host`, `out/stillhet-compare/`, Schedules PNGs) | not browser items; skip, note only |

## 7. Split for agents

Seven agents with about 40 items each. Each agent tests its items on every target listed, and runs its own place's stress items.

| Agent | Places | Items | Count |
|---|---|---|---|
| 1 | Chat: core and composer | CH-00–CH-22, SX-01, SX-02, SX-03, SX-05, SX-10 | 28 |
| 2 | Chat: cards and management; Requirements | CH-23–CH-43, RQ-01–RQ-05, KF-16, KF-17, KF-22 | 29 |
| 3 | Tasks: list and task page reading (logs, costs, diff, fields) | TK-00–TK-14, TK-40–TK-47, KF-01, KF-02 (task part), KF-19, KF-29 | 27 |
| 4 | Tasks: actions, groups, new task; Schedules | TK-15–TK-39, SC-00–SC-17, SX-06 | 44 |
| 5 | Workflows, Marketplace, Onboarding | WF-00–WF-14, MK-00–MK-12, OB-01–OB-09, KF-09 | 38 |
| 6 | Projects and Workspaces, Insights | PJ-00–PJ-24, IN-00–IN-17 | 43 |
| 7 | Shell, Pulse, navigation, Settings, page map | NV-00–NV-24, SE-00–SE-24, §4.12 page map (21 rows), SX-04, SX-07, SX-08, SX-09, SX-11 | 76 (many are short reads) |

Agent 7 is the heaviest by row count, but its Settings rows are mostly read-and-compare. If time is short, split it:
- 7a: NV-00–NV-24, SX-04, SX-07, SX-08, SX-09, SX-11
- 7b: SE-00–SE-24 and the page map

Rules for every agent:
- Write findings to its own file, `out/test-protocol/agent-N.md`, in the §8 format.
- Never open http://localhost:4317.
- **W** items only in the scratch project; **W-g** items only on C/D.

## 8. Findings format

One row per finding:

| ID | Place | Item | Target(s) | Verdict | Classic does | Prototype says | Stillhet does | Reproduction | Cause (file:line) | Severity |
|---|---|---|---|---|---|---|---|---|---|---|
| F-N-01 | Tasks | TK-07 | B | Missing function | Logs tab shows 412 lines (`GET /api/history/k/id/log`) | Activity › Logs with Summaries/Raw | Logs part empty, console 404 | 1. open `#run/ID` on :4502 … | `ui/public/stillhet/live/task-live.mjs:NNN` | major |

- **ID:** `F-<agent>-<nn>`.
- **Verdicts:** Missing function · Wrong wiring · Missing or wrong detail · Design gap · Behaviour bug · OK. Only failures get rows; OK items are listed by id at the end of the agent's file.
- **Severity:** critical (data loss, a wrong write, an action without its confirm, fake success, demo data shown as real) · major (a function missing or broken, wrong figures) · minor (wording, layout, order).
