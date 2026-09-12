// test/ui-memory-view.test.mjs — full-app-boot jsdom tests for the Settings → Memory tab, the
// memory-changed frame, the New-Pipeline Memory scope control and the Ask card handoff
// (agent-memory-design.md §10, §7.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './helpers/confirm-modal.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const HEALTH = { files: 1, bytes: 40, oversized: 0, overHard: 0, invalidFrontmatter: 0, indexDropped: 0, writesSinceDefrag: 2, lastWriteAt: '2026-09-09T10:00:00.000Z', lastDefragAt: null, lastDefragRunId: null, level: 'ok', reasons: [] };
const FILE = { name: 'testing', description: 'How the suite runs', paths: ['test/**'], source: 'user', updated: '2026-09-09T10:00:00.000Z', bytes: 40, hasFrontmatter: true };
const REPORT = { scope: 'global', project: null, files: [FILE], state: {}, health: HEALTH, defragRunId: null };
const FILE_BODY = { name: 'testing', text: '---\nname: testing\ndescription: How the suite runs\n---\nnpm ci first.\n', meta: FILE, body: 'npm ci first.\n' };
const PROJECTS = [{ key: 'alpha-00000001', name: 'alpha', path: '/Users/me/dev/alpha', exists: true }];
const WORKFLOWS = [
  { id: 'wf_default', name: 'Default', version: 2, nodes: [], wires: [] },
  { id: 'wf_memory_defrag', name: 'Memory defragment', version: 2, domain: 'shared', nodes: [], wires: [] },
];
const GUARDRAILS = [{ id: 'permissive', name: 'Permissive' }, { id: 'normal', name: 'Normal' }];

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
  _message(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}

const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function boot({ fetchHandler, projects = PROJECTS } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const calls = [];
  window.fetch = (url, opts) => {
    const u = String(url); const o = opts || {};
    const method = (o.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: o.body ? JSON.parse(o.body) : null, headers: o.headers || null });
    if (fetchHandler) { const r = fetchHandler(u, o); if (r) return r; }
    if (u.includes('/api/memory/global/files/testing')) {
      if (method !== 'GET') return json({ ok: true, name: 'testing' });
      return json(FILE_BODY);
    }
    if (u.includes('/api/memory/global/files/')) {
      if (method !== 'GET') return json({ ok: true });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'memory file not found' }) });
    }
    if (u.includes('/api/memory/global/history')) {
      if (method !== 'GET') return json({ ok: true });
      return json({ snapshots: [{ id: '20260909-100000-user', files: ['testing.md'] }] });
    }
    if (u.includes('/api/memory/global/defragment')) return json({ runId: 'defrag-run-1' });
    if (u.includes('/api/memory/global')) return json(REPORT);
    if (u.includes('/api/projects')) return json({ projects });
    if (u.endsWith('/api/workflows')) return json({ workflows: WORKFLOWS });
    if (u.includes('/api/workflows/')) return json(WORKFLOWS.find((w) => u.endsWith(w.id)) || WORKFLOWS[0]);
    if (u.includes('/api/agents')) return json({ agents: [], channels: [] });
    if (u.includes('/api/workspaces')) return json({ workspaces: [] });
    if (u.includes('/api/guardrails')) return json({ guardrails: GUARDRAILS });
    if (u.includes('/api/run') && method === 'POST') return json({ runId: 'run-uuid-1' });
    if (u.includes('/api/branches')) return json({ branches: ['main'], current: 'main' });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  // The app restores the last project from localStorage; without it nothing is selected and both
  // the global defragment host and the New-Pipeline submit would be refused.
  window.localStorage.setItem('worca-cc.lastProject', 'alpha');
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  await tick(); await tick();
  return { window, calls };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));
// jsdom does NOT fire hashchange on a `location.hash =` assignment.
async function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick();
}
const memPane = (window) => window.document.querySelector('.settings-pane[data-tab="memory"]');
const getCount = (calls) => calls.filter((c) => c.url.endsWith('/api/memory/global') && c.method === 'GET').length;

test('index.html: the Memory tab + pane exist, with the ids the controller mounts on, and no new routed view', () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('data-tab="memory"'));
  assert.ok(html.includes('id="memory-host"') && html.includes('id="memory-msg"'));
  assert.equal((html.match(/data-view/g) || []).length, 11, 'a tab, not a view');
  assert.ok(html.includes('id="memory-scope-row"') && html.includes('id="memory-scope-seg"'), 'the picker control');
  assert.match(html, /id="memory-scope-seg" role="group" aria-label="Memory scope"/);
});

