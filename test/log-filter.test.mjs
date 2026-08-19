// test/log-filter.test.mjs
// Pure log-filtering rules for the run-card / history log panes: which lines a
// {source, level, step} filter shows, and which facet values the dropdowns offer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logLineVisible, logFacets, compileLogFilter } from '../ui/public/log-filter.mjs';

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
  assert.deepEqual(logFacets([]), { sources: [], levels: [], steps: [], cycles: [] });
  const facets = logFacets([{ text: 'no source or level' }]);
  assert.deepEqual(facets.sources, []);
  assert.deepEqual(facets.levels, ['info']);
  assert.deepEqual(facets.steps, []);
  assert.deepEqual(facets.cycles, []);
});

// ── cycle (the feedback-loop rewind counter, orthogonal to step) ─────────────

test('cycle filter matches rec.cycle; attribution-less lines only show under all', () => {
  assert.equal(logLineVisible(L({ cycle: 2 }), { cycle: '2' }), true);
  assert.equal(logLineVisible(L({ cycle: 1 }), { cycle: '2' }), false);
  assert.equal(logLineVisible(L(), { cycle: '1' }), false, 'no cycle → hidden when a cycle is chosen');
  assert.equal(logLineVisible(L(), { cycle: '' }), true);
});

test('cycle and step are independent axes (a re-run keeps its stepIndex)', () => {
  const firstPass = L({ stepIndex: 2, cycle: 1 });
  const reRun = L({ stepIndex: 2, cycle: 2 });
  assert.equal(logLineVisible(firstPass, { step: '2' }), true);
  assert.equal(logLineVisible(reRun, { step: '2' }), true, 'both passes share the step');
  assert.equal(logLineVisible(firstPass, { step: '2', cycle: '2' }), false);
  assert.equal(logLineVisible(reRun, { step: '2', cycle: '2' }), true);
});

test('logFacets collects cycles, sorted numerically', () => {
  const facets = logFacets([
    L({ cycle: 3 }), L({ cycle: 1 }), L({ cycle: 2 }), L({ cycle: 1 }), L(), // cycle-less → no facet
  ]);
  assert.deepEqual(facets.cycles, [1, 2, 3]);
});

// ── search ──────────────────────────────────────────────────────────────────

test('search is a case-insensitive substring of the text', () => {
  assert.equal(logLineVisible(L({ text: 'Building the graph' }), { search: 'graph' }), true);
  assert.equal(logLineVisible(L({ text: 'Building the graph' }), { search: 'GRAPH' }), true);
  assert.equal(logLineVisible(L({ text: 'Building the graph' }), { search: 'missing' }), false);
  assert.equal(logLineVisible(L({ text: 'x' }), { search: '' }), true, 'empty term shows all');
});

test('search matches the text only, not the source', () => {
  assert.equal(logLineVisible(L({ source: 'planner', text: 'hello' }), { search: 'planner' }), false);
});

test('search is safe on a text-less record', () => {
  assert.equal(logLineVisible({ source: 'planner' }, { search: 'x' }), false);
  assert.equal(logLineVisible({ source: 'planner' }, { search: '' }), true);
});

test('search composes with the dropdown axes (AND)', () => {
  const rec = L({ source: 'implementer', level: 'debug', stepIndex: 1, cycle: 2, text: '→ Read a.js' });
  assert.equal(logLineVisible(rec, { source: 'implementer', level: 'debug', step: '1', cycle: '2', search: 'read' }), true);
  assert.equal(logLineVisible(rec, { source: 'implementer', level: 'debug', step: '1', cycle: '2', search: 'write' }), false);
  assert.equal(logLineVisible(rec, { source: 'planner', search: 'read' }), false);
});

// ── compiled filters ────────────────────────────────────────────────────────

test('compileLogFilter matches logLineVisible on every axis', () => {
  const recs = [
    L({ source: 'implementer', level: 'debug', stepIndex: 1, cycle: 2, text: '→ Read a.js' }),
    L({ source: 'planner', text: 'hello' }),
    L({ cycle: 1 }), L({}),
  ];
  const filters = [
    null, {}, { search: 'READ' }, { level: 'debug' }, { source: 'implementer' },
    { step: '1' }, { cycle: '2' }, { source: 'implementer', level: 'debug', step: '1', cycle: '2', search: 'read' },
  ];
  for (const f of filters) {
    const pred = compileLogFilter(f);
    for (const rec of recs) assert.equal(pred(rec), logLineVisible(rec, f), JSON.stringify({ f, rec }));
  }
});

test('compileLogFilter lowercases the term once, at compile time', () => {
  let reads = 0;
  const filter = { get search() { reads++; return 'GRAPH'; } };
  const pred = compileLogFilter(filter);
  const before = reads;
  pred(L({ text: 'building the graph' }));
  pred(L({ text: 'no match here' }));
  assert.equal(reads, before, 'the filter object is not re-read per record');
});
