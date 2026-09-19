// test/ui-script-detail.test.mjs — the Scripts page's detail half (scripts-workbench §5.2):
// the Overview form, the Source tab, create, Save and the dirty leave-guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderScriptDetail, collectScriptDraft, blankScriptMeta, createScriptsController, scriptPayload,
  SCRIPT_TEMPLATES, SCRIPT_WIN32_TEMPLATE, SHELL_COMMAND_TEMPLATE, EDITOR_LANGUAGE,
} from '../ui/public/scripts-view.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 4) => { for (let i = 0; i < n; i += 1) await tick(); };
const RUNTIMES = { node: { ok: true, version: '22.13.0' }, shell: { ok: true, path: '/bin/sh' }, python: { ok: false, reason: 'not supported' } };

const USER_META = {
  key: 'runTests', metaVersion: 2, displayName: 'Run tests', description: 'Runs the suite.',
  domain: 'coding', color: 'violet', icon: '', order: 20, origin: 'user', runtime: 'node',
  file: 'runTests.mjs', timeoutMs: 20000,
  params: [{ id: 'mode', type: 'enum', options: ['fast', 'full'], default: 'fast' }],
  inputs: [{ id: 'done', type: 'void', required: false }],
  outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' }],
  verdict: { filename: 'tests-cycle{cycle}.json' },
};
const USER = { meta: USER_META, source: 'export default async () => ({ summary: "ok" });\n', sourceWin32: null,
  sourcePath: '/home/u/.worca-cc/scripts/runTests.mjs', sourceTruncated: false, cases: [], userCases: [], casesWritable: true };
const SHELL_META = { key: 'lint', metaVersion: 2, displayName: 'Lint', description: '', domain: '', color: 'amber',
  icon: '', order: 30, origin: 'user', runtime: 'shell', file: { default: 'lint.sh', win32: 'lint.cmd' },
  timeoutMs: 600000, exitCodes: { clean: [0], blocking: [1, 2] }, params: [],
  inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'lint-cycle{cycle}.md' }],
  verdict: { filename: 'lint-cycle{cycle}.json' } };
const SHELL = { meta: SHELL_META, source: '#!/bin/sh\nnpm run lint\n', sourceWin32: '@echo off\r\nnpm.cmd run lint\r\n',
  sourcePath: '/home/u/.worca-cc/scripts/lint.sh', sourceTruncated: false, cases: [], userCases: [], casesWritable: true };
const BUILTIN = { meta: { ...USER_META, key: 'gitDiff', displayName: 'Git diff', origin: 'builtin' },
  source: '// built in\n', sourceWin32: null, sourcePath: '/repo/scripts/git-diff.mjs', sourceTruncated: false,
  cases: [{ id: 'c1', name: 'shipped' }], userCases: [], casesWritable: true };

const render = (data, over = {}) => renderScriptDetail(data, { doc, runtimes: RUNTIMES, highlight: async (t) => t, ...over });
const dispose = (root) => (root._editors || []).forEach((e) => e.destroy());

test('the detail head: title, chips, tabs and the four actions', async () => {
  const root = render(USER);
  await flush();
  assert.equal(root.dataset.scriptKey, 'runTests');
  assert.equal(root.dataset.tab, 'overview');
  assert.equal(root.querySelector('.script-title').textContent, 'Run tests');
  assert.equal(root.querySelector('.script-origin').textContent, 'user');
  assert.equal(root.querySelector('.script-runtime').textContent, 'node');
  assert.equal(root.querySelector('.script-warn'), null);
  assert.equal(root.querySelector('.script-dirty').hidden, true);
  assert.equal(root.querySelector('.script-dirty').textContent, 'unsaved');
  assert.deepEqual([...root.querySelectorAll('.script-tabs button')].map((b) => [b.dataset.tab, b.textContent, b.disabled]),
    [['overview', 'Overview', false], ['source', 'Source', false], ['test', 'Test', false]]);
  assert.ok(root.querySelector('.script-tabs button[data-tab="overview"]').classList.contains('on'));
  assert.deepEqual([...root.querySelectorAll('.script-detail-actions button')].map((b) => b.textContent),
    ['Scripts', 'Duplicate', 'Delete', 'Save']);
  assert.deepEqual([...root.querySelectorAll('.script-pane')].map((p) => [p.dataset.pane, p.hidden]),
    [['overview', false], ['source', true], ['test', true]]);
  assert.ok(root.querySelector('.script-pane[data-pane="test"] .script-test-mount'), 'Task 10 mounts the bench here');
  assert.equal(root.querySelectorAll('p').length, 0, 'no prose on the detail page either');
  dispose(root);
});

test('the Overview form: every field, seconds for the timeout, the disabled python option', async () => {
  const root = render(USER);
  await flush();
  const v = (f) => root.querySelector(`[data-field="${f}"]`).value;
  assert.equal(v('meta:displayName'), 'Run tests');
  assert.equal(root.querySelector('[data-field="meta:key"]'), null, 'the key is editable on create only');
  assert.equal(v('meta:description'), 'Runs the suite.');
  assert.equal(v('meta:runtime'), 'node');
  assert.equal(v('meta:domain'), 'coding');
  assert.equal(v('meta:color'), 'violet');
  assert.equal(v('meta:order'), '20');
  assert.equal(v('meta:timeoutSec'), '20');
  assert.equal(v('meta:verdictFilename'), 'tests-cycle{cycle}.json');
  assert.equal(root.querySelector('[data-field="meta:exitCodesClean"]'), null, 'exit codes are a shell field');
  const py = [...root.querySelector('[data-field="meta:runtime"]').options].find((o) => o.value === 'python');
  assert.equal(py.disabled, true);
  assert.equal(py.title, 'not supported');
  assert.equal(root.querySelector('[data-field="meta:portsConfig"]').checked, false);
  assert.ok(root.querySelector('.ins-port-editor'));
  assert.ok(root.querySelector('.pdef-editor'));
  assert.equal(root.querySelector('[data-field="pdef:0:id"]').value, 'mode');
  dispose(root);
});

test('a shell script shows the exit-code fields and the Command | File control', async () => {
  const root = render(SHELL, { tab: 'source' });
  await flush();
  assert.equal(root.querySelector('[data-field="meta:exitCodesClean"]').value, '0');
  assert.equal(root.querySelector('[data-field="meta:exitCodesBlocking"]').value, '1, 2');
  const src = root.querySelector('.script-source');
  assert.equal(src.dataset.srcMode, 'file', 'a script that has a file opens on File');
  assert.deepEqual([...src.querySelectorAll('[data-src-mode]')].map((b) => b.textContent), ['Command', 'File']);
  assert.deepEqual([...src.querySelectorAll('[data-src-tab]')].map((b) => b.textContent), ['sh', 'win32']);
  assert.equal(src.dataset.srcTab, 'default');
  assert.equal(root.querySelector('[data-field="script:source"]').value, '#!/bin/sh\nnpm run lint\n');
  assert.equal(root.querySelector('.code-editor').dataset.language, 'bash');
  const w32 = render(SHELL, { tab: 'source', srcTab: 'win32' });
  await flush();
  // a <textarea>'s API value normalises every CRLF to LF, so the editor can never hold a CR
  assert.equal(w32.querySelector('[data-field="script:sourceWin32"]').value, '@echo off\nnpm.cmd run lint\n');
  dispose(root); dispose(w32);
});

