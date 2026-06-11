# Declarative Pipeline Flow (`worca.flow`)

The pipeline's flow — stage order and loop topology — is data, not hardcoded
control flow (W-070). The runner walks a compiled `FlowSpec`; the builtin
9-stage behavior ships as the default flow, and `worca.flow` (settings.json or
template `config`) overrides the topology.

With no `worca.flow` configured, behavior is byte-identical to the legacy
hardcoded pipeline — the compiled default is parity-tested against the old
literals in `tests/test_flow.py`.

## The flow document

```json
{
  "worca": {
    "flow": {
      "version": 1,
      "stages": [
        { "name": "preflight" },
        { "name": "plan", "agent": "planner", "schema": "plan.json",
          "prompt_block": "plan" },
        { "name": "plan_review", "agent": "plan_reviewer",
          "enabled": false,
          "on": { "plan_review_revise": { "goto": "plan", "loop": "plan_review" } } },
        { "name": "coordinate", "agent": "coordinator" },
        { "name": "implement", "agent": "implementer",
          "on": { "next_bead": { "goto": "implement", "loop": "bead_iteration" } } },
        { "name": "test", "agent": "tester",
          "on": { "test_failure": { "goto": "implement", "loop": "implement_test" } } },
        { "name": "review", "agent": "reviewer",
          "on": { "review_changes": { "goto": "implement", "loop": "pr_changes" },
                  "restart_planning": { "goto": "plan", "loop": "restart_planning" } } },
        { "name": "pr", "agent": "guardian" },
        { "name": "learn", "agent": "learner", "enabled": false, "post": true }
      ]
    }
  }
}
```

The document above *is* the builtin default — omitting `worca.flow` entirely
gives you exactly this.

## Field reference

