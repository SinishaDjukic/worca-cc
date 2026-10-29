// test/ui-workflow-example-project.test.mjs — workflow tests 3a: Edit an example that works on a project (canvas boards 32,
// 33 and 39): where it starts, the start point, the moved-on note, the uncommitted changes, the setup, the command check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderExampleEditor, openCheckDialog } from '../ui/public/workflows/example-editor.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((b) => b.textContent === text);
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const SHA = 'abc1234def5678abc1234def5678abc1234def56';
const PROJECTS = [
  { key: 'worca-cc-1a2b3c4d', name: 'worca-cc', path: '/code/worca-cc', exists: true, vcs: 'git',
    current: { branch: 'main', sha: SHA, short: 'abc1234', at: '2026-10-28T09:00:00.000Z' }, setupCmd: 'npm ci' },
  { key: 'docs-site-1a2b3c4e', name: 'docs-site', path: '/code/docs', exists: true, vcs: 'none', current: null, setupCmd: null },
  { key: 'gone-1a2b3c4f', name: 'gone', path: '/code/gone', exists: false, vcs: 'git', current: null, setupCmd: null },
];
const PIN = { key: 'worca-cc-1a2b3c4d', startSha: SHA, startRef: 'main', startAt: '2026-10-28T09:00:00.000Z', startCommit: SHA,
  changesSha256: null, changesBytes: 0, setupCmd: 'npm ci' };
const example = (over = {}) => ({ id: 7, name: 'Ticket 482, invoice totals round wrong', request: 'Ticket 482: invoice totals round wrong.', answers: [],
  otherwise: 'pick', basics: { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null },
  checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10 }], tries: 3, files: [], note: null, project: PIN, ...over });
function boot(ex = example(), { needsProject = false, projectView = { state: 'ok', behind: 14, startRef: 'main' }, over = {} } = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const actions = {
    back: () => {}, save: async (v) => { calls.push(['save', v]); return { ok: true }; }, tryOnce: async () => ({ ok: true }),
    addFiles: async () => ({ ok: true }), removeFile: async () => ({ ok: true }),
    branches: async (key) => { calls.push(['branches', key]); return { ok: true, data: { branches: [
      { name: 'main', sha: SHA, short: 'abc1234', at: '2026-10-28T09:00:00.000Z', current: true },
      { name: 'release', sha: 'e9f2c47'.padEnd(40, '0'), short: 'e9f2c47', at: '2026-10-20T09:00:00.000Z', current: false }] } }; },
    startLatest: async () => { calls.push(['latest']); return { ok: true, example: { ...ex, project: { ...PIN, startSha: 'f'.repeat(40), startCommit: 'f'.repeat(40) } } }; },
    ...over,
  };
  const root = window.document.getElementById('root');
  const ed = renderExampleEditor(root, ex, actions, { doc: window.document, win: window, scripts: [], perTryUsd: 0.95, draftLabel: 'v3 draft',
    projects: PROJECTS, needsProject, workflowName: 'Fix a bug from a ticket', projectView, dateText: () => '28 Oct' });
  return { root, doc: window.document, win: window, calls, ed };
}

test('board 32: where it starts, the start point, the moved-on note, the changes box and the setup', () => {
  const { root } = boot();
  assert.equal(root.querySelector('.wft-c1 > .hint').textContent, 'The same request and the same starting point are used every time this example is tried.');
  assert.deepEqual(texts(root, '.wft-where > .wft-grp, .wft-where > .wft-grp-hint'), ['Where it starts',
    "Each try works in Worca's own copy of the project. Your folder and your branches are never touched."]);
  const sel = root.querySelector('#wft-ex-project');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['No project', 'worca-cc', 'docs-site', 'gone']);
  assert.equal(sel.value, 'worca-cc-1a2b3c4d');
  assert.equal(root.querySelector('.wft-start > span').textContent, 'main at abc1234 · 28 Oct');
  assert.equal(root.querySelector('.wft-start .code').textContent, 'abc1234');
  assert.ok(byText(root, '.wft-start button', 'Change'));
  assert.ok(texts(root, '.wft-start-field > .hint').includes('Both versions start from here. It stays the same until you change it, so results can be compared.'));
  assert.equal(root.querySelector('.wft-moved').getAttribute('role'), 'note');
  assert.equal(root.querySelector('.wft-moved-top > span:not(.ic)').textContent, 'The project has moved on: 14 newer commits on main since this start point.');
  assert.ok(byText(root, '.wft-moved button', 'Start from the latest'));
  assert.equal(root.querySelector('.wft-moved-act .hint').textContent, 'Both versions are then tried again from the new point, so their results stay comparable.');
  assert.equal(root.querySelector('.wft-uncommitted span').textContent, 'Include my changes that are not committed yet');
  assert.equal(root.querySelector('.wft-changes-hint').textContent, 'Off: the example starts from the commit only. On: your changes are saved with the example.');
  assert.equal(root.querySelector('.wft-dev-cap').textContent, 'For developers');
  assert.equal(root.querySelector('label[for="wft-ex-setup"]').textContent, 'Before each try, run');
  assert.equal(root.querySelector('#wft-ex-setup').value, 'npm ci');
  assert.equal(root.querySelector('.wft-dev .hint').textContent, "Filled in from the project's setup. If it fails, the test stops and no try counts as failed.");
  assert.equal(root.querySelector('.wft-c3 .wft-grp-hint').textContent, "Counted exactly, without AI. They look at what changed in Worca's own copy of the project.");
  const line = root.querySelector('.wft-c3 .wft-line-text');
  assert.equal(line.textContent, 'The command npm test passes');
  assert.equal(line.querySelector('.code').textContent, 'npm test');
});