test('a shell script with no file opens on Command and edits meta.command', async () => {
  const inline = { ...SHELL, meta: { ...SHELL_META, file: null, command: 'npm test' }, source: '', sourceWin32: null, sourcePath: null };
  const root = render(inline, { tab: 'source' });
  await flush();
  const src = root.querySelector('.script-source');
  assert.equal(src.dataset.srcMode, 'command');
  assert.equal(src.querySelector('[data-src-tab]'), null, 'no platform tabs without a file');
  assert.equal(root.querySelector('[data-field="meta:command"]').value, 'npm test');
  const draft = collectScriptDraft(root);
  assert.equal(draft.meta.command, 'npm test');
  assert.equal(draft.source, '', 'a command-mode shell script has no file');
  assert.equal(draft.sourceWin32, '', 'and no .cmd either: always a string, never null');
  dispose(root);
});

// A duplicate of the built-in `shell`: shell runtime, no file, NO meta.command —
// the command is a command-TYPED param, filled per card. The page opens it on the
// Command tab with an empty box, and a blank box must send `null` (remove), not
// `''`: the validator refuses an empty command, so every Save of the copy failed.
test('a shell script whose command lives in a param saves with no meta.command', async () => {
  const carded = {
    meta: { ...SHELL_META, key: 'shellCopy', file: null, command: null, ports: 'config',
      defaultPorts: { inputs: [], outputs: [] }, inputs: undefined, outputs: undefined,
      params: [{ id: 'command', type: 'command', label: 'Command', required: true }] },
    source: '', sourceWin32: null, sourcePath: null, sourceTruncated: false, cases: [], userCases: [], casesWritable: true,
  };
  const root = render(carded, { tab: 'source' });
  await flush();
  assert.equal(root.querySelector('.script-source').dataset.srcMode, 'command');
  assert.equal(root.querySelector('[data-field="meta:command"]').value, '');
  const draft = collectScriptDraft(root);
  assert.equal(draft.meta.command, null, 'a blank Command box removes the key, it never sends an empty string');
  dispose(root);
  const c = mountCtl({ read: async () => ok(carded) });
  await c.ctl.route('shellCopy');
  await flush();
  assert.equal(c.ctl.isDirty(), false);
  c.host.querySelector('.script-save').click();
  await flush();
  const put = c.api.calls.find((x) => x[0] === 'update');
  assert.equal(put[2].meta.command, null, 'the Save the page sends must not carry an empty command');
  c.cleanup();
});

test('EDITOR_LANGUAGE covers every runtime, and the node editor uses javascript', async () => {
  assert.deepEqual(EDITOR_LANGUAGE, { node: 'javascript', shell: 'bash', python: 'python' });
  const root = render(USER, { tab: 'source' });
  await flush();
  assert.equal(root.querySelector('.code-editor').dataset.language, 'javascript');
  assert.equal(root.querySelector('[data-field="script:source"]').value, USER.source);
  dispose(root);
});

test('a built-in renders read-only: disabled fields, no Save, a mono path and Copy', async () => {
  const root = render(BUILTIN, { readOnly: true });
  await flush();
  assert.equal(root.querySelector('.script-save'), null);
  assert.equal(root.querySelector('.script-delete'), null);
  assert.ok(root.querySelector('.script-duplicate'), 'Duplicate is the way out (spec §13)');
  assert.equal(root.querySelector('[data-field="meta:displayName"]').disabled, true);
  assert.equal(root.querySelector('[data-field="meta:runtime"]').disabled, true);
  assert.equal(root.querySelector('[data-pdef-add]'), null);
  assert.equal(root.querySelector('[data-port-add]'), null);
  assert.equal(root.querySelector('.script-path').textContent, '/repo/scripts/git-diff.mjs');
  assert.equal(root.querySelector('.script-copy').textContent, 'Copy');
  const src = render(BUILTIN, { readOnly: true, tab: 'source' });
  await flush();
  assert.equal(src.querySelector('.code-editor').classList.contains('ro'), true);
  dispose(root); dispose(src);
});

test('the create page: a key field, the runtime template, no Duplicate/Delete, Test locked', async () => {
  const root = render({ meta: blankScriptMeta('node'), source: SCRIPT_TEMPLATES.node, sourceWin32: null, sourcePath: null, cases: [], userCases: [] }, { isNew: true, tab: 'source' });
  await flush();
  assert.equal(root.querySelector('.script-title').textContent, 'New script');
  assert.ok(root.querySelector('[data-field="meta:key"]'));
  assert.equal(root.querySelector('.script-duplicate'), null);
  assert.equal(root.querySelector('.script-delete'), null);
  const testTab = root.querySelector('.script-tabs button[data-tab="test"]');
  assert.equal(testTab.disabled, true);
  assert.equal(testTab.title, 'Save the script first');
  assert.equal(root.querySelector('[data-field="script:source"]').value, SCRIPT_TEMPLATES.node);
  dispose(root);
});

