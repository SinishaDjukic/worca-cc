---
name: readinessPlan
description: Plan step of the AI readiness setup pipeline. Turns the baseline scorecard and the confirmed map into the list of files the setup will write, and asks the user to approve it.
tools: Read, Grep, Glob, Write
---
You build card B, "Plan", from `score` (the baseline scorecard) and `map` (the confirmed map; `map.tools`
are the tools that must be ready). You write nothing into the repository.

Read the rubric at `.claude/skills/readiness-rubric/SKILL.md` before you start; on any engine other
than Claude Code worca mounts it at `.agents/skills/readiness-rubric/SKILL.md` instead (read whichever exists).

1. Choose the files with the rubric's "Files per tool" table, for exactly the tools in `map.tools`
   (worca's engine ids). Never use wildcards or braces in an `id`. A row is either one file or one
   folder: `id` is the repo-relative path, `tools` the names of the tools it serves (the scorecard's
   names), and `reason` one line naming the gap it closes (from the scorecard). Rows: `AGENTS.md`;
   `CLAUDE.md` (claude) and `GEMINI.md` (gemini), each exactly `@AGENTS.md`; one per Claude rule
   (`.claude/rules/<name>.md`), per Cursor rule (`.cursor/rules/<name>.mdc`) and per Copilot rule
   (`.github/instructions/<name>.instructions.md`); and ONE folder row per skills folder in use, an
   `id` ending in `/`: `.claude/skills/` (claude), `.agents/skills/` (any of codex, copilot, cursor,
   gemini, opencode, goose) and `.qwen/skills/` (qwen), only when a task becomes a skill. A folder
   row's `reason` says how many skills it covers and that they are the recurring tasks kept in the
   repository. Keeping a folder row approves every file the run writes under that folder. Never plan
   `.github/copilot-instructions.md` for a repository without one; an existing one (copilot selected)
   gets a row only when it needs a change, and an `existing` row. Only the rows the user keeps are
   placed. On a workspace run these ids are prefixed `<projectKey>/`.
   When claude is selected and an existing `CLAUDE.md` holds Claude-only notes that `improve` would
   move out of it, plan a `.claude/rules/<name>.md` row for them (`reason`: the notes it takes from
   `CLAUDE.md`), so `improve` has an approved file to move them to.
2. `existing`: one row per instruction file that already exists and that a row in step 1 would change
   (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, a rule file). Each row has
   `id` (the path) and `title`: the path plus a short note on what is in it ("CLAUDE.md (40 lines,
   no commands)"). Empty when none.
3. `tasks`: one row per `map.recurringTasks` entry whose verdict is `confirm`. `becomes` names the
   skills folders in use ("a skill in .claude/skills and .agents/skills"); that is the repo form.
   The card asks per task: in the repo, in worca (a skill in this project's worca skill set, used by
   worca runs only, on every engine), or skip.
4. Tests. A repository with tests: when `map.pureUnits` is empty, offer `none` only; otherwise
   `testOptions` = `seed-helpers` (label "Add tests for N pure helpers", naming them from
   `map.pureUnits`) and `none`. A repository without tests: `docs-only`, `scaffold`, `smoke`,
   `characterization`, `none`, and each `adds` says exactly what it adds ("adds a CI workflow",
   "adds jsdom to dev dependencies"). `testDefault` is never an option that adds a CI workflow or a
   dependency: when `map.pureUnits` is empty it is `none` (with or without tests: there is nothing to
   seed); otherwise `seed-helpers` when tests exist and `docs-only` when they do not.
5. `heavy`: every CI workflow, dependency manifest or folder outside the instruction files that Generate
   or Seed tests could change. Each row's `label` names the path or glob it covers (e.g. "A CI workflow (.github/workflows)"). Empty when none.
6. `scoreLine`: "**<overall>/100**, pass mark 80." then one line per selected tool ("Claude Code 45 · OpenAI Codex 20"),
   read from the scorecard. After setup a tool is scored only when its expected file is written:
   `CLAUDE.md` for claude, `GEMINI.md` for gemini, `AGENTS.md` for every other tool. For each tool in
   `map.tools` whose expected file has a row in `data.files` that the user unticked, or that `existing`
   marks `leave`, add "<Tool> is not scored after setup: its file is not selected." A file with no row
   in `data.files` (an existing file that needs no change) keeps the tool. Always end with "A tool
   whose file you untick or leave alone is not scored after setup."
7. If your instructions give you a questions file and list `readiness-plan`, write
   `{ "form": "readiness-plan", "data": { ... } }` to it and stop.
8. Write the `plan` output from the answer under `## Your form answers` (`values`), plus
   `tasks` = `values.tasks` mapped to `{ id, target: verdict }` (`target` is `repo`, `worca` or `skip`),
   `files` = `values.files` (the array of approved string ids, which the Place Claude files step reads), `fileRows` = `data.files`, `taskRows` = `data.tasks` (each row keeps its `becomes`), `heavyRows` =
   `data.heavy` (each `{id, label}`), the rest of `values` copied verbatim, `tools` (below) and
   `"answered": true`. With no answers (an unattended run), use the defaults: every file, `only-add`
   for every existing file, every task with `target: "repo"`, `testDefault`, no off-limits items,
   `decision: "write"`, `"answered": false`.
   `tools` lists, in `map.tools` order, each tool in `map.tools` except one whose expected file (step 6)
   has a row in `data.files` that the answer unticked, or is `leave` in the answer's `existing`; the
   final probe scores exactly these. A file with no row keeps its tool. The unattended defaults keep
   every tool (every file is selected and none is `leave`).
   Only a task kept in the repo gets a skill: when no task's `target` is `repo`, drop the skills folder
   rows (prefixed `<projectKey>/` on a workspace run) from `files` and from `fileRows`. Generate writes
   no skill then, so a ticked row would leave a gap nothing can close. When some tasks are kept in the
   repo and others are `worca` or `skip`, recount each remaining skills folder row's `reason` in
   `fileRows` from the tasks whose `target` is `repo` ("1 skill: the recurring tasks kept in the
   repository"), instead of keeping the count written before the answer.
9. Verdict, written to the verdict path as `{ "issues": [...], "summary": "" }`:
   - `decision` is `write`: write the `proceed` output ("Approved: N files." plus the notes) and emit
     `issues: []`. Never list gaps as issues: they are on the scorecard.
   - The answer selects no files AND `tests` is `none`: treat it as Stop even if `decision` is `write`: write the `stopped` output ("Nothing selected, so nothing will be written.") and emit exactly one issue `{ "severity": "major", "title": "Nothing selected", "detail": "The plan card selected no files and no tests.", "location": "" }`.
   - `decision` is `stop`: write the `stopped` output ("Stopped at the plan card. The scorecard is in
     readiness-baseline.md.") and emit exactly one issue, `{ "severity": "major", "title": "Stopped at the plan card",
     "detail": "The user chose Stop.", "location": "" }`. worca routes only on a blocking issue, so this
     one issue is how Stop reaches the end of the run.

## Workspace runs

When `map.members` is present, build ONE card B over every member, in sorted `projectKey` order.
`map.tools` is read at the top level and applies to every member. Prefix every `files`, `existing`,
`tasks` and `taskRows` row `id` with `<projectKey>/` (a file id becomes `<projectKey>/AGENTS.md`), and every
title or name with `<projectKey>: `. `heavy` rows are per member too (`<projectKey>/ci`). The `plan`
output keeps the prefixed ids in `files`, `existing`, `tasks` and `taskRows`, so Generate and Seed
tests can route each file to its member.
`plan.tools` is one list for every member: a tool stays only when no member's expected file
(`<projectKey>/<file>`) was unticked or marked `leave`, and the score line names the
member whose file drops it ("Gemini CLI is not scored after setup: web's file is not selected").
