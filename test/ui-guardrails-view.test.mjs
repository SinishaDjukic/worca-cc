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

test('create wizard: New -> Step 1 -> Next -> Step 2 -> Create POSTs {name, settings}, closes, reloads', async () => {
  const posts = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/guardrails') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 201, json: async () => ({
          guardrails: { id: 'gr_new-set', name: 'New Set', origin: null, settings: JSON.parse(opts.body).settings },
        }) });
      }
      return undefined;
    },
  });
  await openGuardrails(window);
  click(window, window.document.querySelector('#guardrail-create-btn'));
  await tick();
  const modal = window.document.querySelector('#plugin-modal');
  assert.ok(!modal.classList.contains('hidden'), 'wizard open');
  assert.ok(modal.querySelector('.grv-step1'), 'Step 1 shown');
  modal.querySelector('.grv-source[value="secure"]').checked = true;
  click(window, modal.querySelector('.grv-next'));
  await tick();
  const editor = modal.querySelector('.grv-editor');
  assert.ok(editor && editor.dataset.mode === 'create', 'Step 2 editor in create mode');
  assert.deepEqual([...editor.querySelectorAll('.gr-list.gr-deny .gr-row .mono')].map((n) => n.textContent),
    ['Bash(curl:*)'], 'prefilled from Strict');
  const nameInput = editor.querySelector('.grv-name-input');
  nameInput.value = 'New Set';
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true })); // fire the enable path a real user triggers
  await tick();
  assert.equal(modal.querySelector('.grv-save').disabled, false, 'typing a name enables Create');
  click(window, modal.querySelector('.grv-save')); // "Create set"
  await tick(); await tick();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].name, 'New Set');
  assert.deepEqual(posts[0].settings, SETS[2].settings, 'start-from seeds settings');
  assert.ok(modal.classList.contains('hidden'), 'closes on success');
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

test('deep link #guardrails/gr_org opens edit wizard prefilled; toggling scrub + Save PUTs, closes, normalizes hash', async () => {
  const puts = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/guardrails/gr_org') && opts.method === 'PUT') {
        puts.push(JSON.parse(opts.body));
        const sent = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          guardrails: { id: 'gr_org', name: sent.name, origin: null, settings: sent.settings } }) });
      }
      return undefined;
    },
  });
  await openGuardrails(window, 'gr_org');
  const modal = window.document.querySelector('#plugin-modal');
  let editor = modal.querySelector('.grv-editor');
  assert.ok(editor && editor.dataset.mode === 'edit', 'edit mode');
  assert.equal(editor.querySelector('.grv-name-input').value, 'Org Policy');
  assert.ok(editor.querySelector('.gr-scrub').classList.contains('on'));
  click(window, editor.querySelector('.gr-scrub'));
  await tick();
  editor = modal.querySelector('.grv-editor');
  assert.equal(editor.querySelector('.grv-save').disabled, false);
  click(window, editor.querySelector('.grv-save'));
  await tick(); await tick();
  assert.equal(puts.length, 1);
  assert.equal(puts[0].settings.envScrub, false, 'collected from live DOM');
  assert.ok(modal.classList.contains('hidden'), 'closes on save');
  assert.equal(window.location.hash, '#guardrails', 'deep-link hash normalized back to bare on exit');
});

test('editor add/remove rows mutate and repaint; Discard reverts to the saved snapshot', async () => {
  const { window } = await boot();
  await openGuardrails(window, 'gr_org');
  let editor = window.document.querySelector('#plugin-modal .grv-editor');
  // add a deny rule
  editor.querySelector('.gr-add[data-list="gr-deny"] input').value = 'Bash(wget:*)';
  click(window, editor.querySelector('.gr-add[data-list="gr-deny"] .gr-add-btn'));
  await tick();
  editor = window.document.querySelector('#plugin-modal .grv-editor');
  assert.deepEqual([...editor.querySelectorAll('.gr-list.gr-deny .gr-row .mono')].map((n) => n.textContent),
    ['Bash(curl:*)', 'Bash(wget:*)']);
  assert.equal(editor.querySelector('.grv-save').disabled, false);
  // remove the original rule
  click(window, editor.querySelector('.gr-rm[data-value="Bash(curl:*)"]'));
  await tick();
  editor = window.document.querySelector('#plugin-modal .grv-editor');
  assert.deepEqual([...editor.querySelectorAll('.gr-list.gr-deny .gr-row .mono')].map((n) => n.textContent),
    ['Bash(wget:*)']);
  // discard -> saved snapshot restored
  click(window, editor.querySelector('.grv-discard'));
  await tick();
  editor = window.document.querySelector('#plugin-modal .grv-editor');
  assert.deepEqual([...editor.querySelectorAll('.gr-list.gr-deny .gr-row .mono')].map((n) => n.textContent),
    ['Bash(curl:*)']);
  assert.equal(editor.querySelector('.grv-save').disabled, true);
});

