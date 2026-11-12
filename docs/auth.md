# Sign-in with your own identity provider

Worca on a server needs to know who is using it. Besides
[Cloudflare Access](remote-access.md), it can sit behind
[oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/), signing people in with any OpenID
Connect provider: Microsoft Entra ID, Keycloak, Okta, Google, Authentik, Auth0, Dex. Nothing
runs on Cloudflare. The Helm chart (`auth`) and a Compose overlay (`compose.auth.yml`) set it up.

```
 browser ──https──► Ingress / TLS proxy ──► oauth2-proxy :4180 ──X-Worca-Identity: <ID token>──► worca :4317
                                              │   ▲                                               │
                             sign-in, refresh │   │ session cookie                 verifies the   │
                                              ▼   │                                token's        │
                                      OIDC provider (Entra ID, Keycloak, Okta, …) ◄── signing keys ┘
```

1. A request without a session is sent to the provider's sign-in page. After sign-in the proxy
   keeps the provider's tokens in an encrypted cookie (or Redis).
2. The proxy admits only people whose **groups or roles** include one of `allowedGroups`.
3. It forwards each request, WebSocket upgrades included, with the session's **ID token** in
   `X-Worca-Identity`. A value the browser sends in that header is removed first.
4. **Worca checks the token itself**: the signature against the provider's published keys, the
   issuer, the audience (the client id), the expiry. It doesn't take the proxy's word for it, so a
   request that gets past the proxy without a valid token gets a 401. Worca refuses to start if
   the settings are incomplete.
