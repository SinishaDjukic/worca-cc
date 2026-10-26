// test/ui-shape-app-wiring.test.mjs — Shape it first, slice 4: app.js's wiring of the outline ask and the feature
// view. The `plan` renderer branches on `plan.outline` (run page + askHeading), `mountShapeFeature` paints a host from
// GET /api/shape/features/:id (idempotent while a fetch is pending or failed, F41), `shape-feature` and
// `schedules-changed` frames repaint the hosts (F40), a hello brings back a view emptied while the gate was off.
// Harness: the REAL app.js under jsdom (test/helpers/run-page-boot.mjs); the mount functions are read off
// window.__shapeFeature, the test seam app.js exposes beside its other window.__* hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootApp, runPanel } from './helpers/run-page-boot.mjs';
import { namedAnswer } from '../ui/public/shape/step-receipt.mjs';
import { chatCardBuilder } from '../ui/public/chat/extensions.mjs';

const GATE = { flags: { shapeFirst: true } };
const click = (ctx, el) => el.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
const res = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

// ---- the outline ask on the run page -------------------------------------------------------------------------------

const RUN_ID = 'run-outline';
const slice = (id, o = {}) => ({ id, title: `Slice ${id}`, goal: `Make ${id} possible for people`, inScope: ['a'], outOfScope: ['b'],
  acceptance: ['GET /api/x returns 200'], dependsOn: [], estimate: 'medium', ...o });
const OUTLINE = { why: 'The change is large.', slices: [slice('s1'), slice('s2', { dependsOn: ['s1'], estimate: 'large' }), slice('s3', { dependsOn: ['s2'] })] };
const OUTLINE_Q = { id: 'plan-outline-n_plan-1', kind: 'plan',
  plan: { port: 'plan', round: 1, revisable: true, nodeId: 'n_plan', outline: OUTLINE,
    check: { ok: true, passed: 5, total: 5, items: [], grounding: [] } } };

function recorder(answer = () => res(200, { ok: true })) {
  const posts = [];
  const fetchHandler = (url, opts) => {
    if (url === `/api/runs/${RUN_ID}/answer` || url === '/api/answer') {
      const body = JSON.parse(opts.body);
      posts.push({ url, body, named: namedAnswer(RUN_ID, body.id) });           // what this tab had noted when the POST left
      return answer();
    }
    return null;
  };
  return { posts, fetchHandler };
}

async function openOutline({ gate = true, answer } = {}) {
  const r = recorder(answer);
  const ctx = await bootApp({ fetchHandler: r.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: !!gate }, runs: [{ runId: RUN_ID, title: 'Outline demo', projectDir: '/tmp/p', status: 'running', kind: 'run',
    startedAt: '2026-01-01T00:00:00Z', shaping: { perspectives: [], rounds: [], approved: null, savedTo: null }, pendingQuestion: OUTLINE_Q }] });
  ctx.go(`running/${RUN_ID}`);
  await ctx.settle();
  return { ctx, panel: runPanel(ctx), ...r };
}

test('a pending outline ask renders the outline body; its head names the decision (the run page heading stays empty)', async () => {
  const { ctx, panel } = await openOutline();
  assert.ok(panel.querySelector('.outline-body'), 'the outline body is drawn');
  assert.equal(panel.querySelector('.plan-approve'), null, 'not the plan body');
  assert.equal(panel.querySelector('.ask-mcard-title').textContent, 'Your turn: approve the runs', 'D30: the head names the decision');
  assert.equal(panel.querySelector('.ask-mcard-kind').textContent, 'Runs');
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-ask-head').textContent, '');
});

test('gate on: Approve 3 runs posts the gated answer route, with the named receipt noted before the POST', async () => {
  const { ctx, panel, posts } = await openOutline();
  assert.equal(panel.querySelector('.outline-approve').textContent, 'Approve 3 runs');
  click(ctx, panel.querySelector('.outline-approve'));
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, `/api/runs/${RUN_ID}/answer`);
  assert.equal(posts[0].body.decision, 'approve');
  assert.equal(posts[0].body.approveEach, false, 'D19: Ask me before each run is off unless ticked');
  assert.equal(posts[0].named && posts[0].named.text, 'Split into 3 runs', 'noted before the POST (D5)');
});