test('built-in view: read-only + "Save as new set" flips to create prefilled; naming + Create POSTs', async () => {
  const posts = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/guardrails') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 201, json: async () => ({
          guardrails: { id: 'gr_copy', name: 'Copy', origin: null, settings: JSON.parse(opts.body).settings } }) });
      }
      return undefined;
    },
  });
  await openGuardrails(window, 'secure');
  const modal = window.document.querySelector('#plugin-modal');
  let editor = modal.querySelector('.grv-editor');
  assert.equal(editor.dataset.mode, 'view');
  assert.equal(editor.querySelector('.grv-name-input'), null, 'read-only: static name');
  assert.equal(editor.querySelector('.grv-save').textContent, 'Save as new set');
  click(window, editor.querySelector('.grv-save')); // flip to create
  await tick();
  editor = modal.querySelector('.grv-editor');
  assert.equal(editor.dataset.mode, 'create', 'flipped to create');
  assert.deepEqual([...editor.querySelectorAll('.gr-list.gr-deny .gr-row .mono')].map((n) => n.textContent),
    ['Bash(curl:*)'], 'prefilled from the built-in');
  const nameInput = editor.querySelector('.grv-name-input');
  nameInput.value = 'Copy';
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  assert.equal(modal.querySelector('.grv-save').disabled, false, 'typing a name enables Create');
  click(window, editor.querySelector('.grv-save'));
  await tick(); await tick();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].name, 'Copy');
  assert.deepEqual(posts[0].settings, SETS[2].settings);
});

test('edit 400 (errors array) surfaces in .grv-msg and stays dirty for retry', async () => {
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.includes('/api/guardrails/gr_org') && opts.method === 'PUT') {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({
          error: 'invalid guardrails', errors: ['deny rule "oops" is not a valid permission rule (expected Tool(pattern))'] }) });
      }
      return undefined;
    },
  });
  await openGuardrails(window, 'gr_org');
  const modal = window.document.querySelector('#plugin-modal');
  let editor = modal.querySelector('.grv-editor');
  click(window, editor.querySelector('.gr-honor'));
  await tick();
  editor = modal.querySelector('.grv-editor');
  click(window, editor.querySelector('.grv-save'));
  await tick(); await tick();
  editor = modal.querySelector('.grv-editor');
  assert.match(editor.querySelector('.grv-msg').textContent, /not a valid permission rule/);
  assert.ok(editor.querySelector('.grv-msg').classList.contains('err'));
  assert.equal(editor.querySelector('.grv-save').disabled, false, 'still dirty');
  assert.ok(!modal.classList.contains('hidden'), 'stays open on error');
});

test('create wizard: Back after editing, then Next on the SAME source, keeps the edits', async () => {
  const { window } = await boot();
  await openGuardrails(window);
  click(window, window.document.querySelector('#guardrail-create-btn'));
  await tick();
  const modal = window.document.querySelector('#plugin-modal');
  modal.querySelector('.grv-source[value="secure"]').checked = true;
  click(window, modal.querySelector('.grv-next'));
  await tick();
  let editor = modal.querySelector('.grv-editor');
  editor.querySelector('.gr-add[data-list="gr-deny"] input').value = 'Bash(wget:*)';
  click(window, editor.querySelector('.gr-add[data-list="gr-deny"] .gr-add-btn'));
  await tick();
  click(window, modal.querySelector('.grv-back'));
  await tick();
  assert.ok(modal.querySelector('.grv-step1'), 'back at Step 1');
  assert.equal(modal.querySelector('.grv-source:checked').value, 'secure', 'source preserved');
  click(window, modal.querySelector('.grv-next'));
  await tick();
  editor = modal.querySelector('.grv-editor');
  assert.deepEqual([...editor.querySelectorAll('.gr-list.gr-deny .gr-row .mono')].map((n) => n.textContent),
    ['Bash(curl:*)', 'Bash(wget:*)'], 'edits preserved on same-source Back -> Next');
  assert.equal(editor.querySelector('.grv-save').disabled, false, 'still dirty after restore');
});

