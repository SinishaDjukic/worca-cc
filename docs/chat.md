# Chat

Chat (Ask Worca) is Worca's home page. It answers from Worca's own records, and any change it suggests comes as a
card you confirm. To drive runs from Telegram, Slack, Discord or Teams, see [Plugins](plugins.md).

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

The composer's scope pill sets **No project**, a project or a workspace, at every interface level. Changes act only
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

## Voice

The composer's mic has three modes. It dictates once, lets you talk and read the replies, or holds a hands-free
conversation that reads replies aloud. Hold the mic to start the hands-free mode.

Whisper and Kokoro run in the browser, so audio never leaves the computer. You can also point either side at your
own speech server. Voice needs `https://` or `localhost`. It listens in about 99 languages, and the built-in voice
speaks English. See [Voice mode](speech.md) and [Voice languages](speech-languages.md).

![The Chat page with its chat list: a finished "Paginate the search endpoint" run card for nimbus-crm with elapsed time, cost, its workflow graph and the result — Ready to ship, +29 −2 across 4 files, the top changed files listed — then a follow-up answer about the docs repository](screenshots/ask-worca.png)

![Chat agent mode: the chat "Run the CRM tests" with a Command card for npm test in nimbus-crm · main, exit 0, its 13-line output open showing one passing test, and the answer below it, beside the Terminal pane on the right with the chat's tab and the same bash session's npm test output](screenshots/ask-terminal.png)
