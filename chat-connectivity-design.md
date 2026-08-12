# Chat Connectivity — Design

Bi-directional chat integration (Telegram, Slack, Discord, Microsoft Teams) delivered as
plugins, built on a new persistent **channel worker** seam in the plugin API.

## 1. Problem

Worca CC 1.0 has no way to reach a human who is away from the browser. Pipelines block on
`question` events (clarify / gate / recovery) until someone notices; terminal outcomes
(done / failed / paused-on-budget) are only visible in the UI. The pre-1.0 codebase had a
working integrations subsystem (`worca-ui/server/integrations/` on `master`) — Telegram
two-way, Discord/Slack outbound, dependency-free — that was left behind in the 1.0 rewrite.

## 2. Goals

- **Outbound**: notify configured chats on run lifecycle events — `done` (incl. stopped /
  paused with reason) and `error`, and above all `question` (approval needed), with reply
  instructions embedded in the message.
- **Inbound**: chat commands against the live instance — `/status /runs /last /cost`,
  `/pause /resume /stop`, and a new approval surface `/approve`, `/retry`, `/answer <n>`.
- All four platforms bi-directional in v1.
- Shipped as plugins (one per platform, in-repo under `examples/plugins/`), executing
  under the plugin sandbox rules (scrubbed env, secrets via stdin, no new runtime deps).

## 3. Non-goals

- Starting pipelines from chat (`/run`) — deliberate blast-radius exclusion for v1.
- Public webhook ingress for Telegram/Slack/Discord — those use outbound connections.
- Slack Block Kit, Teams `createConversation`/channel bootstrap, Discord DM intents,
  per-run notification pickers, message-log UI view — all deferred (§8).
- CLI-run (`worca --prompt`) notification parity — v1 wires the notifier into the UI
  server only; the notifier module itself is CLI-attachable later.

## 4. Design

### 4.1 Architecture overview

```
                         ┌─ ui/server.mjs (the only daemon) ─────────────────┐
 Orchestrator ──events──▶│ wireRun ─▶ /ws (browser)                          │
   (EventEmitter)        │ notifier ─▶ channel-host ──frames──▶ workers ─────┼──▶ Telegram long-poll
   answer/stop/pause ◀───│ command-router ◀── onInbound ◀── frames ◀─────────┼──▶ Slack Socket Mode
                         │ /api/ingress/teams/* ──webhook frames──▶ teams ───┼──▶ Discord Gateway
                         └───────────────────────────────────────────────────┘──▶ Teams Bot Framework
```

**Plugins are dumb transports.** Command parsing/execution, event→message rendering,
allowlists, chat context and muting live in host core (`src/core/chat/`), ported once from
`master`. Workers only: keep the platform connection alive, deliver a `NormalizedMessage`
in platform format, normalize platform inbound into `IncomingMessage` frames, report
connection state, absorb platform 429s at the delivery edge.

**Hybrid ingress.** Telegram (getUpdates long-poll), Slack (Socket Mode) and Discord
(Gateway) dial out — nothing is exposed. Teams is the one platform requiring a public
HTTPS endpoint (Bot Framework has no polling/socket option); the host adds exactly one
hardened, token-guarded ingress route, reached through a user-supplied tunnel.

### 4.2 Manifest: `chatChannels[]` contribution

A new top-level array, sibling of `taskSources` (named `chatChannels` because
`src/core/channels.mjs` already owns the "channel" name for pipeline data channels):

```json
{
  "name": "telegram-chat",
  "engines": { "worca-cc-api": ">=2 <3" },
  "chatChannels": [{
    "id": "main",
    "displayName": "Telegram",
    "platform": "telegram",
    "module": "./channel/worker.mjs",
    "ingress": "connect",
    "capabilities": { "inbound": true, "outbound": true },
    "configSchema": [ /* identical field semantics to taskSources */ ]
  }]
}
```

- `ingress`: `connect` (worker owns an outbound connection) | `webhook` (Teams: host
  forwards inbound HTTP as frames). Default `connect`.
