import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope } from '../src/core/graph/script-runner.mjs';

const ctx = (meta, readiness) => ({
  node: { id: 'n1', key: 'k' }, projectDir: '/p', pipelineDir: '/p/.pl',
  script: { meta: { key: 'k', runtime: 'node', ...meta } }, ...(readiness ? { readiness } : {}),
});

test('script-runner adds readiness only when meta.readiness is true', () => {
  const view = { judged: ['claude'] };
  assert.equal('readiness' in buildEnvelope(ctx({}, view)), false);
  assert.equal('readiness' in buildEnvelope(ctx({ readiness: false }, view)), false);
  assert.deepEqual(buildEnvelope(ctx({ readiness: true }, view)).readiness, view);
  assert.equal(buildEnvelope(ctx({ readiness: true })).readiness, null);
});
