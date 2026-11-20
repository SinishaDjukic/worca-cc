// test/ui-models-add-app.test.mjs — Add model wired into the booted app (models-menu P5, Task 6): one modal holds step 1
// ("Where it runs"), step 2's list (the import inside it) and the model form; the guard, the late answers and the
// provider rows' Import. Stubs route by METHOD and path (boot copied from test/ui-models-catalogue-app.test.mjs).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast, edit } from './helpers/feedback.mjs';
import { pressEscape, discardPrompt, keepEditing } from './helpers/popups.mjs';
import { checkRows } from './helpers/rows.mjs';
import { data } from './helpers/models-catalogue-fixture.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);
// A throw in an app.js listener reaches the window's `error` event, never the test: every test ends with none.
const pageErrors = [];
afterEach(() => { assert.deepEqual(pageErrors.splice(0), []); });

const html = readIndexHtml();
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const ENGINE_NAMES = ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen'];

class WSStub {
  constructor() { this.readyState = 1; WSStub.last = this; this._l = {}; }
  send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
  _open() { (this._l.open || []).forEach((fn) => fn({})); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };

/** GET /api/models as the server sends it: the fixture's rows without the page's own facts. */
function modelsBody(extra = {}) {
  const { legacy, projectName, providers, engines, runEngine, engineLocks, justImported, ...rows } = data();
  return { ...rows, efforts: ['low', 'medium', 'high'], providers: ['copilot', 'openai', 'anthropic'], uses: {}, ...extra };
}

const ok = (body) => ({ status: 200, body });

/** `arms`: [method, path, body | (postBody) => ({ status, body }) | a Promise of one], tried in order before the
 *  defaults (a path matches by prefix, so the more specific arms come first). Every call is "<METHOD> <url>"; POST and
 *  PATCH bodies are parsed into `bodies`. */
async function boot({ hash = '', arms = [] } = {}) {
  const dom = trackDom(new JSDOM(html, { url: `http://localhost:4317/${hash ? `#${hash}` : ''}` }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.addEventListener('error', (e) => pageErrors.push(String(e.error?.stack || e.message)));
  const calls = [];
  const bodies = [];
  const heads = [];
  const all = [
    ...arms,
    ['GET', '/api/models', () => ok(modelsBody())],
    ['GET', '/api/providers', ok({})],
    ['GET', '/api/settings', ok({})],
    ['GET', '/api/engines', ok({ engines: ENGINE_NAMES.map((name) => ({ name, label: name, ready: true })) })],
    ['GET', '/api/projects', ok({ projects: [] })],
  ];
  window.fetch = (url, opts = {}) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = opts.method || 'GET';
    calls.push(`${method} ${u}`);
    heads.push({ url: u, headers: opts.headers || {} });
    let body = null;
    if (typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch { body = opts.body; } }
    if (method === 'POST' || method === 'PATCH') bodies.push({ method, url: u, body, headers: opts.headers || {} });
    const answer = ({ status = 200, body: b = {} }) => ({ ok: status < 400, status, json: async () => b });
    for (const [m, path, r] of all) {
      if (m === method && u.startsWith(path)) return Promise.resolve(typeof r === 'function' ? r(body) : r).then(answer);
    }
    return Promise.resolve(answer(ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] })));
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  await settle();
  return { window, doc: window.document, calls, bodies, heads };
}

const press = (window, node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const modal = (doc) => doc.getElementById('model-editor-modal');
const shown = (doc) => !modal(doc).classList.contains('hidden');
const screen = (doc, sel) => doc.querySelector(`#mv-editor-host ${sel}`);
const step1 = (doc) => screen(doc, '.mdl-add[data-step="1"]');
const step2 = (doc) => screen(doc, '.mdl-add[data-step="2"]');
const form = (doc) => screen(doc, '.mv-editor[data-mode]');
const clearToasts = (doc) => doc.getElementById('toasts').replaceChildren();
const held = () => { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; };
const COPILOT_LIST = { models: [{ id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI' }, { id: 'claude-x', name: 'Claude X', vendor: 'Anthropic' }] };

/** Add model › A provider (`provider`, Copilot when not given) › Next. */
async function toProviderList(window, doc, provider = '') {
  press(window, doc.getElementById('model-create-btn'));
  await settle(2);
  press(window, step1(doc).querySelector('.mdl-opt[data-where="provider"]'));
  if (provider) edit(window, step1(doc).querySelector('select.mdl-add-provider'), provider);
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle();
}

/** Add model › Next (a sign-in, Claude Code): the form. */
async function toSignInForm(window, doc) {
  press(window, doc.getElementById('model-create-btn'));
  await settle(2);
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle(2);
}

test('1. a sign-in: step 1, Next, the form; Add model posts, closes, and opens the new model in the Catalogue', async () => {
  let added = false;
  const { window, doc, bodies } = await boot({ hash: 'models', arms: [
    ['POST', '/api/models', () => { added = true; return ok({ ok: true }); }],
    ['GET', '/api/models', () => ok(modelsBody(added ? { models: [...data().models, { id: 'my-new', label: 'my-new', efforts: ['low', 'medium', 'high'] }] } : {}))],
  ] });
  press(window, doc.getElementById('model-create-btn'));
  await settle(2);
  assert.equal(shown(doc), true, 'the dialog opens');
  assert.ok(step1(doc), 'on step 1');
  assert.equal(step1(doc).querySelector('.mdl-opt[aria-checked="true"]').dataset.where, 'signin');
  assert.equal(doc.getElementById('mv-editor-heading')?.textContent, 'Add model', 'the screen names the modal');
  assert.equal(step1(doc).querySelector('.mdl-hx-t[data-engine="claude"] .mdl-hx-state').textContent, 'Ready', 'the tiles know each harness\'s state');
  // The sign-in's harness is step 1's pick; Back keeps it.
  press(window, step1(doc).querySelector('.mdl-hx-t[data-engine="codex"]'));
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle(2);
  assert.equal(form(doc).querySelector('.mv-engine').value, 'codex');
  press(window, form(doc).querySelector('.mv-back'));
  await settle(2);
  assert.ok(step1(doc).querySelector('.mdl-hx-t[data-engine="codex"][aria-pressed="true"]'), 'Back: the pick kept');
  press(window, step1(doc).querySelector('.mdl-hx-t[data-engine="claude"]'));
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle(2);
  assert.equal(step1(doc), null, 'step 1 left');
  const f = screen(doc, '.mv-editor[data-where="signin"]');
  assert.ok(f, 'the sign-in form');
  assert.equal(f.querySelector('.mv-engine').value, 'claude');
  assert.ok(f.querySelector('.mv-back'), 'reached through step 1: Back is there');
  const id = f.querySelector('.mv-id');
  id.value = 'GW-Claude';
  id.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(f.querySelector('.mv-save').disabled, true, 'an id the catalogue lists, whatever its case, is refused');
  id.value = 'my-new';
  id.dispatchEvent(new window.Event('input', { bubbles: true }));
  press(window, f.querySelector('.mv-save'));
  await settle(16);
  const post = bodies.find((b) => b.method === 'POST' && b.url === '/api/models');
  assert.equal(post?.body?.id, 'my-new');
  assert.equal(lastToast(doc).title, 'Model added.');
  assert.ok(doc.querySelector('#model-panel[aria-label="my-new"]'), 'the new model\'s side panel is open');
  assert.equal(shown(doc), false, 'the dialog closed');
});

test('2. a provider: its list, a tick, "Add 1 model"; the import lands on the Catalogue with every narrowing cleared', async () => {
  const { window, doc, bodies } = await boot({ hash: 'models', arms: [
    ['GET', '/api/providers/copilot/models', ok(COPILOT_LIST)],
    ['POST', '/api/providers/copilot/import-models', ok({ created: ['copilot-gpt-5'], updated: [], skipped: [] })],
    ['GET', '/api/providers', ok({ copilot: { connected: true } })],
  ] });
  // Fold Claude Code's group, then narrow the catalogue: a search and a Source.
  const claudeToggle = () => doc.querySelector('#models-list .mdl-grp[data-engine="claude"] .mdl-grp-toggle');
  press(window, claudeToggle());
  await settle(2);
  assert.equal(claudeToggle().getAttribute('aria-expanded'), 'false', 'Claude Code folded');
  const search = doc.querySelector('#models-list .mv-search');
  search.value = 'zzz';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  edit(window, doc.querySelector('#models-list .mdl-source'), [...doc.querySelector('#models-list .mdl-source').options].map((o) => o.value).find((v) => v && v !== 'any'));
  await settle(2);
  await toProviderList(window, doc);
  assert.ok(step2(doc), 'step 2');
  assert.equal(step2(doc).querySelector('select.mdl-add-provider').value, 'copilot');
  const cbs = doc.querySelectorAll('#mimp-body .mvi-cb');
  assert.ok(cbs.length >= 2, 'the provider\'s list');
  assert.equal(doc.querySelector('#mimp-body .mv-editor-title'), null, 'the sheet\'s own title went');
  // Back, another provider on step 1, Next: that provider's own step 2, nothing of Copilot's list.
  press(window, step2(doc).querySelector('.mv-back'));
  await settle(2);
  edit(window, step1(doc).querySelector('select.mdl-add-provider'), 'openai');
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle();
  assert.equal(step2(doc).querySelector('select.mdl-add-provider').value, 'openai');
  assert.equal(doc.querySelector('#mimp-body .mvi'), null, 'no Copilot list under OpenAI-compatible');
  press(window, step2(doc).querySelector('.mv-back'));
  await settle(2);
  edit(window, step1(doc).querySelector('select.mdl-add-provider'), 'copilot');
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle();
  // Select-all ticks what the filter shows, nothing it hides.
  const filter = step2(doc).querySelector('.mimp-filter');
  const countLine = () => step2(doc).querySelector('.mdl-add-shown');
  assert.deepEqual([countLine().hidden, countLine().textContent], [false, '2 of 2 shown'], 'ADD-3: the list says how much shows');
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="claude-x"]'), true);
  assert.equal(doc.querySelector('#mimp-body .mvi-all').indeterminate, true, 'a tick alone makes the head box mixed');
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="claude-x"]'), false);
  assert.equal(doc.querySelector('#mimp-body .mvi-all').indeterminate, false);
  filter.value = 'gpt';
  filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(countLine().textContent, '1 of 2 shown', 'typing in the filter repaints it');
  edit(window, doc.querySelector('#mimp-body .mvi-all'), true);
  assert.deepEqual([...doc.querySelectorAll('#mimp-body .mvi-cb:checked')].map((c) => c.value), ['gpt-5']);
  filter.value = '';
  filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  const allBox = doc.querySelector('#mimp-body .mvi-all');
  assert.deepEqual([countLine().textContent, allBox.checked, allBox.indeterminate], ['2 of 2 shown', false, true], 'one of two ticked: the head box is mixed');
  const go = doc.getElementById('mimp-go');
  assert.equal(go.textContent, 'Add 1 model');
  assert.equal(go.disabled, false);
  assert.equal(step2(doc).querySelector('.mdl-add-note').textContent, '1 selected');
  clearToasts(doc);
  press(window, go);
  await settle(16);
  const post = bodies.find((b) => b.url === '/api/providers/copilot/import-models');
  assert.deepEqual(post?.body, { ids: ['gpt-5'] });
  const t = lastToast(doc);
  assert.deepEqual([t.title, t.detail], ['Imported from Copilot', '1 added.']);
  assert.equal(shown(doc), false, 'the dialog closed');
  assert.equal(doc.getElementById('models-tab-catalogue').hidden, false, 'the Catalogue shows');
  assert.ok(doc.querySelector('#models-list .filter-chip[data-filter="imported"]'), 'Just imported is offered');
  assert.equal(doc.querySelector('#models-list .mv-search').value, '', 'the search cleared');
  assert.equal(doc.querySelector('#models-list .mdl-source').value, 'any', 'the Source cleared');
  assert.equal(claudeToggle().getAttribute('aria-expanded'), 'true', 'Claude Code\'s group unfolded');
});

test('1b. the harness tiles draw at once, then with each harness\'s state from one /api/engines per open; the focus stays', async () => {
  let gate = null;
  const ENGINES = { engines: ENGINE_NAMES.map((name) => ({ name, label: name, ready: name !== 'goose', reason: name === 'goose' ? 'not installed' : '' })) };
  const { window, doc, calls } = await boot({ hash: 'models', arms: [['GET', '/api/engines', () => (gate ? gate.promise.then(() => ok(ENGINES)) : ok(ENGINES))]] });
  const asked = () => calls.filter((c) => c === 'GET /api/engines').length;
  const before = asked();
  gate = held();
  press(window, doc.getElementById('model-create-btn'));
  await settle(2);
  assert.equal(asked(), before + 1, 'one request for this open');
  const tile = (engine) => step1(doc).querySelector(`.mdl-hx-t[data-engine="${engine}"]`);
  assert.equal(tile('claude').querySelector('.mdl-hx-state').textContent, '', 'no state claimed while unknown');
  const old = tile('codex');
  old.focus();
  gate.release();
  await settle();
  assert.notEqual(tile('codex'), old, 'step 1 drawn again');
  assert.equal(tile('goose').querySelector('.mdl-hx-state').textContent, 'Not ready');
  assert.equal(tile('claude').querySelector('.mdl-hx-state').textContent, 'Ready');
  assert.equal(doc.activeElement, tile('codex'), 'the focus handed to the same tile');
  press(window, step1(doc).querySelector('.mv-cancel'));
  gate = null;
  press(window, doc.getElementById('model-create-btn'));
  await settle(2);
  assert.equal(asked(), before + 2, 'and one for the next open');
});

test('3. moving between the screens: Enter an id and Back keep the ticks; a provider change clears them and drops a late list', async () => {
  let hold = null;
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/providers/copilot/models', () => (hold ? hold.promise.then(() => ok(COPILOT_LIST)) : ok(COPILOT_LIST))],
    ['GET', '/api/providers', ok({ copilot: { connected: true } })],
  ] });
  await toProviderList(window, doc);
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="claude-x"]'), true);
  press(window, step2(doc).querySelector('.mdl-manual'));
  await settle(2);
  const f = form(doc);
  assert.equal(f?.dataset.where, 'provider', 'Enter an id instead: the provider form');
  assert.equal(f.querySelector('.mv-conn-provider').value, 'copilot', 'its provider preset');
  press(window, f.querySelector('.mv-back'));
  await settle(2);
  assert.ok(step2(doc), 'Back: the list again');
  assert.equal(doc.querySelector('#mimp-body .mvi-cb[value="claude-x"]').checked, true, 'with its tick');
  assert.equal(doc.getElementById('mimp-go').textContent, 'Add 1 model');
  const filter = () => step2(doc).querySelector('.mimp-filter');
  filter().value = 'claude';
  filter().dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelector('#mimp-body tr[data-id="gpt-5"]').classList.contains('is-filtered'), true, 'the filter narrows');
  // A Copilot list held back, then the provider changes under it: its answer draws nothing.
  hold = held();
  edit(window, step2(doc).querySelector('select.mdl-add-provider'), 'openrouter');
  await settle(2);
  edit(window, step2(doc).querySelector('select.mdl-add-provider'), 'copilot');
  await settle(2);
  edit(window, step2(doc).querySelector('select.mdl-add-provider'), 'openai');
  await settle(2);
  hold.release();
  await settle();
  assert.equal(step2(doc).querySelector('select.mdl-add-provider').value, 'openai');
  assert.equal(doc.querySelector('#mimp-body .mvi'), null, 'the late Copilot list drew nothing');
  assert.equal(doc.querySelectorAll('#mimp-body .mvi-cb:checked').length, 0, 'no tick');
  assert.equal(filter().value, '', 'an empty filter');
  assert.equal(doc.getElementById('mimp-go').disabled, true);
  press(window, step2(doc).querySelector('.mv-back'));
  await settle(2);
  assert.ok(step1(doc), 'Back: step 1');
  assert.equal(step1(doc).querySelector('.mdl-opt[aria-checked="true"]').dataset.where, 'provider', 'the provider card still checked');
  assert.equal(step1(doc).querySelector('select.mdl-add-provider').value, 'openai');
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle(2);
  assert.equal(doc.querySelector('#mimp-body .mvi'), null, 'Next again: the late Copilot list was never kept for this provider');
});

