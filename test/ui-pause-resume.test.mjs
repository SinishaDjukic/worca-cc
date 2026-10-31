// test/ui-pause-resume.test.mjs — pause/resume UI affordances (jsdom).
// Harness mirrors the boot() of test/ui-subagent-state.test.mjs: boot index.html,
// stub WebSocket/fetch, import app.js with a cache-buster, reach internals via
// window.__np. Adds a fetchCalls recorder + an /api/resume stub, and can drive
// the History DETAIL screen — Resume lives there now, not on the list card.
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
const PROJECT = '/tmp/proj';

async function bootLive({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  const fetchCalls = [];
  window.fetch = (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/resume')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'r-new', pipelineId: 'p1' }) });
    }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  // The card no longer expands — open the run's DETAIL screen (#history/<key>/<id>).
  const showDetail = (key, id) => { window.location.hash = `history/${key}/${id}`; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, fetchCalls, showHistory, showDetail, settle };
}

// MOST-SPECIFIC FIRST: the keyed detail URL has the list URL as a prefix.
const historyArms = (row) => (url) => {
  if (url.endsWith(`/api/history/k/${row.id}`)) {
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ state: { id: row.id, title: row.title, status: row.status, steps: [] } }) });
  }
  if (url.endsWith('/api/history')) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [row], live: [] }) });
  }
  return null;
};

test('paused and pausing land in the amber paused family (histStatusMeta and statusPill, ahead of the question state)', async () => {
  const { window } = await bootLive();
  const { histStatusMeta, statusPill } = window.__np;
  await checkRows([
    { name: 'histStatusMeta: paused and pausing both land in the amber paused family', run: async () => {
      assert.deepEqual(histStatusMeta({ status: 'paused' }), { family: 'paused', word: 'Paused' });
      assert.deepEqual(histStatusMeta({ status: 'pausing' }), { family: 'paused', word: 'Pausing…' });
    } },
    { name: 'statusPill: pausing/paused map to amber, ahead of the question state', run: async () => {
      assert.deepEqual(statusPill({ status: 'pausing', pendingQuestion: null }), { family: 'amber', text: 'Pausing…' });
      assert.deepEqual(statusPill({ status: 'paused', pendingQuestion: null }), { family: 'amber', text: 'Paused' });
    } },
  ]);
});

test('E2/2.3: a done run that was forced past open issues, or never reached End, says so in its status', async () => {
  const { window } = await bootLive();
  const { histStatusMeta, statusPill } = window.__np;
  assert.deepEqual(statusPill({ status: 'done', openIssues: [{ nodeId: 'n_review', count: 2 }], endReached: true }),
    { family: 'amber', text: 'Done · 2 open issues' });
  assert.deepEqual(statusPill({ status: 'done', endReached: false }), { family: 'amber', text: 'Done · End not reached' });
  assert.deepEqual(statusPill({ status: 'done', endReached: true }), { family: 'green', text: 'Done' });
  assert.deepEqual(statusPill({ status: 'paused', pauseReason: 'time_limit' }), { family: 'amber', text: 'Paused · time limit' });
  assert.equal(histStatusMeta({ status: 'done', openIssueCount: 1 }).word, 'Done · 1 open issue');
  assert.equal(histStatusMeta({ status: 'done' }).word, 'Done');
});

test('a paused run shows a wired Resume button on its detail screen', async () => {
  const row = { id: 'p1', title: 't', status: 'paused', projectKey: 'k' };
  const ctx = await bootLive({ fetchHandler: historyArms(row) });
  ctx.showHistory();
  await ctx.settle();
  ctx.showDetail('k', 'p1');
  await ctx.settle();
  const btn = ctx.window.document.querySelector('#hist-detail .hd-resume');
  assert.ok(btn, 'resume button present');
  assert.equal(btn.hidden, false, 'visible on paused records');
  btn.click();
  await ctx.settle(5);
  const call = ctx.fetchCalls.find((c) => c.url.includes('/api/resume'));
  assert.ok(call, 'click posts /api/resume');
  assert.deepEqual(JSON.parse(call.opts.body), { pipelineId: 'p1', baseCheck: true });
});

