# Chat

Chat (Ask Worca) is Worca's home page. It answers from Worca's own records, and any change it suggests comes as a
card you confirm. To drive runs from Telegram, Slack, Discord or Teams, see [Plugins](plugins.md).

## Which engine answers

A chat runs on the model you pick. The composer's model button lists each engine that has models. An engine with
none yet (Gemini CLI, Goose, OpenCode, Qwen Code) sits under **More harnesses**: pick one to open `Add model` on it in
[Models > Catalogue](models.md#the-catalogue-tab). Once it has a model it gets its own row and a chat can move to it.

## A chat that is the home page

Open **Chat** from the first sidebar row or the worca logo. It's also the last row of the top bar's search (⌘K /
Ctrl K).

Chat answers from Worca's own records: runs with their diffs, progress and clarify answers, workflows and agents,
schedules, team metrics and policy, models, Actions, and tasks from installed trackers.

It reads code in read-only, detached worktrees, with an allowlisted `git` (`log`, `diff`, `blame`, `grep`…). You can
attach text files, images and PDFs. Chat has no file-editing tools of its own. In agent mode (below) it changes
files only through commands you ask for.

Settings › **Chat** (Advanced) sets:

- the turn limit and a cost cap per turn
- whether Chat may change and test-run your scripts
- opt-in web access, with a list of allowed domains

Chat spend counts toward the total budget. A team policy can preset these limits or narrow web access, but never
widen it.

## One scope per chat

The composer's project button (a folder icon; its tooltip names the scope) sets **No project**, a project or a
workspace, at every interface level. Changes act only
there.

When a No-project message is clearly about one of your projects, Ask asks with a card: **Switch to <name>** or
**Continue without project**. The same message continues once you choose. It never switches on its own.

A project you create or add from a chat card, the chat home's **Add project** tile or the scope menu's **Add
project…** becomes that chat's scope.

## Changes are cards you confirm

Nothing changes until you apply a card.

Work becomes a **run card**, with the project, workflow, guardrails, branches and brief all editable. It starts
nothing until you click **Start run**, or **Schedule…** to run it later (see
[Scheduled runs](scheduled-runs.md#chat)).

Ask for "auto", or for work that no saved workflow fits, and Chat drafts a **workflow card** you tune and **Save as
workflow**. When the work needs a script, a gate or a new agent, you get a graph card with **draft cards** for the
new agents and scripts.

Other changes are cards too: model and provider, workspace, Actions, team-metrics, team-policy and Away mode
changes, creating, adding or cloning a project, and reading a new website.

### Following a run from the chat

A started run becomes a live card. It shows the status, elapsed time, cost, the agents and the workflow graph, with
**Open run**. From the card you **Pause**, **Resume** or **Stop** the run and answer its questions. Once it ends, the
card shows the result, the top changed files, the artifacts and **Create PR**.

While the chat follows a live run, the composer's **→** chip, named after the run, sends a direction to the run
instead of a message to the chat. The chat still posts when the run waits for an answer, pauses, fails or finishes.

A pull request opened from a chat card keeps reporting there. The card shows its Watch PR status. Each fix run that
Watch PR or Resolve starts on it appears in the chat as a live run card, with what started it and how it ended.

## Agent mode with a shared terminal

Chat can run commands such as tests, builds, linters and git in a run's or a project's folder. It uses up to 3
terminals per chat, which appear as tabs in the terminal pane, where you can type too. Each command shows in the
chat as a card with **Stop** and **Output**. Chat changes files only through commands, and only when you ask.

Shells get a cleaned environment and a command check. That isn't a sandbox. A hosted Worca allows no commands
unless `WORCA_TERMINAL_REMOTE=1`. See [Terminal](terminal.md).

## Reply style (verbosity)

Choose how long Chat's answers are: **Detailed**, **Normal** (the default, unchanged), **Concise**, **Terse** or
**Caveman** (minimal words, fragments). Every engine gets the same style. The Workflows composer and Design chats
keep their own style.

- **This chat:** the **Style** button in the composer row (`Style · Default` until you pick one), or type
  `/verbosity terse` and press Enter. `/verbosity default` (or `reset`, `auto`) goes back to your settings, and
  `/verbosity` alone shows the current style. The command is never sent as a message; a toast confirms it. A pick
  made while a reply streams applies from the next reply. The pick is saved with the chat, and a new chat's pick is
  saved with its first message.
- **Your setting:** Settings › Chat › Limits & access › **Reply style**, or ask Chat ("make your answers terse":
  `change_setting chat.verbosity`, with a receipt you can revert).
- **A project:** the project's Settings tab › Chat › **Reply style**, or `change_setting` with scope "project".
- **The team:** a team policy can set `ask.verbosity` as a default ([Team policy](team-policy.md)).

The first one set wins: the chat's own pick, then the project, then your setting, then the team default, then Normal.
The team default applies only to a chat in a project: a No-project or workspace chat uses its own pick, then your
setting, then Normal.

A style changes only Chat's own prose. Tool arguments, the brief of a run card or any other proposal you confirm,
code, commands, ids, paths, links, chips, and the warnings and confirmations Chat must give are always written in
full.

Each finished reply, and the running one, shows its tokens next to the context fill and the cost:
`12.3k ctx · 12.3k in · 456 out · $0.10`. **in** counts everything sent to the model, including cache reads and
writes; **out** is what it wrote. See [Costs](costs.md#tokens-per-reply).

## Pinpoint

Select text in a chat answer, a markdown artifact or the Diff tab. You can then **Explain** it, ask for
**Alternatives**, leave a note or comment, or send it to the chat. Comments on a diff can become a fix run.

## Per-agent models for one run

On a run card for a saved workflow, Chat can pick a model and effort for each agent step from the catalog.
Judgement steps get the top price tier, and mechanical steps the cheapest capable model, Anthropic first, then
OpenAI. It picks a premium-tier model such as Fable 5.1 only when you name it.

Each pick sits beside the project's own setting, with its reason on hover. Change or reset any of them before
**Start run**. The picks apply to that run only. To keep them, turn on **Save as project defaults**. More in
[Models](models.md#per-agent-models-for-one-run).

## Files in the chat

When Ask makes or finds a file you should see, it puts it into the reply as a files card. That might be a
screenshot it took with `run_command`, a chart, a report or a run artifact. Images show inline and other files as
rows. A click opens a viewer with zoom, next and previous, and Download. **Show in folder** opens the folder the
file came from.

Files are copied into the chat. Credential files, and anything outside the chat's folders, are refused. See
[Files in the chat](show-files.md).

## Memory

Say "remember …" or state a lasting preference, and Ask saves it to Worca's memory. Global memory is for how you
work. Project memory is for facts about one repository. Pipeline agents load the same memory. You can view, edit,
delete or restore it on Settings › **Memory** and on a project's **Memory** tab.

- A run loads memory as it was when the run started, and a resume loads that same set. Each step records which set
  it loaded (a sha256 in the step record; the files are in the run's `memory.json`).
- Pipeline agents never change memory themselves. A note they write waits under **Proposed by runs** on the Memory
  page (or `worca memory proposals`) until you approve or reject it.
- A note with `roles: reviewer` (agent keys, comma-separated; `ask` is the chat) loads only into those agents.
- **Run without memory** on the New run page (`--no-memory`, or `noMemory: true` in `POST /api/run`) starts a run
  that loads none, to compare runs with and without it.
- Pipeline agents on Claude load only the project's own Claude Code settings, not your `~/.claude` hooks, plugins or
  skills. The project setting **Runs load my Claude Code setup** brings them back.

## Voice

The composer's mic has three modes. It dictates once, lets you talk and read the replies, or holds a hands-free
conversation that reads replies aloud. Hold the mic to start the hands-free mode.

Whisper and Kokoro run in the browser, so audio never leaves the computer. You can also point either side at your
own speech server. Voice needs `https://` or `localhost`. It listens in about 99 languages, and the built-in voice
speaks English. See [Voice mode](speech.md) and [Voice languages](speech-languages.md).

![The Chat page with its chat list: a finished "Paginate the search endpoint" run card for nimbus-crm with elapsed time, cost, its workflow graph and the result — Ready to ship, +29 −2 across 4 files, the top changed files listed — then a follow-up answer about the docs repository](screenshots/ask-worca.png)

![Chat agent mode: the chat "Run the CRM tests" with a Command card for npm test in nimbus-crm · main, exit 0, its 13-line output open showing one passing test, and the answer below it, beside the Terminal pane on the right with the chat's tab and the same bash session's npm test output](screenshots/ask-terminal.png)
