// test/api-scripts.test.mjs — GET /api/scripts + /api/scripts/:key (spec §8.4).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let homeDir, srv, base, prevHome;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-scriptsapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  // A user-layer script beside the built-ins.
  const user = join(homeDir, '.worca-cc', 'scripts');
  await mkdir(user, { recursive: true });
  await writeFile(join(user, 'lint.mjs'), 'export default async () => ({ summary: "lint" });\n');
  await writeFile(join(user, 'lint.meta.json'), JSON.stringify({ key: 'lint', metaVersion: 2, displayName: 'Lint', runtime: 'node', file: 'lint.mjs',
    inputs: [{ id: 'done', type: 'void', required: false }], outputs: [{ id: 'log', type: 'md', filename: 'lint-cycle{cycle}.md' }] }));
  // A user-layer script that collides with an agent key is dropped (D16).
  await writeFile(join(user, 'reviewer.meta.json'), JSON.stringify({ key: 'reviewer', metaVersion: 2, runtime: 'shell', command: 'true', inputs: [], outputs: [] }));
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

test('GET /api/scripts lists built-ins + the user layer in order, D16-filtered, with paths stamped', async () => {
  const r = await fetch(`${base}/api/scripts`);
  assert.equal(r.status, 200);
  const { scripts } = await r.json();
  assert.deepEqual(scripts.map((s) => s.key), ['shell', 'js', 'gitDiff', 'lint']);
  assert.equal(scripts.find((s) => s.key === 'reviewer'), undefined, 'an agent key wins');
  const shell = scripts[0];
  assert.equal(shell.origin, 'builtin');
  assert.equal(shell.ports, 'config');
  assert.ok(Array.isArray(shell.defaultPorts.outputs));
  assert.deepEqual(shell.params.map((p) => p.type), ['command']);
  const lint = scripts[3];
  assert.equal(lint.origin, 'user');
  assert.equal(lint.runtime, 'node');
  assert.match(lint.scriptPath, /lint\.mjs$/);
  assert.equal(lint.commandResolved, null);
});

test('GET /api/scripts/:key returns the meta plus the source; unknown and malformed keys are 404', async () => {
  const r = await fetch(`${base}/api/scripts/lint`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.key, 'lint');
  assert.equal(d.source, 'export default async () => ({ summary: "lint" });\n');
  assert.match(d.sourcePath, /lint\.mjs$/);
  assert.equal(d.sourceTruncated, false);
  const sh = await (await fetch(`${base}/api/scripts/shell`)).json();
  assert.equal(sh.source, '', 'a shell card with no file has no source');
  assert.equal(sh.sourcePath, null);
  assert.equal((await fetch(`${base}/api/scripts/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/scripts/..%2Fx`)).status, 404);
});

// ── the write half (workbench spec §3.4) ────────────────────────────────────
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const put = (p, b) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(b) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });
const NEW_META = { metaVersion: 2, key: 'fmt', displayName: 'Format', description: 'formats', runtime: 'node',
  inputs: [{ id: 'done', type: 'void', required: false }],
  outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'fmt-cycle{cycle}.md' }] };
const NEW_SRC = 'export default async function () {\n  return { summary: "formatted" };\n}\n';

test('GET /api/scripts/runtimes answers before the :key route ever sees "runtimes"', async () => {
  const r = await fetch(`${base}/api/scripts/runtimes`);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.node.ok, true);
  assert.equal(d.node.version, process.version);
  assert.equal(d.shell.ok, true);
  assert.equal(typeof d.shell.path, 'string');
  assert.deepEqual(d.python, { ok: false, reason: 'not supported' });
});

test('POST -> 201, GET :key, PUT, cases, duplicate, DELETE round-trip', async () => {
  const c = await post('/api/scripts', { meta: NEW_META, source: NEW_SRC });
  assert.equal(c.status, 201);
  const created = await c.json();
  assert.equal(created.meta.key, 'fmt');
  assert.equal(created.meta.origin, 'user');
  assert.equal(created.meta.file, 'fmt.mjs');
  assert.equal(created.meta.createdBy, 'ui');

  const got = await (await fetch(`${base}/api/scripts/fmt`)).json();
  assert.equal(got.key, 'fmt');
  assert.equal(got.source, NEW_SRC);
  assert.equal(got.sourceWin32, '');
  assert.deepEqual(got.cases, []);
  assert.deepEqual(got.userCases, []);
  assert.equal(got.casesWritable, true);

  const u = await put('/api/scripts/fmt', { meta: { ...NEW_META, displayName: 'Format it' }, source: '// v2\n' });
  assert.equal(u.status, 200);
  const updated = await u.json();
  assert.equal(updated.meta.displayName, 'Format it');
  assert.deepEqual(updated.warnings, []);

  const cs = await put('/api/scripts/fmt/cases', { cases: [{ id: 'c1', name: 'smoke', inputs: { done: { fired: true } } }] });
  assert.equal(cs.status, 200);
  assert.deepEqual((await cs.json()).cases.map((x) => x.id), ['c1']);
  assert.equal((await (await fetch(`${base}/api/scripts/fmt`)).json()).cases.length, 1);
  assert.equal((await (await fetch(`${base}/api/scripts`)).json()).scripts.find((s) => s.key === 'fmt').caseCount, 1);

  const dup = await post('/api/scripts/fmt/duplicate', { newKey: 'fmt2' });
  assert.equal(dup.status, 201);
  assert.equal((await dup.json()).meta.key, 'fmt2');
  assert.deepEqual((await (await fetch(`${base}/api/scripts/fmt2`)).json()).cases.map((x) => x.id), ['c1'], 'cases travel');

  assert.deepEqual(await (await del('/api/scripts/fmt2')).json(), { ok: true });
  assert.deepEqual(await (await del('/api/scripts/fmt')).json(), { ok: true });
  assert.equal((await fetch(`${base}/api/scripts/fmt`)).status, 404);
});

