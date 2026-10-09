// test/ui-memory-view.test.mjs — full-app-boot jsdom tests for the Settings → Memory tab, the
// memory-changed frame, the New-Pipeline Memory scope control and the Ask card handoff
// (agent-memory-design.md §10, §7.3).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './helpers/confirm-modal.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { useAppTimers } from './helpers/app-timers.mjs';
import { cardAlertOf, lastToast, edit, fieldErrorText } from './helpers/feedback.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const HEALTH = { files: 1, bytes: 40, oversized: 0, overHard: 0, invalidFrontmatter: 0, alwaysOnBytes: 25, alwaysOnFiles: 1, writesSinceDefrag: 2, lastWriteAt: '2026-09-09T10:00:00.000Z', lastDefragAt: null, lastDefragRunId: null, level: 'ok', reasons: [] };
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
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' }));
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

// Each row boots its own app: the second has no project registered.
test('#settings/memory paints health card, file list and history; with no project Defragment is disabled and says why', async () => {
  await checkRows([
    { name: '#settings/memory paints the health card, the file list and the history from the API', run: async () => {
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
    } },
    { name: 'with NO project registered the Defragment button is disabled and says why', run: async () => {
      const { window } = await boot({ projects: [] });
      await go(window, 'settings/memory');
      const pane = memPane(window);
      assert.equal(pane.querySelector('.mem-defrag').disabled, true);
      assert.equal(pane.querySelector('.mem-host-hint').textContent, 'Register a project on the Projects page to host the global defragment run.');
    } },
  ]);
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
  assert.deepEqual(lastToast(window.document), { tone: 'ok', title: 'Memory saved', detail: 'testing.md', action: '' },
    'the success message survives the reload as a toast (#555)');
  assert.equal(window.document.getElementById('memory-msg').textContent, '');
  click(window, memPane(window).querySelector('.mem-delete'));
  const message = await confirmDialog(window);
  assert.match(message, /Delete “testing\.md”/);
  await tick(); await tick();
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del && del.url.endsWith('/api/memory/global/files/testing'));
  assert.equal(window.location.hash, '#settings/memory', 'back to the list route');
});

test('New file: editable name with a client-side check, Save PUTs to that name and routes; Cancel clears the editor without a hash change', async () => {
  const { window, calls } = await boot();
  await checkRows([
    { name: 'New file: an editable name, a client-side name check, then Save PUTs to that name and routes to it', run: async () => {
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
      // #555: the name rule is a field error on the name input; the editor is not repainted.
      assert.match(fieldErrorText(ed.querySelector('.mem-name')), /letters, digits/);
      assert.equal(pane.querySelector('.mem-msg').textContent, '');
      assert.ok(!calls.some((c) => c.method === 'PUT'), 'no request for an invalid name');
      const ed2 = pane.querySelector('.mem-editor');
      assert.equal(ed2, ed, 'the refused save kept the editor the user typed into');
      ed2.querySelector('.mem-name').value = 'new-topic';
      ed2.querySelector('.mem-text').value = 'x\n';
      click(window, ed2.querySelector('.mem-save'));
      await tick(); await tick(); await tick();
      const put = calls.find((c) => c.method === 'PUT');
      assert.ok(put && put.url.endsWith('/api/memory/global/files/new-topic'));
      assert.equal(window.location.hash, '#settings/memory/new-topic', 'a saved new file routes to itself');
    } },
    { name: 'New file then Cancel clears the editor even though the hash never changed', run: async () => {
      await go(window, 'settings/memory');
      const pane = memPane(window);
      click(window, pane.querySelector('.mem-new'));
      await tick();
      assert.ok(pane.querySelector('.mem-editor'));
      click(window, pane.querySelector('.mem-cancel'));
      await tick();
      assert.equal(pane.querySelector('.mem-editor'), null, 'the editor is gone without a hashchange');
      assert.equal(window.location.hash, '#settings/memory');
    } },
  ]);
});

