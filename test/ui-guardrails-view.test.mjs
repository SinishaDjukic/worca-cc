// test/ui-guardrails-view.test.mjs — full-app-boot jsdom tests for the Guardrails view.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick, pressEscape, discardPrompt, keepEditing, discardChanges } from './helpers/popups.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' }));
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
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window };
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));

// Guardrails is a Settings tab now; the legacy bare hash still redirects here
// (ui-settings-tabs covers that), but the suite drives the canonical route so it
// tests the tab, not the redirect.
async function openGuardrails(window, param = '') {
  window.location.hash = param ? `settings/guardrails/${param}` : 'settings/guardrails';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick();
}

test('navigating to #guardrails renders the list from GET /api/guardrails (built-ins first, Strict label)', async () => {
  const { window } = await boot();
  await openGuardrails(window);
  const view = window.document.querySelector('.settings-pane[data-tab="guardrails"]');
  assert.ok(!view.classList.contains('hidden'), 'view shown');
  const cards = window.document.querySelectorAll('#guardrails-list .grv-card');
  assert.equal(cards.length, 4);
  assert.deepEqual([...cards].map((c) => c.dataset.id), ['permissive', 'normal', 'secure', 'gr_org']);
  assert.equal(cards[2].querySelector('.grv-name').textContent, 'Strict');
  assert.equal(cards[3].querySelector('.grv-delete').dataset.id, 'gr_org');
  assert.equal(cards[0].querySelector('.grv-delete'), null, 'built-in undeletable');
});

test('create wizard: Create requires a name, then POSTs {name, settings}, closes and reloads', async () => {
  await checkRows([
    { name: 'create wizard: New -> Step 1 -> Next -> Step 2 -> Create POSTs {name, settings}, closes, reloads', run: async () => {
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
    } },
    { name: 'create requires a name: a rule enables Create but an empty-name save shows the error', run: async () => {
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
    } },
  ]);
});

test('delete flow: confirm -> DELETE; a 409 is an error toast whose Details renders the pinning-run list', async () => {
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
  // #555: the refusal is an error toast named for the set; Details opens the pinning-run list.
  const toast = lastToast(window.document);
  assert.equal(toast.tone, 'err');
  assert.match(toast.title, /^Cannot delete /);
  assert.equal(toast.detail, 'cannot delete guardrail set "gr_org" — still referenced');
  assert.equal(toast.action, 'Details');
  const modal = window.document.querySelector('#plugin-modal');
  assert.ok(modal.classList.contains('hidden'), 'no dialog until Details is pressed');
  click(window, window.document.querySelector('#toasts .toast-act'));
  assert.ok(!modal.classList.contains('hidden'), '409 modal shown');
  assert.match(modal.querySelector('.grv-refs409 .mono').textContent, /pipeline p1/);
});

