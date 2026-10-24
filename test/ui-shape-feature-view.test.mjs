// test/ui-shape-feature-view.test.mjs — Shaper s3: the feature's head-less view (the Plans tab and the group page's
// Overview) over featureCardModel: the open step, step log, the Ship card and the controls; featureHeadline. The run
// model owns the head, status line and member rows (the bundle merge, D12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { featureHeadline, renderFeature } from '../ui/public/shape/feature-view.mjs';
import { setShipDialogOpener } from '../ui/public/shape/ship-card.mjs';
import { closeMenus } from '../ui/public/workflows/menu.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const flush = () => new Promise((r) => setTimeout(r, 0));

const slice = (index, state, o = {}) => ({ index, title: `Slice ${index} title`, state, pipelineId: null, runId: null, pr: null, ...o });
const feature = (o = {}) => ({
  id: 'f1', title: 'Add billing', status: 'active', total: 3, done: 1, approveEach: true, open: true, halted: null,
  slices: [slice(1, 'done', { pipelineId: 'p1' }), slice(2, 'running', { pipelineId: 'p2' }), slice(3, 'planned')], ...o,
});
const deps = (o = {}) => ({
  acts: [], opened: [], runs: [],
  act(action, body, opts) { this.acts.push({ action, body, opts }); return Promise.resolve({ ok: true }); },
  openSlice(s) { this.opened.push(s); },
  openRun(r) { this.runs.push(r); },
  confirm: async () => true,
  ...o,
});
const mount = (f, d = deps()) => { const el = renderFeature(doc, f, d); doc.body.replaceChildren(el); return { el, d }; };
const q = (el, sel) => el.querySelector(sel);
const halted = (state, index = 2, waiting = []) => feature({
  halted: { index, state, waiting },
  slices: [slice(1, 'done', { pipelineId: 'p1' }), slice(2, state, { pipelineId: 'p2' }), slice(3, 'planned')],
});

test('featureHeadline: active, done, canceled, replanned', () => {
  assert.equal(featureHeadline(feature()), '1 of 3 slices done');
  assert.equal(featureHeadline(feature({ status: 'done', done: 3 })), 'All 3 slices done');
  assert.equal(featureHeadline(feature({ status: 'canceled', done: 1 })), 'Canceled · 1 of 3 slices done');
  assert.equal(featureHeadline(feature({ status: 'replanned' })), 'Re-planned');
  assert.equal(featureHeadline(feature({ status: 'replanning' })), 'Re-planned');
});

test('featureHeadline: halted states, one or several waiting', () => {
  assert.equal(featureHeadline(halted('stopped', 2, [3])), 'Slice 2 stopped · slice 3 waiting');
  assert.equal(featureHeadline(halted('error', 2, [3, 4, 5])), 'Slice 2 stopped · slices 3–5 waiting');
  assert.equal(featureHeadline(halted('paused', 2, [3])), 'Slice 2 paused · slice 3 waiting');
  assert.equal(featureHeadline(halted('failed', 1, [])), 'Slice 1 could not start');
  assert.equal(featureHeadline(halted('missed', 2, [3])), 'Slice 2 did not start · slice 3 waiting');
  assert.equal(featureHeadline(halted('canceled', 2, [])), 'Slice 2 did not start');
});

test('the section carries the feature id', () => {
  const { el } = mount(feature());
  assert.equal(el.dataset.feature, 'f1');
  assert.ok(!el.classList.contains('is-halted'));
});


const PAGE = () => ({ ...feature(), status: 'active', total: 3, done: 1, approveEach: false, open: true, halted: null,
  slices: [
    { index: 1, title: 'Store tags', state: 'done', pipelineId: 'p1', pr: { url: 'https://github.com/o/r/pull/1', number: 1, state: 'OPEN', draft: true } },
    { index: 2, title: 'Run tags', state: 'approval', pipelineId: 'p2', runId: 'r2', pr: null },
    { index: 3, title: 'Cost report', state: 'planned', pipelineId: null, pr: null } ] });
