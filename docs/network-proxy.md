# Network proxy

Use Worca behind a corporate proxy that asks for an NTLMv2 login. This is an experimental
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
2. Open Settings › Network proxy (Advanced level). Enter the proxy host and port, choose
   **Login: NTLMv2**, list the hosts that go direct, and change the timeouts if you need to.
   Press **Save**.
3. Restart Worca. The proxy host, port, login mode, direct hosts and timeouts are read at startup.

You can also set the same values by hand in `settings.json` under `networkProxy` (`upstream`,
`auth`, `noProxy`, `timeouts`). When no upstream is set there, Worca uses the `HTTPS_PROXY` /
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

Not supported. Run [Px](https://github.com/genotrance/px) with your Windows session, point
`HTTPS_PROXY` at it, and leave the `corporateProxy` flag off.

## Troubleshooting

- **The proxy offers only Basic.** NTLMv2 (`auto`) never falls back to Basic. Set
  `networkProxy.auth` to `basic` and keep the login in `HTTPS_PROXY`. Basic sends the password in
  cleartext on every connection.
- **PAC or WPAD.** Not supported. Ask your IT team for the proxy host and port, and enter them in
  Settings › Network proxy.
- **"proxy-login.json can be read by other users".** The file's mode changed (a backup restore, a
  copy). Run `worca proxy login` again.
