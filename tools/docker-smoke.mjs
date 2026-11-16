#!/usr/bin/env node
// tools/docker-smoke.mjs
// Prove a built Worca image works end to end, offline, with $0 spend
// (plans/container-isolation-design.md §10.1). Runs on the HOST against docker:
//
//   npm run docker:smoke                          # ghcr.io/sinishadjukic/worca:dev
//   npm run docker:smoke -- --image worca:test
//   npm run docker:smoke -- --keep                # leave the volume/containers for inspection
//   npm run docker:smoke -- --user 1001:1001      # run the box as this uid:gid (default on Linux:
//                                                 # the host user, like compose's WORCA_UID/GID;
//                                                 # elsewhere the image's uid 1000)
//
// What it checks (each is a thing the container, not the engine, can break):
//   1. CLI in the box: `worca add` + a mock pipeline run to `done` against a
//      throwaway git repo bind-mounted under /projects, state in a named volume.
//   2. The UI server in the box: /api/health answers as @worca/app through a
//      loopback-published port; a foreign Host header is refused (403), so the
//      loopback guard survives port publishing; SIGTERM via `docker stop` exits
//      143 (the server's graceful path) — the tini/entrypoint signal chain works.
//   3. The volume holds the DB after both.
//   4. Single-volume mode (WORCA_DATA_DIR, the Railway layout): one root-owned
//      volume, container started as root; everything runs as worca, HOME is on
//      the volume, a later boot re-owns top-level dirs; non-root is refused (78).
//   5. Agent isolation there: a fake `claude` started through runClaude runs as
//      worca-agent, without a GitHub token, cannot read the server's environment,
//      database or HOME, and commits in a project worca owns.
//
//   npm run docker:smoke -- --worker-image ghcr.io/sinishadjukic/worca-worker:dev-claude
//
// With --worker-image the WORKER image's contract (docs/workers.md) is checked instead (or as
// well, when --image is given too): uid 1000, no sudo, `worca worker` without an assignment
// exits 78 naming WORCA_CONTROLLER_URL, `--check` lists the engines with claude present,
// WORCA_NO_DB=1 in the environment, and a worker stuck on a controller that never answers
// leaves within 20 s of SIGTERM. Offline, no token.
//
// With BOTH --image and --worker-image, step 6 runs the two together: the controller under
// WORCA_EXECUTOR=docker (given the socket) runs a mock workflow whose shell script node executes
// on a worker container it starts from the worker image and removes when the run ends. The controller's
// own checks are not repeated then (CI runs them the step before, on the same image).
// ESM, no external dependencies.

import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { INSTANCE_LABEL } from '../src/core/executor/shared.mjs';

const DEFAULT_IMAGE = 'ghcr.io/sinishadjukic/worca:dev';

function parseArgs(argv) {
  const out = { image: null, workerImage: null, keep: false, user: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--image') out.image = argv[++i];
    else if (argv[i] === '--worker-image') out.workerImage = argv[++i];
    else if (argv[i] === '--keep') out.keep = true;
    else if (argv[i] === '--user') out.user = argv[++i];
    else { console.error(`docker:smoke: unknown argument ${argv[i]}`); process.exit(2); }
  }
  // The controller checks run by default; `--worker-image` alone runs the worker checks only.
  if (!out.image && !out.workerImage) out.image = DEFAULT_IMAGE;
  return out;
}

const a = parseArgs(process.argv.slice(2));
// A bind-mounted repo keeps the host owner on Linux Engine, so the box must run
// as that user to enter and write it (Docker Desktop translates ownership and
// needs nothing). This mirrors compose's `user: ${WORCA_UID}:${WORCA_GID}`.
if (a.user === null && process.platform === 'linux') a.user = `${userInfo().uid}:${userInfo().gid}`;
const stamp = `${Date.now().toString(36)}`;
const VOLUME = `worca-smoke-home-${stamp}`;
const CLAUDE_VOLUME = `worca-smoke-claude-${stamp}`;
const UI_NAME = `worca-smoke-ui-${stamp}`;
const DATA_VOLUME = `worca-smoke-data-${stamp}`;
const DATA_NAME = `worca-smoke-data-${stamp}`;
let failed = false;
const fail = (msg) => { failed = true; console.error(`docker:smoke FAILED — ${msg}`); };
const ok = (msg) => console.log(`docker:smoke ok — ${msg}`);

