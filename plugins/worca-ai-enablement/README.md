# worca-ai-enablement

A worca-cc plugin, bundled in the builtin marketplace, that runs an AI-analysis and
AI-enablement pipeline (ported from maestro's onboarding line) as **data only**: seven agents, one shared
rubric skill and two pipeline templates. Nothing in it runs inside worca except the
agents' own `claude -p` sessions; every result is an ordinary run artifact that worca's
existing cards already render.

- **AI analysis** scores a repository's AI-readiness today, shows the scorecard and asks
  you which gaps to fix. It never writes into the repository.
- **AI enablement** does the same and, when you approve, generates `CLAUDE.md`, project
  skills and agents, rules, multi-tool files and a test tier on a branch, re-scores the
  result, test-drives it, and leaves a diff you can ship as a pull request.

Requires worca-cc 1.8.0 or newer (plugin API 4: typed ports, v2 graphs, ask forms).

## Install

It ships in the builtin **Worca CC Official** marketplace, so install it by name (or from the
Plugins view's Available list):

```bash
worca plugin install worca-ai-enablement
```

To develop it from a clone of worca-cc, link the directory instead:

```bash
worca plugin link ./plugins/worca-ai-enablement
```

`worca plugin list` then shows `7 agents, 1 skill, 2 workflows`, and the two templates
appear in the New pipeline workflow picker and in the Composer under the **enablement**
domain. After editing `workflows/*.json` in a linked checkout, run
`worca plugin reimport worca-ai-enablement`.

## Which template to run

| You want | Template | Writes into the repo |
|---|---|---|
| A readiness score and a list of gaps, nothing else | `AI analysis` | no |
| The score, then the fixes generated on a branch | `AI enablement` | yes, on the run's feature branch |

Both start with the same three steps, so an analysis run is exactly the first half of
an enablement run. If you pick **Stop** on the approval card of an enablement run, it
ends like an analysis run: scorecard kept, no file written.

## What each card shows

1. **Scope** (clarifier, form `enable-scope`). The six set-up questions as one form:
   test tier (card select), bundled skills depth, which other AI tools to set up
   (`AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md`; `CLAUDE.md` is always
   produced), the canary toggle, folders to focus on or avoid, and optional skills. Every field has a default, so an unattended run
   (`--yes`, away mode) proceeds with them. Answers land in `enable-clarify.json`.
2. **Analyze** (producer). Maps the repository, with graphify when worca's preflight found
   it installed and a direct read otherwise (`"degraded": true`), detects skill, agent and
   pure-unit candidates, and scores the baseline. Artifacts: `graph-summary.json` (JSON
   viewer), `analysis.md` (markdown viewer) and, with graphify, `graphify-out/GRAPH_REPORT.md`.
   The graph lives in the run folder, never in the repository, so an analysis run leaves the
   working tree untouched.
3. **Assess** (verifier, form `approve-readiness`). Writes the baseline scorecard as
   `readiness-baseline.md` plus `readiness/baseline.json` and `readiness/baseline.html`
   (the self-contained HTML card opens in worca's sandboxed HTML viewer, light and dark),
   then asks for approval: the summary, a dimensions table, a keep/waive review list of
   the gaps, and **Proceed / Stop**. The answer is recorded in `approved-gaps.json`.
   Stop writes `analysis-stopped.md` and routes the run to End.
4. **Generate** (producer, writes code). Closes every kept gap: `CLAUDE.md` with verified
   commands, `.claude/skills/*` for the skill candidates that clear the ROI bar,
   `.claude/agents/*` for the agent candidates, rules, `.claude/settings.json`, the
   requested multi-tool files (each self-sufficient, never a pointer), and bundled skills
   with provenance headers and `VENDORED.md`. Report: `tools-report.json`, including the
   skill and agent coverage tables the evaluator scores against.
5. **Tests** (producer, writes code). Sets up the chosen tier and seeds real, passing tests
   over the analyzer's pure units; runs what it writes.
6. **Evaluate** (verifier). Re-scores with the same rubric, exercises the generated setup
   (commands run, frontmatter parses, seeded tests pass, multi-tool files are
   self-sufficient), and writes `readiness-final-cycleN.md` plus
   `readiness/final-cycleN.json` and `.html` with `Started at B/100, now S/100 (+D)`.
   Critical or major findings go back to Generate through the fix loop (two automatic
   passes, then worca's cycle gate asks you).
7. **Canary** (verifier). Performs one tiny real task using only the generated guidance,
   reverts every change, and reports what was missing (`canary-cycleN.md`). Blocking only
   when a documented command failed or a referenced skill or agent did not exist; one
   automatic fix pass, then the gate asks.

The run's Overview and Diff tabs fill themselves from the files Generate and Tests wrote;
**Ship it** opens the pull request.

## The rubric

`skills/enable-rubric/SKILL.md` is the single source both the assessor and the evaluator
read: nine dimensions (`docs`, `skillsAgents`, `rules`, `tests`, `featureSkillCoverage`,
`realTests`, `vendoring`, `multiTool`, `codeHealth`), their weights, the hard failures
that always block, the soft dimensions that only lower the score, and the three output
contracts (JSON, markdown, HTML). A dimension that does not apply (a repository with no
pure units or no skill candidates) is `null` and is never a blocking issue. Pass
threshold 80.

## Running from the CLI

```bash
worca --project <dir> --prompt "analyze" --workflow wfp_worca-ai-enablement_ai-analysis
worca --project <dir> --prompt "enable" --workflow wfp_worca-ai-enablement_ai-enablement
WORCA_MOCK=1 worca --project <dir> --prompt "smoke" --workflow wfp_worca-ai-enablement_ai-analysis --mock --yes
```

With `--yes`, worca answers the scope form with its defaults and turns off every
non-clarifier question, so the approval card is skipped and the assessor proceeds with all
gaps kept. In mock mode the generic verifier mock blocks on its first cycle, so an offline
run always ends on the Stop arm; that is the expected smoke result, not a defect.

## Verified on 2026-10-06

Checked against worca-cc `dev` at `48fda7c` (1.8.0) with Claude Code 2.1.282, on a
four-file Node repository with one passing test and no `CLAUDE.md`:

- `worca plugin validate --strict` passes (three V18 "may double-fire" warnings remain by
  design: those nodes are gated on the engine's `await` port, which the validator does not
  model); `worca plugin doctor` is clean; both templates import.
- Offline (`--mock --yes`) both templates finish `done`. The generic verifier mock blocks on
  its first cycle, so offline runs end on the Stop arm.
- A real **AI analysis** run (≈ $3.30, three agent steps) rendered the scope form, wrote
  `graph-summary.json`, `analysis.md`, `readiness-baseline.md`, `readiness/baseline.json`
  and a self-contained `readiness/baseline.html` that renders in light and dark with no
  console errors, showed the approval card with a 10-gap review list, and on **Stop** ended
  `done` with `analysis-stopped.md` and an empty Diff tab.
- A real **AI enablement** run on the same repository (≈ $5.10, 7 steps, 11 minutes,
  Proceed with all 8 gaps kept) finished `Ready to ship` with an 8-file diff
  (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/tipjar.mdc`, `.github/copilot-instructions.md`,
  a CI workflow, two test files, `package.json`), `readiness-final-cycle1.md` reading
  `Started at 27/100, now 83/100 (+56)`, a clean evaluator verdict on cycle 1 and a canary that
  fixed a documented bug using only `CLAUDE.md`, then reverted itself (identical `git status`
  before and after). The baseline scored 29 and 27 on two runs of the same repository: expect
  a few points of model variance.

## Workspaces

Both templates also run on a worca **workspace** (pick *Workspace* as the target on the New
pipeline page; workspace runs start from the UI, the CLI has no flag for them). worca fans the
analyzer, assessor and evaluator out with one read-only sub-agent per member, and the
generator and test steps with one editing sub-agent per member, each confined to
`repos/<projectKey>` inside the run root. The agents then write:

- `graph-summary.json` as `{ "members": { "<projectKey>": … } }` and `analysis.md` with one
  `## <projectKey>` section per member;
- per-member scorecards under `readiness/<projectKey>/` (baseline and final), plus the merged
  `readiness-baseline.md`, `readiness/baseline.*` and `readiness-final-cycleN.md`,
  `readiness/final-cycleN.*`, where the score and every dimension are member means and every
  gap or finding is prefixed `<projectKey>: `;
- the approval card with gaps grouped by member.

Two limits are accepted in this phase: there is **no per-member fix loop** (one member below
the threshold sends the whole workspace back to Generate), and the **merge is done by the
model**, not by code. worca caps a fan-out at **8 members**.

## Limits

- **Workspace aggregation is prompt-driven.** See *Workspaces* above for what is merged and
  how; nothing in worca validates the merged shape.
- **No trend across runs.** Each run keeps its own baseline and final cards; nothing
  compares two runs.
- **graphify is optional.** The analyzer degrades to a direct read when it is not
  installed, and `graph-summary.json` says so. When it is installed, worca's preflight tells
  every agent a graph exists at `graphify-out/`; the analyzer has moved it into the run folder
  by then, and every later prompt points at `graph.graphDir` instead and forbids rebuilding it
  inside the repository.
- **Nothing is written under `.claude/` in the target repository.** Claude Code's own
  safety check refuses unattended writes to `.claude/**` (skills, agents, rules,
  `settings.json`), and a `claude -p` session has nobody to approve them. The generator
  therefore folds rules into `CLAUDE.md`'s `## Rules` section and the key workflows into the
  multi-tool files, and reports every refused target under `skipped` in `tools-report.json`.
  Project skills and sub-agents are generated only once the host grants that path (a
  `permissions.allow` rule for `Write(.claude/**)` in the target's own settings, or a worca
  guardrail that adds it for `sideEffect: "code"` agents).
- **The HTML scorecard is written by the model** from the rubric's contract. Three real
  renders (two baselines, one final) all honoured it; if that stops holding, a deterministic
  script card is the planned follow-up.
- **Create pull request** needs a GitHub remote on the target repository; without one the
  run still ends `Ready to ship` and the diff stays on the run's feature branch.
- **Mount note.** worca mounts the `enable-rubric` skill into the run worktree at
  `.claude/skills/enable-rubric` and excludes it from the diff itself; the generator is
  also told never to list or copy it.

## Layout

```
worca-cc-plugin.json
skills/enable-rubric/SKILL.md
agents/enable{Clarifier,Analyzer,Assessor,Infra,Tests,Evaluator,Canary}.{md,meta.json}
workflows/ai-analysis.json
workflows/ai-enablement.json
```
