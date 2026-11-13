# worca Helm chart

Worca on Kubernetes: one always-on **controller** pod (orchestrator, scheduler, SQLite, web UI)
that starts an ephemeral **worker** pod per run and per chat thread and removes it afterwards.
Controller and workers share files through one ReadWriteMany claim mounted at the same paths
(`/worca`, `/projects`); SQLite lives on the controller's own ReadWriteOnce volume.

The guide, with the storage-class table, the kind quickstart, upgrades and troubleshooting, is
[docs/kubernetes.md](../../../docs/kubernetes.md). This file is the values reference.

```bash
helm install worca deploy/helm/worca -n worca --create-namespace \
  --set storage.shared.storageClassName=<an RWX class> \
  --set secrets.existingSecret=worca-secrets
helm test worca -n worca
```

Needs an RWX storage class (or `values-kind.yaml` on kind/minikube). The chart has no
dependencies and no CRDs.

## What it renders

| Object | Name | Notes |
| --- | --- | --- |
| StatefulSet | `<fullname>` | 1 replica, `worca ui`; `volumeClaimTemplates` for the DB (RWO, `/worca-db`) |
| Service | `<fullname>` | the UI, 4317; what the Ingress and `port-forward` reach |
| Service | `<fullname>-workers` | ClusterIP 4319: worker pods connect back here; never on the Ingress |
| ConfigMap | `<fullname>-worker-pod` | `worker-pod.json`: the worker pod template, mounted at `/etc/worca/worker-pod.json` |
| PersistentVolumeClaim | `<fullname>-shared` | RWX; skipped with `storage.shared.existingClaim` |
| PersistentVolume | `<fullname>-shared` | only `storage.shared.hostPath.enabled` (kind/minikube) |
| ServiceAccount, Role, RoleBinding | `<fullname>`, `<fullname>-workers` | `pods: create get list watch delete`, `pods/log: get` |
| Secret | `<fullname>-secrets` | only `secrets.create` |
| Ingress | `<fullname>` | only `ingress.enabled`; UI port only |
| Deployment, Service, PVC, Ingress | `<fullname>-broker[-keypage]` | only `broker.enabled` |
| NetworkPolicy | `<fullname>-workers`, `<fullname>-controller` | only `networkPolicy.enabled` |
| PodDisruptionBudget | `<fullname>` | only `pdb.enabled` (off on purpose, see values.yaml) |
| Pod (helm test) | `<fullname>-test-guard` | the UI Service answers a pod peer with 403 `forbidden` (the guard is on) |

## Values

### Image and release

| Key | Default | What |
| --- | --- | --- |
| `image.registry` | `ghcr.io` | |
| `image.repository` | `sinishadjukic/worca` | the controller (and broker) image |
| `image.tag` | `""` = `Chart.appVersion` | also the workers' `{version}` (`WORCA_K8S_WORKER_TAG`) |
| `image.variant` | `slim` | `slim` or `full` (tag suffix `-full`); workers follow it unless `worker.variant` |
| `image.pullPolicy` | `IfNotPresent` | controller, broker and worker pods |
| `imagePullSecrets` | `[]` | controller, broker and worker pods |
| `instanceId` | `""` = release name | `WORCA_INSTANCE_ID`; the `worca.dev/instance` label on worker pods |
| `nameOverride`, `fullnameOverride` | `""` | |

### Controller

| Key | Default | What |
| --- | --- | --- |
| `controller.executor` | `kubernetes` | `WORCA_EXECUTOR`; `local` runs agents inside the controller pod |
| `controller.port` | `4317` | the UI |
| `controller.workerPort` | `4319` | `WORCA_WORKER_PORT`, the `-workers` Service |
| `controller.drainTimeoutMs` | `20000` | `WORCA_DRAIN_TIMEOUT_MS`; `terminationGracePeriodSeconds` = this/1000 + 40 |
| `controller.env` | `{}` | `name: value` pairs; win over the chart's own except `NO_PROXY` |
| `controller.extraEnv` | `[]` | raw `EnvVar` entries (`valueFrom`) |
| `controller.envFrom` | `[]` | extra `envFrom` sources |
| `controller.extraNoProxy` | `""` | appended to the chart's `NO_PROXY` |
| `controller.resources` | 500m / 1Gi requests, 4Gi limit | |
| `controller.nodeSelector`, `tolerations`, `affinity`, `priorityClassName` | | |
| `controller.podSecurityContext` | uid/gid/fsGroup 1000, `RuntimeDefault` | |
| `controller.securityContext` | no escalation, drop all | |
| `controller.podAnnotations`, `podLabels` | `{}` | |
| `controller.probes.*` | startup 60×5 s, readiness 10 s, liveness 30 s delay, 6 failures | all `curl` `/api/health` on loopback inside the pod (an `exec` probe: independent of the CNI) |