test('a done run hides the Resume button on its detail screen', async () => {
  const row = { id: 'p2', title: 't', status: 'done', projectKey: 'k' };
  const ctx = await bootLive({ fetchHandler: historyArms(row) });
  ctx.showHistory();
  await ctx.settle();
  ctx.showDetail('k', 'p2');
  await ctx.settle();
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').hidden, true);
});

// A deferred fetch answer: the test decides when the server "replies".
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('Pause shows Pausing… at the click, before the server answers, and a stale running frame does not undo it', async () => {
  const reply = deferred();
  const { window } = await bootLive({ fetchHandler: (url) => (url.includes('/api/pause') ? reply.promise : null) });
  const np = window.__np;
  const r = np.upsertRun({ runId: 'r1', pipelineId: 'p1', title: 't', projectDir: PROJECT, status: 'running' });
  await checkRows([
    { name: 'the click flips the run to pausing at once', run: async () => {
      const done = np.pauseRun('r1', null);
      assert.equal(r.status, 'pausing');
      assert.deepEqual(np.statusPill(r), { family: 'amber', text: 'Pausing…' });
      assert.equal(np.runDotClass(r), 'grey-pulse');
      // A frame the server sent before it took the pause still says running.
      np.onState(r, { status: 'running' });
      assert.equal(r.status, 'pausing', 'a stale running frame keeps Pausing…');
      reply.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      assert.equal(await done, null);
      np.onState(r, { status: 'pausing' });
      np.onState(r, { status: 'paused' });
      assert.equal(r.status, 'paused', 'the server status takes over');
      assert.equal(r.pausePending, false);
    } },
  ]);
});

test('a taken Pause whose pausing status never arrives stops holding running back after PAUSE_HOLD_MS', async () => {
  const { window } = await bootLive({ fetchHandler: (url) => (url.includes('/api/pause')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }) : null) });
  const np = window.__np;
  const r = np.upsertRun({ runId: 'r1', pipelineId: 'p1', title: 't', projectDir: PROJECT, status: 'running' });
  const held = [];
  const origSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => (ms === 30000 ? held.push(fn) : origSetTimeout(fn, ms, ...a));
  try {
    await checkRows([
      { name: 'a running status inside the hold keeps Pausing…; one after it applies', run: async () => {
        assert.equal(await np.pauseRun('r1', null), null);
        np.onState(r, { status: 'running' });
        assert.equal(r.status, 'pausing', 'inside the hold a running status is a stale one');
        assert.equal(held.length, 1, 'one hold timer');
        held[0]();
        np.onState(r, { status: 'running' });
        assert.equal(r.status, 'running', 'the run did not take the pause: it reads Running again');
      } },
      { name: 'an old hold never ends a newer Pause\'s hold', run: async () => {
        held.length = 0;
        assert.equal(await np.pauseRun('r1', null), null);
        const old = held[0];
        np.onState(r, { status: 'pausing' });
        np.onState(r, { status: 'running' });
        assert.equal(await np.pauseRun('r1', null), null);
        old();
        np.onState(r, { status: 'running' });
        assert.equal(r.status, 'pausing', 'the second Pause is still held');
      } },
    ]);
  } finally { globalThis.setTimeout = origSetTimeout; }
});

test('History detail header pip: the tab\'s run unless the saved row ended a run the tab still holds parked', async () => {
  const { window } = await bootLive();
  const { hdShownStatus } = window.__np;
  await checkRows([
    { name: 'no run in this tab: the saved row', run: () => assert.deepEqual(hdShownStatus(null, 'done'), { status: 'done' }) },
    { name: 'a live run beats a lagging row', run: () => assert.deepEqual(hdShownStatus({ status: 'running' }, 'paused'), { status: 'running' }) },
    { name: 'a run that parked in this tab beats a row still reading running', run: () => assert.deepEqual(hdShownStatus({ status: 'paused' }, 'running'), { status: 'paused' }) },
    { name: 'stopped from another tab or the CLI: the row', run: () => assert.deepEqual(hdShownStatus({ status: 'paused' }, 'stopped'), { status: 'stopped' }) },
    { name: 'an interrupted copy the row says is done: the row', run: () => assert.deepEqual(hdShownStatus({ status: 'interrupted' }, 'done'), { status: 'done' }) },
    { name: 'a Resume in flight: Resuming…', run: () => assert.deepEqual(hdShownStatus({ status: 'paused', resumePending: true }, 'stopped'), { status: 'paused', resumePending: true }) },
  ]);
});

