# Hardened box

One command starts Worca in a locked-down set of containers on your own machine. Agents run there with no model
key, no git token and no proxy login in their reach. The network has no route out except through an allow-list.

```bash
worca container up --hardened
```

## When to use this

**Who it is for.** One developer, on their own machine, who wants the strictest local setup. For example: agents
that work on repositories you do not fully trust, or tasks built from outside issues. A team that shares one Worca
needs a [Shared instance](shared-instance.md) instead. To compare all setups, see [Choose a setup](choose-a-setup.md),
and for the reasoning behind the claims, the [Security overview](security-overview.md).

**What you keep.** The same Worca: the UI on `http://localhost:4317`, workflows, chats, schedules and the CLI.
Your native install and your plain container are not changed.

**What changes.** No folder from your machine is mounted. Projects are cloned from the remote into the box. Results
leave as pushed branches and pull requests. You review them where you review any pull request.

**What it protects.**

- Agents cannot read a model key. The credential broker holds it, in a container of its own.
- Agents cannot read the git token. Worca holds it and hands it to its own git calls, one call at a time.
- Agents cannot read the corporate proxy login. The egress sidecar holds it, in a container of its own.
- Agents run under their own users. They cannot read Worca's settings, its database or its environment.
- Worca's network has no route out. The sidecar lets through only the hosts on the allow-list.
- No host folder is mounted. A writable mount of your checkout would let an agent plant a git hook or a config
  command. Your own git or IDE would then run it on your machine.

