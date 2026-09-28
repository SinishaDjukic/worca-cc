// test/ui-artifact-picker.test.mjs — the past-run artifact picker (W2/W9, C6) and the
// File… source, both wired into the bench's input rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  artifactMatches, runRowLabel, renderRunList, renderArtifactList, openArtifactPicker,
  readInputFile, MAX_INPUT_BYTES,
} from '../ui/public/artifact-picker.mjs';
import { renderBench, createBenchController } from '../ui/public/script-bench-view.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 4) => { for (let i = 0; i < n; i += 1) await tick(); };

const PIPELINES = [
  { id: 'b4c2e251', title: 'Ship the gate', status: 'done', startedAt: '2026-09-17T09:00:00.000Z', projectKey: 'worca-0001', projectName: 'worca' },
  { id: 'a1a1a1a1', title: 'Nightly', status: 'error', startedAt: '2026-09-16T22:00:00.000Z', projectKey: 'worca-0001', projectName: 'worca' },
  { id: 'c3c3c3c3', title: 'Scan', status: 'done', startedAt: 'nope', projectKey: 'workspaces/ws1', projectName: 'ws1', workspaceName: 'Fleet', target: 'workspace' },
];
const ARTIFACTS = [
  { kind: 'plan', relPath: 'pipeline/plan.md', bytes: 2048, nodeId: 'n_plan', cycle: 1 },
  { kind: 'review', relPath: 'pipeline/review-cycle1.json', bytes: 512, nodeId: 'n_rev', cycle: 1 },
  { kind: 'result', relPath: 'pipeline/result.diff', bytes: 99, nodeId: null, cycle: null },
];
const ok = (data) => ({ ok: true, status: 200, data });
function fakeApi(over = {}) {
  return {
    history: async () => ok({ pipelines: PIPELINES }),
    runArtifacts: async () => ok({ runId: 'b4c2e251', artifacts: ARTIFACTS }),
    runArtifact: async (runId, rel) => ok({ rel, text: `# ${rel}\n` }),
    ...over,
  };
}
function fakeModal() {
  const shell = { title: '', body: null, actions: [], open: 0, closed: 0 };
  return {
    shell,
    open(title, bodyEl, actions = []) { shell.title = title; shell.body = bodyEl; shell.actions = actions; shell.open += 1; },
    onClose(fn) { shell.closeHook = fn; shell.hooked = (shell.hooked || 0) + 1; return () => { shell.closeHook = null; shell.unhooked = (shell.unhooked || 0) + 1; }; },
    close() { shell.closed += 1; },
    click(label) { const a = shell.actions.find(([l]) => l === label); if (a) a[2](); },
  };
}

test('artifactMatches: the extension decides, case-insensitively', () => {
  assert.equal(artifactMatches('pipeline/plan.MD', ['md']), true);
  assert.equal(artifactMatches('pipeline/plan.md', ['json']), false);
  assert.equal(artifactMatches('pipeline/review.json', ['md', 'json']), true);
  assert.equal(artifactMatches('pipeline/result.diff', ['md', 'json']), false);
  assert.equal(artifactMatches('noext', ['md']), false);
});

test('runRowLabel: title, id and the local start time; an unparsable date is dropped', () => {
  const d = new Date('2026-09-17T09:00:00.000Z');
  const p = (n) => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  assert.equal(runRowLabel(PIPELINES[0]), `Ship the gate · b4c2e251 · ${when}`);
  assert.equal(runRowLabel(PIPELINES[2]), 'Scan · c3c3c3c3');
});

