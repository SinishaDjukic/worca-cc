// test/ui-shape-feature-view.test.mjs — Shaper s3: the feature's head-less view (the Plans tab and the group page's
// Overview) over featureCardModel: the open step, step log, the Ship card and the controls; featureHeadline. The run
// model owns the head, status line and member rows (the bundle merge, D12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { featureHeadline, renderFeature, renderFeatureRequirements, paintFeatureDecisions } from '../ui/public/shape/feature-view.mjs';
import * as FeatureView from '../ui/public/shape/feature-view.mjs';
import { setShipDialogOpener, renderShipCard } from '../ui/public/shape/ship-card.mjs';
import { shipLedger, careOutcome } from '../src/shared/shape/ship-ledger.mjs';
import { requirementStatus } from '../src/shared/shape/req-status.mjs';
import { featureFocusOf, focusFeatureControl } from '../ui/public/shape/feature-actions.mjs';
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

test('Plans tab and group page draw the same held row, once', () => {
  const f = feature({ slices: [slice(1, 'done', { pipelineId: 'p1' }), slice(2, 'held', { ticketId: 't2' }), slice(3, 'planned')],
    held: { index: 2, ticketId: 't2' }, originPipelineId: 'p0', log: [], ask: null });
  const row = (el) => {
    const r = el.querySelectorAll('.shape-feature-held');
    assert.equal(r.length, 1);
    return { text: r[0].textContent, start: el.querySelectorAll('[data-act="feature-start"]').length,
      needs: el.textContent.split('Needs you').length - 1, why: el.textContent.split('for you to start').length - 1 };
  };
  const { el: plans } = mount(f, PLANS());
  const a = row(plans);
  assert.deepEqual(a, { text: 'Needs youRun 2 waits for you to startStart now', start: 1, needs: 1, why: 1 });
  const { el: page } = mount(f, GROUP({ inGroup: true, omit: ['start-now', 'cancel'] }));
  assert.deepEqual(row(page), a);
  assert.equal(page.querySelector('[data-act="feature-more"]'), null, 'the group page header owns ⋯');
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
  assert.equal(el.querySelector('.ask-shipcard-stats').textContent, '3 runs · 12 files · +840 \u2212120');
  assert.match(el.querySelector('.ask-shipcard-why').textContent, /840 lines: one PR is easier to review/);
  const acts = d.acts.length;
  el.querySelector('[data-act="ship-create"]').click(); await flush();
  assert.deepEqual(opened, [done.id]);
  assert.equal(d.acts.length, acts, 'the card posts nothing: the dialog does');
  setShipDialogOpener(null);
});

test('Shaper requirements s3: the feature page\'s ledger saves its marks through saveAcceptance (PUT acceptance)', async () => {
  const acceptance = { agreed: [{ id: 'R-po-1', text: 'Export' }], entries: [], covered: [] };
  const done = { ...PAGE(), status: 'done', done: 3, slices: PAGE().slices.map((s) => ({ ...s, state: 'done' })),
    ship: { ready: true, mode: null, suggested: 'one', linesAdded: 1, linesRemoved: 0, files: 1, prUrl: null, hint: null, result: null, acceptance } };
  const calls = [];
  const was = globalThis.fetch;
  globalThis.fetch = async (url, o) => { calls.push([url, o.method, JSON.parse(o.body)]); return { ok: true, status: 200, json: async () => ({ acceptance: { ...acceptance, entries: [{ id: 'R-po-1', mark: 'met' }] } }) }; };
  try {
    const { el } = mount(done, PLANS());
    assert.equal(el.querySelector('[data-act="ship-create"]').disabled, true);
    el.querySelector('[data-act="ship-mark-R-po-1-met"]').click(); await flush(); await flush();
    assert.deepEqual(calls, [[`/api/shape/features/${done.id}/acceptance`, 'PUT', { entries: [{ id: 'R-po-1', mark: 'met' }] }]]);
    assert.equal(el.querySelector('[data-act="ship-create"]').disabled, false);
  } finally { globalThis.fetch = was; }
});