test('3b. an import in flight: a provider change is put back, and the picker\'s mark follows its value back', async () => {
  const saving = held();
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/providers/copilot/models', ok(COPILOT_LIST)],
    ['POST', '/api/providers/copilot/import-models', () => saving.promise.then(() => ok({ created: ['copilot-gpt-5'], updated: [], skipped: [] }))],
    ['GET', '/api/providers', ok({ copilot: { connected: true } })],
  ] });
  await toProviderList(window, doc);
  const sel = () => step2(doc).querySelector('select.mdl-add-provider');
  const mark = () => sel().closest('.mdl-picksel')?.querySelector(':scope > .mdl-mark')?.outerHTML;
  const copilotMark = mark();
  assert.ok(copilotMark, 'the picker wears its provider\'s mark');
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), true);
  press(window, doc.getElementById('mimp-go'));
  await settle(2);
  edit(window, sel(), 'openai');
  await settle(2);
  assert.equal(sel().value, 'copilot', 'the change is put back while the import is out');
  assert.equal(mark(), copilotMark, 'and so is the mark');
  saving.release();
  await settle(16);
});

test('4. a provider that cannot list says why and offers the one next step; nothing is left busy', async () => {
  const busyLeft = (doc) => doc.querySelector('#mv-editor-host [data-fb-state="busy"]');
  await checkRows([
    { name: 'Copilot signed out: "Needs sign-in" + "Sign in", no list request; Sign in opens the setup assistant', run: async () => {
      const { window, doc, calls } = await boot({ hash: 'models', arms: [['GET', '/api/providers', ok({ copilot: { connected: false } })]] });
      await toProviderList(window, doc);
      const box = step2(doc).querySelector('.mdl-add-blocked');
      assert.equal(box.hidden, false);
      assert.equal(box.querySelector('.mdl-st').textContent, 'Needs sign-in');
      assert.equal(box.querySelector('.mdl-add-fix').textContent, 'Sign in');
      assert.equal(calls.some((c) => c.startsWith('GET /api/providers/copilot/models')), false, 'no list request');
      assert.equal(busyLeft(doc), null);
      press(window, box.querySelector('.mdl-add-fix'));
      await settle();
      assert.equal(shown(doc), false, 'the dialog closed');
      assert.ok(doc.getElementById('setup-modal'), 'the setup assistant is up');
      assert.equal(doc.querySelector('#setup-modal h2#setup-title').textContent, 'Where should Worca get its models?', 'on Model access, as the Catalogue\'s fix');
      assert.equal(window.location.hash, '#models');
    } },
    { name: 'OpenRouter without a key: "Needs key" + "Set key", which opens its Providers row', run: async () => {
      const { window, doc, calls } = await boot({ hash: 'models', arms: [['GET', '/api/providers', ok({ openrouter: { keySet: false } })]] });
      await toProviderList(window, doc, 'openrouter');
      const box = step2(doc).querySelector('.mdl-add-blocked');
      assert.equal(box.hidden, false);
      assert.equal(box.querySelector('.mdl-st').textContent, 'Needs key');
      assert.equal(box.querySelector('.mdl-add-fix').textContent, 'Set key');
      assert.equal(calls.some((c) => c.startsWith('GET /api/providers/openai/models')), false, 'no list request');
      press(window, box.querySelector('.mdl-add-fix'));
      await settle();
      assert.equal(shown(doc), false, 'the dialog closed');
      assert.equal(window.location.hash, '#models/providers/openrouter');
    } },
    { name: 'Anthropic-compatible: "No list to pick from" with "Enter an id instead"', run: async () => {
      const { window, doc } = await boot({ hash: 'models' });
      await toProviderList(window, doc, 'anthropic');
      const box = step2(doc).querySelector('.mdl-add-blocked');
      assert.equal(box.hidden, false);
      assert.equal(box.querySelector('.mdl-st').textContent, 'No list to pick from');
      assert.ok(step2(doc).querySelector('.mdl-manual'), 'Enter an id instead');
      assert.equal(busyLeft(doc), null);
      press(window, box.querySelector('.mdl-add-fix'));
      await settle(2);
      assert.equal(form(doc)?.dataset.where, 'provider', 'its button opens the provider form');
    } },
  ]);
});