test('renderRunList groups by project, newest first, and names a workspace by its own name', () => {
  const el = renderRunList(PIPELINES, { doc, types: ['md'] });
  assert.deepEqual([...el.querySelectorAll('.apick-project')].map((g) => g.querySelector('.apick-project-name').textContent),
    ['worca', 'Fleet']);
  assert.deepEqual([...el.querySelectorAll('.apick-run')].map((b) => b.dataset.runId), ['b4c2e251', 'a1a1a1a1', 'c3c3c3c3']);
  assert.equal(el.querySelector('.apick-run .apick-run-title').textContent, 'Ship the gate');
  assert.equal(renderRunList([], { doc, types: ['md'] }).querySelector('.apick-empty').textContent, 'No runs yet.');
  assert.equal(el.querySelectorAll('p').length, 0);
});

test('renderArtifactList filters by type and offers a way back', () => {
  const el = renderArtifactList(ARTIFACTS, { doc, types: ['md'], runId: 'b4c2e251' });
  assert.deepEqual([...el.querySelectorAll('.apick-art')].map((b) => b.dataset.rel), ['pipeline/plan.md']);
  assert.equal(el.querySelector('.apick-art-name').textContent, 'plan.md');
  assert.equal(el.querySelector('.apick-art-kind').textContent, 'plan');
  assert.equal(el.querySelector('.apick-art-bytes').textContent, '2.0 KB');
  assert.equal(el.querySelector('.apick-back').textContent, 'Runs');
  const json = renderArtifactList(ARTIFACTS, { doc, types: ['json'], runId: 'x' });
  assert.deepEqual([...json.querySelectorAll('.apick-art')].map((b) => b.dataset.rel), ['pipeline/review-cycle1.json']);
  const none = renderArtifactList([ARTIFACTS[2]], { doc, types: ['md'], runId: 'x' });
  assert.equal(none.querySelector('.apick-empty').textContent, 'This run has no md artifacts.');
});

test('openArtifactPicker: runs → artifacts → the text, with the run in the label', async () => {
  const modal = fakeModal();
  const api = fakeApi();
  const picked = openArtifactPicker({ doc, api, types: ['md'], modal });
  await flush();
  assert.equal(modal.shell.title, 'Pick an artifact');
  modal.shell.body.querySelector('.apick-run[data-run-id="b4c2e251"]').click();
  await flush();
  assert.deepEqual([...modal.shell.body.querySelectorAll('.apick-art')].map((b) => b.dataset.rel), ['pipeline/plan.md']);
  modal.shell.body.querySelector('.apick-art').click();
  const out = await picked;
  assert.deepEqual(out, { text: '# pipeline/plan.md\n', label: 'Ship the gate · pipeline/plan.md' });
  assert.equal(modal.shell.closed, 1);
});

test('openArtifactPicker: Back returns to the run list, Cancel resolves null once', async () => {
  const modal = fakeModal();
  const picked = openArtifactPicker({ doc, api: fakeApi(), types: ['md'], modal });
  await flush();
  modal.shell.body.querySelector('.apick-run').click();
  await flush();
  modal.shell.body.querySelector('.apick-back').click();
  await flush();
  assert.ok(modal.shell.body.querySelector('.apick-run'), 'back to the runs');
  modal.click('Cancel');
  assert.equal(await picked, null);
  modal.click('Cancel');
  assert.equal(await picked, null, 'the promise settles exactly once');
});

test('openArtifactPicker: a failed fetch is shown in place and resolves null on Cancel', async () => {
  const modal = fakeModal();
  const api = fakeApi({ history: async () => ({ ok: false, status: 500, data: { error: 'history unavailable' } }) });
  const picked = openArtifactPicker({ doc, api, types: ['md'], modal });
  await flush();
  assert.equal(modal.shell.body.querySelector('.apick-err').textContent, 'history unavailable');
  modal.click('Cancel');
  assert.equal(await picked, null);
});

