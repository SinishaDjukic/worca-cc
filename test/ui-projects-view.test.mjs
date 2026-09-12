// test/ui-projects-view.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

class WSStub {
  constructor() { WSStub.last = this; this.readyState = 0; this._listeners = {}; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { this.readyState = 1; (this._listeners.open || []).forEach((fn) => fn({})); }
}

const PROJECTS = [
  { name: 'alpha', path: '/Users/me/dev/alpha', exists: true, key: 'alpha-00000001' },
  { name: 'beta', path: '/Users/me/dev/beta', exists: false, key: 'beta-00000002' },
];

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

async function goProjects(window) {
  window.location.hash = 'projects';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick();
}

test('projects view un-hides and renders one row per project', async () => {
  const { window } = await boot();
  await goProjects(window);
  const doc = window.document;
  assert.equal(doc.querySelector('.view[data-view="projects"]').classList.contains('hidden'), false);
  const rows = [...doc.querySelectorAll('#projects-list .pl-item')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.pl-name').textContent.trim().startsWith('alpha'), true);
  assert.equal(rows[0].querySelector('.proj-path').textContent, '/Users/me/dev/alpha');
  // missing flag for non-existent folder
  assert.ok(rows[1].querySelector('.proj-missing'), 'beta should show a missing marker');
});

test('delete opens the confirm modal; confirming issues DELETE and removes the row', async () => {
  const calls = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/projects') && opts.method === 'DELETE') {
        calls.push(u);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [PROJECTS[1]] }) });
      }
      return null;
    },
  });
  await goProjects(window);
  const doc = window.document;
  click(window, doc.querySelector('#projects-list .pl-item .proj-del'));
  await tick();
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), false, 'confirm modal should open');
  click(window, doc.querySelector('#confirm-ok'));
  await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /name=alpha/);
  assert.equal(doc.querySelector('#confirm-modal').classList.contains('hidden'), true, 'modal should close');
  assert.equal([...doc.querySelectorAll('#projects-list .pl-item')].length, 1);
});

test('cancelling the confirm modal issues no DELETE', async () => {
  const calls = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/projects') && opts.method === 'DELETE') { calls.push(u); return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) }); }
      return null;
    },
  });
  await goProjects(window);
  const doc = window.document;
  click(window, doc.querySelector('#projects-list .pl-item .proj-del'));
  await tick();
  click(window, doc.querySelector('#confirm-cancel'));
  await tick();
  assert.equal(calls.length, 0, 'no DELETE on cancel');
  assert.equal([...doc.querySelectorAll('#projects-list .pl-item')].length, 2);
});

test('add: + picks a folder, prefills the basename, and POSTs the project', async () => {
  const posts = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/fs/pick-folder')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'picked', path: '/Users/me/dev/cool-app' }) });
      if (u.includes('/api/projects') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        const next = [...PROJECTS, { name: 'cool-app', path: '/Users/me/dev/cool-app', exists: true }];
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: next }) });
      }
      return null;
    },
  });
  await goProjects(window);
  const doc = window.document;
  click(window, doc.querySelector('#project-add-btn'));
  await tick(); await tick();
  assert.equal(doc.querySelector('#project-add-modal').classList.contains('hidden'), false, 'add modal should open');
  assert.equal(doc.querySelector('#proj-add-name').value, 'cool-app', 'name prefilled from basename');
  assert.equal(doc.querySelector('#proj-add-path').value, '/Users/me/dev/cool-app');
  click(window, doc.querySelector('#proj-add-save'));
  await tick(); await tick();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], { name: 'cool-app', path: '/Users/me/dev/cool-app' });
  const items = [...doc.querySelectorAll('#projects-list .pl-item')];
  assert.equal(items.length, 3);
  // A row with no store key has no memory scope to mount (agent memory §10).
  assert.equal(items[2].dataset.key, undefined);
  assert.equal(items[2].querySelector('.proj-mem-head'), null, 'a keyless project renders no Memory expander');
});

// ---- Agent memory: the per-project Memory expander (agent-memory-design.md §10) ----

const MEM = {
  scope: 'projects/alpha-00000001',
  project: { key: 'alpha-00000001', name: 'alpha', path: '/Users/me/dev/alpha' },
  files: [{ name: 'conv', description: 'Naming', paths: [], source: 'user', updated: '', bytes: 10, hasFrontmatter: true }],
  state: {}, health: { level: 'ok', reasons: [], files: 1, bytes: 10, writesSinceDefrag: 0 }, defragRunId: null,
};
const memJson = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const memFetch = (u, o = {}) => {
  const method = (o.method || 'GET').toUpperCase();
  if (u.includes('/api/memory/projects/alpha-00000001/files/')) {
    if (method !== 'GET') return memJson({ ok: true });
    return memJson({ name: 'conv', text: '---\nname: conv\n---\nkebab.\n', meta: {}, body: 'kebab.\n' });
  }
  if (u.includes('/api/memory/projects/alpha-00000001/history')) return memJson({ snapshots: [] });
  if (u.includes('/api/memory/projects/alpha-00000001')) return memJson(MEM);
  return null;
};
async function goHash(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick();
}

