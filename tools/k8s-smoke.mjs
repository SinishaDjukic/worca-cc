#!/usr/bin/env node
// tools/k8s-smoke.mjs — the controller/worker topology end to end on a Kubernetes cluster
// (docs/kubernetes.md). On kind by default:
//
//   node tools/k8s-smoke.mjs                       # build worca:local + worca-worker:local-claude, kind, helm, run
//   node tools/k8s-smoke.mjs --no-build            # reuse the two local images
//   node tools/k8s-smoke.mjs --context my-cluster  # an existing cluster (no kind): the images must be pullable there
//   node tools/k8s-smoke.mjs --keep                # leave the cluster and the release for a look
//   node tools/k8s-smoke.mjs --auth                # also sign-in: Keycloak + oauth2-proxy in front (docs/auth.md)
//
// What it checks, with WORCA_MOCK=1 (no model call, no spend):
//   1. `helm install` with values-kind.yaml (hostPath in place of an RWX class) rolls out; /api/health
//      inside the controller pod reports the kubernetes executor.
//   2. A shell script node, in a Task -> script -> End workflow created through the controller's own
//      API, runs on a worker POD the controller created from the worker image: the run ends `done`,
//      the controller log names the pod, the script's output carries the pod's hostname, and no
//      worker pod is left afterwards.
//   3. `helm test` passes.
// With --auth (tools/k8s-auth/): a throwaway Keycloak (HTTPS, a CA this script makes) with users
// alice (role team-a) and bob (no role), and the chart's `auth` block on (oauth2-proxy, allowed
// group team-a, teams from the `roles` claim). Before the run:
//   a. without a session the proxy redirects to Keycloak (HTML) or refuses (API); never worca's data;
//   b. alice signs in like a browser; /api/whoami through the proxy names her (a shared identity);
//   c. an X-Worca-Identity she sends herself is replaced by the proxy's;
//   d. the controller's Service reached directly, past the proxy, answers 401 (no or a forged token);
//   e. bob signs in at Keycloak and the proxy refuses him (403);
//   f. the WebSocket upgrades through the proxy with alice's session (101), not without one.
// and the run itself is started through the proxy as alice and records her as its starter.
// Needs docker, kubectl, helm, and kind unless --context is given.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHART = 'deploy/helm/worca';

function parseArgs(argv) {
  const out = { auth: false, build: true, keep: false, cluster: 'worca-smoke', context: null, namespace: 'worca', release: 'worca', tag: 'local', controllerImage: 'worca', workerImage: 'worca-worker', values: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-build') out.build = false;
    else if (a === '--keep') out.keep = true;
    else if (a === '--auth') out.auth = true;
    else if (a === '--cluster') out.cluster = argv[++i];
    else if (a === '--context') out.context = argv[++i];
    else if (a === '--namespace' || a === '-n') out.namespace = argv[++i];
    else if (a === '--tag') out.tag = argv[++i];
    else if (a === '--image') { out.controllerImage = argv[++i]; out.build = false; }   // a pushed controller image (repository, no tag) for --context: nothing to build here
    else if (a === '--worker-image') { out.workerImage = argv[++i]; out.build = false; }   // its worker image repository (the smoke appends <tag>-claude)
    else if (a === '--values' || a === '-f') out.values.push(argv[++i]);
    else if (a === '--help' || a === '-h') { console.log('usage: node tools/k8s-smoke.mjs [--no-build] [--keep] [--auth] [--cluster <kind name>] [--context <kube context>] [--image <repo>] [--worker-image <repo>] [-n <namespace>] [--tag <image tag>] [-f <values.yaml>]…'); process.exit(0); }
    else { console.error(`k8s:smoke: unknown argument ${a}`); process.exit(2); }
  }
  return out;
}
const a = parseArgs(process.argv.slice(2));
let failed = false;
const ok = (m) => console.log(`k8s:smoke ok — ${m}`);
const fail = (m) => { failed = true; console.error(`k8s:smoke FAIL — ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, args, { allowFail = false, quiet = false, input } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}\n${r.stderr}${quiet ? '' : r.stdout}`);
  return r;
}
const have = (cmd) => spawnSync(cmd, ['version', '--client'], { encoding: 'utf8' }).status !== null || spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status !== null;
const kubectl = (args, o) => sh('kubectl', [...(a.context ? ['--context', a.context] : []), '-n', a.namespace, ...args], o);
const helm = (args, o) => sh('helm', [...(a.context ? ['--kube-context', a.context] : []), ...args], o);
const inPod = (cmd) => kubectl(['exec', `${a.release}-0`, '--', 'sh', '-c', cmd], { allowFail: true }).stdout;
// The API as the smoke's caller: inside the controller pod as a local caller, or with --auth through
// the proxy with alice's session (auth.cookie, set once she has signed in).
const auth = { cookie: '', base: '', images: { keycloak: 'quay.io/keycloak/keycloak:26.8.2', proxy: 'quay.io/oauth2-proxy/oauth2-proxy:v7.15.6' } };
const api = (args) => (auth.cookie
  ? kubectl(['exec', `${a.release}-0`, '--', 'curl', '-s', '-H', `Cookie: ${auth.cookie}`, '-H', 'content-type: application/json', ...args.map((x) => x.replace('http://127.0.0.1:4317', auth.base))], { allowFail: true }).stdout
  : kubectl(['exec', `${a.release}-0`, '--', 'curl', '-s', '-H', 'Host: localhost', '-H', 'content-type: application/json', ...args], { allowFail: true }).stdout);
