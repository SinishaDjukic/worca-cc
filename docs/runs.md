# Runs

How Worca picks a workflow, what the Default workflow does, and everything a run gives you while it runs and after it ends.

## Auto: Worca picks the workflow

Pick **Auto** — first in the New pipeline **Workflow** picker and selected by default
(`--workflow auto` on the CLI) — and Worca picks the workflow for you. One model call
reads the task text, the attached files and a small offline fingerprint of the
repository (and may take a brief read-only look at the checkout), then classifies the
task: a free-form prompt, a partial plan or a complete plan, how large the change is,
and signals such as a big web UI feature. It knows every agent only by its metadata
and the front matter of its agent file (never the agent's full instructions) and
assembles a matching workflow from those agents. A saved workflow with exactly that
shape is reused; otherwise the proposal is saved as a new workflow once accepted. With
**Human in the loop** on (the default), you see the proposal first: **Accept & run**,
**Revise** it in plain text (Advanced and up), or **Cancel run**. Turn the switch off
(`--no-human`) and the proposal is accepted as is, with no clarify step and no agent
questions; a loop that runs out of cycles, a recovery prompt, a cost cap or an error
still pause the run. Pick any saved workflow instead to skip all of this. Auto works
for workspace runs too.

## The Default workflow

The built-in **Default** workflow hands your task to five agents:

1. **Clarify** — instead of assuming, a Clarify agent turns hidden decisions into
   up to 8 multiple-choice questions (2–4 options plus free text, optionally with a
   recommended pick), and asks none when the task is clear. The planner records your
   answers in the plan's `## Clarifications (Q&A)` section, so every later step
   sees them.
2. **Plan** — the planner explores the codebase and writes an implementation
   plan with concrete code snippets.
3. **Refine Plan** — the refiner reviews and rewrites the plan (`-v2`, `-v3`, …)
   until no critical/major issues remain.
4. **Implementation** — the implementer follows the approved plan with no
   deviation (recording any it is forced into), using TDD (red-green-refactor).
5. **Review Implementation** — the code reviewer reviews the git diff against the
   plan and hands blocking findings back to the implementer, looping Implement →
   Review until clean.

Each loop has a cycle cap (default 3, adjustable per loop). A loop that hits it with
blocking findings left pauses the run and lists the open issues: **I approve another
cycle**, or **Don't approve another cycle and continue** with what you have. Only
`critical`/`major` findings block; `minor` findings and suggestions never do. A
finished run's work is committed to its own `worca-cc/…` branch, ready for
**Create PR**.

![A live run, "Webhooks for deal stage changes", waiting at its Clarify step under Needs you: two questions from Clarify, the first with lettered options, a Recommended pick and a field to type your own answer](screenshots/clarify.png)

## A run's record

Every finished run keeps its full record, one tab each in **Runs**: **Overview**
(the review verdict and its findings, time, cost, files changed), **Diff** (every file with its +/− and patch),
**Artifacts** (the plans, reviews and other files the steps wrote), **Actions**,
**Workflow** (the graph as it ran, with per-step time and cost at Expert), **Q&A**
(the clarify answers and any mid-run questions), and at Expert **Logs** and
**Agents**. Diff, Artifacts and Actions start at Advanced (see
[UI levels](ui-levels.md)).
A run in a Folder project works on a copy: in place of **Diff** and **Actions** it
has **Changes** (every file it added, updated or deleted, at every level), and you
land it with **Apply to folder** (files changed in the folder since the run started
are skipped and listed in the dialog) or **Discard**.
A run with **No project** works in its own folder: it opens on **Artifacts** at every
level and has no **Diff**, **Changes** or **Actions**.

![A finished run, "CSV export for contacts", on its Diff tab: 4 files changed (+36 −0) in a file tree beside the highlighted patch of src/routes/contacts.js, with the run's worca-cc/ branch, its time and cost, and the Create PR and Publish branch buttons](screenshots/run-detail.png)

## Running, pausing and shipping

- **Deterministic engine** — a scheduler walks the workflow graph and decides
  what runs next; agents do the creative work, never the control flow. Every
  step, verdict, cost and artifact is recorded
  ([architecture](ARCHITECTURE.md)).
- **Pause & resume, even across restarts** — **Pause** parks a run, and so does
  a cost cap or a failing step; only **Stop** ends one. **Resume** re-attaches
  the paused Claude sessions (`claude --resume`) in the same worktree,
  uncommitted agent work included, or **Resume at…** schedules it — at a time,
  or after another run ends, so paused runs can resume one after another. Paused runs
  survive a server restart, and a run cut off mid-step comes back as
  *Interrupted*, resumable from its last clean point. A step that loses the
  network waits for it and retries by itself; a run parked by an outage resumes
  when the network is back.
- **Isolated worktrees** — each run works in its own git worktree on its own
  `worca-cc/…` branch, so agents never edit your checkout and parallel runs
  don't collide. When a run ends, its work is committed to that branch and the
  worktree is removed; the branch stays.
- **Run on the source branch** — switch it on under the feature branch (or
  `--on-source-branch`) and the run still works on a hidden branch, but when it
  finishes `done` its source branch is fast-forwarded onto that work and the
  hidden branch is deleted; the run's page then offers **Push <source>** instead
  of a pull request. Only ever a fast-forward: a source that moved meanwhile, a
  dirty checkout of it, or a run that did not finish leaves the work on its own
  branch, with the commands to merge it by hand.
- **Live cockpit** — **Runs** in the sidebar lists every run, live and
  finished; its **View** menu shows All, Needs you, Running, Waiting, Finished,
  **Ready to ship** (finished, no PR yet) or Archived, and groups by project or date. A live run's page shows its state and current
  step, ticking time, cost and changed files, and a **Live view** of the running
  step inside its workflow graph; **Diff** shows the worktree's changes so far,
  and **Logs** streams every step with search (filters by source, level, step
  and cycle at Expert). The top bar's **Activity** pill counts what needs you
  and what is running; Settings › General › **Alerts** adds desktop
  notifications and a tab badge when a run waits for you. **Archived runs**
  (Advanced) lists deleted runs and restores them.
- **One-click PRs** — a finished run's page offers **Create PR**:
  *Create PR* lets you edit the title, write the description or
  **Generate** it (Settings › Runs › **Pull requests** can draft it as soon as the
  dialog opens), open it as a draft and watch it, then pushes the branch
  and opens the PR with the GitHub CLI (`gh`), or on
  [Azure DevOps](azure-devops.md) with a personal access token, and
  [Bitbucket Cloud](bitbucket.md) with an access or API token. A run
  started from a GitHub issue closes it on merge, and a workspace run opens one
  linked PR per changed repo. The button then becomes **View PR**.
  **Publish branch** (Advanced) pushes the branch without a PR.
- **Watch PR and conflicts** — with **Watch PR** on, Worca reads the open PR
  about once a minute; a failing check, a merge conflict or a requested change
  starts a fix run on the PR's branch and pushes the fix. After a run Worca also
  checks whether the branch still merges into its base: **Update branch** when
  it does, **Resolve in a pipeline** or **Resolve in a terminal** when it
  conflicts.
- **Mock mode** — the **Mock mode** switch on New pipeline (`--mock` on the
  CLI, `WORCA_MOCK=1` for a whole server) runs the pipeline against a
  deterministic offline mock — no `claude`, no tokens — for demos, development
  and CI.

![Runs in Simple mode: three runs waiting on clarify questions under Needs you, the rest grouped by project, and a finished run's summary open — Ready to ship, 21m 32s, $4.82, +36 −0 across 4 files](screenshots/running.png)

![The Create PR dialog for the finished run CSV export for contacts: 4 files, +36 −0, its worca-cc/ branch into main, Push remote and Into (GitHub) pickers set to origin — nimbus/nimbus-crm, a PR description previewed as What and How to test, Open as draft unticked and Watch PR ticked, Try it first with the Run, Test and Cursor buttons, and Cancel beside Create PR](screenshots/ship-it.png)

