// test/ui-feature-ask-routing.test.mjs — #764: the Feature page's gate, recovery and question buttons answer the
// SLICE's run. The ask is drawn by chatPaintQuestion into the page's persistent ask host; app.js routes its buttons
// through the run page's router (routeQpanelAnswer), with the run resolved from the slice, not runDetailState.
// Harness: the REAL app.js under jsdom (test/helpers/run-page-boot.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, runPanel } from './helpers/run-page-boot.mjs';

const click = (ctx, el) => el.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
const res = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

const FEATURE = { id: 'feat_1', title: 'Big change', status: 'active', projectKey: 'proj', done: 1, total: 3, open: true,
  halted: null, approveEach: false, slices: [
    { index: 1, title: 'Store tags', state: 'done', pipelineId: 'p1', runId: null, pr: null },
    { index: 2, title: 'Run tags', state: 'questions', pipelineId: 'p2', runId: 'r2', pr: null },
    { index: 3, title: 'Cost report', state: 'planned', pipelineId: null, runId: null, pr: null },
  ] };
const GATE_Q = { id: 'gate-refine-5', kind: 'gate', issues: [{ severity: 'major', title: 'Missing tests' }] };
// renderRecoveryBody draws .recovery-pause unless the policy offers abort (recovery.options), then .recovery-abort.
const RECOVERY_Q = (options) => ({ id: 'recovery-n_impl-1', kind: 'recovery',
  recovery: { cls: 'rate_limit', message: '429 from the API', ...(options ? { options } : {}) } });
const CLARIFY_Q = { id: 'clarify-1', kind: 'clarify',
  questions: [{ id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''], allowFreeText: true }] };

const run = (runId, pipelineId, pendingQuestion) => ({ runId, pipelineId, title: runId, projectDir: '/tmp/p', status: 'running',
  kind: 'run', startedAt: '2026-01-01T00:00:00Z', pendingQuestion });

/** Boot app.js with the gate on, a feature server and an /api/answer recorder; open #feature/feat_1. */
async function openFeaturePage({ runs, before = null }) {
  const posts = []; const gets = [];
  const fetchHandler = (url, opts) => {
    if (url === '/api/answer') { posts.push(JSON.parse(opts.body)); return res(200, { ok: true }); }
    const m = /^\/api\/shape\/features\/([^/]+)$/.exec(url);
    if (m) { gets.push(decodeURIComponent(m[1])); return res(200, FEATURE); }
    return null;
  };
  const ctx = await bootApp({ fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: true }, runs });
  await ctx.settle();
  if (before) await before(ctx);
  ctx.go('feature/feat_1');
  await ctx.settle(6);
  const ask = ctx.window.document.querySelector('[data-view="feature"] .shape-feature-current .shape-feature-ask .qpanel');
  assert.ok(ask && ask.childElementCount > 0, 'the slice\'s ask is drawn on the Feature page');
  return { ctx, ask, posts, gets };
}

test('Feature page: Don\'t approve another cycle posts decision continue for the slice\'s run', async () => {
  const { ctx, ask, posts } = await openFeaturePage({ runs: [run('r2', 'p2', GATE_Q)] });
  click(ctx, ask.querySelector('.gate-continue'));
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], { runId: 'r2', id: 'gate-refine-5', payload: { decision: 'continue' } });
  assert.ok(ask.querySelector('.gate-continue').disabled, 'the panel is busy while the answer is out');
  assert.equal(ctx.window.location.hash, '#feature/feat_1', 'the page stays put');
});

test('Feature page: I approve another cycle posts decision another for the slice\'s run', async () => {
  const { ctx, ask, posts } = await openFeaturePage({ runs: [run('r2', 'p2', GATE_Q)] });
  click(ctx, ask.querySelector('.gate-another'));
  await ctx.settle();
  assert.deepEqual(posts.map((p) => [p.runId, p.payload.decision]), [['r2', 'another']]);
});

for (const [cls, decision, options] of [
  ['recovery-retry', 'retry', null],
  ['recovery-pause', 'pause', null],
  ['recovery-abort', 'abort', [{ id: 'retry' }, { id: 'abort' }]],
]) {
  test(`Feature page: recovery .${cls} posts decision ${decision} for the slice's run`, async () => {
    const { ctx, ask, posts } = await openFeaturePage({ runs: [run('r2', 'p2', RECOVERY_Q(options))] });
    const btn = ask.querySelector(`.${cls}`);
    assert.ok(btn, `${cls} is drawn`);
    click(ctx, btn);
    await ctx.settle();
    assert.deepEqual(posts.map((p) => [p.runId, p.id, p.payload.decision]), [['r2', 'recovery-n_impl-1', decision]]);
    assert.ok(btn.disabled, 'the panel is busy while the answer is out');
  });
}

