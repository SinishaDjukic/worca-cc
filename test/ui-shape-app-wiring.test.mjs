// test/ui-shape-app-wiring.test.mjs — Shape it first, slice 4: app.js's wiring of the outline ask and the feature
// view. The `plan` renderer branches on `plan.outline` (run page + askHeading), `mountShapeFeature` paints a host from
// GET /api/shape/features/:id (idempotent while a fetch is pending or failed, F41), `shape-feature` and
// `schedules-changed` frames repaint the hosts (F40), a hello brings back a view emptied while the gate was off.
// Harness: the REAL app.js under jsdom (test/helpers/run-page-boot.mjs); the mount functions are read off
// window.__shapeFeature, the test seam app.js exposes beside its other window.__* hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, runPanel } from './helpers/run-page-boot.mjs';

const GATE = { flags: { shapeFirst: true } };
const click = (ctx, el) => el.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
const res = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

// ---- the outline ask on the run page -------------------------------------------------------------------------------

const RUN_ID = 'run-outline';
const slice = (id, o = {}) => ({ id, title: `Slice ${id}`, goal: `Make ${id} possible for people`, inScope: ['a'], outOfScope: ['b'],
  acceptance: ['GET /api/x returns 200'], dependsOn: [], estimate: 'medium', ...o });
const OUTLINE = { why: 'The change is large.', slices: [slice('s1'), slice('s2', { dependsOn: ['s1'], estimate: 'large' })] };
const OUTLINE_Q = { id: 'plan-outline-n_plan-1', kind: 'plan',
  plan: { port: 'plan', round: 1, revisable: true, nodeId: 'n_plan', outline: OUTLINE,
    check: { ok: true, passed: 5, total: 5, items: [], grounding: [] } } };

function recorder() {
  const posts = [];
  const fetchHandler = (url, opts) => {
    if (url === `/api/runs/${RUN_ID}/answer` || url === '/api/answer') { posts.push({ url, body: JSON.parse(opts.body) }); return res(200, { ok: true }); }
    return null;
  };
  return { posts, fetchHandler };
}

async function openOutline({ gate = true } = {}) {
  const r = recorder();
  const ctx = await bootApp({ fetchHandler: r.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: !!gate }, runs: [{ runId: RUN_ID, title: 'Outline demo', projectDir: '/tmp/p', status: 'running', kind: 'run',
    startedAt: '2026-01-01T00:00:00Z', shaping: { perspectives: [], rounds: [], approved: null, savedTo: null }, pendingQuestion: OUTLINE_Q }] });
  ctx.go(`running/${RUN_ID}`);
  await ctx.settle();
  return { ctx, panel: runPanel(ctx), ...r };
}

test('a pending outline ask renders the outline body, with the outline heading', async () => {
  const { ctx, panel } = await openOutline();
  assert.ok(panel.querySelector('.outline-body'), 'the outline body is drawn');
  assert.equal(panel.querySelector('.plan-approve'), null, 'not the plan body');
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-ask-head').textContent,
    'Your turn: approve the slices', 'D30: the heading names the decision');
});

test('gate on: Plan slice 1 posts the gated answer route', async () => {
  const { ctx, panel, posts } = await openOutline();
  click(ctx, panel.querySelector('.outline-approve'));
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, `/api/runs/${RUN_ID}/answer`);
  assert.equal(posts[0].body.decision, 'approve');
  assert.equal(posts[0].body.approveEach, false, 'D19: Approve each slice\'s plan is off unless ticked');
});

test('gate off: Plan slice 1 posts /api/answer, and no merge/remove is offered', async () => {
  const { ctx, panel, posts } = await openOutline({ gate: false });
  assert.equal(panel.querySelector('.outline-merge'), null);
  click(ctx, panel.querySelector('.outline-approve'));
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/answer');
  assert.equal(posts[0].body.runId, RUN_ID);
  assert.equal(posts[0].body.payload.decision, 'approve');
});

// ---- the feature view's mount --------------------------------------------------------------------------------------

