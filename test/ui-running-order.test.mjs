// test/ui-running-order.test.mjs
// Row/tab ordering is STABLE while pipelines run: log activity must not
// reshuffle; group-rank transitions (question, finish) still regroup. The live
// rows are read inside their project group — `[data-slot="group"]`, because a
// Needs-you run is repeated above the groups (rule 6).
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
const appPath  = fileURLToPath(new URL('../ui/public/app.js',   import.meta.url));
const PROJECT = '/tmp/proj';

async function boot() {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);  // cache-bust: fresh module each test
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

const liveRows = (window) =>
  [...window.document.querySelectorAll('#runs-list .runs-row[data-kind="live"]')];
const cardOrder = (window) => liveRows(window).map((c) => c.dataset.runId);

// One boot: baseline, a log frame, then a question frame.
test('log activity never reorders or rebuilds the Runs rows, while a question still regroups its row to the top', async () => {
  const { window, recv, selectProject, tick } = await boot();
  selectProject();
  window.location.hash = 'runs';
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'phase', runId: 'p1', phase: 'plan', cycle: 0 });   // older run
  recv({ type: 'phase', runId: 'p2', phase: 'plan', cycle: 0 });   // newer run
  await tick();
  await checkRows([
    { name: 'log activity does not reorder the Runs list rows', run: async () => {
      assert.deepEqual(cardOrder(window), ['p2', 'p1'], 'newest-first baseline');

      const before = liveRows(window);
      // Log to the run at the BOTTOM — recency-based ordering would bump it to the top.
      recv({ type: 'log', runId: 'p1', source: 'planner', level: 'info', text: 'x', ts: 1 });
      await tick();
      assert.deepEqual(cardOrder(window), ['p2', 'p1'], 'order unchanged on log activity');
      assert.ok(liveRows(window).every((c, i) => c === before[i]), 'same DOM nodes — a log frame never rebuilds #runs-list');
    } },
    { name: 'a question still regroups the row to the top (needs-attention rank)', run: async () => {
      recv({ type: 'question', runId: 'p1', id: 'q1', kind: 'clarify', questions: [] });
      await tick();
      assert.deepEqual(cardOrder(window), ['p1', 'p2'], 'pendingQuestion outranks live');
    } },
  ]);
});

// Resume drops the superseded paused run from the runs map, but a trailing
// tagged frame for that dead runId re-materializes it through upsertRun. The
// resurrected run must keep its ORIGINAL creation key — minting a fresh one
// would make the stale run read as the newest and outrank the run the user
// just resumed.
test('a trailing frame for a superseded run does not outrank the resumed run', async () => {
  const { window, np, recv, selectProject, tick } = await boot();
  selectProject();
  window.location.hash = 'runs';
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
  window.location.hash = 'runs';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick();

  assert.deepEqual(cardOrder(window), ['r-new', 'r1'], 'resumed run stays above the resurrected stale run');
});

// Resumed ELSEWHERE (the usage-limit auto-resume, another tab, the feature page): this tab never called
// resumeRunFromCard, so the new runId's state frame is what tells it. The old paused copy must go, or it
// lingers as a phantom "Paused" row under Needs you (and a feature's slice reads paused) until a reload.
test('a run resumed elsewhere drops the superseded paused copy of the same pipeline', async () => {
  const { window, np, recv, selectProject, tick } = await boot();
  selectProject();
  window.location.hash = 'runs';
  window.dispatchEvent(new window.Event('hashchange'));
  recv({ type: 'phase', runId: 'r1', phase: 'plan', cycle: 0 });
  await tick();
  const r1 = np.getRun('r1');
  np.onState(r1, { status: 'running', id: 'p1' });
  np.onState(r1, { status: 'paused' });
  recv({ type: 'phase', runId: 'r2', phase: 'plan', cycle: 0 });
  await tick();
  np.onState(np.getRun('r2'), { status: 'running', id: 'p1' });
  await tick();
  assert.equal(np.getRun('r1'), undefined, 'the paused copy is superseded by the live run of the same pipeline');
  assert.ok(np.getRun('r2'), 'the resumed run stays');
});

test('a paused run of another pipeline, or a newer paused copy, is kept', async () => {
  const { np, recv, tick } = await boot();
  recv({ type: 'phase', runId: 'a1', phase: 'plan', cycle: 0 });
  recv({ type: 'phase', runId: 'b1', phase: 'plan', cycle: 0 });
  await tick();
  np.onState(np.getRun('a1'), { status: 'running', id: 'pa' });
  np.onState(np.getRun('a1'), { status: 'paused' });
  np.onState(np.getRun('b1'), { status: 'running', id: 'pb' });
  assert.ok(np.getRun('a1'), 'another pipeline\'s paused run stays');
});

// Sidebar rows: a log frame changes nothing → the rebuild must be skipped
// entirely (same DOM nodes), so sidebar scroll/DOM stop churning per log.

// A restarted server (new bootId) lists only the runs IT knows. A run the old process was running and the new one
// does not list died with it: it must stop reading as running (no endless spinner until a page reload). A paused
// run keeps its pause: the new server can still resume it.
test('after a server restart, a running run the new server does not list stops reading as running', async () => {
  const { np, recv, tick } = await boot();
  recv({ type: 'hello', bootId: 'b1', runs: [
    { runId: 'r1', title: 'A', status: 'running', pipelineId: 'p1', kind: 'run' },
    { runId: 'r2', title: 'B', status: 'paused', pipelineId: 'p2', kind: 'run' }] });
  await tick();
  assert.equal(np.getRun('r1').status, 'running');
  recv({ type: 'hello', bootId: 'b2', runs: [] });
  await tick();
  assert.equal(np.getRun('r1').status, 'interrupted', 'the old process\'s running run is over');
  assert.equal(np.getRun('r2').status, 'paused', 'a paused run stays resumable');
});
