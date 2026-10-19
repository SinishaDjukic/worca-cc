// test/ui-runs-states.test.mjs — runs redesign §5a.2: the Runs list says what is going on when there is nothing,
// while History loads, while the server is unreachable, when History fails to load and when an action fails.
// boot() / settle() / go() follow test/ui-runs-view.test.mjs (no shared harness, by convention).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { useAppTimers } from './helpers/app-timers.mjs';
import { OFFLINE_TEXT } from '../ui/public/connection-state.mjs';
import { UNREACHABLE_DETAIL } from '../ui/public/action-errors.mjs';

const trackDom = useDomRelease(afterEach);

const __dir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dir, '..', 'ui', 'public', 'index.html');
const appPath = join(__dir, '..', 'ui', 'public', 'app.js');
const PROJECT = '/tmp/proj';
const KEY = 'proj-0000abcd';
const HIST = [
  { id: 'aaaa0001', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Merged thing', status: 'done',
    startedAt: '2026-09-29T09:18:00Z', mtime: 3 },
  { id: 'aaaa0002', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Stopped thing', status: 'stopped',
    startedAt: '2026-09-29T08:00:00Z', mtime: 2 },
];
const windows = [];
afterEach(() => { while (windows.length) windows.pop().close(); });

async function settle(window, n = 4) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }
function go(window, hash) { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); }
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// `history(n)` answers the n-th GET /api/history (from 1) with a Response-like object or a Promise of one;
// `bulk(body)` answers POST /api/runs/bulk the same way. `calls.history` counts the History fetches.
async function boot({ url = 'http://localhost:4317/#runs', history = () => res(200, { pipelines: [] }), bulk = () => res(200, { ok: true, done: [], cancelled: [], skipped: [] }) } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
  const { window } = dom;
  windows.push(window);
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const calls = { history: 0 };
  const ok = (body) => Promise.resolve(res(200, body));
  window.fetch = (u, init = {}) => {
    const s = String(u);
    const method = (init.method || 'GET').toUpperCase();
    if (s.endsWith('/api/runs/bulk') && method === 'POST') return Promise.resolve().then(() => bulk(JSON.parse(init.body)));
    if (s.endsWith('/api/run-groups')) return ok({ groups: [] });
    if (s.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    if (s.includes('/api/history?archived=1')) return ok({ pipelines: [] });
    if (s.endsWith('/api/history')) { calls.history++; return Promise.resolve(history(calls.history)); }
    if (s.includes('/api/workspaces')) return ok({ workspaces: [] });
    if (s.endsWith('/api/schedules')) return ok({ schedules: [], tickets: [], counts: {}, chains: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.whatsNew.runsRedesign', '1');
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle(window);
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const drop = () => lastWs._l.close.forEach((fn) => fn({ code: 1006 }));
  return { window, doc: window.document, recv, drop, calls };
}
const notes = (doc) => [...doc.querySelectorAll('#runs-list .runs-note')].map((n) => n.textContent);

test('no runs: an empty History answer reads "No runs yet"', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [] });
  await settle(window);
  assert.deepEqual(notes(doc), ['No runs yet. Start one from New run.']);
});

test('loading: "Loading runs…" until History answers, then "No runs yet", with or without hello', async () => {
  let answer;
  const { window, doc, recv } = await boot({ history: () => new Promise((r) => { answer = r; }) });
  assert.deepEqual(notes(doc), ['Loading runs…']);
  assert.equal(doc.querySelector('#runs-list .runs-loading').textContent, 'Loading runs…');
  recv({ type: 'hello', runs: [] });
  await settle(window);
  assert.deepEqual(notes(doc), ['Loading runs…'], 'hello alone is not History');
  answer(res(200, { pipelines: [] }));
  await settle(window);
  assert.deepEqual(notes(doc), ['No runs yet. Start one from New run.']);

  let answer2;
  const b = await boot({ history: () => new Promise((r) => { answer2 = r; }) });
  assert.deepEqual(notes(b.doc), ['Loading runs…']);
  answer2(res(200, { pipelines: [] }));
  await settle(b.window);
  assert.deepEqual(notes(b.doc), ['No runs yet. Start one from New run.'], 'no hello needed');
});

test('server unreachable: the banner after 3 s, the offline note when empty, one History re-fetch on hello', async (t) => {
  const { window, doc, recv, drop, calls } = await boot();
  recv({ type: 'hello', runs: [] });
  await settle(window);
  const banner = doc.getElementById('conn-banner');
  assert.equal(banner.hidden, true);
  const clock = useAppTimers(t);
  drop();
  await clock.advance(1000);
  assert.equal(banner.hidden, true, 'a routine reconnect never flashes the banner');
  await clock.advance(2100);
  assert.equal(banner.hidden, false);
  assert.equal(banner.querySelector('.conn-banner-text').textContent, OFFLINE_TEXT);
  assert.deepEqual(notes(doc), ["The runs show here once Worca's server is reachable again."]);
  assert.equal(doc.querySelectorAll('.conn-banner').length, 1, 'one banner, app-wide');
  const before = calls.history;
  recv({ type: 'hello', runs: [] });
  await clock.settle();
  assert.equal(banner.hidden, true);
  assert.equal(calls.history, before + 1, 'back online: History reloads once');
});

test('server unreachable off the Runs view: back online reloads History once', async (t) => {
  const { window, recv, drop, calls } = await boot({ url: 'http://localhost:4317/#schedules' });
  recv({ type: 'hello', runs: [] });
  await settle(window);
  const clock = useAppTimers(t);
  drop();
  await clock.advance(3100);
  assert.equal(window.document.getElementById('conn-banner').hidden, false, 'the banner shows on every view');
  const before = calls.history;
  recv({ type: 'hello', runs: [] });
  await clock.settle();
  assert.equal(window.document.getElementById('conn-banner').hidden, true);
  assert.equal(calls.history, before + 1);
});

test('server unreachable with rows on screen: the rows stay and only the banner says it', async (t) => {
  const { window, doc, recv, drop } = await boot({ history: () => res(200, { pipelines: HIST }) });
  recv({ type: 'hello', runs: [] });
  await settle(window);
  assert.equal(doc.querySelectorAll('#runs-list a.runs-row').length, 2);
  const clock = useAppTimers(t);
  drop();
  await clock.advance(3100);
  assert.equal(doc.getElementById('conn-banner').hidden, false);
  assert.equal(doc.querySelectorAll('#runs-list a.runs-row').length, 2, 'the last rows stay');
  assert.deepEqual(notes(doc), [], 'no second message on the list');
});

test('failed Archive: the toast names the action and the next step', async () => {
  for (const [bulk, detail] of [
    [() => res(409, { error: 'The run is live' }), 'The run is live. Reload the list, then try again.'],
    [() => Promise.reject(new TypeError('Failed to fetch')), UNREACHABLE_DETAIL],
  ]) {
    const { window, doc, recv } = await boot({ history: () => res(200, { pipelines: HIST }), bulk });
    recv({ type: 'hello', runs: [] });
    await settle(window);
    const check = doc.querySelector('#runs-list a.runs-row[data-pipeline-id="aaaa0001"]').closest('.runs-item').querySelector('.runs-check');
    check.checked = true;
    check.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle(window);
    click(window, doc.querySelector('#runs-bulk [data-bulk="archive"]'));
    await settle(window, 8);
    const toast = doc.querySelector('#toasts .toast.err');
    assert.equal(toast.querySelector('.tt').textContent, 'Could not archive the selected runs');
    assert.equal(toast.querySelector('.td').textContent, detail);
    assert.ok(doc.querySelector('#runs-list a.runs-row[data-pipeline-id="aaaa0001"]').closest('.runs-item').querySelector('.runs-check').checked,
      'the selection stays');
  }
});

test('load failed: the error note with Try again, and a click re-fetches', async () => {
  let failing = true;
  const { window, doc, recv, calls } = await boot({ history: () => (failing ? res(500, { error: 'disk full' }) : res(200, { pipelines: HIST })) });
  recv({ type: 'hello', runs: [] });
  await settle(window);
  const err = doc.querySelector('#runs-list .runs-note-err');
  assert.match(err.textContent, /^Could not load finished runs: disk full/);
  const retry = err.querySelector('button[data-runs-retry]');
  assert.equal(retry.textContent, 'Try again');
  failing = false;
  const before = calls.history;
  click(window, retry);
  await settle(window);
  assert.equal(calls.history, before + 1);
  assert.equal(doc.querySelectorAll('#runs-list a.runs-row').length, 2);
  assert.equal(doc.querySelector('#runs-list .runs-note-err'), null);
});
