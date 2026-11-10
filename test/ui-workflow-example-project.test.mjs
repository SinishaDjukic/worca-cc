// test/ui-workflow-example-project.test.mjs — workflow tests 3a: Edit an example that works on a project (canvas boards 32,
// 33 and 39): where it starts, the start point, the moved-on note, the uncommitted changes, the setup, the command check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderExampleEditor, openCheckDialog, openStartDialog } from '../ui/public/workflows/example-editor.mjs';

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
function boot(ex = example(), { needsProject = false, projectView = { state: 'ok', behind: 14, startRef: 'main' }, over = {}, projects = PROJECTS, ctx = {} } = {}) {
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
    projects, needsProject, workflowName: 'Fix a bug from a ticket', projectView, dateText: () => '28 Oct', ...ctx });
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

// U-T9 fix round 1 (review Important 2): the store refuses a new pin while a test tries the example (BUSY), so
// "Save and stop" stops the test first and saves after.
test('F17: a project, start point or setup change asks, and "Save and stop" stops the test before it saves', async () => {
  const changes = {
    project: (r) => { const s = r.querySelector('#wft-ex-project'); s.value = ''; s.dispatchEvent(new s.ownerDocument.defaultView.Event('change')); },
    setup: (r) => { const s = r.querySelector('.wft-dev textarea, .wft-dev input'); s.value = 'npm install'; s.dispatchEvent(new s.ownerDocument.defaultView.Event('input')); },
  };
  for (const [what, change] of Object.entries(changes)) {
    const asked = [];
    const stop = [];
    const { root, calls } = boot(example(), { over: { stopTest: async () => { calls.push(['stopTest']); stop.push(what); return { ok: true }; } },
      ctx: { testRunning: true, runningExampleIds: [7], confirm: async (o) => { asked.push(o.title); return true; } } });
    change(root);
    click(byText(root, '.wft-acts button', 'Save example'));
    for (let i = 0; i < 5; i += 1) await tick();
    assert.deepEqual(asked, ['Save and stop the test?'], `${what}: asked`);
    assert.deepEqual(calls.map((c) => c[0]), ['stopTest', 'save'], `${what}: stopped, then saved`);
  }
});

test('F17: Start from the latest while a test tries the example: the refusal says what to do, in plain words', async () => {
  const { root, calls } = boot(example(), { over: {
    startLatest: async () => { calls.push(['latest']); return { ok: false, status: 409, error: 'A test is trying this example: stop it first.' }; } } });
  click(byText(root, '.wft-moved button', 'Start from the latest'));
  await tick(); await tick();
  assert.deepEqual(calls, [['latest']], 'the server decides (its refusal stays the safety net)');
  assert.equal(root.querySelector('.wft-error').textContent, 'A test is trying this example. Stop it first, then start from the latest.');
  assert.ok(root.querySelector('.wft-moved'), 'the start point did not move');
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
  assert.equal(byText(none.root, '.wft-acts button', 'Try your draft once now').disabled, true);
  const sel = none.root.querySelector('#wft-ex-project');
  sel.value = 'gone-1a2b3c4f'; sel.dispatchEvent(new none.doc.defaultView.Event('change'));
  assert.deepEqual(texts(none.root, '.wft-notice > p'), ['The project folder is missing',
    "Worca can't find gone in /code/gone. Move the folder back, or pick where it is now. The start point is kept.",
    'If the folder moved, add it again under Projects, then pick it here.']);   // P19
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
    'It runs in Worca\'s own copy of the project after the try is done. Worca shows its last summary line, for example "212 passed, 1 failed".');
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

// ── Task 10 review ──────────────────────────────────────────────────────────────────────────────────────────────────

test('review 2: the setup is sent only while "For developers" shows; cleared it is \'\'; the kept setup fills the box', () => {
  const { root, doc, ed } = boot();
  const setup = root.querySelector('#wft-ex-setup');
  setup.value = '  '; setup.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(ed.value().project.setupCmd, '', "cleared: '' (no setup), never null (keep)");
  const cleared = boot(example({ project: { ...PIN, setupCmd: null } }));
  assert.equal(cleared.root.querySelector('#wft-ex-setup').value, '', "a kept pin with no setup stays empty, not the project's own");
  const away = boot(example({ project: { ...PIN, key: 'gone-1a2b3c4f' } }));
  assert.deepEqual(away.ed.value().project, { key: 'gone-1a2b3c4f' }, 'no box shown: the setup is left out (kept)');
});

test('review 3, 12: Change is busy while it loads; a pick says the new start and keeps the focus on Change', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { root, doc } = boot(example(), { over: { branches: async () => { await gate; return { ok: true, data: { branches: [
    { name: 'main', sha: SHA, short: 'abc1234', at: '2026-10-28T09:00:00.000Z', current: true },
    { name: 'release', sha: 'e9f2c47'.padEnd(40, '0'), short: 'e9f2c47', at: '2026-10-20T09:00:00.000Z', current: false }] } }; } } });
  const change = byText(root, '.wft-start button', 'Change');
  assert.equal(change.dataset.focusKey, 'wft-start-change');
  assert.equal(byText(root, '.wft-moved button', 'Start from the latest').dataset.focusKey, 'wft-start-latest');
  click(change);
  assert.deepEqual([change.disabled, change.getAttribute('aria-busy')], [true, 'true'], 'busy while the branches load');
  release();
  await tick(); await tick();
  assert.equal(change.getAttribute('aria-busy'), null);
  doc.querySelector('input[name="wft-start-ref"][value="release"]').checked = true;
  click(byText(doc, '.mk-dialog button', 'Use this start point'));
  await tick(); await tick();
  const status = root.querySelector('.wft-start-status');
  assert.deepEqual([status.getAttribute('role'), status.getAttribute('aria-live'), status.textContent],
    ['status', 'polite', 'The start point will be release at e9f2c47 when you save the example.']);
  assert.equal(doc.activeElement, byText(root, '.wft-start button', 'Change'));
});

