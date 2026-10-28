# Kerberos (Negotiate) to the corporate proxy — Design

Status: design for review. No code yet. Based on dev `fe77e1ed6`. A feature of its own, apart from the
security stack (#854, #826, #981).

## 1. Problem

The local proxy chain (`src/core/upstream-proxy.mjs`, `src/core/ntlm.mjs`) logs in to a corporate proxy with
NTLMv2 (also wrapped in `Negotiate`), Digest or Basic. A proxy that accepts only Kerberos tickets rejects the
NTLM token once; the lockout breaker trips and Worca stops with "proxy needs login". The trip line says so
(`tripped()`, `upstream-proxy.mjs:422`), and the docs send the user to Px (`docs/network-proxy.md`, "Kerberos
or single sign-on").

Kerberos-only proxies are common where NTLM has been switched off by policy (the Microsoft NTLM deprecation,
"Restrict NTLM" GPOs, Credential Guard). Those are the networks where people also cannot install Px, or where
Px is one more daemon IT has to approve.

What a Kerberos login to a proxy needs:

1. The proxy answers `407` with `Proxy-Authenticate: Negotiate`.
2. The client asks its Kerberos library for a service ticket to `HTTP/<proxy FQDN>` from the user's existing
   ticket-granting ticket (no password), and wraps the AP-REQ in an SPNEGO token.
3. The client sends `Proxy-Authorization: Negotiate <token>` on the same connection. Usually one leg. The proxy
   may answer with a mutual-auth token, which a proxy client can ignore.

Step 2 is the only new part. Node has no GSSAPI or SSPI, so something outside pure JS must produce the token.

## 2. Platform options

### 2.1 Windows: SSPI

| Option | How | Verdict |
|---|---|---|
| Native addon (`kerberos`, see 2.3) | `InitializeSecurityContext` with the `Negotiate` package and the logon session's credentials | **Use.** Same code path as browsers and Px. Negotiate falls back to NTLM with the session's credentials on its own, so it also covers NTLM-only proxies with no saved login |
| PowerShell helper | A long-lived `powershell.exe -NoProfile` child that loads C# through `Add-Type` and P/Invokes `secur32.dll`, one JSON line per token over stdin/stdout | **Reject.** `Add-Type` is blocked under Constrained Language Mode (AppLocker / WDAC), which is common on exactly these networks. P/Invoke into `secur32` from PowerShell is a credential-access pattern that AMSI and EDR flag. Startup costs 1–2 s, and the security context has to live across legs inside the helper. Windows PowerShell 5.1 runs on .NET Framework, which has no `NegotiateAuthentication` (that is .NET 7+, `pwsh` only, not installed by default) |
| `node-expose-sspi` | Native SSPI addon | **Reject.** Windows only, last release 0.1.60 in December 2022, pulls in `node-fetch@3.0.0-beta.9` and four other dependencies |

### 2.2 macOS and Linux: GSSAPI and the ticket cache

The ticket comes from the user's credential cache: `kinit`, the macOS Ticket Viewer or an Enterprise SSO
extension, or SSSD on a domain-joined Linux box. The cache type differs: `FILE:` (`/tmp/krb5cc_<uid>`),
`KEYRING:`, `KCM:` (the default on Fedora/RHEL with SSSD) and `API:` (macOS). Only GSSAPI reads all of them.

| Option | How | Verdict |
|---|---|---|
| Native addon (`kerberos`) | `gss_init_sec_context` with the SPNEGO mech, against the default cache | **Use** |
| Shell out to a CLI | No standard CLI prints an SPNEGO token for a given SPN (`kvno` gets a ticket but does not print the AP-REQ; `curl --proxy-negotiate` does the whole exchange on its own socket) | **Reject.** Nothing to call |
| Pure-JS Kerberos | Parse the ccache, send a TGS-REQ to the KDC, build the AP-REQ and SPNEGO in JS (Node crypto has the AES-CTS pieces) | **Reject.** Reads `FILE:` caches only (not KCM, KEYRING or API), so it fails on the default setup of macOS and RHEL. It also needs KDC discovery over DNS SRV and FAST/PAC handling, and it is security-critical crypto that we would own |
| FFI (`koffi`) to `GSS.framework` / `libgssapi_krb5` / `secur32` | Our own bindings, about 200 lines per platform | **Reject for now.** It works, but memory-safety bugs in our `gss_buffer_desc` and `SecBuffer` glue would be ours. It still installs a native binary (`koffi` 3.3.4, MIT, install script `cnoke --prebuild`), so it does not avoid the native-module cost |

### 2.3 Node packages

| Package | Licence | Native build | Maintenance | Fit |
|---|---|---|---|---|
| `kerberos` (mongodb-js) | Apache-2.0 (MIT-compatible) | N-API addon, `prebuild-install --runtime napi \|\| node-gyp rebuild`. Prebuilds: Linux glibc ≥ 2.28 x64/arm64/s390x, macOS universal, Windows x64 (arm64 experimental). Deps: `node-addon-api`, `prebuild-install` | 7.0.0 (February 2026). Kept up by MongoDB for the driver's GSSAPI auth | Client API matches the need: `initializeClient('HTTP@proxy.acme.example', { mechOID: GSS_MECH_OID_SPNEGO, flags })`, then `client.step(challengeB64)` returns the next token, and `contextComplete` says when it is done. GSSAPI on Unix, SSPI on Windows |
| `koffi` | MIT | Prebuilt FFI | Active (3.3.4, October 2026) | Only as the base for 2.2's FFI option |
| `node-expose-sspi` | ISC | Native, Windows only | Stale since 2022 | No |

Costs of `kerberos`, to accept knowingly:

- **Install.** `prebuild-install` downloads the binary from `github.com/mongodb-js/kerberos/releases` at `npm install`. It uses npm's proxy settings. A company that installs from an internal registry mirror and cannot reach GitHub falls back to `node-gyp rebuild`, which needs a compiler and the Node headers from `nodejs.org`. `npm install --ignore-scripts` (which some companies require) leaves no binary at all, and loading then fails with `MODULE_NOT_FOUND`. So the module must be optional and its absence a clear state, never a crash. The docs name `npm rebuild kerberos` and prebuild-install's binary-host mirror setting. (Spike, §8.)
- **Runtime libraries.** On macOS the universal prebuild links the system `Kerberos.framework` (Heimdal), so `API:` caches and Ticket Viewer work with nothing extra installed. On Linux it needs `libgssapi_krb5.so.2` (MIT krb5); not yet checked (§8).
- **Supply chain.** One more native binary, plus **36 transitive packages** (`npm ls` after a clean install), nearly all of them `prebuild-install`'s download stack (`tar-fs`, `simple-get`, `tunnel-agent` and others), installed always, at about 2.5 MB. `prebuild-install` 7.1.3 is marked deprecated ("No longer maintained") on npm. Pinned exactly, like the rest of `dependencies`.
- **Error strings.** On macOS the addon's error text for a Kerberos failure once carried stray bytes after the message (`not found ;��\u0001`), which looks like a read past the end of a buffer. Worca never shows or logs the addon's raw text. It maps failures to its own texts (5.2) and logs only a cleaned cause.

## 3. Recommendation

**Build it, with `kerberos` as an optional dependency, behind an explicit new login mode. Keep Px in the docs
as the fallback for installs where the native module cannot load.**

- New `networkProxy.auth` value `kerberos`, labelled **Login: Single sign-on (Kerberos)** on the card. It is opt-in only: `auto` stays NTLMv2 and never switches to the person's tickets by itself, because Kerberos proves the person's live identity to the proxy without them having typed anything for Worca.
- On Windows the same mode uses SSPI `Negotiate`. That is Kerberos, or NTLM with the session's credentials when the proxy or domain does not do Kerberos. On macOS and Linux it is Kerberos only (GSSAPI NTLM needs `gss-ntlmssp`, which we do not ask for).
- No `proxy-login.json` in this mode. Nothing is stored, so a stolen file gives nothing away. This is a step up from the NT hash.
- `kerberos` goes into `optionalDependencies`, pinned to an exact version and loaded with a lazy `import()` only when `auth` is `kerberos`. Every other install never loads it.
- Effort: one connector branch, one gate state, settings and card, CLI status, docs, unit tests, and an opt-in KDC suite. About the size of the Digest slice.

Why not only Px: Px is a second proxy the user installs, starts and keeps running. Worca's live swap, Test
button, setup assistant and `worca proxy status` cannot see behind it. Many locked-down machines will not run an
unsigned Python executable. Px stays the answer when the module cannot load (no prebuild for the platform,
`--ignore-scripts`, musl), and the docs say so.

What would change the recommendation: if the owner does not want a native module in the install at all, the
answer is to stay with Px and only improve the 407 message (name the Kerberos-only case and link Px). That costs
nothing to maintain.

## 4. What runs where

| Piece | Where | Has tickets? |
|---|---|---|
| Upstream connector + `kerberos` addon | The Worca process that runs `startLiveEgress()`: the UI server, or a `worca run` started from a shell that is not served by another Worca | Yes. It runs as the person, with their cache |
| Local proxy `127.0.0.1:<port>` | Same process | Gives out tokens only on the upstream socket |
| Agents, git, MCP, plugins, terminals | Children; `HTTPS_PROXY` = the local proxy | They never get a token. They can read the cache themselves (same uid), see 6 |
| Docker sidecar (`egress-proxy.mjs`, node: modules only) | Container | No. It stays free of native modules. Kerberos mode is not offered there |
| E2B sandboxes, `worca container up` | Remote, or a box | No cache. They reach the corporate proxy only through the host's local proxy, if at all (report F2/F4 cover those routes) |
| Hosted / multi-user server (`WORCA_EGRESS_MODE` on a platform) | Server | Kerberos mode is refused: the cache belongs to the service account, not the person using the UI |

Only the connector changes. `egress-proxy.mjs` keeps calling `route()`, `tunnel()` and `forward()` as now.

## 5. Fit with the connector, the login watcher and the lockout breaker

### 5.1 Connector

Add a fourth branch to `authenticate()` (`upstream-proxy.mjs:483`), next to `basicStep` and `digestStep`:

```
kerberosStep(ctx, socket, buildHead, deadline, opts):
  if ctx.preemptive: token = negotiator.first()        # known to want Negotiate: skip the 407 leg
  else: h1 = roundTrip(no authz); if h1.status != 407 -> unchallenged
        require a Negotiate challenge (else the same 502 texts as auto, naming what is offered)
        drain the 407 body on the same socket (as NTLM)
        token = negotiator.first()
  loop: head = sendCredentials(... `Negotiate ${token}`)
        if 407 with a Negotiate token and !negotiator.complete -> token = negotiator.step(it); continue   # SSPI NTLM leg
        else judge() as today
```

- `negotiator` is a small module, `src/core/negotiate.mjs`. It wraps `kerberos.initializeClient(`HTTP@${host}`, { mechOID: SPNEGO, flags: 0 })` and is injected into `createUpstreamConnector`, so tests pass a fake. One client object per connection (an SSPI context is per connection), with a cap of three legs.
- Flags: `0`. Never `GSS_C_DELEG_FLAG`. The spike shows that this flag really forwards the TGT: the token grows from 1104 to 2140 bytes, and the KDC logs a second TGS-REQ for the forwarded TGT. No mutual-auth requirement: a missing or bad mutual token in the final `Proxy-Authenticate` does not fail the login.
- SPN: `HTTP@<upstream host>`, the host as configured. A proxy configured by IP or by a CNAME the SPN does not match will fail. The 407 text says to enter the proxy's real host name. No `spn` setting until someone needs one.
- `ProxyCredentials` gets no secret in this mode. `ctx.creds` is a label only: the principal, for `worca proxy status` and the card. `client.username` is `null` until the client has stepped the proxy's mutual-auth token from the `200` (spike, §8). So the connector does step that token when there is one, for the name only, and does not require it.
- Pooling, the plain-HTTP `HEAD` probe and the per-request fallback work unchanged: Negotiate logs in a connection, like NTLM.

### 5.2 Lockout breaker

A rejected Kerberos token does not spend a password attempt. The KDC issued the service ticket from a valid TGT,
and the proxy only checks it. On Windows the NTLM fallback uses the session's own (correct) credentials. So the
breaker's purpose, "never guess a password twice", does not apply. Its second purpose, "do not hammer the proxy
and KDC in a loop", still does.

- A new gate state, `needs-ticket`, next to `tripped`. It is entered on a 407 to a Negotiate token, or when the token cannot be built locally (no TGT, TGT expired, KDC unreachable, unknown SPN). A local failure never contacts the proxy.
- In `needs-ticket` the gate refuses at once with a 407 and `x-worca-proxy: needs-ticket`, and a text by cause: "no Kerberos ticket: run `kinit` or log in to the domain", "the KDC does not know HTTP/<host>: enter the proxy's host name", "the KDC cannot be reached", "the proxy refused the ticket".
- Telling the causes apart needs one extra local call. On macOS the SPNEGO mech answers every local failure (no cache, expired TGT, unknown SPN, KDC down) with the same text, "An unsupported mechanism was requested: unknown mech-code 0" (spike, §8). The plain Kerberos mech (`GSS_MECH_OID_KRB5`) names the real cause: `UNKNOWN_SERVER`, `unable to reach any KDC`, `Matching credential … not found`, or `get-principal open(...)`. So after a SPNEGO failure the negotiator retries once with the krb5 mech, only to sort the cause, and never sends that token.
- Heimdal caches a failed service lookup for 20 minutes ("cached result, timeout in 1188 sec"). After IT adds the SPN, a probe can still fail until that cache runs out. The `needs-ticket` text says so for the unknown-SPN cause.
- It recovers by itself, unlike `tripped`: one probe handshake after 30 s, doubling to 5 min. A **Test** press, `worca proxy test`, or a cache change (5.3) probes at once. A success returns the gate to `verified`.
- `unconfirmed()` strikes and the `MAX_PARALLEL_HANDSHAKES` limit apply as for NTLM.
- `markLoginRejected` and `startTripped` are not used: no saved login, so nothing is written to disk and a restart probes once.

### 5.3 Login watcher

`watchProxyLogin` (`proxy-credentials.mjs:196`) watches `proxy-login.json`. In `kerberos` mode it is not
started, because no saved login exists. Instead:

- For a `FILE:` cache (from `KRB5CCNAME`, or the default `/tmp/krb5cc_<uid>`), the same stat poll on that path triggers an immediate probe while in `needs-ticket`. Other cache types have no file to watch and rely on the backoff probe.
- `isSwappable` (`egress-policy.mjs:147`) is false for `kerberos`, as for Basic and Digest: there is no login to swap in. A switch between `auto` and `kerberos` is a settings change that rebuilds the connector through `swapUpstream()`, after a passing test as today (the `UNTESTED` rule).
- `worca proxy login` / `logout` with `auth: kerberos` say "single sign-on uses your system tickets; nothing to save" and exit 0. The card hides Log in and shows the principal.

### 5.4 Settings, status, Auto-detect

- `AUTH_MODES` and `AUTH_LABELS` gain `kerberos`. `resolveUpstream()` treats it like `none` for credentials (no URL login, no saved login), with a warning when the URL carries one.
- `proxyState` states: `ready` (module loaded, last handshake fine), `needs ticket` (exit 3, like `needs login`), `cannot be used` with "the Kerberos module is not installed (npm rebuild kerberos, or use Px)".
- Auto-detect never chooses the login mode. Unchanged.
- The setup assistant's Network step gets the mode in its list. Its typed-login test path is unused for it.

## 6. Security of using the person's tickets for agent children

What changes and what does not:

1. **No secret at rest.** Kerberos mode stores nothing. The NT hash in `proxy-login.json` (a password equivalent) goes away for these users.
2. **Children ride the identity, as with NTLM today.** Any local process that reaches `127.0.0.1:<port>` reaches the corporate proxy as the person. That is the existing NTLM model (`docs/network-proxy.md`, "Loopback-only access"), and the proxy logs agent traffic under the person's name. Kerberos does not widen it: the token only ever goes on the upstream socket, is bound to `HTTP/<proxy>`, and never crosses to a child.
3. **The cache was already reachable.** Agents run as the same uid. On macOS and Linux they can use the person's cache directly (`curl --negotiate`, `git` with `http.emptyAuth`, `smbclient -k`) against any intranet service, whether or not Worca's Kerberos mode is on. This is the bigger exposure, and it exists today. Worca cannot close it by scrubbing `KRB5CCNAME`: the default cache needs no variable. The places where it is closed are the sandboxes with no cache (containers, E2B). For host runs the doc says this plainly, in the same place as the loopback note.
4. **No delegation.** Never request `GSS_C_DELEG_FLAG` / `ISC_REQ_DELEGATE`, so the proxy never receives a forwardable TGT. A test asserts the flags passed to `initializeClient`.
5. **Opt-in only.** `auto` never tries Kerberos, so turning on the proxy does not start using the person's SSO identity without them choosing it.
6. **Not on shared servers.** Refused under a hosting platform's network policy, and on a multi-user host the card warns, as it already does for loopback.
7. **SPN and DNS.** The SPN comes from the configured host. A library that canonicalises through reverse DNS could ask for a ticket to another `HTTP/` service. That ticket is useful only to that service, which already sees the connection. Low risk, and documented with the `rdns = false` advice for `krb5.conf`.
8. **Logs.** Tokens are never logged. `redactProxyLine` gains the `Negotiate <base64>` pattern (it may already match generic tokens; a test pins it).
9. **Plain-HTTP proxy hop.** The token crosses the LAN in the clear, like NTLM today. The authenticator's timestamp and the proxy's replay cache bound replay to the proxy alone.

## 7. Test strategy

### 7.1 Without a KDC (default suite, every OS)

- `test/upstream-proxy.test.mjs` gets a fake negotiator (`first()`, `step()`, `complete`, `username`, and a configurable local failure). The existing fake upstream gets a `negotiate-kerberos` mode that offers only `Negotiate`, accepts the token `KRB:ok`, rejects `KRB:bad`, and can ask for a second leg (to simulate SSPI NTLM).
- Cases: CONNECT and pooled HTTP log in with one leg; the preemptive token skips the 407; a two-leg exchange; a rejected token enters `needs-ticket` and never resends before the backoff; a local failure never opens an upstream socket; the backoff probe recovers; Test probes at once; a `FILE:` cache change probes at once; `kerberos` never falls back to NTLM, Digest or Basic; `auto` never calls the negotiator; the flags exclude delegation; logs carry no token.
- `negotiate.mjs` gets its own test with the module stubbed: a missing module gives the `cannot be used` state, never a throw at startup; it is imported only in `kerberos` mode (asserted through an import spy).
- Settings, CLI and card tests as for Digest (`settings-network-proxy`, `cli-proxy`, `ui-settings-network-proxy`).

### 7.2 With a dockerised KDC (opt-in, `npm run test:kerberos`, Linux CI job, not in the default shards)

- `docker/test-kerberos/compose.yml`: an MIT krb5 KDC with realm `WORCA.TEST`, a test user principal and `HTTP/proxy.worca.test`, plus Squid with `negotiate_kerberos_auth` and the service keytab, offering only `Negotiate`.
- A client container with Node, `libgssapi_krb5` and the real `kerberos` prebuild. `kinit` with the test principal's password from the compose file's fixtures (test values only), a temp `KRB5_CONFIG` and `KRB5CCNAME=FILE:`.
- Cases: real tunnel to an origin behind Squid; expired ticket (a short `max_life` principal) gives `needs-ticket`, then `kinit` recovers through the file watch; wrong SPN (proxy by IP) gives the SPN text; no TGT at all never reaches Squid (Squid's access log is checked).
- macOS: the same compose stack from the Mac host with a temp `KRB5_CONFIG`. Whether Heimdal's `GSS.framework` honours it is a spike item. If it does not, macOS is a manual check.
- Windows: no domain in CI. A manual checklist on a domain-joined machine against a Kerberos-only proxy, plus the NTLM-fallback case with Kerberos off. Recorded in the PR.

## 8. Spike (run 2026-10-28, macOS arm64 only)

Setup: Homebrew MIT `krb5kdc` 1.x as a user process on `127.0.0.1:18088`, realm `WORCA.TEST`, principals `alice`,
`shorty` (1-minute TGT) and `HTTP/proxy.worca.test` with a keytab. The client is the system Heimdal `kinit` into a
`FILE:` cache under a temp `KRB5_CONFIG`. A Node CONNECT proxy that offers only `Negotiate` checks each token with
`kerberos.initializeServer` against the keytab, so the acceptor is real Kerberos, not a fake. Everything lived in
the session scratchpad and was stopped afterwards. Nothing is in the repo.

The Lima VM that has Docker was in an error state, so the Linux and Squid parts did not run. Windows was not run
either (no Windows machine).

| Check | Result |
|---|---|
| Install, macOS arm64 | Prebuild downloaded (universal binary). It links `/System/Library/Frameworks/Kerberos.framework` only. 37 packages, 2.5 MB |
| Install, dead proxy | prebuild-install honours npm's proxy settings and fails with `ECONNREFUSED`. It still exits 0 and leaves no binary |
| Install, `--ignore-scripts` | No binary. `import('kerberos')` fails: `MODULE_NOT_FOUND … ../build/Debug/kerberos.node` |
| Source build fallback | `node-gyp rebuild` builds in 18 s with Xcode CLT (after it fetched the Node headers) |
| `kinit` works with Heimdal against MIT KDC, `FILE:` cache, temp `KRB5_CONFIG` | Yes. The macOS test path in 7.2 works without Docker |
| SPNEGO token, first call | 1104 bytes, 38 ms, one TGS-REQ. Later calls: about 10 ms from the cached service ticket, no KDC traffic |
| CONNECT through the Negotiate proxy | 407, then one leg with the token, then 200; 85 ms cold, 18 ms warm. The proxy's acceptor sees `alice@WORCA.TEST`. The tunnel carries data |
| Mutual token | The proxy returns 32 bytes. After `client.step(it)`: `contextComplete: true`, `username: 'alice@WORCA.TEST'`. Before that, `username` is `null` |
| Delegation | `flags: 0`: 1104 bytes. `GSS_C_DELEG_FLAG`: 2140 bytes plus a second TGS-REQ, so the TGT is forwarded. Keep `0` |
| No cache, expired TGT, unknown SPN, KDC down without a cached ticket | SPNEGO: the same opaque text every time. KRB5 mech: a distinct cause each time (5.2) |
| KDC down, service ticket already cached | Token still built. A down KDC only hurts the first connection after a ticket expires |
| SPN by IP (`HTTP@127.0.0.1`) | `UNKNOWN_SERVER … 'HTTP/127.0.0.1@0.0.1'`: Heimdal takes a realm from the IP's last labels. Configuring the proxy by IP cannot work, as 5.1 says |
| `kinit` again | Replaces the cache file (new inode, new mtime), so the stat poll in 5.3 sees it. The next token works at once |
| SPNEGO mech list (macOS) | Kerberos plus a Heimdal-private mech (`1.2.752.43.14.3`). No NTLM, as 3 assumes for macOS |

Still open, for a second spike once Docker is back:

1. Linux x64 and arm64 (glibc and slim): whether the prebuild loads without `libgssapi_krb5.so.2` and with what error, and the same flow against the compose KDC with Squid's `negotiate_kerberos_auth` (7.2).
2. Windows x64 on a domain-joined machine: SSPI Negotiate with Kerberos, and with NTLM fallback.
3. Whether Squid takes the token as is (it should take a SPNEGO-wrapped AP-REQ).

## 9. Open questions for Sinisha

1. Is a native optional dependency acceptable in `@worca/app`? If not: stay with Px and only sharpen the 407 text (section 3, last paragraph).
2. Windows: should `kerberos` mode be the recommended mode on domain-joined Windows even for NTLM proxies, since SSPI then needs no saved login at all?
3. Should the card offer **Single sign-on** only when the module loads, or always, with a "not installed" state?
4. Is the `needs-ticket` backoff (30 s doubling to 5 min) acceptable, or should it wait for a Test press, like `needs login`?
