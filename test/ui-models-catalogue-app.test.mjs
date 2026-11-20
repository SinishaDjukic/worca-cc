// test/ui-models-catalogue-app.test.mjs — the Catalogue tab wired into the booted app (models-menu P4, Task 6): the tab
// count, the side panel (open, close, Escape, deep link, leaving the tab), the toolbar (search, Show all), the group
// menu (Default for new runs), the hide switch per harness, the sub-group fixes, the panel's actions (Test, Edit,
// Delete, Used by) and the reads (a project's /api/models, a settings-changed frame). Stubs route by METHOD and path.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { confirmDialog, dialogText } from './helpers/confirm-modal.mjs';
import { pressEscape } from './helpers/popups.mjs';
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

/** GET /api/models as the server sends it: the fixture's rows without the page's own facts, `providers` as the
 *  server's list of names (app.js replaces it with the GET /api/providers payload), and two uses of my-copilot-gpt. */
function modelsBody(extra = {}) {
  const { legacy, projectName, providers, engines, runEngine, engineLocks, justImported, ...rows } = data();
  return {
    ...rows,
    efforts: ['low', 'medium', 'high'],
    providers: ['copilot', 'openai', 'anthropic'],
    uses: { 'my-copilot-gpt': [{ kind: 'role', engine: 'claude', key: 'planner', label: 'Planner' }, { kind: 'step', engine: 'claude', key: 'review', label: 'Review' }] },
    ...extra,
  };
}

const ok = (body) => ({ status: 200, body });

/** `arms`: [method, path, body | () => ({ status, body })], tried in order before the defaults (a path matches by
 *  prefix, so the more specific arms come first). Every call is "<METHOD> <url>"; POST bodies are parsed. */
async function boot({ hash = '', arms = [], settings = {}, projects = [], config = { steps: {}, customModels: [] } } = {}) {
  const dom = trackDom(new JSDOM(html, { url: `http://localhost:4317/${hash ? `#${hash}` : ''}` }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.addEventListener('error', (e) => pageErrors.push(String(e.error?.stack || e.message)));
  const calls = [];
  const posts = [];
  const all = [
    ...arms,
    ['GET', '/api/models/my-copilot-gpt/refs', ok({ predefinedShadow: false, steps: [], nodes: [], jobs: [{}, {}] })],
    ['DELETE', '/api/models/my-copilot-gpt', ok({ ok: true, clearedJobs: 2 })],
    ['GET', '/api/models', () => ok(modelsBody())],
    ['GET', '/api/providers', ok({})],
    ['POST', '/api/settings', (body) => ok({ ...settings, ...body })],
    ['GET', '/api/settings', () => ok(settings)],
    ['GET', '/api/engines', ok({ engines: ENGINE_NAMES.map((name) => ({ name, label: name, ready: true })) })],
    ['GET', '/api/projects', ok({ projects })],
  ];
  window.fetch = (url, opts = {}) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = opts.method || 'GET';
    calls.push(`${method} ${u}`);
    let body = null;
    if (method === 'POST' && typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch { body = opts.body; } }
    if (method === 'POST') posts.push({ url: u, body });
    const answer = ({ status = 200, body: b = {} }) => Promise.resolve({ ok: status < 400, status, json: async () => b });
    for (const [m, path, r] of all) {
      if (m === method && u.startsWith(path)) return answer(typeof r === 'function' ? r(body) : r);
    }
    return answer(ok({ config, models: [], efforts: [] }));
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
  return { window, doc: window.document, calls, posts };
}

async function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
}

const press = (window, node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const row = (doc, id, engine = 'claude') => [...doc.querySelectorAll(`#models-list .mdl-grp[data-engine="${engine}"] .mdl-row[data-id]`)].find((n) => n.dataset.id === id) || null;
const group = (doc, engine) => doc.querySelector(`#models-list .mdl-grp[data-engine="${engine}"]`);
const toggle = (doc, engine) => group(doc, engine).querySelector('.mdl-grp-toggle');
const side = (doc) => doc.querySelector('#model-panel-host .mdl-side');
const pill = (doc) => doc.querySelector('#models-tabs-host .mdl-tab-count');
const reads = (calls) => calls.filter((c) => c === 'GET /api/models' || c.startsWith('GET /api/models?')).length;
const menuItem = (doc, label) => [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((b) => b.querySelector('.wfv-menu-l').textContent === label);
const clearToasts = (doc) => doc.getElementById('toasts').replaceChildren();

test('1: the tab count is the listed models, also after Jobs and back', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  // 10 distinct ids without a project: 2 Claude, 2 Codex and 1 Copilot built-in, 3 of yours, 1 plugin, 1 team.
  assert.equal(pill(doc).hidden, false);
  assert.equal(pill(doc).textContent, '10');
  assert.equal(doc.querySelector('#models-list .mv-filters .filter-chip[data-filter="all"] .n').textContent, '10');
  await go(window, 'models/jobs');
  assert.equal(pill(doc).textContent, '10', 'a tab switch keeps the count');
  await go(window, 'models');
  assert.equal(pill(doc).textContent, '10');
});

test('2: a row opens the panel; the same row or Escape closes it', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'my-copilot-gpt'));
  assert.equal(side(doc)?.getAttribute('aria-label'), 'My Copilot GPT');
  assert.ok(row(doc, 'my-copilot-gpt').classList.contains('mdl-sel'));
  press(window, row(doc, 'my-copilot-gpt'));
  assert.equal(side(doc), null, 'the same row again closes it');
  assert.equal(row(doc, 'my-copilot-gpt').classList.contains('mdl-sel'), false);
  press(window, row(doc, 'my-copilot-gpt'));
  assert.ok(side(doc));
  pressEscape(window);
  assert.equal(side(doc), null, 'Escape closes the panel');
  assert.equal(doc.activeElement, row(doc, 'my-copilot-gpt'), 'the focus is on the row the panel showed');
  press(window, row(doc, 'my-copilot-gpt'));
  press(window, doc.querySelector('#model-panel-host .mdl-side-close'));
  assert.equal(side(doc), null, 'Close closes it');
});

