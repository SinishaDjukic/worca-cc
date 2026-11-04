// test/run-telemetry-view.test.mjs — ui/public/run-telemetry-view.mjs: the Agents tab's telemetry line,
// chart and harness line, gated by the runTelemetry flag on <html data-flags>.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  stepFigures, harnessFigures, contextChart, telemetrySlotHtml, paintTelemetry, fmtMs, _resetTelemetryCache,
} from '../ui/public/run-telemetry-view.mjs';

const dom = (flags) => new JSDOM(`<!doctype html><html data-flags="${flags}"><body><section id="s"></section></body></html>`).window.document;
const STEP = {
  perCall: true, peak: 180_000, final: 90_000, window: 200_000, windowFrom: 'default', calls: 12, sessions: 2,
  startupMs: 3000, modelMs: 61_000, toolMs: 4200, cacheShare: 0.9, toolErrors: 1, retries: 2,
  compactions: [{ at: 5000, trigger: 'auto', preTokens: 170_000, sub: null }], subCalls: 3, subPeak: 40_000,
  series: [[0, 10_000], [5000, 180_000], [9000, 90_000]],
};

beforeEach(() => _resetTelemetryCache());

test('fmtMs', () => {
  assert.equal(fmtMs(0), '');
  assert.equal(fmtMs(250), '250ms');
  assert.equal(fmtMs(4200), '4.2s');
  assert.equal(fmtMs(61_000), '1m 1s');
  assert.equal(fmtMs(3_780_000), '1h 3m');
});

test('stepFigures: the peak against the window with its level, then calls, time, cache, warnings, sub-agents', () => {
  const f = stepFigures(STEP);
  assert.equal(f[0].text, 'context peak 180.0k / 200k (90%)');
  assert.equal(f[0].level, 'high', 'past 90% of where compaction starts (200k − 33k)');
  assert.match(f[0].title, /Window assumed/);
  const texts = f.map((x) => x.text);
  assert.deepEqual(texts.slice(1), ['12 calls', '2 sessions', 'start 3.0s · model 1m 1s · tools 4.2s', 'cache 90%', '1 tool error', '2 retries', '1 compaction', 'sub-agents 3 calls · peak 40.0k']);
});

test('stepFigures: an engine without per-call usage reads "session input", never a context peak', () => {
  const f = stepFigures({ perCall: false, peak: null, sessionInput: 5000, window: 200_000, calls: 0, sessions: 1, compactions: [] });
  assert.deepEqual(f.map((x) => x.text), ['session input 5.0k']);
  assert.equal(f[0].level, undefined);
});

test('harnessFigures', () => {
  assert.deepEqual(harnessFigures({ windows: 0 }), []);
  assert.deepEqual(harnessFigures({ windows: 3, persists: 10, persistAvgMs: 4, persistMaxMs: 30, rowsPerPersist: 12, emits: 5, emitAvgBytes: 2048, emitMaxBytes: 4096, lagP99MaxMs: 8, lagMaxMs: 20 }),
    ['10 saves · avg 4ms · max 30ms · 12 rows each', '5 live updates · avg 2.0 KB · max 4.0 KB', 'event loop delay p99 ≤ 8ms · max 20ms']);
});

test('contextChart: a line, the window, the compaction trigger and a compaction marker; nothing for one point', () => {
  const doc = dom('runTelemetry');
  const svg = contextChart(doc, STEP);
  assert.ok(svg.querySelector('path.tel-line'));
  assert.ok(svg.querySelector('line.tel-win'));
  assert.ok(svg.querySelector('line.tel-trig'));
  assert.ok(svg.querySelector('line.tel-compact'));
  assert.equal(contextChart(doc, { series: [[0, 1]] }), null);
});

test('paintTelemetry keeps the 20 most recently painted runs', async () => {
  const doc = dom('runTelemetry');
  const sec = doc.getElementById('s');
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, json: async () => ({ steps: {}, harness: { windows: 0 } }) }; };
  for (let i = 0; i < 20; i++) await paintTelemetry(sec, `r${i}`, { fetchImpl });
  await paintTelemetry(sec, 'r0', { fetchImpl });            // a cached hit makes r0 the newest
  await paintTelemetry(sec, 'r20', { fetchImpl });           // the 21st run drops the oldest, r1
  assert.equal(urls.length, 21);
  await paintTelemetry(sec, 'r0', { fetchImpl });
  assert.equal(urls.length, 21, 'r0 stayed cached');
  await paintTelemetry(sec, 'r1', { fetchImpl });
  assert.equal(urls.at(-1), '/api/runs/r1/telemetry', 'r1 was dropped and is fetched again');
  _resetTelemetryCache();
  await paintTelemetry(sec, 'r0', { fetchImpl });
  assert.equal(urls.at(-1), '/api/runs/r0/telemetry', 'a reset empties the cache');
});