test('7. Escape asks before throwing typed work away; Cancel and Close do not; Next or a filter alone is no change', async () => {
  let saving = null;
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['POST', '/api/models', () => (saving ? saving.promise.then(() => ok({ ok: true })) : ok({ ok: true }))],
    ['GET', '/api/providers/copilot/models', ok(COPILOT_LIST)],
    ['GET', '/api/providers', ok({ copilot: { connected: true } })],
  ] });
  await checkRows([
    { name: 'typed in the form: Escape asks; Keep editing keeps it; Cancel closes at once', run: async () => {
      await toSignInForm(window, doc);
      edit(window, form(doc).querySelector('.mv-label'), 'Mine');
      pressEscape(window);
      await tick();
      assert.equal(discardPrompt(doc)?.querySelector('.confirm-message').textContent, 'This model has unsaved changes.');
      keepEditing(doc);
      await settle(2);
      assert.equal(shown(doc), true);
      press(window, form(doc).querySelector('.mv-cancel'));
      assert.equal(shown(doc), false, 'Cancel never asks');
      assert.equal(discardPrompt(doc), null);
    } },
    { name: 'typed in the form: the head\'s Close closes at once', run: async () => {
      await toSignInForm(window, doc);
      edit(window, form(doc).querySelector('.mv-label'), 'Mine');
      press(window, form(doc).querySelector('.mdl-close'));
      assert.equal(shown(doc), false);
      assert.equal(discardPrompt(doc), null);
    } },
    { name: 'step 1, Next, Escape: closes with no question', run: async () => {
      await toSignInForm(window, doc);
      pressEscape(window);
      await settle(2);
      assert.equal(discardPrompt(doc), null);
      assert.equal(shown(doc), false);
    } },
    { name: 'typed in the form, then Back: Escape on step 1 still asks', run: async () => {
      await toSignInForm(window, doc);
      edit(window, form(doc).querySelector('.mv-label'), 'Mine');
      press(window, form(doc).querySelector('.mv-back'));
      await settle(2);
      assert.ok(step1(doc));
      pressEscape(window);
      await tick();
      assert.ok(discardPrompt(doc), 'the typed name is not lost silently');
      keepEditing(doc);
      await settle(2);
      press(window, step1(doc).querySelector('.mv-cancel'));
      assert.equal(shown(doc), false);
    } },
    { name: 'only the list filter typed on step 2: Escape closes with no question', run: async () => {
      await toProviderList(window, doc);
      const filter = step2(doc).querySelector('.mimp-filter');
      filter.value = 'gpt';
      filter.dispatchEvent(new window.Event('input', { bubbles: true }));
      pressEscape(window);
      await settle(2);
      assert.equal(discardPrompt(doc), null);
      assert.equal(shown(doc), false);
    } },
    { name: 'Escape while Add model is out does nothing', run: async () => {
      await toSignInForm(window, doc);
      const id = form(doc).querySelector('.mv-id');
      id.value = 'held-1';
      id.dispatchEvent(new window.Event('input', { bubbles: true }));
      saving = held();
      press(window, form(doc).querySelector('.mv-save'));
      await tick();
      pressEscape(window);
      await tick();
      assert.equal(discardPrompt(doc), null, 'not even the question');
      assert.equal(shown(doc), true);
      saving.release();
      saving = null;
      await settle(16);
      assert.equal(shown(doc), false, 'the answer closes it');
    } },
  ]);
});

test('9. the import dialog and its button are gone', async () => {
  const { doc } = await boot({ hash: 'models' });
  assert.equal(doc.getElementById('model-import-modal'), null);
  assert.equal(doc.getElementById('model-import-btn'), null);
  assert.equal(doc.getElementById('model-share-btn'), null, 'Share as plugin is in the More menu');
  assert.equal(readFileSync(appPath, 'utf8').includes('openImportDialog('), false);
});

test('12. an OpenAI-compatible endpoint lists on Enter with its key in a header, imports with it, and a preset fills both', async () => {
  const LIST = { server: 'llama', serverLabel: 'llama.cpp', baseUrl: 'http://box:8080/v1', warnings: [], models: [{ id: 'm1', catalogId: 'box-m1', name: 'M1', importable: true }] };
  const { window, doc, calls, bodies, heads } = await boot({ hash: 'models', arms: [
    ['GET', '/api/providers/openai/models?baseUrl=http%3A%2F%2Fdown', { status: 502, body: { error: 'the endpoint did not answer' } }],
    ['GET', '/api/providers/openai/models', ok(LIST)],
    ['POST', '/api/providers/openai/import-models', ok({ serverLabel: 'llama.cpp', created: ['box-m1'], updated: [], skipped: [] })],
  ] });
  await toProviderList(window, doc, 'openai');
  const listed = () => calls.filter((c) => c.startsWith('GET /api/providers/openai/models'));
  assert.deepEqual(listed(), [], 'no address yet: nothing asked');
  assert.equal(doc.getElementById('mimp-msg').textContent, '', 'and nothing refused');
  const base = step2(doc).querySelector('.mimp-base');
  base.value = 'http://box:8080/v1';
  step2(doc).querySelector('.mimp-key').value = '${BOX_KEY}';
  base.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  // A second Enter (or a preset) while the list is out asks nothing more.
  base.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  press(window, step2(doc).querySelector('.mimp-preset[data-preset="gemini"]'));
  assert.equal(base.value, 'http://box:8080/v1', 'the preset waits for the list out');
  await settle();
  assert.deepEqual(listed(), ['GET /api/providers/openai/models?baseUrl=http%3A%2F%2Fbox%3A8080%2Fv1']);
  assert.equal(heads.find((h) => h.url.startsWith('/api/providers/openai/models')).headers['X-Worca-Endpoint-Key'], '${BOX_KEY}', 'the key rides a header');
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="m1"]'), true);
  // Another address and another key that refuse: the list shown stays, and so does its tick's "Add 1 model" — with the
  // address and key IT was listed with.
  base.value = 'http://down';
  step2(doc).querySelector('.mimp-key').value = 'sk-other';
  base.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle();
  assert.equal(doc.getElementById('mimp-msg').textContent, 'the endpoint did not answer');
  assert.deepEqual([doc.getElementById('mimp-go').textContent, doc.getElementById('mimp-go').disabled], ['Add 1 model', false]);
  clearToasts(doc);
  press(window, doc.getElementById('mimp-go'));
  await settle(16);
  const post = bodies.find((b) => b.url === '/api/providers/openai/import-models');
  assert.deepEqual(post?.body, { ids: ['m1'], baseUrl: 'http://box:8080/v1', apiKey: '${BOX_KEY}' }, 'never the key typed for http://down');
  assert.equal(lastToast(doc).title, 'Imported from llama.cpp');
  await toProviderList(window, doc, 'openai');
  press(window, step2(doc).querySelector('.mimp-preset[data-preset="gemini"]'));
  await settle();
  assert.equal(step2(doc).querySelector('.mimp-base').value, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(step2(doc).querySelector('.mimp-key').value, '${GEMINI_API_KEY}');
  assert.equal(listed().at(-1), 'GET /api/providers/openai/models?baseUrl=https%3A%2F%2Fgenerativelanguage.googleapis.com%2Fv1beta%2Fopenai');
});