test('#settings/memory paints the health card, the file list and the history from the API', async () => {
  const { window, calls } = await boot();
  await go(window, 'settings/memory');
  const pane = memPane(window);
  assert.equal(pane.classList.contains('hidden'), false);
  assert.ok(calls.some((c) => c.url.endsWith('/api/memory/global') && c.method === 'GET'));
  assert.equal(pane.querySelector('.mem-health .badge').textContent, 'Healthy');
  assert.deepEqual([...pane.querySelectorAll('.mem-row')].map((r) => r.dataset.name), ['testing']);
  assert.deepEqual([...pane.querySelectorAll('.mem-snap')].map((r) => r.dataset.id), ['20260909-100000-user']);
  assert.equal(pane.querySelector('.mem-editor'), null, 'nothing selected yet');
  assert.equal(pane.querySelector('.mem-defrag').disabled, false, 'a registered project hosts the global run');
  assert.equal(pane.querySelector('.mem-host-hint').textContent, 'Runs on alpha — pick another project on the New pipeline page.');
  // GET with no body sends no content-type (request shapes stay byte-identical to the other fetches).
  const get = calls.find((c) => c.url.endsWith('/api/memory/global') && c.method === 'GET');
  assert.equal(get.headers, null, 'no content-type on a body-less request');
});

test('with NO project registered the Defragment button is disabled and says why', async () => {
  const { window } = await boot({ projects: [] });
  await go(window, 'settings/memory');
  const pane = memPane(window);
  assert.equal(pane.querySelector('.mem-defrag').disabled, true);
  assert.equal(pane.querySelector('.mem-host-hint').textContent, 'Register a project on the Projects page to host the global defragment run.');
});

test('#settings/memory/<name> opens the editor; Save PUTs the text; Delete confirms then DELETEs and routes back', async () => {
  const { window, calls } = await boot();
  await go(window, 'settings/memory/testing');
  const pane = memPane(window);
  const ed = pane.querySelector('.mem-editor');
  assert.ok(ed, 'the deep link opened the editor');
  assert.equal(ed.querySelector('.mem-name').value, 'testing');
  assert.ok(ed.querySelector('.mem-text').value.startsWith('---\nname: testing\n'));
  assert.ok(pane.querySelector('.mem-row[data-name="testing"]').classList.contains('on'));
  ed.querySelector('.mem-text').value = '---\nname: testing\ndescription: Tests\n---\nedited\n';
  click(window, ed.querySelector('.mem-save'));
  await tick(); await tick(); await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url.endsWith('/api/memory/global/files/testing'), true);
  assert.deepEqual(put.body, { text: '---\nname: testing\ndescription: Tests\n---\nedited\n' });
  const msgEl = window.document.getElementById('memory-msg');
  assert.match(msgEl.textContent, /Saved testing\.md/, 'the success message survives the reload');
  assert.ok(msgEl.classList.contains('ok'));
  click(window, memPane(window).querySelector('.mem-delete'));
  const message = await confirmDialog(window);
  assert.match(message, /Delete “testing\.md”/);
  await tick(); await tick();
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del && del.url.endsWith('/api/memory/global/files/testing'));
  assert.equal(window.location.hash, '#settings/memory', 'back to the list route');
});

test('New file: an editable name, a client-side name check, then Save PUTs to that name and routes to it', async () => {
  const { window, calls } = await boot();
  await go(window, 'settings/memory');
  const pane = memPane(window);
  click(window, pane.querySelector('.mem-new'));
  await tick();
  const ed = pane.querySelector('.mem-editor');
  assert.equal(ed.querySelector('.mem-name').readOnly, false);
  ed.querySelector('.mem-name').value = 'bad name';
  ed.querySelector('.mem-text').value = 'x\n';
  click(window, ed.querySelector('.mem-save'));
  await tick();
  assert.match(pane.querySelector('.mem-msg').textContent, /letters, digits/);
  assert.ok(!calls.some((c) => c.method === 'PUT'), 'no request for an invalid name');
  // The refused save repainted the host: the first editor node is detached now.
  const ed2 = pane.querySelector('.mem-editor');
  ed2.querySelector('.mem-name').value = 'new-topic';
  ed2.querySelector('.mem-text').value = 'x\n';
  click(window, ed2.querySelector('.mem-save'));
  await tick(); await tick(); await tick();
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put && put.url.endsWith('/api/memory/global/files/new-topic'));
  assert.equal(window.location.hash, '#settings/memory/new-topic', 'a saved new file routes to itself');
});

