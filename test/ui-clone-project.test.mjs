// test/ui-clone-project.test.mjs
// Projects → Add project → "Clone from URL" (POST /api/projects/clone, a job followed by the
// WS 'clone-changed' frame with a GET poll as the fallback). jsdom, fetch and WS stubbed.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick, dragOut, pressEscape, discardPrompt, keepEditing, discardChanges } from './helpers/popups.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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

// `picker`: GET /api/fs/pick-folder's answer (can a native dialog open here); `pick`: what the dialog
// itself answers when Choose folder… opens it (POST).
async function boot({ picker = false, pick = 'unsupported', clone } = {}) {
  let projects = [{ name: 'alpha', path: '/data/projects/alpha', exists: true, key: 'alpha-00000001' }];
  const calls = [];
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    calls.push({ u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/fs/pick-folder')) {
      if ((opts.method || 'GET') === 'GET') return json(200, { available: picker });
      return json(200, pick === 'picked' ? { status: 'picked', path: '/Users/me/dev/cool' } : { status: pick });
    }
    if (u.startsWith('/api/git')) return json(200, { available: true, version: '2.50.0', reason: 'ok', checkedAt: 0 });
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

async function openClone(window, doc) { await openAdd(window, doc); click(window, $(doc, '#proj-add-tab-clone')); }

const pickerOpens = (calls) => calls.filter((c) => c.u.includes('/api/fs/pick-folder') && c.method === 'POST').length;

test('Add project opens the dialog first, on New — folder picker or not — and the tabs switch panes (#649)', async () => {
  await checkRows([
    { name: 'no folder picker (container/hosted): Add project opens on New', run: async () => {
      const { window, doc, calls } = await boot({ picker: false });
      await openAdd(window, doc);
      assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false);
      assert.equal(selected(doc), 'new');
      assert.equal($(doc, '#proj-add-new-pane').hidden, false);
      assert.equal($(doc, '#proj-add-folder-pane').hidden, true);
      assert.equal($(doc, '#proj-add-clone-pane').hidden, true);
      assert.equal($(doc, '#proj-add-save').textContent, 'Create project');
      assert.equal(pickerOpens(calls), 0);
    } },
    { name: 'a folder picker here: the dialog opens on New (canvas AddNew) without opening the picker, and the tabs switch panes', run: async () => {
      const { window, doc, calls } = await boot({ picker: true, pick: 'picked' });
      await openAdd(window, doc);
      assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false);
      assert.equal(pickerOpens(calls), 0, 'the OS folder picker waits for Choose folder…');
      assert.equal(selected(doc), 'new');
      click(window, $(doc, '#proj-add-tab-folder'));
      assert.equal(selected(doc), 'folder');
      assert.equal($(doc, '#proj-add-path').value, '');
      assert.equal($(doc, '#proj-add-msg').textContent, '', 'no "picker unavailable" hint where one exists');
      assert.equal($(doc, '#proj-add-tab-clone').disabled, false);
      click(window, $(doc, '#proj-add-tab-clone'));
      assert.equal(selected(doc), 'clone');
      assert.equal($(doc, '#proj-add-folder-pane').hidden, true);
      click(window, $(doc, '#proj-add-tab-folder'));
      assert.equal(selected(doc), 'folder');
      assert.equal($(doc, '#proj-add-save').textContent, 'Add project');
    } },
    { name: 'Choose folder… opens the picker and fills the folder and the name', run: async () => {
      const { window, doc, calls } = await boot({ picker: true, pick: 'picked' });
      await openAdd(window, doc);
      click(window, $(doc, '#proj-add-tab-folder'));
      click(window, $(doc, '#proj-add-browse'));
      await tick(); await tick();
      assert.equal(pickerOpens(calls), 1);
      assert.equal($(doc, '#proj-add-path').value, '/Users/me/dev/cool');
      assert.equal($(doc, '#proj-add-name').value, 'cool');
      assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false);
    } },
  ]);
});

