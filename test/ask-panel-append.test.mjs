// makePanel from test/helpers/ask-panel-harness.mjs — no app boot; the panel takes
// every dependency through its factory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel } from './helpers/ask-panel-harness.mjs';
import { checkRows } from './helpers/rows.mjs';

test('appendToComposer appends on its own line, focuses, never opens the page or sends; after destroy() it is a no-op', async () => {
  await checkRows([
    { name: 'appendToComposer: appends on its own line, focuses, never opens the page, never sends', run: async () => {
      const { panel, doc, fetchCalls } = makePanel();
      assert.equal(panel.isOpen(), false);
      assert.equal(panel.appendToComposer('[diff comment dc_00000001 — a.js:2 (new)] "one"'), true);
      assert.equal(panel.isOpen(), false, 'appending opens nothing — app.js openChat() routes to #chat first');
      const ta = doc.querySelector('.ask-input');
      assert.equal(ta.value, '[diff comment dc_00000001 — a.js:2 (new)] "one"');
      panel.appendToComposer('[diff comment dc_00000002 — a.js:3 (new)] "two"');
      assert.equal(ta.value.split('\n').length, 2, 'stacked, one per line');
      assert.equal(doc.activeElement, ta, 'focused');
      assert.equal(fetchCalls.filter((c) => (c.opts.method || 'GET') === 'POST').length, 0, 'append never sends');
      assert.equal(panel.appendToComposer('   '), false);
      assert.equal(panel.appendToComposer(null), false);
    } },
    { name: 'destroy() makes appendToComposer a no-op instead of a throw', run: async () => {
      const { panel } = makePanel();
      panel.destroy();
      assert.equal(panel.appendToComposer('x'), false);
    } },
  ]);
});
