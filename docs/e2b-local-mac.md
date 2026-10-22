# A local E2B on an Apple-silicon Mac

How to run Worca's E2B execution environment ([`e2b.md`](e2b.md)) against a self-hosted E2B in a Lima VM on your
Mac, from nothing to a first run. The E2B stack is E2B Embed, the upstream docker compose package, in an Ubuntu VM
with nested virtualization; the Worca server stays on the Mac and reaches the VM on `localhost`. Sandboxes start in
seconds and there is no tunnel or remote host.

What you end with:

- a Lima VM `e2b` with 8 vCPU, 24 GiB of memory and a 60 GiB disk, forwarding only ports 3000 (API), 3001
  (dashboard) and 3002 (sandbox traffic) to `127.0.0.1` on the Mac;
- E2B Embed in `~/e2b` in the VM, sized for two 8 GB sandboxes at once;
- `~/.config/worca-e2b/` on the Mac with the E2B variables, the model credential and a start script;
- a `worca-agent` template at 8 vCPU and 8192 MB, and Worca set to two sandboxes at once.

Operating it once it runs (start, stop, logs, key rotation, disk): [`e2b-selfhost-ops.md`](e2b-selfhost-ops.md#a-vm-on-your-mac).

## What you need

- **An Apple M3 or newer, on macOS 15 or newer.** E2B runs Firecracker, which needs `/dev/kvm` in the VM, and
  Apple's virtualization framework offers nested virtualization only on M3 and later chips with macOS 15.
- **Memory**: the VM takes 24 GiB while it runs, 16.25 GiB of it reserved for sandboxes. A Mac with 36 GB or more
  leaves room for everything else. On a smaller Mac, size the sandboxes down (see [Sizing](#sizing)).
- **Disk**: 60 GiB free on the Mac for the VM's disk.
- **Homebrew**, and a Worca checkout with its dependencies installed (`npm ci`), Node 22.19 or newer.
- **A model credential**: a Claude Code OAuth token (`claude setup-token`) or an Anthropic API key. It stays on
  the Worca server and never enters a sandbox.
- Outbound HTTPS from the VM to Docker Hub, `us-docker.pkg.dev`, `storage.googleapis.com`, `github.com` and
  `raw.githubusercontent.com`. The images and binaries are public; no account is needed.

Every command below runs on the Mac. Commands inside the VM go through `limactl shell e2b -- …`, or open a shell
there with `limactl shell e2b`.

## 1. Install Lima

```bash
brew install lima
limactl --version
```

This guide was written against Lima 2.2.1.

## 2. Define the VM

Create `~/.config/worca-e2b/` (mode 700) and put the VM's definition in `~/.config/worca-e2b/lima-e2b.yaml`:

```bash
mkdir -p -m 700 ~/.config/worca-e2b
```

```yaml
# Lima VM for a local self-hosted E2B (E2B Embed, docker compose).
# Apple silicon needs M3+ and macOS 15+ for nested virtualization (/dev/kvm in the guest).
minimumLimaVersion: 2.0.0

base:
- template:_images/ubuntu-24.04   # pinned arm64 cloud image with its sha256 digest

vmType: vz
nestedVirtualization: true
arch: aarch64
cpus: 8
memory: 24GiB   # 16.25 GiB of it is E2B hugepages (two 8 GB sandboxes)
disk: 60GiB

# No host folders inside the VM: E2B mutates the guest (modules, hugepages, iptables).
mounts: []

# Docker Engine is installed in the guest; Lima's own containerd stays off.
containerd:
  system: false
  user: false

# Only the three ports worca and the dashboard need, on the Mac's loopback.
# Everything else (the admin API on 5008, databases, …) is never forwarded.
portForwards:
- guestPort: 3000      # E2B API
  hostIP: 127.0.0.1
- guestPort: 3001      # dashboard
  hostIP: 127.0.0.1
- guestPort: 3002      # sandbox traffic (client-proxy)
  hostIP: 127.0.0.1
- guestPortRange: [1, 65535]
  ignore: true
```

Why each part:

- `vmType: vz` and `nestedVirtualization: true` give the guest `/dev/kvm`.
- `mounts: []` keeps your home folder out of the VM. Lima mounts it by default, and the E2B stack changes the guest
  (kernel modules, hugepages, iptables), so it gets nothing of the Mac's.
- The last `portForwards` rule stops Lima from forwarding every port the guest listens on. E2B's admin API (5008)
  has no authentication and must stay inside the VM.

## 3. Create and start the VM

```bash
limactl create --name e2b ~/.config/worca-e2b/lima-e2b.yaml
limactl start e2b
limactl shell e2b -- ls -l /dev/kvm /dev/net/tun
```

Both devices must be there. Without `/dev/kvm`, nested virtualization is off: check the chip and the macOS version.

## 4. Prepare the guest

Three changes inside the VM.

**A newer kernel.** E2B on arm64 needs Linux 6.10 or newer (sandbox restore uses userfaultfd write-protect, which
arm64 gained in 6.10); Ubuntu 24.04 ships 6.8. Install the HWE kernel and restart the VM so it boots into it:

```bash
limactl shell e2b -- sudo apt-get update
limactl shell e2b -- sudo apt-get install -y linux-generic-hwe-24.04
limactl stop e2b && limactl start e2b
limactl shell e2b -- uname -r
```

`uname -r` must show 6.10 or newer (7.0 at the time of writing).

**mDNS and LLMNR off.** Lima turns on systemd-resolved's mDNS, which listens on UDP 5353 and makes Lima forward it.
Turn both off with a drop-in that sorts after Lima's own:

```bash
limactl shell e2b -- sudo mkdir -p /etc/systemd/resolved.conf.d
limactl shell e2b -- sudo tee /etc/systemd/resolved.conf.d/no-mdns.conf <<'EOF'
[Resolve]
MulticastDNS=no
LLMNR=no
EOF
limactl shell e2b -- sudo systemctl restart systemd-resolved
limactl shell e2b -- resolvectl status
```

Its `Protocols:` line should read `-LLMNR -mDNS`.

**Docker.** Ubuntu's own packages clear E2B Embed's floor (Docker Engine 27, Compose 2.24). Add the tools Embed's
host setup uses, put your user in the `docker` group, and restart the VM so your next shell has the group:

```bash
limactl shell e2b -- sudo apt-get install -y docker.io docker-compose-v2 iptables rsync e2fsprogs iproute2
limactl shell e2b -- bash -c 'sudo usermod -aG docker "$USER"'
limactl stop e2b && limactl start e2b
limactl shell e2b -- docker version
limactl shell e2b -- docker compose version
```

`docker version` showing a Server section without `sudo` means the group took.

## 5. Install E2B Embed

E2B Embed is two files, `compose.yaml` and `.env`, from `embed/compose/` in
[`e2b-dev/runtime`](https://github.com/e2b-dev/runtime/tree/main/embed/compose). `.env` pins every image and
binary. Its README is the reference for everything the stack does; it lists arm64 and a Lima VM on Apple silicon
among the supported hosts (x86-64 is what upstream tests most).

```bash
limactl shell e2b -- bash -c 'mkdir -p ~/e2b && cd ~/e2b &&
  curl -fsSL --remote-name-all "https://raw.githubusercontent.com/e2b-dev/runtime/main/embed/compose/{compose.yaml,.env}"'
```

To install a known version instead of `main`, put a commit hash in place of `main`.

**Hugepages.** E2B gives sandbox memory from 2 MB hugepages that the stack reserves when it starts, and the default
(`HUGEPAGES=2048`, 4 GiB) is too small for Worca's 8 GB sandboxes. A template build restores its snapshot while
the build VM still holds its memory, so it needs twice the sandbox's memory; with exactly 8192 pages (16 GiB) an
8 GB build failed with `mmap memfd: cannot allocate memory`. Append the setting to `.env`:

```bash
limactl shell e2b -- bash -c 'cd ~/e2b && printf "\n# two 8 GB sandboxes, or one 8 GB template build, plus headroom\nHUGEPAGES=8320\n" >> .env'
```

8320 pages are 16.25 GiB: two 8 GB sandboxes, or one 8 GB template build, plus 128 pages of headroom. The pages
stay reserved while the VM runs, so they come out of the VM's 24 GiB.

Start the stack:

```bash
limactl shell e2b -- bash -c 'cd ~/e2b && docker compose up -d --wait'
```

The first `up` checks the host, loads the kernel modules, reserves the hugepages, downloads the Firecracker
artifacts, pulls the images, migrates and seeds the databases, creates the first team and its API key, and builds
E2B's `base` template. It exits 0 only when all of that is done. It takes a few minutes, most of it the image
download. If it fails, the failing service's log has a `FIX:` line (`docker compose logs preflight`,
`host-setup`, `fetch-artifacts` or `base-template`); fix what it names and run `up` again. Every step is
idempotent.

Check it:

```bash
limactl shell e2b -- bash -c 'cd ~/e2b && docker compose ps'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/health
limactl shell e2b -- bash -c 'cd ~/e2b && docker compose --profile test run --rm smoke'
```

`ready` running means the stack is usable; `/health` answers 200 through Lima's forward; the smoke test is the
SDK's own check against a real sandbox.

## 6. Raise the team's limits

The first `up` seeds one team, `local-dev team`, on the `base_v1` tier. That tier ends a sandbox after 1 hour and
gives it 512 MB of free disk, too little for a Worca run. Limits live in the stack's Postgres, not in a config
file: a `project_limits` row for the team overrides its tier. Copy the tier's values and raise the lifetime to
24 hours and the free disk to 10240 MB:

```bash
limactl shell e2b -- bash -c 'cd ~/e2b && docker compose exec -T postgres psql -U postgres -d postgres' <<'EOF'
INSERT INTO project_limits (team_id, max_length_hours, concurrent_sandboxes, concurrent_template_builds,
  max_vcpu, max_ram_mb, disk_mb, events_ttl_days, default_free_disk_size_mb, max_disk_size_mb, api_team_rps_list)
SELECT t.id, 24, tier.concurrent_instances, tier.concurrent_template_builds,
  tier.max_vcpu, tier.max_ram_mb, 10240, tier.events_ttl_days, 10240, tier.max_disk_size_mb, tier.api_team_rps_list
FROM teams t JOIN tiers tier ON tier.id = t.tier
WHERE t.name = 'local-dev team';
SELECT max_length_hours, max_vcpu, max_ram_mb, default_free_disk_size_mb FROM team_limits
WHERE id = (SELECT id FROM teams WHERE name = 'local-dev team');
EOF
```

The last query shows the team's limits now: 24, 8, 8192, 10240. The API caches team lookups for up to five
minutes, so wait that long before the next step. The free disk applies only to templates built after the change,
which is why this comes before the template build. To go back to the tier: `DELETE FROM project_limits WHERE
team_id = (SELECT id FROM teams WHERE name = 'local-dev team');`.

## 7. Give Worca the key and the model credential

The seed generated this install's team API key and keeps it in the stack (`/run/e2b/team-api-key`); the `ready`
service renders it, with the URLs, into `/run/e2b/sdk.env`. Copy only the key line into
`~/.config/worca-e2b/local.sh`, without printing it:

```bash
umask 077
{
  echo '# The local self-hosted E2B in the Lima VM "e2b" (ports forwarded to the Mac loopback).'
  limactl shell e2b -- bash -c 'cd ~/e2b && docker compose exec -T ready cat /run/e2b/sdk.env' </dev/null \
    | grep '^export E2B_API_KEY='
  echo 'export E2B_API_URL=http://localhost:3000'
  echo 'export E2B_SANDBOX_URL=http://localhost:3002'
} > ~/.config/worca-e2b/local.sh
grep -c '^export E2B_API_KEY=e2b_' ~/.config/worca-e2b/local.sh
```

The `grep -c` prints `1` when the key is there. `docker compose logs ready` prints the key too, so keep that
command out of shared terminals and logs.

Put the model credential in `~/.config/worca-e2b/model.sh`, also mode 600. With an OAuth token from
`claude setup-token`:

```bash
umask 077
printf 'export CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$(pbpaste)" > ~/.config/worca-e2b/model.sh
```

(copy the token to the clipboard first), or `export ANTHROPIC_API_KEY=…` in its place. Neither file goes into a
repository.

## 8. Start the Worca server against it

The Worca server reads the `E2B_*` variables and the model credential from the environment it starts with
([Which E2B server Worca uses](e2b.md#which-e2b-server-worca-uses)), so a server that is already running keeps
whatever it had. Stop it first (`worca ui stop`), check that no run uses a sandbox on another E2B, and start it from
a small script, `~/.config/worca-e2b/start-ui-e2b.sh`:

```zsh
#!/bin/zsh
# Start the Worca server against the local E2B in the Lima VM "e2b".
set -eu
[ "$(limactl list e2b --format '{{.Status}}')" = Running ] || limactl start e2b --tty=false
source ~/.config/worca-e2b/local.sh
source ~/.config/worca-e2b/model.sh
exec worca ui
```

```bash
chmod 700 ~/.config/worca-e2b/start-ui-e2b.sh
~/.config/worca-e2b/start-ui-e2b.sh
```

If you also reach another E2B on `localhost:3000` (a remote one over an SSH tunnel), only one of the two can hold
the port; [`e2b-selfhost-ops.md`](e2b-selfhost-ops.md#switching-between-two-e2b-servers) describes a
start script that picks between them.

## 9. Build `worca-agent`

From the Worca checkout, with the local E2B's variables:

```bash
. ~/.config/worca-e2b/local.sh && npm run e2b:build -- --name worca-agent --cpu 8 --memory-mb 8192
```

It builds Worca's sandbox template ([`docker/e2b/e2b.Dockerfile`](../docker/e2b/e2b.Dockerfile)) on the local
stack and ends with `e2b:build: done — template worca-agent (…)`. Project templates take this template's size, so
8 vCPU and 8192 MB here gives every run an 8 vCPU, 8 GB sandbox.

## 10. Set Sandboxes at once

Settings → Runs → **Sandboxes at once**: 2. The hugepages hold two 8 GB sandboxes, so a third run waits ("waiting
for an E2B slot") instead of failing to start its sandbox.

## 11. Rebuild project templates

A project with an environment spec has its own template, `worca-agent-<project key>`
([`e2b.md`](e2b.md#building-and-rebuilding-a-project-environment)). A build belongs to the E2B server it was made
on, so a build from another server is not used here: its runs fall back to `worca-agent`, and the project page
shows "built on another E2B server — Rebuild". Rebuild each such project, from the project page or with the server
running:

```bash
worca exec-env build --project <key>
worca exec-env status --project <key>
```

A project without a spec needs nothing; its runs use `worca-agent`.

## 12. A first run

On New run, set **Runs in: E2B sandbox** (shown from the Advanced interface level), pick a project and a small
task, and start it. Other ways to start one are in [Starting a run in E2B](e2b.md#starting-a-run-in-e2b).

Check that it really runs in the local E2B:

- The E2B status chip beside **Runs in**, where your Worca has it, reads `connected · N of 2 in use`. `key refused`
  means `local.sh` holds a key from another install; `unreachable` means the VM or the stack is down.
- The run log has `sandbox <id> created from template <name>` and `agents and scripts run in E2B sandbox <id>
  (template … from …, key e2b_…abcd)`, where the template is `worca-agent` or the project's own build.
- The run log has `graphify graph built in the sandbox in N s` (unless the workflow turns the code graph off).
- The dashboard at `http://localhost:3001` (paste the API key into its form) lists the sandbox while the run goes.

The run's commits, pushes and PRs happen on the Mac, as for a local run.

## Sizing

The numbers above fit two 8 GB sandboxes. The rule for another size:

- `HUGEPAGES` (in 2 MB pages) is at least the larger of the sandboxes you want at once and one template build,
  which needs twice its sandbox's memory, plus some headroom: two 8 GB sandboxes or one 8 GB build is
  8192 pages, plus 128, so 8320.
- The VM's memory is the hugepages plus room for the stack itself (Postgres, ClickHouse, the API and the
  orchestrator); this guide leaves it about 8 GiB.
- **Sandboxes at once** is how many sandboxes the hugepages hold.
- `--memory-mb` and `--cpu` on `npm run e2b:build` set the sandbox size; rebuild the project templates after
  changing it.

To change the size later: `limactl stop e2b`, `limactl edit e2b --memory <GiB>`, `limactl start e2b`, set
`HUGEPAGES` in `~/e2b/.env`, then `docker compose up -d --wait` in `~/e2b`. Stopping the VM ends every running
sandbox.

## Troubleshooting

| What you see | What to do |
|---|---|
| `/dev/kvm` missing in the VM | Nested virtualization is off: an M3 or newer and macOS 15 or newer are needed, with `vmType: vz` and `nestedVirtualization: true`. |
| `preflight` fails on the kernel, or every sandbox start fails with `Failed to UFFD object` | `uname -r` in the VM is older than 6.10: install `linux-generic-hwe-24.04` and restart the VM (step 4). |
| `host-setup` fails with `FIX: give the host more memory` | `HUGEPAGES` is larger than the VM can reserve: lower it, or raise the VM's memory. |
| A template build fails with `mmap memfd: cannot allocate memory` | The hugepages hold less than twice the sandbox's memory: raise `HUGEPAGES` (see [Sizing](#sizing)). |
| A sandbox ends after an hour, or its disk fills at 512 MB | The team still has the tier's limits: step 6, then rebuild the template. |
| `localhost:3000` refuses connections | The VM or the stack is down: `limactl start e2b`, then `docker compose up -d --wait` in `~/e2b`. |
| The run log names the wrong key, or the chip reads `key refused` | The Worca server started with another E2B's variables: stop it and start it with the script (step 8). |

## Removing it

```bash
limactl delete --force e2b
brew uninstall lima
rm -r ~/.config/worca-e2b
```

Deleting the VM removes the stack, its databases, its key and every template with it. A Worca server still started
with `local.sh` fails each E2B run at sandbox creation until it is restarted without it.
