// test/ui-scripts-view.test.mjs — the Scripts page's list half (scripts-workbench §5.1):
// the pure renderers, the controller against a fake api, and one booted-app pass for
// the rail entry, the route and the no-prose rule.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  scriptRoute, parseScriptsParam, originLabel, portLineOf, buildScriptCard,
  renderScriptsList, createScriptsController, newScriptRoute,
} from '../ui/public/scripts-view.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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

test('scriptRoute / newScriptRoute / parseScriptsParam: the two steps of a new script, a bare key, an old tab word ignored', () => {
  assert.equal(scriptRoute(), 'scripts');
  assert.equal(scriptRoute('runTests'), 'scripts/runTests');
  assert.equal(newScriptRoute(), 'scripts/new');
  assert.equal(newScriptRoute('python'), 'scripts/new/python');
  assert.deepEqual(parseScriptsParam(''), { mode: 'list' });
  assert.deepEqual(parseScriptsParam('new'), { mode: 'new', step: 1 });
  assert.deepEqual(parseScriptsParam('new/shell'), { mode: 'new', step: 2, runtime: 'shell' });
  assert.deepEqual(parseScriptsParam('new/nope'), { mode: 'new', step: 1 }, 'an unknown runtime lands on the picker');
  assert.deepEqual(parseScriptsParam('runTests'), { mode: 'detail', key: 'runTests' });
  assert.deepEqual(parseScriptsParam('runTests/source'), { mode: 'detail', key: 'runTests' }, 'an old bookmark opens the workspace');
  assert.deepEqual(parseScriptsParam('runTests/test'), { mode: 'detail', key: 'runTests' });
});

test('buildScriptCard: badges, chips, port line, case chip, three actions, and the case dot reads this session\'s results', async () => {
  await checkRows([
    { name: 'buildScriptCard: badges, chips, the port line, the case chip and the three actions', run: async () => {
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
    } },
    { name: 'buildScriptCard: the case dot reads this session`s results', run: async () => {
      const dot = (states) => buildScriptCard(SCRIPTS[1], { doc, runtimes: RUNTIMES, caseState: new Map([['runTests', new Map(states)]]) })
        .querySelector('.script-dot').dataset.state;
      assert.equal(dot([]), 'none');
      assert.equal(dot([['a', 'pass'], ['b', 'pass'], ['c', 'pass']]), 'pass');
      assert.equal(dot([['a', 'pass'], ['b', 'fail']]), 'fail');
      assert.equal(dot([['a', 'pass']]), 'ran', 'not every case ran yet');
      assert.equal(dot([['a', 'ran'], ['b', 'ran'], ['c', 'ran']]), 'ran');
    } },
  ]);
});

