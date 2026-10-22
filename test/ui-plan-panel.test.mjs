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
  assert.equal(panel.querySelector('.plan-approve').textContent, 'Approve and build');
  assert.equal(panel.querySelector('.qblock'), null, 'no Clarify question blocks');
});

const doc = (ctx) => ctx.window.document;
const glance = (ctx) => doc(ctx).querySelector('#run-detail .rd-glance');
const menuLabels = (ctx) => [...doc(ctx).querySelectorAll('.wfv-menu .wfv-menu-item')].map((b) => b.querySelector('.wfv-menu-l').textContent);

test('the step card\'s head says whose turn it is, once, with the gate on and off (the run page heading stays empty)', async () => {
  for (const gate of [true, false]) {
    const { ctx, panel } = await openPlan({ gate });
    assert.equal(doc(ctx).querySelector('#run-detail .rd-ask-head').textContent, '', `gate ${gate}`);
    assert.equal(panel.querySelector('.ask-mcard-title').textContent, 'Your turn: approve the plan');
    assert.equal(panel.querySelector('.ask-mcard-kind').textContent, 'Plan');
  }
});

test('shaped run waiting on its plan: card first, status card hidden whole, Pause hidden, top bar ⋯', async () => {
  const { ctx } = await openPlan();
  const g = glance(ctx);
  assert.equal(g.querySelector(':scope > .rd-now').nextElementSibling, g.querySelector('.rd-questions'));
  assert.equal(g.dataset.shaperWait, 'plan');
  assert.equal(g.querySelector('.rd-wait-more'), null, 'D1: no Run details › — the whole card hides');
  const bar = doc(ctx).querySelector('#run-detail .rd-bar');
  assert.ok(bar.hasAttribute('data-shaped'));
  assert.equal(bar.querySelector('.rd-pause').hidden, true);
  assert.equal(bar.querySelector('.rd-stop').hidden, false);
  const barMore = bar.querySelector('.rd-bar-more');
  assert.equal(barMore.hidden, false);
  click(ctx, barMore);
  const labels = menuLabels(ctx);
  assert.deepEqual(labels.slice(0, 3), ['As set up', 'Answer for me now', 'Never on this run']);
  assert.equal(labels.at(-1), 'Terminal');
  click(ctx, barMore);                                    // the second click closes it
  doc(ctx).querySelector('#run-detail > .rd').dataset.presentation = 'panel';   // as presentRunScreenInPanel sets it
  click(ctx, barMore);
  assert.ok(!menuLabels(ctx).includes('Terminal'), 'the Chat panel has no terminal');
});

// A step in flight: the one run model reads a running run with no step as Starting, which offers no Pause (slice 4).
async function working(ctx) {
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running', steps: [{ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1, cycle: 1,
    kind: 'cycle', status: 'start', startedAt: '2026-01-01T00:00:00Z' }], active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }] });
  await ctx.settle();
}

test('once answered the run page is back to today\'s order, nothing folded', async () => {
  const { ctx } = await openPlan();
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: true }, runs: [runRow({ pendingQuestion: null })] });
  await ctx.settle();
  await working(ctx);
  const g = glance(ctx);
  assert.equal(g.dataset.shaperWait, undefined);
  assert.equal(g.querySelector('.rd-wait-more'), null);
  assert.equal(g.querySelector('.rd-questions').nextElementSibling, g.querySelector('.rd-night-sec'));
  assert.equal(doc(ctx).querySelector('#run-detail .rd-pause').hidden, false);
});

for (const [name, opts] of [['an unshaped run (gate on)', { row: { shaping: undefined } }], ['the gate off', { gate: false }]]) {
  test(`${name}: today's top bar and layout`, async () => {
    const { ctx } = await openPlan(opts);
    const g = glance(ctx);
    assert.equal(g.dataset.shaperWait, undefined);
    assert.equal(g.querySelector('.rd-questions').nextElementSibling, g.querySelector('.rd-night-sec'));
    const bar = doc(ctx).querySelector('#run-detail .rd-bar');
    assert.equal(bar.hasAttribute('data-shaped'), false);
    // Run 3 (D13): every run page's bar folds its secondary controls into ⋯, shaped or not.
    assert.equal(bar.querySelector('.rd-bar-more').hidden, false);
    // The plan still waits: the one run model's Needs you actions (slice 4), Answer then Stop, and no Pause.
    assert.deepEqual([...bar.querySelectorAll('[data-model-action]')].filter((b) => !b.hidden).map((b) => b.dataset.modelAction), ['answer', 'stop']);
    assert.equal(bar.querySelector('.rd-pause').hidden, true);
  });
}