const FEATURE = (id = 'feat-1', o = {}) => ({ id, title: 'Big change', status: 'active', projectKey: 'proj', done: 1, total: 3, open: true,
  halted: null, approveEach: true, slices: [
    { index: 1, title: 'First', state: 'done', pipelineId: 'p1', runId: null },
    { index: 2, title: 'Second', state: 'planned', pipelineId: null, runId: null },
    { index: 3, title: 'Third', state: 'planned', pipelineId: null, runId: null },
  ], ...o });

const groupMember = (position, pipelineId, status = 'done') => ({ position, title: `Slice ${position}`, pipelineId, ticketId: null, status, pr: null,
  ticket: null, adhoc: false, after: null });
/** A server stub: features by id, per-id GET handlers, recorded GETs/POSTs. It lists `feat_1` as a feature group
 *  (GET /api/run-groups), so #feature/feat_1 renders the group page (runs redesign slice 4, D16). */
function featureServer() {
  const s = { features: new Map(), gets: [], posts: [], getHandler: null, postHandler: null,
    groups: [{ id: 'feat_1', kind: 'feature', title: 'Big change', projectKey: null, planning: null, members: [groupMember(1, 'p1')], cost: { usd: 0, byPipeline: {} } }] };
  s.fetchHandler = (url, opts) => {
    if (url.startsWith('/api/run-groups')) return res(200, { groups: s.groups });
    const m = /^\/api\/shape\/features\/([^/]+)(?:\/([a-z-]+))?$/.exec(url);
    if (!m) return null;
    const id = decodeURIComponent(m[1]);
    if (m[2]) {
      s.posts.push({ id, action: m[2], body: JSON.parse(opts.body || '{}') });
      return s.postHandler ? s.postHandler(id, m[2]) : res(200, { ok: true });
    }
    s.gets.push(id);
    if (s.getHandler) { const r = s.getHandler(id); if (r) return r; }
    const f = s.features.get(id);
    return f ? res(200, f) : res(404, { error: 'unknown feature' });
  };
  return s;
}

async function bootFeature({ gate = true, server = featureServer() } = {}) {
  const ctx = await bootApp({ fetchHandler: server.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: !!gate }, runs: [] });
  await ctx.settle();
  const seam = ctx.window.__shapeFeature;
  const host = () => { const h = ctx.window.document.createElement('div'); ctx.window.document.body.appendChild(h); return h; };
  return { ctx, server, seam, host };
}

test('mountShapeFeature paints the host from GET /api/shape/features/:id', async () => {
  const server = featureServer(); server.features.set('feat-1', FEATURE());
  const { ctx, seam, host } = await bootFeature({ server });
  const h = host();
  seam.mount(h, 'feat-1');
  await ctx.settle(5);
  assert.deepEqual(server.gets, ['feat-1']);
  assert.ok(h.querySelector('.shape-feature'), 'the view is drawn');
  assert.equal(h.dataset.painted, 'feat-1');
  assert.equal(h.querySelector('.shape-feature-head').textContent, '1 of 3 slices done');
});

test('no refetch loop (F41): five mounts with the fetch pending issue one GET; after a 500 none; a frame refetches', async () => {
  const server = featureServer(); server.features.set('feat-1', FEATURE());
  let release; server.getHandler = () => new Promise((r) => { release = () => r(res(500, { error: 'boom' })); });
  const { ctx, seam, host } = await bootFeature({ server });
  const h = host();
  for (let i = 0; i < 5; i++) seam.mount(h, 'feat-1');
  await ctx.settle(2);
  assert.equal(server.gets.length, 1, 'one GET for five mounts');
  release();
  await ctx.settle(5);
  seam.mount(h, 'feat-1'); seam.mount(h, 'feat-1');
  await ctx.settle(3);
  assert.equal(server.gets.length, 1, 'a failed fetch is not retried by a mount');
  server.getHandler = null;
  ctx.dispatch({ type: 'shape-feature', id: 'feat-1' });
  await ctx.settle(5);
  assert.equal(server.gets.length, 2, 'a shape-feature frame for the id refetches');
  assert.ok(h.querySelector('.shape-feature'));
});