test('create wizard: Back then choosing a DIFFERENT source re-seeds (edits dropped by design)', async () => {
  const { window } = await boot();
  await openGuardrails(window);
  click(window, window.document.querySelector('#guardrail-create-btn'));
  await tick();
  const modal = window.document.querySelector('#plugin-modal');
  modal.querySelector('.grv-source[value="secure"]').checked = true;
  click(window, modal.querySelector('.grv-next'));
  await tick();
  let editor = modal.querySelector('.grv-editor');
  editor.querySelector('.gr-add[data-list="gr-deny"] input').value = 'Bash(wget:*)';
  click(window, editor.querySelector('.gr-add[data-list="gr-deny"] .gr-add-btn'));
  await tick();
  click(window, modal.querySelector('.grv-back'));
  await tick();
  modal.querySelector('.grv-source[value=""]').checked = true; // switch to Blank
  click(window, modal.querySelector('.grv-next'));
  await tick();
  editor = modal.querySelector('.grv-editor');
  assert.deepEqual([...editor.querySelectorAll('.gr-list.gr-deny .gr-row .mono')].map((n) => n.textContent),
    [], 're-seeded from Blank, prior edits dropped');
});

test('create requires a name: a rule enables Create but an empty-name save shows the error', async () => {
  const posts = [];
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.endsWith('/api/guardrails') && opts.method === 'POST') { posts.push(1); return Promise.resolve({ ok: true, status: 201, json: async () => ({ guardrails: { id: 'x', name: 'x', origin: null, settings: EMPTY } }) }); }
    return undefined;
  } });
  await openGuardrails(window);
  click(window, window.document.querySelector('#guardrail-create-btn'));
  await tick();
  const modal = window.document.querySelector('#plugin-modal');
  click(window, modal.querySelector('.grv-next')); // Blank
  await tick();
  let editor = modal.querySelector('.grv-editor');
  editor.querySelector('.gr-add[data-list="gr-deny"] input').value = 'Bash(curl:*)';
  click(window, editor.querySelector('.gr-add[data-list="gr-deny"] .gr-add-btn'));
  await tick();
  editor = modal.querySelector('.grv-editor');
  assert.equal(editor.querySelector('.grv-save').disabled, false, 'a rule makes it dirty');
  click(window, editor.querySelector('.grv-save')); // no name yet
  await tick();
  editor = modal.querySelector('.grv-editor');
  assert.match(editor.querySelector('.grv-msg').textContent, /name is required/);
  assert.equal(posts.length, 0, 'no POST without a name');
});

test('deep link to a non-existent id shows a message and opens no modal', async () => {
  const { window } = await boot();
  await openGuardrails(window, 'nope');
  const modal = window.document.querySelector('#plugin-modal');
  assert.ok(modal.classList.contains('hidden'), 'no wizard for a missing id');
  assert.match(window.document.querySelector('#guardrails-msg').textContent, /not found/);
});

test('built-in view is read-only: clicking a disabled switch is a no-op', async () => {
  const { window } = await boot();
  await openGuardrails(window, 'secure');
  const modal = window.document.querySelector('#plugin-modal');
  const before = modal.querySelector('.gr-scrub').classList.contains('on');
  click(window, modal.querySelector('.gr-scrub'));
  await tick();
  assert.equal(modal.querySelector('.gr-scrub').classList.contains('on'), before, 'switch did not toggle');
  assert.equal(modal.querySelector('.grv-editor').dataset.mode, 'view', 'still read-only');
});

test('navigating to another view closes an open wizard (showView leave-guard)', async () => {
  const { window } = await boot();
  await openGuardrails(window, 'gr_org');
  assert.ok(!window.document.querySelector('#plugin-modal').classList.contains('hidden'));
  window.location.hash = 'projects';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick();
  assert.ok(window.document.querySelector('#plugin-modal').classList.contains('hidden'), 'wizard closed on nav away');
});

test('browser Back to bare #guardrails closes an open edit wizard (loadGuardrailsView reset)', async () => {
  const { window } = await boot();
  await openGuardrails(window, 'gr_org');
  const modal = window.document.querySelector('#plugin-modal');
  assert.ok(!modal.classList.contains('hidden'));
  window.location.hash = 'guardrails';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick();
  assert.ok(modal.classList.contains('hidden'), 'wizard closed on bare-hash reload');
});