test('2b: a model on two harnesses is marked in both groups, counted once', async () => {
  const gw = { id: 'gw-gpt', label: 'GW GPT', efforts: ['medium'], testable: true, upstream: { provider: 'openai', api: 'openai-responses', model: 'gpt-6', baseUrl: 'https://gw.example/v1' } };
  const body = modelsBody();
  const { window, doc } = await boot({ hash: 'models', arms: [['GET', '/api/models', ok({ ...body, models: [...body.models, gw] })]] });
  assert.equal(pill(doc).textContent, '11');
  press(window, toggle(doc, 'codex'));
  press(window, row(doc, 'gw-gpt', 'claude'));
  assert.equal(side(doc)?.getAttribute('aria-label'), 'GW GPT');
  assert.ok(row(doc, 'gw-gpt', 'claude').classList.contains('mdl-sel'));
  assert.ok(row(doc, 'gw-gpt', 'codex').classList.contains('mdl-sel'));
});

test('3: Escape with a menu open closes only the menu', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'my-copilot-gpt'));
  press(window, group(doc, 'codex').querySelector('.mdl-grp-more'));
  assert.ok(doc.querySelector('.wfv-menu'), 'the group menu is open');
  assert.ok(doc.activeElement.closest('.wfv-menu'), 'its item took the focus');
  pressEscape(window, doc.activeElement);
  assert.equal(doc.querySelector('.wfv-menu'), null, 'the menu closed');
  assert.ok(side(doc), 'the panel is still open');
});

test('4: search keeps focus and caret; Show all clears', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  const source = doc.querySelector('#models-list .mdl-source');
  source.value = 'plugin';
  source.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('#models-list .mdl-source').value, 'plugin');
  assert.equal(row(doc, 'gw-claude'), null, 'Source narrows the list');
  const search = doc.querySelector('#models-list .mv-search');
  search.focus();
  search.value = 'zz';
  search.setSelectionRange(1, 1);   // typed in the middle: a redrawn field would put the caret at the end
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  const again = doc.querySelector('#models-list .mv-search');
  assert.equal(doc.activeElement, again, 'the redrawn field has the focus');
  assert.equal(again.value, 'zz');
  assert.equal(again.selectionStart, 1);
  press(window, doc.querySelector('#models-list .mdl-show-all'));
  assert.equal(doc.querySelector('#models-list .mv-search').value, '');
  assert.equal(doc.querySelector('#models-list .mdl-source').value, 'any');
  assert.ok(row(doc, 'gw-claude'), 'every row is back');
});

