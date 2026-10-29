// test/workspace-remove-impact.test.mjs
// memberRemoveImpact: the re-scan worca recommends when a member leaves (none | partial | full) and
// its reason — pure, over plain map / overrides objects (no DB, no git, no model). `now` is pinned on
// every call: the stale-map rule (R4) must not depend on the day the suite runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberRemoveImpact, mapCoverage, resynthBlocker, REMOVE_IMPACT_LIMITS, RESCAN_CHOICES } from '../src/core/workspaces.mjs';
import { checkRows } from './helpers/rows.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const RECENT = '2026-10-10T12:00:00Z';
const member = (key, aliases = []) => ({ key, name: key, role: null, aliases, stack: [], coverage: { level: 'rich' } });
let n = 0;
const edge = (from, to, confidence = 'exact') => {
  n += 1;
  return { id: `x_${String(n).padStart(12, '0')}`, from, to, kind: 'http', norm: `GET /r${n}`, display: `GET /r${n}`, confidence, sources: ['static'], evidence: { from: [], to: [] } };
};
const doc = ({ members, edges = [], cycles = [], overview = '', coordination = [], scannedAt = RECENT }) => ({
  map: { version: 1, workspace: { name: 'W' }, scannedAt, runId: 'run00001', members, edges, order: [], cycles, graph: { mode: 'none', file: null, nodes: 0, bridges: 0 } },
  synthesis: { version: 1, overview, roles: {}, coordination, orderNotes: '' },
});
const EMPTY_OV = { version: 1, edges: {}, manual: [] };
const left = (...keys) => keys.map((k) => ({ key: k, name: k }));
const impact = (d, key, opts = {}) => memberRemoveImpact(d, opts.overrides ?? EMPTY_OV, key, { now: NOW, ...opts });

test('the choices and limits are exported', () => {
  assert.deepEqual([...RESCAN_CHOICES], ['none', 'partial', 'full']);
  assert.deepEqual({ ...REMOVE_IMPACT_LIMITS }, { hubEdges: 8, hubPeers: 3, providerFor: 2, staleDays: 30 });
});

test('mapCoverage / resynthBlocker: does the stored map describe exactly these members?', () => {
  const m = doc({ members: [member('a'), member('b')] }).map;
  assert.deepEqual(mapCoverage(m, ['a', 'b']), { missing: [], extra: [] });
  assert.deepEqual(mapCoverage(m, ['a', 'b', 'c']), { missing: ['c'], extra: [] });
  assert.deepEqual(mapCoverage(m, ['a']), { missing: [], extra: ['b'] });
  assert.equal(resynthBlocker(m, ['b', 'a']), null, 'order does not matter');
  assert.match(resynthBlocker(m, ['a', 'b', 'c']), /does not cover/);
  assert.match(resynthBlocker(null, ['a']), /no stored map/);
  assert.match(resynthBlocker({ members: 'x' }, ['a']), /no stored map/);
});

