# Run presets

A run preset is a named New run setup. Save the choices you make for a kind of run once, then
pick the preset, type only the prompt and press **Start run**. The run gets the preset's choices
for that run only: the project's saved settings never change.

Run presets are in beta and on by default. Turn them off in **Settings › Labs ›
Run presets** (flag `runPresets`, see [Feature flags](feature-flags.md)), or with
`worca flags off runPresets`.

## What a preset keeps

A preset keeps the run's **choices**, never its task:

| Saved | Never saved |
|---|---|
| Workflow, engine, guardrail set | Title, prompt, Markdown, task source |
| Every agent's model, effort, fan-out, questions and sub-agent model | Extra files |
| Every loop's budget (max cycles) | The new branch name |
| Human in the loop | Consents given per start: *Allow unguarded*, a team-cap override and its reason, a sync choice |
| Source branch (project and workspace presets), *Run on the source branch*, *Sync before start* | Schedule fields |
| Away mark, Sets opt-outs, Mock mode, run tags | |

A preset stores **full picks**. When you save, Worca resolves the workflow for the project you
are on and fills in every agent's effective values and every loop's budget, so a later change to
the project's settings never changes what the preset runs.

## Scope

- **Any project** (the default). A preset for any project stores no branch names, but keeps
  *Run on the source branch* and *Sync before start*.
- **Only one project** or **only one workspace**. Picking a pinned preset also switches New run
  to its project or workspace. Starting a pinned preset on another target is refused.

## Using a preset

Pick it from the **Preset ▾** button at the top right of New run. The form fills in, the button
shows the preset's name (filled), and a muted line beside it says what the preset sets and that it
*applies to this run only*. While a preset is applied:

- changing an agent's model, a loop budget, human in the loop or the workflow changes the preset
  for this run only, and nothing is written to the project's settings. A **Modified** chip then
  shows, with **Update preset** (saves the change into the preset); the menu offers **Save as new…**;
- in Simple mode, the note above Start run names what the preset applies that Simple mode hides:
  its agent picks, loop budgets, Away mark, Sets opt-outs and engine (by its label, for example
  *Codex engine*);
- the menu ticks the applied preset and adds **Rename…** and **Delete…** for it, with the same
  dialogs as Settings › Presets, at every interface level;
- the **✕** beside the button leaves preset mode, and the form shows the project's settings again.

**Save as preset** (the last item of the menu; **Manage presets…** follows it from Advanced) saves
what the form holds now. The dialog asks for a name (1–80
characters, unique among your presets whatever the case) and a scope.

## When a preset needs attention

A preset can refer to something that is gone: a deleted workflow or guardrail set, a model no
longer in the catalog, a loop the workflow no longer has, an engine that cannot run, or the
pinned project or workspace. Worca never falls back silently (a gone guardrail set is not
replaced by Permissive). Instead, a card titled *This preset needs attention* lists each item,
for example *Planner: model my-gateway-opus is no longer in the catalog*, and **Start run** stays
disabled until each one is fixed:

- **Reset to default** drops the preset's pick, so the project's own setting applies;
- or pick another value in the form (another model in the Planner row, another guardrail set);
- a gone project or workspace has no reset: edit the preset's scope in **Settings › Presets**.
  Below Advanced, where that tab is hidden, the card says to delete the preset from the **⋯** menu
  beside Preset, or to switch to Advanced to edit its scope.

The server checks again when the run starts (`POST /api/run` with `presetId`) and refuses a
broken setup with 409 `preset-broken`, naming the same items.

## Settings › Presets

The tab is part of Advanced mode (docs/ui-levels.md); below Advanced, New run's **⋯** menu renames
and deletes, and the Preset menu leaves out *Manage presets…*.

One card per preset with its scope, workflow, engine and when it was last updated. The workflow
reads by its name (*Auto workflow* for Auto, *Workflow removed* once it is deleted), and the
engine by its label (*Claude*, *Codex*, *Copilot*, *Cursor*), never by an id. **Use** opens
New run with the preset applied; **Rename**, **Duplicate**, **Edit scope** and **Delete** manage
it. A pinned preset whose project or workspace is gone shows *Project gone* (or *Workspace gone*);
**Edit scope** can pin it again or make it global.

## Save a run's setup

Every run started from this version on keeps its setup: the same choices a preset keeps, with every
agent and loop filled in, and never its task. On a finished run's page (History), **Save setup as
preset** saves that setup as a new preset. The scope defaults to the run's own project (or
workspace), so branch names are kept; *Any project* is offered too and drops them. The preset goes
into your own list, also on a shared deployment.

Runs from before this version, runs started from the CLI, and scans have no stored setup, so the
button is not shown on their page.

## On the Chat home

With run presets on, the Chat home shows **Start from a preset**: up to 6 chips, first the presets
pinned to New run's current project or workspace, then the *Any project* ones. Presets pinned to
another target are left out. A chip opens New run with the preset applied, the same as **Use** in
Settings › Presets. A chip's tooltip names its scope, workflow and engine. With more than 6, a
*N more…* chip opens Settings › Presets (New run, whose picker lists every preset, below Advanced).
With no matching preset the section is hidden.

