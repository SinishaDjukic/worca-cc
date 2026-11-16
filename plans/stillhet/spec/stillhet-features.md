# Stillhet's own features: what each is built on

These are the features Stillhet introduces: classic (`dev`) lacks them, or has them in a much smaller form. For each one
this file gives the direction of the build: what already exists and is reused, and what must not be built a second
time. It does not restate the design (the prototype and `docs/stillhet/` hold it) or the contracts ([server.md](server.md)).

**How to read a section.** *Build on* names code that exists today: classic's logic and routes (paths as on `dev`), the
server additions this branch already has, the library's exports (`ui/public/design-system/components/index.mjs`) and
today's live code (`ui/public/stillhet/live/`). *Verdict* is for today's Stillhet code: **reuse** (keep as is),
**adapt** (keep the logic, move or split it) or **rewrite** (keep nothing but its tests' cases). A feature is done when
its *Done when* checks pass on a live instance, never on the demo ([lessons.md](lessons.md) 30).

**Three things hold for every section** and are not repeated: classic's screens and markup are never reused, only its
data, routes and logic (`docs/stillhet/README.md`); the page code is one, on a demo or a live adapter (`build.md`, One
codebase); with the flag off nothing here is loaded or drawn (`gate.flag-off`).

## Pulse: Now and Updates

- **What it is:** one panel under one top-bar button, no page: Now (states that end by themselves) and Updates (events, stored, read and cleared). Rules: `panel.pulse-read`, `fail.pulse-list`, `small.top-icons`, `small.sound`, `look.alert-ladder`; the design is [server.md](server.md) (the engine rules).
- **Build on:** classic's notification log `src/core/notifications.mjs` (it already has a `scope` column and per-person reads) with `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`; the Activity model `ui/public/activity-model.mjs` for what Now holds; `ui/public/alerts.mjs` for the desktop and badge values; `chatPrefs.notify` in `src/core/settings.mjs`; `GET /api/schedules`, `GET /api/actions/running`. Live code: the notification and section mapping in `live/live-map.mjs` (`test/stillhet-live-map.test.mjs`); the event catalogue and `clearsWhen` in `pulse/pulse-model.js`. Library: `pulseRow`, `tabs`, `filterRow`, `listState`, `selectionBar`, `countBadge`, `playChime`, `toastUndo`.
- **Do not rebuild:** a second notification store beside classic's log; a browser-only read state; a Pulse page; a schedule's own activity feed ([gaps.md](gaps.md) drops it: Pulse, filtered to the schedule).
- **Verdict:** **adapt** the model and the mapping; **rewrite** `pulse/pulse.js`: 1,265 lines that also hold the profile menu, the search, New task and Settings, with live branches inside the page (lessons 1, 16).
- **New server work:** the log is written only for schedules (and one PR case) today: runs, pull requests, usage, projects and the new-version event must write to it; a run outcome's read state moves from this browser (`worca-stillhet.pulse-read`) to the server, per person; per-group "where" settings.
- **Done when:** `test/stillhet-pulse-read-host-1.test.mjs` and `-2` pass against server read state (read in one tab is read in another after reload); a contract test compares Updates' count with the API on a store larger than one page (lesson 20).

## The one count of what needs you

- **What it is:** one number, on the Pulse button, of what waits for a person; every other place that shows it reads the same function, and every count opens exactly the rows it counts. Rules: `stillhet.one-place`, `stillhet.state-first`, `list.state-source`, `logic.one-source`.
- **Build on:** `src/shared/needs-you.mjs` (classic's rule, moved out of `ui/public/runs-list.mjs` so both count with it), `src/shared/run-model.mjs` `finishedNeedsYou`, `src/core/pr-status-cache.mjs` for a finished task's PR; the library's `runState`, `sectionOf`, `needsReason`, `alertLevel`.
- **Do not rebuild:** a count in any page, bar or center; a state word or a section decided outside `run-state.mjs`.
- **Verdict:** **reuse**: it is already the shared function, with tests.
- **New server work:** none.
- **Done when:** `test/needs-you.test.mjs` and `test/stillhet-live-counts-1.test.mjs` to `-3` pass; a new test asserts that the badge, Now's Needs you and Tasks' Needs you tab hold the same ids on one fixture.

## Usage rings, limits and the Usage and costs flyout

- **What it is:** rings around the avatar for the session and the long window of the tightest connected harness, a Limits group in Now when one is near, and the profile menu's Usage and costs side menu with every harness's windows and the spend. Rules: `small.usage-rings`, `panel.over`; [server.md](server.md) (the engine rules) §4.1 to §4.3.
- **Build on:** `src/core/usage-limits.mjs` and `GET /api/usage-limits` (`ui/routes/runs/drain-and-budget.mjs`), fed by the engines' limit events; `GET /api/budget` and `src/core/cost-budget.mjs`; classic's spend card model in `ui/public/account-menu.mjs` and `ui/public/stats-view.mjs` (figures only), `src/core/openrouter-free.mjs`. Library: `usageRing`, `usageWindow`, `connectedUsage`, `usageTip`, `USAGE_REFRESH_MS`, `accountButton`, `accountItem`, `navFlyout`. Live code: `costsOf` in `live/live-map.mjs`.
- **Do not rebuild:** a second usage reader or a made-up percent where a harness reports nothing (no ring, and the menu says so); the spend ring on the avatar (it is usage only now); a budget figure computed in the page.
- **Verdict:** **reuse** the server reader, the library and the mapping; the menu's drawing leaves `pulse/pulse.js` with the rewrite above.
- **New server work:** readings exist only for the session and week windows one CLI reports; add the other harnesses (reported, or counted against a quota the person sets) and the `usage.near`, `usage.reached`, `usage.reset` events into the notification log.
- **Done when:** `test/usage-limits.test.mjs` and `test/usage-limits-api.test.mjs` pass; `worca-sweep` holds `small.usage-rings`; a harness with no reading draws an empty track, asserted in the library test.

## What a start does near a limit

- **What it is:** before a task starts on a harness at or over the warning line, New task and Resume say so and offer one with room or a start after the reset; a start Worca makes (a slice, a queued or scheduled task) moves, waits or goes ahead by one setting. Rules: `act.limit-note`; [server.md](server.md) (the engine rules) §4.5.
- **Build on:** `src/core/usage-limits.mjs`; `src/core/limit-resume.mjs` and `src/core/recoverable-error.mjs` (resume after a reset); `src/core/model-tiers.mjs` and `src/core/engine-select.mjs` (the same tier on another harness); `GET /api/engines` and classic's `ui/public/engine-locks.mjs` rule; `src/core/scheduler.mjs` and `src/core/run-slots.mjs` for queued and scheduled starts; classic's `ui/public/limit-notice.mjs` stays the notice of a task already paused. Library: `choiceNote`, `dialog`, `field`, `button({ busy })`.
- **Do not rebuild:** a limit check in the page (the server decides and says what it did); a second resume timer; a warning anywhere but New task, Resume, a slice's plan stop and a confirm that starts agent work.
- **Verdict:** nothing live exists; build it, **server first**.
- **New server work:** the whole of it: a start check that answers near or not, the harness with room and the reset time; the two settings; the `usage.moved` and `usage.held` events; a held start that does not block the queue.
- **Done when:** a server test covers each setting for a person's start and for Worca's start; a host test asserts the note's buttons send what they say, and a harness under the line draws no note.

## Drafts

- **What it is:** what a person changes by hand (a workflow, an agent, a script, a schedule's times) is a draft until saved: tasks keep running the saved one, a DraftBar says how many changes and offers Discard and Save, and the bar lists every draft. A delete with Undo is a draft of a delete. Rule: `stillhet.drafts`, `form.workspace-edit`.
- **Build on:** the one store `ui/public/stillhet/shell/drafts.js` (`test/stillhet-drafts.test.mjs`); `live/workflow-draft.mjs`, which saves through classic's own `src/shared/graph/template.mjs` and `validate.mjs` and `POST /api/workflows` (`test/stillhet-workflow-draft.test.mjs`, `test/stillhet-workflows-copy-draft.test.mjs`); `live/schedule-live.mjs` with `PATCH /api/schedules/:id` (`test/stillhet-schedules-drafts-host.test.mjs`); classic's `src/core/undo-tokens.mjs` where a route already has an undo. Library: `draftBar`, `toastUndo`, `changedDot`.
- **Do not rebuild:** a draft kept in a page's own variable or a second storage key; an autosave; a "dirty" dialog on leaving (leaving keeps the draft); a draft copy of a workflow on the server.
- **Verdict:** **reuse**.
- **New server work:** a conditional save for a workflow, so a draft never overwrites a change made elsewhere (lesson 24).
- **Done when:** the four tests above pass; a new host test saves a draft against a workflow changed since and gets the refusal, with the draft kept.

## Centers

- **What it is:** every place outside Chat lands on a home of cards read from the one store, each card with its state first and the one action its state allows; a number opens what it counts. Rules: `stillhet.center`, `panel.center`, `panel.center-shelf`, `list.bar-model`, `list.ways-in`.
- **Build on:** classic's `GET /api/history`, the run frames, `GET /api/schedules`, `GET /api/projects`, `GET /api/workspaces`, through `live/live-adapter.mjs` into the one store (`shell/world.js`). Library: `centerShelf`, `centerSentence`, `centerAlso`, `pluginCard`, `placeHead`, `taskRank`, `taskClause`, `taskActions`, `cardAction`, `runOutcomes`, `confirmStrip`, `listController`.
- **Do not rebuild:** a card component per place; an action list decided in the page (`cardAction` decides); a second store for the home beside the bar's; a filter sentence (see FilterRow below).
- **Verdict:** **rewrite** `centers/centers.js`: 887 lines holding the demo-only switch `DRAWN` and its own `plural` (lessons 1, 14); the library parts are **reused**. `marketplace/marketplace.js` is the model for the slots.
- **New server work:** none known; each card's facts are named in [wiring.md](wiring.md) first.
- **Done when:** `test/stillhet-tasks-center-week-host.test.mjs` passes; a new test asserts every count on a center equals the rows it opens (lesson 5); `gate.no-demo` finds no demo branch in the file.

## In view

- **What it is:** Keep in view puts a task, chat or schedule in the top bar on every page, like a tab: its mark and short name, five at most, a click opens it. Rules: `nav.in-view`, `nav.to-the-thing`.
- **Build on:** the library's `inView` (in `shell-parts.mjs`), `kindMark`, `runState`; the one store for where each thing stands. Classic's nearest logic is the home pins (`src/shared/home-pins.mjs`, `/api/chat-home/pins`): take its storage shape, not its meaning.
- **Do not rebuild:** a second pin list; In view as a PR's Watch (`/api/pr/watch` fixes checks, a different thing); a mark with its own state logic.
- **Verdict:** **adapt**: today the list lives in a variable in `shell/shell.js` and is lost on reload.
- **New server work:** one per-person list of things in view, beside the home pins.
- **Done when:** a host test keeps a task in view, reloads and finds it; `worca-sweep` holds `nav.in-view` at 1280, 1100 and 375.

## The hand-over to Chat

- **What it is:** whatever a page sends to Chat arrives as one removable chip in the composer, its kind and name, and goes with the message; no page writes text into the composer and no page has a composer of its own. Rules: `stillhet.hand-to-chat`, `stillhet.chat-first`, `panel.chat-composer`.
- **Build on:** classic's page context for Ask worca: `ui/public/ask-page-chips.mjs` (`pageChips`, `withoutChips`, `pageScopeOf`), `src/shared/ask-where.mjs`, and the context the thread routes already accept (`POST /api/ask/threads/:id/messages`). Library: `handedChip`, `intentChip`, `composer`, `refChip`. Live code: `live/chat-live.mjs`.
- **Do not rebuild:** pre-written prompt text per page; a second chip kind; a context format beside classic's keys.
- **Verdict:** **adapt**: the hand-over is spread inside `chat/conversation.js` (`handHere` and the route entry); it becomes one function the shell owns and every place calls.
- **New server work:** none expected: the chip's kinds must map onto classic's context keys; a kind with no key is server work first.
- **Done when:** `handover-check` passes for every place; a test asserts the body sent carries the chip's thing by id (lesson 18) and nothing once the chip is removed.

## Proposals in chat

- **What it is:** a chat's offer is a card that is a draft until applied: TaskProposal (labelled rows: Project, Workflow, Model, Starts, Then), ChangeProposal (a settings or thing change, row by row), and a workflow proposal with its story. Rules: `panel.proposal-keeps-picks`, `panel.conversation-cards`, `panel.ship-card`, `panel.plan-folds`, `panel.question-forms`; the inventory is [chat-cards.md](../chat-cards.md).
- **Build on:** classic's cards and their routes: `src/shared/ask-card-types.mjs`, `/api/ask/threads/:id/cards/:cardId`, `/api/ask/threads/:id/changes`, `POST /api/run`; classic's one proposal model for a workflow (`ui/public/auto-proposal.mjs`: its fields, not its drawing); `src/shared/shape/` for Shaper. Library: `taskProposal`, `changeProposal`, `planCard`, `filesCard`, `turnRow`, `sliderPick`, `rankList`, `pickRows`, `workflowStory`. Live code: `live/chat-live.mjs` `startBodyOf`, `live/chat-turns.mjs` (`test/stillhet-chat-turns.test.mjs`).
- **Do not rebuild:** a card type the server does not know; a card shape per flow (one shape: kicker, title, one line why, body, actions); a second Approve on a neighbouring card (lesson 10).
- **Verdict:** **adapt**: the library cards and the turn mapping stay; the drawing leaves the 1,914-line `chat/conversation.js` in parts.
- **New server work:** none for the cards; a proposal that changes the workflow, model or project must say so in its data, so the row can show it.
- **Done when:** `test/stillhet-chat-proposal-options-host.test.mjs` passes; a new test asserts the body sent on Start equals what the card showed (lesson 15).

## The task card and its stage train

- **What it is:** a task reads the same on its page and on its card in a chat: status line, one action and ⋯, and its stages as one horizontal train that opens each stage's parts in place. Rules: `panel.task-card`, `panel.task-depth`, `thing.stage-train`, `thing.parts-in-stages`, `thing.slots`, `look.stage-line`, `motion.stage-advance`, `stillhet.work-and-talk`.
- **Build on:** classic's run data: the run frames, `GET /api/history/:key/:id`, `src/shared/run-model.mjs`, `src/shared/run-progress.mjs`, the PR routes (`/api/pr`, `/api/pr/merge`, `/api/pr/fix-checks`). Library: `taskCard`, `stageBar`, `stageStep`, `stageLine`, `statusLine`, `taskView`, and all of `run-state.mjs` (`runState`, `cardAction`, `stageState`, `actionFlow`, `stepFlow`). Live code: `live/task-live.mjs`, `live/task-page.mjs` (`test/stillhet-task-live.test.mjs`, `test/stillhet-task-page.test.mjs`).
- **Do not rebuild:** a state, an action or a stage word outside `run-state.mjs` (`build.logic`); a card of another shape for a workspace task or a slice; a tab strip on the task page; classic's progress bar.
- **Verdict:** **reuse** the library and the model; **adapt** the live code to one id per task (lesson 19). A row opens the task's page (`stillhet.work-and-talk`); the card is reached from the page's Open the chat.
- **New server work:** the fields [wiring.md](wiring.md) finds missing on `/api/history` (the workflow id, the PR state: lesson 24).
- **Done when:** `test/run-page-model.test.mjs`, `test/stillhet-task-card-host.test.mjs` and `run-page-sweep` pass; a draw-twice test keeps an open Stop confirm (lesson 17).

## The modes' locks, and places not in Stillhet yet

- **What it is:** what a mode or Labs hides is never a dead end: the search finds it with a lock note, a deep link lands on one line and its one way on. A place not built yet says so and names where it lives today. Rules: `nav.locked`, `nav.not-live`, `set.not-live`, `set.read-level`, `thing.tabs-by-level`, `nav.labs`.
- **Build on:** classic's interface mode: `ui/public/ui-level.mjs`, `uiLevel` in `/api/settings`, `<html data-level>` stamped by the server (`src/core/stillhet-shell.mjs`); the unlock hand-off `ui/public/search-unlock.mjs` (pure, reusable as it is); the modes and gates in `ui/public/settings-index.mjs`; `src/shared/flags/registry.mjs`. Library: `MODES`, `atLevel`, `shows`, `prefs`, `runPartShows`, `emptyState`, `notInStillhet`, `notLiveRow`, `notFound`.
- **Do not rebuild:** a second mode store (the server's `uiLevel` is the one; `localStorage` is the demo's); a lock decided per page; a hidden place drawn as an empty list.
- **Verdict:** **adapt**: the lock works in `shell/shell.js`, but the places and their modes are a literal there. They become one table of place by mode that the navigation, the locks, the search and the gate all read (lesson 28).
- **New server work:** none.
- **Done when:** a test walks the table: every place, in each mode that does not offer it, shows its one line and its one way on; `test/stillhet-settings-not-live-rows.test.mjs` passes.

## One search

- **What it is:** the top bar's search is the only one: it finds what is on this page first, then each place's things, then Settings, and lands on the row. No page, list or bar has a field. Rules: `set.search`, `nav.to-the-thing`, `nav.locked`.
- **Build on:** classic's pure search model `ui/public/global-search.mjs` and its sources, `ui/public/settings-index.mjs` (the hand-written alternative words), `search-unlock.mjs`. Library: `search`, `searchResults`. Live code: each place module's `search(q)` on `window.StillhetPlaces`.
- **Do not rebuild:** a filter field on a page (Marketplace's is dropped, [gaps.md](gaps.md)); a second index of Settings; a copy of classic's names kept equal by a test, as `pulse/pulse.js` has today.
- **Verdict:** **rewrite** the search out of `pulse/pulse.js` onto classic's model plus the places' `search(q)`; the library parts are **reused**.
- **New server work:** today it covers only what a page has loaded (lesson 20): one search route over chats, tasks and schedules beyond the first page.
- **Done when:** `test/design-system-search-two-lines.test.mjs` passes; `test/stillhet-search-classic-names-host.test.mjs` is replaced by a test that every classic search word finds its Stillhet place; a contract test finds a task that is not on the first page.

## Insights

- **What it is:** classic's Statistics and Team metrics as one place with more views (spend by stretch and person, Shaping, Who spends where, a person's work), saved views, and Copy a link that carries what you narrowed. Rules: `act.copy-link`, `look.chart`, `look.figures-on-demand`, `list.sentence-person`, `list.sentence-scope`, `list.row-opens-in-place`, `thing.read-only`.
- **Build on:** `GET /api/stats`, `GET /api/stats/review-quality`, `src/core/stats.mjs`; `/api/team-metrics` and its `scopes`, `prs`, `pr-events`; `src/shared/team-metrics/timeline.mjs`; `GET /api/budget`, `/api/tag-dimensions`. Live code: `live/insights-live.mjs`, `live/insights-map.mjs`, `live/work-map.mjs` with their tests (`test/stillhet-insights-live.test.mjs`, `-map`, `-model`, `-figures`). Library: `barChart`, `lineChart`, `mixChart`, `heatGrid`, `timeTrack`, `workBar`, `figures`, `table`, `taskView`.
- **Do not rebuild:** an aggregation in the browser that the stats routes already give; a second chart kind; a share link with state on the server (the address holds it).
- **Verdict:** **reuse**: the newest live area, GETs only, well tested. One fix: a row that cannot open is not drawn as one ([gaps.md](gaps.md)).
- **New server work:** none for the first build. Saved views stay per browser (`worca-stillhet.insights-views`); following a person across browsers is a question for the owner, not a default.
- **Done when:** `test/stillhet-insights-host-1.test.mjs` and `-2` pass (`act.copy-link`); every total equals the sum of its rows on the seeded store (`tools/stillhet-seed-insights.mjs`).

## The workflow story

- **What it is:** a workflow told in plain words: a panel per step saying what happens to your task there, its time and cost, every loop in words, then how tasks went through it. It is Simple's drawing of a workflow; the graph stays for Advanced. Rules: `panel.workflow-story`, `panel.expand`.
- **Build on:** `src/core/workflow-usage.mjs` and `GET /api/workflow-usage` (tasks, merged share, cost and minutes per step: `test/workflow-usage.test.mjs`); `GET /api/workflows/:id`; `src/shared/graph/loops.mjs` `classifyLoops`. Library: `workflowStory`, `workflowGraph`, `expandFrame`. Live code: `live/workflow-live.mjs`, `live/workflow-map.mjs` (`test/stillhet-workflow-map.test.mjs`).
- **Do not rebuild:** loop detection in the page; figures guessed where no task has run (the rule: never a guess); a second editor (Edit opens classic's graph logic as a draft).
- **Verdict:** **reuse** the component and the mapping; **adapt** the words: until a model has written them the page reads each step's own description.
- **New server work:** a helper job that writes a workflow's story words, kept per saved version, on classic's helper call (`src/core/helper-call/`, `form.suggest`).
- **Done when:** `test/stillhet-workflows-host-page.test.mjs` passes; a test draws a workflow with two steps of one name and two loops and reads each loop's place in words.

## Backgrounds and the away screen

- **What it is:** one background (Dots by default), chosen under Appearance, fills the margins and fades into the reading column on every page; the away screen, with nothing to read, has it full. Rules: `look.backgrounds`, `look.background-clear`, `look.background-breathes`, `small.appearance`.
- **Build on:** classic's away logic: `ui/public/away-screensaver.mjs` (when it shows), `GET /api/away-mode`, `src/shared/away-mode/`, the Keep awake setting; `theme` in `src/core/settings.mjs`, stamped on the shell at serve time. Library: `awayScreen`, `awayShows`, `AWAY_IDLE_MS`, `themeChoice`.
- **Do not rebuild:** a second away timer or away state; a background per page (one shared mask); a background drawn by a page's own CSS.
- **Verdict:** **adapt**: the choice lives in `pulse/pulse.js` under two `localStorage` keys; it moves to the shell and to the same store as the theme.
- **New server work:** two appearance keys beside `theme` (the background, and whether it breathes), stamped on the shell like the theme so the first paint is right.
- **Done when:** `colour-check` and `worca-sweep` pass with each background in both themes; a test asserts the away screen shows only under classic's conditions.

## Text size

- **What it is:** Appearance › Text size (Small, Default, Large) moves the whole type scale one step, for the whole product. Rule: `look.text-size`, `look.type-roles`. New, from user feedback ([gaps.md](gaps.md)).
- **Build on:** the type roles as tokens in `ui/public/stillhet/css/stillhet-look.css`; the theme's path end to end (`theme` in `src/core/settings.mjs`, `/api/settings`, the attribute stamped by `renderStillhetShell`); the library's `themeChoice` or `segmented` for the control.
- **Do not rebuild:** a font size on any component (`comp.look-options`); browser zoom tricks; a per-page setting.
- **Verdict:** not built anywhere; build it on the tokens.
- **New server work:** one settings key, stamped on the shell.
- **Done when:** a library-gate check fails a font size that is not a role token; `ds-check` passes at Large at 390 with no clipped text and no sideways scroll.

## Prompt check

- **What it is:** a chip in the composer grades how clear a task prompt is, and Improve suggests a rewrite of the whole text, shown beside it with Use this and Undo. Rules: `form.rewrite`, `form.suggest`, `look.violet-apart`, `panel.chat-composer`; `docs/prompt-check.md`.
- **Build on:** all of it exists on this branch, for classic and Stillhet: `src/core/prompt-check/`, `src/shared/prompt-check/`, the routes in `ui/routes/prompt-check/` (grade, improve, kind-correction), the browser logic `ui/public/prompt-check/grader.mjs` and `improve-view.mjs`, the chat preference `promptCheck`, and Stillhet's controller `ui/public/stillhet/chat/prompt-check.mjs`. Library: `chip`, `sentencePicker`, `rewriteSuggestion`, `gapMark`, `rewriteFail`.
- **Do not rebuild:** a second grader or grade vocabulary; a prompt check per surface (one controller, re-keyed by the composer).
- **Verdict:** **reuse**. The New task form must take the same controller (classic has it there: `test/ui-prompt-check-new-run.test.mjs`).
- **New server work:** none.
- **Done when:** `test/stillhet-chat-prompt-check*.test.mjs` and `test/stillhet-settings-prompt-check.test.mjs` pass; a new host test covers the chip in the New task dialog.

## The Stillhet switch and opt-in

- **What it is:** Stillhet is one Labs flag. A top-bar icon switches between the two UIs, and the install is asked once in a strip under the top bar. Rules: `nav.design-switch`, `nav.stillhet-ask`, `gate.flag-off`, `set.flags`.
- **Build on:** the flag in `src/shared/flags/registry.mjs` and classic's flags service (`src/core/flags.mjs`, `/api/flags`); `src/core/stillhet.mjs` (the ask switch, the asked-once answer, the old `rail` key); `src/core/stillhet-shell.mjs`; `ui/public/stillhet.mjs` (the glue in classic's page) and `ui/public/stillhet/host-app.js` (the way back and the one reload). Library: `stillhetSwitch`, `watchStillhetSwitch`, `stillhetInvitation`.
- **Do not rebuild:** a second flag or a per-person switch; a setting that migrates data when the flag turns on; a Stillhet stylesheet inside classic's (lesson 32).
- **Verdict:** **reuse**: complete and tested.
- **New server work:** none. `STILLHET_ASK_ON` turns true only when every area runs on live data.
- **Done when:** `test/design-system-stillhet-switch.test.mjs`, `test/design-system-invitation.test.mjs` and `test/stillhet-flag-off.test.mjs` pass; the flag-off style diff shows only the accepted Labs row.

## Old addresses

- **What it is:** with Stillhet on, an address of classic (Statistics, Runs, Activity, Connectors, Workspaces and the rest) lands on the place that holds it now, replaced in place so Back never loops. Rules: `nav.old-address`, `nav.address`, `nav.not-found`.
- **Build on:** the one table `ui/public/stillhet/shell/old-addresses.js` (`test/stillhet-old-addresses.test.mjs`); the moves it lists (also in [wiring.md](wiring.md), Shell and navigation). Classic's own `MOVED_ROUTES` in `ui/public/app.js` stays untouched.
- **Do not rebuild:** a redirect inside a page; a server redirect; a second alias list (Insights had one of its own).
- **Verdict:** **reuse**.
- **New server work:** none.
- **Done when:** the test passes with a row for every classic route in the inventory (`tools/classic-inventory.mjs`); every address is opened cold and says "not found" only after its source has answered (lesson 21).

## What every page gets from the library

- **What it is:** behaviour a page receives by calling the library, and so never writes: the FilterRow (tabs with counts, then labelled pickers that never move: `list.filters`, `list.reset-view`), busy buttons (`act.busy`, `comp.button-busy`), the confirm strip and the step flow (`act.flow`, `act.confirm`, `act.fail-words`), menus, dialogs and Escape (`comp.menu-off`, `form.dialog`, `panel.dismiss`), redraws that keep what is open (`comp.keep-open`, `comp.patch-parts`, `comp.keyed-patch`, `motion.morph`), list states (`fail.pulse-list`, `fail.task-page`), selection (`list.select`), shortcuts (`keys.one-table`), tooltips (`small.tooltip`) and toasts with Undo (`comp.toast-clamp`).
- **Build on:** `filterRow`, `resetViewTool`, `tabs`, `segmented`; `button`, `busy`; `confirmStrip`, `confirmForm`, `stepFlow`, `failureOf`; `compactMenu`, `watchMenus`, `dialog`, `dismissOnOutside`; `watchKeepOpen`, `patchParts`, `patchKeyed`, `morph`; `listState`, `emptyState`; the `select*` functions and `selectionBar`; `SHORTCUTS`, `shortcutAction`; `watchTooltips`; `toast`, `toastUndo`, `errorToast`; `foldMiddle` for a long branch. Each is in `docs/design-system-catalog.json` and the gallery.
- **Do not rebuild:** a list sentence of pickers (lesson 7); a spinner or a hand-set `disabled` while a request is out; a page-level menu, dialog, Escape handler or confirm; a raw `innerHTML` redraw; a page's own `plural` or state word.
- **Verdict:** **reuse**. Two additions the lessons ask for go into the library before any page is rebuilt: one `plural()` (lesson 14) and the words written as "task" at their source, with the walker in `shell/shell.js` deleted (lesson 4, `small.words-at-source`).
- **New server work:** none.
- **Done when:** `test/design-system-components.test.mjs`, `test/design-system-logic.test.mjs` and `test/stillhet-library-gate.test.mjs` pass with the baseline at zero for new files; the performance budgets hold (an idle page makes 0 mutations: `test/stillhet-perf-budgets.test.mjs`).

## Governing rules for anything new

A feature that is not in this file follows these before a line is written. None is new: each is a rule or a lesson that
exists.

1. **Find it in classic first.** A function classic has is reused as data, routes and logic, never as a screen; its place comes from the coverage list (`gate.coverage`, lesson 6). A function nobody has is a question for a person.
2. **Look in the library next.** Each need has one component (`comp.one-per-need`, `comp.no-hand-markup`); states, actions and the step flow come from the library's logic (`build.logic`). `npm test` fails markup written by hand (`gate.new-code`).
3. **A new need joins the design system before the page:** the rule, the catalog entry, the component, its test, its gallery example (`build.teach`, `gate.docs`). The prototype shows it, or the change says why not (`gate.prototype`).
4. **No design is not a reason to wait or to invent:** what the feature is picks its pattern, each need its component, and every state is drawn (`build.default`, `build.pattern-first`).
5. **One store per fact.** A count, a cost or a state has one source and everything else links to it; things are matched by id, never by name (`stillhet.one-place`, `build.one-mock`, `logic.one-source`, lessons 5 and 18).
6. **Server before page.** Every fact on a page names its API field before the page is built; a missing field or route is server work first, in [server.md](server.md) (lesson 24). One id per thing (lesson 19).
7. **One codebase, no demo in a page.** The same page code runs on the demo and the live adapter; demo rows and answers live only in the demo adapter, and what has no live source says so (`gate.no-demo`, `nav.not-live`, `set.not-live`, lessons 1 and 2).
8. **A control acts or says why not.** It sends its request, or is disabled with its reason; success is read from the request and the API state, never from the screen (`gate.controls`, `small.disabled-why`, lessons 3 and 22).
9. **Flag off is classic.** Nothing Stillhet adds is loaded, styled or migrated with the flag off, and a change to classic's UI reaches the prototype (`gate.flag-off`, `gate.prototype`, lesson 32).
10. **Function is proven before the look is scored,** on real data, and a tick names the test or gate step that proves it (`gate.real-data`, lessons 30 and 31).
