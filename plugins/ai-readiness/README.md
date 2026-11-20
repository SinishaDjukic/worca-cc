# ai-readiness

A worca-cc plugin, bundled in the builtin marketplace, that checks a repository's AI-readiness
and sets it up. It is data plus a few scripts: seven agents, six script steps, one shared
rubric skill and two pipeline templates. Every result is an ordinary run artifact that worca's
existing cards already render.

- **AI readiness check** maps the repository, asks whether what it found looks right, measures it,
  and shows a scorecard per AI tool. It leaves the repository unchanged.
- **AI readiness setup** does the same and, when you approve a plan, writes `AGENTS.md`,
  `CLAUDE.md` and `GEMINI.md` (each exactly `@AGENTS.md`), the tools' skills folders and path rules,
  recurring-task skills and tests on a branch, re-scores
  the result, test-drives it, and leaves a diff you can ship as a pull request.

Requires worca-cc 1.8.0 or newer (plugin API 5: typed ports, ask forms).

## Install

It ships in the builtin **Worca CC Official** marketplace, so install it by name (or from the
Marketplace page's Browse tab):

```bash
worca plugin install ai-readiness
```

To develop it from a clone of worca-cc, link the directory instead:

```bash
worca plugin link ./plugins/ai-readiness
```

`worca plugin list` then shows `7 agents, 6 scripts, 1 skill, 2 workflows`, and the two templates
appear in the New pipeline workflow picker and in the Composer under the **readiness**
domain. After editing `workflows/*.json` in a linked checkout, run
`worca plugin reimport ai-readiness`.

## Which template to run

| You want | Template | Writes into the repo |
|---|---|---|
| A readiness score and a list of gaps, nothing else (**Evaluate in depth** on the chip) | `AI readiness check` | no |
| The score, then the files and tests written on a branch (**Set up with AI** on the chip) | `AI readiness setup` | yes, on the run's feature branch |

## The flows

**Check:** Readiness view → Map (card A) → Probe → Score → Report (scorecard) → End.

**Setup:** Readiness view → Map (card A) → Probe → Score → Report → Plan (card B) → Generate → Place Claude files →
Seed tests → Probe (after setup) → Re-score → Gate → Test-drive → End.

- **Readiness view** is a script, the first step, that reads the agent-readiness chip's view of the run (the
  tools it judges and its failing checks). The probe uses the same per-engine file lists and size
  limits as the chip.
- **Map** reads the repository (with graphify when worca's preflight found it, a direct read
  otherwise) and asks card A. The graph lives in the run folder, never in the repository. It also
  reads the project's worca memory (see [Project memory](#project-memory)).
- **Probe** is a script. It runs the confirmed install, test, lint and typecheck commands and
  records the facts. It skips commands marked wrong or slow, and never runs build, start or
  single-test commands. Each command has a 5-minute limit, and each probe step (the baseline probe, and each probe
  after setup) has one 25-minute budget; a command cut short by that budget is not counted as failing. A command runs in its own process group, which is stopped when it ends or times out. The probe restores anything the commands wrote, including edits to files that were already uncommitted; the scorecard lists the restored files. A check run therefore
  leaves the repository unchanged.
