// test/requirements-attach-entries.test.mjs — the two attach mount points (New run, Chat), in jsdom with fake deps.
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

const { mountNewRunAttach, mountChatAttach, jsonFetcher, newRunScope } = await import('../ui/public/requirements-attach/entries.mjs');
const { createAttachStore } = await import('../ui/public/requirements-attach/store.mjs');

const memStorage = (seed = {}) => { const m = new Map(Object.entries(seed)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const feat = (seq) => ({ seq, id: `F-${seq}`, title: `Feature ${seq}`, criteriaCount: 2, startable: true });

let calls;
function makeFlag(initial) {
  let on = initial;
  const subs = new Set();
  return {
    flagOn: () => on,
    onFlagChange: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    set(v) { on = v; for (const fn of [...subs]) fn(v); },
    subs,
  };
}
function makeFetch(features = [feat(1), feat(2)]) {
  return async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.startsWith('/api/requirements/search')) return { features };
    if (url === '/api/requirements/attach/resolve') return { items: [] };
    if (url === '/api/projects') return { projects: [{ key: 'shop', name: 'Shop' }] };
    throw new Error(`unexpected ${url}`);
  };
}
const q = (sel) => document.querySelector(sel);
const mkButton = () => { const b = document.createElement('button'); document.body.append(b); return b; };

beforeEach(() => { document.body.replaceChildren(); calls = []; });

test('newRunScope and jsonFetcher are re-exported helpers', async () => {
  assert.deepEqual(newRunScope({ runTarget: 'project', projectKey: 'p', projectPath: '/x' }), { scope: { scopeType: 'project', scopeKey: 'p' }, projectDir: '/x' });
  assert.deepEqual(newRunScope({}), { scope: null, projectDir: null });
  const fj = jsonFetcher(async (url, init) => ({ ok: true, json: async () => ({ url, body: init.body }) }));
  assert.deepEqual(await fj('/a', { method: 'POST', body: { x: 1 } }), { url: '/a', body: '{"x":1}' });
});

test('New run: button follows the flag live, with no click handler effect while off', async () => {
  const flag = makeFlag(false);
  const button = mkButton();
  const store = createAttachStore({ storage: memStorage(), key: 'nr' });
  const off = mountNewRunAttach({
    button, store, getTarget: () => ({ runTarget: 'project', projectKey: 'shop' }), setRunTarget() {}, projectSelect: null,
    doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(),
  });
  assert.equal(button.hidden, true);
  button.click();
  await settle();
  assert.equal(q('[data-ui="attach-pick-search"]'), null, 'no picker while the flag is off');
  assert.equal(calls.length, 0);
  flag.set(true);
  assert.equal(button.hidden, false);
  flag.set(false);
  assert.equal(button.hidden, true);
  off();
  assert.equal(flag.subs.size, 0);
});

test('New run: click opens the picker and the search call carries the target scope', async () => {
  const flag = makeFlag(true);
  const button = mkButton();
  const store = createAttachStore({ storage: memStorage(), key: 'nr' });
  mountNewRunAttach({
    button, store, getTarget: () => ({ runTarget: 'workspace', workspaceId: 'ws-1', workspacePaths: ['/a'] }), setRunTarget() {}, projectSelect: null,
    doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(),
  });
  assert.equal(button.textContent, 'Pull from Requirements');
  button.click();
  await settle();
  const search = calls.find((c) => c.url.startsWith('/api/requirements/search'));
  assert.ok(search, 'search called');
  const u = new URL(search.url, 'http://x');
  assert.equal(u.searchParams.get('scopeType'), 'workspace');
  assert.equal(u.searchParams.get('scopeKey'), 'ws-1');
  assert.equal(u.searchParams.get('q'), '');
});

test('New run: attaching updates the label from the store', async () => {
  const flag = makeFlag(true);
  const button = mkButton();
  const store = createAttachStore({ storage: memStorage(), key: 'nr' });
  mountNewRunAttach({
    button, store, getTarget: () => ({ runTarget: 'project', projectKey: 'shop' }), setRunTarget() {}, projectSelect: null,
    doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(),
  });
  button.click();
  await settle();
  const box = document.querySelector('input[type="checkbox"]');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  q('[data-ui="attach-pick-attach"]').click();
  await settle();
  assert.equal(button.textContent, '1 feature');
  store.add([feat(7)]);
  assert.equal(button.textContent, '2 features');
});

