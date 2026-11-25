# Eval frameworks: what Worca can learn, reuse, or plug in

Research date: 2026-10-29. Versions and licences were checked against the npm and PyPI registries on that date unless noted. "Unverified" marks claims I could not confirm from a primary source.

---

## 0. Bottom line

1. **Do not adopt a framework as a core dependency.** None of them fits all of Worca's constraints together: Node only, no data leaving the machine, plain-language UI, Windows support, and graders that use the user's own engines. The strongest engines are Python (deepeval, Ragas, Inspect, Harbor). The strongest Node option, promptfoo, is a heavy developer CLI: 76 dependencies, about 33 MB unpacked, telemetry, and owned by OpenAI since March 2026.
2. **Borrow ideas heavily, especially from deepeval.** The best ones are:
   - G-Eval's "criteria → evaluation steps → lock the steps" (Part 4).
   - The DAG metric's "exact gates first, judge only at the leaves" (Parts 2 and 4).
   - Arena G-Eval's blinded, randomized pairwise judging (Parts 1 and 5).
   - The Synthesizer's evolve-then-filter loop (Part 5).
   - tau-bench's pass^k for "steady results" (Part 2).
   - SWE-bench's FAIL_TO_PASS / PASS_TO_PASS (Part 3).
   - LangSmith's, MLflow's and Ragas's judge-alignment loops (Part 4).
3. **Small code and prompt reuse is legal and cheap.**
   - autoevals JS (MIT) and openevals JS (MIT) ship judge prompt templates you can copy with the MIT notice.
   - deepeval's prompt templates are Apache-2.0, so you can copy them with attribution, a NOTICE entry and a "modified" note.
   - promptfoo (MIT) exports `assertions.runAssertion` and `matchesLlmRubric` as a library, but it is too heavy to embed for what we would gain.
4. **Plug-in path:** make it optional and developer-facing. Options are:
   - A Library script check that shells out to `npx promptfoo` or `deepeval`.
   - An "Export examples as promptfoo YAML" action.
   - For Part 3, export to Harbor (Terminal-Bench) task format.
   None of these suits non-developers. Treat them as "advanced / for engineers".

---

## 1. deepeval in depth

### 1.1 Basics
- **Repository:** github.com/confident-ai/deepeval. About 19k stars. Licence Apache-2.0. [1]
- **Python package:** `deepeval` 4.3.2 (PyPI, released 2026-10-27), requires Python >=3.9,<4.0. [2]
- **TypeScript SDK (beta):** npm `deepeval` 0.9.24 (2026-10-27).
  - It claims 47 of 49 metrics are ported, including G-Eval, DAG, the multi-turn metrics and the arena metrics.
  - It needs no Python and no Confident AI login, and supports Anthropic, OpenAI, Bedrock, Vertex/Gemini, Ollama and OpenAI-compatible judges.
  - It has a Vitest matcher (`import "deepeval/vitest"`, `toPass()`) and a `npx deepeval test run` CLI.
  - The Synthesizer is **not** ported yet. [3]
  - Caveat: the npm package metadata has **no `license` field**. The repo root is Apache-2.0, so confirm before shipping.
  - Its dependencies include `posthog-node` (telemetry) and an OpenTelemetry exporter stack (registry check).
- **Older npm package:** `deepeval-ts` was only a client for the Confident AI API and is superseded. [3]

### 1.2 Test case and dataset model
- **Test case types:**
  - `LLMTestCase`: `input`, `actual_output`, `expected_output`, `context`, `retrieval_context`, `tools_called`, `expected_tools`.
  - `ConversationalTestCase`: turns.
  - `ArenaTestCase`: several "contestants".
- **Dataset types:** an `EvaluationDataset` holds **goldens**, which are inputs plus optional expected outputs without `actual_output`. At eval time each golden is run through the app to produce test cases.
- **Worca mapping:** a Worca "example" is a golden (request + files + canned answers). A Worca "try" is a test case.

### 1.3 Metric catalogue (2026) [1]
- **Custom:** G-Eval, DAG, Arena G-Eval, and the new JevEval (see 1.9).
- **Agentic:** Task Completion, Tool Correctness, Argument Correctness, Goal Accuracy, Step Efficiency, Plan Adherence, Plan Quality, Tool Use.
- **Multi-turn:** Knowledge Retention, Conversation Completeness, Turn Relevancy, Turn Faithfulness, Role Adherence.
- **RAG:** Answer Relevancy, Faithfulness, Contextual Recall, Contextual Precision, Contextual Relevancy.
- **MCP:** MCP Task Completion, MCP Use, Multi-Turn MCP Use.
- **Other:** Hallucination, Summarization, Bias, Toxicity, JSON Correctness, Prompt Alignment. There are also multimodal and voice metrics.
- **Task Completion** needs a trace. An LLM extracts "the task" and "the outcome" from the trace and scores how well they align. It is referenceless, so it needs no expected answer. [4]
- **Faithfulness and Hallucination** use claim decomposition: extract claims from the output, extract truths from the context, then give a per-claim verdict (yes/no/idk). Score = supported claims ÷ all claims. (This is the documented approach. I did not re-read the template source this session.)

### 1.4 How the LLM-as-judge prompts work
- **G-Eval** [5], based on Liu et al. 2023, "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment" [6]:
  - You give either `criteria` or explicit `evaluation_steps`, never both.
  - With `criteria` only, the judge first *generates* evaluation steps by chain-of-thought, then scores using them. deepeval's own docs warn that the steps are regenerated each run, so scores vary. They recommend writing a short criteria, inspecting the generated steps, then locking them in as `evaluation_steps`. [5]
  - The judge scores 1–10 and the score is normalized to 0–1. Where the model exposes **logprobs**, the final score is the probability-weighted sum over the score tokens, as in the paper. Otherwise it is the raw integer. [5]
  - `threshold` defaults to 0.5. `rubric` confines the judge to named score bands (non-overlapping 0–10 ranges).
  - `strict_mode=True` forces a binary result: 1 for perfect, else 0, with threshold 1.
  - Every metric returns a `reason`, and `verbose_mode` prints the intermediate steps. [5]
  - A **trajectory mode** omits `evaluation_params`, so G-Eval judges the whole trace, including tool calls. [5]
