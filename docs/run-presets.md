# Run presets

A run preset is a named New run setup. Save the choices you make for a kind of run once, then
pick the preset, type only the prompt and press **Start run**. The run gets the preset's choices
for that run only: the project's saved settings never change.

Run presets are experimental and off by default. Turn them on in **Settings › Experimental ›
Run presets** (flag `runPresets`, see [Feature flags](feature-flags.md)).

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

Pick it in the **Preset** menu at the top of New run. The form fills in, and a chip says
*Preset — changes here apply to this run only*. While a preset is applied:

- changing an agent's model, a loop budget, human in the loop or the workflow changes the preset
  for this run only, and nothing is written to the project's settings. The chip then reads
  *· modified*, with **Update preset** (saves the change into the preset) and **Save as new…**;
- in Simple mode, the note above Start run names what the preset applies that Simple mode hides:
  its agent picks, loop budgets, Away mark, Sets opt-outs and engine;
- choosing **No preset** leaves preset mode, and the form shows the project's settings again.

**Save current setup…** saves what the form holds now. The dialog asks for a name (1–80
characters, unique among your presets whatever the case) and a scope.

## When a preset needs attention

A preset can refer to something that is gone: a deleted workflow or guardrail set, a model no
longer in the catalog, a loop the workflow no longer has, an engine that cannot run, or the
pinned project or workspace. Worca never falls back silently (a gone guardrail set is not
replaced by Permissive). Instead, a card titled *This preset needs attention* lists each item,
for example *Planner: model my-gateway-opus is no longer in the catalog*, and **Start run** stays
disabled until each one is fixed:

- **Reset to project default** drops the preset's pick, so the project's own setting applies;
- or pick another value in the form (another model in the Planner row, another guardrail set);
- a gone project or workspace has no reset: edit the preset's scope in **Settings › Presets**.

The server checks again when the run starts (`POST /api/run` with `presetId`) and refuses a
broken setup with 409 `preset-broken`, naming the same items.

## Settings › Presets

One card per preset with its scope, workflow, engine and when it was last updated. **Use** opens
New run with the preset applied; **Rename**, **Duplicate**, **Edit scope** and **Delete** manage
it. A pinned preset whose project or workspace is gone shows *Project gone* (or *Workspace gone*);
**Edit scope** can pin it again or make it global.

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

`setup` takes the `POST /api/run` keys `workflowId`, `engine`, `guardrailsId`, `mcpOptOut`, `mock`,
`nightMode`, `humanInLoop`, `sourceBranch`, `sourceBranchByKey`, `sameAsSource`, `syncBeforeStart`,
`tags` and `overlay` (`nodes` and `wires`, see [Per-agent models for one run](models.md#per-agent-models-for-one-run)).
Any other key is dropped, and a setup larger than 32 KB is refused. A run started from a preset
sends the preset's choices as an ordinary run body, plus `presetId`, `overlay` and `humanInLoop`.
