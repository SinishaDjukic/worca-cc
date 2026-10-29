# Workflows, agents and scripts

A workflow is a graph of agent and script cards. This page covers the agents Worca ships, script cards, the
workflow editor, and the built-in Presentation, Architecture (C4) and Promo video workflows.

## Agents

### 32 built-in agents

Every agent is data: a markdown prompt plus a metadata sidecar that declares its typed input and output ports. A
new agent drops in without any engine change, and your own agents and plugin agents load the same way.

The built-in agents, by group:

- **Coding**: Clarify, Plan, Refine Plan, Plan Review, Decompose, Implementation, Review Implementation, Manual
  Tests Checklist, and Manual web UI testing. Decompose splits a plan into vertical-slice tasks, one implementer
  each. Manual web UI testing runs the checklist in a browser through Playwright.
- **Workspaces**: Workspace Review gives one review per changed project and one verdict across projects. The
  workspace scan adds Workspace Survey, Workspace Usage and Workspace Synthesis, which only the scan can place.
- **Presentations**: Deck Clarify, Narrative Spine, Visual System, Deck Builder, Deck Audit, Deck Review, Deck
  Outputs and Deck Export.
- **Architecture**: C4: setup (the form for which file and which bands) and C4: architect (reads the code and
  writes the LikeC4 model).
- **Video**: Promo: setup, explore, script, voice, capture, mascot, scenes and review.
- **Memory defragment**: restructures one memory scope.

### Agents in the Library

