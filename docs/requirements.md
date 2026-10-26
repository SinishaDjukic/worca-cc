# Requirements

Turn an idea into a clear, testable feature spec with Worca **before** anything is built. In Labs:
turn on **Requirements** in Settings › Labs (the `requirements` flag), or start Worca with
`WORCA_FLAGS=requirements`. With the flag off the page, its routes and its live updates are all gone.

## How it works

1. **New feature** on the Requirements page: a title, a few sentences, and the project or workspace it is for.
2. **Worca looks at the code once** (a read-only temporary copy, removed straight after) and writes, in
   plain words, what already exists in that area. You see it under *What Worca found in the code*;
   **Look again** (in the **⋯** menu) refreshes it. With a [product brief](#product-brief) for the project or
   workspace, a new feature skips this look and shows *What Worca knows* instead. Turn looking at the code off
   per project or workspace in **Your notes for Worca** (also in **⋯**).
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

Nothing is built until you press **Start in Worca** (below). Each look and round is one model call; its cost is shown on the
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
features use it, what Worca read, and your notes. The list has a header only for a project or workspace with a
feature, so before the first feature the brief page opens only from its address
(`#requirements/brief/project/<key>` or `#requirements/brief/workspace/<id>`).

**Create and Refresh.** **Create the brief** (and later **Refresh**) is one deeper, read-only look at the
repository's **default branch** (main, for most), not at whatever branch happens to be checked out, so the brief
describes what the product is and not a half-finished change (only when no default branch can be found does Worca
read the checked-out branch). Once there is an estimate, the cost is shown before you press the button; the estimate is
the median of recent brief looks, failed ones included, project and workspace briefs alike (before the first
brief look there is none). A brief look is a model call like any other here: it counts toward your spending
limit and takes a few minutes, and you can leave the page while it works; the page says when the brief is ready
or could not be made. Worca refuses it, and spends nothing, when looking at the code is switched off, when git is not installed, when there
is no repository or default branch, when a repository could not be read in time (Worca names it; try again), when
this brief is already being made, when two other briefs are being made, or when the limit is reached.
Without git on this machine, Create, Refresh, Look closer and Look again are not offered (the API answers 409
`GIT_MISSING`); a new feature then skips its look at the code and the interview starts right away.

**Your edits win.** Edit any part with the pencil; Worca keeps your text and a refresh never overwrites it
(**Let Worca rewrite this** hands a part back). Each user, word and area needs its own name: a name given twice
is refused, and your text stays in the editor to fix. Editing **What exists today** makes the areas yours: a refresh
no longer updates them, and "the code moved on" no longer checks them. Areas added from a closer look (below)
survive a refresh too.

**Staleness.** A brief says what it was made from, for example *Made from main @ 3f96738*. When the default branch
has moved, the page says **The code moved on since this brief**: how many commits since, and which of the areas
it describes they touch (areas are matched by the files they name). Interviews keep using the brief as it is
until you refresh. Where Worca cannot tell, it says so and why: the project's folder is missing, the commit is
no longer on the branch, the branch cannot be found, or checking took too long (for a workspace brief, also that
none of the projects it was made from is in the workspace any more). A workspace brief also names projects it
did not check or that joined after it was made.

**Your notes for Worca.** Standing facts every feature there should know (actors, terms, rules) and the switch
for looking at the code. It is opened from the brief page or from **⋯** on a feature.

**How interviews use it.** With a brief, a new feature skips its own look at the code: the New feature page
says "Worca knows <name> from its product brief" and the cost is cents per round, and round 1 starts right
away. The feature page shows *What Worca knows*. When the brief is not enough, **Look closer** makes one look at
the code for that feature (its cost is shown first). **Add this to the brief** then keeps what it found as a new
area named after the feature ("Orders: <feature title>"); it never replaces an area that is already there. A
closer look is not part of the brief until you add it, and only a look made for the feature's current project
or workspace, against its current brief, can be added (otherwise **Look again** first). With looking at the code
switched off, interviews still read an existing brief; only new looks (Create, Refresh, Look closer) stop.

**Workspaces.** A workspace brief starts from the workspace's own description (its map of projects) and reads at
most 8 of its projects, each at its default branch; any left out are named on the page before you create it.

**Documents.** A made brief can keep documents (a style guide, a glossary, a policy) that every feature there uses;
see [Documents on the brief](#files) below. Deleting the brief deletes its documents too.

## Files

A feature can come with material: emails, support tickets, a spec, screenshots, a mockup. Add up to 10 files to a
feature, on **New feature** or later on the feature page's **Files** card: text (`.md`, `.markdown`, `.txt`, `.csv`,
`.json`, `.log`, `.html`, `.htm`), images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) and PDF, up to 25 MB each (on
New feature, up to 100 MB in all; add more on the feature page). Word, Excel and PowerPoint files are not read yet:
save them as PDF. A file with the same content as one already attached is refused and names that one.

