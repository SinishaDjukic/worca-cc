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
| `name` | yes | — | Stage key. Becomes the `status.json` `stages.*` key verbatim. W-070 accepts builtin stage names only (`preflight`, `plan`, `plan_review`, `coordinate`, `implement`, `test`, `review`, `pr`, `learn`); custom stages arrive with W-071. |
| `agent` | no | builtin map lookup | Agent template name. |
| `schema` | no | builtin map lookup | Structured-output schema file under `.claude/worca/schemas/`. |
| `prompt_block` | no | builtin map lookup | Stage block `.block.md` name. |
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
- duplicate stage names, non-builtin stage names (W-071 scope)
- `goto` targets that don't exist, are disabled, or are `post` stages
- backward/self `goto` without a `loop` key (unbounded cycle)
- `loop` keys colliding with the reserved `<stage>_iteration` counters
- missing agent template (`.claude/worca/agents/core/<agent>.md`) or schema
  file (`.claude/worca/schemas/<schema>`) for any enabled stage

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

## Scope (W-070)

- Topology only: reorder, disable, and rewire the builtin stages.
- User-defined stages/agents: **W-071** (generic stage executor).
- Declared inter-stage context inputs/outputs: **W-072**.
- No per-run `--flow` CLI override; no UI flow editor.