test('a replay of the pending ask keeps the named note; a NEW ask reusing its id (a resume) drops it', async () => {
  const { ctx, panel } = await openOutline();
  click(ctx, panel.querySelector('.outline-approve'));
  await ctx.settle();
  assert.equal(namedAnswer(RUN_ID, OUTLINE_Q.id).text, 'Split into 3 runs');
  ctx.dispatch({ type: 'question', runId: RUN_ID, ...OUTLINE_Q });            // the subscribe replay of the same ask
  await ctx.settle();
  assert.equal(namedAnswer(RUN_ID, OUTLINE_Q.id).text, 'Split into 3 runs');
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: OUTLINE_Q.id });
  ctx.dispatch({ type: 'question', runId: RUN_ID, ...OUTLINE_Q });            // asked again after a resume
  await ctx.settle();
  assert.equal(namedAnswer(RUN_ID, OUTLINE_Q.id), null);
});

test('a 409 with { error } keeps the typed feedback, says "Not sent: …" and forgets the named receipt', async () => {
  const { ctx, panel, posts } = await openOutline({ answer: () => res(409, { error: 'this question is no longer pending' }) });
  click(ctx, panel.querySelector('.plan-ask-changes'));
  panel.querySelector('.plan-feedback').value = 'fewer runs';
  click(ctx, panel.querySelector('.plan-revise'));
  await ctx.settle(5);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].named && posts[0].named.text, 'Changes asked · Runs');
  assert.equal(panel.querySelector('.plan-feedback').value, 'fewer runs');
  assert.equal(panel.querySelector('.plan-err').hidden, false);
  assert.equal(panel.querySelector('.plan-err').textContent, 'Not sent: this question is no longer pending');
  assert.equal(namedAnswer(RUN_ID, OUTLINE_Q.id), null);
});

test('gate off: Approve 3 runs posts /api/answer, and the same card is drawn', async () => {
  const { ctx, panel, posts } = await openOutline({ gate: false });
  assert.equal(panel.querySelector('.outline-merge'), null);
  assert.equal(panel.querySelector('.outline-approve').textContent, 'Approve 3 runs');
  assert.equal(panel.querySelectorAll('.outline-row-more').length, 3);
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
  const s = { features: new Map(), gets: [], posts: [], fetchLog: [], getHandler: null, postHandler: null,
    groups: [{ id: 'feat_1', kind: 'feature', title: 'Big change', projectKey: null, planning: null, members: [groupMember(1, 'p1')], cost: { usd: 0, byPipeline: {} } }] };
  s.fetchHandler = (url, opts) => {
    s.fetchLog.push(url);
    if (url.startsWith('/api/run-groups')) return res(200, { groups: s.groups });
    // One ship flow (D19): the group dialog's Into reads the chain root here.
    if (url.startsWith('/api/pr/remotes')) return res(200, { ok: true, chain: ['dev'], remotes: [], defaults: {} });
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
  assert.equal(h.querySelector('.shape-feature-status'), null, 'the model owns the status line');
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
  const running = FEATURE('feat-1').slices.map((x) => (x.index === 2 ? { ...x, state: 'running', pipelineId: 'p2', runId: 'r2' } : x));
  pending[1](res(200, FEATURE('feat-1', { slices: running })));
  await ctx.settle(5);
  pending[0](res(200, FEATURE('feat-1')));
  await ctx.settle(5);
  // The newer (running) payload won: a Plans-type host's running run offers Shaper's Stop.
  assert.ok(h.querySelector('[data-act="feature-stop"]'), 'the later response is the one drawn');
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
  const old = h.querySelector('[data-act="feature-resume"]');
  const proto = Object.getPrototypeOf(old);
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'disabled');
  Object.defineProperty(old, 'disabled', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); if (v) this.blur(); } });
  old.focus();
  click(ctx, old);
  await ctx.settle(8);
  const again = h.querySelector('[data-act="feature-resume"]');
  assert.notEqual(again, old, 'the view was rebuilt');
  assert.equal(ctx.window.document.activeElement, again);
});

test('schedules-changed and shape-feature frames do not throw before the Chat home is mounted (F40)', async () => {
  const { ctx } = await bootFeature();
  ctx.dispatch({ type: 'schedules-changed' });
  ctx.dispatch({ type: 'shape-feature', id: 'nope' });
  await ctx.settle(3);
});

// ---- D16 / s3: the group page (#feature/ID), the Plans tab card and the Chat feature card's controls ----------------

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
  const page = ctx.window.document.querySelector('#group-detail');
  return { ctx, server, page };
}

