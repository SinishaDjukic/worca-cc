# Pipeline Composability

How far the pipeline can be recomposed — and where the hard boundaries are —
after the pluggable-pipeline trilogy: declarative flow (W-070), the generic
stage executor (W-071), and the declared inter-stage context contract
(W-072). This is the conceptual companion to the [`flow.md`](./flow.md)
reference; read that for exact field syntax and validation rules.

The pipeline is three independent contracts. Each is declarative, validated
fail-loud at launch, and composable within explicit limits:

| Contract | What it governs | Declared in |
|---|---|---|
| **Topology** (W-070) | What runs, in what order, with which loops | `worca.flow.stages` order + `on:` transitions |
| **Execution** (W-071) | What a stage *is* | Stage name → registered handler, or `GenericHandler` for custom names |
| **Data** (W-072) | What flows between stages | `outputs` declarations + `{{stages.<s>.<o>}}` consumption, linted at launch |

## Topology — freely rearrangeable, with bounded cycles

Stages can be reordered, disabled, omitted, or inserted anywhere. Control
flow is the linear list plus outcome-driven jumps. Restrictions (all launch
errors, never mid-run):

- **Backward/self jumps require a `loop` key** — unbounded cycles are
  rejected. Limits come from `worca.loops.<key>` (default 5);
  `bead_iteration`'s cap is runtime-derived from the created bead count.
- **`goto` must target an enabled, non-post stage.** Post stages run after
  the terminal transition and cannot be jump targets; custom stages cannot
  be `post`.
- Duplicate names are rejected; custom stage/agent names must match
  `^[a-z][a-z0-9_]*$`.
- Custom flows are **fingerprinted** into `status.json` — a paused run never
  silently resumes under a changed topology.

## Execution — builtin semantics preserved, custom stages plug in

- **Builtin stage names keep their bespoke handlers.** `implement` always
  means "bead fan-out", `pr` always means "guardian creates the PR". You
  compose *around* builtin stages; you don't redefine what they do.
- **Any other name is a generic stage**: an agent `.md` + a schema `.json` +
  a flow entry, zero Python. The schema's `outcome` enum *is* the stage's
  trigger vocabulary — `success` advances, `reject` fails, declared outcomes
  jump per the `on:` map. Launch validation cross-checks the enum against
  the declared triggers.
- **Builtin triggers fire on fixed conditions.** You can rewire where
  `test_failure` or `review_changes` *go* (or remove the transition →
  "log and advance"), but not *when* they fire — that logic lives in the
  builtin handlers.
- Custom agents start **dispatch-locked-down** (no tools, skills, or
  subagents) until granted via `per_agent_allow`; only the guardian may
  `git commit`, ever. See [`governance.md`](./governance.md).

## Data — declared outputs, linted consumption

Each stage declares `outputs` (name → JSON pointer into its validated schema
result); the executor publishes them as `stages.<stage>.<output>` in the
prompt context. Any later stage's templates consume them:

```markdown
{{stages.qa.failures}}                      ← value substitution
{{#if stages.qa.failures}}...{{/if}}        ← conditional section
{{stages.qa.summary|no QA summary yet}}     ← with a default
```

The boundaries:

1. **Declared, not ambient.** Only fields named in the producer's `outputs`
   map (or, for builtins, the alias-registered transforms) are reachable.
   `{{stages.plan.some_random_field}}` is not silently empty — it is a
   launch-time lint error, checked against the *resolved* template set
   (project/template overlays included).
2. **Ordering is checked for bare value references.** The producer must run
   earlier or be loop-reachable (`implement` may consume
   `{{stages.test.failures}}` because `test_failure` loops back).
   Conditional / `|default` references to later, disabled, or
   omitted-builtin producers are accepted — those sections legitimately
   collapse.
3. **Rendering is `str(value)`.** Scalar picks render cleanly; lists/dicts
   render as their Python repr. For prose-quality prompts, pick scalar
   fields (`/summary`) or rely on the handler-side formatted keys the
   builtin templates use (`test_failures_formatted`, …).

