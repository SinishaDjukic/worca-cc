# Requirements

Turn an idea into a clear, testable feature spec with Worca **before** anything is built. Experimental:
turn on **Requirements** in Settings › Labs (the `requirements` flag), or start Worca with
`WORCA_FLAGS=requirements`. With the flag off the page, its routes and its live updates are all gone.

## How it works

1. **New feature** on the Requirements page: a title, a few sentences, and the project or workspace it is for.
2. **Worca looks at the code once** (a read-only temporary copy, removed straight after) and writes, in
   plain words, what already exists in that area. You see it under *What Worca found in the code*;
   **Look again** (in the **⋯** menu) refreshes it. With a [product brief](#product-brief) for the project or
   workspace, a new feature skips this look and shows *What Worca knows* instead. Turn looking at the code off
   per project or workspace in **Your notes for Worca** (also in **⋯**; it was called Project context).
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

## Product brief

A **product brief** is what Worca knows about a project (or a whole workspace) before any feature is
described: a short, plain-language picture that every interview there starts from. It has four parts:

- **What the product does**, in a few sentences.
- **Who uses it** and what each of them can do.
- **The words the product uses**: its concepts and what they mean.
- **What exists today**, area by area, and what only partly exists.

It is written in product language, without code. The Requirements list shows it on each project's header
("Product brief: none yet · Create", or its age); the brief page has the four parts, who made it, which
features use it, what Worca read, and your notes.

**Create and Refresh.** **Create the brief** (and later **Refresh**) is one deeper, read-only look at the
repository's **main branch**, not at whatever branch happens to be checked out, so the brief describes what
the product is and not a half-finished change (only when no main branch can be found does Worca read the
checked-out branch). Once there is an estimate, the cost is shown before you press the button; the estimate is
the median of recent brief looks, failed ones included, project and workspace briefs alike (before the first
brief look there is none). A brief look is a model call like any other here: it counts toward your spending
limit and takes a few minutes, and you can leave the page while it works; the page says when the brief is ready
or could not be made. Worca refuses it, and spends nothing, when looking at the code is switched off, when there
is no repository or main branch, when a repository could not be read in time (Worca names it; try again), when
this brief is already being made, when two other briefs are being made, or when the limit is reached.

**Your edits win.** Edit any part with the pencil; Worca keeps your text and a refresh never overwrites it
(**Let Worca rewrite this** hands a part back). Each user, word and area needs its own name: a name given twice
is refused, and your text stays in the editor to fix. Editing **What exists today** makes the areas yours: a refresh
no longer updates them, and "the code moved on" no longer checks them. Areas added from a closer look (below)
survive a refresh too.

**Staleness.** A brief says what it was made from, for example *Made from main @ 3f96738*. When the main branch
has moved, the page says **The code moved on since this brief**: how many commits since, and which of the areas
it describes they touch (areas are matched by the files they name). Interviews keep using the brief as it is
until you refresh. Where Worca cannot tell, it says so and why: the project's folder is missing, the commit is
no longer on the branch, the branch cannot be found, or checking took too long (for a workspace brief, also that
none of the projects it was made from is in the workspace any more). A workspace brief also names projects it
did not check or that joined after it was made.

**Your notes for Worca.** Standing facts every feature there should know (actors, terms, rules) and the switch
for looking at the code. This is what was called *Project context*. It is
opened from the brief page or from **⋯** on a feature.

**How interviews use it.** With a brief, a new feature skips its own look at the code: the New feature page
says "Worca knows <name> from its product brief" and the cost is cents per round, and round 1 starts right
away. The feature page shows *What Worca knows*. When the brief is not enough, **Look closer** makes one look at
the code for that feature (its cost is shown first). **Add this to the brief** then keeps what it found as a new
area named after the feature ("Orders: <feature title>"); it never replaces an area that is already there. A
closer look is not part of the brief until you add it, and only a look made for the feature's current project
or workspace, against its current brief, can be added (otherwise **Look again** first). With looking at the code
switched off, interviews still read an existing brief; only new looks (Create, Refresh, Look closer) stop.

**Workspaces.** A workspace brief starts from the workspace's own description (its map of projects) and reads at
most 8 of its projects, each at its main branch; any left out are named on the page before you create it.

## Which model interviews

The newest Opus at medium effort, unless **Requirements interview** on Models › Engines › Claude › Helper
jobs says otherwise. A model picked with no effort runs at that model's own default effort. A model removed from the catalog
falls back to the default model but keeps a stored effort. The New feature page
names the model and effort ("Worca interviews with …").

## What a look or round loads

Worca's own instructions, not Claude Code's coding-agent ones, and none of your user-level Claude Code
plugins, hooks, skills or settings. The look's temporary checkout still loads the project's own
`.claude/settings.json` hooks and `CLAUDE.md`.

One exception: when your user-level Claude Code settings (`settings.json` in `~/.claude`, or in
`CLAUDE_CONFIG_DIR`) hold your sign-in or network setup, Worca keeps them for interviews so the sign-in
keeps working. That means an `apiKeyHelper`, `awsAuthRefresh` or `awsCredentialExport`, or an `env` block
with `CLAUDE_CODE_OAUTH_TOKEN`, any `CLAUDE_CODE_USE_*` (Vertex, Bedrock, Foundry), `AWS_*`,
`CLOUD_ML_REGION`, `GOOGLE_APPLICATION_CREDENTIALS`, `CLAUDE_CODE_CLIENT_CERT` / `CLAUDE_CODE_CLIENT_KEY`,
your own `ANTHROPIC_*` endpoint, `HTTP_PROXY` / `HTTPS_PROXY` or `NODE_EXTRA_CA_CERTS` (Docker's
compose-secret setup is one). A settings file that exists but cannot be read or parsed is kept too; a missing or blank
one, or one that is not a JSON object, means the hermetic call. Worca says so once in its log ("user Claude
settings carry or may carry sign-in; keeping them for interviews"). Your plugins and hooks then load as they did before; slash commands still do not.

The product brief's look (one deeper read-only look at a project's or workspace's default branch, made from
the Product brief page) is the same kind of call: it runs with the interview's model and effort, Worca's own
instructions, the look's read-only tools, and the same settings rule, sign-in exception included. So an
install whose sign-in lives only in user-level Claude Code settings that Worca cannot recognise fails a brief
look with "Not logged in" exactly as it fails a round.

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
