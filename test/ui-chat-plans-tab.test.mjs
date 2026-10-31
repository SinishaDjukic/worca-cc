// test/ui-chat-plans-tab.test.mjs — Shape it first, slice 4: the Chat home's Plans tab (home.mjs st.plans /
// loadPlans / refreshPlans, home-lists.mjs buildPlansList).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createChatHome, RUNS_TICK_MS } from '../ui/public/chat/home.mjs';
import { HOME_TAB_KEY, buildPlansList } from '../ui/public/chat/home-lists.mjs';
import { featureHeadline } from '../ui/public/shape/feature-view.mjs';

const trackDom = useDomRelease(afterEach);

const SHELL = `<!doctype html><html><body><section class="view" data-view="chat"><div class="chat-page" data-chat-page data-view="home">
  <div class="chat-convo"><div class="chat-home" data-chat-home><div class="chat-hero-slot" data-chat-hero-slot>
    <div class="ask-composer"><textarea class="ask-input"></textarea></div></div></div></div></div></section></body></html>`;

const FEATURE = (over = {}) => ({ id: 'feat-1', status: 'active', total: 3, done: 1, halted: null, ...over });
const ROW = (over = {}) => ({ threadId: 't1', cardId: 'card_00000001', title: 'Add login', threadTitle: 'Login chat', state: 'shaping', feature: null, ...over });
const RUNS = (o = {}) => ({ needs: [], running: [], finished: [], project: 'worca-cc', ...o });

function setup({ plans = [], flags = { scripts: true }, stored = null, threads = [] } = {}) {
  const dom = trackDom(new JSDOM(SHELL, { url: 'http://localhost:4317/' }));
  const { window } = dom;
  const doc = window.document;
  if (stored) window.sessionStorage.setItem(HOME_TAB_KEY, stored);
  const calls = [];
  let plansNow = plans;
  let flagsNow = flags;
  let runsNow = RUNS();
  const timers = [];
  const clock = {
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: () => {},
    setTimeout: (fn) => { void fn; return 1; }, clearTimeout: () => {},
  };
  const deps = {
    runs: () => runsNow,
    threads: async () => threads,
    workflows: async () => ({ list: [], portsFn: null }),
    flags: async () => flagsNow,
    plans: async () => { calls.push(['plans']); return plansNow; },
    mountFeature: (host, id) => { calls.push(['mountFeature', id]); host.textContent = `feature ${id}`; },
    threadForRun: async () => null,
    openThread: (id) => calls.push(['openThread', id]),
    openRunPanel: () => {}, setIntent: () => {}, prefill: () => {}, navigate: () => {}, level: () => 'expert',
  };
  const host = doc.querySelector('[data-chat-home]');
  const home = createChatHome({ doc, host, heroSlot: doc.querySelector('[data-chat-hero-slot]'), deps, timers: clock });
  return {
    window, doc, home, calls, timers,
    setPlans: (p) => { plansNow = p; },
    setFlags: (f) => { flagsNow = f; },
    setRuns: (r) => { runsNow = r; },
    tick: () => { for (const fn of timers) fn(); },
    panel: () => doc.querySelector('.chat-home-panel'),
  };
}
const settle = async (window, n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => window.setTimeout(r, 0)); };
const tab = (doc, t) => doc.querySelector(`.chat-home-tab[data-tab="${t}"]`);
const selected = (doc) => (doc.querySelector('.chat-home-tab[aria-selected="true"]') || { dataset: {} }).dataset.tab || null;
const key = (doc, el, k) => el.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const plansCalls = (s) => s.calls.filter((c) => c[0] === 'plans').length;

test('the Plans tab always shows and the plans load once per visit (plus refreshPlans)', async () => {
  const s = setup({ plans: [ROW()] });
  await settle(s.window);
  assert.equal(tab(s.doc, 'plans').hidden, false);
  assert.equal(tab(s.doc, 'plans').textContent, 'Plans');
  assert.equal(plansCalls(s), 1);
  tab(s.doc, 'plans').click();
  assert.equal(selected(s.doc), 'plans');
  s.tick(); s.tick();
  assert.equal(plansCalls(s), 1, 'the 1 s tick never refetches');
  s.home.refreshPlans();
  await settle(s.window);
  assert.equal(plansCalls(s), 2);
});