test('readInputFile: the text, the 256 KiB cap and a reader failure', async () => {
  assert.equal(MAX_INPUT_BYTES, 262144);
  const small = new win.File(['# Plan\n'], 'plan.md', { type: 'text/markdown' });
  assert.deepEqual(await readInputFile(small, { FileReaderImpl: win.FileReader }), { text: '# Plan\n', label: 'plan.md' });
  const big = new win.File(['x'.repeat(MAX_INPUT_BYTES + 1)], 'huge.md');
  await assert.rejects(readInputFile(big, { FileReaderImpl: win.FileReader }),
    { message: '"huge.md" is larger than 256 KiB.' });
  class Broken { readAsText() { setTimeout(() => this.onerror(new Error('boom')), 0); } }
  await assert.rejects(readInputFile(small, { FileReaderImpl: Broken }),
    { message: '"plan.md" could not be read.' });
});

// ---- the bench's input rows ------------------------------------------------

const META = {
  key: 'runTests', displayName: 'Run tests', origin: 'user', runtime: 'node', timeoutMs: 20000, params: [],
  inputs: [{ id: 'plan', type: 'md', required: false }, { id: 'done', type: 'void', required: false }],
  outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'l.md' }],
};
const DATA = { meta: META, source: '', sourceWin32: null, cases: [], userCases: [], casesWritable: true };

function mountBench(modal) {
  const root = renderBench(DATA, { doc, projects: [], caseState: new Map(), highlight: async (t) => t });
  doc.body.appendChild(root);
  const ctl = createBenchController({
    root, data: DATA, doc, modal,
    api: { bench: async () => ok({ benchId: 'b1' }), benchStop: async () => ok({ ok: true }),
      benchOutput: () => '#', writeCases: async (k, c) => ok({ cases: c }),
      history: async () => ok({ pipelines: PIPELINES }),
      runArtifacts: async () => ok({ runId: 'b4c2e251', artifacts: ARTIFACTS }),
      runArtifact: async (runId, rel) => ok({ rel, text: `# ${rel}\n` }) },
    ws: { send: () => {} }, onCaseState: () => {}, getDraft: () => null,
    renderMarkdown: async () => {}, highlight: async (t) => t,
  });
  return { root, ctl, cleanup: () => { ctl.destroy(); root.remove(); } };
}

test('a non-void input row offers Text, File… and Run…; a void one offers none', () => {
  const b = mountBench(fakeModal());
  const plan = b.root.querySelector('.bench-port[data-port="plan"]');
  assert.deepEqual([...plan.querySelectorAll('[data-in-src]')].map((x) => [x.dataset.inSrc, x.textContent]),
    [['text', 'Text'], ['file', 'File…'], ['run', 'Run…']]);
  assert.ok(plan.querySelector('input[type="file"].bench-file'));
  assert.equal(plan.querySelector('input[type="file"].bench-file').hidden, true);
  assert.equal(b.root.querySelector('.bench-port[data-port="done"] [data-in-src]'), null);
  b.cleanup();
});