function sh(cmd, args, { allowFail = false, input } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input });
  if (r.status !== 0 && !allowFail) {
    console.error(r.stdout); console.error(r.stderr);
    throw new Error(`${cmd} ${args.join(' ')} exited ${r.status ?? r.signal}`);
  }
  return r;
}
const docker = (args, o) => sh('docker', args, o);

/** A throwaway git repo with one commit on `main`; the smoke's "project". */
function freshRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-docker-smoke-'));
  const git = (args) => sh('git', ['-C', dir, ...args]);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'smoke@example.com']);
  git(['config', 'user.name', 'smoke']);
  writeFileSync(join(dir, 'README.md'), '# smoke\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return dir;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET over node:http with an explicit Host header (fetch/undici silently drops a
 *  caller-set Host, which would make the foreign-Host probe test nothing). */
function get(port, path, host) {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host }, timeout: 3000 }, (r) => {
      let body = '';
      r.on('data', (d) => { body += d; });
      r.on('end', () => res({ status: r.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', rej);
    req.end();
  });
}

async function waitHealth(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await get(port, '/api/health', 'localhost');
      if (res.status === 200) return JSON.parse(res.body);
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return null;
}

/**
 * WORCA_DATA_DIR on a fresh named volume at /data (root-owned, as Railway mounts
 * it), container started as root: the entrypoint must own the volume, drop to
 * `worca` for everything it runs, keep HOME on the volume, re-own a top-level
 * dir a later boot finds root-owned, and refuse (78) when it starts non-root on
 * a volume it cannot write.
 */
async function singleVolume() {
  const env = ['-e', 'WORCA_MOCK=1', '-e', 'WORCA_DATA_DIR=/data', '-v', `${DATA_VOLUME}:/data`];
  const boot = () => {
    docker(['rm', '-f', DATA_NAME], { allowFail: true });
    docker(['run', '-d', '--name', DATA_NAME, '--user', '0:0', '-p', '127.0.0.1:0:4317', ...env, a.image]);
    return Number(docker(['port', DATA_NAME, '4317/tcp']).stdout.trim().split('\n')[0].split(':').pop());
  };
  const inBox = (cmd, user = 'root') => docker(['exec', '--user', user, DATA_NAME, 'sh', '-c', cmd], { allowFail: true }).stdout.trim();

  // Non-root on the root-owned volume: a clear refusal, not a half-working box.
  const nonRoot = docker(['run', '--rm', ...env, a.image, 'true'], { allowFail: true });
  if (nonRoot.status !== 78 || !/RAILWAY_RUN_UID=0/.test(nonRoot.stderr)) {
    fail(`single-volume as non-root: exit ${nonRoot.status}, expected 78 with a RAILWAY_RUN_UID hint`);
  } else ok('single-volume: non-root on a root-owned volume exits 78 with the fix');

  const port = boot();
  const health = await waitHealth(port);
  if (!health) {
    process.stderr.write(docker(['logs', DATA_NAME], { allowFail: true }).stderr);
    fail('single-volume: /api/health never answered');
    return;
  }
  ok(`single-volume: /api/health -> ${health.name} ${health.version}`);

  // PID 1 (tini) stays root by design; every node process (CLI + server) must not. Node 24+ names its
  // main thread MainThread (uv_thread_setname), which is the process name on Linux, so look for both.
  const users = inBox('ps -C node,MainThread -o user= | sort -u');
  if (users !== 'worca') fail(`single-volume: node processes run as [${users.replace(/\n/g, ', ')}], expected only worca`);
  else ok('single-volume: the CLI and server run as worca');

  const owner = inBox('stat -c %U /data /data/worca /data/projects /data/home | sort -u');
  if (owner !== 'worca') fail(`single-volume: /data owners = ${owner}`);
  else ok('single-volume: the volume is owned by worca');

  const homeEnv = inBox('tr "\\0" "\\n" < /proc/$(pgrep -u worca -o -x "node|MainThread")/environ | grep -E "^(HOME|WORCA_HOME|WORCA_PROJECTS_ROOT)=" | sort', 'worca');
  if (homeEnv !== 'HOME=/data/home\nWORCA_HOME=/data/worca\nWORCA_PROJECTS_ROOT=/data/projects') fail(`single-volume: server env\n${homeEnv}`);
  else ok('single-volume: HOME, WORCA_HOME and WORCA_PROJECTS_ROOT are on the volume');

  await agentIsolation(inBox);

  // Simulate a later image adding/leaving a root-owned top-level dir, then reboot.
  docker(['stop', '-t', '15', DATA_NAME]);
  docker(['run', '--rm', '--user', '0:0', '--entrypoint', 'chown', '-v', `${DATA_VOLUME}:/data`, a.image, 'root:root', '/data/projects']);
  boot();
  if (!(await waitHealth(Number(docker(['port', DATA_NAME, '4317/tcp']).stdout.trim().split('\n')[0].split(':').pop())))) {
    fail('single-volume: second boot never answered');
    return;
  }
  const again = inBox('stat -c %U /data/projects; test -s /data/worca/.worca-cc/worca-cc.db && echo db');
  if (again !== 'worca\ndb') fail(`single-volume second boot: ${again}`);
  else ok('single-volume: second boot re-owns a root-owned top-level dir and keeps the DB');
}

/**
 * Agents under their own uid (src/core/agent-user.mjs): the real runClaude, with asAgent, starts a
 * fake `claude` that reports who it is and what it can reach. It must run as worca-agent, get no
 * GitHub token, be unable to read the server's environment, database or HOME, and still commit in
 * a project worca owns; the server must then be able to remove what the agent wrote.
 */
async function agentIsolation(inBox) {
  const serverEnv = inBox('tr "\\0" "\\n" < /proc/$(pgrep -u worca -o -x "node|MainThread")/environ | grep -E "^WORCA_AGENT_(USER|HOME)=" | sort', 'worca');
  if (serverEnv !== 'WORCA_AGENT_HOME=/data/agent-home\nWORCA_AGENT_USER=worca-agent') { fail(`agent isolation: server env\n${serverEnv}`); return; }
  ok('agent isolation: the server knows its agent user');

  const perms = inBox('stat -c "%a %G %n" /data/projects /data/worca/.worca-cc/runs /data/worca/.worca-cc/store /data/agent-home /data/worca/.worca-cc');
  const want = ['2770 worca-share /data/projects', '3770 worca-share /data/worca/.worca-cc/runs', '3770 worca-share /data/worca/.worca-cc/store', '700 worca-share /data/agent-home', '711 worca /data/worca/.worca-cc'];
  if (perms !== want.join('\n')) fail(`agent isolation: permissions\n${perms}`);
  else ok('agent isolation: shared dirs are setgid worca-share, runs and store are sticky, the worca home is traverse-only');

  inBox('cd /data/projects && umask 0007 && git init -q -b main iso && cd iso && git -c user.name=s -c user.email=s@x commit -q --allow-empty -m init', 'worca');
  writeFileSync(join(tmpdir(), `fake-claude-${stamp}`), [
    '#!/bin/sh',
    'p=$(pgrep -u worca -o -x "node|MainThread")',
    'r() { if cat "$1" >/dev/null 2>&1; then echo read; else echo denied; fi; }',
    'cd /data/projects/iso && echo agent > by-agent.txt && git add by-agent.txt && git -c user.name=a -c user.email=a@x commit -qm agent && c=committed || c=nocommit',
    'printf \'{"type":"result","subtype":"success","is_error":false,"result":"user=%s environ=%s db=%s home=%s gh=%s commit=%s"}\\n\' "$(id -un)" "$(r /proc/$p/environ)" "$(r /data/worca/.worca-cc/worca-cc.db)" "$(ls /data/home >/dev/null 2>&1 && echo read || echo denied)" "${GH_TOKEN:-none}" "$c"',
    '',
  ].join('\n'));
  docker(['cp', join(tmpdir(), `fake-claude-${stamp}`), `${DATA_NAME}:/tmp/fake-claude`]);
  inBox('chmod 755 /tmp/fake-claude');
  const driver = "const { runClaude } = await import('/usr/local/lib/node_modules/@worca/app/src/core/claude-runner.mjs');"
    + "const r = await runClaude({ cwd: '/data/projects/iso', prompt: 'x', bin: '/tmp/fake-claude', asAgent: true }); console.log(r.text);";
  const run = docker(['exec', '--user', 'worca', '-e', 'WORCA_MOCK=0', '-e', 'GH_TOKEN=ghp_smoke', '-e', 'WORCA_GH_WRITE_TOKEN=ghp_smoke_w',
    '-e', 'WORCA_AGENT_USER=worca-agent', '-e', 'WORCA_AGENT_HOME=/data/agent-home', '-e', 'WORCA_AGENT_GID=1001',
    DATA_NAME, 'sh', '-c', `umask 0007 && cd /data/projects && node --input-type=module -e "${driver}"`], { allowFail: true });
  const got = run.stdout.trim().split('\n').pop();
  const expect = 'user=worca-agent environ=denied db=denied home=denied gh=none commit=committed';
  if (got !== expect) { fail(`agent isolation: agent saw "${got}", expected "${expect}"\n${run.stderr}`); return; }
  ok('agent isolation: the agent runs as worca-agent, has no GitHub token, cannot read the server env, DB or HOME, and commits');

  const cleanup = inBox('cd /data/projects/iso && git log --format=%s -1 && rm -f by-agent.txt && git status --short | head -1', 'worca');
  if (cleanup !== 'agent\nD  by-agent.txt' && cleanup !== 'agent\n D by-agent.txt') fail(`agent isolation: server after the agent\n${cleanup}`);
  else ok('agent isolation: the server can read and remove what the agent wrote');
}

/**
 * The worker image (docker/Dockerfile `worker` target, docker/entrypoint-worker.sh): runs as uid
 * 1000 with no sudo, refuses an incomplete assignment with 78 and the variable's name, lists its
 * engines offline, never opens the database, and leaves promptly on SIGTERM even while its
 * controller never answers (a TCP black hole stands in for one).
 */
async function workerImage(img) {
  console.log(`docker:smoke: worker image ${img}`);
  const net = `worca-smoke-net-${stamp}`;
  const hole = `worca-smoke-hole-${stamp}`;
  const worker = `worca-smoke-worker-${stamp}`;
  const assignment = ['-e', 'WORCA_WORKER_SCOPE=run:smoke', '-e', 'WORCA_WORKER_ID=w-smoke', '-e', 'WORCA_WORKER_TOKEN=smoke-token-never-valid'];
  try {
    const uid = docker(['run', '--rm', img, 'id', '-u'], { allowFail: true });
    if (uid.status !== 0 || uid.stdout.trim() !== '1000') fail(`worker: id -u -> ${uid.stdout.trim() || uid.stderr.trim()} (exit ${uid.status}), expected 1000`);
    else ok('worker: runs as uid 1000');

    const sudo = docker(['run', '--rm', img, 'sudo', 'true'], { allowFail: true });
    if (sudo.status !== 127) fail(`worker: sudo true exited ${sudo.status}, expected 127 (no sudo in the image)`);
    else ok('worker: sudo is absent (127)');

    const noEnv = docker(['run', '--rm', img, 'worca', 'worker'], { allowFail: true });
    if (noEnv.status !== 78 || !/WORCA_CONTROLLER_URL/.test(noEnv.stderr)) fail(`worker: no assignment -> exit ${noEnv.status}, expected 78 naming WORCA_CONTROLLER_URL\n${noEnv.stderr}`);
    else ok('worker: without an assignment exits 78 and names WORCA_CONTROLLER_URL');

    const check = docker(['run', '--rm', img, 'worca', 'worker', '--check'], { allowFail: true });
    let caps = null;
    try { caps = JSON.parse(check.stdout); } catch { /* not JSON */ }
    if (check.status !== 0 || !caps?.engines || !caps.engines.claude) fail(`worker: --check -> exit ${check.status}, engines.claude ${JSON.stringify(caps?.engines?.claude ?? null)}\n${check.stderr}`);
    else ok(`worker: --check lists claude ${caps.engines.claude.version || '(no version)'} at ${caps.engines.claude.bin}`);

    const noDb = docker(['run', '--rm', img, 'printenv', 'WORCA_NO_DB'], { allowFail: true });
    if (noDb.stdout.trim() !== '1') fail(`worker: WORCA_NO_DB=${noDb.stdout.trim() || '(unset)'}, expected 1`);
    else ok('worker: WORCA_NO_DB=1');

    // A controller that accepts the TCP connection and never completes the handshake: the worker
    // sits in its connect, and SIGTERM must still get it out within the stop timeout.
    docker(['network', 'create', net]);
    docker(['run', '-d', '--name', hole, '--network', net, img, 'node', '-e', 'require("node:net").createServer(() => {}).listen(4318, "0.0.0.0"); setInterval(() => {}, 1e6);']);
    docker(['run', '-d', '--name', worker, '--network', net, '-e', `WORCA_CONTROLLER_URL=ws://${hole}:4318`, ...assignment, img]);
    await sleep(2500);
    const running = docker(['inspect', '-f', '{{.State.Running}}', worker], { allowFail: true }).stdout.trim();
    if (running !== 'true') {
      const logs = docker(['logs', worker], { allowFail: true });
      fail(`worker: left before SIGTERM (exit ${docker(['inspect', '-f', '{{.State.ExitCode}}', worker], { allowFail: true }).stdout.trim()})\n${logs.stdout}${logs.stderr}`);
    } else {
      const t0 = Date.now();
      docker(['stop', '-t', '20', worker]);
      const code = Number(docker(['wait', worker]).stdout.trim());
      const took = Date.now() - t0;
      const logs = docker(['logs', worker], { allowFail: true });
      if (took >= 20_000 || code === 137) fail(`worker: SIGTERM -> exit ${code} after ${took} ms (137 = killed by the stop timeout)\n${logs.stderr}`);
      else if (!/worca-worker-entrypoint: engine \S+; scope run:smoke/.test(logs.stderr)) fail(`worker: the entrypoint did not log its engine and scope\n${logs.stderr}`);
      else ok(`worker: SIGTERM -> exit ${code} in ${took} ms; the entrypoint logged engine, scope and HOME`);
      if (/smoke-token-never-valid/.test(`${logs.stdout}${logs.stderr}`)) fail('worker: the token appeared in the log');
    }
  } finally {
    if (!a.keep) {
      docker(['rm', '-f', hole, worker], { allowFail: true });
      docker(['network', 'rm', net], { allowFail: true });
    } else console.log(`docker:smoke: kept containers ${hole}, ${worker} and network ${net}`);
  }
}

/**
 * 6. Workers end to end (docs/workers.md): the controller image under WORCA_EXECUTOR=docker, given the
 * socket and a worker image, runs a mock workflow whose shell script node executes on a worker
 * container it starts itself — and removes when the run ends. The API calls go through the
 * controller's own loopback (its write routes admit loopback callers only).
 */
async function workersEndToEnd(ctrlImage, workerImg) {
  const net = `worca-smoke-workers-${stamp}`;
  const vol = `worca-smoke-workers-home-${stamp}`;
  const ui = `worca-smoke-controller-${stamp}`;
  const sockGid = sh('stat', ['-c', '%g', '/var/run/docker.sock'], { allowFail: true }).stdout.trim();
  docker(['network', 'create', net]);
  docker(['volume', 'create', vol]);
  const api = (args) => docker(['exec', ui, 'curl', '-s', '-H', 'Host: localhost', '-H', 'content-type: application/json', ...args], { allowFail: true }).stdout;
  try {
    docker(['run', '-d', '--name', ui, '--network', net, ...(sockGid ? ['--group-add', sockGid] : []),
      '-e', 'WORCA_MOCK=1', '-e', 'WORCA_EXECUTOR=docker', '-e', `WORCA_WORKER_IMAGE=${workerImg}`,
      '-e', `WORCA_CONTROLLER_URL=ws://${ui}:4319`,   // no WORCA_CONTROLLER_CONTAINER: the controller finds its own container, as under Compose
      '-e', 'GIT_AUTHOR_NAME=smoke', '-e', 'GIT_AUTHOR_EMAIL=smoke@example.com',
      '-v', `${vol}:/worca`, '-v', '/var/run/docker.sock:/var/run/docker.sock', ctrlImage]);
    let health = null;
    for (let i = 0; i < 60 && !health; i++) {
      try { const h = JSON.parse(api(['http://127.0.0.1:4317/api/health']) || 'null'); if (h?.executor) health = h; } catch { /* not up */ }
      if (!health) await sleep(1000);
    }
    if (!health) {
      process.stderr.write(docker(['logs', ui], { allowFail: true }).stderr);
      return fail('workers: the controller never reported an executor on /api/health (did it reach the docker socket?)');
    }
    if (health.executor.kind !== 'docker' || health.executor.backend !== 'docker') return fail(`workers: /api/health executor = ${JSON.stringify(health.executor)}`);
    ok(`workers: controller up with executor ${health.executor.kind} (${health.executor.backend})`);

    const script = api(['-X', 'POST', 'http://127.0.0.1:4317/api/scripts', '-d', JSON.stringify({
      meta: { key: 'smokeHello', metaVersion: 2, runtime: 'shell', displayName: 'Smoke hello', command: 'echo hello-from-$(hostname); echo HOME=$HOME',
        inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'pass', type: 'void' }] },
      source: '',
    })]);
    if (!/"key":"smokeHello"/.test(script)) return fail(`workers: cannot create the script: ${script.slice(0, 200)}`);
    const wf = api(['-X', 'POST', 'http://127.0.0.1:4317/api/workflows', '-d', JSON.stringify({
      name: 'Smoke worker script', version: 2, domain: 'coding',
      nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 198, config: {} }, { id: 'n_sh', kind: 'script', key: 'smokeHello', x: 360, y: 198, config: {} }, { id: 'n_end', kind: 'end', x: 660, y: 198, config: {} }],
      wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_sh', port: 'task' } }, { id: 'w2', from: { node: 'n_sh', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
    })]);
    let wfId = null;
    try { wfId = JSON.parse(wf).workflow.id; } catch { /* below */ }
    if (!wfId) return fail(`workers: cannot save the workflow: ${wf.slice(0, 300)}`);
    const run = api(['-X', 'POST', 'http://127.0.0.1:4317/api/run', '-d', JSON.stringify({ noProject: true, prompt: 'say hello', workflowId: wfId, mock: true, humanInLoop: false })]);
    let pipelineId = null;
    try { pipelineId = JSON.parse(run).pipelineId; } catch { /* below */ }
    if (!pipelineId) return fail(`workers: cannot start the run: ${run.slice(0, 300)}`);
    let status = null;
    for (let i = 0; i < 120 && !['done', 'error', 'paused', 'stopped'].includes(status); i++) {
      await sleep(1000);
      try { status = JSON.parse(api(['http://127.0.0.1:4317/api/history'])).pipelines.find((p) => p.id === pipelineId)?.status ?? null; } catch { status = null; }
    }
    // The worker's release and removal follow the run's end asynchronously: give them a moment, as the k8s smoke does.
    let log = '';
    for (let i = 0; i < 60; i++) {
      const logs = docker(['logs', ui], { allowFail: true });
      log = `${logs.stdout}${logs.stderr}`;
      if (/executor: removed worca-worker-run-/.test(log) && !docker(['ps', '-aq', '--filter', `label=${INSTANCE_LABEL}=${ui}`], { allowFail: true }).stdout.trim()) break;
      await sleep(1000);
    }
    const started = new RegExp(`executor: started (worca-worker-run-${pipelineId}-\\S+) \\(${workerImg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) for run:${pipelineId}`).exec(log);
    const removed = started && new RegExp(`executor: removed ${started[1]} \\(done\\)`).test(log);
    const left = docker(['ps', '-aq', '--filter', `label=${INSTANCE_LABEL}=${ui}`], { allowFail: true }).stdout.trim();   // this smoke's own (the instance is the controller's name)
    const output = docker(['exec', ui, 'sh', '-c', `grep -rh "hello-from-" /worca/.worca-cc/store/*/pipelines/*${pipelineId}*/ 2>/dev/null | head -1`], { allowFail: true }).stdout;
    if (status !== 'done') fail(`workers: the run ended ${status}\n${log.split('\n').filter((l) => /executor|worker|error/i.test(l)).join('\n')}`);
    else if (!started) fail(`workers: the controller log shows no worker started for run:${pipelineId}\n${log.split('\n').filter((l) => /executor|workers/.test(l)).join('\n')}`);
    else if (!removed) fail(`workers: ${started[1]} was not removed when the run finished`);
    else if (left) fail(`workers: worker container(s) still around after the run: ${left}`);
    else if (!/hello-from-worca-worker-run-/.test(output)) fail(`workers: the script's output does not come from the worker container: ${output.slice(0, 200)}`);
    else ok(`workers: run ${pipelineId} done; its script ran on ${started[1]} (${workerImg}), which was removed afterwards`);
  } finally {
    if (!a.keep) {
      const leftovers = docker(['ps', '-aq', '--filter', `label=${INSTANCE_LABEL}=${ui}`], { allowFail: true }).stdout.trim().split(/\s+/).filter(Boolean);   // never another worca's workers on this host
      if (leftovers.length) docker(['rm', '-f', ...leftovers], { allowFail: true });
      docker(['rm', '-f', ui], { allowFail: true });
      docker(['volume', 'rm', '-f', vol], { allowFail: true });
      docker(['network', 'rm', net], { allowFail: true });
    } else console.log(`docker:smoke: kept controller ${ui}, volume ${vol}, network ${net}`);
  }
}

