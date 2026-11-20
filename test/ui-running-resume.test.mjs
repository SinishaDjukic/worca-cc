// test/ui-running-resume.test.mjs — resume a live run from its page (the pane's
// `#run-detail .rd-pause`, which reads Resume once the run is paused) for a run whose
// whole lifetime is inside the current socket session (no page reload, so no
// hello re-seed of pipelineId). Harness mirrors test/ui-pause-resume.test.mjs.
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

async function bootLive({ resumeFails = false, baseMoved = false } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
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
    if (String(url).includes('/log')) {
      return Promise.resolve({ ok: true, status: 200, text: async () =>
        '{"source":"planner","level":"info","text":"pass one","ts":"2026-08-17T00:00:01Z","stepIndex":0,"cycle":1}\n' +
        '{"source":"implementer","level":"warn","text":"429, retrying","ts":"2026-08-17T00:00:02Z","stepIndex":1,"cycle":2,"stream":"err"}\n' });
    }
    if (String(url).includes('/api/resume')) {
      if (baseMoved && !JSON.parse(opts.body).baseAck) {
        return Promise.resolve({ ok: false, status: 409, json: async () => ({ code: 'base-moved', error: 'dev moved',
          members: [{ projectKey: 'k', base: 'dev', remote: 'origin', exists: true, movedBy: 5 }] }) });
      }
      if (resumeFails) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'pipeline not found' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'r-new', pipelineId: 'p1' }) });
    }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const go = (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, fetchCalls, go, settle };
}

// One boot: the same-session run r1 captures its id, then pauses and resumes.
test('onState mirrors the pipeline id (an id-less snapshot never clobbers it) and a same-session paused run resumes via POST /api/resume {pipelineId, baseCheck}', async () => {
  const { window, fetchCalls } = await bootLive();
  const { upsertRun, onState, resumeRunFromCard, getRun } = window.__np;
  await checkRows([
    { name: 'onState mirrors the pipeline short id from state.id onto the run model', run: async () => {
      const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
      assert.equal(r.pipelineId, null);
      onState(r, { status: 'running', id: 'p1' });
      assert.equal(r.pipelineId, 'p1');
      // An id-less snapshot (pre-createPipeline shape) must not clobber the captured id.
      onState(r, { status: 'running', id: null });
      assert.equal(r.pipelineId, 'p1');
    } },
    { name: 'resume works for a same-session run (no reload)', run: async () => {
      // Born in THIS session (beginRun/upsertRun path) → pipelineId starts null.
      const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
      onState(r, { status: 'running', id: 'p1' });   // live state snapshot carries the id
      onState(r, { status: 'paused' });               // pause lands
      await resumeRunFromCard('r1');
      const call = fetchCalls.find((c) => c.url.includes('/api/resume'));
      assert.ok(call, 'resume must reach POST /api/resume (was: client-side "run has no pipelineId" bail)');
      assert.deepEqual(JSON.parse(call.opts.body), { pipelineId: 'p1', baseCheck: true });
      // The old paused run is superseded by the resumed live run.
      assert.equal(getRun('r1'), undefined);
      assert.ok(getRun('r-new'));
      assert.equal(getRun('r-new').pipelineId, 'p1');
    } },
  ]);
});

test('a 409 base-moved asks, then resends with baseAck and every option of the call (#527)', async () => {
  const { window, fetchCalls } = await bootLive({ baseMoved: true });
  const { upsertRun, onState, resumeRunFromCard, getRun } = window.__np;
  const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  onState(r, { status: 'running', id: 'p1' });
  onState(r, { status: 'paused' });
  const done = resumeRunFromCard('r1', null, { ignoreCostCap: true });
  for (let i = 0; i < 5; i++) await new Promise((res) => setTimeout(res, 0));
  const doc = window.document;
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false, 'the base move is confirmed first');
  assert.match(doc.querySelector('#confirm-message').textContent, /dev moved 5 commits on origin since this run started/);
  doc.querySelector('#confirm-ok').click();
  await done;
  const bodies = fetchCalls.filter((c) => c.url.includes('/api/resume')).map((c) => JSON.parse(c.opts.body));
  assert.deepEqual(bodies, [
    { pipelineId: 'p1', baseCheck: true, ignoreCostCap: true },
    { pipelineId: 'p1', baseCheck: true, baseAck: true, ignoreCostCap: true },
  ]);
  assert.ok(getRun('r-new'), 'the acknowledged resend resumes the run');
});

test('while the base-moved question is open the button reads Resume again (disabled); Cancel re-enables it (#527)', async () => {
  const { window, go, settle } = await bootLive({ baseMoved: true });
  const { upsertRun, onState, resumeRunFromCard, getRun } = window.__np;
  const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  onState(r, { status: 'running', id: 'p1' });
  onState(r, { status: 'paused' });
  go('running/r1');
  await settle();
  const btn = window.document.querySelector('#run-detail .rd-pause');
  assert.equal(btn.dataset.action, 'resume', 'a paused run offers Resume');
  const before = btn.innerHTML;
  const done = resumeRunFromCard('r1', btn);
  for (let i = 0; i < 5; i++) await new Promise((res) => setTimeout(res, 0));
  const doc = window.document;
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false, 'the question is open');
  assert.doesNotMatch(btn.textContent, /Resuming/, 'nothing is resuming while the person decides');
  assert.equal(btn.innerHTML, before, 'the Resume label and icon are back');
  assert.equal(btn.disabled, true, 'no second click while the question is open');
  doc.querySelector('#confirm-cancel').click();
  await done;
  assert.equal(btn.disabled, false);
  assert.ok(getRun('r1'), 'Cancel leaves the run paused');
});

test('failed resume restores the Resume button: enabled, icon intact, error logged', async () => {
  const { window, go, settle } = await bootLive({ resumeFails: true });
  const { upsertRun, onState, resumeRunFromCard, getRun } = window.__np;
  const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  onState(r, { status: 'running', id: 'p1' });
  onState(r, { status: 'paused' });
  go('running/r1');
  await settle();
  // The pane's one Pause/Resume control; paintRdHeader flips it to Resume on a paused run.
  const btn = window.document.querySelector('#run-detail .rd-pause');
  assert.ok(btn, 'the run page carries the control');
  assert.equal(btn.dataset.action, 'resume', 'a paused run offers Resume');
  assert.equal(btn.hidden, false);
  await resumeRunFromCard('r1', btn);
  assert.ok(getRun('r1'), 'failed resume must keep the paused run');
  assert.equal(btn.disabled, false, 'button must be re-enabled after failure');
  assert.match(btn.innerHTML, /<svg/i, 'failure must restore the play icon, not leave bare text');
  assert.equal(btn.querySelector('.rd-btn-label')?.textContent, 'Resume', 'and its label, not " Resuming…"');
  assert.match(btn.title, /Resume/, 'failure keeps the Resume tooltip too');
  assert.ok(
    r.logLines.some((l) => /resume failed: pipeline not found/.test(String(l.text))),
    'server error must land in the run log'
  );
});

test('seedResumedLog re-hydrates cycle and stream from the persisted NDJSON', async () => {
  const { window } = await bootLive();
  const { upsertRun, seedResumedLog, getRun } = window.__np;
  upsertRun({ runId: 'r-new', title: 't', projectDir: '/tmp/proj', status: 'starting' });
  await seedResumedLog('r-new', null, '/api/history/p1/log');
  const lines = getRun('r-new').logLines;
  assert.ok(lines.some((l) => l.cycle === 2), 'cycle survives the seed projection');
  assert.ok(lines.some((l) => l.stream === 'err'), 'stderr provenance survives the seed projection');
});
