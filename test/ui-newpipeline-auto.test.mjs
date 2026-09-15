// test/ui-newpipeline-auto.test.mjs — the New page under Auto (spec §7.2 / D19, D20, D24):
// the picker's client-side Auto entry, the Advanced "Human in the loop" switch and the run body.
// Boot preamble copied from test/ui-ask-card.test.mjs:41-112 (house convention: duplicated per
// suite), with a /api/config arm (that suite has none), a PATCH recorder and a run-body recorder.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

// jsdom windows are heavy (full DOM + timers). Close each after its test so the
// window and its timers are released, as ui-running-auto and ui-history-detail do.
const wins = [];
afterEach(() => { for (const w of wins.splice(0)) { try { w.close(); } catch { /* already closed */ } } });

async function bootWith(configExtra = {}, { url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;
  wins.push(window);
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  const patches = [];
  const runBodies = [];
  window.fetch = (u, opts) => {
    const url2 = String(u);
    calls.push({ url: url2, opts: opts || {} });
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const path = url2.split('?')[0];
    // METHOD-CHECKED arms first: a PATCH /api/config that fell into the GET arm would leave patches[] empty.
    if (path.endsWith('/api/config') && method === 'PATCH') {
      const body = JSON.parse(opts.body);
      patches.push(body);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { ...body } }) });
    }
    if (path.endsWith('/api/run') && method === 'POST') {
      runBodies.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'run-1' }) });
    }
    if (path.endsWith('/api/config')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [], activeWorkflowId: 'wf_auto', ...configExtra }, models: [], efforts: [] }) });
    }
    if (path.endsWith('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_a', name: 'A', version: 2 }] }) });
    }
    if (path.endsWith('/api/guardrails')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ guardrails: [{ id: 'permissive', name: 'Permissive' }, { id: 'normal', name: 'Normal' }] }) });
    }
    if (path.endsWith('/api/workspaces')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'wks-team-00000001', name: 'team', projectPaths: ['/repos/proj', '/repos/lib'], projectKeys: ['proj-00000001', 'lib-00000002'] }] }) });
    }
    if (path.endsWith('/api/branches')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: ['main', 'dev'], current: 'main' }) });
    }
    if (url2.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: 0, projects: 0, workspaces: 0 }) });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.lastProject', 'proj');

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  lastWs._l.open?.forEach((fn) => fn());
  await settle(window, 4);
  return { window, calls, patches, runBodies };
}
const boot = () => bootWith();

async function settle(window, n = 4) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

test('Auto is first, selected from activeWorkflowId, and never fetched as a workflow row', async () => {
  const { window, calls } = await boot();
  const sel = window.document.getElementById('workflowSelect');
  assert.deepEqual([...sel.options].map((o) => o.value), ['wf_auto', 'wf_default', 'wf_a']);
  assert.equal(sel.options[0].textContent, 'Auto');
  assert.equal(sel.value, 'wf_auto');
  assert.ok(!calls.some((c) => c.url.includes('/api/workflows/wf_auto')), 'the stub is never requested');
  assert.equal(window.document.getElementById('agents-config').hidden, true, 'agents accordion hidden under Auto');
  assert.equal(window.document.getElementById('agents-rows').innerHTML, '', 'no "Could not load this workflow." painted');
  assert.equal(window.document.getElementById('hitl-row').hidden, false);
  assert.equal(window.document.getElementById('humanInLoop').checked, true, 'default on (config omits the key)');
});

test('picking a saved workflow restores the accordion and hides the switch; picking Auto persists wf_auto', async () => {
  const { window, patches } = await boot();
  const sel = window.document.getElementById('workflowSelect');
  sel.value = 'wf_a'; sel.dispatchEvent(new window.Event('change')); await settle(window);
  assert.equal(window.document.getElementById('agents-config').hidden, false);
  assert.equal(window.document.getElementById('hitl-row').hidden, true);
  sel.value = 'wf_auto'; sel.dispatchEvent(new window.Event('change')); await settle(window);
  assert.deepEqual(patches.at(-1), { projectDir: '/repos/proj', activeWorkflowId: 'wf_auto' });
});

test('the switch persists humanInLoop and the run body carries it under Auto only', async () => {
  const { window, patches, runBodies } = await boot();
  const cb = window.document.getElementById('humanInLoop');
  cb.checked = false; cb.dispatchEvent(new window.Event('change')); await settle(window);
  assert.deepEqual(patches.at(-1), { projectDir: '/repos/proj', humanInLoop: false });
  window.document.getElementById('prompt').value = 'demo task';
  window.document.getElementById('run-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle(window);
  assert.equal(runBodies.at(-1).workflowId, 'wf_auto'); assert.equal(runBodies.at(-1).humanInLoop, false);
  const sel = window.document.getElementById('workflowSelect');
  sel.value = 'wf_default'; sel.dispatchEvent(new window.Event('change')); await settle(window);
  window.document.getElementById('run-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle(window);
  assert.equal('humanInLoop' in runBodies.at(-1), false, 'a saved workflow sends no humanInLoop');
});

test('a workspace target disables Auto with the hint and shows Default WITHOUT persisting it (D19)', async () => {
  const { window, patches } = await boot();
  window.document.querySelector('#target-seg button[data-target="workspace"]').click(); await settle(window, 6);
  const sel = window.document.getElementById('workflowSelect');
  assert.equal(sel.options[0].disabled, true);
  assert.equal(sel.options[0].title, 'Auto is not available for workspaces yet');
  assert.equal(sel.value, 'wf_default');
  assert.ok(!patches.some((p) => p.activeWorkflowId), 'the fallback is never written');
  window.document.querySelector('#target-seg button[data-target="project"]').click(); await settle(window, 6);
  assert.equal(sel.value, 'wf_auto', 'back on a project the stored choice returns');
});

test('a project whose config turned the switch off boots with it off', async () => {
  const { window } = await bootWith({ humanInLoop: false });
  assert.equal(window.document.getElementById('humanInLoop').checked, false);
});

// humanInLoop is stored PER PROJECT, and saveHumanInLoop drops the write when none is
// selected — the same reason the agents accordion disables its rows there. An enabled
// switch would accept a flip, discard it, and read as "the control doesn't work".
test('with no project selected the switch is disabled and nothing is written', async () => {
  const { window, patches } = await boot();
  const cb = window.document.getElementById('humanInLoop');
  assert.equal(cb.disabled, false, 'a project is selected at boot');
  const projects = window.document.getElementById('projectSelect');
  projects.value = ''; projects.dispatchEvent(new window.Event('change')); await settle(window, 6);
  assert.equal(cb.disabled, true, 'no project ⇒ nowhere to write it');
  const before = patches.length;
  cb.checked = false; cb.dispatchEvent(new window.Event('change')); await settle(window);
  assert.equal(patches.length, before, 'no PATCH for a project-less flip');
});
