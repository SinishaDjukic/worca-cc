// test/extension-pair-prompt.test.mjs — the browser-extension pair prompt in app.js (docs/browser-extension.md):
// pairing requests from the server (WS `hello.extensionPairs`, `extension-pair-request`) run through ONE queue on
// the shared confirm modal, Cancel is focused, a confirm opened over the prompt never counts as its answer, and a
// request resolved elsewhere (`extension-pairings-changed`) closes the prompt without answering it.
//
// The 250 ms "modal free" poll and the prompt's watch timer keep the process alive while a confirm is open, so every
// test closes its modals. Run under `timeout 60` while red.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';

const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');

const PAIRED = { id: 'ext_1', name: 'Worca for Chrome', browser: 'chrome', origin: 'chrome-extension://abcdefghijklmnop', createdAt: '2026-10-13T10:00:00Z', lastUsedAt: null };
const later = () => Date.now() + 120_000;
const REQ_A = () => ({ requestId: 'pr_a', name: 'Worca for Chrome', browser: 'chrome', origin: 'chrome-extension://aaaaaaaaaaaaaaaa', code: '482913', expiresAt: later() });
const REQ_B = () => ({ requestId: 'pr_b', name: 'Worca for Firefox', browser: 'firefox', origin: 'moz-extension://bbbbbbbbbbbbbbbb', code: '105377', expiresAt: later() });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 2000) {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - t0 > ms) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

