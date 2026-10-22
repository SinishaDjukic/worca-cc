// test/ui-running-order.test.mjs
// Row/tab ordering is STABLE while pipelines run: log activity must not
// reshuffle; group-rank transitions (question, finish) still regroup. Each run is listed once (runs
// redesign §3.1), so the live rows are read in list order across the sections.
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

// `notifications`: alerts on, the page hidden, and a fake Notification whose `shown` list a test reads (ui-alerts).
async function boot({ resumeReply = null, notifications = false } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};   // jsdom has no layout
  const shown = [];
  if (notifications) {
    window.Notification = class {
      constructor(title, opts = {}) { this.tag = opts.tag; this.closed = false; shown.push(this); }
      close() { this.closed = true; }
    };
    window.Notification.permission = 'granted';
    window.localStorage.setItem('worca-cc.alerts.notify', '1');
    Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  }
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
      // `resumeReply` ({status, body}): the server refuses the resume (e.g. 400 'pipeline is "done", not resumable').
      if (resumeReply) return Promise.resolve({ ok: false, status: resumeReply.status, json: async () => resumeReply.body });
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
  const go = (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, np, recv, selectProject, tick, go, shown };
}

const liveRows = (window) =>
  [...window.document.querySelectorAll('#runs-list .runs-row[data-kind="live"]')];
const cardOrder = (window) => liveRows(window).map((c) => c.dataset.runId);
// A hello summary row (server.mjs summarizeRuns): the fields onHello reads.
const hrun = (runId, pipelineId, status) => ({ runId, title: 'T', projectDir: PROJECT, status, pipelineId, kind: 'run', pendingQuestion: null });
// The runs this tab marked finished-unread (markLingering's localStorage set).
const lingerIds = (window) => JSON.parse(window.localStorage.getItem('worca-cc.lingerRuns') || '[]');
const errToasts = (window) => [...window.document.querySelectorAll('.toast.err')];
const settle = async (tick, n = 3) => { for (let i = 0; i < n; i++) await tick(); };

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

// #792: the scheduled resume ran as r2 and FINISHED while this tab was asleep / offline. The reconnect hello is the
// only thing that tells it, and it lists r2 already done (the server's resumeRun evicted r1). The paused copy must go
// with it, or a "Paused · Resume" row stays (and hides the finished History row) until a reload.
test('a resumed run that finished while the tab was away replaces its paused copy on reconnect', async () => {
  const { window, np, recv, selectProject, tick, go } = await boot();
  selectProject();
  go('runs');
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'paused')] });
  await settle(tick);
  assert.equal(np.getRun('r1').status, 'paused');
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r2', 'p1', 'done')] });   // same server, socket came back
  await settle(tick);
  assert.equal(np.getRun('r1'), undefined, 'the stale paused copy is dropped by the newer, finished copy');
  assert.equal(np.getRun('r2').status, 'done');
  assert.equal(window.document.querySelector('#runs-list .runs-row[data-run-id="r1"]'), null, 'no "Paused · Resume" row');
});

test('an older finished copy never evicts a newer paused copy of the same pipeline', async () => {
  const { np, recv, tick } = await boot();
  // r1 finished, then the pipeline ran again as r2 and paused: r2 is the newer copy (higher orderKey).
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'done'), hrun('r2', 'p1', 'paused')] });
  await tick();
  np.onState(np.getRun('r1'), { status: 'done', id: 'p1' });   // a trailing frame of the old copy
  await tick();
  assert.equal(np.getRun('r2')?.status, 'paused', 'the newer paused copy stays resumable');
});

test('a run the tab saw live, and that finished while it was away, is marked finished-unread on reconnect', async () => {
  const { window, np, recv, tick } = await boot();
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'running')] });
  await tick();
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'done')] });
  await tick();
  assert.ok(lingerIds(window).includes('r1'), 'the missed finish lingers unread, as a live finish does');
  assert.equal(np.getRun('r1')._finished, true, 'it took the one terminal path (finishRun)');
});

test('a resumed run that finished while the tab was away is marked finished-unread', async () => {
  const { window, recv, tick } = await boot();
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'paused')] });
  await tick();
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r2', 'p1', 'done')] });
  await tick();
  assert.ok(lingerIds(window).includes('r2'), 'the run that superseded the paused copy lingers unread');
});

test('a finished run the tab never knew is not marked unread, on the first hello or a reconnect', async () => {
  const { window, np, recv, tick } = await boot();
  // The page-load hello: b1 finished after a paused copy of its pipeline — still nothing this tab missed.
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('a1', 'pa', 'done'), hrun('b0', 'pb', 'paused'), hrun('b1', 'pb', 'done')] });
  await tick();
  assert.notEqual(np.getRun('b1')._finished, true, 'the first hello takes no finish path (no made-up finish time)');
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('a1', 'pa', 'done'), hrun('x1', 'px', 'done')] });
  await tick();
  assert.deepEqual(lingerIds(window), [], 'neither the page-load run nor a stranger finish lingers');
});

test('a live run a reconnect lists as interrupted or paused is no missed finish', async () => {
  const { window, np, recv, tick } = await boot();
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'running'), hrun('r2', 'p2', 'running')] });
  await tick();
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'interrupted'), hrun('r2', 'p2', 'paused')] });
  await tick();
  assert.deepEqual(lingerIds(window), [], 'a resumable run is not a result: nothing lingers unread');
  assert.notEqual(np.getRun('r1')._finished, true, 'the interrupted run took no finish path');
  assert.notEqual(np.getRun('r2')._finished, true, 'the paused run took no finish path');
});

