# New Pipeline UX — Design

Status: **implemented** (branch `feat/newpipeline-ux`)
Scope decided: **inline accordion** for per-agent config + **workflow-level per-node defaults** with delta-based run config. Explicitly out of scope: a multi-step wizard, a slide-over panel, and graph-popover editing (see §7 for why and §8 for future paths).

Measured result at 1280×900, project selected: the run form went from **1947px to 866px** with Advanced collapsed (−56%), or 1321px with it open, and no longer grows with the workflow, because a collapsed agent row is fixed-height. (It reached 1056px with title/branches/extra files behind Advanced; promoting those four back into the main column — §4.6 — spent ~275px of that win deliberately, on the fields that are actually edited every run.)

## 1. Problem

The New pipeline page (`ui/public/index.html:113-352`) is one long form in which every field has equal visual weight and nothing is collapsed:

1. ~8 always-visible fields (target, project, title, source branch, feature branch, task source, extras, mock) precede the Start button.
2. The pipeline-configuration block renders **every agent as a permanently expanded row** — two dropdowns (model, effort), a fan-out toggle, a questions toggle, and a caption. The Default workflow alone is 5 such rows (`#wf-default-stages`, `index.html:269-329`); a saved workflow appends one row per node (`#wf-node-config`) plus one cycle-count row per feedback loop (`#wf-feedback-config`).
3. Sensible defaults already exist — an unset model/effort inherits the CLI default, fan-out/questions defaults come from the agent registry (`buildNodeConfigRows`, `ui/public/app.js:2421`) — but the UI cannot say "everything here is default" in less than N rows, so the user scrolls past controls they will almost never touch.

The result: the 90% path (*pick project, type prompt, press Start*) requires scrolling past the 10% path (tuning models per agent), and the page height grows linearly with workflow size.

Two structural defects make any redesign harder than it should be:

- **Two parallel render paths.** The Default workflow's rows are static HTML (`#wf-default-stages`) driven by `data-role` attributes; saved workflows go through the dynamic `buildNodeConfigRows` → `renderNodeRows` path. Every behavior (captions, effort filtering, questions gating) is implemented twice or shared awkwardly through `renderModelEffortPair` (`app.js:2595`).
- **Workflows cannot carry tuning.** Templates are topology only — `steps` + `feedbacks` by node-instance id (`src/core/workflows.mjs:5`, schema at `:90`). All model/effort/fan-out/questions selections live in the per-project run config (`config.mjs` `setStep`/`setNodeModel`, `:382`/`:601`), so a shared or exported workflow arrives untuned and "reset to defaults" has no well-defined target.

## 2. Goals

- **One screen, zero scrolling for the 90% path**: Target/Project, Task, Workflow, Start — regardless of workflow size.
- **Progressive disclosure for the 10% path**: per-agent config collapses to one compact summary row per agent showing its *effective* settings; expanding is one click; a "modified" indicator + **Reset to workflow defaults** make the deviation-from-default state visible without expanding anything.
- **Workflows ship with sensible defaults**: a workflow node may carry `defaults: {model, effort, fanOut, askQuestions}`; the per-project run config stores only *overrides* (deltas). Shared/exported workflows bring their tuning with them.
- **One render path**: the Default workflow renders through the same dynamic pipeline as saved workflows; the static `#wf-default-stages` block is deleted.
- Everything that has a safe default (title, branches, extras, guardrails, mock) moves behind a collapsed **Advanced** disclosure.

## 3. Non-goals

