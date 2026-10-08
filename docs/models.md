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

**Timeouts off first party.** The CLI drops a response that has sent nothing
for about 5 minutes, reports `Request timed out.` and retries the call from
scratch. A gateway that buffers the stream sends nothing until the whole reply
is done, so a long high-effort turn fails at the same point on every retry.
Every spawn routed through Vertex, Bedrock, Foundry or an `ANTHROPIC_BASE_URL`
therefore carries `API_FORCE_IDLE_TIMEOUT=0` (lifts the fetch timeout of the
runtime the CLI is built on, which none of the other settings reach) and
`API_TIMEOUT_MS`, `CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS`,
`CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS` and `CLAUDE_STREAM_IDLE_TIMEOUT_MS` at
`1800000` (30 minutes, the CLI's ceiling). A request that never answers then
fails after 30 minutes. A value set in the shell Worca starts from, or in the
entry's env, wins. First-party spawns keep the CLI defaults. Each retry the CLI
makes shows in the run log as a warning, for example `API call failed: no HTTP
response (timeout or connection error); retry 5/10 in 4.1s`.

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

**Speech.** The same tab has a **Speech** card for Ask Worca's voice mode:
speech-to-text and text-to-speech each run in the browser (Whisper, Kokoro — the
default) or on a server you run (whisper.cpp, Kokoro-FastAPI, Piper), reached
through the OpenAI audio API. It is not a model
provider — nothing on it joins the catalog, the bridge or `/api/models`. See
[docs/speech.md](speech.md).

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
failing the run. Settings › Models picks the model for each helper call — *Title model*,
*Auto workflow model* (`WORCA_AUTO_MODEL` overrides it) and *PR description model*
(the Create PR dialog's Generate with AI; Sonnet-class by default) — so pointing them at
a steadier model leaves a flaky free model touching only the pipeline steps.

**The daily allowance.** Separately, OpenRouter caps how many `:free` requests a key
sends per day: **1000** on an account that has bought at least $10 of credit, **50**
below, reset at 00:00 UTC. Every model call is one request — each agent turn, each
tool round trip, each helper call and each retry — so a small pipeline run takes about
90 and a real feature run with review rounds several hundred. Worca shows what is left:

| Where | Shows |
| --- | --- |
| Sidebar, under the spend block | *OpenRouter free today 941 / 1000*; amber below 10%, red at 0, the reset on hover. Only with a `:free` model in the catalog |
| A run's cost pill | *$0 · 87 free requests* for a run that used `:free` models |
| New pipeline form | a warning when a node's model is `:free` and fewer requests are left than this install's typical run (the median of its recent runs; 90 before it has any) |
| Settings › Providers | the allowance under the OpenAI-compatible card, read when the tab opens |

The count is OpenRouter's own (`GET /api/v1/key`, `free_model_daily_requests`), read
every 5 minutes; between readings every `:free` call through the bridge lowers it. With
the [credential broker](credential-broker.md) each person has their own key and
allowance, read through the broker every minute. When the allowance runs out, the 429
(`free-models-per-day…`, `limit_source: openrouter_free_tier_daily`) is a **usage
limit**, not a rate limit: the run pauses at once — no retries, no recovery prompt,
and an Auto run whose classifier hit it pauses instead of falling back to a default
workflow that would hit it too — saying when the allowance comes back: *"OpenRouter's
free-model requests for today are used up (1000 / 1000) — they reset at 00:00 UTC, in
3h 12m. Resume after the reset, or switch this step to a paid model."*

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

## Codex

worca can run pipelines and Ask Worca chats on OpenAI's Codex CLI.

1. Install the `codex` CLI (or use the one bundled with the ChatGPT desktop app) and make sure worca finds it: on `PATH`, or `WORCA_CODEX_BIN=/path/to/codex` in worca's environment.
2. Sign in once in a terminal: `codex login`. `codex login status` must say you are logged in.
3. Pick Codex per run on New pipeline, or as a default in Settings › Models (Engines). For Ask Worca, Settings › Ask Worca › Engine & models.

On a Codex run the helper jobs (titles, the run overview, the PR description, the Auto workflow classifier, and Away mode's night decider) run on Codex too, read-only with codex's shell switched off, because they read text worca did not write. These jobs need a codex that knows `--disable shell_tool` and `--disable unified_exec` (`codex-cli 0.146` does).

- **The classifier and the night decider still look into the repository.** With no shell, they read it through worca's own `read_file`, `grep` and `glob`, limited to the run's checkout (and, for the night decider, its plan files), under the same protected-file rules as Ask Worca. Their tool calls are capped as on Claude: 10 for the classifier, 12 for the night decider.
- **The night decider uses Codex models on a Codex run.** Away mode's "Decided by" model is used when it is a Codex model; otherwise the run's own Codex model, otherwise Codex's default.
- **Every Codex call is priced.** When no Codex model is set, worca runs Codex's own default, GPT-5.6 Sol, by name, so its cost shows instead of $0.00.

**MCP servers on Codex.** A pipeline's MCP servers attach to its Codex nodes, with these limits:

- Codex takes stdio servers only. A remote (HTTP/SSE) server from the MCP registry refuses the run; one from a project's `.mcp.json` is skipped with a warning.
- The servers in the checkout's own `.mcp.json` attach only when Claude Code would run them without asking: those named in `enabledMcpjsonServers`, or all of them with `enableAllProjectMcpServers: true`, minus those in `disabledMcpjsonServers`. An approval counts only where a repository cannot put one: `~/.claude/settings.json`, the project's `.claude/settings.local.json` while git does not track it, and Claude Code's managed settings. Claude Code ignores a repository's own approvals in a folder you have not trusted, and worca cannot tell which folders you trust. The committed `.claude/settings.json` can only restrict: its `disabledMcpjsonServers` and an `enableAllProjectMcpServers: false` still apply. The run names the servers it leaves out for want of approval. Their `${VAR}` references are filled the way Claude Code fills them, as for any other server on Codex.
- Other servers Claude Code loads on its own (user scope, plugins) are not attached on Codex.
- Codex gives all of a run's servers one shared environment. Copies of a registry server, such as two GitHub copies with their own `GITHUB_TOKEN`, each get their own variable names there, so they attach side by side. Two other servers may not declare the same variable with different values.

**Guardrails on Codex.** Codex holds a guardrail set's command rules only in part, and not its file rules.

- A deny rule for a command, such as `Bash(git push:*)` or `Bash(curl)`, becomes a Codex command rule. These rules catch a command run directly, by full path or in an `&&` chain, but not one with a redirect, a substitution or a variable. Codex checks the commands of a shell line only when the line is plain words. Add `2>&1`, `> file`, `$(…)`, `$VAR` or `VAR=x` and the rule no longer sees the command, so `curl -sI https://example.com 2>&1` runs under a `Bash(curl)` rule. Nor do they catch a command inside `bash -c` or `env`.
- Because of that, a run with command rules needs **Allow unguarded** (`--allow-unguarded-engine`), the same as a run with rules Codex cannot hold at all. The rules still apply to the run as a partial guard. This applies to the set's rules and to the deny rules in the project's own `.claude/settings.json`.
- A bare `Bash` rule turns Codex's shell off, and `WebSearch` turns its web search off. These hold fully.
- Codex has no fetch tool to deny, and it can fetch a page with its shell (`curl`) or its web search. A `WebFetch` rule holds only when the same set also has a bare `Bash` and a `WebSearch` rule. Otherwise it is not held, and the run needs **Allow unguarded**.
- File rules (`Read(…)`, `Edit(…)`, and the protected paths of the Normal and Secure sets) and MCP tool rules cannot be held on Codex. A run whose set has any of them needs **Allow unguarded** too. The run log lists the rules that are held fully, the ones held only in part, and the ones that are not held.
- The Normal and Secure sets also protect worca's own state in `~/.worca-cc`: the database, `settings.json`, the MCP registry, plugin secrets, and the plugins, scripts, agents, workflows and policy folders. Codex cannot hold those rules either. Its sandbox already keeps it from writing outside the run's checkout and the folders worca adds for the run's outputs, and worca refuses to start Codex when any folder it could write is inside `~/.worca-cc`, other than the run store and the run's own folder. Codex can still read those files. A Claude agent can too, through its shell: the Read rules stop only Claude Code's file tools (see [Honest limitations](guardrails.md#honest-limitations)). Container mode is the containment on both engines.
- worca keeps the command rules in a Codex home of its own under `~/.worca-cc/engines/codex/homes/`, one per rule set, linked to your Codex sign-in (`auth.json`). The link follows your Codex home if it moves, and goes when you sign out. If you sign in to Codex some other way, a guarded run cannot find your sign-in.
- Changing a paused run's guardrail set moves it to another Codex home. On resume, worca links the paused step's Codex session file into the new home, so the step continues where it stopped.
- The host guard's kill-check hook does not run on Codex; its instructions to the agent still apply. (Codex hooks run only after you review and trust them in Codex itself.)

**Sub-agents and skills on Codex.**

- Research fan-out runs on Codex through its own sub-agents. worca defines its read-only investigator as a Codex agent role for each call, carrying the node's sub-agent model and effort (Codex models only) and the run's memory pointers. Codex sub-agents share the node's sandbox, so read-only is an instruction to them, as it is for Claude's investigators.
- A workspace run's per-project dispatch stays one-at-a-time on Codex.
- Skills are mounted where Codex reads them, the run checkout's `.agents/skills`. That covers the project's and the root layer's `.claude/skills`, your own `~/.claude/skills`, the skills a workflow requires, and the skills from the project's sets (Settings › Sets). Your own skills are linked rather than copied; Codex's sandbox still keeps an agent from writing to them. They are copied on Windows, and when agents run as their own user, who cannot read your home folder. They never reach the run's diff or commit.
- A set skill whose name is already taken in `.agents/skills` is mounted as `<set>-<skill>`. The run page's Context card and the audit show the name it got. On Claude a set skill is `/<set>:<skill>` instead.
- A set skill that declares `hooks:` still loads, but its hooks do not run: hooks are Claude Code's. The run warns once.
- Codex does not load worca's memory rules on its own, so its agents are told to read them from the memory folders.

**Claude models with custom endpoints.** A Claude model routed to a custom endpoint or through the model bridge no longer refuses a Codex run. Like any Claude model, it is dropped on Codex, and its nodes run on Codex's model. To run Codex itself against your own endpoint, give a Codex model a connection, below.

**Custom endpoints for Codex models.** A Codex model can run on any OpenAI-compatible endpoint that serves the Responses API, such as vLLM, LM Studio, Ollama or a gateway. In Settings › Models, add a model with Engine **Codex**, pick **OpenAI-compatible endpoint** under Connection, and enter the model id the endpoint expects. The base URL and API key come from the OpenAI-compatible row on the Providers card unless you override them under Advanced, where extra headers go too. A key is a `${VAR}` reference or a stored secret, as for Claude models.

- Codex connects to the endpoint itself; worca's bridge is not involved. Each call names the endpoint as a Codex model provider with `-c model_providers.…` settings. The key and header values reach codex through its environment, never its command line. Like codex's own `OPENAI_API_KEY`, they are visible to commands the agent runs, because `codex-cli 0.146` does not apply a shell environment policy in `codex exec`.
- Only the Responses API is offered: `codex-cli 0.146` refuses chat completions (`wire_api = "chat"`). The model's own effort setting is sent as-is.
- A run whose Codex models are all on endpoints does not need `codex login`, but only if no Codex call in it falls back to Codex's default model. That means the run has a model, and so does every Codex helper job (title, overview, PR description and memory defragment in Settings › Models, and Away mode's "Decided by" when it names a Codex model). An Auto workflow run still needs the sign-in, because its classifier may pick any Codex model.
- worca does not use OpenAI's list prices for an endpoint model, so its cost shows as unknown unless you set Pricing on the model.
- The model's Test button checks the endpoint, and a model whose endpoint has no key shows "needs API key" in pickers, like a bridged model.

**Ask Worca on Codex** needs `codex-cli 0.162` or newer. A Codex chat runs with every Codex tool that reaches the disk or the web switched off. An older codex cannot switch off its image viewer, so there a Codex chat refuses to start with "Codex isn't ready: … update codex". Pipelines on Codex are unaffected.

What an Ask chat on Codex can do, and what it cannot do:

- It reads files only through worca's `read_file`, `grep` and `glob`, inside the chat's worktrees, attachments and memory, under the same protected-file rules as a Claude chat. It has no shell, no image viewer and no Codex web search; web access goes through worca's web tools as in any chat.
- Codex keeps its sub-agent tools; no Codex setting removes them. A sub-agent gets the same locked-down tools, and the chat stops with an error as soon as one starts.
- A chat keeps the engine it started on. To switch, start a new chat.
- Images are sent with the message that carries them. PDFs need a Claude chat. Your MCP servers are available in Claude chats.
- Skills from your sets work as in a Claude chat, and the Sets picker lists them. Codex does not load them itself: each message copies them into the chat's folder, the chat is told each skill's name, description and `SKILL.md` path, and `read_file` can open that message's copy for that message only. A skill keeps its own name; when two sets have a skill of the same name, each is called `<set>-<name>`. The sets' MCP servers stay in Claude chats.
- The per-turn cost cap needs a model worca can price; on Codex the cap is checked when a reply ends.
- If Codex is not installed or not signed in, the chat says "Codex isn't ready" with the reason. It never falls back to Claude.

## GitHub Copilot CLI

worca can run pipelines on GitHub's own Copilot CLI (`copilot`). This is a separate engine from the Copilot *provider* above. The provider routes Claude Code's requests to Copilot's API through worca's bridge, as an editor client. The engine runs GitHub's own supported CLI as the agent, so the notice above does not apply to it. Your plan's AI-credit (premium request) allowance still does.

1. Install the CLI (`npm i -g @github/copilot`, version 1.0.92 or later) and make sure worca finds it: on `PATH`, or `WORCA_COPILOT_BIN=/path/to/copilot` in worca's environment.
2. Sign in once in a terminal: `copilot login`. Or put a fine-grained token with the "Copilot Requests" permission in `COPILOT_GITHUB_TOKEN`. worca never hands `GH_TOKEN` or `GITHUB_TOKEN` to an agent, so Copilot does not pick those up.
3. Pick Copilot per run on New pipeline, run `worca --engine copilot …`, or set it as the default engine in Settings › Models (Engines) or a project's Settings.

There is no sign-in status command, so worca checks only that the binary runs before a run starts. A signed-out CLI fails at the first agent node with an auth error.

**Models.** Copilot names its models its own way (`gpt-5.4`, `claude-sonnet-4.6`, `auto`) and owns no catalog entries.

- Steps run the run's model (`--model`), else Copilot's default. Helper jobs run Copilot's default; Away mode's night decider uses the run's model when it has one.
- A catalog model of another engine, or a Claude Code id or alias (`opus`, `claude-opus-4-8`), is dropped on Copilot, and the run log says so.
- Copilot bills AI credits, not tokens at list prices. worca records each node's tokens but leaves the dollar cost unknown, unless the model has a price override.

**How a node runs.**

- The prompt goes on stdin.
- The system prompt goes in a custom agent that worca writes for each call to a scratch folder handed over with `--add-dir`. It reaches the model as the agent's instructions.
- Files can be read and written in the run checkout, the memory folder and the node's output folders. Copilot refuses any other path, and in a non-interactive run nothing can approve one.
- Copilot's built-in GitHub MCP server is turned off, so it never acts with your GitHub identity. So are the servers in your own `~/.copilot/mcp-config.json`, which worca's guardrails never saw.
- Copilot also reads the checkout's `AGENTS.md`, `CLAUDE.md` and `.github/copilot-instructions.md`, as Claude Code reads `CLAUDE.md`.
- Copilot has no switch to ignore your user configuration, so the plugins and settings you installed in `~/.copilot` still load on a run (only its MCP servers are turned off).

**Guardrails on Copilot.**

- These deny rules hold fully:
  - a bare `Bash` (the shell is denied);
  - `WebSearch` (the tool is removed);
  - MCP tool rules such as `mcp__github__create_issue` or `mcp__github`.
- A `WebFetch` rule removes Copilot's fetch tool, but Copilot can still fetch a page with its shell (`curl`) or its web search. It holds only when the same set also has a bare `Bash` and a `WebSearch` rule. Otherwise it is not held.
- These hold only in part:
  - Command rules such as `Bash(git push:*)` or `Bash(curl)` become Copilot shell rules. They catch the command wherever it sits in a shell line (an `&&` chain, a redirect, a `$(…)`, a `VAR=x` prefix), but not one run through `bash -c "…"` or another interpreter.
  - `Edit(path)` and `Write(path)` become Copilot write rules. These cover Copilot's file tools but not a shell redirect.
- These cannot be held:
  - `Read(…)` rules;
  - globs in a path;
  - a command rule with a flag in it (`Bash(rm -rf:*)`), because Copilot matches a command and its sub-command, never its flags.
- As on Codex, a run with rules held only in part or not at all needs **Allow unguarded** (`--allow-unguarded-engine`). The partial rules still apply, and the run log lists each group.
- The Normal and Secure sets' rules for worca's own state in `~/.worca-cc` are path rules Copilot cannot hold. Copilot writes only the run checkout and the folders worca adds, and worca refuses to start Copilot when any of them is inside `~/.worca-cc`, other than the run store and the run's own folder.
- The host guard's kill-check hook does not run on Copilot; its instructions to the agent still apply.

**MCP, sub-agents and skills.**

- A run's MCP servers attach to its Copilot nodes, stdio and remote (HTTP/SSE) alike. `${VAR}` references are filled by Copilot from its own environment, where worca puts the values. They never reach the command line or the config file.
- The servers in the checkout's own `.mcp.json` attach only when Claude Code would run them without asking, as on Codex: named in `enabledMcpjsonServers`, or all of them with `enableAllProjectMcpServers: true`, minus those in `disabledMcpjsonServers`. The run names the ones it leaves out for want of approval. Copilot itself loads a project's `.mcp.json` and `.github/mcp.json` in a folder you trusted, so worca turns off every server in them that it does not attach.
- Research fan-out uses Copilot's `task` tool. worca defines its read-only investigator as the custom agent `worca-investigator` for each call. The agent carries the run's memory pointers and runs on the node's model.
- Skills mount at the run checkout's `.agents/skills`, as on Codex, skills from sets included (renamed `<set>-<skill>` on a clash). A set skill's hooks do not run.
- Helper jobs (titles, overview, PR description, the Auto classifier, the night decider) run with no built-in tool at all. They get only the MCP servers worca hands them (the classifier's and night decider's read-only file tools), and a scrubbed environment.

**Not on Copilot yet:**

- Ask Worca chats.
- Per-engine step and helper model slots in Settings.
- Resuming a paused run on another engine from the usage-limit banner. `worca resume <id> --engine copilot` (or `claude`) still works.

## Cursor

worca can run pipelines on Cursor's headless CLI agent. Ask Worca does not run on Cursor.

> **Unverified.** This engine was built without a Cursor CLI to test against. Each fact it relies on (binary name,
> flags, the stream format, the permission and MCP files) is listed as unverified at the top of
> `src/core/engines/cursor.mjs`. Try a short pipeline first, and report what differs.

1. Install the Cursor CLI (`cursor-agent`) and make sure worca finds it: on `PATH`, or `WORCA_CURSOR_BIN=/path/to/cursor-agent` in worca's environment. The `cursor` command that opens the editor is not the agent.
2. Sign in once in a terminal: `cursor-agent login`. `cursor-agent status` must say you are logged in. Or set `CURSOR_API_KEY` in worca's own environment; worca passes it to Cursor and stores nothing.
3. Pick Cursor per run on New pipeline, or as a default in Settings › Models (Engines). Each engine card shows whether that engine is ready.

**Models.** worca ships no Cursor models. With no model set, Cursor runs your account's default. To pick one, add a model in Settings › Models with Engine **Cursor** and the id Cursor expects (for example `sonnet-4.5`). Cursor models take no env, no endpoint and no effort. A model id that looks like a Claude id (`sonnet-4.5`) only reaches Cursor when it is in the catalog with Engine Cursor; otherwise worca treats it as Claude's and the run uses Cursor's default (the run log says so). An id that is already a built-in (a Claude model or a Codex model such as `gpt-5.6-sol`) cannot be added as a Cursor model.

**Cost.** Cursor reports no cost, so a Cursor run's cost shows as *cost unknown*, never $0.00. A pipeline cost limit cannot count Cursor's spend; the run log says so.

**Helper jobs run on Claude.** On a Cursor run, titles, the run overview, the PR description, the Auto workflow classifier and Away mode's night decider run on Claude, as on a Claude run. They read text worca did not write, and Cursor's shell cannot be switched off. Their models are the Claude helper models in Settings. The memory defrag and a workspace scan run on Cursor itself, with Cursor's default model unless you name one at start.

**What Cursor holds, and what it does not.**

- No per-role tool restriction, effort, sub-agents, hook telemetry, native skills or turn cap. The run log lists each one at start. Research fan-out runs serially. Skills, skills from sets included, are mounted as files at `.agents/skills`, and the agent is told to read them. A set skill's hooks do not run.
- Guardrails: worca writes the deny rules it can express into the run checkout's `.cursor/cli.json`. A command rule with one word (`Bash(curl)`) becomes `Shell(curl)`, a bare `Bash` becomes `Shell(*)`, `Read(…)` stays `Read(…)`, and `Edit(…)`/`Write(…)` become `Write(…)`. worca has not verified how Cursor matches them, and the agent's shell can still read a file a `Read` rule names or rewrite the file itself. So **every** rule counts as held only in part, and any set other than Permissive needs **Allow unguarded** (`--allow-unguarded-engine`). Multi-word command rules (`Bash(git push:*)`), `WebFetch`, `WebSearch` and MCP tool rules are not held at all.
- The Normal and Secure sets' rules for worca's own state in `~/.worca-cc` (the database, `settings.json`, the MCP registry, plugin secrets, and the plugins, scripts, agents, workflows and policy folders) go into `.cursor/cli.json` like the rest, as `Read(…)` and `Write(…)` rules held only in part. Unlike Codex and Copilot, Cursor has no sandbox that limits where it writes, so worca cannot refuse to start it the way it does for those two: a Cursor run with **Allow unguarded** can read and change those files through its shell. Container mode is the containment.
- Your own Cursor settings still apply: permissions in `~/.cursor/cli-config.json` and MCP servers in `~/.cursor/mcp.json` are read by Cursor, and when worca attaches MCP servers it passes `--approve-mcps`, which may approve your own servers too. No Cursor flag is known that turns them off.
- MCP servers: worca writes the run's servers into the checkout's `.cursor/mcp.json`, with secrets as `${env:NAME}` references whose values reach Cursor through its environment, never the file.
- The servers in the checkout's own `.mcp.json` join them only when Claude Code would run them without asking, as on Codex: named in `enabledMcpjsonServers`, or all of them with `enableAllProjectMcpServers: true`, minus those in `disabledMcpjsonServers`. The run names the ones it leaves out for want of approval.
- Both files are added to the repository's `.git/info/exclude`. That file is shared with your main checkout, so these two lines also hide a root-level `.cursor/cli.json` or `.cursor/mcp.json` there from `git status`; delete the two lines under `# worca: Cursor engine config` if you mind. The files are removed when the run ends and never reach the run's diff or commit. worca never writes to `~/.cursor`. If the run's checkout already holds a `.cursor/cli.json` or `.cursor/mcp.json` that worca did not write (tracked or not) and the run needs to write it, the run stops with an error instead of changing your file. worca never removes such a file. An agent's own `.cursor/cli.json` or `.cursor/mcp.json` stays in the run's result: worca stages it even though its own exclude line would hide it, unless your own ignore rules exclude that path.
- The host guard's kill-check hook does not run on Cursor; its instructions to the agent still apply.

**Usage limits.** When an engine hits its usage limit, the paused run offers to continue on each other engine that is ready (installed and signed in). Pick one. From the command line, every other engine is listed; the resume refuses one that is not ready.

**Ask Worca on Cursor is not available.** A chat needs every shell and disk tool switched off, and no Cursor switch for that is known. Cursor models are not offered in Ask Worca.

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
- **`engine cursor: cannot run cursor-agent (ENOENT)`** — install the Cursor CLI or set `WORCA_CURSOR_BIN`.
- **OpenRouter 429 on a `:free` model** — OpenRouter's shared free pool is busy,
  not your concurrency cap; see [OpenRouter](#openrouter).
- **"OpenRouter's free-model requests for today are used up"** — the key's daily
  allowance (1000, or 50 below $10 of credit bought) is spent; the run paused and
  resumes after 00:00 UTC, or switch the step to a paid model. See
  [OpenRouter › The daily allowance](#openrouter).
- **`[claude-code:unrecognized_model]` in a bridged run's log** — harmless: the
  CLI prints it for every model id it does not know, which is every bridged id.
  Worca never reports it as a failure's cause; the real error follows it.
- **An Auto run on a host without a Claude sign-in** (a hosted Worca that reaches
  models only through a provider) — Auto offers the classifier only the models
  routed through an endpoint or provider and has it name one on every stage; the
  default model is Claude Code's own and cannot run there. If the classifier
  still fails, the default workflow runs on the classifier's own model.
- **"Your previous response had no visible output"** — the endpoint ended a turn
  with no text and no tool call (reasoning only, or nothing; OpenRouter's free
  Nvidia models do it now and then). The bridge turns such a turn into a retryable
  "upstream returned no output" error, so the CLI retries it instead of giving up.
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
