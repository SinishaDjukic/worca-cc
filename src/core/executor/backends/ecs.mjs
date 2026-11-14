// src/core/executor/backends/ecs.mjs
// The worker backend for a controller that runs on Amazon ECS: one task per worker, started with
// RunTask from a task definition per engine, watched (DescribeTasks) until it runs, stopped with
// StopTask when the registry releases it. Like the kubernetes backend, `start` resolves once the
// task is RUNNING and the registry then waits for the worker's hello; what it rejects FAST is
// what ECS knows before any process starts: a RunTask ECS refuses (no capacity under a launch
// type, a missing task definition), a task that stops before it ever connects (an image that
// cannot be pulled, a container that exits, with ECS's reason), and a task that does not run
// within WORCA_ECS_PENDING_TIMEOUT_MS. Under a capacity provider a task with no room waits in
// PROVISIONING while managed scaling starts an instance, so that timeout is generous.
//
// The task definition owns everything about WHERE and HOW a worker runs: the image, cpu and
// memory, the volumes (the shared /worca and /projects, usually EFS), network mode, log
// configuration and the credentials it reads from SSM or Secrets Manager. This backend only adds
// the worker's own environment (a container override) and the tags that identify it.
//
// Configuration (the controller's environment):
//   WORCA_ECS_CLUSTER              the cluster's name or ARN (required)
//   WORCA_ECS_REGION               default AWS_REGION, AWS_DEFAULT_REGION, else the cluster ARN's
//   WORCA_ECS_TASK_DEFINITION      family (or family:revision, or ARN) pattern with {engine}; default worca-worker-{engine}
//   WORCA_ECS_TASK_DEFINITIONS     JSON map engine -> task definition, overriding the pattern per engine
//   WORCA_ECS_CONTAINER            the worker container's name in the task definition (default worker)
//   WORCA_ECS_CAPACITY_PROVIDER    run on this capacity provider (an Auto Scaling group with managed scaling, or FARGATE / FARGATE_SPOT)
//   WORCA_ECS_LAUNCH_TYPE          or on a launch type: EC2 | FARGATE | EXTERNAL; neither = the cluster's default strategy
//   WORCA_ECS_SUBNETS, WORCA_ECS_SECURITY_GROUPS   comma lists: the awsvpc network of each task (FARGATE needs them)
//   WORCA_ECS_ASSIGN_PUBLIC_IP     ENABLED | DISABLED (default DISABLED)
//   WORCA_ECS_PENDING_TIMEOUT_MS   how long a task may take to reach RUNNING (default 600000)
//   WORCA_ECS_POLL_MS              how often a starting task is described (default 3000)
//   WORCA_ECS_ENDPOINT             another ECS endpoint (a VPC endpoint, a test fake)
//   WORCA_INSTANCE_ID              what separates this controller's tasks from another's (default worca)
//   plus the AWS credentials aws-api.mjs reads (on ECS: the controller task's role).
//
// The controller's role needs ecs:RunTask on the worker task definitions, ecs:TagResource,
// ecs:DescribeTasks, ecs:ListTasks and ecs:StopTask on the cluster's tasks, and iam:PassRole for
// the worker task definitions' execution role (and task role, if any).
//
// Credentials never travel in a task override: the same names the other backends refuse
// (GH_TOKEN, WORCA_GH_*, WORCA_BROKER_SECRET*, model keys) are refused here; the broker hands
// them to the worker per exec, or the task definition reads them from SSM.
import { randomUUID } from 'node:crypto';
import { createCredentialProvider, createJsonClient, AwsApiError } from './aws-api.mjs';
import { workerEnvFor } from './kubernetes.mjs';
import { assertAllowedEnv } from './k8s-pod-spec.mjs';
import { startFailure, defaultWorkerEngine, envInt, abortError, sleep } from '../shared.mjs';

