// test/ui-run-checklists.test.mjs — the run page Overview's "Perspective checklists" group (spec D7), from the saved
// review rows: a finished run shows it, the gate off hides it, a live run that is not shaping never fetches for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/run-page-boot.mjs';
import { setShapeFirst } from './helpers/shape-gate.mjs';

const REVIEWS = [
  { kind: 'impl', cycle: 1, issues: [], summary: '', checklist: [{ id: 'R-qa-1', perspective: 'qa', text: 't', status: 'unmet', evidence: 'x' }] },
  { kind: 'impl', cycle: 2, issues: [], summary: '', checklist: [{ id: 'R-qa-1', perspective: 'qa', text: 't', status: 'met', evidence: 'y' }] },
];
const RUN = { runId: 'r1', title: 'Demo', projectDir: '/tmp/p', pipelineId: 'pid1', status: 'done', kind: 'run', startedAt: '2026-01-01T00:00:00Z' };
const dataUrl = '/api/runs/pid1?projectDir=%2Ftmp%2Fp';

const fetchHandler = (url) => {
  if (url === dataUrl) return Promise.resolve({ ok: true, status: 200, json: async () => ({ reviews: REVIEWS, state: { steps: [] } }) });
  return null;
};
const hello = (ctx, features, run) => {
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', ...(features ? { flags: features } : {}), runs: [run] });
};
const host = (ctx) => ctx.window.document.querySelector('#run-detail .rd-sec[data-sec="overview"] .rd-checklists');

test('a done run shows the latest review cycle on its Overview, earlier ones folded, with the gate on', async () => {
  try {
    const ctx = await bootApp({ fetchHandler });
    hello(ctx, { shapeFirst: true }, RUN);
    ctx.go('running/r1/details/overview');
    await ctx.settle(8);
    assert.equal(host(ctx).hidden, false);
    const root = host(ctx).querySelector('.shape-checklists');
    assert.equal(root.querySelector(':scope > .shape-cl-cycle .shape-cl-caption').textContent,
      'Review cycle 2 · 1 met · 0 unmet · 0 n/a');
    assert.equal(root.querySelector('.shape-cl-earlier-btn .shape-cl-toggle-label').textContent, 'Earlier cycles (1)');
    assert.equal(root.querySelector('.shape-cl-earlier').hidden, true);
  } finally {
    setShapeFirst(false);
  }
});

test('the gate off hides the group', async () => {
  setShapeFirst(false);
  const ctx = await bootApp({ fetchHandler });
  hello(ctx, null, RUN);
  ctx.go('running/r1/details/overview');
  await ctx.settle(8);
  assert.equal(host(ctx).hidden, true);
  assert.equal(host(ctx).querySelector('.shape-checklists'), null);
});

test('a live run that is not shaping never fetches the run data for the group', async () => {
  try {
    const ctx = await bootApp({ fetchHandler });
    hello(ctx, { shapeFirst: true }, { ...RUN, status: 'running' });
    ctx.go('running/r1/details/overview');
    await ctx.settle(8);
    const count = () => ctx.calls.filter((c) => c.url === dataUrl).length;
    const before = count();
    ctx.dispatch({ type: 'state', runId: 'r1', id: 'pid1', status: 'running' });
    await ctx.settle(6);
    assert.equal(count(), before);
    assert.equal(host(ctx).hidden, true);
  } finally {
    setShapeFirst(false);
  }
});
