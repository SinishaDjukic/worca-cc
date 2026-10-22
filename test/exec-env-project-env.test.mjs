// test/exec-env-project-env.test.mjs — per-project environments (plans/e2b-execution-design.md §18): the spec schema and
// hash, the record in worca's DB, the e2b fallback order, staleness, and builds that run only in the server process.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { normalizeEnvSpec, envSpecHash, EnvSpecError } from '../src/core/exec-env/env-spec.mjs';
import { readProjectExecEnv } from '../src/core/config.mjs';
import { setProjectEnvSpec, setProjectBackendConfig, recordProjectBuild, buildStaleness, resolveRunEnvironment, projectExecEnvView } from '../src/core/exec-env/project-env.mjs';
import { startEnvironmentBuild, markServerProcess, buildJobLog, ExecEnvBuildError } from '../src/core/exec-env/build.mjs';
import { getExecBackend } from '../src/core/exec-env/index.mjs';
import { e2bServerIdentity } from '../src/core/exec-env/backends/e2b.mjs';
import { _registerExecBackendForTests } from '../src/core/exec-env/registry.mjs';
import { createLoopbackBackend } from './helpers/loopback-backend.mjs';

useTempHome(after, 'worca-envspec-home-');
const root = mkdtempSync(join(tmpdir(), 'worca-envspec-lb-')); after(() => rmSync(root, { recursive: true, force: true }));
const lb = createLoopbackBackend({ root }); after(_registerExecBackendForTests(lb.backend));
const failing = createLoopbackBackend({ root, name: 'loopfail', failBuild: true }); after(_registerExecBackendForTests(failing.backend));
const e2b = getExecBackend('e2b');
let n = 0; const key = () => `proj-${(0x10000000 + ++n).toString(16)}`;

test('spec: canonical order and hash; the same tools hash the same', () => {
  const a = normalizeEnvSpec({ tools: [{ name: 'pipx:black', version: '26.10.1' }, { name: 'node', version: '24.21.0' }], apt: ['zlib1g-dev', 'libpq-dev', 'libpq-dev'] });
  assert.deepEqual(a.tools.map((t) => t.name), ['node', 'pipx:black']);
  assert.deepEqual(a.apt, ['libpq-dev', 'zlib1g-dev']);
  assert.match(a.hash, /^sha256:[0-9a-f]{64}$/);
  const b = normalizeEnvSpec({ apt: ['zlib1g-dev', 'libpq-dev'], tools: [{ version: '24.21.0', name: 'node' }, { name: 'pipx:black', version: '26.10.1' }], hash: 'stale', updatedAt: 'x' });
  assert.equal(b.hash, a.hash);
  assert.notEqual(normalizeEnvSpec({ tools: [{ name: 'node', version: '24.22.0' }] }).hash, normalizeEnvSpec({ tools: [{ name: 'node', version: '24.21.0' }] }).hash);
  assert.equal(envSpecHash({}), normalizeEnvSpec({}).hash);
});

test('spec: tools only — no secrets, files, env, unpinned or shell-unsafe values', () => {
  for (const [input, re] of [
    [{ env: { TOKEN: 'x' } }, /unknown key "env"/],
    [{ tools: [{ name: 'node', version: 'latest' }] }, /must be pinned/],
    [{ tools: [{ name: 'node; rm -rf /', version: '1' }] }, /not a mise tool name/],
    [{ tools: [{ name: 'node', version: '1', url: 'x' }] }, /unknown key "url"/],
    [{ tools: [{ name: 'node', version: '1' }, { name: 'node', version: '2' }] }, /listed twice/],
    [{ apt: ['libpq-dev && curl x'] }, /not a Debian package name/],
    [[], /JSON object/],
  ]) assert.throws(() => normalizeEnvSpec(input), (e) => e instanceof EnvSpecError && re.test(e.message), JSON.stringify(input));
});