Legacy flat keys (`plan_approach`, `test_failures`, …) keep resolving via
the bidirectional alias table; see
[`flow.md` § Declared context contract](./flow.md#declared-context-contract-w-072)
for the full table and the deprecation policy.

## Builtin stages: optionality and replaceability

Two different questions per stage: *can you drop it?* and *could a custom
generic stage do its job?*

| Stage | Completely optional? | Reimplementable as custom stage? |
|---|---|---|
| `preflight` | ✅ yes | ⚠️ partially |
| `plan` | ⚠️ yes, with `--plan` | ⚠️ mostly |
| `plan_review` | ✅ yes (default off) | ✅ yes — best candidate |
| `coordinate` | ✅ yes | ⚠️ only together with its consumer |
| `implement` | ✅ yes (non-code flows) | ✅ mostly |
| `test` | ✅ yes | ✅ yes — best candidate |
| `review` | ✅ yes | ✅ yes — best candidate |
| `pr` | ✅ yes (work stays uncommitted) | ❌ **never** |
| `learn` | ✅ yes (default off) | ❌ no (post slot is builtin-only) |

**Fully optional, cleanly replaceable — `plan_review`, `test`, `review`.**
These are "judge" stages: agent + schema + outcome-driven loop, which is
exactly the GenericHandler shape. A custom `qa` stage with
`outcome: {success, test_failure}` and a `test_failure → implement`
transition replicates the test gate. What you lose is the bespoke trimmings:
`TEST_SUITE_*` / `REVIEW_*` events, severity filtering, history capping, and
plan_review's edit mode (W-061).

**Optional with caveats:**

- **`plan`** — droppable only with a pre-made plan (`--plan`), because the
  plan-gate hook blocks source writes until the plan file exists. A custom
  "designer" stage *can* stand in: grant it Write and have it write to
  `$WORCA_PLAN_FILE`. You lose plan materialization, numbered revisions, and
  the `plan_approved` milestone wiring.
- **`coordinate`** — drop it and `implement` degrades gracefully to a single
  one-shot pass (no beads → no fan-out). Replacing it is the awkward one:
  builtin `implement` only picks up real `bd` beads labeled `run:<id>`, so a
  custom decomposer must either create those beads (needs `bd` tool grants)
  or you replace *both* sides — custom decomposer publishing a task-list
  output plus custom executor stages consuming it.
- **`implement`** — optional for audit/report-style flows (test/review
  failures then degrade to logged warnings). A custom stage with
  Write/Edit/Bash grants can implement code single-pass; you lose the
  per-bead loop, fix-mode prompt threading, and design-note accumulation.
- **`preflight`** — freely disableable (`--skip-preflight` exists). A custom
  checker stage can do agent-based validation but cannot reach the
  graphify/CRG attach points (those wire run-level state in the handler).

**Not replaceable, by design:**

- **`pr`** — the hard governance boundary. Only the `guardian` agent may
  `git commit` (pre_tool_use hook on `WORCA_AGENT`), and custom agents can
  never receive that right. Any flow that wants commits/PRs must include the
  builtin `pr` stage (or use `worca.stages.pr.defer` and promote from the
  UI). Omit it and the run ends with uncommitted work on the branch.
- **`learn`** — optional, but the *post-pipeline* execution slot is
  builtin-only: custom stages can't be `post`, and post stages can't be jump
  targets. Nearest substitute: a custom retrospective stage before `pr`,
  which runs in the main walk (and therefore not after terminal failures —
  half of learn's value).

One-line summary: **judge stages swap freely, producer stages swap with
their consumers, and the commit boundary doesn't swap at all.**

## Worked example: feeding a builtin stage from a custom one

A custom `qa` stage replacing the builtin tester, whose findings reach the
builtin implementer's retry prompt:

```json
{ "name": "qa", "agent": "qa_agent", "schema": "qa.json",
  "outputs": { "failures": "/failures", "summary": "/summary" },
  "on": { "test_failure": { "goto": "implement", "loop": "implement_test" } } }
```

Project overlay `.claude/agents/implement.block.md` (append mode):

```markdown
{{#if stages.qa.failures}}
## QA findings to address

{{stages.qa.summary}}
{{/if}}
```

No Python anywhere, and the consumption lint verifies the wiring at launch —
if `qa` stops declaring `summary`, the next launch fails with the exact
template and key named.

## What is generic vs. what stays bespoke

**Fully generic — the runner loop.** Since W-071 the loop has no per-stage
logic: it walks the `FlowSpec` by stage key and runs the same sequence for
every stage — resolve handler → context/prompt build → dispatch →
auto-publish declared outputs → `post_dispatch` → apply the returned
decision. Builtin and custom stages are indistinguishable *to the loop*.

**Fully declarative — the data picks.** All builtin schema-pick publication
flows through `DEFAULT_STAGE_OUTPUTS` and the same auto-publish path custom
stages use; the old hand-rolled context writes are gone.

**Deliberately bespoke — handler code and prompt formatting.** Builtin
stages keep `StageHandler` subclasses carrying their semantics: plan-file
materialization and milestones, plan_review's edit-mode reconciliation,
coordinate's bead creation/labeling, implement's bead fan-out, test/review
severity gating and event emission, the PR approval gate and post-condition
verification. Likewise, builtin templates mostly consume *formatted* keys
(`test_failures_formatted`, `implementation_summary`, …) computed
consumer-side for prose quality — registered in `BUILDER_STAGE_KEYS` for the
lint. The loop-driving transforms (filtered issue lists, accumulated file
sets) are handler-published but land in the same `stages.*` namespace via
the alias table, so they are consumable and lintable exactly like declared
outputs.

Replacing the bespoke layer with declarations — placeholder expression
languages, custom Python handlers — is explicitly out of scope (see the
W-070/071/072 plans under [`plans/`](./plans/)).
