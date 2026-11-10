// test/helm-chart.test.mjs
// The Helm chart (deploy/helm/worca, docs/kubernetes.md) lints and renders, and what it renders
// keeps the contracts the kubernetes executor backend and the server rely on: the worker pod
// template is a Pod with a `worker` container that mounts /worca and /projects and never
// restarts; the controller's probes carry the Host header the server's Host guard needs; the
// termination grace period covers the drain; the env names the backend reads are present.
// Golden files (test/fixtures/helm/*.golden.yaml) catch every other change: UPDATE_GOLDEN=1
// rewrites them after an intended one.
//
// Needs `helm` on PATH (skipped with a message otherwise); runs `kubeconform` too when present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { renderPodSpec } from '../src/core/executor/backends/k8s-pod-spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHART = join(ROOT, 'deploy', 'helm', 'worca');
const FIXTURES = join(ROOT, 'test', 'fixtures', 'helm');
const RELEASE = 'worca';
const NAMESPACE = 'worca-test';

const onPath = (bin) => (process.env.PATH || '').split(delimiter).some((d) => d && existsSync(join(d, bin)));
const HELM = onPath('helm');
const KUBECONFORM = onPath('kubeconform');
const skip = HELM ? false : 'helm is not on PATH: install Helm 3 (https://helm.sh/docs/intro/install/) to run the chart tests';

