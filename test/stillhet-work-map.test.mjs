// test/stillhet-work-map.test.mjs — a person's work on By person (the open row): dev's work items and people
// (src/shared/team-metrics/timeline.mjs) mapped to the design's words, counts, head, card and read-only view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord } from './fixtures/team-metrics/records.mjs';
import { WORDS, lookupsFor, personWork, workItemOf, isOwn, workHead, cardOf, taskViewOf } from '../ui/public/stillhet/live/work-map.mjs';
import { buildWorkItems, groupByPerson } from '../src/shared/team-metrics/timeline.mjs';

const DAY = 86_400_000, H = 3_600_000;
const T = (d, h = 10) => Date.UTC(2026, 10, d, h);
const iso = (t) => new Date(t).toISOString();
const NOW = T(14, 12), START = T(1, 0), END = T(31, 0) - 1;
const MAYA = 'Maya Lind';
const rec = (id, d, o = {}) => ({ ...makeRecord({ id, startedAt: iso(typeof d === 'number' && d > 1e9 ? d : T(d)), actor: MAYA, ...o }), actorKey: o.actorKey === undefined ? 'k-maya' : o.actorKey });
const src = (n) => ({ type: 'github', ref: `#${n}`, url: `https://github.com/acme/billing-api/issues/${n}`, title: null });
const pr = (n, state, created, extra = {}) => [{ repo: 'acme/billing-api', number: n, url: `https://github.com/acme/billing-api/pull/${n}`, title: `PR ${n}`, state, createdAt: iso(created), mergedAt: null, closedAt: null, ...extra }];

// one item of each dev status, for Maya; and Jonas
const RECORDS = [
  rec('m1a', T(7, 10), { title: 'Retry failed webhook deliveries', source: { ...src(1), title: 'Retry failed webhook deliveries' } }),
  rec('m1b', T(7, 20), { title: 'Retry failed webhook deliveries', source: { ...src(1), title: 'Retry failed webhook deliveries' } }),
  rec('m2', 13, { title: 'Currency rounding in reports' }),
  rec('m3', 10, { title: 'Open too long' }),
  rec('m4', 5, { title: 'Remove legacy coupon code' }),
  rec('m5', 4, { title: 'Tax ID validation', result: 'failed' }),
  rec('m6', 3, { title: 'Stopped one', result: 'stopped' }),
  rec('m7', 2, { title: 'Done one' }),
  rec('old', Date.UTC(2026, 9, 1, 10), { title: 'Last month' }),
  rec('j1', 5, { actor: 'Jonas', actorKey: 'k-jonas', title: 'Jonas work' }),
];
const PRS = {
  m1a: [], m1b: pr(1418, 'MERGED', T(7, 22), { mergedAt: iso(T(8, 11)) }),
  m2: pr(1421, 'OPEN', T(13, 12)),
  m3: pr(1410, 'OPEN', T(10, 12)),
  m4: pr(1396, 'CLOSED', T(5, 12), { closedAt: iso(T(6, 12)) }),
  m5: [], m6: [], m7: [], old: [], j1: [],
};
const work = (o = {}) => personWork(RECORDS, { person: MAYA, start: START, end: END, prs: PRS, now: NOW, ...o });
const byTitle = (w, t) => w.items.find((i) => i.title === t);

test('a merged item has a dashed tail from the PR opening to its merge, and its mark at the merge', () => {
  const it = byTitle(work(), 'Retry failed webhook deliveries');
  assert.equal(it.state, 'merged'); assert.equal(it.word, WORDS.merged); assert.equal(it.word, 'Merged');
  assert.deepEqual(it.work, [T(7, 10), T(7, 20)]);
  assert.deepEqual(it.wait, [T(7, 22), T(8, 11)]);
  assert.deepEqual(it.end, { status: 'merged', at: T(8, 11) });
  assert.equal(it.prNumber, 1418); assert.equal(it.prUrl, 'https://github.com/acme/billing-api/pull/1418');
  assert.equal(it.project, 'acme/billing-api');
});

