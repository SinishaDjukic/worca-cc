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

## Runs redesign

**One run model, one look, everywhere.**

Runs, Shaper features and Run-after chains are now one thing on every surface: the Runs list, the chat card and the
run and group pages draw the same dot, the same status line and the same actions. A **?** marks a run that needs you
and a **!** one that failed. The list filters and groups from one View menu, rows can be selected and stopped,
archived or deleted together, and any run can join a group. A server restart now pauses live runs and resumes them.
Your existing runs, features, chains, archived runs and schedules carry over, and old links still open.

Chips: one status line · ? needs you · View menu · select and act · groups · restart pauses

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