- **DAG metric** [7]: a decision tree.
  - `TaskNode` extracts structured evidence.
  - `BinaryJudgementNode` asks one yes/no question.
  - `NonBinaryJudgementNode` classifies into named verdicts.
  - Each verdict either sets a fixed score (0–10, divided by 10) or hands off (`then`) to another node or a full metric such as G-Eval.
  - The graph and the score mapping are deterministic. Each node is still an LLM call, and the docs say so plainly. [7]
- **Arena G-Eval** [8]: picks a winner among N contestants. Contestant names are hidden and positions randomized to reduce position and length bias. The result is a winner plus a reason, with no score.
- **Licence for copying prompts:** the templates (Python `deepeval/metrics/*/template.py`, shared "language-neutral" templates with the TS SDK [3]) are under Apache-2.0. Copying and adapting is allowed if you:
  - keep the licence text,
  - add attribution in NOTICE / third-party licences,
  - mark the files as modified.

### 1.5 Synthetic data: Synthesizer [9]
- **Generation sources:** `generate_goldens_from_docs`, `from_contexts`, `from_scratch` and `from_goldens` (augment existing goldens). There are single-turn and conversational variants.
- **Pipeline:** generate → **filter** → **evolve** → **style**.
  - **Filtration:** a critic model scores self-containment and clarity. The threshold defaults to 0.5, with up to 3 retries, after which the best attempt is kept.
  - **Evolution** has 7 types:
    - *Reasoning*, *Multicontext*, *Concretizing*, *Constrained* and *Comparative*. The context-bound ones stay answerable from the context.
    - *Hypothetical* and *In-breadth*, which may leave the context.
    - Types are sampled by configured probability, with `num_evolutions` passes per input.
  - **Styling:** input and expected-output format, task, scenario.
- It does **not** produce actual outputs. It only produces inputs and optional expected outputs.
- There is also a **Conversation Simulator**, which acts as a simulated user for multi-turn tests (from deepeval docs; not re-fetched).

### 1.6 Red teaming: deepteam [10]
- Separate package `deepteam` 1.0.10 (Apache-2.0, Python, runs locally).
- It covers 50+ vulnerabilities, including PII and prompt leakage, bias, shell and SQL injection, SSRF, excessive agency, indirect instruction, goal theft and tool-orchestration abuse.
- It has 20+ attacks:
  - Single-turn: prompt injection, roleplay, leetspeak, base64, multilingual, context flooding, and others.
  - Multi-turn: linear, tree and crescendo jailbreaks, and others.

### 1.7 CI integration
- `deepeval test run test_x.py` wraps pytest, and `assert_test(test_case, [metrics])` fails the test below threshold.
- `evaluate()` runs without pytest. Every metric also works standalone with `.measure()`.
- TS: Vitest matcher plus `npx deepeval test run`. [1][3]

### 1.8 Tracing and agent evals
- The `@observe` decorator and `trace()` support integrations for OpenAI, Anthropic, LangChain/LangGraph, CrewAI and others.
- Traces enable component-level metrics and whole-trajectory metrics (Task Completion, trajectory G-Eval). [1][4]

### 1.9 What is local vs cloud
- **Local:** the framework, all metrics (the judge is whatever model you configure; the default is OpenAI), the Synthesizer, deepteam, and pytest runs. Results can be cached locally (json or sqlite). [1][11]
- **Confident AI cloud (optional, "highly recommended" in the README):** shared reports, dataset hosting, production trace monitoring, annotation, failure clustering, and an MCP server. Data is stored in Confident AI's AWS cloud. [1][11]
- **Telemetry:** PostHog sends event names, metric names, an anonymous UUID and your **public IP**. Opt out with `DEEPEVAL_TELEMETRY_OPT_OUT=1`. [11]
- **New in deepeval 4.2.x: "Jev" eval modes.**
  - `eval_mode="hybrid"` / `"system_one"` and the `JevEval` metric route the yes/no decisions to **Jev, a model hosted by TypeSafe AI**. It needs a `TYPESAFE_API_KEY`.
  - It is claimed to return calibrated probabilities with no chain of thought. Pricing and speed are vendor claims.
  - This is a **third-party cloud**. [12][4]

### 1.10 Judge reliability and calibration in deepeval
- Its main reliability tools are:
  - locking G-Eval steps,
  - logprob-weighted scores,
  - strict (binary) mode,
  - DAG trees that narrow each LLM decision to one yes/no,
  - Arena's blinding and position randomization.
- Human alignment and annotation workflows sit mainly in the Confident AI cloud. The open-source library has no built-in "agreement with humans" measurement (not found in the docs I read).
- The Jev modes are deepeval's newest answer to judge variance, but they are cloud-only.

---

## 2. Other frameworks

### 2.1 promptfoo (Node/TS) — most relevant runtime match
- **Package:** npm `promptfoo` 0.125.1 (2026-10-25). MIT, Node >=22.22.0, ESM and CJS.
- **Footprint:** 76 runtime dependencies and about 33 MB unpacked. It uses `drizzle-orm` (local results DB) and `posthog-node`.
- **Ownership:** OpenAI announced the acquisition on 2026-03-09. The founders say it stays open source and multi-provider. [13][14]
- **Library use** [15]:
  - `promptfoo.evaluate(testSuite, options)` takes the same object as `promptfooconfig.yaml`. Providers can be JS functions.
  - The type definitions (checked on unpkg) export `assertions.runAssertion`, `runAssertions`, `matchesLlmRubric`, `matchesFactuality`, `matchesClosedQa`, `matchesComparisonBoolean` (select-best), `matchesAnswerRelevance` and others. So **single assertions can run standalone**, without a full eval.
