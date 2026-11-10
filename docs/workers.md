# Workers: agents in their own containers

By default Worca is one process: the orchestrator spawns every engine CLI (`claude`, `codex`,
…) and every script node as a local child. With a **remote executor** the same process — the
**controller** — keeps the scheduler, the database, the UI and the questions, and the processes
run in **worker containers**: one per run, one per chat thread, created when the first process is
needed and removed when the run ends or the thread has been idle. Nothing but the controller
runs while Worca is idle; ten concurrent runs are ten worker containers. A run whose processes
need two worker images — its agents on Cursor, its title and PR description on Claude Code —
gets one worker per image, and they end together.

```
             UI :4317 (people)               workers :4319 (container network only, token auth)
   ┌──────────────────────────────┐   ws    ┌──────────────────────────────┐
   │ controller (worca ui)        │◄───────►│ worker  run:<id>             │
   │ orchestrator · scheduler     │  exec/  │ worca worker → claude, …     │
   │ SQLite · worker registry     │  out/   └──────────────────────────────┘
   │ backend: docker | kubernetes │  exit   ┌──────────────────────────────┐
   └──────────────────────────────┘◄───────►│ worker  chat:<thread>        │
          │ shared volume: <worcaHome> (store, runs + worktrees, ask, plugins, worker-homes) + projects
          └──────────────── mounted at the same paths in every container
```

## How it works

- **One seam.** Every engine adapter spawns through `superviseSpawn` (`src/core/engines/spawn.mjs`),
  script nodes through `spawnScript` (`src/core/graph/script-runner.mjs`). Both ask the executor
  (`src/core/executor/`) for the current scope's worker session; with none (the default, every
  CLI run, every test) they spawn locally, line for line as before.
- **Scopes.** A run's loop and a chat turn each carry an executor scope (`run:<id>`, `chat:<id>`)
  in the async context, the way the acting person is carried for billing. A spawn outside any
  scope (a title, a PR description, a model test) stays on the controller.
- **Workers.** `worca worker` connects *outbound* to the controller's worker port with a
  one-time token, says which scope it serves and which engines it found, and executes what it is
  sent: the complete argv, cwd and env, stdin, signals. Output comes back line by line with flow
  control. A worker never opens the database (`WORCA_NO_DB=1` in its image).
- **Which image.** Every engine spawn names its engine, and the backend resolves it to a worker
  image (`…-claude`, `…-codex`, or one `…-all` for every engine). A scope's workers are told apart
  by that image: the same image is the same worker, another image is another worker. A script node
  names no engine and runs on the worker of the run's own engine. A worker that lacks the binary
  it is asked for refuses the spawn, naming the image setting to fix; the run pauses on it.
- **Starting and stopping.** Callers that need the same worker while it starts all wait on the one
  start; if it fails, each of them gets the failure. Stopping or pausing a run ends its wait at
  once, and a container or pod that arrives after nobody waits for it is removed.
- **Files.** Worker and controller see the same files at the same paths: the run's checkout,
  the pipeline's outputs and verdicts, staged prompts (`<worcaHome>/tmp/stage`), and the
  worker's HOME (`<worcaHome>/worker-homes/<kind>/<id>`), where the engine keeps the run's
  sessions — so a replacement worker after a pause or a lost container can `--resume` them.
  The same holds for the programs the controller names by absolute path: a node script node and a
  chat's tool child run `node` and worca's own files where the controller has them, so a custom
  worker image must keep node and the worca package at the paths of the published images (the
  published worker images do).
- **Loss.** When a worker's connection drops it stops its children as a stop would (SIGTERM, a
  few seconds of grace, then SIGKILL) and exits; the controller
  reports the step as a network failure, which the run's failure policy retries on a fresh worker.
  There is no reconnect.
