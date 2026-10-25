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

test('Save version: title, the changes, a note, and "Also use v5 for new runs"', async () => {
  const { doc, win } = dom();
  let sent = null;
  openSaveVersionDialog({ doc, win, nextNo: 5, changes: ['New step Fact check'], onSubmit: async (b) => { sent = b; return { ok: true }; } });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Save version 5');
  assert.deepEqual([...doc.querySelectorAll('.wfv-changes li')].map((li) => li.textContent), ['New step Fact check']);
  doc.querySelector('#wfv-sv-note').value = 'Cheaper drafting';
  doc.querySelector('#wfv-sv-use').checked = true;
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Save version 5'));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, { note: 'Cheaper drafting', use: true });
  assert.equal(doc.querySelector('#mk-dialog'), null, 'closes on success');
});

test('Save version shows the error and stays open on failure', async () => {
  const { doc, win } = dom();
  openSaveVersionDialog({ doc, win, nextNo: 2, changes: [], onSubmit: async () => ({ ok: false, error: 'nothing changed since version 1' }) });
  assert.equal(doc.querySelector('.wfv-changes-none').textContent, 'No changes since the last version.');
  click([...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Save version 2'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('.wfv-dlg-error').textContent, 'nothing changed since version 1');
  assert.ok(doc.querySelector('#mk-dialog'));
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