test('11. a provider row\'s Import opens step 2 on that provider and lists it', async () => {
  const { window, doc, calls } = await boot({ hash: 'models/providers', arms: [
    ['GET', '/api/providers/openai/models', ok({ server: 'openrouter', serverLabel: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', warnings: [], models: [] })],
    ['GET', '/api/providers', ok({ openrouter: { keySet: true } })],
  ] });
  press(window, doc.querySelector('#providers-list .mv-or-browse'));
  assert.equal(window.location.hash, '#models', 'the Catalogue at the click');
  await settle();
  assert.equal(shown(doc), true);
  assert.equal(step2(doc)?.querySelector('select.mdl-add-provider').value, 'openrouter');
  assert.ok(calls.includes('GET /api/providers/openai/models?baseUrl=https%3A%2F%2Fopenrouter.ai%2Fapi%2Fv1'), 'its list asked for');
  assert.equal(doc.getElementById('models-tab-catalogue').hidden, false, 'over the Catalogue');
});

// ── Copies keep their connection (Task 6, slice 2): Duplicate, Edit a copy, "Change where it runs" ──────────────────
const catRow = (doc, id) => [...doc.querySelectorAll('#models-list .mdl-row[data-id]')].find((n) => n.dataset.id === id) || null;
/** A Catalogue row's side panel, then one of its actions (`edit`, `duplicate`, `copy` = Edit a copy). */
async function openAct(window, doc, id, act) {
  press(window, catRow(doc, id));
  await settle(2);
  press(window, doc.querySelector(`#model-panel-host .mdl-act[data-act="${act}"]`));
  await settle();
}
const envRows = (f) => [...f.querySelectorAll('.mv-env-row')].map((r) => [r.querySelector('.mv-env-key').value, r.querySelector('.mv-env-val').value]);
const modelPost = (bodies) => bodies.find((b) => b.method === 'POST' && b.url === '/api/models');
// gw-claude as GET /api/models lists it: every literal env value masked (maskModelEnvValue, model-env.mjs).
const MASKED_GW = { ANTHROPIC_BASE_URL: '••••••mple', ANTHROPIC_AUTH_TOKEN: '••••••9999' };
const RAW_GW = { ANTHROPIC_BASE_URL: 'https://gw.example', ANTHROPIC_AUTH_TOKEN: 'tok-secret-9999' };
const maskedGwModels = () => modelsBody({ models: data().models.map((m) => (m.id === 'gw-claude' ? { ...m, env: MASKED_GW } : m)) });

test('5. Duplicate keeps harness and connection and shows no secret: a copy form of the source, masks echoed, no raw read', async () => {
  await checkRows([
    { name: 'a Copilot provider model: "Add a copy" on the provider form with a free id; the POST keeps the upstream (nothing masked: no source named)', run: async () => {
      const { window, doc, calls, bodies } = await boot({ hash: 'models', arms: [['POST', '/api/models', ok({ ok: true })]] });
      await openAct(window, doc, 'my-copilot-gpt', 'duplicate');
      const f = form(doc);
      assert.ok(f, 'the form');
      assert.equal(f.querySelector('.mv-editor-title').textContent, 'Add a copy');
      assert.equal(f.dataset.where, 'provider');
      assert.equal(f.dataset.copyFrom, 'my-copilot-gpt');
      assert.equal(f.querySelector('.mv-id').value, 'my-copilot-gpt-copy');
      assert.equal(f.querySelector('.mv-label').value, 'My Copilot GPT copy', 'a custom label gets " copy"');
      assert.equal(f.querySelector('.mv-conn-provider').value, 'copilot');
      assert.equal(f.querySelector('.mv-save').disabled, false);
      assert.equal(calls.some((c) => c.includes('/env-value')), false, 'no raw value read');
      edit(window, f.querySelector('.mv-id'), 'GW-Claude');
      assert.equal(f.querySelector('.mv-save').disabled, true, 'an id the catalogue lists is refused');
      edit(window, f.querySelector('.mv-id'), 'my-copilot-gpt-copy');
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      const post = modelPost(bodies);
      assert.equal(post?.body?.id, 'my-copilot-gpt-copy');
      assert.equal('copyFrom' in post.body, false, 'no masked value for the server to fill');
      const { provider, api, model } = post.body.upstream || {};
      assert.deepEqual({ provider, api, model }, { provider: 'copilot', api: 'anthropic', model: 'claude-sonnet-5.5' });
      assert.equal(lastToast(doc).title, 'Model added.');
      assert.equal(shown(doc), false, 'the dialog closed');
    } },
    { name: 'an env model: its rows show the listed masks, nothing raw is read; the POST echoes the masks for the server to fill', run: async () => {
      const { window, doc, calls, bodies } = await boot({ hash: 'models', arms: [
        ['POST', '/api/models', ok({ ok: true })],
        ['GET', '/api/models', () => ok(maskedGwModels())],
      ] });
      await openAct(window, doc, 'gw-claude', 'duplicate');
      const f = form(doc);
      assert.equal(f?.dataset.where, 'env');
      assert.equal(f.querySelector('.mv-id').value, 'gw-claude-copy');
      assert.deepEqual(envRows(f), Object.entries(MASKED_GW), 'the masks as listed, each row once');
      assert.equal(calls.some((c) => c.includes('/env-value')), false, 'no raw value read');
      assert.equal(f.querySelector('.mv-save').disabled, false);
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      const post = modelPost(bodies);
      assert.equal(post?.body?.copyFrom, 'gw-claude');
      assert.deepEqual(post.body.env, MASKED_GW);
    } },
    { name: 'a copy the server refuses: the card says "Not added" with its reason, the form stays as typed, Save is usable again', run: async () => {
      const { cardAlertOf } = await import('./helpers/feedback.mjs');
      let answer = null;
      const { window, doc } = await boot({ hash: 'models', arms: [
        ['POST', '/api/models', () => answer],
        ['GET', '/api/models', () => ok(maskedGwModels())],
      ] });
      await openAct(window, doc, 'gw-claude', 'duplicate');
      const f = form(doc);
      answer = { status: 400, body: { error: '"ANTHROPIC_AUTH_TOKEN" has no value to copy' } };
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      assert.equal(shown(doc), true, 'the dialog stays');
      assert.equal(form(doc), f, 'the same form');
      assert.deepEqual(cardAlertOf(f), { title: 'Not added', detail: '"ANTHROPIC_AUTH_TOKEN" has no value to copy' });
      assert.deepEqual(envRows(f), Object.entries(MASKED_GW), 'the rows as they were');
      assert.equal(f.querySelector('.mv-save').disabled, false);
      // Refused again while the id was cleared meanwhile: Save follows the form, not withButton's idle state.
      const gate = held();
      answer = gate.promise.then(() => ({ status: 400, body: { error: 'nope' } }));
      press(window, f.querySelector('.mv-save'));
      await tick();
      edit(window, f.querySelector('.mv-id'), '');
      gate.release();
      await settle(16);
      assert.equal(cardAlertOf(f)?.detail, 'nope');
      assert.equal(f.querySelector('.mv-save').disabled, true, 'an empty id keeps Save off');
    } },
    { name: 'a copy whose source was deleted meanwhile: the card says what to do; the values typed over the masks save, with no copyFrom', run: async () => {
      const { cardAlertOf } = await import('./helpers/feedback.mjs');
      const { window, doc, bodies } = await boot({ hash: 'models', arms: [
        ['POST', '/api/models', (b) => (b.copyFrom ? { status: 400, body: { error: `unknown model to copy from "${b.copyFrom}"` } } : ok({ ok: true }))],
        ['GET', '/api/models', () => ok(maskedGwModels())],
      ] });
      await openAct(window, doc, 'gw-claude', 'duplicate');
      const f = form(doc);
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      assert.deepEqual(cardAlertOf(f), { title: 'Not added', detail: 'The model this copies was removed. Type the values it masked, then Add.' });
      const val = (k) => [...f.querySelectorAll('.mv-env-row')].find((r) => r.querySelector('.mv-env-key').value === k).querySelector('.mv-env-val');
      edit(window, val('ANTHROPIC_BASE_URL'), RAW_GW.ANTHROPIC_BASE_URL);
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      assert.equal(shown(doc), true, 'one mask left: still refused');
      edit(window, val('ANTHROPIC_AUTH_TOKEN'), RAW_GW.ANTHROPIC_AUTH_TOKEN);
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      const posts = bodies.filter((b) => b.method === 'POST' && b.url === '/api/models');
      assert.equal(posts.length, 3);
      assert.equal('copyFrom' in posts[2].body, false, 'nothing masked any more: no source named');
      assert.deepEqual(posts[2].body.env, RAW_GW);
      assert.equal(shown(doc), false, 'added');
    } },
  ]);
});

test('6. Edit a copy asks for the plugin secrets, keeps harness and connection, and sends no copyFrom', async () => {
  const CODEX_UP = { provider: 'openai', api: 'openai-responses', model: 'gpt-x' };
  const plugins = () => modelsBody({ plugin: [...data().plugin, { id: 'acme-codex', label: 'Acme Codex', engine: 'codex', efforts: ['medium'], plugin: 'acme-models', upstream: CODEX_UP, testable: true }] });
  const PLACEHOLDER = 'value required: the plugin secret is not copied';
  await checkRows([
    { name: 'a Claude Code plugin model: its literal rows, an empty row per secret with the placeholder; the POST has no copyFrom', run: async () => {
      const { window, doc, bodies } = await boot({ hash: 'models', arms: [
        ['GET', '/api/plugins/acme-models/model-env', ok({ id: 'acme-stable', label: 'Acme Stable', efforts: ['medium'], env: { L: 'lit' }, secretKeys: ['K'] })],
        ['POST', '/api/models', ok({ ok: true })],
      ] });
      await openAct(window, doc, 'acme-stable', 'copy');
      const f = form(doc);
      assert.equal(f?.dataset.where, 'signin');
      assert.deepEqual(envRows(f), [['L', 'lit'], ['K', '']]);
      const k = [...f.querySelectorAll('.mv-env-row')].find((r) => r.querySelector('.mv-env-key').value === 'K');
      assert.equal(k.querySelector('.mv-env-val').placeholder, PLACEHOLDER);
      edit(window, k.querySelector('.mv-env-val'), 'typed');
      assert.equal(f.querySelector('.mv-save').disabled, false, 'the copy may take the plugin model\'s own id (it shadows it)');
      edit(window, f.querySelector('.mv-id'), 'gw-claude');
      assert.equal(f.querySelector('.mv-save').disabled, true, 'but no other id the catalogue lists');
      edit(window, f.querySelector('.mv-id'), 'acme-stable');
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      const post = modelPost(bodies);
      assert.equal(post?.body?.id, 'acme-stable');
      assert.deepEqual(post.body.env, { L: 'lit', K: 'typed' });
      assert.equal('copyFrom' in post.body, false);
    } },
    { name: 'a Codex plugin model with an upstream: the provider form on Codex keeps the plugin model\'s id (the copy shadows it); the POST keeps id, engine and upstream, no copyFrom', run: async () => {
      const { window, doc, bodies } = await boot({ hash: 'models', arms: [
        ['GET', '/api/plugins/acme-models/model-env?id=acme-codex', ok({ id: 'acme-codex', label: 'Acme Codex', efforts: ['medium'], env: {}, secretKeys: [], engine: 'codex', upstream: CODEX_UP })],
        ['POST', '/api/models', ok({ ok: true })],
        ['GET', '/api/models', () => ok(plugins())],
      ] });
      await openAct(window, doc, 'acme-codex', 'copy');
      const f = form(doc);
      assert.equal(f?.dataset.where, 'provider');
      assert.equal(f.dataset.engine, 'codex');
      assert.equal(f.querySelector('.mv-id').value, 'acme-codex', 'not the provider handle openai-gpt-x');
      assert.equal(f.querySelector('.mv-save').disabled, false);
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      const post = modelPost(bodies);
      assert.equal(post?.body?.id, 'acme-codex');
      assert.equal(post.body.engine, 'codex');
      assert.equal(post.body.upstream?.model, 'gpt-x');
      assert.equal('copyFrom' in post.body, false);
    } },
    { name: 'a plugin model on its own endpoint: each env key once (the endpoint form\'s two rows take the plugin\'s), Save open', run: async () => {
      const { window, doc } = await boot({ hash: 'models', arms: [
        ['GET', '/api/plugins/acme-models/model-env', ok({ id: 'acme-stable', label: 'Acme Stable', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: 'https://acme.example' }, secretKeys: ['ANTHROPIC_AUTH_TOKEN'] })],
      ] });
      await openAct(window, doc, 'acme-stable', 'copy');
      const f = form(doc);
      assert.equal(f?.dataset.where, 'env');
      assert.deepEqual(envRows(f), [['ANTHROPIC_BASE_URL', 'https://acme.example'], ['ANTHROPIC_AUTH_TOKEN', '']]);
      const token = [...f.querySelectorAll('.mv-env-row')].find((r) => r.querySelector('.mv-env-key').value === 'ANTHROPIC_AUTH_TOKEN');
      assert.equal(token.querySelector('.mv-env-val').placeholder, PLACEHOLDER);
      assert.equal(f.querySelector('.mv-save').disabled, false, 'no two rows share a name');
    } },
  ]);
});

test('12. "Change where it runs": step 1 on the model\'s harness, Continue brings the same form back with what was typed', async () => {
  const withCodex = () => modelsBody({ models: [...data().models, { id: 'my-codex', label: 'My Codex', engine: 'codex', efforts: ['medium'], testable: true }] });
  await checkRows([
    { name: 'a provider model to a sign-in: no tiles, "Continue", the typed name kept; Save sends upstream null', run: async () => {
      const { window, doc, bodies } = await boot({ hash: 'models', arms: [['PATCH', '/api/models/my-copilot-gpt', ok({ ok: true })]] });
      await openAct(window, doc, 'my-copilot-gpt', 'edit');
      const f = form(doc);
      assert.equal(f?.dataset.mode, 'edit');
      edit(window, f.querySelector('.mv-label'), 'Renamed');
      const title = f.querySelector('.mv-editor-title').textContent;
      press(window, f.querySelector('.mv-rewhere'));
      await settle(2);
      const s1 = step1(doc);
      assert.ok(s1, 'step 1');
      assert.ok(title.startsWith('Edit '), title);
      assert.equal(s1.querySelector('.mv-editor-title').textContent, title, 'still the edit\'s title, not "Add model"');
      assert.equal(s1.querySelector('.mdl-hx'), null, 'no harness tiles: the harness is the model\'s');
      assert.equal(s1.querySelector('.mdl-next').textContent, 'Continue');
      assert.equal(s1.querySelector('.mdl-opt[aria-checked="true"]').dataset.where, 'provider', 'preset to where it runs');
      assert.equal(s1.querySelector('select.mdl-add-provider').value, 'copilot', 'and its provider');
      press(window, s1.querySelector('.mdl-opt[data-where="signin"]'));
      press(window, s1.querySelector('.mdl-next'));
      await settle(2);
      assert.equal(form(doc), f, 'the same form, put back');
      assert.equal(f.dataset.where, 'signin');
      assert.equal(f.querySelector('.mv-label').value, 'Renamed', 'what was typed stays');
      assert.equal(doc.activeElement, f.querySelector('.mv-save'), 'still an edit: the focus on Save, as the edit opened');
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      const patch = bodies.find((b) => b.method === 'PATCH' && b.url === '/api/models/my-copilot-gpt');
      assert.equal(patch?.body?.upstream, null);
      assert.equal(patch.body.label, 'Renamed');
    } },
    { name: 'another provider: the form\'s Provider follows step 1 (OpenRouter fills its address); Escape then asks', run: async () => {
      const { window, doc } = await boot({ hash: 'models' });
      await openAct(window, doc, 'my-copilot-gpt', 'edit');
      const f = form(doc);
      press(window, f.querySelector('.mv-rewhere'));
      await settle(2);
      edit(window, step1(doc).querySelector('select.mdl-add-provider'), 'openrouter');
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle(2);
      assert.equal(form(doc), f);
      assert.equal(f.dataset.where, 'provider');
      assert.equal(f.querySelector('.mv-conn-provider').value, 'openrouter');
      assert.equal(f.querySelector('.mv-conn-baseurl').value, 'https://openrouter.ai/api/v1');
      pressEscape(window);
      await tick();
      assert.equal(discardPrompt(doc)?.querySelector('.confirm-message').textContent, 'This model has unsaved changes.', 'a new place to run is a change');
      keepEditing(doc);
      await settle(2);
      assert.equal(shown(doc), true);
    } },
    { name: 'Continue on the same place is no change; typed work before the step still is', run: async () => {
      const { window, doc } = await boot({ hash: 'models' });
      await openAct(window, doc, 'my-copilot-gpt', 'edit');
      press(window, form(doc).querySelector('.mv-rewhere'));
      await settle(2);
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle(2);
      assert.equal(form(doc)?.dataset.where, 'provider');
      pressEscape(window);
      await settle(2);
      assert.equal(discardPrompt(doc), null, 'nothing changed: no question');
      assert.equal(shown(doc), false);
      press(window, doc.querySelector('#model-panel-host .mdl-act[data-act="edit"]'));   // the side panel is still open
      await settle();
      edit(window, form(doc).querySelector('.mv-label'), 'Renamed');
      press(window, form(doc).querySelector('.mv-rewhere'));
      await settle(2);
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle(2);
      pressEscape(window);
      await tick();
      assert.ok(discardPrompt(doc), 'the name typed before the step is not lost silently');
      keepEditing(doc);
      await settle(2);
    } },
    { name: 'a new place alone, nothing typed: Escape asks', run: async () => {
      const { window, doc } = await boot({ hash: 'models' });
      await openAct(window, doc, 'my-copilot-gpt', 'edit');
      press(window, form(doc).querySelector('.mv-rewhere'));
      await settle(2);
      press(window, step1(doc).querySelector('.mdl-opt[data-where="signin"]'));
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle(2);
      assert.equal(form(doc)?.dataset.where, 'signin');
      pressEscape(window);
      await tick();
      assert.ok(discardPrompt(doc), 'a new place to run is a change');
      keepEditing(doc);
      await settle(2);
    } },
    { name: 'a custom endpoint to a sign-in: its routing rows go, so Save clears them and the model is a sign-in', run: async () => {
      const { window, doc, bodies } = await boot({ hash: 'models', arms: [
        ['PATCH', '/api/models/gw-claude', ok({ ok: true })],
        ['GET', '/api/models', () => ok(maskedGwModels())],
      ] });
      await openAct(window, doc, 'gw-claude', 'edit');
      const f = form(doc);
      assert.equal(f?.dataset.where, 'env');
      press(window, f.querySelector('.mv-rewhere'));
      await settle(2);
      press(window, step1(doc).querySelector('.mdl-opt[data-where="signin"]'));
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle(2);
      assert.equal(f.dataset.where, 'signin');
      assert.deepEqual(envRows(f), [], 'no routing row left');
      assert.equal(f.querySelector('.mv-save').disabled, false);
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      const patch = bodies.find((b) => b.method === 'PATCH' && b.url === '/api/models/gw-claude');
      assert.deepEqual(patch?.body?.env, { ANTHROPIC_BASE_URL: null, ANTHROPIC_AUTH_TOKEN: null });
      assert.equal(patch.body.upstream, null);
    } },
    { name: 'a provider model to a custom endpoint: the two routing rows; Save waits for the address, then sends them', run: async () => {
      const { window, doc, bodies } = await boot({ hash: 'models', arms: [['PATCH', '/api/models/my-copilot-gpt', ok({ ok: true })]] });
      await openAct(window, doc, 'my-copilot-gpt', 'edit');
      const f = form(doc);
      press(window, f.querySelector('.mv-rewhere'));
      await settle(2);
      press(window, step1(doc).querySelector('.mdl-opt[data-where="env"]'));
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle(2);
      assert.equal(form(doc), f);
      assert.equal(f.dataset.where, 'env');
      assert.deepEqual(envRows(f), [['ANTHROPIC_BASE_URL', ''], ['ANTHROPIC_AUTH_TOKEN', '']]);
      assert.equal(f.querySelector('.mv-save').disabled, true, 'no address: it would save as a sign-in');
      assert.equal(f.querySelector('.mv-env-problem').textContent, 'ANTHROPIC_BASE_URL needs a value');
      const val = (k) => [...f.querySelectorAll('.mv-env-row')].find((r) => r.querySelector('.mv-env-key').value === k).querySelector('.mv-env-val');
      edit(window, val('ANTHROPIC_BASE_URL'), 'https://gw2.example');
      edit(window, val('ANTHROPIC_AUTH_TOKEN'), 'tok-2');
      assert.equal(f.querySelector('.mv-save').disabled, false);
      press(window, f.querySelector('.mv-save'));
      await settle(16);
      const patch = bodies.find((b) => b.method === 'PATCH' && b.url === '/api/models/my-copilot-gpt');
      assert.deepEqual(patch?.body?.env, { ANTHROPIC_BASE_URL: 'https://gw2.example', ANTHROPIC_AUTH_TOKEN: 'tok-2' });
      assert.equal(patch.body.upstream, null);
    } },
    { name: 'a Codex model: its own endpoint is not offered', run: async () => {
      const { window, doc } = await boot({ hash: 'models', arms: [['GET', '/api/models', () => ok(withCodex())]] });
      press(window, doc.querySelector('#models-list .mdl-grp[data-engine="codex"] .mdl-grp-toggle'));   // a harness other than Claude Code's starts folded
      await settle(2);
      await openAct(window, doc, 'my-codex', 'edit');
      assert.equal(form(doc)?.dataset.engine, 'codex');
      press(window, form(doc).querySelector('.mv-rewhere'));
      await settle(2);
      const s1 = step1(doc);
      assert.equal(s1.querySelector('.mdl-hx'), null);
      const off = Object.fromEntries([...s1.querySelectorAll('.mdl-opt[data-where]')].map((b) => [b.dataset.where, b.disabled]));
      assert.deepEqual(off, { provider: false, signin: false, env: true });
    } },
  ]);
});

test('13. "Show values" and a row\'s copy in a Duplicate read the SOURCE\'s stored values', async () => {
  const { window, doc, calls } = await boot({ hash: 'models', arms: [
    ['GET', '/api/models/gw-claude/env-value', ok({ env: RAW_GW, value: RAW_GW.ANTHROPIC_AUTH_TOKEN })],
    ['GET', '/api/models', () => ok(maskedGwModels())],
  ] });
  await openAct(window, doc, 'gw-claude', 'duplicate');
  const f = form(doc);
  assert.deepEqual(envRows(f), Object.entries(MASKED_GW), 'masked until asked');
  press(window, f.querySelector('.mv-env-reveal'));
  await settle();
  assert.ok(calls.includes('GET /api/models/gw-claude/env-value'), 'Show values asks the source');
  assert.deepEqual(envRows(f), Object.entries(RAW_GW));
  const token = [...f.querySelectorAll('.mv-env-row')].find((r) => r.querySelector('.mv-env-key').value === 'ANTHROPIC_AUTH_TOKEN');
  press(window, token.querySelector('.mv-env-copy'));
  await settle();
  assert.ok(calls.includes('GET /api/models/gw-claude/env-value?key=ANTHROPIC_AUTH_TOKEN'), 'a row\'s copy asks the source');
});

// ── Share as plugin from the page head's More menu, in the modal (Task 6, slice 3) ───────────────────────────────────
const menuItem = (doc, label) => [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === label);

/** The page head's More › Share as plugin. */
async function openShare(window, doc) {
  press(window, doc.getElementById('models-more-btn'));
  await settle(2);
  press(window, menuItem(doc, 'Share as plugin'));
  await settle(2);
}

/** Tick `id`, fill the name and the folder: Export scaffold can go. */
function fillShare(window, doc, id = 'gw-claude') {
  const w = screen(doc, '.mvx');
  edit(window, [...w.querySelectorAll('.mvx-model-cb')].find((cb) => cb.value === id), true);
  edit(window, w.querySelector('.mvx-name'), 'team-models');
  edit(window, w.querySelector('.mvx-dest'), '/home/me/dev/team-models');
  return w;
}

test('8. Share as plugin opens from More, in the modal: Export closes it with a toast naming what was left out; Cancel closes it', async () => {
  const LEFT_OUT = [{ id: 'gw2', what: 'provider key' }, { id: 'gw2', what: 'header X-Api-Key' }];
  let answer = null;
  const { window, doc, bodies } = await boot({ hash: 'models', arms: [
    ['POST', '/api/models/export-plugin', () => answer],
  ] });
  const written = (omitted) => ok({ ok: true, dir: '/home/me/dev/team-models', files: ['worca-cc-plugin.json'], modelSecrets: [], omitted });
  await checkRows([
    { name: 'More › Share as plugin: the wizard is the modal\'s screen and the list holds none of it; Cancel closes it', run: async () => {
      const more = doc.getElementById('models-more-btn');
      assert.equal(more.getAttribute('aria-label'), 'More');
      assert.equal(more.textContent.trim(), '', 'an icon, no typed label');
      press(window, more);
      await settle(2);
      assert.deepEqual([...doc.querySelectorAll('.wfv-menu [role^="menuitem"] .wfv-menu-l')].map((n) => n.textContent), ['Share as plugin']);
      press(window, menuItem(doc, 'Share as plugin'));
      await settle(2);
      assert.equal(shown(doc), true);
      assert.ok(screen(doc, '.mvx'), 'the wizard in the modal');
      assert.equal(doc.querySelector('#models-list .mvx'), null, 'nothing in the list');
      assert.equal(doc.getElementById('mv-editor-heading')?.textContent, 'Share as plugin');
      press(window, screen(doc, '.mvx-cancel'));
      assert.equal(shown(doc), false, 'Cancel closes it');
      assert.equal(discardPrompt(doc), null);
    } },
    { name: 'Export scaffold posts, closes the modal and toasts where the scaffold went and what it left out', run: async () => {
      answer = written(LEFT_OUT);
      await openShare(window, doc);
      fillShare(window, doc);
      clearToasts(doc);
      press(window, screen(doc, '.mvx-export'));
      await settle(16);
      const post = bodies.find((b) => b.url === '/api/models/export-plugin');
      assert.deepEqual([post?.body.name, post?.body.dest, post?.body.models.map((m) => m.id)], ['team-models', '/home/me/dev/team-models', ['gw-claude']]);
      assert.equal(shown(doc), false, 'the modal closes');
      const t = lastToast(doc);
      assert.deepEqual([t?.tone, t?.title, t?.detail], ['ok', 'Plugin scaffold written to /home/me/dev/team-models.',
        'Not included: provider key (gw2), header X-Api-Key (gw2).']);
    } },
    { name: 'nothing left out: the toast is the title alone', run: async () => {
      answer = written([]);
      await openShare(window, doc);
      fillShare(window, doc);
      clearToasts(doc);
      press(window, screen(doc, '.mvx-export'));
      await settle(16);
      assert.equal(shown(doc), false);
      assert.deepEqual([lastToast(doc)?.title, lastToast(doc)?.detail], ['Plugin scaffold written to /home/me/dev/team-models.', '']);
    } },
    { name: 'a refusal stays in the wizard\'s line, the modal open and Export usable again', run: async () => {
      answer = { status: 400, body: { error: 'destination folder is not empty' } };
      await openShare(window, doc);
      fillShare(window, doc);
      clearToasts(doc);
      press(window, screen(doc, '.mvx-export'));
      await settle(16);
      assert.equal(shown(doc), true);
      assert.equal(screen(doc, '.mvx-msg').textContent, 'destination folder is not empty');
      assert.equal(lastToast(doc), null, 'no toast');
      assert.equal(screen(doc, '.mvx-export').disabled, false);
      press(window, screen(doc, '.mvx-cancel'));
      assert.equal(shown(doc), false);
    } },
    { name: 'while the export is out, Escape and Cancel wait; its answer closes the modal', run: async () => {
      const gate = held();
      answer = gate.promise.then(() => written([]));
      await openShare(window, doc);
      fillShare(window, doc);
      press(window, screen(doc, '.mvx-export'));
      await tick();
      pressEscape(window);
      await tick();
      press(window, screen(doc, '.mvx-cancel'));
      await tick();
      assert.equal(discardPrompt(doc), null, 'not even the question');
      assert.equal(shown(doc), true);
      gate.release();
      await settle(16);
      assert.equal(shown(doc), false, 'the answer closes it');
    } },
    { name: 'a model ticked, then Escape: the dialogs\' own question; Close closes at once', run: async () => {
      await openShare(window, doc);
      fillShare(window, doc);
      pressEscape(window);
      await tick();
      assert.equal(discardPrompt(doc)?.querySelector('.confirm-message').textContent, 'Your changes in this dialog will be lost.');
      keepEditing(doc);
      await settle(2);
      assert.equal(shown(doc), true);
      press(window, screen(doc, '.mdl-close'));
      assert.equal(shown(doc), false);
      assert.equal(discardPrompt(doc), null);
    } },
  ]);
});

// ── Review fixes (cycle 2): what the flow reads at answer time belongs to the open, card and list that asked ──────────
const enter = (window, node) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

test('14. an import sends the address and key its list was asked with, never ones typed after it; Enter lists nothing while it is out', async () => {
  const LIST = { server: 'llama', serverLabel: 'llama.cpp', baseUrl: 'http://box:8080/v1', warnings: [], models: [{ id: 'm1', catalogId: 'box-m1', name: 'M1', importable: true }] };
  let importing = null;
  const imported = () => ok({ serverLabel: 'llama.cpp', created: ['box-m1'], updated: [], skipped: [] });
  const { window, doc, calls, bodies } = await boot({ hash: 'models', arms: [
    ['GET', '/api/providers/openai/models', ok(LIST)],
    ['POST', '/api/providers/openai/import-models', () => (importing ? importing.promise.then(imported) : imported())],
  ] });
  const lists = () => calls.filter((c) => c.startsWith('GET /api/providers/openai/models')).length;
  await toProviderList(window, doc, 'openai');
  step2(doc).querySelector('.mimp-base').value = 'http://box:8080/v1';
  step2(doc).querySelector('.mimp-key').value = '${BOX_KEY}';
  press(window, step2(doc).querySelector('.mimp-list'));
  await settle();
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="m1"]'), true);
  // Another address and key typed, then Enter an id instead and Back: the screen draws them again, the list stays the box's.
  step2(doc).querySelector('.mimp-base').value = 'http://other:1/v1';
  step2(doc).querySelector('.mimp-key').value = 'sk-other';
  press(window, step2(doc).querySelector('.mdl-manual'));
  await settle(2);
  press(window, form(doc).querySelector('.mv-back'));
  await settle(2);
  assert.equal(step2(doc).querySelector('.mimp-base').value, 'http://other:1/v1', 'the typed address drawn again');
  assert.equal(step2(doc).querySelector('.mimp-key').value, 'sk-other');
  assert.equal(doc.querySelector('#mimp-body .mvi-cb[value="m1"]').checked, true, 'the listed sheet with its tick');
  const before = lists();
  importing = held();
  press(window, doc.getElementById('mimp-go'));
  await tick();
  enter(window, step2(doc).querySelector('.mimp-base'));
  await settle(2);
  assert.equal(lists(), before, 'no list while the import is out');
  importing.release();
  await settle(16);
  const post = bodies.find((b) => b.url === '/api/providers/openai/import-models');
  assert.deepEqual(post?.body, { ids: ['m1'], baseUrl: 'http://box:8080/v1', apiKey: '${BOX_KEY}' }, 'sk-other never goes to the box');
});

test('15. an import that adds and refreshes nothing does not narrow the Catalogue to "Just imported"', async () => {
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/providers/copilot/models', ok(COPILOT_LIST)],
    ['POST', '/api/providers/copilot/import-models', ok({ created: [], updated: [], skipped: [{ id: 'gpt-5' }] })],
    ['GET', '/api/providers', ok({ copilot: { connected: true } })],
  ] });
  await toProviderList(window, doc);
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), true);
  clearToasts(doc);
  press(window, doc.getElementById('mimp-go'));
  await settle(16);
  assert.deepEqual([lastToast(doc).title, lastToast(doc).detail], ['Imported from Copilot', '1 skipped.']);
  assert.equal(shown(doc), false);
  assert.equal(doc.querySelector('#models-list .filter-chip[data-filter="imported"]'), null, 'nothing landed: no "Just imported"');
});

