// test/api-design-owner.test.mjs
// Design P8 Task 7 (L8.20, L8.21, L3.31): the owner filter, proven on every /api/design route and every design frame.
// One in-process server behind a trusted identity header: Ada makes D through the route, Bob is another person. Every
// owner-checked route answers Bob 404 and changes nothing, the list and the chat follow the owner, every design- frame
// reaches its owner only, an ownerless old design stays visible to all, a frame for a design that does not exist reaches
// no viewer, and only the owner mints a preview token. The route list is read from Express itself (routeTable +
// routesFromStack), so a new /api/design route fails here until it is classified in ROUTES or OPEN.
// Helpers are copied from test/design-server.test.mjs, where they are module-local (importing a test file runs it).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { _resetForTests } from '../src/core/db.mjs';
import { createDesign, getBuild, getDesign, listAgents } from '../src/core/design/store.mjs';
import { routeTable } from '../tools/express-routes.mjs';
import { routesFromStack } from '../tools/parity/routes.mjs';
import { waitUntil } from './helpers/design-fixture.mjs';
import { checkRows } from './helpers/rows.mjs';

const ADA = 'ada@example.com';
const BOB = 'bob@example.com';
const TITLE = 'Ada private launch page';
// `tools/test.mjs` deletes WORCA_FLAGS, so the flag is set here, before the import. The identity env is read per
// request; the in-process server's callers are loopback, so loopback is the trusted proxy.
const ENV = {
  WORCA_MOCK: '1', WORCA_FLAGS: 'design', WORCA_MOCK_DESIGN_MS: '2', WORCA_CHROME: 'none',
  WORCA_IDENTITY_HEADER: 'x-test-user', WORCA_IDENTITY_TRUSTED_PROXIES: '127.0.0.1,::1',
};
// Agent isolation makes the G1 gate answer 403 to every loopback request; the caps would override the defaults.
const DROPPED = ['WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_DESIGN_MAX_BUILDERS', 'WORCA_DESIGN_MAX_AGENTS'];
const SAVED_KEYS = [...Object.keys(ENV), ...DROPPED, 'WORCA_HOME'];
const saved = {};
let mod, srv, port, wsBase, homeDir;
const clients = [];

/** Owner-checked: each answers another person 404 `design not found` through `designFor` or the mint's same rule. */
const ROUTES = [
  { method: 'GET', path: '/api/design/:id' },
  { method: 'PATCH', path: '/api/design/:id', body: { title: 'x' } },
  { method: 'DELETE', path: '/api/design/:id' },
  { method: 'POST', path: '/api/design/:id/preview-token' },
  { method: 'POST', path: '/api/design/:id/builds/:bid/stop' },
  { method: 'POST', path: '/api/design/:id/builds/:bid/agents/:aid/stop' },
  { method: 'POST', path: '/api/design/:id/builds/:bid/answer', body: { askId: 'as_ab12cd34', answers: [{ id: 'q', value: 'a' }] } },
  { method: 'POST', path: '/api/design/:id/builds/:bid/continue', body: {} },
  { method: 'POST', path: '/api/design/:id/versions/:n/restore', body: {} },
  { method: 'POST', path: '/api/design/:id/export', body: { format: 'html' } },
  { method: 'GET', path: '/api/design/:id/thumb' },
  { method: 'GET', path: '/api/design/:id/models' },
];
/** Not about one design: the list filters by viewer, a create makes the caller's own, the limits and a new design's
 *  model choices are the same for all. */
const OPEN = [
  { method: 'GET', path: '/api/design' },
  { method: 'POST', path: '/api/design' },
  { method: 'GET', path: '/api/design/limits' },
  { method: 'GET', path: '/api/design/models' },
];
const FRAME_TYPES = ['design-build', 'design-plan', 'design-agent', 'design-section', 'design-delta', 'design-file',
  'design-question', 'design-restored', 'design-thumb'];
const MISSING = 'd_ffffffffffff';

/** D (Ada's, through the route), its finished build B, B's agent A; OLD has no maker. */
let D, B, A, OLD;
let previewBase = null;

/** `call(method, url, body, headers)` -> { status, body, text }; http.request sends the path as typed. */
function call(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1', port, path: url, method,
      headers: { connection: 'close', ...(data === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }), ...headers },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: json, text });
      });
    });
    r.on('error', reject);
    if (data !== null) r.write(data);
    r.end();
  });
}
const as = (name) => ({ 'x-test-user': name });
const fill = (path) => path.replace(':id', D.id).replace(':bid', B).replace(':aid', A).replace(':n', '1');
/** A design of Ada's made through the route, as D was. */
async function adaDesign(title) {
  const r = await call('POST', '/api/design', { kind: 'web', title }, as(ADA));
  assert.equal(r.status, 201, r.text);
  return r.body.design;
}

