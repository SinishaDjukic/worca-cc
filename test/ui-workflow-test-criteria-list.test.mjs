// test/ui-workflow-test-criteria-list.test.mjs — board 1's "Your criteria N" chip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTestsPage } from '../ui/public/workflows/tests-view.mjs';

const dom = () => new JSDOM('<!doctype html><div id="r"></div>').window;
const overview = (ex) => ({ workflowId: 'wf', name: 'W', needsProject: false, ctx: {}, draftSameAs: null, columns: [{ use: 'draft', label: 'Your draft · yours' }],
  examples: [{ id: 1, name: 'Bulk invoice export', hasRequest: true, files: [], fromAt: null, note: null, tries: 3, basics: 3, checks: 2, cells: {}, project: null, ready: true, reason: null, readyText: null, ...ex }],
  running: null, latest: null, pastRuns: [] });

test('the chips: Basics, Automatic, Your criteria (only when there are some)', () => {
  const win = dom();
  const root = win.document.getElementById('r');
  renderTestsPage(root, overview({ criteria: 3 }), {}, { doc: win.document });
  assert.deepEqual([...root.querySelectorAll('.wft-kind')].map((k) => k.textContent), ['Basics 3', 'Automatic 2', 'Your criteria 3']);
  renderTestsPage(root, overview({ criteria: 0 }), {}, { doc: win.document });
  assert.deepEqual([...root.querySelectorAll('.wft-kind')].map((k) => k.textContent), ['Basics 3', 'Automatic 2']);
});

test("board 1's card: \"Can you trust Worca's checking?\" with the counts; no card without criteria (Task 23)", () => {
  const win = dom();
  const root = win.document.getElementById('r');
  renderTestsPage(root, { ...overview({ criteria: 3 }), trust: { total: 12, reliable: 10, unreliable: 1, waiting: 1 } }, { openTrust: () => {} }, { doc: win.document });
  assert.equal(root.querySelector('.wft-trust-card').textContent, "Can you trust Worca's checking?Reliable for 10 of 12 criteria. 1 is unreliable, 1 needs your answers.");
  renderTestsPage(root, { ...overview({ criteria: 0 }), trust: { total: 0, reliable: 0, unreliable: 0, waiting: 0 } }, {}, { doc: win.document });
  assert.equal(root.querySelector('.wft-trust-card'), null);
});