test('#feature/feat_1 fetches the feature and renders the page view', async () => {
  const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE());
  const { page } = await openFeaturePage({ server });
  assert.deepEqual(server.gets, ['feat_1', 'feat_1'], 'the replaced-id lookup (F47), then the Shaper view');
  assert.ok(page.querySelector('.gpage .gpage-overview .shape-feature'));
  assert.equal(page.querySelectorAll('.gpage-card .run-status-word').length, 1, 'one status line: the group model\'s');
  assert.equal(page.querySelector('.shape-feature-head'), null, 'the Shaper view draws no head');
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
  assert.ok(page.querySelector('.gpage-overview .shape-feature'));
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
  // §5a.2: the gone text offers a way back to the Runs list.
  assert.equal(page.querySelector('.feature-page-gone').textContent, 'This feature no longer exists. Open the Runs list');
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
  assert.equal(ctx.window.document.querySelector('[data-view="runs"]').classList.contains('hidden'), false);
  const view = ctx.window.document.querySelector('#group-detail');
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
  const line = page.querySelector('.gpage-card .run-status-word');
  line.textContent = 'stale';
  ctx.dispatch({ type: 'state', runId: 'r2', status: 'running' });
  await ctx.settle(4);
  assert.notEqual(page.querySelector('.gpage-card .run-status-word').textContent, 'stale',
    'the state frame repainted the group model\'s line (scheduleGroupPagePaint)');
  assert.equal(server.gets.length, 3, 'a state frame does not refetch the feature');
});

test('the Plans tab and the group page Overview mount the same head-less view', async () => {
  const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE());
  const { ctx, page } = await openFeaturePage({ server });
  assert.ok(page.querySelector('.gpage-overview .shape-feature'));
  assert.equal(page.querySelector('.shape-feature details.shape-feature-runs'), null, 'no runs fold: the group page lists the runs');
  const plans = ctx.window.document.createElement('div');
  ctx.window.document.body.appendChild(plans);
  ctx.window.__shapeFeature.mount(plans, 'feat_1');
  await ctx.settle(5);
  assert.ok(plans.querySelector('.shape-feature'));
  assert.equal(plans.querySelector('details.shape-feature-runs'), null);
  assert.equal(plans.querySelector('.shape-feature-ask'), null, 'no step card in the Plans tab');
});

test('group page: a ⋯ pick of Ask before each run posts approve-each {on:false}; after the frame the item reads unchecked', async () => {
  const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE({ approveEach: true, originPipelineId: 'p1' }));
  server.postHandler = (id, action) => { if (action === 'approve-each') server.features.set(id, { ...server.features.get(id), approveEach: false }); return res(200, { ok: true }); };
  const { ctx, page } = await openFeaturePage({ server });
  const doc = ctx.window.document;
  const item = () => [...doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.trim() === 'Ask before each run');
  click(ctx, page.querySelector('.gpage-bar .gpage-more'));
  await ctx.settle(8);
  assert.equal(page.querySelector('[data-act="feature-more"]'), null, 'run 4 D17: the Overview draws no ⋯ of its own');
  assert.equal(page.querySelector('.shape-feature-order'), null, 'run 4 D17: the merge order stays on the Runs tab');
  assert.equal(item().getAttribute('aria-checked'), 'true');
  const labels = [...doc.querySelectorAll('.wfv-menu-item .wfv-menu-l')].map((l) => l.textContent);
  assert.ok(labels.includes('Stop') && labels.includes('Archive'), labels.join(', '));
  assert.equal(doc.querySelectorAll('.wfv-menu .wfv-menu-hint').length, 0, 'issue #948: the list keys do not act here, so no key hints');
  click(ctx, item());
  await ctx.settle(8);
  assert.deepEqual(server.posts, [{ id: 'feat_1', action: 'approve-each', body: { on: false } }]);
  ctx.dispatch({ type: 'shape-feature', id: 'feat_1' });
  await ctx.settle(6);
  click(ctx, page.querySelector('.gpage-bar .gpage-more'));
  await ctx.settle(8);
  assert.equal(item().getAttribute('aria-checked'), 'false');
});

test('Open the plan opens the origin run\'s newest plan artifact in the popup (any UI level), else its Artifacts tab', async () => {
  const open = async (rows) => {
    const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE({ originPipelineId: 'p1' }));
    const inner = server.fetchHandler;
    server.fetchHandler = (url, opts) => (url === '/api/runs/p1/artifacts' ? res(200, { runId: 'p1', artifacts: rows, truncated: false }) : inner(url, opts));
    const { ctx, page } = await openFeaturePage({ server });
    click(ctx, page.querySelector('.gpage-bar .gpage-more'));
    await ctx.settle(8);
    click(ctx, [...ctx.window.document.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.trim() === 'Open the plan'));
    await ctx.settle(8);
    return ctx;
  };
  const a = await open([{ kind: 'task', relPath: 'task.md' }, { kind: 'plan', relPath: 'plans/a.md' }, { kind: 'plan', relPath: 'plans/a-v2.md' }]);
  assert.ok(a.calls.some((c) => c.url === `/api/runs/p1/artifact?rel=${encodeURIComponent('plans/a-v2.md')}`), 'the newest plan is read into the popup');
  assert.doesNotMatch(a.window.location.hash, /artifacts/, 'no hidden Artifacts tab at the simple level');
  const b = await open([{ kind: 'task', relPath: 'task.md' }]);
  assert.match(b.window.location.hash, /\/artifacts$/, 'no plan indexed: the Artifacts tab, as before');
});