**What Worca reads.** Worca reads each file once, when it is added, with the interview model, and writes down what it
took from it. Every interview round uses that, and the full text of text files while they stay within 24 KB in all.
A feature created with files reads them first: the page says **Reading N files…**, then shows round 1. You can edit
what Worca took from a file; your text wins, and Worca never overwrites it without asking. **Ask about this file…**
has Worca read the file again for one question; the answer is kept under the summary (one question at a time, up to
20 answers; the file says **Asking…** meanwhile). **Replace with a newer version…** keeps the file's place and its
switch, and asks whether to keep your text when you edited it; **Read again** reads the same file again. Earlier
texts are kept in the file's history (**Earlier text**, in Advanced mode). A file that could not be read says why
("it ran out of time", "Worca restarted", …) and offers **Try again**; until then the interview knows it by name only.
Files cannot be changed while Worca works on the feature, while it is archived or while a run starts. When a new
version cannot be stored, the file says "Worca could not store the new version. Replace it again." and cannot go with
the run until it is replaced. When New feature cannot store one of its files, the feature is still created and its page
names the file: "<name> was not added: Worca could not store it. Add it on the feature page."

**What it costs.** A read costs a few cents (about $0.05–0.20; each file says what its reads cost) and counts toward
your spending limit. When the limit is reached, a new file waits as **Not read yet**, at no cost, and is read
at the next round once the limit allows, or when you press **Read again**. Worca reads at most two files at a time;
the others wait as **Reading…**.