test('16. a late /api/engines answer redraws step 1 but never hands one provider\'s list to another', async () => {
  let gate = null;
  const ENGINES = ok({ engines: ENGINE_NAMES.map((name) => ({ name, label: name, ready: true })) });
  const { window, doc, calls } = await boot({ hash: 'models', arms: [
    ['GET', '/api/engines', () => (gate ? gate.promise.then(() => ENGINES) : ENGINES)],
    ['GET', '/api/providers/openai/models', ok({ server: 'openrouter', serverLabel: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', warnings: [], models: [] })],
    ['GET', '/api/providers/copilot/models', ok(COPILOT_LIST)],
    ['GET', '/api/providers', ok({ copilot: { connected: true }, openrouter: { keySet: true } })],
  ] });
  gate = held();
  await toProviderList(window, doc);
  assert.ok(doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), 'Copilot\'s list');
  press(window, step2(doc).querySelector('.mv-back'));
  await settle(2);
  edit(window, step1(doc).querySelector('select.mdl-add-provider'), 'openrouter');
  const old = step1(doc);
  gate.release();
  await settle();
  assert.notEqual(step1(doc), old, 'step 1 drawn again');
  assert.equal(step1(doc).querySelector('select.mdl-add-provider').value, 'openrouter', 'with the pick it held');
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle();
  assert.equal(step2(doc).querySelector('select.mdl-add-provider').value, 'openrouter');
  assert.equal(doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), null, 'no Copilot row under OpenRouter');
  assert.ok(calls.includes('GET /api/providers/openai/models?baseUrl=https%3A%2F%2Fopenrouter.ai%2Fapi%2Fv1'), 'OpenRouter\'s own list asked for');
});

test('17. a list answer for a step 2 left meanwhile draws nothing: Back and Next on the same provider keep the newer list and its tick', async () => {
  let first = null;
  const OLD = { models: [{ id: 'old-1', name: 'Old', vendor: 'X' }] };
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/providers/copilot/models', () => { const g = first; first = null; return g ? g.promise.then(() => ok(OLD)) : ok(COPILOT_LIST); }],
    ['GET', '/api/providers', ok({ copilot: { connected: true } })],
  ] });
  const gate = held();
  first = gate;
  await toProviderList(window, doc);
  press(window, step2(doc).querySelector('.mv-back'));
  await settle(2);
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle();
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), true);
  gate.release();
  await settle();
  assert.equal(doc.querySelector('#mimp-body .mvi-cb[value="old-1"]'), null, 'the first list drew nothing');
  assert.equal(doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]').checked, true);
  assert.equal(doc.getElementById('mimp-go').textContent, 'Add 1 model');
  pressEscape(window);
  await tick();
  assert.ok(discardPrompt(doc), 'the tick is still a change: Escape asks');
  keepEditing(doc);
  await settle(2);
  press(window, step2(doc).querySelector('.mdl-manual'));
  await settle(2);
  press(window, form(doc).querySelector('.mv-back'));
  await settle(2);
  assert.equal(doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]').checked, true, 'the flow kept the tick');
});