test('cancelling the folder picker keeps the dialog open, and the repository can still be cloned without a folder (#649)', async () => {
  const { window, doc, calls, ws } = await boot({
    picker: true, pick: 'canceled',
    clone: (u, o) => (o.method === 'POST' ? json(202, { jobId: 'cln_00000003', job: { id: 'cln_00000003', state: 'running' } }) : json(200, { job: { id: 'cln_00000003', state: 'running' } })),
  });
  await openAdd(window, doc);
  click(window, $(doc, '#proj-add-tab-folder'));
  click(window, $(doc, '#proj-add-browse'));
  await tick(); await tick();
  assert.equal(pickerOpens(calls), 1);
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), false, 'a cancel closes only the picker');
  assert.equal($(doc, '#proj-add-path').value, '');
  click(window, $(doc, '#proj-add-tab-clone'));
  type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api');
  click(window, $(doc, '#proj-add-save'));
  await tick(); await tick();
  const post = calls.find((c) => c.u.endsWith('/api/projects/clone') && c.method === 'POST');
  assert.deepEqual(post && post.body, { url: 'https://github.com/acme/api' });
  assert.match($(doc, '#proj-add-msg').textContent, /^Cloning https:\/\/github\.com\/acme\/api …$/);
  ws._msg({ type: 'clone-changed', job: { id: 'cln_00000003', state: 'done', project: { name: 'api', path: '/data/projects/api' } } });
  await tick(); await tick();
  assert.equal($(doc, '#project-add-modal').classList.contains('hidden'), true, 'the clone lands and the dialog closes');
});

test('clone form: no hint paragraph (U17); the folder placeholder is the folder planClone will create (n9)', async () => {
  const { window, doc } = await boot({ pick: 'unsupported' });
  await openClone(window, doc);
  assert.equal($(doc, '#proj-add-msg').textContent, '');
  for (const [url, want] of [
    ['https://github.com/acme/api.git', 'api'],
    ['https://dev.azure.com/acme/Shop/_git/api', 'api'],
    ['https://dev.azure.com/acme/Shop/_git/api.git', 'api'],
    ['https://acme@dev.azure.com/acme/My%20Project/_git/My%20Repo', 'My-Repo'],
    ['https://dev.azure.com/acme/_git/Shop', 'Shop'],
  ]) {
    type(window, $(doc, '#proj-clone-url'), url);
    assert.equal($(doc, '#proj-clone-name').placeholder, want, url);
  }
  type(window, $(doc, '#proj-clone-url'), 'not a url');
  assert.equal($(doc, '#proj-clone-name').placeholder, 'the repository name');
});