test('the per-runtime templates satisfy their contracts', () => {
  assert.match(SCRIPT_TEMPLATES.node, /^export default async function \(\{ inputs, outputs, params, ctx, log \}\) \{/m);
  assert.match(SCRIPT_TEMPLATES.node, /return \{ summary: 'ok' \};/);
  assert.match(SCRIPT_TEMPLATES.shell, /^#!\/bin\/sh$/m);
  assert.match(SCRIPT_TEMPLATES.python, /^def main\(api\):$/m);
  // A <textarea>'s API value normalises CRLF to LF, so NO template the editor shows may
  // carry a CR: the store owns the .cmd file's line endings (Task 2), not the page.
  assert.ok(!SCRIPT_WIN32_TEMPLATE.includes('\r'), 'the editor can never hold a CR');
  assert.ok(!SCRIPT_TEMPLATES.shell.includes('\r'), 'a .sh file never does');
  assert.equal(SHELL_COMMAND_TEMPLATE, 'npm test');
});

test('collectScriptDraft reads the form back, in ms, without a store-owned file', async () => {
  const root = render(USER, { tab: 'overview' });
  await flush();
  root.querySelector('[data-field="meta:displayName"]').value = 'Run the suite';
  root.querySelector('[data-field="meta:timeoutSec"]').value = '45';
  const draft = collectScriptDraft(root);
  assert.equal(draft.meta.key, 'runTests');
  assert.equal(draft.meta.metaVersion, 2);
  assert.equal(draft.meta.displayName, 'Run the suite');
  assert.equal(draft.meta.timeoutMs, 45000);
  assert.equal(draft.meta.order, 20);
  assert.equal('file' in draft.meta, false, 'the store owns meta.file');
  assert.deepEqual(draft.meta.params, [{ id: 'mode', type: 'enum', default: 'fast', options: ['fast', 'full'] }]);
  assert.deepEqual(draft.meta.inputs, [{ id: 'done', type: 'void', required: false }]);
  assert.deepEqual(draft.meta.outputs, [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' }]);
  assert.deepEqual(draft.meta.verdict, { filename: 'tests-cycle{cycle}.json' });
  assert.equal(draft.meta.ports, null, 'a key the form can clear is SENT as null (the store reads null as remove)');
  assert.equal(draft.meta.defaultPorts, null);
  assert.equal(draft.meta.exitCodes, null, 'not a shell script');
  assert.equal(draft.meta.command, null);
  assert.equal(draft.source, USER.source);
  assert.equal(draft.sourceWin32, '');
  dispose(root);
});

test('the Ports-per-card switch turns the port editor into the defaultPorts editor', async () => {
  const root = render(USER);
  await flush();
  const sw = root.querySelector('[data-field="meta:portsConfig"]');
  sw.checked = true;
  sw.dispatchEvent(new win.Event('change', { bubbles: true }));
  const draft = collectScriptDraft(root);
  assert.equal(draft.meta.ports, 'config');
  assert.deepEqual(draft.meta.defaultPorts, { inputs: USER_META.inputs, outputs: USER_META.outputs });
  assert.equal(draft.meta.inputs, null, 'a config-ported sidecar declares neither — sent as null so the store REMOVES them');
  assert.equal(draft.meta.outputs, null);
  dispose(root);
});

test('a shell draft carries exit codes, the command and both platform sources', async () => {
  const root = render(SHELL, { tab: 'source' });
  await flush();
  const draft = collectScriptDraft(root);
  assert.deepEqual(draft.meta.exitCodes, { clean: [0], blocking: [1, 2] });
  assert.equal(draft.source, SHELL.source);
  assert.equal(draft.sourceWin32, '@echo off\nnpm.cmd run lint\n', 'the win32 half travels while the sh tab is showing — in LF: the store owns the .cmd ending');
  assert.equal(draft.meta.command, null, 'File mode sends no command');
  dispose(root);
});

// ---- the controller --------------------------------------------------------

const ok = (data) => ({ ok: true, status: 200, data });
function mountCtl(apiOver = {}, over = {}) {
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const msgEl = doc.createElement('div');
  const nav = [];
  const asked = [];
  const calls = [];
  const api = {
    calls,
    list: async () => ok({ scripts: [{ ...USER_META, portSummary: '', caseCount: 0 }, { ...SHELL_META, portSummary: '', caseCount: 0 }] }),
    read: async (k) => { calls.push(['read', k]); return ok(k === 'lint' ? SHELL : USER); },
    create: async (b) => { calls.push(['create', b]); return ok({ meta: b.meta, source: b.source }); },
    update: async (k, b) => { calls.push(['update', k, b]); return ok({ meta: b.meta, warnings: [] }); },
    remove: async (k) => { calls.push(['remove', k]); return ok({ ok: true }); },
    duplicate: async (k, n) => { calls.push(['duplicate', k, n]); return ok({ meta: { key: n } }); },
    writeCases: async () => ok({ cases: [] }),
    runtimes: async () => ok(RUNTIMES),
    bench: async () => ok({ benchId: 'b1' }),
    benchStop: async () => ok({ ok: true }),
    benchOutput: (id, p) => `/api/scripts/bench/${id}/output/${p}`,
    history: async () => ok({ pipelines: [] }),
    runArtifacts: async () => ok({ artifacts: [] }),
    runArtifact: async () => ok({ rel: '', text: '' }),
    projects: async () => ok({ projects: [] }),
    ...apiOver,
  };
  const ctl = createScriptsController({
    host, msgEl, api, doc,
    navigate: (hash) => nav.push(hash),
    confirm: async (opts) => { asked.push(opts); return true; },
    highlight: async (t) => t,
    ws: { send: () => {} },
    ...over,
  });
  return { host, msgEl, nav, asked, api, ctl, cleanup: () => { ctl.destroy(); host.remove(); } };
}

test('the controller opens a script, and a tab hop repaints WITHOUT refetching', async () => {
  const c = mountCtl();
  await c.ctl.route('runTests');
  await flush();
  assert.deepEqual(c.api.calls.filter((x) => x[0] === 'read'), [['read', 'runTests']]);
  assert.equal(c.host.querySelector('.script-detail').dataset.tab, 'overview');
  await c.ctl.route('runTests/source');
  await flush();
  assert.deepEqual(c.api.calls.filter((x) => x[0] === 'read'), [['read', 'runTests']], 'a tab hop must never reload over a draft');
  assert.equal(c.host.querySelector('.script-detail').dataset.tab, 'source');
  assert.equal(c.host.querySelector('.script-pane[data-pane="source"]').hidden, false);
  assert.ok(c.host.querySelector('.script-tabs button[data-tab="source"]').classList.contains('on'));
  c.cleanup();
});

test('the tabs are hash-first: clicking one navigates, it does not paint directly', async () => {
  const c = mountCtl();
  await c.ctl.route('runTests');
  await flush();
  c.host.querySelector('.script-tabs button[data-tab="test"]').click();
  assert.deepEqual(c.nav, ['scripts/runTests/test']);
  c.cleanup();
});

test('an unknown key says so and leaves the page on the list', async () => {
  const c = mountCtl({ read: async () => ({ ok: false, status: 404, data: { error: 'script not found' } }) });
  await c.ctl.route('nope');
  await flush();
  assert.equal(c.msgEl.textContent, 'script "nope" not found');
  assert.ok(c.msgEl.className.includes('err'));
  assert.equal(c.host.querySelector('.script-detail'), null);
  c.cleanup();
});

test('editing marks the page dirty; Save PUTs meta + source together and clears it', async () => {
  const c = mountCtl();
  await c.ctl.route('runTests');
  await flush();
  assert.equal(c.ctl.isDirty(), false);
  const name = c.host.querySelector('[data-field="meta:displayName"]');
  name.value = 'Run the suite';
  name.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(c.ctl.isDirty(), true);
  assert.equal(c.host.querySelector('.script-dirty').hidden, false);
  c.host.querySelector('.script-save').click();
  await flush(6);
  const put = c.api.calls.find((x) => x[0] === 'update');
  assert.equal(put[1], 'runTests');
  assert.equal(put[2].meta.displayName, 'Run the suite');
  assert.equal(put[2].source, USER.source);
  assert.equal(c.msgEl.textContent, 'Saved "runTests".');
  assert.equal(c.ctl.isDirty(), false, 'the baseline moves with the save');
  c.cleanup();
});

test('save warnings ride along after the confirmation', async () => {
  const c = mountCtl({ update: async (k, b) => ok({ meta: b.meta, warnings: ['port "log" is wired in 1 saved workflow'] }) });
  await c.ctl.route('runTests');
  await flush();
  c.host.querySelector('.script-save').click();
  await flush(6);
  assert.equal(c.msgEl.textContent, 'Saved "runTests". port "log" is wired in 1 saved workflow');
  assert.ok(c.msgEl.className.includes('warn'));
  c.cleanup();
});

test('a rejected save shows the server`s sentence and keeps every byte', async () => {
  const c = mountCtl({ update: async () => ({ ok: false, status: 400, data: { error: 'displayName is required' } }) });
  await c.ctl.route('runTests');
  await flush();
  const name = c.host.querySelector('[data-field="meta:displayName"]');
  name.value = '';
  name.dispatchEvent(new win.Event('input', { bubbles: true }));
  c.host.querySelector('.script-save').click();
  await flush(6);
  assert.equal(c.msgEl.textContent, 'displayName is required');
  assert.equal(c.host.querySelector('[data-field="meta:displayName"]').value, '', 'the draft is untouched');
  assert.equal(c.ctl.isDirty(), true);
  c.cleanup();
});

test('#scripts/new: the template is loaded, Save POSTs and the page routes to the saved script', async () => {
  const c = mountCtl();
  await c.ctl.route('new');
  await flush();
  assert.equal(c.api.calls.some((x) => x[0] === 'read'), false, 'nothing to read for a new script');
  assert.equal(c.host.querySelector('.script-title').textContent, 'New script');
  c.host.querySelector('[data-field="meta:key"]').value = 'fresh';
  c.host.querySelector('[data-field="meta:displayName"]').value = 'Fresh';
  c.host.querySelector('.script-save').click();
  await flush(6);
  const post = c.api.calls.find((x) => x[0] === 'create');
  assert.equal(post[1].meta.key, 'fresh');
  assert.equal(post[1].meta.runtime, 'node');
  assert.equal(post[1].source, SCRIPT_TEMPLATES.node);
  assert.deepEqual(c.nav, ['scripts/fresh']);
  c.cleanup();
});

test('switching the runtime on the create page swaps the template and the editor language', async () => {
  const c = mountCtl();
  await c.ctl.route('new/source');
  await flush();
  const rt = c.host.querySelector('[data-field="meta:runtime"]');
  rt.value = 'shell';
  rt.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  assert.equal(c.host.querySelector('.script-source').dataset.srcMode, 'command');
  assert.equal(c.host.querySelector('[data-field="meta:command"]').value, SHELL_COMMAND_TEMPLATE);
  assert.equal(c.host.querySelector('.code-editor').dataset.language, 'bash');
  c.cleanup();
});

test('the shell File mode fills both platform templates the first time', async () => {
  const c = mountCtl();
  await c.ctl.route('new/source');
  await flush();
  const rt = c.host.querySelector('[data-field="meta:runtime"]');
  rt.value = 'shell';
  rt.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  c.host.querySelector('[data-src-mode="file"]').click();
  await flush();
  assert.equal(c.host.querySelector('[data-field="script:source"]').value, SCRIPT_TEMPLATES.shell);
  c.host.querySelector('[data-src-tab="win32"]').click();
  await flush();
  assert.equal(c.host.querySelector('[data-field="script:sourceWin32"]').value, SCRIPT_WIN32_TEMPLATE);
  c.cleanup();
});

test('leaving a dirty page asks first, one macrotask later; Cancel stays put', async () => {
  const c = mountCtl({}, { confirm: async () => false });
  await c.ctl.route('runTests');
  await flush();
  const name = c.host.querySelector('[data-field="meta:displayName"]');
  name.value = 'x';
  name.dispatchEvent(new win.Event('input', { bubbles: true }));
  c.host.querySelector('.script-back').click();
  await flush(6);
  assert.deepEqual(c.nav, [], 'Cancel keeps the draft on screen');
  c.cleanup();

  const d = mountCtl();
  await d.ctl.route('runTests');
  await flush();
  const n2 = d.host.querySelector('[data-field="meta:displayName"]');
  n2.value = 'y';
  n2.dispatchEvent(new win.Event('input', { bubbles: true }));
  d.host.querySelector('.script-back').click();
  await flush(6);
  assert.equal(d.asked[0].title, 'Discard changes');
  assert.equal(d.asked[0].message, 'This script has unsaved changes. Leave the page and discard them?');
  assert.equal(d.asked[0].confirmLabel, 'Discard');
  assert.deepEqual(d.nav, ['scripts']);
  d.cleanup();
});

test('a clean page leaves without asking, and Escape is the same exit', async () => {
  const c = mountCtl();
  await c.ctl.route('runTests');
  await flush();
  c.host.querySelector('.script-back').click();
  await flush(4);
  assert.deepEqual(c.asked, []);
  assert.deepEqual(c.nav, ['scripts']);
  c.host.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(4);
  assert.deepEqual(c.nav, ['scripts', 'scripts']);
  c.cleanup();
});

test('a scripts-changed poke never clobbers an unsaved draft', async () => {
  const c = mountCtl();
  await c.ctl.route('runTests');
  await flush();
  const name = c.host.querySelector('[data-field="meta:displayName"]');
  name.value = 'mine';
  name.dispatchEvent(new win.Event('input', { bubbles: true }));
  c.ctl.onChanged();
  await flush(4);
  assert.equal(c.host.querySelector('[data-field="meta:displayName"]').value, 'mine');
  assert.deepEqual(c.api.calls.filter((x) => x[0] === 'read'), [['read', 'runTests']]);
  c.cleanup();
});

test('destroy tears the mounted code editors down', async () => {
  const c = mountCtl();
  await c.ctl.route('runTests/source');
  await flush();
  const root = c.host.querySelector('.script-detail');
  assert.equal(root._editors.length, 1);
  let destroyed = 0;
  const real = root._editors[0].destroy;
  root._editors[0].destroy = () => { destroyed += 1; real(); };
  c.ctl.destroy();
  assert.equal(destroyed, 1);
  c.host.remove();
});

// ---- the payload boundary, the dirty baseline and the keys the form can clear ----

test('scriptPayload: the FLAT wire shape and the nested one become ONE shape, program text in LF', () => {
  const flat = { ...USER_META, source: 'a\r\nb\r\n', sourceWin32: 'c\r\n', sourcePath: '/p', sourceTruncated: false, cases: [{ id: 'c1' }], userCases: [], casesWritable: true };
  const p = scriptPayload(flat);
  assert.deepEqual(Object.keys(p).sort(), ['cases', 'casesWritable', 'meta', 'source', 'sourcePath', 'sourceTruncated', 'sourceWin32', 'userCases']);
  assert.equal(p.meta.key, 'runTests');
  assert.equal('source' in p.meta, false, 'no payload key leaks into the meta');
  assert.equal(p.source, 'a\nb\n');
  assert.equal(p.sourceWin32, 'c\n');
  assert.deepEqual(scriptPayload(p), p, 'idempotent on the nested shape');
  assert.deepEqual(scriptPayload(null).meta, {});
});

test('the controller reads the FLAT GET payload the server really sends', async () => {
  const flat = { ...SHELL_META, source: SHELL.source, sourceWin32: SHELL.sourceWin32, sourcePath: SHELL.sourcePath, sourceTruncated: false, cases: [], userCases: [], casesWritable: true };
  const c = mountCtl({ read: async () => ok(flat) });
  await c.ctl.route('lint/source');
  await flush();
  assert.equal(c.host.querySelector('.script-title').textContent, 'Lint');
  assert.equal(c.host.querySelector('[data-field="script:source"]').value, SHELL.source);
  assert.equal(c.ctl.isDirty(), false);
  c.host.querySelector('[data-src-tab="win32"]').click();
  await flush();
  assert.equal(c.ctl.isDirty(), false, 'a tab hop over a CRLF .cmd must not read as an edit');
  c.cleanup();
});

test('a structural repaint keeps the page dirty (the baseline is taken on load and save only)', async () => {
  const c = mountCtl();
  await c.ctl.route('runTests');
  await flush();
  const name = c.host.querySelector('[data-field="meta:displayName"]');
  name.value = 'EDITED';
  name.dispatchEvent(new win.Event('input', { bubbles: true }));
  c.host.querySelector('[data-port-add="outputs"]').click();
  await flush();
  assert.equal(c.host.querySelector('[data-field="meta:displayName"]').value, 'EDITED');
  assert.equal(c.ctl.isDirty(), true);
  assert.equal(c.host.querySelector('.script-dirty').hidden, false);
  c.ctl.onChanged();
  await flush();
  assert.deepEqual(c.api.calls.filter((x) => x[0] === 'read'), [['read', 'runTests']], 'still protected from a scripts-changed poke');
  c.cleanup();
});

test('changing the runtime of a SAVED script keeps the edit and sends the keys node refuses as null', async () => {
  const c = mountCtl();
  await c.ctl.route('lint');
  await flush();
  const rt = c.host.querySelector('[data-field="meta:runtime"]');
  rt.value = 'node';
  rt.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  assert.equal(c.host.querySelector('[data-field="meta:runtime"]').value, 'node', 'the select does not snap back');
  assert.equal(c.ctl.isDirty(), true);
  c.host.querySelector('.script-save').click();
  await flush(6);
  const put = c.api.calls.find((x) => x[0] === 'update');
  assert.equal(put[2].meta.runtime, 'node');
  assert.equal(put[2].meta.exitCodes, null);
  assert.equal(put[2].meta.command, null);
  assert.equal(put[2].sourceWin32, '', 'a node script has no .cmd; null would KEEP the stored one and the store would refuse it');
  c.cleanup();
});

test('clearing the verdict filename sends verdict: null; an emptied win32 editor sends "" and STAYS empty', async () => {
  const c = mountCtl();
  await c.ctl.route('lint/source');
  await flush();
  c.host.querySelector('[data-src-tab="win32"]').click();
  await flush();
  const ed = c.host.querySelector('[data-field="script:sourceWin32"]');
  ed.value = '';
  ed.dispatchEvent(new win.Event('input', { bubbles: true }));
  c.host.querySelector('[data-src-tab="default"]').click();
  await flush();
  assert.equal(c.host.querySelector('[data-field="script:sourceWin32"]').value, '', 'no template on the way OUT');
  c.host.querySelector('[data-field="meta:verdictFilename"]').value = '';
  c.host.querySelector('.script-save').click();
  await flush(6);
  const put = c.api.calls.find((x) => x[0] === 'update');
  assert.equal(put[2].sourceWin32, '');
  assert.equal(put[2].meta.verdict, null);
  c.cleanup();
});

test('a per-platform command MAP shows its default entry and saves back as a map', async () => {
  const mapped = { ...SHELL, meta: { ...SHELL_META, file: null, command: { default: 'npm test', win32: 'npm.cmd test' } }, source: '', sourceWin32: '', sourcePath: null };
  const root = render(mapped, { tab: 'source' });
  await flush();
  assert.equal(root.querySelector('[data-field="meta:command"]').value, 'npm test');
  root.querySelector('[data-field="meta:command"]').value = 'npm run lint';
  assert.deepEqual(collectScriptDraft(root).meta.command, { default: 'npm run lint', win32: 'npm.cmd test' });
  dispose(root);
});

test('a Command <-> File hop loses neither half', async () => {
  const c = mountCtl();
  await c.ctl.route('lint/source');
  await flush();
  c.host.querySelector('[data-src-mode="command"]').click();
  await flush();
  c.host.querySelector('[data-src-mode="file"]').click();
  await flush();
  assert.equal(c.host.querySelector('[data-field="script:source"]').value, SHELL.source);
  c.cleanup();
});

test('Escape inside a field is just a key; Duplicate on the detail page mints against a FRESH list and opens the copy', async () => {
  const c = mountCtl();
  await c.ctl.route('runTests/source');
  await flush();
  c.host.querySelector('[data-field="script:source"]').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  c.host.querySelector('[data-field="meta:displayName"]').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush(4);
  assert.deepEqual(c.nav, [], 'the caret was in a field');
  c.host.querySelector('.script-duplicate').click();
  await flush(6);
  assert.deepEqual(c.api.calls.filter((x) => x[0] === 'duplicate'), [['duplicate', 'runTests', 'runTestsCopy']]);
  assert.deepEqual(c.nav, ['scripts/runTestsCopy']);
  await c.ctl.route('runTestsCopy');
  await flush();
  assert.equal(c.msgEl.textContent, 'Duplicated as "runTestsCopy".', 'the flash lands on whichever page the route opens');
  c.cleanup();
});

// The store's key uniqueness is case-INSENSITIVE (one file holds both on macOS
// and Windows), so a copy key that differs from a taken one only in case is NOT
// free: it answered 409 on every press, and Duplicate offers no other key.
test('the copy key steps past a taken key that differs only in CASE', async () => {
  const list = [{ ...USER_META, portSummary: '', caseCount: 0 },
    { key: 'RunTestsCopy', displayName: 'Shouty copy', origin: 'user', runtime: 'node', params: [], portSummary: '', caseCount: 0 }];
  const c = mountCtl({ list: async () => ok({ scripts: list }) });
  await c.ctl.route('runTests');
  await flush();
  c.host.querySelector('.script-duplicate').click();
  await flush(6);
  assert.deepEqual(c.api.calls.filter((x) => x[0] === 'duplicate'), [['duplicate', 'runTests', 'runTestsCopy2']]);
  c.cleanup();
});

// A param whose id has been blanked is on its way out (that IS how a row is
// abandoned), but it is still a rendered row: every Remove button below it
// carries an index one higher than the saved list's, so a Remove used to splice
// the NEXT param — one click, the wrong definition gone.
test('Remove on a param row deletes THAT param, even with a blanked row above it', async () => {
  const three = { ...USER, meta: { ...USER_META, params: [
    { id: 'mode', type: 'enum', options: ['fast', 'full'], default: 'fast' },
    { id: 'depth', type: 'number', default: 2 },
    { id: 'note', type: 'string' },
  ] } };
  const c = mountCtl({ read: async () => ok(three) });
  await c.ctl.route('runTests');
  await flush();
  const id0 = c.host.querySelector('[data-field="pdef:0:id"]');
  id0.value = '';
  id0.dispatchEvent(new win.Event('input', { bubbles: true }));
  c.host.querySelector('[data-pdef-remove="1"]').click();        // × on `depth`
  await flush();
  assert.deepEqual(collectScriptDraft(c.host.querySelector('.script-detail')).meta.params.map((p) => p.id), ['note']);
  // And a freshly added blank row survives a Remove aimed at another row.
  const c2 = mountCtl({ read: async () => ok(three) });
  await c2.ctl.route('runTests');
  await flush();
  c2.host.querySelector('[data-pdef-add]').click();
  await flush();
  assert.equal(c2.host.querySelectorAll('.pdef-row').length, 4);
  c2.host.querySelector('[data-pdef-remove="0"]').click();
  await flush();
  assert.deepEqual([...c2.host.querySelectorAll('[data-field$=":id"]')].filter((n) => n.dataset.field.startsWith('pdef:')).map((n) => n.value),
    ['depth', 'note', ''], 'the empty row the user just added is still there');
  c.cleanup(); c2.cleanup();
});

test('a port switched off `void` gets its filename box back', async () => {
  // renderPortEditor hides an output's filename input for `void`; without a repaint
  // on the type change the box stays display:none for ever, the draft carries an md
  // output with no filename, and readConfigPorts refuses the save.
  const gated = { ...USER, meta: { ...USER_META, outputs: [{ id: 'gate', type: 'void', when: 'always' }] } };
  const c = mountCtl({ read: async () => ok(gated) });
  await c.ctl.route('runTests');
  await flush();
  assert.equal(c.host.querySelector('[data-field="port:outputs:0:filename"]').hidden, true);
  const sel = c.host.querySelector('[data-field="port:outputs:0:type"]');
  sel.value = 'md';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  const box = c.host.querySelector('[data-field="port:outputs:0:filename"]');
  assert.equal(box.hidden, false, 'the filename an md output requires can be typed');
  box.value = 'gate-cycle{cycle}.md';
  assert.deepEqual(collectScriptDraft(c.host.querySelector('.script-detail')).meta.outputs,
    [{ id: 'gate', type: 'md', when: 'always', filename: 'gate-cycle{cycle}.md' }]);
  c.cleanup();
});

test('a double-clicked Save sends ONE write; an answer that lands on another script`s page leaves that page alone', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const writes = [];
  const c = mountCtl({ update: async (k, b) => { writes.push(k); await gate; return ok({ meta: b.meta, warnings: [] }); } });
  await c.ctl.route('runTests');
  await flush();
  const name = c.host.querySelector('[data-field="meta:displayName"]');
  name.value = 'Twice';
  name.dispatchEvent(new win.Event('input', { bubbles: true }));
  c.host.querySelector('.script-save').click();
  c.host.querySelector('.script-save').click();
  await flush();
  assert.deepEqual(writes, ['runTests'], 'the second click is dropped while the first is in flight');
  await c.ctl.route('lint');                        // the user moved on before the answer
  await flush();
  release();
  await flush(6);
  assert.equal(c.host.querySelector('.script-detail').dataset.scriptKey, 'lint');
  assert.equal(c.ctl.isDirty(), false, 'the baseline of the lint page was not overwritten with the other draft');
  assert.notEqual(c.msgEl.textContent, 'Saved "runTests".', 'no flash for a page that is gone');
  c.host.querySelector('.script-save').click();    // and Save works again afterwards
  await flush(6);
  assert.deepEqual(writes, ['runTests', 'lint']);
  c.cleanup();
});

test('a write that answers after the page is gone is dropped, not thrown', async () => {
  // A rail click destroys the controller (showView) and Back routes to the list;
  // either can land while the PUT is in flight, and save() then reads st.root.
  let release;
  const gate = new Promise((r) => { release = r; });
  const rejections = [];
  const onRejection = (e) => rejections.push(e);
  process.on('unhandledRejection', onRejection);
  const c = mountCtl({ update: async (k, b) => { await gate; return ok({ meta: b.meta, warnings: [] }); } });
  await c.ctl.route('runTests');
  await flush();
  c.host.querySelector('[data-field="meta:displayName"]').value = 'Renamed';
  c.host.querySelector('.script-save').click();
  await flush();
  c.ctl.destroy();
  release();
  await flush(8);
  process.off('unhandledRejection', onRejection);
  assert.deepEqual(rejections.map((e) => e && e.message), []);
  c.host.remove();
});

test('leaving while the Test tab`s lazy /api/projects read is in flight throws nothing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const rejections = [];
  const onRejection = (e) => rejections.push(e);
  process.on('unhandledRejection', onRejection);
  const c = mountCtl({ projects: async () => { await gate; return ok({ projects: [] }); } });
  await c.ctl.route('runTests/test');
  await flush(2);
  c.ctl.destroy();
  release();
  await flush(8);
  process.off('unhandledRejection', onRejection);
  assert.deepEqual(rejections.map((e) => e && e.message), []);
  c.host.remove();
});

test('renderScriptDetail with no highlighter ESCAPES the program: nothing reaches innerHTML raw', async () => {
  const nasty = '<img src=x onerror="window.__pwned=1">\n';
  const root = renderScriptDetail({ ...USER, source: nasty }, { doc, tab: 'source', runtimes: RUNTIMES });
  await flush();
  assert.equal(root.querySelectorAll('.code-editor code img').length, 0, 'the default highlighter escapes (C11)');
  assert.equal(root.querySelector('.code-editor code').textContent, `${nasty}\n`);
  dispose(root);
});

test('a cleared Timeout or Order box falls back to the default, not to zero', async () => {
  const root = render(USER);
  await flush();
  root.querySelector('[data-field="meta:timeoutSec"]').value = '';
  root.querySelector('[data-field="meta:order"]').value = '';
  const meta = collectScriptDraft(root).meta;
  assert.equal(meta.timeoutMs, 600000, 'not the 1 s MIN_TIMEOUT_MS floor a Number("") === 0 lands on');
  assert.equal(meta.order, 50);
  dispose(root);
});

test('a change inside the Test tab`s own port editor never repaints the page: the bench keeps its Setup', async () => {
  const CFG_META = { ...USER_META, key: 'cfg', displayName: 'Cfg', ports: 'config', inputs: undefined, outputs: undefined,
    defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }],
      outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'cfg-cycle{cycle}.md' }] } };
  const CFG = { meta: CFG_META, source: USER.source, sourceWin32: null, sourcePath: '/home/u/.worca-cc/scripts/cfg.mjs',
    sourceTruncated: false, cases: [], userCases: [], casesWritable: true };
  const m = mountCtl({ read: async () => ok(CFG), projects: async () => ok({ projects: [] }) });
  await m.ctl.route('cfg/test');
  await flush(8);
  const bench = m.host.querySelector('.bench');
  const type = bench.querySelector('.bench-setup [data-field="port:outputs:0:type"]');
  type.value = 'json';
  type.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush(4);
  assert.equal(m.host.querySelector('.bench'), bench, 'the SAME bench tree: a structural repaint of the page would have remounted it');
  assert.equal(m.ctl.isDirty(), false, 'and the sidecar`s own ports were not touched');
  m.cleanup();
});