test('the Ship card once shipped: As stacked PRs with View PR on the last run\'s PR', () => {
  const done = { ...PAGE(), status: 'done', done: 3, slices: PAGE().slices.map((s) => ({ ...s, state: 'done', pr: s.pr && { ...s.pr, draft: false } })) };
  const shipped = mount({ ...done, ship: { ready: false, mode: 'stacked', prUrl: null, lastPrUrl: 'https://github.com/o/r/pull/2',
    result: { mode: 'stacked', prUrl: 'https://github.com/o/r/pull/2', closed: 0, release: null } } }, PLANS()).el;
  assert.match(shipped.querySelector('.ask-shipcard-done').textContent, /^As stacked PRs · View PR$/);
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

const SR_WAIT = () => ({ confirmed: [{ id: 'R-comp-4', text: 'EU only', role: 'compliance', roleLabel: 'Compliance', state: 'waiting', mark: null, reason: null, at: null }], owned: [],
  waiting: ['R-comp-4'], blocked: true, reason: 'Waiting for Compliance to confirm R-comp-4', met: { met: 0, total: 1 }, unmet: [],
  care: { choice: "Balanced · Worca's pick", outcome: null, line: '' }, base: 'main', order: [{ index: 1, pipelineId: 'p1', title: 'A', pr: null, onto: null }] });

test('D1: a marked feature\'s shipBlock renders the small-runs card and Met posts the confirm verb; unmarked unchanged', async () => {
  const sr = { confirmed: [{ id: 'R-comp-4', text: 'EU only', role: 'compliance', roleLabel: 'Compliance', state: 'waiting', mark: null, reason: null, at: null }], owned: [],
    waiting: ['R-comp-4'], blocked: true, reason: 'Waiting for Compliance to confirm R-comp-4', met: { met: 0, total: 1 },
    care: { choice: "Balanced · Worca's pick", outcome: null, line: '' }, base: 'main', order: [{ index: 1, pipelineId: 'p1', title: 'A', pr: null, onto: null }] };
  const ready = { ready: true, mode: null, smallRuns: sr };
  const { el } = mount(feature({ status: 'done', done: 3, ship: ready }));
  assert.ok(q(el, '[data-ship-card="ready"].is-small-runs'));
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ smallRuns: { ...sr, blocked: false, waiting: [], reason: null } }) }; };
  try {
    q(el, '[data-act="ship-mark-R-comp-4-met"]').click();
    await flush(); await flush();
  } finally { globalThis.fetch = real; }
  assert.deepEqual(sent, [['/api/shape/features/f1/confirm', { id: 'R-comp-4', mark: 'met' }]]);
  const plain = mount(feature({ status: 'done', done: 3, ship: { ready: true, mode: null } })).el;
  assert.equal(q(plain, '.is-small-runs'), null);
  assert.ok(q(plain, '[data-ship-card="ready"]'));
  const waiting = mount(feature({ ship: { ready: false, mode: null, smallRuns: sr } })).el;
  assert.ok(q(waiting, '[data-ship-card="waiting"]'), 'a marked feature still waits for its runs');
});

test('a marked feature shipped as one PR: the page\'s Ship card shows 1 PR open, one PR row and one PR holding every run', () => {
  const order = [1, 2, 3].map((i) => ({ index: i, pipelineId: `p${i}`, title: `Slice ${i} title`, pr: { number: 40, url: 'https://x/pull/40' }, onto: null }));
  const smallRuns = { ...SR_WAIT(), confirmed: [], waiting: [], blocked: false, reason: null, order };
  const shipped = (mode) => mount(feature({ status: 'done', done: 3, ship: { ready: false, mode, smallRuns } })).el;
  const el = shipped('one');
  assert.equal(el.querySelector('.ask-shipcard-done').textContent, '1 PR open');
  assert.equal(el.querySelector('.ask-shipcard-stats').textContent, 'one PR holding every run');
  assert.equal(el.querySelectorAll('.ask-shipcard-prs .plan-check-row').length, 1);
  assert.equal(shipped('stacked').querySelectorAll('.ask-shipcard-prs .plan-check-row').length, 3, 'stacked counts as today');
});

test('D1: on the feature page, Not met with a typed reason and Enter posts the mark and the reason', async () => {
  const sr = SR_WAIT();
  const { el } = mount(feature({ status: 'done', done: 3, ship: { ready: true, mode: null, smallRuns: sr } }));
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ smallRuns: { ...sr, blocked: false, waiting: [], reason: null } }) }; };
  try {
    q(el, '[data-act="ship-mark-R-comp-4-not-met"]').click();
    const input = q(doc.body, '[data-act="ship-mark-R-comp-4-text"]');
    input.value = 'Legal has not signed';
    input.dispatchEvent(new doc.defaultView.Event('input'));
    input.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter' }));
    await flush(); await flush();
  } finally { globalThis.fetch = real; }
  assert.deepEqual(sent, [['/api/shape/features/f1/confirm', { id: 'R-comp-4', mark: 'not-met', reason: 'Legal has not signed' }]]);
});