test('rows: title, thread title and a state chip; a feature row adds a <details> whose summary is the headline', async () => {
  const f = FEATURE();
  const s = setup({ plans: [ROW({ state: 'waiting', feature: f }), ROW({ threadId: 't2', cardId: 'card_00000002', title: 'Fix upload', state: 'done' })] });
  await settle(s.window);
  tab(s.doc, 'plans').click();
  const rows = [...s.panel().querySelectorAll('li.chat-home-plan')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.chat-home-plan-open').textContent.includes('Add login'), true);
  assert.equal(rows[0].querySelector('.chat-home-plan-open').textContent.includes('Login chat'), true);
  assert.equal(rows[0].querySelector('.chat-home-plan-state').textContent, 'waiting for approval');
  assert.equal(rows[1].querySelector('.chat-home-plan-state').textContent, 'done');
  assert.equal(rows[1].querySelector('details'), null, 'no feature: no details');
  const d = rows[0].querySelector('details.chat-home-plan-feature');
  assert.equal(d.querySelector('summary').textContent, featureHeadline(f));
  assert.equal(d.parentElement, rows[0]);
  assert.equal(rows[0].querySelector('.chat-home-plan-open').contains(d), false, 'a sibling of the row button, never nested');
  rows[0].querySelector('.chat-home-plan-open').click();
  assert.deepEqual(s.calls.filter((c) => c[0] === 'openThread'), [['openThread', 't1']]);
});

test('the empty list says "No plans yet"', async () => {
  const s = setup({ plans: [] });
  await settle(s.window);
  tab(s.doc, 'plans').click();
  assert.equal(s.panel().textContent, 'No plans yet');
});

test('a feature <details> mounts its view only when first opened, and the 1 s tick leaves it open', async () => {
  const s = setup({ plans: [ROW({ feature: FEATURE() })] });
  await settle(s.window);
  tab(s.doc, 'plans').click();
  const d = s.panel().querySelector('details.chat-home-plan-feature');
  assert.equal(s.calls.filter((c) => c[0] === 'mountFeature').length, 0, 'collapsed: no fetch');
  d.open = true;
  d.dispatchEvent(new s.window.Event('toggle'));
  assert.deepEqual(s.calls.filter((c) => c[0] === 'mountFeature'), [['mountFeature', 'feat-1']]);
  d.open = false; d.dispatchEvent(new s.window.Event('toggle'));
  d.open = true; d.dispatchEvent(new s.window.Event('toggle'));
  assert.equal(s.calls.filter((c) => c[0] === 'mountFeature').length, 1, 'the host mounts once');
  d.open = true;
  s.tick(); s.tick();
  assert.equal(s.panel().querySelector('details.chat-home-plan-feature'), d, 'the same node: an unchanged list is left alone');
  assert.equal(d.open, true);
});

test('a feature that halts (status and done unchanged) changes the signature, so the headline updates', async () => {
  const s = setup({ plans: [ROW({ feature: FEATURE() })] });
  await settle(s.window);
  tab(s.doc, 'plans').click();
  assert.equal(s.panel().querySelector('summary').textContent, '1 of 3 slices done');
  const halted = FEATURE({ halted: { index: 2, state: 'stopped', waiting: [3] } });
  s.setPlans([ROW({ feature: halted })]);
  s.home.refreshPlans();
  await settle(s.window);
  assert.equal(s.panel().querySelector('summary').textContent, featureHeadline(halted));
});

test('an opened feature stays open (view mounted) across a signature change; a closed one stays closed and mounts nothing', async () => {
  const s = setup({ plans: [
    ROW({ feature: FEATURE({ id: 'feat-open' }) }),
    ROW({ threadId: 't2', cardId: 'card_00000002', title: 'Other', feature: FEATURE({ id: 'feat-closed' }) }),
  ] });
  await settle(s.window);
  tab(s.doc, 'plans').click();
  const [first] = s.panel().querySelectorAll('details.chat-home-plan-feature');
  first.open = true;
  first.dispatchEvent(new s.window.Event('toggle'));
  const before = s.calls.filter((c) => c[0] === 'mountFeature').length;
  s.setPlans([
    ROW({ state: 'waiting', feature: FEATURE({ id: 'feat-open' }) }),
    ROW({ threadId: 't2', cardId: 'card_00000002', title: 'Other', state: 'waiting', feature: FEATURE({ id: 'feat-closed' }) }),
  ]);
  s.home.refreshPlans();
  await settle(s.window);
  const [a, b] = s.panel().querySelectorAll('details.chat-home-plan-feature');
  assert.notEqual(a, first, 'the list was rebuilt');
  assert.equal(a.open, true);
  assert.equal(a.querySelector('.chat-home-plan-feature-body').textContent, 'feature feat-open');
  assert.equal(b.open, false);
  assert.equal(b.querySelector('.chat-home-plan-feature-body').textContent, '');
  assert.equal(s.calls.filter((c) => c[0] === 'mountFeature').length, before + 1, 'one more GET, for the reopened card only');
  a.open = false;
  a.dispatchEvent(new s.window.Event('toggle'));
  s.setPlans([ROW({ state: 'running', feature: FEATURE({ id: 'feat-open' }) })]);
  s.home.refreshPlans();
  await settle(s.window);
  assert.equal(s.panel().querySelector('details.chat-home-plan-feature').open, false, 'closing is remembered');
});

test('arrow keys and Home/End include the Plans tab, between Recent chats and Workflows', async () => {
  const s = setup();
  await settle(s.window);
  tab(s.doc, 'chats').click();
  key(s.doc, tab(s.doc, 'chats'), 'ArrowRight');
  assert.equal(selected(s.doc), 'plans');
  key(s.doc, tab(s.doc, 'plans'), 'ArrowRight');
  assert.equal(selected(s.doc), 'workflows');
  key(s.doc, tab(s.doc, 'workflows'), 'ArrowLeft');
  assert.equal(selected(s.doc), 'plans');
  key(s.doc, tab(s.doc, 'plans'), 'End');
  assert.equal(selected(s.doc), 'workflows');
});

test('buildPlansList: a feature row built with its id in `open` is open and mounted at once', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const mounted = [];
  const open = new Set(['feat-1']);
  const ul = buildPlansList(doc, [ROW({ feature: FEATURE() })], { onOpen: () => {}, mountFeature: (h, id) => mounted.push([h, id]), open });
  const d = ul.querySelector('details');
  assert.equal(d.open, true);
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0][1], 'feat-1');
  assert.equal(RUNS_TICK_MS, 1000);
});
