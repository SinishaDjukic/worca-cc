// Slice 10 (D8, D11, D18, D19; Invariants 4–6): Insights' live reads, with a fake fetch and manual timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { startInsightsLive, TEAM_EMPTY, VIEWS_KEY } from '../ui/public/stillhet/live/insights-live.mjs';

const win = {};
vm.runInNewContext(readFileSync('ui/public/stillhet/insights/insights-model.js', 'utf8'), { window: win });
const M = win.RailInsightsModel;
const NOW = new Date(2026, 10, 14, 12).getTime();
const B = [new Date(2026, 10, 1).getTime(), new Date(2026, 10, 2).getTime()];
const fact = (id, o) => ({ id, person: 'Maya', project: 'billing-api', workflow: 'Default', status: 'finished', pr: null, tags: {}, usd: 2, hours: 1, inCohort: true, startedMs: B[0] + 1, hourBucket: 0, spend: [[0, 2]], ...o });
const stats = (spent = 3) => ({ bucket: 'day', windowStartMs: B[0], windowEndMs: B[1] + 86_400_000, humanRateUsd: 10,
  totals: { spentUsd: spent, humanHours: 2, savedUsd: 17, runs: 2, finished: 2, failed: 0, stopped: 0, prsMerged: 0, prsOpened: 0 }, prev: null,
  series: [{ bucketStartMs: B[0], spentUsd: 2, finished: 1, failed: 0, stopped: 0 }, { bucketStartMs: B[1], spentUsd: spent - 2, finished: 1, failed: 0, stopped: 0 }],
  report: { buckets: B, runs: [fact('a'), fact('b', { usd: spent - 2, spend: [[1, spent - 2]], startedMs: B[1] + 1, project: 'web-app', person: 'Jonas' })], prevRuns: null } });

