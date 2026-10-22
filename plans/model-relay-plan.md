# E2B Model Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No model credential or broker token ever enters a remote (E2B) sandbox; Claude Code
there reaches its model through a relay that worca drives over the sandbox command's
stdin/stdout, and worca adds the credential on its own side.

**Architecture:** A small Node program in the sandbox (`sandbox-relay.mjs`) listens on
`127.0.0.1` and frames HTTP requests as JSON lines on its stdout. Worca's `ModelRelay`
(one per `RemoteExecEnv`) reads them, resolves the spawn's route (`remoteModelRoute`, the
upstream + credential the same spawn would use locally), enforces the §5 rules, forwards,
and streams the scrubbed reply back over the command's stdin. The broker path stays in
`runViaBroker`; remote spawns now go through it too.

**Tech Stack:** Node ≥ 22.19 ESM, `node:test`, `e2b` SDK 2.56.0 (`commands.run({ stdin: true })`,
`CommandHandle.sendStdin`), the loopback fake SDK (`src/core/exec-env/e2b-fake.mjs`).

**Spec:** [`plans/model-relay-design.md`](model-relay-design.md)

**Base:** branch `feat/e2b-execution-environments` (PR #826). Branch from it
(`feat/e2b-model-relay`); deliver as one commit on `dev` once #826 merges (squash the task
commits then).

## Global Constraints

- No fallback that puts a model credential in the sandbox: a relay failure fails the call.
- The sandbox env of a model spawn never contains `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`,
  a real `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_CUSTOM_HEADERS`, or a `wbt_` token.
- Allowed requests: `POST /v1/messages` and `POST /v1/messages/count_tokens`, optional query
  string. `HEAD /api/hello` → 200 answered by worca, never forwarded. Anything else → 403.
- Request body cap: `MAX_REQUEST_BYTES` (32 MiB) from `src/broker/service.mjs` → 413.
- Header allowlists: `upstreamRequestHeaders` / `agentResponseHeaders` from
  `src/broker/service.mjs`. OAuth: `Authorization: Bearer` + `anthropic-beta` =
  `mergeBetas(incoming, OAUTH_BETA)` (`'oauth-2025-04-20'`).
- Relay refusals are JSON errors whose message starts `worca-relay: `. Broker 403
  `worca-broker: …` bodies pass through unchanged (scrubbed).
- Upstream: the route's origin + base path, request path appended as a string; `redirect: 'manual'`.
- The server credential (`modelCredential(serverEnv)`) only ever goes to `https://api.anthropic.com`.
- Refusal copy (remote spawn): Bedrock/Vertex/Foundry →
  `This model signs its own requests (CLAUDE_CODE_USE_<X>), which an <label> cannot relay. Pick Local for this model.`;
  other secret-named key → `This model's setting <KEY> holds a secret, which never enters an <label>. Pick Local for this model.`
- Scripts (`credential: false` today) get no route and no credential.

## Review Focus

1. A credential split across two upstream chunks must still be scrubbed (carry buffer) — Task 3.
2. A multi-byte UTF-8 character split across chunks must arrive intact (scrub on bytes, not per-chunk strings) — Task 3.
3. Two concurrent requests (sub-agents) on one relay must not mix bodies — Task 3.
4. A long streamed reply (hundreds of small SSE chunks) arrives byte-identical and in order — Task 3.
5. After a reconnect (worca restart), a fresh relay serves new routes; the old process is gone — Task 4.

---

### Task 1: Backend contract — stdin for background commands

**Files:**
- Modify: `src/core/exec-env/backend.mjs` (RunOptions, CommandHandle typedefs; the `run` doc line "stdin is never passed")
- Modify: `src/core/exec-env/backends/e2b.mjs` (`client.run`: pass `stdin: true` through)
- Modify: `src/core/exec-env/e2b-fake.mjs` (`_run`: `stdin` option, `handle.sendStdin`)
- Test: `test/exec-env-fake.test.mjs`

**Interfaces:**
- Produces: `RunOptions.stdin?: boolean` (background only); `CommandHandle.sendStdin(data: string): Promise<void>`.

