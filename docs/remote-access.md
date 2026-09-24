# Remote access behind Cloudflare Access

Worca is a single-user tool that runs agents able to execute shell commands and edit files. By
default it only answers requests addressed to `localhost`, and it has no login of its own. This
page covers the one supported way to reach it from elsewhere: behind **Cloudflare Access**, with
worca verifying the Access token on every request itself.

Nothing here changes a local install. With none of the variables below set, worca behaves exactly
as before.

For a complete hosted setup (the container on Railway plus everything on this page), follow
[deploy-railway.md](deploy-railway.md). This page covers the Cloudflare side and worca's settings,
which are the same wherever worca runs.

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
   without a valid token gets a 401, even if it somehow reached worca without going through Access,
   for example through an accidentally published port or a proxy with a missing policy.

Either layer on its own stops an anonymous visitor.

## Before you start

You need:

- **A domain on Cloudflare**: the domain's nameservers point to Cloudflare (a Free plan is
  enough). Worca gets one hostname on it, e.g. `worca.example.com`. Prefer a first-level name
  (`worca.example.com`, `worca-2.example.com`) over `a.worca.example.com`: Cloudflare's free
  certificate covers one subdomain level.
- **A Cloudflare Zero Trust organization** (Free plan: up to 50 users). Creating one asks for a
  payment method even on the Free plan.