function rig({ answers = {}, costs = { budget: { period: 'this month', spent: 3, limit: 100 } }, storage } = {}) {
  const calls = [], held = new Map(), timers = [];
  let t = 0;
  const fetch = (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    const a = typeof answers === 'function' ? answers(url) : answers[url] ?? Object.entries(answers).find(([k]) => url.startsWith(k))?.[1];
    const answer = () => (a instanceof Error ? Promise.reject(a) : Promise.resolve({ status: a?.[0] ?? 404, json: async () => a?.[1] ?? {} }));
    if (held.has(url)) return new Promise((res, rej) => held.get(url).push(() => answer().then(res, rej)));
    return answer();
  };
  const hold = (url) => held.set(url, []);
  const release = (url) => { const q = held.get(url) || []; held.delete(url); q.forEach((f) => f()); };
  const store = new Map();
  const live = startInsightsLive({ fetch, now: () => NOW, world: () => ({ costs }), model: () => M, storage: storage ?? { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    setTimeout: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; }, clearTimeout: (id) => { if (id) timers[id - 1].fn = null; } });
  const tick = async (ms = 0) => { t += ms; for (const x of timers) if (x.fn && x.at <= t) { const f = x.fn; x.fn = null; f(); } for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  return { live, calls, hold, release, tick, store };
}
const TAGS = { '/api/tag-dimensions': [200, { dims: [{ key: 'client' }] }] };
const MONTH = '/api/stats?range=month&report=1&byTag=1&tagKey=client';
const st = (o = {}) => ({ ...M.defaults(M.SUB.spend), ...o });

test('page(spend): loading, then ready with the live source and the D10 words', async () => {
  const r = rig({ answers: { ...TAGS, [MONTH]: [200, stats(3)] } });
  assert.equal(r.live.page('spend', st()).state, 'loading');
  await r.tick();
  assert.equal(r.live.page('spend', st()).state, 'loading', 'the tag keys came first; the stats read is now out');
  await r.tick();
  const p = r.live.page('spend', st());
  assert.equal(p.state, 'ready');
  assert.equal(p.sub.src.live, true);
  assert.equal(p.sub.src.totals.spend, 3);
  assert.equal(p.sub.word(), '$3 of $100');
  assert.equal(p.sub.id, 'spend'); assert.equal(p.sub.budget, 100);
  assert.ok(r.calls.every((c) => c.method === 'GET'), 'Invariant 4: GETs only');
});

test('a 500 is failed with dev\'s error; a network failure is "Worca is not answering"; retry re-reads only that key', async () => {
  const r = rig({ answers: (u) => (u === '/api/tag-dimensions' ? [200, { dims: [] }] : u.includes('range=month') ? [500, { error: 'the database is locked' }] : new Error('down')) });
  r.live.page('spend', st()); await r.tick(); r.live.page('spend', st()); await r.tick();
  const p = r.live.page('spend', st());
  assert.equal(p.state, 'failed'); assert.equal(p.text, 'the database is locked');
  r.live.page('spend', st({ when: 'last month' })); await r.tick();
  assert.equal(r.live.page('spend', st({ when: 'last month' })).text, 'Worca is not answering');
  const p2 = r.live.page('spend', st()); await r.tick();
  const n = r.calls.length; const f = r.live.page('spend', st());
  f.retry(); await r.tick();
  assert.deepEqual(r.calls.slice(n).map((c) => c.url), ['/api/stats?range=month&report=1'], 'only that key');
  assert.ok(p2);
});

test('Invariant 5: a slow month answer after a quarter pick is dropped', async () => {
  const QUARTER = '/api/stats?range=custom&from=2026-10-01&to=2026-11-14&report=1&byTag=1&tagKey=client';
  const r = rig({ answers: { ...TAGS, [MONTH]: [200, stats(50)], [QUARTER]: [200, stats(7)] } });
  r.live.page('spend', st()); await r.tick();
  r.hold(MONTH);
  r.live.page('spend', st()); await r.tick();
  assert.equal(r.live.page('spend', st({ when: 'this quarter' })).state, 'loading');
  await r.tick();
  r.release(MONTH); await r.tick();
  const p = r.live.page('spend', st({ when: 'this quarter' }));
  assert.equal(p.sub.src.totals.spend, 7);
  assert.equal(r.live.page('spend', st()).state, 'loading', 'the month key was dropped, its late answer never stored');
});

test('Invariant 6: a failed read changes nothing else: a ready page stays ready when its refresh fails', async () => {
  let fail = false;
  const r = rig({ answers: (u) => (u === '/api/tag-dimensions' ? [200, { dims: [] }] : fail ? [500, { error: 'no' }] : [200, stats(3)]) });
  r.live.page('spend', st()); await r.tick(); r.live.page('spend', st()); await r.tick();
  assert.equal(r.live.page('spend', st()).state, 'ready');
  fail = true; r.live.frame({ type: 'pipelines-changed' }); await r.tick(300);
  assert.equal(r.live.page('spend', st()).state, 'ready');
});

test('frames: pipelines-changed re-reads the open stats key once after 250 ms; a team flush-failed re-reads nothing', async () => {
  const r = rig({ answers: { ...TAGS, [MONTH]: [200, stats(3)], '/api/team-metrics/scopes': [200, { scopes: { projects: [{ id: 'project:a', label: 'a' }] } }], '/api/team-metrics?': [200, { records: [] }], '/api/policy': [404, {}] } });
  r.live.page('spend', st()); await r.tick(); r.live.page('spend', st()); await r.tick();
  const n = r.calls.length;
  r.live.frame({ type: 'pipelines-changed' }); r.live.frame({ type: 'ask-done' }); await r.tick(100);
  assert.equal(r.calls.length, n, 'debounced');
  await r.tick(200);
  assert.deepEqual(r.calls.slice(n).map((c) => c.url), [MONTH]);
  r.live.frame({ type: 'schedules-changed' }); await r.tick(300);
  assert.equal(r.calls.length, n + 1, 'another frame reads nothing');
  r.live.page('team', { ...M.defaults(M.SUB.team) }); await r.tick(); r.live.page('team', { ...M.defaults(M.SUB.team) }); await r.tick();
  const m = r.calls.length;
  r.live.frame({ type: 'team-metrics-changed', action: 'flush-failed' }); await r.tick(300);
  assert.equal(r.calls.length, m);
  r.live.frame({ type: 'team-metrics-changed', action: 'flushed' }); await r.tick(300);
  assert.ok(r.calls.slice(m).some((c) => c.url.startsWith('/api/team-metrics?scope=project%3Aa')));
});

test('team scopes: none enabled is empty; with two, the first is read, and st.scope of the second sends its id', async () => {
  const none = rig({ answers: { ...TAGS, '/api/team-metrics/scopes': [200, { scopes: { projects: [], workspaces: [] } }] } });
  none.live.page('team', M.defaults(M.SUB.team)); await none.tick(); none.live.page('team', M.defaults(M.SUB.team)); await none.tick();
  assert.deepEqual(none.live.page('team', M.defaults(M.SUB.team)), { state: 'empty', text: TEAM_EMPTY });
  const two = rig({ answers: { ...TAGS, '/api/team-metrics/scopes': [200, { scopes: { projects: [{ id: 'project:a', label: 'a' }], workspaces: [{ id: 'workspace:w', label: 'Shop' }] } }], '/api/team-metrics?': [200, { records: [], humanRateUsd: 0 }], '/api/policy': [404, {}] } });
  const go = async (s) => { for (let i = 0; i < 3; i++) { two.live.page('team', s); await two.tick(); } return two.live.page('team', s); };
  const p = await go(M.defaults(M.SUB.team));
  assert.equal(p.state, 'ready');
  assert.deepEqual(p.sub.src.scopes.map((s) => s.id), ['project:a', 'workspace:w']);
  assert.ok(two.calls.some((c) => c.url === '/api/team-metrics?scope=project%3Aa&range=all&aggregate=0&defer=1'));
  await go({ ...M.defaults(M.SUB.team), scope: 'workspace:w' });
  assert.ok(two.calls.some((c) => c.url === '/api/team-metrics?scope=workspace%3Aw&range=all&aggregate=0&defer=1'));
});

test('D11: without a limit Budget is absent and not offered; without a tag key Missing cost tags is not offered', async () => {
  const r = rig({ answers: { '/api/tag-dimensions': [200, { dims: [] }] }, costs: { budget: { period: 'this month', spent: 0, limit: null } } });
  assert.equal(r.live.offered('budget'), false);
  assert.deepEqual(r.live.page('budget', st()), { state: 'absent' });
  assert.equal(r.live.offered('untagged'), null, 'not known before the tag keys are read');
  await r.tick();
  assert.equal(r.live.offered('untagged'), false);
  assert.equal(r.live.offered('cache'), false);
  assert.equal(r.live.offered('spend'), true);
});

test('D19: monthSpend reads the project row of this month\'s answer; null while reading', async () => {
  const r = rig({ answers: { ...TAGS, [MONTH]: [200, stats(5)] } });
  assert.equal(r.live.monthSpend('billing-api'), null);
  await r.tick(); r.live.monthSpend('billing-api'); await r.tick();
  assert.equal(r.live.monthSpend('billing-api'), 2);
  assert.equal(r.live.monthSpend('web-app'), 3);
});

test('D18: saved views are kept in this browser; a refusing storage says so', () => {
  const r = rig();
  assert.deepEqual(r.live.views(), []);
  assert.deepEqual(r.live.saveView({ id: 'v1', name: 'Spend by client', sub: 'spend', st: { by: 'client' } }), { ok: true, text: '' });
  assert.deepEqual(r.live.views().map((v) => v.id), ['v1']);
  assert.ok(r.store.get(VIEWS_KEY));
  r.live.dropView('v1'); assert.deepEqual(r.live.views(), []);
  const no = rig({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } });
  assert.deepEqual(no.live.saveView({ id: 'v1', name: 'Mine', sub: 'spend', st: {} }), { ok: false, text: 'Could not save Mine: your browser did not keep it' });
});