test('D1 (R-fit-4): a page repaint while a mark is in flight gives the focus back to the mark (featureFocusOf, blur on disable)', async () => {
  const win = doc.defaultView;
  const proto = win.HTMLButtonElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  Object.defineProperty(proto, 'disabled', { configurable: true, get() { return desc.get.call(this); }, set(v) { if (v) this.blur(); desc.set.call(this, v); } });
  const real = globalThis.fetch;
  let release;
  globalThis.fetch = () => new Promise((r) => { release = r; });
  const host = doc.createElement('div');
  doc.body.replaceChildren(host);
  const f = (sr) => feature({ id: 'f_focus', status: 'done', done: 3, ship: { ready: true, mode: null, smallRuns: sr } });
  try {
    host.replaceChildren(renderFeature(doc, f(SR_WAIT()), deps()));
    const met = q(host, '[data-act="ship-mark-R-comp-4-met"]');
    met.focus(); met.click();
    assert.equal(doc.activeElement, doc.body, 'Chromium blurred the disabled button');
    // The confirm route broadcasts before it answers: app.js paintShapeFeature rebuilds the page.
    const after = { ...SR_WAIT(), blocked: false, waiting: [], reason: null,
      confirmed: [{ ...SR_WAIT().confirmed[0], state: 'confirmed', mark: 'met', at: '2026-11-22T16:55:00.000Z' }] };
    const act = featureFocusOf(doc, host);
    host.replaceChildren(renderFeature(doc, f(after), deps()));
    focusFeatureControl(host, act);
    const fresh = q(host, '[data-act="ship-mark-R-comp-4-met"]');
    assert.notEqual(fresh, met);
    assert.equal(doc.activeElement, fresh);
    release({ ok: true, json: async () => ({ smallRuns: after }) });
    await flush(); await flush();
    assert.equal(doc.activeElement, fresh, 'the late answer keeps it there');
  } finally {
    globalThis.fetch = real;
    Object.defineProperty(proto, 'disabled', desc);
  }
});

// ---- Shaper small runs D3: the feature page's Requirements (one fold per role) and Decisions ----
const D3_AGREED = [
  { id: 'R-po-1', text: 'People see it' }, { id: 'R-po-2', text: 'People\nexport   it' }, { id: 'R-po-3', text: 'People pin it' },
  { id: 'R-po-4', text: 'People share it' }, { id: 'R-comp-1', text: 'A signed copy is kept' },
];
const D3_KINDS = [{ id: 'R-po-1', kind: 'owned', run: 2 }, { id: 'R-po-2', kind: 'owned', run: 3 }, { id: 'R-po-3', kind: 'owned', run: 4 },
  { id: 'R-po-4', kind: 'owned', run: 2 }, { id: 'R-comp-1', kind: 'confirmed', role: 'compliance' }];
const D3_RUNS = (s3 = 'running') => [{ index: 1, state: 'done' }, { index: 2, state: 'done' }, { index: 3, state: s3 }, { index: 4, state: 'planned' }, { index: 5, state: 'running' }];
const D3_RERUNS = [{ id: 'R-po-4', run: 5, why: 'change', at: '2026-11-21T10:00:00Z' }];
const d3Feature = ({ acceptance = [], runs = D3_RUNS(), log = null, figures = null } = {}) => {
  const sr = shipLedger({ agreed: D3_AGREED, kinds: D3_KINDS, acceptance, runs, reruns: D3_RERUNS });
  const care = careOutcome({ position: 'balanced', chosenBy: 'worca', worcaPick: 'balanced' }, figures, sr.met);
  return feature({ id: 'f_d3', requirementKinds: D3_KINDS,
    log: log || [{ key: 'outline', run: null, text: 'Split into 4 runs', detail: ['Run 2 · Export'] }, { key: 'r2-plan', run: 2, text: 'Plan approved', detail: [] }],
    ship: { ready: false, mode: null, smallRuns: { ...sr, care, base: 'main', order: [] } } });
};
const runHref = (n) => (n === 4 ? null : `#running/r${n}`);
const reqs = (f = d3Feature()) => { const el = renderFeatureRequirements(doc, f, { runHref }); doc.body.replaceChildren(el); return el; };
const rowsOf = (el) => [...el.querySelectorAll('.plan-check-row')];

