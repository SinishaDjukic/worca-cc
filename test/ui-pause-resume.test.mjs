// test/ui-pause-resume.test.mjs — pause/resume UI affordances (jsdom).
// Harness mirrors the boot() of test/ui-subagent-state.test.mjs: boot index.html,
// stub WebSocket/fetch, import app.js with a cache-buster, reach internals via
// window.__np. Adds a fetchCalls recorder + an /api/resume stub, and can drive
// the History DETAIL screen — Resume lives there now, not on the list card.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function bootLive({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
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
  // One server frame, as the socket delivers it.
  const dispatch = (msg) => (wsBox.ws._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(msg) }));
  return { window, fetchCalls, showHistory, showDetail, settle, dispatch };
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

test('#1090: the start reply\'s late starting does not undo a running the socket already delivered', async () => {
  const { window } = await bootLive();
  const np = window.__np;
  // The server broadcasts the new run's frames before it answers POST /api/run (measured ~0.1 ms apart).
  const r = np.upsertRun({ runId: 'r1', pipelineId: 'p1', title: 't', projectDir: PROJECT, status: 'starting' });
  np.onState(r, { status: 'running' });
  // Then the reply lands and beginRun records the run as it knew it at the click.
  np.upsertRun({ runId: 'r1', title: 't', projectDir: PROJECT, status: 'starting', local: true });
  assert.equal(r.status, 'running', 'the Runs row keeps the status the server sent');
  // A run the page meets first through its own start still begins as Starting.
  const fresh = np.upsertRun({ runId: 'r2', title: 'u', projectDir: PROJECT, status: 'starting', local: true });
  assert.equal(fresh.status, 'starting');
});

// Shaper small runs slice 7 (D16): a resume held for its turn answers {held:true} with no runId: nothing started.
test('S7: a held /api/resume answer keeps the paused copy and restores the Resume button', async () => {
  const row = { id: 'p7', title: 't', status: 'paused', projectKey: 'k' };
  const history = historyArms(row);
  const ctx = await bootLive({ fetchHandler: (url) => (url.includes('/api/resume')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, held: true, pipelineId: 'p7', after: 8 }) }) : history(url)) });
  ctx.showHistory();
  await ctx.settle();
  ctx.showDetail('k', 'p7');
  await ctx.settle();
  const np = ctx.window.__np;
  const btn = ctx.window.document.querySelector('#hist-detail .hd-resume');
  const label = btn.textContent;
  assert.match(label, /Resume/);
  const hash = ctx.window.location.hash;
  btn.click();                                        // the saved run's own Resume (resumePipeline)
  await ctx.settle(5);
  assert.equal(ctx.fetchCalls.filter((c) => c.url.includes('/api/resume')).length, 1);
  assert.equal(np.getRun(undefined), undefined, 'no phantom "Starting" run (upsertRun is not called)');
  assert.equal(btn.textContent, label, 'the button reads Resume again');
  assert.equal(btn.disabled, false);
  assert.equal(btn.dataset.resumeState, undefined);
  assert.equal(ctx.window.location.hash, hash, 'no navigation');
  assert.equal(ctx.window.document.querySelector('#toasts')?.textContent.includes('Could not resume') ?? false, false);
});

// ── Shaper small runs slice 8 (R-ux-2): the paused run's Resume says which run it would wait for ─────────────────
const answer = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
/** The /slice answer of run 6 (pipeline p6) of feature feat-1; `over` adds `resumeAfter` or `heldResume` facts. */
const sliceSix = (over = {}) => ({ featureId: 'feat-1', title: 'Charts', index: 6, total: 6, sliceTitle: 'Run 6', state: 'paused', next: null,
  owns: [], startsFrom: null, ...over });
const WAITS = () => sliceSix({ resumeAfter: 4 });
/** Boot with run 6 paused. `box.slice` is the /slice answer (or a function giving the fetch promise); `box.resume`, when
 *  set, answers POST /api/resume. The flag is on unless `flag` is false. */