test('5: hide Codex built-ins: the setting, the toast, a fresh read; an open Codex built-in closes', async () => {
  const { window, doc, calls, posts } = await boot({ hash: 'models' });
  press(window, toggle(doc, 'codex'));
  press(window, row(doc, 'gpt-6.1-sol', 'codex'));
  assert.ok(side(doc));
  clearToasts(doc);
  const before = reads(calls);
  const cb = group(doc, 'codex').querySelector('.mv-hide-builtin[data-engine="codex"]');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(12);
  assert.deepEqual(posts.filter((p) => p.url === '/api/settings').map((p) => p.body), [{ hideBuiltinEngines: { codex: true } }]);
  assert.match(lastToast(doc).title, /^OpenAI Codex's built-in models hidden from every picker\. Runs that already use one keep working\.$/);
  assert.ok(reads(calls) > before, '/api/models was read again');
  assert.equal(side(doc), null, 'the panel showing a Codex built-in closed');
  // Claude's switch keeps its own setting.
  const claudeCb = group(doc, 'claude').querySelector('.mv-hide-builtin[data-engine="claude"]');
  clearToasts(doc);
  posts.length = 0;
  claudeCb.checked = true;
  claudeCb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(12);
  assert.deepEqual(posts.filter((p) => p.url === '/api/settings').map((p) => p.body), [{ hideBuiltinModels: true }]);
  assert.equal(lastToast(doc).title, "Claude Code's built-in models hidden from every picker. Runs that already use one keep working.");
});

test('6: Default for new runs from the group menu', async () => {
  const { window, doc, posts } = await boot({ hash: 'models' });
  clearToasts(doc);
  press(window, group(doc, 'codex').querySelector('.mdl-grp-more'));
  const item = menuItem(doc, 'Default for new runs');
  assert.equal(item.disabled, false);
  press(window, item);
  await settle();
  assert.deepEqual(posts.filter((p) => p.url === '/api/settings').map((p) => p.body), [{ runEngine: 'codex' }]);
  assert.equal(lastToast(doc).title, 'OpenAI Codex is the default for new runs');
  const defaults = (engine) => [...toggle(doc, engine).querySelectorAll('.badge.slate')].map((b) => b.textContent);
  assert.deepEqual(defaults('codex'), ['Default']);
  assert.deepEqual(defaults('claude'), []);
});

test('7: Set key goes to the provider row; Copilot opens the setup assistant', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, doc.querySelector('#models-list .mdl-fix[data-row="openrouter"]'));
  await settle();
  assert.equal(window.location.hash, '#models/providers/openrouter');
  await go(window, 'models');
  press(window, doc.querySelector('#models-list .mdl-fix[data-row="copilot"]'));
  await settle();
  const modal = doc.getElementById('setup-modal');
  assert.ok(modal, 'the setup assistant is up');
  assert.equal(modal.hidden || modal.classList.contains('hidden'), false);
  assert.equal(window.location.hash, '#models');
});

test('8: delete from the panel', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'my-copilot-gpt'));
  clearToasts(doc);
  press(window, doc.querySelector('#model-panel-host .mdl-act-more'));
  press(window, menuItem(doc, 'Delete'));
  await settle();
  assert.equal(dialogText(window).message, 'Delete model "my-copilot-gpt"? This also clears 2 jobs that use it.');
  await confirmDialog(window);
  await settle(12);
  assert.equal(lastToast(doc).title, 'Deleted.');
  assert.equal(side(doc), null, 'the panel closed, though the reload still lists the model');
  assert.ok(row(doc, 'my-copilot-gpt'));
});

test('9: Edit opens the editor', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'gw-claude'));
  press(window, doc.querySelector('#model-panel-host .mdl-act[data-act="edit"]'));
  await settle(2);
  assert.equal(doc.getElementById('model-editor-modal').classList.contains('hidden'), false);
  assert.equal(doc.querySelector('#mv-editor-host .mv-editor').dataset.id, 'gw-claude');
});

test('9b: Test writes into the panel; a use opens its block on the Jobs tab', async () => {
  const { window, doc } = await boot({ hash: 'models', arms: [['POST', '/api/models/gw-claude/test', ok({ ok: true, text: 'pong' })]] });
  press(window, row(doc, 'gw-claude'));
  const btn = doc.querySelector('#model-panel-host .mdl-act[data-act="test"]');
  assert.equal(btn.disabled, false);
  press(window, btn);
  // PAN-3: the button itself reads "Testing…" with the spinner, then "Works"; the line under it holds the answer.
  assert.equal(btn.textContent, 'Testing…');
  assert.ok(btn.querySelector('.btn-spin') && btn.classList.contains('is-busy'), 'the spinner shows while it runs');
  assert.equal(doc.querySelector('#model-panel-host .mdl-test-result').textContent, '');
  await settle();
  assert.equal(btn.textContent, 'Works');
  assert.ok(btn.classList.contains('is-done') && !btn.querySelector('.btn-spin'));
  assert.equal(doc.querySelector('#model-panel-host .mdl-test-result').textContent, 'Replied: pong');
  assert.equal(btn.disabled, false);
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(btn.textContent, 'Test', 'back to Test after the done beat');
  assert.ok(!btn.classList.contains('is-done'));
  press(window, row(doc, 'my-copilot-gpt'));
  press(window, doc.querySelector('#model-panel-host .mdl-use'));
  await settle();
  // my-copilot-gpt's first use is a role (Planner on Claude Code): the Roles block.
  assert.equal(window.location.hash, '#models/jobs/roles');
});