test('a halted Chat feature card\'s Resume posts the feature resume route once (the real chatRunControls.featureAct)', async () => {
  const server = featureServer();
  const { ctx } = await bootFeature({ server });
  const { createChatRunCard } = await import('../ui/public/chat/run-card.mjs');
  const doc = ctx.window.document;
  const view = FEATURE('feat_1', { originPipelineId: 'p1', halted: { index: 2, state: 'stopped', waiting: [3] },
    slices: [{ index: 1, title: 'First', state: 'done', pipelineId: 'p1', runId: null }, { index: 2, title: 'Second', state: 'stopped', pipelineId: 'p2', runId: null },
      { index: 3, title: 'Third', state: 'planned', pipelineId: null, runId: null }], log: [], ask: null });
  const card = createChatRunCard({ doc, win: ctx.window, ctx: {}, controls: ctx.window.__np.chatRunControls, ident: { cardId: 'c1', pipelineId: 'p1' },
    snapshot: { source: 'rest', terminal: true, status: 'done', pipelineId: 'p1', shaper: { card: { pipelineId: 'p1', feature: view, log: [] }, snaps: {} } } });
  doc.body.appendChild(card.el);
  click(ctx, card.el.querySelector('[data-act="feature-resume"]'));
  await ctx.settle(6);
  assert.deepEqual(server.posts.map((p) => [p.id, p.action]), [['feat_1', 'resume']]);
  card.destroy();
});

// ---- Shaper s2: the feature card's data and the feature thread (D12–D14) -------------------------------------------

test('s2: threadForRun reads the slice route\'s threadId; shaperCard GETs once, and shape-feature / a member\'s question re-read it', async () => {
  const cardGets = [];
  const CARD = { pipelineId: 'p1', log: [], feature: { id: 'f', slices: [{ index: 1, pipelineId: 'p1' }, { index: 2, pipelineId: 'p2' }] } };
  const fetchHandler = (url) => {
    if (url === '/api/shape/pipelines/p2/slice') return res(200, { featureId: 'f', threadId: 't-1' });
    if (url === '/api/shape/pipelines/p1/card') { cardGets.push(url); return res(200, CARD); }
    return null;
  };
  const ctx = await bootApp({ fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', ...GATE, runs: [{ runId: 'run-p2', pipelineId: 'p2', title: 'Run 2', projectDir: '/tmp/p', status: 'running', kind: 'run',
    startedAt: '2026-01-01T00:00:00Z' }] });
  await ctx.settle();
  const seam = ctx.window.__shapeFeature;
  assert.equal(await seam.threadForRun({ pipelineId: 'p2' }), 't-1');
  let heard = 0;
  seam.shaperCard('p1', () => { heard += 1; });
  seam.shaperCard('p1', () => {});
  await ctx.settle(5);
  assert.equal(cardGets.length, 1, 'two asks, one GET');
  assert.equal(seam.shaperCard('p1').pipelineId, 'p1');
  assert.ok(heard >= 1, 'the listener heard the answer');
  ctx.dispatch({ type: 'shape-feature', id: 'f' });
  await ctx.settle(5);
  assert.equal(cardGets.length, 2, 'a shape-feature frame re-reads the card');
  ctx.dispatch({ type: 'question', runId: 'run-p2', id: 'plan-n_refine-1', kind: 'plan', plan: { round: 1 } });
  await ctx.settle(5);
  assert.equal(cardGets.length, 3, 'run 2\'s question re-reads the planning run\'s card (refreshShaperCardsOf)');
});

// ---- slice 4: the plan gate with role reviews on every surface (run page, workspace run, Chat card, feature page) ----

