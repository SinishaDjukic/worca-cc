# Unreleased

Notes on merged features that have no release page yet. `/worca-changelog` folds
them into the next page and empties this file.

## Protected files stay protected on Windows

**On Windows, `.env` files, `secrets.json` and Worca's own data are now refused by Worca's file tools and by Gemini and Cursor runs.**

Worca's rules for files protected wherever they sit (`.env*`, `secrets.json`, `worca-cc.db*`, the `.worca-cc` store, logs and settings) never matched a Windows path, because a Windows path starts with a drive letter. They now match `C:\…` on any drive, network shares, and long paths such as `\\?\C:\…`. The rules for your home folder (`.ssh`, `.claude`, `AppData` and the rest) match those forms too.

- **Worca's own file tools:** chats on every harness other than Claude Code, and Requirements code looks, Night analysis and the Auto classifier when they run on another harness.
- **Gemini runs:** the rules Worca hands Gemini match either kind of slash, any drive and long paths. They also match a relative path such as `sub\.env`, and either letter case on Windows and macOS.
- **Cursor runs:** Cursor compares a rule with the whole path as Windows writes it, so on Windows Worca now writes its rules with backslashes.

Claude Code chats and runs were not affected: Claude Code applies the same rules itself.

Upgrading: a few Cursor and Gemini rules now refuse more than before, on every platform. On Cursor, a rule relative to the project (`./.env`, `/src/secret.txt`, a bare `*.pem`) used to match nothing; it now refuses that name in any folder. A `?` in a Cursor rule now acts as `*`. On Gemini, a rule for a file at any depth also matches a relative path, and on macOS letter case is ignored.

Chips: Windows · .env and secrets.json refused · Worca's file tools · Gemini and Cursor runs

Pull requests (add each number when it opens):

