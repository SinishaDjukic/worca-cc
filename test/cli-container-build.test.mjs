// test/cli-container-build.test.mjs — `worca container build` (src/cli/container-build.mjs) with the runtime stubbed:
// the projects it builds for, the refusal of two pins, the build and check calls, the .env line and the record,
// --status, --reset, and `worca container up` on the built image. No Docker daemon.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { setProjectEnvSpec, clearProjectEnvSpec } from '../src/core/exec-env/project-env.mjs';
import { cmdContainer, initDir } from '../src/cli/container.mjs';
import { cmdContainerBuild } from '../src/cli/container-build.mjs';
import { RECORD_FILE } from '../src/core/exec-env/box-image.mjs';

useTempHome(after);
// Nothing here may reach the real settings.json or ~/.docker: HOME is a temp dir too.
const realHome = process.env.HOME;
const fakeHome = mkdtempSync(join(tmpdir(), 'worca-build-home-'));
process.env.HOME = fakeHome;
after(() => { process.env.HOME = realHome; rmSync(fakeHome, { recursive: true, force: true }); });

const api = gitDir('acme-api'); const web = gitDir('acme-web'); const ops = gitDir('acme-ops');
const KEY = { api: projectKey(api), web: projectKey(web), ops: projectKey(ops) };
before(async () => {
  await addProject({ name: 'acme-api', path: api });
  await addProject({ name: 'acme-web', path: web });
  await addProject({ name: 'acme-ops', path: ops });
});
const NODE = { name: 'node', version: '24.21.0' };
const resetSpecs = () => {
  setProjectEnvSpec(KEY.api, { tools: [NODE, { name: 'python', version: '3.13.1' }], apt: ['libpq-dev'] });
  setProjectEnvSpec(KEY.web, { tools: [NODE], apt: ['curl'] });
  clearProjectEnvSpec(KEY.ops);
};

const GOOD_PROBE = 'node=v24.21.0\ngit=git version 2.39.5\nclaude=2.1.278 (Claude Code)\nworca=worca 1.21.0\n';
const LABELS = JSON.stringify({ 'dev.worca.claude-code.version': '2.1.278', 'dev.worca.box-image.spec': 'x' });

/** A fake runtime. `opts` sets each answer; every call is recorded. */
function fakeRuntime({ baseId = 'sha256:base1', pullGives = null, build = 0, labels = LABELS, probe = GOOD_PROBE } = {}) {
  const calls = [];
  let id = baseId;
  const exec = (cmd, args, o = {}) => {
    calls.push({ cmd, args, capture: !!o.capture });
    const r = (status, stdout = '') => ({ status, stdout, stderr: '' });
    if (args[0] === 'compose' && args[1] === 'version') return r(0);
    if (args[0] === 'image' && args[1] === 'inspect' && args[3] === '{{.Id}}') return id ? r(0, `${id}\n`) : r(1);
    if (args[0] === 'image' && args[1] === 'inspect') return r(0, labels);
    if (args[0] === 'pull') { id = pullGives; return r(pullGives ? 0 : 1); }
    if (args[0] === 'build') return r(build);
    if (args[0] === 'run') return r(0, probe);
    if (args[0] === 'compose') return r(0);
    if (cmd === 'git') return r(1);
    return r(0);
  };
  return { exec, calls };
}
const io = () => {
  const lines = []; const fails = [];
  return { out: (s) => lines.push(s), c: (_n, s) => s, fail: (m) => fails.push(m), lines, fails };
};
async function containerDir(extraEnv = '') {
  const dir = mkdtempSync(join(tmpdir(), 'worca-build-'));
  await initDir(dir, { projects: '/Users/me/dev', exec: fakeRuntime().exec });
  if (extraEnv) writeFileSync(join(dir, '.env'), readFileSync(join(dir, '.env'), 'utf8') + extraEnv);
  return dir;
}
const envOf = (dir) => readFileSync(join(dir, '.env'), 'utf8');
const run = async (argv, { dir, rt = fakeRuntime() } = {}) => {
  const o = io();
  const code = await cmdContainerBuild(argv, { ...o, exec: rt.exec, dir, now: () => new Date('2026-11-26T10:00:00Z') });
  return { code, ...o, calls: rt.calls };
};

