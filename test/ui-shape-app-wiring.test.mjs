// test/ui-shape-app-wiring.test.mjs — Shape it first, slice 4: app.js's wiring of the outline ask and the feature
// view. The `plan` renderer branches on `plan.outline` (run page + askHeading), `mountShapeFeature` paints a host from
// GET /api/shape/features/:id (idempotent while a fetch is pending or failed, F41), `shape-feature` and
// `schedules-changed` frames repaint the hosts (F40).
// Harness: the REAL app.js under jsdom (test/helpers/run-page-boot.mjs); the mount functions are read off
// window.__shapeFeature, the test seam app.js exposes beside its other window.__* hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootApp, runPanel } from './helpers/run-page-boot.mjs';
import { namedAnswer } from '../ui/public/shape/step-receipt.mjs';
import { chatCardBuilder } from '../ui/public/chat/extensions.mjs';

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

async function openOutline({ answer } = {}) {
  const r = recorder(answer);
  const ctx = await bootApp({ fetchHandler: r.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [{ runId: RUN_ID, title: 'Outline demo', projectDir: '/tmp/p', status: 'running', kind: 'run',
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

test('Approve 3 runs posts the run\'s answer route, with the named receipt noted before the POST', async () => {
  const { ctx, panel, posts } = await openOutline();
  assert.equal(panel.querySelector('.outline-merge'), null);
  assert.equal(panel.querySelector('.outline-approve').textContent, 'Approve 3 runs');
  assert.equal(panel.querySelectorAll('.outline-row-more').length, 3);
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

async function bootFeature({ server = featureServer() } = {}) {
  const ctx = await bootApp({ fetchHandler: server.fetchHandler });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });
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

test('a shape-feature frame repaints only the hosts of that id; schedules-changed repaints all', async () => {
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
  ctx.dispatch({ type: 'hello', runs });
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
  ctx.dispatch({ type: 'hello', runs: [{ runId: 'run-p2', pipelineId: 'p2', title: 'Run 2', projectDir: '/tmp/p', status: 'running', kind: 'run',
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
    ctx.dispatch({ type: 'hello', runs: [rrRun(workspaceId ? { workspaceId } : {})] });
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
  ctx.dispatch({ type: 'hello', runs: [rrRun()] });
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

// ---- the Requirements card's Ask for changes field: the bar must not stand in for the foot it hides ----------------

const REQ_ASK = (over = {}) => ({ id: 'q-req', kind: 'plan', nodeId: 'requirements', executionId: 'e1', plan: { file: '/x/requirements.md', round: 1, revisable: true,
  nodeId: 'requirements', lead: 'product', decisions: [], criteria: { ok: true, passed: 1, total: 1, items: [{ id: 'R-po-1', label: 'R-po-1 · Export', pass: true }],
    criteria: [{ id: 'R-po-1', text: 'Export' }] }, ...over } });
const FAILING_CHECK = { ok: false, passed: 0, total: 1, items: [{ id: 'R-po-1', label: 'R-po-1 · listed twice', pass: false }], criteria: [{ id: 'R-po-1', text: 'Export' }] };
const reqRun = (pendingQuestion) => rrRun({ pendingQuestion });
const barAnswer = (root) => root.querySelector('[data-model-action="answer"]');
const barReads = (b) => [b.textContent, b.classList.contains('btn-primary')];

test('one-level run page: the Requirements card is answered on the card; the header never repeats its primary, open or closed', async () => {
  const posts = [];
  const ctx = await bootApp({ fetchHandler: recordAnswers('run-rr', posts) });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [reqRun(REQ_ASK())] });
  ctx.go('running/run-rr');
  await ctx.settle();
  const panel = runPanel(ctx);
  const bar = panel.closest('.rd').querySelector('.rd-actions');
  assert.equal(barAnswer(bar), null);
  click(ctx, panel.querySelector('.plan-ask-changes'));
  await ctx.settle();
  assert.equal(barAnswer(bar), null, 'Ask for changes open: still none');
  click(ctx, panel.querySelector('.plan-typed-cancel'));
  await ctx.settle();
  assert.equal(barAnswer(bar), null);
  click(ctx, panel.querySelector('.plan-actions .btn-primary'));
  await ctx.settle();
  assert.deepEqual(posts.map((p) => p.decision), ['approve'], 'the card\'s primary approves');
});

// Finding 6: the Chat side panel's bar drew the step's primary a second time. Under the small-runs marker it is plain.
async function openPanelRun(pendingQuestion, route = 'chat/new/run/run-rr') {
  const ctx = await bootApp({ fetchHandler: recordAnswers('run-rr', []) });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [reqRun(pendingQuestion)] });
  ctx.go(route);
  await ctx.settle(6);
  const doc = ctx.window.document;
  const screen = route.startsWith('chat/') ? doc.querySelector('[data-chat-panel] .crp-host > .rd') : doc.querySelector('#run-detail');
  return { ctx, screen, bar: screen.querySelector('.rd-actions') };
}
const visiblePrimaries = (root) => [...root.querySelectorAll('.btn-primary')].filter((b) => !b.closest('[hidden], .hidden'));

test('Chat side panel, small-runs Requirements: the bar\'s step button is plain, the step\'s Agree is the one primary', async () => {
  const { screen, bar } = await openPanelRun(REQ_ASK({ smallRuns: true }));
  assert.equal(screen.dataset.presentation, 'panel');
  assert.deepEqual(barReads(barAnswer(bar)), ['Agree requirements', false]);
  const primaries = visiblePrimaries(screen);
  assert.equal(primaries.length, 1, primaries.map((b) => b.textContent).join(' | '));
  assert.ok(primaries[0].classList.contains('plan-approve'));
});

test('Chat side panel, no small-runs marker: the bar keeps dev\'s primary', async () => {
  const { screen, bar } = await openPanelRun(REQ_ASK());
  assert.equal(screen.dataset.presentation, 'panel');
  assert.deepEqual(barReads(barAnswer(bar)), ['Agree and plan', true]);
});

test('Chat side panel, the Care ask (only asked on a small-runs run): the bar\'s answer is not a primary', async () => {
  const { screen, bar } = await openPanelRun({ id: 'care-1', kind: 'care', care: { pick: { position: 'thorough', reason: 'r' } } });
  assert.equal(screen.dataset.presentation, 'panel');
  assert.ok(barAnswer(bar), 'the bar keeps its step button');
  assert.equal(barAnswer(bar).classList.contains('btn-primary'), false);
});

// C1 web UI review: the Prototype ask is answered on the feature card only; the side panel shows it with no button.
test('Chat side panel, the Prototype ask: its rows show, but no step button, remark field or bar answer', async () => {
  const { screen, bar } = await openPanelRun({ id: 'proto-1', kind: 'prototype', prototype: { moment: 'offered',
    offer: { primary: 'build', menu: 'skip', review: false }, requirements: [{ id: 'R-ux-1', text: 'The editor shows a preview' }] } });
  assert.equal(screen.dataset.presentation, 'panel');
  const body = screen.querySelector('.qpanel .proto-body');
  assert.ok(body, 'the step body is drawn');
  assert.equal(body.querySelectorAll('button, input').length, 0);
  assert.equal(barAnswer(bar), null, 'no bar answer');
});

test('full run page, the Prototype ask keeps its step buttons', async () => {
  const { screen } = await openPanelRun({ id: 'proto-1', kind: 'prototype', prototype: { moment: 'offered',
    offer: { primary: 'build', menu: 'skip', review: false }, requirements: [{ id: 'R-ux-1', text: 'The editor shows a preview' }] } }, 'running/run-rr');
  assert.ok(screen.querySelector('.qpanel .proto-go'));
});

test('full run page, small-runs Requirements: still no bar answer', async () => {
  const { screen, bar } = await openPanelRun(REQ_ASK({ smallRuns: true }), 'running/run-rr');
  assert.notEqual(screen.dataset.presentation, 'panel');
  assert.equal(barAnswer(bar), null);
});

test('Chat run card, Ask for changes open: Answer is not a primary and its click reaches the field; Cancel restores it', async () => {
  const ctx = await bootApp({ fetchHandler: recordAnswers('run-rr', []) });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [reqRun(REQ_ASK())] });
  await ctx.settle();
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')(
    { kind: 'card', id: 'c-req', state: 'tracked', card: { type: 'progress', pipelineId: 'p-rr', runId: 'run-rr', projectKey: 'p', title: 'Requirements' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel() {}, openArtifact() {}, announce() {} });
  doc.body.appendChild(built.el);
  await ctx.settle();
  const foot = built.el.querySelector('.chat-rc-actions');
  assert.deepEqual(barReads(barAnswer(foot)), ['Answer', true]);
  click(ctx, built.el.querySelector('.plan-ask-changes'));
  await ctx.settle();
  assert.deepEqual(barReads(barAnswer(foot)), ['Answer', false]);
  doc.body.focus();
  click(ctx, barAnswer(foot));
  await ctx.settle();
  assert.equal(doc.activeElement, built.el.querySelector('.plan-feedback'));
  click(ctx, built.el.querySelector('.plan-typed-cancel'));
  await ctx.settle();
  assert.deepEqual(barReads(barAnswer(foot)), ['Answer', true]);
  built.dispose();
});

test('feature (group) page, Ask for changes open: the bar drops Agree and plan and is not a primary', async () => {
  const posts = [];
  const server = featureServer(); server.features.set('feat_1', PAGE_FEATURE());
  server.groups[0].members = [groupMember(1, 'p1'), groupMember(2, 'p2', 'running'), groupMember(3, null, null)];
  server.fetchHandler = recordAnswers('r2', posts, server.fetchHandler);
  const { ctx, page } = await openFeaturePage({ server, runs: [rrRun({ runId: 'r2', pipelineId: 'p2', title: 'Run tags', pendingQuestion: REQ_ASK() })] });
  const bar = page.querySelector('.gpage-actions');
  assert.deepEqual(barReads(barAnswer(bar)), ['Agree and plan', true]);
  click(ctx, page.querySelector('.gpage-question .plan-ask-changes'));
  await ctx.settle(6);
  assert.deepEqual(barReads(barAnswer(bar)), ['Answer', false]);
  assert.equal(page.querySelector('.gpage-question .plan-typed').hidden, false, 'the repaint keeps the field open');
  click(ctx, barAnswer(bar));
  await ctx.settle();
  assert.deepEqual(posts, []);
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
  ctx.dispatch({ type: 'hello', runs: [] });
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
  ctx.dispatch({ type: 'hello', runs: [] });
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

// ---- Shaper small runs C1 (R-ux-2): the Prototype step's working moments on the one card ---------------------------

test('C1: the one card draws the building moment from the card\'s saved state (the Lead row, no empty well), follows it to reviewing, and draws nothing once the run ended', async () => {
  const ctx = await bootApp({ fetchHandler: () => null });
  ctx.wsBox.ws.dispatch('open', {});
  const RUN = { runId: 'run-pb', pipelineId: 'p-pb', title: 'Email templates', projectDir: '/tmp/p', status: 'running', kind: 'run',
    startedAt: '2026-01-01T00:00:00Z', shaping: { perspectives: [], rounds: [], approved: null, savedTo: null } };
  ctx.dispatch({ type: 'hello', runs: [RUN] });
  await ctx.settle();
  const { createChatRunCard } = await import('../ui/public/chat/run-card.mjs');
  const doc = ctx.window.document;
  const proto = (state, o = {}) => ({ state, screenIds: ['R-ux-1'], designId: 'd_1', buildId: 'b_1', costUsd: 0, findings: [], remarks: 0, rebuilt: false,
    reviewRounds: 0, screens: [{ section: 'editor', name: 'Template editor', ids: ['R-ux-1'] }], ...o });
  const snap = (p) => ({ source: 'live', status: 'running', runId: 'run-pb', pipelineId: 'p-pb', title: 'Email templates', shaping: RUN.shaping,
    shaper: { card: { pipelineId: 'p-pb', smallRuns: true, care: { position: 'balanced' }, log: [{ key: 'l1', text: 'Requirements agreed' }], prototype: p }, snaps: {} } });
  const card = createChatRunCard({ doc, win: ctx.window, ctx: {}, controls: ctx.window.__np.chatRunControls, ident: { cardId: 'c-pb', pipelineId: 'p-pb', runId: 'run-pb' },
    snapshot: snap(proto('building')) });
  doc.body.appendChild(card.el);
  await ctx.settle();
  const q = () => card.el.querySelector('.qpanel');
  assert.ok(q() && !q().classList.contains('hidden'), 'the step body is drawn on the card');
  assert.equal(q().querySelector('.ask-mcard-title').textContent, "Design's agents are building");
  const rows = [...q().querySelectorAll('.proto-rows .plan-check-row')].map((r) => r.textContent);
  assert.match(rows[0], /Lead/);
  assert.equal(q().querySelector('.proto-well'), null, 'item 7: no empty preview well while the Lead plans');
  assert.equal(q().querySelectorAll('button').length, 0, 'nothing to answer while Design builds');
  card.update(snap(proto('reviewing', { reviewRounds: 1 })));
  await ctx.settle();
  assert.equal(q().querySelector('.ask-mcard-title').textContent, 'Design and Product check the prototype');
  // A stopped run's saved state draws nothing.
  card.update({ ...snap(proto('building')), status: 'stopped', terminal: true });
  await ctx.settle();
  assert.ok(!card.el.querySelector('.qpanel .proto-body'), 'no working moment for an ended run');
  card.destroy();
});

test('C1: a shape-prototype frame re-reads its planning run\'s card', async () => {
  const gets = [];
  const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/shape/pipelines/p-pb/card' ? (gets.push(url), res(200, { pipelineId: 'p-pb', log: [] })) : null) });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.window.__shapeFeature.shaperCard('p-pb');
  await ctx.settle(5);
  ctx.dispatch({ type: 'shape-prototype', pipelineId: 'p-pb' });
  await ctx.settle(5);
  ctx.dispatch({ type: 'shape-prototype', pipelineId: 'other' });
  await ctx.settle(5);
  assert.equal(gets.length, 2);
});

test('C1: the run page draws the building moment in its step area from the planning run\'s saved card, and drops it once an ask opens', async () => {
  const card = { pipelineId: 'p-pb', smallRuns: true, care: { position: 'balanced' }, log: [],
    prototype: { state: 'building', screenIds: ['R-ux-1', 'R-ux-2'], designId: 'd_1', buildId: 'b_1', costUsd: 0, findings: [], remarks: 0, rebuilt: false,
      reviewRounds: 0, screens: [{ section: 'editor', name: 'Template editor', ids: ['R-ux-1'] }, { section: 'prefs', name: 'Email preferences', ids: ['R-ux-2'] }] } };
  const ctx = await bootApp({ fetchHandler: (url) => (url === '/api/shape/pipelines/p-pb/card' ? res(200, card) : null) });
  ctx.wsBox.ws.dispatch('open', {});
  const RUN = { runId: 'run-pb', pipelineId: 'p-pb', title: 'Email templates', projectDir: '/tmp/p', status: 'running', kind: 'run',
    startedAt: '2026-01-01T00:00:00Z', shaping: { perspectives: [], rounds: [], approved: null, savedTo: null } };
  ctx.dispatch({ type: 'hello', runs: [RUN] });
  ctx.go('running/run-pb');
  await ctx.settle(6);
  const host = ctx.window.document.querySelector('#run-detail .rd-questions');
  assert.equal(host.hidden, false, 'the step area shows');
  assert.equal(host.querySelector('.qpanel .ask-mcard-title').textContent, "Design's agents are building");
  const lead = [...host.querySelectorAll('.proto-rows .plan-check-row')].map((r) => r.textContent);
  assert.equal(lead.length, 1);
  assert.match(lead[0], /Lead/);
  // Design's frames reach the run page's rows through the same subscription as the Chat card's.
  let seq = 0;
  const fr = (type, over) => ({ type, designId: 'd_1', buildId: 'b_1', seq: ++seq, ts: 0, ...over });
  ctx.dispatch(fr('design-build', { status: 'building' }));
  ctx.dispatch(fr('design-plan', { planRev: 1, sections: [{ id: 'editor', job: 'Template editor', status: 'planned', parts: ['html'] },
    { id: 'prefs', job: 'Email preferences', status: 'planned', parts: ['html'] }] }));
  await ctx.settle(3);
  const rows = [...host.querySelectorAll('.proto-rows .plan-check-row')].map((r) => r.textContent);
  assert.equal(rows.length, 3, rows.join(' | '));
  assert.match(rows[0], /Lead/);
  assert.match(rows[1], /Template editor/);
  assert.match(rows[2], /Email preferences/);
  assert.equal(host.querySelectorAll('.qpanel button').length, 0, 'nothing to answer while Design builds');
  ctx.dispatch({ type: 'question', runId: 'run-pb', id: 'proto-2', kind: 'prototype', prototype: { moment: 'built',
    offer: { primary: 'confirm' }, screens: card.prototype.screens, costUsd: 1, designId: 'd_1', findings: [] } });
  await ctx.settle(6);
  assert.ok(host.querySelector('.qpanel .proto-open'), 'the built ask replaces the working moment');
});

// Small runs C3 (D11, D12): a stop is answered on every surface with the flag on; with it off the run side panel and
// the run page show only its findings.
const C3_GATE_STOP = { id: 'gate-w9-3', kind: 'gate', wireId: 'w9', nodeId: 'n_review', deliveryNo: 3,
  issues: [{ severity: 'major', title: 'Token leaks', detail: 'in logs' }],
  stop: { reason: 'objection', run: 8, pick: 'another', head: 'Run 8 · Security objects', text: 'Security: Token leaks. Still open after 3 fix cycles.',
    node: 'n_review', findingsLine: '1 finding open', options: [
      { value: 'another', label: 'Run another cycle', sub: 'One more fix cycle for Security', go: 'Run another cycle', short: 'another cycle', payload: { decision: 'another' } },
      { value: 'continue', label: 'Accept as is', sub: 'Carries on', go: 'Accept as is', short: 'accepted as is', payload: { decision: 'continue' } }] } };
const C3_PLAN_STOP = { id: 'plan-n_refine-2', kind: 'plan', nodeId: 'n_refine', plan: { round: 2, file: 'p.md', check: { ok: false, passed: 3, total: 5, items: [{ label: 'Has tests', pass: false }] } },
  stop: { ...C3_GATE_STOP.stop, reason: 'check', pick: 'revise', head: 'Run 4 · the plan check did not pass', text: 'The plan passes 3 of 5 checks.', options: [
    { value: 'revise', label: 'Re-plan', sub: 'The Planner fixes it', go: 'Re-plan', short: 're-plan', payload: { decision: 'revise', feedback: 'fix', source: 'check' } },
    { value: 'approve', label: 'Approve as is', sub: 'Builds it', go: 'Approve as is', short: 'approved as is', payload: { decision: 'approve' } }] } };

test('C3, flag off: stop in the panel: no question, no buttons, no bar answer, exactly one findings list', async () => {
  for (const pq of [C3_GATE_STOP, C3_PLAN_STOP]) {
    const { screen, bar } = await openPanelRun(pq);
    assert.equal(screen.dataset.presentation, 'panel');
    const q = screen.querySelector('.qpanel');
    assert.equal(visiblePrimaries(q).length, 0, pq.kind);
    assert.equal(q.querySelectorAll('button, .qopt').length, 0);
    assert.equal(q.textContent.includes(pq.stop.text), false);
    assert.equal(barAnswer(bar), null, 'no bar answer');
    assert.equal(q.querySelectorAll('.issues, .plan-checks').length, 1);
  }
});

test('C3, flag off: the run page draws a stop as the panel does: findings only, no question, no buttons', async () => {
  for (const pq of [C3_GATE_STOP, C3_PLAN_STOP]) {
    const { screen, bar } = await openPanelRun(pq, 'running/run-rr');
    assert.notEqual(screen.dataset.presentation, 'panel');
    const q = screen.querySelector('.qpanel');
    assert.equal(q.querySelectorAll('button, .qopt').length, 0, pq.kind);
    assert.equal(q.textContent.includes(pq.stop.text), false);
    assert.equal(q.textContent.includes(pq.stop.head), false, 'the run is not repeated');
    assert.equal(barAnswer(bar), null, 'no bar answer');
    assert.equal(q.querySelectorAll('.issues, .plan-checks').length, 1);
  }
});

/** Stop cards post through /api/answer (stepPost → postAnswer with no plan): record them, answer with `reply()`. */
const stopAnswers = (posts, next = () => null, reply = () => res(200, { ok: true })) => (url, opts) => {
  if (url === '/api/answer') { posts.push(JSON.parse(opts.body)); return reply(); }
  return next(url, opts);
};
/** Open run-rr on `route` with the flag on; `slice` answers the slice info. */
async function openStopRun(pq, route, { slice = { featureId: 'feat-1', index: 4, stop: { held: false } }, reply } = {}) {
  const { applyFlags } = await import('../ui/public/flags.mjs');
  const posts = [];
  const info = { current: slice };
  const sliceGet = (url) => (url === '/api/shape/pipelines/p-rr/slice' ? res(200, info.current) : null);
  const ctx = await bootApp({ fetchHandler: stopAnswers(posts, sliceGet, reply) });
  applyFlags({ shaperSmallRuns: true }, ctx.window.document);
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [reqRun(pq)] });
  ctx.go(route);
  await ctx.settle(8);
  const doc = ctx.window.document;
  const screen = route.startsWith('chat/') ? doc.querySelector('[data-chat-panel] .crp-host > .rd') : doc.querySelector('#run-detail');
  const off = () => applyFlags({ shaperSmallRuns: false }, doc);
  return { ctx, doc, screen, bar: screen.querySelector('.rd-actions'), q: () => screen.querySelector('.qpanel'), posts, info, off };
}

test('flag on: the run page and the run side panel draw the stop\'s card: every option, one primary naming the pick, which posts it', async () => {
  for (const route of ['running/run-rr', 'chat/new/run/run-rr']) {
    for (const pq of [C3_PLAN_STOP, C3_GATE_STOP]) {
      const { ctx, q, bar, posts, off } = await openStopRun(pq, route);
      const label = `${route} ${pq.id}`;
      assert.equal(q().querySelectorAll('.qopt').length, pq.stop.options.length, label);
      const pick = pq.stop.options.find((o) => o.value === pq.stop.pick);
      const prim = visiblePrimaries(q());
      assert.equal(prim.length, 1, label);
      assert.equal(prim[0].textContent, pick.go, label);
      assert.ok(q().textContent.includes(pq.stop.head), label);
      assert.ok(q().querySelector('.ask-mcard-head[data-stop]'), `${label}: the one-column marker`);
      assert.equal(q().querySelectorAll('a.rd-fact-link, .stop-home').length, 0, label);
      assert.equal(barAnswer(bar), null, `${label}: the card's primary is the one primary`);
      click(ctx, prim[0]);
      await ctx.settle(4);
      assert.deepEqual(posts, [{ runId: 'run-rr', id: pq.id, payload: pick.payload }], label);
      off();
    }
  }
});

test('flag on: the Verifier\'s stop on the run page is interactive', async () => {
  const pq = { ...C3_GATE_STOP, id: 'verify-9' };
  const { q, off } = await openStopRun(pq, 'running/run-rr', { slice: { verifier: true, featureId: 'feat-1', threadId: null } });
  assert.ok(q().textContent.includes(C3_GATE_STOP.stop.head));
  assert.equal(q().querySelectorAll('.qopt').length, 2);
  assert.equal(visiblePrimaries(q()).length, 1);
  assert.equal(q().querySelector('a.rd-fact-link'), null);
  off();
});

test('flag on: a held answer repaints the run page live to the one answered row', async () => {
  const { ctx, q, info, off } = await openStopRun(C3_GATE_STOP, 'running/run-rr',
    { slice: { featureId: 'feat-1', index: 8, stop: { reason: 'objection', held: false } }, reply: () => res(200, { ok: true, held: true }) });
  click(ctx, visiblePrimaries(q())[0]);
  await ctx.settle(4);
  info.current = { featureId: 'feat-1', index: 8, stop: { reason: 'objection', held: true, value: 'another', after: 7 } };
  ctx.dispatch({ type: 'shape-feature', id: 'feat-1' });
  await ctx.settle(6);
  const panel = ctx.window.document.querySelector('#run-detail .qpanel');
  assert.equal(panel.querySelectorAll('.chat-rc-log-row').length, 1);
  assert.equal(panel.querySelector('.chat-rc-log-text').textContent, 'another cycle · decided by you');
  assert.equal(panel.querySelectorAll('button, .qopt').length, 0);
  off();
});

test('flag on: a delivered answer (question-resolved) clears the stop on the run page and on the feature card', async () => {
  const { ctx, doc, off } = await openStopRun(C3_GATE_STOP, 'running/run-rr');
  const built = chatCardBuilder('progress')(
    { kind: 'card', id: 'c-stop', state: 'tracked', card: { type: 'progress', pipelineId: 'p-rr', runId: 'run-rr', projectKey: 'p', title: 'Stop' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel() {}, openArtifact() {}, announce() {} });
  doc.body.appendChild(built.el);
  await ctx.settle(6);
  assert.equal(built.el.querySelectorAll('.qpanel .qopt').length, 2, 'the feature card draws the same stop');
  assert.equal(doc.querySelectorAll('#run-detail .qpanel .qopt').length, 2);
  ctx.dispatch({ type: 'question-resolved', runId: 'run-rr', id: C3_GATE_STOP.id });
  await ctx.settle(6);
  assert.equal(doc.querySelectorAll('#run-detail .qpanel .qopt').length, 0, 'the run page');
  assert.equal(built.el.querySelectorAll('.qpanel .qopt').length, 0, 'the feature card');
  built.dispose();
  off();
});

test('flag on: a stop already answered elsewhere: the run page card says so and keeps its options', async () => {
  const { ctx, q, off } = await openStopRun(C3_GATE_STOP, 'running/run-rr',
    { reply: () => res(409, { error: 'this stop is already answered', code: 'STOP_ANSWERED' }) });
  click(ctx, visiblePrimaries(q())[0]);
  await ctx.settle(6);
  const err = q().querySelector('.chat-rc-q-err');
  assert.equal(err && err.textContent, 'Not sent: this stop is already answered');
  assert.equal(q().querySelectorAll('.qopt').length, 2);
  off();
});

test('C3: a plan-kind stop is drawn by the gate card on the feature card: one primary naming the pick', async () => {
  const ctx = await bootApp({ fetchHandler: recordAnswers('run-rr', []) });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [reqRun(C3_PLAN_STOP)] });
  await ctx.settle();
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')(
    { kind: 'card', id: 'c-stop', state: 'tracked', card: { type: 'progress', pipelineId: 'p-rr', runId: 'run-rr', projectKey: 'p', title: 'Stop' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel() {}, openArtifact() {}, announce() {} });
  doc.body.appendChild(built.el);
  await ctx.settle();
  const q = built.el.querySelector('.qpanel');
  assert.equal(q.querySelector('.ask-mcard-title').textContent, 'Run 4 · the plan check did not pass');
  const prim = visiblePrimaries(q);
  assert.equal(prim.length, 1);
  assert.equal(prim[0].textContent, 'Re-plan');
  assert.equal(q.querySelectorAll('.qopt').length, 2);
  assert.equal(barAnswer(built.el), null, 'the card foot draws no Answer beside the stop\'s own primary');
  built.dispose();
});

test('C3: a shape-feature frame keeps an open stop\'s pick and focus; only a held answer repaints it', async () => {
  const info = { featureId: 'feat-1', index: 8, stop: { reason: 'objection', held: false } };   // a slice's answer always has its index
  let gets = 0;
  const slice = (url) => (url === '/api/shape/pipelines/p-rr/slice' ? (gets++, res(200, { ...info })) : null);
  const ctx = await bootApp({ fetchHandler: recordAnswers('run-rr', [], slice) });
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [reqRun(C3_GATE_STOP)] });
  await ctx.settle();
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')(
    { kind: 'card', id: 'c-stop', state: 'tracked', card: { type: 'progress', pipelineId: 'p-rr', runId: 'run-rr', projectKey: 'p', title: 'Stop' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel() {}, openArtifact() {}, announce() {} });
  doc.body.appendChild(built.el);
  await ctx.settle(6);
  const q = () => built.el.querySelector('.qpanel');
  const tile = (v) => [...q().querySelectorAll('.qopt')].find((t) => t.dataset.value === v);
  const primary = () => visiblePrimaries(q())[0];
  click(ctx, tile('continue'));
  tile('continue').focus();
  assert.equal(primary().textContent, 'Accept as is');
  const before = gets;
  ctx.dispatch({ type: 'shape-feature', id: 'feat-1' });
  await ctx.settle(6);
  assert.ok(gets > before, 'the slice was re-read');
  assert.ok(tile('continue').classList.contains('sel'), 'the person\'s pick stays');
  assert.equal(primary().textContent, 'Accept as is');
  assert.equal(doc.activeElement, tile('continue'), 'focus stays on the picked tile');
  // An unchanged held state never rebuilds; a change of held state repaints with the pick carried.
  assert.equal(barAnswer(built.el), null, 'open stop: no Answer in the card foot');
  const kept = tile('continue');
  ctx.dispatch({ type: 'shape-feature', id: 'other' });
  await ctx.settle(6);
  assert.equal(tile('continue'), kept, 'another feature\'s frame leaves the panel alone');
  info.stop = { reason: 'objection', held: true, value: 'continue', after: 7 };
  ctx.dispatch({ type: 'shape-feature', id: 'feat-1' });
  await ctx.settle(6);
  assert.equal(q().querySelectorAll('.qopt').length, 0, 'the held answer draws its answered line');
  assert.equal(q().querySelector('.chat-rc-log-run').textContent, 'Run 8');
  assert.equal(q().querySelector('.chat-rc-log-text').textContent, 'accepted as is · decided by you');
  assert.equal(q().querySelectorAll('.step-head, .chat-rc-receipt').length, 0, 'one answered row: no head, no box');
  assert.equal(barAnswer(built.el), null, 'held stop: no Answer in the card foot');
});
