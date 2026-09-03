// test/pause-reason-model.test.mjs — the {reason, detail} pause model + pure helpers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { errorDetail, scrubErrorRows, PAUSE_DETAIL_MAX } from '../src/core/run-harness.mjs';

useTempHome(after);

test('errorDetail: whole message, whitespace-collapsed, middle-clipped, never empty', () => {
  assert.equal(errorDetail(new Error('claude exited with code 1:\n  disk full')), 'claude exited with code 1: disk full');
  assert.equal(errorDetail('plain string'), 'plain string');
  assert.equal(errorDetail(null), 'unknown error');
  assert.equal(errorDetail(new Error('')), 'unknown error');
  const long = errorDetail(new Error('x'.repeat(2000) + ' CAUSE'));
  assert.ok(long.length <= PAUSE_DETAIL_MAX);
  assert.match(long, /…/);
  assert.match(long, /CAUSE$/, 'the tail (the cause) survives the clip');
});

test('scrubErrorRows: an error row and the fail-fast\'s skipped collateral become non-terminal paused rows', () => {
  const snap = { version: 2, seq: 3, execs: [
    { executionId: 'x:a:1', status: 'done' },
    { executionId: 'x:b:1', status: 'error', error: 'boom' },
    { executionId: 'x:c:1', status: 'start' },
    { executionId: 'x:d:1', status: 'skipped' },   // aborted mid-flight by failExecution's controller.abort()
  ] };
  const out = scrubErrorRows(snap);
  assert.deepEqual(out.execs.map((e) => e.status), ['done', 'paused', 'start', 'paused']);
  assert.equal('error' in out.execs[1], false, 'the error text is dropped with the terminal mark');
  assert.equal(out.seq, 3);
  assert.equal(scrubErrorRows(null), null);
  const clean = { version: 2, execs: [{ executionId: 'x:a:1', status: 'done' }, { executionId: 'x:e:1', status: 'skipped' }] };
  assert.equal(scrubErrorRows(clean), clean, 'no error row => returned by identity (a legitimate skipped row stays skipped)');
});

test('_setPauseReason: first writer wins, state mirrors it, _clearPauseReason resets both', () => {
  const orch = createOrchestrator({ projectDir: process.cwd(), prompt: 'x', claude: { mock: true } });
  assert.equal(orch._setPauseReason('error', 'boom'), true);
  assert.equal(orch._setPauseReason('cost_total', 'later'), false, 'a sibling unwind never overwrites the cause');
  assert.equal(orch.pauseReason, 'error');
  assert.equal(orch.pauseDetail, 'boom');
  assert.equal(orch.getState().pauseReason, 'error');
  assert.equal(orch.getState().pauseDetail, 'boom');
  orch._clearPauseReason();
  assert.equal(orch.pauseReason, null);
  assert.equal(orch.getState().pauseDetail, null);
});

test('the resume point carries pauseDetail next to pauseReason', () => {
  const orch = createOrchestrator({ projectDir: process.cwd(), prompt: 'x', claude: { mock: true } });
  orch.pipeline = { id: 'p1', dir: '/tmp/p1', promptText: 'x' };   // _buildResumePoint reads pipeline.dir
  orch._setPauseReason('error', 'disk full');
  const rp = orch._buildResumePoint(null);
  assert.equal(rp.pauseReason, 'error');
  assert.equal(rp.pauseDetail, 'disk full');
  assert.equal(rp.snapshot, null);
});