- Apply the protected-file rules to Windows drive paths (#1526)

## Remotes through an SSH Host alias

**A pull request from a fork cloned through a `~/.ssh/config` alias no longer fails with "Head ref must be a branch".**

A remote such as `git@github-work:me/repo.git`, where `github-work` is a Host alias for github.com, now counts as github.com: Worca asks `ssh -G` for the alias's real host (it reads your ssh config and connects nowhere). Ship-it then opens the pull request from your fork to `upstream` as it does for a plain github.com remote, and an Azure DevOps alias gets its organization and project. git keeps using the URL as written. If ssh is missing or slow the remote keeps its alias host, and Worca asks again next time.

Upgrading: with a fork cloned through an alias as `origin`, Automations now watch the fork instead of `upstream`, as they already did for a fork cloned without an alias.

Chips: ~/.ssh/config Host aliases · ssh -G · fork pull requests · Azure DevOps aliases

Read it: [Git automations](../git-automations.md)

Pull requests (add each number when it opens):

- Resolve ~/.ssh/config Host aliases in remote URLs (#1476)

## Long spec items are kept whole

**A long step, rule or criterion no longer ends mid-word in the spec, the download or the run.**

A spec item (the goal, a main-flow step, a rule, a criterion, an assumption) holds up to 10000 characters instead of 500, and the interviewer is told the limit, so it splits a long item rather than writing past it. Worca used to cut every item at 500 characters when it saved the spec, so Copy, Download, Save to specs/ and the run's task all carried the cut text. If the model still writes past the limit, the item ends at a whole word with "…". Text you type yourself is never cut: past 10000 characters Worca says so and keeps your edit open. Items cut before this fix stay cut; edit them to restore the end.

Chips: 10000 characters per item · the interviewer knows the limit · never mid-word · your text refused, not cut

Read it: [Requirements](../requirements.md)

Pull requests (add each number when it opens):

- Requirements: keep long spec items whole (#1510)

## Copilot on your GHE.com tenant

**Use GitHub Copilot with a GitHub Enterprise Cloud data-residency tenant.**

The Copilot card has a fourth account type, **GHE.com tenant**, and a **GHE.com host** field for `acme.ghe.com`. Sign-in, models, quota and every request then go to your tenant instead of github.com, and the sign-in link shows the tenant's own address. Changing the host signs you out first, after asking, because a sign-in belongs to one GitHub host. The same works from `worca models set copilot accountType=ghe-com enterpriseHost=…` and from Ask Worca. On a hosted instance with an outbound allow policy, worca lets the tenant through for you; the credential broker trusts a Copilot slot's own tenant gateway. When GitHub signs you in but then refuses Copilot access, the card now says so with GitHub's own reason (no more "stored token — sign in again"), and the server log records it.

Chips: GHE.com tenant account type · host field · sign-in on your tenant · signs out on a host change · broker tenant gateway · egress allow added · honest refusal reason

Read it: [Models › Providers](../models.md#providers)

Pull requests (add each number when it opens):

- GitHub Copilot on a GHE.com (data residency) tenant

## Attach Ready features without starting them

**A Ready feature can go into a chat or a run as it is, without Start in Worca.**

**Pull from Requirements** in Chat and New run, and the `#` popover, now offer every feature that is Ready, not only the ones started before. A feature that is Ready when you click Send or Run carries its current spec, read again at that moment, under "FEAT-n (current spec)", and the run does not pause for agreement. A feature that is no longer Ready but was started carries its latest started version, as before. A feature that is neither shows **Not Ready yet** and cannot be attached; attaching still writes no start.

Chips: Ready is enough · current spec at Send or Run · Not Ready yet · no start written

Read it: [Requirements](../requirements.md#pull-from-requirements)

Pull requests (add each number when it opens):

- Requirements: attach Ready features without starting them

## Choose who interviews, per feature

**Pick the harness, model and effort for a feature's Requirements.**

New feature has a **Who interviews** group: Harness, Model and Effort. Rounds, code looks, file reads and Feature chat run on the choice, on Claude, Codex, Copilot, Gemini CLI or another harness Worca can lock down. What a harness cannot do is skipped with a note, never sent to Claude: a code look on a harness that cannot read the repo, a PDF on one that takes text only. Each step names what ran it and its cost (billed, ≈ estimated or cost unknown), and the **so far** chip opens **Cost of this feature**. The model chip changes a running feature from the next step, with a confirm when the switch loses something. The code look shows as a step with **Show what it found**, and the Product brief has **Who makes it** and **⋯ › Refresh the brief**.

Chips: harness, model and effort · Cursor never offered · skipped with a note · cost billed or ≈ · code look as a step · brief per choice

Read it: [Requirements](../requirements.md#choosing-the-harness-and-model)

Pull requests (add each number when it opens):

- Requirements: choose the harness and model per feature and per Product brief (#1234)

## Shaper keeps going while you're away

**You answer what to build. Away mode handles how to build it.**

A sliced feature no longer stops at every plan while you are away. Away mode approves a slice outline and a plan whose checks passed, at once with a zero delay, and a later slice with **Ask me before each run** off continues the way it does when you are here. Clarify, the Requirements hold, a failed check, the planner's outline change and notes from the chat still wait for you, with no countdown. A requirement or plan concern is approved with the agreed text kept, and flagged *please check*. Every approval is a rule, costs nothing and reads `by Away mode` in the feature's log. This applies to anyone already using Away mode: *Never on this run* or pausing Away keeps a plan waiting, and a spend cap is worth setting, since a feature can now be built with no plan seen by anyone. `--yes` is unchanged.

Chips: outline and plan approved · concerns flagged · what to build still waits · no decider cost · marks reach later slices

Read it: [Shape it first](../shape-it-first.md)

Pull requests (add each number when it opens):

- Shaper keeps going while you're away

## Ask me before each run asks before each run

**Ask me before each run** on a slice outline now means what it says: with it on, each later run waits, not started, and the feature card shows *Needs you · Run 2 waits for you to start* with **Start now**. A later slice's plan continues by itself when its checks pass, either way. Away mode keeps a held run held.

Read it: [Shape it first](../shape-it-first.md)

## A lighter Requirements card

**The Shaper's Requirements card now says what each persona wants, and why.**

The decisions come first, with their answers stacked under each question, and an answer a perspective asked for carries its reason: `Security: emails are personal data, and exports get forwarded`. The agreed requirements fold into one line, `8 agreed · Product 2 · Engineering 1 · …`, and open grouped by perspective with your own first; ids move to the tooltip and to screen readers. The disc, the question numbers, the `Answered` pill and `Worca's picks marked` are gone. When a requirement fails its check, the fold opens by itself with that row first and **Ask for changes** becomes the primary. While the field is open, **Send changes** is the only primary. It reads the same in the chat run card, on the run page and on the feature page.

Chips: decisions first · persona and reason · agreed fold · grouped by persona · one primary · three hosts

Read it: [Shape it first](../shape-it-first.md)

Pull requests (add each number when it opens):

- A lighter Requirements card

## Set your roles once

**Pick your models in the setup assistant. Everything else follows.**

Your roles now beat Worca's own defaults. Shaper's role reviews use your role, not the built-in Sonnet 5.5. Every engine has roles now, Copilot CLI and the other beta engines included. The setup assistant shows roles for Claude and each engine it finds ready. The workspace scan runs on your Everyday tasks role. Create workspace saves no model of its own unless you change one, so its re-scans follow your roles. Old workspaces no longer ask for a model on every re-scan. The sub-agent picker says which Claude model each choice runs: sub-agents do not follow your roles yet.

Chips: roles first · every engine · setup assistant · workspace scan · no re-scan prompt · honest sub-agent labels

Read it: [Model roles](../models.md#model-roles)

Pull requests (add each number when it opens):

- #1153 Set your roles once

## Built-in workflow models live on the Models page

**Shaper runs on a Copilot-only install that is not signed in to Claude Code.**

The built-in workflows no longer pin first-party Claude models. Each model they used is now a factory default on the Models page: a new **Second-opinion reviewer** helper job for Shaper's Product reviewer (Opus 5.5 · medium) and Memory defragment (Sonnet 5) show theirs as "(default)", and the Plan Review and Requirements Review step rows name theirs in the hint (Sonnet 5.5 · medium, role reviews only). When Claude Code is signed out, a factory default that needs the sign-in is dropped: the step uses your role, the run's model or Claude's default, and the run log says so once per setting. When the second opinion has no other model, it runs at another effort. A model you set is never replaced: if it needs the sign-in while signed out, the start is refused, naming the setting and the model.

Chips: Models page · factory defaults · Second-opinion reviewer · signed out · one warning per setting · refused, never replaced

Read it: [Built-in workflows take their models from the Models page](../models.md#built-in-workflows-take-their-models-from-the-models-page)

Pull requests (add each number when it opens):

- Built-in workflow models live on the Models page

## The assistant works with your tool panel tabs

**Chat can open, look at and read the Browser tabs beside it.**

In a chat with a project, the assistant can open a tab for you (`open_tab`: a local preview, an allowlisted site, a Terminal, Files or Changes tab), marked as opened by the assistant. It can screenshot a Browser tab into its reply (`screenshot_tab`) and read the page's text and console errors (`read_tab`), from a fresh headless load on the Worca server. It reaches only this chat's tabs and its project's, and other sites follow the chat's web allowlist. **Pick element** in the Browser tab's toolbar puts a screenshot of the element you click, and its selector, into the chat composer.

## The tool panel opens on an Overview

**A run, chat or project shows what it holds before you pick a tab.**

The tool panel's first icon is the Overview: for a chat, its project and model, its context window (also from the composer's meter), the runs it started with their pull requests, the files it showed and saved, and the commands and Actions still running, each with Stop. A run shows its status, branch, checkout, pull request and artifacts; a project its recent runs. The **+** page still opens a new tool.

Pull requests (add each number when it opens):

- Tool panel Overview

## Chat file cards open in a tab

**With "Open chat links in the panel" on, a file the chat showed opens in a Files tab.**

A click on a file card's name opens its stored copy in a Files tab of the chat, and its small icon becomes **Quick look** (the pop-up). Images keep the pop-up and get **Open in panel**. A file that is already open comes forward instead of opening twice. With the setting off, every card opens the pop-up as before.

## Chat links open in the tool panel

**File paths and web links in the chat's answers open in tabs beside the chat.**

A file path the chat names (`src/app.js:120`, or a bare `app.js` when only one file has that name) becomes a link once worca confirms it exists in the chat's folder or followed run, and opens a Files tab at that line; an archived run's files open from its branch. Web links open in a Browser tab of the chat, unless the site refuses being framed: then they open a new browser tab inside the click, and a server-side check spots sites that refuse. The assistant can open files too (`open_tab` with a path and line, 3 per turn), and an open file or address is brought forward instead of opened twice. A `show_files` card gains **Open in panel**. Settings › Chat › Links in answers turns it off.

Chips: file links · web links · open_tab files · framing check · Open in panel · Settings › Chat

Read it: [Terminal › Links from the chat](../terminal.md#links-from-the-chat)

Pull requests (add each number when it opens):

- Chat links in the tool panel (issue 1064)

## Requirements (experimental)

**Define a feature with Worca before anything is built.**

A product owner describes a feature in a few sentences and Worca interviews them, a few questions at a time, into a testable spec: goal, actors, flow, edge cases, rules, acceptance criteria and assumptions. Six checks say when it is Ready, and **Start in Worca** starts a normal run with the spec as its task. A product brief, made once per project or workspace from its default branch, lets every interview there start from what the product already does; edits to the spec or the brief are kept. A feature can come with files (emails, tickets, a spec, screenshots): Worca reads each once, the interview uses what it took from them, and the files you switch on go to the run. **Feature chat** beside a feature answers from what Worca already knows about it, drafts answers to the open questions and proposes spec changes as cards; nothing changes until you submit or accept, and each message shows what it cost. A feature can be exported to the team's tracker (Jira first) as a ticket: a preview shows exactly what is sent, **Export again** updates the ticket or comments on it, and a run started from the feature reports back to the ticket. A feature can also start from a ticket: **From a ticket…** on New feature takes its title, description, acceptance criteria, comments and the attachments you pick, and the feature stays linked to it (the Jira plugin's 0.2.0 update, which also brings Ticket updates).

Chips: Requirements · interview · Ready · Start in Worca · product brief · Requirements interview model · files · Feature chat · export to Jira · start from a ticket · experimental: turn it on in Settings › Labs

Before a build starts with a workflow, **Start in Worca** opens **Set up this run**: pick a saved run preset and change each agent's model, effort and loop budget for this run only, at any interface level. The reason for starting before Ready is saved the moment you give it, and a started run opens its run page.

Read it: [Requirements](../requirements.md)

Pull requests (add each number when it opens):

- Requirements (#882)
- Requirements: files (#975)
- Requirements: Feature chat (#989)
- Requirements: export to a tracker (#1010)
- Requirements: start from a ticket (#1041)
- Requirements: set up a run before it starts (FEAT-9)

## Ticket updates (experimental)

**Say what a finished run does to its ticket, per project.**

In Marketplace › Installed › Jira, Azure Boards or GitHub Issues › Settings, a saved connection gets **Ticket updates**: the projects you work on and, per project, Don't move, Any Done status or one of that project's own statuses. A run that writes back moves its ticket by that rule, and Worca's comment ends with a line saying what happened. In Jira, Any Done status never closes a ticket as Won't Do or Duplicate, and Worca fills in a required Resolution. A move the tracker refuses becomes a "Not moved" line and the comment still posts; a refused token, a rate limit, a server error or a timeout fails the write-back so it can be retried. Azure Boards moves a work item to its type's Completed state (Resolved is not done yet) or to a state you pick; GitHub Issues closes an issue as completed or as not planned, or reopens it, and a repository is a project. New run and the Requirements export list only the projects you work on. Until you save, each plugin's old setting (**Transition on completion**, **Close work item on completion**, **Close issue on completion**) works as before. Jira needs the plugin’s 0.2.0 update, which also lets a Requirements feature start from a ticket.

Chips: Ticket updates · Jira · Azure Boards · GitHub Issues · projects you work on · Any Done status · experimental: turn it on in Settings › Labs

Read it: [Ticket updates](../ticket-updates.md)

Pull requests (add each number when it opens):

- Ticket updates (#1072)
- Ticket updates: Azure Boards and GitHub Issues (#1133)

## Shaper: requirements first, the three cards

**Agree the requirements before the plan, in cards that read like a conversation.**

A medium or large Shaper task opens with one sentence, `You lead as Product, supported by QA and Security`, and a primary **Shape requirements**. The Requirements card lists what the perspectives agreed, then asks only what they could not settle: Worca's pick is already chosen and marked `recommended`, worded for the role you lead as. **Agree and plan** is the one primary; **Ask for changes** sends your words and your picks back. The plan card gains a **Requirements 7/8** fold that names any requirement no step delivers, and **Fix all** takes the primary until every one is covered. The Chat run card shows the same count while the run plans. A card proposed directly as Shaper now gets the same sentence and **Shape requirements** when medium or large. For a Product or Design lead, a code term with no plain wording now reads in words: `project:read` becomes `read access`, so a decision no longer loses half a sentence.

Chips: Shape requirements · lead role · supporters · Requirements card · recommended picks · Requirements fold · Fix all · experimental: turn it on in Settings › Labs

Read it: [Requirements first](../shape-it-first.md#requirements-first)

Pull requests (add each number when it opens):

- Shaper: shape the requirements first (#1139)
- Shaper: requirements first, the three cards
- Shaper: the requirements card on direct proposals, and readable product wording

## Independent reviewers for any workflow

**Any workflow can review a plan with several independent reviewers, each on its own model.**

A node's config can declare reviewer roles (for example Correctness and Security). The run starts one reviewer per role in parallel, each sees only its own role, and their findings go to the refiner in one file. Each role can run on its own model and effort, set in the workflow, the project's settings or for one run. Shaper's plan review now runs on this same step, unchanged for you.

**Every finding gets an answer.** The refiner (or an implementer, now also allowed as a reviewer's sink) marks each finding fixed, or disputed with a reason; one it does not answer stays open. Each round records how many findings were raised, fixed, disputed and open, and the plan card shows those counts per role. When two roles ask for opposite changes to one section, the plan card asks you to decide, and your pick goes into the plan's Clarifications.

Why: independent reviewers and a model per reviewer were Shaper-only; they are now part of the engine (#990).

**No silent fallbacks.** A model the run's engine cannot run (a Claude model on a Codex run, for a node or a role) is now named in a warning on the run page, once, instead of being dropped quietly. The Chat run card lists one Agents row per reviewer (`Plan Review · Architect` …) with a model and an effort. Shaper's Product reviewer runs on a different model from the others by default, and a new **Devil's advocate** perspective can be picked as an extra reviewer.

**Code role reviews.** Shaper's Review now reviews the diff as three independent roles, `correctness`, `security` and `fit` (Project fit), on the same engine step with the new `diff` target. Their merged findings go to the implementer's fix, and a clean role is skipped in later fix cycles. Any workflow's reviewer can opt in by node config, with its wires unchanged. Also added: the Chat Shaper card's Agents accordion lists three `Review Implementation · …` rows (a model per code role), and the run status card lists the code roles live while Review runs. The review loop's decision card lists the same role rows. The first review cycle runs 3 reviewer agents instead of 1. Rolling back to an older build in the middle of a run makes Review run as a single reviewer again, and an open plan question may then also count the code rounds.

**The implementer can push back.** When the implementer of a Shaper run finds that the approved plan would work but its design is wrong, it says so instead of building that part. The plan approval comes back with its concern above the buttons: Ask for changes sends the plan back to the planner with the concern, Approve has it build the plan as written. Under `--yes` the concern is overridden and the audit log says so; Away mode waits for you.

**Review quality per role.** `GET /api/stats/review-quality` sums each role's raised, fixed, disputed and open findings over finished runs, for plan and code reviews apart. It reads only the counts each run records, never the findings' text. Runs finished before this change have no data.

Chips: role reviews · a model per role · node config · dropped-pick warning · per-reviewer rows · Devil's advocate · finding dispositions · conflict decisions · code role reviews · diff target · plan concerns · review quality API

Read it: [Per-role models](../models.md#per-role-models)

Pull requests (add each number when it opens):

- Independent reviewers, engine first (#990)
- Cleanup: drop dead role-review paths (#990)

## Shaper, Run presets and Cost tags leave Labs

**Three Labs features are now simply part of Worca.**

Shaper, Run presets and Cost tags are always on, with no switch in Settings › Labs. Keep awake leaves Labs too: it stays on by default, and its switch in the account menu is now an ordinary setting. If you had turned Keep awake off, it stays off.

Chips: Shaper · Run presets · Cost tags · Keep awake · out of Labs

Read it: [Keep awake](../keep-awake.md)

Pull requests (add each number when it opens):

- Graduate Shaper, Run presets, Cost tags and Keep awake

## See when a newer Worca is out

**Settings › About says whether you run the latest stable Worca.**

The About card now marks the version **Latest** or **Update available: X.Y.Z**, and while an update
is out it links to that release's **What's new** page and to the GitHub **Changes since** view; a
**Release notes** link is always there. A small **Update available** marker in the sidebar foot
opens the card. Worca checks the npm registry's `latest` tag at most every 12 hours, and an open
tab asks again when it regains focus (a release candidate never counts as newer). Run from a git
checkout, the card says **Source build** and npm is never asked. Offline, nothing shows. Turn it
off with **Check for new Worca versions** in the same card; turning it back on checks afresh.
**Update to X.Y.Z** on the same card installs the latest stable and restarts Worca: running runs
pause and continue after the restart (when auto-resume is on), and the page reconnects by itself.
**Choose version…** picks a release candidate or rolls back; a version older than 1.14.0 installs
and then has to be started by hand with `worca ui`. This works when Worca was started with
`worca ui` from an `npm install -g` install whose global folder you can write to; otherwise the card
says why and shows the command to run. Shared and hosted installs keep the buttons off. A failed
install starts the previous version again and shows npm's reason on the card. Nothing updates
automatically.

Chips: About · version · release notes · update

Read it: [Getting started](../getting-started.md)

Pull requests (add each number when it opens):

- See when a newer Worca is out (#841)
- Update Worca from the About card (#841)

## Plugins work behind a proxy

Plugin task sources (GitHub, Azure Boards) and chat channels (Telegram, Slack, Discord, Teams) now follow `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` like worca itself, so they work on a network whose only way out is a proxy; loopback and `NO_PROXY` hosts go direct. They get `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and `SSL_CERT_DIR` too, for a proxy that re-signs TLS. A proxy the plugin can't use is a warning in its log instead of a bare `fetch failed`. A proxy URL that carries a user name and password is never handed to plugin code. Plugins then go direct, and worca says why: the UI server when it starts, the CLI at its first plugin call. A plugin that drives its own command-line tool goes through the proxy only if that tool reads the variables.

Upgrading: plugin calls that went direct now go to the proxy. Add a tracker on your own network to `NO_PROXY`. Under an outbound network policy in `allow` mode, or the Docker egress overlay, allow the plugins' hosts, or their calls are refused.

## Re-scans run on the model you chose

**Workspaces stop silently defaulting to a scan model.**

A workspace keeps the scan model it was created with, and every re-scan — the automatic one
after **Add projects** / **Remove**, and the header's Re-scan — runs on that saved pick. A
workspace with no saved model (an older workspace, or one whose saved model left the catalog)
does not fall back to a default: the re-scan opens the choose-a-model window (the same menu as
the create wizard, pre-filled from Settings › Runs › Workspaces). Save it and the scan runs on
it and keeps it for later; close the window and the re-scan is skipped. The workspace header's
**Scan model** control shows the saved pick and changes or clears it any time.

Chips: Workspaces · scan model · re-scan

Read it: [Workspace map](../workspace-map.md)

Pull requests (add each number when it opens):

- Re-scans run on the model you chose

## Shape it first

**Plan it before it builds.**

Worca now shapes a thin or large task first: at most 3 questions, a plan written for the perspectives you pick, your approval, and then the run only builds. A task too big for one change is cut into slices, each with its own run, branch and pull request, stacked one on the next.

Chips: Shaper · the plan card · checklists in review · plan in slices

Read it: [Shape it first](../shape-it-first.md)

Pull requests (add each number when it opens):

- Shape it first: the engine
- Shape it first: Chat features
- Shape it first: review checklists
- Shape it first: plan in slices

## Pin any workflow to the Chat home

Any workflow can be a quick button on the Chat home: pin it from the Library row's ⋯ menu or the workflow page's **Workflows** menu. One pin sits in the row after the built-in tiles and the rest are listed in **More** under **Pinned**; Shaper is pinned by default. A pinned tile arms New run with that workflow. Read it: [Chat home](../chat-home.md)

## Run presets (beta)

Save a New run setup as a named preset, pick it later, type a prompt and start: the run gets the preset's choices for that run only, and the project's settings never change. Read it: [Run presets](../run-presets.md)

- Every new run keeps its setup, and a finished run's page has **Save as preset** to turn it into a preset.
- The Chat home shows your presets as one-click chips under **Start from a preset**.
- Schedules follow their preset, `worca run --preset NAME --prompt "…"` starts one from the terminal, and Ask Worca proposes runs from your presets. Run presets are now in beta and on by default.

## Files in the chat

**Ask Worca shows the files it makes, right in its reply.**

When Ask takes a screenshot, makes a chart or finds a report or a run artifact, it now puts the file into its answer as a files card: images inline, every other file as a row with its kind and size. A click opens the viewer with zoom, next/prev, full screen and Download, and each file has Download and Show in folder buttons, which open the folder the file came from. Files are copied into the chat, so the card still works after the original changes, and it comes back when you reopen the chat. Credential files and anything outside the chat's folders are refused; SVG is shown only as an image and HTML only as source.

Read it: [Files in the chat](../show-files.md)

Pull requests (add each number when it opens):

- Files in the chat: show_files and the files card

## Watch PR fix runs in the chat

**The chat that opened a pull request sees its fix runs.**

A pull-request card in Ask Worca now shows the PR's Watch PR status, live. When Watch PR (or Resolve) starts a fix run
on that PR, the chat gets a live run card for it by itself — what started it (conflicts, failing checks, review
comments) and, at the end, whether the fix was pushed — even when the chat was closed.

Chips: Ask Worca · Watch PR · fix runs

Read it: [UI levels › History](../ui-levels.md#history)

Pull requests (add each number when it opens):

- Watch PR fix runs in the chat

## Runs redesign

**One run model, one look, everywhere.**

Runs, Shaper features and Run-after chains are now one thing on every surface: the Runs list, the chat card and the
run and group pages draw the same dot, the same status line and the same actions. A **?** marks a run that is waiting
on your answer (a question, a plan to approve, a gate or a recovery), a plain amber dot one that needs you because of
its pull request (the chip says why), and a **!** one that failed. The list filters and groups from one View menu, rows can be selected and stopped,
archived or deleted together, and any run can join a group. A server restart now pauses live runs and resumes them.
Your existing runs, features, chains, archived runs and schedules carry over, and old links still open.

Chips: one status line · ? asks you · View menu · select and act · groups · restart pauses

| | Before | After |
| --- | --- | --- |
| Runs list, light, desktop | ![](shots/unreleased/runs-redesign/runs-before-light-1440.jpg) | ![](shots/unreleased/runs-redesign/runs-after-light-1440.jpg) |
| Runs list, light, phone | ![](shots/unreleased/runs-redesign/runs-before-light-375.jpg) | ![](shots/unreleased/runs-redesign/runs-after-light-375.jpg) |
| Runs list, dark, desktop | ![](shots/unreleased/runs-redesign/runs-before-dark-1440.jpg) | ![](shots/unreleased/runs-redesign/runs-after-dark-1440.jpg) |
| Runs list, dark, phone | ![](shots/unreleased/runs-redesign/runs-before-dark-375.jpg) | ![](shots/unreleased/runs-redesign/runs-after-dark-375.jpg) |
| Run page, light, desktop | ![](shots/unreleased/runs-redesign/run-before-light-1440.jpg) | ![](shots/unreleased/runs-redesign/run-after-light-1440.jpg) |
| Run page, light, phone | ![](shots/unreleased/runs-redesign/run-before-light-375.jpg) | ![](shots/unreleased/runs-redesign/run-after-light-375.jpg) |
| Run page, dark, desktop | ![](shots/unreleased/runs-redesign/run-before-dark-1440.jpg) | ![](shots/unreleased/runs-redesign/run-after-dark-1440.jpg) |
| Run page, dark, phone | ![](shots/unreleased/runs-redesign/run-before-dark-375.jpg) | ![](shots/unreleased/runs-redesign/run-after-dark-375.jpg) |
| Group page, light, desktop | ![](shots/unreleased/runs-redesign/group-before-light-1440.jpg) | ![](shots/unreleased/runs-redesign/group-after-light-1440.jpg) |
| Group page, light, phone | ![](shots/unreleased/runs-redesign/group-before-light-375.jpg) | ![](shots/unreleased/runs-redesign/group-after-light-375.jpg) |
| Group page, dark, desktop | ![](shots/unreleased/runs-redesign/group-before-dark-1440.jpg) | ![](shots/unreleased/runs-redesign/group-after-dark-1440.jpg) |
| Group page, dark, phone | ![](shots/unreleased/runs-redesign/group-before-dark-375.jpg) | ![](shots/unreleased/runs-redesign/group-after-dark-375.jpg) |
| Chat card, light, desktop | ![](shots/unreleased/runs-redesign/card-before-light-1440.jpg) | ![](shots/unreleased/runs-redesign/card-after-light-1440.jpg) |
| Chat card, light, phone | ![](shots/unreleased/runs-redesign/card-before-light-375.jpg) | ![](shots/unreleased/runs-redesign/card-after-light-375.jpg) |
| Chat card, dark, desktop | ![](shots/unreleased/runs-redesign/card-before-dark-1440.jpg) | ![](shots/unreleased/runs-redesign/card-after-dark-1440.jpg) |
| Chat card, dark, phone | ![](shots/unreleased/runs-redesign/card-before-dark-375.jpg) | ![](shots/unreleased/runs-redesign/card-after-dark-375.jpg) |

Pull requests (add each number when it opens):

- Runs redesign: corners and one button
- Runs redesign: one run model
- Runs redesign: the Runs list
- Runs redesign: cards and pages
- Runs redesign: upgrade safety, states, alerts, What's new

## Plugin updates work on Windows

`worca plugin update` no longer fails on Windows with `Path is a directory: true`. The installed version's link is replaced cleanly, and the previous version's files stay untouched until cleanup.

Pull requests (add each number when it opens):

- Plugins: update works on Windows when the current version is a junction (#987)

## Worca in a container behind a corporate proxy

`worca container` started from a Worca terminal no longer gives the box Worca's own local proxy (`127.0.0.1`), which inside the container pointed at the container and failed every request. The box gets the corporate proxy from Settings › Network proxy when that proxy needs no login. Otherwise it gets no proxy, and one line says how to set the proxy up in the box. For a proxy that re-signs TLS, `WORCA_CA_CERT` in the container `.env` mounts the corporate CA. Worca, Claude Code, git, curl, `gh` and Python in the box then trust it.

Read it: [Corporate proxy and CA](../docker.md#corporate-proxy-and-ca)

Pull requests (add each number when it opens):

- Container: a reachable proxy and the corporate CA (#1015)

## Plugin answers survive a crash on exit

On Windows with Node 24, a plugin call that made one web request (such as Jira's issue list or a single issue) failed with `child exited 3221226505`, although the plugin had answered. Node crashed while the plugin's process was exiting. Worca now keeps an answer that arrived in full and logs a warning, and the plugin's process ends in a way that avoids the crash.

Pull requests (add each number when it opens):

- Plugins: keep a plugin's answer when its process crashes on exit (#1051)

## Attach Requirements features in Chat and New run

**Bring a feature you specified into a message or a run, without opening Requirements.**

**Pull from Requirements** in Chat and New run now attaches features instead of starting a run. Pick them from a list with checkboxes, or type `#` in the box and search by title or `FEAT-7`. Each shows as a card with its title, ID and criteria count, up to 10. Nothing is sent or started until you click Send or Run, and the task text is optional. Only the feature's spec text goes in, from its latest started version, as context: no files, and no run linked to the feature. Features are limited to the project or workspace you picked, a feature never started cannot be attached, and an archived or deleted one blocks Send and Run until you remove it. Changing the project asks before it removes anything. If an attached feature was not Ready when it last started, the run pauses before any work and asks you to agree, in every workflow and in Away mode too. A sent message shows each feature as a card that opens the text it carried. If a feature already has a run going, New run asks you to confirm.

Chips: attach with # or a picker · up to 10 · context only · latest started version · agree before work if not Ready · project scope asks first

Read it: [Requirements](../requirements.md#pull-from-requirements)

Pull requests (add each number when it opens):

- Requirements: attach features in Chat and New run
