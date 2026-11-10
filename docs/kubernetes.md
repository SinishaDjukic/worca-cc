# Worca on Kubernetes

Worca runs on Kubernetes as a Jenkins-style pair: one always-on **controller** pod and
ephemeral **worker** pods, one per run and one per chat thread, created when the work starts
and removed when it ends. The Helm chart in
[`deploy/helm/worca`](../deploy/helm/worca/README.md) installs it; this page explains what it
builds and how to run it. The worker protocol itself (the controller's listener, the one-time
token, what a worker does) is in [workers.md](workers.md).

```
browser ─► Ingress (UI only) ─► controller pod  ── Kubernetes API ──► worker pod (run A)
                                 worca ui                            ► worker pod (run B)
                                 orchestrator, scheduler, UI         ► worker pod (chat thread)
                                 SQLite on its own RWO volume              │
                                      │                                    │ ws://<release>-workers:4319
                                      └──────── RWX volume: /worca, /projects ◄┘ (same paths everywhere)
```

## What runs where

| | Controller | Worker |
| --- | --- | --- |
| Image | `ghcr.io/sinishadjukic/worca:<tag>[-full]` | `ghcr.io/sinishadjukic/worca-worker:<tag>-<engine>[-full]` |
| Process | `worca ui`: orchestrator, scheduler, chat channels, the web UI, SQLite | `worca worker`: the agent processes of one run or one chat thread (`claude`, `codex`, …), scripts |
| Lifetime | always on; a StatefulSet of one | one pod per run or chat thread; removed when it ends, or when a chat thread is idle (`worker.idleTimeoutSeconds`) |
| Kubernetes object | StatefulSet `<release>` | bare Pods the controller creates from the template in ConfigMap `<release>-worker-pod` |
| `/worca` (worca home: store, runs, plugins) | the shared RWX claim, subPath `worca` | the same |
| `/projects` (repositories, worktrees) | the shared claim, subPath `projects` (or `storage.projects.existingClaim`) | the same |
| `/worca-db` (SQLite) | its own ReadWriteOnce claim (`WORCA_DB_DIR`) | not mounted; a worker never opens the database |
| `HOME` | the image's `/home/worca` (ephemeral; credentials come from a Secret) | `/worca/.worca-cc/worker-homes/<kind>/<id>` on the shared volume, set by the worker |
| Network in | the UI port 4317 (Service, Ingress); 4319 from workers (Service `<release>-workers`, ClusterIP) | nothing |
| Network out | the Kubernetes API, Git hosts, the broker | the controller on 4319, the broker on 8080, the internet (the NetworkPolicy's CIDRs) |
| Service account | `<release>` with a namespaced Role: `pods` create/get/list/watch/delete, `pods/log` get | none (`automountServiceAccountToken: false`) |

The controller is the `worca ui` process you know from Compose and Railway, with one
difference: `WORCA_EXECUTOR=kubernetes` routes every engine and script spawn to a worker pod
instead of a child process. Set `controller.executor=local` and the same chart runs agents inside
the controller pod, like the single-container deployments.

The worker's HOME lives on the shared volume so a chat thread's worker can be replaced and the
thread's Claude Code session continue. Nothing else of a worker survives it: `/tmp` and
`/dev/shm` are emptyDirs.

## Storage

Two volumes, and the distinction matters:

- **The shared claim** (`storage.shared`, ReadWriteMany) holds worca home and the projects.
  Controller and workers mount it at the same paths, so a worktree path the controller records
  is the path a worker finds, and git metadata stays valid across pods.
- **The DB claim** (`storage.db`, ReadWriteOnce, a `volumeClaimTemplate`) holds SQLite.
  **SQLite is never on the RWX volume**: network file systems do not give it the locking it
  needs, and a controller is the only writer anyway. The chart refuses any other access mode.

The shared claim needs a storage class that does ReadWriteMany for many pods on many nodes:

| Storage class | Works | Notes |
| --- | --- | --- |
| NFS via [nfs-subdir-external-provisioner](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner) | yes | the usual on-prem answer. Its directories are created `0777`, which is what makes them writable by uid 1000 (see below) |
| CephFS (Rook) | yes | fast metadata, which git likes |
| AWS EFS (efs-csi) | yes | use an access point with uid/gid 1000, or a `0777` root; git on EFS is slower than on block storage, fine for runs |
| GKE Filestore | yes | the `standard-rwx` or `enterprise-rwx` classes; minimum sizes are large (1 TiB on some tiers) |
| Azure Files, **NFS** protocol | yes | the `azurefile-csi-nfs` class (premium accounts) |
| Azure Files, SMB protocol | **no** | SMB breaks git: no symlinks, no hard links, case and permission quirks; checkouts fail in odd ways |
| Longhorn RWX | yes | Longhorn serves RWX through an NFS share-manager pod; same uid notes as NFS |
| hostPath (`values-kind.yaml`) | kind/minikube only | one node, one kernel: real sharing, no network file system |

**fsGroup is not applied on NFS.** On block storage Kubernetes makes the volume group-writable
for `fsGroup: 1000` and the subPath directories inherit that. NFS-backed classes (every NFS
row above, Longhorn RWX, EFS without an access point) ignore `fsGroup`: the export's own
ownership rules apply, and the `worca` and `projects` directories the kubelet creates for the
subPaths are root-owned with the export root's mode. So the export (or the provisioner's
directory) must be writable by uid 1000: a `0777` root, an export owned by 1000:1000, EFS
access points with that uid, or `anonuid=1000` squashing. If it is not, the controller exits
**78** with `/worca is not writable`. `storage.shared.prepare.enabled=true` adds a root init
container that creates the directories and chowns them to 1000 — it helps where root can
write to the export (hostPath, no-root-squash NFS), not on an export that squashes root.

