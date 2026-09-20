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
| `latest`, `1`, `1.3`, `1.3.0` | the newest stable @worca/app, Node 22, git, `gh`, a pinned Claude Code |
| `rc`, `1.3.0-rc.1` | the newest release candidate |
| `…-full` | the above plus Python 3, build tools and Chromium's OS libraries (the manual web-UI-testing agent, Python projects, native npm modules) |
| `1.3.0-20260921` | a weekly rebuild of that version with the newest Debian packages |

```bash
cosign verify ghcr.io/sinishadjukic/worca:1.3.0 \
  --certificate-identity-regexp 'https://github.com/SinishaDjukic/worca-cc/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The pinned Claude Code version is a label: `docker inspect --format '{{index .Config.Labels "dev.worca.claude-code.version"}}' <image>`.
The CLI's own updater is off inside the image; a newer CLI is a newer image tag.

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
| HTTPS to GitHub | `GH_TOKEN=github_pat_…` in `.env`; the entrypoint runs `gh auth setup-git` |
| SSH remotes | `docker compose -f compose.yml -f compose.ssh.yml up -d` forwards your agent socket (Docker Desktop: automatic; Linux: `WORCA_SSH_SOCK=$SSH_AUTH_SOCK`). Keys never enter the box; the socket does, so pair it with the egress overlay for untrusted tasks |
| Commit identity | `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` in `.env` (agents commit in run worktrees; git refuses without one) |

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
- The native folder dialog does not exist in the box; **Add project** uses the
  in-app folder browser, which starts at your projects root.

### Clone-in mode

No bind mount at all. `/projects` is a volume, the repo is cloned inside, results
leave only as pushed branches and PRs. The strongest tier, and the right setup
for a shared pipeline box or scheduled runs nobody watches:

```bash
docker compose -f compose.yml -f compose.clonein.yml up -d
docker compose -f compose.yml -f compose.clonein.yml run --rm worca git clone https://github.com/acme/api.git /projects/api
docker compose -f compose.yml -f compose.clonein.yml run --rm worca worca add --path /projects/api
```

Needs git credentials (above).

## Network

**Inbound:** only the UI port, published on `127.0.0.1`. The server accepts
`localhost` Host headers only, so a LAN address answers 403; that is the
single-user contract the npm install has too. Reach it from another machine
with `ssh -L 4317:127.0.0.1:4317 box` or Tailscale, both of which look like
loopback. A dev server an agent starts inside the box is not published; add a
`ports:` line in a `compose.override.yml` if you need to see one.

**Outbound**, open by default (agents run `npm install`):
`api.anthropic.com` (the only Anthropic host; telemetry is off in the image),
your git host, package registries, and the chat platforms (Telegram, Slack,
Discord all dial out).

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
browser download needs its CDN or a pre-fetched browser.

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
| `WORCA_PORT` | `4317` | host loopback port |
| `TZ` | `UTC` | **scheduled runs use this clock** |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | | commit identity |
| `GH_TOKEN` | | GitHub over HTTPS |
| `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` | | see *Logging in* |
| `WORCA_UID`, `WORCA_GID` | `1000` | Linux Engine: your ids (`id -u`, `id -g`) when not 1000, so the box can write your bind-mounted repos; the volumes work for any uid |
| `WORCA_MEM`, `WORCA_CPUS` | `6g`, `4` | resource caps (`pids_limit` 2048 is fixed) |
| `HTTPS_PROXY`, `NO_PROXY` | | corporate proxy |
| `WORCA_EGRESS_ALLOW` | see above | egress overlay allowlist |
| `WORCA_SSH_SOCK` | Docker Desktop's | ssh overlay, Linux |
| `CLOUDFLARE_TUNNEL_TOKEN` | | teams overlay |

Inside the image: `WORCA_HOST=0.0.0.0` (port publishing needs it; the Host
guard keeps the effect loopback-only), `WORCA_HOME=/worca`,
`WORCA_NO_NATIVE_DIALOG=1`, `DISABLE_AUTOUPDATER=1`,
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. The container runs as uid 1000
with all capabilities dropped, `no-new-privileges`, a 2 GB tmpfs `/tmp` and no
Docker socket. `worca ui stop` on the host does nothing to the box; use
`docker compose stop`. `--open` is a no-op inside.

**Reaching the host** (a database on your laptop): `host.docker.internal` on
Docker Desktop, `--add-host=host.docker.internal:host-gateway` on Engine. Off
by default; unreachable under the egress overlay.

## Building it yourself

```bash
npm run docker:build                      # ghcr.io/sinishadjukic/worca:dev from this checkout
npm run docker:build -- --variant full
npm run docker:smoke                      # offline proof: CLI mock run, UI health, Host guard, SIGTERM, volume
```

The build packs the package with `npm pack` and installs that tarball, the same
path CI and the release take, so what runs in the box is what npm ships. The
Claude Code pin is [`docker/CLAUDE_CODE_VERSION`](../docker/CLAUDE_CODE_VERSION).
Hacking on Worca inside the box: [CONTRIBUTING.md](../CONTRIBUTING.md#in-a-container).