- `configSchema` reuses the task-source field normalizer (factored into a shared helper),
  so `readPluginConfig` / `writePluginConfig` / `redactedConfig` (secrets.json 0600,
  `{"$env":"VAR"}` indirection, `{set:true}` browser redaction) work unchanged.
- No `task-browser` input requirement — that rule stays scoped to task sources.
- `validatePluginDir` verifies each channel `module` file exists.

### 4.3 Plugin API versioning: host API set

Plugin API 2 = "chatChannels + channel worker protocol exist". Bumping the single
`WORCA_PLUGIN_API` integer would fail-closed every existing `">=1 <2"` manifest, so the
host now advertises every API it still speaks:

- `plugin-api.mjs`: `WORCA_PLUGIN_API = 2` (current/max), `WORCA_PLUGIN_APIS = [1, 2]`.
- `apiSatisfies(range, apis = WORCA_PLUGIN_APIS)` — satisfied if **any** member satisfies
  all clauses (a number arg is normalized to `[n]` for back-compat; unparseable tokens
  still fail closed).
- `negotiatedApi(range)` → highest satisfying member; the connector shim and the worker
  `hello` frame send the negotiated version, so API-1 connectors keep receiving `1`.
  The task-source connector contract is unchanged between 1 and 2.

### 4.4 Channel worker runtime

**Child**: `src/core/chat/channel-worker-child.mjs`, the persistent analog of
`plugin-shim-child.mjs` (imports nothing from the core graph). It reads the `hello` frame
from stdin, imports the plugin module, and calls its named export
`createChannelWorker(ctx)` where
`ctx = { apiVersion, platform, config, state:{get,set}, log, emitMessage, setStatus }`.
The module returns `{ start, stop, send(chatId, msg), handleWebhook? }`. `--check` argv
mode runs the module's exported `validateConfig(config)` once and exits (used by doctor
and the CLI). `ctx.state.set` emits a `state-delta` frame; the **host** persists it via
`writePluginState`. stdout is protocol-reserved; the child installs a console shim that
routes stray output to `log` frames.

**Protocol**: JSON-lines (one frame per `\n`-terminated line), max frame 1 MiB:

| Host → worker | Worker → host |
|---|---|
| `hello {apiVersion, plugin, channelId, platform, config, state, mock?}` | `ready {identity?}` |
| `send {id, chatId, message}` | `send-result {id, ok, error?:{kind, message, retryAfterMs?}}` |
| `webhook {id, method, path, headers, bodyB64}` (Teams) | `webhook-result {id, statusCode, headers?, bodyB64?}` |
| `config {config}` (hot reload) | `status {state: connecting\|connected\|degraded\|disconnected, detail?}` |
| `ping {id}`, `shutdown` | `pong {id}`, `inbound {chatId, userId, text, meta}`, `state-delta {delta}`, `log {level, msg}` |

Error kinds reuse the shim vocabulary (`auth | rate-limit | network | plugin | timeout |
protocol`). The mock flag rides `hello` — env is scrubbed, so `WORCA_MOCK` cannot reach
the child through the environment.

**Supervisor**: `src/core/chat/channel-host.mjs`,
`createChannelHost({logger, onInbound, onStatus})` →
`{start, stop, reloadPlugin, list, status, sendMessage, handleWebhook}`.

- Discovery follows the standard plugin idiom (lock → sorted → enabled →
  `pluginCurrentDir(name)`; fail closed to `[]`). Channels with unset required config get
  status `unconfigured` and are not spawned.
- Spawn with `scrubbedEnv()` (PATH+HOME; exported from `plugin-shim.mjs` rather than
  duplicated). Config and secrets travel only on stdin.
- Crash restart backoff `[1s, 5s, 30s, 60s]`, counter reset after 60 s healthy, status
  `failed` after 10 consecutive failures (no further restarts until reload). Ping every
  30 s; two missed pongs → kill + restart. Oversize frame → kill + restart (protocol).
- Bounded outbound FIFO per worker (drop-oldest at 100, drops counted in `status()`).
- Every worker-originated string passes `redact.mjs` (ported `redactSecrets` + generic
  Bearer scrub) before reaching logs or the UI.
