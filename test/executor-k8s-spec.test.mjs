// test/executor-k8s-spec.test.mjs — the worker pod overlay: names, labels, the template's fields,
// the enforced ones, image resolution, resources precedence, the forbidden credentials and the
// worker's assignment in its environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  podName, scopeLabel, resolveImage, renderPodSpec, workerSelector, isForbiddenEnvName, normalizeVariant,
  DEFAULT_IMAGE_PATTERN, MIN_TERMINATION_GRACE_S,
} from '../src/core/executor/backends/k8s-pod-spec.mjs';
import { workerEnvFor, classifyPod } from '../src/core/executor/backends/kubernetes.mjs';

const DNS_1123 = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const LABEL_VALUE = /^(?:[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)?$/;
const NOW = 1_762_500_000_000;

const template = () => ({
  apiVersion: 'v1', kind: 'Pod',
  metadata: { labels: { team: 'platform' }, annotations: { 'example.com/owner': 'ops' } },
  spec: {
    serviceAccountName: 'worca-worker',
    nodeSelector: { pool: 'agents' },
    tolerations: [{ key: 'agents', operator: 'Exists' }],
    securityContext: { runAsUser: 1000, fsGroup: 1000 },
    imagePullSecrets: [{ name: 'ghcr' }],
    terminationGracePeriodSeconds: 10,
    restartPolicy: 'Always',
    automountServiceAccountToken: true,
    volumes: [{ name: 'home', persistentVolumeClaim: { claimName: 'worca-home' } }],
    containers: [
      { name: 'sidecar', image: 'busybox' },
      {
        name: 'worker', image: 'placeholder',
        env: [{ name: 'FROM_TEMPLATE', value: '1' }, { name: 'WORCA_HOME', value: '/old' }],
        envFrom: [{ configMapRef: { name: 'worca-worker-env' } }],
        resources: { requests: { cpu: '1' } },
        volumeMounts: [{ name: 'home', mountPath: '/worca' }],
        securityContext: { allowPrivilegeEscalation: false },
      },
    ],
  },
});

const scope = { kind: 'run', id: 'Run_42/Alpha' };
const base = () => ({ template: template(), instanceId: 'worca', scope, scopeKey: 'run:Run_42/Alpha', engine: 'claude', image: 'img:1', env: { A: '1' }, now: NOW, bootId: 'ctl-1' });

test('podName: DNS-1123, ≤ 63 chars, the id shortened to 20 and the time in base36', () => {
  const n = podName(scope, NOW);
  assert.equal(n, `worca-w-run-run-42-alpha-${NOW.toString(36)}`);
  assert.match(n, DNS_1123);
  const long = podName({ kind: 'chat', id: 'T'.repeat(200) + '@@' }, NOW);
  assert.ok(long.length <= 63, long);
  assert.match(long, DNS_1123);
  assert.ok(long.startsWith('worca-w-chat-tttttttttttttttttttt-'));
  assert.match(podName({ kind: 'run', id: '---' }, NOW), DNS_1123, 'an id with nothing usable still names a pod');
  assert.notEqual(podName(scope, NOW), podName(scope, NOW + 1), 'the time keeps names apart');
});

test('scopeLabel: the label charset and 63 chars; a 200-char chat id is hashed, two long ids stay distinct', () => {
  assert.equal(scopeLabel('run:abc-1'), 'run_abc-1');
  assert.match(scopeLabel('chat:C0123/thread.9:x'), LABEL_VALUE);
  const a = scopeLabel('chat:' + 'a'.repeat(200));
  const b = scopeLabel('chat:' + 'a'.repeat(199) + 'b');
  for (const v of [a, b]) { assert.ok(v.length <= 63, v); assert.match(v, LABEL_VALUE); }
  assert.notEqual(a, b);
  assert.match(scopeLabel('::'), LABEL_VALUE);
  assert.match(scopeLabel(''), LABEL_VALUE);
});

test('resolveImage: pattern placeholders, the variant spelling, and a per-engine override', () => {
  assert.equal(resolveImage({ engine: 'claude', version: '1.19.0' }), 'ghcr.io/sinishadjukic/worca-worker:1.19.0-claude');
  assert.equal(resolveImage({ engine: 'codex', version: '1.19.0', variant: 'full' }), 'ghcr.io/sinishadjukic/worca-worker:1.19.0-codex-full');
  assert.equal(resolveImage({ engine: 'codex', version: '1.19.0', variant: '-full' }), 'ghcr.io/sinishadjukic/worca-worker:1.19.0-codex-full');
  assert.equal(resolveImage({ pattern: 'reg.local/w:{engine}{variant}-{version}', engine: 'gemini', version: '2', variant: 'slim' }), 'reg.local/w:gemini-2');
  assert.equal(resolveImage({ engine: 'claude', version: '1', overrides: { claude: 'mine/claude:dev' } }), 'mine/claude:dev');
  assert.equal(resolveImage({ engine: 'codex', version: '1', overrides: { claude: 'mine/claude:dev' } }), 'ghcr.io/sinishadjukic/worca-worker:1-codex');
  assert.equal(normalizeVariant(undefined), '');
  assert.throws(() => normalizeVariant('huge'), /slim or full/);
  assert.throws(() => resolveImage({ engine: '' }), /engine/);
  assert.equal(DEFAULT_IMAGE_PATTERN, 'ghcr.io/sinishadjukic/worca-worker:{version}-{engine}{variant}');
});

test('renderPodSpec: keeps every template field, sets only its own, and leaves the template untouched', () => {
  const input = base();
  const before = JSON.stringify(input.template);
  const m = renderPodSpec(input);
  assert.equal(JSON.stringify(input.template), before, 'the template is not mutated');
  assert.equal(m.metadata.name, podName(scope, NOW));
  assert.deepEqual(m.metadata.labels, {
    team: 'platform',
    'app.kubernetes.io/name': 'worca', 'app.kubernetes.io/component': 'worker', 'app.kubernetes.io/managed-by': 'worca',
    'app.kubernetes.io/instance': 'worca', 'worca.dev/instance': 'worca', 'worca.dev/scope': 'run_Run_42_Alpha', 'worca.dev/engine': 'claude', 'worca.dev/boot': 'ctl-1',
  });
  // A chart's template carries its own standard labels, and its NetworkPolicies select on them: they stay.
  const charted = template();
  charted.metadata.labels = { ...charted.metadata.labels, 'app.kubernetes.io/name': 'my-worca', 'app.kubernetes.io/instance': 'release-1', 'app.kubernetes.io/component': 'something' };
  const c = renderPodSpec({ ...base(), template: charted, instanceId: 'worca-prod' }).metadata.labels;
  assert.deepEqual([c['app.kubernetes.io/name'], c['app.kubernetes.io/instance']], ['my-worca', 'release-1'], "the template's name and instance are not overwritten");
  assert.deepEqual([c['worca.dev/instance'], c['app.kubernetes.io/component'], c['app.kubernetes.io/managed-by']], ['worca-prod', 'worker', 'worca'], 'what the backend lists by is always its own');
  assert.deepEqual(m.metadata.annotations, { 'example.com/owner': 'ops', 'worca.dev/scope': 'run:Run_42/Alpha' });
  // template fields survive
  assert.equal(m.spec.serviceAccountName, 'worca-worker');
  assert.deepEqual(m.spec.nodeSelector, { pool: 'agents' });
  assert.deepEqual(m.spec.tolerations, [{ key: 'agents', operator: 'Exists' }]);
  assert.deepEqual(m.spec.securityContext, { runAsUser: 1000, fsGroup: 1000 });
  assert.deepEqual(m.spec.imagePullSecrets, [{ name: 'ghcr' }]);
  assert.deepEqual(m.spec.volumes, [{ name: 'home', persistentVolumeClaim: { claimName: 'worca-home' } }]);
  assert.equal(m.spec.containers.length, 2);
  assert.deepEqual(m.spec.containers[0], { name: 'sidecar', image: 'busybox' });
  const w = m.spec.containers[1];
  assert.equal(w.image, 'img:1');
  assert.deepEqual(w.envFrom, [{ configMapRef: { name: 'worca-worker-env' } }]);
  assert.deepEqual(w.volumeMounts, [{ name: 'home', mountPath: '/worca' }]);
  assert.deepEqual(w.securityContext, { allowPrivilegeEscalation: false });
  assert.deepEqual(w.resources, { requests: { cpu: '1' } }, 'no request-side resources: the template\'s stay');
  assert.deepEqual(w.env, [{ name: 'FROM_TEMPLATE', value: '1' }, { name: 'WORCA_HOME', value: '/old' }, { name: 'A', value: '1' }], 'env is appended');
  // the enforced ones
  assert.equal(m.spec.restartPolicy, 'Never');
  assert.equal(m.spec.automountServiceAccountToken, false);
  assert.equal(m.spec.enableServiceLinks, false);
  assert.equal(m.spec.terminationGracePeriodSeconds, MIN_TERMINATION_GRACE_S, '10 s in the template is raised to 30');
  assert.equal(m.spec.activeDeadlineSeconds, undefined, 'not set unless given');
});

test('renderPodSpec: a longer template grace stays, activeDeadlineSeconds and an explicit name apply, our env replaces a template duplicate', () => {
  const input = base();
  input.template.spec.terminationGracePeriodSeconds = 120;
  const m = renderPodSpec({ ...input, activeDeadlineSeconds: 3600, name: 'worca-w-given', env: { WORCA_HOME: '/worca' } });
  assert.equal(m.spec.terminationGracePeriodSeconds, 120);
  assert.equal(m.spec.activeDeadlineSeconds, 3600);
  assert.equal(m.metadata.name, 'worca-w-given');
  const w = m.spec.containers[1];
  assert.deepEqual(w.env, [{ name: 'FROM_TEMPLATE', value: '1' }, { name: 'WORCA_HOME', value: '/worca' }]);
});

test('renderPodSpec: resources from the request replace the template\'s; an empty object leaves them', () => {
  const r = { requests: { cpu: '2', memory: '4Gi' }, limits: { memory: '8Gi' } };
  assert.deepEqual(renderPodSpec({ ...base(), resources: r }).spec.containers[1].resources, r);
  assert.deepEqual(renderPodSpec({ ...base(), resources: {} }).spec.containers[1].resources, { requests: { cpu: '1' } });
  assert.deepEqual(renderPodSpec({ ...base(), resources: { requests: {} } }).spec.containers[1].resources, { requests: { cpu: '1' } });
});

test('renderPodSpec: a 200-char chat id yields a valid name and labels; a template without a worker container is refused', () => {
  const id = 'C'.repeat(200);
  const m = renderPodSpec({ ...base(), scope: { kind: 'chat', id }, scopeKey: `chat:${id}`, instanceId: 'tenant-A' });
  assert.ok(m.metadata.name.length <= 63);
  assert.match(m.metadata.name, DNS_1123);
  for (const v of Object.values(m.metadata.labels)) { assert.ok(v.length <= 63, v); assert.match(v, LABEL_VALUE); }
  assert.equal(m.metadata.annotations['worca.dev/scope'], `chat:${id}`, 'the full scope is in the annotation');
  assert.equal(m.metadata.labels['app.kubernetes.io/instance'], 'tenant-A', 'a bare template gets the instance id as a default');
  assert.equal(m.metadata.labels['worca.dev/instance'], 'tenant-A');
  const bad = template(); bad.spec.containers = [{ name: 'main', image: 'x' }];
  assert.throws(() => renderPodSpec({ ...base(), template: bad }), /no container named "worker"/);
  assert.throws(() => renderPodSpec({ ...base(), template: null }), /JSON object/);
});

test('forbidden credentials never enter the pod spec', () => {
  for (const name of ['GH_TOKEN', 'WORCA_GH_APP_KEY', 'WORCA_GH_TOKEN', 'WORCA_BROKER_SECRET', 'WORCA_BROKER_SECRET_FILE', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) {
    assert.equal(isForbiddenEnvName(name), true, name);
    assert.throws(() => renderPodSpec({ ...base(), env: { OK: '1', [name]: 'x' } }), new RegExp(`refusing to pass ${name}`));
    assert.throws(() => workerEnvFor({ controllerUrl: 'ws://c:4319', token: 't', scopeKey: 'run:1', workerId: 'w', extra: { [name]: 'x' } }), /refusing to pass/);
  }
  for (const name of ['WORCA_BROKER_URL', 'GITHUB_REPOSITORY', 'PATH', 'WORCA_MOCK']) assert.equal(isForbiddenEnvName(name), false, name);
});

test('workerEnvFor: the assignment (token via env), the fixed paths, idle, and the pass-through set', () => {
  const controllerEnv = {
    WORCA_BROKER_URL: 'http://worca-broker:4320', NO_PROXY: 'localhost,.svc', HTTPS_PROXY: 'http://proxy.corp:3128', HTTP_PROXY: 'http://127.0.0.1:3128',
    WORCA_CA_CERT_FILE: '/etc/ssl/corp.pem', NODE_EXTRA_CA_CERTS: '/etc/ssl/corp.pem', GIT_AUTHOR_NAME: 'Worca', GIT_COMMITTER_EMAIL: 'w@x', TZ: 'Europe/Sofia', WORCA_MOCK: '1',
    GH_TOKEN: 'ghp_secret', WORCA_GH_APP_KEY: 'pem', WORCA_BROKER_SECRET: 's', ANTHROPIC_API_KEY: 'sk', CLAUDE_CODE_OAUTH_TOKEN: 'oa', WORCA_EXECUTOR: 'kubernetes', PATH: '/bin',
  };
  const env = workerEnvFor({ controllerUrl: 'ws://worca-controller:4319', token: 'tok-1', scopeKey: 'chat:T1', workerId: 'w-chat-ab', idleMs: 900000, controllerEnv, extra: { WORCA_X: 'y' } });
  assert.deepEqual(env, {
    WORCA_CONTROLLER_URL: 'ws://worca-controller:4319', WORCA_WORKER_TOKEN: 'tok-1', WORCA_WORKER_SCOPE: 'chat:T1', WORCA_WORKER_ID: 'w-chat-ab',
    WORCA_HOME: '/worca', WORCA_PROJECTS_ROOT: '/projects', WORCA_WORKER_IDLE_MS: '900000',
    WORCA_BROKER_URL: 'http://worca-broker:4320', WORCA_CA_CERT_FILE: '/etc/ssl/corp.pem', NODE_EXTRA_CA_CERTS: '/etc/ssl/corp.pem', TZ: 'Europe/Sofia', WORCA_MOCK: '1',
    GIT_AUTHOR_NAME: 'Worca', GIT_COMMITTER_EMAIL: 'w@x',
    HTTPS_PROXY: 'http://proxy.corp:3128',
    NO_PROXY: 'localhost,.svc,worca-controller,worca-broker',
    WORCA_X: 'y',
  });
  const plain = workerEnvFor({ controllerUrl: 'ws://c:4319', token: 't', scopeKey: 'run:1', workerId: 'w', controllerEnv: { PATH: '/bin' } });
  assert.equal(plain.WORCA_WORKER_IDLE_MS, undefined);
  assert.equal(plain.NO_PROXY, undefined, 'no proxy settings on the controller: none on the worker');
  assert.equal(plain.WORCA_WORKER_TOKEN, 't');
  const m = renderPodSpec({ ...base(), env: plain });
  const names = m.spec.containers[1].env.map((e) => e.name);
  assert.ok(names.includes('WORCA_WORKER_TOKEN') && names.includes('WORCA_CONTROLLER_URL') && names.includes('WORCA_WORKER_SCOPE') && names.includes('WORCA_WORKER_ID'));
});

test('workerSelector names the managed-by/component/instance labels', () => {
  assert.equal(workerSelector('worca'), 'app.kubernetes.io/managed-by=worca,app.kubernetes.io/component=worker,worca.dev/instance=worca');
});

test('classifyPod: running, exited, fatal image waits, unschedulable and plain pending', () => {
  assert.equal(classifyPod({ status: { phase: 'Running' } }).kind, 'running');
  const exited = classifyPod({ status: { phase: 'Failed', containerStatuses: [{ name: 'worker', state: { terminated: { reason: 'Error', exitCode: 78 } } }] } });
  assert.deepEqual([exited.kind, exited.reason, exited.message], ['exited', 'Error', 'exit code 78']);
  const img = classifyPod({ spec: { containers: [{ name: 'worker', image: 'ghcr.io/x:1' }] }, status: { phase: 'Pending', containerStatuses: [{ name: 'worker', image: 'ghcr.io/x:1', state: { waiting: { reason: 'ImagePullBackOff', message: 'Back-off' } } }] } });
  assert.deepEqual([img.kind, img.reason, img.image], ['fatal', 'ImagePullBackOff', 'ghcr.io/x:1']);
  const uns = classifyPod({ status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: '0/3 nodes are available' }] } });
  assert.deepEqual([uns.kind, uns.message], ['unschedulable', '0/3 nodes are available']);
  const creating = classifyPod({ status: { phase: 'Pending', containerStatuses: [{ name: 'worker', state: { waiting: { reason: 'ContainerCreating' } } }] } });
  assert.deepEqual([creating.kind, creating.reason], ['pending', 'ContainerCreating']);
  assert.equal(classifyPod({ status: {} }).kind, 'pending');
});

test('a worker container that ended inside a Running pod (a sidecar keeps the phase) is an exit, not running', () => {
  const pod = { status: { phase: 'Running', containerStatuses: [
    { name: 'istio-proxy', state: { running: {} } },
    { name: 'worker', state: { terminated: { exitCode: 78, reason: 'Error', message: 'WORCA_CONTROLLER_URL is not set' } } },
  ] } };
  assert.deepEqual(classifyPod(pod), { kind: 'exited', reason: 'Error', message: 'WORCA_CONTROLLER_URL is not set; exit code 78' });
  assert.equal(classifyPod({ status: { phase: 'Running', containerStatuses: [{ name: 'worker', state: { running: {} } }] } }).kind, 'running');
});