test('18. an answer that lands after another screen opened (the page\'s Add model, by keyboard) leaves that screen alone', async () => {
  let gate = null;
  const later = (answer) => () => (gate ? gate.promise.then(() => answer) : answer);
  const reopen = async (window, doc) => {
    press(window, doc.getElementById('model-create-btn'));
    await settle(2);
    assert.ok(step1(doc), 'Add model\'s step 1 replaced the screen');
  };
  await checkRows([
    { name: 'Save: the PATCH answer neither closes step 1 nor loses its toast', run: async () => {
      const { window, doc } = await boot({ hash: 'models', arms: [['PATCH', '/api/models/my-copilot-gpt', later(ok({ ok: true }))]] });
      await openAct(window, doc, 'my-copilot-gpt', 'edit');
      edit(window, form(doc).querySelector('.mv-label'), 'Renamed');
      gate = held();
      press(window, form(doc).querySelector('.mv-save'));
      await tick();
      await reopen(window, doc);
      clearToasts(doc);
      gate.release();
      gate = null;
      await settle(16);
      assert.equal(shown(doc), true, 'still open');
      assert.ok(step1(doc), 'on step 1');
      assert.equal(lastToast(doc)?.title, 'Model saved.');
    } },
    { name: 'Save refused: step 1 stays and the refusal is a toast (the form that would show it is gone)', run: async () => {
      const { window, doc } = await boot({ hash: 'models', arms: [['PATCH', '/api/models/my-copilot-gpt', later({ status: 400, body: { error: 'label too long' } })]] });
      await openAct(window, doc, 'my-copilot-gpt', 'edit');
      gate = held();
      press(window, form(doc).querySelector('.mv-save'));
      await tick();
      await reopen(window, doc);
      clearToasts(doc);
      gate.release();
      gate = null;
      await settle(16);
      assert.ok(step1(doc), 'step 1 stays');
      assert.deepEqual([lastToast(doc)?.tone, lastToast(doc)?.title, lastToast(doc)?.detail], ['err', 'Not saved', 'label too long']);
    } },
    { name: 'Export scaffold: its answer neither closes step 1 nor loses its toast', run: async () => {
      const { window, doc } = await boot({ hash: 'models', arms: [['POST', '/api/models/export-plugin', later(ok({ ok: true, dir: '/home/me/dev/team-models', files: [], modelSecrets: [], omitted: [] }))]] });
      await openShare(window, doc);
      fillShare(window, doc);
      gate = held();
      press(window, screen(doc, '.mvx-export'));
      await tick();
      await reopen(window, doc);
      clearToasts(doc);
      gate.release();
      gate = null;
      await settle(16);
      assert.ok(step1(doc), 'step 1 stays');
      assert.equal(lastToast(doc)?.title, 'Plugin scaffold written to /home/me/dev/team-models.');
    } },
    { name: 'Edit a copy: the plugin\'s answer does not replace step 1 with its form', run: async () => {
      const { window, doc } = await boot({ hash: 'models', arms: [
        ['GET', '/api/plugins/acme-models/model-env', later(ok({ id: 'acme-stable', label: 'Acme Stable', efforts: ['medium'], env: { L: 'lit' }, secretKeys: [] }))],
      ] });
      gate = held();
      await openAct(window, doc, 'acme-stable', 'copy');
      assert.equal(shown(doc), false, 'the plugin has not answered');
      await reopen(window, doc);
      gate.release();
      gate = null;
      await settle(16);
      assert.ok(step1(doc), 'step 1 stays');
      assert.equal(form(doc), null, 'no form drawn over it');
    } },
    { name: 'an import: its answer leaves the new open\'s screen, list and ticks alone; a refusal it cannot show is a toast', run: async () => {
      let answer = ok({ created: ['copilot-gpt-5'], updated: [], skipped: [] });
      const { window, doc } = await boot({ hash: 'models', arms: [
        ['GET', '/api/providers/copilot/models', ok(COPILOT_LIST)],
        ['POST', '/api/providers/copilot/import-models', () => (gate ? gate.promise.then(() => answer) : answer)],
        ['GET', '/api/providers', ok({ copilot: { connected: true } })],
      ] });
      // A success: the new open stays.
      await toProviderList(window, doc);
      edit(window, doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), true);
      gate = held();
      press(window, doc.getElementById('mimp-go'));
      await tick();
      await reopen(window, doc);
      clearToasts(doc);
      gate.release();
      gate = null;
      await settle(16);
      assert.ok(step1(doc), 'step 1 stays');
      assert.equal(lastToast(doc)?.title, 'Imported from Copilot');
      press(window, step1(doc).querySelector('.mv-cancel'));
      // A refusal: the new open's list keeps its own ticks.
      answer = { status: 502, body: { error: 'Copilot did not answer' } };
      await toProviderList(window, doc);
      edit(window, doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), true);
      gate = held();
      press(window, doc.getElementById('mimp-go'));
      await tick();
      await reopen(window, doc);
      press(window, step1(doc).querySelector('.mdl-opt[data-where="provider"]'));
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle();
      edit(window, doc.querySelector('#mimp-body .mvi-cb[value="claude-x"]'), true);
      clearToasts(doc);
      gate.release();
      gate = null;
      await settle(16);
      assert.deepEqual([lastToast(doc)?.title, lastToast(doc)?.detail], ['Not imported', 'Copilot did not answer']);
      press(window, step2(doc).querySelector('.mdl-manual'));
      await settle(2);
      press(window, form(doc).querySelector('.mv-back'));
      await settle(2);
      assert.deepEqual([...doc.querySelectorAll('#mimp-body .mvi-cb:checked')].map((c) => c.value), ['claude-x'], 'its own tick, not the old import\'s');
      assert.equal(doc.getElementById('mimp-go').disabled, false);
    } },
  ]);
});

