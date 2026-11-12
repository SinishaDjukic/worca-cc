# Stillhet wiring: where every moved feature, action and figure stands

One map, from the prototype's own code (the places list in `shell/shell.js`, the old-address aliases in `insights/`, `SECTIONS` in `settings/settings-model.js`). The plan is `plans/rail/implementation-prompt.md`. A row says where a dev feature lands, which dev data or module it reuses (data, APIs and logic only, never dev's screens), and the address that redirects with Stillhet on.

## Moves

| Dev feature | New name and place | Dev data or module reused | Old address |
|---|---|---|---|
| Statistics | Insights (a center) | the statistics API and aggregation in `src/shared/` | `#stats` |
| Team metrics | Insights (a center) | the team metrics API and `src/shared/team-metrics/` | `#team-metrics` |
| Runs | Tasks | the runs API and live run frames | `#runs`, `#history` |
| Pipelines | Tasks | the pipelines API and the run page's data | `#pipelines`, `#running` |
| Activity | Pulse | the activity feed and the notification frames | the Activity button |
| Connectors | Settings | the connectors routes | `#settings/connectors` |
| Models | Settings | the models and engines routes | `#settings/models` |
| Providers | Settings | the providers routes | `#settings/providers` |
| Team policy | Settings | the team policy routes | `#settings/team-policy` |
| Workspaces | Projects (by workspace from Advanced) | the workspaces routes | `#workspaces` |

Dev data the design lacks (add to the design first: rule, catalog entry, component, test, gallery):
- add to the design first: the person filter on Insights.
- add to the design first: Shaper spend on Insights.
- add to the design first: the Quarter and Year ranges on Insights.
- add to the design first: the team heat grid on Insights.

New in the design (new: build it): each action the run page model lists as new (`runs/run-page-model.js`, `PROPOSED`) is built for real and added here when its slice starts.

## Actions

Every action the prototype answers with a "Would…" sentence is `window.RailWould(phrase)` in its module; `ui/public/stillhet/demo/demo-actions.js` is the only place that says "Would". In the app host each one answers "Not connected to Worca yet." until its area's run wires it. One row per module that holds actions here; one row per action under Action rows. Status: `wire to` (dev already has the function), `new: build it` (the design introduces it, so it is built for real), `add to the design first` (dev has it, the design lacks it). `test/stillhet-wiring.test.mjs` fails for a module with `RailWould` calls that has no row here.

| Module | Actions | Status | Wire to (dev function, API or module) |
|---|---|---|---|
| `ui/public/stillhet/chat/conversation.js` | open and download artifacts and files, open a folder picker or a file picker, copy lines, open the PR, apply or start a change, save a plan to plans/, open the diff, open in the terminal pane | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `ui/public/stillhet/chat/chats-model.js` | Create PR, View changes, Run a script, Apply files to a project | wire to | the chat action cards (`ui/public/chat/`), the PR and apply routes |
| `ui/public/stillhet/runs/run-page.js` | open a terminal in the worktree, run a built-in tool, check out on this machine, start or stop a service, open localhost, download a document or the patch, refresh the diff, copy a branch, copy a log, copy the error details, open the PR, any action the flow does not answer | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `ui/public/design-system/components/run-state.mjs` | the run flow's `would` actions: open or copy a PR link, check out the feature branch, download the patch, open a terminal or the folder, open Settings (Projects, Budget, Team policy), open or save the plan, open the fix task or the workflow | wire to | the run page's PR, diff, plan and rounds actions (`ui/public/history/`), the terminal pane, the Settings and team policy pages, `POST /api/run` |
| `ui/public/stillhet/runs/runs-list.js` | open a task's PR on GitHub | wire to | the PR link from the runs API (`pr.url`) |
| `ui/public/stillhet/runs/run-page-model.js` | the try-it command, instance links | wire to | the run's place and instance data from the runs API |
| `ui/public/stillhet/settings/settings-model.js` | open a Settings link in a new tab, send a test to a model, report a bug, suggest an improvement, copy the policy for a PR, the Labs guide | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `ui/public/stillhet/settings/settings.js` | copy a setting's value | wire to | the clipboard and the settings routes |
| `ui/public/stillhet/pulse/pulse.js` | ask Chat from a page, send a test notification; on pulse.html only (no shell): open a search result, open Statistics, open what a Pulse row names, a place that is off, New run's start and schedule | wire to | Chat hand-over (`RailConversation.handOver`), the notification settings routes; in the shell these go through `RailShell.go`, and New run is Chat's `RailConversation.start('task')` (`POST /api/run`, the schedules API) |
| `ui/public/stillhet/workflows/workflows.js` | import a workflow, export a workflow, run the saved cases | wire to | the workflows routes and `src/shared/` graph export |
| `ui/public/stillhet/requirements/requirements.js` | copy a requirement as Markdown, save specs | wire to | the requirements routes |
| `ui/public/stillhet/marketplace/marketplace.js` | open a plugin's source, open a market on GitHub | wire to | the Marketplace routes |
| `ui/public/stillhet/centers/centers.js` | attach files | new: build it | an attachment picker the design introduces |
| `ui/public/stillhet/insights/insights.js` | copy a link to this page | new: build it | page links with the new Insights addresses |
| `ui/public/stillhet/workspaces/workspaces.js` | open a workspace in your editor | wire to | the workspaces routes |