export const DEFAULT_TASK_DEFINITION = 'worca-worker-{engine}';
export const DEFAULT_CONTAINER = 'worker';
export const DEFAULT_PENDING_TIMEOUT_MS = 600_000;
export const DEFAULT_POLL_MS = 3_000;
export const ECS_TARGET_PREFIX = 'AmazonEC2ContainerServiceV20141113';
/** RunTask's limit on the whole `overrides` object, in bytes of JSON. */
export const MAX_OVERRIDES_BYTES = 8192;
export const TAG_INSTANCE = 'worca.instance';
export const TAG_SCOPE = 'worca.scope';
export const TAG_WORKER = 'worca.worker';
export const TAG_ENGINE = 'worca.engine';
export const TAG_BOOT = 'worca.boot';
const LAUNCH_TYPES = new Set(['EC2', 'FARGATE', 'EXTERNAL']);
/** Task states on the way to RUNNING; anything else (DEACTIVATING, STOPPING, DEPROVISIONING, STOPPED) is the way out. */
const STARTING = new Set(['PROVISIONING', 'PENDING', 'ACTIVATING']);

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const envJson = (env, name) => {
  const raw = String(env[name] || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { throw new Error(`${name} is not valid JSON: ${err.message}`); }
};

/** `startedBy` for this instance's tasks: ECS allows 128 of [A-Za-z0-9_/-]. */
export function startedByFor(instanceId = 'worca') {
  return `worca-${String(instanceId || 'worca').replace(/[^A-Za-z0-9_/-]+/g, '-')}`.slice(0, 128);
}

/** A tag value: ECS allows 256 of letters, digits, spaces and `+ - = . _ : / @`. */
export function tagValue(v) {
  return String(v ?? '').replace(/[^\p{L}\p{N} +\-=._:/@]+/gu, '_').slice(0, 256);
}

/** The task definition for an engine: an explicit override, else the pattern with {engine} filled. */
export function resolveTaskDefinition({ pattern = DEFAULT_TASK_DEFINITION, engine, overrides = null } = {}) {
  const e = String(engine || '').trim();
  if (!e) throw new Error('resolveTaskDefinition: an engine is required');
  const o = overrides && typeof overrides === 'object' ? overrides[e] : null;
  if (typeof o === 'string' && o.trim()) return o.trim();
  return String(pattern || DEFAULT_TASK_DEFINITION).replaceAll('{engine}', e);
}

/** The region: WORCA_ECS_REGION, AWS_REGION, AWS_DEFAULT_REGION, else the one in a cluster ARN; null when none. */
export function ecsRegion(env = process.env) {
  for (const n of ['WORCA_ECS_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION']) { const v = String(env[n] || '').trim(); if (v) return v; }
  const m = /^arn:[^:]+:ecs:([^:]+):/.exec(String(env.WORCA_ECS_CLUSTER || '').trim());
  return m ? m[1] : null;
}

/**
 * Where RunTask places a task (pure): `{ capacityProviderStrategy }`, `{ launchType }` or nothing (the cluster's
 * default strategy), plus `networkConfiguration` when subnets are given.
 */
export function placementFor(env = process.env) {
  const out = {};
  const provider = String(env.WORCA_ECS_CAPACITY_PROVIDER || '').trim();
  const launchType = String(env.WORCA_ECS_LAUNCH_TYPE || '').trim().toUpperCase();
  if (provider && launchType) throw new Error('set WORCA_ECS_CAPACITY_PROVIDER or WORCA_ECS_LAUNCH_TYPE, not both (ECS takes one)');
  if (launchType && !LAUNCH_TYPES.has(launchType)) throw new Error(`WORCA_ECS_LAUNCH_TYPE=${launchType} is not one of ${[...LAUNCH_TYPES].join(', ')}`);
  if (provider) out.capacityProviderStrategy = [{ capacityProvider: provider, weight: 1, base: 0 }];
  if (launchType) out.launchType = launchType;
  const subnets = list(env.WORCA_ECS_SUBNETS);
  const securityGroups = list(env.WORCA_ECS_SECURITY_GROUPS);
  if (securityGroups.length && !subnets.length) throw new Error('WORCA_ECS_SECURITY_GROUPS needs WORCA_ECS_SUBNETS (the awsvpc network)');
  if (subnets.length) {
    const ip = String(env.WORCA_ECS_ASSIGN_PUBLIC_IP || 'DISABLED').trim().toUpperCase();
    if (ip !== 'ENABLED' && ip !== 'DISABLED') throw new Error(`WORCA_ECS_ASSIGN_PUBLIC_IP=${ip} is not ENABLED or DISABLED`);
    out.networkConfiguration = { awsvpcConfiguration: { subnets, ...(securityGroups.length ? { securityGroups } : {}), assignPublicIp: ip } };
  }
  return out;
}

/** The RunTask request for one worker (pure). Throws when the overrides would exceed ECS's limit. */
export function runTaskRequest({ cluster, taskDefinition, container = DEFAULT_CONTAINER, env, placement = {}, instanceId = 'worca', scopeKey, workerId, engine, bootId = null }) {
  assertAllowedEnv(env);
  const overrides = { containerOverrides: [{ name: container, environment: Object.entries(env).filter(([, v]) => v !== undefined && v !== null).map(([name, value]) => ({ name, value: String(value) })) }] };
  const size = Buffer.byteLength(JSON.stringify(overrides));
  if (size > MAX_OVERRIDES_BYTES) throw new Error(`the worker's environment is ${size} bytes, over RunTask's ${MAX_OVERRIDES_BYTES}-byte limit on overrides (a long NO_PROXY?)`);
  return {
    cluster,
    taskDefinition,
    count: 1,
    startedBy: startedByFor(instanceId),
    clientToken: String(workerId).slice(0, 64),   // a retried RunTask (a lost answer) starts no second task
    overrides,
    tags: [
      { key: TAG_INSTANCE, value: tagValue(instanceId) },
      { key: TAG_SCOPE, value: tagValue(scopeKey) },
      { key: TAG_WORKER, value: tagValue(workerId) },
      { key: TAG_ENGINE, value: tagValue(engine) },
      ...(bootId ? [{ key: TAG_BOOT, value: tagValue(bootId) }] : []),
    ],
    ...placement,
  };
}

/**
 * What a task's state means for a worker that must reach RUNNING:
 * `{ kind: 'running' | 'stopped' | 'pending', reason, message }`. `container` is the worker container's name.
 */
export function classifyTask(task, container = DEFAULT_CONTAINER) {
  const last = String(task?.lastStatus || '');
  const c = (task?.containers || []).find((x) => x?.name === container) || null;
  const workerEnded = c?.lastStatus === 'STOPPED';
  if (!workerEnded && last === 'RUNNING') return { kind: 'running', reason: 'RUNNING', message: '' };
  if (!workerEnded && (!last || STARTING.has(last))) return { kind: 'pending', reason: last || 'PROVISIONING', message: c?.lastStatus ? `container ${c.lastStatus}` : '' };
  // On the way out (DEACTIVATING, STOPPING, DEPROVISIONING, STOPPED), or the worker container itself ended.
  const bits = [task?.stoppedReason, c?.reason, c?.exitCode != null ? `exit code ${c.exitCode}` : null].filter(Boolean);
  return { kind: 'stopped', reason: task?.stopCode || last || 'STOPPED', message: [...new Set(bits)].join('; ') };
}

const tagsOf = (task) => Object.fromEntries((task?.tags || []).map((t) => [t.key, t.value]));
const envOf = (task, container) => {
  const o = (task?.overrides?.containerOverrides || []).find((x) => x?.name === container) || task?.overrides?.containerOverrides?.[0];
  return Object.fromEntries((o?.environment || []).map((e) => [e.name, e.value]));
};

export function createEcsBackend({ env = process.env, log = (msg) => console.log(`[worca-ecs] ${msg}`), api = null, bootId = `ctl-${randomUUID()}`, pollMs = null } = {}) {
  const cluster = String(env.WORCA_ECS_CLUSTER || '').trim();
  if (!cluster) throw new Error('WORCA_ECS_CLUSTER is not set: the ecs executor needs the cluster its workers run in');
  const region = ecsRegion(env);
  if (!region && !api) throw new Error('no AWS region for the ecs executor: set WORCA_ECS_REGION (or AWS_REGION)');
  const client = api || createJsonClient({ service: 'ecs', region, targetPrefix: ECS_TARGET_PREFIX, endpoint: String(env.WORCA_ECS_ENDPOINT || '').trim() || null, credentials: createCredentialProvider({ env }) });
  const instanceId = String(env.WORCA_INSTANCE_ID || '').trim() || 'worca';
  const pattern = String(env.WORCA_ECS_TASK_DEFINITION || '').trim() || DEFAULT_TASK_DEFINITION;
  const overrides = envJson(env, 'WORCA_ECS_TASK_DEFINITIONS');
  if (overrides !== null && (typeof overrides !== 'object' || Array.isArray(overrides))) throw new Error('WORCA_ECS_TASK_DEFINITIONS must be a JSON object { engine: task definition }');
  const container = String(env.WORCA_ECS_CONTAINER || '').trim() || DEFAULT_CONTAINER;
  const placement = placementFor(env);
  const pendingTimeoutMs = envInt(env, 'WORCA_ECS_PENDING_TIMEOUT_MS', DEFAULT_PENDING_TIMEOUT_MS);
  const every = pollMs ?? envInt(env, 'WORCA_ECS_POLL_MS', DEFAULT_POLL_MS);
  const startedBy = startedByFor(instanceId);
  const live = new Map();   // workerId -> handle

  const engineFor = () => defaultWorkerEngine(env, ['WORCA_ECS_DEFAULT_ENGINE', 'WORCA_WORKER_ENGINE']);
  const taskDefFor = (engine) => resolveTaskDefinition({ pattern, engine, overrides });
  const shortId = (arn) => String(arn || '').split('/').pop();

  const handleOf = (task, known = {}) => {
    const tags = tagsOf(task);
    const e = envOf(task, container);
    const c = (task?.containers || []).find((x) => x?.name === container);
    return {
      workerId: known.workerId || e.WORCA_WORKER_ID || tags[TAG_WORKER] || shortId(task?.taskArn),
      taskArn: task?.taskArn || null,
      name: shortId(task?.taskArn),
      cluster,
      scopeKey: known.scopeKey || e.WORCA_WORKER_SCOPE || tags[TAG_SCOPE] || null,
      engine: known.engine || tags[TAG_ENGINE] || null,
      bootId: tags[TAG_BOOT] || null,
      own: !!bootId && tags[TAG_BOOT] === tagValue(bootId),   // started by this controller process: never an orphan
      image: c?.image || null,
      taskDefinition: task?.taskDefinitionArn || known.taskDefinition || null,
      startedAt: task?.createdAt ? (typeof task.createdAt === 'number' ? task.createdAt * 1000 : Date.parse(task.createdAt)) || Date.now() : Date.now(),
    };
  };

  async function describe(arns) {
    const out = [];
    for (let i = 0; i < arns.length; i += 100) {
      const res = await client.call('DescribeTasks', { cluster, tasks: arns.slice(i, i + 100), include: ['TAGS'] });
      out.push(...(res.tasks || []));
    }
    return out;
  }

  async function stop(arn, reason) {
    try { await client.call('StopTask', { cluster, task: arn, reason: String(reason || 'released by worca').slice(0, 255) }); } catch (err) {
      // A task ECS no longer knows is as stopped as it gets.
      if (err instanceof AwsApiError && err.type === 'InvalidParameterException' && /not found|cannot be found/i.test(err.message)) return;
      throw err;
    }
  }

  /** Resolve with the task once it is RUNNING; reject on anything that means it never will be. */
  async function awaitRunning(arn, taskDefinition, signal, connected) {
    const deadline = Date.now() + pendingTimeoutMs;
    let last = null;
    let logged = null;
    for (;;) {
      if (signal?.aborted) throw abortError();
      if (connected()) return null;   // the worker said hello first: it runs
      let task = null;
      try { [task] = await describe([arn]); } catch (err) { log(`describe ${shortId(arn)}: ${err.message}`); }
      if (task) {
        const c = classifyTask(task, container);
        last = c;
        if (c.kind === 'running') return task;
        if (c.kind === 'stopped') throw startFailure(`worker task ${shortId(arn)} (${taskDefinition}) stopped before connecting: ${c.reason}${c.message ? ` (${c.message})` : ''}`, { task: arn, reason: c.reason });
        if (c.reason !== logged) { logged = c.reason; log(`task ${shortId(arn)} is ${c.reason}${c.reason === 'PROVISIONING' ? ' (waiting for capacity)' : ''}`); }
      }
      if (Date.now() >= deadline) {
        throw startFailure(`worker task ${shortId(arn)} did not start within ${Math.round(pendingTimeoutMs / 1000)} s (last state: ${last ? `${last.reason}${last.message ? `: ${last.message}` : ''}` : 'unknown'})`, { task: arn });
      }
      await sleep(every, signal);
    }
  }

  const backend = {
    kind: 'ecs',
    bootId,

    /** What tells a scope's workers apart: the task definition an engine resolves to. */
    async classFor(engine) {
      return taskDefFor(engine || await engineFor());
    },

    async start({ scope, scopeKey, workerId, token, controllerUrl, idleMs = null, env: extra = {}, engine: asked = null, signal = null, connected = () => false } = {}) {
      if (!scope?.kind || !scope?.id || !scopeKey || !workerId) throw startFailure('start: scope, scopeKey and workerId are required');
      const workerEnv = workerEnvFor({ controllerUrl, token, scopeKey, workerId, idleMs, controllerEnv: env, extra });
      const engine = asked || await engineFor();
      const taskDefinition = taskDefFor(engine);
      if (signal?.aborted) throw abortError();   // the run was stopped while its worker was being arranged: no task
      let request;
      try { request = runTaskRequest({ cluster, taskDefinition, container, env: workerEnv, placement, instanceId, scopeKey, workerId, engine, bootId }); } catch (err) { throw startFailure(err.message); }
      let res;
      try { res = await client.call('RunTask', request); } catch (err) {
        throw startFailure(err instanceof AwsApiError ? `cannot start a worker task (${taskDefinition}): ${err.type ? `${err.type}: ` : ''}${err.message}` : err.message, { status: err.status, reason: err.type });
      }
      const task = res.tasks?.[0];
      if (!task?.taskArn) {
        const why = (res.failures || []).map((f) => [f.reason, f.detail].filter(Boolean).join(': ')).join('; ') || 'no task and no reason';
        throw startFailure(`ECS did not start a worker task (${taskDefinition}): ${why}`, { reason: res.failures?.[0]?.reason || null });
      }
      const arn = task.taskArn;
      log(`task ${shortId(arn)} started for ${scopeKey} (${taskDefinition})`);
      let running;
      try {
        running = await awaitRunning(arn, taskDefinition, signal, connected);
      } catch (err) {
        // The worker is already connected to the registry: the task runs, whatever the last describe said.
        if (!connected()) {
          stop(arn, `worca: ${err?.name === 'AbortError' ? 'start abandoned' : 'did not start'}`).catch((e) => log(`cleanup of ${shortId(arn)}: ${e.message}`));
          throw err;
        }
        log(`task ${shortId(arn)}: its start could not be confirmed (${err?.message || err}), but its worker is connected`);
      }
      const handle = handleOf(running || task, { workerId, engine, scopeKey, taskDefinition });
      live.set(workerId, handle);
      return handle;
    },

    async remove(handle, { reason } = {}) {
      if (!handle?.taskArn) return;
      live.delete(handle.workerId);
      log(`stopping task ${handle.name}${reason ? ` (${reason})` : ''}`);
      await stop(handle.taskArn, `worca: ${reason || 'released'}`);
    },

    /** Why this worker will never connect, or null while it may: its task has stopped, or is gone. */
    async probe(handle) {
      if (!handle?.taskArn) return null;
      let res;
      try { res = await client.call('DescribeTasks', { cluster, tasks: [handle.taskArn] }); } catch { return null; }
      const task = res.tasks?.[0];
      if (!task) return (res.failures || []).some((f) => f.reason === 'MISSING') ? 'its task is gone' : null;
      const c = classifyTask(task, container);
      return c.kind === 'stopped' ? `its task stopped: ${c.reason}${c.message ? ` (${c.message})` : ''}` : null;
    },

    async listWorkers() {
      const arns = [];
      let nextToken;
      do {
        const res = await client.call('ListTasks', { cluster, startedBy, desiredStatus: 'RUNNING', ...(nextToken ? { nextToken } : {}) });
        arns.push(...(res.taskArns || []));
        nextToken = res.nextToken;
      } while (nextToken);
      if (!arns.length) return [];
      // startedBy is a prefix-free match on our own value; the instance tag guards against a hand-made task with it.
      return (await describe(arns)).filter((t) => tagsOf(t)[TAG_INSTANCE] === tagValue(instanceId)).map((t) => handleOf(t));
    },

    describe() {
      return { kind: 'ecs', cluster, region, instanceId, taskDefinition: pattern, container,
        placement: placement.capacityProviderStrategy ? `capacity provider ${placement.capacityProviderStrategy[0].capacityProvider}` : placement.launchType ? `launch type ${placement.launchType}` : 'cluster default',
        live: live.size };
    },

    async close() {},
  };
  return backend;
}