test('a shape-feature frame repaints only the hosts of that id; schedules-changed and hello repaint all', async () => {
  const server = featureServer(); server.features.set('A', FEATURE('A')); server.features.set('B', FEATURE('B'));
  const { ctx, seam, host } = await bootFeature({ server });
  seam.mount(host(), 'A'); seam.mount(host(), 'B');
  await ctx.settle(5);
  server.gets.length = 0;
  ctx.dispatch({ type: 'shape-feature', id: 'B' });
  await ctx.settle(5);
  assert.deepEqual(server.gets, ['B']);
  server.gets.length = 0;
  ctx.dispatch({ type: 'schedules-changed' });
  await ctx.settle(5);
  assert.deepEqual(server.gets.sort(), ['A', 'B']);
  server.gets.length = 0;
  ctx.dispatch({ type: 'hello', ...GATE, runs: [] });
  await ctx.settle(5);
  assert.deepEqual(server.gets.sort(), ['A', 'B']);
});

test('a failed refetch (500) keeps the last view; a 404 empties the host', async () => {
  const server = featureServer(); server.features.set('feat-1', FEATURE());
  const { ctx, seam, host } = await bootFeature({ server });
  const h = host();
  seam.mount(h, 'feat-1');
  await ctx.settle(5);
  server.getHandler = () => res(500, { error: 'boom' });
  ctx.dispatch({ type: 'shape-feature', id: 'feat-1' });
  await ctx.settle(5);
  assert.ok(h.querySelector('.shape-feature'), 'kept');
  server.getHandler = null; server.features.delete('feat-1');
  ctx.dispatch({ type: 'shape-feature', id: 'feat-1' });
  await ctx.settle(5);
  assert.equal(h.querySelector('.shape-feature'), null, 'emptied');
  assert.equal(h.dataset.painted, '');
});

test('two paints in flight end with the later response', async () => {
  const server = featureServer();
  const pending = [];
  server.getHandler = () => new Promise((r) => pending.push(r));
  const { ctx, seam, host } = await bootFeature({ server });
  const h = host();
  seam.mount(h, 'feat-1');
  ctx.dispatch({ type: 'shape-feature', id: 'feat-1' });
  await ctx.settle(2);
  assert.equal(pending.length, 2);
  pending[1](res(200, FEATURE('feat-1', { done: 2 })));
  await ctx.settle(5);
  pending[0](res(200, FEATURE('feat-1', { done: 1 })));
  await ctx.settle(5);
  assert.equal(h.querySelector('.shape-feature-head').textContent, '2 of 3 slices done');
});

test('successor (F47): a host mounted with A that is answered with B posts to B and repaints on B frames', async () => {
  const server = featureServer(); server.features.set('A', FEATURE('B', { replanOf: 'A', halted: { index: 2, state: 'stopped', waiting: [3] } }));
  const { ctx, seam, host } = await bootFeature({ server });
  const h = host();
  seam.mount(h, 'A');
  await ctx.settle(5);
  click(ctx, h.querySelector('.shape-feature-resume'));
  await ctx.settle(8);
  assert.equal(server.posts[0].id, 'B');
  assert.equal(server.posts[0].action, 'resume');
  server.gets.length = 0;
  ctx.dispatch({ type: 'shape-feature', id: 'B' });
  await ctx.settle(5);
  assert.deepEqual(server.gets, ['A'], 'the host (still pointed at A) repaints on B');
});

test('a failed action leaves its error text visible after the repaint that follows', async () => {
  const server = featureServer(); server.features.set('feat-1', FEATURE('feat-1', { halted: { index: 2, state: 'stopped', waiting: [3] } }));
  server.postHandler = () => res(409, { error: 'Slice 2 is still going…' });
  const { ctx, seam, host } = await bootFeature({ server });
  const h = host();
  seam.mount(h, 'feat-1');
  await ctx.settle(5);
  click(ctx, h.querySelector('.shape-feature-resume'));
  await ctx.settle(8);
  const err = h.querySelector('.shape-feature-err');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Slice 2 is still going…');
});

test('turning the gate off while a fetch is in flight leaves the host empty', async () => {
  const server = featureServer();
  let release; server.getHandler = () => new Promise((r) => { release = () => r(res(200, FEATURE())); });
  const { ctx, seam, host } = await bootFeature({ server });
  const h = host();
  seam.mount(h, 'feat-1');
  await ctx.settle(2);
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: false }, runs: [] });
  await ctx.settle(3);
  release();
  await ctx.settle(5);
  assert.equal(h.querySelector('.shape-feature'), null);
  assert.equal(h.dataset.painted, '');
});