test('New file then Cancel clears the editor even though the hash never changed', async () => {
  const { window } = await boot();
  await go(window, 'settings/memory');
  const pane = memPane(window);
  click(window, pane.querySelector('.mem-new'));
  await tick();
  assert.ok(pane.querySelector('.mem-editor'));
  click(window, pane.querySelector('.mem-cancel'));
  await tick();
  assert.equal(pane.querySelector('.mem-editor'), null, 'the editor is gone without a hashchange');
  assert.equal(window.location.hash, '#settings/memory');
});

test('a row opens its file by click and by Enter, and the repaint puts focus back on the row', async () => {
  const { window } = await boot();
  await go(window, 'settings/memory');
  click(window, memPane(window).querySelector('.mem-row'));
  await tick(); await tick(); await tick();
  assert.equal(window.location.hash, '#settings/memory/testing');
  assert.ok(memPane(window).querySelector('.mem-editor'), 'the click opened the file');
  await go(window, 'settings/memory');
  const row = memPane(window).querySelector('.mem-row');
  row.focus();
  row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick(); await tick(); await tick();
  assert.ok(memPane(window).querySelector('.mem-editor'), 'Enter opened the file');
  assert.equal(window.document.activeElement.dataset.name, 'testing', 'focus survived the repaint');
});

test('a memory-changed frame for global refetches the open tab; other scopes and other views do not', async () => {
  const { window, calls } = await boot();
  await go(window, 'settings/memory');
  const before = getCount(calls);
  WSStub.last._message({ type: 'memory-changed', scope: 'projects/alpha-00000001' });
  await tick(); await tick();
  assert.equal(getCount(calls), before, 'another scope: no refetch');
  WSStub.last._message({ type: 'memory-changed', scope: 'global' });
  await tick(); await tick();
  assert.equal(getCount(calls), before + 1, 'the open tab refetched');
  await go(window, 'settings/guardrails');
  const after = getCount(calls);
  WSStub.last._message({ type: 'memory-changed', scope: 'global' });
  await tick(); await tick();
  assert.equal(getCount(calls), after, 'not open: no refetch');
});

test('leaving the tab destroys the controller: the host is empty and a later frame paints nothing', async () => {
  const { window } = await boot();
  await go(window, 'settings/memory');
  assert.ok(window.document.getElementById('memory-host').childNodes.length > 0);
  await go(window, 'settings/guardrails');
  assert.equal(window.document.getElementById('memory-host').childNodes.length, 0, 'destroy() emptied the host');
});

test('a memory-changed frame never clobbers a dirty editor — it warns instead', async () => {
  const { window } = await boot();
  await go(window, 'settings/memory/testing');
  const pane = memPane(window);
  pane.querySelector('.mem-text').value = 'my unsaved edit\n';
  WSStub.last._message({ type: 'memory-changed', scope: 'global' });
  await tick(); await tick(); await tick();
  assert.equal(memPane(window).querySelector('.mem-text').value, 'my unsaved edit\n', 'the edit survived');
  const msg = window.document.getElementById('memory-msg');
  assert.match(msg.textContent, /changed on disk while you were editing/);
  assert.ok(msg.classList.contains('warn'));
  // A SECOND frame (a burst of remembers, a run end) must not "forget" that the editor is dirty.
  await new Promise((r) => setTimeout(r, 300));
  WSStub.last._message({ type: 'memory-changed', scope: 'global' });
  await new Promise((r) => setTimeout(r, 300));
  await tick(); await tick(); await tick();
  assert.equal(memPane(window).querySelector('.mem-text').value, 'my unsaved edit\n', 'the edit survived the second frame too');
});

test('two loads in flight: the LAST one issued wins, whatever order the responses land in', async () => {
  let slow = true;
  const { window } = await boot({
    fetchHandler: (u, o) => {
      if (slow && u.endsWith('/api/memory/global') && (o.method || 'GET') === 'GET') {
        slow = false;
        return new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: async () => REPORT }), 25));
      }
      return null;
    },
  });
  window.location.hash = 'settings/memory/testing';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick();
  await go(window, 'settings/memory');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(memPane(window).querySelector('.mem-editor'), null, 'the stale load did not repaint the editor');
});

test('a stale load whose FILE response lands last never repaints the editor', async () => {
  let slow = true;
  const { window } = await boot({
    fetchHandler: (u, o) => {
      if (slow && u.includes('/api/memory/global/files/testing') && (o.method || 'GET') === 'GET') {
        slow = false;
        return new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: async () => FILE_BODY }), 25));
      }
      return null;
    },
  });
  window.location.hash = 'settings/memory/testing';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick();
  await go(window, 'settings/memory');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(memPane(window).querySelector('.mem-editor'), null, 'the late file response was dropped');
  assert.equal(memPane(window).querySelector('.mem-row.on'), null, 'and it selected no row');
});