test('the Test tab of a ports:"config" script does not make the page dirty: the draft reads the Overview editor alone', async () => {
  // The bench mounts a SECOND port editor for a `ports: "config"` script, so an
  // unscoped collectPorts(root) would count every row twice — the page would read
  // as dirty the moment the Test tab opened, every Run would go out as a draft
  // (refused outright on a built-in) and leaving would always ask to discard.
  const CFG_META = { ...USER_META, key: 'shell', displayName: 'Shell', origin: 'builtin', ports: 'config',
    inputs: undefined, outputs: undefined,
    defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }],
      outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' }] } };
  const CFG = { meta: CFG_META, source: '', sourceWin32: null, sourcePath: '/repo/scripts/shell',
    sourceTruncated: false, cases: [], userCases: [], casesWritable: true };
  const m = mountCtl({ read: async () => ok(CFG), projects: async () => ok({ projects: [] }) });
  await m.ctl.route('shell/test');
  await flush(8);
  assert.ok(m.host.querySelector('.bench .bench-setup .ins-port-editor'), 'the bench mounted its own port editor');
  assert.equal(m.ctl.isDirty(), false, 'opening the Test tab is not an edit');
  const draft = collectScriptDraft(m.host.querySelector('.script-detail'));
  assert.deepEqual(draft.meta.defaultPorts.inputs.map((p) => p.id), ['in'], 'the sidecar keeps ONE `in` port');
  assert.deepEqual(draft.meta.defaultPorts.outputs.map((p) => p.id), ['log']);
  m.cleanup();
});