test('10: #models/model/<id> opens it, also a built-in, with filters cleared', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  const search = doc.querySelector('#models-list .mv-search');
  search.value = 'zzz';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await go(window, 'models/model/gpt-6.1-sol');
  assert.equal(doc.querySelector('#models-list .mv-search').value, '');
  assert.equal(side(doc)?.getAttribute('aria-label'), 'GPT-6.1 Sol');
  assert.equal(toggle(doc, 'codex').getAttribute('aria-expanded'), 'true');
  assert.ok(row(doc, 'gpt-6.1-sol', 'codex').classList.contains('is-found'));

  const fresh = await boot({ hash: 'models/model/gpt-6.1-sol' });
  assert.equal(side(fresh.doc)?.getAttribute('aria-label'), 'GPT-6.1 Sol', 'a fresh load opens the panel too');
  assert.equal(toggle(fresh.doc, 'codex').getAttribute('aria-expanded'), 'true');
  assert.ok(row(fresh.doc, 'gpt-6.1-sol', 'codex').classList.contains('mdl-sel'));
});

test('11: leaving the tab closes the panel; so does leaving the page', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'gw-claude'));
  assert.ok(side(doc));
  await go(window, 'models/jobs');
  await go(window, 'models');
  assert.equal(doc.getElementById('model-panel-host').childElementCount, 0);
  assert.equal(doc.querySelector('#models-list .mdl-row.mdl-sel'), null);
  press(window, row(doc, 'gw-claude'));
  await go(window, 'settings');
  await go(window, 'models');
  assert.equal(doc.getElementById('model-panel-host').childElementCount, 0);
  assert.equal(doc.querySelector('#models-list .mdl-row.mdl-sel'), null);
});

test('12: a selected project reaches /api/models, and its own models are listed', async () => {
  const { window, doc, calls } = await boot({
    projects: [{ name: 'proj-a', path: '/tmp/proj-a', exists: true }],
    config: { steps: {}, customModels: [{ id: 'old-project-model', label: 'Old project model' }] },
  });
  await go(window, 'models');
  assert.ok(calls.includes('GET /api/models?projectDir=%2Ftmp%2Fproj-a'), calls.filter((c) => c.includes('/api/models')).join(', '));
  const legacy = row(doc, 'old-project-model');
  assert.ok(legacy, 'the project model is listed');
  assert.equal(legacy.querySelector('.badge.slate').textContent, 'Project');
  assert.equal(pill(doc).textContent, '11');
});

test('13: the old list is gone', async () => {
  const mod = await import('../ui/public/models-view.mjs');
  assert.equal('renderModelsList' in mod, false);
});

test('14: a settings-changed frame re-reads the catalogue; the default harness carries "Default"', async () => {
  const { calls } = await boot({ hash: 'models' });
  const before = reads(calls);
  WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'settings-changed' }) }));
  await settle();
  assert.equal(reads(calls), before + 1);

  const codex = await boot({ hash: 'models', settings: { runEngine: 'codex' } });
  const chips = (engine) => [...toggle(codex.doc, engine).querySelectorAll('.badge.slate')].map((b) => b.textContent);
  assert.deepEqual(chips('codex'), ['Default']);
  assert.deepEqual(chips('claude'), []);
});

test('15: what the page cannot know it does not claim: no engines, no "Not ready"; no Providers payload, no provider state', async () => {
  const { doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/engines', { status: 500, body: { error: 'boom' } }],
    ['GET', '/api/providers', { status: 500, body: { error: 'boom' } }],
  ] });
  assert.ok(group(doc, 'claude'), 'the catalogue drew');
  assert.equal(doc.querySelector('#models-list .mdl-grp-toggle .mdl-st'), null, 'no harness state');
  assert.equal(doc.querySelector('#models-list .mdl-fix'), null, 'no provider fix');
  assert.equal(doc.querySelector('#models-list .mdl-sub-h .mdl-st'), null, 'no provider state');

  const known = await boot({ hash: 'models' });
  assert.equal(toggle(known.doc, 'claude').querySelector('.mdl-st').textContent, 'Ready');
  assert.ok(known.doc.querySelector('#models-list .mdl-fix[data-row="copilot"]'), 'the Providers payload replaces the name list');
});

