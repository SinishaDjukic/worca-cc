# Chat

Chat (Ask Worca) is Worca's home page. It answers from Worca's own records, and any change it suggests comes as a
card you confirm. To drive runs from Telegram, Slack, Discord or Teams, see [Plugins](plugins.md).

## Which engine answers

A chat runs on the model you pick. The composer's model button lists each engine that has models. An engine with
none yet (Gemini CLI, Goose, OpenCode, Qwen Code) sits under **More harnesses** when it is installed on this machine:
pick one to open `Add model` on it in [Models > Catalogue](models.md#the-catalogue-tab). Once it has a model it gets its
own row and a chat can move to it. An engine that is not installed is listed at the foot of **More harnesses**, dimmed
and marked *not installed*, so a machine with one engine still has a way to add another. Its row opens that engine's
setup dialog (**Connect OpenAI Codex**, **Connect Goose**, … and **Connect Claude Code**, the same dialog for every
engine): the install command, the `WORCA_<ENGINE>_BIN` variable for a binary elsewhere, the sign-in step, a link to the
engine's section in [Models](models.md#chat), and **Check again**, which asks the server whether the engine is now
installed and ready. When no engine is installed, the model button says **Set up a harness**, and its menu is that list.
The browser extension has no dialog: its rows open the engine's setup section in a new tab.

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

## Security and sandboxes

Chat knows how this Worca is set up. Every message carries one `security:` line. It names the setup (native,
container, hardened box or hosted), the credential broker, agent users, the outbound network, where the proxy login
lives and the default execution environment.

Ask it "is this run sandboxed?", "why can't I use Docker?" or "what does the hardened box protect?". It reads:

- **the security posture**: the same rows as Settings › General › Security.
- **the execution environments**: Local, Local sandbox (Docker) and E2B sandbox. Each says ready or why not, the slots
  in use and the cap, and the wait limit.
- **a project's sandbox environment**: its network (open or allow), its template or image, its environment spec and
  its builds, current or stale.
- **the secret vault** (Labs flag `secretVault`): its state, the OS key store's name and how many saved secrets of each
  kind are in it or still in files. Never a value, a name or a key. The `security:` line then carries `vault=`. Chat
  changes nothing here: see [Secrets and the vault](secrets.md).
- **a sandbox run**: waiting for a slot, building the image, the answer-by time and the files held for review.

It states the claim exactly: no model key, no git token and no proxy login in an agent's reach. It never says "no
secrets". MCP registry secrets stay in reach of the runs that use them. A Local run on a native install is not
sandboxed.

A run card that asks for a sandbox runs the run start's checks first. When Docker is not running or E2B is not set
up, Chat says so and offers Local.

Chat changes a project's sandbox with cards you apply:

- **the environment spec**: pinned tools and apt packages. Set or clear it.
- **a build** of the project's template or image from its spec. It runs on the Worca server.
- **the sandbox settings**: the network (open or allow) and the template or image.

Chat can also change the Docker and E2B limits in Settings › Runs, with a receipt and Revert.

Chat never changes the credential broker, agent users, the allow-list or the box's base image. Whoever runs Worca
sets those. In the hardened box, Chat adds a project by cloning it only. Chat's own file tools never read the proxy
login file, `/run/secrets` or the egress sidecar's data.

### Known limits of the command guard

In agent mode, a check runs before each of Chat's own commands. It refuses a command that names the proxy login,
Docker secrets or the egress sidecar's data, however the path is spelled.

The check is a guard on Chat's own commands, on an install where Chat runs as you. It is not the security boundary.
The boundary is file permissions, agent users and the egress sidecar. On a native install, an agent or a chat that
runs as your OS user can reach every file you can read.

When a command holds something the check cannot work out, it treats the whole command as unsure. That includes a
variable set at run time, `$(…)`, `eval`, `read` or a `cd` to such a folder. An unsure command is refused when any
word names `secrets`, `egress` or the proxy login file. It is also refused when it runs a reader that walks folders
(`find`, `grep -r`, `rg`, `tar`, `cp -r`, and a few more) without plain paths. The refusal says how to rephrase it.
Put a `cd` to a written-out path first, then give plain paths.

What the check does not catch:

- A program that builds a path when it runs: a script, `python -c`, `node -e`.
- A symlink made earlier that points into a protected folder.
- A tool that reads a folder it is not told about, such as a config file that names one.
- Any other way of spelling a path. Each new one goes on this list, not into the check.

For the secret vault the check refuses the OS key store tools (`security`, `secret-tool`, keyring modules) and
`worca secrets export`, `reset` and `ack`. It matches them after removing quotes and backslashes. It also refuses an
unsure command that names those tools or Worca's own CLI, or that holds a `$'…'` string with a backslash escape.

The check reads text, so it is defence in depth. That is why `worca secrets export`, `reset` and `ack` run only in a
person's own terminal, after they type a word the command shows. No variable or option lifts that. On a native
install, anything that runs as your OS user can reach the OS key store. The secret vault is at-rest encryption, not a
sandbox.

See [Security overview](security-overview.md) and [Secrets and the vault](secrets.md).

More: [Choose a setup](choose-a-setup.md), [Security overview](security-overview.md),
[Environment spec](environment-spec.md), [Network proxy](network-proxy.md).

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
