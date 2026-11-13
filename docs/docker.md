# Worca in a container

An alternative to `npm install -g @worca/app`: Worca and every headless `claude`
it spawns run inside a disposable Linux container. An agent that goes off the
rails damages a box, not your machine. Design and trade-offs:
[`plans/container-isolation-design.md`](../plans/container-isolation-design.md).

What the box gives you that guardrails alone cannot (see
[guardrails.md](guardrails.md), "Honest limitations"): the agents cannot read
host credentials (`~/.ssh`, `~/.aws`, keychains, browser profiles), cannot touch
files outside the project folders you mount, cannot see host processes, and
with the egress overlay cannot reach hosts you did not allow. What it does
**not** give you: protection of the mounted project itself (the agent is meant
to edit it) — see *Clone-in mode* for that.

## Quick start

Requirements: Docker Desktop (macOS, or Windows with the **WSL2 backend**),
Docker Engine (Linux) or Podman with `podman compose`.

**With the npm install** (`worca container` writes the compose files and a
`.env` into `~/.worca-cc/container/` and drives `docker compose` for you):

```bash
worca container up                # writes ~/.worca-cc/container/{compose*.yml,.env}, starts the box
worca container login             # log Claude Code in, once
worca container run -- --project ~/dev/api --prompt "Add a /search endpoint"
worca container down
```

`.env` is seeded with the common parent of your registered projects (or
`~/dev`), your timezone and git identity; edit it for tokens and tags. `--with
egress,ssh,teams,clonein` on `up` adds overlays and is remembered for the other
verbs. `worca container help` lists everything.

**Without npm**, the compose file alone:

```bash
mkdir worca && cd worca
curl -fsSLO https://raw.githubusercontent.com/SinishaDjukic/worca-cc/dev/docker/compose.yml
echo "WORCA_PROJECTS=$HOME/dev" > .env          # the folder that holds your repos
docker compose up -d                              # UI on http://localhost:4317
docker compose run --rm worca claude              # log Claude Code in, once
```

Open `http://localhost:4317`, add a project by typing its path (it is mounted at
the same path inside the container), and run a pipeline. Mock mode works before
you log in.

Upgrade: `docker compose pull && docker compose up -d`. The database migration
runs at boot, as with npm. Stop: `docker compose stop`. Everything you would
change lives in `.env` ([`docker/.env.example`](../docker/.env.example) lists it
all); the compose file itself is never edited.

The CLI is the same container with another command, sharing the volumes:

```bash
docker compose run --rm worca worca --project ~/dev/api --prompt "Add a /search endpoint"
docker compose run --rm worca worca resume 1a2b3c4d
docker compose run --rm worca worca metrics push
```

## Images

`ghcr.io/sinishadjukic/worca`, `linux/amd64` and `linux/arm64`, built from the
same tag as the npm package with provenance, an SBOM and a keyless cosign
signature:

| Tag | Holds |
| --- | --- |
| `latest`, `1`, `1.3`, `1.3.0` | the newest stable @worca/app, Node 24, git, `gh`, a pinned Claude Code |
| `rc`, `1.3.0-rc.1` | the newest release candidate |
| `…-full` | the above plus Python 3, build tools and Chromium (the manual web-UI-testing agent, Python projects, native npm modules, the Architecture (C4) JPEG/PNG export and the Presentation PDF and audit) |
| `1.3.0-20260921` | a weekly rebuild of that version with the newest Debian packages |

