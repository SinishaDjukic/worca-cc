// test/design-server.test.mjs
// Design builds wired into ui/server.mjs (P2 Task 19, SPEC C-5): frames on the existing socket, `hello.design`,
// `{type:'subscribe', designBuildId}` answered with `design-snapshot`, the owner filter, keep awake and the boot sweep.
// One in-process server for the file, on the mock engine. Every test ends its builds (stop or finish), because the
// boot row counts what is still open.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { _resetForTests } from '../src/core/db.mjs';
import { sectionDir } from '../src/core/design/paths.mjs';
import { createBuild, createDesign, getBuild } from '../src/core/design/store.mjs';
import { readServerSource } from '../src/core/read-server-source.mjs';

// `tools/test.mjs` deletes WORCA_FLAGS, so the flag is set here, before the import.
const ENV = { WORCA_MOCK: '1', WORCA_FLAGS: 'design', WORCA_MOCK_DESIGN_MS: '2', WORCA_CHROME: 'none' };
const SAVED_KEYS = [...Object.keys(ENV), 'WORCA_HOME', 'WORCA_DESIGN_MAX_BUILDERS'];
const saved = {};
let mod, srv, httpBase, wsBase, homeDir;
const clients = [];

before(async () => {
  for (const k of SAVED_KEYS) saved[k] = process.env[k];
  homeDir = await mkdtemp(join(tmpdir(), 'worca-design-server-'));
  Object.assign(process.env, ENV, { WORCA_HOME: homeDir });
  delete process.env.WORCA_DESIGN_MAX_BUILDERS;
  _resetForTests();
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  httpBase = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
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

function waitFor(pred, timeoutMs = 4000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => { const v = pred(); if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15); };
    tick();
  });
}
function connect({ headers = {} } = {}) {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1', ...headers } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const c = { ws, msgs };
  clients.push(c);
  return c;
}
const mk = () => createDesign({ kind: 'web', title: 'T', engine: 'claude' }, { by: 'local' });
const applyDelta = (text, s) => text.slice(0, s.at) + s.text + text.slice(s.at + s.del);
const quiet = (ms) => new Promise((r) => setTimeout(r, ms));
/** Ends a build that hangs on the mock: a drain-style pause, then Stop on the paused row (L2.34). */
async function endHung(buildId) {
  mod.designBuilds.pauseAll(); await mod.designBuilds.settled();
  await mod.designBuilds.stopBuild(buildId); await mod.designBuilds.settled();
}

test('hello lists open builds; an idle server says []', async () => {
  const a = connect(); const hello = await waitFor(() => a.msgs.find((m) => m.type === 'hello'));
  assert.deepEqual(hello.design, []);
  const d = mk();
  const { buildId } = await mod.designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_HANG_LEAD', by: 'local' });
  try {
    const b = connect(); const h2 = await waitFor(() => b.msgs.find((m) => m.type === 'hello'));
    assert.deepEqual(h2.design.map((x) => x.buildId), [buildId]);
    assert.deepEqual(Object.keys(h2.design[0]).sort(), ['buildId', 'designId', 'status', 'title', 'waiting']);
  } finally {
    // In a finally: a hung build left in memory would make every later settled() wait forever.
    await endHung(buildId);
  }
  // The next test reads every design- frame its socket gets: this build's terminal frame must be out first.
});

