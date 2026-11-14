// test/executor-ecs.test.mjs — the ecs backend: SigV4 against AWS's published example, the
// credential sources, the JSON client against a fake endpoint (signing headers, error types,
// throttling retries), the pure RunTask request and task classification, and the backend's
// start/stop/probe/list sequence against a scripted ECS API.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signV4, amzDate, credentialSource, createCredentialProvider, createJsonClient, AwsApiError } from '../src/core/executor/backends/aws-api.mjs';
import {
  createEcsBackend, runTaskRequest, classifyTask, placementFor, resolveTaskDefinition, startedByFor, tagValue, ecsRegion,
  MAX_OVERRIDES_BYTES, TAG_BOOT, TAG_INSTANCE, TAG_SCOPE, TAG_WORKER,
} from '../src/core/executor/backends/ecs.mjs';
import { createBackend } from '../src/core/executor/backends/index.mjs';
import { executorConfigError, executorKind } from '../src/core/executor/index.mjs';

const dir = mkdtempSync(join(tmpdir(), 'worca-ecs-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('signV4 reproduces the AWS documentation example (IAM ListUsers)', () => {
  const auth = signV4({
    method: 'GET', path: '/', query: { Version: '2010-05-08', Action: 'ListUsers' },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', Host: 'iam.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
    body: '', region: 'us-east-1', service: 'iam',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
  });
  assert.equal(auth, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  assert.equal(amzDate(new Date('2015-08-30T12:36:00.123Z')), '20150830T123600Z');
});

test('credentialSource: static keys first, then the ECS task role, then a full URI with its token', () => {
  assert.equal(credentialSource({}), null);
  assert.deepEqual(credentialSource({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/x' }).credentials, { accessKeyId: 'a', secretAccessKey: 's', sessionToken: null });
  assert.equal(credentialSource({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/abc' }).url, 'http://169.254.170.2/v2/credentials/abc');
  const full = credentialSource({ AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://169.254.170.23/v1/credentials', AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: '/t' });
  assert.deepEqual([full.url, full.tokenFile], ['http://169.254.170.23/v1/credentials', '/t']);
  assert.throws(() => createCredentialProvider({ env: {} }), /no AWS credentials/);
});

test('container credentials: fetched with the token file, cached, and fetched again near expiry', async () => {
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, 'tok-1\n');
  const seen = [];
  let n = 0;
  const base = await serve((req, res) => {
    seen.push(req.headers.authorization);
    n += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ AccessKeyId: `AK${n}`, SecretAccessKey: 'sk', Token: 'st', Expiration: new Date(Date.parse('2030-01-01T01:00:00Z')).toISOString() }));
  });
  let now = Date.parse('2030-01-01T00:00:00Z');
  const get = createCredentialProvider({ env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: `${base}/creds`, AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: tokenFile }, now: () => now });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(n, 1, 'concurrent callers share one fetch');
  assert.deepEqual([a.accessKeyId, b.accessKeyId, a.sessionToken], ['AK1', 'AK1', 'st']);
  assert.equal(seen[0], 'tok-1');
  now = Date.parse('2030-01-01T00:56:00Z');   // within five minutes of expiry
  assert.equal((await get()).accessKeyId, 'AK2');
});

test('createJsonClient: signed JSON 1.1 POST, error types, throttling retried', async () => {
  const requests = [];
  let throttle = 2;
  const base = await serve(async (req, res) => {
    const body = await readBody(req);
    requests.push({ headers: req.headers, body });
    const op = req.headers['x-amz-target'].split('.').pop();
    if (op === 'Throttled' && throttle-- > 0) { res.writeHead(400, { 'content-type': 'application/x-amz-json-1.1' }); return res.end(JSON.stringify({ __type: 'ThrottlingException', message: 'Rate exceeded' })); }
    if (op === 'Bad') { res.writeHead(400); return res.end(JSON.stringify({ __type: 'com.amazonaws.ecs#ClientException', message: 'Unable to find task definition' })); }
    res.writeHead(200); res.end(JSON.stringify({ ok: op }));
  });
  const client = createJsonClient({ service: 'ecs', region: 'eu-central-1', targetPrefix: 'AmazonEC2ContainerServiceV20141113', endpoint: base, retryMs: 1,
    credentials: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'ST' }) });
  assert.deepEqual(await client.call('ListTasks', { cluster: 'c' }), { ok: 'ListTasks' });
  const h = requests[0].headers;
  assert.equal(h['content-type'], 'application/x-amz-json-1.1');
  assert.equal(h['x-amz-target'], 'AmazonEC2ContainerServiceV20141113.ListTasks');
  assert.equal(h['x-amz-security-token'], 'ST');
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/eu-central-1\/ecs\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(requests[0].body), { cluster: 'c' });
  assert.deepEqual(await client.call('Throttled', {}), { ok: 'Throttled' }, 'two throttles, then an answer');
  await assert.rejects(client.call('Bad', {}), (err) => err instanceof AwsApiError && err.type === 'ClientException' && err.status === 400 && /task definition/.test(err.message));
});

test('task definitions, startedBy, tag values and the region', () => {
  assert.equal(resolveTaskDefinition({ engine: 'claude' }), 'worca-worker-claude');
  assert.equal(resolveTaskDefinition({ pattern: 'poc-{engine}:3', engine: 'codex' }), 'poc-codex:3');
  assert.equal(resolveTaskDefinition({ engine: 'claude', overrides: { claude: 'arn:aws:ecs:eu-central-1:1:task-definition/x:1' } }), 'arn:aws:ecs:eu-central-1:1:task-definition/x:1');
  assert.equal(startedByFor('tenant A:1'), 'worca-tenant-A-1');
  assert.equal(tagValue('chat:abc#1!'), 'chat:abc_1_');
  assert.equal(tagValue('x'.repeat(300)).length, 256);
  assert.equal(ecsRegion({ AWS_REGION: 'eu-west-1', WORCA_ECS_REGION: 'eu-central-1' }), 'eu-central-1');
  assert.equal(ecsRegion({ WORCA_ECS_CLUSTER: 'arn:aws:ecs:us-east-2:123:cluster/poc' }), 'us-east-2');
  assert.equal(ecsRegion({ WORCA_ECS_CLUSTER: 'poc' }), null);
});

test('placementFor: a capacity provider or a launch type, never both; awsvpc when subnets are given', () => {
  assert.deepEqual(placementFor({}), {});
  assert.deepEqual(placementFor({ WORCA_ECS_CAPACITY_PROVIDER: 'workers' }), { capacityProviderStrategy: [{ capacityProvider: 'workers', weight: 1, base: 0 }] });
  assert.deepEqual(placementFor({ WORCA_ECS_LAUNCH_TYPE: 'fargate', WORCA_ECS_SUBNETS: 'a, b', WORCA_ECS_SECURITY_GROUPS: 'sg-1' }),
    { launchType: 'FARGATE', networkConfiguration: { awsvpcConfiguration: { subnets: ['a', 'b'], securityGroups: ['sg-1'], assignPublicIp: 'DISABLED' } } });
  assert.throws(() => placementFor({ WORCA_ECS_CAPACITY_PROVIDER: 'x', WORCA_ECS_LAUNCH_TYPE: 'EC2' }), /not both/);
  assert.throws(() => placementFor({ WORCA_ECS_LAUNCH_TYPE: 'LAMBDA' }), /not one of/);
  assert.throws(() => placementFor({ WORCA_ECS_SECURITY_GROUPS: 'sg-1' }), /needs WORCA_ECS_SUBNETS/);
  assert.throws(() => placementFor({ WORCA_ECS_SUBNETS: 'a', WORCA_ECS_ASSIGN_PUBLIC_IP: 'yes' }), /ENABLED or DISABLED/);
});

test('runTaskRequest: the environment as a container override, identifying tags, idempotency, and the limits', () => {
  const r = runTaskRequest({ cluster: 'poc', taskDefinition: 'worca-worker-claude', env: { WORCA_WORKER_ID: 'w-run-1', A: 1, SKIP: null }, placement: { launchType: 'EC2' },
    instanceId: 'worca', scopeKey: 'run:42', workerId: 'w-run-1', engine: 'claude', bootId: 'ctl-9' });
  assert.deepEqual(r.overrides, { containerOverrides: [{ name: 'worker', environment: [{ name: 'WORCA_WORKER_ID', value: 'w-run-1' }, { name: 'A', value: '1' }] }] });
  assert.deepEqual([r.cluster, r.taskDefinition, r.count, r.startedBy, r.clientToken, r.launchType], ['poc', 'worca-worker-claude', 1, 'worca-worca', 'w-run-1', 'EC2']);
  assert.deepEqual(Object.fromEntries(r.tags.map((t) => [t.key, t.value])), { [TAG_INSTANCE]: 'worca', [TAG_SCOPE]: 'run:42', [TAG_WORKER]: 'w-run-1', 'worca.engine': 'claude', [TAG_BOOT]: 'ctl-9' });
  assert.throws(() => runTaskRequest({ cluster: 'c', taskDefinition: 't', env: { CLAUDE_CODE_OAUTH_TOKEN: 'x' }, scopeKey: 's', workerId: 'w', engine: 'claude' }), /credentials never travel/);
  assert.throws(() => runTaskRequest({ cluster: 'c', taskDefinition: 't', env: { NO_PROXY: 'h,'.repeat(MAX_OVERRIDES_BYTES / 2) }, scopeKey: 's', workerId: 'w', engine: 'claude' }), /8192-byte limit/);
});

test('classifyTask: starting, running, stopped with its reasons, and a worker container that ended', () => {
  assert.deepEqual(classifyTask({ lastStatus: 'PROVISIONING' }), { kind: 'pending', reason: 'PROVISIONING', message: '' });
  assert.equal(classifyTask({}).kind, 'pending');
  assert.equal(classifyTask({ lastStatus: 'PENDING', containers: [{ name: 'worker', lastStatus: 'PENDING' }] }).message, 'container PENDING');
  assert.equal(classifyTask({ lastStatus: 'RUNNING', containers: [{ name: 'worker', lastStatus: 'RUNNING' }] }).kind, 'running');
  assert.deepEqual(classifyTask({ lastStatus: 'STOPPED', stopCode: 'TaskFailedToStart', stoppedReason: 'CannotPullContainerError: pull access denied', containers: [{ name: 'worker', lastStatus: 'STOPPED', reason: 'CannotPullContainerError: pull access denied' }] }),
    { kind: 'stopped', reason: 'TaskFailedToStart', message: 'CannotPullContainerError: pull access denied' });
  assert.deepEqual(classifyTask({ lastStatus: 'RUNNING', containers: [{ name: 'worker', lastStatus: 'STOPPED', exitCode: 1 }] }), { kind: 'stopped', reason: 'RUNNING', message: 'exit code 1' });
  assert.equal(classifyTask({ lastStatus: 'DEACTIVATING', stoppedReason: 'Essential container in task exited' }).kind, 'stopped');
});

/** A scripted ECS API: tasks move through the states each test gives them, one per DescribeTasks. */
function fakeEcs({ states = ['PROVISIONING', 'PENDING', 'RUNNING'], runTask = null } = {}) {
  const calls = [];
  const tasks = new Map();   // arn -> { task, script }
  let n = 0;
  const api = {
    calls,
    tasks,
    async call(op, body) {
      calls.push({ op, body });
      if (op === 'RunTask') {
        if (runTask) return runTask(body);
        n += 1;
        const arn = `arn:aws:ecs:eu-central-1:1:task/poc/t${n}`;
        const task = { taskArn: arn, lastStatus: 'PROVISIONING', desiredStatus: 'RUNNING', taskDefinitionArn: `arn:aws:ecs:eu-central-1:1:task-definition/${body.taskDefinition}:1`,
          overrides: body.overrides, tags: body.tags, createdAt: 1_700_000_000, containers: [{ name: 'worker', image: 'reg/worca-worker:poc-claude', lastStatus: 'PENDING' }] };
        tasks.set(arn, { task, script: [...states] });
        return { tasks: [task], failures: [] };
      }
      if (op === 'DescribeTasks') {
        const out = []; const failures = [];
        for (const arn of body.tasks) {
          const t = tasks.get(arn);
          if (!t) { failures.push({ arn, reason: 'MISSING' }); continue; }
          if (t.script.length) {
            const next = t.script.shift();
            if (typeof next === 'function') next(t.task); else { t.task.lastStatus = next; t.task.containers[0].lastStatus = next === 'RUNNING' ? 'RUNNING' : t.task.containers[0].lastStatus; }
          }
          out.push(structuredClone(t.task));
        }
        return { tasks: out, failures };
      }
      if (op === 'StopTask') {
        const t = tasks.get(body.task);
        if (!t) throw new AwsApiError({ status: 400, type: 'InvalidParameterException', message: 'The referenced task was not found.' });
        Object.assign(t.task, { lastStatus: 'STOPPED', desiredStatus: 'STOPPED', stoppedReason: body.reason }); t.script = [];
        return { task: t.task };
      }
      if (op === 'ListTasks') return { taskArns: [...tasks.values()].filter((t) => t.task.desiredStatus === 'RUNNING' && body.startedBy === 'worca-worca').map((t) => t.task.taskArn) };
      throw new Error(`unexpected ${op}`);
    },
  };
  return api;
}

const ENV = { WORCA_ECS_CLUSTER: 'poc', WORCA_ECS_CAPACITY_PROVIDER: 'workers', WORCA_WORKER_ENGINE: 'claude', TZ: 'Europe/Sofia', GH_TOKEN: 'never' };
const startArgs = (over = {}) => ({ scope: { kind: 'run', id: '42' }, scopeKey: 'run:42', workerId: 'w-run-1', token: 'one-time', controllerUrl: 'ws://controller.worca.local:4319', ...over });

test('start: RunTask on the capacity provider with the worker env, polled until RUNNING; remove stops it', async () => {
  const api = fakeEcs();
  const logs = [];
  const b = createEcsBackend({ env: ENV, api, bootId: 'ctl-1', pollMs: 1, log: (l) => logs.push(l) });
  assert.equal(await b.classFor('codex'), 'worca-worker-codex');
  const h = await b.start(startArgs());
  const run = api.calls.find((c) => c.op === 'RunTask').body;
  assert.equal(run.taskDefinition, 'worca-worker-claude');
  assert.deepEqual(run.capacityProviderStrategy, [{ capacityProvider: 'workers', weight: 1, base: 0 }]);
  const env = Object.fromEntries(run.overrides.containerOverrides[0].environment.map((e) => [e.name, e.value]));
  assert.equal(env.WORCA_WORKER_TOKEN, 'one-time');
  assert.equal(env.WORCA_CONTROLLER_URL, 'ws://controller.worca.local:4319');
  assert.equal(env.TZ, 'Europe/Sofia');
  assert.equal(env.GH_TOKEN, undefined, "the controller's credentials are not passed on");
  assert.deepEqual([h.workerId, h.scopeKey, h.engine, h.own, h.image, h.name], ['w-run-1', 'run:42', 'claude', true, 'reg/worca-worker:poc-claude', 't1']);
  assert.ok(logs.some((l) => /PROVISIONING \(waiting for capacity\)/.test(l)));
  assert.equal(b.describe().live, 1);
  await b.remove(h, { reason: 'idle' });
  assert.deepEqual(api.calls.at(-1), { op: 'StopTask', body: { cluster: 'poc', task: h.taskArn, reason: 'worca: idle' } });
  await b.remove(h, { reason: 'again' });   // ECS forgot it: not an error
  api.tasks.clear();
  await b.remove(h, { reason: 'gone' });
  assert.equal(b.describe().live, 0);
});

test('start: a task that stops before connecting rejects at once with ECS\'s reason', async () => {
  const api = fakeEcs({ states: ['PENDING', (t) => Object.assign(t, { lastStatus: 'STOPPED', stopCode: 'TaskFailedToStart', stoppedReason: 'CannotPullContainerError: not found', containers: [{ name: 'worker', lastStatus: 'STOPPED' }] })] });
  const b = createEcsBackend({ env: ENV, api, pollMs: 1, log: () => {} });
  await assert.rejects(b.start(startArgs()), (err) => err.code === 'EWORKERSTART' && /stopped before connecting: TaskFailedToStart \(CannotPullContainerError: not found\)/.test(err.message));
});

test('start: RunTask failures and API errors are start failures', async () => {
  const b1 = createEcsBackend({ env: { ...ENV, WORCA_ECS_CAPACITY_PROVIDER: '', WORCA_ECS_LAUNCH_TYPE: 'EC2' }, api: fakeEcs({ runTask: () => ({ tasks: [], failures: [{ reason: 'RESOURCE:MEMORY' }] }) }), log: () => {} });
  await assert.rejects(b1.start(startArgs()), (err) => err.code === 'EWORKERSTART' && /did not start a worker task \(worca-worker-claude\): RESOURCE:MEMORY/.test(err.message));
  const b2 = createEcsBackend({ env: ENV, api: fakeEcs({ runTask: () => { throw new AwsApiError({ status: 400, type: 'ClientException', message: 'Unable to find task definition' }); } }), log: () => {} });
  await assert.rejects(b2.start(startArgs()), (err) => err.code === 'EWORKERSTART' && /ClientException: Unable to find task definition/.test(err.message));
});

test('start: the pending timeout stops the task; a connected worker is kept whatever ECS says', async () => {
  const api = fakeEcs({ states: Array(1000).fill('PROVISIONING') });
  const b = createEcsBackend({ env: { ...ENV, WORCA_ECS_PENDING_TIMEOUT_MS: '30' }, api, pollMs: 5, log: () => {} });
  await assert.rejects(b.start(startArgs()), /did not start within 0 s \(last state: PROVISIONING: container PENDING\)/);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(api.calls.some((c) => c.op === 'StopTask'), 'the stuck task is stopped');

  const api2 = fakeEcs({ states: Array(1000).fill('PENDING') });
  let hello = false;
  setTimeout(() => { hello = true; }, 15);
  const b2 = createEcsBackend({ env: ENV, api: api2, pollMs: 5, log: () => {} });
  const h = await b2.start(startArgs({ connected: () => hello }));
  assert.equal(h.workerId, 'w-run-1');
  assert.ok(!api2.calls.some((c) => c.op === 'StopTask'), 'a connected worker is never stopped over its start');
});

test('start: an abort stops the task and rejects with AbortError', async () => {
  const api = fakeEcs({ states: Array(1000).fill('PROVISIONING') });
  const b = createEcsBackend({ env: ENV, api, pollMs: 5, log: () => {} });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 15);
  await assert.rejects(b.start(startArgs({ signal: ctl.signal })), { name: 'AbortError' });
  await new Promise((r) => setTimeout(r, 10));
  assert.match(api.calls.find((c) => c.op === 'StopTask').body.reason, /start abandoned/);
});

