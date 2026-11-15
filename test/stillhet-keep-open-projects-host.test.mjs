// test/stillhet-keep-open-projects-host.test.mjs — comp.keep-open on Projects (B2.6): each inline form's one field keeps
// what you typed, its caret and its focus through a live redraw (F-6-01, F-a4-02's Link a remote), and a route change
// closes the form, so reopening starts empty. The host is test/helpers/stillhet-projects-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectsHost, KEYS, settle, go, closeHosts } from './helpers/stillhet-projects-host.mjs';

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
  assert.notEqual(after, before, 'the redraw rebuilt the field');
  assert.equal(after.value, 'abc');
  assert.deepEqual([after.selectionStart, after.selectionEnd], [1, 1]);
  assert.equal(h.d.activeElement, after);
};

test('F-6-01: Add by hand keeps its text, caret and focus through a live redraw', async () => {
  const h = await projectsHost();
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  await kept(h, 'pj-hand:project:');
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
