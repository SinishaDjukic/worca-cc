# Local sandbox (Docker)

Worca runs natively on your machine. Each run's agents and scripts run in one disposable container on your own
Docker. The UI, the orchestrator, the database, commits, pushes and pull requests stay on your machine, as on a
local run. Local stays the default; a local run does not change.

It is a second backend of the execution layer that the [E2B sandbox](e2b.md) uses. Most of what that page says
about a run in a sandbox holds here too: how code goes in and comes back, the model relay, secret files, what the
run page shows.

## When to use this

This is the "Local sandbox (Docker)" setup. The other setups are "Native", "E2B sandbox", "Hardened box" and
"Shared instance".

**Who it is for.** A developer on a laptop who wants agents sandboxed without changing how they work. You need
Docker Desktop or Docker Engine. You need no server and no account.

**What you keep.**

- Worca stays native, with your folders and your projects.
- Your workflow does not change. Runs, reviews, branches and pull requests work as before.
- Uncommitted files go along into the sandbox.

**What it protects.**

- Agents run in a container. Each run gets one container, and it is removed when the run ends.
- Nothing of your machine is mounted in the container. Not your project, not your home folder, not the Docker
  socket.
- No model key enters the container. Worca adds the key on your machine, behind the model relay.
- Agents run as a normal user without sudo. The container drops almost every Linux capability.
- The container has no network of its own. Every connection goes through Worca, which never lets it reach your
  machine.
- Changes come back as a patch after each step. Worca filters the patch before it applies it.

**Its limits.**

- It takes single git projects only. Workspace runs and Folder projects stay local.
- It runs Claude, Codex, Copilot and Cursor only. Other engines run locally.
- Bedrock, Vertex and Foundry models are refused.
- A container shares your machine's kernel. That is a weaker wall than an E2B virtual machine. A site with a
  stricter runtime (gVisor, Kata) can turn it on with one setting.
- A tool that ignores `HTTPS_PROXY` gets no network. Git over ssh does not work; use HTTPS.

## Setup

1. Install and start Docker Desktop (macOS) or Docker Engine (Linux). Check it with `docker version`: it must
   show a Server section.
2. Make sure the model key is in the environment the Worca server starts with. Claude needs
   `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. Codex, Copilot and Cursor need their keys as on
   [E2B](e2b.md#required-environment). The key stays on your machine.
3. Pick **Runs in: Local sandbox (Docker)** on New run (Advanced level), or set it as the default for a project or
   for you. From the command line: `worca --exec-env docker --project <dir> --prompt "…"`.

The first run builds the sandbox image on your machine. That takes a few minutes, once. The run log shows the
progress. The image is called `worca-local-sandbox:<version>`. A Worca upgrade that moves a pinned tool builds a
new one on its next run. Old images stay until you remove them (`docker image prune`).

Worca checks at run start that the `docker` command is there and reaches its daemon. When Docker is not running,
the run is refused with one line that says so.

## Settings

| Setting | Where | Default | Effect |
| --- | --- | --- | --- |
| Where runs execute (`run.execEnv` = `docker`) | New run, project page, Settings › Runs | Local | Runs execute in a container. |
| `dockerMaxSandboxes` | `settings.json` | 2 | How many containers run at once. More runs wait. |
| `dockerMaxWaitMin` | `settings.json` | 240 | How long a container waits for an answer before it is released. |
| `dockerSandbox.memory` | `settings.json` | `4g` | Memory per container, no swap. At least `512m`. |
| `dockerSandbox.cpus` | `settings.json` | 2 | CPUs per container. |
| `dockerSandbox.pids` | `settings.json` | 2048 | Processes per container. |
| `dockerSandbox.runtime` | `settings.json` | none | A stricter runtime, such as `runsc` (gVisor). Passed as `--runtime`. |
| Docker image | project page | the default image | An image of your own for this project. |
| Sandbox network | project page | Open | Open, or Allow listed hosts only. |
| `WORCA_DOCKER_IMAGE` | server environment | none | An image for every project without its own. |
| `WORCA_DOCKER_BIN` | server environment | `docker` | The docker command to call. |

An example `settings.json` part:

```json
{ "dockerMaxSandboxes": 3, "dockerSandbox": { "memory": "8g", "cpus": 4, "runtime": "runsc" } }
```

An invalid value keeps its default. The run log names it.

The image is chosen in this order: the project's Docker image setting, then the project's own build, then
`WORCA_DOCKER_IMAGE`, then the default image. The run log says which one and why.

An image of your own must have `bash`, `git`, `node`, `tar`, `python3`, `procps` and the engine's CLI. It must
have a user with uid 1000 and home `/home/user`, and a user with uid 990 that owns `/run/worca`. The simplest way
is to start from the default image (`FROM worca-local-sandbox:<version>`).

## The container

Worca starts every container with these flags:

```text
docker run -d --rm --init --network none --ipc private --user 990:990
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE
  --security-opt no-new-privileges --pids-limit 2048
  --memory 4g --memory-swap 4g --cpus 2 --ulimit core=0 [--runtime <name>]
