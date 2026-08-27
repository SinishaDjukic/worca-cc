# Differentiators

Why Worca is not "just another AI harness". A harness runs one agent in one
loop for one person; Worca runs **pipelines** — graphs of agents with gates,
budgets, isolation and policy — for a project and a team. The eight points
below are the unique selling points that follow from that difference, and
the use cases each one unlocks.

---

## 1. Human-on-the-Gates Autonomy

Worca runs multi-step pipelines end-to-end on its own, but every step that
matters — merging code, spending above a threshold, touching production — is
a hard policy gate that only a human can open. That means you can hand an
agent a whole feature, not just a prompt, and still keep veto power exactly
where the risk lives instead of babysitting every turn. The natural extension
is off-hours runs (planned): pipelines that work overnight and queue their
gates for you in the morning, turning idle machine time into reviewed,
ready-to-merge work.

## 2. Dynamic Workflows & Graph Engineering

Pipelines in Worca are explicit node graphs, not a hidden loop inside a chat
window — you can see, edit, version and reuse the shape of the work itself.
Agents can extend that graph at runtime, spawning new steps or sub-agents
when a task turns out to need a research branch, a second reviewer or a
parallel fan-out, while the engine keeps the whole thing deterministic and
replayable. This turns "prompt engineering" into graph engineering: teams
improve the process, not just the wording, and the improvement survives
across runs and projects.

## 3. Auditable Costs & Per-Run Statistics

Every run records what each step cost in tokens, time and money, per model
and per agent, so a pipeline's price tag is a fact rather than a surprise on
the invoice. Because the numbers are attached to the run rather than the
account, you can compare two pipeline designs, spot the step that quietly
burns 60% of the budget, and set per-run budgets that stop the run before it
overspends. This is what makes agentic work manageable as an engineering
resource: you can plan it, forecast it, and justify it.

## 4. Mixed Models & Providers in One Pipeline

A single Worca pipeline can route the planning step to a frontier cloud
model, the bulk implementation to a cheaper one, and anything touching
sensitive code to an on-prem or local model — each step picks the best tool
for its job. Providers are just configuration, so a vendor outage, a price
change or a compliance rule becomes a one-line edit rather than a rewrite.
The result is a pipeline that optimises for quality, cost and data-residency
at the same time, which a single-model harness structurally cannot do.

## 5. Pipeline Chat Integration

Pipelines are reachable from where the team already talks — Telegram, Slack,
Discord, Teams — so a run can be started, questioned, nudged or approved
without opening a console. Gates, questions from agents and completion
reports arrive as messages, and replies flow back into the running pipeline
as input. Agentic work stops being something one developer runs on their
laptop and becomes a shared, visible activity of the team.

## 6. Project-Level Guardrails

Guardrails in Worca belong to the project and the pipeline — which commands
may run, which paths may be touched, which steps need approval, how much may
be spent — not to whoever happens to be sitting at the keyboard. They are
checked into the repo alongside the pipeline definitions, so they are
reviewed, versioned and applied identically whether a senior engineer, an
intern or an off-hours scheduler starts the run. This is what makes
autonomous agents defensible in a real organisation: the policy is a
property of the codebase, not a personal setting. See [guardrails.md](guardrails.md).

## 7. Contained Operation on Cloned Trees

Worca never lets agents work directly in your working copy; every run gets
its own cloned source tree and worktree, does its work there, and hands back
a diff or branch. A run that goes wrong can be discarded with zero blast
radius, and several runs can proceed in parallel on the same repository
without stepping on each other or on you. Isolation by default is what lets
you trust the "autonomous" part — the worst case is a thrown-away clone,
never a corrupted repo.

## 8. Ask Worca

Ask Worca is a conversational layer over everything Worca knows: your runs,
their logs, their costs, their diffs and the pipeline definitions
themselves. Instead of digging through artifacts you ask "why did the review
step reject the plan?" or "what did last night's run cost and what changed?"
and get an answer grounded in the actual run data. It turns the audit trail
from something you *could* inspect into something you actually use, closing
the loop between autonomy and understanding.

---

A narrated slide deck of this document lives in [`docs/why-worca/`](why-worca/)
— open `why-worca.html` in a browser, or bundle it into a single file with
`node docs/why-worca/build-standalone.mjs docs/why-worca/why-worca.html`.