- **Assertion catalogue** [16]:
  - **Deterministic:** equals, contains, icontains, contains-any, contains-all, regex, starts-with, is-json/contains-json (with schema), is-html, is-sql, is-xml, levenshtein, rouge, bleu, meteor, `javascript`/`python` (returns bool, score or `{pass, score, reason}`), webhook, latency, **cost**, tool-call-f1.
  - **Trajectory:** `trajectory:tool-used`, `tool-args-match`, `tool-sequence`, `step-count`, `skill-used`, trace span checks.
  - **Model-graded:** `llm-rubric`, `g-eval`, factuality, closedqa, answer-relevance, context-faithfulness, `trajectory:goal-success`, `select-best`, `max-score`, similar (embeddings), classifier, moderation.
  - **Modifiers:** a `not-` prefix inverts any check. `weight` sets weighted scoring, and `weight: 0` records a metric without affecting pass/fail. `threshold` applies per test, and `assert-set` groups checks with an optional pass fraction.
- **llm-rubric** [17]:
  - The judge returns `{reason, pass, score 0–1}`. With `threshold`, both `pass` and `score>=threshold` are required.
  - `rubricPrompt` overrides the judge prompt with `{{output}}` / `{{rubric}}` placeholders.
  - The grader provider can be set per assertion, per test or by default. The default grader depends on which key is present; with an Anthropic key it is `claude-sonnet-5`.
- **g-eval** in promptfoo uses two calls (generate steps, then score) and a default threshold of 0.7. [18]
- **Agent and coding-agent support** [19]:
  - Providers `anthropic:claude-agent-sdk` (alias `anthropic:claude-code`) and an OpenAI Codex SDK provider.
  - `working_dir` and `copy_working_dir` give a fresh copy per run. Tools are off by default. There is a sandbox option, `max_budget_usd`, and tool calls recorded for assertions.
  - The docs recommend containers when tests run commands.
- **Script provider** [20]: `exec: <command>` runs any command with (prompt, options JSON, context JSON) and uses stdout as the output. This is how Worca could be driven *from* promptfoo.
- **Local vs cloud:**
  - Evals run locally. Sharing needs Promptfoo Cloud or a self-hosted server. [15]
  - Telemetry (commands and assertion types, no prompts or outputs) is disabled with `PROMPTFOO_DISABLE_TELEMETRY=1`, and update checks with `PROMPTFOO_DISABLE_UPDATE=1`. [21]
  - **Red teaming:** without your own OpenAI key, attack generation and grading use promptfoo's hosted inference (`api.promptfoo.app`), which receives the purpose, plugin config, email and, for grading, the target prompt and response. Some plugins are remote-only. [22]
- **Fit:** the best conceptual match for Parts 2 and 4, and usable from Node. As an embedded dependency it is heavy. It also owns its own result DB, UI and config model, which overlap with what Worca has already built.

### 2.2 Braintrust autoevals (JS + Python)
- **Package:** npm `autoevals` 0.4.1, MIT, about 610 KB, 8 dependencies including the `openai` SDK, `mustache` and `js-yaml`.
- **Scorers** [23]:
  - LLM: Factuality, ClosedQA, Battle (pairwise), Humor, Security, Summarization, SQL, Translation, Moderation.
  - Heuristic: Levenshtein, ExactMatch, NumericDiff, JSONDiff.
  - Also embedding similarity and RAG scorers.
- **Key design:** `LLMClassifierFromTemplate({promptTemplate, choiceScores, useCoT})`. The judge **picks a labelled choice** (A/B/C…) via a function call, and `choiceScores` maps each choice to a number. This is cleaner than asking for a number. The templates are YAML files in `templates/`.
- **Gotcha:** without `OPENAI_BASE_URL`, it defaults to the **Braintrust Gateway**, which needs a Braintrust API key. Point it at your own endpoint. [23]
- **Braintrust platform:** cloud SaaS (npm `braintrust` 3.41.0). Not a fit for the "nothing leaves the machine" rule.
- **Fit:** good source of MIT-licensed judge prompts and the choice-scores pattern. It is small enough to depend on, but Worca runs judges through its own engines, so copying the pattern is better.

### 2.3 OpenAI Evals
- **Repository:** github.com/openai/evals. MIT. The PyPI `evals` package was last released 3.0.1.post1 in **May 2024**.
- **Model:** a YAML registry of evals plus model-graded templates (fact, closedqa, battle and others). It no longer accepts custom-code evals. The README points users to the hosted **Evals in the OpenAI Dashboard/API**. [24]
- **Fit:** legacy. Read the model-graded templates for ideas only. The hosted API is OpenAI-cloud-only.

### 2.4 Inspect AI (UK AI Security Institute)
- **Package:** PyPI `inspect-ai` 0.3.286 (2026-10-28), MIT, Python >=3.11. [25]
- **Concepts** [26]:
  - **Task** = Dataset (`input`, `target`) + Solver (generate, or an agent loop such as `react()`) + Scorer.
  - Scorers: `includes`, `match`, `pattern`, `exact`, `f1`, `model_graded_qa`, `model_graded_fact`. [27]
  - Sandboxes: Docker, Kubernetes, Modal and others.
  - A web log viewer (`inspect view`) and a VS Code extension.
  - About 200 prebuilt evals (inspect_evals).
- **Epochs:** samples can be repeated as "epochs" with score reducers such as mean and pass_at_k (unverified detail).
- **Agent bridge / Inspect SWE:** `inspect_swe` wraps **Claude Code**, **Codex CLI** and **OpenCode** as Inspect solvers inside a sandbox, routing their model calls back through Inspect. Most uses need Docker or Kubernetes. [28]
- **Fit:** research-grade and excellent for rigorous agent evals. It is Python plus Docker and developer-only. Borrow the Task/Dataset/Solver/Scorer split and the transcript viewer ideas. Windows support is not documented (unverified).

