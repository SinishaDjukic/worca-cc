// test/requirements-app.test.mjs — app.js wiring of the Requirements page: flag gate, routing, frame relay.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
// boot() points globalThis.fetch at the test window's fake; put Node's own back after each test.
const realFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
afterEach(() => {
  if (realFetch) Object.defineProperty(globalThis, 'fetch', realFetch);
  else delete globalThis.fetch;
});
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
test('leaving the Requirements view tells it to release the Feature chat sheet (the page must not stay inert)', () => {
  const app = readFileSync(join(root, 'app.js'), 'utf8');
  assert.ok(app.replace(/\r?\n\s*/g, ' ').includes("if (name === 'requirements') void requirementsView.show(param); else requirementsView.leave();"));
});
const hidden = (doc, view) => doc.querySelector(`[data-view="${view}"]`).classList.contains('hidden');

async function boot(flags) {
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let ws = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; ws = this; }
    send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  const urls = [];
  window.fetch = (u) => {
    urls.push(String(u));
    const body = String(u).includes('/api/requirements') ? { features: [] } : { config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: [], pipelines: 0, workspaces: 0 };
    return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(join(root, 'app.js')).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  ws._l.open?.forEach((fn) => fn());
  const recv = (obj) => ws._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  recv({ type: 'hello', bootId: 'b', runs: [], flags });
  await settle();
  const reqCalls = () => urls.filter((u) => u.includes('/api/requirements')).length;
  return { window, doc: window.document, recv, reqCalls };
}

test('flag off: a deep link to the Requirements page lands on Chat', async () => {
  const { window, doc } = await boot({ requirements: false });
  window.location.hash = 'requirements/feature/1';
  await settle();
  assert.equal(hidden(doc, 'requirements'), true);
  assert.equal(hidden(doc, 'chat'), false);
});

test('flag on: #requirements shows the page and loads the list', async () => {
  const { window, doc, reqCalls } = await boot({ requirements: true });
  window.location.hash = 'requirements';
  await settle();
  assert.equal(hidden(doc, 'requirements'), false);
  assert.ok(reqCalls() > 0, 'fetched /api/requirements');
});

test('requirements-changed repaints only the open Requirements page', async () => {
  const { window, doc, recv, reqCalls } = await boot({ requirements: true });
  window.location.hash = 'runs';
  await settle();
  const before = reqCalls();
  recv({ type: 'requirements-changed', seq: 1 });
  await settle();
  assert.equal(reqCalls(), before, 'no fetch while another page is shown');
  window.location.hash = 'requirements';
  await settle();
  const open = reqCalls();
  recv({ type: 'requirements-changed', seq: 1 });
  await settle();
  assert.ok(reqCalls() > open, 'a fetch while the Requirements page is shown');
  assert.equal(hidden(doc, 'requirements'), false);
});

test('turning the flag off while the page is open leaves it for Chat', async () => {
  const { window, doc, recv } = await boot({ requirements: true });
  window.location.hash = 'requirements';
  await settle();
  assert.equal(hidden(doc, 'requirements'), false);
  recv({ type: 'flags', flags: { requirements: false } });
  await settle();
  assert.equal(hidden(doc, 'requirements'), true);
  assert.equal(hidden(doc, 'chat'), false);
});

test('a brief frame reaches the view with its key: the brief page of that scope repaints, another scope does not', async () => {
  const { window, recv } = await boot({ requirements: true });
  const urls = [];
  const was = window.fetch;
  window.fetch = (u, o) => { urls.push(String(u)); return was(u, o); };
  globalThis.fetch = window.fetch;
  window.location.hash = `requirements/brief/workspace/${encodeURIComponent('ws:1')}`;
  await settle();
  const page = '/api/requirements/brief/workspace/ws%3A1';
  const n = () => urls.filter((u) => u === page).length;
  const open = n();
  assert.ok(open > 0, 'the brief page fetched its scope');
  recv({ type: 'requirements-changed', brief: 'workspace:other' });
  await settle();
  assert.equal(n(), open, 'another scope: no fetch');
  recv({ type: 'requirements-changed', brief: 'workspace:ws:1' });
  await settle();
  assert.equal(n(), open + 1, 'its own scope: one fetch');
});
