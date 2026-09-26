# Models, providers and the bridge

Every model call Worca makes goes through the Claude Code CLI, which speaks
one wire protocol: the Anthropic Messages API. This page covers how a model
gets into the catalog, how it reaches its endpoint, and what Worca's built-in
**bridge** does for endpoints that do not speak that protocol — GitHub Copilot
first, then any OpenAI-compatible endpoint — with no LiteLLM and no second
daemon.

Two Settings tabs hold all of it, both **Expert**-level (see
[ui-levels.md](ui-levels.md)): **Settings › Models** is the catalog — the model
rows, the editor and the import dialog — and **Settings › Providers** is the
account-level state those rows share. Anything that blocks a run shows at every
level.

## Three ways a model connects

| Connection | What happens | When to use it |
|---|---|---|
| **Anthropic API / CLI default** | The `claude` CLI uses its own login or the `ANTHROPIC_*` env it inherits. | A first-party Anthropic account. |
| **Custom endpoint via env** | The entry's routing env (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, …) is merged into that model's spawns. | An endpoint that already speaks the Messages API: a LiteLLM you run, Bedrock / Vertex via the CLI's own env, a gateway. |
| **Through a provider** | Worca points the CLI at its own loopback bridge, which forwards to the provider — passing Anthropic-shaped calls through, or translating them to OpenAI chat completions or the OpenAI Responses API. | GitHub Copilot; OpenAI, Azure, Ollama, vLLM, Groq, an in-house gateway; an Anthropic-compatible gateway that needs a key Worca holds. |

The choice is the **Connection** section at the top of the model editor, which
opens as a dialog (*Add model*, *Edit*, *Duplicate*, *Edit a copy*) and asks
before it closes on unsaved changes.

## The catalog

Settings › Models is the catalog and nothing else. Above the rows sit a search
box (id, label or upstream id) and filter chips — *All*, *Yours*, *Built-in*,
*Plugin*, *Team*, *Needs setup*, plus *Just imported* right after an import.
Each group folds, with the count in its header; built-in models start folded.

## Providers

The **Providers** card has its own **Expert**-level tab, Settings › Providers. A
provider is account-level state that every model bridged through it shares.

**GitHub Copilot.** *Sign in…* reads you the notice below, then shows an
8-character device code: enter it at github.com/login/device and the card
flips to *connected as @you*. Worca stores the GitHub token in
`~/.worca-cc/settings.json` (or reads it from your shell as `${VAR}`) and
exchanges it for Copilot's short-lived token in memory, refreshed before it
expires. *Refresh usage* shows the premium-request quota. *Import models…* is a
shortcut: it jumps to Settings › Models and opens the import dialog there on
the Copilot source. The account type (Individual / Business / Enterprise) picks
the API host when the sign-in does not name one.

**OpenAI-compatible** and **Anthropic-compatible.** A base URL, an API key
(stored masked, or `${VAR}`), and *Test connection*. A model can override
either under its Connection's *Advanced* disclosure. An OpenAI-compatible base
URL on this machine or a private network (`localhost`, `127.x`, `10.x`,
`192.168.x`, `172.16–31.x`, `*.local`) — llama.cpp's `llama-server`, Ollama,
LM Studio, a LAN vLLM — needs no key: leave it empty and the bridge sends no
`Authorization` header. The OpenAI-compatible card's *Import models…* is the
same shortcut, and carries its base URL into the dialog.

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
  translation layer to one of two OpenAI protocols — **chat completions**, or
  the **Responses API** (Copilot serves most GPT models only through it):
  system prompt, text, images, tool definitions, tool calls and results map
  across; the streamed reply maps back to Messages events; usage and stop
  reasons map; a context overflow becomes the "prompt is too long" the CLI
  compacts on. On chat completions there are **no thinking blocks**; on the
  Responses API the model's **reasoning summary arrives as a thinking block**
  and its encrypted reasoning rides along, so the model keeps its reasoning
  across tool calls. Worca's effort maps to the model's own effort levels
  where Copilot lists them (else to `reasoning_effort` low / medium / high;
  only *medium* is offered for a model without reasoning). Translated models
  have **no WebSearch/WebFetch** (the runner withholds them) and lower prompt
  limits than Anthropic's. Worca
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
- A bridged spawn always carries `CLAUDE_CODE_USE_VERTEX=0`,
  `CLAUDE_CODE_USE_BEDROCK=0` and `CLAUDE_CODE_USE_FOUNDRY=0`: a shell that
  exports one of them for first-party Claude would otherwise make the CLI skip
  the bridge and send the model id to that cloud (`unrecognized_model`, exit 1).
  An entry with its own `ANTHROPIC_BASE_URL` gets the same defaults unless its
  env sets them.
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

