// test/ui-running-nav.test.mjs
// Regression: after starting a run (direct showView call), "New pipeline" nav must remain clickable.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }];

async function boot() {
  // Start with #new in the URL — this is the precondition for the dead-click bug.
  // An empty hash would mean the first nav click changes '' -> '#new', which IS a
  // real hashchange and avoids the bug. Real users navigate to #new before submitting.
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/#new' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.endsWith('/api/run') && opts && opts.method === 'POST')
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'run-1' }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return window;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const hidden = (doc, view) => doc.querySelector(`[data-view="${view}"]`).classList.contains('hidden');

async function startRun(window) {
  const doc = window.document;
  const psel = doc.querySelector('#projectSelect');
  assert.ok(psel.options.length > 0, 'projects must be loaded before startRun');
  psel.value = '/a/svc-iam';
  psel.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('#prompt').value = 'do a thing';
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
}

test('starting a run opens its own page with the hash synced, and New run in the top bar then reopens the New view (not a dead click)', async () => {
  const window = await boot();
  const doc = window.document;
  await startRun(window);
  await checkRows([
    { name: 'starting a run opens that run\'s own page and syncs the hash', run: async () => {
      assert.equal(hidden(window.document, 'runs'), false, 'Runs view shown after start');
      // Straight onto the new run's glance (#running/<id>), not the list.
      assert.match(window.location.hash, /^#running\/[^/]+$/, 'hash follows the view (invariant restored)');
    } },
    { name: 'after starting a run, clicking "New run" reopens the New view (not a dead click)', run: async () => {
      assert.equal(hidden(doc, 'runs'), false, 'precondition: on Runs');

      // The reported gesture: click "New run" in the top bar.
      doc.getElementById('topnav-new')
         .dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
      await tick();

      assert.equal(hidden(doc, 'new'), false, 'New view shown after clicking New run');
      assert.equal(hidden(doc, 'runs'), true, 'Runs view hidden');
      assert.equal(window.location.hash, '#new', 'hash now matches the New view');
    } },
  ]);
});
