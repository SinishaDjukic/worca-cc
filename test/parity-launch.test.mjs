// test/parity-launch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, chmodSync, symlinkSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEnv, parseTarget, dockerArgs, startTarget, fixedRoot, prepareRoot, DEAD_PROXY } from '../tools/parity/launch.mjs';

test('buildEnv keeps only allowlisted keys, isolates HOME/WORCA_HOME and pins the port', () => {
  const base = { PATH: '/bin', LANG: 'C', LC_ALL: 'C', PORT: '4317', FORCE_COLOR: '1', WORCA_FLAGS: 'x',
    CLAUDE_CONFIG_DIR: '/c', GH_TOKEN: 'g', ANTHROPIC_API_KEY: 'a', SSH_AUTH_SOCK: '/s', WORCA_HOST: '0.0.0.0',
    WORCA_HEARTBEAT_URL: 'http://x', NODE_TEST_CONTEXT: 'child' };
  const env = buildEnv(base, { home: '/tmp/h', port: 4999 });
  assert.equal(env.PORT, '4999');
  assert.equal(env.HOME, '/tmp/h');
  assert.equal(env.WORCA_HOME, '/tmp/h');
  assert.equal(env.WORCA_MOCK, '1');
  assert.equal(env.WORCA_NO_NATIVE_DIALOG, '1');
  assert.equal(env.PATH, '/tmp/h/.parity-canary-bin:/bin');   // the app stub's canary dir first (stub on by default)
  assert.equal(env.LC_ALL, 'C');
  for (const k of ['FORCE_COLOR', 'WORCA_FLAGS', 'CLAUDE_CONFIG_DIR', 'GH_TOKEN', 'ANTHROPIC_API_KEY', 'SSH_AUTH_SOCK',
    'WORCA_HOST', 'WORCA_HEARTBEAT_URL', 'NODE_TEST_CONTEXT']) assert.equal(k in env, false, k);
});

test('signed-out env turns on remote mode with an http localhost issuer', () => {
  const env = buildEnv({}, { home: '/tmp/h', port: 1, signedOut: true });
  assert.equal(env.WORCA_ALLOWED_HOSTS, 'parity.invalid');
  assert.equal(env.WORCA_IDENTITY_ISSUER, 'http://localhost:9');
});

test('parseTarget reads tree:, package: and docker:', () => {
  assert.deepEqual(parseTarget('tree:.'), { kind: 'tree', ref: '.' });
  assert.deepEqual(parseTarget('docker:ghcr.io/x/worca:ci'), { kind: 'docker', ref: 'ghcr.io/x/worca:ci' });
  assert.throws(() => parseTarget('zip:a'), /tree:, package: or docker:/);
  for (const bad of ['docker:--privileged', 'docker:-v=/:/host', 'docker:img --privileged']) assert.throws(() => parseTarget(bad), /docker image reference/, bad);
});

test('dockerArgs mirror tools/docker-smoke.mjs: no new privileges, all caps dropped, loopback-only port', () => {
  const a = dockerArgs({ image: 'img', projectPath: '/p', vol: 'v1', claudeVol: 'v2', env: { WORCA_MOCK: '1' }, user: '501:20' });
  const s = a.join(' ');
  assert.match(s, /--cap-drop ALL/);
  assert.match(s, /--security-opt no-new-privileges:true/);
  assert.match(s, /-p 127\.0\.0\.1:0:4317/);
  assert.match(s, /--user 501:20/);
  assert.equal(s.includes('--privileged'), false);
  assert.equal(a.includes('--rm'), false, 'an exited container stays inspectable; stop() removes it');
  assert.equal(a.at(-1), 'img');
  const smoke = readFileSync(new URL('../tools/docker-smoke.mjs', import.meta.url), 'utf8');
  for (const flag of ["'--cap-drop', 'ALL'", "'--security-opt', 'no-new-privileges:true'", ':/worca`', ':/home/worca/.claude`', ':/projects/sandbox`']) {
    assert.ok(smoke.includes(flag), `tools/docker-smoke.mjs still has ${flag}`);
  }
});