test('a malformed escape in the hash is not decoded and does not throw', async () => {
  const { window } = await boot();
  await go(window, 'settings/memory/%E0%A4%A');
  const pane = memPane(window);
  assert.ok(pane.querySelector('.mem-health'), 'the tab still painted');
  assert.match(window.document.getElementById('memory-msg').textContent, /not found/);
});

test('New Pipeline: the Memory scope row shows only for wf_memory_defrag and the run body carries memoryScope, a synthesised brief and the normal guardrails', async () => {
  const { window, calls } = await boot();
  await go(window, 'new');
  const doc = window.document;
  const row = doc.getElementById('memory-scope-row');
  assert.equal(row.hidden, true, 'hidden for Default');
  const sel = doc.getElementById('workflowSelect');
  sel.value = 'wf_memory_defrag';
  sel.dispatchEvent(new window.Event('change'));
  await tick(); await tick();
  assert.equal(row.hidden, false);
  click(window, doc.querySelector('#memory-scope-seg button[data-scope="project"]'));
  assert.equal(doc.querySelector('#memory-scope-seg button[data-scope="project"]').classList.contains('on'), true);
  assert.equal(doc.querySelector('#memory-scope-seg button[data-scope="global"]').getAttribute('aria-pressed'), 'false');
  doc.getElementById('start-btn').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick(); await tick();
  const run = calls.find((c) => c.url.endsWith('/api/run') && c.method === 'POST');
  assert.ok(run, 'the form posted');
  assert.equal(run.body.workflowId, 'wf_memory_defrag');
  assert.equal(run.body.memoryScope, 'project');
  assert.equal(run.body.prompt, 'Defragment the memory of project alpha.');
  assert.equal(run.body.title, 'Memory defragment: alpha');
  assert.equal(run.body.guardrailsId, 'normal', 'the wrappers run it with Normal; Permissive was never chosen');
  sel.value = 'wf_default';
  sel.dispatchEvent(new window.Event('change'));
  await tick();
  assert.equal(row.hidden, true);
  doc.getElementById('prompt').value = 'ship it';
  doc.getElementById('start-btn').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick(); await tick();
  const plain = calls.filter((c) => c.url.endsWith('/api/run') && c.method === 'POST').pop();
  assert.equal('memoryScope' in plain.body, false, 'a legacy run body is unchanged');
  assert.equal('guardrailsId' in plain.body && plain.body.guardrailsId !== undefined, false, 'and so is its guardrail key');
});

test('New Pipeline: a workspace target disables Memory defragment and falls back to Default', async () => {
  const { window } = await boot();
  await go(window, 'new');
  const doc = window.document;
  doc.getElementById('workflowSelect').value = 'wf_memory_defrag';
  doc.getElementById('workflowSelect').dispatchEvent(new window.Event('change'));
  await tick(); await tick();
  click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
  await tick(); await tick(); await tick(); await tick();
  const opt = [...doc.getElementById('workflowSelect').options].find((o) => o.value === 'wf_memory_defrag');
  assert.equal(opt.disabled, true);
  assert.equal(opt.title, 'Memory defragment runs on one project');
  assert.equal(doc.getElementById('workflowSelect').value, 'wf_default', 'the selection fell back');
  assert.equal(doc.getElementById('memory-scope-row').hidden, true);
});

test('an Ask card handoff carrying memoryScope paints the seg and rides the next run body', async () => {
  const { window, calls } = await boot();
  window.__np.openNewPipeline({
    target: 'project', projectDir: '/Users/me/dev/alpha', workflowId: 'wf_memory_defrag',
    guardrailsId: 'normal', prompt: 'Defragment the memory of project alpha.', title: 'Memory defragment: alpha',
    memoryScope: 'project', featureBranch: '',
  });
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick(); await tick(); await tick();
  const doc = window.document;
  assert.equal(doc.querySelector('#memory-scope-seg button[data-scope="project"]').classList.contains('on'), true);
  assert.equal(doc.getElementById('memory-scope-row').hidden, false);
  doc.getElementById('start-btn').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick(); await tick();
  const run = calls.find((c) => c.url.endsWith('/api/run') && c.method === 'POST');
  assert.ok(run, 'the form posted');
  assert.equal(run.body.memoryScope, 'project', 'the proposal scope was not silently turned into global');
});