**Privacy.** Worca sends each file to the interview model to read it. Text is checked for keys and passwords first;
images and PDFs go as they are. A read can open only its own copy of the file: a guard refuses any other file and any
other tool, so a file that asks the reader to open something else gets nowhere. Worca keeps a record of what the guard
allowed, and throws away a read it cannot confirm ("Worca stopped this read: it could not confirm the read stayed
inside this file. Try again."). Every read, every question and the product brief's look also refuse private files
(keys, credentials, Worca's own data, other chats and stored files), as Ask Worca does. Reads, questions and the
brief's look also ask Claude Code to keep no session transcript of the call (`--no-session-persistence`), so the file
itself is not left in Claude Code's own session logs. Interview rounds and looks keep Claude Code's usual session logs
(under its `projects` folder, until Claude Code's own cleanup), and those hold what a round's prompt carries: what
Worca took from each file and the text of small text files. Remove deletes the file and what Worca took from it from
Worca; it does not reach Claude Code's logs. Where the files are kept: [storage.md](storage.md).

**Testing.** In mock mode (`WORCA_MOCK=1`) nothing is sent: a read writes a `[mock]` summary at once, or after
`WORCA_MOCK_READ_MS` milliseconds when that is set (the browser proof uses it to see "Reading N files…").

**When a file changes the interview.** During the interview the next round uses a new or replaced file. After the
interview finished, Worca asks about it in one short follow-up round; until that round has run, the feature shows
**Decide** and the interview check says "<file> to ask about". A feature that is busy gets its follow-up as soon as its
current round or look ends. When Worca cannot start the round itself (the feature was archived, Worca is already
running four interviews or looks, or the spending limit is reached), the Decide panel offers **Ask about <file>**.
After you started a run, a change to the files counts as a change since the start.

**Sources.** A criterion, an assumption or a question that came from a file names it, on the page, in the Markdown and in
the run's task ("(from <file>)").

**Files and runs.** A file goes to the run only when you switch on **Send with the run** (also on the **Ready to build**
card's **Files for the run** row, whose chips are the same switches). The run gets it as an attached file, and the
started version records which files went with it. A file whose stored copy Worca cannot open cannot go with the run:
Start names it, and you replace it or leave it out. The run's copies are named after the files, made safe for Windows
(`: * ? " < > |` become `_`, trailing dots and spaces go, a device name such as `CON` gets a leading `_`, and a name
used twice gets " (2)"); the start keeps the files' own names. The copies Worca stages for a start are removed once the
run has its own copy, or when the start is refused. **Changed since the run started** lists a file that goes with the
run now, no longer goes, or was replaced; **Undo my changes** puts the files' Send switches back, but not a removed or
replaced file, and not the documents' switches.

**Documents on the brief.** A made Product brief has a **Documents** card: every feature of that project or workspace
uses its documents from its next round. **Send with every run** adds a document to every run started from a feature
there. The brief's own sections change only when you refresh it.

## Ask Worca

**Ask Worca** in a feature's header opens a chat about that feature beside the spec. On a wide screen it takes the right
column, and **Ready to start?**, **Files** and **Spec** move under the question card until you close it; on a narrower screen it
is a full-screen sheet with **Back**. **Help me answer** on a question of the round waiting for you opens it with that question
in the composer. You send it yourself: every message costs money.

**What it knows.** What the interview already has: the spec, the interview so far, the product brief, your files (what Worca
took from them, and small text files in full) and what Worca found in the code. It has no tools: it reads no code and opens no
file. When that is not enough it says so and suggests **Look closer** or **Ask about this file**.

**Drafts.** Worca can draft answers to the open questions. A draft fills the question card, marked **drafted by Worca**, with
Worca's reason under the options. **×** puts the question back to the recommended answer, and picking or typing an answer
yourself removes the mark. A draft is never sent by itself: **Submit** sends it like any answer. A draft for a round that was
answered meanwhile is dropped, and the reply says so.

**Proposed changes.** Worca can propose spec changes as cards: set a section to a new value (the card shows the lines that
change), add, reword or remove an acceptance criterion, or confirm or reject an assumption (it never rewrites an assumption's
text). Nothing changes until you press **Accept**: the change is then your own edit, so later rounds never overwrite it, after
a start it shows under **Changed since the run started**, and **Undo my changes** undoes it like any edit. **Reject** dismisses
a card. When the spec changed since Worca proposed something, the card says so and offers **Ask again**.

**Costs.** Each message is one call to the interview model, booked as Requirements spend: the header's "$X so far" includes
it, it counts toward the spending limit, and each reply shows what it cost. The composer shows the range of the last messages
("about $L–H a message"). **Stop** cancels a reply and keeps your message; a stopped reply may be booked low, or at $0, because
a call's cost is known only once the model reports it.

**The chat and the interview.** The chat never feeds the interview rounds, and it never holds the interview up: while Worca
answers you can submit answers, edit the spec, add files or start a round. Only what you accept or submit reaches the
interview. **Send**, **Accept** and **Clear chat** wait while Worca answers.

**Clear chat** (⋯) deletes the feature's chat; changes you accepted stay in the spec. An archived feature's chat can be read,
not used. Everything here is behind the `requirements` flag.

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
**Ready to build** card offers **Start in Worca**.

You can start before it is Ready: **Start before it's Ready...** asks for a reason, which is required.
Worca keeps the reason, your name and the checks that failed on the feature, and the run is marked as
started before Ready. Open assumptions are then treated as confirmed. Worca refuses it without a reason, and
always refuses a feature that is busy, archived or whose project or workspace is gone.

## Start in Worca

**Start in Worca** starts a normal run from the feature:

- The run's task is the spec, with the acceptance criteria (`R-po-1`, ...) as its definition of done. The
  run title is `FEAT-<n>: <title>`.
- It uses the **Auto** workflow and the project's default branch, unless you change them under **Change** on the
  Ready to build card. Auto picks a workflow for the task and, when the project asks for confirmation, shows
  its pick on the run page for you to accept.
- The files and brief documents whose Send switch is on go with it as attached files ([Files](#files)).
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
