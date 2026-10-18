// test/ask-refs.test.mjs — src/core/ask/refs.mjs, the batch resolver behind POST /api/ask/refs/resolve: worca refs
// read fresh, forge refs grouped (one call per repo / organization / PR), cached with two TTLs, one lookup in flight
// per key, one provider cap for every batch, a deadline, and every failure an { ok:false } — fake providers, a fake clock.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRefResolver, OK_TTL_MS, MISS_TTL_MS, CACHE_MAX, PROVIDER_CAP, REFS_DEADLINE_MS } from '../src/core/ask/refs.mjs';
import { checkRows } from './helpers/rows.mjs';

function rig(over = {}) {
  let t = 0;
  const calls = [];
  const resolver = createRefResolver({
    now: () => t,
    github: async (repo, numbers) => { calls.push(['gh', repo, numbers]); return new Map([[7, { kind: 'pr', title: 'Fix', state: 'draft', extra: 'x' }], [8, { kind: 'issue', title: 'Bug', state: 'closed' }]]); },
    azurePr: async (r) => { calls.push(['adopr', r]); return { kind: 'pr', title: 'ADO', state: 'merged' }; },
    workItems: async (org, ids) => { calls.push(['adowi', org, ids]); return new Map([[123, { kind: 'workitem', title: 'WI', state: 'Active', type: 'Bug' }]]); },
    ...over,
  });
  return { resolver, calls, advance: (ms) => { t += ms; } };
}

