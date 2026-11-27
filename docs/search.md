# Search and Activity

The top bar has two shortcuts for getting around. **Search or ask** finds a run, a chat, a project, a workflow, a
schedule, a setting or a plugin from one box. **Activity** shows what needs you, what is running and what is
scheduled, without leaving the page you are on.

**Where to find it:** the top bar. **Search or ask** is the box at the top; **Activity** is the pill with a number
on it, right of it.

## Search

Click the **Search or ask** box, or press **⌘K** on a Mac or **Ctrl K** elsewhere. The box shows the shortcut for
your system at its right edge. Press the shortcut again, or **Esc**, to close it. On a phone the box folds into a
search button.

With nothing typed, the list shows your runs: the ones that need you first, then live runs, then the newest finished
ones. Type a few words and the list narrows to what matches all of them. Use the arrow keys to move down the list
and **Enter** to open a row.

The results come in groups:

| Group | What it finds |
|---|---|
| **Chats** | a chat by its title, a message in it, or its topic group |
| **Runs** | a run by its title, project, state or tag |
| **Projects, workflows, schedules** | a project, a workspace, a workflow, a repeating schedule, a scheduled one-off run, and a **Runs labelled** row that filters the Runs list by that label |
| **Settings** | a Settings tab or a card inside one |
| **Add-ons** | a setting on the Marketplace, Connectors or Models pages |
| **Plugins** | an installed plugin or one you can install from a marketplace |

Each group shows its best few matches, so a short, specific search works better than scrolling. If nothing matches,
the list says **No matches**.

### Finding settings

The search also finds settings, so you do not have to remember which tab holds one. Type **dark mode** to reach
**Appearance**, **proxy** to reach **Network proxy**, or **budget** to reach **Budget & cost limits**. A Settings row
says where it lives: **Settings tab** for a whole tab, or **Settings · Runs** for a card on the Runs tab. Open it and
Worca goes straight to that tab or card.

A setting can also match on a related word, such as **night** for **Away mode**. A match on the setting's own name
ranks above one on a related word.

Some settings are hidden until you switch interface mode ([ui-levels.md](ui-levels.md)) or turn on a feature in
Labs ([feature-flags.md](feature-flags.md)). Search still lists them, with a line under the row saying what unlocks
it, such as **Switch to Advanced mode** or **Turn on Labs: …**. Open the row and Worca takes you to the mode dialog
or the Labs row first, then on to the setting once it is unlocked.

### Ask instead

The last row of every search is **Ask in Chat** (**opens a chat**). Pick it and what you typed is put into the
Chat composer ([chat.md](chat.md)), not sent yet. On a page with the Ask worca side column, the row reads
**Ask worca** (**with this page**) and the text goes into that column's composer instead, also unsent
([chat-home.md](chat-home.md)).

## Activity

Click **Activity** in the top bar. A pop-over opens under the button with three tabs:

| Tab | Lists |
|---|---|
| **Needs you** | runs waiting on you (a question or gate, a pause, a failed run you have not opened, a finished run whose pull request has failing checks or conflicts) and Design builds with a question for you or paused |
| **Running** | runs that are working now, with their current step, and Design builds that are building |
| **Scheduled** | one-off runs that have not started yet, and repeating schedules |

Each tab shows how many rows it holds. The pop-over opens on the first tab that has rows. A tab with none says
**Nothing needs you**, **Nothing running** or **Nothing scheduled**.

Every row is a link. Click it, or press **Enter**, and Worca opens that run (or Design build, or the Schedules tab)
and closes the pop-over. Each row shows a title, the project, a state word and a time.

On **Scheduled**, rows are grouped by when they start: **Missed**, **Today**, **Tomorrow**, **This week**,
**Later** and **After a run** (a one-off that waits for another run to finish). A paused schedule sits at the end
of **Later**.

The pop-over is a list, not a control panel. To act on a run, open it. Two links at the foot go further:
**Open Schedules** opens the Schedules page, and **Schedule…** starts a new schedule
([scheduled-runs.md](scheduled-runs.md)).

### The badge

The number on the **Activity** pill is one count, not two. When something needs you it is amber and shows how many
things do. When nothing does, it shows how many runs are running. With neither, there is no number. Hover the
button for both counts, for example `1 needs you · 2 running`.

To hear about it outside the tab, turn on **Alerts** in Settings › General ([runs.md](runs.md)).

## Related

- [runs.md](runs.md): following a run, and the Runs list's **Needs you** and **Running** views.
- [chat.md](chat.md): the chat the **Ask in Chat** row opens.
- [scheduled-runs.md](scheduled-runs.md): the schedules behind the **Scheduled** tab.
- [ui-levels.md](ui-levels.md): the interface modes that hide or show settings.
- [feature-flags.md](feature-flags.md): the Labs switches.