before(async () => {
  for (const k of SAVED_KEYS) saved[k] = process.env[k];
  homeDir = await mkdtemp(join(tmpdir(), 'worca-design-owner-'));
  Object.assign(process.env, ENV, { WORCA_HOME: homeDir });
  for (const k of DROPPED) delete process.env[k];
  _resetForTests();
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  wsBase = `ws://127.0.0.1:${port}/ws`;

  D = await adaDesign(TITLE);
  assert.equal(D.createdBy, ADA, 'made through the route as Ada, so its maker is Ada, not local');
  ({ buildId: B } = await mod.designBuilds.start({ designId: D.id, brief: 'MOCK_SECTIONS=1', by: ADA }));
  await mod.designBuilds.settled();
  assert.equal(getBuild(B).status, 'done');
  A = listAgents(B)[0].id;
  D = getDesign(D.id);
  assert.equal(D.version, 1);
  OLD = createDesign({ kind: 'web', title: 'Old' });
  assert.equal(OLD.createdBy, null);
});
after(async () => {
  for (const c of clients) c.ws.terminate();
  if (mod?.designBuilds) { mod.designBuilds.pauseAll(); await mod.designBuilds.settled(); }
  if (srv) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500).unref())]);
  }
  _resetForTests();
  for (const k of SAVED_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function connect({ headers = {} } = {}) {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1', ...headers } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const c = { ws, msgs };
  clients.push(c);
  return c;
}
const quiet = (ms) => new Promise((r) => setTimeout(r, ms));
/** Ends a build that hangs on the mock: a drain-style pause, then Stop on the paused row (L2.34). */
async function endHung(buildId) {
  mod.designBuilds.pauseAll(); await mod.designBuilds.settled();
  await mod.designBuilds.stopBuild(buildId); await mod.designBuilds.settled();
}

/** Fake sockets on the server's own set: Ada, Bob, one with no viewer (a local install) and a paired extension. */
function fakeSockets() {
  const mkSock = (extra) => {
    const got = [];
    const ws = { readyState: 1, OPEN: 1, send: (t) => got.push(JSON.parse(t)), ...extra };
    mod._testing.sockets.add(ws);
    return { ws, got };
  };
  return { ada: mkSock({ worcaViewer: ADA }), bob: mkSock({ worcaViewer: BOB }), nobody: mkSock({ worcaViewer: null }), ext: mkSock({ worcaExtension: {} }) };
}
const dropSockets = (s) => { for (const x of Object.values(s)) mod._testing.sockets.delete(x.ws); };
/** One frame of every design- type for `designId`, each carrying a `marker` that names this send. */
function sendFrames(designId, tag) {
  for (const type of FRAME_TYPES) mod._testing.broadcast({ type, designId, buildId: B, seq: 1, ts: 1, marker: `${tag}:${type}` });
}
const marked = (sock, tag) => sock.got.filter((m) => typeof m.marker === 'string' && m.marker.startsWith(`${tag}:`)).map((m) => m.type);

test('every /api/design route is in this table', () => {
  const real = routesFromStack(routeTable(mod.app)).filter((r) => /^\/api\/design(\/|$)/.test(r.path)).map((r) => `${r.method} ${r.path}`);
  const table = [...ROUTES, ...OPEN].map((r) => `${r.method} ${r.path}`);
  assert.equal(new Set(table).size, table.length, 'no row twice');
  assert.deepEqual(real.filter((k) => !table.includes(k)), [], 'a real /api/design route is not classified: add it to ROUTES (owner-checked) or OPEN');
  assert.deepEqual(table.filter((k) => !real.includes(k)), [], 'a table row is no real route');
});

test('another person gets 404 on all of them, and nothing changed', async () => {
  const design = getDesign(D.id);
  const build = getBuild(B);
  await checkRows(ROUTES.map((r) => ({
    name: `${r.method} ${r.path}`,
    run: async () => {
      const res = await call(r.method, fill(r.path), r.body, as(BOB));
      assert.equal(res.status, 404, res.text);
      assert.deepEqual(res.body, { error: 'design not found' });
      assert.equal(res.text.includes(D.title), false);
    },
  })));
  assert.equal(getDesign(D.id).title, TITLE);
  assert.deepEqual(getDesign(D.id), design, 'the design row is untouched');
  assert.deepEqual(getBuild(B), build, 'the build row is untouched');
  assert.deepEqual(mod.designBuilds.live().filter((x) => x.designId === D.id), [], 'nothing was started');
});

test('the owner reaches them; an ownerless old design stays visible', async () => {
  const own = await call('GET', `/api/design/${D.id}`, undefined, as(ADA));
  assert.equal(own.status, 200, own.text);
  assert.equal(own.body.design.id, D.id);
  // Rows that act run on a throwaway design of Ada's each, never on D.
  const p = await adaDesign('Throwaway to rename');
  const patched = await call('PATCH', `/api/design/${p.id}`, { title: 'x' }, as(ADA));
  assert.equal(patched.status, 200, patched.text);
  assert.equal(getDesign(p.id).title, 'x');
  const g = await adaDesign('Throwaway to delete');
  const gone = await call('DELETE', `/api/design/${g.id}`, undefined, as(ADA));
  assert.equal(gone.status, 200, gone.text);
  assert.equal(getDesign(g.id), null);
  const old = await call('GET', `/api/design/${OLD.id}`, undefined, as(BOB));
  assert.equal(old.status, 200, old.text);
  assert.equal(old.body.design.title, 'Old');
});

test('the list and the chat follow', async () => {
  const ada = await call('GET', '/api/design', undefined, as(ADA));
  const bob = await call('GET', '/api/design', undefined, as(BOB));
  assert.deepEqual([ada.status, bob.status], [200, 200]);
  assert.ok(ada.body.some((x) => x.id === D.id && x.title === TITLE), "Ada's list holds D");
  assert.equal(bob.body.some((x) => x.id === D.id), false, "Bob's list does not");
  assert.equal(bob.text.includes(TITLE), false);
  assert.ok(bob.body.some((x) => x.id === OLD.id), 'the ownerless design is listed for everyone');
  const report = (await call('POST', '/api/design', { kind: 'document', title: 'Ada report' }, as(ADA))).body.design;
  assert.equal(report.kind, 'document');
  assert.ok((await call('GET', '/api/design', undefined, as(ADA))).body.some((x) => x.id === report.id), "Ada's document is in her list");
  assert.equal((await call('GET', '/api/design', undefined, as(BOB))).body.some((x) => x.id === report.id), false, "and not in Bob's");

  assert.ok(D.threadId, 'D was made with its chat');
  const thread = await call('GET', `/api/ask/threads/${D.threadId}`, undefined, as(BOB));
  assert.equal(thread.status, 404, thread.text);
  const open = await call('POST', '/api/ask/threads', { mode: 'design', designId: D.id }, as(BOB));
  assert.equal(open.status, 404, open.text);
  assert.equal(open.text.includes(D.threadId), false, 'the 404 comes before the 409 that names the thread');
  // The owner reaches both: her chat, and the 409 that names it.
  assert.equal((await call('GET', `/api/ask/threads/${D.threadId}`, undefined, as(ADA))).status, 200);
  const mine = await call('POST', '/api/ask/threads', { mode: 'design', designId: D.id }, as(ADA));
  assert.equal(mine.status, 409, mine.text);
  assert.equal(mine.body.threadId, D.threadId);
});

test('frames reach their owner only', () => {
  const s = fakeSockets();
  try {
    sendFrames(D.id, 'own');
    assert.deepEqual(marked(s.ada, 'own'), FRAME_TYPES, 'Ada gets all');
    assert.deepEqual(marked(s.bob, 'own'), [], 'Bob none');
    assert.deepEqual(marked(s.nobody, 'own'), FRAME_TYPES, 'a socket with no viewer (a local install) gets them');
  } finally {
    dropSockets(s);
  }
});

test("an ownerless design's frames reach everyone", () => {
  const s = fakeSockets();
  try {
    sendFrames(OLD.id, 'old');
    for (const who of ['ada', 'bob', 'nobody']) assert.deepEqual(marked(s[who], 'old'), FRAME_TYPES, who);
  } finally {
    dropSockets(s);
  }
});

test('a frame for a design that does not exist goes to no viewer', () => {
  assert.equal(getDesign(MISSING), null);
  const s = fakeSockets();
  try {
    sendFrames(MISSING, 'gone');
    assert.deepEqual(marked(s.bob, 'gone'), [], 'Bob gets nothing');
    assert.deepEqual(marked(s.ada, 'gone'), [], 'nor does any other viewer');
    assert.deepEqual(marked(s.nobody, 'gone'), FRAME_TYPES, 'a socket with no viewer still gets it');
  } finally {
    dropSockets(s);
  }
});

test('an extension socket sees no design frame', () => {
  const s = fakeSockets();
  try {
    sendFrames(D.id, 'ext-own'); sendFrames(OLD.id, 'ext-old'); sendFrames(MISSING, 'ext-gone');
    for (const tag of ['ext-own', 'ext-old', 'ext-gone']) assert.deepEqual(marked(s.ext, tag), [], tag);
    assert.deepEqual(marked(s.ada, 'ext-own'), FRAME_TYPES, 'the frames were sent');
  } finally {
    dropSockets(s);
  }
});

test('a real restore: the owner gets design-restored, another person does not', async () => {
  const t = await adaDesign('Throwaway to restore');
  await mod.designBuilds.start({ designId: t.id, brief: 'MOCK_SECTIONS=1', by: ADA });
  await mod.designBuilds.settled();
  assert.equal(getDesign(t.id).version, 1);
  const s = fakeSockets();
  try {
    const r = await call('POST', `/api/design/${t.id}/versions/1/restore`, {}, as(ADA));
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.ok, r.body.restoredFrom], [true, 1]);
    const restored = (sock) => sock.got.filter((m) => m.type === 'design-restored' && m.designId === t.id).length;
    assert.deepEqual([restored(s.ada), restored(s.bob), restored(s.ext)], [1, 0, 0]);
  } finally {
    dropSockets(s);
  }
});

