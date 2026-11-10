#!/usr/bin/env node
// tools/k8s-smoke.mjs — the controller/worker topology end to end on a Kubernetes cluster
// (docs/kubernetes.md). On kind by default:
//
//   node tools/k8s-smoke.mjs                       # build worca:local + worca-worker:local-claude, kind, helm, run
//   node tools/k8s-smoke.mjs --no-build            # reuse the two local images
//   node tools/k8s-smoke.mjs --context my-cluster  # an existing cluster (no kind): the images must be pullable there
//   node tools/k8s-smoke.mjs --keep                # leave the cluster and the release for a look
//
// What it checks, with WORCA_MOCK=1 (no model call, no spend):
//   1. `helm install` with values-kind.yaml (hostPath in place of an RWX class) rolls out; /api/health
//      inside the controller pod reports the kubernetes executor.
//   2. A shell script node, in a Task -> script -> End workflow created through the controller's own
//      API, runs on a worker POD the controller created from the worker image: the run ends `done`,
//      the controller log names the pod, the script's output carries the pod's hostname, and no
//      worker pod is left afterwards.
//   3. `helm test` passes.
// Needs docker, kubectl, helm, and kind unless --context is given.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHART = 'deploy/helm/worca';

function parseArgs(argv) {
  const out = { build: true, keep: false, cluster: 'worca-smoke', context: null, namespace: 'worca', release: 'worca', tag: 'local', controllerImage: 'worca', workerImage: 'worca-worker', values: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-build') out.build = false;
    else if (a === '--keep') out.keep = true;
    else if (a === '--cluster') out.cluster = argv[++i];
    else if (a === '--context') out.context = argv[++i];
    else if (a === '--namespace' || a === '-n') out.namespace = argv[++i];
    else if (a === '--tag') out.tag = argv[++i];
    else if (a === '--image') { out.controllerImage = argv[++i]; out.build = false; }   // a pushed controller image (repository, no tag) for --context: nothing to build here
    else if (a === '--worker-image') { out.workerImage = argv[++i]; out.build = false; }   // its worker image repository (the smoke appends <tag>-claude)
    else if (a === '--values' || a === '-f') out.values.push(argv[++i]);
    else if (a === '--help' || a === '-h') { console.log('usage: node tools/k8s-smoke.mjs [--no-build] [--keep] [--cluster <kind name>] [--context <kube context>] [--image <repo>] [--worker-image <repo>] [-n <namespace>] [--tag <image tag>] [-f <values.yaml>]…'); process.exit(0); }
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
const api = (args) => kubectl(['exec', `${a.release}-0`, '--', 'curl', '-s', '-H', 'Host: localhost', '-H', 'content-type: application/json', ...args], { allowFail: true }).stdout;

async function main() {
  for (const tool of ['docker', 'kubectl', 'helm', ...(a.context ? [] : ['kind'])]) {
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
    console.log(`k8s:smoke: helm install ${a.release} in ${a.namespace}`);
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
    }
    const t = helm(['test', a.release, '-n', a.namespace, '--timeout', '120s'], { allowFail: true, quiet: true });
    if (t.status !== 0) fail(`helm test: ${t.stderr}${t.stdout}`); else ok('helm test passed');
  } finally {
    if (a.keep) console.log(`k8s:smoke: kept release ${a.release} in ${a.namespace}${madeCluster ? ` on kind cluster ${a.cluster}` : ''}`);
    else {
      helm(['uninstall', a.release, '-n', a.namespace, '--wait'], { allowFail: true, quiet: true });
      if (madeCluster) sh('kind', ['delete', 'cluster', '--name', a.cluster], { allowFail: true, quiet: true });
    }
  }
  if (failed) process.exit(1);
  console.log('k8s:smoke PASSED');
}

main().catch((err) => { console.error(`k8s:smoke FAILED — ${err.message}`); process.exit(1); });
