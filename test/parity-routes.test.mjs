// test/parity-routes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routesFromStack, fillPath, judgeSignedOut, classOf, request, listRoutes, ROUTE_CLASSES } from '../tools/parity/routes.mjs';
import { withCatchUpHint } from '../tools/split-by-feature.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const layer = (path, methods) => ({ route: { path, methods } });
const listen = (handler) => new Promise((ok) => { const s = createServer(handler).listen(0, '127.0.0.1', () => ok(s)); });

test('routesFromStack dedupes method+path, expands arrays, keeps only /api, sorts', () => {
  const stack = [layer('/api/run', { post: true }), layer('/api/run', { post: true }),
    layer(['/api/a', '/api/b'], { get: true }), layer('/x', { get: true }), { name: 'jsonParser' }];
  assert.deepEqual(routesFromStack(stack), [
    { method: 'GET', path: '/api/a' }, { method: 'GET', path: '/api/b' }, { method: 'POST', path: '/api/run' }]);
});

test('routesFromStack resolves a nested router with its recorded mount path, in normalizePath spelling', () => {
  const sub = { name: 'router', mount: '/api/feat', stack: [layer('/items', { get: true }), layer('/items/:id', { delete: true }), layer('/f/*splat', { get: true })] };
  const root = { name: 'router', mount: '/', stack: [layer('/api/z/:p?', { get: true })] };
  assert.deepEqual(routesFromStack([sub, root]), [{ method: 'DELETE', path: '/api/feat/items/:id' }, { method: 'GET', path: '/api/feat/f/*' },
    { method: 'GET', path: '/api/feat/items' }, { method: 'GET', path: '/api/z{/:p}' }]);
});

test('routesFromStack throws on a non-string /api path and on a mount it cannot read back', () => {
  assert.throws(() => routesFromStack([layer({ source: '^\\/api\\/x' }, { get: true })]), /not a string/);
  assert.throws(() => routesFromStack([{ name: 'router', mount: '/api/:v', stack: [] }]), /mount path of router "router" \("\/api\/:v"\)/);
  assert.throws(() => routesFromStack([{ name: 'router', mount: null, stack: [] }]), /mount path/);
});

// A tree whose node_modules/express is Express 4 (the express4 alias) or 5, with the same routes in each major's syntax.
function expressTree(t, major) {
  const root = mkdtempSync(join(tmpdir(), `parity-x${major}-`)); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'ui')); mkdirSync(join(root, 'node_modules'));
  symlinkSync(join(REPO, 'node_modules', major === 4 ? 'express4' : 'express'), join(root, 'node_modules', 'express'), 'dir');
  writeFileSync(join(root, 'package.json'), '{"name":"x","type":"module"}');
  const [star, opt] = major === 4 ? ['*', '/:tab?'] : ['*splat', '{/:tab}'];
  writeFileSync(join(root, 'ui', 'server.mjs'), `import express from 'express';
export const app = express();
const feat = express.Router();
feat.get('/items/:id', (q, s) => s.end());
app.use(express.json());
app.use('/api/feat', feat);
app.get('/api/runs/:id/raw/${star}', (q, s) => s.end());
app.get('/api/page${opt}', (q, s) => s.end());
app.post(['/api/a', '/api/b'], (q, s) => s.end());
`);
  return root;
}

test('listRoutes reads an Express 4 tree and an Express 5 tree to the same list', (t) => {
  const four = listRoutes({ kind: 'tree', root: expressTree(t, 4) }); const five = listRoutes({ kind: 'tree', root: expressTree(t, 5) });
  assert.deepEqual(four, [{ method: 'GET', path: '/api/feat/items/:id' }, { method: 'GET', path: '/api/page{/:tab}' },
    { method: 'GET', path: '/api/runs/:id/raw/*' }, { method: 'POST', path: '/api/a' }, { method: 'POST', path: '/api/b' }]);
  assert.deepEqual(five, four);
});

test('fillPath uses seeded ids for GET and the placeholder otherwise', () => {
  const seed = { projectKey: 'k1', runId: 'r1', threadId: 't1', pipelineId: 'p1' };
  assert.equal(fillPath('GET', '/api/runs/:id/logs', seed), '/api/runs/r1/logs');
  assert.equal(fillPath('GET', '/api/ask/threads/:id', seed), '/api/ask/threads/t1');
  assert.equal(fillPath('GET', '/api/projects/:key/tags', seed), '/api/projects/k1/tags');
  assert.equal(fillPath('DELETE', '/api/runs/:id', seed), '/api/runs/parity-missing');
});

test('signed out: 401 everywhere except the public routes (health and the three webhook ingresses)', () => {
  const pub = JSON.parse(readFileSync(new URL('../tools/parity/public-routes.json', import.meta.url)));
  assert.deepEqual(pub.map((r) => `${r.method} ${r.path}`),
    ['GET /api/health', 'POST /api/ingress/teams/:plugin/:channelId/:token', 'POST /api/ingress/github', 'POST /api/ingress/azure']);
  assert.equal(judgeSignedOut({ method: 'GET', path: '/api/projects', status: 401 }, pub), null);
  assert.match(judgeSignedOut({ method: 'GET', path: '/api/projects', status: 200 }, pub), /expected 401/);
  assert.equal(judgeSignedOut({ method: 'GET', path: '/api/health', status: 200, shape: '{"name":"string","version":"string"}' }, pub), null);
  assert.match(judgeSignedOut({ method: 'GET', path: '/api/health', status: 200, shape: '{"name":"string","pid":"number","version":"string"}' }, pub), /reduced body/);
  assert.match(judgeSignedOut({ method: 'GET', path: '/api/health', status: 401 }, pub), /public route answered 401/);
  const ingress = { method: 'POST', path: '/api/ingress/teams/:plugin/:channelId/:token' };
  assert.equal(judgeSignedOut({ ...ingress, status: 404 }, pub), null);
  for (const status of [200, 500, 'crashed']) assert.match(judgeSignedOut({ ...ingress, status }, pub), /not a 4xx/, String(status));
  // the git automations webhooks (#711) answer 404 to an unsigned call, before any guard
  for (const path of ['/api/ingress/github', '/api/ingress/azure']) assert.equal(judgeSignedOut({ method: 'POST', path, status: 404 }, pub), null, path);
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
  const unclassified = real.filter((k) => !(k in ROUTE_CLASSES));
  assert.deepEqual(unclassified, [], withCatchUpHint(`unclassified routes: ${unclassified.join(', ')}`, new URL('..', import.meta.url).pathname));
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