- [ ] **Step 1: Write the failing test** `test('a background command with stdin: true reads what sendStdin writes')`: fake sandbox, `client.run(box, 'head -n 2', { background: true, stdin: true, onStdout })`, `await h.sendStdin('a\nb\n')`, `await h.wait()`; assert collected stdout `=== 'a\nb\n'`.
- [ ] **Step 2: Run** `node --test test/exec-env-fake.test.mjs` — Expected: FAIL (`sendStdin is not a function`).
- [ ] **Step 3: Implement.** Fake: with `stdin: true` the handle gets `sendStdin(d)`, which writes and resolves on the write callback. E2B client: add `...(stdin ? { stdin: true } : {})`; the SDK handle already has `sendStdin`. Update the typedef comment: stdin is passed only with `background: true` for long-lived helpers; agent stdin still goes through a scratch file.
- [ ] **Step 4: Run** the test file — Expected: PASS.
- [ ] **Step 5: Commit** `feat(exec-env): background commands can keep stdin open`.

### Task 2: Route builder

**Files:**
- Create: `src/core/exec-env/relay-route.mjs`
- Test: `test/exec-env-relay-route.test.mjs`

**Interfaces:**
- Consumes: `modelCredential` (`policy.mjs`), `OAUTH_BETA`, `mergeBetas` (`src/broker/service.mjs`).
- Produces:
  `remoteModelRoute({ spawnEnv, modelEnv, serverEnv, label }) → { upstream: string, authHeaders(incoming: object): object, extraHeaders: Record<string,string>, secrets: string[] }`;
  throws `Error` with `errorClass = 'config'` and the Global Constraints copy on a refusal.

Rules (spec §4): base = `spawnEnv.ANTHROPIC_BASE_URL` trimmed, default `https://api.anthropic.com`;
credential precedence: `modelEnv.ANTHROPIC_AUTH_TOKEN` (Bearer) → `modelEnv.ANTHROPIC_API_KEY`
(`x-api-key`) → server credential only when base origin is `https://api.anthropic.com`
(OAuth: Bearer + merged beta; API key: `x-api-key`) → none for any other origin. No base, no
entry key, no server credential → refuse ("no model credential in the worca server's environment").
`ANTHROPIC_CUSTOM_HEADERS` (from `spawnEnv`, `Name: value` per line) → `extraHeaders`; a name of
`authorization`, `x-api-key`, `host` or `proxy-*` → refuse. Refuse if any of
`CLAUDE_CODE_USE_BEDROCK|VERTEX|FOUNDRY` is truthy in `spawnEnv`. Refuse any other key in
`modelEnv` matching `/_(TOKEN|SECRET|KEY)$/` except `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`.
`secrets` = every credential value and custom-header value used.

- [ ] **Step 1: Write the failing tests**, one per row/edge:
  - `no broker, OAuth server`: `{ spawnEnv: {}, modelEnv: null, serverEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' } }` → `upstream === 'https://api.anthropic.com'`, `authHeaders({ 'anthropic-beta': 'a' })` deep-equals `{ authorization: 'Bearer sk-ant-oat01-x', 'anthropic-beta': 'a,oauth-2025-04-20' }`, `secrets` includes the token.
  - `no broker, API key server` → `{ 'x-api-key': 'k' }`; OAuth wins when both are set.
  - `gateway with its own key`: `modelEnv/spawnEnv ANTHROPIC_BASE_URL 'https://gw.example/v1'`, `ANTHROPIC_AUTH_TOKEN 'g'`, server OAuth set → upstream `'https://gw.example/v1'`, `authorization: 'Bearer g'`, server token NOT in `secrets` nor headers.
  - `keyless third-party gateway never gets the server credential` → `authHeaders({})` deep-equals `{}`.
  - `broker slot`: base `http://broker:8080/p/anthropic`, `ANTHROPIC_AUTH_TOKEN 'wbt_abc'` → Bearer `wbt_abc`, upstream as given.
  - `bridge`: base `http://127.0.0.1:4317/m/openai-gpt`, `ANTHROPIC_AUTH_TOKEN 'bridge-secret'` → allowed (no loopback refusal), Bearer.
  - `custom headers carried` and `custom header naming authorization is refused`.
  - `Bedrock is refused` (copy matches `/CLAUDE_CODE_USE_BEDROCK/`, `/Pick Local/`).
  - `another secret-named key is refused` (`MY_GATEWAY_TOKEN` in `modelEnv`).
  - `no credential anywhere is refused`.
