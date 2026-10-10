// test/ui-activity-app.test.mjs — the top bar's Activity as app.js wires it, through the REAL app.js
// against the REAL index.html: its badge is the Runs badge (the same amber number, else the running
// number the sidebar shows), the schedules load when it opens and again on schedules-changed only
// while it is open, and a row opens its page.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const htmlPath = join(root, 'index.html');
const appPath = join(root, 'app.js');
const PROJECT = '/tmp/proj';
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
const SOON = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

async function boot() {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const calls = [];
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (u) => {
    const url = String(u);
    calls.push(url);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (url.includes('/api/projects')) return json({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    if (url.endsWith('/api/schedules')) {
      return json({ schedules: [], tickets: [{ id: 't1', scheduleId: null, title: 'Upgrade', status: 'scheduled', runAt: SOON, projectDir: PROJECT }], counts: {}, defaults: {} });
    }
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const $ = (s) => window.document.querySelector(s);
  const click = (s) => (typeof s === 'string' ? $(s) : s)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  const schedulesFetches = () => calls.filter((u) => u.endsWith('/api/schedules')).length;
  return { window, $, click, recv, schedulesFetches };
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});
const QUESTION = { id: 'q1', kind: 'clarify', questions: [{ question: 'x?', options: ['a'] }] };

test('the Activity badge is the Runs badge: the same amber Needs-you number, else the running number the sidebar shows, hidden at zero', async () => {
  const { $, recv } = await boot();
  const badge = () => { const n = $('#topnav-activity-n'); return [n.textContent, n.dataset.tone, n.hidden]; };
  recv({ type: 'hello', runs: [live('q1', { pendingQuestion: QUESTION }), live('r1'), live('s1', { kind: 'agentgen', title: 'agent: helper' })] });
  await settle();
  assert.equal($('#nav-needs-count').textContent, '1', 'precondition: the sidebar counts the question');
  assert.deepEqual(badge(), [$('#nav-needs-count').textContent, 'need', false]);
  assert.equal($('#topnav-activity').title, '1 needs you · 2 running', 'an agent job (liveRuns, not the Runs list) runs too');
  recv({ type: 'done', runId: 'q1', status: 'done' });
  await settle();
  assert.equal($('#nav-needs-count').hidden, true, 'precondition: nothing needs you');
  assert.deepEqual(badge(), [$('#nav-running-count').textContent, 'run', false], 'the sidebar\'s grey Runs number');
  assert.equal($('#nav-running-count').textContent, '2');
  recv({ type: 'done', runId: 'r1', status: 'done' });
  recv({ type: 'done', runId: 's1', status: 'done' });
  await settle();
  assert.equal($('#topnav-activity-n').hidden, true);
  assert.equal($('#topnav-activity').hasAttribute('title'), false);
});

test('opened, it lists the open tab; the schedules load on open and on schedules-changed only while open; a row opens its page and closes it', async () => {
  const { window, $, click, recv, schedulesFetches } = await boot();
  recv({ type: 'hello', runs: [live('r1')] });
  await settle();
  const before = schedulesFetches();
  recv({ type: 'schedules-changed' });
  await settle();
  assert.equal(schedulesFetches(), before, 'closed: no fetch');
  click('#topnav-activity');
  await settle();
  assert.equal($('#topnav-activity').getAttribute('aria-expanded'), 'true');
  assert.equal($('#activity-pop').hidden, false);
  assert.equal(schedulesFetches(), before + 1, 'opening fetches the schedules');
  assert.equal($('#activity-tab-running').getAttribute('aria-selected'), 'true', 'nothing needs you: the first tab with rows');
  recv({ type: 'schedules-changed' });
  await settle();
  assert.equal(schedulesFetches(), before + 2, 'open: refetched');
  click('#activity-tab-scheduled');
  assert.deepEqual([...$('#activity-panel').querySelectorAll('.activity-row')].map((a) => [a.getAttribute('href'), a.querySelector('.activity-row-title').textContent]),
    [['#schedules/once', 'Upgrade']]);
  assert.equal($('#activity-tab-scheduled .activity-tab-n').textContent, '1');
  click('#activity-tab-running');
  click($('#activity-panel .activity-row'));
  await settle();
  assert.equal(window.location.hash, '#running/r1');
  assert.equal($('#activity-pop').hidden, true);
  assert.equal($('#topnav-activity').getAttribute('aria-expanded'), 'false');
});

test('open while a run finishes and the route changes: the row leaves, the open tab stays, a focused row keeps focus', async () => {
  const { window, $, click, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1'), live('r2')] });
  await settle();
  click('#topnav-activity');
  await settle();
  const keys = () => [...$('#activity-panel').querySelectorAll('.activity-row')].map((a) => a.dataset.key).sort();
  assert.equal($('#activity-tab-running').getAttribute('aria-selected'), 'true');
  assert.deepEqual(keys(), ['live:r1', 'live:r2']);
  $('#activity-panel .activity-row[data-key="live:r2"]').focus();
  recv({ type: 'done', runId: 'r1', status: 'done' });
  await settle();
  assert.deepEqual(keys(), ['live:r2'], 'the finished run leaves Running');
  window.location.hash = '#schedules';
  await settle();
  assert.equal($('[data-view="schedules"]').classList.contains('hidden'), false, 'precondition: the route changed');
  assert.equal($('#activity-pop').hidden, false);
  assert.equal($('#activity-tab-running').getAttribute('aria-selected'), 'true');
  assert.deepEqual(keys(), ['live:r2']);
  assert.equal(window.document.activeElement.dataset.key, 'live:r2');
});

test('a row routed while the Ask sheet is open closes the sheet first: the page it opens is not under the sheet', async () => {
  const { window, $, recv } = await boot();
  const key = (s) => (typeof s === 'string' ? $(s) : s)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));   // Enter: a keyboard click, no press
  recv({ type: 'hello', runs: [live('r1')] });
  await settle();
  $('.ask-pill').click();
  await settle();
  assert.equal($('.ask-sheet').hidden, false, 'precondition: the Ask sheet is open');
  key('#topnav-activity');
  await settle();
  assert.equal($('#activity-pop').hidden, false);
  key($('#activity-panel .activity-row[data-key="live:r1"]'));
  await settle();
  assert.equal(window.location.hash, '#running/r1');
  assert.equal($('#activity-pop').hidden, true);
  assert.equal($('.ask-sheet').hidden, true, 'after the route: the sheet is shut, so the run page shows');
});
