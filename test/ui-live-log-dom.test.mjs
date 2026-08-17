// test/ui-live-log-dom.test.mjs — the live run card's log pane, driven through
// window.__np rather than the socket. Harness is a verbatim copy of bootLive
// from test/ui-running-resume.test.mjs (that helper is file-private).
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
    if (String(url).includes('/log')) {
      return Promise.resolve({ ok: true, status: 200, text: async () =>
        '{"source":"planner","level":"info","text":"pass one","ts":"2026-08-17T00:00:01Z","stepIndex":0,"cycle":1}\n' +
        '{"source":"implementer","level":"warn","text":"429, retrying","ts":"2026-08-17T00:00:02Z","stepIndex":1,"cycle":2,"stream":"err"}\n' });
    }
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

test('live pane draws the Cycle rule even when an artifact line sits at the boundary', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  onLog(r, { source: 'reviewer', level: 'info', text: 'blocking issue', ts: Date.now(), stepIndex: 1, cycle: 1 });
  onLog(r, { source: 'artifact', level: 'artifact', text: 'review: r.md', ts: Date.now() });   // cycle-less
  onLog(r, { source: 'implementer', level: 'info', text: 'fixing', ts: Date.now(), stepIndex: 1, cycle: 2 });
  const pane = r.el.querySelector('.log');
  const seps = pane.querySelectorAll('.log-sep');
  assert.equal(seps.length, 1, 'boundary survives the cycle-less neighbor');
  assert.equal(seps[0].textContent, 'Cycle 2');
  assert.equal(pane.querySelectorAll('.log-line').length, 3);
});

test('the DOM cap counts record lines — separators do not cause over-eviction', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r-cap', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  for (let i = 0; i < 4000; i++) {
    onLog(r, { source: 'planner', level: 'info', text: `l${i}`, ts: 0, stepIndex: 0, cycle: 1 });
  }
  onLog(r, { source: 'implementer', level: 'info', text: 'first of cycle 2', ts: 0, stepIndex: 0, cycle: 2 });
  const pane = r.el.querySelector('.log');
  // 4001 records + 1 separator entered; the cap must evict exactly ONE record.
  assert.equal(pane.querySelectorAll('.log-line').length, 4000, 'record cap, not childElementCount');
  assert.equal(pane.querySelectorAll('.log-sep').length, 1, 'the mid-pane separator survives');
  assert.match(pane.querySelector('.log-line').textContent, /l1$/, 'only the oldest record evicted');
});

test('eviction never leaves a separator leading the pane', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r-lead', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  onLog(r, { source: 'planner', level: 'info', text: 'only cycle-1 line', ts: 0, stepIndex: 0, cycle: 1 });
  for (let i = 0; i < 4000; i++) {
    onLog(r, { source: 'implementer', level: 'info', text: `c2-${i}`, ts: 0, stepIndex: 0, cycle: 2 });
  }
  const pane = r.el.querySelector('.log');
  assert.equal(pane.querySelectorAll('.log-line').length, 4000);
  assert.ok(pane.firstElementChild.classList.contains('log-line'),
    'the now-boundary-less "Cycle 2" rule was dropped with its predecessor');
  assert.equal(pane.querySelectorAll('.log-sep').length, 0);
});
