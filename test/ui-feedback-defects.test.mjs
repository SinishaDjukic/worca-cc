// test/ui-feedback-defects.test.mjs — #555 defects proven against the booted app.
// D1: a list view's result line used to be cleared by the reload its own action started
// ("Marketplace removed.", "Deleted.") — the user never saw it. A result is a toast now.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { confirmDialog } from './helpers/confirm-modal.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 0));

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._l = {}; WSStub.last = this; }
  send() {}
  close() {}
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  _open() { (this._l.open || []).forEach((f) => f({})); }
}

// `routes` maps "<METHOD> <path>" to { status, body }. Arms are tried in order and a path
// matches by prefix, so list the more specific arms first.
async function boot({ routes = {} } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const arms = Object.entries(routes).map(([k, v]) => { const i = k.indexOf(' '); return [k.slice(0, i), k.slice(i + 1), v]; });
  const answer = ({ status = 200, body = {} }) => Promise.resolve({ ok: status < 400, status, json: async () => body });
  window.fetch = (url, opts) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = (opts && opts.method) || 'GET';
    for (const [m, path, r] of arms) if (m === method && u.startsWith(path)) return answer(r);
    if (u.startsWith('/api/projects')) return answer({ body: { projects: [] } });
    if (u.startsWith('/api/workspaces')) return answer({ body: { workspaces: [] } });
    if (u.startsWith('/api/agents')) return answer({ body: { agents: [], mockWriterRoles: [] } });
    return answer({ body: { config: { steps: {}, customModels: [] }, models: [], efforts: [] } });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame', 'Element']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  const go = async (hash) => {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
    for (let i = 0; i < 6; i += 1) await tick();
  };
  return { window, go };
}