test('record: spec, backend field and build live in worca DB under the project; a bad field is refused', () => {
  const k = key();
  const spec = setProjectEnvSpec(k, { tools: [{ name: 'node', version: '24.21.0' }] });
  assert.equal(readProjectExecEnv(k).spec.hash, spec.hash);
  assert.deepEqual(setProjectBackendConfig(k, 'e2b', { template: 'my-tpl' }), { template: 'my-tpl' });
  assert.throws(() => setProjectBackendConfig(k, 'e2b', { template: 'Bad Name' }), /E2B template: must be/);
  assert.throws(() => setProjectBackendConfig(k, 'e2b', { image: 'x' }), /no project setting "image"/);
  assert.deepEqual(setProjectBackendConfig(k, 'e2b', { template: null }), {});
  const rec = recordProjectBuild(k, 'e2b', { name: `worca-agent-${k}`, id: 't', buildId: 'b', specHash: spec.hash, baseVersion: 'v1' });
  assert.deepEqual(readProjectExecEnv(k).builds.e2b, rec);
});

test('e2b fallback order: project setting → build record → WORCA_E2B_TEMPLATE → worca-agent', () => {
  const build = { name: 'worca-agent-proj-1' };
  assert.deepEqual(e2b.resolveEnvironment({ config: { template: 'mine' }, build, env: { WORCA_E2B_TEMPLATE: 'envt' } }), { name: 'mine', source: 'project', from: 'the project setting' });
  assert.equal(e2b.resolveEnvironment({ config: {}, build, env: { WORCA_E2B_TEMPLATE: 'envt' } }).name, 'worca-agent-proj-1');
  assert.equal(e2b.resolveEnvironment({ config: {}, build: null, env: { WORCA_E2B_TEMPLATE: 'envt' } }).name, 'envt');
  assert.deepEqual(e2b.resolveEnvironment({ config: {}, build: null, env: {} }), { name: 'worca-agent', source: 'default', from: 'the default' });
});

test('e2b server identity: the normalised E2B_API_URL (E2B Cloud when unset) plus the API key, which never shows', () => {
  const cloud = e2bServerIdentity({ E2B_API_KEY: 'e2b_cloudkey1234' });
  assert.equal(cloud.label, 'E2B Cloud (key e2b_…1234)');
  assert.equal(e2bServerIdentity({ E2B_API_KEY: 'e2b_cloudkey1234', E2B_API_URL: 'https://api.e2b.app/' }).id, cloud.id);
  const local = e2bServerIdentity({ E2B_API_KEY: 'e2b_localkey99', E2B_API_URL: 'http://LOCALHOST:3000/' });
  assert.equal(local.id, e2bServerIdentity({ E2B_API_KEY: 'e2b_localkey99', E2B_API_URL: 'http://localhost:3000' }).id);
  assert.equal(local.label, 'http://localhost:3000 (key e2b_…ey99)');
  // An SSH tunnel to a remote server and a local one can share the URL: the key (its team) tells them apart.
  assert.notEqual(e2bServerIdentity({ E2B_API_KEY: 'e2b_remotekey1', E2B_API_URL: 'http://localhost:3000' }).id, local.id);
  assert.doesNotMatch(JSON.stringify(local), /localkey/);
});

