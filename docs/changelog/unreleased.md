# Unreleased

Notes on merged features that have no release page yet. `/worca-changelog` folds
them into the next page and empties this file.

## Requirements (experimental)

**Define a feature with Worca before anything is built.**

A product owner describes a feature in a few sentences and Worca interviews them, a few questions at a time, into a testable spec: goal, actors, flow, edge cases, rules, acceptance criteria and assumptions. Six checks say when it is Ready, and **Start in Worca** starts a normal run with the spec as its task. A product brief, made once per project or workspace from its default branch, lets every interview there start from what the product already does; edits to the spec or the brief are kept.

Chips: Requirements · interview · Ready · Start in Worca · product brief · Requirements interview model · experimental: turn it on in Settings › Labs

Read it: [Requirements](../requirements.md)

Pull requests (add each number when it opens):

- Requirements (#882)

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

## Shape it first (beta)

**Plan it before it builds.**

Worca now shapes a thin or large task first: at most 3 questions, a plan written for the perspectives you pick, your approval, and then the run only builds. A task too big for one change is cut into slices, each with its own run, branch and pull request, stacked one on the next.

Shaper is now in beta and on by default; turn it off in Settings › Labs or with `worca flags off shapeFirst`.

Chips: Shaper · the plan card · checklists in review · plan in slices · beta: on by default, turn it off in Settings › Labs

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
