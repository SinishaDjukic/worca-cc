# Workflows, agents and scripts

A workflow is a graph of agent and script cards. This page covers the agents Worca ships, script cards, the workflow editor, and the built-in Presentation, Architecture (C4) and Promo video workflows.

## Agents

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
  editable copy ([docs/ui-levels.md](ui-levels.md#workflows)).
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

## Scripts

- **Cards that run your own program** — a script card keeps the whole outside of
  an agent card (typed ports, verdict routing, loops) and replaces the inside
  with your own Node.js, Shell or Python program (Python when the host has an
  interpreter), so a test gate or a transform costs no model call. See
  [docs/scripts.md](scripts.md).
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

![The Workflows view with the Library on its Scripts tab: the built-in scripts in coding, presentation, architecture, video and general folders (Git diff, Deck PDF, Deck audio, Deck bundle, C4 discover, check and render, Promo voices, narrate and render, Shell and JavaScript), each with a runtime chip and its port line, under the All, Built-in and Yours chips, beside an empty canvas holding Task and End](screenshots/scripts.png)

## Workflows

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
  sit bottom right. See [`docs/ui-levels.md`](ui-levels.md#workflows).
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

![The Workflows view with the built-in Default pipeline on the full-screen canvas — Task, Clarify, Plan, Refine Plan, Implementation, Review Implementation and End wired port to port, amber loop wires swooping back under the reviewers with ≤3 pills — beside the Library open on its Workflows tab, its architecture, coding, presentation, video and shared folders with coding opened on Default, with the black + and the composer chat pill at the bottom and Auto-layout and the zoom menu bottom right](screenshots/composer.png)

## Presentations

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
  [`docs/why-worca.md`](why-worca.md) runs on the same kit.

## Architecture (C4)

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
  [`docs/architecture/architecture.c4`](architecture/architecture.c4);
  the design is [`docs/architecture-c4.md`](architecture-c4.md).

## Promo video

- **A product film from your real UI** — the built-in **Promo video** workflow
  (`worca --workflow wf_promo_video --prompt "…"`) explores the project, writes a
  script you approve, captures the product's real screens in a sandboxed copy of
  the app, animates them with an optional mascot crew, reviews the film frame by
  frame and renders a 1080p60 MP4 with captions and YouTube metadata. A setup
  form asks for tone, length, pace, mascots and audio: narrated with ElevenLabs
  (pick a voice from playable previews; the key is never stored) or silent.
  Capture and render need Chrome or Edge and ffmpeg on the host; a run without
  them is refused up front.