**Its limits.** It is not "no secrets". A secret you give a run on purpose stays in that run's reach, such as an
MCP registry secret. The boxes share your machine's kernel: a kernel exploit is out of scope. It runs on Docker only.
The full list is under [Known limits](#known-limits).

## Quick start

Requirements:

- Docker Desktop (macOS, or Windows with the WSL2 backend) or Docker Engine on Linux. Rootful Docker only.
- Docker Compose 2.24 or newer.
- On Windows: run every command from a WSL2 shell.
- The npm install of Worca, for the `worca` command.

```bash
worca container up --hardened        # checks this machine, asks for what is missing, starts the box
worca container status               # the posture report: one line per protection
worca container down                 # stop it; the data stays in its volumes
```

Open `http://localhost:4317`. Add a project with **Add project › Clone from URL** and its `https://` URL. From a
shell: `worca container run -- add --clone https://github.com/acme/api.git`.

The choice is remembered. After `up --hardened`, every `worca container` verb acts on the hardened box: `status`,
`down`, `logs`, `pull`, `run`, `shell` and `proxy`. `--hardened` or `--plain` on one call acts on that box once.

## What the setup asks

`up --hardened` (or `init --hardened`, which does not start the box) asks only for what `.env` lacks. It writes the
answers into the container `.env` (`worca container where` prints the folder), with mode 0600. A value you already
set is never overwritten. It never prints a secret.

| It asks for | Written as | Without a prompt |
| --- | --- | --- |
| The model credential: an Anthropic API key, or a subscription token from `claude setup-token` | `WORCA_BROKER_KEY_ANTHROPIC`, read by the broker only | `--model-key-file <file>`, or `WORCA_BROKER_KEY_ANTHROPIC` in the environment |
| Nothing: two shared secrets are generated | `WORCA_BROKER_SECRET`, `WORCA_EGRESS_SECRET` | always generated |
| The git host | picks the token variable and the hosts the allow-list needs | `--git-host github.com`, `dev.azure.com` or `bitbucket.org` |
| The git token | `GH_TOKEN`, `WORCA_ADO_TOKEN` or `WORCA_BB_TOKEN` | `--git-token-file <file>`, or `WORCA_GIT_TOKEN` (or the host's own variable) in the environment |
| The commit identity | `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | `--git-name`, `--git-email`; the default is your git config |
| Extra hosts for the allow-list: your package registry, an internal mirror | `WORCA_EGRESS_ALLOW` (the defaults, the git host's names, your extras) | `--allow pypi.org,files.pythonhosted.org` |
| The corporate proxy, when one is found or given | `HTTPS_PROXY`, host and port only | `--proxy proxy.acme.example:8080`, or `--no-proxy` |
| The proxy login | sent to the sidecar, never to `.env` | `--proxy-user 'ACME\jdoe'`, with the password on stdin |
| The corporate CA, for a proxy that re-signs TLS | `WORCA_CA_CERT` | `--ca-file <pem>`; the default is `NODE_EXTRA_CA_CERTS` or `SSL_CERT_FILE` |

`--yes` never prompts. It takes what the flags, the environment and this machine give, and refuses what is
missing. A script can run the whole setup:

```bash
export WORCA_BROKER_KEY_ANTHROPIC="$(cat ~/secrets/anthropic)"
printf '%s\n' "$PROXY_PASSWORD" | worca container up --hardened --yes \
  --git-token-file ~/secrets/github --proxy proxy.acme.example:8080 --proxy-user 'ACME\jdoe'
```

No flag takes a secret as its value: `ps` would show it. Secrets come from a file, the environment, a hidden prompt
or stdin.

The model credential goes to the broker's variable, never to `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. Those
two would reach Worca. A value of theirs in `.env` stays on your machine: the hardened box blanks both for Worca.

A proxy URL with a login in it is written without the login. Log in to the sidecar instead. For NTLM, that is the
only way. In a terminal the setup asks whether the proxy needs a login, and then asks for it with a hidden prompt.
Later: `worca container proxy login`.

## Before it starts

Each check fails with one line and starts nothing:

- Docker is installed and running. Podman, and Docker that runs rootless, are refused.
- Docker Compose is 2.24 or newer.
- The image is new enough for these compose files (the image labels `dev.worca.hardened-box` and
  `dev.worca.egress-sidecar`). The compose files ship with the npm package; the image tag is set separately
  (`WORCA_TAG` in `.env`).
- On Windows, the command runs from WSL2.
- No Claude or Codex sign-in, and no `apiKeyHelper`, is left on the box's volume. The broker refuses to start with
  one in agents' reach. The line names the files and the command that removes them.
- The plain container is not running. Both publish the same port.
- `--with` is refused. The hardened box has a fixed set of overlays. The ssh-agent overlay in particular: git goes
  over HTTPS with the token Worca holds.

## How the workflow differs

| | Plain container | Hardened box |
| --- | --- | --- |
| Your projects | your folders, mounted at the same path | cloned from the remote into the box's volume |
| Results | the agent edits your checkout | pushed branches and pull requests |
| Model key | in Worca's environment or Claude Code's sign-in | in the broker |
| Agents' user | Worca's own | their own users |
| Network | open (the allow-list is an option) | the allow-list, always |
| Git over ssh | the ssh-agent overlay | refused: HTTPS with a token |
| `worca container login` | logs Claude Code in | refused: the broker holds the credential |

A run works in a worktree on the box's volume. To see its changes, open its pull request, or fetch its branch from
the remote. The box has no copy of your local branches: push a branch first if a run should start from it.

Worca knows it runs in the hardened box: `compose.hardened.yml` sets `WORCA_BOX=hardened` on its container. The UI
follows that:

- **Add project** offers **Clone from URL** only. A line says why: a folder there would be on the box's own disk,
  not your machine. The server refuses a folder add too (`POST /api/projects` answers 409 `HARDENED_CLONE_ONLY`),
  and so does a chat's add-project card.
- **Open in editor**, **Open in terminal** and **Show in folder** are not offered. They would open inside the box,
  on nobody's screen. A saved editor or terminal command is not used there either.
- **Settings › General › Security** says **Hardened box** and shows what Worca's own process can see: the
  broker, the agent users, the allow-list, the proxy login in the sidecar and the default execution environment.
  The networks and mounts show only from the host: `worca container status` reads them.

## The posture report

`worca container status` on the hardened box prints one line per protection. Each line is read from the running
containers, not assumed from the files:

| Line | Read from |
| --- | --- |
| Agents run under their own users | the start-up line the entrypoint logs (`agents run as worca-agent; they cannot read …`) |
| Model key held by the broker | Worca's container environment (no model key, a broker address), the broker running, and Worca's `credentials: broker single` line |
| Proxy login in the sidecar | the sidecar's own status (`worca egress status`), and no login in Worca's proxy variables |
| Allow-list on, no route out | every network of Worca's container is internal, the sidecar runs in allow-list mode, and Worca points at it |
| No host project mount | the mounts of Worca's container: volumes only, plus the CA file read-only |

A line that is off says how to fix it. A rejected proxy login that the operator manages says the operator must
replace the login file, not `worca container proxy login`. `--json` prints the same as one JSON object, for a script. The exit code is
0 when every line is on, 1 when one is off or unknown, and 3 when the box is not running. When Worca refused to
start, the report shows its reason from the logs.

```text
Hardened box  running (compose project worca-hardened)
  on       Agents run under their own users   worca-agent, and one user per signed-in person: …
  on       Model key held by the broker       Worca's container holds none; the broker (single mode) adds it …
  on       Proxy login in the sidecar         the sidecar holds the login for proxy.acme.example:8080 (ACME\jdoe)
  on       Allow-list on, no route out        Worca's network has no route out; the sidecar lets through 8 hosts …
  on       No host project mount              projects live in the box's volume; results leave as pushed branches …
```

## How it is put together

`worca container up --hardened` runs `docker compose` with these files, in this order:

```bash
docker compose -f compose.yml -f compose.broker.yml -f compose.isolation.yml -f compose.egress.yml \
  -f compose.hardened.yml [-f compose.ca.yml] -f compose.proxy.yml up -d
```

- `compose.broker.yml`: the broker in single mode.
- `compose.isolation.yml`: one data volume and the agent users.
- `compose.egress.yml`: Worca on an internal network, the allow-list.
- `compose.hardened.yml`: no host mount, its own compose project (`worca-hardened`), and the UI relay.
- `compose.ca.yml`: only with a corporate CA. After `compose.hardened.yml`, which replaces Worca's mounts.
- `compose.proxy.yml`: always, and last. The sidecar runs `worca egress`, keeps the allow-list and logs in to the
  corporate proxy when there is one.

Docker publishes no port for a container that is only on an internal network. So a small relay (`ui`) publishes
`127.0.0.1:4317` and passes each connection on to Worca. Worca trusts the relay's address as a local caller.

The relay lets a connection through only from where the published port arrives: the gateway of its own default
route. It uses the same rule Worca applies in the plain container ([Network](docker.md#network)). Every other
caller is closed at once: an agent in Worca's container, the sidecar, any other container. No header and no name
lookup decides it. When the relay finds no such gateway, it does not start.

On Docker Desktop the published port may arrive from another address. Then the relay refuses every connection, and
the UI does not open. That fails closed. On Docker Desktop 28 for macOS it was checked: the published port arrives
from the gateway of the relay's default network, so the UI opens, and connections from Worca's container, the broker
and the sidecar are refused.

The broker's calls to the model provider go through the sidecar too. So the allow-list keeps `api.anthropic.com`,
and the proxy login applies to the broker.

The hardened box is its own compose project. Its containers and volumes (`worca-hardened_worca-data`,
`worca-hardened_broker-data`, `worca-hardened_egress-data`) are apart from the plain container's.

## Moving from the plain container

The plain container keeps its data in other volumes (`worca_worca-home`, `worca_claude-config`) and its projects in
your folders. None of that is carried over. The first `up --hardened` says so and names the old volumes. It never
touches them.

Stop the plain container first (`worca container down --plain`). Then clone your projects into the hardened box.
Schedules, workflows and settings start fresh.

## Upgrade

```bash
npm install -g @worca/app            # new compose files
worca container pull                 # the newest image for WORCA_TAG
worca container up                   # recreate the containers; the volumes stay
```

The compose files and the image must match. `up` refuses an image older than the compose files, with one line.

## Undo

```bash
worca container down                 # stop the hardened box; its volumes stay
worca container up --plain           # back to the plain container, with its own data
```

`up --plain` makes the plain container the remembered choice again. To delete the hardened box's data for good:
`docker volume rm worca-hardened_worca-data worca-hardened_broker-data worca-hardened_egress-data`. That deletes its
projects, runs and saved proxy login.

## Known limits

- **Not "no secrets".** The claim is: no model key, no git token and no proxy login in an agent's reach.
- **MCP registry secrets** stay readable by the agents of a run that uses them.
- **Bedrock, Vertex and Foundry** are not covered. The broker holds an Anthropic credential only.
- **One kernel.** The containers share your machine's kernel. A container escape is out of scope.
- **Docker only.** Podman, rootless Docker and other runtimes are refused for now.
- **The allow-list holds by host name.** A host on the list can receive anything an agent sends it. Keep the list
  short.
- **Single user.** Every request through the local port is you. Do not publish the port on a network.
- **Local branches stay local.** The box sees only what is on the remote.
- **Not tested on a real Docker daemon with a real corporate proxy yet.** The sidecar login was tested against a
  simulated NTLM proxy.

The plain container is not changed: see [Worca in a container](docker.md). It protects your machine, not the
projects it mounts.
