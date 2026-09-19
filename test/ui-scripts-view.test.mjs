// test/ui-scripts-view.test.mjs — the Scripts page's list half (scripts-workbench §5.1):
// the pure renderers, the controller against a fake api, and one booted-app pass for
// the rail entry, the route and the no-prose rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  scriptRoute, parseScriptsParam, originLabel, portLineOf, buildScriptCard,
  renderScriptsList, createScriptsController, SCRIPT_TABS,
} from '../ui/public/scripts-view.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const doc = new JSDOM('<!doctype html><body></body>').window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));

const RUNTIMES = { node: { ok: true, version: '22.13.0' }, shell: { ok: true, path: '/bin/sh' },
  python: { ok: false, reason: 'no python 3.8 or newer found (tried python3, python)' } };
const SCRIPTS = [
  { key: 'shell', displayName: 'Shell', description: 'Runs a command.', origin: 'builtin', runtime: 'shell', order: 10,
    ports: 'config', params: [{ id: 'command', type: 'command', required: true }], portSummary: '', caseCount: 0 },
  { key: 'runTests', displayName: 'Run tests', description: 'Runs the suite.', origin: 'user', runtime: 'node', order: 20,
    inputs: [{ id: 'done', type: 'void' }], outputs: [{ id: 'log', type: 'md' }], params: [],
    portSummary: 'Reads done; produces log.', caseCount: 3 },
  { key: 'tidy', displayName: 'Tidy', description: '', origin: 'plugin:tools', runtime: 'python', order: 30,
    inputs: [], outputs: [], params: [], portSummary: '', caseCount: 1 },
];
const ok = (data) => ({ ok: true, status: 200, data });
function fakeApi(over = {}) {
  const calls = [];
  const api = {
    calls,
    list: async () => { calls.push(['list']); return ok({ scripts: SCRIPTS }); },
    read: async (k) => { calls.push(['read', k]); return ok({ meta: SCRIPTS.find((s) => s.key === k), source: '', cases: [], userCases: [] }); },
    create: async (b) => { calls.push(['create', b]); return ok({ meta: b.meta }); },
    update: async (k, b) => { calls.push(['update', k, b]); return ok({ meta: b.meta, warnings: [] }); },
    remove: async (k) => { calls.push(['remove', k]); return ok({ ok: true }); },
    duplicate: async (k, n) => { calls.push(['duplicate', k, n]); return ok({ meta: { key: n } }); },
    writeCases: async (k, c) => { calls.push(['writeCases', k, c]); return ok({ cases: c }); },
    runtimes: async () => { calls.push(['runtimes']); return ok(RUNTIMES); },
    bench: async (r) => { calls.push(['bench', r]); return ok({ benchId: 'bench_1' }); },
    benchStop: async (id) => { calls.push(['benchStop', id]); return ok({ ok: true }); },
    benchOutput: (id, port, caseId = null) => `/api/scripts/bench/${id}/output/${port}${caseId ? `?caseId=${caseId}` : ''}`,
    history: async () => ok({ pipelines: [] }),
    runArtifacts: async () => ok({ artifacts: [] }),
    runArtifact: async () => ok({ rel: '', text: '' }),
    projects: async () => ok({ projects: [] }),
    ...over,
  };
  return api;
}
function mountCtl(over = {}, apiOver = {}) {
  const host = doc.createElement('div');
  const msgEl = doc.createElement('div');
  doc.body.replaceChildren(host, msgEl);   // focus()/activeElement only work on an ATTACHED node
  const nav = [];
  const asked = [];
  const api = fakeApi(apiOver);
  const ctl = createScriptsController({
    host, msgEl, api, doc,
    navigate: (hash) => nav.push(hash),
    confirm: async (opts) => { asked.push(opts); return true; },
    highlight: async (t) => t,
    ws: { send: () => {} },
    ...over,
  });
  return { host, msgEl, nav, asked, api, ctl };
}

