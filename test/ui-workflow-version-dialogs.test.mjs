// test/ui-workflow-version-dialogs.test.mjs — Save version / Use dialogs and the top-bar status line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openSaveVersionDialog, openUseVersionDialog, statusText } from '../ui/public/workflows/version-dialogs.mjs';

const dom = () => { const d = new JSDOM('<!doctype html><body></body>'); return { doc: d.window.document, win: d.window }; };
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

test('statusText: nothing, in use, or draft', () => {
  assert.equal(statusText({ liveVersionNo: null, draft: null }), '');
  assert.equal(statusText({ liveVersionNo: 4, draft: { changed: false, changes: [] } }), 'v4 in use');
  assert.equal(statusText({ liveVersionNo: 4, draft: { changed: true, changes: ['x'] } }), 'Draft · new runs use v4');
});

test('Save version: title, the changes since the latest version, a note, and "Also use v5 for new runs"', async () => {
  const { doc, win } = dom();
  let sent = null;
  openSaveVersionDialog({ doc, win, nextNo: 5, sinceNo: 4, changes: ['New step Fact check'], onSubmit: async (b) => { sent = b; return { ok: true }; } });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Save version 5');
  assert.equal(doc.querySelector('.wfv-sv-since').textContent, 'What changed since v4:');
  assert.deepEqual([...doc.querySelectorAll('.wfv-changes li')].map((li) => li.textContent), ['New step Fact check']);
  doc.querySelector('#wfv-sv-note').value = 'Cheaper drafting';
  doc.querySelector('#wfv-sv-use').checked = true;
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Save version 5'));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, { note: 'Cheaper drafting', use: true });
  assert.equal(doc.querySelector('#mk-dialog'), null, 'closes on success');
});

test('Save version with nothing changed since the latest version: says so, shows the refusal and stays open', async () => {
  const { doc, win } = dom();
  openSaveVersionDialog({ doc, win, nextNo: 2, sinceNo: 1, changes: [], onSubmit: async () => ({ ok: false, error: 'nothing changed since version 1' }) });
  assert.equal(doc.querySelector('.wfv-changes-none').textContent, 'Nothing changed since v1.');
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Save version 2'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('.wfv-dlg-error').textContent, 'nothing changed since version 1');
  assert.ok(doc.querySelector('#mk-dialog'));
});

test('Save version 1: "This is the first version." and no comparison', () => {
  const { doc, win } = dom();
  openSaveVersionDialog({ doc, win, nextNo: 1, sinceNo: null, changes: [], onSubmit: async () => ({ ok: true }) });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Save version 1');
  assert.equal(doc.querySelector('.wfv-sv-since').textContent, 'This is the first version.');
  assert.equal(doc.querySelector('.wfv-changes'), null);
  assert.equal(doc.querySelector('.wfv-changes-none'), null);
  assert.doesNotMatch(doc.querySelector('.mk-dialog-body').textContent, /What changed since|No changes since/);
});

test('Use dialog: no version in use yet (changes null) says so, never "Nothing differs"', () => {
  const { doc, win } = dom();
  openUseVersionDialog({ doc, win, versionNo: 1, changes: null, onConfirm: async () => ({ ok: true }) });
  const body = doc.querySelector('.mk-dialog-body').textContent;
  assert.match(body, /No version is in use yet: new runs use your draft as it was last saved./);
  assert.doesNotMatch(body, /Nothing differs|Compared with the version in use/);
});

test('Use dialog: the Library note shows once when asked, and never as a listed change (I4)', () => {
  const { doc, win } = dom();
  openUseVersionDialog({ doc, win, versionNo: 2, changes: [], libraryEdited: true, onConfirm: async () => ({ ok: true }) });
  assert.equal(doc.querySelectorAll('.wfv-use-library').length, 1);
  assert.equal(doc.querySelector('.wfv-changes-none').textContent, 'Nothing differs from the version in use.');
  const plain = dom();
  openUseVersionDialog({ doc: plain.doc, win: plain.win, versionNo: 2, changes: ['x'], onConfirm: async () => ({ ok: true }) });
  assert.equal(plain.doc.querySelector('.wfv-use-library'), null);
});

test('Use dialog: plain words and one confirming button', async () => {
  const { doc, win } = dom();
  let used = 0;
  openUseVersionDialog({ doc, win, versionNo: 5, changes: ['Draft brief: AI model opus → sonnet'], onConfirm: async () => { used += 1; return { ok: true }; } });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Use v5 for new runs?');
  assert.match(doc.querySelector('.mk-dialog-body').textContent, /Runs already going keep their version\. You can switch back at any time\./);
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Use v5'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(used, 1);
});