test('#555 D1: a delete success (marketplace / guardrail set / model) survives the view reload as a toast', async () => {
  await checkRows([
    { name: '#555 D1: "Marketplace removed." survives the reload as a toast', run: async () => {
      const { window, go } = await boot({ routes: {
        'DELETE /api/marketplaces/acme': { status: 200, body: {} },
        'POST /api/marketplaces/refresh': { status: 200, body: { marketplaces: [{ id: 'acme', name: 'acme', plugins: [] }] } },
        'GET /api/marketplaces': { status: 200, body: { marketplaces: [{ id: 'acme', name: 'acme', plugins: [] }] } },
        'GET /api/plugins': { status: 200, body: { plugins: [], orphans: [] } },
        'GET /api/chat/status': { status: 200, body: { channels: [] } },
      } });
      await go('marketplace');
      window.document.querySelector('.pl-mkt-remove[data-id="acme"]').click();
      await confirmDialog(window);
      for (let i = 0; i < 10; i++) await tick();
      assert.deepEqual(lastToast(window.document), { tone: 'ok', title: 'Marketplace removed. Installed plugins remain.', detail: '', action: '' });
      assert.equal(window.document.getElementById('plugins-msg').textContent, '');
    } },
    { name: '#555 D1: Guardrails "Deleted." survives the reload as a toast', run: async () => {
      const sets = [{ id: 'gr_acme', name: 'ACME Policy', origin: null,
        settings: { honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: [], deny: [] } }];
      const { window, go } = await boot({ routes: {
        'DELETE /api/guardrails/gr_acme': { status: 200, body: { ok: true } },
        'GET /api/guardrails': { status: 200, body: { guardrails: sets } },
      } });
      await go('settings/guardrails');
      window.document.querySelector('#guardrails-list .grv-delete[data-id="gr_acme"]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      await confirmDialog(window);
      for (let i = 0; i < 10; i++) await tick();
      assert.deepEqual(lastToast(window.document), { tone: 'ok', title: 'Deleted.', detail: '', action: '' });
      assert.equal(window.document.getElementById('guardrails-msg').textContent, '');
    } },
    { name: '#555 D1: Models "Deleted." survives the reload as a toast', run: async () => {
      const { window, go } = await boot({ routes: {
        'GET /api/models/acme-fast/refs': { status: 200, body: {} },
        'DELETE /api/models/acme-fast': { status: 200, body: { ok: true } },
        'GET /api/models': { status: 200, body: { models: [{ id: 'acme-fast', label: 'ACME Fast' }], predefined: [], efforts: [] } },
      } });
      await go('models');
      window.document.querySelector('.mv-delete[data-id="acme-fast"]')
        .dispatchEvent(new window.Event('click', { bubbles: true }));
      await confirmDialog(window);
      for (let i = 0; i < 10; i++) await tick();
      assert.deepEqual(lastToast(window.document), { tone: 'ok', title: 'Deleted.', detail: '', action: '' });
      assert.equal(window.document.getElementById('models-msg').textContent, '');
    } },
  ]);
});

test('#555: a load failure stays on the inline line and raises no toast', async () => {
  const { window, go } = await boot({ routes: {
    'GET /api/guardrails': { status: 500, body: { error: 'store unreadable' } },
  } });
  await go('settings/guardrails');
  const msg = window.document.getElementById('guardrails-msg');
  assert.equal(msg.textContent, 'store unreadable');
  assert.equal(msg.className, 'form-msg err');
  assert.equal(lastToast(window.document), null);
});

test('#555: a plugin uninstall refused with 409 is an error toast whose Details opens the references', async () => {
  const { window, go } = await boot({ routes: {
    'DELETE /api/plugins/acme-jira': { status: 409, body: { error: 'used by saved workflow(s): Docs Flow\nremove it there first', references: [{ kind: 'workflow', id: 'wf_docs', name: 'Docs Flow' }] } },
    'GET /api/plugins': { status: 200, body: { plugins: [{ name: 'acme-jira', version: '1.0.0', enabled: true }], orphans: [] } },
    'GET /api/marketplaces': { status: 200, body: { marketplaces: [] } },
    'POST /api/marketplaces/refresh': { status: 200, body: { marketplaces: [] } },
    'GET /api/chat/status': { status: 200, body: { channels: [] } },
  } });
  await go('marketplace');
  window.document.querySelector('.pl-remove[data-name="acme-jira"], [data-name="acme-jira"] .pl-remove').click();
  await confirmDialog(window);
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(lastToast(window.document), { tone: 'err', title: 'Cannot uninstall acme-jira', detail: 'used by saved workflow(s): Docs Flow', action: 'Details' });
  assert.ok(window.document.getElementById('plugin-modal').classList.contains('hidden'), 'no dialog until Details is pressed');
  window.document.querySelector('#toasts .toast-act').click();
  assert.equal(window.document.getElementById('plugin-modal').classList.contains('hidden'), false);
  assert.match(window.document.getElementById('plugin-modal-body').textContent, /Docs Flow/);
});

test('#555: the model editor Save — a missing id is a field error, a refusal a card alert, success a toast', async () => {
  let patch = { status: 400, body: { error: 'baseUrl must be http(s)' } };
  const { window, go } = await boot({ routes: {
    'PATCH /api/models/acme-fast': { get status() { return patch.status; }, get body() { return patch.body; } },
    'GET /api/models': { status: 200, body: { models: [{ id: 'acme-fast', label: 'ACME Fast' }], predefined: [], efforts: [] } },
  } });
  await go('models');
  const doc = window.document;
  // Add model with no id: the id field says so; nothing is sent.
  doc.getElementById('model-create-btn').click();
  for (let i = 0; i < 4; i++) await tick();
  const add = doc.querySelector('#mv-editor-host .mv-editor');
  add.querySelector('.mv-save').click();
  for (let i = 0; i < 4; i++) await tick();
  const { fieldErrorText, cardAlertOf } = await import('./helpers/feedback.mjs');
  assert.match(fieldErrorText(add.querySelector('.mv-id')), /model id is required/);
  assert.equal(add.querySelector('.mv-editor-msg').textContent, '');
  add.querySelector('.mv-cancel').click();
  for (let i = 0; i < 4; i++) await tick();
  // Edit: the server refuses → a card alert in the editor, which stays open.
  doc.querySelector('.mv-edit[data-id="acme-fast"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  for (let i = 0; i < 4; i++) await tick();
  const editor = doc.querySelector('#mv-editor-host .mv-editor');
  editor.querySelector('.mv-save').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(cardAlertOf(editor), { title: 'Not saved', detail: 'baseUrl must be http(s)' });
  assert.equal(editor.querySelector('.mv-save').dataset.fbState, undefined);
  assert.equal(doc.getElementById('model-editor-modal').classList.contains('hidden'), false);
  // Then it saves: the dialog closes and a toast names the thing.
  patch = { status: 200, body: { ok: true } };
  editor.querySelector('.mv-save').click();
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Model saved.', detail: '', action: '' });
  assert.equal(doc.getElementById('model-editor-modal').classList.contains('hidden'), true);
});

// D3: Sync all, Push now and the "Include my runs" switch used to swallow a refusal.
async function waitFor(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error('waitFor timed out'); await tick(); }
}
const D3_PROJECTS = [
  { name: 'alpha', path: '/p/alpha', exists: true, key: 'alpha-00000001' },
  { name: 'beta', path: '/p/beta', exists: true, key: 'beta-00000002' },
];
const syncBlock = (over = {}) => ({ base: 'dev', remote: 'origin', state: 'up-to-date', ahead: 0, behind: 0, dirty: false,
  checkedOutHere: true, fetchedAt: new Date().toISOString(), stale: false, settings: { beforeRun: true, onDiverged: 'ask' }, ...over });

test('#555 D3: Sync all (500) and Push now (502) refusals are error toasts (Retry where offered)', async () => {
  await checkRows([
    { name: '#555 D3: Sync all refused with 500 is an error toast with Retry', run: async () => {
      const { window, go } = await boot({ routes: {
        'GET /api/sync/projects': { status: 200, body: { projects: { 'alpha-00000001': syncBlock({ state: 'behind', behind: 2 }), 'beta-00000002': syncBlock() } } },
        'POST /api/sync/all': { status: 500, body: { error: 'origin unreachable' } },
        'GET /api/projects': { status: 200, body: { projects: D3_PROJECTS } },
      } });
      await go('projects');
      const btn = window.document.getElementById('projects-sync-all');
      await waitFor(() => !btn.hidden);
      btn.click();
      await waitFor(() => lastToast(window.document));
      assert.deepEqual(lastToast(window.document), { tone: 'err', title: 'Sync all failed', detail: 'origin unreachable', action: 'Retry' });
      assert.equal(btn.disabled, false);
    } },
    { name: '#555 D3: Push now refused with 502 is an error toast', run: async () => {
      const { window, go } = await boot({ routes: {
        'POST /api/team-metrics/flush': { status: 502, body: { error: 'push rejected' } },
        'GET /api/team-metrics/scopes': { status: 200, body: { projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, anyEnabled: false } },
      } });
      await go('team-metrics');
      const section = window.document.querySelector('section[data-view="team-metrics"]');
      const b = Object.assign(window.document.createElement('button'), { type: 'button', className: 'btn-ghost btn-mini tm-push-now', textContent: 'Push now' });
      section.append(b);
      b.click();
      await waitFor(() => lastToast(window.document));
      assert.deepEqual(lastToast(window.document), { tone: 'err', title: 'Push failed', detail: 'push rejected', action: 'Retry' });
    } },
  ]);
});

test('#555 D3: "Include my runs" refused with 500 reverts the switch and raises an error toast', async () => {
  const now = new Date().toISOString();
  const { window, go } = await boot({ routes: {
    'PATCH /api/projects/beta-00000002/team-metrics': { status: 500, body: { error: 'settings unwritable' } },
    'GET /api/team-metrics/scopes': { status: 200, body: { projects: [
      { key: 'alpha-00000001', name: 'alpha', slug: 'me/alpha', hasOrigin: true, enabled: false },
      { key: 'beta-00000002', name: 'beta', slug: 'me/beta', hasOrigin: true, enabled: true, recordsLocally: true, enabledAt: now, record: true, runs: 3, pending: 0 },
    ], workspaces: [], scopes: { projects: [], workspaces: [] }, anyEnabled: true } },
    'GET /api/projects': { status: 200, body: { projects: D3_PROJECTS } },
  } });
  await go('projects');
  await go('projects/beta-00000002/team');
  const doc = window.document;
  await waitFor(() => doc.querySelector('#proj-detail .pd-team-metrics input.tm-record'));
  const cb = doc.querySelector('#proj-detail .pd-team-metrics input.tm-record');
  assert.equal(cb.checked, true);
  cb.checked = false;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => lastToast(doc));
  const t = lastToast(doc);
  assert.equal(t.tone, 'err');
  assert.match(t.title, /^Could not change/);
  assert.equal(t.detail, 'settings unwritable');
  const now2 = doc.querySelector('#proj-detail .pd-team-metrics input.tm-record');
  assert.equal(now2.checked, true, 'the switch is back where it was');
});
