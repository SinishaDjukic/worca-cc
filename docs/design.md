# Design

Describe a web page, a presentation, a pitch deck or an HTML and JavaScript video in its own chat, and real
agents build it in front of you. In Labs: turn on **Design** in Settings › Labs (the `design` flag), or start
worca with `WORCA_FLAGS=design`. With the flag off the page is hidden and every `/api/design` route answers 404;
what Design already spent stays in Statistics.

Builds run on Claude for now.

## How it works

1. **Design** in the sidebar opens the Library (`#design`): the start composer, and every design you have made as a
   tile. A tile shows a picture of the page (see [Thumbnails](#thumbnails)), its title, its kind, when it last
   changed or what it is doing (**Building**, **Paused**, **Stopped**, **Failed**, **Interrupted**), and what it
   cost.
2. **Describe it** in the composer (*What should we design?*) and pick a kind: **Web page** (the default),
   **Presentation**, **Pitch deck** or **Video**.
3. **Pick a project, if you like.** The lead agent reads the project's brand and code and passes the brand on to
   the agents that build the sections. Nothing is written to the project. With **No project** the design stands on
   its own.
4. **Attach files** with the button, by pasting or by dropping them: pictures, a logo, notes. A file worca does not
   take is named under the composer.
5. **Send.** The design opens in its own chat. Its title is the first line of what you wrote (the first sentence,
   at most 60 characters); no model names it. **Rename** and **Delete** are in the **⋯** menu of the chat head.
   Delete is off while a build runs; it removes the design's files and chat, and what it cost stays in Statistics.

Then the build:

- **The lead plans** the page and writes the shared files.
- **One agent per section** builds it. A web page gets 4 to 8 sections (16 to 32 with Build fast), a deck one
  section per slide and a video one per scene, at most 40.
- **The lead goes over the result** once more and fixes what does not fit together.

Every cursor on the page is a real running agent, and the agents panel lists each one with what it is doing and
what it has cost. Agents only read and write files: no shell commands and no web. The lead writes only inside the
design's own folder, and each section's agent only inside its section.

When an agent needs an answer from you, the HUD reads **Needs you**. A usage limit, a sign-in, a quota or a model
error pauses the whole build; **Resume** on the HUD picks it up. A build that is running shows in Activity; a
paused one, or one with a question for you, shows under Needs you. If worca restarts during a build, the build is
marked interrupted and nothing starts again by itself.

## Build fast

**Build fast** is a switch in the composer and in the chat. It sets how many agents build sections at once:

- **Off:** at most 3. The chat's label reads `up to 3`.
- **On:** at most 12 (6 on a hosted worca), and the label reads `up to 12`.

On a web page it also lets the lead plan more sections (16 to 32 instead of 4 to 8).

It can change in the middle of a build. The new number applies to the next agent that starts; it never stops a
running agent. On one machine at most 24 agents run at once across all builds. `WORCA_DESIGN_MAX_BUILDERS` (a whole
number from 1 to 24) sets the number for every build, whatever the switch says.

## Changing it

Ask for a change in the same chat: once the design has a round, the message box reads *Ask for a change*, and
worca builds the change as a new round over the current page.

- **Point at the page** (the cursor button in the chat), then click an element on the page: it is pinned to your
  next message, so you can say "make this bigger". Point again for another pin, up to 6.
- **Back to before this** on a round's row in the chat returns the page to how it was before that round, after
  asking. It is there for a round that finished, stopped or failed, while no build is running and while that
  earlier state is still kept (worca keeps the last 20). Going back shows in the chat as *Back to before round N*,
  and the next change starts from there.

## Cost

- **Live:** the HUD shows what the round has cost so far, and the agents panel shows each agent's cost (`≥$1.20`
  while it is still an estimate). A finished round's row in the chat says what it cost.
- **No limit of its own.** Design spend counts toward worca's **Total cost limit** and **Per-pipeline cost limit**
  in Settings › Runs › Budget & cost limits (for Design, the per-pipeline limit applies to each round), and toward
  a team policy's caps. A build that reaches one pauses: raise the limit there and press **Resume**. Resuming
  while the total limit is still reached is refused.
- **Statistics:** Design spend is part of **Spent**, in Statistics and in the account menu, with its own **Design**
  row in Group by and in the Cost report. It stays there after a design is deleted and after the flag is turned
  off.
- **Unknown cost:** where an engine reports no cost, the figure reads `cost unknown`, never `$0`.
- The figure is what the CLI reports, so a title call the CLI makes on its own is inside it when it makes one.
  worca itself makes no title or suggestion call in a design chat.

## Export

Export is there once a round has finished: **Export** in the stage head, or on the HUD when the build ends. While a
round runs, or after one was stopped or failed, it comes back with the next finished round or with **Back to before
this**. While **Back to before this** is restoring, or a chat message is starting a round, worca refuses an export:
try again in a moment. An export always holds one round, even if a new one finishes while it downloads. Exports never
change the design.

| Format | What you get |
|---|---|
| **Standalone HTML** | One `.html` file. The page's own files, pictures included, are put inside it, so it opens without the design folder. Addresses on the web stay links. A file over 25 MiB, or one past 100 MiB in all, is left out. |
| **Zip of the folder** | The finished folder as a `.zip`, inside one top folder named after the design, so unzipping does not scatter files. |
| **PDF** | Decks only: **Presentation** and **Pitch deck**, one page per slide. On a web page the item is disabled and reads `Decks only`; a video has no PDF item. Needs Chrome or Edge on the machine, or `WORCA_CHROME` set to one. |
| **Copy into a project** | The finished folder, copied into a folder of a project you pick (by default `design/<name>`). |

Files are named after the design's title, in lower case: "Q4 roadmap review" exports as `q4-roadmap-review.zip`.

**PDF.** Only worca's own slide script runs while printing, never the code the agents wrote, so anything a slide
draws with JavaScript is missing from the PDF. If the PDF's page count does not match the slides, nothing is saved
and the dialog says so.

**Copy into a project:**

- Never into `.git` (nor `.git.`, `.git ` or `git~1`). Other dot folders, such as `.github`, are fine.
- Never through a link that leads out of the project or into `.git`, and never onto a link, or onto a folder where a
  file goes. If someone puts a link in the way, or points a link on the way at another folder, while the copy runs,
  it stops there and says how many files it copied. A file whose copy failed half way is not left behind. On a drive
  without hard links (FAT, exFAT, some network shares), a file another program writes at that name meanwhile is kept,
  and the message says where it is now.
- Never over a file without asking: when files already exist, nothing is written. The dialog lists them, and
  **Replace these files** overwrites just those, in the folder they were found in. If the list changed meanwhile (a
  newer round, another file turned up, or a link on the way now leads to another folder), nothing is written and the
  dialog shows the new list to confirm. If no file is in the way any more, the copy goes ahead.
- No commit: the copied files are left for you to review and commit.
- Folder names follow Windows rules on every OS (no `CON` or `NUL`, no `<>:"|?*`, no trailing dot or space), since
  a project may be opened on Windows.

A quick, clean export just downloads. The dialog opens when the file takes more than a moment, when worca refuses
(it says why, with **Try again**), or when something could not go into the file: it lists those under **Left out of
the file** (not found, outside the design, too large, or on the web and left as a link), and the file still
downloads.

A video exports as HTML and JavaScript, standalone or zipped; MP4 is later.

## Thumbnails

A tile's picture is drawn with Chrome or Edge, with every script removed, so the agents' code never runs on
worca's machine. It shows the top of the finished page. Pictures are made when you open the Library, for a
finished design that has none or whose picture is older than its last round, so a new one can appear a moment
after the Library opens. Without Chrome or Edge, and for a design that has no picture yet, the tile shows the
kind's icon.

`WORCA_CHROME=none` turns both thumbnails and PDF off.

## Where files live

Each design is a folder, `<worca home>/design/<id>/`, where `<worca home>` is the folder that holds worca's
database and store (see [Storage](storage.md)). No git is needed.

| Inside | What it holds |
|---|---|
| `work/` | What the agents write: the sections, the shared files and your attachments |
| `dist/` | The finished page; exports read it |
| `versions/` | The state after each finished round, the last 20, for **Back to before this** |
| `thumb.png` | The Library picture; never exported, and agents cannot write it |

## Mac, Linux, Windows

Design works on all three. Thumbnails and PDF look for Chrome in this order and take the first one found:

1. `WORCA_CHROME`: a path to Chrome or Edge, or `none` for no Chrome. A path that does not exist is skipped.
2. On `PATH`: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge` (with
   `.exe` on Windows).
3. Mac: Google Chrome, Chromium, then Microsoft Edge in `/Applications`.
4. Windows: `Google\Chrome\Application\chrome.exe`, then `Microsoft\Edge\Application\msedge.exe`, under Program
   Files, Program Files (x86) and your local app data folder.

Linux looks on `PATH` only. In [Docker](docker.md) only the `-full` image has Chromium; on the slim image tiles
show the kind's icon and PDF is refused inside its dialog.

On Windows, a copy whose target path would pass 259 characters is refused, and the message names the file. On
every OS, closing the tab during a PDF stops Chrome and every process it started.
