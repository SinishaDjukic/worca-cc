// test/ui-running-resume.test.mjs — resume from the Running card for a run whose
// whole lifetime is inside the current socket session (no page reload, so no
// hello re-seed of pipelineId). Harness mirrors test/ui-pause-resume.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function bootLive({ resumeFails = false } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
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
    if (String(url).includes('/api/resume')) {
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
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window, fetchCalls };
}

test('onState mirrors the pipeline short id from state.id onto the run model', async () => {
  const { window } = await bootLive();
  const { upsertRun, onState } = window.__np;
  const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  assert.equal(r.pipelineId, null);
  onState(r, { status: 'running', id: 'p1' });
  assert.equal(r.pipelineId, 'p1');
  // An id-less snapshot (pre-createPipeline shape) must not clobber the captured id.
  onState(r, { status: 'running', id: null });
  assert.equal(r.pipelineId, 'p1');
});

test('resume works from the Running card for a same-session run (no reload)', async () => {
  const { window, fetchCalls } = await bootLive();
  const { upsertRun, onState, resumeRunFromCard, getRun } = window.__np;
  // Born in THIS session (beginRun/upsertRun path) → pipelineId starts null.
  const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  onState(r, { status: 'running', id: 'p1' });   // live state snapshot carries the id
  onState(r, { status: 'paused' });               // pause lands
  await resumeRunFromCard('r1');
  const call = fetchCalls.find((c) => c.url.includes('/api/resume'));
  assert.ok(call, 'resume must reach POST /api/resume (was: client-side "run has no pipelineId" bail)');
  assert.deepEqual(JSON.parse(call.opts.body), { pipelineId: 'p1' });
  // The old paused run is superseded by the resumed live run.
  assert.equal(getRun('r1'), undefined);
  assert.ok(getRun('r-new'));
  assert.equal(getRun('r-new').pipelineId, 'p1');
});

test('failed resume restores the Resume button: enabled, icon intact, error logged', async () => {
  const { window } = await bootLive({ resumeFails: true });
  const { upsertRun, onState, buildRunCard, resumeRunFromCard, getRun } = window.__np;
  const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  onState(r, { status: 'running', id: 'p1' });
  onState(r, { status: 'paused' });
  r.el = buildRunCard(r);
  const btn = r.el.querySelector('.btn-resume');
  await resumeRunFromCard('r1', btn);
  assert.ok(getRun('r1'), 'failed resume must keep the paused run');
  assert.equal(btn.disabled, false, 'button must be re-enabled after failure');
  assert.match(btn.innerHTML, /<svg/i, 'failure must restore the play icon, not leave bare text');
  assert.match(btn.textContent, /Resume/);
  assert.ok(
    r.logLines.some((l) => /resume failed: pipeline not found/.test(String(l.text))),
    'server error must land in the card log'
  );
});
