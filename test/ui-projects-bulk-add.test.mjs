// test/ui-projects-bulk-add.test.mjs
// JSDOM tests for adding several projects at once from the Projects view: Add project -> the dialog's
// Choose folder… (native multi-pick) -> review list -> POST /api/projects/bulk -> partial success reported per row and in #projects-msg.
// (boot/WSStub/tick/click/goProjects/PROJECTS: copied from test/ui-projects-view.test.mjs)
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast, cardAlertOf } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick, pressEscape, discardPrompt, discardChanges } from './helpers/popups.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts) => {
    const u = String(url);
    // A local worca: a native folder picker exists, so Add project opens the dialog on its Folder tab.
    if (u.includes('/api/fs/pick-folder') && ((opts && opts.method) || 'GET') === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => ({ available: true }) });
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.includes('/api/history')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [], ghAvailable: false }) });
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

// Add project opens the dialog; its Choose folder… opens the native picker (#649).
async function addAndChoose(window) {
  click(window, window.document.querySelector('#project-add-btn'));
  await tick(); await tick();
  click(window, window.document.querySelector('#proj-add-browse'));
  await tick(); await tick();
}

const json = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

test('Add project → Choose folder… with several picked folders opens the review; an already-registered folder starts unticked', async () => {
  const { window } = await boot({
    fetchHandler: (u) => (u.includes('/api/fs/pick-folder')
      ? json({ status: 'picked', path: '/Users/me/dev/cool', paths: ['/Users/me/dev/cool', '/Users/me/dev/alpha', '/Users/me/dev/zed'] })
      : null),
  });
  await goProjects(window);
  const doc = window.document;
  await addAndChoose(window);
  assert.ok(doc.querySelector('#project-add-modal').classList.contains('hidden'), 'the single dialog gives way to the review');
  assert.ok(!doc.querySelector('#project-bulk-modal').classList.contains('hidden'));
  const rows = [...doc.querySelectorAll('#proj-bulk-list .pb-row')];
  assert.equal(rows.length, 3);
  assert.equal(rows[1].querySelector('.pb-include').checked, false, 'alpha is already registered');
  assert.match(rows[1].querySelector('.pb-status').textContent, /already registered as “alpha”/);
  assert.equal(doc.querySelector('#proj-bulk-save').textContent, 'Add 2 projects');
});

test('partial success: added rows lock, skipped rows show the reason, a rename + Add retries only those', async () => {
  const posts = [];
  let round = 0;
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      // A DIFFERENT folder named beta (registered beta lives at /Users/me/dev/beta): a name clash, not a registered path.
      if (u.includes('/api/fs/pick-folder')) return json({ status: 'picked', path: '/Users/me/dev/cool', paths: ['/Users/me/dev/cool', '/Users/me/other/beta'] });
      if (u.endsWith('/api/projects/bulk')) {
        posts.push(JSON.parse(opts.body));
        round += 1;
        if (round === 1) {
          return json({ projects: [...PROJECTS, { key: 'cool-1', name: 'cool', path: '/Users/me/dev/cool', exists: true }], results: [
            { index: 0, status: 'added', name: 'cool', path: '/Users/me/dev/cool' },
            { index: 1, status: 'skipped', name: 'beta', path: '/Users/me/other/beta', reason: 'a project named "beta" already exists' },
          ] });
        }
        return json({ projects: [...PROJECTS], results: [{ index: 0, status: 'added', name: 'beta-2', path: '/Users/me/other/beta' }] });
      }
      return null;
    },
  });
  await goProjects(window);
  const doc = window.document;
  await addAndChoose(window);
  click(window, doc.querySelector('#proj-bulk-save'));
  await tick(); await tick(); await tick();
  assert.equal(posts[0].projects.length, 2);
  assert.ok(!doc.querySelector('#project-bulk-modal').classList.contains('hidden'), 'stays open with a skipped row');
  let rows = [...doc.querySelectorAll('#proj-bulk-list .pb-row')];
  assert.ok(rows[0].classList.contains('added'));
  assert.equal(rows[0].querySelector('.pb-name').disabled, true);
  assert.match(rows[1].querySelector('.pb-status').textContent, /already exists/);
  const alert = cardAlertOf(doc.querySelector('#project-bulk-modal .card'));
  assert.equal(alert.title, 'Not every project was added', 'a refusal is a card alert on the dialog (#555)');
  assert.match(alert.detail, /Added 1\. 1 could not be added/);
  assert.equal(doc.querySelector('#proj-bulk-msg').textContent, '');

  const name = rows[1].querySelector('.pb-name');
  name.value = 'beta-2'; name.dispatchEvent(new window.Event('input', { bubbles: true }));
  click(window, doc.querySelector('#proj-bulk-save'));
  await tick(); await tick(); await tick();
  assert.deepEqual(posts[1], { projects: [{ name: 'beta-2', path: '/Users/me/other/beta' }] }, 'only the skipped row is re-sent');
  assert.ok(doc.querySelector('#project-bulk-modal').classList.contains('hidden'), 'nothing left skipped -> closes');
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Added 2 projects.', detail: '', action: '' });
});