test('New run: inline project pick sets the run target, the select value and fires change', async () => {
  const flag = makeFlag(true);
  const button = mkButton();
  const sel = document.createElement('select');
  sel.innerHTML = '<option value="">--</option><option value="shop">Shop</option>';
  document.body.append(sel);
  let changed = 0;
  sel.addEventListener('change', () => { changed++; });
  let target = { runTarget: 'project', projectKey: '' };
  const setRunTarget = (t) => { target = { ...target, runTarget: t }; };
  sel.addEventListener('change', () => { target = { ...target, projectKey: sel.value }; });
  const store = createAttachStore({ storage: memStorage(), key: 'nr' });
  mountNewRunAttach({
    button, store, getTarget: () => target, setRunTarget, projectSelect: sel,
    doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(),
  });
  button.click();
  await settle();
  const chooser = q('[data-ui="attach-pick-project"]');
  assert.ok(chooser, 'inline chooser shown with no scope');
  chooser.value = 'shop';
  chooser.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.equal(target.runTarget, 'project');
  assert.equal(sel.value, 'shop');
  assert.equal(changed, 1);
  assert.ok(calls.some((c) => c.url.includes('scopeKey=shop')), 'picker searches the chosen project');
});

test('mount restores the store and revalidates once, passing the scope', async () => {
  const flag = makeFlag(true);
  const seed = { nr: JSON.stringify({ items: [feat(3)], scope: {} }) };
  const store = createAttachStore({ storage: memStorage(seed), key: 'nr' });
  mountNewRunAttach({
    button: mkButton(), store, getTarget: () => ({ runTarget: 'project', projectKey: 'shop' }), setRunTarget() {}, projectSelect: null,
    doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(),
  });
  await settle();
  const resolves = calls.filter((c) => c.url === '/api/requirements/attach/resolve');
  assert.equal(resolves.length, 1);
  assert.deepEqual(resolves[0].opts.body, { seqs: [3], scopeType: 'project', scopeKey: 'shop' });
  assert.equal(resolves[0].opts.method, 'POST');
});

test('flag off at mount: items go unavailable locally with no network call', async () => {
  const flag = makeFlag(false);
  const seed = { nr: JSON.stringify({ items: [feat(3)], scope: {} }) };
  const store = createAttachStore({ storage: memStorage(seed), key: 'nr' });
  mountNewRunAttach({
    button: mkButton(), store, getTarget: () => ({}), setRunTarget() {}, projectSelect: null,
    doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(),
  });
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(store.get().items[0].status, 'unavailable');
});

test('Chat: scope from getScope reaches the search; project pick pins the chat', async () => {
  const flag = makeFlag(true);
  const button = mkButton();
  const store = createAttachStore({ storage: memStorage(), key: 'chat' });
  let scope = { pinned: true, projectKey: 'shop' };
  mountChatAttach({
    button, store, getScope: () => scope, setScope: (s) => { scope = s; },
    doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(),
  });
  button.click();
  await settle();
  const u = new URL(calls.find((c) => c.url.startsWith('/api/requirements/search')).url, 'http://x');
  assert.equal(u.searchParams.get('scopeType'), 'project');
  assert.equal(u.searchParams.get('scopeKey'), 'shop');
});

test('Chat: a paint hook replaces the words, on mount and on every store commit', () => {
  const painted = [];
  const store = createAttachStore({ storage: memStorage(), key: 'nr' });
  const button = mkButton();
  const flag = makeFlag(true);
  mountChatAttach({ button, store, getScope: () => ({ pinned: true, projectKey: 'shop' }), setScope() {}, doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(), paint: (b, n) => painted.push(n) });
  store.add([feat(7)]);
  assert.deepEqual(painted, [0, 1]);
  assert.equal(button.textContent, '');
});

test('Chat: unscoped chat shows the chooser and setScope receives the pinned project', async () => {
  const flag = makeFlag(true);
  const button = mkButton();
  const store = createAttachStore({ storage: memStorage(), key: 'chat' });
  let scope = { pinned: false, projectKey: null, workspaceId: null };
  const seen = [];
  mountChatAttach({
    button, store, getScope: () => scope, setScope: (s) => { seen.push(s); scope = s; },
    doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(),
  });
  button.click();
  await settle();
  const chooser = q('[data-ui="attach-pick-project"]');
  assert.ok(chooser);
  chooser.value = 'shop';
  chooser.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.deepEqual(seen, [{ pinned: true, projectKey: 'shop' }]);
  assert.ok(calls.some((c) => c.url.includes('scopeKey=shop')));
});

test('Chat: flag flip toggles the button; flag off ignores clicks', async () => {
  const flag = makeFlag(false);
  const button = mkButton();
  const store = createAttachStore({ storage: memStorage(), key: 'chat' });
  mountChatAttach({
    button, store, getScope: () => ({ pinned: true, projectKey: 'shop' }), setScope() {},
    doc: document, flagOn: flag.flagOn, onFlagChange: flag.onFlagChange, fetchJson: makeFetch(),
  });
  assert.equal(button.hidden, true);
  button.click();
  await settle();
  assert.equal(q('[data-ui="attach-pick-search"]'), null);
  flag.set(true);
  assert.equal(button.hidden, false);
});
