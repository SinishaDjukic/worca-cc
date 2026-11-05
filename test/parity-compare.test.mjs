// test/parity-compare.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, compareRoutes, renderReport, summaryLine, timingLine, EXPECTED_SHOTS, FLOW_NAMES } from '../tools/parity/compare.mjs';

const shots = () => Array.from({ length: EXPECTED_SHOTS }, (_, i) => ({ page: `p${i >> 1}`, theme: i % 2 ? 'dark' : 'light', file: `/s/${i}.png` }));
const okFlows = () => FLOW_NAMES.map((name) => ({ name, ok: true, ms: 900 }));
const snap = (over = {}) => ({
  target: 'tree:.', kind: 'tree',
  routes: { signedIn: [{ method: 'GET', path: '/api/a', status: 200, shape: '{"x":"number"}', volatile: false }],
    signedOut: [{ method: 'GET', path: '/api/a', status: 401, problem: null }] },
  flows: okFlows(), shots: shots(),
  timings: { samples: 5, bootMs: [100, 100, 100, 100, 100], pageLoadMs: { 'chat-home': [50, 50, 50, 50, 50] } },
  ...over });
const opts = { visual: [], gateTimings: true };

test('a snapshot against itself has 0 differences and passes', () => {
  const r = compareSnapshots(snap(), snap(), opts);
  assert.deepEqual([r.routeDiffs.length, r.visualDiffs.length, r.failedFlows.length, r.problems.length, r.pass], [0, 0, 0, 0, true]);
});

test('report.json keeps the fields slice 3 reads', () => {
  const r = compareSnapshots(snap(), snap(), opts);
  for (const k of ['pass', 'routeDiffs', 'signedOutProblems', 'failedFlows', 'visualDiffs', 'timings', 'problems', 'routeCounts']) assert.ok(k in r, k);
  assert.deepEqual(Object.keys(r.timings.boot).sort(), ['a', 'b', 'deltaPct', 'gated', 'pass']);
  assert.deepEqual(r.routeCounts.a, { listed: 1, probed: 1, skipped: 0 });
});

test('a missing flow and a short signed-out list fail as problems', () => {
  const b = snap({ flows: [] });
  b.routes.signedOut = [];
  b.routes.signedIn.push({ method: 'GET', path: '/api/b', status: 200, shape: '{}' });
  const r = compareSnapshots(snap(), b, opts);
  assert.equal(r.pass, false);
  assert.equal(r.failedFlows.length, 0);
  assert.match(r.problems.join('\n'), /B: flow open-pages missing/);
  assert.match(r.problems.join('\n'), /B: 0 signed-out rows, expected 2/);
  assert.match(summaryLine(r), /\d+ problems — FAIL$/);
});

test('a status change, a removed route and an added route are route differences', () => {
  const b = snap(); b.routes.signedIn = [{ method: 'GET', path: '/api/new', status: 200, shape: '{}' }];
  assert.deepEqual(compareRoutes(snap().routes.signedIn, b.routes.signedIn).map((d) => d.kind).sort(), ['only-in-a', 'only-in-b']);
  const c = snap(); c.routes.signedIn[0].status = 500;
  assert.deepEqual(compareRoutes(snap().routes.signedIn, c.routes.signedIn).map((d) => d.kind), ['status']);
  assert.equal(compareSnapshots(snap(), b, opts).pass, false);
});

test('a volatile route is compared by status only', () => {
  const a = snap(); a.routes.signedIn[0].volatile = true;
  const b = snap(); b.routes.signedIn[0].shape = '{"y":"string"}';
  assert.equal(compareSnapshots(a, b, opts).routeDiffs.length, 0);
});

test('a crashed route fails the run even when both sides crash', () => {
  const a = snap(); a.routes.signedIn[0].status = 'crashed';
  const r = compareSnapshots(a, structuredClone(a), opts);
  assert.equal(r.pass, false);
  assert.match(r.problems.join('\n'), /GET \/api\/a crashed/);
});

test('a signed-out problem in either snapshot fails', () => {
  const b = snap(); b.routes.signedOut[0] = { method: 'GET', path: '/api/a', status: 200, problem: 'expected 401, got 200' };
  assert.equal(compareSnapshots(snap(), b, opts).signedOutProblems.length, 1);
});

