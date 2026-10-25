# Running agents in E2B sandboxes

An opt-in execution environment: a pipeline run executes every agent step and script step inside **one
self-hosted [E2B](https://e2b.dev) sandbox per run**, while Worca's UI, orchestrator, database, git commits,
pushes and PRs stay on your machine. Design and trade-offs:
[`plans/e2b-execution-design.md`](../plans/e2b-execution-design.md).

What it gives you: the agents work in a disposable VM. They cannot read your machine's credentials
(`~/.ssh`, `~/.aws`, keychains, browser profiles), touch files outside the run, or see your processes. Worca
brings their changes back after every step and commits them on your machine, as it always does. What it does
**not** give you: a different set of tools than your template has, access to services on your machine, or
your personal agent setup (`~/.claude`, `~/.codex`, `~/.copilot`, `~/.cursor`: skills, global instructions,
plugins). Local stays the default; a local run is exactly what it was before.

## Quick start

1. Build the sandbox template once (needs the `e2b` package and a reachable E2B API):

   ```bash
   E2B_API_KEY=… E2B_API_URL=http://localhost:3000 npm run e2b:build
   ```

   It builds `worca-agent` at 2 vCPU and 4096 MB. Pass `-- --cpu 4 --memory-mb 8192` for a bigger sandbox;
   project templates (see [below](#building-and-rebuilding-a-project-environment)) take the same size.

2. Point the Worca server at your E2B, in the environment the server starts with (see
   [Which E2B server Worca uses](#which-e2b-server-worca-uses)). For a self-hosted E2B in a VM on your Mac, follow
   [`e2b-local-mac.md`](e2b-local-mac.md). For a self-hosted E2B on another machine, tunnel its API and sandbox
   ports:

   ```bash
   ssh -N -L 3000:localhost:3000 -L 3002:localhost:3002 <e2b-host>
   export E2B_API_KEY=…
   export E2B_API_URL=http://localhost:3000
   export E2B_SANDBOX_URL=http://localhost:3002
   ```

3. Give the server a model credential: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or
   `ANTHROPIC_API_KEY`, in the environment the Worca server starts with. For Codex, Copilot or Cursor runs, set
   that engine's key instead (see [Required environment](#required-environment)). It stays on the server and
   never enters a sandbox (see [Keys and child processes](#keys-and-child-processes)). With the
   [credential broker](credential-broker.md) on, Claude runs need no credential at all.

4. Start a run in a sandbox: see [Starting a run in E2B](#starting-a-run-in-e2b).

## Required environment

| Variable | Needed | What it is |
|---|---|---|
| `E2B_API_KEY` | yes | Your E2B API key. Worca never logs it whole (only `e2b_…abcd`). |
| `E2B_API_URL` | yes, unless E2B Cloud | The E2B API, e.g. `http://localhost:3000`. Unset, a run is refused unless `WORCA_E2B_CLOUD=1`. |
| `WORCA_E2B_CLOUD` | for E2B Cloud | `1` sends runs to E2B Cloud (`api.e2b.app`) when `E2B_API_URL` is unset. Without it, an unset URL is refused rather than silently using Cloud (see [What leaves this machine](#what-leaves-this-machine)). |
| `E2B_SANDBOX_URL` | for self-hosted | The sandbox traffic endpoint, e.g. `http://localhost:3002`. |
| `WORCA_E2B_TEMPLATE` | no | The fallback template (default `worca-agent`) when the project sets none and has no build. |
| `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` | Claude runs, unless the credential broker is on | The model credential. It stays on the Worca server, which adds it to the sandbox's model calls; the sandbox never holds it. OAuth wins when both are set. |
| `CODEX_API_KEY` or `OPENAI_API_KEY` | Codex runs (not when every model is on its own endpoint) | An OpenAI API key; `CODEX_API_KEY` wins. A ChatGPT sign-in (`codex login`) cannot be used in a sandbox. |
| `COPILOT_GITHUB_TOKEN` | Copilot runs | A fine-grained personal access token (`github_pat_…`) with only the Copilot Requests permission. Classic and OAuth tokens are refused. |
| `CURSOR_API_KEY` | Cursor runs | A Cursor API key. Worca exchanges it for a short-lived access token on the server. |

Agents, scripts and actions on your machine never get the `E2B_*` and `WORCA_E2B_*` variables, and neither
does a sandbox (see [Keys and child processes](#keys-and-child-processes)).

Worca also needs Node 22.19 or newer and the optional `e2b` package (`npm install e2b@2.56.0` in the Worca
install directory; a normal install brings it). Plain HTTP over the tunnel is fine. The SDK's `getHost()` names
do not resolve through a tunnel; Worca never uses them.

The self-hosted E2B stack (E2B Embed) is tested upstream with SDK 2.46.x. Worca's 2.56.0 built the
`worca-agent` template and ran sandboxes against it without problems. Running your own E2B:
[`e2b-selfhost-ops.md`](e2b-selfhost-ops.md).

## Which E2B server Worca uses

One Worca server talks to one E2B server: the one its environment names when it starts (`E2B_API_URL`,
`E2B_SANDBOX_URL`, `E2B_API_KEY`). Worca keeps no list of servers and does not look for one. A run's start
checks only that the key, the model credential (unless the credential broker is on), Node and the `e2b` package are there; an unreachable server
shows when the sandbox is created, and that run fails. The run log names the server's key
(`… in E2B sandbox <id> (template …, key e2b_…abcd)`).

The server's live status shows in two places, and keeps itself current while it is on screen:

- **Settings → Runs → Execution environment:** a chip next to the title, and the server below it
  (`Server: http://localhost:3000 (key e2b_…abcd)`).
- **New run → Runs in:** a chip beside the picker while it is set to E2B sandbox.

The chip reads one of:

| Chip | Meaning |
|---|---|
| connected · 1 of 4 in use | The server answered. 1 sandbox runs there (every sandbox on that server and team, not only this Worca's) of "Sandboxes at once". |
| connected · 4 of 4 in use · 2 waiting | Full: 2 runs of this Worca wait for a slot ("waiting for an E2B slot" on their run pages). |
| unreachable | No answer within 5 s: the tunnel or VM is down, or `E2B_API_URL` is wrong. Hover the chip for the error. |
| key refused | The server answered 401: `E2B_API_KEY` belongs to no team there. |
| not set up | No `E2B_API_KEY`, or the `e2b` package is missing, on this Worca server. |

Behind the chips is `GET /api/exec-envs/status`: one entry per execution backend with a `servers` list (one server
today), each with `state`, `label`, `running`, `cap`, `waiting` and, when it failed, `error`. The check is one
"list running sandboxes" call, and the answer is cached for 5 s, so many open pages cost one call.

The server is the API URL plus the key's team. A self-hosted E2B reached through an SSH tunnel and one in a
local VM ([`e2b-local-mac.md`](e2b-local-mac.md)) can both be `http://localhost:3000`; their keys tell them apart.

To move to another E2B server (from a remote one to a local VM, or to E2B Cloud):

1. Wait until no run uses a sandbox (none running, waiting for an answer or paused with a sandbox), and stop the
   Worca server.
2. Start it again with the other server's `E2B_*` variables. Only one tunnel or VM can hold `localhost:3000`.
3. Build `worca-agent` there (`npm run e2b:build`, step 1 above), then rebuild each project that has an
   environment spec (`worca exec-env build --project <key>`). Until then a run on that project skips its build
   from the old server, falls back to `WORCA_E2B_TEMPLATE` or `worca-agent`, and says so in the run log; the
   project page shows "built on another E2B server — Rebuild".

`worca exec-env status --project <key>` shows the running server's view: the template a run gets, and whether
the last build is from another server.

## Starting a run in E2B

Nothing else changes for a run in a sandbox: the same projects, workflows, models and pages as a local run.
Where it runs is picked with the `run.execEnv` setting, first match wins:

- **Per run:** **Runs in: E2B sandbox** on New run (shown from the Advanced interface level), or
  `worca --exec-env e2b --project <dir> --prompt "…"`.
- **In Chat:** ask for the run in a sandbox ("run this in E2B"). The run card's **Runs in** field shows where it
  executes, and Default follows the settings below. The chat can also change `run.execEnv` and the two E2B
  limits, each with a Revert.
- **Per project:** the project page → Execution environment → Where runs execute.
- **For you:** Settings → Runs → Execution environment → Default execution environment (Expert level).

A run preset carries no execution environment: `worca run --preset NAME` follows the project and user
defaults. A saved E2B default applies to runs of one git project on Claude, Codex, Copilot or Cursor; workspace runs,
Folder projects and runs without a project run locally, and the run log says why (see [Limitations](#limitations)).

## How a run works

- **One sandbox per run.** It is created after the run's worktree is ready and killed when the run ends.
  Sandboxes carry the metadata `worca`, `worcaInstance`, `worcaRunId` and `worcaProject`.
- **Same paths.** The worktree, the pipeline folder, the plans/reviews store folders and the run root sit at the
  same absolute paths inside the sandbox as on your machine, so prompts and arguments need no rewriting.
- **Code in.** A git bundle of the run's branch is cloned in the sandbox, and your uncommitted files and Worca's
  injected files (skills, memory rules) are laid over it. No GitHub token or remote is involved.
- **Code graph.** The graphify graph agents query (`graphify-out/`) is built in the sandbox, after the clone, by the
  template's own graphify; your machine builds and uploads none. The run log gives its time ("graphify graph built
  in the sandbox in N s"). If it fails, or the template has no graphify (one built before Worca added it), the run
  goes on without the graph and the log says why. A workflow with `codeGraph: false` skips it, as for a local run.
- **Per-step sync.** Before each step, files Worca changed on your machine go up. After each step, the files the
  agent wrote in the run's folders come back, and its code changes come back as a patch applied to your
  worktree. Worca reads the step's result only after that.
- **Commits, pushes and PRs stay local.** Worca commits the run's work on your machine at the end of the run,
  exactly as for a local run, but with git hooks off: the code came from the sandbox, and a hook would run it here
  with the server's keys in its environment.
- **No hook changes come back.** A step whose changes touch git hooks (`.husky/`, `.githooks/`, `.lefthook/`,
  `lefthook.yml`, `.pre-commit-config.yaml`, husky 4's `.huskyrc` or `husky.config.js`, `.simple-git-hooks.json`,
  a `husky`, `simple-git-hooks` or `pre-commit` key in a `package.json`, or the repository's own `core.hooksPath`)
  fails the run, and nothing of that step is applied (`EXEC_ENV_HOOK_CHANGE`; the patch is saved in the pipeline
  folder).
- **No agent configuration comes back.** Claude Code and the other agent CLIs load their project config on this
  machine: on a later local step, on a resume with Local, or when you open the folder yourself. A step whose changes
  touch any file under a `.claude/`, `.cursor/`, `.codex/`, `.gemini/` or `.qwen/` folder (settings and their hooks,
  local MCP approvals, agents, commands, skills), Copilot's `.github/hooks/`, or adds or changes a server in the root
  `.mcp.json` that Claude Code would start without asking (approved by name, or every project server is) fails the
  run, and nothing of that step is applied (`EXEC_ENV_CONFIG_CHANGE`; the patch is saved in the pipeline folder).
  A new `.mcp.json` server that still needs an approval does come back: worca never starts it until someone
  approves it.
- **Files only you would run come back with a warning.** Changed npm scripts in a `package.json` (a dependency
  change is quiet), `.vscode/`, `.devcontainer/`, `.github/workflows/`, `.envrc`, `.npmrc`, `mise.toml`, and a
  `.mcp.json` server waiting for approval are applied, and the run log and the run page list them with why they
  matter. Worca runs none of them on this machine; read them before you do (a workflow runs on GitHub once the branch is pushed).
- **Git attributes stay inert.** A `.gitattributes` line can only name a filter, diff or merge driver, and the
  driver's command lives in git config, which a patch can never reach (`git apply` refuses `.git/`). So
  `.gitattributes`, `.gitmodules` and `.lfsconfig` come back like any other file.
- **Files worca put in the worktree stay worca's.** The memory rules and skills are never sent back, so a step whose
  changes touch them was altered inside the sandbox: the run fails and nothing of that step is applied
  (`EXEC_ENV_INJECTED_CHANGE`; the patch is saved in the pipeline folder).
- **Uploads never follow a symbolic link.** A link in the pipeline folder, the plans or reviews folder or the memory
  rules is not sent (the log names it), and a link inside a skill is sent only when it points inside that skill.
- **A budget on what comes back.** One step may bring back up to 20,000 files and 2 GiB into the run's folders, and
  a whole run up to 8 GiB (each file up to 128 MiB). Past that the run fails before anything of that step is
  downloaded (`EXEC_ENV_SYNC_BUDGET`).
- **Questions and pauses.** While an ask waits and no step runs, the sandbox is kept alive up to
  "Max wait for an answer"; the question shows the time ("Answer by …"). With no answer by then, worca
  releases the sandbox and pauses the run. A paused run keeps its sandbox that long too. Resume reconnects
  to the sandbox when it still exists, and otherwise continues in a fresh one from the work so far (a step
  whose agent session was in the old sandbox runs again from the start). When the run would now start
  from another template, or another build of it (the project's environment was built or rebuilt while
  the run was paused), Resume brings the work home, kills the old sandbox and continues in a fresh one
  from the new template.

## Settings

| Setting | Where | Default | What it does |
|---|---|---|---|
| Execution environment (`run.execEnv`) | Settings → Runs, the project page, or per run | Local | Where runs execute: `local` or `e2b`. |
| Sandboxes at once (`e2bMaxSandboxes`) | Settings → Runs | 4 | More e2b runs wait, shown as "waiting for an E2B slot" on the run page. |
| Max wait for an answer (`e2bMaxWaitMin`) | Settings → Runs | 240 min | How long a waiting or paused run keeps its sandbox. Past it, the sandbox is released and the run pauses; Resume continues in a fresh sandbox. |
| E2B template (per project) | the project page → Execution environment | — | Overrides every other template for this project. |
| Sandbox network (per project) | the project page → Execution environment | Open | Open, or **Allow listed hosts only**: the sandbox reaches only `WORCA_EGRESS_ALLOW` (see [Outbound network](#outbound-network-egress)). |

## Per-project templates

A run picks its template in this order, and never waits for a build:

1. the project's **E2B template** setting (the project page → Execution environment);
2. the project's last successful build (`worca-agent-<project key>`, see below), when it was built on the E2B
   server this Worca talks to now;
3. `WORCA_E2B_TEMPLATE`;
4. `worca-agent`.

A build belongs to one E2B server: its `E2B_API_URL` (E2B Cloud when unset) and the team of its `E2B_API_KEY`.
The key counts because an SSH tunnel to a remote server and a local one can share `http://localhost:3000`. After
the server moves (or the key changes), the old build's template does not exist there, so a run skips it, falls
back to step 3 or 4, and says so in the run log; the project page shows "built on another E2B server — Rebuild".
A build recorded before Worca stored the server is still used.

The run log names the template and where it came from, e.g.
`agents and scripts run in E2B sandbox <id> (template worca-agent from the default, key e2b_…abcd)`.

## Building and rebuilding a project environment

A project can store an environment spec: the tools and apt packages its sandbox needs. The spec holds tools only,
never env vars, files or secrets, and every version is pinned:

```json
{ "tools": [{ "name": "node", "version": "24.21.0" }, { "name": "npm:prettier", "version": "3.9.10" }],
  "apt": ["libpq-dev"] }
```

Tool names are mise names. The Toolchain setup workflow's lock maps onto it: its `mise` rows become `tools`,
its `apt:<pkg>` system rows become `apt`.

```bash
worca exec-env spec --project <key|dir> --set spec.json   # store (or replace) the spec
worca exec-env spec --project <key|dir> --clear
worca exec-env status --project <key|dir>                 # spec, template setting, builds, staleness (the server's view)
worca exec-env build --project <key|dir>                  # build or rebuild worca-agent-<key>, and follow its log
```

The project page shows the spec read-only, the template in use, the last build, and a **Build environment** /
**Rebuild environment** button. A build is `worca-agent` plus the spec's packages and tools, as one template.
The template pins Claude Code (`docker/CLAUDE_CODE_VERSION`) and the codex, copilot, cursor-agent, gemini, qwen, goose
and opencode CLIs (`docker/e2b/engine-clis.json`; goose from its GitHub release, checked against its SHA-256);
`npm run e2b:build` prints every pinned version.

- Builds run only in the Worca server, which holds the E2B keys. `worca exec-env build` asks the running server
  (start it with `worca ui`). Under remote access the CLI's call needs a sign-in, so build from the project page
  there.
- A failed build keeps the previous template in use.
- A project template gets the size of the server's `worca-agent` (or `WORCA_E2B_TEMPLATE`), read from the E2B API
  at build time: build `worca-agent` with `npm run e2b:build -- --cpu 4 --memory-mb 8192` and rebuild the project.
  When the base cannot be read, the build uses 2 vCPU and 4096 MB and says so in its log.
- A build goes stale when the spec changes or the base moves (any new pin in `docker/CLAUDE_CODE_VERSION` or
  `docker/e2b/engine-clis.json`, an edited `e2b.Dockerfile`). A run on a stale build warns in the run log and still
  uses it; nothing rebuilds on its own.
- `worca-agent` ships graphify (for the code graph above) but no browser and no ffmpeg. The Promo video workflow's Render step and the C4 diagram
  renderer need them, so a project that runs those in a sandbox adds `"apt": ["chromium", "ffmpeg"]` to its spec
  and builds. A script in a sandbox gets `WORCA_EXEC_ENV` (the backend, e.g. `e2b`) and `CHROME_NO_SANDBOX=1`;
  the host's `WORCA_CHROME` and `WORCA_FFMPEG` name host paths and do not reach it.

## What leaves this machine

A run in a sandbox sends to the E2B server: the run's branch with its whole git history, your uncommitted and
untracked (not ignored) files, except secret files (see [Secret files](#secret-files)), Worca's injected files
(skills, memory rules), the run's pipeline folder and plans, and the model calls the agent CLI makes, which pass
through the relay described below. The model credential (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or the Codex,
Copilot or Cursor key) does not go: it stays on the Worca server. The sandbox runs as a user with passwordless sudo
and has open network access unless the project limits it (see [Outbound network](#outbound-network-egress)), so code
in it can still send what it can see (your repository, the run's files) to any address on the internet. E2B Cloud is
never a silent default: with `E2B_API_URL` unset a run is refused, unless `WORCA_E2B_CLOUD=1` says the code may go to
E2B Cloud.

## Secret files

Files that look like secrets stay on this machine. The list is `.env*`, `*.pem`, `*.key`, `.npmrc`, `.netrc` and
`id_*` (a name without a slash matches the file name at any depth; one with a slash matches the whole path), plus the
project's own `secretPaths`. The same list is the floor of the Normal guardrails, chat's Show files and the diff view.

- An untracked or changed file that matches is not uploaded. The run log names each one once:
  `sandbox upload: 1 secret file kept on this machine: .env`.
- A committed file that matches is already in the git history the sandbox gets, so it cannot be held back. That
  includes one a later commit deleted: the bundle carries the branch's older commits too. The run log names each one.
  Deleting a file in a new commit does not take it out: rewrite the history (for example with `git filter-repo`) and
  rotate the secret.

To add patterns for a project, set `secretPaths` in its project settings. There is no field on the project page yet;
use the API, for example:

    curl -X PATCH http://localhost:4317/api/projects/<key>/settings \
      -H 'Content-Type: application/json' -d '{"secretPaths": ["*.tfvars", "config/credentials/**"]}'

A pattern is one line, at most 256 characters, and a project can list up to 200. `null` clears them.

## Outbound network (egress)

A sandbox has open network access by default. The project page's **Sandbox network** (Execution environment) can
limit it to **Allow listed hosts only**. The list is the one `docker/compose.egress.yml` uses: `WORCA_EGRESS_ALLOW` on
the Worca server (empty means the default: `api.anthropic.com`, `.github.com`, `.githubusercontent.com`,
`registry.npmjs.org`), minus `WORCA_EGRESS_DENY` (see [remote access](remote-access.md)). A leading dot means the host
and its subdomains. IP addresses and CIDR ranges work too. An empty list blocks every outbound connection. The setting
applies when a sandbox is created; a resumed run that reconnects keeps the sandbox it had.

The model relay still works with everything blocked: the agent's model calls go to the sandbox's own loopback and come
back to Worca over the command channel, never over the sandbox's network.

Stops casual network access from the sandbox, not a determined agent: an allowed host name can be spoofed to reach any
address, any host name opens DNS, and ssh git remotes fail (use HTTPS). In detail:

- E2B matches host names on the TLS SNI or the HTTP `Host` header, not on the address, so a client that names an
  allowed host can reach any IP. `compose.egress.yml`'s forward proxy holds better here; the two are not equivalent.
- Any host name in the list opens DNS to the sandbox's resolver for every name, which leaves a DNS tunnel. A list of
  IP addresses only does not.
- ssh (port 22) never passes, so `git@` remotes fail. HTTPS remotes work.
- A `WORCA_EGRESS_DENY` name under an allowed wildcard (`gist.github.com` under `.github.com`) cannot be carved out;
  the run log says so. Raw sockets, ICMP and IPv6 do not get out.
- If E2B refuses the settings, the run stops at start with "E2B refused the sandbox's network settings (400: …)".
  Check `WORCA_EGRESS_ALLOW` and `WORCA_EGRESS_DENY`, or set the sandbox network back to Open.

## Keys and child processes

**The model credential never enters a sandbox.** Worca starts a small relay inside each sandbox. Claude Code
sends its model calls to the relay on `127.0.0.1`; the relay carries them over the command's own stdin and stdout
to the Worca server, which adds the credential on its side, sends the call on, and returns the reply. The relay
holds no credential, and a sandbox's environment holds no `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` or
broker token. Worca opens that channel, so nothing in the sandbox connects to Worca or to the broker. The relay
only forwards the Messages API calls Claude Code makes, to the one upstream Worca chose for that step.

- It works with the [credential broker](credential-broker.md): the step's broker token stays on the server too,
  and budgets, per-person billing and the subscription rules apply as for a local run.
- Models routed through the model bridge (OpenAI, OpenRouter, Copilot, a gateway) and local models work in a
  sandbox. A model entry's own gateway key also stays on the server.
- Amazon Bedrock, Google Vertex and Microsoft Foundry models are refused for sandbox runs, because Claude Code
  signs those requests itself: pick Local for them. A model entry that carries a secret in an unusual variable
  (not its gateway key) is refused too, rather than risk sending it into the sandbox. So is a step whose
  environment would hold a model credential's value under any other variable name: Worca refuses the step
  rather than strip the variable.
- Claude Code in a sandbox sees the relay as a custom endpoint. For an Anthropic model Worca still turns tool
  search on (`ENABLE_TOOL_SEARCH=true`, with or without the broker), as a local run has it; a value the model entry
  sets wins. Every sandbox step also gets the stream timeouts a gateway step gets
  locally (`API_TIMEOUT_MS` and the stream watchdogs), unless they are set.
- A reply header that carries the credential is dropped before the reply reaches the sandbox.
- What remains: an agent can still spend credits through its run's relay while the run lives (the broker's
  budgets cap that; without the broker nothing does), and code in a sandbox can still send data out over the
  open internet.

**Codex, Copilot and Cursor** go through the same relay. Each CLI is pointed at it with a placeholder in place of
its credential, and Worca signs each call on the server and sends it to that engine's one API. Every other path is
refused, and every reply is scrubbed of the keys and tokens Worca signs with.

- **Codex** calls the relay as a custom model provider (`-c model_providers.worca_relay.*`, Responses API, no
  WebSocket) with a placeholder key. Worca signs with `CODEX_API_KEY` (or `OPENAI_API_KEY`) for
  `api.openai.com`, or with a catalog model's own endpoint key and headers. Plugin sync, apps, remote plugins, the
  updater and analytics are switched off, so codex makes no other call. Only `POST /responses` and `GET /models`
  pass.
- **Copilot** runs in its offline mode (`COPILOT_OFFLINE=true`) with the relay as its provider
  (`COPILOT_PROVIDER_*`, set by Worca). Worca looks up your account's Copilot API host once with the token and
  signs each call with it, adding the Copilot CLI's integration headers. Claude models use the Messages API,
  GPT-5 and o-series models the Responses API, other models Chat Completions. Only that one API passes.
- **Gemini CLI, Qwen Code, Goose and OpenCode** go through it per sign-in: the one their step resolves to (as a local
  run picks it) names where the calls go and which key from the worca server's environment signs them. Each CLI gets
  the relay where it takes its endpoint and a placeholder where it takes its key.
  - Gemini CLI: `GEMINI_API_KEY` for the Gemini API, or a Vertex express key (`GOOGLE_API_KEY` with
    `GOOGLE_GENAI_USE_VERTEXAI=true`), signed as `x-goog-api-key`. Usage statistics are off in its sandbox settings,
    which stops the telemetry it would send past the relay.
  - Qwen Code: its OpenAI-compatible sign-in to the server's `OPENAI_BASE_URL`, its Anthropic-compatible one to
    `ANTHROPIC_BASE_URL`, or Gemini with `GEMINI_API_KEY`, with the step's model. Its model catalog fetch and usage
    telemetry are off.
  - Goose: the provider the step's `provider/model` id names (openai, anthropic, google, openrouter, azure_openai,
    databricks), through that provider's host variable, with no keyring and no telemetry.
  - OpenCode: the provider the step's model names (anthropic, openai, google, openrouter, or OpenCode Zen), as a
    provider block in its inline config. Its model catalog fetch, updates, sharing, default plugins and LSP downloads
    are off.
  - Only the generate calls of the mode's API pass. Worca books the relay's count: tokens for Gemini CLI and Qwen
    Code, which report no cost, and the relay's price for Goose and OpenCode, never the CLI's own figures there.
- **Cursor** gets the relay as its API endpoint and a placeholder token. Worca exchanges `CURSOR_API_KEY` for an
  access token on the server, keeps it until shortly before it expires, and signs each call with it. The access
  and refresh tokens never reach the sandbox. `cursor-agent` runs its agent stream over HTTP/1.1
  (`network.useHttp1ForAgent` in its config dir in the sandbox), because the relay cannot carry the HTTP/2 stream.
  Only Cursor's dashboard, server-config, model and agent calls pass. Its key exchange and the HTTP/2 agent call
  are refused. Worca asks for uncompressed replies, reads a gzip message before it scrubs it, and refuses a reply it
  cannot read.
- Worca books the token usage its relay measured, not the CLI's own report: the cost of a Codex step, and the
  tokens of a Copilot or Cursor step (those engines report no cost).

`E2B_*` and `WORCA_E2B_*` are removed from the env of agents, scripts, actions, git calls and the Ask agent
terminal. Only the server (and the `worca` CLI you run yourself) talks to E2B. Your own terminal pane keeps them,
so `worca run --exec-env e2b`, `worca e2b sweep` and `npm run e2b:build` work there.

## Limitations

- Every engine runs in a sandbox (the engine catalog's `remote` flag, `src/shared/engine-switch.mjs`, says which).
  A sign-in that needs a token made or refreshed on this machine is refused there: Gemini CLI's Google login, Vertex
  AI with Google's Application Default Credentials or an access token, Qwen OAuth, and a key a CLI stores in its own
  config. So are Goose on Bedrock (it signs each call), Vertex AI or GitHub Copilot (hosts Goose does not let worca
  move), OpenCode's GitHub Copilot sign-in, and a Goose, OpenCode or Qwen Code step with no model. The refusal names
  the sign-ins and providers worca relays. Single-project runs of a git project only (not a Folder project, not a run without a project: the code goes in
  as a git bundle); macOS or Linux hosts only; the detached run-root mode only (`WORCA_RUN_ROOT=legacy` is
  refused). A saved E2B default skips workspace runs and runs on another engine: they run locally, the New run
  dialog shows Local for them, and the run log says why. Only an explicit per-run E2B pick is refused for them.
- Codex in a sandbox attaches no MCP server. It attaches command servers only, and those run on the worca host;
  the run log names them. Copilot and Cursor get the run's remote URL servers, as Claude does.
- A codex model on its own endpoint works in a sandbox, also at a local address: the relay calls it from the server.
- Codex takes an API key only: a ChatGPT sign-in (`codex login`, `~/.codex/auth.json`) holds a refresh token and
  calls ChatGPT's own hosts, so it is never copied into a sandbox nor relayed. Copilot takes a fine-grained
  personal access token only. A Copilot provider of your own (`COPILOT_PROVIDER_*` in the environment) is refused:
  Worca sets those itself.
- Copilot in offline mode has no GitHub MCP server, web tools or updater, and no default model: a Copilot step in a
  sandbox needs a model. A run with a model-less Copilot step is refused at start, and a Copilot helper job (title,
  overview, PR description) fails there for the same reason.
- The relay checks each Codex and Copilot call against the step's model and refuses another one
  (`403 worca-relay: model …`). Qwen Code, Goose and OpenCode calls are checked the same way where their API names
  the model: in the request body, in a Gemini call's path, in the Azure OpenAI deployment (the server's
  `AZURE_OPENAI_DEPLOYMENT_NAME`, which Goose on Azure then needs) or in the Databricks serving endpoint. Claude's,
  Cursor's and Gemini CLI's calls are not checked (the run log says so once): Gemini CLI makes its own side calls on
  other Gemini models.
- The relay books each reply at its own model's price. A price set on the step's model (free, or per million tokens)
  prices that model's replies only; a reply on a model worca has no price for leaves the step's cost unknown, which a
  cost limit stops at. The relay asks every streamed Chat Completions call for its usage, refuses a background
  Responses call, and reads the usage of a reply too large to parse whole from its end.
- If Cursor's servers ever force its agent stream onto HTTP/2, Cursor steps in a sandbox fail; the relay cannot
  carry that stream.
- An agent's own `.cursor/cli.json` or `.cursor/mcp.json` written in a sandbox does not come back to the run branch.
- Gemini CLI, Qwen Code, Goose and OpenCode in a sandbox are tested against stand-ins only (Goose 1.55 and OpenCode
  1.18.23 were checked to send each call to the path the relay takes). Until one real turn per engine passes on a real
  E2B server, treat them as unverified there. Goose attaches no MCP server in a sandbox (it attaches command servers
  only); OpenCode's sub-agent sessions stay in the sandbox, so their tool calls are not in the run log (their model
  calls are in the relay's count).
- The `WORCA_CODEX_BIN`, `WORCA_COPILOT_BIN`, `WORCA_CURSOR_BIN`, `WORCA_GEMINI_BIN`, `WORCA_QWEN_BIN`, `WORCA_GOOSE_BIN`
  and `WORCA_OPENCODE_BIN` overrides (paths on your machine) do not apply
  in a sandbox; the run log says so.
- Three checks against real accounts are still open: a Copilot turn signed with a fine-grained personal access
  token, Cursor's HTTP/2 policy (whether its servers keep accepting the HTTP/1.1 agent stream the relay carries),
  and a Cursor turn with tool calls. Until they pass, treat Copilot and Cursor in a sandbox as unverified.
- Scripts: `WORCA_PROJECT_DIR` (the envelope's `ctx.projectDir`) names your real project checkout, which the
  sandbox does not have. Use `WORCA_CWD`, the run's worktree.
- Model calls go through the relay on the server, so the sandbox holds no model credential and the credential
  broker works. Bedrock, Vertex and Foundry models are refused (pick Local).
- `ANTHROPIC_BASE_URL`: a model entry's own gateway gets only the entry's own `ANTHROPIC_AUTH_TOKEN` or
  `ANTHROPIC_API_KEY`; without one the relay adds no credential (the run log names the gateway once). A gateway set
  in the worca server's own environment is signed with the server's `ANTHROPIC_AUTH_TOKEN`, else its
  `ANTHROPIC_API_KEY`; with neither the run is refused, because the server's `CLAUDE_CODE_OAUTH_TOKEN` never goes to
  a third party. A base URL with a query string or fragment is refused (pick Local).
- MCP: servers that run a command on your machine, point at `localhost`, or carry a literal secret (a GitHub
  token, or any secret the [MCP check](credential-broker.md#mcp-servers-with-secrets) finds, in every
  `WORCA_MCP_SECRETS` mode) are dropped; each is named in the run log. Secrets reach the sandbox only as the
  `${NAME}` references of the servers it keeps, and the run log names those variables per server (never a value).
- Environment: a sandbox gets the run engine's own settings (`ANTHROPIC_*`/`CLAUDE_*`, `OPENAI_*`/`CODEX_*`,
  `COPILOT_*` or `CURSOR_*`), the locale and, for scripts, the `WORCA_*` script variables. No engine's credential,
  endpoint or provider variable goes in, even when declared. Other `WORCA_*` variables, `OTEL_*` (telemetry
  exporters), `E2B_*`, `GH_*`/`GITHUB_*` and any other `*_TOKEN`, `*_SECRET` or `*_KEY` stay on your machine. A
  script's own secret fields still reach it.
- Hooks: the host guard is off inside the sandbox (no Worca server runs there), and agent-user isolation
  (`agentSpawn`, sudo) does not apply. A model routed through the model bridge or a `localhost`
  `ANTHROPIC_BASE_URL` works: the relay reaches it from the server.
- Helper jobs (titles, PR descriptions, the classifier, the Away decider, graphify, flow cards) run on your
  machine.
- On a codex or copilot run, the title, overview, PR description, Auto classifier and Away decider jobs use this
  machine's codex or copilot CLI, as a Local run does. Worca checks that CLI at run start: when it is missing or
  signed out, the run still starts, the run log warns, and those jobs fail. A Cursor run hands them to Claude.
- Scripts that need services on your machine fail in the sandbox. Built-in scripts get Worca's `src/`,
  `scripts/`, `ui/public/{c4,fonts}` and the `yaml`/`smol-toml` packages; user and plugin scripts get their own
  directory tree only, so an npm package outside the template fails.
- Git LFS and submodules are unsupported. Git-ignored build outputs are not synced back.
- Editing the run's worktree on your machine mid-run makes the next patch fail to apply: the run fails and the
  patch is saved as `e2b-unapplied-N.patch` in the pipeline folder.
- Losing the sandbox (an E2B restart kills sandboxes, or it expired) fails the run cleanly; the work synced so
  far is committed to the run's branch. Start a new run to continue.
- Pausing needs nothing from E2B: Worca keeps the sandbox alive, it does not use E2B's own pause.
- The agent CLI in the sandbox sees none of your machine's `~/.claude`, `~/.codex`, `~/.copilot` or `~/.cursor`
  (personal skills, global instructions, plugins, sign-ins).
- A dropped SSH tunnel fails the current step with an ordinary, retryable error; only a sandbox the E2B API no
  longer knows ends the run.
- Commits an agent makes in the sandbox are flattened into Worca's commit at the end of the run (their messages
  are lost). A merge commit fails the run (`EXEC_ENV_MERGE_COMMIT`) with a hint to use Local. Watch PR's conflict
  fixes and Resolve always run locally for this reason.
- The sandbox clone holds only the run's branch and its history (no other branches, no remote), so tasks that
  need another branch belong in Local.
- Your local worktree, and so the UI's live diff, updates when each step ends, not while the agent works.
- Away mode's grace must stay below "Max wait for an answer", or the sandbox is released first (the run log
  warns).
- Files an agent deletes in the run's folders are not deleted on your machine.

## Cleaning up orphan sandboxes

When the server crashes, the sandbox of a working run expires on its own within 30 minutes. A parked sandbox
(its run was waiting for an answer, or paused) lives up to "Max wait for an answer" (240 min by default).
Worca also sweeps its own orphans: at every server start, and on demand:

```bash
worca e2b sweep --dry-run   # list this instance's sandboxes whose run is done, failed or stopped
worca e2b sweep             # remove them
worca e2b sweep --all       # every sandbox this instance tagged, live runs included
```

A sweep only touches sandboxes tagged with this Worca instance (`worca=1`, `worcaInstance=<this instance>`) and
keeps those of paused or interrupted runs. The instance id is kept in `<worca home>/instance-id`, so it survives a
hostname change, such as a container restart. As a last resort, list and remove sandboxes with the E2B CLI
(`e2b sandbox list`, `e2b sandbox kill <id>`).

## Troubleshooting

Each refusal names its cause before the run starts:

| Message | Fix |
|---|---|
| E2B execution runs the … engines only (this run uses …): … runs locally only for now | The engine has no sandbox support yet. Pick Local, or switch the engine. |
| Gemini CLI's google-login sign-in cannot run in a sandbox | Set `GEMINI_API_KEY` in the worca server's environment and choose the API key in Gemini CLI's settings, or pick Local. |
| Goose's … provider in a sandbox needs … in the worca server's environment | Set that provider's key on the worca server (a key `goose configure` or `opencode auth login` stored stays on this machine), or pick Local. |
| E2B execution runs single-project runs only | Pick Local for workspace runs. |
| E2B execution needs a git project; this is a Folder project | Pick Local, or use a git project. |
| E2B execution needs a project; this run has none | Pick Local, or pick a git project. |
| E2B execution needs the detached run-root mode | Unset `WORCA_RUN_ROOT=legacy` (or the `runRootMode` setting), or pick Local. |
| E2B execution needs a macOS or Linux worca host | Run Worca on macOS or Linux, or pick Local. |
| E2B_API_KEY is not set in the worca server's environment | Set it where the server starts, then restart the server. |
| E2B_API_URL is not set, so runs would go to E2B Cloud | Set `E2B_API_URL` to your E2B server, or `WORCA_E2B_CLOUD=1` to use E2B Cloud. |
| E2B_DEBUG=true makes the e2b SDK fake every sandbox | Unset `E2B_DEBUG`. |
| Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set | Claude runs: set one in the server's environment. |
| COPILOT_GITHUB_TOKEN is a classic token (ghp_) … | Create a fine-grained token (github_pat_…) with only the Copilot Requests permission and set it in the worca server's environment. |
| COPILOT_GITHUB_TOKEN is not set | Copilot runs: set a fine-grained token in the server's environment. |
| Codex in a sandbox needs CODEX_API_KEY or OPENAI_API_KEY | Set an OpenAI API key in the server's environment. A ChatGPT sign-in cannot be used in a sandbox. |
| This run's environment sets COPILOT_PROVIDER_… | Remove it where the server starts, or pick Local. In a sandbox Worca points Copilot at its relay itself. |
| worca-relay: worca could not sign the call: … | Worca could not look up the Copilot API host or exchange the Cursor key. The message names the answer it got: check the token's permission or the key. |
| worca-relay: … is not … call | The CLI called an API the relay does not carry (a new CLI version, or a feature that calls another service). Pick Local for that task. |
| CURSOR_API_KEY is not set | Set it in the server's environment. |
| The e2b SDK needs Node 22.19 or newer | Upgrade Node. |
| The optional "e2b" package is not installed | `npm install e2b@2.56.0` in the Worca install directory. |
| E2B refused the sandbox's network settings (400: …) | The allow list holds a value E2B does not take. Fix WORCA_EGRESS_ALLOW / WORCA_EGRESS_DENY, or set the project's Sandbox network to Open. |
| the E2B template has no codex (or copilot, cursor-agent): rebuild it | The template was built before that engine joined it; the step fails at its first spawn. Rebuild `worca-agent` (`npm run e2b:build`), then rebuild the project's template on the project page. |
| The sandbox's changes did not apply to the local worktree | Do not edit the run's worktree mid-run; the patch is in the pipeline folder. |
| The agent committed a merge in the E2B sandbox | Run the task with the Local execution environment. |
| The agent changed git hook files in the E2B sandbox (`EXEC_ENV_HOOK_CHANGE`) | Run the task with Local; worca does not bring hook changes back from a sandbox. |
| The agent changed agent configuration in the E2B sandbox (`EXEC_ENV_CONFIG_CHANGE`) | Run the task with Local; worca does not bring Claude Code, Cursor, Codex, Gemini or Copilot config, or `.mcp.json` servers that start on their own, back from a sandbox. |
| The E2B sandbox sent back changes to files worca put in the worktree (`EXEC_ENV_INJECTED_CHANGE`) | The step's changes were altered inside the sandbox. Check the saved patch; worca refused all of it. |
| The E2B sandbox wrote more into the run's folders than worca brings back (`EXEC_ENV_SYNC_BUDGET`) | Keep large outputs out of the pipeline folder, or run the task with Local. |
| No answer within N min (the run paused) | Press Resume: it continues in a fresh sandbox. To keep the sandbox longer next time, raise "Max wait for an answer". |
| This project has no environment spec yet (`EXEC_ENV_NO_SPEC`) | Set one: `worca exec-env spec --project <key> --set spec.json`. |
| E2B is not configured on this server (`EXEC_ENV_NOT_CONFIGURED`) | Set `E2B_API_KEY` and install the `e2b` package where the server runs. |
| Sandbox environments cannot be changed or built from inside the container (`EXEC_ENV_AGENT_BLOCKED`) | Open Worca through its published address. |
| Sandbox environments can only be changed from pages served by this Worca (`EXEC_ENV_CROSS_ORIGIN`) | Use the Worca page itself, not a page on another port. |
| No running worca server found | Start the server (`worca ui`), then run `worca exec-env build` again. |

Run failures carry generic codes: `EXEC_ENV_LOST` (the sandbox is gone), `EXEC_ENV_PATCH_REJECTED` (the patch did
not apply), `EXEC_ENV_MERGE_COMMIT` (the agent committed a merge), `EXEC_ENV_HOOK_CHANGE` (the agent changed git
hooks), `EXEC_ENV_CONFIG_CHANGE` (the agent changed agent CLI config or an `.mcp.json` server that starts on its own),
`EXEC_ENV_INJECTED_CHANGE` (the changes touched the memory rules or skills worca put in the worktree) and `EXEC_ENV_SYNC_BUDGET` (too much came back).
