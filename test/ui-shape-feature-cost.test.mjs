// test/ui-shape-feature-cost.test.mjs — the feature page's Cost tab (ui/public/shape/feature-cost.mjs): one row per run,
// each with its cost, and the total the group row shows. Run and cost only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { featureCostModel, renderFeatureCost } from '../ui/public/shape/feature-cost.mjs';
import { groupCostUsd } from '../ui/public/runs-list.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const AT = (m) => `2026-10-18T0${m}:00:00Z`;
const round2 = (x) => Math.round(x * 100) / 100;
const sum = (model) => round2(model.rows.reduce((a, r) => a + (r.usd ?? 0), 0));

/** A planning run, two runs with a pipeline and one still waiting, a failed round and its retry, and an earlier try.
 *  The members and the checks are listed out of order on purpose. */
const group = (o = {}) => ({
  cost: {
    usd: 4.2,
    byPipeline: { p0: 0.4, p1: 2, p2: 0, vA: 0.5, vB: 1, try1: 0.3 },
    checks: { vB: { round: 1, at: AT(2), status: 'done' }, vA: { round: 1, at: AT(1), status: 'error' } },
  },
  planning: { pipelineId: 'p0' },
  members: [{ position: 2, title: 'Export', pipelineId: 'p2' }, { position: 1, title: 'Store tags', pipelineId: 'p1' }, { position: 3, title: 'Share' }],
  ...o,
});
const modelOf = (g) => featureCostModel(g, groupCostUsd(g, g.liveCost || {}));
const labels = (m) => m.rows.map((r) => r.label);

test('rows: Planning, the runs by number, the Verifier rounds in run order, then earlier tries and fix runs', () => {
  const m = modelOf(group());
  assert.deepEqual(labels(m), ['Planning', 'Store tags', 'Export', 'Share', 'Verifier · round 1 · failed', 'Verifier · round 1', 'Earlier tries and fix runs']);
  assert.deepEqual(m.rows.map((r) => r.num ?? null), [null, 1, 2, 3, null, null, null]);
  assert.deepEqual(m.rows.map((r) => r.usd), [0.4, 2, 0, null, 0.5, 1, 0.3]);
  assert.equal(new Set(m.rows.map((r) => r.key)).size, m.rows.length, 'each row has its own key');
});

test('rows sum to groupCostUsd, and the total is the number passed in, labelled Total', () => {
  const g = group();
  const m = modelOf(g);
  assert.equal(m.totalLabel, 'Total');
  assert.equal(m.totalUsd, 4.2);
  assert.equal(sum(m), groupCostUsd(g));
  assert.equal(featureCostModel(g, 9.99).totalUsd, 9.99, 'the total is never recomputed from the rows');
});

test('a live cost above the stored one is the row\'s cost, and the rows still sum to groupCostUsd', () => {
  const g = group({ liveCost: { p2: 0.9 } });
  const m = modelOf(g);
  assert.equal(m.rows.find((r) => r.label === 'Export').usd, 0.9);
  assert.equal(sum(m), groupCostUsd(g, g.liveCost));
});

test('an ad-hoc member\'s cost is counted once: the rows sum to groupCostUsd', () => {
  const g = group();
  g.cost.byPipeline.loose = 0.25;
  g.members.push({ position: 4, title: 'Loose run', pipelineId: 'loose', adhoc: true });
  assert.equal(sum(modelOf(g)), groupCostUsd(g));
});

test('a stopped round ends " · stopped"; a round with no status, or a running one, has no suffix', () => {
  for (const [status, label] of [['stopped', 'Verifier · round 2 · stopped'], [undefined, 'Verifier · round 2'], ['running', 'Verifier · round 2'], ['done', 'Verifier · round 2']]) {
    const g = group({ cost: { usd: 1, byPipeline: { vA: 1 }, checks: { vA: { round: 2, at: AT(1), ...(status ? { status } : {}) } } }, planning: null, members: [] });
    assert.deepEqual(labels(modelOf(g)), [label], String(status));
  }
});

test('two rounds with the same time are listed in pipeline-id order', () => {
  const g = group({ cost: { usd: 3, byPipeline: { vz: 1, va: 2 }, checks: { vz: { round: 1, at: AT(1), status: 'done' }, va: { round: 2, at: AT(1), status: 'done' } } }, planning: null, members: [] });
  assert.deepEqual(labels(modelOf(g)), ['Verifier · round 2', 'Verifier · round 1']);
});

test('earlier tries and fix runs: summed into one row, absent at $0', () => {
  const two = group();
  two.cost.byPipeline.fix1 = 0.2;
  const rows = modelOf(two).rows.filter((r) => r.label === 'Earlier tries and fix runs');
  assert.equal(rows.length, 1);
  assert.equal(round2(rows[0].usd), 0.5);
  for (const extra of [{}, { try1: 0 }]) {
    const g = group();
    delete g.cost.byPipeline.try1;
    Object.assign(g.cost.byPipeline, extra);
    assert.equal(labels(modelOf(g)).includes('Earlier tries and fix runs'), false, JSON.stringify(extra));
  }
});

test('no cost yet: the member rows have no cost and the total is as passed', () => {
  const g = group({ cost: undefined, planning: null });
  const m = featureCostModel(g, 0);
  assert.deepEqual(labels(m), ['Store tags', 'Export', 'Share']);
  assert.deepEqual(m.rows.map((r) => r.usd), [null, null, null]);
  assert.equal(m.totalUsd, 0);
});

test('the table: .table-wrap.gpage-cost > table.table with Run and Cost only, "—" with no pipeline, "$0.00" at zero, the total in tfoot', () => {
  const node = renderFeatureCost(doc, modelOf(group()));
  assert.ok(node.matches('div.table-wrap.gpage-cost'));
  const table = node.querySelector(':scope > table.table');
  assert.ok(table);
  const heads = [...table.querySelectorAll('thead th')];
  assert.deepEqual(heads.map((x) => x.textContent), ['Run', 'Cost']);
  assert.ok(heads[1].classList.contains('num'));
  const rows = [...table.querySelectorAll('tbody tr')];
  assert.equal(rows.length, 7);
  for (const r of rows) {
    assert.equal(r.querySelectorAll(':scope > td').length, 2);
    assert.ok(r.querySelector(':scope > td.table-main[data-label="Run"]'));
    assert.ok(r.querySelector(':scope > td.num[data-label="Cost"]'));
  }
  const cost = (i) => rows[i].querySelector('td[data-label="Cost"]').textContent;
  assert.deepEqual([cost(0), cost(2), cost(3)], ['$0.40', '$0.00', '—']);
  assert.equal(rows[1].querySelector('td[data-label="Run"] .row-num').textContent, '1');
  assert.match(rows[1].querySelector('td[data-label="Run"]').textContent, /Store tags/);
  assert.equal(rows[0].querySelector('.row-num'), null, 'Planning has no number');
  const foot = table.querySelector('tfoot');
  assert.match(foot.textContent, /Total/);
  assert.match(foot.textContent, /\$4\.20/);
  for (const td of node.querySelectorAll('td')) assert.ok(td.dataset.label, `a data-label on "${td.textContent}" (the table stacks when narrow)`);
});
