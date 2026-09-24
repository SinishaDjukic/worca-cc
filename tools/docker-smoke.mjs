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
// ESM, no external dependencies.

import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const DEFAULT_IMAGE = 'ghcr.io/sinishadjukic/worca:dev';

function parseArgs(argv) {
  const out = { image: DEFAULT_IMAGE, keep: false, user: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--image') out.image = argv[++i];
    else if (argv[i] === '--keep') out.keep = true;
    else if (argv[i] === '--user') out.user = argv[++i];
    else { console.error(`docker:smoke: unknown argument ${argv[i]}`); process.exit(2); }
  }
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

  // PID 1 (tini) stays root by design; every node process (CLI + server) must not.
  const users = inBox('ps -C node -o user= | sort -u');
  if (users !== 'worca') fail(`single-volume: node processes run as [${users.replace(/\n/g, ', ')}], expected only worca`);
  else ok('single-volume: the CLI and server run as worca');

  const owner = inBox('stat -c %U /data /data/worca /data/projects /data/home | sort -u');
  if (owner !== 'worca') fail(`single-volume: /data owners = ${owner}`);
  else ok('single-volume: the volume is owned by worca');

  const homeEnv = inBox('tr "\\0" "\\n" < /proc/$(pgrep -u worca -o node)/environ | grep -E "^(HOME|WORCA_HOME|WORCA_PROJECTS_ROOT)=" | sort', 'worca');
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
  const serverEnv = inBox('tr "\\0" "\\n" < /proc/$(pgrep -u worca -o node)/environ | grep -E "^WORCA_AGENT_(USER|HOME)=" | sort', 'worca');
  if (serverEnv !== 'WORCA_AGENT_HOME=/data/agent-home\nWORCA_AGENT_USER=worca-agent') { fail(`agent isolation: server env\n${serverEnv}`); return; }
  ok('agent isolation: the server knows its agent user');

  const perms = inBox('stat -c "%a %G %n" /data/projects /data/worca/.worca-cc/runs /data/worca/.worca-cc/store /data/agent-home /data/worca/.worca-cc');
  const want = ['2770 worca-share /data/projects', '2770 worca-share /data/worca/.worca-cc/runs', '2770 worca-share /data/worca/.worca-cc/store', '700 worca-share /data/agent-home', '711 worca /data/worca/.worca-cc'];
  if (perms !== want.join('\n')) fail(`agent isolation: permissions\n${perms}`);
  else ok('agent isolation: shared dirs are setgid worca-share, the worca home is traverse-only');

  inBox('cd /data/projects && umask 0007 && git init -q -b main iso && cd iso && git -c user.name=s -c user.email=s@x commit -q --allow-empty -m init', 'worca');
  writeFileSync(join(tmpdir(), `fake-claude-${stamp}`), [
    '#!/bin/sh',
    'p=$(pgrep -u worca -o node)',
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

async function main() {
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
      if (code !== 143) {
        process.stderr.write(docker(['logs', UI_NAME], { allowFail: true }).stderr);
        fail(`docker stop -> exit ${code}, expected 143 (graceful SIGTERM)`);
      } else ok('UI: docker stop -> exit 143 (SIGTERM reached the server through tini)');
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