async function main() {
  if (a.workerImage) await workerImage(a.workerImage);
  if (a.workerImage && a.image) await workersEndToEnd(a.image, a.workerImage);
  // With a worker image named, the controller's own suite is not run again: CI ran it the step before, on the same image.
  if (!a.image || a.workerImage) {
    if (failed) process.exit(1);
    console.log('docker:smoke PASSED');
    return;
  }
  const repo = freshRepo();
  const common = [
    '-e', 'WORCA_MOCK=1',
    '-e', 'GIT_AUTHOR_NAME=smoke', '-e', 'GIT_AUTHOR_EMAIL=smoke@example.com',
    '-e', 'GIT_COMMITTER_NAME=smoke', '-e', 'GIT_COMMITTER_EMAIL=smoke@example.com',
    '-v', `${VOLUME}:/worca`,
    '-v', `${CLAUDE_VOLUME}:/home/worca/.claude`,
    '-v', `${repo}:/projects/sandbox`,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    ...(a.user ? ['--user', a.user] : []),
  ];
  try {
    // 1. CLI: register + mock run.
    console.log(`docker:smoke: image ${a.image}${a.user ? ` as user ${a.user}` : ''}`);
    const cli = docker(['run', '--rm', ...common, a.image,
      'bash', '-c',
      'worca add --path /projects/sandbox && worca --project /projects/sandbox --prompt "demo task" --mock --yes && worca list'],
    { allowFail: true });
    process.stdout.write(cli.stdout);
    if (cli.status !== 0) { process.stderr.write(cli.stderr); fail(`CLI mock run exited ${cli.status}`); }
    else if (!/sandbox\t\/projects\/sandbox/.test(cli.stdout)) fail('`worca list` does not show the registered project');
    else ok('CLI: worca add + mock pipeline run + worca list');

    // 2. UI server through a loopback-published ephemeral port.
    docker(['run', '-d', '--name', UI_NAME, '-p', '127.0.0.1:0:4317', ...common, a.image]);
    const portOut = docker(['port', UI_NAME, '4317/tcp']).stdout.trim();   // "127.0.0.1:55123"
    const port = Number(portOut.split('\n')[0].split(':').pop());
    if (!port) throw new Error(`cannot read published port from: ${portOut}`);

    let health = null;
    for (let i = 0; i < 60 && !health; i++) {
      try {
        const res = await get(port, '/api/health', 'localhost');
        if (res.status === 200) health = JSON.parse(res.body);
      } catch { /* not up yet */ }
      if (!health) await sleep(500);
    }
    if (!health) {
      process.stderr.write(docker(['logs', UI_NAME], { allowFail: true }).stderr);
      fail('/api/health never answered');
    } else if (health.name !== '@worca/app') fail(`/api/health name = ${health.name}`);
    else ok(`UI: /api/health -> ${health.name} ${health.version} on published port ${port}`);

    if (health) {
      const foreign = await get(port, '/api/health', '10.0.0.7:4317');
      if (foreign.status !== 403) fail(`foreign Host header answered ${foreign.status}, expected 403`);
      else ok('UI: foreign Host header refused (403) — loopback guard intact behind port publishing');

      const stop = docker(['stop', '-t', '15', UI_NAME]);
      void stop;
      const code = Number(docker(['wait', UI_NAME]).stdout.trim());
      // The server exits 143 after SIGTERM; tini (-e 143) reports that as 0, so platforms that
      // treat a non-zero exit as a crash (Railway) see a clean stop. 137 would be a kill.
      const logs = docker(['logs', UI_NAME], { allowFail: true });
      const graceful = /stopping \(SIGTERM\)/.test(`${logs.stdout}${logs.stderr}`);
      if (code !== 0 || !graceful) {
        process.stderr.write(logs.stderr);
        fail(`docker stop -> exit ${code}${graceful ? '' : ', no "stopping (SIGTERM)" in the log'}; expected a graceful stop and exit 0`);
      } else ok('UI: docker stop -> graceful SIGTERM, exit 0 (tini maps the server\'s 143)');
    }

    // 3. The volume holds the database.
    const db = docker(['run', '--rm', '-v', `${VOLUME}:/worca`, a.image, 'test', '-s', '/worca/.worca-cc/worca-cc.db'], { allowFail: true });
    if (db.status !== 0) fail('worca-cc.db missing or empty in the home volume');
    else ok('volume: /worca/.worca-cc/worca-cc.db persisted');

    // 4. Single-volume mode (WORCA_DATA_DIR): one root-owned volume, like Railway.
    await singleVolume();
  } finally {
    if (!a.keep) {
      docker(['rm', '-f', UI_NAME, DATA_NAME], { allowFail: true });
      docker(['volume', 'rm', '-f', VOLUME, CLAUDE_VOLUME, DATA_VOLUME], { allowFail: true });
      rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    } else {
      console.log(`docker:smoke: kept volume ${VOLUME}, container ${UI_NAME}, repo ${repo}`);
    }
  }
  if (failed) process.exit(1);
  console.log('docker:smoke PASSED');
}

main().catch((err) => { console.error(`docker:smoke FAILED — ${err.message}`); process.exit(1); });
