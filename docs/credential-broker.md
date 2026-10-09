# Credential broker

The credential broker keeps model keys out of worca's container. worca holds no Anthropic,
OpenAI, OpenRouter or Copilot credential: every `claude` process it starts gets a short-lived
token from the broker instead, and the broker adds the real credential on the way to the
provider.

The original design, with the reasoning behind each decision, is in
[`plans/credential-broker-design.html`](../plans/credential-broker-design.html). This page
describes what is built.

## Why

A worca instance without the broker runs on one set of model credentials:
`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` sits in worca's environment, and every agent
inherits it. That causes two problems:

- **A team can't share an instance without sharing a key.** One bill, no way to tell who spent
  what, and one leak affects everyone.
- **Agents can read the key.** An agent can run `echo $ANTHROPIC_API_KEY`, and a prompt
  injection in a repository, an issue or a web page can send it anywhere.

The broker fixes both with one change: keys live only in a separate container, and agents
hold a token that only works inside the instance, only while their process lives.

## Goals and non-goals

**Goals**

- **Team.** A team of developers shares one instance. Each person uses their own model
  credentials, and costs can be told apart per person.
- **No leaks.** A rogue agent or a prompt injection can't read or leak any model credential.
- One design for every container platform (Compose, Kubernetes, Railway, a Mac hosting a
  local model). Nothing in the code is platform-specific.
- No change for native, non-container installs.

**Non-goals**

- Multi-tenancy. Projects, workflows, models, plugins, guardrails and settings stay shared.
- Privacy between teammates. Everyone signed in still sees all runs, chats, transcripts and
  code.
- Per-user permissions or an admin role.
- Correct cost attribution when a teammate acts in bad faith.

### Threat model

| Actor | Trusted | What the design protects against |
| --- | --- | --- |
| Teammates signed in through Cloudflare Access (or an identity header) | Yes | Nothing beyond accurate cost attribution. Mistakes are fine. |
| The operator (host, Railway or Cloudflare access) | Yes | Nothing. They can reach the vault and its key by definition. |
| Agents and everything they read (repositories, issues, web pages, tool output) | **No** | Reading or leaking a credential; sending one anywhere but its pinned destination; unbounded spend. |
| worca server and broker code | Trusted, hardened | Being exploited with input agents control (requests to the broker, output shown in the UI). |

The worst a rogue agent can do is spend credits, within budgets and limits. It never gets a
key.

## Support matrix

Every container setup runs Linux containers, so the broker behaves the same on every host.

| Setup | macOS (Apple silicon) | Linux | Windows | Windows + WSL2 |
| --- | --- | --- | --- | --- |
| Native, no container (broker off) | Supported | Supported | Supported | Supported |
| Local container, one person, no broker | Supported | Supported | Supported (Linux containers) | Supported |
| Local container, one person, broker **single** mode | Supported | Supported | Supported (Linux containers) | Supported |
| Hosted, a team, broker **multi** mode | **Target** (local model on the host, Metal) | **Target** (Compose, Kubernetes, Railway) | Works, not a target | Works, not a target |

- The broker is never used natively: the agent runs as your OS user and can read everything
  you can, so there is no boundary to enforce.
- Windows containers (as opposed to Linux containers on Windows) aren't supported.
- On macOS a container has no GPU (no Metal passthrough). A local model server (Ollama, LM
  Studio, llama-server, MLX) runs on the host, and the broker reaches it.

What each setup protects:

| Protection | Native | Container, no broker | Container + broker, single | Hosted, multi |
| --- | --- | --- | --- | --- |
| Agents can't read a model key | No | No | Yes | Yes |
| Each person uses their own credentials | n/a | n/a | n/a | Yes |
| Every call charged to the person who caused it | n/a | n/a | n/a | Yes (good faith) |
| Spend capped per spawn and per person | No | Run caps only | Yes | Yes |
| One person's agents can't read another's processes | n/a | n/a | n/a | With agent users per person |

