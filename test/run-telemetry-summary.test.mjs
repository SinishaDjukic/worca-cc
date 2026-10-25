// test/run-telemetry-summary.test.mjs — src/core/telemetry/summary.mjs: telemetry.ndjson → per-step figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTelemetry, parseTelemetry, downsampleMax } from '../src/core/telemetry/summary.mjs';

const call = (ts, ctx, extra = {}) => ({ t: 'call', ts, step: 'x:a:1', session: 'S1', sub: null, msg: `m${ts}`, model: 'claude-opus-5-5', in: 1, cr: ctx - 1, cw: 0, out: 10, ctx, gapMs: 100, tools: [], ...extra });

test('per-call steps: peak, final, series, time split, sessions, sub-agents, window', () => {
  const recs = [
    { t: 'run', v: 1, ts: 0 },
    { t: 'step', ts: 1000, step: 'x:a:1', node: 'a', status: 'start' },
    { t: 'session', ts: 1500, step: 'x:a:1', session: 'S1' },
    call(2000, 50_000),
    { t: 'tool', ts: 2000, step: 'x:a:1', sub: null, name: 'Bash', ms: 400, err: false },
    call(3000, 120_000),
    call(3500, 9_000, { sub: 'tu1' }),
    { t: 'compact', ts: 3600, step: 'x:a:1', sub: null, trigger: 'auto', preTokens: 120_000 },
    { t: 'retry', ts: 3700, step: 'x:a:1', sub: null },
    { t: 'session', ts: 3800, step: 'x:a:1', session: 'S2' },
    call(4000, 30_000, { session: 'S2' }),
    { t: 'result', ts: 4100, step: 'x:a:1', session: 'S2', in: 0, cr: 0, cw: 0, out: 0, ctx: 0, costUsd: 0.5 },
    { t: 'step', ts: 5000, step: 'x:a:1', node: 'a', status: 'done' },
    { t: 'harness', ts: 10_000, windowMs: 10_000, persists: 4, persistMs: 40, persistMaxMs: 20, rows: 8, emits: 2, emitBytes: 3000, emitMaxBytes: 2000, lagP50Ms: 1, lagP99Ms: 9, lagMaxMs: 15 },
    { t: 'end', ts: 11_000, dbBytes: 5 },
  ];
  const text = recs.map((r) => JSON.stringify(r)).join('\n') + '\n{torn';
  const s = summarizeTelemetry(text, { windowOf: (m) => (m === 'claude-opus-5-5' ? { tokens: 1_000_000, from: 'built-in' } : null) });
  const st = s.steps['x:a:1'];
  assert.deepEqual(
    { node: st.node, status: st.status, perCall: st.perCall, calls: st.calls, sessions: st.sessions, peak: st.peak, final: st.final, window: st.window },
    { node: 'a', status: 'done', perCall: true, calls: 3, sessions: 2, peak: 120_000, final: 30_000, window: 1_000_000 });
  assert.deepEqual({ wallMs: st.wallMs, startupMs: st.startupMs, modelMs: st.modelMs, toolMs: st.toolMs }, { wallMs: 4000, startupMs: 500, modelMs: 300, toolMs: 400 });
  assert.deepEqual({ subCalls: st.subCalls, subPeak: st.subPeak, retries: st.retries, costUsd: st.costUsd }, { subCalls: 1, subPeak: 9000, retries: 1, costUsd: 0.5 });
  assert.deepEqual(st.compactions, [{ at: 2600, trigger: 'auto', preTokens: 120_000, sub: null }]);
  assert.deepEqual(st.series, [[1000, 50_000, null, 0], [2000, 120_000, null, 0], [3000, 30_000, null, 1]]);
  assert.equal(s.harness.persistAvgMs, 10);
  assert.equal(s.harness.emitMaxBytes, 2000);
  assert.equal(s.harness.lagMaxMs, 15);
  assert.equal(s.end.dbBytes, 5);
  assert.equal(s.version, 1);
});

test('an engine with no per-call usage: one end-of-session point, marked', () => {
  const s = summarizeTelemetry([
    { t: 'step', ts: 0, step: 'x:b:1', node: 'b', status: 'start' },
    { t: 'result', ts: 900, step: 'x:b:1', session: 'T', in: 100, cr: 400, cw: 0, out: 50, ctx: 500 },
  ]);
  const st = s.steps['x:b:1'];
  assert.equal(st.perCall, false);
  assert.equal(st.peak, 500);
  assert.equal(st.output, 50);
  assert.equal(st.cacheShare, null);
  assert.deepEqual(st.series, [[900, 500, 50, 0]]);
});

test('a sub-agent\'s tool call is not tool time (it spans the sub-agent run)', () => {
  const s = summarizeTelemetry([
    { t: 'tool', ts: 1, step: 'x:d:1', sub: null, name: 'Agent', ms: 60_000, err: false },
    { t: 'tool', ts: 2, step: 'x:d:1', sub: null, name: 'Bash', ms: 500, err: false },
  ]);
  assert.deepEqual([s.steps['x:d:1'].toolMs, s.steps['x:d:1'].toolCalls], [500, 1]);
});

test('output comes from the results when they carry it (a call\'s count is a placeholder)', () => {
  const s = summarizeTelemetry([
    { t: 'call', ts: 1, step: 'x:e:1', sub: null, ctx: 10, out: 1 },
    { t: 'result', ts: 2, step: 'x:e:1', ctx: 10, out: 250 },
  ]);
  assert.equal(s.steps['x:e:1'].output, 250);
  assert.equal(s.steps['x:e:1'].outputFrom, 'result');
  assert.equal(summarizeTelemetry([{ t: 'call', ts: 1, step: 'x:f:1', sub: null, ctx: 10, out: 3 }]).steps['x:f:1'].outputFrom, 'calls');
});

test('an all-zero result is no usage, not a context of 0', () => {
  const s = summarizeTelemetry([{ t: 'result', ts: 1, step: 'x:c:1', in: 0, cr: 0, cw: 0, out: 0, ctx: 0 }]);
  assert.equal(s.steps['x:c:1'].peak, null);
});

test('downsampleMax keeps the largest value of every bucket, so the peak survives', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => [i, i === 777 ? 99_999 : i % 10]);
  const out = downsampleMax(pts, 50);
  assert.equal(out.length, 50);
  assert.ok(out.some((p) => p[1] === 99_999));
  assert.equal(downsampleMax(pts.slice(0, 10), 50).length, 10);
});

test('parseTelemetry skips torn and foreign lines', () => {
  assert.deepEqual(parseTelemetry('{"t":"run"}\nnope\n{"x":1}\n\n'), [{ t: 'run' }]);
});