// A script from tools/k8s-auth/ run by node inside the controller pod (cluster DNS, the smoke's CA).
const podScript = (file, args) => kubectl(['exec', '-i', `${a.release}-0`, '--', 'node', '--input-type=module', '-', ...args], { allowFail: true, input: readFileSync(resolve(ROOT, 'tools/k8s-auth', file), 'utf8') }).stdout.trim();
const curlStatus = (args) => kubectl(['exec', `${a.release}-0`, '--', 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code} %{redirect_url}', ...args], { allowFail: true }).stdout.trim();

/** --auth: the CA, Keycloak and the chart values that turn the proxy on. Returns the extra --set flags. */
async function setupAuth() {
  const ns = a.namespace;
  const fullname = a.release.includes('worca') ? a.release : `${a.release}-worca`;
  const authHost = `${fullname}-auth.${ns}.svc`;
  auth.base = `http://${authHost}:4180`;
  const issuer = `https://keycloak.${ns}.svc:8443/realms/worca`;
  const redirect = `${auth.base}/oauth2/callback`;
  const dir = mkdtempSync(join(tmpdir(), 'worca-auth-smoke-'));
  try {
    const ossl = (args) => sh('openssl', args, { quiet: true });
    ossl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=worca smoke CA', '-keyout', join(dir, 'ca.key'), '-out', join(dir, 'ca.crt')]);
    ossl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=keycloak.${ns}.svc`, '-keyout', join(dir, 'tls.key'), '-out', join(dir, 'tls.csr')]);
    writeFileSync(join(dir, 'ext.cnf'), `subjectAltName=DNS:keycloak.${ns}.svc,DNS:keycloak.${ns}.svc.cluster.local,DNS:keycloak\nextendedKeyUsage=serverAuth\n`);
    ossl(['x509', '-req', '-in', join(dir, 'tls.csr'), '-CA', join(dir, 'ca.crt'), '-CAkey', join(dir, 'ca.key'), '-CAcreateserial', '-days', '2', '-extfile', join(dir, 'ext.cnf'), '-out', join(dir, 'tls.crt')]);
    const apply = (yaml) => kubectl(['apply', '-f', '-'], { input: yaml, quiet: true });
    const dryRun = (args) => kubectl([...args, '--dry-run=client', '-o', 'yaml'], { quiet: true }).stdout;
    sh('kubectl', [...(a.context ? ['--context', a.context] : []), 'create', 'namespace', ns], { allowFail: true, quiet: true });
    apply(dryRun(['create', 'secret', 'tls', 'keycloak-tls', `--cert=${join(dir, 'tls.crt')}`, `--key=${join(dir, 'tls.key')}`]));
    apply(dryRun(['create', 'secret', 'generic', 'worca-auth-ca', `--from-file=ca.crt=${join(dir, 'ca.crt')}`]));
    writeFileSync(join(dir, 'worca.json'), readFileSync(resolve(ROOT, 'tools/k8s-auth/realm.json'), 'utf8').replace('__REDIRECT_URI__', redirect));
    apply(dryRun(['create', 'configmap', 'keycloak-realm', `--from-file=worca.json=${join(dir, 'worca.json')}`]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  kubectl(['apply', '-f', '-'], { quiet: true, input: readFileSync(resolve(ROOT, 'tools/k8s-auth/keycloak.yaml'), 'utf8').replaceAll('__NAMESPACE__', ns).replaceAll('__KEYCLOAK_IMAGE__', auth.images.keycloak) });
  console.log('k8s:smoke: waiting for Keycloak');
  kubectl(['rollout', 'status', 'deployment/keycloak', '--timeout=300s'], { quiet: true });
  ok('Keycloak up (HTTPS with the smoke\'s CA, realm worca imported)');
  return [
    'auth.enabled=true', `auth.oidc.issuerUrl=${issuer}`, `auth.oidc.jwksUrl=${issuer}/protocol/openid-connect/certs`,
    'auth.oidc.clientId=worca', 'auth.oidc.teamsClaim=roles', 'auth.allowedGroups={team-a}',
    'auth.clientSecret=worca-e2e-client-secret', `auth.cookieSecret=${randomBytes(16).toString('hex')}`,
    'auth.caSecret=worca-auth-ca', `auth.redirectUrl=${redirect}`, 'auth.cookie.secure=false',
    `controller.env.WORCA_ALLOWED_HOSTS=${authHost}`,
  ];
}

/** --auth: what the proxy and worca admit, before the run (a-f in the header). */
function authChecks() {
  const ns = a.namespace;
  const noSession = curlStatus(['-H', 'Accept: text/html', `${auth.base}/`]);
  const apiNoSession = curlStatus(['-H', 'Accept: application/json', `${auth.base}/api/history`]);
  if (!/^302 https:\/\/keycloak\./.test(noSession) && !/^302 .*\/oauth2\/start/.test(noSession)) fail(`a page without a session should redirect to sign-in, got ${noSession}`);
  else if (!/^(401|403|302)\b/.test(apiNoSession)) fail(`the API without a session answered ${apiNoSession}`);
  else ok(`no session: the page redirects to sign-in, the API answers ${apiNoSession.split(' ')[0]}`);

  const alice = JSON.parse(podScript('login.mjs', [auth.base, 'alice', 'alice-e2e-pw']) || '{}');
  if (alice.status !== 302 || !alice.cookie) { fail(`alice could not sign in: ${JSON.stringify(alice)}\n${proxyLog()}`); return false; }
  auth.cookie = alice.cookie;
  let who = null;
  try { who = JSON.parse(api(['http://127.0.0.1:4317/api/whoami'])); } catch { /* below */ }
  if (who?.name !== 'alice@example.com' || !who.shared) { fail(`/api/whoami through the proxy: ${JSON.stringify(who)}\n${controllerLog()}`); return false; }
  ok(`alice signed in through Keycloak; worca verified her ID token (whoami: ${who.name}, source ${who.source})`);

  let spoofed = null;
  try { spoofed = JSON.parse(api(['-H', 'X-Worca-Identity: forged.by.client', 'http://127.0.0.1:4317/api/whoami'])); } catch { /* below */ }
  if (spoofed?.name !== 'alice@example.com') fail(`a client-sent X-Worca-Identity reached worca: ${JSON.stringify(spoofed)}`);
  else ok('a client-sent X-Worca-Identity is replaced by the proxy');

  const direct = `http://${a.release.includes('worca') ? a.release : `${a.release}-worca`}.${ns}.svc:4317/api/history`;
  const host = new URL(auth.base).hostname;
  const bypass = curlStatus(['-H', `Host: ${host}`, direct]).split(' ')[0];
  const forged = curlStatus(['-H', `Host: ${host}`, '-H', 'X-Worca-Identity: eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.eyJzdWIiOiJ4In0.c2ln', direct]).split(' ')[0];
  if (bypass !== '401' || forged !== '401') fail(`past the proxy the controller answered ${bypass} (no token) / ${forged} (forged token), expected 401`);
  else ok('past the proxy, the controller refuses requests without a valid token (401)');

  const bob = JSON.parse(podScript('login.mjs', [auth.base, 'bob', 'bob-e2e-pw']) || '{}');
  if (bob.status !== 403) fail(`bob (no team-a role) should be refused by the proxy, got ${JSON.stringify({ status: bob.status, error: bob.error, trail: bob.trail })}`);
  else ok('bob signed in at Keycloak but holds no allowed role: the proxy refuses him (403)');

  const ws = podScript('ws-check.mjs', [auth.base, auth.cookie]);
  const wsAnon = podScript('ws-check.mjs', [auth.base]);
  if (ws !== '101' || wsAnon === '101') fail(`WebSocket through the proxy: ${ws} with a session, ${wsAnon} without`);
  else ok(`the WebSocket upgrades through the proxy with a session (101), not without (${wsAnon})`);
  return true;
}
const proxyLog = () => kubectl(['logs', `deployment/${a.release.includes('worca') ? a.release : `${a.release}-worca`}-auth`, '--tail=30'], { allowFail: true }).stdout;
const controllerLog = () => kubectl(['logs', `${a.release}-0`, '--tail=40'], { allowFail: true }).stdout;

async function main() {
  for (const tool of ['docker', 'kubectl', 'helm', ...(a.context ? [] : ['kind']), ...(a.auth ? ['openssl'] : [])]) {
    if (!have(tool)) { console.error(`k8s:smoke: ${tool} is not installed`); process.exit(2); }
  }
  const ctrl = `${a.controllerImage}:${a.tag}`;
  const worker = `${a.workerImage}:${a.tag}-claude`;
  if (a.build) {
    console.log(`k8s:smoke: building ${ctrl} and ${worker}`);
    sh('node', ['tools/docker-build.mjs', '--tag', ctrl], { quiet: true });
    sh('node', ['tools/docker-build.mjs', '--target', 'worker', '--engine', 'claude', '--tag', worker], { quiet: true });
  }
  let madeCluster = false;
  try {
    if (!a.context) {
      const clusters = sh('kind', ['get', 'clusters'], { allowFail: true }).stdout.split('\n').filter(Boolean);
      if (!clusters.includes(a.cluster)) { console.log(`k8s:smoke: creating kind cluster ${a.cluster}`); sh('kind', ['create', 'cluster', '--name', a.cluster, '--wait', '120s'], { quiet: true }); madeCluster = true; }
      a.context = `kind-${a.cluster}`;
      console.log('k8s:smoke: loading the images into the cluster');
      sh('kind', ['load', 'docker-image', '--name', a.cluster, ctrl, worker], { quiet: true });
      if (a.auth) {
        // Pulled here and loaded, so the node needs no route (or proxy) to quay.io.
        for (const img of Object.values(auth.images)) if (sh('docker', ['image', 'inspect', img], { allowFail: true, quiet: true }).status !== 0) sh('docker', ['pull', img], { quiet: true });
        sh('kind', ['load', 'docker-image', '--name', a.cluster, ...Object.values(auth.images)], { quiet: true });
      }
    }
    // kind stores a loaded `worca:local` as docker.io/library/worca:local; the chart renders <registry>/<repository>:<tag>.
    const repoPart = (ref) => { const i = ref.lastIndexOf(':'); return i > ref.lastIndexOf('/') ? ref.slice(0, i) : ref; };   // a registry port is before the last `/`
    const ctrlRepo = repoPart(ctrl);
    const workerRepo = repoPart(worker);
    const repoOf = (r) => (r.includes('/') ? r : `library/${r}`);
    const registryOf = (r) => (r.includes('/') && /[.:]/.test(r.split('/')[0]) ? r.split('/')[0] : 'docker.io');   // a registry has a dot or a port
    const set = [
      `image.registry=${registryOf(ctrlRepo)}`, `image.repository=${repoOf(ctrlRepo).replace(/^[^/]+\.[^/]+\//, '')}`, `image.tag=${a.tag}`, 'image.pullPolicy=IfNotPresent',
      `worker.image.registry=${registryOf(workerRepo)}`, `worker.image.repository=${repoOf(workerRepo).replace(/^[^/]+\.[^/]+\//, '')}`,
    ];
    if (a.auth) set.push(...await setupAuth());
    console.log(`k8s:smoke: helm install ${a.release} in ${a.namespace}${a.auth ? ' (auth on)' : ''}`);
    helm(['upgrade', '--install', a.release, CHART, '-n', a.namespace, '--create-namespace', '-f', `${CHART}/values-kind.yaml`, ...a.values.flatMap((v) => ['-f', v]), ...set.flatMap((s) => ['--set', s]), '--wait', '--timeout', '5m'], { quiet: true });
    kubectl(['rollout', 'status', `statefulset/${a.release}`, '--timeout=300s'], { quiet: true });
    ok(`release ${a.release} rolled out`);

    let health = null;
    for (let i = 0; i < 60 && !health; i++) {
      try { const h = JSON.parse(api(['http://127.0.0.1:4317/api/health']) || 'null'); if (h?.executor) health = h; } catch { /* not up */ }
      if (!health) await sleep(2000);
    }
    if (!health) { process.stderr.write(kubectl(['logs', `${a.release}-0`, '--tail=80'], { allowFail: true }).stdout); return fail('/api/health in the controller pod never reported an executor'); }
    if (health.executor.kind !== 'kubernetes') return fail(`executor = ${JSON.stringify(health.executor)}`);
    ok(`controller pod up with executor ${health.executor.kind}`);
    if (a.auth) {
      kubectl(['rollout', 'status', `deployment/${a.release.includes('worca') ? a.release : `${a.release}-worca`}-auth`, '--timeout=120s'], { quiet: true });
      if (!authChecks()) return;
    }

    const script = api(['-X', 'POST', 'http://127.0.0.1:4317/api/scripts', '-d', JSON.stringify({
      meta: { key: 'smokeHello', metaVersion: 2, runtime: 'shell', displayName: 'Smoke hello', command: 'echo hello-from-$(hostname); echo HOME=$HOME',
        inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'pass', type: 'void' }] }, source: '',
    })]);
    if (!/"key":"smokeHello"/.test(script) && !/already exists/.test(script)) return fail(`cannot create the script: ${script.slice(0, 200)}`);
    const wf = api(['-X', 'POST', 'http://127.0.0.1:4317/api/workflows', '-d', JSON.stringify({
      name: 'Smoke worker script', version: 2, domain: 'coding',
      nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 198, config: {} }, { id: 'n_sh', kind: 'script', key: 'smokeHello', x: 360, y: 198, config: {} }, { id: 'n_end', kind: 'end', x: 660, y: 198, config: {} }],
      wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_sh', port: 'task' } }, { id: 'w2', from: { node: 'n_sh', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
    })]);
    let wfId = null;
    try { wfId = JSON.parse(wf).workflow.id; } catch { /* maybe it exists from a kept release */ }
    if (!wfId) { try { wfId = JSON.parse(api(['http://127.0.0.1:4317/api/workflows'])).workflows.find((w) => w.name === 'Smoke worker script')?.id ?? null; } catch { /* below */ } }
    if (!wfId) return fail(`cannot save the workflow: ${wf.slice(0, 300)}`);
    const run = api(['-X', 'POST', 'http://127.0.0.1:4317/api/run', '-d', JSON.stringify({ noProject: true, prompt: 'say hello', workflowId: wfId, mock: true, humanInLoop: false })]);
    let pipelineId = null;
    try { pipelineId = JSON.parse(run).pipelineId; } catch { /* below */ }
    if (!pipelineId) return fail(`cannot start the run: ${run.slice(0, 300)}`);
    console.log(`k8s:smoke: run ${pipelineId} started; watching worker pods`);
    let status = null; let sawPod = null;
    for (let i = 0; i < 150 && !['done', 'error', 'paused', 'stopped'].includes(status); i++) {
      const pods = kubectl(['get', 'pods', '-l', 'app.kubernetes.io/component=worker', '-o', 'jsonpath={range .items[*]}{.metadata.name} {.status.phase}{"\\n"}{end}'], { allowFail: true }).stdout.trim();
      if (pods) { sawPod = pods; console.log(`k8s:smoke: worker pod: ${pods.replace(/\n/g, ' | ')}`); }
      await sleep(1000);
      try { status = JSON.parse(api(['http://127.0.0.1:4317/api/history'])).pipelines.find((p) => p.id === pipelineId)?.status ?? null; } catch { status = null; }
    }
    const log = kubectl(['logs', `${a.release}-0`], { allowFail: true }).stdout;
    const created = new RegExp(`pod (\\S+) created for run:${pipelineId}`).exec(log);
    if (status !== 'done') fail(`the run ended ${status}\n${log.split('\n').filter((l) => /executor|worker|k8s|error/i.test(l)).slice(-30).join('\n')}`);
    else if (!created) fail(`the controller log names no worker pod for run:${pipelineId}\n${log.split('\n').filter((l) => /executor|workers|k8s/.test(l)).slice(-20).join('\n')}`);
    else {
      let left = 'x';
      for (let i = 0; i < 60 && left; i++) { left = kubectl(['get', 'pods', '-l', 'app.kubernetes.io/component=worker', '-o', 'name'], { allowFail: true }).stdout.trim(); if (left) await sleep(1000); }
      const output = inPod(`grep -rh "hello-from-" /worca/.worca-cc/store/*/pipelines/*${pipelineId}*/ 2>/dev/null | head -1`);
      if (left) fail(`worker pod(s) still present a minute after the run: ${left}`);
      else if (!output.includes(`hello-from-${created[1]}`)) fail(`the script's output does not carry the worker pod's hostname (${created[1]}): ${output.slice(0, 200)}`);
      else ok(`run ${pipelineId} done; its script ran on pod ${created[1]} (${sawPod ? 'seen running' : 'too quick to catch'}), removed afterwards`);
      if (a.auth) {
        let by = null;
        try { by = JSON.parse(api(['http://127.0.0.1:4317/api/history'])).pipelines.find((p) => p.id === pipelineId)?.startedBy ?? null; } catch { /* below */ }
        if (by !== 'alice@example.com') fail(`the run started through the proxy records startedBy ${JSON.stringify(by)}, expected alice@example.com`);
        else ok('the run records alice, who started it through the proxy, as its starter');
      }
    }
    const t = helm(['test', a.release, '-n', a.namespace, '--timeout', '120s'], { allowFail: true, quiet: true });
    if (t.status !== 0) fail(`helm test: ${t.stderr}${t.stdout}`); else ok('helm test passed');
  } finally {
    if (a.keep) console.log(`k8s:smoke: kept release ${a.release} in ${a.namespace}${madeCluster ? ` on kind cluster ${a.cluster}` : ''}`);
    else {
      helm(['uninstall', a.release, '-n', a.namespace, '--wait'], { allowFail: true, quiet: true });
      if (a.auth) kubectl(['delete', 'deployment/keycloak', 'service/keycloak', 'configmap/keycloak-realm', 'secret/keycloak-tls', 'secret/worca-auth-ca', '--ignore-not-found'], { allowFail: true, quiet: true });
      if (madeCluster) sh('kind', ['delete', 'cluster', '--name', a.cluster], { allowFail: true, quiet: true });
    }
  }
  if (failed) process.exit(1);
  console.log('k8s:smoke PASSED');
}

main().catch((err) => { console.error(`k8s:smoke FAILED — ${err.message}`); process.exit(1); });
