# Container Isolation — Design

Running Worca (and the headless `claude` processes it spawns) inside a container, so that
an agent going off the rails can damage a disposable Linux box instead of the developer's
machine. Shipped as an **additional** install path next to `npm install -g @worca/app`,
never a replacement for it.

Status: concept. No code in this document has been implemented; every file path under
`docker/` and every CLI verb that does not exist today is a proposal.

---

## 1. Problem

Worca drives Claude Code in `--permission-mode acceptEdits` with deny rules, a host-process
guard hook and an optional environment scrub (see `docs/guardrails.md`). Those controls are
**policy**, evaluated by the CLI itself, and the guardrails doc is explicit about their
limit: Bash denies are prefix matches, `sh -c "curl …"` evades them, and a subprocess an
agent spawns can read any credential file `HOME` still points at. "For OS-level enforcement
use Claude Code's sandbox (out of scope here)."

The concrete risks on a developer laptop today:

| Risk | Where it comes from | What Worca does today |
| --- | --- | --- |
| Reading host credentials (`~/.ssh`, `~/.aws`, `~/.config/gh`, keychain-backed tokens, browser profiles) | agents run as the developer's user with the developer's `HOME` | Strict guardrails deny `Read` on known paths; not enforced for subprocesses |
| Destroying files outside the project | `rm -rf`, a bad `find … -delete`, a misfired cleanup script | worktrees keep the checkout intact; nothing protects the rest of the disk |
| Killing host processes | the 2026-08-31 incident (`ps aux \| grep … \| kill`) | the host-guard PreToolUse hook; pattern-based, prefix-matched |
| Exfiltration over the network | any tool with network access | Strict denies `curl`/`wget`/… by name; no packet-level control |
| Persisting something on the host (cron entries, shell rc files, launch agents, global npm packages) | agents install "helpers" | nothing |
| Resource exhaustion (fork bombs, runaway `npm install`, filling the disk) | agent mistakes | per-run cost caps only |

A container turns every one of these into a kernel-enforced boundary rather than a
string-match. It also gives Windows users a Linux Worca, which sidesteps the whole class of
Windows spawn quirks documented in `src/core/preflight.mjs` and `src/core/claude-runner.mjs`.

## 2. Goals

- **One image, three host OSes.** A single `linux/amd64` + `linux/arm64` OCI image that runs
  unmodified on macOS (Apple Silicon and Intel), Windows (WSL2 backend) and Linux.
- **Same Worca.** The container runs the very `@worca/app` tarball npm ships, with the same
  DB, store, plugins and guardrails. No container-only code paths inside the engine.
- **Convenient for a fellow developer.** Two commands to a running UI on `http://localhost:4317`,
  one more to log Claude Code in. No Dockerfile authoring unless they want extra toolchains.
- **Least privilege by default.** Non-root, no added capabilities, no Docker socket, only the
  project folders the developer names are mounted, the UI reachable from loopback only.
- **Tested like the npm package.** Built on every PR, smoke-run in mock mode in CI, published
  from the same release tag as npm, with provenance.
- **Opt-in hardening tiers** the developer can raise without editing anything but the compose
  invocation: egress allowlist, clone-in mode (nothing from the host mounted at all).

## 3. Non-goals

- Replacing the npm install. The npm path stays the default in the README; the container is
  a section below it.
- Multi-user or remote-access Worca. The server has no auth (`ui/server.mjs`, the S1 comment)
  and the container keeps that contract: loopback only. Remote access is an SSH tunnel or
  Tailscale, not a Worca feature.
- Windows containers, Apple's `container` CLI, docker-in-docker, Kubernetes manifests.
- A Claude Code sandbox (bubblewrap / seatbelt) inside the container. It needs unprivileged
  user namespaces that many container runtimes disable; the container **is** the sandbox.
- Protecting the mounted project from the agent. The agent is supposed to edit it. Clone-in
  mode (§9.3) is the answer for people who want the host to hold nothing at all.

---

## 4. Which containerization approach

### 4.1 Options considered