- **Boot.** A controller removes every worker a previous controller of the same installation left
  (their tokens died with it; never one it started itself a moment ago), the worker homes of runs
  nothing can continue and of chat threads that no longer exist — a paused run's and a
  crash-interrupted run's stay for their resume — and
  staged spawn folders older than itself (each spawn removes its own; what a crashed controller
  left is nobody's).
- **Tokens.** A worker's one-time token is good for as long as its container is still coming up
  (an image pull on a cold node may take minutes), then for two minutes once it exists.
- **Output.** A worker sends output in frames of bounded size. A very long line travels alone, or in
  pieces when no frame can hold it; the pieces are marked and the controller puts the line back
  together, so a multi-megabyte JSON line arrives as the one line it was.

## Configuration

| Variable | Where | Meaning |
| --- | --- | --- |
| `WORCA_EXECUTOR` | controller | `local` (default), `docker`, `kubernetes` |
| `WORCA_EXECUTOR_BACKEND=in-process` | controller | the worker runs inside the server process over a real socket, no container, with the engines installed on this machine: for trying the path on one machine, and for tests |
| `WORCA_WORKER_PORT` | controller | the worker listener (default 4319); never publish it to people |
| `WORCA_CONTROLLER_URL` | controller | the URL workers are told to connect to (`ws://<service>:4319`). **Required** with `docker` and `kubernetes` (the Compose overlay and the chart set it): a worker in another container cannot dial the controller's loopback, and the server refuses to start without it |
| `WORCA_WORKER_MAX` | controller | how many scopes may hold workers at once (default 20); runs are also bounded by Settings › Runs. A run's second worker (a helper job on another engine's image) never waits for the cap. When it is reached, an idle chat worker gives way; otherwise the newcomer waits `WORCA_WORKER_CAP_WAIT_MS` (10 min) and then fails as a start failure, which the run's failure policy pauses or retries |
| `WORCA_WORKER_RELAY_PORT` | controller | the loopback port of a worker's chat relay (default 4320). Set it on the controller: it writes the port into the chat's tool configuration and hands the same value to every worker |
| `WORCA_WORKER_ENGINE` | controller | the engine a worker gets when a spawn names none and the scope has none (default: the `run.engine` setting) |
| `WORCA_WORKER_FULL_ENGINES` | controller | engines whose worker image has a `-full` build (default `claude,all`, what is published): the `full` variant applies to these, the others run their slim image |
| `WORCA_WORKER_PASS_ENV` | worker | more of the worker's own variable names to hand to its children ([Credentials on workers](#credentials-on-workers)) |
| `WORCA_WORKER_CONNECT_RETRY_MS` | worker | how long a worker keeps trying to make its first connection (default 30 s); once connected there is no reconnect |
| `WORCA_WORKER_CHAT_IDLE_MS` | controller | a chat worker is released after this long with nothing to run (default 15 min); the worker's own timer, at twice that, is the backstop for a controller that never gets to it |
| `WORCA_EGRESS_WORKERS` | controller | `external`: the workers' outbound network is policed by the egress sidecar or a cluster network policy, so an enforced `WORCA_EGRESS_MODE` (a proxy inside the controller) may stay on; without it such a controller refuses to boot with workers |
| `WORCA_WORKER_RELAY_TIMEOUT_MS` | controller | how long one relayed chat tool call may take before the worker's relay gives up on it (default 15 min); a tool that runs a script or waits on a run needs the room |
| `WORCA_WORKER_HELPER_IDLE_MS` | controller | a run's worker for another engine than the run's own (its title on Claude, one step on a second engine) leaves after this long with nothing to run (default 2 min) and is started again on demand; the run's own worker stays for the run |
| `WORCA_WORKER_MEM`, `WORCA_WORKER_CPUS`, `WORCA_WORKER_PIDS` | controller (Docker) | each worker container's memory, CPU and process limits (defaults `4g`, `2`, `2048`); on Kubernetes the chart's `worker.resources` |
| `WORCA_WORKER_START_TIMEOUT_MS` | controller | how long a worker may take to connect (default 2 min). A worker whose container or pod ends before it connects fails the start at once, with what it printed |
| `WORCA_DOCKER_TIMEOUT_MS` | controller | how long one Docker Engine request may take (default 30 s) before it fails |
| `WORCA_WORKER_USER` | controller (Docker) | the `uid:gid` worker containers run as; default: the user the controller process runs as |
| `WORCA_DB_DIR` | controller | the database's own directory, off the shared volume (SQLite's WAL needs a local filesystem) |
| `WORCA_CONTROLLER_URL`, `WORCA_WORKER_TOKEN`, `WORCA_WORKER_SCOPE`, `WORCA_WORKER_ID` | worker | the assignment, set by the controller's backend |
| `WORCA_WORKER_IDLE_MS` | worker | optional |

`/api/health` carries an `executor` object under a remote executor.

