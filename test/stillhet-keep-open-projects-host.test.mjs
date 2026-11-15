// test/stillhet-keep-open-projects-host.test.mjs — comp.keep-open on Projects (B2.6): each inline form's one field keeps
// what you typed, its caret and its focus through a live redraw (F-6-01, F-a4-02's Link a remote), and a route change
// closes the form, so reopening starts empty. B2.8: an idle redraw keeps the sidebar's rows (listController paint({ ifChanged })). The host is test/helpers/stillhet-projects-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectsHost, KEYS, settle, go, closeHosts } from './helpers/stillhet-projects-host.mjs';
import { readBudgets, checkBudget, countMutations } from './helpers/stillhet-perf.mjs';

const { budgets, exclusions } = readBudgets();

afterEach(closeHosts);
const page = (d) => d.getElementById('route-place');
const field = (d) => page(d).querySelector('#pj-hand-v');
const pickMore = (d, v) => { page(d).querySelector('[data-menu="pj-more"]').click(); page(d).querySelector(`[data-menu-pick="pj-more|${v}"]`).click(); };
/** Types `text` into the field as a person does, the caret left at 1. */
const type = (w, el, text) => { el.focus(); el.value = text; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.setSelectionRange(1, 1); };
/** A live redraw of the page, then the watcher's microtask. */
const redraw = async (w) => { w.RailPlaces.projects.redraw(); await settle(0); };
const kept = async (h, key) => {
  const before = field(h.d);
  assert.ok(before, 'the form is open');
  assert.equal(before.getAttribute('data-keep'), key);
  type(h.w, before, 'abc');
  await redraw(h.w);
  const after = field(h.d);
  assert.equal(after, before, 'B2.7: the redraw kept the field');
  assert.equal(after.value, 'abc');
  assert.deepEqual([after.selectionStart, after.selectionEnd], [1, 1]);
  assert.equal(h.d.activeElement, after);
};

test('F-6-01: Add by hand keeps its text, caret and focus through a live redraw', async () => {
  const h = await projectsHost();
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  await kept(h, 'pj-hand:project:');
});

test('F-6-01 COV-1: a Several folders review name keeps its text, caret and focus through a live redraw', async () => {
  const dirs = { path: '/src', parent: '/', home: '/home/me', dirs: [{ name: 'a', path: '/src/a' }, { name: 'b', path: '/src/b' }] };
  const h = await projectsHost({ read: (u) => (u.startsWith('/api/fs/dirs') ? [200, dirs] : null) });
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  page(h.d).querySelector('[data-pa-way="many"]').click(); await settle(60);
  page(h.d).querySelector('.card-form [data-form="hand"] [data-confirm="yes"]').click(); await settle(150);
  for (const p of ['/src/a', '/src/b']) { page(h.d).querySelector(`[data-fb-pick="${p}"]`).click(); await settle(30); }
  page(h.d).querySelector('.fb [data-dialog="yes"]').click(); await settle(100);
  const before = page(h.d).querySelector('[data-fr-name="1"]');
  assert.equal(before.getAttribute('data-keep'), 'fr:1');
  type(h.w, before, 'bee');
  await redraw(h.w);
  const after = page(h.d).querySelector('[data-fr-name="1"]');
  assert.equal(after, before, 'B2.7: the redraw kept the review name field');
  assert.equal(after.value, 'bee');
  assert.deepEqual([after.selectionStart, after.selectionEnd], [1, 1]);
  assert.equal(h.d.activeElement, after);
});