test('createRefResolver: shapes, grouping, caching and failures', async () => {
  await checkRows([
    { name: 'one call per repo / org / PR; answers shaped; unknown numbers and junk keys', run: async () => {
      const { resolver, calls } = rig();
      const out = await resolver.resolve(['gh:o/r#7', 'gh:O/R#8', 'gh:o/r#9', 'adopr:acme/My%20Shop#5', 'adowi:acme#123', 'adowi:acme#124', 'nope', 'gh:o/r#0']);
      assert.deepEqual(calls, [['gh', 'o/r', [7, 8, 9]], ['adopr', { org: 'acme', project: 'My Shop', number: 5 }], ['adowi', 'acme', [123, 124]]]);
      assert.deepEqual(out, {
        'gh:o/r#7': { ok: true, kind: 'pr', title: 'Fix', state: 'draft' },
        'gh:O/R#8': { ok: true, kind: 'issue', title: 'Bug', state: 'closed' },
        'gh:o/r#9': { ok: false },
        'adopr:acme/My%20Shop#5': { ok: true, kind: 'pr', title: 'ADO', state: 'merged' },
        'adowi:acme#123': { ok: true, kind: 'workitem', title: 'WI', state: 'Active', type: 'Bug' },
        'adowi:acme#124': { ok: false },
      }, 'an unparseable key is left out, never echoed');
    } },
    { name: 'answers live OK_TTL_MS, misses MISS_TTL_MS; a second batch inside the TTL calls nobody', run: async () => {
      const { resolver, calls, advance } = rig();
      await resolver.resolve(['gh:o/r#7', 'gh:o/r#9']);
      await resolver.resolve(['gh:o/r#7', 'gh:o/r#9']);
      assert.equal(calls.length, 1);
      advance(MISS_TTL_MS);
      await resolver.resolve(['gh:o/r#7', 'gh:o/r#9']);
      assert.deepEqual(calls.at(-1), ['gh', 'o/r', [9]], 'only the miss is asked again');
      advance(OK_TTL_MS - MISS_TTL_MS);
      await resolver.resolve(['gh:o/r#7']);
      assert.deepEqual(calls.at(-1), ['gh', 'o/r', [7]]);
    } },
    { name: 'one lookup in flight per key: two batches at once share it', run: async () => {
      const releases = [];
      const { resolver, calls } = rig({ github: async (repo, n) => { calls.push(['gh', repo, n]); await new Promise((r) => { releases.push(r); }); return new Map([[7, { kind: 'pr', title: 'Fix', state: 'open' }]]); } });
      const a = resolver.resolve(['gh:o/r#7']);
      const b = resolver.resolve(['gh:o/r#7']);
      assert.equal(calls.length, 1, 'the second batch waits on the first one\'s lookup');
      for (const release of releases) release();
      assert.deepEqual([await a, await b].map((x) => x['gh:o/r#7'].state), ['open', 'open']);
    } },
    { name: 'a slow lookup in flight is never duplicated, however long it takes', run: async () => {
      const releases = [];
      const { resolver, calls, advance } = rig({ github: async (repo, n) => { calls.push(['gh', repo, n]); await new Promise((r) => { releases.push(r); }); return new Map([[7, { kind: 'pr', title: 'Fix', state: 'open' }]]); } });
      const a = resolver.resolve(['gh:o/r#7']);
      advance(OK_TTL_MS + MISS_TTL_MS);
      const b = resolver.resolve(['gh:o/r#7']);
      assert.equal(calls.length, 1, 'the pending entry outlives the TTL');
      for (const release of releases) release();
      assert.deepEqual([await a, await b].map((x) => x['gh:o/r#7'].state), ['open', 'open']);
      advance(OK_TTL_MS - 1);
      await resolver.resolve(['gh:o/r#7']);
      assert.equal(calls.length, 1, 'the TTL counts from the answer');
    } },
    { name: 'PROVIDER_CAP is one ceiling for every batch at once, not a cap per batch', run: async () => {
      const releases = [];
      let running = 0, most = 0;
      const { resolver, calls } = rig({ github: async (repo, n) => {
        calls.push(['gh', repo, n]);
        most = Math.max(most, ++running);
        await new Promise((r) => { releases.push(r); });
        running--;
        return new Map([[1, { kind: 'issue', title: repo, state: 'open' }]]);
      } });
      const a = resolver.resolve(['gh:a/a#1', 'gh:b/b#1', 'gh:c/c#1']);
      const b = resolver.resolve(['gh:d/d#1', 'gh:e/e#1', 'gh:f/f#1']);
      await new Promise((r) => setImmediate(r));
      assert.equal(calls.length, PROVIDER_CAP, 'two batches of three repos share the slots');
      while (releases.length) { releases.shift()(); await new Promise((r) => setImmediate(r)); }
      assert.equal(calls.length, 6, 'the queued repos run as slots free up');
      assert.equal(most, PROVIDER_CAP);
      const out = { ...(await a), ...(await b) };
      assert.deepEqual(Object.values(out).map((x) => x.ok), [true, true, true, true, true, true]);
    } },
    { name: 'the deadline answers every still-pending ref { ok:false }; the lookup goes on and fills the cache', run: async () => {
      let release;
      const { resolver, calls } = rig({ github: async (repo, n) => { calls.push(['gh', repo, n]); await new Promise((r) => { release = r; }); return new Map([[7, { kind: 'pr', title: 'Late', state: 'open' }]]); } });
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const pending = resolver.resolve(['gh:o/r#7', 'run:1a2b3c4d'], { run: () => ({ id: '1a2b3c4d', title: 'Plan', status: 'done' }) });
        mock.timers.tick(REFS_DEADLINE_MS - 1);
        let settled = false;
        void pending.then(() => { settled = true; });
        await new Promise((r) => setImmediate(r));
        assert.equal(settled, false, 'nothing answers before the deadline');
        mock.timers.tick(1);
        await new Promise((r) => setImmediate(r));
        assert.equal(settled, true, 'the batch answers at the deadline');
        const out = await pending;
        assert.deepEqual(out['gh:o/r#7'], { ok: false });
        assert.equal(out['run:1a2b3c4d'].title, 'Plan', 'refs that answered keep their answer');
      } finally { mock.timers.reset(); }
      release();
      await new Promise((r) => setImmediate(r));
      assert.deepEqual((await resolver.resolve(['gh:o/r#7']))['gh:o/r#7'], { ok: true, kind: 'pr', title: 'Late', state: 'open' }, 'the late answer was cached');
      assert.equal(calls.length, 1);
    } },
    { name: 'a provider that throws, answers junk or is missing is a miss, never an error', run: async () => {
      const { resolver } = rig({ github: async () => { throw new Error('gh exploded GH_TOKEN=secret'); }, azurePr: async () => ({ kind: 'pr', title: 'x', state: 'weird' }), workItems: null });
      const out = await resolver.resolve(['gh:o/r#7', 'adopr:acme/Shop#5', 'adowi:acme#1']);
      assert.deepEqual(out, { 'gh:o/r#7': { ok: false }, 'adopr:acme/Shop#5': { ok: false }, 'adowi:acme#1': { ok: false } });
    } },
    { name: 'worca refs come from the request\'s own lookups, uncached; external:false asks no forge', run: async () => {
      const { resolver, calls } = rig();
      let n = 0;
      const UUID = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';
      const runs = { '1a2b3c4d': () => ({ id: '1a2b3c4d', runId: null, title: `Plan ${++n}`, status: 'running', home: 'k-1234abcd' }),
        [UUID]: () => ({ id: null, runId: UUID, title: 'Starting up', status: 'starting', home: null }), cafebabe: () => ({ title: 'no id at all' }) };
      const local = { run: (id) => (runs[id] ? runs[id]() : null),
        chat: (id) => (id === 'ask_00000001' ? { title: 'Notes' } : null), external: false };
      const keys = ['run:1a2b3c4d', 'run:deadbeef', 'chat:ask_00000001', 'chat:ask_00000002', 'gh:o/r#7'];
      const first = await resolver.resolve(keys, local);
      const second = await resolver.resolve(keys, local);
      assert.deepEqual(first['run:1a2b3c4d'], { ok: true, kind: 'run', id: '1a2b3c4d', runId: null, title: 'Plan 1', status: 'running', pauseReason: null, home: 'k-1234abcd' });
      const young = await resolver.resolve([`run:${UUID}`, 'run:cafebabe'], local);
      assert.deepEqual(young[`run:${UUID}`], { ok: true, kind: 'run', id: null, runId: UUID, title: 'Starting up', status: 'starting', pauseReason: null, home: null }, 'a run with no History row yet answers by its app run id');
      assert.deepEqual(young['run:cafebabe'], { ok: false }, 'an answer naming no run is a miss');
      assert.equal(second['run:1a2b3c4d'].title, 'Plan 2', 'runs are read on every call');
      assert.deepEqual([first['run:deadbeef'], first['chat:ask_00000001'], first['chat:ask_00000002'], first['gh:o/r#7']],
        [{ ok: false }, { ok: true, kind: 'chat', title: 'Notes' }, { ok: false }, { ok: false }]);
      assert.equal(calls.length, 0, 'external:false never reaches GitHub or Azure');
      const thrown = await resolver.resolve(['run:1a2b3c4d'], { run: () => { throw new Error('db gone'); } });
      assert.deepEqual(thrown['run:1a2b3c4d'], { ok: false });
    } },
    { name: 'the cache keeps at most CACHE_MAX keys, the oldest out first', run: async () => {
      const { resolver } = rig({ github: async (repo, numbers) => new Map(numbers.map((n) => [n, { kind: 'issue', title: `#${n}`, state: 'open' }])) });
      await resolver.resolve(Array.from({ length: CACHE_MAX + 5 }, (_, i) => `gh:o/r#${i + 1}`));
      assert.equal(resolver.size, CACHE_MAX);
    } },
  ]);
});
