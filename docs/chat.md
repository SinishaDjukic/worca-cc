# Chat

Chat (Ask Worca) is Worca's home page: a chat that answers from Worca's own records and turns changes into cards you confirm. To drive runs from Telegram, Slack, Discord or Teams, see [Plugins](plugins.md).

- **A chat that is the home page** — **Chat** (the first sidebar row, and the worca logo), or the
  last row of the top bar's search (⌘K / Ctrl K), opens a chat that
  answers from Worca's own records: runs, their diffs, progress and clarify answers, workflows
  and agents, schedules, team metrics and policy, models, Actions, and tasks from installed
  trackers. It reads code in read-only, detached worktrees with an allowlisted `git` (`log`,
  `diff`, `blame`, `grep`…), takes attached text files, images and PDFs, and has no file-editing
  tools of its own (in agent mode, below, it changes files only through commands you ask for). Settings › **Chat** (Advanced) sets the turn limit, a per-turn cost cap, whether it may
  change and test-run your scripts, and opt-in web access with an allowed-domain list; chat spend counts toward the total
  budget, and a team policy can preset the limits or narrow web access, never widen it.
- **One scope per chat** — the composer's scope pill sets **No project**, a project or a workspace, at every interface level. Changes act only there. When a No-project message is clearly about one of your projects, Ask asks with a card — **Switch to <name>** or **Continue without project** — and the same message continues after you choose; it never switches on its own. A project you create or add from a chat card, the chat home's **Add project** tile or the scope menu's **Add
  project…** becomes that chat's scope.
- **Changes are cards you confirm** — work becomes a **run card** (project, workflow, guardrails,
  branches and brief, all editable) that starts nothing until you click **Start run**, or
  **Schedule…** to run it later ([`docs/scheduled-runs.md`](scheduled-runs.md#chat)).
  Ask for "auto", or for work no saved workflow fits, and it drafts a **workflow card** you tune
  and **Save as workflow** — or, when the work needs a script, a gate or a new agent, a graph card with **draft
  cards** for the new agents and scripts. Model and provider, workspace, Actions, team-metrics, team-policy and
  Away mode changes, creating, adding or cloning a project and reading a new website are cards too: nothing changes
  until you apply one. A started run becomes a live card — status, elapsed, cost, its agents and
  its workflow graph, with **Open run** — where you **Pause**, **Resume** or **Stop** the run and
  answer its questions; once it ends, the card shows the result, the top changed files, its
  artifacts and **Create PR**. While the chat follows a live run, the composer's **→**
  chip (named after the run) sends it a direction instead of a message. The chat still posts when
  the run waits for an answer, pauses, fails or finishes. A pull request opened from a chat card keeps reporting
  there: the card shows its Watch PR status, and each fix run that Watch PR or Resolve starts on it appears in the
  chat as a live run card, with what started it and how it ended.
- **Agent mode with a shared terminal** — Chat can run commands (tests,
  builds, linters, git) in a run's or a project's folder, in up to 3 terminals
  per chat that appear as tabs in the terminal pane, where you can type too.
  Each command shows in the chat as a card with **Stop** and **Output**; it
  changes files only through commands, and only when you ask. Shells get a
  cleaned environment and a command check, which is not a sandbox; a hosted
  Worca allows none unless `WORCA_TERMINAL_REMOTE=1`. See
  [`docs/terminal.md`](terminal.md).
- **Pinpoint** — select text in a chat answer, a markdown artifact or the Diff
  tab to **Explain** it, ask for **Alternatives**, leave a note or comment, or
  send it to the chat; diff comments can become a fix run.
- **Per-agent models for one run** — on a run card for a saved workflow, Chat can pick a
  model and effort for each agent step from the catalog (judgement steps on the top price tier,
  mechanical ones on the cheapest capable model, Anthropic first, then OpenAI; a premium-tier
  model such as Fable 5.1 only when you name it). Each pick sits
  beside the project's own setting with its reason on hover; change or reset any of them before
  **Start run**. The picks apply to that run only — turn on **Save as project defaults** to keep
  them ([`docs/models.md`](models.md#per-agent-models-for-one-run)).
- **Files in the chat** — when Ask makes or finds a file you should see (a screenshot it took with
  `run_command`, a chart, a report, a run artifact), it puts it into the reply as a files card: images
  inline, other files as rows, and a click opens a viewer with zoom, next/prev and Download. **Show in
  folder** opens the folder the file came from. Files are copied into the chat; credential files and anything outside the chat's folders are refused
  ([`docs/show-files.md`](show-files.md)).
- **Memory** — say "remember …" or state a lasting preference, and Ask saves it to Worca's
  memory: global for how you work, per project for facts about one repository. Pipeline agents
  load the same memory; view, edit, delete or restore it on Settings › **Memory** and on a
  project's **Memory** tab.
- **Voice** — the composer's mic dictates once, lets you talk and read the replies, or holds a
  hands-free conversation that reads replies aloud (hold the mic to start it). Whisper and
  Kokoro run in the browser, so audio never leaves the computer, or point either side at your
  own speech server; it needs `https://` or `localhost`. It listens in ~99 languages and the
  built-in voice speaks English. See [`docs/speech.md`](speech.md) and
  [`docs/speech-languages.md`](speech-languages.md).

![The Chat page with its chat list: a finished "Paginate the search endpoint" run card for nimbus-crm with elapsed time, cost, its workflow graph and the result — Ready to ship, +29 −2 across 4 files, the top changed files listed — then a follow-up answer about the docs repository](screenshots/ask-worca.png)

![Chat agent mode: the chat "Run the CRM tests" with a Command card for npm test in nimbus-crm · main, exit 0, its 13-line output open showing one passing test, and the answer below it, beside the Terminal pane on the right with the chat's tab and the same bash session's npm test output](screenshots/ask-terminal.png)

