// test/ui-design-route.test.mjs — app.js wiring of the Design page: flag gate, nav row, live count, parts.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { createDesignLive } from '../ui/public/design/view.mjs';

const trackDom = useDomRelease(afterEach);
// boot() points globalThis.fetch at the test window's fake; put Node's own back after each test.
const realFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
afterEach(() => {
  if (realFetch) Object.defineProperty(globalThis, 'fetch', realFetch);
  else delete globalThis.fetch;
});
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public');
const html = readIndexHtml();
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const hidden = (doc, view) => doc.querySelector(`[data-view="${view}"]`).classList.contains('hidden');

// A local copy of test/requirements-app.test.mjs's boot: GET /api/design answers [], and `extra` rides the hello frame.
// `answer(url, init)` answers a request before the defaults (a reply, or nothing); `sent` holds every socket send and
// `calls` every request. `raf` gives the window animation frames on its own timers (the stage paints per frame).
async function boot(flags, extra = {}, { answer = null, raf = false } = {}) {
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  if (raf) {
    window.requestAnimationFrame = (fn) => window.setTimeout(() => fn(window.performance.now()), 0);
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  }
  let ws = null;
  const sent = [];
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; ws = this; }
    send(d) { sent.push(JSON.parse(d)); } close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  const urls = [];
  const calls = [];
  window.fetch = (u, init = {}) => {
    urls.push(String(u));
    calls.push({ url: String(u), method: String(init.method ?? 'GET').toUpperCase() });
    const own = answer?.(String(u), init);
    if (own) return Promise.resolve(own);
    const body = String(u).includes('/api/requirements') ? { features: [] }
      : String(u).includes('/api/design') ? []
        : { config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: [], pipelines: 0, workspaces: 0 };
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
  recv({ type: 'hello', bootId: 'b', runs: [], flags, ...extra });
  await settle();
  return { window, doc: window.document, recv, urls, calls, sent };
}

test('flag off: a deep link lands on Chat', async () => {
  const { window, doc } = await boot({ design: false });
  window.location.hash = 'design/d_000000000001';
  await settle();
  assert.equal(hidden(doc, 'design'), true);
  assert.equal(hidden(doc, 'chat'), false);
});
test('flag on: the page opens full-bleed, titled, with no Ask column', async () => {
  const { window, doc } = await boot({ design: true });
  window.location.hash = 'design';
  await settle();
  assert.equal(hidden(doc, 'design'), false);
  assert.ok(doc.body.classList.contains('view-design'));
  assert.equal(doc.getElementById('topnav-title').textContent, 'Design');
  assert.equal(doc.getElementById('topnav-ask').hidden, true);
  window.location.hash = 'runs';
  await settle();
  assert.equal(doc.body.classList.contains('view-design'), false);
  assert.equal(doc.getElementById('topnav-ask').hidden, false);
});
test('turning the flag off while the page is open leaves it for Chat', async () => {
  const { window, doc, recv } = await boot({ design: true });
  window.location.hash = 'design';
  await settle();
  assert.equal(hidden(doc, 'design'), false);
  recv({ type: 'flags', flags: { design: false } });
  await settle();
  assert.equal(hidden(doc, 'design'), true);
  assert.equal(hidden(doc, 'chat'), false);
});
test('Design sits directly under Chat, Simple level, behind its flag, with a hidden grey count', () => {
  const doc = new JSDOM(readIndexHtml()).window.document;
  const row = doc.querySelector('.nav > button[data-nav="design"]');
  assert.equal(row.previousElementSibling.dataset.nav, 'chat');
  assert.equal(row.nextElementSibling.dataset.nav, 'runs');
  assert.deepEqual([row.dataset.minLevel, row.dataset.flag, row.hasAttribute('data-flag-chip')], ['simple', 'design', true]);
  const n = row.querySelector('#nav-design-count');
  assert.deepEqual([n.className, n.hidden], ['nav-count n-grey', true]);
  assert.equal(doc.querySelectorAll('section.view[data-view="design"] #design-host').length, 1);
});
test('the grey count: hello sets it, design-build moves it, zero hides it, the name says it', async () => {
  const { doc, recv } = await boot({ design: true }, { design: [{ designId: 'd_a', buildId: 'b_a', title: 'A', status: 'building', waiting: 0 }] });
  const n = doc.getElementById('nav-design-count');
  const row = doc.querySelector('.nav button[data-nav="design"]');
  assert.deepEqual([n.textContent, n.hidden, row.getAttribute('aria-label')], ['1', false, 'Design: 1 live']);
  recv({ type: 'design-build', designId: 'd_b', buildId: 'b_b', seq: 1, ts: 1, status: 'planning', stats: {} });
  assert.equal(n.textContent, '2');
  recv({ type: 'design-build', designId: 'd_a', buildId: 'b_a', seq: 2, ts: 1, status: 'done', stats: {} });
  recv({ type: 'design-build', designId: 'd_b', buildId: 'b_b', seq: 2, ts: 1, status: 'paused', stats: {} });
  assert.deepEqual([n.hidden, row.getAttribute('aria-label')], [true, null]);
});
test('a design-delta frame (no status) leaves the count unchanged', async () => {
  const { doc, recv } = await boot({ design: true }, { design: [{ designId: 'd_a', buildId: 'b_a', title: 'A', status: 'building', waiting: 0 }] });
  const n = doc.getElementById('nav-design-count');
  recv({ type: 'design-delta', designId: 'd_a', buildId: 'b_a', seq: 3, ts: 1, agentId: 'a1', path: 'sections/hero.html', sectionId: 'hero', part: 'html', rev: 1, splice: { at: 0, del: 0, text: '<h1>' } });
  assert.deepEqual([n.textContent, n.hidden], ['1', false]);
});
test('createDesignLive counts planning, building and integrating only', () => {
  const live = createDesignLive();
  live.hello(['planning', 'building', 'integrating', 'paused'].map((status, i) => ({ designId: `d${i}`, status })));
  assert.equal(live.count(), 3);
  live.hello([]);
  assert.equal(live.count(), 0);
});
test('parts: design.css sits before the last-in-file card nesting; design has no dirs entry', () => {
  const parts = JSON.parse(readFileSync(new URL('../ui/public/parts.json', import.meta.url), 'utf8'));
  assert.equal(parts.css.indexOf('design/design.css'), parts.css.indexOf('chat/card-nesting.css') - 1);
  assert.equal(parts.css.at(-1), 'chat/card-nesting.css');
  assert.equal(parts.html[parts.html.indexOf('chat/chat.html') + 1], 'design/design.html');
  assert.equal(parts.dirs.includes('design'), false);
});