// The inline plan card stands in for the -2-chat card: Approve plan / Ask for changes / Full plan / ⋯.
const cardAsk = (slot) => {
  for (const t of ['Approve plan', 'Ask for changes', 'Full plan', '⋯']) {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = t; slot.appendChild(b);
  }
};
const menuLabels = () => [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')].map((b) => b.textContent);

const mounted = [];
const PLANS = (o = {}) => deps({ runsOpen: false, openPlan() {}, pause: async () => null, stop() {}, snapOf: () => null, ...o });
const GROUP = (o = {}) => PLANS({ runsOpen: true, mountAsk: (slot, step) => { mounted.push(step); cardAsk(slot); }, ...o });
const openMore = (el) => { closeMenus(); el.querySelector('[data-act="feature-more"]').click(); const l = menuLabels(); closeMenus(); return l; };
const look = (el) => ({
  log: [...el.querySelectorAll('.chat-rc-log-text')].map((n) => n.textContent),
  buttons: [...el.querySelectorAll('.shape-feature-actions > button')].map((b) => b.textContent || b.getAttribute('aria-label')),
});

test('the Plans tab and the group page render the same card with the same ⋯ items; only the step differs', () => {
  const f = feature({ slices: [slice(1, 'done'), slice(2, 'running', { pipelineId: 'p2', runId: 'r2' }), slice(3, 'planned')], originPipelineId: 'p0', log: [], ask: null });
  const { el: plans } = mount(f, PLANS());
  const a = look(plans);
  const menuA = openMore(plans);
  const { el: page } = mount(f, GROUP());
  assert.deepEqual(look(page), a);
  assert.deepEqual(openMore(page), menuA);
  assert.deepEqual(menuA, ['Re-plan the rest', 'Cancel the rest', 'Ask before each run', 'Open the plan']);
});

test('group page: the open step (server pointer) mounts in the card; the Plans tab mounts none', () => {
  mounted.length = 0;
  const f = feature({ slices: [slice(1, 'done'), slice(2, 'approval', { pipelineId: 'p2' })], originPipelineId: 'p0', log: [],
    ask: { index: 2, runId: 'r2', pipelineId: 'p2', id: 'q2', kind: 'plan' } });
  const { el: page } = mount(f, GROUP());
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].pipelineId, 'p2');
  assert.ok(page.querySelector('.shape-feature-ask'));
  mounted.length = 0;
  assert.equal(mount(f, PLANS()).el.querySelector('.shape-feature-ask'), null);
  assert.equal(mounted.length, 0);
});

test('halted: Resume · Re-plan the rest · ⋯; Resume acts', async () => {
  const f = { ...halted('error', 2, [3]), originPipelineId: 'p0', log: [], ask: null };
  const { el, d } = mount(f, PLANS());
  assert.deepEqual(look(el).buttons, ['Resume', 'Re-plan the rest', 'More actions']);
  el.querySelector('[data-act="feature-resume"]').click();
  await flush();
  assert.equal(d.acts[0].action, 'resume');
});

test('the re-planned banner names the successor, above the log', () => {
  const f = feature({ replanOf: 'feat_old', slices: [slice(1, 'running', { pipelineId: 'p1' })], total: 1, done: 0, originPipelineId: 'p0', log: [], ask: null });
  const { el } = mount(f, GROUP());
  assert.equal(el.querySelector('.shape-feature-replanned').textContent, 'Re-planned: the runs below replace the earlier outline');
  assert.ok(el.querySelector('.shape-feature-replanned').compareDocumentPosition(el.querySelector('.shape-feature-log')) & 4);
});