- **A multi-step wizard.** New pipeline is a high-frequency repeat action; a wizard adds clicks to every run and hides the prompt behind navigation. Progressive disclosure achieves the same "advanced stuff out of sight" without taxing the common path (decision log D1).
- **Graph-based node editing on this page.** Attractive and consistent with the run view, but heaviest to build and collides with the in-flight graph v2 work (PR #359). Deferred (§8).
- **Changing what is configurable.** Same knobs as today: model, effort, fan-out, questions (where the agent supports them), feedback max-cycles, guardrails, mock. This is a presentation + defaults-plumbing change, not a capability change.
- **A worca-level default model.** Unchanged from the configurable-models design: when nothing resolves, no `--model` flag is passed and the CLI default applies.
- **Redesigning the workflow editor's canvas.** The editor only gains the same accordion component so authors can set node defaults (§4.5); its topology editing is untouched.

## 4. Design

### 4.1 Page layout (top to bottom)

1. **Target + picker, on one row** (`.split-row`) — the segmented Project/Workspace switch in a left column sized to itself, and the picker it selects in the right. Both target panes live in that one right-hand cell, so flipping the switch swaps the picker without the switch moving. Saves ~108px over the stacked version.
   The project pane's inline `[×]` (which **deleted** the project, not the selection) is gone: removal is rare and destructive, so it lives in the Projects view with the app's own confirm dialog — exactly where workspace removal has always lived. Both panes now link to their manager from the hint ("Manage projects" / "Manage workspaces"), and the two panes finally read the same. `deleteProject` in the Projects view is untouched; only the second, native-`confirm()` path is retired.
2. **Title** — names the run, so it belongs with the task rather than behind a disclosure.
3. **Task** — prompt/markdown segmented control + textarea, unchanged mechanics; visually the centerpiece of the page.
4. **Extra files** — directly under the task source, because they are more of the same input, just as files. Labelled `Extra files (optional)` to match the `Feature branch (optional)` convention.
5. **Source branch | Feature branch** — one two-column row (`.field-grid-2`): they are a single decision (branch from → into), so they read better paired than stacked.
6. **Advanced** (`<details>`, always collapsed) — the agents accordion (§4.2), guardrails, mock mode (§4.6).
7. **Start run.**

The **Task source switch and the Workflow picker share one row**, using the same `.split-row` proportion as Target/Project — one CSS class for both, so the two rows cannot drift apart. The task panes span the full width below, so the prompt box is never squeezed into a column.

Choosing a workflow is a run decision and stays in the main column; **tuning its agents is not, and moved into Advanced** — which is the logical end of "workflows ship tuned". Advanced now reads as *how the run executes* against a main column of *what it runs*. With Advanced collapsed the whole form is **866px**: one screen, no scrolling, which was Goal 1.

Items 2, 4 and 5 were briefly inside Advanced and were promoted back out: they are edited often enough that a disclosure was the wrong home. They carry `.field-compact` (12px labels, 40px controls, 12px gaps) so the four of them cost ~275px instead of the ~340px full-size fields would have.

### 4.2 Agents accordion

Header line: `Agents · all defaults` or `Agents · 2 modified`, plus a **Reset to workflow defaults** button enabled only when at least one override exists. Reset clears the run-config deltas for the selected workflow (per project), not the workflow's own `defaults`.

One row per node, in dispatch order (outer sequential, inner parallel — same ordering as `buildNodeConfigRows`):

- **Collapsed**: color accent, display name, step number, effective summary caption — `default` when nothing deviates, else e.g. `Opus 4.8 · high · fan-out` (`agentSummaryText`). The vocabulary matches `nodeModelLine` (`app.js:803-820`) so the New-Pipeline row and the run-graph node read the same.
- **Modified dot** on any row whose stored override differs from the resolved workflow default. A locked questions toggle never counts — it is not the user's doing and cannot be reset.
- **Expanded**: the agent's blurb, then the existing controls — model select, effort select (filtered to the model's efforts), fan-out toggle, questions toggle — then a "Default: …" line naming what the row falls back to. Questions is omitted entirely for an agent without `asksQuestions` (stronger than the old hidden wrapper) and disabled when `questionsLocked`; the gating logic in `buildNodeConfigRows` is unchanged, only re-homed.
- The collapsed caption is the row's ONLY caption: the head updates live from the controls (`paintRowSummary`), so the old in-body `.step-current` line would only have duplicated it a few pixels lower.
- **With no project selected the accordion is read-only**: rows still render (seeing what a workflow will do is useful on its own) but every control is disabled and the header reads *"select a project to change these"*. Per-agent config is stored per project, so there was nowhere to write it — the save no-opped and the re-render silently undid the edit, which reads as a broken control. `saveAgentRow` also reports it, as defence in depth. Re-enabling never un-locks a `questionsLocked` agent (`data-locked`).
- **The effort select explains itself.** It stays disabled until a model is chosen — which efforts exist is a property of the model — but now says `(pick a model first)` with a tooltip, instead of greying out unexplained next to a live model dropdown.
- Multiple rows may be open at once; all start collapsed. Open/closed state is ephemeral (`openAgentRows`) but survives a save's re-render, so a row never slams shut under the user.

