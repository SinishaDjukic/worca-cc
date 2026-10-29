# Runs

A run takes your task through a workflow of agents and ends with work on its own branch. This page covers how
Worca picks the workflow, what the Default workflow does, and what a run gives you while it runs and after it
ends.

## Auto: Worca picks the workflow

You don't have to choose a workflow yourself. **Auto** is first in the New pipeline **Workflow** picker and is
selected by default (`--workflow auto` on the CLI).

One model call reads the task text, any attached files and a small offline fingerprint of the repository. It may
also take a brief read-only look at the checkout. It then classifies the task: a free-form prompt, a partial plan
or a complete plan, how large the change is, and signals such as a big web UI feature.

Auto knows each agent only by its metadata and the front matter of its agent file, never its full instructions.
From those it assembles a workflow that fits the task. If a saved workflow already has exactly that shape, Auto
reuses it. Otherwise the proposal is saved as a new workflow once it's accepted.

With **Human in the loop** on (the default), you see the proposal first. You can **Accept & run**, **Revise** it in
plain text (Advanced and up), or **Cancel run**.

Turn the switch off (`--no-human`) and the proposal is accepted as it is, with no clarify step and no agent
questions. The run still pauses when a loop runs out of cycles, on a recovery prompt, at a cost cap or on an error.

To skip all of this, pick a saved workflow instead. Auto works for workspace runs too.

## The Default workflow

The built-in **Default** workflow hands your task to five agents:

1. **Clarify** asks before it assumes. It turns hidden decisions into up to 8 multiple-choice questions, each with
   2–4 options, free text and sometimes a recommended pick. When the task is clear, it asks nothing. The planner
   records your answers in the plan's `## Clarifications (Q&A)` section, so every later step sees them.
2. **Plan** explores the codebase and writes an implementation plan with concrete code snippets.
3. **Refine Plan** reviews and rewrites the plan (`-v2`, `-v3`, …) until no critical or major issues remain.
4. **Implementation** follows the approved plan using TDD (red-green-refactor). It doesn't deviate from the plan,
   and records any deviation it is forced into.
5. **Review Implementation** reviews the git diff against the plan. Blocking findings go back to the implementer,
   and the two loop until the review is clean.

Each loop has a cycle cap: 3 by default, and you can change it per loop. When a loop reaches its cap with blocking
findings left, the run pauses and lists the open issues. You choose **I approve another cycle**, or **Don't approve
another cycle and continue** with what you have.

Only `critical` and `major` findings block. `minor` findings and suggestions never do. When the run finishes, its
work is committed to its own `worca-cc/…` branch, ready for **Create PR**.

![A live run, "Webhooks for deal stage changes", waiting at its Clarify step under Needs you: two questions from Clarify, the first with lettered options, a Recommended pick and a field to type your own answer](screenshots/clarify.png)

## A run's record

Every finished run keeps its full record, with one tab for each part:

- **Overview**: the review verdict and its findings, time, cost and files changed.
- **Diff**: every changed file with its +/− and patch.
- **Artifacts**: the plans, reviews and other files the steps wrote.
- **Actions**.
- **Workflow**: the graph as it ran. At Expert it adds time and cost per step.
- **Q&A**: the clarify answers and any questions asked mid-run.
- **Logs** and **Agents**, at Expert.

Diff, Artifacts and Actions start at Advanced (see [UI levels](ui-levels.md)).

A run in a Folder project works on a copy of the folder. Instead of **Diff** and **Actions** it has **Changes**, at
every level, listing each file it added, updated or deleted. You land the work with **Apply to folder** or drop it
with **Discard**. Files that changed in the folder since the run started are skipped, and the dialog lists them.

A run with **No project** works in its own folder. It opens on **Artifacts** at every level and has no **Diff**,
**Changes** or **Actions**.

