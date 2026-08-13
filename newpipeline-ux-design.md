# New Pipeline UX — Design

Status: draft
Scope decided: **inline accordion** for per-agent config + **workflow-level per-node defaults** with delta-based run config. Explicitly out of scope: a multi-step wizard, a slide-over panel, and graph-popover editing (see §7 for why and §8 for future paths).

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

1. **Target / Project** — unchanged (segmented Project/Workspace + pickers).
2. **Task** — prompt/markdown segmented control + textarea, unchanged mechanics; visually the centerpiece of the page.
3. **Workflow** — existing picker (`#workflowSelect`).
4. **Agents accordion** — replaces `#pipeline-config`'s stage/node/feedback blocks (§4.2).
5. **Advanced** (collapsed `<details>`-style disclosure) — title, source branch, feature branch, extra files, guardrails, mock mode (§4.6).
6. **Start run.**

### 4.2 Agents accordion

Header line: `Agents · all defaults` or `Agents · 2 modified`, plus a **Reset to workflow defaults** button enabled only when at least one override exists. Reset clears the run-config deltas for the selected workflow (per project), not the workflow's own `defaults`.

One row per node, in dispatch order (outer sequential, inner parallel — same ordering as `buildNodeConfigRows`):

- **Collapsed**: color accent, display name, effective summary caption — `default` when nothing deviates, else e.g. `Opus · high · fan-out`. The caption logic reuses the existing `renderModelEffortPair` caption + `nodeModelLine` (`app.js:803-820`) conventions: friendly model label, raw effort, `default` when fully inherited.
- **Modified dot** on any row whose stored override differs from the resolved workflow default.
- **Expanded**: the existing controls — model select, effort select (filtered to the model's efforts), fan-out toggle, questions toggle. Questions stays hidden unless the agent's registry entry has `asksQuestions`, and renders disabled when `questionsLocked` — the gating logic in `buildNodeConfigRows` (`app.js:2433-2452`) is unchanged, only re-homed.
- Multiple rows may be open at once; all start collapsed. Open/closed state is ephemeral (not persisted).

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

- **Additive, no migration.** Existing workflow rows have no `defaults` and resolve exactly as today. `saveWorkflow` (`workflows.mjs:157-189`) sanitizes the new field the same loud-and-lenient way as topology: drop malformed sub-fields with a `console.warn`, throw only on setter misuse.
- The "topology only" contract comment (`workflows.mjs:5`) is updated: templates are **topology + per-node defaults**; per-project overrides remain in run config.
- Validation of `defaults.model`/`effort` mirrors run-config write validation (the `setStep`-style checks; note `setNodeModel` currently skips validation — `config.mjs:601` vs `:382` — this design does not fix that pre-existing gap but must not widen it: workflow `defaults` are validated at save time).
- The **Default workflow** (`wf_default`) gets its `defaults` from the agent registry exactly as today — i.e. it needs no stored `defaults`; layer 3 covers it. Built-in behavior is unchanged.
- Plugin-shipped workflow templates may include `defaults`; the same sanitizer applies on import.

### 4.5 Run config becomes deltas (prune-on-save)

- Semantically, run-config values are already overrides; this design makes them **sparse**. On every save from the accordion, any value equal to the resolved default (layers 2–4) is pruned instead of stored.
- No data rewrite/migration: existing dense configs remain valid (layer 1 simply matches layer 2-4 resolution and the row shows unmodified — pruning happens lazily on next save).
- **Reset to workflow defaults** = delete the run-config node entries (and feedback overrides) for the selected workflow in the selected project.
- Workspace target keeps its existing semantics: per-agent models resolve per project from each project's own config (`index.html:174`); layers 2–4 are project-independent, layer 1 is per-project.

### 4.6 Advanced disclosure

Collapsed by default; contains, unchanged in behavior:

- Title (optional; Claude titles the run when empty),
- Source branch (defaults to the project's current branch) + workspace per-member variants,
- Feature branch (empty → Claude proposes a name),
- Optional extra files,
- Guardrails (default Permissive),
- Mock mode (default off).

The disclosure auto-expands when any contained field is non-default at render time (e.g. restored state), so nothing active is ever hidden. Open/closed state is otherwise ephemeral.

### 4.7 Render-path consolidation

- Delete `#wf-default-stages` (static rows, `index.html:269-329`) and the `data-role`-driven code that feeds it.
- The Default workflow is resolved to its node list and rendered through `buildNodeConfigRows` → the (new) accordion renderer, same as saved workflows. `renderModelEffortPair` remains the single place dropdown contents + effort filtering live.
- Legacy per-role run-config storage (`steps[role]`, `config.mjs setStep:382`) keeps working as layer-1 input for the Default workflow's rows; no storage migration.

### 4.8 Workflow editor integration

The workflow editor gains the same accordion component (read/write against `defaults` instead of run config) so authors bake tuning into the workflow at creation time. Same validation, same captions, no separate implementation. This is what makes "workflows ship with sensible defaults" real for export/share/plugins.

## 5. Testing

House style: jsdom unit tests against the pure helpers exposed on `window.__np` (`app.js:2524`).

- **New pure helpers**: effective-value resolution (layers 1–4, per setting), modified-detection, prune-on-save, header summary ("all defaults" / "N modified"). Each gets direct unit coverage.
- `buildNodeConfigRows` grows a `defaults` overlay test matrix (workflow default present/absent × override present/absent × registry default).
- **Updated**: `test/newpipeline-config.test.mjs` (accordion rows replace flat rows), `test/config-ui.test.mjs` (static stage rows gone), `test/ui-shell.test.mjs` / `test/ui-boot.test.mjs` (DOM structure), feedback-row tests (now inside the accordion).
- **Schema**: `saveWorkflow` sanitization of `defaults` (malformed sub-fields dropped + warned; valid ones round-trip), plugin-template import path.
- Manual/UI check: keyboard operability of the accordion (rows are buttons with `aria-expanded`), Advanced auto-expand on non-default restore.

## 6. Implementation order

Two independently shippable PRs, in this order:

1. **PR 1 — UI restructure (no schema change).** Accordion + Advanced disclosure + render-path consolidation. Resolution layers are 1 → 3 → 4 (no workflow defaults yet). Biggest height win, zero storage risk.
2. **PR 2 — Workflow defaults + deltas.** `defaults` field + save-time validation, resolution layer 2, prune-on-save, Reset button, workflow-editor accordion.

**Coordination flag:** PR #359 (graph v2) rewrites large parts of `ui/public/app.js`. Decide merge order before PR 1 lands, or the second one in pays a painful rebase.

## 7. Decision log

- **D1 — Inline accordion** over slide-over panel, graph-popover, and two-step wizard. Chosen: smallest architectural change, page stays one column, biggest height reduction per effort; wizard rejected for taxing the high-frequency path; graph-popover deferred behind graph v2 (§8).
- **D2 — Workflow-level per-node defaults: yes.** Run config becomes sparse overrides; shared workflows carry tuning; Reset has a defined target. Additive schema, no migration.
- **D3 — Prune-on-save** rather than a one-shot migration of existing dense run configs. Convergence is lazy and safe; dense legacy values stay valid.
- **D4 — Feedback loops live as one accordion row**, not a separate section — same disclosure logic, default 3 cycles stays invisible until someone cares.
- **D5 — Advanced disclosure auto-expands when non-default**, so collapsing never hides active state.
- **D6 — Default workflow needs no stored `defaults`**; the agent registry (layer 3) already encodes its sensible defaults. Avoids double-maintaining built-ins.
- **D7 — Two PRs**, UI-first: the presentation win must not wait on schema plumbing, and each PR stays reviewable.

## 8. Out of scope / future

- **Graph-popover editing** on New pipeline (click a node in a mini-graph to tune it) — revisit after graph v2 (PR #359) lands; the accordion's resolution helpers are reusable as-is.
- **Slide-over panel** as a home for future per-run options if the accordion outgrows one column.
- **Named tuning presets** ("cheap run" / "thorough run") applied across a workflow — builds naturally on `defaults` + deltas, not designed here.
- Fixing `setNodeModel`'s missing write-time validation (`config.mjs:601`) — pre-existing, tracked by the configurable-models design's §2 consistency goal.