test('help, unknown options and flags that exclude each other', async () => {
  const dir = await containerDir();
  try {
    let r = await run(['--help'], { dir });
    assert.equal(r.code, 0); assert.match(r.lines[0], /worca container build \[--project <key\|dir>\]\.\.\./);
    for (const [argv, re] of [[['--bogus'], /unknown option --bogus/], [['--status', '--reset'], /exclude each other/],
      [['--json'], /--json goes with --status/], [['--status', '--project', 'x'], /--project goes with a build/], [['--project'], /--project needs a value/]]) {
      r = await run(argv, { dir });
      assert.equal(r.code, 2, argv.join(' ')); assert.match(r.fails[0], re);
    }
    r = await run(['--dry-run'], { dir: join(dir, 'missing') });
    assert.equal(r.code, 1); assert.match(r.fails[0], /no compose files in .*run: worca container init/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the dispatch: `worca container build` reaches the build command', async () => {
  resetSpecs();
  const dir = await containerDir();
  try {
    const o = io();
    const code = await cmdContainer(['build', '--dry-run'], { ...o, exec: fakeRuntime().exec, dir });
    assert.equal(code, 0); assert.match(o.lines.at(-1), /^FROM ghcr\.io\/worca-org\/worca:latest$/m);
    const h = io();
    await cmdContainer(['help'], { ...h, exec: fakeRuntime().exec, dir });
    assert.match(h.lines[0], /worca container build \[--project <key\|dir>\] \[--status\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--dry-run: the union of every project with a spec, FROM the base in .env; nothing runs', async () => {
  resetSpecs();
  const dir = await containerDir('WORCA_BASE_IMAGE=registry.acme.example/platform/worca:1.21.0\n');
  try {
    const r = await run(['--dry-run'], { dir });
    assert.equal(r.code, 0);
    const d = r.lines.at(-1);
    assert.match(d, /^FROM registry\.acme\.example\/platform\/worca:1\.21\.0$/m);
    assert.match(d, /'node@24\.21\.0' 'python@3\.13\.1'/);
    assert.match(d, /'curl' 'libpq-dev'/);
    assert.equal(r.calls.length, 0, 'no runtime call');
    const one = await run(['--dry-run', '--project', web], { dir });
    assert.doesNotMatch(one.lines.at(-1), /python|libpq/, '--project builds for the named projects only');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two projects that pin different versions of one tool are refused, naming both and the tool', async () => {
  resetSpecs();
  setProjectEnvSpec(KEY.web, { tools: [{ name: 'node', version: '22.19.0' }] });
  const dir = await containerDir();
  try {
    const r = await run([], { dir });
    assert.equal(r.code, 1);
    assert.match(r.fails[0], /tool node: project acme-api \(.+\) pins 24\.21\.0, project acme-web \(.+\) pins 22\.19\.0/);
    assert.equal(r.calls.length, 0, 'refused before any runtime call');
    assert.equal((await run(['--dry-run', '--project', KEY.api], { dir })).code, 0, 'one of them builds alone');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a named project without a spec, an unknown one, and no spec anywhere are refused', async () => {
  resetSpecs();
  const dir = await containerDir();
  try {
    let r = await run(['--dry-run', '--project', ops], { dir });
    assert.equal(r.code, 1); assert.match(r.fails[0], /project acme-ops has no environment spec/);
    r = await run(['--dry-run', '--project', '/nowhere/acme'], { dir });
    assert.equal(r.code, 1); assert.match(r.fails[0], /is not a registered project/);
    clearProjectEnvSpec(KEY.api); clearProjectEnvSpec(KEY.web);
    r = await run(['--dry-run'], { dir });
    assert.equal(r.code, 1); assert.match(r.fails[0], /no project has an environment spec/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a proxy URL with a login never reaches the build', async () => {
  resetSpecs();
  const dir = await containerDir('HTTPS_PROXY=http://jdoe:s3cret@proxy.acme.example:3128\nHTTP_PROXY=jdoe:s3cret@proxy.acme.example:3128\nNO_PROXY=.acme.example\n');
  try {
    const rt = fakeRuntime();
    const r = await run([], { dir, rt });
    assert.equal(r.code, 0, r.fails.join('\n'));
    const build = rt.calls.find((k) => k.args[0] === 'build');
    assert.ok(!build.args.some((a) => a.includes('s3cret') || a.includes('jdoe')), 'the login is in no build argument');
    assert.ok(build.args.includes('NO_PROXY=.acme.example'), 'NO_PROXY still reaches the build');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a build: base id, build, labels, offline probe; then the record and WORCA_IMAGE; --status says current', async () => {
  resetSpecs();
  const dir = await containerDir('HTTPS_PROXY=http://proxy.acme.example:3128\nHTTP_PROXY=http://127.0.0.1:9999\n');
  try {
    const rt = fakeRuntime();
    const r = await run([], { dir, rt });
    assert.equal(r.code, 0, r.fails.join('\n'));
    const tag = /^WORCA_IMAGE=(worca-box:[0-9a-f]{12})$/m.exec(envOf(dir))[1];
    const build = rt.calls.find((k) => k.args[0] === 'build');
    assert.deepEqual(build.args.slice(0, 5), ['build', '-t', tag, '-f', join(dir, 'box-image', 'Dockerfile')]);
    assert.ok(build.args.includes('HTTPS_PROXY=http://proxy.acme.example:3128'), 'the .env proxy reaches the build');
    assert.ok(!build.args.some((a) => a.includes('127.0.0.1')), 'a loopback proxy never does');
    assert.equal(build.args.at(-1), join(dir, 'box-image'), 'the context is the build dir, never a project');
    assert.ok(existsSync(join(dir, 'box-image', 'Dockerfile')));
    const probe = rt.calls.find((k) => k.args[0] === 'run');
    assert.deepEqual(probe.args.slice(0, 7), ['run', '--rm', '--network', 'none', '--entrypoint', '/bin/sh', tag]);
    const rec = JSON.parse(readFileSync(join(dir, RECORD_FILE), 'utf8'));
    assert.equal(rec.image, tag); assert.equal(rec.base, 'ghcr.io/worca-org/worca:latest'); assert.equal(rec.baseId, 'sha256:base1');
    assert.equal(rec.builtAt, '2026-11-26T10:00:00.000Z');
    assert.deepEqual(rec.projects.map((p) => p.name).sort(), ['acme-api', 'acme-web']);
    assert.equal(rec.claudeCode, '2.1.278'); assert.equal(rec.node, '24.21.0');
    assert.ok(r.lines.some((l) => /built {2}worca-box:/.test(l)));
    assert.ok(r.lines.some((l) => /loopback/.test(l)));

    let s = await run(['--status'], { dir });
    assert.equal(s.code, 0); assert.match(s.lines[0], new RegExp(`^current: ${tag}, built 2026-11-26T10:00:00.000Z`));
    s = await run(['--status', '--json'], { dir });
    assert.equal(JSON.parse(s.lines[0]).state, 'current');
    s = await run(['--status'], { dir, rt: fakeRuntime({ baseId: 'sha256:base2' }) });
    assert.match(s.lines[0], /^stale/); assert.match(s.lines.join('\n'), /a newer ghcr\.io\/worca-org\/worca:latest is here/);

    // A changed spec makes it stale: --status says so, `up` warns and still uses it.
    setProjectEnvSpec(KEY.web, { tools: [NODE], apt: ['curl', 'jq'] });
    s = await run(['--status'], { dir });
    assert.match(s.lines[0], /^stale/); assert.match(s.lines.join('\n'), /project acme-web \(.+\) changed its environment spec/);
    const up = fakeRuntime(); const o = io();
    assert.equal(await cmdContainer(['up'], { ...o, exec: up.exec, dir, env: { PATH: '/usr/bin' }, settings: () => ({}), login: () => null }), 0);
    assert.deepEqual(up.calls.find((k) => k.args.includes('up')).args, ['compose', '-f', 'compose.yml', '-f', 'compose.image.yml', 'up', '-d']);
    assert.ok(o.lines.some((l) => new RegExp(`image {2}the box image ${tag} is stale: .*It is still used\\. Rebuild: worca container build`).test(l)));
    assert.ok(!up.calls.some((k) => k.args[0] === 'build'), 'nothing rebuilds by itself');
    assert.ok(existsSync(join(dir, 'compose.image.yml')), 'init copies the overlay');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed build changes nothing: the box keeps its image', async () => {
  resetSpecs();
  const dir = await containerDir();
  try {
    assert.equal((await run([], { dir })).code, 0);
    const env = envOf(dir); const rec = readFileSync(join(dir, RECORD_FILE), 'utf8');
    setProjectEnvSpec(KEY.web, { tools: [NODE], apt: ['curl', 'jq'] });
    const r = await run([], { dir, rt: fakeRuntime({ build: 1 }) });
    assert.equal(r.code, 1);
    assert.match(r.fails[0], /the build failed \(exit 1\); the box keeps running worca-box:/);
    assert.equal(envOf(dir), env); assert.equal(readFileSync(join(dir, RECORD_FILE), 'utf8'), rec);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a built image that cannot run Worca is refused and removed; .env and the record stay', async () => {
  resetSpecs();
  const dir = await containerDir();
  try {
    const env = envOf(dir);
    for (const [over, re] of [
      [{ labels: '{}' }, /is not a Worca image or one built FROM it/],
      [{ probe: GOOD_PROBE.replace('v24.21.0', 'v20.18.0') }, /node 20\.18\.0 runs in the image, but Worca needs/],
      [{ probe: GOOD_PROBE.replace('2.1.278 (Claude Code)', '') }, /Claude Code \(claude\) is missing/],
    ]) {
      const rt = fakeRuntime(over);
      const r = await run([], { dir, rt });
      assert.equal(r.code, 1);
      assert.match(r.fails[0], re);
      assert.match(r.fails.at(-1), /the box keeps running ghcr\.io\/worca-org\/worca:latest/);
      assert.ok(rt.calls.some((k) => k.args[0] === 'image' && k.args[1] === 'rm'), 'the refused image is removed');
      assert.equal(envOf(dir), env); assert.ok(!existsSync(join(dir, RECORD_FILE)));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a base that is not here is pulled; one that cannot be pulled fails clearly', async () => {
  resetSpecs();
  const dir = await containerDir();
  try {
    let rt = fakeRuntime({ baseId: null, pullGives: 'sha256:pulled' });
    let r = await run([], { dir, rt });
    assert.equal(r.code, 0, r.fails.join('\n'));
    assert.deepEqual(rt.calls.find((k) => k.args[0] === 'pull').args, ['pull', 'ghcr.io/worca-org/worca:latest']);
    rt = fakeRuntime({ baseId: null, pullGives: null });
    r = await run([], { dir, rt });
    assert.equal(r.code, 1); assert.match(r.fails[0], /the base image ghcr\.io\/worca-org\/worca:latest is not available \(set WORCA_BASE_IMAGE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--reset goes back to the plain image; --status then says so', async () => {
  resetSpecs();
  const dir = await containerDir();
  try {
    assert.equal((await run([], { dir })).code, 0);
    let r = await run(['--reset'], { dir });
    assert.equal(r.code, 0); assert.match(r.lines[0], /goes back to ghcr\.io\/worca-org\/worca:latest/);
    assert.doesNotMatch(envOf(dir), /^WORCA_IMAGE=/m);
    r = await run(['--status'], { dir });
    assert.match(r.lines[0], /no built image in use: the box runs ghcr\.io\/worca-org\/worca:latest/);
    const up = fakeRuntime();
    await cmdContainer(['up'], { ...io(), exec: up.exec, dir, env: { PATH: '/usr/bin' }, settings: () => ({}), login: () => null });
    assert.ok(!up.calls.find((k) => k.args.includes('up')).args.includes('compose.image.yml'));
    r = await run(['--reset'], { dir });
    assert.equal(r.code, 0); assert.match(r.lines[0], /no built image in use/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