A worker **container** inherits the same few controller settings under both backends: `TZ`, `WORCA_BROKER_URL`,
`WORCA_MOCK`, the corporate CA (`WORCA_CA_CERT_FILE`, `NODE_EXTRA_CA_CERTS`; the worker's entrypoint builds its
own bundle from it), `WORCA_SIGTERM_GRACE_MS`, the `WORCA_<ENGINE>_BIN` overrides, the git identity, and a proxy
another container can reach, with the controller's and the broker's hosts added to `NO_PROXY`. A loopback proxy
is not passed on, and no credential ever is: those reach an agent per spawn
([Credentials on workers](#credentials-on-workers)).

## Credentials on workers

A worker's HOME (`<worcaHome>/worker-homes/<kind>/<id>`) is created for one run or one chat thread
and removed afterwards, so nothing an engine stores there outlives the worker. Two things reach
an agent on a worker:

- **The controller's environment.** The controller composes every spawn's environment and sends
  it with the exec (minus its own secrets: the worker token, the broker secret, the GitHub
  tokens it keeps for pushes and pull requests). A credential set where the controller runs —
  `.env` on Compose, the controller's Secret on Kubernetes — is therefore in the agent's
  environment on the worker too, unless the run's guardrail set scrubs the environment.
- **The worker's own environment.** On Kubernetes, `worker.credentialsSecret` is the worker pod's
  `envFrom`; on Compose the controller's `.env` is the only source. A worker hands its children its
  own variables that are engine credentials or their settings, by name — `*_API_KEY`, `*_AUTH_TOKEN`,
  `ANTHROPIC_*`, `CLAUDE_CODE_*`, `OPENAI_*`, `GEMINI_*`, `GOOGLE_*`, `VERTEX*`, `AWS_*`, `AZURE_*`,
  `COPILOT_*`, `CURSOR_*`, `GOOSE_*`, `DASHSCOPE_*`, `OPENROUTER_*`, plus any name listed in
  `WORCA_WORKER_PASS_ENV` — when the controller sent none of that name (the controller's wins).
  Never `WORCA_*`, and never a Git host's token under any name (`GH_*`, `GITHUB_*`, `GITLAB_*`,
  `BITBUCKET_*`, `AZURE_DEVOPS_*`): agents get no Git credential. A variable the controller
  holds itself and left out of a spawn on purpose is never filled in from the worker's copy: a
  guardrail set that scrubs the environment stays scrubbed when the same Secret feeds both, and
  with the credential broker on no model credential is added at all. A scrubbed spawn also tells
  its worker what the scrub lets through (the engine's own names and the set's allowlist), and the
  worker adds nothing of its own beyond that, so the guardrail holds for a key only the worker has.
  A key no agent may ever read still belongs in the [credential broker](credential-broker.md).

What that means per engine:

| Engine | Works on a worker | Does not persist on a worker |
| --- | --- | --- |
| Claude Code | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`; the [credential broker](credential-broker.md); on Compose also the interactive login (`worca container login`), which workers copy from the controller's `claude-config` volume (`/seed/claude`) — again whenever it is newer than their own, so a login renewed on the controller reaches a chat thread's or a paused run's HOME | — |
| Codex | `OPENAI_API_KEY`, or an OpenAI-compatible endpoint with its key set up on the Models page | the ChatGPT sign-in (`codex login`) |
| Gemini CLI | `GEMINI_API_KEY` (or Vertex AI's variables) | the Google account sign-in |
| Qwen Code | a provider in the environment (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`) | its OAuth sign-in |
| GitHub Copilot CLI | `COPILOT_GITHUB_TOKEN` | the device-code sign-in |
| Cursor | `CURSOR_API_KEY` | `cursor-agent login` |
| Goose | the provider's key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, …) with the provider and model named as [models.md](models.md#goose) describes | `goose configure` |
| OpenCode | the provider's key in the environment | `opencode auth login` |

The copied Claude login is a copy: each worker HOME holds its own, and the seed is read-only. Only a
worker that can run Claude Code gets it (the `claude` and `all` images, or one image serving every
engine): a Codex or Gemini worker has neither the seed volume nor the copy. The sign-in's tokens
rotate when one copy refreshes them, which would leave every other copy revoked, so the copies are
kept in step both ways: a worker copies the seed again before each spawn when the seed is newer (a
`worca container login` reaches the steps already running), and when a worker ends, a login its
Claude refreshed is written back into the seed (the next worker, and the controller's own helper
spawns, start from the live token). Two workers refreshing at the same moment can still leave one
with a revoked copy until its next start. For anything long-lived prefer a token (`claude
setup-token`, as `CLAUDE_CODE_OAUTH_TOKEN`) or the broker, which have no copies to fall out of step.

Each engine's section in [models.md](models.md) has the exact variables and the models to pick.
Seeding other engines' sign-ins the way Claude's is seeded is not implemented. The Compose option
of a Claude key as a compose secret read through `apiKeyHelper` is for the one-container box; on
workers use the token or the broker.

## What a worker can reach

A worker container separates an agent from the **controller's process and its secrets**: the
GitHub credentials, the broker secret and, on Kubernetes, the database (it has its own volume
there) are never in a worker. It does **not** separate one run from another, or from Worca's own
files:

- Every worker mounts the whole shared volume read-write and runs as the same user as the
  controller. An agent can read what is on it: other runs' checkouts and outputs, other scopes'
  worker homes (their engine sessions, a copied Claude login), files staged for a spawn.
- It can also write there, including the folders the controller loads code from (plugins, agents,
  workflows, scripts). Treat the agents of one installation as one trust domain, as you would
  users of one shared machine.
- On Compose the database file is on that same volume (`worca-home`); on Kubernetes it is not.

What narrows this today: the [credential broker](credential-broker.md), so no model key sits in
any environment or file an agent can read; a guardrail set that denies reads outside the project;
and one installation per team or trust boundary. Mounting only what a scope needs into its worker
is not implemented.

## What is different under a remote executor

- **Chat tools** run on the controller: the turn's MCP child posts each line to the worker's
  loopback relay shim, which forwards it over the worker socket (the same path agent isolation
  uses on one machine). A process such a tool starts (a script the chat wrote and tries out, a
  task classifier on the chat's engine) runs on the chat's worker, not in the controller.
- **Helper jobs asked for outside a run** (a PR description, a run overview) run on the controller,
  on Claude Code, whatever engine the run used: the controller image carries no other engine.
- **Bridged models** (an entry with `upstream`, served by the controller's loopback bridge) are
  refused at run and turn start: the bridge is not reachable from another container yet.
- **The in-process outbound policy proxy** (`WORCA_EGRESS_MODE`) does not reach workers, so with
  it enforced the controller refuses to boot under a remote executor until the workers' network is
  policed elsewhere — the egress sidecar (`docker/compose.egress.yml`) or a cluster network
  policy — and `WORCA_EGRESS_WORKERS=external` says so. A proxy URL that is not loopback
  (`http://egress:3128`) rides through to workers unchanged.
- **The credential broker** must be reachable from the worker network (`WORCA_BROKER_URL` names
  a service, not loopback).
- **Agent isolation** (`WORCA_AGENT_USER`, sudo) is not used on a worker: the container is the isolation.
- **Checks move to the worker.** What the controller checks before a local spawn — the engine's binary and
  sign-in at run start and before a chat turn, a Python interpreter for a python script node — is not checked on
  the controller for anything that runs on a worker image (Claude Code, which the controller has, stays checked).
  A worker that lacks the engine refuses the spawn with the image setting to fix; a missing interpreter fails the
  script's spawn. A chat on Codex, Copilot, Gemini CLI, Qwen Code, Goose or OpenCode is refused the same way when
  the worker image's CLI is older than the version that engine's chat lockdown needs (the worker reports its
  versions when it connects).
- **Your user-scope Claude Code setup is not on a worker.** An agent's HOME there is a fresh worker home with
  a copied login and `settings.json`: skills, `CLAUDE.md`, agents, commands and MCP servers you keep under
  `~/.claude` (the controller's volume on Compose) are not read, exactly as with agent users on one machine.
  Put what a run needs in the project, or in Worca's own skill and MCP registries, which do reach workers.
- **Versions.** A worker says which worca its image runs. When that is not the controller's, the controller's
  log names it; `worca container pull` also refreshes the worker images of the stack's tag that are present.
- **Chat commands** (agent mode, the chat's shell) are off: a chat on a worker reaches its worca tools through
  the relay, which carries no command tools. The chat is told so, and Settings shows it as unavailable.
- **What a chat may read.** A chat's read rules also name the controller's login volume as a worker sees it
  (`/seed`) and every worker HOME, so a chat on a worker cannot open another scope's sessions or a copied login.
- **The host guard** tells an agent on a worker to leave the worker process alone (its parent), not the
  server's process id, which means nothing inside the worker.
- **Leftovers.** When an engine's step ends, what it left running in its process group ends with it, as on one
  machine. A script node's background processes are its own.
- **Container-local paths.** The controller composes each spawn's environment in its own container. On the
  worker, that container's own CA bundle and cache directories replace the controller's, and a CA file path that
  does not exist there is dropped. A corporate CA must be mounted in the workers too (`WORCA_CA_CERT_FILE`; the
  Docker backend replicates the controller's mounts, on Kubernetes add it to the worker pod template).

## Backends

- `docker` — the controller starts containers through the Docker Engine, replicating its own
  container's mounts and user so paths match, on the network it shares with them (never the Docker
  API network; the internal one when the egress allowlist is on). See `docs/docker.md`.
- `kubernetes` — the controller creates a Pod per worker from a template. See `docs/kubernetes.md`.