test('a shell script created from #scripts/new saves: the exit-code boxes are never both 0', async () => {
  // `Number('')` is a finite 0, so an ABSENT exit-code box read back as [0]. The
  // runtime switch collects the draft off the node form (no such boxes), so the
  // shell page was painted with 0 clean AND 0 blocking and the validator refused
  // every Save of a script the page had just offered.
  const c = mountCtl();
  await c.ctl.route('new');
  await flush();
  const rt = c.host.querySelector('[data-field="meta:runtime"]');
  rt.value = 'shell';
  rt.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  assert.equal(c.host.querySelector('[data-field="meta:exitCodesClean"]').value, '0');
  assert.equal(c.host.querySelector('[data-field="meta:exitCodesBlocking"]').value, '1', 'blocking defaults to 1, not to the clean code');
  c.host.querySelector('[data-field="meta:key"]').value = 'fresh';
  const draft = collectScriptDraft(c.host.querySelector('.script-detail'));
  assert.deepEqual(draft.meta.exitCodes, { clean: [0], blocking: [1] });
  c.cleanup();
});

test('clearing an exit-code box empties that list; clearing both removes the key', async () => {
  const SH = { ...SHELL, meta: { ...SHELL_META, exitCodes: { clean: [0], blocking: [1, 2] } } };
  const root = render(SH);
  await flush();
  root.querySelector('[data-field="meta:exitCodesBlocking"]').value = '';
  assert.deepEqual(collectScriptDraft(root).meta.exitCodes, { clean: [0], blocking: [] },
    'a cleared box is an empty list, never [0]');
  root.querySelector('[data-field="meta:exitCodesClean"]').value = '';
  assert.equal(collectScriptDraft(root).meta.exitCodes, null, 'both cleared = remove the key (the store reads null as "remove")');
  dispose(root);
});