const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
};
const ok = (r, what) => assert.equal(r.status, 0, `${what} failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);

const chart = YAML.parse(readFileSync(join(CHART, 'Chart.yaml'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const render = (valuesFiles = []) => {
  const args = ['template', RELEASE, CHART, '--namespace', NAMESPACE];
  for (const f of valuesFiles) args.push('-f', f);
  const r = run('helm', args);
  ok(r, `helm ${args.join(' ')}`);
  return r.stdout;
};
const docs = (rendered) => YAML.parseAllDocuments(rendered).map((d) => d.toJS()).filter((d) => d && d.kind);
const byKind = (all, kind, name) => all.find((d) => d.kind === kind && (!name || d.metadata?.name === name));
const envOf = (container) => Object.fromEntries((container.env || []).map((e) => [e.name, e.value ?? e.valueFrom]));

// Chart and app versions appear in labels and image tags; the golden files hold placeholders so a
// release bump never fails this test. Everything else is compared verbatim.
// Helm 4 also puts a blank line before each document separator and one more at the very end where
// Helm 3 did not: whitespace only, folded away so one golden serves both.
const normalise = (s) => s
  .replaceAll(chart.appVersion, '__APP_VERSION__')
  .replaceAll(`${chart.name}-${chart.version}`, `${chart.name}-__CHART_VERSION__`)
  .replace(/\n\n+---\n/g, '\n---\n')
  .replace(/\n+$/, '\n');

const compareGolden = (name, rendered) => {
  const file = join(FIXTURES, `${name}.golden.yaml`);
  const actual = normalise(rendered);
  if (process.env.UPDATE_GOLDEN === '1') { writeFileSync(file, actual); return; }
  assert.ok(existsSync(file), `${file} is missing: run UPDATE_GOLDEN=1 node --test test/helm-chart.test.mjs`);
  const expected = readFileSync(file, 'utf8');
  if (actual !== expected) {
    // The first differing lines, so a CI log says what changed (a Helm version, a template edit).
    const a = actual.split('\n'); const e = expected.split('\n');
    const diff = [];
    for (let i = 0; i < Math.max(a.length, e.length) && diff.length < 24; i++) if (a[i] !== e[i]) diff.push(`@${i + 1}\n- ${e[i] ?? '<end>'}\n+ ${a[i] ?? '<end>'}`);
    assert.fail(`${name} rendering differs from ${file} (UPDATE_GOLDEN=1 rewrites it after an intended change; helm ${helmVersion()}):\n${diff.join('\n')}`);
  }
};
const helmVersion = () => { try { return run('helm', ['version', '--short']).stdout.trim(); } catch { return '?'; } };

const kubeconform = (rendered, what) => {
  const r = run('kubeconform', ['-strict', '-summary', '-ignore-missing-schemas', '-schema-location', 'default'], rendered);
  ok(r, `kubeconform (${what})`);
};

test('Chart.yaml: apiVersion v2, appVersion is package.json\'s version', { skip }, () => {
  assert.equal(chart.apiVersion, 'v2');
  assert.equal(chart.name, 'worca');
  assert.equal(chart.type, 'application');
  assert.match(chart.version, /^\d+\.\d+\.\d+$/);
  assert.equal(chart.appVersion, pkg.version, 'Chart.appVersion follows package.json version (bump both)');
});

test('helm lint: default values and values-kind.yaml', { skip }, () => {
  ok(run('helm', ['lint', CHART]), 'helm lint');
  ok(run('helm', ['lint', CHART, '-f', join(CHART, 'values-kind.yaml')]), 'helm lint -f values-kind.yaml');
});

test('default render: the worker pod template, the controller StatefulSet and the Services keep their contracts', { skip }, () => {
  const rendered = render();
  const all = docs(rendered);
  const kinds = all.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['ConfigMap', 'PersistentVolumeClaim', 'Pod', 'Role', 'RoleBinding', 'Service', 'Service', 'ServiceAccount', 'StatefulSet']);

  // The worker pod template: valid JSON, a Pod, container `worker`, never restarts, mounts both paths.
  const cm = byKind(all, 'ConfigMap', `${RELEASE}-worker-pod`);
  assert.ok(cm, 'ConfigMap <fullname>-worker-pod');
  const pod = JSON.parse(cm.data['worker-pod.json']);
  assert.equal(pod.kind, 'Pod');
  assert.equal(pod.apiVersion, 'v1');
  if (pod.spec.restartPolicy !== undefined) assert.equal(pod.spec.restartPolicy, 'Never');
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.enableServiceLinks, false);
  assert.equal(pod.spec.containers.length, 1);
  const worker = pod.spec.containers[0];
  assert.equal(worker.name, 'worker');
  const mounts = Object.fromEntries(worker.volumeMounts.map((m) => [m.mountPath, m]));
  assert.equal(mounts['/worca']?.subPath, 'worca');
  assert.equal(mounts['/projects']?.subPath, 'projects');
  assert.ok(mounts['/tmp'] && mounts['/dev/shm'], '/tmp and /dev/shm are emptyDirs');
  const vols = Object.fromEntries(pod.spec.volumes.map((v) => [v.name, v]));
  assert.equal(vols[mounts['/worca'].name].persistentVolumeClaim.claimName, `${RELEASE}-shared`);
  assert.equal(vols.tmp.emptyDir.sizeLimit, '2Gi');
  assert.equal(vols.shm.emptyDir.medium, 'Memory');
  assert.equal(pod.spec.securityContext.runAsUser, 1000);
  assert.equal(pod.spec.securityContext.fsGroup, 1000);
  assert.equal(pod.spec.securityContext.runAsNonRoot, true);
  assert.equal(pod.spec.securityContext.seccompProfile.type, 'RuntimeDefault');
  assert.deepEqual(worker.securityContext.capabilities.drop, ['ALL']);
  assert.equal(pod.metadata.labels['worca.dev/instance'], RELEASE);
  assert.equal(pod.metadata.labels['app.kubernetes.io/component'], 'worker');
  assert.ok('worca.dev/scope' in pod.metadata.annotations);
  assert.equal(envOf(worker).WORCA_HOME, '/worca');
  assert.equal(envOf(worker).WORCA_PROJECTS_ROOT, '/projects');

  // The controller.
  const sts = byKind(all, 'StatefulSet', RELEASE);
  assert.ok(sts, 'StatefulSet <fullname>');
  assert.equal(sts.spec.replicas, 1);
  const tpl = sts.spec.template.spec;
  const ctl = tpl.containers.find((c) => c.name === 'controller');
  assert.ok(ctl, 'container `controller`');
  assert.deepEqual(ctl.args, ['worca', 'ui']);
  for (const probe of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
    // Inside the pod, on loopback: an httpGet probe comes from the kubelet, which the server's peer guard answers 403
    // on every network plugin where the kubelet does not arrive from the pod's own gateway (Calico, AWS VPC CNI, Azure CNI).
    assert.equal(ctl[probe]?.httpGet, undefined, `${probe} is not an httpGet`);
    assert.deepEqual(ctl[probe]?.exec?.command, ['curl', '-fsS', '--max-time', '4', '-H', 'Host: localhost', 'http://127.0.0.1:4317/api/health'], `${probe} asks the server from inside the pod`);
    assert.equal(ctl[probe].timeoutSeconds, 5);
  }
  assert.equal(envOf(ctl).WORCA_K8S_ACTIVE_DEADLINE_S, '86400', 'a worker pod lives as long as a long run: 24 h, the backend\'s own default');
  assert.equal(ctl.startupProbe.failureThreshold * ctl.startupProbe.periodSeconds, 300, 'startup: 60 x 5 s');
  assert.equal(ctl.livenessProbe.initialDelaySeconds, 30);
  assert.equal(ctl.livenessProbe.failureThreshold, 6);
  const env = envOf(ctl);
  assert.equal(env.WORCA_DB_DIR, '/worca-db');
  assert.equal(env.WORCA_EXECUTOR, 'kubernetes');
  assert.equal(env.WORCA_K8S_POD_TEMPLATE, '/etc/worca/worker-pod.json');
  assert.equal(env.WORCA_HOME, '/worca');
  assert.equal(env.WORCA_PROJECTS_ROOT, '/projects');
  assert.equal(env.WORCA_INSTANCE_ID, RELEASE);
  assert.equal(env.WORCA_WORKER_PORT, '4319');
  assert.equal(env.WORCA_CONTROLLER_URL, `ws://${RELEASE}-workers.${NAMESPACE}.svc:4319`);
  assert.equal(env.WORCA_K8S_WORKER_IMAGE, 'ghcr.io/sinishadjukic/worca-worker:{version}-{engine}{variant}');
  assert.equal(env.WORCA_K8S_WORKER_TAG, chart.appVersion);
  assert.equal(env.WORCA_K8S_WORKER_VARIANT, 'slim');
  assert.equal(env.WORCA_K8S_PENDING_TIMEOUT_MS, '300000');
  assert.equal(env.WORCA_K8S_ACTIVE_DEADLINE_S, '86400');
  assert.deepEqual(JSON.parse(env.WORCA_K8S_RESOURCES), worker.resources, 'WORCA_K8S_RESOURCES equals the template\'s worker resources');
  assert.equal(env.WORCA_WORKER_MAX, '20');
  assert.equal(env.WORCA_WORKER_CHAT_IDLE_MS, '900000');
  assert.equal(env.WORCA_DRAIN_TIMEOUT_MS, '20000');
  assert.equal(env.WORCA_BROKER_URL, undefined, 'no broker by default');
  assert.deepEqual(env.WORCA_K8S_NAMESPACE, { fieldRef: { fieldPath: 'metadata.namespace' } });
  assert.ok(env.NO_PROXY.split(',').includes(`${RELEASE}-workers.${NAMESPACE}.svc`), 'NO_PROXY lists the workers Service');
  const drainMs = Number(env.WORCA_DRAIN_TIMEOUT_MS);
  assert.ok(tpl.terminationGracePeriodSeconds >= drainMs / 1000 + 40, `terminationGracePeriodSeconds ${tpl.terminationGracePeriodSeconds} >= drain/1000 + 40`);
  assert.equal(ctl.image, `ghcr.io/sinishadjukic/worca:${chart.appVersion}`);
  const ctlMounts = Object.fromEntries(ctl.volumeMounts.map((m) => [m.mountPath, m]));
  assert.equal(ctlMounts['/worca-db'].name, 'db');
  assert.equal(ctlMounts['/worca'].subPath, 'worca');
  assert.equal(ctlMounts['/projects'].subPath, 'projects');
  assert.equal(ctlMounts['/etc/worca'].readOnly, true);
  assert.deepEqual(sts.spec.volumeClaimTemplates.map((t) => t.metadata.name), ['db']);
  assert.deepEqual(sts.spec.volumeClaimTemplates[0].spec.accessModes, ['ReadWriteOnce']);
  assert.equal(tpl.automountServiceAccountToken, true, 'the backend needs the API');
  assert.equal(tpl.securityContext.runAsNonRoot, true);
  assert.equal(tpl.containers.length, 1, 'no init container unless storage.shared.prepare.enabled');
  assert.equal(tpl.initContainers, undefined);

  // The shared claim is RWX; the Services: UI on 4317 and workers on 4319, both selecting the controller.
  const pvc = byKind(all, 'PersistentVolumeClaim', `${RELEASE}-shared`);
  assert.deepEqual(pvc.spec.accessModes, ['ReadWriteMany']);
  const ui = byKind(all, 'Service', RELEASE);
  const workers = byKind(all, 'Service', `${RELEASE}-workers`);
  assert.equal(workers.spec.publishNotReadyAddresses, true, 'a worker reaches the controller while it is not Ready (it resumes runs as it boots)');
  assert.equal(ui.spec.ports[0].port, 4317);
  assert.equal(workers.spec.ports[0].port, 4319);
  assert.equal(workers.spec.type, 'ClusterIP');
  assert.deepEqual(workers.spec.selector, sts.spec.selector.matchLabels);
  assert.deepEqual(ui.spec.selector, sts.spec.selector.matchLabels);
  assert.notEqual(pod.metadata.labels['app.kubernetes.io/component'], sts.spec.selector.matchLabels['app.kubernetes.io/component'], 'worker pods never match the controller selector');
  assert.equal(sts.spec.serviceName, workers.metadata.name);

  // RBAC: the backend's verbs, this namespace only.
  const role = byKind(all, 'Role');
  const pods = role.rules.find((r) => r.resources.includes('pods'));
  assert.deepEqual([...pods.verbs].sort(), ['create', 'delete', 'get', 'list', 'watch']);
  assert.deepEqual(role.rules.find((r) => r.resources.includes('pods/log')).verbs, ['get']);
  assert.equal(byKind(all, 'RoleBinding').subjects[0].name, tpl.serviceAccountName);

  // The helm test is a pod peer, which the server refuses in local mode (G4) and, with the Ingress on,
  // by Host: it asserts the 403, not a 200.
  const testPod = byKind(all, 'Pod');
  assert.equal(testPod.metadata.annotations['helm.sh/hook'], 'test');
  const curl = testPod.spec.containers[0];
  assert.equal(curl.env.find((e) => e.name === 'URL').value, `http://${byKind(all, 'StatefulSet').metadata.name}:4317/api/health`);
  assert.match(curl.args[0], /!= 403/, 'helm test expects 403 from the Service');
  assert.match(curl.args[0], /forbidden/, "helm test checks for worca's forbidden body");

  compareGolden('default', rendered);
  if (KUBECONFORM) {
    kubeconform(rendered, 'default');
    kubeconform(JSON.stringify(pod), 'worker pod template');
  }
});

