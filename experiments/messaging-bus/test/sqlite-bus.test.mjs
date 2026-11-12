// T-sqlite: BusTransport conformance (emitter and SQLite) plus the SQLite-only persistence cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEmitterBus } from '../lib/emitter-bus.mjs';
import { createSqliteBus } from '../lib/sqlite-bus.mjs';
import { newId } from '../lib/envelope.mjs';
import { renderMailbox } from '../lib/render.mjs';

const LIB = fileURLToPath(new URL('../lib/', import.meta.url));
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'bus-sqlite-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const FROM = { kind: 'system', id: 'test', sub: null };
const pub = (bus, topic = 'run.r1.siblings', text = 'x', from = FROM) => bus.publish({ topic, kind: 'note', body: { text } }, { from });
const foreign = (origin, seq, topic = 'run.r1.siblings', text = 'f') => ({
  v: 1, id: newId(), origin, seq, topic, kind: 'note', from: { kind: 'system', id: 'peer', sub: null },
  scope: { kind: 'none', key: null, owner: null }, ts: Date.now(), corr: null, replyTo: null, hop: 1, ttlMs: null, body: { text },
});
const ids = (envs) => envs.map((e) => e.id);
const renderAll = (envs) => ({ text: envs.length ? 'x' : '', shown: envs.length, more: 0 });
const renderN = (n) => (envs) => ({ text: 'x', shown: Math.min(n, envs.length), more: Math.max(0, envs.length - n) });

const makers = {
  emitter: () => createEmitterBus({ origin: 'h_00000001' }),
  sqlite: () => createSqliteBus({ path: join(tmp(), 'bus.db'), origin: 'h_00000001' }),
};