const RR_ASK = JSON.parse(readFileSync(new URL('./fixtures/role-review/recorded-run.json', import.meta.url), 'utf8'));
const rrRun = (o = {}) => ({ runId: 'run-rr', pipelineId: 'p-rr', title: 'Role reviews', projectDir: '/tmp/p', status: 'running', kind: 'run',
  startedAt: '2026-01-01T00:00:00Z', shaping: { perspectives: RR_ASK.plan.perspectives, rounds: [], approved: null, savedTo: null },
  pendingQuestion: RR_ASK, ...o });
const recordAnswers = (runId, posts, next = () => null) => (url, opts) => {
  if (url === `/api/runs/${runId}/answer`) { posts.push(JSON.parse(opts.body)); return res(200, { ok: true }); }
  return next(url, opts);
};

for (const workspaceId of [null, 'ws1']) {
  test(`run page${workspaceId ? ' (workspace run)' : ''}: the plan gate with 1 open issue is approvable`, async () => {
    const posts = [];
    const ctx = await bootApp({ fetchHandler: recordAnswers('run-rr', posts) });
    ctx.wsBox.ws.dispatch('open', {});
    ctx.dispatch({ type: 'hello', ...GATE, runs: [rrRun(workspaceId ? { workspaceId } : {})] });
    ctx.go('running/run-rr');
    await ctx.settle();
    const panel = runPanel(ctx);
    const approve = panel.querySelector('.plan-approve');
    assert.equal(approve.textContent, 'Approve with 1 open issue');
    assert.equal(panel.querySelectorAll('.plan-roles .plan-check-row').length, 5);
    assert.equal(panel.querySelectorAll('.plan-more').length, 1, 'Shaper\'s ⋯ always holds Stop');
    click(ctx, approve);
    await ctx.settle();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].decision, 'approve');
  });
}

test('Chat run card: the plan gate is approvable and the receipt names the roles and the open issue', async () => {
  const posts = [];
  const ctx = await bootApp({ fetchHandler: recordAnswers('run-rr', posts) });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', ...GATE, runs: [rrRun()] });
  await ctx.settle();
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')(
    { kind: 'card', id: 'c-rr', state: 'tracked', card: { type: 'progress', pipelineId: 'p-rr', runId: 'run-rr', projectKey: 'p', title: 'Role reviews' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel() {}, openArtifact() {}, announce() {} });
  doc.body.appendChild(built.el);
  await ctx.settle();
  const approve = built.el.querySelector('.plan-approve');
  assert.equal(approve.textContent, 'Approve with 1 open issue');
  click(ctx, approve);
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].decision, 'approve');
  ctx.dispatch({ type: 'question-resolved', runId: 'run-rr', id: RR_ASK.id });
  await ctx.settle();
  assert.equal(built.el.querySelector('.chat-rc-receipt summary').textContent, 'Plan approved · 5 roles reviewed · 1 open issue accepted');
  built.dispose();
});

test('feature (group) page: the plan gate with 1 open issue is approvable', async () => {
  const posts = [];
  const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE());
  // The open step sits in the group page's status card (D12): run 2 is the group's current member.
  server.groups[0].members = [groupMember(1, 'p1'), groupMember(2, 'p2', 'running'), groupMember(3, null, null)];
  server.fetchHandler = recordAnswers('r2', posts, server.fetchHandler);
  const { ctx, page } = await openFeaturePage({ server, runs: [rrRun({ runId: 'r2', pipelineId: 'p2', title: 'Run tags' })] });
  const approve = page.querySelector('.gpage-card .gpage-question .plan-approve');
  assert.equal(approve.textContent, 'Approve with 1 open issue');
  click(ctx, approve);
  await ctx.settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].decision, 'approve');
});

// ---- one ship flow (slice 2): the group page's Create PR opens the shared dialog ----------------------------------

const doneGroup = () => [{ id: 'feat_1', kind: 'feature', title: 'Big change', projectKey: 'pk', planning: null,
  members: [groupMember(1, 'p1'), groupMember(2, 'p2'), groupMember(3, 'p3')], cost: { usd: 0, byPipeline: {} } }];
const SHIP_FEATURE = () => FEATURE('feat_1', { projectKey: 'pk', slices: [1, 2, 3].map((index) => ({ index, title: `S${index}`,
  state: 'done', pipelineId: `p${index}`, runId: null, pr: null })), ship: { suggested: 'one', linesAdded: 840, hint: null } });
const change = (ctx, input) => { input.checked = true; input.dispatchEvent(new ctx.window.Event('change')); };