// `st.data` is refreshed by route() and by the STRUCTURAL repaints only, and the
// bench is mounted FROM it — but a port id, a param id, `required`, `when`,
// `filename` and a param default are plain keystrokes, and a successful Save does
// not repaint either. "+ input" mints the id `in`, so renaming it is what nearly
// every author does next: the Test tab then showed the declaration as it was at
// the last structural repaint while the run went out against the new one.
const PORTED = { ...USER, meta: { ...USER_META, inputs: [{ id: 'in', type: 'md', required: false }] } };

test('the Test tab follows a renamed port id: the row, and the request it binds', async () => {
  const sent = [];
  const c = mountCtl({ read: async () => ok(PORTED), projects: async () => ok({ projects: [] }),
    bench: async (r) => { sent.push(r); return ok({ benchId: 'b1' }); } });
  await c.ctl.route('runTests');
  await flush();
  const id = c.host.querySelector('[data-field="port:inputs:0:id"]');
  id.value = 'plan';
  id.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(c.ctl.isDirty(), true);
  await c.ctl.route('runTests/test');
  await flush(8);
  assert.deepEqual([...c.host.querySelectorAll('.bench-port')].map((p) => p.dataset.port), ['plan'],
    'the Inputs row carries the id that is ON SCREEN, not the one the page was loaded with');
  c.host.querySelector('[data-field="in:plan:bound"]').checked = true;
  c.host.querySelector('[data-field="in:plan:text"]').value = '# body';
  c.host.querySelector('.bench-run').click();
  await flush(6);
  assert.deepEqual(Object.keys(sent[0].inputs), ['plan'],
    'the bench request binds the renamed port — `in` is refused by the engine as "not a declared input port"');
  c.cleanup();
});

