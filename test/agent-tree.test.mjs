// test/agent-tree.test.mjs — the node idle limit's busy check (src/core/engines/agent-tree.mjs): ps CPU time parsing,
// the agent's descendants, the CPU they used between two samples, and the spawn-pid context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpuSeconds, descendantCpu, cpuDelta, treeBusy, watchSpawns, noteSpawned } from '../src/core/engines/agent-tree.mjs';

test('cpuSeconds reads macOS and procps time columns', () => {
  assert.equal(cpuSeconds('0:01.25'), 1.25);          // macOS m:ss.cc
  assert.equal(cpuSeconds('12:03.50'), 723.5);
  assert.equal(cpuSeconds('1:02:03.00'), 3723);       // macOS h:mm:ss.cc
  assert.equal(cpuSeconds('00:00:07'), 7);            // procps hh:mm:ss
  assert.equal(cpuSeconds('2-01:00:00'), 2 * 86400 + 3600);
  assert.ok(Number.isNaN(cpuSeconds('')));
  assert.ok(Number.isNaN(cpuSeconds('n/a')));
});

test('descendantCpu walks the whole tree below the root, never the root or a stranger', () => {
  const rows = [[10, 1, 5], [11, 10, 1], [12, 11, 30], [13, 10, 0.5], [99, 1, 400]];
  assert.deepEqual([...descendantCpu(10, rows)].sort((a, b) => a[0] - b[0]), [[11, 1], [12, 30], [13, 0.5]]);
  assert.equal(descendantCpu(42, rows).size, 0);
});

test('cpuDelta counts what each process added, a new one whole, an exited one not at all', () => {
  const before = new Map([[11, 1], [12, 30], [14, 50]]);
  const after = new Map([[11, 1.5], [12, 30], [15, 3]]);   // 14 exited, 15 is new
  assert.equal(cpuDelta(before, after), 3.5);
});

test('treeBusy: a working tree is busy, an idle one or an empty one is not, an abort answers false', async () => {
  const seq = (...samples) => { let i = 0; return async () => samples[Math.min(i++, samples.length - 1)]; };
  const idle = [[11, 10, 1]];
  const working = [[11, 10, 4], [12, 11, 2]];
  assert.equal(await treeBusy(10, { probeMs: 1, rows: seq(idle, working) }), process.platform !== 'win32');
  assert.equal(await treeBusy(10, { probeMs: 1, rows: seq(idle, idle) }), false);
  assert.equal(await treeBusy(10, { probeMs: 1, rows: seq([], working) }), false, 'no descendants: nothing to wait on');
  assert.equal(await treeBusy(null, { probeMs: 1, rows: seq(idle, working) }), false);
  const ac = new AbortController();
  const p = treeBusy(10, { probeMs: 60_000, signal: ac.signal, rows: seq(idle, working) });
  setTimeout(() => ac.abort(), 5);
  assert.equal(await p, false);
});

test('noteSpawned reaches the context that started the spawn, and only that one', async () => {
  const seen = [];
  await watchSpawns((pid) => seen.push(pid), async () => { await Promise.resolve(); noteSpawned(123); });
  noteSpawned(456);                                     // outside any context: dropped
  await watchSpawns(() => { throw new Error('listener'); }, async () => noteSpawned(789));   // a throwing listener never breaks a spawn
  assert.deepEqual(seen, [123]);
});
