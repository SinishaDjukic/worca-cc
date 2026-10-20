# Terminal

A terminal pane on the right side of every Worca page. The shell runs on the Worca server, in the
folder of what you are looking at, and every command you run is recorded with its output, exit code,
duration, who ran it and when.

> **What this means:** the shell runs as the user Worca runs as, in folders whose code agents wrote.
> On a hosted Worca it is off unless an administrator sets `WORCA_TERMINAL_REMOTE=1`.

## Where it opens

Open the pane with the terminal button in a run's top bar or next to a project's name, or with Ctrl+\` on
any page. On a run or a project page it shows a live shell right away: it reattaches the page's running terminal, or starts one.

| Page | Folder |
| --- | --- |
| A running run | its live worktree. The pane warns that the pipeline is still changing those files. |
| A finished run | its checkout (see [Actions](actions.md)). With none yet, Worca makes the checkout first. |
| A workspace run | one terminal per member; the select next to the folder picks the member. |
| A run with No project | its own `work/` folder while it runs or is paused; once it ends there is none (its files are its Artifacts). |
| A project page | your own checkout of the project (the folder you registered), on whatever is checked out there. |
| Any other page | no new terminal: the pane shows the most recent one that is still running. |

The header holds the title and **×**, which hides the pane: the shell keeps running, and opening the
pane again on the same page reattaches it. Below it is a tab for each open terminal of the page (and each
of Chat's, on every page: see [below](#chat-agent-mode)), then a
small **+** tab that starts another shell in the same folder (a second shell of a folder is numbered,
like `demo · main 2`). Click a tab to switch. The **×** on a tab closes that terminal, or type `exit` in
it. A terminal that has run a command asks first; one that has not closes at once. In a shell without
recorded commands (sh, fish, cmd.exe) any line you submitted counts. Closing the shown terminal switches
to the page's next one, or leaves the line that starts a new one on Enter. Below it is the terminal's folder, with a warning or the member select when they apply. Worca starts a shell for a page at
most once each time you open the pane. When the shell ends (you typed `exit`, or it died) or Worca
restarts, the terminal says so and starts a new one only when you press Enter.

### Branch folders (API only)

The pane no longer offers them, but `POST /api/projects/<key>/terminal` with a `branch` still opens a
terminal in `~/.worca-cc/terminal/worktrees/<project>/…`, a worktree of that branch. Without `branch` it
opens in the project's own folder, which Worca never removes. If the branch is checked out somewhere
else (often your own checkout), the branch folder is a **detached** copy of its latest commit, and
commits made there are not on the branch. Worca never deletes the branch. These folders follow **Keep
checkouts** (Settings › Runs › Actions): with `never` a clean folder goes when its last terminal closes;
otherwise it stays until `DELETE /api/projects/<key>/terminal/worktrees` removes it. **Max checkouts**
caps how many stay. A folder with uncommitted changes, or a detached copy holding commits no branch,
remote or tag reaches, is never removed automatically; the DELETE needs `force: true` for it.

## Sessions

Each terminal has an id, a folder, a status (`running`, `exited`, `closed`, `interrupted`), an exit
code and its output. It survives a page reload: the pane replays the last 512 KB. It ends when the
shell exits (type `exit`), when its tab's **×** or `DELETE /api/terminal/sessions/<id>` closes it, or when Worca stops. A terminal left running by a
Worca that crashed is stopped on the next start and shows as `interrupted`. At most 16 run at once.

When a run finishes, its worktree is removed (and re-created if a keep policy keeps it). A terminal
open there says so: `cd "$PWD"`, or type `exit` and press Enter for a new one. Before it is removed, Worca commits what is in
the worktree onto the run's branch, so changes you make in a running run's terminal become part of
the run's commit. To keep your own changes apart, wait for the run to finish and use its checkout.

## Recorded commands

In bash and zsh, Worca loads your own `~/.bashrc` / `.zshrc` and adds a few lines that mark where each
command starts and ends. Each command is recorded for the audit log as a block: the command, its exit
code, duration and output (the last 256 KB), who ran it and when. The pane does not show them; read
them through the API: `GET /api/terminal/sessions/<id>` lists a terminal's newest commands, and
`GET /api/terminal/sessions/<id>/blocks/<n>` returns one with its output. Other shells (sh, fish,
cmd.exe, PowerShell) work, but their commands are not recorded. A command typed with a leading space is
still recorded: the record is the audit.
When bash leaves a line out of its history (`HISTCONTROL=ignorespace`, `ignoredups` or `ignoreboth`,
which Ubuntu's default `.bashrc` sets), the block shows only the line's first command: a repeated
`cd x && make` is recorded as `cd x`.

The marks carry a secret that is new for each terminal and hidden from the programs you run, so output
that merely contains a mark (a `cat` of a file, another tool's shell integration) never creates a
command or an audit entry. Code that runs inside the shell itself (a file you `source`, a direnv hook)
can read that secret; programs the shell starts cannot. If your `.bashrc` installs its own `DEBUG` trap
after Worca's lines, or your zsh setup clears `precmd_functions`, commands are not recorded. Commands
typed in a shell you start inside the terminal (`bash`, `ssh`, `docker exec`) are part of that one
command's block, not blocks of their own.

Keys you type in the terminal are the shell's: Escape and Ctrl+K never act on the Worca page around it.
Ctrl+\` shows and hides the pane from anywhere.

If a command prints faster than the page can draw it (`yes`, a large `cat`), Worca skips ahead: the
pane jumps to the latest output instead of queueing everything. The recorded block still keeps its last 256 KB.

## Environment

| Variable | Value |
| --- | --- |
| `WORCA_RUN_ID`, `WORCA_BRANCH`, `WORCA_PROJECT_KEY`, `WORCA_MEMBER` | the run's facts |
| `WORCA_WORKTREE` | the folder |
| `WORCA_TERMINAL_SESSION` | this terminal's id |
| `WORCA_PORT_<ACTION>_<NAME>`, `WORCA_URL_<ACTION>` | each running action's ports and URL (`WORCA_PORT_<MEMBER>_<ACTION>_<NAME>` on a workspace run) |

They are read when the terminal opens: start the action first, then open a terminal. GitHub tokens and
Worca's own `WORCA_HOME` are not passed on, as for Actions. Neither is `PORT`, which is Worca's own
port: an app you start here picks its default port, or the one you give it. Because `WORCA_HOME` is not
passed on, a `worca` command typed here uses the default home (`~/.worca-cc`); on a Worca that runs with
another home (the Docker image uses `/worca`), run `export WORCA_HOME=/worca` first.

## Stop

Ctrl+C typed in the terminal stops the running command. With node-pty it reaches the program as in any
terminal. Without node-pty (see below) the pane calls the stop API instead
(`POST /api/terminal/sessions/<id>/stop`, which is also there for scripts): it sends Ctrl+C to the
running command and, if that command is still running 3 seconds later, kills every process the
terminal started, including jobs you put in the background with `&`. There is no foreground job to aim
at, so the first Ctrl+C also reaches those background jobs. A stop through the API is recorded with who
stopped it. In a shell without blocks (sh, fish, cmd.exe), Worca cannot tell when a command ends, so
the stop API sends Ctrl+C only and never escalates.

To end a terminal, type `exit` or press its tab's **×**; `DELETE /api/terminal/sessions/<id>` closes it from outside. The stop
and close APIs always work, even when the terminal is turned off. Discarding a run's checkout closes
the terminals open in it, as it stops the run's Actions.

## Audit log

Every open, command, stop and close is recorded with the person (the same attribution as runs) and the
time. Blocks and audit rows are kept. `GET /api/terminal/audit?runId=<id>` lists a run's.

## Security

- The browser never chooses the folder, the shell or the environment: Worca picks them from the run or project.
- **Hosted mode:** off unless the server starts with `WORCA_TERMINAL_REMOTE=1`. With it on, anyone signed
  in can run commands as the server user: that is the point, but know it before you turn it on.
- With agent isolation on, callers inside the box (which could be an agent) can never use the terminal.
  The same gap as for Actions remains: in **local** mode there is no identity, so a request an agent loops
  back through a published port cannot be told apart from a person. Run an isolated box in remote mode.
- The shell runs as the Worca server's user, not as the agent user, exactly like an Action. Code you run
  here (the run's tests, `npm install` of a branch agents wrote) has the server's access.
- Only pages served by this Worca can use it. A page on another port of the same machine (another dev
  server, or a service an Action started) is refused with `403 TERMINAL_CROSS_ORIGIN` and sees no terminal
  traffic.

## Chat (agent mode)

Every chat is in agent mode wherever the host allows it (there is no per-chat switch): Chat
can run shell commands in Worca terminals to check and finish work: tests, builds, linters, `git status`,
and file changes through commands when you ask for them. It runs in a run's folder (a run with no project has none), or in the folder of the chat's project (the chat's
scope, or a member of its workspace); another project's folder is refused until you change the chat's scope.

- **A shared terminal.** Ask opens its own terminals, labeled `Ask · <chat title> · <folder>`, at most 3
  per chat. Their tabs show in this pane on every page, next to the page's own terminal, with the same
  live output, and you can type in them. Ask never types into a terminal you opened.
  - **Ask's tab waits for you.** A command Ask starts never opens the pane, never switches its tab and
    never takes the keyboard: it shows live in the chat, and its tab is in this pane when you open it.
    Click the folder on a command card to show its tab and type there. Moving to another page brings
    back that page's own terminal; Ask's tab stays a tab.
  - **Your commands in Ask's tab.** They never wake the chat. Your next message carries a line in its
    context listing what you ran there since then (command, exit code, block id, redacted like other
    command text, the newest 3), so "I ran the migration, continue" works, and Ask can read the output.
  - **The shell is kept.** A `cd`, `export` or activated virtualenv (yours or Ask's) carries over to
    Ask's next command, as long as the shell is still inside the target folder (the project's folder, or
    the run's checkout). Each command is checked against the folder the shell is really in. A shell that
    left the folder is never used: Ask opens a fresh one in the folder and leaves yours alone. If you are
    running something in Ask's tab, Ask uses another of its terminals.
  - **When all 3 are yours.** If every Ask terminal of the chat is busy with your commands, or you moved
    them out of the folder, Ask's command is refused with a message saying so; free one or `cd` back.
    Ask reuses one of its terminals for another folder only if you have not typed there for 10 minutes.
  - **Idle close.** An Ask terminal closes after 10 idle minutes (your typing and commands there count
    as activity) and when the chat is deleted.
- **In the chat.** Each command shows as a card with the whole command line and a **Stop** button. Its
  live output is folded: click **Output** (it counts the lines) to show it; it stays open as it grows.
  When a command ends, the chat wakes with `[worca event] terminal block <id> exited <code>`, unless
  Ask already saw the end while it waited. Ask can also list and read the commands you ran here
  (`list_blocks`), so "why did this fail?" works on your own commands.
- **Environment.** Ask's shells start from a cleaned environment: `PATH`, `HOME`, locale, proxy and CA
  variables and `SSH_AUTH_SOCK`, and nothing else from the server. No model, GitHub or server tokens. Your
  shell rc files (`.bashrc`, `.zshrc`, `.zshenv`) are not loaded, so tools put on `PATH` only there (nvm,
  pyenv) come from the server's own `PATH` instead. Pagers are off and git never asks for a password.
- **The command check.** Before anything is typed, Worca refuses a command that names its own files or
  credential paths (`~/.worca-cc`, the database, `.env*`, `~/.ssh`, `~/.aws`, `~/.claude`, …), calls
  Worca's own HTTP API, or is hard to undo (`git push --force`/`--delete`, `rm -r` outside the folder,
  `sudo`/`doas`, `mkfs`, `dd` to a device, `shutdown`). The check follows `cd` between steps, looks
  through wrappers (`xargs`, `nice`, `timeout`, `env`, …), `bash -c "…"`/`eval`, and git's global
  options, and treats an `rm -r` target built from `$(…)` or piped into `xargs` as outside the folder.
  It also refuses `gh auth token` (and `gh auth status --show-token`), and a command with a newline.
  Command lines and output that reach the model or the card are redacted. This check
  is a rail against mistakes and naive prompt injection, **not a sandbox**: an obfuscated command (a path
  built from variables, a `../../..` walk out of a run's checkout) can get around it.
- **Limits.** At most 3 commands run at once per chat. A command is stopped after 30 minutes
  (`stopped_by: ask:cap`). `wait_for` waits at most 240 seconds; longer work ends the reply and waits for
  the event.
- **Audit.** Ask's commands are recorded like yours, with `actor: ask:<chat id>` in the audit log and
  `source: ask` on the block. Opening an Ask terminal on a run adds "Terminal opened by Chat" to the
  run's audit.
- **Where it is off.** On a hosted Worca, agent mode follows the terminal: off unless
  `WORCA_TERMINAL_REMOTE=1`. With agent isolation on, agent mode is off: the
  shell would run as the server user, not the agent user. Only bash and zsh record commands, so a terminal
  with another shell (sh, fish, cmd.exe) cannot run Ask's commands.

## Without node-pty

The terminal uses `node-pty`, an optional native module: prebuilt on macOS and Windows, compiled on
Linux (it needs python3, make and a C++ compiler; the `-full` Docker image has them). Without it,
terminals run over plain pipes: commands, blocks and Stop work, but full-screen programs (vim, top,
less) and arrow-key history do not, and the pane says so. Ctrl+D on an empty line closes the
shell's input: the program reading it gets end-of-input, and the shell then exits too.
`WORCA_TERMINAL_PTY=0` forces this mode.
node-pty 1.1.0's macOS package ships its `spawn-helper` without the execute bit; Worca sets it the
first time a terminal opens. If it cannot (a read-only install), or node-pty still fails to start a
shell, terminals use pipes and the banner gives the reason.

## Windows

The shell is `cmd.exe` (`ComSpec`): a working terminal without blocks. Stop sends Ctrl+C only.

## Troubleshooting

| You see | Why, and what to do |
| --- | --- |
| "Full-screen programs … do not work here" | node-pty is not installed. Install build tools and reinstall, or use the `-full` image. |
| No commands recorded for a terminal | The shell is not bash or zsh, or your rc file replaced `PROMPT_COMMAND` / `precmd_functions` after Worca's lines ran. |
| "The terminal is turned off on this hosted deployment" | Set `WORCA_TERMINAL_REMOTE=1` on the server. |
| "This folder was removed when the run finished" | Type `exit`, then press Enter: the new terminal opens in the run's checkout (Worca makes one if needed). |
| 409 "At most 16 terminals" | Close one. |
| 403 `TERMINAL_CROSS_ORIGIN` | The page's address differs from the `Host` the server received, for example a proxy that rewrites `Host`. Forward `Host` unchanged. |
| `bash: !": event not found` | Bash history expansion, as in any bash: quote `!` with single quotes. |