- [ ] **Step 2: Run** `node --test test/exec-env-relay-route.test.mjs` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `remoteModelRoute` in `src/core/exec-env/relay-route.mjs`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(exec-env): route a remote spawn's model calls without handing over the credential`.

### Task 3: The relay (sandbox program + worca side)

**Files:**
- Create: `src/core/exec-env/sandbox-relay.mjs` (runs in the sandbox; no imports beyond `node:*`)
- Create: `src/core/exec-env/model-relay.mjs`
- Test: `test/exec-env-model-relay.test.mjs`

**Interfaces:**
- Consumes: `CommandHandle.sendStdin` (Task 1); route objects (Task 2);
  `upstreamRequestHeaders`, `agentResponseHeaders`, `MAX_REQUEST_BYTES` (`src/broker/service.mjs`); `scrubText` / `KEY_SHAPES` (`src/broker/scrub.mjs`).
- Produces:
  - `class ModelRelay { constructor({ log, fetchImpl = globalThis.fetch, maxConcurrentPerRoute = 16 }); async start({ client, box, scriptPath: string }): Promise<void>; get alive(): boolean; addRoute(route): { id: string, baseUrl: string }; removeRoute(id: string): void; async stop(): Promise<void> }`
  - `baseUrl` is `http://127.0.0.1:<port>/r/<id>`; `id` is 32 random bytes base64url.
  - Frame protocol (one JSON object per line): sandbox→worca `{t:'ready', port}`, `{t:'req', id, method, path, headers, b64}`; worca→sandbox `{t:'head', id, status, headers}`, `{t:'data', id, b64}`, `{t:'end', id}`. `id` here is the relay's request counter, not the route id.

Behaviour: `start` uploads nothing itself (caller wrote `scriptPath`), runs
`node <scriptPath>` with `{ background: true, stdin: true, onStdout }`, resolves on `ready`
(reject after 15 s). The sandbox program listens on `127.0.0.1` port 0. For each `req`:
route id = first path segment after `/r/` (also accepted from `authorization: Bearer <id>`);
then the Global Constraints rules; rejected → `{status, JSON error}`. Forward with
`fetchImpl(upstream + rest, { method, headers: { ...upstreamRequestHeaders(h), ...route.extraHeaders, ...route.authHeaders(h) }, body, redirect: 'manual' })`;
3xx from upstream → 502 `worca-relay: the upstream redirected`. Stream the body through a
byte-level scrubber that keeps a carry of `maxSecretLength - 1` bytes between chunks and
replaces each `route.secrets` value and `wbt_` / known key shapes. Errors are logged with path
and status only.

- [ ] **Step 1: Write the failing tests.** Harness: a local stub upstream (`http.createServer`) recording requests; the relay driven through the fake backend's `client.run` (Task 1) so `sandbox-relay.mjs` runs as a real child; requests made with `fetch(baseUrl + '/v1/messages', …)` from the test. Tests:
  - `forwards a message call with the route credential and without the sandbox token` — stub sees `authorization: Bearer real`, never the route id.
  - `unknown route → 403 worca-relay` and `removed route → 403`.
  - `refuses other paths and methods` (`GET /v1/models`, `POST /v1/files`, `POST /r/<id>/../internal/tokens`) → 403, stub sees nothing.
  - `answers HEAD /api/hello itself` → 200, stub sees nothing.
  - `drops headers outside the allowlist` (`cookie`, `x-forwarded-for` not at stub).
  - `body over 32 MiB → 413`.
  - `upstream redirect → 502, not followed`.
  - `scrubs the credential when the upstream echoes it, also split across two chunks` (Review Focus 1).
  - `keeps a multi-byte character split across chunks intact` (Review Focus 2).
  - `two concurrent requests get their own bodies` (Review Focus 3).
  - `streams 300 SSE chunks byte-identical and in order` (Review Focus 4).
  - `a broker 403 worca-broker body reaches the caller unchanged`.
