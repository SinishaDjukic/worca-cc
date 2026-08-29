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

test('card rebuild keeps the search term when a dropdown selection vanishes', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r-search', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  onLog(r, { source: 'planner', level: 'info', text: 'an error appeared', ts: 0, stepIndex: 0, cycle: 1 });
  onLog(r, { source: 'planner', level: 'info', text: 'all good', ts: 0, stepIndex: 0, cycle: 1 });
  // User had cycle '7' + search 'error'; the cycle rotated out of the facets.
  r.logFilter = { source: '', level: '', step: '', cycle: '7', search: 'error' };
  // Finish/resume rebuilds the card: the stale cycle falls back to "all"…
  r.el = buildRunCard(r);
  assert.equal(r.logFilter.cycle, '', 'vanished cycle falls back to all');
  assert.equal(r.logFilter.search, 'error', 'free text has no facet to vanish — must survive');
  assert.equal(r.el.querySelector('.log-search').value, 'error', 'rebuilt box shows the active term');
  const lines = r.el.querySelectorAll('.log .log-line');
  assert.equal(lines.length, 1, 'pane still narrowed by the term');
  assert.match(lines[0].textContent, /an error appeared/);
});

// -------------------------------------------------------------------- MIN-37
// v2 `cycle` is the PER-NODE ordinal (orchestrator.mjs stamps `cycle: ordinal`
// alongside `nodeId`), so alternating between two concurrently-streaming nodes
// used to draw a rule on almost every line. The live pane and the clipboard
// must agree, and both must count per node.
test('MIN-37: interleaved nodes at different ordinals draw no separator in the live pane', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r-min37', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  const lines = [
    { source: 'implementer', text: 'patching a.js', nodeId: 'n_impl', executionId: 'x:n_impl:2', cycle: 2 },
    { source: 'tester', text: 'running suite', nodeId: 'n_test', executionId: 'x:n_test:1', cycle: 1 },
    { source: 'implementer', text: 'patching b.js', nodeId: 'n_impl', executionId: 'x:n_impl:2', cycle: 2 },
    { source: 'tester', text: '12 passed', nodeId: 'n_test', executionId: 'x:n_test:1', cycle: 1 },
    { source: 'implementer', text: 'done', nodeId: 'n_impl', executionId: 'x:n_impl:2', cycle: 2 },
  ];
  for (const l of lines) onLog(r, { level: 'info', ts: Date.now(), ...l });
  const pane = r.el.querySelector('.log');
  assert.equal(pane.querySelectorAll('.log-line').length, 5);
  assert.equal(pane.querySelectorAll('.log-sep').length, 0, 'no rewind happened — no rule');
});

test('MIN-37: a node re-running draws exactly one rule, before ITS higher-ordinal line', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog } = window.__np;
  const r = upsertRun({ runId: 'r-min37b', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  onLog(r, { source: 'refiner', level: 'info', text: 'refining', ts: Date.now(), nodeId: 'n_refine', cycle: 1 });
  onLog(r, { source: 'refiner', level: 'info', text: 'refining again', ts: Date.now(), nodeId: 'n_refine', cycle: 2 });
  onLog(r, { source: 'implementer', level: 'info', text: 'implementing', ts: Date.now(), nodeId: 'n_impl', cycle: 1 });
  const pane = r.el.querySelector('.log');
  const seps = pane.querySelectorAll('.log-sep');
  assert.equal(seps.length, 1);
  assert.equal(seps[0].textContent, 'Cycle 2');
  assert.equal(seps[0].nextElementSibling.textContent.includes('refining again'), true,
    'the rule sits directly above the refiner\'s ordinal-2 line');
});

test('MIN-37: a filter repaint and the live stream agree on the per-node cursor', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onLog, paintLogFilters } = window.__np;
  const r = upsertRun({ runId: 'r-min37c', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  onLog(r, { source: 'refiner', level: 'info', text: 'a', ts: Date.now(), nodeId: 'n_refine', cycle: 1 });
  onLog(r, { source: 'tester', level: 'info', text: 'b', ts: Date.now(), nodeId: 'n_test', cycle: 1 });
  paintLogFilters(r);                                  // full wipe + rebuild from the model
  onLog(r, { source: 'tester', level: 'info', text: 'c', ts: Date.now(), nodeId: 'n_test', cycle: 1 });
  onLog(r, { source: 'refiner', level: 'info', text: 'd', ts: Date.now(), nodeId: 'n_refine', cycle: 2 });
  const pane = r.el.querySelector('.log');
  const seps = pane.querySelectorAll('.log-sep');
  assert.equal(seps.length, 1, 'exactly one rule survives the repaint boundary');
  assert.equal(seps[0].textContent, 'Cycle 2');
});
