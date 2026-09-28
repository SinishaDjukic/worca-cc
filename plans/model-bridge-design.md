# Model Bridge — Design

Status: draft
Scope: a **built-in, in-process API bridge** that lets the spawned `claude` CLI run against
endpoints that do not speak the Anthropic Messages API — first GitHub Copilot (a
subscription many teams already pay for), then any OpenAI-compatible endpoint — with no
LiteLLM, no external proxy, no extra install step. Builds on
[configurable-models-design.md](configurable-models-design.md) (the catalog, per-model env
routing, cost overrides, plugin models) and revisits its §3 "no provider abstraction"
non-goal.

## 1. Problem

Every model call worca makes goes through the Claude Code CLI (`claude -p`, `src/core/claude-runner.mjs`).
The CLI speaks exactly one wire protocol: the Anthropic Messages API (`POST /v1/messages`,
SSE streaming, `anthropic-version` header). The only integration surface worca offers today
is the catalog's routing env — `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`
merged into the spawn env (configurable-models §4.4).

That is enough for an endpoint that *already* speaks the Messages API (Anthropic itself,
Bedrock/Vertex via the CLI's own env, a gateway someone else runs). It is not enough for:

1. **GitHub Copilot.** A Copilot Pro / Business / Enterprise seat gives access to GPT,
   Gemini, Grok *and Claude* models — but through Copilot's own gateway, with its own
   auth (GitHub OAuth → short-lived Copilot token), its own required headers, and for the
   non-Claude models an OpenAI-shaped `chat/completions` / `responses` protocol.
2. **Any OpenAI-compatible endpoint** — OpenAI, Azure OpenAI, Ollama, vLLM, LM Studio,
   Groq, Together, an in-house gateway — that a team wants to point a worca role at.

Today the user's only option is to install and configure LiteLLM (or one of the
community `copilot-api` bridges) beside worca, keep it running, and paste its URL into a
catalog entry. That is a second daemon, a second config file, a second thing to debug,
and it puts a credential-holding proxy outside worca's control. The product goal is
**self-contained**: install worca, sign in, pick a model.

## 2. Goals

- A **loopback bridge server** inside the worca process (UI server *and* CLI — whichever
  spawns `claude`) that presents the Anthropic Messages API to the CLI and forwards to a
  configured upstream, translating where the upstream protocol differs.
- **GitHub Copilot as a first-class provider**: device-flow sign-in from the Models view,
  token exchange and refresh handled by worca, the Copilot models list importable as
  catalog entries, Copilot's native Anthropic endpoint used for Claude models (thinking
  blocks intact, zero translation) and the chat-completions endpoint for the rest.
- **Generic OpenAI-compatible upstream** (`baseUrl` + key + model name + optional headers)
  through the same translation layer.
- **No new runtime dependencies.** Node ≥ 22.13 ships `http`, `fetch`, streams and
  `crypto`; the translation is plain JavaScript.
- The bridge is **invisible to the rest of worca**: a bridged model is a catalog entry
  like any other. Selection, per-node overrides, cost booking, the Test button, title
  generation, Ask Worca, plugin distribution, team policy — all unchanged.
- **Honest UI**: a bridged model is labelled as such, the degradations of translation
  (no thinking, no server tools, lower context ceilings, no verified cost) are disclosed
  where the user picks and configures models, and the Copilot terms-of-service exposure
  is an explicit, once-acknowledged opt-in.

## 3. Non-goals

- **Replacing the CLI.** The bridge sits *under* `claude`; worca does not gain a direct
  LLM client. Everything that makes worca work (tools, permissions, hooks, sub-agents,
  session resume, compaction) stays the CLI's job.
- **A general LLM gateway.** No request logging UI, no load balancing, no fallbacks
  between upstreams, no API-key issuance for third parties. The bridge listens on
  loopback, for this process's own `claude` children, for as long as the process lives.
- **Faking what the upstream cannot do.** No synthesized thinking blocks, no pretend
  cache writes, no local implementation of Anthropic server tools (web search, web
  fetch, computer use). Unsupported → a clear error (§5.7), never a silent no-op.
- **Copilot Responses API in v1.** The `/responses` protocol (needed for some codex-class
  models) is phase 4 (§10). v1 covers `anthropic` passthrough and `openai-chat`.
- **Embeddings, Files, Batches, Vision uploads.** The CLI does not exercise them.
- **OS keychain storage** for the GitHub token. Same stance as configurable-models §4.1:
  per-user `settings.json`, masked in the API, `${VAR}` indirection available.

## 4. Architecture

### 4.1 Overview

```
worca process (ui/server.mjs OR src/cli/worca-cc.mjs)
 ├─ claude-runner.mjs ── spawn claude ──► ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/m/<catalogId>
 │                                        ANTHROPIC_AUTH_TOKEN=<per-process secret>
 │                                        ANTHROPIC_MODEL=<catalogId>   (+ tier keys, as today)
 └─ src/core/bridge/
     ├─ server.mjs          loopback http server, lazy start, one per process
     ├─ router.mjs          /m/:id/v1/messages, /m/:id/v1/messages/count_tokens
     ├─ upstreams/
     │   ├─ anthropic.mjs   passthrough: re-auth, re-header, stream bytes through
     │   └─ openai-chat.mjs Messages ⇄ chat/completions translation (§5)
     ├─ providers/
     │   ├─ copilot.mjs     device flow, token exchange/refresh, headers, models list
     │   └─ openai.mjs      static key/baseUrl provider
     ├─ translate/          pure request/response/stream mappers (unit-tested in isolation)
     └─ errors.mjs          upstream status → Anthropic error envelope
```