for (const [name, make] of Object.entries(makers)) {
  test(`${name}: publish → read in seq order; ack moves forward only`, () => {
    const bus = make();
    const a = pub(bus, 'run.r1.siblings', 'a');
    const b = pub(bus, 'run.r1.siblings', 'b');
    const c = pub(bus, 'run.r1.siblings', 'c');
    assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3]);
    assert.equal(a.duplicate, false);
    assert.equal(a.origin, 'h_00000001');
    assert.deepEqual(ids(bus.read('p:s:main', ['run.r1.siblings'])), [a.id, b.id, c.id]);
    bus.ack('p:s:main', { origin: a.origin, seq: 2 });
    assert.deepEqual(ids(bus.read('p:s:main', ['run.r1.siblings'])), [c.id]);
    bus.ack('p:s:main', { origin: a.origin, seq: 1 });
    assert.deepEqual(ids(bus.read('p:s:main', ['run.r1.siblings'])), [c.id]);
    const env = bus.read('p:s:main', ['run.r1.siblings'])[0];
    assert.deepEqual(env.from, FROM);
    assert.equal(env.seq, 3);
    bus.close();
  });

  test(`${name}: the trailing wildcard matches the prefix only; consumers are independent`, () => {
    const bus = make();
    const a = pub(bus, 'run.r1.step.a');
    pub(bus, 'run.r10.x');
    const c = pub(bus, 'run.r1.siblings');
    assert.deepEqual(ids(bus.read('p:s:main', ['run.r1.*'])), [a.id, c.id]);
    bus.ack('p:s:main', { origin: a.origin, seq: 3 });
    assert.deepEqual(ids(bus.read('p:s:main', ['run.r1.*'])), []);
    assert.deepEqual(ids(bus.read('p:s:b', ['run.r1.*'])), [a.id, c.id]);
    bus.close();
  });

  test(`${name}: readRenderAck acks only the shown prefix`, () => {
    const bus = make();
    bus.ingest([foreign('h_x', 1), foreign('h_x', 2)]);
    pub(bus); pub(bus); pub(bus);
    const all = bus.read('p:s:main', ['run.r1.siblings']);
    assert.equal(all.length, 5);
    assert.deepEqual(all.map((e) => e.origin), ['h_00000001', 'h_00000001', 'h_00000001', 'h_x', 'h_x']);
    const first = bus.readRenderAck('p:s:main', ['run.r1.siblings'], { render: renderN(3) });
    assert.deepEqual(ids(first.shown), ids(all.slice(0, 3)));
    const second = bus.readRenderAck('p:s:main', ['run.r1.siblings'], { render: renderAll });
    assert.deepEqual(ids(second.shown), ids(all.slice(3)));
    const third = bus.readRenderAck('p:s:main', ['run.r1.siblings'], { render: renderAll });
    assert.deepEqual(third.shown, []);
    const cur = Object.fromEntries(bus.cursors('p:s:main').map((c) => [c.origin, c.seq]));
    assert.equal(cur.h_00000001, 3);
    assert.equal(cur.h_x, 2);
    // the real renderer with a tight budget also never loses a row
    const bus2 = make();
    const published = [];
    for (let i = 0; i < 10; i++) published.push(pub(bus2, 'run.r1.siblings', 'y'.repeat(200)).id);
    const seen = [];
    for (let i = 0; i < 20; i++) {
      const r = bus2.readRenderAck('p:s:main', ['run.r1.siblings'], { render: (e, m) => renderMailbox(e, { maxChars: 1000, ...m }) });
      seen.push(...ids(r.shown));
    }
    assert.deepEqual(seen, published);
    bus.close(); bus2.close();
  });

  test(`${name}: limit bounds the raw read and reports limitHit`, () => {
    const bus = make();
    for (let i = 0; i < 5; i++) pub(bus);
    let meta;
    const r = bus.readRenderAck('p:s:main', ['run.r1.siblings'], { limit: 3, render: (e, m) => { meta = m; return renderAll(e); } });
    assert.equal(r.shown.length, 3);
    assert.equal(meta.limitHit, true);
    assert.equal(bus.readRenderAck('p:s:main', ['run.r1.siblings'], { limit: 3, render: renderAll }).shown.length, 2);
    bus.close();
  });

  test(`${name}: self rows are never returned and never pin a cursor`, () => {
    const bus = make();
    const selfA = { kind: 'agent', id: 's', sub: 'a' };
    const s1 = pub(bus, 'run.r.team.n', 'mine', selfA);
    const o1 = pub(bus, 'run.r.team.n', 'other');
    const o2 = pub(bus, 'run.r.team.n', 'other2');
    const s2 = pub(bus, 'run.r.team.n', 'mine2', selfA);
    const selfOf = { sessionId: 's', agentKey: 'a' };
    assert.deepEqual(ids(bus.read('p:s:a', ['run.r.team.n'], { self: selfOf })), [o1.id, o2.id]);
    assert.deepEqual(ids(bus.read('p:s:b', ['run.r.team.n'], { self: { sessionId: 's', agentKey: 'b' } })), [s1.id, o1.id, o2.id, s2.id]);
    // shows o1 only: the cursor passes s1 and o1, not o2 nor the self row after it
    const r = bus.readRenderAck('p:s:a', ['run.r.team.n'], { self: selfOf, render: renderN(1) });
    assert.deepEqual(ids(r.shown), [o1.id]);
    assert.equal(bus.cursors('p:s:a').find((c) => c.origin === o1.origin).seq, o1.seq);
    const r2 = bus.readRenderAck('p:s:a', ['run.r.team.n'], { self: selfOf, render: renderAll });
    assert.deepEqual(ids(r2.shown), [o2.id]);
    assert.equal(bus.cursors('p:s:a').find((c) => c.origin === o1.origin).seq, s2.seq);
    bus.close();
  });

  test(`${name}: a new consumer starts at the start mark`, () => {
    const bus = make();
    pub(bus); pub(bus); pub(bus);
    const m = bus.mark('m');
    assert.deepEqual(m.cursors, [{ origin: 'h_00000001', seq: 3 }]);
    const d = pub(bus); const e = pub(bus);
    const r = bus.readRenderAck('p:s:new', ['run.r1.siblings'], { startMark: 'm', render: renderAll });
    assert.deepEqual(ids(r.shown), [d.id, e.id]);
    assert.equal(r.noMark, false);
    const none = bus.readRenderAck('p:s:fresh', ['run.r1.siblings'], { render: renderAll });
    assert.equal(none.shown.length, 5);
    assert.equal(none.noMark, true);
    const missing = bus.readRenderAck('p:s:fresh2', ['run.r1.siblings'], { startMark: 'nope', render: renderAll });
    assert.equal(missing.shown.length, 5);
    assert.equal(missing.noMark, true);
    // an existing consumer ignores the mark
    bus.ack('p:s:old', { origin: 'h_00000001', seq: 1 });
    const old = bus.readRenderAck('p:s:old', ['run.r1.siblings'], { startMark: 'm', render: renderAll });
    assert.equal(old.shown.length, 4);
    assert.equal(old.noMark, false);
    // a second mark with the same name keeps the first snapshot
    assert.deepEqual(bus.mark('m').cursors, [{ origin: 'h_00000001', seq: 3 }]);
    // an empty mark exists too: everything after it is read
    const bus2 = make();
    bus2.mark('empty');
    const f = pub(bus2);
    const r2 = bus2.readRenderAck('p:s:x', ['run.r1.siblings'], { startMark: 'empty', render: renderAll });
    assert.deepEqual([ids(r2.shown), r2.noMark], [[f.id], false]);
    bus.close(); bus2.close();
  });

  test(`${name}: lowercase collisions are refused`, () => {
    const bus = make();
    assert.deepEqual(bus.claimAgentKey('s1', 'a7', 'A7'), { ok: true });
    assert.deepEqual(bus.claimAgentKey('s1', 'a7', 'A7'), { ok: true });
    const r = bus.claimAgentKey('s1', 'a7', 'a7');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BUS_BAD_CONSUMER');
    assert.deepEqual(bus.claimAgentKey('s2', 'a7', 'a7'), { ok: true });
    pub(bus);
    assert.throws(
      () => bus.readRenderAck('p:s1:a7', ['run.r1.siblings'], { claim: { sessionKey: 's1', topicKey: 'a7', agentId: 'a7' }, render: renderAll }),
      (e) => e.code === 'BUS_BAD_CONSUMER',
    );
    assert.deepEqual(bus.cursors('p:s1:a7'), []);
    bus.close();
  });

  test(`${name}: outboxAfter never serves a foreign row; replay leaves the cursor alone`, () => {
    const bus = make();
    const a = pub(bus); const b = pub(bus); const c = pub(bus);
    bus.ingest([foreign('h_x', 1)]);
    assert.deepEqual(ids(bus.outboxAfter(0, 100)), [a.id, b.id, c.id]);
    assert.deepEqual(ids(bus.outboxAfter(2, 100)), [c.id]);
    bus.readRenderAck('p:s:main', ['run.r1.siblings'], { render: renderAll });
    // the read order is (origin, seq): h_00000001 a b c, then h_x — the last two acked are c and the foreign row
    const order = ids(bus.read('p:s:other', ['run.r1.siblings']));
    assert.deepEqual(ids(bus.replay('p:s:main', ['run.r1.siblings'], 2)), order.slice(-2));
    const before = bus.cursors('p:s:main');
    bus.replay('p:s:main', ['run.r1.siblings'], 2);
    assert.deepEqual(bus.cursors('p:s:main'), before);
    assert.equal(bus.read('p:s:main', ['run.r1.siblings']).length, 0);
    bus.close();
  });

  test(`${name}: a closed bus refuses calls`, () => {
    const bus = make();
    bus.close();
    assert.throws(() => pub(bus), (e) => e.code === 'BUS_CLOSED');
  });
}

