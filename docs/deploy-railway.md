# Worca on Railway, behind Cloudflare Access

This runs worca as an always-on hosted service: the published container image on
[Railway](https://railway.com), reachable only through a Cloudflare Tunnel with Cloudflare Access
in front, and worca verifying the Access token on every request itself.
[remote-access.md](remote-access.md) explains the security model and has the Cloudflare reference;
this page walks through a complete deployment.

```
browser ─► Cloudflare Access ─► Tunnel ─► cloudflared ──(Railway private network)──► worca ─► /data volume
                                           service 2                                  service 1
```

The examples use the hostname `worca.example.com` and the Zero Trust team `acme`; replace both with
your own.

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
- **Agents under their own user.** Agents and workflow scripts run as `worca-agent`. They share
  the projects and run checkouts with worca, but cannot read its settings, database, `HOME` or
  environment, and never get a GitHub token. Pushes and pull requests are worca's own calls. If
  the runtime refuses the user switch, a hosted worca exits instead of running agents as itself
  (`WORCA_AGENT_ISOLATION=0` accepts that explicitly).

## 1. Prepare

| You need | Notes |
| --- | --- |
| A Railway account on **Hobby** or **Pro** | Hobby volumes stop at 5 GB, which a few repos with worktrees and `node_modules` can outgrow; Pro starts at 50 GB. |
| A domain on Cloudflare and a Zero Trust organization | See [remote-access.md → Before you start](remote-access.md#before-you-start). |
| Claude credentials | **Either** a subscription token from `claude setup-token` (runs count against your Claude plan) **or** an Anthropic API key (billed per token; set a spend limit). Run `claude setup-token` in your own terminal: it prints the token. |
| A GitHub token (for pushes and PRs) | A fine-grained personal access token limited to the repos you'll run, with **Contents** and **Pull requests** read/write. Not needed for a first test on a local repo. |
| The image version | Pick an exact tag of `ghcr.io/sinishadjukic/worca` (e.g. `1.5.0`), not `latest`. |

Keep the secrets (Claude token, GitHub token, and the tunnel token from step 2) in a password
manager or a local file outside any repository until you paste them into Railway.

## 2. Cloudflare: tunnel and Access application

Follow [remote-access.md → Cloudflare setup](remote-access.md#cloudflare-setup-dashboard) with these
values:

- **Tunnel** public hostname: `worca.example.com` → service **HTTP**,
  URL `worca.railway.internal:4317`. `worca` is the Railway service name you'll use in step 3; the
  private hostname is always `<service name>.railway.internal`.
- **Access application** for `worca.example.com`, with an Allow policy for your email (and One-time
  PIN as a login method).

Note down the **tunnel token**, the **team domain** (`acme.cloudflareaccess.com`) and the
application's **AUD tag**.

## 3. Railway: the two services

One Railway **project per deployment**. Use either the dashboard or the CLI.

### With the dashboard

1. **New project → Deploy a Docker image** → `ghcr.io/sinishadjukic/worca:<version>`.
   Rename the service to exactly **`worca`** (Settings → Service name): that name becomes its private
   hostname `worca.railway.internal`, which the tunnel points to.
2. `worca` → **Settings**:
   - **Volumes → Add volume**, mount path **`/data`**.
   - **Networking**: make sure there is **no** public domain; delete one if Railway generated it.
   - **Deploy**: healthcheck path **`/api/health`**, restart policy *On failure*, 1 replica.
3. `worca` → **Variables**:

   | Variable | Value |
   | --- | --- |
   | `RAILWAY_RUN_UID` | `0`: start as root so the entrypoint can prepare the volume; it drops to `worca` itself |
   | `WORCA_DATA_DIR` | `/data` |
   | `WORCA_HOST` | `::`: listen on IPv6 and IPv4 (Railway's private network) |
   | `PORT` | `4317` |
   | `WORCA_ALLOWED_HOSTS` | `worca.example.com,healthcheck.railway.app`: Railway's healthcheck sends `Host: healthcheck.railway.app`, and with that host it can reach only `/api/health` |
   | `WORCA_CF_ACCESS_TEAM_DOMAIN` | `acme.cloudflareaccess.com` |
   | `WORCA_CF_ACCESS_AUD` | the application's AUD tag |
   | `CLAUDE_CODE_OAUTH_TOKEN` *or* `ANTHROPIC_API_KEY` | secret. Needed as a variable: agents run as their own user and cannot use a login stored in worca's `HOME` |
   | GitHub | One of three, all optional at first. A **GitHub App** (recommended when several people share the deployment): `WORCA_GH_APP_ID`, `WORCA_GH_APP_KEY_B64` (secret, seal it) and optionally `WORCA_GH_APP_INSTALLATION_ID`; see [GitHub App](#github-app). Or `GH_TOKEN`. Or two tokens, `WORCA_GH_READ_TOKEN` (clone, fetch: Contents read) and `WORCA_GH_WRITE_TOKEN` (push, PRs: Contents and Pull requests read/write). Agents never get either |
   | `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` | the identity agents commit with |

   If the Access variables are missing, worca refuses to start and logs why. It won't run
   unprotected.
4. **New → Docker image** → `cloudflare/cloudflared:<tag>` (pin a tag). In its settings:
   - **Start command**: `cloudflared tunnel --no-autoupdate run`. Railway's start command
     *replaces* the image's entrypoint, so it must name the binary; `tunnel run` alone fails
     immediately, without any log output.
   - **Variables**: `TUNNEL_TOKEN` = the tunnel token (secret).
   - No volume, no public domain, restart policy *Always*.
5. Deploy both.

### With the Railway CLI

The same setup from a terminal (`npm i -g @railway/cli`, then `railway login`). Run it in an empty
folder: `railway init` links the current folder to the new project.

```bash
railway init --name worca --workspace "<workspace name or id>"

railway add --service worca --image ghcr.io/sinishadjukic/worca:<version> \
  --variables "RAILWAY_RUN_UID=0" --variables "WORCA_DATA_DIR=/data" \
  --variables "WORCA_HOST=::" --variables "PORT=4317" \
  --variables "WORCA_ALLOWED_HOSTS=worca.example.com,healthcheck.railway.app" \
  --variables "WORCA_CF_ACCESS_TEAM_DOMAIN=acme.cloudflareaccess.com" \
  --variables "WORCA_CF_ACCESS_AUD=<aud tag>" \
  --variables "GIT_AUTHOR_NAME=<name>" --variables "GIT_AUTHOR_EMAIL=<email>" \
  --variables "GIT_COMMITTER_NAME=<name>" --variables "GIT_COMMITTER_EMAIL=<email>"

railway add --service cloudflared --image cloudflare/cloudflared:<tag>

# IDs for the API calls below
railway status --json
```

The volume and the service settings go through Railway's GraphQL API (`railway api`), with the
project, environment and service IDs from `railway status --json`:

```bash
railway api 'mutation($i: VolumeCreateInput!){ volumeCreate(input:$i){ id } }' \
  --variables '{"i":{"projectId":"<project>","environmentId":"<env>","serviceId":"<worca service>","mountPath":"/data"}}'

railway api 'mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s, environmentId:$e, input:$i) }' \
  --variables '{"s":"<worca service>","e":"<env>","i":{"healthcheckPath":"/api/health","healthcheckTimeout":120,"numReplicas":1,"restartPolicyType":"ON_FAILURE","restartPolicyMaxRetries":5,"drainingSeconds":60}}'

railway api 'mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s, environmentId:$e, input:$i) }' \
  --variables '{"s":"<cloudflared service>","e":"<env>","i":{"startCommand":"cloudflared tunnel --no-autoupdate run","restartPolicyType":"ALWAYS"}}'
```

Add the secrets from stdin, so they never appear on a command line or in your shell history
(paste the value, then press Ctrl-D):

```bash
railway variable set -s worca --stdin CLAUDE_CODE_OAUTH_TOKEN   # or ANTHROPIC_API_KEY
railway variable set -s worca --stdin GH_TOKEN
railway variable set -s cloudflared --stdin TUNNEL_TOKEN
```

Setting a variable redeploys the service. Other settings changes apply on the next deploy
(`railway redeploy -s <service>`, or the dashboard's *Redeploy*).

## 4. Check it

1. **worca logs** (`railway logs -s worca`, or the dashboard) show
   `remote access on for worca.example.com, healthcheck.railway.app; identity: cloudflare-access (acme.cloudflareaccess.com)`
   and `Claude Code auth: CLAUDE_CODE_OAUTH_TOKEN` (or your API key) rather than *not logged in*.
2. **cloudflared logs** show `Registered tunnel connection` (four times) and the tunnel is *Healthy*
   in Cloudflare.
3. Open `https://worca.example.com`, sign in through Access, and you're in worca.
4. For a scripted check (including worca's own token check), see
   [remote-access.md → Check the setup](remote-access.md#check-the-setup).

## 5. First project

Projects live on the volume under `/data/projects`. Add one from the UI: **Projects → Add project →
Clone from URL**, with the repository's `https://` URL and, optionally, a branch and a folder name.
Worca clones it with the deployment's GitHub read credential (token or App), as the `worca` user,
into a new folder, and registers it. The same works from Ask Worca ("set up github.com/acme/api"
proposes a card you apply) and from a shell with `worca add --clone <url>`.

- Only `https://` URLs; a URL with credentials in it is refused (the credential belongs in the
  service variables).
- `WORCA_CLONE_ALLOW` limits what can be cloned, for example `github.com/acme/*,github.com/you/app`.
  Unset, anything the credential can read is allowed.
- An existing folder is never overwritten. A clone that fails or takes longer than 10 minutes
  removes its folder. Large repositories are cloned partially (`--filter=blob:none`) and fetch
  file contents as they are needed.

Ask Worca knows it runs hosted. Each turn tells it the projects folder, whether a GitHub credential is
set, and who is signed in. It points people here to add a project, never asks for a token in chat,
and says that pull requests come from the deployment's GitHub account.

## GitHub App

With an App, worca holds an App ID and a private key instead of a long-lived token. For each
fetch, push or pull request it creates an installation token that lasts at most an hour, scoped
to what that call needs (read, or read and write), and drops it afterwards. A run lasting days
still pushes, because the token is created at push time. Pull requests show the App as their
author.

1. On GitHub, under the account that owns the repositories: **Settings → Developer settings →
   GitHub Apps → New GitHub App**. Name it for its role (for example `worca-ci`), leave the
   webhook off, and grant **Contents: read and write** and **Pull requests: read and write**.
   Nothing else.
2. **Generate a private key**; a `.pem` file downloads. It is the only long-lived secret.
3. **Install App** on the repositories this deployment works on. The installation ID is the number
   at the end of the installation's settings URL.
4. On the `worca` service, set `WORCA_GH_APP_ID`, `WORCA_GH_APP_INSTALLATION_ID`, and the key as
   base64 from stdin, so it never appears on a command line:

   ```bash
   base64 < worca-ci.private-key.pem | tr -d '\n' | railway variable set WORCA_GH_APP_KEY_B64 --stdin --service worca --skip-deploys
   ```

   Then seal `WORCA_GH_APP_KEY_B64` in the dashboard. Where the key can be mounted as a file,
   `WORCA_GH_APP_KEY_FILE=/path/key.pem` works too.

An App can only reach repositories owned by the account that owns the App. If a repository moves
to an organisation, create and install a new App there first, then swap the variables.

## Operate your deployment

A deployment is a fixed image plus service variables. Pushing to the repository never changes it:
you decide when it upgrades, and every change below is one command. Each one restarts the `worca`
service: Railway stops the old container before starting the new one (a volume can't be attached
to two), running agents get SIGTERM and pause, and you resume them afterwards. Projects, runs,
settings and the database are on `/data` and survive; schema migrations run on boot.

### The operations tool

`tools/railway/worca-railway.mjs` (in this repository) does all of it against a **target**: a local
file describing one deployment, never committed. Copy
[`tools/railway/targets.example.env`](../tools/railway/targets.example.env) to
`~/.config/worca/targets/<name>.env`, `chmod 600` it, and fill in the Railway ids (from the
dashboard URL or `railway status --json`), the hostname, the image repositories, and the paths to
your Access service-token file and SSH key. The target holds ids and paths only; secrets stay in
the files it points to, which the tool uses but never prints.

```bash
node tools/railway/worca-railway.mjs status mydeploy       # image, deployment, variable NAMES, boot log
node tools/railway/worca-railway.mjs verify mydeploy --in-container
```

Every command that changes the deployment needs `--yes`. The tool always names the service,
environment and project explicitly, lists variables by name only, sends values only on stdin, and
redacts tokens from anything it prints. In Claude Code, the `/worca-railway` skill drives it.

### Upgrade or roll back

Releases publish `ghcr.io/sinishadjukic/worca:<version>`. Pin an exact version, never `latest`:

```bash
node tools/railway/worca-railway.mjs upgrade mydeploy 1.5.0 --yes    # set the tag, deploy, wait, show the log
node tools/railway/worca-railway.mjs verify mydeploy --in-container
node tools/railway/worca-railway.mjs rollback mydeploy --yes         # back to the previous image
```

By hand: the service's **Settings → Source → Image**, then **Deploy**.

### Test an unreleased branch

Build the current checkout for Railway's platform, push it to a registry you control, and deploy
it (`BRANCH_IMAGE_REPO` in the target; `docker login` to that registry first):

```bash
node tools/railway/worca-railway.mjs deploy-branch mydeploy --tag my-branch-1 --yes
```

The instance then runs an unreleased image until you `upgrade` it to a release again.

### Change configuration

| Change | Command |
| --- | --- |
| Claude token (real runs) | `claude setup-token` in your terminal, then `node tools/railway/worca-railway.mjs set mydeploy CLAUDE_CODE_OAUTH_TOKEN --yes` and paste it (read from stdin). Agents run as their own user and can't use a login stored in worca's `HOME`, so it must be a variable. |
| Mock mode off / on | `mock mydeploy off --yes` / `mock mydeploy on --yes` (the UI's per-run mock switch still works) |
| GitHub App key, new or rotated | `base64 < key.pem \| tr -d '\n' \| node tools/railway/worca-railway.mjs set mydeploy WORCA_GH_APP_KEY_B64 --yes` |
| Tokens instead of an App | `set … GH_TOKEN` (or the read/write pair), then `unset … WORCA_GH_APP_ID` and the other `WORCA_GH_APP_*` |
| Limit what can be cloned | `printf %s 'github.com/acme/*' \| node tools/railway/worca-railway.mjs set mydeploy WORCA_CLONE_ALLOW --yes` |
| Several changes, one restart | `--skip-deploys` on each `set` / `unset`, then `redeploy mydeploy --yes` |

After setting a secret, **seal** it in the Railway dashboard (the variable's menu). `status` marks a
variable `(sealed)` when Railway no longer returns its value; if a secret you sealed is not marked,
check it in the dashboard.

Not in Railway at all:

- **People** are added or removed in the Cloudflare Access application's policy. Worca needs no
  change.
- The **tunnel token** is a variable of the `cloudflared` service; the hostname is Cloudflare's,
  plus `WORCA_ALLOWED_HOSTS` on worca.

### What expires

| Credential | Lifetime | Renew |
| --- | --- | --- |
| Claude token from `claude setup-token` | about a year | a new token, `set … CLAUDE_CODE_OAUTH_TOKEN` |
| GitHub fine-grained tokens | what you chose at creation | a new token, `set` it |
| GitHub App installation tokens | an hour, minted per call | nothing to do |
| Access service token | what you chose at creation | Zero Trust → Service Auth, then update your local token file |

### Verify

`verify <target>` checks, through Access: an anonymous request is sent to sign-in, your service
token passes, `/api/health` and `/api/whoami` answer, and a clone URL with credentials is refused.
`--in-container` adds, over `railway ssh` (register your key once with `railway ssh keys add`):
requests that bypass Access get 401/403, the server runs as `worca`, agents run as `worca-agent`
and cannot read its environment, database or `HOME`, `sudo` to root is refused, and the GitHub
credential works. `--clone https://github.com/<owner>/<repo>` also clones a real repository and
registers it (remove it in Projects afterwards).

## Backups and cost

- Turn on **volume backups** for the `worca` service's volume.
- Railway bills per second for what the containers use (memory, CPU, volume, egress). An idle worca
  plus cloudflared is small; runs with several `claude` processes, git and your test suites are what
  drives it. Check the project's usage page after a week and set a usage limit.
- Claude usage is separate: a subscription token counts against your Claude plan's limits, an API
  key is billed per token.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `cloudflared` deployment fails instantly with no logs | Start command without the binary name | `cloudflared tunnel --no-autoupdate run` |
| `cloudflared` logs only `cloudflared version …` in a loop | No start command: the image's default just prints its version | Set the start command. |
| Cloudflare error **1033** | `cloudflared` isn't connected | Check `TUNNEL_TOKEN` and the cloudflared logs. |
| Cloudflare **502** | cloudflared can't reach worca | The tunnel URL must be `worca.railway.internal:4317` (service name + `PORT`); `WORCA_HOST` must be `::`. |
| worca exits with code **78**: `/data is not writable … RAILWAY_RUN_UID=0` | Started as the image's non-root user on a root-owned volume | Set `RAILWAY_RUN_UID=0`. |
| worca exits: `remote access: …` | Incomplete Access settings | See [remote-access.md](remote-access.md#worca-refuses-to-start-if-the-setup-is-unsafe). |
| Deploy fails its **healthcheck** | `healthcheck.railway.app` missing from `WORCA_ALLOWED_HOSTS` (worca answers 403) | Add it. |
| Every run is a mock run | `WORCA_MOCK=1` is set on the service | Remove it; the UI's mock toggle still works per run. |
| *Claude Code is not logged in* in the logs | No Claude credentials | Set `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` and redeploy. |
| `railway ssh`: *Host key verification failed* | First connection from a non-interactive shell | Run `railway ssh` once in an interactive terminal and accept Railway's host key. |
| A clone or file can't be written by worca | Created as root in a `railway ssh` session | Create it as `worca` (`su -s /bin/sh worca -c '…'`), or `chown -R worca:worca` it. |

## Limits

- Every allowed person is an administrator of this worca (see
  [remote-access.md → Limits](remote-access.md#limits)). Use one deployment per person or per set of
  credentials.
- One replica only; deploys pause running agents (see [Operate your deployment](#operate-your-deployment)).
