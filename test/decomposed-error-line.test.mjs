// _logStepFailure is the ONE terminal error line every failed execution logs
// (attribution + stream passthrough + a TAIL-preserving clip). The three
// v1-decomposition drivers that used to live here died with the v1 engine; the
// graph engine's composite slices are covered by test/graph-scheduler and
// test/orchestrator-graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

function loggedOrch() {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  return { orch, logs };
}

const EXEC = { nodeId: 'n7', executionId: 'x:n7:2', ordinal: 2 };

test('_logStepFailure logs one clipped error line with attribution + stream passthrough', () => {
  const { orch, logs } = loggedOrch();
  const err = Object.assign(new Error(`claude exited with code 1: ${'x'.repeat(5000)}`), { stream: 'err' });
  orch._logStepFailure({ key: 'implementer' }, EXEC, err);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'error');
  assert.match(logs[0].text, /^execution failed: claude exited with code 1/);
  assert.ok(logs[0].text.length <= 520, `clipped (got ${logs[0].text.length})`);
  assert.equal(logs[0].stream, 'err');
  assert.equal(logs[0].nodeId, 'n7');
  assert.equal(logs[0].executionId, 'x:n7:2');
  assert.equal(logs[0].cycle, 2);
});

test('_logStepFailure stays silent for aborts and pauses', () => {
  const { orch, logs } = loggedOrch();
  const ab = new Error('aborted'); ab.name = 'AbortError';
  const pa = new Error('paused'); pa.name = 'PauseError';
  orch._logStepFailure({ key: 'implementer' }, EXEC, ab);
  orch._logStepFailure({ key: 'implementer' }, EXEC, pa);
  assert.equal(logs.length, 0);
});

test('_logStepFailure keeps the TAIL of a long message — the terminal cause — not just the head', () => {
  const { orch, logs } = loggedOrch();
  // Asymmetric on purpose: the symmetric 'x'.repeat(5000) test above cannot
  // tell a head clip from a tail clip, which is how the head-clip regression
  // shipped. The runner tail-caps because the cause sits at the END.
  const err = new Error(`claude exited with code 1: ${'x'.repeat(600)} ROOT CAUSE: repo not clean`);
  orch._logStepFailure({ key: 'implementer' }, EXEC, err);
  assert.equal(logs.length, 1);
  assert.match(logs[0].text, /^execution failed: claude exited with code 1/, 'frame (head) survives');
  assert.match(logs[0].text, /ROOT CAUSE: repo not clean$/, 'the cause (tail) survives');
  assert.ok(logs[0].text.length <= 520, `still clipped (got ${logs[0].text.length})`);
});
