# Agent prompt audit

Run c13d4fe7 fixed stale UI on merged pull requests but missed two places: the Runs list base note, and a check of the pull request's state after the fetch in the `base-check` route. The causes were in the prompts. Lists in the brief became the edge of the work. Root causes nobody had checked were treated as known. Reviewers judged only the diff. Fix mode fixed only the flagged sites. PR #1562 fixed the implementer, the code reviewer, Chat rule 4, the request-as-plan note and the fan-out directive. This audit covers every other agent and prompt.

The six questions:

1. **Lists as limits.** Can a list in the input (a plan, a request, a review) become the edge of the work, so that places the goal also reaches are skipped?
2. **Unchecked premises.** Is the agent told to treat a claim in its input as verified without checking it?
3. **Review scope.** Does a reviewer judge only the diff or the plan, and never ask what the change should have touched but did not? Do later cycles only re-check earlier findings?
4. **Skipping research.** Can the agent skip research sub-agents or search because the work looks small?
5. **Unsupported claims.** Can the agent call something harmless or read-only without citing code?
6. **Fix-mode narrowing.** Does a fix mode or loop narrow the scope, so that a wrong earlier verdict is never revisited?

Ratings are **blocking**, **major** and **minor**. `ok` means no finding, and `n/a` means the question does not fit the agent's job. A rating followed by ✎ means this change edits the prompt. The line numbers below are for `origin/dev` 01cc4447e, before this change.

## Verdicts

