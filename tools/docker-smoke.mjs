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
  } finally {
    if (!a.keep) {
      docker(['rm', '-f', UI_NAME], { allowFail: true });
      docker(['volume', 'rm', '-f', VOLUME, CLAUDE_VOLUME], { allowFail: true });
      rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    } else {
      console.log(`docker:smoke: kept volume ${VOLUME}, container ${UI_NAME}, repo ${repo}`);
    }
  }
  if (failed) process.exit(1);
  console.log('docker:smoke PASSED');
}

main().catch((err) => { console.error(`docker:smoke FAILED — ${err.message}`); process.exit(1); });
