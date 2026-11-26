# Network proxy

Use Worca behind a corporate proxy that asks for an NTLMv2 login (also inside Negotiate), or a Digest
or Basic login. Turn it on with **Use a corporate proxy** in Settings › Runs › Network proxy
(`networkProxy.enabled` in `settings.json`). It used to be the Labs flag `corporateProxy`: an install
with that flag on gets `networkProxy.enabled: true` on first start.

## What it does

With the proxy on, Worca starts a local proxy on `127.0.0.1`. That proxy logs in to your corporate
proxy. Every process Worca starts (agents, git, MCP servers, plugins, chat channels) and Worca's own
outbound requests get `HTTPS_PROXY` / `HTTP_PROXY` = `http://127.0.0.1:<port>`, a URL with no
credentials in it. Hosts in your `NO_PROXY` list and loopback go direct.

The local proxy accepts connections from this machine only, like Px and CNTLM. It asks for no
token, so any local process can use your corporate login through it. On a shared multi-user host,
every local user can do that too.

### A login in `HTTPS_PROXY`

When `HTTPS_PROXY` or `HTTP_PROXY` carries a user name and password
(`http://ACME%5Cjdoe:password@proxy.acme.example:8080`) and `networkProxy.enabled` is not set, Worca
starts the local proxy anyway, with that URL as the corporate proxy (an `upstream` left in `settings.json`
is not used then). Without this, every agent,
script, terminal and git process would get the password, and plugins and chat channels would get no
proxy at all. The boot line says `started because HTTP(S)_PROXY carries a login`.

With the proxy started this way and `networkProxy.auth` unset, the login is sent as NTLMv2 when the
corporate proxy offers it. Otherwise it is sent as Digest, else Basic, the way the programs that read
`HTTPS_PROXY` sent it before. A proxy you turned on yourself never falls back like this (see `auth`
below).

Set `networkProxy.enabled` to `false` to keep the proxy off. Agents, scripts, plugins and chat channels
then get no proxy URL and go direct, so none of them gets the password. Terminals, git and actions
keep your `HTTPS_PROXY` unchanged. Worca prints a warning at start. Remove `enabled` again and the
proxy starts within a few seconds, without a restart. With the proxy off, any proxy variable that
carries a login (`ALL_PROXY` and the tool-specific ones too) is withheld from agents and scripts.

## Set it up