test('scriptRoute / parseScriptsParam: Overview is bare, the tab is the second segment', () => {
  assert.deepEqual(SCRIPT_TABS, ['overview', 'source', 'test']);
  assert.equal(scriptRoute(), 'scripts');
  assert.equal(scriptRoute('runTests'), 'scripts/runTests');
  assert.equal(scriptRoute('runTests', 'overview'), 'scripts/runTests');
  assert.equal(scriptRoute('runTests', 'source'), 'scripts/runTests/source');
  assert.equal(scriptRoute('runTests', 'test'), 'scripts/runTests/test');
  assert.equal(scriptRoute('new', 'source'), 'scripts/new/source');
  assert.deepEqual(parseScriptsParam(''), { mode: 'list' });
  assert.deepEqual(parseScriptsParam('new'), { mode: 'new', tab: 'overview' });
  assert.deepEqual(parseScriptsParam('new/source'), { mode: 'new', tab: 'source' });
  assert.deepEqual(parseScriptsParam('runTests'), { mode: 'detail', key: 'runTests', tab: 'overview' });
  assert.deepEqual(parseScriptsParam('runTests/source'), { mode: 'detail', key: 'runTests', tab: 'source' });
  assert.deepEqual(parseScriptsParam('runTests/test'), { mode: 'detail', key: 'runTests', tab: 'test' });
  assert.deepEqual(parseScriptsParam('runTests/bogus'), { mode: 'detail', key: 'runTests', tab: 'overview' });
  assert.deepEqual(parseScriptsParam('runTests/test/extra'), { mode: 'detail', key: 'runTests', tab: 'test' });
});

test('originLabel / portLineOf', () => {
  assert.equal(originLabel('builtin'), 'built-in');
  assert.equal(originLabel('user'), 'user');
  assert.equal(originLabel('plugin:tools'), 'tools');
  assert.equal(originLabel(''), 'built-in');
  assert.equal(portLineOf(SCRIPTS[0]), 'ports per card');
  assert.equal(portLineOf(SCRIPTS[1]), 'Reads done; produces log.');
});

test('buildScriptCard: badges, chips, the port line, the case chip and the three actions', () => {
  const card = buildScriptCard(SCRIPTS[1], { doc, runtimes: RUNTIMES, caseState: new Map() });
  assert.ok(card.classList.contains('card') && card.classList.contains('script-card'));
  assert.equal(card.dataset.scriptKey, 'runTests');
  assert.equal(card.querySelector('.script-name').textContent, 'Run tests');
  assert.equal(card.querySelector('.script-origin').textContent, 'user');
  assert.equal(card.querySelector('.script-runtime').textContent, 'node');
  assert.equal(card.querySelector('.script-desc').textContent, 'Runs the suite.');
  assert.equal(card.querySelector('.script-ports').textContent, 'Reads done; produces log.');
  assert.equal(card.querySelector('.script-cases').textContent, '3 cases');
  assert.equal(card.querySelector('.script-dot').dataset.state, 'none');
  assert.equal(card.querySelector('.script-warn'), null, 'a node script never carries the python chip');
  assert.deepEqual([...card.querySelectorAll('.script-actions button')].map((b) => b.textContent),
    ['Open', 'Duplicate', 'Delete']);
  const builtin = buildScriptCard(SCRIPTS[0], { doc, runtimes: RUNTIMES, caseState: new Map() });
  assert.equal(builtin.querySelector('.script-origin').textContent, 'built-in');
  assert.equal(builtin.querySelector('.script-delete'), null, 'only the user layer can be deleted');
  assert.equal(builtin.querySelector('.script-ports').textContent, 'ports per card');
  assert.equal(builtin.querySelector('.script-cases'), null, 'no cases, no chip');
  const plug = buildScriptCard(SCRIPTS[2], { doc, runtimes: RUNTIMES, caseState: new Map() });
  assert.equal(plug.querySelector('.script-origin').textContent, 'tools');
  assert.equal(plug.querySelector('.script-warn').textContent, 'python not found');
  assert.equal(plug.querySelector('.script-cases').textContent, '1 case');
  const withPython = buildScriptCard(SCRIPTS[2], { doc, runtimes: { ...RUNTIMES, python: { ok: true, version: '3.12.1' } }, caseState: new Map() });
  assert.equal(withPython.querySelector('.script-warn'), null);
});

test('buildScriptCard: the case dot reads this session`s results', () => {
  const dot = (states) => buildScriptCard(SCRIPTS[1], { doc, runtimes: RUNTIMES, caseState: new Map([['runTests', new Map(states)]]) })
    .querySelector('.script-dot').dataset.state;
  assert.equal(dot([]), 'none');
  assert.equal(dot([['a', 'pass'], ['b', 'pass'], ['c', 'pass']]), 'pass');
  assert.equal(dot([['a', 'pass'], ['b', 'fail']]), 'fail');
  assert.equal(dot([['a', 'pass']]), 'ran', 'not every case ran yet');
  assert.equal(dot([['a', 'ran'], ['b', 'ran'], ['c', 'ran']]), 'ran');
});