test('the value: the project and its setup; the changes box; a new start point from Change (P2, P3)', async () => {
  const { root, doc, ed, calls } = boot();
  assert.deepEqual(ed.value().project, { key: 'worca-cc-1a2b3c4d', setupCmd: 'npm ci', includeChanges: false });
  root.querySelector('.wft-changes-box').checked = true;
  assert.equal(ed.value().project.includeChanges, true);
  click(byText(root, '.wft-start button', 'Change'));
  await tick(); await tick();
  assert.deepEqual(calls.find((c) => c[0] === 'branches'), ['branches', 'worca-cc-1a2b3c4d']);
  assert.equal(doc.querySelector('.mk-dialog-title').textContent, 'Start point');
  assert.equal(doc.querySelector('.mk-dialog-body > .hint').textContent, 'Pick the branch this example starts from. Worca takes its newest commit.');
  doc.querySelector('input[name="wft-start-ref"][value="release"]').checked = true;
  click(byText(doc, '.mk-dialog button', 'Use this start point'));
  await tick();
  assert.deepEqual(ed.value().project, { key: 'worca-cc-1a2b3c4d', setupCmd: 'npm ci', ref: 'release', repin: true });
  assert.equal(root.querySelector('.wft-start > span').textContent, 'release at e9f2c47 · 28 Oct');
  assert.equal(root.querySelector('.wft-uncommitted').hidden, true, 'not the branch the folder is on: no changes box');
  assert.equal(root.querySelector('.wft-moved'), null, 'a new start point is not behind');
  const sel = root.querySelector('#wft-ex-project');
  sel.value = ''; sel.dispatchEvent(new doc.defaultView.Event('change'));
  assert.equal(ed.value().project, null, 'No project');
  assert.equal(root.querySelector('.wft-dev').hidden, true);
  assert.equal(root.querySelector('.wft-c1 > .hint').textContent, 'The same request and files are used every time this example is tried.', 'no project: Part 2 words');
  assert.equal(root.querySelector('.wft-c3 .wft-grp-hint').textContent, 'Counted exactly, without AI. Pick a ready check, or a script from the Library.');
});

test('Start from the latest moves the start point and the note goes', async () => {
  const { root, calls } = boot();
  click(byText(root, '.wft-moved button', 'Start from the latest'));
  await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['latest']);
  assert.equal(root.querySelector('.wft-moved'), null);
  assert.equal(root.querySelector('.wft-start .code').textContent, 'fffffff');
});

test('a drift counted for an older pin is not shown (the pin moved since the overview was read)', () => {
  const { root } = boot(example(), { projectView: { state: 'ok', behind: 14, startRef: 'main', startSha: 'e'.repeat(40) } });
  assert.equal(root.querySelector('.wft-moved'), null);
});