![A finished run, "CSV export for contacts", on its Diff tab: 4 files changed (+36 −0) in a file tree beside the highlighted patch of src/routes/contacts.js, with the run's worca-cc/ branch, its time and cost, and the Create PR and Publish branch buttons](screenshots/run-detail.png)

## Running, pausing and shipping

### A deterministic engine

A scheduler walks the workflow graph and decides what runs next. Agents do the creative work, but they never decide
the control flow. Every step, verdict, cost and artifact is recorded. More in [Architecture](ARCHITECTURE.md).

### Pause and resume, even across restarts

**Pause** parks a run, and so does a cost cap or a failing step. Only **Stop** ends one.

**Resume** picks the paused Claude sessions back up (`claude --resume`) in the same worktree, including any agent
work that wasn't committed yet. **Resume at…** schedules the resume instead: at a time, or after another run ends,
so paused runs can resume one after another.

Paused runs survive a server restart. A run that was cut off mid-step comes back as *Interrupted*, and you can
resume it from its last clean point. A step that loses the network waits for it and retries by itself, and a run
parked by an outage resumes once the network is back.

### Isolated worktrees

Each run works in its own git worktree on its own `worca-cc/…` branch. Agents never edit your checkout, and runs
side by side don't collide. When a run ends, its work is committed to that branch and the worktree is removed. The
branch stays.

### Run on the source branch

Sometimes you want the result on your own branch, not a new one. Turn on **Run on the source branch** under the
feature branch (or pass `--on-source-branch`). The run still works on a hidden branch while it runs. When it
finishes `done`, Worca fast-forwards your source branch onto the result and deletes the hidden branch. The run's
page then offers **Push <source>** instead of a pull request.

Worca only ever fast-forwards. If the source branch moved in the meantime, its checkout has uncommitted changes, or
the run didn't finish, the work stays on its own branch, and you get the commands to merge it yourself.

### Following runs live

**Runs** in the sidebar lists every run, live and finished. Its **View** menu shows All, Needs you, Running,
Waiting, Finished, **Ready to ship** (finished, no PR yet) or Archived, and groups runs by project or by date.

A live run's page shows its state and current step, the time ticking, its cost and the files it changed. **Live
view** shows the running step inside its workflow graph. **Diff** shows the worktree's changes so far. **Logs**
streams every step with search, and at Expert you can filter by source, level, step and cycle.

The top bar's **Activity** pill counts what needs you and what is running. To hear about it outside the tab, turn
on Settings › General › **Alerts** for desktop notifications and a tab badge when a run waits for you.

**Archived runs** (Advanced) lists deleted runs and lets you restore them.

### One-click pull requests

A finished run's page offers **Create PR**. In the dialog you can edit the title, write the description or
**Generate** it, open the PR as a draft and turn on watching. Settings › Runs › **Pull requests** can draft the
description as soon as the dialog opens.

Worca then pushes the branch and opens the PR. On GitHub it uses the GitHub CLI (`gh`). On
[Azure DevOps](azure-devops.md) it uses a personal access token, and on [Bitbucket Cloud](bitbucket.md) an access
or API token. A run started from a GitHub issue closes the issue on merge, and a workspace run opens one linked PR
per changed repo. Afterwards the button becomes **View PR**.

To push the branch without a PR, use **Publish branch** (Advanced).

### Watch PR and conflicts

With **Watch PR** on, Worca reads the open PR about once a minute. A failing check, a merge conflict or a requested
change starts a fix run on the PR's branch, which pushes the fix.

After a run, Worca also checks whether the branch still merges into its base. If it does, you get **Update
branch**. If it conflicts, you get **Resolve in a pipeline** or **Resolve in a terminal**.

### Mock mode

To try Worca without spending anything, turn on **Mock mode** on New pipeline (`--mock` on the CLI, or
`WORCA_MOCK=1` for a whole server). The pipeline runs against a deterministic offline mock, with no `claude` and no
tokens. It's meant for demos, development and CI.

![Runs in Simple mode: three runs waiting on clarify questions under Needs you, the rest grouped by project, and a finished run's summary open — Ready to ship, 21m 32s, $4.82, +36 −0 across 4 files](screenshots/running.png)

![The Create PR dialog for the finished run CSV export for contacts: 4 files, +36 −0, its worca-cc/ branch into main, Push remote and Into (GitHub) pickers set to origin — nimbus/nimbus-crm, a PR description previewed as What and How to test, Open as draft unticked and Watch PR ticked, Try it first with the Run, Test and Cursor buttons, and Cancel beside Create PR](screenshots/ship-it.png)