test('one ship flow: the feature page\'s Create PR opens the dialog (Into from /api/pr/remotes) and posts the pick', async () => {
  const server = featureServer(); server.groups = doneGroup(); server.features.set('feat_1', SHIP_FEATURE());
  const { ctx, page } = await openFeaturePage({ server });
  const doc = ctx.window.document;
  const slot = page.querySelector('.gpage-card .rd-pr-slot');
  assert.equal(page.querySelectorAll('.gpage-bar [data-model-action="ship"]:not([hidden])').length, 0);
  slot.querySelector('button').click();
  assert.equal(slot.dataset.state, 'pending', 'the control waits while the dialog loads');
  await ctx.settle(4);
  const modal = doc.getElementById('shipit-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.ok(server.fetchLog.some((u) => u.startsWith('/api/pr/remotes?') && u.includes('id=p3')));
  assert.equal(modal.querySelector('.shipit-base').textContent, 'dev');
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create PR');
  assert.equal(doc.activeElement, modal.querySelector('.shipit-prs input[value="one"]'));
  change(ctx, modal.querySelector('.shipit-prs input[value="stacked"]'));
  assert.equal(modal.querySelector('.shipit-base').textContent, "dev, then each run's branch");
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 3 PRs');
  assert.ok(!modal.querySelector('.shipit-release').hidden, 'a feature offers the Release row');
  modal.querySelector('.shipit-ok').click();
  await ctx.settle(4);
  assert.deepEqual(server.posts.at(-1), { id: 'feat_1', action: 'ship', body: { mode: 'stacked' } });
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(modal.querySelector('.shipit-prs').hidden, true, 'closing hides the zone again');
});

test('one ship flow: a failed ship keeps the dialog open with the error and the primary focused', async () => {
  const server = featureServer(); server.groups = doneGroup(); server.features.set('feat_1', SHIP_FEATURE());
  server.postHandler = () => res(409, { error: 'slice 2 has no pull request yet' });
  const { ctx, page } = await openFeaturePage({ server });
  page.querySelector('.gpage-card .rd-pr-slot button').click();
  await ctx.settle(4);
  const modal = ctx.window.document.getElementById('shipit-modal');
  modal.querySelector('.shipit-ok').click();
  await ctx.settle(4);
  assert.equal(modal.classList.contains('hidden'), false);
  assert.match(modal.textContent, /slice 2 has no pull request yet/);
  assert.equal(modal.querySelector('.shipit-ok').disabled, false);
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create PR');
  assert.equal(ctx.window.document.activeElement, modal.querySelector('.shipit-ok'));
  modal.querySelector('.shipit-cancel').click(); await ctx.settle(2);
});

test('one ship flow: after a ship focus is on the repainted View PRs control; after Cancel on the Create PR that opened it', async () => {
  const server = featureServer(); server.groups = doneGroup(); server.features.set('feat_1', SHIP_FEATURE());
  const pr = (n) => ({ url: `https://github.com/o/r/pull/${n}`, number: n, state: 'OPEN' });
  server.postHandler = () => {                             // the ship lands: every member now carries its PR
    server.groups = [{ ...doneGroup()[0], members: [1, 2, 3].map((k) => ({ ...groupMember(k, `p${k}`), pr: pr(k) })) }];
    return res(200, { ok: true, mode: 'stacked' });
  };
  const { ctx, page } = await openFeaturePage({ server });
  const doc = ctx.window.document;
  const modal = doc.getElementById('shipit-modal');
  page.querySelector('.gpage-card .rd-pr-slot button').click(); await ctx.settle(4);
  modal.querySelector('.shipit-cancel').click(); await ctx.settle(2);
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(doc.activeElement, page.querySelector('.gpage-card .rd-pr-slot button'), 'Cancel: back on Create PR');
  page.querySelector('.gpage-card .rd-pr-slot button').click(); await ctx.settle(4);
  modal.querySelector('.shipit-ok').click(); await ctx.settle(6);
  const slot = page.querySelector('.gpage-card .rd-pr-slot');
  assert.equal(slot.dataset.state, 'view');
  assert.ok(slot.contains(doc.activeElement) && doc.activeElement.matches('button, a'), 'focus is on View PRs, not <body>');
});

test('one ship flow: a late repaint that swaps View PRs for View PR (One over old drafts) keeps focus in the slot', async () => {
  const server = featureServer(); server.groups = doneGroup(); server.features.set('feat_1', SHIP_FEATURE());
  const pr = (n) => ({ url: `https://github.com/o/r/pull/${n}`, number: n, state: 'OPEN' });
  const withPrs = (prOf) => [{ ...doneGroup()[0], members: [1, 2, 3].map((k) => ({ ...groupMember(k, `p${k}`), pr: prOf(k) })) }];
  server.postHandler = () => {                             // the reload right after the ship still sees the 3 drafts
    server.groups = withPrs(pr);
    return res(200, { ok: true, mode: 'one' });
  };
  const { ctx, page } = await openFeaturePage({ server });
  const doc = ctx.window.document;
  const modal = doc.getElementById('shipit-modal');
  page.querySelector('.gpage-card .rd-pr-slot button').click(); await ctx.settle(4);
  modal.querySelector('.shipit-ok').click(); await ctx.settle(6);
  const slot = page.querySelector('.gpage-card .rd-pr-slot');
  assert.ok(slot.contains(doc.activeElement), 'focus is on the (stale) View PRs');
  const before = slot.dataset.sig;
  server.groups = withPrs(() => pr(3));                    // the drafts close: slice 3's PR is the one PR
  ctx.dispatch({ type: 'run-groups-changed' });
  await ctx.settle(6);
  assert.notEqual(slot.dataset.sig, before, 'the slot was rebuilt');
  assert.ok(slot.contains(doc.activeElement) && doc.activeElement.matches('button, a'), 'focus is on View PR, not <body>');
});

test('one ship flow: a partly failed stacked ship leaves the dialog reading Create 2 PRs with One disabled', async () => {
  const server = featureServer(); server.groups = doneGroup(); server.features.set('feat_1', SHIP_FEATURE());
  server.postHandler = () => res(502, { error: "could not create run 2's PR: boom. Create PR again to continue.", prs: ['https://github.com/o/r/pull/1'] });
  const { ctx, page } = await openFeaturePage({ server });
  page.querySelector('.gpage-card .rd-pr-slot button').click(); await ctx.settle(4);
  const modal = ctx.window.document.getElementById('shipit-modal');
  change(ctx, modal.querySelector('.shipit-prs input[value="stacked"]'));
  modal.querySelector('.shipit-ok').click(); await ctx.settle(4);
  assert.match(modal.textContent, /Create PR again to continue/);
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 2 PRs');
  assert.equal(modal.querySelector('.shipit-prs input[value="one"]').disabled, true);
  modal.querySelector('.shipit-cancel').click(); await ctx.settle(2);
});

test('one ship flow, gate off: a feature group\'s Create PR reads no Shaper route and never shows the Pull requests zone', async () => {
  const server = featureServer(); server.groups = doneGroup();
  const ctx = await bootApp({ fetchHandler: server.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: false }, runs: [] });
  await ctx.settle();
  ctx.go('feature/feat_1');
  await ctx.settle(4);
  const btn = ctx.window.document.querySelector('#group-detail .gpage-card .rd-pr-slot button');
  if (btn) { btn.click(); await ctx.settle(4); }
  assert.deepEqual(server.gets, [], 'no Shaper read with the flag off');
  assert.equal(server.posts.length, 0);
  assert.equal(ctx.window.document.querySelector('#shipit-modal .shipit-prs').hidden, true);
});