test('F-cov1-02: in Several folders… a tick keeps the focus on its row, so Escape asks before it drops the picks', async () => {
  const dirs = { path: '/src', parent: '/', home: '/home/me', dirs: [{ name: 'a', path: '/src/a' }, { name: 'b', path: '/src/b' }] };
  const h = await projectsHost({ read: (u) => (u.startsWith('/api/fs/dirs') ? [200, dirs] : null) });
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  page(h.d).querySelector('[data-pa-way="many"]').click(); await settle(60);
  page(h.d).querySelector('.card-form [data-form="hand"] [data-confirm="yes"]').click(); await settle(150);
  for (const p of ['/src/a', '/src/b']) {
    const box = page(h.d).querySelector(`[data-fb-pick="${p}"]`);
    box.focus(); box.click(); await settle(30);
    assert.equal(h.d.activeElement?.getAttribute('data-fb-pick'), p, `the focus stays on ${p} after its tick`);
  }
  h.d.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(30);
  assert.ok(page(h.d).querySelector('.fb'), 'the browser stays open');
  assert.match(page(h.d).querySelector('.fb .rc-confirm')?.textContent || '', /Drop 2 picked folders\?/);
  assert.ok(page(h.d).querySelector('.card-form [data-form="hand"]'), 'the form stays');
});

test('F-6-01: Make a workspace keeps its text, caret and focus through a live redraw', async () => {
  const h = await projectsHost();
  h.w.RailPlaces.projects.newPick('hand-space'); await settle(100);
  await kept(h, 'pj-hand:space:');
});

test('F-6-01: Rename keeps its text, caret and focus through a live redraw', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  pickMore(h.d, 'rename'); await settle(80);
  await kept(h, `pj-hand:rename:${KEYS.ok}`);
});

test('F-6-01: Locate keeps its text, caret and focus through a live redraw', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.moved}` });
  page(h.d).querySelector('[data-pj-act]').click(); await settle(80);
  await kept(h, `pj-hand:locate:${KEYS.moved}`);
});

test('F-a4-02: Link a remote keeps its text, caret and focus through a live redraw', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.local}` });
  pickMore(h.d, 'remote'); await settle(80);
  await kept(h, `pj-hand:link:${KEYS.local}`);
});

test('route change closes Add by hand: away to Chat and back, the form is gone, and reopening shows an empty field', async () => {
  const h = await projectsHost();
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  type(h.w, field(h.d), 'abc');
  await go(h.w, '#chat', 80);
  await go(h.w, '#projects', 120);
  assert.equal(field(h.d), null, 'closed on the way out');
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  assert.equal(field(h.d).value, '');
});

// B2.7 (comp.patch-parts): the page is a frame built once, its column patched by part
const nodes = (el) => [...el.querySelectorAll('*')];
const col = (d) => page(d).querySelector(':scope > .convo > .convo-scroll > .convo-col');
/** One task of seed-ok's, in a chat of its own, whose state the test sets (`state.now`). */
function seedTask(w) {
  const state = { now: 'working' };
  const data = w.RailChats.data, stateOf = w.RunCardModel.stateOf;
  const chat = { id: 'c-b27', title: 'B2.7', project: 'seed-ok', tasks: [{ title: 'Ship the change', case: 'b27-case', detail: '' }] };
  w.RailChats.data = () => { const x = data(); return { ...x, chats: [...x.chats, chat] }; };
  w.RunCardModel.stateOf = (id) => (id === 'b27-case' ? state.now : stateOf(id));
  return state;
}

test('B2.7 F-6-01: a live redraw that changes nothing keeps every node of the project page (head, lists, form field, dock composer: same objects)', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  pickMore(h.d, 'rename'); await settle(80);
  type(h.w, field(h.d), 'abc');
  await redraw(h.w);
  const before = nodes(page(h.d)), dock = page(h.d).querySelector('#pj-dock');
  assert.ok(dock.children.length, 'the composer is docked');
  await redraw(h.w);
  assert.deepEqual(nodes(page(h.d)), before, 'every node kept');
  assert.equal(field(h.d).value, 'abc');
  assert.equal(h.d.activeElement, field(h.d));
});