test('a build made on another server is skipped: project setting → build for THIS server → WORCA_E2B_TEMPLATE → worca-agent', () => {
  const k = key();
  const spec = setProjectEnvSpec(k, { tools: [{ name: 'node', version: '24.21.0' }] });
  const remote = { E2B_API_KEY: 'e2b_remotekey1', E2B_API_URL: 'http://localhost:3000' };
  const local = { E2B_API_KEY: 'e2b_localkey99', E2B_API_URL: 'http://localhost:3000' };
  recordProjectBuild(k, 'e2b', { name: `worca-agent-${k}`, specHash: spec.hash, baseVersion: e2b.baseVersion(), server: e2bServerIdentity(remote) });
  assert.equal(resolveRunEnvironment(e2b, k, { env: remote }).name, `worca-agent-${k}`);
  let t = resolveRunEnvironment(e2b, k, { env: local });
  assert.equal(t.name, 'worca-agent'); assert.equal(t.source, 'default');
  assert.equal(t.rebuild, 'npm run e2b:build', 'the default template is rebuilt the backend`s way');
  assert.equal(t.notes[0].level, 'warn');
  assert.match(t.notes[0].text, new RegExp(`template worca-agent-${k} was built on another E2B server \\(http://localhost:3000 \\(key e2b_…key1\\)\\); this server is http://localhost:3000 \\(key e2b_…ey99\\)\\. This run uses worca-agent \\(the default\\)\\. Rebuild it`));
  assert.equal(resolveRunEnvironment(e2b, k, { env: { ...local, WORCA_E2B_TEMPLATE: 'envt' } }).name, 'envt');
  setProjectBackendConfig(k, 'e2b', { template: 'mine' });
  t = resolveRunEnvironment(e2b, k, { env: local });
  assert.equal(t.name, 'mine'); assert.deepEqual(t.notes, [], 'a project setting wins; the foreign build does not matter');
  setProjectBackendConfig(k, 'e2b', { template: null });
  const v = projectExecEnvView(k, { env: local }).backends.find((b) => b.name === 'e2b');
  assert.equal(v.effective.name, 'worca-agent'); assert.equal(v.title, 'E2B');
  assert.deepEqual(v.elsewhere, { builtOn: 'http://localhost:3000 (key e2b_…key1)', here: 'http://localhost:3000 (key e2b_…ey99)' });
  assert.equal(projectExecEnvView(k, { env: remote }).backends.find((b) => b.name === 'e2b').elsewhere, null);
});

test('a build recorded before servers were recorded (no server) is still used', () => {
  const k = key();
  const spec = setProjectEnvSpec(k, {});
  recordProjectBuild(k, 'e2b', { name: `worca-agent-${k}`, specHash: spec.hash, baseVersion: e2b.baseVersion() });
  assert.equal(readProjectExecEnv(k).builds.e2b.server, null);
  const t = resolveRunEnvironment(e2b, k, { env: { E2B_API_KEY: 'e2b_anykey123' } });
  assert.equal(t.name, `worca-agent-${k}`);
  assert.equal(t.rebuild, `Rebuild environment on the project page, or run: worca exec-env build --project ${k}`, 'a project template is rebuilt from its page');
});

test('staleness: spec hash or base version moved; a matching build is fresh', () => {
  const spec = normalizeEnvSpec({ tools: [{ name: 'node', version: '24.21.0' }] });
  const build = { specHash: spec.hash, baseVersion: 'v1' };
  assert.deepEqual(buildStaleness({ spec, build, baseVersion: 'v1' }), { stale: false, reasons: [] });
  assert.deepEqual(buildStaleness({ spec: { ...spec, hash: 'sha256:x' }, build, baseVersion: 'v2' }).reasons,
    ['the environment spec changed since the build', 'the base changed (v1 → v2)']);
  assert.equal(buildStaleness({ spec, build, baseVersion: null }).stale, false, 'an unreadable base is not a reason');
});

