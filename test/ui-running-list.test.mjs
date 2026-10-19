// test/ui-running-list.test.mjs — which live runs the Runs list contains, and the
// Needs-you group that replaced the "waiting on your answers" banner above it. Row
// anatomy is not this suite's business (see test/ui-running-card.test.mjs);
// membership is.
//
// boot() is a deliberate local copy of test/ui-running-order.test.mjs:14-50 and
// go() of test/ui-history-routing.test.mjs:93-96; live() is copied from
// test/ui-pipeline-tabs.test.mjs:38-41. The suites do not import each other.
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

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

const QUESTION = { id: 'q1', kind: 'clarify', questions: [{ question: 'which db?', options: ['pg'] }] };

// Live rows in their project groups (a Needs-you run is repeated above them: rule 6).
const rowIds = (window) =>
  [...window.document.querySelectorAll('#runs-list .runs-row[data-kind="live"]')].map((c) => c.dataset.runId);
const needsIds = (window) =>
  [...window.document.querySelectorAll('#runs-list .runs-sec[data-section="needs"] .runs-row')].map((c) => c.dataset.runId);
const needsOf = (window) => window.document.querySelector('#runs-list .runs-sec[data-section="needs"]');

test('workspace scans and agent generations are not listed as runs', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'runs');
  recv({ type: 'hello', runs: [
    live('scan-1', { kind: 'scan' }),
    live('gen-1', { kind: 'agentgen' }),
    live('pipe-1'),
    live('ws-1', { kind: 'workspace-run' }),
  ] });
  await tick();
  assert.deepEqual(rowIds(window).sort(), ['pipe-1', 'ws-1'],
    'only kind run | workspace-run render — the live rows are pipelines only');
});

// One boot: each hello re-lists the runs (upsert), then question-resolved frames.
test('Needs you: absent while nothing waits; leads the list with its count; runs leave it as their questions resolve and stay in their project groups', async () => {
  const { window, recv, tick } = await boot();
  go(window, 'runs');
  await checkRows([
    { name: 'Needs you stays absent while nothing is waiting', run: async () => {
      recv({ type: 'hello', runs: [live('pipe-1')] });
      await tick();
      assert.deepEqual(rowIds(window), ['pipe-1'], 'the run is listed');
      assert.equal(needsOf(window), null, 'no Needs-you group without a question or a pause');
    } },
    { name: 'one waiting pipeline is listed under Needs you, at the top of the list', run: async () => {
      recv({ type: 'hello', runs: [live('pipe-1', { pendingQuestion: QUESTION }), live('pipe-2')] });
      await tick();
      const needs = needsOf(window);
      assert.ok(needs, 'the Needs-you group renders');
      assert.equal(needs, window.document.getElementById('runs-list').firstElementChild, 'it leads the list');
      assert.deepEqual(needsIds(window), ['pipe-1'], 'only the asking run');
      assert.equal(needs.querySelector('.runs-sec-head .runs-count').textContent, '1');
      assert.deepEqual(rowIds(window).sort(), ['pipe-1', 'pipe-2'], 'both stay in their project group');
    } },
    { name: 'two waiting pipelines are both listed, and they leave Needs you as they are answered', run: async () => {
      recv({ type: 'hello', runs: [
        live('pipe-1', { pendingQuestion: QUESTION }),
        live('pipe-2', { pendingQuestion: { ...QUESTION, id: 'q2' } }),
      ] });
      await tick();
      assert.deepEqual(needsIds(window).sort(), ['pipe-1', 'pipe-2']);
      assert.equal(needsOf(window).querySelector('.runs-count').textContent, '2');

      recv({ type: 'question-resolved', runId: 'pipe-1', id: 'q1' });
      await tick();
      assert.deepEqual(needsIds(window), ['pipe-2']);
      assert.equal(needsOf(window).querySelector('.runs-count').textContent, '1');

      recv({ type: 'question-resolved', runId: 'pipe-2', id: 'q2' });
      await tick();
      assert.equal(needsOf(window), null, 'the group goes once nothing is waiting');
      assert.deepEqual(rowIds(window).sort(), ['pipe-1', 'pipe-2'], 'the runs stay listed');
    } },
  ]);
});