Environment the chart always sets on the controller: `WORCA_EXECUTOR`, `WORCA_DB_DIR=/worca-db`,
`WORCA_HOME=/worca`, `WORCA_PROJECTS_ROOT=/projects`, `WORCA_HOST`, `PORT`, `WORCA_INSTANCE_ID`,
`WORCA_K8S_NAMESPACE` (fieldRef), `WORCA_K8S_POD_TEMPLATE`, `WORCA_K8S_WORKER_IMAGE`,
`WORCA_K8S_WORKER_TAG`, `WORCA_K8S_WORKER_VARIANT`, `WORCA_K8S_PENDING_TIMEOUT_MS`,
`WORCA_K8S_ACTIVE_DEADLINE_S`, `WORCA_K8S_RESOURCES`, `WORCA_K8S_ENGINES` (when `worker.engines`
is set), `WORCA_WORKER_PORT`, `WORCA_CONTROLLER_URL`, `WORCA_WORKER_MAX`,
`WORCA_WORKER_CHAT_IDLE_MS`, `WORCA_DRAIN_TIMEOUT_MS`, `NO_PROXY`, and `WORCA_BROKER_URL` with the
broker on, `WORCA_ALLOWED_HOSTS` (from `ingress.hosts`) with the Ingress on.

### Storage

| Key | Default | What |
| --- | --- | --- |
| `storage.db.storageClassName` | `""` = default class | the SQLite claim (a `volumeClaimTemplate`) |
| `storage.db.size` | `5Gi` | |
| `storage.db.accessModes` | `[ReadWriteOnce]` | anything else fails the render |
| `storage.shared.existingClaim` | `""` | use a claim you made (RWX) |
| `storage.shared.storageClassName` | `""` | an RWX class |
| `storage.shared.size` | `50Gi` | |
| `storage.shared.accessModes` | `[ReadWriteMany]` | |
| `storage.shared.hostPath.enabled` | `false` | kind/minikube: a hostPath PV bound to the shared claim |
| `storage.shared.hostPath.path` | `/var/lib/worca-shared` | |
| `storage.shared.hostPath.nodeName` | `""` | pin the PV to a node |
| `storage.shared.prepare.enabled` | `false` | root init container: `mkdir`/`chown 1000` the shared subdirectories and the DB dir |
| `storage.projects.existingClaim` | `""` | a separate RWX claim at `/projects` instead of the shared claim's `projects` subPath |

### Secrets

| Key | Default | What |
| --- | --- | --- |
| `secrets.existingSecret` | `""` | the controller's `envFrom` Secret (`CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`, `GH_TOKEN` or GitHub App vars, `WORCA_BROKER_SECRET`) |
| `secrets.create` | `false` | create `<fullname>-secrets` from `secrets.values` instead |
| `secrets.values` | `{}` | |

Workers never get this Secret: see `worker.credentialsSecret`.

### Workers

