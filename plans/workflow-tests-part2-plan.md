# Workflow tests, Part 2: examples and testing a version — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Domain experts keep real requests as **examples**. Worca **tries** a version of a workflow on them (3 tries each by default), checks the **Basics** and the **automatic checks**, and shows what got **better or worse** between two versions, before the team uses the new one.

**Architecture:**
- A **try** is an ordinary no-project run (D20), started in-process through the run handler. `invokeStartRun(body, null, { workflowTest })` passes `workflowUse` (D13), and the run is marked `pipelines.is_test = 1` when its row is created (D21).
- The runner (`src/core/workflow-tests/runner.mjs`) owns its own queue: at most 3 tries at a time, one test per workflow, a cost cap, stop, and "finish the rest". It answers questions from the example (`answers.mjs`) and judges every finished try (`result.mjs` + the pure `src/shared/workflow-tests/checks.mjs`).
- **Connectors** (D35): every test chooses `'pretend'` (the default) or `'real'`. A pretend try loads only its own `mcp.json`, in which every server is a local stand-in under the same name (`src/core/mcp/mock-connector.mjs`). The stand-in offers the tools Worca recorded when the connector was tested, answers every call with "Not sent: this is a test." and writes what would have been sent to `connector-calls.ndjson`. Claude Code is started with `--strict-mcp-config`, so it loads no server of its own.
- Results are stored per try and reused when nothing changed (D26). The compare model (`src/shared/workflow-tests/compare.mjs`) is pure and is shared by the server and the browser.
- The UI is a **Tests** page on the workflow stage, next to Versions: the list, first use, the example editor, Test a version, the progress page, Compare and one example side by side. A run page gets "Use as test example".

**Tech Stack:** Node ESM, `node:sqlite`, `node:test` + jsdom, Express (`ui/server.mjs`), vanilla DOM modules (`ui/public/workflows/*.mjs`).

**Spec:**
- The approved canvas boards 1 Main, 2 CaseEditor, 3 AddFromRun, 4 RunSuite, 5 Compare, 6 CaseDetail, 19 TestsEmpty, 20 RunProgress and WfBar (artifact https://claude.ai/artifact/7kDSH4sKKDz3gV4DnnTABJ). Elements marked [P3+] are not built.
- The Part 2 boards on the same canvas, approved 2026-10-26: 24 AutoCheck (G1, G5, C3, C5), 25 PickPastRun (G7, C11, G6), 26 TestsRunning (C1, G13, C14, C4, G18, C13), 27 RunStopped (C7, G8, C9, C18), 28 RunDone (C7, G2, C10), 29 EmptyStates (C8, C15, C16, C12, C17, C18), 30 TestConnectors and 31 WouldHaveSent (D35). Their "test share" lines are Part 5 and are not built.
- The decisions D18–D40 below, and D1–D17 in `plans/workflow-tests-plan.md`. Where a board and a decision disagree, the decision wins.
- The open items below, once the user has approved them.

---

## Open items for the user (approve in one pass)

Each item is a place where the code or the Part 2 scope forces a deviation from the approved boards. The proposed resolution is what this plan builds. Copy risks are C1…, design gaps are G1….

**Approved by the user 2026-10-26: every item as proposed.** C1 uses the new text (not the approved board text). G14: Statistics leaves tests out until Part 5. G3: dropped. The UI that no board draws (G1 dialog, G7 picker, G13 card, C7/C9/G8 stopped and done progress page, C8/C15/C16/C18 empty and refused states) is mocked on the evals canvas and approved before Tasks 10–14 start; Tasks 1–9 can start at once.

**Approved by the user 2026-10-26, second pass (after the plan review):**
- The mocks are boards 24–31 (see Spec). Their choices, now in the rows below: `checkLabel` joins section names with "and" (C20); Stopped and Done use the board-20 status pill (C7); a one-try test is "Tried once: <example>" ("Trying once: …" while it runs); a disabled Start reads "Start" (C16); the empty past-run picker has Next disabled (G7).
- The runner tries 3 at a time (D36). One test per workflow at a time, and the UI says so (G19, D37).
- "In short" keeps the three extra sentences (C2) and is hidden when no example has finished tries on both versions (D38).
- Connectors: Pretend (default) or Real per test; Try it once now always pretends (C19, D35).
- What is still open is listed under "Open items for the user (new in this revision)" at the end of this section.

### Copy risks

| # | Where | Approved board text | Proposed Part 2 text |
|---|---|---|---|
| C1 | Boards 1 and 19, "How testing works", step 2 | "In your own words, for example "names a goal with a number"." (this is Part 3's criteria) | "Pick the Basics it must meet and add automatic checks, for example "has the sections Problem and Risks"." Alternative: keep the approved text. |
| C2 | Board 5, "In short" (deterministic, Basics and automatic checks only) | free prose | Fixed sentences, in this order, each only when it applies. (1) `<B> is <cheaper / more expensive>[ and <faster / slower>], and better on N example(s).` With nothing cheaper or faster: `<B> is better on N example(s).` When nothing is better or worse: `<B> gives the same results as <A> on every example.`, or with a cost or time word `<B> is cheaper, and gives the same results as <A>.` When nothing is better but some are worse: `<B> is cheaper.` (only with a cost or time word). (2) One worse example: `It is worse on 1 example, <name>: it missed "<label>" in k of n tries.`; when that difference might be luck: `It is worse on 1 example, <name>.` More: `It is worse on M examples.` (3) `Its results also vary more from try to try.` or `Its results are also steadier from try to try.` (4) `Look at <name> before you share <B>.` with the "Look at it" button. Cheaper or faster means at least 10% less. When no example has finished tries on both versions, In short is hidden (D38). **Approved 2026-10-26, the three extra sentences included.** |
| C3 | Board 2, Automatic checks hint | "Counted exactly, without AI. Pick them from the Library." | "Counted exactly, without AI. Pick a ready check, or a script from the Library." |
| C4 | Board 3, the hint under the verdict | "…so v4 shows as failed on this example until a version does better." | Not good: "This result came from v4 and was not good enough, so v4 shows as not good on this example until it is tested." Good: "This result came from v4 and was good, so v4 shows as good on this example until it is tested." The cell text is "Not good · a past run" or "Good · a past run". |
| C5 | Board 2, a Library script check's label | not drawn | `The Library script "<name>" passes` |
| C6 | Board 4, partial reuse | only full reuse is drawn | "Use v4's 3 results from 19 Oct. Nothing in v4 or in those examples has changed since, so only the other tries are made. This saves about $2.50." |
| C7 | Board 20, after a stop or the end (boards 27, 28) | only "while it runs" is drawn | Stopped: the pill "Stopped · 7 of 18 tries done" and the primary button "Finish the rest". Done: the pill "Done · 18 of 18 tries done" and the primary button "See what changed" ("See the result" after Try it once now). Both pills are the board-20 status pill (`.pill-run` with its dot, which stops pulsing), not a `.badge`: Done green, Stopped grey (D39). Why it stopped: cap "Stopped: the cost went over $15."; person "You stopped the test."; spending limit "Stopped: the spending limit is reached."; quick check "The free quick check did not pass: <reason>"; restart "Stopped when Worca restarted."; shutting down "Stopped: Worca is shutting down."; a change during the test: the C18 sentence, with no "Finish the rest" (D27); refused or error "Stopped: <reason>". |
| C8 | D20, a workflow that needs a project | not drawn | Heading "Tests are for workflows without a project, for now"; text "This workflow works on a project's code. Worca can test workflows that run without a project today; testing workflows that change a project comes next." |
| C9 | Board 20, rows the board does not draw | not drawn | A stopped test: "Not finished · 1 of 3 tried". A running test with an example between two tries: "Tried 1 of 3". |
| C10 | Board 6, "Read the whole brief" | domain word "brief" | "Read the whole result" (cards "What v4 wrote" / "What v5 draft wrote" stay) |
| C11 | Board 19, a past run's badge | "Good result" / "Not good" / "Similar to another" (real-use signals are Part 5) | "Finished" (green), "Failed" (red), "Stopped" (grey), and "Same request as another" for an exactly equal request. The detail line is " · 14 Oct · 2 files · the same request as "<title>"". |
| C12 | Board 2 card 4 and board 4, cost unknown | always shows a number | "Worca does not know the cost of a try yet: it learns it from the first tries." In the estimate box: "cost not known yet". |
| C13 | "Worca tells you when the results are ready" | not drawn | A toast "Test results are ready" (or "Test stopped") with "<workflow>: <test title>" and an Open button. |
| C14 | Board 1, cells | only "n of 3 passed" | "Not tried"; "2 of 3 passed · before a change" when the version or the example changed since those tries. |
| C15 | Tests page on an unsaved canvas | not drawn | "Save the workflow first: tests belong to a saved workflow." |
| C16 | Board 4 with no saved version | not drawn | The Compare select says "No saved version yet"; Start is disabled and reads just "Start"; hint "Save a version first: a test compares two versions. Try it once now tries one example on your draft." The same version twice: "Pick two different versions." (Start disabled, "Start"). Everything reused: "Nothing to try: both versions have results for these examples." (Start disabled, "Start 0 tries", the only case that shows a number while disabled). |
| C17 | Board 5, "If that changes … Worca says so here" | not drawn | "Your draft changed after this test."; "v4 runs changed agent or script text since this test."; `"<name>" was edited after this test.`; "An example of this test was deleted since."; with no graph change: "No steps or settings changed." |
| C18 | Empty and refused states | not drawn | First use with no past run: "Worca found no runs of <workflow> without a project yet. Write an example yourself, or run the workflow once and come back." Side by side: "No finished try of this example in this test.", "This try left no result." Finish the rest after a cap stop with a cap that is too low: "Raise the cost limit above $6.00 to finish the rest." A changed version or example: "Your draft changed since this test started: start a new test." / `v<n> changed since this test started: start a new test.` / `"<name>" was edited since this test started: start a new test.` These stop a running test too (D27). A test of this workflow is running: "Test a version" and "Try it once now" are disabled, with the hint "A test of this workflow is running. Wait for it, or stop it first."; the server refuses a start with the same sentence (409, G19). |
| C19 | Boards 30, 31: connectors (D35) | boards 30, 31 | Test a version, section "Connectors": radio **Pretend** "Your connectors are replaced by stand-ins. Nothing is posted or sent, and Worca shows what would have been sent. Anything the workflow reads from them comes back empty." and radio **Real** "Tries use your real connectors. If the workflow posts or sends something, it does it in every try: <N> times in this test." ("once in this test" for one try; the clause is left out until the estimate is known). With Pretend, per-connector notes: "<names>: pretend"; "<name> is switched off: Worca can't pretend for claude.ai connectors."; "<name> is switched off: test it once in Connectors so Worca knows its tools." (the words "test it once in Connectors" link to Connectors). In both modes, for script steps: "The script step <name> runs as in a normal run. If it posts or sends something, it does it in every try."; several: "The script steps <A and B> run as in a normal run. If they post or send something, they do it in every try." The D21 promise line reads, with Pretend only, "Tests never touch real work through your connectors." One example side by side: the top note "Connectors: pretend. Nothing was posted or sent."; per try a card "Would have sent" with one row per call (server · what it does · "to <where>:" and the first 80 characters, the whole text when opened), or "Nothing would have been sent."; a real try: "Connectors: real. This try used your real connectors." **Approved 2026-10-26.** |
| C20 | Board 24, a sections check's label | "Has the sections Problem, Users, Success metric, Risks" | Names joined with "and": "Has the sections Problem and Risks"; three or more: "Has the sections Problem, Users and Risks". One: "Has the section Risks". **Approved 2026-10-26.** |

### Design gaps

| # | Gap | Proposed resolution |
|---|---|---|
| G1 | Board 10 "Add a check" is Part 3 | A small dialog: "What to check" select (Length in words · Has these sections · Must mention a text · Must not mention a text · A file with this name is in the result · A Library script), the fields of that kind, a live preview of the label, Cancel / Remove / Save check. |
| G2 | "Try it once now" result is not drawn | It starts a one-try test of the draft and shows the progress page. When done, "See the result" opens the side-by-side page with one column. |
| G3 | "Show both versions on the canvas" | Dropped in Part 2. |
| G4 | Board 19 real-use signals are Part 5 | Rows show date, status badge and number of files. The three newest runs that are not "Same request as another" start ticked. "Add N examples" creates them all and stays on the list with a toast "Added N examples. Open each to say what a good result needs." |
| G5 | Board 2 has no name field (the title shows the name) | A "Name of the example" field at the top of card 1. The title reads "Example: <name>", or "New example". |
| G6 | Board 3's run page shows a row of buttons that the real run page does not have | "Use as test example" is an item in the run page's ⋯ menu (`runMoreItems`). It is shown only with the flag on, for a finished (done, stopped or failed) no-project run of a saved user workflow. |
| G7 | Board 1's "Add from a past run" has no picker drawn | A small dialog "Add from a past run": "Pick a run of <workflow> to keep as an example.", the 10 newest no-project runs as radio rows ("<title> · 14 Oct · Finished"), and "Next", which opens the board-3 dialog for that run. With none: "Worca found no runs of <workflow> without a project yet. Run the workflow once, or write an example yourself.", and Next is disabled (board 25, approved 2026-10-26). |
| G8 | Board 20 draws only the case where the old version's results are reused | When both versions need tries, every example shows two rows, one per version, each labelled ("v4", "v5 draft"). |
| G9 | Board 5's "By example / By criterion" switch | Part 2 has one view: a plain heading "By example", no one-tab switch. |
| G10 | Board 2 has "How many tries" per example; board 4 has "Tries per example" for the test | The dialog starts at the largest setting of the chosen examples and applies to all of them. The example's own setting is that starting value. |
| G11 | Board 2 shows "Costs at most $1.50" ticked | It starts off for a new example: a made-up limit would fail every try of a workflow that costs more. When Worca knows the usual cost, the field is pre-filled with twice it, rounded up to $0.50. |
| G12 | Board 4 has one reuse box (the old version) | A second box for the new version when it has reusable results, in the same words. |
| G13 | Board 1 does not show a running test | A card "Testing your v5 draft · 7 of 18 tries done" / "Worca tells you when the results are ready." / "See progress" above the latest-test card. |
| G14 | Statistics | Test tries leave Statistics completely (runs, Spent, time, people, D21). Until Part 5's Tests tile, Statistics' Spent can be lower than the spending-limit meter, which still counts the tests. |
| G15 | Board 5 "Try 3 more" | Starts at once, without the dialog: the same two versions, that one example, 3 more tries than this test had (at most 10), reusing the tries already made, with the same cost cap. |
| G16 | Board 4 "Examples" select shows only "All 6" | Options "All N" and each example by name. |
| G17 | Files of a new example | "Add file" on an example that was never saved saves it first, then uploads. |
| G18 | Board 1's ⋯ "More for this example" items are not drawn | Edit, Delete (asks first). |
| G19 | One test per workflow (D37) | While a test of the workflow runs, "Test a version" (the list) and "Try it once now" (the editor) are disabled, with the C18 hint. Compare's "Test again" and "Try 3 more" stay enabled; the server refuses them with the same sentence, shown in a toast. **Approved 2026-10-26.** |

### Open items for the user (new in this revision)

These came up while applying the review and the connector choice. The plan builds the proposal; each is one line to change.

| # | Where | Proposal built by this plan |
|---|---|---|
| N1 | Board 30, servers from the person's own Claude Code settings (`~/.claude.json`) | `--strict-mcp-config` drops them in a pretend try, like the claude.ai connectors. Note: "<name> is switched off: Worca can't pretend for servers in your own Claude Code settings." |
| N2 | Board 30, which claude.ai connectors to name | Worca cannot list them ahead of a run. It remembers the names it saw in the runs it already made (the CLI's start-up list). Before any run has shown one, no claude.ai line appears; they are switched off either way. |
| N3 | Board 31, the card's count and reads | The count names the thing each call makes, from the tool's name ("1 message, 1 issue"; a one-word tool counts as "call"). A call to a tool marked read-only is not listed: the footer says "Worca also answered 1 request in Jira: it came back empty." ("N requests … they came back empty."). Board 31 says "1 search"; Worca cannot name a read reliably, so it says "request". |
| N4 | A version on side A that needs a project (review M9) | The test is refused before it starts: `v<n> works on a project, and tests work for workflows without a project for now.` |
| N5 | Board 27 after a change during the test | No "Finish the rest" (it would be refused); the hint is the C18 sentence and the list's "Test a version" starts a new test. |

---

## Corrections to the brief's research (verified on `feat/workflow-tests-part2` @ `472e15023`)

1. **The "some passed" dot is grey, not amber.** The boards use `--seq` for `.dot.mix` (style.css:81 `--seq` is grey). Amber stays "needs you".
2. **"Sent back for fixes" is the sum of the loop deliveries**, `pipelines.outcome.wireDeliveries`. Loop wires count every delivery (scheduler.mjs:740 and :837; artifacts.mjs:1994 persists it). It is not `pipelines.cycle`, which mirrors the last-started execution's ordinal (orchestrator.mjs:2099).
3. **"Needed help" cannot be counted from `step_questions`.** An answered question writes a row there too, including a canned one (orchestrator-questions.test.mjs:204). The runner records help itself, in the try's facts.
4. **`humanInLoop` only steers the Auto workflow** (orchestrator.mjs:290–630), which has no Tests page. Tries leave it at its default. `PLAN_ASK_KIND` (`'plan'`, shape/run.mjs:7) comes only from shaped runs (`body.shape`), which tries never send. If it shows up anyway, the try stops.
5. **More hooks need the test flag than the brief lists:**
   - **The live Runs list.** `summarizeRuns` (server.mjs:1272) feeds every hello. `announceRun` (:1333) sends `run-created`. Every per-run frame goes to every tab (`wireRun` `record`, :1381), and the client creates a run for any frame with a `runId` (app.js:1995–2016).
   - **`maybeScheduleLimitResume`** (server.mjs:1500): a usage-limit pause would book a resume ticket.
   - **`autoResumeOnBoot`** (server.mjs:11857): it resumes paused and interrupted rows.
   - **The paused-stop path.** The notifier attach at server.mjs:4785 is inside `stopPausedPipelineOnce`. It is not a second start path.
6. **The no-project branch never passes `titleLocked`.** Only the project branches do (server.mjs:3052, :3219), so smart naming would title, and bill, every try. Tries pass `titleLocked: true` and a fixed title (`_kickoffTitleGeneration`, run-harness.mjs:8230).
7. **`invokeStartRun` returns only `{ runId, pipelineId }`.** The runner must hold the orchestrator before `orch.run()` can ask anything, so `workflowTest.onOrch(orch, { runKey })` is called right after `wireRun(entry)`. That is before `entry.launch` (server.mjs:3316).
8. **`answerRun` exists** (server.mjs:4684) but returns nothing. The runner's `answer` dep returns `orch.answer`'s boolean and clears `entry.pendingQuestion` through `resolvePending`.
9. **The boards' `.btn-go` does not exist** in style.css. The primary buttons are `.btn.btn-primary`.
10. **The run page has no row of plain buttons.** Its actions live in the bar and the ⋯ (`runMoreItems`, app.js:26520). See G6.
11. **The example fingerprint leaves out the number of tries.** Tries are independent samples, and "Try 3 more" must reuse the first three (D26).
12. **A script check can write into its cwd.** It runs on a copy of the try's result folder (D25). `runBenchOnce` needs `allowDirCwd: true` (script-bench.mjs:199–211) and allows at most 2 runs at once and one per key (:335–337).

---

## Decisions

| # | Decision |
|---|---|
| D18 | **Automatic checks:** built-in exact checks anyone can fill in: length in words (min/max), has these sections (headings), must mention a text, must not mention a text, a file with this name exists in the result. Plus Library scripts for developers. Pure functions, no AI. The exact checks that use the example's files (quotes, numbers, personal data, links) stay in Part 3. A Library script check runs through the script bench on the try's result folder and passes when its status is `clean`. |
| D19 | **Memory:** test tries use no memory. Nothing is mounted and nothing is written back, so comparisons stay fair and repeatable. |
| D20 | **Scope:** Part 2 tests only workflows that run without a project (no-project runs in a private work folder). A workflow that needs a project shows a plain sentence that it cannot be tested yet (C8). Project and coding workflows come in the next part. The seam is one module, `src/core/workflow-tests/try-body.mjs` (`testTargetOf`, `tryRunBody`). |
| D21 | **Isolation:** test tries are hidden from the Runs and History lists, Statistics, team metrics records, chat notifications and Requirements links. Their cost counts toward the normal spending limit. The test share and the Statistics Tests tile are Part 5. With Pretend connectors (the default, D35) a try posts and sends nothing through a connector; script steps run as in a normal run, and the dialog says so. With Real connectors a try uses them as a normal run does, and the dialog warns. |
| D22 | *(technical)* **One mark, read everywhere.** `pipelines.is_test` (v78, NULL = a normal run) is written once, in the INSERT `createPipeline` → `writeState` makes, and never updated. These readers filter on it: `listPipelines`, `listAllPipelines`, `countPipelines`, every Statistics query, `autoResumeOnBoot`, `recordRunMetrics`, the memory mount on a resume, the Versions page's run counts (`runCounts`), the onboarding "ran a run" ticks and Ask's `listPeople`. `resumeRun` refuses a test row (409), and a restart drops a try's resume point. The live entry carries `isTest`, so the server sends no frame (the launch error included), announcement, hello row, chat notifier or scheduled resume for it, and enforced run tags neither refuse nor tag it. Accepted: the platform heartbeat's status counts include tries. `cost_ledger` is untouched (D21). Requirements links need nothing: a try is never started from a feature. |
| D23 | *(technical)* **The draft or a version.** `workflowTest.use` is `'draft'` or a version number. It is accepted only from the in-process caller (`req._workflowTest`), never from an HTTP body. It goes both to `assertRunnableWorkflow(…, { use })` and to the orchestrator as `workflowUse`, so the version checked is the one that runs, and the manifest records `workflowVersion` (D8). |
| D24 | *(technical)* **Questions.** Canned answers match by normalised question text: NFKC, case, punctuation and spacing ignored. An answer that equals an option (same normalising) picks the option. Otherwise it is free text where `allowFreeText` is not false, else no match. A question with no match: "Worca picks a sensible answer" answers like `--yes` (`autoChoice`) and is **not** help, because the person chose to let Worca pick (changed 2026-11-10; the Questions block still says Worca picked); "The try counts as failed" stops the try with the reason and is **help**. Gates answer `continue` and are not help, because they are part of the workflow. A recovery prompt or a plan approval stops the try and counts as help. A form follows the example's rule (`autoValues`, or fail; picked is not help). |
| D25 | *(technical)* **The main result** is the End node's result file. If there is none, it is the End node's value. If there is none, it is the largest text file in the try's result folder (`work/`). Text checks read it, the file check reads the result folder's paths, and a Library script check runs on a copy of the folder, one check at a time, retrying while the bench is busy. |
| D26 | *(technical)* **Identity and reuse.** The example fingerprint covers what Worca gets and how a try is judged: request, files (name + sha256), answers, the otherwise rule, Basics and checks. It does not cover the name, the note or the number of tries. The version fingerprint is `workflowFingerprint(graph, today's parts)`, so a Library edit counts (D6). A finished try is reused only when both fingerprints, the mock setting and the connectors mode (D35) are equal. |
| D27 | *(technical)* **Runner rules.** At most 3 tries at a time (D36). One running test per workflow (D37). Example by example. Before each try starts, the runner compares today's fingerprints of its version and its example with the ones the test started with; on a difference it stops the test (`changed`, with the C18 sentence), so a try never runs one state and is stored as another. The cost cap is checked before each start and every 2 s while tries run: the sum of the finished tries' costs plus the live runs' `totalCostUsd`. A stop keeps the finished tries. Stopped tries count in the cost, and "Finish the rest" makes them again. A refused start stops the test: 403 → `budget`, 503 → `drain`, anything else → `refused`. A server restart marks running tests `stopped` (`restart`). "Finish the rest" is refused when a version changed since the test started. |
| D28 | *(technical)* **Better or worse** compares the pass rates per example. "Might be luck" means the two differ by at most 1 try. "Why" names the Basic or check the losing side missed most often. "Steady" means every finished try of that side has the same verdict. "In short" uses only the C2 sentences, and is empty when no example has finished tries on both sides (D38). |
| D29 | *(technical)* **A past run's verdict (board 3)** is stored on the example (`from_use`, `from_verdict`). It shows in the column of the version the past run used, until a test of that version tries the example. It never counts in Compare. |
| D30 | *(technical)* **UI level Simple** (like D11: the people who build workflows are the audience). Flag `workflowTests`. The page order is Canvas · Tests · Versions. |
| D31 | *(technical)* **Storage.** Five FK-free tables (v78), like `workflow_revisions`, so a deleted workflow's examples come back with it. Files are BLOBs of at most 5 MB, at most 8 per example. They are uploaded one per request, because the global JSON limit is 8 MB. |
| D32 | *(technical)* **Tries per test** is 1–10. An example's own setting is 1, 3 or 5 (G10, G15). |
| D33 | *(technical)* **Frames.** One frame, `{ type: 'workflow-tests-changed', workflowId, testRunId, finished?, status?, title? }`, sent only while the flag is on. The finished frame carries the C13 toast text. The field is `testRunId`, never `runId`: the client turns any frame with a `runId` into a run (app.js:1973). |
| D34 | **A sections check's label** joins the names with "and" (C20). Approved 2026-10-26. |
| D35 | **Connectors: Pretend or Real.** Each test has a connectors mode, `'pretend'` (default) or `'real'`; Try it once now always pretends. *(technical)* Pretend: after the MCP layer is built and before `<runRoot>/mcp.json` is written, every server (registry copies and file servers) is replaced by a stdio stand-in, `src/core/mcp/mock-connector.mjs`, under the same name, so the tool names `mcp__<server>__<tool>` and the grants stay the same. The stand-in has no env and no secret; its args name the server, its tools file (the tools the connector's last passing Test recorded) and `<pipelineDir>/connector-calls.ndjson`. `tools/call` writes `{ts, server, tool, arguments, readOnly}` there and answers `Not sent: this is a test.`, for every tool, reads included. A server with no recorded tools is switched off for the try. The spawn gets `--strict-mcp-config` (no claude.ai connector, `~/.claude.json` server or plugin server loads) and, as a belt, `--disallowedTools mcp__claude_ai_*`. Script steps get `WORCA_TEST=1` and `WORCA_TEST_CONNECTORS`. Real: a normal run. The mode is part of the reuse key (D26). Approved 2026-10-26. |
| D36 | **Three tries at a time** (`MAX_PARALLEL = 3`, the estimate's `TRIES_AT_ONCE = 3`). Library script checks stay one at a time, inside `runBenchOnce`'s own limit of 2 (script-bench.mjs:335). Approved 2026-10-26. |
| D37 | **One test per workflow at a time.** The runner refuses a second start, Try it once now included, with "A test of this workflow is running. Wait for it, or stop it first." (409); the UI disables the two start buttons with that hint (G19). Approved 2026-10-26. |
| D38 | **In short** keeps the C2 sentences, the three extra ones included, and is hidden (`[]`) when no example has finished tries on both versions. Approved 2026-10-26. |
| D39 | **Stopped and Done** use the board-20 status pill: `.pill-run` with its dot, green for Done, grey (`--slate-*`) for Stopped, the dot still; not `.badge`. Approved 2026-10-26. |
| D40 | *(technical)* **Accepted for Part 2.** No cleanup of tries: their hidden pipelines and `work/` folders stay (about 18 per test) until the cleanup of a later part. The heartbeat's counts include them. The Statistics change stays inside the hidden-run task. |

## Global Constraints

- **Worktree and branch:** `C:\Users\BRT1BG\worca-cc\worca-cc-tests2`, branch `feat/workflow-tests-part2`, stacked on `feat/workflow-tests` (PR #979, Part 1). Its PR targets `dev` after #979 merges. Until then, merge `feat/workflow-tests` in when it moves.
- **Commits:** one per task. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Author email is `tomica.brkovic@yahoo.com` (already set in the worktree).
- **Upstream:**
  - Target `dev`.
  - Merge commits only. Merge `dev` in, never rebase or force-push.
  - State `npm test` and a smoke run in the PR.
  - Name the UI level and update `docs/ui-levels.md`.
- **Never push or open a PR without the user's explicit go.**
- **Run one test file:** `node tools/test.mjs test/<file>.test.mjs` (hermetic home + no-real-claude guard). About 170 failures already exist on clean `dev` on this laptop, so compare against a `dev` baseline before blaming the branch.
- **style.css:**
  - Tokens only, never a hex colour.
  - Status colours: green = done, red = failed, blue = information, amber only "needs you". Grey `--seq` = some passed. Peach = running, as `.pill-run.peach` already is.
  - New CSS goes in the workflows section, right after Part 1's "Workflow versions" rules, never after a `/* ── marketplace … ── */` marker.
  - Every CSS block is closed (the brace-balance test).
- **UI follows `docs/design-system.md`**, which `test/ui-design-language.test.mjs` and `test/ui-shared-controls.test.mjs` enforce:
  - Type steps only: `font-size` is `var(--fs-caption)` 11, `var(--fs-meta)` 12, `var(--fs-body)` 13, `var(--fs-section)` 15, `var(--fs-subpage)` 18 or `var(--fs-stat)` 22. No other px size.
  - Radius tokens only: `var(--r-xs)` for chips, pills and bars, `var(--r-sm)` for boxes and icon tiles, `var(--r-card)` for a card. `50%` only on a selector whose name says it is round (`…-dot`, `radio`, …: the test's `ROUND`). Never `999px`, never `--r-pill`.
  - Icons, not glyphs: `icon(doc, 'more' | 'x' | …)` from `ui/public/icons.mjs` inside a button with an `aria-label`. No string that is only `⋯`, `×`, `✓`, `▾`.
  - On/off is a switch (`makeSwitch`, `ui/public/switch.mjs`). A checkbox only picks items or opts in next to a field, and then its emitting statement carries a token listed in `JS_CHECKBOX_OK` (test/ui-shared-controls.test.mjs) with the reason; the task that adds the checkbox adds the row.
- **UI tasks start only on approved screens.** Tasks 10–14 each name their boards. Those boards are approved (2026-10-26). If the controller reports a later change to one of them, apply it to the task's text before starting.
- **Every UI task runs the design guards** after its own tests: `node tools/test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs`, then the style.css slicing tests (below). On this branch `ui-design-language` has four failures that are not Part 2's (the guide, the charts, a typed "+" and the member rows); any other failure is the task's.
- **Route errors:** `{ error }` with 400 / 404 / 409 / 422 / 500. Every route is behind `requireFlag('workflowTests')`. The UI is behind `data-flag="workflowTests"`.
- **No new identifier may be called `version`** (D7). Use `versionNo`, `use`, `useRef`.
- **UI text:** `textContent` only (no innerHTML with data). Use the shared dialog `createDialog({doc, win, width})` (ui/public/marketplace/layers.mjs), `notify` and `confirmModal`.
- **Test files must not read `plans/`.** Pin copy literals in the tests.
- **Paid model calls: none in tests** (mock engine only; `WORCA_MOCK=1` for API tests). A real-call proof needs the user's explicit OK and a budget cap.
- **Schema:** `SCHEMA_VERSION` becomes **78**, the next number after Part 1's 77 on this branch. A8 (PR #975) also takes 77, so whichever of #979 and #975 merges second renumbers its migration, and Part 2 then takes the next free number after both (79 if A8 ends at 78). A renumber touches: `SCHEMA_VERSION`, the DDL comment, the ladder line `if (current < N)`, the `INCREMENTAL_COLUMNS` comment, the test file name `test/db-migrate-vN.test.mjs`, and its `>= N` and `user_version = N-1` lines. Then run `node tools/test.mjs test/db-migrate-v70.test.mjs test/db-migrate-v71.test.mjs test/db-migrate-v72.test.mjs test/db-migrate-v73.test.mjs test/db-migrate-v74.test.mjs test/db-migrate-v75.test.mjs test/db-migrate-v76.test.mjs test/db-migrate-v77.test.mjs test/db-migrate-v78.test.mjs test/db.test.mjs` (tools/test.mjs does not expand a `*`, and PowerShell passes it as is).
- **The style.css slicing tests** (they cut the file at its `/* … */` markers; run them in every UI task and after every merge of `dev`): `node tools/test.mjs test/marketplace-add-dialog.test.mjs test/marketplace-install-view.test.mjs test/marketplace-installed-view.test.mjs test/marketplace-marketplaces-view.test.mjs test/marketplace-sheets-css.test.mjs test/ui-artifact-browser.test.mjs test/ui-artifact-viewer.test.mjs test/ui-chat-action-cards.test.mjs test/ui-chat-direction.test.mjs test/ui-chat-panel-view.test.mjs test/ui-chat-run-card.test.mjs test/ui-chat-scope-style.test.mjs test/ui-chat-style.test.mjs test/ui-folder-changes.test.mjs test/ui-shared-controls.test.mjs test/ui-skills-view.test.mjs`. To refresh the list in PowerShell: `Select-String -Path test\*.test.mjs -SimpleMatch "indexOf('/*" -List | ForEach-Object { $_.Path }`.

## Review Focus

1. **A test try is never seen outside the Tests page** (Task 4, Task 9).
   - Setup: start a try through `invokeStartRun(…, { workflowTest })`.
   - Expect:
     - `GET /api/history` and `GET /api/counts` leave it out.
     - `summarizeRuns()` (hello) leaves it out, and no WS frame with its runId reaches a socket.
     - `getStats` counts neither its run, its spend nor its person.
     - `recordRunMetrics` answers `reason: 'test'`.
     - `chatNotifier.attach` is never called for it.
2. **Its cost still counts in the spending limit.** Expect: `budgetStatus().windowSpendUsd` includes its ledger rows (Task 4).
3. **Memory is never mounted.** Expect: `entry.orch.memory === null` after the try, and the pipeline dir has no `memory/` (Task 4).
4. **An unanswered question with "The try counts as failed" stops the try.**
   - Expect: `stopRun` is called, the try is `failed`, and "Finishes without an error" is Not met with the reason.
   - With "Worca picks a sensible answer" the try goes on, and "without needing help" is Not met (Task 3, Task 7).
5. **The cost cap stops the test.**
   - Expect:
     - Running tries are stopped, the test is `stopped` with `cap`, and waiting tries stay waiting.
     - Their cost is in the test's cost.
     - "Finish the rest" makes only the stopped and waiting tries (Task 7).
6. **Reuse only when nothing changed.**
   - Expect: a version's finished tries are reused. After any of these, nothing is reused (Task 7, Task 9):
     - the draft changes;
     - the agent it uses is edited in the Library;
     - the example's request, files, answers, rule, Basics or checks change;
     - the mock setting differs.
7. **A version's tries run that version.** Expect: `stepper.workflowVersion = { no: 1 }` and v1's graph, not the draft (Task 4).
8. **Flag off.** Expect: every Part 2 route answers 404, no `workflow-tests-changed` frame is sent (`test/workflow-test-routes.test.mjs`), the Tests tab is hidden, and the run page's ⋯ has no "Use as test example" (Task 9, Task 10, Task 12).
9. **A workflow that needs a project.** Expect: the overview says `testable: false, reason: 'needs-project'` and the page shows C8. Starting a test answers 422 (Task 9).
10. **No scheduled resume, no auto-resume, no resume at all.**
    - Expect: a try that pauses on a usage limit books no resume ticket (`wireRun` leaves `entry._limitResumeP` unset).
    - `autoResumeOnBoot` skips test rows, and `resumeRun` refuses one with 409 (Task 4).
    - A launch error of a try reaches no tab (the `entry.launch` `.catch` sends no frame for it, Task 4).
11. **Pretend connectors send nothing** (Task 5).
    - Expect: a pretend try's `mcp.json` holds only stand-ins (`command` = node, `args` = mock-connector.mjs with the server name), no `env` and no secret value; a connector with no recorded tools is left out.
    - The spawn has `--strict-mcp-config` and disallows `mcp__claude_ai_*`; a script step sees `WORCA_TEST=1` and `WORCA_TEST_CONNECTORS=pretend`.
    - A real try's `mcp.json` is the normal one. Pretend and real tries are never reused for each other (Task 2, Task 7).
12. **A change during a test stops it** (Task 7). Expect: editing the draft, the Library or an example while a test runs stops it with `changed` before the next try starts; no try is stored under a fingerprint it did not run.
13. **Run counts and tags leave tries alone** (Task 4). Expect: the Versions page's `runs` counts no try; enforced run tags neither refuse a try (no 422) nor tag it.
14. **One test per workflow** (Task 7, Task 9, Tasks 10–11). Expect: a second start, Try it once now included, answers 409 with "A test of this workflow is running. Wait for it, or stop it first."; the UI disables "Test a version" and "Try it once now" with that hint.
15. **The design guards pass** (Tasks 10–14): `ui-design-language` (no new failure beyond the four listed in the Global Constraints) and `ui-shared-controls`.

---

## File structure

**New files**

| File | Responsibility |
|---|---|
| `src/shared/workflow-tests/checks.mjs` | Pure: the built-in checks, Basics, labels, and the verdict of one try (D18). |
| `src/shared/workflow-tests/compare.mjs` | Pure: version labels, titles, the compare model, In short, the tiles' formats, the dialog's estimate (D28). |
| `src/core/workflow-tests/store.mjs` | DB: examples and their files, test runs, tries, reuse queries, recovery (D31). |
| `src/core/workflow-tests/answers.mjs` | Canned answers and the question listener (D24). |
| `src/core/workflow-tests/try-body.mjs` | The D20 seam: whether a workflow can be tested, and the run body of one try. |
| `src/core/workflow-tests/result.mjs` | A finished try's facts, its main result, its files, and the script checks (D25). |
| `src/core/workflow-tests/uses.mjs` | The graph and fingerprint of the draft or a version (D26). |
| `src/core/workflow-tests/runner.mjs` | The queue: start, cost cap, stop, finish the rest, quick check, reuse, recovery (D27). |
| `src/core/workflow-tests/service.mjs` | The read models: overview, past run, plan, progress, compare, side by side. |
| `src/core/workflow-tests/routes.mjs` | HTTP + the change frame (D33). |
| `src/core/mcp/mock-connector.mjs` | The stdio stand-in a pretend try loads for each connector (D35). |
| `src/core/workflow-tests/connectors.mjs` | Pretend: the stand-ins, the dialog's connector notes, what a try would have sent, the claude.ai names seen (D35). |
| `ui/public/workflows/test-ui.mjs` | Shared DOM helpers for the Part 2 views: `el`, `btn`, `iconBtn`, `seg`, `field`, `card`, `testDialog`. |
| `ui/public/workflows/tests-view.mjs` | The Tests list, first use, "needs a project" (boards 1, 19, 26, 29). |
| `ui/public/workflows/example-editor.mjs` | Edit an example, plus the answer and check dialogs (boards 2, 24). |
| `ui/public/workflows/test-dialogs.mjs` | Pick a past run (board 25), Use this run as a test example (board 3), Test a version (boards 4, 30). |
| `ui/public/workflows/test-progress.mjs` | While the test runs, stopped, done (boards 20, 27, 28). |
| `ui/public/workflows/test-compare.mjs` | Compare (board 5), one example side by side (boards 6, 31), Read the whole result. |
| `test/workflow-test-checks.test.mjs`, `test/db-migrate-v78.test.mjs`, `test/workflow-test-store.test.mjs`, `test/workflow-test-answers.test.mjs`, `test/workflow-test-isolation.test.mjs`, `test/api-workflow-test-try.test.mjs`, `test/mcp-mock-connector.test.mjs`, `test/workflow-test-connectors.test.mjs`, `test/workflow-test-result.test.mjs`, `test/workflow-test-runner.test.mjs`, `test/workflow-test-compare.test.mjs`, `test/api-workflow-tests.test.mjs`, `test/api-workflow-tests-flag-off.test.mjs`, `test/workflow-test-routes.test.mjs`, `test/ui-workflow-tests-view.test.mjs`, `test/ui-workflow-example-editor.test.mjs`, `test/ui-workflow-test-dialogs.test.mjs`, `test/ui-workflow-test-progress.test.mjs`, `test/ui-workflow-test-compare.test.mjs` | One test file per unit above. |

**Modified files**

| File | Change |
|---|---|
| `src/core/db.mjs` | v78: five tables, `pipelines.is_test`. |
| `src/core/artifacts.mjs` | `createPipeline({ isTest })` → the INSERT; `isTestPipeline`; the three list and count filters. |
| `src/core/run-harness.mjs` | `isTest` to `createPipeline`; `_mountMemory` skips a test try; Away mode off for a try; the pretend stand-ins and their env; the claude.ai names seen at start-up. |
| `src/core/metrics/record.mjs` | No team metrics record for a test try. |
| `src/core/stats.mjs` | Every query leaves test tries out. |
| `src/core/workflow-versions.mjs`, `src/core/onboarding.mjs`, `src/core/ask/tool-deps.mjs` | Run counts, onboarding ticks and Ask's people leave tries out (D22). |
| `src/core/mcp/test.mjs`, `src/core/mcp/store.mjs`, `src/core/mcp/registry.mjs`, `src/core/mcp/views.mjs` | A Test keeps each tool's description, input schema and annotations; old names-only results still load (D35). |
| `src/core/run-context.mjs`, `src/core/orchestrator.mjs`, `src/core/phases.mjs`, `src/core/engines/claude.mjs`, `src/core/graph/script-runner.mjs` | The stand-in hook before `mcp.json` is written, `--strict-mcp-config` for a pretend try, the script step's test env (D35). |
| `ui/server.mjs` | `_workflowTest` in `startRunHandler` (with its connectors mode); `invokeStartRun`'s `workflowTest`; the `isTest` guards, the launch error and `resumeRun` included; `tagExempt`; the auto-resume filter; the routes' registration and the connectors preview; the boot recovery; `_testing.invokeStartRun`. |
| `ui/public/index.html` | The Tests tab and `#wfv-tests`. |
| `ui/public/app.js` | The Tests controller (`wft*`), the WS frame, the run page's ⋯ item, `#workflows/<id>/tests/…` routes. |
| `ui/public/style.css` | `.wft-*` rules in the workflows section. |
| `src/shared/flags/registry.mjs`, `docs/feature-flags.md`, `docs/storage.md`, `docs/ui-levels.md`, `docs/changelog/unreleased.md` | Docs (Task 15). |
| `test/ui-workflows-markup.test.mjs` | The Tests tab in the top bar. |
| `test/ui-shared-controls.test.mjs` | `JS_CHECKBOX_OK` rows for the Part 2 pickers and opt-ins (Tasks 10, 12, 13). |
| `test/mcp-test.test.mjs` | A Test's result now holds tool records (Task 5). |

---

## Task 0: Baseline (no commit)

- [ ] **Step 1: Check the worktree and its `node_modules`**

Run (PowerShell):
```powershell
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests2 status --short --branch
git -C C:\Users\BRT1BG\worca-cc\worca-cc-tests2 config user.email
Test-Path C:\Users\BRT1BG\worca-cc\worca-cc-tests2\node_modules\jsdom
```
Expected: `## feat/workflow-tests-part2`, `tomica.brkovic@yahoo.com`, `True`. If `node_modules` is missing, make the junction as Part 1 did: `cmd /c mklink /J C:\Users\BRT1BG\worca-cc\worca-cc-tests2\node_modules C:\Users\BRT1BG\worca-cc\worca-cc-dev\node_modules`.

- [ ] **Step 2: Record a baseline of the files this part touches**

Run:
```powershell
cd C:\Users\BRT1BG\worca-cc\worca-cc-tests2; node tools/test.mjs test/db-migrate-v77.test.mjs test/db.test.mjs test/api-run-no-project.test.mjs test/orchestrator-no-project.test.mjs test/orchestrator-questions.test.mjs test/stats-groups.test.mjs test/stats-today.test.mjs test/stats-api.test.mjs test/api-workflow-versions.test.mjs test/ui-workflows-markup.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs test/ui-levels.test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/mcp-test.test.mjs test/mcp-views.test.mjs test/mcp-pipeline-run.test.mjs test/spawn-args.test.mjs test/claude-mcpjson-guard.test.mjs test/git-missing-wrappers.test.mjs test/api-run-tags.test.mjs
```
Expected: all pass, except the four known `ui-design-language` failures (the guide, the charts, a typed "+", the member rows). Note any other failure here: it is a baseline failure, not this part's.

---
## Task 1: What a good result needs: Basics, automatic checks, the verdict (pure, shared)

This comes before the store because the store validates examples with it.

**Files:**
- Create: `src/shared/workflow-tests/checks.mjs`
- Test: `test/workflow-test-checks.test.mjs`

**Interfaces:**
- Produces:
  - `CHECK_KINDS = ['words','sections','mentions','not-mentions','file','script']`, `TEXT_KINDS`, `CHECK_KIND_LABELS`, `DEFAULT_BASICS = { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null }`
  - `normText(s) → string`, `wordCount(text) → number`, `headingsOf(text) → string[]`
  - `normaliseCheck(raw) → { check: object|null, error: string|null }`. Check shapes:
    - `{ id?, kind:'words', min:int|null, max:int|null }`
    - `{ id?, kind:'sections', names:string[] }`
    - `{ id?, kind:'mentions'|'not-mentions', text }`
    - `{ id?, kind:'file', name }`
    - `{ id?, kind:'script', key, params:{} }`
  - `checkLabel(check, { scriptName? }) → string`; section names are joined by `andList(names) → 'A, B and C'` (C20)
  - `runCheck(check, { text, files }) → { met, value }`. Built-in kinds only; it throws for `script`.
  - `normaliseBasics(raw) → { basics, error }`, `basicsList(basics) → Array<{ key, label }>`
  - `judgeTry(example, facts, checkResults, result) → verdict`, where:
    - `facts = { status, costUsd, durationMs, sentBack, help: [{kind, question}], failReason }`
    - `verdict = { passed, basics: [{key,label,met,value,detail?}], checks: [{id,label,met,value,error?}], facts, result: { name, source, words } }`
  - `fmtUsd(n) → '$0.86'`

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-checks.test.mjs`:

```js
// test/workflow-test-checks.test.mjs — D18: the Basics and the built-in automatic checks, counted exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseCheck, checkLabel, runCheck, wordCount, headingsOf, normaliseBasics, basicsList, judgeTry, fmtUsd,
} from '../src/shared/workflow-tests/checks.mjs';

const BRIEF = ['# Bulk invoice export', '', '## Problem', 'Customers with more than 200 invoices wait.', '', '## Users',
  '- finance admins', '', '**Success metric:**', 'Cut tickets by 60%.', ''].join('\n');
const check = (raw) => normaliseCheck(raw).check;

test('words: tokens with a letter or a digit; markdown marks do not count', () => {
  assert.equal(wordCount('# Title\n\n- one two | three — 4'), 5);
  assert.equal(wordCount(''), 0);
  const c = check({ kind: 'words', min: 3, max: 5 });
  assert.deepEqual(runCheck(c, { text: 'one two three four' }), { met: true, value: '4 words' });
  assert.deepEqual(runCheck(c, { text: 'one two' }), { met: false, value: '2 words' });
});

test('sections: headings and bold-only lines, compared without case, numbering or a trailing colon', () => {
  assert.deepEqual(headingsOf(BRIEF), ['bulk invoice export', 'problem', 'users', 'success metric']);
  const c = check({ kind: 'sections', names: 'Problem, Users, Success metric, Risks' });
  assert.deepEqual(c.names, ['Problem', 'Users', 'Success metric', 'Risks']);
  assert.deepEqual(runCheck(c, { text: BRIEF }), { met: false, value: 'Missing Risks' });
  assert.deepEqual(runCheck({ ...c, names: ['Risks', 'Costs'] }, { text: BRIEF }), { met: false, value: 'Missing Risks and Costs' });
  assert.deepEqual(runCheck({ ...c, names: ['1. problem', 'USERS'] }, { text: BRIEF }), { met: true, value: 'Met' });
});

test('must and must not mention: case, spacing and curly quotes do not matter; no result is never met', () => {
  const m = check({ kind: 'mentions', text: 'more than 200' });
  const n = check({ kind: 'not-mentions', text: 'Lorem ipsum' });
  assert.deepEqual(runCheck(m, { text: BRIEF }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(n, { text: BRIEF }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(n, { text: 'LOREM   IPSUM dolor' }), { met: false, value: 'Not met' });
  assert.deepEqual(runCheck(check({ kind: 'mentions', text: 'it’s' }), { text: "it's here" }), { met: true, value: 'Met' });
  assert.deepEqual(runCheck(m, { text: null }), { met: false, value: 'No result' });
  assert.deepEqual(runCheck(n, { text: '  ' }), { met: false, value: 'No result' });
});

test('a file is in the result by its name or its path under work/', () => {
  const c = check({ kind: 'file', name: 'Summary.md' });
  assert.equal(runCheck(c, { files: ['work/out/summary.md'] }).met, true);
  assert.equal(runCheck(check({ kind: 'file', name: 'out/summary.md' }), { files: ['work/out/summary.md'] }).met, true);
  assert.equal(runCheck(c, { files: ['work/summary.txt'] }).met, false);
  assert.throws(() => runCheck(check({ kind: 'script', key: 'lint-md' }), {}), /not a built-in check/);
});

test('labels read like the board', () => {
  assert.equal(checkLabel(check({ kind: 'words', min: 400, max: 900 })), 'Length is 400 to 900 words');
  assert.equal(checkLabel(check({ kind: 'words', min: 400 })), 'Length is at least 400 words');
  assert.equal(checkLabel(check({ kind: 'words', max: '900' })), 'Length is at most 900 words');
  assert.equal(checkLabel(check({ kind: 'sections', names: ['Problem', 'Users', 'Success metric', 'Risks'] })), 'Has the sections Problem, Users, Success metric and Risks');
  assert.equal(checkLabel(check({ kind: 'sections', names: ['Problem', 'Risks'] })), 'Has the sections Problem and Risks');
  assert.equal(checkLabel(check({ kind: 'sections', names: ['Risks'] })), 'Has the section Risks');
  assert.equal(checkLabel(check({ kind: 'mentions', text: ' 200  invoices ' })), 'Mentions "200 invoices"');
  assert.equal(checkLabel(check({ kind: 'not-mentions', text: 'lorem' })), 'Does not mention "lorem"');
  assert.equal(checkLabel(check({ kind: 'file', name: 'summary.md' })), 'Has a file named summary.md');
  assert.equal(checkLabel(check({ kind: 'script', key: 'lint-md' }), { scriptName: 'Markdown lint' }), 'The Library script "Markdown lint" passes');
});

test('bad checks are refused with a plain reason; a valid id is kept', () => {
  assert.equal(normaliseCheck({ kind: 'words' }).error, 'give a smallest or a largest number of words');
  assert.equal(normaliseCheck({ kind: 'words', min: 10, max: 5 }).error, 'the smallest number of words is larger than the largest');
  assert.equal(normaliseCheck({ kind: 'sections', names: [' ', ''] }).error, 'name at least one section');
  assert.equal(normaliseCheck({ kind: 'file', name: '../x' }).error, 'give a file name inside the result, such as summary.md');
  assert.equal(normaliseCheck({ kind: 'script', key: '' }).error, 'pick a script from the Library');
  assert.equal(normaliseCheck({ kind: 'magic' }).error, 'unknown check kind "magic"');
  assert.deepEqual(normaliseCheck({ id: 'c_ab12', kind: 'mentions', text: 'x' }).check, { id: 'c_ab12', kind: 'mentions', text: 'x' });
  assert.deepEqual(normaliseCheck({ id: 'nope', kind: 'mentions', text: 'x' }).check, { kind: 'mentions', text: 'x' });
});

test('basics: defaults, limits and the board labels', () => {
  assert.deepEqual(normaliseBasics(undefined).basics, { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null });
  const { basics } = normaliseBasics({ noError: true, noHelp: false, maxCostUsd: '1.5', maxSentBack: 2 });
  assert.deepEqual(basicsList(basics).map((b) => b.label), ['Finishes without an error', 'Costs at most $1.50', 'Sent back for fixes at most 2 times']);
  assert.equal(basicsList({ ...basics, maxSentBack: 1 }).at(-1).label, 'Sent back for fixes at most once');
  assert.equal(basicsList({ ...basics, maxSentBack: 0 }).at(-1).label, 'Never sent back for fixes');
  assert.equal(normaliseBasics({ maxCostUsd: -1 }).error, 'the cost limit must be more than $0 and at most $10,000');
  assert.equal(normaliseBasics({ maxSentBack: 1.5 }).error, 'the fix limit must be a whole number from 0 to 50');
});

test('a try passes only when every Basic switched on and every check is met', () => {
  const example = { basics: { noError: true, noHelp: true, maxCostUsd: 1.5, maxSentBack: null } };
  const facts = { status: 'done', costUsd: 0.86, durationMs: 1000, sentBack: 1, help: [], failReason: null };
  const ok = judgeTry(example, facts, [{ id: 'c_1', label: 'Length is 400 to 900 words', met: true, value: '742 words' }],
    { name: 'brief.md', source: 'end-file', words: 742 });
  assert.equal(ok.passed, true);
  assert.deepEqual(ok.basics.map((b) => [b.label, b.met, b.value]), [
    ['Finishes without an error', true, 'Met'],
    ['Finishes without needing help from someone', true, 'Met'],
    ['Costs at most $1.50', true, '$0.86'],
  ]);
  assert.deepEqual(ok.result, { name: 'brief.md', source: 'end-file', words: 742 });
  const helped = judgeTry(example, { ...facts, help: [{ kind: 'questions', question: 'Which formats?' }] }, []);
  assert.equal(helped.passed, false);
  assert.equal(helped.basics[1].detail, 'Worca asked: "Which formats?"');
  const why = 'Worca asked "Who?", and this example has no answer for it.';
  const stopped = judgeTry(example, { ...facts, status: 'stopped', failReason: why }, []);
  assert.deepEqual([stopped.passed, stopped.basics[0].met, stopped.basics[0].detail], [false, false, why]);
  assert.equal(judgeTry(example, { ...facts, costUsd: 2 }, []).passed, false);
  assert.equal(judgeTry(example, facts, [{ id: 'c_1', label: 'x', met: false, value: 'Not met' }]).passed, false);
  const sent = judgeTry({ basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: 0 } }, { ...facts, sentBack: 1 }, []);
  assert.deepEqual(sent.basics.map((b) => [b.label, b.met, b.value]), [['Never sent back for fixes', false, '1 time']]);
  assert.equal(fmtUsd(10.26), '$10.26');
  assert.equal(fmtUsd(0.5), '$0.50');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-checks.test.mjs`
Expected: FAIL with `Cannot find module '../src/shared/workflow-tests/checks.mjs'`.

- [ ] **Step 3: Implement `src/shared/workflow-tests/checks.mjs`**

```js
// src/shared/workflow-tests/checks.mjs
// Workflow tests (plans/workflow-tests-part2-plan.md D18): what a good result needs. Pure and browser-safe: the Basics,
// the built-in automatic checks (counted exactly, without AI) and the verdict of one try. A Library script check is
// only validated and labelled here; src/core/workflow-tests/result.mjs runs it on the script bench.

export const CHECK_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions', 'file', 'script']);
/** The kinds that read the main result's text (D25). */
export const TEXT_KINDS = Object.freeze(['words', 'sections', 'mentions', 'not-mentions']);
export const CHECK_KIND_LABELS = Object.freeze({
  words: 'Length in words',
  sections: 'Has these sections',
  mentions: 'Must mention a text',
  'not-mentions': 'Must not mention a text',
  file: 'A file with this name is in the result',
  script: 'A Library script',
});
/** G11: no cost limit until the person sets one. */
export const DEFAULT_BASICS = Object.freeze({ noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null });

const WORDS_MAX = 1_000_000;
const SECTIONS_MAX = 20;
const TEXT_MAX = 200;
const SCRIPT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHECK_ID_RE = /^c_[a-z0-9]{1,24}$/;

export const fmtUsd = (n) => `$${(Math.round(Number(n || 0) * 100) / 100).toFixed(2)}`;

/** Lower case, NFKC, straight quotes, single spaces: how "must mention" texts and section names compare. */
export function normText(s) {
  return String(s ?? '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Words = whitespace-separated tokens holding a letter or a digit (markdown marks such as # - | do not count). */
export function wordCount(text) {
  return String(text ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const sectionKey = (s) => normText(s).replace(/^\d+[.)]\s*/, '').replace(/[\s:.\-–—]+$/u, '').trim();

/** The section keys of a markdown text: ATX headings (# …) and lines that are only bold (**…**). */
export function headingsOf(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const atx = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    const bold = atx ? null : /^\s*\*\*(.+?)\*\*\s*:?\s*$/.exec(line);
    const t = atx ? atx[1] : bold ? bold[1] : null;
    if (t) out.push(sectionKey(t));
  }
  return out;
}

const int = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const cleanText = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * One automatic check, checked and cleaned. A valid `id` (c_…) is kept; the store gives new checks one.
 * @returns {{check: object|null, error: string|null}}
 */
export function normaliseCheck(raw) {
  if (!raw || typeof raw !== 'object') return { check: null, error: 'a check must be an object' };
  const kind = raw.kind;
  if (!CHECK_KINDS.includes(kind)) return { check: null, error: `unknown check kind "${kind}"` };
  const id = typeof raw.id === 'string' && CHECK_ID_RE.test(raw.id) ? raw.id : null;
  const done = (fields) => ({ check: { ...(id ? { id } : {}), kind, ...fields }, error: null });
  if (kind === 'words') {
    const min = int(raw.min);
    const max = int(raw.max);
    for (const [k, v] of [['min', min], ['max', max]]) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > WORDS_MAX)) return { check: null, error: `${k} must be a whole number of words` };
    }
    if (min === null && max === null) return { check: null, error: 'give a smallest or a largest number of words' };
    if (min !== null && max !== null && min > max) return { check: null, error: 'the smallest number of words is larger than the largest' };
    return done({ min, max });
  }
  if (kind === 'sections') {
    const list = Array.isArray(raw.names) ? raw.names : typeof raw.names === 'string' ? raw.names.split(',') : [];
    const names = [...new Set(list.map(cleanText).filter(Boolean))];
    if (!names.length) return { check: null, error: 'name at least one section' };
    if (names.length > SECTIONS_MAX || names.some((n) => n.length > TEXT_MAX)) {
      return { check: null, error: `at most ${SECTIONS_MAX} sections of up to ${TEXT_MAX} characters` };
    }
    return done({ names });
  }
  if (kind === 'mentions' || kind === 'not-mentions') {
    const text = cleanText(raw.text);
    if (!text || text.length > TEXT_MAX) return { check: null, error: `the text must be 1 to ${TEXT_MAX} characters` };
    return done({ text });
  }
  if (kind === 'file') {
    const name = cleanText(raw.name).replace(/\\/g, '/');
    if (!name || name.length > TEXT_MAX || name.startsWith('/') || name.split('/').includes('..')) {
      return { check: null, error: 'give a file name inside the result, such as summary.md' };
    }
    return done({ name });
  }
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!SCRIPT_KEY_RE.test(key)) return { check: null, error: 'pick a script from the Library' };
  const params = {};
  if (raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)) {
    const entries = Object.entries(raw.params);
    if (entries.length > 20) return { check: null, error: 'at most 20 script settings' };
    for (const [k, v] of entries) {
      if (!['string', 'number', 'boolean'].includes(typeof v)) return { check: null, error: `script setting "${k}" must be text, a number or yes/no` };
      params[k] = v;
    }
  }
  return done({ key, params });
}

/** "A", "A and B", "A, B and C" (C20, D34). */
export const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The check in plain words, as the editor and the results list it (C5 for a script). */
export function checkLabel(check, { scriptName = null } = {}) {
  const c = check || {};
  if (c.kind === 'words') {
    if (c.min !== null && c.max !== null) return `Length is ${c.min} to ${c.max} words`;
    return c.min !== null ? `Length is at least ${c.min} words` : `Length is at most ${c.max} words`;
  }
  if (c.kind === 'sections') return c.names.length === 1 ? `Has the section ${c.names[0]}` : `Has the sections ${andList(c.names)}`;   // C20
  if (c.kind === 'mentions') return `Mentions "${c.text}"`;
  if (c.kind === 'not-mentions') return `Does not mention "${c.text}"`;
  if (c.kind === 'file') return `Has a file named ${c.name}`;
  if (c.kind === 'script') return `The Library script "${scriptName || c.key}" passes`;
  return 'Unknown check';
}

const fileMatches = (want, rel) => {
  const w = String(want).toLowerCase();
  const r = String(rel || '').replace(/\\/g, '/').replace(/^work\//, '').toLowerCase();
  return r === w || r.split('/').pop() === w;
};

/**
 * A built-in check on one try's result (D25). `text`: the main result (null when the try left none); `files`: the
 * result folder's paths (`work/…`). A script check is not run here: result.mjs runs it on the bench.
 * @returns {{met: boolean, value: string}}
 */
export function runCheck(check, { text = null, files = [] } = {}) {
  if (TEXT_KINDS.includes(check.kind) && (typeof text !== 'string' || !text.trim())) return { met: false, value: 'No result' };
  if (check.kind === 'words') {
    const n = wordCount(text);
    const met = (check.min === null || n >= check.min) && (check.max === null || n <= check.max);
    return { met, value: `${n} words` };
  }
  if (check.kind === 'sections') {
    const have = new Set(headingsOf(text));
    const missing = check.names.filter((n) => !have.has(sectionKey(n)));
    return missing.length ? { met: false, value: `Missing ${andList(missing)}` } : { met: true, value: 'Met' };
  }
  if (check.kind === 'mentions' || check.kind === 'not-mentions') {
    const found = normText(text).includes(normText(check.text));
    const met = check.kind === 'mentions' ? found : !found;
    return { met, value: met ? 'Met' : 'Not met' };
  }
  if (check.kind === 'file') {
    const met = (Array.isArray(files) ? files : []).some((f) => fileMatches(check.name, f));
    return { met, value: met ? 'Met' : 'Not met' };
  }
  throw new Error(`runCheck: "${check.kind}" is not a built-in check`);
}

/** @returns {{basics: object|null, error: string|null}} */
export function normaliseBasics(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const out = {
    noError: b.noError === undefined ? DEFAULT_BASICS.noError : b.noError === true,
    noHelp: b.noHelp === undefined ? DEFAULT_BASICS.noHelp : b.noHelp === true,
    maxCostUsd: num(b.maxCostUsd),
    maxSentBack: num(b.maxSentBack),
  };
  if (out.maxCostUsd !== null && !(Number.isFinite(out.maxCostUsd) && out.maxCostUsd > 0 && out.maxCostUsd <= 10000)) {
    return { basics: null, error: 'the cost limit must be more than $0 and at most $10,000' };
  }
  if (out.maxSentBack !== null && !(Number.isInteger(out.maxSentBack) && out.maxSentBack >= 0 && out.maxSentBack <= 50)) {
    return { basics: null, error: 'the fix limit must be a whole number from 0 to 50' };
  }
  return { basics: out, error: null };
}

const sentBackLabel = (n) => (n === 0 ? 'Never sent back for fixes' : `Sent back for fixes at most ${n === 1 ? 'once' : `${n} times`}`);

/** The Basics an example checks, in board order (only those switched on). */
export function basicsList(basics) {
  const b = basics || DEFAULT_BASICS;
  const out = [];
  if (b.noError) out.push({ key: 'noError', label: 'Finishes without an error' });
  if (b.noHelp) out.push({ key: 'noHelp', label: 'Finishes without needing help from someone' });
  if (b.maxCostUsd !== null && b.maxCostUsd !== undefined) out.push({ key: 'maxCostUsd', label: `Costs at most ${fmtUsd(b.maxCostUsd)}` });
  if (b.maxSentBack !== null && b.maxSentBack !== undefined) out.push({ key: 'maxSentBack', label: sentBackLabel(b.maxSentBack) });
  return out;
}

/**
 * The verdict of one try (D18): it passes only when every Basic switched on and every automatic check is met.
 * @param {{basics: object}} example
 * @param {{status: string, costUsd: number, durationMs: number|null, sentBack: number, help: Array<{kind:string, question:string}>, failReason: string|null}} facts
 * @param {Array<{id:string, label:string, met:boolean, value:string, error?:string}>} [checkResults]
 * @param {{name?: string|null, source?: string|null, words?: number|null}} [result]
 */
export function judgeTry(example, facts, checkResults = [], result = {}) {
  const f = facts || {};
  const b = (example && example.basics) || DEFAULT_BASICS;
  const finished = f.status === 'done' && !f.failReason;
  const help = Array.isArray(f.help) ? f.help : [];
  const basics = basicsList(b).map(({ key, label }) => {
    if (key === 'noError') {
      return { key, label, met: finished, value: finished ? 'Met' : 'Not met',
        ...(finished ? {} : { detail: f.failReason || `The try ended as ${f.status || 'unknown'}` }) };
    }
    if (key === 'noHelp') {
      return { key, label, met: help.length === 0, value: help.length === 0 ? 'Met' : 'Not met',
        ...(help.length ? { detail: `Worca asked: "${help[0].question}"` } : {}) };
    }
    if (key === 'maxCostUsd') return { key, label, met: Number(f.costUsd || 0) <= b.maxCostUsd, value: fmtUsd(f.costUsd) };
    const n = Number(f.sentBack || 0);
    return { key, label, met: n <= b.maxSentBack, value: n === 1 ? '1 time' : `${n} times` };
  });
  const checks = (Array.isArray(checkResults) ? checkResults : []).map((c) => ({ ...c }));
  return {
    passed: basics.every((x) => x.met) && checks.every((c) => c.met),
    basics,
    checks,
    facts: { status: f.status || null, costUsd: Number(f.costUsd || 0), durationMs: f.durationMs ?? null,
      sentBack: Number(f.sentBack || 0), help, failReason: f.failReason || null },
    result: { name: result.name ?? null, source: result.source ?? null, words: result.words ?? null },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `node tools/test.mjs test/workflow-test-checks.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/workflow-tests/checks.mjs test/workflow-test-checks.test.mjs
git commit -m "Workflow tests: Basics, the built-in automatic checks and the verdict of a try (D18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Schema v78 and the store

**Files:**
- Modify `src/core/db.mjs`:
  - `SCHEMA_VERSION` (:66)
  - `INCREMENTAL_COLUMNS.pipelines` (:840)
  - the new DDL after `WORKFLOW_REVISIONS_DDL` (:1345–1361)
  - `INCREMENTAL_TABLES` (after the `workflow_revisions` line, :1398)
  - the ladder line after `if (current < 77)` (:2549)
- Create: `src/core/workflow-tests/store.mjs`
- Test: `test/db-migrate-v78.test.mjs`, `test/workflow-test-store.test.mjs`

**Interfaces:**
- Produces, schema v78 (all FK-free, D31):
  - `wf_test_examples(id, workflow_id, name, request, answers, otherwise, basics, checks, tries, note, from_pipeline, from_use, from_verdict, created_by, created_at, updated_at)`
  - `wf_test_example_files(example_id, name, data BLOB, sha256, size)`
  - `wf_test_runs(id, workflow_id, kind, a_use, b_use, a_fp, b_fp, example_ids, tries, quick, cap_usd, connectors, status, stop_reason, stop_detail, started_by, created_at, finished_at)`
  - `wf_test_tries(id, run_id, workflow_id, example_id, use_ref, fp, example_fp, try_no, mock, connectors, status, run_key, pipeline_id, verdict, cost_usd, started_at, finished_at)`
  - `connectors` is `'pretend'` (default) or `'real'` (D35)
  - `wf_test_run_tries(run_id, try_id, side)`
  - `pipelines.is_test INTEGER`
- Produces, `store.mjs`:
  - Constants: `OTHERWISE`, `TRY_COUNTS = [1,3,5]`, `MAX_TRIES = 10`, `FILE_MAX_BYTES`, `FILES_MAX`, `FINISHED = ['passed','failed']`, `CONNECTOR_MODES = ['pretend','real']`
  - `testError(message, code, extra?)`, with codes `BAD_REQUEST | NOT_FOUND | BUSY | NOT_TESTABLE | NOT_VERSIONABLE`
  - `parseUse(v) → 'draft'|n|null`, `useRef(use) → 'draft'|'3'`, `useOf(ref)`
  - `normaliseExample(input) → { value, errors }`, `exampleFingerprint(ex) → 16 hex`
  - Examples:
    - `createExample(workflowId, input, { by, from? }) → example`
    - `readExample(workflowId, id) → example|null`
    - `listExamples(workflowId) → example[]`
    - `updateExample(workflowId, id, input) → example`
    - `deleteExample(workflowId, id) → true`
    - `putExampleFile(workflowId, id, { name, data }) → example`
    - `deleteExampleFile(workflowId, id, name) → example`
    - `readExampleFiles(exampleId) → [{ name, data: Buffer }]`
    - `example = { id, workflowId, name, request, answers:[{question,answer}], otherwise, basics, checks, tries, note, from: null|{pipelineId,use,verdict}, files:[{name,size,sha256}], createdBy, createdAt, updatedAt, fingerprint }`
  - Test runs:
    - `createTestRun({ workflowId, kind, a, b, aFp, bFp, exampleIds, tries, quick, capUsd, connectors = 'pretend', by }) → run`
    - `readTestRun(id)`, `listTestRuns(workflowId, { limit })`, `runningTestRun(workflowId)`, `updateTestRun(id, patch)`
    - `run = { id, workflowId, kind:'compare'|'once', a, b, aFp, bFp, exampleIds, tries, quick: null|{status,detail?}, capUsd, connectors, status:'running'|'done'|'stopped', stopReason, stopDetail, startedBy, createdAt, finishedAt }`
  - Tries:
    - `insertTry({ runId, workflowId, exampleId, use, fp, exampleFp, tryNo, mock, connectors = 'pretend' }) → try`
    - `readTry(id)`, `updateTry(id, patch)`, `linkTry(runId, tryId, side)`, `unlinkTry(runId, tryId)`
    - `triesOfRun(runId) → try[]` (each with `side`), `spentOfRun(runId) → number`
    - `reusableTries({ workflowId, exampleId, use, fp, exampleFp, mock, connectors = 'pretend', limit })`, `latestTriesFor({ workflowId, exampleId, use })`
    - `recoverInterruptedTestRuns() → { runs, tries }`: running tries become `stopped` with their run's cost so far; their pipelines lose their resume point (review M4)
    - `try = { id, runId, workflowId, exampleId, use, fp, exampleFp, tryNo, mock, connectors, status:'waiting'|'running'|'passed'|'failed'|'stopped', runKey, pipelineId, verdict, costUsd, startedAt, finishedAt, side? }`

- [ ] **Step 1: Write the failing migration test.** Create `test/db-migrate-v78.test.mjs`:

```js
// test/db-migrate-v78.test.mjs — workflow tests, Part 2 (plans/workflow-tests-part2-plan.md Task 2): five tables + pipelines.is_test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const stamp = (db) => db.prepare('PRAGMA user_version').get().user_version;
const TABLES = {
  wf_test_examples: ['id', 'workflow_id', 'name', 'request', 'answers', 'otherwise', 'basics', 'checks', 'tries', 'note',
    'from_pipeline', 'from_use', 'from_verdict', 'created_by', 'created_at', 'updated_at'],
  wf_test_example_files: ['example_id', 'name', 'data', 'sha256', 'size'],
  wf_test_runs: ['id', 'workflow_id', 'kind', 'a_use', 'b_use', 'a_fp', 'b_fp', 'example_ids', 'tries', 'quick', 'cap_usd',
    'connectors', 'status', 'stop_reason', 'stop_detail', 'started_by', 'created_at', 'finished_at'],
  wf_test_tries: ['id', 'run_id', 'workflow_id', 'example_id', 'use_ref', 'fp', 'example_fp', 'try_no', 'mock', 'connectors', 'status',
    'run_key', 'pipeline_id', 'verdict', 'cost_usd', 'started_at', 'finished_at'],
  wf_test_run_tries: ['run_id', 'try_id', 'side'],
};

test('fresh DB: the workflow test tables exist and pipelines has is_test', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 78);
  for (const [t, want] of Object.entries(TABLES)) assert.deepEqual(cols(db, t), want, t);
  assert.ok(cols(db, 'pipelines').includes('is_test'));
});

test('a DB stamped 77 without them gets them all and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE pipelines DROP COLUMN is_test;
    ${Object.keys(TABLES).map((t) => `DROP TABLE ${t};`).join('\n')}
    PRAGMA user_version = 77`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  for (const [t, want] of Object.entries(TABLES)) assert.deepEqual(cols(db, t), want, t);
  assert.ok(cols(db, 'pipelines').includes('is_test'));
});

test('a try is linked to a run at most once', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const link = db.prepare("INSERT INTO wf_test_run_tries (run_id, try_id, side) VALUES (1, 7, 'b')");
  link.run();
  assert.throws(() => link.run(), /UNIQUE|PRIMARY/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/db-migrate-v78.test.mjs`
Expected: FAIL: `SCHEMA_VERSION >= 78` is false.

- [ ] **Step 3: Implement the schema in `src/core/db.mjs`**

Change :66 to:
```js
export const SCHEMA_VERSION = 78;
```
In `INCREMENTAL_COLUMNS.pipelines`, change its last line, the `release_error: 'TEXT' },  // v66: why creating it failed (not retried)` just above `pipeline_steps:` (db.mjs:859; the same text at :898 belongs to `shape_features` and stays), to:
```js
                            release_error: 'TEXT',    // v66: why creating it failed (not retried)
                            is_test: 'INTEGER' },     // v78 (workflow tests D21/D22): 1 = a test try, hidden from lists, Statistics, metrics; NULL = a normal run
```
After the `WORKFLOW_REVISIONS_DDL` constant, add:
```js
// v78 (plans/workflow-tests-part2-plan.md D31): workflow tests. Examples (+ their files as BLOBs), test runs, tries and
// the tries a run shows (its own and the ones it reused). FK-free like workflow_revisions: a deleted workflow keeps its
// examples, and they come back with a workflow saved again under the same id.
const WORKFLOW_TESTS_DDL = `
CREATE TABLE IF NOT EXISTS wf_test_examples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  request       TEXT NOT NULL DEFAULT '',
  answers       TEXT NOT NULL DEFAULT '[]',
  otherwise     TEXT NOT NULL DEFAULT 'pick',
  basics        TEXT NOT NULL DEFAULT '{}',
  checks        TEXT NOT NULL DEFAULT '[]',
  tries         INTEGER NOT NULL DEFAULT 3,
  note          TEXT,
  from_pipeline TEXT,
  from_use      TEXT,
  from_verdict  TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wf_test_examples_wf ON wf_test_examples (workflow_id, id);
CREATE TABLE IF NOT EXISTS wf_test_example_files (
  example_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  data       BLOB NOT NULL,
  sha256     TEXT NOT NULL,
  size       INTEGER NOT NULL,
  PRIMARY KEY (example_id, name)
);
CREATE TABLE IF NOT EXISTS wf_test_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'compare',
  a_use       TEXT,
  b_use       TEXT NOT NULL,
  a_fp        TEXT,
  b_fp        TEXT NOT NULL,
  example_ids TEXT NOT NULL DEFAULT '[]',
  tries       INTEGER NOT NULL,
  quick       TEXT,
  cap_usd     REAL,
  connectors  TEXT NOT NULL DEFAULT 'pretend',
  status      TEXT NOT NULL,
  stop_reason TEXT,
  stop_detail TEXT,
  started_by  TEXT,
  created_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_test_runs_wf ON wf_test_runs (workflow_id, id);
CREATE TABLE IF NOT EXISTS wf_test_tries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL,
  workflow_id TEXT NOT NULL,
  example_id  INTEGER NOT NULL,
  use_ref     TEXT NOT NULL,
  fp          TEXT NOT NULL,
  example_fp  TEXT NOT NULL,
  try_no      INTEGER NOT NULL,
  mock        INTEGER NOT NULL DEFAULT 0,
  connectors  TEXT NOT NULL DEFAULT 'pretend',
  status      TEXT NOT NULL,
  run_key     TEXT,
  pipeline_id TEXT,
  verdict     TEXT,
  cost_usd    REAL NOT NULL DEFAULT 0,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wf_test_tries_reuse ON wf_test_tries (workflow_id, example_id, use_ref, fp, example_fp);
CREATE INDEX IF NOT EXISTS idx_wf_test_tries_run ON wf_test_tries (run_id);
CREATE TABLE IF NOT EXISTS wf_test_run_tries (
  run_id INTEGER NOT NULL,
  try_id INTEGER NOT NULL,
  side   TEXT NOT NULL,
  PRIMARY KEY (run_id, try_id)
);`;
```
In `INCREMENTAL_TABLES`, after the `workflow_revisions` line, add:
```js
  wf_test_examples:      WORKFLOW_TESTS_DDL,   // v78 (workflow tests Part 2)
  wf_test_example_files: WORKFLOW_TESTS_DDL,
  wf_test_runs:          WORKFLOW_TESTS_DDL,
  wf_test_tries:         WORKFLOW_TESTS_DDL,
  wf_test_run_tries:     WORKFLOW_TESTS_DDL,
```
In `migrate()`, after the `if (current < 77) …` line, add:
```js
    if (current < 78) db.exec(WORKFLOW_TESTS_DDL);   // v78 workflow tests; pipelines.is_test comes from INCREMENTAL_COLUMNS
```

- [ ] **Step 4: Run the migration tests**

Run: `node tools/test.mjs test/db-migrate-v78.test.mjs test/db-migrate-v77.test.mjs test/db.test.mjs`
Expected: PASS. If `test/db-migrate-v77.test.mjs` pins `SCHEMA_VERSION === 77` anywhere, change that line to `>= 77`, the way Part 1's v77 test is written.

- [ ] **Step 5: Write the failing store test.** Create `test/workflow-test-store.test.mjs`:

```js
// test/workflow-test-store.test.mjs — examples, files, runs and tries (plans/workflow-tests-part2-plan.md Task 2, D26, D31).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';

const homes = [];
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftstore-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const WF = 'wf_brief';
const input = (over = {}) => ({
  name: 'Bulk invoice export', request: 'Write the product brief for a bulk invoice export.',
  answers: [{ question: 'Which file formats?', answer: 'PDF and CSV, in one ZIP file.' }],
  otherwise: 'pick', basics: { noError: true, noHelp: true, maxCostUsd: 1.5 },
  checks: [{ kind: 'words', min: 400, max: 900 }], tries: 3, ...over,
});

test('create, read, list and update an example; new checks get an id', () => {
  const ex = store.createExample(WF, input(), { by: 'Tomica' });
  assert.equal(ex.name, 'Bulk invoice export');
  assert.match(ex.checks[0].id, /^c_[0-9a-f]{10}$/);
  assert.deepEqual(ex.basics, { noError: true, noHelp: true, maxCostUsd: 1.5, maxSentBack: null });
  assert.equal(ex.createdBy, 'Tomica');
  assert.match(ex.fingerprint, /^[0-9a-f]{16}$/);
  assert.deepEqual(store.listExamples(WF).map((e) => e.id), [ex.id]);
  const up = store.updateExample(WF, ex.id, { name: 'Bulk export', tries: 5 });
  assert.deepEqual([up.name, up.tries, up.checks[0].id], ['Bulk export', 5, ex.checks[0].id]);
  assert.equal(store.readExample('wf_other', ex.id), null);
  assert.throws(() => store.updateExample(WF, 999, {}), { code: 'NOT_FOUND' });
  assert.throws(() => store.createExample(WF, input({ name: ' ' })), { code: 'BAD_REQUEST', message: 'the name must be 1 to 120 characters' });
  assert.throws(() => store.createExample(WF, input({ tries: 4 })), { message: 'tries must be 1, 3 or 5' });
  assert.throws(() => store.createExample(WF, input({ checks: [{ kind: 'words' }] })), { message: 'give a smallest or a largest number of words' });
});

test('the fingerprint follows what a try gets and how it is judged, not the name, note or tries (D26)', () => {
  const ex = store.createExample(WF, input());
  const same = (over) => store.updateExample(WF, ex.id, over).fingerprint;
  assert.equal(same({ name: 'Renamed', note: 'A note', tries: 1 }), ex.fingerprint);
  assert.notEqual(same({ request: 'Another request' }), ex.fingerprint);
  const b = store.updateExample(WF, ex.id, { request: ex.request });
  assert.equal(b.fingerprint, ex.fingerprint);
  assert.notEqual(same({ otherwise: 'fail' }), ex.fingerprint);
  store.updateExample(WF, ex.id, { otherwise: 'pick' });
  assert.notEqual(store.putExampleFile(WF, ex.id, { name: 'notes.md', data: Buffer.from('# Notes') }).fingerprint, ex.fingerprint);
});

test('files: stored as bytes, replaced by name, refused when too large, too many or oddly named', () => {
  const ex = store.createExample(WF, input());
  let e = store.putExampleFile(WF, ex.id, { name: 'interview-notes.md', data: Buffer.from('hello') });
  assert.deepEqual(e.files.map((f) => [f.name, f.size]), [['interview-notes.md', 5]]);
  e = store.putExampleFile(WF, ex.id, { name: 'interview-notes.md', data: Buffer.from('hello again') });
  assert.equal(e.files[0].size, 11);
  assert.deepEqual(store.readExampleFiles(ex.id).map((f) => [f.name, f.data.toString()]), [['interview-notes.md', 'hello again']]);
  assert.throws(() => store.putExampleFile(WF, ex.id, { name: '../x.md', data: Buffer.from('x') }), { code: 'BAD_REQUEST' });
  assert.throws(() => store.putExampleFile(WF, ex.id, { name: 'big.bin', data: Buffer.alloc(store.FILE_MAX_BYTES + 1) }), { message: 'big.bin is larger than 5 MB' });
  for (let i = 1; i < store.FILES_MAX; i += 1) store.putExampleFile(WF, ex.id, { name: `f${i}.txt`, data: Buffer.from('x') });
  assert.throws(() => store.putExampleFile(WF, ex.id, { name: 'one-more.txt', data: Buffer.from('x') }), { message: 'an example has at most 8 files' });
  assert.equal(store.deleteExampleFile(WF, ex.id, 'f1.txt').files.length, store.FILES_MAX - 1);
});

test('uses are stored as text: draft or a version number', () => {
  assert.deepEqual([store.parseUse('draft'), store.parseUse('4'), store.parseUse(4), store.parseUse('0'), store.parseUse('x')], ['draft', 4, 4, null, null]);
  assert.deepEqual([store.useRef('draft'), store.useRef(4), store.useOf('4'), store.useOf('draft')], ['draft', '4', 4, 'draft']);
});

test('runs and tries: reuse only finished tries with the same fingerprints, mock setting and connectors mode', () => {
  const ex = store.createExample(WF, input());
  const run = store.createTestRun({ workflowId: WF, a: 4, b: 'draft', aFp: 'fa', bFp: 'fb', exampleIds: [ex.id], tries: 3, capUsd: 15, by: 'Tomica' });
  assert.deepEqual([run.a, run.b, run.status, run.exampleIds, run.capUsd, run.connectors], [4, 'draft', 'running', [ex.id], 15, 'pretend']);
  assert.equal(store.createTestRun({ workflowId: 'wf_real', b: 'draft', bFp: 'x', exampleIds: [ex.id], tries: 1, connectors: 'real' }).connectors, 'real');
  assert.equal(store.runningTestRun(WF).id, run.id);
  const mk = (n, status, over = {}) => {
    const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 4, fp: 'fa', exampleFp: ex.fingerprint, tryNo: n, ...over });
    store.linkTry(run.id, t.id, 'a');
    return store.updateTry(t.id, { status, costUsd: 0.5, finishedAt: `2026-10-26T10:0${n}:00Z`, verdict: { passed: status === 'passed' } });
  };
  mk(1, 'passed'); mk(2, 'failed'); mk(3, 'stopped'); mk(4, 'passed', { mock: true }); mk(5, 'passed', { connectors: 'real' });
  const reuse = (over = {}) => store.reusableTries({ workflowId: WF, exampleId: ex.id, use: 4, fp: 'fa', exampleFp: ex.fingerprint, mock: false, limit: 3, ...over });
  assert.deepEqual(reuse().map((t) => t.tryNo), [2, 1]);
  assert.deepEqual(reuse({ fp: 'changed' }), []);
  assert.deepEqual(reuse({ exampleFp: 'changed' }), []);
  assert.deepEqual(reuse({ mock: true }).map((t) => t.tryNo), [4]);
  assert.deepEqual(reuse({ connectors: 'real' }).map((t) => [t.tryNo, t.connectors]), [[5, 'real']], 'D35: pretend and real are never reused for each other');
  assert.equal(store.readTry(reuse()[0].id).connectors, 'pretend');
  assert.equal(store.spentOfRun(run.id), 2.5);
  assert.deepEqual(store.triesOfRun(run.id).map((t) => [t.tryNo, t.side]), [[1, 'a'], [2, 'a'], [3, 'a'], [4, 'a'], [5, 'a']]);
  assert.deepEqual(store.latestTriesFor({ workflowId: WF, exampleId: ex.id, use: 4 }).map((t) => t.status), ['passed', 'failed', 'passed', 'passed']);
  const done = store.updateTestRun(run.id, { status: 'done', finishedAt: '2026-10-26T11:00:00Z' });
  assert.deepEqual([done.status, done.stopReason], ['done', null]);
  assert.equal(store.runningTestRun(WF), null);
});

test('deleting an example refuses while a test tries it; a restart stops running tests and tries, keeps their cost, drops their resume point', () => {
  const ex = store.createExample(WF, input());
  const run = store.createTestRun({ workflowId: WF, a: 1, b: 'draft', aFp: 'a', bFp: 'b', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'b', exampleFp: ex.fingerprint, tryNo: 1 });
  store.updateTry(t.id, { status: 'running', pipelineId: 'abcd1234' });
  // The try's run, as the boot reconcile leaves it: interrupted, with a resume point and what it spent so far.
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, is_test, resume_point, total_cost_usd)
    VALUES ('abcd1234', 'no-project-00000000', 'interrupted', 1, '{"version":2}', 0.75)`).run();
  assert.throws(() => store.deleteExample(WF, ex.id), { code: 'BUSY' });
  const out = store.recoverInterruptedTestRuns();
  assert.deepEqual([out.runs, out.tries], [1, [{ id: t.id, pipelineId: 'abcd1234' }]]);
  assert.deepEqual([store.readTestRun(run.id).status, store.readTestRun(run.id).stopReason, store.readTry(t.id).status], ['stopped', 'restart', 'stopped']);
  assert.equal(store.readTry(t.id).costUsd, 0.75, 'its cost so far counts in the test (Finish the rest checks the cap with it)');
  assert.equal(getDb().prepare("SELECT resume_point FROM pipelines WHERE id = 'abcd1234'").get().resume_point, null, 'a try never resumes, so nothing pins it');
  assert.equal(store.deleteExample(WF, ex.id), true);
  assert.equal(store.readExample(WF, ex.id), null);
  assert.deepEqual(store.readExampleFiles(ex.id), []);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-store.test.mjs`
Expected: FAIL with `Cannot find module '../src/core/workflow-tests/store.mjs'`.

- [ ] **Step 7: Implement `src/core/workflow-tests/store.mjs`**

```js
// src/core/workflow-tests/store.mjs
// Workflow tests storage (plans/workflow-tests-part2-plan.md Task 2, schema v78, D26, D31): examples and their files,
// test runs, tries, and the tries a run shows. Every write validates; reads never throw on bad JSON.
import { createHash, randomBytes } from 'node:crypto';
import { getDb, prepare, tx } from '../db.mjs';
import { canon } from '../../shared/graph/diff-graphs.mjs';
import { normaliseCheck, normaliseBasics, DEFAULT_BASICS } from '../../shared/workflow-tests/checks.mjs';

export const OTHERWISE = Object.freeze(['pick', 'fail']);
export const TRY_COUNTS = Object.freeze([1, 3, 5]);
export const MAX_TRIES = 10;
export const FILE_MAX_BYTES = 5 * 1024 * 1024;
export const FILES_MAX = 8;
export const FINISHED = Object.freeze(['passed', 'failed']);
/** D35: a test's tries use stand-ins for the connectors ('pretend', the default) or the real ones. */
export const CONNECTOR_MODES = Object.freeze(['pretend', 'real']);
const modeOf = (v) => (v === 'real' ? 'real' : 'pretend');
const NAME_MAX = 120;
const REQUEST_MAX = 100_000;
const ANSWERS_MAX = 50;
const CHECKS_MAX = 20;
const NOTE_MAX = 2000;
const FILE_NAME_RE = /^[^\\/:*?"<>|\u0000-\u001f]{1,120}$/;

export function testError(message, code, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };
const nowIso = () => new Date().toISOString();

/** 'draft' or a version number, from a route, a query or a body; null when it is neither (D23). */
export function parseUse(v) {
  if (v === 'draft') return 'draft';
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[1-9]\d{0,8}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
export const useRef = (use) => (use === 'draft' ? 'draft' : String(use));
export const useOf = (ref) => parseUse(ref);

/**
 * The editable fields of an example, checked. Missing fields take their defaults; new checks get an id.
 * @returns {{value: object|null, errors: string[]}}
 */
export function normaliseExample(input = {}) {
  const errors = [];
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > NAME_MAX) errors.push(`the name must be 1 to ${NAME_MAX} characters`);
  const request = typeof input.request === 'string' ? input.request : '';
  if (request.length > REQUEST_MAX) errors.push(`the request is longer than ${REQUEST_MAX} characters`);
  const answers = [];
  const rawAnswers = input.answers === undefined ? [] : input.answers;
  if (!Array.isArray(rawAnswers) || rawAnswers.length > ANSWERS_MAX) errors.push(`at most ${ANSWERS_MAX} questions and answers`);
  else {
    for (const a of rawAnswers) {
      const question = a && typeof a.question === 'string' ? a.question.trim() : '';
      const answer = a && typeof a.answer === 'string' ? a.answer.trim() : '';
      if (!question || question.length > 500 || !answer || answer.length > 2000) {
        errors.push('each question needs an answer: up to 500 characters for the question and 2000 for the answer');
        break;
      }
      answers.push({ question, answer });
    }
  }
  const otherwise = input.otherwise === undefined ? 'pick' : input.otherwise;
  if (!OTHERWISE.includes(otherwise)) errors.push('otherwise must be "pick" or "fail"');
  const { basics, error: basicsError } = normaliseBasics(input.basics);
  if (basicsError) errors.push(basicsError);
  const checks = [];
  const rawChecks = input.checks === undefined ? [] : input.checks;
  if (!Array.isArray(rawChecks) || rawChecks.length > CHECKS_MAX) errors.push(`at most ${CHECKS_MAX} automatic checks`);
  else {
    for (const raw of rawChecks) {
      const { check, error } = normaliseCheck(raw);
      if (error) { errors.push(error); break; }
      checks.push(check.id ? check : { id: `c_${randomBytes(5).toString('hex')}`, ...check });
    }
  }
  const tries = input.tries === undefined ? 3 : Number(input.tries);
  if (!TRY_COUNTS.includes(tries)) errors.push('tries must be 1, 3 or 5');
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, NOTE_MAX) : null;
  if (errors.length) return { value: null, errors };
  return { value: { name, request, answers, otherwise, basics, checks, tries, note }, errors: [] };
}

/** D26: what a try depends on — what Worca gets and how it is judged. Not the name, the note or the number of tries. */
export function exampleFingerprint(ex) {
  const files = (ex.files || []).map((f) => [f.name, f.sha256]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const checks = (ex.checks || []).map(({ id: _id, ...c }) => c);
  return createHash('sha256')
    .update(canon({ r: ex.request, f: files, a: ex.answers, o: ex.otherwise, b: ex.basics, c: checks }))
    .digest('hex').slice(0, 16);
}

const EX_COLS = `id, workflow_id, name, request, answers, otherwise, basics, checks, tries, note, from_pipeline, from_use,
  from_verdict, created_by, created_at, updated_at`;
function filesOf(exampleId) {
  return prepare('SELECT name, size, sha256 FROM wf_test_example_files WHERE example_id = ? ORDER BY name').all(exampleId)
    .map((f) => ({ name: f.name, size: Number(f.size), sha256: f.sha256 }));
}
function exampleOf(r) {
  if (!r) return null;
  const ex = {
    id: Number(r.id), workflowId: r.workflow_id, name: r.name, request: r.request,
    answers: parse(r.answers, []), otherwise: r.otherwise,
    basics: normaliseBasics(parse(r.basics, {})).basics || { ...DEFAULT_BASICS },
    checks: parse(r.checks, []), tries: Number(r.tries), note: r.note ?? null,
    from: r.from_pipeline ? { pipelineId: r.from_pipeline, use: r.from_use ? useOf(r.from_use) : null, verdict: r.from_verdict ?? null } : null,
    files: filesOf(Number(r.id)), createdBy: r.created_by ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
  return { ...ex, fingerprint: exampleFingerprint(ex) };
}
const invalid = (errors) => testError(errors[0], 'BAD_REQUEST', { errors });

/** @param {{by?: string|null, from?: {pipelineId: string, use: 'draft'|number|null, verdict: 'good'|'not-good'|null}|null}} [opts] */
export function createExample(workflowId, input, { by = null, from = null } = {}) {
  const { value, errors } = normaliseExample(input);
  if (!value) throw invalid(errors);
  getDb();
  const at = nowIso();
  const info = prepare(`INSERT INTO wf_test_examples (workflow_id, name, request, answers, otherwise, basics, checks, tries, note,
      from_pipeline, from_use, from_verdict, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(workflowId, value.name, value.request, JSON.stringify(value.answers), value.otherwise, JSON.stringify(value.basics),
      JSON.stringify(value.checks), value.tries, value.note, from ? from.pipelineId : null,
      from && from.use != null ? useRef(from.use) : null, from ? from.verdict ?? null : null, by, at, at);
  return readExample(workflowId, Number(info.lastInsertRowid));
}

export function readExample(workflowId, id) {
  getDb();
  return exampleOf(prepare(`SELECT ${EX_COLS} FROM wf_test_examples WHERE workflow_id = ? AND id = ?`).get(workflowId, Number(id)));
}

export function listExamples(workflowId) {
  getDb();
  return prepare(`SELECT ${EX_COLS} FROM wf_test_examples WHERE workflow_id = ? ORDER BY id`).all(workflowId).map(exampleOf);
}

function requireExample(workflowId, id) {
  const ex = readExample(workflowId, id);
  if (!ex) throw testError(`no example ${id}`, 'NOT_FOUND');
  return ex;
}

/** Fields left out of `input` keep their value. */
export function updateExample(workflowId, id, input = {}) {
  const was = requireExample(workflowId, id);
  const { value, errors } = normaliseExample({ ...was, ...input });
  if (!value) throw invalid(errors);
  prepare(`UPDATE wf_test_examples SET name = ?, request = ?, answers = ?, otherwise = ?, basics = ?, checks = ?, tries = ?, note = ?,
      updated_at = ? WHERE workflow_id = ? AND id = ?`)
    .run(value.name, value.request, JSON.stringify(value.answers), value.otherwise, JSON.stringify(value.basics),
      JSON.stringify(value.checks), value.tries, value.note, nowIso(), workflowId, was.id);
  return readExample(workflowId, was.id);
}

export function deleteExample(workflowId, id) {
  const ex = requireExample(workflowId, id);
  const run = runningTestRun(workflowId);
  if (run && run.exampleIds.includes(ex.id)) throw testError('a test is trying this example: stop it first', 'BUSY');
  tx(() => {
    prepare('DELETE FROM wf_test_example_files WHERE example_id = ?').run(ex.id);
    prepare('DELETE FROM wf_test_examples WHERE workflow_id = ? AND id = ?').run(workflowId, ex.id);
  });
  return true;
}

export function putExampleFile(workflowId, id, { name, data } = {}) {
  const ex = requireExample(workflowId, id);
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!FILE_NAME_RE.test(clean) || clean === '.' || clean === '..') throw testError('give the file a plain name, such as notes.md', 'BAD_REQUEST');
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (!buf.length) throw testError(`${clean} is empty`, 'BAD_REQUEST');
  if (buf.length > FILE_MAX_BYTES) throw testError(`${clean} is larger than 5 MB`, 'BAD_REQUEST');
  if (!ex.files.some((f) => f.name === clean) && ex.files.length >= FILES_MAX) throw testError(`an example has at most ${FILES_MAX} files`, 'BAD_REQUEST');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  tx(() => {
    prepare(`INSERT INTO wf_test_example_files (example_id, name, data, sha256, size) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(example_id, name) DO UPDATE SET data = excluded.data, sha256 = excluded.sha256, size = excluded.size`)
      .run(ex.id, clean, buf, sha256, buf.length);
    prepare('UPDATE wf_test_examples SET updated_at = ? WHERE id = ?').run(nowIso(), ex.id);
  });
  return readExample(workflowId, ex.id);
}

export function deleteExampleFile(workflowId, id, name) {
  const ex = requireExample(workflowId, id);
  if (!ex.files.some((f) => f.name === name)) throw testError(`no file ${name}`, 'NOT_FOUND');
  tx(() => {
    prepare('DELETE FROM wf_test_example_files WHERE example_id = ? AND name = ?').run(ex.id, name);
    prepare('UPDATE wf_test_examples SET updated_at = ? WHERE id = ?').run(nowIso(), ex.id);
  });
  return readExample(workflowId, ex.id);
}

/** The bytes a try sends as its extras. */
export function readExampleFiles(exampleId) {
  getDb();
  return prepare('SELECT name, data FROM wf_test_example_files WHERE example_id = ? ORDER BY name').all(Number(exampleId))
    .map((f) => ({ name: f.name, data: Buffer.from(f.data) }));
}

// ── Test runs ───────────────────────────────────────────────────────────────
const RUN_COLS = `id, workflow_id, kind, a_use, b_use, a_fp, b_fp, example_ids, tries, quick, cap_usd, connectors, status, stop_reason,
  stop_detail, started_by, created_at, finished_at`;
function runOf(r) {
  if (!r) return null;
  return {
    id: Number(r.id), workflowId: r.workflow_id, kind: r.kind, a: r.a_use == null ? null : useOf(r.a_use), b: useOf(r.b_use),
    aFp: r.a_fp ?? null, bFp: r.b_fp, exampleIds: parse(r.example_ids, []).map(Number), tries: Number(r.tries),
    quick: parse(r.quick, null), capUsd: r.cap_usd ?? null, connectors: modeOf(r.connectors), status: r.status, stopReason: r.stop_reason ?? null,
    stopDetail: r.stop_detail ?? null, startedBy: r.started_by ?? null, createdAt: r.created_at, finishedAt: r.finished_at ?? null,
  };
}

export function createTestRun({ workflowId, kind = 'compare', a = null, b, aFp = null, bFp, exampleIds, tries, quick = null, capUsd = null,
  connectors = 'pretend', by = null }) {
  getDb();
  const info = prepare(`INSERT INTO wf_test_runs (workflow_id, kind, a_use, b_use, a_fp, b_fp, example_ids, tries, quick, cap_usd,
      connectors, status, started_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`)
    .run(workflowId, kind, a == null ? null : useRef(a), useRef(b), aFp, bFp, JSON.stringify(exampleIds), tries,
      quick ? JSON.stringify(quick) : null, capUsd, modeOf(connectors), by, nowIso());
  return readTestRun(Number(info.lastInsertRowid));
}

export function readTestRun(id) {
  getDb();
  return runOf(prepare(`SELECT ${RUN_COLS} FROM wf_test_runs WHERE id = ?`).get(Number(id)));
}

/** Newest first. */
export function listTestRuns(workflowId, { limit = 20 } = {}) {
  getDb();
  return prepare(`SELECT ${RUN_COLS} FROM wf_test_runs WHERE workflow_id = ? ORDER BY id DESC LIMIT ?`).all(workflowId, limit).map(runOf);
}

export function runningTestRun(workflowId) {
  getDb();
  return runOf(prepare(`SELECT ${RUN_COLS} FROM wf_test_runs WHERE workflow_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1`).get(workflowId));
}

const RUN_PATCH = { status: 'status', stopReason: 'stop_reason', stopDetail: 'stop_detail', quick: 'quick', capUsd: 'cap_usd', finishedAt: 'finished_at' };
export function updateTestRun(id, patch = {}) {
  const sets = []; const vals = [];
  for (const [k, col] of Object.entries(RUN_PATCH)) {
    if (patch[k] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(k === 'quick' && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]);
  }
  if (sets.length) { getDb(); prepare(`UPDATE wf_test_runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, Number(id)); }
  return readTestRun(id);
}

// ── Tries ───────────────────────────────────────────────────────────────────
const TRY_COLS = `t.id, t.run_id, t.workflow_id, t.example_id, t.use_ref, t.fp, t.example_fp, t.try_no, t.mock, t.connectors, t.status,
  t.run_key, t.pipeline_id, t.verdict, t.cost_usd, t.started_at, t.finished_at`;
function tryOf(r) {
  if (!r) return null;
  return {
    id: Number(r.id), runId: Number(r.run_id), workflowId: r.workflow_id, exampleId: Number(r.example_id), use: useOf(r.use_ref),
    fp: r.fp, exampleFp: r.example_fp, tryNo: Number(r.try_no), mock: !!r.mock, connectors: modeOf(r.connectors), status: r.status,
    runKey: r.run_key ?? null, pipelineId: r.pipeline_id ?? null, verdict: parse(r.verdict, null), costUsd: Number(r.cost_usd || 0),
    startedAt: r.started_at ?? null, finishedAt: r.finished_at ?? null, ...(r.side ? { side: r.side } : {}),
  };
}

export function insertTry({ runId, workflowId, exampleId, use, fp, exampleFp, tryNo, mock = false, connectors = 'pretend' }) {
  getDb();
  const info = prepare(`INSERT INTO wf_test_tries (run_id, workflow_id, example_id, use_ref, fp, example_fp, try_no, mock, connectors, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`)
    .run(Number(runId), workflowId, Number(exampleId), useRef(use), fp, exampleFp, tryNo, mock ? 1 : 0, modeOf(connectors));
  return readTry(Number(info.lastInsertRowid));
}

export function readTry(id) {
  getDb();
  return tryOf(prepare(`SELECT ${TRY_COLS} FROM wf_test_tries t WHERE t.id = ?`).get(Number(id)));
}

const TRY_PATCH = { status: 'status', runKey: 'run_key', pipelineId: 'pipeline_id', verdict: 'verdict', costUsd: 'cost_usd',
  startedAt: 'started_at', finishedAt: 'finished_at' };
export function updateTry(id, patch = {}) {
  const sets = []; const vals = [];
  for (const [k, col] of Object.entries(TRY_PATCH)) {
    if (patch[k] === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(k === 'verdict' && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]);
  }
  if (sets.length) { getDb(); prepare(`UPDATE wf_test_tries SET ${sets.join(', ')} WHERE id = ?`).run(...vals, Number(id)); }
  return readTry(id);
}

export function linkTry(runId, tryId, side) {
  getDb();
  prepare('INSERT OR IGNORE INTO wf_test_run_tries (run_id, try_id, side) VALUES (?, ?, ?)').run(Number(runId), Number(tryId), side);
}

export function unlinkTry(runId, tryId) {
  getDb();
  prepare('DELETE FROM wf_test_run_tries WHERE run_id = ? AND try_id = ?').run(Number(runId), Number(tryId));
}

/** The tries a run shows: its own and the ones it reused, each with its side ('a' | 'b'). */
export function triesOfRun(runId) {
  getDb();
  return prepare(`SELECT ${TRY_COLS}, l.side AS side FROM wf_test_run_tries l JOIN wf_test_tries t ON t.id = l.try_id
      WHERE l.run_id = ? ORDER BY l.side, t.example_id, t.try_no, t.id`).all(Number(runId)).map(tryOf);
}

/** What a run's own tries cost, stopped ones included (D27). Reused tries cost this run nothing. */
export function spentOfRun(runId) {
  getDb();
  const r = prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM wf_test_tries WHERE run_id = ?').get(Number(runId));
  return Math.round(Number(r.s || 0) * 1e6) / 1e6;
}

/** D26: finished tries of `use` on one example that a new test may reuse, newest first. The connectors mode is part of the key (D35). */
export function reusableTries({ workflowId, exampleId, use, fp, exampleFp, mock = false, connectors = 'pretend', limit }) {
  getDb();
  return prepare(`SELECT ${TRY_COLS} FROM wf_test_tries t WHERE t.workflow_id = ? AND t.example_id = ? AND t.use_ref = ?
      AND t.fp = ? AND t.example_fp = ? AND t.mock = ? AND t.connectors = ? AND t.status IN ('passed', 'failed')
      ORDER BY t.finished_at DESC, t.id DESC LIMIT ?`)
    .all(workflowId, Number(exampleId), useRef(use), fp, exampleFp, mock ? 1 : 0, modeOf(connectors), Math.max(0, Number(limit) || 0)).map(tryOf);
}

/** The finished tries of `use` on one example in the newest run that showed any (the Tests list's cells). */
export function latestTriesFor({ workflowId, exampleId, use }) {
  getDb();
  const last = prepare(`SELECT MAX(l.run_id) AS r FROM wf_test_run_tries l JOIN wf_test_tries t ON t.id = l.try_id
      WHERE t.workflow_id = ? AND t.example_id = ? AND t.use_ref = ? AND t.status IN ('passed', 'failed')`)
    .get(workflowId, Number(exampleId), useRef(use));
  if (!last || last.r == null) return [];
  return prepare(`SELECT ${TRY_COLS} FROM wf_test_run_tries l JOIN wf_test_tries t ON t.id = l.try_id
      WHERE l.run_id = ? AND t.example_id = ? AND t.use_ref = ? AND t.status IN ('passed', 'failed') ORDER BY t.id`)
    .all(last.r, Number(exampleId), useRef(use)).map(tryOf);
}

/**
 * D27: after a restart nothing drives a running test any more. Its running tries are stopped with what their run spent
 * so far (the cap check of "Finish the rest" counts it), and every try's run loses its resume point: resumeRun refuses a
 * try, so a kept point would only pin a plugin workflow (plugin-workflows.mjs) forever. Called by the server's
 * bootMaintenance, after the stale-run reconcile.
 */
export function recoverInterruptedTestRuns(now = nowIso()) {
  getDb();
  const out = { runs: 0, tries: [] };
  tx(() => {
    out.tries = prepare("SELECT id, pipeline_id FROM wf_test_tries WHERE status = 'running' ORDER BY id").all()
      .map((r) => ({ id: Number(r.id), pipelineId: r.pipeline_id ?? null }));
    prepare(`UPDATE wf_test_tries SET status = 'stopped', finished_at = ?,
        cost_usd = COALESCE((SELECT p.total_cost_usd FROM pipelines p WHERE p.id = wf_test_tries.pipeline_id), cost_usd)
      WHERE status = 'running'`).run(now);
    out.runs = Number(prepare("UPDATE wf_test_runs SET status = 'stopped', stop_reason = 'restart', finished_at = ? WHERE status = 'running'")
      .run(now).changes);
    prepare("UPDATE pipelines SET resume_point = NULL WHERE is_test = 1 AND status IN ('paused', 'interrupted') AND resume_point IS NOT NULL").run();
  });
  return out;
}
```

- [ ] **Step 8: Run the tests**

Run: `node tools/test.mjs test/workflow-test-store.test.mjs test/db-migrate-v78.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/db.mjs src/core/workflow-tests/store.mjs test/db-migrate-v78.test.mjs test/workflow-test-store.test.mjs
git commit -m "Workflow tests: schema v78 (examples, files, runs, tries, pipelines.is_test) and the store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 3: Nobody watches a try: canned answers and the question listener

**Files:**
- Create: `src/core/workflow-tests/answers.mjs`
- Test: `test/workflow-test-answers.test.mjs`

**Interfaces:**
- Consumes:
  - `autoAnswerPayload`, `autoChoice` (exported from `src/core/run-harness.mjs:713`, `:725`)
  - `PLAN_ASK_KIND` (`src/core/shape/run.mjs:7`)
- Produces:
  - `TRY_ANSWERED_BY = 'workflow-test'`, the `by` recorded on every answer
  - `normQuestion(s) → string`, `findAnswer(question, answers) → string|null`
  - `planAnswer(q, { answers, otherwise }) → { kind: 'answer', payload, help: [{question}] } | { kind: 'fail', reason, help }`
  - `attachAnswerer(orch, example, { answer(id, payload) → boolean, onHelp({kind, question}), onFail(reason), defer? }) → detach()`

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-answers.test.mjs`:

```js
// test/workflow-test-answers.test.mjs — D24: every question a try meets gets the example's answer, or its rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { planAnswer, findAnswer, normQuestion, attachAnswerer } from '../src/core/workflow-tests/answers.mjs';

const example = {
  answers: [
    { question: 'Which file formats should the export have?', answer: 'PDF and CSV, in one ZIP file.' },
    { question: 'Who is allowed to export?', answer: 'Finance admins' },
  ],
  otherwise: 'pick',
};
const tick = () => new Promise((r) => setImmediate(r));

test('questions match whatever the case, spacing and punctuation', () => {
  assert.equal(normQuestion('  Who IS allowed, to export?? '), 'who is allowed to export');
  assert.equal(findAnswer('who is allowed to export', example.answers), 'Finance admins');
  assert.equal(findAnswer('Who may export?', example.answers), null);
  const p = planAnswer({ kind: 'questions', questions: [{ id: 'q1', question: 'which file formats should the export have', options: [], allowFreeText: true }] }, example);
  assert.deepEqual(p, { kind: 'answer', payload: { answers: [{ id: 'q1', choice: 'PDF and CSV, in one ZIP file.' }] }, help: [] });
});

test('an answer equal to an option picks the option; free text only where it is allowed', () => {
  const q = { kind: 'clarify', questions: [{ id: 'q2', question: 'Who is allowed to export?', options: ['Everyone', 'finance admins.'], allowFreeText: false }] };
  assert.deepEqual(planAnswer(q, example).payload.answers, [{ id: 'q2', choice: 'finance admins.' }]);
  const noFree = { kind: 'questions', questions: [{ id: 'q3', question: 'Which file formats should the export have?', options: ['PDF', 'CSV'], allowFreeText: false, recommended: 'CSV' }] };
  assert.deepEqual(planAnswer(noFree, example), {
    kind: 'answer', payload: { answers: [{ id: 'q3', choice: 'CSV' }] }, help: [{ question: 'Which file formats should the export have?' }],
  });
});

test('nothing matches: Worca picks a sensible answer and it counts as help, or the try counts as failed', () => {
  const q = { kind: 'questions', questions: [{ id: 'q9', question: 'Which screens come first?', options: ['Settings', 'Home'] }] };
  assert.deepEqual(planAnswer(q, example), { kind: 'answer', payload: { answers: [{ id: 'q9', choice: 'Settings' }] }, help: [{ question: 'Which screens come first?' }] });
  assert.deepEqual(planAnswer(q, { ...example, otherwise: 'fail' }), {
    kind: 'fail', reason: 'Worca asked "Which screens come first?", and this example has no answer for it.', help: [{ question: 'Which screens come first?' }],
  });
});

test('gates continue; a recovery prompt or a plan approval stops the try; a form follows the rule', () => {
  assert.deepEqual(planAnswer({ kind: 'gate', id: 'g' }, example), { kind: 'answer', payload: { decision: 'continue' }, help: [] });
  const rec = planAnswer({ kind: 'recovery', recovery: { message: 'claude exited 1\nstack…' } }, example);
  assert.deepEqual([rec.kind, rec.reason, rec.help], ['fail', 'The try hit a problem it could not get past: claude exited 1', [{ question: 'How to go on after a problem' }]]);
  assert.equal(planAnswer({ kind: 'plan' }, example).reason, 'Worca asked a person to approve a plan.');
  const form = { kind: 'form', form: 'release', title: 'Release details', autoValues: { tag: 'v1' } };
  const picked = planAnswer(form, example);
  assert.deepEqual([picked.kind, picked.payload.values, picked.help], ['answer', { tag: 'v1' }, [{ question: 'Release details' }]]);
  assert.equal(planAnswer(form, { ...example, otherwise: 'fail' }).reason, 'Worca asked to fill in "Release details", and this example has no answers for forms.');
});

test('attachAnswerer answers on the next turn, reports help, fails once, and detaches', async () => {
  const orch = new EventEmitter();
  const sent = []; const help = []; const fails = [];
  const detach = attachAnswerer(orch, example, {
    answer: (id, p) => { sent.push([id, p]); return true; }, onHelp: (h) => help.push(h), onFail: (r) => fails.push(r),
  });
  orch.emit('question', { id: 'a1', kind: 'questions', questions: [{ id: 'q1', question: 'Who is allowed to export?', options: [] }] });
  assert.equal(sent.length, 0, 'not in the same turn: the harness installs pendingQuestion after the emit');
  await tick();
  assert.deepEqual(sent, [['a1', { answers: [{ id: 'q1', choice: 'Finance admins' }] }]]);
  orch.emit('question', { id: 'r1', kind: 'recovery', recovery: { message: 'boom' } });
  assert.deepEqual(fails, ['The try hit a problem it could not get past: boom']);
  assert.deepEqual(help, [{ kind: 'recovery', question: 'How to go on after a problem' }]);
  detach();
  orch.emit('question', { id: 'g2', kind: 'gate' });
  await tick();
  assert.equal(sent.length, 1, 'detached');
});

test('an answer the run did not take, or refused, fails the try', async () => {
  const orch = new EventEmitter(); const fails = [];
  attachAnswerer(orch, example, { answer: () => false, onFail: (r) => fails.push(r) });
  orch.emit('question', { id: 'g1', kind: 'gate' });
  await tick();
  const thrower = new EventEmitter();
  attachAnswerer(thrower, example, { answer: () => { throw new Error('invalid answer'); }, onFail: (r) => fails.push(r) });
  thrower.emit('question', { id: 'g2', kind: 'gate' });
  await tick();
  assert.deepEqual(fails, ["Worca's answer was not taken: the run no longer waited for it.", "Worca's answer was refused: invalid answer"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-answers.test.mjs`
Expected: FAIL with `Cannot find module '../src/core/workflow-tests/answers.mjs'`.

- [ ] **Step 3: Implement `src/core/workflow-tests/answers.mjs`**

```js
// src/core/workflow-tests/answers.mjs
// Nobody watches a test try (plans/workflow-tests-part2-plan.md D24). Every question gets the example's answer, or the
// example's "If Worca asks something else" rule: Worca picks a sensible answer (the --yes answer), or the try counts as
// failed. A question the example had no answer for is "help": it fails the Basic "Finishes without needing help from
// someone". Gates are the workflow's own stops and continue; a recovery prompt or a plan approval needs a person, so the
// try stops.
import { autoAnswerPayload, autoChoice } from '../run-harness.mjs';
import { PLAN_ASK_KIND } from '../shape/run.mjs';

export const TRY_ANSWERED_BY = 'workflow-test';

/** NFKC, lower case, no punctuation or symbols, single spaces. */
export function normQuestion(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** The example's answer to this question, matched on normalised text, or null. */
export function findAnswer(question, answers) {
  const want = normQuestion(question);
  if (!want) return null;
  const hit = (Array.isArray(answers) ? answers : []).find((a) => a && normQuestion(a.question) === want);
  return hit ? hit.answer : null;
}

const quote = (s) => `"${String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}"`;

/**
 * How a try answers one question.
 * @param {{kind: string, questions?: Array, recovery?: {message?: string}, title?: string}} q the harness's `question` payload
 * @param {{answers?: Array<{question: string, answer: string}>, otherwise?: 'pick'|'fail'}} example
 */
export function planAnswer(q, { answers = [], otherwise = 'pick' } = {}) {
  const kind = q && q.kind;
  if (kind === 'questions' || kind === 'clarify') {
    const out = [];
    const help = [];
    for (const item of Array.isArray(q.questions) ? q.questions : []) {
      const canned = findAnswer(item.question, answers);
      let choice = null;
      if (canned != null) {
        const opt = (Array.isArray(item.options) ? item.options : []).find((o) => typeof o === 'string' && normQuestion(o) === normQuestion(canned));
        choice = opt ?? (item.allowFreeText !== false ? canned : null);
      }
      if (choice == null) {
        help.push({ question: String(item.question || '') });
        if (otherwise === 'fail') return { kind: 'fail', reason: `Worca asked ${quote(item.question)}, and this example has no answer for it.`, help };
        choice = autoChoice(item);
      }
      out.push({ id: item.id, choice });
    }
    return { kind: 'answer', payload: { answers: out }, help };
  }
  if (kind === 'gate') return { kind: 'answer', payload: { decision: 'continue' }, help: [] };
  if (kind === 'recovery') {
    const first = q.recovery && q.recovery.message ? String(q.recovery.message).split('\n')[0].slice(0, 200) : '';
    return { kind: 'fail', reason: `The try hit a problem it could not get past${first ? `: ${first}` : '.'}`, help: [{ question: 'How to go on after a problem' }] };
  }
  if (kind === PLAN_ASK_KIND) return { kind: 'fail', reason: 'Worca asked a person to approve a plan.', help: [{ question: 'Approve the plan' }] };
  if (kind === 'form') {
    const help = [{ question: String(q.title || 'Fill in a form') }];
    if (otherwise === 'fail') return { kind: 'fail', reason: `Worca asked to fill in ${quote(q.title || 'a form')}, and this example has no answers for forms.`, help };
    return { kind: 'answer', payload: autoAnswerPayload(q), help };
  }
  return { kind: 'answer', payload: autoAnswerPayload(q), help: [] };
}

/**
 * Answer every question `orch` asks during one try. `answer(id, payload)` returns false when the run no longer waits on
 * that question. `onHelp` fires per question the example had no answer for; `onFail` fires when the try must stop.
 * `question` is emitted BEFORE the harness installs pendingQuestion (run-harness.mjs _ask), so the answer goes out on
 * the next turn (`defer` = setImmediate), the pattern of test/orchestrator-questions.test.mjs:173.
 * @returns {() => void} detach
 */
export function attachAnswerer(orch, example, { answer, onHelp = () => {}, onFail = () => {}, defer = setImmediate } = {}) {
  const handler = (q) => {
    let plan;
    try { plan = planAnswer(q, example || {}); } catch (err) { onFail(`Worca could not answer a question: ${err && err.message ? err.message : err}`); return; }
    for (const h of plan.help) onHelp({ kind: q.kind, question: h.question });
    if (plan.kind === 'fail') { onFail(plan.reason); return; }
    defer(() => {
      let ok = false;
      try { ok = answer(q.id, plan.payload) !== false; } catch (err) { onFail(`Worca's answer was refused: ${err && err.message ? err.message : err}`); return; }
      if (!ok) onFail("Worca's answer was not taken: the run no longer waited for it.");
    });
  };
  orch.on('question', handler);
  return () => orch.off('question', handler);
}
```

- [ ] **Step 4: Run the test**

Run: `node tools/test.mjs test/workflow-test-answers.test.mjs test/orchestrator-questions.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow-tests/answers.mjs test/workflow-test-answers.test.mjs
git commit -m "Workflow tests: a try answers questions from its example, or follows its rule (D24)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: One try = one hidden no-project run (the try starter and isolation)

**Files:**
- Create: `src/core/workflow-tests/try-body.mjs`, the D20 seam
- Modify `src/core/artifacts.mjs`:
  - `createPipeline` (:1177, destructure + the `writeState` call :1315)
  - `writeState` (:1430–1458)
  - a new `isTestPipeline` after `readPipelineStateById` (:2881)
  - `listPipelines` (:2443, its WHERE)
  - `listAllPipelines` (:2500, its WHERE)
  - `countPipelines` (:2592)
- Modify `src/core/run-harness.mjs`: the artifacts import (:26–31), the Away mode switches `this._night = {` (:1133–1136), the `createPipeline` call (:1539), and `_mountMemory` (:4123).
- Modify: `src/core/metrics/record.mjs`, the import (:10) and `recordImpl` (:453).
- Modify: `src/core/workflow-versions.mjs` `runCounts` (:123–129), `src/core/onboarding.mjs` the `run` and `realRun` ticks (:108–109), `src/core/ask/tool-deps.mjs` `listPeople` (:33–34). Review I1, M6.
- Modify `src/core/stats.mjs`:
  - the import (:22–25)
  - `filterSql` (:78)
  - `SHAPING_SELECT` (:130)
  - `ledgerSpend` (:191)
  - `peopleInUse` (:209)
  - `ledgerByRun` (:352)
  - `budgetWindowSavings` (:448)
  - `getStats` (:546)
- Modify `ui/server.mjs`:
  - the artifacts import (:39)
  - `resolvePending` (:1225)
  - `wireRun` (:1367–1374 notifier, :1381 record, :1500 limit resume)
  - `summarizeRuns` (:1277)
  - `startRunHandler` (:2523 the internal options, :2704 `assertRunnableWorkflow`, :2756 `tagExempt`, :2895 the no-project `createOrchestratorFor`, :2911 the entry, :3270 after `wireRun`, :3313 `announceRun`, :3318–3327 the `entry.launch` `.catch`)
  - `invokeStartRun` (:3704)
  - `stopPausedPipelineOnce` (:4784)
  - `resumeRun` (:5720, right after `if (!saved) …`)
  - `autoResumeOnBoot` (:11857)
  - `_testing` (:19077)
- Test: `test/workflow-test-isolation.test.mjs` (unit), `test/api-workflow-test-try.test.mjs` (server, mock)

**Interfaces:**
- Produces:
  - `testTargetOf(graph, registry) → { testable: boolean, reason: null|'needs-project' }`
  - `tryTitle(example, tryNo) → 'Test: <name> · try <n>'`
  - `tryRunBody(example, files, { workflowId, tryNo, mock?, quick? }) → /api/run body` (`noProject`, `workflowId`, `prompt`, `title`, `extras`, `mock?`)
  - `createPipeline(dir, { …, isTest })`, `writeState(dir, state, { …, isTest })`, `isTestPipeline(id) → boolean`
  - Run options `workflowTest: true`, `noMemory: true` (harness `opts`); a test try's Away mode override is `'off'`
  - `invokeStartRun(body, internal, { …, workflowTest })`, where `workflowTest = { use: 'draft'|n, onOrch?(orch, { runKey }) }` (Task 5 adds `connectors`). Server-only, via `req._workflowTest`. The entry gets `isTest: true`.
  - `resumeRun` of a test row throws `ResumeError(409, { error: 'A test try cannot be resumed: finish the rest from its test.' })`
  - `_testing.invokeStartRun`

- [ ] **Step 1: Write the failing unit test.** Create `test/workflow-test-isolation.test.mjs`:

```js
// test/workflow-test-isolation.test.mjs — D21/D22: a test try is marked once and every reader leaves it out, except the
// spending limit. Also the D20 seam (try-body.mjs).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { createPipeline, writeState, isTestPipeline, listAllPipelines, countPipelines, findPipelineRowById } from '../src/core/artifacts.mjs';
import { getStats } from '../src/core/stats.mjs';
import { recordCostDelta, budgetStatus } from '../src/core/cost-budget.mjs';
import { recordRunMetrics } from '../src/core/metrics/record.mjs';
import { listPeople } from '../src/core/ask/tool-deps.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createVersion, versionsOverview } from '../src/core/workflow-versions.mjs';
import { projectKey } from '../src/core/store.mjs';
import { testTargetOf, tryRunBody, tryTitle } from '../src/core/workflow-tests/try-body.mjs';

delete process.env.WORCA_MOCK;   // isMockRun would answer 'mock' before the test check
const homes = [];
let projectDir;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftiso-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
  projectDir = join(dir, 'proj');
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

async function seed({ isTest = false, by = null, usd = 0 } = {}) {
  const { id, dir } = await createPipeline(projectDir, { prompt: 'p', title: isTest ? 'Test: x · try 1' : 'normal', startedBy: by, isTest });
  const now = new Date().toISOString();
  // projectKey binds the NOT NULL column on the INSERT arm of writeState's upsert (test/helpers/db-seed.mjs).
  await writeState(dir, { projectKey: projectKey(projectDir), id, status: 'done', startedAt: now, updatedAt: now, totalCostUsd: usd, steps: [] });
  if (usd) recordCostDelta({ pipelineId: id, amountUsd: usd });
  return id;
}

test('the mark is written once, at creation, and survives every later write', async () => {
  const t = await seed({ isTest: true });
  const n = await seed();
  assert.equal(isTestPipeline(t), true);
  assert.equal(isTestPipeline(n), false);
  assert.equal(findPipelineRowById(t).is_test, 1);
  assert.equal(findPipelineRowById(n).is_test, null);
  assert.equal(isTestPipeline('nope0000'), false);
});

test('lists and counts leave test tries out', async () => {
  const t = await seed({ isTest: true });
  const n = await seed();
  const ids = (await listAllPipelines({ lite: true })).map((p) => p.id);
  assert.ok(ids.includes(n));
  assert.ok(!ids.includes(t));
  assert.equal(countPipelines(), 1);
});

test('Statistics leaves out their runs, spend and people; the spending limit still counts them', async () => {
  await seed({ isTest: true, by: 'tester@example.com', usd: 2 });
  await seed({ by: 'person@example.com', usd: 1 });
  const s = getStats({ range: 'month' });
  assert.equal(s.totals.runs, 1);
  assert.equal(s.totals.pipelineSpendUsd, 1);
  assert.ok(!s.people.some((p) => p.includes('tester')));
  assert.equal(getStats({ range: 'all' }).totals.pipelineSpendUsd, 1);
  assert.equal(budgetStatus().windowSpendUsd, 3);
  assert.deepEqual(listPeople().map((p) => p.name), ['person@example.com'], "Ask's people list leaves the tester out (M6)");
});

test('the Versions page counts no test try as a run of a version (review I1)', async () => {
  const md = join(process.env.WORCA_HOME, 'planner.md');
  await writeFile(md, 'Plan it.');
  const deps = { registry: { planner: { key: 'planner', origin: 'builtin', agentPath: md, displayName: 'Planner' } }, scripts: {} };
  await writeGraphWorkflow({ id: 'wf_iso', name: 'Iso', domain: 'product',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }] });
  await createVersion('wf_iso', { deps });
  const stepper = JSON.stringify({ template: { id: 'wf_iso', name: 'Iso' }, workflowVersion: { no: 1 } });
  for (const id of [await seed({ isTest: true }), await seed({ isTest: true }), await seed()]) {
    getDb().prepare('UPDATE pipelines SET stepper = ? WHERE id = ?').run(stepper, id);
  }
  assert.equal((await versionsOverview('wf_iso', { deps })).versions[0].runs, 1, 'two tries of v1 and one normal run: 1 run');
});

test('team metrics record no test try', async () => {
  const t = await seed({ isTest: true });
  const out = await recordRunMetrics({ pipeline: { id: t }, opts: {}, claude: { mock: false }, projectDir }, { status: 'done' });
  assert.deepEqual(out, { recorded: false, reason: 'test' });
  const live = await recordRunMetrics({ pipeline: { id: 'abcd0000' }, opts: { workflowTest: true }, claude: { mock: false }, projectDir }, { status: 'done' });
  assert.equal(live.reason, 'test');
});

test('try-body: a workflow that needs a project cannot be tested yet; the run body of one try', () => {
  const graph = { nodes: [{ id: 'n1', kind: 'agent', key: 'coder' }] };
  assert.deepEqual(testTargetOf(graph, { coder: { needsRepo: true } }), { testable: false, reason: 'needs-project' });
  assert.deepEqual(testTargetOf(graph, { coder: {} }), { testable: true, reason: null });
  const ex = { name: 'Bulk invoice export', request: 'Write the brief.' };
  assert.equal(tryTitle(ex, 2), 'Test: Bulk invoice export · try 2');
  assert.deepEqual(tryRunBody(ex, [{ name: 'notes.md', data: Buffer.from('hi') }], { workflowId: 'wf_b', tryNo: 2 }), {
    noProject: true, workflowId: 'wf_b', prompt: 'Write the brief.', title: 'Test: Bulk invoice export · try 2',
    extras: [{ name: 'notes.md', dataBase64: Buffer.from('hi').toString('base64') }],
  });
  const quick = tryRunBody(ex, [], { workflowId: 'wf_b', tryNo: 0, quick: true });
  assert.deepEqual([quick.title, quick.mock], ['Quick check: Bulk invoice export', true]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-isolation.test.mjs`
Expected: FAIL with `does not provide an export named 'isTestPipeline'` (and the missing try-body module).

- [ ] **Step 3: Create `src/core/workflow-tests/try-body.mjs`**

```js
// src/core/workflow-tests/try-body.mjs
// THE seam for what a try runs on (plans/workflow-tests-part2-plan.md D20). Part 2 tries a workflow without a project,
// in the run's own private work folder. The next part (project and coding workflows) replaces testTargetOf and
// tryRunBody; nothing else in the runner knows where a try runs.
import { graphNeedsRepo } from '../workflows.mjs';

/** @returns {{testable: boolean, reason: null|'needs-project'}} */
export function testTargetOf(graph, registry) {
  return graphNeedsRepo(graph, registry) ? { testable: false, reason: 'needs-project' } : { testable: true, reason: null };
}

/** A fixed title (smart naming never runs for a try, correction 6). */
export function tryTitle(example, tryNo) {
  return `Test: ${example.name} · try ${tryNo}`;
}

/**
 * The /api/run body of one try, startRunHandler's shape. The files ride base64 as `extras`, as the New run form sends
 * them. The draft or the version (`use`) travels in-process through invokeStartRun's workflowTest, never in this body.
 * @param {{name: string, request: string}} example
 * @param {Array<{name: string, data: Buffer}>} files
 * @param {{workflowId: string, tryNo: number, mock?: boolean, quick?: boolean}} opts quick = the free quick check (a mock run)
 */
export function tryRunBody(example, files, { workflowId, tryNo, mock = false, quick = false }) {
  return {
    noProject: true,
    workflowId,
    prompt: example.request,
    title: quick ? `Quick check: ${example.name}` : tryTitle(example, tryNo),
    extras: (files || []).map((f) => ({ name: f.name, dataBase64: Buffer.from(f.data).toString('base64') })),
    ...(mock || quick ? { mock: true } : {}),
  };
}
```

- [ ] **Step 4: Mark and filter in `src/core/artifacts.mjs`**

In `createPipeline`'s destructure, add `isTest = false` to the first line:
```js
    prompt, promptFile, extras = [], title, isTest = false,
```
and change its `writeState` call to:
```js
  await writeState(dir, state, { prWatchRunId, runSetup, isTest });
```
In `writeState`, change the signature to `export async function writeState(pipelineDir, stateObj, { prWatchRunId = null, runSetup = null, isTest = false } = {}) {`. In its INSERT, add `is_test` at the end of the column list (`…, run_size, run_setup, is_test)`) and `@is_test` at the end of the VALUES (`…,@run_size,@run_setup,@is_test)`). Leave the `ON CONFLICT … DO UPDATE SET` list unchanged, so the mark is creation-only. Change the run call to:
```js
    `).run({ ...toPipelineRow(obj), run_setup: typeof runSetup === 'string' ? runSetup : null, is_test: isTest ? 1 : null });
```
After `readPipelineStateById`, add:
```js
/** Workflow tests (D21/D22): whether a pipeline is a test try, hidden from the Runs lists, Statistics and team metrics. */
export function isTestPipeline(id) {
  if (typeof id !== 'string' || !id) return false;
  const row = getDb().prepare('SELECT is_test FROM pipelines WHERE id = ?').get(id.toLowerCase());
  return !!(row && row.is_test);
}
```
In `listPipelines`, change its WHERE line to:
```js
    WHERE ${workspaceKey ? 'workspace_key = ?' : 'project_key = ?'} AND archived_at IS NULL AND is_test IS NULL
```
In `listAllPipelines`:
```js
    WHERE archived_at IS ${opts.archived ? 'NOT NULL' : 'NULL'} AND deleted_at IS NULL AND is_test IS NULL
```
In `countPipelines`:
```js
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM pipelines WHERE archived_at IS ${archived ? 'NOT ' : ''}NULL AND is_test IS NULL`).get();
```

- [ ] **Step 5: The harness writes the mark and never mounts memory for a try (`src/core/run-harness.mjs`)**

Add `isTestPipeline` to the `./artifacts.mjs` import list (:26–31). In the `createPipeline(this.projectDir, {` call (:1539), after `runSetup: …,`, add:
```js
        ...(this.opts.workflowTest === true ? { isTest: true } : {}),   // D21/D22: a test try, marked once
```
In `_mountMemory`, right after `if (!this.pipeline?.dir) return;`, add:
```js
    // D19: a test try uses no memory. Nothing is mounted, so this.memory stays null and _syncMemory never writes back.
    // The row check covers a resumed try (its opts no longer carry noMemory).
    if (this.opts.noMemory === true || isTestPipeline(this.pipeline.id)) return;
```
In the Away mode switches (`this._night = {`, :1133), change the `override:` line to:
```js
      // Workflow tests (review M5): Away mode never answers a try's question; the example's answers do (D24).
      override: this.opts.workflowTest === true ? 'off' : NIGHT_TOGGLES.includes(savedNight?.override) ? savedNight.override : 'auto',
```

- [ ] **Step 6: No team metrics record (`src/core/metrics/record.mjs`)**

Change :10 to `import { readPrState, isTestPipeline } from '../artifacts.mjs';`. In `recordImpl`, after the `isMockRun` line, add:
```js
  if (harness?.opts?.workflowTest === true || isTestPipeline(runId)) return { recorded: false, reason: 'test' };   // D21
```
Move `const runId = harness.pipeline.id;` above that line, because the new line reads it.

- [ ] **Step 7: Statistics leaves test tries out (`src/core/stats.mjs`)**

Remove `allTimeTotals` from the cost-budget import: the budget's all-time figure keeps counting tests, Statistics' no longer reads it. Add, after `isFiltered`:
```js
// Workflow tests (D21/D22, G14): a test try is never a run in Statistics, filtered or not. Its spend still counts in the
// spending limit (budgetStatus reads cost_ledger directly); Part 5's Tests tile shows it.
const NOT_TEST = ' AND p.is_test IS NULL';
```
In `filterSql`, change `let sql = ''; const params = [];` to `let sql = NOT_TEST; const params = [];`.
In `SHAPING_SELECT`, change `WHERE p.status = 'done' AND p.run_size IS NOT NULL` to `WHERE p.status = 'done' AND p.run_size IS NOT NULL AND p.is_test IS NULL`.
In `ledgerSpend`'s unfiltered branch:
```js
    const row = prepare(`SELECT SUM(l.amount_usd) AS s FROM cost_ledger l LEFT JOIN pipelines p ON p.id = l.pipeline_id
      WHERE l.ts >= ? AND l.ts < ?${NOT_TEST}`).get(fromMs, toMs);
```
In `peopleInUse`: `'SELECT DISTINCT started_by AS who FROM pipelines WHERE started_by IS NOT NULL AND is_test IS NULL'`.
In `ledgerByRun`'s unfiltered branch:
```js
    return prepare(`SELECT l.pipeline_id AS id, SUM(l.amount_usd) AS usd FROM cost_ledger l LEFT JOIN pipelines p ON p.id = l.pipeline_id
      WHERE l.ts >= ? AND l.ts < ?${NOT_TEST} GROUP BY l.pipeline_id`).all(fromMs, toMs);
```
In `budgetWindowSavings`, add `AND p.is_test IS NULL` after the second window line.
In `getStats`, change `const at = filtered ? filteredAllTime(filter) : allTimeTotals();` to:
```js
    const at = filteredAllTime(filter);   // filterSql always leaves test tries out (NOT_TEST)
```
A ledger row whose pipeline was deleted joins to NULL, and `p.is_test IS NULL` keeps it counted, as before.

- [ ] **Step 7b: Run counts, onboarding and Ask's people leave tries out (review I1, M6)**

In `src/core/workflow-versions.mjs` `runCounts`, change `FROM (SELECT CASE WHEN json_valid(stepper) THEN stepper END AS s FROM pipelines)` to:
```js
    FROM (SELECT CASE WHEN json_valid(stepper) THEN stepper END AS s FROM pipelines WHERE is_test IS NULL)
```
Every try of v1 records `workflowVersion { no: 1 }` (orchestrator.mjs:226), so without it 18 tries read "v1 · 18 runs".

In `src/core/onboarding.mjs` (:108–109), add `AND is_test IS NULL` to both ticks:
```js
    run: count("SELECT COUNT(*) AS n FROM pipelines WHERE status = 'done' AND is_test IS NULL") > 0,
    realRun: count('SELECT COUNT(*) AS n FROM pipelines WHERE total_cost_usd > 0 AND is_test IS NULL') > 0,
```
In `src/core/ask/tool-deps.mjs` `listPeople`, change the first line to:
```js
  const where = ['started_by IS NOT NULL', "started_by != ''", 'archived_at IS NULL', 'is_test IS NULL'];
```

- [ ] **Step 8: Run the unit test**

Run: `node tools/test.mjs test/workflow-test-isolation.test.mjs test/stats-groups.test.mjs test/stats-today.test.mjs test/stats-api.test.mjs test/stats-groups-requirements.test.mjs test/api-workflow-versions.test.mjs`
Expected: PASS.

- [ ] **Step 9: Write the failing server test.** Create `test/api-workflow-test-try.test.mjs`:

```js
// test/api-workflow-test-try.test.mjs — one test try through the run handler (mock engine): it runs the version it was
// given, is hidden from every list and tab, sends no chat notification, and mounts no memory (D19–D23).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, prevHome, prevEnv, srv, base, runs, _testing, artifacts;
const frames = [];
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });
const graph = (name) => ({
  version: 2, id: 'wf_try', name, domain: 'product',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
async function settled(runId, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && e.settled) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`try ${runId} never settled`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfttry-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  // Settings (the enforced tag test) live under HOME: sandbox it, as test/api-run-tags.test.mjs does.
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  ({ runs, _testing } = mod);
  artifacts = await import('../src/core/artifacts.mjs');
  _testing.sockets.add({ readyState: 1, OPEN: 1, send: (t) => frames.push(JSON.parse(t)) });
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('the in-process option is checked: a try runs without a project, on the draft or a version', async () => {
  const bad1 = await _testing.invokeStartRun({ projectDir: homeDir, prompt: 'x' }, null, { workflowTest: { use: 'draft' } });
  assert.deepEqual([bad1.status, bad1.body.error], [400, 'a test try runs without a project']);
  const bad2 = await _testing.invokeStartRun({ noProject: true, prompt: 'x' }, null, { workflowTest: { use: 'live' } });
  assert.deepEqual([bad2.status, bad2.body.error], [400, 'a test try names the draft or a version number']);
});

test('a try of v1 runs v1, is hidden everywhere, sends nothing to tabs or chat, and mounts no memory', { timeout: 180000 }, async () => {
  assert.equal((await post('/api/workflows', graph('Try me'))).status, 201);
  assert.equal((await post('/api/workflows/wf_try/versions', { note: 'First' })).status, 201);
  assert.equal((await post('/api/workflows', graph('Try me (draft)'))).status, 201);
  const attach = _testing.chatNotifier.attach;
  const attached = [];
  _testing.chatNotifier.attach = (orch, o) => { attached.push(o && o.runId); return attach.call(_testing.chatNotifier, orch, o); };
  try {
    let seen = null;
    const out = await _testing.invokeStartRun({ noProject: true, workflowId: 'wf_try', prompt: 'Plan a bulk invoice export', title: 'Test: Bulk · try 1' }, null,
      { workflowTest: { use: 1, onOrch: (orch, o) => { seen = { orch, ...o }; } } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const { runId, pipelineId } = out.body;
    assert.equal(seen.runKey, runId, 'onOrch gets the orchestrator before it runs');
    const entry = runs.get(runId);
    assert.equal(entry.isTest, true);
    await settled(runId);
    const row = artifacts.findPipelineRowById(pipelineId);
    assert.equal(row.is_test, 1);
    const stepper = JSON.parse(row.stepper);
    assert.deepEqual(stepper.workflowVersion, { no: 1 });
    assert.equal(stepper.template.name, 'Try me');
    assert.equal(row.title, 'Test: Bulk · try 1', 'the fixed title is kept');
    assert.equal(entry.orch.memory, null, 'D19: nothing mounted');
    assert.equal(existsSync(join(entry.orch.pipeline.dir, 'memory')), false);
    assert.ok(!_testing.summarizeRuns().some((r) => r.runId === runId), 'not in the hello');
    assert.ok(!frames.some((f) => f.runId === runId), 'no frame of the try reached a tab');
    assert.ok(!attached.includes(runId), 'no chat notifier');
    const h = await (await fetch(`${base}/api/history`)).json();
    assert.ok(!h.pipelines.some((p) => p.id === pipelineId));
    const c = await (await fetch(`${base}/api/counts`)).json();
    assert.equal(c.pipelines, 0);
  } finally { _testing.chatNotifier.attach = attach; }
});

test('auto-resume on boot skips a paused test try', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  getDb().prepare(`INSERT INTO pipelines (id, project_key, status, is_test, resume_point) VALUES ('feed0001', 'no-project-00000000', 'paused', 1, '{"pauseReason":"drain"}')`).run();
  const out = await _testing.autoResumeOnBoot({ env: { WORCA_AUTO_RESUME: '1' }, mock: true });   // drain.mjs autoResumeMode: truthy = 'all'
  assert.ok(!out.resumed.some((r) => r.pipelineId === 'feed0001'));
  assert.ok(!out.failed.some((r) => r.pipelineId === 'feed0001'));
});

test('a test try is never resumed by hand either (review I7)', async () => {
  await assert.rejects(_testing.resumeRun('feed0001', { mock: true }),
    (e) => e.status === 409 && e.body.error === 'A test try cannot be resumed: finish the rest from its test.');
});

test('a try that pauses on a usage limit books no resume ticket (Review Focus 10)', async () => {
  const { EventEmitter } = await import('node:events');
  const orch = new EventEmitter();
  const entry = { id: 'try-limit-1', orch, kind: 'run', isTest: true, pipelineId: 'feed0001', status: 'paused', events: [], pendingQuestion: null };
  _testing.wireRun(entry);
  orch.emit('done', { status: 'paused', reason: 'usage_limit', limitResetAt: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(entry._limitResumeP, undefined, 'maybeScheduleLimitResume never ran');
  assert.ok(!frames.some((f) => f.runId === 'try-limit-1'), 'and no frame left for a tab');
});

test('enforced run tags neither refuse nor tag a try (review I2)', async () => {
  const CCD = { key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true };
  await post('/api/settings', { tagDimensions: [CCD], enforceTags: true, flags: { runTags: true } });
  try {
    const plain = await post('/api/run', { noProject: true, workflowId: 'wf_try', prompt: 'x', mock: true });
    assert.equal(plain.status, 422, 'a normal run without the tag is refused');
    const out = await _testing.invokeStartRun({ noProject: true, workflowId: 'wf_try', prompt: 'Plan it', title: 'Test: Bulk · try 2' }, null,
      { workflowTest: { use: 'draft' } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    await settled(out.body.runId);
    assert.deepEqual(runs.get(out.body.runId).tags, [], 'no enforced tag lands on a hidden try');
  } finally { await post('/api/settings', { tagDimensions: [], enforceTags: false }); }
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `node tools/test.mjs test/api-workflow-test-try.test.mjs`
Expected: FAIL. `_testing.invokeStartRun` is not a function.

- [ ] **Step 11: Implement in `ui/server.mjs`**

Add `isTestPipeline` to the `../src/core/artifacts.mjs` import (:39).

In `startRunHandler`, right after the `const scanTarget = …` line, add:
```js
    // Workflow tests (plans/workflow-tests-part2-plan.md D20–D23): a test try, set in-process by the test runner through
    // invokeStartRun only, never from HTTP. { use: 'draft' | n, onOrch?(orch, { runKey }) }.
    const workflowTest = req._workflowTest && typeof req._workflowTest === 'object' ? req._workflowTest : null;
    if (workflowTest && body.noProject !== true) return badRequest(res, 'a test try runs without a project');
    if (workflowTest && !(workflowTest.use === 'draft' || (Number.isInteger(workflowTest.use) && workflowTest.use > 0))) {
      return badRequest(res, 'a test try names the draft or a version number');
    }
```
Change `workflowRow = await assertRunnableWorkflow(workflowId);` to:
```js
      workflowRow = await assertRunnableWorkflow(workflowId, workflowTest ? { use: workflowTest.use } : {});   // D23: check what runs
```
In the no-project branch's `createOrchestratorFor({`, after `...(shape ? { shape } : {}),`, add:
```js
        // D19/D21/D23: the version under test, the row's mark, no memory, and the fixed title (no smart naming spend).
        ...(workflowTest ? { workflowUse: workflowTest.use, workflowTest: true, noMemory: true, titleLocked: true } : {}),
```
In that branch's `entry = {`, after `tags, events: [], pendingQuestion: null,`, add `...(workflowTest ? { isTest: true } : {}),`.
Right after `runs.set(runId, entry); wireRun(entry);`, add:
```js
    // The runner holds the orchestrator before orch.run() can ask anything (correction 7).
    if (workflowTest && typeof workflowTest.onOrch === 'function') workflowTest.onOrch(orch, { runKey: runId });
```
Change `announceRun(entry);` (just before `entry.launch = …`) to `if (!entry.isTest) announceRun(entry);   // D21: never in a tab's run list`.
In the `entry.launch` `.catch` right below it, change `broadcast(event);` to:
```js
        if (!entry.isTest) broadcast(event);   // review I7: a tab would upsert a phantom run from this runId (app.js:1973)
```
Change `tagExempt` (:2756) so its first line reads:
```js
    const tagExempt = !!internal?.ticket || !!scanTarget || !!req._resolveOf || !!req._prWatchRunId || !!req._workflowTest   // review I2: a hidden try carries no run tags
```
(the `||` lines below it stay). Without it, enforced tag rules answer every try 422, which the runner reads as `refused`, or write enforced tags onto hidden tries. `req._workflowTest` is set only in-process, so a person's start is still checked.

In `resumeRun`, right after `if (!saved) throw new ResumeError(404, { error: 'pipeline not found' });`, add:
```js
  // Workflow tests (D22, review I7): a try is driven by its test. "Finish the rest" makes it again; nothing resumes it
  // (POST /api/resume, chat /resume, a stale tab), which would also give it a new entry without isTest.
  if (saved.row.is_test) throw new ResumeError(409, { error: 'A test try cannot be resumed: finish the rest from its test.' });
```

In `invokeStartRun`, add `workflowTest = null` to the options and to the request:
```js
async function invokeStartRun(body, internal, { startedBy = null, runId = null, prWatchRunId = null, roundOf = null, workflowTest = null } = {}) {
```
```js
  await startRunHandler({ body, headers: {}, _internal: internal, _startedBy: startedBy, _runId: runId,
    _prWatchRunId: prWatchRunId, ...(roundOf ? { _roundOf: roundOf } : {}), ...(workflowTest ? { _workflowTest: workflowTest } : {}) }, res);
```

In `wireRun`:
- Change the notifier condition to:
  ```js
  if (((entry.kind || 'run') === 'run' || entry.kind === 'workspace-run') && !entry.isTest) {   // D21: no chat notifications for a test try
  ```
- In `record`, change `broadcast(tagged);` to:
  ```js
  if (!entry.isTest) broadcast(tagged);   // D21: a tab upserts a run for any frame with a runId (app.js:1995); a try sends none
  ```
- Change the limit-resume line to:
  ```js
  if (name === 'done' && entry.status === 'paused' && payload && payload.limitResetAt && !entry.isTest) {   // no resume ticket for a try
  ```

In `resolvePending` (:1225), change `broadcast(bufferEvent(entry, { type: 'question-resolved', id: pq.id, reason }));` to:
```js
  const resolved = bufferEvent(entry, { type: 'question-resolved', id: pq.id, reason });
  if (!entry.isTest) broadcast(resolved);   // D21: the runner answers a try's questions; no tab hears of them
```

In `summarizeRuns`, change the filter to `.filter((r) => r.kind !== 'scriptbench' && r.kind !== 'action' && !r.isTest)`.

In `stopPausedPipelineOnce`, change `} else {` (the branch that attaches `chatNotifier` to a parked run with no entry) to `} else if (!isTestPipeline(pipelineId)) {`.

In `autoResumeOnBoot`, change the WHERE to `WHERE status IN ('paused', 'interrupted') AND archived_at IS NULL AND is_test IS NULL ORDER BY started_at ASC`.

In `_testing`, add `invokeStartRun` after `startRunHandler`.

- [ ] **Step 12: Run the tests**

Run: `node tools/test.mjs test/api-workflow-test-try.test.mjs test/workflow-test-isolation.test.mjs test/api-run-no-project.test.mjs test/orchestrator-no-project.test.mjs test/workflow-live-version.test.mjs test/api-workflow-versions.test.mjs test/api-run-tags.test.mjs test/api-stop-paused.test.mjs`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/core/workflow-tests/try-body.mjs src/core/artifacts.mjs src/core/run-harness.mjs src/core/metrics/record.mjs src/core/stats.mjs src/core/workflow-versions.mjs src/core/onboarding.mjs src/core/ask/tool-deps.mjs ui/server.mjs test/workflow-test-isolation.test.mjs test/api-workflow-test-try.test.mjs
git commit -m "Workflow tests: a try is a hidden no-project run of the draft or a version (D19-D23)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 5: Connectors in a try: Pretend (stand-ins) or Real (D35)

A pretend try must never post or send through a connector. Worca swaps every server the try would load for a local stand-in under the same name, so the agents see the same tool names and grants. Claude Code is started so it loads nothing else. The stand-ins write down what would have been sent.

**Files:**
- Create:
  - `src/core/mcp/mock-connector.mjs` (the stand-in, a stdio MCP server, modelled on `src/core/engines/chat-probe-mcp.mjs`)
  - `src/core/workflow-tests/connectors.mjs`
- Modify the MCP Test (tool records instead of names):
  - `src/core/mcp/test.mjs` `probe` (:150–200)
  - `src/core/mcp/store.mjs` `testOk` (:48) and a new export `toolNameOf`
  - `src/core/mcp/registry.mjs` the tool-name loop (:282) and its `./store.mjs` import (:11)
  - `src/core/mcp/views.mjs` the `tooLong` lines (:126–127) and its `./store.mjs` import (:10)
- Modify the run:
  - `src/core/run-context.mjs` `assembleRunContext`: a new `mcpStandIn` option (signature :1285–1290), applied right before `const written = Object.keys(mcp.servers).sort();` (:1480)
  - `src/core/run-harness.mjs`: the imports, a new `_testConnectors()` beside `_resolveMcp` (:3825), the `assembleRunContext({` call (:3701–3725, its `registry:` line :3724), the `this.mcpLayer = reg && {` assignment (:3738), and the init branch (:7531)
  - `src/core/orchestrator.mjs` the node context, after `mcpDisallowed: this.mcpLayer?.disallowed,` (:1886)
  - `src/core/phases.mjs` `runOpts` (:819; the `mcpServerGrants` line :847 and the `disallowedTools` line :888)
  - `src/core/engines/claude.mjs` the `buildClaudeArgs` comment on `--strict-mcp-config` (:304–308)
  - `src/core/graph/script-runner.mjs` `buildEnvelope` (`bench:` line :145) and `envForShell` (after the `WORCA_BENCH` line :179)
  - `ui/server.mjs` `startRunHandler`: the `workflowTest` checks and the no-project `createOrchestratorFor` spread (both added in Task 4), and the import of `CONNECTOR_MODES`
- Test:
  - Create `test/mcp-mock-connector.test.mjs`, `test/workflow-test-connectors.test.mjs`
  - Modify `test/mcp-test.test.mjs` (:58–60, :141, :377, :391), `test/api-workflow-test-try.test.mjs` (one test)

**Interfaces:**
- Consumes: `CONNECTOR_MODES` (Task 2); `readMcpStore`, `recordTest` (mcp/store.mjs); `findPipelineRowById`, `runDirForRow` (artifacts.mjs); `worcaHome` (projects.mjs)
- Produces:
  - `mock-connector.mjs`: `MOCK_CONNECTOR_PATH`, `NOT_SENT = 'Not sent: this is a test.'`, `listedTool(t)`, `createConnectorHandler({ server, tools, log, now? }) → (message) → answer|null`, `parseArgs(argv)`. Started as `node mock-connector.mjs --server <name> --tools <tools.json> --log <connector-calls.ndjson>`. A call is logged as `{ ts, server, tool, arguments, readOnly }`.
  - `mcp/test.mjs`: `toolRecord(x) → { name, description?, inputSchema?, annotations? }`; `probe(…)` resolves to tool records
  - `mcp/store.mjs`: `toolNameOf(t) → string` (a stored tool is a name or a record)
  - `connectors.mjs`:
    - `CONNECTOR_MODES` (re-exported), `CONNECTOR_CALLS_FILE = 'connector-calls.ndjson'`, `PREVIEW_CHARS = 80`
    - `standInDef(name, toolsFile, logFile) → mcp.json server`
    - `pretendServers({ servers, copies }, { pipelineDir, store? }) → Promise<{ servers, off: [{ name, why }], pretend: string[] }>`
    - `connectorNotes({ copies, userScope, claudeAi, scripts }) → { pretend: string[], off: [{ name, reason: 'claude-ai'|'no-tools'|'own-settings' }], scripts: string[] }`
    - `userScopeServerNames(home?) → string[]`, `noteSeenServers(initList)`, `seenClaudeAiServers() → string[]`, `plainClaudeAiName(name)`
    - `humanizeTool(id)`, `nounOf(id)`, `sentCall(entry) → { server, tool, toolId, noun, to, preview, full }`
    - `readConnectorCalls(pipelineId) → Promise<entry[]>`, `wouldHaveSent(pipelineId) → Promise<{ sent: sentCall[], reads: [{ server, n }] }>`
  - `assembleRunContext({ …, mcpStandIn })`, where `mcpStandIn({ servers, copies }) → Promise<{ servers, off }>`
  - Harness `opts.testConnectors: 'pretend'|'real'`; `harness._testConnectors() → 'pretend'|'real'|null`
  - Node ctx `testConnectors`, `mcpStrict`; `runOpts(…).strictMcpConfig = true` and `CLAUDE_AI_TOOLS = 'mcp__claude_ai_*'` (phases.mjs) in `disallowedTools` for a pretend try
  - Script envelope `ctx.test = { connectors }`; env `WORCA_TEST=1`, `WORCA_TEST_CONNECTORS=pretend|real`
  - `invokeStartRun(…, { workflowTest: { use, connectors?: 'pretend'|'real', onOrch? } })`

- [ ] **Step 1: Write the failing stand-in test.** Create `test/mcp-mock-connector.test.mjs`:

```js
// test/mcp-mock-connector.test.mjs — D35: the stand-in a pretend try loads for each connector. It offers the recorded
// tools, writes down every call, reads included, and sends nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectorHandler, parseArgs, listedTool, MOCK_CONNECTOR_PATH, NOT_SENT } from '../src/core/mcp/mock-connector.mjs';

test('tools/list offers the recorded tools; a names-only record gets an open schema', () => {
  const log = [];
  const h = createConnectorHandler({ server: 'slack_team', log: (e) => log.push(e), now: () => 'T',
    tools: [{ name: 'post_message', description: 'Post to a channel', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }, 'search_messages'] });
  assert.deepEqual(h({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }).result,
    { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'slack_team', version: '1' } });
  assert.deepEqual(h({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools, [
    { name: 'post_message', description: 'Post to a channel', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    { name: 'search_messages', description: '', inputSchema: { type: 'object' } },
  ]);
  assert.equal(h({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'a notification is never answered');
  assert.deepEqual(h({ jsonrpc: '2.0', id: 3, method: 'ping' }).result, {});
  assert.deepEqual(log, []);
});

test('every call, reads included, is written down and answered "Not sent: this is a test."', () => {
  const log = [];
  const h = createConnectorHandler({ server: 'jira', log: (e) => log.push(e), now: () => '2026-10-26T10:00:00Z',
    tools: [{ name: 'create_issue' }, { name: 'search_issues', annotations: { readOnlyHint: true } }] });
  const r = h({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_issue', arguments: { title: 'Bulk export' } } });
  assert.deepEqual(r, { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: NOT_SENT }] } });
  assert.equal(NOT_SENT, 'Not sent: this is a test.');
  h({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_issues', arguments: { q: 'export' } } });
  assert.deepEqual(log, [
    { ts: '2026-10-26T10:00:00Z', server: 'jira', tool: 'create_issue', arguments: { title: 'Bulk export' }, readOnly: false },
    { ts: '2026-10-26T10:00:00Z', server: 'jira', tool: 'search_issues', arguments: { q: 'export' }, readOnly: true },
  ]);
  assert.equal(h({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'delete_all' } }).error.code, -32602);
  assert.equal(h({ jsonrpc: '2.0', id: 6, method: 'resources/list' }).error.code, -32601);
  assert.equal(log.length, 2, 'an unknown tool is not a call');
  assert.deepEqual(parseArgs(['--server', 'jira', '--tools', 't.json', '--log', 'c.ndjson']), { server: 'jira', tools: 't.json', log: 'c.ndjson' });
  assert.deepEqual(listedTool('x'), { name: 'x', description: '', inputSchema: { type: 'object' } });
});

test('as a process: stdio lines in, answers out, the call in the log file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-mockconn-'));
  try {
    const tools = join(dir, 'tools.json');
    const log = join(dir, 'calls.ndjson');
    await writeFile(tools, JSON.stringify([{ name: 'post_message' }]));
    const child = spawn(process.execPath, [MOCK_CONNECTOR_PATH, '--server', 'slack_team', '--tools', tools, '--log', log], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = [];
    const got = new Promise((resolve) => {
      let buf = '';
      child.stdout.on('data', (c) => {
        buf += c;
        const parts = buf.split('\n');
        buf = parts.pop();
        lines.push(...parts.filter(Boolean));
        if (lines.length >= 2) resolve();
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'post_message', arguments: { channel: '#product', text: 'Brief ready' } } })}\n`);
    await got;
    child.stdin.end();
    await new Promise((r) => child.on('close', r));
    assert.deepEqual(lines.map((l) => JSON.parse(l).id), [1, 2]);
    assert.equal(JSON.parse(lines[1]).result.content[0].text, 'Not sent: this is a test.');
    const entry = JSON.parse((await readFile(log, 'utf8')).trim());
    assert.deepEqual([entry.server, entry.tool, entry.arguments], ['slack_team', 'post_message', { channel: '#product', text: 'Brief ready' }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/mcp-mock-connector.test.mjs`
Expected: FAIL with `Cannot find module '../src/core/mcp/mock-connector.mjs'`.

- [ ] **Step 3: Implement `src/core/mcp/mock-connector.mjs`**

```js
// src/core/mcp/mock-connector.mjs
// The stand-in a pretend workflow-test try loads for each connector (plans/workflow-tests-part2-plan.md D35): a stdio MCP
// server under the connector's own name, offering the tools its last passing Test recorded. Every call is written to the
// try's connector-calls.ndjson and answered "Not sent: this is a test." Nothing else is read, written or sent.
// Started as: node mock-connector.mjs --server <name> --tools <tools.json> --log <connector-calls.ndjson>
// The pattern of src/core/engines/chat-probe-mcp.mjs: newline-delimited JSON-RPC on stdio, no SDK.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MOCK_CONNECTOR_PATH = fileURLToPath(import.meta.url);
export const NOT_SENT = 'Not sent: this is a test.';
const PROTOCOLS = Object.freeze(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);

/** A stored tool (a name, or { name, description?, inputSchema?, annotations? }) as tools/list offers it. */
export function listedTool(t) {
  const name = typeof t === 'string' ? t : String((t && t.name) || '');
  const out = {
    name,
    description: t && typeof t.description === 'string' ? t.description : '',
    inputSchema: t && t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' },
  };
  if (t && t.annotations && typeof t.annotations === 'object') out.annotations = t.annotations;
  return out;
}

/**
 * The JSON-RPC handler: one message in, its answer out (null for a notification). `log(entry)` gets every call.
 * @param {{server: string, tools: Array, log: (entry: object) => void, now?: () => string}} o
 */
export function createConnectorHandler({ server, tools, log, now = () => new Date().toISOString() }) {
  const list = (Array.isArray(tools) ? tools : []).map(listedTool).filter((t) => t.name);
  const byName = new Map(list.map((t) => [t.name, t]));
  return (m) => {
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.method !== 'string') return null;
    if (m.id === undefined || m.id === null) return null;   // notifications/* are never answered
    const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    if (m.method === 'initialize') {
      const asked = m.params && typeof m.params.protocolVersion === 'string' ? m.params.protocolVersion : '';
      return ok({ protocolVersion: PROTOCOLS.includes(asked) ? asked : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: server, version: '1' } });
    }
    if (m.method === 'ping') return ok({});
    if (m.method === 'tools/list') return ok({ tools: list });
    if (m.method === 'tools/call') {
      const name = m.params && typeof m.params.name === 'string' ? m.params.name : '';
      const tool = byName.get(name);
      if (!tool) return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `unknown tool ${JSON.stringify(name)}` } };
      const a = m.params.arguments;
      const args = a && typeof a === 'object' && !Array.isArray(a) ? a : {};
      try { log({ ts: now(), server, tool: name, arguments: args, readOnly: tool.annotations?.readOnlyHint === true }); } catch { /* answered either way */ }
      return ok({ content: [{ type: 'text', text: NOT_SENT }] });
    }
    return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } };
  };
}

export function parseArgs(argv) {
  const out = { server: '', tools: '', log: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if ((k === '--server' || k === '--tools' || k === '--log') && i + 1 < argv.length) { out[k.slice(2)] = argv[i + 1]; i += 1; }
  }
  return out;
}

function serve() {
  const a = parseArgs(process.argv.slice(2));
  let tools = [];
  try { tools = JSON.parse(readFileSync(a.tools, 'utf8')); } catch { tools = []; }
  const handle = createConnectorHandler({
    server: a.server || 'connector', tools,
    log: (e) => { if (a.log) appendFileSync(a.log, `${JSON.stringify(e)}\n`); },
  });
  createInterface({ input: process.stdin }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    for (const one of Array.isArray(m) ? m : [m]) {
      const r = handle(one);
      if (r) process.stdout.write(`${JSON.stringify(r)}\n`);
    }
  });
}

const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) serve();
```

- [ ] **Step 4: Run the stand-in test**

Run: `node tools/test.mjs test/mcp-mock-connector.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: A Test keeps tool records (`src/core/mcp/test.mjs`, `store.mjs`, `registry.mjs`, `views.mjs`)**

In `src/core/mcp/test.mjs`, add after `const own = …`:
```js
const SCHEMA_MAX = 20000;   // a tool's input schema is kept up to 20 KB of JSON: tests.json holds every membership's last Test
/** What a Test keeps of one listed tool: its name, and for the workflow-test stand-ins (D35) its description, input
 *  schema and annotations. */
export function toolRecord(x) {
  const out = { name: String((x && x.name) ?? '') };
  if (x && typeof x.description === 'string' && x.description) out.description = x.description.slice(0, 2000);
  if (x && x.inputSchema && typeof x.inputSchema === 'object' && JSON.stringify(x.inputSchema).length <= SCHEMA_MAX) out.inputSchema = x.inputSchema;
  if (x && x.annotations && typeof x.annotations === 'object') out.annotations = x.annotations;
  return out;
}
```
In `probe`, change the doc line `initialize + tools/list against one expanded entry → tool names.` to `→ tool records (toolRecord).`, and the listing loop to:
```js
      const tools = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, request);
        tools.push(...page.tools.map(toolRecord));
        if (tools.length > MAX_TOOLS) throw new Error(`tools/list returned more than ${MAX_TOOLS} tools`);
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
```
In `src/core/mcp/store.mjs`, replace `testOk` (:48) with:
```js
// A stored tool is its name (a Test written before workflow tests Part 2) or { name, description?, inputSchema?, annotations? }.
const toolOk = (x) => typeof x === 'string' || (isMap(x) && typeof x.name === 'string');
const testOk = (t) => (t.tools === undefined || (Array.isArray(t.tools) && t.tools.every(toolOk)))
  && text(t.at) && text(t.fingerprint) && (t.error === null || text(t.error));
```
and add after `mcpDir`:
```js
/** A stored tool's name: a Test result holds names (older) or records (workflow tests D35); '' for anything else. */
export const toolNameOf = (t) => (typeof t === 'string' ? t : t && typeof t.name === 'string' ? t.name : '');
```
In `src/core/mcp/registry.mjs`, change the import (:11) to `import { readMcpStore, testFingerprint, toolNameOf } from './store.mjs';` and the loop (:282) to `for (const tool of s.tools.map(toolNameOf)) {`.
In `src/core/mcp/views.mjs`, change the import (:10) to `import { readMcpStore, toolNameOf } from './store.mjs';` and the two `tooLong` lines (:126–127) to:
```js
      const long = tr.ok && (tr.tools || []).map(toolNameOf).find((t) => `mcp__${copy}__${cliName(t)}`.length > 64);
      if (long) tooLong = { limit: `mcp__${copy}__${cliName(long)}`.length > 128 ? 128 : 64, tool: long };
```
In `test/mcp-test.test.mjs`:
- :58 `assert.deepEqual(r.tools, ['search_issues', 'get_issue']);` becomes
  ```js
  assert.deepEqual(r.tools, [{ name: 'search_issues', inputSchema: { type: 'object' } }, { name: 'get_issue', inputSchema: { type: 'object' } }]);
  ```
- :60 `assert.deepEqual({ ...stored }, r);` becomes `assert.deepEqual(JSON.parse(JSON.stringify(stored)), r);` (the store reads every object with a null prototype, the tool records included).
- :141 `assert.deepEqual([r.ok, r.tools], [true, ['search']], r.error);` becomes `assert.deepEqual([r.ok, r.tools.map((t) => t.name)], [true, ['search']], r.error);`
- :377 `assert.deepEqual(await probe(…), ['sse_tool']);` becomes `assert.deepEqual((await probe({ type: 'sse', url, headers: { Authorization: `Bearer ${SECRET}` } }, { timeoutMs: 2000 })).map((t) => t.name), ['sse_tool']);`
- :391 `assert.deepEqual(await probe({ command: process.execPath, args: [FIXTURE, 'ok'], env: {} }, { timeoutMs: 90000 }), ['search_issues', 'get_issue']);` becomes the same call with `.map((t) => t.name)` on its result: `assert.deepEqual((await probe({ command: process.execPath, args: [FIXTURE, 'ok'], env: {} }, { timeoutMs: 90000 })).map((t) => t.name), ['search_issues', 'get_issue']);`

Run: `node tools/test.mjs test/mcp-test.test.mjs test/mcp-views.test.mjs test/mcp-pipeline-run.test.mjs`
Expected: PASS, except what fails on a clean checkout on this laptop (checked 2026-10-26: `mcp-test`'s "a server that dies at once…" and "…closes its stdin… (EPIPE)", `mcp-pipeline-run`'s "agent isolation…"). A stored names-only result still loads and still counts its tools. Without the `toolNameOf` change in registry.mjs, a run fails with "Cannot convert object to primitive value": the store reads a tool record as a null-prototype object, which `String(tool)` cannot turn into text.

- [ ] **Step 6: Write the failing connectors test.** Create `test/workflow-test-connectors.test.mjs`:

```js
// test/workflow-test-connectors.test.mjs — D35: a pretend try's stand-ins, the dialog's notes, what a try would have
// sent, the spawn flags and the script env; then a real pipeline run (mock engine, custom runners, the pattern of
// test/mcp-pipeline-run.test.mjs) in pretend and in real mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { createPipeline } from '../src/core/artifacts.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { projectKey } from '../src/core/store.mjs';
import { addManualServer, createSet, putMember, setProjectAssignment, recordTest } from '../src/core/mcp/store.mjs';
import { materializeForTest } from '../src/core/mcp/test.mjs';
import { viewContext } from '../src/core/mcp/views.mjs';
import { MOCK_CONNECTOR_PATH } from '../src/core/mcp/mock-connector.mjs';
import { runOpts, CLAUDE_AI_TOOLS } from '../src/core/phases.mjs';
import { buildClaudeArgs } from '../src/core/engines/claude.mjs';
import { envForShell } from '../src/core/graph/script-runner.mjs';
import {
  pretendServers, connectorNotes, humanizeTool, nounOf, sentCall, wouldHaveSent, noteSeenServers, seenClaudeAiServers,
  userScopeServerNames, CONNECTOR_CALLS_FILE,
} from '../src/core/workflow-tests/connectors.mjs';

useTempHome(after);
const scratch = [];
after(async () => { await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))); });
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-wftconn-')); scratch.push(d); return d; };

test('pretendServers: a stand-in for each server with recorded tools, the rest switched off; no env, no secret', async () => {
  const dir = await tmp();
  const store = { tests: { 'set1|manual:slack': { ok: true, tools: [{ name: 'post_message' }], fingerprint: 'f' }, 'set1|manual:jira': { ok: true, tools: ['create_issue'] } } };
  const out = await pretendServers({
    servers: {
      slack_team: { type: 'http', url: 'https://mcp.slack.example/', headers: { Authorization: '${MCPSECRET_ABCD1234}' } },
      jira_team: { command: 'node', args: ['jira.js'], env: { TOKEN: '${MCPSECRET_0000AAAA}' } },
      files_srv: { command: 'files-mcp' },
    },
    copies: [{ name: 'slack_team', setId: 'set1', serverId: 'manual:slack', untested: false },
      { name: 'jira_team', setId: 'set1', serverId: 'manual:jira', untested: true }],
  }, { pipelineDir: dir, store });
  assert.deepEqual(out.pretend, ['slack_team']);
  assert.deepEqual(out.off.map((o) => o.name), ['files_srv', 'jira_team'], 'a file server and a stale Test have no tools Worca trusts');
  assert.deepEqual(Object.keys(out.servers), ['slack_team']);
  const def = out.servers.slack_team;
  assert.deepEqual([def.type, def.command, def.args[0], def.args[1], def.args[2], def.args[3], def.args[5], def.args[6]],
    ['stdio', process.execPath, MOCK_CONNECTOR_PATH, '--server', 'slack_team', '--tools', '--log', join(dir, CONNECTOR_CALLS_FILE)]);
  assert.equal(def.env, undefined);
  assert.doesNotMatch(JSON.stringify(out.servers), /MCPSECRET_/);
  assert.deepEqual(JSON.parse(await readFile(def.args[4], 'utf8')), [{ name: 'post_message' }]);
});

test('the dialog notes (board 30): pretend, switched off and why, script steps', () => {
  assert.deepEqual(connectorNotes({
    copies: [{ name: 'slack_team', untested: false }, { name: 'jira_team', untested: false }, { name: 'confluence_team', untested: true }],
    userScope: ['my-db'], claudeAi: ['claude.ai Google Drive'], scripts: ['Publish to wiki', 'Publish to wiki'],
  }), {
    pretend: ['jira_team', 'slack_team'],
    off: [{ name: 'Google Drive', reason: 'claude-ai' }, { name: 'confluence_team', reason: 'no-tools' }, { name: 'my-db', reason: 'own-settings' }],
    scripts: ['Publish to wiki'],
  });
});

test('what a try would have sent: plain words, where to, the first 80 characters, reads apart', async () => {
  assert.deepEqual(['post_message', 'create_issue', 'list_channels', 'sendEmail', 'search', 'get_user_profile'].map(humanizeTool),
    ['post a message', 'create an issue', 'list channels', 'send an email', 'search', 'get user profile']);
  assert.deepEqual(['post_message', 'create_issue', 'search'].map(nounOf), ['message', 'issue', 'call']);
  const long = `Brief ready: Bulk invoice export\n${'x'.repeat(100)}`;
  const c = sentCall({ server: 'slack_team', tool: 'post_message', arguments: { channel: '#product', text: long } });
  assert.deepEqual([c.server, c.tool, c.toolId, c.noun, c.to, c.preview.length, c.preview.endsWith('…'), c.full], ['slack_team', 'post a message', 'post_message', 'message', '#product', 81, true, long]);
  const j = sentCall({ server: 'jira', tool: 'create_issue', arguments: { fields: { summary: 'x' } } });
  assert.deepEqual([j.to, j.preview, j.full], [null, '{"fields":{"summary":"x"}}', '{\n  "fields": {\n    "summary": "x"\n  }\n}']);
  const home = await tmp();
  const { id, dir } = await createPipeline(join(home, 'proj'), { prompt: 'p', title: 't', isTest: true });
  await writeFile(join(dir, CONNECTOR_CALLS_FILE), [
    JSON.stringify({ ts: 't', server: 'slack_team', tool: 'post_message', arguments: { text: 'Hi' }, readOnly: false }),
    JSON.stringify({ ts: 't', server: 'jira', tool: 'search_issues', arguments: { q: 'x' }, readOnly: true }),
    '{"torn',
  ].join('\n'));
  const w = await wouldHaveSent(id);
  assert.deepEqual(w.sent.map((s) => [s.server, s.tool, s.preview]), [['slack_team', 'post a message', 'Hi']]);
  assert.deepEqual(w.reads, [{ server: 'jira', n: 1 }]);
  assert.deepEqual(await wouldHaveSent('nope0000'), { sent: [], reads: [] });
});

test('claude.ai names seen at a run\'s start-up are remembered; ~/.claude.json servers are read', async () => {
  noteSeenServers([{ name: 'claude.ai Gmail', status: 'connected' }, { name: 'pg_billing', status: 'connected' }]);
  noteSeenServers([{ name: 'claude.ai Gmail' }]);
  assert.deepEqual(seenClaudeAiServers(), ['claude.ai Gmail']);
  const home = await tmp();
  await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { zeta: {}, alpha: {} } }));
  assert.deepEqual(userScopeServerNames(home), ['alpha', 'zeta']);
  assert.deepEqual(userScopeServerNames(join(home, 'none')), []);
});

test('spawn flags: a pretend try loads only its mcp.json and withholds claude.ai tools; others are unchanged', () => {
  const base = { projectDir: '/p', claudeOpts: {} };
  const pretend = runOpts({ ...base, mcpStrict: true }, { role: 'producer', prompt: 'p', systemPrompt: 's', allowedTools: [] });
  assert.equal(pretend.strictMcpConfig, true);
  assert.deepEqual(pretend.disallowedTools, [CLAUDE_AI_TOOLS]);
  assert.equal(CLAUDE_AI_TOOLS, 'mcp__claude_ai_*');
  const normal = runOpts(base, { role: 'producer', prompt: 'p', systemPrompt: 's', allowedTools: [] });
  assert.equal(normal.strictMcpConfig, undefined);
  assert.equal(normal.disallowedTools, undefined);
  const args = buildClaudeArgs({ prompt: 'p', systemPrompt: 's', permissionMode: 'acceptEdits', strictMcpConfig: true, disallowedTools: pretend.disallowedTools });
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'mcp__claude_ai_*');
});

test('a script step learns it runs in a test, and never inherits that from the server', () => {
  const env = envForShell({ ctx: { test: { connectors: 'pretend' } } }, { PATH: '/usr/bin' });
  assert.deepEqual([env.WORCA_TEST, env.WORCA_TEST_CONNECTORS], ['1', 'pretend']);
  const plain = envForShell({ ctx: {} }, { PATH: '/usr/bin', WORCA_TEST: '1', WORCA_TEST_CONNECTORS: 'real' });
  assert.deepEqual([plain.WORCA_TEST, plain.WORCA_TEST_CONNECTORS], [undefined, undefined]);
});

// ── A real pipeline run (mock engine): the registry layer of test/mcp-pipeline-run.test.mjs ──
const PG_SECRET = 'pg-secret-value-1';
const SENTRY_SECRET = 'sntrys_token_value_2';
const rand = () => Math.random().toString(36).slice(2, 7);
let defs = null;
async function fixture() {
  defs ||= {
    pg: await addManualServer('pg', {
      type: 'stdio', command: 'node', args: ['/srv/pg.js'], env: { PGPASSWORD: { field: 'password' } },
      fields: [{ key: 'password', label: 'Password', secret: true, required: true }], description: 'Read-only replica',
    }),
    sentry: await addManualServer('sentry', {
      type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: { field: 'token', prefix: 'Bearer ' } },
      fields: [{ key: 'token', label: 'Sentry token', secret: true, required: true }], description: 'Sentry issues',
    }),
  };
  const dir = gitDir('wft-conn');
  const set = await createSet(`Billing ${rand()}`);
  await putMember(set.id, 'manual:pg', { enabled: true, values: {}, secrets: { password: PG_SECRET } }, { def: defs.pg });
  await putMember(set.id, 'manual:sentry', { enabled: true, values: {}, secrets: { token: SENTRY_SECRET } }, { def: defs.sentry });
  await setProjectAssignment(projectKey(dir), { sets: [set.id], includeGeneral: false });
  // pg passed a Test (its tools are recorded); sentry never did.
  const m = materializeForTest(await viewContext(), set.id, 'manual:pg');
  await recordTest(set.id, 'manual:pg', { at: new Date().toISOString(), ok: true, error: null, fingerprint: m.fingerprint,
    tools: [{ name: 'query', description: 'Run a read-only query', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
  return { dir, set };
}
const runners = (seen) => {
  const record = (ctx) => seen.push({ ctx, file: ctx.mcpConfigPath ? readFileSync(ctx.mcpConfigPath, 'utf8') : null });
  return {
    producer: async (ctx) => { record(ctx); return { status: 'ok', summary: 'ok' }; },
    verifier: async (ctx) => { record(ctx); return { status: 'ok', issues: [], review: { issues: [] }, summary: '' }; },
  };
};

test('a pretend try: only stand-ins in mcp.json, no secret anywhere in the spawn, strict config, the switched-off copy named', async () => {
  const { dir, set } = await fixture();
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen),
    workflowTest: true, testConnectors: 'pretend' });
  assert.equal((await orch.run()).status, 'done');
  const pipelineDir = orch.getState().pipelineDir;
  const servers = JSON.parse(seen[0].file).mcpServers;
  const pg = `pg_${set.slug}`;
  assert.deepEqual(Object.keys(servers), [pg], 'sentry has no recorded tools: switched off');
  assert.deepEqual([servers[pg].command, servers[pg].args[0], servers[pg].args[2], servers[pg].args[6]],
    [process.execPath, MOCK_CONNECTOR_PATH, pg, join(pipelineDir, CONNECTOR_CALLS_FILE)]);
  assert.equal('env' in servers[pg], false);
  assert.deepEqual(JSON.parse(readFileSync(servers[pg].args[4], 'utf8')).map((t) => t.name), ['query']);
  for (const s of [PG_SECRET, SENTRY_SECRET]) assert.ok(!seen[0].file.includes(s), 'no secret in mcp.json');
  assert.doesNotMatch(seen[0].file, /MCPSECRET_/);
  assert.deepEqual(seen[0].ctx.mcpEnv, {}, 'no secret env reaches the spawn');
  assert.deepEqual([seen[0].ctx.testConnectors, seen[0].ctx.mcpStrict], ['pretend', true]);
  const o = runOpts(seen[0].ctx, { role: 'producer', prompt: 'p', systemPrompt: 's', allowedTools: [] });
  assert.equal(o.strictMcpConfig, true);
  assert.ok(o.disallowedTools.includes('mcp__claude_ai_*'));
  assert.ok(!JSON.stringify(o.spawnEnv || {}).includes(PG_SECRET));
  assert.ok((await readRunManifest(pipelineDir)).warnings.some((w) => w.includes(`sentry_${set.slug}`) && w.includes('switched off')));
});

test('a real try is a normal run: the real servers, no strict config', async () => {
  const { dir, set } = await fixture();
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen),
    workflowTest: true, testConnectors: 'real' });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual(Object.keys(JSON.parse(seen[0].file).mcpServers).sort(), [`pg_${set.slug}`, `sentry_${set.slug}`]);
  assert.deepEqual([seen[0].ctx.testConnectors, seen[0].ctx.mcpStrict], ['real', false]);
  assert.equal(runOpts(seen[0].ctx, { role: 'producer', prompt: 'p', systemPrompt: 's', allowedTools: [] }).strictMcpConfig, undefined);
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-connectors.test.mjs`
Expected: FAIL with `Cannot find module '../src/core/workflow-tests/connectors.mjs'`.

- [ ] **Step 8: Implement `src/core/workflow-tests/connectors.mjs`**

```js
// src/core/workflow-tests/connectors.mjs
// Connectors in a workflow test (plans/workflow-tests-part2-plan.md D35). Pretend: every server a try would load is
// swapped for a local stand-in (../mcp/mock-connector.mjs) under the same name, offering the tools the connector's last
// passing Test recorded; a server Worca has no tools for is switched off. Also: the Test a version dialog's notes per
// connector (board 30), what one try would have sent (board 31), and the claude.ai connector names Worca has seen.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readMcpStore } from '../mcp/store.mjs';
import { MOCK_CONNECTOR_PATH } from '../mcp/mock-connector.mjs';
import { findPipelineRowById, runDirForRow } from '../artifacts.mjs';
import { worcaHome } from '../projects.mjs';

export { CONNECTOR_MODES } from './store.mjs';
export const CONNECTOR_CALLS_FILE = 'connector-calls.ndjson';
export const PREVIEW_CHARS = 80;
const CALLS_MAX = 200;
const CLAUDE_AI_RE = /^claude[ ._]ai[ _]/i;
const seenFile = () => join(worcaHome(), 'workflow-tests', 'seen-connectors.json');

export function standInDef(name, toolsFile, logFile) {
  return { type: 'stdio', command: process.execPath, args: [MOCK_CONNECTOR_PATH, '--server', name, '--tools', toolsFile, '--log', logFile] };
}

/**
 * A pretend try's servers (run-context.mjs `mcpStandIn`): each one a stand-in under its own name, or switched off.
 * @param {{servers: Record<string, object>, copies: Array<{name: string, setId: string, serverId: string, untested: boolean}>}} layer
 *   every server the try would load, and the registry copies among them
 * @param {{pipelineDir: string, store?: object}} o `store` = readMcpStore()'s snapshot (a test seam)
 */
export async function pretendServers({ servers = {}, copies = [] } = {}, { pipelineDir, store = null } = {}) {
  const snapshot = store || await readMcpStore();
  const tests = (snapshot && snapshot.tests) || {};
  const out = {};
  const off = [];
  const pretend = [];
  const dir = join(pipelineDir, 'connectors');
  let n = 0;
  for (const name of Object.keys(servers).sort()) {
    const copy = copies.find((c) => c.name === name) || null;
    const test = copy && !copy.untested ? tests[`${copy.setId}|${copy.serverId}`] : null;
    const tools = test && test.ok === true && Array.isArray(test.tools) && test.tools.length ? test.tools : null;
    if (!tools) { off.push({ name, why: 'Worca has no list of its tools; test it once in Connectors.' }); continue; }
    await mkdir(dir, { recursive: true });
    n += 1;
    const toolsFile = join(dir, `${String(n).padStart(2, '0')}-${name.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
    await writeFile(toolsFile, JSON.stringify(tools), 'utf8');
    out[name] = standInDef(name, toolsFile, join(pipelineDir, CONNECTOR_CALLS_FILE));
    pretend.push(name);
  }
  return { servers: out, off, pretend };
}

/** "claude.ai Google Drive" / "claude_ai_Google_Drive" → "Google Drive". */
export const plainClaudeAiName = (name) => String(name).replace(CLAUDE_AI_RE, '').replace(/_/g, ' ').trim() || String(name);

/**
 * Board 30's notes. `copies` = the registry copies a run without a project would start (server.mjs mcpRunPreview), each
 * with `untested`; `userScope` = the `~/.claude.json` servers; `claudeAi` = the names seen (N2); `scripts` = the names of
 * the workflow's script steps.
 */
export function connectorNotes({ copies = [], userScope = [], claudeAi = [], scripts = [] } = {}) {
  return {
    pretend: copies.filter((c) => !c.untested).map((c) => c.name).sort(),
    off: [
      ...claudeAi.map((name) => ({ name: plainClaudeAiName(name), reason: 'claude-ai' })),
      ...copies.filter((c) => c.untested).map((c) => ({ name: c.name, reason: 'no-tools' })),
      ...userScope.filter((n) => !copies.some((c) => c.name === n)).map((name) => ({ name, reason: 'own-settings' })),
    ],
    scripts: [...new Set(scripts)],
  };
}

/** The servers of `~/.claude.json` (user scope), which Claude Code loads by itself; a pretend try's strict config drops them (N1). */
export function userScopeServerNames(home = homedir()) {
  try {
    const m = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers;
    return m && typeof m === 'object' && !Array.isArray(m) ? Object.keys(m).sort() : [];
  } catch { return []; }
}

/** N2: remember the claude.ai connector names a run's start-up listed (the CLI's init `mcp_servers`). Never throws. */
export function noteSeenServers(list) {
  try {
    const names = (Array.isArray(list) ? list : []).map((s) => (s && typeof s.name === 'string' ? s.name : '')).filter((x) => CLAUDE_AI_RE.test(x));
    if (!names.length) return;
    const have = seenClaudeAiServers();
    const next = [...new Set([...have, ...names])].sort().slice(0, 100);
    if (next.length === have.length) return;
    mkdirSync(join(worcaHome(), 'workflow-tests'), { recursive: true });
    writeFileSync(seenFile(), `${JSON.stringify({ claudeAi: next })}\n`, 'utf8');
  } catch { /* a note only */ }
}

export function seenClaudeAiServers() {
  try {
    const v = JSON.parse(readFileSync(seenFile(), 'utf8'));
    return Array.isArray(v.claudeAi) ? v.claudeAi.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

const words = (id) => String(id || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());

/** "post_message" → "post a message", "create_issue" → "create an issue", "list_channels" → "list channels". */
export function humanizeTool(id) {
  const w = words(id);
  if (!w.length) return 'use a tool';
  if (w.length === 2 && !/s$/.test(w[1])) return `${w[0]} ${/^[aeiou]/.test(w[1]) ? 'an' : 'a'} ${w[1]}`;
  return w.join(' ');
}

/** What a call makes, for board 31's count ("1 message, 1 issue"); a one-word tool is a "call". */
export function nounOf(id) {
  const w = words(id);
  return w.length > 1 ? w.at(-1) : 'call';
}

const TEXT_KEYS = ['text', 'message', 'body', 'content', 'comment', 'description', 'summary', 'title'];
const TO_KEYS = ['channel', 'to', 'recipient', 'project', 'space', 'repo'];
const keyed = (args) => new Map(Object.entries(args && typeof args === 'object' && !Array.isArray(args) ? args : {}).map(([k, v]) => [k.toLowerCase(), v]));
const firstString = (map, keys) => { for (const k of keys) { const v = map.get(k); if (typeof v === 'string' && v.trim()) return v; } return null; };

/** One call as board 31 lists it. `preview` = the first 80 characters of its main text; `full` = all of it. */
export function sentCall(e) {
  const args = e && e.arguments;
  const map = keyed(args);
  const longest = [...map.values()].filter((v) => typeof v === 'string' && v.trim()).sort((x, y) => y.length - x.length)[0] ?? null;
  const text = firstString(map, TEXT_KEYS) ?? longest;
  const flat = (text ?? JSON.stringify(args ?? {})).replace(/\s+/g, ' ').trim();
  return {
    server: String((e && e.server) || ''), tool: humanizeTool(e && e.tool), toolId: String((e && e.tool) || ''), noun: nounOf(e && e.tool),
    to: firstString(map, TO_KEYS),
    preview: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat,
    full: text ?? JSON.stringify(args ?? {}, null, 2),
  };
}

/** The calls a try's stand-ins wrote down (at most 200; a torn last line is skipped). [] for a try without a log. */
export async function readConnectorCalls(pipelineId) {
  const row = pipelineId ? findPipelineRowById(pipelineId) : null;
  if (!row) return [];
  let text = '';
  try { text = await readFile(join(await runDirForRow(row), CONNECTOR_CALLS_FILE), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || out.length >= CALLS_MAX) continue;
    try { const v = JSON.parse(line); if (v && typeof v.tool === 'string') out.push(v); } catch { /* a torn line */ }
  }
  return out;
}

/** Board 31: what one pretend try would have sent, and the reads its stand-ins answered (N3). */
export async function wouldHaveSent(pipelineId) {
  const sent = [];
  const reads = new Map();
  for (const e of await readConnectorCalls(pipelineId)) {
    if (e.readOnly === true) { const s = String(e.server || ''); reads.set(s, (reads.get(s) || 0) + 1); continue; }
    sent.push(sentCall(e));
  }
  return { sent, reads: [...reads].map(([server, n]) => ({ server, n })) };
}
```

- [ ] **Step 9: Swap the servers before `mcp.json` is written (`src/core/run-context.mjs`)**

In `assembleRunContext`'s JSDoc, after the `@param … [a.setSkills]` lines, add:
```js
 * @param {((layer:{servers:object, copies:object[]}) => Promise<{servers:object, off:Array<{name:string, why:string}>}>)|null} [a.mcpStandIn]
 *        workflow tests (D35): a pretend try's swap of every server it would load for a stand-in; null for every other run
```
Add `mcpStandIn = null,` to `assembleRunContext`'s destructure, after its `setSkills = [],` (:1289; the `setSkills = [],` at :491 belongs to another function). Right before `const written = Object.keys(mcp.servers).sort();`, add:
```js
  // Workflow tests (plans/workflow-tests-part2-plan.md D35): a pretend try swaps every server it would load, the registry
  // copies and the file servers, for a local stand-in under the same name; one it cannot pretend for is left out.
  if (typeof mcpStandIn === 'function') {
    const swap = await mcpStandIn({ servers: mcp.servers, copies: reg ? reg.result.copies : [] });
    mcp.servers = swap.servers;
    for (const o of swap.off) warnings.push(`MCP server \`${o.name}\` is switched off in this test try: ${o.why}`);
  }
```

- [ ] **Step 10: The harness passes the swap and drops the secret env (`src/core/run-harness.mjs`)**

Add the import:
```js
import { pretendServers, noteSeenServers } from './workflow-tests/connectors.mjs';
```
Beside `_resolveMcp`, add:
```js
  /** Workflow tests (D35): 'pretend' | 'real' for a test try, null for every other run. */
  _testConnectors() {
    if (this.opts.workflowTest !== true) return null;
    return this.opts.testConnectors === 'real' ? 'real' : 'pretend';
  }
```
In the `assembleRunContext({` call, after `registry: async (taken) => (reg = await this._resolveMcp(taken)),`, add:
```js
      ...(this._testConnectors() === 'pretend' ? { mcpStandIn: (layer) => pretendServers(layer, { pipelineDir: this.pipeline.dir }) } : {}),
```
Right after the `this.mcpLayer = reg && { … };` statement, add:
```js
    // D35: a pretend try's stand-ins take no env, so no registry secret (MCPSECRET_*) reaches its spawn.
    if (this.mcpLayer && this._testConnectors() === 'pretend') this.mcpLayer = { ...this.mcpLayer, env: {} };
```
The redaction list stays: a secret value never reaches a pretend try, and redacting it costs nothing.
In the init branch, after `if (Array.isArray(e.mcpServers) && this.mcpLayer?.copies.length) this._recordMcpInit(e.mcpServers);`, add:
```js
    // N2: the claude.ai connectors this account loads, so the Test a version dialog can name them (a try loads none).
    if (Array.isArray(e.mcpServers) && this.opts.workflowTest !== true) noteSeenServers(e.mcpServers);
```

- [ ] **Step 11: Strict config, the claude.ai belt and the script env**

`src/core/orchestrator.mjs`, in the node context after `mcpDisallowed: this.mcpLayer?.disallowed,`:
```js
      // Workflow tests (D35): a pretend try loads only its mcp.json; a script step learns it runs in a test.
      ...(this._testConnectors() ? { testConnectors: this._testConnectors(), mcpStrict: this._testConnectors() === 'pretend' } : {}),
```
`src/core/phases.mjs`: above `runOpts`, add
```js
/** Workflow tests (D35): the belt beside --strict-mcp-config on a pretend try. Whether strict config alone already drops
 *  claude.ai connectors is checked against the real CLI in Task 15. */
export const CLAUDE_AI_TOOLS = 'mcp__claude_ai_*';
```
(a constant here, not an import from workflow-tests/connectors.mjs, so phases.mjs gains no import). In `runOpts`, after `mcpServerGrants: ctx.mcpServerGrants,`, add:
```js
    // Workflow tests (D35): a pretend try loads ONLY its mcp.json (the stand-ins): no claude.ai connector, no
    // ~/.claude.json server, no plugin server. Absent on every other spawn, so its argv stays byte-identical.
    ...(ctx.mcpStrict === true ? { strictMcpConfig: true } : {}),
```
and change the `disallowedTools:` line to:
```js
    disallowedTools: ctx.mcpStrict === true ? [...(excluded || []), ...(ctx.mcpDisallowed || []), CLAUDE_AI_TOOLS]
      : ctx.mcpDisallowed?.length ? [...(excluded || []), ...ctx.mcpDisallowed] : excluded,
```
`src/core/engines/claude.mjs`: in the `buildClaudeArgs` comment (:307–308), change the words `so \`--strict-mcp-config\` is deliberately never passed — E11).` (they wrap over the two lines) to `so \`--strict-mcp-config\` is never passed — E11 — except on a pretend workflow-test try, which must load only its stand-ins (plans/workflow-tests-part2-plan.md D35)).`
`src/core/graph/script-runner.mjs`: in `buildEnvelope`'s `ctx: {`, after `bench: Boolean(ctx.bench),`, add:
```js
      // Workflow tests (D35): set on a test try's script step only (additive — apiVersion stays 1).
      ...(ctx.testConnectors === 'pretend' || ctx.testConnectors === 'real' ? { test: { connectors: ctx.testConnectors } } : {}),
```
In `envForShell`, after the `WORCA_BENCH` line, add:
```js
  // D35: a test try's script step knows it is one (and whether connectors are pretend); never inherited from a worca under test.
  if (c.test && (c.test.connectors === 'pretend' || c.test.connectors === 'real')) {
    env.WORCA_TEST = '1';
    env.WORCA_TEST_CONNECTORS = c.test.connectors;
  } else { delete env.WORCA_TEST; delete env.WORCA_TEST_CONNECTORS; }
```

- [ ] **Step 12: Run the connectors tests**

Run: `node tools/test.mjs test/workflow-test-connectors.test.mjs test/mcp-mock-connector.test.mjs test/mcp-pipeline-run.test.mjs test/spawn-args.test.mjs test/claude-mcpjson-guard.test.mjs test/git-missing-wrappers.test.mjs test/engine-gate.test.mjs`
Expected: PASS.

- [ ] **Step 13: The server passes the mode (`ui/server.mjs`)**

Add `import { CONNECTOR_MODES } from '../src/core/workflow-tests/store.mjs';` next to the other workflow tests imports. In `startRunHandler`, after Task 4's `a test try names the draft or a version number` check, add:
```js
    if (workflowTest && workflowTest.connectors !== undefined && !CONNECTOR_MODES.includes(workflowTest.connectors)) {
      return badRequest(res, 'a test try names its connectors: pretend or real');
    }
```
In the no-project `createOrchestratorFor({`, change Task 4's spread to:
```js
        ...(workflowTest ? { workflowUse: workflowTest.use, workflowTest: true, noMemory: true, titleLocked: true,
          testConnectors: workflowTest.connectors === 'real' ? 'real' : 'pretend' } : {}),   // D35: pretend unless real is named
```
Append to `test/api-workflow-test-try.test.mjs`:
```js
test('a try names its connectors: pretend (the default) or real', async () => {
  const bad = await _testing.invokeStartRun({ noProject: true, prompt: 'x' }, null, { workflowTest: { use: 'draft', connectors: 'maybe' } });
  assert.deepEqual([bad.status, bad.body.error], [400, 'a test try names its connectors: pretend or real']);
  const out = await _testing.invokeStartRun({ noProject: true, workflowId: 'wf_try', prompt: 'Plan it', title: 'Test: Bulk · try 3' }, null,
    { workflowTest: { use: 'draft' } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const entry = runs.get(out.body.runId);
  assert.equal(entry.orch._testConnectors(), 'pretend');
  await settled(out.body.runId);
});
```

- [ ] **Step 14: Run the tests**

Run: `node tools/test.mjs test/api-workflow-test-try.test.mjs test/workflow-test-connectors.test.mjs test/mcp-mock-connector.test.mjs test/mcp-test.test.mjs test/mcp-views.test.mjs`
Expected: PASS.

Not proven here (the mock engine starts no MCP server): that `--strict-mcp-config` also drops claude.ai connectors and Claude Code plugin servers. Task 15's real-call proof checks it, with `mcp__claude_ai_*` disallowed as the belt meanwhile.

- [ ] **Step 15: Commit**

```bash
git add src/core/mcp/mock-connector.mjs src/core/workflow-tests/connectors.mjs src/core/mcp/test.mjs src/core/mcp/store.mjs src/core/mcp/registry.mjs src/core/mcp/views.mjs src/core/run-context.mjs src/core/run-harness.mjs src/core/orchestrator.mjs src/core/phases.mjs src/core/engines/claude.mjs src/core/graph/script-runner.mjs ui/server.mjs test/mcp-mock-connector.test.mjs test/workflow-test-connectors.test.mjs test/mcp-test.test.mjs test/api-workflow-test-try.test.mjs
git commit -m "Workflow tests: pretend connectors, stand-ins that send nothing and record what would have been sent (D35)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 6: What one try produced: facts, the main result, files, script checks

**Files:**
- Create: `src/core/workflow-tests/result.mjs`
- Test: `test/workflow-test-result.test.mjs`

**Interfaces:**
- Consumes:
  - `findPipelineRowById`, `readPipelineStateById`, `listRunArtifacts(id, { kind })`, `resolveIndexedArtifactForRow`, `runDirForRow` (artifacts.mjs)
  - `WORK_ARTIFACT_KIND` (no-project-work.mjs)
  - `runBenchOnce(request, { allowDirCwd: true })` (script-bench.mjs:621)
  - Task 1
- Produces:
  - `TEXT_EXTS`, `RESULT_TEXT_MAX = 2 MB`
  - `mainResult(pipelineId) → Promise<{ name, text, source: 'end-file'|'end-value'|'work'|null }>` (D25; never throws)
  - `readTryOutcome(pipelineId, { help, failReason, durationMs }) → Promise<outcome>`, where `outcome = { pipelineId, facts: { status, costUsd, durationMs, sentBack, help, failReason }, name, text, source, files: string[] }`
  - `checkTry(example, outcome, { runScript?, scriptName? }) → Promise<verdict>` (Task 1's verdict)
  - `runScriptCheck(check, { pipelineId, runBench?, waitMs? }) → Promise<{ met, value, error? }>`

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-result.test.mjs`:

```js
// test/workflow-test-result.test.mjs — D25: a try's facts, its main result, its result folder, and the script checks.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { createPipeline, writeState, recordArtifact } from '../src/core/artifacts.mjs';
import { projectKey } from '../src/core/store.mjs';
import { mainResult, readTryOutcome, checkTry, runScriptCheck } from '../src/core/workflow-tests/result.mjs';
import { normaliseCheck } from '../src/shared/workflow-tests/checks.mjs';

const homes = [];
let projectDir;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wftres-'));
  homes.push(dir); _resetForTests(); process.env.WORCA_HOME = dir;
  projectDir = join(dir, 'proj');
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

async function seedTry({ result = null, work = {}, wireDeliveries = {}, status = 'done', cost = 0.42 } = {}) {
  const { id, dir } = await createPipeline(projectDir, { prompt: 'p', title: 't', isTest: true });
  for (const [rel, text] of Object.entries(work)) {
    const file = join(dir, 'work', ...rel.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    recordArtifact(id, 'work', `work/${rel}`);
  }
  const r = typeof result === 'function' ? result(dir) : result;
  await writeState(dir, { projectKey: projectKey(projectDir), id, status, totalCostUsd: cost, steps: [], engine: 2, endReached: !!r, result: r, wireDeliveries });
  return { id, dir };
}
const BRIEF = '# Brief\n\nHello world';

test('the main result: the End result file, then the End value, then the largest text file', async () => {
  const a = await seedTry({ work: { 'brief.md': BRIEF, 'notes/long.txt': 'x '.repeat(3000) }, result: (dir) => ({ type: 'md', path: join(dir, 'work', 'brief.md') }) });
  assert.deepEqual(await mainResult(a.id), { name: 'brief.md', text: BRIEF, source: 'end-file' });
  const b = await seedTry({ result: { type: 'md', value: 'Short answer' } });
  assert.deepEqual(await mainResult(b.id), { name: null, text: 'Short answer', source: 'end-value' });
  const c = await seedTry({ work: { 'a.md': 'small', 'b.txt': 'a bigger text here', 'pic.png': 'x'.repeat(100) } });
  assert.deepEqual(await mainResult(c.id), { name: 'b.txt', text: 'a bigger text here', source: 'work' });
  const d = await seedTry();
  assert.deepEqual(await mainResult(d.id), { name: null, text: null, source: null });
  assert.deepEqual(await mainResult('nope0000'), { name: null, text: null, source: null });
});

test('the outcome: status, cost, the loop deliveries as "sent back", the help and the result folder', async () => {
  const t = await seedTry({ work: { 'brief.md': BRIEF }, wireDeliveries: { w_loop: 2, w_other: 1 } });
  const o = await readTryOutcome(t.id, { help: [{ kind: 'questions', question: 'Who?' }], durationMs: 1234 });
  assert.deepEqual(o.facts, { status: 'done', costUsd: 0.42, durationMs: 1234, sentBack: 3, help: [{ kind: 'questions', question: 'Who?' }], failReason: null });
  assert.deepEqual([o.pipelineId, o.name, o.text, o.files], [t.id, 'brief.md', BRIEF, ['work/brief.md']]);
  const none = await readTryOutcome(null);
  assert.deepEqual([none.facts.status, none.facts.failReason, none.files], ['error', 'The try did not start.', []]);
});

test('checkTry: built-in checks on the result, then the script checks; a try that did not finish runs no script', async () => {
  const t = await seedTry({ work: { 'brief.md': BRIEF }, wireDeliveries: { w: 3 } });
  const example = {
    basics: { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: 1 },
    checks: [{ id: 'c_1', ...normaliseCheck({ kind: 'words', min: 2 }).check }, { id: 'c_2', ...normaliseCheck({ kind: 'file', name: 'brief.md' }).check },
      { id: 'c_3', ...normaliseCheck({ kind: 'script', key: 'lint-md' }).check }],
  };
  const calls = [];
  const runScript = async (check, { pipelineId }) => { calls.push([check.key, pipelineId]); return { met: false, value: '2 problems' }; };
  const v = await checkTry(example, await readTryOutcome(t.id), { runScript, scriptName: () => 'Markdown lint' });
  assert.equal(v.passed, false);
  assert.deepEqual(v.checks.map((c) => [c.label, c.met, c.value]), [
    ['Length is at least 2 words', true, '3 words'],
    ['Has a file named brief.md', true, 'Met'],
    ['The Library script "Markdown lint" passes', false, '2 problems'],
  ]);
  assert.deepEqual(v.basics.map((b) => [b.key, b.met]), [['noError', true], ['noHelp', true], ['maxSentBack', false]]);
  assert.deepEqual(v.result, { name: 'brief.md', source: 'work', words: 3 });
  assert.deepEqual(calls, [['lint-md', t.id]]);
  const stopped = await seedTry({ status: 'stopped' });
  const v2 = await checkTry(example, await readTryOutcome(stopped.id), { runScript });
  assert.equal(v2.checks[2].value, 'Not run: the try did not finish');
  assert.equal(calls.length, 1);
});

test('a script check runs on a copy of the result folder, waits while the bench is busy, and passes on clean', async () => {
  const t = await seedTry({ work: { 'brief.md': BRIEF } });
  const seen = [];
  let busy = 1;
  const runBench = async (req, deps) => {
    if (busy-- > 0) throw Object.assign(new Error('busy'), { code: 'BUSY' });
    seen.push({ copied: existsSync(join(req.cwd.dir, 'brief.md')), allow: deps.allowDirCwd, kind: req.cwd.kind, dir: req.cwd.dir });
    return { status: 'clean', summary: '' };
  };
  const ok = await runScriptCheck({ kind: 'script', key: 'lint-md', params: {} }, { pipelineId: t.id, runBench, waitMs: 1 });
  assert.deepEqual(ok, { met: true, value: 'Met' });
  assert.deepEqual([seen[0].copied, seen[0].allow, seen[0].kind], [true, true, 'dir']);
  assert.equal(existsSync(seen[0].dir), false, 'the copy is removed afterwards');
  assert.ok(existsSync(join(t.dir, 'work', 'brief.md')), 'the try\'s own result is untouched');
  const bad = await runScriptCheck({ kind: 'script', key: 'lint-md' }, { pipelineId: t.id, runBench: async () => ({ status: 'blocking', summary: 'Heading levels skip\nmore' }) });
  assert.deepEqual(bad, { met: false, value: 'Heading levels skip' });
  const gone = await runScriptCheck({ kind: 'script', key: 'nope' }, { pipelineId: t.id, runBench: async () => { throw Object.assign(new Error('script "nope" not found'), { code: 'NOT_FOUND' }); } });
  assert.deepEqual(gone, { met: false, value: 'Not met', error: 'script "nope" not found' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-result.test.mjs`
Expected: FAIL with `Cannot find module '../src/core/workflow-tests/result.mjs'`.

- [ ] **Step 3: Implement `src/core/workflow-tests/result.mjs`**

```js
// src/core/workflow-tests/result.mjs
// What one try produced and how it measures up (plans/workflow-tests-part2-plan.md D25): the facts the Basics read,
// the main result the text checks read, the paths of its result folder, and the Library script checks (run on the
// script bench, on a COPY of that folder, one at a time).
import { mkdtemp, cp, rm, stat, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { findPipelineRowById, readPipelineStateById, listRunArtifacts, resolveIndexedArtifactForRow, runDirForRow } from '../artifacts.mjs';
import { WORK_ARTIFACT_KIND } from '../no-project-work.mjs';
import { runBenchOnce } from '../script-bench.mjs';
import { runCheck, judgeTry, wordCount, checkLabel } from '../../shared/workflow-tests/checks.mjs';

export const TEXT_EXTS = Object.freeze(new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.csv', '.json', '.yaml', '.yml', '.xml']));
export const RESULT_TEXT_MAX = 2 * 1024 * 1024;
const BUSY_RETRIES = 5;
const BUSY_WAIT_MS = 3000;
const NONE = Object.freeze({ name: null, text: null, source: null });
const isText = (p) => TEXT_EXTS.has(extname(String(p || '')).toLowerCase());
const clip = (t) => (typeof t === 'string' && t.length > RESULT_TEXT_MAX ? t.slice(0, RESULT_TEXT_MAX) : t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** D25: the End node's result file, else its value, else the largest text file in the result folder. Never throws. */
export async function mainResult(pipelineId) {
  try {
    const row = pipelineId ? findPipelineRowById(pipelineId) : null;
    if (!row) return { ...NONE };
    const result = readPipelineStateById(row.id)?.result || null;
    if (result && typeof result.path === 'string' && result.path && isText(result.path)) {
      const hit = await resolveIndexedArtifactForRow(row, result.path);
      if (hit) return { name: basename(hit.rel), text: clip(hit.text), source: 'end-file' };
    }
    if (result && result.value != null && result.value !== '') {
      return { name: null, text: clip(typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2)), source: 'end-value' };
    }
    const work = (await listRunArtifacts(row.id, { kind: WORK_ARTIFACT_KIND })).filter((a) => isText(a.relPath))
      .sort((x, y) => y.bytes - x.bytes || (x.relPath < y.relPath ? -1 : 1));
    for (const a of work) {
      const hit = await resolveIndexedArtifactForRow(row, a.relPath);
      if (hit) return { name: basename(hit.rel), text: clip(hit.text), source: 'work' };
    }
    return { ...NONE };
  } catch { return { ...NONE }; }
}

const sumDeliveries = (wd) => Object.values(wd && typeof wd === 'object' ? wd : {})
  .reduce((s, n) => s + (Number.isFinite(Number(n)) ? Number(n) : 0), 0);

/** Everything the verdict needs from a finished try. `help` and `failReason` come from the runner (answers.mjs). */
export async function readTryOutcome(pipelineId, { help = [], failReason = null, durationMs = null } = {}) {
  const row = pipelineId ? findPipelineRowById(pipelineId) : null;
  const state = row ? readPipelineStateById(row.id) : null;
  const facts = {
    status: row ? row.status : 'error',
    costUsd: row ? Number(row.total_cost_usd || 0) : 0,
    durationMs,
    sentBack: sumDeliveries(state && state.wireDeliveries),   // correction 2: loop deliveries
    help,
    failReason: failReason || (row ? null : 'The try did not start.'),
  };
  const main = row ? await mainResult(row.id) : { ...NONE };
  const files = row ? (await listRunArtifacts(row.id, { kind: WORK_ARTIFACT_KIND })).map((a) => a.relPath) : [];
  return { pipelineId: row ? row.id : null, facts, ...main, files };
}

let benchTail = Promise.resolve();
const copyable = async (src) => { try { return !(await lstat(src)).isSymbolicLink(); } catch { return false; } };

/**
 * One Library script check (D18, D25) on a COPY of the try's result folder: a script may write into its cwd, and the
 * try's own result must stay as it was for the other checks and the side-by-side view. Serialised (one script check
 * at a time), so the bench's limits (2 at once, one per key: script-bench.mjs:335) only meet a person's own bench runs,
 * which are waited out. Met when the bench says `clean`.
 */
export function runScriptCheck(check, { pipelineId, runBench = runBenchOnce, waitMs = BUSY_WAIT_MS } = {}) {
  const job = async () => {
    const row = pipelineId ? findPipelineRowById(pipelineId) : null;
    const scratch = await mkdtemp(join(tmpdir(), 'worca-wft-'));
    try {
      if (row) {
        const work = join(await runDirForRow(row), 'work');
        try { if ((await stat(work)).isDirectory()) await cp(work, scratch, { recursive: true, force: true, filter: copyable }); } catch { /* no result folder: an empty one */ }
      }
      for (let attempt = 0; ; attempt += 1) {
        try {
          const r = await runBench({ key: check.key, params: check.params || {}, inputs: {}, cwd: { kind: 'dir', dir: scratch } }, { allowDirCwd: true });
          const met = !!r && r.status === 'clean';
          return { met, value: met ? 'Met' : String((r && (r.summary || r.status)) || 'Not met').split('\n')[0].slice(0, 120) };
        } catch (err) {
          if (err && err.code === 'BUSY' && attempt < BUSY_RETRIES) { await wait(waitMs); continue; }
          return { met: false, value: 'Not met', error: err && err.message ? err.message : String(err) };
        }
      }
    } finally { await rm(scratch, { recursive: true, force: true }).catch(() => {}); }
  };
  const p = benchTail.then(job, job);
  benchTail = p.catch(() => {});
  return p;
}

/**
 * The verdict of one try: every built-in check on its main result and files, then its script checks (D18).
 * @param {{basics: object, checks: Array}} example
 * @param {object} outcome readTryOutcome's answer
 * @param {{runScript?: Function, scriptName?: (key: string) => string}} [opts]
 */
export async function checkTry(example, outcome, { runScript = runScriptCheck, scriptName = (k) => k } = {}) {
  const results = [];
  for (const check of example.checks || []) {
    const label = checkLabel(check, { scriptName: check.kind === 'script' ? scriptName(check.key) : null });
    if (check.kind === 'script') {
      if (outcome.facts.status !== 'done') { results.push({ id: check.id, label, met: false, value: 'Not run: the try did not finish' }); continue; }
      const r = await runScript(check, { pipelineId: outcome.pipelineId });
      results.push({ id: check.id, label, met: !!r.met, value: r.value, ...(r.error ? { error: r.error } : {}) });
      continue;
    }
    const r = runCheck(check, { text: outcome.text, files: outcome.files });
    results.push({ id: check.id, label, met: r.met, value: r.value });
  }
  return judgeTry(example, outcome.facts, results,
    { name: outcome.name, source: outcome.source, words: typeof outcome.text === 'string' ? wordCount(outcome.text) : null });
}
```

- [ ] **Step 4: Run the test**

Run: `node tools/test.mjs test/workflow-test-result.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow-tests/result.mjs test/workflow-test-result.test.mjs
git commit -m "Workflow tests: a try's facts, its main result, and the script checks on a copy of its folder (D25)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: The test runner (3 at a time, one test per workflow, cost cap, stop, finish the rest, quick check, reuse)

**Files:**
- Create: `src/core/workflow-tests/uses.mjs`, `src/core/workflow-tests/runner.mjs`
- Test: `test/workflow-test-runner.test.mjs`

**Interfaces:**
- Consumes:
  - Tasks 2–4
  - `readWorkflow` (workflows.mjs), `readVersion` (workflow-revisions.mjs), `workflowParts`, `workflowFingerprint`
- Produces:
  - `useGraph(workflowId, use) → Promise<{ name, nodes, wires } | null>`
  - `useFingerprint(workflowId, use, deps?) → Promise<string>`. It throws `NOT_FOUND` for a version that does not exist.
  - `MAX_PARALLEL = 3` (D36), `COST_POLL_MS = 2000`, `BUSY_TEXT = 'A test of this workflow is running. Wait for it, or stop it first.'` (D37)
  - `changedText(use)`, `editedText(name)`: the C18 sentences
  - `createTestRunner(deps) → { start, stop, continueRun, recover, idle, costOf }`, with:
    - `deps = { startRun(body, { startedBy, workflowTest: { use, connectors, onOrch } }), liveRun(runKey) → { orch, status, launch, pipelineId } | null, stopRun(runKey), answer(runKey, id, payload) → boolean, outcomeOf(pipelineId, opts), judge(example, outcome), fingerprintOf(workflowId, use), targetOf?(workflowId, use) → { testable, reason }, mockMode?(), notify?(frame), pollMs? }`
    - `start({ workflowId, kind = 'compare'|'once', a, b, exampleIds, tries, reuseA = true, reuseB = false, quickCheck = false, capUsd = null, connectors = 'pretend', by }) → Promise<run>`. It throws `BUSY` (with `BUSY_TEXT`), `BAD_REQUEST`, `NOT_FOUND` or `NOT_TESTABLE` (review M9: a version on either side that needs a project).
    - `stop(runId, { reason = 'person' }) → Promise<run>` (resolves when the loop has ended)
    - `continueRun(runId, { capUsd? }) → Promise<run>`
    - `recover() → number`, `idle(runId) → Promise`, `costOf(runId) → number`
  - Frames through `deps.notify`: `{ type: 'workflow-tests-changed', workflowId, testRunId }`; at the end `{ …, finished: true, status }` (D33: never a `runId` field).
  - A test stops with `stopReason` one of `person`, `cap`, `budget`, `drain`, `refused`, `quick-check`, `restart`, `changed` (D27, review I3) or `error`.

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-runner.test.mjs`:

```js
// test/workflow-test-runner.test.mjs — D26/D27/D35–D37: the runner on a fake run handler (no engine, no server):
// parallelism, verdicts, canned answers, the cost cap, stop and finish the rest, the quick check, refusals, a change
// during a test, connectors and reuse. Plus uses.mjs against a real workflow and its versions.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { createTestRunner, MAX_PARALLEL } from '../src/core/workflow-tests/runner.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';

const homes = [];
let home;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-wftrun-'));
  homes.push(home); _resetForTests(); process.env.WORCA_HOME = home;
});
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const WF = 'wf_brief';
const fps = {};
/** A fake run handler: each try is an EventEmitter "orchestrator" that ends as `plan()` says. */
function harness({ plan = () => ({ status: 'done', cost: 0.5 }), refuse = null } = {}) {
  const entries = new Map();
  const started = []; const stopped = [];
  let n = 0; let liveNow = 0; let maxLive = 0;
  const deps = {
    startRun: async (body, { workflowTest }) => {
      if (refuse) return refuse;
      n += 1;
      const runKey = `run-${n}`; const pipelineId = `p${String(n).padStart(7, '0')}`;
      const orch = new EventEmitter(); orch.state = { totalCostUsd: 0 };
      const p = plan(body, workflowTest.use, n);
      let finish;
      const launch = new Promise((r) => { finish = r; });
      const e = { orch, launch, status: 'running', pipelineId, text: p.text ?? '# Result\n\nProblem solved here',
        end(status) { if (e.status !== 'running') return; e.status = status; liveNow -= 1; finish(); } };
      orch.answer = (id, payload) => { e.answered = [id, payload]; setImmediate(() => e.end(p.status)); return true; };
      entries.set(runKey, e); liveNow += 1; maxLive = Math.max(maxLive, liveNow);
      workflowTest.onOrch(orch, { runKey });
      started.push({ runKey, use: workflowTest.use, connectors: workflowTest.connectors, mock: !!body.mock, title: body.title });
      setImmediate(() => {
        orch.state.totalCostUsd = p.cost;
        if (p.ask) orch.emit('question', p.ask);
        else if (!p.hold) e.end(p.status);
      });
      return { status: 200, body: { runId: runKey, pipelineId } };
    },
    liveRun: (k) => entries.get(k) || null,
    stopRun: async (k) => { stopped.push(k); entries.get(k)?.end('stopped'); },
    answer: (k, id, payload) => entries.get(k).orch.answer(id, payload),
    outcomeOf: async (pipelineId, { help = [], failReason = null, durationMs = null } = {}) => {
      const e = [...entries.values()].find((x) => x.pipelineId === pipelineId);
      return { pipelineId, facts: { status: e.status, costUsd: e.orch.state.totalCostUsd, durationMs, sentBack: 0, help, failReason },
        text: e.text, name: 'result.md', source: 'work', files: ['work/result.md'] };
    },
    judge: (example, outcome) => checkTry(example, outcome),
    fingerprintOf: async (_wf, use) => fps[store.useRef(use)] ?? `fp-${store.useRef(use)}`,
    mockMode: () => false,
    pollMs: 5,
  };
  return { deps, started, stopped, entries, maxLive: () => maxLive };
}
const example = (over = {}) => store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.', tries: 3, ...over });
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };
const statuses = (runId) => store.triesOfRun(runId).map((t) => `${t.side}${t.tryNo}:${t.status}`);

test('two versions, two examples, three tries each: 12 tries, at most 3 at a time, every verdict stored', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness();
  const frames = [];
  const runner = createTestRunner({ ...h.deps, notify: (f) => frames.push(f) });
  const e1 = example(); const e2 = example({ name: 'Saved filters' });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [e1.id, e2.id], tries: 3, capUsd: 50, by: 'Tomica' });
  await runner.idle(run.id);
  const done = store.readTestRun(run.id);
  assert.deepEqual([done.status, done.stopReason], ['done', null]);
  assert.equal(h.started.length, 12);
  assert.ok(h.maxLive() <= MAX_PARALLEL, `at most ${MAX_PARALLEL} at once, saw ${h.maxLive()}`);
  assert.equal(MAX_PARALLEL, 3);
  assert.deepEqual(h.started.slice(0, 3).map((s) => s.use), [1, 'draft', 1], 'example by example, try by try, the old version first');
  const tries = store.triesOfRun(run.id);
  assert.ok(tries.every((t) => t.status === 'passed' && t.verdict.passed && t.costUsd === 0.5));
  assert.equal(store.spentOfRun(run.id), 6);
  assert.match(h.started[0].title, /^Test: Bulk invoice export · try 1$/);
  assert.ok(frames.length && frames.every((f) => f.type === 'workflow-tests-changed' && f.testRunId === run.id && !('runId' in f)), 'D33: testRunId, never runId');
  assert.deepEqual([frames.at(-1).finished, frames.at(-1).status], [true, 'done']);
});

test('canned answers: "the try counts as failed" stops it; "Worca picks" goes on, but it needed help', async () => {
  const ask = { id: 'q-1', kind: 'questions', questions: [{ id: 'q1', question: 'Which screens come first?', options: ['Home', 'Settings'] }] };
  const h = harness({ plan: () => ({ status: 'done', cost: 0.2, ask }) });
  const runner = createTestRunner(h.deps);
  const strict = example({ otherwise: 'fail', tries: 1 });
  const r1 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [strict.id], tries: 1 });
  await runner.idle(r1.id);
  const [t1] = store.triesOfRun(r1.id);
  assert.equal(t1.status, 'failed');
  assert.deepEqual(h.stopped, [t1.runKey], 'the try was stopped');
  assert.equal(t1.verdict.basics[0].detail, 'Worca asked "Which screens come first?", and this example has no answer for it.');
  const loose = example({ name: 'Loose', otherwise: 'pick', tries: 1 });
  const r2 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [loose.id], tries: 1 });
  await runner.idle(r2.id);
  const [t2] = store.triesOfRun(r2.id);
  assert.deepEqual([t2.status, t2.verdict.facts.status, t2.verdict.facts.help.length], ['failed', 'done', 1]);
  assert.deepEqual(h.entries.get(t2.runKey).answered, ['q-1', { answers: [{ id: 'q1', choice: 'Home' }] }]);
  const answered = example({ name: 'Answered', tries: 1, answers: [{ question: 'Which screens come first?', answer: 'Settings' }] });
  const r3 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [answered.id], tries: 1 });
  await runner.idle(r3.id);
  assert.equal(store.triesOfRun(r3.id)[0].status, 'passed');
});

test('the cost cap stops the running tries, keeps the waiting ones, and finish the rest needs a higher cap', async () => {
  let hold = true;
  const h = harness({ plan: () => (hold ? { status: 'done', cost: 3, hold: true } : { status: 'done', cost: 0.5 }) });
  const runner = createTestRunner(h.deps);
  const ex = example();
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3, capUsd: 5 });
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason], ['stopped', 'cap']);
  assert.deepEqual(statuses(run.id).sort(), ['a1:stopped', 'a2:stopped', 'a3:waiting', 'b1:stopped', 'b2:waiting', 'b3:waiting'], 'three ran at once');
  assert.equal(store.spentOfRun(run.id), 9, 'the stopped tries count in the cost');
  await assert.rejects(runner.continueRun(run.id), { code: 'BAD_REQUEST', message: 'Raise the cost limit above $9.00 to finish the rest.' });
  hold = false;
  await runner.continueRun(run.id, { capUsd: 20 });
  await runner.idle(run.id);
  assert.equal(store.readTestRun(run.id).status, 'done');
  assert.deepEqual(statuses(run.id).sort(), ['a1:passed', 'a2:passed', 'a3:passed', 'b1:passed', 'b2:passed', 'b3:passed']);
  assert.equal(store.spentOfRun(run.id), 12);
});

test('a person stops a test; finish the rest is refused once the draft or an example changed', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  let hold = true;
  const h = harness({ plan: () => (hold ? { status: 'done', cost: 0.1, hold: true } : { status: 'done', cost: 0.1 }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  await until(() => h.started.length === 2);
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 }),
    { code: 'BUSY', message: 'A test of this workflow is running. Wait for it, or stop it first.' });
  await assert.rejects(runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 }), { code: 'BUSY' }, 'Try it once now too (D37)');
  const stoppedRun = await runner.stop(run.id);
  assert.deepEqual([stoppedRun.status, stoppedRun.stopReason], ['stopped', 'person']);
  fps.draft = 'fp-draft-edited';
  await assert.rejects(runner.continueRun(run.id), { message: 'Your draft changed since this test started: start a new test.' });
  delete fps.draft;
  store.updateExample(WF, ex.id, { request: 'Another request' });
  await assert.rejects(runner.continueRun(run.id), { message: '"Bulk invoice export" was edited since this test started: start a new test.' });
  store.updateExample(WF, ex.id, { request: 'Write the brief.' });
  hold = false;
  await runner.continueRun(run.id);
  await runner.idle(run.id);
  assert.equal(store.readTestRun(run.id).status, 'done');
});

test('a change during a test stops it before its next try: the draft, then an example (review I3)', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness({ plan: () => ({ status: 'done', cost: 0.1, hold: true }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 5 });
  const r1 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 5 });
  await until(() => h.started.length === MAX_PARALLEL);
  fps.draft = 'fp-draft-edited';
  h.entries.get(h.started[0].runKey).end('done');
  await runner.idle(r1.id);
  const s1 = store.readTestRun(r1.id);
  assert.deepEqual([s1.status, s1.stopReason, s1.stopDetail], ['stopped', 'changed', 'Your draft changed since this test started: start a new test.']);
  assert.equal(h.started.length, MAX_PARALLEL, 'the fourth try never started: it would have run the edited draft as the old one');
  assert.deepEqual(statuses(r1.id).sort(), ['b1:passed', 'b2:stopped', 'b3:stopped', 'b4:waiting', 'b5:waiting']);
  delete fps.draft;
  const r2 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 5 });
  await until(() => h.started.length === MAX_PARALLEL * 2);
  store.updateExample(WF, ex.id, { request: 'Another request' });
  h.entries.get(h.started[MAX_PARALLEL].runKey).end('done');
  await runner.idle(r2.id);
  const s2 = store.readTestRun(r2.id);
  assert.deepEqual([s2.stopReason, s2.stopDetail], ['changed', '"Bulk invoice export" was edited since this test started: start a new test.']);
});

test('connectors: the mode reaches every try, is stored, and keeps pretend and real results apart (D35)', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness();
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const real = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, connectors: 'real' });
  await runner.idle(real.id);
  assert.equal(store.readTestRun(real.id).connectors, 'real');
  assert.deepEqual(h.started.map((s) => s.connectors), ['real', 'real']);
  assert.ok(store.triesOfRun(real.id).every((t) => t.connectors === 'real'));
  const pretend = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: true });
  await runner.idle(pretend.id);
  assert.equal(h.started.length, 4, 'a real result is never reused for a pretend test');
  assert.deepEqual(h.started.slice(2).map((s) => s.connectors), ['pretend', 'pretend']);
  await assert.rejects(runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, connectors: 'maybe' }),
    { code: 'BAD_REQUEST', message: 'connectors must be "pretend" or "real"' });
});

test('the free quick check runs first as a mock try; when it fails nothing real is tried', async () => {
  const h = harness({ plan: (body) => (body.mock ? { status: 'error', cost: 0 } : { status: 'done', cost: 0.5 }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true });
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason, st.quick], ['stopped', 'quick-check', { status: 'failed', detail: 'the quick check ended as error' }]);
  assert.deepEqual(h.started.map((s) => [s.mock, s.title]), [[true, 'Quick check: Bulk invoice export']]);
  assert.deepEqual(statuses(run.id).sort(), ['a1:waiting', 'b1:waiting']);
});

test('a refused start (the spending limit) stops the test and keeps the try waiting', async () => {
  const h = harness({ refuse: { status: 403, body: { error: 'total cost limit reached' } } });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason, st.stopDetail], ['stopped', 'budget', 'total cost limit reached']);
  assert.ok(statuses(run.id).every((s) => s.endsWith(':waiting')));
});

test('reuse: an old version\'s finished tries are reused only while nothing changed (D26)', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness();
  const runner = createTestRunner(h.deps);
  const ex = example();
  const first = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3 });
  await runner.idle(first.id);
  const second = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3, reuseA: true });
  await runner.idle(second.id);
  assert.equal(h.started.length, 9, 'only the draft was tried again');
  const reused = store.triesOfRun(second.id).filter((t) => t.side === 'a');
  assert.deepEqual([reused.length, reused.every((t) => t.runId === first.id)], [3, true]);
  assert.equal(store.spentOfRun(second.id), 1.5);
  fps['1'] = 'fp-1-library-edit';
  const third = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3, reuseA: true });
  await runner.idle(third.id);
  assert.equal(h.started.length, 15, 'a changed version is tried again');
  store.updateExample(WF, ex.id, { request: 'A new request' });
  const fourth = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3, reuseA: true, reuseB: true });
  await runner.idle(fourth.id);
  assert.equal(h.started.length, 21, 'a changed example is tried again on both sides');
});

test('bad starts are refused before anything runs; a restart stops what was running', async () => {
  const runner = createTestRunner(harness().deps);
  const ex = example();
  await assert.rejects(runner.start({ workflowId: WF, a: 'draft', b: 'draft', exampleIds: [ex.id], tries: 3 }), { message: 'pick two different versions to compare' });
  await assert.rejects(runner.start({ workflowId: WF, b: 'draft', exampleIds: [ex.id], tries: 3 }), { message: 'pick the version to compare with' });
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 11 }), { message: 'tries must be 1 to 10' });
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [], tries: 3 }), { message: 'pick at least one example' });
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [999], tries: 3 }), { code: 'NOT_FOUND' });
  const empty = example({ name: 'Empty', request: '' });
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [empty.id], tries: 3 }), { message: 'Write the request of "Empty" first.' });
  const guarded = createTestRunner({ ...harness().deps, targetOf: async (_wf, use) => (use === 1 ? { testable: false, reason: 'needs-project' } : { testable: true, reason: null }) });
  await assert.rejects(guarded.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 }),
    { code: 'NOT_TESTABLE', message: 'v1 works on a project, and tests work for workflows without a project for now.' }, 'review M9: side A is checked too');
  store.createTestRun({ workflowId: WF, a: 1, b: 'draft', aFp: 'x', bFp: 'y', exampleIds: [ex.id], tries: 1 });
  assert.equal(runner.recover(), 1);
});

test('uses: the draft and a version have the same fingerprint until either changes; a Library edit changes both', async () => {
  const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
  const { createVersion } = await import('../src/core/workflow-versions.mjs');
  const { useFingerprint, useGraph } = await import('../src/core/workflow-tests/uses.mjs');
  const md = join(home, 'planner.md');
  await writeFile(md, 'Plan it.');
  const deps = { registry: { planner: { key: 'planner', origin: 'builtin', agentPath: md, displayName: 'Planner' } }, scripts: {} };
  const tpl = (name) => ({ id: 'wf_uses', name, domain: 'product',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }] });
  await writeGraphWorkflow(tpl('Uses'));
  await createVersion('wf_uses', { deps });
  const v1 = await useFingerprint('wf_uses', 1, deps);
  assert.equal(await useFingerprint('wf_uses', 'draft', deps), v1);
  const moved = tpl('Uses renamed'); moved.nodes[1] = { ...moved.nodes[1], config: { model: 'sonnet' } };
  await writeGraphWorkflow(moved);
  assert.notEqual(await useFingerprint('wf_uses', 'draft', deps), v1);
  assert.equal((await useGraph('wf_uses', 1)).name, 'Uses');
  await writeFile(md, 'Plan it carefully.');
  assert.notEqual(await useFingerprint('wf_uses', 1, deps), v1, 'every version runs today\'s Library text (D6)');
  await assert.rejects(useFingerprint('wf_uses', 7, deps), { code: 'NOT_FOUND' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-runner.test.mjs`
Expected: FAIL with `Cannot find module '../src/core/workflow-tests/runner.mjs'`.

- [ ] **Step 3: Implement `src/core/workflow-tests/uses.mjs`**

```js
// src/core/workflow-tests/uses.mjs
// What a try runs (plans/workflow-tests-part2-plan.md D13, D26): the draft (the workflows row) or a saved version, and
// its identity. The fingerprint uses TODAY's agent and script text, which every version runs (D6), so a Library edit
// since a try makes its results unusable for reuse.
import { readWorkflow } from '../workflows.mjs';
import { readVersion } from '../workflow-revisions.mjs';
import { workflowParts } from '../workflow-parts.mjs';
import { workflowFingerprint } from '../workflow-fingerprint.mjs';
import { testError } from './store.mjs';

const listOf = (a) => (Array.isArray(a) ? a : []);

/** @returns {Promise<{name: string, nodes: Array, wires: Array}|null>} */
export async function useGraph(workflowId, use) {
  if (use === 'draft') {
    const row = await readWorkflow(workflowId);
    return row && row.version === 2 ? { name: row.name, nodes: listOf(row.nodes), wires: listOf(row.wires) } : null;
  }
  const v = Number.isInteger(use) && use > 0 ? readVersion(workflowId, use) : null;
  return v ? { name: v.name, nodes: listOf(v.graph && v.graph.nodes), wires: listOf(v.graph && v.graph.wires) } : null;
}

/** @param {{registry?: object, scripts?: object, readText?: Function, scriptSource?: Function}} [deps] workflowParts' */
export async function useFingerprint(workflowId, use, deps = {}) {
  const g = await useGraph(workflowId, use);
  if (!g) throw testError(use === 'draft' ? `no workflow "${workflowId}"` : `no version ${use} of "${workflowId}"`, 'NOT_FOUND');
  return workflowFingerprint(g, await workflowParts(g, deps));
}
```

- [ ] **Step 4: Implement `src/core/workflow-tests/runner.mjs`**

```js
// src/core/workflow-tests/runner.mjs
// The test runner (plans/workflow-tests-part2-plan.md D27, D35–D37). It tries examples on one or two versions, at most
// MAX_PARALLEL at a time and one test per workflow, answers their questions (answers.mjs), stops when the cost cap is
// passed or something a try depends on changed, and judges every finished try (deps.judge). Each try is an ordinary
// no-project run started through the run handler (deps.startRun), marked as a test (D21), with the test's connectors
// mode (D35). The state lives in the store; this module keeps only what is live.
import * as store from './store.mjs';
import { attachAnswerer } from './answers.mjs';
import { tryRunBody } from './try-body.mjs';
import { fmtUsd } from '../../shared/workflow-tests/checks.mjs';

export const MAX_PARALLEL = 3;   // D36. Library script checks stay one at a time (result.mjs), inside runBenchOnce's limit of 2.
export const COST_POLL_MS = 2000;
/** D37, G19: the refusal of a second start, and the hint the UI shows on its disabled buttons. */
export const BUSY_TEXT = 'A test of this workflow is running. Wait for it, or stop it first.';
/** C18: what changed since a test started (a refused "Finish the rest", or a test stopped as `changed`). */
export const changedText = (use) => `${use === 'draft' ? 'Your draft' : `v${use}`} changed since this test started: start a new test.`;
export const editedText = (name) => `"${name}" was edited since this test started: start a new test.`;
const err = store.testError;
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t && t.unref) t.unref(); });
const quiet = (p) => { Promise.resolve(p).catch(() => {}); };
const capError = () => err('the cost limit must be more than $0 and at most $10,000', 'BAD_REQUEST');
const validCap = (v) => Number.isFinite(v) && v > 0 && v <= 10000;

/** @param {object} deps see the Interfaces of Task 7 */
export function createTestRunner(deps) {
  const live = new Map();       // test run id → { stopping, detail, running: Map<key, {runKey}>, done }
  const starting = new Set();   // workflow ids between the BUSY check and their run row (a start awaits fingerprints)
  const pollMs = deps.pollMs ?? COST_POLL_MS;
  const notify = (run, extra = {}) => {
    // D33: `testRunId`, never `runId`: a tab turns any frame with a runId into a run.
    try { if (deps.notify) deps.notify({ type: 'workflow-tests-changed', workflowId: run.workflowId, testRunId: run.id, ...extra }); } catch { /* a frame only */ }
  };

  /** D27: the run's own finished and stopped tries plus what its live tries have spent so far. */
  function costOf(runId) {
    let usd = store.spentOfRun(runId);
    const st = live.get(Number(runId));
    for (const rec of st ? st.running.values() : []) {
      const l = rec.runKey ? deps.liveRun(rec.runKey) : null;
      usd += Number((l && l.orch && l.orch.state && l.orch.state.totalCostUsd) || 0);
    }
    return usd;
  }

  function requestStop(st, reason, detail = null) {
    if (st.stopping) return;
    st.stopping = reason;
    st.detail = detail;
    for (const rec of st.running.values()) if (rec.runKey) quiet(deps.stopRun(rec.runKey));
  }

  /** Today's fingerprint of `use`, or null when it is gone (a deleted version). */
  const fingerprintNow = async (workflowId, use) => { try { return await deps.fingerprintOf(workflowId, use); } catch { return null; } };

  async function start({ workflowId, kind = 'compare', a = null, b, exampleIds = [], tries, reuseA = true, reuseB = false,
    quickCheck = false, capUsd = null, connectors = 'pretend', by = null }) {
    if (starting.has(workflowId) || store.runningTestRun(workflowId)) throw err(BUSY_TEXT, 'BUSY');
    starting.add(workflowId);
    try {
      if (kind === 'compare' && a == null) throw err('pick the version to compare with', 'BAD_REQUEST');
      if (a != null && store.useRef(a) === store.useRef(b)) throw err('pick two different versions to compare', 'BAD_REQUEST');
      if (!(Number.isInteger(tries) && tries >= 1 && tries <= store.MAX_TRIES)) throw err(`tries must be 1 to ${store.MAX_TRIES}`, 'BAD_REQUEST');
      if (capUsd !== null && !validCap(capUsd)) throw capError();
      if (!store.CONNECTOR_MODES.includes(connectors)) throw err('connectors must be "pretend" or "real"', 'BAD_REQUEST');
      const ids = [...new Set((exampleIds || []).map(Number))];
      if (!ids.length) throw err('pick at least one example', 'BAD_REQUEST');
      const examples = ids.map((id) => store.readExample(workflowId, id));
      const gone = ids.find((_id, i) => !examples[i]);
      if (gone !== undefined) throw err(`no example ${gone}`, 'NOT_FOUND');
      const empty = examples.find((ex) => !ex.request.trim());
      if (empty) throw err(`Write the request of "${empty.name}" first.`, 'BAD_REQUEST');
      const sides = [...(a != null ? [['a', a, reuseA]] : []), ['b', b, reuseB]];
      // Review M9 (D20): each side is checked, not only the draft: a saved version may still need a project.
      if (deps.targetOf) {
        for (const [, use] of sides) {
          const t = await deps.targetOf(workflowId, use);
          if (t && !t.testable) throw err(`${use === 'draft' ? 'Your draft' : `v${use}`} works on a project, and tests work for workflows without a project for now.`, 'NOT_TESTABLE');
        }
      }
      const fps = {};
      for (const [side, use] of sides) fps[side] = await deps.fingerprintOf(workflowId, use);   // NOT_FOUND: a version that is gone
      const mock = !!(deps.mockMode && deps.mockMode());
      const run = store.createTestRun({ workflowId, kind, a, b, aFp: fps.a ?? null, bFp: fps.b, exampleIds: ids, tries,
        quick: quickCheck ? { status: 'waiting' } : null, capUsd, connectors, by });
      for (const ex of examples) {
        for (const [side, use, reuse] of sides) {
          const kept = reuse
            ? store.reusableTries({ workflowId, exampleId: ex.id, use, fp: fps[side], exampleFp: ex.fingerprint, mock, connectors, limit: tries }) : [];
          for (const t of kept) store.linkTry(run.id, t.id, side);
          for (let n = kept.length + 1; n <= tries; n += 1) {
            const t = store.insertTry({ runId: run.id, workflowId, exampleId: ex.id, use, fp: fps[side], exampleFp: ex.fingerprint, tryNo: n, mock, connectors });
            store.linkTry(run.id, t.id, side);
          }
        }
      }
      drive(run.id);
      return store.readTestRun(run.id);
    } finally { starting.delete(workflowId); }
  }

  function drive(runId) {
    const st = { stopping: null, detail: null, running: new Map(), done: null };
    live.set(runId, st);
    st.done = loop(runId, st)
      .catch((e) => { st.stopping = st.stopping || 'error'; st.detail = st.detail || (e && e.message ? e.message : String(e)); })
      .finally(() => {
        store.updateTestRun(runId, st.stopping
          ? { status: 'stopped', stopReason: st.stopping, stopDetail: st.detail, finishedAt: nowIso() }
          : { status: 'done', stopReason: null, stopDetail: null, finishedAt: nowIso() });
        live.delete(runId);
        const run = store.readTestRun(runId);
        notify(run, { finished: true, status: run.status });
      });
    return st.done;
  }

  /** Example by example (the run's order), then try by try, the old version first (D27). */
  function queueOf(run) {
    const order = new Map(run.exampleIds.map((id, i) => [id, i]));
    return store.triesOfRun(run.id).filter((t) => t.runId === run.id && t.status === 'waiting')
      .sort((x, y) => (order.get(x.exampleId) ?? 0) - (order.get(y.exampleId) ?? 0) || x.tryNo - y.tryNo
        || (x.side < y.side ? -1 : x.side > y.side ? 1 : 0));
  }

  async function loop(runId, st) {
    const run = store.readTestRun(runId);
    if (run.quick && run.quick.status === 'waiting') {
      store.updateTestRun(runId, { quick: { status: 'running' } });
      notify(run);
      const quick = await quickCheck(run, st);
      store.updateTestRun(runId, { quick });
      notify(run);
      if (quick.status === 'failed') { requestStop(st, 'quick-check', quick.detail); return; }
      if (st.stopping) return;
    }
    const inflight = new Set();
    for (;;) {
      if (st.stopping) break;
      const waiting = queueOf(run);
      if (!waiting.length && !inflight.size) break;
      while (!st.stopping && inflight.size < MAX_PARALLEL && waiting.length) {
        if (run.capUsd !== null && costOf(runId) >= run.capUsd) { requestStop(st, 'cap'); break; }
        const p = runTry(run, st, waiting.shift()).finally(() => inflight.delete(p));
        inflight.add(p);
      }
      if (!inflight.size) continue;
      await Promise.race([...inflight, sleep(pollMs)]);
      if (!st.stopping && run.capUsd !== null && costOf(runId) > run.capUsd) requestStop(st, 'cap');
    }
    await Promise.allSettled([...inflight]);
  }

  async function runTry(run, st, t) {
    const rec = { runKey: null, help: [], failReason: null, detach: null };
    st.running.set(t.id, rec);
    store.updateTry(t.id, { status: 'running', startedAt: nowIso() });   // before the first await: the loop sees it at once
    const t0 = Date.now();
    try {
      const example = store.readExample(run.workflowId, t.exampleId);
      if (!example) { store.updateTry(t.id, { status: 'stopped', finishedAt: nowIso() }); return; }
      // D27 (review I3): a try runs today's draft, Library and example. If any of them changed since the test started,
      // it would run one state and be stored as another (and be reused for the old one): the test stops first.
      const changed = example.fingerprint !== t.exampleFp ? editedText(example.name)
        : (await fingerprintNow(run.workflowId, t.use)) !== t.fp ? changedText(t.use) : null;
      if (changed) {
        store.updateTry(t.id, { status: 'waiting', startedAt: null });   // never tried: it stays as it was
        requestStop(st, 'changed', changed);
        return;
      }
      if (st.stopping) { store.updateTry(t.id, { status: 'waiting', startedAt: null }); return; }
      notify(run);
      const fail = (reason) => {
        if (rec.failReason) return;
        rec.failReason = reason;
        if (rec.runKey) quiet(deps.stopRun(rec.runKey));
      };
      const body = tryRunBody(example, store.readExampleFiles(example.id), { workflowId: run.workflowId, tryNo: t.tryNo, mock: t.mock });
      const out = await deps.startRun(body, {
        startedBy: run.startedBy,
        workflowTest: {
          use: t.use,
          connectors: t.connectors,   // D35
          onOrch: (orch, { runKey }) => {
            rec.runKey = runKey;
            rec.detach = attachAnswerer(orch, example, { answer: (id, payload) => deps.answer(runKey, id, payload), onHelp: (x) => rec.help.push(x), onFail: fail });
          },
        },
      });
      if (!out || out.status !== 200 || !out.body || !out.body.runId) {
        if (rec.detach) rec.detach();
        store.updateTry(t.id, { status: 'waiting', startedAt: null });   // never tried: it stays for "Finish the rest"
        const code = out ? out.status : 0;
        requestStop(st, code === 403 ? 'budget' : code === 503 ? 'drain' : 'refused', (out && out.body && out.body.error) || 'the try did not start');
        return;
      }
      rec.runKey = out.body.runId;
      store.updateTry(t.id, { runKey: rec.runKey, pipelineId: out.body.pipelineId || null });
      if (st.stopping) quiet(deps.stopRun(rec.runKey));
      let l = deps.liveRun(rec.runKey);
      if (l && l.launch) await Promise.resolve(l.launch).catch(() => {});
      l = deps.liveRun(rec.runKey);
      if (l && String(l.status) === 'paused') {   // a cost or usage-limit pause: a try never waits for a person
        if (!rec.failReason) rec.failReason = 'The try paused (a cost limit or a usage limit) and was stopped.';
        await Promise.resolve(deps.stopRun(rec.runKey)).catch(() => {});
      }
      if (rec.detach) rec.detach();
      const outcome = await deps.outcomeOf(out.body.pipelineId || (l && l.pipelineId) || null,
        { help: rec.help, failReason: rec.failReason, durationMs: Date.now() - t0 });
      if (st.stopping && !rec.failReason && outcome.facts.status !== 'done') {
        store.updateTry(t.id, { status: 'stopped', costUsd: outcome.facts.costUsd, finishedAt: nowIso() });
        return;
      }
      const verdict = await deps.judge(example, outcome);
      store.updateTry(t.id, { status: verdict.passed ? 'passed' : 'failed', verdict, costUsd: outcome.facts.costUsd, finishedAt: nowIso() });
    } finally {
      st.running.delete(t.id);
      notify(run);
    }
  }

  /** The free quick check: one mock try of the first example per version still to try ("every step is connected"). */
  async function quickCheck(run, st) {
    const example = store.readExample(run.workflowId, run.exampleIds[0]);
    if (!example) return { status: 'failed', detail: 'the first example was deleted' };
    const uses = [...new Map(store.triesOfRun(run.id).filter((t) => t.runId === run.id && t.status === 'waiting')
      .map((t) => [store.useRef(t.use), t.use])).values()];
    for (const use of uses) {
      if (st.stopping) return { status: 'waiting' };
      const rec = { runKey: null, failReason: null };
      const key = `quick:${store.useRef(use)}`;
      st.running.set(key, rec);
      try {
        const out = await deps.startRun(tryRunBody(example, store.readExampleFiles(example.id), { workflowId: run.workflowId, tryNo: 0, quick: true }), {
          startedBy: run.startedBy,
          workflowTest: {
            use,
            connectors: 'pretend',   // a mock run sends nothing either way
            onOrch: (orch, { runKey }) => {
              rec.runKey = runKey;
              attachAnswerer(orch, { ...example, otherwise: 'pick' }, {
                answer: (id, payload) => deps.answer(runKey, id, payload),
                onFail: (r) => { if (!rec.failReason) { rec.failReason = r; quiet(deps.stopRun(runKey)); } },
              });
            },
          },
        });
        if (!out || out.status !== 200 || !out.body) return { status: 'failed', detail: (out && out.body && out.body.error) || 'the quick check did not start' };
        const l = deps.liveRun(out.body.runId);
        if (l && l.launch) await Promise.resolve(l.launch).catch(() => {});
        const o = await deps.outcomeOf(out.body.pipelineId, { failReason: rec.failReason });
        if (st.stopping) return { status: 'waiting' };
        if (o.facts.status !== 'done' || o.facts.failReason) return { status: 'failed', detail: o.facts.failReason || `the quick check ended as ${o.facts.status}` };
      } finally { st.running.delete(key); }
    }
    return { status: 'passed' };
  }

  /** Resolves once the loop has stopped every running try and the run row says why (D27). */
  async function stop(runId, { reason = 'person' } = {}) {
    const run = store.readTestRun(runId);
    if (!run) throw err(`no test ${runId}`, 'NOT_FOUND');
    const st = live.get(run.id);
    if (!st) return run;
    requestStop(st, reason);
    await st.done;
    return store.readTestRun(run.id);
  }

  /** "Finish the rest": the stopped and waiting tries, only while nothing they depend on changed (D26/D27). */
  async function continueRun(runId, { capUsd } = {}) {
    const run = store.readTestRun(runId);
    if (!run) throw err(`no test ${runId}`, 'NOT_FOUND');
    if (run.status !== 'stopped' || live.has(run.id)) throw err('only a stopped test can be finished', 'BAD_REQUEST');
    if (store.runningTestRun(run.workflowId) || starting.has(run.workflowId)) throw err(BUSY_TEXT, 'BUSY');
    for (const [use, fp] of [[run.a, run.aFp], [run.b, run.bFp]]) {
      if (use == null) continue;
      if ((await fingerprintNow(run.workflowId, use)) !== fp) throw err(changedText(use), 'BAD_REQUEST');
    }
    const left = store.triesOfRun(run.id).filter((t) => t.runId === run.id && (t.status === 'stopped' || t.status === 'waiting'));
    for (const t of left) {
      const ex = store.readExample(run.workflowId, t.exampleId);
      if (ex && ex.fingerprint !== t.exampleFp) throw err(editedText(ex.name), 'BAD_REQUEST');
    }
    if (capUsd !== undefined && capUsd !== null && !validCap(capUsd)) throw capError();
    const cap = capUsd !== undefined && capUsd !== null ? capUsd : run.capUsd;
    const spent = store.spentOfRun(run.id);
    if (cap !== null && cap <= spent) throw err(`Raise the cost limit above ${fmtUsd(spent)} to finish the rest.`, 'BAD_REQUEST');
    for (const t of left.filter((x) => x.status === 'stopped')) {
      store.unlinkTry(run.id, t.id);   // it stays in the run's cost (run_id), not in its results
      const fresh = store.insertTry({ runId: run.id, workflowId: t.workflowId, exampleId: t.exampleId, use: t.use, fp: t.fp,
        exampleFp: t.exampleFp, tryNo: t.tryNo, mock: t.mock, connectors: t.connectors });
      store.linkTry(run.id, fresh.id, t.side);
    }
    store.updateTestRun(run.id, { status: 'running', stopReason: null, stopDetail: null, finishedAt: null, capUsd: cap,
      ...(run.quick && run.quick.status !== 'passed' ? { quick: { status: 'waiting' } } : {}) });
    drive(run.id);
    return store.readTestRun(run.id);
  }

  /** After a restart nothing drives a running test any more: it is stopped ('restart'). @returns {number} */
  function recover() { return store.recoverInterruptedTestRuns().runs; }

  function idle(runId) { const st = live.get(Number(runId)); return st ? st.done : Promise.resolve(); }

  return { start, stop, continueRun, recover, idle, costOf };
}
```

- [ ] **Step 5: Run the tests**

Run: `node tools/test.mjs test/workflow-test-runner.test.mjs test/workflow-test-store.test.mjs test/workflow-test-answers.test.mjs`
Expected: PASS (11 tests in the runner file).

- [ ] **Step 6: Commit**

```bash
git add src/core/workflow-tests/uses.mjs src/core/workflow-tests/runner.mjs test/workflow-test-runner.test.mjs
git commit -m "Workflow tests: the runner (3 at a time, one test per workflow, cost cap, stop and finish, a change stops it, quick check, reuse) (D26, D27, D35-D37)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 8: Better or worse: the compare model, labels, In short, the estimate (pure, shared)

**Files:**
- Create: `src/shared/workflow-tests/compare.mjs`
- Test: `test/workflow-test-compare.test.mjs`

**Interfaces:**
- Consumes: `fmtUsd` (Task 1)
- Produces:
  - `useLabel(use, ctx, form = 'short'|'column'|'select') → string`. `ctx = { liveVersionNo, latestVersionNo }`. Examples:
    - short: "v5 draft", "v4", "Your draft"
    - column: "v5 draft · yours", "v4 · the team uses it"
    - select: "v5 draft · your changes"
  - `testTitle(run, ctx, { mode = 'compare'|'testing', exampleName }) → string`, `latestTitle(run, ctx) → string`
  - `countsText(examples, tries)`, `agoText(iso, now)`
  - `compareModel({ examples:[{id,name}], a: {label}|null, b: {label}, tries }) → model`, where:
    - `model = { examples: rows, tiles: { a, b }, counts: { better, worse, same }, inShort: string[], look: null|{ exampleId, name, before, after } }`
    - `row = { id, name, a:{passed,total}, b:{passed,total}, result: 'better'|'worse'|'same'|null, luck, why, steadyA, steadyB, drop }`
    - `tile side = { passed:{passed,total}, costPerTry, timePerTry, sentBack, steady:{ n, of } }`
  - `estimateOf(plan, { reuseA, reuseB }) → { toRun:{a,b}, total, usd, low, high, minutes, capUsd }`
  - Formats: `fmtDuration(ms)`, `pctDelta(a, b)`, `durationDelta(aMs, bMs)`, `countDelta(a, b)`, `fmtTimes(n)`, `fmtUsdRange(low, high)`, `aboutUsd(n)`
  - `LUCK_MAX_DIFF = 1`, `TRIES_AT_ONCE = 3` (equal to the runner's `MAX_PARALLEL`, D36)
  - `inShort` is `[]` when no example has finished tries on both versions (D38)

- [ ] **Step 1: Write the failing test.** Create `test/workflow-test-compare.test.mjs`:

```js
// test/workflow-test-compare.test.mjs — D28 and C2: better or worse, luck, steady, the tiles and "In short", on the
// numbers of canvas board 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  useLabel, testTitle, latestTitle, countsText, agoText, compareModel, estimateOf, fmtDuration, pctDelta, durationDelta,
  countDelta, fmtTimes, fmtUsdRange, aboutUsd, TRIES_AT_ONCE,
} from '../src/shared/workflow-tests/compare.mjs';
import { MAX_PARALLEL } from '../src/core/workflow-tests/runner.mjs';

const ctx = { liveVersionNo: 4, latestVersionNo: 4 };
const SECTIONS = 'Has the sections Problem, Users, Success metric and Risks';
const HELP = 'Finishes without needing help from someone';
let nextId = 0;
const tries = (side, exampleId, marks, { cost, ms, missed = SECTIONS }) => [...marks].map((m) => ({
  id: (nextId += 1), side, exampleId, status: m === 'P' ? 'passed' : 'failed', costUsd: cost,
  verdict: { passed: m === 'P', basics: [], checks: m === 'P' ? [{ label: missed, met: true }] : [{ label: missed, met: false }],
    facts: { durationMs: ms, sentBack: side === 'a' ? 2 : 1 } },
}));
const board = () => {
  const ex = [[1, 'Bulk invoice export', 'PPP', 'PFF'], [2, 'Unclear request: "dark mode please"', 'PFF', 'PPP'], [3, 'A feature we already have', 'FFF', 'PPF'],
    [4, 'Offline mode for the field app', 'PPP', 'PPP'], [5, 'Pricing page A/B test', 'PPF', 'PPF'], [6, 'Customer data export (GDPR)', 'PPP', 'PPP']];
  const list = [];
  for (const [id, , a, b] of ex) {
    list.push(...tries('a', id, a, { cost: 0.84, ms: 370000, missed: id === 2 ? HELP : SECTIONS }));
    list.push(...tries('b', id, b, { cost: 0.52, ms: 280000 }));
  }
  return { examples: ex.map(([id, name]) => ({ id, name })), a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: list };
};

test('labels and titles in the board\'s words', () => {
  assert.deepEqual([useLabel('draft', ctx), useLabel('draft', ctx, 'column'), useLabel('draft', ctx, 'select')], ['v5 draft', 'v5 draft · yours', 'v5 draft · your changes']);
  assert.deepEqual([useLabel(4, ctx, 'column'), useLabel(3, ctx, 'column'), useLabel(4, ctx)], ['v4 · the team uses it', 'v3', 'v4']);
  assert.deepEqual([useLabel('draft', {}), useLabel('draft', {}, 'column')], ['Your draft', 'Your draft']);
  const run = { kind: 'compare', a: 4, b: 'draft' };
  assert.equal(testTitle(run, ctx), 'Your v5 draft compared with v4');
  assert.equal(testTitle(run, ctx, { mode: 'testing' }), 'Testing your v5 draft');
  assert.equal(latestTitle(run, ctx), 'Latest test: your v5 draft compared with v4');
  assert.equal(testTitle({ kind: 'compare', a: 4, b: 5 }, { liveVersionNo: 4, latestVersionNo: 5 }), 'v5 compared with v4');
  assert.equal(testTitle({ kind: 'once', a: null, b: 'draft' }, ctx, { exampleName: 'Bulk invoice export' }), 'Tried once: Bulk invoice export');
  assert.equal(testTitle({ kind: 'once', a: null, b: 'draft' }, ctx, { mode: 'testing', exampleName: 'Bulk invoice export' }), 'Trying once: Bulk invoice export');
  assert.deepEqual([countsText(6, 3), countsText(1, 1)], ['6 examples, 3 tries each', '1 example, 1 try each']);
  const now = Date.parse('2026-10-26T12:00:00Z');
  assert.deepEqual(['2026-10-26T11:59:40Z', '2026-10-26T11:55:00Z', '2026-10-26T10:00:00Z', '2026-10-25T09:00:00Z'].map((t) => agoText(t, now)),
    ['just now', '5 minutes ago', '2 hours ago', 'yesterday']);
});

test('board 5: tries passed, better, worse, same, why, steady and In short', () => {
  const m = compareModel(board());
  assert.deepEqual(m.counts, { better: 2, worse: 1, same: 3 });
  assert.deepEqual([m.tiles.a.passed, m.tiles.b.passed], [{ passed: 12, total: 18 }, { passed: 14, total: 18 }]);
  assert.deepEqual(m.examples.map((r) => [r.id, r.result, r.luck]), [[1, 'worse', false], [2, 'better', false], [3, 'better', false], [4, 'same', false], [5, 'same', false], [6, 'same', false]]);
  assert.equal(m.examples[0].why, `v5 draft missed "${SECTIONS}" in 2 of 3 tries`);
  assert.equal(m.examples[1].why, `v4 missed "${HELP}" in 2 of 3 tries`);
  assert.deepEqual([m.tiles.a.steady, m.tiles.b.steady], [{ n: 4, of: 6 }, { n: 3, of: 6 }]);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  assert.deepEqual([m.tiles.a.costPerTry, m.tiles.b.costPerTry, m.tiles.a.timePerTry, m.tiles.b.timePerTry, m.tiles.a.sentBack, m.tiles.b.sentBack].map(r3),
    [0.84, 0.52, 370000, 280000, 2, 1]);
  assert.deepEqual(m.inShort, [
    'v5 draft is cheaper and faster, and better on 2 examples.',
    `It is worse on 1 example, Bulk invoice export: it missed "${SECTIONS}" in 2 of 3 tries.`,
    'Its results also vary more from try to try.',
  ]);
  assert.deepEqual(m.look, { exampleId: 1, name: 'Bulk invoice export', before: 'Look at ', after: ' before you share v5 draft.' });
});

test('a difference of one try is "might be luck" and names no reason; nothing changed reads as the same', () => {
  const luck = compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' },
    tries: [...tries('a', 1, 'PPF', { cost: 0.5, ms: 1000 }), ...tries('b', 1, 'PPP', { cost: 0.5, ms: 1000 })] });
  assert.deepEqual([luck.examples[0].result, luck.examples[0].luck, luck.examples[0].why], ['better', true, null]);
  const same = compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' },
    tries: [...tries('a', 1, 'PPP', { cost: 0.5, ms: 1000 }), ...tries('b', 1, 'PPP', { cost: 0.5, ms: 1000 })] });
  assert.deepEqual([same.inShort, same.look], [['v5 draft gives the same results as v4 on every example.'], null]);
  const one = compareModel({ examples: [{ id: 1, name: 'X' }], a: null, b: { label: 'Your draft' }, tries: tries('b', 1, 'P', { cost: 0.5, ms: 1000 }) });
  assert.deepEqual([one.tiles.a, one.tiles.b.passed, one.examples[0].result, one.inShort], [null, { passed: 1, total: 1 }, null, []]);
  const unfinished = compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' },
    tries: [{ id: 99, side: 'b', exampleId: 1, status: 'stopped', costUsd: 0.4, verdict: null }] });
  assert.deepEqual([unfinished.tiles.b.passed, unfinished.examples[0].result, unfinished.inShort, unfinished.look], [{ passed: 0, total: 0 }, null, [], null]);
});

test('In short: the three approved extra sentences, and nothing at all when no example was tried on both (C2, D38)', () => {
  const one = (aMarks, bMarks, bCost) => compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' },
    tries: [...tries('a', 1, aMarks, { cost: 1, ms: 1000 }), ...tries('b', 1, bMarks, { cost: bCost, ms: 1000 })] });
  assert.deepEqual(one('PPP', 'PPP', 0.5).inShort, ['v5 draft is cheaper, and gives the same results as v4.']);
  assert.deepEqual(one('PPP', 'FFF', 0.5).inShort, ['v5 draft is cheaper.', `It is worse on 1 example, X: it missed "${SECTIONS}" in 3 of 3 tries.`]);
  assert.deepEqual(one('PPP', 'PPF', 1).inShort, ['It is worse on 1 example, X.', 'Its results also vary more from try to try.'], 'a one-try difference names no reason');
  const onlyA = compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: tries('a', 1, 'PPP', { cost: 1, ms: 1000 }) });
  assert.deepEqual([onlyA.counts, onlyA.inShort, onlyA.look], [{ better: 0, worse: 0, same: 0 }, [], null]);
});

test('formats of the tiles and the estimate', () => {
  assert.deepEqual([fmtDuration(280000), fmtDuration(45000), fmtDuration(3900000), fmtDuration(120000)], ['4 min 40 s', '45 s', '1 h 5 min', '2 min']);
  assert.deepEqual([pctDelta(0.84, 0.52), pctDelta(0.5, 0.6), pctDelta(0.5, 0.5)], ['38% less', '20% more', 'the same']);
  assert.deepEqual([durationDelta(370000, 280000), durationDelta(60000, 90000), durationDelta(60000, 62000)], ['1½ min less', '30 s more', 'the same']);
  assert.deepEqual([countDelta(12, 14), countDelta(14, 12), countDelta(3, 3)], ['2 more', '2 fewer', 'the same']);
  assert.deepEqual([fmtTimes(1.2), fmtTimes(1.6000001)], ['1.2×', '1.6×']);
  assert.deepEqual([fmtUsdRange(8.93, 10.81), fmtUsdRange(0.4, 0.7)], ['$9 to $11', '$0.40 to $0.70']);
  assert.deepEqual([aboutUsd(15.12), aboutUsd(10), aboutUsd(3.8)], ['$15', '$10', '$3.80']);
  const plan = { a: { want: 18, reusable: 18, perTryUsd: 0.84 }, b: { want: 18, reusable: 0, perTryUsd: 0.52 }, perTryMs: 280000 };
  const e = estimateOf(plan, { reuseA: true });
  assert.deepEqual([e.toRun, e.total, Math.round(e.usd * 100) / 100, fmtUsdRange(e.low, e.high), e.minutes, e.capUsd], [{ a: 0, b: 18 }, 18, 9.36, '$9 to $11', 28, 15], '18 tries, 3 at a time, 4 min 40 s each');
  const unknown = estimateOf({ a: { want: 3, reusable: 0, perTryUsd: null }, b: { want: 3, reusable: 0, perTryUsd: 0.5 }, perTryMs: null }, { reuseA: false });
  assert.deepEqual([unknown.total, unknown.usd, unknown.minutes, unknown.capUsd], [6, null, null, 10]);
  assert.equal(TRIES_AT_ONCE, MAX_PARALLEL, 'the estimate uses the runner\'s parallelism');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/workflow-test-compare.test.mjs`
Expected: FAIL with `Cannot find module '../src/shared/workflow-tests/compare.mjs'`.

- [ ] **Step 3: Implement `src/shared/workflow-tests/compare.mjs`**

```js
// src/shared/workflow-tests/compare.mjs
// Comparing two versions on the same examples (plans/workflow-tests-part2-plan.md D28; canvas boards 1, 4, 5, 6, 20).
// Pure and browser-safe: the server computes the model, the pages format it. Better or worse is decided by tries
// passed (Basics and automatic checks only, D18). "In short" is put together from the fixed sentences of C2, never by AI.
import { fmtUsd } from './checks.mjs';

export { fmtUsd };
export const LUCK_MAX_DIFF = 1;
/** The runner's limit (src/core/workflow-tests/runner.mjs MAX_PARALLEL, D36), for the time estimate. A test pins them equal. */
export const TRIES_AT_ONCE = 3;
const FINISHED = new Set(['passed', 'failed']);
const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const low1 = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** How a version is named on the Tests pages. ctx = { liveVersionNo, latestVersionNo }. */
export function useLabel(use, ctx = {}, form = 'short') {
  if (use === 'draft') {
    const short = Number.isInteger(ctx.latestVersionNo) ? `v${ctx.latestVersionNo + 1} draft` : 'Your draft';
    if (form === 'short' || short === 'Your draft') return short;
    return form === 'select' ? `${short} · your changes` : `${short} · yours`;
  }
  const short = `v${use}`;
  if (form === 'short') return short;
  return use === ctx.liveVersionNo ? `${short} · the team uses it` : short;
}

/** The tested version inside a sentence: "your v5 draft", "your draft", "v4". */
const bWords = (use, ctx) => {
  const s = useLabel(use, ctx);
  return use === 'draft' ? (s === 'Your draft' ? 'your draft' : `your ${s}`) : s;
};

/** "Your v5 draft compared with v4", "Testing your v5 draft", "Tried once: <example>" / "Trying once: <example>". */
export function testTitle(run, ctx = {}, { mode = 'compare', exampleName = '' } = {}) {
  if (run.kind === 'once') return `${mode === 'testing' ? 'Trying' : 'Tried'} once: ${exampleName || 'an example'}`;
  const b = bWords(run.b, ctx);
  if (mode === 'testing') return `Testing ${b}`;
  const head = run.b === 'draft' ? cap1(b) : b;   // "Your v5 draft …", but "v5 compared with v4"
  return run.a == null ? head : `${head} compared with ${useLabel(run.a, ctx)}`;
}

export const latestTitle = (run, ctx = {}) => `Latest test: ${low1(testTitle(run, ctx))}`;

export const countsText = (examples, tries) =>
  `${examples} example${examples === 1 ? '' : 's'}, ${tries} ${tries === 1 ? 'try' : 'tries'} each`;

export function agoText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** The Basic or check the given tries missed most often (ties: by label). */
function missedMost(list) {
  const counts = new Map();
  for (const t of list) {
    const v = t.verdict || {};
    for (const item of [...(v.basics || []), ...(v.checks || [])]) if (item && !item.met) counts.set(item.label, (counts.get(item.label) || 0) + 1);
  }
  let best = null;
  for (const [label, k] of counts) if (!best || k > best.k || (k === best.k && label < best.label)) best = { label, k };
  return best;
}

const avg = (list, f) => {
  const xs = list.map(f).filter((x) => typeof x === 'number' && Number.isFinite(x));
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
};

/**
 * @param {{examples: Array<{id:number, name:string}>, a: {label:string}|null, b: {label:string},
 *   tries: Array<{side:'a'|'b', exampleId:number, status:string, costUsd:number, verdict:object|null}>}} input
 */
export function compareModel({ examples = [], a = null, b, tries = [] }) {
  const done = tries.filter((t) => FINISHED.has(t.status));
  const of = (side, exampleId = null) => done.filter((t) => t.side === side && (exampleId === null || t.exampleId === exampleId));
  const tally = (list) => ({ passed: list.filter((t) => t.status === 'passed').length, total: list.length });
  const steady = (list) => list.length > 0 && list.every((t) => t.status === list[0].status);
  const rate = (r) => r.passed / r.total;
  const rows = examples.map((ex) => {
    const aT = a ? of('a', ex.id) : [];
    const bT = of('b', ex.id);
    const ra = tally(aT);
    const rb = tally(bT);
    const both = !!a && ra.total > 0 && rb.total > 0;
    let result = null;
    let luck = false;
    let why = null;
    let missed = null;
    if (both) {
      const d = rate(rb) - rate(ra);
      result = Math.abs(d) < 1e-9 ? 'same' : d > 0 ? 'better' : 'worse';
      if (result !== 'same') {
        luck = Math.abs(d) * Math.max(ra.total, rb.total) <= LUCK_MAX_DIFF + 1e-9;
        const loser = result === 'worse' ? { label: b.label, list: bT } : { label: a.label, list: aT };
        const m = missedMost(loser.list);
        if (m) missed = { label: m.label, k: m.k, n: loser.list.length };
        if (!luck && missed) why = `${loser.label} missed "${missed.label}" in ${missed.k} of ${missed.n} tries`;
      }
    }
    return { id: ex.id, name: ex.name, a: ra, b: rb, result, luck, why, missed, steadyA: steady(aT), steadyB: steady(bT),
      drop: both ? rate(ra) - rate(rb) : 0 };
  });
  const side = (s) => {
    const list = of(s);
    return {
      passed: tally(list),
      costPerTry: avg(list, (t) => Number(t.costUsd)),
      timePerTry: avg(list, (t) => (t.verdict && t.verdict.facts ? t.verdict.facts.durationMs : null)),
      sentBack: avg(list, (t) => (t.verdict && t.verdict.facts ? Number(t.verdict.facts.sentBack || 0) : null)),
      steady: { n: rows.filter((r) => (s === 'a' ? r.steadyA : r.steadyB)).length, of: rows.filter((r) => (s === 'a' ? r.a.total : r.b.total) > 0).length },
    };
  };
  const tiles = { a: a ? side('a') : null, b: side('b') };
  const counts = { better: rows.filter((r) => r.result === 'better').length, worse: rows.filter((r) => r.result === 'worse').length,
    same: rows.filter((r) => r.result === 'same').length };
  const worst = rows.filter((r) => r.result === 'worse').sort((x, y) => y.drop - x.drop || (x.name < y.name ? -1 : 1))[0] || null;
  return {
    examples: rows, tiles, counts,
    // D38: with no example tried on both sides there is nothing to say ("gives the same results" would be untrue).
    inShort: a && counts.better + counts.worse + counts.same > 0 ? inShortSentences({ a, b, tiles, counts, worst }) : [],
    look: a && worst ? { exampleId: worst.id, name: worst.name, before: 'Look at ', after: ` before you share ${b.label}.` } : null,
  };
}

/** C2 (approved 2026-10-26, its three extra sentences included): the fixed sentences, each only when it applies. Cheaper or faster = at least 10% less. */
function inShortSentences({ a, b, tiles, counts, worst }) {
  const out = [];
  const adj = [];
  const ca = tiles.a.costPerTry; const cb = tiles.b.costPerTry;
  if (ca > 0 && cb !== null) { if (cb <= ca * 0.9) adj.push('cheaper'); else if (cb >= ca * 1.1) adj.push('more expensive'); }
  const ta = tiles.a.timePerTry; const tb = tiles.b.timePerTry;
  if (ta > 0 && tb !== null) { if (tb <= ta * 0.9) adj.push('faster'); else if (tb >= ta * 1.1) adj.push('slower'); }
  const exs = (n) => (n === 1 ? '1 example' : `${n} examples`);
  const is = adj.length ? `is ${adj.join(' and ')}` : '';
  if (counts.better) out.push(is ? `${b.label} ${is}, and better on ${exs(counts.better)}.` : `${b.label} is better on ${exs(counts.better)}.`);
  else if (!counts.worse) out.push(is ? `${b.label} ${is}, and gives the same results as ${a.label}.` : `${b.label} gives the same results as ${a.label} on every example.`);
  else if (is) out.push(`${b.label} ${is}.`);
  if (counts.worse === 1 && worst) {
    out.push(worst.missed && !worst.luck
      ? `It is worse on 1 example, ${worst.name}: it missed "${worst.missed.label}" in ${worst.missed.k} of ${worst.missed.n} tries.`
      : `It is worse on 1 example, ${worst.name}.`);
  } else if (counts.worse > 1) out.push(`It is worse on ${counts.worse} examples.`);
  if (tiles.b.steady.n < tiles.a.steady.n) out.push('Its results also vary more from try to try.');
  else if (tiles.b.steady.n > tiles.a.steady.n) out.push('Its results are also steadier from try to try.');
  return out;
}

/**
 * The Test a version dialog's live estimate (board 4). plan = GET …/tests/plan; the reuse boxes decide what is tried.
 * Range ±5%/+15% (board: about $9.40 → "$9 to $11"); default cap = 1.5 × the estimate rounded up to $5, at least $5.
 */
export function estimateOf(plan, { reuseA = true, reuseB = false } = {}) {
  const left = (s, reuse) => (s ? Math.max(0, s.want - (reuse ? s.reusable : 0)) : 0);
  const toRun = { a: left(plan.a, reuseA), b: left(plan.b, reuseB) };
  const total = toRun.a + toRun.b;
  const cost = (s, n) => (n === 0 ? 0 : s && typeof s.perTryUsd === 'number' && Number.isFinite(s.perTryUsd) ? n * s.perTryUsd : null);
  const ca = cost(plan.a, toRun.a);
  const cb = cost(plan.b, toRun.b);
  const usd = ca === null || cb === null ? null : ca + cb;
  const minutes = typeof plan.perTryMs === 'number' && Number.isFinite(plan.perTryMs) && total
    ? Math.max(1, Math.ceil((Math.ceil(total / TRIES_AT_ONCE) * plan.perTryMs) / 60000)) : null;
  const capUsd = usd ? Math.max(5, Math.ceil((usd * 1.5) / 5) * 5) : 10;
  return { toRun, total, usd, low: usd === null ? null : usd * 0.95, high: usd === null ? null : usd * 1.15, minutes, capUsd };
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60); const r = s % 60;
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
  const h = Math.floor(m / 60); const mm = m % 60;
  return mm ? `${h} h ${mm} min` : `${h} h`;
}

/** B against A: "38% less", "20% more", "the same". */
export function pctDelta(a, b) {
  if (!(a > 0) || !Number.isFinite(b)) return '';
  const p = Math.round(((b - a) / a) * 100);
  return p === 0 ? 'the same' : p < 0 ? `${-p}% less` : `${p}% more`;
}

/** B against A, in half minutes from a minute up: "1½ min less", "30 s more", "the same" (under 5 s). */
export function durationDelta(aMs, bMs) {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return '';
  const d = bMs - aMs;
  const abs = Math.abs(d);
  if (abs < 5000) return 'the same';
  const word = d < 0 ? 'less' : 'more';
  if (abs < 60000) return `${Math.round(abs / 1000)} s ${word}`;
  const halves = Math.round(abs / 30000);
  return `${Math.floor(halves / 2)}${halves % 2 ? '½' : ''} min ${word}`;
}

export function countDelta(a, b) {
  const d = b - a;
  return d === 0 ? 'the same' : d > 0 ? `${d} more` : `${-d} fewer`;
}

export const fmtTimes = (n) => (Number.isFinite(n) ? `${(Math.round(n * 10) / 10).toFixed(1)}×` : '');

/** "about $15", "of about $10", "stops at $15": whole dollars from $5 up, cents below (boards 4 and 20). */
export const aboutUsd = (n) => (n >= 5 ? `$${Math.round(n)}` : fmtUsd(n));

/** Whole dollars from $5 up ("$9 to $11"), cents below. */
export function fmtUsdRange(low, high) {
  if (high >= 5) return `$${Math.round(low)} to $${Math.round(high)}`;
  return `${fmtUsd(low)} to ${fmtUsd(high)}`;
}
```

- [ ] **Step 4: Run the test**

Run: `node tools/test.mjs test/workflow-test-compare.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/workflow-tests/compare.mjs test/workflow-test-compare.test.mjs
git commit -m "Workflow tests: better or worse, luck, steady, the tiles and In short (D28, C2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: The read models and the routes

**Files:**
- Create: `src/core/workflow-tests/service.mjs`, `src/core/workflow-tests/routes.mjs`
- Modify `ui/server.mjs`:
  - the imports next to `registerWorkflowVersionRoutes` (:335)
  - the registration right after `registerWorkflowVersionRoutes(app, …)` (:13097), with the connectors preview
  - `bootMaintenance` (:18612): the restart recovery, right after the requirements sweep (:18638–18643), not at route registration (review M4: that ran on every import of server.mjs)
- Test: `test/api-workflow-tests.test.mjs`, `test/api-workflow-tests-flag-off.test.mjs`, `test/workflow-test-routes.test.mjs` (new: the frame and the flag, review M8)

**Interfaces:**
- Consumes: Tasks 2–8 (Task 5's `connectorNotes`, `userScopeServerNames`, `seenClaudeAiServers`, `wouldHaveSent`). Also `isVersionableRow`, `liveVersionNo`, `latestVersion` (workflow-revisions.mjs), `readStepQuestions`, `readClarifyRow`, `findPipelineRowById`, `runDirForRow` (artifacts.mjs), `loadScriptRegistry` (script-registry.mjs) and the server's `mcpRunPreview`.
- Produces, `service.mjs`:
  - `NOT_TESTABLE_TEXT`, `NOT_TESTABLE_REASONS`
  - `workflowRowOf(id)`, `testTarget(id, { registry })`, `labelCtx(id)`, `runOf(id, runId)`
  - `perTryCost(id, use)`, `perTryMs(id)`, `recentRuns(id)`
  - `testsOverview(id, { registry?, fingerprintOf? })`, which returns:
    - `{ workflowId, name, testable, reason, ctx, columns:[{use,label}], examples:[{ id, name, hasRequest, files, fromAt, note, tries, basics, checks, cells:{ [useRef]: null|{passed,total,stale,past} } }], running, latest, pastRuns }`
  - `pastRunSummary(pipelineId)`, which returns:
    - `{ pipelineId, workflowId, workflowName, title, request, files, qa:[{question,answer}], use, useLabel, testable, reason, reasonText }`
  - `exampleFromRun(id, input, { by })` → `{ example, skipped }`; `examplesFromRuns(id, pipelineIds, { by })` → `{ examples, skipped }`
  - `testPlan(id, { a, b, exampleIds, tries, connectors = 'pretend' }, { mock, connectorsPreview? })`, which returns:
    - `{ a, b: { use, label, short, want, reusable, reusableAt, perTryUsd, savesUsd }, examples, tries, perTryMs, connectors: { mode, pretend: string[], off: [{ name, reason }], scripts: string[] } }` (board 30; reuse counts follow the mode, D35)
  - `progressOf(id, runId, { costOf })`, which returns:
    - `{ run, title, rows:[{ exampleId, name, label, dots, summary }], done, total, costUsd, estimateUsd, capUsd, minutesLeft, quick }` (`run.connectors` is the mode; `minutesLeft` counts 3 at a time)
  - `compareOf(id, runId)` → `{ run, title, labels, examples, costUsd, model, changes, fair }`
  - `sideBySide(id, runId, exampleId)` → `{ run, compareTitle, example, labels, row, connectors, tries:[{ n, a, b }] }`, where `a` and `b` are `{ tryId, status, verdict, name, text, truncated, connectors, wouldHaveSent, answeredReads }|null`; `wouldHaveSent` = `[{ server, tool, toolId, noun, to, preview, full }]` for a pretend try, `null` for a real one; `answeredReads` = `[{ server, n }]` (board 31, D35)
  - `tryResult(id, runId, tryId)` → `{ name, text }`, `finishedText(id, runId)` → string
- Produces, `routes.mjs`: `registerWorkflowTestRoutes(app, { broadcast, deps }) → { runner }` and `WORKFLOW_TEST_ROUTES`. `deps = { startRun, liveRun, stopRun, answer, mockMode?, connectorsPreview?() → { copies: [{ name, untested }] } }`. It no longer recovers anything: the server's `bootMaintenance` calls `recoverInterruptedTestRuns()`. The routes, all behind `requireFlag('workflowTests')`:
  - `GET /api/workflows/:id/tests`
  - `POST …/tests/examples`, `POST …/examples/from-run`, `POST …/examples/from-runs`
  - `GET | PUT | DELETE …/examples/:ex`
  - `POST …/examples/:ex/files`, `DELETE …/examples/:ex/files/:name`
  - `POST …/examples/:ex/try-once`
  - `GET …/tests/plan?a=&b=&examples=&tries=&connectors=`
  - `POST …/tests/runs` (body `{ a, b, exampleIds, tries, reuseA, reuseB, quickCheck, capUsd, connectors }`), `GET …/runs/:run`, `POST …/runs/:run/stop`, `POST …/runs/:run/continue`
  - `POST …/examples/:ex/try-once` always pretends (D35)
  - `GET …/runs/:run/compare`, `GET …/runs/:run/examples/:ex`, `GET …/runs/:run/tries/:try/result`
  - `GET /api/workflow-tests/past-run/:pipelineId`
  - Errors: `BAD_REQUEST` and `NOT_VERSIONABLE` → 400, `NOT_FOUND` → 404, `BUSY` → 409 (`BUSY_TEXT`, D37), `NOT_TESTABLE` → 422, anything else → 500.
  - The frame: `{ type: 'workflow-tests-changed', workflowId, testRunId, finished?, status?, title? }` (D33)

- [ ] **Step 1: Write the failing API test.** Create `test/api-workflow-tests.test.mjs`:

```js
// test/api-workflow-tests.test.mjs — the Tests routes end to end on the mock engine (flag workflowTests): examples and a
// file, a past run as an example (D29), a test of v1 against the draft with the quick check, reuse (D26), the compare
// and side-by-side reads, Try it once now, and that no try reaches the Runs list (D21).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, prevHome, srv, base, runs, store, service;
const JSONH = { 'Content-Type': 'application/json' };
const WF = '/api/workflows/wf_api_t/tests';
const call = async (method, p, body) => {
  const r = await fetch(`${base}${p}`, { method, headers: JSONH, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};
const graph = (name) => ({
  version: 2, id: 'wf_api_t', name, domain: 'product',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
async function finished(runId, ms = 240000) {
  const t0 = Date.now();
  for (;;) {
    const p = await call('GET', `${WF}/runs/${runId}`);
    if (p.body.run.status !== 'running') return p.body;
    if (Date.now() - t0 > ms) throw new Error(`test ${runId} is still running`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
async function settled(runId, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const e = runs.get(runId); if (e && e.settled) return e; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`run ${runId} never settled`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  store = await import('../src/core/workflow-tests/store.mjs');
  service = await import('../src/core/workflow-tests/service.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('examples, a past run as an example, a test of v1 against the draft, reuse, compare, side by side', { timeout: 600000 }, async () => {
  assert.equal((await call('POST', '/api/workflows', graph('Brief writer'))).status, 201);
  let o = (await call('GET', WF)).body;
  assert.deepEqual([o.testable, o.columns, o.examples, o.pastRuns], [true, [{ use: 'draft', label: 'Your draft' }], [], []]);
  assert.equal((await call('POST', '/api/workflows/wf_api_t/versions', { note: 'First' })).status, 201);

  // A past run of v1 (a normal run: it stays in the Runs list), turned into an example with the person's verdict.
  const usage = Buffer.from('filter,uses\nstatus,120\n').toString('base64');
  const past = await call('POST', '/api/run', { noProject: true, workflowId: 'wf_api_t', prompt: 'Plan saved filters for reports', mock: true,
    extras: [{ name: 'usage.csv', dataBase64: usage }] });
  assert.equal(past.status, 200, JSON.stringify(past.body));
  await settled(past.body.runId);
  const pr = (await call('GET', `/api/workflow-tests/past-run/${past.body.pipelineId}`)).body;
  assert.deepEqual([pr.workflowId, pr.testable, pr.use, pr.useLabel, pr.files, pr.request], ['wf_api_t', true, 1, 'v1', ['usage.csv'], 'Plan saved filters for reports']);
  const fr = await call('POST', `${WF}/examples/from-run`, { pipelineId: past.body.pipelineId, name: 'Saved filters', verdict: 'not-good', note: 'It ignored the usage data.' });
  assert.equal(fr.status, 201, JSON.stringify(fr.body));
  assert.deepEqual([fr.body.example.files.map((f) => f.name), fr.body.example.from.verdict, fr.body.example.from.use, fr.body.skipped], [['usage.csv'], 'not-good', 1, []]);

  // A written example with a file.
  const ex = (await call('POST', `${WF}/examples`, { name: 'Bulk invoice export', request: 'Plan a bulk invoice export.', checks: [{ kind: 'words', min: 1 }], tries: 1 })).body.example;
  const up = await call('POST', `${WF}/examples/${ex.id}/files`, { name: 'notes.md', dataBase64: Buffer.from('# Notes').toString('base64') });
  assert.deepEqual(up.body.example.files.map((f) => [f.name, f.size]), [['notes.md', 7]]);
  o = (await call('GET', WF)).body;
  assert.deepEqual(o.columns.map((c) => c.label), ['v1 · the team uses it', 'v2 draft · yours']);
  const saved = o.examples.find((e) => e.name === 'Saved filters');
  assert.deepEqual([saved.cells['1'], saved.cells.draft, saved.files], [{ passed: null, total: null, stale: false, past: 'not-good' }, null, ['usage.csv']]);
  assert.equal(o.pastRuns.length, 1);

  // Test v1 against the draft on the written example, with the free quick check.
  const plan = (await call('GET', `${WF}/plan?a=1&b=draft&examples=${ex.id}&tries=1`)).body;
  assert.deepEqual([plan.a.want, plan.a.reusable, plan.b.label], [1, 0, 'v2 draft · your changes']);
  assert.deepEqual(plan.connectors, { mode: 'pretend', pretend: [], off: [], scripts: [] }, 'board 30: no connector and no script step here');
  const started = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true, capUsd: 5 });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const busy = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  assert.deepEqual([busy.status, busy.body.error], [409, 'A test of this workflow is running. Wait for it, or stop it first.'], 'one test at a time (D37)');
  assert.equal((await call('POST', `${WF}/examples/${ex.id}/try-once`, {})).status, 409, 'Try it once now waits too');
  const p = await finished(started.body.run.id);
  assert.deepEqual([p.run.status, p.run.connectors, p.quick.status, p.done, p.total, p.title], ['done', 'pretend', 'passed', 2, 2, 'Testing your v2 draft']);
  assert.ok(p.rows.every((r) => r.summary === 'Done · 1 of 1 passed' || r.summary === 'Done · 0 of 1 passed'));
  const c = (await call('GET', `${WF}/runs/${started.body.run.id}/compare`)).body;
  assert.equal(c.title, 'Your v2 draft compared with v1');
  assert.deepEqual([c.model.tiles.a.passed.total, c.model.tiles.b.passed.total, c.changes, c.fair], [1, 1, [], []]);
  const s = (await call('GET', `${WF}/runs/${started.body.run.id}/examples/${ex.id}`)).body;
  assert.equal(s.tries.length, 1);
  assert.equal(s.tries[0].a.verdict.basics[0].key, 'noError');
  assert.deepEqual([s.connectors, s.tries[0].b.connectors, s.tries[0].b.wouldHaveSent, s.tries[0].b.answeredReads], ['pretend', 'pretend', [], []], 'board 31: a mock try calls no tool');
  const whole = await call('GET', `${WF}/runs/${started.body.run.id}/tries/${s.tries[0].b.tryId}/result`);
  assert.equal(whole.status, 200);
  assert.equal((await call('POST', `${WF}/runs/${started.body.run.id}/continue`)).status, 400, 'only a stopped test can be finished');

  // D21: no try is in the Runs list; the past run is.
  const tryIds = store.triesOfRun(started.body.run.id).map((t) => t.pipelineId);
  const listed = (await call('GET', '/api/history')).body.pipelines.map((x) => x.id);
  assert.ok(listed.includes(past.body.pipelineId));
  assert.ok(tryIds.every((id) => id && !listed.includes(id)));

  // D26: v1's try is reused; only the draft is tried again.
  const plan2 = (await call('GET', `${WF}/plan?a=1&b=draft&examples=${ex.id}&tries=1`)).body;
  assert.equal(plan2.a.reusable, 1);
  const again = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: true, capUsd: 5 });
  await finished(again.body.run.id);
  assert.equal(store.triesOfRun(again.body.run.id).filter((t) => t.runId === again.body.run.id).length, 1);

  // Try it once now: one try of the draft; the side by side has one column.
  const once = await call('POST', `${WF}/examples/${ex.id}/try-once`, {});
  assert.equal(once.status, 201);
  assert.equal(once.body.run.connectors, 'pretend', 'Try it once now always pretends (D35)');
  await finished(once.body.run.id);
  const s1 = (await call('GET', `${WF}/runs/${once.body.run.id}/examples/${ex.id}`)).body;
  assert.deepEqual([s1.labels.a, s1.tries.length, s1.tries[0].a, s1.compareTitle], [null, 1, null, 'Tried once: Bulk invoice export']);
  o = (await call('GET', WF)).body;
  assert.equal(o.latest.title, 'Latest test: your v2 draft compared with v1');
  assert.equal(o.running, null);
});

test('errors: unknown workflow, a bad example, an unknown example; a workflow that needs a project is not testable', async () => {
  assert.equal((await call('GET', '/api/workflows/wf_nope/tests')).status, 404);
  const bad = await call('POST', `${WF}/examples`, { name: '', request: 'x' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'the name must be 1 to 120 characters']);
  assert.equal((await call('GET', `${WF}/examples/9999`)).status, 404);
  assert.equal((await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [9999], tries: 1 })).status, 404);
  const mode = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [9999], tries: 1, connectors: 'maybe' });
  assert.deepEqual([mode.status, mode.body.error], [400, 'connectors must be "pretend" or "real"']);
  const o = await service.testsOverview('wf_api_t', { registry: { planner: { needsRepo: true } } });
  assert.deepEqual([o.testable, o.reason], [false, 'needs-project']);
});
```

Create `test/api-workflow-tests-flag-off.test.mjs`:
```js
// test/api-workflow-tests-flag-off.test.mjs — with workflowTests off every Part 2 route answers 404 (D9, D30).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, prevHome, srv, base, routes;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftoff-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  delete process.env.WORCA_FLAGS;
  const mod = await import('../ui/server.mjs');
  ({ WORKFLOW_TEST_ROUTES: routes } = await import('../src/core/workflow-tests/routes.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('every workflow test route is 404 while the flag is off', async () => {
  assert.equal(routes.length, 19);
  for (const { method, path } of routes) {
    const url = path.replace(':id', 'wf_x').replace(':ex', '1').replace(':run', '1').replace(':try', '1').replace(':name', 'a.md').replace(':pipelineId', 'abcd1234');
    const r = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
    assert.equal(r.status, 404, `${method} ${path}`);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node tools/test.mjs test/api-workflow-tests.test.mjs test/api-workflow-tests-flag-off.test.mjs`
Expected: FAIL. `GET /api/workflows/wf_api_t/tests` is Express's 404 (no route), and `routes.mjs` does not exist.

- [ ] **Step 3: Implement `src/core/workflow-tests/service.mjs`**

```js
// src/core/workflow-tests/service.mjs
// The Tests pages' read models (plans/workflow-tests-part2-plan.md Task 9): the overview (boards 1, 19), a past run as an
// example (board 3, D29), the plan of a test (board 4), its progress (board 20), the compare (board 5) and one example
// side by side (board 6). Writes go through store.mjs and runner.mjs.
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { getDb, prepare } from '../db.mjs';
import { isSafeWorkflowId } from '../workflows.mjs';
import { isReservedWorkflowId } from '../graph/builtin-workflows.mjs';
import { isVersionableRow, liveVersionNo, latestVersion } from '../workflow-revisions.mjs';
import { loadAgentRegistry } from '../agent-registry.mjs';
import { findPipelineRowById, readStepQuestions, readClarifyRow, runDirForRow } from '../artifacts.mjs';
import { NO_PROJECT_KEY, isNoProjectKey } from '../store.mjs';
import { diffGraphs } from '../../shared/graph/diff-graphs.mjs';
import { basicsList } from '../../shared/workflow-tests/checks.mjs';
import { useLabel, testTitle, latestTitle, compareModel, TRIES_AT_ONCE } from '../../shared/workflow-tests/compare.mjs';
import { loadScriptRegistry } from '../script-registry.mjs';
import * as store from './store.mjs';
import { useGraph, useFingerprint } from './uses.mjs';
import { testTargetOf } from './try-body.mjs';
import { mainResult } from './result.mjs';
import { connectorNotes, userScopeServerNames, seenClaudeAiServers, wouldHaveSent } from './connectors.mjs';

export const NOT_TESTABLE_TEXT = 'This workflow works on a project, and tests work for workflows without a project for now.';
export const NOT_TESTABLE_REASONS = Object.freeze({
  'test-try': 'A test try cannot become an example.',
  'not-finished': 'Wait until the run has finished.',
  'project-run': 'This run worked on a project: tests try workflows without a project for now.',
  'needs-project': NOT_TESTABLE_TEXT,
  'not-versionable': 'Its workflow comes from a plugin or is built in, so it has no tests.',
  'no-workflow': 'Its workflow was deleted.',
});
const PREVIEW_MAX = 4000;
const FIN = new Set(store.FINISHED);
const err = store.testError;
const parse = (t, f) => { try { return JSON.parse(t) ?? f; } catch { return f; } };
const templateIdSql = "json_extract(CASE WHEN json_valid(stepper) THEN stepper END, '$.template.id')";

/** A saved user workflow that can have tests: a format-2 row no plugin owns (D5). */
export function workflowRowOf(workflowId) {
  if (!isSafeWorkflowId(workflowId) || isReservedWorkflowId(workflowId)) throw err(`unknown workflow "${workflowId}"`, 'NOT_FOUND');
  getDb();
  const row = prepare('SELECT id, name, version, graph, origin, archived_at FROM workflows WHERE id = ?').get(workflowId);
  if (!row || row.archived_at) throw err(`unknown workflow "${workflowId}"`, 'NOT_FOUND');
  if (!isVersionableRow(row)) throw err(`"${row.name}" cannot have tests: it comes from a plugin or is not a graph`, 'NOT_VERSIONABLE');
  return { ...row, graph: parse(row.graph, {}) };
}

/** D20: whether Part 2 can test this workflow (try-body.mjs decides). */
export function testTarget(workflowId, { registry = loadAgentRegistry() } = {}) {
  const row = workflowRowOf(workflowId);
  return { row, ...testTargetOf(row.graph, registry) };
}

export function labelCtx(workflowId) {
  const latest = latestVersion(workflowId);
  return { liveVersionNo: liveVersionNo(workflowId), latestVersionNo: latest ? latest.versionNo : null };
}

export function runOf(workflowId, runId) {
  const run = store.readTestRun(runId);
  if (!run || run.workflowId !== workflowId) throw err(`no test ${runId}`, 'NOT_FOUND');
  return run;
}

const avgOf = (sql, ...params) => { const r = prepare(sql).get(...params); return r && Number(r.n) > 0 && r.c !== null ? Number(r.c) : null; };

/** What one try of `use` usually costs: its last real tries, else any use's, else the workflow's own finished runs. null = unknown (C12). */
export function perTryCost(workflowId, use) {
  getDb();
  return avgOf(`SELECT AVG(cost_usd) AS c, COUNT(*) AS n FROM (SELECT cost_usd FROM wf_test_tries WHERE workflow_id = ? AND use_ref = ?
      AND mock = 0 AND status IN ('passed', 'failed') ORDER BY id DESC LIMIT 10)`, workflowId, store.useRef(use))
    ?? avgOf(`SELECT AVG(cost_usd) AS c, COUNT(*) AS n FROM (SELECT cost_usd FROM wf_test_tries WHERE workflow_id = ?
      AND mock = 0 AND status IN ('passed', 'failed') ORDER BY id DESC LIMIT 10)`, workflowId)
    ?? avgOf(`SELECT AVG(total_cost_usd) AS c, COUNT(*) AS n FROM (SELECT total_cost_usd FROM pipelines WHERE is_test IS NULL
      AND status = 'done' AND total_cost_usd > 0 AND ${templateIdSql} = ? ORDER BY started_at DESC LIMIT 20)`, workflowId);
}

/** How long one try usually takes, in ms; null = unknown. */
export function perTryMs(workflowId) {
  getDb();
  return avgOf(`SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400000) AS c, COUNT(*) AS n FROM (SELECT started_at, finished_at
      FROM wf_test_tries WHERE workflow_id = ? AND mock = 0 AND status IN ('passed', 'failed') AND started_at IS NOT NULL
      AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 10)`, workflowId)
    ?? avgOf(`SELECT AVG((julianday(updated_at) - julianday(started_at)) * 86400000) AS c, COUNT(*) AS n FROM (SELECT started_at, updated_at
      FROM pipelines WHERE is_test IS NULL AND status = 'done' AND started_at IS NOT NULL AND updated_at IS NOT NULL
      AND ${templateIdSql} = ? ORDER BY started_at DESC LIMIT 20)`, workflowId);
}

const normPrompt = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const extrasOf = (pipelineId) => prepare("SELECT rel_path FROM artifacts WHERE pipeline_id = ? AND kind = 'extra' ORDER BY rel_path")
  .all(pipelineId).map((r) => r.rel_path);

/** Board 19 / G4, G7: the workflow's newest finished no-project runs (never a try); an exactly equal request is "the same". */
export function recentRuns(workflowId, { limit = 10 } = {}) {
  getDb();
  const rows = prepare(`SELECT id, title, prompt, status, started_at FROM pipelines WHERE project_key = ? AND is_test IS NULL
      AND archived_at IS NULL AND deleted_at IS NULL AND status IN ('done', 'stopped', 'error') AND ${templateIdSql} = ?
      ORDER BY started_at DESC LIMIT ?`).all(NO_PROJECT_KEY, workflowId, limit);
  const first = new Map();
  return rows.map((r) => {
    const key = normPrompt(r.prompt);
    const sameAs = key && first.has(key) ? first.get(key) : null;
    if (key && !first.has(key)) first.set(key, r.title || r.id);
    return { pipelineId: r.id, title: r.title || r.id, at: r.started_at, status: r.status, files: extrasOf(r.id).length, sameAs };
  });
}

/** The questions a past run asked and the answers it got (Clarify and the agents' own rounds), as canned answers. */
function pastAnswers(pipelineId) {
  const out = [];
  const add = (question, answer) => {
    const q = String(question || '').trim();
    const a = String(answer || '').trim();
    if (q && a && !out.some((x) => x.question === q)) out.push({ question: q.slice(0, 500), answer: a.slice(0, 2000) });
  };
  const c = readClarifyRow(pipelineId);
  const asked = new Map(((c.questions && c.questions.questions) || []).map((q) => [q.id, q.question]));
  for (const a of (c.answers && c.answers.answers) || []) add(a.question || asked.get(a.id), a.choice);
  for (const r of readStepQuestions(pipelineId)) {
    const qs = new Map(r.questions.map((q) => [q.id, q.question]));
    for (const a of r.answers) add(a.question || qs.get(a.id), a.choice);
  }
  return out;
}

/** Board 3: what "Use this run as a test example" keeps, and whether it can. */
export async function pastRunSummary(pipelineId, { registry = loadAgentRegistry() } = {}) {
  getDb();
  const row = findPipelineRowById(pipelineId);
  if (!row || row.archived_at || row.deleted_at) throw err('no such run', 'NOT_FOUND');
  const stepper = parse(row.stepper, {});
  const tpl = stepper && stepper.template ? stepper.template : {};
  const workflowId = typeof tpl.id === 'string' ? tpl.id : null;
  const use = stepper && stepper.workflowVersion && Number.isInteger(stepper.workflowVersion.no) ? stepper.workflowVersion.no : 'draft';
  let reason = null;
  let target = null;
  if (row.is_test) reason = 'test-try';
  else if (!['done', 'stopped', 'error'].includes(row.status)) reason = 'not-finished';
  else if (!isNoProjectKey(row.project_key)) reason = 'project-run';
  else {
    try { target = testTarget(workflowId || '', { registry }); if (!target.testable) reason = 'needs-project'; }
    catch (e) { reason = e && e.code === 'NOT_VERSIONABLE' ? 'not-versionable' : 'no-workflow'; }
  }
  const ctx = target ? labelCtx(workflowId) : {};
  return {
    pipelineId: row.id, workflowId, workflowName: target ? target.row.name : (tpl.name || ''),
    title: row.title || '', request: row.prompt || '', files: extrasOf(row.id).map((p) => basename(p)), qa: pastAnswers(row.id),
    use, useLabel: use === 'draft' ? 'your draft' : useLabel(use, ctx), testable: !reason, reason,
    reasonText: reason ? NOT_TESTABLE_REASONS[reason] : null,
  };
}

/** Board 3 → an example; `skipped` names the files that did not fit (5 MB, 8 files). */
export async function exampleFromRun(workflowId, { pipelineId, name, keepRequest = true, keepAnswers = true, verdict = null, note = null } = {}, { by = null, registry } = {}) {
  const past = await pastRunSummary(pipelineId, registry ? { registry } : {});
  if (past.workflowId !== workflowId) throw err('this run is of another workflow', 'BAD_REQUEST');
  if (!past.testable) throw err(NOT_TESTABLE_REASONS[past.reason] || NOT_TESTABLE_TEXT, past.reason === 'needs-project' ? 'NOT_TESTABLE' : 'BAD_REQUEST');
  if (verdict !== null && verdict !== 'good' && verdict !== 'not-good') throw err('verdict must be "good" or "not-good"', 'BAD_REQUEST');
  const clean = (typeof name === 'string' && name.trim() ? name.trim() : past.title || 'Example').slice(0, 120);
  const example = store.createExample(workflowId, { name: clean, request: keepRequest ? past.request : '', answers: keepAnswers ? past.qa : [], note },
    { by, from: { pipelineId: past.pipelineId, use: past.use, verdict } });
  const skipped = [];
  if (keepRequest) {
    const row = findPipelineRowById(past.pipelineId);
    const dir = await runDirForRow(row);
    for (const rel of extrasOf(row.id)) {
      try { store.putExampleFile(workflowId, example.id, { name: basename(rel), data: await readFile(join(dir, rel)) }); }
      catch { skipped.push(basename(rel)); }
    }
  }
  return { example: store.readExample(workflowId, example.id), skipped };
}

/** Board 19's "Add N examples": every picked run with its request, files and answers, no verdict (G4). */
export async function examplesFromRuns(workflowId, pipelineIds, opts = {}) {
  const examples = [];
  const skipped = [];
  for (const id of pipelineIds) {
    const r = await exampleFromRun(workflowId, { pipelineId: id }, opts);
    examples.push(r.example);
    skipped.push(...r.skipped);
  }
  return { examples, skipped };
}

function cellOf(ex, use, fpNow) {
  const tries = store.latestTriesFor({ workflowId: ex.workflowId, exampleId: ex.id, use });
  if (tries.length) {
    return { passed: tries.filter((t) => t.status === 'passed').length, total: tries.length,
      stale: tries.some((t) => t.fp !== fpNow || t.exampleFp !== ex.fingerprint), past: null };
  }
  if (ex.from && ex.from.verdict && ex.from.use != null && store.useRef(ex.from.use) === store.useRef(use)) {
    return { passed: null, total: null, stale: false, past: ex.from.verdict };   // D29
  }
  return null;
}

const firstExampleName = (run) => { const ex = store.readExample(run.workflowId, run.exampleIds[0]); return ex ? ex.name : ''; };
function modelInput(run, ctx) {
  const examples = run.exampleIds.map((id) => store.readExample(run.workflowId, id)).filter(Boolean).map(({ id, name }) => ({ id, name }));
  return { examples, a: run.a != null ? { label: useLabel(run.a, ctx) } : null, b: { label: useLabel(run.b, ctx) }, tries: store.triesOfRun(run.id) };
}

/** Boards 1 and 19 in one read. */
export async function testsOverview(workflowId, { registry = loadAgentRegistry(), fingerprintOf = (id, use) => useFingerprint(id, use) } = {}) {
  const { row, testable, reason } = testTarget(workflowId, { registry });
  const ctx = labelCtx(workflowId);
  const uses = [...(ctx.liveVersionNo ? [ctx.liveVersionNo] : []), 'draft'];
  const fpNow = {};
  for (const use of uses) {
    try { fpNow[store.useRef(use)] = await fingerprintOf(workflowId, use); } catch { fpNow[store.useRef(use)] = null; }
  }
  const examples = store.listExamples(workflowId).map((ex) => {
    const from = ex.from ? findPipelineRowById(ex.from.pipelineId) : null;
    return {
      id: ex.id, name: ex.name, hasRequest: !!ex.request.trim(), files: ex.files.map((f) => f.name),
      fromAt: from ? from.started_at || null : null, note: ex.note, tries: ex.tries,
      basics: basicsList(ex.basics).length, checks: ex.checks.length,
      cells: Object.fromEntries(uses.map((use) => [store.useRef(use), cellOf(ex, use, fpNow[store.useRef(use)])])),
    };
  });
  const runs = store.listTestRuns(workflowId, { limit: 20 });
  const running = runs.find((r) => r.status === 'running') || null;
  const last = runs.find((r) => r.kind === 'compare' && r.status !== 'running') || null;
  const own = running ? store.triesOfRun(running.id).filter((t) => t.runId === running.id) : [];
  return {
    workflowId, name: row.name, testable, reason, ctx,
    columns: uses.map((use) => ({ use, label: useLabel(use, ctx, 'column') })),
    examples,
    running: running ? { runId: running.id, title: testTitle(running, ctx, { mode: 'testing', exampleName: firstExampleName(running) }),
      done: own.filter((t) => FIN.has(t.status)).length, total: own.length } : null,
    latest: last ? { runId: last.id, title: latestTitle(last, ctx), finishedAt: last.finishedAt, examples: last.exampleIds.length,
      tries: last.tries, costUsd: store.spentOfRun(last.id), counts: compareModel(modelInput(last, ctx)).counts, status: last.status,
      stopReason: last.stopReason } : null,
    pastRuns: recentRuns(workflowId),
  };
}

/**
 * Board 30's notes (D35): the connectors a try without a project would load (the server's registry preview), the
 * ones Claude Code loads by itself, and the workflow's script steps on either side.
 */
async function connectorsOf(workflowId, uses, { connectorsPreview = null } = {}) {
  let copies = [];
  try { copies = connectorsPreview ? ((await connectorsPreview()) || {}).copies || [] : []; } catch { copies = []; }
  let scripts = {};
  try { scripts = loadScriptRegistry() || {}; } catch { scripts = {}; }
  const names = [];
  for (const use of uses) {
    const g = use == null ? null : await useGraph(workflowId, use);
    for (const n of g ? g.nodes : []) if (n && n.kind === 'script') names.push((scripts[n.key] && scripts[n.key].displayName) || n.key || 'script');
  }
  return connectorNotes({ copies, userScope: userScopeServerNames(), claudeAi: seenClaudeAiServers(), scripts: names });
}

/** Board 4: per version, what would be tried, what can be reused, and what a try usually costs; board 30's notes. */
export async function testPlan(workflowId, { a = null, b = 'draft', exampleIds = [], tries = 3, connectors = 'pretend' } = {},
  { fingerprintOf = (id, use) => useFingerprint(id, use), mock = false, connectorsPreview = null } = {}) {
  workflowRowOf(workflowId);
  const ctx = labelCtx(workflowId);
  const all = store.listExamples(workflowId);
  const examples = exampleIds.length ? all.filter((e) => exampleIds.includes(e.id)) : all;
  const side = async (use) => {
    if (use == null) return null;
    let fp = null;
    try { fp = await fingerprintOf(workflowId, use); } catch { fp = null; }
    let reusable = 0;
    let at = null;
    if (fp) {
      for (const ex of examples) {
        const kept = store.reusableTries({ workflowId, exampleId: ex.id, use, fp, exampleFp: ex.fingerprint, mock, connectors, limit: tries });
        reusable += kept.length;
        for (const t of kept) if (t.finishedAt && (!at || t.finishedAt > at)) at = t.finishedAt;
      }
    }
    const perTryUsd = perTryCost(workflowId, use);
    return { use, label: useLabel(use, ctx, 'select'), short: useLabel(use, ctx), want: examples.length * tries, reusable,
      reusableAt: at, perTryUsd, savesUsd: perTryUsd === null ? null : reusable * perTryUsd };
  };
  return { a: await side(a), b: await side(b), examples: examples.length, tries, perTryMs: perTryMs(workflowId),
    connectors: { mode: connectors, ...(await connectorsOf(workflowId, [a, b], { connectorsPreview })) } };
}

/** C9 and board 20's "So far" column. */
function rowSummary(list, run) {
  const n = list.length;
  const tried = list.filter((t) => FIN.has(t.status)).length;
  const passed = list.filter((t) => t.status === 'passed').length;
  if (n && tried === n) return `Done · ${passed} of ${n} passed`;
  const running = list.findIndex((t) => t.status === 'running');
  if (running >= 0) return `Trying ${running + 1} of ${n}`;
  if (run.status !== 'running') return `Not finished · ${tried} of ${n} tried`;
  return tried ? `Tried ${tried} of ${n}` : 'Waiting';
}

/** Board 20 (G8: two rows per example when both versions need tries). `costOf` = the runner's live cost. */
export function progressOf(workflowId, runId, { costOf = null } = {}) {
  const run = runOf(workflowId, runId);
  const ctx = labelCtx(workflowId);
  const tries = store.triesOfRun(run.id);
  const own = tries.filter((t) => t.runId === run.id);
  const both = run.a != null && own.some((t) => t.side === 'a');
  const sides = both ? ['a', 'b'] : ['b'];
  const rows = [];
  for (const id of run.exampleIds) {
    const ex = store.readExample(workflowId, id);
    for (const side of sides) {
      const list = tries.filter((t) => t.exampleId === id && t.side === side).sort((x, y) => x.tryNo - y.tryNo || x.id - y.id);
      rows.push({ exampleId: id, name: ex ? ex.name : 'A deleted example', label: both ? useLabel(side === 'a' ? run.a : run.b, ctx) : null,
        dots: list.map((t) => t.status), summary: rowSummary(list, run) });
    }
  }
  const costBy = new Map();
  const costFor = (use) => { const k = store.useRef(use); if (!costBy.has(k)) costBy.set(k, perTryCost(workflowId, use)); return costBy.get(k); };
  const estimateUsd = own.reduce((s, t) => { const c = costFor(t.use); return s === null || c === null ? null : s + c; }, 0);
  const remaining = own.filter((t) => t.status === 'waiting' || t.status === 'running').length;
  const ms = perTryMs(workflowId);
  return {
    run, title: testTitle(run, ctx, { mode: 'testing', exampleName: firstExampleName(run) }), rows,
    done: own.filter((t) => FIN.has(t.status)).length, total: own.length,
    costUsd: costOf ? costOf(run.id) : store.spentOfRun(run.id), estimateUsd, capUsd: run.capUsd,
    minutesLeft: ms !== null && remaining ? Math.max(1, Math.ceil((Math.ceil(remaining / TRIES_AT_ONCE) * ms) / 60000)) : null,
    quick: run.quick,
  };
}

async function changesBetween(workflowId, a, b, registry) {
  const ga = await useGraph(workflowId, a);
  const gb = await useGraph(workflowId, b);
  if (!ga || !gb) return [];
  const labelOf = (n) => (n && n.kind === 'agent' && registry[n.key] && registry[n.key].displayName) || (n && (n.key || n.kind)) || 'step';
  return diffGraphs(ga, gb, { labelOf }).map((c) => c.text);
}

/** Board 5: the model, Part 1's "what you changed" texts (graph changes only, D16), and the fair-comparison notes. */
export async function compareOf(workflowId, runId, { registry = loadAgentRegistry(), fingerprintOf = (id, use) => useFingerprint(id, use) } = {}) {
  const run = runOf(workflowId, runId);
  const ctx = labelCtx(workflowId);
  const input = modelInput(run, ctx);
  const changes = run.a != null ? await changesBetween(workflowId, run.a, run.b, registry) : [];
  const fair = [];
  for (const [use, fp] of [[run.a, run.aFp], [run.b, run.bFp]]) {
    if (use == null) continue;
    let now = null;
    try { now = await fingerprintOf(workflowId, use); } catch { now = null; }
    if (now !== fp) fair.push(use === 'draft' ? 'Your draft changed after this test.' : `${useLabel(use, ctx)} runs changed agent or script text since this test.`);
  }
  for (const id of run.exampleIds) {
    const ex = store.readExample(workflowId, id);
    if (!ex) fair.push('An example of this test was deleted since.');
    else if (input.tries.some((t) => t.exampleId === id && t.exampleFp !== ex.fingerprint)) fair.push(`"${ex.name}" was edited after this test.`);
  }
  return { run, title: testTitle(run, ctx), labels: { a: input.a ? input.a.label : null, b: input.b.label },
    examples: input.examples.length, costUsd: store.spentOfRun(run.id), model: compareModel(input), changes, fair };
}

/** Board 6 (G2: one column for Try it once now) and board 31 (what a pretend try would have sent). The cards show the
 *  first PREVIEW_MAX characters; tryResult reads all. */
export async function sideBySide(workflowId, runId, exampleId) {
  const run = runOf(workflowId, runId);
  const ex = store.readExample(workflowId, exampleId);
  if (!ex || !run.exampleIds.includes(ex.id)) throw err(`no example ${exampleId} in this test`, 'NOT_FOUND');
  const ctx = labelCtx(workflowId);
  const tries = store.triesOfRun(run.id).filter((t) => t.exampleId === ex.id && FIN.has(t.status));
  const list = (side) => tries.filter((t) => t.side === side).sort((x, y) => x.tryNo - y.tryNo || x.id - y.id);
  const A = run.a != null ? list('a') : [];
  const B = list('b');
  const view = async (t) => {
    if (!t) return null;
    const m = await mainResult(t.pipelineId);
    const text = typeof m.text === 'string' ? m.text : null;
    const sent = t.connectors === 'pretend' ? await wouldHaveSent(t.pipelineId) : null;
    return { tryId: t.id, status: t.status, verdict: t.verdict, name: m.name,
      text: text && text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) : text, truncated: !!text && text.length > PREVIEW_MAX,
      connectors: t.connectors, wouldHaveSent: sent ? sent.sent : null, answeredReads: sent ? sent.reads : [] };
  };
  const out = [];
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) out.push({ n: i + 1, a: await view(A[i]), b: await view(B[i]) });
  const labels = { a: run.a != null ? useLabel(run.a, ctx) : null, b: useLabel(run.b, ctx) };
  const m = compareModel({ examples: [{ id: ex.id, name: ex.name }], a: labels.a ? { label: labels.a } : null, b: { label: labels.b }, tries });
  return { run, compareTitle: testTitle(run, ctx, { exampleName: ex.name }), example: { id: ex.id, name: ex.name }, labels, row: m.examples[0],
    connectors: run.connectors, tries: out };
}

/** "Read the whole result". */
export async function tryResult(workflowId, runId, tryId) {
  const run = runOf(workflowId, runId);
  const t = store.triesOfRun(run.id).find((x) => x.id === Number(tryId));
  if (!t) throw err(`no try ${tryId} in this test`, 'NOT_FOUND');
  const m = await mainResult(t.pipelineId);
  return { name: m.name, text: m.text };
}

/** C13: "<workflow>: <test title>" for the results-ready toast. */
export function finishedText(workflowId, runId) {
  const run = store.readTestRun(runId);
  if (!run) return '';
  let name = workflowId;
  try { name = workflowRowOf(workflowId).name; } catch { /* deleted meanwhile: its id */ }
  return `${name}: ${testTitle(run, labelCtx(workflowId), { exampleName: firstExampleName(run) })}`;
}
```

- [ ] **Step 4: Implement `src/core/workflow-tests/routes.mjs`**

```js
// src/core/workflow-tests/routes.mjs — HTTP for workflow tests (plans/workflow-tests-part2-plan.md Task 9). Every route
// is behind the workflowTests flag, and so is the `workflow-tests-changed` frame (D33).
import { requireFlag, flagEnabled } from '../flags.mjs';
import { actorOf } from '../identity.mjs';
import { loadScriptRegistry } from '../script-registry.mjs';
import * as store from './store.mjs';
import * as service from './service.mjs';
import { createTestRunner } from './runner.mjs';
import { readTryOutcome, checkTry } from './result.mjs';
import { useFingerprint, useGraph } from './uses.mjs';
import { testTargetOf } from './try-body.mjs';
import { loadAgentRegistry } from '../agent-registry.mjs';

const STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_VERSIONABLE: 400, NOT_FOUND: 404, BUSY: 409, NOT_TESTABLE: 422 });
const W = '/api/workflows/:id/tests';
/** Every route, in registration order: the flag-off test walks it, so no route can skip the gate unnoticed. */
export const WORKFLOW_TEST_ROUTES = Object.freeze([
  ['GET', W], ['POST', `${W}/examples`], ['POST', `${W}/examples/from-run`], ['POST', `${W}/examples/from-runs`],
  ['GET', `${W}/examples/:ex`], ['PUT', `${W}/examples/:ex`], ['DELETE', `${W}/examples/:ex`],
  ['POST', `${W}/examples/:ex/files`], ['DELETE', `${W}/examples/:ex/files/:name`], ['POST', `${W}/examples/:ex/try-once`],
  ['GET', `${W}/plan`], ['POST', `${W}/runs`], ['GET', `${W}/runs/:run`], ['POST', `${W}/runs/:run/stop`],
  ['POST', `${W}/runs/:run/continue`], ['GET', `${W}/runs/:run/compare`], ['GET', `${W}/runs/:run/examples/:ex`],
  ['GET', `${W}/runs/:run/tries/:try/result`], ['GET', '/api/workflow-tests/past-run/:pipelineId'],
].map(([method, path]) => Object.freeze({ method, path })));

const num = (v, what) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw store.testError(`${what} must be a whole number`, 'BAD_REQUEST');
  return n;
};
const usdOf = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * @param {import('express').Express} app
 * @param {{broadcast?: Function, deps: {startRun: Function, liveRun: Function, stopRun: Function, answer: Function, mockMode?: Function,
 *   connectorsPreview?: Function}}} opts
 */
export function registerWorkflowTestRoutes(app, { broadcast = () => {}, deps = {} } = {}) {
  const gate = requireFlag('workflowTests');
  const scriptName = (key) => { try { return (loadScriptRegistry()[key] || {}).displayName || key; } catch { return key; } };
  const runner = createTestRunner({
    ...deps,
    outcomeOf: (pipelineId, o) => readTryOutcome(pipelineId, o),
    judge: (example, outcome) => checkTry(example, outcome, { scriptName }),
    fingerprintOf: (workflowId, use) => useFingerprint(workflowId, use),
    // Review M9 (D20): a saved version on either side may need a project, even when the draft does not.
    targetOf: async (workflowId, use) => {
      const g = await useGraph(workflowId, use);
      return g ? testTargetOf(g, loadAgentRegistry()) : { testable: true, reason: null };
    },
    notify: (frame) => {
      if (!flagEnabled('workflowTests')) return;   // D33: silent while the flag is off
      broadcast(frame.finished ? { ...frame, title: service.finishedText(frame.workflowId, frame.testRunId) } : frame);
    },
  });
  // No recovery here (review M4): this runs at every import of server.mjs. bootMaintenance calls recoverInterruptedTestRuns().

  const handle = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      res.status(STATUS[e && e.code] || 500).json({ error: e && e.message ? e.message : String(e), ...(e && Array.isArray(e.errors) ? { errors: e.errors } : {}) });
    }
  };
  const route = (method, path, fn) => app[method.toLowerCase()](path, gate, handle(fn));
  const wid = (req) => String(req.params.id || '');
  const by = (req) => actorOf(req) || null;
  const testable = (req) => {
    const t = service.testTarget(wid(req));
    if (!t.testable) throw store.testError(service.NOT_TESTABLE_TEXT, 'NOT_TESTABLE');
  };
  const example = (req) => {
    const ex = store.readExample(wid(req), num(req.params.ex, 'example'));
    if (!ex) throw store.testError(`no example ${req.params.ex}`, 'NOT_FOUND');
    return ex;
  };

  route('GET', W, async (req, res) => res.json(await service.testsOverview(wid(req))));
  route('POST', `${W}/examples`, async (req, res) => {
    service.workflowRowOf(wid(req));
    res.status(201).json({ example: store.createExample(wid(req), req.body || {}, { by: by(req) }) });
  });
  route('POST', `${W}/examples/from-run`, async (req, res) => {
    service.workflowRowOf(wid(req));
    const b = req.body || {};
    res.status(201).json(await service.exampleFromRun(wid(req), { pipelineId: String(b.pipelineId || ''), name: b.name,
      keepRequest: b.keepRequest !== false, keepAnswers: b.keepAnswers !== false, verdict: b.verdict ?? null,
      note: typeof b.note === 'string' ? b.note : null }, { by: by(req) }));
  });
  route('POST', `${W}/examples/from-runs`, async (req, res) => {
    service.workflowRowOf(wid(req));
    const ids = Array.isArray(req.body && req.body.pipelineIds) ? req.body.pipelineIds.map(String).slice(0, 20) : [];
    if (!ids.length) throw store.testError('pick at least one run', 'BAD_REQUEST');
    res.status(201).json(await service.examplesFromRuns(wid(req), ids, { by: by(req) }));
  });
  route('GET', `${W}/examples/:ex`, async (req, res) => res.json({ example: example(req) }));
  route('PUT', `${W}/examples/:ex`, async (req, res) => res.json({ example: store.updateExample(wid(req), num(req.params.ex, 'example'), req.body || {}) }));
  route('DELETE', `${W}/examples/:ex`, async (req, res) => { store.deleteExample(wid(req), num(req.params.ex, 'example')); res.json({ ok: true }); });
  route('POST', `${W}/examples/:ex/files`, async (req, res) => {
    const b = req.body || {};
    if (typeof b.dataBase64 !== 'string' || !b.dataBase64) throw store.testError('the file is empty', 'BAD_REQUEST');
    res.json({ example: store.putExampleFile(wid(req), num(req.params.ex, 'example'), { name: b.name, data: Buffer.from(b.dataBase64, 'base64') }) });
  });
  route('DELETE', `${W}/examples/:ex/files/:name`, async (req, res) =>
    res.json({ example: store.deleteExampleFile(wid(req), num(req.params.ex, 'example'), String(req.params.name)) }));
  route('POST', `${W}/examples/:ex/try-once`, async (req, res) => {
    testable(req);
    const ex = example(req);
    res.status(201).json({ run: await runner.start({ workflowId: wid(req), kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, reuseB: false,
      connectors: 'pretend', by: by(req) }) });   // D35: Try it once now always pretends
  });
  route('GET', `${W}/plan`, async (req, res) => {
    const q = req.query || {};
    const ids = String(q.examples || '').split(',').filter(Boolean).map((x) => num(x, 'example'));
    res.json(await service.testPlan(wid(req), { a: q.a ? store.parseUse(String(q.a)) : null, b: store.parseUse(String(q.b || 'draft')) || 'draft',
      exampleIds: ids, tries: q.tries ? num(q.tries, 'tries') : 3, connectors: q.connectors === 'real' ? 'real' : 'pretend' },
    { mock: !!(deps.mockMode && deps.mockMode()), connectorsPreview: deps.connectorsPreview || null }));
  });
  route('POST', `${W}/runs`, async (req, res) => {
    testable(req);
    const b = req.body || {};
    const a = store.parseUse(b.a);
    const bb = store.parseUse(b.b);
    if (!a || !bb) throw store.testError('pick the two versions to compare', 'BAD_REQUEST');
    res.status(201).json({ run: await runner.start({ workflowId: wid(req), kind: 'compare', a, b: bb,
      exampleIds: Array.isArray(b.exampleIds) ? b.exampleIds : [], tries: Number(b.tries), reuseA: b.reuseA !== false, reuseB: b.reuseB === true,
      quickCheck: b.quickCheck === true, capUsd: usdOf(b.capUsd), connectors: b.connectors === undefined ? 'pretend' : b.connectors, by: by(req) }) });
  });
  route('GET', `${W}/runs/:run`, async (req, res) => res.json(service.progressOf(wid(req), num(req.params.run, 'test'), { costOf: runner.costOf })));
  route('POST', `${W}/runs/:run/stop`, async (req, res) => {
    const run = service.runOf(wid(req), num(req.params.run, 'test'));
    res.json({ run: await runner.stop(run.id) });
  });
  route('POST', `${W}/runs/:run/continue`, async (req, res) => {
    const run = service.runOf(wid(req), num(req.params.run, 'test'));
    res.json({ run: await runner.continueRun(run.id, { capUsd: usdOf(req.body && req.body.capUsd) }) });
  });
  route('GET', `${W}/runs/:run/compare`, async (req, res) => res.json(await service.compareOf(wid(req), num(req.params.run, 'test'))));
  route('GET', `${W}/runs/:run/examples/:ex`, async (req, res) =>
    res.json(await service.sideBySide(wid(req), num(req.params.run, 'test'), num(req.params.ex, 'example'))));
  route('GET', `${W}/runs/:run/tries/:try/result`, async (req, res) =>
    res.json(await service.tryResult(wid(req), num(req.params.run, 'test'), num(req.params.try, 'try'))));
  route('GET', '/api/workflow-tests/past-run/:pipelineId', async (req, res) => res.json(await service.pastRunSummary(String(req.params.pipelineId || ''))));
  return { runner };
}
```

- [ ] **Step 5: Register it in `ui/server.mjs`**

Next to the `registerWorkflowVersionRoutes` import (:335), add:
```js
import { registerWorkflowTestRoutes } from '../src/core/workflow-tests/routes.mjs';
import { TRY_ANSWERED_BY } from '../src/core/workflow-tests/answers.mjs';
import { recoverInterruptedTestRuns } from '../src/core/workflow-tests/store.mjs';
```
(Task 5 already imports `CONNECTOR_MODES` from the same store module: add `recoverInterruptedTestRuns` to that import line instead of a second one.)
Right after `registerWorkflowVersionRoutes(app, { agentsDir: AGENTS_DIR });`, add:
```js
// Workflow tests (plans/workflow-tests-part2-plan.md). Flag workflowTests. A try is a no-project run started through the
// run handler (invokeStartRun's workflowTest), hidden from every list (D21); the runner answers its questions itself.
registerWorkflowTestRoutes(app, { broadcast, deps: {
  startRun: (body, opts) => invokeStartRun(body, null, opts),
  liveRun: (runKey) => {
    const e = runs.get(runKey);
    return e ? { orch: e.orch, status: String(e.status || ''), launch: e.launch || null, pipelineId: e.pipelineId || null } : null;
  },
  stopRun: (runKey) => Promise.resolve().then(() => stopRun(runKey, TRY_ANSWERED_BY)).catch(() => {}),
  answer: (runKey, id, payload) => {
    const e = runs.get(runKey);
    if (!e || !e.orch) return false;
    const ok = e.orch.answer(id, payload, TRY_ANSWERED_BY);   // answerRun (:4684) cannot say whether it was taken
    if (ok) resolvePending(e, { id, reason: 'answered' });
    return ok;
  },
  mockMode: serverMockMode,
  // D35: the registry copies a run without a project would start, for the Test a version dialog's notes (board 30).
  connectorsPreview: async () => {
    const { result } = await mcpRunPreview({ kind: 'project', key: NO_PROJECT_KEY, name: NO_PROJECT_NAME, rank: 0 });
    return { copies: result.copies.map((c) => ({ name: c.name, untested: !!c.untested })) };
  },
} });
```
In `bootMaintenance`, right after the requirements `recoverRequirements()` try block, add:
```js
  // Workflow tests (D27, review M4): a test this restart cut short is stopped; its tries keep their cost and their runs
  // lose their resume points. Synchronous, like the requirements sweep: boot maintenance is not awaited before listen.
  try {
    const t = recoverInterruptedTestRuns();
    if (t.runs) console.log(`[worca-ui] workflow tests: ${t.runs} interrupted test(s) stopped`);
  } catch (err) {
    console.error(`[worca-ui] workflow tests sweep failed: ${err && err.message ? err.message : err}`);
  }
```

- [ ] **Step 6: Run the tests**

Create `test/workflow-test-routes.test.mjs` (review M8: the frame and the flag, without a server):
```js
// test/workflow-test-routes.test.mjs — D33, Review Focus 8: the change frame is sent only while the flag is on and names
// the test as testRunId. registerWorkflowTestRoutes on a fake app, with a run handler that refuses every try (403).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { registerWorkflowTestRoutes, WORKFLOW_TEST_ROUTES } from '../src/core/workflow-tests/routes.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';

const homes = [];
beforeEach(async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wftroutes-')); homes.push(d); _resetForTests(); process.env.WORCA_HOME = d; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; delete process.env.WORCA_FLAGS; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

function boot() {
  const seen = [];
  const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map((m) => [m, (path) => seen.push([m.toUpperCase(), path])]));
  const frames = [];
  const { runner } = registerWorkflowTestRoutes(app, { broadcast: (f) => frames.push(f), deps: {
    startRun: async () => ({ status: 403, body: { error: 'total cost limit reached' } }),
    liveRun: () => null, stopRun: async () => {}, answer: () => false, mockMode: () => true,
  } });
  return { runner, frames, seen };
}
async function workflowWithExample() {
  await writeGraphWorkflow({ id: 'wf_rt', name: 'Routes', domain: 'product',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }] });
  return store.createExample('wf_rt', { name: 'Bulk', request: 'Write the brief.', tries: 1 });
}

test('every route is registered, in WORKFLOW_TEST_ROUTES order', () => {
  assert.deepEqual(boot().seen, WORKFLOW_TEST_ROUTES.map((r) => [r.method, r.path]));
});

test('no frame while the flag is off; with it on, testRunId (never runId) and the toast text when it ends', async () => {
  delete process.env.WORCA_FLAGS;
  const ex = await workflowWithExample();
  const off = boot();
  const r1 = await off.runner.start({ workflowId: 'wf_rt', kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await off.runner.idle(r1.id);
  assert.equal(store.readTestRun(r1.id).stopReason, 'budget');
  assert.deepEqual(off.frames, [], 'D33: silent while the flag is off');
  process.env.WORCA_FLAGS = 'workflowTests';
  const on = boot();
  const r2 = await on.runner.start({ workflowId: 'wf_rt', kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await on.runner.idle(r2.id);
  assert.ok(on.frames.length && on.frames.every((f) => f.testRunId === r2.id && !('runId' in f)));
  const last = on.frames.at(-1);
  assert.deepEqual([last.finished, last.status, last.title], [true, 'stopped', 'Routes: Tried once: Bulk']);
});
```

Run: `node tools/test.mjs test/api-workflow-tests.test.mjs test/api-workflow-tests-flag-off.test.mjs test/workflow-test-routes.test.mjs test/api-workflow-test-try.test.mjs test/api-workflow-versions.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/workflow-tests/service.mjs src/core/workflow-tests/routes.mjs ui/server.mjs test/api-workflow-tests.test.mjs test/api-workflow-tests-flag-off.test.mjs test/workflow-test-routes.test.mjs
git commit -m "Workflow tests: the Tests routes and their read models (flag workflowTests)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 10: The Tests page: Canvas · Tests · Versions, the list and first use

**Precondition:** the screens are the approved boards 1 Main, 19 TestsEmpty, 26 TestsRunning and 29 EmptyStates (its C8 and C15 states), and WfBar. They were approved on 2026-10-26. If the controller reports a later change to one of them, apply it to this task's text before starting.

This matches boards 1, 19, 26, 29 and WfBar without the [P3+] parts, plus C1, C8, C11, C14, C15, G4, G13, G18 and G19. The example editor is Task 11.

**Files:**
- Create:
  - `ui/public/workflows/test-ui.mjs` (shared helpers)
  - `ui/public/workflows/tests-view.mjs`
- Modify `ui/public/index.html`: the Tests tab in `#wfv-pages` (:1503–1506) and the `#wfv-tests` page after `#wfv-versions` (:1487).
- Modify `ui/public/app.js`:
  - the imports, beside `./workflows/version-dialogs.mjs` (:215)
  - `wfvEls` (:3286)
  - `wfvRefreshVersions` (:3437)
  - `wfvShowPage` (:3461)
  - the ⌘Z capture (:3590)
  - `routeWorkflows` (:3714, the `openTemplate(full)` line)
  - a new `wft*` controller after `wfvRestoreRefusal`
- Modify `ui/public/style.css`: the `.wft-*` rules, right after Part 1's line `@media (max-width:700px){.wfv-vt-draft,.wfv-vt-row{…}}` (:8600).
- Modify `test/ui-shared-controls.test.mjs`: one `JS_CHECKBOX_OK` row (the first-use picks).
- Test:
  - Create `test/ui-workflow-tests-view.test.mjs`.
  - Extend `test/ui-workflows-markup.test.mjs`.

**Interfaces:**
- Consumes: Task 9's overview shape; `fmtUsd` (Task 1); `agoText`, `countsText` (Task 8); `icon` (`ui/public/icons.mjs`).
- Produces:
  - `test-ui.mjs`:
    - `el(doc, tag, cls, text)`, `btn(doc, label, onClick, cls)`, `iconBtn(doc, name, label, onClick, cls?, size?)` (an icon from icons.mjs; `label` is its `aria-label`)
    - `seg(doc, label, [[value, text]], value, onPick)`, `field(doc, label, control, { id?, hint?, opt? })`, `card(doc, title, id, hint, cls?)`
    - `testDialog({ doc, win, title, body, confirmLabel, onConfirm, onRemove?, width? })` → the dialog layer, plus `okButton` and `errorLine`
    - `sentence(s)` → "The name must be …."
    - `BUSY_HINT = 'A test of this workflow is running. Wait for it, or stop it first.'` (G19, the same sentence as the server's `BUSY_TEXT`)
  - `tests-view.mjs`: `HOW_HIDDEN_KEY`, `exampleHint(e, { dateText })`, `cellView(doc, cell)`, and `renderTestsPage(root, overview|null, actions, { doc, storage?, loading?, error?, dateText?, now? })`, where `actions = { newExample, addFromRun, testVersion, openExample(id), exampleMenu(anchor, e), openRun(runId), openLatest(runId), addPastRuns(pipelineIds) }`. While `overview.running` is set, "Test a version" is disabled and `#wft-busy` says `BUSY_HINT`.
  - DOM ids: `#wfv-page-tests` (the tab), `#wfv-tests` (the page), `#wft-busy`
  - app.js:
    - `wft` state; `wftRefresh()`, `wftRender()`, `wftShow(view, extra)`, `wftCall(method, path, body) → { ok, data } | { ok:false, status, error }`, `wftDeleteExample(e)`
    - temporary bodies, each replaced by the task named in its comment: `wftOpenExample(id|null)` and `wftRenderEditor(root)` (Task 11), `wftPickRun()` (Task 12), `wftTestVersion()`, `wftReadView()` and `wftRenderView()` (Task 13, then Task 14)

- [ ] **Step 1: Write the failing view test.** Create `test/ui-workflow-tests-view.test.mjs`:

```js
// test/ui-workflow-tests-view.test.mjs — the Tests page (canvas boards 1, 19, 26 and 29; C1, C8, C11, C14, G4, G13, G19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTestsPage, exampleHint, HOW_HIDDEN_KEY } from '../ui/public/workflows/tests-view.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent.trim());
const NOW = Date.parse('2026-10-26T12:00:00Z');
const dateText = () => '14 Oct';
const overview = (over = {}) => ({
  workflowId: 'wf_b', name: 'Product brief writer', testable: true, reason: null, ctx: { liveVersionNo: 4, latestVersionNo: 4 },
  columns: [{ use: 4, label: 'v4 · the team uses it' }, { use: 'draft', label: 'v5 draft · yours' }],
  examples: [
    { id: 1, name: 'Bulk invoice export', hasRequest: true, files: ['interviews-q3.md', 'support-tickets.csv'], fromAt: '2026-10-14T10:00:00Z', note: null,
      tries: 3, basics: 3, checks: 2, cells: { 4: { passed: 3, total: 3, stale: false, past: null }, draft: { passed: 1, total: 3, stale: false, past: null } } },
    { id: 2, name: 'Unclear request: "dark mode please"', hasRequest: true, files: [], fromAt: null, note: 'Worca should ask before writing',
      tries: 3, basics: 2, checks: 0, cells: { 4: { passed: 1, total: 3, stale: true, past: null }, draft: null } },
    { id: 3, name: 'Saved filters', hasRequest: false, files: ['usage.csv'], fromAt: null, note: null,
      tries: 3, basics: 2, checks: 0, cells: { 4: { passed: null, total: null, stale: false, past: 'not-good' }, draft: { passed: 0, total: 3, stale: false, past: null } } },
  ],
  running: null,
  latest: { runId: 7, title: 'Latest test: your v5 draft compared with v4', finishedAt: '2026-10-26T10:00:00Z', examples: 6, tries: 3, costUsd: 10.26,
    counts: { better: 2, worse: 1, same: 3 }, status: 'done', stopReason: null },
  pastRuns: [],
  ...over,
});
function boot(o, { storage = null, loading = false, error = null } = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const actions = new Proxy({}, { get: (_t, name) => (...args) => calls.push([name, ...args]) });
  const root = window.document.getElementById('root');
  renderTestsPage(root, o, actions, { doc: window.document, storage, loading, error, dateText, now: NOW });
  return { root, calls, doc: window.document };
}
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('the list: subtitle, the three buttons, How testing works, the latest test', () => {
  const { root, calls } = boot(overview());
  assert.equal(root.querySelector('.wft-head .subtitle').textContent, 'Test examples show what this workflow must do well. Before you share a change, try it on the examples and see what got better or worse.');
  assert.deepEqual(texts(root, '.wft-head .wft-acts button'), ['Add from a past run', 'New example', 'Test a version']);
  assert.ok(root.querySelector('.wft-head .wft-acts button.btn-primary').textContent === 'Test a version');
  assert.deepEqual(texts(root, '.wft-how .wft-step b'), ['Collect examples', 'Say what a good result needs', 'Test a new version']);
  assert.deepEqual(texts(root, '.wft-how .wft-step > div > span'), [
    'Real requests this workflow gets. Add one from a past run, or write one.',
    'Pick the Basics it must meet and add automatic checks, for example "has the sections Problem and Risks".',
    'Worca tries every example 3 times and shows what got better or worse.',
  ]);
  const latest = root.querySelector('.wft-latest');
  assert.equal(latest.querySelector('.wft-latest-title').textContent, 'Latest test: your v5 draft compared with v4');
  assert.equal(latest.querySelector('.hint').textContent, '2 hours ago · 6 examples, 3 tries each · cost $10.26');
  assert.deepEqual(texts(latest, '.badge'), ['2 better', '1 worse', '3 same']);
  assert.deepEqual([...latest.querySelectorAll('.badge')].map((b) => b.className), ['badge green', 'badge red', 'badge']);
  click(latest);
  for (const b of root.querySelectorAll('.wft-head .wft-acts button')) click(b);
  assert.deepEqual(calls.map((c) => c[0]), ['openLatest', 'addFromRun', 'newExample', 'testVersion']);
  assert.equal(calls[0][1], 7);
  assert.match(root.querySelector('.wft-foot').textContent, /^Why 3 tries\? AI can give a different answer each time, so one good try can be luck\. A try passes when everything checked is met\.$/);
});

test('the examples table: columns, hints, what is checked, results with dots, the ⋯ menu', () => {
  const { root, calls } = boot(overview());
  assert.deepEqual(texts(root, '.wft-row-head > span'), ['Example', 'What is checked', 'v4 · the team uses it', 'v5 draft · yours', '']);
  const rows = [...root.querySelectorAll('.wft-row:not(.wft-row-head)')];
  assert.deepEqual(rows.map((r) => r.querySelector('.wft-ex .hint').textContent), [
    'Request + interviews-q3.md, support-tickets.csv · from a run on 14 Oct',
    'Request only · Worca should ask before writing',
    'No request yet',
  ]);
  assert.deepEqual(rows.map((r) => texts(r, '.wft-kind')), [['Basics 3', 'Automatic 2'], ['Basics 2'], ['Basics 2']]);
  assert.deepEqual(rows.map((r) => texts(r, '.wft-res')), [
    ['3 of 3 passed', '1 of 3 passed'],
    ['1 of 3 passed · before a change', 'Not tried'],
    ['Not good · a past run', '0 of 3 passed'],
  ]);
  assert.deepEqual([...rows[0].querySelectorAll('.wft-dot')].map((d) => d.className), ['wft-dot ok', 'wft-dot mix']);
  assert.ok(rows[2].querySelectorAll('.wft-res')[1].classList.contains('is-bad'));
  click(rows[1].querySelector('.wft-ex-open'));
  const more = rows[0].querySelector('.wft-more');
  assert.equal(more.getAttribute('aria-label'), 'More for Bulk invoice export');
  assert.deepEqual([more.textContent, !!more.querySelector('svg')], ['', true], 'an icon, not a glyph (design system)');
  click(more);
  assert.deepEqual([calls[0], calls[1][0], calls[1][2].id], [['openExample', 2], 'exampleMenu', 1]);
});

test('How testing works hides for good when the storage works, and never breaks when it does not', () => {
  const store = memory();
  const a = boot(overview(), { storage: store });
  click([...a.root.querySelectorAll('.wft-how button')].find((b) => b.textContent === 'Hide'));
  assert.equal(a.root.querySelector('.wft-how'), null);
  assert.equal(store.m.get(HOW_HIDDEN_KEY), '1');
  assert.equal(boot(overview(), { storage: store }).root.querySelector('.wft-how'), null);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const b = boot(overview(), { storage: broken });
  assert.ok(b.root.querySelector('.wft-how'));
  click([...b.root.querySelectorAll('.wft-how button')].find((x) => x.textContent === 'Hide'));
  assert.equal(b.root.querySelector('.wft-how'), null);
});

test('a running test shows above the latest one (G13), and no second test can start (G19, board 26)', () => {
  const { root, calls } = boot(overview({ running: { runId: 9, title: 'Testing your v5 draft', done: 7, total: 18 } }));
  const testBtn = root.querySelector('.wft-head .wft-acts button.btn-primary');
  assert.deepEqual([testBtn.textContent, testBtn.disabled, testBtn.getAttribute('aria-describedby')], ['Test a version', true, 'wft-busy']);
  assert.equal(root.querySelector('#wft-busy').textContent, 'A test of this workflow is running. Wait for it, or stop it first.');
  const card = root.querySelector('.wft-running');
  assert.equal(card.querySelector('.wft-latest-title').textContent, 'Testing your v5 draft · 7 of 18 tries done');
  assert.equal(card.querySelector('.wft-link').textContent, 'See progress');
  click(card);
  assert.deepEqual(calls, [['openRun', 9]]);
});

test('first use: past runs to start from, ticked newest first, then Add N examples (board 19, C11, G4)', () => {
  const runs = [
    { pipelineId: 'p1', title: 'Bulk invoice export', at: '2026-10-14T10:00:00Z', status: 'done', files: 2, sameAs: null },
    { pipelineId: 'p2', title: 'Saved filters for reports', at: '2026-10-14T09:00:00Z', status: 'error', files: 1, sameAs: null },
    { pipelineId: 'p3', title: 'Offline mode', at: '2026-10-09T09:00:00Z', status: 'stopped', files: 0, sameAs: null },
    { pipelineId: 'p4', title: 'Export to PDF, again', at: '2026-10-08T09:00:00Z', status: 'done', files: 0, sameAs: 'Bulk invoice export' },
  ];
  const { root, calls } = boot(overview({ examples: [], latest: null, pastRuns: runs }));
  assert.equal(root.querySelector('.wft-title').textContent, 'Test this workflow before you change it');
  assert.equal(root.querySelector('.wft-first-head .subtitle').textContent, 'Test examples are real requests with a note on what a good result needs. Once you have a few, every change can be tried on them, so you see what got better or worse before your team does.');
  assert.equal(texts(root, '.wft-how .wft-step > div > span')[0], 'Real requests this workflow gets. Start below with past runs.');
  assert.equal(root.querySelectorAll('.wft-how button').length, 0, 'no Hide on first use');
  assert.equal(root.querySelector('.wft-pick > .hint').textContent, 'Worca found 4 recent runs of Product brief writer. Pick different kinds of requests, and include ones where the result was not good: they show what must improve.');
  const rows = [...root.querySelectorAll('.wft-pick-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.wft-pick-text').textContent), [
    'Bulk invoice export · 14 Oct · 2 files', 'Saved filters for reports · 14 Oct · 1 file', 'Offline mode · 14 Oct',
    'Export to PDF, again · 14 Oct · the same request as "Bulk invoice export"']);
  assert.deepEqual(rows.map((r) => r.querySelector('.badge').textContent), ['Finished', 'Failed', 'Stopped', 'Same request as another']);
  assert.deepEqual(rows.map((r) => r.querySelector('input').checked), [true, true, true, false]);
  assert.ok(rows.every((r) => r.querySelector('input').classList.contains('wft-pick-box')), 'the listed picker token (ui-shared-controls)');
  const add = root.querySelector('.wft-first-foot .btn-primary');
  assert.equal(add.textContent, 'Add 3 examples');
  const box = rows[1].querySelector('input');
  box.checked = false; box.dispatchEvent(new box.ownerDocument.defaultView.Event('change'));
  assert.equal(add.textContent, 'Add 2 examples');
  click(add);
  click(root.querySelector('.wft-first-foot .wft-linkbtn'));
  assert.deepEqual(calls, [['addPastRuns', ['p1', 'p3']], ['newExample']]);
  assert.equal(root.querySelector('.wft-first-foot .hint').textContent, '3 to 10 examples are a good start. You add what a good result needs in the next step. Or write an example yourself');
});

test('a workflow that needs a project, loading and errors (D20, C8)', () => {
  const np = boot(overview({ testable: false, reason: 'needs-project' }));
  assert.deepEqual(texts(np.root, '.wft-not-testable h2, .wft-not-testable p'), ['Tests are for workflows without a project, for now',
    "This workflow works on a project's code. Worca can test workflows that run without a project today; testing workflows that change a project comes next."]);
  assert.equal(boot(null, { loading: true }).root.textContent, 'Reading the tests…');
  assert.match(boot(null, { error: 'Save the workflow first: tests belong to a saved workflow.' }).root.textContent, /Save the workflow first: tests belong to a saved workflow\./);
  assert.equal(exampleHint({ hasRequest: true, files: [], fromAt: null, note: null }), 'Request only');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-tests-view.test.mjs`
Expected: FAIL with `Cannot find module '../ui/public/workflows/tests-view.mjs'`.

- [ ] **Step 3: Implement `ui/public/workflows/test-ui.mjs`**

```js
// ui/public/workflows/test-ui.mjs — the small DOM helpers the workflow tests views share (plans/workflow-tests-part2-plan.md
// Task 10). textContent only; dialogs on the shared createDialog layout (marketplace/layers.mjs).
import { createDialog } from '../marketplace/layers.mjs';
import { icon } from '../icons.mjs';

/** G19, D37: the hint beside a start button while a test of the workflow runs (the server's BUSY_TEXT). */
export const BUSY_HINT = 'A test of this workflow is running. Wait for it, or stop it first.';

export const el = (doc, tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export const btn = (doc, label, onClick, cls = 'btn btn-sm') => {
  const b = el(doc, 'button', cls, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

/** A button that is only an icon from icons.mjs, never a glyph (docs/design-system.md › Icons). `label` is its aria-label. */
export const iconBtn = (doc, name, label, onClick, cls = 'btn btn-sm btn-quiet btn-icon', size = 16) => {
  const b = btn(doc, null, onClick, cls);
  b.setAttribute('aria-label', label);
  b.append(icon(doc, name, size));
  return b;
};

/** A server reason as a sentence: "the name must be …" → "The name must be ….". */
export const sentence = (s) => {
  const t = String(s || '').trim();
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}` : t;
};

/** A .seg radio group. options = [[value, text]]; onPick(value) gets the value as given. */
export function seg(doc, label, options, value, onPick) {
  const g = el(doc, 'div', 'seg');
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', label);
  const paint = (v) => {
    for (const b of g.children) {
      const on = b.dataset.value === String(v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  };
  for (const [v, text] of options) {
    const b = btn(doc, text, () => { paint(v); onPick(v); }, '');
    b.setAttribute('role', 'radio');
    b.dataset.value = String(v);
    g.append(b);
  }
  paint(value);
  return g;
}

/** A .field: a <label for> when the control has an id, else a span for a group; an optional "opt" word and hint. */
export function field(doc, label, control, { id = null, hint = null, opt = null } = {}) {
  const f = el(doc, 'div', 'field');
  const l = el(doc, id ? 'label' : 'span', 'label', label);
  if (id) l.htmlFor = id;
  if (opt) l.append(el(doc, 'span', 'opt', ` ${opt}`));
  f.append(l, control);
  if (hint) f.append(el(doc, 'span', 'hint', hint));
  return f;
}

/** A card with its own heading (aria-labelledby) and hint. */
export function card(doc, title, id, hint = null, cls = '') {
  const c = el(doc, 'section', `card wft-card${cls ? ` ${cls}` : ''}`);
  const h = el(doc, 'h2', '', title);
  h.id = id;
  c.setAttribute('aria-labelledby', id);
  c.append(h);
  if (hint) c.append(el(doc, 'p', 'hint', hint));
  return c;
}

/**
 * A dialog on the shared layout: title, body, an error line, [Remove], Cancel and the confirming button.
 * onConfirm() → {ok, error?} (or a promise of it); the dialog closes on ok and shows the error otherwise.
 */
export function testDialog({ doc, win, title, body, confirmLabel, onConfirm, onRemove = null, width = 'md' }) {
  const dlg = createDialog({ doc, win, width });
  const h = el(doc, 'h2', 'mk-dialog-title', title);
  h.id = 'mk-dialog-title';
  const error = el(doc, 'p', 'hint err wft-dlg-error');
  error.setAttribute('aria-live', 'polite');
  const foot = [];
  if (onRemove) foot.push(btn(doc, 'Remove', () => { onRemove(); dlg.close(); }, 'btn btn-danger wft-dlg-remove'));
  foot.push(btn(doc, 'Cancel', () => dlg.close(), 'btn'));
  const ok = btn(doc, confirmLabel, async () => {
    error.textContent = '';
    ok.disabled = true;
    dlg.setBusy(true);
    let res;
    try { res = await onConfirm(); } catch (e) { res = { ok: false, error: e && e.message ? e.message : String(e) }; }
    dlg.setBusy(false);
    ok.disabled = false;
    if (res && res.ok) dlg.close(); else error.textContent = (res && res.error) || 'That did not work. Try again.';
  }, 'btn btn-primary wft-dlg-ok');
  foot.push(ok);
  dlg.replace({ head: [h], body: [...body, error], foot });
  dlg.open();
  return Object.assign(dlg, { okButton: ok, errorLine: error });
}
```

- [ ] **Step 4: Implement `ui/public/workflows/tests-view.mjs`**

```js
// ui/public/workflows/tests-view.mjs — the Tests page of a workflow (plans/workflow-tests-part2-plan.md Task 10): the list
// of examples (canvas board 1), first use (board 19) and the sentence for a workflow that needs a project (D20, C8).
// Pure DOM: app.js owns data and actions.
import { el, btn, iconBtn, BUSY_HINT } from './test-ui.mjs';
import { fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { agoText, countsText } from '../../../src/shared/workflow-tests/compare.mjs';

export const HOW_HIDDEN_KEY = 'worca.workflowTests.howHidden';
const HOW = Object.freeze({
  collect: 'Real requests this workflow gets. Add one from a past run, or write one.',
  collectFirst: 'Real requests this workflow gets. Start below with past runs.',
  needs: 'Pick the Basics it must meet and add automatic checks, for example "has the sections Problem and Risks".',   // C1
  test: 'Worca tries every example 3 times and shows what got better or worse.',
});
const defaultDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const howHidden = (storage) => { try { return !!storage && storage.getItem(HOW_HIDDEN_KEY) === '1'; } catch { return false; } };
const hideHow = (storage) => { try { if (storage) storage.setItem(HOW_HIDDEN_KEY, '1'); } catch { /* blocked storage: it shows again next time */ } };

function howCard(doc, { first, onHide }) {
  const c = el(doc, 'section', 'card wft-how');
  const head = el(doc, 'div', 'wft-how-head');
  const h = el(doc, 'h2', '', 'How testing works');
  h.id = 'wft-how-h';
  c.setAttribute('aria-labelledby', h.id);
  head.append(h);
  if (onHide) head.append(btn(doc, 'Hide', onHide));
  const steps = el(doc, 'div', 'wft-steps');
  [['Collect examples', first ? HOW.collectFirst : HOW.collect], ['Say what a good result needs', HOW.needs], ['Test a new version', HOW.test]]
    .forEach(([bold, text], i) => {
      const st = el(doc, 'div', 'wft-step');
      const words = el(doc, 'div');
      words.append(el(doc, 'b', '', bold), el(doc, 'span', '', text));
      st.append(el(doc, 'span', 'wft-step-dot', String(i + 1)), words);   // a round mark: `-dot` (the radius rule's ROUND)
      steps.append(st);
    });
  c.append(head, steps);
  return c;
}

/** The hint under an example's name: what it has, where it came from, its note. */
export function exampleHint(e, { dateText = defaultDate } = {}) {
  const parts = [!e.hasRequest ? 'No request yet' : e.files && e.files.length ? `Request + ${e.files.join(', ')}` : 'Request only'];
  if (e.hasRequest && e.fromAt) parts.push(`from a run on ${dateText(e.fromAt)}`);
  if (e.hasRequest && e.note) parts.push(e.note);
  return parts.join(' · ');
}

/** A result cell (C14): "3 of 3 passed" with a dot (green all, grey some, red none), a past verdict (D29), "Not tried". */
export function cellView(doc, cell) {
  const span = el(doc, 'span', 'wft-res');
  if (!cell) { span.classList.add('is-none'); span.textContent = 'Not tried'; return span; }
  const dot = (tone) => { const d = el(doc, 'span', `wft-dot ${tone}`); d.setAttribute('aria-hidden', 'true'); return d; };
  if (cell.past) {
    span.append(dot(cell.past === 'good' ? 'ok' : 'no'), doc.createTextNode(cell.past === 'good' ? 'Good · a past run' : 'Not good · a past run'));
    return span;
  }
  const tone = cell.passed === cell.total ? 'ok' : cell.passed === 0 ? 'no' : 'mix';
  if (tone === 'no') span.classList.add('is-bad');
  if (cell.stale) span.classList.add('is-stale');
  span.append(dot(tone), doc.createTextNode(`${cell.passed} of ${cell.total} passed${cell.stale ? ' · before a change' : ''}`));
  return span;
}

function latestCard(doc, l, actions, now) {
  const c = btn(doc, null, () => actions.openLatest(l.runId), 'card wft-latest');
  const main = el(doc, 'span', 'wft-latest-main');
  main.append(el(doc, 'span', 'wft-latest-title', l.title),
    el(doc, 'span', 'hint', `${agoText(l.finishedAt, now)} · ${countsText(l.examples, l.tries)} · cost ${fmtUsd(l.costUsd)}`));
  const badges = el(doc, 'span', 'wft-badges');
  badges.append(el(doc, 'span', 'badge green', `${l.counts.better} better`), el(doc, 'span', 'badge red', `${l.counts.worse} worse`),
    el(doc, 'span', 'badge', `${l.counts.same} same`));
  if (l.status === 'stopped') badges.append(el(doc, 'span', 'badge', 'Stopped early'));
  c.append(main, badges, el(doc, 'span', 'wft-link', 'See what changed'));
  return c;
}

function table(doc, o, actions, dateText) {
  const sec = el(doc, 'section', 'card wft-table');
  sec.setAttribute('aria-label', 'Test examples');
  const scroll = el(doc, 'div', 'wft-scroll');
  const grid = el(doc, 'div', `wft-grid${o.columns.length === 1 ? ' is-one' : ''}`);
  const head = el(doc, 'div', 'wft-row wft-row-head');
  head.append(el(doc, 'span', '', 'Example'), el(doc, 'span', '', 'What is checked'), ...o.columns.map((c) => el(doc, 'span', '', c.label)), el(doc, 'span', ''));
  grid.append(head);
  for (const e of o.examples) {
    const row = el(doc, 'div', 'wft-row');
    const name = el(doc, 'span', 'wft-ex');
    name.append(btn(doc, e.name, () => actions.openExample(e.id), 'wft-ex-open'), el(doc, 'span', 'hint', exampleHint(e, { dateText })));
    const kinds = el(doc, 'span', 'wft-kinds');
    kinds.append(el(doc, 'span', 'wft-kind', `Basics ${e.basics}`));
    if (e.checks) kinds.append(el(doc, 'span', 'wft-kind', `Automatic ${e.checks}`));
    const more = iconBtn(doc, 'more', `More for ${e.name}`, null, 'btn btn-sm btn-quiet btn-icon wft-more');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => actions.exampleMenu(more, e));
    row.append(name, kinds, ...o.columns.map((c) => cellView(doc, e.cells[String(c.use)] || null)), more);
    grid.append(row);
  }
  scroll.append(grid);
  sec.append(scroll);
  return sec;
}

function list(doc, page, o, actions, { storage, dateText, now }) {
  const head = el(doc, 'div', 'wft-head');
  const acts = el(doc, 'div', 'wft-acts');
  const testBtn = btn(doc, 'Test a version', () => actions.testVersion(), 'btn btn-primary');
  acts.append(btn(doc, 'Add from a past run', () => actions.addFromRun(), 'btn'), btn(doc, 'New example', () => actions.newExample(), 'btn'), testBtn);
  head.append(el(doc, 'p', 'subtitle', 'Test examples show what this workflow must do well. Before you share a change, try it on the examples and see what got better or worse.'), acts);
  if (o.running) {   // G19, D37: one test per workflow at a time
    testBtn.disabled = true;
    testBtn.setAttribute('aria-describedby', 'wft-busy');
    const busy = el(doc, 'p', 'hint wft-busy', BUSY_HINT);
    busy.id = 'wft-busy';
    head.append(busy);
  }
  page.append(head);
  if (!howHidden(storage)) {
    const how = howCard(doc, { first: false, onHide: () => { hideHow(storage); how.remove(); } });
    page.append(how);
  }
  if (o.running) {
    const r = btn(doc, null, () => actions.openRun(o.running.runId), 'card wft-latest wft-running');
    const main = el(doc, 'span', 'wft-latest-main');
    main.append(el(doc, 'span', 'wft-latest-title', `${o.running.title} · ${o.running.done} of ${o.running.total} tries done`),
      el(doc, 'span', 'hint', 'Worca tells you when the results are ready.'));
    r.append(main, el(doc, 'span', 'wft-link', 'See progress'));
    page.append(r);
  }
  if (o.latest) page.append(latestCard(doc, o.latest, actions, now));
  page.append(table(doc, o, actions, dateText));
  const foot = el(doc, 'p', 'hint wft-foot');
  foot.append(el(doc, 'b', '', 'Why 3 tries?'), doc.createTextNode(' AI can give a different answer each time, so one good try can be luck. A try passes when everything checked is met.'));
  page.append(foot);
}

function statusBadge(doc, r) {
  if (r.sameAs) return el(doc, 'span', 'badge', 'Same request as another');
  if (r.status === 'done') return el(doc, 'span', 'badge green', 'Finished');
  if (r.status === 'error') return el(doc, 'span', 'badge red', 'Failed');
  return el(doc, 'span', 'badge', 'Stopped');
}

function firstUse(doc, page, o, actions, { dateText }) {
  const head = el(doc, 'div', 'wft-first-head');
  head.append(el(doc, 'h2', 'wft-title', 'Test this workflow before you change it'),
    el(doc, 'p', 'subtitle', 'Test examples are real requests with a note on what a good result needs. Once you have a few, every change can be tried on them, so you see what got better or worse before your team does.'));
  page.append(head, howCard(doc, { first: true, onHide: null }));
  const pick = el(doc, 'section', 'card wft-pick');
  const h = el(doc, 'h2', '', 'Start with past runs');
  h.id = 'wft-pick-h';
  pick.setAttribute('aria-labelledby', h.id);
  const runs = o.pastRuns || [];
  pick.append(h, el(doc, 'p', 'hint', runs.length
    ? `Worca found ${runs.length} recent ${runs.length === 1 ? 'run' : 'runs'} of ${o.name}. Pick different kinds of requests, and include ones where the result was not good: they show what must improve.`
    : `Worca found no runs of ${o.name} without a project yet. Write an example yourself, or run the workflow once and come back.`));
  const boxes = [];
  let ticked = 0;
  for (const r of runs) {
    const row = el(doc, 'label', 'wft-pick-row');
    const box = el(doc, 'input', 'wft-pick-box');   // test/ui-shared-controls.test.mjs JS_CHECKBOX_OK: picks runs
    box.type = 'checkbox';
    box.value = r.pipelineId;
    box.checked = !r.sameAs && ticked < 3;
    if (box.checked) ticked += 1;
    const text = el(doc, 'span', 'wft-pick-text');
    const detail = [dateText(r.at), r.files ? (r.files === 1 ? '1 file' : `${r.files} files`) : null,
      r.sameAs ? `the same request as "${r.sameAs}"` : null].filter(Boolean).join(' · ');
    text.append(el(doc, 'b', '', r.title), el(doc, 'span', 'hint', ` · ${detail}`));
    row.append(box, text, statusBadge(doc, r));
    pick.append(row);
    boxes.push(box);
  }
  page.append(pick);
  const foot = el(doc, 'div', 'wft-first-foot');
  const hint = el(doc, 'span', 'hint');
  hint.append(doc.createTextNode('3 to 10 examples are a good start. You add what a good result needs in the next step. '),
    btn(doc, 'Or write an example yourself', () => actions.newExample(), 'wft-linkbtn'));
  const add = btn(doc, '', () => actions.addPastRuns(boxes.filter((b) => b.checked).map((b) => b.value)), 'btn btn-primary');
  const paint = () => {
    const n = boxes.filter((b) => b.checked).length;
    add.textContent = n === 1 ? 'Add 1 example' : `Add ${n} examples`;
    add.disabled = n === 0;
  };
  for (const b of boxes) b.addEventListener('change', paint);
  paint();
  foot.append(hint, add);
  page.append(foot);
}

/**
 * @param {HTMLElement} root
 * @param {object|null} o the overview (GET /api/workflows/:id/tests), null while loading or after an error
 * @param {object} actions see the Interfaces of Task 10
 */
export function renderTestsPage(root, o, actions, { doc, storage = null, loading = false, error = null, dateText = defaultDate, now = Date.now() } = {}) {
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page');
  if (!o && loading) {
    page.append(el(doc, 'p', 'hint', 'Reading the tests…'));
  } else if (!o) {
    const box = el(doc, 'div', 'card wft-empty');
    box.append(el(doc, 'h2', '', 'Tests are not available'), el(doc, 'p', 'hint', error || 'Worca did not answer.'));
    page.append(box);
  } else if (!o.testable) {
    const box = el(doc, 'div', 'card wft-empty wft-not-testable');
    box.append(el(doc, 'h2', '', 'Tests are for workflows without a project, for now'),
      el(doc, 'p', 'hint', "This workflow works on a project's code. Worca can test workflows that run without a project today; testing workflows that change a project comes next."));
    page.append(box);
  } else if (!o.examples.length) {
    firstUse(doc, page, o, actions, { dateText });
  } else {
    list(doc, page, o, actions, { storage, dateText, now });
  }
  root.append(page);
}
```

- [ ] **Step 5: Run the view test**

Run: `node tools/test.mjs test/ui-workflow-tests-view.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 6: Markup in `ui/public/index.html`**

In `#wfv-pages`, between the Canvas and the Versions buttons, add:
```html
                    <button type="button" role="tab" aria-selected="false" id="wfv-page-tests" aria-controls="wfv-tests" data-page="tests">Tests</button>
```
Right after the `#wfv-versions` section, add:
```html
              <section class="wfv-versions wfv-tests" id="wfv-tests" role="tabpanel" aria-labelledby="wfv-page-tests" tabindex="-1" data-flag="workflowTests" data-canvas-keys="off" hidden></section>
```
It reuses `.wfv-versions`' stage placement, and its rule that hides the dock and the bottom-right tools while a page shows.

Update `test/ui-workflows-markup.test.mjs`:
- In the "top bar" test, the expected id list becomes `['wfv-back', 'wfv-wf-menu', 'wfv-name', 'wfv-page-canvas', 'wfv-page-tests', 'wfv-page-versions', 'wfv-errors', 'wfv-import-file']`.
- In the "versions" test, the two lists become `['Canvas', 'Tests', 'Versions']` and `['canvas', 'tests', 'versions']`.
- Add this test:
```js
test('tests (flag workflowTests, Part 2): the Tests page sits on the stage like the Versions page', () => {
  const page = doc.getElementById('wfv-tests');
  assert.ok(page, '#wfv-tests');
  assert.ok(page.hidden);
  assert.equal(page.dataset.flag, 'workflowTests');
  assert.equal(page.parentElement.id, 'wfv-stage');
  assert.equal(page.dataset.canvasKeys, 'off');
  assert.equal(page.getAttribute('tabindex'), '-1');
  assert.equal(page.getAttribute('role'), 'tabpanel');
  assert.equal(page.getAttribute('aria-labelledby'), 'wfv-page-tests');
  assert.ok(page.classList.contains('wfv-versions'), 'shares the page placement and the dock rule');
  assert.equal(doc.getElementById('wfv-page-tests').getAttribute('aria-controls'), 'wfv-tests');
});
```

- [ ] **Step 7: Styles in `ui/public/style.css`** (right after Part 1's `@media (max-width:700px){.wfv-vt-draft,…}` line; tokens only, type steps and radius tokens only: Global Constraints › UI follows docs/design-system.md)

```css
/* Workflow tests (plans/workflow-tests-part2-plan.md; canvas boards 1, 19, 26, 29). The Tests page shares .wfv-versions' placement. */
.wft-page{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:20px;}
.wft-head,.wft-crumbs{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;}
.wft-head .subtitle{margin:0;color:var(--ink-2);max-width:560px;}
.wft-acts{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
.wft-busy{margin:0;flex:1 1 100%;text-align:right;}
.wft-crumbs-left{display:flex;flex-wrap:wrap;align-items:center;gap:10px;min-width:0;}
.wft-crumb{border:0;background:transparent;padding:0;color:var(--blue-ink-strong);font:inherit;cursor:pointer;}
.wft-crumb:hover{color:var(--ink);}
.wft-crumb::after{content:'/';margin-left:10px;color:var(--ink-2);}
.wft-title{margin:0;font-size:var(--fs-subpage);}
.wft-how{padding:18px 22px;}
.wft-how-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;}
.wft-how h2,.wft-pick h2,.wft-empty h2{margin:0;font-size:var(--fs-section);}
.wft-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;}
.wft-step{display:flex;gap:12px;align-items:flex-start;}
.wft-step-dot{flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:var(--ink);color:var(--on-ink);font-size:var(--fs-meta);font-weight:700;display:inline-flex;align-items:center;justify-content:center;}
.wft-step b{display:block;font-weight:600;font-size:var(--fs-body);margin-bottom:2px;}
.wft-step > div > span{font-size:var(--fs-meta);color:var(--ink-2);line-height:1.45;}
.wft-latest{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;padding:16px 20px;text-align:left;font:inherit;color:var(--ink);cursor:pointer;}
.wft-latest-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 320px;}
.wft-latest-title{font-weight:600;}
.wft-latest .hint{margin:0;}
.wft-badges{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.wft-link{font-size:var(--fs-body);font-weight:600;color:var(--blue-ink-strong);}
.wft-table{padding:0;overflow:hidden;}
.wft-scroll{overflow-x:auto;}
.wft-row{display:grid;grid-template-columns:minmax(0,1fr) 200px 130px 130px 40px;align-items:center;gap:16px;padding:14px 18px;border-bottom:1px solid var(--line);min-width:760px;box-sizing:border-box;}
.wft-grid.is-one .wft-row{grid-template-columns:minmax(0,1fr) 200px 130px 40px;min-width:600px;}
.wft-row:last-child{border-bottom:0;}
.wft-row-head{padding:10px 18px;font-size:var(--fs-caption);font-weight:600;color:var(--ink-2);}
.wft-ex{display:flex;flex-direction:column;gap:2px;min-width:0;}
.wft-ex .hint{margin:0;}
.wft-ex-open{border:0;background:transparent;padding:0;text-align:left;font:inherit;font-weight:500;color:var(--ink);cursor:pointer;}
.wft-ex-open:hover{text-decoration:underline;}
.wft-kinds{display:flex;flex-wrap:wrap;gap:6px;}
.wft-kind{background:var(--field);color:var(--ink-2);font-size:var(--fs-caption);font-weight:600;padding:3px 9px;border-radius:var(--r-xs);white-space:nowrap;}
.wft-res{display:inline-flex;align-items:center;gap:7px;font-size:var(--fs-meta);color:var(--ink);}
.wft-res.is-bad{color:var(--red-ink-strong);}
.wft-res.is-stale,.wft-res.is-none{color:var(--ink-2);}
.wft-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}
.wft-dot.ok{background:var(--green);}
.wft-dot.mix{background:var(--seq);}
.wft-dot.no{background:var(--red);}
.wft-foot{margin:0;}
.wft-foot b{font-weight:600;color:var(--ink);}
.wft-first-head .subtitle{margin:6px 0 0;color:var(--ink-2);max-width:640px;}
.wft-pick{display:flex;flex-direction:column;gap:6px;}
.wft-pick-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line);font-size:var(--fs-body);}
.wft-pick-row input{width:16px;height:16px;accent-color:var(--ink);margin:0;}
.wft-pick-text{flex:1 1 auto;min-width:0;}
.wft-pick-text .hint{display:inline;margin:0;}
.wft-first-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;}
.wft-first-foot .hint{margin:0;}
.wft-linkbtn{border:0;background:transparent;padding:0;font:inherit;color:var(--blue-ink-strong);cursor:pointer;text-decoration:underline;}
.wft-empty{display:flex;flex-direction:column;gap:6px;}
.wft-dlg-error:empty{display:none;}
@media (max-width:900px){.wft-steps{grid-template-columns:minmax(0,1fr);}}
```
`.wft-step > div > span`, not `.wft-step span`: the step's number is a span too, and `.wft-step span` would turn it --ink-2 on its ink circle.

- [ ] **Step 8: Wire it in `ui/public/app.js`**

Imports, beside `./workflows/version-dialogs.mjs` (:215):
```js
import { renderTestsPage } from './workflows/tests-view.mjs';
import { sentence as wftSentence } from './workflows/test-ui.mjs';
```

In `wfvEls()`, add `tests: g('wfv-tests'),` after `versions: g('wfv-versions'),`.

At the end of `wfvRefreshVersions`, before `return wfvVersionsOverview;`, add:
```js
  if (els.tests && !els.tests.hidden) void wftRefresh();   // another workflow, or a save: the Tests page follows
```
In `wfvShowPage`, after `if (els.versions) els.versions.hidden = page !== 'versions';`, add:
```js
  if (els.tests) els.tests.hidden = page !== 'tests';
  if (page === 'tests') {
    gvComposer?.select(null);
    els.tests?.focus();
    wft.view = 'list';
    void wftRefresh();
    return;
  }
```
In the ⌘Z capture, replace the two lines that read `#wfv-versions` with:
```js
  const page = ['wfv-versions', 'wfv-tests'].map((x) => document.getElementById(x)).find((p) => p && !p.hidden && !p.closest('.view.hidden'));
  if (!page) return;                                                    // the Workflows view, its Versions or Tests page shown
```
In `routeWorkflows`, replace `if (await gvComposer.openTemplate(full)) gvComposer.fit();` with:
```js
  if (await gvComposer.openTemplate(full)) {
    gvComposer.fit();
    // Workflow tests: #workflows/<id>/tests[/<example>|/run/<test>] (Use as test example, the results-ready toast).
    const m = /^tests(?:\/(\d+)|\/run\/(\d+))?$/.exec(sub);
    if (m && flagOn('workflowTests')) {
      wfvShowPage('tests');
      if (m[1]) void wftOpenExample(Number(m[1]));
      else if (m[2]) wftShow('progress', { runId: Number(m[2]) });
    }
  }
```
After `wfvRestoreRefusal`, add the controller:
```js
// Workflow tests (plans/workflow-tests-part2-plan.md): the Tests page. Task 10 is the list and first use; Task 11 adds the
// example editor, Task 12 Add from a past run, Task 13 Test a version and the progress page, Task 14 Compare and side by side.
const WFT_EMPTY = Object.freeze({ view: 'list', workflowId: null, overview: null, error: null, example: null, runId: null,
  exampleId: null, tryIndex: 0, data: null, scripts: [], perTryUsd: null });
let wft = { ...WFT_EMPTY };
const wftBase = (id) => `/api/workflows/${encodeURIComponent(id)}/tests`;
/** {ok, data} | {ok:false, status, error} (the server's reason as a sentence); never throws. */
async function wftCall(method, path, body) {
  try {
    const res = await fetch(path, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const d = await safeJson(res);
    return res.ok ? { ok: true, data: d } : { ok: false, status: res.status, error: wftSentence((d && d.error) || `That did not work (${res.status})`) };
  } catch (e) { return { ok: false, status: 0, error: `Worca did not answer (${e.message}).` }; }
}
const wftWorkflowId = () => { const t = gvComposer && gvComposer.template(); return t && t.id ? t.id : null; };
const wftStorage = () => { try { return window.localStorage; } catch { return null; } };
const wftDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };

/** Read what the current view shows and paint it; never repaints over the editor. Never rejects. */
async function wftRefresh() {
  const els = wfvEls();
  if (!els.tests || els.tests.hidden) return;
  const id = wftWorkflowId();
  if (!flagOn('workflowTests') || !id) {
    wft = { ...WFT_EMPTY };
    renderTestsPage(els.tests, null, wftListActions(), { doc: document, error: 'Save the workflow first: tests belong to a saved workflow.' });   // C15
    return;
  }
  if (wft.workflowId !== id) wft = { ...WFT_EMPTY, workflowId: id };
  if (wft.view === 'editor') return;
  const view = wft.view;
  if (view === 'list' && !wft.overview) renderTestsPage(els.tests, null, wftListActions(), { doc: document, loading: true });
  const r = view === 'list' ? await wftCall('GET', wftBase(id)) : await wftReadView(id);
  if (wftWorkflowId() !== id || wft.view !== view) return;   // another workflow or view meanwhile
  if (view === 'list') wft.overview = r.ok ? r.data : null; else wft.data = r.ok ? r.data : null;
  wft.error = r.ok ? null : r.error;
  wftRender();
}
function wftReadView() { return Promise.resolve({ ok: false, error: 'This page comes in a later step.' }); }   // Task 13 replaces this body
function wftRenderView() { wft.view = 'list'; void wftRefresh(); }                                          // Task 13 replaces this body
function wftRender() {
  const els = wfvEls();
  if (!els.tests) return;
  if (wft.view === 'editor') { wftRenderEditor(els.tests); return; }
  if (wft.view !== 'list') { wftRenderView(els.tests); return; }
  renderTestsPage(els.tests, wft.overview, wftListActions(), { doc: document, storage: wftStorage(), error: wft.error, dateText: wftDate });
}
function wftShow(view, extra = {}) { wft = { ...wft, view, data: null, ...extra }; void wftRefresh(); }

function wftListActions() {
  return {
    newExample: () => void wftOpenExample(null),
    addFromRun: () => wftPickRun(),
    testVersion: () => void wftTestVersion(),
    openExample: (exampleId) => void wftOpenExample(exampleId),
    exampleMenu: (anchor, e) => toggleMenu({ doc: document, anchor, align: 'end', label: `More for ${e.name}`, items: [   // G18
      { label: 'Edit', onSelect: () => void wftOpenExample(e.id) },
      { label: 'Delete', danger: true, onSelect: () => void wftDeleteExample(e) },
    ] }),
    openRun: (runId) => wftShow('progress', { runId }),
    openLatest: (runId) => wftShow('compare', { runId }),
    addPastRuns: async (pipelineIds) => {
      const r = await wftCall('POST', `${wftBase(wftWorkflowId())}/examples/from-runs`, { pipelineIds });
      if (!r.ok) { notify({ tone: 'err', title: 'Examples not added', detail: r.error }); return; }
      const n = r.data.examples.length;
      notify({ tone: 'ok', title: n === 1 ? 'Added 1 example' : `Added ${n} examples`, detail: 'Open each to say what a good result needs.' });   // G4
      if (r.data.skipped.length) notify({ tone: 'info', title: 'Some files were left out', detail: `${r.data.skipped.join(', ')}: larger than 5 MB, or more than 8 files.` });
      wftShow('list', { overview: null });
    },
  };
}
function wftPickRun() { notify({ tone: 'info', title: 'Add from a past run', detail: 'Open a past run and pick Use as test example in its More menu.' }); }   // Task 12 replaces this body
function wftTestVersion() { notify({ tone: 'info', title: 'Test a version', detail: 'This comes in a later step.' }); }                                    // Task 13 replaces this body

// Task 11 replaces these two bodies with the example editor.
async function wftOpenExample() { notify({ tone: 'info', title: 'Examples', detail: 'The example editor comes in the next step.' }); }
function wftRenderEditor() { wft.view = 'list'; void wftRefresh(); }

async function wftDeleteExample(e) {
  const ok = await confirmModal({ title: `Delete "${e.name}"?`, confirmLabel: 'Delete', danger: true,
    message: 'Its request, files, answers and checks are removed. The tries already made stay in the tests they belong to.' });
  if (!ok) return;
  const r = await wftCall('DELETE', `${wftBase(wftWorkflowId())}/examples/${e.id}`);
  if (!r.ok) { notify({ tone: 'err', title: 'Not deleted', detail: r.error }); return; }
  wftShow('list', { overview: null });
}
```
`toggleMenu`, `notify`, `confirmModal`, `safeJson`, `gvApi`, `flagOn` are already in app.js scope.

- [ ] **Step 9: List the first-use picker's checkbox in `test/ui-shared-controls.test.mjs`**

A checkbox only picks items (docs/design-system.md › Switch): the first-use rows pick runs. In `JS_CHECKBOX_OK`, after the `['workflows/version-dialogs.mjs', 'wfv-sv-use', …]` row, add:
```js
  ['workflows/tests-view.mjs', 'wft-pick-box', 'picks runs: the past runs to keep as test examples'],
```

- [ ] **Step 10: Run the tests and the design guards**

Run: `node tools/test.mjs test/ui-workflow-tests-view.test.mjs test/ui-workflows-markup.test.mjs test/ui-workflows-shell.test.mjs test/ui-workflows-app.test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs`
Then the style.css slicing tests (the list in the Global Constraints).
Expected: PASS, except the four known `ui-design-language` failures. In particular: no off-scale size, no radius outside the tokens, no glyph-only string, and no checkbox emitter without its listed token.

- [ ] **Step 11: Commit**

```bash
git add ui/public/workflows/test-ui.mjs ui/public/workflows/tests-view.mjs ui/public/index.html ui/public/app.js ui/public/style.css test/ui-workflow-tests-view.test.mjs test/ui-workflows-markup.test.mjs test/ui-shared-controls.test.mjs
git commit -m "Workflow tests: the Tests page, its list and first use (flag workflowTests)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 11: Edit an example (board 2), with the question and check dialogs (board 24)

**Precondition:** the screens are the approved boards 2 CaseEditor and 24 AutoCheck (G1 Add a check, G5 the name field, C3, C5). They were approved on 2026-10-26. If the controller reports a later change to one of them, apply it to this task's text before starting.

This matches boards 2 and 24 without the [P3+] parts ("Your criteria"), plus C3, C5, C12, C20, G1, G5, G11, G17 and G19 (Try it once now is disabled while a test runs).

**Files:**
- Create: `ui/public/workflows/example-editor.mjs`
- Modify `ui/public/app.js`:
  - the imports, beside Task 10's
  - the `attach-files.mjs` import (:140)
  - Task 10's `wftOpenExample` and `wftRenderEditor` bodies
  - new `wftSaveExample`, `wftEditorActions`
- Modify `ui/public/style.css`: append the editor rules to the Task 10 block, before its `@media (max-width:900px)` line, and add `.wft-cols` to that line.
- Test: Create `test/ui-workflow-example-editor.test.mjs`.

**Interfaces:**
- Consumes: Task 10's `test-ui.mjs` (`el`, `btn`, `iconBtn`, `seg`, `field`, `card`, `testDialog`, `sentence`, `BUSY_HINT`); `fmtUsd`, `checkLabel`, `normaliseCheck`, `CHECK_KINDS`, `CHECK_KIND_LABELS`, `DEFAULT_BASICS` (Task 1); `useLabel` (Task 8); `makeSwitch` (`ui/public/switch.mjs`); the example routes (Task 9).
- Produces:
  - `example-editor.mjs`:
    - `BLANK_EXAMPLE`
    - `renderExampleEditor(root, example, actions, { doc, win, scripts, perTryUsd, draftLabel, testRunning? }) → { value() }`, where `actions = { back, save(value), tryOnce(value), addFiles(files, value), removeFile(name) }` and each returns `Promise<{ ok, error?, example? }>`
    - `openAnswerDialog({ doc, win, pair?, onSave, onRemove? })`, `openCheckDialog({ doc, win, check?, scripts, onSave, onRemove? })`
  - DOM ids:
    - editor: `#wft-ex-name`, `#wft-ex-request`, `#wft-ex-file`, `#wft-b-error`, `#wft-b-help`, `#wft-b-cost`, `#wft-b-cost-usd`, `#wft-b-fix`, `#wft-b-fix-n`. The four Basics are on/off, so switches: `input.sw-input` (the id) in a `label.switch-row.wft-chk` (makeSwitch).
    - answer dialog: `#wft-qa-question`, `#wft-qa-answer`
    - check dialog: `#wft-ck-kind`, `#wft-ck-min`, `#wft-ck-max`, `#wft-ck-names`, `#wft-ck-text`, `#wft-ck-file`, `#wft-ck-script`
  - app.js: `wftOpenExample(id|null)`, `wftSaveExample(value)`, `wftEditorActions()`, `wftRenderEditor(root)`

- [ ] **Step 1: Write the failing editor test.** Create `test/ui-workflow-example-editor.test.mjs`:

```js
// test/ui-workflow-example-editor.test.mjs — Edit an example (canvas boards 2 and 24; C3, C5, C12, C20, G1, G5, G11, G17, G19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderExampleEditor, BLANK_EXAMPLE } from '../ui/public/workflows/example-editor.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((b) => b.textContent === text);
const example = () => ({
  id: 4, name: 'Bulk invoice export', request: 'Write the product brief for a bulk invoice export.',
  answers: [{ question: 'Which file formats should the export have?', answer: 'PDF and CSV, in one ZIP file.' }],
  otherwise: 'pick', basics: { noError: true, noHelp: true, maxCostUsd: 1.5, maxSentBack: null },
  checks: [{ id: 'c_1', kind: 'words', min: 400, max: 900 }, { id: 'c_2', kind: 'sections', names: ['Problem', 'Users', 'Success metric', 'Risks'] }],
  tries: 3, files: [{ name: 'interviews-q3.md', size: 10, sha256: 'x' }], note: null,
});
function boot(ex = example(), { perTryUsd = 0.55, result = { ok: true }, testRunning = false } = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const actions = {
    back: () => calls.push(['back']),
    save: async (v) => { calls.push(['save', v]); return result; },
    tryOnce: async (v) => { calls.push(['tryOnce', v]); return { ok: true }; },
    addFiles: async (files, v) => { calls.push(['addFiles', files.map((f) => f.name), v.name]); return { ok: true, example: { id: 4, files: [...ex.files, { name: files[0].name, size: 1, sha256: 'y' }] } }; },
    removeFile: async (name) => { calls.push(['removeFile', name]); return { ok: true, example: { id: 4, files: [] } }; },
  };
  const root = window.document.getElementById('root');
  const ed = renderExampleEditor(root, ex, actions, { doc: window.document, win: window, scripts: [{ key: 'lint-md', displayName: 'Markdown lint' }], perTryUsd, draftLabel: 'v5 draft', testRunning });
  return { root, doc: window.document, win: window, calls, ed };
}

test('the board-2 layout: title, actions, cards 1, 2, 4 on the left and 3 on the right', () => {
  const { root } = boot();
  assert.equal(root.querySelector('.wft-crumbs .wft-title').textContent, 'Example: Bulk invoice export');
  assert.deepEqual([...root.querySelectorAll('.wft-crumbs .wft-acts button')].map((b) => b.textContent), ['Cancel', 'Try it once now', 'Save example']);
  assert.deepEqual([...root.querySelectorAll('.wft-col > .card h2')].map((h) => h.textContent), ['1. What Worca gets', "2. Your answers to Worca's questions", '4. How many tries']);
  assert.equal(root.querySelector('.wft-cols > .card h2').textContent, '3. What a good result needs');
  assert.deepEqual([...root.querySelectorAll('.wft-card > h2 + .hint')].map((h) => h.textContent), [
    'The same request and files are used every time this example is tried.',
    'Nobody watches while a test runs. If Worca asks one of these questions, it gets your answer.',
    'AI can answer differently each time. More tries give a surer result, and cost more.',
    'A try passes only when everything below is met.',
  ]);
  assert.equal(root.querySelector('.wft-grp-hint').textContent, 'Counted exactly, without AI. Pick a ready check, or a script from the Library.');
  assert.deepEqual([...root.querySelectorAll('.wft-sect .wft-line-text')].map((n) => n.textContent), ['Length is 400 to 900 words', 'Has the sections Problem, Users, Success metric and Risks']);
  const name = root.querySelector('#wft-ex-name');
  name.value = 'Bulk export'; name.dispatchEvent(new name.ownerDocument.defaultView.Event('input'));
  assert.equal(root.querySelector('.wft-crumbs .wft-title').textContent, 'Example: Bulk export');
});

test('Basics, tries and the estimate read back into the value', () => {
  const { root, ed } = boot();
  assert.deepEqual([...root.querySelectorAll('.wft-chk')].map((l) => [...l.querySelectorAll('.switch-label')].map((s) => s.textContent).join(' ')),
    ['Finishes without an error', 'Finishes without needing help from someone', 'Costs at most', 'Sent back for fixes at most times']);
  assert.ok([...root.querySelectorAll('.wft-chk')].every((l) => l.matches('label.switch-row') && l.querySelector('input.sw-input[role="switch"]')), 'on/off is a switch (design system)');
  assert.equal(root.querySelector('#wft-b-cost-usd').value, '$1.50');
  assert.equal(root.querySelector('#wft-b-fix').checked, false);
  assert.equal(root.querySelector('.wft-estimate').textContent, 'About $0.55 a try with v5 draft, so about $1.65 for this example.');
  click(byText(root, '.wft-c4 .seg button', '5'));
  assert.equal(root.querySelector('.wft-estimate').textContent, 'About $0.55 a try with v5 draft, so about $2.75 for this example.');
  root.querySelector('#wft-b-help').checked = false;
  root.querySelector('#wft-b-fix').checked = true;
  root.querySelector('#wft-b-fix-n').value = '1';
  root.querySelector('#wft-b-cost-usd').value = '$2';
  click(byText(root, '.wft-c2 .seg button', 'The try counts as failed'));
  const v = ed.value();
  assert.deepEqual([v.tries, v.otherwise, v.basics], [5, 'fail', { noError: true, noHelp: false, maxCostUsd: 2, maxSentBack: 1 }]);
  root.querySelector('#wft-b-cost').checked = false;
  assert.equal(ed.value().basics.maxCostUsd, null);
});

test('a new example: no cost limit unless set, the limit pre-filled from the usual cost, the C12 text when unknown', () => {
  const a = boot({ ...BLANK_EXAMPLE }, { perTryUsd: 0.55 });
  assert.equal(a.root.querySelector('.wft-crumbs .wft-title').textContent, 'New example');
  assert.deepEqual([a.root.querySelector('#wft-b-cost').checked, a.root.querySelector('#wft-b-cost-usd').value], [false, '$1.50']);
  const b = boot({ ...BLANK_EXAMPLE }, { perTryUsd: null });
  assert.equal(b.root.querySelector('.wft-estimate').textContent, 'Worca does not know the cost of a try yet: it learns it from the first tries.');
  assert.equal(b.root.querySelector('#wft-b-cost-usd').value, '');
});

test('questions and answers: edit, remove and add in a small dialog', async () => {
  const { root, doc, ed } = boot();
  click(byText(root, '.wft-c2 .wft-line button', 'Edit'));
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Edit the question and answer');
  doc.querySelector('#wft-qa-answer').value = 'CSV only.';
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(ed.value().answers, [{ question: 'Which file formats should the export have?', answer: 'CSV only.' }]);
  click(byText(root, '.wft-c2 button', 'Add a question and answer'));
  doc.querySelector('#wft-qa-question').value = 'Who may export?';
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Write both the question and your answer.');
  doc.querySelector('#wft-qa-answer').value = 'Finance admins.';
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(ed.value().answers.length, 2);
  click(byText(root, '.wft-c2 .wft-line button', 'Edit'));
  click(doc.querySelector('.wft-dlg-remove'));
  assert.deepEqual(ed.value().answers.map((a) => a.question), ['Who may export?']);
});

test('automatic checks: the G1 dialog with a live label, refusals in plain words, scripts by name', async () => {
  const { root, doc, ed } = boot();
  click(byText(root, '.wft-sect button', 'Add an automatic check'));
  const kind = doc.querySelector('#wft-ck-kind');
  assert.deepEqual([...kind.options].map((o) => o.textContent), ['Length in words', 'Has these sections', 'Must mention a text', 'Must not mention a text', 'A file with this name is in the result', 'A Library script']);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Give a smallest or a largest number of words.');
  kind.value = 'mentions'; kind.dispatchEvent(new doc.defaultView.Event('change'));
  const text = doc.querySelector('#wft-ck-text');
  text.value = '200 invoices'; text.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'Mentions "200 invoices"');
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(ed.value().checks.at(-1).text, '200 invoices');
  click(byText(root, '.wft-sect button', 'Add an automatic check'));
  const k2 = doc.querySelector('#wft-ck-kind');
  k2.value = 'script'; k2.dispatchEvent(new doc.defaultView.Event('change'));
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'The Library script "Markdown lint" passes');
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual([...root.querySelectorAll('.wft-sect .wft-line-text')].map((n) => n.textContent).slice(-2), ['Mentions "200 invoices"', 'The Library script "Markdown lint" passes']);
  click(byText(root, '.wft-sect .wft-line button', 'Edit'));
  assert.equal(doc.querySelector('#wft-ck-min').value, '400');
  click(doc.querySelector('.wft-dlg-remove'));
  assert.equal(ed.value().checks.length, 3);
});

test('save, try once, the error line, files', async () => {
  const { root, calls } = boot(example(), { result: { ok: false, error: 'The name must be 1 to 120 characters.' } });
  click(byText(root, '.wft-acts button', 'Save example'));
  await tick();
  assert.equal(calls[0][0], 'save');
  assert.equal(root.querySelector('.wft-error').textContent, 'The name must be 1 to 120 characters.');
  click(byText(root, '.wft-acts button', 'Try it once now'));
  await tick();
  assert.equal(calls[1][0], 'tryOnce');
  const x = root.querySelector('.wft-file-x');
  assert.deepEqual([x.getAttribute('aria-label'), x.textContent, !!x.querySelector('svg')], ['Remove interviews-q3.md', '', true], 'an icon, not a glyph');
  click(x);
  await tick();
  assert.deepEqual(calls[2], ['removeFile', 'interviews-q3.md']);
  assert.equal(root.querySelectorAll('.wft-file').length, 0);
  const picker = root.querySelector('#wft-ex-file');
  Object.defineProperty(picker, 'files', { configurable: true, value: [{ name: 'usage.csv' }] });
  picker.dispatchEvent(new picker.ownerDocument.defaultView.Event('change'));
  await tick();
  assert.deepEqual(calls[3], ['addFiles', ['usage.csv'], 'Bulk invoice export']);
  assert.deepEqual([...root.querySelectorAll('.wft-file > span')].map((s) => s.textContent), ['interviews-q3.md', 'usage.csv']);
  click(byText(root, '.wft-acts button', 'Cancel'));
  assert.deepEqual(calls.at(-1), ['back']);
});

test('while a test of the workflow runs, Try it once now is disabled with the hint (G19); Save still works', async () => {
  const { root, calls } = boot(example(), { testRunning: true });
  const tryBtn = byText(root, '.wft-acts button', 'Try it once now');
  assert.deepEqual([tryBtn.disabled, tryBtn.getAttribute('aria-describedby')], [true, 'wft-busy']);
  assert.equal(root.querySelector('#wft-busy').textContent, 'A test of this workflow is running. Wait for it, or stop it first.');
  click(byText(root, '.wft-acts button', 'Save example'));
  await tick();
  assert.equal(calls[0][0], 'save');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-example-editor.test.mjs`
Expected: FAIL with `Cannot find module '../ui/public/workflows/example-editor.mjs'`.

- [ ] **Step 3: Implement `ui/public/workflows/example-editor.mjs`**

```js
// ui/public/workflows/example-editor.mjs — Edit an example (canvas boards 2, 24; plans/workflow-tests-part2-plan.md Task 11):
// what Worca gets, your answers to its questions, what a good result needs (Basics + automatic checks; "Your criteria"
// is Part 3), how many tries. Plus the two small dialogs: a question and its answer, and an automatic check (G1).
// Pure DOM; app.js saves.
import { el, btn, iconBtn, seg, field, card, testDialog, sentence, BUSY_HINT } from './test-ui.mjs';
import { makeSwitch } from '../switch.mjs';
import { CHECK_KINDS, CHECK_KIND_LABELS, DEFAULT_BASICS, checkLabel, normaliseCheck, fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';

export const BLANK_EXAMPLE = Object.freeze({
  id: null, name: '', request: '', answers: [], otherwise: 'pick', basics: { ...DEFAULT_BASICS }, checks: [], tries: 3, files: [], note: null,
});
const clone = (v) => JSON.parse(JSON.stringify(v));

export function openAnswerDialog({ doc, win, pair = null, onSave, onRemove = null }) {
  const q = el(doc, 'textarea');
  q.id = 'wft-qa-question'; q.rows = 2; q.maxLength = 500; q.value = pair ? pair.question : '';
  const a = el(doc, 'textarea');
  a.id = 'wft-qa-answer'; a.rows = 3; a.maxLength = 2000; a.value = pair ? pair.answer : '';
  return testDialog({
    doc, win, title: pair ? 'Edit the question and answer' : 'Add a question and answer', confirmLabel: 'Save',
    body: [el(doc, 'p', 'hint', 'Write the question as Worca asks it. Case, spacing and punctuation do not matter.'),
      field(doc, 'Question', q, { id: q.id }), field(doc, 'Your answer', a, { id: a.id })],
    onRemove: pair && onRemove ? onRemove : null,
    onConfirm: () => {
      const question = q.value.trim();
      const answer = a.value.trim();
      if (!question || !answer) return { ok: false, error: 'Write both the question and your answer.' };
      onSave({ question, answer });
      return { ok: true };
    },
  });
}

/** G1: Add an automatic check — the kind, its fields, and the label it will have. */
export function openCheckDialog({ doc, win, check = null, scripts = [], onSave, onRemove = null }) {
  const kind = el(doc, 'select');
  kind.id = 'wft-ck-kind';
  for (const k of CHECK_KINDS) {
    if (k === 'script' && !scripts.length) continue;
    const o = el(doc, 'option', '', CHECK_KIND_LABELS[k]);
    o.value = k;
    kind.append(o);
  }
  kind.value = check ? check.kind : 'words';
  const fields = el(doc, 'div', 'wft-ck-fields');
  const preview = el(doc, 'p', 'hint wft-ck-preview');
  preview.setAttribute('aria-live', 'polite');
  const scriptName = (k) => (scripts.find((s) => s.key === k) || {}).displayName || k;
  let read = () => ({ kind: kind.value });
  const paintPreview = () => {
    const { check: ok } = normaliseCheck(read());
    preview.textContent = ok ? checkLabel(ok, { scriptName: ok.kind === 'script' ? scriptName(ok.key) : null }) : '';
  };
  const input = (id, type, value, extra = {}) => {
    const i = el(doc, 'input');
    i.id = id; i.type = type; i.value = value ?? '';
    Object.assign(i, extra);
    i.addEventListener('input', paintPreview);
    return i;
  };
  const paintFields = () => {
    fields.replaceChildren();
    const c = check && check.kind === kind.value ? check : {};
    if (kind.value === 'words') {
      const min = input('wft-ck-min', 'number', c.min ?? '', { min: '0' });
      const max = input('wft-ck-max', 'number', c.max ?? '', { min: '0' });
      fields.append(field(doc, 'At least, in words', min, { id: min.id }), field(doc, 'At most, in words', max, { id: max.id, hint: 'Leave one empty for no limit on that side.' }));
      read = () => ({ kind: 'words', min: min.value === '' ? null : Number(min.value), max: max.value === '' ? null : Number(max.value) });
    } else if (kind.value === 'sections') {
      const names = input('wft-ck-names', 'text', Array.isArray(c.names) ? c.names.join(', ') : '');
      fields.append(field(doc, 'Section names', names, { id: names.id, hint: 'Separate them with commas, for example Problem, Users, Risks. A section is a heading in the result.' }));
      read = () => ({ kind: 'sections', names: names.value });
    } else if (kind.value === 'mentions' || kind.value === 'not-mentions') {
      const text = input('wft-ck-text', 'text', c.text ?? '', { maxLength: 200 });
      fields.append(field(doc, 'Text', text, { id: text.id, hint: 'Case and spacing do not matter.' }));
      read = () => ({ kind: kind.value, text: text.value });
    } else if (kind.value === 'file') {
      const name = input('wft-ck-file', 'text', c.name ?? '', { maxLength: 200 });
      fields.append(field(doc, 'File name', name, { id: name.id, hint: 'A file the result must have, such as summary.md.' }));
      read = () => ({ kind: 'file', name: name.value });
    } else {
      const sel = el(doc, 'select');
      sel.id = 'wft-ck-script';
      for (const s of scripts) { const o = el(doc, 'option', '', s.displayName || s.key); o.value = s.key; sel.append(o); }
      if (c.key) sel.value = c.key;
      sel.addEventListener('change', paintPreview);
      fields.append(field(doc, 'Script', sel, { id: sel.id, hint: 'For developers: the check is met when the script finds no problems in the result.' }));
      read = () => ({ kind: 'script', key: sel.value, params: c.params || {} });
    }
    paintPreview();
  };
  kind.addEventListener('change', paintFields);
  paintFields();
  return testDialog({
    doc, win, title: check ? 'Edit the automatic check' : 'Add an automatic check', confirmLabel: 'Save check',
    body: [el(doc, 'p', 'hint', 'Counted exactly, without AI.'), field(doc, 'What to check', kind, { id: kind.id }), fields, preview],
    onRemove: check && onRemove ? onRemove : null,
    onConfirm: () => {
      const { check: ok, error } = normaliseCheck({ ...read(), ...(check && check.id ? { id: check.id } : {}) });
      if (!ok) return { ok: false, error: sentence(error) };
      onSave(ok);
      return { ok: true };
    },
  });
}

/** A Basic is on or off, so a switch (docs/design-system.md › Switch); `extra` (a field) and `after` ("times") sit in its row. */
function basicRow(doc, id, text, on, extra = null, after = null) {
  const { row, input } = makeSwitch(doc, { label: text, checked: !!on, rowClass: 'wft-chk' });
  input.id = id;
  if (extra) row.append(extra);
  if (after) row.append(el(doc, 'span', 'switch-label', after));   // the row's flex gap spaces it
  return row;
}

/**
 * @param {HTMLElement} root
 * @param {object} ex an example (the store's shape) or BLANK_EXAMPLE
 * @param {{back:Function, save:Function, tryOnce:Function, addFiles:Function, removeFile:Function}} actions
 * @param {{doc: Document, win: Window, scripts?: Array<{key:string, displayName?:string}>, perTryUsd?: number|null, draftLabel?: string,
 *   testRunning?: boolean}} ctx  testRunning: a test of this workflow runs, so Try it once now waits (G19)
 * @returns {{value: () => object}}
 */
export function renderExampleEditor(root, ex, actions, { doc, win, scripts = [], perTryUsd = null, draftLabel = 'your draft', testRunning = false }) {
  const draft = clone({ ...BLANK_EXAMPLE, ...ex });
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page wft-editor');
  const error = el(doc, 'p', 'hint err wft-error');
  error.setAttribute('aria-live', 'polite');

  // ── header ──
  const head = el(doc, 'div', 'wft-crumbs');
  const crumbs = el(doc, 'div', 'wft-crumbs-left');
  const title = el(doc, 'h2', 'wft-title');
  const paintTitle = () => { title.textContent = draft.name.trim() ? `Example: ${draft.name.trim()}` : 'New example'; };
  paintTitle();
  crumbs.append(btn(doc, 'Tests', () => actions.back(), 'wft-crumb'), title);
  const acts = el(doc, 'div', 'wft-acts');
  const run = async (fn, b) => {
    error.textContent = '';
    b.disabled = true;
    let r;
    try { r = await fn(value()); } catch (e) { r = { ok: false, error: e && e.message ? e.message : String(e) }; }
    b.disabled = b === tryBtn && testRunning;
    if (!r || !r.ok) error.textContent = (r && r.error) || 'That did not work. Try again.';
  };
  const tryBtn = btn(doc, 'Try it once now', () => void run(actions.tryOnce, tryBtn), 'btn');
  const saveBtn = btn(doc, 'Save example', () => void run(actions.save, saveBtn), 'btn btn-primary');
  acts.append(btn(doc, 'Cancel', () => actions.back(), 'btn'), tryBtn, saveBtn);
  head.append(crumbs, acts);
  if (testRunning) {   // G19, D37: one test per workflow at a time
    tryBtn.disabled = true;
    tryBtn.setAttribute('aria-describedby', 'wft-busy');
    const busy = el(doc, 'p', 'hint wft-busy', BUSY_HINT);
    busy.id = 'wft-busy';
    head.append(busy);
  }
  page.append(head, error);

  // ── 1. What Worca gets (G5: the name field) ──
  const name = el(doc, 'input');
  name.type = 'text'; name.id = 'wft-ex-name'; name.maxLength = 120; name.value = draft.name;
  name.addEventListener('input', () => { draft.name = name.value; paintTitle(); });
  const request = el(doc, 'textarea');
  request.id = 'wft-ex-request'; request.rows = 6; request.value = draft.request;
  request.addEventListener('input', () => { draft.request = request.value; });
  const files = el(doc, 'div', 'wft-files');
  const picker = el(doc, 'input');
  picker.type = 'file'; picker.multiple = true; picker.hidden = true; picker.id = 'wft-ex-file';
  const paintFiles = () => {
    files.replaceChildren();
    for (const f of draft.files) {
      const pill = el(doc, 'span', 'wft-file');
      const x = iconBtn(doc, 'x', `Remove ${f.name}`, async () => {
        const r = await actions.removeFile(f.name);
        if (r && r.ok && r.example) { draft.files = r.example.files; paintFiles(); } else error.textContent = (r && r.error) || 'The file was not removed.';
      }, 'wft-file-x', 12);
      pill.append(el(doc, 'span', '', f.name), x);
      files.append(pill);
    }
    files.append(btn(doc, 'Add file', () => picker.click()), picker);
  };
  picker.addEventListener('change', async () => {
    const list = [...(picker.files || [])];
    if (!list.length) return;
    const r = await actions.addFiles(list, value());   // G17: an example never saved is saved first
    if (r && r.ok && r.example) { draft.id = r.example.id; draft.files = r.example.files; paintFiles(); } else error.textContent = (r && r.error) || 'The file was not added.';
  });
  paintFiles();
  const c1 = card(doc, '1. What Worca gets', 'wft-c1-h', 'The same request and files are used every time this example is tried.', 'wft-c1');
  c1.append(field(doc, 'Name of the example', name, { id: name.id }), field(doc, 'Request', request, { id: request.id }), field(doc, 'Files', files));

  // ── 2. Your answers to Worca's questions ──
  const qa = el(doc, 'div', 'wft-lines');
  const paintQa = () => {
    qa.replaceChildren();
    draft.answers.forEach((p, i) => {
      const line = el(doc, 'div', 'wft-line');
      const words = el(doc, 'span', 'wft-line-text');
      words.append(el(doc, 'b', '', p.question), el(doc, 'span', '', p.answer));
      const edit = btn(doc, 'Edit', () => openAnswerDialog({ doc, win, pair: p,
        onSave: (np) => { draft.answers[i] = np; paintQa(); }, onRemove: () => { draft.answers.splice(i, 1); paintQa(); } }));
      edit.setAttribute('aria-label', `Edit the answer to ${p.question}`);
      line.append(words, edit);
      qa.append(line);
    });
    qa.append(btn(doc, 'Add a question and answer', () => openAnswerDialog({ doc, win, onSave: (np) => { draft.answers.push(np); paintQa(); } })));
  };
  paintQa();
  const c2 = card(doc, "2. Your answers to Worca's questions", 'wft-c2-h', 'Nobody watches while a test runs. If Worca asks one of these questions, it gets your answer.', 'wft-c2');
  c2.append(qa, field(doc, 'If Worca asks something else', seg(doc, 'If Worca asks something else',
    [['pick', 'Worca picks a sensible answer'], ['fail', 'The try counts as failed']], draft.otherwise, (v) => { draft.otherwise = v; })));

  // ── 4. How many tries ──
  const est = el(doc, 'p', 'hint wft-estimate');
  const known = typeof perTryUsd === 'number' && Number.isFinite(perTryUsd);
  const paintEst = () => {
    est.textContent = known
      ? `About ${fmtUsd(perTryUsd)} a try with ${draftLabel}, so about ${fmtUsd(perTryUsd * draft.tries)} for this example.`
      : 'Worca does not know the cost of a try yet: it learns it from the first tries.';   // C12
  };
  const c4 = card(doc, '4. How many tries', 'wft-c4-h', 'AI can answer differently each time. More tries give a surer result, and cost more.', 'wft-c4');
  c4.append(seg(doc, 'How many tries', [[1, '1'], [3, '3'], [5, '5']], draft.tries, (v) => { draft.tries = Number(v); paintEst(); }), est);
  paintEst();

  // ── 3. What a good result needs ──
  const c3 = card(doc, '3. What a good result needs', 'wft-c3-h', 'A try passes only when everything below is met.', 'wft-c3');
  const b = draft.basics || DEFAULT_BASICS;
  const cost = el(doc, 'input');
  cost.type = 'text'; cost.inputMode = 'decimal'; cost.className = 'wft-num'; cost.id = 'wft-b-cost-usd';
  cost.setAttribute('aria-label', 'Cost limit');
  // G11: off for a new example; the box is pre-filled with twice the usual cost, rounded up to $0.50.
  cost.value = b.maxCostUsd != null ? fmtUsd(b.maxCostUsd) : known ? fmtUsd(Math.ceil(perTryUsd * 4) / 2) : '';
  const fix = el(doc, 'input');
  fix.type = 'number'; fix.min = '0'; fix.max = '50'; fix.className = 'wft-num'; fix.id = 'wft-b-fix-n';
  fix.setAttribute('aria-label', 'Fix limit');
  fix.value = String(b.maxSentBack ?? 2);
  const rows = {
    noError: basicRow(doc, 'wft-b-error', 'Finishes without an error', b.noError),
    noHelp: basicRow(doc, 'wft-b-help', 'Finishes without needing help from someone', b.noHelp),
    cost: basicRow(doc, 'wft-b-cost', 'Costs at most', b.maxCostUsd != null, cost),
    fix: basicRow(doc, 'wft-b-fix', 'Sent back for fixes at most', b.maxSentBack != null, fix, 'times'),
  };
  c3.append(el(doc, 'p', 'wft-grp', 'Basics'), rows.noError, rows.noHelp, rows.cost, rows.fix);
  const lines = el(doc, 'div', 'wft-lines');
  const scriptName = (k) => (scripts.find((s) => s.key === k) || {}).displayName || k;
  const paintChecks = () => {
    lines.replaceChildren();
    draft.checks.forEach((c, i) => {
      const line = el(doc, 'div', 'wft-line');
      const label = checkLabel(c, { scriptName: c.kind === 'script' ? scriptName(c.key) : null });
      const edit = btn(doc, 'Edit', () => openCheckDialog({ doc, win, check: c, scripts,
        onSave: (nc) => { draft.checks[i] = nc; paintChecks(); }, onRemove: () => { draft.checks.splice(i, 1); paintChecks(); } }));
      edit.setAttribute('aria-label', `Edit ${label}`);
      line.append(el(doc, 'span', 'wft-line-text', label), edit);
      lines.append(line);
    });
    lines.append(btn(doc, 'Add an automatic check', () => openCheckDialog({ doc, win, scripts, onSave: (nc) => { draft.checks.push(nc); paintChecks(); } })));
  };
  paintChecks();
  const sect = el(doc, 'div', 'wft-sect');
  sect.append(el(doc, 'p', 'wft-grp', 'Automatic checks'), el(doc, 'p', 'wft-grp-hint', 'Counted exactly, without AI. Pick a ready check, or a script from the Library.'), lines);   // C3
  c3.append(sect);

  const cols = el(doc, 'div', 'wft-cols');
  const left = el(doc, 'div', 'wft-col');
  left.append(c1, c2, c4);
  cols.append(left, c3);
  page.append(cols);
  root.append(page);

  function value() {
    const money = Number(String(cost.value).replace(/[^0-9.]/g, ''));
    return {
      name: draft.name.trim(), request: draft.request, answers: draft.answers, otherwise: draft.otherwise,
      basics: {
        noError: rows.noError.querySelector('input').checked,
        noHelp: rows.noHelp.querySelector('input').checked,
        maxCostUsd: rows.cost.querySelector('input').checked ? (Number.isFinite(money) && money > 0 ? money : 0) : null,
        maxSentBack: rows.fix.querySelector('input').checked ? Number(fix.value) : null,
      },
      checks: draft.checks, tries: draft.tries, note: draft.note,
    };
  }
  return { value };
}
```

- [ ] **Step 4: Run the editor test**

Run: `node tools/test.mjs test/ui-workflow-example-editor.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Styles** (append to the Task 10 block, before its `@media (max-width:900px)` line; tokens and type steps only)

```css
/* Edit an example (boards 2, 24) */
.wft-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start;}
.wft-col{display:flex;flex-direction:column;gap:20px;min-width:0;}
.wft-card{display:flex;flex-direction:column;gap:10px;min-width:0;}
.wft-card > h2{margin:0;font-size:var(--fs-section);}
.wft-card > .hint{margin:0;}
.wft-grp{font-size:var(--fs-body);font-weight:600;color:var(--ink);margin:0;}
.wft-grp-hint{font-size:var(--fs-meta);color:var(--ink-2);margin:0;line-height:1.45;}
.wft-chk{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;font-size:var(--fs-body);padding:4px 0;}
.wft-chk input[type="checkbox"]:not(.sw-input){width:16px;height:16px;accent-color:var(--ink);margin:0;}
.wft-num{width:84px;}
.wft-lines{display:flex;flex-direction:column;gap:8px;align-items:flex-start;}
.wft-line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--line-2);border-radius:var(--r-sm);background:var(--panel);align-self:stretch;}
.wft-line-text{display:flex;flex-direction:column;gap:2px;min-width:0;font-size:var(--fs-body);}
.wft-sect{border-top:1px solid var(--line);padding-top:16px;margin-top:6px;display:flex;flex-direction:column;gap:8px;}
.wft-files{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.wft-file{display:inline-flex;align-items:center;gap:6px;background:var(--field);border-radius:var(--r-xs);padding:4px 6px 4px 12px;font-family:var(--mono);font-size:var(--fs-meta);color:var(--ink-2);}
.wft-file-x{display:inline-flex;align-items:center;border:0;background:transparent;color:var(--ink-2);cursor:pointer;padding:2px;}
.wft-file-x:hover{color:var(--ink);}
.wft-error:empty{display:none;}
.wft-ck-preview{font-weight:600;color:var(--ink);}
```
Change Task 10's `@media (max-width:900px){.wft-steps{grid-template-columns:minmax(0,1fr);}}` to:
```css
@media (max-width:900px){.wft-steps,.wft-cols{grid-template-columns:minmax(0,1fr);}}
```
`.wft-chk` is shared: the Basics' switch rows here, the checkbox rows of Tasks 12 and 13.

- [ ] **Step 6: Wire it in `ui/public/app.js`**

Imports, beside Task 10's:
```js
import { renderExampleEditor, BLANK_EXAMPLE } from './workflows/example-editor.mjs';
import { useLabel as wftUseLabel } from '../../src/shared/workflow-tests/compare.mjs';
```
Change :140 to `import { ATTACH_MAX_MESSAGE_BYTES, bytesToBase64 } from './attach-files.mjs';`.

Replace Task 10's two temporary bodies (`wftOpenExample` and `wftRenderEditor`, under the comment "Task 11 replaces these two bodies") with:
```js
// The example editor (Task 11).
function wftRenderEditor(root) {
  renderExampleEditor(root, wft.example, wftEditorActions(), { doc: document, win: window, scripts: wft.scripts, perTryUsd: wft.perTryUsd,
    draftLabel: wft.overview ? wftUseLabel('draft', wft.overview.ctx) : 'your draft',
    testRunning: !!(wft.overview && wft.overview.running) });   // G19
}
async function wftOpenExample(exampleId) {
  const id = wftWorkflowId();
  if (!id) return;
  let example = { ...BLANK_EXAMPLE, basics: { ...BLANK_EXAMPLE.basics } };
  if (exampleId != null) {
    const r = await wftCall('GET', `${wftBase(id)}/examples/${exampleId}`);
    if (!r.ok) { notify({ tone: 'err', title: 'Could not open the example', detail: r.error }); return; }
    example = r.data.example;
  }
  let scripts = [];
  try { scripts = (await gvApi.scripts()).filter((s) => s && s.placeable !== false); } catch { scripts = []; }
  const plan = await wftCall('GET', `${wftBase(id)}/plan?b=draft&tries=1`);
  if (wftWorkflowId() !== id) return;
  { const o = await wftCall('GET', wftBase(id)); if (o.ok) wft.overview = o.data; }   // fresh: G19 reads whether a test runs
  wft = { ...wft, workflowId: id, view: 'editor', example, scripts, perTryUsd: plan.ok && plan.data.b ? plan.data.b.perTryUsd : null };
  wftRender();
}
async function wftSaveExample(value) {
  const id = wftWorkflowId();
  const ex = wft.example;
  const r = ex && ex.id ? await wftCall('PUT', `${wftBase(id)}/examples/${ex.id}`, value) : await wftCall('POST', `${wftBase(id)}/examples`, value);
  if (r.ok) wft.example = r.data.example;
  return r.ok ? { ok: true, example: r.data.example } : r;
}
function wftEditorActions() {
  const id = wftWorkflowId();
  return {
    back: () => wftShow('list', { overview: null }),
    save: async (value) => {
      const r = await wftSaveExample(value);
      if (r.ok) { notify({ tone: 'ok', title: 'Example saved' }); wftShow('list', { overview: null }); }
      return r;
    },
    tryOnce: async (value) => {
      const s = await wftSaveExample(value);
      if (!s.ok) return s;
      const r = await wftCall('POST', `${wftBase(id)}/examples/${s.example.id}/try-once`, {});
      if (!r.ok) return r;
      wftShow('progress', { runId: r.data.run.id });   // G2
      return { ok: true };
    },
    addFiles: async (files, value) => {
      if (!wft.example || !wft.example.id) { const s = await wftSaveExample(value); if (!s.ok) return s; }   // G17
      for (const f of files) {
        const dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
        const r = await wftCall('POST', `${wftBase(id)}/examples/${wft.example.id}/files`, { name: f.name, dataBase64 });
        if (!r.ok) return r;
        wft.example = r.data.example;
      }
      return { ok: true, example: wft.example };
    },
    removeFile: async (name) => {
      const r = await wftCall('DELETE', `${wftBase(id)}/examples/${wft.example.id}/files/${encodeURIComponent(name)}`);
      if (r.ok) wft.example = r.data.example;
      return r.ok ? { ok: true, example: r.data.example } : r;
    },
  };
}
```

- [ ] **Step 7: Run the tests and the design guards**

Run: `node tools/test.mjs test/ui-workflow-example-editor.test.mjs test/ui-workflow-tests-view.test.mjs test/ui-workflows-app.test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs`
Then the style.css slicing tests (the list in the Global Constraints).
Expected: PASS, except the four known `ui-design-language` failures. The editor adds no checkbox: its Basics are switches.

- [ ] **Step 8: Commit**

```bash
git add ui/public/workflows/example-editor.mjs ui/public/app.js ui/public/style.css test/ui-workflow-example-editor.test.mjs
git commit -m "Workflow tests: edit an example, with the question and the automatic check dialogs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 12: Use a past run as a test example (boards 3 and 25, G6, G7)

**Precondition:** the screens are the approved boards 3 AddFromRun and 25 PickPastRun (G7 the picker and its empty state, C11, G6 the run page's More item). They were approved on 2026-10-26. If the controller reports a later change to one of them, apply it to this task's text before starting.

**Files:**
- Create: `ui/public/workflows/test-dialogs.mjs`
- Modify `ui/public/app.js`:
  - the imports
  - the saved run page's ⋯ listener (`.hd-bar-more`, :23690)
  - Task 10's `wftPickRun` body
  - a new `wftAddFromRun`
- Modify: `ui/public/style.css` (append to the Task 10 block, before its `@media (max-width:900px)` line)
- Modify: `test/ui-shared-controls.test.mjs`, one `JS_CHECKBOX_OK` row (the keep rows)
- Test: `test/ui-workflow-test-dialogs.test.mjs`

**Interfaces:**
- Consumes: `GET /api/workflow-tests/past-run/:pipelineId`, `POST …/examples/from-run` (Task 9); `testDialog`, `field`, `seg`, `el` (Task 10)
- Produces:
  - `canUseAsExample({ flag, noProject, status, templateId, reserved }) → boolean` (G6's rule; a plugin workflow's `wfp_…` id never qualifies, review M7)
  - `openPickRunDialog({ doc, win, workflowName, runs, dateText, onPick(pipelineId) })` (G7; Next is disabled when there is no run)
  - `openFromRunDialog({ doc, win, past, onSubmit({ name, keepRequest, keepAnswers, verdict, note }) → Promise<{ok, error?}> })` (board 3, C4)
  - DOM ids: `#wft-fr-name`, `#wft-fr-request`, `#wft-fr-answers`, `#wft-fr-note`
  - app.js: `wftAddFromRun(pipelineId)`, `wftRunMenuItems(record, data)`

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-test-dialogs.test.mjs` (Task 13 adds the Test a version tests to it):

```js
// test/ui-workflow-test-dialogs.test.mjs — Use this run as a test example (board 3, C4), the run picker (G7), and the
// rule for the run page's ⋯ item (G6). Task 13 adds Test a version (board 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openFromRunDialog, openPickRunDialog, canUseAsExample } from '../ui/public/workflows/test-dialogs.mjs';

const dom = () => { const d = new JSDOM('<!doctype html><body></body>'); return { doc: d.window.document, win: d.window }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const past = (over = {}) => ({
  pipelineId: 'abcd1234', workflowId: 'wf_b', workflowName: 'Product brief writer', title: 'Saved filters for reports',
  request: 'Write the brief.', files: ['reports-interviews.md', 'usage.csv'],
  qa: [{ question: 'Who uses filters?', answer: 'Analysts' }, { question: 'Which reports?', answer: 'Monthly' }],
  use: 4, useLabel: 'v4', testable: true, reason: null, reasonText: null, ...over,
});

test('board 3: the heading, what is kept, the verdict and its hint, and what is sent', async () => {
  const { doc, win } = dom();
  let sent = null;
  openFromRunDialog({ doc, win, past: past(), onSubmit: async (b) => { sent = b; return { ok: true }; } });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Use this run as a test example');
  assert.equal(doc.querySelector('.wft-fr-intro').textContent, 'Worca keeps the request and files, so every new version of Product brief writer can be tried on exactly the same thing.');
  assert.equal(doc.querySelector('#wft-fr-name').value, 'Saved filters for reports');
  assert.deepEqual([...doc.querySelectorAll('.wft-keep .wft-chk')].map((l) => l.textContent), [
    'The request and its 2 files (reports-interviews.md, usage.csv)',
    'The 2 questions Worca asked and your answers, so the test can run without you',
  ]);
  assert.ok(doc.querySelector('#wft-fr-request').checked && doc.querySelector('#wft-fr-answers').checked);
  assert.ok([...doc.querySelectorAll('.wft-keep input')].every((b) => b.classList.contains('wft-keep-box')), 'the listed picker token (ui-shared-controls)');
  const hint = doc.querySelector('.wft-fr-hint');
  assert.equal(hint.hidden, true, 'no verdict, no hint');
  click([...doc.querySelectorAll('.seg button')].find((b) => b.textContent === 'Not good enough'));
  assert.deepEqual([hint.hidden, hint.textContent], [false, 'This result came from v4 and was not good enough, so v4 shows as not good on this example until it is tested.']);
  click([...doc.querySelectorAll('.seg button')].find((b) => b.textContent === 'Good: keep it like this'));
  assert.equal(hint.textContent, 'This result came from v4 and was good, so v4 shows as good on this example until it is tested.');
  doc.querySelector('#wft-fr-answers').checked = false;
  doc.querySelector('#wft-fr-note').value = 'It should say how many people use filters today.';
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(sent, { name: 'Saved filters for reports', keepRequest: true, keepAnswers: false, verdict: 'good', note: 'It should say how many people use filters today.' });
  assert.equal(doc.querySelector('#mk-dialog'), null, 'closes on success');
});

test('one file, no questions, no name: the words follow, and a name is needed', async () => {
  const { doc, win } = dom();
  openFromRunDialog({ doc, win, past: past({ files: ['usage.csv'], qa: [], title: '' }), onSubmit: async () => ({ ok: false, error: 'Never sent.' }) });
  assert.deepEqual([...doc.querySelectorAll('.wft-keep .wft-chk')].map((l) => l.textContent), ['The request and its file (usage.csv)']);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Give the example a name.');
});

test('G7: pick a past run, then Next', async () => {
  const { doc, win } = dom();
  const picked = [];
  openPickRunDialog({ doc, win, workflowName: 'Product brief writer', dateText: () => '14 Oct', onPick: (id) => picked.push(id),
    runs: [{ pipelineId: 'p1', title: 'Bulk invoice export', at: 'x', status: 'done', files: 2, sameAs: null },
      { pipelineId: 'p2', title: 'Saved filters', at: 'x', status: 'error', files: 0, sameAs: null }] });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Add from a past run');
  assert.equal(doc.querySelector('.mk-dialog-body > .hint').textContent, 'Pick a run of Product brief writer to keep as an example.');
  assert.deepEqual([...doc.querySelectorAll('.wft-pick-row')].map((r) => r.textContent), ['Bulk invoice export · 14 Oct · Finished', 'Saved filters · 14 Oct · Failed']);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Pick a run first.');
  doc.querySelectorAll('.wft-pick-row input')[1].checked = true;
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(picked, ['p2']);
  const empty = dom();
  openPickRunDialog({ doc: empty.doc, win: empty.win, workflowName: 'Product brief writer', runs: [], dateText: () => '', onPick: () => {} });
  assert.equal(empty.doc.querySelector('.mk-dialog-body > .hint').textContent, 'Worca found no runs of Product brief writer without a project yet. Run the workflow once, or write an example yourself.');
  assert.equal(empty.doc.querySelector('.wft-dlg-ok').disabled, true, 'board 25: nothing to pick, Next is disabled');
});

test('G6: only a finished no-project run of a saved user workflow, with the flag on', () => {
  const ok = { flag: true, noProject: true, status: 'done', templateId: 'wf_b', reserved: false };
  assert.equal(canUseAsExample(ok), true);
  assert.equal(canUseAsExample({ ...ok, status: 'error' }), true);
  for (const bad of [{ flag: false }, { noProject: false }, { status: 'running' }, { templateId: null }, { reserved: true }, { templateId: 'wfp_acme_brief' }]) {
    assert.equal(canUseAsExample({ ...ok, ...bad }), false, JSON.stringify(bad));
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-test-dialogs.test.mjs`
Expected: FAIL with `Cannot find module '../ui/public/workflows/test-dialogs.mjs'`.

- [ ] **Step 3: Implement `ui/public/workflows/test-dialogs.mjs`**

```js
// ui/public/workflows/test-dialogs.mjs — the workflow tests dialogs (plans/workflow-tests-part2-plan.md Tasks 12–13):
// pick a past run (G7), use this run as a test example (board 3), and test a version (board 4, Task 13). Pure DOM.
import { el, btn, seg, field, testDialog } from './test-ui.mjs';

/** G6: the run page's More menu offers "Use as test example" for a finished no-project run of a saved user workflow. A
 *  plugin's workflow (`wfp_<plugin>_<slug>`, plugin-workflows.mjs) has no tests (review M7): the item would only be refused. */
export function canUseAsExample({ flag, noProject, status, templateId, reserved }) {
  return !!flag && !!noProject && ['done', 'stopped', 'error'].includes(String(status || '')) && !!templateId && !reserved
    && !/^wfp_/.test(String(templateId));
}

const STATUS_WORD = { done: 'Finished', error: 'Failed', stopped: 'Stopped' };

/** G7: the Tests list's "Add from a past run" — which run, then board 3. */
export function openPickRunDialog({ doc, win, workflowName, runs = [], dateText, onPick }) {
  const body = [];
  if (!runs.length) {
    body.push(el(doc, 'p', 'hint', `Worca found no runs of ${workflowName} without a project yet. Run the workflow once, or write an example yourself.`));
  } else {
    body.push(el(doc, 'p', 'hint', `Pick a run of ${workflowName} to keep as an example.`));
    const list = el(doc, 'div', 'wft-pick');
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', 'Past runs');
    for (const r of runs) {
      const row = el(doc, 'label', 'wft-pick-row');
      const radio = el(doc, 'input');
      radio.type = 'radio'; radio.name = 'wft-pick-run'; radio.value = r.pipelineId;
      const text = el(doc, 'span', 'wft-pick-text');
      text.append(el(doc, 'b', '', r.title), el(doc, 'span', 'hint', ` · ${dateText(r.at)} · ${STATUS_WORD[r.status] || 'Stopped'}`));
      row.append(radio, text);
      list.append(row);
    }
    body.push(list);
  }
  const dlg = testDialog({
    doc, win, title: 'Add from a past run', confirmLabel: 'Next', body,
    onConfirm: () => {
      const hit = [...doc.querySelectorAll('input[name="wft-pick-run"]')].find((x) => x.checked);
      if (!hit) return { ok: false, error: 'Pick a run first.' };
      onPick(hit.value);
      return { ok: true };
    },
  });
  if (!runs.length) dlg.okButton.disabled = true;   // board 25: nothing to pick
  return dlg;
}

function keepRow(doc, id, text, detail = null) {
  const l = el(doc, 'label', 'wft-chk');
  const box = el(doc, 'input', 'wft-keep-box');   // test/ui-shared-controls.test.mjs JS_CHECKBOX_OK: picks what to keep
  box.type = 'checkbox'; box.id = id; box.checked = true;
  l.append(box, doc.createTextNode(text));
  if (detail) l.append(el(doc, 'span', 'hint', detail));
  return { row: l, box };
}

/** Board 3: "Use this run as a test example" (C4: the verdict is the version's result until it is tested, D29). */
export function openFromRunDialog({ doc, win, past, onSubmit }) {
  const name = el(doc, 'input');
  name.type = 'text'; name.id = 'wft-fr-name'; name.maxLength = 120; name.value = past.title || '';
  const nf = past.files.length;
  const nq = past.qa.length;
  const keep = el(doc, 'div', 'wft-keep');
  keep.append(el(doc, 'span', 'label', 'Keep from this run'));
  const req = keepRow(doc, 'wft-fr-request', nf ? `The request and its ${nf === 1 ? 'file' : `${nf} files`} ` : 'The request',
    nf ? `(${past.files.join(', ')})` : null);
  keep.append(req.row);
  const ans = nq ? keepRow(doc, 'wft-fr-answers', nq === 1
    ? 'The question Worca asked and your answer, so the test can run without you'
    : `The ${nq} questions Worca asked and your answers, so the test can run without you`) : null;
  if (ans) keep.append(ans.row);
  let verdict = null;
  const hint = el(doc, 'p', 'hint wft-fr-hint');
  hint.hidden = true;
  const paintHint = () => {
    const v = past.useLabel;
    hint.textContent = verdict === 'not-good'
      ? `This result came from ${v} and was not good enough, so ${v} shows as not good on this example until it is tested.`
      : verdict === 'good' ? `This result came from ${v} and was good, so ${v} shows as good on this example until it is tested.` : '';
    hint.hidden = !verdict;
  };
  const how = seg(doc, 'How was this result', [['good', 'Good: keep it like this'], ['not-good', 'Not good enough']], null, (v) => { verdict = v; paintHint(); });
  const note = el(doc, 'textarea');
  note.id = 'wft-fr-note'; note.rows = 3; note.maxLength = 2000;
  return testDialog({
    doc, win, title: 'Use this run as a test example', confirmLabel: 'Add example',
    body: [
      el(doc, 'p', 'wft-fr-intro', `Worca keeps the request and files, so every new version of ${past.workflowName} can be tried on exactly the same thing.`),
      field(doc, 'Name of the example', name, { id: name.id }), keep,
      field(doc, 'How was this result?', how),
      field(doc, 'What should a good result have?', note, { id: note.id, opt: 'in your own words' }),
      hint,
    ],
    onConfirm: () => {
      if (!name.value.trim()) return { ok: false, error: 'Give the example a name.' };
      return onSubmit({ name: name.value.trim(), keepRequest: req.box.checked, keepAnswers: ans ? ans.box.checked : false, verdict,
        note: note.value.trim() || null });
    },
  });
}
```

- [ ] **Step 4: Run the test**

Run: `node tools/test.mjs test/ui-workflow-test-dialogs.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it in `ui/public/app.js`**

Import:
```js
import { openFromRunDialog, openPickRunDialog, canUseAsExample } from './workflows/test-dialogs.mjs';
```
Replace Task 10's `wftPickRun` with:
```js
function wftPickRun() {
  const o = wft.overview;
  if (!o) return;
  openPickRunDialog({ doc: document, win: window, workflowName: o.name, runs: o.pastRuns || [], dateText: wftDate, onPick: (pid) => void wftAddFromRun(pid) });
}
```
Add after it:
```js
/** Board 3 from a run page or the picker: read what the run keeps, ask, create, then open the example in the editor. */
async function wftAddFromRun(pipelineId) {
  const r = await wftCall('GET', `/api/workflow-tests/past-run/${encodeURIComponent(pipelineId)}`);
  if (!r.ok) { notify({ tone: 'err', title: 'Could not read the run', detail: r.error }); return; }
  const past = r.data;
  if (!past.testable) { notify({ tone: 'err', title: 'This run cannot become a test example', detail: past.reasonText || '' }); return; }
  openFromRunDialog({ doc: document, win: window, past, onSubmit: async (body) => {
    const s = await wftCall('POST', `${wftBase(past.workflowId)}/examples/from-run`, { pipelineId: past.pipelineId, ...body });
    if (!s.ok) return s;
    if (s.data.skipped.length) notify({ tone: 'info', title: 'Some files were left out', detail: `${s.data.skipped.join(', ')}: larger than 5 MB, or more than 8 files.` });
    if (currentView() === 'workflows' && wftWorkflowId() === past.workflowId) void wftOpenExample(s.data.example.id);
    else location.hash = `workflows/${past.workflowId}/tests/${s.data.example.id}`;   // routeWorkflows opens the editor
    return { ok: true };
  } });
}
/** G6: the saved run page's ⋯ item. `data.state.stepper` is the run's manifest (artifacts.mjs rowToState). */
function wftRunMenuItems(record, data) {
  const st = data && data.state;
  const tpl = st && st.stepper && st.stepper.template;
  const ok = canUseAsExample({ flag: flagOn('workflowTests'), noProject: !!st && isNoProjectRun({ ...(record || {}), state: st }),
    status: st && st.status, templateId: tpl && tpl.id, reserved: !!(tpl && tpl.id && isReservedWorkflowId(tpl.id)) });
  return ok ? [{ label: 'Use as test example', onSelect: () => void wftAddFromRun(record.id) }] : [];
}
```
In the saved page's `.hd-bar-more` listener, change the `toggleMenu` call to:
```js
    toggleMenu({ doc: document, anchor: e.currentTarget, items: runMoreItems(screen, { extra: wftRunMenuItems(histDetailState && histDetailState.record, histDetailState && histDetailState.data) }), align: 'end', label: 'More for this run' });
```

- [ ] **Step 6: Styles** (append to the Task 10 block, before its `@media (max-width:900px)` line)

```css
.wft-fr-intro{margin:0 0 4px;}
.wft-keep{display:flex;flex-direction:column;gap:2px;margin-bottom:12px;}
.wft-keep .wft-chk .hint{display:inline;margin:0;}
.wft-fr-hint{margin:0;}
```

In `test/ui-shared-controls.test.mjs` `JS_CHECKBOX_OK`, after Task 10's `wft-pick-box` row, add:
```js
  ['workflows/test-dialogs.mjs', 'wft-keep-box', 'picks what to keep from the past run: its request and files, its answers'],
```

- [ ] **Step 7: Run the tests and the design guards**

Run: `node tools/test.mjs test/ui-workflow-test-dialogs.test.mjs test/ui-workflow-tests-view.test.mjs test/ui-no-project-run-page.test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs`
Then the style.css slicing tests (the list in the Global Constraints).
Expected: PASS, except the four known `ui-design-language` failures.

- [ ] **Step 8: Commit**

```bash
git add ui/public/workflows/test-dialogs.mjs ui/public/app.js ui/public/style.css test/ui-workflow-test-dialogs.test.mjs test/ui-shared-controls.test.mjs
git commit -m "Workflow tests: use a past run as a test example (the run page's More menu and the Tests list)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 13: Test a version (boards 4, 30) and While the test runs (boards 20, 27, 28)

**Precondition:** the screens are the approved boards 4 RunSuite, 30 TestConnectors (the Connectors section), 20 RunProgress, 27 RunStopped and 28 RunDone, and board 29's C12 and C16 states. They were approved on 2026-10-26. If the controller reports a later change to one of them, apply it to this task's text before starting.

**Files:**
- Modify: `ui/public/workflows/test-dialogs.mjs` (add `openTestVersionDialog`)
- Create: `ui/public/workflows/test-progress.mjs`
- Modify `ui/public/app.js`:
  - the imports
  - Task 10's `wftTestVersion`, `wftReadView` and `wftRenderView` bodies
  - `wftProgressActions`
  - the WS dispatcher, beside `requirements-changed` (:1776)
- Modify: `ui/public/style.css` (append to the Part 2 block, before its `@media (max-width:900px)` line)
- Modify: `test/ui-shared-controls.test.mjs`, one `JS_CHECKBOX_OK` row (the reuse and quick-check opt-ins)
- Test: `test/ui-workflow-test-dialogs.test.mjs` (extend), `test/ui-workflow-test-progress.test.mjs`

**Interfaces:**
- Consumes:
  - `GET …/tests/plan` and `POST …/tests/runs` (Task 9); the Part 1 versions overview (`gvApi.versions`)
  - `estimateOf`, `fmtUsdRange`, `aboutUsd`, `useLabel` (Task 8); `andList` (Task 1); `icon` (`ui/public/icons.mjs`)
  - the plan's `connectors: { mode, pretend, off, scripts }` (Task 9, board 30)
  - `GET …/runs/:run`, `POST …/runs/:run/stop`, `POST …/runs/:run/continue`
- Produces:
  - `openTestVersionDialog({ doc, win, options:[{use,label}], a, b, examples:[{id,name,tries}], exampleIds?, connectors?, dateText, loadPlan(q) → Promise<plan|null>, onStart(body) → Promise<{ok, error?}> })`, where:
    - `q = { a, b, examples: '1,2', tries: '3', connectors: 'pretend'|'real' }` (strings, for `URLSearchParams`)
    - `body = { a, b, exampleIds, tries, reuseA, reuseB, quickCheck, capUsd, connectors }`
    - Start reads "Start" while disabled for no saved version or the same version twice, "Start N tries" otherwise (C16)
  - `scriptCaution(names) → { lead, name, rest } | null` (C19)
  - `renderTestProgress(root, progress, actions, { doc })`, where `actions = { back(), stop(), continue(capUsd|null), open() }`. Its pill is the status pill of every state (D39): `pill-run peach` while it runs, `pill-run green is-parked` when done, `pill-run is-stopped is-parked` when stopped. A `changed` stop offers no "Finish the rest".
  - DOM ids: `#wft-tv-a`, `#wft-tv-b`, `#wft-tv-examples`, `#wft-tv-reuse-a`, `#wft-tv-reuse-b`, `#wft-tv-conn-pretend`, `#wft-tv-conn-real`, `#wft-tv-quick`, `#wft-tv-cap`, `#wft-pg-cap`
  - app.js: `wftTestVersion({ a?, b?, exampleIds? })`, `wftProgressActions()`, `wftChanged(frame)` (C13; it reads `frame.testRunId`, D33)

- [ ] **Step 1: Extend the failing dialog test.** Append to `test/ui-workflow-test-dialogs.test.mjs`. Add `openTestVersionDialog` and `scriptCaution` to its import line from `../ui/public/workflows/test-dialogs.mjs`, then add:

```js
const SIX = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `Example ${id}`, tries: 3 }));
const OPTIONS = [{ use: 3, label: 'v3' }, { use: 4, label: 'v4 · the team uses it' }, { use: 'draft', label: 'v5 draft · your changes' }];
const planFor = (q) => {
  const n = q.examples.split(',').length * Number(q.tries);
  return {
    a: { use: 4, label: 'v4 · the team uses it', short: 'v4', want: n, reusable: n, reusableAt: '2026-10-19T10:00:00Z', perTryUsd: 0.84, savesUsd: n * 0.84 },
    b: { use: 'draft', label: 'v5 draft · your changes', short: 'v5 draft', want: n, reusable: 0, reusableAt: null, perTryUsd: 0.52, savesUsd: 0 },
    examples: n / Number(q.tries), tries: Number(q.tries), perTryMs: 280000,
    connectors: { mode: q.connectors, pretend: ['jira_team', 'slack_team'],
      off: [{ name: 'Google Drive', reason: 'claude-ai' }, { name: 'confluence_team', reason: 'no-tools' }], scripts: ['Publish to wiki'] },
  };
};
function openTv(over = {}) {
  const { doc, win } = dom();
  const plans = []; const started = [];
  openTestVersionDialog({ doc, win, options: OPTIONS, a: 4, b: 'draft', examples: SIX, dateText: () => '19 Oct',
    loadPlan: async (q) => { plans.push(q); return planFor(q); }, onStart: async (body) => { started.push(body); return { ok: true }; }, ...over });
  return { doc, plans, started };
}
const estRows = (doc) => [...doc.querySelectorAll('.wft-est-row')].map((r) => [...r.children].map((c) => c.textContent));
const change = (node) => node.dispatchEvent(new node.ownerDocument.defaultView.Event('change'));

test('board 4: v4 against the draft, v4 reused, the live estimate, Start N tries', async () => {
  const { doc, plans, started } = openTv();
  await tick();
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Test a version');
  assert.deepEqual([doc.querySelector('#wft-tv-a').value, doc.querySelector('#wft-tv-b').value], ['4', 'draft']);
  assert.deepEqual([...doc.querySelector('#wft-tv-a').options].map((o) => o.textContent), ['v3', 'v4 · the team uses it']);
  assert.deepEqual(plans[0], { a: '4', b: 'draft', examples: '1,2,3,4,5,6', tries: '3', connectors: 'pretend' });
  assert.equal(doc.querySelector('.wft-reuse .wft-chk').textContent,
    "Use v4's results from 19 Oct. Nothing in v4 or in the examples has changed since, so only v5 draft needs to be tried. This saves about $15.");
  assert.deepEqual([...doc.querySelector('#wft-tv-examples').options].map((o) => o.textContent), ['All 6', 'Example 1', 'Example 2', 'Example 3', 'Example 4', 'Example 5', 'Example 6']);
  assert.equal(doc.querySelector('.wft-tv-tries .seg button.on').textContent, '3');
  assert.equal(doc.querySelector('#wft-tv-quick').checked, true);
  assert.equal(doc.querySelector('#wft-tv-quick').closest('label').textContent, 'Do a free quick check first. Worca makes sure every step of the workflow is connected, without using AI.');
  assert.equal(doc.querySelector('.wft-safe').textContent, 'Tests never touch real work through your connectors.');
  assert.deepEqual(estRows(doc), [['18 tries of v5 draft', 'about $9.36'], ['v4 results from 19 Oct', '$0.00'], ['Total · ready in about 28 minutes', '$9 to $11']]);
  assert.equal(doc.querySelector('#wft-tv-cap').value, '$15');
  assert.equal(doc.querySelector('#wft-tv-cap').closest('.field').querySelector('.hint').textContent, 'Tests count in your spending limit. You can close this page: Worca tells you when the results are ready.');
  const ok = doc.querySelector('.wft-dlg-ok');
  assert.deepEqual([ok.textContent, ok.disabled], ['Start 18 tries', false]);
  click([...doc.querySelectorAll('.wft-tv-tries .seg button')].find((b) => b.textContent === '1 · quick look'));
  await tick();
  assert.equal(plans.at(-1).tries, '1');
  assert.equal(ok.textContent, 'Start 6 tries');
  const reuse = doc.querySelector('#wft-tv-reuse-a');
  reuse.checked = false; change(reuse);
  assert.equal(ok.textContent, 'Start 12 tries');
  click(ok);
  await tick();
  assert.deepEqual(started, [{ a: 4, b: 'draft', exampleIds: [1, 2, 3, 4, 5, 6], tries: 1, reuseA: false, reuseB: false, quickCheck: true, capUsd: 15, connectors: 'pretend' }]);
});

test('board 30: Connectors, Pretend by default with its notes; Real warns, hides the promise, and is sent (D35, C19)', async () => {
  const { doc, plans, started } = openTv();
  await tick();
  assert.equal(doc.querySelector('.wft-conn legend').textContent, 'Connectors');
  const [pretend, real] = [...doc.querySelectorAll('input[name="wft-tv-conn"]')];
  assert.deepEqual([pretend.id, pretend.checked, real.id, real.checked], ['wft-tv-conn-pretend', true, 'wft-tv-conn-real', false]);
  assert.deepEqual([...doc.querySelectorAll('.wft-conn .radio-card-text')].map((t) => t.textContent), [
    'PretendYour connectors are replaced by stand-ins. Nothing is posted or sent, and Worca shows what would have been sent. Anything the workflow reads from them comes back empty.',
    'RealTries use your real connectors. If the workflow posts or sends something, it does it in every try: 18 times in this test.',
  ]);
  assert.deepEqual([...doc.querySelectorAll('.wft-conn-notes li')].map((li) => li.textContent), [
    'jira_team, slack_team: pretend',
    "Google Drive is switched off: Worca can't pretend for claude.ai connectors.",
    'confluence_team is switched off: test it once in Connectors so Worca knows its tools.',
  ]);
  assert.equal(doc.querySelector('.wft-conn-notes a').getAttribute('href'), '#connectors');
  assert.equal(doc.querySelector('.wft-caution').textContent, 'The script step Publish to wiki runs as in a normal run. If it posts or sends something, it does it in every try.');
  real.checked = true; change(real);
  await tick();
  assert.equal(plans.at(-1).connectors, 'real', 'reuse is counted per mode (D26)');
  assert.deepEqual([doc.querySelector('.wft-safe').hidden, doc.querySelector('.wft-conn-notes').hidden, doc.querySelector('.wft-caution').hidden], [true, true, false]);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(started[0].connectors, 'real');
  assert.equal(scriptCaution([]), null);
  const two = scriptCaution(['Publish to wiki', 'Post to Slack']);
  assert.equal(two.lead + two.name + two.rest, 'The script steps Publish to wiki and Post to Slack run as in a normal run. If they post or send something, they do it in every try.');
});

test('C16 with no saved version; two equal versions; one example starts at its own tries (G10); the cap must be a number', async () => {
  const none = openTv({ options: [{ use: 'draft', label: 'Your draft' }], a: null });
  await tick();
  const selA = none.doc.querySelector('#wft-tv-a');
  assert.deepEqual([selA.disabled, selA.options[0].textContent], [true, 'No saved version yet']);
  assert.equal(none.doc.querySelector('.wft-tv-note').textContent, 'Save a version first: a test compares two versions. Try it once now tries one example on your draft.');
  assert.deepEqual([none.doc.querySelector('.wft-dlg-ok').disabled, none.doc.querySelector('.wft-dlg-ok').textContent], [true, 'Start']);
  assert.equal(none.plans.length, 0);
  const same = openTv();
  await tick();
  const b = same.doc.querySelector('#wft-tv-b');
  b.value = '4'; change(b);
  await tick();
  assert.deepEqual([same.doc.querySelector('.wft-tv-note').textContent, same.doc.querySelector('.wft-dlg-ok').disabled, same.doc.querySelector('.wft-dlg-ok').textContent],
    ['Pick two different versions.', true, 'Start']);
  const one = openTv({ examples: [{ id: 1, name: 'A', tries: 5 }, { id: 2, name: 'B', tries: 1 }], exampleIds: [2] });
  await tick();
  assert.equal(one.doc.querySelector('.wft-tv-tries .seg button.on').textContent, '1 · quick look');
  assert.deepEqual(one.plans[0], { a: '4', b: 'draft', examples: '2', tries: '1', connectors: 'pretend' });
  const ex = one.doc.querySelector('#wft-tv-examples');
  ex.value = 'all'; change(ex);
  await tick();
  assert.equal(one.doc.querySelector('.wft-tv-tries .seg button.on').textContent, '5');
  const cap = one.doc.querySelector('#wft-tv-cap');
  cap.value = 'lots'; cap.dispatchEvent(new one.doc.defaultView.Event('input'));
  click(one.doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(one.doc.querySelector('.wft-dlg-error').textContent, 'Give the cost limit in dollars, such as $15.');
});
```

- [ ] **Step 2: Write the failing progress test.** Create `test/ui-workflow-test-progress.test.mjs`:

```js
// test/ui-workflow-test-progress.test.mjs — While the test runs, stopped, done (canvas boards 20, 27, 28; C7, C9, G8, D39).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTestProgress } from '../ui/public/workflows/test-progress.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const progress = (over = {}, run = {}) => ({
  run: { id: 9, kind: 'compare', a: 4, b: 'draft', tries: 3, status: 'running', stopReason: null, stopDetail: null, exampleIds: [1, 2, 3], ...run },
  title: 'Testing your v5 draft',
  rows: [
    { exampleId: 1, name: 'Offline mode for the field app', label: null, dots: ['passed', 'passed', 'passed'], summary: 'Done · 3 of 3 passed' },
    { exampleId: 2, name: 'Bulk invoice export', label: null, dots: ['passed', 'failed', 'running'], summary: 'Trying 3 of 3' },
    { exampleId: 3, name: 'Customer data export (GDPR)', label: null, dots: ['waiting', 'waiting', 'waiting'], summary: 'Waiting' },
  ],
  done: 7, total: 18, costUsd: 3.8, estimateUsd: 10, capUsd: 15, minutesLeft: 15, quick: { status: 'passed' }, ...over,
});
function boot(p) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const root = window.document.getElementById('root');
  renderTestProgress(root, p, { back: () => calls.push(['back']), stop: () => calls.push(['stop']), continue: (c) => calls.push(['continue', c]), open: () => calls.push(['open']) }, { doc: window.document });
  return { root, calls };
}
const facts = (root) => [...root.querySelectorAll('.wft-fact')].map((f) => [...f.children].map((c) => c.textContent));

test('board 20 while it runs: title, pill, Stop testing, the bar, the facts, the rows', () => {
  const { root, calls } = boot(progress());
  assert.equal(root.querySelector('.wft-title').textContent, 'Testing your v5 draft');
  assert.equal(root.querySelector('.wft-pill').textContent, 'Testing · 7 of 18 tries done');
  assert.ok(root.querySelector('.wft-pill').classList.contains('pill-run'));
  const stop = root.querySelector('.wft-acts .btn-danger');
  assert.equal(stop.textContent, 'Stop testing');
  const bar = root.querySelector('.wft-bar');
  assert.deepEqual([bar.getAttribute('role'), bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax'), bar.firstElementChild.style.width], ['progressbar', '7', '18', '39%']);
  assert.deepEqual(facts(root), [['Time left', 'about 15 min'], ['Cost so far', '$3.80', 'of about $10 · stops at $15'], ['Free quick check', 'Passed', 'every step is connected']]);
  assert.equal(root.querySelector('.wft-prog > .hint').textContent, 'You can close this page or keep working. Worca tells you when the results are ready. Results so far are not final: wait for all 3 tries of an example.');
  const rows = [...root.querySelectorAll('.wft-prow:not(.is-head)')];
  assert.deepEqual(rows.map((r) => [...r.querySelectorAll('.wft-try-dot')].map((t) => t.className)), [
    ['wft-try-dot ok', 'wft-try-dot ok', 'wft-try-dot ok'], ['wft-try-dot ok', 'wft-try-dot no', 'wft-try-dot run'], ['wft-try-dot', 'wft-try-dot', 'wft-try-dot']]);
  assert.deepEqual(rows.map((r) => r.querySelector('.wft-tries').getAttribute('aria-label')), ['3 passed', '1 passed, 1 not passed, 1 trying', 'Waiting']);
  assert.deepEqual(rows.map((r) => r.lastElementChild.textContent), ['Done · 3 of 3 passed', 'Trying 3 of 3', 'Waiting']);
  assert.equal(root.querySelector('.wft-page > .hint').textContent, 'Stop testing keeps the tries that are done. You can finish the rest later without paying for them twice.');
  click(stop);
  click(root.querySelector('.wft-crumb'));
  assert.deepEqual(calls, [['stop'], ['back']]);
});

test('stopped by the cap: why, a higher cap and Finish the rest (C7); by a person: no cap field', () => {
  const capped = boot(progress({ costUsd: 15.4 }, { status: 'stopped', stopReason: 'cap' }));
  assert.equal(capped.root.querySelector('.wft-pill').textContent, 'Stopped · 7 of 18 tries done');
  assert.equal(capped.root.querySelector('.wft-pill').className, 'pill-run wft-pill is-stopped is-parked', 'D39: the status pill, not a badge');
  assert.ok(capped.root.querySelector('.wft-pill .pdot'));
  assert.equal(capped.root.querySelector('.wft-stopped').textContent, 'Stopped: the cost went over $15.');
  assert.equal(capped.root.querySelector('#wft-pg-cap').value, '$25');
  click([...capped.root.querySelectorAll('.wft-acts button')].find((b) => b.textContent === 'Finish the rest'));
  assert.deepEqual(capped.calls, [['continue', 25]]);
  const person = boot(progress({}, { status: 'stopped', stopReason: 'person' }));
  assert.equal(person.root.querySelector('#wft-pg-cap'), null);
  assert.equal(person.root.querySelector('.wft-stopped').textContent, 'You stopped the test.');
  click([...person.root.querySelectorAll('.wft-acts button')].find((b) => b.textContent === 'Finish the rest'));
  assert.deepEqual(person.calls, [['continue', null]]);
  const quick = boot(progress({ quick: { status: 'failed', detail: 'the quick check ended as error' } }, { status: 'stopped', stopReason: 'quick-check', stopDetail: 'the quick check ended as error' }));
  assert.deepEqual(facts(quick.root)[2], ['Free quick check', 'Not passed', 'the quick check ended as error']);
  assert.equal(quick.root.querySelector('.wft-stopped').textContent, 'The free quick check did not pass: the quick check ended as error');
});

test('done: See what changed (or See the result after Try it once now); two rows per example when both versions are tried (G8)', () => {
  const done = boot(progress({ done: 18, minutesLeft: null, quick: null }, { status: 'done' }));
  assert.deepEqual([done.root.querySelector('.wft-pill').textContent, done.root.querySelector('.wft-pill').className], ['Done · 18 of 18 tries done', 'pill-run green wft-pill is-parked']);
  assert.deepEqual(facts(done.root)[0], ['Time left', 'none']);
  assert.deepEqual(facts(done.root)[2], ['Free quick check', 'Off']);
  click(done.root.querySelector('.wft-acts .btn-primary'));
  assert.deepEqual([done.root.querySelector('.wft-acts .btn-primary').textContent, done.calls], ['See what changed', [['open']]]);
  const once = boot(progress({ done: 1, total: 1, rows: [{ exampleId: 1, name: 'Bulk', label: null, dots: ['passed'], summary: 'Done · 1 of 1 passed' }] }, { kind: 'once', status: 'done', tries: 1 }));
  assert.equal(once.root.querySelector('.wft-acts .btn-primary').textContent, 'See the result');
  assert.equal(once.root.querySelector('.wft-pill').textContent, 'Done · 1 of 1 try done');
  const two = boot(progress({ rows: [
    { exampleId: 1, name: 'Bulk', label: 'v4', dots: ['passed'], summary: 'Done · 1 of 1 passed' },
    { exampleId: 1, name: 'Bulk', label: 'v5 draft', dots: ['running'], summary: 'Trying 1 of 1' }] }, { tries: 1 }));
  assert.deepEqual([...two.root.querySelectorAll('.wft-prow:not(.is-head)')].map((r) => r.firstElementChild.textContent), ['Bulk · v4', 'Bulk · v5 draft']);
  assert.equal(two.root.querySelector('.wft-prog > .hint').textContent, 'You can close this page or keep working. Worca tells you when the results are ready.');
});

test('stopped by a change during the test (D27): the C18 sentence, and no Finish the rest', () => {
  const ch = boot(progress({}, { status: 'stopped', stopReason: 'changed', stopDetail: 'Your draft changed since this test started: start a new test.' }));
  assert.equal(ch.root.querySelector('.wft-stopped').textContent, 'Your draft changed since this test started: start a new test.');
  assert.equal([...ch.root.querySelectorAll('.wft-acts button')].some((b) => b.textContent === 'Finish the rest'), false);
  assert.equal(ch.root.querySelector('#wft-pg-cap'), null);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node tools/test.mjs test/ui-workflow-test-dialogs.test.mjs test/ui-workflow-test-progress.test.mjs`
Expected: FAIL. `openTestVersionDialog` is not exported, and `test-progress.mjs` is missing.

- [ ] **Step 4: Add `openTestVersionDialog` to `ui/public/workflows/test-dialogs.mjs`**

Add to its imports:
```js
import { icon } from '../icons.mjs';
import { fmtUsd, andList } from '../../../src/shared/workflow-tests/checks.mjs';
import { estimateOf, fmtUsdRange, aboutUsd } from '../../../src/shared/workflow-tests/compare.mjs';
```
Append:
```js
/** C19: the script steps a try runs as in a normal run, in both modes. null when there is none. */
export function scriptCaution(names) {
  if (!names || !names.length) return null;
  return names.length === 1
    ? { lead: 'The script step ', name: names[0], rest: ' runs as in a normal run. If it posts or sends something, it does it in every try.' }
    : { lead: 'The script steps ', name: andList(names), rest: ' run as in a normal run. If they post or send something, they do it in every try.' };
}
const useOfValue = (v) => (v === 'draft' ? 'draft' : Number(v));

/** Board 4's reuse sentence (C6 for a partial reuse). */
function reuseWords(s, other, dateText) {
  const when = s.reusableAt ? dateText(s.reusableAt) : 'earlier';
  const saves = typeof s.savesUsd === 'number' && s.savesUsd > 0 ? ` This saves about ${aboutUsd(s.savesUsd)}.` : '';
  const otherShort = other ? other.short : 'the other version';
  return s.reusable >= s.want
    ? { lead: `Use ${s.short}'s results from ${when}. `, rest: `Nothing in ${s.short} or in the examples has changed since, so only ${otherShort} needs to be tried.${saves}` }
    : { lead: `Use ${s.short}'s ${s.reusable} results from ${when}. `, rest: `Nothing in ${s.short} or in those examples has changed since, so only the other tries are made.${saves}` };
}

/**
 * Boards 4 and 30: Test a version (G10, G12, G16, C6, C12, C16, C19). The plan comes from the server per pick (loadPlan);
 * the estimate, the default cost cap, the connectors' notes and "Start N tries" follow it live.
 */
export function openTestVersionDialog({ doc, win, options = [], a = null, b = 'draft', examples = [], exampleIds = null, connectors = 'pretend',
  dateText, loadPlan, onStart }) {
  const versions = options.filter((o) => o.use !== 'draft');
  const selA = el(doc, 'select');
  selA.id = 'wft-tv-a';
  if (!versions.length) { const o = el(doc, 'option', '', 'No saved version yet'); o.value = ''; selA.append(o); selA.disabled = true; }
  for (const o of versions) { const x = el(doc, 'option', '', o.label); x.value = String(o.use); selA.append(x); }
  if (a != null && versions.some((o) => o.use === a)) selA.value = String(a);
  const selB = el(doc, 'select');
  selB.id = 'wft-tv-b';
  for (const o of options) { const x = el(doc, 'option', '', o.label); x.value = String(o.use); selB.append(x); }
  selB.value = String(b);
  const pickEx = el(doc, 'select');
  pickEx.id = 'wft-tv-examples';
  const allOpt = el(doc, 'option', '', `All ${examples.length}`);
  allOpt.value = 'all';
  pickEx.append(allOpt);
  for (const e of examples) { const x = el(doc, 'option', '', e.name); x.value = String(e.id); pickEx.append(x); }
  if (Array.isArray(exampleIds) && exampleIds.length === 1) pickEx.value = String(exampleIds[0]);
  const chosen = () => (pickEx.value === 'all' ? examples : examples.filter((e) => String(e.id) === pickEx.value));
  const startTries = () => { const t = Math.max(1, ...chosen().map((e) => e.tries || 3)); return [1, 3, 5].includes(t) ? t : 3; };   // G10
  let tries = startTries();
  let triesTouched = false;
  const triesSeg = seg(doc, 'Tries per example', [[1, '1 · quick look'], [3, '3'], [5, '5']], tries, (v) => { tries = Number(v); triesTouched = true; void refresh(); });
  const setTries = (v) => { for (const x of triesSeg.children) { const on = x.dataset.value === String(v); x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); } };
  // Opt-ins next to the estimate: checkboxes, listed in test/ui-shared-controls.test.mjs JS_CHECKBOX_OK (token wft-tv-optin).
  const boxA = el(doc, 'input', 'wft-tv-optin'); boxA.type = 'checkbox'; boxA.id = 'wft-tv-reuse-a'; boxA.checked = true;
  const boxB = el(doc, 'input', 'wft-tv-optin'); boxB.type = 'checkbox'; boxB.id = 'wft-tv-reuse-b'; boxB.checked = true;
  const reuse = el(doc, 'div', 'wft-reuse');
  const quick = el(doc, 'input', 'wft-tv-optin'); quick.type = 'checkbox'; quick.id = 'wft-tv-quick'; quick.checked = true;
  const quickRow = el(doc, 'label', 'wft-chk');
  quickRow.append(quick, doc.createTextNode('Do a free quick check first.'), el(doc, 'span', 'hint', ' Worca makes sure every step of the workflow is connected, without using AI.'));
  // D21 with D35: the promise holds only with Pretend connectors, so it shows only then.
  const safe = el(doc, 'div', 'wft-safe');
  safe.append(icon(doc, 'shield', 16), el(doc, 'b', '', 'Tests never touch real work through your connectors.'));
  // ── Connectors (board 30, C19, D35) ──
  let mode = connectors === 'real' ? 'real' : 'pretend';
  const conn = el(doc, 'fieldset', 'wft-conn');
  conn.append(el(doc, 'legend', '', 'Connectors'));
  const option = (value, title) => {
    const l = el(doc, 'label', 'radio-card');
    const r = el(doc, 'input');
    r.type = 'radio'; r.name = 'wft-tv-conn'; r.value = value; r.id = `wft-tv-conn-${value}`; r.checked = mode === value;
    const words = el(doc, 'span', 'radio-card-text');
    const hint = el(doc, 'span', 'hint');
    words.append(el(doc, 'b', '', title), hint);
    l.append(r, words);
    r.addEventListener('change', () => { if (r.checked) { mode = value; void refresh(); } });
    return { l, hint };
  };
  const pretendOpt = option('pretend', 'Pretend');
  pretendOpt.hint.textContent = 'Your connectors are replaced by stand-ins. Nothing is posted or sent, and Worca shows what would have been sent. Anything the workflow reads from them comes back empty.';
  const realOpt = option('real', 'Real');
  const notes = el(doc, 'ul', 'wft-conn-notes');
  notes.setAttribute('aria-label', 'Connectors in this workflow');
  const caution = el(doc, 'p', 'wft-caution');
  caution.setAttribute('role', 'note');
  conn.append(pretendOpt.l, notes, realOpt.l, caution);
  const est = el(doc, 'div', 'wft-est');
  est.setAttribute('aria-live', 'polite');
  const cap = el(doc, 'input');
  cap.type = 'text'; cap.inputMode = 'decimal'; cap.id = 'wft-tv-cap';
  let capTouched = false;
  cap.addEventListener('input', () => { capTouched = true; });
  const note = el(doc, 'p', 'hint wft-tv-note');
  let plan = null;
  let seq = 0;
  const vs = el(doc, 'div', 'wft-vs');
  vs.append(field(doc, 'Compare', selA, { id: selA.id }), el(doc, 'span', 'wft-vs-with', 'with'), field(doc, 'Second version', selB, { id: selB.id }));
  const triesField = field(doc, 'Tries per example', triesSeg);
  triesField.classList.add('wft-tv-tries');
  const row2 = el(doc, 'div', 'wft-row2');
  row2.append(field(doc, 'Examples', pickEx, { id: pickEx.id }), triesField);
  const reused = (side) => !!(plan && plan[side] && plan[side].reusable) && (side === 'a' ? boxA : boxB).checked;

  const dlg = testDialog({
    doc, win, title: 'Test a version', confirmLabel: 'Start',
    body: [vs, reuse, row2, conn, quickRow, safe, est,
      field(doc, 'Stop if the cost goes over', cap, { id: cap.id, hint: 'Tests count in your spending limit. You can close this page: Worca tells you when the results are ready.' }), note],
    onConfirm: () => {
      const capUsd = Number(String(cap.value).replace(/[^0-9.]/g, ''));
      if (!(capUsd > 0)) return { ok: false, error: 'Give the cost limit in dollars, such as $15.' };
      return onStart({ a: useOfValue(selA.value), b: useOfValue(selB.value), exampleIds: chosen().map((e) => e.id), tries,
        reuseA: reused('a'), reuseB: reused('b'), quickCheck: quick.checked, capUsd, connectors: mode });
    },
  });

  function paint() {
    reuse.replaceChildren();
    est.replaceChildren();
    note.textContent = '';
    const noA = !versions.length;
    const same = !noA && selA.value === selB.value;
    if (plan) {
      for (const [side, box, other] of [['a', boxA, 'b'], ['b', boxB, 'a']]) {
        const s = plan[side];
        if (!s || !s.reusable) continue;
        const words = reuseWords(s, plan[other], dateText);
        const row = el(doc, 'label', 'wft-chk');
        row.append(box, doc.createTextNode(words.lead), el(doc, 'span', 'hint', words.rest));
        reuse.append(row);
      }
    }
    const e = plan && !same ? estimateOf(plan, { reuseA: reused('a'), reuseB: reused('b') }) : null;
    if (e) {
      const line = (left, right, cls = '') => {
        const r = el(doc, 'div', `wft-est-row${cls ? ` ${cls}` : ''}`);
        r.append(el(doc, 'span', '', left), el(doc, 'span', 'code', right));
        est.append(r);
      };
      const priced = (s, n) => (s && typeof s.perTryUsd === 'number' && Number.isFinite(s.perTryUsd) ? `about ${fmtUsd(n * s.perTryUsd)}` : 'cost not known yet');   // C12
      const tries1 = (n) => `${n} ${n === 1 ? 'try' : 'tries'}`;
      if (e.toRun.b) line(`${tries1(e.toRun.b)} of ${plan.b.short}`, priced(plan.b, e.toRun.b));
      if (plan.a && e.toRun.a) line(`${tries1(e.toRun.a)} of ${plan.a.short}`, priced(plan.a, e.toRun.a));
      for (const side of ['a', 'b']) {
        if (reused(side)) line(`${plan[side].short} results from ${plan[side].reusableAt ? dateText(plan[side].reusableAt) : 'earlier'}`, '$0.00');
      }
      line(e.minutes ? `Total · ready in about ${e.minutes} minutes` : 'Total', e.usd === null ? 'cost not known yet' : fmtUsdRange(e.low, e.high), 'is-total');
      if (!capTouched) cap.value = `$${e.capUsd}`;
    }
    const total = e ? e.total : 0;
    // C16: a disabled Start for no saved version or the same version twice reads just "Start"; "Start 0 tries" only when all is reused.
    dlg.okButton.textContent = noA || same || !e ? 'Start' : `Start ${total} ${total === 1 ? 'try' : 'tries'}`;
    dlg.okButton.disabled = noA || same || !e || total === 0;
    paintConnectors(e);
    if (noA) note.textContent = 'Save a version first: a test compares two versions. Try it once now tries one example on your draft.';   // C16
    else if (same) note.textContent = 'Pick two different versions.';
    else if (e && total === 0) note.textContent = 'Nothing to try: both versions have results for these examples.';
  }

  /** Board 30: the Real sentence names how often a post would go out; Pretend lists each connector; the script caution stays. */
  function paintConnectors(e) {
    const n = e ? e.total : null;
    realOpt.hint.textContent = `Tries use your real connectors. If the workflow posts or sends something, it does it in every try${n === null ? '' : n === 1 ? ': once in this test' : `: ${n} times in this test`}.`;
    const c = plan && plan.connectors;
    notes.replaceChildren();
    const line = (name, parts) => {
      const li = el(doc, 'li');
      const words = el(doc, 'span');
      words.append(...parts);
      li.append(icon(doc, name, 13), words);
      notes.append(li);
    };
    if (c && mode === 'pretend') {
      if (c.pretend.length) line('check', [doc.createTextNode(`${c.pretend.join(', ')}: pretend`)]);
      for (const o of c.off) {
        if (o.reason === 'claude-ai') line('x', [doc.createTextNode(`${o.name} is switched off: Worca can't pretend for claude.ai connectors.`)]);
        else if (o.reason === 'own-settings') line('x', [doc.createTextNode(`${o.name} is switched off: Worca can't pretend for servers in your own Claude Code settings.`)]);
        else {
          const link = el(doc, 'a', '', 'test it once in Connectors');
          link.href = '#connectors';
          line('x', [doc.createTextNode(`${o.name} is switched off: `), link, doc.createTextNode(' so Worca knows its tools.')]);
        }
      }
    }
    notes.hidden = !notes.children.length;
    const sc = scriptCaution(c ? c.scripts : []);
    caution.replaceChildren();
    caution.hidden = !sc;
    if (sc) {
      const words = el(doc, 'span');
      words.append(doc.createTextNode(sc.lead), el(doc, 'b', '', sc.name), doc.createTextNode(sc.rest));
      caution.append(icon(doc, 'alert', 14), words);
    }
    safe.hidden = mode !== 'pretend';
  }

  async function refresh() {
    const my = (seq += 1);
    plan = null;
    paint();
    if (!selA.value || selA.value === selB.value) return;
    const p = await loadPlan({ a: selA.value, b: selB.value, examples: chosen().map((e) => e.id).join(','), tries: String(tries), connectors: mode });
    if (my !== seq) return;
    plan = p;
    paint();
  }

  selA.addEventListener('change', () => void refresh());
  selB.addEventListener('change', () => void refresh());
  pickEx.addEventListener('change', () => { if (!triesTouched) { tries = startTries(); setTries(tries); } void refresh(); });
  boxA.addEventListener('change', paint);
  boxB.addEventListener('change', paint);
  void refresh();
  return dlg;
}
```

- [ ] **Step 5: Create `ui/public/workflows/test-progress.mjs`**

```js
// ui/public/workflows/test-progress.mjs — While the test runs, stopped and done (canvas boards 20, 27, 28;
// plans/workflow-tests-part2-plan.md Task 13, C7, C9, G8, D39). Pure DOM: app.js reads GET …/runs/:run and repaints on
// every workflow-tests-changed frame.
import { el, btn } from './test-ui.mjs';
import { fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { aboutUsd } from '../../../src/shared/workflow-tests/compare.mjs';

const DOT = { passed: 'ok', failed: 'no', running: 'run' };
/** C7: why a test stopped. */
const STOPPED = {
  cap: (p) => `Stopped: the cost went over ${aboutUsd(p.capUsd)}.`,
  person: () => 'You stopped the test.',
  budget: () => 'Stopped: the spending limit is reached.',
  'quick-check': (p) => `The free quick check did not pass: ${p.run.stopDetail || 'a step is not connected'}`,
  restart: () => 'Stopped when Worca restarted.',
  drain: () => 'Stopped: Worca is shutting down.',
  refused: (p) => `Stopped: ${p.run.stopDetail || 'a try did not start'}`,
  changed: (p) => p.run.stopDetail || 'Something this test uses changed: start a new test.',   // D27: the C18 sentence
  error: (p) => `Stopped: ${p.run.stopDetail || 'something went wrong'}`,
};

function dotsLabel(dots) {
  const n = (s) => dots.filter((d) => d === s).length;
  const parts = [];
  if (n('passed')) parts.push(`${n('passed')} passed`);
  if (n('failed')) parts.push(`${n('failed')} not passed`);
  if (n('running')) parts.push(`${n('running')} trying`);
  return parts.length ? parts.join(', ') : 'Waiting';
}
function fact(doc, label, value, sub = null) {
  const f = el(doc, 'div', 'wft-fact');
  f.append(el(doc, 'span', '', label), el(doc, 'b', '', value));
  if (sub) f.append(el(doc, 'span', '', sub));
  return f;
}

/**
 * @param {HTMLElement} root
 * @param {object} p GET /api/workflows/:id/tests/runs/:run (service.progressOf)
 * @param {{back:Function, stop:Function, continue:(capUsd:number|null)=>void, open:Function}} actions
 */
export function renderTestProgress(root, p, actions, { doc }) {
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page wft-progress');
  const st = p.run.status;
  const count = `${p.done} of ${p.total} ${p.total === 1 ? 'try' : 'tries'} done`;
  // D39: board 20's status pill in every state, its dot still once the test is over (green done, grey stopped).
  const pill = el(doc, 'span', st === 'running' ? 'pill-run peach wft-pill' : st === 'done' ? 'pill-run green wft-pill is-parked' : 'pill-run wft-pill is-stopped is-parked');
  const pdot = el(doc, 'span', 'pdot');
  pdot.setAttribute('aria-hidden', 'true');
  pill.append(pdot, doc.createTextNode(`${st === 'running' ? 'Testing' : st === 'done' ? 'Done' : 'Stopped'} · ${count}`));
  const head = el(doc, 'div', 'wft-crumbs');
  const left = el(doc, 'div', 'wft-crumbs-left');
  left.append(btn(doc, 'Tests', () => actions.back(), 'wft-crumb'), el(doc, 'h2', 'wft-title', p.title), pill);
  const acts = el(doc, 'div', 'wft-acts');
  if (st === 'running') acts.append(btn(doc, 'Stop testing', () => actions.stop(), 'btn btn-danger'));
  else if (st === 'done') acts.append(btn(doc, p.run.kind === 'once' ? 'See the result' : 'See what changed', () => actions.open(), 'btn btn-primary'));
  else if (p.run.stopReason !== 'changed') {   // N5: after a change, Finish the rest would only be refused
    let capInput = null;
    if (p.run.stopReason === 'cap') {
      capInput = el(doc, 'input');
      capInput.type = 'text'; capInput.inputMode = 'decimal'; capInput.id = 'wft-pg-cap'; capInput.className = 'wft-num';
      capInput.value = `$${Math.ceil(Math.max((p.capUsd || 0) * 1.5, p.costUsd + 5) / 5) * 5}`;
      const lab = el(doc, 'label', 'wft-cap-label', 'Stop if the cost goes over');
      lab.htmlFor = capInput.id;
      acts.append(lab, capInput);
    }
    acts.append(btn(doc, 'Finish the rest', () => actions.continue(capInput ? Number(capInput.value.replace(/[^0-9.]/g, '')) || null : null), 'btn btn-primary'));
  }
  head.append(left, acts);
  page.append(head);

  const prog = el(doc, 'section', 'card wft-prog');
  prog.setAttribute('aria-label', 'Progress');
  const bar = el(doc, 'div', 'wft-bar');
  for (const [k, v] of Object.entries({ role: 'progressbar', 'aria-label': 'Tries done', 'aria-valuemin': '0', 'aria-valuemax': String(p.total), 'aria-valuenow': String(p.done) })) bar.setAttribute(k, v);
  const fill = el(doc, 'span');
  fill.style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`;
  bar.append(fill);
  const costSub = [p.estimateUsd != null ? `of about ${aboutUsd(p.estimateUsd)}` : null, p.capUsd != null ? `stops at ${aboutUsd(p.capUsd)}` : null].filter(Boolean).join(' · ');
  const q = p.quick;
  const quickFact = !q ? fact(doc, 'Free quick check', 'Off')
    : q.status === 'passed' ? fact(doc, 'Free quick check', 'Passed', 'every step is connected')
      : q.status === 'failed' ? fact(doc, 'Free quick check', 'Not passed', q.detail || null) : fact(doc, 'Free quick check', 'Checking…');
  const facts = el(doc, 'div', 'wft-facts');
  facts.append(fact(doc, 'Time left', st !== 'running' ? 'none' : p.minutesLeft ? `about ${p.minutesLeft} min` : 'not known yet'),
    fact(doc, 'Cost so far', fmtUsd(p.costUsd), costSub || null), quickFact);
  prog.append(bar, facts);
  if (st === 'running') {
    prog.append(el(doc, 'p', 'hint', `You can close this page or keep working. Worca tells you when the results are ready.${p.run.tries > 1
      ? ` Results so far are not final: wait for all ${p.run.tries} tries of an example.` : ''}`));
  } else if (st === 'stopped') {
    prog.append(el(doc, 'p', 'hint wft-stopped', (STOPPED[p.run.stopReason] || STOPPED.error)(p)));
  }
  page.append(prog);

  const table = el(doc, 'section', 'card wft-table');
  table.setAttribute('aria-label', 'Tries per example');
  const headRow = el(doc, 'div', 'wft-prow is-head');
  headRow.append(el(doc, 'span', '', 'Example'), el(doc, 'span', '', 'Tries'), el(doc, 'span', '', 'So far'));
  table.append(headRow);
  for (const r of p.rows) {
    const row = el(doc, 'div', 'wft-prow');
    const dots = el(doc, 'span', 'wft-tries');
    dots.setAttribute('role', 'img');
    dots.setAttribute('aria-label', dotsLabel(r.dots));
    for (const d of r.dots) dots.append(el(doc, 'span', DOT[d] ? `wft-try-dot ${DOT[d]}` : 'wft-try-dot'));   // a round mark: `-dot`
    row.append(el(doc, 'span', '', r.label ? `${r.name} · ${r.label}` : r.name), dots, el(doc, 'span', '', r.summary));
    table.append(row);
  }
  page.append(table);
  if (st !== 'done') page.append(el(doc, 'p', 'hint', 'Stop testing keeps the tries that are done. You can finish the rest later without paying for them twice.'));
  root.append(page);
}
```

- [ ] **Step 6: Run the two tests**

Run: `node tools/test.mjs test/ui-workflow-test-dialogs.test.mjs test/ui-workflow-test-progress.test.mjs`
Expected: PASS.

- [ ] **Step 7: Wire it in `ui/public/app.js`**

Change the Task 12 import to `import { openFromRunDialog, openPickRunDialog, canUseAsExample, openTestVersionDialog } from './workflows/test-dialogs.mjs';` and add `import { renderTestProgress } from './workflows/test-progress.mjs';`.

Replace Task 10's `wftTestVersion` with:
```js
/** Board 4. `a`/`b`/`exampleIds` prefill it (Compare's Test again). */
async function wftTestVersion({ a, b = 'draft', exampleIds = null } = {}) {
  const id = wftWorkflowId();
  if (!id) return;
  if (!wft.overview) { const o = await wftCall('GET', wftBase(id)); if (o.ok) wft.overview = o.data; }
  const o = wft.overview;
  if (!o) return;
  const versions = await gvApi.versions(id);
  const nos = versions ? versions.versions.map((v) => v.versionNo) : [];
  const options = [...nos.map((no) => ({ use: no, label: wftUseLabel(no, o.ctx, 'select') })), { use: 'draft', label: wftUseLabel('draft', o.ctx, 'select') }];
  openTestVersionDialog({ doc: document, win: window, options, a: a !== undefined ? a : (o.ctx.liveVersionNo || nos[0] || null), b,
    examples: o.examples.map((e) => ({ id: e.id, name: e.name, tries: e.tries })), exampleIds, dateText: wftDate,
    loadPlan: async (q) => { const r = await wftCall('GET', `${wftBase(id)}/plan?${new URLSearchParams(q).toString()}`); return r.ok ? r.data : null; },
    onStart: async (body) => {
      const r = await wftCall('POST', `${wftBase(id)}/runs`, body);
      if (!r.ok) return r;
      wftShow('progress', { runId: r.data.run.id });
      return { ok: true };
    } });
}
```
Replace Task 10's `wftReadView` and `wftRenderView` with:
```js
function wftReadView(id) {
  if (wft.view === 'progress') return wftCall('GET', `${wftBase(id)}/runs/${wft.runId}`);
  return Promise.resolve({ ok: false, error: 'This page comes in a later step.' });   // Task 14 adds compare and detail
}
function wftRenderView(root) {
  if (!wft.data) { renderTestsPage(root, null, wftListActions(), { doc: document, error: wft.error }); return; }
  if (wft.view === 'progress') { renderTestProgress(root, wft.data, wftProgressActions(), { doc: document }); return; }
  wft.view = 'list';
  void wftRefresh();
}
function wftProgressActions() {
  const id = wftWorkflowId();
  const runId = wft.runId;
  const run = wft.data && wft.data.run;
  return {
    back: () => wftShow('list', { overview: null }),
    stop: async () => {
      const r = await wftCall('POST', `${wftBase(id)}/runs/${runId}/stop`, {});
      if (!r.ok) notify({ tone: 'err', title: 'Not stopped', detail: r.error });
      void wftRefresh();
    },
    continue: async (capUsd) => {
      const r = await wftCall('POST', `${wftBase(id)}/runs/${runId}/continue`, capUsd != null ? { capUsd } : {});
      if (!r.ok) { notify({ tone: 'err', title: 'The rest did not start', detail: r.error }); return; }
      void wftRefresh();
    },
    open: () => {
      if (run && run.kind === 'once') wftShow('detail', { runId, exampleId: run.exampleIds[0], tryIndex: 0 });   // G2
      else wftShow('compare', { runId });
    },
  };
}
/** D33: a test changed (a try ended, the test finished) — the toast for a finished test (C13), and the open page. */
function wftChanged(msg) {
  if (msg.finished && msg.title) {
    notify({ tone: msg.status === 'done' ? 'ok' : 'info', title: msg.status === 'done' ? 'Test results are ready' : 'Test stopped', detail: msg.title,
      key: `wft-${msg.testRunId}`, action: { label: 'Open', run: () => { location.hash = `workflows/${msg.workflowId}/tests/run/${msg.testRunId}`; } } });
  }
  const els = wfvEls();
  if (!els.tests || els.tests.hidden || wftWorkflowId() !== msg.workflowId) return;
  if (wft.view === 'list' || (wft.view === 'progress' && wft.runId === msg.testRunId)) void wftRefresh();
}
```
In the WS dispatcher, right after the `requirements-changed` branch, add:
```js
  // Workflow tests (plans/workflow-tests-part2-plan.md D33): sent only while the flag is on. It carries testRunId, never runId,
  // so the run upsert below (`if (!msg.runId) return;`, :1973) never makes a phantom run of it.
  if (msg.type === 'workflow-tests-changed') {
    wftChanged(msg);
    return;
  }
```

- [ ] **Step 8: Styles** (append to the Part 2 block, before its `@media (max-width:900px)` line)

```css
/* Test a version (boards 4, 30) and while the test runs (boards 20, 27, 28) */
.wft-vs{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 12px;}
.wft-vs > .field{flex:1 1 200px;margin:0;}
.wft-vs-with{padding-bottom:10px;color:var(--ink-2);}
.wft-row2{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-end;}
.wft-reuse:empty{display:none;}
.wft-reuse .wft-chk .hint,.wft-chk > .hint{display:inline;margin:0;}
.wft-conn{border:0;margin:0;padding:0;min-width:0;display:flex;flex-direction:column;gap:8px;}
.wft-conn legend{padding:0;margin-bottom:4px;font-weight:600;font-size:var(--fs-body);}
.wft-conn .radio-card{margin:0;}
.wft-conn .radio-card-text .hint{margin:0;line-height:1.45;}
.wft-conn-notes{list-style:none;margin:0;padding:8px 0 0 26px;display:flex;flex-direction:column;gap:5px;font-size:var(--fs-meta);line-height:1.45;color:var(--ink-2);}
.wft-conn-notes li{display:flex;gap:8px;align-items:flex-start;}
.wft-conn-notes .ic,.wft-caution .ic{flex:0 0 auto;margin-top:2px;}
.wft-caution{display:flex;gap:8px;align-items:flex-start;margin:0;padding:10px 12px;border-radius:var(--r-sm);background:var(--amber-wash);border:1px solid var(--amber-line);font-size:var(--fs-meta);line-height:1.45;color:var(--ink);}
.wft-caution .ic{color:var(--amber-ink-strong);}
.wft-caution b{font-weight:600;}
.wft-safe{display:flex;gap:10px;align-items:flex-start;font-size:var(--fs-body);color:var(--ink-2);margin:6px 0;}
.wft-safe .ic{flex:0 0 auto;margin-top:1px;}
.wft-safe b{color:var(--ink);font-weight:600;}
.wft-est{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:var(--r-sm);background:var(--field);font-size:var(--fs-body);}
.wft-est:empty{display:none;}
.wft-est-row{display:flex;justify-content:space-between;gap:12px;}
.wft-est-row.is-total{border-top:1px solid var(--line);padding-top:6px;font-weight:600;}
.wft-tv-note:empty{display:none;}
.wft-pill{align-self:center;}
.wft-pill.is-stopped{background:var(--slate-bg);color:var(--slate-ink);}
.wft-pill.is-stopped .pdot{background:var(--slate);}
.wft-pill.is-parked .pdot{animation:none;}
.wft-cap-label{font-size:var(--fs-body);color:var(--ink-2);}
.wft-prog{display:flex;flex-direction:column;gap:14px;}
.wft-prog > .hint{margin:0;}
.wft-bar{height:8px;border-radius:var(--r-xs);background:var(--field);overflow:hidden;}
.wft-bar > span{display:block;height:100%;background:var(--peach);border-radius:var(--r-xs);}
.wft-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}
.wft-fact{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-meta);color:var(--ink-2);}
.wft-fact b{font-family:var(--mono);font-size:var(--fs-subpage);font-weight:600;color:var(--ink);}
.wft-prow{display:grid;grid-template-columns:minmax(0,1fr) 150px 190px;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);font-size:var(--fs-body);}
.wft-prow:last-child{border-bottom:0;}
.wft-prow.is-head{padding:10px 18px;font-size:var(--fs-caption);font-weight:600;color:var(--ink-2);}
.wft-tries{display:inline-flex;flex-wrap:wrap;gap:5px;}
.wft-try-dot{width:12px;height:12px;border-radius:50%;border:1.5px solid var(--line-2);box-sizing:border-box;}
.wft-try-dot.ok{background:var(--green);border-color:var(--green);}
.wft-try-dot.no{background:var(--red);border-color:var(--red);}
.wft-try-dot.run{border-color:var(--peach);background:var(--peach-bg);}
@media (max-width:700px){.wft-facts,.wft-prow{grid-template-columns:minmax(0,1fr);}}
```
The Stopped pill's grey is the slate family (`--slate-*`), like a stopped run's grey everywhere else; the `.pill-run.violet` class would read the same but its name is Labs-only in JS (ui-design-language F-13).

In `test/ui-shared-controls.test.mjs` `JS_CHECKBOX_OK`, after Task 12's `wft-keep-box` row, add:
```js
  ['workflows/test-dialogs.mjs', 'wft-tv-optin', 'opt-ins next to the estimate: reuse earlier results, the free quick check'],
```

- [ ] **Step 9: Run the tests and the design guards**

Run: `node tools/test.mjs test/ui-workflow-test-dialogs.test.mjs test/ui-workflow-test-progress.test.mjs test/ui-workflow-tests-view.test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs`
Then the style.css slicing tests (the list in the Global Constraints).
Expected: PASS, except the four known `ui-design-language` failures. The `.wft-bar` fill is peach, never blue (the neutral-bar rule), and every round mark ends in `-dot`.

- [ ] **Step 10: Commit**

```bash
git add ui/public/workflows/test-dialogs.mjs ui/public/workflows/test-progress.mjs ui/public/app.js ui/public/style.css test/ui-workflow-test-dialogs.test.mjs test/ui-workflow-test-progress.test.mjs test/ui-shared-controls.test.mjs
git commit -m "Workflow tests: Test a version with its connectors choice, and the page while the test runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 14: Compare (board 5) and one example side by side (boards 6, 31)

**Precondition:** the screens are the approved boards 5 Compare, 6 CaseDetail and 31 WouldHaveSent, board 28's G2 and C10, and board 29's C17 and side-by-side C18 states. They were approved on 2026-10-26. If the controller reports a later change to one of them, apply it to this task's text before starting.

**Files:**
- Create: `ui/public/workflows/test-compare.mjs`
- Modify `ui/public/app.js`:
  - the import
  - Task 13's `wftReadView` and `wftRenderView` bodies
  - new `wftCompareActions`, `wftDetailActions`
- Modify: `ui/public/style.css` (append to the Part 2 block, before its `@media (max-width:900px)` line)
- Test: `test/ui-workflow-test-compare.test.mjs`

**Interfaces:**
- Consumes:
  - `GET …/runs/:run/compare` → `compareOf`
  - `GET …/runs/:run/examples/:ex` → `sideBySide`
  - `GET …/runs/:run/tries/:try/result`
  - Task 8 formats
- Produces:
  - `renderCompare(root, compare, actions, { doc, now? })`, where `actions = { back(), testAgain(), open(exampleId), tryMore(exampleId) }`
  - `renderSideBySide(root, side, actions, { doc, tryIndex })`, where `actions = { back(), pick(index), readWhole(tryId, title) }`. With `side.connectors === 'pretend'` the page says "Connectors: pretend. Nothing was posted or sent." and each column gets a "Would have sent" card (board 31); a real try's column says "Connectors: real. This try used your real connectors."
  - `sentCount(calls) → '1 message, 1 issue'` (N3)
  - `openWholeResult({ doc, win, title, name, text })`
  - Consumes `sideBySide`'s `wouldHaveSent` / `answeredReads` (Task 9) and `icon` (`ui/public/icons.mjs`)

- [ ] **Step 1: Write the failing test.** Create `test/ui-workflow-test-compare.test.mjs`:

```js
// test/ui-workflow-test-compare.test.mjs — Compare (board 5: C2, G3, G9, G15) and one example side by side (boards 6, 31:
// C10, C19, G2), on board 5's numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderCompare, renderSideBySide, openWholeResult, sentCount } from '../ui/public/workflows/test-compare.mjs';
import { compareModel } from '../src/shared/workflow-tests/compare.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const SECTIONS = 'Has the sections Problem, Users, Success metric and Risks';
let nextId = 0;
const tries = (side, exampleId, marks, cost, ms) => [...marks].map((m) => ({
  id: (nextId += 1), side, exampleId, status: m === 'P' ? 'passed' : 'failed', costUsd: cost,
  verdict: { passed: m === 'P', basics: [], checks: [{ label: SECTIONS, met: m === 'P' }], facts: { durationMs: ms, sentBack: side === 'a' ? 2 : 1 } },
}));
const EX = [[1, 'Bulk invoice export', 'PPP', 'PFF'], [2, 'Unclear request: "dark mode please"', 'PFF', 'PPP'], [3, 'A feature we already have', 'FFF', 'PPF'],
  [4, 'Offline mode for the field app', 'PPP', 'PPP'], [5, 'Pricing page A/B test', 'PPF', 'PPF'], [6, 'Customer data export (GDPR)', 'PPP', 'PPP']];
const compare = (over = {}) => {
  const list = EX.flatMap(([id, , a, b]) => [...tries('a', id, a, 0.84, 370000), ...tries('b', id, b, 0.52, 280000)]);
  return {
    run: { id: 7, kind: 'compare', a: 4, b: 'draft', tries: 3, status: 'done', finishedAt: '2026-10-26T10:00:00Z', capUsd: 15, exampleIds: [1, 2, 3, 4, 5, 6] },
    title: 'Your v5 draft compared with v4', labels: { a: 'v4', b: 'v5 draft' }, examples: 6, costUsd: 10.26,
    model: compareModel({ examples: EX.map(([id, name]) => ({ id, name })), a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: list }),
    changes: ['Draft brief: AI model opus → sonnet', 'New step Fact check'], fair: [], ...over,
  };
};
function boot(render, data, ctx = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const actions = new Proxy({}, { get: (_t, name) => (...args) => calls.push([name, ...args]) });
  const root = window.document.getElementById('root');
  render(root, data, actions, { doc: window.document, now: Date.parse('2026-10-26T12:00:00Z'), ...ctx });
  return { root, calls, doc: window.document, win: window };
}

test('board 5: the title and meta, In short with Look at it, five tiles', () => {
  const { root, calls } = boot(renderCompare, compare());
  assert.equal(root.querySelector('.wft-title').textContent, 'Your v5 draft compared with v4');
  assert.equal(root.querySelector('.wft-titles .hint').textContent, '6 examples, 3 tries each · ready 2 hours ago · cost $10.26');
  assert.deepEqual(texts(root, '.wft-crumbs .wft-acts button'), ['Test again']);
  assert.equal(root.querySelector('.wft-short p').textContent, `v5 draft is cheaper and faster, and better on 2 examples. It is worse on 1 example, Bulk invoice export: it missed "${SECTIONS}" in 2 of 3 tries. Its results also vary more from try to try. Look at Bulk invoice export before you share v5 draft.`);
  assert.equal(root.querySelector('.wft-short p b').textContent, 'Bulk invoice export');
  click([...root.querySelectorAll('.wft-short button')].find((b) => b.textContent === 'Look at it'));
  assert.deepEqual(calls, [['open', 1]]);
  const tiles = [...root.querySelectorAll('.wft-tile')].map((t) => [t.querySelector('.wft-tile-label > span').textContent,
    t.querySelector('.wft-tile-delta') ? t.querySelector('.wft-tile-delta').textContent : null, t.querySelector('.wft-tile-value').textContent, t.querySelector('.wft-tile-sub').textContent]);
  assert.deepEqual(tiles, [
    ['Tries passed', '2 more', '14 of 18', 'v4: 12 of 18'],
    ['Cost per try', '38% less', '$0.52', 'v4: $0.84'],
    ['Time per try', '1½ min less', '4 min 40 s', 'v4: 6 min 10 s'],
    ['Sent back for fixes', null, '1.0×', 'per try, on average · v4: 2.0×'],
    ['Steady results', null, '3 of 6', 'examples with the same result in every try · v4: 4 of 6'],
  ]);
});

test('board 5: by example (G9), why, might be luck with Try 3 more (G15), what you changed, a fair comparison', () => {
  const { root, calls } = boot(renderCompare, compare({ fair: ['Your draft changed after this test.'] }));
  assert.equal(root.querySelector('.wft-by-title').textContent, 'By example');
  assert.equal(root.querySelectorAll('.wft-by [role="tablist"]').length, 0, 'no one-tab switch');
  assert.deepEqual(texts(root, '.wft-crow2.is-head > span'), ['Example', 'v4 passed', 'v5 draft passed', 'Result']);
  const rows = [...root.querySelectorAll('.wft-crow2:not(.is-head)')];
  assert.deepEqual(rows.map((r) => r.querySelector('.badge').textContent), ['Worse', 'Better', 'Better', 'Same', 'Same', 'Same']);
  assert.deepEqual(rows.map((r) => [...r.querySelectorAll('.wft-res')].map((x) => x.textContent)).slice(0, 2), [['3 of 3', '1 of 3'], ['1 of 3', '3 of 3']]);
  assert.equal(rows[0].querySelector('.wft-why').textContent, `v5 draft missed "${SECTIONS}" in 2 of 3 tries`);
  click(rows[2].querySelector('.wft-ex-open'));
  assert.deepEqual(texts(root, '.wft-changes .wft-chg'), ['Draft brief: AI model opus → sonnet', 'New step Fact check']);
  assert.equal(root.querySelector('.wft-changes h2').textContent, 'What you changed since v4');
  assert.equal(root.querySelector('.wft-changes > p.hint').textContent, 'A fair comparison. Both versions were tried on the same 6 examples and checked the same way. If that changes, for example after an example is edited, Worca says so here.');
  assert.deepEqual(texts(root, '.wft-fair'), ['Your draft changed after this test.']);
  assert.equal([...root.querySelectorAll('.wft-changes button')].length, 0, 'G3: no "Show both versions on the canvas"');
  const luckList = [...tries('a', 1, 'PPF', 0.5, 1000), ...tries('b', 1, 'PPP', 0.5, 1000)];
  const luck = boot(renderCompare, compare({ examples: 1, model: compareModel({ examples: [{ id: 1, name: 'X' }], a: { label: 'v4' }, b: { label: 'v5 draft' }, tries: luckList }) }));
  const why = luck.root.querySelector('.wft-why');
  assert.equal(why.textContent, 'Might be luck: only 3 tries. Try 3 more');
  click(why.querySelector('button'));
  assert.deepEqual([calls, luck.calls], [[['open', 3]], [['tryMore', 1]]]);
});

const tv = (id, met) => ({ tryId: id, status: met ? 'passed' : 'failed', name: 'brief.md', text: `## Success metric\nTry ${id}`, truncated: id === 12,
  connectors: 'pretend', wouldHaveSent: [], answeredReads: [],
  verdict: { basics: [{ key: 'noError', label: 'Finishes without an error', met: true, value: 'Met' }, { key: 'maxCostUsd', label: 'Costs at most $1.50', met: true, value: id > 10 ? '$0.49' : '$0.86' }],
    checks: [{ id: 'c_1', label: 'Length is 400 to 900 words', met: true, value: id > 10 ? '518 words' : '742 words' }, { id: 'c_2', label: SECTIONS, met, value: met ? 'Met' : 'Missing Risks' }] } });
const side = (over = {}) => ({
  run: { id: 7, kind: 'compare' }, compareTitle: 'Your v5 draft compared with v4', example: { id: 1, name: 'Bulk invoice export' },
  labels: { a: 'v4', b: 'v5 draft' }, row: { a: { passed: 3, total: 3 }, b: { passed: 1, total: 3 }, result: 'worse' }, connectors: 'pretend',
  tries: [{ n: 1, a: tv(1, true), b: tv(11, true) }, { n: 2, a: tv(2, true), b: tv(12, false) }, { n: 3, a: tv(3, true), b: tv(13, false) }], ...over,
});

test('board 6: the example, Try 1–3, what each version wrote, what was checked in that try', () => {
  const { root, calls } = boot(renderSideBySide, side(), { tryIndex: 1 });
  assert.equal(root.querySelector('.wft-crumb').textContent, 'Your v5 draft compared with v4');
  assert.deepEqual([root.querySelector('.wft-title').textContent, root.querySelector('.wft-detail-name .badge').className], ['Bulk invoice export', 'badge red']);
  assert.equal(root.querySelector('.wft-titles > .hint').textContent, 'v4 passed 3 of 3 tries · v5 draft passed 1 of 3');
  assert.deepEqual([...root.querySelectorAll('[role="tab"]')].map((t) => [t.textContent, t.getAttribute('aria-selected')]), [['Try 1', 'false'], ['Try 2', 'true'], ['Try 3', 'false']]);
  assert.deepEqual(texts(root, '.wft-outs .wft-out-card h2'), ['What v4 wrote', 'What v5 draft wrote']);
  assert.deepEqual(texts(root, '.wft-out'), ['## Success metric\nTry 2', '## Success metric\nTry 12']);
  assert.equal(texts(root, '.wft-outs .hint').includes('Shortened here: read the whole result.'), true);
  const table = root.querySelector('.wft-checked');
  assert.equal(table.getAttribute('aria-label'), 'What was checked in try 2');
  assert.deepEqual(texts(table, '.wft-crow.is-head > span'), ['What was checked', 'v4 · try 2', 'v5 draft · try 2']);
  assert.deepEqual(texts(table, '.wft-crow-grp'), ['Basics', 'Automatic checks']);
  assert.deepEqual([...table.querySelectorAll('.wft-crow:not(.is-head)')].map((r) => [...r.children].map((c) => c.textContent)), [
    ['Finishes without an error', 'Met', 'Met'], ['Costs at most $1.50', '$0.86', '$0.49'],
    ['Length is 400 to 900 words', '742 words', '518 words'], [SECTIONS, 'Met', 'Missing Risks']]);
  click([...root.querySelectorAll('[role="tab"]')][0]);
  click([...root.querySelectorAll('.wft-outs button')].find((b, i) => i === 1));
  click(root.querySelector('.wft-crumb'));
  assert.deepEqual(calls, [['pick', 0], ['readWhole', 12, 'What v5 draft wrote'], ['back']]);
});

test('G2: Try it once now shows one column; the whole result opens in a dialog', () => {
  const once = side({ run: { id: 8, kind: 'once' }, labels: { a: null, b: 'Your draft' }, row: { a: { passed: 0, total: 0 }, b: { passed: 1, total: 1 }, result: null },
    tries: [{ n: 1, a: null, b: tv(21, true) }] });
  const { root, doc, win } = boot(renderSideBySide, once, { tryIndex: 0 });
  assert.equal(root.querySelector('.wft-crumb').textContent, 'Tests');
  assert.equal(root.querySelector('.wft-detail-name .badge'), null);
  assert.equal(root.querySelector('.wft-titles > .hint').textContent, 'Your draft passed 1 of 1 try');
  assert.equal(root.querySelectorAll('[role="tab"]').length, 0);
  assert.ok(root.querySelector('.wft-outs').classList.contains('is-one'));
  assert.deepEqual(texts(root, '.wft-outs .wft-out-card h2'), ['What your draft wrote']);
  assert.deepEqual(texts(root, '.wft-checked .wft-crow.is-head > span'), ['What was checked', 'Your draft · try 1']);
  openWholeResult({ doc, win, title: 'What v5 draft wrote', name: 'brief.md', text: '# Brief\n\nAll of it.' });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'What v5 draft wrote');
  assert.equal(doc.querySelector('.wft-whole').textContent, '# Brief\n\nAll of it.');
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Close'));
  assert.equal(doc.querySelector('#mk-dialog'), null);
});

test('board 31: pretend at the top, what each try would have sent, nothing, the reads, and a real test (C19, N3)', () => {
  const slack = { server: 'slack_team', tool: 'post a message', toolId: 'post_message', noun: 'message', to: '#product',
    preview: 'Brief ready: Bulk invoice export', full: 'Brief ready: Bulk invoice export\nGoal: fewer tickets.' };
  const jira = { server: 'jira', tool: 'create an issue', toolId: 'create_issue', noun: 'issue', to: null,
    preview: 'Bulk invoice export: brief', full: 'Title: Bulk invoice export: brief' };
  const s = side();
  s.tries[1].a = { ...s.tries[1].a, wouldHaveSent: [slack] };
  s.tries[1].b = { ...s.tries[1].b, wouldHaveSent: [slack, jira], answeredReads: [{ server: 'jira', n: 1 }] };
  const { root } = boot(renderSideBySide, s, { tryIndex: 1 });
  assert.equal(root.querySelector('.wft-page > .wft-mode').textContent, 'Connectors: pretend. Nothing was posted or sent.');
  const cards = [...root.querySelectorAll('.wft-sent')];
  assert.deepEqual(cards.map((c) => c.querySelector('h2').textContent), ['Would have sent', 'Would have sent']);
  assert.deepEqual(cards.map((c) => c.querySelector('.wft-sent-head .hint').textContent), ['1 message', '1 message, 1 issue']);
  assert.deepEqual([...cards[1].querySelectorAll('.wft-call summary')].map((x) => x.textContent),
    ['slack_team · post a message · to #product: "Brief ready: Bulk invoice export"', 'jira · create an issue · "Bulk invoice export: brief"']);
  assert.equal(cards[1].querySelector('.wft-call-full').textContent, 'Full text · to #productBrief ready: Bulk invoice export\nGoal: fewer tickets.');
  assert.equal(cards[1].querySelector('.wft-sent-foot').textContent, 'Worca also answered 1 request in jira: it came back empty.');
  assert.deepEqual([sentCount([slack, slack, jira]), sentCount([{ ...jira, noun: 'search' }, { ...jira, noun: 'search' }])], ['2 messages, 1 issue', '2 searches']);
  const none = boot(renderSideBySide, side(), { tryIndex: 0 });
  assert.deepEqual(texts(none.root, '.wft-sent-foot'), ['Nothing would have been sent.', 'Nothing would have been sent.']);
  const realSide = side({ connectors: 'real' });
  realSide.tries = realSide.tries.map((t) => ({ ...t, a: { ...t.a, connectors: 'real', wouldHaveSent: null }, b: { ...t.b, connectors: 'real', wouldHaveSent: null } }));
  const real = boot(renderSideBySide, realSide, { tryIndex: 0 });
  assert.equal(real.root.querySelector('.wft-page > .wft-mode'), null, 'no pretend note');
  assert.equal(real.root.querySelectorAll('.wft-sent').length, 0);
  assert.deepEqual(texts(real.root, '.wft-sent-real'), ['Connectors: real. This try used your real connectors.', 'Connectors: real. This try used your real connectors.']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/test.mjs test/ui-workflow-test-compare.test.mjs`
Expected: FAIL with `Cannot find module '../ui/public/workflows/test-compare.mjs'`.

- [ ] **Step 3: Implement `ui/public/workflows/test-compare.mjs`**

```js
// ui/public/workflows/test-compare.mjs — Compare (canvas board 5) and one example side by side (board 6), plus Read the
// whole result (plans/workflow-tests-part2-plan.md Task 14; C2, C10, G2, G3, G9, G15). Pure DOM: app.js reads the
// server's models (service.compareOf / sideBySide) and owns the actions.
import { el, btn } from './test-ui.mjs';
import { icon } from '../icons.mjs';
import { createDialog } from '../marketplace/layers.mjs';
import { fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { agoText, countsText, fmtDuration, pctDelta, durationDelta, countDelta, fmtTimes } from '../../../src/shared/workflow-tests/compare.mjs';

const RESULT = { better: ['badge green', 'Better'], worse: ['badge red', 'Worse'], same: ['badge', 'Same'] };
const usdOr = (n) => (typeof n === 'number' && Number.isFinite(n) ? fmtUsd(n) : '—');
const timeOr = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? fmtDuration(ms) : '—');
const wrote = (label) => `What ${/^Your\b/.test(label) ? `y${label.slice(1)}` : label} wrote`;
const plural = (w) => (/(?:s|sh|ch|x)$/.test(w) ? `${w}es` : `${w}s`);

/** N3: the count beside "Would have sent": "1 message, 1 issue", by what each call makes. */
export function sentCount(calls) {
  const by = new Map();
  for (const c of calls) by.set(c.noun, (by.get(c.noun) || 0) + 1);
  return [...by].map(([noun, n]) => `${n} ${n === 1 ? noun : plural(noun)}`).join(', ');
}

const modeNote = (doc, name, text) => {
  const p = el(doc, 'p', 'wft-mode');
  p.append(icon(doc, name, 14), el(doc, 'span', '', text));
  return p;
};

/** Board 31: what one pretend try would have sent (C19), or what a real try did. null when the column has no try. */
function sentCard(doc, v, key) {
  if (!v) return null;
  if (v.connectors === 'real') {
    const c = el(doc, 'section', 'card wft-sent-real');
    c.append(modeNote(doc, 'plug', 'Connectors: real. This try used your real connectors.'));
    return c;
  }
  const c = el(doc, 'section', 'card wft-sent');
  const head = el(doc, 'div', 'wft-sent-head');
  const h = el(doc, 'h2', '', 'Would have sent');
  h.id = `wft-sent-${key}`;
  c.setAttribute('aria-labelledby', h.id);
  head.append(h);
  const sent = v.wouldHaveSent || [];
  if (sent.length) head.append(el(doc, 'span', 'hint', sentCount(sent)));
  c.append(head);
  for (const call of sent) {
    const d = el(doc, 'details', 'wft-call');
    const sum = el(doc, 'summary');
    sum.append(el(doc, 'b', '', call.server), el(doc, 'span', 'wft-call-what', ` · ${call.tool} · `),
      el(doc, 'span', 'wft-call-prev', call.to ? `to ${call.to}: "${call.preview}"` : `"${call.preview}"`));
    const full = el(doc, 'div', 'wft-call-full');
    full.append(el(doc, 'span', 'wft-call-cap', call.to ? `Full text · to ${call.to}` : 'Full text'), doc.createTextNode(call.full));
    d.append(sum, full);
    c.append(d);
  }
  if (!sent.length) c.append(el(doc, 'p', 'wft-sent-foot', 'Nothing would have been sent.'));
  for (const r of v.answeredReads || []) {
    c.append(el(doc, 'p', 'wft-sent-foot', `Worca also answered ${r.n === 1 ? '1 request' : `${r.n} requests`} in ${r.server}: ${r.n === 1 ? 'it' : 'they'} came back empty.`));
  }
  return c;
}

function passed(doc, r) {
  const span = el(doc, 'span', 'wft-res');
  if (!r || !r.total) { span.classList.add('is-none'); span.textContent = 'Not tried'; return span; }
  const dot = el(doc, 'span', `wft-dot ${r.passed === r.total ? 'ok' : r.passed === 0 ? 'no' : 'mix'}`);
  dot.setAttribute('aria-hidden', 'true');
  span.append(dot, doc.createTextNode(`${r.passed} of ${r.total}`));
  return span;
}
const badge = (doc, result) => (result ? el(doc, 'span', RESULT[result][0], RESULT[result][1]) : el(doc, 'span', 'hint', '—'));

function tile(doc, label, value, sub, delta = null) {
  const t = el(doc, 'section', 'card wft-tile');
  const l = el(doc, 'div', 'wft-tile-label');
  l.append(el(doc, 'span', '', label));
  if (delta) l.append(el(doc, 'span', 'wft-tile-delta', delta));
  t.append(l, el(doc, 'div', 'wft-tile-value', value), el(doc, 'small', 'wft-tile-sub', sub));
  return t;
}

/**
 * Board 5. `c` = GET …/runs/:run/compare: { run, title, labels: {a, b}, examples, costUsd, model, changes, fair }.
 * @param {{back:Function, testAgain:Function, open:(exampleId:number)=>void, tryMore:(exampleId:number)=>void}} actions
 */
export function renderCompare(root, c, actions, { doc, now = Date.now() }) {
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page wft-compare');
  const m = c.model;
  const A = c.labels.a;
  const B = c.labels.b;
  const head = el(doc, 'div', 'wft-crumbs');
  const left = el(doc, 'div', 'wft-crumbs-left');
  const titles = el(doc, 'div', 'wft-titles');
  const when = c.run.status === 'stopped' ? 'stopped early' : `ready ${agoText(c.run.finishedAt, now)}`;
  titles.append(el(doc, 'h2', 'wft-title', c.title), el(doc, 'span', 'hint', `${countsText(c.examples, c.run.tries)} · ${when} · cost ${fmtUsd(c.costUsd)}`));
  left.append(btn(doc, 'Tests', () => actions.back(), 'wft-crumb'), titles);
  const acts = el(doc, 'div', 'wft-acts');
  acts.append(btn(doc, 'Test again', () => actions.testAgain(), 'btn'));
  head.append(left, acts);
  page.append(head);

  if (m.inShort.length) {   // C2
    const s = el(doc, 'section', 'wft-short');
    const box = el(doc, 'div');
    const h = el(doc, 'h2', '', 'In short');
    h.id = 'wft-short-h';
    s.setAttribute('aria-labelledby', h.id);
    const p = el(doc, 'p', '', m.inShort.join(' '));
    if (m.look) p.append(doc.createTextNode(` ${m.look.before}`), el(doc, 'b', '', m.look.name), doc.createTextNode(m.look.after));
    box.append(h, p);
    s.append(box);
    if (m.look) s.append(btn(doc, 'Look at it', () => actions.open(m.look.exampleId), 'btn'));
    page.append(s);
  }

  const a = m.tiles.a;
  const b = m.tiles.b;
  const tiles = el(doc, 'div', 'wft-tiles');
  tiles.append(
    tile(doc, 'Tries passed', `${b.passed.passed} of ${b.passed.total}`, `${A}: ${a.passed.passed} of ${a.passed.total}`, countDelta(a.passed.passed, b.passed.passed)),
    tile(doc, 'Cost per try', usdOr(b.costPerTry), `${A}: ${usdOr(a.costPerTry)}`, pctDelta(a.costPerTry, b.costPerTry) || null),
    tile(doc, 'Time per try', timeOr(b.timePerTry), `${A}: ${timeOr(a.timePerTry)}`, durationDelta(a.timePerTry, b.timePerTry) || null),
    tile(doc, 'Sent back for fixes', fmtTimes(b.sentBack) || '—', `per try, on average · ${A}: ${fmtTimes(a.sentBack) || '—'}`),
    tile(doc, 'Steady results', `${b.steady.n} of ${b.steady.of}`, `examples with the same result in every try · ${A}: ${a.steady.n} of ${a.steady.of}`),
  );
  page.append(tiles);

  const by = el(doc, 'section', 'wft-by');   // G9: one view, a heading, no one-tab switch
  const hb = el(doc, 'h2', 'wft-by-title', 'By example');
  hb.id = 'wft-by-h';
  by.setAttribute('aria-labelledby', hb.id);
  const table = el(doc, 'div', 'card wft-table');
  const hr = el(doc, 'div', 'wft-crow2 is-head');
  hr.append(el(doc, 'span', '', 'Example'), el(doc, 'span', '', `${A} passed`), el(doc, 'span', '', `${B} passed`), el(doc, 'span', '', 'Result'));
  table.append(hr);
  for (const r of m.examples) {
    const row = el(doc, 'div', 'wft-crow2');
    row.append(btn(doc, r.name, () => actions.open(r.id), 'wft-ex-open'), passed(doc, r.a), passed(doc, r.b), badge(doc, r.result));
    if (r.luck) {
      const why = el(doc, 'span', 'wft-why');
      why.append(doc.createTextNode(`Might be luck: only ${Math.max(r.a.total, r.b.total)} tries. `), btn(doc, 'Try 3 more', () => actions.tryMore(r.id), 'wft-linkbtn'));
      row.append(why);
    } else if (r.why) {
      row.append(el(doc, 'span', 'wft-why', r.why));
    }
    table.append(row);
  }
  by.append(hb, table);
  page.append(by);

  const ch = el(doc, 'section', 'card wft-changes');
  const hc = el(doc, 'h2', '', `What you changed since ${A}`);
  hc.id = 'wft-chg-h';
  ch.setAttribute('aria-labelledby', hc.id);
  ch.append(hc);
  if (c.changes.length) {
    for (const t of c.changes) {
      const line = el(doc, 'div', 'wft-chg');
      const ico = el(doc, 'span', 'wft-chg-ico');
      ico.setAttribute('aria-hidden', 'true');
      line.append(ico, el(doc, 'span', '', t));
      ch.append(line);
    }
  } else {
    ch.append(el(doc, 'p', 'hint wft-nochange', 'No steps or settings changed.'));
  }
  const fair = el(doc, 'p', 'hint');
  fair.append(el(doc, 'b', '', 'A fair comparison.'), doc.createTextNode(` Both versions were tried on the same ${c.examples === 1 ? 'example' : `${c.examples} examples`} and checked the same way. If that changes, for example after an example is edited, Worca says so here.`));
  ch.append(fair);
  for (const f of c.fair) ch.append(el(doc, 'p', 'hint wft-fair', f));
  page.append(ch);
  root.append(page);
}

/**
 * Board 6 (G2: one column after Try it once now). `s` = GET …/runs/:run/examples/:ex.
 * @param {{back:Function, pick:(index:number)=>void, readWhole:(tryId:number, title:string)=>void}} actions
 */
export function renderSideBySide(root, s, actions, { doc, tryIndex = 0 }) {
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page wft-detail');
  const once = s.run.kind === 'once' || !s.labels.a;
  const i = Math.min(Math.max(0, tryIndex), Math.max(0, s.tries.length - 1));
  const cur = s.tries[i] || null;
  const head = el(doc, 'div', 'wft-crumbs');
  const left = el(doc, 'div', 'wft-crumbs-left');
  const titles = el(doc, 'div', 'wft-titles');
  const name = el(doc, 'div', 'wft-detail-name');
  name.append(el(doc, 'h2', 'wft-title', s.example.name));
  if (!once && s.row.result) name.append(badge(doc, s.row.result));
  const counts = once
    ? `${s.labels.b} passed ${s.row.b.passed} of ${s.row.b.total} ${s.row.b.total === 1 ? 'try' : 'tries'}`
    : `${s.labels.a} passed ${s.row.a.passed} of ${s.row.a.total} tries · ${s.labels.b} passed ${s.row.b.passed} of ${s.row.b.total}`;
  titles.append(name, el(doc, 'span', 'hint', counts));
  left.append(btn(doc, once ? 'Tests' : s.compareTitle, () => actions.back(), 'wft-crumb'), titles);
  head.append(left);
  if (s.tries.length > 1) {
    const tabs = el(doc, 'div', 'seg');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Which try');
    s.tries.forEach((t, k) => {
      const b = btn(doc, `Try ${t.n}`, () => actions.pick(k), k === i ? 'on' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', k === i ? 'true' : 'false');
      tabs.append(b);
    });
    head.append(tabs);
  }
  page.append(head);
  if (s.connectors === 'pretend') page.append(modeNote(doc, 'shield', 'Connectors: pretend. Nothing was posted or sent.'));   // board 31
  if (!cur) {
    page.append(el(doc, 'p', 'hint', 'No finished try of this example in this test.'));
    root.append(page);
    return;
  }

  const outs = el(doc, 'div', `wft-outs${once ? ' is-one' : ''}`);
  const out = (label, v, sideKey) => {
    const c = el(doc, 'section', 'card wft-card wft-out-card');
    const h = el(doc, 'h2', '', wrote(label));
    h.id = `wft-out-${sideKey}`;
    c.setAttribute('aria-labelledby', h.id);
    const ch = el(doc, 'div', 'wft-card-head');
    ch.append(h);
    if (v && v.text) ch.append(btn(doc, 'Read the whole result', () => actions.readWhole(v.tryId, wrote(label)), 'wft-linkbtn'));   // C10
    c.append(ch);
    if (!v) c.append(el(doc, 'p', 'hint', 'No try of this version here.'));
    else if (!v.text) c.append(el(doc, 'p', 'hint', 'This try left no result.'));
    else {
      c.append(el(doc, 'div', 'wft-out', v.text));
      if (v.truncated) c.append(el(doc, 'p', 'hint', 'Shortened here: read the whole result.'));
    }
    return c;
  };
  // Board 31: each column is what that version wrote, then what it would have sent.
  const column = (label, v, key) => {
    const col = el(doc, 'div', 'wft-outcol');
    col.append(out(label, v, key));
    const sent = sentCard(doc, v, key);
    if (sent) col.append(sent);
    return col;
  };
  if (!once) outs.append(column(s.labels.a, cur.a, 'a'));
  outs.append(column(s.labels.b, cur.b, 'b'));
  page.append(outs);

  const sec = el(doc, 'section', 'card wft-table wft-checked');
  sec.setAttribute('aria-label', `What was checked in try ${cur.n}`);
  const cls = once ? 'wft-crow is-one' : 'wft-crow';
  const hr = el(doc, 'div', `${cls} is-head`);
  hr.append(el(doc, 'span', '', 'What was checked'));
  if (!once) hr.append(el(doc, 'span', '', `${s.labels.a} · try ${cur.n}`));
  hr.append(el(doc, 'span', '', `${s.labels.b} · try ${cur.n}`));
  sec.append(hr);
  const cell = (v, key, label) => {
    const it = v && v.verdict ? (v.verdict[key] || []).find((x) => x.label === label) : null;
    const span = el(doc, 'span', 'wft-res');
    if (!it) { span.classList.add('is-none'); span.textContent = '—'; return span; }
    const d = el(doc, 'span', `wft-dot ${it.met ? 'ok' : 'no'}`);
    d.setAttribute('aria-hidden', 'true');
    span.append(d, doc.createTextNode(it.value));
    return span;
  };
  for (const [title, key] of [['Basics', 'basics'], ['Automatic checks', 'checks']]) {
    const labels = [];
    for (const v of [cur.a, cur.b]) for (const it of (v && v.verdict && v.verdict[key]) || []) if (!labels.includes(it.label)) labels.push(it.label);
    if (!labels.length) continue;
    sec.append(el(doc, 'div', 'wft-crow-grp', title));
    for (const label of labels) {
      const row = el(doc, 'div', cls);
      row.append(el(doc, 'span', '', label));
      if (!once) row.append(cell(cur.a, key, label));
      row.append(cell(cur.b, key, label));
      sec.append(row);
    }
  }
  page.append(sec);
  for (const [label, v] of [[s.labels.a, cur.a], [s.labels.b, cur.b]]) {
    for (const it of (v && v.verdict && v.verdict.basics) || []) if (!it.met && it.detail) page.append(el(doc, 'p', 'hint wft-detail-why', `${label}: ${it.detail}`));
  }
  root.append(page);
}

/** "Read the whole result" (C10): the main result in full, in a large dialog. */
export function openWholeResult({ doc, win, title, name = null, text = null }) {
  const dlg = createDialog({ doc, win, width: 'lg' });
  const h = el(doc, 'h2', 'mk-dialog-title', title);
  h.id = 'mk-dialog-title';
  const body = [];
  if (name) body.push(el(doc, 'p', 'hint', name));
  body.push(text ? el(doc, 'pre', 'wft-whole', text) : el(doc, 'p', 'hint', 'This try left no result.'));
  dlg.replace({ head: [h], body, foot: [btn(doc, 'Close', () => dlg.close(), 'btn')] });
  dlg.open();
  return dlg;
}
```
`wrote()` lowercases a leading "Your" ("What your draft wrote").

- [ ] **Step 4: Run the test**

Run: `node tools/test.mjs test/ui-workflow-test-compare.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire it in `ui/public/app.js`**

```js
import { renderCompare, renderSideBySide, openWholeResult } from './workflows/test-compare.mjs';
```
Replace Task 13's `wftReadView` and `wftRenderView` with:
```js
function wftReadView(id) {
  const base = `${wftBase(id)}/runs/${wft.runId}`;
  if (wft.view === 'progress') return wftCall('GET', base);
  if (wft.view === 'compare') return wftCall('GET', `${base}/compare`);
  if (wft.view === 'detail') return wftCall('GET', `${base}/examples/${wft.exampleId}`);
  return Promise.resolve({ ok: false, error: 'This page does not exist.' });
}
function wftRenderView(root) {
  if (!wft.data) { renderTestsPage(root, null, wftListActions(), { doc: document, error: wft.error }); return; }
  if (wft.view === 'progress') { renderTestProgress(root, wft.data, wftProgressActions(), { doc: document }); return; }
  if (wft.view === 'compare') { renderCompare(root, wft.data, wftCompareActions(), { doc: document }); return; }
  if (wft.view === 'detail') { renderSideBySide(root, wft.data, wftDetailActions(), { doc: document, tryIndex: wft.tryIndex || 0 }); return; }
  wft.view = 'list';
  void wftRefresh();
}
function wftCompareActions() {
  const id = wftWorkflowId();
  const run = wft.data.run;
  return {
    back: () => wftShow('list', { overview: null }),
    testAgain: () => void wftTestVersion({ a: run.a, b: run.b, exampleIds: run.exampleIds }),
    open: (exampleId) => wftShow('detail', { runId: run.id, exampleId, tryIndex: 0 }),
    tryMore: async (exampleId) => {   // G15: at once, reusing the tries made, with the same cap
      const r = await wftCall('POST', `${wftBase(id)}/runs`, { a: run.a, b: run.b, exampleIds: [exampleId], tries: Math.min(10, run.tries + 3),
        reuseA: true, reuseB: true, quickCheck: false, capUsd: run.capUsd });
      if (!r.ok) { notify({ tone: 'err', title: 'More tries did not start', detail: r.error }); return; }
      wftShow('progress', { runId: r.data.run.id });
    },
  };
}
function wftDetailActions() {
  const id = wftWorkflowId();
  const s = wft.data;
  return {
    back: () => (s.run.kind === 'once' ? wftShow('list', { overview: null }) : wftShow('compare', { runId: s.run.id })),
    pick: (k) => { wft.tryIndex = k; wftRender(); },
    readWhole: async (tryId, title) => {
      const r = await wftCall('GET', `${wftBase(id)}/runs/${s.run.id}/tries/${tryId}/result`);
      if (!r.ok) { notify({ tone: 'err', title: 'Could not read the result', detail: r.error }); return; }
      openWholeResult({ doc: document, win: window, title, name: r.data.name, text: r.data.text });
    },
  };
}
```

- [ ] **Step 6: Styles** (append to the Part 2 block, before its `@media (max-width:900px)` line)

```css
/* Compare (board 5) and one example side by side (boards 6, 31) */
.wft-titles{display:flex;flex-direction:column;gap:2px;min-width:0;}
.wft-titles .hint{margin:0;}
.wft-short{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;padding:18px 22px;border-radius:var(--r-card);background:var(--blue-wash);border:1px solid var(--blue-line);}
.wft-short > div{flex:1 1 420px;min-width:0;}
.wft-short h2{margin:0 0 6px;font-size:var(--fs-section);}
.wft-short p{margin:0;line-height:1.5;}
.wft-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;}
.wft-tile-label{display:flex;align-items:center;gap:8px;color:var(--ink-2);font-size:var(--fs-meta);font-weight:600;}
.wft-tile-delta{margin-left:auto;background:var(--field);color:var(--ink-2);font-size:var(--fs-caption);font-weight:600;padding:2px 8px;border-radius:var(--r-xs);white-space:nowrap;}
.wft-tile-value{font-family:var(--mono);font-size:var(--fs-stat);font-weight:600;color:var(--ink);margin-top:8px;line-height:1.2;}
.wft-tile-sub{display:block;color:var(--ink-2);font-size:var(--fs-caption);margin-top:6px;}
.wft-by{display:flex;flex-direction:column;gap:10px;}
.wft-by-title{margin:0;font-size:var(--fs-section);}
.wft-crow2{display:grid;grid-template-columns:minmax(0,1fr) 92px 92px 100px;align-items:center;gap:6px 14px;padding:13px 18px;border-bottom:1px solid var(--line);}
.wft-crow2:last-child{border-bottom:0;}
.wft-crow2.is-head{padding:10px 18px;font-size:var(--fs-caption);font-weight:600;color:var(--ink-2);}
.wft-why{grid-column:1 / -1;font-size:var(--fs-meta);color:var(--ink-2);}
.wft-changes{display:flex;flex-direction:column;gap:8px;}
.wft-changes h2{margin:0;font-size:var(--fs-section);}
.wft-changes .hint{margin:0;}
.wft-chg{display:flex;gap:10px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--line);font-size:var(--fs-body);line-height:1.45;}
.wft-chg-ico{flex:0 0 auto;width:22px;height:22px;border-radius:var(--r-sm);background:var(--field);}
.wft-detail-name{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}
.wft-outs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start;}
.wft-outs.is-one{grid-template-columns:minmax(0,1fr);}
.wft-outcol{display:flex;flex-direction:column;gap:14px;min-width:0;}
.wft-card-head{display:flex;justify-content:space-between;align-items:center;gap:12px;}
.wft-out{font-size:var(--fs-body);line-height:1.55;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;}
.wft-crow{display:grid;grid-template-columns:minmax(0,1fr) 130px 130px;align-items:center;gap:14px;padding:11px 18px;border-bottom:1px solid var(--line);font-size:var(--fs-body);}
.wft-crow.is-one{grid-template-columns:minmax(0,1fr) 130px;}
.wft-crow.is-head{padding:9px 18px;font-size:var(--fs-caption);font-weight:600;color:var(--ink-2);}
.wft-crow-grp{padding:10px 18px 6px;font-size:var(--fs-caption);font-weight:600;color:var(--ink-2);background:var(--canvas-2);border-bottom:1px solid var(--line);}
.wft-detail-why{margin:0;}
.wft-whole{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--fs-body);line-height:1.55;max-height:70vh;overflow:auto;margin:0;}
/* What a try would have sent (board 31, C19) */
.wft-mode{display:flex;gap:8px;align-items:flex-start;margin:0;font-size:var(--fs-meta);line-height:1.45;color:var(--ink-2);}
.wft-mode .ic{flex:0 0 auto;margin-top:2px;}
.wft-sent{padding:0;overflow:hidden;}
.wft-sent-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 12px;padding:14px 18px 10px;}
.wft-sent-head h2{margin:0;font-size:var(--fs-body);}
.wft-sent-head .hint{margin:0;}
.wft-call{border-top:1px solid var(--line);}
.wft-call summary{display:flex;flex-wrap:wrap;gap:2px 0;padding:10px 18px;font-size:var(--fs-meta);line-height:1.45;cursor:pointer;}
.wft-call summary:hover{background:var(--hover);}
.wft-call summary b{font-weight:600;}
.wft-call-what{color:var(--ink-2);white-space:pre;}
.wft-call-prev{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 160px;}
.wft-call-full{margin:0 18px 12px;padding:10px 12px;border-radius:var(--r-sm);background:var(--field);font-size:var(--fs-meta);line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink);}
.wft-call-cap{display:block;margin-bottom:4px;font-size:var(--fs-caption);font-weight:600;color:var(--ink-2);}
.wft-sent-foot{margin:0;padding:10px 18px 14px;border-top:1px solid var(--line);font-size:var(--fs-meta);color:var(--ink-2);line-height:1.45;}
.wft-sent-head + .wft-sent-foot{border-top:0;padding-top:0;}
.wft-sent-real{padding:14px 18px;}
@media (max-width:700px){.wft-outs{grid-template-columns:minmax(0,1fr);}.wft-tiles{grid-template-columns:repeat(2,minmax(0,1fr));}.wft-crow2,.wft-crow{grid-template-columns:minmax(0,1fr) auto;}}
```

- [ ] **Step 7: Run the tests and the design guards**

Run: `node tools/test.mjs test/ui-workflow-test-compare.test.mjs test/ui-workflow-test-progress.test.mjs test/ui-workflow-tests-view.test.mjs test/ui-workflows-markup.test.mjs test/ui-design-language.test.mjs test/ui-shared-controls.test.mjs test/ui-theme-tokens.test.mjs test/css-rules.test.mjs`
Then the style.css slicing tests (the list in the Global Constraints).
Expected: PASS, except the four known `ui-design-language` failures.

- [ ] **Step 8: Commit**

```bash
git add ui/public/workflows/test-compare.mjs ui/public/app.js ui/public/style.css test/ui-workflow-test-compare.test.mjs
git commit -m "Workflow tests: Compare, and one example side by side with what it would have sent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Docs, UI levels, verification and proof

**Files:**
- Modify: `docs/storage.md` (a "Workflow tests (v78)" section after "Workflow history and versions (v77)", before "Run groups (v65)" at :180)
- Modify: `docs/ui-levels.md` (after the Part 1 row, :294)
- Modify: `docs/feature-flags.md` (the `workflowTests` row, :35)
- Modify: `src/shared/flags/registry.mjs` (the `workflowTests` description, :135)
- Modify: `docs/changelog/unreleased.md`

- [ ] **Step 1: Write the docs**

**`docs/storage.md`.** Insert after the v77 section:
```markdown
### Workflow tests (v78)

Behind the experimental flag `workflowTests`; the data is kept either way. No foreign keys, like `workflow_revisions`:
a deleted workflow keeps its examples, and they come back with a workflow saved again under the same id.

- `wf_test_examples`: one row per example of a user workflow:
  - the request, the answers to Worca's questions, and what happens when Worca asks something else (`pick` | `fail`);
  - the Basics and the automatic checks (JSON), and the number of tries (1, 3 or 5);
  - a note, and the past run it came from with the person's verdict (`from_pipeline`, `from_use`, `from_verdict`).
- `wf_test_example_files`: an example's files as BLOBs (at most 5 MB each, 8 per example), with their sha256.
- `wf_test_runs`: one row per test:
  - what it compares: `a_use`, `b_use` (`draft` or a version number) and their fingerprints;
  - which examples, how many tries, the quick check, the cost cap, and its connectors mode (`pretend` | `real`);
  - its status (`running` | `done` | `stopped`) and why it stopped (`changed` when the draft, the Library or an example
    changed while it ran).
- `wf_test_tries`: one row per try. It records:
  - the version it ran, with the workflow fingerprint (graph + today's agent and script hashes) and the example
    fingerprint (request, files, answers, rule, Basics, checks);
  - whether it was a mock, and its connectors mode;
  - its status, its pipeline, its verdict (JSON) and its cost.

  A finished try is reused by a later test when both fingerprints, the mock setting and the connectors mode are equal.
- `wf_test_run_tries`: the tries a test shows, its own and the ones it reused, each on side `a` or `b`. A stopped try
  that "Finish the rest" made again leaves this table but keeps its `run_id`, so its cost stays in the test's cost.
- `pipelines.is_test` = 1 marks a try's run. It is written once, when the row is created. These leave a try out:
  - the Runs list, `/api/counts` and the hello;
  - Statistics;
  - team metrics records;
  - chat notifications;
  - auto-resume, and resuming it by hand (409);
  - the Versions page's run counts, the onboarding ticks and Ask's people.

  Its spend stays in `cost_ledger`, so it counts toward the spending limit. A try never mounts memory.
- A pretend try (connectors `pretend`) writes, in its pipeline folder:
  - `connectors/<nn>-<server>.json`: the tools each stand-in offers, from the connector's last passing Test;
  - `connector-calls.ndjson`: one line per call a stand-in answered (`{ ts, server, tool, arguments, readOnly }`), what
    the try would have sent.
- `mcp/tests.json` (MCP registry): a Test now keeps each tool as `{ name, description?, inputSchema?, annotations? }`;
  results written before keep their names and still load.
- `workflow-tests/seen-connectors.json` (worcaHome): the claude.ai connector names Worca saw when a run started, so
  Test a version can name the ones a pretend try switches off.
```

**`docs/ui-levels.md`.** Add a row after the Part 1 `workflowTests` row:
```markdown
| Behind the flag `workflowTests`, Simple (the people who build workflows test them): the Tests page in the Canvas · Tests · Versions switch (the list of examples, How testing works, first use from past runs), the example editor with the Add a check and question dialogs, Test a version with its Connectors choice (Pretend or Real), the page while a test runs, Compare and one example side by side with what it would have sent, and "Use as test example" in a finished run's More menu | all |
```

**`docs/feature-flags.md`.** In the `workflowTests` row, after "history and restore.", add: "And workflow tests: examples of real requests, Test a version (3 tries per example, 3 at a time, a cost cap), Compare and one example side by side, and Use as test example on a finished run. Tries are hidden runs without a project; their cost counts in the spending limit. By default their connectors are stand-ins that send nothing and show what would have been sent."

**`src/shared/flags/registry.mjs`.** Change the `workflowTests` description to:
```js
    description: 'Save named versions of a workflow, choose which version new runs use, and restore any earlier save. Test a version on your own examples and compare it with another before runs use it.',
```

**`docs/changelog/unreleased.md`.** Add after the Workflow versions section:
```markdown
## Workflow tests (Labs)

**Try a new version of a workflow on real examples, and see what got better or worse.**

Workflow tests (Labs, flag `workflowTests`) add a Tests page to a workflow.
- Keep real requests as examples, with their files and the answers to Worca's questions. Add one from a past run, or write one.
- Say what a good result needs: the Basics (no error, no help needed, a cost limit, how often it is sent back for fixes) and automatic checks counted exactly, without AI (length, sections, must or must not mention, a file, a Library script).
- Test a version: Worca tries every example 3 times on it and on the version you compare with, reuses earlier results when nothing changed, and stops at the cost limit you set.
- Compare shows the tries passed, the cost and time per try, what got better or worse per example, and each example side by side.
- Connectors: by default a test's tries use stand-ins for your connectors, so nothing is posted or sent, and one example's page shows what would have been sent. Choose Real to use your real connectors.
- Tests work for workflows without a project for now. Their runs stay out of the Runs list, Statistics and team metrics, but count in the spending limit.

Chips: Tests · Test a version · Compare · experimental: turn it on in Settings › Labs

Read it: [Where Worca keeps its state](../storage.md)

Pull requests (add each number when it opens):

- Workflow tests (#<PR>)
```
Replace `#<PR>` with the PR's number when it opens (review M10: the same block as the Workflow versions section's).

- [ ] **Step 2: Run the guards**

Run: `node tools/test.mjs test/ui-levels.test.mjs test/flags-registry.test.mjs test/flags-usage.test.mjs`
Expected: PASS.

- [ ] **Step 3: Full verification**
  1. **Every test file touched in this part.**
     - Run `node tools/test.mjs <files>` with the list from `git diff --name-only feat/workflow-tests -- test`.
     - All must pass.
  2. **The full suite on the branch and on a `feat/workflow-tests` baseline worktree.**
     - Use the per-file runner `node C:\Users\BRT1BG\worca-cc\worca-cc-dev\.superpowers\keep\run-files.mjs <repo> <outDir>`.
     - Compare the failing files. Only a file that fails here and passes on the baseline is this part's.
  3. **Smoke:** `npm run smoke`. Use WSL with portable Node 22 if the engine path needs POSIX.
  4. **A mock end-to-end run in the browser.**
     - Start the UI with `WORCA_FLAGS=workflowTests` and `WORCA_MOCK=1`.
     - On a no-project workflow:
       - Save version 1 and edit the draft.
       - Add two examples: one written, one from a past run with "Not good enough" (its v1 cell says "Not good · a past run").
       - Give one example a must-mention check and one a Library script check.
       - Test v1 against the draft with 3 tries and the free quick check.
     - While it runs, check:
       - the Runs list, Running, History and Statistics show no try;
       - no chat notification arrives.
     - Stop it halfway, then Finish the rest.
     - Open Compare and an example side by side.
     - Test again: v1's tries are offered for reuse.
     - Check light and dark at 1440 px and 390 px. Compare with boards 1–6, 19, 20 and 24–31.
     - Test a version shows the Connectors section; a pretend try's side by side shows "Would have sent" (with the mock, "Nothing would have been sent.").
  5. **A real-call proof (only with the user's explicit OK and a budget cap of $2).**
     - One example with 1 try of v1 against the draft, on the cheapest model, connectors Pretend, on a workflow whose agent posts with one tested registry connector (a Slack-like test server is enough).
     - Record:
       - the cost against the spending meter (it counts);
       - that Statistics' Spent does not include it (G14);
       - that the try's pipeline has `is_test = 1` and no `memory/` folder;
       - D35, against the real CLI: the spawn argv has `--strict-mcp-config` and `--disallowedTools mcp__claude_ai_*`; the CLI accepts both; the init event's `mcp_servers` lists only the stand-ins (no claude.ai connector, no `~/.claude.json` server, no Claude Code plugin server); the agent's post reached the stand-in (`connector-calls.ndjson` has it) and nothing was posted. If strict config does not drop the claude.ai connectors, say so to the user before the PR: the `mcp__claude_ai_*` belt is then the only guard, and the disallow pattern must be proven to hold.
  6. **Not covered by Part 2, stated in the PR (D40):** tries are never cleaned up; the heartbeat counts include them.

- [ ] **Step 4: Commit**

```bash
git add docs/storage.md docs/ui-levels.md docs/feature-flags.md docs/changelog/unreleased.md src/shared/flags/registry.mjs
git commit -m "Workflow tests: docs (storage v78, UI levels, flag, changelog) for Part 2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Before the PR (needs the user's go)**
  - **PR body:**
    - the `npm test` comparison numbers and the smoke result
    - UI level Simple, flag `workflowTests`
    - screenshots: light, dark and 390 px
    - "Part 2 of the workflow tests issue; stacked on #979"
  - **Schema:** if #975 (A8) or `dev` took 78 meanwhile, renumber per the Global Constraints before the PR.

---

## Self-review (done while writing; kept for the reviewer)

- **Brief coverage.**
  - D18 → Tasks 1, 6. D19 → Task 4. D20 → Tasks 4, 7 (side A too), 9, 10. D21 → Tasks 4, 5, 9. D22 → Tasks 2, 4, 9.
  - D35 (connectors) → Tasks 2 (the mode in the reuse key), 5 (stand-ins, strict config, script env), 7 (the mode per try), 9 (plan notes, would have sent), 13 (board 30), 14 (board 31). D36 → Tasks 7, 8. D37 → Tasks 7, 9, 10, 11. D38 → Task 8. D39 → Task 13. D34 → Task 1.
  - Each board element marked for Part 2 maps to a task:
    - boards 1, 19, 26 and 29's C8/C15 states → Task 10
    - boards 2 and 24 → Task 11
    - boards 3 and 25 → Task 12
    - boards 4, 30, 20, 27 and 28 → Task 13
    - boards 5, 6 and 31 → Task 14
    - WfBar → Task 10
  - [P3+] elements are absent: Your criteria, Checked with, A result you liked, By criterion, the trust and harder cards, Ask colleagues, Share, the For developers card, and the test-share sentences (boards 4 and 30 included).
- **Placeholders.** None remain. Seven bodies are temporary on purpose and are named as such in their comments: Task 10's `wftOpenExample` and `wftRenderEditor` (Task 11 replaces them), `wftPickRun` (Task 12), `wftTestVersion`, `wftReadView` and `wftRenderView` (Task 13; Task 14 replaces the last two again), as Part 1's Task 7 did with the Versions page.
- **Names across tasks.**
  - `useRef` / `useOf` / `parseUse`, `exampleFingerprint`, `triesOfRun` (with `side`), `spentOfRun`, `reusableTries` (with `connectors`), `CONNECTOR_MODES` and `recoverInterruptedTestRuns` are Task 2's, used by Tasks 5, 7 and 9 (the last by the server's `bootMaintenance`).
  - `attachAnswerer` is Task 3's, used by Task 7. `tryRunBody` and `testTargetOf` are Task 4's, used by Tasks 7 and 9.
  - `pretendServers`, `connectorNotes`, `wouldHaveSent`, `userScopeServerNames`, `seenClaudeAiServers` and `noteSeenServers` are Task 5's, used by the harness (Task 5) and the service (Task 9). `CLAUDE_AI_TOOLS` lives in phases.mjs. `toolNameOf` (mcp/store.mjs) is Task 5's, used by registry.mjs and views.mjs.
  - `readTryOutcome` / `checkTry` / `mainResult` are Task 6's, used by Task 9 (routes and service) and Task 7 (via deps).
  - `createTestRunner(...).{start, stop, continueRun, recover, idle, costOf}`, `MAX_PARALLEL = 3`, `BUSY_TEXT`, `changedText`, `editedText` are Task 7's, used by Task 9. The runner's deps gain `targetOf` (Task 9 provides it). Its frame field is `testRunId` (D33), read by Task 13's `wftChanged` and Task 9's `finishedText` call.
  - `compareModel`, `useLabel`, `testTitle`, `latestTitle`, `estimateOf`, `aboutUsd` and `TRIES_AT_ONCE = 3` are Task 8's, used by Tasks 9, 10, 11, 13 and 14. `andList` is Task 1's, used by Task 13's `scriptCaution`.
  - The routes' JSON shapes are Task 9's Interfaces, read by Tasks 10–14: the plan's `connectors: { mode, pretend, off, scripts }`, the side by side's `connectors`, `wouldHaveSent` and `answeredReads`, a run's `connectors`. `BUSY_HINT` (Task 10, UI) and `BUSY_TEXT` (Task 7, server) are the same sentence, pinned by literal in both tests.
  - The `wft*` controller functions are defined once (Task 10) and replaced only where a later task says so. `wftOpenExample`, `wftSaveExample` and `wftEditorActions` move to Task 11 with the editor.
- **The review (`.superpowers/sdd/part2-plan-review.md`).** C1 → the design rules in the Global Constraints and every UI task's guard step; C2 → D35 and Task 5; I1, I2, I7, M5, M6 → Task 4; I3, M9 → Task 7; I4 → C2, D38, Task 8; I5 → Tasks 10 and 11; I6 → each UI task's Precondition; M1, M2 → the file lists and the Global Constraints; M3 → `testRunId`; M4 → Task 2's recovery and Task 9's `bootMaintenance`; M7 → Task 12; M8 → Task 4's limit test and `test/workflow-test-routes.test.mjs`; M10, M11 → Task 15; M12 → D40; M13 → kept in Task 4 (D40).
- **Constraints.**
  - No new identifier is called `version`. The column is `use_ref`, the fields are `use` / `a` / `b`, and `versionNo` is read only from Part 1's API.
  - CSS uses only existing tokens (`--seq`, `--peach`, `--peach-bg`, `--slate-*`, `--amber-wash`, `--amber-line`, `--blue-wash`, `--blue-line`, `--canvas-2`, `--line-2`, `--mono`, …), the type steps `--fs-*` and the radius tokens `--r-*`, `50%` only on `…-dot` selectors, sits in the workflows section, and every block is closed.
  - No glyph-only string: icons come from `ui/public/icons.mjs`. On/off controls are switches; the three checkbox families carry their `JS_CHECKBOX_OK` tokens (`wft-pick-box`, `wft-keep-box`, `wft-tv-optin`).
  - Route errors are `{ error }` with 400 / 404 / 409 / 422 / 500. Routes and the frame are flag-gated, and the markup carries `data-flag`.
  - Tests use the mock engine only and read no `plans/` file. The one claim no mock can prove (strict config and claude.ai connectors) is in Task 15's real-call proof.