test('renderScriptsList: the topbar, registry order, and the filter over key/name/runtime/origin', () => {
  const pane = renderScriptsList(SCRIPTS, { doc, runtimes: RUNTIMES });
  assert.equal(pane.querySelector('h1').textContent, 'Scripts');
  assert.equal(pane.querySelector('.script-new').textContent, 'New script');
  assert.equal(pane.querySelector('.script-filter').value, '');
  assert.deepEqual([...pane.querySelectorAll('.script-card')].map((c) => c.dataset.scriptKey), ['shell', 'runTests', 'tidy']);
  const keyed = renderScriptsList(SCRIPTS, { doc, query: 'runt', runtimes: RUNTIMES });
  assert.deepEqual([...keyed.querySelectorAll('.script-card')].map((c) => c.dataset.scriptKey), ['runTests']);
  assert.equal(keyed.querySelector('.script-filter').value, 'runt', 'the box keeps the query across repaints');
  assert.deepEqual([...renderScriptsList(SCRIPTS, { doc, query: 'SHELL', runtimes: RUNTIMES }).querySelectorAll('.script-card')]
    .map((c) => c.dataset.scriptKey), ['shell'], 'runtime match, case-insensitive');
  assert.deepEqual([...renderScriptsList(SCRIPTS, { doc, query: 'tools', runtimes: RUNTIMES }).querySelectorAll('.script-card')]
    .map((c) => c.dataset.scriptKey), ['tidy'], 'the plugin name matches');
  assert.equal(renderScriptsList(SCRIPTS, { doc, query: 'zzz', runtimes: RUNTIMES }).querySelector('.scripts-empty').textContent,
    'No scripts match “zzz”.');
  assert.equal(renderScriptsList([], { doc, runtimes: RUNTIMES }).querySelector('.scripts-empty').textContent, 'No scripts.');
});

test('the renderers add no prose: not one <p> anywhere in the pane', () => {
  const pane = renderScriptsList(SCRIPTS, { doc, runtimes: RUNTIMES });
  assert.equal(pane.querySelectorAll('p').length, 0);
});

test('the controller loads runtimes once, then the list, and paints it', async () => {
  const { host, ctl, api } = mountCtl();
  await ctl.route('');
  assert.deepEqual(api.calls.map((c) => c[0]), ['runtimes', 'list']);
  assert.equal(host.querySelectorAll('.script-card').length, 3);
  await ctl.route('');
  assert.deepEqual(api.calls.map((c) => c[0]), ['runtimes', 'list', 'list'], 'the runtime probe is read once per mount');
  ctl.destroy();
});

test('the controller: typing in the filter repaints without a refetch and keeps the caret', async () => {
  const { host, ctl, api } = mountCtl();
  await ctl.route('');
  const box = host.querySelector('.script-filter');
  box.value = 'run';
  box.focus();
  box.setSelectionRange(3, 3);
  box.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  assert.deepEqual([...host.querySelectorAll('.script-card')].map((c) => c.dataset.scriptKey), ['runTests']);
  assert.deepEqual(api.calls.map((c) => c[0]), ['runtimes', 'list'], 'a filter keystroke costs no request');
  assert.equal(host.ownerDocument.activeElement, host.querySelector('.script-filter'));
  assert.equal(host.querySelector('.script-filter').selectionStart, 3);
  ctl.destroy();
});

test('the controller: New script, Open and Duplicate', async () => {
  const { host, ctl, nav, api, msgEl } = mountCtl();
  await ctl.route('');
  host.querySelector('.script-new').click();
  assert.deepEqual(nav, ['scripts/new']);
  host.querySelector('.script-card[data-script-key="runTests"] .script-open').click();
  assert.deepEqual(nav, ['scripts/new', 'scripts/runTests']);
  host.querySelector('.script-card[data-script-key="shell"] .script-duplicate').click();
  await tick(); await tick();
  assert.deepEqual(api.calls.filter((c) => c[0] === 'duplicate'), [['duplicate', 'shell', 'shellCopy']]);
  assert.equal(msgEl.textContent, 'Duplicated as "shellCopy".');
  ctl.destroy();
});