test('sqlite: duplicates, rejected drafts and reopen keep rows, cursors and the next seq', () => {
  const path = join(tmp(), 'bus.db');
  let bus = createSqliteBus({ path, origin: 'h_00000001' });
  const id = newId();
  const a = bus.publish({ id, topic: 'run.r1.siblings', kind: 'note', body: { text: 'a' } }, { from: FROM });
  const again = bus.publish({ id, topic: 'run.r1.siblings', kind: 'note', body: { text: 'a' } }, { from: FROM });
  assert.deepEqual([again.duplicate, again.seq], [true, a.seq]);
  assert.equal(bus.countRows(), 1);
  assert.throws(() => bus.publish({ topic: 'Bad..topic', kind: 'note', body: { text: 'a' } }, { from: FROM }), (e) => e.code === 'BUS_BAD_TOPIC');
  assert.throws(() => bus.publish({ topic: 'run.r1.x', kind: 'note', body: { text: 'z'.repeat(4001) } }, { from: FROM }), (e) => e.code === 'BUS_TOO_LARGE');
  assert.equal(bus.countRows(), 1);
  const b = pub(bus);
  assert.equal(b.seq, 2);
  bus.ack('p:s:main', { origin: 'h_00000001', seq: 1 });
  bus.close();
  bus = createSqliteBus({ path });
  assert.equal(bus.origin, 'h_00000001');
  assert.equal(bus.countRows(), 2);
  assert.deepEqual(ids(bus.read('p:s:main', ['run.r1.siblings'])), [b.id]);
  assert.equal(pub(bus).seq, 3);
  bus.close();
});

