// test/ui-shape-feature-view.test.mjs — the feature card (spec §3.8, screen 9): headline, per-slice state and PR,
// Review plan / Answer / Open, and the active feature's Resume / Re-plan the rest / Cancel the rest / approve-each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { SLICE_STATE_LABELS, featureHeadline, featureWhere, renderFeature, renderFeatureSummary, featureSummaryLine } from '../ui/public/shape/feature-view.mjs';
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

test('approveEach false (the D19 default) renders an unchecked switch', () => {
  const { el } = mount(feature({ approveEach: false }));
  assert.equal(q(el, '.shape-feature-approve-each input').checked, false);
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

// ---- D16: the feature page (deps.page) and the Chat summary card ---------------------------------------------------

const PAGE = () => ({ ...feature(), status: 'active', total: 3, done: 1, approveEach: false, open: true, halted: null,
  slices: [
    { index: 1, title: 'Store tags', state: 'done', pipelineId: 'p1', pr: { url: 'https://github.com/o/r/pull/1', number: 1, state: 'OPEN', draft: true } },
    { index: 2, title: 'Run tags', state: 'approval', pipelineId: 'p2', runId: 'r2', pr: null },
    { index: 3, title: 'Cost report', state: 'planned', pipelineId: null, pr: null } ] });

// D30/D31/D33
const WAIT = () => ({ ...feature(), title: 'Charts', total: 2, done: 0, approveEach: false, open: true, halted: null,
  slices: [
    { index: 1, title: 'Store chart definitions', state: 'approval', pipelineId: 'p1', runId: 'r1', pr: null },
    { index: 2, title: 'Chart export', state: 'planned', pipelineId: null, pr: null } ] });
const PLAN_PROG = { mode: 'stages', label: 'Plan', text: 'Plan · needs you: approve the plan', tone: 'amber', fraction: 0.1 };
// The inline plan card stands in for the -2-chat card: Approve plan / Ask for changes / Full plan / ⋯.
const cardAsk = (slot) => {
  for (const t of ['Approve plan', 'Ask for changes', 'Full plan', '⋯']) {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = t; slot.appendChild(b);
  }
};
const pageDeps = (o = {}) => deps({ page: true, progressOf: () => PLAN_PROG, mountAsk: cardAsk, ...o });
const menuLabels = () => [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')].map((b) => b.textContent);
const pick = (label) => [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')].find((b) => b.textContent === label).click();

test('featureWhere: the stage and the wait in words; the headline when nothing is in flight or it halted', () => {
  assert.equal(featureWhere(WAIT(), PLAN_PROG), 'Slice 1 of 2 › Plan › your approval');
  assert.equal(featureWhere(WAIT(), null), 'Slice 1 of 2 › Plan › your approval', 'no live run: the stage from the slice state');
  const q = { ...WAIT(), slices: [{ ...WAIT().slices[0], state: 'questions' }, WAIT().slices[1]] };
  assert.equal(featureWhere(q, null), 'Slice 1 of 2 › Plan › your answers');
  const building = { ...PAGE(), slices: PAGE().slices.map((s) => (s.index === 2 ? { ...s, state: 'running' } : s)) };
  assert.equal(featureWhere(building, { label: 'Build', text: 'Build · task 2 of 5' }), 'Slice 2 of 3 › Build › task 2 of 5');
  assert.equal(featureWhere(building, null), 'Slice 2 of 3 › Build');
  assert.equal(featureWhere(halted('paused', 2, [3]), null), 'Slice 2 paused · slice 3 waiting');
  assert.equal(featureWhere(feature({ status: 'done', done: 3 }), null), 'All 3 slices done');
});

test('page waiting state: one line, one bar, the ask first, no Review plan, at most 5 controls', () => {
  const { el } = mount(WAIT(), pageDeps());
  assert.equal(q(el, '.shape-feature-head').textContent, 'Slice 1 of 2 › Plan › your approval');
  assert.ok(q(el, '.shape-feature-head').classList.contains('is-needs'));
  assert.equal(el.querySelectorAll('.shape-feature-segs').length, 1);
  assert.equal(q(el, '.run-prog'), null, 'no stage bar');
  assert.equal(q(el, '.shape-feature-current-bar'), null);
  assert.equal(q(el, '.shape-feature-current-text'), null);
  assert.equal(q(el, '.shape-feature-review'), null, 'no Review plan: the plan is right below');
  const order = [...el.children].map((c) => c.className.split(' ')[0]);
  assert.ok(order.indexOf('shape-feature-current') < order.indexOf('shape-feature-slices'), 'the ask comes before the list');
  const controls = el.querySelectorAll('button, a[href], input, select, textarea');
  // Exactly 5 today (4 stand-in card buttons + ⋯): the D31 limit, with no slack.
  assert.ok(controls.length <= 5, `${controls.length} controls`);
  assert.equal(q(el, '.shape-feature-replan'), null);
  assert.equal(q(el, '.shape-feature-cancel'), null);
  assert.equal(q(el, '.shape-feature-approve-each'), null);
});

test('page questions state: no Answer button beside the inline ask', () => {
  const f = { ...WAIT(), slices: [{ ...WAIT().slices[0], state: 'questions' }, WAIT().slices[1]] };
  const { el } = mount(f, pageDeps());
  assert.equal(q(el, '.shape-feature-review'), null);
  assert.equal(q(el, '.shape-feature-head').textContent, 'Slice 1 of 2 › Plan › your answers');
});

test('⋯ holds Open slice run, Re-plan the rest, Cancel the rest and Approve each', async () => {
  const d = pageDeps();
  const { el } = mount(WAIT(), d);
  const more = q(el, '.shape-feature-more');
  assert.equal(more.getAttribute('aria-haspopup'), 'menu');
  assert.equal(more.getAttribute('aria-label'), 'More actions');
  more.click();
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(menuLabels(), ['Open slice run', 'Re-plan the rest', 'Cancel the rest', 'Approve each slice\'s plan']);
  pick('Open slice run');
  assert.deepEqual(d.opened.map((s) => s.index), [1]);
  more.click(); pick('Re-plan the rest'); await flush();
  assert.deepEqual(d.acts.map((a) => a.action), ['replan']);
  assert.deepEqual(d.acts[0].opts, { focus: 'shape-feature-more' });
  more.click(); pick('Cancel the rest'); await flush();
  assert.deepEqual(d.acts.map((a) => a.action), ['replan', 'cancel']);
  more.click();
  const each = [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')].find((b) => b.textContent === 'Approve each slice\'s plan');
  assert.equal(each.getAttribute('aria-checked'), 'false');
  each.click(); await flush();
  assert.deepEqual(d.acts.at(-1), { action: 'approve-each', body: { on: true }, opts: { focus: 'shape-feature-more' } });
  closeMenus();
});

test('⋯: a refused confirm posts nothing; nothing open drops Re-plan/Cancel; no run drops Open slice run', async () => {
  const d = pageDeps({ confirm: async () => false });
  const { el } = mount(WAIT(), d);
  q(el, '.shape-feature-more').click(); pick('Cancel the rest'); await flush();
  assert.equal(d.acts.length, 0);
  const idle = { ...WAIT(), open: false, slices: [{ ...WAIT().slices[0], runId: null, pipelineId: null, state: 'shaping' }, WAIT().slices[1]] };
  const { el: el2 } = mount(idle, pageDeps());
  q(el2, '.shape-feature-more').click();
  assert.deepEqual(menuLabels(), ['Approve each slice\'s plan']);
  closeMenus();
});

test('the page line keeps the halted amber (style.css)', async () => {
  const css = await readFile(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.shape-feature\.is-page:not\(\.is-halted\) \.shape-feature-head\{color:var\(--ink\);\}/);
  assert.match(css, /\.shape-feature\.is-halted \.shape-feature-head\{[^}]*color:var\(--amber-ink\)/);
});

test('page mode: segmented bar, merge first, current slice block, ask host, actions', () => {
  const asked = [];
  const { el } = mount(PAGE(), deps({ page: true, progressOf: () => PLAN_PROG,
    mountAsk: (host, s) => asked.push([host.className, s.index]) }));
  assert.ok(el.classList.contains('is-page'));
  assert.equal(el.querySelector('.shape-feature-head').textContent, 'Slice 2 of 3 › Plan › your approval');
  assert.equal(el.querySelector('.shape-feature-bar'), null, 'the segmented bar replaces the single bar');
  assert.equal(el.querySelectorAll('.shape-feature-seg').length, 3);
  assert.deepEqual([...el.querySelectorAll('.shape-feature-seg')].map((x) => x.dataset.state), ['done', 'approval', 'planned']);
  assert.equal(el.querySelector('.shape-feature-slice.is-done .shape-feature-merge').textContent, 'merge first');
  assert.equal(el.querySelector('.shape-feature-slice.is-done .shape-feature-pr').textContent, 'PR #1 · draft');
  assert.match(el.querySelector('.shape-feature-current').textContent, /Slice 2 · Run tags/);
  assert.equal(el.querySelector('.shape-feature-current-bar'), null);
  assert.deepEqual(asked, [['shape-feature-ask', 2]]);
  assert.match(el.querySelector('.shape-feature-order').textContent, /Merge in order/);
  assert.ok(el.querySelector('.shape-feature-more'));
  assert.equal(el.querySelector('.shape-feature-replan'), null);
  assert.equal(el.querySelector('.shape-feature-cancel'), null);
  assert.equal(el.querySelector('[data-act="shape-feature-approve-each"]'), null);
  assert.equal(el.querySelector('.shape-feature-ship'), null, 'no Ship as before every slice is done');
});

test('page mode: merge after slice K on a later open PR; merged and closed PRs carry no tag', () => {
  const pr = (n, state = 'OPEN') => ({ url: `https://github.com/o/r/pull/${n}`, number: n, state });
  const f = { ...PAGE(), slices: [
    { index: 1, title: 'A', state: 'done', pipelineId: 'p1', pr: pr(1, 'MERGED') },
    { index: 2, title: 'B', state: 'done', pipelineId: 'p2', pr: pr(2) },
    { index: 3, title: 'C', state: 'done', pipelineId: 'p3', pr: pr(3) } ] };
  const { el } = mount(f, deps({ page: true }));
  assert.deepEqual([...el.querySelectorAll('.shape-feature-slice')].map((li) => li.querySelector('.shape-feature-merge')?.textContent || null),
    [null, 'merge first', 'merge after slice 2']);
});

test('Ship as appears only when all slices are done and not shipped; the default is marked', async () => {
  const done = { ...PAGE(), status: 'done', done: 3, slices: PAGE().slices.map((s) => ({ ...s, state: 'done' })),
    ship: { ready: true, mode: null, suggested: 'one', linesAdded: 840, prUrl: null } };
  const { el, d } = mount(done, deps({ page: true }));
  const btns = [...el.querySelectorAll('.shape-feature-ship button')];
  assert.deepEqual(btns.map((b) => b.dataset.act), ['shape-feature-ship-stacked', 'shape-feature-ship-one']);
  assert.match(el.querySelector('.shape-feature-ship-one').textContent, /suggested/);
  assert.match(el.querySelector('.shape-feature-ship-why').textContent, /840 lines: one PR is easier to review/);
  btns[1].click(); await flush();
  assert.deepEqual(d.acts.at(-1), { action: 'ship', body: { mode: 'one' }, opts: { focus: 'shape-feature-ship-one' } });
  const shippedSlices = done.slices.map((s) => ({ ...s, pr: s.pr && { ...s.pr, draft: false } }));
  const shipped = mount({ ...done, slices: shippedSlices, ship: { ...done.ship, mode: 'one', prUrl: 'https://github.com/o/r/pull/9' } }, deps({ page: true })).el;
  assert.match(shipped.querySelector('.shape-feature-shipped').textContent, /Shipped as one PR · open it/);
  assert.equal(shipped.querySelector('.shape-feature-shipped a').getAttribute('href'), 'https://github.com/o/r/pull/9');
  assert.equal(shipped.querySelector('.shape-feature-ship'), null);
  assert.equal(shipped.querySelector('.shape-feature-pr').textContent, 'PR #1');
  const stacked = mount({ ...done, ship: { ...done.ship, mode: 'stacked' } }, deps({ page: true })).el;
  assert.equal(stacked.querySelector('.shape-feature-shipped').textContent, 'Shipped as stacked PRs');
});

test('a Ship as failure shows its error on a done feature', () => {
  const done = { ...PAGE(), status: 'done', done: 3, slices: PAGE().slices.map((s) => ({ ...s, state: 'done', pr: s.pr && { ...s.pr, draft: false } })),
    ship: { ready: true, mode: null, suggested: 'stacked', linesAdded: 2000, prUrl: null } };
  const { el } = mount(done, deps({ page: true, error: 'could not mark slice 2\'s PR ready' }));
  assert.equal(el.querySelector('.shape-feature-err').hidden, false);
  assert.match(el.querySelector('.shape-feature-ship-why').textContent, /2000 lines: stacked PRs keep each review small/);
});

test('card mode (no deps.page) is unchanged: no segments, no current block, no Ship as', () => {
  const { el } = mount(PAGE(), deps());
  assert.equal(el.querySelector('.shape-feature-segs'), null);
  assert.ok(el.querySelector('.shape-feature-bar'));
  assert.equal(el.querySelector('.shape-feature-current'), null);
  assert.equal(el.querySelector('.shape-feature-merge'), null);
  assert.equal(el.querySelector('.shape-feature-pr').textContent, 'PR #1');
});

test('summary card: one line, segmented bar, Open feature; needs-you and stopped variants', () => {
  const open = [];
  const el = renderFeatureSummary(doc, PAGE(), { openFeature: (id) => open.push(id) });
  assert.equal(el.querySelector('.shape-feature-sum-line').textContent, 'Shaper · Slice 2 needs you');
  assert.ok(el.classList.contains('is-needs'));
  assert.equal(el.querySelectorAll('.shape-feature-seg').length, 3);
  el.querySelector('.shape-feature-sum-open').click();
  assert.deepEqual(open, [PAGE().id]);
  const stopped = { ...PAGE(), halted: { index: 2, state: 'stopped', waiting: [3] }, slices: PAGE().slices.map((s) => (s.index === 2 ? { ...s, state: 'stopped' } : s)) };
  assert.equal(renderFeatureSummary(doc, stopped, { openFeature() {} }).querySelector('.shape-feature-sum-line').textContent,
    'Shaper · Slice 2 stopped · slice 3 waiting');
  assert.equal(featureSummaryLine({ ...PAGE(), slices: PAGE().slices.map((s) => ({ ...s, state: s.index === 1 ? 'done' : 'planned' })) }),
    'Shaper · 1 of 3 slices done');
});