test('scan: one renderer, no summary/full/page mode branch in feature-view.mjs or app.js', () => {
  const src = readFileSync(new URL('../ui/public/shape/feature-view.mjs', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  // `h('summary', …)` is the Runs <details> summary element, not a mode.
  assert.doesNotMatch(src, /renderFeatureSummary|featureSummaryLine|featureWhere|deps\.page|(?<!h\()'(summary|full|page)'/);
  assert.doesNotMatch(app, /__shapeMode|renderFeatureSummary|featureWhere|mode: '(summary|full|page)'/);
});

test('the Ship card: the waiting line until every run is done, no buttons; the ready card without Not now opens the Create PR dialog', async () => {
  const wait = mount(PAGE(), PLANS()).el;
  assert.equal(wait.querySelector('[data-ship-card="waiting"]').textContent, 'Ship card comes when all 3 runs are done, here and in the chat.');
  assert.equal(wait.querySelectorAll('button[data-act^="ship-"]').length, 0);
  assert.equal(mount({ ...PAGE(), status: 'canceled' }, PLANS()).el.querySelector('[data-ship-card]'), null, 'canceled: nothing');
  const done = { ...PAGE(), status: 'done', done: 3, slices: PAGE().slices.map((s) => ({ ...s, state: 'done' })),
    ship: { ready: true, mode: null, suggested: 'one', linesAdded: 840, linesRemoved: 120, files: 12, prUrl: null, hint: null, result: null } };
  const opened = [];
  setShipDialogOpener((id) => { opened.push(id); });
  const { el, d } = mount(done, PLANS());
  const btns = [...el.querySelectorAll('[data-ship-card="ready"] button[data-act^="ship-"]')];
  assert.deepEqual(btns.map((b) => b.textContent), ['Create PR'], 'no Not now on the group page');
  assert.ok(el.querySelector('[data-act="ship-create"]').classList.contains('btn-primary'));
  assert.equal([...el.querySelectorAll('button')].filter((b) => /Stacked PRs|One PR/.test(b.textContent)).length, 0);
  assert.equal(el.querySelector('.ask-shipcard-stats').textContent, 'Ready to ship · 3 runs · 12 files · +840 \u2212120');
  assert.match(el.querySelector('.ask-shipcard-why').textContent, /840 lines: one PR is easier to review/);
  const acts = d.acts.length;
  el.querySelector('[data-act="ship-create"]').click(); await flush();
  assert.deepEqual(opened, [done.id]);
  assert.equal(d.acts.length, acts, 'the card posts nothing: the dialog does');
  setShipDialogOpener(null);
});

test('the Ship card once shipped: Shipped as stacked PRs with View PR on the last run\'s PR', () => {
  const done = { ...PAGE(), status: 'done', done: 3, slices: PAGE().slices.map((s) => ({ ...s, state: 'done', pr: s.pr && { ...s.pr, draft: false } })) };
  const shipped = mount({ ...done, ship: { ready: false, mode: 'stacked', prUrl: null, lastPrUrl: 'https://github.com/o/r/pull/2',
    result: { mode: 'stacked', prUrl: 'https://github.com/o/r/pull/2', closed: 0, release: null } } }, PLANS()).el;
  assert.match(shipped.querySelector('.ask-shipcard-done').textContent, /^Shipped as stacked PRs · View PR$/);
  assert.equal(shipped.querySelector('.ask-shipcard-pr').getAttribute('href'), 'https://github.com/o/r/pull/2');
  assert.equal(shipped.querySelectorAll('button[data-act^="ship-"]').length, 0);
});

test('a Ship as failure shows its error on a done feature', () => {
  const done = { ...PAGE(), status: 'done', done: 3, slices: PAGE().slices.map((s) => ({ ...s, state: 'done', pr: s.pr && { ...s.pr, draft: false } })),
    ship: { ready: true, mode: null, suggested: 'stacked', linesAdded: 2000, prUrl: null } };
  const { el } = mount(done, PLANS({ error: 'could not mark slice 2\'s PR ready' }));
  assert.equal(el.querySelector('.shape-feature-err').hidden, false);
  assert.equal(el.querySelector('.shape-feature-actions').hidden, false, 'no controls, but the error line shows');
  assert.match(el.querySelector('.ask-shipcard-why').textContent, /2000 lines: stacked PRs keep each review small/);
});

test('the merge (D10, D12): omit drops what the host\'s model footer shows; no pause/stop deps, no Pause/Stop; no head, status, runs or members', () => {
  const f = { ...halted('error', 2, [3]), originPipelineId: 'p0', log: [], ask: null };
  const { el: omitted } = mount(f, PLANS({ omit: ['resume'] }));
  assert.equal(omitted.querySelector('[data-act="feature-resume"]'), null);
  assert.ok(omitted.querySelector('[data-act="feature-replan"]'), 'Re-plan the rest is Shaper\'s alone');
  const running = feature({ slices: [slice(1, 'done'), slice(2, 'running', { pipelineId: 'p2', runId: 'r2' }), slice(3, 'planned')], originPipelineId: 'p0', log: [], ask: null });
  const { el } = mount(running, deps({ openPlan() {}, snapOf: () => null }));
  assert.equal(el.querySelector('[data-act="feature-pause"]'), null);
  assert.equal(el.querySelector('[data-act="feature-stop"]'), null);
  assert.equal(el.querySelectorAll('.shape-feature-head, .shape-feature-status, .shape-feature-runs, ol.chat-rc-members').length, 0);
});

test('run 4 D17: on the group page the view has no merge-order line and no ⋯; elsewhere it keeps both', () => {
  const f = { id: 'f1', title: 'Add billing', status: 'active', total: 2, done: 0, approveEach: false, open: true, halted: null,
    slices: [1, 2].map((index) => ({ index, title: `S${index}`, state: 'queued', pipelineId: `p${index}`, pr: null })), ship: {} };
  const d = { act: async () => ({ ok: true }), confirm: async () => true, openRun() {}, openPlan() {} };
  const inGroup = renderFeature(doc, f, { ...d, inGroup: true });
  assert.equal(inGroup.querySelector('.shape-feature-order'), null);
  assert.equal(inGroup.querySelector('[data-act="feature-more"]'), null);
  const plans = renderFeature(doc, f, d);
  assert.ok(plans.querySelector('.shape-feature-order'));
  assert.ok(plans.querySelector('[data-act="feature-more"]'));
});