## Seeded figures

Each model file seeds figures the live adapter replaces. One row per file here; one row per figure under Figure rows.

| Model file | Figures it seeds | Status | Wire to |
|---|---|---|---|
| `ui/public/stillhet/shell/world.js` | the tasks, chats, projects and times every page shares | wire to | the runs, chats and projects APIs and the live WebSocket frames |
| `ui/public/stillhet/runs/runs-model.js` | the Tasks list rows | wire to | the runs API |
| `ui/public/stillhet/runs/run-page-model.js` | a run's stages, times, cost, loops and PR | wire to | the run page's data and live frames |
| `ui/public/stillhet/chat/chats-model.js` | the chats and their turns | wire to | the chat threads API |
| `ui/public/stillhet/pulse/pulse-model.js` | the Pulse updates, away and budget figures | wire to | the activity feed and notification frames |
| `ui/public/stillhet/schedules/schedules-model.js` | the schedules and their next times | wire to | the schedules API |
| `ui/public/stillhet/settings/settings-model.js` | every Settings value and model list | wire to | the settings, models and providers routes |
| `ui/public/stillhet/insights/insights-model.js` | spend, runs and team figures | wire to | the statistics and team-metrics APIs; the person filter, Shaper spend, Quarter and Year ranges and the team heat grid are "add to the design first" |

## Action rows

One row per action: `npm run stillhet:wiring` lists every `window.RailWould(...)` phrase (each `${…}` read as …), every `RailAdapter.act('id')` call, every `demo-actions.js` key and every `would` phrase of the library's run-state flow (`design-system/components/run-state.mjs › …`, its {names} kept), and fails on one with no row here (`test/stillhet-wiring.test.mjs`). The status and the dev function are the module's, above, until its area's run wires the action.

