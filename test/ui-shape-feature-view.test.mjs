// test/ui-shape-feature-view.test.mjs — Shaper s3: the one feature card (the Plans tab and the group page) over
// featureCardModel: head, status line, open step, step log, Runs, Ship as and the controls; featureHeadline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { featureHeadline, renderFeature, refreshFeatureStatus } from '../ui/public/shape/feature-view.mjs';
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
  chip: el.querySelector('.shape-feature-chip').textContent,
  status: el.querySelector('.shape-feature-status').textContent,
  log: [...el.querySelectorAll('.chat-rc-log-text')].map((n) => n.textContent),
  runs: [...el.querySelectorAll('.chat-rc-member-label')].map((n) => n.textContent),
  buttons: [...el.querySelectorAll('.shape-feature-actions > button')].map((b) => b.textContent),
});

test('the Plans tab and the group page render the same card with the same ⋯ items; only Runs folding and the step differ', () => {
  const f = feature({ slices: [slice(1, 'done'), slice(2, 'running', { pipelineId: 'p2', runId: 'r2' }), slice(3, 'planned')], originPipelineId: 'p0', log: [], ask: null });
  const { el: plans } = mount(f, PLANS());
  const a = look(plans);
  const menuA = openMore(plans);
  const { el: page } = mount(f, GROUP());
  assert.deepEqual(look(page), a);
  assert.deepEqual(openMore(page), menuA);
  assert.deepEqual(menuA, ['Re-plan the rest', 'Cancel the rest', 'Ask before each run', 'Open the plan']);
  assert.equal(plans.querySelector('details.shape-feature-runs').open, false);
  assert.equal(page.querySelector('details.shape-feature-runs').open, true);
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

test('halted: Failed · Run 2, Resume · Re-plan the rest, waiting runs read Waiting; Resume acts', async () => {
  const f = { ...halted('error', 2, [3]), originPipelineId: 'p0', log: [], ask: null };
  const { el, d } = mount(f, PLANS());
  assert.match(el.querySelector('.shape-feature-status').textContent, /^Failed · Run 2/);
  assert.deepEqual(look(el).buttons, ['Resume', 'Re-plan the rest', '⋯']);
  assert.equal(el.querySelectorAll('.chat-rc-member-state')[3].textContent, 'Waiting');
  el.querySelector('[data-act="feature-resume"]').click();
  await flush();
  assert.equal(d.acts[0].action, 'resume');
});

test('the re-planned banner names the successor; refreshFeatureStatus moves only the status line', () => {
  const f = feature({ replanOf: 'feat_old', slices: [slice(1, 'running', { pipelineId: 'p1' })], total: 1, done: 0, originPipelineId: 'p0', log: [], ask: null });
  const { el } = mount(f, GROUP());
  assert.equal(el.querySelector('.shape-feature-replanned').textContent, 'Re-planned: the runs below replace the earlier outline');
  const log = el.querySelector('.shape-feature-log');
  refreshFeatureStatus(el, f, (pid) => (pid === 'p1' ? { source: 'live', status: 'running', stageProgress: { label: 'Review', text: 'Review' }, pipelineId: 'p1' } : null));
  assert.equal(el.querySelector('.shape-feature-status').textContent, 'Running · Run 1 · Review');
  assert.equal(el.querySelector('.shape-feature-log'), log);
});

test('scan: one renderer, no summary/full/page mode branch in feature-view.mjs or app.js', () => {
  const src = readFileSync(new URL('../ui/public/shape/feature-view.mjs', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  // `h('summary', …)` is the Runs <details> summary element, not a mode.
  assert.doesNotMatch(src, /renderFeatureSummary|featureSummaryLine|featureWhere|deps\.page|(?<!h\()'(summary|full|page)'/);
  assert.doesNotMatch(app, /__shapeMode|renderFeatureSummary|featureWhere|mode: '(summary|full|page)'/);
});

test('Ship as appears only when all slices are done and not shipped; the default is marked', async () => {
  const done = { ...PAGE(), status: 'done', done: 3, slices: PAGE().slices.map((s) => ({ ...s, state: 'done' })),
    ship: { ready: true, mode: null, suggested: 'one', linesAdded: 840, prUrl: null } };
  const { el, d } = mount(done, PLANS());
  const btns = [...el.querySelectorAll('.shape-feature-ship button')];
  assert.deepEqual(btns.map((b) => b.dataset.act), ['shape-feature-ship-stacked', 'shape-feature-ship-one']);
  assert.match(el.querySelector('.shape-feature-ship-one').textContent, /suggested/);
  assert.match(el.querySelector('.shape-feature-ship-why').textContent, /840 lines: one PR is easier to review/);
  btns[1].click(); await flush();
  assert.deepEqual(d.acts.at(-1), { action: 'ship', body: { mode: 'one' }, opts: { focus: 'shape-feature-ship-one' } });
  const shippedSlices = done.slices.map((s) => ({ ...s, pr: s.pr && { ...s.pr, draft: false } }));
  const shipped = mount({ ...done, slices: shippedSlices, ship: { ...done.ship, mode: 'one', prUrl: 'https://github.com/o/r/pull/9' } }, PLANS()).el;
  assert.match(shipped.querySelector('.shape-feature-shipped').textContent, /Shipped as one PR · open it/);
  assert.equal(shipped.querySelector('.shape-feature-shipped a').getAttribute('href'), 'https://github.com/o/r/pull/9');
  assert.equal(shipped.querySelector('.shape-feature-ship'), null);
  assert.equal(shipped.querySelectorAll('.chat-rc-member-state')[1].textContent, 'PR #1 open');
  const stacked = mount({ ...done, ship: { ...done.ship, mode: 'stacked' } }, PLANS()).el;
  assert.equal(stacked.querySelector('.shape-feature-shipped').textContent, 'Shipped as stacked PRs');
});

test('a Ship as failure shows its error on a done feature', () => {
  const done = { ...PAGE(), status: 'done', done: 3, slices: PAGE().slices.map((s) => ({ ...s, state: 'done', pr: s.pr && { ...s.pr, draft: false } })),
    ship: { ready: true, mode: null, suggested: 'stacked', linesAdded: 2000, prUrl: null } };
  const { el } = mount(done, PLANS({ error: 'could not mark slice 2\'s PR ready' }));
  assert.equal(el.querySelector('.shape-feature-err').hidden, false);
  assert.equal(el.querySelector('.shape-feature-actions').hidden, false, 'no controls, but the error line shows');
  assert.match(el.querySelector('.shape-feature-ship-why').textContent, /2000 lines: stacked PRs keep each review small/);
});