test('16: an open model the next read no longer lists closes its panel', async () => {
  let body = modelsBody();
  const { window, doc } = await boot({ hash: 'models', arms: [['GET', '/api/models', () => ok(body)]] });
  press(window, row(doc, 'gw-claude'));
  assert.ok(side(doc));
  body = { ...body, models: body.models.filter((m) => m.id !== 'gw-claude') };
  WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'settings-changed' }) }));
  await settle();
  assert.equal(row(doc, 'gw-claude'), null);
  assert.equal(side(doc), null);
  assert.equal(doc.getElementById('model-panel-host').childElementCount, 0);
  // Closed for good: the model coming back in a later read does not reopen it.
  body = modelsBody();
  WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'settings-changed' }) }));
  await settle();
  assert.ok(row(doc, 'gw-claude'));
  assert.equal(side(doc), null);
});

// Review cycle 1 (M-1, M-2, M-4): a repaint nobody asked for (the engines cache, another tab's settings-changed, a
// window focus) keeps the keyboard and a running Test; each of the Escape arm's bails and the Default refusal holds.
const ENGINES_BODY = { engines: ENGINE_NAMES.map((name) => ({ name, label: name, ready: true })) };
const frame = (type) => WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify({ type }) }));
const defaults = (doc, engine) => [...toggle(doc, engine).querySelectorAll('.badge.slate')].map((b) => b.textContent);

test('3b: Escape on a group\'s More while its menu is open leaves the menu and the panel (Claude Code\'s one item is off, so the focus stays on More)', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'my-copilot-gpt'));
  const more = group(doc, 'claude').querySelector('.mdl-grp-more');
  more.focus();
  press(window, more);
  assert.ok(doc.querySelector('.wfv-menu'), 'the group menu is open');
  assert.equal(doc.activeElement, more, 'its only item is off: the focus stays on More');
  pressEscape(window, doc.activeElement);
  assert.ok(doc.querySelector('.wfv-menu'), 'the menu is still open');
  assert.ok(side(doc), 'the panel is still open: an open menu closes first');
});

test('4b: the engines answer landing while you type keeps the focus and the caret in the search', async () => {
  let hold = false;
  let release;
  const held = new Promise((r) => { release = r; });
  const { window, doc } = await boot({ hash: 'models', arms: [['GET', '/api/engines', () => (hold ? { status: 200, body: held } : ok(ENGINES_BODY))]] });
  hold = true;
  const realNow = Date.now;
  const t0 = realNow();
  Date.now = () => t0 + 61_000;   // the 60 s engines cache is stale: the next draw reads /api/engines again
  try {
    const search = doc.querySelector('#models-list .mv-search');
    search.focus();
    search.value = 'gw';
    search.setSelectionRange(1, 1);
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    const typed = doc.querySelector('#models-list .mv-search');
    assert.equal(doc.activeElement, typed);
    release(ENGINES_BODY);
    await settle();
    const now = doc.querySelector('#models-list .mv-search');
    assert.notEqual(now, typed, 'the engines answer drew the list anew');
    assert.equal(doc.activeElement, now, 'the focus is still in the search');
    assert.equal(now.value, 'gw');
    assert.deepEqual([now.selectionStart, now.selectionEnd], [1, 1], 'and the caret where it was');
  } finally {
    Date.now = realNow;
  }
});

test('4c: a settings-changed repaint keeps the focus on the row, the chip, the group toggle, the Source and the panel button that had it', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'gw-claude'));
  const cases = [
    () => doc.querySelector('#model-panel-host .mdl-act[data-act="edit"]'),
    () => doc.querySelector('#model-panel-host .mdl-side-close'),
    () => row(doc, 'gw-claude'),
    () => doc.querySelector('#models-list .mv-filters .filter-chip[data-filter="used"]'),
    () => toggle(doc, 'codex'),
    () => doc.querySelector('#models-list .mdl-source'),
  ];
  for (const find of cases) {
    const before = find();
    before.focus();
    frame('settings-changed');
    await settle();
    const after = find();
    assert.notEqual(after, before, 'drawn anew');
    assert.equal(doc.activeElement, after, after.className);
  }
});

