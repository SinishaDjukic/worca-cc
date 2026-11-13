# Model relay: no model credential inside a remote sandbox

Status: design, approved direction (2026-10-21). Builds on the E2B execution environment
(PR #826, `feat/e2b-execution-environments`, refs #806). Nothing here is on `dev` yet.

## 1. Why

A run in an E2B sandbox signs Claude Code in with the worca server's real model credential.
`policy.mjs modelCredential()` puts `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) into
the sandbox's environment (`remote-env.mjs envFor`), and a model entry with its own gateway key
sends that key in too. The sandbox has sudo and open internet, and it runs code the run did
not write: the repository, its dependencies' install scripts, whatever the agent fetches. Any
of it can read the key and send it anywhere. A prompt injection needs one `curl`.

What leaks is the worst kind of credential: long-lived (an API key until rotated, a
`setup-token` OAuth token for about a year), shared by every sandbox run of that worca, often a
person's own Claude subscription (no spend cap), and usable from anywhere, unseen by worca.

The credential broker (`docs/credential-broker.md`) exists to stop exactly this for local
container runs (guarantee K1: no model credential anywhere an agent can reach). It does not
reach sandboxes: its URL is on a private network the sandbox can't reach, so
`runClaudeAdapter` skips it for remote spawns. Worse, E2B and the broker can't be combined at
all: the E2B preflight demands a credential in worca's env (`e2b-config.mjs`), and the broker's
boot guard refuses to start worca while one is there (`broker-guard.mjs`).

## 2. Goals, non-goals, anti-goals

**Goals**

- No model credential and no broker token ever enters a remote sandbox, in every deployment:
  native without the broker, container without it, broker single mode, broker multi mode
  (Compose, Kubernetes, Railway), and against every E2B (Cloud, self-hosted, the local VM).
- E2B runs work with the broker on, with per-person billing, budgets and the subscription rules
  the broker already applies.
- Bridged models (OpenAI, OpenRouter, Copilot, a gateway) and keyless local models work in a
  sandbox. Today they are refused ("a local endpoint, which an E2B sandbox cannot reach").
- No visible change for the user in a normal run: same pages, logs, cost booking, speed.

**Non-goals**

- Egress control for sandboxes (an allowlist or no internet). Sandboxes keep open internet:
  installs, web fetches and git keep working. Code can still leave a sandbox through a prompt
  injection; that is accepted for now. A later, separate opt-in per project could add it
  (E2B `network.allowOut`/`denyOut`), defaulting to open.
- Other engines in a sandbox (remote runs are Claude-only today).
- Model calls made by programs other than Claude Code inside the sandbox (scripts already get
  no credential; `graphify update` calls no model, see §8).
- Protecting local, non-sandbox runs on a native install (unchanged: the agent runs as the user).

**Anti-goals** (would make this a failure even if it works)

- **A fallback that puts the key in the sandbox.** If the relay can't carry a call, the call
  fails. There is no setting, flag or error path that restores today's behaviour.
- **The relay as a way into worca's network.** A sandbox must not be able to use it to reach
  anything but the one upstream worca chose for that spawn: not the broker's `/internal` API,
  not worca's own API, not another service on the private network.
- A credential or token in anything the relay returns to the sandbox (bodies, headers, errors).

## 3. How it works

```
 sandbox                                   worca server                         upstream
 ───────                                   ────────────                         ────────
 claude ── HTTP ──► relay (127.0.0.1:P)                                         
   ANTHROPIC_BASE_URL=http://127.0.0.1:P/r/<route>
   ANTHROPIC_AUTH_TOKEN=<route>  (no credential)
                    relay ── stdout frames ──► model relay (host side)
                                                 route → upstream URL + auth
                                                 path/header allowlist, size cap
                                                 adds the credential ──────────► api.anthropic.com
                                                                                 or <broker>/p/<slot> (+ wbt_)
                                                                                 or worca's bridge (loopback)
                                                                                 or a gateway (+ its key)
                    relay ◄── stdin frames ── streamed reply (credential scrubbed)
```

- **One relay process per sandbox.** A small Node program (`node` is in `worca-agent` and every
  project template built from it), uploaded and started by worca with
  `commands.run(…, { background: true, stdin: true })`. It listens on `127.0.0.1` only, holds
  no credential, and turns each HTTP request into JSON-line frames on its stdout; worca answers
  with frames on its stdin (`sendStdin`). Worca opens this channel, so it works whatever the
  network between worca and E2B: nothing in the sandbox ever connects to worca or the broker.
- **One route per spawn.** Before a remote `claude` spawn, worca computes what a *local* spawn
  would talk to (§4), registers it as a route under a fresh random id, and gives the sandbox
  only `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/r/<id>` and `ANTHROPIC_AUTH_TOKEN=<id>`. The
  route is removed when the spawn ends, like a broker token. The id is worthless outside the
  relay channel, which exists only while the run's sandbox lives.
- **Worca's side does all the deciding.** The host side looks up the route, checks method,
  path, headers and size, adds the route's credential, forwards to the route's fixed upstream,
  and streams the reply back with an allowlisted set of headers and the credential scrubbed.

### Measured (spike, 2026-10-21, local Lima E2B, `worca-agent`, Haiku, subscription OAuth)

| Case | Token in sandbox (today) | Through the relay |
|---|---|---|
| Small prompt (85 KB request) | 2.7 s, 2.9 s | 2.7 s, 2.1 s |
| Large prompt (443 KB request) | 5.9 s, 6.4 s | 5.5 s, 5.4 s |
| Agent with a Bash tool call | 4.2 s | 4.1 s |

No measurable cost. The 443 KB request crossed as one frame. Claude Code called only
`POST /v1/messages?beta=true`, plus a `HEAD /api/hello` connectivity probe (refused with 403
in the spike, harmless). A relay spawn had no credential-looking variable in its environment.
Not measured: E2B Cloud with a distant worca (Railway), token-by-token streaming of long
replies, several sandboxes at once, a worca restart mid-step.

## 4. Where a route points (one rule: what the local spawn would use)

The route is the `ANTHROPIC_BASE_URL` and credential the same spawn would get if it ran
locally, so every existing routing decision (broker slots, plugin slots, the bridge, gateway
entries) is reused, not re-implemented:

| Deployment / model | Upstream of the route | Credential worca adds |
|---|---|---|
| No broker, Claude model, server signed in with `CLAUDE_CODE_OAUTH_TOKEN` | `https://api.anthropic.com` | `Authorization: Bearer <token>` + `anthropic-beta: oauth-2025-04-20` merged with the CLI's betas |
| No broker, Claude model, `ANTHROPIC_API_KEY` | `https://api.anthropic.com` | `x-api-key` |
| No broker, model entry with its own `ANTHROPIC_BASE_URL` + key (a gateway) | the entry's base URL | the entry's key, in the header its variable implies (`ANTHROPIC_AUTH_TOKEN` → Bearer, `ANTHROPIC_API_KEY` → `x-api-key`) |
| Broker on, any model | the broker slot URL `runViaBroker` computes (`<broker>/p/<slot>[prefix]`) | the spawn's `wbt_` token, minted and revoked by `runViaBroker` as for a local spawn |
| Bridged model (broker on or off) | worca's loopback bridge URL (`bridgeBaseUrl`) | the bridge secret, or with the broker on the spawn's `wbt_` (as `runViaBroker` already does) |
| Keyless local model behind the bridge | the bridge URL | the bridge secret |

Edge cases (*my calls; see §10*):

- **Never the server's credential to a third party.** No broker, an entry with its own
  `ANTHROPIC_BASE_URL` that is not `api.anthropic.com` and no key of its own (a keyless or
  network-trusted gateway): the route adds no credential at all. Today `envFor` sends the
  server's credential there, against its own comment; that stops. The run log names the
  origin once, so a 401 from that gateway is explainable.
- **A gateway in the worca server's own env** (`ANTHROPIC_BASE_URL` there, none in the model
  entry, the spawn's URL the same): signed with the server's `ANTHROPIC_AUTH_TOKEN` (Bearer),
  else its `ANTHROPIC_API_KEY` (`x-api-key`), as a local spawn would inherit them; neither set
  refuses the spawn. Never `CLAUDE_CODE_OAUTH_TOKEN` to a third party.
- **A base URL with a query string or fragment** is refused: the relay appends the call's path.
- **`ANTHROPIC_CUSTOM_HEADERS`** in a model entry: carried by the route and added on worca's
  side after the allowlist (it may hold a secret, so it never enters the sandbox). Its header
  names may not override `authorization`, `x-api-key` or `host`.
- **Any other secret-named key** in a model entry's env (`*_TOKEN`, `*_KEY`, `*_SECRET`, a
  resolved plugin `{secret}` in an unusual variable): the remote spawn is refused with the
  entry's name and the variable, before the sandbox starts work. Fail closed rather than leak
  or silently drop.
