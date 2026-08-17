// A decomposed task failure must log the SAME terminal error line a normal
// node failure logs — previously the decomposed path bypassed _runNode's catch
// and a failed run produced ZERO error-level lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

function loggedOrch() {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  return { orch, logs };
}

test('_logStepFailure logs one clipped error line with attribution + stream passthrough', () => {
  const { orch, logs } = loggedOrch();
  const err = Object.assign(new Error(`claude exited with code 1: ${'x'.repeat(5000)}`), { stream: 'err' });
  orch._logStepFailure({ key: 'implementer', nodeId: 'n7' }, 3, 2, err);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'error');
  assert.match(logs[0].text, /^step failed: claude exited with code 1/);
  assert.ok(logs[0].text.length <= 520, `clipped (got ${logs[0].text.length})`);
  assert.equal(logs[0].stream, 'err');
  assert.equal(logs[0].nodeId, 'n7');
  assert.equal(logs[0].stepIndex, 3);
  assert.equal(logs[0].cycle, 2);
});

test('_logStepFailure stays silent for aborts and pauses', () => {
  const { orch, logs } = loggedOrch();
  const ab = new Error('aborted'); ab.name = 'AbortError';
  const pa = new Error('paused'); pa.name = 'PauseError';
  orch._logStepFailure({ key: 'implementer', nodeId: 'n1' }, 0, 1, ab);
  orch._logStepFailure({ key: 'implementer', nodeId: 'n1' }, 0, 1, pa);
  assert.equal(logs.length, 0);
});

test('a decomposed task failure logs the ONE terminal error line', async () => {
  const { orch, logs } = loggedOrch();
  orch.pipeline = { id: 'p-test-decomp', dir: '/tmp/proj' };
  // orch.abort / orch.pauseAbort are AbortControllers from the constructor
  // (orchestrator.mjs:318-320) — no stubbing needed for ctx.signal.
  // Stub the node machinery: this test pins the catch's logging contract only.
  orch._nodeStep = () => {};
  orch._nodeCtx = () => ({});
  orch._bindNodeIo = () => ({});
  orch._runNodeAttempts = async () => {
    throw Object.assign(new Error('claude exited with code 1: kaboom'), { stream: 'err' });
  };
  const taskNode = { key: 'implementer', nodeId: 's_impl_p1_t1', runnerType: 'producer' };
  await assert.rejects(() =>
    orch._runDecomposedTask(taskNode, { id: 'p1t1', title: 'Slice one' }, 2, 1, {}, new AbortController()));
  const errLines = logs.filter((l) => l.level === 'error');
  assert.equal(errLines.length, 1, 'exactly one terminal error line');
  assert.match(errLines[0].text, /step failed: .*kaboom/);
  assert.equal(errLines[0].stream, 'err');
  assert.equal(errLines[0].nodeId, 's_impl_p1_t1');
});

test('an aborted decomposed task (sibling failure cancel) logs no error line', async () => {
  const { orch, logs } = loggedOrch();
  orch.pipeline = { id: 'p-test-decomp', dir: '/tmp/proj' };
  orch._nodeStep = () => {};
  orch._nodeCtx = () => ({});
  orch._bindNodeIo = () => ({});
  orch._runNodeAttempts = async () => {
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  };
  await assert.rejects(() =>
    orch._runDecomposedTask({ key: 'implementer', nodeId: 's_impl_p1_t2', runnerType: 'producer' },
      { id: 'p1t2', title: 'Slice two' }, 2, 1, {}, new AbortController()));
  assert.equal(logs.filter((l) => l.level === 'error').length, 0);
});
