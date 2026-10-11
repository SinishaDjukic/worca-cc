# Spec Builder (Beta)

Spec Builder is a third task source on **New run**, next to Prompt and Markdown. A short wizard
collects the shape of the change and shows what the run will likely cost. Ask Worca then writes a
Worca-ready spec grounded in the project, and hands it back as a card. **Use this spec** turns it into
an ordinary Markdown run.

## Turn it on

Spec Builder is behind the `specBuilder` [feature flag](feature-flags.md) (stage `beta`, off by
default). Turn it on in **Settings › Experimental**, or start the server with
`WORCA_FLAGS=specBuilder`. While the flag is off:

- the source switch has no Spec Builder button, byte for byte what it was before;
- the `/api/spec-builder/*` routes answer `404 { error: 'not found' }`;
- Ask Worca does not list the `propose_spec` tool.

The source switch, and so Spec Builder, shows from the **Advanced** interface mode up.

## The wizard

| Step | What it asks |
|---|---|
| 1. What | One line of goal, and the kind: feature, fix, refactor, infra or docs. |
| 2. Roles | Who shapes the spec (below). Product is always on. |
| 3. Scope | Size (small, medium, large), the areas of the code (suggested from the project's tracked paths that match the goal), an optional feature flag and an optional UI level. |
| 4. Estimate | The stages the run will take and what they will likely cost and take. |

**Generate spec** opens a new Ask Worca chat pinned to the project. Its first message carries the
answers, the section list and a ready skeleton. Ask reads the project (it opens a worktree and uses
Read, Grep and Glob under it), asks at most 3 questions, and finishes with a spec card.

The wizard keeps its answers for the life of the page, across source switches. **Start over** clears
them.

## Roles

| Role | Sections it adds | Effect on the run |
|---|---|---|
| Product (always on) | Problem and goal, Out of scope | — |
| Architect | Decisions, Code layout | — |
| QA | Testing (written in full) | — |
| UX | Screens and states | adds the web test stages (`manualTestsChecklist`, `manualWebUiTesting`) |
| Security | Threats | adds the `risky` signal, so the run refines the plan first |
| DevOps and infrastructure | Infrastructure and CI/CD | — |
| Release | Rollout and rollback | — |

Every spec also has Testing (a short default without QA), Out of scope and Open questions. The
sections keep this order and are numbered from 1. The list lives in
[`src/shared/spec-builder/roles.mjs`](../src/shared/spec-builder/roles.mjs).

## The front-matter

A Spec Builder spec starts with a `worca:` block:

```markdown
---
worca:
  kind: feature            # feature | fix | refactor | infra | docs
  size: medium             # small | medium | large
  signals: [risky]         # optional
  roles: [product, architect, qa, ux]
  flag: { key: customDashboard, stage: beta }   # optional
  levels: advanced         # optional: simple | advanced | expert | all
  generatedBy: spec-builder@1
---
# Title
```

Unknown keys are ignored. A bad value makes the block invalid, and an invalid block is ignored by
Auto. A spec without the block is unaffected by everything below.

## How Auto reads it

The Auto classifier still decides the workflow. A guard then corrects what contradicts a valid block:

- `size` always follows the block, and `risky` is kept when the block has it;
- when every section the roles need is present, the spec is a plan of record: the task kind becomes
  `plan-complete-detailed`. If the model's stages plan again (clarify, planner or decomposer), skip
  Refine on large or risky work, or skip the web tests UX asked for, the stages become the recipe's:

| Size or risk | UX | Stages |
|---|---|---|
| small or medium | no | implement, review |
| small or medium | yes | implement, review, web tests |
| large or risky | no | refine, implement, review |
| large or risky | yes | refine, implement, review, web tests |

The replaced stages keep the classifier's model picks. The guard:

- is off on a revise round (when you send feedback on the proposal), so your feedback wins;
- is skipped, with a `SPEC_GUARD_SKIPPED` warning, when the guarded shape would not run (for
  example, a required model missing);
- does not run when the classifier fails outright: that run falls back to the Default workflow, as
  before.

## The estimate

The estimate is computed, never asked of a model. The stages are the recipe above. Each stage is
priced from this machine's finished runs of the last 90 days (the median as the low end, the 90th
percentile times the possible review loops as the high end). A stage with fewer than 3 past samples is
priced from list prices and a typical token count, and the estimate says **Rough estimate**. Steps
that report no cost still count for time, so their cost can read `$0.00`.

## The spec card

- **Use this spec** fills the Markdown pane of New run with the spec and switches the workflow
  from Default to Auto. A saved workflow you picked stays. Start runs it like any Markdown run.
- **Save to plans/** writes `plans/<slug-of-the-title>-design.md` in the project (or the path Ask
  suggested). It never overwrites: an existing name offers the next free one (`-v2` … `-v99`). Paths
  outside `plans/`, protected names and a `plans/` that resolves outside the project are refused.

Both buttons can be used any number of times.

## Limits in this version

- The card does not remember that it was saved: a reload shows **Save to plans/** again.
- One project per spec; workspaces are not supported.
- Ask's questions are ordinary chat replies; there is no question form.
- The grounding rule names Claude's Read, Grep and Glob. A Codex chat has `read_file`, `grep` and
  `glob` instead and may need to map the names itself.