test('an up-front refusal shows the server message inline, and the form stays usable', async () => {
  const { window, doc, calls } = await boot({
    clone: () => json(409, { error: '/data/projects/api already exists; pick another folder name', code: 'exists' }),
  });
  await openClone(window, doc);
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
  await openClone(window, doc);
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
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Cloned and added “api”.', detail: '', action: '' });
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
    await openClone(window, doc);
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

// ---- The pop-up rules (ui/public/modal-guard.mjs) on Add project --------------------------------
const folderAdd = async () => {             // a folder picker here: the dialog opens on New, then its Folder tab (#649)
  const ctx = await boot({ picker: true, pick: 'picked' });
  await openAdd(ctx.window, ctx.doc);
  click(ctx.window, $(ctx.doc, '#proj-add-tab-folder'));
  return ctx;
};
const isHidden = (doc) => $(doc, '#project-add-modal').classList.contains('hidden');
const running = (id) => (u, o) => (o.method === 'POST'
  ? json(202, { jobId: id, job: { id, state: 'running' } })
  : json(200, { job: { id, state: 'running' } }));

test('a backdrop click never closes Add project: what was typed stays, and a selection dragged out of a field does not close it either', async () => {
  const { window, doc } = await folderAdd();
  const modal = $(doc, '#project-add-modal');
  assert.equal(selected(doc), 'folder');
  type(window, $(doc, '#proj-add-name'), 'shop');
  type(window, $(doc, '#proj-add-path'), '/Users/me/dev/shop');
  backdropClick(window, modal);
  dragOut(window, $(doc, '#proj-add-path'), modal);
  await tick();
  assert.equal(isHidden(doc), false, 'still open');
  assert.equal($(doc, '#proj-add-name').value, 'shop');
  assert.equal($(doc, '#proj-add-path').value, '/Users/me/dev/shop');
  assert.equal(discardPrompt(doc), null, 'and nothing is asked');
});

test('Add project: Cancel sits in the footer next to Add and closes at once; Escape closes it untouched and asks once it changed', async () => {
  await checkRows([
    { name: 'the footer holds Cancel then the primary action; the header has no Close any more', run: async () => {
      const { doc } = await folderAdd();
      const footer = [...doc.querySelectorAll('#project-add-modal .confirm-actions button')].map((b) => [b.id, b.textContent]);
      assert.deepEqual(footer, [['proj-add-cancel', 'Cancel'], ['proj-add-save', 'Add project']]);
      assert.equal(doc.querySelector('#project-add-modal .card-head button'), null);
    } },
    { name: 'Cancel closes a changed dialog without asking and sends nothing', run: async () => {
      const { window, doc, calls } = await folderAdd();
      type(window, $(doc, '#proj-add-name'), 'shop');
      click(window, $(doc, '#proj-add-cancel'));
      assert.equal(isHidden(doc), true);
      assert.equal(discardPrompt(doc), null);
      assert.equal(calls.filter((c) => c.u.endsWith('/api/projects') && c.method === 'POST').length, 0);
    } },
    { name: 'Escape closes an untouched dialog; a folder from Choose folder… is a change, so Escape then asks', run: async () => {
      const { window, doc } = await folderAdd();
      pressEscape(window);
      assert.equal(discardPrompt(doc), null);
      assert.equal(isHidden(doc), true);
      await openAdd(window, doc);
      click(window, $(doc, '#proj-add-tab-folder'));                // the dialog opens on New: Choose folder… is on Folder
      click(window, $(doc, '#proj-add-browse'));
      await tick(); await tick();
      assert.equal($(doc, '#proj-add-path').value, '/Users/me/dev/cool');
      pressEscape(window);
      assert.ok(discardPrompt(doc), 'the picked folder is the user\'s choice');
      discardChanges(doc);
      await tick();
      assert.equal(isHidden(doc), true);
    } },
    { name: 'Escape over a changed dialog asks: Keep editing keeps it and the text, Discard closes it', run: async () => {
      const { window, doc } = await folderAdd();
      type(window, $(doc, '#proj-add-name'), 'shop');
      pressEscape(window);
      assert.ok(discardPrompt(doc), 'asks first');
      keepEditing(doc);
      await tick();
      assert.equal(isHidden(doc), false);
      assert.equal($(doc, '#proj-add-name').value, 'shop');
      pressEscape(window);
      discardChanges(doc);
      await tick();
      assert.equal(isHidden(doc), true);
    } },
  ]);
});

test('while Add is posting, Cancel is disabled and Escape does nothing; the answer closes the dialog', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { window, doc } = await folderAdd();
  window.fetch = ((orig) => (u, o = {}) => (String(u).endsWith('/api/projects') && o.method === 'POST' ? gate : orig(u, o)))(window.fetch);
  globalThis.fetch = window.fetch;
  type(window, $(doc, '#proj-add-name'), 'shop');
  type(window, $(doc, '#proj-add-path'), '/Users/me/dev/shop');
  click(window, $(doc, '#proj-add-save'));
  await tick();
  assert.equal($(doc, '#proj-add-cancel').disabled, true, 'no way out while the request is out');
  pressEscape(window);
  assert.equal(discardPrompt(doc), null);
  assert.equal(isHidden(doc), false);
  release({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'shop', path: '/Users/me/dev/shop', exists: true, key: 'shop-00000009' }] }) });
  await tick(); await tick();
  assert.equal(isHidden(doc), true, 'the answer closes it');
  assert.equal($(doc, '#proj-add-cancel').disabled, false);
});

test('while the clone\'s start request is out, Cancel is disabled and Escape does nothing; its answer turns the way out into Hide', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { window, doc } = await boot({
    clone: (u, o) => (o.method === 'POST' ? gate : json(200, { job: { id: 'cln_00000005', state: 'running' } })),
  });
  await openClone(window, doc);                                // the Clone tab
  type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api');
  click(window, $(doc, '#proj-add-save'));
  await tick();
  const way = $(doc, '#proj-add-cancel');
  assert.equal(way.disabled, true, 'no way out while the request is out');
  assert.equal(way.textContent, 'Cancel', 'no clone runs yet, so nothing to hide');
  click(window, way);                                          // a synthetic click reaches a disabled button: cancel() must hold too
  pressEscape(window);
  assert.equal(discardPrompt(doc), null);
  assert.equal(isHidden(doc), false);
  release(await json(202, { jobId: 'cln_00000005', job: { id: 'cln_00000005', state: 'running' } }));
  await tick(); await tick();
  assert.equal(way.disabled, false);
  assert.equal(way.textContent, 'Hide');
  assert.equal(isHidden(doc), false, 'the dialog stays: it shows the progress');
  pressEscape(window);                                         // free again: over a running clone Escape loses nothing
  assert.equal(discardPrompt(doc), null);
  assert.equal(isHidden(doc), true);
});

