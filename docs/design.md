# Design

Describe a web page, a presentation, a pitch deck or an HTML and JavaScript video in its own chat, and real
agents build it in front of you. On by default (beta); `WORCA_FLAGS=-design` turns it off, and so does the
**Design** switch in Settings › Labs (the `design` flag). With the flag off the page is hidden and every
`/api/design` route answers 404; what Design already spent stays in Statistics.

## How it works

1. **Design** in the sidebar opens the Library (`#design`): the start composer, and every design you have made as a
   tile. A tile shows a picture of the page (see [Thumbnails](#thumbnails)), its title, its kind, when it last
   changed or what it is doing (**Building**, **Paused**, **Stopped**, **Failed**, **Interrupted**), and what it
   cost.
2. **Describe it** in the composer (*What should we design?*) and pick a kind: **Web page** (the default),
   **Presentation**, **Pitch deck** or **Video**.
3. **Pick a project, if you like.** The lead agent reads the project's brand and code and passes the brand on to
   the agents that build the sections (not on every engine: see [Engines](#engines)). Nothing is written to the
   project. With **No project** the design stands on its own.
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
what it has cost. On Claude, agents only read and write files: no shell commands and no web, unless you give the
lead the web (see [Web access](#web-access)). The lead writes only inside the design's own folder, and each
section's agent only inside its section. Other engines cannot be held to all of this: see [Engines](#engines).

When an agent needs an answer from you, the HUD reads **Needs you**. A usage limit, a sign-in, a quota or a model
error pauses the whole build; **Resume** on the HUD picks it up. A build that is running shows in Activity; a
paused one, or one with a question for you, shows under Needs you. If worca restarts during a build, the build is
marked interrupted and nothing starts again by itself.

## Models

A build has two kinds of agent: the **lead**, which plans the sections and puts them together, and the **builders**,
one per section. Two model pickers pick their models (the gear in the composer and in the chat opens them), and they work as the Chat
model picker: **Lead** `Opus 5.5` `high` and **Builders** `Sonnet 5.5` `medium`. Each opens a menu with **Default**,
the models the design's engine runs (**More models** for the rest), and **Effort**.

**Default** is, in this order:

1. The **Design lead** or **Design builders** row of the design's engine on the Models page (Engines card, Design).
2. The model role: **Deep thinking** for the lead, **Everyday coding** for the builders.
3. The engine's own default model.

Its effort is `high` for the lead and `medium` for the builders unless the row or the role names one.

A pick in a picker belongs to that design. It applies from the next round: a round that is running keeps the
models it started with. The start composer offers the models of the engine the design will build on; if the engine
dialog moves the design to Claude, its picks are dropped and Default applies.

## Build fast

**Build fast** is a switch behind the gear in the composer and in the chat, under the model pickers. It sets how many agents build sections at once:

- **Off:** at most 3. The chat's label reads `up to 3`.
- **On:** at most 12, and the label reads `up to 12`. On a [hosted](#hosted) worca it is at most 6, and the label
  reads `up to 6`.

On a web page it also lets the lead plan more sections (16 to 32 instead of 4 to 8).

It can change in the middle of a build. The new number applies to the next agent that starts; it never stops a
running agent. `WORCA_DESIGN_MAX_BUILDERS` sets the number for Build fast on: a whole number from 1 to 40, and a
larger one counts as 40. Build fast off is then the smaller of 3 and it.

Across all builds, at most 24 agents run at once on one worca, and `WORCA_DESIGN_MAX_AGENTS` (a whole number from 1
up) sets that number. Any other value of either variable leaves its default. At that limit a new round or a
**Resume** is refused (*worca is running 24 agents, its limit: try again when one ends.*), while a build that is
already running waits for a free agent before it starts its next section.

## Engines

A design builds on the **Default engine** (Models page, Engines card, or its project's own) as it is when the
design is created. Claude runs as is. Every other engine needs **Allow unguarded** when a design is created, once,
because it cannot be held to worca's rules. When you send, a dialog names the engine and what it cannot hold:
**Allow unguarded** creates the design on that engine anyway, **Use Claude** creates it on Claude, and **Cancel**
creates nothing.

- **Codex** keeps its shell, which it reads files with, so its agents can read anything on this machine. Its sandbox
  holds their writes to their own folder.
- **Cursor** cannot fully turn its shell off.
- **Gemini CLI**, **Qwen Code** and **OpenCode** run with their shell and web tools off, but cannot be limited to
  Design's tools. With [Web access](#web-access) on, the lead's web tools stay on.
- **Copilot** reports no cost and cannot fully hold the rules.
- **OpenCode** needs a model set first: a lead and a builders model for OpenCode (the design's pickers, the
  Models page's Design rows or the roles, see [Models](#models)), or `WORCA_OPENCODE_ALLOW_DEFAULT_MODEL=1` to let it
  run its own default.
- **Goose** cannot be used: it cannot be held to one folder or kept from running commands, so it has no **Allow
  unguarded**.

A design keeps its engine: a later change to the Default engine does not move it. Every new round and every
**Resume** checks it again without asking again, so an engine worca no longer allows, a missing sign-in or a
missing model stops the design there.

Engines other than Claude show files as they land on disk, and have no per-process spend cap: worca checks spend
between their processes. Copilot, Gemini CLI, Qwen Code and Cursor show `cost unknown`, so worca's spend limits
cannot stop them. Copilot, Gemini CLI, Qwen Code and OpenCode cannot read the picked project: their lead is not given
its path, and the dialog says so.

## Web access

Off by default. **Settings**, the Ask Worca card, **Design: let the lead use the web** turns it on for every
design, on every engine; a build reads the switch each time it starts or resumes.

With it on, the **lead**, and only the lead, can:

- **search the web and read pages** with its engine's own web tools (Claude's web search and fetch, Gemini's,
  Codex's web search, and so on). An engine or model without web tools gets none from worca: a Claude model served
  through a translated bridge has no search or fetch.
- **save pictures** with `save_image`, a tool worca gives it on every engine. worca downloads the file, not the
  agent: https only, never an address on a private or local network, PNG, JPEG, GIF, WebP, AVIF or SVG by the
  file's own bytes, at most 8 MB each and 64 MB and 120 files per design. A picture lands in `work/assets/web/`
  as a new file, and the page points at it as `assets/web/<name>`.

Section agents stay offline: the lead tells each one which saved pictures to use. A finished design still loads
nothing from another site, so every export works offline as before. Each download, refused ones too, is one line
in `<worca home>/logs/design-web.jsonl`.

What it costs you in safety: the lead can read the picked project and reach the internet in the same session. A
web page it reads could talk it into putting project content into a search or an address. The files Design never
reads (keys, `.env` files) stay unreadable, but ordinary source is not protected. Leave the switch off for a
project whose code must not leave the machine. worca cannot check that you may use a picture: that stays with you.

## Decks and video

**Presentation and Pitch deck.** One section is one slide, 1920 by 1080. While a round builds, every slide is a
tile on the stage. When it finishes, the stage shows one slide with a rail of the slides: click a slide in the rail,
or press the arrow keys inside the slide. The **Standalone HTML** export is the deck on its own: it opens offline,
with its own slide rail, and the arrow keys, Page Up, Page Down and Space move between slides.

**Video.** An HTML and JavaScript film. One section is one scene, 1920 by 1080 at 60 frames a second, and each scene
has its own length in seconds. While a round builds, every scene is a tile, with a timeline of the scenes. When it
finishes, the stage shows the film with play, pause and a scrub bar. The **Standalone HTML** export plays on its own,
offline: it starts by itself unless the system asks for reduced motion, Space plays and pauses, and the arrow keys
step one second.

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
| `work/` | What the agents write: the sections, the shared files, your attachments and the pictures the lead saved from the web (`assets/web/`) |
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

## Hosted

A hosted worca is one that people reach over the network through an identity proxy, with remote access on (see
[Remote access](remote-access.md) and [Railway](deploy-railway.md)). A worca in your own Docker container keeps the
numbers of one machine.

- **Build fast** runs at most 6 agents at once there, and its label reads `up to 6`. Off, it stays at 3.
- **One build per person.** A second one is refused (*You already have a build running: stop it or wait for it.*).
- **At most 24 agents on the server**, across everyone's builds, as under [Build fast](#build-fast).
  `WORCA_DESIGN_MAX_BUILDERS` and `WORCA_DESIGN_MAX_AGENTS` change these numbers there too.
- **Each person sees only their own designs.** Each design's folder is shared with its owner's agent only (with
  [agent users per person](credential-broker.md#agent-users-per-person)), which can change the design's files in
  `work/` but not the folder around them, and cannot open `dist/` or `versions/`.
- **Each agent is billed to the person** who started its round or pressed **Resume**.
- **The preview embeds its files.** Behind an identity proxy the page carries its CSS, fonts and images inside it
  (`WORCA_DESIGN_PREVIEW_INLINE`), so the frame asks the proxy for nothing else. A file too large to embed stays a
  link, and an image that lands during a build shows at the round's end. `WORCA_DESIGN_PREVIEW_INLINE=0` turns this
  off, and `1` turns it on anywhere. Any other value leaves the default.
- **PDF and thumbnails** need the `-full` image, which has Chromium (see [Mac, Linux, Windows](#mac-linux-windows)).