// In the real app (review M8): app.js's Design wiring lines (show(param), leave(), the mount's fetch, sendWs and route,
// and hello's { rebooted }) are what this row pins; test/ui-design-view.test.mjs injects every one of them.
const APP_DID = 'd_0000000000a1';
const APP_BID = 'b_0000000000a1';
function designAnswer(url, init = {}) {
  const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const method = String(init.method ?? 'GET').toUpperCase();
  if (method === 'GET' && url === '/api/design') {
    return reply([{ id: APP_DID, title: 'Apsida landing page', kind: 'web', status: 'building', updatedAt: '2026-11-05T10:00:00Z', costUsd: 0, thumb: null }]);
  }
  if (method === 'GET' && url === `/api/design/${APP_DID}`) {
    return reply({
      design: { id: APP_DID, kind: 'web', title: 'Apsida landing page', version: 0, threadId: null },
      plan: null, sections: [], versions: [],
      build: { id: APP_BID, designId: APP_DID, round: 1, kind: 'first', status: 'building', reason: null, agentsTotal: 1, layers: 0, costUsd: 0, costKnown: true, startedAt: '2026-11-05T10:00:00Z', endedAt: null },
    });
  }
  if (method === 'POST' && url === `/api/design/${APP_DID}/preview-token`) {
    return reply({ base: '/design-preview/TOK', expiresAt: Date.now() + 43200000 });
  }
  return null;
}
test('in the real app: the library row opens the studio, which subscribes; a new bootId re-mints; leaving empties the host', async () => {
  const { window, doc, recv, calls, sent } = await boot({ design: true }, {}, { answer: designAnswer, raf: true });
  const errors = [];
  window.addEventListener('error', (e) => { errors.push(String(e.error?.stack ?? e.message)); });
  const host = doc.getElementById('design-host');
  window.location.hash = 'design';
  await settle();
  const row = host.querySelector('.dz-lib .row-btn');
  assert.ok(row, 'the mount\'s fetch reached GET /api/design and the library painted its row');
  assert.match(row.textContent, /Apsida landing page/);
  row.click();
  await settle();
  assert.equal(window.location.hash, `#design/${APP_DID}`, 'the mount\'s route moves the hash');
  assert.ok(host.querySelector('.dz-studio > .dz-chat + .dz-stage'), 'showView hands the id to show(param)');
  assert.ok(sent.some((m) => m.type === 'subscribe' && m.designBuildId === APP_BID), 'the open build subscribes over the real socket');
  const mints = () => calls.filter((c) => c.method === 'POST' && c.url === `/api/design/${APP_DID}/preview-token`).length;
  const before = mints();
  assert.ok(before >= 1, 'the build doc minted a preview token');
  recv({ type: 'hello', bootId: 'b2', runs: [], flags: { design: true } });
  await settle();
  assert.equal(mints(), before + 1, 'a hello with a new bootId is a rebooted server: the frame re-mints');
  window.location.hash = 'runs';
  await settle();
  assert.equal(host.children.length, 0, 'leaving Design empties its host');
  assert.deepEqual(errors, [], 'no listener threw');
});