**Feedback loops** become one final accordion row, collapsed by default (the default of 3 cycles is sensible). Expanded, it lists the existing `buildFeedbackRows` output (`app.js:2467`) — directional label + max-cycles number input per loop.

Parallel-group members keep a visual hint (indent or `∥` marker) as today's `parallel` flag provides.

### 4.3 Effective-value resolution

Per setting, first defined wins:

1. per-project run-config **override** (`runConfig.nodes[nodeId]` / legacy `steps[role]`),
2. workflow node **`defaults`** (§4.4),
3. agent-registry defaults (`fanOut`, `questionsDefault` — as consumed by `buildNodeConfigRows` today),
4. global fallback: no model → no `--model` flag (CLI default); effort follows the model's first advertised effort for display purposes only (`defaultEffortFor`, `app.js:2517`).

The accordion always displays the **resolved** value and marks the row modified iff layer 1 is present and differs from layers 2–4's resolution. Dispatch (orchestrator side) applies the same resolution so what the UI shows is what runs.

### 4.4 Workflow schema: per-node `defaults`

`workflows.steps[][]` nodes gain an optional field:

```jsonc
{
  "id": "s1_0",
  "key": "planner",
  "defaults": {                 // all fields optional; absent field = inherit (layers 3-4)
    "model": "claude-opus-5",   // must pass the same validation as run-config writes
    "effort": "high",           // must be within the model's advertised efforts
    "fanOut": true,
    "askQuestions": false       // ignored for agents without asksQuestions; never overrides questionsLocked
  }
}
```

- **Additive, no migration.** Existing workflow rows have no `defaults` and resolve exactly as today. `writeWorkflow` runs every node through `sanitizeWorkflowSteps`, which is loud-and-lenient per FIELD (a bad `effort` is dropped with a `console.warn` while its siblings survive) and passes unknown node fields through untouched, so a plugin template's own extras are never eaten.
- An `effort` with no `model` never survives sanitization: an effort is only interpretable against the model that advertises it.
- The "topology only" contract comment (`workflows.mjs:5`) is updated: templates are **topology + per-node defaults**; per-project overrides remain in run config.
- `defaults.model`/`effort` are validated at the API boundary against the **project-less** catalog (predefined ⊕ global ⊕ plugin), matching `setStep`/`setNodeModel`'s rules — both on `PATCH .../defaults` and on `POST /api/workflows`, so an imported template cannot smuggle in a model id a per-project override would be refused.
- The **Default workflow** (`wf_default`) gets its `defaults` from the agent registry exactly as today — i.e. it needs no stored `defaults`; layer 3 covers it. It is frozen and never persisted, so `setWorkflowNodeDefaults` refuses it outright (decision D6).
- Plugin-shipped workflow templates may include `defaults`; the same sanitizer applies on import.

### 4.5 Run config becomes deltas (prune-on-save)

