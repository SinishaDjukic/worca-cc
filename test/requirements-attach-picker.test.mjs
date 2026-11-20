// test/requirements-attach-picker.test.mjs — the multi-select attach picker, in jsdom with a real createDocumentModal.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
for (const k of ['document', 'window', 'Event', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
after(() => window.close());
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const afterDebounce = () => new Promise((r) => setTimeout(r, 250));

const fetchCalls = [];
globalThis.fetch = async (...a) => { fetchCalls.push(a); throw new Error('picker must never fetch'); };

const { openAttachPicker } = await import('../ui/public/requirements-attach/picker.mjs');
const { createAttachStore } = await import('../ui/public/requirements-attach/store.mjs');

const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
const feat = (seq, extra = {}) => ({ seq, id: `F-${seq}`, title: `Feature ${seq}`, criteriaCount: 3, ready: true, startable: true, label: null, ...extra });
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

let searchCalls;
beforeEach(() => { document.body.replaceChildren(); fetchCalls.length = 0; searchCalls = []; });

async function open({ features = [feat(1), feat(2), feat(3)], scope = SCOPE, store = createAttachStore({ storage: memStorage(), key: 'k' }), onProject = () => {}, projects = [] } = {}) {
  const searchFn = async (args) => { searchCalls.push(args); return { features }; };
  const done = openAttachPicker({ store, scope, searchFn, onProject, projects, doc: document });
  await settle();
  return { store, done };
}
const q = (sel) => document.querySelector(sel);
const rows = () => [...document.querySelectorAll('[data-ui="attach-pick-row"]')];
const boxes = () => [...document.querySelectorAll('input[type="checkbox"]')];
const btn = () => q('[data-ui="attach-pick-attach"]');
const check = (i) => { const b = boxes()[i]; b.checked = !b.checked; b.dispatchEvent(new window.Event('change', { bubbles: true })); };

test('checkboxes and "Attach N" count; attach adds to the store and resolves attached:true', async () => {
  const { store, done } = await open();
  assert.equal(boxes().length, 3);
  assert.match(btn().textContent, /Attach 0/);
  assert.equal(btn().disabled, true);
  check(0); check(2);
  assert.equal(btn().textContent, 'Attach 2');
  assert.equal(btn().disabled, false);
  btn().click();
  assert.deepEqual(await done, { attached: true });
  assert.deepEqual(store.get().items.map((i) => i.seq), [1, 3]);
  assert.equal(q('.req-dlg-wrap'), null);
});

test('search passes scope and the already-attached seqs as exclude, and re-queries on input', async () => {
  const store = createAttachStore({ storage: memStorage(), key: 'k' });
  store.add([feat(7)]);
  await open({ store });
  assert.deepEqual(searchCalls[0], { scopeType: 'project', scopeKey: 'shop-1', q: '', exclude: [7] });
  const input = q('input[type="search"]');
  input.value = 'cart';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await afterDebounce();
  assert.equal(searchCalls.at(-1).q, 'cart');
});

test('not Ready disabled: the row shows the label and cannot be checked', async () => {
  await open({ features: [feat(1), feat(2, { startable: false, label: 'Not Ready yet', ready: false })] });
  assert.equal(boxes()[1].disabled, true);
  assert.match(rows()[1].textContent, /Not Ready yet/);
  assert.equal(boxes()[0].disabled, false);
  assert.match(rows()[0].textContent, /Feature 1/);
});

test('not Ready without a label falls back to "Not Ready yet"', async () => {
  await open({ features: [feat(3, { startable: false, label: null, ready: false })] });
  assert.equal(boxes()[0].disabled, true);
  assert.match(rows()[0].textContent, /Not Ready yet/);
});

test('limit: more than 10 shows the message and blocks the button', async () => {
  const many = Array.from({ length: 11 }, (_, i) => feat(i + 1));
  const { store } = await open({ features: many });
  for (let i = 0; i < 10; i++) check(i);
  assert.equal(q('[data-ui="attach-pick-limit"]').hidden, true);
  assert.equal(btn().disabled, false);
  check(10);
  assert.equal(q('[data-ui="attach-pick-limit"]').hidden, false);
  assert.match(q('[data-ui="attach-pick-limit"]').textContent, /You can attach up to 10 features\./);
  assert.equal(btn().disabled, true);
  assert.equal(store.get().items.length, 0);
});

test('limit counts what is already attached', async () => {
  const store = createAttachStore({ storage: memStorage(), key: 'k' });
  store.add(Array.from({ length: 9 }, (_, i) => feat(100 + i)));
  await open({ store });
  check(0); check(1);
  assert.match(q('[data-ui="attach-pick-limit"]').textContent, /up to 10/);
  assert.equal(btn().disabled, true);
});

test('inline project: unset scope shows a select inside the dialog; choosing calls onProject and searches', async () => {
  let scope = null;
  const picked = [];
  const store = createAttachStore({ storage: memStorage(), key: 'k' });
  const searchFn = async (args) => { searchCalls.push(args); return { features: [feat(1)] }; };
  openAttachPicker({
    store, scope: () => scope, searchFn, doc: document,
    projects: [{ key: 'a', name: 'Alpha' }, { key: 'b', name: 'Beta' }],
    onProject: (key) => { picked.push(key); scope = { scopeType: 'project', scopeKey: key }; },
  });
  await settle();
  const sel = q('select[data-ui="attach-pick-project"]');
  assert.ok(sel);
  assert.ok(q('.req-dlg-wrap').contains(sel));
  assert.equal(searchCalls.length, 0);
  assert.equal(boxes().length, 0);
  sel.value = 'b';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(picked, ['b']);
  assert.equal(searchCalls.at(-1).scopeKey, 'b');
  assert.equal(boxes().length, 1);
});

test('set scope: no project select is shown', async () => {
  await open();
  assert.equal(q('select[data-ui="attach-pick-project"]'), null);
});

test('cancel and Escape resolve attached:false and add nothing', async () => {
  let r = await open();
  check(0);
  q('[data-ui="attach-pick-cancel"]').click();
  assert.deepEqual(await r.done, { attached: false });
  assert.equal(r.store.get().items.length, 0);

  r = await open();
  document.querySelector('.req-dlg-wrap').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual(await r.done, { attached: false });
});

test('a failed search shows a note instead of throwing', async () => {
  const store = createAttachStore({ storage: memStorage(), key: 'k' });
  openAttachPicker({ store, scope: SCOPE, searchFn: async () => { throw new Error('boom'); }, onProject() {}, doc: document });
  await settle();
  assert.match(q('[data-ui="attach-pick-note"]').textContent, /could not be loaded/);
});

test('no POST: open, search and attach never call fetch', async () => {
  await open();
  const input = q('input[type="search"]');
  input.value = 'x';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await afterDebounce();
  check(0);
  btn().click();
  await settle();
  assert.equal(fetchCalls.length, 0);
});