## Schedules

**Schedule…** on New run with a preset applied makes a schedule that **follows the preset**. The
schedule keeps a link to the preset, not a copy of its picks, and reads the preset each time it
fires. Edit the preset, and the next run uses the new setup. The prompt, title, target and
schedule stay the schedule's own. For an *Any project* preset, the schedule also keeps its own
source branch.

A field you changed in the form before scheduling (or a choice a Chat card made) stays as
you set it: only the fields you left as the preset had them follow later edits to the preset.
A schedule made from a Chat card never starts on *Permissive* guardrails: if the preset
resolves to Permissive when it fires, the run ends *failed* and says so.

The Schedules page names the preset in each row (`preset Quick fix`), and **Details** has a
**Preset** row. When a run fires, the preset is checked like any preset start, and a run that
cannot start ends *failed* with the reason:

- a broken item, for example *Preset "Tight run" cannot start: Guardrail set gr_1a2b3c4d no
  longer exists*;
- a deleted preset: *Preset "Quick fix" no longer exists*. The row then reads *preset deleted*,
  and its details say the next run will fail. Re-create the schedule from New run to fix it;
- run presets turned off: the run says it follows a preset and that run presets are off.

A failed start counts towards a series' *Pause after failures in a row*, as any failed start does.
On a shared deployment a schedule reads the preset of the person who made it.

## From the terminal

```
worca run --preset "Quick fix" --prompt "Fix the login bug" [--title T] [--project DIR | --workspace ID]
```

`worca run` starts a run from a preset with just a prompt. It sends the run to the running Worca
server, so start one first with `worca ui`. The name matches in any case, among the *Any project*
presets and the ones pinned to the project (the current directory, or `--project`) or to
`--workspace`. It prints the run id and how to follow it (`worca logs ID`).

| Exit | When |
|---|---|
| 0 | The run started |
| 1 | No preset by that name here (the in-scope names are listed), the preset is pinned to another project or workspace, the preset cannot start (one line per broken item), no Worca server is running, or run presets are turned off |
| 2 | A usage error: no `--preset`, no `--prompt`, or an unknown option |

`worca run --preset` is unaffected by interface levels.

`worca run` works against a local Worca server. A server that asks you to sign in answers with
its sign-in hint.

## Chat

Chat can propose a run from one of your presets. Its `list_presets` tool lists the presets
that fit the chat's pinned project or workspace (and the *Any project* ones), and `propose_run`
takes a `presetId`. The card then shows *From preset Quick fix* and the preset's workflow,
guardrails, engine and agent models. Anything Chat names itself wins over the preset.
**Start** sends the preset's other picks too (human in the loop, Away mark, opt-outs, loop
budgets) and the server checks the preset again. Switching the card to another workflow drops the
preset's agent picks, and the card says so.

A preset on the Permissive guardrail set (or with none) is not proposed as is: Chat must name
a stricter guardrail set. A preset's tags reach the card only while Run tags are on, because the
card sends tags only through its tag row.

## Shared deployments

Presets are per person. On a deployment where people sign in, each person sees, changes and
starts only their own presets; another person's preset answers *not found*. A local install sees
every preset.

## API

| Route | What it does |
|---|---|
| `GET /api/presets` | Your presets |
| `POST /api/presets` | `{ name, scope: { kind: 'global' } \| { kind: 'project', projectDir } \| { kind: 'workspace', workspaceId }, setup, basis: { projectDir } \| { workspaceId } }` → 201 `{ preset }` |
| `PUT /api/presets/:id` | `{ name?, scope?, setup?, basis? }` |
| `POST /api/presets/:id/duplicate` | A copy named *… (copy)* |
| `DELETE /api/presets/:id` | Delete it |
| `POST /api/presets/:id/check` | `{ projectDir }` or `{ workspaceId }` → `{ broken: [{ item, ref, message, reset }] }` |
| `GET /api/pipelines/:id/setup` | The setup a run kept at start → `{ setup, target }`; `setup` is `null` for a run from before this version, the CLI or a scan |
| `POST /api/pipelines/:id/preset` | `{ name, scope: { kind: 'global' \| 'project' \| 'workspace' } }` → 201 `{ preset }`; the server takes the project or workspace from the run itself. 409 `{ code: 'no-run-setup' }` when the run has no stored setup |

`setup` takes the `POST /api/run` keys `workflowId`, `engine`, `guardrailsId`, `mcpOptOut`, `mock`,
`nightMode`, `humanInLoop`, `sourceBranch`, `sourceBranchByKey`, `sameAsSource`, `syncBeforeStart`,
`tags` and `overlay` (`nodes` and `wires`, see [Per-agent models for one run](models.md#per-agent-models-for-one-run)).
Any other key is dropped, and a setup larger than 32 KB is refused. A run started from a preset
sends the preset's choices as an ordinary run body, plus `presetId`, `overlay` and `humanInLoop`.