test('5b: the hide switch keeps the keyboard through its own refresh', async () => {
  let hidden = { claude: false, codex: false, copilot: false };
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/models', () => ok(modelsBody({ hiddenBuiltins: hidden }))],
    ['POST', '/api/settings', (body) => { hidden = { ...hidden, ...(body.hideBuiltinEngines || {}) }; return ok(body); }],
  ] });
  press(window, toggle(doc, 'codex'));
  const cb = group(doc, 'codex').querySelector('.mv-hide-builtin[data-engine="codex"]');
  cb.focus();
  cb.click();
  // A browser's focus fixup drops the focus of a control that turns disabled (the switch is, while it saves); jsdom keeps
  // it, and its blur() skips a disabled control, so do what the browser does.
  cb.disabled = false;
  cb.blur();
  cb.disabled = true;
  assert.equal(doc.activeElement, doc.body);
  await settle(12);
  const now = group(doc, 'codex').querySelector('.mv-hide-builtin[data-engine="codex"]');
  assert.notEqual(now, cb, 'the refresh drew the switch anew');
  assert.equal(doc.activeElement, now, 'the keyboard is on the switch again');
  assert.equal(now.checked, true);
  assert.equal(now.disabled, false);
});

test('6b: a refused Default for new runs says why and moves nothing', async () => {
  const { window, doc } = await boot({ hash: 'models', arms: [['POST', '/api/settings', { status: 400, body: { error: 'That harness is off here' } }]] });
  clearToasts(doc);
  press(window, group(doc, 'codex').querySelector('.mdl-grp-more'));
  press(window, menuItem(doc, 'Default for new runs'));
  await settle();
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['err', 'That harness is off here']);
  assert.deepEqual(defaults(doc, 'claude'), ['Default']);
  assert.deepEqual(defaults(doc, 'codex'), []);
});

test('9c: Escape with the editor open over the panel closes the editor only', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'gw-claude'));
  press(window, doc.querySelector('#model-panel-host .mdl-act[data-act="edit"]'));
  await settle(2);
  const modal = doc.getElementById('model-editor-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  pressEscape(window, doc.activeElement);
  assert.equal(modal.classList.contains('hidden'), true, 'the editor closed');
  assert.ok(side(doc), 'the panel is still open');
});

test('9d: a repaint while a Test runs keeps "Testing…" and Test off; the answer lands in the panel on screen', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { window, doc, posts } = await boot({ hash: 'models', arms: [['POST', '/api/models/gw-claude/test', { status: 200, body: held }]] });
  press(window, row(doc, 'gw-claude'));
  press(window, doc.querySelector('#model-panel-host .mdl-act[data-act="test"]'));
  const first = side(doc);
  frame('settings-changed');
  await settle();
  assert.notEqual(side(doc), first, 'the panel was drawn anew');
  const btn = () => doc.querySelector('#model-panel-host .mdl-act[data-act="test"]');
  const out = () => doc.querySelector('#model-panel-host .mdl-test-result');
  assert.equal(btn().disabled, true, 'Test stays off while it runs');
  assert.equal(btn().textContent, 'Testing…', 'the button drawn anew reads Testing… too');
  assert.ok(btn().querySelector('.btn-spin'));
  btn().dispatchEvent(new window.Event('click', { bubbles: true }));   // a plain Event reaches a disabled button too
  assert.equal(posts.filter((p) => p.url === '/api/models/gw-claude/test').length, 1, 'one test at a time');
  release({ ok: true, text: 'pong' });
  await settle();
  assert.equal(out().textContent, 'Replied: pong');
  assert.equal(btn().disabled, false);
  frame('settings-changed');
  await settle();
  assert.equal(out().textContent, 'Replied: pong', 'a later repaint keeps the answer while the panel shows it');
  press(window, row(doc, 'my-copilot-gpt'));
  assert.equal(side(doc).getAttribute('aria-label'), 'My Copilot GPT');
  press(window, row(doc, 'gw-claude'));
  assert.equal(out().textContent, '', 'a panel opened again starts clean');
});