test('resolveRunEnvironment: a stale build warns and is still used; a spec without a build only informs', () => {
  const k = key();
  const spec = setProjectEnvSpec(k, { tools: [{ name: 'node', version: '24.21.0' }] });
  let t = resolveRunEnvironment(lb.backend, k);
  assert.equal(t.name, 'loopback-base'); assert.equal(t.notes[0].level, 'info');
  assert.equal(t.rebuild, null, 'a backend that names no way to rebuild its default');
  recordProjectBuild(k, 'loopback', { name: `loopback-${k}`, specHash: spec.hash, baseVersion: 'loopback-base@1' });
  t = resolveRunEnvironment(lb.backend, k);
  assert.equal(t.name, `loopback-${k}`); assert.deepEqual(t.notes, []);
  assert.match(t.rebuild, /^Rebuild environment on the project page/);
  setProjectEnvSpec(k, { tools: [{ name: 'node', version: '24.22.0' }] });
  t = resolveRunEnvironment(lb.backend, k);
  assert.equal(t.name, `loopback-${k}`); assert.equal(t.notes[0].level, 'warn'); assert.match(t.notes[0].text, /is stale \(the environment spec changed/);
});

test('a backend that is not configured refuses to build (409), unless mock', () => {
  markServerProcess(true);
  try {
    const k = key(); setProjectEnvSpec(k, {});
    const off = createLoopbackBackend({ root, name: 'loopoff' });
    const unregister = _registerExecBackendForTests({ ...off.backend, configured: () => false });
    try {
      assert.throws(() => startEnvironmentBuild({ projectKey: k, backend: 'loopoff' }), (e) => e.code === 'EXEC_ENV_NOT_CONFIGURED' && e.status === 409);
    } finally { unregister(); }
  } finally { markServerProcess(false); }
});

test('builds are refused outside the server process', () => {
  const k = key(); setProjectEnvSpec(k, {});
  markServerProcess(false);
  assert.throws(() => startEnvironmentBuild({ projectKey: k, backend: 'loopback' }),
    (e) => e instanceof ExecEnvBuildError && e.code === 'EXEC_ENV_BUILD_REFUSED' && e.status === 403);
});

test('in the server process: a build records name/specHash/baseVersion/builtAt/buildId; a second concurrent build is refused', async () => {
  markServerProcess(true);
  try {
    const k = key(); const spec = setProjectEnvSpec(k, { tools: [{ name: 'node', version: '24.21.0' }] });
    const states = [];
    const job = startEnvironmentBuild({ projectKey: k, backend: 'loopback', onState: (j) => states.push(j.state) });
    assert.throws(() => startEnvironmentBuild({ projectKey: k, backend: 'loopback' }), /already running/);
    await job.done;
    assert.equal(job.state, 'done'); assert.deepEqual(states, ['running', 'done']);
    const rec = readProjectExecEnv(k).builds.loopback;
    assert.equal(rec.name, `loopback-${k}`); assert.equal(rec.specHash, spec.hash); assert.equal(rec.baseVersion, 'loopback-base@1');
    assert.match(rec.builtAt, /^\d{4}-\d\d-\d\dT/); assert.match(rec.buildId, /^b\d+$/);
    assert.deepEqual(rec.server, { id: 'here', label: 'loopback here' }, 'the build records the server it landed on');
    assert.ok(buildJobLog(job.id, 0).lines.some((l) => /loopback: building/.test(l)));
    assert.throws(() => startEnvironmentBuild({ projectKey: key(), backend: 'loopback' }), (e) => e.code === 'EXEC_ENV_NO_SPEC');
    assert.equal(projectExecEnvView(k).backends.find((b) => b.name === 'loopback').stale.stale, false);
  } finally { markServerProcess(false); }
});

test('a failed build keeps the previous record', async () => {
  markServerProcess(true);
  try {
    const k = key(); const spec = setProjectEnvSpec(k, {});
    const prev = recordProjectBuild(k, 'loopfail', { name: 'old', specHash: spec.hash, baseVersion: 'loopback-base@1' });
    const job = startEnvironmentBuild({ projectKey: k, backend: 'loopfail' });
    await job.done;
    assert.equal(job.state, 'error'); assert.match(job.error, /loopback build failed/);
    assert.deepEqual(readProjectExecEnv(k).builds.loopfail, prev);
  } finally { markServerProcess(false); }
});

test('a build records the server from the env it was built with; another server falls back and says why', async () => {
  markServerProcess(true);
  try {
    const k = key(); const spec = setProjectEnvSpec(k, {});
    const job = startEnvironmentBuild({ projectKey: k, backend: 'loopback', env: { LOOPBACK_SERVER: 'a' } });
    await job.done;
    assert.equal(job.state, 'done');
    assert.deepEqual(readProjectExecEnv(k).builds.loopback.server, { id: 'a', label: 'loopback a' });
    assert.equal(resolveRunEnvironment(lb.backend, k, { env: { LOOPBACK_SERVER: 'a' } }).name, `loopback-${k}`);
    const t = resolveRunEnvironment(lb.backend, k, { env: { LOOPBACK_SERVER: 'b' } });
    assert.equal(t.name, 'loopback-base');
    assert.match(t.notes[0].text, /image loopback-proj-[0-9a-f]+ was built on another Loopback server \(loopback a\); this server is loopback b/);
    assert.equal(spec.hash, readProjectExecEnv(k).builds.loopback.specHash);
  } finally { markServerProcess(false); }
});