| Option | mac | win | linux | Notes |
| --- | --- | --- | --- | --- |
| **OCI image + Compose file** (Docker Engine / Docker Desktop / Podman / OrbStack / Rancher / colima) | ✔ | ✔ (WSL2) | ✔ | The one artifact every runtime consumes. Compose spec is implemented by `docker compose`, `podman compose`, Rancher and OrbStack alike. |
| Dev Container (`.devcontainer/`) | ✔ | ✔ | ✔ | Great for contributors working *on* Worca in VS Code; wrong shape for *using* Worca on arbitrary projects (a devcontainer is per-repo). Offered as an extra, built on the same image. |
| Native VM (Lima, Multipass, Parallels) | ✔ | ✔ | ✔ | Strongest isolation, worst convenience, no image distribution story. Not pursued. |
| Apple `container` (macOS 26) | ✔ | ✘ | ✘ | Single-platform and young. Revisit in a year. |
| Windows containers | ✘ | ✔ | ✘ | Windows-only images, no `claude` native path advantage. Rejected. |
| WSL2 without a container | ✘ | ✔ | ✘ | Not isolation: same user, same mounted `C:\`. Rejected as a target, but it is the required *backend* on Windows. |

### 4.2 Recommendation

Ship an **OCI image** and a **Compose file**, and verify them on exactly these runtimes:

| Host | Verified runtime | Free alternative also expected to work |
| --- | --- | --- |
| macOS | Docker Desktop (VirtioFS) | OrbStack, colima, Podman Desktop |
| Windows 10/11 | Docker Desktop with the **WSL2 backend** | Podman Desktop, Rancher Desktop (both WSL2-backed) |
| Linux | Docker Engine (rootful) | Podman rootless |

Rules that follow from the runtime matrix:

- **Windows: projects live in the WSL2 filesystem** (`\\wsl$\…`, i.e. `~/dev` inside the
  distro), and `docker compose` is run from a WSL2 shell. Bind-mounting `C:\Users\…` through
  the 9p bridge is 10–50× slower for git operations and breaks file-watch semantics; the
  README says so plainly instead of pretending otherwise.
- **No runtime-specific features.** No `--gpus`, no Docker Desktop extensions, no
  `host.docker.internal` dependency in the default path (it is documented as an opt-in for
  agents that need a database on the host).
- **Rootless-safe.** Everything the image does works as a non-root user with no capabilities;
  the egress allowlist (§8.3) uses a proxy sidecar instead of `iptables`, precisely because
  `NET_ADMIN` is unavailable in Podman rootless and awkward on Docker Desktop.

---

## 5. The image

### 5.1 Contents

Base: `node:22-bookworm-slim` (the `.nvmrc` line `lts/jod`; `engines` demands ≥ 22.13 for
`node:sqlite`). Debian rather than Alpine because Claude Code's native binary and the
Playwright dependencies expect glibc.

| Layer | What | Why |
| --- | --- | --- |
| OS packages | `git`, `openssh-client`, `ca-certificates`, `curl`, `tini`, `gh` (GitHub CLI), `ripgrep`, `jq`, `less`, `procps` | git is mandatory; `gh` backs one-click PRs and the GitHub Issues source; `procps` gives agents `ps` for the host guard's "look the PID up first" rule |
| Claude Code | `npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}` (build arg, pinned) | pinned so an image tag is reproducible; `DISABLE_AUTOUPDATER=1` in the image env because an immutable image cannot self-update, and the CLI must not try |
| Worca | `npm install -g ./worca-app-${VERSION}.tgz` | the exact tarball npm ships (§10.2); never `COPY . /app` in a published image |
| User | `worca` (uid/gid 1000), `HOME=/home/worca`, `WORKDIR /projects` | non-root; 1000 matches the default first user on Linux and inside WSL2 distros, so bind-mounted files keep their owner |
| Env defaults | `WORCA_HOST=0.0.0.0`, `PORT=4317`, `WORCA_HOME=/worca`, `WORCA_PROJECTS_ROOT=/projects`, `WORCA_NO_NATIVE_DIALOG=1`, `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `TZ=UTC` | see §11 for each |
| Entrypoint | `tini -- /usr/local/bin/worca-entrypoint` → `exec worca ui` | `tini` reaps orphaned `claude` and MCP children; the entrypoint fixes volume ownership on first start and prints the login state |
| Healthcheck | `curl -fsS http://127.0.0.1:4317/api/health` every 30 s | the route exists today (`ui/server.mjs`, `GET /api/health`) |
| Labels | `org.opencontainers.image.{source,version,revision,created}`, `dev.worca.claude-code.version` | provenance and "which CLI is in here" without running it |

Nothing in the engine changes. `WORCA_HOST=0.0.0.0` is needed because Docker's port
publishing reaches the container through its bridge address, not loopback. The
server's Host/Origin guard still only accepts `localhost`, `127.0.0.1` and `::1`, which is
exactly right: the compose file publishes the port on the host's loopback only, so the
browser sends `Host: localhost:4317` and passes, while anything arriving via a LAN address
is answered 403.

### 5.2 Variants

| Tag suffix | Adds | Size (est.) | For |
| --- | --- | --- | --- |
| *(none)* | nothing beyond §5.1 | ~400 MB | Node/TypeScript projects, any project whose toolchain is Node-only |
| `-full` | `python3`, `pip`, `pipx`, `build-essential`, `pkg-config`, Chromium + Playwright OS deps, `docker-cli` **not** included | ~1.4 GB | the manual web-UI-testing agent (Playwright MCP), Python projects, native npm modules |

Everything else is the developer's own `FROM ghcr.io/sinishadjukic/worca:1.3.0` Dockerfile,
which the docs show in five lines (§9.4). Two variants is the ceiling: every additional
toolchain variant doubles the CI matrix for a shrinking audience.

### 5.3 Multi-arch

`linux/amd64` and `linux/arm64`, built natively on GitHub's `ubuntu-latest` and
`ubuntu-24.04-arm` runners and stitched with `docker buildx imagetools create`. QEMU emulation
is avoided: the Claude Code and Playwright installs are slow enough natively.

### 5.4 Dockerfile sketch