test('deep link #settings/guardrails/gr_org opens edit wizard prefilled; toggling scrub + Save PUTs, closes, normalizes hash', async () => {
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
  assert.equal(window.location.hash, '#settings/guardrails', 'deep-link hash normalized back to the bare tab');
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

test('built-in sets are read-only (disabled switches are no-ops); Save as new set flips to a prefilled create that POSTs', async () => {
  await checkRows([
    { name: 'built-in view: read-only + "Save as new set" flips to create prefilled; naming + Create POSTs', run: async () => {
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
    } },
    { name: 'built-in view is read-only: clicking a disabled switch is a no-op', run: async () => {
      const { window } = await boot();
      await openGuardrails(window, 'secure');
      const modal = window.document.querySelector('#plugin-modal');
      const before = modal.querySelector('.gr-scrub').classList.contains('on');
      click(window, modal.querySelector('.gr-scrub'));
      await tick();
      assert.equal(modal.querySelector('.gr-scrub').classList.contains('on'), before, 'switch did not toggle');
      assert.equal(modal.querySelector('.grv-editor').dataset.mode, 'view', 'still read-only');
    } },
  ]);
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

test('create wizard Back: same source keeps edits, a different source re-seeds', async () => {
  await checkRows([
    { name: 'create wizard: Back after editing, then Next on the SAME source, keeps the edits', run: async () => {
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
    } },
    { name: 'create wizard: Back then choosing a DIFFERENT source re-seeds (edits dropped by design)', run: async () => {
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
    } },
  ]);
});

test('leaving the view or browser Back closes an open wizard', async () => {
  await checkRows([
    { name: 'navigating to another view closes an open wizard (showView leave-guard)', run: async () => {
      const { window } = await boot();
      await openGuardrails(window, 'gr_org');
      assert.ok(!window.document.querySelector('#plugin-modal').classList.contains('hidden'));
      window.location.hash = 'projects';
      window.dispatchEvent(new window.Event('hashchange'));
      await tick(); await tick();
      assert.ok(window.document.querySelector('#plugin-modal').classList.contains('hidden'), 'wizard closed on nav away');
    } },
    { name: 'browser Back to the bare Guardrails tab closes an open edit wizard (loadGuardrailsView reset)', run: async () => {
      const { window } = await boot();
      await openGuardrails(window, 'gr_org');
      const modal = window.document.querySelector('#plugin-modal');
      assert.ok(!modal.classList.contains('hidden'));
      window.location.hash = 'settings/guardrails';
      window.dispatchEvent(new window.Event('hashchange'));
      await tick(); await tick();
      assert.ok(modal.classList.contains('hidden'), 'wizard closed on bare-hash reload');
    } },
  ]);
});

test('the guardrails wizard: never on a backdrop click; Escape on a dirty editor asks (Keep editing keeps it, Discard closes); a pristine editor, the header Close and Step 2\'s Cancel leave at once', async () => {
  const dirtyWizard = async () => {
    const { window } = await boot();
    await openGuardrails(window, 'gr_org');
    const modal = window.document.querySelector('#plugin-modal');
    click(window, modal.querySelector('.grv-editor .gr-scrub'));       // make it dirty
    await tick();
    return { window, doc: window.document, modal };
  };
  await checkRows([
    { name: 'Escape on a dirty editor asks with its own sentence; Discard closes the wizard', run: async () => {
      const { window, doc, modal } = await dirtyWizard();
      pressEscape(window);
      const q = discardPrompt(doc);
      assert.ok(q, 'the question is shown');
      assert.equal(q.querySelector('.confirm-message').textContent, 'This guardrail set has unsaved changes.');
      discardChanges(doc);
      await tick(); await tick();
      assert.ok(modal.classList.contains('hidden'), 'wizard closed after Discard');
    } },
    { name: 'Keep editing keeps the wizard open', run: async () => {
      const { window, doc, modal } = await dirtyWizard();
      pressEscape(window);
      keepEditing(doc);
      await tick(); await tick();
      assert.ok(!modal.classList.contains('hidden'));
    } },
    { name: 'a backdrop click on a dirty editor neither closes it nor asks', run: async () => {
      const { window, doc, modal } = await dirtyWizard();
      backdropClick(window, modal);
      await tick();
      assert.ok(!modal.classList.contains('hidden'));
      assert.equal(discardPrompt(doc), null);
    } },
    { name: 'the header Close leaves a dirty editor at once — Close never asks', run: async () => {
      const { window, doc, modal } = await dirtyWizard();
      click(window, doc.querySelector('#plugin-modal-close'));
      await tick(); await tick();
      assert.ok(modal.classList.contains('hidden'));
      assert.equal(discardPrompt(doc), null);
    } },
    { name: 'Step 2 has a Cancel next to Save; it leaves at once', run: async () => {
      const { window, doc, modal } = await dirtyWizard();
      click(window, modal.querySelector('.grv-editor .grv-cancel'));
      await tick(); await tick();
      assert.ok(modal.classList.contains('hidden'));
      assert.equal(discardPrompt(doc), null);
    } },
    { name: 'clean close: Escape on a pristine editor closes with no question', run: async () => {
      const { window } = await boot();
      await openGuardrails(window, 'gr_org');
      const modal = window.document.querySelector('#plugin-modal');
      pressEscape(window);
      await tick(); await tick();
      assert.equal(discardPrompt(window.document), null);
      assert.ok(modal.classList.contains('hidden'), 'closed directly');
    } },
  ]);
});