## Quickstart on kind or minikube

[kind](https://kind.sigs.k8s.io) has no RWX class; `values-kind.yaml` puts a hostPath volume on
the one node in its place, turns the `prepare` init container on (the kubelet creates hostPath
directories root-owned), and sets `WORCA_MOCK=1` so runs cost nothing.

```bash
kind create cluster --name worca
helm install worca deploy/helm/worca -n worca --create-namespace \
  -f deploy/helm/worca/values-kind.yaml
kubectl -n worca rollout status statefulset/worca
helm test worca -n worca
kubectl -n worca port-forward svc/worca 4317:4317     # http://localhost:4317
```

Start a (mock) run in the UI and watch the worker come and go:

```bash
kubectl -n worca get pods -l worca.dev/instance=worca -w
```

For minikube, `minikube start` then the same commands; the hostPath is on the minikube VM.

## Install, upgrade, uninstall

A real cluster:

```bash
kubectl create namespace worca
kubectl -n worca create secret generic worca-secrets \
  --from-literal=CLAUDE_CODE_OAUTH_TOKEN=... \
  --from-literal=GH_TOKEN=...
helm install worca deploy/helm/worca -n worca \
  --set storage.shared.storageClassName=nfs-client \
  --set secrets.existingSecret=worca-secrets
```

A `values.yaml` of your own is better than `--set` for anything beyond this; the
[chart README](../deploy/helm/worca/README.md) lists every key. Pin `image.tag` to a released
version; it defaults to the chart's `appVersion`.

**Upgrade.** `helm upgrade worca deploy/helm/worca -n worca -f my-values.yaml`. The controller
is a StatefulSet of one, so a rollout is a delete followed by a create — there is no moment with
two controllers, and there must not be (one owns the database and the workers). What happens
in between is the same drain as a `docker stop` or a Railway redeploy
([drain.mjs](../src/core/drain.mjs)):

1. The kubelet sends SIGTERM. The controller refuses new runs and scheduled starts and pauses
   every active run with the reason `drain`, saving each run's resume point. Workers are
   released. It waits up to `WORCA_DRAIN_TIMEOUT_MS` (`controller.drainTimeoutMs`, 20 s) for
   the pauses to land, then exits.
2. `terminationGracePeriodSeconds` is that timeout plus 40 s, so the kubelet never SIGKILLs a
   drain in progress. Raise `controller.drainTimeoutMs`, not the grace period.
3. The new pod boots, sweeps the orphan worker pods of the old controller (their tokens died
   with it), and **auto-resumes** the runs the drain paused, as the person who last started or
   resumed them. `WORCA_AUTO_RESUME=0` in `controller.env` turns that off.

Worker pods are not rolled by an upgrade: a running worker finishes or is released by the
drain; the next run gets the new worker image. A change to `worker.*` values changes the
ConfigMap, and the StatefulSet restarts on its checksum so the controller re-reads the template.

**Uninstall.** `helm uninstall worca -n worca` removes everything but the claims: the DB
claim (a `volumeClaimTemplate`, Kubernetes keeps it) and the shared claim's data. Delete
`pvc/db-worca-0` and `pvc/worca-shared` yourself when you mean it. Worker pods of an uninstalled
release are removed by their `activeDeadlineSeconds` at the latest; `kubectl -n worca delete
pods -l worca.dev/instance=worca` removes them now.

## The worker pod template

The controller starts every worker from one JSON Pod manifest,
`/etc/worca/worker-pod.json` (`WORCA_K8S_POD_TEMPLATE`), rendered from the chart's values into
ConfigMap `<release>-worker-pod`. The template is a complete, valid Pod; the executor backend
then:

- sets `metadata.name` (`<release>-w-<kind>-<id>`), merges its labels onto yours and sets the
  annotation `worca.dev/scope` to `run:<pipeline id>` or `chat:<thread id>`;
- fills the container named **`worker`**: its image from `WORCA_K8S_WORKER_IMAGE`
  (`ghcr.io/sinishadjukic/worca-worker:{version}-{engine}{variant}` by default, with the run's
  engine), its resources from `WORCA_K8S_RESOURCES`, and appends its own environment (the
  controller URL, the one-time token, the scope, the worker id);
- enforces `restartPolicy: Never`, `automountServiceAccountToken: false` and
  `enableServiceLinks: false` whatever the template says.

Everything else is yours through values: `worker.resources`, `nodeSelector`, `tolerations`,
`affinity`, `priorityClassName`, `env`, `envFrom`, `credentialsSecret`, `tmpSizeLimit`,
`shmSizeLimit`, `podLabels`, `podAnnotations`. The security context is fixed: uid/gid/fsGroup
1000, `runAsNonRoot`, seccomp `RuntimeDefault`, every capability dropped.

**Per-engine overrides.** `worker.engines.<engine>` sets a fixed `image`, a different `variant`
or different `resources` for one engine, for example more memory for `claude` or a private
image for `codex`:

```yaml
worker:
  engines:
    claude:
      variant: full
      resources:
        limits: { memory: 8Gi }
    codex:
      image: registry.example.com/worca-worker-codex:1.19.0
```

The chart passes them to the controller as `WORCA_K8S_ENGINES` (JSON).

**Limits that end a worker.** `worker.activeDeadlineSeconds` (24 h) is Kubernetes' own hard
stop on a worker pod — a stop, not an idle timeout: a run holds its worker for its whole life, and one
that outlives the deadline loses its step in progress and repeats it on a new worker; `worker.pendingTimeoutSeconds` (5 min) is how long the controller waits
for a pod to leave `Pending` before it fails the run with the reason (no node, no image);
`worker.idleTimeoutSeconds` (15 min) releases a chat thread's worker with nothing to do;
`worker.maxWorkers` (20) is the number of workers at once — a run past it waits for a slot.

## Credentials

**The worker's own token.** Each worker pod carries a one-time token (`WORCA_WORKER_TOKEN`) in its
spec, which its process presents once to the controller's worker port and then deletes from its
environment. Until that moment, anyone who can `get pods` in the namespace can read it, and a pod
that reaches the worker port and presents it first takes the worker's place and receives the
spawn's environment. The token is valid for the start window only (the start timeout, two minutes
by default) and for one connection, but the namespace is the trust boundary: give `get pods` and
network access to the worker port only to operators you would hand the agents' credentials to,
and keep `networkPolicy.enabled` on so only worker pods reach that port.