- [ ] **Step 2: Run** `node --test test/exec-env-model-relay.test.mjs` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `sandbox-relay.mjs` (≈ the spike's `relay.mjs` plus port 0; it frames every request, including `HEAD /api/hello`, and decides nothing — worca answers the probe with 200 itself) and `model-relay.mjs`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(exec-env): model relay between the sandbox and worca`.

### Task 4: RemoteExecEnv runs the relay; envFor stops passing credentials

**Files:**
- Modify: `src/core/exec-env/remote-env.mjs` (constructor, `start`, `reconnect`, `beforeSpawn`, `envFor`, `close`)
- Modify: `src/core/exec-env/policy.mjs` (`sandboxEnv`: no `MODEL_CREDENTIAL_KEYS` exception; also drop `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`)
- Modify: `src/core/graph/script-runner.mjs:582` (drop `credential: false`)
- Test: `test/exec-env-config.test.mjs`, `test/exec-env-remote-child.test.mjs`, `test/exec-env-pipeline.test.mjs`

**Interfaces:**
- Consumes: `ModelRelay` (Task 3), `remoteModelRoute` (Task 2).
- Produces:
  - `RemoteExecEnv.relay: ModelRelay`
  - `RemoteExecEnv.openModelRoute({ spawnEnv, modelEnv }): { id: string, env: { ANTHROPIC_BASE_URL: string, ANTHROPIC_AUTH_TOKEN: string }, secrets: string[] }` (throws Task 2's refusals)
  - `RemoteExecEnv.closeModelRoute(id: string): void`
  - `envFor(env, { keep = [], route = null })` — never adds or keeps a model credential, base URL or custom headers; merges `route.env` when given.

Behaviour: relay script written with `client.writeFile` to `${work}/model-relay.mjs`; started at
the end of `start()` and of `reconnect()` (before the reconnect `pkill -f model-relay.mjs` so the
dead-channel process is gone); `beforeSpawn` restarts it when `!relay.alive` (log
`model relay restarted`); `close()` stops it. Remove `modelCredential` from `envFor` and the
loopback refusal.

- [ ] **Step 1: Write the failing tests:**
  - `exec-env-config`: replace the credential-passthrough assertions: `sandboxEnv({ ANTHROPIC_API_KEY:'k', CLAUDE_CODE_OAUTH_TOKEN:'o', ANTHROPIC_AUTH_TOKEN:'g', ANTHROPIC_BASE_URL:'https://x', ANTHROPIC_CUSTOM_HEADERS:'A: b' })` deep-equals `{}`.
  - `exec-env-remote-child` (replaces line ~153 `seen.envs.CLAUDE_CODE_OAUTH_TOKEN === 'oat'`): with server env `{ CLAUDE_CODE_OAUTH_TOKEN: 'oat' }`, a spawn via `openModelRoute` + `envFor` → sandbox envs have no `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL` matches `^http://127\.0\.0\.1:\d+/r/`, and `ANTHROPIC_AUTH_TOKEN` equals the route id.
  - `exec-env-pipeline`: `a resumed run gets a fresh relay` (Review Focus 5) — reconnect, open a route, a request through it reaches a stub upstream; the fake's command log shows the old relay killed.
  - `scripts get no model route` — script env has neither relay var.
- [ ] **Step 2: Run** `node --test test/exec-env-config.test.mjs test/exec-env-remote-child.test.mjs test/exec-env-pipeline.test.mjs` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** the three files — Expected: PASS.
- [ ] **Step 5: Commit** `feat(exec-env): sandboxes reach their model through the relay, never with a credential`.

### Task 5: Claude spawns and the broker use the relay

**Files:**
- Modify: `src/core/engines/claude.mjs` (`runClaudeProcess` remote branch ~l.618-630; `runViaBroker` `isolated`; `runClaudeAdapter`)
- Test: `test/claude-runner-broker.test.mjs`, `test/exec-env-pipeline.test.mjs`

**Interfaces:**
- Consumes: `openModelRoute` / `closeModelRoute` / `envFor({ route })` (Task 4); `currentOwner`, `normalizeBillTo` (`src/core/billing.mjs`).

Behaviour: remote branch: `const r = execEnv.openModelRoute({ spawnEnv, modelEnv: safeModelEnv })`
(a refusal rejects the spawn like today's `envFor` error), `childEnv = execEnv.envFor(spawnEnv, { keep: [...model-env keys that are not credentials/base URL/custom headers, ...execEnv.mcpEnvRefs], route: r })`,
`execEnv.closeModelRoute(r.id)` in the supervise `cleanup`. Add `r`'s secrets to the spawn's
redactor values. `runClaudeAdapter`: drop the remote special case (`brokerEnabled() ? runViaBroker : runClaudeProcess` for all).
`runViaBroker`: `isolated = opts.execEnv?.remote ? owner === billTo : (existing expression)`.

- [ ] **Step 1: Write the failing tests:**
  - `claude-runner-broker`: `a remote spawn goes through the broker` — fake broker (existing harness), fake exec env: a token is minted, the route's upstream is the broker slot URL, the sandbox env holds no `wbt_`; the token is revoked after exit.
  - `claude-runner-broker`: `remote subscription isolation follows the run owner` — owner `a@x`, billTo `a@x` → mint called with `isolated: true`; billTo `b@x` → `isolated: false`.
  - `exec-env-pipeline`: `a remote run on a bridged model is no longer refused` (previously "a local endpoint … cannot reach").
  - `exec-env-pipeline`: `a Bedrock model is refused for a remote run` with the Global Constraints copy.
- [ ] **Step 2: Run** `node --test test/claude-runner-broker.test.mjs test/exec-env-pipeline.test.mjs` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** per Behaviour.
- [ ] **Step 4: Run** both files, then `npm run test:related` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(exec-env): remote Claude spawns use the relay and the credential broker`.

### Task 6: Preflight and docs

**Files:**
- Modify: `src/core/exec-env/e2b-config.mjs` (`e2bPreflight`)
- Modify: `docs/e2b.md`, `plans/e2b-execution-design.md` §11, `docs/credential-broker.md` (support matrix + Limits)
- Test: `test/exec-env-config.test.mjs`

- [ ] **Step 1: Write the failing tests:** `pre({ brokerOn: true, env: { E2B_API_KEY: 'k', E2B_API_URL: 'http://localhost:3000' } })` → no error about a credential, and no warning matching `/does not reach E2B sandboxes/`; `pre({ env: { E2B_API_KEY: 'k', E2B_API_URL: 'http://localhost:3000' } })` (broker off) still errors with `/Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY/` and the text no longer says "sign Claude Code in" inside the sandbox (new: "…set in the worca server's environment; it stays on the server and signs the sandbox's model calls.").
- [ ] **Step 2: Run** `node --test test/exec-env-config.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** the preflight change; update the three docs (keys never enter the sandbox; the relay; broker works with E2B; bridged models work; Bedrock/Vertex/Foundry refused).
- [ ] **Step 4: Run** `node --test test/exec-env-config.test.mjs` and `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `docs(exec-env): model credentials stay on the worca server`.

### Task 7: Live check on the local E2B

No code. Manual proof against the Lima VM (`~/.config/worca-e2b/start-ui-e2b.sh`, broker off,
OAuth server credential).

- [ ] **Step 1:** Start the UI from this branch; run a small pipeline with "Runs in: E2B sandbox".
- [ ] **Step 2:** While a step runs, `env | grep -iE "oauth|api_key|sk-ant|wbt_"` inside the sandbox (via `worca exec-env` debugging or the E2B SDK) — Expected: no output; `ANTHROPIC_BASE_URL` is the relay.
- [ ] **Step 3:** The run completes, cost is booked, and the run log shows no `worca-relay:` refusal.
- [ ] **Step 4:** Record times next to the spike's in the PR description.