test('review 3, 12, 14: Start from the latest is busy, then says the new start; LFS refusal shows the notice only', async () => {
  const { root, doc } = boot();
  const latestBtn = byText(root, '.wft-moved button', 'Start from the latest');
  click(latestBtn);
  assert.deepEqual([latestBtn.disabled, latestBtn.getAttribute('aria-busy')], [true, 'true']);
  await tick(); await tick();
  assert.equal(root.querySelector('.wft-start-status').textContent, 'Saved: the start point is now main · 28 Oct.');
  assert.equal(doc.activeElement, byText(root, '.wft-start button', 'Change'));
  const lfs = "worca-cc keeps large files with Git LFS. Worca's own copy of the project would not have them, so tries could go wrong.";
  const subs = "worca-cc holds other projects inside it (submodules). Worca's own copy of the project would not have them, so tries could go wrong.";
  const refused = boot(example(), { over: { startLatest: async () => ({ ok: false, error: subs }), save: async () => ({ ok: false, error: lfs }) } });
  click(byText(refused.root, '.wft-moved button', 'Start from the latest'));
  await tick(); await tick();
  assert.deepEqual(texts(refused.root, '.wft-notice > p'), ["This project can't be tested yet", subs]);
  assert.equal(refused.root.querySelector('.wft-error').textContent, '', 'the notice only, not also the error line');
  click(byText(refused.root, '.wft-acts button', 'Save example'));
  await tick(); await tick();
  assert.deepEqual(texts(refused.root, '.wft-notice > p'), ["This project can't be tested yet", lfs]);
  assert.equal(refused.root.querySelector('.wft-error').textContent, '');
});

test('review 9, 13, 15: server words as sentences; no branches, no dialog; the fallbacks', async () => {
  const raw = boot(example(), { over: { save: async () => ({ ok: false, error: 'the request is too long' }), branches: async () => ({ ok: true, data: { branches: [] } }) } });
  click(byText(raw.root, '.wft-acts button', 'Save example'));
  await tick(); await tick();
  assert.equal(raw.root.querySelector('.wft-error').textContent, 'The request is too long.');
  click(byText(raw.root, '.wft-start button', 'Change'));
  await tick(); await tick();
  assert.equal(raw.root.querySelector('.wft-error').textContent, 'Worca found no branches in this project.');
  assert.equal(raw.doc.querySelector('.mk-dialog'), null, 'no dialog with nothing to pick');
  const down = boot(example(), { over: { branches: async () => ({ ok: false }), startLatest: async () => ({ ok: false }) } });
  click(byText(down.root, '.wft-start button', 'Change'));
  await tick(); await tick();
  assert.equal(down.root.querySelector('.wft-error').textContent, 'Worca could not read the branches of the project.');
  click(byText(down.root, '.wft-moved button', 'Start from the latest'));
  await tick(); await tick();
  assert.equal(down.root.querySelector('.wft-error').textContent, 'The start point did not move.');
  const { window } = new JSDOM('<!doctype html><body></body>');
  openStartDialog({ doc: window.document, win: window, branches: [{ name: 'main', short: 'abc1234', at: 'x' }], current: null, onPick: () => {} });
  click(byText(window.document, '.mk-dialog button', 'Use this start point'));
  await tick();
  assert.equal(window.document.querySelector('.wft-dlg-error').textContent, 'Pick a branch first.');
});

