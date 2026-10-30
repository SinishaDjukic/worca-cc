// test/parity-routes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routesFromStack, fillPath, judgeSignedOut, classOf, request, listRoutes, ROUTE_CLASSES } from '../tools/parity/routes.mjs';

const layer = (path, methods) => ({ route: { path, methods } });
const listen = (handler) => new Promise((ok) => { const s = createServer(handler).listen(0, '127.0.0.1', () => ok(s)); });

test('routesFromStack dedupes method+path, expands arrays, keeps only /api, sorts', () => {
  const stack = [layer('/api/run', { post: true }), layer('/api/run', { post: true }),
    layer(['/api/a', '/api/b'], { get: true }), layer('/x', { get: true }), { name: 'jsonParser' }];
  assert.deepEqual(routesFromStack(stack), [
    { method: 'GET', path: '/api/a' }, { method: 'GET', path: '/api/b' }, { method: 'POST', path: '/api/run' }]);
});

test('routesFromStack resolves a nested router with its mount prefix (Express 4 mount regexp)', () => {
  const sub = { name: 'router', mount: { source: '^\\/api\\/feat\\/?(?=\\/|$)' },
    handle: { stack: [layer('/items', { get: true }), layer('/items/:id', { delete: true })] } };
  const root = { name: 'router', mount: { source: '^\\/?(?=\\/|$)', fastSlash: true }, handle: { stack: [layer('/api/z', { get: true })] } };
  assert.deepEqual(routesFromStack([sub, root]), [
    { method: 'DELETE', path: '/api/feat/items/:id' }, { method: 'GET', path: '/api/feat/items' }, { method: 'GET', path: '/api/z' }]);
});

test('routesFromStack throws on a non-string /api path and on a mount it cannot read back', () => {
  assert.throws(() => routesFromStack([layer({ source: '^\\/api\\/x' }, { get: true })]), /not a string/);
  assert.throws(() => routesFromStack([{ name: 'router', mount: { source: '^\\/api\\/(?:a|b)\\/?(?=\\/|$)' }, handle: { stack: [] } }]), /mount/);
});

test('fillPath uses seeded ids for GET and the placeholder otherwise', () => {
  const seed = { projectKey: 'k1', runId: 'r1', threadId: 't1', pipelineId: 'p1' };
  assert.equal(fillPath('GET', '/api/runs/:id/logs', seed), '/api/runs/r1/logs');
  assert.equal(fillPath('GET', '/api/ask/threads/:id', seed), '/api/ask/threads/t1');
  assert.equal(fillPath('GET', '/api/projects/:key/tags', seed), '/api/projects/k1/tags');
  assert.equal(fillPath('DELETE', '/api/runs/:id', seed), '/api/runs/parity-missing');
});

test('signed out: 401 everywhere except the two public routes', () => {
  const pub = JSON.parse(readFileSync(new URL('../tools/parity/public-routes.json', import.meta.url)));
  assert.deepEqual(pub.map((r) => `${r.method} ${r.path}`),
    ['GET /api/health', 'POST /api/ingress/teams/:plugin/:channelId/:token']);
  assert.equal(judgeSignedOut({ method: 'GET', path: '/api/projects', status: 401 }, pub), null);
  assert.match(judgeSignedOut({ method: 'GET', path: '/api/projects', status: 200 }, pub), /expected 401/);
  assert.equal(judgeSignedOut({ method: 'GET', path: '/api/health', status: 200, shape: '{"name":"string","version":"string"}' }, pub), null);
  assert.match(judgeSignedOut({ method: 'GET', path: '/api/health', status: 200, shape: '{"name":"string","pid":"number","version":"string"}' }, pub), /reduced body/);
  assert.match(judgeSignedOut({ method: 'GET', path: '/api/health', status: 401 }, pub), /public route answered 401/);
  const ingress = { method: 'POST', path: '/api/ingress/teams/:plugin/:channelId/:token' };
  assert.equal(judgeSignedOut({ ...ingress, status: 404 }, pub), null);
  for (const status of [200, 500, 'crashed']) assert.match(judgeSignedOut({ ...ingress, status }, pub), /not a 4xx/, String(status));
});

test('request() puts the given Host header on the wire and sends no Origin', async () => {
  let seen;
  const s = await listen((req, res) => { seen = { host: req.headers.host, origin: req.headers.origin }; res.end('{}'); });
  try {
    await request({ base: `http://127.0.0.1:${s.address().port}` }, 'GET', '/x', { host: 'parity.invalid' });
    assert.deepEqual(seen, { host: 'parity.invalid', origin: undefined });
  } finally { s.close(); }
});

test('request() reports a dropped connection as crashed, not a throw', async () => {
  const s = await listen((req) => req.socket.destroy());
  try {
    const r = await request({ base: `http://127.0.0.1:${s.address().port}` }, 'POST', '/x', {});
    assert.equal(r.status, 'crashed');
  } finally { s.close(); }
});

test('route classes: every real route is classified, no stale keys, skips carry a reason', () => {
  const real = listRoutes({ kind: 'tree', root: new URL('..', import.meta.url).pathname }).map((r) => `${r.method} ${r.path}`);
  const keys = Object.keys(ROUTE_CLASSES);
  assert.deepEqual(real.filter((k) => !(k in ROUTE_CLASSES)), [], 'unclassified routes');
  assert.deepEqual(keys.filter((k) => !real.includes(k)), [], 'stale route-classes.json rows');
  for (const k of keys) {
    assert.match(ROUTE_CLASSES[k].class, /^(probe|skip)$/, k);
    assert.ok(ROUTE_CLASSES[k].reason?.length > 5, `${k} has a reason`);
  }
  for (const k of ['POST /api/settings', 'DELETE /api/ask/threads', 'POST /api/sync/all', 'POST /api/fs/pick-folder',
    'POST /api/drain', 'POST /api/shutdown', 'POST /api/run', 'GET /api/setup/detect', 'GET /api/proxy/detect']) assert.equal(classOf(k), 'skip', k);
  assert.equal(classOf('GET /api/projects'), 'probe');
});

test('listRoutes: a server that throws at load is one short "failed to load" error with the stderr tail', () => {
  const root = mkdtempSync(join(tmpdir(), 'parity-boom-'));
  mkdirSync(join(root, 'ui'));
  writeFileSync(join(root, 'ui', 'server.mjs'), "throw new Error('boom at load');\n");
  assert.throws(() => listRoutes({ kind: 'tree', root }), (e) => {
    assert.match(e.message, /^route list: .*server\.mjs failed to load \(exit 1\)/);
    assert.match(e.message, /boom at load/);
    assert.doesNotMatch(e.message, /Command failed|PARITY_ROUTES/);
    return true;
  });
});