The **worker image**, `ghcr.io/sinishadjukic/worca-worker`, runs one run's or one chat's agents
in a container of its own for a controller running the image above (`worca worker`; see
[Worker image contract](#worker-image-contract) and `docs/workers.md`). Same tags, each with the
engine it carries; built from the same `docker/Dockerfile` (its `worker` target), signed the same way:

| Tag | Holds |
| --- | --- |
| `worca-worker:1.3.0-claude`, `…-claude-full`, `latest-claude`, `rc-claude`, … | Worca's worker and a pinned Claude Code; `-full` adds what the controller's `-full` has, plus `uv` and the Railway CLI |
| `worca-worker:1.3.0-<engine>` for `codex`, `copilot`, `gemini`, `qwen`, `opencode`, `goose`, `cursor` | the worker and that one engine CLI, at the version [`docker/engines.env`](../docker/engines.env) pins (slim only) |
| `worca-worker:1.3.0-all`, `…-all-full` | every engine Worca knows, in one image |

Each worker image labels its engine: `docker inspect --format '{{index .Config.Labels "dev.worca.engine"}}' <image>`,
and `docker run --rm <image> worca worker --check` prints the engines it finds, with their versions, as JSON.
The `goose` and `cursor` images (and `all`, which holds them) depend on upstream releases that do not
exist for every architecture every time, so a release may lack them while every other image ships.

Verify with cosign 3 or later: images are signed with cosign 3, whose new bundle format cosign 2
doesn't find; cosign 3 verifies the older images too.

```bash
cosign verify ghcr.io/sinishadjukic/worca:1.3.0 \
  --certificate-identity-regexp 'https://github.com/SinishaDjukic/worca-cc/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The pinned Claude Code version is a label: `docker inspect --format '{{index .Config.Labels "dev.worca.claude-code.version"}}' <image>`.
The CLI's own updater is off inside the image; a newer CLI is a newer image tag.
The slim image has no compiler, so node-pty (the terminal's PTY) is skipped and terminals run over pipes; the -full image builds it.
The slim image has no browser either: an Architecture (C4) run there writes SVG only and its report says why, and a Presentation run's PDF step reports that it found no browser unless you deselect the PDF. The -full image runs Chromium headless without its own sandbox (Docker's default seccomp profile refuses it to a non-root user); the container is the boundary.

**Your project needs a toolchain the image lacks?** Pull `-full`, or extend:

```dockerfile
FROM ghcr.io/sinishadjukic/worca:1.3.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends rustup && rm -rf /var/lib/apt/lists/*
USER worca
```

and point `image:` at your build in a `compose.override.yml`.

## Logging Claude Code in

Four ways; the first needs no secret on your disk.

1. **Interactive login into the volume** (subscription accounts):
   `docker compose run --rm worca claude`, open the printed URL in your browser,
   paste the code. Credentials land in the `claude-config` volume and every later
   run finds them. `claude logout` revokes. The host's `~/.claude` is deliberately
   not mounted: on macOS the token is in the Keychain (nothing to mount), and on
   Linux the mount would hand agents your host Claude Code config and memory.
2. **Long-lived token** for machines nobody can do the browser dance on:
   `claude setup-token` on any logged-in machine, then `CLAUDE_CODE_OAUTH_TOKEN=…`
   in `.env` (`chmod 600 .env`).
3. **API key.** `ANTHROPIC_API_KEY=…` in `.env` works but is visible to every
   child process. Better: a compose secret. Put the key in a file, add

   ```yaml
   # compose.override.yml
   services: { worca: { secrets: [anthropic_api_key] } }
   secrets: { anthropic_api_key: { file: ./anthropic_api_key } }
   ```

   The entrypoint writes `apiKeyHelper: cat /run/secrets/anthropic_api_key` into
   the container's Claude Code settings on first start; the key never enters the
   environment, and the Normal and Strict guardrail sets deny `Read` on
   `/run/secrets/**`.
4. **Bedrock / Vertex / Foundry:** the same `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_*`
   (etc.) variables as with npm, in `.env`. Strict's env scrub needs them in its
   allowlist, exactly as today.

## Git credentials and identity

Independent of Claude Code auth. Needed for one-click PRs, the GitHub Issues
source, the `worca-metrics` / `worca-policy` branches and clone-in mode.

| Need | Do |
| --- | --- |
| HTTPS to GitHub | `GH_TOKEN=github_pat_…` in `.env`, or a read/write pair (`WORCA_GH_READ_TOKEN`, `WORCA_GH_WRITE_TOKEN`), or a GitHub App (`WORCA_GH_APP_ID` + `WORCA_GH_APP_KEY_FILE` or `WORCA_GH_APP_KEY_B64`, [setup](deploy-railway.md#github-app)). Worca passes the token to its own git and gh calls one call at a time; agents never get it, in any guardrail set |
| SSH remotes | `docker compose -f compose.yml -f compose.ssh.yml up -d` forwards your agent socket (Docker Desktop: automatic; Linux: `WORCA_SSH_SOCK=$SSH_AUTH_SOCK`). Keys never enter the box; the socket does, so pair it with the egress overlay for untrusted tasks |
| Commit identity | `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` in `.env` (agents commit in run worktrees; git refuses without one) |

### Azure DevOps

`WORCA_ADO_TOKEN=<PAT>` in `.env` (or a read/write pair, `WORCA_ADO_READ_TOKEN` and
`WORCA_ADO_WRITE_TOKEN`) lets Worca clone, fetch, push and open pull requests on
`dev.azure.com` and `*.visualstudio.com` repositories. `compose.yml` passes these three
through. Like the GitHub token, Worca hands it to its own git calls and REST requests one
call at a time, and agents never get it. The entrypoint logs which mode it found (`Azure
DevOps: one token for clone, push and PRs, per call`, or `split read/write tokens`). With the
egress overlay, add `dev.azure.com,.visualstudio.com,vssps.dev.azure.com` to
`WORCA_EGRESS_ALLOW`; the default list is GitHub's only. The Azure Boards task source reads its
own token (`WORCA_ADO_BOARDS_TOKEN`), which `compose.yml` does not pass: add it in a
`compose.override.yml`. Scopes, URL shapes and limits: [Azure DevOps](azure-devops.md).

### Bitbucket

`WORCA_BB_TOKEN=<token>` in `.env` (or a read/write pair, `WORCA_BB_READ_TOKEN` and
`WORCA_BB_WRITE_TOKEN`; plus `WORCA_BB_EMAIL` for an Atlassian API token) lets Worca clone, fetch, push and
open pull requests on `bitbucket.org`. `compose.yml` passes these four through. With the egress overlay, add
`bitbucket.org,api.bitbucket.org` to `WORCA_EGRESS_ALLOW`. Scopes and limits: [Bitbucket](bitbucket.md).

## Projects, paths and worktrees

Worca isolates every run in a `git worktree`, and git records **absolute paths**
in both directions (`.git/worktrees/<name>/gitdir`, the worktree's `.git` file).
Worca's own database records project paths too. So the container should see
your repositories at the **same path** as the host:

| Host | What to do |
| --- | --- |
| macOS, Linux | the default: `WORCA_PROJECTS=/Users/me/dev` is mounted at `/Users/me/dev`. `git worktree list` on the host shows a run's checkout under `<repo>/.worca-cc/worktrees/<id>` as it does with npm |
| Windows | run `docker compose` from a **WSL2 shell** with the repos inside the distro (`/home/me/dev`). Repos under `C:\` go through a slow 9p bridge and cannot have parity |
| projects on a foreign path | `WORCA_PROJECTS_MOUNT=/projects` mounts them there. Host `git worktree list` then shows the run's worktrees as *prunable* while runs are live; do not prune |

Two rules:

- **One home per install.** The container's `/worca` volume and a host
  `~/.worca-cc` are two Worcas with two histories. Never mount the host home into
  the container.
- The native folder dialog does not exist in the box. **Add project** opens on **New** (a project by name in your projects root); its **Folder**
  tab's **Choose folder…** uses the in-app folder browser, which starts at your projects root.

### Clone-in mode

No bind mount at all. `/projects` is a volume, the repo is cloned inside, results
leave only as pushed branches and PRs. The strongest tier, and the right setup
for a shared pipeline box or scheduled runs nobody watches:

```bash
docker compose -f compose.yml -f compose.clonein.yml up -d
docker compose -f compose.yml -f compose.clonein.yml run --rm worca gh repo clone acme/api /projects/api
docker compose -f compose.yml -f compose.clonein.yml run --rm worca worca add --path /projects/api
```

Needs git credentials (above). `gh repo clone` reads `GH_TOKEN`; with a read/write pair, add
`-e GH_TOKEN="$WORCA_GH_READ_TOKEN"` to that `run`.

## Network

**Inbound:** only the UI port, published on `127.0.0.1`. The server accepts
`localhost` Host headers only, and only from a loopback peer or the container's
gateway, which is where Docker's published port arrives from. A LAN address
answers 403, and so does any other container on the compose network (the
egress proxy, the broker, cloudflared) even when it sends `Host: localhost`;
that is the single-user contract the npm install has too. Reach it from another
machine with `ssh -L 4317:127.0.0.1:4317 box` or Tailscale, both of which
arrive through the published port. A dev server an agent starts inside the box is not published; add a
`ports:` line in a `compose.override.yml` if you need to see one.

Only the gateway of the container's default route is trusted, never the gateway of another route
(`/proc/net/route`). Two setups need care:

- **`network_mode: host`.** The box then shares the host's routes, so its default-route gateway is your
  LAN router, and worca would trust the router as if it were Docker's port proxy. A router that forwards a
  port with source NAT would then pass internet callers through. With host networking, set
  `WORCA_HOST=127.0.0.1`: there is no published port to serve, and only callers on the host get in.
- **Docker Desktop, rootless Docker and Podman.** Rootful Docker on Linux was checked with real sockets
  (`tools/docker-linux-pass.sh`): the published port arrives from the default-route gateway. Docker
  Desktop's port proxy, rootlesskit and Podman's pasta/slirp4netns can present another source address.
  Then every request through the published port answers 403 (`worca is a localhost-only tool`), and
  nothing is let in that should not be. If you see that, run the image under rootful Docker, or use
  `network_mode: host` with `WORCA_HOST=127.0.0.1` as above.

**Outbound**, open by default (agents run `npm install`):
`api.anthropic.com` (the only Anthropic host; telemetry is off in the image),
your git host, package registries, and the chat platforms (Telegram, Slack,
Discord all dial out).

### Corporate proxy and CA

Set the corporate proxy in `.env` (`HTTPS_PROXY=http://proxy.corp:3128`,
`NO_PROXY`). Compose takes a variable from the shell before `.env`, so an
exported `HTTPS_PROXY` wins over the file. When `worca container` prefers a
`.env` value, it unsets the shell variable and compose reads the file itself.

Never give the box a `127.0.0.1` proxy: inside the container that address is
the container itself. A terminal Worca opens with the
[network proxy](network-proxy.md) on carries exactly such a proxy (Worca's
local one). `worca container up`, `run`, `login` and `shell` never pass it in:

1. a non-loopback `HTTPS_PROXY` in `.env` wins;
2. else the box gets `networkProxy.upstream` from this machine's
   `settings.json`, host and port only, when that proxy needs no login and
   `networkProxy.enabled` is not `false`;
3. else the box gets no proxy, and one line says so. A proxy that needs a login
   is set up in the box's own Worca: its Settings › Network proxy, then
   `worca container run -- proxy login`.

A `.env` proxy on loopback gets the same warning.

A proxy that re-signs TLS needs its CA inside the box. Put the CA, as a PEM
file, in `.env`:

```bash
WORCA_CA_CERT=/Users/me/certs/corporate-ca.pem
```

`worca container` then adds `compose.ca.yml` by itself. Without `WORCA_CA_CERT`
it uses the shell's `NODE_EXTRA_CA_CERTS`, then `SSL_CERT_FILE`. With raw
compose, add `-f compose.ca.yml`. The overlay mounts the file read-only at
`/etc/worca/corporate-ca.pem` and sets `NODE_EXTRA_CA_CERTS` for Worca, Claude
Code and npm. The entrypoint writes the system bundle plus your CA to a new
directory under `/tmp` that only the box's own user can write. It points
`SSL_CERT_FILE`, `GIT_SSL_CAINFO`, `CURL_CA_BUNDLE` and `REQUESTS_CA_BUNDLE`
at that bundle, so git, curl, `gh` and Python trust the CA too. The box runs
without root, so the system trust store (`update-ca-certificates`) is left
alone. Docker Desktop mounts only shared folders (`/Users`, `/tmp` and
`/private` by default), so keep the PEM there. `docker compose logs worca`
says `corporate CA: trusted from …`.

Agents and plugins keep these variables under every guardrail set, including
one that scrubs the agent environment.

### Egress allowlist

```bash
docker compose -f compose.yml -f compose.egress.yml up -d
```

Worca moves to an internal network with no route out; a proxy from the same
image relays only to allowed hosts (`WORCA_EGRESS_ALLOW` in `.env`, default:
`api.anthropic.com,github.com,.github.com,.githubusercontent.com,registry.npmjs.org`).
Tools that honour `HTTPS_PROXY` reach allowed hosts; a raw socket from
`node -e` or `python -c` reaches nothing. Combine with the **Strict** guardrail
set for an untrusted task. Known needs: add your package registry; Playwright's
browser download needs its CDN or a pre-fetched browser; plugin task sources and
chat channels go through the proxy too, so add their hosts: `dev.azure.com` for
Azure Boards, `api.telegram.org`, `slack.com,.slack.com` (Socket Mode dials a
`wss-*.slack.com` host), `discord.com,.discord.gg`, and for Teams
`login.microsoftonline.com,login.botframework.com` plus your bot's service URL host.
A Jira source drives its own command-line tool: allow `<your-org>.atlassian.net`,
and it goes through the proxy only if that tool reads the proxy variables.

An entry with a leading dot (`.github.com`) allows every subdomain and the name
itself. A refused host gets `403 egress denied: <host>`; `docker compose logs
egress` has one `ALLOW` / `DENY` line per connection. The proxy is
`src/core/egress-proxy.mjs`, which the image installs as
`/usr/local/lib/worca-egress-proxy.mjs`.

A hosting platform can instead set an outbound network policy with
`WORCA_EGRESS_MODE` (`open`, `block`, `allow`) plus `WORCA_EGRESS_DENY`. Then
worca runs the same proxy on loopback inside its own container, the default
list above never applies, and a leading dot means subdomains only
([remote-access.md → Outbound network policy](remote-access.md#outbound-network-policy-hosting-platform)).
Without the internal network that is weaker than this overlay: a tool that
ignores `HTTPS_PROXY` goes direct. Leave `WORCA_EGRESS_MODE` unset with the
overlay; set on the `egress` service it switches the sidecar to the same mode
semantics.

### Teams

The one chat channel needing an inbound URL. `compose.teams.yml` adds a
`cloudflared` sidecar that dials out and forwards to the token-guarded ingress
route; set `CLOUDFLARE_TUNNEL_TOKEN` for a stable URL or read the quick-tunnel
URL from `docker compose logs teams-tunnel`.

## Reference

| `.env` variable | Default | Meaning |
| --- | --- | --- |
| `WORCA_PROJECTS` | `$HOME/dev` | host folder with your repos, mounted at the same path |
| `WORCA_PROJECTS_MOUNT` | same as above | mount it elsewhere inside (loses parity) |
| `WORCA_TAG` | `latest` | image tag |
| `WORCA_IMAGE` | `ghcr.io/sinishadjukic/worca` | image name without the tag (a mirror, or `worca` for a local build); the default worker image is `<WORCA_IMAGE>-worker` |
| `WORCA_WORKER_IMAGE` | derived: `<WORCA_IMAGE>-worker:<tag>-<engine>` | with the `workers` overlay: the worker image per engine (`{engine}` is the engine of the run or chat, and of each helper job); `self` = the worca image ([Workers](#workers-agents-in-their-own-containers)) |
| `WORCA_WORKER_MEM`, `WORCA_WORKER_CPUS`, `WORCA_WORKER_PIDS` | `4g`, `2`, `2048` | each worker container's memory, CPU and process limits |
| `WORCA_WORKER_MAX` | `20` | worker containers at once |
| `WORCA_WORKER_PORT` | `4319` | the controller's worker listener on the compose network; never published |
| `WORCA_UPLINK_NETWORK` | `default` | with the `workers` overlay: the network the controller shares with its workers; `internal` together with the egress overlay (`worca container up --with egress,workers` sets it) |
| `WORCA_WORKER_NETWORK` | chosen | the controller network workers join, when the automatic choice (never the Docker API one, an internal one first) is not the one you want |
| `WORCA_WORKER_USER` | the controller's own user | the `uid:gid` worker containers run as |
| `WORCA_WORKER_START_TIMEOUT_MS`, `WORCA_WORKER_CHAT_IDLE_MS`, `WORCA_WORKER_CAP_WAIT_MS`, `WORCA_DOCKER_TIMEOUT_MS` | see [workers.md](workers.md#configuration) | worker timing, passed to the controller when set |
| `WORCA_INSTANCE_ID` | the Compose project | which installation worker containers belong to, when two share a Docker host |
| `WORCA_PORT` | `4317` | host loopback port |
| `TZ` | `UTC` | **scheduled runs use this clock** |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | | commit identity |
| `GH_TOKEN` | | GitHub over HTTPS |
| `WORCA_ADO_TOKEN`, `WORCA_ADO_READ_TOKEN`, `WORCA_ADO_WRITE_TOKEN` | | Azure DevOps over HTTPS ([Azure DevOps](#azure-devops)) |
| `WORCA_BB_TOKEN`, `WORCA_BB_READ_TOKEN`, `WORCA_BB_WRITE_TOKEN`, `WORCA_BB_EMAIL` | | Bitbucket over HTTPS ([Bitbucket](#bitbucket)) |
| `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` | | see *Logging in* |
| `WORCA_UID`, `WORCA_GID` | `1000` | Linux Engine: your ids (`id -u`, `id -g`) when not 1000, so the box can write your bind-mounted repos; the volumes work for any uid |
| `WORCA_MEM`, `WORCA_CPUS` | `6g`, `4` | resource caps (`pids_limit` 2048 is fixed) |
| `HTTPS_PROXY`, `NO_PROXY` | | corporate proxy, never on loopback (see [Corporate proxy and CA](#corporate-proxy-and-ca)) |
| `WORCA_CA_CERT` | | the corporate CA (PEM) for a proxy that re-signs TLS; `compose.ca.yml` |
| `WORCA_EGRESS_ALLOW` | see above | egress overlay allowlist |
| `WORCA_EGRESS_MODE`, `WORCA_EGRESS_DENY` | | a hosting platform's outbound network policy (see [Egress allowlist](#egress-allowlist)); leave unset with the overlay |
| `WORCA_SSH_SOCK` | Docker Desktop's | ssh overlay, Linux |
| `CLOUDFLARE_TUNNEL_TOKEN` | | teams overlay |

Inside the image: `WORCA_HOST=0.0.0.0` (port publishing needs it; the Host
guard and the peer check keep the effect to the published port, see Network),
`WORCA_HOME=/worca`,
`WORCA_NO_NATIVE_DIALOG=1`, `DISABLE_AUTOUPDATER=1`,
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. The container runs as uid 1000
with all capabilities dropped, `no-new-privileges`, a 2 GB tmpfs `/tmp` and no
Docker socket. `worca ui stop` on the host does nothing to the box; use
`docker compose stop`. `--open` is a no-op inside.

**Stopping without losing work.** A stop (`docker compose stop`, a redeploy, an upgrade) pauses
every active run before the server exits: worca stops starting new runs, pauses each run with the
reason "worca was restarting" (its resume point is saved, as on a Pause click) and waits up to
`WORCA_DRAIN_TIMEOUT_MS` (20 s) for those pauses to land, then shuts down. The runs come back
**paused**, not interrupted: Resume continues from the same step. Give the container a stop
grace period longer than the drain (`compose.yml` sets `stop_grace_period: 30s`; `docker stop -t
30`), or Docker kills it halfway. `POST /api/drain` does the same without exiting, from inside the
container (or, behind a hosted platform, with `WORCA_HEARTBEAT_TOKEN` as a Bearer token), so a
platform can drain first and then stop quickly.

The next start resumes those runs by itself, each as the person who last started or resumed it.
Set `WORCA_AUTO_RESUME=0` to turn that off, or `WORCA_AUTO_RESUME=1` to also resume runs it finds
interrupted by a crash. Runs paused by a person, by a cost cap or by a usage limit always wait for a person.

A headless CLI run (`worca --yes`, `worca resume`) handles a stop the same way. On SIGTERM it pauses the
run with the reason "worca was stopped", waits for the resume point to be saved, and exits 143. A second
SIGTERM changes nothing. A task source hears `needs-human`, because nothing resumes a CLI run by
itself: continue it with `worca resume <id>`. If the pause has not landed after
`WORCA_SIGTERM_GRACE_MS` (20 s), the CLI exits anyway, before the platform's SIGKILL.

**Single-volume hosts** (Railway and other platforms that give a service one volume,
mounted root-owned): set `WORCA_DATA_DIR=/data`, mount the volume there and start
the container as root. The entrypoint prepares the volume (worca home, projects and
`HOME` all under `/data`), then drops to the `worca` user; started non-root on a
volume it can't write, it exits 78 and names the fix. See
[deploy-railway.md](deploy-railway.md).

In that mode agents also run as their own user, `worca-agent`. It shares the projects,
run checkouts and run store with `worca` through the `worca-share` group, but cannot
read worca's settings, database, `HOME` or environment. Give Claude Code a token or key
as a variable (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`); a login stored in
worca's `HOME` is not visible to agents. `WORCA_AGENT_ISOLATION=0` turns it off. A
bind-mount setup keeps one user, so files agents write on your disk keep your uid.
While isolation is on, a caller on the box itself (loopback, or one of the container's own
addresses) may be an agent, so worca's API and WebSocket refuse it (`403 AGENT_CALLER_BLOCKED`)
unless it sends the server's per-boot token in `X-Worca-UI-Token`. The token is in
`$WORCA_HOME/.worca-cc/ui.json` (mode 0600, readable by `worca`, not by `worca-agent`) and in no
environment, and the `worca` CLI sends it, so `docker compose exec worca worca run --preset …`
keeps working. Without it a caller reaches only `GET /api/health` and the per-turn Ask relay
routes, which check their own token. So an agent cannot link or run a plugin, start a command,
or change guardrails, settings, schedules or `.mcp.json` approvals as the `worca` user, and it
cannot read other people's chats. A configured `WORCA_IDENTITY_HEADER` is ignored from the box
itself, so put the identity proxy in front, not inside. To drain from inside the container, send
the token: `curl -X POST -H "Host: localhost" -H "X-Worca-UI-Token: $(jq -r .token "$WORCA_HOME/.worca-cc/ui.json")"
http://127.0.0.1:4317/api/drain`. In local mode there is no identity, so a request an agent
loops back through a published port cannot be told apart from a person: run an isolated box in
remote mode.

Plugin task-source connectors and chat-channel workers run as a third user, `worca-plugin`. It
reads plugin code through the `worca-share` group and has its own `HOME` (`/data/plugin-home`),
but cannot open `plugins/<name>/data` (where each plugin's `secrets.json` lives) or anything else
in worca's home, nor the agents' `HOME`. A connector gets its own configuration and secrets on
stdin for each call; a plugin cannot read another plugin's secrets from disk. What still holds
between plugins: they share that one user, so a connector that runs alongside a chat worker can
read its process, and anything a connector writes under its `HOME` is readable by the others. A
connector cannot write into its own install folder there; keep caches under `HOME`. Without
single-volume isolation (a bind-mount compose setup, or `WORCA_AGENT_ISOLATION=0`), and on a
native install, every plugin runs as worca's own user and can read every plugin's secrets and
worca's settings: install only plugins you trust.

**Reaching the host** (a database on your laptop): `host.docker.internal` on
Docker Desktop, `--add-host=host.docker.internal:host-gateway` on Engine. Off
by default; unreachable under the egress overlay.

## Building it yourself

```bash
npm run docker:build                                    # ghcr.io/sinishadjukic/worca:dev from this checkout
npm run docker:build -- --variant full
npm run docker:build -- --target worker                 # ghcr.io/sinishadjukic/worca-worker:dev-claude
npm run docker:build -- --target worker --engine codex  # ...worca-worker:dev-codex (or gemini, qwen, copilot,
                                                        #   opencode, goose, cursor, all)
npm run docker:smoke                                    # offline proof: CLI mock run, UI health, Host guard, SIGTERM, volume
npm run docker:smoke -- --worker-image ghcr.io/sinishadjukic/worca-worker:dev-claude   # the worker contract
```

The build packs the package with `npm pack` and installs that tarball, the same
path CI and the release take, so what runs in the box is what npm ships. One
`docker/Dockerfile` builds both images: its stages are `os` (Debian packages, the
`worca` user), `pkg` (the tarball, `npm ci`), `engines` (the engine CLIs for
`--engine`), `worker`, and `controller` last, so a build with no `--target` is the
controller. The Claude Code pin is [`docker/CLAUDE_CODE_VERSION`](../docker/CLAUDE_CODE_VERSION);
the other engines' pins are [`docker/engines.env`](../docker/engines.env) (`KEY=value`, every
line a build arg; `docker/engines/install.sh` installs them and runs each binary's `--version`,
so a release that does not run on the build's architecture fails the build). The goose
tarball is checked against the sha256 pinned there; an empty sha skips the check with a warning
in the build log.

What the build pulls in is locked. The package ships `npm-shrinkwrap.json`, and the
image installs exactly that tree with `npm ci` in the unpacked tarball (a global
install of a local tarball would ignore the shrinkwrap; an `npm install -g @worca/app`
from the registry honours it). The `node:24-bookworm-slim` base is pinned by digest
and the workflows' third-party actions by commit SHA; Dependabot
([`.github/dependabot.yml`](../.github/dependabot.yml)) proposes the bumps. Two optional
dependencies run install scripts: `node-pty` builds its native module (or is skipped
where there is no compiler) and `ffmpeg-static` downloads its ffmpeg binary.

### Worker image contract

A worker container is started by the controller's backend, not by hand; this is what it
expects of its container (`docker/entrypoint-worker.sh` checks it, `src/worker/main.mjs` reads it;
the protocol is in `docs/workers.md`).

**Environment.** Required: `WORCA_CONTROLLER_URL` (`ws://` or `wss://`, the controller's worker
port), `WORCA_WORKER_SCOPE` (`run:<id>` or `chat:<id>`), `WORCA_WORKER_ID`, and the one-time
`WORCA_WORKER_TOKEN` or `WORCA_WORKER_TOKEN_FILE`. Optional:
`WORCA_WORKER_IDLE_MS`, `WORCA_WORKER_RELAY_PORT`, and `WORCA_CA_CERT_FILE` as on the
controller. The image sets `WORCA_NO_DB=1`, `WORCA_ROLE=worker` and `WORCA_WORKER_ENGINE=<engine>`.
A missing required variable exits **78** naming it.

**Paths.** `/worca` (the Worca home) and `/projects` must be mounted **at the same paths as on
the controller** and be writable by uid 1000: the controller hands the worker paths under them
(the run's checkout, the chat's folder). An unwritable mount exits 78 with the fix; `fsGroup` is not
applied on NFS volumes, so export such a share owned by uid 1000 (or `anonuid=1000`). The worker's
`HOME` is `/worca/.worca-cc/worker-homes/<kind>/<id>` (the controller's layout, which it cleans up by the
same path), created on start; the npm, uv and Playwright caches go to `/worca/.worca-cc/worker-cache/`.

**What it never has.** No `sudo`, no second user, no sudoers file (one worker serves one run or
one chat; the container is the boundary). No GitHub token, no broker secret and no database: the
controller passes an agent's credentials per spawn and does the git pushes and PRs itself.
No published port and no `HEALTHCHECK`; the connection is outbound, and the controller's heartbeat
is the liveness check.

**Exit codes.** `0` after a shutdown the controller asked for, an idle timeout, or a refusal it
was told about; `1` when the controller connection dropped; `78` for an incomplete assignment or
an unwritable volume; `143` after SIGTERM is what the process returns, which `tini -e 143` maps to
`0` so a `docker stop` reads as a clean exit. `docker run --rm <image> worca worker --check` exits
0 and prints the engines found, without connecting anywhere.

Hacking on Worca inside the box: [CONTRIBUTING.md](../CONTRIBUTING.md#in-a-container).

## Sign-in with your own identity provider

With the `auth` overlay, oauth2-proxy signs people in through your OpenID Connect provider (Entra
ID, Keycloak, Okta, Google, ...), admits only the groups or roles you list, and forwards to worca
with the ID token, which worca verifies itself. Set the `WORCA_AUTH_*` and `WORCA_OIDC_*` values
in `.env` (see `.env.example`) and put a TLS reverse proxy in front of `127.0.0.1:4180`:

```sh
worca container up --with auth
# or, with oauth2-proxy.yaml next to the compose files
docker compose -f compose.yml -f compose.auth.yml up -d
```

[auth.md](auth.md) has the provider settings, team policy and troubleshooting.

## Workers: agents in their own containers

With the `workers` overlay the `worca` service becomes a **controller** — it keeps the scheduler,
the database and the UI — and every run and every chat thread gets a **worker container** of its
own, started when its first process is needed and removed when the run ends or the thread has
been idle. See [docs/workers.md](workers.md) for the model.

```sh
worca container up --with workers
# or
docker compose -f compose.yml -f compose.workers.yml up -d
```

Step by step, the first time:

1. **Pull the worker image for the engine your runs use** (the controller does not pull):
   `docker pull ghcr.io/sinishadjukic/worca-worker:latest-claude` — `-codex`, `-gemini`, … for
   other engines, `-all` for every engine in one image (then `WORCA_WORKER_IMAGE=…-all` in
   `.env`), `-full` variants with the extra toolchains. Match the controller's `WORCA_TAG`.
2. **Start with the overlay** (above). `worca container status` shows `worca` and `docker-proxy`
   up; `/api/health` through `curl -s localhost:4317/api/health` has an `executor` object.
3. **Log Claude Code in** as without workers (`worca container login`, or a token or key in
   `.env`): workers copy the login from the controller's volume, and `.env` credentials reach
   agents on workers too. Other engines need their credential in `.env`; the overlay passes
   these on when set: `OPENAI_API_KEY` (with `OPENAI_BASE_URL`, `OPENAI_MODEL`), `GEMINI_API_KEY`,
   `GOOGLE_API_KEY`, `COPILOT_GITHUB_TOKEN`, `CURSOR_API_KEY`, `DASHSCOPE_API_KEY`,
   `OPENROUTER_API_KEY`. Another name needs a line of its own under `worca.environment` in a
   `compose.override.yml`. See [Credentials on workers](workers.md#credentials-on-workers).
4. **Start a run or a chat.** `docker ps --filter label=worca.scope` lists the worker
   containers while they live; the controller's log names each one it starts and removes.

What the overlay does:

- `worca` gets `WORCA_EXECUTOR=docker` and reaches the Docker Engine through a
  [socket proxy](https://github.com/Tecnativa/docker-socket-proxy) sidecar that allows exactly what
  the controller needs (create, start, inspect, remove containers; list networks) — never the raw
  socket. The worker listener (`WORCA_WORKER_PORT`, 4319) is on the compose network only; it is
  never published.
- The controller replicates **its own container** onto every worker: the same volumes and bind
  mounts at the same paths (path parity — the run's checkout, the store and the staged files are
  where the controller wrote them), the same network (so `ws://worca:4319` and `http://broker:8080`
  resolve), the same user. The docker socket is never passed on; the Claude login volume rides
  read-only at `/seed/claude`, from which a worker copies the login, again whenever the seed is newer, and a login a worker refreshed is written back (a worker that can
  run Claude Code only: the `claude` and `all` images, or one image serving every engine).
- Worker images are per engine: `WORCA_WORKER_IMAGE` (default
  `<WORCA_IMAGE>-worker:<tag>-{engine}`, i.e. `ghcr.io/sinishadjukic/worca-worker:<tag>-{engine}`);
  `WORCA_WORKER_IMAGE=self` runs workers from the worca image itself (Claude Code only). Pull the
  worker image for your engine once: the controller does not pull, and a worker whose image lacks
  the run's engine refuses the first spawn naming the image to fix. The controller's own engine
  checks (`GET /api/engines`, the setup wizard) report non-Claude engines as *runs on the worker
  image — not checked on the controller*: the controller image only ships Claude Code.
- `WORCA_WORKER_MEM` (4g), `WORCA_WORKER_CPUS` (2), `WORCA_WORKER_PIDS` (2048) and `WORCA_WORKER_MAX` (20) bound each worker and
  how many run at once; `worca container down` removes any worker still around.
- The broker overlay combines with it (`worca container up --with workers,egress,broker`, or the
  same three compose files by hand with `WORCA_UPLINK_NETWORK=internal`): the broker has a link
  network of its own that the controller joins in every combination, so workers and the controller
  reach it by its service name, and the egress sidecar's proxy address rides through to the
  workers (the in-process `WORCA_EGRESS_MODE` proxy does not — use the sidecar).
- **Networks.** Workers join one of the controller's networks, chosen on purpose: never the Docker
  API network (the socket proxy's), and an `internal` network before an open one. With the egress
  overlay that is the `internal` network, so an agent on a worker has no route out but the
  allowlist proxy. `worca container up --with egress,workers` also keeps the controller itself off
  the open network; with plain `docker compose -f … -f compose.egress.yml -f compose.workers.yml`
  set `WORCA_UPLINK_NETWORK=internal` in `.env` for the same (the controller warns at boot when
  it is on both). `WORCA_WORKER_NETWORK` names the workers' network outright.
- **A digest-pinned controller image** (`image: …/worca@sha256:…`) names no tag to derive the worker
  images from: set `WORCA_WORKER_IMAGE`. With a tag before the digest (`:1.3.0@sha256:…`) the tag is used.
- **`-full` tags.** With `WORCA_TAG=<version>-full` the workers of the engines that have a full image
  (`claude`, `all`) run `<version>-<engine>-full`; the other engines run their slim image.
- **More than one installation on a host.** Workers carry their installation (the Compose project,
  or `WORCA_INSTANCE_ID`): a controller lists and reaps only its own, and `worca container down`
  removes only its own.
