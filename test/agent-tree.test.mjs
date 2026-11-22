// test/agent-tree.test.mjs — the node idle limit's busy check (src/core/agent-tree.mjs): ps CPU time parsing,
// the agent's descendants and process group, the CPU they used between two samples, and the spawn-pid context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpuSeconds, psRow, descendantCpu, cpuDelta, treeBusy, watchSpawns, noteSpawned } from '../src/core/agent-tree.mjs';

test('cpuSeconds reads macOS and procps time columns', () => {
  assert.equal(cpuSeconds('0:01.25'), 1.25);          // macOS m:ss.cc
  assert.equal(cpuSeconds('12:03.50'), 723.5);
  assert.equal(cpuSeconds('1:02:03.00'), 3723);       // macOS h:mm:ss.cc
  assert.equal(cpuSeconds('00:00:07'), 7);            // procps hh:mm:ss
  assert.equal(cpuSeconds('2-01:00:00'), 2 * 86400 + 3600);
  assert.ok(Number.isNaN(cpuSeconds('')));
  assert.ok(Number.isNaN(cpuSeconds('n/a')));
});

test('psRow reads pid, ppid, pgid, CPU time and a command with spaces', () => {
  assert.deepEqual(psRow('  4242  4100  4242   0:01.25 /Applications/My App/bin/node'), [4242, 4100, 4242, 1.25, '/Applications/My App/bin/node']);
  assert.equal(psRow(''), null);
  assert.equal(psRow('PID PPID PGID TIME COMM'), null);
});

test('descendantCpu walks the whole tree below the root, never the root or a stranger', () => {
  const rows = [[10, 1, 10, 5, 'claude'], [11, 10, 10, 1, 'bash'], [12, 11, 10, 30, 'node'], [13, 10, 10, 0.5, 'node'], [99, 1, 99, 400, 'x']];
  assert.deepEqual([...descendantCpu(10, rows)].sort((a, b) => a[0] - b[0]), [[11, 1], [12, 30], [13, 0.5]]);
  assert.equal(descendantCpu(42, rows).size, 0);
});

test('descendantCpu keeps a background job its shell left behind (reparented to init, still in the agent group)', () => {
  const rows = [[10, 1, 10, 5, 'claude'], [20, 1, 10, 90, 'npm'], [21, 20, 10, 40, 'node'], [30, 1, 30, 7, 'other']];
  assert.deepEqual([...descendantCpu(10, rows)].sort((a, b) => a[0] - b[0]), [[20, 90], [21, 40]]);
});

test('descendantCpu never counts a group the spawn does not lead (the server and its siblings)', () => {
  const rows = [[5, 1, 5, 900, 'node'], [10, 5, 5, 1, 'claude'], [11, 10, 5, 2, 'bash'], [12, 5, 5, 300, 'node']];
  assert.deepEqual([...descendantCpu(10, rows)], [[11, 2]]);
});

test('descendantCpu under agent isolation leaves out sudo and the agent CLI below it', () => {
  // sudo (use_pty: a monitor sudo, then the CLI in its own session) → the CLI's jobs.
  const rows = [[10, 1, 10, 0.1, '/usr/bin/sudo'], [11, 10, 11, 0.2, 'sudo'], [12, 11, 12, 300, 'claude'],
    [13, 12, 12, 4, 'bash'], [14, 1, 12, 50, 'npm']];
  assert.deepEqual([...descendantCpu(10, rows)].sort((a, b) => a[0] - b[0]), [[13, 4], [14, 50]]);
});

test('cpuDelta counts what each process added, a new one whole, an exited one not at all', () => {
  const before = new Map([[11, 1], [12, 30], [14, 50]]);
  const after = new Map([[11, 1.5], [12, 30], [15, 3]]);   // 14 exited, 15 is new
  assert.equal(cpuDelta(before, after), 3.5);
});

test('treeBusy: a working tree is busy, an idle one or an empty one is not, an abort answers false', async () => {
  const seq = (...samples) => { let i = 0; return async () => samples[Math.min(i++, samples.length - 1)]; };
  const idle = [[10, 1, 10, 9, 'claude'], [11, 10, 10, 1, 'bash']];
  const working = [[10, 1, 10, 9, 'claude'], [11, 10, 10, 4, 'bash'], [12, 11, 10, 2, 'node']];
  // The probe's timer is unref'd (it never holds a CLI open); in a run the agent's child keeps the loop alive, here
  // this interval does, or node:test can see an empty loop while a probe is still pending.
  const alive = setInterval(() => {}, 1000);
  try {
    assert.equal(await treeBusy(10, { probeMs: 1, rows: seq(idle, working) }), process.platform !== 'win32');
    assert.equal(await treeBusy(10, { probeMs: 1, rows: seq(idle, idle) }), false);
    assert.equal(await treeBusy(10, { probeMs: 1, rows: seq(idle.slice(0, 1), working) }), false, 'no descendants: nothing to wait on');
    assert.equal(await treeBusy(null, { probeMs: 1, rows: seq(idle, working) }), false);
    const ac = new AbortController();
    const p = treeBusy(10, { probeMs: 60_000, signal: ac.signal, rows: seq(idle, working) });
    setTimeout(() => ac.abort(), 5);
    assert.equal(await p, false);
  } finally { clearInterval(alive); }
});

test('noteSpawned reaches the context that started the spawn, and only that one', async () => {
  const seen = [];
  await watchSpawns((pid) => seen.push(pid), async () => { await Promise.resolve(); noteSpawned(123); });
  noteSpawned(456);                                     // outside any context: dropped
  await watchSpawns(() => { throw new Error('listener'); }, async () => noteSpawned(789));   // a throwing listener never breaks a spawn
  assert.deepEqual(seen, [123]);
});