test('wide Live view: the graph sits beside the card, but a shaped run waiting on the person stays one column (D30)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const at = css.indexOf('@container rd (min-width: 960px)');
  assert.ok(at > -1, 'a wide pane lays the graph beside the card');
  const wide = css.slice(at, css.indexOf('\n}\n', at));
  const rules = wide.match(/\.rd-glance\[data-live="on"\][^{]*\{/g) || [];
  assert.ok(rules.length, 'the wide rules key on the glance\'s data-live');
  // Its card and graph hide while it waits (run 4 D1), so no wide rule may place them.
  for (const r of rules) assert.match(r, /^\.rd-glance\[data-live="on"\]:not\(\[data-shaper-wait\]\)/, r);
  // Narrow, and while a shaped run waits: every glance child but the graph keeps the 544px measure; the graph takes the
  // pane's content width.
  assert.match(css, /\.rd-glance > :not\(\.rd-live\)\{width:100%;max-width:544px;align-self:center;\}/);
  assert.match(css, /\.rd-glance > \.rd-live\{align-self:stretch;width:100%;max-width:none;\}/);
});

test('the Away mode select is not repainted while a change posts (a ⋯ pick leaves focus on ⋯)', async () => {
  const { ctx } = await openPlan();
  const ns = doc(ctx).querySelector('#run-detail .rd-night');
  ns.disabled = true; ns.value = 'off';               // as the change handler leaves it mid-POST
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: true }, runs: [runRow()] });   // night.override still unset
  await ctx.settle();
  assert.equal(ns.value, 'off');
  ns.disabled = false;
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: true }, runs: [runRow()] });
  await ctx.settle();
  assert.equal(ns.value, 'auto', 'repainted again once the POST is done');
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

test('a 409 from the gated route says why it was not sent', async () => {
  const { ctx, panel } = await openPlan({ gated: () => fail(409, { error: 'not waiting' }) });
  click(ctx, panel.querySelector('.plan-approve'));
  await ctx.settle(5);
  const err = panel.querySelector('.plan-err');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Not sent: not waiting');
});

for (const [title, want] of [['(untitled)', ''], ['Real title', 'Real title']]) {
  test(`Open in New run from a run titled "${title}" prefills the New run title with "${want}"`, async () => {
    const { ctx, panel } = await openPlan({ row: { title } });
    const titleInput = ctx.window.document.getElementById('title');
    titleInput.value = 'stale';
    click(ctx, panel.querySelector('.plan-more'));
    const open = [...doc(ctx).querySelectorAll('.wfv-menu .wfv-menu-item')].find((b) => b.textContent === 'Open in New run');
    assert.ok(open, 'Open in New run is offered with the gate on');
    click(ctx, open);
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

test('run 4 D1: while a shaped run waits, the status card and the graph hide whole; the one-line fold is gone', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.rd-glance\[data-shaper-wait\] > :is\(\.rd-sheet,\.rd-live\)\{display:none;\}/);
  assert.doesNotMatch(css, /data-wait-open/);
  assert.doesNotMatch(css, /\.rd-glance\[data-shaper-wait\][^{]*\.rd-sheet\{flex-direction:row/);
});

test('run 4 D1: the waiting state is set while waiting and gone once the run works again', async () => {
  const { ctx } = await openPlan();
  const g = glance(ctx);
  assert.equal(g.dataset.shaperWait, 'plan');
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: true }, runs: [runRow({ pendingQuestion: null })] });
  await ctx.settle();
  assert.equal(g.dataset.shaperWait, undefined);
});

test('run 4 D2, D3: the bar names the plan card\'s primary, and its click is that primary\'s click', async () => {
  const { ctx, panel } = await openPlan();
  const own = panel.querySelector('.plan-actions .btn-primary');
  const bar = doc(ctx).querySelector('#run-detail .rd-bar .rd-actions [data-model-action="answer"]');
  assert.equal(bar.textContent, own.textContent);
  assert.equal(bar.textContent, 'Approve and build');
  let clicks = 0;
  own.addEventListener('click', () => { clicks += 1; });
  click(ctx, bar);
  assert.equal(clicks, 1);
});