test('review 5, 6, 7, 10: no longer registered, projects not read, not on a branch; a blocked Try points at the notice', () => {
  const ok = boot();
  const okTry = byText(ok.root, '.wft-acts button', 'Try your draft once now');
  assert.deepEqual([okTry.disabled, okTry.getAttribute('aria-describedby')], [false, null]);
  assert.equal(ok.root.querySelector('.wft-notice').getAttribute('aria-live'), 'polite');
  const gone = boot(example({ project: { ...PIN, key: 'old-00000000', name: 'billing' } }));
  assert.deepEqual(texts(gone.root, '.wft-notice > p'), ["billing is no longer one of Worca's projects. Add it again under Projects, or pick another project."]);
  const goneTry = byText(gone.root, '.wft-acts button', 'Try your draft once now');
  assert.deepEqual([goneTry.disabled, goneTry.getAttribute('aria-describedby')], [true, 'wft-ex-notice']);
  assert.equal(gone.root.querySelector('#wft-ex-project').selectedOptions[0].textContent, 'billing', 'its name, never the key');
  const unread = boot(example(), { projects: null });
  assert.deepEqual(texts(unread.root, '.wft-notice > p'), ['Worca could not read your projects. Reload the page to try again.']);
  assert.equal(byText(unread.root, '.wft-acts button', 'Try your draft once now').getAttribute('aria-describedby'), 'wft-ex-notice');
  const unreadNoPin = boot(example({ project: null }), { projects: null, projectView: null });
  assert.equal(unreadNoPin.root.querySelector('.wft-notice').hidden, true, 'P21: no project pinned and none needed: nothing to say');
  assert.equal(byText(unreadNoPin.root, '.wft-acts button', 'Try your draft once now').disabled, false);
  const unreadNeeds = boot(example({ project: null }), { projects: null, projectView: null, needsProject: true });
  assert.deepEqual(texts(unreadNeeds.root, '.wft-notice > p'), ['Worca could not read your projects. Reload the page to try again.']);
  assert.equal(byText(unreadNeeds.root, '.wft-acts button', 'Try your draft once now').disabled, true);
  const detached = [{ ...PROJECTS[0], key: 'det-1', name: 'detached', current: { branch: null, sha: SHA, short: 'abc1234', at: '2026-10-28T09:00:00.000Z' } }];
  const det = boot(example({ project: null }), { projects: detached, projectView: null });
  const sel = det.root.querySelector('#wft-ex-project');
  sel.value = 'det-1'; sel.dispatchEvent(new det.doc.defaultView.Event('change'));
  assert.deepEqual(texts(det.root, '.wft-notice > p'), ['The project folder is not on a branch. Check out a branch in it, then come back.']);
  assert.equal(det.root.querySelector('.wft-start-field').hidden, true);
  assert.equal(byText(det.root, '.wft-acts button', 'Try your draft once now').disabled, true);
});

test('board 39: Try it once now with too little free disk shows its card', async () => {
  const GB = 2 ** 30;
  const once = 'One try needs about 0.4 GB free, and this computer has 0.2 GB free. Free up at least 0.2 GB and try again. Nothing was tried and nothing was charged.';
  let n = 0;
  const { root } = boot(example(), { over: { tryOnce: async () => { n += 1; return n === 1
    ? { ok: false, status: 422, error: once, body: { code: 'NO_DISK', disk: { needBytes: 0.4 * GB, freeBytes: 0.2 * GB } } }
    : { ok: false, status: 409, error: 'A test of this workflow is running.' }; } } });
  click(byText(root, '.wft-acts button', 'Try your draft once now'));
  await tick(); await tick();
  const card = root.querySelector('.wft-refusal');
  assert.equal(card.querySelector('h2').textContent, 'Not enough free disk');
  assert.equal(card.querySelector('.wft-est-row').textContent, 'DiskNeeds about 0.4 GB free while it runs · 0.2 GB free');
  assert.equal(card.querySelector('.hint').textContent, once);
  assert.equal(card.querySelector('.hint').getAttribute('role'), 'alert');
  assert.equal(root.querySelector('.wft-error').textContent, '', 'the card says it, not also the error line');
  click(byText(root, '.wft-acts button', 'Try your draft once now'));
  await tick(); await tick();
  assert.equal(root.querySelector('.wft-refusal'), null, 'a new try takes the card away');
  assert.equal(root.querySelector('.wft-error').textContent, 'A test of this workflow is running.');
});