test('Requirements lists 5 rows; each note equals shown.text of requirementStatus for its entry; data-owner is run N or confirmed by a person with a role; none is unowned', () => {
  const f = d3Feature();
  const el = reqs(f);
  assert.ok(el.matches('div.plan-body.srows.shape-feature-reqs'));
  assert.equal(el.querySelector('p.cap.shape-feature-reqs-cap').textContent, '5 requirements · 4 owned by a run · 1 you confirm');
  const rows = rowsOf(el);
  assert.equal(rows.length, 5);
  const sr = f.ship.smallRuns;
  const entries = new Map([...sr.owned, ...sr.confirmed].map((e) => [e.id, e]));
  for (const r of rows) {
    const e = entries.get(r.dataset.key);
    const { shown, ...bare } = e;
    assert.equal(r.querySelector('.plan-check-detail').textContent, requirementStatus(bare, { runs: D3_RUNS(), reruns: D3_RERUNS }).text, r.dataset.key);
    assert.ok(/^run \d+$/.test(r.dataset.owner) || r.dataset.owner === 'confirmed by a person', r.dataset.owner);
    if (r.dataset.owner === 'confirmed by a person') assert.equal(r.dataset.role, 'Compliance');
  }
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-detail').textContent), ['run 2 · met', 'run 3 · being built', 'run 4 · to do',
    'run 2 · changed · run 5 builds it', 'waiting for you to confirm · Compliance']);
});

test('owner direction: Requirements are grouped per role with the role fold, count and states; an all-met role is closed, a role with anything open is open', () => {
  const el = reqs();
  const folds = [...el.querySelectorAll('.shape-role-fold')];
  assert.deepEqual(folds.map((x) => x.querySelector('.shape-role-fold-head').dataset.role), ['product', 'compliance'], 'CONFIRM_ROLES order');
  const [po, comp] = folds;
  assert.equal(po.querySelector('.plan-fold-text').textContent, '4 · 1 met · 3 open');
  assert.equal(po.querySelector('.shape-role-fold-head').getAttribute('aria-expanded'), 'true');
  assert.equal(po.querySelectorAll('.plan-check-row').length, 4);
  assert.equal(comp.querySelector('.plan-fold-text').textContent, '1 · 0 met · 1 open');
  assert.ok(comp.querySelector('.shape-role-fold-head > .plan-check-mark').classList.contains('is-wait'), 'an open role: the grey ring, not a question');
  assert.equal(comp.querySelector('.shape-role-fold-head .sr-only').textContent, ', not all met');
  const met = reqs(d3Feature({ runs: D3_RUNS('done').map((r) => ({ ...r, state: 'done' })),
    acceptance: [{ id: 'R-comp-1', mark: 'met', at: '2026-11-22T16:55:00.000Z' }] }));
  const [po2, comp2] = met.querySelectorAll('.shape-role-fold-head');
  assert.equal(po2.getAttribute('aria-expanded'), 'false', 'all met: closed');
  assert.equal(comp2.getAttribute('aria-expanded'), 'false');
  assert.equal(comp2.querySelector('.plan-fold-text').textContent, '1 · 1 met');
  assert.ok(comp2.querySelector('.plan-check-mark svg'), 'the ✓ head');
  const dropped = reqs(d3Feature({ acceptance: [{ id: 'R-comp-1', mark: 'dropped', reason: 'out of scope' }] }));
  assert.equal(dropped.querySelector('[data-role="compliance"]').getAttribute('aria-expanded'), 'true', 'Dropped is open');
});