test('B2.7 F-6-01: a redraw that changes one part (a task finishes: on-it and lately) leaves head, locate and the dock\'s nodes identical', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  const state = seedTask(h.w);
  pickMore(h.d, 'rename'); await settle(80);
  await redraw(h.w);
  const c = col(h.d), onIt = c.querySelector(':scope > p.convo-head');
  assert.match(onIt.textContent, /working/, 'the task is on it');
  const head = nodes(c.querySelector('.place-head, header') || c.firstElementChild), form = field(h.d), dock = nodes(page(h.d).querySelector('#pj-dock'));
  state.now = 'merged';
  await redraw(h.w);
  assert.equal(col(h.d), c, 'the same frame');
  assert.notEqual(c.querySelector(':scope > p.convo-head'), onIt, 'on-it was redrawn');
  assert.match(c.textContent, /Lately/, 'the finished task moved to Lately');
  assert.deepEqual(nodes(c.querySelector('.place-head, header') || c.firstElementChild), head, 'head kept');
  assert.equal(field(h.d), form, 'locate (the open form) kept');
  assert.deepEqual(nodes(page(h.d).querySelector('#pj-dock')), dock, 'the dock kept');
});

test('B2.7 F-6-01: the home page\'s form field and card grid keep their nodes through an idle redraw; going home → project → home rebuilds the frame once', async () => {
  const h = await projectsHost();
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  const f = field(h.d), grid = page(h.d).querySelector('.pg-grid'), cards = nodes(grid), home = col(h.d);
  assert.ok(grid, 'the card grid is drawn');
  await redraw(h.w);
  assert.equal(field(h.d), f, 'the field kept');
  assert.equal(page(h.d).querySelector('.pg-grid'), grid, 'the grid kept');
  assert.deepEqual(nodes(grid), cards);
  await go(h.w, `#projects/${KEYS.ok}`, 120);
  assert.notEqual(col(h.d), home, 'a project page is its own frame');
  await go(h.w, '#projects', 120);
  const again = col(h.d);
  assert.notEqual(again, home, 'home again: its frame rebuilt');
  await redraw(h.w);
  assert.equal(col(h.d), again, 'once: the next redraw keeps it');
  // another place wrote the shared page: a frame of the same shape is not this one's, so it is rebuilt
  page(h.d).innerHTML = '<div class="convo"><div class="convo-scroll"><div class="convo-col is-center"></div></div></div>';
  const foreign = col(h.d);
  await redraw(h.w);
  assert.notEqual(col(h.d), foreign);
  assert.ok(page(h.d).querySelector('.pg-grid'), 'the home is drawn whole');
});

test('B2.8 F-6-01: a no-change Projects redraw keeps every sidebar row node and the focused row\'s focus', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  await redraw(h.w);
  const bar = h.d.getElementById('bar-place'), row = bar.querySelector('[data-open^="proj:"]');
  assert.ok(row, 'the Projects bar shows its projects');
  row.focus();
  const before = nodes(bar), stops = [...bar.querySelectorAll('[data-open]')].map((b) => b.tabIndex);
  await redraw(h.w);
  const after = nodes(bar);
  assert.ok(after.length === before.length && after.every((n, i) => n === before[i]), 'every sidebar node kept (the same objects)');
  assert.equal(h.d.activeElement, row, 'the focused row keeps the focus');
  assert.deepEqual([...bar.querySelectorAll('[data-open]')].map((b) => b.tabIndex), stops, 'the row tab stops are unchanged');
});

test('B2.7 C1 F-6-01: a no-change Projects redraw makes no more DOM mutations than its budget', async (t) => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}` });
  await redraw(h.w);
  const m = countMutations(h.w, h.d.body, exclusions);
  await redraw(h.w);
  const r = m.stop();
  t.diagnostic(`budget projectsNoChangeMutations: measured ${r.counted}, pinned ${budgets.projectsNoChangeMutations?.value} (${r.total} records)`);
  const c = checkBudget('projectsNoChangeMutations', r.counted, budgets);
  assert.ok(c.ok, `${c.message}\n${r.sample.join('\n')}`);
});
