# Workflow tests, Part 4: your criteria, checked by Worca — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person writes what a good result needs in plain sentences ("Names a success metric with a number"), and Worca checks each sentence on every try with an AI model the person picks per example: met or not met, why, and a quote from the result that Worca proves is really there. Exact checks without AI (quotes, numbers, personal data, links) cover what can be counted. Worca tests its own checking (planted mistakes, asked again, padding, order swapped, agreement with the person's answers) and shows how far it can be trusted; a criterion it judges unreliably still shows but never decides better or worse.

**Architecture:**
- **Criteria live on the example** (`wf_test_examples.criteria`, JSON), outside the example fingerprint, so a changed criterion re-checks the stored tries and never re-runs the workflow (D86). The checking model is stored per example (`wf_test_examples.judge`, D87).
- **The judge** is one no-tools model call through the Requirements helper call (`helperCall` with `interviewCallOptions('round', …)`, the same path as the interview's `callModel`), with Worca's own system prompt replacing Claude Code's. It answers met / not met, a reason and a proof quote; the quote is checked by text search and an unproven answer is not counted (D88–D90). Under `WORCA_MOCK=1`, and for every mock try, a deterministic mock answers instead, for free (D91).
- **Judgements are their own rows** (`wf_test_judgements`), keyed by try, criterion fingerprint and model. The pages combine them with the stored try verdicts when they read: a try passes when its Basics and automatic checks pass and every deciding criterion is met (D98). Nothing in Part 2's stored verdicts changes.
- **Spend** goes to `wf_test_judge_ledger`, counted in the spending limit (`totalWindowSpendUsd`) and in the test's own cap, and kept out of Statistics like a try's spend (D92).
- **Trust** is computed from the person's answers (Agree / Disagree on a verdict, Right / Wrong in Check the checker) per criterion text and model, with D14's rule: unreliable only after at least 10 answers (D95).
- **New modules** carry all of it; the capped and near-cap files (`src/core/db.mjs`, `ui/server.mjs`, `src/core/workflow-tests/service.mjs`, `ui/public/workflows/example-editor.mjs`, `ui/public/workflows/test-compare.mjs`) only gain a few wiring lines.

**Tech Stack:** Node ESM, `node:sqlite` (schema rung v99), `node:test` + jsdom, Express (routes registered from `ui/routes/workflows/workflow-tests.mjs`), vanilla DOM modules (`ui/public/workflows/*.mjs`), Claude Code CLI through `src/core/helper-call/index.mjs`.

**Spec:**
- `plans/workflow-tests-plan.md`: D12 (the checking model is chosen per example), D14 (unreliable criteria still run and show, but do not decide better or worse; unreliable only after ≥ 10 answers), the Part 4 outline ("Part 4 — Your criteria, checked by Worca (boards 2, 10–13)") and "Ideas from other eval tools", Part 4 bullets.
- `plans/workflow-tests-eval-frameworks.md` §3.1 items 10–15 (frozen steps, binary verdicts, gating, claim checks, choice labels, the calibration loop and the three known judge biases).
- The approved design canvas "Workflow tests and version compare": https://claude.ai/artifact/7kDSH4sKKDz3gV4DnnTABJ, read on 2026-11-19 (version `1795047286-0740`). Boards 2, 3, 4, 5, 6, 10–13, 32 and 36 (see "Reading the canvas").
- Parts 2, 3a and 3b decisions D18–D85 hold unless a decision below replaces one.

**Code base.** Every `file:line` here cites commit **`3b045d0a8`** (branch `feat/workflow-tests-part4`, made from Part 3b's head: Parts 1–3b plus a fresh merge of `dev`, `SCHEMA_VERSION = 98`). Task 0 re-finds every cited place before Task 1.

---

## Open items (for the user; nothing is built until they are decided)

Each item has a recommendation (**R**) and the alternative(s). Where a task depends on one, the task says "depends on P4-Qn" and is written for the recommendation.

- **P4-Q1. One pull request or two?**
  - **R: two PRs from this one plan.** 4a = Tasks 1–10 and 16–20 (criteria on examples, the judge, exact checks, spend, trust marks, side by side, Compare by criterion). 4b = Tasks 11–15 and 21–23 (Check the checker, the pair question, a result you liked, suggestions, the trust report, Add from a past run). 4a is useful on its own; 4b needs 4a.
  - Alternative: one PR (about 25 tasks; slower to review).
- **P4-Q2. Which AI models can check criteria?**
  - **R: Claude models from Worca's model catalog only** (the "Checked with" list). Their cost is billed and known; the paid check (Task 25) proves the path once.
  - Alternative: every harness Requirements can use (`helperCall` already runs Codex, Gemini CLI and others), with "estimated" or "unknown" costs to explain in the UI.
- **P4-Q3. Which model makes the planted mistakes, the suggested criteria and the clearer words?**
  - **R: the example's checking model** (one choice, one price list, nothing new in Settings). Before an example exists (Add from a past run), the suggested checking model.
  - Alternative: the "everyday" model role (cheaper), which needs a new model slot in Settings › Models and its own docs.
- **P4-Q4. Is a criterion part of the example's fingerprint?**
  - **R: no** (D86). Editing a criterion re-checks the stored tries (a judge call each) and never re-runs the workflow; the tries stay reusable.
  - Alternative: yes, like automatic checks (D26): simpler, but every criterion edit makes every try of that example run again.
- **P4-Q5. Which tries are checked?**
  - **R: every try that finished**, whether or not its Basics and automatic checks passed. Compare by criterion (board 12) needs a count for every criterion on every try.
  - Alternative: only tries whose Basics and automatic checks passed (deepeval's "exact gates first"): cheaper, but board 12's counts then cover fewer tries than board 5's.
- **P4-Q6. When is a criterion unreliable?** (D14 fixes "only after at least 10 answers".)
  - **R:** after ≥ 10 answers, unreliable when Worca agrees with the person less than 80% of the time, **or** when, on either side ("Worca said met" / "Worca said not met") with at least 3 answers, it agrees less than 70% (the eval research: plain agreement hides a checker that always says "met").
  - Alternative A: the 80% rule only. Alternative B: 90% (board 12's legend says "almost every time").
- **P4-Q7. A verdict whose quote is not in the result.**
  - **R: ask once more; if the quote is still not found, the verdict is not counted** ("Not checked: Worca's proof was not in the result"; it does not decide). Board 13 test 5: "Verdicts without proof are not counted."
  - Alternative: count it as not met.
- **P4-Q8. "Which result is better overall?" (board 6) and "closer to a result you liked" (board 2).**
  - **R: one pair question per example per test:** the first finished try of each version, asked in both orders (so the order-swapped test of board 13 has data). With a result you liked the question is "closer to the result you liked", otherwise "better overall". Only for examples that have criteria or a result you liked. It never decides better or worse. Shown above the try tabs on one example side by side (a small move from board 6: needs P4-M6).
  - Alternative A: every try pair (3 tries = 6 calls per example). Alternative B: no pair question in Part 4.
- **P4-Q9. "Links work".**
  - **R: build it** with Ask's guarded web transport (`httpsTransport` + `guardedLookup`, `src/core/ask/web-fetch.mjs:183`, `:105`): public addresses only, `http://` tried as `https://`, at most 20 links a result, 15 s each, at most 3 redirects, no cookies, no body read.
  - Alternative: leave it to a later part (the check makes outbound web calls from Worca itself).
- **P4-Q10. When does Worca suggest criteria from the note in "Use this run as a test example" (board 3)?**
  - **R: as drawn: when the note box loses focus** with at least 20 characters, once per distinct note, about $0.01 with Haiku and a few cents with Opus. The cost counts in the spending limit.
  - Alternative: a "Suggest criteria" button (needs a mock change).
- **P4-Q11. Frozen evaluation steps (G-Eval) per criterion.**
  - **R: not in Part 4.** No board draws "Worca will check: 1… 2… 3…", and the trust tests already catch a drifting checker.
  - Alternative: include, after a mock.
- **P4-Q12. Board 13's "A newer AI model for checking is available · Test the new model".**
  - **R: not in Part 4.** Changing "Checked with" already starts the trust tests again (board 2's hint).
  - Alternative: include (one more flow: run every criterion's Check the checker with the new model, about $2).
- **P4-Q13. `src/core/db.mjs` is over its size cap** (3135 lines, cap 2811 in `tools/split-by-feature/size-caps.json`).
  - **R: move all workflow-tests DDL (v96–v99) into a new `src/core/workflow-tests/schema.mjs`** (pure strings) in Task 1. db.mjs then shrinks by about 90 lines although it gains the v99 rung.
  - Alternative: put only the v99 DDL there (db.mjs grows by about 6 lines).
- **P4-Q14. The paid end-to-end check (Task 25).**
  - **R: run it once, controller only, after the user's explicit OK:** Claude Haiku 4.5 as the workflow's model and as the checking model, one "Try it once now" with two criteria, one Check the checker round, one Agree. **Cap: $3.** It goes through Worca's normal model routing; before it runs, the controller names the account that pays (memory: check `~/.worca-cc` model routing, e.g. a Vertex env on the alias, not only the Claude sign-in).
  - Alternative: no paid check before the PR.
- **P4-Q15. An older test after its criteria changed.**
  - **R: Compare shows the new criteria as "Not checked yet" and offers "Check them on these tries (about $X)"** (one press, needs P4-M5). Nothing is spent without a press.
  - Alternative: check them automatically when Compare opens.
- **P4-Q16. "How testing works", step 2 (board 1).** Part 2 changed it (C1) to "Pick the Basics it must meet and add automatic checks, …" because criteria did not exist.
  - **R: back to the approved text** "In your own words, for example "names a goal with a number"." once criteria ship.
  - Alternative: keep Part 2's text.

The canvas could be read (see below). The UI that no approved board draws is listed under "Undrawn UI" (P4-M1–M7): each is mocked on the canvas and approved before its task builds it.

---

## Corrections to the outline (verified at `3b045d0a8`)

1. **`callModel` moved and is not the function to call.** It is at `src/core/requirements/interview.mjs:268` (outline: `:227`). Since Requirements 9c it is a thin wrapper over **`helperCall`** (`src/core/helper-call/index.mjs:39`), which runs Claude or another harness, books nothing itself, and returns `{ text, costUsd, costKind, inputTokens, outputTokens, engine, events }` or throws a `HelperCallError` that carries what it spent. The judge calls `helperCall` with `interviewCallOptions('round', { …, systemPrompt, noSessionPersistence: true })` (`interview.mjs:232`), so it gets the interview's rules for free: Worca's system prompt replaces Claude Code's (`systemPromptMode: 'replace'`), no tools, `strictMcpConfig`, slash commands off, `settingSources: ['project']` unless the person's user settings carry the sign-in, the model's routing env (`resolveModelEnv(model)`), and `spawnKind: 'aux'` for the credential broker.
2. **`totalWindowSpendUsd` is at `src/core/cost-budget.mjs:142`** (outline: `:114`). It now sums four ledgers: runs, Chat, Requirements and **Design** (`designWindowedSpendUsd`, `cost-budget.mjs:132`, with `recordDesignCostDelta` at `:125`). The Design ledger is the pattern to follow: its own table, a record function and a windowed sum in `cost-budget.mjs` (not in `stats.mjs`, which only imports them: `stats.mjs:24`).
3. **A test try's spend already counts in the limit** through `cost_ledger` (the try is a hidden pipeline, `pipelines.is_test = 1`), and Statistics leaves it out with `NOT_TEST` (`stats.mjs:66`). `budgetWindowSavings` (`stats.mjs:493-507`) subtracts the tries' spend so a test cannot make "Saved" negative; judge spend needs the same subtraction (Task 5).
4. **A test's own spend is `store.spentOfRun`** (`store.mjs:410`): the runner's cap (`runner.mjs:128`, `:287`, `:294`), "Finish the rest" (`:693`), Compare's cost (`service.mjs:848`) and the Tests list's latest test (`service.mjs:572`) all read it. Adding the judge ledger there (Task 7) makes the cap and every shown cost include judging, with no other change.
5. **Automatic checks are one array** on the example (`checks`), part of the example fingerprint (`store.mjs:95-104`). The check dialog lists **every** kind in `CHECK_KINDS` (`example-editor.mjs:106-118`), so a new kind shows in the UI as soon as it is added: Task 3 hides the four new kinds from the dialog until Task 18 (after P4-M1).
6. **The judge's mock is ours.** `runClaude` in mock mode runs the mock engine (`claude-runner.mjs:242-243`), which answers with pipeline fixtures, not a judge's JSON. Like `brief-job.mjs:225-227` (`d.mockEnabled()` → `mockBrief`), the judge checks `mockEnabled({})` (and the try's own `mock`) and answers from a pure `mockJudgement` without calling `helperCall`.
7. **What a workflow writes with** is in each try's pipeline row: `pipelines.stepper` holds the run's manifest, and `manifestModels` (`src/core/broker-routing.mjs:74`) lists every model it names. The "Checked with" suggestion (board 2: "an AI model that this workflow does not use to write") reads it from the workflow's latest tries (Task 10).
8. **Model ids** are the catalog's (`PREDEFINED_MODELS`, `src/core/config.mjs:96-113`; `listModels()` at `:628`), for example `claude-opus-5-5` labelled "Opus 5.5". `runsOn(m, 'claude')` (`src/shared/connections.mjs:53`) tells which run on Claude Code.
9. **Size caps.** Only `ui/server.mjs`'s cap is enforced by a test (`test/split-by-feature-plan.test.mjs:134`); the others are the split tool's record. The rule here holds anyway: no task raises a cap, Part 4 does not touch `ui/server.mjs` or `ui/public/app.js`, and the files near 1,000 lines (where the tool adds a cap: `nextCaps`, `tools/split-by-feature.mjs:334`) get only wiring lines: `service.mjs` (949), `example-editor.mjs` (811), `test-compare.mjs` (757), `runner.mjs` (739).
10. **CSS lives in `ui/public/workflows/workflow-tests.css`** since the split by feature (456 lines), not in `style.css`. Part 4's rules go at its end.
11. **Board numbers.** The brief's "boards 33/34/36" are read by the canvas's own titles: board 32 (`P3Editor`, "Part 3: Edit an example, where it starts") draws "Your criteria" and "A result you liked" for a project example, and board 36 (`P3SideBySide`) draws the "Your criteria · checked by Worca" rows. Boards 33 and 34 have no Part 4 element.
12. **The example note.** Board 45 (usefulness fixes, approved 2 Nov) made the note "What a good result has · in your own words" with the hint "A note for people. Worca does not check it." (`ui/public/workflows/test-ui.mjs:177-179`). Part 4 keeps it: the note is still not checked; criteria are separate, and board 3's suggestions turn the note into criteria the person picks.

## Reading the canvas (2026-11-19)

The canvas was read with the Artifact tool (50 boards; titles in `project/canvas.json`). What Part 4 builds from it:

| Board | File | Part 4 elements |
|---|---|---|
| 1 | `Main` | "Your criteria N" in an example's "What is checked" chips; the "Can you trust Worca's checking?" card |
| 2 | `CaseEditor` | "Your criteria" (sentence rows with a trust line, "Can be checked exactly … Switch"), "Add a criterion", "Add an exact check", "Checked with" and its hint, "A result you liked · optional" with Replace |
| 3 | `AddFromRun` | "This result, as a result you liked" in "Keep from this run"; "Worca turned your note into criteria · Click one to add it" |
| 4 | `RunSuite` | the estimate row "Checking your criteria · about $0.90" |
| 5 | `Compare` | "By example · By criterion" tabs; the card "Worca's checking is reliable for 10 of 12 criteria. 1 unreliable criterion is shown, but does not decide better or worse. See by criterion" |
| 6 | `CaseDetail` | "Your criteria · checked by Worca" rows: "Why Worca says no for v5:", "Proof from the result:" with "found in the result", the trust line, Agree / Disagree; "Which brief is better overall?" (blind) with Agree / Disagree and the note "When you disagree, Worca notes it." |
| 10 | `AddCheck` | the violet "Worca suggests" box (switch a criterion to an exact check), the exact kinds and their hints, "Or write a criterion in your words". Its card grid was replaced by boards 24 and 33's "What to check" select (Part 2, 3): see P4-M1 |
| 11 | `CheckChecker` | Check the checker: the criterion, "Did Worca get these right? 2 of 4 left", one real and three planted results with Worca's verdict and Right / Wrong, "Worca also tested its own checking" (3 rows), the cost line, "Use this criterion" |
| 12 | `ByCriterion` | the legend (Reliable, Confirm 4 results, Unreliable), the table (criterion, example, v4 met, v5 met, Worca's checking), coloured changed rows, "N more criteria, all met …", the footnote |
| 13 | `TrustReport` | the three tiles, the six tests, "What to do" (Fix the criterion, Confirm 4 results). Not built: the "newer AI model" box (P4-Q12) |
| 32 | `P3Editor` | the project example's "Your criteria" ("Worca reads what changed"), the grey "Needs your answers · Worca has 4 of the 10 answers it needs", "A result you liked" as "Changes from the run on 28 Oct · 3 files" |
| 36 | `P3SideBySide` | the "Your criteria · checked by Worca" rows on a project example |

Board 12 also shows criteria the person switched to exact checks, labelled with the person's words ("Mentions that today's export stops at 200 invoices") and "Can be checked exactly": D99's `said`.

## Copy and design gaps (decided here)

| # | Where | What this plan builds |
|---|---|---|
| P4-C1 | Board 2's trust line for each state | Reliable: green "Reliable" + "Worca agrees with people X of N times". Needs your answers (board 32): grey badge + "Worca has N of the 10 answers it needs". Unreliable (board 12): red "Unreliable" + "Agrees with people X of N times. Shown, but does not decide better or worse." + "Fix it". New (board 12's amber): "Confirm 4 results" as a link to Check the checker. Exact: violet "Can be checked exactly, without AI." + "Switch" (or "Can be checked exactly: the result must contain "200"." + "Switch"). The new and unreliable rows in the editor are undrawn: P4-M2. |
| P4-C2 | "Not checked" cells (undrawn) | "Not checked yet" (no judgement), "Not checked: the try did not finish", "Not checked: the spending limit is reached", "Not checked: the try left no result", "Not checked: Worca's answer could not be read", "Not checked: Worca's proof was not in the result", "Not checked: the check did not run". Grey, never a red or green dot. |
| P4-C3 | Board 6's "Why Worca says no for v5:" for a met verdict | "Why Worca says yes for v4:". The proof line ends with "· found in the result" (board 6); a verdict whose proof was not found is not shown as a verdict (P4-C2). |
| P4-C4 | Board 10's hints for the new exact kinds in the select | "Every quote is in the files": "Each sentence in quotation marks must appear word for word in the example's files or request. Small differences in spacing and quotation marks are ignored." "Numbers come from the files": "Each number in the result must appear in the example's files or request." "No personal data": "No e-mail addresses, phone numbers, bank account or card numbers." "Links work": "Every link in the result opens a real page." (board 10's words). |
| P4-C5 | The value of the new exact checks side by side | Quotes: "Met", "No quotes" (met) or "Not in the files: "<first, 60 characters>"" + " and N more". Numbers: "Met", "No numbers" (met) or "Not in the files: 60%, 140" (first three) + " and N more". Personal data: "Met" or "Found 1 e-mail address, 2 phone numbers". Links: "Met", "No links" (met), "Met · 20 of 31 checked" or "Not working: <first link, 60 characters>" + " and N more". |
| P4-C6 | The Test a version estimate when no judge price is known | "Checking your criteria · cost not known yet" (board 4's row, C12's wording). |
| P4-C7 | Board 2's "Checked with" when the workflow writes with every Claude model | The strongest model, without "· suggested". |

## Undrawn UI (mock before the UI tasks)

No approved board draws these. Each is mocked on the evals canvas (Worca design system), approved by the user, and only then built. The words below are this plan's proposals; the approved mock wins.

- **P4-M1. Add an automatic check (boards 24 and 33's dialog) with the Part 4 kinds and Worca's suggestion.** The four new kinds in the "What to check" select under "The result": "Every quote is in the files", "Numbers come from the files", "No personal data", "Links work", each with its P4-C4 hint and a live preview line; none has a field except the "Read from" choice of a project example (Part 3a's Q11) for the first three. Board 10's violet "Worca suggests" box at the top when the dialog was opened from a criterion's "Switch" (with "Switch to an exact check" and "Keep it as a criterion"). States: each kind picked, opened from Switch, a project example.
- **P4-M2. The editor's criterion rows (boards 2 and 32) in every state.** A new empty row after "Add a criterion" (placeholder "A sentence that is true of a good result"), a row's Remove (an icon button), "Confirm 4 results" (amber, a link), "Needs your answers", "Unreliable" with "Fix it", "Not checked yet" for a criterion on an unsaved example, the "Checked with" select's list (Claude models with "· suggested"), and "A result you liked" when empty ("Add a result you liked": upload a file, or "Use a try's result") and with a project example. Light, dark, 390 px.
- **P4-M3. Check the checker (board 11) states.** While Worca prepares ("Worca is breaking a good result in a few ways…", then "Checking 4 results…"), no good result yet ("Try this example once first, so Worca has a good result to break."), failed (the reason and "Try again"), the spending limit reached, after a "Wrong" (Worca's clearer words, "Use these words and check again", "Keep my words"), and done (all 4 answered, "Use this criterion" on).
- **P4-M4. The trust report (board 13) early states.** No criteria yet, criteria but no answers yet ("Worca needs your answers first: confirm each new criterion."), and tile 1 without colleagues' data (board 13's "people agree with each other 90%" needs Part 5's reviews: the sub-line then reads "of N answers").
- **P4-M5. Compare (board 5) extras.** The "In short" sentence when a change shows only in unreliable criteria ("v5 differs from v4 on 1 example only in a criterion Worca cannot judge reliably yet: Pricing page A/B test."), the line when criteria changed after the test ("Your criteria changed after this test. Check them on these tries (about $0.40)" with a button), and the progress line while a test checks criteria after its last try ("Checking your criteria on earlier tries").
- **P4-M6. One example side by side (board 6) extras.** After Agree or Disagree ("You agreed." / "You disagreed: Worca notes it." with Undo), the pair question above the try tabs (P4-Q8) with "closer to the result you liked", a "Not checked" row (P4-C2), and board 36's project rows with Why and Proof (the proof quoted from the changes in code font).
- **P4-M7. Use this run as a test example (board 3 with board 45's labels).** Board 3's "Worca turned your note into criteria" under board 45's "What a good result has · in your own words" field, while suggestions load ("Worca is reading your note…"), none found, and a chip after it was added (ticked, "Added").

---

## Decisions

D1–D85 hold. These continue them. The `(technical)` rows are for the reviewer.

| # | Decision |
|---|---|
| D86 | **Where criteria live.** `wf_test_examples.criteria`: a JSON list of `{ id, text }`, at most 12, each 3–300 characters, no two the same after normalising (`criterionKey`: NFKC, straight quotes, lower case, single spaces, no closing full stop). Ids are `k_` + 10 hex characters. Criteria are **not** part of the example fingerprint (P4-Q4): a changed criterion re-checks stored tries and never re-runs the workflow; reuse (D26) is unchanged. |
| D87 | **The checking model, per example (D12).** `wf_test_examples.judge` = `{ model }`, a Claude model of the catalog (P4-Q2). Saving an example that has criteria and no checking model stores the suggestion (D105). Trust is kept per criterion text **and** model, so changing the model starts the trust tests again (board 2's hint). |
| D88 | **The judge call.** `helperCall({ engine: 'claude', model, claudeOptions: interviewCallOptions('round', { cwd, prompt, model, systemPrompt: JUDGE_SYSTEM_PROMPT, noSessionPersistence: true }, { keepUserSettings }) })`. `cwd` is an empty scratch folder (`<worcaHome>/tmp/workflow-tests/judge`), so no project's settings or CLAUDE.md load. No tools, no MCP. Timeout 120 s. It uses Worca's normal model routing (the model profile's env, the credential broker) like any run: the account that pays is the one that pays for that model in a run. Pretend or Real does not matter: the judge has no connectors. |
| D89 | **The answer and its proof.** The reply is one JSON object `{ "verdict": "met" \| "not met", "reason": "…", "proof": "…" }`. The proof is a passage copied from the result; Worca searches the result for it (NFKC, quotes and dashes straightened, markdown marks and spaces ignored, case ignored, "…" splitting it into parts that must all be found, at least 8 characters). An unreadable reply is asked once more; a proof that is not found is asked once more and then **not counted** (P4-Q7). |
| D90 | **What the judge reads.** The try's main result (`mainResult`), and for a project try also its diff (the try's `diff-patch.patch`) under a "Changes" heading; together at most 200,000 characters (cut at a line, and the prompt says it was cut). Context: the example's request, the answers it gives Worca, and its text files (UTF-8 files only), at most 100,000 characters. The proof must come from the result (and diff), never from the context. Everything read is data: the prompt puts it in tags and says never to follow instructions inside. |
| D91 | **When.** A test's own tries: in the try's checking phase, right after its automatic checks, for every try whose run finished (P4-Q5); criteria already judged for that try, text and model are not asked again. After the last try, a criteria phase checks the tries the test reused (and any still missing). Try it once now too. A mock try, and every call while `WORCA_MOCK=1`, uses `mockJudgement`: free, no ledger row. A judge failure never fails a try: the criterion shows "Not checked …" (P4-C2). |
| D92 | **Spend.** Every model call of Part 4 that cost money writes a `wf_test_judge_ledger` row (purpose `try`, `pair`, `checker`, `suggest` or `reword`). `testJudgeWindowedSpendUsd` joins `totalWindowSpendUsd` and the budget's all-time figure; `budgetWindowSavings` subtracts it like test tries. A test's own judge rows (`test_run_id`) count in `store.spentOfRun`, so in its cap and every cost shown for it. Statistics shows none of it (Part 6's Tests tile will). With the spending limit reached, no call is made ("Not checked: the spending limit is reached"). |
| D93 | **The exact checks** (pure, no AI; kinds `quotes`, `numbers`, `no-personal`, `links`). Sources = the example's request, its answers and its UTF-8 files.<br>• **quotes:** text in “…”, "…" or «…» of at least 4 words; each part between "…" must be found in the sources (normalised as D89). No quotes: met.<br>• **numbers:** every number in the result (thousands separators and a trailing % dropped; list markers like "1." at a line start and single digits without % ignored) must be among the sources' numbers.<br>• **no-personal:** no e-mail address, no phone number (a "+" or a leading 0 and 9–15 digits), no IBAN (mod-97 checked), no card number (13–19 digits, Luhn checked).<br>• **links** (P4-Q9): every `http(s)` link (markdown or bare, at most 20 checked) answers 2xx after at most 3 redirects, over https, on a public address.<br>The first three may read a file of a project example ("Read from", Part 3a Q11). |
| D94 | **"Can be checked exactly" (board 2).** A pure rule suggests an exact check for a criterion's words: "quot…" → quotes; "numbers … from/in the files/data/notes/interviews" or "makes up no numbers" → numbers; "personal data", "e-mail", "phone number" → no-personal; "link" → links; a number of 2+ digits with "mention/say/state/name" → "Must mention" that number. **Switch** opens the check dialog with the suggestion (P4-M1); the new check keeps the criterion's words as `said` (D99), and the criterion is removed. |
| D95 | **Trust marks (D14, P4-Q6).** Per workflow, criterion text (`criterionKey`) and model:<br>• **confirm** ("Confirm 4 results", amber): no Check the checker round of it is done. It decides (board 12: "It counts, but you have not confirmed").<br>• **collecting** ("Needs your answers", grey, board 32): a round is done, fewer than 10 answers. It decides.<br>• **reliable** (green): ≥ 10 answers and the P4-Q6 rule holds. It decides.<br>• **unreliable** (red): ≥ 10 answers and the rule fails. Shown, never decides. It becomes reliable again only through new words (a new key: "confirm" again) or new answers.<br>Exact checks are always "Can be checked exactly" and decide like any automatic check. |
| D96 | **Answers.** Agree / Disagree on a criterion's verdict side by side (board 6), Right / Wrong on a card in Check the checker (board 11), Agree / Disagree on a pair answer. One answer per person per verdict; a later press replaces it; Undo removes it (P4-M6). An answer counts for the verdict's criterion key and model only. Pair answers count for board 13's tests, never for a criterion. |
| D97 | **Check the checker (board 11).** One round per criterion, key and model, started by the person (the "Confirm 4 results" link, "Fix it", or "Add a criterion" then Save).<br>• **The good result:** the example's result you liked (text), else the newest passed try of the example, else the past run it came from when the person called it good; none: refused with P4-M3's sentence.<br>• **Planted results:** one model call returns a passage of the result and three broken versions of it, each with a short "how" ("number removed"); each must be found and replaced in the result (D89's search). If it fails or the passage is not found: three deterministic plants (numbers removed from the first paragraph with numbers, a made-up quote added, the first paragraph removed).<br>• **Calls:** the real and the three planted results are judged (4), each asked twice more (8), and each with filler text added (4): 16 judge calls plus the planting call.<br>• **Answers:** the four verdicts get Right / Wrong; when all four are answered the round is done. A "Wrong" offers clearer words (one call, D104; P4-M3).<br>• Rounds run in the background, one at a time per example and criterion; the page polls every 2 s while one is being made. |
| D98 | **Better or worse with criteria.** Read time only. A try passes when its stored verdict passes (Basics and automatic checks, Part 2) **and** every deciding criterion is met; a criterion that is not checked, or unreliable, does not decide. The pages, Compare's counts, "In short", the luck rule and the Tests list's cells use this status. A second reading with unreliable criteria deciding too finds the examples whose result would change: Compare names them (P4-M5) instead of calling them better or worse. Missed criteria join "missed …" in "In short" (board 5). |
| D99 | **Compare by criterion (board 12).** One row per criterion of each compared example, plus each automatic check with `said` (a criterion switched to an exact check, labelled with the person's words and "Can be checked exactly"). Columns: met on A and on B ("X of N" over checked tries), Worca's checking (the trust mark and its line). A row whose two rates differ by at least one try's worth is coloured (green better, red worse) when it decides; rows met in every try by both versions collapse into "N more criteria, all met in every try by both versions". |
| D100 | **The pair question (P4-Q8).** Blind: "Result 1" and "Result 2", asked in both orders. The same winner both times = that winner; different = "unsure"; "same" both times = a tie. Stored as one judgement row (`purpose 'pair'`, both try ids, `winner` a / b / tie / unsure). With a result you liked, the question is which is closer to it. Never decides. Only for examples with criteria or a result you liked. |
| D101 | **A result you liked.** `wf_test_liked`, one per example: a text (`kind 'text'`: an uploaded UTF-8 file of at most 2 MB, or a try's or past run's main result) or, for a project example, changes (`kind 'changes'`: the result and its diff, at most 2 MB, named "Changes from the run on <date> · N files"). It is the first choice of Check the checker's good result and the reference of the pair question. It is not part of the fingerprint. |
| D102 | **Suggested criteria (board 3, P4-Q10).** One call reads the note, the request and the run's result and returns at most 3 sentences, each a criterion (D86's rules). Shown as chips; a press adds one. Cost: ledger purpose `suggest`. Mock: the note's first three sentences. |
| D103 | **Copy is plain words** (the evals copy standard): criterion, met, not met, reliable, unreliable, check, answer, proof is "Proof from the result". Never "judge", "LLM", "score", "confidence", "fingerprint", "calibration" or "position bias" in the UI. |
| D104 | *(technical)* **Prompts are Worca's own words**, written for this plan, so no licence text comes along (the research allowed copying MIT/Apache prompts with attribution; not needed). Clearer words: one call with the criterion and the cards the person marked Wrong returns one rewording of at most 300 characters. |
| D105 | *(technical)* **The suggested checking model.** Among the catalog's Claude models (no "(1M)" twins unless nothing else), Opus first, then Fable, Sonnet, Haiku, each family newest first (the catalog's order); the first the workflow's latest 10 finished tries did not write with (`manifestModels` of their `pipelines.stepper`). If they wrote with all, the first, without "· suggested" (P4-C7). |
| D106 | *(technical)* **Schema rung v99** (P4-Q13): `wf_test_judgements`, `wf_test_judge_answers`, `wf_test_checker_rounds`, `wf_test_liked`, `wf_test_judge_ledger`, and `wf_test_examples.criteria` / `judge` through `INCREMENTAL_COLUMNS`. FK-free like v97. Deleting an example deletes its judgements, answers, rounds and liked result; the ledger stays (spend never goes back). |
| D107 | **Flag and level.** Everything is behind `workflowTests` (routes behind `requireFlag('workflowTests')`, UI behind the Tests page, which is already behind it). UI level **Simple**, like Parts 2 and 3. |

---

## Global Constraints

- **Worktree and branch:** `C:\Users\BRT1BG\worca-cc\worca-cc-tests4`, branch `feat/workflow-tests-part4`, from `3b045d0a8` (Part 3b's head with `dev` merged). Its PR targets `dev` after Part 3 merges; until then, merge `feat/workflow-tests-part3b` in when it moves.
- **Commits:** one per task (Task 0 and Task 25 have none). Author `TomicaB <tomica.brkovic@yahoo.com>` (`git -c user.name=TomicaB -c user.email=tomica.brkovic@yahoo.com commit …` unless the worktree's config already says so). The message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never stash, rebase or amend.
- **Upstream:** target `dev`; merge commits only (merge `dev` in, never rebase or force-push); state `npm test` and a smoke run in the PR; name the UI level and update `docs/ui-levels.md`.
- **Never push or open a pull request without the user's explicit go.**
- **Run one test file:** `node tools/test.mjs test/<file>.test.mjs` (hermetic home and the no-real-claude guard). About 170 tests already fail on clean `dev` on this laptop: compare with Task 0's baseline before blaming a task, and re-check a masked file on WSL Ubuntu before pushing.
- **Search:** `git grep` with `timeout 60`; plain recursive grep or ripgrep time out on this repo.
- **TDD:** every task writes its failing test first, runs it to see it fail, then writes the code.
- **Paid model calls: none in tests.** Tests inject a fake `helperCall` or run under `WORCA_MOCK=1`. The one paid check is Task 25, controller only, after the user's explicit OK, capped at **$3**, through Worca's normal model routing, with the paying account named first (P4-Q14).
- **Schema:** `SCHEMA_VERSION` becomes **99**. If `dev` takes 99 first, renumber on the merge (the rung, the test file name, `docs/storage.md`).
- **Size caps:** never raise a cap in `tools/split-by-feature/size-caps.json`. No change to `ui/server.mjs` or `ui/public/app.js`. `src/core/db.mjs` must end the part shorter than it starts (P4-Q13). `service.mjs`, `runner.mjs`, `example-editor.mjs`, `test-compare.mjs` and `tests-app.mjs` stay under 1,000 lines (each task that touches one says how many lines it adds; check with `(Get-Content <file>).Count`).
- **PR wording (`test/ui-ship-words.test.mjs`):** never "open" as a pull-request verb in any string literal.
- **UI copy:** plain words (D103); `textContent` only; dialogs through `testDialog` (`ui/public/workflows/test-ui.mjs:148`); badges: green = reliable / met, red = unreliable / not met, amber only "needs you" (Confirm 4 results), grey = waiting or not checked, violet = exact (board 2).
- **UI follows `docs/design-system.md`** (`test/ui-design-language.test.mjs`, `test/ui-shared-controls.test.mjs`): type steps and radius tokens only, icons from `icons.mjs` inside a button with an `aria-label`, an on/off is a switch.
- **CSS:** tokens only, never a hex colour; new rules at the end of `ui/public/workflows/workflow-tests.css`; every block closed.
- **UI tasks start only on approved screens.** Tasks 16, 17, 19 and 20 build what boards 1, 2, 4, 5, 6, 12, 32 and 36 draw and can start at once; their undrawn parts, and Tasks 18, 21, 22 and 23, start only after the user approved the mocks they name (P4-M1–M7). Before a UI task, the controller re-reads its boards (`Artifact` read of the files in "Reading the canvas") and applies any copy change first.
- **Every UI task runs the design guards** after its own tests: `node tools/test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs test/ui-ship-words.test.mjs`. Compare `ui-design-language` with Task 0's baseline.
- **Route errors:** `{ error }` with 400 / 404 / 409 / 422 / 500.
- **Hidden tries (D21, D22) hold.** A judge call is not a run: no pipeline row, no memory, no notifier.
- **No new identifier may be called `version`** (D7).
- **Test files must not read `plans/`.** Pin copy literals in the tests.
- **Windows:** removals use `rm(…, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })`.

## Review Focus

1. **A criterion edit never re-runs the workflow** (Tasks 2, 7). Expect the example fingerprint unchanged by `criteria` and `judge`, and a later test to reuse the tries and only add judge calls.
2. **The judge call's options** (Task 6). Expect `tools: []`, `systemPromptMode: 'replace'`, `noSessionPersistence: true`, `settingSources: ['project']` without a sign-in in user settings, the model's `modelEnv`, `spawnKind: 'aux'`, and an empty scratch `cwd`.
3. **Proof** (Task 6). Expect a quote with curly quotes, extra spaces, markdown stars or an ellipsis to be found; a made-up quote not found; one retry; then "not counted".
4. **Spend** (Tasks 5, 7). Expect judge spend in `budgetStatus().windowSpendUsd`, in `spentOfRun`, in the test's cap, and not in Statistics or "Saved".
5. **Mock is free** (Tasks 6, 7, 11, 14). Expect no `helperCall` and no ledger row under `WORCA_MOCK=1` or for a mock try.
6. **D14** (Task 8). Expect never "unreliable" below 10 answers; the side rule; a new text or model resets to "confirm".
7. **Better or worse** (Task 9). Expect an unreliable criterion that differs to leave the example "same" and to be named; a not-checked criterion never to fail a try; Part 2's verdicts untouched in the DB.
8. **Exact checks** (Task 3). Expect quotes found across spacing and quote marks, list markers and single digits ignored, IBAN and Luhn checked, no false phone numbers on dates.
9. **Links** (Task 4). Expect private addresses refused, http tried as https, at most 20 links, a 15 s timeout.
10. **Design guards** (Tasks 16–23): no new `ui-design-language` failure.

---

## File structure

**New files**

| File | Responsibility |
|---|---|
| `src/core/workflow-tests/schema.mjs` | The workflow-tests DDL, v96–v99 (P4-Q13); pure strings. |
| `src/shared/workflow-tests/criteria.mjs` | D86, D95: criteria and the checking model normalised; the criterion key; agreement and trust marks. Pure, browser-safe. |
| `src/shared/workflow-tests/criteria-verdicts.mjs` | D98: a criterion's result on one try, the combined status, the second reading with unreliable criteria. Pure. |
| `src/shared/workflow-tests/criteria-text.mjs` | All Part 4 copy (P4-C1–C7, board words). Pure. |
| `src/shared/workflow-tests/exact-checks.mjs` | D93, D94: quotes, numbers, personal data, links in a text; the exact alternative of a criterion. Pure. |
| `src/shared/workflow-tests/criteria-report.mjs` | D99, board 13, boards 1 and 5: Compare by criterion, the trust report, the checking summaries. Pure. |
| `src/core/workflow-tests/sources-text.mjs` | D93: an example's request, answers and UTF-8 files as one text. |
| `src/core/workflow-tests/link-check.mjs` | D93 links (P4-Q9). |
| `src/core/workflow-tests/judge-prompt.mjs` | D89, D100, D104: the prompts, reply parsing, the proof search, `mockJudgement`. Pure. |
| `src/core/workflow-tests/judge.mjs` | D88: the model call, `judgeCriterion`, `judgePair`. |
| `src/core/workflow-tests/criteria-store.mjs` | D106: judgements, answers, rounds, the liked result; a run's judge spend. |
| `src/core/workflow-tests/criteria-runner.mjs` | D91, D100: judging a try, the criteria phase. |
| `src/core/workflow-tests/criteria-read.mjs` | D95, D98: trust per key and model; tries with their criteria; Compare's notes. |
| `src/core/workflow-tests/judge-models.mjs` | D87, D105: the "Checked with" list and its suggestion. |
| `src/core/workflow-tests/planted.mjs` | D97: deterministic plants, padding, the planting prompt. Pure. |
| `src/core/workflow-tests/checker.mjs` | D97: Check the checker rounds. |
| `src/core/workflow-tests/suggest.mjs` | D102, D104: suggested criteria, clearer words. |
| `src/core/workflow-tests/criteria-routes.mjs` | Part 4's routes and `CRITERIA_ROUTES`. |
| `ui/public/workflows/criteria-editor.mjs` | Boards 2, 32: the criteria section, "Checked with", "A result you liked". |
| `ui/public/workflows/criteria-rows.mjs` | Boards 6, 36: the criteria rows side by side, Agree / Disagree, the pair block. |
| `ui/public/workflows/criteria-pages.mjs` | Boards 11, 12, 13: Check the checker, Compare by criterion, the trust report. |
| Tests | `test/db-migrate-v99.test.mjs`, `test/workflow-test-criteria.test.mjs`, `test/workflow-test-exact-checks.test.mjs`, `test/workflow-test-link-check.test.mjs`, `test/workflow-test-judge-spend.test.mjs`, `test/workflow-test-judge.test.mjs`, `test/workflow-test-criteria-runner.test.mjs`, `test/workflow-test-trust.test.mjs`, `test/workflow-test-criteria-verdicts.test.mjs`, `test/workflow-test-judge-models.test.mjs`, `test/workflow-test-checker.test.mjs`, `test/workflow-test-pair.test.mjs`, `test/workflow-test-liked.test.mjs`, `test/workflow-test-suggest.test.mjs`, `test/workflow-test-criteria-report.test.mjs`, `test/api-workflow-test-criteria.test.mjs`, `test/api-workflow-test-criteria-flag-off.test.mjs`, `test/ui-workflow-test-criteria-list.test.mjs`, `test/ui-workflow-test-criteria-editor.test.mjs`, `test/ui-workflow-test-exact-dialog.test.mjs`, `test/ui-workflow-test-criteria-rows.test.mjs`, `test/ui-workflow-test-by-criterion.test.mjs`, `test/ui-workflow-test-checker.test.mjs`, `test/ui-workflow-test-trust-report.test.mjs`, `test/ui-workflow-test-liked-suggest.test.mjs`. |

**Modified files**

| File | Change |
|---|---|
| `src/core/db.mjs` | `SCHEMA_VERSION = 99`; imports the DDL from `schema.mjs` (the three v96–v98 constants move out); the v99 rung; `INCREMENTAL_TABLES` / `INCREMENTAL_COLUMNS` entries. |
| `src/core/cost-budget.mjs` | `recordTestJudgeCost`, `testJudgeWindowedSpendUsd`, in `totalWindowSpendUsd` and `allTimeSpendUsd`. |
| `src/core/stats.mjs` | `budgetWindowSavings` subtracts judge spend. |
| `src/shared/workflow-tests/checks.mjs` | The four kinds, `said`, `runCheck({ sources })`, `PART4_KINDS`. |
| `src/shared/workflow-tests/compare.mjs` | `missCounts` counts deciding criteria; `estimateOf` adds criteria cost. |
| `src/core/workflow-tests/store.mjs` | `criteria`, `judge`, `liked` on an example; `deleteExample` clears Part 4 rows; `spentOfRun` adds the judge ledger. |
| `src/core/workflow-tests/result.mjs` | `checkTry` passes sources, runs links; `readTryPatch`. |
| `src/core/workflow-tests/runner.mjs` | The criteria call after a try's checks; the criteria phase. |
| `src/core/workflow-tests/routes.mjs` | The runner's criteria deps; the overview's trust summary; the plan's criteria estimate. |
| `src/core/workflow-tests/service.mjs` | `saveExample` stores the suggested model; tries read with their criteria (three call sites); `tryChanges` reads through `readTryPatch`. |
| `ui/routes/workflows/workflow-tests.mjs` | Registers `criteria-routes.mjs`. |
| `ui/public/workflows/{tests-view,tests-app,example-editor,test-dialogs,test-compare}.mjs`, `workflow-tests.css` | Wiring of the new views. |
| `docs/storage.md`, `docs/costs.md`, `docs/feature-flags.md`, `docs/ui-levels.md`, `docs/workflows.md`, `docs/changelog/unreleased.md`, `plans/workflow-tests-plan.md` | Task 24. |

---

## Task 0: Baseline (no commit)

- [ ] **Step 1: Check the worktree**

Run (PowerShell):
```powershell
cd C:\Users\BRT1BG\worca-cc\worca-cc-tests4
git status --short --branch
git log -1 --format=%H
Select-String -Path src\core\db.mjs -Pattern "export const SCHEMA_VERSION"
node --version; claude --version
```
Expected: `## feat/workflow-tests-part4`, clean (or only this plan); `3b045d0a8…` (or a later commit of this branch); `SCHEMA_VERSION = 98`; Node ≥ 22.13. If `node_modules` is missing, link it as 3b did: `cmd /c mklink /J C:\Users\BRT1BG\worca-cc\worca-cc-tests4\node_modules C:\Users\BRT1BG\worca-cc\worca-cc-dev\node_modules`.

Write the base commit to `C:\Users\BRT1BG\worca-cc\worca-cc-tests4\.superpowers\sdd\base-4.txt`.

- [ ] **Step 2: Re-find every cited place**

Run:
```powershell
Select-String -Path src\core\requirements\interview.mjs -Pattern "export function interviewCallOptions|export async function callModel"
Select-String -Path src\core\helper-call\index.mjs -Pattern "export async function helperCall"
Select-String -Path src\core\cost-budget.mjs -Pattern "export function totalWindowSpendUsd|export function designWindowedSpendUsd|allTimeSpendUsd"
Select-String -Path src\core\stats.mjs -Pattern "export function budgetWindowSavings|const NOT_TEST"
Select-String -Path src\core\workflow-tests\store.mjs -Pattern "export function spentOfRun|export function deleteExample|const EX_COLS|export function exampleFingerprint"
Select-String -Path src\core\workflow-tests\runner.mjs -Pattern "const verdict = await deps.judge|await Promise.allSettled\(\[...inflight\]\)"
Select-String -Path src\core\workflow-tests\service.mjs -Pattern "function modelInput|export async function sideBySide|function cellOf|export async function tryChanges|export async function saveExample"
Select-String -Path ui\public\workflows\example-editor.mjs -Pattern "const resultKinds = CHECK_KINDS|sect.append\(el\(doc, 'p', 'wft-grp', 'Automatic checks'\)"
Select-String -Path src\core\db.mjs -Pattern "const WORKFLOW_REVISIONS_DDL|const WORKFLOW_TESTS_DDL|const WORKFLOW_TEST_PROJECTS_DDL|if \(current < 98\)"
```
Expected: each found once. Write the line numbers into `base-4.txt`. If a function changed shape (not only moved), tell the controller before Task 1.

- [ ] **Step 3: Record the full-suite baseline** (about 45–60 minutes; run in the background)

```powershell
node C:\Users\BRT1BG\worca-cc\worca-cc-dev\.superpowers\keep\run-files.mjs C:\Users\BRT1BG\worca-cc\worca-cc-tests4 C:\Users\BRT1BG\worca-cc\worca-cc-tests4\.superpowers\sdd\baseline-4 4 300
```
Expected: about 170–190 failing tests in a few dozen files. Write the failing file names to `.superpowers\sdd\baseline-4-failing.txt`.

- [ ] **Step 4: Quick baseline of the files this part touches**

```powershell
node tools/test.mjs test/db-migrate-v98.test.mjs test/workflow-test-store.test.mjs test/workflow-test-checks.test.mjs test/workflow-test-result.test.mjs test/workflow-test-runner.test.mjs test/workflow-test-compare.test.mjs test/workflow-test-routes.test.mjs test/api-workflow-tests.test.mjs test/api-workflow-tests-flag-off.test.mjs test/ui-workflow-tests-view.test.mjs test/ui-workflow-test-compare.test.mjs test/ui-workflow-test-dialogs.test.mjs test/requirements-interview.test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs test/ui-ship-words.test.mjs
```
Expected: all pass except the known `ui-design-language` failures. Note any other failure in `baseline-4-failing.txt` with "(focused)".

---

## Task 1: Schema v99, and the workflow-tests DDL in its own module (D106, P4-Q13)

**Files:**
- Create: `src/core/workflow-tests/schema.mjs`
- Modify: `src/core/db.mjs` (`SCHEMA_VERSION`, the three DDL constants move out, `INCREMENTAL_TABLES`, `INCREMENTAL_COLUMNS`, the v99 rung)
- Test: `test/db-migrate-v99.test.mjs`
- Docs: `docs/storage.md` ("Your criteria (v99)")

**Interfaces:**
- Produces: `WORKFLOW_REVISIONS_DDL`, `WORKFLOW_TESTS_DDL`, `WORKFLOW_TEST_PROJECTS_DDL`, `WORKFLOW_TEST_CRITERIA_DDL` (strings), `WORKFLOW_TEST_TABLES` (table name → its DDL, v96–v99), `WORKFLOW_TEST_CRITERIA_COLUMNS` (`{ wf_test_examples: { criteria, judge } }`). Tables `wf_test_judgements`, `wf_test_judge_answers`, `wf_test_checker_rounds`, `wf_test_liked`, `wf_test_judge_ledger`, columns exactly as in Step 3.

- [ ] **Step 1: Write the failing migration test**

Create `test/db-migrate-v99.test.mjs`:
```js
// test/db-migrate-v99.test.mjs — workflow tests, Part 4 (plans/workflow-tests-part4-plan.md Task 1): your criteria, checked by
// Worca. Five tables (judgements, answers, Check the checker rounds, the result you liked, the judge ledger) and the example's
// criteria and checking model. A DB stamped by any earlier state reaches the current version complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const stamp = (db) => db.prepare('PRAGMA user_version').get().user_version;
function shape(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const out = {};
  for (const { name } of tables) out[name] = cols(db, name).sort();
  out['#indexes'] = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  return out;
}
const FRESH = (() => { const db = new DatabaseSync(':memory:'); migrate(db); return shape(db); })();
const NEW_TABLES = ['wf_test_judgements', 'wf_test_judge_answers', 'wf_test_checker_rounds', 'wf_test_liked', 'wf_test_judge_ledger'];
const NO_99 = `${NEW_TABLES.map((t) => `DROP TABLE ${t};`).join(' ')}
  ALTER TABLE wf_test_examples DROP COLUMN criteria; ALTER TABLE wf_test_examples DROP COLUMN judge;`;
const NO_WORKFLOW_TESTS = 'DROP TABLE wf_test_example_projects; DROP TABLE wf_test_run_tries; DROP TABLE wf_test_tries; DROP TABLE wf_test_runs; '
  + 'DROP TABLE wf_test_example_files; DROP TABLE wf_test_examples; ALTER TABLE pipelines DROP COLUMN is_test; '
  + 'DROP TABLE workflow_revisions; ALTER TABLE workflows DROP COLUMN live_version_no;';
const addExample = (db) => db.prepare(`INSERT INTO wf_test_examples (workflow_id, name, created_at, updated_at)
  VALUES ('wf_a', 'Example one', '2026-11-19T00:00:00Z', '2026-11-19T00:00:00Z')`).run();

test('fresh DB: the Part 4 tables and the example columns exist', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.equal(SCHEMA_VERSION, 99);
  assert.deepEqual(cols(db, 'wf_test_judgements'), ['id', 'workflow_id', 'example_id', 'criterion_id', 'criterion_fp', 'model', 'purpose',
    'try_id', 'other_try_id', 'round_id', 'card', 'variant', 'subject', 'met', 'winner', 'reason', 'proof', 'proof_found', 'error',
    'cost_usd', 'ms', 'created_at']);
  assert.deepEqual(cols(db, 'wf_test_judge_answers'), ['id', 'judgement_id', 'by_key', 'agree', 'created_at']);
  assert.deepEqual(cols(db, 'wf_test_checker_rounds'), ['id', 'workflow_id', 'example_id', 'criterion_id', 'criterion_fp', 'model',
    'source', 'status', 'detail', 'created_by', 'created_at', 'finished_at']);
  assert.deepEqual(cols(db, 'wf_test_liked'), ['example_id', 'kind', 'name', 'data', 'sha256', 'size', 'from_pipeline', 'created_at']);
  assert.deepEqual(cols(db, 'wf_test_judge_ledger'), ['id', 'workflow_id', 'example_id', 'test_run_id', 'round_id', 'purpose', 'model',
    'engine', 'amount_usd', 'cost_kind', 'ts']);
  for (const c of ['criteria', 'judge']) assert.ok(cols(db, 'wf_test_examples').includes(c), c);
  addExample(db);
  assert.equal(db.prepare('SELECT criteria FROM wf_test_examples').get().criteria, '[]', 'criteria default to an empty list');
});

test('a DB at 98 (Part 3b) gains the Part 4 tables and columns, keeps its examples and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  addExample(db);
  db.exec(`${NO_99} PRAGMA user_version = 98`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual({ ...db.prepare('SELECT name, criteria FROM wf_test_examples').get() }, { name: 'Example one', criteria: '[]' });
});

test("a DB at dev's 95 (no workflow tests at all) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${NO_99} ${NO_WORKFLOW_TESTS} PRAGMA user_version = 95`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH);
});

test('a DB at 98 missing one v99 table and one column after a partial cut is repaired', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE wf_test_liked; ALTER TABLE wf_test_examples DROP COLUMN judge; PRAGMA user_version = 98');
  migrate(db);
  assert.deepEqual(shape(db), FRESH);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/db-migrate-v99.test.mjs`
Expected: FAIL (`SCHEMA_VERSION` is 98; `no such table: wf_test_judgements`).

- [ ] **Step 3: Write `src/core/workflow-tests/schema.mjs`**

Move three constants out of `src/core/db.mjs` **verbatim, with their comments**, each as `export const`: `WORKFLOW_REVISIONS_DDL` (the `// v96 …` comment and the constant, `db.mjs:1524-1543` at the base), `WORKFLOW_TESTS_DDL` (`// v97 …`, `:1638-1716`) and `WORKFLOW_TEST_PROJECTS_DDL` (`// v98 …`, `:1718-1736`). The file is:
```js
// src/core/workflow-tests/schema.mjs — the workflow-tests DDL (v96–v99), moved out of db.mjs (plans/workflow-tests-part4-plan.md
// P4-Q13: db.mjs is over its size cap). Pure strings, no imports: db.mjs imports this module, never the other way round.

// ← here the three moved constants, unchanged except for `export`

// v99 (plans/workflow-tests-part4-plan.md D86–D106): your criteria, checked by Worca. FK-free like v97: store.deleteExample
// deletes an example's judgements, answers, rounds and liked result; the ledger stays (spend never goes back).
// wf_test_judgements: one row per model answer (a try's criterion, a Check the checker card and its repeats, a pair).
//   purpose 'try' | 'real' | 'planted' | 'again' | 'padded' | 'pair'; met 1 | 0 | NULL (not counted); winner (pairs) a | b | tie | unsure.
// wf_test_judge_answers: the person's Agree / Disagree (agree 1 | 0), one per person (by_key '' = no identity) and answer.
// wf_test_checker_rounds: status 'making' | 'ready' | 'failed' | 'done'; source = JSON { kind, tryId?, pipelineId?, label }.
// wf_test_liked: kind 'text' | 'changes'. wf_test_judge_ledger: every paid Part 4 call (D92), counted in the spending limit.
export const WORKFLOW_TEST_CRITERIA_DDL = `
CREATE TABLE IF NOT EXISTS wf_test_judgements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id  TEXT NOT NULL,
  example_id   INTEGER NOT NULL,
  criterion_id TEXT,
  criterion_fp TEXT NOT NULL,
  model        TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  try_id       INTEGER,
  other_try_id INTEGER,
  round_id     INTEGER,
  card         INTEGER,
  variant      TEXT,
  subject      TEXT,
  met          INTEGER,
  winner       TEXT,
  reason       TEXT,
  proof        TEXT,
  proof_found  INTEGER,
  error        TEXT,
  cost_usd     REAL NOT NULL DEFAULT 0,
  ms           INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_test_judgements_try ON wf_test_judgements (try_id, criterion_fp, model);
CREATE INDEX IF NOT EXISTS idx_wf_test_judgements_key ON wf_test_judgements (workflow_id, criterion_fp, model);
CREATE INDEX IF NOT EXISTS idx_wf_test_judgements_round ON wf_test_judgements (round_id);
CREATE TABLE IF NOT EXISTS wf_test_judge_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  judgement_id INTEGER NOT NULL,
  by_key       TEXT NOT NULL DEFAULT '',
  agree        INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (judgement_id, by_key)
);
CREATE TABLE IF NOT EXISTS wf_test_checker_rounds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id  TEXT NOT NULL,
  example_id   INTEGER NOT NULL,
  criterion_id TEXT NOT NULL,
  criterion_fp TEXT NOT NULL,
  model        TEXT NOT NULL,
  source       TEXT NOT NULL,
  status       TEXT NOT NULL,
  detail       TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_test_checker_rounds_key ON wf_test_checker_rounds (workflow_id, criterion_fp, model);
CREATE TABLE IF NOT EXISTS wf_test_liked (
  example_id    INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  data          BLOB NOT NULL,
  sha256        TEXT NOT NULL,
  size          INTEGER NOT NULL,
  from_pipeline TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wf_test_judge_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  example_id  INTEGER,
  test_run_id INTEGER,
  round_id    INTEGER,
  purpose     TEXT NOT NULL,
  model       TEXT,
  engine      TEXT,
  amount_usd  REAL NOT NULL,
  cost_kind   TEXT,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_test_judge_ledger_ts ON wf_test_judge_ledger (ts);
CREATE INDEX IF NOT EXISTS idx_wf_test_judge_ledger_run ON wf_test_judge_ledger (test_run_id);`;

/** Every workflow-tests table and the DDL that makes it (db.mjs INCREMENTAL_TABLES: reconcile-safe on any stamp). */
export const WORKFLOW_TEST_TABLES = Object.freeze({
  workflow_revisions: WORKFLOW_REVISIONS_DDL,      // v96 (Part 1, #721)
  wf_test_examples: WORKFLOW_TESTS_DDL,            // v97 (Part 2)
  wf_test_example_files: WORKFLOW_TESTS_DDL,
  wf_test_runs: WORKFLOW_TESTS_DDL,
  wf_test_tries: WORKFLOW_TESTS_DDL,
  wf_test_run_tries: WORKFLOW_TESTS_DDL,
  wf_test_example_projects: WORKFLOW_TEST_PROJECTS_DDL,   // v98 (3a)
  wf_test_judgements: WORKFLOW_TEST_CRITERIA_DDL,  // v99 (Part 4)
  wf_test_judge_answers: WORKFLOW_TEST_CRITERIA_DDL,
  wf_test_checker_rounds: WORKFLOW_TEST_CRITERIA_DDL,
  wf_test_liked: WORKFLOW_TEST_CRITERIA_DDL,
  wf_test_judge_ledger: WORKFLOW_TEST_CRITERIA_DDL,
});

/** v99: the example's criteria (JSON list, D86) and checking model (JSON { model }, D87), for db.mjs INCREMENTAL_COLUMNS. */
export const WORKFLOW_TEST_CRITERIA_COLUMNS = Object.freeze({
  wf_test_examples: Object.freeze({ criteria: "TEXT NOT NULL DEFAULT '[]'", judge: 'TEXT' }),
});
```

- [ ] **Step 4: Wire it into `src/core/db.mjs`**

1. Delete the three moved blocks. Add beside the other imports at the top:
```js
import { WORKFLOW_REVISIONS_DDL, WORKFLOW_TESTS_DDL, WORKFLOW_TEST_PROJECTS_DDL, WORKFLOW_TEST_CRITERIA_DDL, WORKFLOW_TEST_TABLES,
  WORKFLOW_TEST_CRITERIA_COLUMNS } from './workflow-tests/schema.mjs';
```
2. `export const SCHEMA_VERSION = 99;`
3. In `INCREMENTAL_COLUMNS`, after the `wf_test_tries` entry:
```js
  ...WORKFLOW_TEST_CRITERIA_COLUMNS,   // v99 (workflow tests Part 4): wf_test_examples.criteria, .judge
```
4. In `INCREMENTAL_TABLES`, replace the seven lines from `workflow_revisions: WORKFLOW_REVISIONS_DDL,` to `wf_test_example_projects: WORKFLOW_TEST_PROJECTS_DDL,` with:
```js
  ...WORKFLOW_TEST_TABLES,   // v96–v99 (workflow tests, src/core/workflow-tests/schema.mjs)
```
5. After the v98 rung (`if (current < 98) { … }`):
```js
    // v99 workflow tests Part 4 (your criteria, checked by Worca). IF NOT EXISTS; the repair adds wf_test_examples.criteria and
    // .judge (INCREMENTAL_COLUMNS) to the v97 table, as v98 did for wf_test_tries.
    if (current < 99) { db.exec(WORKFLOW_TEST_CRITERIA_DDL); repairSchemaGaps(db, schemaGaps(db)); }
```
If `schemaGaps` reads `INCREMENTAL_COLUMNS[table]` with `Object.entries`, the frozen inner object works as is; check the repair's loop at `db.mjs` "function schemaGaps" and keep it unchanged.

- [ ] **Step 5: Run the tests**

Run: `node tools/test.mjs test/db-migrate-v99.test.mjs test/db-migrate-v98.test.mjs test/db-migrate-v97.test.mjs test/db-migrate-v96.test.mjs`
Expected: PASS. `(Get-Content src\core\db.mjs).Count` is below 3135 (about 3050).

- [ ] **Step 6: Docs**

In `docs/storage.md`, after the section "### Workflow tests on a project (v98)", add:
```markdown
### Your criteria (v99)

Behind the flag `workflowTests`, like v97. FK-free. The DDL of every workflow-tests table lives in
`src/core/workflow-tests/schema.mjs`.

- `wf_test_examples` gains `criteria` (JSON: up to 12 `{ id, text }` sentences a good result makes true) and `judge` (JSON
  `{ model }`: the AI model that checks them, chosen per example). Neither is part of the example fingerprint: changing them
  checks the stored tries again and never runs the workflow again.
- `wf_test_judgements`: one row per answer of the checking model: a try's criterion (`purpose 'try'`), a Check the checker card
  (`real`, `planted`) and its repeats (`again`, `padded`), or a pair of tries (`pair`, with `winner`). It keeps the criterion's
  fingerprint (its words, normalised) and the model, met or not (NULL = not counted, with `error`), the reason, the proof quote
  and whether Worca found it in the result, and what the call cost.
- `wf_test_judge_answers`: the person's Agree or Disagree on one answer (one per person). They decide how far Worca's checking
  of a criterion is trusted.
- `wf_test_checker_rounds`: one Check the checker round: the criterion, the model, the good result it started from, its status.
- `wf_test_liked`: an example's result you liked (a text, or a project example's changes), at most 2 MB.
- `wf_test_judge_ledger`: every paid Part 4 call (checking criteria, pairs, Check the checker, suggestions, clearer words).
  It counts toward the spending limit and toward the test's own cost limit; Statistics does not show it. Deleting an example
  never deletes these rows.
```

- [ ] **Step 7: Commit**

```bash
git add src/core/workflow-tests/schema.mjs src/core/db.mjs test/db-migrate-v99.test.mjs docs/storage.md
git commit -m "feat(workflow-tests): schema v99 for your criteria; workflow-tests DDL in its own module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Criteria and the checking model on an example (D86, D87)

**Files:**
- Create: `src/shared/workflow-tests/criteria.mjs` (the normalising half; Task 8 adds trust)
- Modify: `src/core/workflow-tests/store.mjs` (`normaliseExample`, `EX_COLS`, `exampleOf`, `createExample`, `updateExample`, `deleteExample`)
- Test: `test/workflow-test-criteria.test.mjs`

**Interfaces:**
- Consumes: `normText` (`src/shared/workflow-tests/checks.mjs:97`); the v99 columns (Task 1).
- Produces: `CRITERIA_MAX = 12`, `CRITERION_MIN = 3`, `CRITERION_MAX = 300`, `criterionText(s) → string`, `criterionKey(s) → string`, `normaliseCriteria(raw, newId) → { criteria: [{ id, text }] | null, error }`, `normaliseJudge(raw) → { judge: { model } | null, error }`. An example read from the store has `criteria: [{ id, text }]` and `judge: { model } | null`; its `fingerprint` ignores both.

- [ ] **Step 1: Write the failing test**

Create `test/workflow-test-criteria.test.mjs`:
```js
// test/workflow-test-criteria.test.mjs — Part 4 (plans/workflow-tests-part4-plan.md D86, D87): an example's criteria and its
// checking model; neither changes the example fingerprint, so tries stay reusable.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, prepare } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { normaliseCriteria, normaliseJudge, criterionKey, CRITERIA_MAX } from '../src/shared/workflow-tests/criteria.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftcrit-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const WF = 'wf_brief';
let n = 0;
const newId = () => `k_${String(++n).padStart(10, '0')}`;

test('normaliseCriteria: trims, drops empty rows, keeps ids, refuses twins, short, long and too many', () => {
  const r = normaliseCriteria([{ text: '  Names a success   metric ' }, { text: '' }, { id: 'k_abc', text: 'Quotes customers' }], newId);
  assert.equal(r.error, null);
  assert.deepEqual(r.criteria.map((c) => c.text), ['Names a success metric', 'Quotes customers']);
  assert.match(r.criteria[0].id, /^k_\d{10}$/);
  assert.equal(r.criteria[1].id, 'k_abc');
  assert.deepEqual(normaliseCriteria(undefined, newId), { criteria: [], error: null });
  assert.equal(normaliseCriteria([{ text: 'Names a metric.' }, { text: 'names  a METRIC' }], newId).error, '"names a METRIC" is there twice');
  assert.equal(normaliseCriteria([{ text: 'ab' }], newId).error, 'each criterion must be 3 to 300 characters');
  assert.equal(normaliseCriteria([{ text: 'x'.repeat(301) }], newId).error, 'each criterion must be 3 to 300 characters');
  assert.equal(normaliseCriteria(Array.from({ length: CRITERIA_MAX + 1 }, (_, i) => ({ text: `Criterion number ${i}` })), newId).error, 'at most 12 criteria');
  assert.equal(normaliseCriteria('Names a metric', newId).error, 'criteria must be a list');
  assert.equal(criterionKey('Names a “success” metric.'), 'names a "success" metric');
});

test('normaliseJudge: a model id or nothing', () => {
  assert.deepEqual(normaliseJudge({ model: 'claude-opus-5-5' }), { judge: { model: 'claude-opus-5-5' }, error: null });
  assert.deepEqual(normaliseJudge(null), { judge: null, error: null });
  assert.equal(normaliseJudge({ model: 'bad model!' }).error, 'pick the AI model that checks your criteria');
});

test('the store keeps criteria and the checking model, and the fingerprint ignores both', () => {
  const plain = store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.' });
  assert.deepEqual([plain.criteria, plain.judge], [[], null]);
  const up = store.updateExample(WF, plain.id, { criteria: [{ text: 'Names a success metric with a number' }], judge: { model: 'claude-opus-5-5' } });
  assert.equal(up.criteria.length, 1);
  assert.match(up.criteria[0].id, /^k_[0-9a-f]{10}$/);
  assert.deepEqual(up.judge, { model: 'claude-opus-5-5' });
  assert.equal(up.fingerprint, plain.fingerprint, 'criteria are not part of what a try depends on (D86)');
  const kept = store.updateExample(WF, plain.id, { name: 'Bulk export' });
  assert.deepEqual([kept.criteria[0].id, kept.judge.model], [up.criteria[0].id, 'claude-opus-5-5'], 'fields left out keep their value');
  assert.throws(() => store.updateExample(WF, plain.id, { criteria: [{ text: 'no' }] }), { code: 'BAD_REQUEST', message: 'each criterion must be 3 to 300 characters' });
});

test('deleting an example deletes its judgements, answers, rounds and liked result, never the ledger', () => {
  const ex = store.createExample(WF, { name: 'E', request: 'R', criteria: [{ text: 'Names a metric' }], judge: { model: 'claude-opus-5-5' } });
  const at = '2026-11-19T00:00:00Z';
  const j = prepare(`INSERT INTO wf_test_judgements (workflow_id, example_id, criterion_fp, model, purpose, created_at)
    VALUES (?, ?, 'fp', 'claude-opus-5-5', 'try', ?)`).run(WF, ex.id, at);
  prepare("INSERT INTO wf_test_judge_answers (judgement_id, agree, created_at) VALUES (?, 1, ?)").run(j.lastInsertRowid, at);
  prepare(`INSERT INTO wf_test_checker_rounds (workflow_id, example_id, criterion_id, criterion_fp, model, source, status, created_at)
    VALUES (?, ?, 'k_1', 'fp', 'm', '{}', 'done', ?)`).run(WF, ex.id, at);
  prepare("INSERT INTO wf_test_liked (example_id, kind, name, data, sha256, size, created_at) VALUES (?, 'text', 'a.md', x'61', 'h', 1, ?)").run(ex.id, at);
  prepare("INSERT INTO wf_test_judge_ledger (workflow_id, example_id, purpose, amount_usd, ts) VALUES (?, ?, 'try', 0.02, 1)").run(WF, ex.id);
  store.deleteExample(WF, ex.id);
  for (const t of ['wf_test_judgements', 'wf_test_judge_answers', 'wf_test_checker_rounds', 'wf_test_liked']) {
    assert.equal(prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger').get().n, 1, 'spend never goes back');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-criteria.test.mjs`
Expected: FAIL (`Cannot find module …/criteria.mjs`).

- [ ] **Step 3: Write `src/shared/workflow-tests/criteria.mjs`**

```js
// src/shared/workflow-tests/criteria.mjs — Part 4 (plans/workflow-tests-part4-plan.md D86, D87, D95): an example's criteria and
// its checking model, checked; the key two criteria compare by and trust is kept by. Pure and browser-safe.
import { normText } from './checks.mjs';

export const CRITERIA_MAX = 12;
export const CRITERION_MIN = 3;
export const CRITERION_MAX = 300;
const CRIT_ID_RE = /^k_[a-z0-9]{1,24}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

/** The words as shown: single spaces, trimmed. */
export const criterionText = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
/** How two criteria compare, and what trust is kept by (D95): normText without a closing full stop or exclamation mark. */
export const criterionKey = (s) => normText(criterionText(s)).replace(/[.!]+$/, '').trim();

/**
 * D86. An empty row (the editor's new line left blank) is dropped; a criterion without an id gets `newId()`.
 * @param {unknown} raw the request's list (missing = none)
 * @param {() => string} newId
 * @returns {{criteria: Array<{id: string, text: string}>|null, error: string|null}}
 */
export function normaliseCriteria(raw, newId) {
  if (raw === undefined || raw === null) return { criteria: [], error: null };
  if (!Array.isArray(raw)) return { criteria: null, error: 'criteria must be a list' };
  const out = [];
  const seen = new Set();
  for (const c of raw) {
    const text = criterionText(c && typeof c === 'object' ? c.text : c);
    if (!text) continue;
    if (text.length < CRITERION_MIN || text.length > CRITERION_MAX) {
      return { criteria: null, error: `each criterion must be ${CRITERION_MIN} to ${CRITERION_MAX} characters` };
    }
    const key = criterionKey(text);
    if (seen.has(key)) return { criteria: null, error: `"${text}" is there twice` };
    seen.add(key);
    out.push({ id: c && typeof c === 'object' && CRIT_ID_RE.test(String(c.id || '')) ? c.id : newId(), text });
  }
  if (out.length > CRITERIA_MAX) return { criteria: null, error: `at most ${CRITERIA_MAX} criteria` };
  return { criteria: out, error: null };
}

/** D87: `{ model }` or null. Whether the model is one of the catalog's Claude models is the server's check (judge-models.mjs). */
export function normaliseJudge(raw) {
  if (raw === undefined || raw === null || raw === '') return { judge: null, error: null };
  const model = raw && typeof raw === 'object' ? String(raw.model || '').trim() : '';
  if (!MODEL_RE.test(model)) return { judge: null, error: 'pick the AI model that checks your criteria' };
  return { judge: { model }, error: null };
}
```

- [ ] **Step 4: Store the two fields**

In `src/core/workflow-tests/store.mjs`:
1. Import: `import { normaliseCriteria, normaliseJudge } from '../../shared/workflow-tests/criteria.mjs';`
2. In `normaliseExample`, before `if (errors.length) return …`:
```js
  // Part 4 (D86, D87): not part of the fingerprint below, so a changed criterion re-checks tries and never re-runs them.
  const { criteria, error: criteriaError } = normaliseCriteria(input.criteria, () => `k_${randomBytes(5).toString('hex')}`);
  if (criteriaError) errors.push(criteriaError);
  const { judge, error: judgeError } = normaliseJudge(input.judge);
  if (judgeError) errors.push(judgeError);
```
and return `{ value: { name, request, answers, otherwise, basics, checks, tries, note, criteria, judge }, errors: [] }`.
3. `EX_COLS`: add `criteria, judge` after `note`.
4. `exampleOf`: add `criteria: parse(r.criteria, []), judge: parse(r.judge, null),` after `note`. `exampleFingerprint` is unchanged.
5. `createExample`: add the two columns to the `INSERT` (after `note`) and `JSON.stringify(value.criteria), value.judge ? JSON.stringify(value.judge) : null` to its values.
6. `updateExample`: add `criteria = ?, judge = ?` to the `UPDATE` (after `note = ?`) with the same two values.
7. `deleteExample`, inside its `tx`, before the example row's delete:
```js
    // Part 4 (D106): its judgements, answers, rounds and liked result go with it; wf_test_judge_ledger stays (spend never goes back).
    prepare('DELETE FROM wf_test_judge_answers WHERE judgement_id IN (SELECT id FROM wf_test_judgements WHERE example_id = ?)').run(ex.id);
    prepare('DELETE FROM wf_test_judgements WHERE example_id = ?').run(ex.id);
    prepare('DELETE FROM wf_test_checker_rounds WHERE example_id = ?').run(ex.id);
    prepare('DELETE FROM wf_test_liked WHERE example_id = ?').run(ex.id);
```

- [ ] **Step 5: Run the tests**

Run: `node tools/test.mjs test/workflow-test-criteria.test.mjs test/workflow-test-store.test.mjs test/api-workflow-tests.test.mjs`
Expected: PASS. (The API's `PUT …/examples/:ex` already passes `criteria` and `judge` through `service.saveExample` to the store.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/workflow-tests/criteria.mjs src/core/workflow-tests/store.mjs test/workflow-test-criteria.test.mjs
git commit -m "feat(workflow-tests): criteria and the checking model on an example, outside its fingerprint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The exact checks: quotes, numbers, personal data (D93, D94)

**Files:**
- Create: `src/shared/workflow-tests/exact-checks.mjs`, `src/core/workflow-tests/sources-text.mjs`
- Modify: `src/shared/workflow-tests/checks.mjs` (kinds, labels, `normaliseCheck`, `checkLabel`, `runCheck`, `said`), `src/core/workflow-tests/result.mjs` (`checkTry` passes the sources), `ui/public/workflows/example-editor.mjs` (one line: the new kinds stay out of the dialog until Task 19)
- Test: `test/workflow-test-exact-checks.test.mjs`

**Interfaces:**
- Produces (exact-checks.mjs): `normLoose(s)`, `quotesIn(text) → string[]`, `quotesCheck(text, sources) → { met, value }`, `numbersIn(text) → [{ shown, n }]`, `numbersCheck(text, sources)`, `personalData(text) → { emails, phones, ibans, cards }`, `personalCheck(text)`, `linksIn(text) → string[]`, `exactAlternative(criterion) → { kind, text? } | null`, `ibanValid(s)`, `luhnValid(digits)`.
- Produces (checks.mjs): kinds `quotes`, `numbers`, `no-personal`, `links`; `SOURCE_KINDS`, `NETWORK_KINDS`, `PART4_KINDS`; `runCheck(check, { text, files, changes, sources })`; any check may carry `said` (the criterion it replaced, D99).
- Produces (sources-text.mjs): `exampleSourcesText(example, { readFiles }) → string`.

- [ ] **Step 1: Write the failing test**

Create `test/workflow-test-exact-checks.test.mjs`:
```js
// test/workflow-test-exact-checks.test.mjs — Part 4 exact checks (plans/workflow-tests-part4-plan.md D93, D94): counted without AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotesIn, quotesCheck, numbersIn, numbersCheck, personalData, personalCheck, linksIn, exactAlternative, ibanValid, luhnValid }
  from '../src/shared/workflow-tests/exact-checks.mjs';
import { normaliseCheck, checkLabel, runCheck, CHECK_KINDS, PART4_KINDS } from '../src/shared/workflow-tests/checks.mjs';
import { exampleSourcesText } from '../src/core/workflow-tests/sources-text.mjs';

const FILES = 'Interview 3: “I export every month and it stops at 200 invoices, which is a pain.” Tickets: 140 a month, up 60 %.';

test('quotes: four words or more, found across spacing, quote marks, case and an ellipsis', () => {
  assert.deepEqual(quotesIn('She said "yes" and “I export every month and it stops” — fine.'), ['I export every month and it stops']);
  assert.deepEqual(quotesCheck('A customer: "i export  every month ... at 200 invoices".', FILES), { met: true, value: 'Met' });
  assert.deepEqual(quotesCheck('Nobody quoted.', FILES), { met: true, value: 'No quotes' });
  assert.deepEqual(quotesCheck('“I would pay twice for this tomorrow.” and «exports are slow for all of us»', FILES),
    { met: false, value: 'Not in the files: "I would pay twice for this tomorrow." and 1 more' });
});

test('numbers: separators and per cent dropped, list markers and single digits skipped', () => {
  assert.deepEqual(numbersIn('1. Problem\n## 2) Users\nWe have 1,200 users, 3 teams, 60% growth and 3.50 euros.').map((x) => x.n), ['1200', '60', '3.5']);
  assert.deepEqual(numbersCheck('Tickets: 140 a month (60%). Limit: 200.', FILES), { met: true, value: 'Met' });
  assert.deepEqual(numbersCheck('Cut tickets by 75% from 140 to 35, saving 1,000 hours.', FILES), { met: false, value: 'Not in the files: 75%, 35, 1,000' });
  assert.deepEqual(numbersCheck('No figures here, only 3 points.', FILES), { met: true, value: 'No numbers' });
});

test('personal data: e-mail, phone, IBAN and card numbers; dates and plain numbers are not phones', () => {
  assert.equal(ibanValid('DE89 3704 0044 0532 0130 00'), true);
  assert.equal(ibanValid('DE00 3704 0044 0532 0130 00'), false);
  assert.equal(luhnValid('4111111111111111'), true);
  assert.deepEqual(personalData('Write to ana@example.com or call +49 30 1234 5678. IBAN DE89 3704 0044 0532 0130 00, card 4111 1111 1111 1111.'),
    { emails: 1, phones: 1, ibans: 1, cards: 1 });
  assert.deepEqual(personalData('On 2026-11-19 we had 1,200 users and 140 tickets; ticket 4711-0042.'), { emails: 0, phones: 0, ibans: 0, cards: 0 });
  assert.deepEqual(personalCheck('ana@example.com, bo@example.org and 0049 30 1234567'), { met: false, value: 'Found 2 e-mail addresses, 1 phone number' });
});

test('links: markdown and bare, de-duplicated, closing marks dropped', () => {
  assert.deepEqual(linksIn('See [the doc](https://a.example/x) and https://a.example/x, or http://b.example/y.'),
    ['https://a.example/x', 'http://b.example/y']);
});

test('exactAlternative: board 2 and board 10 examples', () => {
  assert.deepEqual(exactAlternative('Quotes customers from the interviews, and makes up no quotes'), { kind: 'quotes' });
  assert.deepEqual(exactAlternative("Mentions that today's export stops at 200 invoices"), { kind: 'mentions', text: '200' });
  assert.deepEqual(exactAlternative('Uses only numbers from the files'), { kind: 'numbers' });
  assert.deepEqual(exactAlternative('Contains no personal data'), { kind: 'no-personal' });
  assert.equal(exactAlternative('Names a success metric with a number, and how to measure it'), null);
});

test('the four kinds as checks: normalised, labelled, run; said is kept and only when given', () => {
  for (const k of PART4_KINDS) assert.ok(CHECK_KINDS.includes(k), k);
  const q = normaliseCheck({ kind: 'quotes', said: ' Quotes  customers ' }).check;
  assert.deepEqual(q, { kind: 'quotes', said: 'Quotes customers' });
  assert.deepEqual(normaliseCheck({ kind: 'numbers', file: 'CHANGELOG.md' }).check, { kind: 'numbers', file: 'CHANGELOG.md' });
  assert.deepEqual(normaliseCheck({ kind: 'words', min: 10, max: null }).check, { kind: 'words', min: 10, max: null }, 'no said, no key');
  assert.equal(checkLabel({ kind: 'quotes' }), 'Every quote is in the files');
  assert.equal(checkLabel({ kind: 'numbers', file: 'brief.md' }), 'Numbers come from the files in brief.md');
  assert.equal(checkLabel({ kind: 'no-personal' }), 'Has no personal data');
  assert.equal(checkLabel({ kind: 'links' }), 'Every link works');
  assert.deepEqual(runCheck({ kind: 'quotes' }, { text: '"I would pay twice for this"', sources: FILES }).met, false);
  assert.deepEqual(runCheck({ kind: 'no-personal' }, { text: 'Clean text.' }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck({ kind: 'numbers' }, { text: '', sources: FILES }), { met: false, value: 'No result' });
});

test('exampleSourcesText: the request, the answers and the UTF-8 files; binary files are skipped', () => {
  const ex = { id: 1, request: 'Write the brief.', answers: [{ question: 'Formats?', answer: 'PDF and CSV.' }] };
  const text = exampleSourcesText(ex, { readFiles: () => [{ name: 'a.md', data: Buffer.from('Interview: 200 invoices') },
    { name: 'b.png', data: Buffer.from([0xff, 0xfe, 0x00, 0x81]) }] });
  assert.equal(text, 'Write the brief.\n\nFormats?\nPDF and CSV.\n\nInterview: 200 invoices');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-exact-checks.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/shared/workflow-tests/exact-checks.mjs`**

```js
// src/shared/workflow-tests/exact-checks.mjs — Part 4 exact checks (plans/workflow-tests-part4-plan.md D93, D94): what can be
// counted in a result without AI. Pure and browser-safe. Every scan is bounded (MAX_SCAN) and its regexes cannot backtrack
// badly on a try's own text (3a's final review I1).
const MAX_SCAN = 2 * 1024 * 1024;
const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const more = (n) => (n > 0 ? ` and ${n} more` : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** D89's normal form (quotes, proofs): NFKC, straight quotes and dashes, no markdown marks, single spaces, lower case. */
export function normLoose(s) {
  return String(s ?? '').normalize('NFKC').replace(/[‘’‚‛`´]/g, "'").replace(/[“”„‟«»]/g, '"').replace(/[‐‑‒–—―]/g, '-')
    .replace(/[*_#>]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
const straight = (s) => String(s ?? '').normalize('NFKC').replace(/[“”„‟«»]/g, '"');
const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Text in double quotation marks of at least four words (shorter ones are names and terms). A quote never spans a blank line. */
export function quotesIn(text, { minWords = 4 } = {}) {
  const t = straight(text).slice(0, MAX_SCAN);
  const out = [];
  let open = -1;
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] === '\n' && t[i + 1] === '\n') { open = -1; continue; }
    if (t[i] !== '"') continue;
    if (open < 0) { open = i; continue; }
    const q = t.slice(open + 1, i).trim();
    open = -1;
    if (words(q) >= minWords) out.push(q);
  }
  return out;
}

/** D93 quotes: each part of each quote (split at an ellipsis) is in the sources, in D89's normal form. */
export function quotesCheck(text, sources) {
  const quotes = quotesIn(text);
  if (!quotes.length) return { met: true, value: 'No quotes' };
  const hay = normLoose(sources);
  const bad = quotes.filter((q) => {
    const parts = normLoose(q).split(/\s*(?:\.\.\.|…)\s*/).map((p) => p.replace(/^[\s,.;:!?'"-]+|[\s,.;:!?'"-]+$/g, '')).filter((p) => p.length >= 3);
    return !parts.length || !parts.every((p) => hay.includes(p));
  });
  return bad.length ? { met: false, value: `Not in the files: "${clip(bad[0])}"${more(bad.length - 1)}` } : { met: true, value: 'Met' };
}

const NUM_RE = /(?<![\p{L}\p{N}_.,])(\d{1,3}(?:[,  ]\d{3})+|\d+)(?:[.,](\d+))?(\s?%)?/gu;
const LIST_MARK_RE = /^(\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?)\d{1,3}[.)](?=\s)/;
/** The numbers of a text: "1,200" → 1200, "3.50" → 3.5, "60 %" → 60. A list marker or numbered heading ("1.", "## 2)") and a
 *  single digit without a per cent sign are skipped. `shown` is the number as written. */
export function numbersIn(text) {
  const out = [];
  for (const raw of String(text ?? '').normalize('NFKC').slice(0, MAX_SCAN).split(/\r?\n/)) {
    const line = raw.replace(LIST_MARK_RE, (m, lead) => `${lead}${' '.repeat(m.length - lead.length)}`);
    for (const m of line.matchAll(NUM_RE)) {
      const whole = m[1].replace(/[,  ]/g, '');
      if (!m[2] && !m[3] && whole.length === 1) continue;
      out.push({ shown: m[0].trim(), n: String(Number(m[2] ? `${whole}.${m[2]}` : whole)) });
    }
  }
  return out;
}

/** D93 numbers: every number of the result is a number of the sources. */
export function numbersCheck(text, sources) {
  const nums = numbersIn(text);
  if (!nums.length) return { met: true, value: 'No numbers' };
  const have = new Set(numbersIn(sources).map((x) => x.n));
  const bad = [...new Set(nums.filter((x) => !have.has(x.n)).map((x) => x.shown))];
  return bad.length ? { met: false, value: `Not in the files: ${bad.slice(0, 3).join(', ')}${more(bad.length - 3)}` } : { met: true, value: 'Met' };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;
const PHONE_RE = /(?<![\w+])(?:\+|0)[\d ()./-]{8,22}\d(?!\w)/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;
const CARD_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
/** An IBAN passes its mod-97 check. */
export function ibanValid(s) {
  const t = String(s).replace(/ /g, '');
  if (t.length < 15 || t.length > 34) return false;
  let m = 0;
  for (const ch of t.slice(4) + t.slice(0, 4)) {
    for (const d of /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch) m = (m * 10 + Number(d)) % 97;
  }
  return m === 1;
}
/** A card number (13–19 digits) passes the Luhn check. */
export function luhnValid(digits) {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}
/** D93 no-personal: how many of each kind a text holds. A phone number starts with "+" or 0 and has 9 to 15 digits. Bank account
 *  and card numbers are found first and blanked, so their digit groups are never counted again as a phone number. */
export function personalData(text) {
  let t = String(text ?? '').normalize('NFKC').slice(0, MAX_SCAN);
  const blank = (hits) => { for (const h of hits) t = t.split(h).join(' '); return hits.length; };
  const ibans = blank((t.match(IBAN_RE) || []).filter(ibanValid));
  const cards = blank((t.match(CARD_RE) || []).filter((c) => luhnValid(c.replace(/\D/g, ''))));
  const emails = blank(t.match(EMAIL_RE) || []);
  const phones = (t.match(PHONE_RE) || []).filter((p) => { const n = p.replace(/\D/g, '').length; return n >= 9 && n <= 15; }).length;
  return { emails, phones, ibans, cards };
}
export function personalCheck(text) {
  const f = personalData(text);
  const found = [f.emails && plural(f.emails, 'e-mail address', 'e-mail addresses'), f.phones && plural(f.phones, 'phone number', 'phone numbers'),
    f.ibans && plural(f.ibans, 'bank account number', 'bank account numbers'), f.cards && plural(f.cards, 'card number', 'card numbers')].filter(Boolean);
  return found.length ? { met: false, value: `Found ${found.join(', ')}` } : { met: true, value: 'Met' };
}

/** The http(s) links of a text, markdown or bare, in order, once each; closing punctuation is not part of a link. */
export function linksIn(text) {
  const out = [];
  for (const m of String(text ?? '').slice(0, MAX_SCAN).matchAll(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi)) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** D94: an exact check that can stand in for a criterion's words, or null. */
export function exactAlternative(criterion) {
  const t = String(criterion ?? '');
  const low = t.toLowerCase();
  if (/\bquot(?:e|es|ed|ing|ation|ations)\b/.test(low)) return { kind: 'quotes' };
  if (/\bnumbers?\b/.test(low) && (/\b(?:from|in) the (?:files?|data|notes|interviews?|attachments?)\b/.test(low) || /\bmakes? up no numbers?\b/.test(low))) {
    return { kind: 'numbers' };
  }
  if (/personal data|e-?mail address|phone numbers?/.test(low)) return { kind: 'no-personal' };
  if (/\blinks?\b/.test(low)) return { kind: 'links' };
  const n = /\b(?:mentions?|says?|states?|names?|gives?)\b/.test(low) ? /(?<![\d.,])\d{2,}(?:[.,]\d+)?%?/.exec(t) : null;
  return n ? { kind: 'mentions', text: n[0] } : null;
}
```

- [ ] **Step 4: Write `src/core/workflow-tests/sources-text.mjs`**

```js
// src/core/workflow-tests/sources-text.mjs — D93: what the exact checks and the judge's context read as "the files": the example's
// request, the answers it gives Worca, and its files that are UTF-8 text (a picture or a PDF is skipped).
import { readExampleFiles } from './store.mjs';

const DECODER = new TextDecoder('utf-8', { fatal: true });
export function exampleSourcesText(example, { readFiles = readExampleFiles } = {}) {
  const parts = [example.request || '', ...(example.answers || []).map((a) => `${a.question}\n${a.answer}`)];
  for (const f of readFiles(example.id)) { try { parts.push(DECODER.decode(f.data)); } catch { /* not text */ } }
  return parts.filter((p) => p !== '').join('\n\n');
}
```

- [ ] **Step 5: The four kinds in `src/shared/workflow-tests/checks.mjs`**

1. Import: `import { quotesCheck, numbersCheck, personalCheck } from './exact-checks.mjs';`
2. Kinds and labels:
```js
export const CHECK_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions', 'file', 'script', 'command', 'under', 'unchanged', 'max-files',
  'quotes', 'numbers', 'no-personal', 'links']);
/** The kinds that read the main result's text (D25; Part 4 D93 adds three). */
export const TEXT_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions', 'quotes', 'numbers', 'no-personal']);
/** Part 4 (D93): the kinds that compare the result with the example's files and request. */
export const SOURCE_KINDS = Object.freeze(['quotes', 'numbers']);
/** Part 4 (D93): the kind that calls the web; result.mjs runs it with the commands and scripts. */
export const NETWORK_KINDS = Object.freeze(['links']);
/** Part 4's exact kinds (P4-M1: the check dialog shows them only from Task 19). */
export const PART4_KINDS = Object.freeze(['quotes', 'numbers', 'no-personal', 'links']);
```
and in `CHECK_KIND_LABELS`: `quotes: 'Every quote is in the files', numbers: 'Numbers come from the files', 'no-personal': 'No personal data', links: 'Links work',`.
3. In `normaliseCheck`, replace the `done` helper with one that keeps `said` (D99), and add the four kinds before the command branch:
```js
  // D99: a check made from a criterion keeps its words; absent otherwise, so every existing check and fingerprint stays byte for byte.
  const said = typeof raw.said === 'string' ? raw.said.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const done = (fields, file = null) => ({ check: { ...(id ? { id } : {}), kind, ...fields, ...(file ? { file } : {}), ...(said ? { said } : {}) }, error: null });
```
```js
  if (PART4_KINDS.includes(kind)) return done({}, f.file);   // D93: no fields; the text kinds may read a project file (3a Q11)
```
4. In `checkLabel`, before the final return:
```js
  if (c.kind === 'quotes') return inFile('Every quote is in the files');
  if (c.kind === 'numbers') return inFile('Numbers come from the files');
  if (c.kind === 'no-personal') return inFile('Has no personal data');
  if (c.kind === 'links') return 'Every link works';
```
5. `runCheck(check, { text = null, files = [], changes = null, sources = '' } = {})`, before the scope branch:
```js
  if (check.kind === 'quotes') return quotesCheck(text, sources);
  if (check.kind === 'numbers') return numbersCheck(text, sources);
  if (check.kind === 'no-personal') return personalCheck(text);
```
(`links` stays unknown to `runCheck`: it throws like `script`, and `checkTry` never sends it there.)

- [ ] **Step 6: Pass the sources in `checkTry`** (`src/core/workflow-tests/result.mjs`)

1. Imports: `SOURCE_KINDS, NETWORK_KINDS` from checks.mjs; `import { exampleSourcesText } from './sources-text.mjs';`
2. `checkTry(example, outcome, { …, readSources = (ex) => exampleSourcesText(ex), checkLinks = null } = {})`. `checkLinks` is wired in Task 4; here only the parameter.
3. Before the first loop: `let sources = null;` and inside the first loop, before `runCheck`:
```js
    if (SOURCE_KINDS.includes(check.kind) && sources === null) sources = readSources(example);
```
then `runCheck(check, { text, files: outcome.files, changes, sources: sources || '' })`.
4. In the first loop's opening line, send `links` to the later loop with the scripts and commands: `if (check.kind === 'script' || check.kind === 'command' || NETWORK_KINDS.includes(check.kind)) { later.push(i); continue; }`. In the later loop, until Task 4, a `links` check gives `not('Not run: link checks come later')` (Task 4 replaces it).

- [ ] **Step 7: Keep the dialog as it is** (`ui/public/workflows/example-editor.mjs:106`)

Change the `resultKinds` filter's first condition from `!PROJECT_KINDS.includes(k)` to `!PROJECT_KINDS.includes(k) && !PART4_KINDS.includes(k)` and import `PART4_KINDS`. Task 19 removes it after P4-M1.

Run `timeout 60 git grep -n "CHECK_KINDS\|TEXT_KINDS" -- test`: a test that pins either list gets the new entries (a pinned list is the test's, not product code).

- [ ] **Step 8: Run the tests**

Run: `node tools/test.mjs test/workflow-test-exact-checks.test.mjs test/workflow-test-checks.test.mjs test/workflow-test-result.test.mjs test/workflow-test-project-checks.test.mjs test/workflow-test-scope-checks.test.mjs test/ui-workflow-example-editor.test.mjs test/workflow-test-store.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/shared/workflow-tests/exact-checks.mjs src/core/workflow-tests/sources-text.mjs src/shared/workflow-tests/checks.mjs src/core/workflow-tests/result.mjs ui/public/workflows/example-editor.mjs test/workflow-test-exact-checks.test.mjs
git commit -m "feat(workflow-tests): exact checks for quotes, numbers and personal data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: "Links work" (D93, depends on P4-Q9)

**Files:**
- Create: `src/core/workflow-tests/link-check.mjs`
- Modify: `src/core/workflow-tests/result.mjs` (the later loop runs `links`), `src/core/workflow-tests/routes.mjs` (nothing: the default import is used)
- Test: `test/workflow-test-link-check.test.mjs`

**Interfaces:**
- Consumes: `httpsTransport({ url, signal, headers }) → { status, headers, destroy }` (`src/core/ask/web-fetch.mjs:183`; its default `lookup` is `guardedLookup`, which refuses private and reserved addresses); `linksIn` (Task 3).
- Produces: `LINKS_MAX = 20`, `LINK_TIMEOUT_MS = 15000`, `checkLinks(text, { transport, timeoutMs, max }) → Promise<{ met, value }>`, `linkWorks(raw, { transport, timeoutMs }) → Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `test/workflow-test-link-check.test.mjs`:
```js
// test/workflow-test-link-check.test.mjs — "Links work" (plans/workflow-tests-part4-plan.md D93, P4-Q9), with a fake transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks, linkWorks, LINKS_MAX } from '../src/core/workflow-tests/link-check.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';

const site = (routes) => {
  const seen = [];
  const transport = async ({ url }) => {
    seen.push(url.href);
    const r = routes[url.href];
    if (r instanceof Error) throw r;
    return { status: r ? r.status : 404, headers: r && r.location ? { location: r.location } : {}, destroy: () => {} };
  };
  return { transport, seen };
};

test('a link works on 2xx after at most 3 redirects; http is tried as https; private addresses fail', async () => {
  const s = site({ 'https://a.example/x': { status: 301, location: '/y' }, 'https://a.example/y': { status: 200 },
    'https://b.example/z': { status: 200 }, 'https://in.example/': Object.assign(new Error('refused'), { code: 'EWORCA_BLOCKED' }) });
  assert.equal(await linkWorks('https://a.example/x', { transport: s.transport }), true);
  assert.equal(await linkWorks('http://b.example/z', { transport: s.transport }), true);
  assert.ok(s.seen.includes('https://b.example/z'), 'http became https');
  assert.equal(await linkWorks('https://in.example/', { transport: s.transport }), false);
  assert.equal(await linkWorks('https://user:pw@a.example/x', { transport: s.transport }), false, 'no credentials in a link');
  const loop = site({ 'https://l.example/1': { status: 302, location: '/2' }, 'https://l.example/2': { status: 302, location: '/3' },
    'https://l.example/3': { status: 302, location: '/4' }, 'https://l.example/4': { status: 302, location: '/5' } });
  assert.equal(await linkWorks('https://l.example/1', { transport: loop.transport }), false);
});

test('checkLinks: no links, all fine, one broken, and at most 20 checked', async () => {
  const s = site({ 'https://a.example/x': { status: 200 } });
  assert.deepEqual(await checkLinks('No links.', { transport: s.transport }), { met: true, value: 'No links' });
  assert.deepEqual(await checkLinks('See https://a.example/x.', { transport: s.transport }), { met: true, value: 'Met' });
  assert.deepEqual(await checkLinks('https://a.example/x and https://gone.example/page', { transport: s.transport }),
    { met: false, value: 'Not working: https://gone.example/page' });
  const many = Array.from({ length: 25 }, (_, i) => `https://a.example/x?${i}`).join(' ');
  const ok = site(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`https://a.example/x?${i}`, { status: 200 }])));
  assert.deepEqual(await checkLinks(many, { transport: ok.transport }), { met: true, value: `Met · ${LINKS_MAX} of 25 checked` });
  assert.equal(ok.seen.length, LINKS_MAX);
});

test('checkTry runs a links check after the try finished, with its own checker', async () => {
  const outcome = { facts: { status: 'done', costUsd: 0 }, text: 'See https://a.example/x', files: [], name: 'r.md', source: 'work' };
  const v = await checkTry({ basics: { noError: true, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [{ id: 'c_1', kind: 'links' }] },
    outcome, { checkLinks: async () => ({ met: false, value: 'Not working: https://a.example/x' }) });
  assert.deepEqual(v.checks.map((c) => [c.label, c.met, c.value]), [['Every link works', false, 'Not working: https://a.example/x']]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-link-check.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/core/workflow-tests/link-check.mjs`**

```js
// src/core/workflow-tests/link-check.mjs — "Links work" (plans/workflow-tests-part4-plan.md D93, P4-Q9). Each link is opened through
// Ask's guarded transport: https only (http is tried as https), public addresses only (guardedLookup), the proxy env honoured, no
// cookies, no body read. Never a run's own network: Worca itself makes these calls, at check time.
import { httpsTransport } from '../ask/web-fetch.mjs';
import { linksIn } from '../../shared/workflow-tests/exact-checks.mjs';

export const LINKS_MAX = 20;
export const LINK_TIMEOUT_MS = 15_000;
const LINK_REDIRECTS = 3;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
const HEADERS = Object.freeze({ 'user-agent': 'worca-link-check/1', accept: '*/*' });
const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Whether one link answers 2xx within `timeoutMs` a hop, after at most 3 redirects. */
export async function linkWorks(raw, { transport = httpsTransport, timeoutMs = LINK_TIMEOUT_MS } = {}) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  for (let hop = 0; hop <= LINK_REDIRECTS; hop += 1) {
    if (url.protocol === 'http:') url = new URL(`https:${url.href.slice('http:'.length)}`);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try { res = await transport({ url, signal: ctrl.signal, headers: HEADERS }); } catch { return false; } finally { clearTimeout(timer); }
    try { res.destroy(); } catch { /* the body is never read */ }
    if (res.status >= 200 && res.status < 300) return true;
    const to = res.headers && res.headers.location;
    if (!REDIRECT.has(res.status) || typeof to !== 'string') return false;
    try { url = new URL(to, url); } catch { return false; }
  }
  return false;
}

/** D93 links: every link of the text works (at most `max` checked, one at a time). */
export async function checkLinks(text, { transport = httpsTransport, timeoutMs = LINK_TIMEOUT_MS, max = LINKS_MAX } = {}) {
  const links = linksIn(text);
  if (!links.length) return { met: true, value: 'No links' };
  const shown = links.slice(0, max);
  const bad = [];
  for (const u of shown) if (!(await linkWorks(u, { transport, timeoutMs }))) bad.push(u);
  if (bad.length) return { met: false, value: `Not working: ${clip(bad[0])}${bad.length > 1 ? ` and ${bad.length - 1} more` : ''}` };
  return { met: true, value: links.length > max ? `Met · ${max} of ${links.length} checked` : 'Met' };
}
```

- [ ] **Step 4: Run it in `checkTry`'s later loop** (`src/core/workflow-tests/result.mjs`)

Import `checkLinks as realCheckLinks` from `./link-check.mjs` and default the option to it (`checkLinks = realCheckLinks`). In the later loop, after the not-finished check and before the command branch, replace Task 3's placeholder with:
```js
    if (check.kind === 'links') {
      let text = outcome.text;
      if (check.file) text = await readText(outcome, check.file);
      const r = typeof text === 'string' && text.trim() ? await checkLinks(text) : { met: false, value: 'No result' };
      results[i] = { id: check.id, label, met: r.met, value: r.value };
      continue;
    }
```
(`links` never sets `file` today, since it is not a text kind; the branch reads one if a later kind change allows it.)

- [ ] **Step 5: Run the tests**

Run: `node tools/test.mjs test/workflow-test-link-check.test.mjs test/workflow-test-result.test.mjs test/workflow-test-exact-checks.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/workflow-tests/link-check.mjs src/core/workflow-tests/result.mjs test/workflow-test-link-check.test.mjs
git commit -m "feat(workflow-tests): Links work, through Ask's guarded web transport

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Judge spend counts in the spending limit (D92)

**Files:**
- Modify: `src/core/cost-budget.mjs` (`recordTestJudgeCost`, `testJudgeWindowedSpendUsd`, `totalWindowSpendUsd`, `budgetStatus`), `src/core/stats.mjs` (`budgetWindowSavings`)
- Test: `test/workflow-test-judge-spend.test.mjs`

**Interfaces:**
- Produces: `recordTestJudgeCost({ workflowId, exampleId = null, testRunId = null, roundId = null, purpose, model = null, engine = 'claude', amountUsd, costKind = 'billed', tsMs }) → void` (no row for $0 or a missing workflow or purpose); `testJudgeWindowedSpendUsd(fromMs, toMs = null) → number`.

- [ ] **Step 1: Write the failing test**

Create `test/workflow-test-judge-spend.test.mjs`:
```js
// test/workflow-test-judge-spend.test.mjs — D92: Part 4's model calls count in the spending limit, never in Statistics or "Saved".
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, prepare } from '../src/core/db.mjs';
import { recordTestJudgeCost, testJudgeWindowedSpendUsd, totalWindowSpendUsd, budgetStatus } from '../src/core/cost-budget.mjs';
import { budgetWindowSavings } from '../src/core/stats.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftjspend-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

test('a judge call is booked once, counted in the window and the limit, and $0 books nothing', () => {
  recordTestJudgeCost({ workflowId: 'wf_a', exampleId: 1, testRunId: 7, purpose: 'try', model: 'claude-haiku-4-5', amountUsd: 0.02, tsMs: 1000 });
  recordTestJudgeCost({ workflowId: 'wf_a', purpose: 'checker', amountUsd: 0, tsMs: 1000 });
  recordTestJudgeCost({ workflowId: '', purpose: 'try', amountUsd: 1, tsMs: 1000 });
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger').get().n, 1);
  assert.deepEqual({ ...prepare('SELECT workflow_id, example_id, test_run_id, purpose, model, engine, amount_usd, cost_kind FROM wf_test_judge_ledger').get() },
    { workflow_id: 'wf_a', example_id: 1, test_run_id: 7, purpose: 'try', model: 'claude-haiku-4-5', engine: 'claude', amount_usd: 0.02, cost_kind: 'billed' });
  assert.equal(testJudgeWindowedSpendUsd(0), 0.02);
  assert.equal(testJudgeWindowedSpendUsd(2000), 0);
  assert.equal(testJudgeWindowedSpendUsd(0, 1000), 0, 'toMs is exclusive');
  assert.equal(totalWindowSpendUsd(0), 0.02);
});

test('budgetStatus counts it; "Saved" leaves it out like test tries', () => {
  recordTestJudgeCost({ workflowId: 'wf_a', purpose: 'try', amountUsd: 1.5 });
  const b = budgetStatus();
  assert.equal(b.windowSpendUsd, 1.5);
  assert.equal(b.allTimeSpendUsd, 1.5);
  const { windowSavedUsd } = budgetWindowSavings(b);
  assert.equal(windowSavedUsd, budgetWindowSavings({ ...b, windowSpendUsd: 0 }).windowSavedUsd, 'judge spend does not lower Saved');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tools/test.mjs test/workflow-test-judge-spend.test.mjs`
Expected: FAIL (`recordTestJudgeCost` is not exported).

- [ ] **Step 3: The ledger in `src/core/cost-budget.mjs`**

After `designWindowedSpendUsd`:
```js
/** Append one workflow-tests model call (plans/workflow-tests-part4-plan.md D92): a criterion checked on a try, a pair, a Check the
 *  checker round's calls, suggested criteria or clearer words. No limit of its own: it counts toward worca's limits and, through
 *  `test_run_id`, the test's own cost limit. Same no-op gate as the other ledgers ($0 mock calls leave no row). */
export function recordTestJudgeCost({ workflowId, exampleId = null, testRunId = null, roundId = null, purpose, model = null, engine = 'claude',
  amountUsd, costKind = 'billed', tsMs = Date.now() }) {
  if (!workflowId || !purpose || !Number.isFinite(amountUsd) || amountUsd <= 0) return;
  prepare(`INSERT INTO wf_test_judge_ledger (workflow_id, example_id, test_run_id, round_id, purpose, model, engine, amount_usd, cost_kind, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(workflowId, exampleId == null ? null : Number(exampleId), testRunId == null ? null : Number(testRunId),
    roundId == null ? null : Number(roundId), purpose, model, engine || 'claude', amountUsd, costKind || 'billed', tsMs);
}

/** Windowed workflow-tests model spend; toMs null = open-ended (budget windows), else ts < toMs. */
export function testJudgeWindowedSpendUsd(fromMs, toMs = null) {
  const row = toMs == null
    ? prepare('SELECT SUM(amount_usd) AS s FROM wf_test_judge_ledger WHERE ts >= ?').get(fromMs)
    : prepare('SELECT SUM(amount_usd) AS s FROM wf_test_judge_ledger WHERE ts >= ? AND ts < ?').get(fromMs, toMs);
  return roundUsd(row?.s || 0);
}
```
`totalWindowSpendUsd`: add `+ testJudgeWindowedSpendUsd(windowStartMs)` and say "Pipeline + Ask Worca + requirements + Design + workflow-tests model spend" in its comment. In `budgetStatus`, `allTimeSpendUsd` adds `+ testJudgeWindowedSpendUsd(0)`.

- [ ] **Step 4: "Saved" in `src/core/stats.mjs`**

Import `testJudgeWindowedSpendUsd` beside `designWindowedSpendUsd`. In `budgetWindowSavings`:
```js
  const spendUsd = roundUsd(budget.windowSpendUsd - (testRow?.s || 0) - testJudgeWindowedSpendUsd(budget.windowStartMs));
```
and extend its comment: "Test tries and Part 4's judge calls are left out …".

- [ ] **Step 5: Run the tests**

Run: `node tools/test.mjs test/workflow-test-judge-spend.test.mjs test/cost-budget.test.mjs test/stats.test.mjs`
Expected: PASS (if `test/cost-budget.test.mjs` or `test/stats.test.mjs` is named differently, find it with `timeout 60 git grep -ln "totalWindowSpendUsd\|budgetWindowSavings" -- test`).

- [ ] **Step 6: Commit**

```bash
git add src/core/cost-budget.mjs src/core/stats.mjs test/workflow-test-judge-spend.test.mjs
git commit -m "feat(workflow-tests): judge spend in the spending limit, not in Statistics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

