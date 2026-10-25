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
