// test/log-filter.test.mjs
// Pure log-filtering rules for the run-card / history log panes: which lines a
// {source, level, step} filter shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logLineVisible, compileLogFilter } from '../ui/public/log-filter.mjs';
import { checkRows } from './helpers/rows.mjs';

const L = (over = {}) => ({ source: 'planner', level: 'info', text: 'x', ts: 1, ...over });

test('logLineVisible: empty filter, then each axis (level, source, step, cycle, node, execution) incl. null/undefined literal guards', async () => {
  await checkRows([
    { name: 'empty filter shows everything', run: () => {
      assert.equal(logLineVisible(L(), {}), true);
      assert.equal(logLineVisible(L(), { source: '', level: '', step: '' }), true);
      assert.equal(logLineVisible(L({ stepIndex: 3, sub: true }), { source: '', level: '', step: '' }), true);
    } },
    { name: 'level filter is an exact match', run: () => {
      assert.equal(logLineVisible(L({ level: 'debug' }), { level: 'debug' }), true);
      assert.equal(logLineVisible(L({ level: 'info' }), { level: 'debug' }), false);
      assert.equal(logLineVisible(L({ level: undefined }), { level: 'info' }), true, 'missing level counts as info');
    } },
    { name: 'source filter matches the role and its sub-agents', run: () => {
      assert.equal(logLineVisible(L({ source: 'planner' }), { source: 'planner' }), true);
      assert.equal(logLineVisible(L({ source: 'planner ▸ research auth' }), { source: 'planner' }), true);
      assert.equal(logLineVisible(L({ source: 'implementer' }), { source: 'planner' }), false);
      assert.equal(logLineVisible(L({ source: 'plannerX' }), { source: 'planner' }), false, 'no bare prefix match');
    } },
    { name: 'step filter matches stepIndex; attribution-less lines only show under all', run: () => {
      assert.equal(logLineVisible(L({ stepIndex: 2 }), { step: '2' }), true);
      assert.equal(logLineVisible(L({ stepIndex: 0 }), { step: '0' }), true);
      assert.equal(logLineVisible(L({ stepIndex: 1 }), { step: '2' }), false);
      assert.equal(logLineVisible(L(), { step: '2' }), false, 'no stepIndex → hidden when a step is chosen');
      assert.equal(logLineVisible(L(), { step: '' }), true);
    } },
    { name: 'cycle filter matches rec.cycle; attribution-less lines only show under all', run: () => {
      // cycle: the feedback-loop rewind counter, orthogonal to step
      assert.equal(logLineVisible(L({ cycle: 2 }), { cycle: '2' }), true);
      assert.equal(logLineVisible(L({ cycle: 1 }), { cycle: '2' }), false);
      assert.equal(logLineVisible(L(), { cycle: '1' }), false, 'no cycle → hidden when a cycle is chosen');
      assert.equal(logLineVisible(L(), { cycle: '' }), true);
    } },
    { name: 'node axis matches rec.nodeId; attribution-less lines only show under all', run: () => {
      // node / execution: the v2 graph attribution
      assert.equal(logLineVisible(L({ nodeId: 'n_impl' }), { node: 'n_impl' }), true);
      assert.equal(logLineVisible(L({ nodeId: 'n_plan' }), { node: 'n_impl' }), false);
      assert.equal(logLineVisible(L(), { node: 'n_impl' }), false, 'no nodeId → hidden when a node is chosen');
      assert.equal(logLineVisible(L(), { node: '' }), true);
      // The `== null` half of the guard is what keeps the literal ids 'null' /
      // 'undefined' from matching an unattributed line (String(null) === 'null').
      assert.equal(logLineVisible(L({ nodeId: null }), { node: 'null' }), false, 'a null nodeId never matches the literal "null"');
      assert.equal(logLineVisible(L(), { node: 'undefined' }), false, 'a missing nodeId never matches the literal "undefined"');
    } },
    { name: 'execution axis matches rec.executionId and composes with the others', run: () => {
      const rec = L({ nodeId: 'n_impl', executionId: 'x:n_impl:2', level: 'debug', cycle: 2 });
      assert.equal(logLineVisible(rec, { execution: 'x:n_impl:2' }), true);
      assert.equal(logLineVisible(rec, { execution: 'x:n_impl:1' }), false);
      assert.equal(logLineVisible(rec, { execution: 'x:n_impl:2', level: 'debug', cycle: '2' }), true);
      assert.equal(logLineVisible(rec, { execution: 'x:n_impl:2', level: 'info' }), false);
      assert.equal(logLineVisible(L(), { execution: 'x:n_impl:2' }), false);
      assert.equal(logLineVisible(L({ executionId: null }), { execution: 'null' }), false, 'a null executionId never matches the literal "null"');
      assert.equal(logLineVisible(L(), { execution: 'undefined' }), false, 'a missing executionId never matches the literal "undefined"');
    } },
  ]);
});