- Lifecycle: started at server boot; `reloadPlugin(name)` hooked into plugin
  enable/disable/config-save/install/update/uninstall routes; SIGINT/SIGTERM stops all
  workers (`shutdown` frame, 5 s grace, SIGKILL).
- **Mock mode** (`WORCA_MOCK=1` in the host): no spawn; in-memory mock worker per channel;
  test hooks `setMockChannelBehavior`, `mockSentMessages()`, `injectInboundMessage()`
  (mirrors `setMockSourceResponses`).
- **CLI**: `worca plugin channel <name> <channelId> [--check|--inspect]` — foreground
  worker with redacted frame echo; typed lines are injected as simulated inbound text.

### 4.5 Outbound notifications

- `src/core/chat/notifier.mjs`: `createNotifier({channelHost, getPrefs, chatContext,
  logger})` → `{attach(orch, meta)}`; the server attaches it right after `wireRun(entry)`.
  Subscribes `question`, `done` (status done|stopped|paused + reason), `error` — riding
  the orchestrator's exception-isolated `_emit`, so a notifier fault can never break a run.
- `src/core/chat/renderers.mjs`: 1.0 events → `NormalizedMessage` (title, segment body,
  severity). The question renderer enumerates options with ordinals and appends reply
  instructions (`Reply: /approve *a1b2` / `/answer *a1b2 2`) using run-id wildcard
  suffixes.
- Preferences: `settings.mjs` gains `chatPrefs()` / `setChatPrefs()` —
  `{notify:{done,error,question,paused}, channels:{"<plugin>/<id>":{enabled}}}` — served
  by the existing GET/POST `/api/settings`.
- Routing: enabled plugin + channel toggle + `capabilities.outbound` + connected →
  destinations from channel config `notifyChatIds` → per-chat mute check → **host-side
  rate limiter** (ported TokenBucket/FIFO/RingBuffer, default 20 msg/min/channel) →
  `channelHost.sendMessage`. Workers surface platform 429s as `send-result
  {kind:'rate-limit'}`; the host ladder retries.
- Surfacing: RingBuffer(50) of delivery results per channel in `status()` → doctor and
  plugins-view badges.

### 4.6 Inbound commands

`src/core/chat/command-router.mjs`: `createCommandRouter({actions, chatContext, ...})` →
`handleIncoming({plugin, channelId, channelConfig, msg}) → NormalizedMessage | null`.

- Flow: allowlist from channel config `allowedChatIds` (**empty ⇒ deny all inbound; fail
  closed**) → `parseCommand` (non-commands silently ignored) → dispatch → reply to the
  originating chat. Handler errors become error-severity replies, never crashes.
- Commands: global (`/start /help /whoami /projects /use /mute <30m|1h|2d> /unmute`);
  status (`/status /runs /last /cost` — live from the `runs` Map, history from the DB;
  `resolveRunId` wildcard-suffix matching `*a1b2` with disambiguation); control
  (`/pause /stop /resume`); **approvals** (new): `/approve` → gate `{decision:'continue'}`,
  `/retry` → `{decision:'another'}`, `/answer <n>…` → clarify answers with ordinal
  validation. No `/run` in v1.
- `actions` is an injected capability object built in `ui/server.mjs` by factoring the
  existing `/api/answer`, `/api/stop`, `/api/pause`, `/api/resume` route bodies into
  shared functions used by both the routes and the router — including `resolvePending`,
  so answering from chat clears the question card in every open browser tab.
- Security stance (stated in consent and README): a bot token, or membership in an
  allow-listed chat, **is control of worca-cc** (approve gates, stop/pause runs, read
  titles/costs). Deny-by-default allowlists; supervised workers see secrets but their
  output is redacted.

### 4.7 Teams ingress

- One dedicated router mounted **before** the loopback guard and `express.json`:
  `POST /api/ingress/teams/:plugin/:channelId/:token` with `express.raw({limit:'256kb'})`
  — the single, auditable exemption from `isLocalRequest` (the WS upgrade guard is
  untouched).
- Hardening: `:token` is a per-channel `ingressToken` secret compared with
  `timingSafeEqual`; mismatch or unknown plugin/channel → uniform 404. 60 req/min token
  bucket → 429. Worker not running → 503; 10 s forward timeout → 504. Bodies and
  Authorization headers are never logged host-side.
