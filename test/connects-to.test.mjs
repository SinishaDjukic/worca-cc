import test from 'node:test';
import assert from 'node:assert/strict';
import { canConnect, mergePalette, EMBEDDED_AGENTS } from '../ui/public/composer-core.mjs';

const AGENTS = {
  planner: { key: 'planner', connectsTo: ['refiner', 'implementer'] },
  reviewer: { key: 'reviewer', connectsTo: ['implementer'] },
  refiner: { key: 'refiner', connectsTo: '*' },
};

test('canConnect honors an allow-list and the * wildcard', () => {
  assert.equal(canConnect('planner', 'refiner', AGENTS).ok, true);
  assert.equal(canConnect('planner', 'reviewer', AGENTS).ok, false);
  assert.equal(canConnect('refiner', 'anything', AGENTS).ok, true); // '*'
  assert.equal(canConnect('unknownKey', 'refiner', AGENTS).ok, true); // unknown => permissive
});

test('mergePalette carries connectsTo/produces/consumes through to the UI', () => {
  const merged = mergePalette({ agents: [{ key: 'x', connectsTo: ['y'], produces: ['plan'], consumes: ['userPrompt'], order: 1 }] });
  assert.deepEqual(merged[0].connectsTo, ['y']);
  assert.deepEqual(merged[0].produces, ['plan']);
});

test('every EMBEDDED_AGENTS entry carries connectsTo (offline fallback governs)', () => {
  for (const a of Object.values(EMBEDDED_AGENTS)) {
    assert.ok(a.connectsTo === '*' || Array.isArray(a.connectsTo), `${a.key} connectsTo`);
  }
});