## Architecture

```
                     ┌──────────────── worca container: no keys ─────────────────┐
  browser ──Access──►│ server :4317   UI, API, who pays (billTo), spawns          │
  (worca-01)         │   │ ▲                                                      │
                     │   │ │ mint / revoke / status (shared secret)               │
                     │   │ │                                                      │
                     │   ▼ │  spawn with ANTHROPIC_BASE_URL=broker/p/<slot>        │
                     │ claude agents        ANTHROPIC_AUTH_TOKEN=wbt_…            │
                     │ (a user per person)  (bridged models: via worca's bridge)  │
                     └───────┬─────────────────────────────┬──────────────────────┘
                             │ /internal/* (secret)        │ /p/<slot>/… + wbt_…
                             ▼                             ▼
                     ┌──────────────── broker container: keys ───────────────────┐
  browser ──Access──►│ key page :8081        private port :8080                   │
  (worca-01-keys)    │ save / test / delete  internal API + proxy                 │
  own Access app     │        │                     │ token ok? slot, path, budget │
                     │        ▼                     ▼                              │
                     │ vault: AES-256-GCM in SQLite, write-only, per person+slot  │
                     └──────────────────────────────┬─────────────────────────────┘
                                                    │ the person's real credential
                                                    ▼
                  api.anthropic.com · api.openai.com · openrouter.ai · Copilot · local model
```

Credentials cross exactly one boundary: from the broker to the provider.

### Guarantees