async function bootSliceSix({ slice = sliceSix(), flag = true } = {}) {
  const box = { slice, resume: null, sliceGets: 0 };
  const history = historyArms({ id: 'p6', title: 't', status: 'paused', projectKey: 'k' });
  const ctx = await bootLive({ fetchHandler: (url) => {
    if (url.endsWith('/api/shape/pipelines/p6/slice')) {
      box.sliceGets += 1;
      return typeof box.slice === 'function' ? box.slice() : Promise.resolve(answer(box.slice));
    }
    if (url.includes('/api/resume') && box.resume) return box.resume;
    return history(url);
  } });
  const { applyFlags } = await import('../ui/public/flags.mjs');
  applyFlags({ shaperSmallRuns: flag }, ctx.window.document);
  const frame = async () => { ctx.dispatch({ type: 'shape-feature', id: 'feat-1' }); await ctx.settle(8); };
  return { ...ctx, box, frame };
}
/** Open run 6's saved page → its Resume button and what it reads. */
async function savedSix(ctx) {
  ctx.showHistory();
  await ctx.settle();
  ctx.showDetail('k', 'p6');
  await ctx.settle(8);
  const btn = ctx.window.document.querySelector('#hist-detail .hd-resume');
  assert.ok(btn && !btn.hidden, 'the saved paused run offers Resume');
  return { btn, label: () => btn.textContent.trim() };
}
/** Open run 6's live page, its run in this tab with `status` → the .rd-pause button, what it reads, and a state frame. */
async function liveSix(ctx, status = 'paused') {
  ctx.window.__np.upsertRun({ runId: 'r6', pipelineId: 'p6', title: 't', projectDir: PROJECT, status });
  ctx.window.location.hash = 'running/r6';
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(8);
  const btn = ctx.window.document.querySelector('#run-detail .rd-pause');
  assert.ok(btn, 'the live run page has its Pause/Resume button');
  const set = async (next) => { ctx.dispatch({ type: 'state', runId: 'r6', id: 'p6', status: next }); await ctx.settle(8); };
  return { btn, label: () => btn.textContent.trim(), set };
}

test('S8: saved paused run 6 reads "Resume after run 4" while the /slice answer has resumeAfter 4', async () => {
  const ctx = await bootSliceSix({ slice: WAITS() });
  const { btn, label } = await savedSix(ctx);
  assert.equal(label(), 'Resume after run 4');
  assert.equal(btn.querySelector('.hd-btn-label').textContent, 'Resume after run 4', 'the label span, so the icon stays');
  assert.equal(btn.disabled, false);
});

test('S8: saved paused run 6 reads "Resume" when the /slice answer has no resumeAfter (nothing works, or held)', async () => {
  for (const [why, slice] of [['nothing works', sliceSix()], ['held', sliceSix({ heldResume: { after: 4 } })]]) {
    const ctx = await bootSliceSix({ slice });
    const { label } = await savedSix(ctx);
    assert.equal(label(), 'Resume', why);
  }
});

test('S8: shape-feature frames relabel "Resume" to "Resume after run 4" when run 4 starts, and back when it finishes', async () => {
  for (const [page, open] of [['saved', savedSix], ['live', liveSix]]) {
    const ctx = await bootSliceSix();
    const { btn, label } = await open(ctx);
    assert.equal(label(), 'Resume', `${page}: nothing works`);
    ctx.box.slice = WAITS();
    await ctx.frame();
    assert.equal(label(), 'Resume after run 4', `${page}: run 4 started`);
    ctx.box.slice = sliceSix();
    await ctx.frame();
    assert.equal(label(), 'Resume', `${page}: run 4 finished`);
    assert.equal(btn.isConnected, true, `${page}: the same button`);
  }
});

test('S8: while the slice info loads, or /slice fails, the label stays "Resume" on .hd-resume and .rd-pause; a busy (Resuming…) button is never relabelled', async () => {
  const loading = () => new Promise(() => {});
  const failed = () => Promise.resolve(answer({ error: 'boom' }, 500));
  for (const [page, open] of [['saved', savedSix], ['live', liveSix]]) {
    for (const [why, slice] of [['loading', loading], ['failed', failed]]) {
      const ctx = await bootSliceSix({ slice });
      const { label } = await open(ctx);
      assert.equal(label(), 'Resume', `${page}, ${why}`);
      assert.ok(ctx.box.sliceGets > 0, `${page}, ${why}: the slice was asked for`);
    }
    // A known "Resume after run 4" is kept while the cleared info is read again, and when that read fails.
    for (const [why, slice] of [['loading', loading], ['failed', failed]]) {
      const ctx = await bootSliceSix({ slice: WAITS() });
      const { label, set } = await open(ctx);          // `set` only on the live page
      assert.equal(label(), 'Resume after run 4', `${page}: known`);
      ctx.box.slice = slice;
      await ctx.frame();
      if (set) await set('paused');                    // a repaint while the info is unknown
      assert.equal(label(), 'Resume after run 4', `${page}, re-read ${why}: no flicker`);
    }
    // Busy: the POST is pending, a frame brings new slice info.
    const ctx = await bootSliceSix({ slice: WAITS() });
    const { btn, label } = await open(ctx);
    assert.equal(label(), 'Resume after run 4', `${page}: before the press`);
    ctx.box.resume = new Promise(() => {});
    btn.click();
    await ctx.settle(5);
    assert.equal(label(), 'Resuming…', `${page}: pressed`);
    await ctx.frame();
    assert.equal(label(), 'Resuming…', `${page}: a frame does not relabel a busy button`);
    assert.equal(btn.disabled, true, page);
  }
  // A running run that pauses while its info is still loading: any label that is not a Resume becomes "Resume".
  const ctx = await bootSliceSix({ slice: loading });
  const live = await liveSix(ctx, 'running');
  assert.equal(live.label(), 'Pause');
  await live.set('paused');
  assert.equal(live.label(), 'Resume');
});

