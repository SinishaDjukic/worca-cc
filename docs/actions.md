# Actions

Try a finished run's result before you ship it. **Check out** puts the run's feature branch back
in a worktree, runs the project's setup command once, and then the project's own commands
(a dev server, the tests, a workspace's whole stack) start from Worca with one click. Ports,
a ready check and a live log come with them.

> **What this means.** An action runs the branch's code, which agents wrote, as the user the
> Worca server runs as, whenever a person clicks Run. That is the point of the feature. Agents
> can never start an action themselves, and the API only ever starts a command by its id from
> stored config (see [Security](#security)).

## Where it lives

| Place | What it holds |
| --- | --- |
| Run page and History detail › **Actions** tab | Check out / Discard, setup state, each action's Start / Stop, ports, Open link and log; Open in editor, terminal, file manager; Copy command; Download patch |
| Run Overview › actions strip, Create PR › **Try it first** (the Try it first button at the left of the Create PR dialog's footer; once checked out, the strip above it) | The same actions, one click from the result |
| Run page and History detail › summary card **Results › Actions row** | `Local copy open · since 18:12` (or `Linked to your folder · since 18:12`, `2 local copies open · since 18:12`) once checked out, `Try it on this machine` before; opens the Actions tab. Advanced, like the tab. At Simple a plain row with the same words carries Discard / Unlink while a checkout exists |
| Run page and History detail › summary card **worktree notice** | Work kept after a failed end-of-run commit (Apply to branch, recovery patch, Discard worktree). Every level |
| Project page › **Actions** tab | The project's setup command, its actions and the built-in buttons |
| Workspace page › **Actions** tab | Stacks: one click starts actions across several member projects |
| Header pill, sidebar **Running actions** rows | Every service still running, each with a Stop button; on the collapsed rail one tile with the count opens them. Shown at every level, only while something runs |
| Settings › Runs › **Actions** | Keep policy, port range, editor and terminal, checkout cap |

The tabs, strips and the Settings card are Advanced (see [ui-levels.md](ui-levels.md)). The worktree
notice is not: it shows at every level, because it explains refusals anyone can hit. Neither is the Simple
checkout row: Archive is refused while a checkout exists, so its Discard / Unlink must stay in reach.

A run can be checked out when it ended `done`, `stopped` or `error`, is not archived, has a feature
branch, and kept no uncommitted work of its own. Paused and interrupted runs are refused: resume or
stop them first.


### When the branch is already checked out in your folder

Git keeps a branch in one folder at a time. When the run's branch is already checked out somewhere
else (usually your own clone), Check out cannot make a copy, so the card shows that folder and offers
**Use that folder**. Terminal, Finder, Editor and the project's actions then run there.

- The folder stays yours. Worca never deletes, resets or patches it, and the checkout cap and the keep
  policy never touch it.
- Setup does not run there by itself. **Run setup** on the card runs it when you want.
- **Unlink** stops using the folder. It stays exactly as it is.

### Download patch

Each checked-out member card has **Download patch** before Discard (or Unlink). It downloads a patch of
the folder's uncommitted changes (edits, deletions, new files git does not ignore) against its last
commit, which is the run's branch while the folder is on it, as `uncommitted-<branch>.patch`. It is
read-only. The patch is built in a temporary git index, so nothing in the folder is staged or changed:
not in your own folder, and not in a checkout left mid-merge, whose conflicts stay unresolved. A clean
folder answers "Nothing uncommitted". After Discard or Unlink the card says what happened ("Checkout
discarded. …", "Folder unlinked. …").

## The worktree notice on the summary card: work kept after a failed commit

Git keeps a branch in one folder at a time. While a live worktree holds a finished run's branch, Check out,
Archive and a new run on that branch are refused. A checkout says so in the summary card's Results ›
Actions row (see [Where it lives](#where-it-lives)) and is handled in the Actions tab. Work kept after a
failed commit gets a notice under the status line, on the run page and in History, at every interface
level. For a workspace run it lists the members concerned.

**Work kept after a failed commit.** At the end of a run Worca commits the agents' work onto the run's
branch. If that commit fails (a hook, signing, a stale `index.lock`, a full disk), the worktree is kept
with the work staged but **not on the branch**. A pull request opened now would not include it; the card's
headline does not change, so read the notice. It offers:

- **Apply to branch**: commits the staged work in that worktree, exactly as the end of the run would have.
  It tries the repository's identity, then a local one. For a detached run it tries once more with commit
  hooks off, as the run's own teardown did. Then it removes the worktree (the branch is kept) and refreshes
  the base check. Check out and Create PR then work as for any finished run. For a run on its
  source branch, Apply also fast-forwards the source branch onto the work and deletes the run's hidden
  branch. If the source moved on in the meantime, the merge-back notice explains how to merge by hand. If
  the commit fails again, nothing changes and git's message is shown.
- **Download the recovery patch**: the snapshot saved when the work was kept.
- **Discard worktree**: saves a recovery patch of anything uncommitted, then removes the worktree. The
  branch and the run's history stay.

Once the worktree itself is gone, nothing holds the branch and the notice does not show. The recovery patch
stays in the run's Artifacts tab, for `git apply` by hand.

API: `GET /api/runs/<id>/checkout/diff?<scope>[&member=<projectKey>]` (200 patch, 204 nothing uncommitted)
and `POST /api/runs/<id>/apply-retained?<scope>` (409 `COMMIT_FAILED` with git's message when every commit
failed again).

## The action model

Each project stores one config (Project page › Actions, or `PUT /api/projects/<key>/actions`):

```json
{
  "setup": "npm ci",
  "actions": [
    { "id": "run", "label": "Run", "kind": "service", "cmd": "npm start", "cmdWin32": null, "cwd": ".",
      "env": [ { "name": "PORT", "type": "port", "value": "auto" },
               { "name": "NODE_ENV", "type": "text", "value": "development" } ],
      "openUrl": "http://localhost:{PORT}",
      "ready": { "kind": "port", "port": "PORT", "timeoutMs": 60000 } },
    { "id": "test", "label": "Test", "kind": "task", "cmd": "npm test", "cwd": ".", "env": [], "openUrl": null,
      "ready": { "kind": "immediate" } }
  ],
  "builtins": { "editor": true, "terminal": true, "fileManager": true, "copyCommand": true }
}
```

| Field | Rules |
| --- | --- |
| `setup` | Optional, up to 4000 characters. Runs once per checkout, before the first action |
| `id` | `^[a-z0-9][a-z0-9-]{0,39}$`, unique. At most 30 actions |
| `label` | Defaults to the id, cut to 40 characters |
| `kind` | `service` (keeps running: a dev server) or `task` (runs to an exit code: tests, a build) |
| `cmd` | Required, up to 4000 characters. Runs through `/bin/sh -c` |
| `cmdWin32` | Optional. Used instead of `cmd` on Windows, through `cmd.exe /d /s /c` |
| `cwd` | Relative to the worktree, default `.`. No absolute path, no `..` |
| `env` | Rows `{name, type: 'text' \| 'port', value}`. Names match `^[A-Za-z_][A-Za-z0-9_]{0,63}$` |
| `openUrl` | Optional. Must be an `http://` or `https://` address once placeholders are filled |
| `ready` | `immediate`, `port` or `output` (below). Tasks are always `immediate` |
| `builtins` | Each of the four is on unless set to `false` |

The process gets the server's environment minus `WORCA_HOME`, `WORCA_RUN_ROOT`, `WORCA_HOST_PID`
and every GitHub credential Worca holds, then the action's own `env` rows.

### Placeholders

`cmd`, `cmdWin32`, text `env` values and `openUrl` may use:

| Placeholder | Becomes |
| --- | --- |
| `{branch}` | The run's feature branch |
| `{worktree}` | The checkout folder |
| `{runId}` | The run id |
| `{member}` | The project key |
| `{NAME}` | The port given to this action's port variable `NAME` |
| `{alias.NAME}` | In a workspace stack: port variable `NAME` of the member with alias `alias` |

An unknown `{…}` is left as it is, and a `{` right after `$` is never a placeholder, so `${PORT}`,
`${X}` and shell braces reach the shell unchanged. `${PORT}` works too, because `PORT` is in the
environment.

### Port variables

An `env` row of type `port` gets a port number. `auto` (or an empty value) takes the first free
port of the range in Settings › Runs › Actions (default **4400–4499**), skipping ports another
action holds and probing `127.0.0.1`, `::1` and the wildcard address. A typed port (1024–65535) is
used as given; if another running action already holds it, the start goes ahead with a warning on
the card. When the range is used up, the start fails with `PORTS_EXHAUSTED`: widen the range.

### Ready checks

A service is **running** once its process starts, and **ready** once its check passes:

| `ready.kind` | Ready when |
| --- | --- |
| `immediate` | The process is running |
| `port` | Something accepts a connection on the port (`ready.port`, else the first port variable). Checked every 250 ms on `127.0.0.1`, then `::1`, so dev servers that bind `localhost` (Vite, Storybook on macOS) count |
| `output` | A line of the output contains `ready.text` |

`ready.timeoutMs` is 1 s to 10 min, default 60 s. On a timeout the service keeps running, and the
card says why (see [Troubleshooting](#troubleshooting)).

## Built-ins

Next to the project's own actions, each checkout offers four buttons (turn any off in `builtins`):

| Built-in | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Open in editor | The first of `code`, `cursor`, `idea`, `webstorm` on `PATH` | same | same (`.cmd` / `.bat` through `cmd.exe`) |
| Open terminal | `open -a Terminal <dir>` | `gnome-terminal`, `konsole`, `xfce4-terminal`, then `x-terminal-emulator` (needs a display) | Windows Terminal (`wt -d <dir>`), else Command Prompt |
| Open folder | `open <dir>` (Finder) | `xdg-open <dir>` (needs a display) | `explorer.exe <dir>` |
| Copy command | Copies the git commands that put the branch in your own clone (below) | | |

### Your own editor and terminal

Settings › Runs › Actions › **Editor** and **Terminal** replace the detection. Each takes a command line,
typed as you would in a terminal, and runs it through the system shell (`/bin/sh -c` on macOS and
Linux, `cmd.exe /d /s /c` on Windows), so arguments, quotes, `~`, `$VAR` / `%VAR%` and `&&` work.

- **`{folder}`** (or `{worktree}`) marks where the checkout folder goes, quoted for the shell. Without it the
  folder is added at the end, so a bare command such as `xed` works. `{branch}`, `{project}` and `{runId}`
  work too.
- **A macOS app** (`/Applications/Xcode.app`, or just `Xcode.app`) opens with `open -a`.
- **An unquoted path with spaces** at the start is quoted for you, such as
  `C:\Program Files\Microsoft VS Code\Code.exe --new-window`.
- **The dropdown** next to each field starts with **Browse…**, which opens your system's app picker on the
  machine that runs Worca (the macOS app chooser, a Windows file dialog for programs, zenity or kdialog
  on Linux), then lists the editors and terminals found there. Either way the field gets a working
  command line: a known app its own command (Xcode `xed {folder}`, VS Code its `code` tool), any other
  `open -a "<app>" {folder}` or `"<path>" {folder}`. Where no picker can open (a container, a hosted worca,
  `WORCA_NO_NATIVE_DIALOG=1`) Browse… is left out. The ⓘ next to each field shows examples for that
  machine's operating system.
- **Try** runs the line on your home folder and says on the field whether it opened, or why not (the
  shell's own error). A program Worca cannot find gives a warning on Save; the line is saved anyway.

To work in the checkout without leaving Worca, use the built-in [terminal](terminal.md).

| OS | Editor examples | Terminal examples |
| --- | --- | --- |
| macOS | `xed`, `open -a "Visual Studio Code" {folder}`, `/Applications/Zed.app` | `open -a iTerm {folder}`, `open -a Terminal {folder}` |
| Windows | `code {folder}`, `"C:\Program Files\Microsoft VS Code\Code.exe" --new-window {folder}` | `wt -d {folder}`, `start "" /D {folder} powershell -NoExit` |
| Linux | `code {folder}`, `zeditor {folder}` | `gnome-terminal --working-directory={folder}`, `konsole --workdir {folder}` |

The line runs as the user Worca runs as, whenever someone clicks the button. Saving it, and Try, are
refused for a possible agent under agent isolation, like the project actions config (see Security), and a
hosted worca runs neither unless `WORCA_ACTIONS_REMOTE=1` is set. With no editor found and none set, the
Editor button is not offered.

### Copy command

Copy command works without a checkout, in hosted mode, and with actions turned off. When the
branch was pushed:

```
git fetch <remote> <branch>
git switch <branch>
```

When it was not pushed, it points at the project folder instead:

```
cd "<project folder>"
git switch <branch>
```

The two lines are never joined with `&&`, so they also paste into Windows PowerShell 5.1.

## Keeping checkouts

A checkout stays until you **Discard** it, also across restarts. Settings › Runs › Actions › **Keep**
can check a run out by itself when it ends:

| Keep | After a run ends `done` |
| --- | --- |
| `never` (default) | Nothing: Check out when you want to try it |
| `on-success` | The checkout is kept |
| `until-pr` | Kept until its pull request is merged or closed. Checked at start-up and every hour; a run without a PR stays |

A kept checkout skips setup until its first action, which runs setup first (the card says "Setup
runs before the first action").

**Keep at most N** caps the number of checked-out runs. After every checkout and at start-up, the
oldest checkouts beyond N are discarded. A run with a running action is never discarded, and
neither is the run just checked out. Empty means no cap.

Discard saves uncommitted changes first, as `checkout-discard-<projectKey>-<timestamp>.patch` in
the run's artifact folder (or `<worca home>/actions/patches/<runId>/`). If that save fails, Discard
stops and asks before it throws the changes away.

## Conflicts with the base branch

When a run finishes (done, stopped or failed), Worca checks whether its branch still merges into its
base. It fetches the base from the project's sync remote (`origin/dev`, say). If there is no remote, it
uses the local base. If the fetch fails, it uses the last fetched copy and says "offline". The check
runs `git merge-tree` against the branch refs, so no checkout or worktree changes.

The History detail shows a short line under the title for each branch that needs something (one per
repository in a workspace run). Hover the status for when it was checked. A branch that is up to date
shows no line.

- **dev is N commits ahead, merges cleanly**: **Update branch** adds a merge commit of the base to
  the branch.
- **Conflicts in N files**, with the file list: resolve them in one of two ways.
  - **Resolve in a pipeline** starts a new run on the same branch. It runs the same unattended
    Implementation and Review workflow as a Watch PR fix run, with the same conflict brief, plus the
    listed files and the original task for context.
  - **Resolve in a terminal** checks the run out (as **Check out** does), starts the merge there with
    the conflicts left in the files, and opens the run's terminal with `git status`. Fix the files,
    commit the merge, then click **Re-check**.
- **Could not check against dev**: the check failed (the reason follows). **Re-check** tries again.

The History list notes "conflicts with dev" or "dev moved" on such runs. The check runs again when a
resolve run ends, on **Re-check**, and when you open the run's details if the branch was never checked
or was last checked more than 5 minutes ago. That automatic check reuses a fetch from the last minute
and pushes nothing: a resolution done in a terminal is finished by **Re-check**. It does not run on a
timer.

After Update branch or a resolution, a branch that was already published (Publish branch, Create PR, a
PR) is pushed again with a plain `git push`. Worca never force-pushes: if someone pushed to the branch
in the meantime, the push is refused and the merge stays local. The header then shows **Push changes**;
pull their work into the branch first, or that push is refused too. A resolution that still has conflict
markers (`<<<<<<<`, `>>>>>>>`) on the lines it added is not pushed (the same check Watch PR runs before
its push); the line reads "Conflict markers left in N files".

When the branch has an open pull request, the pull request owns its conflicts:

- **Resolve in a pipeline** isn't offered. Use **Resolve** on the pull request's row in the Overview tab
  (see [Watch PR](ui-levels.md)); its fix run pushes to the pull request.
- **Update branch** and **Resolve in a terminal** stay: Watch PR has neither.
- While a Watch PR fix run is working on the branch, Update branch, Resolve in a terminal and Re-check
  are refused until it finishes, so nothing moves the branch under it.
- The other way round, while a Resolve in a terminal is open on the branch, Watch PR starts no fix run
  on it. Closing that terminal lets the watch go on.

## Workspace stacks

A workspace's Actions tab defines **stacks**: one start for actions across members, in order.

```json
{ "stacks": [ { "id": "dev", "label": "Dev stack", "kind": "service",
  "steps": [ { "member": "api-1a2b3c4d", "action": "run", "env": [] },
             { "member": "web-5e6f7a8b", "action": "run",
               "env": [ { "name": "API_URL", "value": "http://localhost:{api.PORT}" } ] } ] } ] }
```

- `member` is the member's project key, `action` one of its action ids. Step `env` rows are text
  rows that add to, or override, that action's env for this stack only.
- Each member has an **alias**: its folder name in lower case, other characters turned into `_`.
  Members are taken in project-key order, and a clash gets `_2`, `_3`. The stack editor shows the
  alias. `{alias.NAME}` is the port an earlier step's variable `NAME` received.
- Steps start in order. A service step waits until it is ready, a task step until it exits 0.
  A member whose setup has not run yet runs it first.
- If a step fails, the services this stack started stop again, newest first. A service that was
  already running before the stack started is reused, and it is never stopped by the stack.
- **Stop** stops exactly what the stack started, newest first.
- A `task` stack may contain only task actions.

## Chat

Chat reads Actions and drafts their config, but it never runs anything.

| Tool | What it returns |
| --- | --- |
| `get_project_actions` | A project's setup, actions (commands included), built-ins, last setup time, and the stacks that use its actions |
| `get_workspace_stacks` | A workspace's stacks, and each member's alias and action ids |
| `get_run_checkout` | One run: each member's checkout, setup status and error, its actions, why Check out is refused, and the instances started for the run (status, ports, Open link, ready error, the last lines of the log) |
| `list_running_actions` | Every action still starting or running, on any run |
| `propose_actions_change` | A card with a project's new setup and actions, or a workspace's new stacks |

- **Configure from the chat.** Ask "set up actions for this project": Chat reads the project's
  files in a worktree (`package.json` scripts, a `Makefile`, the README) and proposes a card. The
  card shows every command word for word, next to what it replaces, and nothing is stored until you
  click **Save**. Saving goes through the same validation as the Project and Workspace Actions tabs.
- **Debug from the chat.** "Why is Run stuck on starting?" reads the instance's ready error and log
  tail. Usually the app listens on another port than the `PORT` Worca gave it.
- **No start, stop, check out or discard.** There is no tool for them: Chat names the button
  instead. Under agent isolation the card's Save is refused like the config routes
  (`ACTIONS_AGENT_BLOCKED`).
- **Redaction.** Commands and log lines are redacted like every other text Chat reads. An action
  that comes back with a redacted value is kept as stored when it is sent back unchanged. A changed
  one is refused, so a redaction marker is never saved.
- **Hosted.** The context's `deployment:` line says `actions=off` while `WORCA_ACTIONS_REMOTE` is
  unset, so Chat says why nothing can run.

Running services reach Chat through `<worca home>/actions/state.json`, which the server's
registry rewrites on every status change. It holds each active instance, the 20 newest finished
ones, and up to 40 log lines per instance.

## Security

- **Ids only.** Start, stop, setup, stack, built-in and Try it requests carry ids. A body with any of
  `cmd`, `cmdWin32`, `command`, `setup`, `env`, `cwd`, `shell` or `args` is refused with
  `400 RAW_COMMAND`. The command always comes from stored config. The one exception is **Try** next to Settings › Runs › Actions ›
  Editor and Terminal: it runs the line being edited, behind the same guards as saving it.
- **cwd pinned.** `cwd` must stay inside the worktree: checked when the config is saved, and again
  before every spawn.
- **Open links** are `http`/`https` only, checked on save and again before they are rendered.
- **Hosted (remote) mode.** Actions are refused with `403 ACTIONS_DISABLED` unless the server starts
  with `WORCA_ACTIONS_REMOTE=1`. It is an environment variable on purpose: in remote mode every
  signed-in person is an administrator of the UI (see [remote-access.md](remote-access.md#limits)),
  so a UI switch would let any of them turn it on. Check out still works and skips setup; Discard,
  Copy command and Ship It work as usual. Editing the config (a project's actions, a workspace's
  stacks) stays allowed, so an operator can prepare it before turning actions on; nothing it holds
  runs until then.
- **Agent isolation.** While isolation is on (the Docker image's default, see
  [docker.md](docker.md)), a caller on the box itself, over loopback or through one of the
  machine's own addresses, could be an agent. It is refused with `403 ACTIONS_AGENT_BLOCKED` on
  every route that runs a command, on both config writes, and on an `actions` key in
  `POST /api/settings` (the editor and terminal settings are commands too). Stop stays open.
  One gap remains: in **local** mode there is no identity, so a request an agent loops back through
  a published port arrives from the gateway and cannot be told apart from a person. Run an isolated
  box in remote mode.

## Windows

Checkouts live under the Worca home, and `node_modules` deep inside one can pass Windows'
260-character path limit. When the checkout path is longer than 120 characters, Check out warns:
enable long paths (`git config --system core.longpaths true` and the `LongPathsEnabled` policy) or
move the Worca home to a shorter path.

## Troubleshooting

| You see | Why, and what to do |
| --- | --- |
| "The app never listened on port 4417 that Worca gave it (PORT)." | The service runs, but nothing answered on its port within the timeout. The app ignores `PORT` or binds another one: pass it the port (`--port {PORT}`, or read `process.env.PORT`), or raise `ready.timeoutMs` for a slow start |
| "The run is still finishing …" | A run cleans up its worktree for a few seconds after it reads done. Try again in a moment. A run started from the CLI is not tracked by the server, so Check out during those seconds is not refused; wait for the CLI to exit |
| "Stop the running actions of this project before running setup again." (`SERVICES_RUNNING`) | Setup would rewrite files a running service uses. Stop its services, then Run setup again |
| "The setup command failed." (`SETUP_FAILED`) | Read the setup log on the card, fix the command (Project page › Actions), then **Run setup again** |
| "The branch … no longer exists locally or on a remote." | Nothing to check out. Copy command still shows the branch name |
| "Can't check out: … is already checked out in <path>." | Your own clone (or another worktree) has the branch. The card offers **Use that folder** instead (see "When the branch is already checked out in your folder"), or switch that folder to another branch and check out again |
| "<path> already exists and is not this run's checkout." | A folder sits where the checkout goes. Move or delete it; Worca never deletes it for you |
| A new run fails: the branch is "already checked out in worktree <path>" | A checkout holds the branch the new run wants. Discard the checkout, then start the run again |
| "No free port between 4400 and 4499 …" | Widen the port range in Settings › Runs › Actions |
| "Actions are turned off on this hosted deployment." | Remote mode without `WORCA_ACTIONS_REMOTE=1` (see [Security](#security)) |
| "Actions cannot be run or edited from inside the container …" | Agent isolation is on and the request came from the box itself. Open Worca through its published address |
