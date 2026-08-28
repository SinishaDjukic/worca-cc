---
name: orchestrate
description: Drive the current project through a deterministic multi-agent pipeline — Plan -> Refine -> Implement -> Review — using only Claude Code (no Node, no CLI, no web UI). Triggers on "/orchestrate", "/orchestrate <prompt>", and on requests to orchestrate, run the pipeline, or drive plan/refine/implement/review for a software task.
---

> **Frozen (2026-08-26).** This skill is a prose clone of the v1 fixed pipeline (Plan → Refine → Implement → Review). worca now runs node-graph pipelines (typed ports, wires, loop budgets, AND/OR/Combine/End cards); this document is deliberately NOT updated and may drift from the engine. For the real engine use /worca. Follow-up: rewrite or retire.

# Orchestrate (native)

You are the **conductor** of a deterministic multi-agent pipeline:
**Preflight -> Clarify -> Plan -> Refine (loop) -> Implement -> Review (loop) -> Done.**
Run it using only Claude Code tools — Agent (subagents), AskUserQuestion, Bash (git),
Read/Write. Do **not** write product code yourself: every phase is a fresh subagent so
each role keeps clean context. You sequence them, read their outputs, evaluate the
gates, and ask the user only where the state machine calls for a human decision.

The task is everything the user typed after `/orchestrate` (or the current request to
orchestrate). Operate in the user's current working directory (`$PWD`) — all file
writes happen there.

At the start, create a TodoWrite list with one item per step below and work them in
order. Loop caps and severities are **not** optional — reproduce them exactly.

## Models

Spawn every subagent with `model: opus` unless the user asked otherwise (e.g.
"use sonnet for the implementer" -> pass `model: sonnet` to that spawn). See
`references/models.md`. Effort is a session-level setting the user controls; you
cannot set it per subagent.

## Step 0 — Preflight

1. Ensure a git repo + checkpoint (the reviewer diffs against it):
   ```bash
   git rev-parse --is-inside-work-tree 2>/dev/null || { git init && git config user.email orchestrator@local && git config user.name orchestrator; }
   git rev-parse HEAD >/dev/null 2>&1 || git -c user.email=orchestrator@local -c user.name=orchestrator commit --allow-empty -m "orchestrator: initial checkpoint" --no-verify $(git add -A; echo)
   CHECKPOINT=$(git rev-parse HEAD)
   ```
   Capture `CHECKPOINT` (the ref string) — you pass it to the reviewer.
2. Detect graph tooling (optional, fail-safe): if a `graphify` skill is available or
   a `graphify-out/` directory exists, set the graph instruction to "graphify is
   available — use it to ground your work" and include it in every agent prompt.
   Otherwise omit it. Never let absence block the run.
3. Create artifact dirs and a pipeline id:
   ```bash
   PREFIX=$(date +%d-%m-%y); ID=$(date +%Y%m%d-%H%M%S)
   mkdir -p ai-artifacts/plans ai-artifacts/reviews "ai-artifacts/pipelines/$ID"
   ```
   Derive `NAME` = a short kebab slug of the task (<=40 chars).
   Plan path = `ai-artifacts/plans/$PREFIX-$NAME.md`; later refined versions append
   `-v2`, `-v3`, … before `.md`. Review path =
   `ai-artifacts/reviews/$PREFIX-$NAME-impl-review.md`. Pipeline dir =
   `ai-artifacts/pipelines/$ID/`.

## Step 1 — Clarify (single round)

1. Spawn the **worca-cc-planner** subagent in CLARIFY mode. Task prompt must include:
   `MODE: clarify`, the pipeline dir, the graph instruction, and the user's task. Instruct it to
   write `<pipelineDir>/clarify.json` (the contract: **up to 8** questions, each with **2–4**
   options, `allowFreeText: true`; empty `questions` array when nothing is materially open).
2. Read `<pipelineDir>/clarify.json`. If `questions` is empty, skip to Step 2 (single round only —
   there is no re-ask loop).