```dockerfile
# docker/Dockerfile — proposal, not implemented
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
ARG CLAUDE_CODE_VERSION            # pinned, e.g. 2.1.259
ARG WORCA_TARBALL                  # worca-app-<version>.tgz produced by `npm pack`
ARG VARIANT=slim                   # slim | full

RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl tini ripgrep jq less procps gnupg \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# `full` layer is a conditional RUN keyed on VARIANT (python3, build-essential, chromium deps).

RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
COPY ${WORCA_TARBALL} /tmp/worca.tgz
RUN npm install -g /tmp/worca.tgz && rm /tmp/worca.tgz && npm cache clean --force

RUN useradd -m -u 1000 -s /bin/bash worca \
 && mkdir -p /worca /projects && chown worca:worca /worca /projects
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/worca-entrypoint

ENV WORCA_HOST=0.0.0.0 PORT=4317 WORCA_HOME=/worca WORCA_PROJECTS_ROOT=/projects \
    WORCA_NO_NATIVE_DIALOG=1 DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 TZ=UTC
USER worca
WORKDIR /projects
VOLUME ["/worca", "/home/worca/.claude"]
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://127.0.0.1:4317/api/health || exit 1
ENTRYPOINT ["tini", "--", "worca-entrypoint"]
CMD ["worca", "ui"]
```

`WORCA_HOME=/worca` makes the data directory `/worca/.worca-cc` (the engine appends
`.worca-cc` to the base, `docs/storage.md`). The volume is mounted at `/worca` so the
whole thing, including a future sibling, is persisted.

### 5.5 Entrypoint responsibilities

1. If `/worca` or `/home/worca/.claude` is owned by root (first start of a fresh named
   volume on rootful Docker), fix ownership. This is the only reason the image carries
   a tiny `setpriv`-less fallback: the entrypoint runs as `worca`, so it can only *detect*
   this and print the one-line `docker compose run --user root worca chown …` fix. Docker
   Desktop and Podman rootless never hit it.
2. If neither `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, a Bedrock/Vertex/Foundry
   switch nor a credentials file is present, print the login instructions (§7) and continue:
   mock runs work without any of them, and the Getting-started tile "Connect Claude Code"
   already tells the user in the UI.
3. `exec "$@"` so signals reach the server. The server already handles `SIGTERM`
   (`ui/server.mjs`, `exitCodeFor('SIGTERM')` → 143) and runs its graceful path.

---

## 6. Compose file

`docker/compose.yml`, downloadable on its own (§9.1). Everything a developer changes is an
environment variable read from a `.env` beside it; the file itself is not edited.

```yaml
# docker/compose.yml — proposal
name: worca