### 2.5 Ragas
- **Package:** PyPI `ragas` 0.4.3 (2026-01-13), Apache-2.0, Python only. No npm package.
- **Telemetry:** anonymized usage on by default. Opt out with `RAGAS_DO_NOT_TRACK=true`. [29]
- **Strengths:**
  - RAG metrics (faithfulness, context precision and recall).
  - Test-set generation from a knowledge graph with personas and query synthesizers (single-hop and multi-hop). (From earlier Ragas docs; not re-verified this session.)
  - **Judge alignment:** a documented "align LLM-as-judge" workflow. Annotate about 15–20 examples, measure judge-vs-human agreement, inspect disagreements, revise the prompt. Older versions offered `train()` with gradient-free optimisation of instructions and demonstrations. [30]
- **Fit:** ideas only (alignment loop, personas for Part 5).

### 2.6 LangSmith / openevals (LangChain)
- **LangSmith:** cloud SaaS, with self-hosting only on enterprise plans (from general knowledge; not re-verified).
- **Align Evaluator / few-shot evaluators** [31]: when a person corrects a judge's verdict, the correction is stored and inserted into the judge prompt as a **few-shot example**. The judge then improves with use.
- **openevals:** npm `openevals` 0.2.3 and PyPI 0.2.2, MIT, Python and TS. It works without LangSmith. [32] It provides:
  - **Exported prompt constants**: `CORRECTNESS_PROMPT`, `CONCISENESS_PROMPT`, `HALLUCINATION_PROMPT`, `PII_LEAKAGE_PROMPT`, `PROMPT_INJECTION_PROMPT`, RAG prompts and others.
  - **Trajectory match** in four modes: strict, unordered, subset, superset.
  - A trajectory LLM judge.
  - Code evaluators.
  - Multi-turn simulated users.
- **Fit:** openevals is a clean MIT source of JS prompt constants and the trajectory-match modes. LangSmith itself is cloud: no.

### 2.7 Arize Phoenix evals
- **Phoenix server:** **Elastic License 2.0** (source-available, not OSI). Self-hostable via pip or Docker. [33]
- **Eval packages:** `arize-phoenix-evals` 3.9.5 on PyPI (metadata says Elastic-2.0) and `@arizeai/phoenix-evals` 2.7.1 on npm (metadata says Apache-2.0, "alpha", Node >=22.12). The licences differ, so verify per file before copying.
- **Telemetry:** on by default. Disable with `PHOENIX_TELEMETRY_ENABLED=false`. [33]
- **Fit:** low. Its classification-style judge templates with explanations are a useful idea, but the ELv2 server code should not be copied.

### 2.8 TruLens
- **Package:** PyPI `trulens` 2.16.0, MIT, Python >=3.10. Snowflake-backed. [34]
- **Ideas:** "feedback functions", the RAG triad (context relevance, groundedness, answer relevance), and agentic evaluators: LogicalConsistency, PlanAdherence, ToolSelection, and the "Agent GPA" (goal–plan–action) framing. [34]
- **Fit:** ideas only.

### 2.9 Opik (Comet)
- **Package:** Apache-2.0, Python and TS SDKs (PyPI and npm 2.2.132).
- **Hosting:** self-host via Docker Compose (it has a Windows `opik.ps1`) or Kubernetes, or use the Comet cloud. [35]
- **Features:** LLM-judge and heuristic metrics, datasets and experiments, online evaluation rules on production traces, an Agent Optimizer, pytest integration. [35]
- **Fit:** a whole observability server is overkill to embed. Possible Part 6 inspiration (online rules on real runs).

### 2.10 Langfuse
- **Licence and ownership:** MIT core, except the `ee` folders. Part of ClickHouse since January 2026. [36]
- **Hosting:** self-host via Docker Compose, Kubernetes or Terraform. Telemetry is on by default (`TELEMETRY_ENABLED=false`).
- **Features:** LLM-as-judge evaluators, datasets and experiments, user-feedback scores, manual labelling. [36]
- **SDKs:** npm `langfuse` 3.39.2, PyPI 5.0.4.
- **Fit:** good model for **Part 6**: per-trace "scores" from user feedback and annotation queues. Too heavy (Postgres + ClickHouse) to embed.

### 2.11 MLflow (GenAI evaluate)
- **Package:** PyPI `mlflow` 3.17.2. Apache-2.0 (Databricks). Local tracking server.
- **Judges:** `make_judge()` plus built-in judges (Correctness, **Guidelines** — plain-language pass/fail rules, RelevanceToQuery, Safety and others).
- **`judge.align(traces_with_human_feedback)`:**
  - The default optimizer is MemAlign in the current docs; Databricks docs say SIMBA. The sources conflict.
  - The examples ask for **at least 10 human-labelled traces**. That matches Worca's ≥10 rule.
  - The claimed +30–50% agreement gain is a vendor claim. [37]
- **Fit:** ideas only. "Guidelines" is basically Worca's Part 4 plain-language criteria. MLflow's alignment loop and minimum-label rule validate Worca's design.

### 2.12 Evidently
- **Package:** PyPI `evidently` 0.7.23, Apache-2.0, Python.
- **Features:** row-level "descriptors" (length, sentiment, regex, LLM judges), Reports, and Test Suites with pass/fail conditions. Local UI at `evidently ui`; there is also a cloud. [38]
- **Fit:** ideas only (descriptor = Worca automatic check; report and test-suite split). Its focus is ML monitoring.

