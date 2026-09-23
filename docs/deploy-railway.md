# Worca on Railway, behind Cloudflare Access

This runs worca as an always-on hosted service: the published container image on
[Railway](https://railway.com), reachable only through a Cloudflare Tunnel with Cloudflare
Access in front, and worca checking the Access token on every request itself. Read
[remote-access.md](remote-access.md) first; it explains the security model and the Cloudflare
side. This page covers only what is specific to Railway.

```
browser ─► Cloudflare Access ─► Tunnel ─► cloudflared ──(Railway private network)──► worca ─► /data volume
                                           service 2                                  service 1
```

## Why this shape

- **The published image, not a build.** Railway deploys `ghcr.io/sinishadjukic/worca:<version>`,
  the same signed image the release workflow publishes. Pushing to the repo never redeploys, so it
  never interrupts running agents. An upgrade is an explicit change of the image tag.
- **One volume, `/data`.** Railway gives a service one volume and mounts it root-owned. With
  `WORCA_DATA_DIR=/data` the image's entrypoint starts as root only to prepare that volume (the
  worca home, the projects and `HOME` itself), then drops to the `worca` user for everything it
  runs. Because `HOME` is on the volume, Claude Code's login and `~/.claude.json` survive redeploys.
- **No public domain on worca.** `cloudflared` runs as its own service and dials out, so the
  tunnel is the only way in. As a separate service it also never counts as an in-container caller.
- **One replica.** Worca's run registry and WebSocket replay buffers are in memory.

## Services

One Railway **project per deployment**, named `worca-NN`, with two services.

### `worca`

| Setting | Value |
| --- | --- |
| Source | Docker image `ghcr.io/sinishadjukic/worca:<version>` (pin an exact version) |
| Volume | mounted at `/data` |
| Networking | **no** public domain (delete one if Railway generated it) |
| Replicas | 1 |
| Healthcheck path | `/api/health` |
| Restart policy | on failure |

Variables:

| Variable | Value |
| --- | --- |
| `RAILWAY_RUN_UID` | `0`: start as root so the entrypoint can prepare the volume; it drops to `worca` itself |
| `WORCA_DATA_DIR` | `/data` |
| `WORCA_HOST` | `::`: listen on IPv6 and IPv4 (Railway's private network) |
| `PORT` | `4317` |
| `WORCA_ALLOWED_HOSTS` | `worca-NN.example.com,healthcheck.railway.app` (Railway's healthcheck sends `Host: healthcheck.railway.app`; it can reach only `/api/health` without a token) |
| `WORCA_CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `WORCA_CF_ACCESS_AUD` | the AUD tag of the `worca-NN` Access application |
| `CLAUDE_CODE_OAUTH_TOKEN` *or* `ANTHROPIC_API_KEY` | secret: from `claude setup-token` on a subscription account, or an API key with a spend limit |
| `GH_TOKEN` | secret: a fine-grained PAT for the repos you run, with *contents* and *pull requests* write access |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` | your identity; without it agents cannot commit |

If the Access variables are missing, worca refuses to start and logs why. It won't run
unprotected.

### `cloudflared`

| Setting | Value |
| --- | --- |
| Source | Docker image `cloudflare/cloudflared:<pinned tag>` |
| Start command | `tunnel --no-autoupdate run` |
| Variable | `TUNNEL_TOKEN`: the tunnel's token (secret) |

In the Cloudflare tunnel, the public hostname `worca-NN.example.com` points to
`http://worca.railway.internal:4317`. The service is named `worca`, so that's its private hostname.

## First run

1. Deploy both services and open `https://worca-NN.example.com`. Sign in through Access.
2. Clone your repos into `/data/projects` from the Railway shell of the `worca` service
   (`git clone https://github.com/you/app.git /data/projects/app`), then add
   `/data/projects/app` as a project in the UI.
3. Turn on volume backups, and check the usage page after a week.

## Upgrades and restarts

Change the image tag and redeploy. Railway stops the old container before starting the new one,
because a volume can't be attached to two containers. Running agents get SIGTERM and pause; resume
them afterwards. Worca picks up the interrupted Claude sessions.

## Limits

- Every allowed person is an administrator of this box (see
  [remote-access.md](remote-access.md#limits)). Use one deployment per person or per set of
  credentials.
- Hobby volumes stop at 5 GB, which a couple of repos with worktrees and `node_modules` can
  outgrow. Use Pro (50 GB and up).
