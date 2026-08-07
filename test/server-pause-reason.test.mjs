// test/server-pause-reason.test.mjs — the SERVER half of cost-pause reload parity
// (plan Task 20, item 2). wireRun's done branch must remember the pause reason on
// the run entry, and summarizeRuns must carry it into every `hello` frame, so a
// reload or a WS reconnect restores the cost banner instead of a plain "Paused"
// card. Asserted behaviourally against the real entries (mirrors
// server-event-names.test.mjs / ui-server-stepper-seed.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runs, _testing } from '../ui/server.mjs';

function makeEntry(overrides = {}) {
  return {
    id: 'uuid-PR1',
    orch: new EventEmitter(),
    projectDir: '/tmp/x',
    title: 't',
    status: 'running',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: null,
    ...overrides,
  };
}

test("wireRun: a cost pause stores done.reason on the entry as pauseReason", () => {
  const entry = makeEntry({ id: 'uuid-PR1' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('done', { status: 'paused', reason: 'cost_pipeline' });
    assert.equal(entry.status, 'paused');
    assert.equal(entry.pauseReason, 'cost_pipeline');
  } finally {
    runs.delete(entry.id);
  }
});

test('wireRun: a reasonless done clears pauseReason to null (never stale)', () => {
  const entry = makeEntry({ id: 'uuid-PR2', pauseReason: 'cost_total' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('done', { status: 'done' });
    assert.equal(entry.pauseReason, null);
  } finally {
    runs.delete(entry.id);
  }
});

test('summarizeRuns carries pauseReason (null when the run never cost-paused)', () => {
  const paused = makeEntry({ id: 'uuid-PR3', status: 'paused', pauseReason: 'cost_total' });
  const plain = makeEntry({ id: 'uuid-PR4' });
  runs.set(paused.id, paused);
  runs.set(plain.id, plain);
  try {
    const summary = _testing.summarizeRuns();
    const a = summary.find((r) => r.runId === 'uuid-PR3');
    const b = summary.find((r) => r.runId === 'uuid-PR4');
    assert.ok(a && b, 'both runs summarized');
    assert.equal(a.pauseReason, 'cost_total', 'hello run-summary carries the pause reason');
    assert.equal(b.pauseReason, null, 'absent reason summarizes as null, not undefined');
    assert.ok('pauseReason' in b, 'the key is always present on the wire');
  } finally {
    runs.delete(paused.id);
    runs.delete(plain.id);
  }
});

test('end to end: wireRun done -> summarizeRuns is what a reloading client sees', () => {
  const entry = makeEntry({ id: 'uuid-PR5', pipelineId: 'pl_9' });
  runs.set(entry.id, entry);
  try {
    _testing.wireRun(entry);
    entry.orch.emit('done', { status: 'paused', reason: 'cost_pipeline' });
    const sum = _testing.summarizeRuns().find((r) => r.runId === 'uuid-PR5');
    assert.equal(sum.status, 'paused');
    assert.equal(sum.pauseReason, 'cost_pipeline');
    assert.equal(sum.pipelineId, 'pl_9');
  } finally {
    runs.delete(entry.id);
  }
});