- Verification is **worker-side**: the host forwards `{method, path, headers, bodyB64}`;
  the Teams worker validates the Bot Framework JWT (JWKS from login.botframework.com,
  cached 24 h; `iss`, `aud`=appId, `exp`/`nbf` ±5 min, and `serviceUrl` claim ===
  `activity.serviceUrl`) and answers `webhook-result` (401 on failure). Platform-specific
  auth belongs in the plugin; the tokened URL keeps even a buggy worker unreachable
  anonymously. Replay bounded by JWT exp/nbf (no host replay cache in v1 — accepted risk).
- Operation: `cloudflared tunnel --url http://127.0.0.1:4317`; everything outside
  `/api/ingress` remains loopback-guarded even through the tunnel.

### 4.8 UI and API

- `GET/PUT /api/plugins/:name/config` generalized to channels (`{channelId, values}`;
  save triggers `reloadPlugin`); the `{set:true}` untouched-secret contract is unchanged.
- New `GET /api/chat/status` (worker states, last deliveries, drop counters) and
  `POST /api/chat/test {plugin, channelId}` (canned test message). Live `channel-status`
  broadcasts over the existing `/ws`.
- `plugins-view.mjs`: per-channel status badges, config form sections keyed
  `data-channel-id`, consent security lines.
- New `ui/public/chat-settings-view.mjs` (pure render + jsdom test): a third Settings
  card — event checkboxes (done / error / question / paused), per-channel toggles, Test
  button. No new view in the hash router.

### 4.9 The four plugins

Uniform layout per plugin: `worca-cc-plugin.json`, `README.md` (platform app-creation
walkthrough — a first-class deliverable), `channel/worker.mjs` (+ `client.mjs`,
`render.mjs`, platform extras), and `lib/` vendored **byte-identically** across all four
(`runtime.mjs` — frame runtime, per-chatId send FIFO, `splitText`, mock harness;
`segments.mjs`, `markdown.mjs`, `message.mjs` — ported wholesale from `master`). A repo
test (`chat-lib-drift`) enforces the vendored copies never drift. All platform I/O is
injectable (`fetchFn`, `WebSocketImpl`, `_sleep`) for offline tests. Node ≥ 22.13 gives
workers global `WebSocket` (undici) — **zero new dependencies**.

