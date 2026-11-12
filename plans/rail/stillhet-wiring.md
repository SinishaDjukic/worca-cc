# Stillhet wiring: where every moved feature, action and figure stands

One map, from the prototype's own code (the places list in `shell/shell.js`, the old-address aliases in `insights/`, `SECTIONS` in `settings/settings-model.js`). The plan is `plans/rail/implementation-prompt.md`. A row says where a dev feature lands, which dev data or module it reuses (data, APIs and logic only, never dev's screens), and the address that redirects with Stillhet on.

## Moves

| Dev feature | New name and place | Dev data or module reused | Old address |
|---|---|---|---|
| Statistics | Insights (a center) | the statistics API and aggregation in `src/shared/` | `#stats`, `#stats/…`, `#statistics` |
| Team metrics | Insights (a center) | the team metrics API and `src/shared/team-metrics/` | `#team-metrics`, `#team-metrics/…` |
| Runs | Tasks | the runs API and live run frames | `#runs` (Tasks at its own address), `#history`, `#history/…` |
| Pipelines | Tasks | the pipelines API and the run page's data | `#pipelines`, `#running/…`, `#feature/…`, `#group/…` |
| Activity | Pulse | the activity feed and the notification frames | `#activity` (Chat, with Pulse open on Now) |
| Connectors | Settings | the connectors routes | `#connectors`, `#settings/mcp` |
| Models | Settings | the models and engines routes | `#models` (`#settings/models` is Stillhet's own) |
| Providers | Settings | the providers routes | `#providers`, `#settings/providers` |
| Team policy | Settings | the team policy routes | `#team-policy`, `#team-policy/…` |
| Workspaces | Projects (by workspace from Advanced) | the workspaces routes | `#workspaces`, `#workspaces/…`, `#workspace-create` |

With Stillhet on, every old address lands through one table, `ui/public/stillhet/shell/old-addresses.js` (`docs/rail/navigation.md` `nav.old-address`), in place; with it off they stay dev's.

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
| `ui/public/stillhet/pulse/pulse.js` | ask Chat from a page, send a test notification; on pulse.html only (no shell): open a search result, open Statistics, open what a Pulse row names, a place that is off, New run's start and schedule | wired | dev's routes with dev's bodies: `POST /api/resume` (Resume, Try again, Restart Build; a confirm opens the task), `POST /api/schedules/:id/run-now`, `POST /api/actions/instances/:instanceId/stop`, `POST /api/notifications/:id/read` and `/read-all`, `POST /api/settings` (`uiLevel`, `keepAwake`, `nightModeToggle`); a refusal toasts `Could not ACTION: REASON` and changes nothing |
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
| `ui/public/stillhet/shell/world.js` | the tasks, chats, projects and times every page shares | wired | `ui/public/stillhet/live/live-adapter.mjs`: `GET /api/history`, `hello.runs` and the run frames, through `RailWorld.load` / `move` / `add` |
| `ui/public/stillhet/runs/runs-model.js` | the Tasks list rows | wire to | the runs API |
| `ui/public/stillhet/runs/run-page-model.js` | a run's stages, times, cost, loops and PR | wire to | the run page's data and live frames |
| `ui/public/stillhet/chat/chats-model.js` | the chats and their turns | wire to | the chat threads API |
| `ui/public/stillhet/pulse/pulse-model.js` | the Pulse updates, away and budget figures | wired | `ui/public/stillhet/live/live-adapter.mjs`: `GET /api/notifications` and run outcomes (updates), `GET /api/budget` (spend), limit pauses (usage), `GET /api/actions/running`, `GET /api/away-mode` |
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
| `pulse/pulse.js › (a phrase built from data)` | wired | in the app host each reaches its real target: Chat hand-over (`RailConversation.handOver`), `RailShell.go` / `openRun` / `openSchedule` (`insights/spend` for Statistics), New run is Chat's `RailConversation.start('task')`, and Send test is the browser `Notification` API after permission (D16); the demo sentences stay on the standalone `pulse.html` only |
| `pulse/pulse.js › ask Chat: …` | wired | in the app host each reaches its real target: Chat hand-over (`RailConversation.handOver`), `RailShell.go` / `openRun` / `openSchedule` (`insights/spend` for Statistics), New run is Chat's `RailConversation.start('task')`, and Send test is the browser `Notification` API after permission (D16); the demo sentences stay on the standalone `pulse.html` only |
| `pulse/pulse.js › open Statistics` | wired | in the app host each reaches its real target: Chat hand-over (`RailConversation.handOver`), `RailShell.go` / `openRun` / `openSchedule` (`insights/spend` for Statistics), New run is Chat's `RailConversation.start('task')`, and Send test is the browser `Notification` API after permission (D16); the demo sentences stay on the standalone `pulse.html` only |
| `pulse/pulse.js › open …` | wired | in the app host each reaches its real target: Chat hand-over (`RailConversation.handOver`), `RailShell.go` / `openRun` / `openSchedule` (`insights/spend` for Statistics), New run is Chat's `RailConversation.start('task')`, and Send test is the browser `Notification` API after permission (D16); the demo sentences stay on the standalone `pulse.html` only |
| `pulse/pulse.js › open … · …` | wired | in the app host each reaches its real target: Chat hand-over (`RailConversation.handOver`), `RailShell.go` / `openRun` / `openSchedule` (`insights/spend` for Statistics), New run is Chat's `RailConversation.start('task')`, and Send test is the browser `Notification` API after permission (D16); the demo sentences stay on the standalone `pulse.html` only |
| `pulse/pulse.js › schedule it: …` | wired | in the app host each reaches its real target: Chat hand-over (`RailConversation.handOver`), `RailShell.go` / `openRun` / `openSchedule` (`insights/spend` for Statistics), New run is Chat's `RailConversation.start('task')`, and Send test is the browser `Notification` API after permission (D16); the demo sentences stay on the standalone `pulse.html` only |
| `pulse/pulse.js › send a test notification` | wired | in the app host each reaches its real target: Chat hand-over (`RailConversation.handOver`), `RailShell.go` / `openRun` / `openSchedule` (`insights/spend` for Statistics), New run is Chat's `RailConversation.start('task')`, and Send test is the browser `Notification` API after permission (D16); the demo sentences stay on the standalone `pulse.html` only |
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
| `shell/world.js › RailFirstRun` | wired | the demo's `?first` only: the live kind never reads the address (`data-adapter="live"`, D2, D3) |
| `shell/world.js › RailDemoState.list` | wired | `ui/public/stillhet/live/live-adapter.mjs`: `list` is loading until the first snapshot, failed, or refresh after a failed refetch; `conn` is offline while the socket is down and session on a 401 or close code 4001, through `RailWorld.setState` / `load` (D8, D20) |
| `shell/world.js › RailDemoState.conn` | wired | `ui/public/stillhet/live/live-adapter.mjs`: `list` is loading until the first snapshot, failed, or refresh after a failed refetch; `conn` is offline while the socket is down and session on a 401 or close code 4001, through `RailWorld.setState` / `load` (D8, D20) |
| `shell/world.js › RailWorld.data` | wired | `ui/public/stillhet/live/live-adapter.mjs`: `GET /api/history`, `hello.runs` and the run frames (`run-created`, `state`, `question`, `question-resolved`, `done`, `error`, `title`), mapped by `live/live-map.mjs`; Needs you is dev's rule (`src/shared/needs-you.mjs`) |
| `pulse/pulse-model.js › PulseModel.BUDGET_RESETS` | wired | `GET /api/budget` `windowEndMs`, through `RailWorld.part('costs')` |
| `pulse/pulse-model.js › PulseModel.FINDS` | wired | the places, then the store's projects, schedules and chats (`GET /api/projects`, `GET /api/schedules`, `GET /api/ask/threads?show=all`) |
| `pulse/pulse-model.js › PulseModel.FLAG_ROW` | wired | the design's catalogue; the live adapter maps dev's notification kinds and run outcomes onto it |
| `pulse/pulse-model.js › PulseModel.EVENT` | wired | the design's catalogue; the live adapter maps dev's notification kinds and run outcomes onto it |
| `pulse/pulse-model.js › PulseModel.BADGE` | wired | the design's catalogue; the live adapter maps dev's notification kinds and run outcomes onto it |
| `pulse/pulse-model.js › PulseModel.SCHED` | wired | the design's catalogue; the live adapter maps dev's notification kinds and run outcomes onto it |
| `pulse/pulse-model.js › PulseModel.GROUPS` | wired | the design's catalogue; the live adapter maps dev's notification kinds and run outcomes onto it |
| `pulse/pulse-model.js › PulseModel.LEVELS` | wired | the design's catalogue; the live adapter maps dev's notification kinds and run outcomes onto it |
| `pulse/pulse-model.js › PulseModel.WHERE` | wired | the design's catalogue; the live adapter maps dev's notification kinds and run outcomes onto it |
| `pulse/pulse-model.js › PulseModel.PROVIDER` | wired | the design's catalogue; the live adapter maps dev's notification kinds and run outcomes onto it |
| `pulse/pulse-model.js › PulseModel.CASES` | wired | one live case whose updates, usage, budget, actions and Away are the store's parts (`GET /api/notifications`, run outcomes of `GET /api/history`, `GET /api/budget`, `GET /api/actions/running`, `GET /api/away-mode`) |
| `pulse/pulse-model.js › PulseModel.WHAT` | wired | the design's catalogue; the live adapter maps dev's notification kinds and run outcomes onto it |
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
| `bar › Pulse badge: the Needs you count` | wired | the Needs you rows of the store: `countNeedsYou` over `hello.runs` and `GET /api/history`, plus `counts.missed` of `GET /api/schedules`, plus the projects that need you (D22) |
| `bar › Pulse: the unread updates` | wired | `GET /api/notifications` (unread problems) and the failed and paused run outcomes of `GET /api/history`, session read state |
| `bar › Pulse: the running tasks` | wired | `hello.runs` and the run frames |
| `bell › the Needs you rows` | wired (partial) | tasks (dev's Needs-you rule), missed schedules (`GET /api/schedules`) and projects with a missing folder or out of sync (`GET /api/projects`, `GET /api/sync/projects`); workspace link questions count 0 until Projects is live |
| `sidebar › Chat: the unread reply dot` | wired | `ask-done` / `ask-error` frames for a chat not open or while the page is hidden (dev's ask-panel rule, copied in `live/live-map.mjs` `unreadOf`); opening the chat clears it; session only |
| `profile › the usage rings per harness` | wired (partial) | limit pauses only, all dev reports: a paused run's `limitEngine` and `limitResetAt` draw that harness's ring full (D15) |
| `profile › spend and the budget left` | wired | `GET /api/budget`: `windowSpendUsd`, `totalLimitUsd`, `resetPeriod`, `windowEndMs`; Details goes to `insights/spend` |
| `shell/world.js › RailWorld.live` | wired | the shell's `data-adapter` stamp (`src/core/stillhet-shell.mjs`), read once by `adapter.js` |
| `live/live-adapter.mjs › every source and frame` | wired | the D10 GET routes, the `/ws` frames, a `*-changed` frame re-fetching its own source (250 ms debounce), reconnect with backoff |
| `live/live-map.mjs › the shapes` | wired | pure mapping onto `live/model-shape.mjs` `SHAPES`; no field outside them reaches the store |
| `profile › the interface mode` | wired | dev's `uiLevel`: the `data-level` stamp at start, `POST /api/settings {uiLevel}` on a person's pick only |
| `profile › Keep awake` | wired | `keepAwake` of `GET /api/settings`; `POST /api/settings {keepAwake}` |
| `profile › Away` | wired | `GET /api/away-mode`; `POST /api/settings {nightModeToggle}` with dev's Away switch body |

## Opt-in

Wired in slice 1, each row real:

| Area | Where it lives | What it does |
|---|---|---|
| The `rail` flag | `src/shared/flags/registry.mjs` | One experimental flag, off by default; `WORCA_FLAGS=rail` locks it. |
| The asked-once answer | `onboarding.stillhetAsked` in `settings.json` | Stored when the flag is turned on or No thanks is chosen; undone by setting it false. |
| The ask switch | `src/core/stillhet.mjs` | Hides the question, and the top-bar switch while Stillhet is off, until the last slice of feature 3 turns it on, once every area runs on live data. |
| The Labs row | `ui/public/stillhet.mjs` `stillhetLabsRow` | Settings › Labs shows the `rail` row (Stillhet, experimental) in every level, whatever the ask switch says: until the end of feature 3 the one way in and out. The one flag-off difference from dev the owner accepts (`tools/stillhet-style-diff.mjs` `ACCEPTED`). |
| The Invitation | `ui/public/design-system/components/invitation.mjs` | A ConfirmStrip under the top bar; Try Stillhet sets the flag, No thanks is never asked again. |
| The Stillhet UI switch | `ui/public/design-system/components/design-switch.mjs` | The top-bar switch, the same setting as Settings › Labs. |
| The reload | `ui/public/stillhet.mjs` | A change of the flag reloads each open page once, never while text is typed. |
