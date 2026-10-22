# Operating a self-hosted E2B

How to run, check, upgrade and size a self-hosted E2B for Worca's E2B execution environment ([`e2b.md`](e2b.md)).
Two shapes are covered: a VM on a Linux server, reached through an SSH tunnel, and a VM on your own Mac (set up
with [`e2b-local-mac.md`](e2b-local-mac.md)). A Worca server uses one E2B at a time (see
[Switching between two E2B servers](#switching-between-two-e2b-servers)). Both run E2B Embed, the upstream docker
compose package from [`e2b-dev/runtime`](https://github.com/e2b-dev/runtime/tree/main/embed/compose).

Keep the keys and the model token out of repositories, for example in `~/.config/worca-e2b/` (mode 700):

| File | What it holds |
|---|---|
| `remote.sh` | `E2B_API_KEY`, `E2B_API_URL`, `E2B_SANDBOX_URL` for the remote E2B |
| `local.sh` | the same three for the local VM |
| `model.sh` | `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) for Worca's server; it signs the sandboxes' model calls and never enters a sandbox |
| `start-ui-e2b.sh` | starts the Worca server against one of them |

## A VM on a Linux server

- **The VM**: KVM under libvirt (or any hypervisor that gives the guest `/dev/kvm`), Ubuntu 24.04, sized for the
  sandboxes it should hold at once (see [Sizing](#sizing)). Give it its own disk with room for templates and
  snapshots, and let it autostart with the host.
- **Network**: keep the VM on a private network. Let only the host reach ports 22 and 3000–3002, and drop the
  rest. Port 5008, E2B's admin API, has no authentication and must never leave the VM.
- **The stack**: E2B Embed in a folder of its own, started by a oneshot systemd unit that runs
  `docker compose up -d --wait` after the firewall and docker, with `HUGEPAGES` set in its environment. After a
  VM reboot the stack comes back by itself in a few minutes.

### Reaching it from your machine

An SSH host entry that forwards the three ports to your loopback:

```text
Host e2b-remote
  HostName <server address>
  User <user>
  LocalForward 127.0.0.1:3000 <vm address>:3000
  LocalForward 127.0.0.1:3001 <vm address>:3001
  LocalForward 127.0.0.1:3002 <vm address>:3002
  ExitOnForwardFailure yes
  ServerAliveInterval 30
  SessionType none
```

Start it with `ssh -fN e2b-remote`. Then:

- API: `http://127.0.0.1:3000` (`E2B_API_URL`)
- Dashboard: `http://127.0.0.1:3001`
- Sandbox traffic: `http://127.0.0.1:3002` (`E2B_SANDBOX_URL`)

A dropped tunnel fails the current Worca step with a retryable error; restart the tunnel and retry.

### Start and stop

| What | Where | Command |
|---|---|---|
| The E2B stack | VM | `sudo systemctl start <stack unit>` / `sudo systemctl stop <stack unit>` |
| The whole VM | host | `sudo virsh start <vm>` / `sudo virsh shutdown <vm>` |

Stopping or restarting the orchestrator ends every running sandbox. A Worca run whose sandbox is lost fails
cleanly (see [`e2b.md`](e2b.md#limitations)).

### Upgrade

In the VM, in the runtime checkout:

```bash
git pull
cd embed/compose
sudo HUGEPAGES=<pages> docker compose up -d --wait --pull always
```

This ends running sandboxes, and the image download can be slow, so plan for it.

### Logs

In the VM, in the compose folder:

```bash
docker compose logs -f api orchestrator client-proxy
journalctl -u <stack unit>
```

### Disk

Templates and snapshots live under `/var/lib/e2b` and `/orchestrator` in the VM. Pausing a sandbox needs free
disk equal to its memory. Each project template (`worca-agent-<project key>`,
[`e2b.md`](e2b.md#building-and-rebuilding-a-project-environment)) is a full image, a few GB each; the layers it
shares with `worca-agent` are usually cached. Check with `df -h /` in the VM, and remove unused project templates
with the E2B CLI (`e2b template list`, `e2b template delete <name>`).

## Rotating the API key

In the VM, in the compose folder:

```bash
docker compose run --rm --no-deps --entrypoint rm seed /run/e2b/team-api-key && docker compose up -d --wait
docker compose exec -T ready cat /run/e2b/sdk.env
```

The old key keeps working for up to 5 more minutes. Copy **only the `E2B_API_KEY` line** from `sdk.env` into your
env file; keep the URLs your machine uses (the tunnel's or the VM's forwarded ports), not the VM's own. Restart
the Worca server so it picks up the new key. `docker compose logs ready` prints the key too, so keep it out of
shared terminals.

## Team limits

The first `up` seeds one team on the `base_v1` tier: sandboxes end after 1 hour and get 512 MB of free disk, too
little for a Worca run. A `project_limits` row in the stack's Postgres overrides the tier for one team; Worca runs
well with 24 hours and 10240 MB of free disk ([`e2b-local-mac.md`](e2b-local-mac.md#6-raise-the-teams-limits) has
the SQL). The API caches team lookups for up to five minutes, and the free disk applies only to templates built
afterwards.

## Sizing

E2B gives sandbox memory from 2 MB hugepages that the stack reserves when it starts (`HUGEPAGES`).

- `HUGEPAGES` must hold every sandbox you want at once, and a template build needs twice its sandbox's memory
  while it restores the snapshot. Two 8 GB sandboxes, or one 8 GB template build, is 8192 pages; with exactly
  that, an 8 GB build failed with `mmap memfd: cannot allocate memory`, so add headroom (8320 pages).
- The VM's memory is the hugepages plus about 8 GiB for the stack itself (Postgres, ClickHouse, the API and the
  orchestrator).
- Worca's **Sandboxes at once** (`e2bMaxSandboxes`) is how many sandboxes the hugepages hold.
- The sandbox size is set when `worca-agent` is built (below); project templates take the same size.

## Rebuilding the template

From the Worca checkout, with the variables of the E2B to build on:

```bash
. ~/.config/worca-e2b/remote.sh && npm run e2b:build -- --name worca-agent --cpu 8 --memory-mb 8192
```

The template ([`docker/e2b/e2b.Dockerfile`](../docker/e2b/e2b.Dockerfile)) has no `COPY` steps, so the build
does not need port 5008.

The base image is pinned by digest in `e2b.Dockerfile`, and project templates install mise from its release binary
checked against a SHA-256 (`MISE_SHA256` in `src/core/exec-env/backends/e2b-template.mjs`); move a pin by updating
the digest or the sums with the version.

After a `docker/CLAUDE_CODE_VERSION` bump or an edit to `e2b.Dockerfile` (graphify's pin lives there), rebuild
`worca-agent` and every project template (`worca exec-env build --project <key>`). Runs on an older project
build warn until then.

## A VM on your Mac

The same stack in a Lima VM on an Apple-silicon Mac, so sandboxes start without a tunnel and code reaches them in
seconds. Setting it up from nothing: [`e2b-local-mac.md`](e2b-local-mac.md).

| What | Command |
|---|---|
| Start or stop the VM | `limactl start e2b` / `limactl stop e2b` |
| A shell in the VM | `limactl shell e2b` |
| Stack state | `limactl shell e2b -- bash -c 'cd ~/e2b && docker compose ps'` |
| Start the stack | `limactl shell e2b -- bash -c 'cd ~/e2b && docker compose up -d --wait'` |
| Logs | `limactl shell e2b -- bash -c 'cd ~/e2b && docker compose logs -f api orchestrator'` |
| Remove everything | `limactl delete e2b` (then `brew uninstall lima`) |

Stopping the VM or the stack ends every running sandbox. To change its size: raise `HUGEPAGES` in `~/e2b/.env`,
`limactl stop e2b`, `limactl edit e2b --memory <GiB>`, start the VM, `docker compose up -d --wait`, then rebuild
`worca-agent` and the project templates.

## Switching between two E2B servers

A tunnel to a remote E2B and a local VM both serve on `localhost:3000` and `3002`, so only one can be up, and a
Worca server talks to the one its environment named when it started
([`e2b.md`](e2b.md#which-e2b-server-worca-uses)). Switching is a restart:

1. Check that no run uses a sandbox, then stop the Worca server (`worca ui stop`).
2. Free port 3000 for the other side: `limactl stop e2b` before using the tunnel, or stop the tunnel's `ssh`
   before using the local VM.
3. Start the server with the other side's variables, for example from a script that sources `remote.sh` or
   `local.sh`, then `model.sh`, and refuses when the other side still holds port 3000.
4. The first time on a server, build `worca-agent` there ([Rebuilding the template](#rebuilding-the-template))
   and rebuild each project that has an environment spec (`worca exec-env build --project <key>`). A project's
   build from the other server is not used until then; its runs fall back to `worca-agent` and say so.

Runs start as on any Worca server: [`e2b.md`](e2b.md#starting-a-run-in-e2b).

## Orphan sandboxes

Use `worca e2b sweep`, described in [`e2b.md`](e2b.md#cleaning-up-orphan-sandboxes).