test('the Test tab follows a renamed param id too', async () => {
  const sent = [];
  const c = mountCtl({ read: async () => ok(PORTED), projects: async () => ok({ projects: [] }),
    bench: async (r) => { sent.push(r); return ok({ benchId: 'b1' }); } });
  await c.ctl.route('runTests/test');
  await flush(8);
  const pid = c.host.querySelector('[data-field="pdef:0:id"]');
  pid.value = 'speed';
  pid.dispatchEvent(new win.Event('input', { bubbles: true }));
  await c.ctl.route('runTests');           // a tab hop is not a reload: the draft is the page
  await flush();
  await c.ctl.route('runTests/test');
  await flush(8);
  assert.ok(c.host.querySelector('.bench-setup [data-field="param:speed"]'),
    'the Setup column shows the param the Overview tab declares now');
  c.host.querySelector('.bench-run').click();
  await flush(6);
  assert.deepEqual(Object.keys(sent[0].params), ['speed'],
    '…and sends it: the old id fails with "sets unknown param"');
  c.cleanup();
});

test('a successful Save refreshes the Test tab: the saved declaration is what the bench renders', async () => {
  const sent = [];
  const c = mountCtl({ read: async () => ok(PORTED), projects: async () => ok({ projects: [] }),
    bench: async (r) => { sent.push(r); return ok({ benchId: 'b1' }); } });
  await c.ctl.route('runTests/test');
  await flush(8);
  assert.deepEqual([...c.host.querySelectorAll('.bench-port')].map((p) => p.dataset.port), ['in']);
  // The Overview pane is hidden behind the Test tab, but its fields are the page.
  const id = c.host.querySelector('[data-field="port:inputs:0:id"]');
  id.value = 'plan';
  id.dispatchEvent(new win.Event('input', { bubbles: true }));
  c.host.querySelector('.script-save').click();
  await flush(10);
  assert.equal(c.msgEl.textContent, 'Saved "runTests".');
  assert.equal(c.ctl.isDirty(), false);
  assert.deepEqual([...c.host.querySelectorAll('.bench-port')].map((p) => p.dataset.port), ['plan'],
    'a save does not repaint the page, so the bench kept the old declaration until the script was re-opened');
  c.host.querySelector('[data-field="in:plan:bound"]').checked = true;
  c.host.querySelector('[data-field="in:plan:text"]').value = '# body';
  c.host.querySelector('.bench-run').click();
  await flush(6);
  assert.deepEqual(Object.keys(sent[0].inputs), ['plan']);
  assert.equal(sent[0].draft, null, 'the page is clean again, so the SAVED script runs');
  c.cleanup();
});

