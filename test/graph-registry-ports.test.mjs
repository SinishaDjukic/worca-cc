import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { realPortsFn, realAgentMetas } from './helpers/graph-ports.mjs';

test('registryPortsFn resolves builtin ports and synthesizes the await gate', () => {
  const portsFn = registryPortsFn(loadAgentRegistry(undefined, { userAgentsDir: null }));
  const p = portsFn({ id: 'n', kind: 'agent', key: 'implementer', x: 0, y: 0, config: {} });
  assert.deepEqual(p.inputs.map((i) => i.id), ['fix', 'task', 'plan', 'await']);
  assert.deepEqual(p.outputs.map((o) => o.id), ['done']);
  assert.equal(portsFn({ id: 'n', kind: 'agent', key: 'ghost', x: 0, y: 0, config: {} }), undefined);
  assert.deepEqual(portsFn({ id: 'n', kind: 'task', x: 0, y: 0, config: {} }).outputs.map((o) => o.id), ['task']);
  assert.equal(registryPortsFn({})({ kind: 'agent', key: 'x' }), undefined);
});

test('the real-sidecar helper mirrors the registry', () => {
  const metas = realAgentMetas();
  assert.equal(metas.length, 11);
  const a = realPortsFn()({ id: 'n', kind: 'agent', key: 'reviewer', x: 0, y: 0, config: {} });
  const b = registryPortsFn(loadAgentRegistry(undefined, { userAgentsDir: null }))(
    { id: 'n', kind: 'agent', key: 'reviewer', x: 0, y: 0, config: {} });
  assert.deepEqual(a.inputs, b.inputs);
  assert.deepEqual(a.outputs, b.outputs);
});