- Semantically, run-config values are already overrides; this design makes them **sparse**. On every save from the accordion (`pruneNodeSelection`), any value equal to the resolved default (layers 2–4) is stored as "inherit" instead: `''` for a model/effort, and an explicit `null` for a boolean toggle.
- `null` is a new third state for the toggles, shared by `setStep` and `setNodeModel` via `inheritOr`: boolean sets, `null` clears, absent preserves. Without it there was no way to walk a fan-out override back to "follow the default" — omitting the field means "keep what you have".
- `model` and `effort` prune as a **pair**: if either deviates, both are stored, because the setters reject an effort with no model.
- No data rewrite/migration: existing dense configs remain valid (layer 1 simply matches layer 2-4 resolution and the row shows unmodified — pruning happens lazily on next save).
- **Reset to defaults** = `DELETE /api/config/workflow` → drop the run-config node + feedback rows for that workflow. For `wf_default` it also clears the legacy per-role `steps` blob, which is where that workflow's overrides actually live; skipping it would leave the page reading "all defaults" while the run still used the old models.
- Workspace target keeps its existing semantics: per-agent models resolve per project from each project's own config; layers 2–4 are project-independent, layer 1 is per-project.

### 4.6 Advanced disclosure

Holds the agents accordion (§4.2), guardrails (default Permissive) and mock mode (default off). **Always collapsed on arrival**, with a header that says only "Advanced" — it never opens itself and carries no summary line.

An earlier cut did both: a sub-line listing what was inside, switching to a violet list of what deviated. Both were wrong. The line used one slot for two different meanings (contents vs deviations), so it could not be read at a glance; violet is the link colour, so a status read as clickable; and when the section was open — exactly when the auto-open put it — the line restated what was already visible an inch below, with lowercase "agents" sitting above the bold "Agents" header.

Nothing is lost by staying shut: an agent override is stated by the accordion the moment it is opened, and the **config-load error hint moved to the main column** precisely because this section no longer opens itself. `advancedIsNonDefault` / `syncAdvancedDisclosure` are gone with the mechanism.

### 4.6b Copy convention for optional fields

An `(optional)` label says a field *may* be skipped; it does not say what happens if you do. Every optional field answers that with the same sentence, so the answer is learned once:

> **Leave empty and Worca will propose one.**

It is used verbatim on **Title** (the title agent writes one from the prompt) and **Feature branch** (`suggestBranchName` derives one). Both statements are literally true, which is why the sentence can be shared.