test('an open PR 1 day old is Open for review; one open more than 2 days is Waiting for review', () => {
  const w = work();
  const a = byTitle(w, 'Currency rounding in reports'), b = byTitle(w, 'Open too long');
  assert.equal(a.word, 'Open for review'); assert.equal(a.end.status, 'open'); assert.equal(a.end.at, NOW);
  assert.equal(b.word, 'Waiting for review'); assert.match(b.reason, /waiting for review for 4 days/);
});

test('a closed PR is Closed', () => {
  const it = byTitle(work(), 'Remove legacy coupon code');
  assert.equal(it.word, 'Closed'); assert.deepEqual(it.end, { status: 'closed', at: T(6, 12) });
});

test('a failed run with no PR is Failed, with dev\'s reason', () => {
  const it = byTitle(work(), 'Tax ID validation');
  assert.equal(it.word, 'Failed'); assert.equal(it.tone, 'fail'); assert.equal(it.reason, 'The last attempt failed.');
  assert.equal(it.end, null); assert.equal(it.wait, null);
});

test('two runs on the same ticket are one item', () => {
  const its = work().items.filter((i) => i.title === 'Retry failed webhook deliveries');
  assert.equal(its.length, 1); assert.equal(its[0].runs.length, 2); assert.equal(its[0].runId, 'm1b');
});

test('items outside the window are dropped; lookups reach back 60 days, inclusive', () => {
  assert.equal(byTitle(work(), 'Last month'), undefined);
  const recs = [61, 60, 59].map((d) => rec(`b${d}`, START - d * DAY));
  assert.deepEqual(lookupsFor(recs, { start: START, now: NOW }).map((l) => l.id), ['b60', 'b59']);
  assert.deepEqual(Object.keys(lookupsFor(recs, { start: START, now: NOW })[0]).sort(), ['branch', 'endedAt', 'id', 'pr', 'repos']);
});

test('items are newest first, by their last activity', () => {
  assert.deepEqual(work().items.map((i) => i.title), ['Currency rounding in reports', 'Open too long', 'Retry failed webhook deliveries', 'Remove legacy coupon code', 'Tax ID validation', 'Stopped one', 'Done one']);
});

test('RD-timeline-person: a row\'s timeline is its exact actor; another spelling is its own row', () => {
  const recs = [rec('s1', 3, { actor: 'Maya Lind' }), rec('s2', 4, { actor: 'maya  lind' }), rec('s3', 5, { actor: 'Maya Lind', actorKey: null }), rec('j', 5, { actor: 'Jonas', actorKey: 'k-jonas' })];
  const outside = [
    { repo: 'acme/web-app', number: 77, url: 'https://github.com/acme/web-app/pull/77', title: 'Outside fix', state: 'MERGED', createdAt: iso(T(6)), mergedAt: iso(T(7)), author: 'mayal', authorName: 'Maya Lind', authorKey: 'k-maya', head: 'fix' },
    { repo: 'acme/web-app', number: 78, url: 'https://github.com/acme/web-app/pull/78', title: 'Login only', state: 'MERGED', createdAt: iso(T(6)), mergedAt: iso(T(7)), author: 'mayal', authorKey: 'k-maya', head: 'login-only' },
  ];
  const at = (person) => personWork(recs, { person, start: START, end: END, prs: {}, outside, now: NOW });
  assert.deepEqual(at('maya  lind').items.map((i) => i.runId), ['s2']);
  const w = at('Maya Lind');
  assert.deepEqual(w.items.map((i) => i.runId).sort(), [null, 's1', 's3'].sort());
  const o = w.items.find((i) => i.title === 'Outside fix');
  assert.equal(o.runs.length, 0); assert.equal(o.prUrl, 'https://github.com/acme/web-app/pull/77');
  for (const p of ['Maya Lind', 'maya  lind', 'Jonas']) assert.ok(!at(p).items.some((i) => i.title === 'Login only'));
  assert.deepEqual(personWork(recs, { person: 'Nobody', start: START, end: END, now: NOW }).items, []);
});

