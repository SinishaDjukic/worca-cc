# Unreleased

Notes on merged features that have no release page yet. `/worca-changelog` folds
them into the next page and empties this file.

## Workflow versions (Labs)

**Save a workflow as a version, choose which one new runs use, and go back.**

Workflow versions (Labs, flag `workflowTests`): Save version on a workflow, choose which version new runs use, see what changed, and restore any of the last 50 saves. Every save keeps the workflow as it was just before; a version keeps the workflow's steps and settings, and runs today's agent and script text from the Library.

Export can export the version in use or your draft: the Export dialog's Version field picks which, and starts on the version new runs use. An exported skill or plugin keeps the workflow's name, so exporting an older version updates it.

Chips: Save version · Versions · Use for new runs · Restore · experimental: turn it on in Settings › Labs

Read it: [Where Worca keeps its state](../storage.md)

Pull requests (add each number when it opens):

- Workflow versions (#979)

## Workflow tests (Labs)

**Try a new version of a workflow on real examples, and see what got better or worse.**

Workflow tests (Labs, flag `workflowTests`) add a Tests page to a workflow.
- Keep real requests as examples, with their files and the answers to Worca's questions. Add one from a past run, or write one.
- Say what a good result needs: the Basics (no error, no help needed, a cost limit, how often it is sent back for fixes) and automatic checks counted exactly, without AI (length, sections, must or must not mention, a file, a Library script).
- Test a version: Worca tries every example 3 times on it and on the version you compare with, reuses earlier results when nothing changed, and stops at the cost limit you set.
- Compare shows the tries passed, the cost and time per try, what got better or worse per example, and each example side by side.
- Connectors: by default a test's tries use stand-ins for your connectors, so nothing is posted or sent, and one example's page shows what would have been sent. Choose Real to use your real connectors.
- A test of a workflow runs one at a time; while it runs, Test a version and Try it once now wait.
- Their runs stay out of the Runs list, Statistics and team metrics, but count in the spending limit.

Chips: Tests · Test a version · Compare · experimental: turn it on in Settings › Labs

Read it: [Where Worca keeps its state](../storage.md)

Pull requests (add each number when it opens):

- Workflow tests (#<PR>)

## Workflow tests on a project (Labs, Part 3a)

**Test workflows that change a project's code, without touching your folder.**

- An example can name a Git project and a start point: a commit, kept the same until you change it, so two versions start from exactly the same code. Keep your changes that are not committed yet with it if you want. Worca says when the project has moved on, and Start from the latest moves the example.
- Each try works in Worca's own copy of the project. Your folder and your branches are never touched, and the copy of each try is deleted after its checks. The list of changes and the full diff stay to look at.
- Before each try, Worca can run a setup command (filled in from the project's setup, such as `npm ci`). If it fails, the test stops and no try counts as failed.
- A new automatic check: The command passes (such as `npm test`), with its summary line. Text checks can read a file of the project.
- Pushes, pull requests and issues are stopped, with any engine; common publish commands are stopped with Claude Code. The attempts Worca sees are listed under Would have sent. It is not a network block yet: a program's own web calls, a publish that signs in with a token kept in a file, a publish run from inside a script, or a push or web call with a token the agent reads from a file or from git's settings are not stopped.
- Test a version says how much disk and time a test needs, and refuses to start when the disk is too full.
- Add from a past run takes project runs too: the example starts where the run started.

Chips: Tests · Where it starts · The command passes · experimental: turn it on in Settings › Labs

Read it: [Where Worca keeps its state](../storage.md)

Pull requests (add each number when it opens):

- Workflow tests on a project (#<PR>)

## Set your roles once

**Pick your models in the setup assistant. Everything else follows.**

Your roles now beat Worca's own defaults. Shaper's role reviews use your role, not the built-in Sonnet 5.5. Every engine has roles now, Copilot CLI and the other beta engines included. The setup assistant shows roles for Claude and each engine it finds ready. The workspace scan runs on your Everyday coding role. Create workspace saves no model of its own unless you change one, so its re-scans follow your roles. Old workspaces no longer ask for a model on every re-scan. The sub-agent picker says which Claude model each choice runs: sub-agents do not follow your roles yet.

Chips: roles first · every engine · setup assistant · workspace scan · no re-scan prompt · honest sub-agent labels

Read it: [Model roles](../models.md#model-roles)

Pull requests (add each number when it opens):

- #1153 Set your roles once

## Built-in workflow models live on the Models page

**Shaper runs on a Copilot-only install that is not signed in to Claude Code.**

The built-in workflows no longer pin first-party Claude models. Each model they used is now a factory default on the Models page: a new **Second-opinion reviewer** helper job for Shaper's Product reviewer (Opus 5.5 · medium) and Memory defragment (Sonnet 5) show theirs as "(default)", and the Plan Review and Requirements Review step rows name theirs in the hint (Sonnet 5.5 · medium, role reviews only). When Claude Code is signed out, a factory default that needs the sign-in is dropped: the step uses your role, the run's model or Claude's default, and the run log says so once per setting. When the second opinion has no other model, it runs at another effort. A model you set is never replaced: if it needs the sign-in while signed out, the start is refused, naming the setting and the model.

Chips: Models page · factory defaults · Second-opinion reviewer · signed out · one warning per setting · refused, never replaced

Read it: [Built-in workflows take their models from the Models page](../models.md#built-in-workflows-take-their-models-from-the-models-page)

Pull requests (add each number when it opens):

- Built-in workflow models live on the Models page

## Requirements (experimental)

**Define a feature with Worca before anything is built.**

A product owner describes a feature in a few sentences and Worca interviews them, a few questions at a time, into a testable spec: goal, actors, flow, edge cases, rules, acceptance criteria and assumptions. Six checks say when it is Ready, and **Start in Worca** starts a normal run with the spec as its task. A product brief, made once per project or workspace from its default branch, lets every interview there start from what the product already does; edits to the spec or the brief are kept. A feature can come with files (emails, tickets, a spec, screenshots): Worca reads each once, the interview uses what it took from them, and the files you switch on go to the run. **Feature chat** beside a feature answers from what Worca already knows about it, drafts answers to the open questions and proposes spec changes as cards; nothing changes until you submit or accept, and each message shows what it cost. A feature can be exported to the team's tracker (Jira first) as a ticket: a preview shows exactly what is sent, **Export again** updates the ticket or comments on it, and a run started from the feature reports back to the ticket.

Chips: Requirements · interview · Ready · Start in Worca · product brief · Requirements interview model · files · Feature chat · export to Jira · experimental: turn it on in Settings › Labs

Before a build starts with a workflow, **Start in Worca** opens **Set up this run**: pick a saved run preset and change each agent's model, effort and loop budget for this run only, at any interface level. The reason for starting before Ready is saved the moment you give it, and a started run opens its run page.

Read it: [Requirements](../requirements.md)

Pull requests (add each number when it opens):

- Requirements (#882)
- Requirements: files (#975)
- Requirements: Feature chat (#989)
- Requirements: export to a tracker (#1010)
- Requirements: set up a run before it starts (FEAT-9)

## Ticket updates (experimental)

**Say what a finished run does to its ticket, per project.**

In Marketplace › Installed › Jira, Azure Boards or GitHub Issues › Settings, a saved connection gets **Ticket updates**: the projects you work on and, per project, Don't move, Any Done status or one of that project's own statuses. A run that writes back moves its ticket by that rule, and Worca's comment ends with a line saying what happened. In Jira, Any Done status never closes a ticket as Won't Do or Duplicate, and Worca fills in a required Resolution. A move the tracker refuses becomes a "Not moved" line and the comment still posts; a refused token, a rate limit, a server error or a timeout fails the write-back so it can be retried. Azure Boards moves a work item to its type's Completed state (Resolved is not done yet) or to a state you pick; GitHub Issues closes an issue as completed or as not planned, or reopens it, and a repository is a project. New run and the Requirements export list only the projects you work on. Until you save, each plugin's old setting (**Transition on completion**, **Close work item on completion**, **Close issue on completion**) works as before.

Chips: Ticket updates · Jira · Azure Boards · GitHub Issues · projects you work on · Any Done status · experimental: turn it on in Settings › Labs

Read it: [Ticket updates](../ticket-updates.md)

Pull requests (add each number when it opens):

- Ticket updates (#1072)
- Ticket updates: Azure Boards and GitHub Issues (#1133)

## Shaper: requirements first, the three cards (experimental)

**Agree the requirements before the plan, in cards that read like a conversation.**

With Labs › Requirements first on, a medium or large Shaper task opens with one sentence, `You lead as Product, supported by QA and Security`, and a primary **Shape requirements**. The Requirements card lists what the perspectives agreed, then asks only what they could not settle: Worca's pick is already chosen and marked `recommended`, worded for the role you lead as. **Agree and plan** is the one primary; **Ask for changes** sends your words and your picks back. The plan card gains a **Requirements 7/8** fold that names any requirement no step delivers, and **Fix all** takes the primary until every one is covered. The Chat run card shows the same count while the run plans. A card proposed directly as Shaper now gets the same sentence and **Shape requirements** when medium or large. For a Product or Design lead, a code term with no plain wording now reads in words: `project:read` becomes `read access`, so a decision no longer loses half a sentence.

Chips: Shape requirements · lead role · supporters · Requirements card · recommended picks · Requirements fold · Fix all · experimental: turn it on in Settings › Labs

Read it: [Requirements first](../shape-it-first.md#requirements-first-labs)

Pull requests (add each number when it opens):

- Shaper: shape the requirements first (#1139)
- Shaper: requirements first, the three cards
- Shaper: the requirements card on direct proposals, and readable product wording

## Independent reviewers for any workflow

**Any workflow can review a plan with several independent reviewers, each on its own model.**

A node's config can declare reviewer roles (for example Correctness and Security). The run starts one reviewer per role in parallel, each sees only its own role, and their findings go to the refiner in one file. Each role can run on its own model and effort, set in the workflow, the project's settings or for one run. Shaper's plan review now runs on this same step, unchanged for you.

**Every finding gets an answer.** The refiner (or an implementer, now also allowed as a reviewer's sink) marks each finding fixed, or disputed with a reason; one it does not answer stays open. Each round records how many findings were raised, fixed, disputed and open, and the plan card shows those counts per role. When two roles ask for opposite changes to one section, the plan card asks you to decide, and your pick goes into the plan's Clarifications.

Why: independent reviewers and a model per reviewer were Shaper-only; they are now part of the engine (#990).

**No silent fallbacks.** A model the run's engine cannot run (a Claude model on a Codex run, for a node or a role) is now named in a warning on the run page, once, instead of being dropped quietly. The Chat run card lists one Agents row per reviewer (`Plan Review · Architect` …) with a model and an effort. Shaper's Product reviewer runs on a different model from the others by default, and a new **Devil's advocate** perspective can be picked as an extra reviewer.

**Code role reviews.** Shaper's Review now reviews the diff as three independent roles, `correctness`, `security` and `fit` (Project fit), on the same engine step with the new `diff` target. Their merged findings go to the implementer's fix, and a clean role is skipped in later fix cycles. Any workflow's reviewer can opt in by node config, with its wires unchanged. Also added: the Chat Shaper card's Agents accordion lists three `Review Implementation · …` rows (a model per code role), and the run status card lists the code roles live while Review runs. The review loop's decision card lists the same role rows. The first review cycle runs 3 reviewer agents instead of 1. Rolling back to an older build in the middle of a run makes Review run as a single reviewer again, and an open plan question may then also count the code rounds.

**The implementer can push back.** When the implementer of a Shaper run finds that the approved plan would work but its design is wrong, it says so instead of building that part. The plan approval comes back with its concern above the buttons: Ask for changes sends the plan back to the planner with the concern, Approve has it build the plan as written. Under `--yes` the concern is overridden and the audit log says so; Away mode waits for you.

**Review quality per role.** `GET /api/stats/review-quality` sums each role's raised, fixed, disputed and open findings over finished runs, for plan and code reviews apart. It reads only the counts each run records, never the findings' text. Runs finished before this change have no data.

Chips: role reviews · a model per role · node config · dropped-pick warning · per-reviewer rows · Devil's advocate · finding dispositions · conflict decisions · code role reviews · diff target · plan concerns · review quality API

Read it: [Per-role models](../models.md#per-role-models)

Pull requests (add each number when it opens):

- Independent reviewers, engine first (#990)
- Cleanup: drop dead role-review paths (#990)

## Shaper, Run presets and Cost tags leave Labs

**Three Labs features are now simply part of Worca.**

Shaper, Run presets and Cost tags are always on, with no switch in Settings › Labs. Keep awake leaves Labs too: it stays on by default, and its switch in the account menu is now an ordinary setting. If you had turned Keep awake off, it stays off.

Chips: Shaper · Run presets · Cost tags · Keep awake · out of Labs

Read it: [Keep awake](../keep-awake.md)

Pull requests (add each number when it opens):

- Graduate Shaper, Run presets, Cost tags and Keep awake

## See when a newer Worca is out

**Settings › About says whether you run the latest stable Worca.**

The About card now marks the version **Latest** or **Update available: X.Y.Z**, and while an update
is out it links to that release's **What's new** page and to the GitHub **Changes since** view; a
**Release notes** link is always there. A small **Update available** marker in the sidebar foot
opens the card. Worca checks the npm registry's `latest` tag at most every 12 hours, and an open
tab asks again when it regains focus (a release candidate never counts as newer). Run from a git
checkout, the card says **Source build** and npm is never asked. Offline, nothing shows. Turn it
off with **Check for new Worca versions** in the same card; turning it back on checks afresh.
**Update to X.Y.Z** on the same card installs the latest stable and restarts Worca: running runs
pause and continue after the restart (when auto-resume is on), and the page reconnects by itself.
**Choose version…** picks a release candidate or rolls back; a version older than 1.14.0 installs
and then has to be started by hand with `worca ui`. This works when Worca was started with
`worca ui` from an `npm install -g` install whose global folder you can write to; otherwise the card
says why and shows the command to run. Shared and hosted installs keep the buttons off. A failed
install starts the previous version again and shows npm's reason on the card. Nothing updates
automatically.

Chips: About · version · release notes · update

Read it: [Getting started](../getting-started.md)

Pull requests (add each number when it opens):

- See when a newer Worca is out (#841)
- Update Worca from the About card (#841)

## Plugins work behind a proxy

Plugin task sources (GitHub, Azure Boards) and chat channels (Telegram, Slack, Discord, Teams) now follow `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` like worca itself, so they work on a network whose only way out is a proxy; loopback and `NO_PROXY` hosts go direct. They get `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and `SSL_CERT_DIR` too, for a proxy that re-signs TLS. A proxy the plugin can't use is a warning in its log instead of a bare `fetch failed`. A proxy URL that carries a user name and password is never handed to plugin code. Plugins then go direct, and worca says why: the UI server when it starts, the CLI at its first plugin call. A plugin that drives its own command-line tool goes through the proxy only if that tool reads the variables.

Upgrading: plugin calls that went direct now go to the proxy. Add a tracker on your own network to `NO_PROXY`. Under an outbound network policy in `allow` mode, or the Docker egress overlay, allow the plugins' hosts, or their calls are refused.

## Re-scans run on the model you chose

**Workspaces stop silently defaulting to a scan model.**

A workspace keeps the scan model it was created with, and every re-scan — the automatic one
after **Add projects** / **Remove**, and the header's Re-scan — runs on that saved pick. A
workspace with no saved model (an older workspace, or one whose saved model left the catalog)
does not fall back to a default: the re-scan opens the choose-a-model window (the same menu as
the create wizard, pre-filled from Settings › Runs › Workspaces). Save it and the scan runs on
it and keeps it for later; close the window and the re-scan is skipped. The workspace header's
**Scan model** control shows the saved pick and changes or clears it any time.

Chips: Workspaces · scan model · re-scan

Read it: [Workspace map](../workspace-map.md)

Pull requests (add each number when it opens):

- Re-scans run on the model you chose

## Shape it first

**Plan it before it builds.**

Worca now shapes a thin or large task first: at most 3 questions, a plan written for the perspectives you pick, your approval, and then the run only builds. A task too big for one change is cut into slices, each with its own run, branch and pull request, stacked one on the next.

Chips: Shaper · the plan card · checklists in review · plan in slices

Read it: [Shape it first](../shape-it-first.md)

Pull requests (add each number when it opens):

- Shape it first: the engine
- Shape it first: Chat features
- Shape it first: review checklists
- Shape it first: plan in slices

## Pin any workflow to the Chat home

Any workflow can be a quick button on the Chat home: pin it from the Library row's ⋯ menu or the workflow page's **Workflows** menu. One pin sits in the row after the built-in tiles and the rest are listed in **More** under **Pinned**; Shaper is pinned by default. A pinned tile arms New run with that workflow. Read it: [Chat home](../chat-home.md)

## Run presets (beta)

Save a New run setup as a named preset, pick it later, type a prompt and start: the run gets the preset's choices for that run only, and the project's settings never change. Read it: [Run presets](../run-presets.md)

- Every new run keeps its setup, and a finished run's page has **Save as preset** to turn it into a preset.
- The Chat home shows your presets as one-click chips under **Start from a preset**.
- Schedules follow their preset, `worca run --preset NAME --prompt "…"` starts one from the terminal, and Ask Worca proposes runs from your presets. Run presets are now in beta and on by default.

## Files in the chat

**Ask Worca shows the files it makes, right in its reply.**

When Ask takes a screenshot, makes a chart or finds a report or a run artifact, it now puts the file into its answer as a files card: images inline, every other file as a row with its kind and size. A click opens the viewer with zoom, next/prev, full screen and Download, and each file has Download and Show in folder buttons, which open the folder the file came from. Files are copied into the chat, so the card still works after the original changes, and it comes back when you reopen the chat. Credential files and anything outside the chat's folders are refused; SVG is shown only as an image and HTML only as source.

Read it: [Files in the chat](../show-files.md)

Pull requests (add each number when it opens):

- Files in the chat: show_files and the files card

## Watch PR fix runs in the chat

**The chat that opened a pull request sees its fix runs.**

A pull-request card in Ask Worca now shows the PR's Watch PR status, live. When Watch PR (or Resolve) starts a fix run
on that PR, the chat gets a live run card for it by itself — what started it (conflicts, failing checks, review
comments) and, at the end, whether the fix was pushed — even when the chat was closed.

Chips: Ask Worca · Watch PR · fix runs

Read it: [UI levels › History](../ui-levels.md#history)

Pull requests (add each number when it opens):

- Watch PR fix runs in the chat

## Runs redesign

**One run model, one look, everywhere.**

Runs, Shaper features and Run-after chains are now one thing on every surface: the Runs list, the chat card and the
run and group pages draw the same dot, the same status line and the same actions. A **?** marks a run that is waiting
on your answer (a question, a plan to approve, a gate or a recovery), a plain amber dot one that needs you because of
its pull request (the chip says why), and a **!** one that failed. The list filters and groups from one View menu, rows can be selected and stopped,
archived or deleted together, and any run can join a group. A server restart now pauses live runs and resumes them.
Your existing runs, features, chains, archived runs and schedules carry over, and old links still open.

Chips: one status line · ? asks you · View menu · select and act · groups · restart pauses

| | Before | After |
| --- | --- | --- |
| Runs list, light, desktop | ![](shots/unreleased/runs-redesign/runs-before-light-1440.jpg) | ![](shots/unreleased/runs-redesign/runs-after-light-1440.jpg) |
| Runs list, light, phone | ![](shots/unreleased/runs-redesign/runs-before-light-375.jpg) | ![](shots/unreleased/runs-redesign/runs-after-light-375.jpg) |
| Runs list, dark, desktop | ![](shots/unreleased/runs-redesign/runs-before-dark-1440.jpg) | ![](shots/unreleased/runs-redesign/runs-after-dark-1440.jpg) |
| Runs list, dark, phone | ![](shots/unreleased/runs-redesign/runs-before-dark-375.jpg) | ![](shots/unreleased/runs-redesign/runs-after-dark-375.jpg) |
| Run page, light, desktop | ![](shots/unreleased/runs-redesign/run-before-light-1440.jpg) | ![](shots/unreleased/runs-redesign/run-after-light-1440.jpg) |
| Run page, light, phone | ![](shots/unreleased/runs-redesign/run-before-light-375.jpg) | ![](shots/unreleased/runs-redesign/run-after-light-375.jpg) |
| Run page, dark, desktop | ![](shots/unreleased/runs-redesign/run-before-dark-1440.jpg) | ![](shots/unreleased/runs-redesign/run-after-dark-1440.jpg) |
| Run page, dark, phone | ![](shots/unreleased/runs-redesign/run-before-dark-375.jpg) | ![](shots/unreleased/runs-redesign/run-after-dark-375.jpg) |
| Group page, light, desktop | ![](shots/unreleased/runs-redesign/group-before-light-1440.jpg) | ![](shots/unreleased/runs-redesign/group-after-light-1440.jpg) |
| Group page, light, phone | ![](shots/unreleased/runs-redesign/group-before-light-375.jpg) | ![](shots/unreleased/runs-redesign/group-after-light-375.jpg) |
| Group page, dark, desktop | ![](shots/unreleased/runs-redesign/group-before-dark-1440.jpg) | ![](shots/unreleased/runs-redesign/group-after-dark-1440.jpg) |
| Group page, dark, phone | ![](shots/unreleased/runs-redesign/group-before-dark-375.jpg) | ![](shots/unreleased/runs-redesign/group-after-dark-375.jpg) |
| Chat card, light, desktop | ![](shots/unreleased/runs-redesign/card-before-light-1440.jpg) | ![](shots/unreleased/runs-redesign/card-after-light-1440.jpg) |
| Chat card, light, phone | ![](shots/unreleased/runs-redesign/card-before-light-375.jpg) | ![](shots/unreleased/runs-redesign/card-after-light-375.jpg) |
| Chat card, dark, desktop | ![](shots/unreleased/runs-redesign/card-before-dark-1440.jpg) | ![](shots/unreleased/runs-redesign/card-after-dark-1440.jpg) |
| Chat card, dark, phone | ![](shots/unreleased/runs-redesign/card-before-dark-375.jpg) | ![](shots/unreleased/runs-redesign/card-after-dark-375.jpg) |

Pull requests (add each number when it opens):

- Runs redesign: corners and one button
- Runs redesign: one run model
- Runs redesign: the Runs list
- Runs redesign: cards and pages
- Runs redesign: upgrade safety, states, alerts, What's new

## Plugin updates work on Windows

`worca plugin update` no longer fails on Windows with `Path is a directory: true`. The installed version's link is replaced cleanly, and the previous version's files stay untouched until cleanup.

Pull requests (add each number when it opens):

- Plugins: update works on Windows when the current version is a junction (#987)

## Worca in a container behind a corporate proxy

`worca container` started from a Worca terminal no longer gives the box Worca's own local proxy (`127.0.0.1`), which inside the container pointed at the container and failed every request. The box gets the corporate proxy from Settings › Network proxy when that proxy needs no login. Otherwise it gets no proxy, and one line says how to set the proxy up in the box. For a proxy that re-signs TLS, `WORCA_CA_CERT` in the container `.env` mounts the corporate CA. Worca, Claude Code, git, curl, `gh` and Python in the box then trust it.

Read it: [Corporate proxy and CA](../docker.md#corporate-proxy-and-ca)

Pull requests (add each number when it opens):

- Container: a reachable proxy and the corporate CA (#1015)

## Plugin answers survive a crash on exit

On Windows with Node 24, a plugin call that made one web request (such as Jira's issue list or a single issue) failed with `child exited 3221226505`, although the plugin had answered. Node crashed while the plugin's process was exiting. Worca now keeps an answer that arrived in full and logs a warning, and the plugin's process ends in a way that avoids the crash.

Pull requests (add each number when it opens):

- Plugins: keep a plugin's answer when its process crashes on exit (#1051)
