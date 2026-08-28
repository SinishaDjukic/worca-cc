/* narration-script.js — spoken text for docs/why-worca/why-worca.html.
 *
 * slides[i].lines[k] → the i-th <section>, at reveal step k
 *   lines[0] = on slide entry, lines[1] = data-step="1", lines[2] = data-step="2", …
 *   "" = silent for that step.
 *
 * Spoken-only respellings ("A.I.", "on-prem") live here and never in the
 * slide markup. Source text: docs/why-worca.md.
 */
window.__NARRATION = {
  voiceId: "",
  modelId: "eleven_multilingual_v2",
  gapSeconds: 0.6,

  slides: [
    // ── 1 · Title ────────────────────────────────────────────────────────
    { lines: [
      "Why Worca? Eight things a chat window with a model simply cannot do."
    ] },

    // ── 2 · Harness vs Worca ─────────────────────────────────────────────
    { lines: [
      "First, the difference in one breath.",
      "An A.I. harness runs one agent, in one loop, for one person.",
      "Worca runs pipelines: graphs of agents with gates, budgets, isolation and policy. For a project, and for a team. Everything that follows comes from that difference."
    ] },

    // ── 3 · 01 Human on the gates ────────────────────────────────────────
    { lines: [
      "Number one. Human on the gates, not in the loop.",
      "Worca runs multi-step pipelines end to end on its own. But every step that matters is a hard policy gate that only a human can open.",
      "Merging code. Spending above a threshold. Touching production. You hand an agent a whole feature, not just a prompt, and keep veto power exactly where the risk lives, instead of babysitting every turn.",
      "The natural extension is off-hours runs, which are planned: pipelines that work overnight and queue their gates for you in the morning. Idle machine time becomes reviewed, ready-to-merge work."
    ] },

    // ── 4 · 02 Graph engineering ─────────────────────────────────────────
    { lines: [
      "Number two. From prompt engineering to graph engineering.",
      "Pipelines in Worca are explicit node graphs, not a hidden loop inside a chat window. You can see, edit, version and reuse the shape of the work itself.",
      "The graph can grow at runtime. A Decompose step splits the approved plan into tasks, and the engine rewrites the implement step into one implementer per task: tasks in parallel, phases in sequence, the count decided by the run itself. Deterministic and replayable throughout.",
      "So teams improve the process, not just the wording. And the improvement survives across runs and across projects."
    ] },

    // ── 5 · 03 Costs ─────────────────────────────────────────────────────
    { lines: [
      "Number three. Every run has a price tag.",
      "Every run records what each step cost, in tokens, time and money, per model and per agent. The price of a pipeline is a fact, not a surprise on the invoice.",
      "Because the numbers are attached to the run rather than the account, you can compare two pipeline designs, and spot the one step that quietly burns sixty percent of the budget.",
      "And you can set a per-run budget that stops the run before it overspends. That is what makes agentic work manageable as an engineering resource: you can plan it, forecast it, and justify it."
    ] },

    // ── 6 · 04 Mixed models ──────────────────────────────────────────────
    { lines: [
      "Number four. Cloud, on-prem, and local, in one pipeline.",
      "Complex reasoning is expensive, so you buy it per token. A single Worca pipeline routes planning and review to a frontier cloud model: a few thousand tokens that decide whether the run is any good.",
      "Bulk work runs cheaper on-prem. Implementation and the fix loop, the step that dominates the bill, go to a model you host yourself.",
      "Chores run locally. Tests and the P.R. description come from a small local model, and the test runner is the judge. Providers are just configuration: the same pipeline, at a fraction of the bill."
    ] },

    // ── 7 · 05 Chat ──────────────────────────────────────────────────────
    { lines: [
      "Number five. Runs live where the team talks.",
      "Pipelines are reachable from Telegram, Slack, Discord and Teams. A run can be started, questioned, nudged or approved without opening a console.",
      "Gates, questions from agents and completion reports arrive as messages. Replies flow back into the running pipeline as input.",
      "Agentic work stops being something one developer runs on their laptop. It becomes a shared, visible activity of the team."
    ] },

    // ── 8 · 06 Guardrails ────────────────────────────────────────────────
    { lines: [
      "Number six. Policy travels with the run, not with the developer.",
      "In a plain harness, permissions belong to whoever is at the keyboard: their settings file, their machine, their answer to the allow prompt. In Worca you pick a named guardrail set when you start a pipeline: Permissive, Normal, Strict, or one your team defined. Which files are protected, which commands are denied, whether the environment is scrubbed.",
      "Worca injects that set into every agent the run spawns, as a single settings payload plus a minimal environment. The planner, the implementer, the reviewer and the fixer all run under exactly the same rules, whether a senior engineer, an intern or a scheduler pressed start.",
      "Lower scopes cannot loosen it: a repo's own settings can add restrictions, but never remove Worca's. And the set is recorded on the run, so an audit can say exactly which policy was in force."
    ] },

    // ── 9 · 07 Contained ─────────────────────────────────────────────────
    { lines: [
      "Number seven. The worst case is a thrown-away clone.",
      "Worca never lets agents work directly in your working copy. Every run gets its own cloned source tree and worktree, does its work there, and hands back a diff or a branch.",
      "A run that goes wrong is discarded with zero blast radius.",
      "And several runs can proceed in parallel on the same repository without stepping on each other, or on you. Isolation by default is what lets you trust the autonomous part."
    ] },

    // ── 10 · 08 Ask Worca ────────────────────────────────────────────────
    { lines: [
      "Number eight. Ask Worca: your own agent for your runs, pipelines and results — it was there for all of it.",
      "Ask Worca is a conversational layer over everything Worca knows: your runs, their logs, their costs, their diffs, and the pipeline definitions themselves.",
      "Instead of digging through artifacts, you ask why the review step rejected the plan, and get an answer grounded in the actual run data, with the file and the line it came from.",
      "It turns the audit trail from something you could inspect into something you actually use. That closes the loop between autonomy and understanding."
    ] },

    // ── 11 · Close ───────────────────────────────────────────────────────
    { lines: [
      "Pipelines, not prompts. That is why Worca. The full text is in the docs, under why-worca."
    ] }
  ]
};
