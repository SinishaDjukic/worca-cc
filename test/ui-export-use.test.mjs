// test/ui-export-use.test.mjs — D17: the Export dialog's Version field (canvas board 21), the pure helpers of
// ui/public/workflows/export-use.mjs. The app wiring is covered in test/ui-workflows-app.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { exportUseChoices, exportUseHint, exportUseValue, paintExportUse } from '../ui/public/workflows/export-use.mjs';

const v = (versionNo, note, inUse = false) => ({ id: versionNo * 10, versionNo, note, by: null, createdAt: '2026-10-25', inUse, runs: 0, changes: [] });
const overview = (over = {}) => ({
  workflowId: 'wf_p', name: 'Presentation', liveVersionNo: 1, latestVersionNo: 2,
  draft: { changed: true, changes: ['New step Fact check'], partsChanged: [], sinceLatest: null },
  versions: [v(2, 'More audit rounds'), v(1, 'First version for the team', true)], history: [], ...over,
});

test('exportUseChoices: newest version first, the one in use says so, Your draft last; the default is the version in use', () => {
  const c = exportUseChoices(overview());
  assert.deepEqual(c.options, [
    { value: '2', label: 'v2 · More audit rounds' },
    { value: '1', label: 'v1 · First version for the team · new runs use this' },
    { value: 'draft', label: 'Your draft (not saved as a version)' },
  ]);
  assert.equal(c.selected, '1');
});

test('exportUseChoices: a version without a note is just its number; a draft equal to the version in use is plain "Your draft"', () => {
  const c = exportUseChoices(overview({ draft: { changed: false, changes: [], partsChanged: [] },
    versions: [v(3, null), v(2, '  '), v(1, null, true)] }));
  assert.deepEqual(c.options.map((o) => o.label), ['v3', 'v2', 'v1 · new runs use this', 'Your draft']);
});

test('exportUseChoices: no version in use defaults to Your draft; no versions (or no overview) means no field', () => {
  const none = exportUseChoices(overview({ liveVersionNo: null, draft: null, versions: [v(2, null), v(1, null)] }));
  assert.equal(none.selected, 'draft');
  assert.deepEqual(none.options.map((o) => o.label), ['v2', 'v1', 'Your draft']);
  assert.equal(exportUseChoices(overview({ liveVersionNo: null, draft: null, versions: [] })), null);
  assert.equal(exportUseChoices(null), null);
  assert.equal(exportUseChoices({}), null);
});

test('exportUseHint: only for Your draft when it differs from the version in use', () => {
  const c = exportUseChoices(overview());
  assert.equal(exportUseHint(c, 'draft'), 'Your draft differs from v1, which new runs use.');
  assert.equal(exportUseHint(c, '1'), '');
  assert.equal(exportUseHint(c, '2'), '');
  assert.equal(exportUseHint(exportUseChoices(overview({ draft: { changed: false, changes: [] } })), 'draft'), '');
  assert.equal(exportUseHint(exportUseChoices(overview({ liveVersionNo: null, draft: null, versions: [v(1, null)] })), 'draft'), '');
  assert.equal(exportUseHint(null, 'draft'), '');
});

test('exportUseValue: what the request carries — a number, \'draft\', or nothing while the field is not shown', () => {
  assert.equal(exportUseValue('2'), 2);
  assert.equal(exportUseValue('draft'), 'draft');
  assert.equal(exportUseValue(''), undefined);
  assert.equal(exportUseValue(null), undefined);
});

test('paintExportUse: fills the select, shows the field and the hint by the choice; null hides both and empties the select', () => {
  const { window } = new JSDOM('<!doctype html><div id="f" class="hidden"><select id="s"></select><span id="h" class="hint hidden"></span></div>');
  const doc = window.document;
  const els = { field: doc.getElementById('f'), select: doc.getElementById('s'), hint: doc.getElementById('h') };
  const c = exportUseChoices(overview());
  paintExportUse(els, c, { doc });
  assert.equal(els.field.classList.contains('hidden'), false);
  assert.deepEqual([...els.select.options].map((o) => [o.value, o.textContent]), c.options.map((o) => [o.value, o.label]));
  assert.equal(els.select.value, '1');
  assert.equal(els.hint.classList.contains('hidden'), true);
  els.select.value = 'draft';
  paintExportUse(els, c, { doc, keep: true });
  assert.equal(els.select.value, 'draft', 'keep: the user\'s pick survives a repaint');
  assert.equal(els.hint.textContent, 'Your draft differs from v1, which new runs use.');
  assert.equal(els.hint.classList.contains('hidden'), false);
  paintExportUse(els, null, { doc });
  assert.equal(els.field.classList.contains('hidden'), true);
  assert.equal(els.select.options.length, 0);
  assert.equal(els.hint.textContent, '');
  assert.equal(els.hint.classList.contains('hidden'), true);
});

test('the words: no option says "revision" or "live"; our own words say "version" only in "not saved as a version"', () => {
  const words = exportUseChoices(overview({ versions: [v(2, 'More audit rounds'), v(1, 'Team pick', true)] }))
    .options.map((o) => o.label).join(' | ');
  assert.doesNotMatch(words, /\b(revision|live)\b/i);
  assert.doesNotMatch(words.replace('not saved as a version', ''), /version/i);
});