Agents need a model credential; GitHub tokens stay with the controller.

**Without the broker**, put `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in a Secret and
name it in `worker.credentialsSecret`: every worker pod takes it as `envFrom`, and every agent
can read it (the same trade-off as one token in a Compose `.env`). Keep `GH_TOKEN` and the
GitHub App variables in the **controller's** Secret (`secrets.existingSecret`): the controller
makes the pushes and pull requests, and agents never see a Git credential. The controller
needs the model credential too for its own small calls (run titles and the like), so the same
Secret may serve both `secrets.existingSecret` and `worker.credentialsSecret`.

Worker pods carry `worca.dev/instance=<instanceId>` (what the controller lists and reaps by),
`worca.dev/scope`, `worca.dev/engine` and `worca.dev/boot`; the pod template's own
`app.kubernetes.io/*` labels are left as the chart wrote them, since its NetworkPolicies select on them.

A worker hands these variables to the engines by name (model-provider credentials and their
settings; the list is in workers.md). `image.variant: full` applies to the engines that have a full
worker image (`claude`, `all`); the others run their slim one. The workers Service publishes the
controller's address while the pod is not Ready, and a worker retries its first connection for a
short while, so a run resumed as the controller boots still gets its worker.

Other engines take their credential the same way — a variable in `worker.credentialsSecret`
(`OPENAI_API_KEY`, `GEMINI_API_KEY`, `CURSOR_API_KEY`, `COPILOT_GITHUB_TOKEN`, …): the table and
the limitation (no interactive sign-in persists on a worker) are in
[workers.md › Credentials on workers](workers.md#credentials-on-workers).

A long-lived token comes from `claude setup-token`, which prints its whole dialog, not just the
token: paste the `sk-ant-oat01-…` line, or filter it:

```bash
kubectl -n worca create secret generic worca-claude \
  --from-literal=CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token | grep -o 'sk-ant-oat01-[A-Za-z0-9_-]*' | head -1)"
```

A Secret holding the dialog shows up as *Invalid Authorization header value from
CLAUDE_CODE_OAUTH_TOKEN: it contains a line break* on the first agent. Pods read the Secret at
start: after changing it, `kubectl -n worca rollout restart statefulset/worca` (worker pods are
new per run and per chat anyway).

**With the broker** (`broker.enabled=true`, [credential-broker.md](credential-broker.md)), no
model key exists in the controller or in any worker. The chart adds a Deployment from the same
image with `args: [worca, broker]`, its own ReadWriteOnce claim, and a Service on 8080 (private;
`WORCA_BROKER_URL` on the controller and the workers) and 8081 (the key page, for people, in
multi mode; `broker.keyPage.ingress` with an identity check in front, never 8080). The
broker's Secret (`broker.existingSecret`) holds `WORCA_BROKER_SECRET` and, in single mode,
`WORCA_BROKER_KEY_ANTHROPIC`, in multi mode `WORCA_BROKER_VAULT_KEY`; the controller's Secret
holds `WORCA_BROKER_SECRET` too. Leave `worker.credentialsSecret` empty: the controller refuses
to start while a model key is within agents' reach. With `networkPolicy.enabled`, workers may
reach the broker's 8080 and nothing else in the cluster.

## Ingress, allowed hosts and Cloudflare Access

The Ingress (`ingress.enabled`) exposes the UI Service only; the workers' port never leaves the
cluster. Worca's server accepts a request only when its `Host` is loopback or listed in
`WORCA_ALLOWED_HOSTS`; the chart sets that from `ingress.hosts` unless `controller.env` does.

A host besides localhost needs an identity check, or worca refuses to start — it won't run
unprotected. The supported one is Cloudflare Access with worca verifying the Access token on
every request itself: set `WORCA_CF_ACCESS_TEAM_DOMAIN` (`acme.cloudflareaccess.com`) and
`WORCA_CF_ACCESS_AUD` (the Access application's AUD tag) in `controller.env`. The Cloudflare
side is in [remote-access.md](remote-access.md); the shape is the same as on Railway
([deploy-railway.md](deploy-railway.md)) with the Ingress controller or a cloudflared Deployment
in the tunnel's place. `WORCA_IDENTITY_ISSUER` (an OIDC proxy) is the alternative;
`WORCA_INSECURE_NO_IDENTITY_CHECK=1` says a proxy you trust is the only way in.

The probes run inside the controller pod (`exec`: `curl` on loopback with `Host: localhost`), so they
pass on every network plugin: an `httpGet` probe comes from the kubelet, which the server would treat
as an unknown peer wherever the kubelet does not arrive from the pod's own gateway (Calico, the AWS
VPC CNI, Azure CNI). Any other pod is an unknown peer and gets 403: that is what `helm test` asserts
(a 200 there would mean the guard is off).

## NetworkPolicy

`networkPolicy.enabled=true` (a CNI that enforces policies: Calico, Cilium, …; kind's default
does not) renders two policies:

- **Workers**: no ingress at all. Egress to the controller's 4319, the broker's 8080 (when on),
  cluster DNS on 53, and `workerEgressCidrs` (`0.0.0.0/0`) minus `workerEgressExceptCidrs`
  (RFC 1918 and `169.254.169.254/32`, the cloud metadata address): agents reach the internet
  and nothing inside your network. Add your Git host's range to the except list's complement,
  or your private registry's, as the work needs.
- **Controller**: 4317 from anywhere (the Ingress controller, `port-forward`), 4319 from this
  instance's worker pods only.

This is the floor under Worca's own egress allowlist for agents ([docker.md →
Egress allowlist](docker.md#egress-allowlist)), not a replacement for it.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| A run fails after about 90 s: *cannot start a worker … ImagePullBackOff* (or `ErrImagePull`; the kubelet's own retries are waited out first, `WORCA_K8S_PULL_GRACE_MS`) | The worker image for that engine does not exist for this tag, or needs a pull secret | Check the run's error for the exact image. Published tags are `<version>-<engine>[-full]`; `imagePullSecrets` applies to worker pods too |
| A run fails after `worker.pendingTimeoutSeconds`: *did not connect within …* and the pod was `Pending` | No node fits the worker's requests, `nodeSelector` or `tolerations`; or the shared claim is unbound | `kubectl -n worca describe pod <worker>`; lower `worker.resources`, fix the selector, or check `kubectl get pvc` |
| The controller exits **78**, `/worca is not writable` | The shared volume's `worca` directory is root-owned (NFS without fsGroup, hostPath) | Make the export writable by uid 1000 (see [Storage](#storage)) or set `storage.shared.prepare.enabled=true` |
| Probes fail; the pod restarts | The probes were changed to `httpGet` (the kubelet is an unknown peer on most network plugins: 403), or `WORCA_ALLOWED_HOSTS` was set without an identity check (the server then exits) | Keep the chart's `exec` probes; set the Access variables |
| Controller logs *removed N orphan worker(s) from a previous controller* at boot | Normal after an upgrade or a crash: the old controller's workers cannot be reused (their tokens died with it) | Nothing; the drained runs auto-resume |
| Controller logs *WORCA_ALLOWED_HOSTS is set but no identity check is configured* and exits | The Ingress is on, `controller.env` has neither `WORCA_CF_ACCESS_*` nor `WORCA_IDENTITY_ISSUER` | Set them ([Ingress](#ingress-allowed-hosts-and-cloudflare-access)) |
| `helm upgrade --wait` times out and `worca-0` keeps its **old** spec (`Init:ErrImageNeverPull`, `ImagePullBackOff`, …) | A StatefulSet does not replace a pod that never became ready, so a fix to the image values does not reach it | `kubectl -n worca delete pod worca-0`; the StatefulSet recreates it from the new spec |
| `helm upgrade` hangs on the StatefulSet | A PodDisruptionBudget with `minAvailable: 1` (`pdb.enabled`) or a drain longer than the grace period | Turn the PDB off; raise `controller.drainTimeoutMs` (the grace period follows) |
| `kubectl drain <node>` never finishes | `pdb.enabled=true` on a single replica | That is why it is off by default; delete the pod by hand |
| Agents cannot reach GitHub | `networkPolicy.workerEgressExceptCidrs` covers your Git host, or a corporate proxy needs `HTTPS_PROXY` in `worker.env` and `controller.env` | Adjust the CIDRs; add the proxy and `controller.extraNoProxy` |
| `helm template` fails: *storage.db.accessModes must be [ReadWriteOnce]* | Someone put SQLite on the shared class | Keep the DB claim RWO |

## Smoke it

`node tools/k8s-smoke.mjs` does the first four checks below on its own: it builds `worca:local` and
`worca-worker:local-claude` (`--no-build` reuses them), creates a kind cluster (`--context <name>`
uses a cluster you already have instead), loads the images, installs the chart with
`values-kind.yaml`, and runs a mock workflow whose shell script node executes on a worker pod the
controller creates — asserting the run ends `done`, the controller log names the pod, the script's
output carries the pod's hostname, no worker pod is left, and `helm test` passes. `--keep` leaves
the cluster and the release for a look. In CI it is the on-demand *Kubernetes end to end (kind)*
job (Actions → CI → Run workflow).

## Check it

- [ ] `helm test worca -n worca` passes (the UI Service refuses a pod peer with 403 `forbidden`; the guard is on).
- [ ] `kubectl -n worca exec worca-0 -- curl -s -H 'Host: localhost' localhost:4317/api/health` reports `"executor":{"kind":"kubernetes"`.
- [ ] `kubectl -n worca get pvc`: `db-worca-0` is `Bound` with `RWO`, `worca-shared` with `RWX`.
- [ ] `kubectl -n worca exec statefulset/worca -- sh -c 'touch /worca/.w && rm /worca/.w && touch /projects/.w && rm /projects/.w'` succeeds (the shared volume is writable by uid 1000).
- [ ] A mock run (`WORCA_MOCK=1`, or the UI's mock toggle) creates a pod labelled `worca.dev/instance=<release>`, and the pod is gone when the run finishes.
- [ ] `kubectl -n worca exec <worker pod> -- env | grep -cE 'ANTHROPIC_|CLAUDE_CODE_OAUTH|OPENAI_API|GH_TOKEN|GITHUB_TOKEN'` is `0` when the broker is on (no model key and no Git token reaches a worker). `WORCA_WORKER_TOKEN`, the worker's own one-time token, is expected there.
- [ ] `kubectl -n worca rollout restart statefulset/worca` during a run: the run shows *paused (drain)*, then resumes on the new pod.
- [ ] With the Ingress on: the host is in `WORCA_ALLOWED_HOSTS`, a request without an Access token gets 403, with one it gets the UI.
- [ ] With the NetworkPolicy on: from a worker, `curl` to the controller's 4317 is refused, to its 4319 connects, to `169.254.169.254` times out.