test('unticking every row disables Add; Escape then asks first (unticked rows are a change) and Discard closes without a request', async () => {
  let posted = 0;
  const { window } = await boot({
    fetchHandler: (u) => {
      if (u.includes('/api/fs/pick-folder')) return json({ status: 'picked', path: '/a/one', paths: ['/a/one', '/a/two'] });
      if (u.endsWith('/api/projects/bulk')) { posted += 1; return json({ projects: PROJECTS, results: [] }); }
      return null;
    },
  });
  await goProjects(window);
  const doc = window.document;
  await addAndChoose(window);
  for (const cb of doc.querySelectorAll('#proj-bulk-list .pb-include')) { cb.checked = false; cb.dispatchEvent(new window.Event('change', { bubbles: true })); }
  assert.equal(doc.querySelector('#proj-bulk-save').disabled, true);
  pressEscape(window);
  assert.ok(discardPrompt(doc), 'asks first');
  assert.equal(doc.querySelector('#project-bulk-modal').classList.contains('hidden'), false);
  discardChanges(doc);
  await tick();
  assert.ok(doc.querySelector('#project-bulk-modal').classList.contains('hidden'));
  assert.equal(posted, 0);
  assert.equal(doc.querySelector('#projects-msg').textContent, '', 'nothing added, nothing skipped -> no message');
});

test('Add projects: a backdrop click never closes it; the footer Cancel next to Add closes at once, edits and all', async () => {
  const { window } = await boot({
    fetchHandler: (u) => (u.includes('/api/fs/pick-folder') ? json({ status: 'picked', path: '/a/one', paths: ['/a/one', '/a/two'] }) : null),
  });
  await goProjects(window);
  const doc = window.document;
  await addAndChoose(window);
  const modal = doc.querySelector('#project-bulk-modal');
  const name = doc.querySelector('#proj-bulk-list .pb-name');
  name.value = 'renamed';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  backdropClick(window, modal);
  assert.equal(modal.classList.contains('hidden'), false, 'never on a backdrop click');
  assert.equal(doc.querySelector('#proj-bulk-list .pb-name').value, 'renamed');
  assert.deepEqual([...modal.querySelectorAll('.confirm-actions button')].map((b) => [b.id, b.textContent]),
    [['proj-bulk-close', 'Cancel'], ['proj-bulk-save', 'Add 2 projects']]);
  assert.equal(modal.querySelector('.card-head button'), null, 'no header Close any more');
  click(window, doc.querySelector('#proj-bulk-close'));
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(discardPrompt(doc), null, 'Cancel never asks');
});

test('one native pick fills the single Add dialog; several picks from Choose folder… open the review list', async () => {
  // Each row boots with its own pick-folder answer (one path, then two).
  await checkRows([
    { name: 'a single native pick fills the Add dialog it was chosen from', run: async () => {
      const { window } = await boot({
        fetchHandler: (u) => (u.includes('/api/fs/pick-folder') ? json({ status: 'picked', path: '/Users/me/dev/solo', paths: ['/Users/me/dev/solo'] }) : null),
      });
      await goProjects(window);
      const doc = window.document;
      await addAndChoose(window);
      assert.ok(!doc.querySelector('#project-add-modal').classList.contains('hidden'));
      assert.equal(doc.querySelector('#proj-add-path').value, '/Users/me/dev/solo');
      assert.ok(doc.querySelector('#project-bulk-modal').classList.contains('hidden'));
    } },
    { name: 'Choose folder… with several native picks swaps the Add dialog for the review list', run: async () => {
      const { window } = await boot({
        fetchHandler: (u) => (u.includes('/api/fs/pick-folder') ? json({ status: 'picked', path: '/p/a', paths: ['/p/a', '/p/b'] }) : null),
      });
      await goProjects(window);
      const doc = window.document;
      window.__projects.openProjectAddModal('');
      click(window, doc.querySelector('#proj-add-browse'));
      await tick(); await tick();
      assert.ok(doc.querySelector('#project-add-modal').classList.contains('hidden'));
      assert.ok(!doc.querySelector('#project-bulk-modal').classList.contains('hidden'));
    } },
  ]);
});

test('project names from the folder go in as text, never HTML', async () => {
  const { window } = await boot({
    fetchHandler: (u) => (u.includes('/api/fs/pick-folder') ? json({ status: 'picked', path: '/p/<img src=x>', paths: ['/p/<img src=x>', '/p/b'] }) : null),
  });
  await goProjects(window);
  const doc = window.document;
  await addAndChoose(window);
  assert.equal(doc.querySelector('#proj-bulk-list img'), null);
  assert.equal(doc.querySelector('#proj-bulk-list .pb-path').textContent, '/p/<img src=x>');
});

test('while Add is posting, Cancel is disabled and Escape does nothing; a refusal hands the way out back', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { window } = await boot({
    fetchHandler: (u) => {
      if (u.includes('/api/fs/pick-folder')) return json({ status: 'picked', path: '/a/one', paths: ['/a/one', '/a/two'] });
      if (u.endsWith('/api/projects/bulk')) return gate;
      return null;
    },
  });
  await goProjects(window);
  const doc = window.document;
  await addAndChoose(window);
  const modal = doc.querySelector('#project-bulk-modal');
  const name = doc.querySelector('#proj-bulk-list .pb-name');
  name.value = 'renamed';                                      // a change: Escape would ask, if it answered at all
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  click(window, doc.querySelector('#proj-bulk-save'));
  await tick();
  assert.equal(doc.querySelector('#proj-bulk-close').disabled, true, 'no way out while the request is out');
  click(window, doc.querySelector('#proj-bulk-close'));        // a synthetic click reaches a disabled button: cancel() must hold too
  pressEscape(window);
  assert.equal(discardPrompt(doc), null, 'not even the question');
  assert.equal(modal.classList.contains('hidden'), false);
  release(await json({ error: 'disk full' }, 500));
  await tick(); await tick();
  assert.equal(modal.classList.contains('hidden'), false, 'a refusal keeps the dialog');
  assert.equal(doc.querySelector('#proj-bulk-close').disabled, false, 'Cancel is back');
  pressEscape(window);
  assert.ok(discardPrompt(doc), 'and Escape answers again: the rename asks first');
  discardChanges(doc);
  await tick();
  assert.equal(modal.classList.contains('hidden'), true);
});