| Field | Required | Default | Meaning |
|---|---|---|---|
| `name` | yes | — | Stage key. Becomes the `status.json` `stages.*` key verbatim. Builtin names (`preflight`, `plan`, `plan_review`, `coordinate`, `implement`, `test`, `review`, `pr`, `learn`) keep their bespoke behavior; any other name is a **custom stage** (W-071, see below) and must match `^[a-z][a-z0-9_]*$`. |
| `agent` | no | builtin map / stage name | Agent template name (custom stages default to the stage name). Resolution order: `{run_dir}/agents/` (rendered) → `.claude/agents/` → `.claude/worca/agents/core/`. Custom agent names must match `^[a-z][a-z0-9_]*$` (hyphens break role extraction). |
| `schema` | no | builtin map / `<name>.json` | Structured-output schema file. Resolution order: `.claude/schemas/` → `.claude/worca/schemas/`. |
| `prompt_block` | no | builtin map / stage name | Stage block `.block.md` name, resolved through the usual three-tier overlay chain (project tier `.claude/agents/<block>.block.md` works for new names). |
| `enabled` | no | per-stage default | Same semantics as `worca.stages.<name>.enabled` (which still merges in when the flow entry doesn't set it). `plan_review` and `learn` default disabled. |
| `on` | no | `{}` | Map of outcome trigger → transition. No matching trigger means "advance to the next stage in the list". |
| `on.<t>.goto` | yes (in `on`) | — | Target stage `name`. Must be an enabled, non-post stage. |
| `on.<t>.loop` | no | — | Loop counter key; limit from `worca.loops.<key>` (default 5). Required for backward/self jumps — an unbounded cycle is rejected at launch. |
| `post` | no | `false` (`true` for `learn`) | Runs after the terminal transition, outside the main walk. |

### Outcome triggers

Triggers are produced by stage outcomes, exactly as before:

| Trigger | Produced by | Default target |
|---|---|---|
| `plan_review_revise` | plan_review requests revision (review mode) | `plan` |
| `next_bead` | implement finishes a bead with more queued | `implement` (self-loop) |
| `test_failure` | tester reports failures | `implement` |
| `review_changes` | reviewer requests changes (critical/major) | `implement` |
| `restart_planning` | reviewer requests replanning | `plan` |

Removing a transition from a stage's `on:` map reproduces the legacy
"target stage is disabled — skipping loop" behavior: the trigger fires, the
runner logs it, and the pipeline advances instead of looping.

### Loop limits

`on.<t>.loop` names the counter in `status.loop_counters`; the limit comes
from `worca.loops.<key>` (default 5). One exception: `bead_iteration`'s cap is
dynamic — it depends on the number of beads the coordinator created — so it is
provided at runtime and `worca.loops.bead_iteration` is ignored.

## Validation (fail-loud at launch)

A user-supplied `worca.flow` is validated by
`worca.orchestrator.flow.load_flow` before the pipeline starts. Launch fails
with a `FlowError` on:

- bad `version` (must be `1`), unknown keys anywhere (typos fail, not silently no-op)
- duplicate stage names, malformed custom stage/agent names, custom `post` stages
- `goto` targets that don't exist, are disabled, or are `post` stages
- backward/self `goto` without a `loop` key (unbounded cycle)
- `loop` keys colliding with the reserved `<stage>_iteration` counters
- missing agent template (searched in `.claude/agents/` and
  `.claude/worca/agents/core/`) or schema file (searched in `.claude/schemas/`
  and `.claude/worca/schemas/`) for any enabled stage
- a custom stage declaring `on:` transitions whose schema has no `outcome`
  string enum, or whose enum doesn't cover every declared trigger

The compiled default flow skips file-existence checks — it isn't user input.

## Flow fingerprint and resume

At launch, the runner stores `flow_fingerprint` (sha256 of the canonicalized
compiled flow) in `status.json`. On resume of a **custom-flow** run, the
fingerprint is recomputed and compared: a mismatch fails loudly — restore the
previous flow or start a new run. This prevents a paused run from silently
resuming under a different topology than the one that produced its state.

Default-flow runs keep the legacy resume semantics: stage order is re-derived
from current settings, and the fingerprint is updated rather than enforced —
so toggling `worca.stages.*` while paused behaves exactly as it always has.
Runs from older worca versions have no fingerprint; it is backfilled on
resume, never rejected. Loop limits (`worca.loops`) are tuning, not topology —
changing them never blocks a resume.

## Configuration precedence

`worca.flow` is a **template-driven key** (like `worca.stages` and
`worca.loops`): when a template is in play at launch, the project's
`worca.flow` is stripped from the merge base and the template owns the key
outright. Precedence: template `config.flow` → project `worca.flow` → builtin
default. `worca.stages.*` remains supported as shorthand that merges *into*
whichever flow is selected. See
[`configuration-precedence.md`](./configuration-precedence.md).

## Custom stages (W-071)

A stage name outside the builtin set runs under the **generic stage
executor**: render prompt → dispatch agent → validate structured output →
persist iteration → emit `STAGE_*` events → map the output's `outcome` field
to a flow trigger. Adding a stage means dropping three files and one flow
entry — no Python.

```
.claude/
  agents/
    docs_auditor.md        # the agent definition (no core base needed)
    docs_audit.block.md    # optional: the -p user-message block
  schemas/
    docs_audit.json        # structured-output schema
  settings.json            # worca.flow gains the stage entry
```

```json
{ "name": "docs_audit", "agent": "docs_auditor", "schema": "docs_audit.json",
  "on": { "needs_rework": { "goto": "implement", "loop": "docs_rework" } } }
```

**Outcome contract** (convention over configuration). The schema should
declare `outcome` as a string enum; the generic executor maps it as:

| `outcome` | Behavior |
|---|---|
| missing / `"success"` | advance to the next stage |
| declared in the stage's `on:` map | the outcome IS the trigger — jump per the flow (loop-keyed transitions consume their `worca.loops` budget; an exhausted loop advances instead) |
| `"reject"` (undeclared) | stage failure — the run fails through the existing failure path |
| anything else | advance with a warning (launch validation cross-checks the enum against declared triggers, so this only happens for enum-less schemas) |

**Placeholders** work in both the agent `.md` and the block: `{{title}}`,
`{{plan_file}}`, `{{run_id}}`, `{{branch}}`, and the rest of the prompt-builder
context resolve exactly as for builtin agents.

**Governance**: a custom agent not named in
`worca.governance.dispatch.<section>.per_agent_allow` resolves to the lockdown
sentinel (`["none"]`) instead of `_defaults` — it gets **no tools, skills, or
subagents** until explicitly granted. The launch log warns per missing
section. The guardian-only `git commit` guard is unchanged: custom agents can
never commit; PR/commit duties stay on the builtin `pr` stage. See
[`governance.md`](./governance.md#custom-agents-w-071).

**Scope notes**: custom stages get the ambient prompt context as-is (declared
inputs/outputs are W-072); custom `post` stages are not supported; custom
*handlers* (user Python) are deliberately out of scope.

## Scope

- W-070: topology — reorder, disable, and rewire the builtin stages.
- W-071: user-defined stages/agents via the generic stage executor (above).
- Declared inter-stage context inputs/outputs: **W-072**.
- No per-run `--flow` CLI override; no UI flow editor.