test('a decided requirement (Not met, Dropped) is not open in its role\'s summary, and the role never looks all met', () => {
  const two = (entries) => {
    const f = d3Feature();
    const sr = shipLedger({ agreed: [...D3_AGREED, { id: 'R-comp-2', text: 'Kept in the EU' }], kinds: [...D3_KINDS, { id: 'R-comp-2', kind: 'confirmed', role: 'compliance' }],
      acceptance: entries, runs: D3_RUNS(), reruns: D3_RERUNS });
    f.requirementKinds = [...D3_KINDS, { id: 'R-comp-2', kind: 'confirmed', role: 'compliance' }];
    f.ship.smallRuns = { ...f.ship.smallRuns, ...sr };
    return f;
  };
  const roleOf = (f, key = 'compliance') => {
    const head = reqs(f).querySelector(`[data-role="${key}"].shape-role-fold-head`);
    return [head.querySelector('.plan-fold-text').textContent, head.getAttribute('aria-expanded'), head.querySelector('.sr-only').textContent];
  };
  const met = { id: 'R-comp-1', mark: 'met' };
  assert.deepEqual(roleOf(two([met, { id: 'R-comp-2', mark: 'dropped', reason: 'later' }])), ['2 · 1 met · 1 dropped', 'true', ', not all met']);
  assert.deepEqual(roleOf(two([met, { id: 'R-comp-2', mark: 'not-met', reason: 'no' }])), ['2 · 1 met · 1 not met', 'true', ', not all met']);
  assert.deepEqual(roleOf(two([{ id: 'R-comp-1', mark: 'not-met', reason: 'no' }, { id: 'R-comp-2', mark: 'dropped', reason: 'x' }])),
    ['2 · 0 met · 1 not met · 1 dropped', 'true', ', not all met']);
  // A mark without its reason is undecided, and so is an accepted gap: both stay open.
  assert.deepEqual(roleOf(two([met, { id: 'R-comp-2', mark: 'dropped' }]))[0], '2 · 1 met · 1 open');
  assert.deepEqual(roleOf(two([met, { ...met, id: 'R-comp-2' }])), ['2 · 2 met', 'false', roleOf(two([met, { ...met, id: 'R-comp-2' }]))[2]]);
  const gap = d3Feature();
  const e = gap.ship.smallRuns.owned[0];
  e.status = 'gap-accepted'; e.shown = { ...e.shown, word: 'gap accepted', text: 'run 2 · gap accepted', mark: 'x' };
  assert.equal(roleOf(gap, 'product')[0], '4 · 0 met · 4 open');
});

test('an owned row\'s run N is a link to runHref(N), and plain text when runHref returns null', () => {
  const rows = rowsOf(reqs());
  const a = rows[0].querySelector('.plan-check-detail a.rd-fact-link');
  assert.equal(a.getAttribute('href'), '#running/r2');
  assert.equal(a.textContent, 'run 2');
  assert.equal(rows[0].querySelector('.plan-check-detail').textContent, 'run 2 · met', 'the text is still shown.text');
  assert.equal(rows[2].querySelector('a'), null, 'run 4 has no page yet');
  assert.equal(rows[2].querySelector('.plan-check-detail').textContent, 'run 4 · to do');
  assert.equal(rows[4].querySelector('a'), null, 'a confirmed row has no run link');
});