test('probe, listWorkers: a stopped or missing task, and only this instance\'s tasks with their owner', async () => {
  const api = fakeEcs();
  const b = createEcsBackend({ env: ENV, api, bootId: 'ctl-1', pollMs: 1, log: () => {} });
  const h = await b.start(startArgs());
  assert.equal(await b.probe(h), null);
  // A task from a previous controller, and a hand-made one with our startedBy but another instance tag.
  const old = await createEcsBackend({ env: ENV, api, bootId: 'ctl-0', pollMs: 1, log: () => {} }).start(startArgs({ workerId: 'w-run-0', scopeKey: 'run:41', scope: { kind: 'run', id: '41' } }));
  api.tasks.get(old.taskArn).task.tags = api.tasks.get(old.taskArn).task.tags.map((t) => t.key === TAG_BOOT ? { ...t, value: 'ctl-0' } : t);
  await createEcsBackend({ env: { ...ENV, WORCA_INSTANCE_ID: 'other' }, api, pollMs: 1, log: () => {} }).start(startArgs({ workerId: 'w-x' }));
  const t3 = [...api.tasks.values()].at(-1).task;
  t3.tags = t3.tags.map((t) => t.key === TAG_INSTANCE ? { ...t, value: 'other' } : t);
  const listed = await b.listWorkers();
  assert.deepEqual(listed.map((x) => [x.workerId, x.scopeKey, x.own]).sort(), [['w-run-0', 'run:41', false], ['w-run-1', 'run:42', true]]);
  await b.remove(h);
  assert.match(await b.probe(h), /^its task stopped: STOPPED \(worca: released\)/);
  api.tasks.delete(h.taskArn);
  assert.equal(await b.probe(h), 'its task is gone');
});

test('the ecs kind is a known executor and its backend needs a cluster and a region', async () => {
  assert.equal(executorKind({ WORCA_EXECUTOR: 'ECS' }), 'ecs');
  assert.equal(executorConfigError({ WORCA_EXECUTOR: 'ecs' }), null);
  await assert.rejects(createBackend('ecs', { env: {} }), /WORCA_ECS_CLUSTER is not set/);
  await assert.rejects(createBackend('ecs', { env: { WORCA_ECS_CLUSTER: 'poc' } }), /no AWS region/);
  await assert.rejects(createBackend('ecs', { env: { WORCA_ECS_CLUSTER: 'poc', AWS_REGION: 'eu-central-1' } }), /no AWS credentials/);
  const b = await createBackend('ecs', { env: { WORCA_ECS_CLUSTER: 'poc', AWS_REGION: 'eu-central-1', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's', WORCA_ECS_LAUNCH_TYPE: 'FARGATE', WORCA_ECS_SUBNETS: 'subnet-1' } });
  assert.deepEqual([b.kind, b.describe().placement, b.describe().region], ['ecs', 'launch type FARGATE', 'eu-central-1']);
});