test('board 39: no project picked for a workflow that changes a project; a missing folder; a Folder project', () => {
  const none = boot(example({ project: null, checks: [] }), { needsProject: true, projectView: null });
  assert.equal(none.root.querySelector('#wft-ex-project').options[0].textContent, 'Pick a project');
  assert.deepEqual(texts(none.root, '.wft-notice > p'), ['Pick the project this example works on',
    "Fix a bug from a ticket changes a project's code, so each example needs one. Each try works in Worca's own copy of the project."]);
  assert.equal(byText(none.root, '.wft-acts button', 'Try it once now').disabled, true);
  const sel = none.root.querySelector('#wft-ex-project');
  sel.value = 'gone-1a2b3c4f'; sel.dispatchEvent(new none.doc.defaultView.Event('change'));
  assert.deepEqual(texts(none.root, '.wft-notice > p'), ['The project folder is missing',
    "Worca can't find gone in /code/gone. Move the folder back, or pick where it is now. The start point is kept."]);
  click(byText(none.root, '.wft-notice button', 'Pick the folder'));
  assert.equal(none.doc.activeElement, sel, 'P4: the folder is picked in the Project select');
  assert.equal(none.root.querySelector('.wft-notice .code').textContent, '/code/gone', 'board 39: the folder in code');
  assert.equal(none.root.querySelector('.wft-start-field').hidden, true);
  sel.value = 'docs-site-1a2b3c4e'; sel.dispatchEvent(new none.doc.defaultView.Event('change'));
  assert.deepEqual(texts(none.root, '.wft-notice > p'), ["Folder projects can't be tested yet",
    'docs-site is a Folder project. Worca can test examples on Git projects for now. Pick a Git project.']);
});

test('board 33: the project checks, the command, read from a file; without a project the Part 2 dialog', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const saved = [];
  openCheckDialog({ doc, win: window, scripts: [], project: true, onSave: (c) => saved.push(c) });
  assert.equal(doc.querySelector('.mk-dialog-body > .hint').textContent, "Counted exactly, without AI. Project checks look at what a try changed in Worca's own copy of the project.");
  const kind = doc.querySelector('#wft-ck-kind');
  assert.deepEqual([...kind.querySelectorAll('optgroup')].map((g) => g.label), ['The result', 'The project']);
  assert.ok([...kind.options].some((o) => o.textContent === 'A file with this name is added or changed'));
  kind.value = 'command'; kind.dispatchEvent(new window.Event('change'));
  assert.equal(doc.querySelector('label[for="wft-ck-cmd"]').textContent, 'Command');
  assert.equal(doc.querySelector('#wft-ck-cmd').closest('.field').querySelector('.hint').textContent,
    'It runs in Worca\'s own copy of the project after the try is done. Met when the command ends without an error. Worca shows its last summary line, for example "212 passed, 1 failed".');
  const time = doc.querySelector('#wft-ck-timeout');
  assert.deepEqual([...time.options].map((o) => o.textContent), ['1 minute', '5 minutes', '10 minutes', '30 minutes']);
  assert.equal(time.value, '10');
  assert.equal(doc.querySelector('label[for="wft-ck-timeout"]').textContent, 'Stop the command after');
  assert.equal(time.closest('.field').querySelector('.hint').textContent, 'A command that runs longer counts as not met.');
  const cmd = doc.querySelector('#wft-ck-cmd');
  cmd.value = 'npm test'; cmd.dispatchEvent(new window.Event('input'));
  assert.equal(doc.querySelector('.wft-ck-preview').textContent, 'The command npm test passes');
  assert.equal(doc.querySelector('.wft-ck-preview .code').textContent, 'npm test', 'board 33: the command in code');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.deepEqual(saved, [{ kind: 'command', cmd: 'npm test', timeoutMin: 10 }]);
  openCheckDialog({ doc, win: window, scripts: [], project: true, onSave: (c) => saved.push(c) });
  const k2 = [...doc.querySelectorAll('#wft-ck-kind')].at(-1);
  k2.value = 'sections'; k2.dispatchEvent(new window.Event('change'));
  assert.equal([...doc.querySelectorAll('.wft-rads legend')].at(-1).textContent, 'Read from');
  assert.deepEqual([...doc.querySelectorAll('.wft-rads')].at(-1).querySelectorAll('.wft-rad').length, 2);
  assert.equal([...doc.querySelectorAll('.wft-rad')].at(-2).textContent, 'The final result · what the workflow says at the end');
  assert.equal([...doc.querySelectorAll('.wft-rad')].at(-1).textContent, 'A file in the project');
  [...doc.querySelectorAll('#wft-ck-names')].at(-1).value = 'Fixed';
  [...doc.querySelectorAll('input[name="wft-ck-from"][value="file"]')].at(-1).checked = true;
  const f = [...doc.querySelectorAll('#wft-ck-from-file')].at(-1);
  f.value = 'CHANGELOG.md'; f.dispatchEvent(new window.Event('input'));
  assert.equal([...doc.querySelectorAll('.wft-ck-preview')].at(-1).textContent, 'Has the section Fixed in CHANGELOG.md');
  openCheckDialog({ doc, win: window, scripts: [], project: false, onSave: () => {} });
  const k3 = [...doc.querySelectorAll('#wft-ck-kind')].at(-1);
  assert.equal(k3.querySelectorAll('optgroup').length, 0);
  assert.ok(![...k3.options].some((o) => o.value === 'command'), 'no command without a project');
});