test('the controller: Duplicate steps past a taken copy key', async () => {
  const taken = [...SCRIPTS, { key: 'shellCopy', displayName: 'Copy', origin: 'user', runtime: 'shell', params: [], portSummary: '', caseCount: 0 }];
  const { host, ctl, api } = mountCtl({}, { list: async () => ok({ scripts: taken }) });
  await ctl.route('');
  host.querySelector('.script-card[data-script-key="shell"] .script-duplicate').click();
  await tick(); await tick();
  assert.deepEqual(api.calls.filter((c) => c[0] === 'duplicate'), [['duplicate', 'shell', 'shellCopy2']]);
  ctl.destroy();
});

test('the controller: Delete asks first, then removes; a REFERENCED 409 shows the server`s sentence', async () => {
  const { host, ctl, asked, api, msgEl } = mountCtl();
  await ctl.route('');
  host.querySelector('.script-card[data-script-key="runTests"] .script-delete').click();
  await tick(); await tick();
  assert.equal(asked[0].title, 'Delete script');
  assert.equal(asked[0].message, 'Delete “Run tests”?');
  assert.equal(asked[0].danger, true);
  assert.deepEqual(api.calls.filter((c) => c[0] === 'remove'), [['remove', 'runTests']]);
  assert.equal(msgEl.textContent, 'Deleted "runTests".');

  const sentence = 'script "runTests" is placed in 2 saved workflows: Ship it, Nightly';
  const blocked = mountCtl({}, { remove: async () => ({ ok: false, status: 409, data: { error: sentence } }) });
  await blocked.ctl.route('');
  blocked.host.querySelector('.script-card[data-script-key="runTests"] .script-delete').click();
  await tick(); await tick(); await tick();
  assert.equal(blocked.asked.length, 2, 'asked, then told');
  assert.deepEqual({ title: blocked.asked[1].title, message: blocked.asked[1].message, confirmLabel: blocked.asked[1].confirmLabel },
    { title: 'Cannot delete script', message: sentence, confirmLabel: 'Close' });
  ctl.destroy(); blocked.ctl.destroy();
});

test('the controller: a cancelled Delete deletes nothing', async () => {
  const { host, ctl, api } = mountCtl({ confirm: async () => false });
  await ctl.route('');
  host.querySelector('.script-card[data-script-key="runTests"] .script-delete').click();
  await tick(); await tick();
  assert.equal(api.calls.some((c) => c[0] === 'remove'), false);
  ctl.destroy();
});

test('the controller: a failed list says why and paints an empty pane', async () => {
  const { host, ctl, msgEl } = mountCtl({}, { list: async () => ({ ok: false, status: 500, data: { error: 'registry unreadable' } }) });
  await ctl.route('');
  assert.equal(msgEl.textContent, 'registry unreadable');
  assert.ok(msgEl.className.includes('err'));
  assert.equal(host.querySelectorAll('.script-card').length, 0);
  ctl.destroy();
});

test('the controller: onChanged refetches, onFrame is inert, destroy empties the host', async () => {
  const { host, ctl, api } = mountCtl();
  await ctl.route('');
  ctl.onChanged();
  await tick(); await tick();
  assert.equal(api.calls.filter((c) => c[0] === 'list').length, 2);
  ctl.onFrame({ type: 'scriptbench-line', benchId: 'bench_1', text: 'x' });   // no throw
  assert.equal(ctl.isDirty(), false);
  ctl.destroy();
  assert.equal(host.children.length, 0);
});

// ---- the booted app: the rail entry, the route, the no-prose rule -----------

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._l = {}; WSStub.last = this; }
  send(s) { this.sent.push(typeof s === 'string' ? JSON.parse(s) : s); }
  close() {}
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  _open() { (this._l.open || []).forEach((f) => f({})); }
  deliver(obj) { (this._l.message || []).forEach((f) => f({ data: JSON.stringify(obj) })); }
}

async function boot({ scripts = SCRIPTS } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const seen = [];
  window.fetch = (url, opts) => {
    const u = String(url);
    seen.push([opts && opts.method ? opts.method : 'GET', u]);
    if (u.includes('/api/scripts/runtimes')) return Promise.resolve({ ok: true, status: 200, json: async () => RUNTIMES });
    if (u.includes('/api/scripts')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ scripts }) });
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [], mockWriterRoles: [] }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  const go = async (hash) => {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
    for (let i = 0; i < 4; i += 1) await tick();
  };
  await go('scripts');
  return { window, go, seen };
}

