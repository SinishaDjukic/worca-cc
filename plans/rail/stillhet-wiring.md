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