test("every project row with a key gets a collapsed Memory expander; opening it fetches that project's scope", async () => {
  const { window } = await boot({ fetchHandler: memFetch });
  await goHash(window, 'projects');
  const doc = window.document;
  const items = [...doc.querySelectorAll('#projects-list .pl-item')];
  assert.deepEqual(items.map((i) => i.dataset.key), ['alpha-00000001', 'beta-00000002']);
  const head = items[0].querySelector('.proj-mem-head');
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.equal(items[0].querySelector('.proj-mem-detail').hidden, true);
  click(window, head);
  await tick(); await tick(); await tick();
  assert.equal(head.getAttribute('aria-expanded'), 'true');
  const detail = items[0].querySelector('.proj-mem-detail');
  assert.equal(detail.hidden, false);
  assert.deepEqual([...detail.querySelectorAll('.mem-row')].map((r) => r.dataset.name), ['conv']);
  assert.equal(detail.querySelector('.mem-defrag').disabled, false, 'a project defragment never needs a host');
  assert.equal(detail.querySelector('.mem-host-hint'), null, 'and never names one');
  click(window, head);
  assert.equal(detail.hidden, true, 'toggles closed; the controller stays mounted');
});

test('#projects/<key>/memory/<name> lands on the Projects page with that row expanded and the file open', async () => {
  const { window } = await boot({ fetchHandler: memFetch });
  await goHash(window, 'projects/alpha-00000001/memory/conv');
  const doc = window.document;
  assert.equal(doc.querySelector('[data-view="projects"]').classList.contains('hidden'), false);
  const item = doc.querySelector('#projects-list .pl-item[data-key="alpha-00000001"]');
  assert.equal(item.querySelector('.proj-mem-head').getAttribute('aria-expanded'), 'true');
  const ed = item.querySelector('.mem-editor');
  assert.ok(ed, 'the file is open');
  assert.equal(ed.querySelector('.mem-name').value, 'conv');
  assert.equal(doc.querySelector('.pl-item[data-key="beta-00000002"] .proj-mem-detail').hidden, true, 'other rows stay collapsed');
});

test('an expander survives a projects-changed rebuild: it re-opens on the same file', async () => {
  const { window } = await boot({ fetchHandler: memFetch });
  await goHash(window, 'projects/alpha-00000001/memory/conv');
  const doc = window.document;
  WSStub.last._listeners.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'projects-changed' }) }));
  await tick(); await tick(); await tick(); await tick();
  const item = doc.querySelector('#projects-list .pl-item[data-key="alpha-00000001"]');
  assert.equal(item.querySelector('.proj-mem-head').getAttribute('aria-expanded'), 'true', 'still open after the rebuild');
  assert.equal(item.querySelector('.mem-name').value, 'conv', 'and still on the same file');
});

test('inside an expander a NEW file saves without navigating and shows up as a saved row', async () => {
  const puts = [];
  let saved = false;
  const { window } = await boot({
    fetchHandler: (u, o = {}) => {
      const method = (o.method || 'GET').toUpperCase();
      if (u.includes('/api/memory/projects/alpha-00000001/files/conv2') && method === 'PUT') {
        puts.push(JSON.parse(o.body)); saved = true;
        return memJson({ ok: true, name: 'conv2', created: true, bytes: 2 });
      }
      if (u.includes('/api/memory/projects/alpha-00000001/files/conv2')) return memJson({ name: 'conv2', text: 'x\n', meta: {}, body: 'x\n' });
      if (u.endsWith('/api/memory/projects/alpha-00000001')) {
        return memJson(saved
          ? { ...MEM, files: [...MEM.files, { name: 'conv2', description: '', paths: [], source: 'user', updated: '', bytes: 2, hasFrontmatter: false }] }
          : MEM);
      }
      return memFetch(u, o);
    },
  });
  await goHash(window, 'projects/alpha-00000001/memory');
  const doc = window.document;
  const detail = doc.querySelector('.pl-item[data-key="alpha-00000001"] .proj-mem-detail');
  click(window, detail.querySelector('.mem-new'));
  await tick();
  const ed = detail.querySelector('.mem-editor');
  ed.querySelector('.mem-name').value = 'conv2';
  ed.querySelector('.mem-text').value = 'x\n';
  click(window, ed.querySelector('.mem-save'));
  await tick(); await tick(); await tick();
  assert.deepEqual(puts, [{ text: 'x\n' }]);
  assert.equal(window.location.hash, '#projects/alpha-00000001/memory', 'an expander never navigates');
  assert.deepEqual([...detail.querySelectorAll('.mem-row')].map((r) => r.dataset.name), ['conv', 'conv2']);
  assert.equal(detail.querySelector('.mem-name').readOnly, true, 'the editor left "new" mode');
});

test('an unknown-key memory route error is cleared on the next #projects entry', async () => {
  const { window } = await boot({ fetchHandler: memFetch });
  await goHash(window, 'projects/ghost-00000009/memory');
  const msg = window.document.getElementById('projects-msg');
  assert.match(msg.textContent, /project "ghost-00000009" is not registered here/);
  await goHash(window, 'workspaces');
  await goHash(window, 'projects');
  assert.equal(msg.textContent, '', 'the stale error is gone');
});
