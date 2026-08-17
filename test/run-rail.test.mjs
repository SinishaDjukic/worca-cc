// test/run-rail.test.mjs
// Pure, DOM-free unit test of the list-density rail projection (mirrors
// log-filter/log-line): cell folding, connector state, progress, label budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellStatus, railRows, railProgress, railLabelsFit, RAIL_LABEL_LIMIT, railShortLabel,
} from '../ui/public/run-rail.mjs';

// A manifest in the shape manifestFor() produces: cells that hold nodes.
const M = {
  steps: [
    { nodes: [{ id: 'preflight', label: 'Preflight' }] },
    { nodes: [{ id: 'planner', label: 'Plan' }] },
    { label: 'Build', nodes: [{ id: 'impl-a', label: 'Implement A' }, { id: 'impl-b', label: 'Implement B' }] },
    { nodes: [{ id: 'reviewer', label: 'Review' }] },
  ],
};

const viewOf = (statuses, extra = {}) => ({ statusOf: (id) => statuses[id] || 'pending', ...extra });

// ── cellStatus: folding parallel nodes into one marker ──────────────────────

test('a cell is done only when every node in it is done', () => {
  assert.equal(cellStatus(['done', 'done']), 'done');
  assert.equal(cellStatus(['done', 'pending']), 'pending');
});

test('stopped dominates every other status — it is what halted the run', () => {
  assert.equal(cellStatus(['done', 'stopped']), 'stopped');
  assert.equal(cellStatus(['active', 'stopped']), 'stopped');
  assert.equal(cellStatus(['paused', 'stopped']), 'stopped');
});

test('paused outranks active, active outranks pending', () => {
  assert.equal(cellStatus(['active', 'paused']), 'paused');
  assert.equal(cellStatus(['pending', 'active']), 'active');
});

test('an empty cell is pending, not done (vacuous-truth guard)', () => {
  assert.equal(cellStatus([]), 'pending');
  assert.equal(cellStatus(null), 'pending');
});

// ── railRows: the flat marker/connector sequence ────────────────────────────

test('rows alternate cell, bar, cell — one bar BETWEEN each pair, none at the ends', () => {
  const rows = railRows(M, viewOf({}));
  assert.deepEqual(rows.map((r) => r.kind), ['cell', 'bar', 'cell', 'bar', 'cell', 'bar', 'cell']);
});

test('a cell takes its own label, else its single node label, else "Step N"', () => {
  const rows = railRows(M, viewOf({})).filter((r) => r.kind === 'cell');
  assert.deepEqual(rows.map((r) => r.label), ['Preflight', 'Plan', 'Build', 'Review']);
  // A parallel cell with no label of its own falls back to the ordinal, NOT to
  // one of its two nodes (picking one would misrepresent the other).
  const unlabelled = railRows({ steps: [{ nodes: [{ id: 'a' }, { id: 'b' }] }] }, viewOf({}));
  assert.equal(unlabelled[0].label, 'Step 1');
});

test('a parallel cell reports its node count; a single-node cell reports 0', () => {
  const cells = railRows(M, viewOf({})).filter((r) => r.kind === 'cell');
  assert.equal(cells[2].parallel, 2);
  assert.equal(cells[0].parallel, 0);
});

test('a connector is done iff the cell before it is done', () => {
  const rows = railRows(M, viewOf({ preflight: 'done', planner: 'done', 'impl-a': 'active', 'impl-b': 'pending' }));
  const bars = rows.filter((r) => r.kind === 'bar');
  assert.deepEqual(bars.map((b) => b.done), [true, true, false],
    'preflight→plan and plan→build are behind the frontier; build→review is not');
});

test('the active node marks its cell, including a parallel one', () => {
  const rows = railRows(M, viewOf({ 'impl-a': 'active' }, { activeId: 'impl-a' }));
  const cells = rows.filter((r) => r.kind === 'cell');
  assert.deepEqual(cells.map((c) => c.active), [false, false, true, false]);
});

test('cycles fold to the highest loop count in the cell', () => {
  const rows = railRows(M, viewOf({}, { cycles: { 'impl-a': 2, 'impl-b': 1, reviewer: 0 } }));
  const cells = rows.filter((r) => r.kind === 'cell');
  assert.equal(cells[2].cycles, 2);
  assert.equal(cells[3].cycles, 0);
});

test('railRows is safe on an empty/malformed manifest and a view with no statusOf', () => {
  assert.deepEqual(railRows({ steps: [] }, {}), []);
  assert.deepEqual(railRows(null, null), []);
  const rows = railRows(M, {});
  assert.equal(rows.filter((r) => r.kind === 'cell').every((c) => c.status === 'pending'), true);
});

// ── railProgress: the "n/m" next to the rail ────────────────────────────────

test('progress counts done cells and locates the frontier', () => {
  const rows = railRows(M, viewOf({ preflight: 'done', planner: 'done', 'impl-a': 'active', 'impl-b': 'pending' }));
  assert.deepEqual(railProgress(rows), { done: 2, total: 4, at: 3 });
});

test('a finished run reads m/m; a fresh one 0/m', () => {
  const all = railRows(M, viewOf({ preflight: 'done', planner: 'done', 'impl-a': 'done', 'impl-b': 'done', reviewer: 'done' }));
  assert.deepEqual(railProgress(all), { done: 4, total: 4, at: 4 });
  assert.deepEqual(railProgress(railRows(M, viewOf({}))), { done: 0, total: 4, at: 0 });
});

test('a stopped cell is the frontier even though nothing is active', () => {
  const rows = railRows(M, viewOf({ preflight: 'done', planner: 'done', 'impl-a': 'stopped', 'impl-b': 'stopped' }));
  assert.equal(railProgress(rows).at, 3);
});

// ── label budget ────────────────────────────────────────────────────────────

test('labels fit up to the limit and not past it', () => {
  const cellsOf = (n) => ({ steps: Array.from({ length: n }, (_, i) => ({ nodes: [{ id: `n${i}` }] })) });
  assert.equal(railLabelsFit(railRows(cellsOf(RAIL_LABEL_LIMIT), viewOf({}))), true);
  assert.equal(railLabelsFit(railRows(cellsOf(RAIL_LABEL_LIMIT + 1), viewOf({}))), false);
  assert.equal(railLabelsFit([]), true);
});

// ── display shortening ──────────────────────────────────────────────────────

test('a label that fits passes through untouched', () => {
  assert.equal(railShortLabel('Preflight'), 'Preflight');
  assert.equal(railShortLabel('Refine Plan'), 'Refine Plan');   // exactly at the budget
  assert.equal(railShortLabel(''), '');
});

test('the known long stage names map to their verbs, not to a mid-word ellipsis', () => {
  assert.equal(railShortLabel('Implementation'), 'Implement');
  assert.equal(railShortLabel('Review Implementation'), 'Review');
});

test('an unknown long multi-word label keeps its first word', () => {
  assert.equal(railShortLabel('Generate Detailed Report'), 'Generate');
});

test('a single long word is left for the CSS ellipsis — no honest shortening exists', () => {
  assert.equal(railShortLabel('Recontextualization'), 'Recontextualization');
});