test('a refused Pause puts the run back to running', async () => {
  const { window } = await bootLive({ fetchHandler: (url) => (url.includes('/api/pause')
    ? Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'cannot pause' }) }) : null) });
  const np = window.__np;
  const r = np.upsertRun({ runId: 'r1', pipelineId: 'p1', title: 't', projectDir: PROJECT, status: 'running' });
  await checkRows([
    { name: 'the refusal reverts pausing to running, and later frames apply again', run: async () => {
      assert.equal(await np.pauseRun('r1', null), 'cannot pause');
      assert.equal(r.status, 'running');
      assert.equal(r.pausePending, false);
      np.onState(r, { status: 'running' });
      assert.equal(r.status, 'running');
    } },
  ]);
});

test('Resume shows Resuming… on the parked run until the server answers', async () => {
  const reply = deferred();
  const { window } = await bootLive({ fetchHandler: (url) => (url.includes('/api/resume') ? reply.promise : null) });
  const np = window.__np;
  const r = np.upsertRun({ runId: 'r1', pipelineId: 'p1', title: 't', projectDir: PROJECT, status: 'paused' });
  await checkRows([
    { name: 'the click shows Resuming… while the request is in flight', run: async () => {
      const done = np.resumeRunFromCard('r1', null, { navigate: false });
      assert.equal(r.resumePending, true);
      assert.deepEqual(np.statusPill(r), { family: 'amber', text: 'Resuming…' });
      assert.equal(np.runDotClass(r), 'grey-pulse');
      assert.equal(np.askRunStore.byPipeline('p1').resumePending, true, 'the chat card reads it too');
      reply.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'r-new', pipelineId: 'p1' }) });
      await done;
      assert.equal(np.getRun('r1'), undefined, 'the paused copy is dropped');
      assert.equal(np.getRun('r-new').status, 'starting');
    } },
  ]);
});

test('a refused Resume puts the run back to Paused', async () => {
  const { window } = await bootLive({ fetchHandler: (url) => (url.includes('/api/resume')
    ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) : null) });
  const np = window.__np;
  const r = np.upsertRun({ runId: 'r1', pipelineId: 'p1', title: 't', projectDir: PROJECT, status: 'paused' });
  await checkRows([
    { name: 'the failure clears Resuming…', run: async () => {
      await np.resumeRunFromCard('r1', null, { navigate: false });
      assert.equal(r.resumePending, false);
      assert.deepEqual(np.statusPill(r), { family: 'amber', text: 'Paused' });
    } },
  ]);
});

test('the History / chat resume path (resumePipeline) shows Resuming… on an interrupted copy and clears it on failure', async () => {
  const replyHold = deferred();
  const { window } = await bootLive({ fetchHandler: (url) => (url.includes('/api/resume') ? replyHold.promise : null) });
  const np = window.__np;
  const r = np.upsertRun({ runId: 'r1', pipelineId: 'p1', title: 't', projectDir: PROJECT, status: 'interrupted' });
  await checkRows([
    { name: 'an interrupted copy reads Resuming… while the request runs, Interrupted again after a failure', run: async () => {
      // An interrupted copy is not "paused": the chat card resumes it through resumePipeline.
      const done = np.chatRunControls.resume({ pipelineId: 'p1', runId: 'r1' });
      await new Promise((res) => setTimeout(res, 0));
      assert.equal(r.resumePending, true);
      assert.deepEqual(np.statusPill(r), { family: 'amber', text: 'Resuming…' });
      replyHold.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
      await done;
      assert.equal(r.resumePending, false);
      assert.deepEqual(np.statusPill(r), { family: 'amber', text: 'Interrupted' });
    } },
  ]);
});