test('#555: a refused memory Save is a card alert in the editor; nothing is lost', async () => {
  const { window } = await boot({
    fetchHandler: (u, o) => (o.method === 'PUT' ? Promise.resolve({ ok: false, status: 422, json: async () => ({ error: 'frontmatter: name must match the file' }) }) : null),
  });
  await go(window, 'settings/memory/testing');
  const pane = memPane(window);
  const ed = pane.querySelector('.mem-editor');
  ed.querySelector('.mem-text').value = 'edited\n';
  click(window, ed.querySelector('.mem-save'));
  await tick(); await tick(); await tick();
  assert.equal(pane.querySelector('.mem-editor'), ed, 'the editor stays as typed');
  assert.deepEqual(cardAlertOf(ed), { title: 'Not saved', detail: 'frontmatter: name must match the file' });
  assert.ok(ed.querySelector('.card-alert').nextElementSibling.classList.contains('mem-actions'), 'directly above the buttons');
  assert.equal(ed.querySelector('.mem-save').dataset.fbState, undefined);
  assert.equal(ed.querySelector('.mem-text').value, 'edited\n');
  assert.equal(lastToast(window.document), null);
});

test('memory-changed refetches only the open global tab (not other scopes/views); leaving the tab destroys the controller so later frames paint nothing', async () => {
  const { window, calls } = await boot();
  await checkRows([
    { name: 'a memory-changed frame for global refetches the open tab; other scopes and other views do not', run: async () => {
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
    } },
    { name: 'leaving the tab destroys the controller: the host is empty and a later frame paints nothing', run: async () => {
      await go(window, 'settings/memory');
      assert.ok(window.document.getElementById('memory-host').childNodes.length > 0);
      await go(window, 'settings/guardrails');
      assert.equal(window.document.getElementById('memory-host').childNodes.length, 0, 'destroy() emptied the host');
    } },
  ]);
});

