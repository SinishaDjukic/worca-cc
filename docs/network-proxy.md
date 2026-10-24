# Network proxy

Use Worca behind a corporate proxy that asks for an NTLMv2 login (also inside Negotiate), or a Digest
or Basic login. This is an experimental
feature behind the `corporateProxy` flag. For the flag itself, see
[Feature flags › Corporate proxy](feature-flags.md#corporate-proxy).

## What it does

With the flag on, Worca starts a local proxy on `127.0.0.1`. That proxy logs in to your corporate
proxy. Every process Worca starts (agents, git, MCP servers, plugins, chat channels) and Worca's own
outbound requests get `HTTPS_PROXY` / `HTTP_PROXY` = `http://127.0.0.1:<port>`, a URL with no
credentials in it. Hosts in your `NO_PROXY` list and loopback go direct.

The local proxy accepts connections from this machine only, like Px and CNTLM. It asks for no
token, so any local process can use your corporate login through it. On a shared multi-user host,
every local user can do that too.

## Set it up

1. Turn the flag on: `worca flags on corporateProxy`.
2. Open Settings › Runs › Network proxy (Advanced level). Enter the proxy host and port, choose
   **Login: NTLMv2**, list the hosts that go direct, and change the timeouts if you need to.
   Press **Save**.
3. Restart Worca. The proxy host, port, login mode, direct hosts and timeouts are read at startup.

You can also set the same values by hand in `settings.json` under `networkProxy` (`upstream`,
`auth`, `noProxy`, `timeouts`, `fixedPort`). When no upstream is set there, Worca uses the `HTTPS_PROXY` /
`HTTP_PROXY` that was set when it started.

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
`networkProxy.timeouts.idleMs` (default 10 minutes) is closed, and the next request logs in again.

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
**Local proxy port** on the card, then restart Worca. `worca proxy status` then prints
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
`HTTPS_PROXY`. With the flag on, Worca also sets `WORCA_CORPORATE_PROXY_URL` for its children, and
the run assets that start a browser pass it on: Playwright launches get `proxy.server`, raw Chrome
launches `--proxy-server`, with your `NO_PROXY` hosts as the bypass list. With the flag off, browser
launches are unchanged.

## Check it

`worca proxy status` prints the proxy, the saved login and its state:

| State | Meaning | Exit code |
|---|---|---|
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

- **Read**: `get_network_proxy` reports whether the flag is on, the saved settings, the proxy in use and where it came
  from (settings, or `HTTPS_PROXY` / `HTTP_PROXY` at start), the local proxy URL and its status, who is logged in
  (`DOMAIN\user`; whether the login was rejected), whether a restart is needed and why, and the live proxy's state.
  It never sees the password or the saved hash.
- **Test**: `test_network_proxy` runs the same check as the Test button, with the same rules: one test at a time,
  and no test of a proxy saved since Worca started (restart first, so the saved login is never sent to a host the
  running proxy does not use yet). A login the proxy rejects is marked "needs login".
- **Change**: the assistant proposes a card with each setting before → after and "Restart Worca to apply". Nothing
  changes until you press Apply; Apply saves exactly as the Save button does.
- **Turn it on**: with the flag off, the assistant can offer a card that turns on Labs › Corporate proxy (then restart).
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
`HTTPS_PROXY` at it, and leave the `corporateProxy` flag off.

## Troubleshooting

- **The proxy offers only Basic.** NTLMv2 (`auto`) never falls back to Basic. Set
  `networkProxy.auth` to `basic` and keep the login in `HTTPS_PROXY`. Basic sends the password in
  cleartext on every connection.
- **The proxy offers only Digest.** Set `networkProxy.auth` to `digest` and keep the login in
  `HTTPS_PROXY`.
- **The fixed port cannot be used on Windows (EACCES).** Hyper-V and WSL reserve port ranges. List
  them with `netsh interface ipv4 show excludedportrange protocol=tcp` and pick a port outside them.
- **PAC or WPAD.** Not supported. Ask your IT team for the proxy host and port, and enter them in
  Settings › Runs › Network proxy.
- **"proxy-login.json can be read by other users".** The file's mode changed (a backup restore, a
  copy). Run `worca proxy login` again.
