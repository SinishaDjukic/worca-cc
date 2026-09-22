# Models, providers and the bridge

Every model call Worca makes goes through the Claude Code CLI, which speaks
one wire protocol: the Anthropic Messages API. This page covers how a model
gets into the catalog, how it reaches its endpoint, and what Worca's built-in
**bridge** does for endpoints that do not speak that protocol — GitHub Copilot
first, then any OpenAI-compatible endpoint — with no LiteLLM and no second
daemon.

Settings › Models is the one place for all of it. It is an **Expert**-level tab
(see [ui-levels.md](ui-levels.md)); anything that blocks a run shows at every
level.

## Three ways a model connects

| Connection | What happens | When to use it |
|---|---|---|
| **Anthropic API / CLI default** | The `claude` CLI uses its own login or the `ANTHROPIC_*` env it inherits. | A first-party Anthropic account. |
| **Custom endpoint via env** | The entry's routing env (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, …) is merged into that model's spawns. | An endpoint that already speaks the Messages API: a LiteLLM you run, Bedrock / Vertex via the CLI's own env, a gateway. |
| **Through a provider** | Worca points the CLI at its own loopback bridge, which forwards to the provider — passing Anthropic-shaped calls through, or translating them to OpenAI chat completions. | GitHub Copilot; OpenAI, Azure, Ollama, vLLM, Groq, an in-house gateway; an Anthropic-compatible gateway that needs a key Worca holds. |

The choice is the **Connection** section at the top of the model editor.

## Providers

The **Providers** card sits above the catalog on Settings › Models. A provider
is account-level state that every model bridged through it shares.

**GitHub Copilot.** *Sign in…* reads you the notice below, then shows an
8-character device code: enter it at github.com/login/device and the card
flips to *connected as @you*. Worca stores the GitHub token in
`~/.worca-cc/settings.json` (or reads it from your shell as `${VAR}`) and
exchanges it for Copilot's short-lived token in memory, refreshed before it
expires. *Import models…* lists what Copilot offers your account; *Refresh
usage* shows the premium-request quota. The account type (Individual /
Business / Enterprise) picks the API host when the sign-in does not name one.

**OpenAI-compatible** and **Anthropic-compatible.** A base URL, an API key
(stored masked, or `${VAR}`), and *Test connection*. A model can override
either under its Connection's *Advanced* disclosure. An OpenAI-compatible base
URL on this machine or a private network (`localhost`, `127.x`, `10.x`,
`192.168.x`, `172.16–31.x`, `*.local`) — llama.cpp's `llama-server`, Ollama,
LM Studio, a LAN vLLM — needs no key: leave it empty and the bridge sends no
`Authorization` header.

**Max concurrent requests** is per provider. Requests over the cap wait; they
never fail. For Copilot it is the one knob that lowers the abuse-detection risk
described below, so it ships at 4.

### The Copilot notice

Worca talks to Copilot through the same API GitHub's editor extensions use,
identifying itself as an editor client. GitHub's terms allow Copilot only
through supported clients, and GitHub has suspended Copilot access for
automated or unsupported use. Pipelines are automated, high-volume use.

- Your GitHub account, not Worca, carries this risk.
- Worca caps concurrent requests and never signs in without you.
- Premium-request quotas apply per your plan; Worca shows usage but cannot
  enforce it.

You acknowledge this once per machine (the date shows on the card, *Re-read
notice* shows it again), and again if the wording changes. `worca models login
copilot --accept-terms` records it non-interactively.

## What the bridge does

- **Claude models on Copilot** use Copilot's native Anthropic endpoint. The
  request and the streamed reply pass through byte for byte, so extended
  thinking and cache accounting arrive intact.
- **Other vendors on Copilot, and OpenAI-compatible endpoints** run through a
  translation layer: system prompt, text, images, tool definitions, tool calls
  and results map to chat completions; the streamed reply maps back to Messages
  events; usage and stop reasons map; a context overflow becomes the
  "prompt is too long" the CLI compacts on. Translated models have **no
  thinking blocks** (Worca's effort maps to `reasoning_effort` where the model
  supports it, else only *medium* is offered), **no WebSearch/WebFetch** (the
  runner withholds them), and lower prompt limits than Anthropic's. Worca
  turns on the CLI's tool search for them (`ENABLE_TOOL_SEARCH=true`, unless
  the entry's env sets it), so MCP tool schemas load on demand instead of all
  riding every request — a few MCP servers would otherwise put a request past
  a 32k local model's context before the first turn.
