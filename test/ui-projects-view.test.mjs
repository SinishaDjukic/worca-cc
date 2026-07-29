// test/ui-projects-view.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  { name: 'alpha', path: '/Users/me/dev/alpha', exists: true },
  { name: 'beta', path: '/Users/me/dev/beta', exists: false },
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
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
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
  assert.equal([...doc.querySelectorAll('#projects-list .pl-item')].length, 3);
});
