// T-repl: pull replication between two in-process buses over loopback HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createSqliteBus } from '../lib/sqlite-bus.mjs';
import { startOutboxServer, createPuller } from '../lib/replicate.mjs';

const dirs = [];
const cleanups = [];
test.after(async () => {
  for (const c of cleanups.reverse()) await c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const TOKEN = 'secret-token-a';
const FROM = { kind: 'system', id: 't', sub: null };

function bus(origin) {
  const d = mkdtempSync(join(tmpdir(), 'bus-repl-'));
  dirs.push(d);
  const b = createSqliteBus({ path: join(d, 'bus.db'), origin });
  cleanups.push(() => b.close());
  return b;
}
async function server(b) {
  const s = await startOutboxServer({ bus: b, token: TOKEN });
  cleanups.push(() => s.close());
  return s;
}
const pub = (b, n) => Array.from({ length: n }, (_, i) => b.publish({ topic: 'team.metrics', kind: 'status', body: { text: `m${i}` } }, { from: FROM }).id);
const originRows = (b, origin) => b.db.prepare('SELECT id, seq FROM bus_messages WHERE origin = ? ORDER BY rowid').all(origin);

test('a pull copies every row A→B in seq order; a re-pull after a cursor rollback inserts nothing', async () => {
  const a = bus('h_aaaaaaaa'); const b = bus('h_bbbbbbbb');
  const ids = pub(a, 250);
  const s = await server(a);
  const p = createPuller({ bus: b, url: s.url, token: TOKEN, peerOrigin: a.origin, longPollMs: 0, limit: 100 });
  while ((await p.pullOnce()).items > 0);
  const rows = originRows(b, a.origin);
  assert.deepEqual(rows.map((r) => r.id), ids);
  assert.deepEqual(rows.map((r) => r.seq), ids.map((_, i) => i + 1));
  assert.equal(b.cursors('peer:h_aaaaaaaa')[0].seq, 250);
  b.db.prepare("UPDATE bus_cursors SET seq = 0 WHERE consumer = 'peer:h_aaaaaaaa'").run();
  let inserted = 0;
  for (;;) { const r = await p.pullOnce(); inserted += r.inserted; if (r.items === 0) break; }
  assert.equal(inserted, 0);
  assert.equal(b.countRows(), 250);
  assert.equal(p.stats().duplicates, 250);
});

test('missing or wrong tokens get 401 and change nothing; the server binds 127.0.0.1 only', async () => {
  const a = bus('h_aaaaaaaa'); const b = bus('h_bbbbbbbb');
  pub(a, 5);
  const s = await server(a);
  assert.equal(new URL(s.url).hostname, '127.0.0.1');
  const before = [a.countRows(), b.countRows()];
  const none = await fetch(`${s.url}/outbox?after=0`);
  assert.equal(none.status, 401);
  assert.deepEqual(await none.json(), { code: 'BUS_UNAUTHORIZED' });
  const wrong = await fetch(`${s.url}/outbox?after=0`, { headers: { authorization: 'Bearer nope' } });
  assert.equal(wrong.status, 401);
  const wrongLen = await fetch(`${s.url}/outbox?after=0`, { headers: { authorization: `Bearer ${TOKEN}x` } });
  assert.equal(wrongLen.status, 401);
  const p = createPuller({ bus: b, url: s.url, token: 'bad', peerOrigin: a.origin, longPollMs: 0 });
  const r = await p.pullOnce();
  assert.equal(r.status, 401);
  assert.deepEqual([a.countRows(), b.countRows()], before);
});

test('no route accepts a push', async () => {
  const a = bus('h_aaaaaaaa');
  const s = await server(a);
  const auth = { authorization: `Bearer ${TOKEN}` };
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const r = await fetch(`${s.url}/outbox`, { method, headers: auth, body: method === 'DELETE' ? undefined : '{}' });
    assert.ok([404, 405].includes(r.status), `${method} ${r.status}`);
  }
  assert.equal((await fetch(`${s.url}/inbox`, { method: 'POST', headers: auth, body: '{}' })).status, 404);
  assert.equal((await fetch(`${s.url}/other`, { headers: auth })).status, 404);
  assert.equal(a.countRows(), 0);
});

test('a long poll returns within 200 ms of a publish', async () => {
  const a = bus('h_aaaaaaaa');
  const s = await server(a);
  const t0 = Date.now();
  const req = fetch(`${s.url}/outbox?after=0&wait=5000`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((r) => r.json());
  await new Promise((r) => setTimeout(r, 300));
  const tPub = Date.now();
  pub(a, 1);
  const body = await req;
  const tGot = Date.now();
  assert.equal(body.items.length, 1);
  assert.ok(tPub - t0 >= 250, 'the poll was held');
  assert.ok(tGot - tPub < 200, `${tGot - tPub} ms`);
});

test('a fault between insert and cursor write leaves neither', async () => {
  const a = bus('h_aaaaaaaa'); const b = bus('h_bbbbbbbb');
  pub(a, 10);
  const s = await server(a);
  const bad = createPuller({ bus: b, url: s.url, token: TOKEN, peerOrigin: a.origin, longPollMs: 0, _failAfterInsert: true });
  const r = await bad.pullOnce();
  assert.ok(r.error);
  assert.equal(b.countRows(), 0);
  assert.deepEqual(b.cursors('peer:h_aaaaaaaa'), []);
  const good = createPuller({ bus: b, url: s.url, token: TOKEN, peerOrigin: a.origin, longPollMs: 0 });
  await good.pullOnce();
  assert.equal(b.countRows(), 10);
});

test('a crash after the insert: one transaction re-pulls nothing; a cursor in its own transaction re-pulls the page', async () => {
  const a = bus('h_aaaaaaaa');
  pub(a, 10);
  const s = await server(a);
  const crash = () => { throw new Error('crash after insert'); };
  for (const [split, rows, rePulled] of [[false, 0, 0], [true, 10, 10]]) {
    const b = bus('h_bbbbbbbb');
    const dying = createPuller({ bus: b, url: s.url, token: TOKEN, peerOrigin: a.origin, longPollMs: 0, _splitCursor: split, _afterInsert: crash });
    assert.ok((await dying.pullOnce()).error);
    assert.equal(b.countRows(), rows, `split ${split}`);
    assert.deepEqual(b.cursors('peer:h_aaaaaaaa'), []);
    const next = createPuller({ bus: b, url: s.url, token: TOKEN, peerOrigin: a.origin, longPollMs: 0, _splitCursor: split });
    while ((await next.pullOnce()).items > 0);
    assert.equal(b.countRows(), 10);
    assert.equal(next.stats().duplicates, rePulled, `split ${split}`);
    assert.equal(b.cursors('peer:h_aaaaaaaa')[0].seq, 10);
  }
});

test('full mesh: B never re-serves rows it ingested from A', async () => {
  const a = bus('h_aaaaaaaa'); const b = bus('h_bbbbbbbb');
  pub(a, 3);
  const own = pub(b, 2);
  const sa = await server(a);
  const sb = await server(b);
  await createPuller({ bus: b, url: sa.url, token: TOKEN, peerOrigin: a.origin, longPollMs: 0 }).pullOnce();
  assert.equal(b.countRows(), 5);
  const r = await fetch(`${sb.url}/outbox?after=0`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const body = await r.json();
  assert.equal(body.origin, 'h_bbbbbbbb');
  assert.deepEqual(body.items.map((e) => e.id), own);
});

/** A fake peer that answers every pull with `body`. */
async function fakePeer(body) {
  const srv = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => { srv.close(() => r()); srv.closeAllConnections(); }));
  return `http://127.0.0.1:${srv.address().port}`;
}
const row = (origin, seq) => ({
  v: 1, id: `${origin}-${seq}-${Math.random()}`, origin, seq, topic: 'team.metrics', kind: 'status',
  from: FROM, scope: { kind: 'none', key: null, owner: null }, ts: Date.now(), corr: null, replyTo: null, hop: 1, ttlMs: null, body: { text: 'x' },
});

test('a peer serving rows of another origin, or answering as another origin, moves nothing', async () => {
  const b = bus('h_bbbbbbbb');
  const cases = [
    { origin: 'h_aaaaaaaa', items: [row('h_cccccccc', 1)], next: 1 },
    { origin: 'h_aaaaaaaa', items: [row('h_bbbbbbbb', 1)], next: 1 },
    { origin: 'h_cccccccc', items: [row('h_aaaaaaaa', 1)], next: 1 },
  ];
  for (const body of cases) {
    const url = await fakePeer(body);
    const p = createPuller({ bus: b, url, token: TOKEN, peerOrigin: 'h_aaaaaaaa', longPollMs: 0 });
    const r = await p.pullOnce();
    assert.equal(r.inserted, 0, `${body.origin} serving ${body.items[0].origin}`);
    assert.equal(b.countRows(), 0);
    assert.deepEqual(b.cursors('peer:h_aaaaaaaa'), []);
  }
  // the local bus still publishes at seq 1 afterwards
  assert.deepEqual([b.publish({ topic: 'team.metrics', kind: 'status', body: { text: 'own' } }, { from: FROM }).seq], [1]);
});

test('a started puller follows new publishes and stops cleanly', async () => {
  const a = bus('h_aaaaaaaa'); const b = bus('h_bbbbbbbb');
  const s = await server(a);
  const p = createPuller({ bus: b, url: s.url, token: TOKEN, peerOrigin: a.origin, longPollMs: 2000 });
  p.start();
  pub(a, 20);
  const until = Date.now() + 3000;
  while (b.countRows() < 20 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  assert.equal(b.countRows(), 20);
  await p.stop();
  assert.equal(p.stats().running, false);
});