test('9e: an answer that lands after the panel moved to another model stays out of it', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { window, doc } = await boot({ hash: 'models', arms: [['POST', '/api/models/gw-claude/test', { status: 200, body: held }]] });
  press(window, row(doc, 'gw-claude'));
  press(window, doc.querySelector('#model-panel-host .mdl-act[data-act="test"]'));
  press(window, row(doc, 'team-glm'));
  assert.ok(row(doc, 'team-glm').classList.contains('mdl-sel'), 'the panel shows another model now');
  release({ ok: true, text: 'pong' });
  await settle();
  assert.equal(doc.querySelector('#model-panel-host .mdl-test-result')?.textContent ?? '', '');
});

test('14b: a settings read naming another default moves "Default" by itself, with no catalogue read', async () => {
  let runEngine = null;
  let modelsUp = true;
  const { doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/models', () => (modelsUp ? ok(modelsBody()) : { status: 500, body: { error: 'down' } })],
    ['GET', '/api/settings', () => ok(runEngine ? { runEngine } : {})],
  ] });
  assert.deepEqual(defaults(doc, 'claude'), ['Default']);
  modelsUp = false;
  runEngine = 'codex';
  frame('settings-changed');
  await settle();
  assert.deepEqual(defaults(doc, 'codex'), ['Default']);
  assert.deepEqual(defaults(doc, 'claude'), []);
});

test('8b: a delete whose job clear failed says so; a failed refs read claims no count', async () => {
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/models/gw-claude/refs', { status: 500, body: { error: 'boom' } }],
    ['DELETE', '/api/models/gw-claude', ok({ ok: true, clearedJobs: 0, warning: 'Deleted, but the jobs that use it could not be cleared: disk full' })],
  ] });
  press(window, row(doc, 'gw-claude'));
  clearToasts(doc);
  press(window, doc.querySelector('#model-panel-host .mdl-act-more'));
  press(window, menuItem(doc, 'Delete'));
  await settle();
  assert.equal(dialogText(window).message, 'Delete model "gw-claude"? Jobs that use it will be cleared.');
  await confirmDialog(window);
  await settle(12);
  assert.deepEqual([lastToast(doc).tone, lastToast(doc).title], ['warn', 'Deleted, but the jobs that use it could not be cleared: disk full']);
  assert.equal(side(doc), null);
});

test('2c: Escape typed in the search is the field\'s (it clears it), not the panel\'s', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'gw-claude'));
  const search = doc.querySelector('#models-list .mv-search');
  search.focus();
  const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  search.dispatchEvent(ev);
  assert.ok(side(doc), 'the panel stays open');
  assert.equal(ev.defaultPrevented, false, 'the browser still clears the field');
  assert.equal(doc.activeElement, search);
  const sw = group(doc, 'claude').querySelector('.mv-hide-builtin[data-engine="claude"]');
  sw.focus();
  pressEscape(window, sw);
  assert.equal(side(doc), null, 'a switch is no text field: Escape there closes the panel');
});

// Review cycle 2 (MJ-1, minor 1, minor 2): the fix's own guards. A running Test stays held in a panel opened again, and
// its answer stays out of a panel opened after it landed; a Test drawn off stays off; the hide switch never takes the
// keyboard back from a control the user moved to; a repaint keeps the focus on the second of two look-alike controls.
const testBtn = (doc) => doc.querySelector('#model-panel-host .mdl-act[data-act="test"]');
const testOut = (doc) => doc.querySelector('#model-panel-host .mdl-test-result');

test('9f: a panel opened again while its Test runs keeps Test off and "Testing…" until the answer lands', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { window, doc, posts } = await boot({ hash: 'models', arms: [['POST', '/api/models/gw-claude/test', { status: 200, body: held }]] });
  press(window, row(doc, 'gw-claude'));
  press(window, testBtn(doc));
  press(window, row(doc, 'my-copilot-gpt'));
  assert.equal(side(doc).getAttribute('aria-label'), 'My Copilot GPT');
  press(window, row(doc, 'gw-claude'));
  assert.equal(side(doc).getAttribute('aria-label'), 'GW Claude');
  assert.equal(testBtn(doc).disabled, true, 'Test stays off while it runs');
  assert.equal(testBtn(doc).textContent, 'Testing…', 'the button drawn anew reads Testing… too');
  testBtn(doc).dispatchEvent(new window.Event('click', { bubbles: true }));   // a plain Event reaches a disabled button too
  assert.equal(posts.filter((p) => p.url === '/api/models/gw-claude/test').length, 1, 'one test at a time');
  release({ ok: true, text: 'pong' });
  await settle();
  assert.equal(testOut(doc).textContent, 'Replied: pong');
  assert.equal(testBtn(doc).disabled, false);
});

