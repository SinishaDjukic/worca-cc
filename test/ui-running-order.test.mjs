// test/ui-running-order.test.mjs
// Card/tab ordering is STABLE while pipelines run: log activity must not
// reshuffle; group-rank transitions (question, finish) still regroup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath  = fileURLToPath(new URL('../ui/public/app.js',   import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};   // jsdom has no layout
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    if (u.includes('/api/resume')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'r-new', pipelineId: 'p1' }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);  // cache-bust: fresh module each test
  await new Promise((r) => setTimeout(r, 0));                    // let loadProjects/loadConfig settle
  const np = window.__np;
  // WS is created at import time (connectWS()) → lastWs is set now.
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const selectProject = () => {
    const s = window.document.querySelector('#projectSelect');
    s.value = PROJECT;
    s.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, np, recv, selectProject, tick };
}

const cardOrder = (window) =>
  [...window.document.querySelectorAll('#run-list .run-card')].map((c) => c.dataset.runId);

test('log activity does not reorder the Running cards', async () => {
  const { window, recv, selectProject, tick } = await boot();
  selectProject();
  window.location.hash = 'running';
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'phase', runId: 'p1', phase: 'plan', cycle: 0 });   // older run
  recv({ type: 'phase', runId: 'p2', phase: 'plan', cycle: 0 });   // newer run
  await tick();
  assert.deepEqual(cardOrder(window), ['p2', 'p1'], 'newest-first baseline');

  // Log to the run at the BOTTOM — recency-based ordering would bump it to the top.
  recv({ type: 'log', runId: 'p1', source: 'planner', level: 'info', text: 'x', ts: 1 });
  await tick();
  assert.deepEqual(cardOrder(window), ['p2', 'p1'], 'order unchanged on log activity');
});

test('a question still regroups the card to the top (needs-attention rank)', async () => {
  const { window, recv, selectProject, tick } = await boot();
  selectProject();
  window.location.hash = 'running';
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'phase', runId: 'p1', phase: 'plan', cycle: 0 });
  recv({ type: 'phase', runId: 'p2', phase: 'plan', cycle: 0 });
  await tick();
  recv({ type: 'question', runId: 'p1', id: 'q1', kind: 'clarify', questions: [] });
  await tick();
  assert.deepEqual(cardOrder(window), ['p1', 'p2'], 'pendingQuestion outranks live');
});

// Resume drops the superseded paused run from the runs map, but a trailing
// tagged frame for that dead runId re-materializes it through upsertRun. The
// resurrected run must keep its ORIGINAL creation key — minting a fresh one
// would make the stale run read as the newest and outrank the run the user
// just resumed.
test('a trailing frame for a superseded run does not outrank the resumed run', async () => {
  const { window, np, recv, selectProject, tick } = await boot();
  selectProject();
  window.location.hash = 'running';
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'phase', runId: 'r1', phase: 'plan', cycle: 0 });
  await tick();

  const r1 = np.getRun('r1');
  np.onState(r1, { status: 'running', id: 'p1' });   // capture the pipelineId
  np.onState(r1, { status: 'paused' });
  await np.resumeRunFromCard('r1');
  await tick();
  assert.equal(np.getRun('r1'), undefined, 'resume drops the superseded run');

  // Trailing frame for the dead runId → upsertRun re-materializes it.
  recv({ type: 'log', runId: 'r1', source: 'planner', level: 'info', text: 'late', ts: 9 });
  await tick();
  window.location.hash = 'running';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick();

  assert.deepEqual(cardOrder(window), ['r-new', 'r1'], 'resumed run stays above the resurrected stale run');
});

// Sidebar rows: a log frame changes nothing → the rebuild must be skipped
// entirely (same DOM nodes), so sidebar scroll/DOM stop churning per log.
test('log frame does not rebuild the sidebar child rows', async () => {
  const { window, recv, selectProject, tick } = await boot();
  selectProject();
  window.location.hash = 'running';
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'phase', runId: 'p1', phase: 'plan', cycle: 0 });
  recv({ type: 'phase', runId: 'p2', phase: 'plan', cycle: 0 });
  await tick();

  const host = window.document.querySelector('#nav-running-children');
  const before = [...host.children];
  assert.equal(before.length, 2, 'two child rows exist');

  recv({ type: 'log', runId: 'p1', source: 'planner', level: 'info', text: 'x', ts: 3 });
  await tick();
  const after = [...host.children];
  assert.deepEqual(after.map((c) => c.dataset.childRunId), before.map((c) => c.dataset.childRunId), 'same order');
  assert.ok(after.every((c, i) => c === before[i]), 'same DOM nodes — rebuild was skipped');
});

test('a title change does rebuild the sidebar rows', async () => {
  const { window, recv, selectProject, tick } = await boot();
  selectProject();
  window.location.hash = 'running';
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'phase', runId: 'p1', phase: 'plan', cycle: 0 });
  await tick();
  recv({ type: 'title', runId: 'p1', title: 'settled title' });
  await tick();
  const row = window.document.querySelector('#nav-running-children .nav-child .child-title');
  assert.equal(row.textContent, 'settled title', 'signature change → repaint happened');
});