### 2.13 Agent and coding harnesses (Part 3)
- **SWE-bench harness:** PyPI `swebench` 5.0.2, MIT. [39]
  - Each task runs in its own Docker image. The model's patch is applied, then tests run.
  - The pass rule is that **FAIL_TO_PASS** tests (the ones the fix should make pass) now pass, **and PASS_TO_PASS** tests (the ones that already passed) still pass. (Field names from the SWE-bench dataset; the harness page itself only covers setup.)
  - Needs x86_64, about 120 GB disk, 16 GB RAM and 8 cores; arm64 is experimental. Windows is not mentioned. There are cloud options (sb-cli, Modal).
  - **Fit:** borrow the two-list test rule, not the harness.
- **Harbor / Terminal-Bench 2.0:** PyPI `harbor` 0.25.0, Apache-2.0, Python >=3.12. [40]
  - The official Terminal-Bench 2.0 harness. It runs Claude Code, Codex CLI, OpenHands and other agents in local Docker, or in cloud sandboxes (Daytona, Modal and others).
  - Each task is a container plus an instruction plus a test script (task-format details from Terminal-Bench docs; not re-verified).
  - **Fit:** an export target for Part 3 power users. Not core: Docker, Python 3.12, Windows unverified.
- **tau-bench / tau2-bench** (Sierra): MIT, PyPI `tau2` 2.4.0. [41]
  - Simulates a user talking to a tool-using agent under a policy, across domains (airline, retail, telecom, banking and others). It can grade by final state rather than by text (from the paper).
  - It introduced **pass^k**: success on *all* k trials. Agents that "sometimes succeed" fail badly here; gpt-4o scored pass^8 under 25% in retail. [42]
  - Anthropic's "Demystifying evals for AI agents" (January 2026) contrasts pass@k (at least once) with pass^k (every time). It also recommends grading outcomes, not brittle step sequences, and mixing code, model and human graders. (I read it through secondary summaries; the original page did not fully load.) [43]
  - **Fit:** pass^k is directly useful for Worca's "steady results" signal.

---

## 3. Recommendations

### 3.1 Ideas to borrow (by Part)

**Part 2: Basics and automatic checks**
1. **pass^k next to the average (tau-bench).** For N tries, show "passed every time" (pass^N) as well as "passed at least once" and the pass rate.
   - Plain language: "Passed all 5 tries", "Passed 3 of 5".
   - This makes "steady results" measurable and feeds the luck rule.
2. **Assertion modifiers from promptfoo:**
   - `not` on every check (Worca has must/must-not mention; generalise it).
   - **weight** and "record only (weight 0)" for checks that inform but do not gate.
   - **check groups** with "at least X of these" (`assert-set` with a threshold).
3. **Richer exact checks** worth adding: valid JSON/CSV against a schema, regex, "contains any / all of", edit distance to a reference answer, max time.
4. **Script checks return `{pass, score?, reason}`.** Use the promptfoo/Inspect `GradingResult` shape, not just pass/fail, so the comparison page can show *why* a check failed.
5. **Trajectory checks on Pretend connectors** (promptfoo `trajectory:*`, openevals strict/unordered/subset/superset):
   - "Connector X was / was not called".
   - "Called with a message containing …".
   - "Steps ran in this order (exact / any order / at least these)".
   - These are exact, cheap and very good regression signals for agent workflows.
6. **Simulated user for clarifying questions** (deepeval Conversation Simulator, openevals simulated users, tau-bench):
   - When the canned answers do not cover a question, an optional "answer like this person would" persona brief answers instead of failing.
   - Off by default, because it adds variance. Record when it was used.

**Part 3: Project workflows**
7. **FAIL_TO_PASS / PASS_TO_PASS (SWE-bench).**
   - At the pinned commit, run the "command passes" check once *before* the workflow (baseline) and once after.
   - Report "tests that should now pass" (optionally named by the user) and "tests that passed before and still pass" separately.
   - A workflow that fixes the target but breaks 3 other tests then shows as a regression rather than as "fails".