test('File… fills the textarea, ticks bound and names the source; an oversize file says so', async () => {
  const b = mountBench(fakeModal());
  const plan = b.root.querySelector('.bench-port[data-port="plan"]');
  const input = plan.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [new win.File(['# From disk\n'], 'plan.md')], configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush(6);
  assert.equal(plan.querySelector('[data-field="in:plan:text"]').value, '# From disk\n');
  assert.equal(plan.querySelector('[data-field="in:plan:bound"]').checked, true);
  assert.equal(plan.querySelector('.bench-src-label').textContent, 'plan.md');
  Object.defineProperty(input, 'files', { value: [new win.File(['x'.repeat(MAX_INPUT_BYTES + 1)], 'huge.md')], configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush(6);
  assert.equal(b.root.querySelector('.bench-msg').textContent, '"huge.md" is larger than 256 KiB.');
  assert.equal(plan.querySelector('[data-field="in:plan:text"]').value, '# From disk\n', 'the previous text is kept');
  b.cleanup();
});

test('Run… opens the picker for the port`s type and drops the artifact in as TEXT', async () => {
  const modal = fakeModal();
  const b = mountBench(modal);
  b.root.querySelector('.bench-port[data-port="plan"] [data-in-src="run"]').click();
  await flush();
  assert.equal(modal.shell.title, 'Pick an artifact');
  modal.shell.body.querySelector('.apick-run').click();
  await flush();
  assert.deepEqual([...modal.shell.body.querySelectorAll('.apick-art')].map((x) => x.dataset.rel), ['pipeline/plan.md'],
    'an md port is offered md artifacts only');
  modal.shell.body.querySelector('.apick-art').click();
  await flush(6);
  const plan = b.root.querySelector('.bench-port[data-port="plan"]');
  assert.equal(plan.querySelector('[data-field="in:plan:text"]').value, '# pipeline/plan.md\n');
  assert.equal(plan.querySelector('[data-field="in:plan:bound"]').checked, true);
  assert.equal(plan.querySelector('.bench-src-label').textContent, 'Ship the gate · pipeline/plan.md');
  assert.ok(plan.querySelector('[data-in-src="text"]').classList.contains('on'), 'W9: it is text from then on');
  b.cleanup();
});

test('the modal shell`s OWN Close (header button, Escape) settles the picker, and the hook is released', async () => {
  const modal = fakeModal();
  const picked = openArtifactPicker({ doc, api: fakeApi(), types: ['md'], modal });
  await flush();
  assert.equal(modal.shell.hooked, 1);
  modal.shell.closeHook();                       // what app.js wires to #plugin-modal-close and Escape
  assert.equal(await picked, null);
  assert.equal(modal.shell.unhooked, 1, 'no listener left behind for the next open to stack on');
  assert.equal(modal.shell.closed, 1);
});

test('a run row says its title once', () => {
  const el = renderRunList(PIPELINES, { doc });
  const row = el.querySelector('.apick-run');
  assert.equal(row.querySelector('.apick-run-title').textContent, 'Ship the gate');
  assert.equal(row.querySelector('.apick-run-meta').textContent.includes('Ship the gate'), false);
  assert.match(row.querySelector('.apick-run-meta').textContent, /^b4c2e251 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('an artifact over the 256 KiB port cap is refused with the same sentence File… uses, and the list stays on screen', async () => {
  const modal = fakeModal();
  const big = 'x'.repeat(MAX_INPUT_BYTES + 1);
  const picked = openArtifactPicker({ doc, api: fakeApi({ runArtifact: async (id, rel) => ok({ rel, text: big }) }), types: ['md'], modal });
  await flush();
  modal.shell.body.querySelector('.apick-run').click();
  await flush();
  modal.shell.body.querySelector('.apick-art').click();
  await flush(6);
  assert.equal(modal.shell.body.querySelector('.apick-err').textContent, '"pipeline/plan.md" is larger than 256 KiB.');
  assert.ok(modal.shell.body.querySelector('.apick-art'), 'the artifact list is still there to pick another one');
  assert.equal(modal.shell.closed, 0, 'the picker is still open');
  modal.shell.closeHook();
  assert.equal(await picked, null);
});

test('a pick that 404s (a pruned file behind a live index row) is not a dead end', async () => {
  const modal = fakeModal();
  const picked = openArtifactPicker({
    doc, types: ['md'], modal,
    api: fakeApi({ runArtifact: async () => ({ ok: false, status: 404, data: { error: 'artifact not found' } }) }),
  });
  await flush();
  modal.shell.body.querySelector('.apick-run').click();
  await flush();
  modal.shell.body.querySelector('.apick-art').click();
  await flush(6);
  assert.equal(modal.shell.body.querySelector('.apick-err').textContent, 'artifact not found');
  assert.ok(modal.shell.body.querySelector('.apick-back'), 'Runs is still there to go back with');
  modal.shell.body.querySelector('.apick-back').click();
  await flush(4);
  assert.ok(modal.shell.body.querySelector('.apick-run'), 'and it works');
  assert.equal(modal.shell.body.querySelector('.apick-err'), null, 'the stale error went with the repaint');
  modal.shell.closeHook();
  assert.equal(await picked, null);
});