test('renderScriptsList: the topbar, registry order, and the filter over key/name/runtime/origin', () => {
  const pane = renderScriptsList(SCRIPTS, { doc, runtimes: RUNTIMES });
  assert.equal(pane.querySelector('h1'), null, 'the top bar names the page');
  assert.ok(pane.querySelector('.topbar > .scripts-tools'), 'the bar keeps the filter and New script');
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

test('the controller: New script, Open and Duplicate (stepping past a taken copy key)', async () => {
  await checkRows([
    { name: 'the controller: New script, Open and Duplicate', run: async () => {
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
    } },
    { name: 'the controller: Duplicate steps past a taken copy key', run: async () => {
      const taken = [...SCRIPTS, { key: 'shellCopy', displayName: 'Copy', origin: 'user', runtime: 'shell', params: [], portSummary: '', caseCount: 0 }];
      const { host, ctl, api } = mountCtl({}, { list: async () => ok({ scripts: taken }) });
      await ctl.route('');
      host.querySelector('.script-card[data-script-key="shell"] .script-duplicate').click();
      await tick(); await tick();
      assert.deepEqual(api.calls.filter((c) => c[0] === 'duplicate'), [['duplicate', 'shell', 'shellCopy2']]);
      ctl.destroy();
    } },
  ]);
});

test('the controller: Delete asks first then removes; a cancelled Delete deletes nothing; a REFERENCED 409 shows the server\'s sentence', async () => {
  await checkRows([
    { name: 'the controller: Delete asks first, then removes; a REFERENCED 409 shows the server`s sentence', run: async () => {
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
    } },
    { name: 'the controller: a cancelled Delete deletes nothing', run: async () => {
      const { host, ctl, api } = mountCtl({ confirm: async () => false });
      await ctl.route('');
      host.querySelector('.script-card[data-script-key="runTests"] .script-delete').click();
      await tick(); await tick();
      assert.equal(api.calls.some((c) => c[0] === 'remove'), false);
      ctl.destroy();
    } },
  ]);
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

// ---- the booted app: the rail entry, the route, the frames ------------------

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._l = {}; WSStub.last = this; }
  send(s) { this.sent.push(typeof s === 'string' ? JSON.parse(s) : s); }
  close() {}
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  _open() { (this._l.open || []).forEach((f) => f({})); }
  deliver(obj) { (this._l.message || []).forEach((f) => f({ data: JSON.stringify(obj) })); }
}

async function boot({ scripts = SCRIPTS } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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
  // #workflows/scripts only opens the Library: the sheet mounts the Scripts controller.
  await go('workflows/scripts/new');
  return { window, go, seen };
}

test('a scripts-changed frame drops the cache and repaints the open page', async () => {
  const { window, seen } = await boot();
  const before = seen.filter(([, u]) => u === '/api/scripts').length;
  WSStub.last.deliver({ type: 'scripts-changed', action: 'created' });
  for (let i = 0; i < 4; i += 1) await tick();
  assert.equal(seen.filter(([, u]) => u === '/api/scripts').length, before + 1);
  assert.deepEqual(window.__scripts.ctl() === null, false);
});

test('a scripts-changed frame reloads the registry at once while the Workflows view is open; an in-view hop costs no request', async () => {
  const { go, seen } = await boot();
  const reads = () => seen.filter(([, u]) => u === '/api/scripts').length;
  const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };
  await settle();
  const before = reads();
  WSStub.last.deliver({ type: 'scripts-changed', action: 'created' });
  await settle();
  const afterFrame = reads();
  assert.equal(afterFrame, before + 1, 'a script saved elsewhere (or by the CLI) reaches the open view at once');
  await go('workflows'); await settle();
  assert.equal(reads(), afterFrame, 'an in-view hop (#workflows/scripts/new → #workflows) costs no request');
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

test('openDraft(draft) shows a NEW script at Build & test with the draft\'s meta, code and its cases pending', async () => {
  const s = await mountCtl();
  await s.ctl.openDraft({ meta: { key: 'runLint', displayName: 'Run lint', runtime: 'shell', description: 'Lints.', inputs: [], outputs: [] },
    source: 'npm run lint', cases: [{ id: 'ok', name: 'passes', expect: { verdict: 'clean' } }] });
  const root = s.host.querySelector('.wz-step-2');
  assert.ok(root, 'step 2');
  assert.equal(root.querySelector('[data-field="meta:displayName"]').value, 'Run lint');
  assert.equal(root.querySelector('.script-source').dataset.srcMode, 'file', 'a drafted shell PROGRAM, not the template command');
  assert.equal(root.querySelector('[data-field="script:source"]').value, 'npm run lint');
  assert.equal(s.ctl.isDirty(), true, 'a draft is unsaved');
  assert.deepEqual(s.ctl.pendingCases().map((c) => c.id), ['ok']);
});

test('openDraft keeps the draft\'s DECLARED ports; Save writes its pending cases after the create', async () => {
  const s = await mountCtl();
  await s.ctl.openDraft({ meta: { key: 'mdReport', displayName: 'MD report', runtime: 'node', description: 'Writes a report.',
    inputs: [{ id: 'plan', type: 'md', required: true }], outputs: [{ id: 'report', type: 'md', when: 'always', filename: 'report.md' }] },
    source: 'export default async function run() { return {}; }\n', cases: [{ id: 'c1', name: 'one', expect: { verdict: 'clean' } }] });
  s.host.querySelector('.script-save').click();
  await tick(); await tick();
  const create = s.api.calls.find((c) => c[0] === 'create');
  assert.deepEqual(create[1].meta.inputs.map((p) => [p.id, p.type, p.required]), [['plan', 'md', true]]);
  assert.deepEqual(create[1].meta.outputs.map((p) => [p.id, p.filename]), [['report', 'report.md']]);
  const i = s.api.calls.findIndex((c) => c[0] === 'writeCases');
  assert.ok(i > s.api.calls.indexOf(create), 'cases are written after the script exists');
  assert.deepEqual(s.api.calls[i].slice(1), ['mdReport', [{ id: 'c1', name: 'one', expect: { verdict: 'clean' } }]]);
  assert.equal(s.nav.at(-1), 'scripts/mdReport');
  assert.deepEqual(s.ctl.pendingCases(), []);
  const t = await mountCtl();
  await t.ctl.openDraft({ meta: { key: 'x1', displayName: 'X one', runtime: 'node', inputs: [], outputs: [] }, source: 'export default async function run() {}\n', cases: [{ id: 'k', name: 'k', expect: {} }] });
  await t.ctl.route('');
  await t.ctl.route('new/node');
  assert.deepEqual(t.ctl.pendingCases(), [], 'a later plain New script inherits nothing');
});

test('openDraft paints the draft even when a later route() supersedes its own (a scripts-changed frame during the runtimes probe)', async () => {
  const held = [];
  let calls = 0;
  // The first two probes hang until released (the draft's own route, then the frame's); later ones answer at once.
  const s = await mountCtl({}, { runtimes: () => (++calls <= 2 ? new Promise((r) => held.push(() => r(ok(RUNTIMES)))) : Promise.resolve(ok(RUNTIMES))) });
  const opened = s.ctl.openDraft({ meta: { key: 'runLint', displayName: 'Run lint', runtime: 'shell', inputs: [], outputs: [] }, source: 'npm run lint', cases: [] });
  s.ctl.onChanged();                                  // the frame: a second route() while the first awaits its probe
  held[0]();                                          // the superseded route answers first and paints nothing
  await tick(); await tick();
  held[1]();
  await opened;
  const root = s.host.querySelector('.wz-step-2');
  assert.ok(root, 'step 2');
  assert.equal(root.querySelector('[data-field="meta:displayName"]').value, 'Run lint');
  assert.equal(root.querySelector('[data-field="script:source"]').value, 'npm run lint');
});

test('a drafted shell script routes on its exit code only when the draft says so; a rename keeps the drafted key', async () => {
  const saveMeta = async (s) => { s.host.querySelector('.script-save').click(); await tick(); await tick(); return s.api.calls.find((c) => c[0] === 'create')[1].meta; };
  const plain = await mountCtl();
  await plain.ctl.openDraft({ meta: { key: 'runLint', displayName: 'Run lint', runtime: 'shell', inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'lint.md' }] },
    source: 'npm run lint\n', cases: [] });
  const name = plain.host.querySelector('[data-field="meta:displayName"]');
  name.value = 'Lint everything';
  name.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  const m = await saveMeta(plain);
  assert.equal(m.key, 'runLint', 'the chat may have placed the draft under this key already');
  assert.equal(m.displayName, 'Lint everything');
  assert.deepEqual(m.outputs.map((p) => p.id), ['log'], 'no minted pass / fail');
  assert.ok(!m.verdict, 'no verdict');
  const gate = await mountCtl();
  await gate.ctl.openDraft({ meta: { key: 'gate', displayName: 'Gate', runtime: 'shell', inputs: [], outputs: [{ id: 'fail', type: 'md', when: 'blocking', filename: 'fail.md' }] },
    source: 'npm test\n', cases: [] });
  assert.ok((await saveMeta(gate)).verdict, 'a when-gated output: the draft routes on the exit code');
});