test('one ship flow: a chain\'s Create PR defaults to stacked, has no Release row and posts to the chain route', async () => {
  const chainMember = (k, o = {}) => ({ ticketId: k > 1 ? `t${k}` : null, pipelineId: `r${k}`, title: `R${k}`, state: 'done', prUrl: null,
    historyKey: 'pk', projectKey: 'pk', workspaceId: null, projectDir: '/tmp/pk', after: k > 1 ? k - 1 : null, ...o });
  let chains = [{ id: 'p:r1', title: 'R1', members: [chainMember(1), chainMember(2)] }];
  const posts = [];
  const server = featureServer(); server.groups = [];
  const base = server.fetchHandler;
  const fetchHandler = (url, opts) => {
    if (url.startsWith('/api/schedules')) return res(200, { schedules: [], tickets: [], chains, counts: {} });
    if (url.startsWith('/api/chains/')) { posts.push({ url, body: JSON.parse(opts.body) }); return res(200, { ok: true, mode: 'stacked', prs: [] }); }
    return base(url, opts);
  };
  const ctx = await bootApp({ fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: false }, runs: [] });
  await ctx.settle();
  ctx.go(`group/${encodeURIComponent('p:r1')}`);
  await ctx.settle(6);
  const doc = ctx.window.document;
  const page = doc.querySelector('#group-detail');
  page.querySelector('.gpage-card .rd-pr-slot button').click();
  await ctx.settle(4);
  const modal = doc.getElementById('shipit-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.ok(server.fetchLog.some((u) => u.startsWith('/api/pr/remotes?') && u.includes('id=r2') && u.includes('projectKey=pk')));
  assert.equal(modal.querySelector('.shipit-prs input[value="stacked"]').checked, true, 'a chain defaults to stacked');
  assert.equal(modal.querySelector('.shipit-ok').textContent, 'Create 2 PRs');
  assert.equal(modal.querySelector('.shipit-base').textContent, "dev, then each run's branch");
  assert.equal(modal.querySelector('.shipit-release').hidden, true, 'no Release row for a chain');
  modal.querySelector('.shipit-ok').click();
  await ctx.settle(4);
  assert.deepEqual(posts, [{ url: '/api/chains/p%3Ar1/ship', body: { mode: 'stacked' } }]);
  // A partly shipped chain: View PR ▾ on the status line and a Create PR head button, busy while the dialog loads.
  chains = [{ id: 'p:r1', title: 'R1', members: [chainMember(1, { prUrl: 'https://github.com/o/r/pull/1' }), chainMember(2)] }];
  ctx.dispatch({ type: 'schedules-changed' });
  await ctx.settle(6);
  const head = page.querySelector('.gpage-card .rd-head-acts [data-head="ship"]');
  assert.ok(head, 'Create PR stays as a head button');
  assert.equal(page.querySelector('.gpage-card .rd-pr-slot').dataset.state, 'view');
  head.click();
  assert.deepEqual([head.disabled, head.getAttribute('aria-busy')], [true, 'true']);
  await ctx.settle(4);
  assert.equal(modal.querySelector('.shipit-prs input[value="one"]').disabled, true);
  assert.equal(modal.querySelector('.shipit-prs-stacked-label').textContent, '1 more');
  modal.querySelector('.shipit-cancel').click(); await ctx.settle(2);
  assert.equal(doc.activeElement, head, 'Cancel: back on the head button');
});