1. **telegram-chat** (reference; ~80% wholesale port of `master`'s telegram adapter):
   getUpdates long-poll (30 s, first poll timeout=0, abortable on shutdown), cursor via
   `state-delta` + `lastUpdateId` replay guard (at-least-once inbound documented), 429
   `retry_after`, stale-poll detection pushed as `status` frames, `getMe` at startup
   (identity + `/cmd@bot` filtering), HTML rendering + 4096-char `splitText`, skip
   `edited_message`. Config: `botToken` (secret), `notifyChatIds`, `allowedChatIds`.
2. **slack-chat**: Socket Mode (`apps.connections.open` with `xapp-` token → wss;
   **ack envelopes before processing**; `disconnect` frame → fresh-URL reopen), outbound
   `chat.postMessage` (`xoxb-` token, mrkdwn text), drop own/bot messages, optional
   `channelAllowlist` edge filter, Slack `200 {ok:false}` error mapping. validateConfig:
   `auth.test` + `apps.connections.open` with per-field errors.
3. **discord-chat**: ported REST send + new Gateway v10 client (`/gateway/bot` preflight,
   identify with intents GUILDS|GUILD_MESSAGES|MESSAGE_CONTENT = 33281, heartbeat/ACK
   tracking, resume via `resume_gateway_url`+seq, close-code map — 4004 → auth stop,
   4014 → plugin error naming the MESSAGE CONTENT INTENT portal toggle; no compression),
   2000-char split. README covers the privileged-intent setup and invite URL.
4. **teams-chat** (hardest; v1 cut = reply + proactive-to-seen-conversations only):
   worker-side JWT validation (`channel/jwt.mjs`, node:crypto only), AAD
   client-credentials token (`channel/token.mjs`, multi/single-tenant, cached to
   exp−300 s), conversation-reference store in plugin state (unknown chatId → actionable
   "message the bot once" error), outbound Activities to `serviceUrl` (AdaptiveCard 1.2,
   plain-text body), `activity.id` idempotency LRU (Bot Framework retries). Config:
   `appId`, `appPassword` (secret), `tenantType`, `tenantId`, `ingressToken` (secret),
   `notifyChatIds`.

Mock story (uniform, keyed on `hello.mock`): no network; instant ready/connected; one
canned `/status` inbound after 150 ms; `send` → logged + `ok:true` (`MOCK-FAIL` chatId →
canned rate-limit error); telegram emits cursor deltas; teams skips JWT only under mock.

## 5. Testing

- `node:test` throughout; old vitest assertions from `master` port mechanically
  (`describe/it` → nested `test`, `expect` → `assert/strict`, `vi.fn` → route-table
  `fakeFetch` per the `github-source-connector` precedent).
- Supervisor tested against fixture workers (echo / crash / oversize / slow): hello
  delivery, send RPC, state persistence, backoff restart, shutdown, redaction, mock hooks.
- Router tested with a fake `actions` object (deny-by-default, wildcard `resolveRunId`,
  approve/answer payload mapping); end-to-end under `WORCA_MOCK=1` via
  `injectInboundMessage` → assert `mockSentMessages()`.
- Ingress: non-loopback accepted on `/api/ingress` only; wrong token 404; oversize 413;
  worker-down 503; 401 pass-through from `webhook-result`.
- Platform plugins: ported adapter tests (telegram), scripted `FakeWebSocket` state
  machines (slack ack/reconnect, discord identify/heartbeat-loss/resume/close-codes),
  self-minted RS256 JWTs + fake JWKS accept/reject matrix (teams).
- UI: jsdom render/collect round-trips for the new/extended pure-render modules.

## 6. Implementation order

Feature branch `feat/chat-connectivity`; small PRs to `dev`, tests green locally before
each (no CI):

1. API set + `chatChannels` manifest + consent/doctor-static.
2. Channel protocol + worker child + supervisor + redact.
3. Pure ports: parser, chat-context, allowlist, rate-limiter, renderers.
4. Inbound: command-router + server action factoring + wiring + `worca plugin channel` CLI.
5. Outbound: notifier + chat prefs + `/api/chat/status|test`.
6. Teams ingress router.
7. UI: plugins-view channels + chat-settings card.
8. `telegram-chat` (+ vendored lib canon + drift test).
9. `slack-chat`.  10. `discord-chat`.  11. `teams-chat`.
12. (opt) Fix `_reportToSource` success-only gap so error/stopped runs report to task
   sources too.

## 7. Decision log

- **Hybrid ingress over unified webhooks** — minimizes public surface; only Teams forces
  an ingress route.
- **Persistent workers over host-owned polling loops** — Socket Mode/Gateway cannot be
  driven by ephemeral 30 s ops; one seam fits all four platforms.
- **One plugin per platform** (user choice) — independent install/enable/consent;
  shared helpers vendored with a drift test rather than a shared package.
- **`chatChannels` not `channels`** — `src/core/channels.mjs` already owns that name for
  pipeline data channels.
- **Host API set `[1,2]` over a hard bump** — existing `">=1 <2"` plugins keep installing.
- **Worker-side Teams JWT validation** — platform auth is platform knowledge; host stays
  dependency-free; the capability-URL token keeps the route unreachable anonymously
  regardless.
- **Command brains host-side** — ported once, not vendored 4×; workers stay transports.
- **No `/run` from chat in v1** — blast-radius control.

## 8. Out of scope / future

- Per-run notification picker (Guardrails-picker pattern) and per-workflow defaults.
- Slack Block Kit, Teams rich markdown / `createConversation`, Discord DMs and slash
  commands, Telegram chat-ID auto-detect helper.
- Inbound idempotency across restarts beyond `lastUpdateId` (Telegram at-least-once).
- CLI-run notification parity (notifier is core; wire it into `attachAndDrive` later).
- Host-side replay cache for Teams ingress.
- Message-log UI view (doctor + run log cover v1).