- **Lazy start.** `runReal` asks `resolveModelEnv(id)`; when the entry is bridged, the
  resolver calls `ensureBridge()` which starts the server on `127.0.0.1:0` (ephemeral
  port — never collides with the UI port 4317 or anything a user runs) the first time
  and returns `{ port, secret }`. Mock mode never starts it.
- **One server, many models.** The catalog id rides the base-URL path (`/m/<id>`), which
  the CLI preserves on every request. The router resolves the entry, its upstream and
  provider per request, so a settings edit takes effect on the next spawn with no
  restart.
- **Auth to the bridge.** A per-process random 32-byte secret is the CLI's
  `ANTHROPIC_AUTH_TOKEN`. Requests without it get 401. The bridge holds real
  credentials; the secret stops another local process (or a sub-agent shelling out to
  `curl`) from borrowing them. The secret is process-lifetime, never persisted, never
  logged (`describeModelEnv` already prints `ANTHROPIC_AUTH_TOKEN` as `<set, N chars>`).
- **Lifecycle.** `server.unref()` so an idle bridge never keeps the CLI process alive;
  closed on process exit. The bridge aborts the upstream fetch when the CLI disconnects
  (SIGKILL on stop, `AbortSignal` chain), so a stopped run does not keep billing.
- **Concurrency.** Per-provider semaphore (§7.4). A queued request waits; it does not
  fail. The CLI's own retry/backoff still applies on top.

### 4.2 Where the bridge lives in the model env contract

`resolveModelEnv(id)` (config.mjs) gains one branch. For an entry with `upstream`:

| key | value | note |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:<port>/m/<id>` | bridge, path-scoped |
| `ANTHROPIC_AUTH_TOKEN` | per-process secret | never the upstream credential |
| `ANTHROPIC_MODEL` | the catalog `id` | the wire id the CLI sends; the bridge maps it to `upstream.model` |
| `ANTHROPIC_API_KEY` | *deleted if inherited* | so the CLI does not prefer an ambient first-party key |
| tier keys | filled by `withTierModelEnv`, unchanged | Task aliases `sonnet|opus|fable` resolve to this entry too |

Everything else in the entry's `env` map still merges (a `CLAUDE_CODE_*` knob, say) —
except `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` and
`ANTHROPIC_MODEL`, which are **rejected at write time** when `upstream` is present
(§6.1). The reserved-key policy (`model-env.mjs`) is untouched.

`modelHasBaseUrlRouting(id)` returns true for bridged entries, so the existing
cost-unreliable watchdog (configurable-models §4.6) and the `endpoint-routed` badge keep
working without changes. The `cost` override (§4.11 there) is the mechanism that keeps
Copilot spend honest (§7.2).

### 4.3 Sub-agents and the Task aliases

The tier keys make `Task(model: 'sonnet')` resolve to the *same* bridged entry. That is
correct for a Claude-on-Copilot entry and merely odd for a GPT entry (a sub-agent asked
for "opus" gets GPT). Nothing new is needed; the per-node `subagentModel` policy already
documents that the alias is a hint, and the bridged badge on the node makes it visible.
Out of scope: mapping aliases to *different* bridged entries.

## 5. Translation surface (openai-chat)

Scope rule: **what Claude Code actually sends**, verified against the community bridges
that run Claude Code today (`ericc-ch/copilot-api`, `voidsteed/copilot-proxy-api`, both
MIT) and against the Anthropic Messages API reference. Everything not listed is dropped
with a `warn` on the run log the first time it is seen (once per process per field).

### 5.1 Request: top level

| Messages API | chat/completions | note |
|---|---|---|
| `model` (= catalog id) | `model: upstream.model` | mapped by the router |
| `system` (string \| block[]) | one leading `{role:'system'}` message | blocks joined with `\n\n`; `cache_control` dropped |
| `messages` | `messages` | §5.2 |
| `max_tokens` | `max_tokens` (or `max_completion_tokens` for reasoning models) | clamped to the model's `max_output_tokens` when the Copilot models list reports one |
| `temperature`, `top_p` | same | stripped for reasoning models that reject them |
| `top_k` | dropped | |
| `stop_sequences` | `stop` | |
| `stream: true` | `stream: true, stream_options: {include_usage: true}` | the CLI always streams |
| `tools` | `tools: [{type:'function', function:{name, description, parameters: input_schema}}]` | §5.3 |
| `tool_choice` | `auto` → `auto`, `any` → `required`, `{type:'tool',name}` → `{type:'function',function:{name}}`, `none` → `none` | |
| `tool_choice.disable_parallel_tool_use` | `parallel_tool_calls: false` | |
| `thinking: {type:'enabled', budget_tokens}` | `reasoning_effort` | bands: `<4k` → low, `<16k` → medium, else high; stripped when the model does not support reasoning (§5.6) |
| `metadata.user_id` | dropped | |
| `anthropic-beta` header | dropped | interleaved-thinking, fine-grained-tool-streaming, context-1m, prompt-caching: none apply |

### 5.2 Request: content blocks

| block | → | note |
|---|---|---|
| user `text` | `{type:'text', text}` | |
| user `image` (base64) | `{type:'image_url', image_url:{url:'data:<media>;base64,<data>'}}` | only when the model supports vision; else replaced by the text `[image omitted: model has no vision]` |
| user `document` (PDF) | text `[document omitted]` | not exercised by pipeline runs; no PDF extraction in v1 |
| user `tool_result` | `{role:'tool', tool_call_id, content}` | content blocks flattened to text; an image inside a tool result becomes a follow-up `user` message with the image (chat/completions has no image in tool messages) |
| assistant `text` | assistant `content` | |
| assistant `tool_use` | assistant `tool_calls: [{id, type:'function', function:{name, arguments: JSON.stringify(input)}}]` | ids preserved verbatim (the CLI correlates by id) |
| assistant `thinking` / `redacted_thinking` | dropped | signatures cannot be replayed through chat/completions; the CLI tolerates their absence |
| `cache_control` on any block | dropped | |

Ordering rules the mappers enforce: every `tool` message directly follows the assistant
message that issued the call (the CLI already sends them that way); consecutive same-role
text blocks merge into one message; an assistant message with only dropped thinking
blocks is removed entirely (an empty assistant turn is a 400 upstream).

### 5.3 Tools

`input_schema` → `parameters` verbatim. Tool names are already `^[a-zA-Z0-9_-]{1,64}$`
on both sides. Anthropic **server tools** (`web_search_20250305`, `web_fetch_*`,
`computer_*`, `text_editor_*`, `bash_*` when declared as server types) have no
equivalent → the request is rejected with an `invalid_request_error` naming the tool
(§5.7). Worca controls the spawned tool list, so the runner **drops `WebSearch` and
`WebFetch` from `allowedTools`/`tools`** for an `openai-chat` entry before spawn and the
prompt gains one line saying web tools are unavailable for this model. Ask Worca does the
same. This is the one place the bridge reaches back into worca's own spawn.

### 5.4 Response: streaming state machine

Chat chunks arrive as `choices[0].delta` with optional `content`, `tool_calls[]` (each
with an `index`), `reasoning_content`/`reasoning` (vendor-specific, dropped), and a final
`usage` object. The mapper emits Anthropic SSE:

1. `message_start` — synthesized on the first chunk (`id`, `model` = catalog id,
   `usage.input_tokens` from the final usage if known, else 0, patched in `message_delta`).
2. `content_block_start` / `content_block_delta` / `content_block_stop` — one block per
   contiguous text run (`text_delta`) and one per tool call index (`tool_use` with
   `input_json_delta`, arguments streamed verbatim as partial JSON). Block indexes are
   assigned in order of first appearance; a text run after a tool call opens a new block.
3. `message_delta` — `stop_reason` (§5.5) and `usage` (§5.8).
4. `message_stop`.
5. `ping` every 15 s of upstream silence, so the CLI's idle timeout does not fire on a
   slow reasoning model.

Non-streaming requests (the Test button is still streamed by the CLI, but `count_tokens`
and future callers are not) go through the same mappers with a buffered result.

### 5.5 Stop reasons

| `finish_reason` | `stop_reason` |
|---|---|
| `stop` | `end_turn` |
| `length` | `max_tokens` |
| `tool_calls` / `function_call` | `tool_use` |
| `content_filter` | `end_turn` + a `warn` on the run log |
| absent (stream cut) | `end_turn` if any content was emitted, else `api_error` (§5.7) |

### 5.6 Model capabilities

Per bridged entry the bridge keeps a capability record: `{ toolCalls, vision, reasoning,
maxPromptTokens, maxOutputTokens }`. Sources, in precedence: the entry's explicit
`upstream.capabilities` (editor, §8.3) → the Copilot models list (`/models`, cached 10 min,
fields `capabilities.supports.tool_calls`, `capabilities.limits.*`, `vendor`) → defaults
(`toolCalls: true, vision: false, reasoning: false`, no limits). The record drives §5.1
stripping, §5.2 image handling, §5.3 rejection, and the editor's efforts hint.

### 5.7 Errors

Upstream HTTP → Anthropic envelope `{type:'error', error:{type, message}}`, plus the
same status the CLI expects, so its own retry classes engage:

| upstream | → status / `error.type` | CLI reaction |
|---|---|---|
| 401 / 403 | 401 `authentication_error` | fails the node; `classifyError` → `auth` → Test button hint |
| 429 | 429 `rate_limit_error` (+ `retry-after` forwarded) | CLI backoff |
| 413 / "context length" 400 | 400 `invalid_request_error`, message `prompt is too long` | triggers the CLI's own compaction (the phrase is what the CLI matches on) |
| other 4xx | 400 `invalid_request_error` with upstream message | fails the node with the reason visible |
| 5xx / network / timeout | 502 `api_error` (`overloaded_error` for 503/529) | CLI retry |
| Copilot token expired mid-flight | one silent refresh + replay, then 401 | |
| unsupported feature (§5.3) | 400 `invalid_request_error`, message names the feature and the model | fails the node; the message is the fix instruction |

A hard **payload ceiling** (default 2.5 MiB, Copilot's observed limit) is applied
*before* forwarding and reported as the 413 → 400 case, so a run compacts instead of
dying on an opaque gateway error.

### 5.8 Usage and cost

| chat/completions | Messages |
|---|---|
| `usage.prompt_tokens` | `input_tokens` (minus cached) |
| `usage.completion_tokens` | `output_tokens` |
| `usage.prompt_tokens_details.cached_tokens` | `cache_read_input_tokens` |
| — | `cache_creation_input_tokens: 0` |

The CLI then prices these against **its own** table keyed on the *wire model name* —
which is the catalog id, i.e. unknown to it — so the CLI reports **$0** for every bridged
call. That is exactly the case configurable-models §4.6/§4.11 was built for: the
cost-unreliable watchdog flags it, and the entry's `cost` override is how the user makes it
honest. Copilot entries are created with `cost: {free: true}` plus a per-request note
(§7.2); generic OpenAI entries default to *Trust the CLI* and are flagged until the user
sets `perMtok`.

### 5.9 `count_tokens`

`POST /v1/messages/count_tokens` is answered **locally**: `ceil(chars/4)` over system +
messages + serialized tools, plus per-image and per-tool constants. Copilot exposes no
count endpoint; a ±15 % estimate is enough for the CLI's context-budget heuristics and
avoids a billed upstream round trip.

### 5.10 `anthropic` passthrough

For `api: 'anthropic'` the bridge does **no body translation**: it replaces the
`Authorization`/`x-api-key` header with the provider's credential, adds the provider's
required headers (§7.1 for Copilot), rewrites `model` to `upstream.model`, forwards
`anthropic-version` and `anthropic-beta` verbatim, and pipes the response bytes straight
back — the SSE stream is untouched, so thinking blocks, cache accounting and every beta
the upstream honours arrive intact. Only the error envelope (§5.7) and the concurrency
cap (§7.4) apply. This is the Claude-on-Copilot path and is where phase 1 stops.

## 6. Configuration

### 6.1 Catalog entry: `upstream`

Stored in `settings.json` `models[]` beside `env`, `efforts`, `cost`:

```jsonc
{
  "id": "copilot-sonnet-4.5",
  "label": "Claude Sonnet 4.5 (Copilot)",
  "efforts": ["medium", "high", "xhigh", "max"],
  "upstream": {
    "provider": "copilot",           // "copilot" | "openai" | "anthropic"
    "api": "anthropic",              // "anthropic" | "openai-chat"   (phase 4: "openai-responses")
    "model": "claude-sonnet-4.5"     // the id the upstream expects
  },
  "cost": { "free": true }
}