| Agent or prompt | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 |
|---|---|---|---|---|---|---|
| planner | major ✎ | major ✎ | n/a | minor ✎ | ok | ok |
| plan-refiner | major ✎ | major ✎ | major ✎ | minor ✎ | major ✎ | minor |
| plan-reviewer | ok | major ✎ | major ✎ | ok (#1562) | major ✎ | ok |
| clarify | ok | ok | n/a | minor | ok | n/a |
| decomposer | major ✎ | ok | n/a | n/a | n/a | n/a |
| implementer task-mode directive | major ✎ | ok | n/a | ok (#1562) | n/a | n/a |
| implementer fix-mode directive | n/a | major ✎ | n/a | ok | n/a | major ✎ |
| implementer agent body, FIX section | n/a | n/a | n/a | n/a | n/a | major (fixed in #1562, see F8) |
| architect | ok | ok | n/a | ok | ok | ok |
| architect-setup | n/a | n/a | n/a | n/a | n/a | n/a |
| requirements-drafter | minor | ok | n/a | n/a | ok | n/a |
| requirements-reviewer | ok | ok | ok | n/a | ok | ok |
| requirements-refiner | ok | ok | n/a | n/a | ok | ok |
| workspace-scanner | ok | ok | n/a | ok | ok | ok |
| workspace-usage-mapper | ok | ok | n/a | ok | ok | ok |
| workspace-synthesizer | n/a | ok | n/a | n/a | ok | ok |
| workspace-reviewer | major ✎ | ok | major ✎ | ok | major ✎ | ok |
| manual-tests-checklist | minor | ok | minor | n/a | ok | n/a |
| manual-web-ui-testing | ok | ok | minor | n/a | ok | ok |
| memory-defragmenter | n/a | n/a | n/a | n/a | minor | n/a |
| `diffInstruction` | ok | ok | ok | n/a | n/a | n/a |
| Chat rule 10 (how a brief is written) | minor | ok | n/a | n/a | ok | n/a |
| Chat `assess.openDecisions` | ok | ok | n/a | n/a | n/a | n/a |
| Chat Shaper hand-off | ok | ok | n/a | n/a | n/a | n/a |
| Chat rule 4 (workflow choice) | fixed in #1562 | fixed in #1562 | n/a | n/a | n/a | n/a |
| deck-audit | ok | ok | ok | n/a | ok | n/a |
| deck-builder | ok | ok | n/a | n/a | ok | major ✎ |
| deck-clarify | minor | ok | n/a | n/a | n/a | n/a |
| deck-export | ok | ok | ok | n/a | ok | n/a |
| deck-narrative | ok | minor | n/a | minor | ok | minor |
| deck-outputs | n/a | n/a | n/a | n/a | n/a | n/a |
| deck-reviewer | ok | minor | major ✎ | n/a | ok | n/a |
| deck-system | ok | ok | n/a | n/a | ok | ok |
| promo-capture | ok | minor | n/a | n/a | ok | n/a |
| promo-explorer | ok | major ✎ | n/a | ok | ok | n/a |
| promo-mascot | n/a | n/a | n/a | n/a | n/a | n/a |
| promo-review | ok | minor | major ✎ | n/a | ok | n/a |
| promo-scenes | ok | ok | n/a | ok | ok | major ✎ |
| promo-setup | n/a | n/a | n/a | n/a | n/a | n/a |
| promo-voice | n/a | n/a | n/a | n/a | n/a | n/a |
| promo-writer | ok | minor | n/a | n/a | ok | ok |

There are no blocking findings. Each major finding lets a run finish with a gap that no later step is asked to look for. None of them stops a run.

## Where the text lives

- The role instructions are the agent bodies in `agents/*.md`. The orchestrate skill uses the copies in `.claude/agents/`, which exist only for the planner, refiner, plan reviewer, implementer and code reviewer. Those copies are older and worded differently, so each edit was made in the matching place in both files.
- The task prompts built in `src/core/phases.mjs` are generic: a header, the original request, the meta `promptHints`, the fan-out block and the ports. They carry no role rules, so the six questions apply to the agent bodies.
- **The implement, task and fix directives that real runs see come from `agents/implementer.meta.json` (`inputs[].directive`), not from `implementerBody()` in `phases.mjs`.** The graph executor reads the meta file. `implementerBody()` keeps the same text for its tests and for older callers, so both were changed, and the resolved-graph fixtures were regenerated. The same holds for the deck-builder and promo-scenes fix directives in their meta files.

## Findings

### F1. Planner: the request's lists and root causes are taken as given (major, Q1 + Q2)

`agents/worca-cc-planner.md:43` (`.claude/agents/…:67`): "Restate the goal and the concrete scope (informed by the Q&A — honor every answer the user gave)."

Nothing in the planner body asks it to check root causes in the request, or to look past the files and symbols the request names. In run c13d4fe7 there was no planner. On a workflow that has one, the plan's file list becomes the implementer's edge, and #1562's implementer rule then has to find the gaps late.

Added after the job paragraph, in both copies:

> **The goal sets the reach, not the request's lists.** The request may name files, functions, routes or root causes. Treat them as leads to check, not as the edge of the work or as facts: confirm each root cause against the code, and when one is wrong, find what actually produces the symptom before you plan the fix. When the goal sets a rule over a state or a value ("merged is final", "X is hidden when Y"), search for every reader of that state's fields across client and server (screens, lists, dialogs, summaries, routes, jobs), not only for the names the request gives. The plan lists each reader as covered by a step or left out with a reason. A short request is no reason to skip this search: what a request missed is not in it.

Q4 (minor, edited): `agents/worca-cc-planner.md:27`, "Skip fan-out only for a trivial single-file task". A short request is now named as not trivial when its goal reaches code it does not name.

### F2. Plan reviewer: no reach check and no grounding for "harmless" claims (major, Q2 + Q3 + Q5)

`agents/worca-cc-plan-reviewer.md:35` (`.claude/agents/…:26`): "**Completeness**: does it cover the whole request? Missing steps, missing tests, unaddressed requirements or scope."

"Cover the whole request" is checked against the request's text, so a reader of the state that neither the request nor the plan names is never looked for. A plan that calls a route "read-only" is accepted on the route's name. Root causes the plan copies from the request are not checked.

Added before **Feasibility & grounding**, in both copies:

> **Reach**: judge the plan against the request's goal, not only against its own lists. Search the code for every reader of the state or value the change governs (screens, lists, dialogs, summaries, routes, jobs), and raise each one the goal covers that the plan neither covers nor leaves out with a reason: major when users see it or it writes data. A short plan is no reason to skip this search. Check every root cause the plan takes from the request against the code; an unchecked one that the plan builds on is major.
>
> **Grounded claims**: a statement in the plan that a path is harmless ("read-only", "never reached", "nothing else reads this") must match the code. Follow what the route or function calls before you accept it: a name is not evidence.

Q6 is ok. On a blocking verdict the planner writes a cold re-plan, and the next review is a fresh one that does not get the previous review.

### F3. Plan refiner: "scope creep" can cut reach, and completeness is judged against the plan (major, Q1 + Q2 + Q3 + Q5)

- `agents/worca-cc-plan-refiner.md:36`: "**Scope discipline**: Anything the plan assumes that should have been a clarification, or scope creep beyond the task." A refiner can read a step that covers an unlisted reader as scope creep and drop it.
- `agents/worca-cc-plan-refiner.md:34` (`.claude/…:24`): "**Completeness**: Missing features, missing tests, unhandled edge cases, missing verification steps." Completeness is judged against the plan's own content.
- On workflows with no planner (for example `Refine ⇄ Implement ⇄ Review`), the refiner's input plan is the raw request. #1562's request-as-plan note reaches the refiner too, but nothing in the refiner body acts on it.

Edits, in both copies:

- Appended to **Completeness**: "Search for every reader of the state or value the goal governs (screens, lists, dialogs, summaries, routes, jobs), not only the ones the plan names, and give each one the goal covers a step, or a reason it is left out."
- A new bullet: "**Grounded claims**: a root cause the plan takes from the request, or a statement that a path is harmless ("read-only", "never reached"), must match the code. Check it there; a name is not evidence."
- Appended to **Scope discipline**: "Covering a place the request's goal reaches is not scope creep, even when the request did not list it."
- Q4 (minor, `agents/…:25`): "Skip fan-out only for a trivial plan" now says a short plan is not trivial when its goal reaches code it does not name.

Q6 (minor, not edited): in role-review mode (`agents/…:76`, "Report only problems you could not fix as issues"), and with the shipped refine budget of one cycle (`wf_default` w5 `maxCycles: 1, onExhausted: 'clean'`), a wrong fix by the refiner is caught only by the code review. This is deliberate, and the reach check now runs inside that one cycle.

### F4. Decomposer and the task directive: the task's file list is a hard edge (major, Q1)

- `agents/worca-cc-decomposer.md:54`: "…WITHOUT reading the full plan and WITHOUT touching any file outside its listed set."
- `agents/implementer.meta.json:14` and `src/core/phases.mjs:1265`: "…do exactly what it says and nothing outside its scope."

The edge is needed, because parallel implementers share one tree. Without a way back, though, a reader that the goal reaches and no slice owns is never covered. #1562's implementer rule ("cover the reader the plan missed") cannot apply inside a slice.

Edits:

- Each task file carries the plan's goal in one or two sentences. The implementer names a file the goal reaches outside its set in its final note instead of editing it.
- The final integration-verify task, which runs alone, gets a reach check: "from the plan's goal, search for every reader of the state or value the change governs … and cover each one the goal clearly covers that no slice touched, recorded as a deviation. Covering such a reader is not a new feature."
- Added to the task directive in both the meta file and `implementerBody()`: "When the task's goal reaches a file outside its list, do not edit that file: name it in your final note with the reason, so the integration step covers it."

### F5. Fix-mode directive: only the flagged sites, and review claims taken as true (major, Q2 + Q6)

`agents/implementer.meta.json:12` and `src/core/phases.mjs:1255`: "Address EVERY critical and major issue in the review below, then run the tests that cover what you changed. Follow the plan; deviate only if something does not work at all."

In c13d4fe7, cycle 1 flagged a missing guard on some routes. Fix mode guarded those routes only. The cycle-1 reviewer's "read-only" verdict on `base-check` was never revisited.

Appended:

> An issue found at one site covers every site with the same shape (the same missing guard, the same read-then-act, the same stale read): search for those sites and fix each, naming them in your final note. When the code shows a claim in the review is wrong (an issue's cause, or a path it calls harmless), say so in your final note, citing the code, instead of building on it.

### F6. Workspace reviewer: unchanged members are never reviewed, and there is no reach check (major, Q1 + Q3 + Q5)

`agents/worca-cc-workspace-reviewer.md:24`: "Dispatch ONE reviewer sub-agent per member project whose `checkpointRef...feature` diff is non-empty — SKIP any project whose diff against its checkpoint is empty. Each sub-agent … judges it against the plan…"

The workspace reviewer replaces the code reviewer on workspace runs, so #1562's Reach and Grounded-claims checks never reach those runs. A member that consumes a changed provider but was not touched is skipped by design. That is the cross-project form of the c13d4fe7 miss.

Appended to step 1:

> Give each sub-agent the original request's goal and two checks besides the plan: **Reach** (search its member for every reader of the state or value the change governs (screens, lists, dialogs, summaries, routes, jobs), and report each one the goal covers that the diff leaves untouched: major when users see it or it writes data) and **Grounded claims** (a statement that a path is harmless cites the code that makes it so). Then, from the `## Workspace Context` block, list every member that consumes what a changed member provides. When the goal reaches such a member and its diff is empty, dispatch a reviewer for it too, asking only the Reach question.

### F7. Deck and promo fix and review loops (major, Q2 + Q3 + Q6)

- **deck-builder Q6.** `agents/worca-cc-deck-builder.md:60` says "Do not restyle slides the review did not mention." The meta directive says "keep slides the review did not mention byte-identical". The pipeline's known repeat failure, the accent leak, survives fix cycles this way. Both texts now say to fix the same defect on every slide that has it, list the extra slides, and say so when a finding looks wrong in the render.
- **deck-reviewer Q3.** Nothing says a later cycle is a full review, and nothing compares the deck to spine.md's slide table. Added after the slide budget: "Every cycle is a full review of the current deck, not a check of the last cycle's findings. Walk spine.md's Slides table row by row: a planned slide, caption, reset or hero that the deck dropped is `major`."
- **promo-explorer Q2.** `agents/worca-cc-promo-explorer.md:50`: "Only shipped behaviour." Whether a feature shipped is decided from the README's wording, and every later promo step treats product.md as true. Added: "A README is not proof that a feature shipped: confirm each feature and fact in the source (the route, component or command exists, is wired, and is not behind a flag) and cite that path beside the README. Where they disagree, follow the code and list the feature under `## Not claims`."
- **promo-review Q3.** Its inputs are the film, the storyboard and the timeline, and its checks look for defects on screen. A planned beat that the film dropped is not one of them. Added a **Coverage** bullet: "walk the storyboard beat by beat. A beat it plans that the film drops, or shows only as text, is major. Every cycle reviews the whole film, not only the last cycle's findings." The reviewer has no `task` port. Comparing the film to the request would need a wiring change and is left as a follow-up.
- **promo-scenes Q6.** `agents/worca-cc-promo-scenes.md:53` and the meta directive both say "change only the scene files the findings name". Mascot hands, mascots over the narrated text, pops and holds are systemic. Both texts now fix the defect in every scene that has it, keep every other scene byte-identical, and report findings that look wrong.

### F8. Implementer agent body, FIX section (major, Q6, fixed in #1562)

This wording landed in #1562, which owns the implementer prompt.

`agents/worca-cc-implementer.md:74`: "Fix ONLY the flagged issues … do NOT touch code unrelated to the flagged issues … Stay strictly within the boundaries of the review." The description on line 3 says the same.

The implementer was out of scope for this audit, because #1562 owns it, so this text was left alone. It now sits next to the F5 directive. The F5 wording treats same-shape sites as part of the flagged issue, so the two do not contradict each other, but the system prompt still pulls toward the narrow reading. Proposed wording for #1562 or a follow-up:

> Fix the flagged issues — prioritize `critical` and `major` … An issue found at one site covers every site with the same shape; fix those too and name them. Do NOT re-architect, do NOT touch code unrelated to the flagged issues or their same-shape sites, and do NOT introduce new scope.

### Minor findings (not edited)

- **clarify Q4.** `agents/worca-cc-clarify.md:69`: "Skip fan-out for a trivial task". The fan-out directive from #1562 already overrides this at run time.
- **requirements-drafter Q1.** `:28` caps criteria at 6 per perspective. A planner could read the agreed list as the whole scope. F1's reach rule covers this downstream.
- **manual-tests-checklist Q1/Q3.** `:27` derives cases from the plan and the diff ("adjacent existing behavior that the diff could plausibly break"). Proposed: "Add a case for each screen the request's goal reaches that the diff leaves untouched: a stale reading there is a failure the code review can miss."
- **manual-web-ui-testing Q3.** It tests only the checklist. It inherits the gap above.
- **memory-defragmenter Q5.** `:23`: "Remove a rule that is stale, superseded or contradicted". "Stale" has no evidence rule, and the agent cannot read the project. Proposed: "Remove a rule only when another file or a newer `updated` stamp supersedes or contradicts it; when unsure, keep it."
- **Chat rule 10 Q1.** `src/core/ask/prompt.mjs:37`: "the files and symbols worth starting from". The rule already says to mark unverified things as leads. Since #1562, the renderPromptArtifact note tells the run that the lists are leads, not the edge of the work. Proposed: "…worth starting from (where to start, not the edge of the work)".
- **deck-reviewer Q2.** `:53`: "so you are verifying a claim rather than discovering a problem". Proposed: "The manifest columns are claims: check them against the renders, and look for problems the plan never named."
- **deck-narrative Q2/Q4/Q6.** `:15` reads sources only when the brief names them, and `:71` re-checks only titles and resets. Proposed: find a source for each fact the brief states, or mark it unverified in Notes, and re-check the whole spine against the brief.
- **deck-clarify Q1.** `:28`: "Ask nothing else unless…". Proposed: the six questions are a minimum, and a fact the brief states that cannot be confirmed is also worth a question.
- **promo-capture Q2.** `:29` trusts `sandbox.notes` for isolation. Proposed: confirm afterwards that the real config and data folders are unchanged.
- **promo-writer / promo-review Q2.** product.md is the only source of truth (`promo-writer:15`, `promo-review:36-41`). After the F7 explorer fix this is safe. Proposed: the writer notes conflicts between the task and product.md, and the reviewer spot-checks three narrated claims against the code.

## Workflow graphs

The built-in graphs are in `src/core/graph/builtin-workflows.mjs`. Saved workflows are rows in the local `workflows` table (`~/.worca-cc/worca-cc.db`), not files in the repository. `wf_implement-review` is one of those saved rows, not a shipped workflow.

| Workflow | Steps | Planning | Review | What the first agent reads as its plan |
|---|---|---|---|---|
| `wf_default` (built-in) | Clarify → Plan → Refine (1 cycle) → Implement ⇄ Review (3) | yes | code review, 3 cycles | the planner's plan |
| `wf_lean_build` (built-in) | Clarify → Plan → Implement ⇄ Review (2) | yes, no plan review | code review, 2 cycles | the planner's plan |
| `wf_pr_fix` (built-in) | Implement ⇄ Review | no | code review | the PR-fix brief |
| `wf_implement-review` (saved) | Implement ⇄ Review | **no** | code review | the raw request (renderPromptArtifact) |
| `wf_implement-only` (saved) | Implement | **no** | **none** | the raw request |
| `wf_refine-implement-review` (saved) | Refine → Implement ⇄ Review | the refiner rewrites the raw request | code review | the raw request, then the refined plan |
| `wf_clarify-plan-implement-review` (saved) | Clarify → Plan → Implement ⇄ Review | yes, no plan review | code review | the planner's plan |
| `wf_auto_pr_review` (saved) | Review | n/a | code review of someone else's PR | the PR diff, per node `promptHints` |

What this means for the findings:

- On every workflow without a planner, the raw request is the plan. #1562's renderPromptArtifact note and its implementer reach rule are the only things that widen that. F3 extends the same reading to the refiner.
- Lean has no plan review, so the planner's own reach search (F1) is the only check before code.
- `wf_implement-only` has no reviewer, so nothing looks for what the implementer missed. Since #1562, rule 4 tells Chat to give state-rule work a planning step. No prompt change is needed, but Chat should never pick this workflow for work that sets a rule over a state.
- No saved graph's node `promptHints` narrows scope. The only hints, on `wf_auto_pr_review`, only describe a PR review.

## Proof

- The resolved-graph fixtures for `wf_default`, `wf_lean_build` and `wf_pr_fix` were regenerated with `UPDATE_RESOLVED_GRAPHS=1`. Only the two implementer directives changed.
- `UPDATE_PROMPT_SNAPSHOTS=1 … test/graph-prompt-parity.test.mjs` produced no snapshot change. The task prompts carry neither the agent bodies nor the fix and task directives.
- The related test files were run with a scratch `HOME` and `WORCA_HOME`. The commit message lists them.