test('full render (broker, Ingress, NetworkPolicy, PDB, Secret, projects claim, prepare, engines)', { skip }, () => {
  const rendered = render([join(FIXTURES, 'values-full.yaml')]);
  const all = docs(rendered);
  const kinds = all.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['ConfigMap', 'Deployment', 'Ingress', 'Ingress', 'NetworkPolicy', 'NetworkPolicy', 'PersistentVolumeClaim', 'PersistentVolumeClaim', 'Pod', 'PodDisruptionBudget', 'Role', 'RoleBinding', 'Secret', 'Service', 'Service', 'Service', 'ServiceAccount', 'StatefulSet']);

  const sts = byKind(all, 'StatefulSet', RELEASE);
  const tpl = sts.spec.template.spec;
  const ctl = tpl.containers.find((c) => c.name === 'controller');
  const env = envOf(ctl);
  assert.equal(ctl.image, 'ghcr.io/sinishadjukic/worca:9.9.9-full');
  assert.equal(env.WORCA_K8S_WORKER_TAG, '9.9.9');
  assert.equal(env.WORCA_K8S_WORKER_VARIANT, 'slim', 'worker.variant overrides image.variant');
  assert.equal(env.WORCA_BROKER_URL, `http://${RELEASE}-broker.${NAMESPACE}.svc:8080`);
  assert.equal(env.WORCA_ALLOWED_HOSTS, 'worca.example.com', 'derived from ingress.hosts');
  assert.equal(env.WORCA_CF_ACCESS_TEAM_DOMAIN, 'acme.cloudflareaccess.com');
  assert.equal(env.TZ, 'Europe/Berlin');
  assert.equal(env.WORCA_DRAIN_TIMEOUT_MS, '60000');
  assert.equal(tpl.terminationGracePeriodSeconds, 100);
  assert.deepEqual(JSON.parse(env.WORCA_K8S_ENGINES).codex, { image: 'ghcr.io/example/worca-worker-codex:custom' });
  for (const part of ['127.0.0.1', 'localhost', `${RELEASE}-workers`, `${RELEASE}-broker.${NAMESPACE}.svc`, '.internal.example.com']) {
    assert.ok(env.NO_PROXY.split(',').includes(part), `NO_PROXY has ${part}`);
  }
  assert.deepEqual(env.WORCA_BROKER_SYSTEM_BILL_TO, { configMapKeyRef: { name: 'worca-billing', key: 'system' } }, 'controller.extraEnv is appended');
  assert.deepEqual(ctl.envFrom, [{ secretRef: { name: `${RELEASE}-secrets` } }, { configMapRef: { name: 'worca-extra' } }]);
  assert.equal(tpl.initContainers?.[0]?.name, 'prepare-volumes');
  assert.equal(tpl.initContainers[0].securityContext.runAsUser, 0);
  const ctlMounts = Object.fromEntries(ctl.volumeMounts.map((m) => [m.mountPath, m]));
  assert.equal(ctlMounts['/projects'].name, 'projects');
  assert.equal(ctlMounts['/projects'].subPath, undefined, 'a separate projects claim is mounted whole');
  assert.equal(tpl.volumes.find((v) => v.name === 'projects').persistentVolumeClaim.claimName, 'team-projects');
  assert.deepEqual(tpl.imagePullSecrets, [{ name: 'ghcr-pull' }]);
  assert.equal(tpl.priorityClassName, 'worca-controller');
  assert.equal(sts.spec.volumeClaimTemplates[0].spec.storageClassName, 'fast-ssd');

  const pod = JSON.parse(byKind(all, 'ConfigMap', `${RELEASE}-worker-pod`).data['worker-pod.json']);
  const worker = pod.spec.containers[0];
  assert.equal(worker.name, 'worker');
  assert.equal(pod.spec.restartPolicy, 'Never');
  assert.equal(pod.metadata.labels['worca.dev/instance'], 'worca-prod');
  assert.equal(pod.metadata.labels.team, 'platform');
  assert.equal(pod.spec.priorityClassName, 'worca-worker');
  assert.deepEqual(pod.spec.nodeSelector, { 'worca.dev/pool': 'workers' });
  assert.deepEqual(pod.spec.imagePullSecrets, [{ name: 'ghcr-pull' }]);
  assert.deepEqual(worker.envFrom, [{ secretRef: { name: 'worca-worker-credentials', optional: true } }, { configMapRef: { name: 'worker-extra' } }]);
  assert.equal(envOf(worker).WORCA_BROKER_URL, `http://${RELEASE}-broker.${NAMESPACE}.svc:8080`);
  assert.equal(envOf(worker).GIT_AUTHOR_NAME, 'worca');
  const mounts = Object.fromEntries(worker.volumeMounts.map((m) => [m.mountPath, m]));
  assert.equal(mounts['/worca'].subPath, 'worca');
  assert.equal(mounts['/projects'].name, 'projects');
  assert.equal(pod.spec.volumes.find((v) => v.name === 'projects').persistentVolumeClaim.claimName, 'team-projects');
  assert.equal(pod.spec.volumes.find((v) => v.name === 'tmp').emptyDir.sizeLimit, '8Gi');

  const secret = byKind(all, 'Secret', `${RELEASE}-secrets`);
  assert.deepEqual(Object.keys(secret.stringData).sort(), ['GH_TOKEN', 'WORCA_BROKER_SECRET']);

  const broker = byKind(all, 'Deployment', `${RELEASE}-broker`);
  const bc = broker.spec.template.spec.containers[0];
  assert.deepEqual(bc.args, ['worca', 'broker']);
  assert.equal(bc.image, ctl.image, 'the broker runs the controller image');
  assert.equal(envOf(bc).WORCA_BROKER_MODE, 'multi');
  assert.equal(envOf(bc).WORCA_BROKER_DATA_DIR, '/data');
  assert.equal(bc.readinessProbe.httpGet.path, '/healthz');
  assert.deepEqual(bc.envFrom, [{ secretRef: { name: 'worca-broker' } }]);
  assert.deepEqual(byKind(all, 'PersistentVolumeClaim', `${RELEASE}-broker`).spec.accessModes, ['ReadWriteOnce']);
  const brokerSvc = byKind(all, 'Service', `${RELEASE}-broker`);
  assert.deepEqual(brokerSvc.spec.ports.map((p) => p.port), [8080, 8081]);

  const ingresses = all.filter((d) => d.kind === 'Ingress');
  const ui = ingresses.find((i) => i.metadata.name === RELEASE);
  assert.equal(ui.spec.rules[0].host, 'worca.example.com');
  assert.deepEqual(ui.spec.rules[0].http.paths[0].backend.service, { name: RELEASE, port: { name: 'http' } }, 'the Ingress reaches the UI port only');
  const keys = ingresses.find((i) => i.metadata.name === `${RELEASE}-broker-keypage`);
  assert.deepEqual(keys.spec.rules[0].http.paths[0].backend.service.port, { name: 'keypage' }, 'the key page, never 8080');
  assert.ok(!JSON.stringify(ingresses).includes('workers'), 'the workers Service is never on an Ingress');

  const np = byKind(all, 'NetworkPolicy', `${RELEASE}-workers`);
  assert.deepEqual(np.spec.policyTypes, ['Ingress', 'Egress']);
  assert.deepEqual(np.spec.ingress, [], 'workers accept nothing');
  const egressPorts = np.spec.egress.flatMap((r) => (r.ports || []).map((p) => `${p.protocol}/${p.port}`)).sort();
  assert.deepEqual(egressPorts, ['TCP/4319', 'TCP/53', 'TCP/8080', 'UDP/53']);
  const block = np.spec.egress.find((r) => r.to?.some((t) => t.ipBlock)).to[0].ipBlock;
  assert.equal(block.cidr, '0.0.0.0/0');
  assert.deepEqual(block.except, ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.169.254/32']);
  for (const [k, v] of Object.entries(np.spec.podSelector.matchLabels)) assert.equal(pod.metadata.labels[k], v, `the policy's selector label ${k} is on the worker template`);
  // …and still on the pod the backend creates from it (here the instance id differs from the release name): the
  // backend must not overwrite a label the policy selects on, or workers could not reach the controller.
  const created = renderPodSpec({ template: pod, instanceId: 'worca-prod', scope: { kind: 'run', id: 'r1' }, scopeKey: 'run:r1', engine: 'claude', env: {}, image: 'registry.example/worker:1', bootId: 'ctl-x' });
  for (const [k, v] of Object.entries(np.spec.podSelector.matchLabels)) assert.equal(created.metadata.labels[k], v, `the policy's selector label ${k} survives on the created worker pod`);
  assert.equal(np.spec.podSelector.matchLabels['worca.dev/instance'], 'worca-prod');

  const pdb = byKind(all, 'PodDisruptionBudget');
  assert.equal(pdb.spec.minAvailable, 1);
  assert.deepEqual(pdb.spec.selector.matchLabels, sts.spec.selector.matchLabels);

  compareGolden('full', rendered);
  if (KUBECONFORM) {
    kubeconform(rendered, 'full');
    kubeconform(JSON.stringify(pod), 'worker pod template (full)');
  }
});