- A bridged model's id is never one the CLI knows, so its **Prompt limit** and
  **Output limit** capabilities become `CLAUDE_CODE_MAX_CONTEXT_TOKENS` and
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS` on every spawn (unless the entry's env sets
  them): auto-compact then works against the model's real window instead of an
  assumed 200k. Set them to what the endpoint actually serves — for llama.cpp,
  its `-c` value.
- A reply cut off by the endpoint (`finish_reason: length`) in the middle of a
  tool call is not forwarded as a broken call: the bridge replaces it with a
  note asking for smaller steps and ends the turn as `max_tokens`.
- The bridge listens on `127.0.0.1` on a random port, one per Worca process,
  and accepts only a per-process secret the CLI carries. It never runs as a
  separate service and holds no credentials on disk beyond `settings.json`.

Each card shows a `bridged: <provider>` badge and, for translated models, a
line naming the degradations. A model whose provider is not usable — not
signed in, notice not acknowledged, key unset — shows **needs sign-in** and
leaves every picker until it is; a run that already names it fails at its next
spawn with the fix in the message rather than with an opaque 401.

## Cost and quota

The CLI prices a bridged call by its model *name*, which it does not know, so
it reports **$0**. Copilot bills premium requests, not tokens, so imported
Copilot entries are pinned *Free* and Worca counts the requests a run
initiated instead (the cost pill reads `$0 · N requests`). A generic
OpenAI-compatible entry is flagged *cost not verified* until you pin a
per-million-token price on it.

## Import from Copilot

*Import models…* shows Copilot's chat models with vendor, context window and
capabilities. Anthropic models are imported with the passthrough API, every
other vendor with the translated one; efforts are trimmed to *medium* for
models without reasoning; pricing is *Free*. A second import refreshes
capabilities and never overwrites a label, efforts or price you edited. Models
disabled in your GitHub Copilot settings are listed greyed with the fix.

## CLI

```
worca models list                       # catalog with bridge facts
worca models providers                  # provider state, never a token
worca models login copilot [--accept-terms]
worca models logout copilot
worca models import copilot [--all | --pick id,id] [--yes]
worca models test <copilot|openai|anthropic>
worca models set openai apiKey='${OPENAI_KEY}' baseUrl=https://…/v1
```

A `worca --model copilot-gpt-5 --prompt …` run starts its own bridge.

## Plugins and team policy

A plugin manifest's `models[]` entry may carry the same `upstream` block
(`provider`, `api`, `model`, optional `baseUrl` / `headers` / `capabilities`).
A plugin never ships a credential: a `copilot` entry resolves against each
user's own sign-in, and an `apiKey` must be a `${VAR}` reference. A team policy
may ship `upstream` models under the same rule.

## Ask Worca

Ask Worca can read the catalog and the providers, explain why a model is not
ready, and set models up for you. The rule: **every change is a card you
confirm** — nothing in the catalog or on the Providers card changes until you
click Apply.

| Tool | What it does | How |
| --- | --- | --- |
| `list_models` | Every catalog model: source (built-in, user, plugin, team policy), connection (CLI default, env, provider), efforts, and for a bridged model its provider, API, upstream id, limits and readiness. A user entry adds its env, upstream and pricing — credential values masked, `${VAR}` references readable | read |
| `get_providers` | The Providers card's state: Copilot sign-in and notice, each key-based provider's base URL, whether a key is set (and from where), whether it is optional | read |
| `test_provider` | *Test connection* for one provider | read (contacts it) |
| `list_copilot_models` | What *Import models…* would list | read (contacts GitHub) |
| `propose_model_change` | `add_model`, `edit_model`, `remove_model` (user entries only), `provider` (base URL, key, concurrency, account type), `import_copilot` | card |

- The card shows the change as a before → after list, and the **warnings** that
  would still stop the model working: a `${VAR}` that is not set in Worca's
  environment, a provider with no key, a translated model with no Prompt limit, a
  local model served below a 64k window. A removal names the workflow nodes that
  fall back to the default model.
- An edit's `upstream` merges into the stored block, so changing a limit never
  restates the key; applying replays the patch onto the entry as it is then.
- **Credentials never pass through the chat.** A key is a `${VAR}` reference to a
  variable in Worca's environment or nothing — a literal key, an env value that
  looks like a token, or an auth header is refused, and Ask Worca tells you to
  paste it in Settings › Models instead.
- Signing in to Copilot and acknowledging its notice stay on the Providers card;
  built-in, plugin and team-policy models are read-only (a user entry with the
  same id overrides a built-in).
- The chat re-validates every proposal in the server over the real settings (the
  same setters the Models view calls, as a dry run), and applying runs them for
  real.

## Troubleshooting

- **A local model stalls or the run fails with "Autocompact is thrashing"** —
  the context window is too small. A pipeline agent's system prompt, tools and
  working history are ~20k tokens even right after a compaction, and the CLI
  keeps a buffer below the window, so a 32k model compacts every turn. Serve at
  least **64k** (llama.cpp `-c 65536`) and set the model's Prompt limit to match.
- **401 / "not signed in"** — sign in again on the Providers card; Copilot
  tokens can be revoked on GitHub's side.
- **"prompt is too long" early in a run** — expected on a translated model:
  Copilot's prompt limits are well below Anthropic's, and the run compacts.
- **"model not found"** — the upstream id is not offered to your account; pick
  one from *Import models…*.
- **"requests queued for copilot"** in the run log — the concurrency cap is
  doing its job; raise it on the Providers card if you accept the risk.
- **A server tool error naming WebSearch** — a translated model cannot run
  Anthropic server tools; the runner already withholds them for pipeline
  nodes, so this means an agent definition asked for one explicitly.