1. Open Settings › Runs › Network proxy and turn on **Use a corporate proxy**.
2. Enter the proxy host and port, or press **Auto-detect** to fill them in from this machine's own proxy
   settings (see [Auto-detect](#auto-detect)). Choose **Login: NTLMv2** and list the hosts that go direct. The
   timeouts and the local proxy port are under **More**.
3. Press **Test**, then **Save**. Save tests a new proxy itself when you have not: Worca switches to
   a new proxy only after it passed a test. New connections use it at once.

### Auto-detect

**Auto-detect** (the card, and the setup assistant's Network step) asks this machine which proxy it uses for
`api.anthropic.com` and fills in the host and port. It only fills the form: **Test** and **Save** work as for typed
values, and Worca still chains to that one fixed proxy.

| OS | Where it looks | What it can fill |
|---|---|---|
| macOS | `scutil --proxy`: a PAC URL, then auto-discovery (`http://wpad/wpad.dat`), then a manual HTTPS (or HTTP) proxy | host and port; with a manual proxy also the bypass list |
| Windows | Windows PowerShell's `GetSystemWebProxy` (the system's own PAC, WPAD and manual resolver); the registry says which it was | host and port; with a manual proxy also `ProxyOverride` |
| Linux | In order, until one finds a proxy (or a PAC that goes direct): under WSL, Windows itself (see below); GNOME `gsettings org.gnome.system.proxy`, mode `auto` (its PAC URL, or WPAD) or `manual`; KDE's `kioslaverc` through `kreadconfig6` (or `kreadconfig5`), `ProxyType` 1 manual, 2 PAC URL, 3 WPAD or 4 "use the environment"; last, the `HTTPS_PROXY` / `HTTP_PROXY` Worca started with | host and port; with a manual proxy also `ignore-hosts` / `NoProxyFor`; from the variables also `NO_PROXY` |

- **WSL** (`WSL_DISTRO_NAME`, or a Microsoft kernel in `/proc/version`): Worca asks Windows through interop the
  same way it does on Windows, once, within 15 seconds: `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`,
  else `powershell.exe` from the Windows `PATH` WSL appends. A Windows proxy on `127.0.0.1` is reachable from WSL
  only in mirrored networking mode, so that answer is used only when no Linux source finds a proxy, and its line
  says so.
- **KDE** with *Only use proxy for entries in this list* (`ReversedException`) proxies only the listed hosts: unless
  `api.anthropic.com` matches one, the answer is that no proxy is needed. A PAC setting that is a bare path is read
  as a local file.
- **The variables** (source `env`) are the ones Worca was started with, before its own local proxy took
  `HTTPS_PROXY`: Auto-detect never offers Worca's own `127.0.0.1` address. A login in the URL is dropped, and a
  `socks5://` (or any non-`http://`) value is skipped. In a
  container this is the only source there is: the host's desktop settings cannot be read from inside it.
- With several proxies in the answer, the first fills in and the line names the others. A PAC answer that goes
  `DIRECT` says no proxy is needed. SOCKS entries are skipped: Worca chains to an HTTP proxy only.
- The bypass list comes only from a manual setting: a PAC file's direct rules are code, not a list. IP ranges
  (`169.254/16`) and Windows' `<local>` are left out, since Worca's no-proxy hosts never match them.
- Login mode, account and timeouts are never detected.
- **A PAC file never runs inside Worca.** Worca fetches it (http, https or file; at most 1 MB, 4 s, without the
  proxy) and evaluates it in a separate `node --permission` process that can read no file but its own script and
  start no process, with a 64 MB heap and a 4-second limit. That process asks Worca for each DNS lookup the script
  makes. Date and time rules (`dateRange`, `timeRange`) count as always in range.
- `GET /api/proxy/detect` answers `{ found, source: pac | wpad | manual | env | none | error, host?, port?, noProxy?,
  also?, pacUrl?, direct?, line }`. It never answers an error status: a setting it cannot read is `found: false`
  with a line.

You can also set the same values by hand in `settings.json` under `networkProxy` (`enabled`,
`upstream`, `auth`, `noProxy`, `timeouts`, `fixedPort`). When no upstream is set there, Worca uses the `HTTPS_PROXY` /
`HTTP_PROXY` that was set when it started.

## Changes apply live

- New connections use the new proxy at once; a connection that is already open finishes on the old
  one. Children keep the same `HTTPS_PROXY` (the local proxy), so nothing has to restart.
- Turning the proxy on starts the local proxy now. Agents already running keep a direct route until
  their next step. Turning it off sends new connections direct through the same local address.
- Other Worca processes (a `worca run` started from a shell) pick up a change within about 1 s.
- A new `fixedPort` takes effect at once. A running local proxy starts listening on the new port too, and new
  agents and terminals get it; programs that already hold the old port keep using it until Worca restarts, when
  only the new port is opened. A local proxy that this save starts (the proxy was off, as on a first setup) opens
  only the new port. A port another program already uses is refused at once ("saved, but the local proxy cannot
  listen on …"), and the proxy stays on the port it had.
- A save from Worca (the card, the chat card) needs a passing test of exactly those values (host,
  port and login mode) within 10 minutes, or it is refused with `UNTESTED` and nothing is written.
  Turning the proxy off, and changing only the direct hosts, timeouts or the local port, need no test.
  A hand edit of `settings.json` is applied without a test: the file is yours.
- A host that does not resolve leaves the running proxy in place; the save says why.
- A `settings.json` that is not valid JSON, or is deleted, is ignored by running processes until
  the next start. A valid file without a `networkProxy` key reads as off, and every running process
  goes direct.
- "Saved. New connections use it now." covers new connections from Worca itself and new agent steps;
  an agent step that is already running keeps its route until it ends.
- `POST /api/proxy/test` takes `{ networkProxy }`, the values to test merged over the saved ones;
  without it, it tests the saved values. It also takes an optional `login: { domain, user, password }`, the
  login typed in the setup assistant's Network step: the test uses it instead of the saved login, so a fresh
  install behind an NTLM proxy can pass before any login is saved. That login is checked like a saved one (a
  bad field is a 400 on `login.<field>`; with `auth` Basic or Digest it is refused, because a saved login
  keeps only the NT hash), held in memory for that one test, and never written or logged; its NT hash goes only
  to the proxy under test. Its pass counts only for that account: saving the same proxy with another login (or
  with none, so the saved one) needs its own test. The chat's test never takes a login. Both `/api/proxy/test` and `PUT /api/proxy/settings` take
  `application/json` bodies only.

## Settings reference

- **Who it is for:** a network with one fixed corporate proxy (host and port known) that asks for an NTLMv2 (also inside Negotiate), Digest or Basic login. A network that publishes a PAC or WPAD script works when that script picks one fixed HTTP proxy: **Auto-detect** reads it and fills in the host and port.
- **`networkProxy` in `settings.json`:** `upstream` (an `http://host:port` URL; default: the `HTTPS_PROXY`/`HTTP_PROXY` that was set), `auth` (default `auto` when the URL carries a login, else `none`), `noProxy` (a comma-separated string or a list; default: the `NO_PROXY` that was set; `*.x` means `.x`, `*` sends everything direct, CIDR entries never match; loopback always goes direct) `timeouts` `{ connectMs, authMs, idleMs }` (defaults 60000, 60000 and 300000, each clamped to 500–3600000) and `fixedPort` (1024–65535: the local proxy listens on `127.0.0.1:<fixedPort>` instead of a free port picked at each start, which is what an empty field means, so an IDE or shell outside Worca can use it; read only with the proxy on), and `enabled` (`true` turns the proxy on). Edit them in Settings › Network proxy or by hand; a change applies to new connections at once; a new `fixedPort` is listened on at once too, and the old port keeps answering until the next start.
- **Where the login comes from:** from `worca proxy login` / Settings › Network proxy (saved NT hash), else `DOMAIN%5Cuser:password@` in `HTTP(S)_PROXY` (`http://ACME%5Cjdoe:password@proxy.acme.example:8080`). A saved login wins over the URL's, with a warning. A user name or password in `settings.json` is ignored with a warning, because a password never goes into `settings.json`. See [Network proxy](network-proxy.md).
- **`auth` values:** `auto` (the default, NTLMv2 only, sent inside `Negotiate` when the proxy offers only that), `ntlm` (the same), `digest`, `basic` and `none`. `basic` sends the password base64-encoded, in cleartext, to the proxy on every connection; use it only when the proxy offers nothing else. `digest` (RFC 7616: SHA-256 or MD5, `qop=auth`) needs the password from the `HTTPS_PROXY` URL, which Worca then keeps in memory; a saved login cannot be used. `auto` never falls back to Basic or Digest: a proxy that offers only one of them gets a 502 that says to set `networkProxy.auth`.
- **The "proxy needs login" stop:** after one rejected login (or a connection dropped or left unanswered right after one) Worca stops sending credentials, and clients get a 407 with `x-worca-proxy: needs-login`. Log in again (`worca proxy login` or Settings › Network proxy). For a saved login, the rejection is saved with the login, so a restart does not try the same password again; a new login clears it, in every running Worca within a few seconds. A login in `HTTPS_PROXY` keeps no such memory: correct the URL, then restart Worca, because each restart with the old password spends one attempt against the account lockout limit.
- **Loopback-only access:** any local process can use the local proxy, the same as Px and CNTLM. On a shared multi-user host every local user and every agent child can use your corporate login through it; set `WORCA_EGRESS_MODE` to limit where untrusted children may connect. With `WORCA_EGRESS_MODE` set, the policy decides first and allowed hosts are forwarded to the corporate proxy.
- **Plain HTTP:** NTLM logs in a connection once, with a `HEAD` probe, and later plain `http://` requests reuse it until it has been idle for `timeouts.idleMs`; when the proxy does not ask for a login, that `HEAD` reaches the site once. Basic and Digest send their header with each request.
- **Browsers in runs:** the promo kit's Playwright and Chrome launches get the local proxy explicitly (`proxy.server`, `--proxy-server`), because Chrome does not reliably honour `HTTPS_PROXY`. They read `WORCA_CORPORATE_PROXY_URL`, which Worca sets for its children only while the proxy is on.
- **Kerberos or single sign-on:** not supported. [Px](https://github.com/genotrance/px) logs in with your Windows session; point `HTTPS_PROXY` at Px instead and leave the corporate proxy off.

## Log in once

```sh
worca proxy login
```

Worca asks for `DOMAIN\user`, then for the password at a hidden prompt. In a script, pipe both on
stdin (line 1 the account, line 2 the password):

```sh
printf 'ACME\\jdoe\n%s\n' "$PW" | worca proxy login
```

`worca proxy login --user ACME\jdoe` reads only the password. A password on the command line
(`--password`) is refused, because it would land in your shell history and in `ps`.

The **Log in** button on the Settings card does the same.

**What is stored:** the domain, the user name and the NT hash of the password, in
`<WORCA_HOME>/proxy-login.json` (`~/.worca-cc/proxy-login.json` by default). The password itself is
never stored. The NT hash is still a password equivalent for NTLM: anyone who copies the file can
log in to the proxy as you (pass-the-hash). Worca therefore protects the file like an ssh private
key:

- On macOS and Linux the file is mode `0600`. Worca refuses to use it if it is a symlink, belongs
  to another user, or can be read by group or others. Run `worca proxy login` again to rewrite it.
- On Windows the file gets an ACL that grants full control to you alone, with inherited entries
  removed.

Every start of Worca uses the saved login. A running Worca (the UI server or a CLI run) picks up a
new login, or a deleted one, within a few seconds without a restart.

A saved login wins over a user name and password in the `HTTPS_PROXY` URL; Worca prints a warning
when it overrides one. `worca proxy logout` deletes the saved login, and Worca falls back to the
URL's login, if there is one.

With `networkProxy.auth` set to `none`, the saved login is never sent. With `auth` set to `basic`,
it cannot be used: Basic needs the password, and the file holds only the hash. Keep a Basic login
in `HTTPS_PROXY` (`http://ACME%5Cjdoe:password@proxy.acme.example:8080`), or switch to NTLMv2.

## Kept-alive connections

NTLM and Negotiate log in a connection, not a request. For plain `http://` requests (`apt`, `pip`,
`npm` metadata) Worca logs a connection in once, with a `HEAD` probe to the first URL, and later
requests reuse it without sending credentials again. A connection that stays idle for longer than
`networkProxy.timeouts.idleMs` (default 5 minutes) is closed, and the next request logs in again.

- When the proxy forgets a connection's login and asks again, that is not a rejected password. A
  request without a body is sent once more on a fresh login; a request with a body gets a `502`
  ("asked for a login again on a kept-alive connection; send the request again").
- When the proxy forgets the login again right after that fresh login, or closes the connection
  after every login, Worca logs in per request from then on (one line in the log), and that one
  request gets a `502`.
- A new login, a logout or a "proxy needs login" stop closes every connection of the old login.

## Negotiate and Digest

- **Negotiate.** A proxy that offers only `Negotiate` (IIS, ISA/Forefront, some Squid builds) gets
  the same NTLMv2 login wrapped in `Negotiate`, as Px and CNTLM send it. Worca remembers which
  wrapper worked. Kerberos is not supported: a proxy that accepts only Kerberos tickets rejects the
  NTLM login once, and Worca stops with "proxy needs login".
- **Digest.** Set `networkProxy.auth` to `digest` (or choose **Login: Digest** on the card) and keep
  the login in `HTTPS_PROXY` (`http://ACME%5Cjdoe:password@proxy.acme.example:8080`). Worca keeps
  that password in memory to answer each challenge (SHA-256 preferred, then MD5, `qop=auth`). A saved
  login cannot be used, because it holds only the NT hash. `auto` never answers a Digest-only proxy.
  A challenge that says the nonce went stale gets a `502` ("send the request again") and never
  counts as a rejected password.

## A fixed local port

By default the local proxy listens on a free port picked at startup. To use it from an IDE or a shell
outside Worca, pin it: set `networkProxy.fixedPort` (1024–65535) in `settings.json`, or fill in
**Local proxy port** under **More** on the card; it takes effect at once. `worca proxy status` then prints
`Local proxy: http://127.0.0.1:<port>`. Without a fixed port it says a free port is picked at
startup.

- If another program already uses the port, Worca says so at startup ("the local proxy cannot listen
  on 127.0.0.1:3128: another program already uses that port (EADDRINUSE). Free the port or change
  networkProxy.fixedPort"), shows it on the card, and runs without the corporate proxy. Under a
  hosting platform's network policy, startup stops with that message.
- If the port is held by another Worca (the UI, while you start `worca run` from a shell), this one
  uses a free port of its own and the boot line says "served by another Worca".
- A fixed port is predictable: any local process can use it, and while Worca restarts its proxy
  another process could take the port first and receive the plain-HTTP traffic of tools pointed at
  it. It never receives your credentials.

## Browsers in runs

Chrome takes its proxy from the OS settings or its own flags and does not reliably honour
`HTTPS_PROXY`. With the proxy on, Worca also sets `WORCA_CORPORATE_PROXY_URL` for its children, and
the run assets that start a browser pass it on: Playwright launches get `proxy.server`, raw Chrome
launches `--proxy-server`, with your `NO_PROXY` hosts as the bypass list. With the proxy off, browser
launches are unchanged.

## Check it

`worca proxy status` prints the proxy, the saved login and its state:

| State | Meaning | Exit code |
|---|---|---|
| off | the proxy is off (`networkProxy.enabled`) | 1 |
| ready | a login is saved and has not been rejected | 0 |
| no login saved | the proxy is set up, but there is no login | 0 |
| needs login | the corporate proxy rejected the saved login | 3 |
| not set up | no corporate proxy is configured | 1 |
| cannot be used | the proxy setting is not valid | 1 |

`worca proxy test` connects to `github.com` and `api.anthropic.com` through the corporate proxy and
prints `OK` or `FAIL` for each. It exits 0 only when both are OK. The **Test** button on the card
runs the same check. A wrong password costs one login attempt for the whole test.

Both commands take `--json`.

## From Chat

The Chat assistant can read, test and change the proxy settings for you, the way it handles Away mode and Actions:

- **Read**: `get_network_proxy` reports whether the proxy is on, the saved settings, the proxy in use and where it came
  from (settings, or `HTTPS_PROXY` / `HTTP_PROXY` at start), the local proxy URL and its status, who is logged in
  (`DOMAIN\user`; whether the login was rejected), and the live proxy's state.
  It never sees the password or the saved hash.
- **Test**: `test_network_proxy` runs the same check as the Test button, on the saved values only (never values the
  chat chose), one test at a time. Its pass never counts for the `UNTESTED` rule. A login the proxy rejects is marked
  "needs login".
- **Change**: the assistant proposes a card with each setting before → after and "New connections use it now." Nothing
  changes until you press Apply; Apply tests a new proxy first, then saves exactly as the Save button does.
- **Turn it on**: with the proxy off, the assistant can offer a card that sets `networkProxy.enabled: true`.
- **Log in and out yourself**: the chat never asks for, takes or repeats your password. Use Log in / Log out on
  Settings › Runs › Network proxy, or `worca proxy login` / `worca proxy logout`.

Under agent isolation the assistant can read the proxy status but not test it; use the Test button through Worca's
published address.

## "proxy needs login"

When the corporate proxy rejects the login once, Worca stops sending credentials at once, so a
wrong password cannot lock your account. Clients then get a 407 with the text "proxy needs login".

- The stop is saved with the login, so it survives restarts: a supervisor that restarts Worca in a
  loop does not try the same password again.
- A new `worca proxy login` (or Log in on the card) clears it in every running Worca within a few
  seconds.
- `worca proxy logout` deletes the login and the stop together.

A login kept in `HTTPS_PROXY` has no saved stop. Correct the URL, then restart Worca.

## Windows notes

- Check the ACL with `icacls %USERPROFILE%\.worca-cc\proxy-login.json`. It lists one entry, for
  you.
- The ACL names `USERDOMAIN\username`. Run Worca as the same Windows account that saved the login.
- Piping `Read-Host -AsSecureString` into `worca proxy login` is not supported in PowerShell. Use
  the hidden prompt.
- With a roaming profile, the file roams with `%USERPROFILE%`. Point `WORCA_HOME` at a local
  folder if your policy does not allow that.

## Kerberos or single sign-on

Not supported (Negotiate works only with the NTLM login inside it). Run [Px](https://github.com/genotrance/px) with your Windows session, point
`HTTPS_PROXY` at it, and leave the corporate proxy off.

## Worca in a container

In a container setup the proxy login lives in the **egress sidecar**, not in
Worca's box. The sidecar is a second container from the same image. It runs
`worca egress`. It relays every outbound connection and logs in to the
corporate proxy for all of them: the box's agents, git, Worca itself, and the
credential broker's calls to the model providers. The box gets
`HTTPS_PROXY=http://egress:3128`, a URL with no credentials in it.

`worca container` starts the sidecar by itself when the proxy needs a login:

- `HTTPS_PROXY` in the container `.env` carries a user name and password, or
- this machine's `networkProxy.upstream` needs a login, or
- you ran `worca container proxy login` once.

It adds `compose.proxy.yml`, writes `WORCA_EGRESS_SECRET` into `.env`, and
checks that the image has the sidecar. An image that is too old is refused
with one line, and nothing starts. The sidecar runs in open mode: it allows
every host and only does the login. The [egress allowlist](docker.md#egress-allowlist)
stays a separate choice on top.

Log in from the host:

```sh
worca container proxy login          # DOMAIN\user, then a hidden password prompt
printf 'ACME\\jdoe\n%s\n' "$PW" | worca container proxy login
worca container proxy status         # who is logged in, and the state
worca container proxy test           # CONNECT to github.com and api.anthropic.com
worca container proxy logout
```

`worca container run -- proxy login` works too. Inside the box `worca proxy`
talks to the sidecar. Nothing is written in the box.

The Settings card and the setup assistant work as before. Worca forwards
Status, Test, Log in, Log out, Save and Auto-detect to the sidecar. The
password passes through Worca's server in memory for that one call, and is
then dropped. A line under the card says that the sidecar holds the login.
There is no local proxy port in a container, so that field is gone. Auto-detect
fills in the proxy the sidecar uses. Chat's proxy tools use the same path.

**What the sidecar keeps.** The same record as the native install (domain,
user name, NT hash, never the password), with the same file guards, in
`/worca/egress/proxy-login.json` on its own volume `egress-data`. Only the
sidecar mounts that volume. The record also names the proxy it was saved for.
A change of the proxy host or port deletes the login, so it never goes to
another proxy. The lockout breaker ("proxy needs login") works as in the
native install. A Basic or Digest login in the `.env` `HTTPS_PROXY` URL goes to
the sidecar's environment only.

**The sidecar's internal API.** Worca's box reaches it at
`http://egress:3129` with the shared secret `WORCA_EGRESS_SECRET` (or
`WORCA_EGRESS_SECRET_FILE`). Worca reads the secret once at start and removes
it from its environment, so no agent or other child inherits it. The API never
returns the NT hash or a password. Neither port is published.

**Moving an older login.** A `proxy-login.json` that an older version saved
in the box moves to the sidecar the first time the box starts next to it, and
is then deleted from the box. After that, a rollback to an older image needs
a new login.

**No sidecar.** If you run `docker compose up` by hand without
`compose.proxy.yml`, the login stays in the box as before, and Worca prints
one warning at start.

For a proxy that re-signs TLS, set `WORCA_CA_CERT` in the container `.env` to
the CA's PEM file. See [docker.md → Corporate proxy and CA](docker.md#corporate-proxy-and-ca).

This was tested against a simulated NTLM proxy (`test/helpers/fake-upstream-proxy.mjs`),
not a real corporate one.

### A login the operator manages

On a shared instance the login is a technical user's. The operator can supply
it as a file, so nobody types it into the UI:

```sh
worca proxy hash > proxy-login.secret.json   # asks for DOMAIN\user and the password; saves nothing
chmod 600 proxy-login.secret.json
```

The file holds `{"v":1,"domain":…,"user":…,"ntHash":…}`, never the password.
Mount it into the sidecar and point `WORCA_EGRESS_LOGIN_FILE` at it, for
example in a `compose.override.yml`:

```yaml
services:
  egress:
    environment:
      WORCA_EGRESS_LOGIN_FILE: /run/secrets/proxy_login
    secrets: [proxy_login]
secrets:
  proxy_login:
    file: ./proxy-login.secret.json
```

The sidecar runs as uid 1000, so the file must be readable by that uid. The
proxy then comes from the sidecar's `HTTPS_PROXY` alone. Every write call is
off: log in, log out and the proxy settings answer "managed by the operator".
The Settings card and the setup assistant's Network step show who is logged
in and the state, with no login form, and say that the operator manages the
login. Test still works.
`worca proxy status` shows who is logged in and the state.

## Where the login lives

| Setup | Where the proxy login is stored | Can agents read it? |
| --- | --- | --- |
| Native | `~/.worca-cc/proxy-login.json` | Yes. Agents run as you. |
| Hardened box | In the egress sidecar, on its own volume | No. The box has no copy, and the API never returns it. |
| Shared instance | In the egress sidecar: a technical user's login, optionally managed by the operator (`WORCA_EGRESS_LOGIN_FILE`) | No, as in the hardened box. |
| Plain container (`worca container up`) with a proxy login | In the egress sidecar, which starts by itself, in open mode | No. The box has no copy. |
| Plain container without the sidecar (raw `docker compose up`) | In the box, `/worca/.worca-cc/proxy-login.json`, with a warning at start | Yes, unless agent isolation is on. |

In the hardened box and the shared instance, agents still send their traffic
through the sidecar, which is logged in. That is the point of the proxy. With
agents under their own users they also cannot read the sidecar's shared
secret. Without that, an agent that reads it from Worca's process could log
the sidecar out or change its proxy settings, but still never read the login.
A Railway instance normally has no corporate proxy in front of it, so it has
no sidecar.

- Local sandbox (Docker): arrives in a later release. The login stays with Worca on the server and never enters the sandbox.
- E2B sandbox: arrives in a later release. The login stays with Worca on the server and never enters the sandbox.

To compare the setups, see [Choose a setup](choose-a-setup.md) and the [Security overview](security-overview.md).

## Troubleshooting

- **The proxy offers only Basic.** NTLMv2 (`auto`) never falls back to Basic. Set
  `networkProxy.auth` to `basic` and keep the login in `HTTPS_PROXY`. Basic sends the password in
  cleartext on every connection.
- **The proxy offers only Digest.** Set `networkProxy.auth` to `digest` and keep the login in
  `HTTPS_PROXY`.
- **The fixed port cannot be used on Windows (EACCES).** Hyper-V and WSL reserve port ranges. List
  them with `netsh interface ipv4 show excludedportrange protocol=tcp` and pick a port outside them.
- **PAC or WPAD.** Press **Auto-detect**: it reads the script and fills in the proxy it picks for
  `api.anthropic.com`. If it says it couldn't read the PAC file, or the script picks only SOCKS, ask your IT team
  for the proxy host and port and enter them by hand.
- **"proxy-login.json can be read by other users".** The file's mode changed (a backup restore, a
  copy). Run `worca proxy login` again.