test('before and after Ship the confirmed row reads `waiting for you to confirm · Compliance`, then confirmed by you or Marked Not met by you · reason', () => {
  const note = (f) => reqs(f).querySelector('[data-key="R-comp-1"] .plan-check-detail').textContent;
  assert.equal(note(d3Feature()), 'waiting for you to confirm · Compliance');
  assert.equal(note(d3Feature({ acceptance: [{ id: 'R-comp-1', mark: 'met', at: '2026-11-22T16:55:00.000Z' }] })), 'confirmed by you · Compliance');
  assert.equal(note(d3Feature({ acceptance: [{ id: 'R-comp-1', mark: 'not-met', reason: 'no signed\ncopy' }] })), 'Marked Not met by you · no signed copy');
  const at = '2026-11-22T16:55:00.000Z';
  const row = reqs(d3Feature({ acceptance: [{ id: 'R-comp-1', mark: 'met', at }] })).querySelector('[data-key="R-comp-1"]');
  const d = new Date(at);
  assert.equal(row.title, `R-comp-1 · A signed copy is kept · confirmed by you · Compliance · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
});

test('a row with a note gives its mark a state-only accessible name', () => {
  const names = rowsOf(reqs()).map((r) => r.querySelector('.plan-check-mark').getAttribute('aria-label'));
  assert.deepEqual(names, ['met', 'in progress', 'waiting', 'in progress', 'waiting']);
  const f = d3Feature();
  const e = f.ship.smallRuns.owned[0];
  e.shown = { ...e.shown, word: 'gap accepted', text: `${e.shown.owner} · gap accepted`, mark: 'x' };
  assert.equal(reqs(f).querySelector(`[data-key="${e.id}"] .plan-check-mark`).getAttribute('aria-label'), 'gap accepted', 'not "not met"');
});

test('requirement text with newlines renders on one line', () => {
  const row = reqs().querySelector('[data-key="R-po-2"]');
  assert.equal(row.querySelector('.plan-check-label').textContent, 'People export it');
  assert.equal(row.title, 'R-po-2 · People export it · run 3 · being built');
});

test('Requirements and Decisions paint nothing without ship.smallRuns', () => {
  assert.equal(renderFeatureRequirements(doc, feature(), { runHref }), null);
  const host = doc.createElement('div');
  paintFeatureDecisions(doc, host, feature());
  assert.equal(host.childNodes.length, 0);
});

test('Decisions, with and without a key care log line: one [data-fact=care] row first, text === care.line === \'Care: \' + Ship card care dd, with and without figures; every other f.log line follows in order, each named decided', () => {
  const logs = [null, [{ key: 'care', run: null, text: 'Care: Lean · your pick', detail: [] }, { key: 'outline', run: null, text: 'Split into 4 runs', detail: ['Run 2 · Export'] },
    { key: 'r2-plan', run: 2, text: 'Plan approved', detail: [] }]];
  for (const log of logs) {
    for (const figures of [null, { gapsAtEnd: 0, changesAfterShip: 0 }]) {
      const f = d3Feature({ log, figures });
      const host = doc.createElement('div');
      doc.body.replaceChildren(host);
      paintFeatureDecisions(doc, host, f);
      assert.ok(host.classList.contains('plan-body') && host.classList.contains('srows') && host.classList.contains('shape-feature-decisions'));
      const care = host.querySelectorAll('[data-fact="care"]');
      assert.equal(care.length, 1);
      const items = [...host.querySelectorAll(':scope > ul.plan-checks > li')];
      assert.equal(items[0], care[0], 'first');
      const line = f.ship.smallRuns.care.line;
      assert.equal(care[0].querySelector('.plan-check-label').textContent, line);
      const ship = renderShipCard(doc, { phase: 'ready', featureId: 'f_d3', title: 'x', runs: 4, smallRuns: f.ship.smallRuns }, {});
      assert.equal(line, `Care: ${ship.querySelector('[data-fact="care"] dd').textContent}`);
      if (figures) assert.match(line, /built requirements met/);
      assert.deepEqual(items.slice(1).map((li) => li.querySelector('.plan-check-label').textContent), ['Split into 4 runs', 'Plan approved']);
      assert.deepEqual(items.slice(1).map((li) => li.querySelector('.plan-check-id').textContent), ['', 'Run 2']);
      assert.ok(items.every((li) => li.querySelector('.plan-check-mark').getAttribute('aria-label') === 'decided'));
      const show = items[1].querySelector('.chat-rc-log-show');
      assert.equal(show.textContent, 'Show');
      assert.equal(show.className, 'btn btn-sm btn-quiet chat-rc-log-show', 'a quiet button; the last class is the focus hook');
      assert.equal(items[1].querySelector('.chat-rc-log-detail').hidden, true);
    }
  }
});

test('Decisions: a repaint keeps the focus on the line\'s Show', () => {
  const log = (text) => [{ key: 'outline', run: null, text, detail: ['Run 2 · Export'] }];
  const host = doc.createElement('div');
  doc.body.replaceChildren(host);
  paintFeatureDecisions(doc, host, d3Feature({ log: log('Split into 4 runs') }));
  const was = host.querySelector('.chat-rc-log-show');
  was.focus();
  paintFeatureDecisions(doc, host, d3Feature({ log: log('Split into 5 runs') }));
  const now = host.querySelector('.chat-rc-log-show');
  assert.notEqual(now, was);
  assert.equal(doc.activeElement, now);
});

test('Ship card, run page and feature page show the same word for R-po-2', async () => {
  const { mountRunFacts } = await import('../ui/public/shape/run-facts.mjs');
  const f = d3Feature();
  const shown = f.ship.smallRuns.owned.find((o) => o.id === 'R-po-2').shown;
  const page = reqs(f).querySelector('[data-key="R-po-2"] .plan-check-detail').textContent;
  const ship = renderShipCard(doc, { phase: 'ready', featureId: 'f_d3', title: 'x', runs: 4, smallRuns: f.ship.smallRuns }, {});
  const shipNote = [...ship.querySelectorAll('.ask-shipcard-owned .plan-check-row')].find((r) => r.querySelector('.plan-check-id').textContent === 'R-po-2')
    .querySelector('.plan-check-detail').textContent;
  const host = doc.createElement('div');
  const runNote = mountRunFacts(host, { owns: [{ id: 'R-po-2', text: 'People export it', pass: null, word: shown.word, mark: shown.mark }], startsFrom: null })
    .querySelector('.plan-check-detail').textContent;
  assert.equal(shown.word, 'being built');
  assert.ok(page.endsWith(shown.word) && shipNote.endsWith(shown.word));
  assert.equal(runNote, shown.word);
  assert.equal(page, shipNote);
});

test('source scan: the status words appear in string literals only in req-status.mjs', async () => {
  const { readdirSync } = await import('node:fs');
  const root = new URL('../', import.meta.url);
  const files = [...readdirSync(new URL('ui/public/shape/', root)).filter((n) => n.endsWith('.mjs')).map((n) => `ui/public/shape/${n}`),
    'src/shared/shape/ship-ledger.mjs', 'src/shared/shape/run-facts.mjs', 'src/shared/shape/req-status.mjs'];
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const literals = (src) => strip(src).match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
  const words = ['being built', 'to do', 'builds it', 'fixes it'];
  const hits = files.filter((p) => literals(readFileSync(new URL(p, root), 'utf8')).some((l) => words.some((w) => l.includes(w))));
  assert.deepEqual(hits, ['src/shared/shape/req-status.mjs']);
  const importers = files.filter((p) => p.startsWith('ui/') && /\bfrom\s+['"][^'"]*req-status\.mjs['"]/.test(readFileSync(new URL(p, root), 'utf8')));
  assert.deepEqual(importers, [], 'no ui module imports req-status.mjs (R-arch-8)');
});

// ── Feature page slice 6 (R-ux-3): the Ship card first on the Requirements tab, and the open mark ────────────────
const HELD_VIEW = (ship) => feature({ done: 2, replanOf: 'f0', log: [{ key: 'l1', run: null, text: 'Split into 3 runs', detail: [] }],
  slices: [slice(1, 'done', { pipelineId: 'p1' }), slice(2, 'done', { pipelineId: 'p2' }), slice(3, 'held')],
  held: { index: 3, ticketId: 't3', reason: 'runs 1 and 2 clash in src/a.mjs' }, ship });
const kids = (el) => [...el.children].map((c) => (c.matches('[data-ship-card]') ? 'ship' : c.className.split(' ').find((x) => x.startsWith('shape-feature-'))));

test('shipFirst: the Ship card first, then the re-planned note, then the actions; no step log and no merge-order line', () => {
  for (const [ship, phase] of [[{ ready: true, mode: null, smallRuns: SR_WAIT() }, 'ready'], [{ ready: false, mode: null, smallRuns: SR_WAIT() }, 'waiting']]) {
    const { el } = mount(HELD_VIEW(ship), deps({ shipFirst: true }));
    assert.ok(el.firstElementChild.matches(`[data-ship-card="${phase}"]`), `${phase}: ${el.firstElementChild.className}`);
    assert.deepEqual(kids(el), ['ship', 'shape-feature-replanned', 'shape-feature-actions'], phase);
    assert.equal(el.querySelector('ol.shape-feature-log'), null);
    assert.equal(el.querySelector('.shape-feature-order'), null);
    assert.equal(el.querySelector('.shape-feature-actions .shape-feature-held-why').textContent, 'Run 3 is held: runs 1 and 2 clash in src/a.mjs');
  }
});

test('without shipFirst the view keeps today\'s order: note, step log, merge-order line, Ship card, actions', () => {
  const { el } = mount(HELD_VIEW({ ready: true, mode: null, smallRuns: SR_WAIT() }));
  assert.deepEqual(kids(el), ['shape-feature-replanned', 'shape-feature-log', 'shape-feature-order', 'ship', 'shape-feature-actions']);
});

const OPEN_MARK = (state, ship = {}) => feature({ status: 'done', done: 3,
  ship: { ready: true, mode: null, smallRuns: { ...SR_WAIT(), confirmed: [{ ...SR_WAIT().confirmed[0], state: 'confirmed', mark: 'met' },
    { ...SR_WAIT().confirmed[0], id: 'R-comp-5', state, mark: null }] }, ...ship } });

test('markOpen: true while a confirmed requirement is waiting or needs a reason and the feature is ready to ship', () => {
  assert.equal(FeatureView.markOpen(OPEN_MARK('waiting')), true);
  assert.equal(FeatureView.markOpen(OPEN_MARK('needs-reason')), true);
});

test('markOpen: false with every mark made, not ready, shipped, no small-runs ledger, or no feature', () => {
  assert.equal(FeatureView.markOpen(OPEN_MARK('confirmed')), false, 'all confirmed');
  assert.equal(FeatureView.markOpen(OPEN_MARK('waiting', { ready: false })), false, 'not ready to ship');
  assert.equal(FeatureView.markOpen(OPEN_MARK('waiting', { mode: 'stacked' })), false, 'already shipped');
  assert.equal(FeatureView.markOpen(OPEN_MARK('waiting', { smallRuns: undefined })), false, 'no small-runs ledger');
  assert.equal(FeatureView.markOpen(null), false);
});

// ── Slice 7 (R-ux-2, R-arch-4) ─────────────────────────────────────────────────────────────────────────────────
test('s7: the waiting row reads waiting for you to confirm · Design, and the caption counts what you confirm', () => {
  const kinds = [{ id: 'R-ux-2', kind: 'confirmed', role: 'design' }];
  const sr = shipLedger({ agreed: [{ id: 'R-ux-2', text: 'The words say who confirms' }], kinds, acceptance: [], runs: D3_RUNS('done') });
  const base = d3Feature();
  const el = reqs(feature({ id: 'f_s7', requirementKinds: kinds, ship: { ready: true, mode: null, smallRuns: { ...sr, care: base.ship.smallRuns.care, base: 'main', order: [] } } }));
  assert.equal(el.querySelector('[data-key="R-ux-2"] .plan-check-detail').textContent, 'waiting for you to confirm · Design');
  assert.equal(el.querySelector('p.cap.shape-feature-reqs-cap').textContent, '1 requirement · 0 owned by a run · 1 you confirm');
  assert.doesNotMatch(el.textContent, /confirmed by a person/);
});

test('s7 R-arch-4: the feature view\'s waiting Ship card of a feature with no chat says "on this page."', () => {
  const line = (hasChat) => mount(feature({ ...(hasChat === undefined ? {} : { hasChat }), ship: { ready: false, mode: null } }))
    .el.querySelector('[data-ship-card="waiting"]')?.textContent;
  assert.equal(line(false), 'Ship card comes when all 3 runs are done, on this page.');
  assert.equal(line(true), 'Ship card comes when all 3 runs are done, here and in the chat.');
  assert.equal(line(undefined), 'Ship card comes when all 3 runs are done, here and in the chat.');
});

// Slice 9 (R-po-4, D14): the feature page posts a note's acknowledgement with the check the person read.
test('s9: Acknowledge on the feature page posts the note and the check to /acknowledge and opens Create', async () => {
  const checkAt = '2026-11-27T10:00:00.000Z';
  const smallRuns = { ...SR_WAIT(), confirmed: [], waiting: [], blocked: true, reason: "Acknowledge the Verifier's note to ship",
    findings: { items: [{ id: 'note-1', text: 'the import test takes 40 s', ack: null }], checkAt, open: 1 } };
  const answered = { ...smallRuns, blocked: false, reason: null,
    findings: { items: [{ ...smallRuns.findings.items[0], ack: { by: 'ann', at: '2026-11-27T14:02:00.000Z' } }], checkAt, open: 0 } };
  const { el } = mount(feature({ status: 'done', done: 3, ship: { ready: true, mode: null, smallRuns } }));
  const button = q(el, '[data-act="ship-ack-note-1"]');
  assert.ok(button, 'the Acknowledge button on the feature page');
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push([url, init.method, JSON.parse(init.body)]); return { ok: true, json: async () => ({ smallRuns: answered }) }; };
  try {
    button.click();
    await flush(); await flush();
  } finally { globalThis.fetch = real; }
  assert.deepEqual(sent, [['/api/shape/features/f1/acknowledge', 'POST', { checkAt, note: 'note-1' }]]);
  assert.equal(q(el, '[data-act="ship-create"]').disabled, false);
});