test('while a clone runs the way out says Hide: hiding keeps the clone going with a note, and its result replaces that note', async () => {
  const { window, doc, ws } = await boot({ clone: running('cln_00000003') });
  await openClone(window, doc);                                // the Clone tab
  type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api');
  click(window, $(doc, '#proj-add-save'));
  await tick(); await tick();
  const way = $(doc, '#proj-add-cancel');
  assert.equal(way.textContent, 'Hide');
  assert.equal(way.disabled, false);
  backdropClick(window, $(doc, '#project-add-modal'));
  assert.equal(isHidden(doc), false, 'not on a backdrop click');
  click(window, way);
  assert.equal(isHidden(doc), true);
  assert.deepEqual(lastToast(doc), { tone: 'info', title: 'Cloning in the background',
    detail: 'https://github.com/acme/api. A notification says when it is done.', action: '' });
  window.__projects.openProjectAddModal('');                   // reopened: the progress, locked
  assert.equal(selected(doc), 'clone');
  assert.match($(doc, '#proj-add-msg').textContent, /^Cloning https:\/\/github\.com\/acme\/api …$/);
  pressEscape(window);                                         // locked fields, work goes on: no question
  assert.equal(discardPrompt(doc), null);
  assert.equal(isHidden(doc), true);
  ws._msg({ type: 'clone-changed', job: { id: 'cln_00000003', state: 'done', project: { name: 'api', path: '/data/projects/api' } } });
  await tick(); await tick(); await tick();
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Cloned and added “api”.', detail: '', action: '' });
  assert.equal([...doc.querySelectorAll('#toasts .toast')].some((t) => t.textContent.includes('Cloning in the background')), false,
    'the background note is gone');
});

test('a folder picked while a clone runs opens on Folder and can be added; the clone ending leaves that dialog open and reports by toast', async () => {
  const { window, doc, ws } = await boot({ clone: running('cln_00000004') });
  await openClone(window, doc);
  type(window, $(doc, '#proj-clone-url'), 'https://github.com/acme/api');
  click(window, $(doc, '#proj-add-save'));
  await tick(); await tick();
  click(window, $(doc, '#proj-add-cancel'));                   // Hide
  window.__projects.openProjectAddModal('/Users/me/dev/cool'); // what a native pick does
  assert.equal(selected(doc), 'folder');
  assert.equal($(doc, '#proj-add-path').value, '/Users/me/dev/cool');
  assert.match($(doc, '#proj-add-msg').textContent, /^Still cloning https:\/\/github\.com\/acme\/api/);
  assert.equal($(doc, '#proj-add-save').disabled, false, 'the Folder tab works during a clone');
  assert.equal($(doc, '#proj-add-cancel').textContent, 'Cancel');
  click(window, $(doc, '#proj-add-tab-clone'));
  assert.equal($(doc, '#proj-add-save').disabled, true, 'the Clone tab shows the running clone, locked');
  assert.equal($(doc, '#proj-add-cancel').textContent, 'Hide');
  click(window, $(doc, '#proj-add-tab-folder'));
  ws._msg({ type: 'clone-changed', job: { id: 'cln_00000004', state: 'done', project: { name: 'api', path: '/data/projects/api' } } });
  await tick(); await tick(); await tick();
  assert.equal(isHidden(doc), false, 'the folder being added stays');
  assert.equal($(doc, '#proj-add-path').value, '/Users/me/dev/cool');
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Cloned and added “api”.', detail: '', action: '' });
});

test('the in-app folder browser over Add project takes Escape and backdrop clicks alone, and has a footer Cancel', async () => {
  const { window, doc } = await folderAdd();
  window.fetch = ((orig) => (u, o) => (String(u).includes('/api/fs/dirs') ? json(200, { path: '/Users/me', parent: '/Users', dirs: [] }) : orig(u, o)))(window.fetch);
  globalThis.fetch = window.fetch;
  click(window, $(doc, '#proj-add-browse-many'));                  // multi mode, straight to Worca's browser
  await tick(); await tick();
  const browser = $(doc, '#folder-browser');
  assert.equal(browser.classList.contains('hidden'), false);
  assert.deepEqual([...browser.querySelectorAll('.add-project-actions button:not(.hidden)')].map((b) => b.textContent),
    ['Cancel', 'Select this folder', 'Add selected'], 'multi mode: Cancel, then the two picks');
  assert.equal(browser.querySelector('.card-head button'), null, 'no header Close any more');
  backdropClick(window, browser);
  assert.equal(browser.classList.contains('hidden'), false, 'a picker never closes on a backdrop click');
  pressEscape(window);
  assert.equal(browser.classList.contains('hidden'), true, 'Escape closes the browser (nothing ticked)');
  assert.equal(isHidden(doc), false, 'Add project, under it, stays');
});