// Each row boots its own app: both start from a clean editor on #settings/memory/testing.
// COMMENT_POKE_MS (250) runs on driven timers, enabled after the boot inside each row.
test('a memory-changed frame never clobbers a dirty editor: it warns, keeps focus/selection, and the next Space never reloads the file', async (t) => {
  await checkRows([
    { name: 'a memory-changed frame never clobbers a dirty editor — it warns instead', run: async () => {
      const { window } = await boot();
      await go(window, 'settings/memory/testing');
      const pane = memPane(window);
      pane.querySelector('.mem-text').value = 'my unsaved edit\n';
      const timers = useAppTimers(t);
      try {
        WSStub.last._message({ type: 'memory-changed', scope: 'global' });
        await timers.settle();
        assert.equal(memPane(window).querySelector('.mem-text').value, 'my unsaved edit\n', 'the edit survived');
        const msg = window.document.getElementById('memory-msg');
        assert.match(msg.textContent, /changed on disk while you were editing/);
        assert.ok(msg.classList.contains('warn'));
        // A SECOND frame (a burst of remembers, a run end) must not "forget" that the editor is dirty.
        await timers.advance(300);   // > COMMENT_POKE_MS (250)
        WSStub.last._message({ type: 'memory-changed', scope: 'global' });
        await timers.advance(300);
        assert.equal(memPane(window).querySelector('.mem-text').value, 'my unsaved edit\n', 'the edit survived the second frame too');
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'a memory-changed frame keeps focus and the selection in the dirty textarea; the next Space never reloads the file', run: async () => {
      const { window, calls } = await boot();
      await go(window, 'settings/memory/testing');
      const ta = memPane(window).querySelector('.mem-text');
      ta.value = 'my unsaved edit\n';
      ta.focus();
      ta.setSelectionRange(3, 10);
      const fileGets = () => calls.filter((c) => c.url.endsWith('/api/memory/global/files/testing') && c.method === 'GET').length;
      const before = fileGets();
      const timers = useAppTimers(t);
      try {
        WSStub.last._message({ type: 'memory-changed', scope: 'global' });
        await timers.advance(300);   // > COMMENT_POKE_MS (250)
        const active = window.document.activeElement;
        assert.ok(active && active.classList.contains('mem-text'), `focus stayed in the textarea, got ${active && active.className}`);
        assert.equal(active.value, 'my unsaved edit\n');
        assert.deepEqual([active.selectionStart, active.selectionEnd], [3, 10], 'the selection survived the repaint');
        active.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        await timers.settle();
        assert.equal(memPane(window).querySelector('.mem-text').value, 'my unsaved edit\n', 'the draft is intact');
        assert.equal(fileGets(), before, 'Space never reloaded the file from disk');
        assert.match(window.document.getElementById('memory-msg').textContent, /changed on disk while you were editing/, 'the warning stays');
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});

test('Defragment never discards a dirty draft', async () => {
  const { window, calls } = await boot();
  await go(window, 'settings/memory/testing');
  memPane(window).querySelector('.mem-text').value = 'my unsaved edit\n';
  click(window, memPane(window).querySelector('.mem-defrag'));
  await tick(); await tick(); await tick(); await tick();
  assert.ok(calls.some((c) => c.url.endsWith('/api/memory/global/defragment') && c.method === 'POST'), 'the run was started');
  assert.equal(memPane(window).querySelector('.mem-text').value, 'my unsaved edit\n', 'the draft survived the reload');
  assert.match(lastToast(window.document).title, /Defragment run started\./);
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

test('New Pipeline Memory scope: row only for wf_memory_defrag, run body carries memoryScope + brief + guardrails; a workspace target disables it and falls back to Default', async () => {
  const { window, calls } = await boot();
  await checkRows([
    { name: 'New Pipeline: the Memory scope row shows only for wf_memory_defrag and the run body carries memoryScope, a synthesised brief and the normal guardrails', run: async () => {
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
    } },
    { name: 'New Pipeline: a workspace target disables Memory defragment and falls back to Default', run: async () => {
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
    } },
  ]);
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

// ---- History detail: the Memory changes chips (agent-memory-design.md §6 / B6) ----
// buildHdOverview is the only site that renders them; the History screen itself is exercised by
// test/ui-history-detail.test.mjs, so the chips are driven through the same test hook it uses.
const HD_STATE = {
  id: 'p1', status: 'done', startedAt: '2026-09-09T10:00:00Z', totalActiveMs: 1000, totalCostUsd: 0.1,
  stepper: null, steps: [], active: [], warnings: [], wireDeliveries: {}, gate: null,
};

test('History memory chips: added/modified link to the Memory view, rejected writes link to the stored file, deleted and FAILED writes are inert (failed red with reason)', async () => {
  const { window } = await boot();
  await checkRows([
    { name: 'History memory chips: added and modified files link to their Memory view, a deleted one stays inert', run: async () => {
      const doc = window.document;
      const sec = doc.createElement('div');
      const record = { id: 'p1', projectKey: 'alpha-00000001', title: 't' };
      window.__np.buildHdOverview(sec, record, {
        state: HD_STATE,
        results: null,
        memory: { changes: [{ nodeId: 'n_impl', agentKey: 'implementer',
          added: [{ scope: 'global', name: 'testing' }],
          modified: [{ scope: 'project', name: 'conv' }],
          deleted: [{ scope: 'global', name: 'old' }],
          rejected: [] }] },
      });
      const chips = [...sec.querySelectorAll('.hd-mem-chip')];
      assert.deepEqual(chips.map((c) => c.tagName), ['BUTTON', 'BUTTON', 'SPAN']);
      click(window, chips[0]);
      assert.equal(window.location.hash, '#settings/memory/testing');
      click(window, chips[1]);
      assert.equal(window.location.hash, '#projects/alpha-00000001/memory/conv', 'the mount-relative scope resolved to this run\'s project');
    } },
    { name: 'History memory chips: a rejected write links to the stored file; a project chip with no key does not', run: async () => {
      const doc = window.document;
      const sec = doc.createElement('div');
      window.__np.buildHdOverview(sec, { id: 'p1', projectKey: 'alpha-00000001', title: 't' }, {
        state: HD_STATE, results: null,
        memory: { changes: [{ nodeId: 'n', agentKey: null, added: [], modified: [], deleted: [],
          rejected: [{ scope: 'global', name: 'huge', reason: 'over the 32768-byte cap' }] }] },
      });
      const rej = sec.querySelector('.hd-mem-rej');
      assert.equal(rej.tagName, 'BUTTON');
      assert.equal(rej.title, 'over the 32768-byte cap');
      click(window, rej);
      assert.equal(window.location.hash, '#settings/memory/huge');
      const sec2 = doc.createElement('div');
      window.__np.buildHdOverview(sec2, { id: 'p2', projectKey: '', title: 't' }, {
        state: HD_STATE, results: null,
        memory: { changes: [{ nodeId: 'n', agentKey: null, added: [{ scope: 'project', name: 'lesson' }], modified: [], deleted: [], rejected: [] }] },
      });
      assert.equal(sec2.querySelector('.hd-mem-chip').tagName, 'SPAN', 'no project key, nothing to open');
    } },
    { name: 'History memory chips: a FAILED write is an inert red chip with the reason as title — there is nothing in the store to open', run: async () => {
      const doc = window.document;
      const sec = doc.createElement('div');
      window.__np.buildHdOverview(sec, { id: 'p1', projectKey: 'alpha-00000001', title: 't' }, {
        state: HD_STATE, results: null,
        memory: { changes: [{ nodeId: 'n', agentKey: 'implementer', added: [], modified: [], deleted: [], rejected: [],
          failed: [{ scope: 'project', name: 'trap', reason: 'written into the read-only rules copy — Claude requested permissions to edit /x which is a sensitive file.' }] }] },
      });
      const chip = sec.querySelector('.hd-mem-chip[data-kind="fail"]');
      assert.ok(chip, 'the failed chip renders');
      assert.equal(chip.tagName, 'SPAN', 'never a button: no stored file to open');
      assert.equal(chip.textContent, '⊘ project/trap.md');
      assert.ok(chip.classList.contains('hd-mem-rej'), 'the rejected colour (no new CSS class, no new contrast-baseline signature)');
      assert.match(chip.title, /read-only rules copy/);
    } },
  ]);
});

// ---- Settings › Memory: the Defragment model card (memory-defrag-model.mjs) ----
const DM_CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false },
];
/** GET /api/settings answers `stored`; POST echoes what it was sent (the server's own shape). */
function dmHandler(posts, stored = { model: 'claude-opus-5-5', effort: 'high' }) {
  return (u, o) => {
    const method = (o.method || 'GET').toUpperCase();
    if (u === '/api/settings' && method === 'POST') {
      const body = JSON.parse(o.body);
      posts.push(body);
      const md = body.memoryDefrag && body.memoryDefrag.model ? { model: body.memoryDefrag.model, effort: body.memoryDefrag.effort || null } : { model: null, effort: null };
      return json({ memoryDefrag: md, memoryDefragDefault: 'claude-sonnet-5' });
    }
    if (u === '/api/settings') return json({ memoryDefrag: stored, memoryDefragDefault: 'claude-sonnet-5' });
    if (u === '/api/config') return json({ config: { steps: {}, customModels: [] }, models: DM_CATALOG, efforts: ['medium', 'high', 'xhigh', 'max'] });
    return null;
  };
}
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

// Each row boots its own app: the second needs a card nobody has saved yet.
test('Defragment model card paints the stored pair (\'(default)\' first, the model\'s own efforts) and Save starts disabled until a change', async () => {
  await checkRows([
    { name: 'Settings › Memory: the Defragment model card paints the stored pair — "(default)" first, the effort list is the model\'s own', run: async () => {
      const posts = [];
      const { window } = await boot({ fetchHandler: dmHandler(posts) });
      await go(window, 'settings/memory');
      await settle();
      const doc = window.document;
      const msel = doc.getElementById('memDefragModel');
      const esel = doc.getElementById('memDefragEffort');
      assert.ok(msel.closest('.settings-pane[data-tab="memory"]'), 'on the global Memory tab');
      assert.deepEqual([...msel.options].map((o) => [o.value, o.textContent]), [['', '(default)'], ['claude-haiku-4-5', 'Haiku 4.5'], ['claude-opus-5-5', 'Opus 5.5']]);
      assert.equal(msel.value, 'claude-opus-5-5');
      assert.deepEqual([...esel.options].map((o) => o.value), ['', 'medium', 'high', 'xhigh', 'max']);
      assert.equal(esel.value, 'high');
      assert.match(doc.getElementById('memDefragModelNote').textContent, /Every Memory defragment run uses Opus 5\.5 · high/);
      // Another model: its own efforts; an effort it offers survives the switch.
      edit(window, msel, 'claude-haiku-4-5');
      assert.deepEqual([...esel.options].map((o) => o.value), ['', 'medium', 'high']);
      assert.equal(esel.value, 'high');
      edit(window, esel, 'medium');
      doc.getElementById('memDefragModelSave').click();
      await settle();
      assert.deepEqual(posts.at(-1), { memoryDefrag: { model: 'claude-haiku-4-5', effort: 'medium' } });
      assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Saved', detail: 'Applies to the next defragment run.', action: '' });
      assert.equal(doc.getElementById('memDefragModelMsg').textContent, '', 'no grey "Saved." line');
    } },
    { name: 'Settings › Memory: the Defragment model Save starts disabled; picking another model enables it', run: async () => {
      const { window } = await boot({ fetchHandler: dmHandler([]) });
      await go(window, 'settings/memory');
      await settle();
      const doc = window.document;
      const save = doc.getElementById('memDefragModelSave');
      assert.equal(save.disabled, true, 'a freshly painted card is clean');
      assert.equal(doc.querySelector('#mem-defrag-model-card .dirty-mark').hidden, true);
      edit(window, doc.getElementById('memDefragModel'), 'claude-haiku-4-5');
      assert.equal(save.disabled, false);
      assert.equal(doc.querySelector('#mem-defrag-model-card .dirty-mark').hidden, false);
    } },
  ]);
});

test('Settings › Memory: clearing the model clears and disables the effort; Save sends the empty pair, Use default sends null; a save reloads the health card', async () => {
  const posts = [];
  const { window, calls } = await boot({ fetchHandler: dmHandler(posts) });
  await go(window, 'settings/memory');
  await settle();
  const doc = window.document;
  const msel = doc.getElementById('memDefragModel');
  const esel = doc.getElementById('memDefragEffort');
  edit(window, msel, '');
  assert.equal(esel.value, '');
  assert.equal(esel.disabled, true, 'an effort without a model means nothing');
  const before = getCount(calls);
  doc.getElementById('memDefragModelSave').click();
  await settle();
  assert.deepEqual(posts.at(-1), { memoryDefrag: { model: '', effort: '' } });
  assert.equal(getCount(calls), before + 1, 'the health card refetched: its host hint names the model');
  click(window, doc.getElementById('memDefragModelReset'));
  await settle();
  assert.deepEqual(posts.at(-1), { memoryDefrag: null });
});

test('Settings › Memory: a stored model that left the catalog paints disabled and "not installed", and Save refuses it without a request', async () => {
  const posts = [];
  const { window } = await boot({ fetchHandler: dmHandler(posts, { model: 'gone-model', effort: null }) });
  await go(window, 'settings/memory');
  await settle();
  const doc = window.document;
  const msel = doc.getElementById('memDefragModel');
  const opt = [...msel.options].find((o) => o.value === 'gone-model');
  assert.equal(opt.textContent, 'gone-model — not installed');
  assert.equal(opt.disabled, true);
  assert.match(doc.getElementById('memDefragModelNote').textContent, /no longer in the catalog — defragment runs fall back to claude-sonnet-5, or the model a project picked for the Memory defragmenter\./);
  assert.equal(doc.getElementById('memDefragModelSave').disabled, true, 'the painted card is clean');
  doc.getElementById('memDefragModelSave').click();
  await settle();
  assert.equal(posts.length, 0, 'no request for a model that cannot run');
});

test('Settings › Memory: a settings-changed frame re-reads the card and reloads the scope — keeping a draft, with no conflict warning', async () => {
  const posts = [];
  const { window, calls } = await boot({ fetchHandler: dmHandler(posts) });
  await go(window, 'settings/memory/testing');
  await settle();
  memPane(window).querySelector('.mem-text').value = 'my unsaved edit\n';
  const settingsGets = () => calls.filter((c) => c.url === '/api/settings' && c.method === 'GET').length;
  const [s0, m0] = [settingsGets(), getCount(calls)];
  WSStub.last._message({ type: 'settings-changed' });
  await settle();
  assert.ok(settingsGets() > s0, 'the setting was re-read');
  assert.equal(getCount(calls), m0 + 1, 'the scope reloaded: the health hint names the model');
  assert.equal(memPane(window).querySelector('.mem-text').value, 'my unsaved edit\n', 'the draft survived');
  assert.doesNotMatch(window.document.getElementById('memory-msg').textContent, /changed on disk/, 'a settings change is not a memory conflict');
});

test('Settings › Memory: when the model list did not load, Save refuses instead of clearing the stored pair', async () => {
  const posts = [];
  const base = dmHandler(posts);
  const { window } = await boot({ fetchHandler: (u, o) => (u === '/api/config' ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) : base(u, o)) });
  await go(window, 'settings/memory');
  await settle();
  edit(window, window.document.getElementById('memDefragModel'), '');
  window.document.getElementById('memDefragModelSave').click();
  await settle();
  assert.equal(posts.length, 0, 'no request: the empty select would have posted { model: "", effort: "" } — a clear');
  assert.deepEqual(cardAlertOf(window.document.getElementById('mem-defrag-model-card')),
    { title: 'Not saved', detail: 'The model list did not load. Reload the page to change this.' });
});

test('Settings › Memory: a hand-edited id in another case IS the catalog entry (a run matches it the same way)', async () => {
  const { window } = await boot({ fetchHandler: dmHandler([], { model: 'CLAUDE-OPUS-5-5', effort: 'high' }) });
  await go(window, 'settings/memory');
  await settle();
  const msel = window.document.getElementById('memDefragModel');
  assert.equal(msel.value, 'claude-opus-5-5');
  assert.ok(![...msel.options].some((o) => /not installed/.test(o.textContent)), 'not painted stale');
  assert.match(window.document.getElementById('memDefragModelNote').textContent, /^Every Memory defragment run uses Opus 5\.5 · high/);
});

// Each row boots its own app: each drives its own failing /api/settings switch.
test('a failed settings re-read makes Save refuse instead of posting the old paint; a working re-read lifts the error', async () => {
  await checkRows([
    { name: 'Settings › Memory: a failed re-read of the setting (a settings-changed frame) makes Save refuse instead of posting the old paint', run: async () => {
      const posts = [];
      const base = dmHandler(posts);
      let failSettings = false;
      const { window } = await boot({ fetchHandler: (u, o) => (failSettings && u === '/api/settings' && (o.method || 'GET').toUpperCase() === 'GET'
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) : base(u, o)) });
      await go(window, 'settings/memory');
      await settle();
      assert.equal(window.document.getElementById('memDefragModel').value, 'claude-opus-5-5', 'the first paint');
      failSettings = true;
      WSStub.last._message({ type: 'settings-changed' });
      await settle();
      edit(window, window.document.getElementById('memDefragModel'), 'claude-haiku-4-5');
      window.document.getElementById('memDefragModelSave').click();
      await settle();
      assert.equal(posts.length, 0, 'the stale paint is never posted over what another tab saved');
      assert.match(cardAlertOf(window.document.getElementById('mem-defrag-model-card')).detail, /The model list did not load/);
    } },
    { name: 'Settings › Memory: a re-read that works lifts the error a failed one left behind; the save\'s own frame leaves no error', run: async () => {
      const posts = [];
      const base = dmHandler(posts);
      let failSettings = false;
      const { window } = await boot({ fetchHandler: (u, o) => (failSettings && u === '/api/settings' && (o.method || 'GET').toUpperCase() === 'GET'
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) : base(u, o)) });
      await go(window, 'settings/memory');
      await settle();
      const msg = window.document.getElementById('memDefragModelMsg');
      failSettings = true;
      WSStub.last._message({ type: 'settings-changed' });
      await settle();
      assert.equal(msg.textContent, 'boom');
      failSettings = false;
      WSStub.last._message({ type: 'settings-changed' });
      await settle();
      assert.equal(msg.textContent, '', 'the card works again: no stale error');
      edit(window, window.document.getElementById('memDefragModel'), 'claude-haiku-4-5');
      window.document.getElementById('memDefragModelSave').click();
      await settle();
      assert.equal(posts.length, 1, 'and Save posts again');
      assert.equal(lastToast(window.document).detail, 'Applies to the next defragment run.');
      WSStub.last._message({ type: 'settings-changed' });   // the save's own frame
      await settle();
      assert.equal(msg.textContent, '', 'no error line after the save\'s own frame');
      assert.equal(cardAlertOf(window.document.getElementById('mem-defrag-model-card')), null);
    } },
  ]);
});

// Each row boots its own app: the second needs a clean editor.
test('conflict-warning ordering: a settings-changed reload overtaking a memory-changed one keeps the warning; a clean editor owes none', async () => {
  await checkRows([
    { name: 'Settings › Memory: a settings-changed reload that overtakes a memory-changed one keeps the conflict warning', run: async () => {
      let release = null; let holdNext = false;
      const base = dmHandler([]);
      const { window } = await boot({ fetchHandler: (u, o) => {
        if (holdNext && u.endsWith('/api/memory/global') && (o.method || 'GET').toUpperCase() === 'GET') {
          holdNext = false;
          return new Promise((res) => { release = () => res({ ok: true, status: 200, json: async () => REPORT }); });
        }
        return base(u, o);
      } });
      await go(window, 'settings/memory/testing');
      await settle();
      memPane(window).querySelector('.mem-text').value = 'my unsaved edit\n';
      holdNext = true;
      WSStub.last._message({ type: 'memory-changed', scope: 'global' });   // its GET hangs…
      await settle();
      assert.ok(release, 'the frame\'s reload is in flight');
      WSStub.last._message({ type: 'settings-changed' });                  // …and this keepDraft reload overtakes it
      await settle();
      release();
      await settle();
      assert.equal(memPane(window).querySelector('.mem-text').value, 'my unsaved edit\n', 'the draft survived');
      assert.match(window.document.getElementById('memory-msg').textContent, /changed on disk while you were editing/, 'the conflict the frame came to report is not swallowed');
    } },
    { name: 'Settings › Memory: a memory-changed reload of a CLEAN editor owes no warning to a later settings-changed one', run: async () => {
      const { window } = await boot({ fetchHandler: dmHandler([]) });
      await go(window, 'settings/memory/testing');
      await settle();
      WSStub.last._message({ type: 'memory-changed', scope: 'global' });   // nothing typed yet: a plain refresh
      await settle();
      memPane(window).querySelector('.mem-text').value = 'typed after the refresh\n';
      WSStub.last._message({ type: 'settings-changed' });
      await settle();
      assert.equal(memPane(window).querySelector('.mem-text').value, 'typed after the refresh\n', 'the draft survived');
      assert.doesNotMatch(window.document.getElementById('memory-msg').textContent, /changed on disk/, 'the refresh found a clean editor: nothing to report');
    } },
  ]);
});

test('an Ask card handoff carrying an engine picks it on New Pipeline, keeps it visible in Simple, and sends it', async () => {
  const { window, calls } = await boot();
  window.__np.openNewPipeline({
    target: 'project', projectDir: '/Users/me/dev/alpha', workflowId: 'wf_default',
    guardrailsId: 'normal', prompt: 'Fix the cart total rounding.', title: 'Fix rounding', featureBranch: '', engine: 'codex',
  });
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick(); await tick(); await tick();
  const doc = window.document;
  assert.equal(doc.getElementById('engineSelect').value, 'codex');
  assert.equal(doc.getElementById('engine-row').dataset.levelKeep, '1', 'a non-Claude engine shows even in Simple');
  doc.getElementById('start-btn').closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick(); await tick();
  const run = calls.find((c) => c.url.endsWith('/api/run') && c.method === 'POST');
  assert.ok(run, 'the form posted');
  assert.equal(run.body.engine, 'codex');
});
