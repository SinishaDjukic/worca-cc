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
| Linux | GNOME `gsettings org.gnome.system.proxy`: mode `auto` (its PAC URL, or WPAD) or `manual` | host and port; with a manual proxy also `ignore-hosts` |

- With several proxies in the answer, the first fills in and the line names the others. A PAC answer that goes
  `DIRECT` says no proxy is needed. SOCKS entries are skipped: Worca chains to an HTTP proxy only.
- The bypass list comes only from a manual setting: a PAC file's direct rules are code, not a list. IP ranges
  (`169.254/16`) and Windows' `<local>` are left out, since Worca's no-proxy hosts never match them.
- Login mode, account and timeouts are never detected.
- **A PAC file never runs inside Worca.** Worca fetches it (http, https or file; at most 1 MB, 4 s, without the
  proxy) and evaluates it in a separate `node --permission` process that can read no file but its own script and
  start no process, with a 64 MB heap and a 4-second limit. That process asks Worca for each DNS lookup the script
  makes. Date and time rules (`dateRange`, `timeRange`) count as always in range.
- `GET /api/proxy/detect` answers `{ found, source: pac | wpad | manual | none | error, host?, port?, noProxy?,
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