{
  "id": "copilot-gpt-5",
  "label": "GPT-5 (Copilot)",
  "efforts": ["medium", "high"],
  "upstream": { "provider": "copilot", "api": "openai-chat", "model": "gpt-5",
                "capabilities": { "reasoning": true, "vision": true } },   // optional override
  "cost": { "free": true }
}

{
  "id": "gw-gpt-4.1",
  "label": "GPT-4.1 (company gateway)",
  "efforts": ["medium"],
  "upstream": { "provider": "openai", "api": "openai-chat", "model": "gpt-4.1",
                "baseUrl": "https://llm.example.com/v1",       // per-entry override of the provider default
                "apiKey": "${COMPANY_LLM_KEY}",                 // literal or ${VAR}; masked in GET
                "headers": { "X-Team": "worca" } },            // extra static headers
  "cost": { "perMtok": { "input": 2, "output": 8 } }
}
```

Validation (`settings.mjs`, `assertModelUpstream` in `model-env.mjs` so plugin manifests
validate identically):

- `provider` ∈ `{copilot, openai, anthropic}`; `api` ∈ `{anthropic, openai-chat}`;
  `model` non-empty. `copilot` accepts both apis; `openai` only `openai-chat`;
  `anthropic` only `anthropic` (a generic Anthropic-compatible gateway that needs
  extra headers — the case raw `env` cannot express).
- `baseUrl` http(s) URL with no query/fragment; `apiKey` string or `${VAR}`; `headers`
  string→string, no `Authorization`/`Host`/`Content-Length`.
- `env` may not contain `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
  `ANTHROPIC_MODEL` when `upstream` is set (they would be overwritten silently otherwise;
  a rejection with the key named is better).
- `efforts` for `openai-chat` entries whose capability record says `reasoning: false`
  are clamped to `['medium']` with a warn (effort has nowhere to go).
- Entries with `upstream` are **not** `custom: 'project'`-eligible; global and plugin only.

### 6.2 Providers: `providers` settings key

Account-level state, separate from models so ten Copilot entries share one sign-in:

```jsonc
{
  "providers": {
    "copilot": {
      "githubToken": "gho_…",               // masked in GET; write-only; or "${GH_COPILOT_TOKEN}"
      "accountType": "individual",          // "individual" | "business" | "enterprise" → api host
      "acknowledgedTerms": "2026-09-20T…",  // §8.2 notice; absent = not acknowledged
      "maxConcurrent": 4,                   // §7.4
      "login": "octocat"                    // display only, from /user at sign-in
    },
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "maxConcurrent": 8
    }
  }
}
```

The Copilot **short-lived token** (≈30 min) is memory-only, refreshed on its `expires_at`
minus a margin and on a 401. Never written to disk.

### 6.3 Precedence and team policy

Provider defaults < per-entry `upstream` overrides (`baseUrl`, `apiKey`, `headers`).
Team policy (team-policy.md) may ship **models with `upstream`** exactly as it ships env
models today; it may **not** ship provider credentials (a policy is a repo file). A
policy model whose provider has no local sign-in shows as *needs sign-in* (§8.5).

### 6.4 Plugins

A plugin manifest's `models[]` accepts `upstream` with the same validation. `apiKey`
uses the existing `{secret: KEY}` placeholder + install-time prompt (configurable-models
§9). A plugin cannot ship a Copilot GitHub token; a Copilot-provider plugin model resolves
against the user's own sign-in.

### 6.5 CLI

`worca --model <id>` works for bridged ids unchanged (the CLI process starts its own
bridge). New: `worca models login copilot` (device flow in the terminal, same code path as
the UI), `worca models logout copilot`, `worca models import copilot [--all|--pick]`. All
three print the §8.2 notice on first use and require `--accept-terms` or an interactive
yes.

## 7. GitHub Copilot provider

### 7.1 Protocol facts the provider encodes

- **Sign-in**: GitHub device flow, client id `Iv1.b507a08c87ecfe98`, scope `read:user`
  (`POST https://github.com/login/device/code`, poll `POST …/oauth/access_token`).
- **Token exchange**: `GET https://api.github.com/copilot_internal/v2/token` with
  `Authorization: token <githubToken>` → `{token, expires_at, …}`.
- **API host**: `https://api.githubcopilot.com` (individual);
  `https://api.business.githubcopilot.com` / `https://api.enterprise.githubcopilot.com`
  by `accountType`. Copilot's **native Anthropic endpoint** is `<host>/v1/messages`;
  chat is `<host>/chat/completions`; models are `<host>/models`.
- **Headers** on every upstream call: `Authorization: Bearer <copilotToken>`,
  `Copilot-Integration-Id: vscode-chat`, `Editor-Version`, `Editor-Plugin-Version`,
  `User-Agent`, `Openai-Intent: conversation-panel`, `X-GitHub-Api-Version`,
  `X-Request-Id`, `Copilot-Vision-Request: true` when the body carries an image, and
  `X-Initiator: agent` when the last message is a tool result or assistant turn (`user`
  otherwise) — the header VS Code uses so a tool-loop continuation is not billed as a new
  premium request.
- These constants are copied from `ericc-ch/copilot-api` (MIT) with its notice retained
  in `THIRD_PARTY_NOTICES.md`; they are the same values every community bridge uses.

### 7.2 Billing model

Copilot bills **premium requests**, not tokens: each user-initiated `/v1/messages` call
against a premium model consumes one, multiplied by the model's multiplier; the CLI's
tool loop continuations are (with `X-Initiator: agent`) generally not billed again. Worca
cannot compute a USD figure. Copilot entries are therefore imported with
`cost: {free: true}` (so the USD budget is not inflated with phantom spend) and the bridge
**counts premium-request-initiating calls per run** (`bridge_calls` on the node telemetry,
§8.6) so the user sees the quota drain in worca's own units. The `/usage` quota endpoint
Copilot exposes is polled at sign-in and shown on the provider card (§8.1); it is not a
budget input.

### 7.3 Terms-of-service exposure

GitHub's terms and its abuse detection name **unsupported clients** and **scripted /
automated use** as grounds for suspending Copilot access, and there are public reports of
suspensions. A worca pipeline with fan-out is high-volume automated use through a client
that identifies as VS Code. Worca does not hide this: the provider is **opt-in behind an
explicit acknowledgement** (§8.2), recorded with a timestamp, re-shown when the wording
version changes. Worca never bundles a GitHub token, never signs in without the user, and
ships the concurrency cap on by default.

### 7.4 Concurrency cap

`providers.<name>.maxConcurrent` (default 4 for Copilot, 8 for openai) is a per-process
semaphore in front of the upstream fetch. Fan-out children beyond the cap wait; the run
log shows `bridge: N requests queued for copilot` once per burst. It is the one knob
that materially lowers the §7.3 risk and is therefore on the provider card, not buried
in Expert settings.

## 8. UI and UX

Level placement follows [docs/ui-levels.md](../docs/ui-levels.md): the Models tab is
Expert (E); anything that *blocks* a run or discloses a non-default state shows at every
level.

### 8.1 Settings › Models: a new **Providers** card (E)

Sits above the catalog list. One row per provider:

- **GitHub Copilot** — state pill: *Not connected* / *Connected as @login (Individual)* /
  *Token expired — sign in again* / *Sign-in blocked until terms acknowledged*. Actions:
  **Sign in…** (opens the device-flow sheet: the 8-character code in large type, a
  *Copy code* button, an *Open github.com/login/device* link, a live "waiting for
  approval…" line, cancel), **Sign out**, **Import models…** (§8.4), account type
  select (Individual / Business / Enterprise — changes the API host; explained inline),
  **Max concurrent requests** stepper with the §7.4 rationale as its hint, and a small
  quota line (*Premium requests used this month: 312 / 1500*, from `/usage` at sign-in
  and on manual refresh — never live-polled).
- **OpenAI-compatible** — base URL, API key (write-only, masked, `${VAR}` accepted with
  the existing env-row affordance), max concurrent, **Test connection** (a `GET /models`
  or a 1-token completion).
- Empty state copy: *Providers let worca run models that don't speak the Anthropic API.
  Sign in once; then add or import models below.*

### 8.2 The Copilot terms notice (every level, blocking)

Shown as a modal the first time **Sign in…** or `worca models login copilot` is used,
and again whenever the notice wording version changes:

> **Using GitHub Copilot from worca**
> Worca will talk to GitHub Copilot through the same API GitHub's editor extensions use,
> identifying itself as an editor client. GitHub's terms allow Copilot only through
> supported clients, and GitHub has suspended Copilot access for automated or
> unsupported use. Pipelines are automated, high-volume use.
> • Your GitHub account, not worca, carries this risk.
> • Worca caps concurrent requests (configurable) and never signs in without you.
> • Premium-request quotas apply per your plan; worca shows usage but cannot enforce it.
> [ ] I understand and want to continue      *Cancel* / **Continue**

Stored as `providers.copilot.acknowledgedTerms`. The Providers card shows *acknowledged
on <date>* with a *Re-read* link. There is no "don't show again" beyond the timestamp;
it is one click per machine.

### 8.3 Model editor (E): a **Connection** section

Replaces the free-form env rows as the *first* thing the editor asks. Radio:

- **Anthropic API / CLI default** — today's behaviour; env rows optional.
- **Custom endpoint via env** — today's env rows (kept verbatim for LiteLLM/Bedrock/Vertex
  users). Hint: *for endpoints that already speak the Anthropic API.*
- **Through a provider** — reveals: Provider select (Copilot / OpenAI-compatible /
  Anthropic-compatible), **API** select (*Anthropic (passthrough)* / *OpenAI chat
  completions*; the select is fixed when the provider allows only one), **Upstream
  model id** (text, with a datalist from the Copilot models list when connected, showing
  vendor and context window beside each id), optional **Base URL / API key / extra
  headers** overrides (collapsed *Advanced* disclosure, `openai` and `anthropic` providers
  only), and **Capabilities** checkboxes (*tool calls*, *vision*, *reasoning*) prefilled
  from the models list and editable for unknown endpoints.
- Env rows stay available below in every mode but, in provider mode, reject the four
  routing keys inline with the §6.1 message.
- **Efforts**: in provider mode with `openai-chat` and *reasoning* unchecked the effort
  checkboxes collapse to *medium* with the hint *this model has no reasoning control;
  effort would be ignored*. With reasoning checked, the hint reads *maps to
  reasoning_effort low/medium/high* so the user knows `xhigh`/`max` are not distinct.
- **Pricing** (existing): a provider-mode entry defaults to *Free ($0)* for Copilot with
  the hint *Copilot bills premium requests, not tokens — worca counts requests per run*;
  to *Trust the CLI* for others with a red hint *the CLI cannot price this model; set a
  rate or spend will read $0 and be flagged*.
- **Save** is refused (inline) when the chosen provider is not connected, with a link
  to the Providers card — except for team-policy/plugin entries, which save and show
  *needs sign-in* (§8.5).

### 8.4 Import from Copilot (E)

A sheet listing the models `/models` returns (`model_picker_enabled` first, previews
marked, policy-disabled ones greyed with *enable in your GitHub Copilot settings*).
Columns: label, vendor, context window, tool calls, vision, reasoning, *already in
catalog* tick. Multi-select; **Import selected** creates entries named
`copilot-<id>` with `api` chosen by vendor (Anthropic → `anthropic`, all others →
`openai-chat`), efforts per §8.3, `cost: {free: true}`, capabilities from the list. A
second import updates capabilities on existing `copilot-*` entries and never overwrites a
user-edited label or efforts. Copy at the top: *These run through your Copilot
subscription. Claude models keep extended thinking; other vendors run through a
translation layer (no thinking blocks, no web tools).*

### 8.5 Catalog cards and pickers

- **Badge** `bridged: copilot` / `bridged: openai` (E card; the pill text is the provider)
  beside the existing `endpoint-routed` badge, which stays — both are true.
- **Degradation line** on `openai-chat` cards: *translated — no thinking blocks, no
  WebSearch/WebFetch, prompt limit ~N tokens* (N from capabilities when known).
- **Needs sign-in** state (every level, because it blocks): a card whose provider is not
  connected shows a warning pill and a **Sign in** button; the model is **excluded from
  pickers** (New pipeline, composer inspector, Ask Worca, Title select, auto-workflow
  model) unless it is the current selection, in which case the picker shows it with
  *(needs sign-in)* and the run-config strip shows a blocking banner with the same button
  before Start. A run started anyway (CLI, schedule) fails fast at spawn with
  `provider copilot: not signed in — run \`worca models login copilot\`` rather than
  with an opaque 401 mid-run.
