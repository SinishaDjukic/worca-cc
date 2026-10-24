// test/api-exec-env-project.test.mjs — the per-project sandbox environment routes (plans/e2b-execution-design.md §18):
// GET /api/exec-envs lists the registry; the spec PUT/DELETE, the backend-field PATCH and the build POST (202 + a
// pollable job) — refused to agent callers and to pages on another origin; reading stays open.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createLoopbackBackend } from './helpers/loopback-backend.mjs';
import { _registerExecBackendForTests } from '../src/core/exec-env/registry.mjs';
import { projectKey } from '../src/core/store.mjs';

useTempHome(after);
const lbRoot = mkdtempSync(join(tmpdir(), 'worca-api-envspec-lb-')); after(() => rmSync(lbRoot, { recursive: true, force: true }));
const lb = createLoopbackBackend({ root: lbRoot });
let homeDir, srv, base, port, key;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, p, b) => {
  const r = await fetch(`${base}${p}`, { method, headers: JSONH, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  return { status: r.status, body: await r.json() };
};
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b ?? {});
const put = (p, b) => call('PUT', p, b ?? {});
const patch = (p, b) => call('PATCH', p, b ?? {});
const del = (p) => call('DELETE', p);
/** http.request, not fetch: fetch drops a caller-set Host (host-guard-ignores-port rule). */
function rawRequest(method, path, body, headers) {
  const text = JSON.stringify(body);
  return new Promise((resolveP, rejectP) => {
    const req = http.request({ host: '127.0.0.1', port, path, method,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...headers } }, (res) => {
      let data = ''; res.setEncoding('utf8'); res.on('data', (d) => { data += d; });
      res.on('end', () => { let parsed = null; try { parsed = JSON.parse(data); } catch { /* not JSON */ } resolveP({ status: res.statusCode, body: parsed }); });
    });
    req.on('error', rejectP); req.end(text);
  });
}
async function waitFor(fn, ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('condition never held');
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-envspec-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  const repo = gitDir('envspec');
  await addProject({ name: 'envspec', path: repo });
  key = projectKey(repo);
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(homeDir, { recursive: true, force: true });
});

test('GET /api/exec-envs lists local, e2b and a registered backend', async () => {
  const unregister = _registerExecBackendForTests(lb.backend);
  try { assert.deepEqual((await get('/api/exec-envs')).body.execEnvs.map((e) => e.name), ['local', 'e2b', 'loopback']); }
  finally { unregister(); }
});
test('GET /api/exec-envs/status: every backend with a status, one server each; mock mode reads the e2b fake', async () => {
  const unregister = _registerExecBackendForTests(lb.backend);
  try {
    const { status, body } = await get('/api/exec-envs/status');
    assert.equal(status, 200);
    assert.deepEqual(body.execEnvs.map((e) => e.name), ['e2b', 'loopback'], 'Local has no status');
    const [e2b, loop] = body.execEnvs;
    assert.equal(e2b.state, 'connected');
    assert.equal(e2b.servers.length, 1);
    assert.match(e2b.servers[0].label, /mock/);
    assert.deepEqual({ ...e2b.servers[0], label: null }, { label: null, state: 'connected', running: 0, cap: 4, waiting: 0 });
    assert.deepEqual(loop.servers, [{ label: 'loopback here', state: 'connected', running: 0, cap: 2, waiting: 0 }]);
  } finally { unregister(); }
});
test('spec PUT normalizes, a bad spec is 400, the view shows it read back', async () => {
  const bad = await put(`/api/projects/${key}/exec-env/spec`, { tools: [{ name: 'node', version: 'latest' }] });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'EXEC_ENV_SPEC_INVALID');
  const ok = await put(`/api/projects/${key}/exec-env/spec`, { tools: [{ name: 'node', version: '24.21.0' }] });
  assert.equal(ok.status, 200); assert.match(ok.body.spec.hash, /^sha256:/);
  assert.equal((await get(`/api/projects/${key}/exec-env`)).body.spec.hash, ok.body.spec.hash);
});
test('the e2b template field: PATCH saves it, the view says it is the effective template', async () => {
  const r = await patch(`/api/projects/${key}/exec-env/config`, { backend: 'e2b', values: { template: 'proj-tpl' } });
  assert.equal(r.status, 200);
  const e = r.body.backends.find((b) => b.name === 'e2b');
  assert.equal(e.fields[0].value, 'proj-tpl'); assert.deepEqual(e.effective, { name: 'proj-tpl', source: 'project', from: 'the project setting' });
  assert.equal((await patch(`/api/projects/${key}/exec-env/config`, { backend: 'e2b', values: { template: 'NO NO' } })).status, 400);
  assert.equal((await patch(`/api/projects/${key}/exec-env/config`, {})).status, 400, 'a body without backend never reaches the DB');
});