**Workflows › Library › Agents** lists every agent with its ports. Built-in agents are read-only. To change one,
**Duplicate** it and edit the copy. See [UI levels](ui-levels.md#workflows).

### Creating an agent

Click **+ New agent** in the Library, or **New agent…** in the canvas **+** menu. Give it a name, a purpose and a
description, and Worca drafts both the system prompt and the metadata. If you already have a prompt, paste it and
Worca infers only the wiring. Edit the draft, **Regenerate** it if you like, then **Save agent**.

### Ask forms

An agent that needs a person can declare the form its question is asked with. The form is JSON in the agent's
sidecar. Worca draws it from a fixed catalog of widgets, such as galleries, rankings, review lists with one row per
item, and previews of the files the agent just produced. The server validates the answer on the way back.

The CLI and chat get a text version of the form, and chat answers with `/answer field=value`. A finished run's page
replays the form, read-only, with its answer. Review Implementation, Narrative Spine, Visual System and Deck Outputs
ask this way, and plugins can ship forms too.

### Model and effort per agent

You can pick a model and a reasoning effort (medium, high, xhigh, max) for each agent node. In Workflows, use the
toolbar over a selected agent card. For one project, use New pipeline › **Advanced** › **Agents**. The project
keeps your picks for its later runs, and **Save as workflow defaults** moves them into the workflow.

A project's pick beats a team-policy default, which beats the workflow's own. `--model` only fills nodes that have
none. Fan-out agents also take a sub-agent model.

## Scripts

### Cards that run your own program

Not every step needs a model. A script card looks like an agent card from the outside, with typed ports, verdict
routing and loops. Inside, it runs your own Node.js, Shell or Python program (Python when the host has an
interpreter). A test gate or a transform then costs no model call. See [Scripts](scripts.md).

### Scripts in the Library

**Workflows › Library › Scripts** lists every built-in, own and plugin script with its runtime and ports.

- **+ New script** asks for a runtime, then reads the ports and params from the code as you type.
- **Duplicate** copies any script into your own folder.
- **Delete** refuses while a saved workflow still uses the script.

Built-in and plugin scripts open read-only.

### Test bench

The test bench sits under the editor. It runs one script by itself, even an unsaved draft, with params and inputs
you fill in by hand. It uses the very same runner as a pipeline run.

**Save as case** keeps the setup, with an optional expectation made of the verdict, the ports that fire and the summary
text.
**Run all** runs every case again.

### Shipped scripts

Worca comes with Shell, JavaScript and Python cards, Git diff, and the steps behind the presentation, architecture
and workspace-map workflows. Plugins can ship their own scripts and test cases.

![The Workflows view with the Library on its Scripts tab: the built-in scripts in coding, presentation, architecture, video and general folders (Git diff, Deck PDF, Deck audio, Deck bundle, C4 discover, check and render, Promo voices, narrate and render, Shell and JavaScript), each with a runtime chip and its port line, under the All, Built-in and Yours chips, beside an empty canvas holding Task and End](screenshots/scripts.png)

## Workflows

### A full-screen editor

**Build › Workflows** is available in every interface mode. It's a canvas of frosted cards. Drag a card from the
Library, or add one with the black **+**, then wire its typed ports (`md`, `json`, `void`). Wires are smooth and
coloured by type.

Each card declares what it consumes and what it produces. A wire only connects compatible ports, and **Save** stays
off until the graph is valid.

A blocking output wired back to an earlier card becomes a loop. It's drawn in amber, swooping under the cards with
a **≤N** pill. A reviewer keeps sending work back until it passes or the loop reaches its cycle cap. The cap is 3 by
default, and you set it per loop wire in its toolbar.

Flow cards express joins, choices and merges without code: **Task** (the run's request), **End** (the result),
**AND**, **OR** and **Combine**.

A selected card's toolbar sets its model, effort and await-all. **More** holds every other setting. The top bar
keeps only Back, **Workflows ▾** (New canvas, Open…, Import…, Export…), the name, the Library toggle and **Save**.
**Auto-layout** and the zoom menu sit bottom right. See [UI levels](ui-levels.md#workflows).

### The Library

The card beside the canvas switches between **Agents**, **Scripts** and **Workflows**. Every agent and script action
lives there: view, edit, create, duplicate, delete, and the script test bench. Their editors open in a sheet inside
the view. The old `#composer`, `#agents`, `#scripts` and `#agent-create` addresses land in the view.

### The composer chat

The pill beside **+** grows into a chat. It runs on Chat's engine and works only on the open canvas.

- It adds, removes and rewires agent and script cards, and sets model, effort, max cycles and await-all. Each
  change lands at once, with an inline **Undo**.
- It builds whole workflows. **Apply to canvas** opens one as a new unsaved workflow.
- It drafts new agents (metadata and system prompt) and new scripts (code, interface and test cases, which it can
  run). You **Save** them from their card.

It never runs anything. To run a workflow, save it and start a run from **New run**. **New chat** starts over.

### From Chat too

The main chat can draft agents and scripts and propose whole workflows, scripts, gates and new agents included. It
uses the same cards, without a canvas. **Save** a draft, or open it in its editor. For a proposed graph, choose
**Save as workflow**, **Open in Workflows** (a new unsaved workflow on the canvas) or **Decline**.

### Saved pipelines

The Library's **Workflows** tab lists saved pipelines with domain chips. Click a row to open one. The built-in
**Default** and **Memory defragment** open read-only, and Save makes a copy. Saved pipelines appear in New
pipeline's **Workflow** picker, and so in schedules too.

### Sharing a pipeline

**Export…** on a Library row, or in **Workflows ▾**, offers three formats:

- **JSON file**: the graph only. The recipient opens it with **Workflows ▾ › Import…**. A name that's already taken
  gets a ` (2)` suffix, so nothing is ever overwritten, and any script commands are shown for approval first.
- **Claude Code skill** (Expert): writes a `SKILL.md` plus the agents it dispatches under `.claude/`, so the
  pipeline runs inside Claude Code without Worca. This doesn't work yet for pipelines with script cards.
- **Worca plugin**: a folder with the pipeline, your own agents and scripts it uses, and the skills they need.
  Built-in agents are never copied. The recipient runs `worca plugin link <folder>` and picks up your edits with
  `worca plugin reimport <name>`.

For a plugin you can also pick **Marketplace**. Worca then opens a pull request that adds the plugin to a registered
team marketplace. It uses one branch, `worca/plugin/<name>`, is validated with the marketplace's own
discovery, and comes from a fork when you can't push.

The CLI does the same with `worca workflow list`, `worca workflow export <id> --format json|claude|plugin` and
`worca workflow import <file>`.

![The Workflows view with the built-in Default pipeline on the full-screen canvas — Task, Clarify, Plan, Refine Plan, Implementation, Review Implementation and End wired port to port, amber loop wires swooping back under the reviewers with ≤3 pills — beside the Library open on its Workflows tab, its architecture, coding, presentation, video and shared folders with coding opened on Default, with the black + and the composer chat pill at the bottom and Auto-layout and the zoom menu bottom right](screenshots/composer.png)

## Presentations

### From a brief to a slide deck

The built-in **Presentation** workflow turns a request into a slide deck. Pick it in New pipeline's **Workflow**
picker (Advanced; Simple lists only Auto and Default), have Chat propose one, or run
`worca --workflow wf_presentation --prompt "…"`.

1. **Deck Clarify** asks what shapes the talk: live or read alone, the audience, duration, the ask, sources and
   brand.
2. **Narrative Spine** writes one hallway sentence, a spine of 3–5 sections and a takeaway title for each slide.
3. **Visual System** fixes the grounds, type scale, compositions and accent, with rendered preview sheets.

You approve the spine and the visual system on ask forms, or send changes back. **Deck Outputs** then asks what to
deliver (PDF and standalone HTML, PDF only, standalone HTML only, or only the deck files) and whether to add
narration audio.

### Built, measured, reviewed

**Deck Builder** writes a 1920×1080 HTML deck on the vendored OpenDeck kit, one section per slide.

**Deck Audit** renders the deck headless, takes a screenshot of every slide and reports mechanical facts: boxes
escaping the slide, clipped or overlapping text, contrast, text size and words per slide. Once that is clean, **Deck
Review** judges the rendered slides for focal points, takeaway titles and one hero moment. Findings from both go
back to the builder, up to 3 cycles each.

### Files you can send

After a clean review, script cards produce the files:

- `deck.pdf`, printed with headless Chrome. The page count is checked against the slide count.
- Optionally, an ElevenLabs narration for each slide, recorded from the speaker notes. The API key is used for that
  run only and never written to disk.
- `deck.standalone.html`, one self-contained file with everything inlined.

**Deck Export** then checks the result against what the request asked for. Findings from these cards loop back to
the builder too, up to 2 cycles.

The files live in the run's folder, not in your repository. Open them on the run's **Artifacts** tab (Advanced).
The audit and the PDF need Chrome, Chromium or Edge, and the script cards need Python 3.8+. The narrated deck
linked from [Why Worca](why-worca.md) runs on the same kit.

## Architecture (C4)

### A model of your code, kept by your code

The built-in **Architecture (C4)** workflow keeps a LikeC4 model of a project or a workspace up to date. Run it
with `worca --workflow wf_architecture_c4 --prompt "…"`.

It finds the project's LikeC4 files and asks on one card which to update. Or you choose to create a new one, and the
card asks where, and how to group the deployment sheet into bands, each with prose criteria for what belongs in it.
It also asks which images to export.

The architect reads the code and writes the model. A check card parses the model with the viewer's own parser and
sends blocking problems back, up to 2 cycles.

### Drawn the same everywhere

Open the `.c4` file from a run's **Artifacts** tab and it draws in Worca's viewer. The viewer has a view picker, an
info rail, highlighting on hover and selection, a JPEG button and **Full screen**.

The render card writes SVG, JPEG or PNG of every view with the same renderer. JPEG and PNG need Chrome, Chromium or
Edge, and in a container the `-full` image. Worca's own model is
[`docs/architecture/architecture.c4`](architecture/architecture.c4), and the design is in
[Architecture (C4) design](architecture-c4.md).

## Promo video

### A product film from your real UI

The built-in **Promo video** workflow (`worca --workflow wf_promo_video --prompt "…"`) makes a short film of your
product. It explores the project and writes a script for you to approve. It then captures the product's real
screens in a sandboxed copy of the app and animates them, with an optional mascot crew. Finally it reviews the film
frame by frame and renders a 1080p60 MP4 with captions and YouTube metadata.

A setup form asks for tone, length, pace, mascots and audio. The film is either silent or narrated with ElevenLabs,
where you pick a voice from playable previews. The key is never stored.

Capture and render need Chrome or Edge and ffmpeg on the host. Without them, Worca refuses the run up front.
