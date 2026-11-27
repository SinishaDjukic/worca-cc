# The Runs list

The Runs list is where you find, sort and tidy your runs. Each row is one run, with its status dot and status line.
You can put runs in groups, ship a group with one **Create PR**, label runs, act on several at once and archive the
ones you are done with. Most of it works from the keyboard.

**Where to find it:** **Runs** in the sidebar. A run opens beside the list.

## Find the runs you want

The **View** menu at the top of the list sets what the list shows:

- **Show**: All, Needs you, Running, Waiting, Finished, Ready to ship or Archived, each with a count.
- **Group by**: Date, Project or None. This only arranges the list under headings; it is not the same as a group of
  runs (see below).
- **Started by** lists people when several of them share a Worca. Pick one, or **Everyone**.

When the list is filtered, a chip above it says so (for example `Finished · 4 of 12 runs`). Its **×** resets the view.
Worca remembers your View in this browser.

## Groups

A group puts related runs under one row, so you can follow them together. Open a row's **⋯** menu and choose
**Add to group…** (Advanced and up, see [UI levels](ui-levels.md)). Find a group, or type a name and pick
**Create "…"**. **New group…** at the top opens a dialog with a name. A run joins one group at a time. Adding it to
another moves it, and the toast has an **Undo**. **Remove from group** in the run's **⋯** takes it out again.

Click a group's row to open its page, with its runs and their combined status. Worca's own groups, such as a
[Shaper feature](shape-it-first.md) and its runs, show up in the list the same way.

### Create PR for a group

A group whose runs have finished has **Create PR** on its page, on the status line. Once there are
pull requests, it becomes **View PR** or **View PRs ▾**. The dialog's **Pull requests** choice is:

- **One**: a single pull request for the whole group. For your own groups, Worca checks first that the runs combine,
  and it makes a new branch that joins their branches. **One** is greyed, with the reason, when a run already has a
  PR. In a Run-after chain it is also greyed when a run does not start from the previous run's branch; in your own
  groups, when the group has one run ("A group of one run ships as its own PR"), while Worca checks whether the runs
  combine, or when that check says they don't. A small-runs feature always ships stacked.
- **N separate** (or **N stacked** for a feature or a chain): one pull request per run.

Under **One** you write the title and description (a [Shaper feature](shape-it-first.md) hides the description: the PR
takes every run's summary). With several PRs, each takes its own run's summary. The button
reads **Create PR**, or **Create 3 PRs** for three.

## Labels

Labels are free words such as `hotfix` or `needs demo`, shown as chips after a run's title. They are an experimental
feature, so turn on **Run labels** in Settings › Labs first (see [Feature flags](feature-flags.md)).

- To label runs, select them and click **Label** in the bar below the list. Tick the labels to add or remove, or type
  a new word and pick **Create "…"**.
- To filter the list, search for a label in the top search bar and pick **Runs labelled …**. A chip row appears above
  the list, and the list shows runs with any of the chosen labels. Click a chip's **×** to drop it.
- Settings › Labels & cost tags › Labels lists the words in use and lets you rename or delete one.

## Select several runs

Choose **Select** in the View menu, or hold Ctrl (⌘ on a Mac) and click a row. **Shift**-click adds every row between
the last one you picked and this one. A checkbox appears on each row, and **Select all** ticks every row you can see.

A bar at the bottom shows `3 selected` and one button per action: **Label**, **Group**, **Stop**, **Archive** and **Delete**. All but **Label** show the number of
runs they apply to. **Group** and **Delete** need Advanced and up, and
**Label** needs the flag above. A run an action can't apply to is skipped, and a note names it. For
example, you can't stop a run that already finished. **Cancel** ends the selection.

## Archive

**Archive** moves a finished run out of the list without deleting it. Pick it in the row's **⋯** menu, the bar or with
**E**. The toast says `Archived 2 runs` and offers **Undo**. If an archived run was interrupted and could still resume,
Worca asks first, because it can't be resumed afterwards.

To see archived runs, choose **Show › Archived** in the View menu. There **Restore** (or **E**) brings a run back.
**Delete** is a different, permanent action (Advanced and up): it removes the run's record, files and local branches, and
its confirm opens on **Cancel**.

## Keyboard shortcuts

Press **?** on the Runs page, or choose **View › Keyboard shortcuts**, to see the sheet. Ctrl is ⌘ on a Mac.

| Key | What it does |
| --- | --- |
| **↑** **↓** or **J** **K** | Move between rows |
| **Enter** | Open the run |
| **→** / **←** | Unfold / fold a group |
| **.** | Open the row's **⋯** menu |
| **S** | Stop the run, or the selected runs |
| **E** | Archive or restore the run, or the selected runs |
| **G** | **Add to group…** (Advanced and up) |
| **Shift+G** | **Remove from group** (Advanced and up) |
| **Backspace** | **Delete** (Advanced and up) |
| **Space** | Select or unselect the row |
| **Shift+↑** **Shift+↓** | Extend the selection |
| **Ctrl+A** | Select all |
| **Esc** | Clear the selection |
| **Ctrl+K** | Search or ask |
| **?** | Open the shortcuts sheet |

With rows selected, **S**, **E** and **G** act on the whole selection.

## Related

- [Runs](runs.md): what a run does and what you can do on its page.
- [UI levels](ui-levels.md): which controls show at Simple, Advanced and Expert.
- [Feature flags](feature-flags.md): turning on Run labels.
