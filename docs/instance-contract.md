# Instance contract

What a hosted Worca instance is made of, and everything a management interface sets or expects
from it. Read this if you run Worca for other people without a hosting platform, or if you are
building a management interface of your own (a control plane that creates, stops, wakes,
upgrades and deletes instances on some compute provider).

Each topic below is covered in more depth elsewhere; this page collects the parts a platform
depends on and links to the rest:
[remote access and identity](remote-access.md), the [credential broker](credential-broker.md),
[Worca on Railway](deploy-railway.md) (one instance set up by hand) and [Docker](docker.md).

## Shape

One instance is three containers. Two of them come from the same image.

| Container | Image | Start command | Listens on | Reached by |
| --- | --- | --- | --- | --- |
| `worca` | the instance image published by this repo, for example `ghcr.io/sinishadjukic/worca:<version>` | the image's own (`ENTRYPOINT tini -s -e 143 -- worca-entrypoint`, `CMD worca ui`) | `4317` (UI and API) | `cloudflared` only |
| `broker` | the same image and tag as `worca` | `worca-entrypoint worca broker` | `8080` (private API), `8081` (key page) | `8080`: `worca` only. `8081`: `cloudflared` only |
| `cloudflared` | `cloudflare/cloudflared:<pinned version>` | `cloudflared tunnel --no-autoupdate run` | nothing | (dials out to Cloudflare) |

```
browser ──► your gate ──► Cloudflare Tunnel ──► cloudflared ──┬─► worca  :4317
            (signs the                                         └─► broker :8081  (key page)
             identity token)
                                       worca ──► broker :8080        (private, never routed)
                                       worca ──► heartbeat URL       (https, outbound)
```

- **No public ports.** The tunnel is the only way in. Its ingress has two hostnames: the instance
  host to `http://worca:4317` and the key-page host to `http://broker:8081`, then a catch-all
  `http_status:404`. Port `8080` is never routed.