test('a newer finished copy of a pipeline whose older copy the tab knew finished is not marked unread', async () => {
  const { window, recv, tick } = await boot();
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'done')] });
  await tick();
  // r2 ran and finished while the tab was away, but it supersedes no paused copy here: nothing this tab missed.
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'done'), hrun('r2', 'p1', 'done')] });
  await tick();
  assert.deepEqual(lingerIds(window), []);
});

// #792 / Q4: a manual Resume moves the page to the new run (landOnResumedRun); a scheduled one must too, instead of
// renderRunningView bouncing the dead id away from the run.
test('a tab on the paused run\'s page follows its scheduled resume to the new run, in the same mode', async () => {
  const { window, np, recv, tick, go } = await boot();
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'paused')] });
  await tick();
  go('running/r1/details');
  await settle(tick);
  assert.equal(window.location.hash, '#running/r1/details');
  recv({ type: 'run-created', runId: 'r2', title: 'T', projectDir: PROJECT, kind: 'run', status: 'starting' });
  np.onState(np.getRun('r2'), { status: 'running', id: 'p1' });   // the first state names the pipeline
  await settle(tick);
  assert.equal(np.getRun('r1'), undefined, 'the paused copy is superseded');
  assert.equal(window.location.hash, '#running/r2/details', 'the page follows to the resumed run');
});

test('a scheduled resume never moves a tab that is not on the paused run\'s page', async () => {
  const { window, np, recv, selectProject, tick, go } = await boot();
  selectProject();
  go('runs');
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'paused'), hrun('q1', 'p2', 'paused')] });
  await tick();
  recv({ type: 'run-created', runId: 'r2', title: 'T', projectDir: PROJECT, kind: 'run', status: 'starting' });
  np.onState(np.getRun('r2'), { status: 'running', id: 'p1' });
  await settle(tick);
  assert.equal(window.location.hash, '#runs', 'the Runs list stays put');
  // The user leaves the paused run's page, and the resume lands before the hashchange routed away (the run screen is
  // still mounted): the address, not the stale screen, says where the tab is.
  go('running/q1');
  await settle(tick);
  window.location.hash = 'settings';
  recv({ type: 'run-created', runId: 'q2', title: 'T', projectDir: PROJECT, kind: 'run', status: 'starting' });
  np.onState(np.getRun('q2'), { status: 'running', id: 'p2' });
  await settle(tick);
  assert.equal(np.getRun('q1'), undefined, 'the paused copy is superseded');
  assert.equal(window.location.hash, '#settings', 'a tab that left the run\'s page is never pulled back');
});

const DONE_REFUSAL = { status: 400, body: { error: 'pipeline is "done", not resumable' } };

test('Resume on a run that already finished settles it as finished on its page — no error toast, no Retry', async () => {
  const { window, np, recv, tick, go } = await boot({ resumeReply: DONE_REFUSAL });
  recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'paused')] });
  await tick();
  go('running/r1');
  await settle(tick);
  const btn = window.document.querySelector('#run-detail .rd-pause');
  assert.equal(btn?.dataset.action, 'resume', 'the stale copy offers Resume');
  await np.resumeRunFromCard('r1', btn);
  await settle(tick);
  assert.equal(np.getRun('r1').status, 'done', 'the copy settles as the run the server says finished');
  assert.deepEqual(errToasts(window), [], 'no "Could not resume the run" toast');
  assert.ok(!np.getRun('r1').logLines.some((l) => /resume failed/.test(String(l.text))), 'nothing logged as a failure');
  assert.equal(window.location.hash, '#running/r1', 'the page stays on the run, now finished (it hands off to the saved run once History lists it)');
});

test('Resume from the Runs list on a run that already finished leaves it there finished-unread', async () => {
  const { window, np, recv, selectProject, tick, go, shown } = await boot({ resumeReply: DONE_REFUSAL, notifications: true });
  selectProject();
  go('runs');
  recv({ type: 'hello', bootId: 'b1', runs: [{ ...hrun('r1', 'p1', 'paused'), pauseReason: 'usage_limit' }] });
  await tick();
  assert.deepEqual(shown.map((n) => [n.tag, n.closed]), [['worca:r1:pause', false]], 'the usage-limit pause alert is up');
  await np.resumeRunFromCard('r1', null, { navigate: false });   // the row / chat card path (chatRunControls.resume)
  await settle(tick);
  assert.equal(np.getRun('r1').status, 'done');
  assert.equal(shown[0].closed, true, 'the phantom pause no longer waits on anyone: its alert closes');
  assert.ok(lingerIds(window).includes('r1'), 'it reads finished-unread, so the user notices it completed');
  assert.deepEqual(errToasts(window), []);
  assert.equal(window.location.hash, '#runs', 'navigate:false never hops');
});

test('a Resume refused for another reason still shows the error toast and keeps the run paused', async () => {
  // Any other refusal, and the 409 race twin naming a status that is not finished ("running", "gone").
  for (const resumeReply of [{ status: 400, body: { error: 'pipeline has no resume point' } },
    { status: 409, body: { error: 'pipeline is "running", not resumable' } }]) {
    const { window, np, recv, tick } = await boot({ resumeReply });
    recv({ type: 'hello', bootId: 'b1', runs: [hrun('r1', 'p1', 'paused')] });
    await tick();
    await np.resumeRunFromCard('r1', null);
    await settle(tick);
    assert.equal(np.getRun('r1').status, 'paused', resumeReply.body.error);
    assert.equal(errToasts(window).length, 1, 'the generic failure toast stays');
    assert.match(errToasts(window)[0].textContent, /Could not resume the run/);
  }
});