test('S8: the live run page\'s paused Resume (.rd-pause) reads "Resume after run 4", and "Pause" once running', async () => {
  const ctx = await bootSliceSix({ slice: WAITS() });
  const { btn, label, set } = await liveSix(ctx);
  assert.equal(label(), 'Resume after run 4');
  assert.equal(btn.querySelector('.rd-btn-label').textContent, 'Resume after run 4', 'the label span, so the icon stays');
  await set('running');
  assert.equal(label(), 'Pause');
});

test('S8: a held press reads "Resume" whatever the order', async () => {
  const held = { ok: true, held: true, pipelineId: 'p6', after: 4 };
  for (const [page, open] of [['saved', savedSix], ['live', liveSix]]) {
    for (const order of ['frame during the POST', 'answer before the frame']) {
      const where = `${page}, ${order}`;
      const ctx = await bootSliceSix({ slice: WAITS() });
      const { btn, label } = await open(ctx);
      assert.equal(label(), 'Resume after run 4', `${where}: before the press`);
      const post = deferred();
      ctx.box.resume = post.promise;
      btn.click();
      await ctx.settle(5);
      assert.equal(ctx.fetchCalls.filter((c) => c.url.includes('/api/resume')).length, 1, where);
      const holdFrame = async () => { ctx.box.slice = sliceSix({ heldResume: { after: 4 } }); await ctx.frame(); };
      if (order === 'frame during the POST') await holdFrame();
      post.resolve(answer(held));
      await ctx.settle(8);
      assert.equal(label(), 'Resume', `${where}: the held answer sets the label`);
      assert.equal(btn.disabled, false, where);
      assert.equal(btn.dataset.resumeState, undefined, `${where}: not busy`);
      if (order === 'answer before the frame') {
        await holdFrame();
        assert.equal(label(), 'Resume', `${where}: the frame agrees`);
      }
    }
  }
});

test('S8: flag off: the /slice stub answers resumeAfter 4, and the same paused run\'s .hd-resume and .rd-pause still read "Resume"', async () => {
  for (const [page, open] of [['saved', savedSix], ['live', liveSix]]) {
    const ctx = await bootSliceSix({ slice: WAITS(), flag: false });
    const { label } = await open(ctx);
    assert.equal(label(), 'Resume', page);
    await ctx.frame();
    assert.equal(label(), 'Resume', `${page}: after a frame`);
  }
});

// ── Slice 16 (R-qa-4): "More ways to resume" says the run waits for its turn; a held or refused press says why ─────
const MENU = { saved: '#hist-detail .hd-resume-menu .resume-on-saved small', live: '#run-detail .rd-resume-menu .resume-on-saved small' };
const SIX_PAGES = [['saved', savedSix], ['live', liveSix]];

test('s16: while run 6 is held after run 3, More ways to resume reads "Waiting for its turn after run 3", and "Where it left off" once the hold ends', async () => {
  for (const [page, open] of SIX_PAGES) {
    const ctx = await bootSliceSix({ slice: sliceSix({ heldResume: { after: 3 } }) });
    const { label } = await open(ctx);
    const small = () => ctx.window.document.querySelector(MENU[page]).textContent;
    assert.equal(small(), 'Waiting for its turn after run 3', `${page}: held`);
    assert.equal(label(), 'Resume', `${page}: the main Resume reads as today`);
    ctx.box.slice = sliceSix();
    await ctx.frame();
    assert.equal(small(), 'Where it left off', `${page}: the hold ended`);
    ctx.box.slice = sliceSix({ heldResume: { after: 3 } });
    await ctx.frame();
    assert.equal(small(), 'Waiting for its turn after run 3', `${page}: held again`);
  }
});

test('s16: flag off, More ways to resume keeps "Where it left off" though the /slice stub answers a hold', async () => {
  for (const [page, open] of SIX_PAGES) {
    const ctx = await bootSliceSix({ slice: sliceSix({ heldResume: { after: 3 } }), flag: false });
    await open(ctx);
    await ctx.frame();
    assert.equal(ctx.window.document.querySelector(MENU[page]).textContent, 'Where it left off', page);
  }
});