3. Otherwise present the questions with **AskUserQuestion**. That tool accepts at most **4
   questions per call** and **2–4 options per question**, so **batch** the (up to 8) questions into
   groups of ≤4 and make one call per group. Each `clarify.json` entry maps to one question, its
   options to the choices; the tool's automatic "Other" field is the free-text path. (If an entry
   has fewer than 2 options, AskUserQuestion cannot take it verbatim — add one synthetic choice
   "Something else (type your own)" so the call has the required 2 options; the "Other" field still
   captures free text.) Collect every answer and write them to
   `<pipelineDir>/clarify-answers.json` as `{ "answers": [ { "id", "question", "choice" } ] }`.

## Step 2 — Plan

Spawn **worca-cc-planner** in PLAN mode. Task prompt includes: `MODE: plan`, the
resolved Q&A (id, question, chosen answer / free text), the graph instruction, the
exact plan output path (`ai-artifacts/plans/$PREFIX-$NAME.md`), and the user's task.
It writes the build-ready plan (with code snippets) ending in a
`## Clarifications (Q&A)` section. Track the latest plan path as `PLAN`.

## Step 3 — Refine loop (cap 3)

Set `cycle = 1`.
1. Spawn **worca-cc-plan-refiner**. Task prompt: the input plan path (`PLAN`), the
   output path (`PLAN` with `-v{cycle+1}` inserted before `.md`), the review path
   `<pipelineDir>/review-cycle{cycle}.json`, the cycle number, the graph instruction.
2. Read `<pipelineDir>/review-cycle{cycle}.json`. **Blocking = any issue with
   `severity` of `critical` or `major`** (normalize case; unknown -> non-blocking).
   Update `PLAN` to the new `-vN` path the refiner wrote.
3. Decide:
   - No blocking issues -> exit the loop.
   - Blocking and `cycle < 3` -> `cycle += 1`, go to 1.
   - Blocking and `cycle == 3` -> **AskUserQuestion gate** with two options:
     "Continue (accept the open issues)" and "Run another refine cycle". On
     "Continue" -> exit loop. On "Run another cycle" -> `cycle += 1`, go to 1.

## Step 4 — Implement

1. Spawn **worca-cc-implementer** in `implement` mode. Task prompt: `MODE: implement`,
   the latest plan path (`PLAN`), the graph instruction, the user's task. It writes
   real code with strict TDD and does NOT commit.
2. Stage intent-to-add so new files appear in the reviewer's diff:
   ```bash
   git add -A -N
   ```

## Step 5 — Review loop (cap 3)

Set `cycle = 1`.
1. Spawn **worca-cc-code-reviewer**. Task prompt: the plan path (`PLAN`), the
   checkpoint ref (`CHECKPOINT`), the review markdown path
   (`ai-artifacts/reviews/$PREFIX-$NAME-impl-review.md`), the review JSON path
   `<pipelineDir>/impl-review-cycle{cycle}.json`, the cycle number, the graph
   instruction. It runs `git diff $CHECKPOINT` (+ `git status`), writes the review
   markdown + JSON.
2. Read `<pipelineDir>/impl-review-cycle{cycle}.json`. Blocking = critical|major (as
   above).
3. Decide:
   - No blocking -> exit loop.
   - Blocking and `cycle < 3`:
     a. Spawn **worca-cc-implementer** in `fix` mode. Task prompt: `MODE: fix`, the
        plan path, the review markdown + JSON paths, the graph instruction. It fixes
        ONLY the flagged critical/major issues with TDD.
     b. `git add -A -N`
     c. `cycle += 1`, go to 1.
   - Blocking and `cycle == 3` -> **AskUserQuestion gate** ("Continue (accept open
     issues)" / "Run another review cycle"). On "Continue" -> exit. On another ->
     run the fix sub-steps (a, b), `cycle += 1`, go to 1.

## Step 6 — Done

Print: the final plan path, the review path, the pipeline dir, and a one-paragraph
summary of what was built and any open (accepted) issues. Append a closing line to
`<pipelineDir>/audit.md` (create it; log each phase as you go for the audit trail).

## Notes

- Reproduce the loop caps (3/3), the single clarify round, and the critical|major
  blocking rule exactly — they are the contract that makes the pipeline terminate.
- The implementer never commits; you stage with `git add -A -N` so the reviewer's
  `git diff` against `CHECKPOINT` sees new files.
- Everything runs in the user's `$PWD`. Artifacts under `ai-artifacts/` are the audit.
