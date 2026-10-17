# Unreleased

Notes on merged features that have no release page yet. `/worca-changelog` folds
them into the next page and empties this file.

## Shape it first (experimental)

**Plan it before it builds.**

Worca now shapes a thin or large task first: at most 3 questions, a plan written for the perspectives you pick, your approval, and then the run only builds. A task too big for one change is cut into slices, each with its own run, branch and pull request, stacked one on the next.

Chips: Shaper · the plan card · checklists in review · plan in slices · experimental: turn it on in Settings › Experimental

Read it: [Shape it first](../shape-it-first.md)

Pull requests (add each number when it opens):

- Shape it first: the engine
- Shape it first: Chat features
- Shape it first: review checklists
- Shape it first: plan in slices

## Run presets (beta)

Save a New run setup as a named preset, pick it later, type a prompt and start: the run gets the preset's choices for that run only, and the project's settings never change. Read it: [Run presets](../run-presets.md)

- Every new run keeps its setup, and a finished run's page has **Save setup as preset** to turn it into a preset.
- The Chat home shows your presets as one-click chips under **Start from a preset**.
- Schedules follow their preset, `worca run --preset NAME --prompt "…"` starts one from the terminal, and Ask Worca proposes runs from your presets. Run presets are now in beta and on by default.

## Files in the chat

**Ask Worca shows the files it makes, right in its reply.**

When Ask takes a screenshot, makes a chart or finds a report or a run artifact, it now puts the file into its answer as a files card: images inline, every other file as a row with its kind and size. A click opens the viewer with zoom, next/prev, full screen and Download. Files are copied into the chat, so the card still works after the original changes, and it comes back when you reopen the chat. Credential files and anything outside the chat's folders are refused; SVG is shown only as an image and HTML only as source.

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