test('U-T8 (F21): a save that pins a start point reads "Copying the project…" while it runs; a save that keeps the pin does not', async () => {
  const held = [];
  const over = { save: () => new Promise((r) => held.push(() => r({ ok: true }))) };
  const saveBtn = (root) => byText(root, '.wft-acts button', 'Save example') || root.querySelector('.wft-acts .btn-primary');
  // The changes switch pins again (resolveProjectInput): a copy.
  const changes = boot(example(), { over });
  changes.root.querySelector('.wft-changes-box').checked = true;
  const b1 = saveBtn(changes.root);
  click(b1);
  await tick();
  assert.deepEqual([b1.textContent, b1.disabled], ['Copying the project…', true]);
  held.shift()();
  await tick(); await tick();
  assert.notEqual(b1.textContent, 'Copying the project…', 'the copy is done');
  // A project picked for the first time: a copy.
  const fresh = boot(example({ project: null, checks: [] }), { over, projectView: null });
  const sel = fresh.root.querySelector('#wft-ex-project');
  sel.value = 'worca-cc-1a2b3c4d';
  sel.dispatchEvent(new fresh.win.Event('change'));
  const b2 = saveBtn(fresh.root);
  click(b2);
  await tick();
  assert.equal(b2.textContent, 'Copying the project…');
  held.shift()();
  await tick(); await tick();
  // The kept pin (a request edit): no copy, no busy words.
  const kept = boot(example(), { over });
  const b3 = saveBtn(kept.root);
  click(b3);
  await tick();
  assert.deepEqual([b3.textContent, b3.disabled], ['Save example', true]);
  held.shift()();
  await tick(); await tick();
  assert.deepEqual([b3.textContent, b3.disabled], ['Save example', false]);
  // No project: no copy.
  const none = boot(example({ project: null, checks: [] }), { over, projectView: null });
  const b4 = saveBtn(none.root);
  click(b4);
  await tick();
  assert.equal(b4.textContent, 'Save example');
  held.shift()();
  await tick();
});

test('review 8: switching the changes on says it moves the start, only when it would', () => {
  const same = boot();
  assert.equal(same.root.querySelector('.wft-changes-hint').textContent, 'Off: the example starts from the commit only. On: your changes are saved with the example.');
  const ahead = [{ ...PROJECTS[0], current: { ...PROJECTS[0].current, sha: 'f'.repeat(40), short: 'fffffff' } }];
  const moved = boot(example(), { projects: ahead });
  assert.equal(moved.root.querySelector('.wft-changes-hint').textContent,
    'Off: the example starts from the commit only. On: your changes are saved with the example. Turning this on also moves the start point to the newest commit on main.');
  const withChanges = boot(example({ project: { ...PIN, changesSha256: 'a'.repeat(64) } }), { projects: ahead });
  assert.ok(!withChanges.root.querySelector('.wft-changes-hint').textContent.includes('Turning this on'), 'already on: nothing to say');
});

test('review 9, 15: "A file in the project" with no file name is refused; its box is labelled', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const doc = window.document;
  const saved = [];
  openCheckDialog({ doc, win: window, scripts: [], project: true, onSave: (c) => saved.push(c) });
  const kind = doc.querySelector('#wft-ck-kind');
  kind.value = 'mentions'; kind.dispatchEvent(new window.Event('change'));
  doc.querySelector('#wft-ck-text').value = 'rounding';
  doc.querySelector('input[name="wft-ck-from"][value="file"]').checked = true;
  assert.equal(doc.querySelector('#wft-ck-from-file').getAttribute('aria-label'), 'File in the project');
  click(byText(doc, '.mk-dialog button', 'Add check'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Write the file name.');
  assert.deepEqual(saved, []);
});

test('U-T8 fix round (review minor 2): Try it once now also reads "Copying the project…" when its save pins a start point, and not when it keeps the pin', async () => {
  const held = [];
  const over = { tryOnce: () => new Promise((r) => held.push(() => r({ ok: true }))) };
  const tryBtn = (root) => byText(root, '.wft-acts button', 'Try your draft once now');   // U-T9's name
  const changes = boot(example(), { over });
  changes.root.querySelector('.wft-changes-box').checked = true;
  const b1 = tryBtn(changes.root);
  click(b1);
  await tick();
  assert.deepEqual([b1.textContent, b1.disabled], ['Copying the project…', true]);
  held.shift()();
  await tick(); await tick();
  assert.notEqual(b1.textContent, 'Copying the project…', 'the copy is done');
  const kept = boot(example(), { over });
  const b2 = tryBtn(kept.root);
  click(b2);
  await tick();
  assert.deepEqual([b2.textContent, b2.disabled], ['Try your draft once now', true]);
  held.shift()();
  await tick();
});