- **Picker grouping**: bridged models stay in *Your models* / *Plugins* (no fourth group);
  the option label gains the existing collision-only provenance rule plus a trailing
  `· copilot` when the label does not already say so.
- **Test button**: unchanged path (`POST /api/models/:id/test` → `runClaude` → bridge).
  New hints in `model-test.mjs#hintFor` for the bridge's own error classes:
  `provider_not_connected`, `terms_not_acknowledged`, `upstream_model_unknown`
  (Copilot 400 "model not found" → *pick an id from the import list*),
  `unsupported_feature`.

### 8.6 Run surfaces (A/E as today)

- **Node model line** (`nodeModelLine`, app.js): `GPT-5 (Copilot) · bridged` once the
  init event arrives; the resolved-model caption keeps working because the CLI reports the
  wire id, which is the catalog id.
- **Run log**: one `[bridge]` line per node at start (*bridge: copilot/openai-chat →
  gpt-5, 4 concurrent max*), the once-per-process dropped-field warnings (§5), queue
  notices (§7.4), and every §5.7 error with the upstream status.
- **Node telemetry**: `bridge_calls` (premium-request-initiating calls) on the run's
  per-node stats and summed on the run report next to tokens; shown as *Copilot requests:
  N* on the run card for Copilot models, hidden otherwise.
- **Cost pill**: Copilot nodes show *$0 · N requests* rather than a bare `$0`, so the
  zero reads as a unit mismatch, not as free.
- **Spawn diagnostics** (`WORCA_DEBUG_SPAWN`) print the bridge URL and `<set, N chars>`
  for the secret exactly like routing env today.

### 8.7 Ask Worca (S/A/E)

The model picker respects §8.5. When an `openai-chat` model is active, the composer's
tool row hides WebSearch/WebFetch and the placeholder reads *web tools unavailable for
this model*. Otherwise unchanged.

### 8.8 Getting started / docs

- A new **Getting started** tour stop on the Models view only when `hideBuiltinModels`
  is on (the "I don't have an Anthropic account" cohort): *Sign in to GitHub Copilot to
  use its models here.*
- `docs/models.md` (new) — providers, the §5 feature matrix in user terms, the §7.3
  notice verbatim, troubleshooting (*401 → sign in again*, *prompt is too long →
  expected, the run compacts*, *model not found → import list*).
- `docs/ui-levels.md` catalogue: Providers card, Connection section, import sheet → E;
  needs-sign-in banner and terms modal → every level.

## 9. API

- `GET /api/providers` → `{ copilot: {connected, login, accountType, acknowledgedTerms,
  maxConcurrent, quota?, tokenSource: 'stored'|'env'|null}, openai: {configured,
  baseUrl, keySet, maxConcurrent} }` (never a token).
- `POST /api/providers/copilot/login` → `{deviceCode, userCode, verificationUri,
  interval, expiresIn}`; `GET /api/providers/copilot/login/:deviceCode` → `{pending}` |
  `{ok, login}` | `{error}` (the UI polls at `interval`); `POST …/logout`.
- `POST /api/providers/copilot/acknowledge` → records the timestamp (+ notice version).
- `PATCH /api/providers/:name` → accountType, maxConcurrent, baseUrl, apiKey (write-only).
- `GET /api/providers/copilot/models` → the normalized models list (§8.4).
- `POST /api/providers/copilot/import-models` `{ids:[…]}` → created/updated entries.
- `GET /api/models` entries gain `upstream` (apiKey masked, `${VAR}` refs readable),
  `bridged: 'copilot'|'openai'|'anthropic'|false`, `needsSignIn: boolean`, `capabilities`.
- `POST /api/models` / `PATCH /api/models/:id` accept `upstream`; 400s carry the §6.1
  messages verbatim.
- The bridge server itself has **no** API surface beyond `/m/:id/v1/messages` and
  `/m/:id/v1/messages/count_tokens`, both bearer-gated; `GET /m/:id/v1/models` answers
  a one-entry list for clients that probe it.

## 10. Implementation order

1. **Bridge core + Anthropic passthrough + Copilot provider** — `bridge/server.mjs`,
   router, secret, lifecycle, `providers/copilot.mjs` (device flow, exchange, refresh,
   headers, models list, `/usage`), `upstreams/anthropic.mjs`, error envelope,
   concurrency cap; `resolveModelEnv` branch; `settings.mjs` `upstream` + `providers`
   storage and validation; CLI `models login/logout/import`. **Ships Claude-on-Copilot
   with thinking intact.** Terms notice in CLI and API.
2. **openai-chat translation** — `translate/request.mjs`, `translate/stream.mjs`,
   `translate/response.mjs`, capabilities, `count_tokens`, payload ceiling, tool-list
   trimming in the runner and Ask Worca. **Ships GPT/Gemini-on-Copilot and generic
   OpenAI-compatible endpoints.**
3. **UI** — Providers card, terms modal, editor Connection section, import sheet, card
   badges and needs-sign-in states, run-surface lines and `bridge_calls`, Ask Worca tool
   row, docs and ui-levels catalogue.