test('empty routes or a wrong shot count fail as problems', () => {
  const b = snap({ shots: [] }); b.routes.signedIn = [];
  const r = compareSnapshots(snap(), b, opts);
  assert.equal(r.pass, false);
  assert.match(r.problems.join('\n'), /B: 0 shots, expected 18/);
  assert.match(r.problems.join('\n'), /B: no signed-in routes/);
});

test('a visual difference fails tree vs tree and is reported for docker', () => {
  const visual = [{ page: 'runs', theme: 'dark', pixels: 12, diff: '/o/runs-dark.diff.png' }];
  assert.equal(compareSnapshots(snap(), snap(), { ...opts, visual }).pass, false);
  const r = compareSnapshots(snap(), snap({ kind: 'docker' }), { ...opts, visual });
  assert.deepEqual([r.visualGated, r.pass], [false, true]);
});

test('docker vs docker runs in one environment: a visual difference is gated and fails', () => {
  const visual = [{ page: 'runs', theme: 'dark', pixels: 42, diff: '/o/runs-dark.diff.png' }];
  const d = (over = {}) => snap({ target: 'docker:img', kind: 'docker', ...over });
  const r = compareSnapshots(d(), d({ target: 'docker:img-split' }), { ...opts, visual });
  assert.deepEqual([r.visualGated, r.pass, r.visualDiffs.length], [true, false, 1]);
  assert.match(renderReport(r), /^## Visuals$/m, 'no "(reported, not gated)" suffix');
  const same = compareSnapshots(d(), d(), { ...opts, visual: [{ page: 'runs', theme: 'dark', pixels: 0 }] });
  assert.deepEqual([same.visualGated, same.pass], [true, true]);
  // the mixed pair stays reported-only, either way round
  assert.equal(compareSnapshots(d(), snap(), { ...opts, visual }).visualGated, false);
  assert.equal(compareSnapshots(snap({ kind: 'package' }), d(), { ...opts, visual }).visualGated, false);
});

test('timings: gated only for tree vs tree with 5 samples and the gate on', () => {
  const slow = snap({ timings: { samples: 5, bootMs: [1300, 1300, 1300, 1300, 1300], pageLoadMs: { 'chat-home': [50, 50, 50, 50, 50] } } });
  const fast = snap({ timings: { samples: 5, bootMs: [1000, 1000, 1000, 1000, 1000], pageLoadMs: { 'chat-home': [50, 50, 50, 50, 50] } } });
  assert.equal(compareSnapshots(fast, slow, opts).timings.boot.pass, false);
  assert.equal(compareSnapshots(fast, { ...slow, kind: 'docker' }, opts).timings.boot.gated, false);
  assert.equal(compareSnapshots(fast, slow, { ...opts, gateTimings: false }).timings.boot.gated, false);
  const one = (s) => ({ ...s, timings: { ...s.timings, samples: 1 } });
  assert.equal(compareSnapshots(one(fast), one(slow), opts).timings.boot.gated, false);
});

test('summaryLine: counts, then the timing verdict, then PASS/FAIL; the report starts with it', () => {
  const r = compareSnapshots(snap(), snap(), opts);
  assert.equal(summaryLine(r), '0 route, 0 visual, 0 flow differences; timings within 10% — PASS');
  assert.match(renderReport(r), /^# Parity: PASS\n\n0 route, 0 visual, 0 flow differences; timings within 10% — PASS\n/);
  assert.match(summaryLine(compareSnapshots(snap(), snap(), { ...opts, gateTimings: false })), /timings reported, not gated — PASS$/);
});

test('the Flows section lists every flow on both sides', () => {
  const b = snap({ flows: [{ name: 'open-pages', ok: false, ms: 10, error: 'GET /api/x -> 500', shot: null }, ...okFlows().slice(1)] });
  const md = renderReport(compareSnapshots(snap(), b, opts));
  assert.match(md, /a open-pages: PASS/);
  assert.match(md, /b open-pages: FAIL — GET \/api\/x -> 500 \(no screenshot: page closed\)/);
});

test('snapshot-only dirs (no boot samples) report timings as n/a, not NaN', () => {
  const snap = (bootMs) => ({ kind: 'tree', routes: { signedIn: [], signedOut: [] }, flows: [], shots: [], timings: { samples: 1, bootMs, pageLoadMs: {} } });
  const r = compareSnapshots(snap([]), snap([]), { visual: [] });
  assert.deepEqual([r.timings.boot.a, r.timings.boot.deltaPct, r.timings.boot.pass], [null, null, true]);
  assert.equal(timingLine('boot', r.timings.boot), 'boot: n/a (no samples)');
});