test('19. Back from the form, then Next or "Enter an id instead": the same form, with what was typed, moved to the new pick', async () => {
  await checkRows([
    { name: 'a sign-in: Next brings the typed name and id back; another harness or a custom endpoint moves the same form', run: async () => {
      const { window, doc } = await boot({ hash: 'models' });
      await toSignInForm(window, doc);
      const f = form(doc);
      edit(window, f.querySelector('.mv-label'), 'Mine');
      edit(window, f.querySelector('.mv-id'), 'mine-1');
      press(window, f.querySelector('.mv-back'));
      await settle(2);
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle(2);
      assert.equal(form(doc), f, 'the same form');
      assert.deepEqual([f.querySelector('.mv-label').value, f.querySelector('.mv-id').value], ['Mine', 'mine-1']);
      assert.equal(f.querySelector('.mv-save').disabled, false);
      press(window, f.querySelector('.mv-back'));
      await settle(2);
      press(window, step1(doc).querySelector('.mdl-hx-t[data-engine="codex"]'));
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle(2);
      assert.equal(form(doc), f);
      assert.equal(f.dataset.engine, 'codex', 'the harness picked now');
      assert.equal(f.querySelector('.mv-label').value, 'Mine');
      press(window, f.querySelector('.mv-back'));
      await settle(2);
      press(window, step1(doc).querySelector('.mdl-opt[data-where="env"]'));
      press(window, step1(doc).querySelector('.mdl-next'));
      await settle(2);
      assert.equal(form(doc), f);
      assert.deepEqual([f.dataset.where, f.dataset.engine], ['env', 'claude'], 'a custom endpoint runs on Claude Code');
      assert.deepEqual(envRows(f), [['ANTHROPIC_BASE_URL', ''], ['ANTHROPIC_AUTH_TOKEN', '']]);
      assert.equal(f.querySelector('.mv-label').value, 'Mine');
      pressEscape(window);
      await tick();
      assert.ok(discardPrompt(doc), 'the typed work still asks');
      keepEditing(doc);
      await settle(2);
    } },
    { name: 'Enter an id instead after another provider: the same form on that provider; moving it is no change', run: async () => {
      const { window, doc } = await boot({ hash: 'models', arms: [
        ['GET', '/api/providers/copilot/models', ok(COPILOT_LIST)],
        ['GET', '/api/providers', ok({ copilot: { connected: true } })],
      ] });
      await toProviderList(window, doc);
      press(window, step2(doc).querySelector('.mdl-manual'));
      await settle(2);
      const f = form(doc);
      assert.equal(f.querySelector('.mv-conn-provider').value, 'copilot');
      press(window, f.querySelector('.mv-back'));
      await settle(2);
      edit(window, step2(doc).querySelector('select.mdl-add-provider'), 'anthropic');
      await settle(2);
      press(window, step2(doc).querySelector('.mdl-manual'));
      await settle(2);
      assert.equal(form(doc), f, 'the same form');
      assert.equal(f.querySelector('.mv-conn-provider').value, 'anthropic', 'on the list\'s provider');
      pressEscape(window);
      await settle(2);
      assert.equal(discardPrompt(doc), null, 'nothing typed: no question');
      assert.equal(shown(doc), false);
    } },
  ]);
});