test('memberRemoveImpact: a table of removals', async () => {
  await checkRows([
    { name: 'isolated member, not named in the synthesis → none', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('c')], edges: [edge('a', 'b')] }), 'c', { remaining: left('a', 'b') });
      assert.equal(r.level, 'none');
      assert.equal(r.partialAvailable, true);
      assert.equal(r.reason, 'c had no edges in the map and the overview does not mention it. No re-scan is needed: the pruned map is already complete.');
    } },
    { name: 'one consumer edge → partial', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('c')], edges: [edge('c', 'a')] }), 'c', { remaining: left('a', 'b') });
      assert.equal(r.level, 'partial');
      assert.equal(r.signals.edges, 1);
      assert.deepEqual(r.signals.peers, ['a']);
      assert.equal(r.signals.ageDays, 5);
      assert.match(r.reason, /^c had 1 edge with 1 member \(a\)\. A partial re-scan is recommended/);
    } },
    { name: 'no edges but the overview names it → partial', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('billing')], overview: 'Billing feeds the ledger.' }), 'billing');
      assert.equal(r.level, 'partial');
      assert.equal(r.signals.mentioned, true);
      assert.match(r.reason, /the overview or coordination notes mention it/);
    } },
    { name: 'a coordination note names it by key → partial', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('svc-x')], coordination: ['Deploy svc-x before a.'] }), 'svc-x');
      assert.equal(r.level, 'partial');
    } },
    { name: 'a word inside another word is no mention', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('api')], overview: 'The rapid path.' }), 'api');
      assert.equal(r.level, 'none');
    } },
    { name: 'hub by edges (≥ 8) → full', run: () => {
      const edges = Array.from({ length: 8 }, () => edge('a', 'hub'));
      const r = impact(doc({ members: [member('a'), member('b'), member('hub')], edges }), 'hub');
      assert.equal(r.level, 'full');
      assert.match(r.reason, /^hub had 8 edges with 1 member \(a\)/);
      assert.match(r.reason, /A full re-scan is recommended/);
    } },
    { name: 'hub by peers (≥ 3) → full', run: () => {
      const r = impact(doc({ members: ['a', 'b', 'c', 'hub'].map((k) => member(k)), edges: [edge('hub', 'a'), edge('hub', 'b'), edge('hub', 'c')] }), 'hub');
      assert.equal(r.level, 'full');
      assert.match(r.reason, /3 members \(a, b and c\)/);
    } },
    { name: 'a provider to two members → full', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('lib')], edges: [edge('a', 'lib'), edge('b', 'lib')] }), 'lib');
      assert.equal(r.level, 'full');
      assert.deepEqual(r.signals.consumers, ['a', 'b']);
      assert.match(r.reason, /a and b used it/);
    } },
    { name: 'in a cycle → full', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('c')], edges: [edge('a', 'c'), edge('c', 'a')], cycles: [['a', 'c']] }), 'c');
      assert.equal(r.level, 'full');
      assert.equal(r.signals.inCycle, true);
      assert.match(r.reason, /was in a dependency cycle/);
    } },
    { name: 'alias tie with a remaining member → full, named in the reason (the task\'s example)', run: () => {
      const d = doc({ members: [member('billing-api', ['billing', 'billing-api']), member('orders-svc', ['billing', 'orders-svc']), member('web', ['web'])],
        edges: [edge('web', 'billing-api')] });
      const r = impact(d, 'billing-api', { remaining: left('orders-svc', 'web') });
      assert.equal(r.level, 'full');
      assert.equal(r.partialAvailable, true);
      assert.deepEqual(r.signals.sharedNames, [{ name: 'billing', with: ['orders-svc'] }]);
      assert.equal(r.reason, 'billing-api had 1 edge with 1 member (web) and shared the name `billing` with orders-svc. A full re-scan is recommended so those uses get re-attributed.');
    } },
    { name: 'alias tie even with no edges → full', run: () => {
      const r = impact(doc({ members: [member('a', ['a', 'core']), member('b', ['b', 'core']), member('c', ['c'])] }), 'a');
      assert.equal(r.level, 'full');
    } },
    { name: 'a rejected edge is not live; a manual edge is, and counts as curated', run: () => {
      const e = edge('c', 'a');
      const overrides = { version: 1, edges: { [e.id]: { state: 'rejected', from: 'c', to: 'a', kind: 'http', display: e.display, at: RECENT } },
        manual: [{ id: 'm_000000000001', from: 'b', to: 'c', kind: 'http', display: 'GET /m', detail: '', createdAt: RECENT }] };
      const r = impact(doc({ members: [member('a'), member('b'), member('c')], edges: [e] }), 'c', { overrides });
      assert.equal(r.signals.edges, 1, 'only the manual edge is live');
      assert.equal(r.signals.curated, 1);
      assert.equal(r.level, 'partial');
      assert.match(r.reason, /1 you reviewed by hand/);
    } },
    { name: 'stale map + edges → full; stale map without edges stays none', run: () => {
      const old = '2026-08-01T00:00:00Z';
      assert.equal(impact(doc({ members: [member('a'), member('b'), member('c')], edges: [edge('c', 'a')], scannedAt: old }), 'c').level, 'full');
      assert.equal(impact(doc({ members: [member('a'), member('b'), member('c')], scannedAt: old }), 'c').level, 'none');
    } },
    { name: 'R1: no stored map → full, partial unavailable', run: () => {
      const r = memberRemoveImpact(null, null, 'c', { now: NOW, name: 'c-repo' });
      assert.equal(r.level, 'full');
      assert.equal(r.partialAvailable, false);
      assert.match(r.reason, /no stored map/);
    } },
    { name: 'R1b: the map lacks a member left (its add-scan never finished) → full, partial unavailable', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('c')], edges: [edge('c', 'a')] }), 'c',
        { remaining: [...left('a', 'b'), { key: 'd', name: 'd-repo' }] });
      assert.equal(r.level, 'full');
      assert.equal(r.partialAvailable, false);
      assert.deepEqual(r.signals.uncovered, ['d-repo']);
      assert.equal(r.reason, 'The map does not cover d-repo yet (its scan never finished). A full re-scan is recommended so the map describes every member left.');
    } },
    { name: 'R1b: a map that still names a member gone from the workspace → full, partial unavailable', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('c'), member('z')] }), 'c', { remaining: left('a', 'b') });
      assert.equal(r.level, 'full');
      assert.equal(r.partialAvailable, false);
      assert.match(r.reason, /^The map still names members that left the workspace\./);
    } },
    { name: 'R2: removing the only member the map lacks → none, partial still available (the rest is covered)', run: () => {
      const r = impact(doc({ members: [member('a'), member('b')], edges: [edge('a', 'b')] }), 'new', { name: 'new-repo', remaining: left('a', 'b') });
      assert.equal(r.level, 'none');
      assert.equal(r.partialAvailable, true);
      assert.match(r.reason, /^new-repo joined after the last scan/);
    } },
    { name: 'R0: a live automatic re-scan raises the level', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), member('c')] }), 'c', { pendingRescan: 'full' });
      assert.equal(r.level, 'full');
      assert.match(r.reason, /re-scan for an earlier member change is still running/);
    } },
    { name: 'R0 keeps the whole fact lead even when a member name contains ". "', run: () => {
      const r = impact(doc({ members: [member('a'), member('b'), { ...member('c'), name: 'v2. core' }] }), 'c', { pendingRescan: 'partial' });
      assert.equal(r.level, 'partial');
      assert.equal(r.reason, 'v2. core had no edges in the map and the overview does not mention it. A re-scan for an earlier member change is still running and this change replaces it, so a partial re-scan is recommended.');
    } },
  ]);
});
