// test/ui-plan-panel.test.mjs — Shape it first (spec §3.4, D10, D12, S4): the `plan` ask on the run page. The plan
// renderer is registered ungated, so a run held at its plan is answerable with the gate on or off. The answer route
// is chosen when it is POSTED: the gated plan route while the gate is on, /api/answer otherwise — so a hello that
// turns the gate off after the panel was drawn never strands the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootApp, runPanel } from './helpers/run-page-boot.mjs';

const RUN_ID = 'run-plan';
const PLAN_Q = {
  id: 'plan-q-1',
  kind: 'plan',
  plan: {
    round: 1, file: 'plans/demo-plan.md', revisable: true, perspectives: ['ux'],
    check: { ok: true, passed: 3, total: 4, items: [{ key: 'a', label: 'Has goals', pass: true }], grounding: [] },
  },
};
const PLAN_TEXT = '# Demo\n\n## Goals\n\nShip it.\n';

const click = (ctx, el) => el.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const fail = (status, body) => Promise.resolve({ ok: false, status, json: async () => body });

function recorder({ gated = () => ok({ ok: true }), legacy = () => ok({ ok: true }) } = {}) {
  const posts = [];
  const fetchHandler = (url, opts) => {
    if (url === `/api/runs/${RUN_ID}/answer`) { posts.push({ url, body: JSON.parse(opts.body) }); return gated(); }
    if (url === '/api/answer') { posts.push({ url, body: JSON.parse(opts.body) }); return legacy(); }
    if (url.startsWith(`/api/runs/${RUN_ID}/plan`)) return ok({ name: 'demo-plan.md', text: PLAN_TEXT });
    return null;
  };
  return { posts, fetchHandler };
}

function runRow(extra = {}) {
  return { runId: RUN_ID, title: 'Plan demo', projectDir: '/tmp/p', status: 'running', kind: 'run',
    startedAt: '2026-01-01T00:00:00Z', shaping: { perspectives: ['ux'], rounds: [], approved: null, savedTo: null },
    pendingQuestion: PLAN_Q, ...extra };
}

async function openPlan({ gate = true, row = {}, ...rec } = {}) {
  const r = recorder(rec);
  const ctx = await bootApp({ fetchHandler: r.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: !!gate }, runs: [runRow(row)] });
  ctx.go(`running/${RUN_ID}`);
  await ctx.settle();
  return { ctx, panel: runPanel(ctx), ...r };
}

test('the run page renders the plan panel, not a Clarify form', async () => {
  const { panel } = await openPlan();
  assert.ok(panel, 'the run page panel is mounted');
  assert.equal(panel.dataset.kind, 'plan');
  assert.ok(panel.querySelector('.plan-body'), 'the plan body is drawn');
  assert.ok(panel.querySelector('.plan-approve'), 'Run this plan is offered');
  assert.equal(panel.querySelector('.qblock'), null, 'no Clarify question blocks');
});

test('the heading names the version and the shape score', async () => {
  const { ctx } = await openPlan();
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-ask-head').textContent,
    'Plan ready for your approval · v1 · Shape 3/4');
});

test('gate on: approve posts the gated plan route', async () => {
  const { ctx, panel, posts } = await openPlan();
  click(ctx, panel.querySelector('.plan-approve'));
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, `/api/runs/${RUN_ID}/answer`);
  assert.deepEqual(posts[0].body, { id: 'plan-q-1', decision: 'approve' });
});

test('gate off: approve posts /api/answer', async () => {
  const { ctx, panel, posts } = await openPlan({ gate: false });
  click(ctx, panel.querySelector('.plan-approve'));
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/answer');
  assert.deepEqual(posts[0].body, { runId: RUN_ID, id: 'plan-q-1', payload: { decision: 'approve' } });
});

test('gate on at render, then a hello turns it off: approve posts /api/answer (D12)', async () => {
  const { ctx, panel, posts } = await openPlan();
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: false }, runs: [runRow()] });
  await ctx.settle();
  assert.equal(runPanel(ctx), panel, 'the panel is not rebuilt on the same question');
  click(ctx, panel.querySelector('.plan-approve'));
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/answer');
});

test('a 422 shows its errors on the plan panel', async () => {
  const { ctx, panel } = await openPlan({ gated: () => fail(422, { errors: [{ path: 'feedback', message: 'Too short' }] }) });
  click(ctx, panel.querySelector('.plan-approve'));
  await ctx.settle(5);
  const err = panel.querySelector('.plan-err');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /Too short/);
});

test('a 409 from the gated route shows the send-failed line', async () => {
  const { ctx, panel } = await openPlan({ gated: () => fail(409, { error: 'not waiting' }) });
  click(ctx, panel.querySelector('.plan-approve'));
  await ctx.settle(5);
  const err = panel.querySelector('.plan-err');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Could not send your answer. Try again.');
});

for (const [title, want] of [['(untitled)', ''], ['Real title', 'Real title']]) {
  test(`Open in New run from a run titled "${title}" prefills the New run title with "${want}"`, async () => {
    const { ctx, panel } = await openPlan({ row: { title } });
    assert.ok(panel.querySelector('.plan-open-new'), 'Open in New run is offered with the gate on');
    const titleInput = ctx.window.document.getElementById('title');
    titleInput.value = 'stale';
    click(ctx, panel.querySelector('.plan-open-new'));
    await ctx.settle(10);
    assert.equal(ctx.window.location.hash, '#new');
    assert.equal(titleInput.value, want);
  });
}

test('a failing check row wraps on a narrow card: the detail keeps a real width instead of shrinking under Fix (390 px)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = (sel) => (new RegExp(`^${sel.replace(/\./g, '\\.')}\\{([^}]*)\\}`, 'm').exec(css) || [])[1] || '';
  assert.match(rule('.plan-check-bad'), /flex-wrap:wrap/);
  assert.match(rule('.plan-check-detail'), /flex:1 1 \d+(?:\.\d+)?em/, 'a basis that pushes the detail to its own line');
});