test('the e2b sandbox network field: PATCH takes open or allow and shows the choice; anything else is a 400', async () => {
  const r = await patch(`/api/projects/${key}/exec-env/config`, { backend: 'e2b', values: { egress: 'allow' } });
  assert.equal(r.status, 200);
  const f = r.body.backends.find((b) => b.name === 'e2b').fields.find((x) => x.key === 'egress');
  assert.equal(f.value, 'allow');
  assert.deepEqual(f.options.map((o) => o.value), ['open', 'allow']);
  assert.match(f.help, /^Stops casual network access from the sandbox/);
  const bad = await patch(`/api/projects/${key}/exec-env/config`, { backend: 'e2b', values: { egress: 'closed' } });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'EXEC_ENV_CONFIG_INVALID');
  assert.equal((await patch(`/api/projects/${key}/exec-env/config`, { backend: 'e2b', values: { egress: null } })).status, 200);
});
// (The "already running" 409 is pinned deterministically in exec-env-project-env; over HTTP it would depend on timing.)
test('POST build answers 202 and the job ends done; the log is pollable', async () => {
  const unregister = _registerExecBackendForTests(lb.backend);
  try {
    const r = await post(`/api/projects/${key}/exec-env/build`, { backend: 'loopback' });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const job = await waitFor(async () => { const s = await get(`/api/exec-env/builds/${r.body.job.id}?since=0`); return s.body.job.state !== 'running' && s.body; });
    assert.equal(job.job.state, 'done'); assert.ok(job.lines.length >= 2);
    assert.equal((await get(`/api/projects/${key}/exec-env`)).body.backends.find((b) => b.name === 'loopback').build.name, `loopback-${key}`);
  } finally { unregister(); }
});
test('POST build without a spec is 409 EXEC_ENV_NO_SPEC; an unknown backend is 400', async () => {
  await del(`/api/projects/${key}/exec-env/spec`);
  const r = await post(`/api/projects/${key}/exec-env/build`, { backend: 'e2b' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'EXEC_ENV_NO_SPEC');
  assert.equal((await post(`/api/projects/${key}/exec-env/build`, { backend: 'docker' })).status, 400);
  assert.equal((await get('/api/projects/nope-00000000/exec-env')).status, 404);
  assert.equal((await get('/api/exec-env/builds/envb_nope')).status, 404);
});
test('POST build without a backend picks the first that can build (e2b); a failed e2b build keeps no record', async () => {
  await put(`/api/projects/${key}/exec-env/spec`, { tools: [{ name: 'node', version: '24.21.0' }] });
  const r = await post(`/api/projects/${key}/exec-env/build`, {});   // no backend: must not throw
  assert.equal(r.status, 202, JSON.stringify(r.body)); assert.equal(r.body.job.backend, 'e2b');
  // the file runs with WORCA_MOCK=1 (as test/api-run-exec-env.test.mjs): the e2b fake cannot build
  const s = await waitFor(async () => { const g = await get(`/api/exec-env/builds/${r.body.job.id}`); return g.body.job.state !== 'running' && g.body; });
  assert.equal(s.job.state, 'error'); assert.match(s.job.error, /cannot be built in mock mode/);
  assert.equal((await get(`/api/projects/${key}/exec-env`)).body.backends.find((b) => b.name === 'e2b').build, null);
});
test('agent isolation: an agent caller cannot set the spec, a backend field or start a build (403)', async () => {
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(homeDir, 'agent');      // the test/api-actions.test.mjs pattern
  try {
    for (const r of [await put(`/api/projects/${key}/exec-env/spec`, {}), await del(`/api/projects/${key}/exec-env/spec`),
      await patch(`/api/projects/${key}/exec-env/config`, { backend: 'e2b', values: { template: 'x' } }),
      await post(`/api/projects/${key}/exec-env/build`, {})]) {
      assert.equal(r.status, 403); assert.equal(r.body.code, 'AGENT_CALLER_BLOCKED');   // G1: the global gate refuses it before the route's own check
    }
    assert.equal((await get(`/api/projects/${key}/exec-env`)).status, 403, 'G1: an agent caller reads nothing either');
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
});
test('a page on another localhost port cannot set the spec (403)', async () => {
  const r = await rawRequest('PUT', `/api/projects/${key}/exec-env/spec`, { tools: [] },
    { host: `127.0.0.1:${port}`, origin: 'http://127.0.0.1:4401' });
  assert.equal(r.status, 403);   // G10: the global Origin check refuses it before the route's own check
  const same = await rawRequest('PUT', `/api/projects/${key}/exec-env/spec`, { tools: [] },
    { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` });
  assert.equal(same.status, 200, 'the same origin is accepted');
});