4. **openai-responses** upstream (codex-class models), plugin `upstream` support, team
   policy models with `upstream`.

Each phase lands as its own PR against `dev`, tests first.

## 11. Testing

- **translate/** (pure): request mapping table §5.1–5.3 case by case; block ordering
  rules; thinking-only assistant turn removal; image-in-tool-result relocation; stream
  state machine driven by recorded chat-chunk fixtures (text only, single tool call,
  parallel tool calls, tool call after text, usage-only final chunk, stream cut without
  finish_reason) asserting the exact Anthropic SSE event sequence; stop-reason table;
  usage mapping; count_tokens estimate bounds.
- **bridge server**: lazy start, ephemeral port, `unref`, bearer rejection, path-scoped
  id resolution, unknown id → 404 envelope, upstream abort on client disconnect,
  per-provider semaphore ordering, 413/context → 400 "prompt is too long", payload
  ceiling, token refresh on 401 once then fail.
- **providers/copilot**: device flow state machine against a stubbed GitHub, exchange
  and expiry refresh with fake timers, header set including `X-Initiator` and
  `Copilot-Vision-Request` rules, models list normalization, host by account type.
- **settings/config**: `upstream` validation (every rejection in §6.1), `providers`
  masking, `resolveModelEnv` bridged branch (exact env table §4.2, ambient
  `ANTHROPIC_API_KEY` removed), `modelHasBaseUrlRouting` true, tier keys filled,
  needs-sign-in derivation.
- **runner**: `WebSearch`/`WebFetch` trimmed for `openai-chat` entries only; spawn env
  otherwise byte-identical (extend `test/spawn-args.test.mjs`).
- **server**: providers routes (never leak a token), acknowledge gating of login,
  import round-trip, `GET /api/models` shape, 400 messages.
- **UI (jsdom)**: Providers card states, terms modal gating, Connection section
  reveal/validation, import sheet selection and re-import merge, picker exclusion and
  *(needs sign-in)* current-selection carve-out, run-config blocking banner.
- **End-to-end (mock)**: a `WORCA_MOCK` bridge upstream (an in-test http server speaking
  chat/completions) drives a full mock pipeline node through the real bridge so the
  spawn → bridge → translate → CLI-shaped SSE path is exercised without a network.

## 12. Licensing and provenance

- The translation layer is written fresh in worca's style (the Python of LiteLLM does not
  port; the surface is under a thousand lines of JavaScript). LiteLLM (MIT, excluding its
  `enterprise/` directory), `ericc-ch/copilot-api` (MIT), `voidsteed/copilot-proxy-api`
  (MIT) and `musistudio/claude-code-router` (MIT) are the reference implementations for
  edge cases; where a constant or a mapping table is copied verbatim (Copilot client id,
  headers, host table) the MIT notice goes into `THIRD_PARTY_NOTICES.md`.
- Ollama (MIT) is not a useful source: its compatibility layer runs the other direction
  (OpenAI → Ollama).

## 13. Decision log

| Decision | Choice | Why |
|---|---|---|
| Where the bridge runs | In-process loopback server, lazy, ephemeral port, one per worca process | Self-contained; no daemon to install; CLI and UI server each get one without port coordination |
| Bridge auth | Per-process random secret as the CLI's `ANTHROPIC_AUTH_TOKEN` | The bridge holds real credentials; loopback alone does not stop another local process |
| Claude on Copilot | Native Copilot `/v1/messages` passthrough, no translation | Keeps thinking blocks and cache accounting; smallest possible surface for phase 1 |
| Provider abstraction | `upstream` on the entry + `providers` for account state | One sign-in shared by many entries; env routing kept verbatim for the existing LiteLLM/Bedrock/Vertex users |
| Unsupported features | Reject with a named error; trim web tools before spawn | Faking server tools or thinking would hide failures; trimming turns a mid-run error into a known limitation |
| Copilot cost | `free: true` + a per-run request counter | Copilot bills premium requests; a token price would be invented |
| Terms exposure | Explicit, timestamped, once-per-machine acknowledgement | The risk is the user's account; worca must not obscure it, nor nag on every run |
| Concurrency cap | Per-provider semaphore, on the provider card, default 4 | The one knob that lowers abuse-detection risk and is cheap to explain |
| `count_tokens` | Local estimate | No upstream endpoint; a billed round trip for a heuristic is wrong |
| Responses API | Phase 4 | Only codex-class models need it; chat/completions covers the rest |
| Sub-agent aliases | Resolve to the same bridged entry (tier keys as today) | Consistent with the existing routing model; alias-to-entry mapping is a separate feature |

## 14. Open questions

- Should worca refuse to import Copilot models whose `policy.state` is not `enabled`,
  or import them disabled with the fix link? (Draft: import greyed, not selectable.)
- Business/Enterprise hosts and the native `/v1/messages` path: verified on individual
  only; the plan assumes the same path on the other hosts and the Test button is the
  check.
- Whether `X-Initiator: agent` continuation calls are billed differently by plan is
  GitHub's rule, not worca's; the request counter counts what worca initiated, and the
  docs say so.