- **Score** judges quality only (six dimensions, one line of reason each, the gaps). **Report**
  is a script that computes the scores, severities and the pass gate, and writes the scorecard:
  `readiness-baseline.md` plus `readiness/baseline.json` and `readiness/baseline.html` (a
  self-contained card for worca's sandboxed HTML viewer, light and dark). It also writes the
  project profile (see [What worca keeps after a run](#what-worca-keeps-after-a-run)).
- **Plan** asks card B. **Stop** on card B ends the run like a check run: scorecard kept, no
  file written.
- **Generate** writes the planned files; **Seed tests** sets up the chosen tests and runs them.
- **Place Claude files** is a script. Claude Code refuses an agent's writes under `.claude/`, so
  Generate stages Claude skills and rules in the run folder (`readiness-claude/`) and this step
  copies the ones card B approved into the repository's `.claude/`. It only ever writes under
  `.claude/skills/` and `.claude/rules/`; settings, hooks, commands and agents are never placed. A
  file your `.gitignore` ignores is placed but not committed, and the step says so. The final card lists what was placed and skipped,
  and a run whose staged files were never placed is blocked.
- **Re-score** and **Gate** measure again. Gate holds the chip's checks for every judged or
  selected tool, plus heavy directories and the test command. `git.repo`, lockfiles and tracked
  secrets are listed under "Outside setup" and never block. Gate computes the final score and writes
  `readiness-final-cycle<N>.md` plus `readiness/final-cycle<N>.json` and `.html`. The final card
  scores only the tools whose file you approved on card B: untick a tool's file, or leave it
  alone, and that tool is not scored after setup (the score line on card B names it). Below 80,
  or on a hard failure, the run goes back to Generate. A documented command that already failed
  before setup does not block setup: it is a hard failure only when it passed at baseline or Seed
  tests wrote it. The fix loop is capped at 2 cycles per loop
  wire, then worca's cycle gate asks you.
- **Test-drive** drives Claude Code and Codex, when selected, through their own CLI on a small
  real task; the other tools get the probe's static checks (see below). Its findings also loop
  back to Generate.

The run's Overview and Diff tabs fill themselves from the files Generate and Seed tests
wrote; **Ship it** opens the pull request.

## What the cards ask

**Card A (Map)** is asked once per run, after the repository has been read. Every field is
pre-filled from what was detected:

- **Tools**: Claude Code, OpenAI Codex, GitHub Copilot, Cursor, Gemini CLI, Qwen Code, goose,
  OpenCode. Defaults to the tools the readiness chip judges for the project, and keeps them
  selected. A tool is marked "Not used" in Settings › Agent readiness.
- **Repository summary**.
- **Looks right?**: "Yes, keep what you found" (the default) or "Let me correct it". With yes, the
  card is done and the run keeps everything Map found.

"Let me correct it" opens the rest. Every item starts at keep; change only what you know is wrong:

- **What the summary got wrong**.
- **Recurring tasks**: keep or remove each one, and add the ones that are missing.
- **Commands**: keep, wrong, or slow (skip running it).
- **What the tests need** to run.
- **Gotchas**: keep or wrong.
- **Unwritten rules** the team follows.

An item that came from worca memory says so: a command or gotcha shows its memory file, and a
recurring task's reason starts with "From worca memory (<file>)." The summary also names every
memory item, so "Yes, keep what you found" keeps them knowingly.

**Card B (Plan, setup only)**:

- The **score line** from the baseline.
- **Files to write**: one row per file, with the tools it serves and why. Skills are approved per folder (one row for `.claude/skills/`, one for `.agents/skills/`), Claude rules per file.
- **Existing instruction files**: only add, improve or leave alone. "Only add" appends and never rewrites; "improve" may fix
  stale or wrong lines; "leave alone" does not touch the file.
- **Recurring tasks** and what each becomes: a skill in `.agents/skills` or a section in
  `AGENTS.md`. On the plan card each recurring task goes into the repository (for the team and any AI
  tool) or into worca (a skill set assigned to this project, used by worca runs on every engine);
  worca adds it when the run finishes. A task you skip is not written or judged.
- **Tests**: adaptive options. The default never adds a CI workflow or a dependency.
- **Off-limits** items, and notes.
- **Write these files** or **Stop**.

An unattended run (`--yes`) uses the detected defaults on both cards and never waits. When
Away mode answers a card, it uses the same defaults. In both cases nobody saw card A, so the items
that came from worca memory are dropped; everything else Map found is kept. Recurring tasks
default to the repository on card B.

## Project memory

Every agent in the run can see global and project memory. Only Map turns project notes into
candidates: it reads the folder its system prompt names under `## Worca memory` (one folder per
member on a workspace run). A fact becomes
a candidate on card A only when an agent working in the repository needs it and the repository's
instruction files do not already say it: a command, a gotcha or a recurring task. A fact the code
contradicts is dropped and mentioned in the report's gotchas.

Commands that came from worca memory run in the probe only when a person answered card A. On an
unattended run, or when Away mode answered the card, the probe skips them and marks them
`skipped-memory`: they are neither run nor counted as failures.

Memory is a source of candidate facts, never evidence of readiness. Setup never edits or deletes a
memory file. A memory fact reaches an instruction file only when card A keeps it, and Generate
lists the facts it wrote (`promotedMemory` in its report, one line per memory file in its final
message).

## What worca keeps after a run

When a run ends `done`, worca saves two things from it. A mock run saves nothing, and a run that
fails or stops saves nothing. The run's audit says what was saved ("Saved to worca: …") and what
was not, with the reason.

- **The project profile.** Report writes `readiness-profile-baseline.json` and Gate writes
  `readiness-profile-final-cycle<N>.json`. worca stores the newest one with the project: the
  summary, architecture, stack, the commands you kept, conventions, entry points, the gotchas you
  kept, the recurring tasks you kept, the tools, and the score. Each run replaces it. worca keeps
  only those fields, shortens long text and refuses a profile above 64 KiB. A setup run you stop
  on card B still saves the baseline profile.
- **Recurring tasks you sent to worca.** On card B a recurring task can go into the repository,
  into worca, or be skipped. For "In worca", Generate writes nothing in the repository. It writes
  the skill into the run folder and lists it in `readiness-worca-skills.json`. worca adds the skill
  to its library and to a skill set named "AI readiness: <project>", assigned to that project, so
  worca runs on every engine get it. A re-run replaces the skills of the same name in that set and never removes the others. Worca adds only the skills the plan card sent to worca, and only when the skill's folder holds no secret-looking value. A skill name
  that is taken by any other library skill is never overwritten: the skill lands as
  `<task id>-<last 8 characters of the project key>` instead.

Who reads the profile:

- The **Workflows chat** has a `get_project_profile` tool and reads it before it builds a workflow
  or an agent for a pinned project.
- The **agent wizard** adds it to its prompt when the request names a project (`projectKey` on
  `POST /api/agents/generate`; the wizard screen does not send one yet).
- After you add a single project, worca offers to run the check once when a tool the project uses
  is not ready and the project has code. It never starts the check on its own.

A profile saved before the plugin was disabled or removed stays with the project.

## The rubric

`skills/readiness-rubric/SKILL.md` is the single source Score, Plan, Generate and Re-score read.

- **Six core dimensions**, each 0 to 100 or `null` when it does not apply: commands,
  architecture, conventions, gotchas, tests, recurring tasks. A dimension that does not apply
  is scored `null` and left out of the core.
- **Per-tool surfaces.** Each selected tool is scored on what it can actually read. The
  overall score is the lowest of the selected tools, and a tool you did not select is never a
  gap. The pass mark is 80.
- Code health is a paragraph, not a score.

Files per tool (the full table is in the rubric skill, "Files per tool"):

| Tool | Instruction file | Skills folder |
|---|---|---|
| any selected | `AGENTS.md` (core) | none |
| Claude Code | `CLAUDE.md`, exactly `@AGENTS.md`; Claude-only notes in `.claude/rules/*.md` | `.claude/skills/<id>/` |
| Gemini CLI | `GEMINI.md`, exactly `@AGENTS.md` | `.agents/skills/<id>/` |
| Codex, OpenCode, goose | none | `.agents/skills/<id>/` |
| Qwen Code | none | `.qwen/skills/<id>/` |
| Cursor | `.cursor/rules/*.mdc`, only for rules tied to paths | `.agents/skills/<id>/` |
| Copilot | `.github/instructions/*.instructions.md`, only for rules tied to paths | `.agents/skills/<id>/` |

Setup never creates `.github/copilot-instructions.md`. Claude Code's skills and rules go under
`.claude/` through the Place Claude files step.

## Test-drive

Test-drive has live legs for Claude Code (`claude -p`) and Codex (`codex exec`), when selected, each on a
small real task in a throwaway git worktree, using only the generated guidance. The other six tools
get the probe's static checks, with the line "worca cannot drive <Label> headless from a pipeline
step yet". A tool whose CLI is not installed is reported "not driven". On a workspace run
Test-drive drives no CLI: it reports each selected tool's static checks per member.

## Evaluate and Set up with AI (the chip)

The agent-readiness chip's report and the project's Settings card offer two actions, when the
workflow is installed and the run is not in mock mode:

- **Evaluate in depth** starts the AI readiness check run: scores and gaps, nothing changed. It is offered on
  every project with code, ready ones too.
- **Set up with AI** starts the AI readiness setup run. It is offered when a judged tool, the heavy
  directories or the test command fails.

Neither starts on its own. A project has one readiness run (check or setup) at a time, and a project in a
workspace whose readiness run is live counts as busy. The report shows the newest check score
("Evaluated: N/100") and the setup run's state. A project with no code yet gets no offer. Every way of
adding a project (the Add project dialog, Use git, Clone, bulk add, the workspace wizard import, the chat's
project and clone cards) evaluates readiness, and its toast offers Set up with AI, else Evaluate in depth;
`worca add` prints a readiness line and the two commands. The chat may suggest either after adding a
project, and never starts a run.

## Any engine

The pipelines run on any of worca's eight engines. Each step reads the rubric by path; an engine
without sub-agents does workspace members one after another.

## Running from the CLI

```bash
worca --project <dir> --prompt check --workflow wfp_ai-readiness_check
worca --project <dir> --prompt "set up" --workflow wfp_ai-readiness_setup
WORCA_MOCK=1 worca --project <dir> --prompt check --workflow wfp_ai-readiness_check --mock --yes
```

The task text only names the run; the pipeline's steps carry their own instructions, so any
short text works.

With `--yes`, worca answers each card with its detected defaults. An unattended setup run
whose fix loop runs out of cycles (2) goes on anyway: worca answers the cycle-cap question
with "continue", Test-drive runs, and the run ends `done` with a final scorecard that may be
below 80. The final card, not the run status, says whether the setup passed.

Offline (`--mock --yes`) both templates finish `done` with no warning. The Plan and Test-drive mocks
write a clean verdict (`mockRole` `generic-approver`) so the offline run exercises the whole loop; a
real run never reads a missing verdict as approval.

## Workspaces

Both templates also run on a worca **workspace** (pick *Workspace* as the target on the New
pipeline page; workspace runs start from the UI, the CLI has no flag for them). worca fans
the read-only steps out with one sub-agent per member, and the editing steps with one editing
sub-agent per member, each confined to `repos/<projectKey>` inside the run root. The scorecard is one merged card (`readiness/<stem>.json` and `.html`) with a section per
member. The workspace overall is the lowest member's overall. Gate blocks when any member is below
80, has a hard failure, or has no readable judgement, and its findings start with
`Members to fix:`; the fix cycle reworks only those members. Code merges the scorecard; the
agents merge the map, the plan, the generated files and the tests.

A fix cycle still passes through Generate, Seed tests and Re-score, but each works only on the
members to fix and keeps the others as they were. worca caps a fan-out at **8 members**.

A workspace run reuses the workspace map. Card A shows the scan's relations (edit them on the workspace's
Map tab), Map only adds how the members run together, and graphify is not rebuilt when the scan's merged
graph exists. Without a map, Map derives the relations from the code. Each member that uses another member, or is
used by one, gets a `Related repositories` section.

The workspace page has **Evaluate with AI** (the check) and **Set up with AI** (the setup), refused while a
scan, another workspace run or a member's readiness run is live. The Overview Projects card shows a chip per
member and "N of M agent-ready" in its head; the workspace level is the lowest member's, neutral while a
member is unknown. When a scan of the workspace finishes while you are on its page, a one-time notice suggests
Evaluate with AI when a member is not ready.

## Limits

- **No trend across runs.** Each run keeps its own baseline and final cards, and the stored
  profile holds only the latest run; nothing compares two runs.
- **Live legs need a run engine that allows nested CLI processes** (Claude Code does; Codex's workspace-write sandbox does not). A leg the sandbox blocks is reported as not driven, not as a failed task.
- **graphify is optional.** Map degrades to a direct read when it is not installed, and
  `readiness-map.json` says so. When it is installed, Map moves its output into the run
  folder, and every later prompt points at `map.graphDir` and forbids rebuilding it inside
  the repository.
- **Only skills and rules go under `.claude/` in the target repository**, through the Place Claude
  files step. No agent writes there: Claude Code's own safety check refuses unattended writes to
  `.claude/**`, and a `claude -p` session has nobody to approve them.
- **Place Claude files never removes a file.** A file placed in an earlier fix cycle and no longer
  staged stays in `.claude/` and is committed.
- **Create pull request** needs a GitHub remote on the target repository; without one the
  run still ends `Ready to ship` and the diff stays on the run's feature branch.
- **Mount note.** worca mounts the `readiness-rubric` skill into the run worktree where the run's
  engine reads skills (`.claude/skills/readiness-rubric` on Claude Code, `.agents/skills/readiness-rubric`
  on every other engine), every agent that uses it reads that file directly, and worca excludes it from
  the diff and the probe; Generate is also
  told never to list or copy it.

## Layout

```
worca-cc-plugin.json
skills/readiness-rubric/SKILL.md
agents/readiness{Map,Plan,Score,Generate,Tests,Rescore,TestDrive}.{md,meta.json}
scripts/readiness{Chip,Probe,ProbeFinal,Report,Gate,PlaceClaude}.meta.json
scripts/readiness-{lib,chip,probe,report,place}.mjs
workflows/check.json
workflows/setup.json
```
