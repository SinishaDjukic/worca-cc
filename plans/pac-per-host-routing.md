# Network proxy — Follow a PAC File Per Host (draft, revision 2)

Status: design for review. Nothing here is implemented. Based on dev fe77e1ed6. Separate from the protection stack
(#854, #826, #981). Source: item 7 of the proxy-vs-protection report (2026-10-28): "only the first HTTP proxy is used.
A PAC that picks per host cannot be honoured."

- 2026-10-28: Q1–Q4 decided by the owner, all option (a) (see "Decisions").
- 2026-10-28, revision 2: the 15 findings of an independent review are folded in (see "Review changes"). Where a
  finding changed how a decision is carried out, the decision section says so.

Judgements not covered by Q1–Q4 are marked "(my call)".

## Problem

Worca's local proxy (`egress-proxy.mjs` `createProxy`, wired by `egress-policy.mjs` `startEgressPolicy`) chains every
connection that is not in `noProxy` to one fixed corporate proxy (`upstream-proxy.mjs` `createUpstreamConnector`,
whose `route()` is `goesDirect ? direct : upstream`). **Auto-detect** evaluates the system PAC or WPAD script once,
for `api.anthropic.com`, and fills that one proxy into the form (`system-proxy.mjs` `fromPac`).

Many corporate PAC files do more than that:

- intranet and partner hosts go `DIRECT`, often by IP range (`isInNet(dnsResolve(host), "10.0.0.0", "255.0.0.0")`),
  which a `NO_PROXY` list cannot express;
- different host groups go to different proxies (a "cloud" proxy for SaaS, a "default" proxy for the rest, a
  regional proxy per site);
- each answer lists fallbacks (`PROXY a:8080; PROXY b:8080; DIRECT`);
- the file changes over time (new SaaS hosts, a proxy retired).

With the fixed proxy, intranet git remotes, an internal npm registry or a self-hosted E2B on the LAN are sent to the
corporate proxy, which refuses them or cannot reach them. The person has to copy the PAC's direct rules into
`noProxy` by hand, and cannot copy IP-range rules at all.

## Goal

With **Follow the PAC file** chosen, the local proxy asks the PAC, per connection target, where to send it, and does
what it says: one of several approved corporate proxies, or direct. Children and Worca's own `fetch()` are unchanged:
they keep `HTTPS_PROXY=http://127.0.0.1:<port>`.

## Non-goals

- Kerberos or SSO (unchanged: not supported; see the Kerberos design session).
- Running the PAC anywhere but the sandboxed worker. A PAC file never runs in the server process.
- Path-dependent PAC rules (see "What the PAC sees").
- `dateRange`/`timeRange` rules: still always in range, as today.
- Following the OS proxy setting live (switching networks, the OS PAC URL changing). Worca follows the PAC URL that
  was saved; Auto-detect can be pressed again.
- Per-proxy logins (different accounts for different proxies). One saved login, as today.
- TLS to the proxy (`HTTPS host:port` entries) and SOCKS (Q2).

## Anti-goals (a failure even if it works)

- A PAC change or a spoofed WPAD answer sending the NTLM login, or any traffic, to a proxy nobody approved (Q1).
- A PAC that cannot be fetched, evaluated or understood turning into "everything goes direct". Every PAC failure
  fails closed.
- A noticeable delay on every connection (see "Cost").
- More lockout attempts against the account than today's: at most one unproven login in flight, and one rejection
  stops it everywhere (Q3).

## Settings

`networkProxy` gets two keys (my call on the names and shape):

- `pacUrl`: an `https://`, `http://` or `file://` URL of a PAC file. When set, it replaces `upstream`: Worca follows
  the PAC, and `upstream` is ignored with a warning (the `resolveUpstream` warnings list). `noProxy`, `auth`,
  `timeouts`, `fixedPort` and `enabled` keep their meaning. Refused on save:
  - a URL with a user name or password (settings never hold a password, as with `upstream`);
  - a single-label host such as `http://wpad/wpad.dat`. It resolves through whatever search domain the current
    network hands out, so on a hotel network anyone answering `wpad` would write Worca's routing table. Auto-detect
    that found WPAD asks for the full PAC URL (IT publishes one); see "Auto-detect".
  - An `http://` URL is accepted with a warning on the card: "a PAC file over plain HTTP can be changed by anyone on
    the network path; ask IT for an https:// URL".
- `pacProxies`: the `host:port` list of approved proxies (Q1). Written **only by the server**, from a recorded test or
  an Approve, never taken from a `PUT /api/proxy/settings` body or a chat proposal card. A hand edit of
  `settings.json` counts, as every hand edit does today (the file is the person's).

`auth` in PAC mode: `auto`, `ntlm` and `none` only (my call). Basic and Digest need a password from the `HTTPS_PROXY`
URL, which names one proxy; a PAC names others. A save with `pacUrl` and `basic`/`digest` is refused with a field error
on `auth`. PAC mode uses the saved login only: the `HTTPS_PROXY` URL's login (`urlCredentials`) is not used.

The card gets a mode choice: **One proxy** (today) or **Follow the PAC file**. In PAC mode it shows the PAC URL, the
approved proxies with their state, proxies the PAC names that are not approved (with **Approve**), and the worker's
state ("the PAC file could not be evaluated" shows here, not only in the log). The setup assistant's Network step
offers the same choice. Chat's `get_network_proxy` reports the mode, the PAC URL (`safePacUrl`), the approved and
unapproved proxies and their states. A chat proposal card can switch the mode and set `pacUrl`, but it can never
approve a proxy.

### Auto-detect

- macOS and Linux with a PAC URL (`scutil` `ProxyAutoConfigURLString`, GNOME `autoconfig-url`): fills `pacUrl` and
  preselects **Follow the PAC file**. It still fills host and port as today, so **One proxy** stays one click away.
- WPAD (`http://wpad/wpad.dat`): fills host and port as today, and says "your network uses auto-discovery; to follow
  its PAC file, enter the PAC file's full URL". `pacUrl` stays empty.
- Windows: `GetSystemWebProxy` resolves the PAC itself and gives Worca no URL (`system-proxy.mjs:142`). Auto-detect
  reads the registry `AutoConfigURL` (`HKCU\...\Internet Settings`) when it is set and fills `pacUrl` from it; WPAD
  on Windows is the same as above.

## Request flow

1. **Self/loopback.** `isSelf` and loopback targets go direct or are refused, as today.
2. **Egress policy.** `decide(host, policy)` (`WORCA_EGRESS_MODE` allow/deny) runs first and its 403 stands. A PAC
   never widens the policy.
3. **`noProxy`.** `goesDirect(host, noProxy)`: the person's own list wins over the PAC and costs no evaluation.
4. **PAC.** The router evaluates (cache or worker) and gets an ordered entry list.
5. **Entries, in order** (fallback rules below):
   - `PROXY host:port` / `HTTP host:port`: usable when `host:port` is in `pacProxies`, is not a loopback, link-local
     (`169.254.0.0/16`, `fe80::/10`) or one of the local proxy's own ports, has a port in 1–65535, and, under an
     enforced egress policy, the proxy host itself passes `decide()`. Otherwise the entry is skipped.
   - `DIRECT`: today's direct path from this machine (`net.connect` / `directAgent`).
   - `HTTPS host:port` (TLS to the proxy), `SOCKS`, `SOCKS4`, `SOCKS5`, anything unparsed: skipped (Q2).
   - When no entry is usable, the connection is refused with a 502 that names the reason of the first skipped entry:
     "the PAC file names a new proxy <host:port>; approve it under Settings › Network proxy", "the PAC file picks only
     SOCKS for <host>, which Worca cannot chain to", "…only an HTTPS proxy…", "the PAC file gave no usable answer for
     <host>". An empty or unparseable answer is this last case. It is never treated as `DIRECT`, though browsers do
     that.

### The seam in `createProxy`

`createProxy` today calls the synchronous `connector.route(host)` and then either `upstreamTunnel` (via
`connector.tunnel()`) or `connector.forward()`, or its own direct code. The fallback errors happen inside `tunnel()`
and `forward()`, after a route was chosen, so the loop cannot sit in a "pick a route" step. Instead:

- The router exposes the same two calls the connector does, `tunnel({ host, port })` and
  `forward(req, res, { host, port, url })`, and runs the entry loop inside them, direct entries included. Direct
  code moves out of `createProxy` into a small `directTunnel`/`directForward` that both modes share.
- One-proxy mode is a router with one entry list `[upstream]` (or `[DIRECT]` for a `noProxy` host). `createProxy`
  has one code path: policy check, then `router.tunnel` or `router.forward`. `useConnector` keeps swapping the router
  whole.
- `connector.tunnel()` and the connect step of `forward` mark a failure to reach the proxy (`connectTcp` error or
  timeout) with `err.connectFailed = true`, so the loop can tell "unreachable" (fall back) from "the proxy answered
  502" (do not).

### Fallback between entries

- A proxy that cannot be reached (`connectFailed`) is marked **bad for 5 minutes** and the next entry is tried. When
  every entry is bad, the bad ones are tried anyway, in order.
- The connect timeout for an entry that has another entry after it is 5 s (my call, fixed), not `timeouts.connectMs`
  (default 60 s). A black-holed first proxy then costs 5 s once, not a minute per new host. The last entry uses
  `connectMs` as today.
- An HTTP answer from the proxy (403, 502, 504) is passed to the client as today. No fallback: the proxy is up and
  decided.
- A 407 after credentials were sent never falls over: that would spend another attempt on the same account (Q3).
  The shared breaker is tripped and the client gets today's `x-worca-proxy: needs-login` 407. That header stays
  reserved for real login rejections.
- `DIRECT` is used only where the PAC lists it.
- CONNECT: fallback is possible until `200 Connection Established` is written to the client.
- Plain HTTP: `relay()` pipes the client's request body into the first attempt, so a body cannot be sent twice.
  Fallback is done only for requests **without a body** (`GET`, `HEAD`, `OPTIONS`, `DELETE` without
  `content-length`/`transfer-encoding`). A request with a body that hits an unreachable proxy gets a 502 ("send the
  request again"), and the bad mark sends the next request to the next entry.

### What the PAC sees (my call)

`FindProxyForURL(url, host)` gets `url` = `scheme://host[:port]/`, the path and query stripped, for CONNECT
(`https://`) and plain `http://` alike. This matches what Chrome passes for https, keeps paths and tokens out of a
script from the network, and lets the cache key on host. PAC rules on paths are not followed; the docs say so.

## The PAC worker

Today `evaluatePac` spawns one `node --permission` process per evaluation, and once more for each DNS answer the
script needs. That is fine for one Auto-detect press and far too slow per connection (see "Cost"). It becomes a
**long-lived worker**, one per Worca process that runs its own local proxy in PAC mode.

Today's walls stay: `node --permission` with read access to its own file only, no child processes, no workers, empty
env, 64 MB heap, `DONT_CONTEXTIFY` context, string code generation off, `process` bindings and network globals
removed, only strings cross the boundary. Today one more wall comes from the process exiting after one answer
(`pac-worker.mjs:96-98`): nothing the script queued runs afterwards. A long-lived worker must replace it:

- **A fresh context per call.** `load` compiles the script once into a `vm.Script`. Each `find` creates a new
  context, defines the helpers in it, runs the compiled script and then `FindProxyForURL`. Nothing survives between
  calls: a script cannot rewrite `__run` or the helpers for the next call, and the rerun after a DNS answer starts
  clean, as `pac-worker.mjs:12-13` assumes. The cost is one context per cache miss (see "Cost").
- **Microtasks bounded.** Each context is created with `microtaskMode: 'afterEvaluate'`, so promise jobs run inside
  the `vm` timeout (1000 ms) and not after the answer. Timers are not defined in the context.
- **A parent-side kill timer per request**, as `runWorker` has today (`pac-eval.mjs:39`): no answer within 2 s (my
  call) kills the worker. The worker's own `vm` timeout cannot fire on a hung event loop.
- 64 KiB of output, a crash or an OOM also kills it. The parent respawns it with backoff (1 s doubling to 30 s).
  While it is down, requests that need an evaluation wait up to 5 s (my call), then get a 502 "the PAC file could not
  be evaluated", and the card shows that state. Never direct.

Protocol: newline-delimited JSON on fds 0 and 1. `{ op: 'load', gen, script }`; `{ op: 'find', id, gen, url, host,
dns, myIp }` answers `{ id, gen, result } | { id, gen, needDns } | { id, gen, error }`. The DNS round trip stays as
today (the parent resolves, then sends `find` again with the answer added), without a new process each round, and
`MAX_DNS_ROUNDS` (16) stays. The worker is synchronous, one request at a time; the parent queues.

`evaluatePac` (Auto-detect, Test) keeps its signature and runs on a short-lived worker with the same protocol, so
there is one worker file.

## DNS for the PAC

The parent answers the script's `dnsResolve`/`isResolvable`/`isInNet` lookups. Two rules (my call):

- **Only names the PAC could have meant.** The parent resolves the evaluated host itself and names that appear as
  string literals in the PAC text. Any other name (`dnsResolve(host + ".attacker.example")`) answers "not
  resolvable" without a lookup. A PAC from the network cannot turn every connection into a DNS query that reports
  the host to a server it chose. Real PAC files resolve the target host or a fixed intranet name.
- **Real lookups are counted until they return.** `dns.lookup` (my call over `dns.Resolver`: it follows `/etc/hosts`
  and macOS split DNS, as the browser the PAC was written for does) runs on the libuv thread pool (4 threads by
  default), shared with file I/O, and cannot be cancelled. At most 2 lookups run at a time, counted until each really
  returns. A lookup the script waits on longer than 2 s answers "not resolvable" to the script but keeps its slot
  until the OS gives up. When both slots are held, a further name waits up to 2 s for one, then answers "not
  resolvable".
- Answers are cached for 1 minute (negative ones too) and cleared with the route cache.

## Cache

- Key: `scheme|host|port` (lower-cased host). Value: the parsed entry list. A plain `Map`, cleared when it reaches
  2000 entries (my call).
- One TTL, 1 minute, for every answer (my call). It bounds DNS changes, a new `myIpAddress()` after a network switch,
  and `weekdayRange` the same way, without polling the network interfaces.
- Cleared whole (routes and DNS) when the PAC script changes, when `pacProxies` changes, and when the person saves
  new proxy settings.
- Misses for the same key in flight share one evaluation. On a reload the in-flight map is cleared, and an answer
  whose `gen` is not the current one is used for the request that asked (it was right when asked) but never cached.

## Several upstreams

- The router keeps one `createUpstreamConnector` per approved `host:port` the PAC returns, created on first use. Each
  keeps its own keep-alive pool, Negotiate/NTLM wrapper choice (`ntlmScheme`) and keep-alive judgement (`pooling`).
- **One breaker for the account (Q3).** The router owns one `createAuthGate` and passes it to every connector
  (`createUpstreamConnector` gets a `gate` option instead of building its own at `upstream-proxy.mjs:395`). So:
  - while the login is unproven, one handshake with it is in flight across **all** proxies, as with one proxy today;
  - once verified, up to `MAX_PARALLEL_HANDSHAKES` across all of them;
  - unconfirmed strikes add up across proxies, and a trip on any proxy stops the login on every one at once;
  - `useLogin` resets the one gate; connectors created after a trip start shut.
  - A connector with `auth: none` takes no ticket and is not affected.
  - This also means a flaky secondary proxy that resets connections right after credentials (two unconfirmed strikes)
    stops the login everywhere. That is the account-wide rule working as decided, and it is an outage path one proxy
    did not have; the card names the proxy that tripped it (`markLoginRejected` already records `upstream`).
- Connectors are not idle-closed (my call). There are at most 16 (a PAC naming more approved proxies gets a 502 for
  the extra ones and one log line). A connector the PAC stops naming is closed at the next router swap.
- A proxy hostname that does not resolve is a connect failure (fallback applies), not a reason to drop the PAC.
- Status: the router reports `{ login: { state, label, trippedBy? }, upstreams: [{ upstream, state, approved }] }`.
  `worca proxy status` prints one line per upstream; the exit code follows the login state as today (needs login 3).

### The credentialed-env scrub

Today D21 (`egress-policy.mjs:40-46`, `loginFor`) rewrites any env variable holding `http://user:pass@<upstream>` to
the local proxy URL, so a child cannot skip the local proxy with the password. It compares against the one upstream.
In PAC mode it compares against every proxy in `pacProxies` and every proxy the PAC has named, and the swap path
re-runs it when either list grows.

## Live reload

- Fetch (`fetchPac`, direct, 1 MB and 4 s caps) at start and then every 5 minutes (my call). A plain GET; the SHA-256
  of the body decides "changed". A `file://` PAC is read the same way.
- Redirects: at most 3, same scheme or http→https only. A redirect from `https:` to `http:` is refused as a fetch
  failure (`fetchPac` today follows any redirect: `system-proxy.mjs:43`).
- A changed body is evaluated once for `api.anthropic.com` in a short-lived worker as a smoke test. If that fails
  (syntax error, no `FindProxyForURL`, timeout), the old script stays, one log line says why, and the card shows "the
  PAC file changed but cannot be used; still using the version from <time>".
- A good new script is loaded into the live worker (`load` with a new `gen`), the caches are cleared, and connectors
  for proxies it no longer names close at the next swap. Open connections finish on their route.
- A fetch failure keeps the current script. Never direct.
- **At start with no reachable PAC (Q4):** use the last good copy at `<WORCA_HOME>/proxy-pac-cache.json` (`{ url,
  sha256, fetchedAt, script }`, owner-only mode like other Worca files) and keep retrying. The copy is written only
  from an `https:` or `file:` fetch (owner decision, 2026-10-28): a copy from plain `http:` is only as trusted as the network it came
  from, and keeping it would let one bad network write the routes for the next start. Without a usable copy, every
  connection not in `noProxy` gets a 502 "the PAC file <url> could not be fetched" until it can be.
- **Router swap.** `useConnector` closes a swapped-out router only after its last connection ends, which can be a
  long tunnel. The router therefore stops its worker and refresh loop when it is **replaced** (it takes no new
  requests after that) and closes its connectors when its last pinned connection ends. Per-upstream connectors are
  counted inside the router the same way `createProxy` counts connectors today (`egress-proxy.mjs:188-208`), so a
  connector's pool is never destroyed under a pooled request.
- Other Worca processes: a `worca run` that inherits the parent's proxy (`inherited`) follows the parent. A Worca that
  runs its own proxy runs its own worker and refresh; both read the same `settings.json`, so a mode change applies to
  both through the existing settings watcher.

## Egress policy and `noProxy`

- With `WORCA_EGRESS_MODE` enforced, the policy checks the target first, as today. In PAC mode it also checks:
  - each PAC-named proxy host before it is used (a proxy the policy does not allow is skipped like an unapproved one);
  - the PAC URL host before each fetch. The fetch is direct (`directFetch` deliberately skips the local proxy), so
    without this check the PAC host would be the one destination outside the policy.
  A settings `upstream` is not checked today and stays unchecked: a person set it.
- Children's `NO_PROXY` stays the person's `noProxy` list only. The PAC's direct rules are code (IP ranges, DNS
  checks), so children send those hosts to the local proxy, which goes direct. One extra local hop, no wrong route.

## Test, Save and Approve

- The `UNTESTED` rule extends to PAC mode: a save needs a passing test of exactly `pacUrl` + `auth` within 10 minutes.
  The test's result fixes `pacProxies`.
- **What a test approves.** Testing only the routes of `TEST_HOSTS` would approve one proxy in a PAC with a SaaS
  proxy and a default proxy, and the first intranet host would then hit "new proxy" on day one. The test therefore:
  1. fetches the PAC and collects every `PROXY`/`HTTP host:port` that appears as a literal in its text, plus the
     entries its answers for `TEST_HOSTS` give;
  2. tests them one after another on **one shared gate** (the same breaker rule as live traffic): a `CONNECT` to the
     first `TEST_HOSTS` entry through each proxy. Any answer that proves the login (or a proxy that asks for none)
     passes that proxy. One rejection stops the whole test: one lockout attempt, as today;
  3. tests each `TEST_HOSTS` entry on the route the PAC gives it, as a real connection would.
  The result lists the proxies found with pass or fail, and the route per host (`github.com via
  proxy-a.acme.example:8080 OK`, `api.anthropic.com DIRECT OK`). Save approves the proxies that passed.
- **Approve** a proxy named later: the card's Approve button, `POST /api/proxy/approve { proxy: "host:port" }`, and
  `worca proxy approve <host:port>`. It runs the same one-proxy test on the shared gate and adds the proxy to
  `pacProxies` only when it passes. `/api/proxy/approve` is agent-blocked like the rest of `/api/proxy/*`
  (`PROXY_AGENT_BLOCKED`), and the chat has no tool for it.
- A test login (the setup assistant's) is used for every proxy the test touches, on the shared gate.
- Chat's `test_network_proxy` runs the same test on the saved values. Its pass never counts for the `UNTESTED` rule
  and never approves a proxy.

## Cost per connection

Measured on this machine on 2026-10-28 with today's `evaluatePac` (one spawn per evaluation). The machine was under
load average 80, where `node -e 0` alone took 0.6–0.9 s; on an idle Mac a Node start is typically 40–80 ms. The
numbers show the shape (a spawn per evaluation), not the idle cost:

| PAC | today, per evaluation |
|---|---|
| 3 lines, no DNS | 0.8–1.3 s |
| 3 lines, one `dnsResolve` (two spawns) | 1.1–2.1 s |
| 3000 `shExpMatch` rules | 1.0–1.6 s |

Spawning per connection is out, even idle (40–160 ms added to every new host). With this design (estimates, measured
by the builder, see Proof):

- **Cache hit** (the common case: agents talk to a handful of hosts): a `Map` lookup, well under 0.1 ms, like
  today's `goesDirect`.
- **Cache miss, no DNS**: a pipe round trip to the warm worker, a new context (well under 1 ms), the helpers and the
  compiled script run, then `FindProxyForURL`. Expected about 1 ms for typical PAC files. `shExpMatch` compiles a
  RegExp per call (`pac-worker.mjs:56`), so a file with thousands of rules costs a few ms or more per miss. Misses
  queue, since the worker is serial.
- **Cache miss with DNS**: each `needDns` round re-runs the whole script (up to 17 runs), plus one lookup per name:
  well under 1 ms from the OS cache, a few ms to tens of ms from the network, 2 s for a name that does not resolve.
- **A black-holed proxy with a fallback after it**: 5 s once, then 5 minutes on the next entry.
- **First connection to a proxy**: its login handshake, once, as today's single upstream at first use.
- **Memory**: one extra Node process of about 30–50 MB RSS for each Worca process that runs its own proxy in PAC
  mode. The UI plus a few `worca` CLIs that each start their own proxy each pay it; a `worca run` that inherits the
  parent's proxy does not. Nothing in one-proxy mode.
- **Background**: one PAC GET every 5 minutes.

## Where it lands

- `src/core/pac-worker.mjs`: line protocol, `load`/`find`, a fresh context per call, `microtaskMode`.
- `src/core/pac-eval.mjs`: `createPacEvaluator()` (long-lived worker, queue, kill timer, respawn, DNS rules and
  cache); `evaluatePac()` rebuilt on it; `parsePacResult` refuses ports outside 1–65535 and marks `HTTPS` entries
  apart from `PROXY`.
- New `src/core/pac-router.mjs`: route cache, connector set, shared gate, entry checks (approved, loopback,
  link-local, self ports, policy), fallback loop, `tunnel`/`forward`, status, refresh loop, last good copy.
- `src/core/egress-proxy.mjs`: one path through `router.tunnel`/`router.forward`; direct code moved to shared
  `directTunnel`/`directForward`.
- `src/core/upstream-proxy.mjs`: `gate` option on `createUpstreamConnector`; `connectFailed` on connect errors;
  `resolveUpstream` reads `pacUrl` (no `urlCredentials` in PAC mode); `checkUpstream` tests per proxy and per route.
- `src/core/egress-policy.mjs`: build a PAC or a one-proxy router; `swapUpstream`, `reloadLogin` (its "this connector
  already tripped" check, `:211`) and the `upstream` getter (`:269`) work on the router; `loginFor` scrub against
  every PAC proxy; `corporateLine`/`egressNotice` boot line (`:392-427`) names the PAC.
- `src/core/system-proxy.mjs`: `pacUrl` usable as a setting; Windows `AutoConfigURL`; WPAD message; `fetchPac`
  redirect rule.
- `src/core/proxy-credentials.mjs`: `stateLine`, `proxyState` (`:242-282`) read the router's login state and list.
- `src/core/proxy-host.mjs`: `passKey` (`:48`) and `runningKey` (`:52-57`) for PAC mode; `chatStatus` (`:81-98`);
  the approve route; `pacProxies` written only here.
- Settings validation (`settings.mjs`, `settings-errors.mjs`): `pacUrl` rules, `pacProxies` read-only from requests.
- `src/cli/proxy.mjs`: status lines per upstream, test lines per proxy and route, `approve`.
- The card and the setup step; `ask/proxy-*.mjs` (chat read; proposal without approve).
- `docs/network-proxy.md`: "Who it is for" (`:91`), the Auto-detect table (`:36-38`, it says "host and port" only),
  troubleshooting (`:271-272`), and a new "Follow a PAC file" section (approving proxies, the http warning, what is
  not followed).

## Proof

- Unit: order (policy, `noProxy`, PAC); every skip reason (unapproved, SOCKS, HTTPS, loopback, self port, link-local,
  policy) and the 502 text; empty and garbage answers refused; fallback on `connectFailed` only, the 5 s timeout,
  bad-mark expiry; no fallback on 403/502/407; plain HTTP with a body not retried; the shared gate (one unproven
  handshake across two proxies, strikes across proxies, a trip on one shuts both); cache TTL, cap, `gen` answers not
  cached; the DNS name rule and the 2-slot limit held until the real lookup returns; `pacProxies` ignored in a PUT
  body; `pacUrl` userinfo and single-label hosts refused.
- Worker: the existing escape tests run against the long-lived worker, plus: a promise loop and a busy loop are
  killed by the parent timer and the worker respawns; a script that rewrites `__run` or the helpers does not affect
  the next call; a reload swaps answers; a crash fails closed.
- Integration with fake proxies (the `checkUpstream` test style): a PAC sending host A to proxy 1, host B to proxy 2,
  host C direct; proxy 1 down falls to proxy 2 after 5 s; a PAC change moves host A live; a new proxy is refused until
  approved; PAC server down at start uses the `https:` copy and refuses with an `http:` one (Q4); an `https:`→`http:`
  redirect is refused; under `WORCA_EGRESS_MODE=allow` a PAC proxy outside the allowlist is skipped.
- Test: one wrong password across a PAC with three proxies costs one Type 3.
- Cost: a benchmark script reporting hit, miss, miss with one DNS round, and a 3000-rule miss on the warm worker, run
  on an idle machine and quoted in the PR.

## Decisions (2026-10-28)

All four took option (a). The options are kept for the record. Revision 2 changed how Q1 and Q4 are carried out; the
choices themselves stand.

**Q1. Which proxies may receive the saved login?** Today the person sees the one proxy host in the form and tests it
before Worca sends their NTLM login there. A PAC can name new proxies at any refresh, and WPAD over plain HTTP can be
spoofed on the local network, which would hand an NTLM handshake to an attacker's proxy (the response can be cracked
offline or relayed).
- (a, chosen) **Approved list.** The login goes only to proxies the person approved (`pacProxies`, written by a test
  or an Approve).
  - Revision 2: a proxy that is not approved gets **nothing**: its entry is skipped and, when no other entry is
    usable, the client gets a 502 naming it, with Approve on the card. The first draft sent it the request without
    credentials, which still leaked plain-HTTP `Authorization` headers and every CONNECT target, and a spoofed proxy
    that never asked for a login would never have shown Approve.
- (b) Domain suffix: the login goes to any PAC proxy under the PAC host's domain (`*.acme.example`).
- (c) Any proxy the PAC names. Simplest, and as safe as the PAC's transport.

**Q2. SOCKS entries.**
- (a, chosen) Skip and try the next entry; refuse when only SOCKS is left. Revision 2: `HTTPS host:port` entries (TLS
  to the proxy, which the connector does not speak) are handled the same way.
- (b) Implement SOCKS5 (no auth, or user/password) as a route kind. About a day; no NTLM over SOCKS.

**Q3. Login rejection on one proxy.**
- (a, chosen) Account-wide: one rejection stops the login on every upstream, as the account is what locks.
  Revision 2: carried out by one shared breaker instead of trips fanned out after the fact, which also keeps one
  unproven login in flight across all proxies.
- (b) Per proxy: the others keep trying until each is rejected once (up to N attempts for N proxies).

**Q4. PAC unreachable when Worca starts.**
- (a, chosen) Use the last good copy from `<WORCA_HOME>/proxy-pac-cache.json` and keep retrying. Revision 2: the copy
  is written only from an `https:` or `file:` fetch (confirmed by the owner 2026-10-28), so an `http:` PAC fails closed at a start without it.
- (b) Fail closed: 502 for everything not in `noProxy` until the PAC can be fetched.

## Review changes (revision 2)

| # | Finding | Where it went |
|---|---|---|
| 1 | One breaker per proxy allowed several unproven logins and lost strikes | Several upstreams: one shared gate; Test on the same gate |
| 2 | An unapproved proxy still got the traffic | Request flow step 5; Q1 note |
| 3 | WPAD and plain-HTTP PAC transport | Settings (`pacUrl` rules), Auto-detect, Live reload (redirects, copy only from https/file), DNS name rule |
| 4 | Fallback loop could not sit in `pick()` | The seam in `createProxy`; plain HTTP only without a body |
| 5 | Long-lived worker lost the exit wall | The PAC worker: fresh context per call, `microtaskMode`, parent kill timer |
| 6 | Empty answers, HTTPS entries, loop targets | Request flow step 5 |
| 7 | Env scrub keyed on one upstream; `urlCredentials`; `pacUrl` userinfo | The credentialed-env scrub; Settings |
| 8 | PAC proxies and the PAC fetch outside the egress policy | Egress policy and `noProxy` |
| 9 | DNS cap did not free the thread pool | DNS for the PAC |
| 10 | Reload races, retiring routers, pool destroyed under requests | Cache (`gen`), Live reload (router swap) |
| 11 | 60 s waits before fallback and for the worker | Fallback (5 s), worker wait (5 s), Cost |
| 12 | Test approved too few proxies; who writes `pacProxies` | Test, Save and Approve; Settings |
| 13 | Credential-less 407s and the needs-login header | Fallback (header only for real rejections); case removed by #2 |
| 14 | Surfaces that assume one upstream | Where it lands |
| 15 | Simpler where it costs nothing | One TTL, no interface poll, no conditional GET, no idle-close, plain `Map` |