| # | Guarantee | How it's enforced |
| --- | --- | --- |
| K1 | No model credential exists anywhere an agent can reach. | Keys exist only in the broker. worca refuses to start in broker mode while it finds one in its environment, in a Claude Code sign-in (its own or an agent's HOME), in the model catalog or in provider settings. |
| K2 | The broker alone decides where each credential goes. | Each slot has a fixed upstream origin in the broker's configuration, or registered by worca for an enabled plugin ([Plugin slots](#plugin-slots)). A request names a slot, never a host. A saved key is bound to the origin it was saved for: a slot that later points elsewhere never sends it there. |
| K3 | What an agent holds is worthless outside the instance. | Per-spawn `wbt_` tokens work only on the broker's private port, expire, and are revoked when their process exits. |
| K4 | The broker never sends a credential back. | Allowlisted headers each way, no redirects followed, and provider error messages scrubbed of the key and of known key shapes. worca also removes `wbt_` tokens from everything agents print. |

### One spawn

```
Alice ─ start run ─► server           billTo = alice@acme.dev
server ─ POST /internal/tokens {billTo, slots, spawnId, isolated} ─► broker ─► wbt_… (stored as sha256)
server ─ spawn claude (ANTHROPIC_BASE_URL=http://broker:8080/p/anthropic, token wbt_…)
claude ─ POST /p/anthropic/v1/messages, Bearer wbt_… ─► broker
broker   token valid? slot allowed? path allowed? budget left? → adds Alice's key
broker ─► api.anthropic.com ─► streamed reply ─► claude    usage recorded for Alice
claude exits ─► server ─ DELETE /internal/tokens/<spawnId> ─► broker
```

Every `claude` process follows this path: pipeline phases, Ask turns, titles, the Models Test
button, script steps. A token belongs to one process, so it can be short-lived and dies with
it. Sub-agents inside that process share its token.

### Slots

A slot is one kind of credential with one fixed destination.

| Slot | Pinned upstream | Credential the broker adds |
| --- | --- | --- |
| `anthropic` | `https://api.anthropic.com` | An API key as `x-api-key`, or a Claude subscription token as a Bearer ([below](#claude-subscriptions)) |
| `openai` | `https://api.openai.com` | `Authorization: Bearer` |
| `openrouter` | `https://openrouter.ai` | `Authorization: Bearer` |
| `copilot` | `*.githubcopilot.com` | Copilot's short-lived token, exchanged from the person's GitHub sign-in |
| `local` | `WORCA_BROKER_LOCAL_URL` | none (keyless), or an operator-held key |
| `github` | `https://api.github.com` | Only with `WORCA_BROKER_GITHUB_CLIENT_ID`. Never proxied: its token goes to worca for one push ([Push as me](#push-as-me)) |

Operators add slots (another OpenAI-compatible gateway, say) in `WORCA_BROKER_SLOTS_FILE`. A
slot is `per-person` (each person saves their own) or `operator` (one credential for everyone,
meant for keyless local models; a real team key is off unless `WORCA_BROKER_ALLOW_TEAM_KEYS=1`).

**Every provider goes through it.** Claude models go straight to their slot. Models on
Settings › Providers (OpenAI, OpenRouter, Copilot, a gateway) still go through worca's
translation bridge, which forwards to `<broker>/p/<slot>` with the spawn's token; the slot is
the one whose pinned origin matches the model's base URL, and when two slots share an origin
the one speaking the model's API wins. Discovery and imports go through the broker too.
Keyless local endpoints reached directly by worca hold no key and bypass it.

### Plugin slots

A shared instance runs a plugin set its team agreed on, so plugins are trusted configuration:
a plugin model's endpoint gets its own per-person slot, with no slots file to write. worca
derives the slots from the enabled plugins and registers them with the broker
(`PUT /internal/plugin-slots`) at boot, after a plugin is installed, updated, enabled,
disabled or removed, and before a run or spawn when they changed. The broker keeps them across
restarts.

| Plugin model | Slot |
| --- | --- |
| `env` with a literal `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` (or `ANTHROPIC_API_KEY`) set to `{"secret": "<key>"}` | `p-<plugin>-<key>`, labelled with the Model secret's label, pinned to the base URL's origin, its paths under the base URL's path; sent as `Authorization: Bearer` (or `x-api-key`) |
| `upstream.baseUrl` (bridged) on an https origin no built-in or operator slot pins | `p-<plugin>-<host>`; the bridge finds it by origin like any other slot |

Each person adds the key on the key page, which shows the one host it is sent to. The
plugin's own *Model secrets* are never read with the broker on: its settings show a note
instead of the form, and worca refuses to start while one still holds a value (clear it).

A plugin slot is narrow: a `p-` id that can't replace a built-in or operator slot (the slots
file can't use `p-` ids), per-person only, a plain key header, the protocol's paths under the
base path, and https (http only for a private host). Saving a key checks it against the
endpoint's model list; an endpoint without one (404) accepts any key the first real call
doesn't refuse. When a plugin update moves its endpoint, keys saved for the old host show
*enter it again* and are never sent to the new one.

Refused by name, so the model can't be used with the broker on (its plugin author can fix
it): a base URL that is a `${VAR}` or missing, a secret in any other variable (such as
`ANTHROPIC_CUSTOM_HEADERS`), both key variables at once, and one secret used for two hosts.
worca logs these at boot; a run or Ask turn on such a model fails with the reason.

### Tokens

- `wbt_` plus 43 base64url characters (32 random bytes). The broker stores only a SHA-256,
  with who pays, the slots it may use, the run, the issuing server's boot id, the expiry, a
  budget, and whether the spawn runs under its person's own agent user.
- Lifetime by kind: auxiliary 10 minutes, Ask turn 2 hours, pipeline phase 24 hours; never
  more than `WORCA_BROKER_TOKEN_MAX_TTL` (48 hours).
- Revoked when the process exits, and in bulk at start for everything an earlier worca
  process issued.
- Every credential refusal is an HTTP **403** whose message starts `worca-broker:`. The
  Claude CLI retries a 401 for minutes but stops at a 403, and worca turns the message into
  a paused run (*Needs credential*, *Budget reached*) rather than a failure.

### Who pays

The person whose action caused the spawn:

| Action | Charged to |
| --- | --- |
| Start a run (UI, an Ask card, the CLI inside the container) | who started it |
| Resume, retry, feedback, an answer, an approval: anything that starts new spawns | who took that action (the run keeps its starter's agent user) |
| A scheduled run | the schedule's last editor; *Run now* charges whoever clicked |
| An Ask message | its author |
| Titles, summaries | whoever caused the item |
| Models › Test, endpoint imports | whoever clicked |
| No signed-in person (chat channels, background work) | `WORCA_BROKER_SYSTEM_BILL_TO`, or refused |
| Single mode | `local` |

## Deployments

### Native (no container)

```
  you ── browser ──► worca (your user) ──► claude agents (your user) ──► provider
                     your key: env or Claude Code sign-in, readable by agents
```

The broker is off; nothing changes. There is no boundary to protect: an agent can read
anything you can.

### Local container, one person (single mode)

```
  ┌─────────── Docker (Compose network) ────────────┐
  │  worca: no keys      ── /p/anthropic + wbt_ ──► broker: WORCA_BROKER_KEY_ANTHROPIC ──► api.anthropic.com
  │  (optional -f compose.egress.yml: worca on an internal network, no direct internet)
  └─────────────────────────────────────────────────┘
      :4317 published on localhost only; the broker publishes nothing
```

`compose.yml` + `compose.broker.yml`. Recommended when agents run autonomously on
repositories you don't fully trust. See [Single mode](#single-mode).

### Team on a Linux server or VM (multi mode, Compose)

```
  teammates ─► Cloudflare Access app A (worca-01.example.com) ─┐
  teammates ─► Cloudflare Access app B (worca-01-keys…)      ─┤ one tunnel
                                                             ▼
  ┌────────────────────── Compose network ───────────────────────────┐
  │ cloudflared ──► worca :4317 (agents as worca-agent-01…16)          │
  │            └──► broker :8081 (key page)      broker :8080 private  │
  │ volumes: /data (worca, repos, agent homes)   broker-data (vault)   │
  └──────────────────────────────────────────────────────────────────┘
```

`compose.yml` + `compose.broker.yml` + `compose.isolation.yml` (+ `compose.egress.yml` to
lock the network down). Port 8080 is never routed publicly.

### Railway (multi mode)

```
  Cloudflare tunnel ─► worca-01.example.com      ─► worca service  (volume /data, agent users)
                   └─► worca-01-keys.example.com ─► broker service :8081 (volume /data: vault)
  worca ── http://broker.railway.internal:8080 ──► broker        (private IPv6 network)
```

Two services from the same image. The broker has no public domain; its key page is a second
hostname on the existing tunnel, behind its own Access application. Agents on Railway can
still reach the internet directly: keys are safe regardless, other data leaving is outside
what the broker does. See [Cloudflare Access and Railway](#cloudflare-access-and-railway).

### Mac hosting a local model (multi mode)

```
  ┌──────────── macOS host (Apple silicon) ─────────────────────────────┐
  │  Ollama / LM Studio / llama-server on 127.0.0.1:11434 (Metal)         │
  │        ▲                                                             │
  │        │ host.docker.internal:11434 (only the broker needs it)        │
  │  ┌─────┴──── Docker Desktop / OrbStack / Colima VM ─────────────────┐ │
  │  │ worca (internal network) ──► broker ──► local slot + cloud slots  │ │
  │  └──────────────────────────────────────────────────────────────────┘ │
  │  cloudflared on the host or in Compose                                │
  └──────────────────────────────────────────────────────────────────────┘
```

Set `WORCA_BROKER_LOCAL_URL=http://host.docker.internal:11434`. If the model server takes a
key (`llama-server --api-key`), give it one and make it the `local` slot's operator
credential. Give the VM 4–6 GB for worca and the broker; the rest of unified memory is for
model weights. Disable sleep (`sudo pmset -a sleep 0`).

### Kubernetes

The same two containers: a `broker` Service on the private port inside the namespace, an
Ingress or cloudflared Deployment for the key page only, and a NetworkPolicy in place of
`compose.egress.yml`.

## Single mode

1. Generate a shared secret:

   ```bash
   docker compose run --rm --no-deps worca worca broker secrets
   ```

2. In `.env` next to `compose.yml` (**not** `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`:
   `compose.yml` would hand those to worca, and worca refuses to start while a key is within
   agents' reach):

   ```bash
   WORCA_BROKER_SECRET=<the secret from step 1>
   WORCA_BROKER_KEY_ANTHROPIC=sk-ant-…      # an API key, or a subscription token (sk-ant-oat…)
   ```

3. Start with the overlay:

   ```bash
   docker compose -f compose.yml -f compose.broker.yml up -d
   ```

worca's log then shows `credentials: broker single, slots anthropic, openai, openrouter`.

If you signed Claude Code in inside the container before, its stored login is in the
`claude-config` volume. worca refuses to start while it's there; remove it with
`docker compose run --rm worca rm /home/worca/.claude/.credentials.json`.

## Multi mode

The broker runs as a second service next to worca, with its own volume for the encrypted key
store, and its key page on its own hostname behind its own Cloudflare Access application.

### Broker variables

| Variable | Example | Meaning |
| --- | --- | --- |
| `WORCA_BROKER_MODE` | `multi` | `single` or `multi` |
| `WORCA_BROKER_SECRET` | 32+ random characters | Shared with worca; checked on `/internal/*` |
| `WORCA_BROKER_VAULT_KEY` | 32 bytes, base64 | Encrypts keys at rest. Keep it out of the data volume, and a copy in the team's password manager |
| `WORCA_BROKER_VAULT_KEY_OLD` | | Set while rotating: rows sealed with it are re-encrypted at start |
| `WORCA_BROKER_DATA_DIR` | `/data` | Where the SQLite store lives |
| `WORCA_BROKER_HOST` | `::` | Listen address (`::` on Railway's IPv6 network) |
| `WORCA_BROKER_PORT` / `WORCA_BROKER_UI_PORT` | `8080` / `8081` | Private port / key page port |
| `WORCA_BROKER_PUBLIC_URL` | `https://worca-01-keys.example.com` | The key page's address |
| `WORCA_BROKER_RETURN_URL` | `https://worca-01.example.com` | Optional "Back to worca" link |
| `WORCA_CF_ACCESS_TEAM_DOMAIN`, `WORCA_CF_ACCESS_AUD` | | The key page's **own** Access application (a different AUD from worca's) |
| `WORCA_IDENTITY_HEADER` | `X-Forwarded-Email` | Instead of Access, a header a verifying proxy sets |
| `WORCA_BROKER_DEFAULT_DAILY_USD`, `WORCA_BROKER_DEFAULT_MONTHLY_USD` | `50`, `500` | Per-person budget per slot; people may set a lower one |
| `WORCA_BROKER_LOCAL_URL` | `http://host.docker.internal:11434` | A keyless local model server (Anthropic API) as slot `local` |
| `WORCA_BROKER_SLOTS_FILE` | | JSON array of extra or overridden slots |
| `WORCA_BROKER_ALLOW_TEAM_KEYS` | `1` | Allow an operator key on a slot everyone uses (off: a shared key is what multi mode removes) |
| `WORCA_BROKER_GITHUB_CLIENT_ID` | `Iv23li…` | Optional: turns on [Push as me](#push-as-me) |
| `WORCA_BROKER_GITHUB_CLIENT_SECRET` | | Needed to renew expiring GitHub App user tokens |
| `WORCA_BROKER_GITHUB_SCOPES` | `repo` | OAuth App scopes (a GitHub App uses its own permissions) |

Every secret also accepts `<NAME>_FILE` pointing at a file.

### worca variables

| Variable | Meaning |
| --- | --- |
| `WORCA_BROKER_URL` | The broker's internal address, e.g. `http://broker:8080`. Unset = broker off |
| `WORCA_BROKER_SECRET` | The same shared secret |
| `WORCA_BROKER_SYSTEM_BILL_TO` | Optional: who pays for work no signed-in person caused |
| `WORCA_BROKER_REQUIRED` | `1`: refuse to start a multi-person instance without a broker |
| `WORCA_AGENT_POOL` | `0` turns off agent users per person |
| `WORCA_MCP_SECRETS` | `block` (default with the broker), `warn` (default without) or `off` ([MCP servers](#mcp-servers-with-secrets)) |
| `WORCA_GH_AS_PERSON` | `prefer` or `required`: pushes as the person who acted ([Push as me](#push-as-me)) |

Remove `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` from worca.

### What worca refuses

With `WORCA_BROKER_URL` set, worca exits (code 78) with a list of what it found when any model
credential is still within agents' reach:

- a provider key in its environment, including `CODEX_API_KEY` and `CURSOR_API_KEY`;
- a stored Claude Code sign-in or an `apiKeyHelper` in its own or the agents' HOME;
- a stored Codex sign-in (`~/.codex/auth.json`, or `$CODEX_HOME/auth.json`) in the same places;
- a model in the catalog whose env holds a key or routes around the broker with
  `ANTHROPIC_BASE_URL` (a plugin model on its own [plugin slot](#plugin-slots) doesn't);
- a bridged model with its own `apiKey` or a remote `baseUrl` no slot pins;
- a provider key or Copilot sign-in in Settings › Providers;
- a plugin's Model secret that holds a value.

It also exits when the broker can't be reached within 60 seconds, or the secrets differ.

### Only Claude runs

Only Claude Code spends through the broker. Codex, Cursor and Copilot sign in with their own
credentials (a ChatGPT, Cursor or GitHub sign-in, or a key in their environment), which the broker
can neither charge to a person nor keep from the agent. So with the broker on:

- a pipeline run on any other engine is refused before it starts;
- Ask Worca offers no Codex chats, and a Codex chat started before the broker was turned on is refused;
- every engine picker shows the other engines greyed out, and Settings › Models says why.

### People

Each person opens **Settings › My model credentials › Manage keys** (or the key page URL),
signs in through Access, and saves their keys; for GitHub Copilot they sign in with GitHub (a
device code) instead. The broker checks each credential with the provider before storing it.
Keys are never shown again: the page shows the last four characters, the kind (API key,
Claude subscription, GitHub), when it was added and last used, today's and this month's
spend, and optional personal caps.

Before a run starts, every model its nodes use is mapped to a slot, and a person missing any
of those credentials gets one refusal naming them all, before a worktree or a spawn exists.
A workflow with no agent card (script and flow cards only) and a mock run spawn no model, so
they start without any key.
Ask checks the model picked. Pickers show a badge per model: *your key*, *no key*, *key
rejected*, *team key* or *local*. A credential deleted or rejected mid-run, or a spent cap,
pauses the run with a message saying where to fix it; resuming continues it.

## Claude subscriptions

A person can save a Claude subscription token instead of an API key on the `anthropic` slot.
They create it with `claude setup-token` on their own machine and paste the `sk-ant-oat…`
value. The broker:

- sends it as `Authorization: Bearer` with the `oauth-2025-04-20` beta (merged with the
  CLI's own betas), never as `x-api-key`;
- checks it on save with the smallest possible message (one output token of the smallest
  model), since a subscription can't list models;
- records the tokens it uses but no dollars: Stats shows those calls as *(subscription)*,
  and dollar budgets don't apply to them.

A subscription belongs to one person. **In multi mode it is only used by spawns that run
under that person's own agent user** (see [Agent users](#agent-users-per-person)). Any other
spawn could hand it to a teammate, which for a subscription is account sharing, not just a
wrong bill; the broker refuses those with a message suggesting an API key. So a subscription
isn't used when you resume someone else's run (it keeps running as their agent user), and with
more than 16 people, those who share an agent user can't use one. In single mode it is your
own subscription and always used. Check that your plan's terms allow the use you make of it.

## MCP servers with secrets

With model keys in the broker, the one kind of credential agents could still read is a
secret inside an MCP server's definition: a run's MCP config (each project's servers plus
worca's own local-scope ones) is readable by the run's agents, and a stdio server runs as
the agent user with that environment.

Before each run worca screens the servers it hands over. A literal secret in a server's
`env` or `headers` (by name, like `LINEAR_API_KEY` or `Authorization`, or by shape, like
`ghp_…` or `sk-…`), credentials or a key parameter in its URL, or a token in its `args` is a
finding. A whole `${VAR}` reference is not: the value then comes from the agent's own
environment, which holds no credential unless the operator put one in worca's environment
on purpose.

| `WORCA_MCP_SECRETS` | Effect |
| --- | --- |
| `block` (default with the broker) | The server is left out of that run, and the run's log says which and why (never the value) |
| `warn` (default without the broker) | The server stays; the run's log says agents can read its secret |
| `off` | No check |

The check makes the exposure visible; it can't make an MCP secret safe. Prefer MCP servers
that need no secret, or accept the risk with `warn`.

**MCP registry secrets** (Settings › Sets, [mcp-servers.md](mcp-servers.md)) are outside K1: the
broker delivers them to the runs and chats that use their sets. A registry copy's definition
carries only `${MCPSECRET_…}` references, so the check above skips the registry servers and
screens project and local servers as before; a project or local server that references a
`${MCPSECRET_…}` name is left out of the run in every mode. A single-project run's committed
`.mcp.json` is loaded by Claude Code itself, where no server can be left out, so when a server
there references a `${MCPSECRET_…}` name the run gets no registry servers at all. A run with the
broker on and at least one registry secret logs "N registry secrets are visible to this run's
agents (credential broker on)". None of this is a boundary against the repository itself: a
stdio MCP server or a hook the repository commits inherits the agents' environment, registry
secrets included.

## Push as me

Optional. By default pushes and pull requests use the deployment's GitHub App or token, as
before. With **push as me**, a write (a push, a pull request) goes out with the GitHub
identity of the person who caused it:

1. Create a GitHub App (recommended: fine-grained permissions, contents and pull requests
   write; enable *Device flow*; user tokens expire and are renewed) or an OAuth App (enable
   *Device flow*).
2. On the broker: `WORCA_BROKER_GITHUB_CLIENT_ID`, and for a GitHub App
   `WORCA_BROKER_GITHUB_CLIENT_SECRET` so it can renew tokens.
3. On worca: `WORCA_GH_AS_PERSON=prefer` or `required`.
4. Each person signs in with GitHub on the key page (a device code), or pastes a
   fine-grained token.

| `WORCA_GH_AS_PERSON` | A person who connected GitHub | A person who didn't, or no signed-in person |
| --- | --- | --- |
| unset | worca's own credential | worca's own credential |
| `prefer` | their token | worca's own credential |
| `required` | their token | the push fails and says how to connect |

The token never reaches an agent: worca asks the broker (`/internal/github-token`) for one
git or gh call it makes itself, puts it in that call's environment only, and the broker's
`github` slot is never proxied. Reads (clone, fetch) keep worca's own credential, and so does
worca's own metrics branch. A GitHub App user token also only reaches repositories the App
is installed on. worca warns at start when `WORCA_GH_AS_PERSON` is set but the broker has no
GitHub client ID.

## Cloudflare Access and Railway

Use a **first-level** hostname for the key page (`worca-01-keys.example.com`, not
`keys.worca-01.example.com`): Cloudflare's free certificate covers one subdomain level.

1. **Tunnel.** On the existing worca tunnel, add a second public hostname
   `worca-01-keys.example.com` → HTTP → `broker.railway.internal:8081`. Never route port 8080.
2. **Access application.** Add a self-hosted application for `worca-01-keys.example.com` with
   the same Allow policy as worca's. Its AUD tag is the broker's `WORCA_CF_ACCESS_AUD`.
3. **Railway service.** New service `broker` from the same image and version as worca:
   start command `worca-entrypoint worca broker`, a volume at `/data`,
   `RAILWAY_RUN_UID=0` (the entrypoint prepares the volume and drops to `worca`),
   `WORCA_BROKER_DATA_DIR=/data`, `WORCA_BROKER_HOST=::`, `PORT=8081`, healthcheck `/healthz`,
   no public domain, plus the variables above. Seal the secrets.
4. **worca service.** Set `WORCA_BROKER_URL=http://broker.railway.internal:8080` and
   `WORCA_BROKER_SECRET`; remove the old Claude credential. Deploy the broker first.

Section 9 of the design has the dashboard and API steps, checks and troubleshooting.
`tools/railway/worca-railway.mjs` knows the broker once the target names it
(`RAILWAY_BROKER_SERVICE`, `RAILWAY_BROKER_SERVICE_ID`, `KEYS_URL`): upgrades move both
services to one image (broker first), `--service broker` sets its variables, and `verify`
checks the key page and, with `--in-container`, the agent boundary.

## Costs per person

**Stats** has a *By person* card: each person's model spend, requests and tokens in the
selected period, with the providers they used, as the broker metered them. Subscription
calls count tokens and requests but no dollars.

## Agent users per person

On a shared instance, run agents under their own users so one person's agents can't read
another's processes (where a live spawn's token sits):

- **Railway** and other single-volume hosts (`WORCA_DATA_DIR`) do this already.
- **Compose** (a Linux server, or a Mac hosting a local model): add
  `docker/compose.isolation.yml`:

  ```bash
  docker compose -f compose.yml -f compose.broker.yml -f compose.isolation.yml up -d
  ```

  It keeps everything on one volume (`/data`, repositories under `/data/projects`), starts as
  root only to prepare it, and lifts `no-new-privileges` so worca can `sudo` to the agent users
  (never to root). It keeps the `FSETID` capability, without which the kernel silently drops
  the shared folders' setgid bit (the entrypoint warns). Needs Docker Compose 2.24 or newer.

The image has a pool of 16 agent users (`worca-agent-01…16`). Each signed-in person gets one
for good (stored in `agent-pool.json` in worca's home), with its own home folder, where Claude
Code keeps that person's sessions. A resumed run keeps its starter's user; the person who
resumes pays. Work with no signed-in person uses the shared `worca-agent`. With more than 16
people, the rest share users by a stable hash (worca warns once). `WORCA_AGENT_POOL=0` turns
the pool off.

Ask Worca runs as the person's agent user too. Its worca tools (runs, projects, memory…)
then run inside the worca server: the chat's tool process only relays each call over
loopback with a token that lives for one turn.

## Limits and accepted risks

| Risk | Impact | Why it's accepted |
| --- | --- | --- |
| Two people who share an agent user (more than 16 people) can use each other's live tokens | Credits spent on the wrong person, never a key | Budgets cap it; a subscription is never used by a shared user |
| Repositories, run checkouts and Ask's folders are shared by all agent users | Code one person's run plants can run in another's | Teammates share repositories anyway |
| On Railway, agents can reach the internet directly | Data (not keys) can leave | Outside what the broker does; lock the network down on Compose or Kubernetes |
| The broker sees every prompt and response | A valuable target | Small, dependency-free, logs metadata only; same image as worca |
| An MCP secret the operator passes through `${VAR}` | Readable by agents | An explicit operator choice; literal ones are blocked |
| An MCP registry secret in a set a run uses | Readable by that run's agents | The set was assigned on purpose; each run warns (outside K1) |

Not built: Amazon Bedrock and Google Vertex (the broker would have to sign requests with the
person's cloud credentials), and plugin model keys sent any way but one `Authorization` or
`x-api-key` header ([Plugin slots](#plugin-slots)).