test('the rail and the topnav carry Scripts directly under Agents, and #scripts paints the list', async () => {
  const { window } = await boot();
  const d = window.document;
  const rail = [...d.querySelectorAll('.nav button[data-nav]')].map((b) => b.dataset.nav);
  assert.equal(rail[rail.indexOf('agents') + 1], 'scripts');
  const top = [...d.querySelectorAll('.topnav button[data-nav]')].map((b) => b.dataset.nav);
  assert.equal(top[top.indexOf('agents') + 1], 'scripts');
  assert.equal(d.querySelector('[data-view="scripts"]').classList.contains('hidden'), false);
  assert.ok(d.querySelector('.nav button[data-nav="scripts"]').classList.contains('active'));
  assert.deepEqual([...d.querySelectorAll('#scripts-host .script-card')].map((c) => c.dataset.scriptKey),
    ['shell', 'runTests', 'tidy']);
});

test('the Scripts page carries NO explanatory prose: zero <p> in the whole view', async () => {
  const { window } = await boot();
  const view = window.document.querySelector('[data-view="scripts"]');
  assert.equal(view.querySelectorAll('p').length, 0, 'labels, chips and error sentences only');
  assert.equal(window.document.getElementById('scripts-msg').tagName, 'DIV');
});

test('a scripts-changed frame drops the cache and repaints the open page', async () => {
  const { window, seen } = await boot();
  const before = seen.filter(([, u]) => u === '/api/scripts').length;
  WSStub.last.deliver({ type: 'scripts-changed', action: 'created' });
  for (let i = 0; i < 4; i += 1) await tick();
  assert.equal(seen.filter(([, u]) => u === '/api/scripts').length, before + 1);
  assert.deepEqual(window.__scripts.ctl() === null, false);
});

test('leaving the view destroys the controller; coming back mounts a fresh one', async () => {
  const { window, go } = await boot();
  const first = window.__scripts.ctl();
  await go('agents');
  assert.equal(window.__scripts.ctl(), null);
  assert.equal(window.document.getElementById('scripts-host').children.length, 0);
  await go('scripts');
  assert.notEqual(window.__scripts.ctl(), null);
  assert.notEqual(window.__scripts.ctl(), first);
});

test('a scripts-changed frame marks the composer palette dirty: re-entering the composer re-reads the scripts', async () => {
  const { go, seen } = await boot();
  const reads = () => seen.filter(([, u]) => u === '/api/scripts').length;
  const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };
  await go('composer'); await settle();
  await go('scripts'); await settle();
  const clean = reads();
  await go('composer'); await settle();
  assert.equal(reads(), clean, 'a clean re-entry costs no request');
  await go('scripts'); await settle();
  WSStub.last.deliver({ type: 'scripts-changed', action: 'created' });
  await settle();
  const afterFrame = reads();
  await go('composer'); await settle();
  assert.equal(reads(), afterFrame + 1, 'a script saved on the Scripts page (or by the CLI) reaches an open composer palette');
});

test('a host WITH python: the list drops the chip, and the reason is the probe`s own sentence', () => {
  const withPython = { ...RUNTIMES, python: { ok: true, version: '3.12.4', command: ['python3'] } };
  const card = buildScriptCard(SCRIPTS[2], { doc, runtimes: withPython, caseState: new Map() });
  assert.equal(card.querySelector('.script-warn'), null);
  assert.equal(card.querySelector('.script-runtime').textContent, 'python', 'the runtime chip stays either way');
  const missing = buildScriptCard(SCRIPTS[2], { doc, runtimes: RUNTIMES, caseState: new Map() });
  assert.equal(missing.querySelector('.script-warn').textContent, 'python not found');
  // The whole list, both ways: no other card ever grows or loses a chip.
  const pane = renderScriptsList(SCRIPTS, { doc, runtimes: withPython, caseState: new Map() });
  assert.equal(pane.querySelectorAll('.script-warn').length, 0);
  assert.equal(renderScriptsList(SCRIPTS, { doc, runtimes: RUNTIMES, caseState: new Map() }).querySelectorAll('.script-warn').length, 1);
});