async function boot({ approve = { status: 200, body: {} }, framed = false } = {}) {
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  const { window } = dom;
  // jsdom's `top` is unforgeable; `self` is replaceable, so a framed shell is `self !== top`.
  if (framed) window.self = {};
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const calls = [];
  const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
  window.fetch = (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method });
    if (u.includes('/api/extension/pair/') && method === 'POST') return u.endsWith('/approve') ? reply(approve.status, approve.body) : reply(200, {});
    if (u.includes('/api/extension/pairings/') && method === 'DELETE') return reply(200, {});
    if (u.includes('/api/extension/pairings')) return reply(200, { remoteMode: false, paired: [PAIRED], pending: [] });
    if (u.includes('/api/counts')) return reply(200, { schedules: { scheduled: 0, missed: 0, recurring: 0, unread: 0 } });
    if (u.includes('/api/projects')) return reply(200, { projects: [] });
    if (u.includes('/api/settings')) return reply(200, { root: '/tmp/acme', default: '/tmp/acme' });
    return reply(200, { config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await sleep(0);
  const doc = window.document;
  const recv = (obj) => wsBox.ws.dispatch('message', { data: JSON.stringify(obj) });
  const modal = () => doc.getElementById('confirm-modal');
  const isOpen = () => !modal().classList.contains('hidden');
  const title = () => doc.getElementById('confirm-title').textContent;
  const message = () => doc.getElementById('confirm-message').textContent;
  const strong = () => doc.querySelector('#confirm-message strong')?.textContent;
  const ok = () => doc.getElementById('confirm-ok').click();
  const cancel = () => doc.getElementById('confirm-cancel').click();
  const pairPosts = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/api/extension/pair/')).map((c) => c.url.replace(/^.*\/api\/extension\/pair\//, ''));
  const deletes = () => calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
  const pairOpen = (code) => isOpen() && title() === 'Connect a browser extension?' && strong() === code;
  // confirmModal is module-private: open "another confirm" the way a person does, from the Settings card's Revoke.
  const openRevoke = async () => {
    if (!doc.querySelector('#extensionPairingsHost [data-revoke]')) {
      window.location.hash = 'settings';
      window.dispatchEvent(new window.Event('hashchange'));
      await until(() => doc.querySelector('#extensionPairingsHost [data-revoke]'), 'the Revoke button');
    }
    doc.querySelector('#extensionPairingsHost [data-revoke]').click();
    await until(() => isOpen() && title() === 'Revoke browser extension', 'the Revoke confirm');
  };
  return { window, doc, calls, recv, isOpen, title, message, strong, ok, cancel, pairPosts, deletes, pairOpen, openRevoke };
}

test('1-3: a hello with two requests opens ONE prompt at a time, Cancel focused; OK approves the first, Escape denies the second', async () => {
  const t = await boot();
  t.recv({ type: 'hello', runs: [], extensionPairs: [REQ_A(), REQ_B()] });
  await until(() => t.pairOpen('482 913'), 'the first pair prompt');
  assert.match(t.message(), /Extension id: chrome-extension:\/\/aaaaaaaaaaaaaaaa/);
  assert.match(t.message(), /Worca for Chrome \(Chrome\)/);
  assert.equal(t.doc.activeElement, t.doc.getElementById('confirm-cancel'), 'deny is the default');
  await sleep(30);
  assert.equal(t.strong(), '482 913', 'the second request did not overwrite the open prompt');

  t.ok();
  await until(() => t.pairOpen('105 377'), 'the second pair prompt');
  assert.deepEqual(t.pairPosts(), ['pr_a/approve'], 'exactly one approve, for the first request');
  assert.match(t.message(), /Extension id: moz-extension:\/\/bbbbbbbbbbbbbbbb/);

  t.doc.dispatchEvent(new t.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await until(() => t.pairPosts().length === 2, 'the deny POST');
  assert.deepEqual(t.pairPosts(), ['pr_a/approve', 'pr_b/deny']);
  await sleep(30);
  assert.equal(t.isOpen(), false);
});

test('4: a pair request arriving while another confirm is open waits; that confirm keeps its text and its OK resolves only it', async () => {
  const t = await boot();
  await t.openRevoke();
  const before = t.message();
  t.recv({ type: 'extension-pair-request', request: REQ_A() });
  await sleep(300);
  assert.equal(t.title(), 'Revoke browser extension');
  assert.equal(t.message(), before);
  t.ok();
  await until(() => t.deletes().length === 1, 'the revoke DELETE');
  assert.match(t.deletes()[0], /\/api\/extension\/pairings\/ext_1$/);
  await until(() => t.pairOpen('482 913'), 'the pair prompt after the confirm closed');
  assert.deepEqual(t.pairPosts(), [], 'the Revoke OK approved nothing');
  t.cancel();
  await until(() => t.pairPosts().length === 1, 'the deny POST');
  assert.deepEqual(t.pairPosts(), ['pr_a/deny']);
});

test('5: a 403 answer to approve raises an error toast carrying the server text', async () => {
  const t = await boot({ approve: { status: 403, body: { error: 'An agent cannot approve a browser extension' } } });
  t.recv({ type: 'extension-pair-request', request: REQ_A() });
  await until(() => t.pairOpen('482 913'), 'the pair prompt');
  t.ok();
  await until(() => lastToast(t.doc), 'the error toast');
  const toast = lastToast(t.doc);
  assert.equal(toast.tone, 'err');
  assert.equal(toast.title, 'The extension was not approved');
  assert.equal(toast.detail, 'An agent cannot approve a browser extension');
});

test('6: of two queued requests from the same origin only the newer one is shown', async () => {
  const t = await boot();
  const older = REQ_A();
  const newer = { ...REQ_A(), requestId: 'pr_a2', code: '777001' };
  t.recv({ type: 'hello', runs: [], extensionPairs: [older, newer] });
  await until(() => t.isOpen(), 'a pair prompt');
  assert.equal(t.strong(), '777 001');
  t.cancel();
  await until(() => t.pairPosts().length === 1, 'the deny POST');
  await sleep(50);
  assert.equal(t.isOpen(), false, 'the replaced request never opens');
  assert.deepEqual(t.pairPosts(), ['pr_a2/deny']);
});

test('7: a confirm opened OVER the pair prompt answers only itself; the prompt asks again and Cancel denies', async () => {
  const t = await boot();
  t.recv({ type: 'extension-pair-request', request: REQ_A() });
  await until(() => t.pairOpen('482 913'), 'the pair prompt');
  await t.openRevoke();
  t.ok();
  await until(() => t.deletes().length === 1, 'the revoke DELETE');
  await until(() => t.pairOpen('482 913'), 'the pair prompt again');
  assert.deepEqual(t.pairPosts(), [], 'the covering OK is not the answer to the prompt');
  t.cancel();
  await until(() => t.pairPosts().length === 1, 'the deny POST');
  assert.deepEqual(t.pairPosts(), ['pr_a/deny']);
});

test('8: extension-pairings-changed for the open request closes the prompt without answering', async () => {
  const t = await boot();
  t.recv({ type: 'extension-pair-request', request: REQ_A() });
  await until(() => t.pairOpen('482 913'), 'the pair prompt');
  t.recv({ type: 'extension-pairings-changed', requestId: 'pr_a' });
  await until(() => !t.isOpen(), 'the prompt to close');
  await sleep(300);
  assert.equal(t.isOpen(), false, 'it does not ask again');
  assert.deepEqual(t.pairPosts(), []);
});

test('9: extension-pairings-changed while a confirm covers the prompt leaves that confirm alone', async () => {
  const t = await boot();
  t.recv({ type: 'extension-pair-request', request: REQ_A() });
  await until(() => t.pairOpen('482 913'), 'the pair prompt');
  await t.openRevoke();
  t.recv({ type: 'extension-pairings-changed', requestId: 'pr_a' });
  await sleep(50);
  assert.equal(t.isOpen(), true, 'the Revoke confirm was not cancelled');
  assert.equal(t.title(), 'Revoke browser extension');
  t.ok();
  await until(() => t.deletes().length === 1, 'the revoke DELETE');
  await sleep(400);
  assert.equal(t.isOpen(), false, 'the resolved request does not ask again');
  assert.deepEqual(t.pairPosts(), []);
});

test('10: the shared modal hidden under the open prompt (a covering fields dialog submitted with Enter) re-asks without answering', async () => {
  const t = await boot();
  t.recv({ type: 'extension-pair-request', request: REQ_A() });
  await until(() => t.pairOpen('482 913'), 'the pair prompt');
  await t.openRevoke();   // the cover: modalGen moves, as a promptModal's opening does
  t.doc.getElementById('confirm-modal').classList.add('hidden');   // what a fields dialog's Enter leaves behind
  await until(() => t.pairOpen('482 913'), 'the pair prompt again', 1000);
  assert.deepEqual(t.pairPosts(), []);
  assert.deepEqual(t.deletes(), [], 'the hidden cover was resolved as Cancel');
  t.cancel();
  await until(() => t.pairPosts().length === 1, 'the deny POST');
  assert.deepEqual(t.pairPosts(), ['pr_a/deny']);
});

test('11: a framed shell never opens the pair prompt and answers nothing (no clickjacked Approve)', async () => {
  const t = await boot({ framed: true });
  t.recv({ type: 'hello', runs: [], extensionPairs: [REQ_A()] });
  t.recv({ type: 'extension-pair-request', request: REQ_B() });
  await sleep(400);
  assert.equal(t.isOpen(), false);
  assert.deepEqual(t.pairPosts(), []);
});
