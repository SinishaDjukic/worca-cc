# Install

Installing Worca with npm, what it needs, and running it in a container or as a hosted service.

## npm

```bash
npm install -g @worca/app     # puts `worca` on your PATH
```

Install with the npm of the Node that is first on your `PATH` in a **new**
terminal. A global package lands under the Node that ran `npm install -g`: if
nvm was active then, but a new terminal starts with the system or Homebrew
Node, `worca` is not found there. Check in a fresh terminal:

```bash
command -v worca    # prints the path of the worca binary; nothing means it is not on PATH
```

**npm install scripts.** Newer npm versions warn about, or skip, the install
scripts of dependencies you have not approved. Approve the two Worca needs:

```bash
npm install -g @worca/app --allow-scripts=node-pty,protobufjs
```

`node-pty` is optional and is used only by the web UI's terminal pane (and the
commands Ask Worca runs in it); pipelines, mock or real, never load it. On
Linux its install script compiles it, so without it the terminal falls back
to plain pipes. On macOS the prebuilt `spawn-helper` can lack the execute bit;
Worca sets it the first time a terminal opens, and `worca doctor` prints the
exact `chmod +x <path>` when it cannot (prefix `sudo` for a root-owned global
install). `protobufjs`'s script only prints a version warning. See
[Without node-pty](terminal.md#without-node-pty).

## Requirements

- **Node.js >= 22.13.0** — the store is the built-in `node:sqlite`; on an older
  Node the CLI says so and exits.
- **git** — pull requests, Check out, Sync, Clone from URL and **Use git** need it
  (on Windows, Git for Windows' `git.exe` on `PATH`). Without git — on macOS,
  without the Xcode Command Line Tools — worca still opens and never runs git:
  it hides the branch, pull-request, Sync and Clone controls, a project run
  works on a copy of its folder (applied back with **Apply to folder**), a
  workspace run works on a copy of each member (each applied back on its own), and
  Workspaces, Marketplace, skill import, Team metrics and Team policy stay:
  GitHub-hosted sources work over HTTPS and other hosts say `Needs git`;
  installing git brings everything back without a restart. `WORCA_GIT=0` hides
  them on purpose, `WORCA_GIT=1` skips the check. The GitHub CLI (`gh`) is
  optional: it opens pull requests and issues.
- **The [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI**
  (`claude`) on your `PATH` and signed in (`claude`, then `/login`; an
  `ANTHROPIC_API_KEY` works too) — for real runs only; mock mode starts no
  `claude` at all. `WORCA_CLAUDE_BIN` points Worca at another binary.
- **Native Windows** — both the [native installer](https://docs.anthropic.com/en/docs/claude-code/setup)
  (`claude.exe`) and `npm install -g @anthropic-ai/claude-code` work: npm puts a
  `claude.cmd` shim on `PATH` that Node cannot spawn, so Worca runs the package's
  native `claude.exe` next to it instead. If that binary is still npm's placeholder
  (the package's `postinstall` didn't run) or there is none, Worca says what to do
  rather than a bare `ENOENT`; `WORCA_CLAUDE_BIN` can always point at a
  `claude.exe` directly.

## In a container

Prefer the agents to run in a disposable Linux box instead of on your machine?
The same Worca ships as an image (`ghcr.io/sinishadjukic/worca`, amd64 and arm64,
plus a `-full` variant) with a Compose file. The agents cannot read your host
credentials or touch files outside the project folders you mount; the box keeps
its own Worca home and Claude login. Needs Docker or Podman with `podman compose`.

```bash
worca container up        # writes ~/.worca-cc/container/, starts the box; UI on http://localhost:4317
worca container login     # log Claude Code in, once
```

`worca container help` lists the rest (`down`, `logs`, `pull`, `shell`,
`run -- <worca args>`, overlays via `--with egress,ssh,teams,clonein`). Without
npm, download `docker/compose.yml`, set `WORCA_PROJECTS` in a `.env` beside it
and `docker compose up -d`. See [`docs/docker.md`](docker.md) for login
options, git credentials, the egress allowlist, clone-in mode and Windows (WSL2).

## Hosted, behind Cloudflare Access

The same image runs as an always-on service: on Railway (or any host), reachable
only through a Cloudflare Tunnel with Cloudflare Access in front, and Worca
verifying the Access token on every request itself. On Railway the agents run as
their own user, cut off from Worca's settings, database and GitHub token. Step by step:
[`docs/deploy-railway.md`](deploy-railway.md); the Cloudflare side and the
security model: [`docs/remote-access.md`](remote-access.md). Upgrades,
configuration and checks of a running deployment:
[Operate your deployment](deploy-railway.md#operate-your-deployment), with
the `tools/railway/worca-railway.mjs` tool and this repository's
`/worca-railway` skill for Claude Code.

## Running the web UI

```bash
worca ui            # start it (worca --ui does the same)
```

Open the printed URL (default `http://localhost:4317`), add a project
(**Projects › Add project**: **New** by name, any **Folder**, or **Clone from URL**), and
click **New pipeline**: describe the task, pick a workflow and press
**Start run** — turn on **Mock mode** beside it to try a run offline, with no
Claude calls and no cost. At the Advanced [UI level](ui-levels.md) the
form also takes a markdown brief or a task pulled from a plugin source like
GitHub Issues or Azure Boards, the engine, guardrails, and **Schedule…** on the
Start run caret. Answer
clarify questions and loop gates as they come — in the browser or from chat.

The UI is one process per machine. Starting it while it is already up is not
an error — Worca prints the URL and how to restart it, and exits 0 (a port
held by another program is exit 1):

```bash
worca ui status                 # is it running? (exit 0 = yes, 1 = no)
worca ui restart                # stop the running one, start it again
worca ui stop                   # stop it gracefully
worca ui --port 4318 --open     # another port; open the browser when up
worca ui --mock                 # offline mock mode for every run
```

`--port` (or the `PORT` env var) picks the port; `stop`, `restart` and
`status` remember the port of the last started UI (`ui.json` in the Worca
home), so they usually need no flag. See `worca ui help`.

**Appearance.** Settings › General › Appearance picks **System** (follow the
operating system), **Light** or **Dark** — one setting for every browser that
opens this Worca. The web UI relies on CSS `light-dark()` (and `::backdrop`
inheriting the dialog's scheme), so it needs Chrome/Edge 123, Firefox 120 or
Safari 17.5 (or newer).

