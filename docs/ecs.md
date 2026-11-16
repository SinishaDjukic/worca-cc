# Worca on Amazon ECS

With `WORCA_EXECUTOR=ecs`, the controller starts each worker as an **ECS task**. It uses `RunTask` from
one task definition per engine, waits until the task runs, and ends it with `StopTask`. That gives one
task per run and one per chat thread, just as the Kubernetes backend gives one pod for each. The worker
protocol is the same under every backend ([workers.md](workers.md)). This page covers what is specific
to ECS.

```
browser ─► ALB ─► oauth2-proxy ─► controller task (worca ui)  ── ECS RunTask ──► worker task (run A)
                                   SQLite on a local disk                      ► worker task (chat thread)
                                        │                                            │ ws://<controller>:4319
                                        └────────── EFS: /worca, /projects ◄─────────┘ (same paths everywhere)
```

The backend works on both EC2 and Fargate. Where a task runs is set by configuration: a capacity
provider (an Auto Scaling group with managed scaling, or `FARGATE` / `FARGATE_SPOT`) or a launch type.
A ready-made ECS on EC2 setup is in [worca-iac](https://github.com/milenpankov/worca-iac), `aws-ecs/`.
It runs the controller on one on-demand instance and the workers on spot instances scaled from zero.

## What runs where

| | Controller | Worker |
| --- | --- | --- |
| Image | `worca:<tag>` | `worca-worker:<tag>-<engine>`, set in the engine's task definition |
| Started by | an ECS service (one task) | the controller: `RunTask` with the worker's assignment as a container override |
| `/worca`, `/projects` | a shared volume (EFS) | the same, at the same paths |
| `/worca-db` (SQLite, `WORCA_DB_DIR`) | a local disk: an EBS volume or a host path, **never EFS** | not mounted |
| Credentials | the task definition's `secrets` (SSM, Secrets Manager) | the worker task definition's `secrets` (engine credentials only), or the broker |
| AWS permissions | a task role that may run, describe, list and stop worker tasks | none |

## Configuration

These settings go on the controller, in addition to those in [workers.md](workers.md#configuration).

| Variable | Meaning |
| --- | --- |
| `WORCA_EXECUTOR=ecs` | the ECS backend |
| `WORCA_CONTROLLER_URL` | the address workers dial, `ws://<host>:4319`. **Required.** It must be an address a worker task reaches: a fixed private IP, a Cloud Map name, or an internal load balancer |
| `WORCA_ECS_CLUSTER` | the cluster's name or ARN. **Required** |
| `WORCA_ECS_REGION` | default `AWS_REGION`, then `AWS_DEFAULT_REGION`, then the cluster ARN's region |
| `WORCA_ECS_TASK_DEFINITION` | the task definition per engine, with `{engine}` (default `worca-worker-{engine}`). A family uses its latest active revision; `family:revision` or an ARN pins one |
| `WORCA_ECS_TASK_DEFINITIONS` | JSON `{ "<engine>": "<task definition>" }`, overriding the pattern per engine |
| `WORCA_ECS_CONTAINER` | the worker container's name in the task definition (default `worker`) |
| `WORCA_ECS_CAPACITY_PROVIDER` | run workers on this capacity provider |
| `WORCA_ECS_LAUNCH_TYPE` | or on a launch type: `EC2`, `FARGATE`, `EXTERNAL`. Set one of the two, not both; with neither, the cluster's default strategy applies |
| `WORCA_ECS_SUBNETS`, `WORCA_ECS_SECURITY_GROUPS` | comma lists: the `awsvpc` network of each worker task. Fargate needs them; on EC2 they apply only to an `awsvpc` task definition |
| `WORCA_ECS_ASSIGN_PUBLIC_IP` | `ENABLED` or `DISABLED` (default). Fargate only |
| `WORCA_ECS_PENDING_TIMEOUT_MS` | how long a task may take to reach RUNNING (default 10 min). Under a capacity provider with no room, a task waits in PROVISIONING while an instance starts |
| `WORCA_WORKER_START_OUTER_MS` | the registry's outer limit on a start (default 10 min). Keep it above the pending timeout |
| `WORCA_ECS_POLL_MS` | how often a starting task is described (default 3 s) |
| `WORCA_ECS_ENDPOINT` | another ECS endpoint: a VPC endpoint, or a test fake |
| `WORCA_INSTANCE_ID` | separates this controller's tasks from another's (`startedBy` `worca-<id>` and the `worca.instance` tag) |

**AWS credentials** are the controller task's role (ECS sets `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`). Static
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` work too, for a test. The instance's own role (IMDS) is never
used. The backend signs its requests itself (SigV4), with no AWS SDK.

**The task role** needs:

| Action | Resource |
| --- | --- |
| `ecs:RunTask` | the worker task definitions (condition `ecs:cluster`) |
| `ecs:TagResource` | the cluster's tasks (condition `ecs:CreateAction` = `RunTask`): each task is tagged at launch |
| `ecs:DescribeTasks`, `ecs:StopTask` | the cluster's tasks |
| `ecs:ListTasks` | `*` (condition `ecs:cluster`) |
| `iam:PassRole` | the worker task definitions' execution role (and task role, if any) |

## The worker task definition

The task definition owns everything about where and how a worker runs: the image, CPU and memory, the
volumes, the network mode, logging and the secrets. The backend adds only the worker's environment (its
assignment and the settings every worker inherits; see [workers.md](workers.md#configuration)). It also
tags the task with `worca.instance`, `worca.scope`, `worca.worker`, `worca.engine` and `worca.boot`.

- **The container** must be named `worker` (or `WORCA_ECS_CONTAINER`), run the worker image's own
  entrypoint and command, and set `WORCA_HOME=/worca` and `WORCA_PROJECTS_ROOT=/projects`.
- **The shared volume** goes at `/worca` and `/projects`, as on the controller. With EFS, use an access
  point per directory owned by uid/gid 1000, the images' user.
- **Credentials** an agent may hold (`CLAUDE_CODE_OAUTH_TOKEN`, a model key) go in the task definition's
  `secrets`. They never travel in the RunTask override: the backend refuses the names the other backends
  refuse ([Credentials on workers](workers.md#credentials-on-workers)).
- **Network.** A worker only dials out, to the controller and the internet:
  - On EC2, `bridge` mode avoids an elastic network interface per task (with `awsvpc`, a large
    instance holds only two tasks).
  - On Fargate, the task needs `awsvpc`, and a public IP or a NAT gateway to get out.
- **No task role:** agents get no AWS credentials. On EC2, keep containers away from the instance's own
  role with IMDSv2 and a hop limit of 1.
- **`stopTimeout`** of at least 30 s, so a stopped worker reports its last lines.

## How a start fails

`RunTask` failures and stopped tasks become start failures with ECS's own reason, which the run's
failure policy handles like a lost network:

- **ECS refuses the request:** an unknown task definition, a missing permission, no room under a
  launch type (`RESOURCE:MEMORY`).
- **The task stops before its worker connects:** `CannotPullContainerError`, an essential container that
  exits, with its exit code.
- **The task does not reach RUNNING** within `WORCA_ECS_PENDING_TIMEOUT_MS`. The task is then stopped.

A worker's own output is in the log configuration of its task definition (CloudWatch Logs with
`awslogs`). The backend does not read logs.

## Workers left behind

At boot, the controller lists its instance's running tasks (`startedBy` `worca-<WORCA_INSTANCE_ID>`) and
stops those started by an earlier controller process. That covers a controller that crashed or was
replaced while workers ran.
