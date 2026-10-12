# Spec Builder (Beta)

Spec Builder is a third task source on **New run**, next to Prompt and Markdown. One pane takes your
idea (or rough notes), drafts a Worca-ready spec grounded in the project right there on the page, and
checks its shape. **Use as task** turns it into an ordinary Markdown run.

## Turn it on

Spec Builder is behind the `specBuilder` [feature flag](feature-flags.md) (stage `experimental`, off by
default). Turn it on in **Settings › Experimental**, or start the server with
`WORCA_FLAGS=specBuilder`. While the flag is off:

- the source switch has no Spec Builder button, byte for byte what it was before;
- the `/api/spec-builder/*` routes answer `404 { error: 'not found' }`;
- Ask Worca does not list the `propose_spec` tool.

The source switch, and so Spec Builder, shows from the **Advanced** interface mode up.

## The pane

One page, no steps. The pane holds your idea, the roles, the change, and the output below them.

- **Your idea** is the one input field. Type a line, paste notes, or load a `.md` file.
- **Draft or Reshape.** The main button reads **Draft spec** for a plain idea and **✦ Reshape into
  spec** when the input already looks like a document: a heading, a list, more than 25 lines, a
  loaded `.md` file, or a task picked from a task source. Reshape keeps your content and restructures
  it into the spec sections; Draft writes it from the idea.
- **Suggested roles.** Product is always on. A utility-model call suggests the other roles from the
  idea; with no model, or on mock, the static defaults Product, Architect and QA are shown. You can
  switch any role on or off.
- **Change** sets the kind (feature, fix, refactor, infra, docs), the size (small, medium, large) and
  an optional feature flag.

The button opens an Ask Worca chat pinned to the project and drafts **inline**: an activity line shows
what Ask is reading, **Stop** ends the turn, and **Continue in Ask Worca** opens the same chat in the
Ask panel. Ask reads the project (it opens a worktree and uses Read, Grep and Glob under it).

### Questions

Ask asks at most 3 questions. Each shows its options plus **Other…**, and **Why it's asking** says
what in the repo prompted it. Answer in the pane and send the answers, or type in the chat. In the Ask
panel the questions show as a read-only `spec-questions` card: they are answered in the pane or by
typing in chat.

### The output

When the draft is ready the pane shows it as the output:

- the spec, **rendered** or as **markdown**, with a tag on each section for the role that owns it;
- **grounded marks** on the repo paths it names: ✓ exists, or not found;
- a summary line with the [estimate](#the-estimate) and the [shape checks](#shape-checks);
- **Edit input** (back to the idea), **Continue in Ask Worca**, **Save to plans/**, and **Use as
  task**. When a shape check fails the button reads **Use anyway**.

**Try again** reruns a draft that failed. If you delete the chat the draft came from, the pane keeps
the output and offers Edit input; Continue in Ask Worca is gone.

The pane keeps its drafts per project in `localStorage['worca-cc.specBuilder.drafts']`, so after a
reload (or a visit to another page) reopening Spec Builder **re-attaches** to the output, or to a
draft still running. **Start over** clears it.

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
  generatedBy: spec-builder@2
  mode: draft              # draft | reshape
  shapeWaived:             # optional, see Shape checks
    - { id: testable, reason: "Manual check only" }
---
# Title
```

`generatedBy: spec-builder@2` marks a spec from this pane, `mode` says whether it was drafted or
reshaped, and `shapeWaived` is a block list of the checks the user chose to ignore, each with a
one-line reason. Unknown keys are ignored. A bad value makes the block invalid, and an invalid block is ignored by
Auto. A spec without the block is unaffected by everything below.

## Shape checks

Every spec is checked against eight rules, in this order:

| id | check |
|---|---|
| sections | Every section its roles need is present |
| testable | Success criteria must be testable |
| decisions | Every decision states one choice |
| paths | Every repo path exists or is marked (new) |
| tests | Testing covers the new code |
| placeholders | No placeholders left |
| checklists | Every role ends with a checklist (never waivable) |
| grounded | Decisions are grounded in the repo |

The check runs inside Ask's MCP child. A spec that fails the shape is rejected up to 2 times per turn,
with the failures as the reason, so the model fixes it; after that it is let through with the failures
on the card. The app itself never rejects a spec on shape. The summary shows "Shape ✓ 8 of 8" or "7 of
8" with each failure listed, and **Fix** (or **Fix all**) asks Ask to repair them.

A user can **Ignore for this spec** on a failed check with a one-line reason. That writes
`worca.shapeWaived` into the front-matter. `checklists` can't be waived. A Fix keeps the waivers whose
check still fails and drops the rest.

Each role section group ends with a `### Checklist` whose items have ids `R-<role>-<n>` (prefixes
`arch`, `qa`, `ux`, `sec`, `ops`, `rel`; Product has none), 1 to 8 items per role.

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

The estimate is computed, never asked of a model. It shows on the output. The stages are the recipe above. Each stage is
priced from this machine's finished runs of the last 90 days (the median as the low end, the 90th
percentile times the possible review loops as the high end). A stage with fewer than 3 past samples is
priced from list prices and a typical token count, and the estimate says **Rough estimate**. Steps
that report no cost still count for time, so their cost can read `$0.00`.

## The spec card

In the Ask panel a spec shows as a card with the same buttons. The pane is where it is built; the card
is how it reaches you when you continue in Ask Worca.

- **Use as task** (or **Use anyway** when a shape check fails) fills the Markdown pane of New run
  with the spec and switches the workflow from Default to Auto. A saved workflow you picked stays.
  Start runs it like any Markdown run.
- **Save to plans/** writes `plans/<slug-of-the-title>-design.md` in the project (or the path Ask
  suggested). It never overwrites: an existing name offers the next free one (`-v2` … `-v99`). Paths
  outside `plans/`, protected names and a `plans/` that resolves outside the project are refused.

Both buttons can be used any number of times.

### API

The `areas` and `estimate` endpoints of the earlier wizard are gone. `POST
/api/spec-builder/suggest` answers the suggested roles. `POST /api/spec-builder/prompt` takes
`{projectDir, idea, mode, roles, kind, size, flag}` and answers `{text, title, projectKey,
projectName}`. All of them answer `404` while the flag is off.

## Limits in this version

- The card does not remember that it was saved: a reload shows **Save to plans/** again.
- One project per spec; workspaces are not supported.
- The run-side metrics are not collected yet: time to Use, edit distance between the draft and what is
  used, shape on the first draft, and review cycles.
- Role checklists are written into the spec, but the reviewer and PR side that reads them ships in
  run 2.
- The grounding rule names Claude's Read, Grep and Glob. A Codex chat has `read_file`, `grep` and
  `glob` instead and may need to map the names itself.