test('the slot is empty markup while the flag is off', () => {
  assert.equal(telemetrySlotHtml('x:a:1', dom('')), '');
  assert.match(telemetrySlotHtml('x:a:1', dom('runTelemetry')), /data-tel-step="x:a:1"/);
});

test('paintTelemetry fetches once, fills the slots and the harness line; flag off fetches nothing', async () => {
  const doc = dom('runTelemetry');
  const sec = doc.getElementById('s');
  sec.innerHTML = telemetrySlotHtml('x:a:1', doc) + telemetrySlotHtml('x:b:1', doc);
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, json: async () => ({ steps: { 'x:a:1': STEP }, harness: { windows: 1, persists: 2, persistAvgMs: 1, persistMaxMs: 2, rowsPerPersist: 3 } }) }; };
  await paintTelemetry(sec, 'run1', { fetchImpl });
  assert.deepEqual(urls, ['/api/runs/run1/telemetry']);
  const a = sec.querySelector('[data-tel-step="x:a:1"]');
  assert.equal(a.hidden, false);
  assert.match(a.textContent, /context peak 180\.0k/);
  assert.ok(a.querySelector('svg.tel-chart'));
  assert.equal(sec.querySelector('[data-tel-step="x:b:1"]').hidden, true, 'a step with no telemetry stays hidden');
  assert.match(sec.querySelector('.tel-harness').textContent, /2 saves/);
  await paintTelemetry(sec, 'run1', { fetchImpl });
  assert.equal(urls.length, 1, 'a finished run is cached');

  // A run that recorded nothing (404): live repaints ask again only after the TTL; the finished run's
  // first paint asks once more, then never.
  const miss = async (url) => { urls.push(url); return { ok: false, json: async () => null }; };
  await paintTelemetry(sec, 'run3', { fetchImpl: miss, live: true });
  await paintTelemetry(sec, 'run3', { fetchImpl: miss, live: true });
  await paintTelemetry(sec, 'run3', { fetchImpl: miss });
  await paintTelemetry(sec, 'run3', { fetchImpl: miss });
  assert.equal(urls.filter((u) => u.includes('run3')).length, 2);

  // A copy fetched while the run was live is refetched once when History paints the finished run.
  await paintTelemetry(sec, 'run4', { fetchImpl, live: true });
  await paintTelemetry(sec, 'run4', { fetchImpl });
  await paintTelemetry(sec, 'run4', { fetchImpl });
  assert.equal(urls.filter((u) => u.includes('run4')).length, 2);

  const off = dom('');
  await paintTelemetry(off.getElementById('s'), 'run2', { fetchImpl });
  assert.ok(!urls.some((u) => u.includes('run2')), 'flag off: no request');
});

test('stepFigures: wall time and cost, the sub-agent wait and test time', () => {
  const f = stepFigures({ ...STEP, wallMs: 754_000, costUsd: 3.456, agentWaitMs: 866_000, testMs: 125_000, testRuns: 2 });
  const texts = f.map((x) => x.text);
  assert.equal(texts[1], 'wall 12m 34s · $3.46');
  assert.ok(texts.includes('waiting on sub-agents 14m 26s'));
  assert.ok(texts.includes('tests 2m 5s (2 runs)'));
});

test('harnessFigures: GC pauses and machine load', () => {
  assert.deepEqual(harnessFigures({ windows: 2, gcs: 4, gcMs: 30, gcMaxMs: 12, loadAvg: 3.25, loadMax: 6 }),
    ['4 GC pauses · 30ms · max 12ms', 'machine load avg 3.3 · max 6.0']);
});

test('contextChart: scaled to the peak, not a 1M window; the window is named off scale; labels and a tooltip', () => {
  const doc = dom('runTelemetry');
  const st = { ...STEP, window: 1_000_000, series: [[0, 140_000], [600_000, 512_000], [1_380_000, 300_000]], compactions: [],
    subSeries: [[300_000, 60_000], [400_000, 90_000]] };
  const fig = contextChart(doc, st);
  assert.equal(fig.querySelector('line.tel-win'), null, '1M is off a 589k scale');
  assert.equal(fig.querySelector('line.tel-trig'), null);
  const path = fig.querySelector('path.tel-line').getAttribute('d');
  const ys = [...path.matchAll(/,([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(Math.min(...ys) < 15, `the peak reaches near the top of a 64-px chart (y ${Math.min(...ys)})`);
  assert.ok(fig.querySelector('path.tel-sub'), 'sub-agent calls drawn');
  assert.match(fig.querySelector('svg title').textContent, /start 140\.0k, peak 512\.0k at 10m 0s/);
  const cap = [...fig.querySelectorAll('figcaption span')].map((n) => n.textContent);
  assert.deepEqual(cap, ['start 140.0k', 'peak 512.0k at 10m 0s', 'sub-agents 90.0k max', 'window 1M (off scale)', '23m 0s']);
});
