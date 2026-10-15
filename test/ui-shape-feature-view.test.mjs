// test/ui-shape-feature-view.test.mjs — the feature card (spec §3.8, screen 9): headline, per-slice state and PR,
// Review plan / Answer / Open, and the active feature's Resume / Re-plan the rest / Cancel the rest / approve-each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SLICE_STATE_LABELS, featureHeadline, renderFeature } from '../ui/public/shape/feature-view.mjs';

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

test('renders the title, headline, progress bar and each state label', () => {
  const states = Object.keys(SLICE_STATE_LABELS);
  const f = feature({ total: states.length, slices: states.map((s, i) => slice(i + 1, s)) });
  const { el } = mount(f);
  assert.equal(q(el, '.shape-feature-title').textContent, 'Add billing');
  assert.equal(q(el, '.shape-feature-head').textContent, '1 of 13 slices done');
  const bar = q(el, '[role=progressbar]');
  assert.equal(bar.getAttribute('aria-valuemax'), '13');
  assert.equal(bar.getAttribute('aria-valuenow'), '1');
  assert.equal(q(el, '.shape-feature-fill').style.width, '8%');
  const labels = [...el.querySelectorAll('.shape-feature-slice-state')].map((n) => n.textContent);
  assert.deepEqual(labels, states.map((s) => SLICE_STATE_LABELS[s]));
  assert.equal(el.querySelectorAll('li.is-questions').length, 1);
  assert.equal(q(el, '.shape-feature-slice-title').textContent, '1 · Slice 1 title');
});

test('Review plan appears only on approval; questions show Answer; other started slices show Open', () => {
  const f = feature({ slices: [slice(1, 'approval', { pipelineId: 'p1' }), slice(2, 'questions', { runId: 'r2' }), slice(3, 'running', { pipelineId: 'p3' }), slice(4, 'planned')] });
  const { el, d } = mount(f);
  const rv = q(el, '[data-act=shape-feature-review-1]');
  assert.equal(rv.textContent, 'Review plan');
  assert.equal(q(el, '[data-act=shape-feature-review-2]').textContent, 'Answer');
  assert.equal(q(el, '[data-act=shape-feature-open-3]').textContent, 'Open');
  assert.equal(el.querySelectorAll('.shape-feature-review').length, 2);
  assert.equal(q(el, '[data-act=shape-feature-open-4]'), null);
  assert.equal(q(el, '[data-act=shape-feature-review-4]'), null);
  rv.click();
  assert.deepEqual(d.opened.map((s) => s.index), [1]);
  q(el, '[data-act=shape-feature-open-3]').click();
  assert.deepEqual(d.opened.map((s) => s.index), [1, 3]);
});

test('each slice button has its own data-act', () => {
  const f = feature({ slices: [slice(1, 'done', { pipelineId: 'p1' }), slice(2, 'running', { pipelineId: 'p2' })] });
  const { el } = mount(f);
  const acts = [...el.querySelectorAll('.shape-feature-slices button')].map((b) => b.dataset.act);
  assert.deepEqual(acts, ['shape-feature-open-1', 'shape-feature-open-2']);
});

test('a slice PR renders as a link', () => {
  const f = feature({ slices: [slice(1, 'done', { pipelineId: 'p1', pr: { url: 'https://x.test/pr/7', number: 7 } }), slice(2, 'done', { pr: { url: 'https://x.test/pr/x' } })] });
  const { el } = mount(f);
  const [a, b] = el.querySelectorAll('a.shape-feature-pr');
  assert.equal(a.textContent, 'PR #7');
  assert.equal(a.href, 'https://x.test/pr/7');
  assert.equal(a.target, '_blank');
  assert.equal(a.rel, 'noopener');
  assert.equal(b.textContent, 'PR');
});

test('a halted active feature shows Resume slice 2, Re-plan the rest and Cancel the rest', async () => {
  const { el, d } = mount(halted('stopped', 2, [3]));
  assert.ok(el.classList.contains('is-halted'));
  const res = q(el, '.shape-feature-resume');
  assert.equal(res.textContent, 'Resume slice 2');
  res.click();
  await flush();
  assert.deepEqual(d.acts.map((a) => a.action), ['resume']);
  assert.equal(d.acts[0].body, null);
  assert.ok(q(el, '.shape-feature-replan'));
  assert.ok(q(el, '.shape-feature-cancel'));
});

test('Re-plan the rest and Cancel the rest act only after the confirm', async () => {
  let ok = false;
  const d = deps({ confirm: async (o) => { d.asked = o; return ok; } });
  const { el } = mount(halted('stopped', 2, [3]), d);
  q(el, '.shape-feature-replan').click();
  await flush();
  assert.equal(d.acts.length, 0);
  assert.equal(d.asked.title, 'Re-plan the rest');
  ok = true;
  q(el, '.shape-feature-replan').click();
  await flush();
  assert.deepEqual(d.acts.map((a) => a.action), ['replan']);
  q(el, '.shape-feature-cancel').click();
  await flush();
  assert.equal(d.asked.title, 'Cancel the rest');
  assert.equal(d.asked.danger, true);
  assert.deepEqual(d.acts.map((a) => a.action), ['replan', 'cancel']);
});

test('a refused confirm for Cancel the rest posts nothing', async () => {
  const d = deps({ confirm: async () => false });
  const { el } = mount(halted('paused', 2, [3]), d);
  q(el, '.shape-feature-cancel').click();
  await flush();
  assert.equal(d.acts.length, 0);
});

