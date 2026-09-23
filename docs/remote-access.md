# Remote access behind an identity proxy

Worca is a single-user tool that runs agents able to execute shell commands and edit files. By
default it only answers requests addressed to `localhost`, and it has no login of its own. This
page covers the one supported way to reach it from elsewhere: behind **Cloudflare Access**, with
worca checking the Access token on every request itself.

Nothing here changes a local install. With none of the variables below set, worca behaves exactly
as before.

## How it fits together

```
browser ──► Cloudflare Access ──► Cloudflare Tunnel ──► cloudflared ──► worca
            (you sign in)          (no public port)      (its own          checks Host/Origin,
                                                          container)        then the Access token
```

Two independent layers:

1. **Network.** Worca has no public address. `cloudflared` dials out to Cloudflare, so the tunnel
   is the only way in.
2. **Identity.** Cloudflare signs a short-lived token (`Cf-Access-Jwt-Assertion`, RS256) for every
   request it lets through, WebSocket upgrades included. Worca verifies the signature against your
   team's public keys, plus the issuer, the application's `aud` tag and the expiry. A request
   without a valid token gets a 401, even if it somehow reached worca without going through Access.

Either layer on its own stops an anonymous visitor.

## Settings

| Variable | Example | What it does |
| --- | --- | --- |
| `WORCA_ALLOWED_HOSTS` | `worca-01.example.com` | Hostnames accepted in `Host` and `Origin` besides loopback. Comma-separated. A leading dot (`.example.com`) matches subdomains, but prefer the exact name. |
| `WORCA_CF_ACCESS_TEAM_DOMAIN` | `acme.cloudflareaccess.com` | Your Zero Trust team domain. Turns on the token check. |
| `WORCA_CF_ACCESS_AUD` | `4714c1…` | The Access application's *Application Audience (AUD) tag*. Tokens issued for any other application are refused. |
| `WORCA_INSECURE_NO_IDENTITY_CHECK` | `1` | Runs with an allowlist but **no** token check, trusting the proxy alone. Never needed with Cloudflare Access; it exists for other proxies that sign nothing. |
| `WORCA_HOST` | `::` | Listen address. Must be non-loopback for a proxy in another container to reach worca. |

### Worca refuses to start if the setup is unsafe

Worca exits at startup with a one-line reason, rather than serving, when:

- `WORCA_ALLOWED_HOSTS` names a non-loopback host but no identity check is configured, and
  `WORCA_INSECURE_NO_IDENTITY_CHECK=1` is not set;
- only one of `WORCA_CF_ACCESS_TEAM_DOMAIN` / `WORCA_CF_ACCESS_AUD` is set;
- an allowlist entry isn't a plain hostname (a scheme, a port or a `*` wildcard).

When it starts in remote mode it logs `remote access on for <hosts>; identity: cloudflare-access (<team>)`.

### Responses

| Situation | Status |
| --- | --- |
| `Host` or `Origin` not loopback and not allowlisted | 403 `forbidden: host not allowed (see WORCA_ALLOWED_HOSTS)` |
| Missing or invalid Access token | 401 |
| Access's public keys can't be fetched (and none are cached) | 503 |
| `GET /api/health` from outside the box | 200, `{ name, version }` only, no token needed (for platform healthchecks) |

Callers inside the same machine or container (the `worca` CLI, `worca ui stop`, `curl localhost`)
need no token. Worca recognises them by a loopback TCP peer **and** a loopback `Host`. `cloudflared`
must therefore run in its **own** container or service; if it shared worca's network namespace, its
requests would look local.

## Cloudflare setup

The team and identity providers are set up once. After that, repeat the steps for each deployment.

1. Add your domain to Cloudflare.
2. **Zero Trust**: choose a team name, which gives you the team domain (`<team>.cloudflareaccess.com`).
   The Free plan covers 50 users.
3. **Integrations → Identity providers**: keep *One-time PIN*, and add GitHub or Google if you like.
4. **Networks → Tunnels → Create** (Cloudflared). Copy the token. Add a public hostname, e.g.
   `worca-01.example.com`, pointing to worca's private address, e.g. `http://worca.railway.internal:4317`.
5. **Access → Applications → Add → Self-hosted** for that hostname. Add a policy with action
   *Allow* that includes *Emails* set to the named people who may use it. Set a session
   duration of at least 24h.
6. Copy the application's **AUD tag** into `WORCA_CF_ACCESS_AUD`.
7. Only if you use the Teams chat webhook: add a *Bypass* policy for `/api/ingress/*`. That route
   has its own token check and never reaches the rest of the API.

Use one Access application, with its own AUD tag, per deployment, so a token for one deployment is
refused by another. Use `worca-NN.example.com` rather than `NN.worca.example.com`: Cloudflare's free
certificate covers only one subdomain level.

## When the sign-in expires

When the Access session ends, Cloudflare redirects every request to its sign-in page, which the
browser blocks for background requests. Instead of showing a UI that silently stops updating, worca
shows a *Your sign-in has expired* bar with a **Sign in again** button that reloads the page through
Access.

## Limits

- **Every allowed person is an administrator.** Worca has one user: settings, credentials, runs and
  the shell are shared. Keep the Access policy to named emails, and use one deployment per person or
  per set of credentials, never one per project.
- Scope the secrets: a fine-grained `GH_TOKEN`, a spend limit on the Anthropic key, and worca's
  per-run cost caps.
- Desktop features act on the server: the folder picker becomes a text field
  (`WORCA_NO_NATIVE_DIALOG=1`).