**Extra files** keeps the opener but not the promise — nothing is proposed there, so claiming it would be a lie: *"Leave empty and the run gets no extra files."* That string had drifted into two different versions (one in the markup, another in `app.js`'s deselect path); both now use the one sentence, pinned by a test.

Two supporting rules:

- The hint carries the instruction, so the **placeholder is a plain example** (`e.g. feat/rate-limiter`) rather than a second copy of it.
- **One verb across the app**: the Settings hints said "Leave blank" while New Pipeline said "leave empty". All now say "Leave empty".

Cost: ~23px total. The Feature-branch hint is free — it shares a grid row with the Source-branch hint, which sets the row height — and it balances that row visually.

### 4.7 Render-path consolidation

- `#wf-default-stages` (the five static cards) and `renderStepConfigs` are **deleted**. The Default workflow is resolved to its node list and rendered through `buildNodeConfigRows` → `renderAgentRows`, same as any saved workflow. `renderModelEffortPair` remains the single place dropdown contents + effort filtering live.
- Legacy per-role run-config storage (`steps[role]`) keeps working as layer-1 input for the Default workflow's rows, and keeps being the **write** path for them: a row carries `role` when the workflow is `wf_default`, and `saveAgentRow` routes to `setStep` rather than `setNodeModel`. That preserves compatibility with the CLI and every existing install; no storage migration.
- The Default workflow gets two offline fallbacks so deleting the static markup cannot make a server hiccup fatal: `DEFAULT_WF_TOPOLOGY` (its five nodes) when `GET /api/workflows/wf_default` fails, and `DEFAULT_STAGE_META` (the labels/colors/blurbs that used to be in the HTML) layered under the `/api/agents` registry and the per-step sidecar flags. A saved workflow keeps the existing "Could not load this workflow." behavior, since it has no such fallback.
- The controls read their values from the **live DOM** (`liveRowValues`), not from the last-rendered row data or `state.config` — state lags an in-flight save, so echoing it could revert a model picked moments earlier.

### 4.8 Authoring the defaults: promote from where you tuned them

Defaults are set from the **accordion header**, not from a second editor: once at least one row deviates, a **Save as workflow defaults** button appears next to Reset. It promotes every row's *effective* config onto the workflow (`PATCH /api/workflows/:id/defaults`) and then clears the now-redundant per-project overrides (the same `DELETE` Reset uses). The effective pipeline is unchanged; what changes is that the tuning now travels with the workflow — to every other project, and through export/share.

This supersedes the original plan of teaching the Composer canvas to edit `defaults`. Promotion is discoverable exactly where the user is already tuning, needs no new editing surface, and is one click instead of "leave New Pipeline → find the workflow → click each node". The Composer path stays available as future work (§8).

The button is hidden for `wf_default`: the built-in is frozen and never persisted, so it has no row to carry defaults. Its sensible defaults come from the agent registry instead (D6); duplicating it in Composer yields a saved workflow that can store them.

## 5. Testing

House style: jsdom unit tests against the pure helpers exposed on `window.__np`, plus in-process HTTP tests for the endpoints.

**New files**

- `test/workflow-node-defaults.test.mjs` (13) — `sanitizeNodeDefaults` / `sanitizeWorkflowSteps` / `workflowNodeDefaults`, the `setWorkflowNodeDefaults` writer (set, clear, ignore-unknown-node, refuse `wf_default`), and the resolution layer inside `resolveWorkflow`: default supplies model/effort, an override beats it and does *not* inherit its effort, defaults outrank the registry for `fanOut`/`askQuestions`, a locked agent ignores them, and a defaults-free workflow resolves byte-identically to before.
- `test/api-workflow-defaults.test.mjs` (7) — `PATCH .../defaults` happy path + the three validation refusals + 400/404/frozen-default cases, defaults smuggled through `POST /api/workflows`, and `DELETE /api/config/workflow` (scoped to one workflow, clears wf_default's legacy steps, idempotent, 400s without its ids).
- `test/ui-agents-accordion.test.mjs` (17) — the four-layer resolution as the UI sees it, the modified dot and header count, `agentSummaryText`/`agentsHeaderText`, `pruneNodeSelection` (including the model+effort pair rule and the never-persist-a-locked-toggle rule), the full re-pick-the-default round trip against a **stateful** config mock, Reset, Save-as-defaults, promote-hidden-for-`wf_default`, open-row survives a save, live caption before the save lands, and the Advanced disclosure (starts collapsed, force-opens on non-default, names each deviating field, single vs per-member branch pickers).

**Extended**: `test/config.test.mjs` — `null` clears a toggle while `undefined` preserves and `false` stores; an emptied node drops its row; `resetWorkflowConfig` scoping.

**Updated for the new DOM**: `newpipeline-config`, `config-ui`, `ui-newpipeline-questions`, `ui-stage-row-blurb`, `newpipeline-selector-width`.

Suite: **2312 passing / 2316**. The 4 failures (`imagegen` skill bundling ×2, `skills-gate-wiring` ×2) reproduce unchanged on `dev` and are unrelated to this work.

## 6. Implementation order

Built as one branch (`feat/newpipeline-ux`) rather than the two PRs planned below, because the accordion needs the `def`/`override` split that only layer 2 gives it — splitting would have meant writing the resolution helper twice. The original split is kept here as the record of the plan:

1. **PR 1 — UI restructure (no schema change).** Accordion + Advanced disclosure + render-path consolidation.
2. **PR 2 — Workflow defaults + deltas.** `defaults` field + save-time validation, resolution layer 2, prune-on-save, Reset button.

**Coordination flag:** PR #359 (graph v2) rewrites large parts of `ui/public/app.js`. Decide merge order before this lands, or the second one in pays a painful rebase.

## 7. Decision log

- **D1 — Inline accordion** over slide-over panel, graph-popover, and two-step wizard. Chosen: smallest architectural change, page stays one column, biggest height reduction per effort; wizard rejected for taxing the high-frequency path; graph-popover deferred behind graph v2 (§8).
- **D2 — Workflow-level per-node defaults: yes.** Run config becomes sparse overrides; shared workflows carry tuning; Reset has a defined target. Additive schema, no migration.
- **D3 — Prune-on-save** rather than a one-shot migration of existing dense run configs. Convergence is lazy and safe; dense legacy values stay valid.
- **D4 — Feedback loops live as one accordion row**, not a separate section — same disclosure logic, default 3 cycles stays invisible until someone cares.
- **D5 — Advanced disclosure auto-expands when non-default**, so collapsing never hides active state.
- **D6 — Default workflow needs no stored `defaults`**; the agent registry (layer 3) already encodes its sensible defaults. Avoids double-maintaining built-ins, and keeps the frozen built-in genuinely frozen.
- **D7 — Two PRs**, UI-first — *superseded during implementation*: see §6.
- **D8 — Defaults are promoted from the accordion, not authored in the Composer** (§4.8). Same result, no second editing surface, and it lives where the tuning already happens.
- **D9 — An override never inherits the default's effort** when it names its own model. `Opus·max` + an override to Haiku must not silently become `Haiku·max`; enforced identically in `resolveWorkflow` and `buildNodeConfigRows`.
- **D15 — The workflow picker and its agents live apart**, so the accordion header carries a chip with the workflow's name. Without it, "Agents · all defaults" inside Advanced would not say *whose* defaults.
- **D17 — Flipping the target must not relayout the form.** The two panes are kept the same height: one hint line each, no empty flex container holding a margin, and the source-branch field stays present (disabled) in workspace mode rather than vanishing.
- **D16 — Advanced is always collapsed and its header is bare.** A disclosure that opens itself, or annotates itself, is doing a job the section's own contents already do. An error that must be seen belongs outside it.
- **D14 — A control that cannot work says why.** No-project disables the accordion with a reason; effort names its dependency on the model. Both previously failed silently, which is indistinguishable from a bug.
- **D13 — The target switch shares a row with its picker**, and destructive management lives in the management views, not inline in a picker used every run (§4.1).
- **D12 — One sentence answers "what if I skip this?"** for every optional field (§4.6b); the placeholder holds an example, never a duplicate of the hint.
- **D11 — Advanced holds only guardrails + mock.** A safe default is not the same as an infrequent edit; title, the branch pair and extra files fail the second test and live in the main column, compacted (§4.1/§4.6).
- **D10 — The Default workflow keeps writing through the legacy per-role path.** Rendering was unified; storage was not. The CLI and every existing install write `steps[role]`, and switching the UI to node-keyed writes would have split the truth across two tables for the most-used workflow.

## 8. Out of scope / future

- **Graph-popover editing** on New pipeline (click a node in a mini-graph to tune it) — revisit after graph v2 (PR #359) lands; the accordion's resolution helpers are reusable as-is.
- **Composer-side defaults editing** (§4.8) — promotion covers the need; direct editing on the canvas is additive whenever it is wanted.
- **Slide-over panel** as a home for future per-run options if the accordion outgrows one column.
- **Named tuning presets** ("cheap run" / "thorough run") applied across a workflow — builds naturally on `defaults` + deltas, not designed here.
- **Defaults for `wf_default`** would need somewhere to persist a frozen built-in (a settings key, or a real row shadowing the constant). Not built: the registry already gives it sensible defaults, and "duplicate it in Composer" is the honest answer.
