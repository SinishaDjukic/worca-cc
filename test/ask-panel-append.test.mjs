// makePanel from test/helpers/ask-panel-harness.mjs — no app boot; the panel takes
// every dependency through its factory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel, pointerdown } from './helpers/ask-panel-harness.mjs';

test('appendToComposer: opens the sheet, appends on its own line, focuses, never sends', async () => {
  const { panel, doc, fetchCalls } = makePanel();
  assert.equal(panel.isOpen(), false);
  assert.equal(panel.appendToComposer('[diff comment dc_00000001 — a.js:2 (new)] "one"'), true);
  assert.equal(panel.isOpen(), true);
  const ta = doc.querySelector('.ask-input');
  assert.equal(ta.value, '[diff comment dc_00000001 — a.js:2 (new)] "one"');
  panel.appendToComposer('[diff comment dc_00000002 — a.js:3 (new)] "two"');
  assert.equal(ta.value.split('\n').length, 2, 'stacked, one per line');
  assert.equal(doc.activeElement, ta, 'focused even though the sheet was already open');
  assert.equal(fetchCalls.filter((c) => (c.opts.method || 'GET') === 'POST').length, 0, 'append never sends');
  assert.equal(panel.appendToComposer('   '), false);
  assert.equal(panel.appendToComposer(null), false);
});

test('a pointerdown on a .hd-cmt-card does not close the open sheet', async () => {
  const { panel, doc, window } = makePanel();
  panel.open();
  const card = doc.createElement('div');
  card.className = 'hd-cmt-card';
  const btn = doc.createElement('button');
  card.appendChild(btn);
  doc.body.appendChild(card);
  pointerdown(window, btn);
  assert.equal(panel.isOpen(), true, 'the allowlist keeps the sheet open for the click that follows');
});

test('destroy() makes appendToComposer a no-op instead of a throw', async () => {
  const { panel } = makePanel();
  panel.destroy();
  assert.equal(panel.appendToComposer('x'), false);
});