test('preview: only the owner mints a token', async () => {
  assert.ok(ROUTES.some((r) => r.method === 'POST' && r.path === '/api/design/:id/preview-token'), "Bob's mint is a ROUTES row");
  const mint = await call('POST', `/api/design/${D.id}/preview-token`, undefined, as(ADA));
  assert.equal(mint.status, 200, mint.text);
  assert.match(mint.body.base, /^\/design-preview\/[A-Za-z0-9_-]{43}$/, 'no trailing slash');
  previewBase = mint.body.base;
  assert.equal((await call('GET', `${previewBase}/build/`, undefined, as(ADA))).status, 200);
  assert.equal((await call('GET', `${previewBase}/`, undefined, as(ADA))).status, 404, 'a path with no mode segment');
});

test('hello and subscribe follow the viewer', async () => {
  let buildId = null;
  try {
    ({ buildId } = await mod.designBuilds.start({ designId: D.id, brief: 'MOCK_SECTIONS=1 MOCK_HANG_LEAD', by: ADA }));
    const bob = connect({ headers: as(BOB) });
    const ada = connect({ headers: as(ADA) });
    await waitUntil(() => bob.msgs.some((m) => m.type === 'hello') && ada.msgs.some((m) => m.type === 'hello'));
    const hb = bob.msgs.find((m) => m.type === 'hello');
    const ha = ada.msgs.find((m) => m.type === 'hello');
    assert.equal(hb.design.some((x) => x.buildId === buildId || x.designId === D.id), false, "Bob's hello omits Ada's build");
    assert.deepEqual(ha.design.filter((x) => x.buildId === buildId).map((x) => x.designId), [D.id], "Ada's hello lists it");

    for (const c of [bob, ada]) c.ws.send(JSON.stringify({ type: 'subscribe', designBuildId: buildId }));
    await waitUntil(() => ada.msgs.some((m) => m.type === 'design-snapshot' && m.buildId === buildId));
    await quiet(100);
    assert.equal(bob.msgs.some((m) => m.type === 'design-snapshot'), false, 'Bob gets no snapshot of it');
    assert.equal(bob.msgs.some((m) => typeof m.type === 'string' && m.type.startsWith('design-') && m.designId === D.id), false,
      "nor any of the build's frames");
  } finally {
    if (buildId) await endHung(buildId);
  }
  assert.equal(getBuild(buildId).status, 'stopped');
});

test('flag off: every route is 404', async () => {
  const prev = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = '-design';   // read per request
  try {
    await checkRows([...ROUTES, { method: 'GET', path: '/api/design' }].map((r) => ({
      name: `${r.method} ${r.path}`,
      run: async () => {
        const res = await call(r.method, fill(r.path), r.body, as(ADA));
        assert.equal(res.status, 404, res.text);
        assert.deepEqual(res.body, { error: 'not found' }, 'the flag gate answers, not the route');
      },
    })));
    assert.equal((await call('GET', `${previewBase}/build/`, undefined, as(ADA))).status, 404, 'the preview mount too');
  } finally {
    process.env.WORCA_FLAGS = prev;   // the value saved above, never a delete
  }
  assert.equal(getDesign(D.id).title, TITLE, 'nothing acted while the flag was off');
  assert.equal((await call('GET', `/api/design/${D.id}`, undefined, as(ADA))).status, 200, 'on again once restored');
});