test('9g: an answer that landed while another panel showed stays out of the panel opened again', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { window, doc } = await boot({ hash: 'models', arms: [['POST', '/api/models/gw-claude/test', { status: 200, body: held }]] });
  press(window, row(doc, 'gw-claude'));
  press(window, testBtn(doc));
  press(window, row(doc, 'my-copilot-gpt'));
  release({ ok: true, text: 'pong' });
  await settle();
  press(window, row(doc, 'gw-claude'));
  assert.equal(side(doc).getAttribute('aria-label'), 'GW Claude');
  assert.equal(testOut(doc).textContent, '', 'a panel opened again starts clean');
  assert.equal(testBtn(doc).disabled, false);
});

test('9h: a Test a re-read draws off ("Needs setup first") while it runs stays off when the answer lands', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  let signIn = false;
  const body = () => {
    const b = modelsBody();
    return { ...b, models: b.models.map((m) => (m.id === 'gw-claude' && signIn ? { ...m, needsSignIn: true } : m)) };
  };
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['POST', '/api/models/gw-claude/test', { status: 200, body: held }],
    ['GET', '/api/models', () => ok(body())],
  ] });
  press(window, row(doc, 'gw-claude'));
  press(window, testBtn(doc));
  signIn = true;
  frame('settings-changed');
  await settle();
  assert.equal(testBtn(doc).disabled, true);
  assert.equal(testBtn(doc).title, 'Needs setup first', 'drawn off by the re-read');
  release({ ok: true, text: 'pong' });
  await settle();
  assert.equal(testOut(doc).textContent, 'Replied: pong');
  assert.equal(testBtn(doc).disabled, true, 'the answer does not turn on a Test drawn off');
});

test('4d: a repaint keeps the focus on the second of two look-alike Used by rows', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  press(window, row(doc, 'my-copilot-gpt'));
  const uses = () => [...doc.querySelectorAll('#model-panel-host .mdl-use')];
  assert.equal(uses().length, 2);
  assert.deepEqual(uses().map((b) => b.dataset.engine), ['claude', 'claude'], 'twins: the same harness');
  const before = uses()[1];
  before.focus();
  frame('settings-changed');
  await settle();
  assert.notEqual(uses()[1], before, 'drawn anew');
  assert.equal(doc.activeElement, uses()[1], doc.activeElement.textContent);
});

test('5c: the hide switch never takes the keyboard back from a control you moved to while it saved', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  let hidden = { claude: false, codex: false, copilot: false };
  const { window, doc } = await boot({ hash: 'models', arms: [
    ['GET', '/api/models', () => ok(modelsBody({ hiddenBuiltins: hidden }))],
    ['POST', '/api/settings', (b) => ({ status: 200, body: held.then(() => { hidden = { ...hidden, ...(b.hideBuiltinEngines || {}) }; return b; }) })],
  ] });
  press(window, toggle(doc, 'codex'));
  const cb = group(doc, 'codex').querySelector('.mv-hide-builtin[data-engine="codex"]');
  cb.focus();
  cb.click();
  assert.equal(cb.disabled, true, 'the save is out');
  doc.querySelector('#models-list .mv-search').focus();
  release();
  await settle(12);
  const search = doc.querySelector('#models-list .mv-search');
  assert.equal(group(doc, 'codex').querySelector('.mv-hide-builtin[data-engine="codex"]').checked, true, 'the refresh drew the saved switch');
  assert.equal(doc.activeElement, search, 'the keyboard stays in the search');
});

test('an always-shown harness\'s Add-model call to action opens Add model on it', async () => {
  const { window, doc } = await boot({ hash: 'models' });
  const oc = group(doc, 'opencode');
  assert.ok(oc, 'the OpenCode group is listed with no OpenCode models');
  assert.equal(oc.querySelector('.mdl-grp-toggle').getAttribute('aria-expanded'), 'false', 'folded like the other harnesses');
  press(window, toggle(doc, 'opencode'));
  const add = doc.querySelector('#models-list .mdl-grp[data-engine="opencode"] .mdl-empty-add');
  assert.ok(add, 'the empty group\'s body holds the Add-model call to action');
  assert.equal(add.textContent, 'Add OpenCode model');
  press(window, add);
  await settle();
  const modal = doc.querySelector('#model-editor-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'Add model opened');
  const picked = modal.querySelector('.mdl-hx-t[aria-pressed="true"]');
  assert.ok(picked, 'a harness is picked');
  assert.equal(picked.dataset.engine, 'opencode', 'the harness that had no models is the pick');
});
