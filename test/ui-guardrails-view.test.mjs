// test/ui-guardrails-view.test.mjs — full-app-boot jsdom tests for the Guardrails view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const EMPTY = { honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: [], deny: [] };
const SETS = [
  { id: 'permissive', name: 'Permissive', origin: 'builtin', settings: { ...EMPTY } },
  { id: 'normal', name: 'Normal', origin: 'builtin',
    settings: { ...EMPTY, protectedPaths: ['.env*'], deny: ['Bash(git push)', 'Bash(git push:*)'] } },
  { id: 'secure', name: 'Strict', origin: 'builtin',
    settings: { ...EMPTY, envScrub: true, protectedPaths: ['.env*'], deny: ['Bash(curl:*)'] } },
  { id: 'gr_org', name: 'Org Policy', origin: null,
    settings: { ...EMPTY, envScrub: true, envAllowlist: ['NPM_TOKEN'], deny: ['Bash(curl:*)'] } },
];

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
}

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.fetch = (url, opts) => {
    const u = String(url);
    // fetchHandler is the ONLY per-test variation point (fetch is copied by VALUE at boot).
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/guardrails')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ guardrails: SETS }) });
    }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [], channels: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));

async function openGuardrails(window, param = '') {
  window.location.hash = param ? `guardrails/${param}` : 'guardrails';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick();
}

test('index.html registers the view: section + both nav buttons + list/msg/create ids', () => {
  const html = readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('data-view="guardrails"'), 'view section exists');
  assert.equal(html.split('data-nav="guardrails"').length - 1, 2, 'sidebar + topnav buttons');
  for (const id of ['guardrails-list', 'guardrails-msg', 'guardrail-create-btn']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} present`);
  }
});

test('navigating to #guardrails renders the list from GET /api/guardrails (built-ins first, Strict label)', async () => {
  const { window } = await boot();
  await openGuardrails(window);
  const view = window.document.querySelector('[data-view="guardrails"]');
  assert.ok(!view.classList.contains('hidden'), 'view shown');
  const cards = window.document.querySelectorAll('#guardrails-list .grv-card');
  assert.equal(cards.length, 4);
  assert.deepEqual([...cards].map((c) => c.dataset.id), ['permissive', 'normal', 'secure', 'gr_org']);
  assert.equal(cards[2].querySelector('.grv-name').textContent, 'Strict');
  assert.equal(cards[3].querySelector('.grv-delete').dataset.id, 'gr_org');
  assert.equal(cards[0].querySelector('.grv-delete'), null, 'built-in undeletable');
});

test('Create guardrails: dialog opens, Create POSTs {name, settings from start-from}, view reloads and deep-links', async () => {
  const posts = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/guardrails') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 201, json: async () => ({
          guardrails: { id: 'gr_new-set', name: 'New Set', origin: null, settings: SETS[2].settings },
        }) });
      }
      return undefined; // fall through to the boot defaults (GET /api/guardrails serves SETS)
    },
  });
  await openGuardrails(window);
  click(window, window.document.querySelector('#guardrail-create-btn'));
  await tick();
  const modal = window.document.querySelector('#plugin-modal');
  assert.ok(!modal.classList.contains('hidden'), 'create dialog open in the plugin modal');
  modal.querySelector('.grv-create-name').value = 'New Set';
  modal.querySelector('.grv-create-from').value = 'secure';
  const createBtn = [...window.document.querySelectorAll('#plugin-modal-actions button')]
    .find((b) => b.textContent === 'Create');
  click(window, createBtn);
  await tick(); await tick();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].name, 'New Set');
  assert.deepEqual(posts[0].settings, SETS[2].settings, 'start-from seeds the settings');
  assert.ok(modal.classList.contains('hidden'), 'modal closed on success');
  assert.equal(window.location.hash, '#guardrails/gr_new-set', 'deep-links the new set');
});

test('delete flow: confirm -> DELETE; a 409 renders the pinning-run list in the modal', async () => {
  const deletes = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/guardrails/gr_org') && opts.method === 'DELETE') {
        deletes.push(u);
        return Promise.resolve({ ok: false, status: 409, json: async () => ({
          error: 'cannot delete guardrail set "gr_org" — still referenced',
          references: [{ id: 'gr_org', referencedBy: ['pipeline p1'] }],
        }) });
      }
      return undefined;
    },
  });
  await openGuardrails(window);
  click(window, window.document.querySelector('.grv-delete[data-id="gr_org"]'));
  await tick();
  // reusable confirm modal is up — confirm it
  click(window, window.document.querySelector('#confirm-ok'));
  await tick(); await tick();
  assert.equal(deletes.length, 1);
  const modal = window.document.querySelector('#plugin-modal');
  assert.ok(!modal.classList.contains('hidden'), '409 modal shown');
  assert.match(modal.querySelector('.grv-refs409 .mono').textContent, /pipeline p1/);
});
