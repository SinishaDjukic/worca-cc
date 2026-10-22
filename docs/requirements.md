# Requirements

Turn an idea into a clear, testable feature spec with Worca **before** anything is built. Experimental:
turn on **Requirements** in Settings › Labs (the `requirements` flag), or start Worca with
`WORCA_FLAGS=requirements`. With the flag off the page, its routes and its live updates are all gone.

## How it works

1. **New feature** on the Requirements page: a title, a few sentences, and the project or workspace it is for.
2. **Worca looks at the code once** (a read-only temporary copy, removed straight after) and writes, in
   plain words, what already exists in that area. You see it under *What Worca found in the code*;
   **Look again** (in the **⋯** menu) refreshes it. Turn it off per project or workspace in **Project context**
   (also in **⋯**).
3. **The interview**: rounds of at most 3 questions, each with options and a recommended answer, at most
   6 rounds. **Skip, use recommended** answers the rest for you; **Finish now** ends it early. Earlier
   rounds stay on the page with the answers you gave; **Change** reopens a round, and Worca continues from
   the corrected answers. Whatever is still open when the interview
   ends becomes an assumption.
4. **The spec** fills in as you answer: goal, actors, main flow, edge cases, business rules, out of scope,
   acceptance criteria (`R-po-1`, `R-po-2`, …), assumptions (`A-1`, …) and open questions. Edit any section:
   Worca keeps your text (**Let Worca rewrite this** hands it back). Add or remove criteria: a criterion
   you removed never comes back. Confirm or reject each assumption.
5. **Export ▾** → **Save to specs/** writes `specs/FEAT-<n>-<title>.md` into the project's folder without committing.
   **Copy Markdown** and **Download .md** work for workspaces too.

If a look or a round fails (no reply, an unreadable reply, the spending limit, or a Worca restart), the
page says why and offers **Try again**, which re-runs exactly what failed. **Archive** hides a feature
from the list; the **Archived** filter lists it again, and **Restore** brings it back where it was.

Nothing is built until you press **Start in worca** (below). Each look and round is one model call; its cost is shown on the
feature, counts toward your spending limit, and is part of the spend in Statistics and the account menu.
Worca runs at most four requirements looks or rounds at a time.

## Ready

A feature is **Ready** when six checks pass; Worca computes them from what is stored, no model is asked:

1. A goal with a success measure.
2. At least one acceptance criterion.
3. The interview is finished.
4. No open questions.
5. Every assumption is decided (none open, and none you rejected that no round has asked about yet).
6. The project or workspace still exists.

The Ready panel shows each check and what is missing. The list and the page header say **Decide** when the
interview is done but a check still fails; **Confirm the N left** settles them in one click. When all six pass, a
**Ready to build** card offers **Start in worca**.

You can start before it is Ready: **Start before it's Ready...** asks for a reason, which is required.
Worca keeps the reason, your name and the checks that failed on the feature, and the run is marked as
started before Ready. Open assumptions are then treated as confirmed. Worca refuses it without a reason, and
always refuses a feature that is busy, archived or whose project or workspace is gone.

## Start in Worca

**Start in worca** starts a normal run from the feature:

- The run's task is the spec, with the acceptance criteria (`R-po-1`, ...) as its definition of done. The
  run title is `FEAT-<n>: <title>`.
- It uses the **Auto** workflow and the project's default branch, unless you change them under **Change** on the
  Ready to build card. Auto picks a workflow for the task and, when the project asks for confirmation, shows
  its pick on the run page for you to accept.
- Only runs started from Requirements are checked this way. **New run**, **Ask**, schedules and the CLI
  work as before and do not look at Requirements.

The page's **Runs from this feature** card lists every run started from the feature, with its status and
cost, and links to the run (its live page, also after a resume, else its page in History). A run that
waits for you, on a question, a gate or the Auto confirmation, says **Waiting for you**.

## Follow-up rounds

After the interview, a change of mind does not need a new feature. **Reject** an assumption, then choose
**Done, ask about A-n** to put it to a new round of questions. Follow-up rounds are not limited by the
6-round cap of the first interview. The feature is not Ready again until a round has asked about each
rejected assumption and the rest is decided. A follow-up round counts for the assumptions it was about even
when Worca has nothing to ask; an ordinary round that comes back with no questions has not asked about
anything.

## After starting

- **Versions.** What a run started with is kept frozen as **v1**, **v2**, ... and never changes.
- **Changed since the run started.** If you edit the spec afterwards, the page lists what changed against
  the last start: goal, sections, criteria and assumptions, old text struck through and new text marked.
- **Undo my changes** puts the spec back to the one the last run started with. New ids are never reused,
  so a criterion you added and undid does not come back under the same number.
- **Start again with v<n>** starts another run from the changed spec; it is enabled only when something
  changed.
- Once a run has started, the feature's project or workspace can no longer be changed.
- Rejecting an assumption and **Done, ask about A-n** still work on a started feature, as before the start.
