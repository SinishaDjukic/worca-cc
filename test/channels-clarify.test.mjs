import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, publish, legacyFields } from '../src/core/channels.mjs';

test('allocate(clarify) points at clarify.json in the pipeline dir', () => {
  const out = allocate('clarify', { projectDir: '/p', pipelineDir: '/p/.worca-cc/run', baseName: 'demo', datePrefix: '01-01-26', cycle: 1, key: 'clarify' });
  assert.equal(out.kind, 'clarify');
  assert.equal(out.path, '/p/.worca-cc/run/clarify.json');
});

test('publish(clarify) folds questions+answers onto the bus', () => {
  const bus = {};
  const outputs = { clarify: { kind: 'clarify', path: '/p/run/clarify.json' } };
  const result = { questions: [{ id: 'q1' }], answers: [{ id: 'q1', question: 'Q?', choice: 'A' }] };
  publish(['clarify'], result, outputs, bus);
  assert.equal(bus.clarify.kind, 'clarify');
  assert.deepEqual(bus.clarify.answers, [{ id: 'q1', question: 'Q?', choice: 'A' }]);
  assert.deepEqual(bus.clarify.questions, [{ id: 'q1' }]);
});

test('planner legacyFields reads answers from the clarify channel (falls back to userPrompt)', () => {
  const node = { key: 'planner' };
  const fromClarify = legacyFields(node, { clarify: { answers: [{ id: 'q1', choice: 'A' }] } }, { plan: { path: '/p/plan.md' } }, 1, 'demo');
  assert.deepEqual(fromClarify.answers, [{ id: 'q1', choice: 'A' }]);
  const fromPrompt = legacyFields(node, { userPrompt: { answers: [{ id: 'q2', choice: 'B' }] } }, { plan: { path: '/p/plan.md' } }, 1, 'demo');
  assert.deepEqual(fromPrompt.answers, [{ id: 'q2', choice: 'B' }]);
  const none = legacyFields(node, {}, { plan: { path: '/p/plan.md' } }, 1, 'demo');
  assert.deepEqual(none.answers, []);
});