test('sqlite: ingest refuses a row of the local origin, and a seq collision throws instead of reading as a duplicate', () => {
  const bus = createSqliteBus({ path: join(tmp(), 'bus.db'), origin: 'h_00000001' });
  pub(bus);
  assert.throws(() => bus.ingest([foreign('h_x', 1), foreign('h_00000001', 2)]), (e) => e.code === 'BUS_BAD_ENVELOPE');
  assert.equal(bus.countRows(), 1);
  const after = [pub(bus), pub(bus)];
  assert.deepEqual(after.map((r) => [r.duplicate, r.seq]), [[false, 2], [false, 3]]);
  // a row that takes next_seq behind ingest's back (only possible by writing the table directly)
  bus.db.prepare(`INSERT INTO bus_messages (id, origin, seq, topic, kind, env_json, created_at)
    VALUES ('forged', 'h_00000001', 4, 'run.r1.siblings', 'note', '{}', 0)`).run();
  assert.throws(() => pub(bus), (e) => e.code === 'BUS_BAD_ENVELOPE' && /already taken/.test(e.message));
  assert.equal(bus.countRows(), 4);
  bus.close();
});

test('sqlite: a throw after rendering rolls back cursor, seed and claim', () => {
  const bus = createSqliteBus({ path: join(tmp(), 'bus.db'), origin: 'h_00000001' });
  pub(bus); bus.mark('m'); pub(bus);
  bus._faultAfterRender = true;
  assert.throws(() => bus.readRenderAck('p:s:A7', ['run.r1.siblings'], {
    startMark: 'm', claim: { sessionKey: 's', topicKey: 'a7', agentId: 'A7' }, render: renderAll,
  }), /fault/);
  assert.deepEqual(bus.cursors('p:s:A7'), []);
  bus._faultAfterRender = false;
  // the claim was rolled back too: a different id may now take the key
  assert.deepEqual(bus.claimAgentKey('s', 'a7', 'a7'), { ok: true });
  bus.close();
});

test('sqlite: two processes publishing to one file get distinct, gap-free seqs', async () => {
  const path = join(tmp(), 'bus.db');
  createSqliteBus({ path, origin: 'h_00000001' }).close();
  const script = `import { createSqliteBus } from ${JSON.stringify(join(LIB, 'sqlite-bus.mjs'))};
    const bus = createSqliteBus({ path: process.argv[1] });
    for (let i = 0; i < 300; i++) bus.publish({ topic: 'run.r1.x', kind: 'note', body: { text: 'w' + process.argv[2] } }, { from: { kind: 'system', id: 'w', sub: null } });
    bus.close();`;
  const run = (n) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', script, path, String(n)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
  await Promise.all([run(1), run(2)]);
  const bus = createSqliteBus({ path });
  const rows = bus.outboxAfter(0, 1000);
  assert.equal(rows.length, 600);
  assert.deepEqual(rows.map((r) => r.seq), Array.from({ length: 600 }, (_, i) => i + 1));
  bus.close();
});

test('sqlite: wake fires for another process and correctness holds without it', async () => {
  const path = join(tmp(), 'bus.db');
  const bus = createSqliteBus({ path, origin: 'h_00000001' });
  const fired = new Promise((resolve) => {
    const stop = bus.wake('p:s:main', () => { stop(); resolve(Date.now()); });
  });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { createSqliteBus } from ${JSON.stringify(join(LIB, 'sqlite-bus.mjs'))};
    const b = createSqliteBus({ path: ${JSON.stringify(path)} });
    b.publish({ topic: 'run.r1.x', kind: 'note', body: { text: 'w' } }, { from: { kind: 'system', id: 'w', sub: null } }); b.close();`]);
  assert.equal(r.status, 0, String(r.stderr));
  const at = await fired;
  assert.ok(at - t0 < 1000 + 500, `wake took ${at - t0} ms`);
  // no wake at all: a plain read still sees the row
  assert.equal(bus.read('p:s:main', ['run.r1.*']).length, 1);
  bus.close();
});