test('logLineVisible: axes compose (AND); cycle and step are independent', async () => {
  await checkRows([
    { name: 'filters compose (AND)', run: () => {
      const rec = L({ source: 'planner ▸ research auth', level: 'debug', stepIndex: 1 });
      assert.equal(logLineVisible(rec, { source: 'planner', level: 'debug', step: '1' }), true);
      assert.equal(logLineVisible(rec, { source: 'planner', level: 'info', step: '1' }), false);
      assert.equal(logLineVisible(rec, { source: 'reviewer', level: 'debug', step: '1' }), false);
    } },
    { name: 'cycle and step are independent axes (a re-run keeps its stepIndex)', run: () => {
      const firstPass = L({ stepIndex: 2, cycle: 1 });
      const reRun = L({ stepIndex: 2, cycle: 2 });
      assert.equal(logLineVisible(firstPass, { step: '2' }), true);
      assert.equal(logLineVisible(reRun, { step: '2' }), true, 'both passes share the step');
      assert.equal(logLineVisible(firstPass, { step: '2', cycle: '2' }), false);
      assert.equal(logLineVisible(reRun, { step: '2', cycle: '2' }), true);
    } },
    { name: 'search composes with the dropdown axes (AND)', run: () => {
      const rec = L({ source: 'implementer', level: 'debug', stepIndex: 1, cycle: 2, text: '→ Read a.js' });
      assert.equal(logLineVisible(rec, { source: 'implementer', level: 'debug', step: '1', cycle: '2', search: 'read' }), true);
      assert.equal(logLineVisible(rec, { source: 'implementer', level: 'debug', step: '1', cycle: '2', search: 'write' }), false);
      assert.equal(logLineVisible(rec, { source: 'planner', search: 'read' }), false);
    } },
  ]);
});

// ── search ──────────────────────────────────────────────────────────────────

test('logLineVisible: search is a case-insensitive substring of text only, safe on text-less records', async () => {
  await checkRows([
    { name: 'search is a case-insensitive substring of the text', run: () => {
      assert.equal(logLineVisible(L({ text: 'Building the graph' }), { search: 'graph' }), true);
      assert.equal(logLineVisible(L({ text: 'Building the graph' }), { search: 'GRAPH' }), true);
      assert.equal(logLineVisible(L({ text: 'Building the graph' }), { search: 'missing' }), false);
      assert.equal(logLineVisible(L({ text: 'x' }), { search: '' }), true, 'empty term shows all');
    } },
    { name: 'search matches the text only, not the source', run: () => {
      assert.equal(logLineVisible(L({ source: 'planner', text: 'hello' }), { search: 'planner' }), false);
    } },
    { name: 'search is safe on a text-less record', run: () => {
      assert.equal(logLineVisible({ source: 'planner' }, { search: 'x' }), false);
      assert.equal(logLineVisible({ source: 'planner' }, { search: '' }), true);
    } },
  ]);
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

test('search matches the raw command and the Bash description', () => {
  const rec = { level: 'debug', text: '→ Bash node --test test/naming.test.mjs', desc: 'Run the naming tests' };
  assert.equal(compileLogFilter({ search: 'naming.test' })(rec), true);
  assert.equal(compileLogFilter({ search: 'RUN THE' })(rec), true);
  assert.equal(compileLogFilter({ search: 'cargo' })(rec), false);
  assert.equal(compileLogFilter({ search: 'naming' })({ level: 'info', text: 'other' }), false);
});
