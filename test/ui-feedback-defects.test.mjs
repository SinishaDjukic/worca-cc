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
import { lastToast, edit } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick, pressEscape, discardPrompt, keepEditing, discardChanges } from './helpers/popups.mjs';

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
      await go('marketplace/marketplaces');
      const doc = window.document;
      doc.querySelector('.mk-mkt-more[data-id="acme"]').click();
      [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === 'Remove…').click();
      for (let i = 0; i < 4; i++) await tick();
      doc.querySelector('#mk-dialog[data-kind="remove-marketplace"] .mk-confirm').click();
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

test('#555: a plugin remove refused with 409 stays inside the Remove dialog — no toast, no other dialog', async () => {
  const { window, go } = await boot({ routes: {
    'DELETE /api/plugins/acme-jira': { status: 409, body: { error: 'used by saved workflow(s): Docs Flow\nremove it there first', references: [{ workflowId: 'wf_docs', name: 'Docs Flow', keys: ['triager'] }] } },
    'GET /api/plugins/acme-jira/references': { status: 200, body: { references: [] } },
    'GET /api/plugins/acme-jira': { status: 200, body: { plugin: { name: 'acme-jira' }, inventory: { agents: [{ key: 'triager' }] }, repo: null, subdir: '', sha: 'a'.repeat(40), installedAt: null, updatedAt: null, webUrl: null } },
    'GET /api/plugins': { status: 200, body: { plugins: [{ name: 'acme-jira', version: '1.0.0', enabled: true }], orphans: [] } },
    'GET /api/marketplaces': { status: 200, body: { marketplaces: [] } },
    'POST /api/marketplaces/refresh': { status: 200, body: { marketplaces: [] } },
    'GET /api/chat/status': { status: 200, body: { channels: [] } },
  } });
  await go('marketplace/installed');
  const doc = window.document;
  doc.querySelector('section.mk-all .mk-more[data-name="acme-jira"]').click();
  [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')].find((b) => b.textContent === 'Remove…').click();
  for (let i = 0; i < 10; i++) await tick();
  const dlg = doc.getElementById('mk-dialog');
  assert.equal(dlg.dataset.kind, 'remove');
  dlg.querySelector('[data-dlg="remove"]').click();
  for (let i = 0; i < 10; i++) await tick();
  const err = dlg.querySelector('.mk-dlg-err');
  assert.deepEqual([err.hidden, err.textContent], [false, 'used by saved workflow(s): Docs Flow']);
  assert.equal(lastToast(doc), null, 'no toast');
  assert.ok(doc.getElementById('plugin-modal').classList.contains('hidden'), 'no other dialog');
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
  assert.ok(doc.querySelector('#mv-editor-host .mv-editor.dlg > .dlg-foot .mv-editor-btns'), 'the shared dialog anatomy');
  editor.querySelector('.mv-save').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(cardAlertOf(editor), { title: 'Not saved', detail: 'baseUrl must be http(s)' });
  assert.ok(editor.querySelector(':scope > .dlg-foot > .card-alert'), 'the alert stays in the pinned foot');
  assert.equal(editor.children.length, 3);
  assert.equal(editor.querySelector('.mv-save').dataset.fbState, undefined);
  assert.equal(doc.getElementById('model-editor-modal').classList.contains('hidden'), false);
  // Then it saves: the dialog closes and a toast names the thing.
  patch = { status: 200, body: { ok: true } };
  editor.querySelector('.mv-save').click();
  for (let i = 0; i < 10; i++) await tick();
  assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Model saved.', detail: '', action: '' });
  assert.equal(doc.getElementById('model-editor-modal').classList.contains('hidden'), true);
});

test('model editor: never on a backdrop click; Escape over a change asks ("This model has unsaved changes."); Cancel closes at once', async () => {
  const { window, go } = await boot({ routes: {
    'GET /api/models': { status: 200, body: { models: [{ id: 'acme-fast', label: 'ACME Fast' }], predefined: [], efforts: [] } },
  } });
  await go('settings/models');
  const doc = window.document;
  doc.getElementById('model-create-btn').click();
  for (let i = 0; i < 4; i++) await tick();
  const modal = doc.getElementById('model-editor-modal');
  const idField = doc.querySelector('#mv-editor-host .mv-id');
  idField.value = 'acme-new';
  idField.dispatchEvent(new window.Event('input', { bubbles: true }));
  backdropClick(window, modal);
  assert.equal(modal.classList.contains('hidden'), false);
  pressEscape(window);
  assert.equal(discardPrompt(doc).querySelector('.confirm-message').textContent, 'This model has unsaved changes.');
  keepEditing(doc);
  for (let i = 0; i < 2; i++) await tick();
  doc.querySelector('#mv-editor-host .mv-cancel').click();
  assert.equal(modal.classList.contains('hidden'), true, 'Cancel never asks');
  assert.equal(discardPrompt(doc), null);
});

test('model editor: an env row added or removed is a change, so Escape asks with nothing typed (D12)', async () => {
  const { window, go } = await boot({ routes: {
    'GET /api/models': { status: 200, body: { models: [{ id: 'acme-env', label: 'ACME Env', env: { ANTHROPIC_BASE_URL: '••••••e/v1' } }], predefined: [], efforts: [] } },
  } });
  await go('settings/models');
  const doc = window.document;
  const modal = doc.getElementById('model-editor-modal');
  const envRows = () => doc.querySelectorAll('#mv-editor-host .mv-env-row').length;
  await checkRows([
    { name: '"+ env var" on a new model: Escape asks; Keep editing keeps the row', run: async () => {
      doc.getElementById('model-create-btn').click();
      for (let i = 0; i < 4; i++) await tick();
      doc.querySelector('#mv-editor-host .mv-env-add').click();
      assert.equal(envRows(), 1);
      pressEscape(window);
      assert.equal(discardPrompt(doc).querySelector('.confirm-message').textContent, 'This model has unsaved changes.');
      keepEditing(doc);
      await tick();
      assert.equal(envRows(), 1, 'the row is still there');
      doc.querySelector('#mv-editor-host .mv-cancel').click();
      assert.equal(modal.classList.contains('hidden'), true);
    } },
    { name: 'a model\'s env row removed: Escape asks; Discard closes', run: async () => {
      doc.querySelector('.mv-edit[data-id="acme-env"]').click();
      for (let i = 0; i < 4; i++) await tick();
      assert.equal(envRows(), 1);
      doc.querySelector('#mv-editor-host .mv-env-row .mv-env-rm').click();
      assert.equal(envRows(), 0);
      pressEscape(window);
      assert.ok(discardPrompt(doc), 'asks first');
      discardChanges(doc);
      await tick();
      assert.equal(modal.classList.contains('hidden'), true);
    } },
  ]);
});

test('model import: never on a backdrop click; a typed base URL makes Escape ask; the list filter is a view, not a change', async () => {
  const { window, go } = await boot({ routes: {
    'GET /api/models': { status: 200, body: { models: [], predefined: [], efforts: [] } },
    'GET /api/providers/openai/models': { status: 200, body: { server: 'openrouter', serverLabel: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', warnings: [],
      models: [{ id: 'acme/m1', catalogId: 'or-acme-m1', name: 'M1', importable: true, free: true, toolCalls: true, servedContext: 131072 }] } },
  } });
  await go('settings/models');
  const doc = window.document;
  const modal = doc.getElementById('model-import-modal');
  await checkRows([
    { name: 'a typed base URL: no backdrop close, Escape asks, Discard closes', run: async () => {
      doc.getElementById('model-import-btn').click();
      for (let i = 0; i < 2; i++) await tick();
      assert.equal(modal.classList.contains('hidden'), false);
      const base = doc.getElementById('mimp-base');
      base.value = 'http://127.0.0.1:11434/v1';
      base.dispatchEvent(new window.Event('input', { bubbles: true }));
      backdropClick(window, modal);
      assert.equal(modal.classList.contains('hidden'), false, 'never on a backdrop click');
      pressEscape(window);
      assert.ok(discardPrompt(doc), 'asks first');
      discardChanges(doc);
      for (let i = 0; i < 2; i++) await tick();
      assert.equal(modal.classList.contains('hidden'), true);
    } },
    { name: 'typing in the list filter alone: Escape closes with no question', run: async () => {
      doc.getElementById('model-import-btn').click();
      for (let i = 0; i < 2; i++) await tick();
      const filter = doc.getElementById('mimp-filter');
      filter.value = 'llama';
      filter.dispatchEvent(new window.Event('input', { bubbles: true }));
      pressEscape(window);
      assert.equal(discardPrompt(doc), null);
      assert.equal(modal.classList.contains('hidden'), true);
    } },
    { name: 'OpenRouter\'s Free / Tools / Window filters only narrow the view too: one toggled, then Escape, closes with no question', run: async () => {
      doc.getElementById('model-import-btn').click();
      for (let i = 0; i < 2; i++) await tick();
      const base = doc.getElementById('mimp-base');
      base.value = 'https://openrouter.ai/api/v1';
      base.dispatchEvent(new window.Event('input', { bubbles: true }));
      doc.getElementById('mimp-list').click();
      for (let i = 0; i < 4; i++) await tick();
      edit(window, doc.querySelector('#mimp-body .mvi-or-filters .mvi-f-free'), true);
      pressEscape(window);
      assert.equal(discardPrompt(doc), null);
      assert.equal(modal.classList.contains('hidden'), true);
    } },
  ]);
});

test('model import: while "Import selected" is out, Cancel is disabled and Escape does nothing; the answer gives both back', async () => {
  const open = async () => {
    const { window, go } = await boot({ routes: {
      'GET /api/providers/copilot/models': { status: 200, body: { models: [{ id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI' }] } },
      'GET /api/providers': { status: 200, body: { copilot: { connected: true } } },
      'GET /api/models': { status: 200, body: { models: [], predefined: [], efforts: [] } },
    } });
    await go('settings/models');
    const doc = window.document;
    let answer;
    const gate = new Promise((r) => { answer = r; });
    const realFetch = globalThis.fetch;                          // app.js calls the global fetch
    globalThis.fetch = (url, opts) => (String(url) === '/api/providers/copilot/import-models' ? gate : realFetch(url, opts));
    doc.getElementById('model-import-btn').click();
    for (let i = 0; i < 4; i++) await tick();                    // the Copilot list loads by itself
    edit(window, doc.querySelector('#mimp-body .mvi-cb'), true); // a model ticked: a change
    doc.getElementById('mimp-go').click();
    await tick();
    const modal = doc.getElementById('model-import-modal');
    const cancel = doc.getElementById('mimp-cancel');
    assert.equal(cancel.disabled, true, 'no way out while the request is out');
    cancel.dispatchEvent(new window.Event('click', { bubbles: true }));   // a synthetic click reaches a disabled button: cancel() must hold too
    pressEscape(window);
    assert.equal(discardPrompt(doc), null, 'not even the question');
    assert.equal(modal.classList.contains('hidden'), false);
    return { window, doc, modal, cancel, answer };
  };
  await checkRows([
    { name: 'refused: the error shows in the dialog that stayed open, Cancel is back and Escape asks again', run: async () => {
      const { window, doc, modal, cancel, answer } = await open();
      answer({ ok: false, status: 502, json: async () => ({ error: 'Copilot refused the import' }) });
      await waitFor(() => !cancel.disabled);
      assert.equal(doc.getElementById('mimp-msg').textContent, 'Copilot refused the import');
      pressEscape(window);
      assert.ok(discardPrompt(doc), 'the ticked model is a change');
      discardChanges(doc);
      await tick();
      assert.equal(modal.classList.contains('hidden'), true);
    } },
    { name: 'accepted: the dialog closes itself, and Cancel is armed for the next open', run: async () => {
      const { modal, cancel, answer } = await open();
      answer({ ok: true, status: 200, json: async () => ({ created: ['copilot-gpt-5'], updated: [], skipped: [] }) });
      await waitFor(() => !cancel.disabled);
      assert.equal(modal.classList.contains('hidden'), true);
    } },
  ]);
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
      const b = Object.assign(window.document.createElement('button'), { type: 'button', className: 'btn btn-sm tm-push-now', textContent: 'Push now' });
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