- **`cloudflared` runs in its own container.** Worca treats a caller with a loopback peer and a
  loopback `Host` as local and asks it for no token
  ([Callers inside the box](remote-access.md#callers-inside-the-box)). A `cloudflared` sharing
  Worca's network namespace would look local.
- **IPv6.** On a provider whose private network is IPv6 (Railway), set `WORCA_HOST=::` and
  `WORCA_BROKER_HOST=::`. `::` accepts IPv4 too.
- **Order.** Start `worca` and `broker` first and `cloudflared` last, so the tunnel connects
  once its origins exist.
- **Override the start commands only if you must.** If your provider replaces the image's
  `ENTRYPOINT` with its start command (Railway does), name `worca-entrypoint` yourself as in the
  table. For `worca`, keep `tini -s -e 143 --` in front so a graceful stop exits 0 (see
  [Stopping](#stopping-and-draining)).

## Storage

`worca` and `broker` each have **their own** volume; nothing is shared between them.

- **`worca`**: on a host that gives a service one volume mounted root-owned, set `WORCA_DATA_DIR`
  to its mount path (for example `/data`) and start the container as root (on Railway
  `RAILWAY_RUN_UID=0`). The entrypoint prepares the volume (Worca's home, projects, `HOME` with
  Claude Code's login, and the folders for agents under their own users), then re-runs itself as
  the `worca` user; nothing else runs as root. Without `WORCA_DATA_DIR` Worca keeps its data
  outside the volume and loses it on every redeploy. Docker with named volumes uses the image's
  `VOLUME`s (`/worca`, `/home/worca/.claude`) instead; `docker/compose.isolation.yml` runs the
  single-volume mode in Docker. See [Docker](docker.md).
- **`broker`**: `WORCA_BROKER_DATA_DIR` on its own volume holds the encrypted key store (people's
  model keys and GitHub tokens, sealed with `WORCA_BROKER_VAULT_KEY`).

Back up both. Without the vault key the broker's store can't be read.

## Variables

Values in angle brackets are per instance. Everything not listed keeps Worca's default.

### `worca`

| Variable | Value | What it does |
| --- | --- | --- |
| `WORCA_HOST` | `::` | Listen address; non-loopback so `cloudflared` reaches it. |
| `PORT` | `4317` | UI and API port (Worca's default). Pin it: the tunnel's ingress names it. |
| `WORCA_DATA_DIR` | the volume's mount path | Single-volume mode (see [Storage](#storage)). Also makes Worca report itself as a container deployment. |
| `RAILWAY_RUN_UID` | `0` | Railway only: start the container as root so the entrypoint can prepare the volume. Other providers: run the container as root by their own means. |
| `WORCA_ALLOWED_HOSTS` | `<instance host>` | The one exact host the instance answers to. With an identity issuer, suffix entries (`.example.com`) are refused. |
| `WORCA_IDENTITY_ISSUER` | `<your gate's origin>` | Turns on the identity-token check (see [Identity token](#identity-token)). |
| `WORCA_IDENTITY_AUDIENCE` | `<instance host>` | The `aud` Worca accepts. Default: the exact hosts in `WORCA_ALLOWED_HOSTS`. |
| `WORCA_IDENTITY_JWKS_URL` | `<issuer>/.well-known/jwks.json` | Where the public keys are (that is also the default). |
| `WORCA_HEARTBEAT_URL` | `<your heartbeat endpoint>` | Where Worca POSTs its heartbeat (see [Heartbeat](#heartbeat)). https only, http for localhost. |
| `WORCA_HEARTBEAT_TOKEN` | `<per-instance secret>` | Sent as `Authorization: Bearer …`. Without both heartbeat variables nothing is sent. |
| `WORCA_BROKER_URL` | `http://<broker private host>:8080` | Turns the broker on: Worca holds no model key. |
| `WORCA_BROKER_SECRET` | `<per-instance secret>` | Shared with the broker for its `/internal` API. |
| `WORCA_BROKER_REQUIRED` | `1` | Refuse to start (rather than warn) when several people sign in but the broker is off. |
| `WORCA_TERMINAL_REMOTE` | `1` or `0` | Whether signed-in people get the terminal. Off by default on a hosted instance; `0` is off. |
| `WORCA_ACTIONS_REMOTE` | `1` or `0` | Whether signed-in people can run actions. Same rule. |
| `WORCA_EGRESS_MODE` | `open`, `block` or `allow` | Outbound network policy ([details](remote-access.md#outbound-network-policy-hosting-platform)). Any other value fails closed to `allow`. |
| `WORCA_EGRESS_ALLOW` | comma-separated hosts | Read in `allow` mode. Put your own hosts first (heartbeat endpoint, issuer, the broker's private host). |
| `WORCA_EGRESS_DENY` | comma-separated hosts | Always wins. `.invalid` stands for an empty list. |
| `WORCA_MAX_PARALLEL` | integer ≥ 1 | Agent steps that run at once (default 4). Match it to the container's size. |
| `WORCA_MAX_PARALLEL_SCRIPTS` | integer ≥ 1 | Script steps that run at once (default 2). |
| `WORCA_AUTO_RESUME` | `1` | Runs a stop's drain paused are resumed at the next start (the default); `1` also resumes runs a crash left interrupted, `0` turns it off. |
| `WORCA_AWAY_PER_PERSON` | `1` | "I'm away" applies to each signed-in person's own runs (a team shares the instance). |
| `WORCA_DRAIN_TIMEOUT_MS` | optional | How long a stop waits for runs to pause (default 20 000, see [Stopping](#stopping-and-draining)). |

Git credentials, when the instance's owners configure them in your interface (all optional; see
[Worca on Railway](deploy-railway.md#github-app) and the pages it links):

| Variable | What it does |
| --- | --- |
| `WORCA_GH_APP_ID`, `WORCA_GH_APP_KEY_B64`, `WORCA_GH_APP_INSTALLATION_ID` | A GitHub App: its ID, its private key (PEM, base64) and the installation. |
| `GH_TOKEN` | A GitHub token instead of an App. |
| `WORCA_ADO_TOKEN` | Azure DevOps token. |
| `WORCA_BB_TOKEN`, `WORCA_BB_EMAIL` | Bitbucket token, and the Atlassian account email for an API token. |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` | Commit identity. Leave them unset rather than empty: git refuses an empty name. |
| `WORCA_CLONE_ALLOW` | Comma-separated patterns Worca may clone from, such as `github.com/acme/*`. Unset: any. |
| `WORCA_GH_AS_PERSON` | `prefer` or `required`: pushes and pull requests go out as the person who acted ([Push as me](credential-broker.md#push-as-me)). |

When your interface removes a credential, delete the variable rather than set it empty.

### `broker`

| Variable | Value | What it does |
| --- | --- | --- |
| `WORCA_BROKER_MODE` | `multi` | One instance, several people, each with their own keys. |
| `WORCA_BROKER_HOST` | `::` | Listen address for both ports. |
| `WORCA_BROKER_PORT` | `8080` | Private API (Worca only). |
| `WORCA_BROKER_UI_PORT` | `8081` | Key page, the only broker port a route may point at. Must differ from the private port. |
| `WORCA_BROKER_DATA_DIR` | the volume's mount path | The encrypted key store. |
| `WORCA_BROKER_SECRET` | `<per-instance secret>` | Same value as on `worca`. |
| `WORCA_BROKER_VAULT_KEY` | 32 bytes, base64 | Encrypts the store; required in multi mode. `worca broker secrets` prints one. |
| `WORCA_BROKER_PUBLIC_URL` | `https://<key-page host>` | The key page's own origin. |
| `WORCA_BROKER_RETURN_URL` | `https://<instance host>` | Where the key page sends people back to. |
| `WORCA_ALLOWED_HOSTS` | `<key-page host>` | As for `worca`, for the key page. |
| `WORCA_IDENTITY_ISSUER`, `WORCA_IDENTITY_JWKS_URL` | as for `worca` | The key page checks the same identity token. |
| `WORCA_IDENTITY_AUDIENCE` | `<key-page host>` | The key page's audience (default: the host of `WORCA_BROKER_PUBLIC_URL`). |
| `WORCA_BROKER_GITHUB_CLIENT_ID`, `WORCA_BROKER_GITHUB_CLIENT_SECRET`, `WORCA_BROKER_GITHUB_SCOPES` | optional | "Sign in with GitHub" on the key page through the instance's GitHub App. Without them people paste a token. |
| `RAILWAY_RUN_UID`, `PORT` | `0`, `8081` | Railway only (root start for the volume; the port Railway considers the service's). The broker itself doesn't read `PORT`. |

All broker variables and what it refuses: [Multi mode](credential-broker.md#multi-mode).

### `cloudflared`

| Variable | What it does |
| --- | --- |
| `TUNNEL_TOKEN` | The tunnel's token. The tunnel is remotely managed: its ingress (above) is configured at Cloudflare, not in the container. |

### Secrets

Generate these per instance and never reuse them across instances: `WORCA_HEARTBEAT_TOKEN`,
`WORCA_BROKER_SECRET`, `WORCA_BROKER_VAULT_KEY`, `TUNNEL_TOKEN`. Store only a hash of the heartbeat
token on your side; that is all the heartbeat endpoint needs.

To rotate after a leak, replace the heartbeat token, the broker secret (on both containers) and
the tunnel token, then restart all three containers. While they restart, accept the previous
heartbeat token until the first beat arrives with the new one, so the instance isn't cut off.
Rotating the vault key needs `WORCA_BROKER_VAULT_KEY_OLD` and is a separate step
([credential broker](credential-broker.md)).

## Identity token

Worca has no login of its own. Your gate signs people in, then forwards each request (WebSocket
upgrades included) with a short-lived JWT in the `X-Worca-Identity` header. Strip any
`X-Worca-Identity` the browser sent before adding yours.

- **Algorithm**: ES256 (P-256) or RS256, with a `kid` in the header that matches a key in the
  JWKS at `WORCA_IDENTITY_JWKS_URL` (`use` absent or `sig`). Worca caches the keys for 10 minutes
  and fetches them again, at most every 30 s, when it sees an unknown `kid`, so publish a new key
  before signing with it.
- **Checked claims**: `iss` equals `WORCA_IDENTITY_ISSUER` (a trailing slash ignored), `aud`
  is one of the accepted audiences (the instance host), `exp` is in the future and `nbf`, when
  present, in the past, each with 30 s of clock skew.
- **Required claims**: `email` and `sub`. Runs, Ask threads and billing are keyed by the email.
- **Optional claims** Worca reads: `name` (display name), `org`, `inst` and `teams` (array of ids).
- **Lifetime**: short. A WebSocket closes with code `4001` when the token it opened with expires,
  and the UI reconnects through the gate, so the gate checks the person's session again. Five
  minutes works well.
- **Responses**: no or invalid token, 401; keys can't be fetched and none are cached, 503;
  `Host` or `Origin` not allowed, 403. `GET /api/health` answers `{ name, version }` without a
  token, for health checks.

The key page on the broker checks the same token, with its own host as the audience.

## Heartbeat

With both heartbeat variables set, Worca POSTs JSON to `WORCA_HEARTBEAT_URL` about 5 s after it
starts, then every 60 s, with `Authorization: Bearer <WORCA_HEARTBEAT_TOKEN>` and a 10 s timeout.
The body and the meaning of each field are in
[Heartbeat to a control plane](remote-access.md#heartbeat-to-a-control-plane-optional); in short:

```json
{ "health": "ok", "version": "1.19.0",
  "pipelines": { "running": 1, "waiting": 0, "done": 12, "failed": 1, "stopped": 2 },
  "nextScheduledAt": 1767600000, "suspendable": false,
  "today": { "done": 3, "failed": 0, "stopped": 0 } }
```

What a receiver should do with it:

- Answer 401 for an unknown token and 2xx otherwise. Worca doesn't read the response body and
  keeps sending on failures (it logs once per run of failures).
- Ignore fields it doesn't know: new versions may add some (`today` was added that way).
- Treat the first beat after a create, a start or an upgrade as "it's up", and `version` as the
  version actually running.
- Stop the containers only while `suspendable` is `true`; start them again before
  `nextScheduledAt` (Unix seconds) if it is set.
- Show `health: degraded` to the instance's owners; the reason is in Worca's log, not in the beat.

The body carries counts, the version and booleans only: no titles, projects or names.

## Stopping and draining

On `SIGTERM` Worca pauses its active runs with a resume point, waits up to
`WORCA_DRAIN_TIMEOUT_MS` (20 s by default) for the pauses to land, then exits. It exits with
143; the image's `tini -s -e 143` reports that as 0, which some providers need to mark the
deployment stopped rather than crashed.

- Give the container a grace period longer than the drain before `SIGKILL`: 60 s on Railway
  (`drainingSeconds`), `stop_grace_period: 30s` or more in Compose.
- The next start resumes what the drain paused, as the person who last started or resumed each
  run (unless `WORCA_AUTO_RESUME=0`).
- To suspend an idle instance, wait for a heartbeat with `suspendable: true`; a drain is for
  stops that can't wait (an upgrade, a redeploy).
- The broker and `cloudflared` need no drain.

## Versions

- `worca` and `broker` always run the **same image tag**; upgrade both together, then restart
  `cloudflared` only when you change its own pinned version.
- A management interface states the oldest Worca version it supports. Everything on this page
  works from 1.9.0; variables a version doesn't know are ignored, so a newer interface can set
  them on an older instance.
- Release candidates (`x.y.z-rc.N`) are published like releases ([Releasing](RELEASING.md)); offer
  them only to instances that opted in.
- After an upgrade, the first heartbeat reporting the new `version` confirms it. If none arrives,
  roll the image back; the database migration at boot is forward-only, so roll back only to a
  version that ran on that volume before.

## Running one yourself

[`docker/compose.instance.yml`](../docker/compose.instance.yml) adds the hosted shape to the
regular [Docker](docker.md) setup with the [broker overlay](credential-broker.md): `cloudflared`
under the `tunnel` profile, and the variables from this page, commented, for `worca` and `broker`.

```bash
cd docker
# .env: WORCA_BROKER_SECRET, WORCA_BROKER_KEY_ANTHROPIC (single mode), WORCA_PROJECTS, …
docker compose -f compose.yml -f compose.broker.yml -f compose.instance.yml up -d
# with a tunnel: TUNNEL_TOKEN in .env, then add --profile tunnel
```

For a team behind your own gate, uncomment the hosted-mode variables, switch the broker to multi
mode and point the tunnel's ingress at `worca:4317` and `broker:8081`.