services:
  worca:
    image: ghcr.io/sinishadjukic/worca:${WORCA_TAG:-latest}
    init: true                              # belt to tini's braces on runtimes that ignore ENTRYPOINT tini
    user: "${WORCA_UID:-1000}:${WORCA_GID:-1000}"
    ports:
      - "127.0.0.1:${WORCA_PORT:-4317}:4317"   # loopback only — the server's Host guard expects it
    volumes:
      - worca-home:/worca                    # DB, store, runs, plugins, ui.json
      - claude-config:/home/worca/.claude    # Claude Code credentials, memory, settings
      - ${WORCA_PROJECTS:-${HOME}/dev}:${WORCA_PROJECTS_MOUNT:-/projects}
    environment:
      TZ: ${TZ:-UTC}
      GIT_AUTHOR_NAME: ${GIT_AUTHOR_NAME:-}
      GIT_AUTHOR_EMAIL: ${GIT_AUTHOR_EMAIL:-}
      GIT_COMMITTER_NAME: ${GIT_AUTHOR_NAME:-}
      GIT_COMMITTER_EMAIL: ${GIT_AUTHOR_EMAIL:-}
      GH_TOKEN: ${GH_TOKEN:-}
      CLAUDE_CODE_OAUTH_TOKEN: ${CLAUDE_CODE_OAUTH_TOKEN:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      WORCA_PROJECTS_ROOT: ${WORCA_PROJECTS_MOUNT:-/projects}
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    pids_limit: 2048
    mem_limit: ${WORCA_MEM:-6g}
    cpus: ${WORCA_CPUS:-4}
    tmpfs: ["/tmp:size=2g"]
    restart: unless-stopped

volumes:
  worca-home:
  claude-config:
```

Overlays, each a separate file the developer adds with `-f`:

| File | Adds | Profile |
| --- | --- | --- |
| `compose.egress.yml` | internal network + proxy sidecar with a host allowlist (§8.3) | `egress` |
| `compose.teams.yml` | `cloudflared` sidecar for the Teams webhook ingress (§8.4) | `teams` |
| `compose.ssh.yml` | SSH agent socket forwarding (§7.5) | `ssh` |
| `compose.dev.yml` | bind-mounts the repo checkout over the installed package for hacking on Worca itself (§10.1) | `dev` |

CLI use is the same container with a different command, sharing the volumes:

```bash
docker compose run --rm worca worca --project /projects/api --prompt "Add a /search endpoint"
docker compose run --rm worca worca resume 1a2b3c4d
docker compose run --rm worca worca metrics push
```

`docker compose run` gives the run a TTY, so clarify questions on the CLI still work. The
`worca ui stop|restart|status` verbs become `docker compose stop|restart|ps`; the instance
file `ui.json` lives inside the volume and is never seen by a host `worca` binary, which is
the point — the two installs must not share a home (§11.2).

---

## 7. Claude Code login and API keys

Claude Code authenticates in one of four ways. All four work in the container; the
difference is where the secret lives and who has to type what.

### 7.1 Recommended default: interactive login into the volume (subscription users)

```bash
docker compose run --rm worca claude          # opens the /login flow
```

The CLI prints a URL, the developer opens it in the host browser, pastes the code back.
On Linux the credentials land in `~/.claude/.credentials.json`, i.e. in the `claude-config`
named volume, and every later `worca ui` spawn finds them. Nothing is written to the host,
no token appears in any file the developer manages, and revocation is one `claude logout`.

Why not mount the host's `~/.claude`? On macOS the OAuth token lives in the Keychain, not
in a file, so the mount would carry memory and settings but no credentials. On Linux it
would work but hands the agents write access to the host's Claude Code config and memory,
which is exactly what the container is supposed to prevent. Rejected for both.

### 7.2 Long-lived OAuth token (headless machines, CI-like setups)

`claude setup-token` on any logged-in machine prints a long-lived token; put it in the
`.env` as `CLAUDE_CODE_OAUTH_TOKEN` (the compose file forwards it). The file must be
`chmod 600` and the docs say so. Preferred over 7.1 wherever nobody can do the browser
dance, e.g. a build server running scheduled pipelines.

### 7.3 API key (Console / pay-per-token users)

Two shapes, and the docs recommend the second:

- `ANTHROPIC_API_KEY` in `.env`. Simple, but the key is visible in `docker inspect` and in
  every child process's environment (the env scrub keeps `ANTHROPIC_*` on purpose).
- A **Compose secret** plus Claude Code's `apiKeyHelper` setting. The secret is mounted at
  `/run/secrets/anthropic_api_key` (0400, tmpfs), and the image's default
  `~/.claude/settings.json` carries
  `"apiKeyHelper": "cat /run/secrets/anthropic_api_key"`. The key never enters the
  environment; agents would have to read the secret file deliberately, and a guardrail
  `Read(//run/secrets/**)` deny (added to Normal and Strict in a follow-up) closes the
  obvious path.

### 7.4 Bedrock / Vertex / Foundry

Pass-through, exactly as the guardrails doc already describes for the npm install:
`CLAUDE_CODE_USE_BEDROCK=1` plus `AWS_*` (or the Vertex/Foundry equivalents) in `.env`.
The Strict env scrub needs those names in its allowlist today and that does not change.
Mounting `~/.aws` read-only is possible but discouraged for the same reason as 7.1.

### 7.5 Git credentials (team metrics, team policy, PRs, clone-in mode)

Independent from Claude Code auth, and needed for `git push` of the `worca-metrics` /
`worca-policy` branches, for `gh pr create`, and for clone-in mode:

| Need | Mechanism | Notes |
| --- | --- | --- |
| HTTPS to GitHub | `GH_TOKEN` in `.env`; the entrypoint runs `gh auth setup-git` when it is set | one fine-grained token, `contents:write` on the repos in question |
| SSH remotes | `compose.ssh.yml` forwards the agent: Docker Desktop exposes `/run/host-services/ssh-auth.sock`; Linux binds `$SSH_AUTH_SOCK` | keys never enter the container; the agent can still *use* them while the socket is mounted, so pair with the egress allowlist for untrusted tasks |
| Git identity | `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` env, or a read-only `~/.gitconfig` mount | Worca runs `git commit` in the worktrees; without an identity git refuses |

### 7.6 Decision

Default docs path: **7.1** for individuals, **7.2** for unattended boxes, **7.3 with the
secret file** for API-key users. Only 7.1 needs no secret on disk, which is why it is first.

---

## 8. Network

### 8.1 Inbound

| Port | Direction | Bound to | Purpose | Default |
| --- | --- | --- | --- | --- |
| 4317/tcp | host → container | `127.0.0.1` only | the web UI + `/ws` + `/api` | **open** |
| anything an agent starts (a dev server on 3000, a test DB on 5432) | host → container | not published | only the agent's own Playwright/curl inside the container needs it | closed; `WORCA_PUBLISH_EXTRA` in a `compose.override.yml` documents how to expose one on loopback |
| Teams webhook | Bot Framework → tunnel → container | the `cloudflared` sidecar dials **out** | `POST /api/ingress/teams/...` | closed unless `--profile teams` |

There is deliberately **no** LAN exposure option in the shipped files. A developer who wants
to reach the UI from another machine tunnels (`ssh -L 4317:127.0.0.1:4317 box`) or uses
Tailscale, both of which present as loopback and pass the Host guard. Binding to `0.0.0.0`
on the host would also pass no auth check, because there is none.

### 8.2 Outbound (what the container needs to reach)

| Destination | Who | Needed for |
| --- | --- | --- |
| `api.anthropic.com:443` | `claude` | every real run; `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` drops the CLI's telemetry, update checks and error reporting, so this is the only Anthropic host |
| the configured `ANTHROPIC_BASE_URL`, Bedrock/Vertex/Foundry endpoints | `claude` | routed models |
| `github.com`, `api.github.com`, `objects.githubusercontent.com`, or the org's git host | `git`, `gh` | fetch/push worktree branches, PRs, metrics and policy branches, the GitHub Issues source, plugin marketplaces (git clones) |
| `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`, crates, Maven, … | agents | the project's own dependency installs; unknowable in general |
| `api.telegram.org`, `slack.com` + `wss-primary.slack.com`, `discord.com` + `gateway.discord.gg`, `login.microsoftonline.com` + `smba.trafficmanager.net` | chat channel workers | all dial out; none need inbound except Teams |
| `cli.github.com`, `deb.debian.org` | image **build** only | never at runtime |

Default networking is Docker's default: all outbound allowed. That is the same posture as
the npm install and the right default for a tool whose agents run `npm install`.

### 8.3 Egress allowlist (opt-in profile)

`compose.egress.yml` puts `worca` on an `internal: true` network and adds a tiny forward
proxy (tinyproxy or a 30-line Go/Node CONNECT proxy shipped in `docker/proxy/`) that sits on
both the internal and the default network. The `worca` service gets `HTTPS_PROXY`/`HTTP_PROXY`
pointing at it, `NO_PROXY=127.0.0.1,localhost`, and the proxy's allowlist is a text file:

```
api.anthropic.com
github.com
api.github.com
objects.githubusercontent.com
registry.npmjs.org
```

Properties:

- Anything that ignores the proxy env cannot reach the internet at all: the network is
  internal, so a raw socket from `node -e` or `python -c` fails with unreachable network.
  This is the packet-level control the guardrails doc says it cannot offer.
- No `NET_ADMIN`, no `iptables`, works identically on Docker Desktop, Podman rootless and
  Engine. The Claude Code reference devcontainer uses an `iptables` init script; that was
  considered and rejected because it does not run rootless and behaves differently per
  runtime.
- The Strict guardrail set's `curl`/`wget` denies stay as a second layer; the developer
  picks Strict **and** `--profile egress` for an untrusted task.
- Cost: `git` and `npm` honour proxy env; some tools (older `pip`, Playwright's browser
  download) need `HTTPS_PROXY` respected or the host added. The docs list the known ones.

### 8.4 Teams ingress

The only channel that needs an inbound HTTPS URL (`chat-connectivity-design.md` §4.1). The
`teams` profile adds a `cloudflared` sidecar that dials out to Cloudflare and forwards to
`worca:4317/api/ingress/teams/…`. The route already carries its own capability token and is
exempt from the loopback guard, so nothing in the server changes. ngrok works the same way;
`cloudflared` is chosen for the compose file because it needs no account for a quick tunnel.

---

## 9. Filesystem, projects and the worktree question

### 9.1 What is mounted

| Mount | Kind | Content | Why a volume / bind |
| --- | --- | --- | --- |
| `/worca` | named volume | `worca-cc.db`, `store/`, `runs/`, `plugins/`, `ui.json`, `settings.json` | survives image upgrades; never shared with a host install (§11.2) |
| `/home/worca/.claude` | named volume | credentials, `settings.json`, memory, session transcripts | same |
| `/projects` (or the host path, see 9.2) | bind mount | the developer's repositories | agents must edit them; results appear in the host checkout as branches |
| `/tmp` | tmpfs, 2 GB | scratch | disappears with the container; caps runaway temp files |
| `/run/secrets/*` | compose secrets | API key | §7.3 |

Not mounted, ever, in the shipped files: `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.gitconfig`
read-write, `/var/run/docker.sock`, the host `~/.claude`, the host `~/.worca-cc`.

### 9.2 Path parity and git worktrees

Worca isolates every run in a `git worktree`. Git records the worktree's **absolute path** in
`<repo>/.git/worktrees/<name>/gitdir` and the repo's absolute path in the worktree's `.git`
file. When the container sees the repo at `/projects/api` and the host sees it at
`/Users/me/dev/api`, the entries are correct inside the container and dangling on the host:
`git worktree list` on the host shows them as `prunable`, and a host-side `git worktree prune`
would delete metadata for a run that is still active in the container.

Worca registers project paths in its own DB too (`projects.json`, run manifests), so a home
directory can only ever be valid for one view of the filesystem.

Decision, by host OS:

| Host | Mount | Consequence |
| --- | --- | --- |
| macOS, Linux | **path parity**: `${WORCA_PROJECTS}:${WORCA_PROJECTS}` (the compose default sets `WORCA_PROJECTS_MOUNT=${WORCA_PROJECTS}`) | worktree metadata is valid on both sides; `git worktree list` on the host shows the run's checkout under `<repo>/.worca-cc/worktrees/<id>` as it does with the npm install; a host `worca` pointed at its own home would still not see the runs (different DB), which is intended |
| Windows (WSL2) | parity inside the WSL2 distro: `/home/<user>/dev:/home/<user>/dev` | same as above from the distro's git; Windows-side git (`C:\…`) never had a valid view of WSL paths anyway |
| any, projects on a foreign path | `/projects` fallback | documented: host `git worktree list` shows prunable entries while runs are live; do not prune |

Git 2.48's `worktree.useRelativePaths` was considered: it makes the metadata relative, but
Worca's legacy worktrees sit under the repo (`<repo>/.worca-cc/worktrees/`, `worktree.mjs`)
while detached run roots sit under `WORCA_HOME/runs/…`, a different volume, so relative
paths only fix the legacy layout. Parity fixes both and needs nothing from git.

### 9.3 Clone-in mode (strongest isolation)

For a task the developer does not want anywhere near their checkout, or for a box that has
no checkout, the docs describe a mode with **no bind mount at all**:

```bash
docker compose run --rm worca git clone git@github.com:acme/api.git /projects/api
docker compose run --rm worca worca add /projects/api
```

`/projects` becomes a named volume (`compose.clonein.yml` swaps the bind for a volume).
Results leave the container only as pushed branches and PRs, which is already how a
finished run is meant to be consumed ("one click away from a PR"). Needs git credentials
(§7.5); pairs with the egress allowlist. This is the recommended setup for a shared
"pipeline box" and for scheduled runs (`docs/scheduled-runs.md`) that nobody watches.

### 9.4 Project toolchains

The base image knows Node and git. A Python or Rust project needs its toolchain in the
image, because the agents run the project's tests. Three answers, documented in this order:

1. Pull the `-full` variant (`WORCA_TAG=1.3.0-full`).
2. Extend:
   ```dockerfile
   FROM ghcr.io/sinishadjukic/worca:1.3.0
   USER root
   RUN apt-get update && apt-get install -y --no-install-recommends rustup && rm -rf /var/lib/apt/lists/*
   USER worca
   ```
   and set `image:` in a `compose.override.yml` to the local build.
3. Let the agent install it. With the default (open) egress this works today; with the
   allowlist the developer adds the registry host.

Devcontainer users get the same image as `.devcontainer/devcontainer.json` in the Worca repo
(for contributors) and a copy-paste snippet for their own repos (for users), with
`"image": "ghcr.io/sinishadjukic/worca:1.3.0"`, `forwardPorts: [4317]`, and the two volumes
as `mounts`.

### 9.5 File ownership

The image user is uid 1000. On Docker Desktop (mac/win) ownership is translated and nothing
needs doing. On Linux Engine the compose file's `user: "${WORCA_UID:-1000}:${WORCA_GID:-1000}"`
lets a developer with uid 1001 set two lines in `.env`; the entrypoint detects the mismatch
on the named volumes and prints the fix rather than trying to `chown` as a user that cannot.
Podman rootless maps the container uid to the host user automatically.

---

## 10. Testing

### 10.1 During development

- **Hacking on Worca inside the container:** `compose.dev.yml` bind-mounts the checkout over
  the installed package's directory and switches the command to `node ui/server.mjs`, so
  `npm start`-style iteration works with the container's Linux `claude`. Tests run the same
  way: `docker compose --profile dev run --rm worca npm test`. `WORCA_HOME` inside the
  container is already isolated, so the suite's `.worca-cc-test` dance is unchanged.
- **Local image build:** `npm run docker:build` (a new `scripts/docker-build.mjs`) runs
  `npm pack` into `docker/.pack/`, then `docker build --build-arg WORCA_TARBALL=…`. One
  command, same tarball path CI uses.
- **Local smoke:** `npm run docker:smoke` starts the freshly built image with `WORCA_MOCK=1`
  and a throwaway `worca-home` volume, waits for `/api/health`, registers a temp git repo
  under `/projects`, runs `worca --project … --prompt "demo task" --mock --yes`, asserts
  the run reached `done`, and tears everything down. This is `npm run smoke` wrapped in a
  container, and it is the check that catches "the tarball forgot a file", which `npm test`
  against the source tree structurally cannot.

### 10.2 CI (every branch push and PR)

New job `docker` in `.github/workflows/ci.yml`, running after `test` passes:

1. `npm ci && npm pack` → `worca-app-<version>.tgz`.
2. `docker build` (amd64 only, `slim` only, no push) with the tarball. Build cache via the
   GitHub Actions cache backend so a PR build is ~2 min after the first.
3. `hadolint docker/Dockerfile`.
4. The §10.1 smoke against the built image, in mock mode, no secrets.
5. `trivy image --severity HIGH,CRITICAL --exit-code 1` on the OS layer, with an
   `.trivyignore` for the inevitable unfixable Debian CVEs, reviewed when it grows.
6. Second job in the matrix builds `-full` on PRs that touch `docker/**` only (path filter),
   because it is 6× the build time and rarely changes.

No real `claude` runs in CI, matching the suite's `no-real-claude` guard: no token, no spend,
no flakiness from the model. The mock path exercises the spawn plumbing that the container
can actually break (paths, users, signals, `tini`, volumes, the Host guard behind port
publishing).

### 10.3 Release

The image is published from the **same tag** as npm, by a new job in
`release-npm-app.yml` that `needs: build-and-publish`:

1. Download the tarball the publish job produced (uploaded as a workflow artifact; the same
   bytes that went to npm, so the image cannot drift from the package).
2. Build `slim` and `full` for both architectures on native runners, push per-arch images
   by digest to GHCR, create the multi-arch manifests.
3. Tags mirror npm's dist-tag logic:

   | Git tag | Image tags |
   | --- | --- |
   | `worca-app-v1.3.0` | `1.3.0`, `1.3`, `1`, `latest`, plus `-full` twins |
   | `worca-app-v1.3.0-rc.1` | `1.3.0-rc.1`, `rc`, plus `-full` twins |

4. `provenance: mode=max` and `sbom: true` on `docker/build-push-action`, and a keyless
   `cosign sign` with the workflow's OIDC identity, so `cosign verify` proves the image came
   from this repo's release workflow, just as npm provenance does for the tarball.
5. Smoke (§10.1) against the pushed `latest`/`rc` manifest on both arches before the
   GitHub Release job runs; a failing smoke fails the release the way a failing `npm test`
   does today. npm is already published at that point; the docs state that an image can lag
   an npm version by one fix-up build, and the image tag says which Worca version it holds.

**Weekly rebuild.** A scheduled workflow rebuilds the *current* stable and rc images with
the latest Debian security updates and the newest pinned Claude Code, and pushes them as
date-stamped tags (`1.3.0-20260919`) while moving `1.3.0`/`latest`. The Claude Code version
is bumped by a Renovate/Dependabot-style PR that edits the build arg, so it is reviewed, not
silent. This is the only way an immutable image with a pinned CLI keeps up with a CLI that
ships weekly.

**Manual real-run check before a stable release** (`workflow_dispatch`, `real-smoke`): one
tiny real pipeline against a fixture repo using a repository secret
`CLAUDE_CODE_OAUTH_TOKEN`, capped by `--max-budget` env, run by the release manager from the
`worca-release` skill's checklist. Kept out of the automatic path on purpose: it spends
money and it is the one job that would leak a token if the workflow were ever exploited.

### 10.4 Manual matrix (release checklist addition to `docs/RELEASING.md`)

| Host | Runtime | What to click |
| --- | --- | --- |
| macOS arm64 | Docker Desktop | quick start, login, one mock run, one real run, PR button |
| Windows 11 | Docker Desktop + WSL2 (the existing `worca-win11` skill's VM) | quick start from a WSL2 shell, path parity inside the distro, native folder dialog falls back to the in-app browser |
| Linux x86_64 | Podman rootless | quick start with `podman compose`, uid mapping, egress profile |

---

## 11. Configuration

### 11.1 Environment variables the image cares about

| Variable | Image default | Meaning in the container |
| --- | --- | --- |
| `PORT` | `4317` | inside the container; the host side is `WORCA_PORT` in `.env` |
| `WORCA_HOST` | `0.0.0.0` | must be non-loopback for port publishing; the Host guard keeps it loopback-only in effect |
| `WORCA_HOME` | `/worca` | data base dir → `/worca/.worca-cc` |
| `WORCA_PROJECTS_ROOT` | `/projects` (or the parity path) | the root context layer and the in-app folder browser's starting point |
| `WORCA_NO_NATIVE_DIALOG` | `1` | no `zenity` and no display; forces the in-app folder browser (`folder-dialog.mjs` already degrades, this just skips the probe) |
| `WORCA_CLAUDE_BIN` | unset | `claude` is on `PATH` in the image |
| `WORCA_MOCK` | unset | `1` for smoke runs |
| `WORCA_HOST_GUARD` | unset (on) | still useful: an agent killing the server kills the container's PID 1 child and the container restarts, losing the in-flight step |
| `DISABLE_AUTOUPDATER` | `1` | the image is immutable |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | one Anthropic host to allowlist; no telemetry from inside |
| `TZ` | `UTC` | **scheduled runs use wall-clock time**; the docs tell the developer to set their zone in `.env` or "every weekday at 02:00" fires at 02:00 UTC |
| `HTTPS_PROXY` / `NO_PROXY` / `NODE_EXTRA_CA_CERTS` | unset | corporate proxies and TLS interception; a CA bundle is bind-mounted read-only and named here |
| `GIT_AUTHOR_*`, `GH_TOKEN`, `SSH_AUTH_SOCK` | unset | §7.5 |
| `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, … | unset | §7 |

Worca's own settings (`settings.json`, models catalog, guardrail sets, plugin config) live in
the volume and are edited in the UI exactly as with npm. Plugin secrets may use the
`{"$env": "TELEGRAM_BOT_TOKEN"}` indirection the manifests already support, which maps
naturally onto `.env`.

### 11.2 Rules the docs state up front

- **One home per install.** The container's `/worca` volume and a host `~/.worca-cc` are two
  Worcas with two histories. Never bind-mount the host home into the container: the DB
  holds absolute project paths and worktree registrations for one filesystem view.
- **Timezone** as above.
- **`--open` is a no-op** inside the container; the quick start prints the URL.
- **`worca ui stop` from the host does nothing** to the container; `docker compose stop`.
- **Plugins install into the volume** and their `setup` commands run inside the container,
  which is a feature: a marketplace plugin's install script is now sandboxed too.
- **MCP servers a project declares** (`.mcp.json`, e.g. Playwright) must be runnable inside
  the image: `-full` or an extension image.
- **Reaching the host** (a database on the laptop) is `host.docker.internal` on Docker
  Desktop and `--add-host=host.docker.internal:host-gateway` on Engine; off by default and
  blocked entirely under the egress profile.

### 11.3 Windows specifics

- Run everything from a WSL2 shell with projects inside the distro.
- `WORCA_UID`/`WORCA_GID` default to 1000, which is the default first WSL2 user.
- The host-side `claude.exe` and npm-shim logic in `preflight.mjs` is irrelevant: the
  container runs the Linux CLI. This is the single biggest simplification the container
  brings to Windows users and the docs say so.

---

## 12. Distribution and developer convenience

### 12.1 Registry

**GHCR only** at first: `ghcr.io/sinishadjukic/worca`. Free for public images, native OIDC
from Actions, attestations and cosign supported, and the image's `org.opencontainers.image.source`
label links it to the repo automatically. Docker Hub is a mirror to add when pull-count
matters; two registries mean two sets of credentials and two places for a tag to be wrong.

### 12.2 Quick start (what the README section says)

```bash
mkdir worca && cd worca
curl -fsSLO https://raw.githubusercontent.com/SinishaDjukic/worca-cc/dev/docker/compose.yml
echo "WORCA_PROJECTS=$HOME/dev" > .env          # the folder that holds your repos
docker compose up -d                              # UI on http://localhost:4317
docker compose run --rm worca claude              # log Claude Code in, once
```

Add a project in the UI by typing its path under `/projects` (or the parity path); the
in-app folder browser opens there. That is the whole thing. Upgrading is
`docker compose pull && docker compose up -d`; the DB migration runs at boot as it does for
npm.

### 12.3 Later: `worca container` wrapper (phase 3)

Once the compose files are stable, the npm CLI can grow `worca container up|down|run|login|shell`
that writes the compose files into `~/.worca-cc/container/` and shells out to `docker` or
`podman`. It keeps a single entry point for people who already have the npm install and want
to move an untrusted task into a box. Deliberately not phase 1: it adds a CLI surface and a
runtime detection matrix before the plain compose path has proven itself.

### 12.4 Docs

- `docs/docker.md`: everything in §6–§11 in user language, one page.
- README: an **Install → In a container** subsection after the npm block, six lines and a
  link.
- `docs/guardrails.md`: the "Honest limitations" paragraph gains one sentence pointing at
  the container as the OS-level enforcement it currently declares out of scope.
- `docs/RELEASING.md`: §10.3 and §10.4.
- `CONTRIBUTING.md`: §10.1.

---

## 13. Rollout

| Phase | Deliverables | Exit criterion |
| --- | --- | --- |
| **1 — Runs** | `docker/Dockerfile`, `docker/entrypoint.sh`, `docker/compose.yml`, `scripts/docker-build.mjs`, `npm run docker:build` / `docker:smoke`, `docs/docker.md`, README section, CI build + mock smoke + Trivy on PRs | a fellow developer on each of mac/win/linux follows the quick start and finishes a real run without asking a question |
| **2 — Ships** | release job in `release-npm-app.yml` (multi-arch, GHCR, tags, provenance, SBOM, cosign), weekly rebuild workflow, Claude Code version bump automation, `-full` variant, RELEASING checklist | `worca-app-v1.4.0` publishes npm and image together; `cosign verify` passes |
| **3 — Hardens** | `compose.egress.yml` + proxy, `compose.clonein.yml`, `compose.ssh.yml`, `compose.teams.yml`, `.devcontainer/`, `Read(//run/secrets/**)` in Normal/Strict, `worca container` wrapper | a Strict + egress + clone-in run of a hostile fixture task cannot read a planted host secret or reach a non-allowlisted host, demonstrated by a scripted test in the manual matrix |

---

## 14. Trade-offs taken

1. **One OCI image + Compose over a devcontainer, a VM, or runtime-specific tooling.**
   Buys the widest runtime coverage (Docker Desktop, Engine, Podman, OrbStack) for one
   artifact. Costs: Windows users must live in WSL2, and the Apple `container` CLI is left
   for later.
2. **Install the npm tarball, never `COPY` the source.** Guarantees the container runs
   exactly what npm ships and lets one Dockerfile serve PR builds and releases. Costs: the
   release job depends on the publish job's artifact, and an image can lag an npm version by
   one fix-up build.
3. **Pinned Claude Code with the auto-updater off, refreshed by a weekly rebuild.**
   Reproducible image tags and no self-modifying binary inside a sandbox. Costs: users on an
   old image tag miss CLI fixes until they pull; a bump PR must be merged weekly.
4. **Loopback-only publishing, no auth added.** Keeps the server's single-user contract and
   its Host guard intact with zero server changes. Costs: no LAN access without a tunnel,
   which some people will want.
5. **Path parity on mac/Linux instead of a fixed `/projects`.** Keeps git worktree metadata
   valid on both sides of the mount. Costs: the compose default depends on `$HOME`, and a
   project outside the chosen root needs the `/projects` fallback with its prunable-entry
   caveat.
6. **Proxy sidecar for the egress allowlist instead of `iptables`.** Works rootless and on
   every runtime with no capabilities. Costs: a second container in that profile and a
   short list of tools that ignore proxy env and need documentation.
7. **Interactive login into a named volume as the default auth path.** No secret on the
   host disk, works for subscription accounts, revocable with `claude logout`. Costs: one
   browser round-trip per fresh volume; headless boxes must use the long-lived token.
8. **Compose secret + `apiKeyHelper` for API keys** rather than a plain env var. Keeps the
   key out of every child process environment. Costs: one more concept in the docs and a
   new deny rule to add to the built-in guardrail sets.
9. **Two image variants (`slim`, `-full`) and a documented `FROM` extension** rather than a
   variant per language. Bounded CI time and registry size. Costs: Python and browser-testing
   users pull ~1.4 GB or write five lines of Dockerfile.
10. **Mock-only CI, real run behind a manual dispatch.** No token in the automatic path and
    no spend per PR. Costs: a model-side regression is caught by the release manager's
    manual check, not by CI.
11. **Same permission mode and guardrails inside the box.** Nothing in the engine forks on
    "am I in a container"; the container adds a layer rather than swapping one. Costs:
    Worca does not exploit the box to loosen prompts (for example `bypassPermissions`), so
    runs inside are not faster or more autonomous than outside, only safer.
12. **Clone-in mode as documentation and a compose overlay, not a Worca feature.** Nothing
    to build, the strongest isolation available, and it composes with scheduled runs. Costs:
    results reach the developer only through git, and git credentials must be in the box.
