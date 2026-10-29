# Install

How to install Worca with npm, what it needs, and how to run it in a container or as a hosted service.

## npm

```bash
npm install -g @worca/app     # puts `worca` on your PATH
```

Install with the npm of the Node that comes first on your `PATH` in a **new** terminal. A global package lands
under the Node that ran `npm install -g`. So if nvm was active when you installed, but a new terminal starts with
the system or Homebrew Node, that terminal won't find `worca`. Check in a fresh terminal:

```bash
command -v worca    # prints the path of the worca binary; nothing means it is not on PATH
```

### npm install scripts

Newer npm versions warn about, or skip, the install scripts of dependencies you haven't approved. Worca needs two of
them. Approve them like this:

```bash
npm install -g @worca/app --allow-scripts=node-pty,protobufjs
```

`node-pty` is optional. Only the web UI's terminal pane uses it, along with the commands Ask Worca runs there.
Pipelines never load it, mock or real.

- On Linux, its install script compiles it. Without it, the terminal falls back to plain pipes.
- On macOS, the prebuilt `spawn-helper` can lack the execute bit. Worca sets it the first time a terminal opens. If
  it can't, `worca doctor` prints the exact `chmod +x <path>` to run (prefix `sudo` for a global install owned by
  root).

`protobufjs`'s script only prints a version warning. See [Without node-pty](terminal.md#without-node-pty).

## Requirements

### Node.js 22.13.0 or newer

Worca's store is the built-in `node:sqlite`. On an older Node, the CLI says so and exits.

### git

Pull requests, Check out, Sync, Clone from URL and **Use git** need git. On Windows, that's Git for Windows'
`git.exe` on `PATH`. The GitHub CLI (`gh`) is optional. It opens pull requests and issues.

Worca still opens without git (on macOS, that means without the Xcode Command Line Tools), and then never runs git:

- It hides the branch, pull-request, Sync and Clone controls.
- A project run works on a copy of its folder, which you apply back with **Apply to folder**.
- A workspace run works on a copy of each member, and each is applied back on its own.
- Workspaces, Marketplace, skill import, Team metrics and Team policy stay. GitHub-hosted sources work over HTTPS,
  and other hosts say `Needs git`.

Installing git brings everything back without a restart. `WORCA_GIT=0` turns this no-git mode on on purpose, and
`WORCA_GIT=1` skips the check.

### The Claude Code CLI

Real runs need the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (`claude`) on your `PATH` and
signed in: run `claude`, then `/login`. An `ANTHROPIC_API_KEY` works too. Mock mode starts no `claude` at all.
`WORCA_CLAUDE_BIN` points Worca at another binary.

### Native Windows

Both the [native installer](https://docs.anthropic.com/en/docs/claude-code/setup) (`claude.exe`) and
`npm install -g @anthropic-ai/claude-code` work. npm puts a `claude.cmd` shim on `PATH` that Node can't spawn, so
Worca runs the package's native `claude.exe` next to it instead.

If that binary is still npm's placeholder (the package's `postinstall` didn't run), or there is none, Worca tells
you what to do instead of failing with a bare `ENOENT`. `WORCA_CLAUDE_BIN` can always point at a `claude.exe`
directly.

## In a container

If you'd rather the agents run in a disposable Linux box than on your machine, the same Worca ships as an image:
`ghcr.io/sinishadjukic/worca`, for amd64 and arm64, plus a `-full` variant, with a Compose file. The agents can't
read your host credentials or touch files outside the project folders you mount. The box keeps its own Worca home
and Claude login. You need Docker, or Podman with `podman compose`.

```bash
worca container up        # writes ~/.worca-cc/container/, starts the box; UI on http://localhost:4317
worca container login     # log Claude Code in, once
```

`worca container help` lists the rest: `down`, `logs`, `pull`, `shell`, `run -- <worca args>`, and overlays via
`--with egress,ssh,teams,clonein`.

Without npm, download `docker/compose.yml`, set `WORCA_PROJECTS` in a `.env` beside it and run
`docker compose up -d`.

See [Worca in a container](docker.md) for login options, git credentials, the egress allowlist, clone-in mode and
Windows (WSL2).

## Hosted, behind Cloudflare Access

The same image runs as an always-on service, on Railway or any other host. It's reachable only through a Cloudflare
Tunnel with Cloudflare Access in front, and Worca checks the Access token on every request itself. On Railway, the
agents run as their own user, cut off from Worca's settings, database and GitHub token.

- Step by step: [Deploy on Railway](deploy-railway.md).
- The Cloudflare side and the security model: [Remote access](remote-access.md).
- Upgrades, configuration and checks of a running deployment:
  [Operate your deployment](deploy-railway.md#operate-your-deployment). It uses the
  `tools/railway/worca-railway.mjs` tool and this repository's `/worca-railway` skill for Claude Code.

## Running the web UI

```bash
worca ui            # start it (worca --ui does the same)
```

Open the printed URL (by default `http://localhost:4317`) and add a project under **Projects › Add project**: **New**
by name, any **Folder**, or **Clone from URL**. Then click **New pipeline**, describe the task, pick a workflow and
press **Start run**. To try a run offline, with no Claude calls and no cost, turn on **Mock mode** beside it.

At the Advanced [UI level](ui-levels.md), the form also takes a markdown brief or a task from a plugin source such
as GitHub Issues or Azure Boards. It adds the engine, guardrails, and **Schedule…** on the Start run caret. Answer
clarify questions and loop gates as they come, in the browser or from chat.

### One UI per machine

The UI runs as one process per machine. Starting it while it's already up isn't an error: Worca prints the URL and
how to restart it, and exits 0. A port held by another program exits 1.

```bash
worca ui status                 # is it running? (exit 0 = yes, 1 = no)
worca ui restart                # stop the running one, start it again
worca ui stop                   # stop it gracefully
worca ui --port 4318 --open     # another port; open the browser when up
worca ui --mock                 # offline mock mode for every run
```

`--port`, or the `PORT` env var, picks the port. `stop`, `restart` and `status` remember the port of the last UI you
started (`ui.json` in the Worca home), so they usually need no flag. See `worca ui help`.

### Appearance

Settings › General › Appearance picks **System** (follow the operating system), **Light** or **Dark**. It's one
setting for every browser that opens this Worca.

The web UI relies on CSS `light-dark()`, and on `::backdrop` inheriting the dialog's colour scheme. It needs Chrome
or Edge 123, Firefox 120 or Safari 17.5, or newer.