test('an active feature with nothing open and nothing halted has no Re-plan/Cancel/Resume', () => {
  const { el } = mount(feature({ open: false, halted: null }));
  assert.equal(q(el, '.shape-feature-resume'), null);
  assert.equal(q(el, '.shape-feature-replan'), null);
  assert.equal(q(el, '.shape-feature-cancel'), null);
  assert.ok(q(el, '.shape-feature-approve-each'));
});

test('the approve-each switch posts approve-each {on:false}', async () => {
  const { el, d } = mount(feature());
  const box = q(el, '.shape-feature-approve-each input');
  assert.equal(box.checked, true);
  box.checked = false;
  box.dispatchEvent(new doc.defaultView.Event('change'));
  await flush();
  assert.deepEqual(d.acts[0], { action: 'approve-each', body: { on: false }, opts: { focus: 'shape-feature-approve-each' } });
});

test('an act failure shows the error and re-enables the button', async () => {
  const d = deps({ act: () => Promise.resolve({ ok: false, error: 'Slice 2 is still going…' }) });
  const { el } = mount(halted('stopped', 2, [3]), d);
  const res = q(el, '.shape-feature-resume');
  res.click();
  await flush();
  const err = q(el, '.shape-feature-err');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Slice 2 is still going…');
  assert.equal(err.getAttribute('role'), 'alert');
  assert.equal(res.disabled, false);
});

test('an act that rejects or answers without text shows the generic error', async () => {
  const d = deps({ act: () => Promise.reject(new Error('net')) });
  const { el } = mount(halted('stopped', 2, [3]), d);
  q(el, '.shape-feature-resume').click();
  await flush();
  assert.equal(q(el, '.shape-feature-err').textContent, 'That did not work. Try again.');
});

test('deps.error renders in the alert on first paint; no error leaves it hidden', () => {
  const { el } = mount(feature(), deps({ error: 'Slice 2 is still going…' }));
  const err = q(el, '.shape-feature-err');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Slice 2 is still going…');
  const { el: el2 } = mount(feature());
  assert.equal(q(el2, '.shape-feature-err').hidden, true);
});

test('act gets {focus: data-act} read before the button is disabled', async () => {
  const d = deps({
    act(action, body, opts) { this.acts.push({ action, body, opts }); return Promise.resolve({ ok: true }); },
  });
  const { el } = mount(halted('stopped', 2, [3]), d);
  const res = q(el, '.shape-feature-resume');
  const disabledWhenCalled = [];
  const orig = d.act;
  d.act = function (...a) { disabledWhenCalled.push(res.disabled); return orig.apply(this, a); };
  res.click();
  await flush();
  assert.deepEqual(d.acts[0].opts, { focus: 'shape-feature-resume' });
  assert.deepEqual(disabledWhenCalled, [true]);
});

test('a button that left the DOM during act is not re-enabled', async () => {
  let release;
  const d = deps({ act: () => new Promise((r) => { release = r; }) });
  const { el } = mount(halted('stopped', 2, [3]), d);
  const res = q(el, '.shape-feature-resume');
  res.click();
  assert.equal(res.disabled, true);
  doc.body.replaceChildren();
  release({ ok: true });
  await flush();
  assert.equal(res.disabled, true);
});

test('a canceled or done feature has no actions', () => {
  for (const status of ['canceled', 'done', 'replanned']) {
    const { el } = mount(feature({ status, halted: { index: 2, state: 'stopped', waiting: [3] } }));
    assert.equal(q(el, '.shape-feature-actions'), null, status);
    assert.equal(el.querySelectorAll('.shape-feature-actions button').length, 0);
  }
});

test('a questions slice reads "Waiting for your answers" with Answer', () => {
  const { el } = mount(feature({ slices: [slice(1, 'questions', { pipelineId: 'p1' })], total: 1, done: 0 }));
  assert.equal(q(el, '.shape-feature-slice-state').textContent, 'Waiting for your answers');
  assert.equal(q(el, '.shape-feature-review').textContent, 'Answer');
});

test('a halted missed slice reads "Slice 2 did not start"', () => {
  const { el } = mount(halted('missed', 2, [3]));
  assert.equal(q(el, '.shape-feature-head').textContent, 'Slice 2 did not start · slice 3 waiting');
  assert.equal(q(el, '.shape-feature-resume').textContent, 'Resume slice 2');
});

test('a replanning feature with replan.pipelineId shows Open the re-plan, which calls deps.openRun', () => {
  const replan = { pipelineId: 'rp1', projectKey: 'k' };
  const { el, d } = mount(feature({ status: 'replanning', replan }));
  const open = q(el, '.shape-feature-replan-open');
  assert.equal(open.textContent, 'Open the re-plan');
  open.click();
  assert.deepEqual(d.runs, [replan]);
  const { el: el2 } = mount(feature({ status: 'replanned', replan: { runId: 'r9' } }));
  assert.ok(q(el2, '.shape-feature-replan-open'));
  const { el: el3 } = mount(feature({ status: 'replanning', replan: null }));
  assert.equal(q(el3, '.shape-feature-replan-open'), null);
  const { el: el4 } = mount(feature({ replan }));
  assert.equal(q(el4, '.shape-feature-replan-open'), null);
});

test('replanOf shows the re-planned line; without it there is none', () => {
  const { el } = mount(feature({ replanOf: 'f0' }));
  assert.equal(q(el, '.shape-feature-replanned').textContent, 'Re-planned: the slices below replace the earlier outline');
  const { el: el2 } = mount(feature());
  assert.equal(q(el2, '.shape-feature-replanned'), null);
});

test('the section carries the feature id', () => {
  const { el } = mount(feature());
  assert.equal(el.dataset.feature, 'f1');
  assert.ok(!el.classList.contains('is-halted'));
});