/** A fake `docker` on PATH that records its argv; FAKE_DOCKER_PORT unset makes `docker port` fail, inspect always fails. */
async function withFakeDocker(env, fn) {
  const bin = mkdtempSync(join(tmpdir(), 'parity-fakedocker-'));
  const log = join(bin, 'calls.log');
  writeFileSync(join(bin, 'docker'), ['#!/bin/sh', `echo "$*" >> '${log}'`, 'case "$1" in',
    '  volume) [ "$2" = create ] && echo "vol$$" ;;', '  run) echo cid1 ;;',
    '  port) [ -n "$FAKE_DOCKER_PORT" ] || exit 1; echo "127.0.0.1:$FAKE_DOCKER_PORT" ;;',
    '  inspect) exit 1 ;;', '  logs) echo "container log line" ;;', 'esac', ''].join('\n'), { mode: 0o755 });
  const saved = { ...process.env };
  Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}` }, env);
  try { await fn(() => readFileSync(log, 'utf8')); } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
}

test('docker: a failed boot removes the container and both volumes', { skip: process.platform === 'win32' }, async () => {
  await withFakeDocker({}, async (calls) => {
    await assert.rejects(startTarget({ kind: 'docker', ref: 'img' }));
    assert.match(calls(), /^rm -f cid1$/m);
    assert.match(calls(), /^volume rm -f vol\d+ vol\d+$/m);
  });
});

test('docker: a container gone before /api/health is "server exited", with its log kept', { skip: process.platform === 'win32' }, async () => {
  await withFakeDocker({ FAKE_DOCKER_PORT: '9' }, async (calls) => {
    const err = await startTarget({ kind: 'docker', ref: 'img' }).then(() => null, (e) => e);
    assert.match(err.message, /server exited \(container stopped\)/);
    assert.equal(readFileSync(/server log: (.+)\)$/.exec(err.message)[1], 'utf8'), 'container log line\n');
    assert.match(calls(), /^rm -f cid1$/m);
  });
});

test('fixedRoot: a lock dir without a pid file is a dead owner; a loose or symlinked root is refused', () => {
  const base = mkdtempSync(join(tmpdir(), 'parity-fr-'));
  mkdirSync(join(base, 'worca-parity', 'lock'), { recursive: true, mode: 0o700 });
  chmodSync(join(base, 'worca-parity'), 0o700);
  const r = fixedRoot(base); r.release();
  if (process.platform !== 'win32') {
    chmodSync(join(base, 'worca-parity'), 0o755);
    assert.throws(() => fixedRoot(base), /group\/other/);
    const b2 = mkdtempSync(join(tmpdir(), 'parity-fr-'));
    symlinkSync(base, join(b2, 'worca-parity'));
    assert.throws(() => fixedRoot(b2), /not a plain directory/);
  }
});

test('startTarget refuses the host app port', async () => {
  await assert.rejects(startTarget({ kind: 'tree', ref: '.' }, { port: 4317 }), /4317/);
});

test('startTarget boots this tree and answers /api/health', async () => {
  const t = await startTarget({ kind: 'tree', ref: '.' });
  try {
    const r = await fetch(`${t.base}/api/health`);
    assert.equal(r.status, 200);
    assert.ok(t.bootMs > 0);
    assert.notEqual(t.port, 4317);
  } finally { await t.stop(); }
});

test('startTarget boots a tree reached through a symlink (macOS /tmp → /private/tmp)', async () => {
  const link = join(mkdtempSync(join(tmpdir(), 'parity-ln-')), 'tree');
  symlinkSync(new URL('..', import.meta.url).pathname, link, 'dir');
  const t = await startTarget({ kind: 'tree', ref: link });
  try { assert.equal((await fetch(`${t.base}/api/health`)).status, 200); } finally { await t.stop(); }
});

test('fixedRoot(base, name): its own dir and lock; two names never share a lock', () => {
  const base = mkdtempSync(join(tmpdir(), 'parity-fixed-name-'));
  const a = fixedRoot(base, 'worca-parity-crawl-2'); const b = fixedRoot(base, 'worca-parity-crawl-3');
  assert.equal(a.root, join(base, 'worca-parity-crawl-2'));
  assert.ok(existsSync(join(a.root, 'lock', 'pid')) && existsSync(join(b.root, 'lock', 'pid')));
  a.release(); b.release();
});

test('buildEnv: the app stub is on by default (log, canary, canary dir first on PATH, no clock); stub:false leaves them out', () => {
  const env = buildEnv({ PATH: '/usr/bin' }, { home: '/h', port: 5000 });
  assert.equal(env.WORCA_STUB_APPS_LOG, '/h/.parity-stubbed-apps.ndjson'); assert.equal(env.WORCA_APP_CANARY, '/h/.parity-canary.log');
  assert.equal(env.PATH, '/h/.parity-canary-bin:/usr/bin'); assert.equal(env.WORCA_PARITY_CLOCK_MS, undefined);
  assert.equal(buildEnv({ PATH: '/usr/bin' }, { home: '/h', port: 5000, clockMs: 123 }).WORCA_PARITY_CLOCK_MS, '123');
  const off = buildEnv({ PATH: '/usr/bin' }, { home: '/h', port: 5000, stub: false });
  assert.equal(off.PATH, '/usr/bin'); assert.equal(off.WORCA_STUB_APPS_LOG, undefined);
});

test('buildEnv offline: a dead proxy for every external call, localhost exempt, allowlist kept, base proxies overridden', () => {
  const env = buildEnv({ HTTPS_PROXY: 'http://corp:8080', SECRET: 'x', PATH: '/bin' }, { home: '/tmp/h', port: 1, offline: true });
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) assert.equal(env[k], DEAD_PROXY, k);
  assert.equal(DEAD_PROXY, 'http://127.0.0.1:9');
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1,::1');
  assert.equal(env.NODE_USE_ENV_PROXY, '1');
  assert.equal(env.SECRET, undefined); assert.equal(env.PATH, '/tmp/h/.parity-canary-bin:/bin');
  assert.equal(buildEnv({}, { home: '/tmp/h', port: 1 }).HTTPS_PROXY, undefined, 'online by default');
});

test('prepareRoot: a template copy of home and sandbox, else a fresh empty repo; the old contents are wiped', () => {
  const fixed = mkdtempSync(join(tmpdir(), 'parity-prep-'));
  const tpl = mkdtempSync(join(tmpdir(), 'parity-tpl-'));
  mkdirSync(join(tpl, 'home'), { recursive: true }); writeFileSync(join(tpl, 'home', 'worca-cc.db'), 'db');
  mkdirSync(join(tpl, 'sandbox', '.git'), { recursive: true }); writeFileSync(join(tpl, 'sandbox', 'a.txt'), 'a');
  mkdirSync(join(fixed, 'home'), { recursive: true }); writeFileSync(join(fixed, 'home', 'stale'), 'x');
  const r = prepareRoot({ fixed, template: tpl });
  assert.deepEqual([r.home, r.projectPath], [join(fixed, 'home'), join(fixed, 'sandbox')]);
  assert.equal(readFileSync(join(fixed, 'home', 'worca-cc.db'), 'utf8'), 'db');
  assert.ok(!existsSync(join(fixed, 'home', 'stale')));
  assert.equal(readFileSync(join(fixed, 'sandbox', 'a.txt'), 'utf8'), 'a');
  prepareRoot({ fixed });
  assert.ok(!existsSync(join(fixed, 'home', 'worca-cc.db')));
  assert.ok(existsSync(join(fixed, 'sandbox', '.git')) && !existsSync(join(fixed, 'sandbox', 'a.txt')));
});
