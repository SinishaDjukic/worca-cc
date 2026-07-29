import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_IDS, allocate, publish, legacyFields } from '../src/core/channels.mjs';

test('decomposition is a known channel id', () => {
  assert.ok(CHANNEL_IDS.includes('decomposition'));
});

test('allocate(decomposition) -> decomposition.json in the pipeline dir', () => {
  const h = allocate('decomposition', { pipelineDir: '/run/p1' });
  assert.deepEqual(h, { kind: 'artifact', path: '/run/p1/decomposition.json' });
});

test('publish folds the decomposer result onto bus.decomposition', () => {
  const bus = {};
  const outputs = { decomposition: { path: '/run/p1/decomposition.json' } };
  const result = { decompositionPath: '/run/p1/decomposition.json', decomposition: { phases: [{ ordinal: 1, tasks: [] }] } };
  publish(['decomposition'], result, outputs, bus);
  assert.equal(bus.decomposition.path, '/run/p1/decomposition.json');
  assert.deepEqual(bus.decomposition.phases, [{ ordinal: 1, tasks: [] }]);
});

test('legacyFields(decomposer) names planPath + decompositionPath', () => {
  const node = { key: 'decomposer' };
  const inputs = { plan: { path: '/plans/x.md' } };
  const outputs = { decomposition: { path: '/run/p1/decomposition.json' } };
  const f = legacyFields(node, inputs, outputs, 1, 'x');
  assert.equal(f.planPath, '/plans/x.md');
  assert.equal(f.decompositionPath, '/run/p1/decomposition.json');
});