/** The toasts on screen, as {tone, title, detail, action}. */
const toasts = (ctx) => [...ctx.window.document.querySelectorAll('#toasts .toast')].map((t) => ({
  tone: ['info', 'ok', 'warn', 'err'].find((c) => t.classList.contains(c)),
  title: t.querySelector('.tt')?.textContent ?? '', detail: t.querySelector('.td')?.textContent ?? '',
  action: t.querySelector('.toast-act')?.textContent ?? null,
}));
/** Press the paused run's Resume on `open`'s page, POST /api/resume answering `body` with `status`. → the toasts */
async function pressSix(open, body, status = 200, boot = {}) {
  const ctx = await bootSliceSix(boot);
  const { btn } = await open(ctx);
  ctx.box.resume = Promise.resolve(answer(body, status));
  btn.click();
  await ctx.settle(8);
  assert.equal(ctx.fetchCalls.filter((c) => c.url.includes('/api/resume')).length, 1, 'one press, one POST');
  return toasts(ctx);
}
const HELD_SAVING = { ok: true, held: true, pipelineId: 'p6', after: 3, saving: true };
const HELD_TURN = { ok: true, held: true, pipelineId: 'p6', after: 3 };
const CLASHED = { error: 'runs 2 and 3 clash in a.mjs', code: 'TAKE_IN_REFUSED' };
const OVER_TOTAL = { error: 'total cost limit reached', budget: { blocked: true } };
const info = (title, detail) => ({ tone: 'info', title, detail, action: null });
const refusedToast = (detail) => ({ tone: 'err', title: 'Could not resume the run', detail, action: 'Retry' });

test('s16: a press held while run 3 saves says "Run 3 is still saving its work" in an info toast', async () => {
  for (const [page, open] of SIX_PAGES) {
    assert.deepEqual(await pressSix(open, HELD_SAVING), [info('Waiting', 'Run 3 is still saving its work')], page);
  }
});

test('s16: a press held behind run 3\'s turn says "Run 3 holds the turn" in an info toast', async () => {
  for (const [page, open] of SIX_PAGES) {
    assert.deepEqual(await pressSix(open, HELD_TURN), [info('Waiting for its turn', 'Run 3 holds the turn')], page);
  }
});

test('s16: a press refused on a clash says "Not resumed: runs 2 and 3 clash in a.mjs", with Retry', async () => {
  for (const [page, open] of SIX_PAGES) {
    assert.deepEqual(await pressSix(open, CLASHED, 409), [refusedToast('Not resumed: runs 2 and 3 clash in a.mjs')], page);
  }
});

test('s16: a press refused on cost says "Not resumed: the cost limit is reached", with Retry', async () => {
  for (const [page, open] of SIX_PAGES) {
    assert.deepEqual(await pressSix(open, OVER_TOTAL, 403), [refusedToast('Not resumed: the cost limit is reached')], page);
  }
});

test('s16: flag off, an unmarked run, or before the slice info loads, the press keeps today\'s toast and a hold raises none', async () => {
  const cases = [
    ['flag off', { flag: false }],
    ['not a slice', { slice: () => Promise.resolve(answer({ error: 'not a slice' }, 404)) }],
    ['the info still loading', { slice: () => new Promise(() => {}) }],
  ];
  for (const [why, boot] of cases) {
    for (const [page, open] of SIX_PAGES) {
      assert.deepEqual(await pressSix(open, OVER_TOTAL, 403, boot), [refusedToast('total cost limit reached')], `${page}, ${why}: cost`);
      assert.deepEqual(await pressSix(open, HELD_SAVING, 200, boot), [], `${page}, ${why}: held`);
    }
  }
});

test('s16: the hold\'s own feature frame clears the slice info before the reply lands, and the press still says why', async () => {
  for (const [page, open] of SIX_PAGES) {
    const ctx = await bootSliceSix();
    const { btn } = await open(ctx);
    // The server repaints the feature as it holds the resume: that frame (clearing SLICE_INFO) comes before the reply.
    let reply;
    ctx.box.resume = new Promise((r) => { reply = r; });
    ctx.box.slice = () => new Promise(() => {});   // the info is asked again and has not answered yet
    btn.click();
    await ctx.settle(4);
    await ctx.frame();
    reply(answer(HELD_TURN));
    await ctx.settle(8);
    assert.deepEqual(toasts(ctx), [info('Waiting for its turn', 'Run 3 holds the turn')], page);
  }
});

test('s16: right after a held press, More ways to resume reads "Waiting for its turn after run 3" though the frame cleared the info', async () => {
  for (const [page, open] of SIX_PAGES) {
    const ctx = await bootSliceSix();
    const { btn } = await open(ctx);
    let reply;
    ctx.box.resume = new Promise((r) => { reply = r; });
    ctx.box.slice = () => new Promise(() => {});   // the info, asked again after the frame, has not answered yet
    btn.click();
    await ctx.settle(4);
    await ctx.frame();
    reply(answer(HELD_TURN));
    await ctx.settle(8);
    assert.equal(ctx.window.document.querySelector(MENU[page]).textContent, 'Waiting for its turn after run 3', page);
  }
});