- **Somewhere worca runs** with a private network path from `cloudflared` to worca's port, with
  `cloudflared` in its **own** container or service (see [Callers inside the box](#callers-inside-the-box)).
  [deploy-railway.md](deploy-railway.md) is a complete example.
- **The email addresses** of the people who may use this worca, and who you're comfortable giving
  administrator access (see [Limits](#limits)).

## Cloudflare setup (dashboard)

Menu names are those of the Cloudflare One dashboard (`one.dash.cloudflare.com`). Steps 1–2 are done
once per organization, steps 3–7 once per worca deployment.

1. **Create the Zero Trust organization.** Cloudflare One → choose a **team name**, e.g. `acme`. This
   gives the **team domain** `acme.cloudflareaccess.com`, which is `WORCA_CF_ACCESS_TEAM_DOMAIN`. A new
   organization can get a generated display name (shown on the sign-in page); you can change it under
   **Settings**.
2. **Login methods.** **Integrations → Identity providers → Add new → One-time PIN.** With it, anyone
   on your allow list signs in with a code sent to their email. A new organization may start with only
   *Cloudflare* login, which works only for members of your Cloudflare account. Add GitHub, Google or
   another provider if you prefer.
3. **Tunnel.** **Networks → Tunnels → Create a tunnel → Cloudflared**, name it (e.g. `worca`), save.
   Copy the **token** from the install command (the long string after `--token`); `cloudflared` runs
   with it as `TUNNEL_TOKEN`. Don't run the install command: `cloudflared` runs next to worca.
4. **Public hostname** (on the tunnel; newer dashboards call it a *published application route*):
   subdomain `worca`, domain `example.com`, service **HTTP**, URL = worca's private address, e.g.
   `worca.railway.internal:4317`. Cloudflare creates the DNS record for the hostname itself.
5. **Access application.** **Access controls → Applications → Add an application → Self-hosted.**
   Name it, add the public hostname `worca.example.com`, session duration **24 hours**. Add a policy:
   action **Allow**, include **Emails** = the people who may use it. Save.
6. **AUD tag.** Open the application's overview and copy the **Application Audience (AUD) tag**:
   that's `WORCA_CF_ACCESS_AUD`.
7. **Only if you use the Teams chat channel:** add a second policy with action **Bypass** for the path
   `/api/ingress/*`. That route checks its own token and never reaches the rest of the API.

Use one Access application, with its own AUD tag, per worca deployment: a token issued for one
deployment is then refused by every other.

### Adding people later

Edit the Allow policy (**Access controls → Policies**, or the application's *Policies* tab) and add
their addresses to **Emails**. It applies immediately; worca needs no change or restart. With
One-time PIN they sign in with a code sent to that address. Other selectors (*Emails ending in*, a
GitHub organization) work too, as long as everyone they match should administer this worca.

### Service tokens (scripts and monitoring)

For non-browser access (a health monitor, a script calling the API), create a **service token**
(**Access controls → Service credentials → Service Tokens → Create**), add a policy to the application
with action **Service Auth** that includes that token, and send both headers with each request:

```bash
curl -H "CF-Access-Client-Id: $CLIENT_ID" -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
  https://worca.example.com/api/health
```

Cloudflare then issues the same signed token worca verifies for browsers. Service tokens expire
(you choose the duration); renew them before they do.

### Automating it with the API

Everything above can also be created with the Cloudflare API, using an API token scoped to the
account and the zone:

| Permission | Level | Used for |
| --- | --- | --- |
| Account · Cloudflare Tunnel | Edit | create the tunnel, read its token, set its ingress |
| Account · Access: Apps and Policies | Edit | the application and its policies |
| Account · Access: Service Tokens | Edit | service tokens |
| Account · Access: Organizations, Identity Providers, and Groups | Edit | login methods, the organization's name |
| Zone · DNS | Edit | the hostname's CNAME |

The calls (base `https://api.cloudflare.com/client/v4`):

1. `POST /accounts/{account}/cfd_tunnel` with `{"name": "worca", "config_src": "cloudflare"}`, then
   `GET /accounts/{account}/cfd_tunnel/{id}/token` for `TUNNEL_TOKEN`.
2. `PUT /accounts/{account}/cfd_tunnel/{id}/configurations` with
   `{"config": {"ingress": [{"hostname": "worca.example.com", "service": "http://worca.railway.internal:4317"}, {"service": "http_status:404"}]}}`.
3. `POST /zones/{zone}/dns_records` with a proxied `CNAME` from `worca.example.com` to `{id}.cfargotunnel.com`.
4. `POST /accounts/{account}/access/service_tokens` (optional): the response holds the client secret, once.
5. `POST /accounts/{account}/access/policies` for each policy: `decision: "allow"` with
   `include: [{"email": {"email": "you@example.com"}}]`; for a service token `decision: "non_identity"`
   with `include: [{"service_token": {"token_id": "…"}}]`.
6. `POST /accounts/{account}/access/apps` with `type: "self_hosted"`, `domain: "worca.example.com"`,
   `session_duration: "24h"` and `policies: [{"id": "…", "precedence": 1}, …]`. The response's `aud`
   is `WORCA_CF_ACCESS_AUD`.

## Worca settings

Set these where worca runs (for Railway: on the `worca` service).

| Variable | Example | What it does |
| --- | --- | --- |
| `WORCA_ALLOWED_HOSTS` | `worca.example.com` | Hostnames accepted in `Host` and `Origin` besides loopback. Comma-separated. A leading dot (`.example.com`) matches subdomains, but prefer the exact name. On Railway add `healthcheck.railway.app` (see [deploy-railway.md](deploy-railway.md)). |
| `WORCA_CF_ACCESS_TEAM_DOMAIN` | `acme.cloudflareaccess.com` | Your team domain. Turns on the token check. |
| `WORCA_CF_ACCESS_AUD` | `4714c1…` | The application's AUD tag. Tokens issued for any other application are refused. |
| `WORCA_HOST` | `::` | Listen address. Must be non-loopback so `cloudflared` in another container can reach worca; `::` accepts IPv6 and IPv4. |
| `WORCA_INSECURE_NO_IDENTITY_CHECK` | `1` | Runs with an allowlist but **no** token check, trusting the proxy alone. Never needed with Cloudflare Access; it exists for proxies that sign nothing. |

### Worca refuses to start if the setup is unsafe

Worca exits at startup with a one-line reason, rather than serving, when:

- `WORCA_ALLOWED_HOSTS` names a non-loopback host but no identity check is configured, and
  `WORCA_INSECURE_NO_IDENTITY_CHECK=1` is not set;
- only one of `WORCA_CF_ACCESS_TEAM_DOMAIN` / `WORCA_CF_ACCESS_AUD` is set;
- an allowlist entry isn't a plain hostname (a scheme, a port or a `*` wildcard).

When it starts in remote mode it logs
`remote access on for <hosts>; identity: cloudflare-access (<team domain>)`.

### Responses

| Situation | Status |
| --- | --- |
| `Host` or `Origin` not loopback and not allowlisted | 403 `forbidden: host not allowed (see WORCA_ALLOWED_HOSTS)` |
| Missing or invalid Access token | 401 `unauthorized: sign in through the identity proxy (Cloudflare Access)` |
| Access's public keys can't be fetched (and none are cached) | 503 |
| `GET /api/health` from outside the box | 200, `{ name, version }` only, no token needed (for platform healthchecks) |

### Callers inside the box

Callers inside the same machine or container (the `worca` CLI, `worca ui stop`, `curl localhost`)
need no token. Worca recognises them by a loopback TCP peer **and** a loopback `Host`. `cloudflared`
must therefore run in its **own** container or service; if it shared worca's network namespace, its
requests would look local.

## Who started a run

Everyone signed in acts with the deployment's GitHub identity, so worca records the person behind
each run. This is attribution, not permissions: everyone keeps the same rights.

- The signed-in email shows in the sidebar ("Signed in as …"). Run cards, History cards and
  sidebar rows show an initials circle and "by …" ("by you" for your own runs); both run detail
  headers show a person chip with the full name. History gets a *Started by* filter. Scheduled
  runs keep the name of whoever scheduled them.
- People are shown only when each viewer signs in as themselves (Cloudflare Access or
  `WORCA_IDENTITY_HEADER`). A local install, or a self-hosted worca with only
  `WORCA_IDENTITY_NAME`, records the name but shows none of it: there is only one person.
- A pull request opened from a run ends with *Started by ada@example.com via worca*, so a PR
  authored by a shared bot or GitHub App still names the person.
- Ask Worca sees the signed-in person in its context and answers "who started this", "what did ada
  run", "who paused it" and "who scheduled this" from the recorded names (`list_runs` with a
  `startedBy` filter, `list_people`, and the actions `get_run` lists). "My runs" works only with a
  per-person sign-in.
- Who paused, stopped or resumed a run shows in its banner ("Paused by …"), and diff comments name
  their author.
- *Run now* on a schedule credits whoever clicked it. Team metrics, team policy edits and cap
  overrides record the person instead of the server's git user (`attribution: none` still records
  nobody).
- With a per-person sign-in (Access or a trusted header), each person's Ask Worca chats are their
  own: others can't open them, and *Delete all* removes only yours. Notifications are marked read
  per person.
- Each run's audit timeline (History → the saved `pipeline.md`) names who answered its questions,
  approved a proposal or gate, paused, resumed (including past a cost cap, with the reason),
  stopped, opened its pull request, archived it or discarded its worktree. The export header adds
  *started by*. History's Clarify tab shows *answered by …*. A local action keeps the old wording.
- Commands from chat (`/stop`, `/pause`, `/resume`, `/answer`, `/approve`) are credited as
  "ada via Slack", from the platform's user name or id. That is attribution text, not a sign-in.

Worca takes the name from the first of these that applies, and never guesses:

| Source | When |
| --- | --- |
| The verified Cloudflare Access token | Always, when the Access check is on |
| `WORCA_IDENTITY_HEADER` | A header your own identity proxy sets (oauth2-proxy, Tailscale, …). Only when you name it: set it only if the proxy verifies the user and strips any copy the browser sends |
| `WORCA_IDENTITY_NAME` | A name you declare, for a self-hosted worca with no identity layer |
| none | Nothing is shown or added, as on a local install |

## Check the setup

With the service token from above (or signed in with a browser):

```bash
# 1. Without credentials Cloudflare answers, not worca: a redirect to your team's sign-in page.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://worca.example.com/api/health
#    -> 302 https://acme.cloudflareaccess.com/...

# 2. Through Access: worca answers, with its short remote health response.
curl -s -H "CF-Access-Client-Id: $CLIENT_ID" -H "CF-Access-Client-Secret: $CLIENT_SECRET" \
  https://worca.example.com/api/health
#    -> {"name":"@worca/app","version":"…"}

# 3. An authenticated API route: proves worca accepted Cloudflare's signed token.
curl -s -o /dev/null -w '%{http_code}\n' -H "CF-Access-Client-Id: $CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CLIENT_SECRET" https://worca.example.com/api/projects
#    -> 200
```

And from a shell inside worca's container, a request that pretends to come from outside must be
refused by worca itself:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: worca.example.com' http://127.0.0.1:4317/api/projects
# -> 401
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Worca exits at start with `remote access: …` | Incomplete or unsafe settings | Do what the line says ([above](#worca-refuses-to-start-if-the-setup-is-unsafe)). |
| Cloudflare error **1033** (HTTP 530) | The tunnel has no running connector | Start `cloudflared` with the tunnel's token; check its log for *Registered tunnel connection*. |
| Cloudflare **502** / *Bad gateway* | `cloudflared` runs but can't reach worca | Check the public hostname's service URL and port, and that `WORCA_HOST` is `::` (or `0.0.0.0`), not the loopback default. |
| **403** `host not allowed` | The hostname isn't in `WORCA_ALLOWED_HOSTS` | Add the exact hostname. |
| **401** `unauthorized` through Access | Token for another application or team | Compare `WORCA_CF_ACCESS_AUD` with the application's AUD tag and `WORCA_CF_ACCESS_TEAM_DOMAIN` with the team domain; restart worca after changing them. |
| **503** `cannot verify the sign-in token` | Worca can't fetch `https://<team domain>/cdn-cgi/access/certs` | Allow outbound HTTPS from worca to your team domain. |
| Sign-in page shows no usable login method | Only *Cloudflare* login is enabled | Add *One-time PIN* (step 2). |
| *Your sign-in has expired* bar | The Access session ended | **Sign in again** reloads the page through Access. |
| The hostname doesn't resolve right after DNS changes | Resolvers still cache the old answer | Wait for the TTL; for Cloudflare's resolver use `one.one.one.one/purge-cache`. |

## When the sign-in expires

When the Access session ends, Cloudflare redirects every request to its sign-in page, which the
browser blocks for background requests. Instead of showing a UI that silently stops updating, worca
shows a *Your sign-in has expired* bar with a **Sign in again** button that reloads the page through
Access.

## Limits

- **Every allowed person is an administrator.** Worca has one user: settings, credentials (the
  Claude token, `GH_TOKEN`), runs and the container's shell are shared. Keep the Access policy to
  named emails, and use one deployment per person or per set of credentials, never one per project.
- Scope the secrets: a fine-grained `GH_TOKEN`, a spend limit on an Anthropic API key, and worca's
  per-run cost caps.
- Desktop features act on the server: the folder picker becomes a text field
  (`WORCA_NO_NATIVE_DIALOG=1`).