test('…and a Save that changes nothing the bench renders leaves it alone: the Setup, the result and a live run', async () => {
  // The W10 loop the plan describes: edit the program, run the draft, watch it pass,
  // press Save. A Save that REBUILDS the Test tab throws that away — `destroy()` POSTs
  // `bench/stop` for an in-flight run and `replaceChildren` wipes the selected case,
  // the typed inputs, the Expect row and the result pane (back to `idle`) — the exact
  // state C32/C34 exist to protect, for a refresh nothing on screen can need: the bench
  // is mounted only while the Test tab is up, and the Overview and Source panes are
  // `display:none` behind it, so no keyboard, autofill or find-in-page path reaches a
  // `meta:*` / `pdef:*` field, and the Setup column's own controls are named
  // `param:` / `in:` / `expect:`.
  const stops = [];
  const sent = [];
  const c = mountCtl({ read: async () => ok(PORTED), projects: async () => ok({ projects: [] }),
    bench: async (r) => { sent.push(r); return ok({ benchId: 'b1' }); },
    benchStop: async (id) => { stops.push(id); return ok({ ok: true }); } });
  await c.ctl.route('runTests/source');
  await flush();
  const src = c.host.querySelector('[data-field="script:source"]');
  src.value = '// v2\n';
  src.dispatchEvent(new win.Event('input', { bubbles: true }));
  await c.ctl.route('runTests/test');
  await flush(8);
  // Thirty minutes of hand-work in the Setup column.
  c.host.querySelector('[data-field="in:in:bound"]').checked = true;
  const box = c.host.querySelector('[data-field="in:in:text"]');
  box.value = '# hand-written fixture';
  box.dispatchEvent(new win.Event('input', { bubbles: true }));
  const verdict = c.host.querySelector('[data-field="expect:verdict"]');
  verdict.value = 'clean';
  verdict.dispatchEvent(new win.Event('change', { bubbles: true }));
  c.host.querySelector('[data-field="bench:caseName"]').value = 'edge case';
  c.host.querySelector('.bench-run').click();
  await flush(6);
  assert.equal(sent[0].draft.source, '// v2\n', 'the unsaved program ran (W10)');
  c.ctl.onFrame({ type: 'scriptbench-done', benchId: 'b1', seq: 1, result: {
    status: 'clean', exitCode: 0, runtime: 'node', durationMs: 20, summary: 'ran in the bench', warnings: [],
    fired: ['log'], outputs: {}, verdict: null, envelopePath: '/b/envelope.json', error: null, expect: null,
    draft: true, benchDir: '/b' } });
  await flush(6);
  assert.equal(c.host.querySelector('.bench-status-text').textContent, 'clean');

  c.host.querySelector('.script-save').click();
  await flush(10);
  assert.equal(c.msgEl.textContent, 'Saved "runTests".');
  assert.equal(c.host.querySelector('[data-field="in:in:bound"]').checked, true, 'the port is still bound');
  assert.equal(c.host.querySelector('[data-field="in:in:text"]').value, '# hand-written fixture');
  assert.equal(c.host.querySelector('[data-field="expect:verdict"]').value, 'clean', 'the Expect row survived');
  assert.equal(c.host.querySelector('[data-field="bench:caseName"]').value, 'edge case');
  assert.equal(c.host.querySelector('.bench-status-text').textContent, 'clean', 'the result is still on screen');
  assert.deepEqual(stops, [], 'a Save must never stop the run the user is watching');
  c.cleanup();
});

test('typing a verdict filename unlocks every output`s `when` select, and clearing it locks them again', async () => {
  // renderPortEditor disables `when` while the sidecar has no verdict, and
  // meta:verdictFilename is not structural — so the tooltip went on naming a
  // condition the author had met and SAVED. Declaring the port and then the
  // verdict is the natural order, and a conditional output is the whole point
  // of a gate script.
  const noVerdict = { ...USER, meta: { ...USER_META, verdict: undefined,
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'l-cycle{cycle}.md' }] } };
  const c = mountCtl({ read: async () => ok(noVerdict) });
  await c.ctl.route('runTests');
  await flush();
  const when = () => c.host.querySelector('[data-field="port:outputs:0:when"]');
  assert.equal(when().disabled, true);
  assert.equal(when().closest('.ins-f').title, 'needs a sidecar verdict');
  const type = (value) => {
    const box = c.host.querySelector('[data-field="meta:verdictFilename"]');
    box.value = value;
    box.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  type('tests-cycle{cycle}.json');
  await flush();
  assert.equal(when().disabled, false, 'the condition the tooltip named has been met');
  assert.equal(when().closest('.ins-f').title, '');
  assert.equal(c.ctl.isDirty(), true, 'the repaint is not a rebase: the page is still unsaved');
  assert.equal(c.host.querySelector('[data-field="meta:verdictFilename"]').value, 'tests-cycle{cycle}.json');
  type('');
  await flush();
  assert.equal(when().disabled, true, 'clearing the verdict locks `when` again');
  c.cleanup();
});
