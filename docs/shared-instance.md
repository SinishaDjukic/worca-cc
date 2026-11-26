# Shared instance

One Worca for a team, on a Linux server or VM, with Docker Compose. It runs with the same hardening as the
[Hardened box](hardened-box.md), plus a sign-in in front and keys per person. This page is a reference profile, not
a command: `docker/compose.shared.yml` and `docker/shared.env.example`.

## When to use this

**Who it is for.** A team that wants one Worca to share: the same projects, workflows and runs, on a server the team
runs. One operator sets it up and keeps it running.

**What you keep.** The same Worca, in a browser, behind your sign-in. Each person uses their own model key and their
own GitHub token. Costs are told apart per person.

**What it protects.**

- Agents cannot read a model key. Each person saves theirs on the key page. The credential broker holds it, in a
  container of its own. Worca holds none.
- Agents cannot read a GitHub token. Each person's token stays in the broker. Worca asks for it for one push at a
  time, and agents never get it.
- Agents cannot read the corporate proxy login. It is a technical user's login, supplied by the operator as a file.
  Only the egress sidecar mounts it.
- Each person's agents run under their own user. They cannot read Worca's settings, database or environment, nor
  another person's processes.
- Worca's network has no route out. The sidecar lets through only the hosts on the allow-list.
- No host folder is mounted. Projects are cloned into the data volume. Results leave as pull requests.

**Who can do what.** Every signed-in person is an administrator. There is no privacy between teammates: everyone
sees every project, run, chat, transcript and setting, and can change them. Sign in only people you would give the
whole instance to. The sign-in in front decides who that is.

**Its limits.** It is not "no secrets": an MCP registry secret a run uses stays in that run's reach. More than 16
people share agent users. The containers share the server's kernel. The full list is under [Limits](#limits).

## How it fits together

```
  people ─► Cloudflare Access (worca.acme.example)      ─┐
  people ─► Cloudflare Access (worca-keys.acme.example) ─┤ one tunnel (cloudflared)
                                                         ▼
  ┌──────────────── internal network: no route out ──────────────────┐
  │ worca :4317   agents as worca-agent-01…16, no keys, no tokens     │
  │ broker :8080 (private)   :8081 (key page)   vault: keys per person│
  │ egress :3128   allow-list, the proxy login (a secret file)        │
  └────────────────────────────────────┬─────────────────────────────┘
                                       ▼
            the allow-listed hosts, through the corporate proxy when there is one
```

Nothing is published on the server. cloudflared dials out to Cloudflare and reaches Worca and the key page on the
compose network.

## The values to supply

Copy `docker/shared.env.example` to `shared.env` next to the compose files. It lists every value.