- **Cloud transports** (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`,
  `CLAUDE_CODE_USE_FOUNDRY`): the CLI signs those requests itself and ignores the base URL, so
  the relay can't carry them. A remote spawn on such a model is refused ("Pick Local for this
  model"). E2B isn't released, so nobody loses a working setup.
- **Which upstreams a route may use.** The upstream always comes from trusted configuration
  (the server env, the model catalog, team policy, enabled plugins, the broker), never from
  anything the sandbox sends. Any configured URL is allowed, including a private-network
  gateway an operator set up; the sandbox can only append the fixed Messages API paths of §5.
  The anti-goal is about destinations the sandbox could choose, and it can choose none.

Consequences:

- `runClaudeAdapter` stops special-casing remote spawns: with the broker on, a remote spawn goes
  through `runViaBroker` like a local one (token minting, plugin slots, billing, revocation),
  and the remote branch of `runClaudeProcess` swaps the resulting base URL and token for a
  route. Without the broker, the remote branch builds the route from the server credential.
- `envFor`'s loopback refusal for model endpoints goes away (the relay reaches the bridge).
- `envFor` never adds `modelCredential()`, and `sandboxEnv` no longer lets
  `MODEL_CREDENTIAL_KEYS` through for spawns; a model entry's own key stays on worca's side.
- The OAuth header logic and the request/response header allowlists already exist in
  `src/broker/service.mjs` (`OAUTH_BETA`, `mergeBetas`, `credentialKind`,
  `REQUEST_HEADER_ALLOW`, `RESPONSE_HEADER_ALLOW`, the scrub). Share them, don't copy them.

## 5. The host side's rules (the security core)

For every request frame:

1. **Route.** Unknown or removed route id: 403 `worca-relay: …`.
2. **Method and path.** Only the Anthropic Messages API the CLI speaks: `POST /v1/messages`
   and `POST /v1/messages/count_tokens`, each with an optional query string. Everything else:
   403. `HEAD /api/hello` (the CLI's connectivity probe) is answered by worca with 200 and
   never forwarded. Refused paths are logged (metadata only) so a CLI update that needs a new
   path shows up in the run log rather than as a mystery.
3. **Upstream.** Always the route's fixed origin and base path; the request path is appended,
   never parsed as a URL. No redirects followed.
4. **Headers.** Request: the broker's allowlist only; the incoming `authorization`/`x-api-key`
   (the route id) is dropped, the route's credential added. Response: the broker's allowlist.
5. **Size.** A request body cap (a sensible default well above the 443 KB measured, e.g.
   32 MB) and a per-route concurrency cap; past them, 413/429 from worca.
6. **Scrub.** The credential (and any `wbt_` token) is removed from every byte sent back,
   including upstream error bodies, as the broker does (K4).
7. **Errors keep their meaning.** A broker 403 `worca-broker: …` reaches the CLI unchanged, so
   the existing pause handling (*Needs credential*, *Budget reached*) works for remote runs.

## 6. Lifecycle

- **Start.** The relay starts with the sandbox (after create or connect, before the first
  spawn); `beforeSpawn` checks it is alive and restarts it if not.
- **Resume / reconnect** after a worca restart: the old relay's stdin channel is gone; worca
  kills it and starts a fresh one. Routes are in worca's memory only, so a restart drops them;
  that is fine because a worca restart already ends the running step today.
- **Relay dies mid-step.** The CLI's calls fail, the step fails as any API failure does, and
  the run log says the relay stopped. No fallback (anti-goal).
- **End.** Routes go with their spawns; the relay dies with the sandbox.

## 7. Preflight and messages

- E2B preflight: with the broker on, no credential is required in worca's env, and the warning
  "The credential broker does not reach E2B sandboxes…" goes. Without the broker, the server
  credential is still required, but it now stays in worca.
- Broker boot guard: unchanged. Worca still holds no key with the broker on.
- Subscription rule in multi mode, mirroring local runs exactly: a local resumed run keeps its
  starter's agent user, so the resumer's subscription isn't used. For a remote spawn, worca
  needs no new parameter: `runViaBroker` already knows the run's owner (`currentOwner()`), and a
  remote spawn counts as isolated only when the person paying (`billTo`) is that owner. Then the sandbox is
  that person's run alone and holds no token. Resume, retry or an answer by a teammate bills
  the teammate, isolated false, so their subscription is refused with the broker's usual "use
  an API key" message. The broker API is unchanged: it only sees `isolated`. *My call; see §10.*

## 8. What else changes, and what doesn't

- **graphify:** `graphify update` (what the sandbox runs) is code-only; its help says "no LLM
  needed". It gets no route.
- **Scripts:** still get no credential and no route.
- **A `claude` the agent starts itself** in the sandbox inherits the route variables and works
  through the relay, billed like its parent.
- **Backend contract** (`backend.mjs`): the client's `run` must support `stdin: true` and
  `sendStdin` on the handle. E2B has it; the loopback test backend and `e2b-fake.mjs` need it,
  so the whole relay is testable without a real E2B.
- **Docs:** `docs/e2b.md` (keys section), `plans/e2b-execution-design.md` §11 ("Credential
  broker skipped" and "credential precedence" lines), `docs/credential-broker.md` (support
  matrix and Limits gain the E2B case). The team handbook (a published page outside the repo,
  claude.ai artifact HGePqadaNjZYd14nRArbfZ, "Limits" / `#keys`) is updated after the PR
  merges, not as part of it.

## 9. Remaining risks after this change

| Risk | Status |
|---|---|
| An agent spends credits through the relay while its run lives | Accepted, same as local. Broker budgets cap it; without the broker, nothing caps it beyond the run's life. |
| Code and data leave a sandbox over open internet | Accepted (non-goal). Future opt-in egress control. |
| With E2B Cloud the code sits with a third party | Unchanged; self-hosted E2B avoids it. |
| Secrets a run is deliberately given (an MCP set's registry secrets) | Unchanged; worca already warns. |
| A bug in the host side's rules turns the relay into a proxy | The main thing to review and test (§5, §11). |

## 10. Calls made in this design (check these)

- Repository convention: this plan lives in `plans/` (beside `e2b-execution-design.md`) rather
  than `docs/superpowers/specs/`.
- Delivery: one PR stacked on #826's branch, or on `dev` once #826 merges, as one commit.
- Transport: the command's stdin/stdout (measured), not an E2B public port with
  `getHost` (would add a public URL and its access token) and not making the broker public
  (breaks K3).
- Frames: JSON lines with base64 bodies, as in the spike. Coalescing small stream chunks per
  `sendStdin` is left to the builder if measurement shows it matters.
- Body cap 32 MB; path allowlist as in §5; `HEAD /api/hello` answered locally.
- Subscription isolation for remote spawns as in §7 (`billTo === currentOwner()`).
- §4 edge cases: no server credential to a third-party URL; custom headers added host-side;
  other secret-named model keys and cloud transports refused for remote spawns; any upstream
  from trusted configuration allowed.
- One relay per sandbox, routes per spawn, all routes in memory.

## 11. Proof the builder must provide

- Unit tests on the host side: unknown route, refused paths and methods, header allowlists,
  scrubbing of the credential and `wbt_` from bodies and errors, size cap, no redirect.
- Fake-backend pipeline test: a remote run whose sandbox env contains no
  `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`/`wbt_`, whose model calls arrive at a stub
  upstream with the right credential, for each row of §4 (OAuth, API key, gateway key, broker,
  bridge).
- Edge-case tests (§4): a keyless third-party gateway gets no server credential; custom
  headers arrive upstream but not in the sandbox; an unusual secret-named key and a Bedrock
  entry are refused for a remote spawn.
- Broker multi mode: a run started and resumed by its owner uses their subscription; resumed
  by a teammate, it is refused with the API-key message.
- Preflight tests: broker on + E2B starts; no broker + no server credential still refused.
- A live run on the local E2B: a real pipeline, then `env` inside the sandbox shows no
  credential.

## 12. Other engines, and the HTTPS-interception fallback

The relay carries Claude Code today. Another engine's CLI can use it when it meets three rules:

1. **Endpoint override:** a setting sends all of its model traffic to `http://127.0.0.1:<port>`. Auth,
   telemetry, model lists and update checks must also stay off any other host.
2. **Dummy credential:** it starts with a fake key and sends it in one plain header (`Authorization`,
   `x-api-key` or similar) that worca can replace.
3. **No other use of the key:** no token exchange, request signing or account lookup on another host. Its
   calls must also be plain HTTP/1.1 requests (streamed replies are fine), with no certificate pinning.

Each engine then needs its own route in `relay-route.mjs`: the upstream origin, the path allowlist, the auth
header, and any token exchange worca performs on its side.

A spike on 2026-10-22 tested three CLIs against a local stub with fake keys and outbound network blocked:

| CLI | Mode that meets the rules | Route worca needs |
|---|---|---|
| Codex 0.163 | A custom model provider (`wire_api="responses"`, `supports_websockets=false`), plugins and analytics off; API-key login only (`OPENAI_BASE_URL` no longer exists in this version) | OpenAI Responses API, Bearer |
| Copilot 1.0.100 | Offline "bring your own key" (`COPILOT_OFFLINE=true`, `COPILOT_PROVIDER_BASE_URL` set to the relay) | OpenAI or Anthropic API; the upstream leg with a real Copilot account is unverified |
| Cursor 2026.10.19 | `CURSOR_API_ENDPOINT` set to the relay, a dummy auth token, `network.useHttp1ForAgent=true` | Worca exchanges the API key for an access token on its side; breaks if the server forces HTTP/2 |

A spike like this, run against a stub with network blocked, is the first step for any new engine.

**Fallback for a CLI that fails the rules: an HTTPS-intercepting relay.** Not built. Use it only if a future
harness can't be pointed at the relay, or needs its real key for something the relay can't do on worca's
side. How it would work:

- The sandbox forces the CLI's HTTPS through the relay (`HTTPS_PROXY`, `CONNECT`).
- Worca terminates TLS with a worca certificate authority that the sandbox template trusts.
- Worca swaps the credential and opens its own TLS connection to the real host. This is the same idea as
  E2B's own egress header injection (`network.rules[host].transform.headers`), which can't be used here
  because it needs the real key at sandbox creation and doesn't work with the broker.

What it costs, and the rules it must keep:

- A certificate authority to create, protect and rotate, and its trust baked into every template.
- It fails on CLIs that pin certificates.
- It must stay a per-route allowlist of hosts and paths, never a general egress proxy for the sandbox.
- More code that handles credentials on worca's side, with the same §5 rules: header allowlists, scrubbing,
  no redirects, size and concurrency caps.

Treat adding it as a design decision with its own review, not a default for new engines.