test('counts cover the six states once each and add up to the items', () => {
  const w = work();
  assert.deepEqual(w.counts, { merged: 1, review: 2, closed: 1, failed: 1, stopped: 1, done: 1 });
  assert.equal(Object.values(w.counts).reduce((a, b) => a + b, 0), w.items.length);
  assert.equal(w.items.length, 7);
  assert.deepEqual(w.axis, { start: START, end: END });
  assert.deepEqual(personWork(RECORDS, { person: 'Nobody', start: START, end: END, now: NOW }).counts, { merged: 0, review: 0, closed: 0, failed: 0, stopped: 0, done: 0 });
});

test('workHead: the nonzero counts in order, the PR suffixes, and no line for no work', () => {
  const counts = { merged: 7, review: 1, closed: 1, failed: 6, stopped: 0, done: 0 };
  assert.deepEqual(workHead('Maya', 'this month', counts, { state: 'ready' }), { title: "Maya's work, this month", line: 'newest first · 7 merged, 1 open for review, 1 closed, 6 failed' });
  assert.match(workHead('Maya', 'this month', counts, { state: 'pending' }).line, / · looking up pull requests$/);
  assert.match(workHead('Maya', 'this month', counts, { state: 'failed', why: 'gh is not signed in' }).line, / · pull requests could not be read: gh is not signed in$/);
  assert.match(workHead('Maya', 'this month', counts, { state: 'unknown' }).line, / · pull request states are not known here$/);
  assert.deepEqual(workHead('Maya', 'this month', { merged: 0, review: 0, closed: 0, failed: 0, stopped: 0, done: 0 }, { state: 'ready' }), { title: "Maya's work, this month", line: '' });
  assert.equal(workHead('Maya', 'this month', { merged: 0, review: 0, closed: 0, failed: 0, stopped: 1, done: 2 }, { state: 'ready' }).line, 'newest first · 1 stopped, 2 done');
});

test('isOwn: an item is yours when this Worca knows one of its runs', () => {
  const it = byTitle(work(), 'Retry failed webhook deliveries');
  assert.equal(isOwn(it, (id) => (id === 'm1a' ? { id } : null)), true);
  assert.equal(isOwn(it, () => null), false);
});

test('cardOf: the PR, its time and the lead time from the first run', () => {
  assert.deepEqual(cardOf(byTitle(work(), 'Retry failed webhook deliveries')), { title: 'Retry failed webhook deliveries', line: '#1418 merged Nov 8, 11:00 · 1d 1h from first run · opens the pull request' });
  const tv = taskViewOf(byTitle(work(), 'Tax ID validation'), { now: NOW });
  assert.equal(tv.state.word, 'Failed'); assert.equal(tv.state.detail, 'The last attempt failed.');
  assert.deepEqual(tv.figures.map((f) => f.k), ['Cost', 'Time working', 'Runs', 'Review rounds']);
  assert.equal(tv.runs.rows.length, 1); assert.equal(tv.pr, null);
});

test('a PR url that is not http(s) never becomes prUrl', () => {
  const prs = { ...PRS, m2: pr(1421, 'OPEN', T(13, 12), { url: 'javascript:alert(1)' }) };
  assert.equal(byTitle(work({ prs }), 'Currency rounding in reports').prUrl, '');
  assert.equal(workItemOf(RECORDS, { runId: 'm2', prs, now: NOW }).prUrl, '');
});

test('tones: an open PR is never Ready (wait), a waiting one is not lit (grey dot, wait mark)', () => {
  const w = work();
  const a = byTitle(w, 'Currency rounding in reports'), b = byTitle(w, 'Open too long');
  assert.equal(a.tone, 'wait'); assert.equal(b.tone, 'wait');
  assert.equal(taskViewOf(b).state.tone, 'is-grey');
});

