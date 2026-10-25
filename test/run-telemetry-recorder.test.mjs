// test/run-telemetry-recorder.test.mjs — src/core/telemetry/recorder.mjs: normalized agent events and
// harness work in, compact NDJSON records out; never throws into the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryRecorder, usageFields } from '../src/core/telemetry/recorder.mjs';

function setup({ pushThrows = false } = {}) {
  const lines = [];
  let t = 1000;
  const writer = {
    bound: null,
    closed: false,
    bind(dir) { this.bound = dir; },
    push(r) { if (pushThrows) throw new Error('disk full'); lines.push(r); },
    close() { this.closed = true; return Promise.resolve(); },
  };
  const rec = createTelemetryRecorder({ writer, now: () => t, lag: false, windowMs: 60_000 });
  return { rec, lines, writer, tick: (ms) => { t += ms; } };
}

const ATTR = { stepKey: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl' };
const u = (input, cr, cw, out) => ({ input_tokens: input, cache_read_input_tokens: cr, cache_creation_input_tokens: cw, output_tokens: out });

test('usageFields: ctx is input + cache read + cache write; junk reads as 0', () => {
  assert.deepEqual(usageFields(u(10, 200, 30, 5)), { in: 10, cr: 200, cw: 30, out: 5, ctx: 240 });
  assert.deepEqual(usageFields(null), { in: 0, cr: 0, cw: 0, out: 0, ctx: 0 });
});

test('a Claude-shaped step: one call per message id, its tools, tool time, sub-agent calls apart, result', async () => {
  const { rec, lines, writer, tick } = setup();
  rec.bind('/run/dir');
  assert.equal(writer.bound, '/run/dir');
  rec.stepStatus('x:n_impl:1', 'n_impl', 'start');
  tick(500);
  rec.observe({ type: 'session', sessionId: null, model: 'claude-opus-5-5', init: true }, ATTR);
  rec.observe({ type: 'session', sessionId: 'S1' }, ATTR);
  tick(2000);
  // The CLI repeats a message's usage on every content block: one call, latest usage kept.
  rec.observe({ type: 'usage', messageId: 'm1', parentId: null, phase: 'message', model: 'claude-opus-5-5', usage: u(5, 1000, 100, 1) }, ATTR);
  rec.observe({ type: 'tool', parentId: null, messageId: 'm1', calls: [{ name: 'Bash', toolUseId: 'tu1' }, { name: 'Agent', toolUseId: 'tu2' }] }, ATTR);
  rec.observe({ type: 'usage', messageId: 'm1', parentId: null, phase: 'message', model: 'claude-opus-5-5', usage: u(5, 1000, 100, 40) }, ATTR);
  tick(300);
  rec.observe({ type: 'subagent', event: 'spawn', toolUseId: 'tu2', subagentType: 'Explore' }, ATTR);
  rec.observe({ type: 'usage', messageId: 's1', parentId: 'tu2', phase: 'message', usage: u(3, 0, 5000, 10) }, ATTR);
  tick(700);
  rec.observe({ type: 'toolResult', parentId: null, results: [{ toolUseId: 'tu1', isError: true }] }, ATTR);
  rec.observe({ type: 'retry', parentId: null, attempt: 1, httpStatus: 529, reason: 'overloaded', delayMs: 2000 }, ATTR);
  rec.observe({ type: 'compact', parentId: null, trigger: 'auto', preTokens: 150000 }, ATTR);
  tick(1000);
  rec.observe({ type: 'usage', messageId: 'm2', parentId: null, phase: 'message', usage: u(2, 1100, 0, 7) }, ATTR);
  // start/delta usage only exists on partial-message streams: never a call of its own.
  rec.observe({ type: 'usage', messageId: 'm3', parentId: null, phase: 'start', usage: u(1, 1, 1, 1) }, ATTR);
  rec.observe({ type: 'result', usage: u(7, 2100, 100, 47), costUsd: 0.12, cumulativeCost: true, numTurns: 2 }, ATTR);
  rec.stepStatus('x:n_impl:1', 'n_impl', 'done');
  await rec.close({ dbBytes: 10 });

  const calls = lines.filter((r) => r.t === 'call');
  assert.equal(calls.length, 3, 'm1, the sub-agent call, m2');
  const m1 = calls.find((c) => c.msg === 'm1');
  assert.deepEqual({ ctx: m1.ctx, out: m1.out, tools: m1.tools, sub: m1.sub, session: m1.session, gapMs: m1.gapMs },
    { ctx: 1105, out: 40, tools: ['Bash', 'Agent'], sub: null, session: 'S1', gapMs: 2000 });
  const sub = calls.find((c) => c.sub === 'tu2');
  assert.equal(sub.ctx, 5003);
  const m2 = calls.find((c) => c.msg === 'm2');
  assert.equal(m2.gapMs, 1000, 'from the tool result to the next call');
  assert.deepEqual(lines.find((r) => r.t === 'tool'), { t: 'tool', ts: 3500, step: 'x:n_impl:1', sub: null, name: 'Bash', ms: 1000, err: true });
  assert.equal(lines.find((r) => r.t === 'retry').status, 529);
  assert.equal(lines.find((r) => r.t === 'compact').preTokens, 150000);
  assert.equal(lines.find((r) => r.t === 'agent').type, 'Explore');
  const result = lines.find((r) => r.t === 'result');
  assert.deepEqual({ ctx: result.ctx, costUsd: result.costUsd, cumulative: result.cumulative, session: result.session }, { ctx: 2207, costUsd: 0.12, cumulative: true, session: 'S1' });
  assert.deepEqual(lines.filter((r) => r.t === 'step').map((r) => r.status), ['start', 'done']);
  assert.equal(lines[0].t, 'run');
  assert.deepEqual(lines[lines.length - 1], { t: 'end', ts: 5500, dbBytes: 10 });
  assert.ok(writer.closed);
});

test('an engine whose usage events carry no message id: each one is its own call', () => {
  const { rec, lines } = setup();
  rec.bind('/d');
  rec.observe({ type: 'usage', messageId: null, parentId: null, phase: 'message', usage: u(10, 0, 0, 1) }, ATTR);
  rec.observe({ type: 'usage', messageId: null, parentId: null, phase: 'message', usage: u(20, 0, 0, 1) }, ATTR);
  rec.stepStatus('x:n_impl:1', 'n_impl', 'done');
  assert.deepEqual(lines.filter((r) => r.t === 'call').map((r) => r.ctx), [10, 20]);
});

test('a call still open when a new spawn names its session keeps the old session', () => {
  const { rec, lines } = setup();
  rec.bind('/d');
  rec.observe({ type: 'session', sessionId: 'S1' }, ATTR);
  rec.observe({ type: 'usage', messageId: 'm1', parentId: null, phase: 'message', usage: u(1, 0, 0, 1) }, ATTR);
  rec.observe({ type: 'session', sessionId: 'S2' }, ATTR);   // a retry: the first spawn never closed m1
  rec.observe({ type: 'usage', messageId: 'm2', parentId: null, phase: 'message', usage: u(2, 0, 0, 1) }, ATTR);
  rec.stepStatus('x:n_impl:1', 'n_impl', 'done');
  assert.deepEqual(lines.filter((r) => r.t === 'call').map((r) => [r.msg, r.session]), [['m1', 'S1'], ['m2', 'S2']]);
});

test('a late content block of a written call is not a second call; a session total (Goose) is no call', () => {
  const { rec, lines } = setup();
  rec.bind('/d');
  rec.observe({ type: 'usage', messageId: 'm1', parentId: null, phase: 'message', usage: u(1, 0, 0, 1) }, ATTR);
  rec.observe({ type: 'toolResult', parentId: null, results: [] }, ATTR);
  rec.observe({ type: 'usage', messageId: 'm1', parentId: null, phase: 'message', usage: u(1, 0, 0, 9) }, ATTR);
  rec.observe({ type: 'usage', messageId: null, parentId: null, phase: 'message', usage: u(500, 0, 0, 90), total: true }, ATTR);
  rec.stepStatus('x:n_impl:1', 'n_impl', 'done');
  assert.deepEqual(lines.filter((r) => r.t === 'call').map((r) => r.msg), ['m1']);
});

test('events with no step are ignored; harness work is windowed', async () => {
  const { rec, lines } = setup();
  rec.bind('/d');
  rec.observe({ type: 'usage', messageId: 'm', parentId: null, phase: 'message', usage: u(1, 0, 0, 1) }, null);
  rec.persisted(12.4, 6);
  rec.persisted(30.2, 6);
  rec.stateEmitted({ a: 'x'.repeat(100) });
  await rec.close();
  assert.equal(lines.filter((r) => r.t === 'call').length, 0);
  const h = lines.find((r) => r.t === 'harness');
  assert.deepEqual({ persists: h.persists, persistMs: h.persistMs, persistMaxMs: h.persistMaxMs, rows: h.rows, emits: h.emits },
    { persists: 2, persistMs: 43, persistMaxMs: 30, rows: 12, emits: 1 });
  assert.equal(h.emitBytes, JSON.stringify({ a: 'x'.repeat(100) }).length);
});

test('a failing writer never throws into the run', async () => {
  const { rec } = setup({ pushThrows: true });
  assert.doesNotThrow(() => {
    rec.bind('/d');
    rec.observe({ type: 'usage', messageId: 'm', parentId: null, phase: 'message', usage: u(1, 0, 0, 1) }, ATTR);
    rec.stepStatus('x:n_impl:1', 'n_impl', 'done');
    rec.persisted(1, 1);
    rec.stateEmitted({ a: 1n });   // BigInt: JSON.stringify throws
  });
  await assert.doesNotReject(() => Promise.resolve(rec.close()));
});