test('Feature page: a clarify answer is collected from the page\'s panel and posted for the slice\'s run', async () => {
  const { ctx, ask, posts } = await openFeaturePage({ runs: [run('r2', 'p2', CLARIFY_Q)] });
  click(ctx, ask.querySelector('.qblock .qopt'));
  click(ctx, ask.querySelector('.qpanel-foot .btn-go'));
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].runId, 'r2');
  assert.equal(posts[0].id, 'clarify-1');
  assert.deepEqual(posts[0].payload.answers.map((a) => [a.id, a.choice]), [['q1', 'Redis']]);
});

test('Feature page: a clarify Submit with nothing chosen posts an empty choice, as the run page does', async () => {
  const { ctx, ask, posts } = await openFeaturePage({ runs: [run('r2', 'p2', CLARIFY_Q)] });
  click(ctx, ask.querySelector('.qpanel-foot .btn-go'));
  await ctx.settle();
  assert.deepEqual(posts.map((p) => [p.runId, p.payload.answers.map((a) => [a.id, a.choice])]), [['r2', [['q1', '']]]]);
});

// A Shaper slice's run carries `shaping`, so the clarify renderer adds decorateShapingQuestions' footer
// ("Skip, draft with defaults" + the .btn-go relabelled "Answer and draft"). Same shape as ui-shape-app-wiring's run.
const SHAPING = { perspectives: [], rounds: [], approved: null, savedTo: null };

test('Feature page: a shaping slice\'s Answer and draft posts the answers for the slice\'s run', async () => {
  const { ctx, ask, posts } = await openFeaturePage({ runs: [{ ...run('r2', 'p2', CLARIFY_Q), shaping: SHAPING }] });
  const submit = ask.querySelector('.qpanel-foot .btn-go');
  assert.match(submit.textContent, /Answer and draft/, 'the shaping footer is drawn');
  click(ctx, ask.querySelector('.qblock .qopt'));
  click(ctx, submit);
  await ctx.settle();
  assert.deepEqual(posts.map((p) => [p.runId, p.id, p.payload.answers.map((a) => [a.id, a.choice])]),
    [['r2', 'clarify-1', [['q1', 'Redis']]]]);
  assert.ok(submit.disabled, 'the panel is busy while the answer is out');
});

test('Feature page: a shaping slice\'s Skip, draft with defaults posts exactly once (the router leaves it alone)', async () => {
  const { ctx, ask, posts } = await openFeaturePage({ runs: [{ ...run('r2', 'p2', CLARIFY_Q), shaping: SHAPING }] });
  click(ctx, ask.querySelector('.qpanel-foot .clarify-defaults'));
  await ctx.settle();
  assert.deepEqual(posts.map((p) => [p.runId, p.id]), [['r2', 'clarify-1']]);
});

test('Feature page answers the slice\'s run even when the run page was last opened on another run', async () => {
  const { ctx, ask, posts } = await openFeaturePage({
    runs: [run('r2', 'p2', GATE_Q), run('r9', 'p9', { ...GATE_Q, id: 'gate-other-1' })],
    before: async (c) => {
      c.go('running/r9');                                             // runDetailState.runId = r9
      await c.settle();
      assert.ok(runPanel(c) && runPanel(c).querySelector('.gate-continue'), 'the run page opened on r9');
    },
  });
  click(ctx, ask.querySelector('.gate-another'));
  await ctx.settle();
  assert.deepEqual(posts.map((p) => [p.runId, p.id]), [['r2', 'gate-refine-5']], 'never runDetailState.runId (r9)');
});

test('Feature page: a repaint keeps one listener — one click posts exactly one answer', async () => {
  const { ctx, ask, posts, gets } = await openFeaturePage({ runs: [run('r2', 'p2', GATE_Q)] });
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });          // refetch + repaint: mountAsk runs again
  await ctx.settle(6);
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(6);
  assert.equal(gets.length, 3, 'the page was painted three times');
  const again = ctx.window.document.querySelector('[data-view="feature"] .shape-feature-current .shape-feature-ask .qpanel');
  assert.equal(again, ask, 'the same persistent panel');
  click(ctx, again.querySelector('.gate-continue'));
  await ctx.settle();
  assert.equal(posts.length, 1);
});

test('run page: the shared router still answers runDetailState\'s run', async () => {
  const { ctx, posts } = await openFeaturePage({ runs: [run('r2', 'p2', GATE_Q), run('r9', 'p9', { ...GATE_Q, id: 'gate-other-1' })] });
  ctx.go('running/r9');
  await ctx.settle();
  click(ctx, runPanel(ctx).querySelector('.gate-continue'));
  await ctx.settle();
  assert.deepEqual(posts.map((p) => [p.runId, p.id, p.payload.decision]), [['r9', 'gate-other-1', 'continue']]);
});
