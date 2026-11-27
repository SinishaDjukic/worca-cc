# Memory

Memory is what Worca remembers across runs and chats: short markdown notes
with rules and preferences that agents read before they work. There are three
kinds. **Global** memory holds the rules every project shares. **Project**
memory holds one project's own notes. **Team** memory shares a project's notes
with your teammates. Runs never change memory themselves: they propose notes,
and you decide which ones stay.

## Where to find it

- **Global memory:** **Settings › Memory**. It shows from the **Advanced**
  level (see [ui-levels.md](ui-levels.md)).
- **Project memory:** open a project from the sidebar's **Projects** page and
  click its **Memory** tab.
- **Team memory:** the **Team** view inside a project's **Memory** tab.

## The three scopes

**Global** notes load into every run and chat. **Project** notes load only
for that project. **Team** memory is a project setting, off by default. It
needs a git project with an `origin` remote, and it keeps the shared notes on
a `worca-memory` branch of that repository. A secret check runs before
anything is shared.

In the project's **Memory** tab, **Notes | Team** switches between the two
views. The **Team** view has a **Local · Team · Both** choice for which memory
runs and chats load:

- **Local** — this machine's notes only (team memory is off).
- **Team** — the team's notes only.
- **Both** — the team's notes and yours. Your note wins over the team's note
  of the same name.

Each note carries a state: **Local only**, **Shared**, **Team only**,
**Pending push**, **Held**, **Blocked** or **Removing from the team**. Click
**Sync now** to fetch and push straight away. The notes that existed before
you turned team memory on stay on this machine until you pick which to share
with **Share existing notes…** (or **Review notes…** in the one-time offer).
Click **Compare…** to settle a note the team holds differently from you, and
**Undo last seeding** to put your local notes back as they were before the
seeding. It also releases the notes the seeding held back. Notes it already
shared stay on the team; use **Remove from team** on a note to take it off.

When Worca finds that a project's `origin` already has team memory, the
project's **Overview** says "Your team shares memory for this repository".
Click **Turn on** to use it, or **Not now** to leave it.

## Notes

The **Notes** view lists the files in a scope. Click a file to open it, or
click **New file** to add one. A file is markdown with a short header: its
name, a one-line description of when it matters, and optional `paths` so it
loads only when a matching file is read. Worca stamps the source and the date.
Click **Save** to keep your edit, or **Delete** to remove the file.

The **History** card keeps a snapshot of every write. Click **Restore** on a
snapshot to go back to it. History shows from the **Expert** level. The health card, with its
**Defragment** button, also shows from Expert, except that an overdue or failing store always shows it.

## Runs propose memory

While a run works, its agents can write a note. It does not go into memory
straight away. It waits in a **Proposed by runs** list, at the top of the
scope's **Memory** view below Expert, with the run it came from. Each proposal says whether
it would **Add** a note, **Update** one or **Remove** one. An update lets you
open **The note now** to see what it replaces.

- Click **Approve** to write the note. When team memory is on, it is shared
  too.
- Click **Reject** to drop it.

To keep a run from using or proposing any notes, turn on **Run without memory**
in the new-run form's **Advanced** section (Advanced level and up). It helps when you want to compare a run with and without
memory.

## Defragment

Notes pile up. The health card at the top of a scope shows a badge — **No
memory yet**, **Healthy**, **Defragment due**, **Defragment overdue** or
**Writes failing** — with the file count and the writes since the last
defragment. Click **Defragment** to merge duplicate topics, split overgrown
files, drop stale rules and tighten the one-line descriptions.

A defragment is an ordinary run, so it shows in your runs list. The previous
files stay in **History**. While one is live, the button reads **Open run** and
takes you to it. A global defragment needs a registered project to run in: the
card says "Runs on" that project, and you pick another on the New run page. You
can also start it from the New run page with the **Memory defragment** workflow
and its **Memory scope** control: **Global** or **Project**. That control shows at
Expert; below Expert the run uses Global.

The model every defragment run uses is a helper job: change it under **Models ›
Jobs › Helper jobs** for an engine that has that job, or under **Roles** for the others (see [models.md](models.md)).

## Related

- [ui-levels.md](ui-levels.md) — which controls show at which level.
- [models.md](models.md) — the model a defragment run uses.
- [runs.md](runs.md) — what a run is, and how to open it.
- [storage.md](storage.md) — where Worca keeps memory on disk.