test('one ship flow: after a chain ship focus is on the repainted View PR control even while its History rows carry no PR yet', async () => {
  const chainMember = (k, o = {}) => ({ ticketId: k > 1 ? `t${k}` : null, pipelineId: `r${k}`, title: `R${k}`, state: 'done', prUrl: null,
    historyKey: 'pk', projectKey: 'pk', workspaceId: null, projectDir: '/tmp/pk', after: k > 1 ? k - 1 : null, ...o });
  const PR = 'https://github.com/o/r/pull/9';
  let chains = [{ id: 'p:r1', title: 'R1', members: [chainMember(1), chainMember(2)] }];
  // The History rows exist but lag behind the ship: their reload has not answered with the PR yet.
  const hist = [1, 2].map((k) => ({ id: `r${k}`, projectKey: 'pk', status: 'done', title: `R${k}`, pr: null }));
  const server = featureServer(); server.groups = [];
  const base = server.fetchHandler;
  const fetchHandler = (url, opts) => {
    if (url.startsWith('/api/history')) return res(200, { pipelines: hist, ghAvailable: true });
    if (url.startsWith('/api/schedules')) return res(200, { schedules: [], tickets: [], chains, counts: {} });
    if (url.startsWith('/api/chains/')) {
      chains = [{ id: 'p:r1', title: 'R1', members: [chainMember(1, { prUrl: PR }), chainMember(2, { prUrl: PR })] }];
      return res(200, { ok: true, mode: 'one', prs: [PR] });
    }
    return base(url, opts);
  };
  const ctx = await bootApp({ fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', flags: { shapeFirst: false }, runs: [] });
  await ctx.settle();
  ctx.go(`group/${encodeURIComponent('p:r1')}`);
  await ctx.settle(6);
  const doc = ctx.window.document;
  const page = doc.querySelector('#group-detail');
  page.querySelector('.gpage-card .rd-pr-slot button').click();
  await ctx.settle(4);
  const modal = doc.getElementById('shipit-modal');
  change(ctx, modal.querySelector('.shipit-prs input[value="one"]'));
  modal.querySelector('.shipit-ok').click();
  await ctx.settle(6);
  const slot = page.querySelector('.gpage-card .rd-pr-slot');
  assert.equal(slot.dataset.state, 'view', 'the chain\'s stored PR shows, not Ready to ship');
  assert.ok(slot.contains(doc.activeElement) && doc.activeElement.matches('button, a'), 'focus is on View PR, not <body>');
  ctx.dispatch({ type: 'pipelines-changed' });           // the late History reload repaints the page
  await ctx.settle(6);
  assert.equal(page.querySelector('.gpage-card .rd-pr-slot').dataset.state, 'view');
  assert.ok(page.querySelector('.gpage-card .rd-pr-slot').contains(doc.activeElement), 'focus survives the late repaint');
});