| Value | Where | What it is |
| --- | --- | --- |
| `WORCA_INSTANCE_HOST` | `shared.env` | Worca's host name, for example `worca.acme.example` |
| `WORCA_KEYPAGE_HOST` | `shared.env` | The key page's own host name, first level (`worca-keys.acme.example`) |
| `WORCA_CF_ACCESS_TEAM_DOMAIN`, `WORCA_CF_ACCESS_AUD` | `shared.env` | Worca's Cloudflare Access application |
| `WORCA_BROKER_CF_ACCESS_TEAM_DOMAIN`, `WORCA_BROKER_CF_ACCESS_AUD` | `shared.env` | The key page's own Access application (another AUD) |
| `WORCA_IDENTITY_HEADER` and the rest | `shared.env` | Instead of Access: an identity proxy of your own ([below](#an-identity-proxy-instead-of-access)) |
| `HTTPS_PROXY`, `NO_PROXY` | `shared.env` | The corporate proxy, host and port only. Empty when there is none |
| `WORCA_PROXY_LOGIN` | `shared.env` | The path to the technical user's login file. Empty when the proxy needs no login |
| `WORCA_EGRESS_ALLOW` | `shared.env` | The allow-list: `api.anthropic.com`, your git host, your package registries |
| `WORCA_GH_AS_PERSON` | `shared.env` | `required` (the default here) or `prefer`: pushes as the person who acted |
| `broker_secret`, `egress_secret` | files in `WORCA_SECRETS_DIR` | 32 or more random characters each |
| `broker_vault_key` | a file | 32 bytes, base64. It encrypts the keys at rest. Keep a copy in the team's password manager |
| `tunnel_token` | a file | The cloudflared tunnel's token |

Secrets are files, never values in `shared.env`. Compose mounts each one into the containers that need it, at
`/run/secrets/…`, and the `…_FILE` variables point there. A compose secret keeps the host file's mode and owner.
Every container here runs as uid 1000, so every secret file is **owned by uid 1000 with mode 0600**:

| File | Read by | Owner and mode | Checked at start |
| --- | --- | --- | --- |
| `broker_secret` | Worca and the broker | `1000:1000`, `0600` | Worca refuses to start otherwise |
| `egress_secret` | Worca and the sidecar | `1000:1000`, `0600` | Worca refuses to start otherwise |
| GitHub App key (`WORCA_GH_APP_KEY`), optional | Worca | `1000:1000`, `0600` | Worca refuses to start otherwise |
| `broker_vault_key` | the broker only | `1000:1000`, `0600` | no: agents never run in the broker's container |
| GitHub client secret (`WORCA_BROKER_GITHUB_CLIENT_SECRET_PATH`), optional | the broker only | `1000:1000`, `0600` | no: the same |
| `proxy_login.json` (`WORCA_PROXY_LOGIN`), optional | the sidecar only | `1000:1000`, `0600` | no: agents never run in the sidecar |
| `tunnel_token` | cloudflared only | `1000:1000`, `0600` | no |

Agents run in Worca's container under their own users. A file there that its group or others can read is one
`cat` away, so Worca checks each file it reads, once, at start. A bad one stops it with a line that names the file
and the fix. Make the files like this:

```bash
mkdir -p secrets
docker run --rm ghcr.io/worca-org/worca:latest worca broker secrets   # prints values to copy into the two files
openssl rand -base64 32 > secrets/broker_vault_key
# paste the values into secrets/broker_secret, secrets/egress_secret and secrets/tunnel_token
worca proxy hash > secrets/proxy_login.json     # only with a proxy login: DOMAIN\user and the password, hidden
sudo chown 1000:1000 secrets/* && sudo chmod 600 secrets/*
stat -c '%U:%G %a %n' secrets/*                 # -> 1000:1000 600 for every file (names instead of 1000 if uid 1000 has one)
```

`worca proxy hash` saves nothing. Its file holds the domain, the user and the NT hash, never the password. The
sidecar then runs in managed mode: the Settings card shows the login's status only, and no one can change it from
Worca.

At Cloudflare: one remotely managed tunnel with two public host names. `WORCA_INSTANCE_HOST` goes to
`http://worca:4317`. `WORCA_KEYPAGE_HOST` goes to `http://broker:8081`, never 8080. Each host name gets its own
Access application with the team's Allow policy. The steps are in [remote-access.md](remote-access.md) and in
[credential-broker.md → Cloudflare Access and Railway](credential-broker.md#cloudflare-access-and-railway).

### An identity proxy instead of Access

A proxy of your own (oauth2-proxy, for example) can sign people in instead. Leave the four Access values empty and set
`WORCA_IDENTITY_HEADER`, `WORCA_IDENTITY_TRUSTED_PROXIES` and `WORCA_INSECURE_NO_IDENTITY_CHECK=1`, plus the
`WORCA_BROKER_IDENTITY_*` pair for the key page. The proxy must verify the person and strip any copy of the header a
browser sends. It needs a fixed address on the compose network, and that address must never be a range that includes
Worca's container. Add it in a file of your own after `compose.shared.yml`. This profile ships no such proxy.

## Start it

From the folder with the compose files (`worca container where` prints one, or a checkout's `docker/`):

```bash
docker compose --env-file shared.env \
  -f compose.yml -f compose.broker.yml -f compose.isolation.yml -f compose.egress.yml \
  -f compose.proxy.yml -f compose.shared.yml --profile tunnel up -d
```

The order matters. `compose.proxy.yml` follows `compose.egress.yml`. `compose.shared.yml` goes last, because it sets
the secret-file variables the others leave empty. It needs Docker Compose 2.24 or newer and an image with the egress
sidecar (the label `dev.worca.egress-sidecar`).

Then each person opens Worca, signs in, and saves their model key and GitHub token on the key page
(**Settings › General › My credentials › Manage keys**).

## Check that it is safe

Run these after every change. Each one names the answer you should see. `dc` is the compose command above without
`up -d`.

```bash
dc() { docker compose --env-file shared.env -f compose.yml -f compose.broker.yml -f compose.isolation.yml \
  -f compose.egress.yml -f compose.proxy.yml -f compose.shared.yml --profile tunnel "$@"; }

# 1. Without a sign-in, Cloudflare answers, not Worca: a redirect to your team's sign-in page.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://worca.acme.example/api/health
#    -> 302 https://acme.cloudflareaccess.com/...
curl -s -o /dev/null -w '%{http_code}\n' https://worca-keys.acme.example/
#    -> 302

# 2. Nothing is published on the server, and every secret file is 0600, owned by uid 1000.
stat -c '%u %a %n' secrets/*
#    -> 1000 600 for each file
dc ps --format '{{.Service}} {{.Publishers}}'
#    -> every service with an empty list

# 3. Worca runs in multi mode with the broker, and agents under their own users.
dc logs worca | grep -E 'credentials: broker|agents run as|own user'
#    -> credentials: broker multi, key page https://worca-keys.acme.example, slots …
#    -> agents run as worca-agent; they cannot read worca's settings, database or environment
#    -> each signed-in person's agents run as their own user (16 in the pool)

# 4. The box holds no model key and no GitHub token.
dc exec -T worca sh -c 'printenv | grep -cE "^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_AUTH_TOKEN|GH_TOKEN|GITHUB_TOKEN)=."'
#    -> 0
dc exec -T worca sh -c 'ls /data/home/.claude/.credentials.json 2>&1'
#    -> ls: cannot access '/data/home/.claude/.credentials.json': No such file or directory

# 5. The box holds no proxy login. Its proxy variables name the sidecar only, without a login.
dc exec -T worca sh -c 'printenv | grep -i "_proxy="'
#    -> HTTPS_PROXY=http://egress:3128 and HTTP_PROXY=http://egress:3128 (NO_PROXY aside)
dc exec -T worca sh -c 'find /data -name proxy-login.json 2>/dev/null | wc -l'
#    -> 0
dc exec -T egress worca egress status
#    -> Held by: the egress sidecar (managed by the operator: status only)

# 6. An unlisted host is refused, and there is no way around the sidecar.
dc exec -T worca curl -s -o /dev/null -w '%{http_connect}\n' https://example.org
#    -> 403
dc exec -T worca curl -s -m 5 --noproxy '*' https://example.org; echo "exit $?"
#    -> exit 6 (or 7, or 28): no route out
dc exec -T worca curl -s -o /dev/null -w '%{http_code}\n' https://api.github.com
#    -> 200: a listed host works

# 7. A request that claims to come from outside, made inside Worca's container, is refused by Worca itself.
dc exec -T worca curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: worca.acme.example' http://127.0.0.1:4317/api/projects
#    -> 401
```

`dc logs egress` has one `DENY` line per refused host. Add a host your team needs to `WORCA_EGRESS_ALLOW`, then run
`up -d` again.

## Kubernetes

The same containers and variables run on Kubernetes. This profile ships no manifests: they could not be tested here.
Map it like this:

| Compose | Kubernetes |
| --- | --- |
| `worca`, `broker`, `egress`, `cloudflared` services | one Deployment each (one replica each; `worca` and `broker` are stateful), same image and command |
| `worca-data`, `broker-data`, `egress-data` volumes | a PersistentVolumeClaim each, at `/data`, `/worca` and `/worca` |
| the `internal` network with no route out | a NetworkPolicy: `worca` pods may reach only `broker`, `egress` and DNS; only `egress` and `cloudflared` may reach out |
| the compose service names | Services `broker` (8080, cluster only; 8081 for the key page), `egress` (3128, 3129) and `worca` (4317) |
| `secrets:` files | Kubernetes Secrets mounted as files at the same `/run/secrets/…` paths |
| `compose.isolation.yml`'s user and capabilities | `worca` starts as root with exactly those capabilities and `allowPrivilegeEscalation: true` (the switch to agent users is a `sudo`) |
| cloudflared, or your identity proxy | a cloudflared Deployment, or your Ingress with its sign-in; the key page on its own host |

Two things differ. A NetworkPolicy needs a network plugin that enforces it; without one, the policy is ignored and
Worca has a route out. And Kubernetes mounts Secret files owned by root: Worca needs its broker secret file owned by
uid 1000 with mode 0600, so copy it in an init container, or give that one value as a variable from the Secret.

## Railway is the weaker option

A shared instance also runs on Railway: see [deploy-railway.md](deploy-railway.md). The broker, agent users and keys
per person work the same. The network does not. Railway has no internal-only network, so the outbound policy holds
only for tools that respect the proxy settings. A program that opens its own connection goes straight out. Keys are
still safe there; other data can leave. Use Compose or Kubernetes when the network limit matters.

## Limits

- **Not "no secrets".** The claim is: no model key, no GitHub token and no proxy login in an agent's reach.
- **No privacy between teammates, no roles.** Every signed-in person is an administrator.
- **MCP registry secrets** stay readable by the agents of a run that uses them.
- **More than 16 people** share agent users, so two of them can spend each other's live tokens (never read a key).
- **Code one person's run plants** in a shared repository can run in another person's run.
- **One kernel.** The containers share the server's kernel.
- **The allow-list holds by host name.** A listed host can receive anything an agent sends it.
- **Bedrock, Vertex and Foundry** are not covered by the broker.
- **Not run on a real server yet.** The merged compose files were checked with `docker compose config`; the
  containers have not been started together from this profile, and the tunnel's `--token-file` was not tried.

More on each: [credential-broker.md → Limits and accepted risks](credential-broker.md#limits-and-accepted-risks).