| Key | Default | What |
| --- | --- | --- |
| `worker.image.registry` | `ghcr.io` | |
| `worker.image.repository` | `sinishadjukic/worca-worker` | |
| `worker.image.tagPattern` | `{version}-{engine}{variant}` | `WORCA_K8S_WORKER_IMAGE` = `<registry>/<repository>:<pattern>` |
| `worker.variant` | `""` = `image.variant` | `WORCA_K8S_WORKER_VARIANT` |
| `worker.engines` | `{}` | per-engine `image`, `variant`, `resources` (`WORCA_K8S_ENGINES`, JSON) |
| `worker.resources` | 500m / 1Gi requests, 4Gi limit | `WORCA_K8S_RESOURCES` and the template's container |
| `worker.activeDeadlineSeconds` | `86400` | `WORCA_K8S_ACTIVE_DEADLINE_S`: a hard stop, not an idle timeout; a run holds its worker for its whole life |
| `worker.pendingTimeoutSeconds` | `300` | `WORCA_K8S_PENDING_TIMEOUT_MS` |
| `worker.idleTimeoutSeconds` | `900` | `WORCA_WORKER_CHAT_IDLE_MS` (chat workers) |
| `worker.maxWorkers` | `20` | `WORCA_WORKER_MAX` |
| `worker.credentialsSecret` | `""` | optional `envFrom` Secret on every worker (agents' credentials; no GitHub tokens) |
| `worker.env` | `{}` | `name: value` pairs on every worker |
| `worker.envFrom` | `[]` | |
| `worker.nodeSelector`, `tolerations`, `affinity`, `priorityClassName` | | |
| `worker.tmpSizeLimit` | `2Gi` | emptyDir at `/tmp` |
| `worker.shmSizeLimit` | `256Mi` | memory emptyDir at `/dev/shm` |
| `worker.terminationGracePeriodSeconds` | `30` | |
| `worker.readOnlyRootFilesystem` | `false` | |
| `worker.podAnnotations`, `podLabels` | `{}` | |

The template's fixed parts, which the backend enforces too: `restartPolicy: Never`,
`automountServiceAccountToken: false`, `enableServiceLinks: false`, uid/gid/fsGroup 1000,
seccomp `RuntimeDefault`, all capabilities dropped, mounts `/worca` (subPath `worca`) and
`/projects` (subPath `projects`, or `storage.projects.existingClaim`), `/tmp` and `/dev/shm`
emptyDirs. The worker sets its own `HOME` under `/worca/.worca-cc/worker-homes/<kind>/<id>`.

### Broker

| Key | Default | What |
| --- | --- | --- |
| `broker.enabled` | `false` | the credential broker as a second service |
| `broker.mode` | `single` | `WORCA_BROKER_MODE` |
| `broker.host` | `0.0.0.0` | `WORCA_BROKER_HOST` |
| `broker.existingSecret` | `""` | `envFrom`: `WORCA_BROKER_SECRET`, `WORCA_BROKER_KEY_*`, `WORCA_BROKER_VAULT_KEY` |
| `broker.env` | `{}` | `WORCA_BROKER_PUBLIC_URL`, the key page's Access variables, budgets, ... |
| `broker.storage.storageClassName`, `size` | `""`, `1Gi` | its RWO claim at `/data` |
| `broker.resources` | 100m / 128Mi, 512Mi limit | |
| `broker.keyPage.ingress.*` | off | the key page (8081) for people, in multi mode |

The controller needs `WORCA_BROKER_SECRET` too: put it in the `secrets.*` Secret.

### Network

| Key | Default | What |
| --- | --- | --- |
| `service.type`, `port`, `annotations` | `ClusterIP`, `4317` | the UI Service |
| `ingress.enabled` | `false` | UI only |
| `ingress.className`, `annotations`, `hosts`, `tls` | | hosts become `WORCA_ALLOWED_HOSTS` |
| `networkPolicy.enabled` | `false` | workers: no ingress; egress to controller:4319, broker:8080, DNS and the CIDRs below |
| `networkPolicy.workerEgressCidrs` | `[0.0.0.0/0]` | |
| `networkPolicy.workerEgressExceptCidrs` | RFC 1918 + `169.254.169.254/32` | |

### RBAC and the rest

| Key | Default | What |
| --- | --- | --- |
| `rbac.create` | `true` | the Role and RoleBinding |
| `rbac.podLogs` | `true` | `pods/log: get` |
| `serviceAccount.create`, `name`, `annotations` | `true`, `""`, `{}` | |
| `pdb.enabled` | `false` | `minAvailable: 1`; blocks node drains with one replica |

## Developing the chart

```bash
helm lint deploy/helm/worca
helm template worca deploy/helm/worca --namespace worca | kubeconform -strict -summary
node --test test/helm-chart.test.mjs            # contracts + golden files
UPDATE_GOLDEN=1 node --test test/helm-chart.test.mjs   # after an intended change
```

`Chart.appVersion` follows `package.json`'s version; the test fails when they drift.
