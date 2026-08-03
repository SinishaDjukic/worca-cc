// test/log-filter.test.mjs
// Pure log-filtering rules for the run-card / history log panes: which lines a
// {source, level, step} filter shows, and which facet values the dropdowns offer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logLineVisible, logFacets } from '../ui/public/log-filter.mjs';

const L = (over = {}) => ({ source: 'planner', level: 'info', text: 'x', ts: 1, ...over });

test('empty filter shows everything', () => {
  assert.equal(logLineVisible(L(), {}), true);
  assert.equal(logLineVisible(L(), { source: '', level: '', step: '' }), true);
  assert.equal(logLineVisible(L({ stepIndex: 3, sub: true }), { source: '', level: '', step: '' }), true);
});

test('level filter is an exact match', () => {
  assert.equal(logLineVisible(L({ level: 'debug' }), { level: 'debug' }), true);
  assert.equal(logLineVisible(L({ level: 'info' }), { level: 'debug' }), false);
  assert.equal(logLineVisible(L({ level: undefined }), { level: 'info' }), true, 'missing level counts as info');
});

test('source filter matches the role and its sub-agents', () => {
  assert.equal(logLineVisible(L({ source: 'planner' }), { source: 'planner' }), true);
  assert.equal(logLineVisible(L({ source: 'planner ▸ research auth' }), { source: 'planner' }), true);
  assert.equal(logLineVisible(L({ source: 'implementer' }), { source: 'planner' }), false);
  assert.equal(logLineVisible(L({ source: 'plannerX' }), { source: 'planner' }), false, 'no bare prefix match');
});

test('step filter matches stepIndex; attribution-less lines only show under all', () => {
  assert.equal(logLineVisible(L({ stepIndex: 2 }), { step: '2' }), true);
  assert.equal(logLineVisible(L({ stepIndex: 0 }), { step: '0' }), true);
  assert.equal(logLineVisible(L({ stepIndex: 1 }), { step: '2' }), false);
  assert.equal(logLineVisible(L(), { step: '2' }), false, 'no stepIndex → hidden when a step is chosen');
  assert.equal(logLineVisible(L(), { step: '' }), true);
});

test('filters compose (AND)', () => {
  const rec = L({ source: 'planner ▸ research auth', level: 'debug', stepIndex: 1 });
  assert.equal(logLineVisible(rec, { source: 'planner', level: 'debug', step: '1' }), true);
  assert.equal(logLineVisible(rec, { source: 'planner', level: 'info', step: '1' }), false);
  assert.equal(logLineVisible(rec, { source: 'reviewer', level: 'debug', step: '1' }), false);
});

test('logFacets collects distinct levels, parent-role sources, and sorted steps', () => {
  const facets = logFacets([
    L({ source: 'planner', level: 'info', stepIndex: 0 }),
    L({ source: 'planner ▸ research auth', level: 'debug', stepIndex: 0, sub: true }),
    L({ source: 'implementer', level: 'debug', stepIndex: 2 }),
    L({ source: 'orchestrator', level: 'warn' }), // no stepIndex → no step facet
    L({ source: 'implementer', level: 'debug', stepIndex: 1 }),
  ]);
  assert.deepEqual(facets.sources, ['implementer', 'orchestrator', 'planner']);
  assert.deepEqual(facets.levels, ['debug', 'info', 'warn']);
  assert.deepEqual(facets.steps, [0, 1, 2]);
});

test('logFacets is safe on empty/malformed input', () => {
  assert.deepEqual(logFacets([]), { sources: [], levels: [], steps: [] });
  const facets = logFacets([{ text: 'no source or level' }]);
  assert.deepEqual(facets.sources, []);
  assert.deepEqual(facets.levels, ['info']);
  assert.deepEqual(facets.steps, []);
});