test('20. the broker on: step 1 greys out a locked harness, and a click on it leaves the sign-in on Claude Code', async () => {
  const row = (name) => ({ name, label: name, ready: name === 'claude', ...(name === 'claude' ? {} : { broker: true, reason: 'the credential broker is on' }) });
  // GET /api/engine-locks (boot) and GET /api/engines (readyEngines) both feed setEngineLocks: both say "broker".
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/engine-locks', ok({ engines: ENGINE_NAMES.filter((n) => n !== 'claude').map(row) })],
    ['GET', '/api/engines', ok({ engines: ENGINE_NAMES.map(row) })],
  ] });
  press(window, doc.getElementById('model-create-btn'));
  await settle();
  const tile = (name) => step1(doc).querySelector(`.mdl-hx-t[data-engine="${name}"]`);
  assert.equal(tile('codex').disabled, true);
  assert.equal(tile('codex').title, 'Off while the credential broker is on');
  assert.equal(tile('claude').disabled, false);
  press(window, tile('codex'));
  assert.equal(tile('claude').getAttribute('aria-pressed'), 'true', 'a click on a locked tile picks nothing');
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle(2);
  assert.equal(form(doc).querySelector('.mv-engine').value, 'claude', 'Next: the form runs on Claude Code');
});

test('21. a list loaded after step 2\'s provider changed is that provider\'s: Back and Next keep it and its tick, with no second request', async () => {
  const { window, doc, calls } = await boot({ hash: 'models', arms: [
    ['GET', '/api/providers/copilot/models', ok(COPILOT_LIST)],
    ['GET', '/api/providers', ok({ copilot: { connected: true } })],
  ] });
  const asked = () => calls.filter((c) => c.startsWith('GET /api/providers/copilot/models')).length;
  await toProviderList(window, doc, 'anthropic');
  edit(window, step2(doc).querySelector('select.mdl-add-provider'), 'copilot');
  await settle();
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), true);
  const before = asked();
  press(window, step2(doc).querySelector('.mv-back'));
  await settle(2);
  assert.equal(step1(doc).querySelector('select.mdl-add-provider').value, 'copilot');
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle();
  assert.equal(asked(), before, 'the kept list, not a second request');
  assert.equal(doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]').checked, true, 'with its tick');
});

test('22. step 2 opened from a provider row: its list is that provider\'s, so Back and Next keep it with its tick', async () => {
  const { window, doc, calls } = await boot({ hash: 'models/providers', arms: [
    ['GET', '/api/providers/copilot/models', ok(COPILOT_LIST)],
    ['GET', '/api/providers', ok({ copilot: { connected: true, login: 'ada', accountType: 'individual', maxConcurrent: 4 } })],
  ] });
  const asked = () => calls.filter((c) => c.startsWith('GET /api/providers/copilot/models')).length;
  press(window, doc.querySelector('#providers-list .mv-cp-fetch-models'));
  await settle();
  assert.equal(step2(doc)?.querySelector('select.mdl-add-provider').value, 'copilot');
  edit(window, doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), true);
  const before = asked();
  press(window, step2(doc).querySelector('.mv-back'));
  await settle(2);
  press(window, step1(doc).querySelector('.mdl-next'));
  await settle();
  assert.equal(asked(), before, 'the kept list, not a second request');
  assert.equal(doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]').checked, true, 'with its tick');
});