test('a shared ticket: each person sees their own group, and the item is found by run id', () => {
  const recs = [rec('sh1', 5, { title: 'Shared', source: src(9) }), rec('sh2', 6, { actor: 'Jonas', actorKey: 'k-jonas', title: 'Shared', source: src(9) }),
    rec('sh3', 6, { actor: 'Jonas', actorKey: 'k-jonas', title: 'Shared', source: src(9) }), rec('jx', 7, { actor: 'Jonas', actorKey: 'k-jonas', title: 'Jonas only' }),
    rec('mx', 8, { title: 'Maya only' })];
  const m = personWork(recs, { person: MAYA, start: START, end: END, prs: {}, now: NOW });
  assert.ok(m.items.some((i) => i.title === 'Maya only')); assert.ok(!m.items.some((i) => i.title === 'Jonas only'));
  const j = personWork(recs, { person: 'Jonas', start: START, end: END, prs: {}, now: NOW });
  assert.ok(j.items.some((i) => i.title === 'Jonas only')); assert.ok(!j.items.some((i) => i.title === 'Maya only'));
  assert.deepEqual(workItemOf(recs, { runId: 'sh1', prs: {}, now: NOW }).runs.map((r) => r.id).sort(), ['sh1', 'sh2', 'sh3']);
  assert.equal(workItemOf(recs, { runId: 'nope', prs: {}, now: NOW }), null);
});

// RD-timeline-person: dev's groupByPerson merges these three into one group (Bulibas's key is the fallback key of the
// two shared items, and the union-find joins it with both other names). Each By person row must still get only its own.
const DEN = 'Denislav Prinov', BUL = 'Bulibas', PRW = 'pr-watch';
const MERGED_RECS = [
  rec('d1', 3, { actor: DEN, actorKey: null, title: 'Shared with Denislav', source: src(21) }),
  rec('d2', 4, { actor: DEN, actorKey: null, title: 'Shared with Denislav', source: src(21) }),
  rec('b1', 5, { actor: BUL, actorKey: 'k-bul', title: 'Shared with Denislav', source: src(21) }),
  rec('p1', 6, { actor: PRW, actorKey: null, title: 'Shared with pr-watch', source: src(22) }),
  rec('p2', 7, { actor: PRW, actorKey: null, title: 'Shared with pr-watch', source: src(22) }),
  rec('b2', 8, { actor: BUL, actorKey: 'k-bul', title: 'Shared with pr-watch', source: src(22) }),
  rec('ds', 9, { actor: DEN, actorKey: null, title: 'Denislav solo' }),
  rec('bs', 10, { actor: BUL, actorKey: 'k-bul', title: 'Bulibas solo' }),
  rec('ps', 11, { actor: PRW, actorKey: null, title: 'pr-watch solo' }),
];
const mergedWork = (person) => personWork(MERGED_RECS, { person, start: START, end: END, prs: {}, now: NOW });

test('RD-timeline-person: the fixture reproduces dev\'s merge (one group holds all three)', () => {
  const groups = groupByPerson(buildWorkItems(MERGED_RECS, { prs: {}, now: NOW }));
  const all = groups.find((g) => [DEN, BUL, PRW].every((p) => g.items.some((it) => it.actors.includes(p))));
  assert.ok(all, 'one group holds items of all three people');
  assert.equal(all.items.length, 5);
});

test('RD-timeline-person: three people whose items share a fallback key each get only their own items', () => {
  const titles = (p) => mergedWork(p).items.map((i) => i.title).sort();
  assert.deepEqual(titles(DEN), ['Denislav solo', 'Shared with Denislav']);
  assert.deepEqual(titles(PRW), ['Shared with pr-watch', 'pr-watch solo']);
  assert.deepEqual(titles(BUL), ['Bulibas solo', 'Shared with Denislav', 'Shared with pr-watch']);
  for (const p of [DEN, BUL, PRW]) {
    for (const it of mergedWork(p).items) assert.ok(MERGED_RECS.some((r) => r.actor === p && it.runs.some((x) => x.id === r.id)), `${p} has a run in ${it.title}`);
  }
});

test('RD-timeline-person: the head counts match the person\'s items', () => {
  const expected = { [DEN]: 'newest first · 2 done', [BUL]: 'newest first · 3 done', [PRW]: 'newest first · 2 done' };
  for (const p of [DEN, BUL, PRW]) {
    const w = mergedWork(p);
    assert.equal(Object.values(w.counts).reduce((a, b) => a + b, 0), w.items.length);
    assert.equal(workHead(p, 'this month', w.counts, { state: 'ready' }).line, expected[p]);
  }
});
