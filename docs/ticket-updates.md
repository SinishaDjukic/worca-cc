# Ticket updates

> Labs: turn on **Ticket updates** in Settings › Labs (`ticketUpdates`). Off, nothing changes: each tracker plugin uses its own
> "on completion" setting, as before.

Worca decides what happens to a ticket when a run that writes back finishes; the tracker plugin only translates it into its
tracker's terms.

## Where

**Marketplace › Installed › Jira › Settings**, below **Test connection**, once the connection is saved. Advanced mode, with
the Marketplace page.

- **Projects you work on.** Pick the tracker's projects you work on (**Add projects…**; the list opens right-aligned under
  its button). New run, Requirements export and import list only these. None picked = all projects. A project the tracker
  no longer lists stays as a chip. In the Requirements import, the **All projects** word search looks only in the projects
  you picked. (That part lands with the Requirements import change, #1041, or right after it.)
- **When a run finishes successfully.** **All projects** says what happens unless a project says otherwise: **Don't move**
  or **Any Done status**. **Add a project rule** for a project's own choice: Don't move, Any Done status, or one of that
  project's statuses. The trash icon removes a rule. Removing a project from the list keeps its rule.
- **Save** saves it with the connection's other settings.

## What a run does

The run's ticket moves by the rule of its project, else All projects, and Worca's one comment on the ticket ends with what
happened: `Moved to Resolved.`, `Already in Closed.`, `Moved to Done, Resolution: Done.`, or a `Not moved: …` line saying
why (Jira's own reason when Jira refused the move, or "Jira gave no reason."). The outcome is in the ticket's comment and in
the run's history line ("Result reported back to the task source. <note>"); the results view does not repeat it. A run that
did not finish successfully does not move its ticket.

Which failures are a line and which fail the write-back:

- A 4xx refusal of the move (not 401 or 429) becomes a "Not moved: …" line, and the comment is still posted.
- A refused API token (401), a rate limit (429), a Jira server error (5xx), a network error or a timeout fails the
  write-back instead, so it can be tried again.

After a failed comment, a retry finds the ticket already moved and says "Already in …" for **Any Done status** and for a
rule that names one of the project's statuses. A typed transition name carried over from the old setting says it only when
its text is also the name of the ticket's current status: a transition called "Resolve" that leads to "Resolved" is not
recognised, so the retry reads "Could not move to …" and the ticket stays where it is.

Every run records its ticket's project when it starts, even with the flag off, so a rule saved later also applies to runs
that started before.

**Any Done status** is one the ticket can reach, never a cancelled one (Won't Do, Won't Fix, Rejected, Duplicate, Cancelled,
Declined, Invalid, Obsolete, Abandoned, Not planned). When a move asks for a Resolution, Worca fills in Done, Fixed or
Complete.

## Categories

Every tracker's statuses map onto four: to do, in progress, done and cancelled. Jira: its "To Do" category is to do, "In
Progress" in progress, "Done" done, except the cancelled names above. Azure Boards and GitHub follow in a later release.

## The old setting

Until you save Ticket updates for a connection, the plugin's old setting works exactly as before (Jira: **Transition on
completion**). The first time you open the section, All projects is filled in from it, with a note; nothing changes until you
save. After that, the old setting reads "Moved to Ticket updates." and is no longer used.

## Where it is stored

`<Worca home>/plugins/<plugin>/data/ticket-updates.json`, per connection (profile). Removing a profile removes its Ticket
updates; uninstalling a plugin keeps them, purging removes them. With the flag off the file is kept, so turning the flag on
again restores the rules.

## For plugin authors

The plugin contract (`listStatuses`, `legacyMove`, `reportResult`'s `move`) is in the creating-plugins skill and in
`plugin-api.mjs`. The plugin API stays 5: a plugin without these keeps its old behaviour.