## Importing models

One dialog does both imports: **Import models…**, beside *Add model* on
Settings › Models. It has a *From* picker with two sources — GitHub Copilot's
catalog (offered once you are signed in) and any OpenAI-compatible server you
run — and, for the second, a **Base URL** field. *List models* asks the source
what it has, you tick what you want, and *Import selected* writes the rows into
the catalog behind the dialog; the *Just imported* chip then filters to them.
The import lives with the catalog because catalog rows are what it produces.
Both Providers cards keep an *Import models…* shortcut that jumps here, the
OpenAI-compatible one with its base URL already filled in.

### Import from a server you run

Pick *OpenAI-compatible server*, give it a base URL, and the dialog asks that
endpoint what it serves — so a local model is added without typing its id, its
window or its capabilities. It knows four servers and falls back to the plain
list for anything else:

| Server | What Worca reads | What it learns |
|---|---|---|
| **llama.cpp** (`llama-server`) | `/props`, `/v1/models` | the window one request gets, whether the chat template takes tools, vision, the quantization, how many `--parallel` slots share `-c` |
| **Ollama** | `/api/tags`, `/api/ps` | every pulled model with its tools / vision / thinking capabilities and the window it was trained for; a loaded model's real window |
| **LM Studio** | `/api/v0/models` | type (chat, vision, embeddings), loaded state, the supported and loaded windows |
| **vLLM**, gateways, anything else | `/v1/models` | the ids, plus `max_model_len` where the server reports it |

An imported entry is bridged through the `openai` provider with the endpoint's
base URL on the entry itself — so one catalog can hold an Ollama model and a
llama.cpp model at once — priced **free**, and keyless when the URL is local. Its
id names the server (`ollama-…`, `llama-…`, `vllm-…`); a plain list on this
machine or your network is `local-…`, and one on a hosted gateway is named after
its host (`api.groq.com` → `groq-…`). A second import refreshes the upstream and
never overwrites a label, efforts or price you edited — it finds the entry by
the upstream id and base URL it points at, so an entry imported under an older
id is refreshed in place, not duplicated. Embedding models, and models whose server says they cannot call
tools, are listed but cannot be ticked: a pipeline agent needs tool calls.

**The window is the one thing Worca will not guess.** Only the window the server
*serves* becomes the entry's Prompt limit; the window a model *supports* is shown
but never pinned, because the CLI would then compact against a size the endpoint
never had. Ollama serves 4096 tokens by default whatever the model supports
(`OLLAMA_CONTEXT_LENGTH`, or `num_ctx` on the model, raises it), and llama-server
splits `-c` across its `--parallel` slots. Where the served window is unknown the
entry is imported without a Prompt limit and the sheet says so — set it once you
know it.

```
worca models import openai [--base-url http://127.0.0.1:11434/v1] [--all | --pick id,id] [--yes]
```

### OpenRouter

OpenRouter is the **OpenAI-compatible** provider pointed at
`https://openrouter.ai/api/v1` — not a provider of its own, so it shares that
card's key and *Max concurrent requests*. On the Providers card, *Preset:
OpenRouter* fills the base URL (and `${OPENROUTER_KEY}` when no key is set);
*Test connection*, then *Save*. From a terminal:

```
worca models set openrouter apiKey='${OPENROUTER_KEY}'
worca models test openrouter
worca models import openrouter --search qwen --tools --min-context 128k
```

Keep the key as a `${VAR}` reference and export it where Worca starts. OpenRouter
lists its models without a key, so a reachable list proves nothing about the key;
*Test connection* also asks OpenRouter about the key itself and shows what it
may still spend — credit left, the free-model requests left today and its rate
limit (never the key). A key OpenRouter rejects fails the test.

**Import reads what OpenRouter publishes.** The import is recognised by host, makes
one call and reads, per model: the window OpenRouter serves (pinned as the Prompt
limit — unlike Ollama, it serves what it lists), the output cap (pinned only while
it leaves half the window for the prompt; a cap that is most of the window would
overflow it on the first large turn), tool and reasoning support, image input, and
the listed price, pinned per million tokens so the entry is not *cost not verified*
(`:free` models import as Free; a variable price, like the Auto router's, is left
unset). Models that cannot call tools, or do not reply in text, are listed but
cannot be ticked. Ids keep the vendor — `openrouter-qwen-qwen3-8-27b-free` — since
two vendors ship same-named models. The dialog adds *Free* and *Tools* filters and
a minimum window to its text filter; the CLI has `--search`, `--free`, `--tools`
and `--min-context`, which narrow both the listing and `--all`.