test('a hello with the gate back repaints a view emptied while it was off', async () => {
  const server = featureServer(); server.features.set('feat-1', FEATURE());
  const { ctx, seam, host } = await bootFeature({ server });
  const h = host();
  seam.mount(h, 'feat-1');
  await ctx.settle(5);
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: false }, runs: [] });
  await ctx.settle(5);
  assert.equal(h.querySelector('.shape-feature'), null, 'emptied with the gate off');
  ctx.dispatch({ type: 'hello', ...GATE, runs: [] });
  await ctx.settle(5);
  assert.ok(h.querySelector('.shape-feature'), 'back with the gate');
});

test('focus (F39): after a click on a control that blurs when disabled, the new control with the same data-act has it', async () => {
  const server = featureServer(); server.features.set('feat-1', FEATURE('feat-1', { halted: { index: 2, state: 'stopped', waiting: [3] } }));
  const { ctx, seam, host } = await bootFeature({ server });
  const h = host();
  seam.mount(h, 'feat-1');
  await ctx.settle(5);
  const old = h.querySelector('[data-act="shape-feature-resume"]');
  const proto = Object.getPrototypeOf(old);
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'disabled');
  Object.defineProperty(old, 'disabled', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); if (v) this.blur(); } });
  old.focus();
  click(ctx, old);
  await ctx.settle(8);
  const again = h.querySelector('[data-act="shape-feature-resume"]');
  assert.notEqual(again, old, 'the view was rebuilt');
  assert.equal(ctx.window.document.activeElement, again);
});

test('schedules-changed and shape-feature frames do not throw before the Chat home is mounted (F40)', async () => {
  const { ctx } = await bootFeature();
  ctx.dispatch({ type: 'schedules-changed' });
  ctx.dispatch({ type: 'shape-feature', id: 'nope' });
  await ctx.settle(3);
});

// ---- D16: the feature page (#feature/ID) and the Chat run card's summary ------------------------------------------

const PAGE_FEATURE = (o = {}) => FEATURE('feat_1', { approveEach: false, slices: [
  { index: 1, title: 'Store tags', state: 'done', pipelineId: 'p1', runId: null, pr: null },
  { index: 2, title: 'Run tags', state: 'approval', pipelineId: 'p2', runId: 'r2', pr: null },
  { index: 3, title: 'Cost report', state: 'planned', pipelineId: null, runId: null, pr: null },
], ...o });
const PLAN_Q = { id: 'plan-n_plan-1', kind: 'plan', nodeId: 'n_plan',
  plan: { port: 'plan', round: 1, revisable: true, nodeId: 'n_plan', file: '/x/plan.md', check: { ok: false, passed: 3, total: 8, items: [], grounding: [] } } };

