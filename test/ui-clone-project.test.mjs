// test/ui-clone-project.test.mjs
// Projects → Add project → "Clone from URL" (POST /api/projects/clone, a job followed by the
// WS 'clone-changed' frame with a GET poll as the fallback). jsdom, fetch and WS stubbed.
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
  _msg(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}

const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

async function boot({ pick = 'unsupported', clone } = {}) {
  let projects = [{ name: 'alpha', path: '/data/projects/alpha', exists: true, key: 'alpha-00000001' }];
  const calls = [];
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    calls.push({ u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/fs/pick-folder')) return json(200, { status: pick });
    if (u.includes('/api/projects/clone')) {
      const r = clone && clone(u, opts, { setProjects: (p) => { projects = p; } });
      if (r) return r;
    }
    if (u.includes('/api/projects')) return json(200, { projects });
    if (u.includes('/api/history')) return json(200, { pipelines: [], ghAvailable: false });
    return json(200, { config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  window.location.hash = 'projects';
  await tick(); await tick(); await tick();
  return { window, doc: window.document, calls, ws: WSStub.last };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const type = (window, node, v) => { node.value = v; node.dispatchEvent(new window.Event('input', { bubbles: true })); };
const $ = (doc, s) => doc.querySelector(s);
const selected = (doc) => [...doc.querySelectorAll('#proj-add-tabs .md-tab')].find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.mode;

async function openAdd(window, doc) {
  click(window, $(doc, '#project-add-btn'));
  await tick(); await tick();
}

test('no folder picker (container/hosted): Add project opens on Clone from URL', async () => {
  const { window, doc } = await boot({ pick: 'unsupported' });
  await openAdd(window, doc);
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false);
  assert.equal(selected(doc), 'clone');
  assert.equal($(doc, '#proj-add-clone-pane').hidden, false);
  assert.equal($(doc, '#proj-add-folder-pane').hidden, true);
  assert.equal($(doc, '#proj-add-save').textContent, 'Clone and add');
});

test('a picked folder opens on the Folder tab, and the tabs switch panes', async () => {
  const { window, doc } = await boot({ pick: 'picked' });
  window.fetch = ((orig) => (u, o) => (String(u).includes('pick-folder') ? json(200, { status: 'picked', path: '/Users/me/dev/cool' }) : orig(u, o)))(window.fetch);
  globalThis.fetch = window.fetch;
  await openAdd(window, doc);
  assert.equal(selected(doc), 'folder');
  assert.equal($(doc, '#proj-add-path').value, '/Users/me/dev/cool');
  click(window, $(doc, '#proj-add-tab-clone'));
  assert.equal(selected(doc), 'clone');
  assert.equal($(doc, '#proj-add-folder-pane').hidden, true);
  click(window, $(doc, '#proj-add-tab-folder'));
  assert.equal(selected(doc), 'folder');
  assert.equal($(doc, '#proj-add-save').textContent, 'Add project');
});

test('the folder-name placeholder follows the URL', async () => {
  const { window, doc } = await boot();
  await openAdd(window, doc);
  type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api.git');
  assert.equal($(doc, '#proj-clone-name').placeholder, 'api');
  type(window, $(doc, '#proj-clone-url'), 'not a url');
  assert.equal($(doc, '#proj-clone-name').placeholder, 'the repository name');
});

test('an up-front refusal shows the server message inline, and the form stays usable', async () => {
  const { window, doc, calls } = await boot({
    clone: () => json(409, { error: '/data/projects/api already exists; pick another folder name', code: 'exists' }),
  });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-save'));
  assert.equal($(doc, '#proj-add-msg').textContent, 'Repository URL is required.');
  type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api');
  $(doc, '#proj-clone-branch').value = 'dev';
  click(window, $(doc, '#proj-add-save'));
  await tick(); await tick();
  const post = calls.find((c) => c.u.endsWith('/api/projects/clone') && c.method === 'POST');
  assert.deepEqual(post.body, { url: 'https://github.com/acme/api', branch: 'dev' }, 'empty optional fields are not sent');
  assert.match($(doc, '#proj-add-msg').textContent, /already exists/);
  assert.ok($(doc, '#proj-add-msg').classList.contains('err'));
  assert.equal($(doc, '#proj-add-save').disabled, false);
});

test('a running job shows progress; the WS done frame closes the dialog and refreshes the projects', async () => {
  const { window, doc, calls, ws } = await boot({
    clone: (u, o, { setProjects }) => {
      if (o.method === 'POST') {
        setProjects([{ name: 'alpha', path: '/data/projects/alpha', exists: true, key: 'alpha-00000001' }, { name: 'api', path: '/data/projects/api', exists: true, key: 'api-00000002' }]);
        return json(202, { jobId: 'cln_00000001', job: { id: 'cln_00000001', state: 'running' } });
      }
      return json(200, { job: { id: 'cln_00000001', state: 'running' } });
    },
  });
  await openAdd(window, doc);
  type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api');
  click(window, $(doc, '#proj-add-save'));
  await tick(); await tick();
  assert.match($(doc, '#proj-add-msg').textContent, /^Cloning https:\/\/github\.com\/acme\/api …$/);
  assert.equal($(doc, '#proj-add-save').disabled, true, 'locked while cloning');
  assert.equal($(doc, '#proj-clone-url').disabled, true);
  ws._msg({ type: 'clone-changed', job: { id: 'cln_other', state: 'done', project: { name: 'x' } } });
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false, 'another job is ignored');
  ws._msg({ type: 'clone-changed', job: { id: 'cln_00000001', state: 'done', project: { name: 'api', path: '/data/projects/api' } } });
  await tick(); await tick(); await tick();
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), true);
  assert.ok(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'GET').length >= 2, 'the list is refetched');
  assert.match($(doc, '#projects-msg').textContent, /Cloned and added “api”/);
  assert.ok([...doc.querySelectorAll('#projects-list .pl-item')].some((n) => n.textContent.includes('api')), 'the new project is listed');
});

test('without the WS, the poll picks up a failure and shows it (names go in as text)', async () => {
  let polls = 0;
  const { window, doc } = await boot({
    clone: (u, o) => {
      if (o.method === 'POST') return json(202, { jobId: 'cln_00000002', job: { id: 'cln_00000002', state: 'running' } });
      polls += 1;
      return json(200, { job: { id: 'cln_00000002', state: 'error', code: 'auth-failed', error: '<b>GitHub refused the credential</b>' } });
    },
  });
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn) => realSetInterval(fn, 5);
  try {
    await openAdd(window, doc);
    type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/private');
    click(window, $(doc, '#proj-add-save'));
    for (let i = 0; i < 20 && polls === 0; i++) await new Promise((r) => setTimeout(r, 10));
    await tick(); await tick();
  } finally { globalThis.setInterval = realSetInterval; }
  assert.ok(polls >= 1, 'polled');
  const msg = $(doc, '#proj-add-msg');
  assert.equal(msg.textContent, '<b>GitHub refused the credential</b>');
  assert.equal(msg.querySelector('b'), null, 'never parsed as HTML');
  assert.ok(msg.classList.contains('err'));
  assert.equal($(doc, '#proj-add-save').disabled, false, 'unlocked for a retry');
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false);
});