**`:free` models and 429s.** A `:free` model runs on capacity OpenRouter shares
with every user. While that pool is busy **every** request gets a 429 —
`"limit_source": "upstream_provider_shared_pool"` — however few you send, so
*Max concurrent requests* cannot help: it caps what Worca has in flight, not
what OpenRouter will accept. For pipelines use the paid variant (a few cents a
run for a 27B model), add your own provider key on OpenRouter (BYOK — OpenRouter
then bills that provider's rate limits, not the shared pool), or give the model
fallbacks. The run log shows OpenRouter's own explanation rather than "Provider
returned error", a rate-limited step backs off and retries before it pauses, and
Worca's small helper calls — the title and the Auto workflow classifier — retry
too; a classifier that still fails falls back to the default workflow instead of
failing the run. Settings › General picks the model for each helper call — *Title model* and
*Auto workflow model* (`WORCA_AUTO_MODEL` overrides the latter) — so pointing both at
a steadier model leaves a flaky free model touching only the pipeline steps.

**Routing and fallbacks.** An OpenRouter model's *Connection › Advanced* takes
fallback models — tried in order when the first is rate-limited or down (e.g.
`qwen/qwen3.8-27b:free` falling back to `qwen/qwen3.8-27b`) — and OpenRouter's
provider routing: a provider order, a sort (price, throughput or latency) and
*allow other providers*. They are stored on the entry as
`upstream.openrouter = {models?: [...], provider?: {order?, allow_fallbacks?, sort?}}`,
validated on save, and sent only to OpenRouter. There is no CLI for them; edit
the model.

**What the bridge adds for OpenRouter** (recognised by base URL — openrouter.ai
or a subdomain). Each request asks for usage accounting (`usage: {include: true}`)
and the cost OpenRouter reports is booked per step — the real spend, fallbacks and
BYOK included — in place of the CLI's $0 and of any pinned price. Effort goes as
`reasoning: {effort}`, and a streamed `reasoning` delta shows as a thinking block;
it is not carried into the next turn. (The same mapping picks up `reasoning_content`
from vLLM and DeepSeek.) Requests carry OpenRouter's app attribution —
`HTTP-Referer: https://worca.dev`, `X-OpenRouter-Title: Worca` (and the older
`X-Title`), `X-OpenRouter-Categories: cloud-agent,cli-agent` — so every install
reports as the one public Worca app and your activity page names it; a model's own
`upstream.headers` still win. A 429 names the provider behind OpenRouter and the
limit's source, e.g. `… rate-limited upstream … [upstream_provider_shared_pool]`.
A 403 whose reason is not the key — some `:free` models are "only available on
agentic harnesses" — reads `refused (403) — <OpenRouter's reason>`, not
"authentication failed", and is never retried: it is a policy, not a blip.

**Tool schemas an upstream cannot take.** Some providers compile tool parameter
schemas into a decoding grammar that knows only part of JSON Schema and refuse the
whole request over one keyword (`unsupported schema keyword "maxLength"`, from a
tool of the CLI's own). The bridge drops the named keyword from every tool schema
and retries, and keeps dropping it for that model until Worca restarts — the run
log says so once. Such keywords only narrow what the model may send; the CLI still
checks each tool call against the full schema. A tool the grammar cannot represent
at all — the CLI's `Workflow` tool takes any JSON value, which such a grammar reads
as ambiguous — is left out of that model's requests instead, also logged once; a
pipeline agent does not need it. This applies to any OpenAI-compatible endpoint,
not only OpenRouter.

### Import from Copilot

Pick *GitHub Copilot* and the dialog shows Copilot's chat models with vendor,
context window and capabilities — no base URL, because the account's sign-in
names the host. Anthropic models are imported with the passthrough API; an
OpenAI model with the Responses API whenever Copilot serves it there, any other
model only when Copilot serves it nowhere else, and chat completions otherwise.
Efforts follow the effort levels Copilot lists for the model (*medium* only for
models without reasoning); pricing is *Free*. A second import refreshes the
API and capabilities — re-import a model whose Test says it "is not accessible
via the /chat/completions endpoint" — widens efforts only where an older import
had trimmed them to *medium*, and never overwrites a label, efforts or price
you edited. Models
disabled in your GitHub Copilot settings are listed greyed with the fix.

An entry that uses the Responses API or lists its model's effort levels needs
this Worca version or later: an older Worca drops the connection of such an
entry and runs it as a plain model. On api.openai.com, reasoning summaries are
only returned to verified organizations — if a Test on an OpenAI Responses
model reports that, switch the model to chat completions in the editor.

## CLI

```
worca models list                       # catalog with bridge facts
worca models providers                  # provider state, never a token
worca models login copilot [--accept-terms]
worca models logout copilot
worca models import copilot [--all | --pick id,id] [--yes]
worca models import openai [--base-url <url>] [--all | --pick id,id] [--yes]
                  [--search <text>] [--free] [--tools] [--min-context <n|64k>]
worca models import openrouter …        # the same, at https://openrouter.ai/api/v1
worca models test <copilot|openai|anthropic|openrouter>
worca models set openai apiKey='${OPENAI_KEY}' baseUrl=https://…/v1
worca models set openrouter apiKey='${OPENROUTER_KEY}'   # openai provider → OpenRouter
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
| `list_endpoint_models` | What an OpenAI-compatible server of yours serves, with the window each model really gets | read (contacts it) |
| `propose_model_change` | `add_model`, `edit_model`, `remove_model` (user entries only), `provider` (base URL, key, concurrency, account type), `import_copilot`, `import_endpoint` | card |

- The card shows the change as a before → after list, and the **warnings** that
  would still stop the model working: a `${VAR}` that is not set in Worca's
  environment, a provider with no key, a translated model with no Prompt limit, a
  local model served below a 64k window. A removal names the workflow nodes that
  fall back to the default model.
- "Add the model my llama.cpp server is running" is one `list_endpoint_models` call
  and an `import_endpoint` card: the ids, windows and capabilities come from the
  server, not from the chat. The card repeats the server's own warnings, and a
  model whose served window is unknown or below 64k is named in them.
- An edit's `upstream` merges into the stored block, so changing a limit never
  restates the key; applying replays the patch onto the entry as it is then.
- **Credentials never pass through the chat.** A key is a `${VAR}` reference to a
  variable in Worca's environment or nothing — a literal key, an env value that
  looks like a token, or an auth header is refused, and Ask Worca tells you to
  paste it on Settings › Providers instead.
- Signing in to Copilot and acknowledging its notice stay on the Providers card;
  built-in, plugin and team-policy models are read-only (a user entry with the
  same id overrides a built-in).
- The chat re-validates every proposal in the server over the real settings (the
  same setters the Models view calls, as a dry run), and applying runs them for
  real.

## Troubleshooting

- **An imported local model has no Prompt limit, or a wrong one** — the server did
  not report the window it serves (Ollama unless the model is loaded, LM Studio
  unless it is loaded, a plain gateway). Set it on the entry to what the server
  really serves, or load the model and import again.
- **A local model stalls or the run fails with "Autocompact is thrashing"** —
  the context window is too small. A pipeline agent's system prompt, tools and
  working history are ~20k tokens even right after a compaction, and the CLI
  keeps a buffer below the window, so a 32k model compacts every turn. Serve at
  least **64k** (llama.cpp `-c 65536`) and set the model's Prompt limit to match.
- **401 / "not signed in"** — sign in again on the Providers card; Copilot
  tokens can be revoked on GitHub's side.
- **OpenRouter 429 on a `:free` model** — OpenRouter's shared free pool is busy,
  not your concurrency cap; see [OpenRouter](#openrouter).
- **`[claude-code:unrecognized_model]` in a bridged run's log** — harmless: the
  CLI prints it for every model id it does not know, which is every bridged id.
  Worca never reports it as a failure's cause; the real error follows it.
- **A rate-limited step** (429 / 529) retries three times, waiting 5s, 10s and
  20s (longer when the upstream sends `retry-after`, at most 40s a wait), on top
  of the CLI's own ~3 minutes of retries, then pauses as recoverable — resume it
  once the limit clears.
- **"prompt is too long" early in a run** — expected on a translated model:
  Copilot's prompt limits are well below Anthropic's, and the run compacts.
- **"model not found"** — the upstream id is not offered to your account; pick
  one from *Import models…*.
- **"requests queued for copilot"** in the run log — the concurrency cap is
  doing its job; raise it on the Providers card if you accept the risk.
- **A server tool error naming WebSearch** — a translated model cannot run
  Anthropic server tools; the runner already withholds them for pipeline
  nodes, so this means an agent definition asked for one explicitly.