test('frames reach a socket with common fields and rising seq', async () => {
  const a = connect(); await waitFor(() => a.msgs.find((m) => m.type === 'hello'));
  const d = mk();
  await mod.designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=2', by: 'local' });
  await mod.designBuilds.settled();
  // The last frame is sent in the turn that settles; the socket reads it in a later one.
  await waitFor(() => a.msgs.some((m) => m.type === 'design-build' && m.designId === d.id && m.status === 'done'));
  const f = a.msgs.filter((m) => m.type?.startsWith('design-'));
  for (const t of ['design-build', 'design-plan', 'design-agent', 'design-section', 'design-delta', 'design-file']) assert.ok(f.some((m) => m.type === t), t);
  const seqs = f.map((m) => m.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
  assert.ok(f.every((m) => m.designId === d.id && typeof m.ts === 'number'));
  assert.equal(f.filter((m) => m.type === 'design-build').at(-1).status, 'done');
});

test('a client that loses a delta re-subscribes and converges', async () => {
  const c = connect(); await waitFor(() => c.msgs.find((m) => m.type === 'hello'));
  const d = mk();
  const P = 'sections/hero/index.html';
  // MOCK_REWORK: hero's rework Edit always sends two deltas (the deleting splice, then the insert), so dropping the
  // first is a real gap at any pace. A first build's Write lands inside one 120 ms batch at pace 2: one delta, no gap.
  const { buildId } = await mod.designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_REWORK=hero', by: 'local' });
  const docs = new Map(); let dropped = false; let resubscribed = 0; let sawSnapshot = false;
  // A small client, the C-5 contract: rev gap means re-subscribe; a snapshot resets text and rev.
  const pump = () => {
    for (const m of c.msgs.splice(0)) {
      if (m.type === 'design-snapshot') { sawSnapshot = true; for (const x of m.drafts) docs.set(x.path, { rev: x.rev, text: x.text }); continue; }
      if (m.type === 'design-file' && m.text !== undefined) { docs.set(m.path, { rev: m.rev, text: m.text }); continue; }
      if (m.type !== 'design-delta') continue;
      if (!dropped && m.path === P && m.splice.del > 0) { dropped = true; continue; }
      const cur = docs.get(m.path) ?? { rev: 0, text: '' };
      if (m.rev <= cur.rev) continue;
      if (m.rev !== cur.rev + 1) { resubscribed++; c.ws.send(JSON.stringify({ type: 'subscribe', designBuildId: buildId })); continue; }
      docs.set(m.path, { rev: m.rev, text: applyDelta(cur.text, m.splice) });
    }
  };
  while (mod.designBuilds.get(buildId)) { pump(); await new Promise((r) => setTimeout(r, 5)); }
  await waitFor(() => { pump(); return sawSnapshot; });
  assert.ok(dropped && resubscribed >= 1, 'design-file frames heal the text anyway, so sawSnapshot is what proves the subscribe reply');
  assert.equal(docs.get(P).text, readFileSync(join(sectionDir(d.id, 'hero'), 'index.html'), 'utf8'));
});

test('subscribe to a finished build answers from rows; to an unknown one, nothing', async () => {
  const a = connect(); await waitFor(() => a.msgs.find((m) => m.type === 'hello'));
  const d = mk();
  const { buildId } = await mod.designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' });
  await mod.designBuilds.settled();
  await waitFor(() => a.msgs.some((m) => m.type === 'design-build' && m.buildId === buildId && m.status === 'done'));
  a.ws.send(JSON.stringify({ type: 'subscribe', designBuildId: buildId }));
  const snap = await waitFor(() => a.msgs.find((m) => m.type === 'design-snapshot' && m.buildId === buildId));
  assert.equal(snap.designId, d.id);
  assert.equal(snap.build.status, 'done');
  assert.deepEqual(snap.drafts, []);

  // An unknown id, and ids that are not strings: no frame at all, and the socket stays open.
  a.msgs.splice(0);
  for (const designBuildId of ['b_nope', 'not an id', 42, null, { x: 1 }]) a.ws.send(JSON.stringify({ type: 'subscribe', designBuildId }));
  await quiet(100);
  assert.deepEqual(a.msgs.map((m) => m.type), []);
  assert.equal(a.ws.readyState, WebSocket.OPEN);

  // A build whose lead failed has no plan: the row snapshot carries canvas null, and the server keeps answering.
  const d2 = mk();
  const { buildId: failed } = await mod.designBuilds.start({ designId: d2.id, brief: 'MOCK_FAIL_LEAD', by: 'local' });
  await mod.designBuilds.settled();
  assert.equal(getBuild(failed).status, 'error');
  a.ws.send(JSON.stringify({ type: 'subscribe', designBuildId: failed }));
  const s2 = await waitFor(() => a.msgs.find((m) => m.type === 'design-snapshot' && m.buildId === failed));
  assert.equal(s2.plan.canvas, null);
  const r = await fetch(`${httpBase}/api/design/${d2.id}`);
  assert.equal(r.status, 200);
});

test('hello and subscribe follow the viewer', async () => {
  const prev = { header: process.env.WORCA_IDENTITY_HEADER, proxies: process.env.WORCA_IDENTITY_TRUSTED_PROXIES };
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // the in-process server's callers are loopback
  let buildId = null;
  try {
    const d = createDesign({ kind: 'web', title: 'Alice', engine: 'claude' }, { by: 'a@x.io' });
    ({ buildId } = await mod.designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1 MOCK_HANG_LEAD', by: 'a@x.io' }));
    const bob = connect({ headers: { 'x-test-user': 'b@x.io' } });
    const alice = connect({ headers: { 'x-test-user': 'a@x.io' } });
    const hb = await waitFor(() => bob.msgs.find((m) => m.type === 'hello'));
    const ha = await waitFor(() => alice.msgs.find((m) => m.type === 'hello'));
    assert.equal(hb.design.some((x) => x.buildId === buildId), false, "bob's hello omits alice's build");
    assert.deepEqual(ha.design.filter((x) => x.buildId === buildId).map((x) => x.designId), [d.id], "alice's hello lists it");

    for (const c of [bob, alice]) c.ws.send(JSON.stringify({ type: 'subscribe', designBuildId: buildId }));
    const snap = await waitFor(() => alice.msgs.find((m) => m.type === 'design-snapshot' && m.buildId === buildId));
    assert.equal(snap.designId, d.id);
    await quiet(100);
    assert.equal(bob.msgs.some((m) => m.type === 'design-snapshot'), false, 'bob gets no snapshot of it');
  } finally {
    if (buildId) await endHung(buildId);
    for (const [k, v] of [['WORCA_IDENTITY_HEADER', prev.header], ['WORCA_IDENTITY_TRUSTED_PROXIES', prev.proxies]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
  assert.equal(getBuild(buildId).status, 'stopped');
});

test('design-delta stays out of ring buffers and the Runs list', async () => {
  const before = mod.runs.size;
  const d = mk();
  await mod.designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' });
  await mod.designBuilds.settled();
  assert.equal(mod.runs.size, before);
  assert.ok([...mod.runs.values()].every((e) => !(e.events || []).some((ev) => String(ev.type).startsWith('design-'))));
  const fresh = connect(); const h = await waitFor(() => fresh.msgs.find((m) => m.type === 'hello'));
  assert.ok(h.runs.every((r) => !r.designId));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fresh.msgs.some((m) => m.type === 'design-delta'), false, 'nothing is replayed on connect');
});

test('frames follow the owner, design-restored included; an extension socket gets none', () => {
  const d = createDesign({ kind: 'web', title: 'T', engine: 'claude' }, { by: 'a@x.io' });
  const mkSock = (extra) => { const got = []; const ws = { readyState: 1, OPEN: 1, send: (t) => got.push(t), ...extra }; mod.sockets.add(ws); return { ws, got }; };
  const [alice, bob, ext] = [mkSock({ worcaViewer: 'a@x.io' }), mkSock({ worcaViewer: 'b@x.io' }), mkSock({ worcaExtension: {} })];
  mod.broadcast({ type: 'design-build', designId: d.id, buildId: 'b', seq: 1, ts: 1 });
  mod.broadcast({ type: 'design-restored', designId: d.id, version: 2, restoredFrom: 1, ts: 1 });
  assert.deepEqual([alice.got.length, bob.got.length, ext.got.length], [2, 0, 0]);
  for (const s of [alice, bob, ext]) mod.sockets.delete(s.ws);
});

test('keep awake counts live build agents; the call-site options stay wired', () => {
  const src = readServerSource();
  assert.match(src, /countWorking\(runs\.values\(\)\) \+ designBuilds\.liveAgentCount\(\)/);
  for (const re of [/onLiveChange: \(\) => syncKeepAwake\(\)/, /hosted: DEPLOYMENT === 'hosted'/, /isLive: \(id\) => !!designBuilds\.get\(id\)/]) assert.match(src, re);
  // P6 review M5: a thumbnail whose turn comes during a restore or a hand-off draws nothing.
  assert.match(src, /createThumbs\(\{ notify: broadcast, held: \(id\) => designBuilds\.restoring\(id\) \|\| designBuilds\.starting\(id\) \}\)/);
});

test('a registry that throws never reaches the socket handlers', async () => {
  // server.mjs has no uncaughtException handler: without the try/catch around hello and subscribe, these end the
  // test process. The registry is a class instance, so an own property shadows the method until it is deleted.
  const asked = [];
  mod.designBuilds.live = () => { throw new Error('live boom'); };
  mod.designBuilds.snapshotFor = (id) => { asked.push(id); throw new Error('snapshot boom'); };
  try {
    const a = connect(); const hello = await waitFor(() => a.msgs.find((m) => m.type === 'hello'));
    assert.deepEqual(hello.design, []);
    // Only a string id reaches the registry; anything else a client sends is ignored before it.
    for (const designBuildId of [42, { x: 1 }, ['b_any'], true, 'b_any']) a.ws.send(JSON.stringify({ type: 'subscribe', designBuildId }));
    await waitFor(() => asked.length > 0);
    await quiet(100);
    assert.deepEqual(asked, ['b_any']);
    assert.equal(a.msgs.some((m) => m.type === 'design-snapshot'), false);
    assert.equal(a.ws.readyState, WebSocket.OPEN);
    assert.equal((await fetch(`${httpBase}/api/design`)).status, 200, 'the server still answers');
  } finally {
    delete mod.designBuilds.live;
    delete mod.designBuilds.snapshotFor;
  }
});

test('boot marks a build a dead server left live', async () => {
  const d = mk();
  const b = createBuild({ designId: d.id, kind: 'first', brief: 'x' }, { by: 'local' });
  // A build this server runs now is live, not dead: isLive keeps the sweep off it.
  const d2 = mk();
  const { buildId: running } = await mod.designBuilds.start({ designId: d2.id, brief: 'MOCK_SECTIONS=1 MOCK_HANG_LEAD', by: 'local' });
  try {
    // A sweep that throws is logged; boot goes on (isLive runs outside recoverDesignBuilds' per-row try).
    mod.designBuilds.get = () => { throw new Error('get boom'); };
    try {
      const s0 = await mod.bootMaintenance();
      assert.equal(s0.recoveredDesignBuilds, undefined);
      assert.equal(getBuild(b.id).status, 'planning');
    } finally {
      delete mod.designBuilds.get;
    }
    const s = await mod.bootMaintenance();
    assert.ok(s.recoveredDesignBuilds >= 1, 'an earlier test left nothing open, but do not depend on it');
    assert.deepEqual([getBuild(b.id).status, getBuild(b.id).reason], ['interrupted', 'restart']);
    assert.equal(getBuild(running).status, 'planning', 'the running build is left alone');
    assert.ok(mod.designBuilds.get(running));
  } finally {
    await endHung(running);
  }
});
