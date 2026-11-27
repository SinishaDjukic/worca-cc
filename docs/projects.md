# Projects

A project is a folder Worca runs your work in. Every run happens inside one, so adding a project is the first
thing to do in a fresh install. Each project has its own page with an overview of its runs, its own settings
and the team features that belong to it. Where Worca keeps what it records about a project is in
[storage.md](storage.md).

**Where to find it:** sidebar › **Projects**. Open a project's row for its page.

## Add a project

Click **Add project** at the top of the Projects page. On Chat home the same dialog opens from the **Add project**
tile of the quick-action row ([chat-home.md](chat-home.md)). The dialog has three tabs and opens on **New**.

| Tab | Use it to | What you fill in |
|---|---|---|
| **New** | start from nothing: Worca makes the folder in its projects folder | **Name**; **Location** shows where the folder will go |
| **Folder** | register a folder that is already on this machine | **Folder** (type the path, or **Choose folder…**) and **Name** |
| **Clone from URL** | bring in a repository | **Repository URL**; optionally **Branch** and **Folder name** |

- **New.** Type a **Name**: **Location** fills in as you type. The **Use git** switch starts on when git is
  available, so runs get branches and pull requests. Click **Create project**.
- **Folder.** The name is proposed from the folder; type over it to change it. A folder that exists is never
  turned into a git repository unasked. **Several folders…** opens Worca's folder browser, where you tick
  several folders and click **Add selected**; a list shows them together, where you untick a row to leave it out and
  click **Add projects**. Click **Add project** when you picked one.
- **Clone from URL.** Paste the repository URL, then click **Clone and add**. The dialog shows the progress
  while it clones. This tab needs git; it is hidden while git is not available.

Adding a project never touches the folder's files, and removing one later leaves the folder and its run history
alone.

A list with **No projects yet** shows an **Add project** button. Once a project is a plain folder, the **Use git**
button in its project page header turns it into a repository; a git project with no origin offers **Link remote**
there instead.

## The Projects list

Each row shows the project, its branch and origin, and the agent-readiness chip: **Agent-ready**, **Partly
ready** or **Not agent-ready**. The chip is status only here: open the project and click the chip in its page header for the report ([agent-readiness.md](agent-readiness.md)).
**Sync all (N)** shows only while a project is behind and only fast-forwards; a project that can't be
fast-forwarded is left, and a toast says so.

## The project page

A project's page has tabs. Overview is always there; the others appear as you move up from the simple view
([ui-levels.md](ui-levels.md)).

| Tab | What it is for |
|---|---|
| **Overview** | the project at a glance: its branch, how many runs it has had, the last run, and **Start one** when there are none yet |
| **Team** | the two team features of this project: **Team metrics** and **Team policy**, each with its own set-up button ([team-metrics.md](team-metrics.md), [team-policy.md](team-policy.md)) |
| **Memory** | the notes Worca keeps for this project and the ones runs propose ([memory.md](memory.md)) |
| **Settings** | this project's own settings, its **Away mode for this project** card, and the agent-readiness checks you can skip for it ([away-mode.md](away-mode.md)) |
| **Sets** | the connector sets and servers this project uses ([mcp-servers.md](mcp-servers.md)) |
| **Actions** | what Worca does with a finished run of this project, with **Try it** to test one ([actions.md](actions.md)); hidden while git is not installed on this machine |
| **Automations** | rules that start a run on a GitHub or Azure DevOps event ([git-automations.md](git-automations.md)); hidden while git is not installed on this machine, and only while **Git event automations** is on in Settings › Labs |

## Related

- [Where Worca keeps its state](storage.md)
- [Agent readiness](agent-readiness.md)
- [Chat home](chat-home.md)
