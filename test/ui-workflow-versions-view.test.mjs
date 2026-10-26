// test/ui-workflow-versions-view.test.mjs — the Versions page (canvas board 7, Part 1 columns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderVersionsPage } from '../ui/public/workflows/versions-view.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const overview = () => ({
  workflowId: 'wf_b', name: 'Product brief writer', liveVersionNo: 4,
  draft: { changed: true, changes: ['New step Fact check', 'Draft brief: AI model opus → sonnet'], partsChanged: [] },
  versions: [
    { id: 30, versionNo: 4, note: 'Shorter briefs', by: 'Tomica Brkovic', createdAt: '2026-10-12T09:00:00Z', inUse: true, runs: 41, changes: ['Removed step Summary'] },
    { id: 20, versionNo: 3, note: null, by: null, createdAt: '2026-10-08T09:00:00Z', inUse: false, runs: 28, changes: ['Review loop: at most 2 rounds → 3'] },
  ],
  history: [{ id: 41, source: 'save', by: null, createdAt: '2026-10-25T10:00:00Z', name: 'Product brief writer' },
    { id: 40, source: 'restore', by: 'Tomica Brkovic', createdAt: '2026-10-24T10:00:00Z', name: 'Product brief writer' }],
});

function boot(o = overview()) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const calls = [];
  const actions = { saveVersion: () => calls.push(['save']), useVersion: (n) => calls.push(['use', n]),
    restore: (id, label) => calls.push(['restore', id, label]), openCanvas: () => calls.push(['canvas']) };
  const root = window.document.getElementById('root');
  renderVersionsPage(root, o, actions, { doc: window.document });
  return { doc: window.document, root, calls };
}

test('the draft row says what changed and offers Save version', () => {
  const { root, calls } = boot();
  const draft = root.querySelector('.wfv-vt-draft');
  assert.match(draft.textContent, /Your draft/);
  assert.match(draft.textContent, /New step Fact check · Draft brief: AI model opus → sonnet/);
  click([...draft.querySelectorAll('button')].find((b) => b.textContent === 'Save version'));
  assert.deepEqual(calls.at(-1), ['save']);
});

test('version rows: number, note, who and when, in use, runs, and Use for new runs on the others', () => {
  const { root, calls } = boot();
  const rows = [...root.querySelectorAll('.wfv-vt-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.wfv-vt-no').textContent), ['v4', 'v3']);
  assert.match(rows[0].textContent, /Shorter briefs/);
  assert.match(rows[0].textContent, /New runs use this/);
  assert.match(rows[0].textContent, /Used 41 times/);
  assert.equal([...rows[0].querySelectorAll('button')].some((b) => b.textContent === 'Use for new runs'), false);
  click([...rows[1].querySelectorAll('button')].find((b) => b.textContent === 'Use for new runs'));
  assert.deepEqual(calls.at(-1), ['use', 3]);
  click([...rows[1].querySelectorAll('button')].find((b) => b.textContent === 'Restore into draft'));
  assert.deepEqual(calls.at(-1), ['restore', 20, 'v3']);
});

test('history: each entry is the state from just BEFORE that change, in plain words, with Restore', () => {
  const { root, calls } = boot({ ...overview(), history: [
    ...overview().history,
    { id: 39, source: 'defaults', by: null, createdAt: '2026-10-23T10:00:00Z', name: 'Product brief writer' },
    { id: 38, source: 'delete', by: null, createdAt: '2026-10-22T10:00:00Z', name: 'Product brief writer' }] });
  assert.match(root.querySelector('.wfv-vh').textContent, /Each entry is the workflow as it was just before that change/);
  const items = [...root.querySelectorAll('.wfv-vh-row')];
  assert.match(items[0].querySelector('.wfv-vh-what').textContent, /^Before the save of \S/);
  assert.match(items[1].querySelector('.wfv-vh-what').textContent, /^Before the restore of \S/);
  assert.match(items[1].textContent, /by Tomica Brkovic/);
  assert.match(items[2].querySelector('.wfv-vh-what').textContent, /^Before step defaults changed, \S/);
  assert.match(items[3].querySelector('.wfv-vh-what').textContent, /^As it was when deleted, \S/);
  assert.doesNotMatch(root.querySelector('.wfv-vh').textContent, /\b(Saved|Restored|Deleted)\b/, 'never the opposite state');
  click(items[0].querySelector('button'));
  assert.equal(calls.at(-1)[0], 'restore');
});

test('no versions yet: an explanation and Save version, no table', () => {
  const { root } = boot({ ...overview(), liveVersionNo: null, draft: null, versions: [] });
  assert.match(root.textContent, /No versions yet/);
  assert.equal(root.querySelectorAll('.wfv-vt-row').length, 0);
});

test('no overview with a reason: "Versions are not available" and the reason, nothing else', () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  renderVersionsPage(root, null, {}, { doc: window.document, error: 'Worca did not answer (down).' });
  assert.match(root.textContent, /Versions are not available/);
  assert.match(root.textContent, /Worca did not answer \(down\)\./);
  assert.equal(root.querySelectorAll('button').length, 0);
});

test('row buttons name what they act on; a history Restore says which save', () => {
  const { root, calls } = boot();
  const v3 = root.querySelectorAll('.wfv-vt-row')[1];
  assert.deepEqual([...v3.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')), ['Use v3 for new runs', 'Restore v3 into draft']);
  const h = root.querySelector('.wfv-vh-row button');
  assert.match(h.getAttribute('aria-label'), /^Restore the state from before .+ into draft$/);
  click(h);
  assert.match(calls.at(-1)[2], /^the state from before \S/);
});

test('visible words never say revision, rev, fingerprint or live (D10)', () => {
  const { root } = boot();
  assert.doesNotMatch(root.textContent, /\b(revision|rev|fingerprint|live)\b/i);
});

test('every button carries a focus key, so a repaint or a closing dialog can find it again', () => {
  const { root } = boot();
  const keys = [...root.querySelectorAll('button')].map((b) => b.dataset.focusKey);
  assert.deepEqual(keys, ['vp:save', 'vp:restore:30', 'vp:use:3', 'vp:restore:20', 'vp:history:41', 'vp:history:40']);
});

test('a version without a note is titled "Version N"; its changes stay in the detail line, once', () => {
  const { root } = boot();
  const v3 = root.querySelectorAll('.wfv-vt-row')[1];
  assert.equal(v3.querySelector('.wfv-vt-head b').textContent, 'Version 3');
  assert.equal(v3.textContent.split('Review loop: at most 2 rounds → 3').length - 1, 1);
});

test('while the versions are read: a plain "Reading the versions…", no stale rows, no buttons', () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  renderVersionsPage(root, null, {}, { doc: window.document, loading: true });
  assert.match(root.textContent, /Reading the versions…/);
  assert.equal(root.querySelectorAll('button').length, 0);
  assert.doesNotMatch(root.textContent, /No versions yet/);
});