5. Worca records the person by the token's email: who started each run, who answered,
   paused or approved, whose chats are whose ([Who started a run](remote-access.md#who-started-a-run)).
   The groups or roles the token carries become the person's **teams**.

## Team policy

Access is decided per Worca instance: `allowedGroups` lists the groups or roles that may use it.

- **One instance per team**: install the chart once per team (a release per namespace, or a
  Compose project per host), each with its own `allowedGroups`.
- **Teams sharing an instance**: list several groups.
- **Groups or roles**: `teamsClaim` names the claim to read: `groups`, `roles`, or a dotted path
  such as `realm_access.roles`. The proxy decides access from it, and worca reads its teams from
  the same claim.

Everyone admitted to an instance sees everything in it. The teams in the token aren't yet used to
limit access to individual projects inside worca.

## Kubernetes (Helm)

```yaml
# values.yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: worca.example.com
      paths: [{ path: /, pathType: Prefix }]
  tls:
    - secretName: worca-tls
      hosts: [worca.example.com]
auth:
  enabled: true
  oidc:
    issuerUrl: https://login.microsoftonline.com/<tenant id>/v2.0
    jwksUrl: https://login.microsoftonline.com/<tenant id>/discovery/v2.0/keys
    clientId: <application (client) id>
    scope: openid email profile offline_access
    emailClaim: preferred_username
    teamsClaim: roles
  allowedGroups: [worca.team-a]
  existingSecret: worca-auth        # keys: client-secret, cookie-secret
```

```bash
kubectl -n worca create secret generic worca-auth \
  --from-literal=client-secret='<client secret>' \
  --from-literal=cookie-secret="$(openssl rand -base64 32 | tr -- '+/' '-_')"
helm upgrade --install worca deploy/helm/worca -n worca -f values.yaml
```

What the chart does with `auth.enabled`:

- It adds an oauth2-proxy Deployment and Service (`<release>-auth`, port 4180), and the Ingress
  routes to the proxy instead of the controller.
- It sets the controller's `WORCA_IDENTITY_ISSUER`, `WORCA_IDENTITY_JWKS_URL`,
  `WORCA_IDENTITY_AUDIENCE` (the client id), `WORCA_IDENTITY_EMAIL_CLAIM` and
  `WORCA_IDENTITY_TEAMS_CLAIM` from the same values. `WORCA_ALLOWED_HOSTS` comes from the Ingress
  hosts, as before.
- The callback is `https://<first ingress host>/oauth2/callback` unless you set `auth.redirectUrl`.
  Register it with the provider.
- With `networkPolicy.enabled`, only the proxy's pods can reach the controller's UI port.
- `auth.caSecret` names a Secret with `ca.crt`: a private CA that the provider's certificate
  chains to. Both the proxy and the controller trust it.
- `auth.redisUrl` keeps sessions in Redis instead of cookies. Use it for large ID tokens,
  such as Entra ID with many groups.
- The render fails with a message saying what to set when a required value is missing, or when
  Cloudflare Access variables are also set (one identity check, not two).

`node tools/k8s-smoke.mjs --auth` checks all of this on kind with a throwaway Keycloak
([Kubernetes → Smoke it](kubernetes.md#smoke-it)).

## Docker Compose

Put `compose.auth.yml` and `oauth2-proxy.yaml` from [docker/](../docker) next to `compose.yml`,
and add to `.env`:

```bash
WORCA_AUTH_HOST=worca.example.com
WORCA_OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant id>/v2.0
WORCA_OIDC_JWKS_URL=https://login.microsoftonline.com/<tenant id>/discovery/v2.0/keys
WORCA_OIDC_CLIENT_ID=<application (client) id>
WORCA_OIDC_CLIENT_SECRET=<client secret>
WORCA_OIDC_SCOPE=openid email profile offline_access
WORCA_OIDC_EMAIL_CLAIM=preferred_username
WORCA_OIDC_TEAMS_CLAIM=roles
WORCA_AUTH_ALLOWED_GROUPS=worca.team-a,worca.team-b
WORCA_AUTH_COOKIE_SECRET=<openssl rand -base64 32 | tr -- '+/' '-_'>
```

```bash
docker compose -f compose.yml -f compose.auth.yml up -d
```

- The proxy listens on `127.0.0.1:4180`. Put your TLS reverse proxy (Caddy, Traefik, nginx) in
  front of it at `https://$WORCA_AUTH_HOST`. The callback is
  `https://$WORCA_AUTH_HOST/oauth2/callback`, or `WORCA_AUTH_REDIRECT_URL`.
- It combines with `compose.workers.yml`.
- **With `compose.egress.yml`**, worca sits only on the `internal` network. Join the proxy to it
  in a `compose.override.yml`, and add the provider's host to `WORCA_EGRESS_ALLOW`, because worca
  fetches the provider's signing keys:
  ```yaml
  services:
    oauth2-proxy:
      networks: [default, internal]
  ```
- **With a private CA for the provider**, mount it into the proxy, add
  `caFiles: ["/etc/oauth2-proxy/ca.crt"]` and `useSystemTrustStore: true` to the provider in your
  copy of `oauth2-proxy.yaml`, and use `compose.ca.yml` for worca.

## Providers

Every provider needs the same things:
- a confidential OIDC client (web application) with the callback above as a redirect URI;
- its issuer and JWKS URL;
- the claims that carry the email and the groups or roles.

The audience worca checks is the client id, which is the `aud` of the provider's ID tokens.

### Microsoft Entra ID

Not yet checked against a live tenant. The values below follow Entra's documented token format.

1. **App registration**: Entra admin center → App registrations → New registration.
   - **Supported account types:** *this organizational directory only* (single tenant). Worca
     accepts tokens from exactly one issuer.
   - **Redirect URI:** Web, `https://worca.example.com/oauth2/callback`.
2. **Certificates & secrets**: create a client secret. It expires, so note when.
3. **App roles** (recommended over groups): App roles → Create app role.
   - **Allowed member types:** Users/Groups.
   - **Value:** e.g. `worca.team-a`.

   Then, in Enterprise applications → your app → Users and groups, assign people or groups to
   each role. The ID token carries the assigned roles in `roles`.
4. Values:

   | Setting | Value |
   |---|---|
   | issuer | `https://login.microsoftonline.com/<tenant id>/v2.0` |
   | JWKS URL | `https://login.microsoftonline.com/<tenant id>/discovery/v2.0/keys` |
   | client id | the Application (client) ID |
   | scope | `openid email profile offline_access` (without `offline_access` there's no refresh token, and the session ends when the first ID token expires) |
   | email claim | `preferred_username` (Entra's `email` is optional and empty for accounts without a mailbox) |
   | teams claim | `roles` |
   | allowed groups | the role values, e.g. `worca.team-a` |

Why roles and not groups:
- The `groups` claim carries object ids (GUIDs), not names.
- Past about 200 groups Entra leaves the claim out of the token and expects a Graph API call
  instead.

If you do use groups, set Token configuration → Add groups claim → *Groups assigned to the
application*, and list the group object ids in `allowedGroups`.

### Keycloak

This is the provider `tools/k8s-smoke.mjs --auth` runs against.

1. Create a client.
   - **Client authentication:** on.
   - **Valid redirect URIs:** the callback.
2. Add realm roles (`team-a`, …) and assign them to users or groups.
3. In Client scopes → `<client>-dedicated`, add a mapper *By configuration → User Realm Role*:
   - **Token claim name:** `roles`
   - **Multivalued:** on
   - **Add to ID token:** on
4. Values:

   | Setting | Value |
   |---|---|
   | issuer | `https://<keycloak>/realms/<realm>` |
   | JWKS URL | `https://<keycloak>/realms/<realm>/protocol/openid-connect/certs` |
   | email claim | `email` (users need a verified email) |
   | teams claim | `roles` |

   Keycloak's ID token lives 5 minutes by default, which is why `cookie.refresh` defaults to `4m`.

### Okta, Google, Authentik

| | Issuer | JWKS URL | Teams claim |
|---|---|---|---|
| Okta | `https://<org>.okta.com/oauth2/default` | `…/oauth2/default/v1/keys` | `groups` (add a groups claim to the ID token in the authorization server) |
| Google | `https://accounts.google.com` | `https://www.googleapis.com/oauth2/v3/certs` | none: Google's ID token carries no groups; leave `allowedGroups` empty and restrict sign-in in the OAuth consent screen (Internal) |
| Authentik | `https://<authentik>/application/o/<slug>/` | `…/application/o/<slug>/jwks/` | `groups` |

Check the exact issuer in the provider's
`/.well-known/openid-configuration` (`issuer` and `jwks_uri`): worca compares the issuer exactly,
apart from a trailing slash.

## Sessions and token lifetime

- The proxy refreshes the session, and with it the ID token worca sees, once the session is older
  than `cookie.refresh` (4 minutes by default). Keep this below the provider's ID token lifetime.
- When the token a WebSocket opened with expires, worca closes the socket (code 4001). The UI
  reconnects at once, through the proxy, with the refreshed token.
- `cookie.expire` (12 hours by default) is the longest a session lasts without signing in again.
  Removing a person's role takes effect at their next refresh, because the provider issues no new
  token with that role.

## Settings reference

| Worca variable | Default | What it does |
|---|---|---|
| `WORCA_IDENTITY_ISSUER` | — | The provider's issuer. Turns on the token check. |
| `WORCA_IDENTITY_JWKS_URL` | `<issuer>/.well-known/jwks.json` | Where the signing keys are. Set it: providers differ. |
| `WORCA_IDENTITY_AUDIENCE` | the allowed hosts | The client id. |
| `WORCA_IDENTITY_EMAIL_CLAIM` | `email` | The claim holding the person's email. |
| `WORCA_IDENTITY_TEAMS_CLAIM` | `teams` | The claim holding their groups or roles: an exact name first, else a dotted path. A single string counts as one team. |

The chart and the Compose overlay set all five. The credential broker's key page reads the same
variables ([credential-broker.md](credential-broker.md)).

## Troubleshooting

| Symptom | Look at |
|---|---|
| The proxy fails at start: discovery or certificate errors | The issuer URL, the network route or corporate proxy to it (`HTTPS_PROXY`), `auth.caSecret` for a private CA. |
| 403 from the proxy after sign-in | The person holds none of `allowedGroups` in `teamsClaim`. The proxy's log names the user. Decode the ID token (jwt.io, offline) to see the claims. |
| 401 from worca after a successful sign-in | The worca log says why: issuer mismatch (compare `iss` exactly), audience (must be the client id), the keys couldn't be loaded (JWKS URL, CA), or no email in `WORCA_IDENTITY_EMAIL_CLAIM`. |
| 403 `host not allowed` | `WORCA_ALLOWED_HOSTS` must be the host the browser uses, which the proxy passes on. |
| Signed out every few minutes | No refresh token: add `offline_access` to the scope (Entra ID), or raise the provider's session length. |
| Cookie too large, or 431 or 502 from the Ingress | Large ID tokens: set `auth.redisUrl`, or raise the Ingress's header buffer. |