```

- **No mounts.** No `-v`, no `--mount`, no device, no host namespace, no published port. Worca refuses to start a
  container with any of them, and never passes the Docker socket.
- **Users.** Agents and scripts run as `user` (uid 1000). The container's watchdog and its network relay run as
  `worca` (uid 990), so an agent can neither stop nor extend them. The image has no sudo.
- **Capabilities.** Worca runs one command as root: it creates the folders that mirror your machine's paths
  (such as `/Users/…`) and hands them to `user`. That needs `CHOWN` and `DAC_OVERRIDE`. Nothing else runs as
  root, and the agents, as a normal user, hold no capability.
- **Lifetime.** The container ends itself at a deadline. Worca moves the deadline every five minutes while the run
  is alive, and to "Max wait" while a question waits for an answer. If Worca stops, the container ends within
  30 minutes. At every start Worca removes its own containers whose run has ended.
- **Stopping a step.** Stopping a `docker exec` on your machine does not stop the process in the container.
  Worca ends the command and everything it started inside the container.

## Network

The container has no network: `--network none`. A raw socket in it reaches nothing. `HTTPS_PROXY` in the
container points at a small relay inside it. The relay carries each connection to Worca on your machine. Worca
checks the connection and opens it.

- **Open** (the default). Any public host is reachable.
- **Allow listed hosts only.** Only the hosts in `WORCA_EGRESS_ALLOW` are reachable, minus `WORCA_EGRESS_DENY`. It is
  the same list as the E2B allow mode and the Docker egress overlay. An empty list means the default list:
  `api.anthropic.com`, `github.com`, `.github.com`, `.githubusercontent.com`, `registry.npmjs.org`. A leading dot
  means a name and its subdomains.

In both modes Worca never connects to your own machine: not loopback, not its own addresses, not link-local
addresses (such as cloud metadata). In Open mode it does not connect to private addresses either (`10.x`,
`172.16.x`, `192.168.x`), so the container cannot reach your local network or Docker Desktop's way to your machine.
In Allow mode a listed host may be private: someone chose to list it. Worca resolves a name and checks every
address before it connects.

The model relay does not use the network. It keeps working with everything blocked.

**Behind a corporate proxy.** Worca opens the connections with its own proxy settings. With a proxy that needs a
login, that is Worca's local proxy on `127.0.0.1`, which does the login. The login stays in Worca. It never enters
the container, and nothing listens beyond loopback. A name your machine cannot resolve goes to the proxy by name.

**Building images behind a proxy.** `docker build` passes a proxy to the build only when it has no login and is
not on loopback. A build behind a proxy that needs a login cannot use Worca's local proxy. Set Docker's own proxy
(Docker Desktop › Settings › Resources › Proxies), or build the image where the network is open.

## Project images

A project can store an environment spec: the tools and apt packages it needs, every version pinned. It is the same
spec as for [E2B](e2b.md#building-and-rebuilding-a-project-environment). Build the image from the project page, or:

```bash
worca exec-env spec --project <key|dir> --set spec.json
worca exec-env build --project <key|dir> --backend docker
```

The build runs `docker build` on your machine and makes `worca-local-sandbox-<project key>`. It is the default
image plus the tools. A run uses it from then on. When the spec or the default image changes, the run log says
the build is stale, and the run still uses it. A failed build keeps the previous image.

## Limits

- Single git projects only. Workspace runs, Folder projects and runs without a project stay local.
- Claude, Codex, Copilot and Cursor only. Bedrock, Vertex and Foundry models are refused.
- A container shares your machine's kernel. A kernel bug can let a process out of a container; an E2B sandbox is
  a virtual machine. Set `dockerSandbox.runtime` to a stricter runtime (such as `runsc`) if your site has one.
- A tool that ignores `HTTPS_PROXY` gets no network. Git over ssh fails; use HTTPS remotes.
- Through a corporate proxy, the proxy resolves names this machine cannot. What such a name reaches is up to the
  proxy.
- It is made for Docker Desktop and Docker Engine. Podman, rootless Docker and Rancher Desktop are not supported.
- Images are not removed for you. Remove old ones with `docker image prune`.
- MCP servers that run a command on your machine are not available in the container, as on E2B.

## Compared with the E2B sandbox

| | Local sandbox (Docker) | E2B sandbox |
| --- | --- | --- |
| Where agents run | A container on your own Docker | A virtual machine on an E2B server |
| What you need | Docker Desktop or Docker Engine | An E2B server, self-hosted or E2B Cloud |
| Wall around the agent | A container, sharing your kernel | A virtual machine |
| Network | Through Worca only; Open or Allow | Open, or Allow by name at E2B |
| Sudo in the sandbox | No | Yes |
| Behind a login proxy | Through Worca's local proxy | E2B's own network |