test('values-kind.yaml: hostPath PV bound to the shared claim, the prepare init container, mock mode', { skip }, () => {
  const all = docs(render([join(CHART, 'values-kind.yaml')]));
  const pv = byKind(all, 'PersistentVolume');
  assert.ok(pv, 'a hostPath PersistentVolume');
  assert.equal(pv.spec.hostPath.path, '/var/lib/worca-shared');
  assert.deepEqual(pv.spec.claimRef, { namespace: NAMESPACE, name: `${RELEASE}-shared` });
  const pvc = byKind(all, 'PersistentVolumeClaim', `${RELEASE}-shared`);
  assert.equal(pvc.spec.volumeName, pv.metadata.name);
  assert.equal(pvc.spec.storageClassName, '');
  const tpl = byKind(all, 'StatefulSet').spec.template.spec;
  assert.equal(tpl.initContainers[0].name, 'prepare-volumes');
  assert.equal(envOf(tpl.containers[0]).WORCA_MOCK, '1');
});

test('storage.db.accessModes other than ReadWriteOnce fails the render', { skip }, () => {
  const r = run('helm', ['template', RELEASE, CHART, '--namespace', NAMESPACE, '--set', 'storage.db.accessModes={ReadWriteMany}']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /storage\.db\.accessModes must be \[ReadWriteOnce\]/);
});

test('controller.executor=local (agents inside the controller pod, no RBAC) renders', { skip }, () => {
  const r = run('helm', ['template', RELEASE, CHART, '--namespace', NAMESPACE, '--set', 'controller.executor=local', '--set', 'rbac.create=false']);
  ok(r, 'helm template --set controller.executor=local');
  const local = docs(r.stdout);
  assert.equal(envOf(byKind(local, 'StatefulSet').spec.template.spec.containers[0]).WORCA_EXECUTOR, 'local');
  assert.equal(byKind(local, 'Role'), undefined);
});

test('helm template writes to a fresh temp dir cleanly (no leftover files in the chart)', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-helm-'));
  try {
    ok(run('helm', ['template', RELEASE, CHART, '--namespace', NAMESPACE, '--output-dir', dir]), 'helm template --output-dir');
    assert.ok(existsSync(join(dir, 'worca', 'templates', 'controller-statefulset.yaml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
