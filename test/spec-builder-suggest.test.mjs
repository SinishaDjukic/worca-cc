import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestRoles, clampSuggestion, DEFAULT_SUGGESTION } from '../src/core/spec-builder/suggest.mjs';
const model = () => ({ model: 'claude-haiku-4-5' });

test('the reply is parsed and clamped to known roles, kinds and sizes', async () => {
  const run = async () => ({ text: 'Sure:\n```json\n{"roles":["security","wizard","product","ux"],"kind":"epic","size":"large","reasons":{"security":"adds an API route","wizard":"x"}}\n```' });
  const s = await suggestRoles('Add an API route for charts', { run, resolveModel: model, mock: false });
  assert.deepEqual(s, { roles: ['product', 'ux', 'security'], kind: 'feature', size: 'large', reasons: { security: 'adds an API route' }, source: 'model' });
});

test('a timeout, bad JSON, a throw or no utility model gives the defaults', async () => {
  const want = { ...DEFAULT_SUGGESTION, roles: [...DEFAULT_SUGGESTION.roles], reasons: {}, source: 'default' };
  const hang = ({ signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  assert.deepEqual(await suggestRoles('x', { run: hang, resolveModel: model, timeoutMs: 20, mock: false }), want);
  assert.deepEqual(await suggestRoles('x', { run: async () => ({ text: 'no json here' }), resolveModel: model, mock: false }), want);
  assert.deepEqual(await suggestRoles('x', { run: async () => { throw new Error('boom'); }, resolveModel: model, mock: false }), want);
  let spawned = false;
  assert.deepEqual(await suggestRoles('x', { run: async () => { spawned = true; return { text: '{}' }; }, resolveModel: () => ({ model: null }), mock: false }), want);
  assert.equal(spawned, false);
  assert.equal(clampSuggestion({ roles: 'qa' }), null);
});

test('mock mode returns the defaults with source mock and never spawns', async () => {
  let spawned = false;
  const s = await suggestRoles('x', { run: async () => { spawned = true; return { text: '{}' }; }, resolveModel: model, mock: true });
  assert.deepEqual(s, { ...DEFAULT_SUGGESTION, roles: [...DEFAULT_SUGGESTION.roles], reasons: {}, source: 'mock' });
  assert.equal(spawned, false);
});