| Action | Status | Wire to (dev function, API or module) |
|---|---|---|
| `centers/centers.js › ask for the files to attach` | new: build it | an attachment picker the design introduces |
| `chat/chats-model.js › apply 3 files to docs-site` | wire to | the chat action cards (`ui/public/chat/`), the PR and apply routes |
| `chat/chats-model.js › open PR #1104 into main` | wire to | the chat action cards (`ui/public/chat/`), the PR and apply routes |
| `chat/chats-model.js › open the 12 changed files` | wire to | the chat action cards (`ui/public/chat/`), the PR and apply routes |
| `chat/chats-model.js › run scripts/release-notes.sh` | wire to | the chat action cards (`ui/public/chat/`), the PR and apply routes |
| `chat/conversation.js › be saved as …` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › be …` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › copy` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › copy … lines` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › download` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › download …` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › open` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › open PR #1107 into dev · …` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › open a file picker` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › open a file picker: … stands in` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › open a folder picker on this machine` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › open it in the terminal pane` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › open the changes: …, …` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › open …` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › open …: its lines, added and removed` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › save it as …` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › start building` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › write it into the project’s plans folder` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `chat/conversation.js › … …` | wire to | the chat turn actions and run-card actions in `ui/public/chat/`, the artifacts and diff routes, `POST /api/pr` |
| `design-system/components/run-state.mjs › copy 1 PR link` | wire to | the PR link from the runs API (`pr.url`) and the run page's PR actions (`ui/public/history/`, `ui/public/ship-words.mjs`) |
| `design-system/components/run-state.mjs › copy 3 PR links` | wire to | the PR link from the runs API (`pr.url`) and the run page's PR actions (`ui/public/history/`, `ui/public/ship-words.mjs`) |
| `design-system/components/run-state.mjs › copy the link to {pr}` | wire to | the PR link from the runs API (`pr.url`) and the run page's PR actions (`ui/public/history/`, `ui/public/ship-words.mjs`) |
| `design-system/components/run-state.mjs › copy: git switch {groupBranch}` | wire to | the feature group's branch from the runs API and the ship group dialog (`ui/public/ship-group-dialog.mjs`) |
| `design-system/components/run-state.mjs › download the patch` | wire to | the run page's diff and patch download (`ui/public/history/`) |
| `design-system/components/run-state.mjs › open Settings › Projects; point it at the folder, then Start now` | wire to | the project settings (`ui/public/project-settings-view.mjs`) |
| `design-system/components/run-state.mjs › open Settings › Tasks › Budget` | wire to | the budget settings (`ui/public/settings/`) |
| `design-system/components/run-state.mjs › open Settings › Tasks › Budget; Resume opens once there is room` | wire to | the budget settings (`ui/public/settings/`) |
| `design-system/components/run-state.mjs › open Settings › Team › Policy` | wire to | the team policy page (`ui/public/team-policy-view.mjs`) |
| `design-system/components/run-state.mjs › open a new task with this plan in it` | wire to | New run with a plan attached (`POST /api/run`) |
| `design-system/components/run-state.mjs › open a terminal in the worktree` | wire to | the terminal pane (`ui/public/terminal-pane.mjs`), `POST /api/runs/:id/resolve-terminal` |
| `design-system/components/run-state.mjs › open plan.md` | wire to | the run's plan artifact (`ui/public/artifact-view.mjs`) |
| `design-system/components/run-state.mjs › open the closed {pr} on GitHub` | wire to | the PR link from the runs API (`pr.url`) and the run page's PR actions (`ui/public/history/`, `ui/public/ship-words.mjs`) |
| `design-system/components/run-state.mjs › open the copy in a terminal` | wire to | the terminal pane (`ui/public/terminal-pane.mjs`, `/api/projects/:key/terminal/worktrees`) |
| `design-system/components/run-state.mjs › open the fix task under this task’s rounds` | wire to | the run page's rounds (`ui/public/history/`) |
| `design-system/components/run-state.mjs › open the merged {pr} on GitHub` | wire to | the PR link from the runs API (`pr.url`) and the run page's PR actions (`ui/public/history/`, `ui/public/ship-words.mjs`) |
| `design-system/components/run-state.mjs › open the workflow` | wire to | the workflows page (`ui/public/workflows/`) |
| `design-system/components/run-state.mjs › open worca-api #212 on GitHub` | wire to | the PR link from the runs API (`pr.url`) and the run page's PR actions (`ui/public/history/`, `ui/public/ship-words.mjs`) |
| `design-system/components/run-state.mjs › open worca-api #212, worca-web #88 and worca-docs #31 on GitHub` | wire to | the PR link from the runs API (`pr.url`) and the run page's PR actions (`ui/public/history/`, `ui/public/ship-words.mjs`) |
| `design-system/components/run-state.mjs › open {folder}` | wire to | the folder run's changes (`ui/public/folder-changes.mjs`) |
| `design-system/components/run-state.mjs › open {pr} on GitHub` | wire to | the PR link from the runs API (`pr.url`) and the run page's PR actions (`ui/public/history/`, `ui/public/ship-words.mjs`) |
| `design-system/components/run-state.mjs › open {pr}, {pr2} and {pr3} on GitHub` | wire to | the PR link from the runs API (`pr.url`) and the run page's PR actions (`ui/public/history/`, `ui/public/ship-words.mjs`) |
| `design-system/components/run-state.mjs › save plans/unified-page-navigation.md` | wire to | the run page's plan save (`ui/public/history/`) |
| `insights/insights.js › copy a link to this page` | new: build it | page links with the new Insights addresses |
| `marketplace/marketplace.js › open it on GitHub` | wire to | the Marketplace routes |
| `marketplace/marketplace.js › open … at … on GitHub` | wire to | the Marketplace routes |
| `pulse/pulse.js › (a phrase built from data)` | wire to | Chat hand-over (`RailConversation.handOver`), the notification settings routes; in the shell these go through `RailShell.go`, and New run is Chat's `RailConversation.start('task')` (`POST /api/run`, the schedules API) |
| `pulse/pulse.js › ask Chat: …` | wire to | Chat hand-over (`RailConversation.handOver`), the notification settings routes; in the shell these go through `RailShell.go`, and New run is Chat's `RailConversation.start('task')` (`POST /api/run`, the schedules API) |
| `pulse/pulse.js › open Statistics` | wire to | Chat hand-over (`RailConversation.handOver`), the notification settings routes; in the shell these go through `RailShell.go`, and New run is Chat's `RailConversation.start('task')` (`POST /api/run`, the schedules API) |
| `pulse/pulse.js › open …` | wire to | Chat hand-over (`RailConversation.handOver`), the notification settings routes; in the shell these go through `RailShell.go`, and New run is Chat's `RailConversation.start('task')` (`POST /api/run`, the schedules API) |
| `pulse/pulse.js › open … · …` | wire to | Chat hand-over (`RailConversation.handOver`), the notification settings routes; in the shell these go through `RailShell.go`, and New run is Chat's `RailConversation.start('task')` (`POST /api/run`, the schedules API) |
| `pulse/pulse.js › schedule it: …` | wire to | Chat hand-over (`RailConversation.handOver`), the notification settings routes; in the shell these go through `RailShell.go`, and New run is Chat's `RailConversation.start('task')` (`POST /api/run`, the schedules API) |
| `pulse/pulse.js › send a test notification` | wire to | Chat hand-over (`RailConversation.handOver`), the notification settings routes; in the shell these go through `RailShell.go`, and New run is Chat's `RailConversation.start('task')` (`POST /api/run`, the schedules API) |
| `requirements/requirements.js › copy … as Markdown` | wire to | the requirements routes |
| `requirements/requirements.js › save specs/….md in …` | wire to | the requirements routes |
| `runs/run-page-model.js › (a phrase built from data)` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › open worca-api #212 on GitHub` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › open worca-docs #31 on GitHub` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › open worca-web #88 on GitHub` | wire to | the run's place and instance data from the runs API |
| `runs/run-page.js › (a phrase built from data)` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › check out on this machine and open a local copy` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › check out on this machine; the PR waits for you` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › check out …` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › check out … on this machine` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › copy the error details: id E-7F3A, with the message and stack` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › copy the link to this …` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › copy …` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › copy … log lines` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › copy: git fetch && git switch …` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › download the patch` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › download …` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › open a terminal in the worktree` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › open localhost:…` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › open the Sync log` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › open the whole diff of the file` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › open … on GitHub` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › refresh the diff from the worktree` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/run-page.js › run …` | wire to | the run page's own actions in `ui/public/views/` (worktree, services, checkout, diff), `ui/public/ws.mjs` frames |
| `runs/runs-list.js › open PR … on GitHub (it leaves Worca)` | wire to | the PR link from the runs API (`pr.url`) |
| `settings/settings-model.js › copy it, to paste into .worca-policy/policy.json on a pull request` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › open a new bug issue on GitHub in a new tab` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › open a new enhancement issue on GitHub in a new tab` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › open the Labs guide in a new tab` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › open … in a new tab` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › send a test to …` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › send … one tiny prompt` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings.js › copy: …` | wire to | the clipboard and the settings routes |
| `workflows/workflows.js › ask for a file to import` | wire to | the workflows routes and `src/shared/` graph export |
| `workflows/workflows.js › export …` | wire to | the workflows routes and `src/shared/` graph export |
| `workflows/workflows.js › export … as …` | wire to | the workflows routes and `src/shared/` graph export |
| `workflows/workflows.js › run the … saved … of …` | wire to | the workflows routes and `src/shared/` graph export |
| `workspaces/workspaces.js › open … in your editor` | wire to | the workspaces routes |

## Figure rows

One row per seeded figure: each data key and seed getter of the globals a model file sets, and the named counts of the bar, Pulse, the bell, the sidebar and the profile menu (`NAMED_FIGURES` in `tools/stillhet-wiring.mjs`).

| Figure | Status | Wire to |
|---|---|---|
| `runs/run-page-model.js › RunCardModel.caseGroups` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › RunCardModel.forms` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › RunCardModel.titles` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › RunCardModel.chainStart` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › RunCardModel.chainPrs` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › RunCardModel.proposed` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › RunCardModel.flow` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › RunCardModel.runFlow` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › RunCardModel.cases` | wire to | the run's place and instance data from the runs API |
| `runs/run-page-model.js › RunCardModel.add` | wire to | the run's place and instance data from the runs API |
| `shell/world.js › RailFirstRun` | wire to | nothing to wire: the demo's `?state=` and `?first` from the address; the live adapter (slice 3) ignores them and reads the real state from the APIs |
| `shell/world.js › RailDemoState.list` | wire to | nothing to wire: the demo's `?state=` and `?first` from the address; the live adapter (slice 3) ignores them and reads the real state from the APIs |
| `shell/world.js › RailDemoState.conn` | wire to | nothing to wire: the demo's `?state=` and `?first` from the address; the live adapter (slice 3) ignores them and reads the real state from the APIs |
| `shell/world.js › RailWorld.data` | wire to | the runs, chats and projects APIs and the live WebSocket frames |
| `pulse/pulse-model.js › PulseModel.BUDGET_RESETS` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.FINDS` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.FLAG_ROW` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.EVENT` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.BADGE` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.SCHED` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.GROUPS` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.LEVELS` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.WHERE` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.PROVIDER` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.CASES` | wire to | the activity feed and notification frames |
| `pulse/pulse-model.js › PulseModel.WHAT` | wire to | the activity feed and notification frames |
| `runs/runs-model.js › RunsListModel.seed` | wire to | the runs API |
| `runs/runs-model.js › RunsListModel.PEOPLE` | wire to | the runs API |
| `runs/runs-model.js › RunsListModel.DAYS` | wire to | the runs API |
| `chat/chats-model.js › ChatsListModel.seed` | wire to | the chat action cards (`ui/public/chat/`), the PR and apply routes |
| `chat/chats-model.js › ChatsListModel.DAYS` | wire to | the chat action cards (`ui/public/chat/`), the PR and apply routes |
| `schedules/schedules-model.js › SchedulesModel.seed` | wire to | the schedules API |
| `schedules/schedules-model.js › SchedulesModel.TODAY` | wire to | the schedules API |
| `settings/settings-model.js › SettingsModel.ICONS` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › SettingsModel.SECTION_ICONS` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › SettingsModel.GROUPS` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › SettingsModel.SECTIONS` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › SettingsModel.FLAGS` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › SettingsModel.STATE` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › SettingsModel.FIRST` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › SettingsModel.VALUE_NAMES` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `settings/settings-model.js › SettingsModel.VALUE_WORDS` | wire to | the models and engines routes, the team policy routes, the Labs guide in `docs/feature-flags.md` |
| `insights/insights-model.js › RailInsightsModel.STANDS` | wire to | the statistics and team-metrics APIs; the person filter, Shaper spend, Quarter and Year ranges and the team heat grid are "add to the design first" |
| `insights/insights-model.js › RailInsightsModel.SUBS` | wire to | the statistics and team-metrics APIs; the person filter, Shaper spend, Quarter and Year ranges and the team heat grid are "add to the design first" |
| `insights/insights-model.js › RailInsightsModel.SUB` | wire to | the statistics and team-metrics APIs; the person filter, Shaper spend, Quarter and Year ranges and the team heat grid are "add to the design first" |
| `insights/insights-model.js › RailInsightsModel.DIM` | wire to | the statistics and team-metrics APIs; the person filter, Shaper spend, Quarter and Year ranges and the team heat grid are "add to the design first" |
| `insights/insights-model.js › RailInsightsModel.DIM_GROUPS` | wire to | the statistics and team-metrics APIs; the person filter, Shaper spend, Quarter and Year ranges and the team heat grid are "add to the design first" |
| `insights/insights-model.js › RailInsightsModel.TIME` | wire to | the statistics and team-metrics APIs; the person filter, Shaper spend, Quarter and Year ranges and the team heat grid are "add to the design first" |
| `insights/insights-model.js › RailInsightsModel.FILTERS` | wire to | the statistics and team-metrics APIs; the person filter, Shaper spend, Quarter and Year ranges and the team heat grid are "add to the design first" |
| `insights/insights-model.js › RailInsightsModel.WHEN` | wire to | the statistics and team-metrics APIs; the person filter, Shaper spend, Quarter and Year ranges and the team heat grid are "add to the design first" |
| `bar › Pulse badge: the Needs you count` | wire to | the run states that wait on you (live run frames, `ui/public/ws.mjs`) and the activity feed |
| `bar › Pulse: the unread updates` | wire to | the activity feed and the notification frames |
| `bar › Pulse: the running tasks` | wire to | the runs API and the live run frames |
| `bell › the Needs you rows` | wire to | the run states that wait on you, missed schedules (the schedules API) and project questions |
| `sidebar › Chat: the unread reply dot` | wire to | the chat threads API (a reply in a thread not open) |
| `profile › the usage rings per harness` | wire to | the usage limits each harness reports (the engines and providers routes) |
| `profile › spend and the budget left` | wire to | the statistics API (spend) and the budget in Settings |

## Opt-in

Wired in slice 1, each row real:

| Area | Where it lives | What it does |
|---|---|---|
| The `rail` flag | `src/shared/flags/registry.mjs` | One experimental flag, off by default; `WORCA_FLAGS=rail` locks it. |
| The asked-once answer | `onboarding.stillhetAsked` in `settings.json` | Stored when the flag is turned on or No thanks is chosen; undone by setting it false. |
| The ask switch | `src/core/stillhet.mjs` | Hides the question, the switch and the Labs row until slice 4 turns it on. |
| The Invitation | `ui/public/design-system/components/invitation.mjs` | A ConfirmStrip under the top bar; Try Stillhet sets the flag, No thanks is never asked again. |
| The Stillhet UI switch | `ui/public/design-system/components/design-switch.mjs` | The top-bar switch, the same setting as Settings › Labs. |
| The reload | `ui/public/stillhet.mjs` | A change of the flag reloads each open page once, never while text is typed. |
