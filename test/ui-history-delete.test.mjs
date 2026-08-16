// test/ui-history-delete.test.mjs  (boot()/runs() copied from ui-history-pr.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => {
    const sel = window.document.querySelector('#projectSelect');
    sel.value = PROJECT; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, selectProject, showHistory };
}
const runs = (pipelines, ghAvailable) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live: [], ghAvailable }) });

const FIN = { id: 'p1', title: 'Feat', status: 'stopped', startedAt: '2026-06-02T00:00:00Z',
              projectName: 'Proj', projectKey: 'proj-0000abcd', projectDir: '/x/proj' };
const RETAINED = {
  reason: 'commit_failed',
  members: [{
    projectKey: 'proj-0000abcd', branch: 'worca/feat', worktreeDir: '/tmp/retained-p1',
    step: 'commit', message: 'pre-commit hook failed', at: '2026-06-02T01:00:00Z',
  }],
};

test('finished entry shows an enabled Archive button under the stepper', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([FIN], false) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  const btn = card.querySelector('.hist-detail .hist-delete');
  assert.ok(btn, 'archive button is inside hist-detail (under the stepper)');
  assert.equal(btn.hidden, false, 'visible for a finished entry');
  assert.match(btn.textContent, /Archive/, 'label reads Archive, not Delete');
});

test('running entry hides the Archive button', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([{ ...FIN, status: 'running' }], false) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const btn = window.document.querySelector('#history .hist-card .hist-delete');
  assert.equal(btn.hidden, true);
});

test('retained work is prominent and Archive is disabled until it is recovered or discarded', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([{ ...FIN, retainedWork: RETAINED }], false) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-retained-badge').hidden, false);
  assert.match(card.querySelector('.retained-banner').textContent, /uncommitted work retained/i);
  assert.match(card.querySelector('.retained-banner').textContent, /pre-commit hook failed/);
  assert.match(card.querySelector('.retained-banner').textContent, /\/tmp\/retained-p1/);
  assert.match(card.querySelector('.retained-banner').textContent, /git -C '\/tmp\/retained-p1' add -A/);
  assert.equal(card.querySelector('.hist-discard').hidden, false);
  assert.equal(card.querySelector('.hist-delete').disabled, true, 'Archive cannot bypass retained-work safety');
  assert.match(card.querySelector('.hist-delete').title, /Recover or discard/);
});

test('discard saves a patch, clears the warning, and re-enables Archive', async () => {
  let request = null;
  const row = { ...FIN, retainedWork: RETAINED };
  const { window, showHistory } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/discard-worktree')) {
        request = { url, method: opts.method };
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ ok: true, discarded: true, patches: ['/store/p1/retained-work.patch'] }),
        });
      }
      if (url.includes('/api/history')) return runs([row], false);
      return null;
    },
  });
  let confirmText = '';
  window.confirm = (text) => { confirmText = text; return true; };
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  window.document.querySelector('.hist-discard').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(request.method, 'POST');
  assert.match(request.url, /\/api\/runs\/p1\/discard-worktree\?projectKey=/);
  assert.match(confirmText, /exists only in the retained worktree/);
  assert.match(confirmText, /recovery patch will be saved/);
  const card = window.document.querySelector('#history .hist-card');
  assert.equal(card.querySelector('.hist-retained-badge').hidden, true);
  assert.equal(card.querySelector('.hist-discard').hidden, true);
  assert.equal(card.querySelector('.hist-delete').disabled, false);
  assert.match(window.document.querySelector('#viewer').textContent, /retained-work\.patch/);
});

test('interrupted entry shows the Archive button', async () => {
  const { window, showHistory } = await boot({
    fetchHandler: (url) => (url.includes('/api/history') ? runs([{ ...FIN, status: 'interrupted' }], false) : null),
  });
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  const btn = card.querySelector('.hist-detail .hist-delete');
  assert.equal(btn.hidden, false, 'interrupted is terminal -> deletable');
});

test('confirm + click issues DELETE with the id and removes the card', async () => {
  let deleted = null;
  const { window, showHistory } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/history')) return runs([FIN], false);
      if (url.includes('/api/runs/p1') && opts.method === 'DELETE') {
        deleted = url;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  let msg = null;
  window.confirm = (m) => { msg = m; return true; }; // stub the popup
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const card = window.document.querySelector('#history .hist-card');
  card.querySelector('.hist-delete').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(deleted && deleted.includes('/api/runs/p1'), 'DELETE called for p1');
  assert.match(deleted, /projectKey=/, 'history delete passes projectKey');
  assert.equal(window.document.querySelector('#history .hist-card'), null, 'card removed from the list');
  assert.match(msg, /^Archive "/, 'confirm copy leads with Archive');
  assert.ok(msg.includes('kept for Statistics'), 'confirm copy says the cost/outcome survive for Statistics');
  assert.ok(msg.includes('remote branch is kept'), 'confirm copy still promises the remote branch');
});

test('the in-flight label reads Archiving…', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { window, showHistory } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/history')) return runs([FIN], false);
      if (url.includes('/api/runs/p1') && opts.method === 'DELETE') {
        return gate.then(() => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
      }
      return null;
    },
  });
  window.confirm = () => true;
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const btn = window.document.querySelector('#history .hist-card .hist-delete');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(btn.textContent, 'Archiving…', 'progress label while the request is in flight');
  release();
  await new Promise((r) => setTimeout(r, 0));
});

test('declining the confirm popup makes no request', async () => {
  let called = false;
  const { window, showHistory } = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/history')) return runs([FIN], false);
      if (opts.method === 'DELETE') { called = true; return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); }
      return null;
    },
  });
  window.confirm = () => false;
  showHistory();
  await new Promise((r) => setTimeout(r, 0));
  window.document.querySelector('.hist-delete').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(called, false, 'no DELETE when the user cancels');
});