8. **Fresh copy per try plus a budget cap per try** (promptfoo `copy_working_dir`, `max_budget_usd`; Inspect sandboxes). Worca already plans the isolated git copy. Add a per-try cost cap in the Basics.
9. **Grade the end state, not the path** (tau-bench, Anthropic's guidance). Prefer "the command passes / the file exists / the diff stays inside these paths" over checking which tools were used.

**Part 4: Your criteria, checked by Worca**
10. **G-Eval steps, frozen.**
    - When a user writes a criterion, have the judge draft a short checklist of evaluation steps once and show it in plain language ("Worca will check: 1… 2… 3…").
    - Let the user edit and approve it, then **store it with the workflow version**. deepeval's own docs recommend exactly this (auto-steps vary per run). [5]
    - Re-generate only when the criterion text changes.
11. **Binary verdicts, as deepeval strict mode does.** Keep yes/no; avoid 1–10 scales for non-experts. If a confidence number is wanted later:
    - the logprob weighting from G-Eval is the cheap route, *if* the engine exposes logprobs (Claude Code CLI does not);
    - otherwise "asked 3×, agreed 3/3" (already in the plan) is the practical proxy.
12. **DAG-style gating.**
    - Evaluate exact checks first. Only call the judge if the gates pass, and let a criterion have a precondition ("only check tone if the report has a Summary section").
    - Cheaper, steadier, easier to explain.
    - Optionally allow a criterion to be split into two or three yes/no sub-questions with a fixed rule for combining them, which is deepeval's `BinaryJudgementNode` tree.
13. **Claim decomposition for "uses only the given files" criteria** (deepeval Faithfulness, Ragas):
    - Extract claims from the output, check each against the input files, and report "12 of 14 statements supported" with the unsupported ones quoted.
    - Pairs well with Worca's verified proof quote: verify the supporting quote with exact text search.
14. **Choice-label judging** (autoevals `choiceScores`). Have the judge pick a labelled option ("A: fully meets, B: partly, C: does not") via structured output, rather than writing free text that must be parsed.
15. **Judge calibration loop** (LangSmith, MLflow, Ragas):
    - **Measure.** Agreement with Agree/Disagree answers, reported **separately for "judge said yes" and "judge said no"** (true-positive rate and true-negative rate). Plain accuracy hides a judge that always says "yes" when most outputs pass. The ≥10-answers rule matches MLflow's minimum-10 guidance. [37]
    - **Improve.** Optionally feed past human corrections into the judge prompt as few-shot examples (LangSmith Align Evaluator). [31] Check agreement on answers *not* used as examples, to avoid fooling yourself.
    - **Watch for criteria drift.** Shankar et al. ("Who Validates the Validators?", EvalGen) found that people refine their criteria while grading. [44] Let a Disagree answer lead to "edit the criterion", and reset the reliability count when the criterion changes.
    - **Known judge biases** to keep testing for in "check the checker":
      - position bias: swap order (Wang et al. [45]);
      - verbosity bias: prefers longer answers;
      - self-preference: judges favour their own model's outputs (Zheng et al. [46], Panickssery et al. [47]). Worca's "judge ≠ writer model" rule addresses this.

**Part 5: Blind review and harder examples**
16. **Evolve-then-filter for harder variants** (deepeval Synthesizer, Ragas personas):
    - Map Worca's variant kinds onto evolution prompts: conflict → *comparative/constrained*; gap → *hypothetical/in-breadth*; rewording → *styling*; size → *concretizing/multicontext*.
    - **Always run a critic filter** before showing a variant to the user: is it self-contained, clear, and still the same task? Use the deepeval defaults (threshold, 3 retries). [9]
    - The user approves variants before they count.
17. **"Hidden instruction" variants from red-team catalogues** (deepteam "indirect instruction", "excessive agency"; promptfoo `indirect-prompt-injection`):
    - Plant an instruction inside an input file.
    - Assert with an exact check that **no Pretend connector was called** and no file outside scope changed. This is deterministic, needs no judge, and is a strong safety check.
18. **Blind pairwise review**, Arena G-Eval style: hide names, randomize order per pair, ask "which is better and why". Use the same design for the colleague HTML file and for an optional "Worca's opinion" pairwise judge between two versions.

**Part 6: Real-use signal**
19. Langfuse and Opik attach **scores** (user feedback, annotations, online judge rules) to production traces. Mirror that as a per-run "kept as is / edited / discarded" score, aggregated per version. No code to reuse.

### 3.2 Code we could reuse directly in Node (licence permitting)

| What | Licence | How to reuse | Verdict |
|---|---|---|---|
| promptfoo `assertions.runAssertion`, `matchesLlmRubric`, `matchesComparisonBoolean` | MIT | `import { assertions } from 'promptfoo'` (exported, per v0.125.1 types) | **Possible but not recommended in core.** 76 deps, about 33 MB, telemetry and update checks (disable via env), Node >=22.22, OpenAI-owned. Worca's exact checks are simpler to write ourselves. |
| promptfoo default rubric / g-eval prompts | MIT | Copy from source with the MIT notice | OK to copy and adapt. |
| autoevals JS `templates/*.yaml` (factuality, closedqa, battle, summarization, …) and the `LLMClassifierFromTemplate` + `choiceScores` pattern | MIT | Copy templates with the MIT notice; or depend on `autoevals` (small) and point it at your own endpoint | **Good source.** Must set the base URL, or it calls the Braintrust gateway. |
| openevals JS prompt constants (CORRECTNESS, HALLUCINATION, PROMPT_INJECTION, TRAJECTORY_ACCURACY…) and trajectory-match logic | MIT | Copy with the MIT notice | **Good source** for Part 4 starter criteria and Part 2 trajectory checks. |
| deepeval judge templates (G-Eval steps and scoring, DAG nodes, Faithfulness claims/truths/verdicts, Arena) | Apache-2.0 (repo) | Copy and adapt; keep licence, add a NOTICE/attribution entry, mark as modified | **Good source**, especially the G-Eval and claim-verification prompts. |
| deepeval TS SDK (npm `deepeval` 0.9.24) as a dependency | Repo Apache-2.0; **npm metadata has no licence field** | `npm i deepeval` | **Not now.** Beta, many peer dependencies, PostHog telemetry, no Synthesizer in TS. Re-check in 2027. |
| `@arizeai/phoenix-evals` | npm says Apache-2.0; Python package says ELv2 | — | Avoid copying until the per-file licence is clear. |

Practical note: Worca runs models through engines (Claude Code CLI and others), not raw SDKs. Most library judges assume a direct OpenAI/Anthropic SDK client, so reusing **prompts and patterns** is a better fit than reusing judge runtimes.

### 3.3 Plug-in options (optional, not core)

| Option | How | Effort | Windows | Non-dev fit |
|---|---|---|---|---|
| **A. Library script check → external metric** | A Library script receives the try's output path(s) and runs e.g. `npx promptfoo eval -c tmp.yaml --output result.json` or `python -m deepeval …` / a small deepeval script, then maps the result to `{pass, reason}`. Works with today's Part 2 script-check contract. | Low (one or two template scripts plus a docs page) | promptfoo: yes (Node). deepeval: needs Python/uv. Quoting in `exec` is unverified on Windows. | Low. Ship as "advanced check templates" an engineer sets up once. |
| **B. Export examples → promptfoo YAML** | Each Worca example becomes a promptfoo `test` (vars = request and files). The provider is `exec: worca run-example …` or a JS provider calling Worca's local API. Automatic checks map to promptfoo assertions; criteria map to `llm-rubric`. Users run `npx promptfoo eval` and `promptfoo view`. | Medium (exporter plus a headless run command; about 2–4 days) | Yes | Low (developer/CI use). Useful for teams that already use promptfoo in CI. |
| **C. Export examples → deepeval goldens (JSON/CSV)** | Goldens = input + expected_output + context (files). The user's own Python harness calls Worca to produce outputs. | Low for the export; the harness is the user's job | Python on Windows works | Low. |
| **D. Part 3 export → Harbor / Terminal-Bench task** | Example = repo at commit + setup command + "command passes" test → a Harbor task (Dockerfile + instruction + test script). Lets power users run Worca-built project examples against Claude Code / Codex in Docker. | Medium | Needs Docker; Harbor on Windows unverified (WSL2 likely) | Very low. |
| **E. Import results** | Parse promptfoo `results.json` / deepeval output into the comparison page. | Medium | — | Low value; skip unless asked. |

Recommendation: do **A** (cheap, already supported by the Part 2 design; just document two templates). Consider **B** if a team asks for CI integration. Skip C–E for now.

### 3.4 What NOT to adopt, and why
- **Any Python framework in the core app** (deepeval, Ragas, Inspect, TruLens, MLflow, Evidently, Harbor). They break the Node-only rule and the Windows install story for non-developers.
- **Cloud platforms:** Confident AI, Braintrust, LangSmith, Comet cloud, Langfuse cloud, Arize AX, the OpenAI Evals dashboard, and promptfoo sharing/Cloud. They break the "no data leaves the machine" rule.
- **deepeval Jev / `hybrid` / `system_one` modes and JevEval.** They send judge inputs to TypeSafe AI's hosted model.
- **promptfoo red-team generation without your own key.** It sends the purpose, email, prompts and responses to `api.promptfoo.app`, and some plugins are remote-only. Borrow the attack *categories* instead.
- **Embedding an observability server** (Phoenix, Opik, Langfuse). They need Docker/Postgres/ClickHouse, overlap with Worca's own run history, and Phoenix is ELv2.
- **SWE-bench / Harbor harness as the Part 3 runner.** Docker-heavy (SWE-bench wants about 120 GB of disk), Linux/x86-centric, and Python. Worca's git-copy approach is the right weight for desktop users.
- **1–10 or 0–1 judge scores in the UI.** Every framework supports them, but for non-experts yes/no plus reason plus quote is clearer and easier to calibrate. Keep numbers internal, if at all.
- **OpenAI Evals repo.** Stale (last PyPI release May 2024).

---

## 4. Summary table

| Framework | Language | Licence | Local? | Best idea for Worca | Plug-in fit |
|---|---|---|---|---|---|
| deepeval 4.3.2 (+ TS SDK 0.9.24 beta) | Python (TS beta) | Apache-2.0 (npm metadata lacks licence) | Yes; cloud optional; Jev modes are cloud | Frozen G-Eval steps (P4); DAG gating (P2/P4); Arena blind pairwise (P1/P5); Synthesizer evolve + filter (P5); claim-level faithfulness (P4) | Medium: script check or goldens export; needs Python (TS beta lacks Synthesizer) |
| deepteam 1.0.10 | Python | Apache-2.0 | Yes | Attack / vulnerability catalogue for "hidden instruction" variants (P5) | Low |
| promptfoo 0.125.1 | Node/TS | MIT (OpenAI-owned since 2026-03) | Yes (red-team generation may use hosted API) | Assertion catalogue: `not`, weight, assert-set, trajectory checks, cost (P2); llm-rubric `{pass,score,reason}` (P4) | **Best:** Node, `exec:` provider, YAML export; heavy as a library |
| Braintrust autoevals 0.4.1 | JS + Python | MIT | Yes (set base URL; defaults to Braintrust gateway) | Choice-label judging with `choiceScores`; YAML judge templates (P4) | Good for copying prompts; could depend (small) |
| openevals 0.2.3 | JS + Python | MIT | Yes | Exported prompt constants; trajectory match strict/unordered/subset/superset (P2) | Copy prompts and logic |
| OpenAI Evals | Python | MIT | Yes (repo); API is cloud | Model-graded templates (historic) | None (stale) |
| Inspect AI 0.3.286 (+ inspect_swe) | Python | MIT | Yes (Docker sandboxes) | Task/Dataset/Solver/Scorer split; Claude Code in sandbox; transcript viewer | Low (Python + Docker, developers) |
| Ragas 0.4.3 | Python | Apache-2.0 | Yes (telemetry opt-out) | Judge-alignment workflow; persona-based test generation (P4/P5) | Low |
| LangSmith | SaaS (+ SDKs) | Proprietary | No (enterprise self-host) | Human corrections → few-shot judge examples (P4) | None |
| Arize Phoenix (evals 3.9.5 / TS 2.7.1) | Python + TS | ELv2 server; evals ELv2 (Py) / Apache-2.0 (npm) | Yes (self-host) | Classification judges with explanations | Low; licence caution |
| TruLens 2.16.0 | Python | MIT | Yes | RAG triad; Agent GPA (goal–plan–action) framing | Low |
| Opik 2.2.132 | Python + TS | Apache-2.0 | Yes (Docker; Windows script) or cloud | Online judge rules on real runs (P6) | Low (server) |
| Langfuse (JS 3.39.2 / Py 5.0.4) | TS server, Py/JS SDKs | MIT core (+ `ee`) | Yes (Docker) or cloud | Feedback scores and annotation on traces (P6) | Low (server) |
| MLflow 3.17.2 | Python | Apache-2.0 | Yes | Guidelines judge = plain-language criteria; `align()` with ≥10 labels (P4) | Low |
| Evidently 0.7.23 | Python | Apache-2.0 | Yes (+ cloud) | Descriptors + test-suite pass conditions | Low |
| SWE-bench harness 5.0.2 | Python | MIT | Yes (Docker, x86, ~120 GB) | FAIL_TO_PASS + PASS_TO_PASS (P3) | None (borrow the idea) |
| Harbor 0.25.0 / Terminal-Bench 2.0 | Python | Apache-2.0 | Yes (Docker) or cloud sandboxes | Task = container + instruction + test script; agent-agnostic (P3) | Low: export target for power users |
| tau2-bench 2.4.0 | Python | MIT | Yes | pass^k "every time" reliability; simulated user; grade end state (P2/P3) | None (borrow ideas) |

---

## 5. Sources

1. deepeval GitHub README — https://github.com/confident-ai/deepeval
2. deepeval on PyPI — https://pypi.org/project/deepeval/ (version 4.3.2, 2026-10-27; also checked via the PyPI JSON API)
3. "Introducing DeepEval TypeScript" — https://deepeval.com/blog/introducing-deepeval-typescript ; npm registry `deepeval` 0.9.24 (`npm view deepeval`)
4. Task Completion metric — https://deepeval.com/docs/metrics-task-completion
5. G-Eval docs — https://deepeval.com/docs/metrics-llm-evals
6. Liu et al., G-Eval (2023) — https://arxiv.org/abs/2303.16634
7. DAG metric — https://deepeval.com/docs/metrics-dag
8. Arena G-Eval — https://deepeval.com/docs/metrics-arena-g-eval
9. Synthesizer — https://deepeval.com/docs/golden-synthesizer
10. deepteam — https://github.com/confident-ai/deepteam
11. deepeval data privacy / telemetry — https://deepeval.com/docs/data-privacy
12. JevEval / eval modes — https://deepeval.com/docs/metrics-jev-eval , https://deepeval.com/docs/evaluation-eval-modes , https://deepeval.com/blog/introducing-jev-in-deepeval
13. promptfoo GitHub — https://github.com/promptfoo/promptfoo ; npm `promptfoo` 0.125.1 (registry; `dist/src/index.d.ts` on unpkg for the exported `assertions` API)
14. OpenAI to acquire Promptfoo — https://openai.com/blog/openai-to-acquire-promptfoo ; https://securityboulevard.com/2026/03/openai-acquires-security-startup-promptfoo-to-fortify-ai-agents
15. promptfoo Node package — https://www.promptfoo.dev/docs/usage/node-package/
16. promptfoo assertions — https://www.promptfoo.dev/docs/configuration/expected-outputs/
17. llm-rubric — https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/
18. promptfoo g-eval — https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/g-eval/
19. Claude Agent SDK provider — https://www.promptfoo.dev/docs/providers/claude-agent-sdk/
20. Custom script (exec) provider — https://www.promptfoo.dev/docs/providers/custom-script/
21. promptfoo telemetry — https://www.promptfoo.dev/docs/configuration/telemetry/
22. promptfoo red-team data handling — https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling
23. autoevals — https://github.com/braintrustdata/autoevals ; npm `autoevals` 0.4.1
24. OpenAI Evals — https://github.com/openai/evals ; PyPI `evals` 3.0.1.post1 (2024-05-01)
25. inspect-ai on PyPI (0.3.286) — https://pypi.org/project/inspect-ai/
26. Inspect docs — https://inspect.aisi.org.uk/
27. Inspect scorers — https://inspect.aisi.org.uk/scorers.html
28. Inspect SWE — https://meridianlabs-ai.github.io/inspect_swe , https://meridianlabs-ai.github.io/inspect_swe/claude_code.html
29. Ragas — https://github.com/explodinggradients/ragas ; PyPI `ragas` 0.4.3
30. Ragas judge alignment — https://docs.ragas.io/en/latest/howtos/applications/align-llm-as-judge/ ; https://blog.ragas.io/aligning-llm-as-judge-with-human-evaluators
31. LangSmith aligning judges — https://blog.langchain.dev/aligning-llm-as-a-judge-with-human-preferences/ ; https://docs.langchain.com/langsmith/create-few-shot-evaluators
32. openevals — https://github.com/langchain-ai/openevals (README)
33. Arize Phoenix — https://github.com/Arize-ai/phoenix ; npm `@arizeai/phoenix-evals` 2.7.1 ; PyPI `arize-phoenix-evals` 3.9.5
34. TruLens — https://github.com/truera/trulens
35. Opik — https://github.com/comet-ml/opik
36. Langfuse — https://github.com/langfuse/langfuse
37. MLflow judge alignment — https://www.mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/alignment/ ; https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/align-judges
38. Evidently — https://github.com/evidentlyai/evidently
39. SWE-bench — https://github.com/SWE-bench/SWE-bench
40. Harbor — https://github.com/laude-institute/harbor
41. tau2-bench — https://github.com/sierra-research/tau2-bench
42. Yao et al., τ-bench (2024) — https://arxiv.org/abs/2406.12045
43. Anthropic, "Demystifying evals for AI agents" — https://anthropic.com/engineering/demystifying-evals-for-ai-agents (read through secondary summaries; the original did not fully load)
44. Shankar et al., "Who Validates the Validators?" (EvalGen, 2024) — https://arxiv.org/abs/2404.12272 (cited from prior knowledge; not re-fetched)
45. Wang et al., "Large Language Models are not Fair Evaluators" (2023) — https://arxiv.org/abs/2305.17926 (prior knowledge; not re-fetched)
46. Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena" (2023) — https://arxiv.org/abs/2306.05685 (prior knowledge; not re-fetched)
47. Panickssery et al., "LLM Evaluators Recognize and Favor Their Own Generations" (2024) — https://arxiv.org/abs/2404.13076 (prior knowledge; not re-fetched)

### Not verified
- Inspect epoch reducers (pass_at_k etc.) and Inspect / Harbor Windows support.
- How Windows quoting behaves in promptfoo's `exec:` provider.
- The exact licence of the npm `deepeval` package (no licence field).
- The exact file-by-file licence of `@arizeai/phoenix-evals`.
- Details of the deepeval Faithfulness template and the Conversation Simulator (from earlier docs knowledge, not re-fetched).
- Ragas knowledge-graph / persona test-set generation details.
- The terms of LangSmith self-hosting.
