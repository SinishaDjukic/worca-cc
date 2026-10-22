# Worca

[![npm](https://img.shields.io/npm/v/@worca/app)](https://www.npmjs.com/package/@worca/app)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)](.nvmrc)

Worca turns a task into **reviewed, merge-ready work**. It is a
**deterministic multi-agent pipeline**: you point it at a project, describe the
work, and a state machine runs the agents of a workflow in sequence — by
default **Clarify → Plan → Refine → Implement → Review** — looping until the
work clears quality gates, pausing to ask *you* the questions that matter, and
keeping every run isolated in its own git worktree and branch — or, for a plain
folder, on a copy you apply back with **Apply to folder**; with **No project**, in a folder of its own. Pick **Auto**
and Worca chooses the workflow for the task, draw your own in **Workflows** (or
ask its chat to build it), or start the shipped **Presentation** workflow to turn a brief into
a slide deck, **Architecture (C4)** to keep a diagram of your code that
draws itself from the code, or **Promo video** to film your product's real UI.
Agents run on Claude Code by default, or (beta) on Codex, the GitHub Copilot CLI
or Cursor.

It ships as a **web UI**, a **CLI**, and an installable **`/worca` skill** for
Claude Code — all running the same engine — and chat plugins (Telegram, Slack,
Discord, Teams) let you drive runs from a chat. See the
**[architecture in one picture](docs/ARCHITECTURE.md)**.

[![Worca architecture diagram: you reach Worca through the web UI, the CLI, the /worca skill or chat on Telegram, Slack, Discord and Teams; the Worca host, a dev machine or a server, runs @worca/app with its engine, agents, workflows, guardrails, costs and budgets, and plugins, and drives N headless Claude Code harnesses that talk to Anthropic Cloud, a gateway or proxy, an air-gapped on-prem or dev-machine endpoint, or Bedrock/Vertex](docs/screenshots/architecture.png)](docs/ARCHITECTURE.md)

## How a run works

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

![A live run, "Webhooks for deal stage changes", waiting at its Clarify step under Needs you: two questions from Clarify, the first with lettered options, a Recommended pick and a field to type your own answer](docs/screenshots/clarify.png)

Every finished run keeps its full record, one tab each in **Runs**: **Overview**
(the review verdict and its findings, time, cost, files changed), **Diff** (every file with its +/− and patch),
**Artifacts** (the plans, reviews and other files the steps wrote), **Actions**,
**Workflow** (the graph as it ran, with per-step time and cost at Expert), **Q&A**
(the clarify answers and any mid-run questions), and at Expert **Logs** and
**Agents**. Diff, Artifacts and Actions start at Advanced (see
[UI levels](docs/ui-levels.md)).
A run in a Folder project works on a copy: in place of **Diff** and **Actions** it
has **Changes** (every file it added, updated or deleted, at every level), and you
land it with **Apply to folder** (files changed in the folder since the run started
are skipped and listed in the dialog) or **Discard**.
A run with **No project** works in its own folder: it opens on **Artifacts** at every
level and has no **Diff**, **Changes** or **Actions**.

![A finished run, "CSV export for contacts", on its Diff tab: 4 files changed (+36 −0) in a file tree beside the highlighted patch of src/routes/contacts.js, with the run's worca-cc/ branch, its time and cost, and the Create PR and Publish branch buttons](docs/screenshots/run-detail.png)

## Features

### Pipeline

- **Deterministic engine** — a scheduler walks the workflow graph and decides
  what runs next; agents do the creative work, never the control flow. Every
  step, verdict, cost and artifact is recorded
  ([architecture](docs/ARCHITECTURE.md)).
- **Pause & resume, even across restarts** — **Pause** parks a run, and so does
  a cost cap or a failing step; only **Stop** ends one. **Resume** re-attaches
  the paused Claude sessions (`claude --resume`) in the same worktree,
  uncommitted agent work included, or **Resume at…** schedules it. Paused runs
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
  finished, with **All / Live / Finished / Needs you** tabs, search, and
  grouping by project or date. A live run's page shows its state and current
  step, ticking time, cost and changed files, and a **Live view** of the running
  step inside its workflow graph; **Diff** shows the worktree's changes so far,
  and **Logs** streams every step with search (filters by source, level, step
  and cycle at Expert). The top bar's **Activity** pill counts what needs you
  and what is running; Settings › General › **Alerts** adds desktop
  notifications and a tab badge when a run waits for you. **Archived runs**
  (Advanced) lists deleted runs and restores them.
- **One-click PRs** — a finished run's page offers **Create PR**:
  *Create pull request* shows the files and +/− lines, lets you write the description or
  **Generate with AI**, open it as a draft and watch it, then pushes the branch
  and opens the PR with the GitHub CLI (`gh`), or on
  [Azure DevOps](docs/azure-devops.md) with a personal access token. A run
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

![Runs in Simple mode: three runs waiting on clarify questions under Needs you, the rest grouped by project, and a finished run's summary open — Ready to ship, 21m 32s, $4.82, +36 −0 across 4 files](docs/screenshots/running.png)

![The Create pull request dialog for the finished run CSV export for contacts: 4 files, +36 −0, its worca-cc/ branch into main, Push branch to and Open PR in (GitHub) pickers set to origin — nimbus/nimbus-crm, a PR description previewed as What and How to test, Open as draft unticked and Watch PR ticked, Try it first with the Run, Test and Cursor buttons, and Cancel beside Create pull request](docs/screenshots/ship-it.png)

### Agents

- **32 built-in agents, all data** — each is a markdown prompt plus a
  metadata sidecar declaring its typed input/output ports, so a new agent
  drops in without engine changes; your own and plugin agents load the same
  way.
  - *Coding* — Clarify, Plan, Refine Plan, Plan Review, Decompose (splits a
    plan into vertical-slice tasks, one implementer each), Implementation,
    Review Implementation, Manual Tests Checklist, and Manual web UI testing
    (runs that checklist in a browser via Playwright).
  - *Workspaces* — Workspace Review (one review per changed project, one
    cross-project verdict) and the workspace scan's Workspace Survey,
    Workspace Usage and Workspace Synthesis, which only the scan can place.
  - *Presentations* — Deck Clarify, Narrative Spine, Visual System, Deck
    Builder, Deck Audit, Deck Review, Deck Outputs, Deck Export.
  - *Architecture* — C4: setup (the which-file, which-bands form) and C4:
    architect (reads the code, writes the LikeC4 model).
  - *Video* — Promo: setup, explore, script, voice, capture, mascot, scenes
    and review.
  - *Memory defragment* — restructures one memory scope.
- **Agents in the Library** — **Workflows › Library › Agents** lists every agent
  with its ports; built-ins are read-only, so **Duplicate** one to get an
  editable copy ([docs/ui-levels.md](docs/ui-levels.md#workflows)).
- **AI-assisted agent creation** — **+ New agent** in the Library (or **New
  agent…** in the canvas **+** menu): give a name, a purpose and a description and Worca drafts
  both the system prompt and the metadata, or paste your own prompt and let it
  infer just the wiring; edit the draft, **Regenerate**, **Save agent**.
- **Ask forms** — an agent that needs a human can declare the form its
  question is asked with: JSON in its sidecar, drawn by Worca from a fixed
  widget catalog (galleries, rankings, per-item review lists, previews of the
  files it just produced) and validated by the server on the way back. The CLI
  and chat get a text projection (chat answers with `/answer field=value`); a
  finished run's page replays the form read-only with its answer. Review
  Implementation, Narrative Spine, Visual System and Deck Outputs ask this way;
  plugins can ship forms too.
- **Per-agent model & effort** — pick a model and reasoning effort (medium,
  high, xhigh, max) per agent node: in the toolbar over a selected agent card
  in Workflows, or in New pipeline › **Advanced** › **Agents** for one project,
  kept for its later runs (**Save as workflow defaults** moves them into the
  workflow). A project pick beats a team-policy default, which beats the
  workflow's own; `--model` only fills nodes with none. Fan-out agents also
  take a sub-agent model.

### Scripts

- **Cards that run your own program** — a script card keeps the whole outside of
  an agent card (typed ports, verdict routing, loops) and replaces the inside
  with your own Node.js, Shell or Python program (Python when the host has an
  interpreter), so a test gate or a transform costs no model call. See
  [docs/scripts.md](docs/scripts.md).
- **Scripts in the Library** — **Workflows › Library › Scripts** lists every
  built-in, own and plugin script with its runtime and ports. **+ New script**
  picks a runtime, then reads the ports and params from the code as you type;
  **Duplicate** copies any script into your own folder; **Delete** refuses while
  a saved workflow still places it. Built-in and plugin scripts open read-only.
- **Test bench** — under the editor, runs one script by itself, even an unsaved
  draft, with hand-filled params and inputs through the very same runner a
  pipeline run uses. **Save as case** keeps the setup with an optional
  expectation (verdict, fired ports, summary text); **Run all** re-runs every
  case.
- **Shipped scripts** — Shell, JavaScript and Python cards, Git diff, and the
  steps behind the presentation, architecture and workspace-map workflows come
  built in.
  Plugins can ship scripts and test cases of their own.

![The Workflows view with the Library on its Scripts tab: the built-in scripts in coding, presentation, architecture, video and general folders (Git diff, Deck PDF, Deck audio, Deck bundle, C4 discover, check and render, Promo voices, narrate and render, Shell and JavaScript), each with a runtime chip and its port line, under the All, Built-in and Yours chips, beside an empty canvas holding Task and End](docs/screenshots/scripts.png)

### Workflows

- **A full-screen editor** — **Build › Workflows** (every interface mode) is a
  canvas of frosted cards: drag a card from the Library, or add one with the
  black **+**, and wire its typed ports (`md`, `json`, `void`) with smooth
  wires coloured by type. Each card declares what it consumes and produces, a
  wire only connects compatible ports, and **Save** stays off until the graph
  is valid. A blocking output wired back to an earlier card becomes a loop
  (drawn amber, swooping under the cards with a **≤N** pill): a reviewer keeps
  sending work back until it passes or the loop hits its cycle cap — 3 by
  default, set per loop wire in its toolbar. Flow cards — **Task** (the run's
  request), **End** (the result), **AND**, **OR**, **Combine** — express joins,
  choices and merges without any code. A selected card's toolbar sets its
  model, effort and await-all; **More** holds every other setting. The top
  bar keeps only Back, **Workflows ▾** (New canvas, Open…, Import…, Export…),
  the name, the Library toggle and **Save**; **Auto-layout** and the zoom menu
  sit bottom right. See [`docs/ui-levels.md`](docs/ui-levels.md#workflows).
- **The Library** — the card beside the canvas switches between **Agents**,
  **Scripts** and **Workflows**. Every agent and script action lives there (view,
  edit, create, duplicate, delete, the script test bench); their editors open in
  a sheet inside the view. The old `#composer`, `#agents`, `#scripts` and
  `#agent-create` addresses land in the view.
- **The composer chat** — the pill beside **+** grows into a chat on Chat's
  engine that only works on the open canvas: it adds, removes and rewires
  agent and script cards and sets model, effort, max cycles and await-all (each
  change lands at once with an inline **Undo**), builds whole workflows
  (**Apply to canvas** opens one as a new unsaved workflow), and drafts new
  agents (metadata and system prompt) and scripts (code, interface and test
  cases, which it can test) that you **Save** from their card. It never runs
  anything: save the workflow, then start a run from **New run**. **New chat**
  starts over.
- **From Chat too** — the main chat drafts agents and scripts and proposes whole workflows (scripts, gates and
  new agents included) with the same cards, without a canvas: **Save** a draft or open it in its editor, and **Save as
  workflow**, **Open in Workflows** (a new unsaved workflow on the canvas) or **Decline** a proposed graph.
- **Saved pipelines** — the Library's **Workflows** tab lists them with domain
  chips; click a row to open it. The built-in **Default** and **Memory
  defragment** open read-only (Save makes a copy). Saved pipelines are offered
  in New pipeline's **Workflow** picker, and so in schedules.
- **Share a pipeline** — **Export…** on a Library row (or in **Workflows ▾**)
  offers three formats. A **JSON file** carries the graph only; the recipient
  picks it up with **Workflows ▾ › Import…** (a taken name gets a ` (2)` suffix; nothing is ever overwritten,
  and any script commands are shown for approval first). In Expert, a
  **Claude Code skill** writes a `SKILL.md` plus the agents it dispatches
  under `.claude/`, so the pipeline runs inside Claude Code without Worca
  (not yet for pipelines with script cards). A **Worca plugin** folder
  bundles the pipeline with your own agents and scripts it uses and the
  skills they need — built-in agents are never copied — so the recipient runs
  `worca plugin link <folder>` and picks up edits with
  `worca plugin reimport <name>` — or pick **Marketplace** to open a pull
  request that adds it to a registered team marketplace (one branch
  `worca/plugin/<name>`, validated with the marketplace's own discovery; from
  a fork when you cannot push). The CLI does the same with
  `worca workflow list`, `worca workflow export <id> --format json|claude|plugin`
  and `worca workflow import <file>`.

![The Workflows view with the built-in Default pipeline on the full-screen canvas — Task, Clarify, Plan, Refine Plan, Implementation, Review Implementation and End wired port to port, amber loop wires swooping back under the reviewers with ≤3 pills — beside the Library open on its Workflows tab, its architecture, coding, presentation, video and shared folders with coding opened on Default, with the black + and the composer chat pill at the bottom and Auto-layout and the zoom menu bottom right](docs/screenshots/composer.png)

### Presentations

- **From a brief to a slide deck** — the built-in **Presentation** workflow
  turns a request into a deck: pick it in New pipeline's **Workflow** picker
  (Advanced; Simple lists only Auto and Default), have Chat propose one,
  or run `worca --workflow wf_presentation --prompt "…"`. Deck Clarify asks
  what shapes the talk (live or read alone, audience, duration, the ask,
  sources, brand); Narrative Spine writes one hallway sentence, a 3–5 section
  spine and a takeaway title per slide; Visual System fixes grounds, type
  scale, compositions and the accent, with rendered preview sheets. You approve
  the spine and the system on ask forms or send changes back, and Deck Outputs
  asks what to deliver (PDF + standalone HTML, PDF only, standalone HTML only,
  or the deck files only) and whether to add narration audio.
- **Built, measured, reviewed** — Deck Builder writes a 1920×1080 HTML deck on
  the vendored OpenDeck kit, one section per slide. Deck Audit renders it
  headless, screenshots every slide and reports mechanical facts (boxes
  escaping the slide, clipped or overlapping text, contrast, text size, words
  per slide); once that is clean, Deck Review judges the rendered slides
  (focal points, takeaway titles, one hero moment). Findings go back to the
  builder, up to 3 cycles each.
- **Files you can send** — after a clean review, script cards print `deck.pdf`
  with headless Chrome (page count checked against the slide count),
  optionally record a per-slide ElevenLabs narration from the speaker notes
  (the API key is used for that run only, never written to disk), and inline
  everything into one self-contained `deck.standalone.html`; Deck Export then
  checks the result against what the request asked for. Their findings loop
  back to the builder too, up to 2 cycles. The files live in the run's folder,
  not your repository — open them on the run's **Artifacts** tab (Advanced).
  The audit and the PDF need Chrome, Chromium or Edge; the script cards need
  Python 3.8+. The narrated deck linked from
  [`docs/why-worca.md`](docs/why-worca.md) runs on the same kit.

### Architecture (C4)

- **A model of your code, kept by your code** — the built-in **Architecture
  (C4)** workflow (`worca --workflow wf_architecture_c4 --prompt "…"`, on a
  project or a workspace) finds the project's LikeC4 files, asks on one card
  which to update — or where to create one and how to group the deployment
  sheet into bands, each with prose criteria for what belongs in it — and which
  images to export. The architect reads the code and writes the model; a check
  card parses it with the viewer's own parser and sends blocking problems back,
  up to 2 cycles.
- **Drawn the same everywhere** — open the `.c4` from a run's **Artifacts** tab
  and it draws in Worca's viewer, with a view picker, an info rail, hover and
  selection highlighting, a JPEG button and **Full screen**. The render card
  writes SVG, JPEG or PNG of every view with the same renderer (JPEG and PNG
  need Chrome, Chromium or Edge; in a container, the `-full` image). Worca's own model is
  [`docs/architecture/architecture.c4`](docs/architecture/architecture.c4);
  the design is [`docs/architecture-c4.md`](docs/architecture-c4.md).

### Promo video

- **A product film from your real UI** — the built-in **Promo video** workflow
  (`worca --workflow wf_promo_video --prompt "…"`) explores the project, writes a
  script you approve, captures the product's real screens in a sandboxed copy of
  the app, animates them with an optional mascot crew, reviews the film frame by
  frame and renders a 1080p60 MP4 with captions and YouTube metadata. A setup
  form asks for tone, length, pace, mascots and audio: narrated with ElevenLabs
  (pick a voice from playable previews; the key is never stored) or silent.
  Capture and render need Chrome or Edge and ffmpeg on the host; a run without
  them is refused up front.

### Guardrails

- **Named policy sets, picked per run** — the **Guardrails** picker under
  **New pipeline › Advanced** offers the built-in **Permissive / Normal /
  Strict** tiers plus your own sets; Permissive, the default, adds no rules.
  Normal protects credential files (`.env*`, keys, cert stores, container
  secrets, Worca's own DB and settings) and blocks publication commands
  (`git push`, `npm`/`yarn`/`pnpm publish`); Strict adds an environment scrub on agent spawn, denies
  network-egress tools (including git clone/fetch/pull, DNS and download
  CLIs), `gh`, `docker push`, cloud CLIs and
  `WebFetch`/`WebSearch`, and protects home-dir credential stores. A team
  policy can preset the picker and warn when a run's set ranks below its
  minimum tier.
- **Managed in Settings › Guardrails** — the tab (Advanced) lists every set
  with its details; **Create guardrails** (Expert) starts from any set or blank
  and edits five fields: honor project settings, environment scrub,
  environment allowlist, protected paths and deny rules. Built-ins are
  read-only; editing a set of your own applies to every later run that picks
  it.
- **Enforced via Claude Code permissions** — a set compiles to
  `permissions.deny` rules on every pipeline agent spawn, one set for every
  member of a workspace run; repo settings can't undo them. No preset denies
  MCP registry tools, but a deny rule you write on a server reaches every copy
  of it. See [`docs/guardrails.md`](docs/guardrails.md) for the full model and
  its honest limitations.

### MCP servers & credential broker

- **Worca's own MCP registry** — servers installed for Worca only, never written into your
  Claude Code config, that pipeline agents and Chat can call. The **Connectors**
  page (Advanced) has three views: **Servers**, the catalog (servers shipped by plugins, added by hand
  with **Add MCP server** as `stdio`, `http` or `sse`, or required by a team policy), and
  **Sets**, where each server gets its values and secrets, so one server can sit in two sets
  with different credentials, and **Skills**, the skill catalog ([Skills](docs/skills.md)): skills that
  plugins ship or that you import, added to sets like servers. The built-in marketplace ships MCP servers as plugins (see
  [Plugins & chat](#plugins--chat)).
- **Sets per project, choices per run** — Chat always uses the built-in **General** set;
  a project picks its sets on its **Sets** tab (**Include General in runs** is on by default),
  New pipeline › Advanced › **Sets** switches servers and skills off for one run, and the Ask
  composer's **Sets · N** button picks them per chat. **Test** starts a server exactly as a run
  would and lists its tools.
- **Secrets out of config files** — values live only in `~/.worca-cc/mcp/secrets.json`
  (mode 0600) and reach a server as spawn environment; the run's MCP config holds
  `${MCPSECRET_…}` references, and a stdio server starts with a short list of variables plus
  what its definition declares. The agents of a run that uses a set can still read its secrets;
  [MCP servers](docs/mcp-servers.md) lists what else can.
- **Credential broker for container and hosted installs** — model keys (Anthropic, OpenAI,
  OpenRouter, Copilot) live only in a separate broker container. Each `claude` process gets a
  short-lived `wbt_` token that works only on the broker's private port and is revoked when the
  process exits; the broker adds the real key on the way to the provider its slot is pinned to.
  With the broker on, Worca refuses to start while any model credential is within agents'
  reach. In multi mode each teammate saves their own keys to the broker's encrypted vault
  (Settings › General › **My model credentials** › **Manage keys**), and **Statistics** shows
  spend **By person**. `worca broker serve|secrets|revoke --person <email>`; see
  [Credential broker](docs/credential-broker.md).

### Workspaces

- **Multi-project workspaces** — group 2–40 related projects — Git repositories or Folder
  projects — under **Workspaces** (Advanced level): **Create workspace**, pick the projects —
  or bring repos straight in with **Add…** or a pasted list (a repo, a folder of repos, a VS Code
  `.code-workspace` file; a ticked repo that is not a project yet becomes one) — **Scan
  interconnections**; the workspace is saved when that scan ends. **Add projects** / **Remove** on
  its Overview tab re-scan the new set on the workspace's saved scan model — view or change it
  with the header **Scan model** control (a re-scan with no usable pick asks you to choose one
  first).
- **A map built from code, with evidence** — the scan is itself a pipeline run that never
  changes a member. Code detectors find REST, gRPC and GraphQL APIs, message queues, build
  dependencies, shared databases and service calls and do the matching; agents fill what
  code cannot see and confirm uses. Every scanned edge carries file:line evidence and a
  confidence (exact, verified, heuristic, inferred), every member a coverage level.
- **Review it on the Map tab** — the workspace's **Map** tab draws the graph and lists
  every edge with its evidence; filter by project, kind, confidence or state, **Confirm** or
  **Reject** an edge, and **Add edge** for one the scan missed. Reviews survive **Re-scan**,
  and the description rendered from the map reaches every agent of a workspace run.
- **Runs across all members** — in **New pipeline** set **Target** to **Workspace**: one
  plan tags each task with the projects it touches, implementers edit only those, every Git
  member gets its own branch and worktree, every Folder member its own copy that you apply to
  its folder (or discard) on its own, and **Workspace Review** reviews each changed
  member and merges the findings into one verdict per review cycle. See
  [`docs/workspace-map.md`](docs/workspace-map.md).

![The Nimbus workspace's Map tab: coverage chips for nimbus-crm, nimbus-web and nimbus-jobs, a graph of REST API, message/queue and shared DB edges, and the Edges table with confidence badges, file:line evidence and Confirm/Reject buttons above the Add edge form](docs/screenshots/workspace-map.png)

### Actions

- **Try the result before you ship it** — **Check out** on a finished run's
  **Actions** tab puts its branch in a worktree of its own and runs the
  project's setup once; then the project's own commands start with one click:
  a dev server with an automatic port, a ready check and an Open link, the
  tests, a workspace's whole stack, each with a live log. Built-in buttons open
  the checkout in your editor, terminal or file manager, **Copy command** gives
  the git lines for your own clone, and **Discard** saves uncommitted changes as
  a patch first.
- **Configure once** — commands live on the project's **Actions** tab, stacks
  on the workspace's; Settings › Runs › **Actions** sets the keep policy, port
  range, editor and terminal. All Actions tabs and that card are Advanced
  level; the sidebar's **Running actions** rows show at every level while a
  service runs, each with **Stop** (on the collapsed rail, one tile opens them).
- **People start commands, agents don't** — every start goes by action id from
  stored config; Chat can read and propose actions but never runs one; a
  hosted Worca runs nothing unless `WORCA_ACTIONS_REMOTE=1`. See
  [`docs/actions.md`](docs/actions.md).
- **A terminal for runs and projects** — a pane on every page (Ctrl+`) with a shell in the run's or the project's folder, run by the Worca server; each command is recorded with output, exit code, duration and who ran it. A hosted Worca runs none unless WORCA_TERMINAL_REMOTE=1. See [docs/terminal.md](docs/terminal.md).

![A finished nimbus-crm run's Actions tab: the checked-out branch and folder, the Run, Test, Cursor, Terminal, Finder, Copy command and Discard buttons, and the log of an npm test that passed](docs/screenshots/actions.png)

### Plugins & chat

- **Plugin system with marketplaces** — a plugin is a git repo or folder with a
  `worca-cc-plugin.json`. It can contribute task sources (e.g. GitHub Issues,
  Azure Boards),
  agents (with their ask forms), scripts, skills, workflow templates, models,
  chat channels, and MCP servers for the [registry](docs/mcp-servers.md).
  Install from the **Marketplace** page (Advanced) or `worca plugin install`;
  **Add marketplace** (a GitHub URL, `owner/repo` or a local path) is Expert.
  On a machine without git, marketplaces and installs work for GitHub
  repositories over HTTPS, a local plugin folder is linked, and other sources
  say `Needs git`.
  Installing from the UI is an explicit consent ceremony pinned to the commit
  you saw: what's installed, which ask forms an agent can show and which file
  types they may display, which secrets each part requests, where models
  route, which setup commands run. **Update** previews the commits and a
  diffstat, and flags new secrets, changed setup and changed model env, before
  you accept (`worca plugin update --diff` adds the full diff). Package your
  own with **Export…** on a saved workflow or **Share as plugin…** on the
  Models page; see the [authoring guide](.claude/skills/creating-worca-cc-plugins/SKILL.md).
- **Built-in marketplace** — **Worca CC Official**, Worca's GitHub repository on
  its `dev` branch, is registered on every install (nothing is installed until
  you pick it): the GitHub Issues and Azure Boards task sources, the four chat
  channels below, and MCP plugins for Atlassian, Cloudflare, Firebase, Notion
  and Railway. It works without git too (it lives on GitHub). Set
  `WORCA_BUILTIN_MARKETPLACE` to another repo URL or a local checkout to use
  that instead (followed at its HEAD; only committed files count).
- **Tasks from your tracker** — an installed task source adds its button to New
  pipeline › **Task source** (Advanced): search issues or work items, or paste a
  GitHub issue URL or `owner/repo#123`, and the ticket becomes the run's task.
  Each source can close its issue or work item when the run succeeds; Ask
  Worca can find a ticket and propose a run for it. See
  [GitHub Issues](plugins/github-source/README.md) and
  [Azure Boards](docs/azure-devops.md).
- **Drive runs from chat** — two-way **Telegram**, **Slack**, **Discord** and
  **Microsoft Teams** channels (Teams needs a public HTTPS endpoint through a
  tunnel; the others dial out). Pick the events that notify — questions and
  approvals, finishes, failures, pauses (cost limits included), Away hours — in
  **Settings › Runs › Chat notifications** (Advanced), and hit **Test**. Answer
  back with commands: `/answer` questions and forms, `/approve` or `/retry` at a
  gate, `/direct` a live run, `/pause`, `/stop`, `/resume`, `/status`, `/cost`,
  `/use <name>`, `/mute 2h`; `/help` lists them all. Commands are
  deny-by-default: only chats on the channel's allowlist may send them. Setup:
  [Telegram](plugins/telegram-chat/README.md),
  [Slack](plugins/slack-chat/README.md),
  [Discord](plugins/discord-chat/README.md),
  [Teams](plugins/teams-chat/README.md).

### Chat

- **A chat that is the home page** — **Chat** (the first sidebar row, and the worca logo), or the
  last row of the top bar's search (⌘K / Ctrl K), opens a chat that
  answers from Worca's own records: runs, their diffs, progress and clarify answers, workflows
  and agents, schedules, team metrics and policy, models, Actions, and tasks from installed
  trackers. It reads code in read-only, detached worktrees with an allowlisted `git` (`log`,
  `diff`, `blame`, `grep`…), takes attached text files, images and PDFs, and has no file-editing
  tools of its own (in agent mode, below, it changes files only through commands you ask for). Settings › **Chat** (Advanced) sets the turn limit, a per-turn cost cap, whether it may
  change and test-run your scripts, and opt-in web access with an allowed-domain list; chat spend counts toward the total
  budget, and a team policy can preset the limits or narrow web access, never widen it.
- **One scope per chat** — the composer's scope pill sets **No project**, a project or a workspace, at every interface level. Changes act only there. When a No-project message is clearly about one of your projects, Ask asks with a card — **Switch to <name>** or **Continue without project** — and the same message continues after you choose; it never switches on its own. A project you create or add from a chat card, the chat home's **Add project** tile or the scope menu's **Add
  project…** becomes that chat's scope.
- **Changes are cards you confirm** — work becomes a **run card** (project, workflow, guardrails,
  branches and brief, all editable) that starts nothing until you click **Start run**, or
  **Schedule…** to run it later ([`docs/scheduled-runs.md`](docs/scheduled-runs.md#chat)).
  Ask for "auto", or for work no saved workflow fits, and it drafts a **workflow card** you tune
  and **Save as workflow** — or, when the work needs a script, a gate or a new agent, a graph card with **draft
  cards** for the new agents and scripts. Model and provider, workspace, Actions, team-metrics, team-policy and
  Away mode changes, creating, adding or cloning a project and reading a new website are cards too: nothing changes
  until you apply one. A started run becomes a live card — status, elapsed, cost, its agents and
  its workflow graph, with **Open run** — where you **Pause**, **Resume** or **Stop** the run and
  answer its questions; once it ends, the card shows the result, the top changed files, its
  artifacts and **Create pull request**. While the chat follows a live run, the composer's **→**
  chip (named after the run) sends it a direction instead of a message. The chat still posts when
  the run waits for an answer, pauses, fails or finishes. A pull request opened from a chat card keeps reporting
  there: the card shows its Watch PR status, and each fix run that Watch PR or Resolve starts on it appears in the
  chat as a live run card, with what started it and how it ended.
- **Agent mode with a shared terminal** — Chat can run commands (tests,
  builds, linters, git) in a run's or a project's folder, in up to 3 terminals
  per chat that appear as tabs in the terminal pane, where you can type too.
  Each command shows in the chat as a card with **Stop** and **Output**; it
  changes files only through commands, and only when you ask. Shells get a
  cleaned environment and a command check, which is not a sandbox; a hosted
  Worca allows none unless `WORCA_TERMINAL_REMOTE=1`. See
  [`docs/terminal.md`](docs/terminal.md).
- **Pinpoint** — select text in a chat answer, a markdown artifact or the Diff
  tab to **Explain** it, ask for **Alternatives**, leave a note or comment, or
  send it to the chat; diff comments can become a fix run.
- **Per-agent models for one run** — on a run card for a saved workflow, Chat can pick a
  model and effort for each agent step from the catalog (judgement steps on the top price tier,
  mechanical ones on the cheapest capable model, Anthropic first, then OpenAI; a premium-tier
  model such as Fable 5.1 only when you name it). Each pick sits
  beside the project's own setting with its reason on hover; change or reset any of them before
  **Start run**. The picks apply to that run only — turn on **Save as project defaults** to keep
  them ([`docs/models.md`](docs/models.md#per-agent-models-for-one-run)).
- **Files in the chat** — when Ask makes or finds a file you should see (a screenshot it took with
  `run_command`, a chart, a report, a run artifact), it puts it into the reply as a files card: images
  inline, other files as rows, and a click opens a viewer with zoom, next/prev and Download. **Show in
  folder** opens the folder the file came from. Files are copied into the chat; credential files and anything outside the chat's folders are refused
  ([`docs/show-files.md`](docs/show-files.md)).
- **Memory** — say "remember …" or state a lasting preference, and Ask saves it to Worca's
  memory: global for how you work, per project for facts about one repository. Pipeline agents
  load the same memory; view, edit, delete or restore it on Settings › **Memory** and on a
  project's **Memory** tab.
- **Voice** — the composer's mic dictates once, lets you talk and read the replies, or holds a
  hands-free conversation that reads replies aloud (hold the mic to start it). Whisper and
  Kokoro run in the browser, so audio never leaves the computer, or point either side at your
  own speech server; it needs `https://` or `localhost`. It listens in ~99 languages and the
  built-in voice speaks English. See [`docs/speech.md`](docs/speech.md) and
  [`docs/speech-languages.md`](docs/speech-languages.md).

![The Chat page with its chat list: a finished "Paginate the search endpoint" run card for nimbus-crm with elapsed time, cost, its workflow graph and the result — Ready to ship, +29 −2 across 4 files, the top changed files listed — then a follow-up answer about the docs repository](docs/screenshots/ask-worca.png)

![Chat agent mode: the chat "Run the CRM tests" with a Command card for npm test in nimbus-crm · main, exit 0, its 13-line output open showing one passing test, and the answer below it, beside the Terminal pane on the right with the chat's tab and the same bash session's npm test output](docs/screenshots/ask-terminal.png)

### Browser extension

- **Chat next to the page you are reading** — a sidebar for Chrome, Edge and Firefox chats with
  your local Worca. Each message carries the page's URL, title and your selection, the page text if
  you switch it on, and any passage you quote. Pinpoint works on web pages too: select text, then
  Explain it, Discuss it or send it to the chat. You approve the pairing in Worca with a matching
  code, and Settings › General › **Browser extension** lists and revokes paired browsers. See
  [`docs/browser-extension.md`](docs/browser-extension.md).
- **Ships with Worca** — the built extension is in the npm package: open Settings › General › Browser extension, or run `worca extension`, for the folder to load; each GitHub release also has Chrome, Edge and Firefox zips (Firefox unsigned for now).

### Away mode

- **Runs keep going while you're away** — during your away hours, or after you turn on **Away**
  in the account menu (the corner at the foot of the sidebar), Worca answers what a run would wait on: clarifying
  questions, mid-step questions, input forms, review-loop gates, proposed workflows and failed-step
  retries. It trusts the agent's recommendation when the agent is sure enough. Otherwise a
  read-only review (it can only read files), on the run's engine, scores each option against your
  Worca memory, how easily it can be undone, scope, the codebase's conventions and cost. An answer it is unsure of is
  still given, but flagged *please check*.
- **You choose when and where** — **Settings › Runs › Away mode** (Advanced level) sets the away
  hours and time zone, *Only runs I marked* or *All runs*, the method, the model and effort that
  weigh the options, the limits, and *Always wait for me on…* for kinds Worca must never answer.
  A project's **Away mode** tab overrides any of these for that project. You mark a run with *Mark
  this run: worca may answer for me* on New pipeline, or with `--night` on the CLI. A marked run is also
  answered by day once a question has waited 30 minutes. On the run page, *Away mode on this run*
  (*As set up*, *Answer for me now*, *Never on this run*) overrides one run.
- **Bounded on purpose** — while critical or major issues remain, a review loop gets at most one
  extra fix round (configurable), then continues with a flag. A failed step is retried up to 3
  times, then the run pauses. A run pauses after 20 answers by default. An optional spend cap,
  counted across all projects from the start of the away stretch, pauses runs that reach it. Your
  own cost caps always hold; Worca passes the team's soft cap only if you allow it.
- **Every answer on record** — the run page lists *Answered for you* (question, answer, reason
  and the deciding model), one group per ask, with the answers to check marked and listed first.
  A note above it reads like "5 answers while you were away — 2 to check". A
  short notice says when away hours start and end, and a violet dot sits on your avatar while you
  are away; turning **Away** off in the account menu ends it.

### Scheduled runs

- **Run it later** — start a pipeline once or on a repeat ("every weekday at
  02:00", "every 15 minutes from 09:00 to 18:00") from New pipeline (*Start run* › *Schedule…*), an Ask card, the CLI
  (`--at`, `--every`, `--cron`) or the API (`POST /api/run` with `scheduledFor`
  or `repeat`). A series has overlap and failure-streak policies — by default it
  pauses itself after 3 failures in a row; **Settings › Runs › Scheduled runs**
  holds the defaults. See [docs/scheduled-runs.md](docs/scheduled-runs.md).
- **Schedules view** — sidebar **Schedules** (Advanced; shown at every level
  while anything is scheduled) with three tabs: **Activity**, a feed of every
  miss, failure, late start, skip and self-pause, whose problems raise an amber
  badge; **Once** (Run now, Change time, Cancel); **Repeating** (Run now, Skip
  next, Edit, a pause switch, Delete). Upcoming and missed runs also appear in
  **Runs**; `worca schedule` (`list`, `show`, `run-now`, `move`, `cancel`,
  `skip`, `pause`, `resume`, `log`) does the same from a terminal.
- **When runs start** — there is no daemon: a run starts while `worca ui` (or a
  `worca … --at … --wait` terminal) is up and the machine is awake. A slot missed
  by less than the grace window (6 h by default) starts late; past it, the run
  is marked missed and waits for *Run now*.
- **Run trains** — a run can start after another run instead of at a time
  (`--after <id>`, or **Run after** on a run page), by default only when that
  run ends `done` (`--after-any` also accepts a failed or stopped one), and on
  its feature branch with `--source-from-previous` — refactor → tests → docs,
  each on the branch the previous one left.
- **Chat schedules too** — "run the dependency upgrade every weekday at
  2am" becomes a run card whose main button is *Schedule*. It lists, pauses,
  resumes and skips schedules on request; moving, editing, cancelling or
  deleting one is a card you confirm.

![Schedules view on the Repeating tab: three active repeating schedules (a monthly flaky-test sweep, a weekly broken-link sweep and a nightly dependency audit) for demo projects, each with its rule, project, next start time, pause switch and Run now, Skip next, Edit and Delete buttons](docs/screenshots/schedules.png)

### Costs & budgets

- **Cost on every run** — the run page shows each run's estimated cost as it goes; Expert mode
  adds per-step cost on the workflow graph. Figures are Claude Code's client-side estimates, not
  billing.
- **Statistics** (Advanced) — pick Today, This week, This month, Last month, All time or a Custom
  range for Spent, Saved
  (estimated human hours × your developer rate, minus spend), Pipeline spend, Chat, Time
  worked, Pipelines finished and PRs merged, plus *Spend per* and *Runs per* charts by hour, day
  or month (runs split into finished, stopped and failed). With a total limit, a ring around your
  avatar in the sidebar fills toward it (amber from 80%, red once new runs are blocked); the account
  menu's spend card has the figures. Filter or split spend by person (or by tag, see
  [Labs features](#labs-features)) and export the split as CSV; see
  [`docs/statistics.md`](docs/statistics.md).
- **Hard limits** — set in Settings › Runs › Budget & cost limits, or with `worca config`. A
  per-pipeline cost limit pauses a runaway run before its next step; *Continue without cap (this
  pipeline)* or `worca resume <id> --ignore-cost-cap` lifts it for that run. A total cost limit
  counts pipeline and Chat spend over a weekly (from Monday) or monthly (from the 1st)
  window; once reached it pauses running pipelines at their next step and blocks new runs,
  resumes and Ask turns until the window resets or you raise the limit. Team caps live in
  [Team policy](docs/team-policy.md).

![Statistics on a range with several days of data — Spent, Saved, Pipeline spend, Chat, Time worked, Pipelines finished and PRs merged tiles above the Spend per day and Runs per day charts, with the Everyone and grouping filters](docs/screenshots/stats.png)

### Team metrics

- **A shared, git-backed record** — every finished run (done, failed or stopped) is pushed as one
  file to an orphan `worca-metrics` branch on the project's own `origin`; there is no separate
  metrics server. Records carry the git user name (or none, a team choice made once at enable
  time), never an email address.
- **Opt-in per project, with delegation** — **Set up team metrics…** on a project's **Team** tab
  records on the repository itself (joining the branch if a teammate already made it), or
  delegates to another project that already records. A workspace records through one **metrics
  home**; **Route all to metrics home** delegates every member without a branch of its own.
  **Include my runs** stops only your machine from recording.
- **A Team metrics page** — sidebar **Team metrics** (Expert), for one project or workspace and a
  range from *This month* to *All time* or *Custom*: Spend, Runs, Cost per run, Duration,
  Autonomy and Review cycles tiles (plus Saved when runs carry human-hour estimates), spend and
  runs per week, breakdowns by workflow, ticket, actor and model mix, the runs table and
  **Export CSV**.
- **A Timeline for planners** — work items as bars on a calendar (click the header to drill from
  month to week to day), grouped by work item or person, with Shipped (the PR merged), In review,
  Needs attention, Median lead time and Agent spend tiles. Merge dates come from an optional
  GitHub Action or the GitHub CLI; without either the page still works and counts completed runs
  instead. With the Action, pull requests made outside Worca show too, so the calendar covers
  the whole team's delivery.
- **CLI** — `worca metrics push [--project <path>]` flushes pending run records, e.g. on a
  headless machine; `worca metrics pr-workflow [--project <path>] [--force] [--print]` writes
  that Action to `.github/workflows/worca-metrics-pr-events.yml`. See
  [`docs/team-metrics.md`](docs/team-metrics.md).

![Team metrics page for the nimbus-crm project on the Overview tab, range Last month and synced just now: Spend, Runs, Cost per run, Duration, Autonomy and Review cycles tiles with their change against the previous month, Spend per week grouped by workflow, Runs per week by outcome, and the By workflow and By ticket tables](docs/screenshots/team-metrics.png)

### Team policy

- **Team caps and expectations, shared through git** — a lead publishes a policy to an orphan
  `worca-policy` branch on the project's `origin` (protect it so only maintainers push). Every
  teammate's Worca reads it on start and hourly; `worca policy pull` refreshes a CLI-only
  machine. A project carries its own policy or follows another project's; a workspace uses a
  **policy home**, a member each developer picks on their machine.
- **Soft by design** — each field is a `default` (applies until you set your own) or a `soft`
  expectation: for a cap the tighter of team and local applies, and an off-list model, a missing
  plugin or guardrails below the minimum tier warn and are recorded. Going past a team cap takes
  a confirmation (with a reason when the policy requires one) and is recorded to team metrics;
  unattended (`--yes`) runs warn instead of pausing. Only Chat's web fields bind: a policy
  can switch web access off or narrow its hosts, never widen them.
- **What a policy can set** — per-pipeline and per-period total cost caps (pause or warn on
  breach), an advisory pooled budget, Chat turn and cost limits, a default guardrail set and
  a minimum tier, allowed models and step defaults, marketplaces, required plugins and MCP
  servers, blocked plugins, a default workflow, human-in-the-loop, a minimum Worca version, Away
  mode defaults, and separate values for workspace runs. It can also ship its own guardrail sets
  and models. Required plugins and MCP servers come through a setup checklist and never install
  without your click (an opt-in per-home trust switch may install plugins, never MCP servers).
- **The Team policy page** — Manage › Team policy (Expert) shows the effective policy per project
  or workspace (team value, yours, what applies), the required plugins with Install… / Update…,
  and an editor that publishes in one commit. Turn a policy on from a project's **Team** tab
  (**Set up team policy…**); a workspace's **Team** tab picks its policy home.
- **`worca policy show|pull|init|setup`** — `init --here` creates the branch,
  `init --follow <slug>` follows another project, `setup --install` installs or updates the
  required plugins; continue past a team cap with `--past-team-cap [--reason "…"]` on a run or
  on `worca resume`. See [`docs/team-policy.md`](docs/team-policy.md).

### Models

- **Four engines** — agents run on Claude Code by default, or on OpenAI's
  Codex CLI, GitHub's Copilot CLI or Cursor's CLI agent, all three in **beta**.
  Pick one per run with **Engine** on New pipeline (Advanced) or
  `--engine codex|copilot|cursor`, or set a default on the Models page's
  **Engine & models** card or in a project's settings. Each needs its own CLI
  installed and signed in. The beta engines hold guardrail rules only in part,
  so Normal and Strict need **Allow unguarded**
  (`--allow-unguarded-engine`); Copilot and Cursor report no cost; Chat
  runs on Claude Code or Codex. A model's connection decides which engines can
  run it. See [`docs/models.md`](docs/models.md#codex).
- **Bring your own models** — *Add model* on the **Models** page registers any
  model id (a proxy, a fine-tune, an alternative provider), declares which effort
  levels it supports, and attaches per-model routing env (e.g. `ANTHROPIC_BASE_URL`)
  that is merged into that model's agent spawns. *Share as plugin…* exports your
  models as a plugin scaffold: each env value is committed, omitted, or kept out of
  the repo as a secret each teammate enters once, after installing, under the
  plugin's *Model secrets*.
- **No first-party account needed** — the *Title generation*, *Auto workflow model*
  and *PR description model* cards on the Models page put Worca's own helper calls
  on a model you pick (left empty, a chat titles itself with its own
  model, a `worca --model` run with that model, and other runs with the built-in
  Haiku); endpoint-routed models carry Claude Code's internal
  haiku/sonnet/opus/fable tier keys so nothing falls back to the Anthropic API; and
  *Hide built-in models* drops the built-ins from every picker.
- **GitHub Copilot and OpenAI-compatible endpoints, built in** — Worca's own
  in-process bridge lets the Claude Code CLI run against a Copilot subscription
  (Claude models through Copilot's native Anthropic endpoint, thinking intact; GPT,
  Gemini and the rest translated to chat completions or the Responses API), any
  OpenAI-compatible server (llama.cpp, Ollama, LM Studio, vLLM, OpenRouter) or an
  Anthropic-compatible gateway — no LiteLLM, no second daemon. Sign in or set keys
  on the **Providers** page, then *Import models…* lists what a source serves,
  windows and capabilities included; `worca models list` and
  `worca models import copilot|openai|openrouter` do the same from a terminal.
  Both pages are Expert level. See [`docs/models.md`](docs/models.md).

![New pipeline in Advanced mode for the nimbus-crm project: the Workflow picker on Auto beside the Engine picker set to Codex (Beta), the hint that Codex runs this pipeline including titles and summaries, a typed task to add an Idempotency-Key header to POST /contacts, and the Branches table starting from main, up to date](docs/screenshots/engine-picker.png)

### Storage

- **Nothing in your working tree** — structured state (projects, workflows,
  run steps, Q&A, review verdicts) lives in one SQLite database,
  `~/.worca-cc/worca-cc.db`; plan/review markdown and per-run artifacts live
  in a machine-wide store, `~/.worca-cc/store/<projectKey>/`. Agent memory
  sits beside them in `~/.worca-cc/memory/`.
- **Keyed by repo identity** — the project key is the repo's folder name plus
  a hash of its root (the parent of the shared `.git`), so every git worktree
  of a repo shares one history. A plain folder (a **Folder** project) is keyed
  by its own path.
- **Move it** — `WORCA_HOME=<dir>` (or Settings › General › **Worca root
  folder**, Advanced) puts everything under `<dir>/.worca-cc/`; only the
  global `settings.json` stays in your home folder.
- **Projects folder** — **New** (just a name) and **Clone from URL** put
  projects in `~/.worca-cc/projects/` (it follows `WORCA_HOME` and Settings ›
  **Worca root folder**); New names the folder in lowercase with `_` for
  spaces (**Worca Presentation** → `worca_presentation`), the project keeps
  the name as typed;
  `WORCA_PROJECTS_ROOT` or Settings › **Projects root folder** moves it.
  Existing projects stay where they are.
- **One list for every project** — **Runs** in the sidebar shows live,
  scheduled and finished runs from every project on the machine (see
  [Pipeline](#pipeline)). See [`docs/storage.md`](docs/storage.md).

![Runs page — runs from nimbus-crm, lumen-docs and nimbus-web grouped by project, one scheduled and one stopped, with the finished run Paginate the search endpoint open: Ready to ship, 17m 2s, $3.65, +29 −2 across 4 files](docs/screenshots/history.png)

### Labs features

- **Off until you turn them on** — unfinished features ship behind machine-wide
  flags: **Settings › Labs**, `worca flags on|off <key>`, or
  `WORCA_FLAGS=<key>` at start. See [`docs/feature-flags.md`](docs/feature-flags.md).
- **Shaper** (`shapeFirst`) — Worca shapes a thin or large task first: at most 3
  questions, a plan for the perspectives you pick, rule checks on the plan, and
  your approval before anything is built; a large task can be cut into slices.
  See [`docs/shape-it-first.md`](docs/shape-it-first.md).
- **Run tags** (`runTags`) — `key:value` tags such as `client:acme` on New
  pipeline, run pages and Ask run cards (`--tag` on the CLI), optional
  mandatory tags under Settings › Tags, and spend **By tag** on Statistics and
  Team metrics.
- **Keep awake** (`keepAwake`) — stops the computer sleeping while a run has
  agents working.

### Getting started & UI levels

- **A guided first week** — the first visit to **New pipeline** shows a one-time **Welcome** dialog
  with three doors (add a project, watch a run offline, run a real pipeline) and **Skip**. The
  **Getting started** pill under *New pipeline* in the sidebar, with its `3/9` count, opens a
  checklist of nine steps, from *Connect Claude Code* and *Watch a run end to end* to *Group projects
  into a workspace* and *Set a team policy*. Every tick is derived from what you have really done,
  never stored. Each tile, done ones included, starts a spotlight guide that rings the real control,
  says why, and moves on when you do the real thing; Esc or **Skip** leaves it. **Hide from sidebar**
  drops the pill and **Settings › General › Getting started** brings it back. See
  [`docs/getting-started.md`](docs/getting-started.md).
- **Three interface modes** — **Simple** shows the core loop: New pipeline, Runs, Projects,
  Workflows (agents and scripts included), budget limits and Chat. **Advanced** adds
  Schedules, Statistics and Workspaces, plus branches, guardrails, per-agent models, the diff, pull
  requests, plugins, memory and the live log. **Expert** shows everything: Team metrics, Team
  policy, Models, diagnostics and every per-node tunable. Modes are cumulative, so raising one never removes
  anything.
- **A view preference, not a permission** — **Interface mode** in the account menu (the corner at
  the foot of the sidebar) names the current mode and lists the three. A choice applies at
  once, for every browser that opens this Worca; **Settings › General › Interface mode › Change…**
  opens the same choice as a dialog. A fresh install starts at Simple, one that already has projects or runs at
  Expert. A link to a page above your mode still opens it, under a banner offering *Switch to …*;
  values set in a higher mode keep applying, and a question a run waits on shows in every mode. A
  guide step that needs a higher mode asks first (*Switch to Advanced?*). See
  [`docs/ui-levels.md`](docs/ui-levels.md).

## Install

```bash
npm install -g @worca/app     # puts `worca` on your PATH
```

Requirements:

- **Node.js >= 22.13.0** — the store is the built-in `node:sqlite`; on an older
  Node the CLI says so and exits.
- **git** — pull requests, Check out, Sync, Clone from URL and **Use git** need it
  (on Windows, Git for Windows' `git.exe` on `PATH`). Without git — on macOS,
  without the Xcode Command Line Tools — worca still opens and never runs git:
  it hides the branch, pull-request, Sync and Clone controls, a project run
  works on a copy of its folder (applied back with **Apply to folder**), a
  workspace run works on a copy of each member (each applied back on its own), and
  Workspaces, Marketplace, skill import, Team metrics and Team policy stay:
  GitHub-hosted sources work over HTTPS and other hosts say `Needs git`;
  installing git brings everything back without a restart. `WORCA_GIT=0` hides
  them on purpose, `WORCA_GIT=1` skips the check. The GitHub CLI (`gh`) is
  optional: it opens pull requests and issues.
- **The [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI**
  (`claude`) on your `PATH` and signed in (`claude`, then `/login`; an
  `ANTHROPIC_API_KEY` works too) — for real runs only; mock mode starts no
  `claude` at all. `WORCA_CLAUDE_BIN` points Worca at another binary.
- **Native Windows** — both the [native installer](https://docs.anthropic.com/en/docs/claude-code/setup)
  (`claude.exe`) and `npm install -g @anthropic-ai/claude-code` work: npm puts a
  `claude.cmd` shim on `PATH` that Node cannot spawn, so Worca runs the package's
  native `claude.exe` next to it instead. If that binary is still npm's placeholder
  (the package's `postinstall` didn't run) or there is none, Worca says what to do
  rather than a bare `ENOENT`; `WORCA_CLAUDE_BIN` can always point at a
  `claude.exe` directly.

### In a container

Prefer the agents to run in a disposable Linux box instead of on your machine?
The same Worca ships as an image (`ghcr.io/sinishadjukic/worca`, amd64 and arm64,
plus a `-full` variant) with a Compose file. The agents cannot read your host
credentials or touch files outside the project folders you mount; the box keeps
its own Worca home and Claude login. Needs Docker or Podman with `podman compose`.

```bash
worca container up        # writes ~/.worca-cc/container/, starts the box; UI on http://localhost:4317
worca container login     # log Claude Code in, once
```

`worca container help` lists the rest (`down`, `logs`, `pull`, `shell`,
`run -- <worca args>`, overlays via `--with egress,ssh,teams,clonein`). Without
npm, download `docker/compose.yml`, set `WORCA_PROJECTS` in a `.env` beside it
and `docker compose up -d`. See [`docs/docker.md`](docs/docker.md) for login
options, git credentials, the egress allowlist, clone-in mode and Windows (WSL2).

### Hosted, behind Cloudflare Access

The same image runs as an always-on service: on Railway (or any host), reachable
only through a Cloudflare Tunnel with Cloudflare Access in front, and Worca
verifying the Access token on every request itself. On Railway the agents run as
their own user, cut off from Worca's settings, database and GitHub token. Step by step:
[`docs/deploy-railway.md`](docs/deploy-railway.md); the Cloudflare side and the
security model: [`docs/remote-access.md`](docs/remote-access.md). Upgrades,
configuration and checks of a running deployment:
[Operate your deployment](docs/deploy-railway.md#operate-your-deployment), with
the `tools/railway/worca-railway.mjs` tool and this repository's
`/worca-railway` skill for Claude Code.

## Quick start

### Web UI

```bash
worca ui            # start it (worca --ui does the same)
```

Open the printed URL (default `http://localhost:4317`), add a project
(**Projects › Add project**: **New** by name, any **Folder**, or **Clone from URL**), and
click **New pipeline**: describe the task, pick a workflow and press
**Start run** — turn on **Mock mode** beside it to try a run offline, with no
Claude calls and no cost. At the Advanced [UI level](docs/ui-levels.md) the
form also takes a markdown brief or a task pulled from a plugin source like
GitHub Issues or Azure Boards, the engine, guardrails, and **Schedule…** on the
Start run caret. Answer
clarify questions and loop gates as they come — in the browser or from chat.

The UI is one process per machine. Starting it while it is already up is not
an error — Worca prints the URL and how to restart it, and exits 0 (a port
held by another program is exit 1):

```bash
worca ui status                 # is it running? (exit 0 = yes, 1 = no)
worca ui restart                # stop the running one, start it again
worca ui stop                   # stop it gracefully
worca ui --port 4318 --open     # another port; open the browser when up
worca ui --mock                 # offline mock mode for every run
```

`--port` (or the `PORT` env var) picks the port; `stop`, `restart` and
`status` remember the port of the last started UI (`ui.json` in the Worca
home), so they usually need no flag. See `worca ui help`.

**Appearance.** Settings › General › Appearance picks **System** (follow the
operating system), **Light** or **Dark** — one setting for every browser that
opens this Worca. The web UI relies on CSS `light-dark()` (and `::backdrop`
inheriting the dialog's scheme), so it needs Chrome/Edge 123, Firefox 120 or
Safari 17.5 (or newer).

### CLI

```bash
# run a pipeline against a project (--project defaults to the current directory)
worca --project /path/to/your/project --prompt "Add a /search endpoint"
worca "Add a /search endpoint"     # bare prompt, from inside the project

# use a markdown brief as the prompt (a relative path is read from the project)
worca --project /path/to/your/project --file ./brief.md --title "Search feature"

# let worca pick the workflow for the task (Auto), review the proposal first
worca --project /path/to/your/project --prompt "Add a /search endpoint" --workflow auto

# Auto run with no proposal and no questions (loop-budget, recovery, cost and error pauses still apply; add --yes when nothing can answer them, e.g. in CI)
worca --project /path/to/your/project --prompt "Add a /search endpoint" --workflow auto --no-human

# run the agents on another engine (beta: codex, copilot, cursor)
worca --project /path/to/your/project --prompt "Add a /search endpoint" --engine codex

# register a project: the current folder, or a clone into the projects folder
worca add
worca add --clone https://github.com/you/your-repo.git

# pause with Ctrl+C (twice stops it), continue later (survives restarts)
worca resume <pipelineId>

# see every run from the terminal — no browser, no Worca server needed
worca runs
worca runs --status paused
worca runs <pipelineId>    # one run in detail (any unique prefix; --json for machines)

# read a run's live log from the terminal; -f follows (Ctrl-C detaches, the run continues)
worca logs <pipelineId>
worca logs <pipelineId> -f

# stop a live or paused run, or pause a live one — even one started in another terminal
worca stop <pipelineId>
worca pause <pipelineId>   # resume later with: worca resume <pipelineId>

# run it later: once, or on a repeat (it starts while `worca ui` is up, or this terminal waits with --wait)
worca --project /path/to/your/project --prompt "Upgrade dependencies" --at "tomorrow 02:00"
worca --project /path/to/your/project --prompt "Upgrade dependencies" --at 02:00 --wait --yes
worca --project /path/to/your/project --file ./nightly.md --every "weekdays 02:00"
worca --project /path/to/your/project --file ./poll.md --every "30m 09:00-18:00 weekdays"
worca schedule list

# offline demo — full pipeline, no tokens
worca --project /path/to/your/project --prompt "demo task" --mock --yes

# share a saved pipeline: as JSON, or as a plugin folder bundling your agents, scripts + skills
worca workflow export wf_my-flow --format json --out my-flow.json
worca workflow import my-flow.json
worca workflow export wf_my-flow --format plugin --target ./my-flow-plugin
worca workflow export wf_my-flow --format plugin --marketplace <id> --dry-run

# scripts: list, scaffold and test a script card — no server needed
worca script list
worca script new runTests --runtime shell
worca script test runTests
worca script test shell --param command="npm test" --cwd .
worca plugin init my-plugin
worca plugin new-script tidy --dir ./my-plugin
worca plugin validate ./my-plugin --run-cases

# the browser extension packaged with Worca
worca extension --open          # the packaged browser extension folder

# experimental features
worca flags                     # list them
worca flags on shapeFirst
```

Run `worca --help` for every subcommand — projects (`add`, `list`,
`remove`), `ui`, `resume`, `runs`, `logs`, `stop`, `pause`, `schedule`,
`workflow`, `script`, `plugin`, `marketplace`, `models`, `config`, `flags`,
`metrics`, `policy`, `container`, `broker`, `extension`, `doctor` — and flag;
most have their own `worca <subcommand> help`.

Exit codes, for scripts and CI wrappers: `0` the run finished (or an
interactive run paused and you can resume it); `1` a hard error, a stop, or an
interactive pause an error forced; `2` a usage error; `3` any pause under
`--yes` — the run parked itself (auth, quota, a usage or cost limit, exhausted
retries, a step error) with nobody attached to resume it. Nothing is discarded
on a pause: `worca resume <pipelineId>` picks the run up where it stopped — on
the model it was started with (`--model`, or the one picked in the UI) — and
the cause is printed with the pause block on stdout.

### `/worca` skill (inside Claude Code)

```bash
worca --install /path/to/your/project
```

This copies Worca's agents and the `/worca` skill into the project's
`.claude/` folder (files already there are kept). Then open Claude Code in
that project and run:

```
/worca Add a /search endpoint with pagination
```

The skill starts the same deterministic orchestrator as the CLI;
`/worca --ui` starts the web UI.

## Documentation

- [Why Worca](docs/why-worca.md) — the eight differentiators, and the use cases each one unlocks
- [Getting started](docs/getting-started.md) — the welcome dialog, the Getting started checklist and its spotlight guides
- [UI levels](docs/ui-levels.md) — Simple, Advanced and Expert: what each interface mode shows, and where every element sits
- [Architecture](docs/ARCHITECTURE.md) — the whole stack in one picture, and how Auto picks a run's topology
- [Scripts](docs/scripts.md) — script cards that run your own program instead of an agent, the Library's Scripts tab, testing a script by itself
- [Scheduled runs](docs/scheduled-runs.md) — start a run later, once or on a repeat, from the web UI, the CLI or the API
- [Shaper](docs/shape-it-first.md) — plan a task with Worca before it builds, in Chat, and cut a large one into slices (experimental)
- [Feature flags](docs/feature-flags.md) — the experimental features, and how to turn them on and off
- [Guardrails](docs/guardrails.md) — per-run policy sets (Permissive, Normal, Strict), enforcement, honest limitations
- [Workspace map](docs/workspace-map.md) — how a workspace scan maps relations, reviewing them, measuring a scan
- [Actions](docs/actions.md) — check out a finished run and run the project's commands from Worca
- [Terminal](docs/terminal.md) — the terminal pane, and Chat's agent mode with a shared terminal
- [Models](docs/models.md) — the catalog, providers (GitHub Copilot, OpenAI-compatible), the built-in bridge, and the Codex, Copilot CLI and Cursor engines
- [MCP servers](docs/mcp-servers.md) — Worca's own MCP registry: catalog, sets, copies, secrets, Test
- [Skills](docs/skills.md) — skills in sets: the library, imports, `/<set>:<skill>` names, Team required skills
- [Credential broker](docs/credential-broker.md) — model keys stay out of Worca's container: each `claude` it starts gets a short-lived token, and the broker adds the real key on the way to the provider
- [Voice mode](docs/speech.md) — hands-free Chat: Whisper and Kokoro in the browser, or your own speech servers
- [Voice languages](docs/speech-languages.md) — which languages work today, and the plan for more
- [Azure DevOps](docs/azure-devops.md) — Ship-it, clone, sync, merge tracking and the Boards source on `dev.azure.com`: the token, its scopes, and what does not work yet
- [Statistics](docs/statistics.md) — spend and outcomes by range, person and tag, CSV export and the API
- [Team metrics](docs/team-metrics.md) — git-backed, team-wide records of finished runs on a `worca-metrics` branch
- [Team policy](docs/team-policy.md) — team-set cost caps, allowed models, required plugins, guardrail defaults and MCP servers from a `worca-policy` branch
- [Storage](docs/storage.md) — where state lives, project keys, migration
- [Worca in a container](docs/docker.md) — Worca and every `claude` it spawns in a disposable Linux container: the published image, compose, `worca container`
- [Remote access](docs/remote-access.md) — opt-in, behind Cloudflare Access, with Worca checking the token
- [Browser extension](docs/browser-extension.md) — sidebar chat, page context and Pinpoint on web pages; pairing and security model
- [Deploy on Railway](docs/deploy-railway.md) — the container as a hosted service behind Cloudflare Access
- [Releasing](docs/RELEASING.md) — how `@worca/app` versions are published
- [Screenshots](docs/screenshots.md) — how the shots in this README are made: a sandboxed Worca, demo data, headless Chrome
- [Contributing](CONTRIBUTING.md) — developing Worca from source

## Contributing

Bug reports and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for
the from-source setup, mock mode, the test suite, and the PR workflow.
Development happens on the `dev` branch, and PRs target `dev`.
Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