async function openFeaturePage({ server = featureServer(), runs = [] } = {}) {
  const ctx = await bootApp({ fetchHandler: server.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', ...GATE, runs });
  await ctx.settle();
  ctx.go('feature/feat_1/overview');                // the group page's Overview hosts the Shaper view (slice 4, D14)
  await ctx.settle(6);
  const page = ctx.window.document.querySelector('[data-view="feature"] .feature-page');
  return { ctx, server, page };
}

test('#feature/feat_1 fetches the feature and renders the page view', async () => {
  const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE());
  const { page } = await openFeaturePage({ server });
  assert.deepEqual(server.gets, ['feat_1', 'feat_1'], 'the replaced-id lookup (F47), then the Shaper view');
  assert.ok(page.querySelector('.gpage .gpage-overview .shape-feature.is-page'));
  assert.equal(page.querySelectorAll('.shape-feature-seg').length, 3);
});

test('#feature says it is loading until the feature arrives (no blank page on a slow server)', async () => {
  const server = featureServer();
  const held = [];
  server.getHandler = () => new Promise((r) => { held.push(r); });
  const { page } = await openFeaturePage({ server });
  // The group page while the replaced-id lookup is out, or (the group is listed) its Overview while the view loads.
  assert.match(page.querySelector('.feature-page-loading').textContent, /^Loading (group|feature)…$/);
  // Every held GET: the replaced-id lookup first, then the Shaper view the Overview mounts once the page is drawn.
  for (let i = 0; i < 5 && (held.length || page.querySelector('.feature-page-loading')); i++) {
    for (const r of held.splice(0)) r(res(200, PAGE_FEATURE()));
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(page.querySelector('.feature-page-loading'), null, 'the page replaces the loading line');
  assert.ok(page.querySelector('.gpage-overview .shape-feature.is-page'));
});

test('#feature whose first load fails says so instead of loading forever', async () => {
  const server = featureServer();
  server.getHandler = () => res(500, { error: 'boom' });
  const { page } = await openFeaturePage({ server });
  assert.equal(page.querySelector('.feature-page-loading'), null);
  assert.equal(page.querySelector('.feature-page-gone').textContent, 'Could not load this feature. Reload to try again.');
});

test('#feature for an unknown id says the feature no longer exists', async () => {
  const { page } = await openFeaturePage();
  assert.equal(page.querySelector('.feature-page-gone').textContent, 'This feature no longer exists.');
});

test('#feature with the gate off still renders the group page, without Overview (slice 4, D16)', async () => {
  const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE());
  const ctx = await bootApp({ fetchHandler: server.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: false }, runs: [] });
  await ctx.settle();
  ctx.go('feature/feat_1');
  await ctx.settle(4);
  assert.deepEqual(server.gets, [], 'no Shaper read with the flag off');
  const view = ctx.window.document.querySelector('[data-view="feature"]');
  assert.equal(view.classList.contains('hidden'), false);
  assert.ok(view.querySelector('.gpage'));
  assert.equal(view.querySelector('.gpage .rd-tab[data-tab="overview"]').hidden, true);
});

test('the page\'s ask host survives a repaint; a state frame repaints the line without a fetch', async () => {
  const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE());
  server.groups[0].members = [groupMember(1, 'p1'), groupMember(2, 'p2', 'running'), groupMember(3, null, null)];
  const { ctx, page } = await openFeaturePage({ server, runs: [{ runId: 'r2', pipelineId: 'p2', title: 'Run tags', projectDir: '/tmp/p',
    status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z', shaping: { perspectives: [], rounds: [], approved: null, savedTo: null }, pendingQuestion: PLAN_Q }] });
  // Runs redesign slice 4 (D14): the question lives in the group page's status card, so Overview draws no ask slot.
  const qp = page.querySelector('.gpage-card .gpage-question .qpanel');
  assert.ok(qp, 'the ask host sits in the status card');
  assert.ok(qp.childElementCount > 0 || qp.textContent.length > 0, 'the plan ask is drawn');
  assert.equal(page.querySelector('.shape-feature-current .shape-feature-ask'), null, 'Overview draws the question nowhere else');
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(6);
  assert.equal(server.gets.length, 3, 'the replaced-id lookup, the first view, the repaint');
  assert.equal(page.querySelector('.gpage-card .gpage-question .qpanel'), qp, 'the same panel: a typed answer survives');
  const head = page.querySelector('.shape-feature-head');
  head.textContent = 'stale';
  ctx.dispatch({ type: 'state', runId: 'r2', status: 'running' });
  await ctx.settle(4);
  assert.equal(page.querySelector('.shape-feature-head').textContent, 'Slice 2 of 3 › Plan › your approval',
    'the state frame rewrote the line (paintFeaturePageProgress)');
  assert.equal(server.gets.length, 3, 'a state frame does not refetch the feature');
});

test('the Chat run card mounts the summary and Open feature routes to the page; the Plans tab keeps the full card', async () => {
  const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE());
  const { ctx, seam, host } = await bootFeature({ server });
  const card = host();
  seam.mountCard(card, 'feat_1');
  await ctx.settle(5);
  assert.ok(card.querySelector('.shape-feature-sum'));
  assert.equal(card.querySelector('.shape-feature-sum-line').textContent, 'Shaper · Slice 2 needs you');
  click(ctx, card.querySelector('.shape-feature-sum-open'));
  assert.equal(ctx.window.location.hash, '#feature/feat_1');
  const plans = host();
  seam.mount(plans, 'feat_1');
  await ctx.settle(5);
  assert.ok(plans.querySelector('.shape-feature') && !plans.querySelector('.shape-feature-sum') && !plans.querySelector('.is-page'));
});
