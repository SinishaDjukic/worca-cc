// test/ui-whats-new.test.mjs — runs redesign §5a.9: a one-time "What's new" note on the Runs list, dismissible and
// remembered per browser. The app boot follows test/ui-runs-view.test.mjs's boot() (no shared harness, by convention).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WHATS_NEW, WHATS_NEW_KEY, paintWhatsNew } from '../ui/public/whats-new.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const page = () => trackDom(new JSDOM('<!doctype html><body><h2 class="runs-head-title">Runs</h2><div id="runs-whats-new"></div></body>')).window.document;

test('shows once: Got it hides it, stores the key, focuses the Runs heading', () => {
  const doc = page(); const storage = mem(); const host = doc.getElementById('runs-whats-new');
  paintWhatsNew(host, { storage, focusAfter: doc.querySelector('.runs-head-title') });
  const note = host.querySelector('aside.whats-new');
  assert.equal(note.getAttribute('aria-label'), "What's new");
  assert.equal(note.querySelector('.whats-new-title').textContent, WHATS_NEW.title);
  assert.equal(note.querySelector('.whats-new-body').textContent, WHATS_NEW.body);
  assert.match(note.querySelector('button.whats-new-ok').className, /\bbtn\b.*\bbtn-sm\b.*\bbtn-secondary\b/);
  paintWhatsNew(host, { storage });
  assert.equal(host.querySelectorAll('aside').length, 1, 'a repaint never adds a second note');
  note.querySelector('button.whats-new-ok').click();
  assert.equal(host.querySelector('aside'), null);
  assert.equal(storage.getItem(WHATS_NEW_KEY), '1');
  assert.equal(doc.activeElement, doc.querySelector('.runs-head-title'));
  assert.equal(doc.querySelector('.runs-head-title').getAttribute('tabindex'), '-1');
  paintWhatsNew(host, { storage });
  assert.equal(host.querySelector('aside'), null, 'stays dismissed');
});

test('a throwing storage still shows the note and never throws', () => {
  const doc = page(); const host = doc.getElementById('runs-whats-new');
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  paintWhatsNew(host, { storage: bad });
  assert.ok(host.querySelector('aside.whats-new'));
  assert.doesNotThrow(() => host.querySelector('button.whats-new-ok').click());
  assert.equal(host.querySelector('aside'), null);
});

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
async function boot(saved, { blocked = false } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/#runs' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (u) => {
    const s = String(u);
    if (s.endsWith('/api/run-groups')) return ok({ groups: [] });
    if (s.includes('/api/projects')) return ok({ projects: [] });
    if (s.endsWith('/api/history')) return ok({ pipelines: [] });
    if (s.endsWith('/api/schedules')) return ok({ schedules: [], tickets: [], counts: {}, chains: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  // One browser across both boots: carry the saved keys over, as a reload keeps localStorage.
  window.localStorage.clear();
  for (const [k, v] of saved) window.localStorage.setItem(k, v);
  if (blocked) {
    // Chrome with site data blocked: reading `localStorage` itself throws.
    const denied = { configurable: true, get() { throw new window.DOMException('Access is denied for this document.', 'SecurityError'); } };
    Object.defineProperty(window, 'localStorage', denied);
    Object.defineProperty(globalThis, 'localStorage', denied);
  }
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  lastWs._l.open?.forEach((fn) => fn());
  lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'hello', runs: [] }) }));
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  const keys = () => new Map(Object.keys(window.localStorage).map((k) => [k, window.localStorage.getItem(k)]));
  return { window, doc: window.document, keys };
}

test('app: with site data blocked the app still boots, shows the list and the note, and Got it hides it', async () => {
  const errors = [];
  const onErr = (e) => errors.push(e);
  process.on('uncaughtException', onErr);
  process.on('unhandledRejection', onErr);
  try {
    const { doc } = await boot(new Map(), { blocked: true });
    const note = doc.querySelector('#runs-whats-new aside.whats-new');
    assert.ok(note, 'the note shows');
    assert.ok(doc.querySelector('#runs-list').textContent.trim(), 'the list paints its state');
    note.querySelector('.whats-new-ok').click();
    assert.equal(doc.querySelector('#runs-whats-new aside'), null);
    assert.deepEqual(errors.map(String), []);
  } finally {
    process.off('uncaughtException', onErr);
    process.off('unhandledRejection', onErr);
  }
});

test('app: the note shows on #runs, Got it, and after a reload it is gone', async () => {
  const a = await boot(new Map());
  const note = a.doc.querySelector('#runs-whats-new aside.whats-new');
  assert.ok(note, 'first visit: the note shows above the list');
  assert.equal(a.doc.getElementById('runs-whats-new').nextElementSibling.id, 'runs-list');
  note.querySelector('.whats-new-ok').click();
  assert.equal(a.doc.querySelector('#runs-whats-new aside'), null);
  assert.equal(a.doc.activeElement, a.doc.querySelector('.runs-head-title'), 'focus moves to the Runs heading');
  const saved = a.keys();
  assert.equal(saved.get(WHATS_NEW_KEY), '1');
  const b = await boot(saved);
  assert.equal(b.doc.querySelector('#runs-whats-new aside.whats-new'), null, 'stays dismissed after a reload');
});