test('the store`s error codes map to HTTP through agentErrorStatus', async () => {
  const bad = await post('/api/scripts', { meta: { ...NEW_META, runtime: 'perl' }, source: NEW_SRC });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /runtime must be one of node, shell/);
  const builtin = await post('/api/scripts', { meta: { ...NEW_META, key: 'shell', runtime: 'shell', command: 'x' }, source: '' });
  assert.equal(builtin.status, 409);
  assert.match((await builtin.json()).error, /built-in script/);
  // `planner`, not `reviewer`: this file's fixture already wrote a reviewer
  // sidecar in the user layer, which would answer with the DUPLICATE sentence.
  const agentKey = await post('/api/scripts', { meta: { ...NEW_META, key: 'planner' }, source: NEW_SRC });
  assert.equal(agentKey.status, 409);
  assert.match((await agentKey.json()).error, /is an agent key/);
  assert.equal((await post('/api/scripts', { meta: NEW_META, source: NEW_SRC })).status, 201);
  assert.equal((await post('/api/scripts', { meta: NEW_META, source: NEW_SRC })).status, 409);
  assert.equal((await put('/api/scripts/shell', { meta: { metaVersion: 2, key: 'shell', runtime: 'shell', command: 'x', inputs: [], outputs: [] } })).status, 409);
  assert.equal((await del('/api/scripts/shell')).status, 409);
  assert.equal((await put('/api/scripts/nope', { meta: NEW_META })).status, 404);
  assert.equal((await del('/api/scripts/nope')).status, 404);
  assert.equal((await post('/api/scripts/fmt/duplicate', {})).status, 400);
  assert.equal((await put('/api/scripts/fmt/cases', { cases: 'x' })).status, 400);
  assert.equal((await put('/api/scripts/fmt/cases', { cases: [{ id: '9x' }] })).status, 400);
  await del('/api/scripts/fmt');
});

test('every :key route guards the key shape with a 404 (no traversal reaches the store)', async () => {
  // The last four PASS the key regex: the registry is a plain object, so an unguarded lookup finds
  // Object.prototype — a 200, and a WRITE on the PUT routes, where the contract says 404.
  for (const p of ['/api/scripts/..%2Fx', '/api/scripts/a.b', '/api/scripts/constructor', '/api/scripts/toString',
    '/api/scripts/valueOf', '/api/scripts/hasOwnProperty']) {
    assert.equal((await fetch(`${base}${p}`)).status, 404);
    assert.equal((await put(p, { meta: NEW_META })).status, 404);
    assert.equal((await del(p)).status, 404);
    assert.equal((await post(`${p}/duplicate`, { newKey: 'z' })).status, 404);
    assert.equal((await put(`${p}/cases`, { cases: [] })).status, 404);
  }
});

test('a reserved key is refused, so a literal /api/scripts segment can never shadow a script', async () => {
  // POST succeeded before the fix, and GET /api/scripts/runtimes then answered with the runtime probe.
  const r = await post('/api/scripts', { meta: { ...NEW_META, key: 'runtimes' }, source: NEW_SRC });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /reserved script key/);
  assert.equal((await post('/api/scripts', { meta: { ...NEW_META, key: 'bench' }, source: NEW_SRC })).status, 400);
});

test('an fs failure never returns the absolute home path to the page', async () => {
  // A directory where the program file belongs: `rename` over it fails with a code
  // outside the store's vocabulary, and its message carries the whole path.
  await mkdir(join(homeDir, '.worca-cc', 'scripts', 'blocked.mjs'), { recursive: true });
  const r = await post('/api/scripts', { meta: { ...NEW_META, key: 'blocked' }, source: NEW_SRC });
  assert.equal(r.status, 500);
  const { error } = await r.json();
  assert.equal(error.includes(homeDir), false, `the home path leaked: ${error}`);
  assert.match(error, /^the script store failed \(/);
});

test('a maximal legal case set saves: 32 cases x 256 KiB fits the cases route (the global 8 MB limit would 413)', async () => {
  const meta = { ...NEW_META, key: 'bigcases', inputs: [{ id: 'plan', type: 'md', required: false }] };
  assert.equal((await post('/api/scripts', { meta, source: NEW_SRC })).status, 201);
  const text = 'x'.repeat(262144);
  const cases = Array.from({ length: 32 }, (_, i) => ({ id: `c${i}`, inputs: { plan: { text } } }));
  const r = await put('/api/scripts/bigcases/cases', { cases });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).cases.length, 32);
  await del('/api/scripts/bigcases');
});
