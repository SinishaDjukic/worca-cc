# Ticket updates

> Labs: turn on **Ticket updates** in Settings › Labs (`ticketUpdates`). Off, nothing changes: each tracker plugin uses its own
> "on completion" setting, as before.

Worca decides what happens to a ticket when a run that writes back finishes; the tracker plugin only translates it into its
tracker's terms.

## Where

**Marketplace › Installed › Jira, Azure Boards or GitHub Issues › Settings**, below **Test connection**, once the connection
is saved. Advanced mode, with the Marketplace page. For GitHub Issues a project is a repository (`owner/repo`), and New run's
**Repository** list is the one that is shortened.

- **Projects you work on.** Pick the tracker's projects you work on (**Add projects…**; the list opens right-aligned under
  its button). New run and Requirements export list only these. None picked = all projects. A project the tracker
  no longer lists stays as a chip. Once the Requirements import ships (#1041), its **All projects** word search will look
  only in the projects you picked; that part is not in this release.
- **When a run finishes successfully.** **All projects** says what happens unless a project says otherwise: **Don't move**
  or **Any Done status**. **Add a project rule** for a project's own choice: Don't move, Any Done status, or one of that
  project's statuses. The trash icon removes a rule. Removing a project from the list keeps its rule.
- **Save** saves it with the connection's other settings.

## What a run does

The run's ticket moves by the rule of its project, else All projects, and Worca's one comment on the ticket ends with what
happened: `Moved to Resolved.`, `Already in Closed.`, `Moved to Done, Resolution: Done.`, or a `Not moved: …` line saying
why (Jira's own reason when Jira refused the move, or "Jira gave no reason."). The outcome is in the ticket's comment and in
the run's history line (`Result reported back to the task source: “Moved to Resolved.”`); the results view does not repeat
it. A run that did not finish successfully does not move its ticket.

The outcome is the tracker's text, so Worca keeps it as data: one line of at most 300 characters, with control, bidi and
zero-width characters removed, angle brackets shown as ‹ › and backticks as ', inside quotes in the history line.

Which failures are a line and which fail the write-back:

- A 4xx refusal of the move (not 401 or 429) becomes a "Not moved: …" line, and the comment is still posted.
- A refused API token (401), a rate limit (429), a server error (5xx), a network error or a timeout fails the
  write-back instead, so it can be tried again.

After a failed comment, a retry finds the ticket already moved and says "Already in …" for **Any Done status** and for a
rule that names one of the project's statuses. A typed transition name carried over from the old setting says it only when
its text is also the name of the ticket's current status: a transition called "Resolve" that leads to "Resolved" is not
recognised, so the retry reads "Could not move to …" and the ticket stays where it is.

Every run records its ticket's project when it starts, even with the flag off, so a rule saved later also applies to runs
that started before.

The rules live in the plugin's `data/ticket-updates.json`. If that file is edited by hand into something that cannot be read, Worca
treats the connection as having no saved rules: the old **Transition on completion** setting applies again, and the next
save writes a fresh file without the rules that could not be read.

**Any Done status** is one the ticket can reach, never a cancelled one (Won't Do, Won't Fix, Rejected, Duplicate, Cancelled,
Declined, Invalid, Obsolete, Abandoned, Not planned), and never through a transition whose name contains such a word ("Won't Do" or "Close as Duplicate" into Closed
is skipped; of several transitions to one status, the one named Done, Close or Resolve goes first). When a move asks for a
Resolution, Worca fills in Done, Fixed or Complete.

## Azure Boards and GitHub Issues

**Azure Boards.** Any Done status is the first state of the work item's type in the Completed category (Agile's Closed,
Scrum's and Basic's Done); a Resolved item is not done yet, and Removed is never chosen. A rule that names a state moves the
item to that state of its own type; a type without that state leaves the item where it is and says so (`Not moved: Shop's
Task type has no status named Resolved.`). An item already Completed or Removed stays. A move Azure refuses reads `Not
moved: Azure Boards refused the move to Closed: <Azure's message>.`

**GitHub Issues.** Three statuses: Open, Closed (as completed) and Closed as not planned. Any Done status closes an open
issue as completed; a closed issue stays as it is, so one closed as not planned is never turned into a completed one. A rule
may also close as not planned, or reopen (Open). GitHub Projects' own Status fields are not used. A move GitHub refuses reads
`Not moved: GitHub refused the move to Closed: <GitHub's message>.`

## Categories

Every tracker's statuses map onto four: to do, in progress, done and cancelled. Jira: its "To Do" category is to do, "In
Progress" in progress, "Done" done, except the cancelled names above. Azure Boards: Proposed is to do, In Progress and
Resolved in progress, Completed done, Removed cancelled. GitHub Issues: open is to do, closed as completed done, closed as
not planned (or as a duplicate) cancelled; nothing is in progress.

## The old setting

Until you save Ticket updates for a connection, the plugin's old setting works exactly as before (Jira: **Transition on
completion**; Azure Boards: **Close work item on completion**; GitHub Issues: **Close issue on completion**, where Yes is
carried over as Any Done status). The first time you open the section, All projects is filled in from it, with a note; nothing changes until you
save. After that, the old setting reads "Moved to Ticket updates." and is no longer used.

## Where it is stored

`<Worca home>/plugins/<plugin>/data/ticket-updates.json`, per connection (profile). Removing a profile removes its Ticket
updates; uninstalling a plugin keeps them, purging removes them. With the flag off the file is kept, so turning the flag on
again restores the rules.

## For plugin authors

The plugin contract (`listStatuses`, `legacyMove`, `reportResult`'s `move`) is in the creating-plugins skill and in
`plugin-api.mjs`. The plugin API stays 5: a plugin without these keeps its old behaviour. A project key may hold one `/`
(GitHub's `owner/repo`), never `.` or `..` as a part, `%`, `\`, `?` or `#`.
